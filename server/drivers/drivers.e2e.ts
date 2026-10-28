// End-to-end checks for job drivers against a running TEST server (never the live one): real Claude / Codex turns
// in scratch folders. Same list for every engine x driver:
//   edit       a turn writes a file; events stream; the turn's diff and "changes" event show it
//   follow-up  a second turn; its own diff; revert turn 2 then turn 1 puts the folder back
//   ask        ask mode stops on a permission; approving it lets the edit through
//   plan       (native) plan mode returns a plan first; approving it runs it
//   cancel     interrupting a long command ends the turn
// Run:  bun server/drivers/drivers.e2e.ts --port 8221 --data <DATA_DIR> [--engine claude|codex] [--driver native|acp] [--only edit,ask]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k: string, d = "") => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const PORT = arg("port", "8221");
if (["8090", "8093", "8096"].includes(PORT)) throw new Error("Not against the live server.");
const TOKEN = readFileSync(join(arg("data"), "agent.token"), "utf8").trim();
const engines = (arg("engine") ? [arg("engine")] : ["claude", "codex"]) as ("claude" | "codex")[];
const drivers = (arg("driver") ? [arg("driver")] : ["native", "acp"]) as ("native" | "acp")[];
const only = arg("only") ? arg("only").split(",") : null;
const ROOT = join(tmpdir(), "aos-driver-e2e", String(Date.now()));

async function api(path: string, json?: unknown) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/v1${path}`, {
    method: json === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, ...(json === undefined ? {} : { "Content-Type": "application/json" }) },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${r.status} ${d.error ?? ""}`);
  return d;
}
async function waitFor(id: string, ok: (j: any, evs: any[]) => boolean, ms = 240_000) {
  const t0 = Date.now();
  for (;;) {
    const { job, events } = await api(`/jobs/${id}`);
    if (ok(job, events)) return { job, events };
    if (job.status === "failed") throw new Error(`job failed: ${job.error}`);
    if (Date.now() - t0 > ms) throw new Error(`timed out; status ${job.status}`);
    await Bun.sleep(1500);
  }
}
const settled = (j: any) => j.status === "idle" || j.status === "stopped";
function scratch(name: string) {
  const d = join(ROOT, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "README.md"), "# scratch\n");
  return d;
}
const check = (c: unknown, msg: string) => { if (!c) throw new Error(msg); };
const ONE = "Keep it short: do only what is asked, then reply in one line.";

const tests: Record<string, (engine: "claude" | "codex", driver: "native" | "acp", cwd: string) => Promise<string | void>> = {
  async edit(engine, driver, cwd) {
    const { job } = await api("/jobs", { engine, driver, mode: "auto", cwd, context: `Create a file hello.txt in the working folder containing exactly the word hi. ${ONE}` });
    const { job: j, events } = await waitFor(job.id, settled);
    check(readFileSync(join(cwd, "hello.txt"), "utf8").trim() === "hi", "hello.txt missing or wrong");
    check(events.some((e: any) => e.type === "assistant" && e.text?.trim()), "no assistant text");
    check(events.some((e: any) => e.type === "tool"), "no tool event");
    const ch = events.find((e: any) => e.type === "changes");
    check(ch?.changes?.some((c: any) => c.path === "hello.txt" && c.status === "added"), "no changes event for hello.txt");
    const d = await api(`/jobs/${job.id}/diff?turn=1`);
    check(d.files.some((f: any) => f.path === "hello.txt") && /\+hi/.test(d.patch), "turn 1 diff doesn't show hello.txt");
    if (driver === "native") check(j.usage?.input > 0, "no token usage");
    return job.id;
  },
  async followup(engine, driver, cwd) {
    const id = (await tests.edit(engine, driver, cwd)) as string;
    await api(`/jobs/${id}/prompt`, { text: `Append a second line containing exactly bye to hello.txt. ${ONE}` });
    await waitFor(id, (j, evs) => settled(j) && evs.filter((e: any) => e.type === "user").length >= 2);
    check(/hi\r?\nbye/.test(readFileSync(join(cwd, "hello.txt"), "utf8")), "bye not appended");
    const d = await api(`/jobs/${id}/diff?turn=2`);
    check(d.files.length === 1 && d.files[0].path === "hello.txt" && /\+bye/.test(d.patch), "turn 2 diff wrong");
    await api(`/jobs/${id}/revert`, { turn: 2 });
    check(readFileSync(join(cwd, "hello.txt"), "utf8").trim() === "hi", "revert 2 didn't restore");
    await api(`/jobs/${id}/revert`, { turn: 1 });
    check(!existsSync(join(cwd, "hello.txt")), "revert 1 didn't remove hello.txt");
    check(existsSync(join(cwd, "README.md")), "revert removed a file it shouldn't");
  },
  async ask(engine, driver, cwd) {
    const { job } = await api("/jobs", { engine, driver, mode: "ask", cwd, context: `Create a file ask.txt in the working folder containing exactly x. ${ONE}` });
    const { job: j } = await waitFor(job.id, (j) => j.status === "needs_input" || settled(j));
    check(j.status === "needs_input" && j.pending, `expected a permission request, got ${j.status}`);
    const allow = j.pending.options.find((o: any) => o.kind === "allow_once") ?? j.pending.options[0];
    await api(`/jobs/${job.id}/permission`, { requestId: j.pending.requestId, optionId: allow.optionId });
    // Some engines ask more than once (e.g. a sandbox retry); approve until it settles.
    await waitFor(job.id, (jj) => {
      if (jj.status === "needs_input" && jj.pending) {
        const a = jj.pending.options.find((o: any) => o.kind === "allow_once") ?? jj.pending.options[0];
        api(`/jobs/${job.id}/permission`, { requestId: jj.pending.requestId, optionId: a.optionId }).catch(() => {});
      }
      return settled(jj);
    });
    check(existsSync(join(cwd, "ask.txt")), "ask.txt not created after approving");
  },
  async plan(engine, driver, cwd) {
    if (driver !== "native") return;
    const { job } = await api("/jobs", { engine, driver, mode: "auto", plan: true, cwd,
      context: "Add a file NOTES.md with the heading '# Notes' and one bullet point. Plan it first; it's a tiny change, so keep the plan to two lines." });
    const { job: j, events } = await waitFor(job.id, (j) => j.status === "needs_input" || settled(j));
    check(events.some((e: any) => e.type === "plan" && e.text?.trim()), "no written plan");
    check(!existsSync(join(cwd, "NOTES.md")), "wrote the file while planning");
    if (j.status === "needs_input" && j.pending?.kind === "plan") {
      await api(`/jobs/${job.id}/permission`, { requestId: j.pending.requestId, optionId: "approve" });
    } else {
      await api(`/jobs/${job.id}/prompt`, { text: "The plan is approved. Implement it now.", plan: false });
    }
    await waitFor(job.id, (jj) => settled(jj) && existsSync(join(cwd, "NOTES.md")));
    const after = (await api(`/jobs/${job.id}`)).job;
    check(after.plan === false, "plan mode still on after approval");
  },
  async cancel(engine, driver, cwd) {
    const { job } = await api("/jobs", { engine, driver, mode: "auto", cwd, context: "Run this exact shell command and wait for it to finish: ping -n 60 127.0.0.1. Then say done." });
    await waitFor(job.id, (j, evs) => evs.some((e: any) => e.type === "tool"));
    await Bun.sleep(3000);
    const t0 = Date.now();
    await api(`/jobs/${job.id}/cancel`, {});
    await waitFor(job.id, (j) => settled(j), 30_000);
    check(Date.now() - t0 < 25_000, "cancel took too long");
  },
};

const results: { name: string; ok: boolean; ms: number; err?: string }[] = [];
await Promise.all(engines.flatMap((engine) => drivers.map(async (driver) => {
  for (const name of Object.keys(tests).filter((n) => (!only || only.includes(n)))) {
    if (name === "plan" && driver !== "native") continue;
    const label = `${engine}/${driver}/${name}`;
    const t0 = Date.now();
    try {
      await tests[name](engine, driver, scratch(`${engine}-${driver}-${name}`));
      results.push({ name: label, ok: true, ms: Date.now() - t0 });
      console.log(`PASS ${label} (${Math.round((Date.now() - t0) / 1000)}s)`);
    } catch (e) {
      results.push({ name: label, ok: false, ms: Date.now() - t0, err: String((e as Error).message) });
      console.log(`FAIL ${label}: ${(e as Error).message}`);
    }
  }
})));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
