import axios from 'axios';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '');

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { 'X-Requested-With': 'brightlook' }, // CSRF guard header required by the API
});

let refreshing = null;
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const isAuthCall = original?.url?.startsWith('/auth/');
    if (error.response?.status === 401 && original && !original._retry && !isAuthCall) {
      original._retry = true;
      refreshing ||= api.post('/auth/refresh').finally(() => { refreshing = null; });
      try {
        await refreshing;
        return api(original);
      } catch {
        window.dispatchEvent(new Event('auth:expired'));
      }
    }
    return Promise.reject(error);
  },
);

export const errorMessage = (error) => {
  const data = error?.response?.data;
  if (data?.errors?.length) return data.errors.map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).join('; ');
  return data?.message || error?.message || 'Something went wrong';
};

/** Build multipart FormData: arrays/objects become JSON strings, File lists are appended per field. */
export function toFormData(fields = {}, files = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  for (const [k, list] of Object.entries(files)) {
    for (const f of [].concat(list ?? [])) if (f) fd.append(k, f);
  }
  return fd;
}

export const fileUrl = (id, download = false) => (id ? `${API_BASE_URL}/files/${id}${download ? '?download=1' : ''}` : null);
export const unwrap = (promise) => promise.then((r) => ({ data: r.data.data, meta: r.data.meta }));
export default api;
