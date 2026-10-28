// Body (v2): workouts and sets, the exercise library, recovery and readiness, meals, AM/PM protocols and programs, face
// scans, and the agent as personal trainer. The tables belong to agentos's body module (cli/src/modules/body.ts);
// the numbers (recovery per muscle, readiness, records, streaks, the rules-based plan) come from the same pure model the
// phone runs offline (app/js/aspects/body-model.js), so the agent and the screen always agree.
//   GET/PUT/POST/DELETE /api/v1/mod/body/{workouts,meals,readings,protocol,checks,programs,scans,settings,exercises}[/<id>]
//   GET  /api/v1/mod/body/library[?lite=1]   the free-exercise-db set (Unlicense, 876 exercises) · /library/<id> one
//   GET  /api/v1/mod/body/today              recovery, readiness, the next plan, food, protocol: what the agent reads
//   POST /api/v1/mod/body/plan               { date?, focus?, minutes?, ai? } → a planned workout (rules, then Claude as PT)
//   POST /api/v1/mod/body/estimate           { text } → grams, kcal and protein in Indian portions
//   POST /api/v1/mod/body/face-read          { image (data URL), angle, baseline? } → measurements (Codex reads the photo)
// Meals that arrive with a name only (Siri, a widget, Wyn) get their numbers from the estimate before they are stored.
// Jobs: the morning plan (05:30) and the protocol nudge (every 15 min, once a day). Tools: see `tools` below.
import type { Database } from "bun:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountCollection } from "./_collection";
import type { AgentTool, JobCtx, ModCtx, Module } from "./types";
import { BODY_COLLECTIONS, migrateBody, listDocs, getDoc, putDoc, library, searchLibrary, mealTotals, istDay, addDays } from "../../cli/src/modules/body.ts";
// @ts-ignore: plain JS shared with the phone
import * as M from "../../app/js/aspects/body-model.js";
// @ts-ignore: plain JS shared with the phone
import { estimate } from "../../app/js/aspects/body-food.js";

const ready = new Set<string>();
const prepare = (db: Database) => { const k = (db as any).filename ?? ""; if (!ready.has(k)) { migrateBody(db); ready.add(k); } };
let libReady = false;
const lib = () => { if (!libReady) { M.setLibrary(library()); libReady = true; } return library(); };
const isDay = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isoOk = (s: unknown) => typeof s === "string" && !Number.isNaN(Date.parse(s));
const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);
const STATUS = ["planned", "live", "done", "skipped"];
const KINDS = ["weight", "sleep", "steps", "rhr", "hrv", "water", "activeEnergy", "vo2"];
const SLOTS = ["breakfast", "lunch", "snack", "dinner", "pre-workout", "post-workout"];
const slotAt = (iso: string) => { const h = new Date(Date.parse(iso) + 330 * 60000).getUTCHours(); return h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 19 ? "snack" : "dinner"; };

// ── a meal is stored with its numbers: a name-only meal gets the estimate (validate fills the doc before the upsert) ──
function normalizeMeal(d: any) {
  if (typeof d.name !== "string" || !d.name.trim()) return "a meal needs a name";
  if (d.at != null && !isoOk(d.at)) return "at is an ISO time";
  d.at = d.at ?? new Date().toISOString();
  d.date = isDay(d.date) ? d.date : istDay(new Date(d.at));
  d.slot = typeof d.slot === "string" && d.slot ? d.slot.toLowerCase() : slotAt(d.at);
  if (d.kcal == null || d.kcal === "") {
    const e = estimate(d.name);
    if (e.items.length) Object.assign(d, { kcal: e.kcal, protein: d.protein ?? e.protein, carbs: d.carbs ?? e.carbs, fat: d.fat ?? e.fat, fibre: d.fibre ?? e.fibre, items: d.items ?? e.items, estimate: true });
    else Object.assign(d, { kcal: 0, protein: d.protein ?? 0, estimate: true, unknown: true });
  }
  for (const k of ["kcal", "protein", "carbs", "fat", "fibre"]) { const v = num(d[k]); if (Number.isNaN(v)) return `${k} is a number`; if (v != null) d[k] = v; }
  return null;
}
const C = BODY_COLLECTIONS;
const mk = (k: keyof typeof C, validate?: (d: any, cur: any) => string | null) => mountCollection({ table: C[k].table, columns: { ...(C[k].columns as any) }, ensure: true, validate });
const COLLS: [string, ReturnType<typeof mountCollection>][] = [
  ["/workouts", mk("workouts", (d) => (!isDay(d.date) ? "date is YYYY-MM-DD" : d.status != null && !STATUS.includes(d.status) ? `status is ${STATUS.join(", ")}` : d.items != null && !Array.isArray(d.items) ? "items is a list" : null))],
  ["/meals", mk("meals", normalizeMeal)],
  ["/readings", mk("readings", (d) => (!KINDS.includes(d.kind) ? `kind is ${KINDS.join(", ")}` : !isDay(d.date) ? "date is YYYY-MM-DD" : !Number.isFinite(Number(d.value)) ? "value is a number" : null))],
  ["/protocol", mk("protocol", (d) => (!["am", "pm"].includes(d.half) ? "half is am or pm" : typeof d.text !== "string" || !d.text.trim() ? "an item needs text" : null))],
  ["/checks", mk("checks", (d) => (!isDay(d.date) ? "date is YYYY-MM-DD" : typeof d.item !== "string" || !d.item ? "item is the protocol item's id" : null))],
  ["/programs", mk("programs", (d) => (d.started != null && !isDay(d.started) ? "started is YYYY-MM-DD" : null))],
  ["/scans", mk("scans", (d) => (!isDay(d.date) ? "date is YYYY-MM-DD" : null))],
  ["/settings", mk("settings")],
  ["/exercises", mk("exercises", (d) => (typeof d.name !== "string" || !d.name.trim() ? "an exercise needs a name" : null))],
];

// ── the state every reader shares: the model over his real docs ──
function state(db: Database, nowMs = Date.now()) {
  prepare(db); lib();
  const today = istDay(new Date(nowMs));
  const docs = listDocs(db, "workouts", "date >= ?", addDays(today, -120));
  const sessions = docs.map(M.normalize);
  const best = M.annotate(sessions);
  const set: Record<string, any> = Object.fromEntries(listDocs(db, "settings").map((d) => [d.id, d]));
  const targets = M.targetsOf(set.targets);
  const fresh = set.fresh?.muscles ?? null;
  const readings = listDocs(db, "readings");
  const rd = M.readiness({ readings, sessions, nowMs, fresh, sleepGoal: targets.sleep });
  const f = M.fatigueAt(sessions, nowMs, { fresh });
  const muscles = Object.keys(M.MUSCLES).map((m) => ({ m, name: M.MUSCLES[m].name, pct: M.pctOf(f, m) })).sort((a, b) => a.pct - b.pct);
  const meals = listDocs(db, "meals", "date = ?", today).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const food = mealTotals(meals);
  const water = listDocs(db, "readings", "kind = 'water' AND date = ?", today)[0]?.value ?? 0;
  const items = listDocs(db, "protocol");
  const checks = listDocs(db, "checks", "date >= ?", addDays(today, -400));
  const proto = M.protocolStreak(items, checks, today);
  const day = M.protocolDay(items, checks, today);
  const done = new Set(checks.filter((c) => c.date === today && c.done).map((c) => c.item));
  const live = sessions.find((s) => s.status === "live") ?? null;
  const planned = sessions.filter((s) => s.status === "planned" && s.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.startMs - b.startMs);
  const auto = M.planNext({ sessions, nowMs, fresh, readinessScore: rd.partial ? null : rd.score });
  const week = M.weekDays(sessions, planned, today);
  return { today, nowMs, sessions, best, targets, fresh, readings, readiness: rd, muscles, meals, food, water, items, checks, proto, day, done, live, planned, auto, week, settings: set };
}
const shortPlan = (p: any) => p && ({ id: p.id, date: p.date, name: p.name, at: p.at ?? null, why: p.why ?? "", reasons: p.reasons ?? [], plan_by: p.plan_by ?? "rules",
  items: (p.items ?? []).map((it: any) => ({ ex: it.ex, name: it.name ?? M.exInfo(it.ex, it).name, sets: it.sets?.length ?? it.sets ?? null, target: it.target ?? null, note: it.note ?? "" })) });
function todayView(s: ReturnType<typeof state>) {
  const doneToday = s.sessions.filter((x) => x.status === "done" && x.date === s.today);
  return {
    today: s.today, readiness: { score: s.readiness.score, word: s.readiness.word, partial: s.readiness.partial, parts: s.readiness.parts.map(({ k, name, v, word, note }: any) => ({ k, name, v, word, note })) },
    recovering: s.muscles.filter((m) => m.pct < 70), fresh: s.muscles.filter((m) => m.pct >= 90).map((m) => m.name),
    trained: doneToday.map((x) => ({ id: x.id, name: x.name, sets: M.sessionSets(x), volume: Math.round(M.sessionVolume(x)) })),
    live: s.live ? { id: s.live.id, name: s.live.name, sets: M.sessionSets(s.live) } : null,
    next: shortPlan(s.planned[0] ?? s.auto), week: { days: s.week.filter((d: any) => d.ss.length).length, target: s.targets.days, streak: M.weekStreak(s.sessions, s.today, s.targets.days) },
    food: { ...s.food, protein_target: s.targets.protein, kcal_target: s.targets.kcal, protein_left: Math.max(0, s.targets.protein - s.food.protein), water: s.water, water_target: s.targets.water },
    meals: s.meals.map((m) => ({ id: m.id, at: String(m.at ?? "").slice(11, 16), slot: m.slot, name: m.name, kcal: m.kcal, protein: m.protein })),
    protocol: { items: s.items.filter((x) => x.active !== false).length, due: s.day.due, done: s.day.done, am: s.day.am, pm: s.day.pm, streak: s.proto.n, pm_due: s.targets.pmDue,
      open: M.dueOn(s.items, s.today).filter((x: any) => !s.done.has(x.id)).map((x: any) => ({ id: x.id, half: x.half, text: x.text })) },
    weight: s.readiness.weight ? { now: s.readiness.weight.now, date: s.readiness.weight.date, goal: s.targets.weight } : null,
    sleep: s.readiness.sleep ? { asleep_min: s.readiness.sleep.asleep, date: s.readiness.sleep.date } : null,
  };
}

// ── the PT: rules first (recovery, his rotation, +2.5 kg / +1 rep), then Claude on his subscription to tailor it ──
const PLAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["name", "split", "why", "reasons", "items"],
  properties: {
    name: { type: "string" }, split: { type: "string", enum: M.ROTATION.map((r: any) => r.split) }, why: { type: "string" },
    reasons: { type: "array", items: { type: "string" }, maxItems: 5 },
    items: { type: "array", minItems: 1, maxItems: 9, items: { type: "object", additionalProperties: false, required: ["ex", "sets", "note"], properties: {
      ex: { type: "string" }, sets: { type: "integer", minimum: 1, maximum: 8 }, w: { type: ["number", "null"] }, r: { type: ["integer", "null"] }, t: { type: ["integer", "null"] }, min: { type: ["integer", "null"] }, note: { type: "string" } } } },
  },
};
// The owner's own training rules (goal, protein, habits) come from PT_RULES in the server env; the default only states the split.
const PT_SYSTEM = `You are Wyn, the owner's personal trainer inside his Agentic OS phone app. You plan one gym session from his real data.
His rules: ${process.env.PT_RULES || "a 6-day split in this order: push, pull, legs + speed, active recovery, hypertrophy, athlete, then rest. Progressive overload of +2.5 kg or +1 rep a week when last time was all done. Be realistic about the time he has."}
You get a rules-based draft built from his per-muscle recovery. Keep its split unless recovery or readiness says otherwise. Never load a muscle under 70% recovered heavily. Use only exercise ids from the allowed list. Weights in kg; null when he has no history (he picks). Notes are one short line each, plain, direct and warm. "why" is one sentence he reads on the card. Reasons are 2 to 4 short facts with numbers from the data. No hype.`;
async function planWorkout(ctx: JobCtx | ModCtx, db: Database, o: { date?: string; focus?: string; minutes?: number; ai?: boolean } = {}) {
  const s = state(db);
  const date = isDay(o.date) ? o.date! : s.auto.date;
  const draft = date === s.auto.date ? s.auto : M.planNext({ sessions: s.sessions, nowMs: s.nowMs, date, fresh: s.fresh, readinessScore: s.readiness.partial ? null : s.readiness.score });
  let plan: any = { ...draft }, by = "rules", note = "";
  if (o.ai !== false) {
    const allowed = [...new Set([...Object.keys(M.EX).filter((k) => !k.startsWith("hk-")), ...draft.items.map((it: any) => it.ex)])];
    const recent = s.sessions.filter((x) => x.status === "done").sort((a, b) => b.startMs - a.startMs).slice(0, 8)
      .map((x) => ({ date: x.date, name: x.name, items: x.items.map((it: any) => ({ ex: it.ex, sets: M.workSets(it).map((y: any) => (y.w != null ? `${y.w}x${y.r}` : y.t != null ? `${y.t}s` : y.min != null ? `${y.min}min` : `${y.r}`)).join(" ") })) }));
    const prompt = JSON.stringify({ date, now: new Date(s.nowMs).toISOString(), readiness: { score: s.readiness.score, partial: s.readiness.partial, parts: s.readiness.parts.map((p: any) => `${p.name}: ${p.v} (${p.note})`) },
      recovery_pct: Object.fromEntries(s.muscles.map((m) => [m.m, m.pct])), recent, minutes: o.minutes ?? null, focus: o.focus ?? null,
      draft: { name: draft.name, split: draft.split, items: draft.items.map((it: any) => ({ ex: it.ex, sets: it.sets, ...it.target, note: it.note })), reasons: draft.reasons }, allowed_exercises: allowed });
    try {
      const r = await ctx.ai.claude({ model: "sonnet", system: PT_SYSTEM, prompt, schema: PLAN_SCHEMA, timeout: 120_000 });
      const out = r.out ?? {};
      const items = (Array.isArray(out.items) ? out.items : []).filter((it: any) => allowed.includes(it.ex)).map((it: any) => {
        const k = M.exInfo(it.ex).kind;
        const target = k === "cardio" ? { min: it.min ?? 20 } : k === "time" ? { t: it.t ?? 30 } : k === "bw" ? { r: it.r ?? 10 } : { w: it.w ?? null, r: it.r ?? 8 };
        return { ...M.itemOf(it.ex), sets: Math.max(1, Math.min(8, Number(it.sets) || 3)), target, note: String(it.note ?? "").slice(0, 160) };
      });
      if (items.length) { plan = { ...draft, name: String(out.name || draft.name).slice(0, 40), split: M.splitOf(out.split) ? out.split : draft.split, why: String(out.why || draft.why).slice(0, 200), reasons: (out.reasons ?? []).map(String).slice(0, 5), items }; by = "wyn"; }
    } catch (e: any) { note = `Claude didn't answer (${String(e?.message ?? e).slice(0, 80)}); this is the rules plan.`; }
  }
  const id = `plan-${date}`;
  const cur = getDoc(db, "workouts", id);
  if (cur && cur.status !== "planned" && !cur.deleted_at) return { plan: shortPlan(M.normalize(cur)), kept: true, note: "That day's session already started; the plan stays as it is." };
  const doc = putDoc(db, "workouts", { id, date, status: "planned", split: plan.split, name: plan.name, at: plan.at ?? null, dur: plan.dur, why: plan.why, reasons: plan.reasons,
    items: plan.items.map((it: any) => ({ ex: it.ex, name: it.name, kind: it.kind, p: it.p, s: it.s, ...(it.lib ? { lib: it.lib } : {}), note: it.note ?? "", target: it.target,
      sets: Array.from({ length: Number(it.sets) || 1 }, () => ({ ...it.target, done: false })) })),
    plan_by: by, source: by === "wyn" ? "wyn" : "rules", started_at: null, ended_at: null, deleted_at: null });
  return { plan: shortPlan(M.normalize(doc)), by, note };
}

// ── the face: Codex reads the photo against his first scan; measurements and direction only, never a rating ──
const FACE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["ok", "skin", "spots", "puff", "cm", "cva", "sym", "note"],
  properties: { ok: { type: "boolean" }, skin: { type: ["integer", "null"] }, spots: { type: ["integer", "null"] }, puff: { type: ["integer", "null"] }, cm: { type: ["integer", "null"] }, cva: { type: ["integer", "null"] }, sym: { type: ["integer", "null"] }, note: { type: "string" } },
};
async function readFace(ctx: ModCtx, body: any) {
  const m = /^data:image\/(jpeg|jpg|png|heic|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body?.image ?? ""));
  if (!m) return ctx.fail(400, "Send the photo as a data URL (image).");
  const angle = body.angle === "side" ? "side" : "front";
  const dir = join(ctx.dataDir, "mod", "body"); mkdirSync(dir, { recursive: true });
  const file = join(dir, `face-${Date.now()}.${m[1] === "png" ? "png" : "jpg"}`);
  writeFileSync(file, Buffer.from(m[2], "base64"));
  try {
    const r = await ctx.codex({ images: [file], sandbox: "read-only", schema: FACE_SCHEMA, timeoutMs: 150_000, prompt: `This is Alex's own ${angle} photo for his weekly progress scan in his Body app. Measure, don't judge.
Return: skin (0-100, how clear and even the skin looks; higher is clearer), spots (count of active spots you can see), puff (0-100, facial puffiness; lower is less puffy), ${angle === "side" ? "cm (the neck-chin angle in degrees from the side; null if the side profile isn't visible), cva (craniovertebral angle in degrees, head posture; null if the neck and shoulder aren't visible)" : "cm and cva as null (they need a side photo)"}, sym (0-100 left-right symmetry of the face as photographed), ok (false if the face isn't clearly visible or the light is too poor to measure; then the numbers may be null), and note: one plain sentence about lighting or angle if it limits the reading, else "".
${body.baseline ? `His first scan, for consistency of scale: ${JSON.stringify(body.baseline)}.` : ""}
Never rate attractiveness, never rank, never compare to other people.` });
    return ctx.json({ ok: true, angle, ...(r.out ?? {}), ms: r.ms });
  } catch (e: any) { return ctx.fail(502, `The photo couldn't be read just now: ${String(e?.message ?? e).slice(0, 120)}`); }
  finally { try { rmSync(file, { force: true }); } catch {} }
}

// ── routes ─────────────────────────────────────────────────────────────
export const body: Module = {
  name: "body",
  async handle(ctx) {
    const p = ctx.path, m = ctx.method;
    if ((p === "/" || p === "") && m === "GET") { const db = ctx.db(); prepare(db); return ctx.json({ ok: true, module: "body", collections: COLLS.map(([k]) => k.slice(1)), library: lib().length }); }
    if (p === "/library" && m === "GET") {
      const lite = ctx.url.searchParams.get("lite") === "1";
      const q = ctx.url.searchParams.get("q"), muscle = ctx.url.searchParams.get("muscle") ?? "";
      const rows = q || muscle ? searchLibrary(q ?? "", muscle, 60) : lib();
      const res = ctx.json({ count: rows.length, img: M.LIB_IMG, items: lite ? rows.map(({ how, ...r }: any) => r) : rows });
      res.headers.set("Cache-Control", "private, max-age=86400");
      return res;
    }
    if (p.startsWith("/library/") && m === "GET") { const id = decodeURIComponent(p.slice(9)); const e = lib().find((x: any) => x.id === id); return e ? ctx.json({ item: e, img: M.LIB_IMG }) : ctx.fail(404, "No such exercise."); }
    if (p === "/today" && m === "GET") return ctx.json(todayView(state(ctx.db())));
    if (p === "/plan" && m === "POST") {
      const b = (await ctx.body().catch(() => ({}))) ?? {};
      if (b.date != null && !isDay(b.date)) return ctx.fail(400, "date is YYYY-MM-DD");
      return ctx.json(await planWorkout(ctx, ctx.db(), { date: b.date, focus: typeof b.focus === "string" ? b.focus.slice(0, 200) : undefined, minutes: Number(b.minutes) || undefined, ai: b.ai !== false }));
    }
    if (p === "/estimate" && m === "POST") {
      const b = (await ctx.body().catch(() => ({}))) ?? {};
      if (typeof b.text !== "string" || !b.text.trim()) return ctx.fail(400, "Say what you ate.");
      return ctx.json(estimate(b.text.slice(0, 400)));
    }
    if (p === "/face-read" && m === "POST") return readFace(ctx, await ctx.body().catch(() => null));
    for (const [base, c] of COLLS) { const r = await c.handle(ctx, base); if (r) return r; }
    return null;
  },
  jobs: [
    { id: "plan", at: "05:30", catchUpMinutes: 240, async run(ctx) {
      const db = ctx.db(); const s = state(db);
      if (s.planned.some((x) => x.date === s.today) || s.sessions.some((x) => x.date === s.today && x.status !== "planned")) return;
      const r = await planWorkout(ctx, db, { ai: ctx.conf("BODY_AI_PLAN", "on") !== "off" });
      ctx.log(`[body] planned ${r.plan?.name} for ${r.plan?.date} (${r.by})`);
    } },
    { id: "protocol", every: "15m", async run(ctx) {
      const db = ctx.db(); const s = state(db);
      const due = M.toMin(s.targets.pmDue) ?? 22 * 60 + 30; const now = M.istMin(s.nowMs);
      if (!s.items.length || s.day.pm || now < due || now > due + 120) return;
      const flag = getDoc(db, "settings", "nudges"); if (flag?.pm === s.today) return;
      const left = M.dueOn(s.items, s.today).filter((x: any) => x.half === "pm" && !s.done.has(x.id));
      await ctx.push("PM protocol", `${left.length} left: ${left.slice(0, 3).map((x: any) => x.text).join(", ")}. Day ${s.proto.kept + 1} of your streak.`, { link: "agenticos://body/looks", aspect: "body" });
      putDoc(db, "settings", { id: "nudges", ...(flag ?? {}), pm: s.today });
    } },
  ],
  tools: [] as AgentTool[],
};

// ── what the agent can do here (DECISIONS 2: these are low-stakes and reversible, so she does them and says so) ──
const db0 = (ctx: JobCtx) => { const db = ctx.db(); prepare(db); lib(); return db; };
const findEx = (q: string) => {
  const s = String(q ?? "").trim(); if (!s) return null;
  if (M.EX[s] || M.libEx(s)) return s;
  const low = s.toLowerCase();
  const cur = Object.entries(M.EX).find(([, e]: any) => e.name.toLowerCase() === low) ?? Object.entries(M.EX).find(([, e]: any) => e.name.toLowerCase().includes(low));
  if (cur) return cur[0];
  return searchLibrary(s, "", 1)[0]?.id ?? null;
};
const restoreTool = (kind: string, id: string, prev: any) => ({ tool: "body_undo", args: { kind, id, prev: prev ?? null } });
body.tools = [
  { name: "summary", description: "Body today in one line: training, recovery, protein left, the protocol streak. For the heartbeat.", input: { type: "object", properties: {} }, auto: true,
    async run(ctx) {
      const v = todayView(state(db0(ctx)));
      const gaps: string[] = [];
      if (v.food.protein_left > 0 && M.istMin() > 17 * 60) gaps.push(`${v.food.protein_left} g protein to go`);
      if (v.protocol.items && !v.protocol.pm && M.istMin() > (M.toMin(v.protocol.pm_due) ?? 1350) - 60) gaps.push(`PM protocol (${v.protocol.open.filter((x: any) => x.half === "pm").length} left)`);
      if (!v.trained.length && v.next?.date === v.today) gaps.push(`${v.next.name} not started`);
      return { line: `${v.trained.length ? `Trained: ${v.trained.map((t) => t.name).join(", ")}` : `Next: ${v.next?.name ?? "rest"}${v.next?.date !== v.today ? ` (${v.next?.date})` : ""}`} · readiness ${v.readiness.score ?? "unknown (no sleep or heart data)"} · protein ${v.food.protein}/${v.food.protein_target} g`,
        gaps, streaks: v.protocol.items ? [{ id: "protocol", label: "AM + PM protocol", n: v.protocol.streak, today: v.protocol.am && v.protocol.pm }] : [] };
    } },
  { name: "today", description: "Everything about his body today: readiness and its contributors, muscles still recovering, the next planned workout, meals and protein, the protocol, weight and sleep.", input: { type: "object", properties: {} }, auto: true,
    async run(ctx) { return todayView(state(db0(ctx))); } },
  { name: "log_meal", description: "Log a meal he ate (from his message, a photo you saw, or a voice note). Indian portions are fine (2 roti, a katori of dal). Leave kcal/protein out to use the estimate.",
    input: { type: "object", required: ["name"], properties: { name: { type: "string" }, slot: { type: "string", enum: SLOTS }, at: { type: "string", description: "ISO time; default now" }, kcal: { type: "number" }, protein: { type: "number" }, carbs: { type: "number" }, fat: { type: "number" } } }, auto: true,
    async run(ctx, a) {
      const db = db0(ctx); const doc: any = { id: `wyn-m-${Date.now().toString(36)}`, name: String(a.name ?? ""), slot: a.slot, at: a.at, kcal: a.kcal, protein: a.protein, carbs: a.carbs, fat: a.fat, source: "wyn", how: "Logged by Wyn" };
      const msg = normalizeMeal(doc); if (msg) return { ok: false, error: msg };
      const m = putDoc(db, "meals", doc); const v = todayView(state(db));
      return { ok: true, id: m.id, say: `Logged ${m.name}: ${Math.round(m.kcal)} kcal, ${Math.round(m.protein ?? 0)} g protein${m.estimate ? " (estimated)" : ""}. ${v.food.protein_left ? `${v.food.protein_left} g to go today.` : "Protein is covered."}`, undo: restoreTool("meals", m.id, null) };
    } },
  { name: "log_sets", description: "Log sets he did (he tells you, or the watch says). Adds them to today's workout, or makes a session for them.",
    input: { type: "object", required: ["exercise", "sets"], properties: { exercise: { type: "string", description: "Body's id (bench, squat, dead-hang…) or the name" }, date: { type: "string" },
      sets: { type: "array", items: { type: "object", properties: { w: { type: "number" }, r: { type: "integer" }, t: { type: "integer" }, min: { type: "number" }, km: { type: "number" }, rpe: { type: "number" } } } } } }, auto: true,
    async run(ctx, a) {
      const db = db0(ctx); const ex = findEx(a.exercise); if (!ex) return { ok: false, error: `I don't know the exercise "${a.exercise}".` };
      const date = isDay(a.date) ? a.date : istDay();
      const sets = (Array.isArray(a.sets) ? a.sets : []).slice(0, 20).map((x: any) => ({ ...(x.w != null ? { w: Number(x.w) } : {}), ...(x.r != null ? { r: Number(x.r) } : {}), ...(x.t != null ? { t: Number(x.t) } : {}), ...(x.min != null ? { min: Number(x.min) } : {}), ...(x.km != null ? { km: Number(x.km) } : {}), ...(x.rpe != null ? { rpe: Number(x.rpe) } : {}), done: true, at: new Date().toISOString() }));
      if (!sets.length) return { ok: false, error: "No sets given." };
      const todays = listDocs(db, "workouts", "date = ? AND status IN ('live', 'done')", date).sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)));
      const cur = todays.find((x) => x.status === "live") ?? todays[0] ?? null;
      const prev = cur ? JSON.parse(JSON.stringify(cur)) : null;
      const items = cur ? [...(cur.items ?? [])] : [];
      const i = items.findIndex((it: any) => it.ex === ex);
      if (i >= 0) items[i] = { ...items[i], sets: [...(items[i].sets ?? []), ...sets] }; else items.push({ ...M.itemOf(ex), sets });
      const doc = cur ? putDoc(db, "workouts", { id: cur.id, items }) : putDoc(db, "workouts", { id: `wyn-w-${date}-${Date.now().toString(36)}`, date, status: "done", name: "Logged with Wyn", split: null, started_at: new Date().toISOString(), ended_at: null, items, source: "wyn" });
      const e = M.exInfo(ex);
      return { ok: true, workout: doc.id, say: `Logged ${sets.length} ${sets.length === 1 ? "set" : "sets"} of ${e.name} to ${doc.name}.`, undo: restoreTool("workouts", doc.id, prev) };
    } },
  { name: "plan_workout", description: "Plan a workout as his PT from recovery, readiness and his split (push, pull, legs + speed, active recovery, hypertrophy, athlete). Replaces that day's plan if it hasn't started.",
    input: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD; default the next training day" }, focus: { type: "string" }, minutes: { type: "integer" } } }, auto: true,
    async run(ctx, a) {
      const db = db0(ctx); const prev = isDay(a.date) ? getDoc(db, "workouts", `plan-${a.date}`) : null;
      const r = await planWorkout(ctx, db, { date: a.date, focus: a.focus, minutes: a.minutes });
      return { ok: true, ...r, say: `Planned ${r.plan?.name} for ${r.plan?.date}: ${r.plan?.why ?? ""}`, undo: restoreTool("workouts", r.plan?.id, prev) };
    } },
  { name: "swap_exercise", description: "Swap an exercise in a planned workout for one that works the same muscles (a machine is taken, something hurts).",
    input: { type: "object", required: ["from"], properties: { from: { type: "string" }, to: { type: "string" }, date: { type: "string" } } }, auto: true,
    async run(ctx, a) {
      const db = db0(ctx); const s = state(db); const date = isDay(a.date) ? a.date : (s.live?.date ?? s.planned[0]?.date ?? s.today);
      const w = s.live?.date === date ? s.live : s.planned.find((x) => x.date === date);
      if (!w) return { ok: false, error: `No planned workout on ${date}. Plan one first.` };
      const from = findEx(a.from); const i = w.items.findIndex((it: any) => it.ex === from || it.name?.toLowerCase() === String(a.from).toLowerCase());
      if (i < 0) return { ok: false, error: `${a.from} isn't in ${w.name}.` };
      const to = a.to ? findEx(a.to) : M.swapsFor(w.items[i].ex)[0]; if (!to) return { ok: false, error: "No swap found." };
      const doc = getDoc(db, "workouts", w.id); const prev = JSON.parse(JSON.stringify(doc));
      const items = [...doc.items]; const old = items[i];
      const g = M.progression(s.sessions, to, old.target?.r ?? 10);
      items[i] = { ...M.itemOf(to), note: `Instead of ${M.exInfo(old.ex, old).name.toLowerCase()}.`, target: g.target, sets: (old.sets ?? []).map((x: any) => (x.done ? x : { ...g.target, done: false })) };
      putDoc(db, "workouts", { id: w.id, items });
      return { ok: true, say: `Swapped ${M.exInfo(old.ex, old).name} for ${M.exInfo(to).name} in ${w.name}.`, undo: restoreTool("workouts", w.id, prev) };
    } },
  { name: "check_protocol", description: "Tick (or untick) an AM or PM protocol item he says he did, e.g. sunscreen, stretching, the evening walk.",
    input: { type: "object", required: ["item"], properties: { item: { type: "string", description: "the item's id or words from its text" }, done: { type: "boolean" }, date: { type: "string" } } }, auto: true,
    async run(ctx, a) {
      const db = db0(ctx); const items = listDocs(db, "protocol").filter((x) => x.active !== false);
      const q = String(a.item ?? "").toLowerCase(); const it = items.find((x) => x.id === a.item) ?? items.find((x) => String(x.text).toLowerCase().includes(q));
      if (!it) return { ok: false, error: `No protocol item like "${a.item}". Items: ${items.map((x) => x.text).join(", ")}` };
      const date = isDay(a.date) ? a.date : istDay(); const id = `${date}:${it.id}`; const prev = getDoc(db, "checks", id);
      putDoc(db, "checks", { id, date, item: it.id, done: a.done !== false, at: new Date().toISOString(), by: "wyn" });
      return { ok: true, say: `${a.done === false ? "Unticked" : "Ticked"} "${it.text}".`, undo: restoreTool("checks", id, prev) };
    } },
  { name: "set_protocol_reminder", description: "Set when his AM or PM protocol is due; she nudges him once if it isn't done by then.",
    input: { type: "object", required: ["half", "at"], properties: { half: { type: "string", enum: ["am", "pm"] }, at: { type: "string", description: "HH:MM" } } }, auto: true,
    async run(ctx, a) {
      if (!/^\d{1,2}:\d{2}$/.test(String(a.at ?? ""))) return { ok: false, error: "at is HH:MM" };
      const db = db0(ctx); const prev = getDoc(db, "settings", "targets");
      const k = a.half === "am" ? "amDue" : "pmDue"; const at = M.hmOf(M.toMin(a.at));
      putDoc(db, "settings", { id: "targets", ...(prev ?? {}), [k]: at });
      return { ok: true, say: `${a.half === "am" ? "AM" : "PM"} protocol is due by ${at} now.`, undo: restoreTool("settings", "targets", prev) };
    } },
  { name: "log_reading", description: "Log a body reading he tells you: weight (kg), sleep (minutes asleep), steps, resting heart rate (rhr, bpm), HRV (ms), water (glasses).",
    input: { type: "object", required: ["kind", "value"], properties: { kind: { type: "string", enum: KINDS }, value: { type: "number" }, date: { type: "string" } } }, auto: true,
    async run(ctx, a) {
      if (!KINDS.includes(a.kind) || !Number.isFinite(Number(a.value))) return { ok: false, error: "kind and a number value" };
      const db = db0(ctx); const date = isDay(a.date) ? a.date : istDay(); const id = `${a.kind}:${date}`; const prev = getDoc(db, "readings", id);
      putDoc(db, "readings", { id, kind: a.kind, date, value: Number(a.value), source: "wyn" });
      return { ok: true, say: `Logged ${a.kind} ${a.value} for ${date}.`, undo: restoreTool("readings", id, prev) };
    } },
  { name: "mark_fresh", description: "Mark a muscle as recovered when he says it feels fresh, so the next plan can use it.",
    input: { type: "object", required: ["muscle"], properties: { muscle: { type: "string", enum: Object.keys(M.MUSCLES) } } }, auto: true,
    async run(ctx, a) {
      if (!M.MUSCLES[a.muscle]) return { ok: false, error: "Unknown muscle." };
      const db = db0(ctx); const prev = getDoc(db, "settings", "fresh");
      putDoc(db, "settings", { id: "fresh", muscles: { ...(prev?.muscles ?? {}), [a.muscle]: new Date().toISOString() } });
      return { ok: true, say: `${M.MUSCLES[a.muscle].name} marked fresh.`, undo: restoreTool("settings", "fresh", prev) };
    } },
  { name: "face_scans", description: "Read his weekly face scans (skin clarity, spots, puffiness, neck-chin angle, head posture) against his first one. Measurements only; never rate his face.",
    input: { type: "object", properties: {} }, auto: false,
    async run(ctx) {
      const rows = listDocs(db0(ctx), "scans").sort((x, y) => String(x.date).localeCompare(String(y.date)));
      return { count: rows.length, first: rows[0] ?? null, last: rows[rows.length - 1] ?? null, scans: rows.map(({ date, angle, skin, spots, puff, cm, cva }) => ({ date, angle, skin, spots, puff, cm, cva })) };
    } },
  { name: "undo", description: "Put back a Body record as it was before one of her actions (used by Undo in her feed).",
    input: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: Object.keys(C) }, id: { type: "string" }, prev: { type: ["object", "null"] } } }, auto: true,
    async run(ctx, a) {
      if (!(a.kind in C) || !a.id) return { ok: false, error: "kind and id" };
      const db = db0(ctx);
      if (a.prev && typeof a.prev === "object") { const { created_at, updated_at, rev, ...rest } = a.prev; putDoc(db, a.kind, { ...rest, id: a.id, deleted_at: rest.deleted_at ?? null }); }
      else putDoc(db, a.kind, { id: a.id, deleted_at: new Date().toISOString() });
      return { ok: true, say: "Put it back." };
    } },
];
