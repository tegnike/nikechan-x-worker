import { POLICY_VERSION } from '../contracts.js';

export interface EgressGuardResult {
  status: 'passed' | 'blocked';
  policyVersion: string;
  reasons: string[];
}

export interface TweetEgressInput {
  tweetText: string;
  topic?: string;
  reasoning?: string;
}

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'openai_api_key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { name: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'bearer_token', pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i },
  { name: 'supabase_service_role', pattern: /\bSUPABASE_(SERVICE_ROLE|JWT|ANON)_KEY\b/i },
  { name: 'discord_token', pattern: /\b(DISCORD|SLACK)_[A-Z_]*TOKEN\b/i },
  { name: 'long_hex_token', pattern: /\b[a-f0-9]{48,}\b/i },
];

const RAW_PRIVATE_MARKERS = [
  /\[(private|secret|internal|ops|relationship|raw memory|canonical memory)\]/i,
  /\b(raw|private)\s+(relationship|memory|episode|memo)\b/i,
  /\bservice role\b/i,
  /\bdiscord channel\b/i,
  /\bsupabase\b/i,
];

const URL_PATTERN = /https?:\/\/\S+/u;
const EXTERNAL_SOURCE_MARKERS = [
  /\bx_search\b/i,
  /\bnews\b/i,
  /\btrends?\b/i,
  /\barticles?\b/i,
  /外部ソース/u,
  /記事/u,
  /ニュース/u,
  /論文/u,
  /発表/u,
  /リリース/u,
  /話題を見/u,
  /記事を読/u,
  /ニュースを見/u,
];
const ABSTRACT_ATMOSPHERE_MARKERS = [
  /空気/u,
  /温度/u,
  /芯/u,
  /気配/u,
  /自然さ/u,
  /私らしさ/u,
  /存在確認/u,
  /つながり/u,
  /やわらか/u,
];
const CONCRETE_ANCHOR_MARKERS = [
  URL_PATTERN,
  /実装/u,
  /保存/u,
  /検出/u,
  /整理/u,
  /更新/u,
  /試/u,
  /読/u,
  /見/u,
  /投稿/u,
  /返信/u,
  /引用/u,
  /名前/u,
  /会話/u,
  /記録/u,
  /メモ/u,
  /画面/u,
  /候補/u,
  /反応/u,
  /\bX\b/u,
  /Discord/u,
  /ELYTH/u,
  /からくり/u,
  /AITuberKit/u,
  /YouTube/u,
  /\bWeb\b/u,
  /Claude Code/u,
  /OpenPaw/u,
  /Grok/u,
];
const READER_MEANINGLESS_DETAIL_MARKERS = [
  /\b\d{4}-\d{2}-\d{2}\b/u,
  /\bKnowledge Base\b/i,
  /\bCoreS3\b/u,
  /\bRAG\b/i,
  /ノード/u,
  /テーブル/u,
  /レコード/u,
  /カラム/u,
  /DB\b/i,
  /\d[\d,]*ノード/u,
];

export function checkTweetEgress(input: string | TweetEgressInput): EgressGuardResult {
  const reasons: string[] = [];
  const tweetText = typeof input === 'string' ? input : input.tweetText;
  const trimmed = tweetText.trim();
  const sourceContext =
    typeof input === 'string'
      ? trimmed
      : [input.tweetText, input.topic, input.reasoning].filter(Boolean).join('\n');

  if (!trimmed) reasons.push('tweet text is empty');
  if (Array.from(trimmed).length > 280) reasons.push('tweet text exceeds 280 characters');
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(trimmed)) reasons.push(`secret-like token detected: ${name}`);
  }
  for (const pattern of RAW_PRIVATE_MARKERS) {
    if (pattern.test(trimmed)) reasons.push('raw private or operational memory marker detected');
  }
  if (!URL_PATTERN.test(trimmed) && EXTERNAL_SOURCE_MARKERS.some((pattern) => pattern.test(sourceContext))) {
    reasons.push('external source or boost candidate requires a source URL');
  }
  if (countMatches(trimmed, ABSTRACT_ATMOSPHERE_MARKERS) >= 2 && countMatches(trimmed, CONCRETE_ANCHOR_MARKERS) < 2) {
    reasons.push('abstract atmosphere phrasing needs concrete anchors');
  }
  if (READER_MEANINGLESS_DETAIL_MARKERS.some((pattern) => pattern.test(stripUrls(trimmed)))) {
    reasons.push('reader-facing tweet should not expose internal dates, counts, or implementation labels');
  }

  return {
    status: reasons.length ? 'blocked' : 'passed',
    policyVersion: POLICY_VERSION,
    reasons,
  };
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function stripUrls(text: string): string {
  return text.replace(URL_PATTERN, '');
}
