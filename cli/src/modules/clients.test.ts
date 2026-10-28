// Client window through the real CLI on a throwaway DB: add a client over real projects, mint and
// revoke links, file a decision, and the public-page query the phone server runs (shipped with
// evidence, next with due dates, nothing from other clients' projects).
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeToken, linkFor } from "./clients";

process.env.AGENTOS_APP_URL = "https://app.test"; // linkFor() in this process and the CLI child agree
const dir = mkdtempSync(join(tmpdir(), "agentos-clients-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], {
    env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db"), AGENTOS_APP_URL: "https://app.test" },
  });
  return { text: r.stdout.toString(), err: r.stderr.toString(), code: r.exitCode };
}
const json = (...args: string[]) => JSON.parse(cli(...args, "--json").text);
const SLOW = 60_000;

describe("clients module", () => {
  test("add needs real projects; a client lists with its projects and no link yet", () => {
    expect(json("project", "add", "harbor-sons", "Harbor & Sons", "--area", "northwind").ok).toBe(true);
    expect(json("project", "add", "dad-shop", "Dad's shop", "--area", "northwind").ok).toBe(true);
    const bad = cli("clients", "add", "tcs", "--name", "Leo", "--projects", "nope", "--json");
    expect(bad.code).toBe(2);
    expect(JSON.parse(bad.text).error).toContain('No project "nope"');
    const r = json("clients", "add", "tcs", "--name", "Harbor & Sons", "--projects", "harbor-sons", "--contact", "Sam", "--channel", "whatsapp:+15550100");
    expect(r.ok).toBe(true);
    expect(r.client).toMatchObject({ slug: "tcs", name: "Harbor & Sons", projects: ["harbor-sons"], contact: "Sam", link: null, openDecisions: 0 });
    expect(json("clients").clients.map((c: any) => c.slug)).toEqual(["tcs"]);
    expect(json("clients", "add", "tcs", "--name", "Again", "--projects", "")).toMatchObject({ already: true });
  }, SLOW);

  test("link mints one token and keeps it; --rotate and revoke end it", () => {
    const a = json("clients", "link", "tcs");
    expect(a).toMatchObject({ ok: true, action: "minted" });
    expect(a.url).toMatch(/^https:\/\/app\.test\/c\/[A-Za-z0-9_-]{20,}$/);
    expect(json("clients", "link", "tcs")).toMatchObject({ action: "existing", url: a.url });
    expect(json("clients").clients[0].link).toBe(a.url);
    const b = json("clients", "link", "tcs", "--rotate");
    expect(b.action).toBe("minted");
    expect(b.url).not.toBe(a.url);
    const d = new Database(dbPath);
    try {
      expect((d.query("SELECT count(*) n FROM clients_tokens WHERE client_slug = 'tcs' AND revoked_at IS NULL").get() as any).n).toBe(1);
      expect(json("clients", "revoke", "tcs")).toMatchObject({ ok: true, tokens: 1 });
      expect((d.query("SELECT count(*) n FROM clients_tokens WHERE revoked_at IS NULL").get() as any).n).toBe(0);
      const t = activeToken(d, "tcs");
      expect(t.minted).toBe(true);
      expect(linkFor(t.token)).toBe(`https://app.test/c/${t.token}`);
    } finally { d.close(); }
  }, SLOW);

  test("ask files an open decision with options; decisions lists it; set changes fields", () => {
    const r = json("clients", "ask", "tcs", "Which header colour?", "--options", "Plum|Ivory", "--source", "t12");
    expect(r.decision).toMatchObject({ client: "tcs", question: "Which header colour?", options: ["Plum", "Ivory"], source: "t12", status: "open" });
    expect(json("clients", "decisions").decisions).toHaveLength(1);
    expect(json("clients").clients[0].openDecisions).toBe(1);
    expect(cli("clients", "decisions").text).toContain("Plum | Ivory");
    const s = json("clients", "set", "tcs", "--projects", "harbor-sons,dad-shop", "--active", "false");
    expect(s.client).toMatchObject({ projects: ["harbor-sons", "dad-shop"], active: false });
    expect(cli("clients", "link", "tcs", "--json").code).toBe(2);
    expect(json("clients", "set", "tcs", "--active", "true", "--projects", "harbor-sons").client.active).toBe(true);
  }, SLOW);

  test("the page query: done tasks with evidence in the client's projects (14 days), open ones with due dates, other projects excluded", () => {
    expect(json("project", "add", "other", "Someone else", "--area", "northwind").ok).toBe(true);
    const t1 = json("add", "PIN login shipped", "--project", "harbor-sons").task.id;
    expect(json("done", t1, "--evidence", "https://harborline-os.cornermarket.example/team and D:\\work\\x\\deck.html").ok).toBe(true);
    const t2 = json("add", "No evidence yet", "--project", "harbor-sons").task.id;
    expect(json("done", t2).ok).toBe(true);
    json("add", "Festival plan", "--project", "harbor-sons", "--due", "2026-11-01");
    json("add", "Someone else's task", "--project", "other", "--due", "2026-11-01");
    const d = new Database(dbPath);
    try {
      const projects = JSON.parse((d.query("SELECT project_slugs FROM clients_clients WHERE slug = 'tcs'").get() as any).project_slugs);
      const q = projects.map(() => "?").join(",");
      const shipped = d.query(`SELECT title, evidence FROM tasks WHERE status = 'done' AND evidence IS NOT NULL AND project IN (${q}) AND done_at >= ? ORDER BY done_at DESC`)
        .all(...projects, new Date(Date.now() - 14 * 864e5).toISOString()) as any[];
      expect(shipped.map((t) => t.title)).toEqual(["PIN login shipped"]);
      const next = d.query(`SELECT title, due FROM tasks WHERE status IN ('todo','doing') AND project IN (${q}) ORDER BY due IS NULL, due`).all(...projects) as any[];
      expect(next).toEqual([{ title: "Festival plan", due: "2026-11-01" }]);
    } finally { d.close(); }
  }, SLOW);
});
