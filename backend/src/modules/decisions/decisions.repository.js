import { offsetOf } from '../../utils/helpers.js';

export const insert = async (exec, d) =>
  (await exec.query(
    `insert into decision_requests (project_id, title, description, category, details, status, requires_admin_approval, requested_by, deadline)
     values ($1,$2,$3,$4,$5,'PENDING_CUSTOMER',$6,$7,$8) returning *`,
    [d.projectId, d.title, d.description ?? null, d.category ?? null, d.details ?? null, !!d.requiresAdminApproval, d.requestedBy, d.deadline ?? null])).rows[0];

export const insertOption = (exec, decisionId, o, i) =>
  exec.query(
    'insert into decision_options (decision_id, label, description, price_note, additional_charge, sort_order) values ($1,$2,$3,$4,$5,$6)',
    [decisionId, o.label, o.description ?? null, o.priceNote ?? null, o.additionalCharge ?? null, i]);

export const linkFile = (exec, decisionId, fileId, responseId = null) =>
  exec.query('insert into decision_files (decision_id, file_id, response_id) values ($1,$2,$3)', [decisionId, fileId, responseId]);

export const addHistory = (exec, decisionId, from, to, actorId, comment) =>
  exec.query('insert into decision_history (decision_id, from_status, to_status, actor_id, comment) values ($1,$2,$3,$4,$5)',
    [decisionId, from, to, actorId, comment ?? null]);

export const setStatus = (exec, id, status) =>
  exec.query('update decision_requests set status = $2, updated_at = now() where id = $1', [id, status]);

export const getRaw = async (exec, id, lock = false) =>
  (await exec.query(`select * from decision_requests where id = $1 ${lock ? 'for update' : ''}`, [id])).rows[0];

export const insertResponse = async (exec, decisionId, optionId, userId, comment) =>
  (await exec.query(
    'insert into decision_responses (decision_id, option_id, responded_by, comment) values ($1,$2,$3,$4) returning *',
    [decisionId, optionId, userId, comment ?? null])).rows[0];

export async function expireOverdue(exec, projectId = null) {
  await exec.query(
    `with ex as (
       update decision_requests set status = 'EXPIRED', updated_at = now()
        where status = 'PENDING_CUSTOMER' and deadline is not null and deadline < now()
          and ($1::uuid is null or project_id = $1)
        returning id)
     insert into decision_history (decision_id, from_status, to_status, comment)
     select id, 'PENDING_CUSTOMER', 'EXPIRED', 'Deadline passed' from ex`, [projectId]);
}

export async function listForProject(exec, projectId, { status, page, limit }) {
  const params = [projectId]; let cond = 'd.project_id = $1';
  if (status) { params.push(status); cond += ` and d.status = $${params.length}`; }
  const total = (await exec.query(`select count(*)::int as n from decision_requests d where ${cond}`, params)).rows[0].n;
  const rows = (await exec.query(
    `select d.*, u.full_name as requested_by_name,
       (select coalesce(json_agg(json_build_object('id', o.id, 'label', o.label, 'description', o.description,
          'priceNote', o.price_note, 'additionalCharge', o.additional_charge) order by o.sort_order), '[]'::json)
          from decision_options o where o.decision_id = d.id) as options,
       (select coalesce(json_agg(json_build_object('id', f.id, 'name', f.original_name, 'mimeType', f.mime_type)), '[]'::json)
          from decision_files df join files f on f.id = df.file_id where df.decision_id = d.id and df.response_id is null) as files,
       (select json_build_object('optionId', r.option_id, 'optionLabel', o.label, 'comment', r.comment, 'respondedAt', r.created_at, 'respondedBy', ru.full_name)
          from decision_responses r join decision_options o on o.id = r.option_id join users ru on ru.id = r.responded_by
         where r.decision_id = d.id order by r.created_at desc limit 1) as latest_response
     from decision_requests d join users u on u.id = d.requested_by
     where ${cond} order by (d.status = 'PENDING_CUSTOMER') desc, d.created_at desc
     limit ${limit} offset ${offsetOf(page, limit)}`, params)).rows;
  return { rows, total };
}

export async function getDetail(exec, id) {
  const d = (await exec.query(
    `select d.*, u.full_name as requested_by_name, p.name as project_name from decision_requests d
       join users u on u.id = d.requested_by join projects p on p.id = d.project_id where d.id = $1`, [id])).rows[0];
  if (!d) return null;
  const [options, responses, files, history] = await Promise.all([
    exec.query('select * from decision_options where decision_id = $1 order by sort_order', [id]),
    exec.query(
      `select r.*, o.label as option_label, u.full_name as responded_by_name,
         (select coalesce(json_agg(json_build_object('id', f.id, 'name', f.original_name, 'mimeType', f.mime_type)), '[]'::json)
            from decision_files df join files f on f.id = df.file_id where df.response_id = r.id) as files
       from decision_responses r join decision_options o on o.id = r.option_id join users u on u.id = r.responded_by
      where r.decision_id = $1 order by r.created_at`, [id]),
    exec.query(
      `select f.id, f.original_name as name, f.mime_type from decision_files df join files f on f.id = df.file_id
        where df.decision_id = $1 and df.response_id is null`, [id]),
    exec.query(
      `select h.*, u.full_name as actor_name from decision_history h left join users u on u.id = h.actor_id
        where h.decision_id = $1 order by h.created_at`, [id]),
  ]);
  return { ...d, options: options.rows, responses: responses.rows, files: files.rows, history: history.rows };
}
