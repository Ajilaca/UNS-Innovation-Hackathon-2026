import { FormEvent, useState } from "react";
import { api, setSession } from "../api";
import { Mark } from "../components/icons";
import { greeting } from "../recommend";
import { waterFromPtco } from "../components/water";
import type { Session } from "../types";

export function Login({ onDone }: { onDone: () => void }) {
  const [user, setUser] = useState("admin");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const enter = async (path: string, body?: unknown) => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ token: string; role: Session["role"]; user: string }>(path, { method: "POST", json: body });
      setSession({ token: r.token, role: r.role, user: r.user });
      location.hash = "#/";
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "Gagal masuk"); } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); enter("/api/auth/login", { username: user, password: pass }); };
  return (
    <main className="login">
      <section className="login-art">
        <div className="brand"><Mark size={36} />SOBAT</div>
        <div>
          <h1>Pengolahan limbah batik yang cerdas dan bertenaga surya.</h1>
          <p>Pemantauan unit elektrokoagulasi tenaga surya untuk UMKM Kampung Batik Laweyan, Solo. Arus dihentikan saat warna air terbaca memenuhi baku mutu 200 Pt-Co. Prototipe: data masih simulasi.</p>
        </div>
        <div className="login-strip" aria-hidden>
          {[3000, 1600, 900, 500, 280, 150, 60].map((c) => <span key={c} style={{ background: waterFromPtco(c) }} />)}
        </div>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <div><h2>{greeting()}!</h2><p className="muted" style={{ marginTop: 4 }}>Masuk untuk melihat kondisi pengolahan limbah batik Anda hari ini.</p></div>
          <label className="field"><span>Nama pengguna</span><input className="input" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" required /></label>
          <label className="field"><span>Kata sandi</span><input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" required /></label>
          {err && <p role="alert" className="hint" style={{ color: "var(--negative)" }}>{err}</p>}
          <button className="btn primary" disabled={busy} style={{ height: 40 }}>Masuk</button>
          <button type="button" className="btn" disabled={busy} style={{ height: 40 }} onClick={() => enter("/api/auth/demo")}>Lihat demo (hanya baca)</button>
        </form>
      </section>
    </main>
  );
}
