// Price on every block: what an hour of each area is worth, typed by the user, never invented.
// The phone server reads price_rates to write "two hours of admin here costs one Pulse Chat task" under
// each block; an area without a rate shows "no rate yet" everywhere and never a number.
//   agentos price                        rates per area
//   agentos price set <area> <rate>      rupees per hour (--note "where the number comes from")
//   agentos price clear <area>           forget a rate
import type { Database } from "bun:sqlite";
import type { Args, ModCtx, Module } from "./types";

export const NO_RATE = "no rate yet";

/** slug, name (case-insensitive) or a unique prefix of either; usage error otherwise. */
export function findArea(db: Database, input: string | undefined, UserError: ModCtx["UserError"]): string {
  const s = String(input ?? "").trim().toLowerCase();
  const rows = db.query("SELECT slug, name FROM areas ORDER BY sort").all() as { slug: string; name: string }[];
  if (!s) throw new UserError(`Which area? One of: ${rows.map((r) => r.slug).join(", ")}`);
  const exact = rows.find((r) => r.slug === s || r.name.toLowerCase() === s);
  if (exact) return exact.slug;
  const hits = rows.filter((r) => r.slug.startsWith(s) || r.name.toLowerCase().startsWith(s));
  if (hits.length === 1) return hits[0].slug;
  throw new UserError(hits.length ? `"${input}" matches ${hits.map((r) => r.slug).join(" and ")}. Use the slug.` : `No area "${input}". Areas: ${rows.map((r) => r.slug).join(", ")}`);
}

export function rateRows(db: Database) {
  return (db.query(`SELECT a.slug AS area, a.name, a.color, r.rate_per_hour, r.source, r.note, r.updated_at
    FROM areas a LEFT JOIN price_rates r ON r.area = a.slug ORDER BY a.sort`).all() as any[]).map((r) => ({
    area: r.area, name: r.name, color: r.color,
    rate_per_hour: r.rate_per_hour ?? null, source: r.rate_per_hour == null ? null : r.source, note: r.note ?? null, updated_at: r.updated_at ?? null,
  }));
}

export const price: Module = {
  name: "price",
  help: `agentos price                     rupees an hour per area (typed by you); areas without one say "${NO_RATE}"
agentos price set <area> <rate> [--note "..."]   e.g. agentos price set northwind 1500 --note "Oct retainers / hours"
agentos price clear <area>`,
  migrate(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS price_rates (area TEXT PRIMARY KEY REFERENCES areas(slug) ON DELETE CASCADE,
      rate_per_hour REAL NOT NULL, source TEXT NOT NULL DEFAULT 'manual', note TEXT, updated_at TEXT NOT NULL)`);
  },
  run(db, a: Args, ctx) {
    const sub = a._[1];
    if (sub === "set") {
      const area = findArea(db, a._[2], ctx.UserError);
      const rate = Number(a._[3]);
      if (!(a._[3] !== undefined && Number.isFinite(rate) && rate >= 0 && rate <= 1_000_000)) throw new ctx.UserError("Rate is rupees per hour, 0 to 1,000,000: agentos price set northwind 1500");
      const note = ctx.str(a, "note") ?? null;
      const cur = db.query("SELECT rate_per_hour, note FROM price_rates WHERE area = ?").get(area) as any;
      if (cur && cur.rate_per_hour === rate && (cur.note ?? null) === note) return ctx.out({ already: true, rate: rateRows(db).find((r) => r.area === area) }, ["agentos price"]);
      db.query(`INSERT INTO price_rates (area, rate_per_hour, source, note, updated_at) VALUES (?, ?, 'manual', ?, ?)
        ON CONFLICT(area) DO UPDATE SET rate_per_hour = excluded.rate_per_hour, source = 'manual', note = excluded.note, updated_at = excluded.updated_at`)
        .run(area, rate, note, ctx.iso());
      return ctx.out({ ok: true, action: cur ? "updated" : "set", rate: rateRows(db).find((r) => r.area === area) }, ["agentos price"]);
    }
    if (sub === "clear") {
      const area = findArea(db, a._[2], ctx.UserError);
      const r = db.query("DELETE FROM price_rates WHERE area = ?").run(area);
      return ctx.out({ ok: true, action: r.changes ? "cleared" : "already", area }, ["agentos price"]);
    }
    if (sub) throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos price [set <area> <rate> | clear <area>]`);
    const rows = rateRows(db);
    const missing = rows.filter((r) => r.rate_per_hour == null).map((r) => r.area);
    ctx.out({
      count: rows.length - missing.length,
      rates: rows.map((r) => (ctx.jsonOut ? r : { area: r.area, name: r.name, rate_per_hour: r.rate_per_hour ?? NO_RATE, note: r.note ?? "" })),
      ...(ctx.jsonOut ? { missing } : missing.length ? { missing: missing.join(" ") } : {}),
    }, [`agentos price set ${missing[0] ?? "<area>"} <rupees per hour> --note "<source of the number>"`]);
  },
};
