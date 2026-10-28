// His mood, for her orb (red when he's stressed or overloaded) and the widget: stress 0-1, energy 0-1, valence -1..1,
// a short label and the reasons, scored from real signals only. No model: it runs on every app open and must be cheap,
// explainable and honest. Signals: how much is booked against the time left before bed, overdue and due-today tasks,
// jobs and asks waiting on him, the hour (and being up past bedtime), sleep and screen time when an app reports them,
// money left in the budget, the tone of what he wrote to her and in his journal, what he got done, breathing sessions.
// mood() is pure; wyn.ts gathers the inputs (gatherMood) from the store, her db and the apps' summaries.
import type { Database } from "bun:sqlite";
import { OFFSET } from "./store";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const round = (v: number) => Math.round(v * 100) / 100;
const toMin = (hm: string) => { const m = /^(\d\d):(\d\d)$/.exec(String(hm ?? "")); return m ? +m[1] * 60 + +m[2] : null; };
const istMin = (ms: number) => { const d = new Date(ms + OFFSET * 60000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hours = (m: number) => (m >= 90 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m)} min`);

export type MoodIn = {
  now: number; bed: string; wake: string;
  committedMin: number;          // events and planned tasks between now and bed
  dueOpen: number; dueMin: number; // open tasks due today with no time yet, and their estimated minutes
  overdue: number; doneToday: number; needsJobs: number; asks: number;
  texts: string[];               // what he wrote to her in the last day
  journal: { text: string; mood?: string | null }[];   // the last three days
  sleepHours?: number | null; screenMin?: number | null;
  money?: { left?: number | null; budget?: number | null } | null;
  breathsToday?: number;
};
export type Reason = { key: string; text: string; stress?: number; energy?: number; valence?: number };
export type Mood = { stress: number; energy: number; valence: number; label: string; line: string; overloaded: boolean; reasons: Reason[]; at: string };

// Hinglish and English. Kept small and plain on purpose: a word list is easy to read and to fix.
const NEG = /\b(tired|thak(a|i|e)?( hua| gaya| gayi)?|exhausted|drained|stressed|stress|tension|tense|anxious|anxiety|panic|overwhelm(ed|ing)?|sad|upset|frustrat(ed|ing)|irritat(ed|ing)|angry|gussa|annoyed|bad day|worst|ugh|sick|headache|fever|bura|bekar|bakwas|pareshan|udaas|dukhi|nahi ho raha|can'?t focus|burnt? out|behind|lonely|bored|meh)\b/gi;
const POS = /\b(good|great|happy|awesome|amazing|nice|badhiya|mast|shandaar|maza|done|shipped|finished|excited|proud|relaxed|calm|achha|accha|khush|grateful|productive|chill|perfect|love(d)?|fun)\b/gi;
const PRESSURE = /\b(deadline|stressed|stress|tension|overwhelm(ed|ing)?|panic|anxious|too much|bahut kaam|no time|time nahi)\b/gi;
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

/** The score. Every adjustment carries its reason; the biggest few come back, biggest first. */
export function mood(x: MoodIn): Mood {
  const reasons: Reason[] = [];
  let stress = 0.16, energy = 0.62, valence = 0.08;
  const add = (r: Reason) => {
    stress += r.stress ?? 0; energy += r.energy ?? 0; valence += r.valence ?? 0;
    for (const k of ["stress", "energy", "valence"] as const) if (typeof r[k] === "number") r[k] = round(r[k]!);
    reasons.push(r);
  };
  const now = istMin(x.now), bed = toMin(x.bed) ?? 23 * 60, wake = toMin(x.wake) ?? 7 * 60;
  // minutes awake left today (bed may be after midnight)
  const bedAbs = bed < wake ? bed + 1440 : bed;
  const nowAbs = now < wake && bed < wake ? now + 1440 : now;
  const left = Math.max(0, bedAbs - nowAbs);
  const pastBed = bed < wake ? now >= bed && now < wake : now >= bed || now < wake;

  // load: what's booked (and due today without a time) against the waking time left
  const load = x.committedMin + x.dueMin;
  if (left > 0 && load > 0) {
    const ratio = load / Math.max(60, left);
    if (ratio > 0.55) add({ key: "load", text: `${hours(load)} booked or due in the ${hours(left)} left before bed`, stress: 0.5 * clamp((ratio - 0.55) / 0.75), energy: -0.08 * clamp(ratio - 0.8) });
    else if (left >= 180 && ratio < 0.3) add({ key: "room", text: `${hours(left - load)} free before bed`, stress: -0.05, valence: 0.04 });
  }
  if (x.overdue > 0) add({ key: "overdue", text: `${x.overdue} task${x.overdue > 1 ? "s" : ""} overdue`, stress: Math.min(0.2, 0.03 * x.overdue) });
  if (x.dueOpen > 0 && now >= 17 * 60) add({ key: "due", text: `${x.dueOpen} due today still open`, stress: Math.min(0.12, 0.035 * x.dueOpen) });
  if (x.needsJobs > 0) add({ key: "jobs", text: `${x.needsJobs} job${x.needsJobs > 1 ? "s" : ""} waiting on your answer`, stress: Math.min(0.12, 0.04 * x.needsJobs) });
  if (x.asks > 0) add({ key: "asks", text: `${x.asks} thing${x.asks > 1 ? "s" : ""} waiting on your yes`, stress: Math.min(0.06, 0.02 * x.asks) });
  if (pastBed) add({ key: "late", text: "You're up past bedtime", stress: 0.1, energy: -0.3 });
  else if (now >= bed - 60) add({ key: "night", text: "Bedtime is within the hour", energy: -0.15 });
  else if (now >= 14 * 60 && now < 16 * 60) add({ key: "slump", text: "The afternoon dip", energy: -0.08 });
  else if (now >= wake && now < wake + 150) add({ key: "morning", text: "Early in your day", energy: 0.06 });
  if (x.sleepHours != null && x.sleepHours > 0) {
    if (x.sleepHours < 6) add({ key: "sleep", text: `${round(x.sleepHours)} h of sleep`, stress: 0.1, energy: -0.25 });
    else if (x.sleepHours >= 7.5) add({ key: "sleep", text: `${round(x.sleepHours)} h of sleep`, energy: 0.1 });
  }
  if (x.screenMin != null && x.screenMin > 240) add({ key: "screen", text: `${hours(x.screenMin)} on screens today`, energy: -0.1, valence: -0.08 });
  const m = x.money;
  if (m && typeof m.left === "number") {
    if (m.left < 0) add({ key: "money", text: `₹${Math.round(-m.left).toLocaleString("en-IN")} over today's budget`, stress: 0.12, valence: -0.05 });
    else if (m.budget && m.left < m.budget * 0.15) add({ key: "money", text: "Almost through today's budget", stress: 0.05 });
  }
  // tone: what he wrote to her (last day) counts more than the journal (last three days)
  const said = x.texts.join(" \n "), wrote = x.journal.map((j) => `${j.text} ${j.mood ?? ""}`).join(" \n ");
  const neg = count(NEG, said) * 1.5 + count(NEG, wrote), pos = count(POS, said) * 1.5 + count(POS, wrote), press = count(PRESSURE, said) + count(PRESSURE, wrote) * 0.5;
  if (neg + pos > 0) {
    const tone = (pos - neg) / Math.max(4, pos + neg + 2);
    if (Math.abs(tone) >= 0.08) add({ key: "tone", text: tone < 0 ? "What you wrote sounds heavy" : "What you wrote sounds upbeat", valence: tone * 0.9, stress: tone < 0 ? -tone * 0.25 : -tone * 0.08, energy: tone < 0 ? -0.06 : 0.04 });
  }
  if (press > 0) add({ key: "pressure", text: "You mentioned pressure", stress: Math.min(0.18, 0.06 * press) });
  if (x.doneToday >= 3) add({ key: "done", text: `${x.doneToday} things done today`, stress: -0.05, valence: 0.1, energy: 0.04 });
  if (x.breathsToday) add({ key: "breath", text: `Breathed ${x.breathsToday === 1 ? "once" : `${x.breathsToday} times`} today`, stress: -Math.min(0.1, 0.05 * x.breathsToday) });

  stress = round(clamp(stress)); energy = round(clamp(energy)); valence = round(clamp(valence, -1, 1));
  const overloaded = stress >= 0.78;
  const label = overloaded ? "Overloaded" : stress >= 0.6 ? "Stretched" : stress >= 0.42 ? "Busy" : energy < 0.3 ? "Tired" : valence <= -0.3 ? "Low" : valence >= 0.3 ? "Good" : stress <= 0.25 ? "Calm" : "Steady";
  const weight = (r: Reason) => Math.abs(r.stress ?? 0) + Math.abs(r.energy ?? 0) / 2 + Math.abs(r.valence ?? 0) / 2;
  const top = reasons.filter((r) => weight(r) > 0).sort((a, b) => weight(b) - weight(a));
  const line = top.length ? `${label}: ${top.slice(0, 2).map((r) => r.text).join(", ")}.` : `${label}.`;
  return { stress, energy, valence, label, line, overloaded, reasons: top.slice(0, 6), at: new Date(x.now).toISOString() };
}

/** The tone inputs from her db: his messages to her in the last day, and the journal of the last three days. */
export function toneOf(n: Database, now = Date.now()) {
  const texts = (n.query("SELECT text FROM messages WHERE role = 'user' AND at >= ? ORDER BY id DESC LIMIT 30").all(new Date(now - 864e5).toISOString()) as any[]).map((r) => String(r.text).slice(0, 500));
  const journal = (n.query("SELECT text, mood FROM journal WHERE at >= ? ORDER BY id DESC LIMIT 10").all(new Date(now - 3 * 864e5).toISOString()) as any[]).map((r) => ({ text: String(r.text).slice(0, 800), mood: r.mood }));
  return { texts, journal };
}
