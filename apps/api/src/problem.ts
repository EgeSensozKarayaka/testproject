import {
  problemDetailsSchema,
  type ProblemCode,
  type ProblemDetails,
  type ValidationIssue,
} from '@site-monitor/contracts';
import type { FastifyError, FastifyInstance, FastifyRequest } from 'fastify';

const PROBLEM_TYPE_BASE = 'https://status-monitor.example/problems';

const PROBLEM_TITLES: Record<ProblemCode, string> = {
  authentication_required: 'Authentication required',
  csrf_failed: 'CSRF validation failed',
  dependency_unavailable: 'Dependency unavailable',
  idempotency_in_progress: 'Idempotent operation in progress',
  idempotency_key_reused: 'Idempotency key reused',
  internal_error: 'Internal server error',
  invalid_credentials: 'Invalid credentials',
  invalid_or_expired_token: 'Invalid or expired token',
  invalid_cursor: 'Invalid cursor',
  invalid_precondition: 'Invalid precondition',
  invalid_request: 'Invalid request',
  invalid_state_transition: 'Invalid state transition',
  malformed_json: 'Malformed JSON',
  method_not_allowed: 'Method not allowed',
  not_acceptable: 'Not acceptable',
  operation_forbidden: 'Operation forbidden',
  payload_too_large: 'Payload too large',
  precondition_required: 'Precondition required',
  public_page_not_found: 'Public page not found',
  quota_exceeded: 'Quota exceeded',
  rate_limit_exceeded: 'Rate limit exceeded',
  resource_conflict: 'Resource conflict',
  resource_not_found: 'Resource not found',
  resource_version_mismatch: 'Resource version mismatch',
  schema_incompatible: 'Schema incompatible',
  unsupported_media_type: 'Unsupported media type',
  unprocessable_configuration: 'Unprocessable configuration',
  validation_failed: 'Request validation failed',
};

export interface ApiProblemOptions {
  code: ProblemCode;
  detail: string;
  etag?: string;
  issues?: ValidationIssue[];
  retryAfterSeconds?: number;
  retryable?: boolean;
  status: number;
}

export class ApiProblemError extends Error {
  readonly code: ProblemCode;
  readonly issues: ValidationIssue[] | undefined;
  readonly etag: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly retryable: boolean;
  readonly status: number;

  constructor(options: ApiProblemOptions) {
    super(options.detail);
    this.name = 'ApiProblemError';
    this.code = options.code;
    this.etag = options.etag;
    this.issues = options.issues;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

function publicSafeInstance(url: string): string {
  const path = url.split('?', 1)[0] || '/';
  return path.replace(/^(\/api\/public\/v1\/status-pages\/)[^/]+/, '$1{redacted}');
}

function routeMatcher(url: string): RegExp {
  const pattern = url
    .split('/')
    .map((segment) => {
      if (segment === '*') return '.*';
      if (segment.startsWith(':')) return '[^/]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${pattern}/?$`);
}

function validationIssues(error: FastifyError): ValidationIssue[] {
  return (error.validation ?? [])
    .map((item) => {
      const candidate = item.params?.missingProperty;
      const missingProperty = typeof candidate === 'string' ? candidate : undefined;
      const base = item.instancePath || '';
      const pointer = missingProperty
        ? `${base}/${missingProperty.replaceAll('~', '~0').replaceAll('/', '~1')}`
        : base || '/';
      return {
        code: item.keyword === 'additionalProperties' ? 'unknown_field' : 'invalid_value',
        message:
          item.keyword === 'additionalProperties'
            ? 'The request contains an unknown field.'
            : 'The field value is invalid.',
        pointer,
      };
    })
    .sort((left, right) =>
      left.pointer === right.pointer
        ? left.code.localeCompare(right.code)
        : left.pointer.localeCompare(right.pointer),
    );
}

function normalizeError(error: unknown): ApiProblemError {
  if (error instanceof ApiProblemError) return error;
  if (!(error instanceof Error)) {
    return new ApiProblemError({
      code: 'internal_error',
      detail: 'The server could not complete the request.',
      status: 500,
    });
  }
  const fastifyError = error as FastifyError;
  if (fastifyError.validation) {
    const missingIfMatch = fastifyError.validation.some(
      (item) =>
        item.keyword === 'required' &&
        String(item.params?.missingProperty).toLowerCase() === 'if-match',
    );
    if (missingIfMatch) {
      return new ApiProblemError({
        code: 'precondition_required',
        detail: 'A current If-Match resource version is required.',
        status: 428,
      });
    }
    const invalidIfMatch = fastifyError.validation.some(
      (item) =>
        item.instancePath.toLowerCase() === '/if-match' ||
        item.schemaPath.toLowerCase().includes('if-match'),
    );
    if (invalidIfMatch) {
      return new ApiProblemError({
        code: 'invalid_precondition',
        detail: 'If-Match must contain one valid strong resource ETag.',
        status: 400,
      });
    }
    return new ApiProblemError({
      code: 'validation_failed',
      detail: 'One or more fields are invalid.',
      issues: validationIssues(fastifyError),
      status: 422,
    });
  }
  if (
    fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
    fastifyError.code === 'FST_ERR_CTP_EMPTY_JSON_BODY'
  ) {
    return new ApiProblemError({
      code: 'malformed_json',
      detail: 'The request body is not valid JSON.',
      status: 400,
    });
  }
  if (fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return new ApiProblemError({
      code: 'payload_too_large',
      detail: 'The request body exceeds the allowed size.',
      status: 413,
    });
  }
  if (fastifyError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return new ApiProblemError({
      code: 'unsupported_media_type',
      detail: 'The request media type is not supported.',
      status: 415,
    });
  }
  return new ApiProblemError({
    code: 'internal_error',
    detail: 'The server could not complete the request.',
    status: 500,
  });
}

export function createProblemDetails(
  request: FastifyRequest,
  error: ApiProblemError,
): ProblemDetails {
  return problemDetailsSchema.parse({
    code: error.code,
    detail: error.message,
    ...(error.issues && error.issues.length > 0 ? { errors: error.issues } : {}),
    instance: publicSafeInstance(request.raw.url ?? request.url),
    request_id: request.id,
    ...(error.retryAfterSeconds === undefined
      ? {}
      : { retry_after_seconds: error.retryAfterSeconds }),
    retryable: error.retryable,
    status: error.status,
    title: PROBLEM_TITLES[error.code],
    type: `${PROBLEM_TYPE_BASE}/${error.code.replaceAll('_', '-')}`,
  });
}

export function installProblemHandling(app: FastifyInstance): void {
  const registeredRoutes: { matcher: RegExp; methods: Set<string> }[] = [];
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    registeredRoutes.push({
      matcher: routeMatcher(route.url),
      methods: new Set(methods.map((method) => method.toUpperCase())),
    });
  });

  app.setNotFoundHandler((request, reply) => {
    const requestPath = (request.raw.url ?? request.url).split('?', 1)[0] || '/';
    const allowedMethods = new Set(
      registeredRoutes
        .filter((route) => route.matcher.test(requestPath))
        .flatMap((route) => [...route.methods]),
    );
    // CORS installs a wildcard OPTIONS route; it must not make every unknown path look real.
    allowedMethods.delete('OPTIONS');
    const methodNotAllowed = allowedMethods.size > 0;
    const error = new ApiProblemError({
      code: methodNotAllowed ? 'method_not_allowed' : 'resource_not_found',
      detail: methodNotAllowed
        ? 'The requested method is not supported for this resource.'
        : 'The requested resource was not found.',
      status: methodNotAllowed ? 405 : 404,
    });
    if (methodNotAllowed) reply.header('Allow', [...allowedMethods].sort().join(', '));
    return reply
      .code(error.status)
      .type('application/problem+json')
      .send(createProblemDetails(request, error));
  });

  app.setErrorHandler((originalError, request, reply) => {
    const error = normalizeError(originalError);
    if (error.status >= 500) {
      request.log.error(
        { err: originalError, problem_code: error.code, request_id: request.id },
        'request failed',
      );
    }
    if (error.retryAfterSeconds !== undefined) {
      reply.header('Retry-After', String(error.retryAfterSeconds));
    }
    if (error.etag !== undefined) reply.header('ETag', error.etag);
    return reply
      .code(error.status)
      .type('application/problem+json')
      .send(createProblemDetails(request, error));
  });
}
