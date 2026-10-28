// Demand radar through the real CLI on a throwaway DB: single asks, a chat export import that
// dedupes on re-import, the cluster list and status changes. Clustering itself needs Claude and
// lives in the phone server; here the tables and the splitter are what is tested.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitAsks } from "./demand";

const dir = mkdtempSync(join(tmpdir(), "agentos-demand-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], {
    env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") },
  });
  return { text: r.stdout.toString(), code: r.exitCode };
}
const json = (...args: string[]) => JSON.parse(cli(...args, "--json").text);
const SLOW = 60_000;

const CHAT = `12/10/26, 9:41 pm - Sam Lake: Can customers see their order status on WhatsApp? They keep calling the shop.
12/10/26, 9:42 pm - Alex: Noted, will check.
13/10/26, 10:05 am - Sam Lake: Also the festival price list, can it go out as one PDF
to all dealers at once?`;

describe("demand splitter", () => {
  test("dated chat lines become one ask each with IST times, the owner's lines can be skipped, short lines are noise", () => {
    const asks = splitAsks(CHAT, { me: "Alex" });
    expect(asks.map((a) => a.text)).toEqual([
      "Can customers see their order status on WhatsApp? They keep calling the shop.",
      "Also the festival price list, can it go out as one PDF to all dealers at once?",
    ]);
    expect(asks[0].askedAt).toBe("2026-10-12T16:11:00.000Z");
    expect(splitAsks(CHAT)).toHaveLength(3);
  });
  test("an email thread splits on blank lines", () => {
    expect(splitAsks("Hi,\nwe need the dues report by dealer every Monday morning.\n\nAnd a photo for every product.\n\nThanks")).toEqual([
      { text: "Hi, we need the dues report by dealer every Monday morning.", askedAt: null },
      { text: "And a photo for every product.", askedAt: null },
    ]);
  });
});

describe("demand module", () => {
  test("add files an ask; import reads a chat file once", () => {
    const r = json("demand", "add", "Order status on WhatsApp for customers", "--client", "dad-shop", "--source", "lead", "--at", "2026-10-01");
    expect(r.item).toMatchObject({ source: "lead", client: "dad-shop", askedAt: "2026-10-01T00:00:00.000Z", cluster: null });
    expect(cli("demand", "add", "x", "--source", "sms", "--json").code).toBe(2);
    const file = join(dir, "chat.txt");
    writeFileSync(file, CHAT);
    const i = json("demand", "import", "--file", file, "--source", "chat", "--client", "tcs", "--me", "Alex");
    expect(i).toMatchObject({ ok: true, added: 2, skipped: 0, total: 2 });
    expect(json("demand", "import", "--file", file, "--source", "chat", "--client", "tcs", "--me", "Alex")).toMatchObject({ added: 0, skipped: 2 });
    const l = json("demand");
    expect(l).toMatchObject({ count: 0, unclustered: 3, clusters: [] });
  }, SLOW);

  test("clusters rank by distinct clients then asks; show has items and the candidate; status changes", () => {
    const d = new Database(dbPath);
    try {
      const now = new Date().toISOString();
      const ids = (d.query("SELECT id FROM demand_items ORDER BY id").all() as any[]).map((r) => r.id);
      d.query("INSERT INTO demand_clusters (id, title, count, clients, item_ids, status, created_at) VALUES (1, 'WhatsApp order status', 2, ?, ?, 'new', ?)")
        .run(JSON.stringify(["dad-shop", "tcs"]), JSON.stringify(ids.slice(0, 2)), now);
      d.query("INSERT INTO demand_clusters (id, title, count, clients, item_ids, status, created_at) VALUES (2, 'Dealer price list PDF', 3, ?, ?, 'new', ?)")
        .run(JSON.stringify(["tcs"]), JSON.stringify(ids.slice(2)), now);
      d.query("UPDATE demand_items SET cluster_id = 1 WHERE id IN (?, ?)").run(ids[0], ids[1]);
      d.query("UPDATE demand_items SET cluster_id = 2 WHERE id = ?").run(ids[2]);
      d.query("INSERT INTO demand_candidates (cluster_id, spec_md, price_guess, price_is_guess, landing_md, created_at) VALUES (1, '# Spec', 'Rs 999/month', 1, '# Landing', ?)").run(now);
    } finally { d.close(); }
    const l = json("demand");
    expect(l.clusters.map((c: any) => [c.id, c.clientCount, c.count, c.candidate])).toEqual([[1, 2, 2, true], [2, 1, 3, false]]);
    expect(l.unclustered).toBe(0);
    const s = json("demand", "show", "1");
    expect(s.cluster).toMatchObject({ id: 1, title: "WhatsApp order status", clients: ["dad-shop", "tcs"] });
    expect(s.items).toHaveLength(2);
    expect(s.candidate).toMatchObject({ spec: "# Spec", priceGuess: "Rs 999/month", priceIsGuess: true, landing: "# Landing" });
    expect(json("demand", "status", "2", "dropped").cluster.status).toBe("dropped");
    expect(json("demand").clusters.map((c: any) => c.id)).toEqual([1]);
    expect(json("demand", "--all").clusters.map((c: any) => c.id)).toEqual([1, 2]);
    expect(cli("demand", "status", "2", "later", "--json").code).toBe(2);
    expect(cli("demand", "show", "9", "--json").code).toBe(2);
    const toon = cli("demand").text;
    expect(toon).toContain("clusters[1]{");
  }, SLOW);
});
