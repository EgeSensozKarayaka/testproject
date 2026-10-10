import { openApiOperations } from '@site-monitor/contracts/openapi';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  parseResourceVersion,
  requireAuthenticatedSession,
  requireCsrf,
  resourceEtag,
} from './authenticated-request.js';
import type { AuthServicePort } from './auth-routes.js';
import { assertTrustedBrowserRequest } from './browser-security.js';
import type {
  NotificationPolicyWriteDto,
  NotificationServicePort,
} from './notification-service.js';

export interface NotificationRoutesOptions {
  allowedOrigin: string;
  authService: AuthServicePort;
  cookieSecure: boolean;
  notificationService: NotificationServicePort;
}

function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
}

async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  options: NotificationRoutesOptions,
  csrfRequired = false,
) {
  const session = await requireAuthenticatedSession(
    request,
    reply,
    options.authService,
    options.cookieSecure,
  );
  if (csrfRequired) requireCsrf(request, session, options.authService);
  await options.authService.enforceRateLimit('notifications.owner', session.user.id, 240, 60);
  return session;
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  options: NotificationRoutesOptions,
): void {
  app.addHook('onRequest', (request, _reply, done) => {
    try {
      if (['POST', 'PUT', 'DELETE'].includes(request.method)) {
        assertTrustedBrowserRequest(request, options.allowedOrigin);
      }
      done();
    } catch (error) {
      done(error as Error);
    }
  });

  app.get(
    openApiOperations.listNotificationRecipients.path,
    { schema: openApiOperations.listNotificationRecipients.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options);
      const query = request.query as { cursor?: string; limit?: number };
      const page = await options.notificationService.listRecipients(session.user.id, {
        ...(query.cursor ? { cursor: query.cursor } : {}),
        limit: query.limit ?? 50,
      });
      noStore(reply);
      return page;
    },
  );

  app.post(
    openApiOperations.createNotificationRecipient.path,
    { schema: openApiOperations.createNotificationRecipient.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      const recipient = await options.notificationService.createRecipient(
        session.user.id,
        (request.body as { email: string }).email,
        String(request.headers['idempotency-key']),
        request.id,
      );
      reply.header('Location', `/api/v1/notification-recipients/${recipient.id}`);
      reply.header('ETag', resourceEtag(recipient.resource_version));
      noStore(reply);
      return reply.code(201).send(recipient);
    },
  );

  app.delete(
    openApiOperations.deleteNotificationRecipient.path,
    { schema: openApiOperations.deleteNotificationRecipient.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      await options.notificationService.deleteRecipient(
        session.user.id,
        (request.params as { recipient_id: string }).recipient_id,
        parseResourceVersion(request.headers['if-match']),
        request.id,
      );
      noStore(reply);
      return reply.code(204).send();
    },
  );

  app.post(
    openApiOperations.resendNotificationRecipientVerification.path,
    { schema: openApiOperations.resendNotificationRecipientVerification.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      await options.notificationService.resendRecipientVerification(
        session.user.id,
        (request.params as { recipient_id: string }).recipient_id,
        String(request.headers['idempotency-key']),
      );
      noStore(reply);
      return reply.code(202).send({ accepted: true });
    },
  );

  app.post(
    openApiOperations.sendNotificationRecipientTestEmail.path,
    { schema: openApiOperations.sendNotificationRecipientTestEmail.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      await options.notificationService.sendTestEmail(
        session.user.id,
        (request.params as { recipient_id: string }).recipient_id,
        String(request.headers['idempotency-key']),
      );
      noStore(reply);
      return reply.code(202).send({ accepted: true });
    },
  );

  app.post(
    openApiOperations.confirmNotificationRecipientVerification.path,
    { schema: openApiOperations.confirmNotificationRecipientVerification.routeSchema },
    async (request, reply) => {
      await options.authService.enforceRateLimit(
        'notifications.confirm.network',
        request.ip,
        30,
        60,
      );
      await options.notificationService.confirmRecipient(
        (request.body as { token: string }).token,
        request.id,
      );
      noStore(reply);
      return reply.code(204).send();
    },
  );

  app.get(
    openApiOperations.getDefaultNotificationPolicy.path,
    { schema: openApiOperations.getDefaultNotificationPolicy.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options);
      const policy = await options.notificationService.getDefaultPolicy(session.user.id);
      reply.header('ETag', resourceEtag(policy.resource_version));
      noStore(reply);
      return policy;
    },
  );

  app.put(
    openApiOperations.replaceDefaultNotificationPolicy.path,
    { schema: openApiOperations.replaceDefaultNotificationPolicy.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      const policy = await options.notificationService.replaceDefaultPolicy(
        session.user.id,
        parseResourceVersion(request.headers['if-match']),
        request.body as NotificationPolicyWriteDto,
        request.id,
      );
      reply.header('ETag', resourceEtag(policy.resource_version));
      noStore(reply);
      return policy;
    },
  );

  app.get(
    openApiOperations.getGroupNotificationPolicy.path,
    { schema: openApiOperations.getGroupNotificationPolicy.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options);
      const policy = await options.notificationService.getGroupPolicy(
        session.user.id,
        (request.params as { group_id: string }).group_id,
      );
      reply.header('ETag', resourceEtag(policy.resource_version));
      noStore(reply);
      return policy;
    },
  );

  app.put(
    openApiOperations.replaceGroupNotificationPolicy.path,
    { schema: openApiOperations.replaceGroupNotificationPolicy.routeSchema },
    async (request, reply) => {
      const session = await authorize(request, reply, options, true);
      const policy = await options.notificationService.replaceGroupPolicy(
        session.user.id,
        (request.params as { group_id: string }).group_id,
        parseResourceVersion(request.headers['if-match']),
        request.body as NotificationPolicyWriteDto,
        request.id,
      );
      reply.header('ETag', resourceEtag(policy.resource_version));
      noStore(reply);
      return policy;
    },
  );
}
