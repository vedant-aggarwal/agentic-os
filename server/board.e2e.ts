// End-to-end checks for the board, queue, cache, rewind and Builders against a running TEST server (never the live
// one), with real Claude turns in scratch folders:
//   lanes     a finished job is in Needs you; completed, archived, back, star and review flags
//   queue     a message sent mid-turn waits and runs when the turn ends
//   cold      with a 1-minute TTL a message to a cold job gets 428; force sends it
//   warm      keep-warm pings an idle job before its cache goes cold, and the ping found it warm
//   rewind    rewinding turn 2 puts the file back and forks the session
//   steer     a message steered into a running turn gets done in that turn
//   rewindcode  a code-only rewind puts the file back and keeps the chat
//   fork      a fork after turn 1 forgets turn 2; the original stays
//   worktree  worktree: true starts the job in its own copy
//   form      ask_form waits for the phone's answers and the agent uses them
//   builder   publish_changes reaches the global Builder, which commits and reports
// Run:  bun server/board.e2e.ts --port 8231 --data <DATA_DIR> [--only lanes,queue]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k: string, d = "") => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const PORT = arg("port", "8231");
if (["8090", "8093", "8096"].includes(PORT)) throw new Error("Not against the live server.");
const TOKEN = readFileSync(join(arg("data"), "agent.token"), "utf8").trim();
const only = arg("only") ? arg("only").split(",") : null;
const ROOT = join(tmpdir(), "aos-board-e2e", String(Date.now()));
const MODEL = arg("model", "haiku");

async function call(path: string, json?: unknown) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/v1${path}`, {
    method: json === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, ...(json === undefined ? {} : { "Content-Type": "application/json" }) },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  return { status: r.status, d: (await r.json().catch(() => ({}))) as any };
}
async function api(path: string, json?: unknown) {
  const { status, d } = await call(path, json);
  if (status >= 400) throw new Error(`${path}: ${status} ${d.error ?? ""}`);
  return d;
}
async function waitFor(id: string, ok: (j: any, evs: any[]) => boolean, ms = 300_000) {
  const t0 = Date.now();
  for (;;) {
    const { job, events } = await api(`/jobs/${id}`);
    if (ok(job, events)) return { job, events };
    if (job.status === "failed") throw new Error(`job failed: ${job.error}`);
    if (Date.now() - t0 > ms) throw new Error(`timed out; status ${job.status}`);
    await Bun.sleep(1500);
  }
}
const settled = (j: any) => (j.status === "idle" || j.status === "stopped") && !(j.queue?.length);
function scratch(name: string, git = false) {
  const d = join(ROOT, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "README.md"), "# scratch\n");
  if (git) for (const c of [["init", "-q", "-b", "main"], ["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first"]]) Bun.spawnSync(["git", ...c], { cwd: d });
  return d;
}
const check = (c: unknown, msg: string) => { if (!c) throw new Error(msg); };
const ONE = "Keep it short: do only what is asked, then reply in one line.";
const start = (cwd: string, context: string) => api("/jobs", { engine: "claude", model: MODEL, mode: "auto", cwd, context: `${context} ${ONE}` }).then((r) => r.job.id as string);
const defaults = { cacheTtlMin: { claude: 60 }, leadMin: 15, keepWarm: false, batchSec: 20 };

const tests: Record<string, (cwd: string) => Promise<void>> = {
  async lanes(cwd) {
    const id = await start(cwd, "Create a file hello.txt in the working folder containing exactly the word hi.");
    const { job } = await waitFor(id, settled);
    check(job.lane === "attention", `lane ${job.lane}, expected attention`);
    check(job.files > 0, "files not counted");
    check(job.cache?.state === "warm", `cache ${job.cache?.state}`);
    check(job.ship === null, "unexpected ship");
    let j = (await api(`/jobs/${id}/board`, { lane: "completed" })).job;
    check(j.lane === "completed", "not completed");
    j = (await api(`/jobs/${id}/board`, { lane: "archived" })).job;
    check(j.lane === "archived", "not archived");
    j = (await api(`/jobs/${id}/board`, { lane: "completed" })).job;
    j = (await api(`/jobs/${id}/board`, { lane: "attention", starred: true, review: true })).job;
    check(j.lane === "attention" && j.starred && j.review, "flags or lane wrong");
    j = (await api(`/jobs/${id}/board`, { keepWarm: 1 })).job;
    check(j.cache.keepWarmUntil, "keep-warm not set");
    j = (await api(`/jobs/${id}/board`, { keepWarm: 0 })).job;
    check(j.cache.keepWarm === "off", "keep-warm not off");
  },
  async queue(cwd) {
    const id = await start(cwd, "Run the shell command: powershell -NoProfile -Command Start-Sleep -Seconds 25 ; then say slept.");
    await waitFor(id, (j, evs) => evs.some((e: any) => e.type === "tool"), 120_000);
    const q = (await api(`/jobs/${id}/prompt`, { text: "Reply with exactly: queued-ok", queue: true })).job;
    check(q.queue?.length === 1, `queue length ${q.queue?.length}`);
    const { events } = await waitFor(id, (j, evs) => settled(j) && evs.filter((e: any) => e.type === "user").length >= 2);
    check(events.some((e: any) => e.type === "assistant" && /queued-ok/i.test(e.text ?? "")), "queued message got no answer");
  },
  async cold(cwd) {
    const id = await start(cwd, "Reply with exactly: first");
    await waitFor(id, settled);
    await api("/jobs/board-settings", { cacheTtlMin: { claude: 1 }, leadMin: 0.5 });
    try {
      await Bun.sleep(65_000);
      const r = await call(`/jobs/${id}/prompt`, { text: "Reply with exactly: second" });
      check(r.status === 428, `expected 428, got ${r.status}`);
      check(/cold/i.test(r.d.error ?? ""), "no cold message");
      await api(`/jobs/${id}/prompt`, { text: "Reply with exactly: second", force: true });
      const { job } = await waitFor(id, (j, evs) => settled(j) && evs.filter((e: any) => e.type === "user").length >= 2);
      // The real cache outlives the 1-minute test TTL; the job reports what the turn actually found.
      const l = job.cache?.last;
      check(l && l.turn === 2 && l.cold === (l.write + l.fresh > l.read), `cache record wrong: ${JSON.stringify(l)}`);
    } finally { await api("/jobs/board-settings", defaults); }
  },
  async warm(cwd) {
    const id = await start(cwd, "Reply with exactly: first");
    const { job: j0 } = await waitFor(id, settled);
    await api("/jobs/board-settings", { cacheTtlMin: { claude: 3 }, leadMin: 2 });
    try {
      await api(`/jobs/${id}/board`, { keepWarm: 1 });
      const { job, events } = await waitFor(id, (j, evs) => settled(j) && evs.some((e: any) => e.type === "user" && e.ping), 240_000);
      check(job.summary === j0.summary, "a ping changed the summary");
      check(job.cache?.last && job.cache.last.cold === false, `ping found the cache cold: ${JSON.stringify(job.cache?.last)}`);
      check(events.filter((e: any) => e.type === "user" && !e.ping).length === 1, "ping counted as his message");
    } finally { await api("/jobs/board-settings", defaults); }
  },
  async rewind(cwd) {
    const id = await start(cwd, "Create a file hello.txt in the working folder containing exactly the word hi.");
    const { job: j1 } = await waitFor(id, settled);
    await api(`/jobs/${id}/prompt`, { text: `Append a second line containing exactly bye to hello.txt. ${ONE}` });
    await waitFor(id, (j, evs) => settled(j) && evs.filter((e: any) => e.type === "user").length >= 2);
    check(/bye/.test(readFileSync(join(cwd, "hello.txt"), "utf8")), "bye not appended");
    const r = await api(`/jobs/${id}/rewind`, { turn: 2 });
    check(r.conversation === "forked", `conversation ${r.conversation}`);
    check(readFileSync(join(cwd, "hello.txt"), "utf8").trim() === "hi", "file not rewound");
    check(r.job.dropped?.length === 1, "no dropped range");
    await api(`/jobs/${id}/prompt`, { text: "Without using any tools: list every request I made in this chat so far, one line each.", force: true });
    const { job, events } = await waitFor(id, (j, evs) => settled(j) && evs.filter((e: any) => e.type === "user").length >= 3);
    check(job.nativeId && job.nativeId !== j1.nativeId, "session didn't fork");
    const last = [...events].reverse().find((e: any) => e.type === "assistant")?.text ?? "";
    check(!/bye/i.test(last), `the forked chat still remembers turn 2: ${last.slice(0, 200)}`);
  },
  async steer(cwd) {
    const id = await start(cwd, "Run the shell command: powershell -NoProfile -Command Start-Sleep -Seconds 20 ; then say slept.");
    await waitFor(id, (j, evs) => evs.some((e: any) => e.type === "tool"), 120_000);
    const j = (await api(`/jobs/${id}/prompt`, { text: "Also create a file steer.txt in the working folder containing exactly: ok", steer: true })).job;
    check(!j.queue?.length, "steered message was queued instead");
    const { events } = await waitFor(id, (x) => settled(x), 240_000);
    check(events.some((e: any) => e.type === "user" && e.steer), "no steered message in the chat");
    check(existsSync(join(cwd, "steer.txt")), "the steered request wasn't done");
  },
  async rewindcode(cwd) {
    const id = await start(cwd, "Create a file hello.txt in the working folder containing exactly the word hi.");
    await waitFor(id, settled);
    await api(`/jobs/${id}/prompt`, { text: `Append a second line containing exactly bye to hello.txt. ${ONE}` });
    await waitFor(id, (j, evs) => settled(j) && evs.filter((e: any) => e.type === "user").length >= 2);
    const r = await api(`/jobs/${id}/rewind`, { turn: 2, mode: "code" });
    check(r.conversation === "kept", `conversation ${r.conversation}`);
    check(readFileSync(join(cwd, "hello.txt"), "utf8").trim() === "hi", "file not rewound");
    check(!r.job.dropped?.length, "code-only rewind dropped chat turns");
  },
  async fork(cwd) {
    const id = await start(cwd, "Reply with exactly the word: alpha");
    await waitFor(id, settled);
    await api(`/jobs/${id}/prompt`, { text: `Reply with exactly the word: beta` });
    const { job: j0 } = await waitFor(id, (j, evs) => settled(j) && evs.filter((e: any) => e.type === "user").length >= 2);
    const f = (await call(`/jobs/${id}/fork`, { turn: 1 }));
    check(f.status === 201, `fork ${f.status} ${f.d.error ?? ""}`);
    const fid = f.d.job.id;
    await api(`/jobs/${fid}/prompt`, { text: "Without tools: which words did I ask you to reply with so far in this chat? List them.", force: true });
    const { job, events } = await waitFor(fid, (j, evs) => settled(j) && evs.filter((e: any) => e.type === "user").length >= 2);
    const last = [...events].reverse().find((e: any) => e.type === "assistant")?.text ?? "";
    check(/alpha/i.test(last) && !/beta/i.test(last), `fork remembers wrong: ${last.slice(0, 200)}`);
    check(job.nativeId && job.nativeId !== j0.nativeId, "fork shares the session");
    const orig = (await api(`/jobs/${id}`)).events.filter((e: any) => e.type === "user").length;
    check(orig === 2, "the original job changed");
  },
  async worktree(cwd) {
    const r = await api("/jobs", { engine: "claude", model: MODEL, mode: "auto", cwd, worktree: true, context: `Reply with exactly: ok. ${ONE}` });
    check(/\.aos-worktrees/.test(r.job.cwd), `not in a worktree: ${r.job.cwd}`);
    await waitFor(r.job.id, settled);
  },
  async form(cwd) {
    const id = await start(cwd, "Use the ask_form tool (not AskUserQuestion) with a small HTML form that has a text field named city and two checkboxes named fruit with values apple and mango. Then reply with exactly what I answered.");
    const { job } = await waitFor(id, (j) => !!j.pending?.html, 180_000);
    check(/name=["']?city/.test(job.pending.html), "form has no city field");
    await api(`/jobs/${id}/permission`, { requestId: job.pending.requestId, optionId: "submit", answers: { city: "Delhi", fruit: ["mango"] } });
    const { events } = await waitFor(id, settled);
    const last = [...events].reverse().find((e: any) => e.type === "assistant")?.text ?? "";
    check(/Delhi/.test(last) && /mango/i.test(last), `answers not used: ${last.slice(0, 200)}`);
  },
  async builder(cwd) {
    await api("/jobs/board-settings", { batchSec: 0 });
    try {
      const id = await start(cwd, "Create a file x.txt containing exactly: ship me. Then call publish_changes with summary \"Add x.txt\" and deploy false.");
      const { job } = await waitFor(id, (j) => settled(j) && !!j.ship, 240_000);
      check(job.ship.state === "queued" || job.ship.state === "sent" || job.ship.state === "committed", `ship ${job.ship.state}`);
      const t0 = Date.now();
      let b: any = null;
      while (Date.now() - t0 < 400_000) {
        const j = (await api(`/jobs/${id}`)).job;
        if (["committed", "live", "failed"].includes(j.ship?.state)) { b = j.ship; break; }
        await Bun.sleep(3000);
      }
      check(b, "the Builder never reported");
      check(b.state === "committed", `ship ended ${b.state}: ${b.note}`);
      const log = new TextDecoder().decode(Bun.spawnSync(["git", "log", "--oneline", "-3"], { cwd }).stdout);
      check(log.split("\n").filter(Boolean).length >= 2, `no new commit: ${log}`);
      const builders = (await api("/jobs/builders")).builders;
      const g = builders.find((x: any) => x.key === "_global");
      check(g?.job?.role === "builder" && g.model === "sonnet" && g.effort === "medium", "global Builder wrong");
    } finally { await api("/jobs/board-settings", defaults); }
  },
};

const results: string[] = [];
for (const [name, fn] of Object.entries(tests)) {
  if (only && !only.includes(name)) continue;
  const cwd = scratch(name, name === "builder" || name === "worktree");
  const t0 = Date.now();
  try { await fn(cwd); results.push(`PASS ${name} (${Math.round((Date.now() - t0) / 1000)} s)`); }
  catch (e) { results.push(`FAIL ${name}: ${(e as Error).message}`); }
  console.log(results.at(-1));
}
console.log(`\n${results.join("\n")}`);
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
