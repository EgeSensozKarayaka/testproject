// Generated from docs/openapi-v1.yaml. Do not edit by hand.

export const openApiOperations = {
  getLiveness: {
    authentication: 'public',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/health/live',
    preconditionRequired: false,
    routeSchema: {
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['service', 'status', 'timestamp', 'version'],
          properties: {
            service: {
              type: 'string',
            },
            status: {
              type: 'string',
              enum: ['ok', 'unavailable'],
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
            version: {
              type: 'string',
              minLength: 1,
            },
          },
        },
      },
    },
  },
  getReadiness: {
    authentication: 'public',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/health/ready',
    preconditionRequired: false,
    routeSchema: {
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['service', 'status', 'timestamp', 'version'],
          properties: {
            service: {
              type: 'string',
            },
            status: {
              type: 'string',
              enum: ['ok', 'unavailable'],
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
            version: {
              type: 'string',
              minLength: 1,
            },
          },
        },
        '503': {
          type: 'object',
          additionalProperties: false,
          required: ['service', 'status', 'timestamp', 'version'],
          properties: {
            service: {
              type: 'string',
            },
            status: {
              type: 'string',
              enum: ['ok', 'unavailable'],
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
            version: {
              type: 'string',
              minLength: 1,
            },
          },
        },
      },
    },
  },
  register: {
    authentication: 'public',
    csrfRequired: false,
    idempotencyRequired: true,
    method: 'POST',
    path: '/api/v1/auth/register',
    preconditionRequired: false,
    routeSchema: {
      headers: {
        type: 'object',
        properties: {
          'Idempotency-Key': {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            pattern: '^[\\x21-\\x7E]+$',
          },
        },
        required: ['Idempotency-Key'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['email', 'password', 'display_name'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            maxLength: 320,
          },
          password: {
            type: 'string',
            minLength: 15,
            maxLength: 128,
          },
          display_name: {
            type: 'string',
            minLength: 1,
            maxLength: 120,
          },
        },
      },
      response: {
        '202': {
          type: 'object',
          additionalProperties: false,
          required: ['accepted'],
          properties: {
            accepted: {
              type: 'boolean',
              const: true,
            },
          },
        },
        '422': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  login: {
    authentication: 'public',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'POST',
    path: '/api/v1/auth/login',
    preconditionRequired: false,
    routeSchema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['email', 'password'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            maxLength: 320,
          },
          password: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
          },
        },
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['user', 'expires_at', 'csrf_token'],
          properties: {
            user: {
              type: 'object',
              additionalProperties: false,
              required: [
                'id',
                'email',
                'display_name',
                'email_verified',
                'resource_version',
                'created_at',
              ],
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                },
                email: {
                  type: 'string',
                  format: 'email',
                },
                display_name: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 120,
                },
                email_verified: {
                  type: 'boolean',
                },
                resource_version: {
                  type: 'string',
                  pattern: '^[0-9]+$',
                },
                created_at: {
                  type: 'string',
                  format: 'date-time',
                },
              },
            },
            expires_at: {
              type: 'string',
              format: 'date-time',
            },
            csrf_token: {
              type: 'string',
              description: 'Session-bound bootstrap value; never logged or persisted by the client',
            },
          },
        },
        '401': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  logout: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'POST',
    path: '/api/v1/auth/logout',
    preconditionRequired: false,
    routeSchema: {
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
        },
        required: ['X-CSRF-Token'],
      },
      response: {
        '403': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  getSession: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/auth/session',
    preconditionRequired: false,
    routeSchema: {
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['user', 'expires_at', 'csrf_token'],
          properties: {
            user: {
              type: 'object',
              additionalProperties: false,
              required: [
                'id',
                'email',
                'display_name',
                'email_verified',
                'resource_version',
                'created_at',
              ],
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                },
                email: {
                  type: 'string',
                  format: 'email',
                },
                display_name: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 120,
                },
                email_verified: {
                  type: 'boolean',
                },
                resource_version: {
                  type: 'string',
                  pattern: '^[0-9]+$',
                },
                created_at: {
                  type: 'string',
                  format: 'date-time',
                },
              },
            },
            expires_at: {
              type: 'string',
              format: 'date-time',
            },
            csrf_token: {
              type: 'string',
              description: 'Session-bound bootstrap value; never logged or persisted by the client',
            },
          },
        },
        '401': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  requestEmailVerification: {
    authentication: 'public',
    csrfRequired: false,
    idempotencyRequired: true,
    method: 'POST',
    path: '/api/v1/auth/email-verifications',
    preconditionRequired: false,
    routeSchema: {
      headers: {
        type: 'object',
        properties: {
          'Idempotency-Key': {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            pattern: '^[\\x21-\\x7E]+$',
          },
        },
        required: ['Idempotency-Key'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            maxLength: 320,
          },
        },
      },
      response: {
        '202': {
          type: 'object',
          additionalProperties: false,
          required: ['accepted'],
          properties: {
            accepted: {
              type: 'boolean',
              const: true,
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  confirmEmailVerification: {
    authentication: 'public',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'POST',
    path: '/api/v1/auth/email-verifications/confirm',
    preconditionRequired: false,
    routeSchema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['token'],
        properties: {
          token: {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
        },
      },
      response: {
        '422': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  requestPasswordReset: {
    authentication: 'public',
    csrfRequired: false,
    idempotencyRequired: true,
    method: 'POST',
    path: '/api/v1/auth/password-resets',
    preconditionRequired: false,
    routeSchema: {
      headers: {
        type: 'object',
        properties: {
          'Idempotency-Key': {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            pattern: '^[\\x21-\\x7E]+$',
          },
        },
        required: ['Idempotency-Key'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            maxLength: 320,
          },
        },
      },
      response: {
        '202': {
          type: 'object',
          additionalProperties: false,
          required: ['accepted'],
          properties: {
            accepted: {
              type: 'boolean',
              const: true,
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  confirmPasswordReset: {
    authentication: 'public',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'POST',
    path: '/api/v1/auth/password-resets/confirm',
    preconditionRequired: false,
    routeSchema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['token', 'password'],
        properties: {
          token: {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          password: {
            type: 'string',
            minLength: 15,
            maxLength: 128,
          },
        },
      },
      response: {
        '422': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  getMe: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/me',
    preconditionRequired: false,
    routeSchema: {
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'email',
            'display_name',
            'email_verified',
            'resource_version',
            'created_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            email: {
              type: 'string',
              format: 'email',
            },
            display_name: {
              type: 'string',
              minLength: 1,
              maxLength: 120,
            },
            email_verified: {
              type: 'boolean',
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '401': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  updateMe: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'PATCH',
    path: '/api/v1/me',
    preconditionRequired: true,
    routeSchema: {
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          display_name: {
            type: 'string',
            minLength: 1,
            maxLength: 120,
          },
        },
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'email',
            'display_name',
            'email_verified',
            'resource_version',
            'created_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            email: {
              type: 'string',
              format: 'email',
            },
            display_name: {
              type: 'string',
              minLength: 1,
              maxLength: 120,
            },
            email_verified: {
              type: 'boolean',
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '401': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '403': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '422': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  getDashboard: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/dashboard',
    preconditionRequired: false,
    routeSchema: {
      querystring: {
        type: 'object',
        properties: {
          cursor: {
            type: 'string',
            maxLength: 1024,
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
          },
        },
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['generated_at', 'checks', 'groups', 'page'],
          properties: {
            generated_at: {
              type: 'string',
              format: 'date-time',
            },
            checks: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['check', 'status'],
                properties: {
                  check: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                      'id',
                      'name',
                      'url',
                      'interval_seconds',
                      'timeout_ms',
                      'expected_status_code',
                      'expected_body_substring',
                      'group_id',
                      'execution_state',
                      'resource_version',
                      'probe_generation',
                      'schedule_generation',
                      'created_at',
                      'updated_at',
                    ],
                    properties: {
                      id: {
                        type: 'string',
                        format: 'uuid',
                      },
                      name: {
                        type: 'string',
                      },
                      url: {
                        type: 'string',
                        format: 'uri',
                      },
                      interval_seconds: {
                        type: 'integer',
                      },
                      timeout_ms: {
                        type: 'integer',
                      },
                      expected_status_code: {
                        type: 'integer',
                      },
                      expected_body_substring: {
                        type: ['string', 'null'],
                      },
                      group_id: {
                        oneOf: [
                          {
                            type: 'string',
                            format: 'uuid',
                          },
                          {
                            type: 'null',
                          },
                        ],
                      },
                      execution_state: {
                        type: 'string',
                        enum: ['ACTIVE', 'PAUSED'],
                      },
                      resource_version: {
                        type: 'string',
                        pattern: '^[0-9]+$',
                      },
                      probe_generation: {
                        type: 'string',
                        pattern: '^[0-9]+$',
                      },
                      schedule_generation: {
                        type: 'string',
                        pattern: '^[0-9]+$',
                      },
                      created_at: {
                        type: 'string',
                        format: 'date-time',
                      },
                      updated_at: {
                        type: 'string',
                        format: 'date-time',
                      },
                    },
                  },
                  status: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                      'check_id',
                      'health_state',
                      'execution_state',
                      'freshness_state',
                      'maintenance',
                      'last_response_time_ms',
                      'last_checked_at',
                      'current_incident',
                      'state_version',
                    ],
                    properties: {
                      check_id: {
                        type: 'string',
                        format: 'uuid',
                      },
                      health_state: {
                        type: 'string',
                        enum: ['UNKNOWN', 'UP', 'SUSPECT', 'DOWN'],
                      },
                      execution_state: {
                        type: 'string',
                        enum: ['ACTIVE', 'PAUSED'],
                      },
                      freshness_state: {
                        type: 'string',
                        enum: ['FRESH', 'STALE'],
                      },
                      maintenance: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['active', 'until'],
                        properties: {
                          active: {
                            type: 'boolean',
                          },
                          until: {
                            oneOf: [
                              {
                                type: 'string',
                                format: 'date-time',
                              },
                              {
                                type: 'null',
                              },
                            ],
                          },
                        },
                      },
                      last_response_time_ms: {
                        type: ['integer', 'null'],
                        minimum: 0,
                      },
                      last_checked_at: {
                        oneOf: [
                          {
                            type: 'string',
                            format: 'date-time',
                          },
                          {
                            type: 'null',
                          },
                        ],
                      },
                      current_incident: {
                        oneOf: [
                          {
                            type: 'object',
                            additionalProperties: false,
                            required: [
                              'id',
                              'started_at',
                              'confirmed_at',
                              'observation_mode',
                              'observed_duration_ms',
                            ],
                            properties: {
                              id: {
                                type: 'string',
                                format: 'uuid',
                              },
                              started_at: {
                                type: 'string',
                                format: 'date-time',
                              },
                              confirmed_at: {
                                type: 'string',
                                format: 'date-time',
                              },
                              observation_mode: {
                                type: 'string',
                                enum: ['OBSERVED', 'UNOBSERVED'],
                              },
                              observed_duration_ms: {
                                type: 'string',
                                pattern: '^[0-9]+$',
                              },
                            },
                          },
                          {
                            type: 'null',
                          },
                        ],
                      },
                      state_version: {
                        type: 'string',
                        pattern: '^[0-9]+$',
                      },
                    },
                  },
                },
              },
            },
            groups: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['group', 'status'],
                properties: {
                  group: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                      'id',
                      'name',
                      'description',
                      'resource_version',
                      'created_at',
                      'updated_at',
                    ],
                    properties: {
                      id: {
                        type: 'string',
                        format: 'uuid',
                      },
                      name: {
                        type: 'string',
                      },
                      description: {
                        type: ['string', 'null'],
                      },
                      resource_version: {
                        type: 'string',
                        pattern: '^[0-9]+$',
                      },
                      created_at: {
                        type: 'string',
                        format: 'date-time',
                      },
                      updated_at: {
                        type: 'string',
                        format: 'date-time',
                      },
                    },
                  },
                  status: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['health_state', 'up', 'suspect', 'down', 'unknown', 'paused'],
                    properties: {
                      health_state: {
                        type: 'string',
                        enum: ['UNKNOWN', 'UP', 'SUSPECT', 'DOWN'],
                      },
                      up: {
                        type: 'integer',
                        minimum: 0,
                      },
                      suspect: {
                        type: 'integer',
                        minimum: 0,
                      },
                      down: {
                        type: 'integer',
                        minimum: 0,
                      },
                      unknown: {
                        type: 'integer',
                        minimum: 0,
                      },
                      paused: {
                        type: 'integer',
                        minimum: 0,
                      },
                    },
                  },
                },
              },
            },
            page: {
              type: 'object',
              additionalProperties: false,
              required: ['next_cursor', 'has_more'],
              properties: {
                next_cursor: {
                  type: ['string', 'null'],
                },
                has_more: {
                  type: 'boolean',
                },
              },
            },
          },
        },
        '400': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  listChecks: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/checks',
    preconditionRequired: false,
    routeSchema: {
      querystring: {
        type: 'object',
        properties: {
          cursor: {
            type: 'string',
            maxLength: 1024,
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
          },
          group_id: {
            type: 'string',
            format: 'uuid',
          },
          health: {
            type: 'string',
            enum: ['UNKNOWN', 'UP', 'SUSPECT', 'DOWN'],
          },
          execution_state: {
            type: 'string',
            enum: ['ACTIVE', 'PAUSED'],
          },
          freshness: {
            type: 'string',
            enum: ['FRESH', 'STALE'],
          },
        },
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['data', 'page'],
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['check', 'status'],
                properties: {
                  check: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                      'id',
                      'name',
                      'url',
                      'interval_seconds',
                      'timeout_ms',
                      'expected_status_code',
                      'expected_body_substring',
                      'group_id',
                      'execution_state',
                      'resource_version',
                      'probe_generation',
                      'schedule_generation',
                      'created_at',
                      'updated_at',
                    ],
                    properties: {
                      id: {
                        type: 'string',
                        format: 'uuid',
                      },
                      name: {
                        type: 'string',
                      },
                      url: {
                        type: 'string',
                        format: 'uri',
                      },
                      interval_seconds: {
                        type: 'integer',
                      },
                      timeout_ms: {
                        type: 'integer',
                      },
                      expected_status_code: {
                        type: 'integer',
                      },
                      expected_body_substring: {
                        type: ['string', 'null'],
                      },
                      group_id: {
                        oneOf: [
                          {
                            type: 'string',
                            format: 'uuid',
                          },
                          {
                            type: 'null',
                          },
                        ],
                      },
                      execution_state: {
                        type: 'string',
                        enum: ['ACTIVE', 'PAUSED'],
                      },
                      resource_version: {
                        type: 'string',
                        pattern: '^[0-9]+$',
                      },
                      probe_generation: {
                        type: 'string',
                        pattern: '^[0-9]+$',
                      },
                      schedule_generation: {
                        type: 'string',
                        pattern: '^[0-9]+$',
                      },
                      created_at: {
                        type: 'string',
                        format: 'date-time',
                      },
                      updated_at: {
                        type: 'string',
                        format: 'date-time',
                      },
                    },
                  },
                  status: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                      'check_id',
                      'health_state',
                      'execution_state',
                      'freshness_state',
                      'maintenance',
                      'last_response_time_ms',
                      'last_checked_at',
                      'current_incident',
                      'state_version',
                    ],
                    properties: {
                      check_id: {
                        type: 'string',
                        format: 'uuid',
                      },
                      health_state: {
                        type: 'string',
                        enum: ['UNKNOWN', 'UP', 'SUSPECT', 'DOWN'],
                      },
                      execution_state: {
                        type: 'string',
                        enum: ['ACTIVE', 'PAUSED'],
                      },
                      freshness_state: {
                        type: 'string',
                        enum: ['FRESH', 'STALE'],
                      },
                      maintenance: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['active', 'until'],
                        properties: {
                          active: {
                            type: 'boolean',
                          },
                          until: {
                            oneOf: [
                              {
                                type: 'string',
                                format: 'date-time',
                              },
                              {
                                type: 'null',
                              },
                            ],
                          },
                        },
                      },
                      last_response_time_ms: {
                        type: ['integer', 'null'],
                        minimum: 0,
                      },
                      last_checked_at: {
                        oneOf: [
                          {
                            type: 'string',
                            format: 'date-time',
                          },
                          {
                            type: 'null',
                          },
                        ],
                      },
                      current_incident: {
                        oneOf: [
                          {
                            type: 'object',
                            additionalProperties: false,
                            required: [
                              'id',
                              'started_at',
                              'confirmed_at',
                              'observation_mode',
                              'observed_duration_ms',
                            ],
                            properties: {
                              id: {
                                type: 'string',
                                format: 'uuid',
                              },
                              started_at: {
                                type: 'string',
                                format: 'date-time',
                              },
                              confirmed_at: {
                                type: 'string',
                                format: 'date-time',
                              },
                              observation_mode: {
                                type: 'string',
                                enum: ['OBSERVED', 'UNOBSERVED'],
                              },
                              observed_duration_ms: {
                                type: 'string',
                                pattern: '^[0-9]+$',
                              },
                            },
                          },
                          {
                            type: 'null',
                          },
                        ],
                      },
                      state_version: {
                        type: 'string',
                        pattern: '^[0-9]+$',
                      },
                    },
                  },
                },
              },
            },
            page: {
              type: 'object',
              additionalProperties: false,
              required: ['next_cursor', 'has_more'],
              properties: {
                next_cursor: {
                  type: ['string', 'null'],
                },
                has_more: {
                  type: 'boolean',
                },
              },
            },
          },
        },
        '400': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  createCheck: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: true,
    method: 'POST',
    path: '/api/v1/checks',
    preconditionRequired: false,
    routeSchema: {
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'Idempotency-Key': {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            pattern: '^[\\x21-\\x7E]+$',
          },
        },
        required: ['X-CSRF-Token', 'Idempotency-Key'],
      },
      body: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 160,
          },
          url: {
            type: 'string',
            format: 'uri',
            maxLength: 2048,
            description:
              'Absolute HTTP(S) URL. Credentials are forbidden. The fragment is removed during canonicalization and the canonical UTF-8 serialization must not exceed 4096 bytes.',
          },
          interval_seconds: {
            type: 'integer',
            minimum: 30,
            maximum: 3600,
          },
          timeout_ms: {
            type: 'integer',
            minimum: 100,
            maximum: 60000,
          },
          expected_status_code: {
            type: 'integer',
            minimum: 100,
            maximum: 599,
          },
          expected_body_substring: {
            type: ['string', 'null'],
            minLength: 1,
            maxLength: 2048,
            description:
              'Case-sensitive literal substring. In addition to this character bound, the API enforces a 2048-byte UTF-8 limit. Null disables body matching.',
          },
          group_id: {
            oneOf: [
              {
                type: 'string',
                format: 'uuid',
              },
              {
                type: 'null',
              },
            ],
          },
        },
        required: ['name', 'url', 'interval_seconds', 'timeout_ms', 'expected_status_code'],
        additionalProperties: false,
      },
      response: {
        '201': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'name',
            'url',
            'interval_seconds',
            'timeout_ms',
            'expected_status_code',
            'expected_body_substring',
            'group_id',
            'execution_state',
            'resource_version',
            'probe_generation',
            'schedule_generation',
            'created_at',
            'updated_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            name: {
              type: 'string',
            },
            url: {
              type: 'string',
              format: 'uri',
            },
            interval_seconds: {
              type: 'integer',
            },
            timeout_ms: {
              type: 'integer',
            },
            expected_status_code: {
              type: 'integer',
            },
            expected_body_substring: {
              type: ['string', 'null'],
            },
            group_id: {
              oneOf: [
                {
                  type: 'string',
                  format: 'uuid',
                },
                {
                  type: 'null',
                },
              ],
            },
            execution_state: {
              type: 'string',
              enum: ['ACTIVE', 'PAUSED'],
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            probe_generation: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            schedule_generation: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '409': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '422': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  getCheck: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/checks/:check_id',
    preconditionRequired: false,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          check_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['check_id'],
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'name',
            'url',
            'interval_seconds',
            'timeout_ms',
            'expected_status_code',
            'expected_body_substring',
            'group_id',
            'execution_state',
            'resource_version',
            'probe_generation',
            'schedule_generation',
            'created_at',
            'updated_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            name: {
              type: 'string',
            },
            url: {
              type: 'string',
              format: 'uri',
            },
            interval_seconds: {
              type: 'integer',
            },
            timeout_ms: {
              type: 'integer',
            },
            expected_status_code: {
              type: 'integer',
            },
            expected_body_substring: {
              type: ['string', 'null'],
            },
            group_id: {
              oneOf: [
                {
                  type: 'string',
                  format: 'uuid',
                },
                {
                  type: 'null',
                },
              ],
            },
            execution_state: {
              type: 'string',
              enum: ['ACTIVE', 'PAUSED'],
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            probe_generation: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            schedule_generation: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  updateCheck: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'PATCH',
    path: '/api/v1/checks/:check_id',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          check_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['check_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      body: {
        minProperties: 1,
        type: 'object',
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 160,
          },
          url: {
            type: 'string',
            format: 'uri',
            maxLength: 2048,
            description:
              'Absolute HTTP(S) URL. Credentials are forbidden. The fragment is removed during canonicalization and the canonical UTF-8 serialization must not exceed 4096 bytes.',
          },
          interval_seconds: {
            type: 'integer',
            minimum: 30,
            maximum: 3600,
          },
          timeout_ms: {
            type: 'integer',
            minimum: 100,
            maximum: 60000,
          },
          expected_status_code: {
            type: 'integer',
            minimum: 100,
            maximum: 599,
          },
          expected_body_substring: {
            type: ['string', 'null'],
            minLength: 1,
            maxLength: 2048,
            description:
              'Case-sensitive literal substring. In addition to this character bound, the API enforces a 2048-byte UTF-8 limit. Null disables body matching.',
          },
          group_id: {
            oneOf: [
              {
                type: 'string',
                format: 'uuid',
              },
              {
                type: 'null',
              },
            ],
          },
        },
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'name',
            'url',
            'interval_seconds',
            'timeout_ms',
            'expected_status_code',
            'expected_body_substring',
            'group_id',
            'execution_state',
            'resource_version',
            'probe_generation',
            'schedule_generation',
            'created_at',
            'updated_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            name: {
              type: 'string',
            },
            url: {
              type: 'string',
              format: 'uri',
            },
            interval_seconds: {
              type: 'integer',
            },
            timeout_ms: {
              type: 'integer',
            },
            expected_status_code: {
              type: 'integer',
            },
            expected_body_substring: {
              type: ['string', 'null'],
            },
            group_id: {
              oneOf: [
                {
                  type: 'string',
                  format: 'uuid',
                },
                {
                  type: 'null',
                },
              ],
            },
            execution_state: {
              type: 'string',
              enum: ['ACTIVE', 'PAUSED'],
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            probe_generation: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            schedule_generation: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '422': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  deleteCheck: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'DELETE',
    path: '/api/v1/checks/:check_id',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          check_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['check_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      response: {
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  pauseCheck: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'POST',
    path: '/api/v1/checks/:check_id/pause',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          check_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['check_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'name',
            'url',
            'interval_seconds',
            'timeout_ms',
            'expected_status_code',
            'expected_body_substring',
            'group_id',
            'execution_state',
            'resource_version',
            'probe_generation',
            'schedule_generation',
            'created_at',
            'updated_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            name: {
              type: 'string',
            },
            url: {
              type: 'string',
              format: 'uri',
            },
            interval_seconds: {
              type: 'integer',
            },
            timeout_ms: {
              type: 'integer',
            },
            expected_status_code: {
              type: 'integer',
            },
            expected_body_substring: {
              type: ['string', 'null'],
            },
            group_id: {
              oneOf: [
                {
                  type: 'string',
                  format: 'uuid',
                },
                {
                  type: 'null',
                },
              ],
            },
            execution_state: {
              type: 'string',
              enum: ['ACTIVE', 'PAUSED'],
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            probe_generation: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            schedule_generation: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '409': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  resumeCheck: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'POST',
    path: '/api/v1/checks/:check_id/resume',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          check_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['check_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'name',
            'url',
            'interval_seconds',
            'timeout_ms',
            'expected_status_code',
            'expected_body_substring',
            'group_id',
            'execution_state',
            'resource_version',
            'probe_generation',
            'schedule_generation',
            'created_at',
            'updated_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            name: {
              type: 'string',
            },
            url: {
              type: 'string',
              format: 'uri',
            },
            interval_seconds: {
              type: 'integer',
            },
            timeout_ms: {
              type: 'integer',
            },
            expected_status_code: {
              type: 'integer',
            },
            expected_body_substring: {
              type: ['string', 'null'],
            },
            group_id: {
              oneOf: [
                {
                  type: 'string',
                  format: 'uuid',
                },
                {
                  type: 'null',
                },
              ],
            },
            execution_state: {
              type: 'string',
              enum: ['ACTIVE', 'PAUSED'],
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            probe_generation: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            schedule_generation: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '409': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  listCheckRuns: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/checks/:check_id/runs',
    preconditionRequired: false,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          check_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['check_id'],
        additionalProperties: false,
      },
      querystring: {
        type: 'object',
        properties: {
          cursor: {
            type: 'string',
            maxLength: 1024,
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
          },
        },
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['data', 'page'],
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'trigger_kind',
                  'manual_mode',
                  'started_at',
                  'finished_at',
                  'outcome',
                  'accepted',
                  'rejection_reason',
                  'response_time_ms',
                  'status_code',
                  'failure_category',
                ],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  trigger_kind: {
                    type: 'string',
                    enum: ['SCHEDULED', 'MANUAL'],
                  },
                  manual_mode: {
                    type: ['string', 'null'],
                    enum: ['STATEFUL', 'DIAGNOSTIC', null],
                  },
                  started_at: {
                    type: 'string',
                    format: 'date-time',
                  },
                  finished_at: {
                    type: 'string',
                    format: 'date-time',
                  },
                  outcome: {
                    type: 'string',
                    enum: ['PASS', 'FAIL'],
                  },
                  accepted: {
                    type: 'boolean',
                  },
                  rejection_reason: {
                    type: ['string', 'null'],
                  },
                  response_time_ms: {
                    type: ['integer', 'null'],
                    minimum: 0,
                  },
                  status_code: {
                    type: ['integer', 'null'],
                  },
                  failure_category: {
                    type: ['string', 'null'],
                  },
                },
              },
            },
            page: {
              type: 'object',
              additionalProperties: false,
              required: ['next_cursor', 'has_more'],
              properties: {
                next_cursor: {
                  type: ['string', 'null'],
                },
                has_more: {
                  type: 'boolean',
                },
              },
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  requestManualRun: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: true,
    method: 'POST',
    path: '/api/v1/checks/:check_id/runs',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          check_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['check_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
          'Idempotency-Key': {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            pattern: '^[\\x21-\\x7E]+$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match', 'Idempotency-Key'],
      },
      response: {
        '202': {
          type: 'object',
          additionalProperties: false,
          required: ['request_id', 'check_id', 'disposition', 'mode', 'requested_at'],
          properties: {
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            check_id: {
              type: 'string',
              format: 'uuid',
            },
            disposition: {
              type: 'string',
              enum: ['ENQUEUED', 'COALESCED'],
            },
            mode: {
              type: 'string',
              enum: ['STATEFUL', 'DIAGNOSTIC'],
            },
            requested_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '409': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  getCheckHistory: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/checks/:check_id/history',
    preconditionRequired: false,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          check_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['check_id'],
        additionalProperties: false,
      },
      querystring: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['day', 'week', 'month'],
          },
        },
        required: ['period'],
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'check_id',
            'period',
            'from',
            'to',
            'resolution',
            'availability_ratio',
            'coverage_ratio',
            'observed_up_ms',
            'observed_down_ms',
            'unknown_ms',
            'buckets',
          ],
          properties: {
            check_id: {
              type: 'string',
              format: 'uuid',
            },
            period: {
              type: 'string',
              enum: ['day', 'week', 'month'],
            },
            from: {
              type: 'string',
              format: 'date-time',
            },
            to: {
              type: 'string',
              format: 'date-time',
            },
            resolution: {
              type: 'string',
              enum: ['minute', 'hour'],
            },
            availability_ratio: {
              type: ['number', 'null'],
              minimum: 0,
              maximum: 1,
            },
            coverage_ratio: {
              type: 'number',
              minimum: 0,
              maximum: 1,
            },
            observed_up_ms: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            observed_down_ms: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            unknown_ms: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            buckets: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'from',
                  'to',
                  'response_time_ms',
                  'availability_ratio',
                  'coverage_ratio',
                  'classification',
                  'sample_count',
                ],
                properties: {
                  from: {
                    type: 'string',
                    format: 'date-time',
                  },
                  to: {
                    type: 'string',
                    format: 'date-time',
                  },
                  response_time_ms: {
                    type: ['number', 'null'],
                    minimum: 0,
                  },
                  availability_ratio: {
                    type: ['number', 'null'],
                    minimum: 0,
                    maximum: 1,
                  },
                  coverage_ratio: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                  },
                  classification: {
                    type: 'string',
                    enum: ['UP', 'DOWN', 'UNKNOWN', 'PROVISIONAL', 'MIXED'],
                  },
                  sample_count: {
                    type: 'integer',
                    minimum: 0,
                  },
                },
              },
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  getCheckPrediction: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/checks/:check_id/prediction',
    preconditionRequired: false,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          check_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['check_id'],
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'check_id',
            'status',
            'risk_score',
            'risk_level',
            'computed_at',
            'valid_until',
            'horizon_seconds',
            'model',
            'reason_codes',
          ],
          properties: {
            check_id: {
              type: 'string',
              format: 'uuid',
            },
            status: {
              type: 'string',
              enum: ['AVAILABLE', 'UNAVAILABLE', 'STALE', 'INSUFFICIENT_DATA'],
            },
            risk_score: {
              type: ['number', 'null'],
              minimum: 0,
              maximum: 1,
            },
            risk_level: {
              type: ['string', 'null'],
              enum: ['LOW', 'MEDIUM', 'HIGH', null],
            },
            valid_until: {
              oneOf: [
                {
                  type: 'string',
                  format: 'date-time',
                },
                {
                  type: 'null',
                },
              ],
            },
            computed_at: {
              oneOf: [
                {
                  type: 'string',
                  format: 'date-time',
                },
                {
                  type: 'null',
                },
              ],
            },
            horizon_seconds: {
              type: ['integer', 'null'],
              minimum: 1,
            },
            model: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['name', 'version'],
                  properties: {
                    name: {
                      type: 'string',
                    },
                    version: {
                      type: 'string',
                    },
                  },
                },
                {
                  type: 'null',
                },
              ],
            },
            reason_codes: {
              type: 'array',
              maxItems: 10,
              items: {
                type: 'string',
              },
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  listGroups: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/groups',
    preconditionRequired: false,
    routeSchema: {
      querystring: {
        type: 'object',
        properties: {
          cursor: {
            type: 'string',
            maxLength: 1024,
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
          },
        },
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['data', 'page'],
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['group', 'status'],
                properties: {
                  group: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                      'id',
                      'name',
                      'description',
                      'resource_version',
                      'created_at',
                      'updated_at',
                    ],
                    properties: {
                      id: {
                        type: 'string',
                        format: 'uuid',
                      },
                      name: {
                        type: 'string',
                      },
                      description: {
                        type: ['string', 'null'],
                      },
                      resource_version: {
                        type: 'string',
                        pattern: '^[0-9]+$',
                      },
                      created_at: {
                        type: 'string',
                        format: 'date-time',
                      },
                      updated_at: {
                        type: 'string',
                        format: 'date-time',
                      },
                    },
                  },
                  status: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['health_state', 'up', 'suspect', 'down', 'unknown', 'paused'],
                    properties: {
                      health_state: {
                        type: 'string',
                        enum: ['UNKNOWN', 'UP', 'SUSPECT', 'DOWN'],
                      },
                      up: {
                        type: 'integer',
                        minimum: 0,
                      },
                      suspect: {
                        type: 'integer',
                        minimum: 0,
                      },
                      down: {
                        type: 'integer',
                        minimum: 0,
                      },
                      unknown: {
                        type: 'integer',
                        minimum: 0,
                      },
                      paused: {
                        type: 'integer',
                        minimum: 0,
                      },
                    },
                  },
                },
              },
            },
            page: {
              type: 'object',
              additionalProperties: false,
              required: ['next_cursor', 'has_more'],
              properties: {
                next_cursor: {
                  type: ['string', 'null'],
                },
                has_more: {
                  type: 'boolean',
                },
              },
            },
          },
        },
      },
    },
  },
  createGroup: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: true,
    method: 'POST',
    path: '/api/v1/groups',
    preconditionRequired: false,
    routeSchema: {
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'Idempotency-Key': {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            pattern: '^[\\x21-\\x7E]+$',
          },
        },
        required: ['X-CSRF-Token', 'Idempotency-Key'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 160,
          },
          description: {
            type: ['string', 'null'],
            maxLength: 1000,
          },
        },
      },
      response: {
        '201': {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'description', 'resource_version', 'created_at', 'updated_at'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            name: {
              type: 'string',
            },
            description: {
              type: ['string', 'null'],
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '409': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '422': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  getGroup: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/groups/:group_id',
    preconditionRequired: false,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          group_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['group_id'],
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'description', 'resource_version', 'created_at', 'updated_at'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            name: {
              type: 'string',
            },
            description: {
              type: ['string', 'null'],
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  updateGroup: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'PATCH',
    path: '/api/v1/groups/:group_id',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          group_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['group_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 160,
          },
          description: {
            type: ['string', 'null'],
            maxLength: 1000,
          },
        },
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'description', 'resource_version', 'created_at', 'updated_at'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            name: {
              type: 'string',
            },
            description: {
              type: ['string', 'null'],
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  deleteGroup: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'DELETE',
    path: '/api/v1/groups/:group_id',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          group_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['group_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      response: {
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  listIncidents: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/incidents',
    preconditionRequired: false,
    routeSchema: {
      querystring: {
        type: 'object',
        properties: {
          cursor: {
            type: 'string',
            maxLength: 1024,
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
          },
          check_id: {
            type: 'string',
            format: 'uuid',
          },
          group_id: {
            type: 'string',
            format: 'uuid',
          },
          status: {
            type: 'string',
            enum: ['OPEN', 'CLOSED'],
          },
        },
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['data', 'page'],
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'check_id',
                  'status',
                  'observation_mode',
                  'started_at',
                  'confirmed_at',
                  'ended_at',
                  'closure_reason',
                  'observed_duration_ms',
                  'wall_duration_ms',
                ],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  check_id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  status: {
                    type: 'string',
                    enum: ['OPEN', 'CLOSED'],
                  },
                  observation_mode: {
                    type: 'string',
                    enum: ['OBSERVED', 'UNOBSERVED'],
                  },
                  started_at: {
                    type: 'string',
                    format: 'date-time',
                  },
                  confirmed_at: {
                    type: 'string',
                    format: 'date-time',
                  },
                  ended_at: {
                    oneOf: [
                      {
                        type: 'string',
                        format: 'date-time',
                      },
                      {
                        type: 'null',
                      },
                    ],
                  },
                  closure_reason: {
                    type: ['string', 'null'],
                    enum: ['RECOVERED', 'CONFIG_CHANGED', 'CHECK_DELETED', 'ADMINISTRATIVE', null],
                  },
                  observed_duration_ms: {
                    oneOf: [
                      {
                        type: 'string',
                        pattern: '^[0-9]+$',
                      },
                      {
                        type: 'null',
                      },
                    ],
                  },
                  wall_duration_ms: {
                    oneOf: [
                      {
                        type: 'string',
                        pattern: '^[0-9]+$',
                      },
                      {
                        type: 'null',
                      },
                    ],
                  },
                },
              },
            },
            page: {
              type: 'object',
              additionalProperties: false,
              required: ['next_cursor', 'has_more'],
              properties: {
                next_cursor: {
                  type: ['string', 'null'],
                },
                has_more: {
                  type: 'boolean',
                },
              },
            },
          },
        },
      },
    },
  },
  getIncident: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/incidents/:incident_id',
    preconditionRequired: false,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          incident_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['incident_id'],
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'check_id',
            'status',
            'observation_mode',
            'started_at',
            'confirmed_at',
            'ended_at',
            'closure_reason',
            'observed_duration_ms',
            'wall_duration_ms',
            'segments',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            check_id: {
              type: 'string',
              format: 'uuid',
            },
            status: {
              type: 'string',
              enum: ['OPEN', 'CLOSED'],
            },
            observation_mode: {
              type: 'string',
              enum: ['OBSERVED', 'UNOBSERVED'],
            },
            started_at: {
              type: 'string',
              format: 'date-time',
            },
            confirmed_at: {
              type: 'string',
              format: 'date-time',
            },
            ended_at: {
              oneOf: [
                {
                  type: 'string',
                  format: 'date-time',
                },
                {
                  type: 'null',
                },
              ],
            },
            closure_reason: {
              type: ['string', 'null'],
              enum: ['RECOVERED', 'CONFIG_CHANGED', 'CHECK_DELETED', 'ADMINISTRATIVE', null],
            },
            observed_duration_ms: {
              oneOf: [
                {
                  type: 'string',
                  pattern: '^[0-9]+$',
                },
                {
                  type: 'null',
                },
              ],
            },
            wall_duration_ms: {
              oneOf: [
                {
                  type: 'string',
                  pattern: '^[0-9]+$',
                },
                {
                  type: 'null',
                },
              ],
            },
            segments: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['starts_at', 'ends_at', 'kind'],
                properties: {
                  starts_at: {
                    type: 'string',
                    format: 'date-time',
                  },
                  ends_at: {
                    oneOf: [
                      {
                        type: 'string',
                        format: 'date-time',
                      },
                      {
                        type: 'null',
                      },
                    ],
                  },
                  kind: {
                    type: 'string',
                    enum: ['OBSERVED_DOWN', 'UNOBSERVED'],
                  },
                },
              },
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  listMaintenanceWindows: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/maintenance-windows',
    preconditionRequired: false,
    routeSchema: {
      querystring: {
        type: 'object',
        properties: {
          cursor: {
            type: 'string',
            maxLength: 1024,
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
          },
          state: {
            type: 'string',
            enum: ['UPCOMING', 'ACTIVE', 'ENDED', 'CANCELLED'],
          },
          check_id: {
            type: 'string',
            format: 'uuid',
          },
          group_id: {
            type: 'string',
            format: 'uuid',
          },
          starts_before: {
            type: 'string',
            format: 'date-time',
          },
          ends_after: {
            type: 'string',
            format: 'date-time',
          },
        },
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['data', 'page'],
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'target_type',
                  'target_id',
                  'starts_at',
                  'ends_at',
                  'note',
                  'state',
                  'resource_version',
                  'created_at',
                  'updated_at',
                ],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  target_type: {
                    type: 'string',
                    enum: ['CHECK', 'GROUP'],
                  },
                  target_id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  starts_at: {
                    type: 'string',
                    format: 'date-time',
                  },
                  ends_at: {
                    type: 'string',
                    format: 'date-time',
                  },
                  note: {
                    type: ['string', 'null'],
                  },
                  state: {
                    type: 'string',
                    enum: ['UPCOMING', 'ACTIVE', 'ENDED', 'CANCELLED'],
                  },
                  resource_version: {
                    type: 'string',
                    pattern: '^[0-9]+$',
                  },
                  created_at: {
                    type: 'string',
                    format: 'date-time',
                  },
                  updated_at: {
                    type: 'string',
                    format: 'date-time',
                  },
                },
              },
            },
            page: {
              type: 'object',
              additionalProperties: false,
              required: ['next_cursor', 'has_more'],
              properties: {
                next_cursor: {
                  type: ['string', 'null'],
                },
                has_more: {
                  type: 'boolean',
                },
              },
            },
          },
        },
      },
    },
  },
  createMaintenanceWindow: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: true,
    method: 'POST',
    path: '/api/v1/maintenance-windows',
    preconditionRequired: false,
    routeSchema: {
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'Idempotency-Key': {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            pattern: '^[\\x21-\\x7E]+$',
          },
        },
        required: ['X-CSRF-Token', 'Idempotency-Key'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['target_type', 'target_id', 'starts_at', 'ends_at'],
        properties: {
          target_type: {
            type: 'string',
            enum: ['CHECK', 'GROUP'],
          },
          target_id: {
            type: 'string',
            format: 'uuid',
          },
          starts_at: {
            type: 'string',
            format: 'date-time',
          },
          ends_at: {
            type: 'string',
            format: 'date-time',
          },
          note: {
            type: ['string', 'null'],
            maxLength: 1000,
          },
        },
      },
      response: {
        '201': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'target_type',
            'target_id',
            'starts_at',
            'ends_at',
            'note',
            'state',
            'resource_version',
            'created_at',
            'updated_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            target_type: {
              type: 'string',
              enum: ['CHECK', 'GROUP'],
            },
            target_id: {
              type: 'string',
              format: 'uuid',
            },
            starts_at: {
              type: 'string',
              format: 'date-time',
            },
            ends_at: {
              type: 'string',
              format: 'date-time',
            },
            note: {
              type: ['string', 'null'],
            },
            state: {
              type: 'string',
              enum: ['UPCOMING', 'ACTIVE', 'ENDED', 'CANCELLED'],
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '409': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '422': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  getMaintenanceWindow: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/maintenance-windows/:window_id',
    preconditionRequired: false,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          window_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['window_id'],
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'target_type',
            'target_id',
            'starts_at',
            'ends_at',
            'note',
            'state',
            'resource_version',
            'created_at',
            'updated_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            target_type: {
              type: 'string',
              enum: ['CHECK', 'GROUP'],
            },
            target_id: {
              type: 'string',
              format: 'uuid',
            },
            starts_at: {
              type: 'string',
              format: 'date-time',
            },
            ends_at: {
              type: 'string',
              format: 'date-time',
            },
            note: {
              type: ['string', 'null'],
            },
            state: {
              type: 'string',
              enum: ['UPCOMING', 'ACTIVE', 'ENDED', 'CANCELLED'],
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  updateMaintenanceWindow: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'PATCH',
    path: '/api/v1/maintenance-windows/:window_id',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          window_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['window_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        description: 'The target is immutable; cancel and recreate to change target.',
        properties: {
          starts_at: {
            type: 'string',
            format: 'date-time',
          },
          ends_at: {
            type: 'string',
            format: 'date-time',
          },
          note: {
            type: ['string', 'null'],
            maxLength: 1000,
          },
        },
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'target_type',
            'target_id',
            'starts_at',
            'ends_at',
            'note',
            'state',
            'resource_version',
            'created_at',
            'updated_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            target_type: {
              type: 'string',
              enum: ['CHECK', 'GROUP'],
            },
            target_id: {
              type: 'string',
              format: 'uuid',
            },
            starts_at: {
              type: 'string',
              format: 'date-time',
            },
            ends_at: {
              type: 'string',
              format: 'date-time',
            },
            note: {
              type: ['string', 'null'],
            },
            state: {
              type: 'string',
              enum: ['UPCOMING', 'ACTIVE', 'ENDED', 'CANCELLED'],
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '409': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '422': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  cancelMaintenanceWindow: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'DELETE',
    path: '/api/v1/maintenance-windows/:window_id',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          window_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['window_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      response: {
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '409': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  listNotificationRecipients: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/notification-recipients',
    preconditionRequired: false,
    routeSchema: {
      querystring: {
        type: 'object',
        properties: {
          cursor: {
            type: 'string',
            maxLength: 1024,
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
          },
        },
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['data', 'page'],
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'email', 'verification_state', 'resource_version', 'created_at'],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  email: {
                    type: 'string',
                    format: 'email',
                  },
                  verification_state: {
                    type: 'string',
                    enum: ['PENDING', 'VERIFIED', 'DISABLED'],
                  },
                  resource_version: {
                    type: 'string',
                    pattern: '^[0-9]+$',
                  },
                  created_at: {
                    type: 'string',
                    format: 'date-time',
                  },
                },
              },
            },
            page: {
              type: 'object',
              additionalProperties: false,
              required: ['next_cursor', 'has_more'],
              properties: {
                next_cursor: {
                  type: ['string', 'null'],
                },
                has_more: {
                  type: 'boolean',
                },
              },
            },
          },
        },
      },
    },
  },
  createNotificationRecipient: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: true,
    method: 'POST',
    path: '/api/v1/notification-recipients',
    preconditionRequired: false,
    routeSchema: {
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'Idempotency-Key': {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            pattern: '^[\\x21-\\x7E]+$',
          },
        },
        required: ['X-CSRF-Token', 'Idempotency-Key'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            maxLength: 320,
          },
        },
      },
      response: {
        '201': {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'email', 'verification_state', 'resource_version', 'created_at'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            email: {
              type: 'string',
              format: 'email',
            },
            verification_state: {
              type: 'string',
              enum: ['PENDING', 'VERIFIED', 'DISABLED'],
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '409': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  deleteNotificationRecipient: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'DELETE',
    path: '/api/v1/notification-recipients/:recipient_id',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          recipient_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['recipient_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      response: {
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  resendNotificationRecipientVerification: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: true,
    method: 'POST',
    path: '/api/v1/notification-recipients/:recipient_id/verification',
    preconditionRequired: false,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          recipient_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['recipient_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'Idempotency-Key': {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            pattern: '^[\\x21-\\x7E]+$',
          },
        },
        required: ['X-CSRF-Token', 'Idempotency-Key'],
      },
      response: {
        '202': {
          type: 'object',
          additionalProperties: false,
          required: ['accepted'],
          properties: {
            accepted: {
              type: 'boolean',
              const: true,
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  confirmNotificationRecipientVerification: {
    authentication: 'public',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'POST',
    path: '/api/v1/notification-recipient-verifications/confirm',
    preconditionRequired: false,
    routeSchema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['token'],
        properties: {
          token: {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
        },
      },
      response: {
        '422': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  getDefaultNotificationPolicy: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/notification-policies/default',
    preconditionRequired: false,
    routeSchema: {
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'scope_type',
            'scope_id',
            'mode',
            'notify_down',
            'notify_recovery',
            'recipient_ids',
            'effective_recipient_ids',
            'resource_version',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            scope_type: {
              type: 'string',
              enum: ['DEFAULT', 'GROUP'],
            },
            scope_id: {
              oneOf: [
                {
                  type: 'string',
                  format: 'uuid',
                },
                {
                  type: 'null',
                },
              ],
            },
            mode: {
              type: 'string',
              enum: ['INHERIT', 'ACTIVE', 'DISABLED'],
            },
            notify_down: {
              type: ['boolean', 'null'],
            },
            notify_recovery: {
              type: ['boolean', 'null'],
            },
            recipient_ids: {
              type: 'array',
              items: {
                type: 'string',
                format: 'uuid',
              },
            },
            effective_recipient_ids: {
              type: 'array',
              items: {
                type: 'string',
                format: 'uuid',
              },
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
          },
        },
      },
    },
  },
  replaceDefaultNotificationPolicy: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'PUT',
    path: '/api/v1/notification-policies/default',
    preconditionRequired: true,
    routeSchema: {
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'notify_down', 'notify_recovery', 'recipient_ids'],
        properties: {
          mode: {
            type: 'string',
            enum: ['ACTIVE', 'DISABLED'],
          },
          notify_down: {
            type: ['boolean', 'null'],
          },
          notify_recovery: {
            type: ['boolean', 'null'],
          },
          recipient_ids: {
            type: 'array',
            uniqueItems: true,
            maxItems: 100,
            items: {
              type: 'string',
              format: 'uuid',
            },
          },
        },
        allOf: [
          {
            if: {
              properties: {
                mode: {
                  const: 'ACTIVE',
                },
              },
            },
            then: {
              properties: {
                notify_down: {
                  type: 'boolean',
                },
                notify_recovery: {
                  type: 'boolean',
                },
              },
            },
            else: {
              properties: {
                notify_down: {
                  type: 'null',
                },
                notify_recovery: {
                  type: 'null',
                },
                recipient_ids: {
                  maxItems: 0,
                },
              },
            },
          },
        ],
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'scope_type',
            'scope_id',
            'mode',
            'notify_down',
            'notify_recovery',
            'recipient_ids',
            'effective_recipient_ids',
            'resource_version',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            scope_type: {
              type: 'string',
              enum: ['DEFAULT', 'GROUP'],
            },
            scope_id: {
              oneOf: [
                {
                  type: 'string',
                  format: 'uuid',
                },
                {
                  type: 'null',
                },
              ],
            },
            mode: {
              type: 'string',
              enum: ['INHERIT', 'ACTIVE', 'DISABLED'],
            },
            notify_down: {
              type: ['boolean', 'null'],
            },
            notify_recovery: {
              type: ['boolean', 'null'],
            },
            recipient_ids: {
              type: 'array',
              items: {
                type: 'string',
                format: 'uuid',
              },
            },
            effective_recipient_ids: {
              type: 'array',
              items: {
                type: 'string',
                format: 'uuid',
              },
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  getGroupNotificationPolicy: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/groups/:group_id/notification-policy',
    preconditionRequired: false,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          group_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['group_id'],
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'scope_type',
            'scope_id',
            'mode',
            'notify_down',
            'notify_recovery',
            'recipient_ids',
            'effective_recipient_ids',
            'resource_version',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            scope_type: {
              type: 'string',
              enum: ['DEFAULT', 'GROUP'],
            },
            scope_id: {
              oneOf: [
                {
                  type: 'string',
                  format: 'uuid',
                },
                {
                  type: 'null',
                },
              ],
            },
            mode: {
              type: 'string',
              enum: ['INHERIT', 'ACTIVE', 'DISABLED'],
            },
            notify_down: {
              type: ['boolean', 'null'],
            },
            notify_recovery: {
              type: ['boolean', 'null'],
            },
            recipient_ids: {
              type: 'array',
              items: {
                type: 'string',
                format: 'uuid',
              },
            },
            effective_recipient_ids: {
              type: 'array',
              items: {
                type: 'string',
                format: 'uuid',
              },
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
          },
        },
      },
    },
  },
  replaceGroupNotificationPolicy: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'PUT',
    path: '/api/v1/groups/:group_id/notification-policy',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          group_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['group_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'notify_down', 'notify_recovery', 'recipient_ids'],
        properties: {
          mode: {
            type: 'string',
            enum: ['INHERIT', 'ACTIVE', 'DISABLED'],
          },
          notify_down: {
            type: ['boolean', 'null'],
          },
          notify_recovery: {
            type: ['boolean', 'null'],
          },
          recipient_ids: {
            type: 'array',
            uniqueItems: true,
            maxItems: 100,
            items: {
              type: 'string',
              format: 'uuid',
            },
          },
        },
        allOf: [
          {
            if: {
              properties: {
                mode: {
                  const: 'ACTIVE',
                },
              },
            },
            then: {
              properties: {
                notify_down: {
                  type: 'boolean',
                },
                notify_recovery: {
                  type: 'boolean',
                },
              },
            },
            else: {
              properties: {
                notify_down: {
                  type: 'null',
                },
                notify_recovery: {
                  type: 'null',
                },
                recipient_ids: {
                  maxItems: 0,
                },
              },
            },
          },
        ],
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'scope_type',
            'scope_id',
            'mode',
            'notify_down',
            'notify_recovery',
            'recipient_ids',
            'effective_recipient_ids',
            'resource_version',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            scope_type: {
              type: 'string',
              enum: ['DEFAULT', 'GROUP'],
            },
            scope_id: {
              oneOf: [
                {
                  type: 'string',
                  format: 'uuid',
                },
                {
                  type: 'null',
                },
              ],
            },
            mode: {
              type: 'string',
              enum: ['INHERIT', 'ACTIVE', 'DISABLED'],
            },
            notify_down: {
              type: ['boolean', 'null'],
            },
            notify_recovery: {
              type: ['boolean', 'null'],
            },
            recipient_ids: {
              type: 'array',
              items: {
                type: 'string',
                format: 'uuid',
              },
            },
            effective_recipient_ids: {
              type: 'array',
              items: {
                type: 'string',
                format: 'uuid',
              },
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  listPublicPages: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/public-pages',
    preconditionRequired: false,
    routeSchema: {
      querystring: {
        type: 'object',
        properties: {
          cursor: {
            type: 'string',
            maxLength: 1024,
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
          },
        },
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['data', 'page'],
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'title',
                  'description',
                  'state',
                  'components',
                  'resource_version',
                  'page_revision',
                  'created_at',
                  'updated_at',
                ],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  title: {
                    type: 'string',
                  },
                  description: {
                    type: ['string', 'null'],
                  },
                  state: {
                    type: 'string',
                    enum: ['DRAFT', 'PUBLISHED', 'DISABLED'],
                  },
                  components: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: [
                        'id',
                        'kind',
                        'source_id',
                        'display_name',
                        'position',
                        'show_url',
                        'show_response_time',
                        'show_incident_history',
                      ],
                      properties: {
                        id: {
                          type: 'string',
                          format: 'uuid',
                        },
                        kind: {
                          type: 'string',
                          enum: ['CHECK', 'GROUP'],
                        },
                        source_id: {
                          type: 'string',
                          format: 'uuid',
                        },
                        display_name: {
                          type: ['string', 'null'],
                        },
                        position: {
                          type: 'integer',
                          minimum: 0,
                        },
                        show_url: {
                          type: 'boolean',
                        },
                        show_response_time: {
                          type: 'boolean',
                        },
                        show_incident_history: {
                          type: 'boolean',
                        },
                      },
                    },
                  },
                  resource_version: {
                    type: 'string',
                    pattern: '^[0-9]+$',
                  },
                  page_revision: {
                    oneOf: [
                      {
                        type: 'string',
                        pattern: '^[0-9]+$',
                      },
                      {
                        type: 'null',
                      },
                    ],
                  },
                  created_at: {
                    type: 'string',
                    format: 'date-time',
                  },
                  updated_at: {
                    type: 'string',
                    format: 'date-time',
                  },
                },
              },
            },
            page: {
              type: 'object',
              additionalProperties: false,
              required: ['next_cursor', 'has_more'],
              properties: {
                next_cursor: {
                  type: ['string', 'null'],
                },
                has_more: {
                  type: 'boolean',
                },
              },
            },
          },
        },
      },
    },
  },
  createPublicPage: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: true,
    method: 'POST',
    path: '/api/v1/public-pages',
    preconditionRequired: false,
    routeSchema: {
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'Idempotency-Key': {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            pattern: '^[\\x21-\\x7E]+$',
          },
        },
        required: ['X-CSRF-Token', 'Idempotency-Key'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 160,
          },
          description: {
            type: ['string', 'null'],
            maxLength: 2000,
          },
        },
      },
      response: {
        '201': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'title',
            'description',
            'state',
            'components',
            'resource_version',
            'page_revision',
            'created_at',
            'updated_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            title: {
              type: 'string',
            },
            description: {
              type: ['string', 'null'],
            },
            state: {
              type: 'string',
              enum: ['DRAFT', 'PUBLISHED', 'DISABLED'],
            },
            components: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'kind',
                  'source_id',
                  'display_name',
                  'position',
                  'show_url',
                  'show_response_time',
                  'show_incident_history',
                ],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  kind: {
                    type: 'string',
                    enum: ['CHECK', 'GROUP'],
                  },
                  source_id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  display_name: {
                    type: ['string', 'null'],
                  },
                  position: {
                    type: 'integer',
                    minimum: 0,
                  },
                  show_url: {
                    type: 'boolean',
                  },
                  show_response_time: {
                    type: 'boolean',
                  },
                  show_incident_history: {
                    type: 'boolean',
                  },
                },
              },
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            page_revision: {
              oneOf: [
                {
                  type: 'string',
                  pattern: '^[0-9]+$',
                },
                {
                  type: 'null',
                },
              ],
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
      },
    },
  },
  getPublicPage: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/public-pages/:page_id',
    preconditionRequired: false,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['page_id'],
        additionalProperties: false,
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'title',
            'description',
            'state',
            'components',
            'resource_version',
            'page_revision',
            'created_at',
            'updated_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            title: {
              type: 'string',
            },
            description: {
              type: ['string', 'null'],
            },
            state: {
              type: 'string',
              enum: ['DRAFT', 'PUBLISHED', 'DISABLED'],
            },
            components: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'kind',
                  'source_id',
                  'display_name',
                  'position',
                  'show_url',
                  'show_response_time',
                  'show_incident_history',
                ],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  kind: {
                    type: 'string',
                    enum: ['CHECK', 'GROUP'],
                  },
                  source_id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  display_name: {
                    type: ['string', 'null'],
                  },
                  position: {
                    type: 'integer',
                    minimum: 0,
                  },
                  show_url: {
                    type: 'boolean',
                  },
                  show_response_time: {
                    type: 'boolean',
                  },
                  show_incident_history: {
                    type: 'boolean',
                  },
                },
              },
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            page_revision: {
              oneOf: [
                {
                  type: 'string',
                  pattern: '^[0-9]+$',
                },
                {
                  type: 'null',
                },
              ],
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  updatePublicPage: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'PATCH',
    path: '/api/v1/public-pages/:page_id',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['page_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 160,
          },
          description: {
            type: ['string', 'null'],
            maxLength: 2000,
          },
        },
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'title',
            'description',
            'state',
            'components',
            'resource_version',
            'page_revision',
            'created_at',
            'updated_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            title: {
              type: 'string',
            },
            description: {
              type: ['string', 'null'],
            },
            state: {
              type: 'string',
              enum: ['DRAFT', 'PUBLISHED', 'DISABLED'],
            },
            components: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'kind',
                  'source_id',
                  'display_name',
                  'position',
                  'show_url',
                  'show_response_time',
                  'show_incident_history',
                ],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  kind: {
                    type: 'string',
                    enum: ['CHECK', 'GROUP'],
                  },
                  source_id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  display_name: {
                    type: ['string', 'null'],
                  },
                  position: {
                    type: 'integer',
                    minimum: 0,
                  },
                  show_url: {
                    type: 'boolean',
                  },
                  show_response_time: {
                    type: 'boolean',
                  },
                  show_incident_history: {
                    type: 'boolean',
                  },
                },
              },
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            page_revision: {
              oneOf: [
                {
                  type: 'string',
                  pattern: '^[0-9]+$',
                },
                {
                  type: 'null',
                },
              ],
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  deletePublicPage: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'DELETE',
    path: '/api/v1/public-pages/:page_id',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['page_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      response: {
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  replacePublicPageComponents: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'PUT',
    path: '/api/v1/public-pages/:page_id/components',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['page_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      body: {
        type: 'object',
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            maxItems: 500,
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'kind',
                'source_id',
                'display_name',
                'position',
                'show_url',
                'show_response_time',
                'show_incident_history',
              ],
              properties: {
                kind: {
                  type: 'string',
                  enum: ['CHECK', 'GROUP'],
                },
                source_id: {
                  type: 'string',
                  format: 'uuid',
                },
                display_name: {
                  type: ['string', 'null'],
                  minLength: 1,
                  maxLength: 160,
                },
                position: {
                  type: 'integer',
                  minimum: 0,
                },
                show_url: {
                  type: 'boolean',
                },
                show_response_time: {
                  type: 'boolean',
                },
                show_incident_history: {
                  type: 'boolean',
                },
              },
            },
          },
        },
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'title',
            'description',
            'state',
            'components',
            'resource_version',
            'page_revision',
            'created_at',
            'updated_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            title: {
              type: 'string',
            },
            description: {
              type: ['string', 'null'],
            },
            state: {
              type: 'string',
              enum: ['DRAFT', 'PUBLISHED', 'DISABLED'],
            },
            components: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'kind',
                  'source_id',
                  'display_name',
                  'position',
                  'show_url',
                  'show_response_time',
                  'show_incident_history',
                ],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  kind: {
                    type: 'string',
                    enum: ['CHECK', 'GROUP'],
                  },
                  source_id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  display_name: {
                    type: ['string', 'null'],
                  },
                  position: {
                    type: 'integer',
                    minimum: 0,
                  },
                  show_url: {
                    type: 'boolean',
                  },
                  show_response_time: {
                    type: 'boolean',
                  },
                  show_incident_history: {
                    type: 'boolean',
                  },
                },
              },
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            page_revision: {
              oneOf: [
                {
                  type: 'string',
                  pattern: '^[0-9]+$',
                },
                {
                  type: 'null',
                },
              ],
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  publishPublicPage: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: true,
    method: 'POST',
    path: '/api/v1/public-pages/:page_id/publish',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['page_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
          'Idempotency-Key': {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            pattern: '^[\\x21-\\x7E]+$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match', 'Idempotency-Key'],
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['page', 'public_url'],
          properties: {
            page: {
              type: 'object',
              additionalProperties: false,
              required: [
                'id',
                'title',
                'description',
                'state',
                'components',
                'resource_version',
                'page_revision',
                'created_at',
                'updated_at',
              ],
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                },
                title: {
                  type: 'string',
                },
                description: {
                  type: ['string', 'null'],
                },
                state: {
                  type: 'string',
                  enum: ['DRAFT', 'PUBLISHED', 'DISABLED'],
                },
                components: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                      'id',
                      'kind',
                      'source_id',
                      'display_name',
                      'position',
                      'show_url',
                      'show_response_time',
                      'show_incident_history',
                    ],
                    properties: {
                      id: {
                        type: 'string',
                        format: 'uuid',
                      },
                      kind: {
                        type: 'string',
                        enum: ['CHECK', 'GROUP'],
                      },
                      source_id: {
                        type: 'string',
                        format: 'uuid',
                      },
                      display_name: {
                        type: ['string', 'null'],
                      },
                      position: {
                        type: 'integer',
                        minimum: 0,
                      },
                      show_url: {
                        type: 'boolean',
                      },
                      show_response_time: {
                        type: 'boolean',
                      },
                      show_incident_history: {
                        type: 'boolean',
                      },
                    },
                  },
                },
                resource_version: {
                  type: 'string',
                  pattern: '^[0-9]+$',
                },
                page_revision: {
                  oneOf: [
                    {
                      type: 'string',
                      pattern: '^[0-9]+$',
                    },
                    {
                      type: 'null',
                    },
                  ],
                },
                created_at: {
                  type: 'string',
                  format: 'date-time',
                },
                updated_at: {
                  type: 'string',
                  format: 'date-time',
                },
              },
            },
            public_url: {
              type: 'string',
              format: 'uri',
              description: 'Contains the raw token and is returned only on publish/rotation',
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  disablePublicPage: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: false,
    method: 'POST',
    path: '/api/v1/public-pages/:page_id/disable',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['page_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match'],
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'title',
            'description',
            'state',
            'components',
            'resource_version',
            'page_revision',
            'created_at',
            'updated_at',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            title: {
              type: 'string',
            },
            description: {
              type: ['string', 'null'],
            },
            state: {
              type: 'string',
              enum: ['DRAFT', 'PUBLISHED', 'DISABLED'],
            },
            components: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'kind',
                  'source_id',
                  'display_name',
                  'position',
                  'show_url',
                  'show_response_time',
                  'show_incident_history',
                ],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  kind: {
                    type: 'string',
                    enum: ['CHECK', 'GROUP'],
                  },
                  source_id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  display_name: {
                    type: ['string', 'null'],
                  },
                  position: {
                    type: 'integer',
                    minimum: 0,
                  },
                  show_url: {
                    type: 'boolean',
                  },
                  show_response_time: {
                    type: 'boolean',
                  },
                  show_incident_history: {
                    type: 'boolean',
                  },
                },
              },
            },
            resource_version: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            page_revision: {
              oneOf: [
                {
                  type: 'string',
                  pattern: '^[0-9]+$',
                },
                {
                  type: 'null',
                },
              ],
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  rotatePublicPageLink: {
    authentication: 'cookie',
    csrfRequired: true,
    idempotencyRequired: true,
    method: 'POST',
    path: '/api/v1/public-pages/:page_id/rotate-link',
    preconditionRequired: true,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            format: 'uuid',
          },
        },
        required: ['page_id'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'X-CSRF-Token': {
            type: 'string',
            minLength: 20,
            maxLength: 512,
          },
          'If-Match': {
            type: 'string',
            pattern: '^"rv-[0-9]+"$',
          },
          'Idempotency-Key': {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            pattern: '^[\\x21-\\x7E]+$',
          },
        },
        required: ['X-CSRF-Token', 'If-Match', 'Idempotency-Key'],
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: ['page', 'public_url'],
          properties: {
            page: {
              type: 'object',
              additionalProperties: false,
              required: [
                'id',
                'title',
                'description',
                'state',
                'components',
                'resource_version',
                'page_revision',
                'created_at',
                'updated_at',
              ],
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                },
                title: {
                  type: 'string',
                },
                description: {
                  type: ['string', 'null'],
                },
                state: {
                  type: 'string',
                  enum: ['DRAFT', 'PUBLISHED', 'DISABLED'],
                },
                components: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                      'id',
                      'kind',
                      'source_id',
                      'display_name',
                      'position',
                      'show_url',
                      'show_response_time',
                      'show_incident_history',
                    ],
                    properties: {
                      id: {
                        type: 'string',
                        format: 'uuid',
                      },
                      kind: {
                        type: 'string',
                        enum: ['CHECK', 'GROUP'],
                      },
                      source_id: {
                        type: 'string',
                        format: 'uuid',
                      },
                      display_name: {
                        type: ['string', 'null'],
                      },
                      position: {
                        type: 'integer',
                        minimum: 0,
                      },
                      show_url: {
                        type: 'boolean',
                      },
                      show_response_time: {
                        type: 'boolean',
                      },
                      show_incident_history: {
                        type: 'boolean',
                      },
                    },
                  },
                },
                resource_version: {
                  type: 'string',
                  pattern: '^[0-9]+$',
                },
                page_revision: {
                  oneOf: [
                    {
                      type: 'string',
                      pattern: '^[0-9]+$',
                    },
                    {
                      type: 'null',
                    },
                  ],
                },
                created_at: {
                  type: 'string',
                  format: 'date-time',
                },
                updated_at: {
                  type: 'string',
                  format: 'date-time',
                },
              },
            },
            public_url: {
              type: 'string',
              format: 'uri',
              description: 'Contains the raw token and is returned only on publish/rotation',
            },
          },
        },
        '412': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '428': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  streamPrivateEvents: {
    authentication: 'cookie',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/v1/events',
    preconditionRequired: false,
    routeSchema: {
      headers: {
        type: 'object',
        properties: {
          'Last-Event-ID': {
            type: 'string',
            format: 'uuid',
          },
        },
      },
      response: {
        '401': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  getPublicStatusPage: {
    authentication: 'public',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/public/v1/status-pages/:public_token',
    preconditionRequired: false,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          public_token: {
            type: 'string',
            minLength: 32,
            maxLength: 128,
          },
        },
        required: ['public_token'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'If-None-Match': {
            type: 'string',
          },
        },
      },
      response: {
        '200': {
          type: 'object',
          additionalProperties: false,
          required: [
            'title',
            'description',
            'page_revision',
            'generated_at',
            'overall_health_state',
            'components',
          ],
          properties: {
            title: {
              type: 'string',
            },
            description: {
              type: ['string', 'null'],
            },
            page_revision: {
              type: 'string',
              pattern: '^[0-9]+$',
            },
            generated_at: {
              type: 'string',
              format: 'date-time',
            },
            overall_health_state: {
              type: 'string',
              enum: ['UNKNOWN', 'UP', 'SUSPECT', 'DOWN'],
            },
            components: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'kind',
                  'display_name',
                  'health_state',
                  'maintenance_active',
                  'last_checked_at',
                ],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  kind: {
                    type: 'string',
                    enum: ['CHECK', 'GROUP'],
                  },
                  display_name: {
                    type: 'string',
                  },
                  url: {
                    type: 'string',
                    format: 'uri',
                    description:
                      'Present only when this component explicitly allows URL publication.',
                  },
                  health_state: {
                    type: 'string',
                    enum: ['UNKNOWN', 'UP', 'SUSPECT', 'DOWN'],
                  },
                  maintenance_active: {
                    type: 'boolean',
                  },
                  last_response_time_ms: {
                    type: ['integer', 'null'],
                    description:
                      'Omitted unless this component allows response-time publication; null means no observed sample.',
                  },
                  last_checked_at: {
                    oneOf: [
                      {
                        type: 'string',
                        format: 'date-time',
                      },
                      {
                        type: 'null',
                      },
                    ],
                  },
                  incident_history: {
                    type: 'array',
                    description:
                      'Omitted unless this component explicitly allows incident-history publication.',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['started_at', 'ended_at', 'observed_duration_ms'],
                      properties: {
                        started_at: {
                          type: 'string',
                          format: 'date-time',
                        },
                        ended_at: {
                          oneOf: [
                            {
                              type: 'string',
                              format: 'date-time',
                            },
                            {
                              type: 'null',
                            },
                          ],
                        },
                        observed_duration_ms: {
                          type: 'string',
                          pattern: '^[0-9]+$',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  streamPublicStatusPageEvents: {
    authentication: 'public',
    csrfRequired: false,
    idempotencyRequired: false,
    method: 'GET',
    path: '/api/public/v1/status-pages/:public_token/events',
    preconditionRequired: false,
    routeSchema: {
      params: {
        type: 'object',
        properties: {
          public_token: {
            type: 'string',
            minLength: 32,
            maxLength: 128,
          },
        },
        required: ['public_token'],
        additionalProperties: false,
      },
      headers: {
        type: 'object',
        properties: {
          'Last-Event-ID': {
            type: 'string',
            format: 'uuid',
          },
        },
      },
      response: {
        '404': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        '429': {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'title',
            'status',
            'detail',
            'instance',
            'code',
            'request_id',
            'retryable',
          ],
          properties: {
            type: {
              type: 'string',
              format: 'uri',
            },
            title: {
              type: 'string',
            },
            status: {
              type: 'integer',
              minimum: 400,
              maximum: 599,
            },
            detail: {
              type: 'string',
            },
            instance: {
              type: 'string',
            },
            code: {
              type: 'string',
              pattern: '^[a-z][a-z0-9_]*$',
            },
            request_id: {
              type: 'string',
              format: 'uuid',
            },
            retryable: {
              type: 'boolean',
            },
            retry_after_seconds: {
              type: 'integer',
              minimum: 0,
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pointer', 'code', 'message'],
                properties: {
                  pointer: {
                    type: 'string',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]*$',
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export type OpenApiOperationId = keyof typeof openApiOperations;
