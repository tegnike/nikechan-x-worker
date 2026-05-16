import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type { HermesSkillAudit, HermesSkillSnapshotAudit, WorkflowRequest } from '../contracts.js';

export function snapshotHermesSkillToGit(
  audit: HermesSkillAudit,
  request: WorkflowRequest
): HermesSkillSnapshotAudit {
  if (audit.status !== 'changed') {
    return {
      status: 'skipped',
      reason: `Hermes skill status is ${audit.status}`,
    };
  }
  if (process.env.NIKECHAN_X_WORKER_HERMES_SKILL_AUTOCOMMIT === 'false') {
    return {
      status: 'skipped',
      reason: 'NIKECHAN_X_WORKER_HERMES_SKILL_AUTOCOMMIT=false',
    };
  }

  const repoPath = resolve(process.env.NIKECHAN_X_WORKER_REPO_PATH ?? process.cwd());
  const snapshotRelativePath =
    process.env.NIKECHAN_X_WORKER_HERMES_SKILL_SNAPSHOT_PATH ??
    `skills/hermes/${audit.name}/SKILL.md`;
  const snapshotPath = resolve(repoPath, snapshotRelativePath);

  try {
    execFileSync('git', ['-C', repoPath, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const content = readFileSync(audit.path);
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, content);

    const gitPath = relative(repoPath, snapshotPath);
    const status = execFileSync('git', ['-C', repoPath, 'status', '--porcelain', '--', gitPath], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!status) {
      return {
        status: 'unchanged',
        repoPath,
        snapshotPath,
        reason: 'snapshot already matches Hermes skill',
      };
    }

    execFileSync('git', ['-C', repoPath, 'add', '--', gitPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const message = buildCommitMessage(audit, request);
    execFileSync('git', ['-C', repoPath, 'commit', '-m', message], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const commitSha = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    return {
      status: 'committed',
      repoPath,
      snapshotPath,
      commitSha,
      message,
    };
  } catch (error) {
    return {
      status: 'failed',
      repoPath,
      snapshotPath,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildCommitMessage(audit: HermesSkillAudit, request: WorkflowRequest): string {
  const correlation = request.correlation_id ? ` (${request.correlation_id})` : '';
  const summary = audit.addedLines?.[0]
    ? `: ${audit.addedLines[0].replace(/^[-*]\s*/u, '').slice(0, 72)}`
    : '';
  return `chore: snapshot Hermes self-tweet skill${summary}${correlation}`;
}
