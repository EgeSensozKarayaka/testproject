import { createOpaqueToken, digestToken } from '@site-monitor/auth';
import type { Pool, PoolClient } from '@site-monitor/database';
import { withUserTransaction } from '@site-monitor/database';
import type { components } from '@site-monitor/contracts/openapi';

import { ApiProblemError } from './problem.js';

type Schemas = components['schemas'];
export type PublicPageDto = Schemas['PublicPage'];
export type PublicPagePageDto = Schemas['PublicPagePage'];
export type PublicComponentWriteDto = Schemas['PublicComponentWrite'];
export type PublicStatusSnapshotDto = Schemas['PublicStatusSnapshot'];

interface PageRow {
  created_at: Date | string;
  description: string | null;
  id: string;
  resource_version: string;
  state: 'DISABLED' | 'DRAFT' | 'PUBLISHED';
  title: string;
  updated_at: Date | string;
}

interface ComponentRow {
  check_id: string | null;
  display_name: string | null;
  group_id: string | null;
  id: string;
  position: number;
  show_incident_history: boolean;
  show_response_time: boolean;
  show_url: boolean;
}

export interface PublicPageServicePort {
  create(ownerId: string, input: Schemas['PublicPageWrite']): Promise<PublicPageDto>;
  delete(ownerId: string, pageId: string, expectedVersion: string): Promise<void>;
  disable(ownerId: string, pageId: string, expectedVersion: string): Promise<PublicPageDto>;
  get(ownerId: string, pageId: string): Promise<PublicPageDto>;
  getPublic(token: string): Promise<PublicStatusSnapshotDto>;
  list(ownerId: string): Promise<PublicPagePageDto>;
  publish(
    ownerId: string,
    pageId: string,
    expectedVersion: string,
  ): Promise<{ page: PublicPageDto; public_url: string }>;
  replaceComponents(
    ownerId: string,
    pageId: string,
    expectedVersion: string,
    items: PublicComponentWriteDto[],
  ): Promise<PublicPageDto>;
  rotateLink(
    ownerId: string,
    pageId: string,
    expectedVersion: string,
  ): Promise<{ page: PublicPageDto; public_url: string }>;
  update(
    ownerId: string,
    pageId: string,
    expectedVersion: string,
    patch: Schemas['PublicPagePatch'],
  ): Promise<PublicPageDto>;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function notFound(publicRequest = false): ApiProblemError {
  return new ApiProblemError({
    code: publicRequest ? 'public_page_not_found' : 'resource_not_found',
    detail: publicRequest
      ? 'The public status page was not found.'
      : 'The requested public page was not found.',
    status: 404,
  });
}

function assertVersion(actual: string, expected: string): void {
  if (actual === expected) return;
  throw new ApiProblemError({
    code: 'resource_version_mismatch',
    detail: 'The public page changed after it was read.',
    etag: `"rv-${actual}"`,
    status: 412,
  });
}

async function components(
  client: PoolClient,
  pageId: string,
): Promise<PublicPageDto['components']> {
  const result = await client.query<ComponentRow>(
    `SELECT id, check_id, group_id, position, display_name,
            show_url, show_response_time, show_incident_history
       FROM public_status.components
      WHERE page_id = $1
      ORDER BY position, id`,
    [pageId],
  );
  return result.rows.map((row) => ({
    display_name: row.display_name,
    id: row.id,
    kind: row.check_id ? 'CHECK' : 'GROUP',
    position: row.position,
    show_incident_history: row.show_incident_history,
    show_response_time: row.show_response_time,
    show_url: row.show_url,
    source_id: row.check_id ?? row.group_id ?? '',
  }));
}

async function pageDto(client: PoolClient, row: PageRow): Promise<PublicPageDto> {
  return {
    components: await components(client, row.id),
    created_at: iso(row.created_at),
    description: row.description,
    id: row.id,
    page_revision: row.state === 'PUBLISHED' ? String(row.resource_version) : null,
    resource_version: String(row.resource_version),
    state: row.state,
    title: row.title,
    updated_at: iso(row.updated_at),
  };
}

async function lockedPage(client: PoolClient, pageId: string): Promise<PageRow> {
  const result = await client.query<PageRow>(
    `SELECT id, title, description, state, resource_version::text,
            created_at, updated_at
       FROM public_status.pages
      WHERE id = $1 AND deleted_at IS NULL
      FOR UPDATE`,
    [pageId],
  );
  const row = result.rows[0];
  if (!row) throw notFound();
  return row;
}

export class PublicPageService implements PublicPageServicePort {
  readonly #database: Pool;
  readonly #publicDatabase: Pool;
  readonly #publicWebUrl: string;

  constructor(database: Pool, publicDatabase: Pool, publicWebUrl: string) {
    this.#database = database;
    this.#publicDatabase = publicDatabase;
    this.#publicWebUrl = publicWebUrl.replace(/\/$/u, '');
  }

  async create(ownerId: string, input: Schemas['PublicPageWrite']): Promise<PublicPageDto> {
    return withUserTransaction(this.#database, ownerId, async (client) => {
      const result = await client.query<PageRow>(
        `INSERT INTO public_status.pages (owner_id, title, description, slug_digest)
         VALUES ($1, btrim($2), $3, $4)
         RETURNING id, title, description, state, resource_version::text, created_at, updated_at`,
        [ownerId, input.title, input.description ?? null, digestToken(createOpaqueToken())],
      );
      return pageDto(client, result.rows[0]!);
    });
  }

  async list(ownerId: string): Promise<PublicPagePageDto> {
    return withUserTransaction(this.#database, ownerId, async (client) => {
      const result = await client.query<PageRow>(
        `SELECT id, title, description, state, resource_version::text, created_at, updated_at
           FROM public_status.pages
          WHERE deleted_at IS NULL
          ORDER BY created_at DESC, id DESC
          LIMIT 100`,
      );
      return {
        data: await Promise.all(result.rows.map((row) => pageDto(client, row))),
        page: { has_more: false, next_cursor: null },
      };
    });
  }

  async get(ownerId: string, pageId: string): Promise<PublicPageDto> {
    return withUserTransaction(this.#database, ownerId, async (client) => {
      const result = await client.query<PageRow>(
        `SELECT id, title, description, state, resource_version::text, created_at, updated_at
           FROM public_status.pages WHERE id = $1 AND deleted_at IS NULL`,
        [pageId],
      );
      if (!result.rows[0]) throw notFound();
      return pageDto(client, result.rows[0]);
    });
  }

  async update(
    ownerId: string,
    pageId: string,
    expectedVersion: string,
    patch: Schemas['PublicPagePatch'],
  ): Promise<PublicPageDto> {
    return withUserTransaction(this.#database, ownerId, async (client) => {
      const current = await lockedPage(client, pageId);
      assertVersion(current.resource_version, expectedVersion);
      const result = await client.query<PageRow>(
        `UPDATE public_status.pages
            SET title = COALESCE(btrim($2), title),
                description = CASE WHEN $3::boolean THEN $4 ELSE description END,
                resource_version = resource_version + 1,
                updated_at = statement_timestamp()
          WHERE id = $1
          RETURNING id, title, description, state, resource_version::text, created_at, updated_at`,
        [
          pageId,
          patch.title ?? null,
          Object.hasOwn(patch, 'description'),
          patch.description ?? null,
        ],
      );
      return pageDto(client, result.rows[0]!);
    });
  }

  async replaceComponents(
    ownerId: string,
    pageId: string,
    expectedVersion: string,
    items: PublicComponentWriteDto[],
  ): Promise<PublicPageDto> {
    return withUserTransaction(this.#database, ownerId, async (client) => {
      const current = await lockedPage(client, pageId);
      assertVersion(current.resource_version, expectedVersion);
      await client.query(`DELETE FROM public_status.components WHERE page_id = $1`, [pageId]);
      for (const item of items) {
        const source = await client.query<{ id: string }>(
          item.kind === 'CHECK'
            ? `SELECT id FROM app.checks WHERE id = $1 AND deleted_at IS NULL`
            : `SELECT id FROM app.check_groups WHERE id = $1 AND deleted_at IS NULL`,
          [item.source_id],
        );
        if (!source.rows[0]) throw notFound();
        await client.query(
          `INSERT INTO public_status.components
             (owner_id, page_id, check_id, group_id, position, display_name,
              show_url, show_response_time, show_incident_history)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            ownerId,
            pageId,
            item.kind === 'CHECK' ? item.source_id : null,
            item.kind === 'GROUP' ? item.source_id : null,
            item.position,
            item.display_name,
            item.show_url,
            item.show_response_time,
            item.show_incident_history,
          ],
        );
      }
      const updated = await client.query<PageRow>(
        `UPDATE public_status.pages
            SET resource_version = resource_version + 1, updated_at = statement_timestamp()
          WHERE id = $1
          RETURNING id, title, description, state, resource_version::text, created_at, updated_at`,
        [pageId],
      );
      return pageDto(client, updated.rows[0]!);
    });
  }

  async publish(ownerId: string, pageId: string, expectedVersion: string) {
    return this.#publishWithNewLink(ownerId, pageId, expectedVersion, false);
  }

  async rotateLink(ownerId: string, pageId: string, expectedVersion: string) {
    return this.#publishWithNewLink(ownerId, pageId, expectedVersion, true);
  }

  async #publishWithNewLink(
    ownerId: string,
    pageId: string,
    expectedVersion: string,
    requirePublished: boolean,
  ) {
    const token = createOpaqueToken();
    const page = await withUserTransaction(this.#database, ownerId, async (client) => {
      const current = await lockedPage(client, pageId);
      assertVersion(current.resource_version, expectedVersion);
      if (requirePublished && current.state !== 'PUBLISHED') {
        throw new ApiProblemError({
          code: 'invalid_state_transition',
          detail: 'Only a published page link can be rotated.',
          status: 409,
        });
      }
      const result = await client.query<PageRow>(
        `UPDATE public_status.pages
            SET state = 'PUBLISHED', slug_digest = $2,
                token_revision = token_revision + 1,
                published_at = COALESCE(published_at, statement_timestamp()),
                disabled_at = NULL,
                resource_version = resource_version + 1,
                updated_at = statement_timestamp()
          WHERE id = $1
          RETURNING id, title, description, state, resource_version::text, created_at, updated_at`,
        [pageId, digestToken(token)],
      );
      return pageDto(client, result.rows[0]!);
    });
    return { page, public_url: `${this.#publicWebUrl}/status/${token}` };
  }

  async disable(ownerId: string, pageId: string, expectedVersion: string): Promise<PublicPageDto> {
    return withUserTransaction(this.#database, ownerId, async (client) => {
      const current = await lockedPage(client, pageId);
      assertVersion(current.resource_version, expectedVersion);
      const result = await client.query<PageRow>(
        `UPDATE public_status.pages
            SET state = 'DISABLED', disabled_at = statement_timestamp(),
                resource_version = resource_version + 1, updated_at = statement_timestamp()
          WHERE id = $1
          RETURNING id, title, description, state, resource_version::text, created_at, updated_at`,
        [pageId],
      );
      return pageDto(client, result.rows[0]!);
    });
  }

  async delete(ownerId: string, pageId: string, expectedVersion: string): Promise<void> {
    await withUserTransaction(this.#database, ownerId, async (client) => {
      const current = await lockedPage(client, pageId);
      assertVersion(current.resource_version, expectedVersion);
      await client.query(`DELETE FROM public_status.components WHERE page_id = $1`, [pageId]);
      await client.query(
        `UPDATE public_status.pages
            SET state = 'DISABLED', disabled_at = COALESCE(disabled_at, statement_timestamp()),
                deleted_at = statement_timestamp(), resource_version = resource_version + 1,
                updated_at = statement_timestamp()
          WHERE id = $1`,
        [pageId],
      );
    });
  }

  async getPublic(token: string): Promise<PublicStatusSnapshotDto> {
    const result = await this.#publicDatabase.query<{ payload: PublicStatusSnapshotDto }>(
      `SELECT payload FROM security_api.read_public_snapshot($1)`,
      [digestToken(token)],
    );
    if (!result.rows[0]) throw notFound(true);
    return result.rows[0].payload;
  }
}
