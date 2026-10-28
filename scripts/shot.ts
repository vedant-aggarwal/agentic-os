// Screenshots of a page in headless Chrome over the DevTools protocol, to a file. No npm dependency.
//   bun scripts/shot.ts --url http://127.0.0.1:8103/ [--cookie aos_session=<token>] [--mobile] [--width 430 --height 932]
//     [--js "<code>"] [--wait 1500] --shot test\screens\today.png [--js ... --wait ... --shot ...]
// Steps (--js, --wait, --shot) run in the order given after the page has loaded; --js may return a promise.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const url = opt("url");
if (!url) { console.error("--url is required"); process.exit(2); }
const mobile = argv.includes("--mobile");
const width = Number(opt("width", mobile ? "430" : "1280")), height = Number(opt("height", mobile ? "932" : "800"));
const chrome = opt("chrome", ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => Bun.file(p).size > 0) ?? "chrome");
const steps: { kind: "js" | "wait" | "shot"; v: string }[] = [];
for (let i = 0; i < argv.length; i++) if (["--js", "--wait", "--shot"].includes(argv[i])) steps.push({ kind: argv[i].slice(2) as any, v: argv[++i] });

const profile = `${tmpdir()}/shot-profile-${process.pid}`;
const proc = Bun.spawn([chrome, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", `--window-size=${width},${height}`, "about:blank"], { stdout: "ignore", stderr: "pipe" });
let wsUrl = "";
const reader = proc.stderr.getReader();
const dec = new TextDecoder();
let buf = "";
while (!wsUrl) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value);
  const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
  if (m) wsUrl = m[1];
}
if (!wsUrl) { console.error("Chrome did not start:\n" + buf.slice(0, 800)); proc.kill(); process.exit(1); }
const port = new URL(wsUrl).port;
const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json()) as any;
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = (e) => rej(e); });
let seq = 0;
const pending = new Map<number, (v: any) => void>();
const events: ((m: any) => void)[] = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
  else if (m.method) for (const f of events) f(m);
};
const send = (method: string, params: any = {}) => new Promise<any>((res, rej) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const loaded = () => new Promise<void>((res) => { const f = (m: any) => { if (m.method === "Page.loadEventFired") { events.splice(events.indexOf(f), 1); res(); } }; events.push(f); });

await send("Page.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile });
if (mobile) await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
const cookie = opt("cookie");
if (cookie) { const [name, ...rest] = cookie.split("="); await send("Network.setCookie", { name, value: rest.join("="), url }); }
const done = loaded();
await send("Page.navigate", { url });
await Promise.race([done, sleep(15000)]);
await sleep(Number(opt("settle", "1200")));
for (const s of steps) {
  if (s.kind === "wait") await sleep(Number(s.v));
  else if (s.kind === "js") {
    const r = await send("Runtime.evaluate", { expression: `(async () => { ${s.v} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) console.error("js failed:", r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  } else if (s.kind === "shot") {
    const r = await send("Page.captureScreenshot", { format: "png" });
    mkdirSync(dirname(s.v), { recursive: true });
    writeFileSync(s.v, Buffer.from(r.data, "base64"));
    console.log(`wrote ${s.v}`);
  }
}
ws.close();
proc.kill();
await proc.exited;
try { const { rmSync } = await import("node:fs"); rmSync(profile, { recursive: true, force: true }); } catch {}
