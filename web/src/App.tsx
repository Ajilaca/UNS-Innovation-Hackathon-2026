import { useEffect, useRef, useState } from "react";
import { api, getSession, setSession } from "./api";
import { IconBatch, IconBell, IconBulb, IconCompare, IconDoc, IconHome, IconModel, IconOut, Mark } from "./components/icons";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Pill } from "./components/ui";
import { hm, STATE_LABEL, STATUS_LABEL } from "./format";
import { useHash, usePoll } from "./hooks";
import type { EventItem, SimStatus, UnitInfo } from "./types";
import { BatchDetail } from "./views/BatchDetail";
import { Batches } from "./views/Batches";
import { Compare } from "./views/Compare";
import { Live } from "./views/Live";
import { Login } from "./views/Login";
import { Laporan } from "./views/Laporan";
import { Model } from "./views/Model";
import { Rekomendasi } from "./views/Rekomendasi";

const NAV = [
  { href: "#/", label: "Pantauan", icon: <IconHome />, match: (h: string) => h === "#/" || h === "" },
  { href: "#/batch", label: "Batch", icon: <IconBatch />, match: (h: string) => h.startsWith("#/batch") },
  { href: "#/perbandingan", label: "Perbandingan", short: "Banding", icon: <IconCompare />, match: (h: string) => h.startsWith("#/perbandingan") },
  { href: "#/rekomendasi", label: "Rekomendasi", short: "Saran", icon: <IconBulb />, match: (h: string) => h.startsWith("#/rekomendasi") },
  { href: "#/laporan", label: "Laporan", icon: <IconDoc />, match: (h: string) => h.startsWith("#/laporan") },
  { href: "#/model", label: "Model AI", icon: <IconModel />, match: (h: string) => h.startsWith("#/model") },
];

export default function App() {
  const hash = useHash();
  const [, force] = useState(0);
  const session = getSession();
  useEffect(() => { window.scrollTo(0, 0); }, [hash]);   // braces matter: scrollTo returns a Promise in current Chrome, and React would call it as a cleanup
  const units = usePoll(() => (getSession() ? api<{ units: UnitInfo[]; live: SimStatus }>("/api/units") : Promise.resolve(null)), 5000, [session?.token]);

  if (!session || hash === "#/masuk") return <Login onDone={() => force((n) => n + 1)} />;

  const u = units.data?.units[0];
  const page = hash.startsWith("#/batch/") ? <BatchDetail id={decodeURIComponent(hash.slice(8))} />
    : hash.startsWith("#/batch") ? <Batches /> : hash.startsWith("#/perbandingan") ? <Compare />
    : hash.startsWith("#/model") ? <Model /> : hash.startsWith("#/rekomendasi") ? <Rekomendasi />
    : hash.startsWith("#/laporan") ? <Laporan /> : <Live />;
  const logout = () => { setSession(null); location.hash = "#/masuk"; force((n) => n + 1); };

  return (
    <div className="app">
      <a className="skip" href="#isi">Lewati ke isi</a>
      <header className="hdr">
        <a className="brand" href="#/" aria-label="SEBAT, ke Pantauan"><Mark size={34} /><span>SEBAT<small>Solar-powered Electrocoagulation</small></span></a>
        <nav className="topnav" aria-label="Navigasi utama">
          {NAV.map((n) => <a key={n.href} href={n.href} aria-current={n.match(hash) ? "page" : undefined}>{n.icon}{n.label}</a>)}
        </nav>
        <div className="r">
          {u?.source === "simulator" && <Pill tone="warn">Data simulasi</Pill>}
          <span className="scope"><b>{u?.unit_id.toUpperCase() ?? "Unit belum aktif"}</b><span>Kampung Batik Laweyan, Solo</span></span>
          <Bell />
          <UserMenu name={session.user} role={session.role} onLogout={logout} />
        </div>
      </header>
      <main className="page" id="isi"><div className="canvas"><ErrorBoundary key={hash}>{page}</ErrorBoundary></div></main>
      <nav className="tabbar" aria-label="Navigasi utama (ponsel)">
        {NAV.map((n) => <a key={n.href} href={n.href} aria-current={n.match(hash) ? "page" : undefined} aria-label={n.label}>{n.icon}{n.short ?? n.label}</a>)}
      </nav>
    </div>
  );
}

/** Backend events are terse ("lwy-001: RUNNING"); show them in words. */
const eventWords = (msg: string) => {
  const b = msg.match(/^Batch \S+ selesai: (\S+)$/);
  if (b) return `Batch selesai: ${STATUS_LABEL[b[1]] ?? b[1]}`;
  const s = msg.match(/^\S+:\s*([A-Z_]+)$/)?.[1];
  return s ? STATE_LABEL[s] ?? s : msg;
};

function Bell() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    api<{ events: EventItem[] }>("/api/events").then((r) => setEvents([...r.events].reverse().slice(0, 8))).catch(() => setEvents([]));
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="usermenu" ref={box}>
      <button className="icon-btn" aria-haspopup="true" aria-expanded={open} aria-label="Kejadian terbaru" onClick={() => setOpen(!open)}><IconBell /></button>
      {open && (
        <div className="menu-pop wide">
          <div className="who"><b style={{ fontWeight: 600 }}>Kejadian terbaru</b></div>
          {events === null ? <p className="hint" style={{ padding: 10 }}>Memuat…</p> : events.length === 0 ? <p className="hint" style={{ padding: 10 }}>Belum ada kejadian.</p> : (
            <ul className="log" style={{ padding: "0 10px" }}>{events.map((e, i) => <li key={i}><time>{hm(e.ts)}</time><span>{eventWords(e.msg)}</span></li>)}</ul>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu({ name, role, onLogout }: { name: string; role: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="usermenu" ref={box}>
      <button ref={btn} className="avatar-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Menu pengguna, ${name}`} onClick={() => setOpen(!open)}>
        <span className="avatar" aria-hidden>{name.slice(0, 1).toUpperCase()}</span>
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <div className="who"><b style={{ fontWeight: 500 }}>{name}</b><div className="muted" style={{ fontSize: 12 }}>{role === "admin" ? "Admin" : "Hanya melihat"}</div></div>
          <button role="menuitem" onClick={onLogout}><IconOut />Keluar</button>
        </div>
      )}
    </div>
  );
}
