// Proposals: Plan my day, reading a capture line, sorting the inbox. Code works out the time (free gaps,
// container blocks like "Corner Market (Deep Work)", tomorrow); Claude only picks what goes where and why.
// Every answer is saved as a batch in the user's agentos DB (schema v6, ai_batches / ai_proposals), and the
// phone reports which proposals were kept or removed. The phone applies kept ones through the normal sync.
import { ApiError, istDate, type Store } from "./store";
import type { AI } from "./ai";

const bad = (m: string) => new ApiError(400, m);
const iso = () => new Date().toISOString();
const DAY = 1440;
// Blocks already set aside for work. Specific ones (deep work, strategy) take their own area's tasks;
// general ones (hustle, side projects, buffer, free time) take any.
const CONTAINER = /deep work|strategy|hustle|side project|buffer|free time/i;
const GENERAL = /hustle|side project|buffer|free time/i;
// Used when the account has no rules of its own (`agentos ai rules "<text>"` overrides it). PLAN_OWNER_RULES in the
// environment sets the owner's default (e.g. "Client work comes before other desk work."); unset, there is none.
const OWNER_RULES = process.env.PLAN_OWNER_RULES?.trim() || null;

type Slot = { s: number; e: number };
type Box = { title: string; area: string | null; general: boolean; cur: number; e: number };
type Ghost = { pid: string | null; taskId: string | null; newTask: { title: string; area: string | null } | null;
  date: string; s: number; e: number; why: string };

const minOf = (isoStr: string, date: string) => (Date.parse(isoStr) - Date.parse(`${date}T00:00:00+05:30`)) / 60000;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const up15 = (m: number) => Math.ceil(m / 15) * 15;
const addDays = (date: string, n: number) => istDate(new Date(Date.parse(`${date}T12:00:00+05:30`) + n * 864e5));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The same day model the phone draws: the window between the sleep blocks, what is busy, free gaps and containers. */
export function dayModel(b: any, date: string, from: number | null) {
  const day = b.week.days.find((d: any) => d.date === date);
  if (!day) return null;
  const items: { kind: string; title: string; area: string | null; s: number; e: number }[] = [];
  for (const ev of day.events) if (!ev.allDay) items.push({ kind: "event", title: ev.title, area: ev.area, s: minOf(ev.start, date), e: minOf(ev.end, date) });
  for (const t of b.today.tasks) {
    if (!t.scheduled || t.status === "dropped") continue;
    const s = minOf(t.scheduled.start, date);
    if (s < 0 || s >= DAY) continue;
    items.push({ kind: "task", title: t.title, area: t.area, s, e: minOf(t.scheduled.end, date) });
  }
  let top: any = null, bottom: any = null;
  for (const it of items) {
    if (it.kind !== "event") continue;
    if (it.s < 0 && it.e > 0 && (!top || it.e > top.e)) top = it;
    if (it.e > DAY && it.s < DAY && (!bottom || it.s < bottom.s)) bottom = it;
  }
  const inner = items.filter((it) => it !== top && it !== bottom && it.e > 0 && it.s < DAY);
  const ws = top ? top.e : Math.min(7 * 60, ...inner.map((i) => Math.floor(i.s / 60) * 60));
  const we = bottom ? bottom.s : Math.max(22 * 60, ...inner.map((i) => Math.ceil(i.e / 60) * 60));
  const start = up15(Math.max(ws, from ?? ws));
  const busy = inner.map((i) => [Math.max(i.s, start), Math.min(i.e, we)]).filter(([a, z]) => z > a).sort((x, y) => x[0] - y[0]);
  const gaps: Slot[] = [];
  let cur = start;
  for (const [a, z] of busy) { if (a - cur >= 15) gaps.push({ s: cur, e: a }); cur = Math.max(cur, z); }
  if (we - cur >= 15) gaps.push({ s: cur, e: we });
  const boxes: Box[] = inner.filter((i) => i.kind === "event" && CONTAINER.test(i.title) && i.e > start).map((i) => {
    let c = up15(Math.max(i.s, start));
    for (const t of inner) if (t.kind === "task" && t.s <= c && t.e > c) c = t.e;
    return { title: i.title.replace(/\s*\(.*$/, "").split(" & ")[0], area: i.area, general: GENERAL.test(i.title), cur: c, e: Math.min(i.e, we) };
  });
  return { ws, we, gaps, boxes, free: gaps.reduce((n, g) => n + g.e - g.s, 0) };
}

export function openProposals(ai: AI) {
  const hasTables = (s: Store) => !!s.db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ai_batches'").get();
  function saveBatch(s: Store, kind: string, date: string | null, summary: string, model: string, ms: number,
    rows: { kind: string; taskId: string | null; payload: any; reason: string }[]) {
    if (!hasTables(s)) return { batchId: null as string | null, pids: rows.map(() => null as string | null) };
    return s.db.transaction(() => {
      // A new day plan or inbox sort replaces the open one for that day; capture reads stand alone.
      if (kind === "plan" || kind === "triage" || kind === "tag")
        s.db.query("UPDATE ai_batches SET status = 'replaced', decided_at = ? WHERE kind = ? AND date IS ? AND status = 'open'").run(iso(), kind, date);
      const b = s.db.query("INSERT INTO ai_batches (kind, date, summary, model, ms, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
        .get(kind, date, summary, model, ms, iso()) as any;
      const ins = s.db.prepare("INSERT INTO ai_proposals (batch_id, kind, task_id, payload, reason, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id");
      const pids = rows.map((r) => `p${(ins.get(b.id, r.kind, r.taskId ? Number(r.taskId.slice(1)) : null, JSON.stringify(r.payload), r.reason, iso()) as any).id}`);
      return { batchId: `b${b.id}`, pids };
    })();
  }
  const rulesOf = (s: Store, owner: boolean) => {
    try {
      const r = s.db.query("SELECT value FROM settings WHERE key = 'ai.plan_rules'").get() as any;
      if (r) return r.value as string | null;
    } catch { /* no settings table before schema v6 */ }
    return owner ? OWNER_RULES : null;
  };

  // ── Plan my day ─────────────────────────────────────────────────────────
  const PLAN_SCHEMA = {
    type: "object",
    properties: {
      summary: { type: "string" },
      picks: {
        type: "array", maxItems: 8,
        items: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            title: { type: "string" },
            area: { type: "string" },
            when: { type: "string", enum: ["today", "tomorrow"] },
            why: { type: "string" },
          },
          required: ["taskId", "when", "why"],
        },
      },
    },
    required: ["summary", "picks"],
  };
  const PLAN_SYSTEM = `You plan one person's day inside their planner. The snapshot lists open tasks that have no time yet,
the free time left today (gaps and container blocks), and how much room tomorrow has.
Pick what to do today and in what order, most important first. Overdue and due-today tasks come first, then tasks
that feed a goal that is behind pace, then the rest. A task fits a container block only if the block says it takes that area.
Use "tomorrow" for an overdue or due-tomorrow task that can't fit today. Leave out what doesn't matter now.
Follow the user's rules. If a rule asks for something that no open task covers, add one new task for it:
taskId "new", a short title and an area slug from the list. At most one new task.
"why" is under 60 characters, plain English, from the data ("2 days late", "Feeds the Reels goal, behind pace").
Don't mention blocks or times in "why": the app adds where each task lands.
"history" (when present) is what the user did with past suggestions. Tasks in keepsSkipping were removed again and again:
pick one only if it is overdue, and then say so ("Skipped twice, now 3 days late"). Never add a new task whose title is in neverKeepsRuleTask.
"summary" is one sentence under 25 words about the day. Use only task ids from the snapshot.`;

  function candidates(b: any, today: string) {
    const goals = new Map(b.goals.goals.map((g: any) => [g.id, g]));
    return b.today.tasks.filter((t: any) => t.status === "todo" && !t.scheduled && t.owner !== "claude").map((t: any) => {
      const g: any = t.goal ? goals.get(t.goal) : null;
      return {
        id: t.id, title: t.title, area: t.area, due: t.due, minutes: t.estimateMinutes || 30, priority: t.priority,
        late: t.due && t.due < today ? daysBetween(t.due, today) : 0,
        goal: g ? { title: clip(g.title, 60), horizon: g.horizon, progress: g.progress } : null,
      };
    });
  }
  // What past plans taught: tasks you keep removing, rule-made tasks you never keep, the hours you keep
  // each area's work at. Last 21 days of kept/removed plan proposals.
  function planHistory(s: Store) {
    if (!hasTables(s)) return null;
    const since = new Date(Date.now() - 21 * 864e5).toISOString();
    const rows = s.db.query(`SELECT p.kind, p.task_id, p.status, p.payload, t.title, t.area FROM ai_proposals p
      JOIN ai_batches b ON b.id = p.batch_id LEFT JOIN tasks t ON t.id = p.task_id
      WHERE b.kind = 'plan' AND p.status IN ('kept', 'removed') AND b.created_at >= ?`).all(since) as any[];
    if (!rows.length) return null;
    const skips = new Map<string, { title: string; removed: number; kept: number }>();
    const news = new Map<string, { removed: number; kept: number }>();
    const hours: Record<string, number[]> = {};
    let kept = 0;
    for (const r of rows) {
      const x = JSON.parse(r.payload);
      if (r.status === "kept") kept++;
      if (r.kind === "new") {
        const k = String(x.title ?? "").toLowerCase();
        const n = news.get(k) ?? { removed: 0, kept: 0 };
        n[r.status === "kept" ? "kept" : "removed"]++;
        news.set(k, n);
        continue;
      }
      const id = `t${r.task_id}`;
      const v = skips.get(id) ?? { title: r.title ?? "", removed: 0, kept: 0 };
      v[r.status === "kept" ? "kept" : "removed"]++;
      skips.set(id, v);
      if (r.status === "kept" && r.area && x.start) (hours[r.area] ??= []).push(Number(String(x.start).slice(0, 2)));
    }
    const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
    return {
      keptShare: `${kept} of ${rows.length} suggestions kept`,
      keepsSkipping: [...skips.entries()].filter(([, v]) => v.removed >= 2 && v.removed > v.kept).map(([id, v]) => ({ id, title: v.title, removed: v.removed })),
      neverKeepsRuleTask: [...news.entries()].filter(([, v]) => v.removed >= 3 && !v.kept).map(([title]) => title),
      usualHourByArea: Object.fromEntries(Object.entries(hours).filter(([, h]) => h.length >= 2).map(([a, h]) => [a, `${String(median(h)).padStart(2, "0")}:00`])),
    };
  }
  // Deterministic order, used when Claude is unavailable and as a tie-break.
  const rank = (c: any, today: string) => (c.late ? 100 + c.late * 5 : c.due === today ? 80 : c.due === addDays(today, 1) ? 50 : c.due ? 20 : 0) + (c.goal ? 15 : 0) + (c.priority === 1 ? 10 : 0);
  const why = (c: any, today: string) => c.late ? (c.late === 1 ? "1 day late" : `${c.late} days late`)
    : c.due === today ? "Due today" : c.due === addDays(today, 1) ? "Due tomorrow" : c.goal ? `Feeds “${clip(c.goal.title, 30)}”` : `${c.minutes}m fits here`;

  async function plan(s: Store, { owner = true, date = null as string | null, prefetch = false } = {}) {
    const b = s.bootstrap();
    const today = b.today.date;
    if (date && date !== today) throw bad("Plan my day works on today.");
    const nowMin = Math.max(0, minOf(iso(), today));
    const D0 = dayModel(b, today, nowMin), D1 = dayModel(b, addDays(today, 1), 9 * 60);
    if (!D0) throw bad("No calendar for today yet.");
    const cands = candidates(b, today);
    const byId = new Map(cands.map((c: any) => [c.id, c]));
    const areas = new Set(b.areas.map((a: any) => a.slug));
    const rules = rulesOf(s, owner);
    const hist = planHistory(s);
    const skipping = new Set((hist?.keepsSkipping ?? []).map((x) => x.id));
    const neverNew = new Set(hist?.neverKeepsRuleTask ?? []);
    const usualHour: Record<string, string> = hist?.usualHourByArea ?? {};

    let picks: { taskId: string; title?: string; area?: string; when: string; why: string }[] = [];
    let summary = "", model = "rules", ms = 0, fallback = false;
    if (cands.length || rules) {
      try {
        const ctx = {
          today, now: hhmm(nowMin), rules,
          areas: b.areas.map((a: any) => ({ slug: a.slug, name: a.name })),
          freeToday: D0.gaps.map((g) => `${hhmm(g.s)}-${hhmm(g.e)}`),
          containersToday: D0.boxes.filter((x) => x.e - x.cur >= 15).map((x) => ({ block: x.title, from: hhmm(x.cur), to: hhmm(x.e), takes: x.general ? "any area" : x.area })),
          freeTomorrowMinutes: D1?.free ?? 0,
          tasks: cands.slice(0, 40),
          ...(hist ? { history: hist } : {}),
        };
        const r = await ai.claude({ model: "sonnet", system: PLAN_SYSTEM, schema: PLAN_SCHEMA, prompt: JSON.stringify(ctx), timeout: 60_000 });
        picks = Array.isArray(r.out.picks) ? r.out.picks : [];
        summary = String(r.out.summary ?? "");
        model = "Sonnet";
        ms = r.ms;
      } catch (e) {
        // Claude timed out, refused, or couldn't start: plan by the usual order instead of failing.
        console.error("[ai] plan used the rules:", e instanceof Error ? e.message : e);
        fallback = true;
      }
    }
    if (fallback || model === "rules") {
      // Tasks you keep removing sink unless they're late.
      const score = (c: any) => rank(c, today) - (skipping.has(c.id) && !c.late ? 60 : 0);
      picks = [...cands].sort((x: any, y: any) => score(y) - score(x)).slice(0, 8)
        .map((c: any) => ({ taskId: c.id, when: "today", why: why(c, today) }));
      summary = fallback ? "Claude wasn’t reachable, so this plan uses the usual order: late, due, goals." : "";
    }

    // Code places every pick, so no time is invented and nothing overlaps.
    const ghosts: Ghost[] = [], skipped: string[] = [];
    const seen = new Set<string>();
    let news = 0;
    // A block set aside for this task's area first, then free time, then a general block (Personal Hustle and the like).
    const take = (D: ReturnType<typeof dayModel>, area: string | null, d: number) => {
      if (!D) return null;
      const inBox = (box: Box | undefined) => { if (!box) return null; const st = box.cur; box.cur += d; return { s: st, where: box.title }; };
      const own = D.boxes.find((x) => !x.general && area && x.area === area && x.e - x.cur >= d);
      if (own) return inBox(own);
      // Free time: the earliest gap, or the one nearest the hour you usually keep this area's work at.
      const fits = D.gaps.filter((x) => x.e - x.s >= d);
      const want = area && usualHour[area] ? Number(usualHour[area].slice(0, 2)) * 60 : null;
      const startIn = (g: Slot) => (want == null ? g.s : up15(Math.min(Math.max(g.s, want), g.e - d)));
      const g = want == null ? fits[0] : fits.sort((x, y) => Math.abs(startIn(x) - want) - Math.abs(startIn(y) - want))[0];
      if (g) {
        const st = Math.min(startIn(g), g.e - d);
        const i = D.gaps.indexOf(g);
        D.gaps.splice(i, 1, ...[{ s: g.s, e: st }, { s: st + d, e: g.e }].filter((x) => x.e - x.s >= 15));
        D.gaps.sort((x, y) => x.s - y.s);
        return { s: st, where: null };
      }
      return inBox(D.boxes.find((x) => x.general && x.e - x.cur >= d));
    };
    for (const p of picks.slice(0, 8)) {
      const reason = clip(String(p.why ?? "").trim() || "Fits here", 70);
      if (p.taskId === "new") {
        const title = clip(String(p.title ?? "").trim(), 80);
        if (!title || neverNew.has(title.toLowerCase()) || news++ >= 1) continue;
        const area = p.area && areas.has(p.area) ? p.area : null;
        const at = take(D0, area, 15);
        if (at) ghosts.push({ pid: null, taskId: null, newTask: { title, area }, date: today, s: at.s, e: at.s + 15, why: at.where ? `${reason} · in ${at.where}` : reason });
        continue;
      }
      const c: any = byId.get(p.taskId);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      const d = Math.min(Math.max(c.minutes, 15), 240);
      let at = p.when === "tomorrow" ? null : take(D0, c.area, d);
      let date = today;
      if (!at && (c.late || (c.due && c.due <= addDays(today, 1)))) { at = take(D1, c.area, d); date = addDays(today, 1); }
      if (!at) { skipped.push(c.id); continue; }
      ghosts.push({ pid: null, taskId: c.id, newTask: null, date, s: at.s, e: at.s + d, why: at.where ? `${reason} · in ${at.where}` : reason });
    }
    ghosts.sort((x, y) => (x.date === y.date ? x.s - y.s : x.date < y.date ? -1 : 1));
    const saved = saveBatch(s, "plan", today, summary, model, ms, ghosts.map((g) => ({
      kind: g.newTask ? "new" : "place", taskId: g.taskId,
      payload: { date: g.date, start: hhmm(g.s), end: hhmm(g.e), ...(g.newTask ? { title: g.newTask.title, area: g.newTask.area } : {}) }, reason: g.why,
    })));
    ghosts.forEach((g, i) => { g.pid = saved.pids[i]; });
    return { batchId: saved.batchId, date: today, createdAt: iso(), summary, model, ms, fallback, prefetch, free: D0.free, ghosts, skipped };
  }

  /** Today's open plan (the 07:00 one, or the last one made), shaped like plan(). */
  function openPlan(s: Store) {
    if (!hasTables(s)) return null;
    const today = istDate();
    const b = s.db.query("SELECT * FROM ai_batches WHERE kind = 'plan' AND date = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(today) as any;
    if (!b) return null;
    const ps = s.db.query("SELECT * FROM ai_proposals WHERE batch_id = ? AND status = 'open' ORDER BY id").all(b.id) as any[];
    if (!ps.length) return null;
    const ghosts = ps.map((p) => {
      const x = JSON.parse(p.payload);
      const [sh, sm] = x.start.split(":").map(Number), [eh, em] = x.end.split(":").map(Number);
      return { pid: `p${p.id}`, taskId: p.task_id ? `t${p.task_id}` : null, newTask: p.kind === "new" ? { title: x.title, area: x.area ?? null } : null,
        date: x.date, s: sh * 60 + sm, e: eh * 60 + em, why: p.reason };
    });
    return { batchId: `b${b.id}`, date: today, createdAt: b.created_at, summary: b.summary ?? "", model: b.model, ms: b.ms, fallback: b.model === "rules", prefetch: true, ghosts, skipped: [] };
  }

  // ── Reading a capture line (Hinglish welcome) ───────────────────────────
  const PARSE_SCHEMA = {
    type: "object",
    properties: {
      tasks: {
        type: "array", minItems: 1, maxItems: 6,
        items: {
          type: "object",
          properties: {
            title: { type: "string" }, area: { type: "string" }, date: { type: "string" }, time: { type: "string" },
            minutes: { type: "integer" }, goalId: { type: "string" },
          },
          required: ["title"],
        },
      },
    },
    required: ["tasks"],
  };
  const PARSE_SYSTEM = `You turn one line the user typed or spoke into tasks for their planner. It may be English, Hindi or Hinglish.
Split it into separate tasks where it joins several ("aur", "and", "then", "phir", commas). Never invent a task.
Each title is short, plain English, starting with a verb ("Call Dad about the stock", "Shoot hooks for the Diwali reel"). Keep names as written.
Dates are YYYY-MM-DD from "today" in the snapshot: aaj = today, kal = tomorrow (unless the line is clearly about the past), parso = the day after, weekday names = the next one.
Times are HH:MM, 24-hour: subah = morning, dopahar = afternoon, shaam = evening, raat = night; "6 baje" = 6 o'clock. An hour from 1 to 7 with no other hint is afternoon or evening.
A task with no date of its own takes the date of the task before it in the same line, but never its time: leave time empty unless the line gives that task one.
area is a slug from the list, only when it is clear. goalId only when the task plainly serves that goal. minutes only when the line says how long.`;
  async function parse(s: Store, text: string) {
    const line = String(text ?? "").trim();
    if (!line) throw bad("Type or say something first.");
    if (line.length > 600) throw bad("Keep it under 600 characters.");
    const b = s.bootstrap();
    const today = b.today.date;
    const goals = b.goals.goals.filter((g: any) => g.status === "active" && ["week", "month", "quarter"].includes(g.horizon));
    const ctx = { today, weekday: b.today.weekday, now: hhmm(minOf(iso(), today)), areas: b.areas.map((a: any) => ({ slug: a.slug, name: a.name })),
      goals: goals.map((g: any) => ({ id: g.id, title: g.title })) };
    const r = await ai.claude({ model: "haiku", system: PARSE_SYSTEM, schema: PARSE_SCHEMA, prompt: `Snapshot:\n${JSON.stringify(ctx)}\n\nLine: ${line}`, timeout: 45_000 });
    const areas = new Set(b.areas.map((a: any) => a.slug)), goalIds = new Set(goals.map((g: any) => g.id));
    const isDate = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && Math.abs(daysBetween(today, d)) <= 366;
    const isTime = (t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
    const tasks = (r.out.tasks ?? []).slice(0, 6).map((t: any) => {
      const date = isDate(t.date) ? t.date : null;
      const time = isTime(t.time) ? t.time : null;
      return { title: clip(String(t.title ?? "").trim(), 200), area: areas.has(t.area) ? t.area : null, date: date ?? (time ? today : null), time,
        minutes: Number.isInteger(t.minutes) && t.minutes > 0 && t.minutes <= 600 ? t.minutes : null, goal: goalIds.has(t.goalId) ? t.goalId : null };
    }).filter((t: any) => t.title);
    if (!tasks.length) throw new ApiError(502, "Claude couldn’t find a task in that.");
    const saved = saveBatch(s, "parse", today, clip(line, 200), "Haiku", r.ms, tasks.map((t: any) => ({ kind: "new", taskId: null, payload: t, reason: "" })));
    return { batchId: saved.batchId, tasks: tasks.map((t: any, i: number) => ({ ...t, pid: saved.pids[i] })), model: "Haiku", ms: r.ms };
  }

  // ── Sorting the inbox ───────────────────────────────────────────────────
  const TRIAGE_SCHEMA = {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { taskId: { type: "string" }, area: { type: "string" }, due: { type: "string" }, minutes: { type: "integer" },
            goalId: { type: "string" }, why: { type: "string" } },
          required: ["taskId", "minutes"],
        },
      },
    },
    required: ["items"],
  };
  const TRIAGE_SYSTEM = `You sort a planner's inbox. For each item, suggest an area slug from the list, a due date (YYYY-MM-DD) only when the item
implies one or is clearly urgent, a length in minutes (15, 30, 45, 60, 90 or 120), and a goalId only when the item plainly serves that goal.
Leave "why" empty unless the area or date would surprise the user; then keep it under 50 characters. Use only the task ids given.`;
  async function triage(s: Store) {
    const b = s.bootstrap();
    const today = b.today.date;
    const inbox = b.today.tasks.filter((t: any) => t.status === "inbox").slice(0, 25);
    if (!inbox.length) return { batchId: null, items: [], model: null, ms: 0 };
    const goals = b.goals.goals.filter((g: any) => g.status === "active" && ["week", "month", "quarter"].includes(g.horizon));
    const ctx = { today, weekday: b.today.weekday, areas: b.areas.map((a: any) => ({ slug: a.slug, name: a.name })),
      goals: goals.map((g: any) => ({ id: g.id, title: g.title })), inbox: inbox.map((t: any) => ({ id: t.id, title: t.title, notes: t.notes ? clip(t.notes, 200) : null })) };
    const r = await ai.claude({ model: "haiku", system: TRIAGE_SYSTEM, schema: TRIAGE_SCHEMA, prompt: JSON.stringify(ctx), timeout: 60_000 });
    const ids = new Set(inbox.map((t: any) => t.id)), areas = new Set(b.areas.map((a: any) => a.slug)), goalIds = new Set(goals.map((g: any) => g.id));
    const seen = new Set<string>();
    const items = (r.out.items ?? []).filter((x: any) => ids.has(x.taskId) && !seen.has(x.taskId) && seen.add(x.taskId)).map((x: any) => ({
      taskId: x.taskId, area: areas.has(x.area) ? x.area : null,
      due: typeof x.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.due) && daysBetween(today, x.due) >= 0 && daysBetween(today, x.due) <= 90 ? x.due : null,
      minutes: [15, 30, 45, 60, 90, 120].includes(x.minutes) ? x.minutes : 30, goal: goalIds.has(x.goalId) ? x.goalId : null,
      why: x.why ? clip(String(x.why), 60) : null,
    }));
    const saved = saveBatch(s, "triage", today, `${items.length} inbox items`, "Haiku", r.ms, items.map((x: any) => ({ kind: "field", taskId: x.taskId, payload: x, reason: x.why ?? "" })));
    return { batchId: saved.batchId, items: items.map((x: any, i: number) => ({ ...x, pid: saved.pids[i] })), model: "Haiku", ms: r.ms };
  }

  // ── Tagging calendar blocks with an area ────────────────────────────────
  const TAG_SCHEMA = {
    type: "object",
    properties: {
      items: { type: "array", items: { type: "object", properties: { title: { type: "string" }, area: { type: "string" }, why: { type: "string" } }, required: ["title"] } },
    },
    required: ["items"],
  };
  const TAG_SYSTEM = `You tag calendar blocks with the area of life they belong to. For each untagged block title, pick one area slug
from the list, or leave area empty when none fits. Learn from the blocks already tagged: a title like one of them gets the same area.
College classes, course codes, tutorials and labs go to the college area when there is one; workouts, walks and sleep to the health or personal one.
Leave "why" empty unless the choice isn't obvious; then keep it under 40 characters. Copy each title exactly as given.`;
  async function tag(s: Store, titles: unknown) {
    const list = [...new Set((Array.isArray(titles) ? titles : []).map((t) => clip(String(t ?? "").trim(), 120)).filter(Boolean))].slice(0, 30);
    if (!list.length) return { batchId: null, items: [], model: null, ms: 0 };
    const b = s.bootstrap();
    const examples: Record<string, string[]> = {};
    for (const d of b.week.days) for (const ev of d.events) {
      if (!ev.area || ev.allDay) continue;
      const k = String(ev.title).replace(/\s*\([^)]*\)/g, "").trim();
      const ex = (examples[ev.area] ??= []);
      if (!ex.includes(k) && ex.length < 6) ex.push(k);
    }
    const ctx = { areas: b.areas.map((a: any) => ({ slug: a.slug, name: a.name })), alreadyTagged: examples, untagged: list };
    const r = await ai.claude({ model: "haiku", system: TAG_SYSTEM, schema: TAG_SCHEMA, prompt: JSON.stringify(ctx), timeout: 45_000 });
    const areas = new Set(b.areas.map((a: any) => a.slug)), want = new Set(list), seen = new Set<string>();
    const items = (r.out.items ?? []).filter((x: any) => want.has(x.title) && areas.has(x.area) && !seen.has(x.title) && seen.add(x.title))
      .map((x: any) => ({ title: x.title, area: x.area, why: x.why ? clip(String(x.why), 50) : null }));
    const saved = saveBatch(s, "tag", istDate(), `${items.length} of ${list.length} block names`, "Haiku", r.ms,
      items.map((x: any) => ({ kind: "area", taskId: null, payload: x, reason: x.why ?? "" })));
    return { batchId: saved.batchId, items: items.map((x: any, i: number) => ({ ...x, pid: saved.pids[i] })), model: "Haiku", ms: r.ms };
  }

  // ── What the user kept ──────────────────────────────────────────────────
  function decide(s: Store, batchIn: string, body: any) {
    if (!hasTables(s)) return { ok: true, recorded: false };
    const id = Number(String(batchIn).replace(/^b/, ""));
    const b = s.db.query("SELECT * FROM ai_batches WHERE id = ?").get(id) as any;
    if (!b) throw new ApiError(404, "No such batch.");
    const list = (k: string) => (Array.isArray(body?.[k]) ? body[k] : []).map((p: unknown) => Number(String(p).replace(/^p/, ""))).filter((n: number) => n > 0);
    const stamp = iso();
    s.db.transaction(() => {
      const set = s.db.prepare("UPDATE ai_proposals SET status = ?, decided_at = ? WHERE id = ? AND batch_id = ? AND status = 'open'");
      for (const p of list("kept")) set.run("kept", stamp, p, id);
      for (const p of list("removed")) set.run("removed", stamp, p, id);
      if (body?.closeRest) s.db.query("UPDATE ai_proposals SET status = 'removed', decided_at = ? WHERE batch_id = ? AND status = 'open'").run(stamp, id);
      const left = (s.db.query("SELECT count(*) n FROM ai_proposals WHERE batch_id = ? AND status = 'open'").get(id) as any).n;
      if (!left) s.db.query("UPDATE ai_batches SET status = 'decided', decided_at = ? WHERE id = ?").run(stamp, id);
    })();
    return { ok: true, recorded: true };
  }

  const madeToday = (s: Store, kind: string) => hasTables(s) && !!s.db.query("SELECT 1 FROM ai_batches WHERE kind = ? AND date = ?").get(kind, istDate());

  return { plan, openPlan, parse, triage, tag, decide, madeToday };
}
export type Proposals = ReturnType<typeof openProposals>;
