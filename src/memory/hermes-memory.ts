import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface HermesExperience {
  id: string;
  createdAt: string;
  workflow: string;
  surface: 'x';
  kind: 'workflow_run' | 'guard_block' | 'operator_feedback' | 'skill_proposal_applied';
  summary: string;
  topic?: string;
  metadata?: Record<string, unknown>;
}

export interface HermesMemorySnapshot {
  schemaVersion: 1;
  experiences: HermesExperience[];
}

export class HermesMemoryStore {
  private readonly path: string;

  constructor(path = process.env.NIKECHAN_X_WORKER_MEMORY_PATH ?? '.worker/hermes-memory.json') {
    this.path = resolve(path);
  }

  isEnabled(): boolean {
    return process.env.NIKECHAN_X_WORKER_MEMORY_ENABLED !== 'false';
  }

  recallRecent(workflow: string, limit = 8): HermesExperience[] {
    if (!this.isEnabled()) return [];
    return this.read()
      .experiences.filter((entry) => entry.workflow === workflow)
      .slice(-limit)
      .reverse();
  }

  recallByKind(workflow: string, kind: HermesExperience['kind'], limit = 12): HermesExperience[] {
    if (!this.isEnabled()) return [];
    return this.read()
      .experiences.filter((entry) => entry.workflow === workflow && entry.kind === kind)
      .slice(-limit)
      .reverse();
  }

  append(input: Omit<HermesExperience, 'id' | 'createdAt'>): HermesExperience | null {
    if (!this.isEnabled()) return null;
    const snapshot = this.read();
    const entry: HermesExperience = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...input,
    };
    snapshot.experiences.push(entry);
    const maxEntries = Number(process.env.NIKECHAN_X_WORKER_MEMORY_MAX_ENTRIES ?? 500);
    snapshot.experiences = snapshot.experiences.slice(-maxEntries);
    this.write(snapshot);
    return entry;
  }

  private read(): HermesMemorySnapshot {
    if (!existsSync(this.path)) {
      return { schemaVersion: 1, experiences: [] };
    }
    const parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as HermesMemorySnapshot;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.experiences)) {
      throw new Error(`invalid Hermes memory file: ${this.path}`);
    }
    return parsed;
  }

  private write(snapshot: HermesMemorySnapshot): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
}
