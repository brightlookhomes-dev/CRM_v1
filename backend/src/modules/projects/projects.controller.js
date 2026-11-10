import { asyncHandler, send } from '../../utils/helpers.js';
import * as service from './projects.service.js';

const cover = (req) => req.files?.cover?.[0];

export const create = asyncHandler(async (req, res) =>
  send(res, 'Project created', await service.createProject(req.ctx, req.valid.body, cover(req)), undefined, 201));
export const list = asyncHandler(async (req, res) => {
  const { data, meta } = await service.listProjects(req.user, req.valid.query);
  send(res, 'Projects retrieved', data, meta);
});
export const get = asyncHandler(async (req, res) => send(res, 'Project retrieved', await service.getProject(req.user, req.valid.params.id)));
export const update = asyncHandler(async (req, res) =>
  send(res, 'Project updated', await service.updateProject(req.ctx, req.valid.params.id, req.valid.body, cover(req))));
export const remove = asyncHandler(async (req, res) => {
  await service.deleteProject(req.ctx, req.valid.params.id);
  send(res, 'Project deleted');
});
export const addAssignment = asyncHandler(async (req, res) =>
  send(res, 'User assigned', await service.addAssignment(req.ctx, req.valid.params.id, req.valid.body), undefined, 201));
export const getAssignments = asyncHandler(async (req, res) =>
  send(res, 'Assignments retrieved', await service.getAssignments(req.user, req.valid.params.id)));
export const removeAssignment = asyncHandler(async (req, res) => {
  await service.removeAssignment(req.ctx, req.valid.params.id, req.valid.params.assignmentId);
  send(res, 'Assignment removed');
});
