import { createHash } from 'node:crypto';

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
import type { PublicComponentWriteDto, PublicPageServicePort } from './public-page-service.js';

export interface PublicPageRoutesOptions {
  allowedOrigin: string;
  authService: AuthServicePort;
  cookieSecure: boolean;
  publicPageService: PublicPageServicePort;
}

async function owner(
  request: FastifyRequest,
  reply: FastifyReply,
  options: PublicPageRoutesOptions,
  csrf = false,
) {
  const session = await requireAuthenticatedSession(
    request,
    reply,
    options.authService,
    options.cookieSecure,
  );
  if (csrf) requireCsrf(request, session, options.authService);
  await options.authService.enforceRateLimit('public-pages.owner', session.user.id, 120, 60);
  return session.user.id;
}

function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
}

export function registerPublicPageRoutes(
  app: FastifyInstance,
  options: PublicPageRoutesOptions,
): void {
  app.addHook('onRequest', (request, _reply, done) => {
    try {
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
        assertTrustedBrowserRequest(request, options.allowedOrigin);
      }
      done();
    } catch (error) {
      done(error as Error);
    }
  });

  app.get(
    openApiOperations.listPublicPages.path,
    { schema: openApiOperations.listPublicPages.routeSchema },
    async (request, reply) => {
      const ownerId = await owner(request, reply, options);
      noStore(reply);
      return options.publicPageService.list(ownerId);
    },
  );

  app.post(
    openApiOperations.createPublicPage.path,
    { schema: openApiOperations.createPublicPage.routeSchema },
    async (request, reply) => {
      const ownerId = await owner(request, reply, options, true);
      const page = await options.publicPageService.create(
        ownerId,
        request.body as { description?: string | null; title: string },
      );
      reply.header('Location', `/api/v1/public-pages/${page.id}`);
      reply.header('ETag', resourceEtag(page.resource_version));
      noStore(reply);
      return reply.code(201).send(page);
    },
  );

  app.get(
    openApiOperations.getPublicPage.path,
    { schema: openApiOperations.getPublicPage.routeSchema },
    async (request, reply) => {
      const ownerId = await owner(request, reply, options);
      const page = await options.publicPageService.get(
        ownerId,
        (request.params as { page_id: string }).page_id,
      );
      reply.header('ETag', resourceEtag(page.resource_version));
      noStore(reply);
      return page;
    },
  );

  app.patch(
    openApiOperations.updatePublicPage.path,
    { schema: openApiOperations.updatePublicPage.routeSchema },
    async (request, reply) => {
      const ownerId = await owner(request, reply, options, true);
      const page = await options.publicPageService.update(
        ownerId,
        (request.params as { page_id: string }).page_id,
        parseResourceVersion(request.headers['if-match']),
        request.body as { description?: string | null; title?: string },
      );
      reply.header('ETag', resourceEtag(page.resource_version));
      noStore(reply);
      return page;
    },
  );

  app.delete(
    openApiOperations.deletePublicPage.path,
    { schema: openApiOperations.deletePublicPage.routeSchema },
    async (request, reply) => {
      const ownerId = await owner(request, reply, options, true);
      await options.publicPageService.delete(
        ownerId,
        (request.params as { page_id: string }).page_id,
        parseResourceVersion(request.headers['if-match']),
      );
      noStore(reply);
      return reply.code(204).send();
    },
  );

  app.put(
    openApiOperations.replacePublicPageComponents.path,
    { schema: openApiOperations.replacePublicPageComponents.routeSchema },
    async (request, reply) => {
      const ownerId = await owner(request, reply, options, true);
      const page = await options.publicPageService.replaceComponents(
        ownerId,
        (request.params as { page_id: string }).page_id,
        parseResourceVersion(request.headers['if-match']),
        (request.body as { items: PublicComponentWriteDto[] }).items,
      );
      reply.header('ETag', resourceEtag(page.resource_version));
      noStore(reply);
      return page;
    },
  );

  for (const [operation, action] of [
    [openApiOperations.publishPublicPage, 'publish'],
    [openApiOperations.rotatePublicPageLink, 'rotateLink'],
  ] as const) {
    app.post(operation.path, { schema: operation.routeSchema }, async (request, reply) => {
      const ownerId = await owner(request, reply, options, true);
      const result = await options.publicPageService[action](
        ownerId,
        (request.params as { page_id: string }).page_id,
        parseResourceVersion(request.headers['if-match']),
      );
      reply.header('ETag', resourceEtag(result.page.resource_version));
      noStore(reply);
      return result;
    });
  }

  app.post(
    openApiOperations.disablePublicPage.path,
    { schema: openApiOperations.disablePublicPage.routeSchema },
    async (request, reply) => {
      const ownerId = await owner(request, reply, options, true);
      const page = await options.publicPageService.disable(
        ownerId,
        (request.params as { page_id: string }).page_id,
        parseResourceVersion(request.headers['if-match']),
      );
      reply.header('ETag', resourceEtag(page.resource_version));
      noStore(reply);
      return page;
    },
  );

  app.get(
    openApiOperations.getPublicStatusPage.path,
    { schema: openApiOperations.getPublicStatusPage.routeSchema },
    async (request, reply) => {
      await options.authService.enforceRateLimit('public-pages.network', request.ip, 240, 60);
      const snapshot = await options.publicPageService.getPublic(
        (request.params as { public_token: string }).public_token,
      );
      const etag = `"ps-${createHash('sha256').update(JSON.stringify(snapshot)).digest('base64url')}"`;
      reply.header('ETag', etag).header('Cache-Control', 'public, max-age=5');
      if (request.headers['if-none-match'] === etag) return reply.code(304).send();
      return snapshot;
    },
  );
}
