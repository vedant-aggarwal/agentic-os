import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Exercise the actual HTTP routes, including the early missing-token response.
const root = mkdtempSync(join(tmpdir(), "aos-connectivity-"));
mkdirSync(join(root, "data"));
let child: ReturnType<typeof Bun.spawn>;
let base = "";
beforeAll(async () => {
  const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = listener.port;
  listener.stop(true);
  base = `http://127.0.0.1:${port}`;
  child = Bun.spawn([process.execPath, "server/index.ts"], {
    cwd: resolve(import.meta.dir, ".."), stdout: "ignore", stderr: "pipe",
    env: { ...process.env, PORT: String(port), DATA_DIR: join(root, "data"), OWNER_DB: join(root, "owner.db"),
      OWNER_EVENTS: join(root, "events.json"), MOD_SCHEDULER: "off", AI_PREFETCH: "off" },
  });
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${await new Response(child.stderr).text()}`);
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch {}
    await Bun.sleep(100);
  }
  throw new Error("Isolated test server did not start");
}, 15000);
afterAll(async () => { child?.kill(); if (child) await child.exited; });

for (const origin of ["capacitor://localhost", "ionic://localhost", "https://localhost", "http://localhost"]) {
  test(`${origin} can read the reconnect probe`, async () => {
    const r = await fetch(`${base}/healthz`, { headers: { Origin: origin } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(r.headers.get("Vary")).toContain("Origin");
  });
}
test("missing and expired sessions remain readable 401s, not network errors", async () => {
  for (const authorization of [null, "Bearer invalid-test-session"]) {
    const headers: Record<string, string> = { Origin: "capacitor://localhost" };
    if (authorization) headers.Authorization = authorization;
    const r = await fetch(`${base}/api/v1/bootstrap`, { headers });
    expect(r.status).toBe(401);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("capacitor://localhost");
    expect((await r.json()).error).toBeTruthy();
  }
});
test("native preflights work for health and API; unrelated origins are refused", async () => {
  for (const path of ["/healthz", "/api/v1/bootstrap"]) {
    for (const origin of ["capacitor://localhost", "https://untrusted.example"]) {
      const r = await fetch(`${base}${path}`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,content-type" } });
      expect(r.status).toBe(origin.startsWith("capacitor:") ? 204 : 403);
      expect(r.headers.get("Access-Control-Allow-Origin")).toBe(origin.startsWith("capacitor:") ? origin : null);
    }
  }
  const r = await fetch(`${base}/healthz`, { headers: { Origin: "https://untrusted.example" } });
  expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
});
