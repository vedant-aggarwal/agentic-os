// Wyn's memory, three layers in her own SQLite file:
// - long-term: durable facts about the person (preferences, people, projects, goals, habits, decisions, health),
//   each with a kind and an importance from 1 to 5. Ids look like L12.
// - short-term: what's going on right now and open loops to follow up, each with an expiry. Ids look like S4.
// - episodes: one short summary per day, written by the nightly consolidation.
// Every turn sees the important long-term memories, the ones that match what's being talked about, all live
// short-term notes and the last few days. Consolidation (wyn.ts) promotes, merges and expires once a day.
import type { Database } from "bun:sqlite";

type Db = Database;
const iso = () => new Date().toISOString();
/** India time for anything Wyn reads: "2026-10-20 21:45". Stored times are UTC; she must never see raw UTC. */
export const ist = (isoStr: unknown) => {
  const t = Date.parse(String(isoStr ?? ""));
  return Number.isFinite(t) ? new Date(t + 330 * 60000).toISOString().slice(0, 16).replace("T", " ") : "";
};
// lesson: what the weekly self-review learned about how to work with them (mistakes not to repeat).
export const LONG_KINDS = ["fact", "preference", "person", "project", "goal", "habit", "decision", "health", "lesson", "other"];
export const SHORT_KINDS = ["now", "followup", "context"];

export function migrateMemory(db: Db) {
  const cols = new Set((db.query("PRAGMA table_info(memories)").all() as any[]).map((c) => c.name));
  const add = (name: string, def: string) => { if (!cols.has(name)) db.exec(`ALTER TABLE memories ADD COLUMN ${name} ${def}`); };
  add("kind", "TEXT NOT NULL DEFAULT 'fact'");
  add("importance", "INTEGER NOT NULL DEFAULT 3");
  add("updated_at", "TEXT");
  add("last_used", "TEXT");
  add("source", "TEXT");
  add("status", "TEXT NOT NULL DEFAULT 'active'");
  db.exec(`CREATE TABLE IF NOT EXISTS short_term (id INTEGER PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'now', created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', source TEXT);
    CREATE TABLE IF NOT EXISTS episodes (date TEXT PRIMARY KEY, summary TEXT NOT NULL, at TEXT NOT NULL);`);
}

const STOP = new Set(("the and for that this with you your are was were have has had not but can will just about what when where how who " +
  "from they them then than there their into out our its it's i'm im me my mine a an to of in on at is be do does did so if or as by up " +
  "hai hain ka ki ke ko se mein me main bhi aur kya nahi toh tha thi").split(" "));
const words = (t: string) => [...new Set(String(t).toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]/g, " ").split(/\s+/)
  .filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, "")))];

/** Live short-term notes; expired ones are closed on the way. */
export function shortTerm(db: Db) {
  db.query("UPDATE short_term SET status = 'expired' WHERE status = 'active' AND expires_at < ?").run(iso());
  return db.query("SELECT id, text, kind, created_at, expires_at FROM short_term WHERE status = 'active' ORDER BY id").all() as any[];
}

/** Long-term memories ranked for a query: word overlap first, then importance, then how recently it was touched. */
export function rankLong(db: Db, query: string, limit = 40) {
  const rows = db.query("SELECT id, text, kind, importance, at, updated_at, last_used FROM memories WHERE status = 'active'").all() as any[];
  const q = new Set(words(query));
  const now = Date.now();
  const scored = rows.map((r) => {
    const w = words(r.text);
    const hits = q.size ? w.filter((x) => q.has(x)).length : 0;
    const age = (now - Date.parse(r.updated_at ?? r.at)) / 864e5;
    return { r, hits, score: hits * 4 + Number(r.importance) * 1.5 + (age < 14 ? 1 : 0) };
  });
  const keep = new Map<number, any>();
  // Always: the important ones. Then: what matches. Then: the rest by score.
  for (const s of scored.filter((x) => x.r.importance >= 4).sort((a, b) => b.score - a.score).slice(0, 25)) keep.set(s.r.id, s.r);
  for (const s of scored.filter((x) => x.hits > 0).sort((a, b) => b.score - a.score).slice(0, 20)) keep.set(s.r.id, s.r);
  for (const s of scored.sort((a, b) => b.score - a.score)) { if (keep.size >= limit) break; keep.set(s.r.id, s.r); }
  const out = [...keep.values()];
  if (out.length) db.query(`UPDATE memories SET last_used = ? WHERE id IN (${out.map(() => "?").join(",")})`).run(iso(), ...out.map((r) => r.id));
  return out;
}

/** The memory part of every prompt. */
export function memoryContext(db: Db, query: string, firstName: string) {
  const long = rankLong(db, query);
  const byKind = new Map<string, any[]>();
  for (const m of long) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m]);
  const longText = [...byKind.entries()].map(([k, ms]) => `${k}:\n${ms.map((m) => `- (L${m.id}${m.importance >= 4 ? ", important" : ""}) ${m.text}`).join("\n")}`).join("\n") || "- nothing yet";
  const st = shortTerm(db);
  const shortText = st.map((s) => `- (S${s.id}, ${s.kind}, until ${ist(s.expires_at).slice(0, 10)}) ${s.text}`).join("\n") || "- nothing right now";
  const eps = (db.query("SELECT date, summary FROM episodes ORDER BY date DESC LIMIT 3").all() as any[]).reverse()
    .map((e) => `- ${e.date}: ${e.summary}`).join("\n");
  const total = (db.query("SELECT count(*) c FROM memories WHERE status = 'active'").get() as any).c;
  return `Long-term memory about ${firstName} (${long.length} of ${total}; use recall to search the rest):
${longText}
Short-term (what's going on now, open loops):
${shortText}
${eps ? `Recent days:\n${eps}\n` : ""}`;
}

/** Save a memory, merging with a near-duplicate instead of adding a second copy. */
export function remember(db: Db, a: { text: string; term?: string; kind?: string; importance?: number; days?: number }, source: string) {
  const text = String(a.text ?? "").trim().slice(0, 600);
  if (!text) return { error: "Nothing to remember." };
  if (a.term === "short") {
    const kind = SHORT_KINDS.includes(String(a.kind)) ? String(a.kind) : "now";
    const days = Math.max(1, Math.min(30, Number(a.days) || (kind === "followup" ? 7 : 3)));
    const r = db.query("INSERT INTO short_term (text, kind, created_at, expires_at, source) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .get(text, kind, iso(), new Date(Date.now() + days * 864e5).toISOString(), source) as any;
    return { saved: `S${r.id}`, until: ist(new Date(Date.now() + days * 864e5).toISOString()).slice(0, 10) };
  }
  const kind = LONG_KINDS.includes(String(a.kind)) ? String(a.kind) : "fact";
  const importance = Math.max(1, Math.min(5, Math.round(Number(a.importance) || 3)));
  const w = new Set(words(text));
  // A near-twin under any kind is the same memory said again: update it instead of adding a copy.
  const twin = (db.query("SELECT id, text FROM memories WHERE status = 'active'").all() as any[]).find((m) => {
    const mw = words(m.text);
    const shared = mw.filter((x) => w.has(x)).length;
    return shared >= 3 && shared / Math.max(w.size, mw.length) >= 0.7;
  });
  if (twin) {
    db.query("UPDATE memories SET text = ?, importance = max(importance, ?), updated_at = ? WHERE id = ?").run(text, importance, iso(), twin.id);
    return { updated: `L${twin.id}` };
  }
  const r = db.query("INSERT INTO memories (text, at, kind, importance, updated_at, source) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .get(text, iso(), kind, importance, iso(), source) as any;
  return { saved: `L${r.id}` };
}

const idOf = (id: unknown) => {
  const m = String(id ?? "").trim().match(/^([LSls]?)(\d+)$/);
  if (!m) return null;
  return { term: m[1].toUpperCase() === "S" ? "short" : "long", id: Number(m[2]) };
};

export function updateMemory(db: Db, a: { id: string; text?: string; importance?: number; kind?: string }) {
  const k = idOf(a.id);
  if (!k) return { error: "id looks like L12 or S4." };
  if (k.term === "short") {
    if (a.text) db.query("UPDATE short_term SET text = ? WHERE id = ?").run(String(a.text).slice(0, 600), k.id);
    return { updated: `S${k.id}` };
  }
  const row = db.query("SELECT id FROM memories WHERE id = ?").get(k.id);
  if (!row) return { error: `No memory L${k.id}.` };
  if (a.text) db.query("UPDATE memories SET text = ?, updated_at = ? WHERE id = ?").run(String(a.text).slice(0, 600), iso(), k.id);
  if (a.importance) db.query("UPDATE memories SET importance = ?, updated_at = ? WHERE id = ?").run(Math.max(1, Math.min(5, Math.round(a.importance))), iso(), k.id);
  if (a.kind && LONG_KINDS.includes(a.kind)) db.query("UPDATE memories SET kind = ? WHERE id = ?").run(a.kind, k.id);
  return { updated: `L${k.id}` };
}

/** Forget: a long-term memory is deleted; a short-term note is closed. */
export function forget(db: Db, id: unknown) {
  const k = idOf(id);
  if (!k) return { error: "id looks like L12 or S4." };
  if (k.term === "short") db.query("UPDATE short_term SET status = 'done' WHERE id = ?").run(k.id);
  else db.query("DELETE FROM memories WHERE id = ?").run(k.id);
  return { forgot: `${k.term === "short" ? "S" : "L"}${k.id}` };
}

/** Search everything she has: long-term, short-term, days, journal and call summaries. Times are India time;
 * each call has its id so read_call can open the full transcript. */
export function recall(db: Db, query: string) {
  const q = new Set(words(query));
  const hit = (t: string) => words(t).filter((x) => q.has(x)).length;
  const top = <T>(rows: T[], text: (r: T) => string, n: number) => rows.map((r) => ({ r, h: hit(text(r)) })).filter((x) => x.h > 0)
    .sort((a, b) => b.h - a.h).slice(0, n).map((x) => x.r);
  return {
    long: top(db.query("SELECT id, kind, importance, text FROM memories WHERE status = 'active'").all() as any[], (r: any) => r.text, 15)
      .map((r: any) => ({ id: `L${r.id}`, kind: r.kind, importance: r.importance, text: r.text })),
    short: top(shortTerm(db), (r: any) => r.text, 10).map((r: any) => ({ id: `S${r.id}`, kind: r.kind, text: r.text, until: ist(r.expires_at) })),
    days: top(db.query("SELECT date, summary FROM episodes ORDER BY date DESC LIMIT 120").all() as any[], (r: any) => r.summary, 6),
    journal: top(db.query("SELECT date, text FROM journal ORDER BY id DESC LIMIT 300").all() as any[], (r: any) => r.text, 6)
      .map((r: any) => ({ date: r.date, text: String(r.text).slice(0, 500) })),
    calls: top(db.query("SELECT id, started_at, reason, summary, actions FROM calls WHERE summary IS NOT NULL ORDER BY started_at DESC LIMIT 200").all() as any[],
      (r: any) => `${r.reason ?? ""} ${r.summary} ${r.actions ?? ""}`, 5)
      .map((r: any) => ({ id: r.id, at: `${ist(r.started_at)} India time`, summary: r.summary })),
    // Always the latest calls too, matching or not, so "did we talk last night?" never gets a wrong no.
    recent_calls: (db.query("SELECT id, direction, status, started_at, seconds, summary FROM calls ORDER BY started_at DESC LIMIT 4").all() as any[])
      .map((r: any) => ({ id: r.id, at: `${ist(r.started_at)} India time`, rang: r.direction === "incoming" ? "Wyn rang them" : "they rang Wyn",
        minutes: r.seconds ? Math.max(1, Math.round(r.seconds / 60)) : null, summary: r.summary ? String(r.summary).slice(0, 200) : r.status })),
    note: "Times are India time (Asia/Kolkata). For the full list of calls use list_calls; for what was said, read_call.",
  };
}

/** Everything, for the app's Memory tab. */
export function memoryList(db: Db) {
  return {
    long: (db.query("SELECT id, text, kind, importance, at, updated_at FROM memories WHERE status = 'active' ORDER BY importance DESC, coalesce(updated_at, at) DESC").all() as any[])
      .map((r) => ({ ...r, id: `L${r.id}` })),
    short: shortTerm(db).map((r) => ({ ...r, id: `S${r.id}` })),
    days: db.query("SELECT date, summary FROM episodes ORDER BY date DESC LIMIT 14").all(),
  };
}

/** Apply the nightly consolidation's plan. Ids it names that don't exist are skipped. */
export function applyConsolidation(db: Db, date: string, plan: any) {
  const done = { added: 0, updated: 0, archived: 0, short: 0, closed: 0 };
  if (plan?.episode) db.query("INSERT OR REPLACE INTO episodes (date, summary, at) VALUES (?, ?, ?)").run(date, String(plan.episode).slice(0, 2000), iso());
  for (const m of Array.isArray(plan?.add) ? plan.add.slice(0, 20) : []) if (!("error" in remember(db, { ...m, term: "long" }, "consolidation"))) done.added++;
  for (const m of Array.isArray(plan?.update) ? plan.update.slice(0, 20) : []) if (!("error" in updateMemory(db, m))) done.updated++;
  for (const id of Array.isArray(plan?.archive) ? plan.archive.slice(0, 20) : []) {
    const k = idOf(id);
    if (k?.term === "long") { db.query("UPDATE memories SET status = 'archived', updated_at = ? WHERE id = ?").run(iso(), k.id); done.archived++; }
  }
  for (const m of Array.isArray(plan?.short_add) ? plan.short_add.slice(0, 10) : []) if (!("error" in remember(db, { ...m, term: "short" }, "consolidation"))) done.short++;
  for (const id of Array.isArray(plan?.short_close) ? plan.short_close.slice(0, 20) : []) { if (!("error" in forget(db, `S${String(id).replace(/^S/i, "")}`))) done.closed++; }
  return done;
}
