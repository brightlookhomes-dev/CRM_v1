import crypto from 'node:crypto';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { config } from '../config/environment.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const requestId = (req, res, next) => {
  req.id = req.get('x-request-id') || crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
};

export const requestLogger = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () =>
    logger.info('request', { id: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start, user: req.user?.id }));
  next();
};

export const validate = (schemas) => (req, res, next) => {
  try {
    req.valid = {};
    for (const key of ['params', 'query', 'body']) {
      if (schemas[key]) req.valid[key] = schemas[key].parse(req[key] ?? {});
    }
    next();
  } catch (err) {
    next(err);
  }
};

const noop = (req, res, next) => next();
const limiter = (opts) => (config.isTest ? noop : rateLimit({ standardHeaders: true, legacyHeaders: false, ...opts }));
export const apiLimiter = limiter({ windowMs: 60_000, limit: 600, message: { success: false, message: 'Too many requests' } });
export const loginLimiter = limiter({ windowMs: 15 * 60_000, limit: 20, message: { success: false, message: 'Too many login attempts, try again later' } });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 12 } });
export const uploadFields = (fields) => upload.fields(fields);
export const uploadNone = upload.none();

const CONSTRAINT_MESSAGES = {
  uq_users_username: 'Username is already taken',
  uq_users_email: 'Email is already in use',
  uq_vendor_bill_invoice: 'A bill with this vendor and invoice number already exists for the project',
  uq_payment_reference: 'A payment with this reference number is already recorded for the project',
  uq_payment_reversal: 'This payment has already been reversed',
  uq_active_assignment: 'This user is already assigned to the project in that role',
};

export const notFoundHandler = (req, res, next) => next(new AppError(404, `Route ${req.method} ${req.path} not found`));

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  let status = 500;
  let message = 'Something went wrong';
  let errors;

  if (err instanceof AppError) {
    ({ status, message, errors } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    message = 'Validation failed';
    errors = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  } else if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : `Upload error: ${err.message}`;
  } else if (err?.code === '23505') {
    status = 409;
    message = CONSTRAINT_MESSAGES[err.constraint] || 'Duplicate record';
  } else if (err?.code === '23503') {
    status = 409;
    message = 'Operation conflicts with related records';
  } else if (err?.code === '23514' || err?.code === '22P02') {
    status = 400;
    message = 'Invalid data supplied';
  }

  if (status >= 500) logger.error('unhandled error', { id: req.id, error: err.message, stack: err.stack });
  res.status(status).json({ success: false, message, ...(errors ? { errors } : {}), requestId: req.id });
};
