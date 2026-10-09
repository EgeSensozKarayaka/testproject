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
  issues?: ValidationIssue[];
  retryAfterSeconds?: number;
  retryable?: boolean;
  status: number;
}

export class ApiProblemError extends Error {
  readonly code: ProblemCode;
  readonly issues: ValidationIssue[] | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly retryable: boolean;
  readonly status: number;

  constructor(options: ApiProblemOptions) {
    super(options.detail);
    this.name = 'ApiProblemError';
    this.code = options.code;
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
    return new ApiProblemError({
      code: 'validation_failed',
      detail: 'One or more fields are invalid.',
      issues: validationIssues(fastifyError),
      status: 422,
    });
  }
  if (fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
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
  app.setNotFoundHandler((request, reply) => {
    const error = new ApiProblemError({
      code: 'resource_not_found',
      detail: 'The requested resource was not found.',
      status: 404,
    });
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
    return reply
      .code(error.status)
      .type('application/problem+json')
      .send(createProblemDetails(request, error));
  });
}
