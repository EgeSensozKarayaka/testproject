import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AuthenticatedSession } from './auth-service.js';
import type { AuthServicePort } from './auth-routes.js';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './browser-security.js';
import { ApiProblemError } from './problem.js';

export async function requireAuthenticatedSession(
  request: FastifyRequest,
  reply: FastifyReply,
  authService: Pick<AuthServicePort, 'getSession'>,
  cookieSecure: boolean,
): Promise<AuthenticatedSession> {
  const token = readSessionCookie(request);
  const session = token ? await authService.getSession(token) : null;
  if (!session) {
    clearSessionCookie(reply, cookieSecure);
    throw new ApiProblemError({
      code: 'authentication_required',
      detail: 'A valid session is required.',
      status: 401,
    });
  }
  if (session.tokenReplacement) {
    setSessionCookie(reply, session.tokenReplacement, cookieSecure);
  }
  return session;
}

export function requireCsrf(
  request: FastifyRequest,
  session: AuthenticatedSession,
  authService: Pick<AuthServicePort, 'verifyCsrf'>,
): void {
  const csrf = request.headers['x-csrf-token'];
  if (typeof csrf !== 'string' || !authService.verifyCsrf(csrf, session.sessionId)) {
    throw new ApiProblemError({
      code: 'csrf_failed',
      detail: 'The CSRF token is invalid.',
      status: 403,
    });
  }
}

export function parseResourceVersion(value: string | string[] | undefined): string {
  if (value === undefined) {
    throw new ApiProblemError({
      code: 'precondition_required',
      detail: 'A current If-Match resource version is required.',
      status: 428,
    });
  }
  if (typeof value !== 'string') {
    throw new ApiProblemError({
      code: 'invalid_precondition',
      detail: 'If-Match must contain exactly one strong resource ETag.',
      status: 400,
    });
  }
  const match = /^"rv-([1-9][0-9]*)"$/u.exec(value);
  if (!match) {
    throw new ApiProblemError({
      code: 'invalid_precondition',
      detail: 'If-Match must be a strong resource ETag such as "rv-1".',
      status: 400,
    });
  }
  return match[1]!;
}

export function resourceEtag(resourceVersion: string): string {
  return `"rv-${resourceVersion}"`;
}
