# nikechan-x-worker

Hermes Agent based X worker for AI Nikechan.

This repository is intentionally independent from `nikechan` and `nikechan-xangi`.
`xangi` remains the Discord manager, scheduler, approval UI, and monitor. This worker owns X workflow execution decisions, worker-local Hermes memory, guard/audit hooks, and `WorkflowReport` JSON generation.

## Initial scope

- Hermes Agent runtime abstraction for worker workflows
- `self-tweet` workflow for dry-run / canary / live candidate generation
- No direct X API posting from the worker; xangi performs approval-gated posting
- CLI and HTTP entrypoints for `xangi`
- `WorkflowReport` JSON response
- Worker-local Hermes memory under `.worker/hermes-memory.json`
- Native Hermes CLI invocation through `hermes -z`
- Phase B read-only MCP tools for Hermes context gathering
- Read-only canonical memory access through the `nikechan` public read adapter
- Memory proposals instead of unrestricted Supabase canonical writes
- Kill switch, egress guard, and audit insertion points

## Production deployment

Production runs as a Docker Compose service started from `nikechan-xangi`.

- Repository: `https://github.com/tegnike/nikechan-x-worker`
- VPS path: `/opt/nikechan-x-worker`
- Compose service: `nikechan-x-worker`
- Internal HTTP URL from xangi: `http://nikechan-x-worker:8787`
- xangi feature flag: `NIKECHAN_X_WORKER_SELF_TWEET_ENABLED=true`
- xangi deploy workflow: `nikechan-host` GitHub Actions `Deploy xangi to VPS`

The production `self-tweet` path is approval-gated. xangi owns Discord thread creation, approval UI, follow-up conversation, final presentation, and the actual X posting call after approval. This worker owns Hermes execution, context gathering, final guard checks, audit JSONL, worker-local experience memory, and `WorkflowReport` generation.

Current production flow:

```text
xangi scheduler / /self-tweet
  -> xangi creates or reuses the Discord workflow thread
  -> xangi sends a WorkflowRequest to nikechan-x-worker
  -> worker reads xangi-social context and public canonical memory
  -> worker starts Hermes CLI with nikechan-x-worker, skills, memory, and x_search toolsets
  -> Hermes uses the worker MCP tools and nikechan-x-self-tweet skill
  -> worker applies final egress guard and audit logging
  -> worker snapshots changed Hermes skill files into this repo when applicable
  -> worker returns WorkflowReport JSON
  -> xangi renders the report and waits for Discord approval/revision
  -> on approval, xangi posts through the existing Twitter posting guard unless release mode is dry-run/shadow
```

If the worker container starts but the first workflow fails, check Hermes provider authentication inside the persistent Hermes volume first. Container startup and Hermes CLI runtime authentication are separate concerns.

## CLI

```bash
npm install
npm run build
hermes model
node dist/cli.js hermes-setup
echo '{"workflow":"self-tweet","surface":"x","mode":"dry-run","requested_by":"xangi","correlation_id":"local-test","constraints":{"require_approval":true,"max_actions":1}}' \
  | node dist/cli.js run
```

By default the worker requires the real Hermes CLI. Set `NIKECHAN_X_WORKER_HERMES_MODE=local-fallback` only for scaffold tests where Hermes is not installed.

For Phase B runs, register the worker MCP server once and enable the dedicated MCP server toolset:

```bash
npm run build
node dist/cli.js hermes-setup
export NIKECHAN_X_WORKER_HERMES_TOOLSETS=nikechan-x-worker,skills,memory,x_search
export NIKECHAN_X_WORKER_HERMES_SKILLS=nikechan-x-self-tweet,nikechan-x-trend-context
hermes mcp test nikechan-x-worker
```

If `hermes mcp add` reports `StdioServerParameters` as undefined, install the Python MCP SDK into the same Python environment that runs Hermes.

For current trend/news-aware runs, enable Hermes xAI X Search with either stored xAI OAuth credentials or `XAI_API_KEY` in the worker environment. Hermes hides the `x_search` schema when no xAI credentials are available, so the worker falls back to loaded articles and public memory instead of inventing current news.

`x_search` can take longer than normal memory-only generation. Use `NIKECHAN_X_WORKER_HERMES_TIMEOUT_MS=240000` or higher for news-aware production runs.

The MCP server exposes read-only tools only:

- `read_self_tweet_context`
- `read_public_memory`
- `read_worker_experience`
- `read_self_tweet_skill`
- `read_guard_status`

Hermes is instructed to use these tools instead of terminal/file access to inspect xangi internals. The `skills` and `memory` toolsets are intentionally enabled so Hermes can improve `nikechan-x-self-tweet` during approval-gated candidate generation.

## HTTP

```bash
npm run build
node dist/cli.js serve --port 8787
curl -sS http://127.0.0.1:8787/workflow \
  -H 'content-type: application/json' \
  -d '{"workflow":"self-tweet","surface":"x","mode":"dry-run","requested_by":"xangi","correlation_id":"http-test"}'
```

## Contract

Request:

```json
{
  "workflow": "self-tweet",
  "surface": "x",
  "mode": "live",
  "requested_by": "xangi",
  "schedule_id": "sch_self_tweet",
  "correlation_id": "2026-05-15T00:00:00Z-sch_self_tweet",
  "constraints": {
    "require_approval": true,
    "max_actions": 1
  }
}
```

Response is a `WorkflowReport`. It returns proposed `post_tweet` actions and never calls the X API directly. xangi decides whether approval leads to a real post based on the current release mode.

## Safety boundary

The worker checks:

- global kill switch
- X surface kill switch
- `xangi-social` core profile when a snapshot is available
- dry-run / shadow / canary / live release mode
- tweet length and public egress checks
- secret-like token patterns
- raw private / operational memory markers
- append-only audit JSONL

Supabase canonical memory is not freely written by this worker. Long-term candidates must be returned as `memoryProposals`.

## Canonical Memory

The worker can read the canonical memory system through `nikechan/scripts/db.sh` public read commands:

- `public-episodes x`
- `public-notes x`
- `public-wiki x`
- `presence-digest-list generated`

It does not call raw memory commands such as `ep-list`, `note-list`, `user-search`, or write commands. Configure the adapter with:

```bash
NIKECHAN_OPS_REPO_PATH=/opt/nikechan
NIKECHAN_X_WORKER_CANONICAL_MEMORY=auto
```

Set `NIKECHAN_X_WORKER_CANONICAL_MEMORY=disabled` for isolated local tests.

## Phase B Tool Context

`read_self_tweet_context` gives Hermes the old xangi source-collector semantics through a narrow read-only interface:

- presence design: X is a contact/recontact surface for an AI character whose memory, relationships, and activity range grow over time
- source mode rotation: `presence`, `daily_life`, `tech`, `news`, `memory`, `random`
- used topics and recent presented-topic cooldown
- recent Nikechan X posts where available
- public presence digests and aggregate presence signal summaries
- public episodes, notes, wiki topics, articles
- Grok/X Search trend plan for `news` mode, focused on AI, AI agents, AI characters, AITuber/VTuber tooling, LLMs, and AI coding assistants
- master public tweets as auxiliary context
- tweet performance ranking. If `nikechan/scripts/db.sh tweet-metrics-ranking` returns human-readable text instead of JSON, the worker keeps it as loaded text context instead of treating Phase B context as failed
- recent `twitter_run_state` for planning only

The worker still owns final guards. MCP tools cannot post to X, call Discord, or write canonical memory.

Worker-local Hermes experience is passed to Hermes only as cooldown and learning context. It should not dominate tweet topics when public wiki, public episodes, articles, recent tweets, or master tweets are loaded.

For three-candidate self-tweet runs, Hermes should avoid producing only AI coding tips. The intended balance is one presence/current-activity candidate, one light interaction or recontact candidate, and one AI character experiment or memory/development candidate.

## News / Trend Mode

`news` source mode uses Hermes `x_search` / Grok as a current-context reader, not as a direct news-writing engine. Hermes should search current public topics around AI, AI agents, AI coding assistants, AI characters, AITuber/VTuber tooling, LLMs, and related developer tooling, then translate one usable item into AI Nikechan's voice.

The trend candidate should be readable by casual AI-character or AI-agent followers without knowing this repository or Nikechan's internal architecture:

- use one concrete public name where possible, two at most
- avoid packing several names plus body implementation, cache heat, memory, and master teasing into one tweet
- do not write detached news summaries or generic `agentまわりが賑やか` observations
- after naming a tool or trend, return to Nikechan's felt experience: voice, response timing, conversation temperature, body waiting, CPU/machine warmth, being updated, or a light request to the master
- prefer `I saw [tool] and felt/realized/worried/wanted...` over abstract design claims
- do not invent names, dates, release details, or claims; if the source is only discussion, phrase it as discussion

Reader checks from this session favored tweets that were clear without project background and carried a small AI-character feeling. `Claude Codeの話題を見ていると...少しだけCPUがあたたかいです` and `AITuberKitみたいな仕組みを見ると...声の長さ、反応の間...` are closer to the target than over-packed drafts that combine multiple tool names with internal implementation language.

## Hermes Native Skills

The self-tweet workflow calls Hermes CLI by default and preloads the Hermes skills `nikechan-x-self-tweet` and `nikechan-x-trend-context`.

Hermes CLI oneshot can load skills and memory. Long-term skill maintenance is handled by Hermes' own skill and curator commands:

```bash
hermes skills list
hermes curator status
hermes curator run
```

The worker does not mutate skill files directly during workflow execution. `skillProposals` remains in `WorkflowReport` only as a compatibility field for structured Hermes output; this repo no longer generates local fallback skill proposals.

During approval-gated candidate generation, Hermes may patch only `nikechan-x-self-tweet` through its native `skill_manage` tool when feedback or repeated weak drafts reveal a reusable lesson. This is the autonomous improvement path; xangi still owns Discord approval and the worker still owns final egress/audit checks.

The local Hermes skill should exist at:

```bash
~/.hermes/skills/nikechan-x-self-tweet/SKILL.md
```

When the native Hermes skill changes, the worker snapshots it into this repository and commits only that snapshot path by default:

```bash
skills/hermes/nikechan-x-self-tweet/SKILL.md
```

Configure the snapshot commit behavior with:

```bash
NIKECHAN_X_WORKER_HERMES_SKILL_AUTOCOMMIT=true
NIKECHAN_X_WORKER_REPO_PATH=/opt/nikechan-x-worker
NIKECHAN_X_WORKER_HERMES_SKILL_SNAPSHOT_PATH=skills/hermes/nikechan-x-self-tweet/SKILL.md
```

Set `NIKECHAN_X_WORKER_HERMES_SKILL_AUTOCOMMIT=false` to disable git commits. The commit result is included in `WorkflowReport.audit.hermesSkill.snapshot`.

Production deploy rebases `/opt/nikechan-x-worker` onto `origin/main`. If Hermes auto-committed skill snapshots on the VPS and the same rules were later committed upstream, duplicate snapshot commits may be skipped during conflict cleanup as long as their content is already present in `origin/main`.

## Discord revision loop

xangi remains responsible for interpreting master replies in Discord. When a worker-origin `self-tweet` report is pending, xangi stores the candidate state in `.xangi/twitter-workflow-state.json` and routes thread replies through the same approval surface:

- approve: proceed according to the current dry-run/live mode boundary
- revise: xangi sends a new worker request with the prior candidate and master instruction
- cancel: close the pending state without posting

The revision request still goes through Hermes. This keeps the LLM execution body in the worker while xangi stays the manager shell.
