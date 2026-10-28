// The Brain module on a temp agentos DB with a stand-in `brain` CLI (a node script that prints TOON like the real one):
// items through the store contract with the agent's read on the way in (suggestions, auto-filing what's shared), the
// summary, search across both libraries by person, date and place, person files with the vault's entity, filing, the
// vault routes (owner only, cached), capture, and every agent tool.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "aos-brain-"));
const dbPath = join(dir, "agentos.db");
const captured = join(dir, "captured.txt");
const REAL_TOON = join(process.env.APPDATA ?? "", "npm", "node_modules", "brain-axi", "node_modules", "@toon-format", "toon", "dist", "index.mjs");
const HAS_TOON = existsSync(REAL_TOON);
// the stand-in CLI: same TOON shapes as brain-axi for the commands the module uses
writeFileSync(join(dir, "brain.js"), `
const a = process.argv.slice(2); const fs = require("fs");
const out = (s) => { process.stdout.write(s.replace(/^\\n/, "")); };
if (!a.length) out(\`
summary:
  notes: 12
folders[3]{folder,count}:
  journal,5
  entity,3
  meta,1
domains[2]{domain,count}:
  people,3
  money,2
recent_journal[1]{id,updated,title}:
  2026-10-22-shop-day,2026-10-22,Shop day
\`);
else if (a[0] === "search") out(\`
count: 2 of 2 total
results[2]{id,domain,updated,score,summary}:
  entity/dad,people,2026-10-05,10.5,"Alex's father, Morgan & Co. owner"
  journal/2026-10-22-shop-day,money,2026-10-22,7.5,Listings at the shop with Dad
\`);
else if (a[0] === "ask") out(\`
mode: hybrid
confidence: high
answer:
  source: entity/dad
  title: Dad
  updated: 2026-10-05
  term_coverage: 100%
  similarity: "0.62"
evidence: "He runs [[entity/morgan-co|the shop]] in Midtown."
also[1]: journal/2026-10-22-shop-day
\`);
else if (a[0] === "show" && a[1] === "entity/dad") out(\`
note:
  id: dad
  path: entity/dad
  kind: entity
  domain: people
  status: live
  updated: 2026-10-05
  summary: "Alex's father"
body: "\\\\n# Dad\\\\n\\\\nRuns the shop. See [[note/corner-market-business]]."
\`);
else if (a[0] === "show") { process.stderr.write('error: "no note with id \\\\"' + a[1] + '\\\\""\\ncode: NOT_FOUND\\n'); process.exit(1); }
else if (a[0] === "context") out(\`
note:
  id: \${a[1]}
outbound[1]{depth,edge,from,to,resolved}:
  1,"-",\${a[1]},note/corner-market-business,true
inbound[1]{edge,from}:
  about,journal/2026-10-22-shop-day
\`);
else if (a[0] === "project") out(\`
count: 1 projects
projects[1]{id,status,updated,context_files}:
  corner-market-website,live,2026-10-11,3
\`);
else if (a[0] === "capture") { fs.appendFileSync(${JSON.stringify(captured)}, a.slice(1).join(" ") + "\\n"); out("ok: captured\\n"); }
`);
process.env.BRAIN_CLI = join(dir, "brain.js");
process.env.BRAIN_NODE = Bun.which("node") ?? "node";
process.env.BRAIN_TOON = REAL_TOON;
process.env.BRAIN_EMBED = "off";

const { brain, enrich, peopleOf } = await import("./brain");
const V = await import("./brain-vault");
const { ITEMS_DDL, VECTORS_DDL, normalizeItem } = await import("../../cli/src/modules/brain.ts");

let db: Database;
const ist = (d: string, hm: string) => new Date(`${d}T${hm}:00+05:30`).toISOString();
const nowIso = () => new Date().toISOString();
async function call(method: string, path: string, body?: unknown, { owner = true } = {}) {
  const url = new URL(`http://x/api/v1/mod/brain${path}`);
  const ctx: any = {
    method, path: url.pathname.replace("/api/v1/mod/brain", "") || "/", url, owner, user: { id: 1, role: owner ? "owner" : "member" }, dbPath,
    db: () => db, body: async () => body, json: (d: unknown, s = 200) => Response.json(d, { status: s }), fail: (s: number, m: string) => Response.json({ error: m }, { status: s }), log: () => {},
  };
  const r = await brain.handle(ctx);
  return r ? { status: r.status, json: (await r.json()) as any } : null;
}
const jobCtx = (owner = true): any => ({ dbPath, owner, user: { id: 1, role: owner ? "owner" : "member" }, db: () => db, log: () => {} });
const tool = (name: string) => brain.tools!.find((t) => t.name === name)!;

beforeAll(() => { db = new Database(dbPath); db.exec(ITEMS_DDL); db.exec(VECTORS_DDL); });
afterAll(() => { db?.close(); try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} });

describe("items through the store contract", () => {
  test("a typed note with a folder is filed as he sent it; the response is the stored copy", async () => {
    const r = await call("PUT", "/items/n_1", { id: "n_1", text: "Bench 50 kg × 5, 5, 4", aspect: "body", source: "typed", updated_at: ist("2026-10-22", "07:40"), created_at: ist("2026-10-22", "07:40") });
    expect(r!.status).toBe(200);
    expect(r!.json.item).toMatchObject({ id: "n_1", status: "filed", aspect: "body", sub: "Training", author: "you", filed_by: "you" });
  });
  test("something shared lands, and the agent files it at once when she's sure (and marks it auto)", async () => {
    const at = nowIso();
    const r = await call("POST", "/items", { id: "sh_1", text: "Dad wants the Diwali stock list by Sunday", source: "voice", status: "inbox", updated_at: at, created_at: at });
    expect(r!.status).toBe(201);
    expect(r!.json.item).toMatchObject({ status: "filed", aspect: "family", person: "dad", filed_by: "agent", auto: true, from_inbox: true });
    expect(r!.json.item.updated_at > at).toBe(true);   // newer than the phone's copy, so the phone takes it
  });
  test("an unclear share waits in the inbox with her suggestion; a held one never auto-files", async () => {
    const r = await call("POST", "/items", { id: "sh_2", text: "Scarf styling in 30 seconds", source: "share", status: "inbox", updated_at: nowIso() });
    expect(r!.json.item.status).toBe("inbox");
    expect(r!.json.item.suggest).toHaveProperty("to");
    const h = await call("POST", "/items", { id: "sh_3", text: "Paid ₹1,200 at City Electricals on GPay for the shop", source: "share", status: "inbox", hold: true, updated_at: nowIso() });
    expect(h!.json.item.status).toBe("inbox");
    expect(h!.json.item.suggest.to[0].aspect).toBe("money");
  });
  test("bad writes are refused; GET lists with a cursor; replays are no-ops", async () => {
    expect((await call("PUT", "/items/bad", { aspect: "work", text: "x" }))!.status).toBe(400);
    const l = await call("GET", "/items");
    expect(l!.json.items.length).toBeGreaterThanOrEqual(4);
    const since = await call("GET", `/items?since=${l!.json.cursor}`);
    expect(since!.json.items).toEqual([]);
    const again = await call("PUT", "/items/n_1", { id: "n_1", text: "Bench 50 kg × 5, 5, 4", aspect: "body", updated_at: ist("2026-10-22", "07:40") });
    expect(again!.json.item.text).toBe("Bench 50 kg × 5, 5, 4");
    expect((await call("DELETE", "/items/n_gone"))!.status).toBe(200);
  });
  test("enrich keeps tombstones and recomputes a suggestion when the text changes", () => {
    expect(enrich({ id: "x", deleted_at: nowIso() }, null, [])).toMatchObject({ id: "x" });
    const cur = normalizeItem({ id: "y", text: "hmm", status: "inbox" });
    const e = enrich({ ...cur, text: "Spent ₹500 on chai and printouts" }, cur, peopleOf(db));
    expect(e.suggest!.to[0].aspect).toBe("money");
  });
});

describe("summary, filing, person files", () => {
  test("summary counts folders, the inbox and what the agent filed today; members get no vault", async () => {
    const s = await call("GET", "/summary");
    expect(s!.json.folders.family.count).toBe(1);
    expect(s!.json.inbox).toBe(2);
    expect(s!.json.filedToday).toBe(1);
    expect(s!.json.private).toEqual(["romance", "soul"]);
    expect(s!.json.people.map((p: any) => p.id)).toContain("kabir");
    const m = await call("GET", "/summary", undefined, { owner: false });
    expect(m!.json.vault).toBeNull();
    if (HAS_TOON) expect(s!.json.vault).toMatchObject({ ok: true, notes: 12 });
  });
  test("inbox/file takes the suggestion, or the folder he picks; autofile leaves held items alone", async () => {
    const f = await call("POST", "/inbox/file", { id: "sh_3" });
    expect(f!.json.item).toMatchObject({ status: "filed", aspect: "money", filed_by: "you" });
    expect((await call("POST", "/inbox/file", { id: "nope" }))!.status).toBe(404);
    expect((await call("POST", "/inbox/file", { id: "sh_2", aspect: "work" }))!.status).toBe(400);
    const auto = await call("POST", "/inbox/autofile");
    expect(Array.isArray(auto!.json.filed)).toBe(true);
  });
  test("a person's file: facts, what's about them, and (owner) the vault's entity with its links", async () => {
    await tool("brain_fact").run(jobCtx(), { person: "dad", key: "Birthday", value: "14 March" });
    const r = await call("GET", "/people/dad");
    expect(r!.json.facts).toEqual([expect.objectContaining({ key: "Birthday", value: "14 March" })]);
    expect(r!.json.items.some((i: any) => i.id === "sh_1")).toBe(true);
    if (HAS_TOON) {
      expect(r!.json.vault.entity).toMatchObject({ id: "entity/dad", title: "Dad" });
      expect(r!.json.vault.notes.map((n: any) => n.id)).toContain("journal/2026-10-22-shop-day");
    }
    const m = await call("GET", "/people/dad", undefined, { owner: false });
    expect(m!.json.vault).toBeNull();
  });
});

describe("search across both libraries", () => {
  test("by person, with an answer and the vault's answer beside it", async () => {
    const r = await call("GET", "/search?q=What%20did%20I%20save%20about%20Dad%3F&agent=Wyn");
    expect(r!.json.parsed.person).toBe("dad");
    expect(r!.json.items.map((h: any) => h.id)).toContain("sh_1");
    expect(r!.json.answer.text).toContain("about Dad");
    expect(r!.json.answer.text).toContain("Wyn filed");
    if (HAS_TOON) {
      expect(r!.json.vault.answer).toMatchObject({ id: "entity/dad", title: "Dad" });
      expect(r!.json.vault.answer.evidence).toBe("He runs the shop in Midtown.");
    }
  });
  test("by date and by place, and private folders only when unlocked", async () => {
    await call("POST", "/items", { id: "pv_1", text: "The pull is strongest before cardio", aspect: "soul", updated_at: nowIso() });
    const today = await call("GET", "/search?q=what%20did%20I%20save%20today&vault=0");
    expect(today!.json.parsed.when.key).toBe("today");
    expect(today!.json.items.some((h: any) => h.id === "pv_1")).toBe(false);
    const priv = await call("GET", "/search?q=pull%20strongest&private=1&vault=0");
    expect(priv!.json.items[0].id).toBe("pv_1");
    await call("POST", "/items", { id: "pl_1", text: "Listings at the shop", aspect: "money", place: "Morgan & Co.", updated_at: nowIso() });
    const shop = await call("GET", "/search?q=From%20the%20shop&vault=0");
    expect(shop!.json.parsed.place.key).toBe("shop");
    expect(shop!.json.items.map((h: any) => h.id)).toEqual(["pl_1"]);
    const words = await call("GET", "/search?q=diwali%20stock&vault=0");
    expect(words!.json.items[0].title.marks.length).toBeGreaterThan(0);
  });
});

describe("the vault routes", () => {
  test("owner only; home, search, ask, note, browse, folder, graph; answers are cached", async () => {
    expect((await call("GET", "/vault", undefined, { owner: false }))!.status).toBe(403);
    if (!HAS_TOON) return;
    const h = await call("GET", "/vault?fresh=1");
    expect(h!.json).toMatchObject({ ok: true, notes: 12 });
    expect(h!.json.folders.map((f: any) => f.id)).toEqual(["journal", "entity"]);
    expect(h!.json.recent[0]).toMatchObject({ id: "journal/2026-10-22-shop-day", title: "Shop day" });
    const before = V.spawnCount;
    await call("GET", "/vault");
    expect(V.spawnCount).toBe(before);   // cached
    const s = await call("GET", "/vault/search?q=dad");
    expect(s!.json.results[0]).toMatchObject({ id: "entity/dad", title: "Dad", folder: "entity", domain: "people" });
    const n = await call("GET", "/vault/note?id=entity/dad");
    expect(n!.json.note).toMatchObject({ id: "entity/dad", title: "Dad", domain: "people" });
    expect(n!.json.links).toEqual([{ id: "note/corner-market-business", title: "Corner market business" }]);
    expect((await call("GET", "/vault/note?id=nope/x"))!.status).toBe(404);
    const b = await call("GET", "/vault/browse?domain=people");
    expect(b!.json.results[0].updated >= b!.json.results[1].updated).toBe(true);
    const f = await call("GET", "/vault/folder?aspect=money");
    expect(f!.json.domains).toEqual(["money"]);
    const g = await call("GET", "/vault/graph");
    expect(g!.json.nodes.some((x: any) => x.id === "project/corner-market-website")).toBe(true);
  });
  test("capture writes through the CLI only when asked, and only for the owner", async () => {
    expect((await call("POST", "/vault/capture", { text: "x" }, { owner: false }))!.status).toBe(403);
    if (!HAS_TOON) return;
    expect((await call("POST", "/vault/capture", { text: "" }))!.status).toBe(400);
    expect((await call("POST", "/vault/capture", { text: "Try the Diwali stock list format" }))!.status).toBe(201);
    expect(readFileSync(captured, "utf8")).toContain("Try the Diwali stock list format");
  });
});

describe("agent tools", () => {
  test("remember files what's clear, keeps the rest in the inbox; search, inbox, file, link, person, forget", async () => {
    const t = (n: string) => brain.tools!.find((x) => x.name === n)!;
    expect(brain.tools!.map((x) => [x.name, x.auto])).toEqual([["brain_remember", true], ["brain_search", true], ["brain_inbox", true], ["brain_file", true], ["brain_link", true], ["brain_person", true], ["brain_fact", true], ["brain_forget", false]]);
    const a: any = await t("brain_remember").run(jobCtx(), { text: "Kabir is free on Saturday evening for food" });
    expect(a.saved).toMatchObject({ folder: "Friends", person: "kabir", by: "agent" });
    expect(a.auto_filed).toBe(true);
    const b: any = await t("brain_remember").run(jobCtx(), { text: "A thought to sort", inbox: true });
    expect(b.saved.status).toBe("inbox");
    const inbox: any = await t("brain_inbox").run(jobCtx(), {});
    expect(inbox.items.some((i: any) => i.id === b.saved.id)).toBe(true);
    const f: any = await t("brain_file").run(jobCtx(), { id: b.saved.id, aspect: "growth" });
    expect(f.filed).toMatchObject({ folder: "Growth", by: "agent" });
    const l: any = await t("brain_link").run(jobCtx(), { id: a.saved.id, to: "goal:g4" });
    expect(l.item.links).toContainEqual({ kind: "goal", id: "g4" });
    await expect(t("brain_link").run(jobCtx(), { id: a.saved.id, to: "bad" })).rejects.toThrow("kind:id");
    const s: any = await t("brain_search").run(jobCtx(false), { query: "Kabir Saturday" });
    expect(s.items[0].id).toBe(a.saved.id); expect(s.vault).toBeNull();
    const p: any = await t("brain_person").run(jobCtx(false), { person: "kabir" });
    expect(p.items.some((i: any) => i.id === a.saved.id)).toBe(true);
    const g: any = await t("brain_forget").run(jobCtx(), { id: b.saved.id });
    expect(g.forgot).toBe(b.saved.id);
  });
});
