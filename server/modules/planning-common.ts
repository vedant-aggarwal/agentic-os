// Shared by the planning modules (cabinet, weather, price): weeks, the pencilled-batch bookkeeping and
// the keep/remove step that records a decision the way proposals.ts does and then applies the kept rows.
import type { Database } from "bun:sqlite";
import { ApiError, istDate, type Store } from "../store";
import { openProposals } from "../proposals";
import type { AI } from "../ai";
import type { JobCtx } from "./types";

export const bad = (m: string) => new ApiError(400, m);
export const iso = () => new Date().toISOString();
export const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const plusDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const mondayOf = (date: string) => plusDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
export const weekdayOf = (date: string) => WD[new Date(`${date}T00:00:00Z`).getUTCDay()];
/** this | next | a date → the week's Monday. The default is the week ahead: next week once Sunday comes. */
export function weekFrom(input: unknown, today = istDate()): string {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s || s === "default") return weekdayOf(today) === "sun" ? plusDays(mondayOf(today), 7) : mondayOf(today);
  if (s === "this") return mondayOf(today);
  if (s === "next") return plusDays(mondayOf(today), 7);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))) return mondayOf(s);
  throw bad(`week is this, next or a date, not "${input}".`);
}
export const hhmmOk = (t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
export const atIso = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();
export const minOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** A batch of pencilled rows, like proposals.ts writes them. `replace` closes the open batch of that kind and date first. */
export function saveBatch(db: Database, o: { kind: string; date: string | null; summary: string; model: string; ms: number; replace?: boolean },
  rows: { kind: string; taskId: string | null; payload: unknown; reason: string }[]) {
  return db.transaction(() => {
    if (o.replace) db.query("UPDATE ai_batches SET status = 'replaced', decided_at = ? WHERE kind = ? AND date IS ? AND status = 'open'").run(iso(), o.kind, o.date);
    const b = db.query("INSERT INTO ai_batches (kind, date, summary, model, ms, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
      .get(o.kind, o.date, o.summary, o.model, o.ms, iso()) as any;
    const ins = db.prepare("INSERT INTO ai_proposals (batch_id, kind, task_id, payload, reason, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id");
    const pids = rows.map((r) => `p${(ins.get(b.id, r.kind, r.taskId ? Number(String(r.taskId).replace(/^t/, "")) : null, JSON.stringify(r.payload), r.reason, iso()) as any).id}`);
    return { batchId: `b${b.id}` as string, pids };
  })();
}
export function batchRows(db: Database, batchId: string | number) {
  const id = Number(String(batchId).replace(/^b/, ""));
  const b = db.query("SELECT * FROM ai_batches WHERE id = ?").get(id) as any;
  if (!b) return null;
  const rows = (db.query("SELECT * FROM ai_proposals WHERE batch_id = ? ORDER BY id").all(id) as any[]).map((p) => ({
    pid: `p${p.id}`, kind: p.kind, taskId: p.task_id ? `t${p.task_id}` : null, payload: JSON.parse(p.payload), reason: p.reason ?? "", status: p.status, decidedAt: p.decided_at ?? null }));
  return { batchId: `b${b.id}`, kind: b.kind, date: b.date, summary: b.summary, model: b.model, status: b.status, createdAt: b.created_at, rows };
}

export type Applied = { pid: string; taskId: string; made?: boolean; prev: Record<string, unknown> | null; title: string };
/** Apply one kept proposal through the store (the same writes the phone makes) and return what to undo. */
export function applyPayload(store: Store, pid: string, payload: any): Applied {
  const p = payload ?? {};
  if (p.taskId) {
    const cur = store.tasks().find((t: any) => t.id === p.taskId) ?? (() => { throw new ApiError(404, `Task ${p.taskId} is gone.`); })();
    const patch: Record<string, unknown> = {};
    if (p.date && hhmmOk(p.start) && hhmmOk(p.end)) { patch.scheduled = { start: atIso(p.date, p.start), end: atIso(p.date, p.end) }; patch.due = p.date; }
    else if ("scheduled" in p && p.scheduled === null) patch.scheduled = null;
    if ("due" in p && p.due !== undefined) patch.due = p.due;
    else if (p.date && !("scheduled" in patch)) patch.due = p.date;
    if (Number.isInteger(p.estimateMinutes)) patch.estimateMinutes = p.estimateMinutes;
    if (cur.status === "doing" && patch.scheduled === null) patch.status = "todo";
    const prev: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) prev[k] = k === "scheduled" ? cur.scheduled : k === "estimateMinutes" ? cur.estimateMinutes : (cur as any)[k] ?? null;
    store.patchTask(p.taskId, patch);
    return { pid, taskId: p.taskId, prev, title: cur.title };
  }
  const title = String(p.title ?? "").trim();
  if (!title) throw bad("A new block needs a title.");
  const scheduled = p.date && hhmmOk(p.start) && hhmmOk(p.end) ? { start: atIso(p.date, p.start), end: atIso(p.date, p.end) } : null;
  const t = store.createTask({ title, area: p.area ?? null, due: p.date ?? null, scheduled,
    estimateMinutes: scheduled ? Math.round((Date.parse(scheduled.end) - Date.parse(scheduled.start)) / 60000) : null, status: "todo" });
  return { pid, taskId: t.id, made: true, prev: null, title };
}
export function undoApplied(store: Store, list: Applied[]) {
  const undone: string[] = [];
  for (const a of list ?? []) {
    try {
      if (a.made) store.patchTask(a.taskId, { status: "dropped" });
      else if (a.prev) store.patchTask(a.taskId, a.prev);
      undone.push(a.pid);
    } catch (e) { console.error("[planning] undo", e); }
  }
  return undone;
}
/** Record kept/removed on the batch (proposals.decide), apply the kept ones, say what was applied so it can be undone. */
export function decideAndApply(ctx: Pick<JobCtx, "db" | "store" | "ai">, batchId: string, body: any) {
  const db = ctx.db();
  const before = batchRows(db, batchId);
  if (!before) throw new ApiError(404, "No such batch.");
  const kept = (Array.isArray(body?.kept) ? body.kept : []).map(String);
  const removed = (Array.isArray(body?.removed) ? body.removed : []).map(String);
  const open = new Set(before.rows.filter((r) => r.status === "open").map((r) => r.pid));
  const applied: Applied[] = [], failed: { pid: string; error: string }[] = [];
  for (const pid of kept) {
    const row = before.rows.find((r) => r.pid === pid);
    if (!row || !open.has(pid)) continue;
    // The task id lives in the task_id column (proposals.ts style); the payload may repeat it or not.
    try { applied.push(applyPayload(ctx.store, pid, { ...row.payload, taskId: row.payload?.taskId ?? row.taskId ?? undefined })); } catch (e) { failed.push({ pid, error: e instanceof Error ? e.message : String(e) }); }
  }
  const decided = openProposals(ctx.ai as AI).decide(ctx.store, batchId, { kept: applied.map((a) => a.pid), removed: removed.filter((p: string) => open.has(p)) });
  return { ...decided, applied, failed, batch: batchRows(db, batchId) };
}
/** Put decided rows back to open (after an undo). */
export function reopenProposals(db: Database, pids: string[]) {
  const q = db.prepare("UPDATE ai_proposals SET status = 'open', decided_at = NULL WHERE id = ?");
  for (const pid of pids) q.run(Number(String(pid).replace(/^p/, "")));
  for (const b of db.query("SELECT DISTINCT batch_id FROM ai_proposals WHERE status = 'open'").all() as any[])
    db.query("UPDATE ai_batches SET status = 'open', decided_at = NULL WHERE id = ? AND status = 'decided'").run(b.batch_id);
}
