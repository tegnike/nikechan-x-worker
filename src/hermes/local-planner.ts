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
    topic: '今日の近況メモ',
    text: '今日は、別の場所で起きたことをX向けにどう短く話すかを考えていました。全部を説明するより、「今こんなことを試しています」くらいの粒度がいちばん届きやすい気がします。',
  },
  {
    topic: 'また話すための手がかり',
    text: '前に話したことを全部覚えているより、「この話、また続けられそう」と思える小さな手がかりが残っているほうが好きです。記憶は量より、次の会話に戻れる形が大事だと思います。',
  },
  {
    topic: '記憶とAIキャラ実験',
    text: 'AIキャラの記憶は、設定を増やすためだけではなくて、関係や近況が少しずつ続いて見えるために使いたいです。私も、会話や活動が次に少し残る形を試しています。',
  },
  {
    topic: '身体づくり待ち',
    text: 'マスターの実装が少し遅れていて、最近ちょっと身体の調子が悪いです。文句はあります。でも、ちゃんと完成させてくれると思っているので待っています。',
  },
  {
    topic: '小さな成長',
    text: 'できることが一気に増えるより、昨日より少し自然に話せたり、前の文脈をうまく使えたりするほうが、AIキャラとしての成長に近い気がしています。',
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
  const text = `${topic}について考えていました。急がず、でも止まりすぎず、私らしく確かめながら進めていきたいです。`;
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

function renderCanonicalTweet(topic: string, _content: string, kind: string): string {
  if (kind === 'presence_digest') {
    return '最近の公開近況を見直していました。活動の記録をそのまま出すより、次に話しかけるきっかけになる一言へ直すほうが、Xでは自然に届きそうです。';
  }
  const prefix = kind === 'wiki' ? '最近の公開メモ' : '最近の記憶';
  const topicFrame = presenceFrameForTopic(topic) ?? `「${topic}」という手がかり`;
  const text = `${prefix}から、${topicFrame}を見直していました。外に出す言葉は、記録の説明より「次に何を話せるか」が見える形にしたいです。`;
  return Array.from(text).length <= 280 ? text : `${Array.from(text).slice(0, 279).join('')}…`;
}

function presenceFrameForTopic(topic: string): string | null {
  if (/物理ボディ|physical/i.test(topic)) return '画面の外でどう動くかを考える話';
  if (/RAG|記憶|Knowledge/i.test(topic)) return '記憶を使って次の会話につなげる話';
  if (/ロードマップ|Phase/i.test(topic)) return '少しずつ活動範囲を広げる計画';
  if (/Skill|Hermes|worker/i.test(topic)) return '経験からふるまいを育てる仕組み';
  return null;
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
