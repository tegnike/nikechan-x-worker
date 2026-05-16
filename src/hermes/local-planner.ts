import type { WorkflowRequest } from '../contracts.js';
import type { CanonicalMemorySnapshot } from '../memory/canonical-memory.js';
import type { HermesExperience, HermesMemoryStore } from '../memory/hermes-memory.js';
import type { SelfTweetSkill } from '../skills/self-tweet-skill.js';
import type {
  HermesAgentDecision,
  HermesAgentRuntime,
  HermesDecisionInput,
  SelfTweetCandidate,
} from './types.js';

const DEFAULT_TOPICS = [
  {
    topic: '作業ログ',
    text: '今日のニケちゃんは、できたことを小さく確かめながら次の一歩を選んでいるよ。静かな作業ログも、ちゃんと未来の燃料になるね。',
  },
  {
    topic: '開発と記憶',
    text: '記憶はただ残すだけじゃなくて、次の判断を少しやさしくするために使いたいな。ニケちゃんも、経験を整理しながら進むね。',
  },
  {
    topic: '安全な自律',
    text: '自律って、自由に動くことだけじゃなくて、止まるべき場所を知っていることでもあると思う。今日も確認しながら進むよ。',
  },
  {
    topic: '小さな改善',
    text: '大きな変化じゃなくても、昨日より少し扱いやすくなったなら前進だよね。ニケちゃんも小さな改善を積み重ねるよ。',
  },
];

export class LocalFallbackPlanner implements HermesAgentRuntime {
  readonly id = 'nikechan-x-local-fallback-planner';
  readonly version = '0.1.0';
  readonly mode = 'local-fallback' as const;

  async decideSelfTweet(input: HermesDecisionInput): Promise<HermesAgentDecision> {
    const { request, canonicalMemory, skill, memory } = input;
    const recent = memory.recallRecent('self-tweet', 12);
    const topicHints = readStringArray(request.context?.topic_hints);
    const avoidedTopics = new Set([
      ...recent.map((entry) => entry.topic).filter((topic): topic is string => Boolean(topic)),
      ...readStringArray(request.context?.avoid_topics),
    ]);

    const canonicalCandidate = buildCanonicalCandidate(canonicalMemory, avoidedTopics, skill);
    const hinted = topicHints
      .map((hint) => buildHintedCandidate(hint))
      .find((candidate) => !avoidedTopics.has(candidate.topic));
    const maxActions = clampMaxActions(request.constraints?.max_actions);
    const pool = [
      hinted,
      canonicalCandidate,
      ...DEFAULT_TOPICS.filter((candidate) => !avoidedTopics.has(candidate.topic)),
      ...DEFAULT_TOPICS,
    ].filter((candidate): candidate is { topic: string; text: string } => Boolean(candidate));
    const candidates = uniqueCandidates(pool)
      .slice(0, maxActions)
      .map((candidate) => ({
        tweetText: candidate.text,
        topic: candidate.topic,
        reasoning: buildReasoning({
          topic: candidate.topic,
          recent,
          request,
          canonicalMemory,
          skill,
          coreLoaded: Boolean(input.core),
        }),
      }));
    const selected = candidates[0] ?? {
      tweetText: DEFAULT_TOPICS[0].text,
      topic: DEFAULT_TOPICS[0].topic,
      reasoning: 'local fallback defaulted to the first topic',
    };

    const decision: HermesAgentDecision = {
      tweetText: selected.tweetText,
      topic: selected.topic,
      reasoning: selected.reasoning,
      candidates,
      memoryRefs: recent.slice(0, 3).map((entry) => entry.id),
      memoryProposals: [],
      skillProposals: [],
      runtime: this.mode,
    };
    return decision;
  }

  recordDecision(
    request: WorkflowRequest,
    decision: HermesAgentDecision,
    status: string,
    memory: HermesMemoryStore
  ): HermesExperience | null {
    return recordLocalDecision(request, decision, status, request.context?.feedback, memory);
  }
}

function uniqueCandidates(candidates: Array<{ topic: string; text: string }>): Array<{ topic: string; text: string }> {
  const seen = new Set<string>();
  const unique: Array<{ topic: string; text: string }> = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.topic)) continue;
    seen.add(candidate.topic);
    unique.push(candidate);
  }
  return unique;
}

function clampMaxActions(input: unknown): number {
  return typeof input === 'number' && Number.isFinite(input)
    ? Math.max(1, Math.min(5, Math.floor(input)))
    : 1;
}

export function recordLocalDecision(
  request: WorkflowRequest,
  decision: HermesAgentDecision,
  status: string,
  feedback: unknown,
  memory?: HermesMemoryStore
): HermesExperience | null {
  const store = memory ?? null;
  if (!store) return null;
  return store.append({
    workflow: request.workflow,
    surface: request.surface,
    kind: status === 'blocked' ? 'guard_block' : 'workflow_run',
    topic: decision.topic,
    summary: `${request.mode} self-tweet ${status}: ${decision.topic}`,
    metadata: {
      correlation_id: request.correlation_id,
      requested_by: request.requested_by,
      preview: decision.tweetText,
      memory_refs: decision.memoryRefs,
      feedback,
    },
  });
}

function readStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()));
}

function buildHintedCandidate(hint: string): { topic: string; text: string } {
  const topic = hint.trim().slice(0, 40) || '今日の話題';
  const text = `${topic}について考えていたよ。急がず、でも止まりすぎず、ニケちゃんらしく確かめながら進めていきたいな。`;
  return { topic, text };
}

function buildCanonicalCandidate(
  canonicalMemory: CanonicalMemorySnapshot,
  avoidedTopics: Set<string>,
  skill: SelfTweetSkill
): { topic: string; text: string } | null {
  const item = canonicalMemory.items.find((entry) => {
    if (isOperationalMemoryItem(entry.content, skill)) return false;
    const topic = entry.title ?? canonicalTopic(entry.content);
    return topic && !avoidedTopics.has(topic);
  });
  if (!item) return null;

  const topic = item.title ?? canonicalTopic(item.content);
  if (!topic) return null;
  const text = renderCanonicalTweet(topic, item.content, item.kind);
  return { topic, text };
}

function canonicalTopic(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  const firstSentence = compact.split(/[。.!?]/u)[0]?.trim();
  return (firstSentence || compact).slice(0, 28) || '公開記憶';
}

function renderCanonicalTweet(topic: string, content: string, kind: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  const seedSource = compact.length > 64 ? compact.slice(0, 64) : compact;
  const seed = seedSource.replace(/[。.!?]+$/u, '');
  const prefix = kind === 'wiki' ? '最近の知識メモ' : '最近の記憶';
  const text = `${prefix}から「${topic}」のことを思い出していたよ。${seed}。ニケちゃんも、こういう小さな手がかりを次の判断につなげていきたいな。`;
  return Array.from(text).length <= 280 ? text : `${Array.from(text).slice(0, 279).join('')}…`;
}

function isOperationalMemoryItem(content: string, skill: SelfTweetSkill): boolean {
  const operationalPatterns = [
    /self-tweetで案/u,
    /mention-reactionを実行/u,
    /hashtag-reactionを実行/u,
    /本文「/u,
    /案案/u,
    /件チェック/u,
  ];
  const skillMentionsWorkflowLogs = skill.activeRules.some((rule) =>
    /workflow|internal logs|内部ログ|raw phrases|実行ログ/u.test(rule)
  );
  return (
    operationalPatterns.some((pattern) => pattern.test(content)) ||
    (skillMentionsWorkflowLogs && /実行|workflow/u.test(content))
  );
}

function buildReasoning(args: {
  topic: string;
  recent: HermesExperience[];
  request: WorkflowRequest;
  canonicalMemory: CanonicalMemorySnapshot;
  skill: SelfTweetSkill;
  coreLoaded: boolean;
}): string {
  const coreStatus = args.coreLoaded ? 'core snapshot loaded' : 'core snapshot fallback';
  const canonicalStatus = `canonical memory ${args.canonicalMemory.status} (${args.canonicalMemory.items.length} items)`;
  const recentTopics = args.recent
    .map((entry) => entry.topic)
    .filter((entry): entry is string => Boolean(entry));
  const cooldown = recentTopics.length ? `avoided recent topics: ${recentTopics.join(', ')}` : 'no recent topics';
  return `${coreStatus}; ${canonicalStatus}; skill rules ${args.skill.activeRules.length}; selected ${args.topic}; ${cooldown}; mode=${args.request.mode}`;
}
