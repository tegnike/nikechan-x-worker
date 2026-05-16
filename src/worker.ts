import { normalizeWorkflowRequest, type WorkflowReport } from './contracts.js';
import { runSelfTweetWorkflow } from './workflows/self-tweet.js';

export async function runWorkflow(input: unknown): Promise<WorkflowReport> {
  const request = normalizeWorkflowRequest(input);
  if (request.workflow === 'self-tweet') {
    return runSelfTweetWorkflow(request);
  }
  throw new Error(`unsupported workflow: ${request.workflow}`);
}
