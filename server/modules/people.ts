// People (v2): the one backend for Family, Friends and Romance. The tables and the shared logic belong to agentos's
// people module (cli/src/modules/people.ts), which this file imports.
//   GET/PUT/POST/DELETE /api/v1/mod/people/{persons,moments,plans,ideas,rhythms,dates,journal,drafts,state}[/<id>]
//                         the store contract (server/modules/_collection.ts), offline-first on the phone (svc/store)
//   GET  /api/v1/mod/people/            everyone with how warm each one is (warm · due · drift · none) and their next date
//   GET  /api/v1/mod/people/calendar    calendar events that name a person (past 45 days, next 400): birthdays and plans
//   POST /api/v1/mod/people/calendar/file   files what the calendar knows: past events with someone become moments
//                                       ("from your calendar"), "<Name>'s birthday" becomes their birthday. Idempotent.
// The owner's four example people are seeded on his first request (agentos seedOwner); a member's db starts empty.
// Job: people-calendar at 23:15 (the same filing). Tools: see `tools` below. Nothing here sends a message: drafts are
// stored, and whether she may send one herself (DECISIONS 2) is answered from the person's `allow` list.
import type { Database } from "bun:sqlite";
import { mountCollection } from "./_collection";
import type { AgentTool, JobCtx, ModCtx, Module } from "./types";
import {
  PEOPLE_COLLECTIONS, migratePeople, seedOwner, putDoc, listDocs, getDoc, dropDoc, newId, circle, momentFrom, resolvePeople, findPerson, peopleIn,
  checkMoment, checkPerson, checkDate, nextOf, istDay, istHm, addDays, slug, inferAct, REL_ASPECT, MESSAGE_KINDS, IDEA_KINDS, MODES,
} from "../../cli/src/modules/people.ts";

const ready = new Set<string>();
const readyMem = new WeakMap<Database, number>();
/** The tables (agentos owns them) and, for the owner, the four example people the first time. */
function prepare(db: Database, owner: boolean) {
  const f = String((db as any).filename ?? "");
  const mem = !f || f === ":memory:";
  const k = `${f}:${owner ? 1 : 0}`;
  if (mem ? (readyMem.get(db) ?? 0) >= (owner ? 2 : 1) : ready.has(k)) return;
  migratePeople(db);
  if (owner) seedOwner(db);
  if (mem) readyMem.set(db, owner ? 2 : 1); else ready.add(k);
}

const C = PEOPLE_COLLECTIONS;
const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const coll = (kind: keyof typeof C, validate?: (d: any, cur: any) => string | null) =>
  mountCollection({ table: C[kind].table, columns: { ...(C[kind].columns as any) }, validate });
const COLLS: [string, ReturnType<typeof mountCollection>][] = [
  ["/persons", coll("persons", (d) => checkPerson(d))],
  ["/moments", coll("moments", (d) => (d.deleted_at ? null : checkMoment(d)))],
  ["/plans", coll("plans", (d) => (d.deleted_at || str(d.title) ? null : "a plan needs a title"))],
  ["/ideas", coll("ideas", (d) => (d.deleted_at || str(d.title) ? null : (d.kind && !(IDEA_KINDS as readonly string[]).includes(d.kind) ? `kind is one of ${IDEA_KINDS.join(", ")}` : "an idea needs a title")))],
  ["/rhythms", coll("rhythms", (d) => (d.deleted_at ? null : !str(d.person) ? "a rhythm needs a person" : !(Number.isInteger(Number(d.every)) && Number(d.every) >= 1 && Number(d.every) <= 365) ? "every is 1 to 365 days" : d.mode && !(MODES as readonly string[]).includes(d.mode) ? `mode is one of ${MODES.join(", ")}` : null))],
  ["/dates", coll("dates", (d) => (d.deleted_at ? null : checkDate(d)))],
  ["/journal", coll("journal", (d) => (d.deleted_at || str(d.text) ? null : "a note needs text"))],
  ["/drafts", coll("drafts", (d) => (d.deleted_at || str(d.text) ? null : "a draft needs text"))],
  ["/state", coll("state")],
];

// ── the calendar: events that name someone ───────────────────────────────────────────────────────────────────────
const BIRTHDAY = /^(.+?)['’]s\s+birthday\b/i;
const WORKISH = /\b(payment|invoice|website|software|client|demo|proposal|erp|deploy|meeting with|call with client|gst)\b/i;
type Ev = { id: string; title: string; start: string; end: string; allDay: boolean };
function calendarEvents(ctx: JobCtx, from: string, days: number): (Ev & { date: string })[] {
  try {
    const out = new Map<string, Ev & { date: string }>();
    for (const d of ctx.store.days(from, days)) for (const e of d.events as any[]) if (!out.has(e.id)) out.set(e.id, { ...e, date: d.date });
    return [...out.values()];
  } catch { return []; }
}
function namedEvents(ctx: JobCtx, db: Database, back = 45, ahead = 400) {
  const persons = listDocs(db, "persons");
  const today = istDay();
  return calendarEvents(ctx, addDays(today, -back), back + ahead)
    .filter((e) => !/^sleep$/i.test(e.title ?? ""))
    .map((e) => {
      const b = BIRTHDAY.exec(e.title ?? "");
      const who = b ? persons.filter((p) => [p.name, p.id, ...(p.aliases ?? [])].some((w) => String(w).toLowerCase() === b[1].trim().toLowerCase())) : peopleIn(e.title, persons);
      return { id: e.id, title: e.title, date: e.allDay ? String(e.start).slice(0, 10) : e.date, start: e.start, end: e.end, allDay: !!e.allDay, people: who.map((p) => p.id), kind: b ? "birthday" : "event" };
    })
    .filter((e) => e.people.length);
}
/** File what the calendar knows. Past timed events with a person become moments (once per event); a birthday event sets their birthday. */
export function fileCalendar(ctx: JobCtx, db: Database) {
  const today = istDay(), now = Date.now();
  const filed: string[] = [], birthdays: string[] = [];
  const have = new Set((db.query("SELECT event_id FROM people_moments WHERE event_id IS NOT NULL").all() as any[]).map((r) => r.event_id));
  const persons = listDocs(db, "persons");
  for (const e of namedEvents(ctx, db, 7, 400)) {
    if (e.kind === "birthday") {
      for (const pid of e.people) {
        const cur = listDocs(db, "dates").find((d) => d.kind === "birthday" && (d.people ?? []).length === 1 && d.people[0] === pid);
        if (cur?.md) continue;   // he already set it (or the calendar did): never overwrite
        const p = persons.find((x) => x.id === pid);
        putDoc(db, "dates", { id: cur?.id ?? `dt-bday-${pid}`, kind: "birthday", people: [pid], aspect: p?.aspect ?? null, md: String(e.date).slice(5), annual: true, year: null,
          title: `${p?.name ?? pid}'s birthday`, source: "calendar", event: e.title });
        birthdays.push(pid);
      }
      continue;
    }
    if (e.allDay || have.has(e.id) || WORKISH.test(e.title)) continue;
    const end = Date.parse(e.end), start = Date.parse(e.start);
    if (!(end < now) || !(end - start > 0) || end - start > 8 * 3600e3) continue;
    const ps = persons.filter((p) => e.people.includes(p.id));
    const act = inferAct(e.title) ?? (ps.every((p) => p.aspect === "family") ? "help" : null);
    putDoc(db, "moments", {
      id: `mo-cal-${slug(e.id).slice(-40)}`, date: e.date, at: istHm(new Date(start)), people: e.people, aspect: ps[0]?.aspect ?? "friends", kind: "meet", act,
      minutes: Math.min(240, Math.round((end - start) / 60000)), title: e.title, by: "wyn", source: "calendar", event_id: e.id,
      dinner: act === "meal" && /\bdinner\b/i.test(e.title) ? true : undefined,
    });
    filed.push(e.id);
  }
  return { filed: filed.length, birthdays, today };
}

// ── the agent's tools (DECISIONS 2: low-stakes and reversible = auto; a new person, a rhythm, deleting = ask first) ─
const db0 = (ctx: JobCtx) => { const db = ctx.db(); prepare(db, ctx.owner); return db; };
const fmtPeople = (db: Database, ids: string[]) => ids.map((id) => getDoc(db, "persons", id)?.name ?? id).join(", ");
const tools: AgentTool[] = [
  {
    name: "people_circle", auto: true,
    description: "Who is in his life here (Family, Friends, Romance): each person's rhythm, whether it's warm, due or drifting, the last time they were together and their next date. Read this before talking about someone.",
    input: { type: "object", properties: {} },
    run: async (ctx) => ({ people: circle(db0(ctx)) }),
  },
  {
    name: "people_log_moment", auto: true,
    description: "File a moment with someone from what he said (\"I'm sitting with family\", \"back from momos with Kabir\"). People are ids or names (\"family\" means everyone in Family). Tell him after; he can undo it.",
    input: { type: "object", required: ["said"], properties: {
      said: { type: "string", description: "His words, as he said them" }, people: { type: "string", description: "Comma-separated ids or names; optional when his words name them" },
      title: { type: "string" }, kind: { type: "string", enum: ["meet", "call", "chat"] }, act: { type: "string" }, minutes: { type: "number" },
      date: { type: "string", description: "YYYY-MM-DD, default today" }, at: { type: "string", description: "HH:MM, default now" }, dinner: { type: "boolean" } } },
    run: async (ctx, a) => {
      const db = db0(ctx);
      const r = momentFrom(db, { who: a.people, said: a.said, title: a.title, kind: a.kind, act: a.act, minutes: a.minutes, date: a.date, at: a.at, dinner: a.dinner, by: "wyn", source: "said" });
      if ("error" in r) return { ok: false, error: r.error };
      const m = putDoc(db, "moments", r.doc);
      return { ok: true, moment: { id: m.id, title: m.title, people: m.people, date: m.date, at: m.at }, tell: `Filed in ${m.aspect === "family" ? "Family" : m.aspect === "romance" ? "Romance" : "Friends"}: ${m.title} (${fmtPeople(db, m.people)}). Undo: people_undo_moment ${m.id}.` };
    },
  },
  {
    name: "people_undo_moment", auto: true,
    description: "Take back a moment SHE filed (by: wyn) a moment ago, when he says it was wrong. Deleting one he logged himself asks him first (people_forget_moment).",
    input: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    run: async (ctx, a) => {
      const db = db0(ctx); const m = getDoc(db, "moments", String(a.id));
      if (!m || m.deleted_at) return { ok: false, error: "No such moment." };
      if (m.by !== "wyn") return { ok: false, error: "He logged this one himself: ask him, then use people_forget_moment." };
      dropDoc(db, "moments", m.id); return { ok: true };
    },
  },
  {
    name: "people_together", auto: true,
    description: "He says he's with family right now: start a together session (his phone shows it, the time counts toward today's hour); or end it and file the moment.",
    input: { type: "object", required: ["action"], properties: { action: { type: "string", enum: ["start", "end"] }, people: { type: "string", description: "Default: everyone in Family" }, note: { type: "string" } } },
    run: async (ctx, a) => {
      const db = db0(ctx);
      const cur = getDoc(db, "state", "session:family");
      if (a.action === "start") {
        if (cur?.active) return { ok: true, already: true, since: cur.start };
        const ps = a.people ? resolvePeople(db, a.people).people : listDocs(db, "persons").filter((p) => p.aspect === "family");
        if (!ps.length) return { ok: false, error: "No one in Family yet." };
        const s = putDoc(db, "state", { id: "session:family", active: true, start: new Date().toISOString(), people: ps.map((p) => p.id), by: "wyn" });
        return { ok: true, session: s };
      }
      if (!cur?.active) return { ok: false, error: "No session running." };
      const minutes = Math.max(1, Math.round((Date.now() - Date.parse(cur.start)) / 60000));
      const m = putDoc(db, "moments", { id: newId("mo"), date: istDay(new Date(cur.start)), at: istHm(new Date(cur.start)), people: cur.people, aspect: "family", kind: "meet", act: "talk", minutes,
        title: a.note || "Together", by: "wyn", source: "session" });
      putDoc(db, "state", { id: "session:family", active: false, end: new Date().toISOString() });
      return { ok: true, moment: { id: m.id, minutes } };
    },
  },
  {
    name: "people_file_chat", auto: true,
    description: "File a chat he shared (a screenshot's text, or messages shared in) as a moment with that person, keeping any open plan or promise in it as an open loop.",
    input: { type: "object", required: ["person", "lines"], properties: {
      person: { type: "string" }, lines: { type: "array", items: { type: "object", properties: { from: { type: "string", enum: ["me", "them"] }, text: { type: "string" } } } },
      title: { type: "string" }, loop: { type: "string", description: "An open plan or promise in it, e.g. 'Meet Rohan on Sunday'" }, date: { type: "string" } } },
    run: async (ctx, a) => {
      const db = db0(ctx); const p = findPerson(db, a.person);
      if (!p) return { ok: false, error: `Not in his people: ${a.person}. Adding someone asks him first.` };
      const chat = (a.lines ?? []).slice(0, 12).map((l: any) => [l.from === "me" ? "me" : "them", String(l.text ?? "").slice(0, 300)]);
      const m = putDoc(db, "moments", { id: newId("mo"), date: a.date ?? istDay(), at: istHm(), people: [p.id], aspect: p.aspect, kind: "chat", minutes: 0, title: a.title ?? `A chat with ${p.name}`, chat, loop: a.loop ?? undefined, by: "wyn", source: "chat" });
      return { ok: true, moment: { id: m.id, title: m.title } };
    },
  },
  {
    name: "people_draft_message", auto: true,
    description: "Save a message you drafted for him to someone (Hinglish or English). It shows on their page; he sends it himself unless he allowed you to send this kind of message to this person (the answer says which). This tool never sends anything.",
    input: { type: "object", required: ["person", "text"], properties: { person: { type: "string" }, text: { type: "string" }, kind: { type: "string", enum: [...MESSAGE_KINDS, "plan", "reply", "other"] }, why: { type: "string" }, tone: { type: "string", enum: ["hinglish", "english"] } } },
    run: async (ctx, a) => {
      const db = db0(ctx); const p = findPerson(db, a.person);
      if (!p) return { ok: false, error: `Not in his people: ${a.person}` };
      const kind = a.kind ?? "other";
      const allowed = !!(p.allow?.kinds ?? []).includes(kind);
      const d = putDoc(db, "drafts", { id: newId("dr"), person: p.id, text: String(a.text).slice(0, 1000), kind, why: a.why ?? null, tone: a.tone ?? null, state: "draft", by: "wyn" });
      return { ok: true, draft: { id: d.id }, send: allowed ? "allowed: he lets you send this kind of message to this person; send it with your messaging tool, then tell him" : "not allowed: it waits on their page for him to send" };
    },
  },
  {
    name: "people_add_date", auto: true,
    description: "Keep a date he told you (a birthday, an anniversary, a festival plan). Never guess one. A year-less birthday is MM-DD.",
    input: { type: "object", required: ["people", "kind", "date"], properties: { people: { type: "string" }, kind: { type: "string", enum: ["birthday", "anniversary", "festival", "other"] }, date: { type: "string", description: "YYYY-MM-DD or MM-DD" }, title: { type: "string" } } },
    run: async (ctx, a) => {
      const db = db0(ctx); const { people, missing } = resolvePeople(db, a.people);
      if (!people.length) return { ok: false, error: `Not in his people: ${missing.join(", ")}` };
      const v = String(a.date); const full = /^\d{4}-\d{2}-\d{2}$/.test(v);
      const doc: any = { kind: a.kind, people: people.map((p) => p.id), aspect: people[0].aspect, md: full ? v.slice(5) : v, date: full ? v : null, year: full && a.kind !== "other" ? Number(v.slice(0, 4)) : null,
        annual: a.kind === "birthday" || a.kind === "anniversary", title: a.title ?? (a.kind === "birthday" ? `${people[0].name}'s birthday` : a.kind === "anniversary" ? "Their anniversary" : "A date"), source: "said", by: "wyn" };
      const bad = checkDate(doc); if (bad) return { ok: false, error: bad };
      const same = a.kind === "birthday" ? listDocs(db, "dates").find((d) => d.kind === "birthday" && d.people?.[0] === people[0].id) : null;
      const d = putDoc(db, "dates", { ...(same ? { id: same.id } : { id: newId("dt") }), ...doc });
      return { ok: true, date: { id: d.id, next: nextOf(d, istDay()) } };
    },
  },
  {
    name: "people_add_idea", auto: true,
    description: "Keep an idea for someone: a gift (something they mentioned), a plan beyond the usual, or a small thing to do for them (showup).",
    input: { type: "object", required: ["person", "kind", "title"], properties: { person: { type: "string" }, kind: { type: "string", enum: [...IDEA_KINDS] }, title: { type: "string" }, from: { type: "string", description: "Where it came from, e.g. 'She said her phone is slow'" } } },
    run: async (ctx, a) => {
      const db = db0(ctx); const p = findPerson(db, a.person);
      if (!p) return { ok: false, error: `Not in his people: ${a.person}` };
      const i = putDoc(db, "ideas", { id: newId("id"), person: p.id, aspect: p.aspect, kind: a.kind, title: a.title, from: a.from ?? null, done: false, by: "wyn" });
      return { ok: true, idea: { id: i.id } };
    },
  },
  {
    name: "people_plan", auto: true,
    description: "Pencil in a plan with someone (tentative, on their page and in Plans). It doesn't message anyone or book anything.",
    input: { type: "object", required: ["people", "title"], properties: { people: { type: "string" }, title: { type: "string" }, date: { type: "string" }, slot: { type: "string", description: "e.g. 'Sat 19:00'" } } },
    run: async (ctx, a) => {
      const db = db0(ctx); const { people, missing } = resolvePeople(db, a.people);
      if (!people.length) return { ok: false, error: `Not in his people: ${missing.join(", ")}` };
      if (a.date && !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) return { ok: false, error: "date is YYYY-MM-DD" };
      const pl = putDoc(db, "plans", { id: newId("pl"), people: people.map((p) => p.id), aspect: people[0].aspect, title: a.title, date: a.date ?? null, slot: a.slot ?? null, state: "tentative", by: "wyn" });
      return { ok: true, plan: { id: pl.id } };
    },
  },
  {
    name: "people_romance_note", auto: true,
    description: "File a feeling or a moment he told you into his private Romance journal. It's never quoted outside Romance.",
    input: { type: "object", required: ["text"], properties: { text: { type: "string" }, feel: { type: "string", enum: ["hopeful", "calm", "happy", "curious", "nervous", "low"] }, kind: { type: "string", enum: ["note", "rep"] } } },
    run: async (ctx, a) => {
      const db = db0(ctx);
      const j = putDoc(db, "journal", { id: newId("jn"), date: istDay(), at: istHm(), kind: a.kind === "rep" ? "rep" : "note", by: "wyn", source: "said", feel: a.feel ?? null, text: String(a.text).slice(0, 4000) });
      return { ok: true, id: j.id };
    },
  },
  {
    name: "people_add_person", auto: false,
    description: "Add someone new to his people (Family, Friends or Romance). Ask him first: it reaches a new person.",
    input: { type: "object", required: ["name", "rel"], properties: { name: { type: "string" }, rel: { type: "string", enum: Object.keys(REL_ASPECT) }, role: { type: "string" }, where: { type: "string", description: "Where they met" }, pronoun: { type: "string", enum: ["he", "she", "they"] } } },
    run: async (ctx, a) => {
      const db = db0(ctx);
      const bad = checkPerson(a); if (bad) return { ok: false, error: bad };
      if (findPerson(db, a.name)) return { ok: false, error: `${a.name} is already in his people.` };
      let id = slug(a.name); for (let i = 2; getDoc(db, "persons", id); i++) id = `${slug(a.name)}-${i}`;
      const aspect = REL_ASPECT[a.rel];
      const p = putDoc(db, "persons", { id, name: a.name, rel: a.rel, aspect, role: a.role ?? (a.where ? `Met at ${a.where}` : null), where: a.where ?? null, pronoun: a.pronoun ?? null, file: `people/${aspect}/${id}`, sort: 50 + listDocs(db, "persons").length, added: istDay(), by: "wyn" });
      return { ok: true, person: { id: p.id, aspect } };
    },
  },
  {
    name: "people_set_rhythm", auto: false,
    description: "Set how often he wants to see or talk to someone (every N days; in person, a chat or call, or either). Ask him first.",
    input: { type: "object", required: ["person", "every"], properties: { person: { type: "string" }, every: { type: "number" }, mode: { type: "string", enum: [...MODES] }, title: { type: "string" } } },
    run: async (ctx, a) => {
      const db = db0(ctx); const p = findPerson(db, a.person);
      if (!p) return { ok: false, error: `Not in his people: ${a.person}` };
      const every = Math.round(Number(a.every)); const mode = a.mode ?? "any";
      if (!(every >= 1 && every <= 365)) return { ok: false, error: "every is 1 to 365 days" };
      const cur = listDocs(db, "rhythms").filter((r) => r.person === p.id && !r.dinner).sort((x, y) => (x.sort ?? 9) - (y.sort ?? 9))[0];
      const base = every === 7 ? "Every week" : every === 14 ? "Every two weeks" : every === 30 ? "Every month" : `Every ${every} days`;
      const r = putDoc(db, "rhythms", { ...(cur ? { id: cur.id } : { id: `rh-${p.id}-${Date.now().toString(36)}`, sort: 1 }), person: p.id, every, mode, title: a.title ?? cur?.title ?? `See ${p.name}`,
        label: `${base}${mode === "meet" ? ", in person" : mode === "talk" ? ", a chat or a call" : ""}`, source: "you" });
      return { ok: true, rhythm: { id: r.id, label: r.label } };
    },
  },
  {
    name: "people_allow_messages", auto: false,
    description: `Change which kinds of small message you may send to a person on your own (${MESSAGE_KINDS.join(", ")}). Only when he asks for it.`,
    input: { type: "object", required: ["person", "kinds"], properties: { person: { type: "string" }, kinds: { type: "array", items: { type: "string", enum: [...MESSAGE_KINDS] } } } },
    run: async (ctx, a) => {
      const db = db0(ctx); const p = findPerson(db, a.person);
      if (!p) return { ok: false, error: `Not in his people: ${a.person}` };
      const kinds = (a.kinds ?? []).filter((k: string) => (MESSAGE_KINDS as readonly string[]).includes(k));
      putDoc(db, "persons", { id: p.id, allow: { kinds, at: new Date().toISOString() } });
      return { ok: true, allow: kinds };
    },
  },
  {
    name: "people_forget_moment", auto: false,
    description: "Delete a moment from the journal. Ask him first.",
    input: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    run: async (ctx, a) => { const db = db0(ctx); return dropDoc(db, "moments", String(a.id)) ? { ok: true } : { ok: false, error: "No such moment." }; },
  },
];

export const people: Module = {
  name: "people",
  async handle(ctx: ModCtx) {
    let db: Database;
    try { db = ctx.db(); prepare(db, ctx.owner); } catch (e: any) { return ctx.fail(503, `People isn't set up on your PC yet: ${String(e?.message ?? e).slice(0, 120)}`); }
    const p = ctx.path, m = ctx.method;
    if ((p === "/" || p === "") && m === "GET") return ctx.json({ today: istDay(), people: circle(db) });
    if (p === "/calendar" && m === "GET") {
      const back = Math.min(120, Math.max(0, Number(ctx.url.searchParams.get("back") ?? 45)));
      const ahead = Math.min(500, Math.max(1, Number(ctx.url.searchParams.get("ahead") ?? 400)));
      return ctx.json({ today: istDay(), items: namedEvents(ctx, db, back, ahead) });
    }
    if (p === "/calendar/file" && m === "POST") return ctx.json(fileCalendar(ctx, db));
    for (const [path, c] of COLLS) { const r = await c.handle(ctx, path); if (r) return r; }
    return null;
  },
  jobs: [{
    id: "people-calendar", at: "23:15", catchUpMinutes: 180,
    run: async (ctx) => { const db = ctx.db(); prepare(db, ctx.owner); const r = fileCalendar(ctx, db); if (r.filed || r.birthdays.length) ctx.log(`calendar: filed ${r.filed} moments, ${r.birthdays.length} birthdays`); },
  }],
  tools,
};
