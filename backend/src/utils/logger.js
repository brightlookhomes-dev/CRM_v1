const SENSITIVE = /password|token|secret|authorization|cookie|hash/i;

const redact = (value, depth = 0) => {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1)]),
  );
};

const write = (level, message, meta = {}) => {
  if (process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...redact(meta) });
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
};

export const logger = {
  info: (m, meta) => write('info', m, meta),
  warn: (m, meta) => write('warn', m, meta),
  error: (m, meta) => write('error', m, meta),
  redact,
};
