export class AppError extends Error {
  constructor(status, message, errors = undefined) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export const notFound = (what = 'Resource') => new AppError(404, `${what} not found`);
export const forbidden = (msg = 'You do not have permission to perform this action') => new AppError(403, msg);
export const conflict = (msg) => new AppError(409, msg);
export const badRequest = (msg, errors) => new AppError(400, msg, errors);
