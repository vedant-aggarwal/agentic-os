// The sessions Live Activity and session alerts. Counts what the PC's agents are doing right now, split into
// working, needs you and done, from two places: jobs started in the app (server/jobs.ts) and Claude/Codex terminals
// (server/term.ts). The iPhone shows it in the Dynamic Island and on the lock screen (ios/App/AgenticWidgets/
// WorkActivity.swift); the PC pushes every change, so it stays right while the app is closed.
//   - Something starts working and the phone has no work activity: start one by push (iOS 17.2+, kind "workstart").
//   - Counts or the top sessions change: update it (kind "work"). More "needs you" = priority 10, else 5 (Apple's budget).
//   - Nothing working and nothing waiting: end it, showing the last state for 10 minutes.
//   - Swiped away while busy: left off until everything settles.
// alert() is how jobs and terminals notify: grouped per session (a "finished" replaces its "needs you"), Allow / Deny
// buttons for a plain permission, and the app icon's badge = how many sessions need him.
// Field names match WorkState in ios/App/Shared/Shared.swift.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Apns } from "./apns";

export type WorkItem = { id: string; title: string; state: "working" | "needs" | "done"; since: number; url: string; engine: string; detail: string | null };
export type WorkState = { working: number; needs: number; done: number; items: WorkItem[]; at: number };
/** One session as a source sees it. updatedAt: ISO; done items older than DONE_MS don't count. */
export type WorkSource = { id: string; title: string; status: string; updatedAt: string; url: string; engine: string; detail?: string | null };

const DONE_MS = 30 * 60_000;
const MAX_ITEMS = 4;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const ORDER = { needs: 0, working: 1, done: 2 } as const;

export function stateOf(all: WorkSource[], now = Date.now()): WorkState {
  const items: WorkItem[] = [];
  for (const s of all) {
    const state = s.status === "needs_input" ? "needs" : s.status === "running" || s.status === "starting" ? "working" : s.status === "idle" ? "done" : null;
    if (!state) continue;
    const at = Date.parse(s.updatedAt) || now;
    if (state === "done" && now - at > DONE_MS) continue;
    items.push({ id: s.id, title: clip(s.title || "Untitled", 48), state, since: Math.floor(at / 1000), url: s.url, engine: s.engine,
      detail: s.detail ? clip(s.detail.replace(/\s+/g, " ").trim(), 70) : null });
  }
  items.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.since - a.since);
  const n = (k: WorkItem["state"]) => items.filter((x) => x.state === k).length;
  return { working: n("working"), needs: n("needs"), done: n("done"), items: items.slice(0, MAX_ITEMS), at: Math.floor(now / 1000) };
}
const keyOf = (s: WorkState) => JSON.stringify([s.working, s.needs, s.done, s.items.map((x) => [x.id, x.state, x.title, x.detail])]);
const active = (s: WorkState) => s.working + s.needs > 0;

type Deps = {
  apns: Apns | null;
  dataDir: string;
  /** The owner, whose phone gets it; null = nobody signed in yet. */
  owner: () => any | null;
  sources: () => Promise<WorkSource[]>;
  tokens: (u: any, kind: "work" | "workstart") => string[];
  drop: (u: any, token: string) => void;
  pushAlert: (u: any, x: { title: string; body: string; data?: Record<string, unknown>; collapseId?: string; thread?: string; category?: string; badge?: number }) => Promise<void>;
  pushBadge: (u: any, badge: number) => Promise<void>;
};

export function openWorkActivity(d: Deps) {
  const file = join(d.dataDir, "work-activity.json");
  let mem = { sent: "", off: false, badge: -1, last: null as WorkState | null };
  try { if (existsSync(file)) mem = { ...mem, ...JSON.parse(readFileSync(file, "utf8")) }; } catch {}
  const save = () => { try { writeFileSync(file, JSON.stringify(mem)); } catch {} };
  let current: WorkState = { working: 0, needs: 0, done: 0, items: [], at: 0 };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null, again = false;

  const dropIfDead = (u: any, token: string, r: { status: number; reason?: string }) => {
    if (r.status === 410 || r.reason === "BadDeviceToken" || r.reason === "Unregistered" || r.reason === "ExpiredToken") d.drop(u, token);
    else if (r.status && r.status !== 200) console.error(`[work] push ${r.status} ${r.reason ?? ""}`);
  };

  async function compute() {
    current = stateOf(await d.sources().catch(() => []));
    return current;
  }

  async function sync() {
    const st = await compute();
    const u = d.owner();
    if (!u) return;
    // The icon's number follows "needs you" even with no Live Activity (alerts carry it too; this clears it).
    if (st.needs !== mem.badge) { const was = mem.badge; mem.badge = st.needs; save(); if (was !== -1 || st.needs) await d.pushBadge(u, st.needs).catch(() => {}); }
    if (!d.apns) return;
    const key = keyOf(st);
    if (key === mem.sent) return;
    const prev = mem.last;
    const ts = Math.floor(Date.now() / 1000);
    const live = d.tokens(u, "work");
    if (!active(st)) {
      mem.off = false;
      if (live.length) {
        const aps = { timestamp: ts, event: "end", "content-state": st, "dismissal-date": ts + 10 * 60 };
        for (const t of live) { dropIfDead(u, t, await d.apns.send(t, { aps }, "liveactivity", { priority: 10 })); d.drop(u, t); }
      }
      mem.sent = key; mem.last = st; save();
      return;
    }
    const louder = !prev || st.needs > prev.needs;
    const relevance = st.needs ? 100 : 60;
    if (live.length) {
      const aps = { timestamp: ts, event: "update", "content-state": st, "relevance-score": relevance, "stale-date": ts + 6 * 3600 };
      for (const t of live) dropIfDead(u, t, await d.apns.send(t, { aps }, "liveactivity", { priority: louder ? 10 : 5 }));
    } else if (!mem.off) {
      const start = d.tokens(u, "workstart");
      if (!start.length) return; // nothing to push to yet; the app starts it when opened
      const aps = { timestamp: ts, event: "start", "content-state": st, "attributes-type": "WorkActivityAttributes", attributes: { started: ts },
        "relevance-score": relevance, "stale-date": ts + 6 * 3600, alert: { title: "Agents working", body: summary(st) } };
      for (const t of start) dropIfDead(u, t, await d.apns.send(t, { aps }, "liveactivity", { priority: 10 }));
    }
    mem.sent = key; mem.last = st; save();
  }

  /** Recount soon. Calls inside the window fold into one; one more run follows a run that was busy. */
  function kick(delay = 800) {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (running) { again = true; return; }
      running = sync().catch((e) => console.error("[work] sync", e)).finally(() => { running = null; if (again) { again = false; kick(200); } });
    }, delay);
  }
  if (process.env.WORK_ACTIVITY !== "off") { setInterval(() => kick(0), 5000); kick(2000); }

  function summary(s: WorkState) {
    return [s.working && `${s.working} working`, s.needs && `${s.needs} need${s.needs === 1 ? "s" : ""} you`, s.done && `${s.done} done`].filter(Boolean).join(" · ") || "All quiet";
  }

  /** A session alert from jobs or terminals: data.event is needs | finished | failed; data.jobId or data.termId names it. */
  async function alert(title: string, body: string, data: Record<string, unknown> = {}) {
    const u = d.owner();
    if (!u) return;
    const sid = String(data.jobId ?? data.termId ?? "");
    await compute().catch(() => {});
    // An alert can land before the recount sees the new state; count this one as waiting if it is.
    const needs = Math.max(current.needs, data.event === "needs" ? 1 : 0);
    const category = data.event === "needs" && data.requestId ? "WORK_PERMISSION" : "WORK";
    await d.pushAlert(u, { title, body, data, thread: "work", category, collapseId: sid ? `work-${sid}` : undefined, badge: needs });
    mem.badge = needs; save();
    kick(300);
  }

  return {
    kick, alert,
    /** What the phone shows, for the app to start or refresh the activity itself while it's open. */
    state: async () => ({ ...(await compute()), summary: summary(current), push: !!d.apns }),
    /** The phone sent a new work token, or its activity ended: push the current state to it next. */
    deviceChanged: (b: any) => {
      if (b?.kind !== "work") return;
      if (b.end && b.dismissed && active(current)) { mem.off = true; save(); }
      if (!b.end) { mem.sent = ""; mem.off = false; save(); }
      kick(300);
    },
  };
}
export type WorkActivity = ReturnType<typeof openWorkActivity>;
