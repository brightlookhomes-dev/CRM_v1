// In-app notifications. Email/WhatsApp can later subscribe here without touching callers.

export async function notify(exec, { recipientIds, projectId = null, type, title, message = null, entityType = null, entityId = null, excludeUserId = null }) {
  const ids = [...new Set(recipientIds)].filter((id) => id && id !== excludeUserId);
  for (const recipientId of ids) {
    await exec.query(
      `insert into notifications (recipient_id, project_id, notification_type, title, message, entity_type, entity_id)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [recipientId, projectId, type, title, message, entityType, entityId],
    );
  }
}

export async function adminIds(exec) {
  const { rows } = await exec.query("select id from users where role = 'ADMIN' and status = 'ACTIVE'");
  return rows.map((r) => r.id);
}

export async function projectUserIds(exec, projectId, assignmentRole) {
  const { rows } = await exec.query(
    `select user_id from project_assignments where project_id = $1 and assignment_role = $2 and is_active`,
    [projectId, assignmentRole],
  );
  return rows.map((r) => r.user_id);
}
