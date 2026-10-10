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
  CheckCreateInput,
  CheckListInput,
  CheckPatchInput,
  CheckServicePort,
} from './check-service.js';

export interface CheckRoutesOptions {
  allowedOrigin: string;
  authService: AuthServicePort;
  checkService: CheckServicePort;
  cookieSecure: boolean;
}

function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
}

async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  options: CheckRoutesOptions,
  csrfRequired = false,
) {
  const session = await requireAuthenticatedSession(
    request,
    reply,
    options.authService,
    options.cookieSecure,
  );
  if (csrfRequired) requireCsrf(request, session, options.authService);
  await options.authService.enforceRateLimit('checks.owner', session.user.id, 300, 60);
  return session;
}

export function registerCheckRoutes(app: FastifyInstance, options: CheckRoutesOptions): void {
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
    openApiOperations.listChecks.path,
    { schema: openApiOperations.listChecks.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options);
      const query = request.query as {
        cursor?: string;
        execution_state?: CheckListInput['executionState'];
        freshness?: CheckListInput['freshness'];
        group_id?: string;
        health?: CheckListInput['health'];
        limit?: number;
      };
      const page = await options.checkService.list(session.user.id, {
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.execution_state ? { executionState: query.execution_state } : {}),
        ...(query.freshness ? { freshness: query.freshness } : {}),
        ...(query.group_id ? { groupId: query.group_id } : {}),
        ...(query.health ? { health: query.health } : {}),
        limit: query.limit ?? 50,
      });
      noStore(reply);
      return page;
    },
  );

  app.post(
    openApiOperations.createCheck.path,
    { schema: openApiOperations.createCheck.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      const result = await options.checkService.create(
        session.user.id,
        request.body as CheckCreateInput,
        String(request.headers['idempotency-key']),
        request.id,
      );
      reply.header('Location', `/api/v1/checks/${result.check.id}`);
      reply.header('ETag', resourceEtag(result.check.resource_version));
      noStore(reply);
      return reply.code(201).send(result.check);
    },
  );

  app.get(
    openApiOperations.getCheck.path,
    { schema: openApiOperations.getCheck.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options);
      const check = await options.checkService.get(
        session.user.id,
        (request.params as { check_id: string }).check_id,
      );
      reply.header('ETag', resourceEtag(check.resource_version));
      noStore(reply);
      return check;
    },
  );

  app.patch(
    openApiOperations.updateCheck.path,
    { schema: openApiOperations.updateCheck.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      const check = await options.checkService.update(
        session.user.id,
        (request.params as { check_id: string }).check_id,
        parseResourceVersion(request.headers['if-match']),
        request.body as CheckPatchInput,
        request.id,
      );
      reply.header('ETag', resourceEtag(check.resource_version));
      noStore(reply);
      return check;
    },
  );

  app.delete(
    openApiOperations.deleteCheck.path,
    { schema: openApiOperations.deleteCheck.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      await options.checkService.delete(
        session.user.id,
        (request.params as { check_id: string }).check_id,
        parseResourceVersion(request.headers['if-match']),
        request.id,
      );
      noStore(reply);
      return reply.code(204).send();
    },
  );

  app.post(
    openApiOperations.pauseCheck.path,
    { schema: openApiOperations.pauseCheck.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      const check = await options.checkService.pause(
        session.user.id,
        (request.params as { check_id: string }).check_id,
        parseResourceVersion(request.headers['if-match']),
        request.id,
      );
      reply.header('ETag', resourceEtag(check.resource_version));
      noStore(reply);
      return check;
    },
  );

  app.post(
    openApiOperations.resumeCheck.path,
    { schema: openApiOperations.resumeCheck.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      const check = await options.checkService.resume(
        session.user.id,
        (request.params as { check_id: string }).check_id,
        parseResourceVersion(request.headers['if-match']),
        request.id,
      );
      reply.header('ETag', resourceEtag(check.resource_version));
      noStore(reply);
      return check;
    },
  );

  app.post(
    openApiOperations.requestManualRun.path,
    { schema: openApiOperations.requestManualRun.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      const checkId = (request.params as { check_id: string }).check_id;
      await options.authService.enforceRateLimit(
        'checks.manual.check',
        `${session.user.id}:${checkId}`,
        30,
        60,
      );
      const receipt = await options.checkService.requestManualRun(
        session.user.id,
        checkId,
        parseResourceVersion(request.headers['if-match']),
        String(request.headers['idempotency-key']),
        request.id,
      );
      noStore(reply);
      return reply.code(202).send(receipt);
    },
  );
}
