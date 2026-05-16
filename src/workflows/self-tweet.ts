import { writeAuditRecord } from '../audit.js';
import { getCoreAudit, loadXangiSocialCore } from '../core/nikechan-core.js';
import type { WorkflowReport, WorkflowRequest } from '../contracts.js';
import { POLICY_VERSION } from '../contracts.js';
import { checkTweetEgress } from '../guards/egress-guard.js';
import { readKillSwitchState } from '../guards/kill-switch.js';
import { createHermesRuntime } from '../hermes/runtime.js';
import { readHermesSelfTweetSkillSnapshot, summarizeHermesSkillAudit } from '../hermes/skill-audit.js';
import { snapshotHermesSkillToGit } from '../hermes/skill-snapshot.js';
import type { HermesAgentDecision } from '../hermes/types.js';
import { collectSelfTweetCanonicalMemory } from '../memory/canonical-memory.js';
import { HermesMemoryStore } from '../memory/hermes-memory.js';
import { loadSelfTweetSkill } from '../skills/self-tweet-skill.js';
import { readFeedbackInput, recordOperatorFeedback } from '../skills/skill-proposals.js';

export async function runSelfTweetWorkflow(request: WorkflowRequest): Promise<WorkflowReport> {
  const createdAt = new Date().toISOString();
  const core = loadXangiSocialCore();
  const coreStatus = getCoreAudit(core);
  const memory = new HermesMemoryStore();
  const agent = createHermesRuntime();
  const killSwitch = readKillSwitchState();
  const canonicalMemory = await collectSelfTweetCanonicalMemory();
  const skill = loadSelfTweetSkill();
  const hermesSkillBefore = readHermesSelfTweetSkillSnapshot();
  const feedbackInput = readFeedbackInput(request.context);
  recordOperatorFeedback(
    memory,
    request.workflow,
    feedbackInput,
    request.correlation_id
  );
  let decision: HermesAgentDecision;
  try {
    decision = await agent.decideSelfTweet({
      request,
      core,
      canonicalMemory,
      skill,
      memory,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hermesSkillAfter = readHermesSelfTweetSkillSnapshot();
    const hermesSkillAudit = summarizeHermesSkillAudit(hermesSkillBefore, hermesSkillAfter);
    hermesSkillAudit.snapshot = snapshotHermesSkillToGit(hermesSkillAudit, request);
    return createFailedReport({
      request,
      createdAt,
      coreStatus,
      memory,
      canonicalMemoryStatus: canonicalMemory.status,
      canonicalMemoryErrors: canonicalMemory.errors,
      agentId: `${agent.id}@${agent.version}`,
      agentMode: agent.mode,
      hermesSkillAudit,
      error: message,
    });
  }
  const hermesSkillAfter = readHermesSelfTweetSkillSnapshot();
  const hermesSkillAudit = summarizeHermesSkillAudit(hermesSkillBefore, hermesSkillAfter);
  hermesSkillAudit.snapshot = snapshotHermesSkillToGit(hermesSkillAudit, request);
  const candidateEgress = decision.candidates.map((candidate) => ({
    candidate,
    egress: checkTweetEgress(candidate.tweetText),
  }));
  const dryRunOnlyBlocked = request.mode !== 'dry-run';
  const killSwitchBlocked = killSwitch.global === 'closed' || killSwitch.surface === 'closed';
  const guardBlocked = killSwitchBlocked || dryRunOnlyBlocked;
  const proposedCandidates = candidateEgress.filter((entry) => entry.egress.status === 'passed');
  const blockedCandidates = candidateEgress.filter((entry) => entry.egress.status === 'blocked');
  const blocked = guardBlocked || proposedCandidates.length === 0;
  const egressSummary =
    blockedCandidates.length === 0 ? 'passed' : proposedCandidates.length === 0 ? 'blocked' : 'blocked';
  const skillProposals = decision.skillProposals;

  const report: WorkflowReport = {
    surface: request.surface,
    workflow: request.workflow,
    status: blocked ? 'blocked' : request.constraints?.require_approval === false ? 'dry-run' : 'needs_approval',
    summary: blocked
      ? buildBlockedSummary(
          killSwitch.reasons,
          blockedCandidates.flatMap((entry) => entry.egress.reasons),
          dryRunOnlyBlocked
        )
      : `Generated ${proposedCandidates.length} self-tweet candidate(s) in dry-run mode.`,
    actions: candidateEgress.map((entry, index) => ({
      type: 'post_tweet',
      status: guardBlocked || entry.egress.status === 'blocked' ? 'blocked' : 'proposed',
      label: `self-tweet candidate ${index + 1}`,
      preview: entry.candidate.tweetText,
      reason:
        guardBlocked || entry.egress.status === 'blocked'
          ? buildBlockedSummary(killSwitch.reasons, entry.egress.reasons, dryRunOnlyBlocked)
          : undefined,
      metadata: {
        topic: entry.candidate.topic,
        hermes_reasoning: entry.candidate.reasoning,
        memory_refs: decision.memoryRefs,
      },
    })),
    sourceRefs: canonicalMemory.sourceRefs,
    audit: {
      mode: request.mode,
      releaseMode: request.mode,
      dryRun: request.mode === 'dry-run',
      coreProfile: 'xangi-social',
      coreStatus,
      egressGuard: egressSummary,
      killSwitch: killSwitch.global,
      surfaceKillSwitch: killSwitch.surface,
      guardStatus: blocked ? 'blocked' : 'passed',
      hermesAgent: `${agent.id}@${agent.version}`,
      hermesRuntime: agent.mode,
      hermesStatus: 'ok',
      hermesMemory: memory.isEnabled() ? 'read-write' : 'disabled',
      hermesSkill: hermesSkillAudit,
      canonicalMemory: canonicalMemory.status,
      canonicalMemoryErrors: canonicalMemory.errors.length ? canonicalMemory.errors : undefined,
      correlationId: request.correlation_id,
      policyVersion: POLICY_VERSION,
    },
    memoryProposals: decision.memoryProposals,
    skillProposals,
    nextAction: blocked
      ? 'Inspect guard audit and keep X execution stopped.'
      : feedbackInput
        ? 'Review the revised dry-run candidate. No X API call was made.'
        : skillProposals.length
          ? 'Review pending skill proposals before the next iteration. No X API call was made.'
        : request.constraints?.require_approval === false
          ? 'Dry-run complete. xangi may discard or show the candidate.'
          : 'Wait for xangi approval. No X API call was made.',
    createdAt,
  };

  agent.recordDecision(request, decision, report.status, memory);
  const auditId = writeAuditRecord(request, report);
  return {
    ...report,
    audit: {
      ...report.audit,
      auditId,
    },
  };
}

function createFailedReport(input: {
  request: WorkflowRequest;
  createdAt: string;
  coreStatus: string;
  memory: HermesMemoryStore;
  canonicalMemoryStatus: 'loaded' | 'disabled' | 'unavailable';
  canonicalMemoryErrors: string[];
  agentId: string;
  agentMode: 'cli' | 'local-fallback';
  hermesSkillAudit: WorkflowReport['audit']['hermesSkill'];
  error: string;
}): WorkflowReport {
  const report: WorkflowReport = {
    surface: input.request.surface,
    workflow: input.request.workflow,
    status: 'failed',
    summary: 'Hermes runtime failed before a self-tweet candidate could be generated.',
    actions: [],
    sourceRefs: [],
    audit: {
      mode: input.request.mode,
      releaseMode: input.request.mode,
      dryRun: input.request.mode === 'dry-run',
      coreProfile: 'xangi-social',
      coreStatus: input.coreStatus,
      egressGuard: 'skipped',
      killSwitch: 'open',
      surfaceKillSwitch: 'open',
      guardStatus: 'blocked',
      hermesAgent: input.agentId,
      hermesRuntime: input.agentMode,
      hermesStatus: 'failed',
      hermesMemory: input.memory.isEnabled() ? 'read-write' : 'disabled',
      hermesSkill: input.hermesSkillAudit,
      canonicalMemory: input.canonicalMemoryStatus,
      canonicalMemoryErrors: input.canonicalMemoryErrors.length ? input.canonicalMemoryErrors : undefined,
      correlationId: input.request.correlation_id,
      policyVersion: POLICY_VERSION,
    },
    memoryProposals: [],
    skillProposals: [],
    nextAction: 'Install/configure Hermes CLI or explicitly set NIKECHAN_X_WORKER_HERMES_MODE=local-fallback for scaffold-only local tests.',
    error: input.error,
    createdAt: input.createdAt,
  };
  const auditId = writeAuditRecord(input.request, report);
  return {
    ...report,
    audit: {
      ...report.audit,
      auditId,
    },
  };
}

function buildBlockedSummary(
  killSwitchReasons: string[],
  egressReasons: string[],
  dryRunOnlyBlocked: boolean
): string {
  const reasons = [
    ...killSwitchReasons,
    ...egressReasons,
    dryRunOnlyBlocked ? 'initial scope only permits dry-run mode' : null,
  ].filter((reason): reason is string => Boolean(reason));
  return `Workflow blocked: ${reasons.join('; ')}`;
}
