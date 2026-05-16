import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { HermesSkillAudit } from '../contracts.js';

interface HermesSkillSnapshot {
  name: string;
  path: string;
  sha256?: string;
  bytes?: number;
  lines?: string[];
  unavailableReason?: string;
}

export function readHermesSelfTweetSkillSnapshot(): HermesSkillSnapshot {
  const name = readHermesSelfTweetSkillName();
  const path =
    process.env.NIKECHAN_X_WORKER_HERMES_SKILL_PATH ??
    resolve(readHermesHome(), 'skills', name, 'SKILL.md');
  try {
    const content = readFileSync(path);
    const stats = statSync(path);
    return {
      name,
      path,
      sha256: createHash('sha256').update(content).digest('hex'),
      bytes: stats.size,
      lines: content.toString('utf-8').split(/\r?\n/u),
    };
  } catch (error) {
    return {
      name,
      path,
      unavailableReason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function summarizeHermesSkillAudit(
  before: HermesSkillSnapshot,
  after: HermesSkillSnapshot
): HermesSkillAudit {
  const unavailableReason = before.unavailableReason ?? after.unavailableReason;
  if (unavailableReason || !before.sha256 || !after.sha256) {
    return {
      name: after.name,
      path: after.path,
      status: 'unavailable',
      beforeSha256: before.sha256,
      afterSha256: after.sha256,
      beforeBytes: before.bytes,
      afterBytes: after.bytes,
      unavailableReason,
    };
  }

  return {
    name: after.name,
    path: after.path,
    status: before.sha256 === after.sha256 ? 'unchanged' : 'changed',
    beforeSha256: before.sha256,
    afterSha256: after.sha256,
    beforeBytes: before.bytes,
    afterBytes: after.bytes,
    addedLines: diffLines(after.lines ?? [], before.lines ?? []),
    removedLines: diffLines(before.lines ?? [], after.lines ?? []),
  };
}

function diffLines(primary: string[], secondary: string[]): string[] {
  const secondaryCounts = new Map<string, number>();
  for (const line of secondary.map(normalizeDiffLine).filter(Boolean)) {
    secondaryCounts.set(line, (secondaryCounts.get(line) ?? 0) + 1);
  }
  const diff: string[] = [];
  for (const line of primary.map(normalizeDiffLine).filter(Boolean)) {
    const count = secondaryCounts.get(line) ?? 0;
    if (count > 0) {
      secondaryCounts.set(line, count - 1);
      continue;
    }
    diff.push(line);
  }
  return diff.slice(0, 8);
}

function normalizeDiffLine(line: string): string {
  return line.trim();
}

function readHermesSelfTweetSkillName(): string {
  const skills = process.env.NIKECHAN_X_WORKER_HERMES_SKILLS ?? 'nikechan-x-self-tweet';
  return skills.split(',')[0]?.trim() || 'nikechan-x-self-tweet';
}

function readHermesHome(): string {
  return process.env.HERMES_HOME?.trim() || resolve(homedir(), '.hermes');
}
