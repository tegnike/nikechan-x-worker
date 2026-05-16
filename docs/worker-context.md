# nikechan-x-worker context

This repository is the independent Hermes Agent worker for AI Nikechan's X activity.

## Boundary

- `nikechan-xangi` remains Discord manager / control plane.
- xangi owns scheduling, approval UX, dry-run/canary/live mode selection, monitoring, retries, and rendering reports to Discord.
- this worker owns X workflow decisions, X execution hooks, worker-local memory, audit data, and `WorkflowReport` JSON.
- this worker must not become a copy of xangi's old X workflow implementation.

## Initial implementation

The first supported workflow is `self-tweet` in `dry-run` mode only.

It returns one tweet candidate as a proposed `post_tweet` action. It does not call the X API and does not write freely to Supabase canonical memory.

Production deployment is already wired through `nikechan-xangi`:

- `nikechan-x-worker` is deployed as the `nikechan-x-worker` Docker Compose service.
- xangi calls the worker over HTTP at `http://nikechan-x-worker:8787`.
- xangi enables the route with `NIKECHAN_X_WORKER_SELF_TWEET_ENABLED=true`.
- the host deploy workflow clones or updates `/opt/nikechan-x-worker`, builds it, then restarts `nikechan-x-worker` together with `xangi-max`.

Container startup has been verified in production. Hermes provider authentication is validated by the first real workflow execution, not by container startup.

## Memory

Hermes memory is worker-local experience memory. It can remember operational lessons such as recent dry-run topics, failed patterns, and guard outcomes.

Canonical memory remains owned by `nikechan-core` / Supabase. When this worker learns something that may belong there, it should return a `memoryProposal` instead of writing it directly.

For self-tweet, this worker reads canonical memory only through the existing public read adapter in `nikechan/scripts/db.sh`. The base public commands are `public-episodes x`, `public-notes x`, `public-wiki x`, and `presence-digest-list generated`. Raw memory writes remain outside the worker boundary.

## Phase B Hermes tools

Hermes can be given a worker-local MCP server named `nikechan-x-worker`. The server exposes read-only context tools:

- `read_self_tweet_context`: xangi-compatible source mode, used topics, cooldowns, recent X context, public source candidates, performance context, and recent run-state.
- `read_public_memory`: canonical public memory and provenance.
- `read_worker_experience`: worker-local Hermes experience memory.
- `read_self_tweet_skill`: procedural self-tweet skill.
- `read_guard_status`: kill switch state.

These tools are the intended Phase B bridge: Hermes gathers and reasons over X workflow context itself, while the worker shell still blocks external effects and xangi remains Discord manager.

## Skill growth

The worker calls Hermes CLI with `hermes -z` by default. Hermes receives the request, public canonical memory, worker-local experience, MCP tools, and the preloaded Hermes skill `nikechan-x-self-tweet`; it is responsible for reasoning over that context.

Worker-local skill proposal/apply code is not part of the intended design. Long-term skill maintenance should use Hermes' own skill and curator commands.

The worker intentionally enables Hermes `skills` and `memory` toolsets alongside the `nikechan-x-worker` MCP toolset. In dry-run mode Hermes may patch only `nikechan-x-self-tweet` via `skill_manage` when feedback or weak drafts reveal a reusable lesson. This is the autonomous improvement path.

When Hermes changes the native skill, the worker snapshots the skill into `skills/hermes/nikechan-x-self-tweet/SKILL.md` and can commit that snapshot in the worker repository. The native Hermes skill remains the runtime source; the repository snapshot is for review, deployment traceability, and rollback.

Set `NIKECHAN_X_WORKER_HERMES_MODE=local-fallback` only for local scaffold tests when Hermes is not installed. That mode does not exercise Hermes native memory, native skills, or the learning loop.

## Required controls

Every workflow must pass through:

- global kill switch
- surface-specific kill switch
- role/profile validation for `xangi-social`
- egress guard
- secret-like token detection
- raw private / operational memory marker detection
- audit logging

Hermes Agent can choose actions, but publication and external effects must remain behind this boundary.
