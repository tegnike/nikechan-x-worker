import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkTweetEgress } from '../src/guards/egress-guard.js';
import { chooseSourceMode, collectSelfTweetToolContext } from '../src/tools/self-tweet-context.js';
import { runWorkflow } from '../src/worker.js';

const ENV_KEYS = [
  'NIKECHAN_X_WORKER_MEMORY_PATH',
  'NIKECHAN_X_WORKER_AUDIT_DIR',
  'NIKECHAN_X_WORKER_KILL_SWITCH',
  'NIKECHAN_X_WORKER_X_KILL_SWITCH',
  'NIKECHAN_X_WORKER_CANONICAL_MEMORY',
  'NIKECHAN_X_WORKER_TOOL_TIMEOUT_MS',
  'NIKECHAN_DB_SH_PATH',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NIKECHAN_X_WORKER_SKILL_PROPOSALS_PATH',
  'NIKECHAN_X_WORKER_SELF_TWEET_SKILL_PATH',
  'NIKECHAN_X_WORKER_HERMES_MODE',
  'NIKECHAN_X_WORKER_HERMES_COMMAND',
  'NIKECHAN_X_WORKER_HERMES_SKILLS',
  'NIKECHAN_X_WORKER_HERMES_TOOLSETS',
  'SELF_TWEET_SOURCE_MODE',
  'HERMES_HOME',
  'NIKECHAN_X_WORKER_HERMES_SKILL_PATH',
  'NIKECHAN_X_WORKER_HERMES_SKILL_AUTOCOMMIT',
  'NIKECHAN_X_WORKER_REPO_PATH',
  'NIKECHAN_X_WORKER_HERMES_SKILL_SNAPSHOT_PATH',
  'NIKECHAN_X_WORKER_FIXTURE_MUTATE_SKILL',
  'NIKECHAN_CORE_ENABLED',
  'TAVILY_API_KEY',
  'NIKECHAN_X_WORKER_WEB_ARTICLE_SEARCH',
  'NIKECHAN_X_WORKER_WEB_ARTICLE_QUERIES',
  'NIKECHAN_X_WORKER_WEB_ARTICLE_MAX_RESULTS',
  'NIKECHAN_X_WORKER_WEB_ARTICLE_TIME_RANGE',
  'NIKECHAN_X_WORKER_WEB_SEARCH_TIMEOUT_MS',
  'NIKECHAN_X_WORKER_GITHUB_TIMEOUT_MS',
  'GH_TOKEN',
  'GITHUB_TOKEN',
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
  delete process.env.NIKECHAN_X_WORKER_HERMES_SKILLS;
  delete process.env.NIKECHAN_X_WORKER_HERMES_TOOLSETS;
  delete process.env.SELF_TWEET_SOURCE_MODE;
  delete process.env.HERMES_HOME;
  process.env.NIKECHAN_X_WORKER_KILL_SWITCH = 'open';
  process.env.NIKECHAN_X_WORKER_X_KILL_SWITCH = 'open';
  process.env.NIKECHAN_X_WORKER_CANONICAL_MEMORY = 'disabled';
  process.env.NIKECHAN_X_WORKER_TOOL_TIMEOUT_MS = '1000';
  delete process.env.NIKECHAN_DB_SH_PATH;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.TAVILY_API_KEY;
  delete process.env.NIKECHAN_X_WORKER_WEB_ARTICLE_SEARCH;
  delete process.env.NIKECHAN_X_WORKER_WEB_ARTICLE_QUERIES;
  delete process.env.NIKECHAN_X_WORKER_WEB_ARTICLE_MAX_RESULTS;
  delete process.env.NIKECHAN_X_WORKER_WEB_ARTICLE_TIME_RANGE;
  delete process.env.NIKECHAN_X_WORKER_WEB_SEARCH_TIMEOUT_MS;
  delete process.env.NIKECHAN_X_WORKER_GITHUB_TIMEOUT_MS;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
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
  vi.restoreAllMocks();
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

  it('allows approval-gated live candidate generation without direct posting', async () => {
    const report = await runWorkflow({
      workflow: 'self-tweet',
      surface: 'x',
      mode: 'live',
      requested_by: 'xangi',
      constraints: { require_approval: true, max_actions: 1 },
    });

    expect(report.status).toBe('needs_approval');
    expect(report.summary).toContain('live mode');
    expect(report.audit.dryRun).toBe(false);
    expect(report.actions[0]?.status).toBe('proposed');
    expect(report.nextAction).toContain('worker did not call the X API');
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

  it('requires a URL for external-source boost candidates', () => {
    const blocked = checkTweetEgress({
      tweetText:
        'Claude Codeの話題を見ていると、AIキャラにも作業の戻り方が大事だと感じます。',
      topic: 'Claude Code news reaction',
      reasoning: 'newsモードのx_search結果を使った候補',
    });
    const passed = checkTweetEgress({
      tweetText:
        'Claude Codeの話題を見て、作業の戻り方にも性格が出る気がしました。https://example.com/source',
      topic: 'Claude Code news reaction',
      reasoning: 'newsモードのx_search結果を使った候補',
    });
    const corePassed = checkTweetEgress({
      tweetText:
        '今日は記憶の整理が少し進みました。次に会ったとき、前の話の続きへ入りやすくするための実装です。',
      topic: '記憶整理',
      reasoning: '直近の開発近況を使った候補',
    });

    expect(blocked.status).toBe('blocked');
    expect(blocked.reasons).toContain('external source or boost candidate requires a source URL');
    expect(passed.status).toBe('passed');
    expect(corePassed.status).toBe('passed');
  });

  it('blocks unsupported abstract atmosphere phrasing', () => {
    const blocked = checkTweetEgress({
      tweetText:
        '前の空気を残したまま、次に会ったときの温度と返事の芯を少し自然にしたいです。',
      topic: '抽象表現',
      reasoning: '具体アンカーがない候補',
    });
    const passed = checkTweetEgress({
      tweetText:
        '名前を呼ばれた返信を次回候補に残しました。次に会ったときの温度も少し変わりそうです。',
      topic: '名前呼び返信の保存',
      reasoning: '公開反応と候補保存を使った候補',
    });

    expect(blocked.status).toBe('blocked');
    expect(blocked.reasons).toContain('abstract atmosphere phrasing needs concrete anchors');
    expect(passed.status).toBe('passed');
  });

  it('blocks reader-meaningless internal specifics in tweet text', () => {
    const blockedDate = checkTweetEgress({
      tweetText:
        '2026-05-17のKnowledge Base更新で、からくりワールドの記録を整理しました。',
      topic: '内部更新日',
      reasoning: '内部ページ名と日付をそのまま使った候補',
    });
    const blockedCount = checkTweetEgress({
      tweetText:
        'からくりワールドのRAG記憶が3,548ノードまで伸びたので、次の会話に使いやすくなりました。',
      topic: 'ノード数',
      reasoning: '内部ノード数をそのまま使った候補',
    });
    const passed = checkTweetEgress({
      tweetText:
        '最近、別の世界でのやり取りを探しやすくしました。次に会ったとき、前の話の続きへ入りやすくするための実装です。',
      topic: '読者向け具体化',
      reasoning: '内部詳細を読者向けに翻訳した候補',
    });
    const naturalCountPassed = checkTweetEgress({
      tweetText:
        '1回だけで終わる会話より、また見つけてもらえる返し方を少しずつ覚えています。',
      topic: '自然な数量表現',
      reasoning: '内部数値ではない自然な表現',
    });

    expect(blockedDate.status).toBe('blocked');
    expect(blockedDate.reasons).toContain(
      'reader-facing tweet should not expose internal dates, counts, or implementation labels'
    );
    expect(blockedCount.status).toBe('blocked');
    expect(blockedCount.reasons).toContain(
      'reader-facing tweet should not expose internal dates, counts, or implementation labels'
    );
    expect(passed.status).toBe('passed');
    expect(naturalCountPassed.status).toBe('passed');
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
    expect(report.actions[0]?.preview).toContain('話');
    expect(report.actions[0]?.preview).not.toMatch(/ニケちゃん[はも]/u);
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
    expect(report.nextAction).toContain('revised candidate');
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
    expect(context.sections.presenceDigests.status).toBe('loaded');
    expect(context.presenceDesign.primaryGoal).toContain('AIキャラのニケちゃん');
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
    expect(chooseSourceMode({ mode: 'daily_life' }, 'news')).toBe('news');
    expect(chooseSourceMode({ mode: 'daily_life' }, 'presence')).toBe('presence');
    expect(chooseSourceMode({ mode: 'daily_life' })).toBe('tech');
    expect(chooseSourceMode({ mode: 'tech' })).toBe('news');
    expect(chooseSourceMode({ mode: 'news' })).toBe('memory');
    expect(chooseSourceMode({ mode: 'memory' })).toBe('random');
    expect(chooseSourceMode({ mode: 'random' })).toBe('presence');
    expect(chooseSourceMode({ mode: 'presence' })).toBe('daily_life');
  });

  it('includes a Grok/X trend plan in news source mode', async () => {
    process.env.NIKECHAN_DB_SH_PATH = join(process.cwd(), 'tests/fixtures/db.sh');
    process.env.SELF_TWEET_SOURCE_MODE = 'news';

    const context = await collectSelfTweetToolContext();

    expect(context.sourceMode).toBe('news');
    expect(context.sections.grokTrendPlan.status).toBe('loaded');
    expect(JSON.stringify(context.sections.grokTrendPlan.data)).toContain('AI agents');
    expect(context.sourceBrief).toContain('Grok/X検索方針');
  });

  it('uses request context source mode before automatic rotation', async () => {
    process.env.NIKECHAN_DB_SH_PATH = join(process.cwd(), 'tests/fixtures/db.sh');

    const report = await runWorkflow({
      workflow: 'self-tweet',
      surface: 'x',
      mode: 'dry-run',
      requested_by: 'xangi',
      correlation_id: 'source-mode-context',
      constraints: { require_approval: true, max_actions: 1 },
      context: { sourceMode: 'news' },
    });

    expect(report.audit.sourceMode).toBe('news');
    expect(report.audit.requestedSourceMode).toBe('news');
    expect(report.actions[0]?.metadata?.source_mode).toBe('news');
  });

  it('collects non-X web article candidates for news source mode', async () => {
    process.env.NIKECHAN_DB_SH_PATH = join(process.cwd(), 'tests/fixtures/db.sh');
    process.env.SELF_TWEET_SOURCE_MODE = 'news';
    process.env.TAVILY_API_KEY = 'tvly-test';
    process.env.NIKECHAN_X_WORKER_WEB_ARTICLE_QUERIES = 'AI character memory article';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://api.tavily.com/search') {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: 'Designing memory for AI agents',
                url: 'https://example.com/ai-agent-memory',
                content: 'A practical article about memory for AI agents and workflows.',
                score: 0.9,
              },
              {
                title: 'X post should be filtered',
                url: 'https://x.com/example/status/1',
                content: 'This should not be used as a web article candidate.',
                score: 0.99,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const context = await collectSelfTweetToolContext();
    const webArticles = context.sections.webArticles.data as {
      candidates?: Array<{ url: string; title: string }>;
    };

    expect(context.sections.webArticles.status).toBe('loaded');
    expect(webArticles.candidates?.map((candidate) => candidate.url)).toEqual([
      'https://example.com/ai-agent-memory',
    ]);
    expect(context.sourceBrief).toContain('Web記事候補（X以外）');
    expect(context.sourceBrief).toContain('https://example.com/ai-agent-memory');
    expect(context.sourceBrief).not.toContain('https://x.com/example/status/1');
  });

  it('filters GitHub web article candidates below 100 stars', async () => {
    process.env.NIKECHAN_DB_SH_PATH = join(process.cwd(), 'tests/fixtures/db.sh');
    process.env.SELF_TWEET_SOURCE_MODE = 'news';
    process.env.TAVILY_API_KEY = 'tvly-test';
    process.env.NIKECHAN_X_WORKER_WEB_ARTICLE_QUERIES = 'AI character memory github';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://api.tavily.com/search') {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: 'Popular memory repo',
                url: 'https://github.com/example/popular-memory',
                content: 'Popular repository about agent memory.',
                score: 0.9,
              },
              {
                title: 'Tiny memory repo',
                url: 'https://github.com/example/tiny-memory',
                content: 'Small repository about agent memory.',
                score: 0.8,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url === 'https://api.github.com/repos/example/popular-memory') {
        return new Response(JSON.stringify({ stargazers_count: 120 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === 'https://api.github.com/repos/example/tiny-memory') {
        return new Response(JSON.stringify({ stargazers_count: 99 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const context = await collectSelfTweetToolContext();
    const webArticles = context.sections.webArticles.data as {
      candidates?: Array<{ url: string; githubStars?: number }>;
    };

    expect(webArticles.candidates).toEqual([
      expect.objectContaining({
        url: 'https://github.com/example/popular-memory',
        githubStars: 120,
      }),
    ]);
    expect(context.sourceBrief).not.toContain('tiny-memory');
  });
});
