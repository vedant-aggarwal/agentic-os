// Price on every block: rates are typed, never invented; an area without one says "no rate yet".
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_RATE } from "./price";

const dir = mkdtempSync(join(tmpdir(), "agentos-price-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") } });
  return { text: r.stdout.toString(), code: r.exitCode };
}
const json = (...args: string[]) => JSON.parse(cli(...args, "--json").text);
const SLOW = 60_000;

describe("agentos price", () => {
  test("every area starts without a rate and the table says so instead of showing a number", () => {
    const r = json("price");
    expect(r.count).toBe(0);
    expect(r.rates.length).toBe(7);
    expect(r.rates.every((x: any) => x.rate_per_hour === null && x.source === null)).toBe(true);
    expect(r.missing).toContain("northwind");
    expect(cli("price").text).toContain(NO_RATE);
  }, SLOW);

  test("set writes a manual rate with its note, is idempotent, and clear removes it", () => {
    const set = json("price", "set", "northwind", "1500", "--note", "Oct retainers / hours");
    expect(set).toMatchObject({ ok: true, action: "set", rate: { area: "northwind", rate_per_hour: 1500, source: "manual", note: "Oct retainers / hours" } });
    expect(json("price", "set", "northwind", "1500", "--note", "Oct retainers / hours").already).toBe(true);
    expect(json("price", "set", "Corner", "400")).toMatchObject({ ok: true, rate: { area: "corner-market", rate_per_hour: 400 } }); // name prefix resolves
    const r = json("price");
    expect(r.count).toBe(2);
    expect(r.rates.find((x: any) => x.area === "northwind").rate_per_hour).toBe(1500);
    expect(json("price", "clear", "northwind")).toMatchObject({ ok: true, action: "cleared" });
    expect(json("price").count).toBe(1);
  }, SLOW);

  test("a bad area or rate is a usage error (exit 2), never a stored number", () => {
    const bad = cli("price", "set", "nowhere", "10", "--json");
    expect(bad.code).toBe(2);
    expect(JSON.parse(bad.text).ok).toBe(false);
    expect(cli("price", "set", "northwind", "lots", "--json").code).toBe(2);
    expect(cli("price", "set", "northwind", "--json").code).toBe(2);
  }, SLOW);
});
