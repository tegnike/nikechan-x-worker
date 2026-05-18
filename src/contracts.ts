export type WorkflowSurface = 'x';
export type WorkflowName = 'self-tweet';
export type WorkflowMode = 'dry-run' | 'shadow' | 'canary' | 'live';

export type WorkflowReportStatus =
  | 'success'
  | 'partial'
  | 'skipped'
  | 'blocked'
  | 'failed'
  | 'dry-run'
  | 'needs_approval';

export type WorkflowActionStatus = 'proposed' | 'skipped' | 'blocked' | 'executed' | 'failed';

export interface WorkflowRequestConstraints {
  require_approval?: boolean;
  max_actions?: number;
}

export interface WorkflowRequest {
  workflow: WorkflowName;
  surface: WorkflowSurface;
  mode: WorkflowMode;
  requested_by: string;
  schedule_id?: string;
  correlation_id?: string;
  constraints?: WorkflowRequestConstraints;
  context?: Record<string, unknown>;
}

export interface WorkflowReportAction {
  type: string;
  status: WorkflowActionStatus;
  label?: string;
  preview?: string;
  reason?: string;
  id?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface SourceRef {
  type: string;
  id?: string;
  url?: string;
  label?: string;
}

export interface MemoryProposal {
  type: 'memory_proposal';
  target: string;
  surface: WorkflowSurface;
  confidence: number;
  visibility: 'public' | 'private';
  content: string;
  reason: string;
  source_refs: SourceRef[];
}

export interface SkillProposal {
  type: 'skill_proposal';
  id: string;
  workflow: WorkflowName;
  title: string;
  rationale: string;
  proposedRule: string;
  evidenceRefs: string[];
  status: 'proposed';
  createdAt: string;
}

export interface HermesSkillAudit {
  name: string;
  path: string;
  status: 'changed' | 'unchanged' | 'unavailable';
  beforeSha256?: string;
  afterSha256?: string;
  beforeBytes?: number;
  afterBytes?: number;
  addedLines?: string[];
  removedLines?: string[];
  snapshot?: HermesSkillSnapshotAudit;
  unavailableReason?: string;
}

export interface HermesSkillSnapshotAudit {
  status: 'committed' | 'unchanged' | 'skipped' | 'failed';
  repoPath?: string;
  snapshotPath?: string;
  commitSha?: string;
  message?: string;
  reason?: string;
}

export interface WorkflowReportAudit {
  mode: WorkflowMode;
  releaseMode: WorkflowMode;
  dryRun: boolean;
  coreProfile: 'xangi-social';
  coreStatus: string;
  egressGuard: 'passed' | 'blocked' | 'skipped';
  killSwitch: 'open' | 'closed';
  surfaceKillSwitch: 'open' | 'closed';
  guardStatus: 'passed' | 'blocked';
  hermesAgent: string;
  hermesRuntime: 'cli' | 'local-fallback';
  hermesStatus: 'ok' | 'failed';
  hermesMemory: 'read-write' | 'disabled';
  hermesSkill?: HermesSkillAudit;
  canonicalMemory: 'loaded' | 'disabled' | 'unavailable';
  canonicalMemoryErrors?: string[];
  sourceMode?: string;
  requestedSourceMode?: string;
  correlationId?: string;
  auditId?: string;
  policyVersion: string;
}

export interface WorkflowReport {
  surface: WorkflowSurface;
  workflow: WorkflowName;
  status: WorkflowReportStatus;
  summary: string;
  actions: WorkflowReportAction[];
  sourceRefs: SourceRef[];
  audit: WorkflowReportAudit;
  memoryProposals: MemoryProposal[];
  skillProposals: SkillProposal[];
  nextAction?: string;
  error?: string;
  createdAt: string;
}

export const POLICY_VERSION = 'nikechan-x-worker-policy-v1';

export function normalizeWorkflowRequest(input: unknown): WorkflowRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('request must be a JSON object');
  }

  const record = input as Record<string, unknown>;
  const workflow = expectString(record.workflow, 'workflow');
  const surface = expectString(record.surface, 'surface');
  const mode = expectString(record.mode, 'mode');
  const requestedBy = expectString(record.requested_by, 'requested_by');

  if (workflow !== 'self-tweet') throw new Error(`unsupported workflow: ${workflow}`);
  if (surface !== 'x') throw new Error(`unsupported surface: ${surface}`);
  if (!['dry-run', 'shadow', 'canary', 'live'].includes(mode)) {
    throw new Error(`unsupported mode: ${mode}`);
  }

  return {
    workflow,
    surface,
    mode: mode as WorkflowMode,
    requested_by: requestedBy,
    schedule_id: optionalString(record.schedule_id, 'schedule_id'),
    correlation_id: optionalString(record.correlation_id, 'correlation_id'),
    constraints: normalizeConstraints(record.constraints),
    context: normalizeContext(record.context),
  };
}

function normalizeConstraints(input: unknown): WorkflowRequestConstraints | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('constraints must be an object');
  }
  const record = input as Record<string, unknown>;
  const normalized: WorkflowRequestConstraints = {};
  if (record.require_approval !== undefined) {
    if (typeof record.require_approval !== 'boolean') {
      throw new Error('constraints.require_approval must be a boolean');
    }
    normalized.require_approval = record.require_approval;
  }
  if (record.max_actions !== undefined) {
    if (!Number.isInteger(record.max_actions) || Number(record.max_actions) < 1) {
      throw new Error('constraints.max_actions must be a positive integer');
    }
    normalized.max_actions = Number(record.max_actions);
  }
  return normalized;
}

function normalizeContext(input: unknown): Record<string, unknown> | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('context must be an object');
  }
  return input as Record<string, unknown>;
}

function expectString(input: unknown, name: string): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return input.trim();
}

function optionalString(input: unknown, name: string): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'string') throw new Error(`${name} must be a string`);
  return input.trim() || undefined;
}
