// Small shared helpers: response envelope, async wrapper, case mapping, pagination, SQL where-builder, money.

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const send = (res, message, data = null, meta = undefined, status = 200) =>
  res.status(status).json({ success: true, message, data, ...(meta ? { meta } : {}) });

const camelKey = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

export const toCamel = (row) => {
  if (Array.isArray(row)) return row.map(toCamel);
  if (!row || typeof row !== 'object' || row instanceof Date) return row;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [camelKey(k), toCamel(v)]));
};

export const pageMeta = (page, limit, total) => ({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });

export const offsetOf = (page, limit) => (page - 1) * limit;

export function whereBuilder() {
  const conditions = [];
  const params = [];
  return {
    p(value) { params.push(value); return `$${params.length}`; },
    and(sql) { conditions.push(sql); },
    get clause() { return conditions.length ? `where ${conditions.join(' and ')}` : ''; },
    params,
  };
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function paymentSummary(contractAmount, received) {
  const total = round2(contractAmount || 0);
  const got = round2(received || 0);
  const outstanding = round2(Math.max(total - got, 0));
  const progress = total > 0 ? Math.min(100, round2((got / total) * 100)) : 0;
  return { totalAmount: total, totalReceived: got, outstanding, paymentProgress: progress };
}

export const requestContext = (req) => ({
  user: req.user ?? null,
  ip: req.ip,
  ua: req.get('user-agent') ?? null,
  requestId: req.id,
});
