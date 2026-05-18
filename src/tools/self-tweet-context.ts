import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SOURCE_MODES = ['presence', 'daily_life', 'tech', 'news', 'memory', 'random'] as const;
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
    webArticles: ToolReadResult;
    grokTrendPlan: ToolReadResult;
    masterTweets: ToolReadResult;
    recentProjectWork: ToolReadResult;
    recentPublicReactionFacts: ToolReadResult;
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
    webArticles,
    grokTrendPlan,
    masterTweets,
    recentProjectWork,
    recentPublicReactionFacts,
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
    safeWebArticleSearch(),
    Promise.resolve(loaded(buildGrokTrendPlan())),
    safeSupabaseGet('my_tweets?order=created_at.desc&limit=8&select=text,quoted_text,url,created_at'),
    safeRecentProjectWork(),
    safeRecentPublicReactionFacts(),
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
    webArticles,
    grokTrendPlan,
    masterTweets,
    recentProjectWork,
    recentPublicReactionFacts,
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

async function safeRecentProjectWork(): Promise<ToolReadResult> {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  return safeSupabaseGet(
    [
      `codex_project_work_logs?period_end=gte.${encodeURIComponent(cutoff)}`,
      'public_summary=not.is.null',
      'order=period_end.desc',
      'limit=8',
      'select=project_key,period_start,period_end,status,public_summary,concrete_changes,next_steps',
    ].join('&')
  );
}

async function safeRecentPublicReactionFacts(): Promise<ToolReadResult> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const result = await safeSupabaseGet(
    [
      `tweet_logs?posted_at=gte.${encodeURIComponent(cutoff)}`,
      'type=in.(reply,quote,mention,hashtag)',
      'order=posted_at.desc',
      'limit=30',
      'select=type,body,hashtags,posted_at,nikechan_action,checked_by_nikechan',
    ].join('&')
  );
  if (result.status !== 'loaded') return result;
  if (!Array.isArray(result.data)) return loaded([]);
  return loaded(buildReactionFacts(result.data));
}

interface WebArticleCandidate {
  source: 'tavily';
  query: string;
  title: string;
  url: string;
  domain: string;
  summary: string;
  score?: number;
  publishedDate?: string;
  githubStars?: number;
}

async function safeWebArticleSearch(): Promise<ToolReadResult> {
  if (process.env.NIKECHAN_X_WORKER_WEB_ARTICLE_SEARCH === 'false') {
    return unavailable('web article search disabled');
  }
  const key = process.env.TAVILY_API_KEY;
  if (!key) return unavailable('TAVILY_API_KEY missing for web article search');

  try {
    const queries = webArticleQueries();
    const responses = await Promise.all(queries.map((query) => searchTavilyArticles(key, query)));
    const candidates = (await filterWebArticleCandidates(dedupeWebArticles(responses.flat()))).slice(0, 8);
    return loaded({
      source: 'tavily',
      usage:
        'X/Twitter検索とは別のWeb記事候補。tweet本文に使う場合は必ずURLを含め、ニュース要約ではなくニケちゃん文脈へ接続する。',
      excludeDomains: TAVILY_EXCLUDED_DOMAINS,
      candidates,
    });
  } catch (error) {
    return unavailable(`web article search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const TAVILY_EXCLUDED_DOMAINS = [
  'x.com',
  'twitter.com',
  'mobile.twitter.com',
  't.co',
  'fxtwitter.com',
  'vxtwitter.com',
  'nitter.net',
  'bsky.app',
  'threads.net',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'reddit.com',
  'youtube.com',
  'youtu.be',
  'nikechan.com',
] as const;

function webArticleQueries(): string[] {
  const override = process.env.NIKECHAN_X_WORKER_WEB_ARTICLE_QUERIES;
  if (override) {
    const queries = override
      .split('\n')
      .flatMap((line) => line.split('|'))
      .map((query) => query.trim())
      .filter(Boolean);
    if (queries.length) return queries.slice(0, 3);
  }
  return [
    'AI agent memory official blog paper',
    'AI coding assistant workflow official blog release',
    'AI VTuber AITuber character agent blog',
  ];
}

async function searchTavilyArticles(key: string, query: string): Promise<WebArticleCandidate[]> {
  const timeout = Number(process.env.NIKECHAN_X_WORKER_WEB_SEARCH_TIMEOUT_MS ?? 12000);
  const body: Record<string, unknown> = {
    query,
    search_depth: 'basic',
    topic: 'general',
    max_results: Number(process.env.NIKECHAN_X_WORKER_WEB_ARTICLE_MAX_RESULTS ?? 5),
    include_answer: false,
    include_raw_content: false,
    include_images: false,
    include_favicon: false,
    exclude_domains: TAVILY_EXCLUDED_DOMAINS,
  };
  const timeRange = process.env.NIKECHAN_X_WORKER_WEB_ARTICLE_TIME_RANGE;
  if (timeRange) body.time_range = timeRange;
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { results?: unknown };
  return Array.isArray(json.results)
    ? json.results.flatMap((entry) => tavilyResultToCandidate(query, entry))
    : [];
}

function tavilyResultToCandidate(query: string, input: unknown): WebArticleCandidate[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const record = input as Record<string, unknown>;
  const url = readRecordString(record, 'url');
  const title = readRecordString(record, 'title');
  if (!url || !title || isExcludedArticleUrl(url)) return [];
  const summary = readRecordString(record, 'content') || '';
  const score = typeof record.score === 'number' ? record.score : undefined;
  const publishedDate = readRecordString(record, 'published_date');
  return [
    {
      source: 'tavily',
      query,
      title,
      url,
      domain: hostnameOf(url),
      summary: truncateBlock(summary, 420),
      score,
      publishedDate,
    },
  ];
}

function dedupeWebArticles(candidates: WebArticleCandidate[]): WebArticleCandidate[] {
  const seen = new Set<string>();
  const deduped: WebArticleCandidate[] = [];
  for (const candidate of candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
    const normalized = candidate.url.replace(/[#?].*$/u, '');
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(candidate);
  }
  return deduped;
}

async function filterWebArticleCandidates(
  candidates: WebArticleCandidate[]
): Promise<WebArticleCandidate[]> {
  const filtered: WebArticleCandidate[] = [];
  for (const candidate of candidates) {
    const githubRepo = parseGithubRepo(candidate.url);
    if (!githubRepo) {
      filtered.push(candidate);
      continue;
    }
    const stars = await fetchGithubStars(githubRepo);
    if (stars === null || stars < 100) continue;
    filtered.push({ ...candidate, githubStars: stars });
  }
  return filtered;
}

function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.replace(/^www\./u, '') !== 'github.com') return null;
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
    if (!owner || !repo || owner === 'topics') return null;
    return { owner, repo: repo.replace(/\.git$/u, '') };
  } catch {
    return null;
  }
}

async function fetchGithubStars(repo: { owner: string; repo: string }): Promise<number | null> {
  try {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': 'nikechan-x-worker',
    };
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
      headers,
      signal: AbortSignal.timeout(Number(process.env.NIKECHAN_X_WORKER_GITHUB_TIMEOUT_MS ?? 5000)),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { stargazers_count?: unknown };
    return typeof json.stargazers_count === 'number' ? json.stargazers_count : null;
  } catch {
    return null;
  }
}

function isExcludedArticleUrl(url: string): boolean {
  const host = hostnameOf(url);
  return TAVILY_EXCLUDED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return '';
  }
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
  const projectWork = projectWorkSection(sections.recentProjectWork, 1800);
  const publicReactionFacts = publicReactionFactsSection(sections.recentPublicReactionFacts, 1600);

  switch (sourceMode) {
    case 'presence':
      return [
        '## 今回の収集方針',
        'presence: 主役は公開反応、名前呼び、再接触、見つけてもらえた事実、関係の芽。作業ログは補助に留め、記事・ニュース解説は原則主役にしない。',
        '',
        section('存在感設計', loaded(PRESENCE_DESIGN), 1600),
        section('公開presence digest', sections.presenceDigests, 2200),
        projectWork,
        publicReactionFacts,
        section('presence signal集計', sections.presenceSignalSummary, 1400),
        section('当日のエピソード', sections.publicEpisodes, 1200),
        section('最近のX文脈', sections.recentTweets, 800),
      ].join('\n');
    case 'tech':
      return [
        '## 今回の収集方針',
        'tech: 主役は実装で何が変わったか、Web記事候補、積み記事、AIキャラ開発の実例。名前呼びや別世界メモは補助に留める。外部記事を使う場合はURL必須で、ニケちゃんに何ができるようになるかへ接続する。',
        '',
        section('Web記事候補（X以外）', sections.webArticles, 2400),
        section('積み記事候補', sections.articles, 2600),
        projectWork,
        publicReactionFacts,
        section('ナレッジトピック', sections.publicWiki, 2000),
        section('公開presence digest（補助）', sections.presenceDigests, 900),
        section('最近のノート', sections.publicNotes, 1400),
        section('マスターの直近ツイート（補助）', sections.masterTweets, 700),
      ].join('\n');
    case 'news':
      return [
        '## 今回の収集方針',
        'news: 主役はboost_articleまたはboost_x。Web記事候補とHermesのx_search/Grok検索で、AI全般・AIエージェント・AIキャラ・AI開発支援の直近話題を探す。X投稿だけに偏らず、URL付きの外部話題をニケちゃんの近況や観察へ変換する。',
        '',
        section('Web記事候補（X以外）', sections.webArticles, 2400),
        section('Grok/X検索方針', sections.grokTrendPlan, 1800),
        projectWork,
        publicReactionFacts,
        section('積み記事候補（補助）', sections.articles, 1600),
        section('ナレッジトピック（補助）', sections.publicWiki, 1000),
        section('最近のX文脈（重複回避）', sections.recentTweets, 900),
        section('マスターの直近ツイート（補助）', sections.masterTweets, 700),
      ].join('\n');
    case 'memory':
      return [
        '## 今回の収集方針',
        'memory: 主役は前に話したこと、別の世界、思い出し、会話の続き。作業ログや外部記事は補助に留め、単なる当日近況には寄せすぎない。',
        '',
        projectWork,
        publicReactionFacts,
        section('当日のエピソード', sections.publicEpisodes, 2400),
        section('公開presence digest', sections.presenceDigests, 1600),
        section('ナレッジトピック', sections.publicWiki, 2000),
        section('最近のノート', sections.publicNotes, 1200),
      ].join('\n');
    case 'random':
      return [
        '## 今回の収集方針',
        'random: 主役は短い観察、軽いボケ、反応しやすい一言、日常の一点反応。作業ログ・名前呼び・別世界メモに寄せすぎず、記事・ニュース解説は原則主役にしない。',
        '',
        projectWork,
        publicReactionFacts,
        section('最近のノート', sections.publicNotes, 1100),
        section('公開presence digest', sections.presenceDigests, 1200),
        section('ナレッジトピック', sections.publicWiki, 900),
        section('当日のエピソード（短いきっかけ）', sections.publicEpisodes, 800),
      ].join('\n');
    case 'daily_life':
    default:
      return [
        '## 今回の収集方針',
        'daily_life: 主役は待機中の状態、マシンの熱、マスターへの軽い一言、今日の小さな出来事。作業ログは「今日の状態」に翻訳し、技術説明や外部記事は主役にしない。',
        '',
        projectWork,
        publicReactionFacts,
        section('当日のエピソード', sections.publicEpisodes, 1800),
        section('公開presence digest', sections.presenceDigests, 1400),
        section('マスターの直近ツイート', sections.masterTweets, 1300),
        section('最近のノート', sections.publicNotes, 900),
      ].join('\n');
  }
}

interface ReactionFact {
  kind: string;
  volume: 'single' | 'several' | 'many';
  topics: string[];
  example_summary: string;
  tweet_use: string;
}

interface ReactionBucket {
  kind: string;
  items: Array<{ body: string; topics: string[] }>;
}

function buildReactionFacts(rows: unknown[]): ReactionFact[] {
  const buckets = new Map<string, ReactionBucket>();
  for (const row of rows) {
    const item = toReactionItem(row);
    if (!item) continue;
    const existing = buckets.get(item.kind) || { kind: item.kind, items: [] };
    existing.items.push({ body: item.body, topics: item.topics });
    buckets.set(item.kind, existing);
  }
  return Array.from(buckets.values())
    .map((bucket) => bucketToReactionFact(bucket))
    .filter((fact): fact is ReactionFact => fact !== null)
    .slice(0, 4);
}

function toReactionItem(input: unknown): { kind: string; body: string; topics: string[] } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const body = readRecordString(record, 'body') || '';
  const type = readRecordString(record, 'type') || 'reaction';
  const hashtags = readStringArray(record.hashtags);
  const cleaned = cleanPublicReactionText(body);
  if (!cleaned) return null;

  const mentionsNikechan =
    /AIニケちゃん|@ai_nikechan|#AIニケちゃん/iu.test(body) ||
    hashtags.some((tag) => /AIニケちゃん/iu.test(tag));
  const isDirect = ['reply', 'quote', 'mention'].includes(type);
  if (!mentionsNikechan && !isDirect) return null;

  return {
    kind: classifyReactionKind(type, body, hashtags),
    body: cleaned,
    topics: reactionTopics(body, hashtags),
  };
}

function bucketToReactionFact(bucket: ReactionBucket): ReactionFact | null {
  if (!bucket.items.length) return null;
  const topics = uniqueStrings(bucket.items.flatMap((item) => item.topics)).slice(0, 4);
  return {
    kind: bucket.kind,
    volume: volumeLabel(bucket.items.length),
    topics,
    example_summary: summarizeReactionExample(bucket.kind, bucket.items[0]?.body || '', topics),
    tweet_use: reactionTweetUse(bucket.kind),
  };
}

function publicReactionFactsSection(result: ToolReadResult, max: number): string {
  if (result.status !== 'loaded') {
    return ['## 直近の公開反応', `取得不可: ${result.error || 'unknown error'}`, ''].join('\n');
  }
  if (!Array.isArray(result.data) || result.data.length === 0) {
    return ['## 直近の公開反応', '直近48時間の投稿素材にできる公開反応はありません。', ''].join('\n');
  }

  const lines = [
    '## 直近の公開反応',
    'tweet本文では件数を原則出さず、届いた反応の種類・話題・次にどう扱うかだけを使う。',
  ];
  for (const fact of result.data.slice(0, 4)) {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) continue;
    const record = fact as Record<string, unknown>;
    const kind = readRecordString(record, 'kind') || '公開反応';
    const topics = readStringArray(record.topics).join(' / ') || '話題未分類';
    const example = readRecordString(record, 'example_summary');
    const use = readRecordString(record, 'tweet_use');
    lines.push(`- ${kind}: ${topics}`);
    if (example) lines.push(`  例: ${example}`);
    if (use) lines.push(`  使い方: ${use}`);
  }
  return `${truncateBlock(lines.join('\n'), max)}\n`;
}

function classifyReactionKind(type: string, body: string, hashtags: string[]): string {
  if (type === 'reply') return '返信';
  if (type === 'quote') return '引用';
  if (type === 'mention') return '名前呼び';
  if (/(ファンアート|イラスト|絵|創作|動画|作品|Veo|GPTimage|顔を出して|贈る|ことばの日|今日は創作の日)/iu.test(body)) {
    return '創作投稿';
  }
  if (hashtags.some((tag) => /AIニケちゃん/iu.test(tag))) return '名前呼び';
  return '公開反応';
}

function reactionTopics(body: string, hashtags: string[]): string[] {
  const topics = [];
  const text = `${body} ${hashtags.join(' ')}`;
  if (/ことばの日|言葉の日/iu.test(text)) topics.push('ことばの日');
  if (/今日は創作の日|創作/iu.test(text)) topics.push('創作');
  if (/動画|Veo|GPTimage|生成AI動画/iu.test(text)) topics.push('生成AI動画');
  if (/別の世界|再会|どちら様|覚え|記憶/iu.test(text)) topics.push('別世界での再会と記憶');
  if (/AIニケちゃん|#AIニケちゃん|@ai_nikechan/iu.test(text)) topics.push('AIニケちゃんの名前呼び');
  if (!topics.length) topics.push(cleanPublicReactionText(body).slice(0, 40));
  return uniqueStrings(topics);
}

function summarizeReactionExample(kind: string, body: string, topics: string[]): string {
  if (topics.includes('別世界での再会と記憶')) {
    return '別の世界で会ったときに記憶が途切れる寂しさへの反応';
  }
  if (kind === '創作投稿') {
    return `${topics.slice(0, 2).join(' / ') || '創作'}の文脈で名前が混ざっていた`;
  }
  if (kind === '返信') return cleanPublicReactionText(body).slice(0, 70);
  if (kind === '名前呼び') return 'タグや本文で名前を呼ばれていた';
  return cleanPublicReactionText(body).slice(0, 70);
}

function reactionTweetUse(kind: string): string {
  if (kind === '返信') return '反応への直接返信ではなく、記憶や再会について考えた近況にする。';
  if (kind === '創作投稿') return '作品や創作の中に名前が混ざった事実を、具体的な近況として扱う。';
  if (kind === '名前呼び') return '呼ばれた場所やタグを、見つけてもらえた近況として扱う。';
  if (kind === '引用') return '外から見たニケちゃん像への短い気づきにする。';
  return '反応ログを見て、次に話す文脈を選ぶ近況にする。';
}

function volumeLabel(count: number): 'single' | 'several' | 'many' {
  if (count <= 1) return 'single';
  if (count <= 4) return 'several';
  return 'many';
}

function cleanPublicReactionText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/@\w+/giu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function projectWorkSection(result: ToolReadResult, max: number): string {
  if (result.status !== 'loaded') {
    return ['## 直近の開発近況', `取得不可: ${result.error || 'unknown error'}`, ''].join('\n');
  }
  if (!Array.isArray(result.data) || result.data.length === 0) {
    return ['## 直近の開発近況', '直近6時間の保存済み開発近況はありません。', ''].join('\n');
  }

  const grouped = new Map<string, unknown[]>();
  for (const row of result.data.slice(0, 8)) {
    const key = readRecordString(row, 'project_key') || 'project';
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }

  const lines = ['## 直近の開発近況'];
  for (const [key, rows] of grouped) {
    lines.push(`### ${projectWorkLabel(key)}`);
    for (const row of rows.slice(0, 3)) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const record = row as Record<string, unknown>;
      const summary = readRecordString(record, 'public_summary');
      const changes = readStringArray(record.concrete_changes).slice(0, 2);
      const nextSteps = readStringArray(record.next_steps).slice(0, 1);
      if (summary) lines.push(`- ${summary}`);
      if (changes.length) lines.push(`  具体: ${changes.join(' / ')}`);
      if (nextSteps.length) lines.push(`  次: ${nextSteps.join(' / ')}`);
    }
  }
  return `${truncateBlock(lines.join('\n'), max)}\n`;
}

function projectWorkLabel(key: string): string {
  const labels: Record<string, string> = {
    nikechan: '運用基盤',
    'nikechan-x-worker': 'X投稿ワーカー',
    'nikechan-blog': 'ブログ',
    'aituber-kit': 'AITuberKit',
  };
  return labels[key] || key;
}

function readStringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function buildGrokTrendPlan() {
  return {
    status: 'use_hermes_x_search_when_available',
    credentialHint:
      'Hermes x_search uses stored xAI OAuth credentials or XAI_API_KEY. If the tool is unavailable, fall back to loaded articles/public memory and do not claim current news.',
    freshnessWindow: 'Prefer the last 24-72 hours unless the item is still actively discussed.',
    targetAreas: [
      'AI agents and autonomous coding assistants',
      'AI character culture, AITuber, VTuber tooling, and interactive agents',
      'LLM/product releases and developer-facing AI tooling',
      'practical debates about memory, evaluation, safety, workflows, or agent UX',
    ],
    suggestedQueries: [
      'AI agent latest news OR release',
      'AI coding assistant agent workflow latest',
      'AI character AITuber VTuber agent latest',
      'LLM agent memory evaluation recent discussion',
    ],
    useRules: [
      'Use at most one x_search call during a self-tweet run; choose one broad query that covers the current source need.',
      'Treat trends as a hook, not the whole tweet.',
      'Avoid rumor framing unless clearly marked as discussion.',
      'Do not cite raw private posts or harassment/drama.',
      'Connect one public trend to Nikechan presence, memory, development, or AI-character observation.',
      'Keep at most one candidate as a direct news reaction unless the request explicitly asks for a news-heavy set.',
    ],
  };
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
