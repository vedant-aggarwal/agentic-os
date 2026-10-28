// Soul's rules, pure: no DOM, no clock of its own, no imports. The app (soul-store.js) and the PC (server/modules/soul.ts)
// both run this file, so a streak, a Clean day and an unlock decision read the same on the phone, offline, and for the
// agent. Owner: the Soul agent. Dates are IST calendar dates 'YYYY-MM-DD'; times in are ms or ISO.
//
// Forgiving streaks (agreed in the prototype): a streak ends only when a habit is missed twice in a row; a rest day
// keeps it and does not count; a day the habit isn't due is skipped; today is open until it's done.

export const IST = 330;   // minutes; the server and the phone both pass their own offset when they have one
const pad = (n) => String(n).padStart(2, '0');
export const dateAt = (ms, off = IST) => new Date(ms + off * 6e4).toISOString().slice(0, 10);
export const minOfDay = (ms, off = IST) => { const d = new Date(ms + off * 6e4); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export const hhmmAt = (ms, off = IST) => { const m = minOfDay(ms, off); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
export function addDays(date, n) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
/** 1 = Monday … 7 = Sunday (Screen Time's and NATIVE's convention) */
export const dow = (date) => { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
export const toMs = (t) => (typeof t === 'number' ? t : Date.parse(t));
export const parseHM = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const fmtHM = (m) => { const t = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };

// ── habits ────────────────────────────────────────────────────────────────
export const dueOn = (h, date) => !Array.isArray(h.days) || !h.days.length || h.days.includes(dow(date));
const startOf = (h, off) => h.start ?? (h.created_at ? dateAt(toMs(h.created_at), off) : null);

/** The check that counts for each day: the latest written one per habit and date (a widget and the app may both write). */
export function checksFor(habitId, checks, off = IST) {
  const by = new Map();
  for (const c of checks) {
    if (c.deleted_at || c.habit !== habitId) continue;
    const date = c.date ?? (c.at ? dateAt(toMs(c.at), off) : null);
    if (!date) continue;
    const cur = by.get(date);
    if (!cur || String(c.updated_at ?? '') > String(cur.updated_at ?? '')) by.set(date, { ...c, date });
  }
  return by;
}
const isDone = (h, c) => !!c && !c.rest && (c.done === true || (h.of > 0 && Number(c.count) >= h.of));

/** One day's mark: '1' done · '0' missed · 's' rest day · '-' not due (or before the habit existed) · '.' today, open */
export function dayMark(h, c, date, today, start) {
  if (start && date < start) return '-';
  if (c?.rest) return 's';
  if (isDone(h, c)) return '1';
  if (!dueOn(h, date)) return '-';
  return date === today ? '.' : '0';
}

/** When a habit counts as missed today: a morning habit 3 hours after its time (12:00 without one); evening ones close at midnight. */
export function deadline(h) {
  if (h.part !== 'morning') return null;
  const at = parseHM(h.at);
  return at == null ? 12 * 60 : Math.min(at + 180, 23 * 60);
}

/**
 * Everything the screens show for one habit on `today` (nowMin: minutes into today).
 * → { done, doneAt, by, count, rested, missed, streak, best, prev, atRisk, hist (56 marks, today last), pct, days8 }
 */
export function habitState(h, checks, today, nowMin, off = IST) {
  const map = checksFor(h.id, checks, off);
  const start = startOf(h, off);
  const first = start && start < addDays(today, -400) ? addDays(today, -400) : (start ?? addDays(today, -55));
  const span = Math.max(0, daysBetween(first, today));
  let run = 0, misses = 0, best = 0, prev = 0, lastDue = null;
  const marks = [];
  for (let i = span; i >= 0; i--) {
    const date = addDays(today, -i);
    const m = dayMark(h, map.get(date), date, today, start);
    marks.push(m);
    if (m === '1') { run += 1; misses = 0; best = Math.max(best, run); lastDue = '1'; }
    else if (m === '0') { misses += 1; lastDue = '0'; if (misses >= 2 && run) { prev = run; run = 0; } }
  }
  const c = map.get(today);
  const done = isDone(h, c);
  const dl = deadline(h);
  const missed = !done && !c?.rest && dueOn(h, today) && dl != null && nowMin >= dl;
  // one miss is forgiven; a second in a row ends it. At risk: the last due day was a miss and today is still open.
  const atRisk = !done && !c?.rest && dueOn(h, today) && run > 0 && (lastDue === '0' || missed);
  while (marks.length < 56) marks.unshift('-');
  const hist = marks.slice(-56).join('');
  const last = hist.slice(-56).split('');
  const doneN = last.filter((x) => x === '1').length, missN = last.filter((x) => x === '0').length;
  return {
    done, doneAt: done && c?.at ? hhmmAt(toMs(c.at), off) : null, by: done ? (c?.by ?? (c?.source === 'agent' ? 'wyn' : 'you')) : null,
    count: Number(c?.count) || 0, rested: !!c?.rest, missed, streak: run, best: Math.max(best, run), prev, atRisk, hist,
    pct: doneN + missN ? Math.round((doneN / (doneN + missN)) * 100) : null, days8: doneN, checkId: c?.id ?? null,
  };
}

/** The id the app gives today's check for a habit, so a resend, a widget tap and an undo all land on one record. */
export const checkId = (habitId, date) => `c_${String(habitId).replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 50)}_${date}`;

// ── Clean ─────────────────────────────────────────────────────────────────
/** Clean outside its own tab is only ever this: "Day N", the day he is on (the first day is Day 1). */
export const cleanDay = (sinceMs, nowMs) => Math.floor(Math.max(0, nowMs - sinceMs) / 864e5) + 1;

/** The record: runs from the resets (each closes one run) plus the current one. */
export function cleanRecord(clean, resets, nowMs) {
  const since = toMs(clean.since);
  const runs = resets.filter((r) => !r.deleted_at && r.prev_since && r.at).map((r) => ({ from: toMs(r.prev_since), to: toMs(r.at) }));
  runs.push({ from: since, to: nowMs, current: true });
  const days = (r) => Math.max(0, Math.floor((r.to - r.from) / 864e5));
  let best = null;
  for (const r of runs) if (!best || days(r) > days(best)) best = r;
  const y0 = Date.UTC(new Date(nowMs).getUTCFullYear(), 0, 1) - IST * 6e4;
  const year = Math.floor(runs.reduce((a, r) => a + Math.max(0, Math.min(r.to, nowMs) - Math.max(r.from, y0)), 0) / 864e5);
  return { best: best ? days(best) : 0, bestTo: best?.current ? null : best?.to ?? null, bestCurrent: !!best?.current, year, runs: runs.length };
}

// ── the blocker ───────────────────────────────────────────────────────────
/** Is a lock holding at this moment? Windows may cross midnight; "ask first" locks hold only after his yes today. */
export function lockHolds(l, nowMs, { asks = [], off = IST } = {}) {
  if (!l || l.deleted_at || l.active === false) return false;
  if (l.kind === 'now') return !!l.until && toMs(l.until) > nowMs;
  if (l.kind === 'limit' || l.kind === 'hard') return false;
  const s = parseHM(l.start), e = parseHM(l.end);
  if (s == null || e == null) return false;
  const today = dateAt(nowMs, off); const m = minOfDay(nowMs, off);
  const inToday = s < e ? m >= s && m < e : m >= s;
  const inYday = s >= e && m < e;
  const day = inToday ? today : inYday ? addDays(today, -1) : null;
  if (!day || !dueOn(l, day)) return false;
  if (l.ask_first) {
    const a = asks.filter((x) => !x.deleted_at && x.lock === l.id && x.date === day).sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)))[0];
    return a?.state === 'yes';
  }
  return true;
}
/** When the lock that holds now ends, as 'HH:MM' (null when nothing holds). */
export function lockEnds(l, nowMs, off = IST) {
  if (!l) return null;
  if (l.kind === 'now') return l.until ? hhmmAt(toMs(l.until), off) : null;
  return l.end ?? null;
}
export const lockWhen = (l) => {
  if (l.kind === 'now') return 'For now';
  if (l.kind === 'limit') return `${l.limit_min ?? 45} minutes a day`;
  if (l.kind === 'hard') return 'No unlocks until a lock ends';
  const days = Array.isArray(l.days) && l.days.length && l.days.length < 7 ? (l.days.join() === '1,2,3,4,5' ? 'Weekdays' : l.days.join() === '6,7' ? 'Weekends' : l.days.map((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d - 1]).join(' ')) : 'Every day';
  return `${days} ${l.start}–${l.end}`;
};

// The talk. How good a reason is, in minutes, matched in order. Nothing matched and nothing weak: she asks once more.
export const LADDER = [
  { re: /(post|reel|upload|story|publish|caption)/i, mins: 10, say: (t) => `Posting counts as work. Open for 10 minutes, then I lock it again at ${t}. Post, answer comments, close.` },
  { re: /(customer|client|order|reply|dm\b|corner market|northwind|kurta|business|invoice|payment|lead)/i, mins: 5, say: (t) => `That one won’t wait. Open for 5 minutes, messages only. I lock it again at ${t}.` },
  { re: /(sent me|someone|friend|tagged|mom|dad|message|family)/i, mins: 2, say: (t) => `Two minutes: look, reply, close. I lock it at ${t}.` },
];
export const WEAK = /(just|bored|quick|five|5 ?min|check|scroll|nothing|one thing|timepass|bas\b|chill|feel like)/i;
export const DAILY_OPENS = 3;

/**
 * His rules, applied: { out: 'open' | 'held' | 'more', mins, say(untilHHMM) | text }.
 *   text: his reason · round: 0 first answer, 1 after she asked once more · opensLeft: today's opens left
 *   strict: 'easy' (opens freely, 15 min) | 'reason' | 'never' · hard: hard mode on · ends: 'HH:MM' the lock ends · weakWeek: weak asks this week
 */
export function judgeUnlock({ text, round = 0, opensLeft = DAILY_OPENS, strict = 'reason', hard = false, ends = null, weakWeek = 0 }) {
  const t = String(text ?? '').trim();
  const at = ends ? ` It opens at ${ends}.` : ' It opens when the lock ends.';
  if (hard || strict === 'never') return { out: 'held', text: `Hard mode is on, so this lock doesn’t open early, however good the reason.${at}` };
  if (opensLeft <= 0) return { out: 'held', text: `That’s all ${DAILY_OPENS} opens for today, and I keep that line however good the reason.${at}` };
  if (strict === 'easy') return { out: 'open', mins: 15, say: (u) => `Open for 15 minutes. I lock it again at ${u}.` };
  const tier = LADDER.find((l) => l.re.test(t));
  const weak = WEAK.test(t) || t.length < 8;
  if (tier && !(weak && tier.mins === 2)) return { out: 'open', mins: tier.mins, say: tier.say };
  if (weak || round > 0) {
    const lead = round === 0
      ? (weakWeek >= 2 ? `That’s “just a minute” number ${weakWeek + 1} this week. ` : 'A few minutes at this hour usually runs longer. ')
      : 'I believe it matters to you. It can still wait. ';
    return { out: 'held', text: `${lead}${at.trim()}` };
  }
  return { out: 'more', text: 'Tell me a little more. What exactly do you need it for?' };
}

// ── where the pull shows up: weekday × hour from what he logged (urges, unlock asks, Screen Time when it's on) ──
/** rows Mon…Sun, columns 00…23: counts over the last `days` days */
export function heat(events, nowMs, { days = 28, off = IST } = {}) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  const from = nowMs - days * 864e5;
  let n = 0;
  for (const e of events) {
    const ms = toMs(e.at); if (!Number.isFinite(ms) || ms < from || ms > nowMs) continue;
    const date = dateAt(ms, off); const h = Math.floor(minOfDay(ms, off) / 60);
    grid[dow(date) - 1][h] += e.w ?? 1; n += 1;
  }
  return { grid, n };
}
/** The hours the pull is strongest: up to two one-hour windows with at least 3 events, weekdays when most fall on them. */
export function learnWindows(grid, { min = 3 } = {}) {
  const byHour = Array.from({ length: 24 }, (_, h) => ({ h, n: grid.reduce((a, r) => a + r[h], 0), wk: grid.slice(0, 5).reduce((a, r) => a + r[h], 0) }));
  const top = byHour.filter((x) => x.n >= min).sort((a, b) => b.n - a.n);
  const out = [];
  for (const x of top) {
    if (out.some((w) => Math.abs(w.h - x.h) <= 1 || Math.abs(w.h - x.h) >= 23)) continue;
    const weekdays = x.wk / x.n >= 0.75;
    out.push({ h: x.h, n: x.n, start: fmtHM(x.h * 60), end: fmtHM(x.h * 60 + 60), days: weekdays ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7], label: `${weekdays ? 'Weekdays' : 'Every day'} ${fmtHM(x.h * 60)}–${fmtHM(x.h * 60 + 60)}` });
    if (out.length === 2) break;
  }
  return out;
}
