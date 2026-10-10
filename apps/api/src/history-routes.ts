import { openApiOperations } from '@site-monitor/contracts/openapi';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { requireAuthenticatedSession } from './authenticated-request.js';
import type { AuthServicePort } from './auth-routes.js';
import type { HistoryPeriod } from '@site-monitor/domain';
import type { HistoryServicePort, IncidentListInput } from './history-service.js';

export interface HistoryRoutesOptions {
  authService: AuthServicePort;
  cookieSecure: boolean;
  historyService: HistoryServicePort;
}

async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  options: HistoryRoutesOptions,
  scope: 'history.owner' | 'incidents.owner',
) {
  const session = await requireAuthenticatedSession(
    request,
    reply,
    options.authService,
    options.cookieSecure,
  );
  await options.authService.enforceRateLimit(scope, session.user.id, 240, 60);
  return session;
}

function privateHistoryCache(reply: FastifyReply): void {
  reply
    .header('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    .header('Vary', 'Cookie');
}

function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
}

export function registerHistoryRoutes(app: FastifyInstance, options: HistoryRoutesOptions): void {
  app.get(
    openApiOperations.getCheckHistory.path,
    { schema: openApiOperations.getCheckHistory.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, 'history.owner');
      const result = await options.historyService.getHistory(
        session.user.id,
        (request.params as { check_id: string }).check_id,
        (request.query as { period: HistoryPeriod }).period,
      );
      privateHistoryCache(reply);
      return result;
    },
  );

  app.get(
    openApiOperations.listIncidents.path,
    { schema: openApiOperations.listIncidents.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, 'incidents.owner');
      const query = request.query as {
        check_id?: string;
        cursor?: string;
        ended_after?: string;
        group_id?: string;
        limit?: number;
        started_before?: string;
        status?: IncidentListInput['status'];
      };
      const result = await options.historyService.listIncidents(session.user.id, {
        ...(query.check_id ? { checkId: query.check_id } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.ended_after ? { endedAfter: query.ended_after } : {}),
        ...(query.group_id ? { groupId: query.group_id } : {}),
        limit: query.limit ?? 50,
        ...(query.started_before ? { startedBefore: query.started_before } : {}),
        ...(query.status ? { status: query.status } : {}),
      });
      noStore(reply);
      return result;
    },
  );

  app.get(
    openApiOperations.getIncident.path,
    { schema: openApiOperations.getIncident.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, 'incidents.owner');
      const result = await options.historyService.getIncident(
        session.user.id,
        (request.params as { incident_id: string }).incident_id,
      );
      noStore(reply);
      return result;
    },
  );
}
