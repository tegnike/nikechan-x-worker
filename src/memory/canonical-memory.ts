import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { SourceRef } from '../contracts.js';

const execFileAsync = promisify(execFile);

export interface CanonicalMemoryItem {
  kind: 'episode' | 'note' | 'wiki' | 'presence_digest';
  id?: string;
  title?: string;
  content: string;
  source?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CanonicalMemorySnapshot {
  status: 'loaded' | 'disabled' | 'unavailable';
  items: CanonicalMemoryItem[];
  sourceRefs: SourceRef[];
  errors: string[];
}

export async function collectSelfTweetCanonicalMemory(): Promise<CanonicalMemorySnapshot> {
  const mode = process.env.NIKECHAN_X_WORKER_CANONICAL_MEMORY ?? 'auto';
  if (mode === 'disabled' || mode === 'false') {
    return { status: 'disabled', items: [], sourceRefs: [], errors: [] };
  }

  const dbSh = resolveDbShPath();
  if (!dbSh) {
    return {
      status: 'unavailable',
      items: [],
      sourceRefs: [],
      errors: ['nikechan db.sh not found; canonical memory unavailable'],
    };
  }

  const commands: Array<[CanonicalMemoryItem['kind'], string[]]> = [
    ['episode', ['public-episodes', 'x', '8']],
    ['note', ['public-notes', 'x', '6']],
    ['wiki', ['public-wiki', 'x', '6']],
  ];

  const [results, presenceResult] = await Promise.all([
    Promise.all(
      commands.map(async ([kind, args]) => {
        try {
          const parsed = await runDbJson(dbSh, args);
          return { kind, parsed, error: null };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { kind, parsed: [], error: `${args[0]} failed: ${message}` };
        }
      })
    ),
    collectPresenceDigests(dbSh),
  ]);

  const items = [
    ...results.flatMap((result) => normalizeItems(result.kind, result.parsed)),
    ...presenceResult.items,
  ].filter(isSelfTweetSeedCandidate);
  const errors = [
    ...results.map((result) => result.error),
    ...presenceResult.errors,
  ].filter((error): error is string => Boolean(error));

  return {
    status: items.length ? 'loaded' : errors.length ? 'unavailable' : 'loaded',
    items,
    sourceRefs: buildSourceRefs(items),
    errors,
  };
}

async function collectPresenceDigests(
  dbSh: string
): Promise<{ items: CanonicalMemoryItem[]; errors: string[] }> {
  try {
    const list = await runDbJson(dbSh, ['presence-digest-list', 'generated']);
    const rows = Array.isArray(list) ? list.slice(0, 3) : [];
    const details = await Promise.all(
      rows.map(async (row) => {
        const id = readRowString(row, 'id');
        if (!id) return { items: [], error: null };
        try {
          const parsed = await runDbJson(dbSh, ['presence-digest-get', id, 'x']);
          return { items: normalizeItems('presence_digest', parsed), error: null };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { items: [], error: `presence-digest-get failed for ${id}: ${message}` };
        }
      })
    );
    return {
      items: details.flatMap((detail) => detail.items),
      errors: details.map((detail) => detail.error).filter((error): error is string => Boolean(error)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      items: [],
      errors: [`presence-digest-list failed: ${message}`],
    };
  }
}

export function formatCanonicalMemoryForPrompt(snapshot: CanonicalMemorySnapshot, limit = 6): string {
  if (!snapshot.items.length) return 'No canonical public memory was available.';
  return snapshot.items
    .slice(0, limit)
    .map((item, index) => {
      const title = item.title ? `${item.title}: ` : '';
      return `${index + 1}. [${item.kind}] ${title}${truncateInline(item.content, 180)}`;
    })
    .join('\n');
}

function resolveDbShPath(): string | null {
  const explicit = process.env.NIKECHAN_DB_SH_PATH;
  if (explicit && existsSync(resolve(explicit))) return resolve(explicit);

  const opsRoot = process.env.NIKECHAN_OPS_REPO_PATH ?? '/Users/user/WorkSpace/nikechan';
  const candidate = resolve(opsRoot, 'scripts/db.sh');
  return existsSync(candidate) ? candidate : null;
}

async function runDbJson(dbSh: string, args: string[]): Promise<unknown> {
  const timeout = Number(process.env.NIKECHAN_X_WORKER_CANONICAL_TIMEOUT_MS ?? 8000);
  const { stdout } = await execFileAsync(dbSh, args, {
    cwd: resolve(dbSh, '..', '..'),
    timeout,
    maxBuffer: 1024 * 1024,
    env: process.env,
  });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed);
}

function normalizeItems(kind: CanonicalMemoryItem['kind'], parsed: unknown): CanonicalMemoryItem[] {
  const rows = Array.isArray(parsed) ? parsed : [];
  return rows.flatMap((row) => normalizeItem(kind, row));
}

function normalizeItem(
  kind: CanonicalMemoryItem['kind'],
  input: unknown
): CanonicalMemoryItem[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const row = input as Record<string, unknown>;
  const content =
    readString(row.content) ||
    readString(row.summary) ||
    (kind === 'presence_digest' ? undefined : readString(row.title));
  if (!content) return [];
  return [
    {
      kind,
      id: readString(row.id),
      title: readString(row.title) || readString(row.topic),
      content,
      source: readString(row.source) || readString(row.surface),
      createdAt:
        readString(row.created_at) ||
        readString(row.updated_at) ||
        readString(row.generated_at) ||
        readString(row.target_date),
      metadata: readRecord(row.metadata),
    },
  ];
}

function buildSourceRefs(items: CanonicalMemoryItem[]): SourceRef[] {
  return items.slice(0, 12).map((item) => ({
    type: canonicalSourceType(item.kind),
    id: item.id,
    label: item.title ?? truncateInline(item.content, 48),
  }));
}

function isSelfTweetSeedCandidate(item: CanonicalMemoryItem): boolean {
  const text = `${item.title ?? ''}\n${item.content}`;
  return !/self-tweetで案|mention-reactionを実行|hashtag-reactionを実行|本文「|案案|件チェック/u.test(text);
}

function canonicalSourceType(kind: CanonicalMemoryItem['kind']): string {
  switch (kind) {
    case 'episode':
      return 'local_episode';
    case 'note':
      return 'local_note';
    case 'wiki':
      return 'knowledge_entry';
    case 'presence_digest':
      return 'presence_digest';
  }
}

function readString(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  return trimmed || undefined;
}

function readRecord(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  return input as Record<string, unknown>;
}

function readRowString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  return readString((input as Record<string, unknown>)[key]);
}

function truncateInline(input: string, max: number): string {
  const compact = input.replace(/\s+/g, ' ').trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}
