// Price on every block. Rates are typed by the user (agentos price), never invented; this module reads them
// and works out, in code, what each block of the day displaces: for a block of area A lasting H hours, the
// highest-rate other area B that has open work, and what H hours of B equals in B's unit of work (the median
// task estimate of B). An area without a rate shows "no rate yet" and never a number.
//   GET /api/v1/mod/price/rates                      { rates, count, enough }
//   PUT /api/v1/mod/price/rates  { rates: [{ area, rate_per_hour|null, note }] }   (or one { area, rate, note })
//   GET /api/v1/mod/price/blocks?date=YYYY-MM-DD     today's blocks with their displacement line
import { istDate } from "../store";
import type { Module } from "./types";
import { bad, clip } from "./planning-common";

export const NO_RATE = "no rate yet";
const SLEEP = /\bsleep\b/i;
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const hoursText = (m: number) => { const h = Math.floor(m / 60), r = Math.round(m % 60); return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };
const minOf = (isoStr: string, date: string) => (Date.parse(isoStr) - Date.parse(`${date}T00:00:00+05:30`)) / 60000;
const hhmm = (m: number) => `${String(Math.floor(Math.max(0, Math.min(1439, m)) / 60)).padStart(2, "0")}:${String(Math.round(Math.max(0, Math.min(1439, m)) % 60)).padStart(2, "0")}`;

type Rate = { area: string; name: string; color: string | null; rate_per_hour: number | null; source: string | null; note: string | null; updated_at: string | null };

/** The displacement line for one block, from rates and open work only. Null when nothing honest can be said. */
export function displacement(block: { area: string | null; minutes: number }, rates: Rate[], work: Record<string, { open: number; unitMinutes: number | null }>) {
  const priced = rates.filter((r) => r.rate_per_hour != null && r.rate_per_hour > 0);
  if (priced.length < 2) return null;
  const others = priced.filter((r) => r.area !== block.area && (work[r.area]?.open ?? 0) > 0).sort((a, b) => b.rate_per_hour! - a.rate_per_hour!);
  const b = others[0];
  if (!b) return null;
  const hours = block.minutes / 60;
  const value = hours * b.rate_per_hour!;
  const unit = work[b.area]?.unitMinutes ?? null;
  const units = unit ? Math.round((block.minutes / unit) * 2) / 2 : null;
  const own = rates.find((r) => r.area === block.area);
  const ownText = own?.rate_per_hour != null ? rupees(hours * own.rate_per_hour) : block.area ? NO_RATE : "untagged";
  const text = units && units >= 0.5
    ? `${hoursText(block.minutes)} here costs ${units === 1 ? "one" : units} ${b.name} task${units === 1 ? "" : "s"} (${rupees(value)})`
    : `${hoursText(block.minutes)} here costs ${rupees(value)} of ${b.name} time`;
  return { area: b.area, name: b.name, rate_per_hour: b.rate_per_hour, value: Math.round(value), units, unitMinutes: unit, own: ownText, text };
}

export const price: Module = {
  name: "price",
  async handle(ctx) {
    if (ctx.path === "/rates" && ctx.method === "GET") {
      const r = await ctx.agentos(["price"]);
      const priced = (r?.rates ?? []).filter((x: Rate) => x.rate_per_hour != null);
      return ctx.json({ rates: r?.rates ?? [], count: priced.length, enough: priced.length >= 2, noRate: NO_RATE });
    }
    if (ctx.path === "/rates" && ctx.method === "PUT") {
      if (!ctx.owner) return ctx.fail(403, "Only the owner sets rates.");
      const b = await ctx.body();
      const list: any[] = Array.isArray(b?.rates) ? b.rates : b?.area ? [b] : [];
      if (!list.length) throw bad("Send { rates: [{ area, rate_per_hour, note }] }.");
      const changed: string[] = [];
      for (const x of list.slice(0, 20)) {
        const area = String(x.area ?? "").trim();
        if (!area) throw bad("Each rate needs an area.");
        const raw = x.rate_per_hour ?? x.rate;
        if (raw == null || raw === "") { await ctx.agentos(["price", "clear", area]); changed.push(area); continue; }
        const rate = Number(raw);
        if (!(Number.isFinite(rate) && rate >= 0 && rate <= 1_000_000)) throw bad(`Rate for ${area} must be rupees per hour.`);
        const args = ["price", "set", area, String(rate)];
        if (x.note != null && String(x.note).trim()) args.push("--note", clip(String(x.note).trim(), 200));
        await ctx.agentos(args);
        changed.push(area);
      }
      const r = await ctx.agentos(["price"]);
      const priced = (r?.rates ?? []).filter((x: Rate) => x.rate_per_hour != null);
      return ctx.json({ ok: true, changed, rates: r?.rates ?? [], count: priced.length, enough: priced.length >= 2, noRate: NO_RATE });
    }
    if (ctx.path === "/blocks" && ctx.method === "GET") {
      const date = ctx.url.searchParams.get("date") || istDate();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad("date is YYYY-MM-DD.");
      const b = ctx.store.bootstrap();
      const day = b.week.days.find((d: any) => d.date === date);
      if (!day) throw bad(`Only the next seven days are available (${b.week.from} to ${b.week.to}).`);
      const rates: Rate[] = ((await ctx.agentos(["price"]))?.rates ?? []);
      // Open work per area and its unit: the median estimate of the area's open tasks, else the learned median.
      const work: Record<string, { open: number; unitMinutes: number | null }> = {};
      const est: Record<string, number[]> = {};
      for (const t of b.today.tasks as any[]) {
        if (!["todo", "doing", "inbox"].includes(t.status) || !t.area) continue;
        (work[t.area] ??= { open: 0, unitMinutes: null }).open++;
        if (t.estimateMinutes) (est[t.area] ??= []).push(t.estimateMinutes);
      }
      for (const [area, w] of Object.entries(work)) {
        const a = (est[area] ?? []).sort((x, y) => x - y);
        w.unitMinutes = a.length ? a[Math.floor(a.length / 2)] : (b.estimates?.byArea?.[area]?.minutes ?? null);
      }
      const items: { id: string; kind: "event" | "task"; title: string; area: string | null; start: string; end: string; s: number; e: number; minutes: number }[] = [];
      for (const ev of day.events as any[]) {
        if (ev.allDay || SLEEP.test(ev.title) || Date.parse(ev.end) - Date.parse(ev.start) >= 18 * 36e5) continue;
        const s = Math.max(0, minOf(ev.start, date)), e = Math.min(1440, minOf(ev.end, date));
        if (e - s < 5) continue;
        items.push({ id: ev.id, kind: "event", title: ev.title, area: ev.area ?? null, start: ev.start, end: ev.end, s, e, minutes: e - s });
      }
      for (const t of b.today.tasks as any[]) {
        if (!t.scheduled || t.status === "dropped" || t.status === "done") continue;
        const s = minOf(t.scheduled.start, date);
        if (s < 0 || s >= 1440) continue;
        const e = Math.min(1440, minOf(t.scheduled.end, date));
        items.push({ id: t.id, kind: "task", title: t.title, area: t.area ?? null, start: t.scheduled.start, end: t.scheduled.end, s, e, minutes: e - s });
      }
      items.sort((x, y) => x.s - y.s);
      const priced = rates.filter((r) => r.rate_per_hour != null);
      const areaName = (slug: string | null) => rates.find((r) => r.area === slug)?.name ?? slug ?? "No area";
      const blocks = items.map((it) => ({ id: it.id, kind: it.kind, title: it.title, area: it.area, areaName: areaName(it.area), start: it.start, end: it.end,
        from: hhmm(it.s), to: hhmm(it.e), minutes: it.minutes, displaces: displacement(it, rates, work) }));
      return ctx.json({ date, weekday: day.weekday, enough: priced.length >= 2, count: priced.length, noRate: NO_RATE, blocks,
        rates: rates.map((r) => ({ area: r.area, name: r.name, color: r.color, rate_per_hour: r.rate_per_hour })) });
    }
    return null;
  },
};
