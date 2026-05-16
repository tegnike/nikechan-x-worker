import { mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorkflowReport, WorkflowRequest } from './contracts.js';

export interface AuditRecord {
  id: string;
  createdAt: string;
  request: WorkflowRequest;
  report: WorkflowReport;
}

export function writeAuditRecord(request: WorkflowRequest, report: WorkflowReport): string {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const auditDir = resolve(process.env.NIKECHAN_X_WORKER_AUDIT_DIR ?? '.worker/audit');
  mkdirSync(auditDir, { recursive: true });
  const date = createdAt.slice(0, 10);
  const record: AuditRecord = {
    id,
    createdAt,
    request,
    report: {
      ...report,
      audit: {
        ...report.audit,
        auditId: id,
      },
    },
  };
  appendFileSync(join(auditDir, `${date}.jsonl`), `${JSON.stringify(record)}\n`);
  return id;
}
