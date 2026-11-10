import { offsetOf } from '../../utils/helpers.js';

export const insert = async (exec, u) =>
  (await exec.query(
    `insert into project_updates (project_id, created_by, update_type, title, description, progress_percentage,
        work_completed, work_remaining, material_name, quantity, unit, supplier, delivery_status, delivery_date, decision_request_id, stage_id, overall_after)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
    [u.projectId, u.createdBy, u.type, u.title ?? null, u.description ?? null, u.progressPercentage ?? null,
      u.workCompleted ?? null, u.workRemaining ?? null, u.materialName ?? null, u.quantity ?? null, u.unit ?? null,
      u.supplier ?? null, u.deliveryStatus ?? null, u.deliveryDate ?? null, u.decisionRequestId ?? null, u.stageId ?? null, u.overallAfter ?? null])).rows[0];

export const linkFile = (exec, updateId, fileId, kind) =>
  exec.query('insert into project_update_files (update_id, file_id, kind) values ($1,$2,$3)', [updateId, fileId, kind]);

const SELECT = `
  select pu.*, u.full_name as created_by_name, (select s.name from project_stages s where s.id = pu.stage_id) as stage_name,
    (select coalesce(json_agg(json_build_object('id', f.id, 'name', f.original_name, 'mimeType', f.mime_type, 'kind', x.kind)), '[]'::json)
       from project_update_files x join files f on f.id = x.file_id where x.update_id = pu.id) as files,
    (select json_build_object('id', d.id, 'title', d.title, 'status', d.status) from decision_requests d where d.id = pu.decision_request_id) as decision
  from project_updates pu join users u on u.id = pu.created_by`;

export async function list(exec, projectId, { type, page, limit }) {
  const params = [projectId]; let cond = 'pu.project_id = $1';
  if (type) { params.push(type); cond += ` and pu.update_type = $${params.length}`; }
  const total = (await exec.query(`select count(*)::int as n from project_updates pu where ${cond}`, params)).rows[0].n;
  const rows = (await exec.query(
    `${SELECT} where ${cond} order by pu.update_date desc, pu.id limit ${limit} offset ${offsetOf(page, limit)}`, params)).rows;
  return { rows, total };
}

export const getById = async (exec, id) => (await exec.query(`${SELECT} where pu.id = $1`, [id])).rows[0];

export const updateText = (exec, id, { title, description }) =>
  exec.query(
    `update project_updates set title = coalesce($2, title), description = coalesce($3, description), updated_at = now() where id = $1`,
    [id, title ?? null, description ?? null]);
