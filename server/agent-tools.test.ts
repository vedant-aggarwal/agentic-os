import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWynDb } from "./wyn-tools";
import { catalogOf, checkArgs, coreModeOf, gateCore, mcpList, modeOf, runModuleTool, setAutonomy, autonomyOf, toolsPage, undoModuleItem, useModules } from "./agent-tools";
import { decideFromApp, allowedReach, requireYes } from "./wyn-policy";
import { getItem, itemsOfDay, istDay } from "./wyn-feed";
import type { Module } from "./modules/types";

const fresh = () => openWynDb(mkdtempSync(join(tmpdir(), "at-")));
const user = { id: 1, email: "alex@example.com", name: "Alex", role: "owner", agentos_db: join(mkdtempSync(join(tmpdir(), "at-db-")), "agentos.db"), events_path: null, google_sub: null, created_at: "" } as any;
const rows: any[] = [];
const money: Module = {
  name: "money", handle: async () => null,
  tools: [
    { name: "log_expense", description: "Log an expense.", auto: true, input: { type: "object", properties: { amount: { type: "number" }, note: { type: "string" } }, required: ["amount"] },
      run: async (_c, a) => { const id = `e${rows.length + 1}`; rows.push({ id, ...a }); return { id, say: `Logged ₹${a.amount} for ${a.note ?? "something"}`, undo: { tool: "remove_expense", args: { id } } }; } },
    { name: "remove_expense", description: "Remove one expense.", auto: true, input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      run: async (_c, a) => { const i = rows.findIndex((r) => r.id === a.id); if (i >= 0) rows.splice(i, 1); return { removed: a.id }; } },
    { name: "set_budget", description: "Change a monthly budget.", auto: false, input: { type: "object", properties: { category: { type: "string" }, amount: { type: "number" } } },
      run: async (_c, a) => ({ set: a }) },
    { name: "pay_bill", description: "Pay a bill.", auto: false, input: { type: "object", properties: {} }, run: async () => ({ paid: true }) },
    { name: "summary", description: "Today in money.", auto: true, input: { type: "object", properties: {} }, run: async () => ({ line: "₹260 left today" }) },
  ],
};
const people: Module = { name: "people", handle: async () => null,
  tools: [{ name: "send_message", description: "Send a message.", auto: false, risk: ["reaches_others"], input: { type: "object", properties: {} }, run: async () => ({ sent: true }) } as any] };
useModules([money, people]);
const env = (n: any) => ({ storeFor: () => ({}) as any, ai: {} as any, dataDir: tmpdir(), wyn: () => null, push: async () => {}, n: () => n });

test("the catalog: module_tool names, apps, hard tools, summaries", () => {
  const c = catalogOf([money, people]);
  expect(c.map((e) => e.name)).toEqual(["money_log_expense", "money_remove_expense", "money_set_budget", "money_pay_bill", "money_summary", "people_send_message"]);
  expect(c.find((e) => e.name === "money_pay_bill")!.risks).toEqual(["spends_money"]);   // its name says it, and it isn't auto
  expect(c.find((e) => e.name === "money_remove_expense")!.hard).toBe(false);          // an auto tool keeps its author's word
  expect(c.find((e) => e.name === "people_send_message")!.risks).toEqual(["reaches_others"]);
  expect(c.find((e) => e.name === "people_send_message")!.app).toBe("friends");
  expect(c.find((e) => e.name === "money_summary")!.summary).toBe(true);
});

test("modes: the tool's flag, his per-app level, per-tool picks; hard tools never run alone", () => {
  const c = catalogOf([money, people]), e = (name: string) => c.find((x) => x.name === name)!;
  const p = { apps: {} as any, tools: {} as any };
  expect(modeOf(e("money_log_expense"), p)).toBe("auto");
  expect(modeOf(e("money_set_budget"), p)).toBe("ask");
  expect(modeOf(e("money_set_budget"), { apps: { money: "trusted" }, tools: {} })).toBe("auto");
  expect(modeOf(e("money_pay_bill"), { apps: { money: "trusted" }, tools: { money_pay_bill: "auto" } })).toBe("ask");
  expect(modeOf(e("money_log_expense"), { apps: { money: "ask" }, tools: {} })).toBe("ask");
  expect(modeOf(e("money_log_expense"), { apps: { money: "off" }, tools: {} })).toBe("off");
  expect(modeOf(e("money_log_expense"), { apps: {}, tools: { money_log_expense: "off" } })).toBe("off");
  expect(modeOf(e("money_set_budget"), { apps: {}, tools: { money_set_budget: "auto" } })).toBe("auto");
});

test("an auto tool runs, lands in her day, and Undo runs the module's own undo", async () => {
  const n = fresh();
  rows.length = 0;
  const r: any = await runModuleTool(env(n), user, "money_log_expense", { amount: 40, note: "chai" }, { turn: "chat-1", source: "chat" });
  expect(r.say).toBe("Logged ₹40 for chai");
  expect(rows).toHaveLength(1);
  const it = getItem(n, r.feed)!;
  expect(it.kind).toBe("did");
  expect(it.title).toBe("Logged ₹40 for chai");
  expect(it.turn).toBe("chat-1");
  expect(it.undo.tool).toBe("remove_expense");
  const u: any = await undoModuleItem(env(n), user, it);
  expect(u.item.status).toBe("undone");
  expect(rows).toHaveLength(0);
});

test("an ask-first tool asks (a one-tap ask in her day), a tap approves it, and it runs once", async () => {
  const n = fresh();
  const first: any = await runModuleTool(env(n), user, "money_set_budget", { category: "food", amount: 5000 }, { turn: "chat-2", title: "Set the food budget to ₹5,000" });
  expect(first.needs_yes).toBe(true);
  const ask = itemsOfDay(n, istDay()).find((x) => x.kind === "ask")!;
  expect(ask.approval).toBe(first.approval);
  expect(ask.args).toEqual({ category: "food", amount: 5000 });
  expect(ask.title).toBe("Set the food budget to ₹5,000?");
  expect(decideFromApp(n, first.approval, true)!.status).toBe("approved");
  const ran: any = await runModuleTool(env(n), user, "money_set_budget", { category: "food", amount: 5000 }, { turn: "tap-1", approval: first.approval });
  expect(ran.set).toEqual({ category: "food", amount: 5000 });
  expect(getItem(n, ask.id)!.status).toBe("yes");
  // single use
  const again: any = await runModuleTool(env(n), user, "money_set_budget", { category: "food", amount: 5000 }, { turn: "tap-2", approval: first.approval });
  expect(again.needs_yes).toBe(true);
});

test("a no in the app declines; off is refused; bad arguments are caught", async () => {
  const n = fresh();
  const first: any = await runModuleTool(env(n), user, "money_set_budget", { category: "fun", amount: 100 }, { turn: "chat-3" });
  decideFromApp(n, first.approval, false);
  const r: any = await runModuleTool(env(n), user, "money_set_budget", { category: "fun", amount: 100 }, { turn: "chat-4", approval: first.approval });
  expect(r.declined).toBe(true);
  setAutonomy(n, { app: "money", level: "off" });
  expect(((await runModuleTool(env(n), user, "money_log_expense", { amount: 5 }, {})) as any).error).toContain("switched off");
  setAutonomy(n, { app: "money", level: "normal" });
  expect(((await runModuleTool(env(n), user, "money_log_expense", { note: "x" }, {})) as any).error).toBe("amount is required.");
  expect(checkArgs({ type: "object", properties: { n: { type: "integer" } } }, { n: 1.5 })).toBe("n should be integer.");
});

test("the MCP list hides switched-off tools and says how she may use each", async () => {
  const n = fresh();
  setAutonomy(n, { tool: "money_pay_bill", mode: "off" });
  const list = await mcpList(n);
  expect(list.some((t) => t.name === "money_pay_bill")).toBe(false);
  const log = list.find((t) => t.name === "money_log_expense")!;
  expect(log.description).toContain("on your own");
  expect(log.inputSchema.properties.approval).toBeTruthy();
  expect(list.find((t) => t.name === "money_set_budget")!.description).toContain("Asks first");
  const page = await toolsPage(n);
  expect(page.apps.map((a: any) => a.id)).toEqual(["money", "friends"]);
  expect(autonomyOf(n).tools.money_pay_bill).toBe("off");
});

test("built-in tools follow his per-app level too", async () => {
  const n = fresh();
  expect(coreModeOf("add_task", autonomyOf(n))).toBe("auto");
  expect(coreModeOf("overview", autonomyOf(n))).toBe("auto");
  expect(await gateCore(n, "add_task", { title: "Gym" }, "chat-1")).toBeNull();
  setAutonomy(n, { app: "tasks", level: "ask" });
  const g: any = await gateCore(n, "add_task", { title: "Gym" }, "chat-1");
  expect(g.needs_yes).toBe(true);
  expect(g.ask).toContain("Gym");
  expect(coreModeOf("find_tasks", autonomyOf(n))).toBe("auto");   // reads always run
  setAutonomy(n, { app: "tasks", level: "off" });
  expect(((await gateCore(n, "add_task", { title: "Gym" }, "chat-1")) as any).error).toContain("switched off");
});

test("people he allowed: a low-stakes message needs no yes; a new person or money still does", async () => {
  const n = fresh();
  n.query("INSERT INTO prefs (key, value) VALUES ('allow.reach', ?)").run(JSON.stringify([{ to: "Dad", kinds: ["late"] }]));
  expect(allowedReach(n, "dad", "late")).toBe(true);
  expect(allowedReach(n, "dad", "money")).toBe(false);
  expect(allowedReach(n, "Kabir", "late")).toBe(false);
  const c = { n, turn: "chat-1" };
  expect(await requireYes(c, { tool: "x", args: { to: "Dad" }, risks: ["reaches_others"], summary: "Tell Dad I'm late", allowed: true })).toBeNull();
  expect(((await requireYes(c, { tool: "x", args: { to: "Dad" }, risks: ["reaches_others", "spends_money"], summary: "Pay Dad", allowed: true })) as any).needs_yes).toBe(true);
});
