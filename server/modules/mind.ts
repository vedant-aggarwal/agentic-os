// Mind: screen time, books and reading sessions, courses and lessons, the evening check-in. (v2)
// The tables and the logic are the agentos CLI module's (cli/src/modules/mind.ts); this file serves them to the phone.
//   collections (svc/store contract, _collection.ts): /books /sessions /highlights /courses /lessons /checkins /screen /apps
//   GET  /day?date=           the day: apps with hours and visits (PC ribbon + his entries), the usual day, kinds,
//                              tonight's blocks with labels and a first guess, the check-in, the streak, sources
//   GET  /days?from=&to=      per date: total, kinds (after the check-in), answered (the week and month views)
//   GET  /isbn/<isbn>         a book from its barcode (Open Library, then Google Books; no key)
//   POST /checkin/guess       Wyn's guesses for tonight's blocks (Claude Haiku on the subscription), stored on the check-in
//   POST /import-courses      re-import the Skool lessons (read only from the old Agentic OS data)
// Jobs: rollup every 15 min (PC samples → per app and hour), Wyn's guesses at 21:00, the check-in nudge at 21:20.
// Tools: log reading, log learning, answer the check-in, park/unpark a course, add a book, log screen time, read the day.
import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mountCollection, type Collection } from "./_collection";
import type { AgentTool, JobCtx, ModCtx, Module } from "./types";
import {
  addBook, addDays, answered, appByName, blocksFor, checkinId, dayApps, daySummary, fileCheckin, findCourse, getDoc, importCourses, istDateOf,
  kindsOf, lessonDone, listDocs, logReading, migrate, newId, putDoc, rollup, setCourse, streak, usual, DEFAULT_DATA, appInfo, overrides, bounds,
} from "../../cli/src/modules/mind.ts";

const ready = new WeakSet<Database>();
// first use on a PC: the tables, and his Skool classroom from the old Agentic OS data when no course is there yet
const dbOf = (ctx: { db: () => Database; conf?: (k: string, d: string) => string; log?: (m: string) => void }) => {
  const db = ctx.db();
  if (ready.has(db)) return db;
  migrate(db); ready.add(db);
  try {
    const dir = ctx.conf?.("mind.coursesDir", DEFAULT_DATA) ?? DEFAULT_DATA;
    if (!db.query("SELECT 1 FROM mind_courses LIMIT 1").get() && existsSync(`${dir}/learn-ai.json`)) { const r = importCourses(db, { dir }); ctx.log?.(`mind: imported ${r.courses} courses, ${r.lessons} lessons`); }
  } catch (e: any) { ctx.log?.(`mind: course import skipped: ${e?.message ?? e}`); }
  return db;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_OK = new Set(["work", "learning", "social", "entertainment"]);
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

const C: Record<string, Collection> = {
  books: mountCollection({ table: "mind_books", columns: { title: "text", author: "text", status: "text", isbn: "text", pages: "integer", page: "integer" },
    validate: (d) => (typeof d.title === "string" && d.title.trim() ? (d.status && !["reading", "paused", "next", "done"].includes(d.status) ? "status is reading, paused, next or done" : null) : "A book needs a title.") }),
  sessions: mountCollection({ table: "mind_sessions", columns: { kind: "text", date: "text", book: "text", course: "text", lesson: "text", minutes: "real" },
    validate: (d) => (!DATE.test(String(d.date ?? "")) ? "date is YYYY-MM-DD" : d.minutes != null && !num(d.minutes) ? "minutes is a number" : null) }),
  highlights: mountCollection({ table: "mind_highlights", columns: { book: "text", kind: "text" }, validate: (d) => (typeof d.text === "string" && d.text.trim() ? null : "A highlight needs text.") }),
  courses: mountCollection({ table: "mind_courses", columns: { title: "text", status: "text", source: "text", position: "integer" } }),
  lessons: mountCollection({ table: "mind_lessons", columns: { course: "text", n: "integer", status: "text" } }),
  checkins: mountCollection({ table: "mind_checkins", columns: { date: "text" }, validate: (d) => (DATE.test(String(d.date ?? "")) ? null : "date is YYYY-MM-DD") }),
  screen: mountCollection({ table: "mind_screen", columns: { date: "text", hour: "integer", app: "text", minutes: "real", source: "text" },
    validate: (d) => (!DATE.test(String(d.date ?? "")) ? "date is YYYY-MM-DD" : !num(d.minutes) || d.minutes < 0 || d.minutes > 1440 ? "minutes is 0 to 1440" : !d.app ? "Which app?" : d.source === "pc" ? "PC rows come from the PC" : null) }),
  apps: mountCollection({ table: "mind_apps", columns: { kind: "text" }, validate: (d) => (d.kind && !KIND_OK.has(d.kind) ? "kind is work, learning, social or entertainment" : null) }),
};

// ── the day ──────────────────────────────────────────────────────────────────
function day(db: Database, date: string) {
  const today = istDateOf();
  if (date === today || date === addDays(today, -1)) rollup(db, date);
  const apps = dayApps(db, date);
  const ci = getDoc(db, "mind_checkins", checkinId(date));
  const done = new Set(listDocs(db, "mind_checkins").filter(answered).map((d) => d.date));
  const u = usual(db, date);
  const asked = apps.filter((a) => a.ask).slice(0, 6).map((a) => a.id);
  const usualApp: Record<string, Record<number, number>> = {};
  for (const id of asked) {
    const days = [7, 14, 21, 28].map((n) => addDays(date, -n)).map((d) => listDocs(db, "mind_screen", "date = ? AND app = ?", d, id)).filter((r) => r.length);
    if (!days.length) continue;
    const h: Record<number, number> = {};
    for (const rows of days) for (const r of rows) h[r.hour] = (h[r.hour] ?? 0) + Number(r.minutes || 0) / days.length;
    for (const k of Object.keys(h)) h[+k] = Math.round(h[+k]);
    usualApp[id] = h;
  }
  const hasPc = !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ribbon_samples'").get()
    && !!db.query("SELECT 1 FROM ribbon_samples WHERE at >= ? LIMIT 1").get(new Date(Date.now() - 7 * 864e5).toISOString());
  return {
    date, at: new Date().toISOString(),
    apps: apps.map(({ titles, ...a }) => ({ ...a, titles: titles.slice(0, 3).map(([t, m]) => [t.slice(0, 80), m]) })),
    manualIds: listDocs(db, "mind_screen", "date = ? AND source != 'pc'", date).map((r) => r.id),
    usual: u, usualApp,
    kinds: kindsOf(apps, answered(ci) ? ci.answers : null), before: kindsOf(apps, null),
    blocks: blocksFor(apps, ci?.deleted_at ? null : ci), checkin: ci?.deleted_at ? null : ci, streak: streak(done, date),
    sources: { pc: hasPc, screenTime: false, manual: apps.some((a) => a.source !== "pc") },
  };
}
function days(db: Database, from: string, to: string) {
  const today = istDateOf();
  if (to >= today) rollup(db, today);
  // days from before Mind ran: roll up the PC's samples once
  const hasRibbon = !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ribbon_samples'").get();
  for (let d = from, n = 0; hasRibbon && d < today && n < 62; d = addDays(d, 1), n++) {
    if (db.query("SELECT 1 FROM mind_screen WHERE date = ? AND source = 'pc' LIMIT 1").get(d)) continue;
    const { from: f, to: t } = bounds(d);
    if (db.query("SELECT 1 FROM ribbon_samples WHERE at >= ? AND at < ? AND process != 'idle' LIMIT 1").get(f, t)) rollup(db, d);
  }
  const over = overrides(db);
  const cis = new Map(listDocs(db, "mind_checkins", "date >= ? AND date <= ?", from, to).map((d) => [d.date, d]));
  const rows = listDocs(db, "mind_screen", "date >= ? AND date <= ?", from, to);
  const out = [];
  for (let d = from, n = 0; d <= to && n < 62; d = addDays(d, 1), n++) {
    const by = new Map<string, number>();
    for (const r of rows) if (r.date === d) by.set(String(r.app), (by.get(String(r.app)) ?? 0) + Number(r.minutes || 0));
    const apps = [...by].map(([id, m]) => ({ ...appInfo(id, over.get(id)), minutes: Math.round(m) }));
    const ci = cis.get(d);
    out.push({ date: d, total: apps.reduce((s, a) => s + a.minutes, 0), kinds: kindsOf(apps, answered(ci) ? ci.answers : null), answered: answered(ci) });
  }
  return out;
}

// ── books from a barcode ─────────────────────────────────────────────────────
async function isbn(code: string) {
  const c = code.replace(/[^0-9Xx]/g, "");
  if (!/^(\d{9}[\dXx]|\d{13})$/.test(c)) return { error: "That isn't an ISBN." };
  const get = async (u: string) => { const r = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "AgenticOS/2.0 (personal)" } }); return r.ok ? r.json() : null; };
  let out: any = null;
  try {
    const ol: any = await get(`https://openlibrary.org/api/books?bibkeys=ISBN:${c}&format=json&jscmd=data`);
    const b = ol?.[`ISBN:${c}`];
    if (b?.title) out = { isbn: c, title: b.title, author: (b.authors ?? []).map((a: any) => a.name).join(", ") || null, pages: b.number_of_pages ?? null, cover: b.cover?.medium ?? null, source: "openlibrary" };
  } catch {}
  if (!out?.author || !out?.pages) try {
    const q: any = await get(`https://openlibrary.org/search.json?isbn=${c}&fields=title,author_name,number_of_pages_median,cover_i&limit=3`);
    const d = (q?.docs ?? []).find((x: any) => x.author_name?.length) ?? q?.docs?.[0];
    if (d?.title) out = { isbn: c, title: out?.title ?? d.title, author: out?.author ?? ((d.author_name ?? []).join(", ") || null), pages: out?.pages ?? d.number_of_pages_median ?? null,
      cover: out?.cover ?? (d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null), source: "openlibrary" };
  } catch {}
  if (!out?.author || !out?.pages) try {
    const g: any = await get(`https://www.googleapis.com/books/v1/volumes?q=isbn:${c}`);
    const v = g?.items?.[0]?.volumeInfo;
    if (v?.title) out = { isbn: c, title: out?.title ?? v.title, author: out?.author ?? ((v.authors ?? []).join(", ") || null), pages: out?.pages ?? v.pageCount ?? null,
      cover: out?.cover ?? v.imageLinks?.thumbnail?.replace(/^http:/, "https:") ?? null, source: out ? `${out.source}+google` : "google" };
  } catch {}
  if (out) return out;
  return { isbn: c, title: null, error: "No book found for that barcode. Type the title instead." };
}

// ── Wyn's guesses for tonight (Claude Haiku on the subscription) ───────────────
const GUESS_SCHEMA = { type: "object", properties: { blocks: { type: "array", items: { type: "object", properties: {
  app: { type: "string" }, split: { type: "array", items: { type: "object", properties: { label: { type: "string" }, share: { type: "number" } }, required: ["label", "share"] } }, why: { type: "string" } },
  required: ["app", "split", "why"] } } }, required: ["blocks"] };
async function guess(ctx: JobCtx | ModCtx, date: string, { force = false } = {}) {
  const db = dbOf(ctx);
  rollup(db, date);
  const apps = dayApps(db, date);
  const ci = getDoc(db, "mind_checkins", checkinId(date));
  if (answered(ci)) return { skipped: "answered" };
  if (!force && ci?.guess_at && Date.now() - Date.parse(ci.guess_at) < 3 * 3600e3) return { skipped: "fresh", guess: ci.guess };
  const blocks = blocksFor(apps, null);
  if (!blocks.length) return { skipped: "nothing to ask" };
  putDoc(db, "mind_checkins", { id: checkinId(date), date, guess_at: new Date().toISOString() });   // one run at a time, across servers
  const name = (db.query("SELECT value FROM settings WHERE key = 'wyn.name'").get() as any)?.value ?? "Wyn";
  const system = `You are ${name}, Alex's assistant: warm, direct, never preachy. At the end of the day you guess what his biggest blocks of screen time were for, so he only has to confirm.
For each block, use only the evidence given (window titles with minutes, the times of his visits) to split its minutes over one to three of that block's label ids (shares add up to 1).
"why" is one short sentence to him in the second person naming the evidence (a title, the time). If the evidence is thin, say so plainly and keep to the safest label. Never invent details.`;
  const input = blocks.map((b) => { const a = apps.find((x) => x.id === b.app)!; return { app: b.app, name: b.name, minutes: b.min, when: b.when,
    labels: b.labels.map((l) => ({ id: l.id, name: l.name })), titles: a.titles.slice(0, 10).map(([t, m]) => ({ title: t.slice(0, 100), minutes: m })), visits: a.sessions.slice(0, 12).map(([s, m]) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")} for ${m}m`) }; });
  try {
    const r = await ctx.ai.claude({ model: "haiku", system, prompt: `Date: ${date}\nBlocks:\n${JSON.stringify(input)}`, schema: GUESS_SCHEMA, timeout: 90_000 });
    const out: Record<string, any> = {};
    for (const g of r.out?.blocks ?? []) {
      const b = blocks.find((x) => x.app === g.app); if (!b) continue;
      const split = (g.split ?? []).filter((s: any) => b.labels.some((l) => l.id === s.label) && s.share > 0).map((s: any) => [s.label, s.share]);
      if (split.length) out[g.app] = { split, why: String(g.why ?? "").slice(0, 220), by: "wyn" };
    }
    const doc = putDoc(db, "mind_checkins", { id: checkinId(date), date, guess: out, guess_by: "wyn", guess_at: new Date().toISOString() });
    ctx.log(`mind: ${Object.keys(out).length} guesses for ${date} in ${r.ms} ms`);
    return { ok: true, guess: doc.guess };
  } catch (e: any) {
    putDoc(db, "mind_checkins", { id: checkinId(date), date, guess_at: null });
    ctx.log(`mind: guess failed: ${e?.message ?? e}`);
    return { ok: false, error: String(e?.message ?? e) };
  }
}

// ── the agent's tools ─────────────────────────────────────────────────────────
const S = (o: Record<string, unknown>, req: string[] = []) => ({ type: "object", properties: o, required: req });
const tools: AgentTool[] = [
  { name: "mind_today", auto: true, description: "What Alex's day in Mind looks like: screen time by app and kind, tonight's check-in blocks with first guesses, reading and learning so far.",
    input: S({ date: { type: "string", description: "YYYY-MM-DD, default today" } }),
    run: async (ctx, a) => { const db = dbOf(ctx); const d = a?.date ?? istDateOf(); rollup(db, d); return daySummary(db, d); } },
  { name: "mind_log_reading", auto: true, description: "Log a reading session he told you about (\"read Atomic Habits for 30 minutes\", \"10 pages of Deep Work\", \"I'm on page 140\"). Moves the book's page; a new title is added to his library.",
    input: S({ book: { type: "string" }, minutes: { type: "number" }, pages: { type: "number", description: "pages read" }, to_page: { type: "number", description: "the page he stopped at" }, date: { type: "string" } }, ["book"]),
    run: async (ctx, a) => { const r = logReading(dbOf(ctx), { book: String(a.book), minutes: a.minutes, pages: a.pages, to: a.to_page, date: a.date, source: "agent" }); return { ok: true, book: { id: r.book.id, title: r.book.title, page: r.book.page, pages: r.book.pages, status: r.book.status }, minutes: r.session.minutes, undo: { collection: "mind/sessions", id: r.session.id } }; } },
  { name: "mind_log_learning", auto: true, description: "Log learning he told you about: a course lesson (marks it watched) or anything else he learned or watched (a video, a podcast, a class) with minutes.",
    input: S({ course: { type: "string", description: "course name, if it was a lesson" }, lesson: { type: "string", description: "lesson title or id" }, what: { type: "string" }, minutes: { type: "number" }, kind: { type: "string", enum: ["lesson", "watched", "listened", "class"] }, date: { type: "string" } }),
    run: async (ctx, a) => {
      const db = dbOf(ctx);
      if (a.course || a.lesson) {
        const c = a.course ? findCourse(db, String(a.course)) : null;
        const ls = listDocs(db, "mind_lessons", c ? "course = ?" : "1 = 1", ...(c ? [c.id] : []));
        const w = String(a.lesson ?? "").toLowerCase();
        const l = (w && (ls.find((x) => x.id === a.lesson || x.id === `l.${a.lesson}`) ?? ls.find((x) => String(x.title).toLowerCase() === w) ?? ls.find((x) => String(x.title).toLowerCase().includes(w))))
          || (c ? ls.sort((x, y) => x.n - y.n).find((x) => x.status !== "done") : null);
        if (l) { const r = lessonDone(db, l.id, { minutes: a.minutes, source: "agent", date: a.date }); return { ok: true, lesson: { id: l.id, title: l.title }, minutes: r.session.minutes }; }
      }
      const s = putDoc(db, "mind_sessions", { id: newId("ses"), kind: a.kind ?? "watched", date: a.date ?? istDateOf(), at: new Date().toISOString(), minutes: Number(a.minutes) || 20, title: a.what ?? a.lesson ?? null, source: "agent" });
      return { ok: true, session: { id: s.id, kind: s.kind, minutes: s.minutes, title: s.title } };
    } },
  { name: "mind_answer_checkin", auto: true, description: "Answer tonight's screen-time check-in for him from what he said (\"Instagram was mostly research for reels\"). Use mind_today first for the blocks and their label ids; give minutes per label. Tell him what you filed.",
    input: S({ date: { type: "string" }, answers: { type: "array", items: S({ app: { type: "string" }, label: { type: "string" }, minutes: { type: "number" } }, ["app", "label", "minutes"]) }, note: { type: "string" } }, ["answers"]),
    run: async (ctx, a) => {
      const by: Record<string, [string, number][]> = {};
      for (const x of a.answers ?? []) (by[appByName(String(x.app))] ??= []).push([String(x.label), Number(x.minutes)]);
      const ci = fileCheckin(dbOf(ctx), a.date ?? istDateOf(), by, { source: "agent", note: a.note });
      return { ok: true, date: ci.date, answers: ci.answers, filed_at: ci.at };
    } },
  { name: "mind_park_course", auto: true, description: "Park a course (take it off what he's doing now) or unpark it (put it back in progress). One course at a time is his default.",
    input: S({ course: { type: "string" }, park: { type: "boolean", description: "true to park, false to unpark" } }, ["course", "park"]),
    run: async (ctx, a) => { const c = setCourse(dbOf(ctx), String(a.course), a.park === false ? "active" : "parked"); return { ok: true, course: { id: c.id, title: c.title, status: c.status } }; } },
  { name: "mind_add_book", auto: true, description: "Add a book to his library (up next, or reading now).",
    input: S({ title: { type: "string" }, author: { type: "string" }, pages: { type: "number" }, isbn: { type: "string" }, status: { type: "string", enum: ["next", "reading", "paused", "done"] }, why: { type: "string" } }, ["title"]),
    run: async (ctx, a) => addBook(dbOf(ctx), { title: a.title, author: a.author, pages: a.pages, isbn: a.isbn, status: a.status ?? "next", why: a.why }) },
  { name: "mind_log_screen_time", auto: true, description: "Record phone screen time he told you about (until Screen Time is switched on, the phone can't see it): an app and minutes, optionally the hour.",
    input: S({ app: { type: "string" }, minutes: { type: "number" }, hour: { type: "number", description: "0-23" }, date: { type: "string" } }, ["app", "minutes"]),
    run: async (ctx, a) => { const r = putDoc(dbOf(ctx), "mind_screen", { id: newId("scr"), date: a.date ?? istDateOf(), hour: a.hour ?? null, app: appByName(String(a.app)), minutes: Number(a.minutes), source: "manual", device: "phone" }); return { ok: true, id: r.id, app: r.app, minutes: r.minutes }; } },
];

export const mind: Module = {
  name: "mind",
  async handle(ctx) {
    const p = ctx.path, m = ctx.method;
    if (p === "/" && m === "GET") return ctx.json({ ok: true, module: "mind" });
    for (const [k, c] of Object.entries(C)) if (p === `/${k}` || p.startsWith(`/${k}/`)) { try { dbOf(ctx); } catch {} const r = await c.handle(ctx, `/${k}`); if (r) return r; }
    const db = dbOf(ctx);
    if (p === "/day" && m === "GET") {
      const date = ctx.url.searchParams.get("date") || istDateOf();
      if (!DATE.test(date)) return ctx.fail(400, "date is YYYY-MM-DD");
      return ctx.json(day(db, date));
    }
    if (p === "/days" && m === "GET") {
      const to = ctx.url.searchParams.get("to") || istDateOf(), from = ctx.url.searchParams.get("from") || addDays(to, -6);
      if (!DATE.test(from) || !DATE.test(to) || from > to) return ctx.fail(400, "from and to are YYYY-MM-DD, from first");
      return ctx.json({ days: days(db, from, to) });
    }
    const im = /^\/isbn\/([0-9Xx-]{10,17})$/.exec(p);
    if (im && m === "GET") return ctx.json(await isbn(im[1]));
    if (p === "/checkin/guess" && m === "POST") {
      if (!ctx.owner) return ctx.fail(403, "Only the owner's agent guesses.");
      const b = await ctx.body().catch(() => ({}));
      return ctx.json(await guess(ctx, DATE.test(String(b?.date ?? "")) ? b.date : istDateOf(), { force: !!b?.force }));
    }
    if (p === "/import-courses" && m === "POST") {
      if (!ctx.owner) return ctx.fail(403, "Owner only.");
      try { return ctx.json(importCourses(db, { dir: ctx.conf("mind.coursesDir", DEFAULT_DATA) })); } catch (e: any) { return ctx.fail(400, e?.message ?? String(e)); }
    }
    return null;
  },
  jobs: [
    { id: "rollup", every: "15m", run: async (ctx) => { const db = dbOf(ctx); rollup(db, istDateOf()); } },
    { id: "guess", at: "21:00", catchUpMinutes: 120, run: async (ctx) => { await guess(ctx, istDateOf()); } },
    { id: "nudge", at: "21:20", catchUpMinutes: 90, run: async (ctx) => {
      const db = dbOf(ctx); const d = istDateOf();
      const ci = getDoc(db, "mind_checkins", checkinId(d));
      if (answered(ci)) return;
      const blocks = blocksFor(dayApps(db, d), ci);
      if (!blocks.length) return;
      await ctx.push("Tonight’s check-in", `${blocks.map((b) => b.name).join(", ")}: what were they for? Two taps each.`, { link: "mind/checkin" });
    } },
  ],
  tools,
};
