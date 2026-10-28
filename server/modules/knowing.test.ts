// The knowing modules (doctrine, runbooks, bounty) against a fake module context on a throwaway DB.
// The CLI is real (AGENTOS_BIN, else the sibling agentos-mod-knowing build); Claude is a stub that
// records every call; the agent hand-off runs as a dry run (MOD_DRY_RUN=1), so the live runner on 8081
// is never touched. Run: MOD_DRY_RUN=1 AGENTOS_BIN=<exe with the knowing modules> bun test server
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModCtx, Module } from "./types";
import { doctrine } from "./doctrine";
import { runbookBrief, runbooks } from "./runbooks";
import { bounty, payrollRows, underperformers } from "./bounty";
import { isoWeek, istDate, workspaceFor } from "./knowing-shared";

process.env.MOD_DRY_RUN = "1";
const dir = mkdtempSync(join(tmpdir(), "aos-knowing-"));
const dbPath = join(dir, "agentos.db");
const dataDir = join(dir, "data");
const sibling = join(import.meta.dir, "..", "..", "..", "agentos-mod-knowing", "dist", "agentos.exe");
const BIN = process.env.AGENTOS_BIN || (existsSync(sibling) ? sibling : "agentos");
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* a leftover temp dir is harmless */ } });

function agentos(args: string[]) {
  const r = Bun.spawnSync([BIN, ...args, "--json"], { env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") } });
  const text = r.stdout.toString().trim();
  if (r.exitCode !== 0) throw Object.assign(new Error(text || r.stderr.toString()), { status: r.exitCode === 2 ? 400 : 502 });
  return text ? JSON.parse(text) : null;
}
const hasKnowing = (() => { try { return (agentos(["mods"]).modules as any[]).some((m) => m.name === "doctrine"); } catch { return false; } })();
const withDb = <T>(f: (d: Database) => T): T => { const d = new Database(dbPath); try { return f(d); } finally { d.close(); } };
const NOW = new Date();
const daysAgo = (n: number, hhmmUtc = "00:30") => `${new Date(NOW.getTime() - n * 864e5).toISOString().slice(0, 10)}T${hhmmUtc}:00.000Z`;

const calls: any[] = [];
let reply: any = {};
let agents: Record<string, any> = {};
const ai = {
  claude: async (o: any) => { calls.push(o); return { out: typeof reply === "function" ? reply(o) : reply, ms: 1, model: o.model }; },
  agentsFor: async () => agents,
  give: async () => { throw new Error("the live give must never run in tests"); },
};
type Ctx = ModCtx & { _close: () => void };
function ctxFor(path: string, method = "GET", body?: any, owner = true): Ctx {
  let dbh: Database | null = null;
  return {
    req: new Request(`http://local/api/v1/mod/x${path}`, { method }), url: new URL(`http://local/api/v1/mod/x${path}`), method, path,
    user: { id: 1, email: "owner@test", name: "T", role: "owner", agentos_db: dbPath } as any, owner, store: {} as any,
    dbPath, db: () => (dbh ??= new Database(dbPath)), contentDbPath: join(dir, "content.db"),
    body: async () => body ?? {}, json: (d, s = 200) => Response.json(d, { status: s }), fail: (s, m) => Response.json({ error: m }, { status: s }),
    ai: ai as any, codex: async () => ({ out: null, text: "", ms: 0 }), agentos: async (a) => agentos(a), push: async () => {}, wyn: null,
    conf: (_k, d) => d, dataDir, log: () => {}, _close: () => { dbh?.close(); dbh = null; },
  };
}
async function call(mod: Module, method: string, path: string, body?: any, owner = true) {
  const ctx = ctxFor(path, method, body, owner);
  try {
    const r = await mod.handle(ctx);
    return r ? { status: r.status, data: await r.json() as any } : { status: 404, data: null };
  } finally { ctx._close(); }
}
const dryRuns = () => { try { return readFileSync(join(dataDir, "mod", "dry-run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { return []; } };

describe("knowing-shared", () => {
  test("workspaceFor and isoWeek", () => {
    expect(workspaceFor("northwind")).toBe("northwind");
    expect(workspaceFor("morgan-co")).toBe("corner-market");
    expect(workspaceFor("projects", "Agentic OS: ship the build")).toBe("agentic-os");
    expect(workspaceFor(null)).toBe("none");
    expect(isoWeek("2026-10-18")).toBe("2026-W42");
  });
});

describe.skipIf(!hasKnowing)("knowing modules on the CLI build", () => {
  beforeAll(() => { mkdirSync(dataDir, { recursive: true }); agentos(["mods"]); });

  test("doctrine: observe stores Sonnet's sentence with the rows, once per week; accept and retire keep ai.plan_rules in step", async () => {
    withDb((d) => {
      const ins = d.query("INSERT INTO tasks (title, status, start_at, end_at, done_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (let i = 1; i <= 5; i++) ins.run(`Morning block ${i}`, i === 5 ? "done" : "todo", daysAgo(i), daysAgo(i, "01:00"), i === 5 ? daysAgo(i, "01:10") : null, daysAgo(i + 1), daysAgo(i));
    });
    reply = { observation: "06:00 blocks got skipped four times in five.", rule: "Plan the first block of the day at 07:00, never 06:00." };
    const r = await call(doctrine, "POST", "/observe", {});
    expect(r.status).toBe(201);
    expect(r.data.observation).toMatchObject({ id: 1, week: isoWeek(istDate()), pattern: "skip_by_hour:06", status: "open", text: reply.observation, rule: reply.rule });
    expect(r.data.observation.evidence).toHaveLength(5);
    expect(r.data.current.id).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("sonnet");
    expect(JSON.parse(calls[0].prompt)).toMatchObject({ pattern: "skip_by_hour:06" });
    expect(JSON.parse(calls[0].prompt).rows).toHaveLength(5);
    const again = await call(doctrine, "POST", "/observe", {});
    expect(again.status).toBe(200);
    expect(again.data.reason).toBe("already observed this week");
    expect(calls).toHaveLength(1);
    expect((await call(doctrine, "GET", "/state")).data).toMatchObject({ current: { id: 1 }, rules: [], plan_rules: null });
    expect((await call(doctrine, "POST", "/observations/1/accept", {}, false)).status).toBe(403);

    const acc = await call(doctrine, "POST", "/observations/1/accept");
    expect(acc.status).toBe(200);
    expect(acc.data.rules[0]).toMatchObject({ id: 1, active: true, text: reply.rule, observation: 1 });
    expect(acc.data.current).toBeNull();
    expect(acc.data.plan_rules.startsWith("One in-person human rep a day")).toBe(true);   // the server default survives the first accept
    expect(acc.data.plan_rules.endsWith(`\n${reply.rule}`)).toBe(true);
    expect(agentos(["ai", "rules"]).rules).toBe(acc.data.plan_rules);
    const ret = await call(doctrine, "POST", "/rules/1/retire");
    expect(ret.data.rules[0].active).toBe(false);
    expect(ret.data.plan_rules).toBe("One in-person human rep a day: buying chai and asking the vendor one thing counts. Client work comes before other desk work.");
    expect((await call(doctrine, "GET", "/nothing")).status).toBe(404);
  }, 120_000);

  test("runbooks: scan assembles steps with Haiku once, ready/edit through PATCH, run hands the runbook over as a dry run", async () => {
    withDb((d) => {
      const ins = d.query("INSERT INTO tasks (title, status, notes, evidence, done_at, created_at, updated_at) VALUES (?, 'done', ?, ?, ?, ?, ?)");
      ins.run("Ship iOS build 3", "use the 2nd GitHub account", "https://github.com/x/actions/runs/1 (build 3 in TestFlight)", daysAgo(8, "10:00"), daysAgo(8), daysAgo(8));
      ins.run("Ship iOS build 4", null, "git push ios-build HEAD:main; https://github.com/x/actions/runs/2; signing failed once, fixed with set-ios-secrets.ps1", daysAgo(2, "10:00"), daysAgo(2), daysAgo(2));
    });
    reply = { steps: [
      { text: "Push the branch to the second GitHub account", command: "git push ios-build HEAD:main", ok: true, task: "t7" },
      { text: "Wait for the Actions run and the TestFlight upload", command: "https://github.com/x/actions", ok: false, note: "signing failed once; set-ios-secrets.ps1 fixed it" },
    ] };
    const before = calls.length;
    const sc = await call(runbooks, "POST", "/scan");
    expect(sc.data).toMatchObject({ ok: true, count: 1, assembled: 1, errors: [] });
    expect(calls).toHaveLength(before + 1);
    expect(calls.at(-1).model).toBe("haiku");
    expect(JSON.parse(calls.at(-1).prompt).passes).toHaveLength(2);
    const book = (await call(runbooks, "GET", "/books/1")).data;
    expect(book.book).toMatchObject({ id: 1, status: "draft", times_done: 2, steps: 2, needs_assembly: false });
    expect(book.steps[0]).toMatchObject({ n: 1, command: "git push ios-build HEAD:main", task: "t7", ok: true });
    expect(book.steps[1]).toMatchObject({ n: 2, ok: false, note: "signing failed once; set-ios-secrets.ps1 fixed it" });
    expect((await call(runbooks, "POST", "/scan")).data.assembled).toBe(0);   // nothing new to assemble
    expect(calls).toHaveLength(before + 1);
    expect(runbookBrief(book)).toContain("2. Wait for the Actions run and the TestFlight upload  [failed before]");
    expect(runbookBrief(book)).toContain("   command: git push ios-build HEAD:main");

    expect((await call(runbooks, "POST", "/books/1/run", {})).status).toBe(400);   // draft: not runnable
    const edited = await call(runbooks, "PATCH", "/books/1", { status: "ready", steps: [...book.steps, { text: "Add the tester in App Store Connect", ok: true }] });
    expect(edited.data.book.status).toBe("ready");
    expect(edited.data.steps).toHaveLength(3);
    expect((await call(runbooks, "PATCH", "/books/1", { status: "odd" })).status).toBe(400);

    const run = await call(runbooks, "POST", "/books/1/run", {});
    expect(run.status).toBe(201);
    expect(run.data).toMatchObject({ ok: true, dryRun: true, task: { title: "Run: Ship iOS build 4", status: "todo" }, agent: { dryRun: true, state: "queued", mode: "edit", check: true } });
    const rec = dryRuns().at(-1);
    expect(rec).toMatchObject({ taskId: run.data.task.id, mode: "edit", confirm: true, workspace: "none" });
    expect(rec.brief).toContain("1. Push the branch to the second GitHub account");
    expect(rec.brief).toContain("command: git push ios-build HEAD:main");
    expect(withDb((d) => d.query("SELECT * FROM runbooks_runs").all())).toMatchObject([{ book_id: 1, task_id: Number(run.data.task.id.slice(1)), job_id: null, finished_at: null }]);
    expect((await call(runbooks, "GET", "/books")).data.books[0]).toMatchObject({ id: 1, status: "ready" });

    agentos(["add", "Ship iOS build 5", "--due", "today"]);
    const today = (await call(runbooks, "GET", "/today")).data;
    expect(today.matches.map((m: any) => m.title)).toEqual(["Ship iOS build 5"]);
    expect(today.matches[0].book).toBe(1);
  }, 120_000);

  test("bounty: rate and scan price the board, take hands an Automate task over as a dry run, payroll writes rows and retire proposals", async () => {
    withDb((d) => d.query("INSERT INTO tasks (title, status, repeat, estimate_minutes, due, created_at, updated_at) VALUES ('Post the daily reel', 'todo', '1d', 20, ?, ?, ?)").run(istDate(), daysAgo(1), daysAgo(1)));
    expect((await call(bounty, "PUT", "/rate", { rate: "x" })).status).toBe(400);
    const b = (await call(bounty, "PUT", "/rate", { rate: 600 })).data;
    expect(b.rate).toBe(600);
    expect(b.items[0]).toMatchObject({ id: 1, title: "Post the daily reel", status: "open", minutes_per_week: 140, payoff_per_month: 6020 });
    expect((await call(bounty, "GET", "/board")).data.dryRun).toBe(true);

    const take = await call(bounty, "POST", "/items/1/take", {});
    expect(take.status).toBe(201);
    expect(take.data).toMatchObject({ ok: true, dryRun: true, task: { title: "Automate: Post the daily reel" } });
    expect(take.data.items[0]).toMatchObject({ id: 1, status: "taken", task: take.data.task.id });
    expect(dryRuns().at(-1).brief).toContain("one-command job");
    expect((await call(bounty, "POST", "/items/1/take", {})).status).toBe(400);
    expect((await call(bounty, "POST", "/items/9/take", {})).status).toBe(404);

    // Payroll input: Plan my day ran twice this month and you kept 1 of 10 picks; one agent job finished; one module job ran.
    const stamp = NOW.toISOString();
    withDb((d) => {
      const bid = (d.query("INSERT INTO ai_batches (kind, date, summary, model, ms, status, created_at) VALUES ('plan', ?, 'day', 'Sonnet', 9000, 'decided', ?) RETURNING id").get(istDate(), stamp) as any).id;
      d.query("INSERT INTO ai_batches (kind, date, summary, model, ms, status, created_at) VALUES ('plan', ?, 'day', 'Sonnet', 6000, 'open', ?)").run(istDate(), stamp);
      const ins = d.query("INSERT INTO ai_proposals (batch_id, kind, task_id, payload, reason, status, created_at, decided_at) VALUES (?, 'place', NULL, '{}', '', ?, ?, ?)");
      for (let i = 0; i < 10; i++) ins.run(bid, i === 0 ? "kept" : "removed", stamp, stamp);
    });
    agents = { t2: { state: "done", startedAt: stamp, evidence: "agentic-os/.operator-data/agent-tasks/no-such-job" } };
    mkdirSync(join(dataDir, "mod"), { recursive: true });
    writeFileSync(join(dataDir, "mod", "jobs.json"), JSON.stringify({ "ping:ping-heartbeat": { at: stamp, date: istDate(), ok: true, ms: 1500 } }));
    const p = await call(bounty, "POST", "/payroll/run", {});
    expect(p.status).toBe(200);
    expect(p.data.period).toBe(istDate().slice(0, 7));
    const row = (name: string) => p.data.rows.find((r: any) => r.runner === name);
    expect(row("ai:plan")).toMatchObject({ runs: 2, kept: 1, removed: 9, quota_estimate: 15, value_estimate: 30 });
    expect(row("agent:claude")).toMatchObject({ runs: 1, tasks_done: 1, evidence_verified: 0, value_estimate: 300 });
    expect(row("job:ping:ping-heartbeat")).toMatchObject({ runs: 1, quota_estimate: 2, note: "last run only" });
    expect(row("job:doctrine:doctrine-weekly")).toMatchObject({ runs: 1, kept: 1, removed: 0 });
    expect(row("job:runbooks:runbooks-scan")).toMatchObject({ runs: 1, tasks_done: 0 });
    expect(row("job:bounty:bounty-board")).toMatchObject({ kept: 1 });
    expect(p.data.new_proposals).toBe(1);
    expect(p.data.proposals).toHaveLength(1);
    const view = (await call(bounty, "GET", "/payroll")).data;
    expect(view.rows.find((r: any) => r.runner === "ai:plan")).toMatchObject({ kept_rate: 10, period: p.data.period });
    expect(view.proposals[0]).toMatchObject({ status: "open", reason: "retire this job?", runner: "ai:plan", kept: 1, removed: 9, keptRate: 10 });
    expect(agentos(["ai"]).batches[0]).toMatchObject({ kind: "bounty", open: 1 });
    // Running payroll again does not duplicate the open proposal.
    expect((await call(bounty, "POST", "/payroll/run", {})).data.new_proposals).toBe(0);
    const keep = await call(bounty, "POST", `/payroll/proposals/${view.proposals[0].id}/keep`, {});
    expect(keep.data).toMatchObject({ ok: true, decision: "retired", runner: "ai:plan", retired: ["ai:plan"] });
    expect(withDb((d) => (d.query("SELECT value FROM settings WHERE key = 'bounty.retired'").get() as any).value)).toBe('["ai:plan"]');
    expect(agentos(["ai"]).batches[0]).toMatchObject({ kind: "bounty", status: "decided", kept: 1 });
    expect((await call(bounty, "POST", `/payroll/proposals/${view.proposals[0].id}/keep`, {})).status).toBe(400);
    // Pure helpers on the same DB.
    withDb((d) => {
      expect(underperformers(d, daysAgo(30))).toEqual([{ runner: "ai:plan", kept: 1, removed: 9, rate: 0.1 }]);
      expect(payrollRows(d, {}, {}, daysAgo(1), daysAgo(-1), null).find((r) => r.runner === "ai:plan")?.value_estimate).toBeNull();
    });
  }, 120_000);
});
