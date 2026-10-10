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
import type { GroupServicePort } from './group-service.js';

export interface GroupRoutesOptions {
  allowedOrigin: string;
  authService: AuthServicePort;
  cookieSecure: boolean;
  groupService: GroupServicePort;
}

function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
}

async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  options: GroupRoutesOptions,
  csrfRequired = false,
) {
  const session = await requireAuthenticatedSession(
    request,
    reply,
    options.authService,
    options.cookieSecure,
  );
  if (csrfRequired) requireCsrf(request, session, options.authService);
  await options.authService.enforceRateLimit('groups.owner', session.user.id, 240, 60);
  return session;
}

export function registerGroupRoutes(app: FastifyInstance, options: GroupRoutesOptions): void {
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
    openApiOperations.listGroups.path,
    { schema: openApiOperations.listGroups.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options);
      const query = request.query as { cursor?: string; limit?: number };
      const page = await options.groupService.list(session.user.id, {
        ...(query.cursor ? { cursor: query.cursor } : {}),
        limit: query.limit ?? 50,
      });
      noStore(reply);
      return page;
    },
  );

  app.post(
    openApiOperations.createGroup.path,
    { schema: openApiOperations.createGroup.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      const body = request.body as { description?: string | null; name: string };
      const result = await options.groupService.create(
        session.user.id,
        body,
        String(request.headers['idempotency-key']),
        request.id,
      );
      reply.header('Location', `/api/v1/groups/${result.group.id}`);
      reply.header('ETag', resourceEtag(result.group.resource_version));
      noStore(reply);
      return reply.code(201).send(result.group);
    },
  );

  app.get(
    openApiOperations.getGroup.path,
    { schema: openApiOperations.getGroup.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options);
      const group = await options.groupService.get(
        session.user.id,
        (request.params as { group_id: string }).group_id,
      );
      reply.header('ETag', resourceEtag(group.resource_version));
      noStore(reply);
      return group;
    },
  );

  app.patch(
    openApiOperations.updateGroup.path,
    { schema: openApiOperations.updateGroup.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      const group = await options.groupService.update(
        session.user.id,
        (request.params as { group_id: string }).group_id,
        parseResourceVersion(request.headers['if-match']),
        request.body as { description?: string | null; name?: string },
        request.id,
      );
      reply.header('ETag', resourceEtag(group.resource_version));
      noStore(reply);
      return group;
    },
  );

  app.delete(
    openApiOperations.deleteGroup.path,
    { schema: openApiOperations.deleteGroup.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      await options.groupService.delete(
        session.user.id,
        (request.params as { group_id: string }).group_id,
        parseResourceVersion(request.headers['if-match']),
        request.id,
      );
      noStore(reply);
      return reply.code(204).send();
    },
  );
}
