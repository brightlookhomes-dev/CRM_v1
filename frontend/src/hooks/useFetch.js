import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../services/api.js';

/** Runs `fn()` (returning {data, meta}) on mount and when deps change. */
export function useFetch(fn, deps = []) {
  const [state, setState] = useState({ data: null, meta: null, loading: true, error: '' });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const { data, meta } = await fnRef.current();
      setState({ data, meta, loading: false, error: '' });
    } catch (e) {
      setState({ data: null, meta: null, loading: false, error: errorMessage(e) });
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, deps);
  return { ...state, reload: run };
}
