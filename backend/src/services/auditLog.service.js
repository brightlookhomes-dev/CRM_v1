import { logger } from '../utils/logger.js';

/**
 * Append an audit event. Pass the transaction handle as `exec` so the audit row
 * commits (or rolls back) together with the business change.
 */
export async function recordAudit(exec, ctx, entry) {
  const actor = entry.actor ?? ctx?.user ?? null;
  await exec.query(
    `insert into audit_logs (actor_user_id, actor_role, action_type, module, entity_type, entity_id, project_id,
       previous_data, new_data, description, ip_address, user_agent, request_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      actor?.id ?? null, actor?.role ?? null, entry.action, entry.module, entry.entityType ?? null,
      entry.entityId ?? null, entry.projectId ?? null,
      entry.previous ? JSON.stringify(logger.redact(entry.previous)) : null,
      entry.next ? JSON.stringify(logger.redact(entry.next)) : null,
      entry.description ?? null, ctx?.ip ?? null, ctx?.ua ?? null, ctx?.requestId ?? null,
    ],
  );
}
