// Merekam demo dashboard menjadi GIF: Chrome headless menelusuri halaman, ffmpeg menyusun frame.
//   node dashboard/tools/demo-gif.mjs [--url http://localhost:8000] [--pw demo-batikjernih] [--out docs/demo.gif]
// Butuh Node 22+, Chrome, ffmpeg, dan aplikasi yang sedang berjalan dengan simulasi live.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg("url", "http://localhost:8000"), pw = arg("pw", "demo-batikjernih"), out = arg("out", "docs/demo.gif");
const W = +arg("width", 1920), H = +arg("height", 880), FPS = +arg("fps", 6), GIFW = +arg("gifwidth", 1280);   // 1920x880: Pantauan muat satu layar
const login = await (await fetch(url + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: pw }) })).json();
if (!login.token) throw new Error("login gagal");
const port = 9400 + Math.floor(Math.random() * 90), dir = mkdtempSync(join(tmpdir(), "sobat-demo-"));
mkdirSync(join(dir, "f"));
const chrome = spawn("google-chrome", ["--headless=new", `--remote-debugging-port=${port}`, "--no-sandbox", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${join(dir, "p")}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(200); } }
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const pend = new Map();
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result.result?.value;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const session = JSON.stringify({ token: login.token, role: login.role, user: login.user });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('bj.session',${JSON.stringify(session)})}catch(e){}` });
  await send("Page.navigate", { url: url + "/" }); await sleep(4000);

  let n = 0;
  const frame = async () => {
    const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
    writeFileSync(join(dir, "f", `${String(n++).padStart(5, "0")}.jpg`), Buffer.from(s.result.data, "base64"));
  };
  // pencari kontainer yang bisa digulir (halaman memakai .sheet atau dokumen)
  const SC = `(()=>{const e=document.querySelector('.sheet');return e&&e.scrollHeight>e.clientHeight+4?e:document.scrollingElement})()`;
  // rekam selama `sec` detik pada FPS tetap. tour=true: tahan di atas, gulir pelan sampai dasar halaman, tahan lagi,
  // supaya seluruh halaman terlihat (bukan hanya layar pertama).
  const scene = async (act, sec, tour = false) => {
    if (act) await act();
    await js(`${SC}.scrollTo(0,0)`);
    const max = tour ? +(await js(`(()=>{const e=${SC};return e.scrollHeight-e.clientHeight})()`)) : 0;
    const t0 = Date.now(), step = 1000 / FPS;
    for (;;) {
      const f0 = Date.now(), p = (f0 - t0) / (sec * 1000);
      if (p >= 1) break;
      if (max > 0) { const q = Math.min(Math.max((p - 0.15) / 0.65, 0), 1), e = q * q * (3 - 2 * q); await js(`${SC}.scrollTo(0,${Math.round(e * max)})`); }
      await frame(); await sleep(Math.max(0, step - (Date.now() - f0)));
    }
  };
  const nav = (label) => () => js(`[...document.querySelectorAll('.topnav a')].find(a=>a.textContent.includes(${JSON.stringify(label)})).click()`);
  const press = (txt, sel = "button") => () => js(`[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.includes(${JSON.stringify(txt)}))?.click()`);

  await scene(nav("Pantauan"), 2);
  await scene(press("A", ".seg button"), 11, true);       // simulasi A: hari cerah, jalan 120x, seluruh halaman
  await scene(press("C", ".seg button"), 3);               // kondisi sulit
  await scene(nav("Batch"), 5, true);
  await scene(() => js(`document.querySelector('tr.link')?.click()`), 8, true);
  await scene(nav("Perbandingan"), 5, true);
  await scene(press("Sumber energi"), 4, true);
  await scene(press("Ukuran panel"), 4, true);
  await scene(press("Ketahanan"), 4, true);
  await scene(nav("Rekomendasi"), 5, true);
  await scene(nav("Laporan"), 5, true);
  await scene(nav("Model AI"), 6, true);
  ws.close();
  console.log(`${n} frame`);
} finally { chrome.kill(); }

const pal = join(dir, "pal.png");
const vf = `fps=${FPS},scale=${GIFW}:-1:flags=lanczos`;
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "f", "%05d.jpg"), "-vf", `${vf},palettegen=max_colors=112:stats_mode=diff`, pal]);
mkdirSync(join(out, ".."), { recursive: true });
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "f", "%05d.jpg"), "-i", pal, "-lavfi", `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, "-loop", "0", out]);
console.log("tersimpan:", out);
