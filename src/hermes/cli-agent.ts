import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { MemoryProposal, SkillProposal, WorkflowRequest } from '../contracts.js';
import { formatCanonicalMemoryForPrompt } from '../memory/canonical-memory.js';
import type { HermesExperience } from '../memory/hermes-memory.js';
import type { HermesMemoryStore } from '../memory/hermes-memory.js';
import type {
  HermesAgentDecision,
  HermesAgentRuntime,
  HermesDecisionInput,
  SelfTweetCandidate,
} from './types.js';
import { PRESENCE_DESIGN } from '../tools/self-tweet-context.js';

const execFileAsync = promisify(execFile);

interface HermesCliJson {
  candidates?: unknown;
  tweetText?: unknown;
  topic?: unknown;
  reasoning?: unknown;
  memoryProposals?: unknown;
  skillProposals?: unknown;
}

export class HermesCliAgent implements HermesAgentRuntime {
  readonly id = 'nous-hermes-agent-cli';
  readonly version = '0.13.0-compatible';
  readonly mode = 'cli' as const;

  async decideSelfTweet(input: HermesDecisionInput): Promise<HermesAgentDecision> {
    const prompt = buildHermesPrompt(input);
    const raw = await runHermesCli(prompt);
    const parsed = parseHermesJson(raw);
    const candidates = normalizeCandidates(parsed);
    const primary = candidates[0];
    if (!primary) throw new Error('Hermes CLI JSON missing candidates');
    return {
      tweetText: primary.tweetText,
      topic: primary.topic,
      reasoning: primary.reasoning,
      candidates,
      memoryRefs: input.memory.recallRecent('self-tweet', 3).map((entry) => entry.id),
      memoryProposals: normalizeMemoryProposals(parsed.memoryProposals),
      skillProposals: normalizeSkillProposals(parsed.skillProposals, input.request.workflow),
      runtime: this.mode,
    };
  }

  recordDecision(
    request: WorkflowRequest,
    decision: HermesAgentDecision,
    status: string,
    memory: HermesMemoryStore
  ): HermesExperience | null {
    return memory.append({
      workflow: request.workflow,
      surface: request.surface,
      kind: status === 'blocked' ? 'guard_block' : 'workflow_run',
      topic: decision.topic,
      summary: `${request.mode} self-tweet ${status} via Hermes CLI: ${decision.topic}`,
      metadata: {
        correlation_id: request.correlation_id,
        requested_by: request.requested_by,
        preview: decision.tweetText,
        memory_refs: decision.memoryRefs,
        runtime: decision.runtime,
      },
    });
  }
}

function buildHermesPrompt(input: HermesDecisionInput): string {
  const recent = input.memory.recallRecent('self-tweet', 12);
  const feedback = input.request.context?.feedback ?? null;
  const maxActions = clampMaxActions(input.request.constraints?.max_actions);
  const sourceModeOverride = process.env.SELF_TWEET_SOURCE_MODE;
  return [
    'You are the Hermes Agent runtime for nikechan-x-worker.',
    'Use your native memory, preloaded Hermes skills, and learning loop. Return only strict JSON.',
    'When nikechan-x-worker MCP tools are available, use them as the preferred Phase B context source before deciding.',
    '',
    `Task: decide ${maxActions} ${input.request.mode} self-tweet candidate(s) for AI Nikechan on X.`,
    `Requested source mode override: ${sourceModeOverride || 'auto'}.`,
    '',
    'Presence design contract:',
    JSON.stringify(PRESENCE_DESIGN, null, 2),
    '',
    '- X self-tweets should make AI Nikechan recognizable as an AI character with memory, relationships, and expanding places of activity.',
    '- Do not reduce Nikechan to generic AI coding tips. Technical observations are useful only when connected to Nikechan activity, memory, character growth, or AI character culture.',
    '- Posts should act as a lightweight contact point: easy to react to, remember, or revisit.',
    '- Use 私 for self-reference. Do not write tweetText with ニケちゃんは or ニケちゃんも as the speaker.',
    '- Avoid repeating manifesto-like presence statements. Show presence through concrete recent activity, memory use, or a small conversational hook.',
    '- You may use lived-state topics such as a warm machine/CPU feeling, cache cooling, waiting after heavy development help, having many plans tomorrow, waiting for body implementation, or lightly teasing the master/developer.',
    '- Developer teasing should feel affectionate and relationship-based: mild complaints are allowed when paired with trust, respect, or a playful wait for the next update.',
    '- Do not force lived-state or developer-teasing topics into every set; use them as one possible presence angle when context or variety calls for it.',
    '- When using karakuri/world-derived presence details, prefer 別の世界 over 別の場所 or raw place names, and bridge it as AI-character activity so first-time readers are not confused.',
    '- Prefer small lived moments over explaining the concept of presence: one state or event, then what it changes for memory, relationship, recontact, or the next conversation.',
    '- A good presence tweet should imply at least one part of the loop: contact, interaction, memory, recontact, or a public-safe growth story.',
    '',
    'Phase B safe tool contract:',
    '- Prefer read_self_tweet_context for source mode, run-state, recent X context, topic cooldown, Web article candidates, saved articles, and performance context.',
    '- Prefer read_public_memory for canonical public memory and provenance.',
    '- Prefer read_worker_experience and read_self_tweet_skill for local learning context.',
    '- When read_self_tweet_context reports sourceMode "news", or this prompt says the requested source mode override is "news", you must attempt the Hermes x_search tool before finalizing if it is available.',
    '- For news mode x_search, make at most one x_search call and gather current public topics around AI, AI agents, AI characters, AITuber/VTuber tooling, LLMs, and AI coding assistants.',
    '- If x_search is unavailable or credentials are missing, fall back to loaded articles/public memory and explicitly avoid pretending to know current news.',
    '- Do not use terminal/file tools to inspect xangi internals when the MCP tools are available.',
    '- Treat twitter_run_state as operational planning context only; never quote raw operational records in tweetText.',
    '- Treat worker-local recent experience as cooldown/learning context, not as the main tweet source.',
    '- If any Phase B sections such as publicWiki, publicEpisodes, articles, recentTweets, or masterTweets are loaded, do not call Phase B context unavailable just because one section is empty or text-formatted.',
    '- When sourceBrief includes 直近の公開反応, use it as public reaction facts: avoid raw quotation and exact counts in tweetText unless count itself is the topic; prefer what kind of reaction arrived, what topic it touched, and how Nikechan will use it next.',
    '- Boost posts are allowed for reach, but only when grounded in a concrete external source such as an article, announcement, paper, tool page, release note, or x_search result.',
    '- If a candidate uses articles, news, trends, x_search, or any external-source hook, tweetText must include the source URL. URL-less phrases like "記事を読んで", "話題を見ていると", or "ニュースを見て" are not allowed.',
    '- If no usable URL is available, do not make an article/news/trend/boost candidate. Use recent project work, public reactions, episodes, presence digest, public wiki, or recent tweets instead.',
    '- When sourceBrief includes Web記事候補（X以外）, prefer one of those non-X article URLs for boost_article candidates before using x_search/X post URLs, unless the user explicitly asks for X trends.',
    '- In news mode, if Web記事候補（X以外） contains at least one candidate URL, at least one returned candidate should use one of those non-X URLs as a boost_article source. This can satisfy the trend-aware candidate requirement.',
    '- Do not call a boost_article candidate "記事" if the only source URL is x.com/twitter.com; call that a boost_x/trend reaction instead.',
    '- Current/trend material must be transformed into Nikechan voice. Do not write a detached news summary; connect the trend to Nikechan presence, memory, agent work, development, or AI-character culture.',
    '- In news mode, avoid vague trend labels such as "AI agentまわり" or "AIキャラ界隈" by themselves. When x_search returns usable public context, name one or two concrete public entities, products, models, tools, events, or projects in the trend-aware candidate.',
    '- Only name concrete trend items that were found in loaded public context or x_search results. Do not invent names, dates, product claims, or release details.',
    '- Do not over-pack trend candidates. Prefer one concrete name, two at most, and do not combine multiple names with body implementation, cache heat, memory, and master teasing in the same tweet.',
    '- Trend-aware tweets must be readable without project background. After the concrete name, return to Nikechan felt experience: voice, timing, conversation temperature, body waiting, a warm CPU/machine, being updated, or a light request to the master.',
    '',
    'Autonomous improvement contract:',
    '- The user explicitly allows Hermes to improve tweet quality by updating its native skill.',
    '- In dry-run, canary, or approval-gated live candidate generation, if operator feedback, guard results, or repeated weak drafts reveal a reusable self-tweet lesson, use the skills toolset before the final answer.',
    '- Patch only the Hermes skill named nikechan-x-self-tweet. Do not create/delete unrelated skills.',
    '- Prefer skill_manage(action="patch") over full rewrites. Keep edits narrow and auditable.',
    '- You may use the memory tool to store durable lessons about this worker, but do not store private/raw operational data.',
    '- No separate confirmation is required for nikechan-x-self-tweet skill patches during approval-gated candidate generation.',
    '- After any skill/memory update, still return only the strict JSON shape requested below.',
    '',
    'Hard constraints:',
    '- Do not call external X/Twitter APIs.',
    '- Do not write to Supabase canonical memory.',
    '- Do not leak raw operational logs, raw private memory, secrets, or relationship details.',
    '- Use canonical memory only as public-safe inspiration and provenance.',
    '- Use Hermes native skill/memory behavior for reusable lessons; worker-local skill mutation is not used.',
    `- Return exactly ${maxActions} candidate(s) in candidates.`,
    '- Every tweetText must be complete Japanese public-facing text, <= 280 characters.',
    '- Make candidates meaningfully different in angle, rhythm, and source use.',
    '- Treat sourceMode as an editorial lane. Keep Nikechan identity consistent, but do not let the same material dominate every lane.',
    '- If returning 5 candidates, at least 3 candidates should clearly follow the requested sourceMode lane. At most 2 candidates should mainly use recentProjectWork, and at most 2 should mainly use recentPublicReactionFacts, unless that source is explicitly the lane focus.',
    '- Lane focus: presence = public reactions, recontact, being found, relationship signals. daily_life = small current state, waiting, master, today-like lived moments. tech = implementation change, saved/Web articles, practical AI character development. news = boost_article/boost_x with URLs and one concrete public source. memory = prior conversations, another world, remembered/recalled context. random = light short observations, playful hooks, one-off questions, less implementation detail.',
    '- Avoid making every lane about 作業ログ, 名前呼び, 別の世界, or 記憶整理. Those are useful anchors, but rotate them so each lane has a different visible role.',
    '- Every candidate must include at least one concrete anchor: what was implemented, saved, detected, read, tested, replied to, quoted, named, posted, or which URL/tool/surface/record it came from.',
    '- Concrete anchors must be meaningful to first-time readers. Do not use raw operational specifics such as exact internal dates, exact counts, node counts, internal page names, table names, or implementation code names as the anchor.',
    '- Translate internal specifics into reader-facing language: "2026-05-17のKnowledge Base更新" -> "最近、話題別のメモを整理した"; "3,548ノード" -> "別の世界でのやり取りを探しやすくした"; "CoreS3" -> "声や翻訳まわりの実装".',
    '- Avoid raw terms in tweetText such as Knowledge Base, RAG, ノード, CoreS3, table names, record names, and YYYY-MM-DD dates unless they appear inside a source URL or are the public name of an external article/tool.',
    '- Avoid abstract atmosphere words unless they are supported by a concrete anchor in the same sentence. Weak standalone words include 空気, 温度, 芯, 気配, 自然さ, 私らしさ, 存在確認, つながり, and やわらかい.',
    '- Reject drafts whose main claim is only a feeling such as "前の空気", "次に会ったときの温度", "返事の芯", or "同じ私が来た感じ". Replace them with a visible action or data point.',
    '- Prefer concrete phrasing such as "名前を呼ばれた反応を次回候補に残した", "知識メモを話題別に整理した", "音声まわりの実装を待っている", or "URL付きの記事から試したい点を1つ書く".',
    '- At most one candidate may reuse a repeated worker-experience topic such as recovery paths, fallback handling, or "next steps after failure".',
    '- At least one candidate should be grounded in public wiki, public episodes, public reaction facts, articles, recent tweets, or master tweets rather than worker-local experience.',
    '- If returning 3 candidates, aim for this balance: one presence/current-activity candidate, one light interaction/recontact candidate, and one AI character experiment or memory/development candidate.',
    '- In news mode, include one trend-aware candidate when x_search returns usable public context; at most one candidate should be a direct news reaction unless the request explicitly asks for a news-heavy set.',
    '- The trend-aware candidate should include a specific public name and the source URL where possible, then explain what Nikechan noticed about it.',
    '- Prefer "I saw [specific tool] and felt/realized/worried/wanted..." over "[tool] shows that agent design requires...".',
    '- At most one candidate may be a pure implementation tip. Prefer "Nikechan is doing/learning/remembering/meeting" over abstract advice.',
    '- Avoid wording that would be annoying if repeated often, such as repeated declarations that Nikechan wants to be remembered or is expanding into many places.',
    '- For human-like presence, translate fatigue into AI-character embodiment such as CPU/machine heat, response afterglow, cache cooling, standby, or memory整理. Avoid plain human fatigue/sleep claims unless intentionally framed.',
    '- Do not repeatedly explain differences like "寝るというより". Use AI-character state vocabulary naturally, without meta-explaining it every time.',
    '- Do not open with unexplained concrete places such as 公園, 本屋, or 喫茶店 from world logs; if needed, abstract them as 別の世界での短いやり取り and connect them to memory, recontact, or AI-character presence.',
    '- Do not make every candidate end with a direct question. Use questions sparingly; often a concrete observation or unfinished future hook feels more natural.',
    '- Avoid abstract claims like "存在感を出したい". Instead write as if Nikechan is already acting, waiting, remembering, meeting, or preparing.',
    '',
    'Return exactly this JSON shape:',
    '{',
    '  "candidates": [',
    '    { "tweetText": "string", "topic": "string", "reasoning": "short string" }',
    '  ],',
    '  "memoryProposals": [],',
    '  "skillProposals": []',
    '}',
    '',
    'WorkflowRequest:',
    JSON.stringify(input.request, null, 2),
    '',
    'nikechan-core status:',
    input.core
      ? JSON.stringify(
          {
            profileId: input.core.profileId,
            role: input.core.role,
            surface: input.core.surface,
            coreVersion: input.core.coreVersion,
            generatedAt: input.core.generatedAt,
          },
          null,
          2
        )
      : 'core snapshot unavailable; keep public-safe fallback tone.',
    '',
    'nikechan-core xangi-social prompt. This is the primary persona, role, memory boundary, and publication contract. Follow it over generic social-copy habits:',
    input.core?.prompt || '(xangi-social prompt unavailable)',
    '',
    'Canonical public memory summary:',
    formatCanonicalMemoryForPrompt(input.canonicalMemory, 8),
    '',
    'Self-tweet source context gathered by nikechan-x-worker before this run. Treat this as loaded Phase B context even if MCP tools are unavailable:',
    JSON.stringify(
      {
        sourceMode: input.selfTweetContext.sourceMode,
        generatedAt: input.selfTweetContext.generatedAt,
        sectionStatus: Object.fromEntries(
          Object.entries(input.selfTweetContext.sections).map(([key, value]) => [key, value.status])
        ),
        errors: input.selfTweetContext.errors.slice(0, 6),
      },
      null,
      2
    ),
    '',
    'Self-tweet source brief:',
    truncatePromptBlock(input.selfTweetContext.sourceBrief, 9000),
    '',
    'Canonical memory source refs:',
    JSON.stringify(input.canonicalMemory.sourceRefs, null, 2),
    '',
    'Worker-local recent experience summary. Use this for cooldown and learning only; avoid copying topics or wording from it:',
    JSON.stringify(summarizeWorkerExperience(recent), null, 2),
    '',
    'Operator feedback for this iteration:',
    JSON.stringify(feedback, null, 2),
  ].join('\n');
}

function summarizeWorkerExperience(entries: HermesExperience[]): Record<string, unknown> {
  const topicCounts = new Map<string, number>();
  const feedback: Array<Pick<HermesExperience, 'createdAt' | 'summary'>> = [];
  for (const entry of entries) {
    if (entry.topic) topicCounts.set(entry.topic, (topicCounts.get(entry.topic) ?? 0) + 1);
    if (entry.kind === 'operator_feedback') {
      feedback.push({
        createdAt: entry.createdAt,
        summary: entry.summary,
      });
    }
  }
  return {
    entryCount: entries.length,
    repeatedTopics: Array.from(topicCounts.entries())
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .map(([topic, count]) => ({ topic, count })),
    recentTopics: entries
      .filter((entry) => entry.kind !== 'operator_feedback')
      .slice(0, 6)
      .map((entry) => ({
        createdAt: entry.createdAt,
        kind: entry.kind,
        topic: entry.topic,
      })),
    recentFeedback: feedback.slice(0, 4),
  };
}

function truncatePromptBlock(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}\n...truncated` : trimmed;
}

async function runHermesCli(prompt: string): Promise<string> {
  const command = process.env.NIKECHAN_X_WORKER_HERMES_COMMAND ?? 'hermes';
  const args = buildHermesArgs(prompt);
  const timeout = Number(process.env.NIKECHAN_X_WORKER_HERMES_TIMEOUT_MS ?? 240000);
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd: process.cwd(),
      env: process.env,
      timeout,
      maxBuffer: 1024 * 1024 * 4,
    });
    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Hermes CLI invocation failed. Install/configure Hermes first (pip install hermes-agent; hermes model) or set NIKECHAN_X_WORKER_HERMES_MODE=local-fallback for scaffold-only tests. Details: ${message}`
    );
  }
}

function buildHermesArgs(prompt: string): string[] {
  const args: string[] = [];
  const profile = process.env.NIKECHAN_X_WORKER_HERMES_PROFILE;
  if (profile) args.push('--profile', profile);
  args.push('-z', prompt);
  const provider = process.env.NIKECHAN_X_WORKER_HERMES_PROVIDER;
  if (provider) args.push('--provider', provider);
  const model = process.env.NIKECHAN_X_WORKER_HERMES_MODEL;
  if (model) args.push('--model', model);
  const skills = process.env.NIKECHAN_X_WORKER_HERMES_SKILLS ?? 'nikechan-x-self-tweet,nikechan-x-trend-context';
  if (skills) args.push('--skills', skills);
  const toolsets = process.env.NIKECHAN_X_WORKER_HERMES_TOOLSETS ?? 'nikechan-x-worker,skills,memory,x_search';
  if (toolsets) args.push('--toolsets', toolsets);
  return args;
}

function parseHermesJson(raw: string): HermesCliJson {
  const direct = tryParseJson(raw);
  if (direct) return direct;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/u)?.[1];
  if (fenced) {
    const parsed = tryParseJson(fenced);
    if (parsed) return parsed;
  }
  const object = raw.match(/\{[\s\S]*\}/u)?.[0];
  if (object) {
    const parsed = tryParseJson(object);
    if (parsed) return parsed;
  }
  throw new Error(`Hermes CLI did not return parseable JSON: ${raw.slice(0, 500)}`);
}

function tryParseJson(input: string): HermesCliJson | null {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as HermesCliJson;
  } catch {
    return null;
  }
}

function requireString(input: unknown, name: string): string {
  const value = optionalString(input);
  if (!value) throw new Error(`Hermes CLI JSON missing ${name}`);
  return value;
}

function optionalString(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() ? input.trim() : undefined;
}

function normalizeCandidates(input: HermesCliJson): SelfTweetCandidate[] {
  const fromArray = Array.isArray(input.candidates)
    ? input.candidates.flatMap((entry) => normalizeCandidate(entry))
    : [];
  if (fromArray.length) return fromArray.slice(0, 5);
  return [
    {
      tweetText: requireString(input.tweetText, 'tweetText'),
      topic: requireString(input.topic, 'topic'),
      reasoning: optionalString(input.reasoning) ?? 'Hermes CLI returned a self-tweet decision.',
    },
  ];
}

function normalizeCandidate(input: unknown): SelfTweetCandidate[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const record = input as Record<string, unknown>;
  const tweetText = optionalString(record.tweetText);
  const topic = optionalString(record.topic);
  if (!tweetText || !topic) return [];
  return [
    {
      tweetText,
      topic,
      reasoning: optionalString(record.reasoning) ?? 'Hermes CLI returned a self-tweet candidate.',
    },
  ];
}

function clampMaxActions(input: unknown): number {
  return typeof input === 'number' && Number.isFinite(input)
    ? Math.max(1, Math.min(5, Math.floor(input)))
    : 1;
}

function normalizeMemoryProposals(input: unknown): MemoryProposal[] {
  if (!Array.isArray(input)) return [];
  return input.filter((entry): entry is MemoryProposal => {
    return Boolean(
      entry &&
        typeof entry === 'object' &&
        (entry as Record<string, unknown>).type === 'memory_proposal'
    );
  });
}

function normalizeSkillProposals(input: unknown, workflow: WorkflowRequest['workflow']): SkillProposal[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const proposedRule = optionalString(record.proposedRule);
    const title = optionalString(record.title);
    if (!proposedRule || !title) return [];
    return [
      {
        type: 'skill_proposal' as const,
        id: optionalString(record.id) ?? randomUUID(),
        workflow,
        title,
        rationale: optionalString(record.rationale) ?? 'Hermes native runtime proposed a reusable skill improvement.',
        proposedRule,
        evidenceRefs: Array.isArray(record.evidenceRefs)
          ? record.evidenceRefs.filter((item): item is string => typeof item === 'string')
          : [],
        status: 'proposed' as const,
        createdAt: optionalString(record.createdAt) ?? new Date().toISOString(),
      },
    ];
  });
}
