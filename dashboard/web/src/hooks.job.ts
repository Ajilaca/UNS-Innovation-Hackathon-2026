import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export type Job = { id: string; kind: string; state: "running" | "done" | "error"; progress: number; error: string | null };

/** Start a backend job and poll it; calls onDone when finished. */
export function useJob(kind: string, onDone: () => void) {
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!job || job.state !== "running") return;
    const id = setInterval(async () => {
      try {
        const j = await api<Job>(`/api/jobs/${job.id}`);
        setJob(j);
        if (j.state !== "running") done.current();
      } catch (e) { setErr(e instanceof Error ? e.message : "Gagal"); }
    }, 1500);
    return () => clearInterval(id);
  }, [job]);
  const start = async (query = "") => {
    setErr(null);
    try { setJob(await api<Job>(`/api/jobs/${kind}${query}`, { method: "POST" })); }
    catch (e) { setErr(e instanceof Error ? e.message : "Gagal"); }
  };
  return { job, start, err, running: job?.state === "running" };
}
