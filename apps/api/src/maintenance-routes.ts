import { openApiOperations } from '@site-monitor/contracts/openapi';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  requireAuthenticatedSession,
  requireCsrf,
  parseResourceVersion,
  resourceEtag,
} from './authenticated-request.js';
import type { AuthServicePort } from './auth-routes.js';
import { assertTrustedBrowserRequest } from './browser-security.js';
import type {
  MaintenanceCreateInput,
  MaintenanceListInput,
  MaintenancePatchInput,
  MaintenanceServicePort,
} from './maintenance-service.js';

export interface MaintenanceRoutesOptions {
  allowedOrigin: string;
  authService: AuthServicePort;
  cookieSecure: boolean;
  maintenanceService: MaintenanceServicePort;
}

function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
}

async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  options: MaintenanceRoutesOptions,
  csrfRequired = false,
) {
  const session = await requireAuthenticatedSession(
    request,
    reply,
    options.authService,
    options.cookieSecure,
  );
  if (csrfRequired) requireCsrf(request, session, options.authService);
  await options.authService.enforceRateLimit('maintenance.owner', session.user.id, 240, 60);
  return session;
}

export function registerMaintenanceRoutes(
  app: FastifyInstance,
  options: MaintenanceRoutesOptions,
): void {
  app.addHook('onRequest', (request, _reply, done) => {
    try {
      if (['POST', 'PATCH', 'DELETE'].includes(request.method)) {
        assertTrustedBrowserRequest(request, options.allowedOrigin);
      }
      done();
    } catch (error) {
      done(error as Error);
    }
  });

  app.get(
    openApiOperations.listMaintenanceWindows.path,
    { schema: openApiOperations.listMaintenanceWindows.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options);
      const query = request.query as {
        check_id?: string;
        cursor?: string;
        ends_after?: string;
        group_id?: string;
        limit?: number;
        starts_before?: string;
        state?: MaintenanceListInput['state'];
      };
      const page = await options.maintenanceService.list(session.user.id, {
        ...(query.check_id ? { checkId: query.check_id } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.ends_after ? { endsAfter: query.ends_after } : {}),
        ...(query.group_id ? { groupId: query.group_id } : {}),
        limit: query.limit ?? 50,
        ...(query.starts_before ? { startsBefore: query.starts_before } : {}),
        ...(query.state ? { state: query.state } : {}),
      });
      noStore(reply);
      return page;
    },
  );

  app.post(
    openApiOperations.createMaintenanceWindow.path,
    { schema: openApiOperations.createMaintenanceWindow.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      const result = await options.maintenanceService.create(
        session.user.id,
        request.body as MaintenanceCreateInput,
        String(request.headers['idempotency-key']),
        request.id,
      );
      reply.header('Location', `/api/v1/maintenance-windows/${result.window.id}`);
      reply.header('ETag', resourceEtag(result.window.resource_version));
      noStore(reply);
      return reply.code(201).send(result.window);
    },
  );

  app.get(
    openApiOperations.getMaintenanceWindow.path,
    { schema: openApiOperations.getMaintenanceWindow.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options);
      const window = await options.maintenanceService.get(
        session.user.id,
        (request.params as { window_id: string }).window_id,
      );
      reply.header('ETag', resourceEtag(window.resource_version));
      noStore(reply);
      return window;
    },
  );

  app.patch(
    openApiOperations.updateMaintenanceWindow.path,
    { schema: openApiOperations.updateMaintenanceWindow.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      const window = await options.maintenanceService.update(
        session.user.id,
        (request.params as { window_id: string }).window_id,
        parseResourceVersion(request.headers['if-match']),
        request.body as MaintenancePatchInput,
        request.id,
      );
      reply.header('ETag', resourceEtag(window.resource_version));
      noStore(reply);
      return window;
    },
  );

  app.delete(
    openApiOperations.cancelMaintenanceWindow.path,
    { schema: openApiOperations.cancelMaintenanceWindow.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      await options.maintenanceService.cancel(
        session.user.id,
        (request.params as { window_id: string }).window_id,
        parseResourceVersion(request.headers['if-match']),
        request.id,
      );
      noStore(reply);
      return reply.code(204).send();
    },
  );
}
