import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SkillProposal } from '../contracts.js';

export interface SelfTweetSkill {
  path: string;
  content: string;
  activeRules: string[];
}

export function loadSelfTweetSkill(): SelfTweetSkill {
  const path = resolve(process.env.NIKECHAN_X_WORKER_SELF_TWEET_SKILL_PATH ?? 'skills/self-tweet.md');
  if (!existsSync(path)) {
    return {
      path,
      content: '',
      activeRules: [],
    };
  }
  const content = readFileSync(path, 'utf-8');
  return {
    path,
    content,
    activeRules: parseActiveRules(content),
  };
}

export function applySkillProposal(proposal: SkillProposal): string {
  if (proposal.workflow !== 'self-tweet') {
    throw new Error(`unsupported skill proposal workflow: ${proposal.workflow}`);
  }
  const skill = loadSelfTweetSkill();
  const rule = proposal.proposedRule.trim();
  if (!rule) throw new Error('skill proposal has an empty rule');
  if (skill.activeRules.some((existing) => normalizeRule(existing) === normalizeRule(rule))) {
    return skill.path;
  }

  const nextContent = insertActiveRule(skill.content || defaultSkillContent(), rule);
  mkdirSync(dirname(skill.path), { recursive: true });
  writeFileSync(skill.path, nextContent.endsWith('\n') ? nextContent : `${nextContent}\n`);
  return skill.path;
}

function parseActiveRules(content: string): string[] {
  const lines = content.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^## Active Rules\s*$/u.test(line.trim()));
  if (start === -1) return [];
  const rules: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/u.test(line.trim())) break;
    const match = line.match(/^\s*-\s+(.+?)\s*$/u);
    if (match?.[1]) rules.push(match[1]);
  }
  return rules;
}

function insertActiveRule(content: string, rule: string): string {
  const lines = content.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^## Active Rules\s*$/u.test(line.trim()));
  if (start === -1) {
    return `${content.trim()}\n\n## Active Rules\n\n- ${rule}\n`;
  }
  let insertAt = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(lines[index]?.trim() ?? '')) {
      insertAt = index;
      break;
    }
  }
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  if (before[before.length - 1]?.trim()) before.push('');
  before.push(`- ${rule}`);
  if (after[0]?.trim()) before.push('');
  return [...before, ...after].join('\n');
}

function defaultSkillContent(): string {
  return `# self-tweet Skill

## Active Rules

`;
}

function normalizeRule(rule: string): string {
  return rule.replace(/\s+/g, ' ').trim().toLowerCase();
}
