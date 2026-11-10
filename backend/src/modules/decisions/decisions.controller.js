import { asyncHandler, send } from '../../utils/helpers.js';
import * as service from './decisions.service.js';

export const create = asyncHandler(async (req, res) =>
  send(res, 'Decision requested', await service.createDecision(req.ctx, req.valid.params.id, req.valid.body, req.files?.photos), undefined, 201));
export const list = asyncHandler(async (req, res) => {
  const { data, meta } = await service.listDecisions(req.user, req.valid.params.id, req.valid.query);
  send(res, 'Decisions retrieved', data, meta);
});
export const get = asyncHandler(async (req, res) => send(res, 'Decision retrieved', await service.getDecision(req.user, req.valid.params.id)));
export const history = asyncHandler(async (req, res) => send(res, 'History retrieved', await service.getHistory(req.user, req.valid.params.id)));
export const respond = asyncHandler(async (req, res) =>
  send(res, 'Response recorded', await service.respond(req.ctx, req.valid.params.id, req.valid.body, req.files?.documents)));
export const finalize = asyncHandler(async (req, res) =>
  send(res, 'Decision updated', await service.finalize(req.ctx, req.valid.params.id, req.valid.body.action, req.valid.body.comment)));
export const cancel = asyncHandler(async (req, res) =>
  send(res, 'Decision cancelled', await service.cancel(req.ctx, req.valid.params.id, req.valid.body.comment)));
