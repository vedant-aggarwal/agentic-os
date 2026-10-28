// Scan (v2): classify with Codex (faked here), the fast paths without it, the store collection, say-it-once, share-in, undo.
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan, __test } from "./scan";
import { kindOfUrl, normalizeFields, shapeClassified, shapeSay, CORE_ACTIONS, suggestionFor } from "./scan-kinds";

const originalFetch = globalThis.fetch;
const dirs: string[] = [];
afterEach(() => { globalThis.fetch = originalFetch; __test.tools = async () => []; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

// a 1×1 JPEG, base64
const JPEG = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

__test.tools = async () => [];
function setup(codexOut: (o: any) => any = () => ({})) {
  const db = new Database(":memory:");
  const dataDir = mkdtempSync(join(tmpdir(), "aos-scan-")); dirs.push(dataDir);
  const calls = { codex: [] as any[], agentos: [] as string[][], pushes: [] as string[], tasks: [] as any[], patches: [] as any[], ideas: [] as any[] };
  const store: any = {
    createTask: (b: any, source: string) => { const t = { id: `t${100 + calls.tasks.length}`, title: b.title, ...b, source }; calls.tasks.push(t); return t; },
    patchTask: (id: string, b: any) => { calls.patches.push([id, b]); return { id, ...b }; },
    createIdea: (b: any) => { const i = { id: `i${calls.ideas.length + 1}`, title: b.title }; calls.ideas.push(b); return i; },
    patchIdea: (id: string, b: any) => { calls.patches.push([id, b]); return { id, ...b }; },
  };
  const base: any = {
    user: { id: 1 }, owner: true, store, db: () => db, dataDir, dbPath: ":memory:", contentDbPath: "", wyn: null,
    conf: (_k: string, d: string) => d, log: () => {}, ai: null,
    codex: async (o: any) => { calls.codex.push(o); return { out: codexOut(o), text: "", ms: 5 }; },
    agentos: async (args: string[]) => { calls.agentos.push(args); return args[1] === "capture" ? { ok: true, idea: { id: 41 } } : { ok: true }; },
    push: async (title: string, body: string) => { calls.pushes.push(`${title}: ${body}`); },
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const url = new URL(`http://x/api/v1/mod/scan${path}`);
    const ctx = { ...base, req: new Request(url, { method }), url, method, path: url.pathname.replace("/api/v1/mod/scan", "") || "/",
      body: async () => body, json: (d: unknown, s = 200) => Response.json(d, { status: s }), fail: (s: number, m: string) => Response.json({ error: m }, { status: s }) };
    const r = await scan.handle(ctx);
    return r ? { status: r.status, json: (await r.json()) as any } : null;
  };
  return { db, call, calls, dataDir };
}

const receipt = () => ({ kind: "receipt", confidence: 0.93, title: "Haldiram's · ₹486", summary: "Lunch at Haldiram's, paid by UPI.", also: ["document"],
  fields_json: JSON.stringify({ merchant: "Haldiram's", total: "₹486.00", date: "2026-10-22", items: [{ name: "Raj kachori", price: 180 }, { name: "Chole bhature", price: 230 }, { name: "Masala chaas", price: 76, qty: 2 }], category: "Food & drinks", paidBy: "UPI" }) });

test("classify sends the photo, the phone's OCR and guess to Codex and shapes the answer to the contract", async () => {
  const { call, calls, dataDir } = setup(receipt);
  const r = await call("POST", "/classify", { id: "c_rcpt1", image: `data:image/jpeg;base64,${JPEG}`, ocr: "HALDIRAM'S\nTOTAL 486.00", guess: "receipt", source: "camera" });
  expect(r!.status).toBe(200);
  const it = r!.json.item;
  expect(it).toMatchObject({ id: "c_rcpt1", kind: "receipt", status: "ready", engine: "codex", title: "Haldiram's · ₹486", app: "money" });
  expect(it.fields).toMatchObject({ merchant: "Haldiram's", total: 486, currency: "INR", date: "2026-10-22", category: "Food & drinks" });
  expect(it.fields.items).toHaveLength(3);
  expect(it.suggestion).toMatchObject({ kind: "receipt", app: "money", label: "Add ₹486 to Money", where: "Money · Food & drinks" });
  expect(it.alternatives.map((a: any) => a.app)).toEqual(["brain", "today"]);
  expect(it.imageUrl).toBe("/api/v1/mod/scan/images/c_rcpt1");
  expect(calls.codex).toHaveLength(1);
  expect(calls.codex[0].images).toHaveLength(1);
  expect(calls.codex[0].prompt).toContain("HALDIRAM'S");
  expect(calls.codex[0].prompt).toContain("quick guess: receipt");
  expect(calls.codex[0].effort).toBe("low");
  // the same id again (the offline queue resending, a lost reply) answers from the first run: no second Codex call
  const again = await call("POST", "/classify", { id: "c_rcpt1", image: JPEG });
  expect(again!.json.item.kind).toBe("receipt");
  expect(calls.codex).toHaveLength(1);
  // the photo is kept for the apps and the agent
  expect(existsSync(join(dataDir, "mod", "scan", "u1", "c_rcpt1-0.jpg"))).toBe(true);
});

test("a reel or a link is read from its address without Codex", async () => {
  const { call, calls } = setup();
  globalThis.fetch = (async () => new Response('<html><head><meta property="og:title" content="How to price a website"></head></html>', { headers: { "content-type": "text/html" } })) as any;
  const reel = await call("POST", "/classify", { id: "c_reel", url: "https://www.instagram.com/reel/DAbc123/?igsh=x" });
  expect(reel!.json.item).toMatchObject({ kind: "reel", engine: "link", suggestion: { app: "content", label: "Add as an idea" } });
  expect(reel!.json.item.fields.platform).toBe("Instagram");
  const link = await call("POST", "/classify", { id: "c_link", text: "read this https://medium.com/p/price-a-site" });
  expect(link!.json.item).toMatchObject({ kind: "link", title: "read this" });
  const link2 = await call("POST", "/classify", { id: "c_link2", url: "https://medium.com/p/price-a-site" });
  expect(link2!.json.item.title).toBe("How to price a website");
  expect(calls.codex).toHaveLength(0);
});

test("an ISBN barcode becomes a book from Open Library, without Codex", async () => {
  const { call, calls } = setup();
  globalThis.fetch = (async (u: any) => String(u).includes("/isbn/") ? Response.json({ title: "Atomic Habits", number_of_pages: 320, authors: [{ key: "/authors/OL1A" }] }) : Response.json({ name: "James Clear" })) as any;
  const r = await call("POST", "/classify", { id: "c_book", barcodes: [{ value: "9780735211292", type: "ean13" }] });
  expect(r!.json.item).toMatchObject({ kind: "book", engine: "isbn", fields: { title: "Atomic Habits", author: "James Clear", pages: 320, isbn: "9780735211292" }, suggestion: { app: "mind" } });
  expect(calls.codex).toHaveLength(0);
});

test("when Codex fails the phone's guess still makes a card to file by hand, marked for a retry", async () => {
  const { call } = setup(() => { throw new Error("Codex took too long. Try again."); });
  const r = await call("POST", "/classify", { id: "c_fail", image: JPEG, guess: "food" });
  expect(r!.json.item).toMatchObject({ kind: "food", status: "ready", engine: "phone", retry: true, suggestion: { app: "body" } });
  const none = await call("POST", "/classify", { id: "c_fail2", image: JPEG });
  expect(none!.json.item).toMatchObject({ status: "failed", retry: true });
  // a failed one is classified again on the next send
  expect((await call("POST", "/classify", { id: "c_fail2", image: JPEG }))!.json.item.status).toBe("failed");
});

test("the scan history follows the store contract: list, the phone's filed record, soft delete", async () => {
  const { call } = setup(receipt);
  await call("POST", "/classify", { id: "c_h1", image: JPEG });
  // the phone's store sends the whole doc it holds, with its filing added
  const held = (await call("GET", "/items/c_h1"))!.json.item;
  const put = await call("PUT", "/items/c_h1", { ...held, status: "filed", filed: { app: "money", by: "you", at: "2026-10-22T12:00:00.000Z" }, updated_at: new Date(Date.now() + 1000).toISOString() });
  expect(put!.json.item).toMatchObject({ status: "filed", filed: { app: "money" }, fields: { merchant: "Haldiram's" } });
  const list = await call("GET", "/items");
  expect(list!.json.items.map((x: any) => x.id)).toContain("c_h1");
  const bad = await call("PUT", "/items/c_h2", { id: "c_h2", kind: "spaceship" });
  expect(bad!.status).toBe(400);
});

test("say it once: one sentence becomes entries per app; apply files them on the PC and undo takes one back", async () => {
  const { call, calls } = setup((o) => {
    expect(o.prompt).toContain("Spent ₹120");
    return { reply: "Two things: the samosas and Dad's list.", items: [
      { action: "task", app: "today", title: "Task", detail: "Send Dad the Diwali stock list · Sun", args_json: JSON.stringify({ title: "Send Dad the Diwali stock list", due: "2026-10-25", at: "18:00" }) },
      { action: "content", app: "content", title: "Content idea", detail: "Scarf styling in 30 seconds", args_json: JSON.stringify({ title: "Scarf styling in 30 seconds" }) },
      { action: "note", app: "brain", title: "Moment", detail: "Samosas with Mom and Dad", args_json: JSON.stringify({ text: "Spent ₹120 on samosas with Mom and Dad", aspect: "family", person: "Dad" }) },
    ] };
  });
  const planned = await call("POST", "/say", { text: "Spent ₹120 on samosas with Mom and Dad. Dad ko Sunday tak Diwali list bhejni hai." });
  expect(planned!.json.items).toHaveLength(3);
  expect(planned!.json.items[0]).toMatchObject({ action: "task", app: "today", args: { title: "Send Dad the Diwali stock list", due: "2026-10-25" } });
  const applied = await call("POST", "/say/apply", { id: "say_1", text: "…", items: planned!.json.items });
  const res = applied!.json.item.results;
  expect(res[0]).toMatchObject({ ok: true, app: "today", ref: "t100", undo: { type: "task", id: "t100" } });
  expect(calls.tasks[0].scheduled.start).toBe("2026-10-25T12:30:00.000Z");
  expect(res[1]).toMatchObject({ ok: true, app: "content", ref: "c41", undo: { type: "content", id: "c41" } });
  expect(calls.agentos[0]).toEqual(["content", "capture", "Scarf styling in 30 seconds", "--source", "agent"]);
  // the Brain's server half isn't built in this test: the phone files the note (api.remember)
  expect(res[2]).toMatchObject({ ok: true, app: "brain", phone: { bus: "remember", aspect: "family", person: "Dad" } });
  // a resend files nothing twice
  await call("POST", "/say/apply", { id: "say_1", items: planned!.json.items });
  expect(calls.tasks).toHaveLength(1);
  const u = await call("POST", "/items/say_1/undo", { n: 0 });
  expect(calls.patches).toEqual([["t100", { status: "dropped" }]]);
  expect(u!.json.item.results[0].undone).toBe(true);
  expect(u!.json.item.status).toBe("filed");
});

test("a note goes through the Brain's own tool when it exists, and its undo forgets it", async () => {
  const ran: any[] = [];
  __test.tools = async () => [
    { module: "brain", name: "brain_remember", auto: true, description: "Save", input: {}, run: async (_c: any, a: any) => { ran.push(["remember", a]); return { saved: { id: "b_9", folder: "Family" } }; } },
    { module: "brain", name: "brain_forget", auto: false, description: "Delete", input: {}, run: async (_c: any, a: any) => { ran.push(["forget", a]); return { forgot: a.id }; } },
  ] as any;
  const { call } = setup();
  const applied = await call("POST", "/say/apply", { id: "say_b", items: [{ action: "note", app: "brain", title: "Moment", detail: "Samosas", args: { text: "Samosas with Dad", aspect: "family", person: "Dad" } }] });
  expect(applied!.json.item.results[0]).toMatchObject({ ok: true, app: "brain", ref: "b_9", where: "Brain › Family", undo: { type: "tool", module: "brain", tool: "brain_forget", args: { id: "b_9" } } });
  expect(ran[0]).toEqual(["remember", { text: "Samosas with Dad", aspect: "family", person: "dad", kind: "note" }]);
  await call("POST", "/items/say_b/undo");
  expect(ran[1]).toEqual(["forget", { id: "b_9" }]);
});

test("share-in files at once and says so: a reel to Content ideas (undoable), text through say-it-once", async () => {
  const { call, calls } = setup(() => ({ reply: "", items: [{ action: "task", app: "today", title: "Task", detail: "Diwali list", args_json: JSON.stringify({ title: "Send Dad the Diwali stock list" }) }] }));
  globalThis.fetch = (async () => new Response("<title>Scarf styling</title>", { headers: { "content-type": "text/html" } })) as any;
  const reel = await call("POST", "/share", { id: "sh_r1", url: "https://www.instagram.com/reel/XYZ/", text: "" });
  expect(reel!.status).toBe(201);
  expect(reel!.json.item).toMatchObject({ kind: "reel", status: "filed", filed: { app: "content", ref: "c41", by: "wyn", undo: { type: "content", id: "c41" } } });
  expect(calls.pushes[0]).toContain("Content · Ideas");
  const again = await call("POST", "/share", { id: "sh_r1", url: "https://www.instagram.com/reel/XYZ/" });
  expect(again!.json.item.id).toBe("sh_r1");
  expect(calls.agentos.filter((a) => a[1] === "capture")).toHaveLength(1);
  const undone = await call("POST", "/items/sh_r1/undo");
  expect(undone!.json.item.status).toBe("undone");
  expect(calls.agentos.at(-1)).toEqual(["content", "idea", "c41", "--status", "dropped"]);
  const txt = await call("POST", "/share", { id: "sh_t1", text: "Dad: Diwali stock list Sunday tak bhej dena" });
  expect(txt!.json.item).toMatchObject({ kind: "say", status: "filed", source: "share" });
  expect(calls.tasks[0].title).toBe("Send Dad the Diwali stock list");
  // an image share is classified and waits for its app on the phone (the nine apps file there)
  const img = await call("POST", "/share", { id: "sh_i1", image: JPEG, text: "" });
  expect(img!.json.item.status).toBe("ready");
});

test("pure helpers: link kinds, field shapes, malformed answers", () => {
  expect(kindOfUrl("https://youtube.com/shorts/abc")).toMatchObject({ kind: "reel", platform: "YouTube" });
  expect(kindOfUrl("https://x.com/a/status/1")).toMatchObject({ kind: "link", platform: "X" });
  expect(kindOfUrl("ftp://x")).toBeNull();
  expect(normalizeFields("food", { items: [{ name: "Dal", kcal: "220" }, { name: "Roti", kcal: 120 }] })).toMatchObject({ kcal: 340 });
  expect(normalizeFields("face", { scores: { overall: 14, jawline: "6.5" } }).scores).toEqual({ overall: 10, jawline: 6.5 });
  const junk = shapeClassified({ kind: "spaceship", fields_json: "{nope" }, { kind: null });
  expect(junk).toMatchObject({ kind: "document", suggestion: { app: "brain" } });
  expect(suggestionFor("goals", { items: [{ title: "a" }, { title: "b" }] }).label).toBe("Add 2 goals");
  const s = shapeSay({ items: [{ action: "nope", app: "x", title: "Thing", detail: "remember this", args_json: "{}" }] }, CORE_ACTIONS);
  expect(s.items[0]).toMatchObject({ action: "note", args: { text: "remember this" } });
});
