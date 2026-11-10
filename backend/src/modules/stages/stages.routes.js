import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { idParam, uuid, dateStr, opt } from '../../validators/common.js';
import { asyncHandler, send } from '../../utils/helpers.js';
import * as service from './stages.service.js';

export const stageInput = z.object({
  id: opt(uuid),
  name: z.string().trim().min(2, 'Stage name is required').max(120),
  weightPercent: z.coerce.number().gt(0, 'Percentage must be above 0').max(100),
  durationDays: z.coerce.number().int().min(1, 'Duration must be at least 1 day').max(1500),
  startOffsetDays: z.coerce.number().int().min(-1500).max(1500).default(0), // 0 = right after previous, negative = overlap
});

const projectAndStage = z.object({ id: uuid, stageId: uuid });
const projectAndEvent = z.object({ id: uuid, eventId: uuid });
const EVENT_TYPES = ['DEADLINE', 'MEETING', 'DELIVERY', 'INSPECTION', 'OTHER'];
const eventBody = z.object({
  title: z.string().trim().min(2, 'Title is required').max(200),
  eventType: z.enum(EVENT_TYPES).default('DEADLINE'),
  startDate: dateStr,
  endDate: opt(dateStr),
  notes: opt(z.string().trim().max(1000)),
}).refine((b) => !b.endDate || b.endDate >= b.startDate, { message: 'End date cannot be before the start date', path: ['endDate'] });
const eventPatch = z.object({
  title: z.string().trim().min(2).max(200).optional(), eventType: z.enum(EVENT_TYPES).optional(), startDate: dateStr.optional(),
  endDate: dateStr.nullable().optional(), notes: z.string().trim().max(1000).nullable().optional(),
});

// Mounted at /projects/:id/stages
export const stagesRouter = Router({ mergeParams: true });
stagesRouter.use(authenticate);
stagesRouter.get('/', validate({ params: idParam }), asyncHandler(async (req, res) =>
  send(res, 'Stages retrieved', await service.listStages(req.user, req.valid.params.id))));
stagesRouter.put('/', authorize('ADMIN'), validate({ params: idParam, body: z.object({ stages: z.array(stageInput).max(40) }) }), asyncHandler(async (req, res) =>
  send(res, 'Construction plan saved', await service.replaceStages(req.ctx, req.valid.params.id, req.valid.body.stages))));
stagesRouter.patch('/:stageId/schedule', authorize('ADMIN'), validate({
  params: projectAndStage,
  body: z.object({ plannedStart: opt(dateStr), plannedEnd: opt(dateStr), durationDays: opt(z.coerce.number().int().min(1).max(1500)), reason: opt(z.string().trim().max(500)) })
    .refine((b) => b.plannedStart || b.plannedEnd || b.durationDays, { message: 'Provide a new start, end or duration' }),
}), asyncHandler(async (req, res) =>
  send(res, 'Timeline updated', await service.rescheduleStage(req.ctx, req.valid.params.id, req.valid.params.stageId, req.valid.body))));

stagesRouter.post('/:stageId/complete', authorize('ADMIN'), validate({
  params: projectAndStage, body: z.object({ completed: z.boolean(), completedOn: opt(dateStr) }),
}), asyncHandler(async (req, res) =>
  send(res, req.valid.body.completed ? 'Stage marked complete' : 'Stage re-opened', await service.setStageCompleted(req.ctx, req.valid.params.id, req.valid.params.stageId, req.valid.body))));

// Mounted at /projects/:id/events
export const eventsRouter = Router({ mergeParams: true });
eventsRouter.use(authenticate);
eventsRouter.get('/', validate({ params: idParam }), asyncHandler(async (req, res) =>
  send(res, 'Events retrieved', await service.listEvents(req.user, req.valid.params.id))));
eventsRouter.post('/', authorize('ADMIN'), validate({ params: idParam, body: eventBody }), asyncHandler(async (req, res) =>
  send(res, 'Calendar item added', await service.createEvent(req.ctx, req.valid.params.id, req.valid.body), undefined, 201)));
eventsRouter.patch('/:eventId', authorize('ADMIN'), validate({ params: projectAndEvent, body: eventPatch }), asyncHandler(async (req, res) =>
  send(res, 'Calendar item updated', await service.updateEvent(req.ctx, req.valid.params.id, req.valid.params.eventId, req.valid.body))));
eventsRouter.delete('/:eventId', authorize('ADMIN'), validate({ params: projectAndEvent }), asyncHandler(async (req, res) => {
  await service.deleteEvent(req.ctx, req.valid.params.id, req.valid.params.eventId);
  send(res, 'Calendar item removed');
}));
