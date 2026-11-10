// Small reusable validators. Each returns an error string or ''.
export const required = (v, name = 'This field') => (String(v ?? '').trim() ? '' : `${name} is required`);
export const positive = (v, name = 'Amount') => (Number(v) > 0 ? '' : `${name} must be greater than 0`);
export const minLen = (v, n, name = 'This field') => (String(v ?? '').trim().length >= n ? '' : `${name} must be at least ${n} characters`);
export const percent = (v) => (v !== '' && Number(v) >= 0 && Number(v) <= 100 ? '' : 'Enter a value between 0 and 100');

export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_FILE_MB = 10;
export const checkFile = (file) => {
  if (!file) return '';
  if (!ALLOWED_TYPES.includes(file.type)) return `${file.name}: only JPEG, PNG, WebP or PDF allowed`;
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `${file.name}: larger than ${MAX_FILE_MB} MB`;
  return '';
};
export const checkFiles = (files = []) => [...files].map(checkFile).find(Boolean) || '';

/** Run a map of {field: errorString} and drop empties. */
export const collect = (checks) => Object.fromEntries(Object.entries(checks).filter(([, v]) => v));
