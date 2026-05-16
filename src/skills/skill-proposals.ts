import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SkillProposal, WorkflowName } from '../contracts.js';
import type { HermesExperience, HermesMemoryStore } from '../memory/hermes-memory.js';
import { applySkillProposal } from './self-tweet-skill.js';

export interface FeedbackInput {
  verdict?: 'revise' | 'reject' | 'approve';
  text: string;
  previous_preview?: string;
  issue_tags: string[];
}

export function readFeedbackInput(context: Record<string, unknown> | undefined): FeedbackInput | null {
  const input = context?.feedback;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  if (!text) return null;
  const verdict = readVerdict(record.verdict);
  const previousPreview =
    typeof record.previous_preview === 'string' && record.previous_preview.trim()
      ? record.previous_preview.trim()
      : undefined;
  const issueTags = Array.isArray(record.issue_tags)
    ? record.issue_tags.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
    : inferIssueTags(`${text} ${previousPreview ?? ''}`);
  return {
    verdict,
    text,
    previous_preview: previousPreview,
    issue_tags: issueTags,
  };
}

export function recordOperatorFeedback(
  memory: HermesMemoryStore,
  workflow: WorkflowName,
  feedback: FeedbackInput | null,
  correlationId?: string
): HermesExperience | null {
  if (!feedback) return null;
  return memory.append({
    workflow,
    surface: 'x',
    kind: 'operator_feedback',
    summary: `${feedback.verdict ?? 'feedback'}: ${feedback.text}`,
    metadata: {
      correlation_id: correlationId,
      verdict: feedback.verdict,
      previous_preview: feedback.previous_preview,
      issue_tags: feedback.issue_tags,
    },
  });
}

export function proposeSkillImprovements(args: {
  workflow: WorkflowName;
  memory: HermesMemoryStore;
  currentPreview: string;
  currentTopic: string;
  feedbackEntry?: HermesExperience | null;
}): SkillProposal[] {
  const feedback = args.memory.recallByKind(args.workflow, 'operator_feedback', 8);
  const evidence = [...(args.feedbackEntry ? [args.feedbackEntry] : []), ...feedback];
  const combined = [
    args.currentPreview,
    args.currentTopic,
    ...evidence.map((entry) => `${entry.summary} ${JSON.stringify(entry.metadata ?? {})}`),
  ].join('\n');
  const issueTags = inferIssueTags(combined);
  const proposals: SkillProposal[] = [];

  if (issueTags.includes('internal_log_leak')) {
    proposals.push(
      createOrReuseProposal({
        workflow: args.workflow,
        title: 'Treat workflow logs as experience, not tweet source text',
        rationale:
          'Dry-run output or operator feedback shows internal workflow fragments leaking into public tweet drafts.',
        proposedRule:
          'When canonical memory is an operational workflow log, use it only as private experience context; do not reuse its raw phrases or labels in tweet text.',
        evidenceRefs: uniqueEvidenceRefs(evidence),
      })
    );
  }

  if (issueTags.includes('fragmented_text')) {
    proposals.push(
      createOrReuseProposal({
        workflow: args.workflow,
        title: 'Reject fragmented source rewrites before presenting',
        rationale: 'Dry-run output or feedback indicates dangling quotes, duplicated labels, or unfinished clauses.',
        proposedRule:
          'Before returning a self-tweet candidate, reject drafts with duplicated labels, dangling quotes, or unfinished clauses and regenerate a complete standalone sentence.',
        evidenceRefs: uniqueEvidenceRefs(evidence),
      })
    );
  }

  for (const proposal of proposals) {
    appendSkillProposalIfNew(proposal);
  }
  return proposals;
}

export function listSkillProposals(): SkillProposal[] {
  const path = proposalStorePath();
  if (!existsSync(path)) return [];
  const proposals = readFileSync(path, 'utf-8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SkillProposal);
  const byRule = new Map<string, SkillProposal>();
  for (const proposal of proposals) {
    const key = `${proposal.workflow}:${normalizeRule(proposal.proposedRule)}`;
    if (!byRule.has(key)) byRule.set(key, proposal);
  }
  return [...byRule.values()];
}

export function applyStoredSkillProposal(id: string, memory?: HermesMemoryStore): string {
  const proposal = listSkillProposals().find((entry) => entry.id === id);
  if (!proposal) throw new Error(`skill proposal not found: ${id}`);
  const path = applySkillProposal(proposal);
  memory?.append({
    workflow: proposal.workflow,
    surface: 'x',
    kind: 'skill_proposal_applied',
    summary: `Applied skill proposal: ${proposal.title}`,
    metadata: {
      proposal_id: proposal.id,
      proposed_rule: proposal.proposedRule,
      skill_path: path,
    },
  });
  return path;
}

function createProposal(input: Omit<SkillProposal, 'type' | 'id' | 'status' | 'createdAt'>): SkillProposal {
  return {
    type: 'skill_proposal',
    id: randomUUID(),
    status: 'proposed',
    createdAt: new Date().toISOString(),
    ...input,
  };
}

function createOrReuseProposal(input: Omit<SkillProposal, 'type' | 'id' | 'status' | 'createdAt'>): SkillProposal {
  const existing = listSkillProposals().find(
    (proposal) =>
      proposal.workflow === input.workflow &&
      normalizeRule(proposal.proposedRule) === normalizeRule(input.proposedRule)
  );
  return existing ?? createProposal(input);
}

function appendSkillProposalIfNew(proposal: SkillProposal): void {
  const exists = listSkillProposals().some((entry) => entry.id === proposal.id);
  if (exists) return;
  const path = proposalStorePath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(proposal)}\n`);
}

function proposalStorePath(): string {
  return resolve(process.env.NIKECHAN_X_WORKER_SKILL_PROPOSALS_PATH ?? '.worker/skill-proposals.jsonl');
}

function readVerdict(input: unknown): FeedbackInput['verdict'] {
  if (input === 'revise' || input === 'reject' || input === 'approve') return input;
  return undefined;
}

function inferIssueTags(text: string): string[] {
  const tags = new Set<string>();
  if (/案案|本文「|self-tweetで案|mention-reactionを実行|hashtag-reactionを実行|workflow|内部ログ/u.test(text)) {
    tags.add('internal_log_leak');
  }
  if (/案案|本文「|引用途中|途中で切れ|未完|dangling|fragment/u.test(text)) {
    tags.add('fragmented_text');
  }
  return [...tags];
}

function uniqueEvidenceRefs(evidence: HermesExperience[]): string[] {
  return [...new Set(evidence.map((entry) => entry.id))].slice(0, 6);
}

function normalizeRule(rule: string): string {
  return rule.replace(/\s+/g, ' ').trim().toLowerCase();
}
