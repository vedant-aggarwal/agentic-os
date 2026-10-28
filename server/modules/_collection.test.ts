// The store contract (server half): upsert by client id, last write wins, soft deletes, the since cursor.
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { collectionDDL, mountCollection } from "./_collection";

function setup() {
  const db = new Database(":memory:");
  const spec = { table: "money_expenses", columns: { amount: "real", note: "text", tags: "json", paid: "bool" } as const };
  db.exec(collectionDDL(spec));
  const col = mountCollection({ ...spec, validate: (d: any) => (d.amount == null || typeof d.amount === "number" ? null : "amount is a number") });
  const call = async (method: string, path: string, body?: unknown) => {
    const url = new URL(`http://x/api/v1/mod/money${path}`);
    const ctx: any = {
      method, path: url.pathname.replace("/api/v1/mod/money", ""), url, db: () => db,
      body: async () => body, json: (d: unknown, s = 200) => Response.json(d, { status: s }), fail: (s: number, m: string) => Response.json({ error: m }, { status: s }),
    };
    const r = await col.handle(ctx, "/expenses");
    return r ? { status: r.status, json: await r.json() as any } : null;
  };
  return { db, col, call };
}

test("put, get and list round-trip a doc with its columns and extra fields", async () => {
  const { call } = setup();
  const put = await call("PUT", "/expenses/c_1", { amount: 40, note: "Chai", tags: ["food"], paid: true, where: "City College", updated_at: "2026-10-22T10:00:00.000Z" });
  expect(put!.status).toBe(200);
  expect(put!.json.item).toMatchObject({ id: "c_1", amount: 40, note: "Chai", tags: ["food"], paid: true, where: "City College", deleted_at: null });
  const list = await call("GET", "/expenses");
  expect(list!.json.items).toHaveLength(1);
  expect(Number(list!.json.cursor)).toBe(1);
  expect((await call("GET", "/expenses/c_1"))!.json.item.note).toBe("Chai");
  expect((await call("GET", "/expenses/nope"))!.status).toBe(404);
});

test("sending the same write twice makes one record (the client id is the idempotency key)", async () => {
  const { call, db } = setup();
  const doc = { id: "c_2", amount: 210, note: "Uber", updated_at: "2026-10-22T10:00:00.000Z" };
  expect((await call("POST", "/expenses", doc))!.status).toBe(201);
  expect((await call("POST", "/expenses", doc))!.status).toBe(200);
  expect((db.query("SELECT count(*) n FROM money_expenses").get() as any).n).toBe(1);
});

test("an older write loses to a newer one and gets the newer copy back", async () => {
  const { call } = setup();
  await call("PUT", "/expenses/c_3", { amount: 90, note: "new", updated_at: "2026-10-22T12:00:00.000Z" });
  const old = await call("PUT", "/expenses/c_3", { amount: 90, note: "old", updated_at: "2026-10-22T11:00:00.000Z" });
  expect(old!.json.item.note).toBe("new");
  const newer = await call("PUT", "/expenses/c_3", { amount: 95, note: "newer", updated_at: "2026-10-22T13:00:00.000Z" });
  expect(newer!.json.item).toMatchObject({ amount: 95, note: "newer" });
});

test("delete is soft and idempotent, and since returns the tombstone once", async () => {
  const { call } = setup();
  await call("PUT", "/expenses/c_4", { amount: 900, note: "Shirt" });
  const first = await call("GET", "/expenses");
  const cursor = first!.json.cursor;
  const d1 = await call("DELETE", "/expenses/c_4");
  expect(d1!.json.item.deleted_at).toBeTruthy();
  const d2 = await call("DELETE", "/expenses/c_4");
  expect(d2!.json.item.deleted_at).toBe(d1!.json.item.deleted_at);
  expect((await call("DELETE", "/expenses/never-seen"))!.status).toBe(200);
  expect((await call("GET", "/expenses"))!.json.items.map((x: any) => x.id)).toEqual([]);
  const changed = await call("GET", `/expenses?since=${cursor}`);
  expect(changed!.json.items.map((x: any) => [x.id, !!x.deleted_at])).toEqual([["c_4", true], ["never-seen", true]]);
  const after = await call("GET", `/expenses?since=${changed!.json.cursor}`);
  expect(after!.json.items).toEqual([]);
});

test("validation refuses with 400, and other paths are not this collection's", async () => {
  const { call } = setup();
  expect((await call("PUT", "/expenses/c_5", { amount: "forty" }))!.status).toBe(400);
  expect((await call("PUT", "/expenses/c_6", { id: "other", amount: 1 }))!.status).toBe(400);
  expect((await call("PUT", "/expenses/bad id", { amount: 1 }))!.status).toBe(400);
  expect(await call("GET", "/budgets")).toBeNull();
  expect(await call("GET", "/expenses/a/b")).toBeNull();
});

test("a missing table answers 503 instead of throwing; ensure creates it", async () => {
  const db = new Database(":memory:");
  const ctx = (path: string, method = "GET"): any => ({ method, path, url: new URL(`http://x${path}`), db: () => db, body: async () => ({}), json: (d: unknown, s = 200) => Response.json(d, { status: s }), fail: (s: number, m: string) => Response.json({ error: m }, { status: s }) });
  const missing = mountCollection({ table: "body_meals" });
  expect((await missing.handle(ctx("/meals"), "/meals"))!.status).toBe(503);
  const ensured = mountCollection({ table: "body_meals", ensure: true });
  expect((await ensured.handle(ctx("/meals"), "/meals"))!.status).toBe(200);
});
