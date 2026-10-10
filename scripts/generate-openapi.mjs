import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';

import openapiTS, { astToString } from 'openapi-typescript';
import { format } from 'prettier';
import { parse } from 'yaml';

import prettierConfig from '../prettier.config.js';

const root = process.cwd();
const sourcePath = path.join(root, 'docs', 'openapi-v1.yaml');
const generatedDirectory = path.join(root, 'packages', 'contracts', 'src', 'generated');
const typesPath = path.join(generatedDirectory, 'openapi.ts');
const runtimePath = path.join(generatedDirectory, 'openapi-runtime.ts');
const mode = process.argv[2] ?? '--check';

if (!['--check', '--write'].includes(mode)) {
  throw new Error('Usage: node scripts/generate-openapi.mjs [--check|--write]');
}

const source = await readFile(sourcePath, 'utf8');
const document = parse(source);

if (!document || typeof document !== 'object' || document.openapi !== '3.1.0') {
  throw new Error('docs/openapi-v1.yaml must contain an OpenAPI 3.1.0 document');
}

const operationIds = new Set();
const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const unsafeMethods = new Set(['post', 'put', 'patch', 'delete']);
const idempotentOperations = new Set([
  'register',
  'requestEmailVerification',
  'requestPasswordReset',
  'createCheck',
  'requestManualRun',
  'createGroup',
  'createMaintenanceWindow',
  'createNotificationRecipient',
  'resendNotificationRecipientVerification',
  'sendNotificationRecipientTestEmail',
  'createPublicPage',
  'publishPublicPage',
  'rotatePublicPageLink',
]);
const preconditionOperations = new Set([
  'updateMe',
  'updateCheck',
  'deleteCheck',
  'pauseCheck',
  'resumeCheck',
  'requestManualRun',
  'updateGroup',
  'deleteGroup',
  'updateMaintenanceWindow',
  'cancelMaintenanceWindow',
  'deleteNotificationRecipient',
  'replaceDefaultNotificationPolicy',
  'replaceGroupNotificationPolicy',
  'updatePublicPage',
  'deletePublicPage',
  'replacePublicPageComponents',
  'publishPublicPage',
  'disablePublicPage',
  'rotatePublicPageLink',
]);

function decodePointerPart(value) {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolvePointer(reference) {
  if (!reference.startsWith('#/'))
    throw new Error(`Only local references are supported: ${reference}`);
  let current = document;
  for (const part of reference.slice(2).split('/').map(decodePointerPart)) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      throw new Error(`Unresolved OpenAPI reference: ${reference}`);
    }
    current = current[part];
  }
  return current;
}

function dereference(value, stack = new Set()) {
  if (Array.isArray(value)) return value.map((item) => dereference(item, stack));
  if (!value || typeof value !== 'object') return value;

  if (typeof value.$ref === 'string') {
    if (stack.has(value.$ref)) {
      throw new Error(
        `Cyclic OpenAPI reference is not supported by runtime generation: ${value.$ref}`,
      );
    }
    const nextStack = new Set(stack);
    nextStack.add(value.$ref);
    const resolved = dereference(resolvePointer(value.$ref), nextStack);
    const siblings = Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '$ref')
        .map(([key, item]) => [key, dereference(item, stack)]),
    );
    return { ...resolved, ...siblings };
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, dereference(item, stack)]),
  );
}

// Fastify's default Ajv instance validates JSON Schema draft-07. OpenAPI 3.1
// composition may use `unevaluatedProperties`, so flatten the simple object
// allOf shape used by write DTOs into an equivalent draft-07 schema. The
// canonical OpenAPI document and generated public types remain unchanged.
function fastifySchema(value) {
  if (Array.isArray(value)) return value.map((item) => fastifySchema(item));
  if (!value || typeof value !== 'object') return value;

  if (value.unevaluatedProperties !== undefined && Array.isArray(value.allOf)) {
    const branches = value.allOf.map((item) => fastifySchema(item));
    const canFlatten = branches.every(
      (item) => item && typeof item === 'object' && !Array.isArray(item) && item.type === 'object',
    );
    if (canFlatten) {
      const unevaluatedProperties = value.unevaluatedProperties;
      const outer = Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== 'allOf' && key !== 'unevaluatedProperties'),
      );
      const properties = Object.assign({}, ...branches.map((item) => item.properties ?? {}));
      const required = [...new Set(branches.flatMap((item) => item.required ?? []))];
      const branchKeywords = Object.assign(
        {},
        ...branches.map((item) =>
          Object.fromEntries(
            Object.entries(item).filter(
              ([key]) => !['properties', 'required', 'type'].includes(key),
            ),
          ),
        ),
      );
      return fastifySchema({
        ...branchKeywords,
        ...outer,
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: unevaluatedProperties,
      });
    }
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fastifySchema(item)]));
}

function parametersSchema(parameters, location) {
  const selected = parameters
    .map((parameter) => dereference(parameter))
    .filter((parameter) => parameter.in === location);
  if (selected.length === 0) return undefined;

  const properties = Object.fromEntries(
    selected.map((parameter) => [parameter.name, dereference(parameter.schema ?? {})]),
  );
  const required = selected
    .filter((parameter) => parameter.required === true || location === 'path')
    .map((parameter) => parameter.name);

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...(location === 'header' ? {} : { additionalProperties: false }),
  };
}

function contentSchema(content) {
  if (!content || typeof content !== 'object') return undefined;
  for (const mediaType of ['application/json', 'application/problem+json']) {
    const media = content[mediaType];
    if (media?.schema) return fastifySchema(dereference(media.schema));
  }
  return undefined;
}

function operationContract(pathTemplate, method, pathItem, operation) {
  const operationId = operation.operationId;
  if (typeof operationId !== 'string' || operationId.length === 0) {
    throw new Error(`${method.toUpperCase()} ${pathTemplate} is missing operationId`);
  }
  if (operationIds.has(operationId)) throw new Error(`Duplicate operationId: ${operationId}`);
  operationIds.add(operationId);

  const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
  const resolvedParameters = parameters.map((parameter) => dereference(parameter));
  const headerNames = new Set(
    resolvedParameters
      .filter((parameter) => parameter.in === 'header')
      .map((parameter) => String(parameter.name).toLowerCase()),
  );
  const security = operation.security ?? document.security ?? [];
  const authentication = security.some((requirement) => 'cookieAuth' in requirement)
    ? 'cookie'
    : 'public';
  const pathParameterNames = new Set(
    resolvedParameters
      .filter((parameter) => parameter.in === 'path' && parameter.required === true)
      .map((parameter) => parameter.name),
  );
  for (const match of pathTemplate.matchAll(/\{([^}]+)\}/g)) {
    const parameterName = match[1];
    if (!parameterName || !pathParameterNames.has(parameterName)) {
      throw new Error(
        `${method.toUpperCase()} ${pathTemplate} is missing required path parameter ${parameterName ?? ''}`,
      );
    }
  }
  const requestBody = operation.requestBody ? dereference(operation.requestBody) : undefined;
  const responses = Object.fromEntries(
    Object.entries(operation.responses ?? {}).flatMap(([status, response]) => {
      const resolved = dereference(response);
      const schema = contentSchema(resolved.content);
      return schema ? [[status, schema]] : [];
    }),
  );
  const routeSchema = {
    ...(parametersSchema(parameters, 'path')
      ? { params: parametersSchema(parameters, 'path') }
      : {}),
    ...(parametersSchema(parameters, 'query')
      ? { querystring: parametersSchema(parameters, 'query') }
      : {}),
    ...(parametersSchema(parameters, 'header')
      ? { headers: parametersSchema(parameters, 'header') }
      : {}),
    ...(requestBody ? { body: contentSchema(requestBody.content) } : {}),
    ...(Object.keys(responses).length > 0 ? { response: responses } : {}),
  };

  return [
    operationId,
    {
      authentication,
      csrfRequired: headerNames.has('x-csrf-token'),
      idempotencyRequired: headerNames.has('idempotency-key'),
      method: method.toUpperCase(),
      path: pathTemplate.replaceAll(/\{([^}]+)\}/g, ':$1'),
      preconditionRequired: headerNames.has('if-match'),
      routeSchema,
    },
  ];
}

const operations = Object.fromEntries(
  Object.entries(document.paths ?? {}).flatMap(([pathTemplate, pathItem]) =>
    Object.entries(pathItem ?? {}).flatMap(([method, operation]) =>
      httpMethods.has(method) ? [operationContract(pathTemplate, method, pathItem, operation)] : [],
    ),
  ),
);

if (operationIds.size !== 58) {
  throw new Error(`Expected 58 OpenAPI operations, found ${operationIds.size}`);
}

for (const [operationId, operation] of Object.entries(operations)) {
  if (
    operation.authentication === 'cookie' &&
    unsafeMethods.has(operation.method.toLowerCase()) &&
    !operation.csrfRequired
  ) {
    throw new Error(`${operationId} is an authenticated unsafe operation without CSRF`);
  }
  if (idempotentOperations.has(operationId) !== operation.idempotencyRequired) {
    throw new Error(`${operationId} has an unexpected Idempotency-Key requirement`);
  }
  if (preconditionOperations.has(operationId) !== operation.preconditionRequired) {
    throw new Error(`${operationId} has an unexpected If-Match requirement`);
  }
}

function validateReferences(value) {
  if (Array.isArray(value)) {
    for (const item of value) validateReferences(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string') resolvePointer(value.$ref);
  for (const item of Object.values(value)) validateReferences(item);
}

validateReferences(document);

const ast = await openapiTS(pathToFileURL(sourcePath));
const typesOutput = await format(`${astToString(ast).trimEnd()}\n`, {
  ...prettierConfig,
  parser: 'typescript',
});
const runtimeOutput = await format(
  `// Generated from docs/openapi-v1.yaml. Do not edit by hand.\n\nexport const openApiOperations = ${JSON.stringify(operations, null, 2)} as const;\n\nexport type OpenApiOperationId = keyof typeof openApiOperations;\n`,
  { ...prettierConfig, parser: 'typescript' },
);

async function ensureMatches(filePath, expected) {
  let actual = '';
  try {
    actual = await readFile(filePath, 'utf8');
  } catch {
    // A missing generated file is reported as normal contract drift below.
  }
  if (actual !== expected) {
    throw new Error(
      `${path.relative(root, filePath)} is out of date. Run "pnpm contracts:generate".`,
    );
  }
}

if (mode === '--write') {
  await mkdir(generatedDirectory, { recursive: true });
  await writeFile(typesPath, typesOutput, 'utf8');
  await writeFile(runtimePath, runtimeOutput, 'utf8');
  console.log(`Generated ${operationIds.size} OpenAPI operations.`);
} else {
  await ensureMatches(typesPath, typesOutput);
  await ensureMatches(runtimePath, runtimeOutput);
  console.log(`OpenAPI generated artifacts are current (${operationIds.size} operations).`);
}
