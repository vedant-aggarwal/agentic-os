import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkActivity, stateOf, type WorkSource } from "./work-activity";

const now = Date.parse("2026-10-21T10:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const src = (id: string, status: string, min = 1, detail: string | null = null): WorkSource =>
  ({ id, title: `Session ${id}`, status, updatedAt: ago(min), url: `agenticos://job/${id}`, engine: "claude", detail });

describe("stateOf", () => {
  test("splits working, needs you and done; needs first", () => {
    const s = stateOf([src("j1", "running", 5), src("j2", "running", 2), src("j3", "needs_input", 9, "Run  bun test?"), src("t1", "starting"), src("j4", "idle", 3), src("j5", "stopped")], now);
    expect([s.working, s.needs, s.done]).toEqual([3, 1, 1]);
    expect(s.items.map((x) => x.id)).toEqual(["j3", "t1", "j2", "j1"]);
    expect(s.items[0].detail).toBe("Run bun test?");
  });
  test("old done sessions drop out; long titles are clipped", () => {
    const s = stateOf([{ ...src("j1", "idle", 45) }, { ...src("j2", "running"), title: "x".repeat(80) }], now);
    expect(s.done).toBe(0);
    expect(s.items[0].title.length).toBe(48);
  });
});

describe("pushes", () => {
  function rig(sessions: WorkSource[], tokens: Record<string, string[]>) {
    const sent: any[] = [], badges: number[] = [], alerts: any[] = [];
    const apns = { send: async (token: string, payload: any, kind: string, opts: any) => { sent.push({ token, payload, kind, opts }); return { status: 200 }; } };
    process.env.WORK_ACTIVITY = "off";
    const w = openWorkActivity({
      apns: apns as any, dataDir: mkdtempSync(join(tmpdir(), "work-")), owner: () => ({ id: 1 }), sources: async () => sessions,
      tokens: (_u, k) => tokens[k] ?? [], drop: (_u, t) => { for (const k in tokens) tokens[k] = tokens[k].filter((x) => x !== t); },
      pushAlert: async (_u, x) => { alerts.push(x); }, pushBadge: async (_u, n) => { badges.push(n); },
    });
    return { w, sent, badges, alerts, sessions };
  }
  const settle = () => new Promise((r) => setTimeout(r, 30));

  test("starts by push, then updates, then ends", async () => {
    const r = rig([{ ...src("j1", "running"), updatedAt: new Date().toISOString() }], { workstart: ["aa"] });
    r.w.kick(0); await settle();
    expect(r.sent[0].payload.aps.event).toBe("start");
    expect(r.sent[0].payload.aps["attributes-type"]).toBe("WorkActivityAttributes");
    // The phone now has a running activity.
    r.w.deviceChanged({ kind: "work", token: "bb" });
    const tokens = { work: ["bb"] };
    const r2 = rig([{ ...src("j1", "needs_input"), updatedAt: new Date().toISOString() }], tokens);
    r2.w.kick(0); await settle();
    expect(r2.sent[0].payload.aps.event).toBe("update");
    expect(r2.sent[0].opts.priority).toBe(10);
    expect(r2.badges).toEqual([1]);
    r2.sessions.length = 0;
    r2.w.kick(0); await settle();
    expect(r2.sent.at(-1).payload.aps.event).toBe("end");
    expect(tokens.work).toEqual([]);
    expect(r2.badges).toEqual([1, 0]);
  });

  test("alerts group per session and carry the badge and buttons", async () => {
    const r = rig([{ ...src("j7", "needs_input"), updatedAt: new Date().toISOString() }], {});
    await r.w.alert("Job needs you: x", "Run it?", { kind: "job", event: "needs", jobId: "j7", requestId: "p_1", allow: "allow", deny: "deny" });
    expect(r.alerts[0]).toMatchObject({ thread: "work", category: "WORK_PERMISSION", collapseId: "work-j7", badge: 1 });
    await r.w.alert("Job finished: x", "Done", { kind: "job", event: "finished", jobId: "j7" });
    expect(r.alerts[1]).toMatchObject({ category: "WORK", collapseId: "work-j7" });
  });
});
