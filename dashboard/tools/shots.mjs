// Screenshots of the running app through headless Chrome (CDP, no dependencies; Node 22+).
//   node dashboard/tools/shots.mjs --url http://localhost:8000 --token "$(cat /tmp/bj_token)" --out /tmp/shots \
//        --routes "#/,#/batch,#/model" --widths 1440,390 --wait 3000
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg("url", "http://localhost:8000"), out = arg("out", "shots"), token = arg("token", "");
const role = arg("role", "admin"), routes = arg("routes", "#/").split(","), widths = arg("widths", "1440").split(",").map(Number);
const evalJs = arg("eval", ""), wait = +arg("wait", 2500), port = 9300 + Math.floor(Math.random() * 500);
mkdirSync(out, { recursive: true });
const chrome = spawn("google-chrome", ["--headless=new", `--remote-debugging-port=${port}`, "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "bjshots-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ready() { for (let i = 0; i < 50; i++) { try { return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200); } } throw new Error("chrome did not start"); }

async function client(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map(); const events = [];
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else events.push(d); };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, events, close: () => ws.close() };
}

try {
  await ready();
  const tgt = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const c = await client(tgt.webSocketDebuggerUrl);
  await c.send("Page.enable"); await c.send("Runtime.enable"); await c.send("Log.enable");
  const session = JSON.stringify({ token, role, user: role === "admin" ? "admin" : "demo" });
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: token ? `try{localStorage.setItem('bj.session', ${JSON.stringify(session)})}catch(e){}` : "" });
  for (const w of widths) {
    await c.send("Emulation.setDeviceMetricsOverride", { width: w, height: +arg("height", w > 600 ? 900 : 844), deviceScaleFactor: 1, mobile: w < 500 });
    for (const r of routes) {
      c.events.length = 0;
      await c.send("Page.navigate", { url: url + "/" + r.replace(/^\//, "") }); await sleep(wait);
      await c.send("Runtime.evaluate", { expression: `location.hash='${r.startsWith("#") ? r : "#" + r}'`}); await sleep(wait);
      const m = await c.send("Runtime.evaluate", { expression: "JSON.stringify({h:document.documentElement.scrollHeight,sw:document.documentElement.scrollWidth,iw:innerWidth,sheet:(document.querySelector('.sheet')||{}).scrollHeight})", returnByValue: true });
      const errs = c.events.filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Log.entryAdded" && e.params.entry.level === "error")).map((e) => e.params?.exceptionDetails?.text ?? e.params?.entry?.text);
      if (evalJs) { const ev = await c.send("Runtime.evaluate", { expression: evalJs, returnByValue: true, awaitPromise: true }); console.log("  eval:", JSON.stringify(ev.result.result.value)); }
      const shot = await c.send("Page.captureScreenshot", { format: "png" });
      const name = `${w}-${r.replace(/[^a-z0-9]+/gi, "_") || "home"}.png`;
      writeFileSync(join(out, name), Buffer.from(shot.result.data, "base64"));
      console.log(name, m.result.result.value, errs.length ? "ERRORS: " + errs.join(" | ") : "no console errors");
    }
  }
  c.close();
} finally { chrome.kill(); }
