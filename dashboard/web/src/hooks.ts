import { useCallback, useEffect, useRef, useState } from "react";

export type Poll<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void; updated: number | null };

/** Poll an async loader. Keeps the last good data on error (a refresh never blanks the screen). */
export function usePoll<T>(load: () => Promise<T>, everyMs: number | null, deps: unknown[] = []): Poll<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState<number | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useCallback(async () => {
    try { setData(await loadRef.current()); setError(null); setUpdated(Date.now()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    setLoading(true);
    run();
    if (!everyMs) return;
    const id = setInterval(run, everyMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyMs, run, ...deps]);
  return { data, error, loading, reload: run, updated };
}

export function useHash(): string {
  const [h, setH] = useState(location.hash || "#/");
  useEffect(() => {
    const f = () => setH(location.hash || "#/");
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return h;
}
