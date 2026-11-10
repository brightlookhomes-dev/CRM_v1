import { asyncHandler, send } from '../../utils/helpers.js';
import * as service from './users.service.js';

export const create = asyncHandler(async (req, res) => send(res, 'User created', await service.createUser(req.ctx, req.valid.body), undefined, 201));
export const list = asyncHandler(async (req, res) => {
  const { data, meta } = await service.listUsers(req.valid.query);
  send(res, 'Users retrieved', data, meta);
});
export const get = asyncHandler(async (req, res) => send(res, 'User retrieved', await service.getUser(req.valid.params.id)));
export const update = asyncHandler(async (req, res) => send(res, 'User updated', await service.updateUser(req.ctx, req.valid.params.id, req.valid.body)));
export const setStatus = asyncHandler(async (req, res) => send(res, 'Status updated', await service.setStatus(req.ctx, req.valid.params.id, req.valid.body.status)));
export const resetPassword = asyncHandler(async (req, res) => send(res, 'Password reset', await service.resetPassword(req.ctx, req.valid.params.id, req.valid.body.newPassword)));
