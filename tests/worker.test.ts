import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chooseSourceMode, collectSelfTweetToolContext } from '../src/tools/self-tweet-context.js';
import { runWorkflow } from '../src/worker.js';

const ENV_KEYS = [
  'NIKECHAN_X_WORKER_MEMORY_PATH',
  'NIKECHAN_X_WORKER_AUDIT_DIR',
  'NIKECHAN_X_WORKER_KILL_SWITCH',
  'NIKECHAN_X_WORKER_X_KILL_SWITCH',
  'NIKECHAN_X_WORKER_CANONICAL_MEMORY',
  'NIKECHAN_DB_SH_PATH',
  'NIKECHAN_X_WORKER_SKILL_PROPOSALS_PATH',
  'NIKECHAN_X_WORKER_SELF_TWEET_SKILL_PATH',
  'NIKECHAN_X_WORKER_HERMES_MODE',
  'NIKECHAN_X_WORKER_HERMES_COMMAND',
  'HERMES_HOME',
  'NIKECHAN_X_WORKER_HERMES_SKILL_PATH',
  'NIKECHAN_X_WORKER_HERMES_SKILL_AUTOCOMMIT',
  'NIKECHAN_X_WORKER_REPO_PATH',
  'NIKECHAN_X_WORKER_HERMES_SKILL_SNAPSHOT_PATH',
  'NIKECHAN_X_WORKER_FIXTURE_MUTATE_SKILL',
  'NIKECHAN_CORE_ENABLED',
];

let tempDir = '';
let oldEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'nikechan-x-worker-'));
  oldEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.NIKECHAN_X_WORKER_MEMORY_PATH = join(tempDir, 'memory.json');
  process.env.NIKECHAN_X_WORKER_AUDIT_DIR = join(tempDir, 'audit');
  process.env.NIKECHAN_X_WORKER_SKILL_PROPOSALS_PATH = join(tempDir, 'skill-proposals.jsonl');
  process.env.NIKECHAN_X_WORKER_SELF_TWEET_SKILL_PATH = join(tempDir, 'self-tweet.md');
  process.env.NIKECHAN_X_WORKER_HERMES_MODE = 'local-fallback';
  process.env.NIKECHAN_X_WORKER_HERMES_SKILL_PATH = join(tempDir, 'hermes-skill.md');
  process.env.NIKECHAN_X_WORKER_HERMES_SKILL_AUTOCOMMIT = 'false';
  delete process.env.NIKECHAN_X_WORKER_REPO_PATH;
  delete process.env.NIKECHAN_X_WORKER_HERMES_SKILL_SNAPSHOT_PATH;
  delete process.env.NIKECHAN_X_WORKER_FIXTURE_MUTATE_SKILL;
  delete process.env.NIKECHAN_X_WORKER_HERMES_COMMAND;
  delete process.env.HERMES_HOME;
  process.env.NIKECHAN_X_WORKER_KILL_SWITCH = 'open';
  process.env.NIKECHAN_X_WORKER_X_KILL_SWITCH = 'open';
  process.env.NIKECHAN_X_WORKER_CANONICAL_MEMORY = 'disabled';
  delete process.env.NIKECHAN_DB_SH_PATH;
  process.env.NIKECHAN_CORE_ENABLED = 'false';
  writeFileSync(
    process.env.NIKECHAN_X_WORKER_HERMES_SKILL_PATH,
    '---\nname: nikechan-x-self-tweet\n---\n# Skill\n'
  );
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = oldEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe('runWorkflow', () => {
  it('returns a dry-run self-tweet WorkflowReport', async () => {
    const report = await runWorkflow({
      workflow: 'self-tweet',
      surface: 'x',
      mode: 'dry-run',
      requested_by: 'xangi',
      correlation_id: 'test-1',
      constraints: { require_approval: true, max_actions: 1 },
    });

    expect(report.status).toBe('needs_approval');
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0]?.type).toBe('post_tweet');
    expect(report.actions[0]?.status).toBe('proposed');
    expect(report.actions[0]?.preview).toBeTruthy();
    expect(report.audit.egressGuard).toBe('passed');
    expect(report.audit.killSwitch).toBe('open');
    expect(report.audit.hermesRuntime).toBe('local-fallback');
    expect(report.audit.hermesStatus).toBe('ok');
    expect(report.audit.hermesSkill?.status).toBe('unchanged');
    expect(report.audit.canonicalMemory).toBe('disabled');
    expect(report.audit.auditId).toBeTruthy();
    expect(report.memoryProposals).toEqual([]);
    expect(report.skillProposals).toEqual([]);
  });

  it('blocks non-dry-run mode during initial scope', async () => {
    const report = await runWorkflow({
      workflow: 'self-tweet',
      surface: 'x',
      mode: 'live',
      requested_by: 'xangi',
    });

    expect(report.status).toBe('blocked');
    expect(report.summary).toContain('initial scope only permits dry-run mode');
    expect(report.actions[0]?.status).toBe('blocked');
  });

  it('honors kill switch', async () => {
    process.env.NIKECHAN_X_WORKER_X_KILL_SWITCH = 'closed';
    const report = await runWorkflow({
      workflow: 'self-tweet',
      surface: 'x',
      mode: 'dry-run',
      requested_by: 'xangi',
    });

    expect(report.status).toBe('blocked');
    expect(report.audit.surfaceKillSwitch).toBe('closed');
  });

  it('blocks secret-like context hints before proposal', async () => {
    const report = await runWorkflow({
      workflow: 'self-tweet',
      surface: 'x',
      mode: 'dry-run',
      requested_by: 'xangi',
      context: {
        topic_hints: ['sk-abcdefghijklmnopqrstuvwxyz123456'],
      },
    });

    expect(report.status).toBe('blocked');
    expect(report.audit.egressGuard).toBe('blocked');
    expect(report.summary).toContain('secret-like token detected');
  });

  it('uses canonical public memory when the read adapter is available', async () => {
    process.env.NIKECHAN_X_WORKER_CANONICAL_MEMORY = 'enabled';
    process.env.NIKECHAN_DB_SH_PATH = join(process.cwd(), 'tests/fixtures/db.sh');

    const report = await runWorkflow({
      workflow: 'self-tweet',
      surface: 'x',
      mode: 'dry-run',
      requested_by: 'xangi',
    });

    expect(report.status).toBe('needs_approval');
    expect(report.audit.canonicalMemory).toBe('loaded');
    expect(report.sourceRefs.some((ref) => ref.type === 'local_episode')).toBe(true);
    expect(report.sourceRefs.some((ref) => ref.type === 'presence_digest')).toBe(true);
    expect(report.actions[0]?.preview).toContain('公開メモの話題');
  });

  it('records feedback without using worker-local skill mutation', async () => {
    const report = await runWorkflow({
      workflow: 'self-tweet',
      surface: 'x',
      mode: 'dry-run',
      requested_by: 'xangi',
      context: {
        feedback: {
          verdict: 'revise',
          text: '案案のような内部ログっぽい語と、本文「で始まる引用途中の文を出さないでください。',
          previous_preview: 'self-tweetで案案5を投稿。本文「自分の気持ちが',
        },
      },
    });

    expect(report.status).toBe('needs_approval');
    expect(report.skillProposals).toEqual([]);
    expect(report.nextAction).toContain('revised dry-run candidate');
  });

  it('uses Hermes CLI runtime when configured', async () => {
    process.env.NIKECHAN_X_WORKER_HERMES_MODE = 'cli';
    process.env.NIKECHAN_X_WORKER_HERMES_COMMAND = join(process.cwd(), 'tests/fixtures/hermes-cli.js');
    process.env.NIKECHAN_X_WORKER_FIXTURE_MUTATE_SKILL = '1';

    const report = await runWorkflow({
      workflow: 'self-tweet',
      surface: 'x',
      mode: 'dry-run',
      requested_by: 'xangi',
      correlation_id: 'fake-hermes-cli',
    });

    expect(report.status).toBe('needs_approval');
    expect(report.audit.hermesRuntime).toBe('cli');
    expect(report.audit.hermesStatus).toBe('ok');
    expect(report.audit.hermesSkill?.status).toBe('changed');
    expect(report.audit.hermesSkill?.beforeSha256).not.toBe(report.audit.hermesSkill?.afterSha256);
    expect(report.audit.hermesSkill?.addedLines).toContain('- fixture learned a reusable self-tweet rule');
    expect(report.audit.hermesSkill?.snapshot?.status).toBe('skipped');
    expect(report.actions[0]?.preview).toBe('Hermes本体の判断で、今日は安全に小さく試すところから始めるよ。');
  });

  it('uses HERMES_HOME for native Hermes skill audit when no explicit skill path is set', async () => {
    const hermesHome = join(tempDir, 'hermes-home');
    const skillPath = join(hermesHome, 'skills', 'nikechan-x-self-tweet', 'SKILL.md');
    delete process.env.NIKECHAN_X_WORKER_HERMES_SKILL_PATH;
    process.env.HERMES_HOME = hermesHome;
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, '---\nname: nikechan-x-self-tweet\n---\n# Skill\n');

    const report = await runWorkflow({
      workflow: 'self-tweet',
      surface: 'x',
      mode: 'dry-run',
      requested_by: 'xangi',
      correlation_id: 'hermes-home-skill',
    });

    expect(report.audit.hermesSkill?.status).toBe('unchanged');
    expect(report.audit.hermesSkill?.path).toBe(skillPath);
  });

  it('commits a Hermes skill snapshot when native skill changes and autocommit is enabled', async () => {
    const repoPath = join(tempDir, 'repo');
    execFileSync('git', ['init', repoPath]);
    execFileSync('git', ['-C', repoPath, 'config', 'user.email', 'nikechan-x-worker@example.local']);
    execFileSync('git', ['-C', repoPath, 'config', 'user.name', 'nikechan-x-worker']);
    process.env.NIKECHAN_X_WORKER_REPO_PATH = repoPath;
    process.env.NIKECHAN_X_WORKER_HERMES_SKILL_AUTOCOMMIT = 'true';
    process.env.NIKECHAN_X_WORKER_HERMES_MODE = 'cli';
    process.env.NIKECHAN_X_WORKER_HERMES_COMMAND = join(process.cwd(), 'tests/fixtures/hermes-cli.js');
    process.env.NIKECHAN_X_WORKER_FIXTURE_MUTATE_SKILL = '1';

    const report = await runWorkflow({
      workflow: 'self-tweet',
      surface: 'x',
      mode: 'dry-run',
      requested_by: 'xangi',
      correlation_id: 'autocommit-test',
    });

    const snapshotPath = join(repoPath, 'skills/hermes/nikechan-x-self-tweet/SKILL.md');
    expect(report.audit.hermesSkill?.status).toBe('changed');
    expect(report.audit.hermesSkill?.snapshot?.status).toBe('committed');
    expect(report.audit.hermesSkill?.snapshot?.commitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(existsSync(snapshotPath)).toBe(true);
    expect(readFileSync(snapshotPath, 'utf-8')).toContain('fixture learned a reusable self-tweet rule');
  });

  it('returns multiple self-tweet candidates when max_actions is greater than one', async () => {
    const report = await runWorkflow({
      workflow: 'self-tweet',
      surface: 'x',
      mode: 'dry-run',
      requested_by: 'xangi',
      constraints: { max_actions: 3 },
    });

    expect(report.status).toBe('needs_approval');
    expect(report.actions).toHaveLength(3);
    expect(new Set(report.actions.map((action) => action.metadata?.topic)).size).toBe(3);
  });

  it('returns a failed WorkflowReport when Hermes CLI is required but unavailable', async () => {
    process.env.NIKECHAN_X_WORKER_HERMES_MODE = 'cli';
    process.env.NIKECHAN_X_WORKER_HERMES_COMMAND = join(tempDir, 'missing-hermes');

    const report = await runWorkflow({
      workflow: 'self-tweet',
      surface: 'x',
      mode: 'dry-run',
      requested_by: 'xangi',
      correlation_id: 'missing-hermes-cli',
    });

    expect(report.status).toBe('failed');
    expect(report.audit.hermesRuntime).toBe('cli');
    expect(report.audit.hermesStatus).toBe('failed');
    expect(report.error).toContain('Hermes CLI invocation failed');
  });

  it('collects Phase B read-only self-tweet context for Hermes tools', async () => {
    process.env.NIKECHAN_DB_SH_PATH = join(process.cwd(), 'tests/fixtures/db.sh');

    const context = await collectSelfTweetToolContext();

    expect(context.policy.xApiCallsAllowed).toBe(false);
    expect(context.policy.discordCallsAllowed).toBe(false);
    expect(context.policy.writableCanonicalMemory).toBe(false);
    expect(context.sections.publicEpisodes.status).toBe('loaded');
    expect(JSON.stringify(context.sections.articles.data)).toContain('Agent memory design');
    expect(context.sourceBrief).toContain('今回の収集方針');
  });

  it('keeps text-formatted tweet metrics as loaded performance context', async () => {
    const dbFixture = join(tempDir, 'db-text-metrics.sh');
    writeFileSync(
      dbFixture,
      `#!/bin/bash
set -euo pipefail
case "\${1:-}" in
  public-episodes) printf '%s\\n' '[]' ;;
  public-notes) printf '%s\\n' '[]' ;;
  public-wiki) printf '%s\\n' '[{"id":"wiki1","topic":"公開wiki","content":"公開wikiの要約","metadata":{"provenance":{"source_refs":[]}}}]' ;;
  topics-get) printf '%s\\n' '[]' ;;
  reading-unpushed-twitter) printf '%s\\n' '[]' ;;
  tweet-metrics-ranking) printf '%s\\n' '📊 Top 8 by engagement_rate' ;;
  *) printf '%s\\n' '[]' ;;
esac
`
    );
    chmodSync(dbFixture, 0o755);
    process.env.NIKECHAN_DB_SH_PATH = dbFixture;

    const context = await collectSelfTweetToolContext();

    expect(context.sections.performanceContext.status).toBe('loaded');
    expect(context.sections.performanceContext.data).toMatchObject({
      format: 'text',
      parseNote: 'db.sh command returned human-readable text instead of JSON',
    });
    expect(context.errors.some((error) => error.includes('tweet-metrics-ranking'))).toBe(false);
  });

  it('rotates self-tweet source mode from old xangi run-state semantics', () => {
    expect(chooseSourceMode({ mode: 'daily_life' })).toBe('tech');
    expect(chooseSourceMode({ mode: 'tech' })).toBe('memory');
    expect(chooseSourceMode({ mode: 'memory' })).toBe('random');
    expect(chooseSourceMode({ mode: 'random' })).toBe('daily_life');
  });
});
