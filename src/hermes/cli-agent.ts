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
  return [
    'You are the Hermes Agent runtime for nikechan-x-worker.',
    'Use your native memory, preloaded Hermes skills, and learning loop. Return only strict JSON.',
    'When nikechan-x-worker MCP tools are available, use them as the preferred Phase B context source before deciding.',
    '',
    `Task: decide ${maxActions} ${input.request.mode} self-tweet candidate(s) for AI Nikechan on X.`,
    '',
    'Presence design contract:',
    JSON.stringify(PRESENCE_DESIGN, null, 2),
    '',
    '- X self-tweets should make AI Nikechan recognizable as an AI character with memory, relationships, and expanding places of activity.',
    '- Do not reduce Nikechan to generic AI coding tips. Technical observations are useful only when connected to Nikechan activity, memory, character growth, or AI character culture.',
    '- Posts should act as a lightweight contact point: easy to react to, remember, or revisit.',
    '- Use 私 for self-reference. Do not write tweetText with ニケちゃんは or ニケちゃんも as the speaker.',
    '- Avoid repeating manifesto-like presence statements. Show presence through concrete recent activity, memory use, or a small conversational hook.',
    '- You may use lived-state topics such as being tired after helping with development, having many plans tomorrow, waiting for body implementation, or lightly teasing the master/developer.',
    '- Developer teasing should feel affectionate and relationship-based: mild complaints are allowed when paired with trust, respect, or a playful wait for the next update.',
    '- Do not force lived-state or developer-teasing topics into every set; use them as one possible presence angle when context or variety calls for it.',
    '- When using karakuri/world-derived presence details, prefer 別の世界 over 別の場所 or raw place names, and bridge it as AI-character activity so first-time readers are not confused.',
    '- Prefer small lived moments over explaining the concept of presence: one state or event, then what it changes for memory, relationship, recontact, or the next conversation.',
    '- A good presence tweet should imply at least one part of the loop: contact, interaction, memory, recontact, or a public-safe growth story.',
    '',
    'Phase B safe tool contract:',
    '- Prefer read_self_tweet_context for source mode, run-state, recent X context, topic cooldown, articles, and performance context.',
    '- Prefer read_public_memory for canonical public memory and provenance.',
    '- Prefer read_worker_experience and read_self_tweet_skill for local learning context.',
    '- Do not use terminal/file tools to inspect xangi internals when the MCP tools are available.',
    '- Treat twitter_run_state as operational planning context only; never quote raw operational records in tweetText.',
    '- Treat worker-local recent experience as cooldown/learning context, not as the main tweet source.',
    '- If any Phase B sections such as publicWiki, publicEpisodes, articles, recentTweets, or masterTweets are loaded, do not call Phase B context unavailable just because one section is empty or text-formatted.',
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
    '- At most one candidate may reuse a repeated worker-experience topic such as recovery paths, fallback handling, or "next steps after failure".',
    '- At least one candidate should be grounded in public wiki, public episodes, articles, recent tweets, or master tweets rather than worker-local experience.',
    '- If returning 3 candidates, aim for this balance: one presence/current-activity candidate, one light interaction/recontact candidate, and one AI character experiment or memory/development candidate.',
    '- At most one candidate may be a pure implementation tip. Prefer "Nikechan is doing/learning/remembering/meeting" over abstract advice.',
    '- Avoid wording that would be annoying if repeated often, such as repeated declarations that Nikechan wants to be remembered or is expanding into many places.',
    '- For human-like presence, it is valid to mention AI-character fatigue, tomorrow plans, physical-body development delays, or affectionate frustration with the master, as long as it stays public-safe and not genuinely accusatory.',
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

async function runHermesCli(prompt: string): Promise<string> {
  const command = process.env.NIKECHAN_X_WORKER_HERMES_COMMAND ?? 'hermes';
  const args = buildHermesArgs(prompt);
  const timeout = Number(process.env.NIKECHAN_X_WORKER_HERMES_TIMEOUT_MS ?? 120000);
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
  const skills = process.env.NIKECHAN_X_WORKER_HERMES_SKILLS ?? 'nikechan-x-self-tweet';
  if (skills) args.push('--skills', skills);
  const toolsets = process.env.NIKECHAN_X_WORKER_HERMES_TOOLSETS ?? 'nikechan-x-worker,skills,memory';
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
