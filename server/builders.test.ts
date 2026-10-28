// Builders: batching, busy Builders, cold Builders, reports, unreported requests. A fake host stands in for jobs.ts.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBuilders, type BuilderHost } from "./builders";

function setup(o: { batchMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "aos-builders-"));
  mkdirSync(join(dir, "jobs"), { recursive: true });
  const jobs = new Map<number, { busy: boolean; warm: boolean; gone: boolean; sent: string[] }>();
  let next = 100;
  const pushes: string[] = [];
  const host: BuilderHost = {
    async start(_key, _c, prompt) { const id = next++; jobs.set(id, { busy: true, warm: true, gone: false, sent: [prompt] }); return id; },
    async send(id, text) { const j = jobs.get(id)!; if (j.busy) throw new Error("busy"); j.busy = true; j.sent.push(text); },
    state: (id) => { const j = jobs.get(id); return j ? { busy: j.busy, warm: j.warm, gone: j.gone } : { busy: false, warm: false, gone: true }; },
    archive(id) { jobs.get(id)!.gone = true; },
    summary: () => "Shipped s1.",
    touched() {},
    push(title) { pushes.push(title); },
    projectExists: (slug) => slug === "aos",
  };
  const b = openBuilders({ dataDir: dir, batchMs: () => o.batchMs ?? 30, host: () => host });
  return { b, jobs, pushes, dir };
}
const req = (jobId: number, project: string | null = "aos") => ({ jobId, title: `job ${jobId}`, project, cwd: null, summary: `change ${jobId}`, deploy: true, notes: null });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("builders", () => {
  test("requests close together go to one new Builder in one message", async () => {
    const { b, jobs } = setup();
    const a = await b.request(req(1));
    const c = await b.request(req(2));
    expect(a.id).toBe("s1");
    expect(c.waiting).toBe(1);
    await wait(80);
    expect(jobs.size).toBe(1);
    const [, j] = [...jobs][0];
    expect(j.sent[0]).toContain("s1");
    expect(j.sent[0]).toContain("s2");
    expect(b.latest(1)?.state).toBe("sent");
  });

  test("a busy Builder gets the next batch when its turn ends; unreported requests fail", async () => {
    const { b, jobs, pushes } = setup();
    await b.request(req(1));
    await wait(80);
    const [id, j] = [...jobs][0];
    expect(b.report(id, { id: "s1", state: "committed", commit: "abc123" }).ok).toBe(true);
    expect(b.latest(1)?.state).toBe("committed");
    await b.request(req(2));
    await wait(80);
    expect(j.sent.length).toBe(1);             // still busy: s2 waits
    j.busy = false;
    b.turnEnded(id);                            // s1 was committed (not "sent"), so it stays
    expect(b.latest(1)?.state).toBe("committed");
    await wait(1100);
    expect(j.sent.length).toBe(2);
    expect(j.sent[1]).toContain("s2");
    j.busy = false;
    b.turnEnded(id);
    expect(b.latest(2)?.state).toBe("failed");
    expect(pushes.some((p) => p.startsWith("Ship failed"))).toBe(true);
  });

  test("a cold Builder is archived and a fresh one starts with the ledger", async () => {
    const { b, jobs } = setup();
    await b.request(req(1));
    await wait(80);
    const [id, j] = [...jobs][0];
    b.report(id, { id: "s1", state: "live", note: "deployed" });
    expect(b.latest(1)?.state).toBe("live");
    expect(b.latest(1)?.doneAt).toBeTruthy();
    j.busy = false;
    j.warm = false;
    await b.request(req(2));
    await wait(80);
    expect(j.gone).toBe(true);
    expect(jobs.size).toBe(2);
    const fresh = [...jobs.values()][1];
    expect(fresh.sent[0]).toContain("take over");
    expect(fresh.sent[0]).toContain("s1 j1");
    expect(fresh.sent[0]).toContain("s2");
  });

  test("reports are checked; jobs without a project use the global Builder", async () => {
    const { b, jobs } = setup();
    await b.request(req(1, null));
    await b.request(req(2, "nope"));
    await wait(80);
    expect(jobs.size).toBe(1);
    const [id] = [...jobs][0];
    expect(b.report(id, { id: "s9", state: "live" }).ok).toBe(false);
    expect(b.report(id, { id: "s1", state: "shipped" }).ok).toBe(false);
    expect(b.report(999, { id: "s1", state: "live" }).ok).toBe(false);
    expect(b.list(["aos"]).find((x) => x.key === "_global")?.ships.length).toBe(2);
  });

  test("a second call from the same job before sending replaces the first", async () => {
    const { b } = setup({ batchMs: 200 });
    await b.request(req(1));
    const again = await b.request({ ...req(1), summary: "better summary" });
    expect(again.id).toBe("s1");
    expect(b.list(["aos"]).find((x) => x.key === "aos")?.ships.length).toBe(1);
  });

  test("configure validates model and effort", () => {
    const { b } = setup();
    expect(b.configure("aos", { model: "opus", effort: "high" }).model).toBe("opus");
    expect(() => b.configure("aos", { effort: "ultra" })).toThrow();
    expect(() => b.configure("missing", { model: "opus" })).toThrow();
  });
});
