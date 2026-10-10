import { openApiOperations } from '@site-monitor/contracts/openapi';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { AuthenticatedSession, AuthService } from './auth-service.js';
import {
  assertTrustedBrowserRequest,
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from './browser-security.js';
import { ApiProblemError } from './problem.js';

export interface AuthRoutesOptions {
  allowedOrigin: string;
  authService: AuthServicePort;
  cookieSecure: boolean;
}

export type AuthServicePort = Pick<
  AuthService,
  | 'confirmEmail'
  | 'confirmPasswordReset'
  | 'enforceRateLimit'
  | 'getSession'
  | 'login'
  | 'logout'
  | 'register'
  | 'requestChallenge'
  | 'runAnonymousIdempotent'
  | 'updateProfile'
  | 'verifyCsrf'
>;

function networkScope(request: FastifyRequest): string {
  return request.ip;
}

function responseBody(session: AuthenticatedSession) {
  return {
    csrf_token: session.csrfToken,
    expires_at: session.expiresAt,
    user: session.user,
  };
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions) {
  app.addHook('onRequest', (request, _reply, done) => {
    try {
      if (
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
        request.url.startsWith('/api/v1/')
      ) {
        assertTrustedBrowserRequest(request, options.allowedOrigin);
      }
      done();
    } catch (error) {
      done(error as Error);
    }
  });

  app.post(
    openApiOperations.register.path,
    { schema: openApiOperations.register.routeSchema },
    async (request, reply) => {
      const body = request.body as { display_name: string; email: string; password: string };
      await options.authService.runAnonymousIdempotent(
        {
          body,
          key: String(request.headers['idempotency-key']),
          operation: 'auth.register',
          subject: body.email,
        },
        async () =>
          options.authService.register({
            displayName: body.display_name,
            email: body.email,
            networkScope: networkScope(request),
            password: body.password,
          }),
      );
      return reply.code(202).send({ accepted: true });
    },
  );

  app.get(
    openApiOperations.getMe.path,
    { schema: openApiOperations.getMe.routeSchema },
    async (request, reply) => {
      const token = readSessionCookie(request);
      const session = token ? await options.authService.getSession(token) : null;
      if (!session) {
        clearSessionCookie(reply, options.cookieSecure);
        throw new ApiProblemError({
          code: 'authentication_required',
          detail: 'A valid session is required.',
          status: 401,
        });
      }
      if (session.tokenReplacement)
        setSessionCookie(reply, session.tokenReplacement, options.cookieSecure);
      reply.header('ETag', `"rv-${session.user.resource_version}"`);
      reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
      return session.user;
    },
  );

  app.patch(
    openApiOperations.updateMe.path,
    { schema: openApiOperations.updateMe.routeSchema },
    async (request, reply) => {
      const token = readSessionCookie(request);
      if (!token) {
        clearSessionCookie(reply, options.cookieSecure);
        throw new ApiProblemError({
          code: 'authentication_required',
          detail: 'A valid session is required.',
          status: 401,
        });
      }
      const ifMatch = request.headers['if-match'];
      const csrfToken = request.headers['x-csrf-token'];
      if (typeof ifMatch !== 'string' || typeof csrfToken !== 'string') {
        throw new ApiProblemError({
          code: 'precondition_required',
          detail: 'A current If-Match resource version is required.',
          status: 428,
        });
      }
      const user = await options.authService.updateProfile({
        csrfToken,
        displayName: (request.body as { display_name: string }).display_name,
        expectedVersion: ifMatch.slice(4, -1),
        token,
      });
      reply.header('ETag', `"rv-${user.resource_version}"`);
      reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
      return user;
    },
  );

  app.post(
    openApiOperations.login.path,
    { schema: openApiOperations.login.routeSchema },
    async (request, reply) => {
      const body = request.body as { email: string; password: string };
      const result = await options.authService.login({
        email: body.email,
        networkScope: networkScope(request),
        password: body.password,
      });
      setSessionCookie(reply, result.token, options.cookieSecure);
      reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
      return responseBody(result.session);
    },
  );

  app.get(
    openApiOperations.getSession.path,
    { schema: openApiOperations.getSession.routeSchema },
    async (request, reply) => {
      const token = readSessionCookie(request);
      const session = token ? await options.authService.getSession(token) : null;
      if (!session) {
        clearSessionCookie(reply, options.cookieSecure);
        throw new ApiProblemError({
          code: 'authentication_required',
          detail: 'A valid session is required.',
          status: 401,
        });
      }
      if (session.tokenReplacement)
        setSessionCookie(reply, session.tokenReplacement, options.cookieSecure);
      reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
      return responseBody(session);
    },
  );

  app.post(
    openApiOperations.logout.path,
    { schema: openApiOperations.logout.routeSchema },
    async (request, reply) => {
      const token = readSessionCookie(request);
      if (token) {
        const session = await options.authService.getSession(token, false);
        if (session) {
          const csrf = request.headers['x-csrf-token'];
          if (
            typeof csrf !== 'string' ||
            !options.authService.verifyCsrf(csrf, session.sessionId)
          ) {
            throw new ApiProblemError({
              code: 'csrf_failed',
              detail: 'The CSRF token is invalid.',
              status: 403,
            });
          }
          await options.authService.logout(token);
        }
      }
      clearSessionCookie(reply, options.cookieSecure);
      return reply.code(204).send();
    },
  );

  app.post(
    openApiOperations.requestEmailVerification.path,
    { schema: openApiOperations.requestEmailVerification.routeSchema },
    async (request, reply) => {
      const body = request.body as { email: string };
      await options.authService.runAnonymousIdempotent(
        {
          body,
          key: String(request.headers['idempotency-key']),
          operation: 'auth.verify.request',
          subject: body.email,
        },
        async () =>
          options.authService.requestChallenge({
            email: body.email,
            networkScope: networkScope(request),
            purpose: 'VERIFY_ACCOUNT_EMAIL',
          }),
      );
      return reply.code(202).send({ accepted: true });
    },
  );

  app.post(
    openApiOperations.confirmEmailVerification.path,
    { schema: openApiOperations.confirmEmailVerification.routeSchema },
    async (request, reply) => {
      await options.authService.confirmEmail(
        (request.body as { token: string }).token,
        networkScope(request),
      );
      return reply.code(204).send();
    },
  );

  app.post(
    openApiOperations.requestPasswordReset.path,
    { schema: openApiOperations.requestPasswordReset.routeSchema },
    async (request, reply) => {
      const body = request.body as { email: string };
      await options.authService.runAnonymousIdempotent(
        {
          body,
          key: String(request.headers['idempotency-key']),
          operation: 'auth.reset.request',
          subject: body.email,
        },
        async () =>
          options.authService.requestChallenge({
            email: body.email,
            networkScope: networkScope(request),
            purpose: 'RESET_PASSWORD',
          }),
      );
      return reply.code(202).send({ accepted: true });
    },
  );

  app.post(
    openApiOperations.confirmPasswordReset.path,
    { schema: openApiOperations.confirmPasswordReset.routeSchema },
    async (request, reply) => {
      const body = request.body as { password: string; token: string };
      await options.authService.confirmPasswordReset(
        body.token,
        body.password,
        networkScope(request),
      );
      return reply.code(204).send();
    },
  );
}
