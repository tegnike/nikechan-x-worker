import { POLICY_VERSION } from '../contracts.js';

export interface EgressGuardResult {
  status: 'passed' | 'blocked';
  policyVersion: string;
  reasons: string[];
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

export function checkTweetEgress(text: string): EgressGuardResult {
  const reasons: string[] = [];
  const trimmed = text.trim();

  if (!trimmed) reasons.push('tweet text is empty');
  if (Array.from(trimmed).length > 280) reasons.push('tweet text exceeds 280 characters');
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(trimmed)) reasons.push(`secret-like token detected: ${name}`);
  }
  for (const pattern of RAW_PRIVATE_MARKERS) {
    if (pattern.test(trimmed)) reasons.push('raw private or operational memory marker detected');
  }

  return {
    status: reasons.length ? 'blocked' : 'passed',
    policyVersion: POLICY_VERSION,
    reasons,
  };
}
