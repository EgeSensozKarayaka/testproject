import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiProblemError } from './problem.js';

export const SESSION_COOKIE = 'site_monitor_session';

export function readSessionCookie(request: FastifyRequest): string | undefined {
  for (const item of request.headers.cookie?.split(';') ?? []) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
    sameSite: 'strict',
    secure,
  });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    path: '/',
    sameSite: 'strict',
    secure,
  });
}

export function assertTrustedBrowserRequest(request: FastifyRequest, allowedOrigin: string): void {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  const contentLength = Number(request.headers['content-length'] ?? 0);
  const hasBody =
    request.headers['transfer-encoding'] !== undefined ||
    (Number.isFinite(contentLength) && contentLength > 0);
  if (request.method !== 'DELETE' && hasBody && contentType !== 'application/json') {
    throw new ApiProblemError({
      code: 'unsupported_media_type',
      detail: 'Commands require application/json.',
      status: 415,
    });
  }

  const origin = request.headers.origin;
  let trusted = origin === allowedOrigin;
  if (!origin && request.headers.referer) {
    try {
      trusted = new URL(request.headers.referer).origin === allowedOrigin;
    } catch {
      trusted = false;
    }
  }
  const fetchSite = request.headers['sec-fetch-site'];
  if (!trusted || (fetchSite !== undefined && !['same-origin', 'same-site'].includes(fetchSite))) {
    throw new ApiProblemError({
      code: 'csrf_failed',
      detail: 'The request did not originate from the trusted web application.',
      status: 403,
    });
  }
}
