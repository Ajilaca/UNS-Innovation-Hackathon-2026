import type { Session } from "./types";

const KEY = "bj.session";
let session: Session | null = null;
try { session = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { session = null; }

export const getSession = () => session;
export function setSession(s: Session | null) {
  session = s;
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* storage may be blocked */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (session) headers.Authorization = `Bearer ${session.token}`;
  if (init.json !== undefined) { headers["Content-Type"] = "application/json"; init = { ...init, body: JSON.stringify(init.json) }; }
  const r = await fetch(path, { ...init, headers });
  if (r.status === 401 && session) { setSession(null); location.hash = "#/masuk"; }
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch { /* not json */ }
    throw new ApiError(r.status, msg);
  }
  return r.json() as Promise<T>;
}

export async function downloadCsv(path: string, name: string) {
  const r = await fetch(path, { headers: session ? { Authorization: `Bearer ${session.token}` } : {} });
  if (!r.ok) throw new ApiError(r.status, "Gagal mengunduh");
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}
