// Module jobs. A tick every 60 s runs what is due, for the owner only, one run per job at a time.
//   at: "HH:MM"   once a day, at the first tick on or after that time (IST); never twice on the same IST date.
//                 A server that was off at that time catches up within the next 4 hours (or catchUpMinutes), then skips
//                 the day. The window runs across midnight: a 23:00 job with 180 minutes catches up at 00:40, and that
//                 run counts for the day the slot began (Run.date is the slot's IST date, not the clock's).
//   every: "15m" | "1h" (any "<n>m" / "<n>h")   when that long has passed since the last run (or never ran)
//   days: ["mon", ...]   optional, IST weekdays
// Last runs live in <dataDir>/mod/jobs.json keyed "<module>:<job id>", so a restart does not repeat a day's job.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Job, JobCtx, Module } from "./types";

const OFFSET = 330;
const CATCH_UP_MIN = 4 * 60;
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
type Run = { at: string; date: string; ok: boolean; ms: number; error?: string; attempts?: number };
type Deps = {
  modules: Module[]; dataDir: string;
  // Builds a job context for the owner (null while no owner account exists). `close` releases the per-run db handle.
  ctxFor: (mod: Module) => { ctx: JobCtx; close: () => void } | null;
  log?: (msg: string) => void;
};

export function parseEvery(s: string | undefined): number | null {
  const m = /^(\d+)\s*(m|h)$/i.exec(String(s ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]) * (m[2].toLowerCase() === "h" ? 60 : 1);
  return n > 0 ? n * 60_000 : null;
}
/** The IST clock: date, HH:MM and weekday, from any instant. */
export function ist(d = new Date()) {
  const t = new Date(d.getTime() + OFFSET * 60000);
  return { date: t.toISOString().slice(0, 10), hhmm: t.toISOString().slice(11, 16), day: DAYS[t.getUTCDay()] };
}
/** The latest time a daily `at` came round (IST): that slot's date and weekday, and how many minutes ago it was. */
export function slotOf(at: string, now = new Date()) {
  const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const late = (mins(ist(now).hhmm) - mins(at) + 1440) % 1440;
  const s = ist(new Date(now.getTime() - late * 60000));
  return { date: s.date, day: s.day, late };
}
/** Pure: is this job due now, given its last run? Exported so it can be tested without a server. */
export function isDue(job: Pick<Job, "at" | "every" | "days" | "catchUpMinutes" | "retry">, last: Run | undefined, now = new Date()) {
  const n = ist(now);
  const okDay = (day: string) => !job.days?.length || job.days.map((x) => x.slice(0, 3).toLowerCase()).includes(day);
  if (job.at) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(job.at)) return false;
    const slot = slotOf(job.at, now);
    if (!okDay(slot.day)) return false;
    if (slot.late >= Math.min(1440, job.catchUpMinutes ?? CATCH_UP_MIN)) return false;
    if (last?.date !== slot.date) return true;
    if (last.ok || !job.retry || (last.attempts ?? 1) >= job.retry.attempts) return false;
    return now.getTime() - Date.parse(last.at) >= job.retry.delayMinutes * 60_000;
  }
  if (!okDay(n.day)) return false;
  const ms = parseEvery(job.every);
  if (ms == null) return false;
  return !last || now.getTime() - Date.parse(last.at) >= ms - 5_000;
}

export function startScheduler(d: Deps) {
  const file = join(d.dataDir, "mod", "jobs.json");
  const log = d.log ?? ((m: string) => console.log(m));
  let runs: Record<string, Run> = {};
  try { runs = JSON.parse(readFileSync(file, "utf8")); } catch {}
  const save = () => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(runs, null, 1));
      renameSync(`${file}.tmp`, file);
    } catch (e) { log(`[mod] could not save jobs.json: ${e}`); }
  };
  const running = new Set<string>();

  async function runJob(mod: Module, job: NonNullable<Module["jobs"]>[number]) {
    const key = `${mod.name}:${job.id}`;
    if (running.has(key)) return;
    const built = d.ctxFor(mod);
    if (!built) return;
    running.add(key);
    const t0 = Date.now(), n = { date: job.at ? slotOf(job.at).date : ist().date };   // a daily job's run belongs to its slot's day
    const attempts = job.at && runs[key]?.date === n.date ? (runs[key].attempts ?? 1) + 1 : 1;
    try {
      await job.run(built.ctx);
      runs[key] = { at: new Date().toISOString(), date: n.date, ok: true, ms: Date.now() - t0, attempts };
    } catch (e: any) {
      runs[key] = { at: new Date().toISOString(), date: n.date, ok: false, ms: Date.now() - t0, attempts, error: String(e?.message ?? e).slice(0, 300) };
      log(`[mod:${mod.name}] job ${job.id} failed: ${runs[key].error}`);
    } finally {
      try { built.close(); } catch {}
      running.delete(key);
      save();
    }
  }
  function tick() {
    try {
      const now = new Date();
      for (const mod of d.modules) for (const job of mod.jobs ?? []) {
        if (!job?.id || typeof job.run !== "function") continue;
        if (isDue(job, runs[`${mod.name}:${job.id}`], now)) runJob(mod, job).catch((e) => log(`[mod:${mod.name}] job ${job.id}: ${e}`));
      }
    } catch (e) { log(`[mod] scheduler tick failed: ${e}`); }
  }
  const jobs = d.modules.flatMap((m) => (m.jobs ?? []).map((j) => `${m.name}:${j.id}`));
  if (jobs.length) log(`[mod] scheduler: ${jobs.join(", ")}`);
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, 60_000);
  return { tick, runs: () => runs, stop: () => { clearTimeout(first); clearInterval(timer); } };
}
