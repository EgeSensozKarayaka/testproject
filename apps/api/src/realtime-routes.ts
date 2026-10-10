import type { ServerResponse } from 'node:http';

import { openApiOperations } from '@site-monitor/contracts/openapi';
import type { FastifyInstance } from 'fastify';

import { requireAuthenticatedSession } from './authenticated-request.js';
import type { AuthServicePort } from './auth-routes.js';
import { assertTrustedBrowserRequest, readSessionCookie } from './browser-security.js';
import { ApiProblemError } from './problem.js';
import type { RealtimeHub, RealtimeTransport } from './realtime-hub.js';

export interface RealtimeRoutesOptions {
  allowedOrigin: string;
  authService: AuthServicePort;
  cookieSecure: boolean;
  hub: RealtimeHub;
}

function acceptsEventStream(value: string | string[] | undefined): boolean {
  const values = Array.isArray(value) ? value : [value ?? ''];
  return values.some((header) =>
    header
      .split(',')
      .map((part) => part.trim().split(';', 1)[0]?.toLowerCase())
      .includes('text/event-stream'),
  );
}

function transport(response: ServerResponse): RealtimeTransport {
  return {
    end: () => {
      if (!response.writableEnded) response.end();
    },
    onClose: (callback) => response.once('close', callback),
    onDrain: (callback) => response.on('drain', callback),
    write: (frame) => response.write(frame, 'utf8'),
  };
}

export function registerRealtimeRoutes(app: FastifyInstance, options: RealtimeRoutesOptions): void {
  app.get(
    openApiOperations.streamPrivateEvents.path,
    { schema: openApiOperations.streamPrivateEvents.routeSchema },
    async (request, reply) => {
      if (!acceptsEventStream(request.headers.accept)) {
        throw new ApiProblemError({
          code: 'not_acceptable',
          detail: 'This endpoint requires Accept: text/event-stream.',
          status: 406,
        });
      }
      assertTrustedBrowserRequest(request, options.allowedOrigin);
      const token = readSessionCookie(request);
      const session = await requireAuthenticatedSession(
        request,
        reply,
        options.authService,
        options.cookieSecure,
        false,
      );
      await options.authService.enforceRateLimit(
        'realtime.handshake.owner',
        session.user.id,
        30,
        60,
      );
      if (!token) throw new Error('Authenticated realtime request has no session token.');

      const raw = reply.raw;
      const subscriptionId = options.hub.subscribe({
        expiresAt: session.expiresAt,
        ipAddress: request.ip,
        ownerId: session.user.id,
        sessionId: session.sessionId,
        transport: transport(raw),
        validateSession: async () => {
          const current = await options.authService.getSession(token, false);
          return current?.sessionId === session.sessionId;
        },
      });
      reply.hijack();
      raw.writeHead(200, {
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
        Pragma: 'no-cache',
        'X-Accel-Buffering': 'no',
        'X-Request-Id': request.id,
      });
      raw.flushHeaders();
      options.hub.start(subscriptionId);
      request.raw.once('aborted', () => options.hub.close(subscriptionId));
      return reply;
    },
  );
}
