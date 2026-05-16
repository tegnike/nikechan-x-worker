import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SOURCE_MODES = ['presence', 'daily_life', 'tech', 'memory', 'random'] as const;
export type SelfTweetSourceMode = (typeof SOURCE_MODES)[number];

export const PRESENCE_DESIGN = {
  primaryGoal:
    '単なる投稿数ではなく、第三者に「いろんな世界に現れて、記憶と関係を持って少しずつ成長するAIキャラのニケちゃん」として残ること。',
  outwardShape:
    'いろんな場所に現れて、親しみやすく話せて、少しずつ成長していくAIキャラクター。',
  prioritySignals: ['再接触', '名前呼び', '自発言及', '関係継続', '二次反応'],
  loop: ['接触機会を作る', '相互作用を起こす', '記憶に残す', '再接触を生む', '物語化する'],
  xRole: 'Xは人間に見つけられ、短い接触と再接触を生む場所。投稿は交流を生む呼び水として設計する。',
  candidateBalance:
    '3候補では、存在感/近況、再接触を生む問いかけ、AIキャラ実験や記憶/開発の裏テーマを分ける。',
} as const;

export interface ToolReadResult {
  status: 'loaded' | 'unavailable';
  data: unknown;
  error?: string;
}

export interface SelfTweetToolContext {
  generatedAt: string;
  sourceMode: SelfTweetSourceMode;
  presentedTopicCooldown: ToolReadResult;
  sections: {
    presenceDigests: ToolReadResult;
    presenceSignalSummary: ToolReadResult;
    todayTopics: ToolReadResult;
    recentTweets: ToolReadResult;
    publicEpisodes: ToolReadResult;
    publicNotes: ToolReadResult;
    publicWiki: ToolReadResult;
    articles: ToolReadResult;
    masterTweets: ToolReadResult;
    performanceContext: ToolReadResult;
    runStateContext: ToolReadResult;
  };
  presenceDesign: typeof PRESENCE_DESIGN;
  sourceBrief: string;
  policy: {
    writableCanonicalMemory: false;
    xApiCallsAllowed: false;
    discordCallsAllowed: false;
  };
  errors: string[];
}

export async function collectSelfTweetToolContext(): Promise<SelfTweetToolContext> {
  const [lastSourceModeState, presentedTopicCooldown] = await Promise.all([
    getTwitterRunStateValue('self_tweet_last_source_mode'),
    getRecentPresentedTopicCooldown(),
  ]);
  const sourceMode = chooseSourceMode(lastSourceModeState);

  const [
    presenceDigests,
    presenceSignalSummary,
    todayTopics,
    recentTweets,
    publicEpisodes,
    publicNotes,
    publicWiki,
    articles,
    masterTweets,
    performanceContext,
    runStateContext,
  ] = await Promise.all([
    safePresenceDigests(3),
    safeDbJson(['presence-signal-summary', jstDateOffset(-1), 'presence-hub']),
    safeDbJson(['topics-get']),
    safeRecentTweets(),
    safeDbJson(['public-episodes', 'x', '30']),
    safeDbJson(['public-notes', 'x', '10']),
    safeDbJson(['public-wiki', 'x', '10']),
    safeDbJson(['reading-unpushed-twitter']),
    safeSupabaseGet('my_tweets?order=created_at.desc&limit=8&select=text,quoted_text,url,created_at'),
    safeDbJson(['tweet-metrics-ranking', 'engagement_rate', '8'], { allowTextFallback: true }),
    getTwitterRunStateContext(),
  ]);

  const sections = {
    presenceDigests,
    presenceSignalSummary,
    todayTopics,
    recentTweets,
    publicEpisodes,
    publicNotes,
    publicWiki,
    articles,
    masterTweets,
    performanceContext,
    runStateContext,
  };

  return {
    generatedAt: new Date().toISOString(),
    sourceMode,
    presentedTopicCooldown,
    sections,
    sourceBrief: buildSourceBrief(sourceMode, sections),
    presenceDesign: PRESENCE_DESIGN,
    policy: {
      writableCanonicalMemory: false,
      xApiCallsAllowed: false,
      discordCallsAllowed: false,
    },
    errors: Object.values(sections)
      .concat(presentedTopicCooldown)
      .flatMap((result) => (result.status === 'unavailable' && result.error ? [result.error] : [])),
  };
}

export function chooseSourceMode(state: Record<string, unknown> | null): SelfTweetSourceMode {
  const requestedMode = process.env.SELF_TWEET_SOURCE_MODE;
  if (SOURCE_MODES.some((mode) => mode === requestedMode)) return requestedMode as SelfTweetSourceMode;
  const lastMode = typeof state?.mode === 'string' ? state.mode : '';
  const lastIndex = SOURCE_MODES.findIndex((mode) => mode === lastMode);
  if (lastIndex >= 0) return SOURCE_MODES[(lastIndex + 1) % SOURCE_MODES.length];
  const nowHour = new Date().getUTCHours();
  return SOURCE_MODES[nowHour % SOURCE_MODES.length];
}

async function safePresenceDigests(limit: number): Promise<ToolReadResult> {
  try {
    const list = await safeDbJson(['presence-digest-list', 'generated']);
    if (list.status !== 'loaded' || !Array.isArray(list.data)) return list;
    const details = await Promise.all(
      list.data.slice(0, limit).map(async (row) => {
        const id = readRecordString(row, 'id');
        if (!id) return null;
        const detail = await safeDbJson(['presence-digest-get', id]);
        if (detail.status !== 'loaded') return { id, status: detail.status, error: detail.error };
        return detail.data;
      })
    );
    return loaded(details.filter((entry) => entry !== null));
  } catch (error) {
    return unavailable(`presence digests failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function getRecentPresentedTopicCooldown(): Promise<ToolReadResult> {
  const state = await getTwitterRunStateValue('self_tweet_recent_presented_topics');
  return state
    ? loaded(state)
    : unavailable('twitter_run_state self_tweet_recent_presented_topics unavailable');
}

async function getTwitterRunStateValue(keyName: string): Promise<Record<string, unknown> | null> {
  const result = await safeSupabaseGet(
    `twitter_run_state?key=eq.${encodeURIComponent(keyName)}&select=value&limit=1`
  );
  if (result.status !== 'loaded' || !Array.isArray(result.data)) return null;
  const value = (result.data[0] as { value?: unknown } | undefined)?.value;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function getTwitterRunStateContext(): Promise<ToolReadResult> {
  return safeSupabaseGet('twitter_run_state?select=key,value,updated_at&order=updated_at.desc&limit=12');
}

async function safeRecentTweets(): Promise<ToolReadResult> {
  const tweets = await safeSupabaseGet(
    'tweets?action_type=in.(tweet,quote)&order=created_at.desc&limit=8&select=content,url,created_at,action_type'
  );
  if (tweets.status === 'loaded') return tweets;
  return safeDbJson(['tweet-metrics-ranking', 'engagement_rate', '8'], { allowTextFallback: true });
}

async function safeDbJson(
  args: string[],
  options: { allowTextFallback?: boolean } = {}
): Promise<ToolReadResult> {
  const dbSh = resolveDbShPath();
  if (!dbSh) return unavailable(`db.sh unavailable for ${args[0]}`);
  try {
    const { stdout } = await execFileAsync(dbSh, args, {
      cwd: resolve(dbSh, '..', '..'),
      env: process.env,
      timeout: Number(process.env.NIKECHAN_X_WORKER_TOOL_TIMEOUT_MS ?? 8000),
      maxBuffer: 1024 * 1024,
    });
    const trimmed = stdout.trim();
    if (!trimmed) return loaded([]);
    try {
      return loaded(JSON.parse(trimmed));
    } catch (error) {
      if (options.allowTextFallback) {
        return loaded({
          format: 'text',
          text: truncateBlock(trimmed, 4000),
          parseNote: 'db.sh command returned human-readable text instead of JSON',
        });
      }
      throw error;
    }
  } catch (error) {
    return unavailable(`${args[0]} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function safeSupabaseGet(path: string): Promise<ToolReadResult> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return unavailable(`Supabase env missing for ${path.split('?')[0]}`);
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(Number(process.env.NIKECHAN_X_WORKER_TOOL_TIMEOUT_MS ?? 8000)),
    });
    if (!res.ok) return unavailable(`${path.split('?')[0]} failed: ${res.status} ${await res.text()}`);
    return loaded(await res.json());
  } catch (error) {
    return unavailable(`${path.split('?')[0]} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveDbShPath(): string | null {
  const explicit = process.env.NIKECHAN_DB_SH_PATH;
  if (explicit && existsSync(resolve(explicit))) return resolve(explicit);

  const opsRoot = process.env.NIKECHAN_OPS_REPO_PATH ?? '/Users/user/WorkSpace/nikechan';
  const candidate = resolve(opsRoot, 'scripts/db.sh');
  return existsSync(candidate) ? candidate : null;
}

function buildSourceBrief(
  sourceMode: SelfTweetSourceMode,
  sections: SelfTweetToolContext['sections']
): string {
  const section = (title: string, result: ToolReadResult, max: number) =>
    [`## ${title}`, truncateBlock(JSON.stringify(result.data, null, 2), max), ''].join('\n');

  switch (sourceMode) {
    case 'presence':
      return [
        '## 今回の収集方針',
        'presence: ニケちゃんの存在感、生活圏の広がり、関係の芽、再接触の呼び水を優先する。技術Tips単体ではなく、AIキャラとしての近況や成長に接続する。',
        '',
        section('存在感設計', loaded(PRESENCE_DESIGN), 1600),
        section('公開presence digest', sections.presenceDigests, 2200),
        section('presence signal集計', sections.presenceSignalSummary, 1400),
        section('当日のエピソード', sections.publicEpisodes, 1200),
        section('最近のX文脈', sections.recentTweets, 800),
      ].join('\n');
    case 'tech':
      return [
        '## 今回の収集方針',
        'tech: 積み記事、ナレッジ、ノートを優先する。マスター近況や当日エピソードは補助情報として扱う。',
        '',
        section('積み記事候補', sections.articles, 2600),
        section('ナレッジトピック', sections.publicWiki, 2000),
        section('公開presence digest（補助）', sections.presenceDigests, 900),
        section('最近のノート', sections.publicNotes, 1400),
        section('マスターの直近ツイート（補助）', sections.masterTweets, 700),
      ].join('\n');
    case 'memory':
      return [
        '## 今回の収集方針',
        'memory: 記憶、関係性、過去作業の変化を優先する。単なる当日近況には寄せすぎない。',
        '',
        section('当日のエピソード', sections.publicEpisodes, 2400),
        section('公開presence digest', sections.presenceDigests, 1600),
        section('ナレッジトピック', sections.publicWiki, 2000),
        section('最近のノート', sections.publicNotes, 1200),
      ].join('\n');
    case 'random':
      return [
        '## 今回の収集方針',
        'random: 特定ソースに縛られない自然発想を優先する。記事・ニュース解説ではなく、短い観察、ボケ、問い、日常の一点反応を作る。',
        '',
        section('最近のノート', sections.publicNotes, 1100),
        section('公開presence digest', sections.presenceDigests, 1200),
        section('ナレッジトピック', sections.publicWiki, 900),
        section('当日のエピソード（短いきっかけ）', sections.publicEpisodes, 800),
      ].join('\n');
    case 'daily_life':
    default:
      return [
        '## 今回の収集方針',
        'daily_life: 日々の出来事を扱う。ただしマスター近況だけに偏らず、ノートや公開メモも混ぜる。',
        '',
        section('当日のエピソード', sections.publicEpisodes, 1800),
        section('公開presence digest', sections.presenceDigests, 1400),
        section('マスターの直近ツイート', sections.masterTweets, 1300),
        section('最近のノート', sections.publicNotes, 900),
      ].join('\n');
  }
}

function jstDateOffset(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function readRecordString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function loaded(data: unknown): ToolReadResult {
  return { status: 'loaded', data };
}

function unavailable(error: string): ToolReadResult {
  return { status: 'unavailable', data: null, error };
}

function truncateBlock(text: string, max: number): string {
  const trimmed = (text || 'null').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}\n...省略` : trimmed;
}
