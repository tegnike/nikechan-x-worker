# nikechan-x-worker

Hermes Agent based X worker for AI Nikechan.

This repository is intentionally independent from `nikechan` and `nikechan-xangi`.
`xangi` remains the Discord manager, scheduler, approval UI, and monitor. This worker owns X workflow execution decisions, worker-local Hermes memory, guard/audit hooks, and `WorkflowReport` JSON generation.

## Initial scope

- Hermes Agent runtime abstraction for worker workflows
- `self-tweet` dry-run workflow
- No real X posting
- CLI and HTTP entrypoints for `xangi`
- `WorkflowReport` JSON response
- Worker-local Hermes memory under `.worker/hermes-memory.json`
- Native Hermes CLI invocation through `hermes -z`
- Phase B read-only MCP tools for Hermes context gathering
- Read-only canonical memory access through the `nikechan` public read adapter
- Memory proposals instead of unrestricted Supabase canonical writes
- Kill switch, egress guard, and audit insertion points

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
export NIKECHAN_X_WORKER_HERMES_TOOLSETS=nikechan-x-worker,skills,memory
export NIKECHAN_X_WORKER_HERMES_SKILLS=nikechan-x-self-tweet
hermes mcp test nikechan-x-worker
```

If `hermes mcp add` reports `StdioServerParameters` as undefined, install the Python MCP SDK into the same Python environment that runs Hermes.

The MCP server exposes read-only tools only:

- `read_self_tweet_context`
- `read_public_memory`
- `read_worker_experience`
- `read_self_tweet_skill`
- `read_guard_status`

Hermes is instructed to use these tools instead of terminal/file access to inspect xangi internals. The `skills` and `memory` toolsets are intentionally enabled so Hermes can improve `nikechan-x-self-tweet` during dry-run.

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
  "mode": "dry-run",
  "requested_by": "xangi",
  "schedule_id": "sch_self_tweet",
  "correlation_id": "2026-05-15T00:00:00Z-sch_self_tweet",
  "constraints": {
    "require_approval": true,
    "max_actions": 1
  }
}
```

Response is a `WorkflowReport`. In the initial dry-run scope it returns one proposed `post_tweet` action and never calls the X API.

## Safety boundary

The worker checks:

- global kill switch
- X surface kill switch
- `xangi-social` core profile when a snapshot is available
- dry-run only release mode
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

- source mode rotation: `daily_life`, `tech`, `memory`, `random`
- used topics and recent presented-topic cooldown
- recent Nikechan X posts where available
- public episodes, notes, wiki topics, articles
- master public tweets as auxiliary context
- tweet performance ranking
- recent `twitter_run_state` for planning only

The worker still owns final guards. MCP tools cannot post to X, call Discord, or write canonical memory.

## Hermes Native Skills

The self-tweet workflow calls Hermes CLI by default and preloads the Hermes skill `nikechan-x-self-tweet`.

Hermes CLI oneshot can load skills and memory. Long-term skill maintenance is handled by Hermes' own skill and curator commands:

```bash
hermes skills list
hermes curator status
hermes curator run
```

The worker does not mutate skill files directly during workflow execution. `skillProposals` remains in `WorkflowReport` only as a compatibility field for structured Hermes output; this repo no longer generates local fallback skill proposals.

During dry-run, Hermes may patch only `nikechan-x-self-tweet` through its native `skill_manage` tool when feedback or repeated weak drafts reveal a reusable lesson. This is the autonomous improvement path; xangi still owns Discord approval and the worker still owns final egress/audit checks.

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
