import { asyncHandler, send } from '../../utils/helpers.js';
import * as service from './bills.service.js';

export const create = asyncHandler(async (req, res) => send(res, 'Bill submitted', await service.createBill(req.ctx, req.valid.body, req.files), undefined, 201));
export const list = asyncHandler(async (req, res) => {
  const { data, meta } = await service.listBills(req.user, req.valid.query);
  send(res, 'Bills retrieved', data, meta);
});
export const get = asyncHandler(async (req, res) => send(res, 'Bill retrieved', await service.getBill(req.user, req.valid.params.id)));
export const history = asyncHandler(async (req, res) => send(res, 'Bill history retrieved', await service.getHistory(req.user, req.valid.params.id)));
export const edit = asyncHandler(async (req, res) => send(res, 'Bill updated', await service.editBill(req.ctx, req.valid.params.id, req.valid.body)));
export const resubmit = asyncHandler(async (req, res) => send(res, 'Bill resubmitted', await service.resubmit(req.ctx, req.valid.params.id, req.valid.body, req.files)));
export const review = (action, message) => asyncHandler(async (req, res) =>
  send(res, message, await service.review(req.ctx, req.valid.params.id, action, req.valid.body.comment, req.valid.body)));
export const markPaid = asyncHandler(async (req, res) => send(res, 'Bill marked as paid', await service.markPaid(req.ctx, req.valid.params.id, req.valid.body)));
