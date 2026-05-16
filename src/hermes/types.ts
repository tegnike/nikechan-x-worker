import type { NikechanCoreContext } from '../core/nikechan-core.js';
import type { MemoryProposal, SkillProposal, WorkflowRequest } from '../contracts.js';
import type { CanonicalMemorySnapshot } from '../memory/canonical-memory.js';
import type { HermesExperience, HermesMemoryStore } from '../memory/hermes-memory.js';
import type { SelfTweetSkill } from '../skills/self-tweet-skill.js';

export type HermesRuntimeMode = 'cli' | 'local-fallback';

export interface SelfTweetCandidate {
  tweetText: string;
  topic: string;
  reasoning: string;
}

export interface HermesAgentDecision {
  tweetText: string;
  topic: string;
  reasoning: string;
  candidates: SelfTweetCandidate[];
  memoryRefs: string[];
  memoryProposals: MemoryProposal[];
  skillProposals: SkillProposal[];
  runtime: HermesRuntimeMode;
}

export interface HermesAgentRuntime {
  readonly id: string;
  readonly version: string;
  readonly mode: HermesRuntimeMode;

  decideSelfTweet(input: HermesDecisionInput): Promise<HermesAgentDecision>;
  recordDecision(
    request: WorkflowRequest,
    decision: HermesAgentDecision,
    status: string,
    memory: HermesMemoryStore
  ): HermesExperience | null;
}

export interface HermesDecisionInput {
  request: WorkflowRequest;
  core: NikechanCoreContext | null;
  canonicalMemory: CanonicalMemorySnapshot;
  skill: SelfTweetSkill;
  memory: HermesMemoryStore;
}
