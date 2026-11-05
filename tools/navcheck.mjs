// Real-click check of the SPA in headless Chrome: every nav item, without reloading (reloads hid a crash on navigation),
// then the simulation options. Exits non-zero on any failure.
//   node tools/navcheck.mjs [url] [admin-password]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://localhost:8000", pw = process.argv[3] || "demo-batikjernih";
const login = await (await fetch(url + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: pw }) })).json();
if (!login.token) throw new Error("login gagal");
const port = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn("google-chrome", ["--headless=new", `--remote-debugging-port=${port}`, "--no-sandbox", "--disable-gpu", `--user-data-dir=${mkdtempSync(join(tmpdir(), "bjnav-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (ok, name, extra = "") => { console.log(`${ok ? "ok  " : "GAGAL"} ${name} ${extra}`); if (!ok) bad++; };
try {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(200); } }
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const pend = new Map(), ev = [];
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else ev.push(d); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result.result.value;
  const errors = () => ev.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params.exceptionDetails.exception?.description?.slice(0, 200) ?? e.params.exceptionDetails.text);
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const session = JSON.stringify({ token: login.token, role: login.role, user: login.user });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('bj.session',${JSON.stringify(session)})}catch(e){}` });
  await send("Page.navigate", { url: url + "/" }); await sleep(5000);
  const labels = await js(`[...document.querySelectorAll('.topnav a')].map(a=>a.textContent)`);
  check(labels?.length >= 6, "menu tampil", String(labels));
  for (let round = 0; round < 2; round++) for (const lab of labels ?? []) {
    ev.length = 0;
    await js(`[...document.querySelectorAll('.topnav a')].find(a=>a.textContent==${JSON.stringify(lab)}).click()`);
    await sleep(1200);
    const r = JSON.parse(await js(`JSON.stringify({root:document.getElementById('root').children.length,h1:document.querySelector('h1')?.textContent,len:document.querySelector('.page')?.innerText.length??0,err:!!document.querySelector('.page .err')})`));
    const e = errors();
    check(r.root > 0 && r.len > 50 && !e.length && !r.err, `klik ${lab}`, e.join(" | ") || `h1=${r.h1}`);
  }
  await js(`document.querySelector('.topnav a').click()`); await sleep(1200);
  for (const opt of ["A", "B", "C", "Otomatis"]) {
    ev.length = 0;
    await js(`[...document.querySelectorAll('.seg button')].find(b=>b.textContent==${JSON.stringify(opt)}).click()`);
    await sleep(3500);
    const r = JSON.parse(await js(`JSON.stringify({on:document.querySelector('.seg button[aria-pressed="true"]')?.textContent,txt:document.querySelector('.sim .stamp')?.textContent})`));
    check(r.on === opt && !errors().length, `simulasi ${opt}`, r.txt ?? "");
  }
  ws.close();
} finally { chrome.kill(); }
process.exit(bad ? 1 : 0);
