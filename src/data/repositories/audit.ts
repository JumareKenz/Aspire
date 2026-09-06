import { randomUUID } from 'node:crypto';
import { getDb } from '../db/client';

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
}

export interface AuditInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  target?: string | null;
  detail?: string | null;
  ip?: string | null;
}

/**
 * Records an administratively significant event. Called for sign-in, sign-out,
 * configuration changes, synchronisation and every AI question, so that the
 * platform can account for what it was asked and what it changed.
 */
export function recordAudit(input: AuditInput): void {
  getDb()
    .prepare(
      `INSERT INTO audit_log (id, at, actor_id, actor_email, action, target, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      new Date().toISOString(),
      input.actorId ?? null,
      input.actorEmail ?? null,
      input.action,
      input.target ?? null,
      input.detail ?? null,
      input.ip ?? null,
    );
}

export function listAudit(limit = 100): AuditEntry[] {
  const rows = getDb()
    .prepare('SELECT * FROM audit_log ORDER BY at DESC LIMIT ?')
    .all(Math.min(500, Math.max(1, limit))) as Array<{
    id: string;
    at: string;
    actor_id: string | null;
    actor_email: string | null;
    action: string;
    target: string | null;
    detail: string | null;
    ip: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    action: row.action,
    target: row.target,
    detail: row.detail,
    ip: row.ip,
  }));
}
