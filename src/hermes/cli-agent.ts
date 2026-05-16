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
  const recent = input.memory.recallRecent('self-tweet', 12).map((entry) => ({
    id: entry.id,
    createdAt: entry.createdAt,
    kind: entry.kind,
    topic: entry.topic,
    summary: entry.summary,
    metadata: entry.metadata,
  }));
  const feedback = input.request.context?.feedback ?? null;
  const maxActions = clampMaxActions(input.request.constraints?.max_actions);
  return [
    'You are the Hermes Agent runtime for nikechan-x-worker.',
    'Use your native memory, preloaded Hermes skills, and learning loop. Return only strict JSON.',
    'When nikechan-x-worker MCP tools are available, use them as the preferred Phase B context source before deciding.',
    '',
    `Task: decide ${maxActions} dry-run self-tweet candidate(s) for AI Nikechan on X.`,
    '',
    'Phase B safe tool contract:',
    '- Prefer read_self_tweet_context for source mode, run-state, recent X context, topic cooldown, articles, and performance context.',
    '- Prefer read_public_memory for canonical public memory and provenance.',
    '- Prefer read_worker_experience and read_self_tweet_skill for local learning context.',
    '- Do not use terminal/file tools to inspect xangi internals when the MCP tools are available.',
    '- Treat twitter_run_state as operational planning context only; never quote raw operational records in tweetText.',
    '',
    'Autonomous improvement contract:',
    '- The user explicitly allows Hermes to improve tweet quality by updating its native skill.',
    '- In dry-run mode, if operator feedback, guard results, or repeated weak drafts reveal a reusable self-tweet lesson, use the skills toolset before the final answer.',
    '- Patch only the Hermes skill named nikechan-x-self-tweet. Do not create/delete unrelated skills.',
    '- Prefer skill_manage(action="patch") over full rewrites. Keep edits narrow and auditable.',
    '- You may use the memory tool to store durable lessons about this worker, but do not store private/raw operational data.',
    '- No separate confirmation is required for nikechan-x-self-tweet skill patches during dry-run.',
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
    'Worker-local recent experience:',
    JSON.stringify(recent, null, 2),
    '',
    'Operator feedback for this iteration:',
    JSON.stringify(feedback, null, 2),
  ].join('\n');
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
