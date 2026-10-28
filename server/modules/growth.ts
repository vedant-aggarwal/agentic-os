// Growth: the journal and check-ins, the Sunday review, the overnight dream, the day and week plans, and the growth
// index (a level per week from every app's data; growth is its rate of change). (v2) Owner: the GROWTH agent.
//
// Collections (the phone's svc/store contract, server/modules/_collection.ts), all under /api/v1/mod/growth:
//   /journal    entries { date, at, kind typed|voice|scan|agent, text, title, p, e (mood 1-5), words, photos, prompt,
//               asked, filed, by me|wyn, source app|siri|widget|agent|cli, backfill }. POST { id, text, at, source } from
//               App Intents and widgets works too: date, words and title are filled in here.
//   /checkins   { date, at, p, e, why }   /reviews  id = ISO week (2026-W43)   /dreams  id = d-<date>
//   /plans      id = day-<date> | week-<week>   /settings  id = streak (the ladder switches)
// Computed:
//   GET  /state      everything the app draws: streak, this week's points and score, levels week by week, velocity,
//                    potential, drivers, Wyn's journal (read-only, from her db), the review draft for this week
//   GET  /summary    the short version for the agent's heartbeat and widgets
//   POST /dream/run  { date?, force? }  run the overnight dream now (owner; spends the subscription)
//   POST /review/draft { force? }      draft this week's review with the model (owner; spends the subscription)
//   POST /ocr        { image: data URL } a handwritten page to text (Codex vision on the subscription)
// Jobs: the dream at 04:30 IST, the Sunday review draft at 18:00, the streak nudge at 21:00 and the alarm push at 22:00.
// The tables belong to the agentos module (cli/src/modules/growth.ts); its pure functions compute the numbers.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountCollection } from "./_collection";
import type { AgentTool, JobCtx, ModCtx, Module } from "./types";
import * as G from "../../cli/src/modules/growth.ts";

const migrated = new WeakSet<Database>();
const dbOf = (ctx: JobCtx) => { const db = ctx.db(); if (!migrated.has(db)) { G.migrate(db); migrated.add(db); } return db; };
const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const titleFrom = (t: string) => { const s = t.split(/[.!?\n]/)[0].trim(); return s.length > 46 ? `${s.slice(0, 44).replace(/\s+\S*$/, "")}…` : s || "Tonight"; };
const mood = (v: unknown) => (v == null || v === "" ? null : Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : NaN);

// ── collections ─────────────────────────────────────────────────────────────────────────────────────────────────────
const journal = mountCollection({
  table: "growth_journal", columns: { date: "text", at: "text", kind: "text", words: "integer", p: "integer", e: "integer", by: "text", source: "text" },
  validate(d, cur) {
    if (d.deleted_at) return null;
    if (typeof d.text !== "string") return "An entry needs its text.";
    if (d.text.length > 50_000) return "That entry is too long.";
    if (d.at != null && Number.isNaN(Date.parse(d.at))) return "at is an ISO time.";
    d.at ??= cur?.at ?? new Date().toISOString();
    d.date ??= cur?.date ?? G.istDate(new Date(d.at));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) return "date is YYYY-MM-DD.";
    for (const k of ["p", "e"]) { const m = mood(d[k]); if (Number.isNaN(m)) return `${k} is 1 to 5.`; d[k] = m; }
    d.words = words(d.text);
    d.title ??= titleFrom(d.text);
    d.kind ??= "typed"; d.by ??= "me"; d.source ??= "app";
    if (Array.isArray(d.photos) && JSON.stringify(d.photos).length > 3_000_000) return "Photos are too large; three small ones at most.";
    return null;
  },
});
const checkins = mountCollection({
  table: "growth_checkins", columns: { date: "text", at: "text", p: "integer", e: "integer" },
  validate(d) {
    if (d.deleted_at) return null;
    for (const k of ["p", "e"]) { const m = mood(d[k]); if (m == null || Number.isNaN(m)) return `${k} is 1 to 5.`; d[k] = m; }
    d.at ??= new Date().toISOString(); d.date ??= G.istDate(new Date(d.at));
    return null;
  },
});
const reviews = mountCollection({
  table: "growth_reviews", columns: { week: "text", status: "text", score: "real" },
  validate(d) { if (d.deleted_at) return null; if (!/^\d{4}-W\d{2}$/.test(String(d.id))) return "A review's id is its ISO week, like 2026-W43."; d.week = d.id; d.status ??= "draft"; return null; },
});
const dreams = mountCollection({
  table: "growth_dreams", columns: { date: "text", status: "text" },
  validate(d) { if (d.deleted_at) return null; d.date ??= String(d.id).replace(/^d-/, ""); return /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? null : "A dream's id is d-YYYY-MM-DD."; },
});
const plans = mountCollection({
  table: "growth_plans", columns: { kind: "text", date: "text", week: "text" },
  validate(d) { if (d.deleted_at) return null; const m = /^(day|week)-(.+)$/.exec(String(d.id)); if (!m) return "A plan's id is day-<date> or week-<week>."; d.kind = m[1]; if (m[1] === "day") d.date = m[2]; else d.week = m[2]; return null; },
});
const settings = mountCollection({ table: "growth_settings" });

// ── Wyn's journal (her own db; the Agent area owns it, Growth only reads) ──────────────────────────────────────────
const MOOD_WORDS: Record<string, [number, number]> = {
  happy: [5, 4], great: [5, 4], good: [4, 3], grateful: [5, 2], calm: [3, 2], okay: [3, 3], ok: [3, 3], fine: [3, 3], excited: [4, 5], focused: [4, 4],
  tired: [2, 1], drained: [1, 1], low: [2, 2], sad: [1, 2], down: [1, 2], stressed: [2, 5], anxious: [1, 4], frustrated: [1, 3], angry: [1, 4], proud: [5, 4],
};
function wynJournal(ctx: JobCtx, days = 400) {
  const u = ctx.user; if (!u) return [];
  const f = join(ctx.dataDir, "wyn", `user-${u.id}`, "wyn.db");
  if (!existsSync(f)) return [];
  let n: Database | null = null;
  try {
    n = new Database(f, { readonly: true });
    const since = G.addDays(G.istDate(), -days);
    return (n.query("SELECT id, date, text, mood, source, at FROM journal WHERE date >= ? ORDER BY id").all(since) as any[]).map((r) => {
      const m = MOOD_WORDS[String(r.mood ?? "").toLowerCase().trim()] ?? null;
      return { id: `wyn-${r.id}`, date: r.date, at: r.at, text: r.text, title: titleFrom(r.text), words: words(r.text), kind: "agent", by: "wyn", source: r.source ?? "chat", mood: r.mood ?? null, p: m?.[0] ?? null, e: m?.[1] ?? null, readonly: true };
    });
  } catch (e) { ctx.log(`could not read Wyn's journal: ${e}`); return []; }
  finally { try { n?.close(); } catch {} }
}
function wynExtra(ctx: JobCtx, what: "episodes" | "memories" | "messages", n = 10) {
  const u = ctx.user; if (!u) return [];
  const f = join(ctx.dataDir, "wyn", `user-${u.id}`, "wyn.db");
  if (!existsSync(f)) return [];
  let d: Database | null = null;
  try {
    d = new Database(f, { readonly: true });
    if (what === "episodes") return d.query("SELECT date, summary FROM episodes ORDER BY date DESC LIMIT ?").all(n) as any[];
    if (what === "memories") return d.query("SELECT text, kind, importance FROM memories WHERE status = 'active' ORDER BY importance DESC, id DESC LIMIT ?").all(n) as any[];
    return d.query("SELECT role, substr(text, 1, 400) text, at FROM messages WHERE at >= ? ORDER BY id").all(new Date(Date.now() - n * 3600_000).toISOString()) as any[];
  } catch { return []; } finally { try { d?.close(); } catch {} }
}
const contentDb = (ctx: JobCtx) => { try { return existsSync(ctx.contentDbPath) ? new Database(ctx.contentDbPath, { readonly: true }) : null; } catch { return null; } };

// ── the state the app draws ─────────────────────────────────────────────────────────────────────────────────────────
export function state(ctx: JobCtx, now = new Date()) {
  const db = dbOf(ctx);
  const wyn = wynJournal(ctx);
  const extra = wyn.map((x) => ({ date: x.date, p: x.p, e: x.e }));
  const today = G.istDate(now);
  const days = G.journalDays(db, extra);
  const streak = G.streakOf(days, today);
  const lv = G.levels(db, { now, weeks: 53, extraJournal: extra });
  const cdb = contentDb(ctx);
  let wk: ReturnType<typeof G.weekPoints>, draft: any;
  try { wk = G.weekPoints(db, now, extra, cdb); draft = G.draftReview(db, now, extra, cdb); } finally { try { cdb?.close(); } catch {} }
  const weeks = lv.weeks.map((w) => ({ key: w.key, n: G.weekNum(w.key), label: G.weekLabel(w.key), from: w.from, level: w.level, rate: w.rate, aspects: w.aspects }));
  const cur = lv.weeks.at(-1), prev = lv.weeks.at(-2);
  const last12 = lv.weeks.slice(-12);
  const velocity = G.ASPECTS.map((a) => {
    const arr = last12.map((w) => w.aspects[a]);
    const nowV = arr.at(-1) ?? null;
    const v = Math.round(G.rateAt(arr, arr.length - 1) * 10) / 10;
    return { id: a, now: nowV, v, state: nowV == null ? "none" : v >= 1 ? "up" : v <= -1 ? "down" : "flat", arr };
  });
  const goals = db.query("SELECT id, title, area, aspects FROM goals WHERE status = 'active'").all() as any[];
  const goalAspects = (g: any) => { try { const a = JSON.parse(g.aspects ?? "null"); if (Array.isArray(a) && a.length) return a; } catch {} const x = G.aspectOfArea(db, g.area); return x ? [x] : []; };
  const potential = G.ASPECTS.map((a) => {
    const hist = lv.weeks.map((w) => ({ key: w.key, v: w.aspects[a] })).filter((x) => x.v != null) as { key: string; v: number }[];
    const top = [...hist].sort((x, y) => y.v - x.v).slice(0, 4);
    const pot = top.length ? Math.round(top.reduce((s, x) => s + x.v, 0) / top.length) : null;
    return { id: a, now: cur?.aspects[a] ?? null, pot, weeks: hist.length, best: top[0] ? `${G.weekLabel(top[0].key)}: ${top[0].v}` : null, goals: goals.filter((g) => goalAspects(g).includes(a)).map((g) => `g${g.id}`) };
  });
  const drivers: Record<string, string> = {};
  for (const a of G.ASPECTS) {
    const s = cur?.signals[a] ?? [];
    drivers[a] = s.length ? s.map((x) => `${x.label} ${x.raw}`).join(" · ") : "No data from this part of your life yet.";
  }
  const stored = db.query("SELECT * FROM growth_reviews WHERE deleted_at IS NULL AND week = ?").get(wk.key) as any;
  const sealed = (db.query("SELECT * FROM growth_reviews WHERE deleted_at IS NULL AND status = 'sealed' ORDER BY week DESC LIMIT 12").all() as any[]).map(G.docOf);
  const lastSealed = sealed.find((r: any) => r.week < wk.key) ?? null;
  // last Sunday's moves, with how each is going (their goals' progress when they became goals)
  const moves = (lastSealed?.moves ?? []).filter((m: any) => m.on !== false).map((m: any) => {
    const gid = m.goalId && /^g?\d+$/.test(String(m.goalId)) ? Number(String(m.goalId).replace(/^g/, "")) : null;
    // a goal made offline keeps its temporary id in the review; find it by its title then
    const g = (gid ? db.query("SELECT id, progress, status FROM goals WHERE id = ?").get(gid) : db.query("SELECT id, progress, status FROM goals WHERE title = ? AND horizon = 'week' ORDER BY id DESC LIMIT 1").get(String(m.goalTitle ?? m.text))) as any;
    return { text: m.text, aspect: m.aspect, goal: g ? `g${g.id}` : null, progress: g?.progress ?? null, done: g?.status === "done" };
  });
  const sundays = (() => { let n = 0; let k = G.weekKey(G.addDays(G.mondayOf(today), -1)); const have = new Set(sealed.map((r: any) => r.week)); if (have.has(wk.key)) n++; while (have.has(k)) { n++; k = G.weekKey(G.addDays(G.weekMonday(k), -1)); } return n; })();
  return {
    today, at: now.toISOString(), hm: G.istHm(now),
    streak: { ...streak, saveBy: "22:00", atRisk: !streak.today && G.istHm(now) >= "18:00" },
    week: { ...wk, n: G.weekNum(wk.key), score: cur?.level ?? null, last: prev?.level ?? null, rate: cur?.rate ?? 0, moves, rule: lastSealed ? { text: lastSealed.ruleText ?? null, week: lastSealed.week } : null },
    weeks, velocity, potential, drivers,
    sources: [...new Set(lv.weeks.flatMap((w) => Object.values(w.signals).flat().map((s) => s.label)))],
    wyn,
    review: stored ? G.docOf(stored) : draft,
    reviews: sealed.map((r: any) => ({ week: r.week, n: G.weekNum(r.week), label: G.weekLabel(r.week), score: r.score ?? null, last: r.last ?? null, line: r.headline ?? "", rule: r.ruleText ?? "", moves: (r.moves ?? []).filter((m: any) => m.on !== false).map((m: any) => m.text) })),
    sundays,
  };
}
export function summary(ctx: JobCtx, now = new Date()) {
  const db = dbOf(ctx);
  const extra = wynJournal(ctx, 60).map((x) => ({ date: x.date }));
  const today = G.istDate(now);
  const s = G.streakOf(G.journalDays(db, extra), today);
  const lv = G.levels(db, { now, weeks: 6, extraJournal: extra });
  const d = G.listDocs(db, "growth_dreams", "1 = 1 ORDER BY date DESC LIMIT 1")[0] as any;
  const pending = d ? (d.proposals ?? []).filter((p: any) => !p.answer).length : 0;
  const r = G.listDocs(db, "growth_reviews", "week = ?", G.weekKey(today))[0] as any;
  const hm = G.istHm(now);
  return {
    line: s.today ? `${s.current}-day journal streak. Tonight's entry is in.` : s.n ? `${s.n}-day journal streak. Tonight's entry keeps it.` : "No journal streak yet. Two lines tonight start one.",
    streak: { n: s.n, current: s.current, today: s.today, atRisk: !s.today && hm >= "18:00", due: "22:00", ladder: [["21:00", "nudge"], ["22:00", "alarm"], ["22:30", "call"]] },
    week: lv.weeks.at(-1) ? { key: lv.thisKey, level: lv.weeks.at(-1)!.level, last: lv.weeks.at(-2)?.level ?? null, rate: lv.weeks.at(-1)!.rate } : null,
    dream: d ? { date: d.date, status: d.status, connections: (d.connections ?? []).length, pending } : null,
    review: r ? { week: r.week, status: r.status } : { week: G.weekKey(today), status: "none" },
  };
}

// ── the dream: she reads the day while he sleeps and connects what sits in different apps ───────────────────────────
const DREAM_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    headline: { type: "string" },
    connections: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      title: { type: "string" }, aspects: { type: "array", items: { type: "string", enum: [...G.ASPECTS] } }, strength: { type: "string", enum: ["Strong", "Clear", "Faint"] },
      text: { type: "string" },
      evidence: { type: "array", items: { type: "object", additionalProperties: false, properties: { aspect: { type: "string" }, source: { type: "string" }, quote: { type: "string" } }, required: ["aspect", "source", "quote"] } },
      proposal: { type: ["object", "null"], additionalProperties: false, properties: { kind: { type: "string", enum: ["Task", "Goal", "Rule", "Ritual", "Plan"] }, title: { type: "string" }, meta: { type: "string" }, confidence: { type: "string", enum: ["High", "Medium", "Low"] }, aspect: { type: "string", enum: [...G.ASPECTS] } }, required: ["kind", "title", "meta", "confidence", "aspect"] },
    }, required: ["title", "aspects", "strength", "text", "evidence", "proposal"] } },
    gaps: { type: "array", items: { type: "object", additionalProperties: false, properties: { aspect: { type: "string", enum: [...G.ASPECTS] }, title: { type: "string" }, text: { type: "string" } }, required: ["aspect", "title", "text"] } },
  },
  required: ["headline", "connections", "gaps"],
};
function dreamContext(ctx: JobCtx, now: Date) {
  const db = dbOf(ctx);
  const today = G.istDate(now), y = G.addDays(today, -1), since = G.addDays(today, -7);
  const mine = G.listDocs(db, "growth_journal", "date >= ? ORDER BY date", since) as any[];
  const wyn = wynJournal(ctx, 8);
  const entries = [...mine.map((e) => ({ date: e.date, by: e.by ?? "me", mood: e.p ? `${e.p}/5 pleasant, ${e.e}/5 energy` : null, text: String(e.text ?? "").slice(0, 900) })), ...wyn.map((e) => ({ date: e.date, by: "said to Wyn", mood: e.mood, text: String(e.text).slice(0, 900) }))].sort((a, b) => a.date.localeCompare(b.date));
  const cks = G.listDocs(db, "growth_checkins", "date >= ? ORDER BY at", since).map((c: any) => ({ date: c.date, p: c.p, e: c.e, why: c.why ?? [] }));
  const dayIso = (d: string) => G.istStart(d);
  const doneY = db.query("SELECT id, title, area FROM tasks WHERE status = 'done' AND julianday(done_at) >= julianday(?) AND julianday(done_at) < julianday(?)").all(dayIso(y), dayIso(today)) as any[];
  const overdue = db.query("SELECT id, title, area, substr(due, 1, 10) due FROM tasks WHERE status NOT IN ('done', 'dropped') AND due IS NOT NULL AND substr(due, 1, 10) < ? ORDER BY due LIMIT 12").all(today) as any[];
  const soon = db.query("SELECT id, title, area, substr(due, 1, 10) due FROM tasks WHERE status NOT IN ('done', 'dropped') AND substr(due, 1, 10) BETWEEN ? AND ? ORDER BY due LIMIT 12").all(today, G.addDays(today, 3)) as any[];
  const doing = db.query("SELECT id, title, area FROM tasks WHERE status = 'doing' LIMIT 12").all() as any[];
  const goals = db.query("SELECT id, title, horizon, progress, area FROM goals WHERE status = 'active' LIMIT 20").all() as any[];
  const lv = G.levels(db, { now, weeks: 6, extraJournal: wyn.map((x) => ({ date: x.date })) });
  const cdb = contentDb(ctx);
  let points: any[] = [];
  try { points = G.weekPoints(db, now, [], cdb).points; } finally { try { cdb?.close(); } catch {} }
  const mods = G.moduleTables(db).map((m) => ({ table: m.table, aspect: m.aspect, label: m.label, yesterday: (db.query(`SELECT count(*) n FROM ${m.table} WHERE deleted_at IS NULL AND julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?)`).get(dayIso(y), dayIso(today)) as any).n }));
  const episodes = wynExtra(ctx, "episodes", 3), memories = wynExtra(ctx, "memories", 15), messages = wynExtra(ctx, "messages", 30);
  const tag = (t: any) => ({ id: `t${t.id}`, title: t.title, area: t.area, aspect: G.aspectOfArea(db, t.area), due: t.due });
  const read: [string, string, string][] = [
    ["growth", "Journal", `${entries.length} ${entries.length === 1 ? "entry" : "entries"} this week`],
    ["mission", "Tasks", `${doneY.length} done yesterday, ${overdue.length} overdue`],
    ["mission", "Goals", `${goals.length} active`],
    ...(cks.length ? [["soul", "Check-ins", `${cks.length} this week`] as [string, string, string]] : []),
    ...mods.filter((m) => m.yesterday).map((m) => [m.aspect, m.label, `${m.yesterday} yesterday`] as [string, string, string]),
    ["agent", "Chats with you", `${messages.length} messages in a day`],
  ];
  const have = new Set(mods.map((m) => m.aspect));
  const missing = [
    ...(!have.has("body") ? ["Body logs (workouts, meals and sleep aren't set up yet)"] : []),
    ...(!have.has("money") ? ["Money (no expenses logged yet)"] : []),
    "The calendar (not read overnight yet)", "Health (not connected)",
  ];
  const slipped = overdue.slice(0, 5).map((t) => ({ aspect: G.aspectOfArea(db, t.area) ?? "mission", title: t.title, meta: `${G.daysBetween(t.due, today)} ${G.daysBetween(t.due, today) === 1 ? "day" : "days"} late`, act: `task:t${t.id}` }));
  return {
    data: { today, yesterday: y, journal: entries, checkins: cks, doneYesterday: doneY.map(tag), overdue: overdue.map(tag), dueSoon: soon.map(tag), doing: doing.map(tag), goals: goals.map((g) => ({ id: `g${g.id}`, title: g.title, horizon: g.horizon, progress: g.progress })), weekPoints: points.map((p) => ({ aspect: p.aspect, label: p.label, now: p.now, was: p.was })), levels: lv.weeks.map((w) => ({ week: w.key, level: w.level, aspects: w.aspects })), appsYesterday: mods, wynDays: episodes, wynKnows: memories.map((m: any) => m.text) },
    read, missing, slipped,
  };
}
export async function runDream(ctx: JobCtx, { date, force = false, now = new Date() }: { date?: string; force?: boolean; now?: Date } = {}) {
  const db = dbOf(ctx);
  const d = date ?? G.istDate(now);
  const id = `d-${d}`;
  const cur = G.docOf(db.query("SELECT * FROM growth_dreams WHERE id = ?").get(id)) as any;
  if (cur && !force && (cur.status === "ready" || (cur.status === "running" && Date.now() - Date.parse(cur.updated_at) < 15 * 60_000))) return cur;
  const t0 = Date.now();
  const c = dreamContext(ctx, now);
  G.putDoc(db, "growth_dreams", { id, date: d, status: "running", from: G.istHm(now), read: c.read, missing: c.missing, slipped: c.slipped });
  try {
    const r: any = await ctx.ai.claude({
      model: "sonnet", schema: DREAM_SCHEMA, timeout: 240_000,
      system: `You are ${ctx.wyn?.name ?? "Wyn"}, a personal assistant who reads her person's day overnight while he sleeps. From the data, find 2 to 4 connections between different parts of his life (each across at least two aspects), and up to 3 gaps (things missing or neglected). Every connection must be grounded: its evidence quotes or cites rows from the data (journal lines in his words, task titles, counts), never invented facts. Each connection may carry one small proposal he can approve: a Task (a concrete next step), a Goal, a Rule (a limit for the week), a Ritual (a repeated habit at a time) or a Plan (a block on the calendar). Titles under 9 words, texts under 45 words, warm and direct, plain words, no hype, no therapy talk. If the data is thin, say less: one connection is fine. Never assume a partner, a diagnosis or anything not in the data; leave romance out unless the journal talks about it. Don't quote the level numbers; talk about what he did. The headline is one line naming the strongest thread.`,
      prompt: JSON.stringify(c.data),
    });
    const out = r?.out ?? {};
    const proposals: any[] = [];
    const connections = (out.connections ?? []).slice(0, 4).map((x: any, i: number) => {
      let pid: string | null = null;
      if (x.proposal?.title) { pid = `r${proposals.length + 1}`; proposals.push({ id: pid, kind: x.proposal.kind, aspect: x.proposal.aspect, title: String(x.proposal.title).slice(0, 90), meta: String(x.proposal.meta ?? "").slice(0, 120), confidence: x.proposal.confidence ?? "Medium", from: `c${i + 1}`, answer: null }); }
      return { id: `c${i + 1}`, title: String(x.title).slice(0, 90), aspects: (x.aspects ?? []).filter((a: string) => (G.ASPECTS as readonly string[]).includes(a)).slice(0, 4), strength: x.strength ?? "Clear", text: String(x.text ?? "").slice(0, 400), evidence: (x.evidence ?? []).slice(0, 5).map((e: any) => [e.aspect, String(e.source).slice(0, 60), String(e.quote).slice(0, 160)]), proposal: pid };
    });
    const gaps = (out.gaps ?? []).slice(0, 3).map((g: any) => ({ aspect: g.aspect, title: String(g.title).slice(0, 80), text: String(g.text).slice(0, 240) }));
    return G.putDoc(db, "growth_dreams", { id, date: d, status: "ready", headline: String(out.headline ?? connections[0]?.title ?? "").slice(0, 120), to: G.istHm(), connections, gaps, proposals, read: c.read, missing: c.missing, slipped: c.slipped, model: "sonnet", ms: Date.now() - t0 });
  } catch (e: any) {
    ctx.log(`dream failed: ${e?.message ?? e}`);
    return G.putDoc(db, "growth_dreams", { id, date: d, status: "failed", error: String(e?.message ?? e).slice(0, 300), to: G.istHm(), connections: [], gaps: [], proposals: [], ms: Date.now() - t0 });
  }
}

// ── the Sunday review draft ─────────────────────────────────────────────────────────────────────────────────────────
const REVIEW_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    headline: { type: "string" }, feel: { type: "string" },
    wins: { type: "array", items: { type: "object", additionalProperties: false, properties: { text: { type: "string" }, aspect: { type: "string", enum: [...G.ASPECTS] } }, required: ["text", "aspect"] } },
    misses: { type: "array", items: { type: "object", additionalProperties: false, properties: { text: { type: "string" }, aspect: { type: "string", enum: [...G.ASPECTS] }, detail: { type: "string" }, whys: { type: "array", items: { type: "string" } } }, required: ["text", "aspect", "detail", "whys"] } },
    rules: { type: "array", items: { type: "object", additionalProperties: false, properties: { text: { type: "string" }, why: { type: "string" } }, required: ["text", "why"] } },
    moves: { type: "array", items: { type: "object", additionalProperties: false, properties: { text: { type: "string" }, aspect: { type: "string", enum: [...G.ASPECTS] }, lands: { type: "string" } }, required: ["text", "aspect", "lands"] } },
  },
  required: ["headline", "feel", "wins", "misses", "rules", "moves"],
};
export async function draftReviewAI(ctx: JobCtx, { force = false, now = new Date() }: { force?: boolean; now?: Date } = {}) {
  const db = dbOf(ctx);
  const wyn = wynJournal(ctx, 10);
  const cdb = contentDb(ctx);
  let base: any;
  try { base = G.draftReview(db, now, wyn.map((x) => ({ date: x.date, p: x.p, e: x.e })), cdb); } finally { try { cdb?.close(); } catch {} }
  const cur = G.docOf(db.query("SELECT * FROM growth_reviews WHERE id = ?").get(base.id)) as any;
  if (cur?.status === "sealed") return cur;
  if (cur?.drafted_by === "sonnet" && !force) return cur;
  const entries = [...(G.listDocs(db, "growth_journal", "date >= ? ORDER BY date", base.from) as any[]).map((e) => ({ date: e.date, mood: e.p, text: String(e.text ?? "").slice(0, 700) })), ...wyn.filter((x) => x.date >= base.from).map((e) => ({ date: e.date, mood: e.mood, text: String(e.text).slice(0, 700) }))];
  const cks = G.listDocs(db, "growth_checkins", "date >= ?", base.from).map((c: any) => ({ date: c.date, p: c.p, e: c.e, why: c.why }));
  const lastSealed = G.listDocs(db, "growth_reviews", "status = 'sealed' AND week < ? ORDER BY week DESC LIMIT 1", base.id)[0] as any;
  const r: any = await ctx.ai.claude({
    model: "sonnet", schema: REVIEW_SCHEMA, timeout: 180_000,
    system: "You draft a Sunday weekly review for one person from his real data: the week's data points against last week, his journal and check-ins, overdue tasks, last week's rule and moves. Write: a one-line headline with the score and what carried or held back the week; one line on how the week felt (from the journal and moods; empty if there is nothing); up to 5 wins and up to 4 misses, each tied to a number or a line he wrote (misses get 3 or 4 honest possible reasons in his voice, like 'Avoided it'); 3 candidate rules for next week (each a short imperative with a why from the data); exactly 3 moves for next week, concrete and small enough to do, aimed at what held the week back. Plain words, warm, no hype, under 14 words per line. Never invent facts not in the data.",
    prompt: JSON.stringify({ week: base.label, score: base.score, last: base.last, points: base.points, misses: base.misses, journal: entries, checkins: cks, lastRule: lastSealed?.ruleText ?? null, lastMoves: (lastSealed?.moves ?? []).map((m: any) => m.text) }),
  });
  const o = r?.out ?? {};
  const doc = {
    ...base, ...(cur ?? {}), id: base.id, status: "draft", score: base.score, last: base.last, points: base.points,
    headline: String(o.headline ?? base.headline).slice(0, 200), feel: { p: null, e: null, line: String(o.feel ?? "").slice(0, 200) },
    wins: (o.wins ?? []).slice(0, 5).map((w: any) => ({ text: String(w.text).slice(0, 120), aspect: w.aspect, on: true })),
    misses: (o.misses ?? []).slice(0, 4).map((m: any) => ({ text: String(m.text).slice(0, 120), aspect: m.aspect, detail: String(m.detail ?? "").slice(0, 160), whys: (m.whys ?? []).slice(0, 4).map(String), why: null })),
    rules: (o.rules ?? []).slice(0, 3).map((x: any, i: number) => ({ id: `u${i + 1}`, text: String(x.text).slice(0, 90), why: String(x.why).slice(0, 140) })),
    moves: (o.moves ?? []).slice(0, 3).map((m: any, i: number) => ({ id: `m${i + 1}`, text: String(m.text).slice(0, 90), aspect: m.aspect, lands: String(m.lands ?? "A goal for next week").slice(0, 100), on: true })),
    drafted_by: "sonnet", drafted_at: new Date().toISOString(),
  };
  if (!doc.moves.length) doc.moves = base.moves;
  if (!doc.rules.length) doc.rules = base.rules;
  return G.putDoc(db, "growth_reviews", doc);
}

// ── a handwritten page to text ──────────────────────────────────────────────────────────────────────────────────────
async function ocr(ctx: ModCtx, image: string) {
  const m = /^data:image\/(png|jpe?g|webp|heic);base64,(.+)$/s.exec(String(image ?? ""));
  if (!m) throw Object.assign(new Error("Send the page as a data URL (PNG or JPEG)."), { status: 400 });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 8_000_000) throw Object.assign(new Error("That image is too large (8 MB at most)."), { status: 400 });
  const dir = join(ctx.dataDir, "mod", "growth", "scans");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `page-${Date.now().toString(36)}.${m[1] === "jpeg" ? "jpg" : m[1]}`);
  writeFileSync(file, buf);
  const r = await (ctx.codex as any)({
    prompt: "The attached image is a page from a personal notebook, usually handwritten in English (sometimes Hinglish). Transcribe it exactly as written: keep his words, line breaks between thoughts, and numbers. Mark a word you cannot read as [unclear]. Do not summarise or correct. Also give a short title (under 7 words) for the page.",
    images: [file], timeoutMs: 150_000, effort: "low",
    schema: { type: "object", additionalProperties: false, properties: { text: { type: "string" }, title: { type: "string" } }, required: ["text", "title"] },
  });
  return { text: String(r?.out?.text ?? r?.text ?? "").trim(), title: String(r?.out?.title ?? "").trim(), ms: r?.ms ?? null };
}

// ── the streak ladder (server half): a nudge at 21:00 and the alarm push at 22:00 when tonight's entry is missing ──
async function streakPush(ctx: JobCtx, step: "nudge" | "alarm") {
  const db = dbOf(ctx);
  const st = (G.docOf(db.query("SELECT * FROM growth_settings WHERE id = 'streak'").get()) ?? {}) as any;
  if (st[step] === false) return;
  const s = G.streakOf(G.journalDays(db, wynJournal(ctx, 60).map((x) => ({ date: x.date }))), G.istDate());
  if (s.today) return;
  const link = "agenticos://growth/journal";
  const title = step === "nudge" ? (s.n ? `${s.n}-day journal streak` : "Two lines tonight?") : (s.n ? `Save your ${s.n}-day journal streak` : "Tonight's entry");
  const body = step === "nudge" ? "Tonight's prompts are ready. Two lines are enough." : "Two lines are enough. Write now, or talk it instead.";
  await ctx.push(title, body, { link, url: link, aos: { id: `gro-streak-${G.istDate()}`, category: step === "alarm" ? "AOS_STREAK" : "AOS_NUDGE", url: link } });
}

// ── agent tools ─────────────────────────────────────────────────────────────────────────────────────────────────────
const tools: AgentTool[] = [
  {
    name: "growth_journal_write", auto: true,
    description: "Add a line to the user's journal for today (or a given date) in his own words, lightly cleaned: something he told you about his day, a feeling, a win. Appends to that day's entry. Optional mood: p (pleasant 1-5) and e (energy 1-5).",
    input: { type: "object", properties: { text: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD, default today (IST)" }, p: { type: "integer", minimum: 1, maximum: 5 }, e: { type: "integer", minimum: 1, maximum: 5 } }, required: ["text"] },
    run: async (ctx, a) => { const d = G.writeLine(dbOf(ctx), { text: a.text, date: a.date, p: a.p ?? null, e: a.e ?? null, by: "wyn", source: "agent" }); const at = (d.lines ?? []).at(-1)?.at ?? null; return { ok: true, id: d.id, date: d.date, words: d.words, undo: { tool: "growth_journal_undo", args: { id: d.id, at } } }; },
  },
  {
    // the Undo on her journal line (agent-tools undoModuleItem): takes back the one line she added; an entry that was
    // only that line is deleted (soft, so the phone's store sees it go)
    name: "growth_journal_undo", auto: true,
    description: "Take back a line you added to the journal with growth_journal_write (its id, and the line's at). Only your own line is removed.",
    input: { type: "object", properties: { id: { type: "string" }, at: { type: "string" } }, required: ["id"] },
    run: async (ctx, a) => {
      const db = dbOf(ctx);
      const cur = G.docOf(db.query("SELECT * FROM growth_journal WHERE id = ? AND deleted_at IS NULL").get(String(a.id ?? ""))) as any;
      if (!cur) return { ok: true, gone: true };
      const lines: any[] = cur.lines ?? [];
      const i = lines.findLastIndex((l) => l.by === "wyn" && (a.at ? l.at === a.at : true));
      if (i < 0) return { ok: false, error: "That line isn't in the entry any more." };
      const line = lines[i], rest = lines.filter((_, k) => k !== i);
      const text = String(cur.text ?? "");
      if (!rest.length && text.trim() === String(line.text).trim()) { G.putDoc(db, "growth_journal", { ...cur, lines: [], deleted_at: new Date().toISOString() }); return { ok: true, deleted: cur.id }; }
      const body = text.endsWith(line.text) ? text.slice(0, text.length - String(line.text).length).replace(/\s+$/, "") : text.replace(`

${line.text}`, "").replace(line.text, "").trim();
      const words = body.trim() ? body.trim().split(/\s+/).length : 0;
      const d = G.putDoc(db, "growth_journal", { ...cur, text: body, words, lines: rest });
      return { ok: true, id: d.id, words };
    },
  },
  {
    name: "growth_journal_read", auto: true,
    description: "Read the user's journal: his entries (and the lines he told you) for the last N days, newest first, with moods.",
    input: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 120 } } },
    run: async (ctx, a) => {
      const since = G.addDays(G.istDate(), -(a.days ?? 7));
      const mine = (G.listDocs(dbOf(ctx), "growth_journal", "date >= ? ORDER BY date DESC", since) as any[]).map((e) => ({ date: e.date, by: e.by, p: e.p, e: e.e, text: e.text }));
      return { entries: [...mine, ...wynJournal(ctx, a.days ?? 7).map((e) => ({ date: e.date, by: "told Wyn", mood: e.mood, text: e.text }))].sort((x, y) => y.date.localeCompare(x.date)) };
    },
  },
  {
    name: "growth_checkin", auto: true,
    description: "Log how the user feels right now from what he said: p (pleasant 1-5), e (energy 1-5), and what's behind it.",
    input: { type: "object", properties: { p: { type: "integer", minimum: 1, maximum: 5 }, e: { type: "integer", minimum: 1, maximum: 5 }, why: { type: "array", items: { type: "string" } } }, required: ["p", "e"] },
    run: async (ctx, a) => { const now = new Date(); const d = G.putDoc(dbOf(ctx), "growth_checkins", { id: `ck_${now.getTime().toString(36)}`, date: G.istDate(now), at: now.toISOString(), p: a.p, e: a.e, why: a.why ?? [], by: "wyn" }); return { ok: true, id: d.id }; },
  },
  { name: "growth_status", auto: true, description: "The journal streak (and whether tonight's entry is missing), this week's growth level and rate, last night's dream and this week's review.", input: { type: "object", properties: {} }, run: async (ctx) => summary(ctx) },
  {
    name: "growth_review_draft", auto: true,
    description: "Draft this week's Sunday review from every app's numbers and his journal (wins, misses, three rules, three moves). He walks through it and seals it himself. Uses the subscription model; run it once on Sunday evening or when he asks.",
    input: { type: "object", properties: { force: { type: "boolean" } } },
    run: async (ctx, a) => { const r: any = await draftReviewAI(ctx, { force: !!a.force }); return { week: r.week, headline: r.headline, moves: (r.moves ?? []).map((m: any) => m.text), link: "agenticos://growth/review" }; },
  },
  {
    name: "growth_dream_answer", auto: false,
    description: "Approve or decline one of last night's dream proposals for the user (only after he said so). Yes on a Task or Plan adds it to his tasks for tomorrow; a Goal becomes a week goal; Rules and Rituals are kept on this week's plan.",
    input: { type: "object", properties: { proposal: { type: "string", description: "the proposal id, like r2" }, answer: { type: "string", enum: ["yes", "no"] }, date: { type: "string", description: "the dream's date, default the latest" } }, required: ["proposal", "answer"] },
    run: async (ctx, a) => {
      const db = dbOf(ctx);
      const d = (a.date ? G.listDocs(db, "growth_dreams", "date = ?", a.date)[0] : G.listDocs(db, "growth_dreams", "1 = 1 ORDER BY date DESC LIMIT 1")[0]) as any;
      if (!d) return { ok: false, error: "No dream yet." };
      const p = (d.proposals ?? []).find((x: any) => x.id === a.proposal);
      if (!p) return { ok: false, error: `No proposal ${a.proposal}.` };
      if (p.answer) return { ok: true, already: p.answer };
      let made: any = null;
      if (a.answer === "yes") {
        if (p.kind === "Task" || p.kind === "Plan") { const t = await ctx.agentos(["add", p.title, "--due", G.addDays(G.istDate(), 1), "--notes", `From the dream on ${d.date}: ${p.meta}`]); made = { kind: "task", id: t?.task?.id ?? null }; }
        else if (p.kind === "Goal") { const g = await ctx.agentos(["goals", "add", p.title, "--horizon", "week"]).catch(() => null); made = { kind: "goal", id: g?.goal?.id ?? null }; }
        else { const wk = `week-${G.weekKey(G.istDate())}`; const cur = (G.docOf(db.query("SELECT * FROM growth_plans WHERE id = ?").get(wk)) ?? { id: wk }) as any; G.putDoc(db, "growth_plans", { ...cur, id: wk, rules: [...(cur.rules ?? []), { text: p.title, meta: p.meta, from: `${d.id}:${p.id}`, kind: p.kind }] }); made = { kind: "rule" }; }
      }
      p.answer = a.answer; p.answered_at = new Date().toISOString(); p.by = "wyn"; p.made = made;
      G.putDoc(db, "growth_dreams", { ...d, proposals: d.proposals });
      return { ok: true, answer: a.answer, made };
    },
  },
  {
    name: "growth_plan_day", auto: true,
    description: "Set today's morning plan: up to three task ids (like t12) as 'your three' and a one-line intention. He can change it.",
    input: { type: "object", properties: { three: { type: "array", items: { type: "string" }, maxItems: 3 }, intention: { type: "string" } } },
    run: async (ctx, a) => { const id = `day-${G.istDate()}`; const db = dbOf(ctx); const cur = (G.docOf(db.query("SELECT * FROM growth_plans WHERE id = ?").get(id)) ?? { id }) as any; const d = G.putDoc(db, "growth_plans", { ...cur, id, three: a.three ?? cur.three ?? [], intention: a.intention ?? cur.intention ?? "", planned_at: new Date().toISOString(), by: "wyn" }); return { ok: true, plan: d }; },
  },
];

// ── the module ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const growth: Module = {
  name: "growth",
  async handle(ctx) {
    try { dbOf(ctx); } catch (e) { return ctx.fail(503, `Growth's data isn't set up on your PC yet (${e}).`); }
    const p = ctx.path, m = ctx.method;
    if ((p === "/" || p === "") && m === "GET") return ctx.json({ ok: true, module: "growth", collections: ["journal", "checkins", "reviews", "dreams", "plans", "settings"] });
    if (p === "/state" && m === "GET") return ctx.json(state(ctx));
    if (p === "/summary" && m === "GET") return ctx.json(summary(ctx));
    if (p === "/dream/run" && m === "POST") {
      if (!ctx.owner) return ctx.fail(403, "Only the owner can run the dream.");
      const b = await ctx.body().catch(() => ({}));
      return ctx.json({ item: await runDream(ctx, { date: b?.date, force: !!b?.force }) });
    }
    if (p === "/review/draft" && m === "POST") {
      if (!ctx.owner) return ctx.fail(403, "Only the owner can draft the review.");
      const b = await ctx.body().catch(() => ({}));
      try { return ctx.json({ item: await draftReviewAI(ctx, { force: !!b?.force }) }); }
      catch (e: any) { return ctx.fail(502, `The draft didn't come back: ${String(e?.message ?? e).slice(0, 200)}`); }
    }
    if (p === "/ocr" && m === "POST") {
      const b = await ctx.body().catch(() => null);
      try { return ctx.json(await ocr(ctx, b?.image)); }
      catch (e: any) { return ctx.fail(e?.status ?? 502, String(e?.message ?? e).slice(0, 200)); }
    }
    return (await journal.handle(ctx, "/journal")) ?? (await checkins.handle(ctx, "/checkins")) ?? (await reviews.handle(ctx, "/reviews"))
      ?? (await dreams.handle(ctx, "/dreams")) ?? (await plans.handle(ctx, "/plans")) ?? (await settings.handle(ctx, "/settings")) ?? null;
  },
  jobs: [
    { id: "dream", at: "04:30", catchUpMinutes: 180, retry: { attempts: 2, delayMinutes: 20 }, run: async (ctx) => { await runDream(ctx); } },
    { id: "review-draft", at: "18:00", days: ["sun"], retry: { attempts: 2, delayMinutes: 30 }, run: async (ctx) => { await draftReviewAI(ctx); } },
    { id: "streak-nudge", at: "21:00", catchUpMinutes: 45, run: (ctx) => streakPush(ctx, "nudge") },
    { id: "streak-alarm", at: "22:00", catchUpMinutes: 45, run: (ctx) => streakPush(ctx, "alarm") },
  ],
  tools,
};
