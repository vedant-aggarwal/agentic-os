// Two-way sync between agentos lists/tasks and Google Tasks, using Alex's own
// OAuth client (Desktop app type, scope tasks). Google's API carries title, notes,
// status, due date, parent and order; starred, due time and repeat have no API
// field, so they stay local. Conflict rule: whichever side changed last wins, and
// every conflict is written to sync_log.
import type { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PROVIDER = "google-tasks";
const CREDS_PATH = process.env.AGENTOS_GOOGLE_CREDS || join(homedir(), ".agentos", "google-tasks.json");
const API = process.env.AGENTOS_GOOGLE_TASKS_API || "https://tasks.googleapis.com/tasks/v1";
const TOKEN_URL = process.env.AGENTOS_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPE = "https://www.googleapis.com/auth/tasks";

type Creds = { client_id: string; client_secret?: string; refresh_token?: string; access_token?: string; expires_at?: number };
type Fail = (msg: string) => never;
const stampOf = (s?: string | null) => (s ? new Date(s).toISOString() : "");

// ── credentials ─────────────────────────────────────────────────────────────
function readCreds(): Creds | null {
  if (!existsSync(CREDS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CREDS_PATH, "utf8"));
  } catch {
    return null;
  }
}
function saveCreds(c: Creds) {
  mkdirSync(dirname(CREDS_PATH), { recursive: true });
  writeFileSync(CREDS_PATH, JSON.stringify(c, null, 2), { mode: 0o600 });
}
export const connected = () => !!readCreds()?.refresh_token;

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function openBrowser(url: string) {
  try {
    const cmd = process.platform === "win32" ? ["rundll32", "url.dll,FileProtocolHandler", url]
      : process.platform === "darwin" ? ["open", url] : ["xdg-open", url];
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    /* the URL is printed anyway */
  }
}

/** Loopback + PKCE consent with the user's own Desktop OAuth client. The user signs in on Google's page; agentos never sees a password. */
export async function authorize(clientFile: string, opts: { open: boolean; print: (line: string) => void; fail: Fail }) {
  if (!existsSync(clientFile)) opts.fail(`No file at ${clientFile}. Download the Desktop OAuth client JSON from Google Cloud Console first.`);
  const raw = JSON.parse(readFileSync(clientFile, "utf8"));
  const c = raw.installed ?? raw.web ?? raw;
  if (!c.client_id) opts.fail("That JSON has no client_id. Use the file Google gives for a Desktop app OAuth client.");
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  let finish!: (v: { code?: string; error?: string }) => void;
  const got = new Promise<{ code?: string; error?: string }>((r) => (finish = r));
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.searchParams.get("state") !== state) return new Response("Not for agentos.", { status: 400 });
      finish({ code: u.searchParams.get("code") ?? undefined, error: u.searchParams.get("error") ?? undefined });
      return new Response("agentos is connected to Google Tasks. You can close this tab.");
    },
  });
  const redirect = `http://127.0.0.1:${server.port}`;
  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: c.client_id, redirect_uri: redirect, response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", code_challenge: challenge, code_challenge_method: "S256", state,
  })}`;
  opts.print(`open: ${url}`);
  if (opts.open) openBrowser(url);
  const timer = setTimeout(() => finish({ error: "timed out after 5 minutes" }), 300_000);
  const res = await got;
  clearTimeout(timer);
  server.stop(true);
  if (!res.code) opts.fail(`Google sign-in did not finish: ${res.error ?? "no code"}.`);
  const tok = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: res.code!, client_id: c.client_id, client_secret: c.client_secret ?? "", redirect_uri: redirect,
      grant_type: "authorization_code", code_verifier: verifier,
    }),
  }).then((r) => r.json() as Promise<any>);
  if (!tok.refresh_token) opts.fail(`Google returned no refresh token: ${tok.error_description ?? tok.error ?? "unknown"}.`);
  saveCreds({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: tok.refresh_token,
    access_token: tok.access_token, expires_at: Date.now() + (tok.expires_in ?? 3600) * 1000 });
  return { ok: true, action: "connected", creds: CREDS_PATH };
}

// ── API client ──────────────────────────────────────────────────────────────
class Google {
  writes = 0;
  constructor(private creds: Creds, private dry: boolean, private fail: Fail) {}
  private async token(force = false) {
    const c = this.creds;
    if (!force && c.access_token && (c.expires_at ?? 0) > Date.now() + 60_000) return c.access_token;
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret ?? "", refresh_token: c.refresh_token!, grant_type: "refresh_token" }),
    }).then((x) => x.json() as Promise<any>);
    if (!r.access_token) this.fail(`Google refused the saved sign-in (${r.error ?? "no token"}). Reconnect: agentos sync google-tasks auth --client <client_secret.json>`);
    Object.assign(c, { access_token: r.access_token, expires_at: Date.now() + (r.expires_in ?? 3600) * 1000 });
    if (r.refresh_token) c.refresh_token = r.refresh_token;
    saveCreds(c);
    return c.access_token!;
  }
  async call(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<any> {
    if (method !== "GET") {
      this.writes++;
      // A dry run reads for real and fakes writes, so the plan it prints is the real plan.
      if (this.dry) return method === "DELETE" ? null : { ...(body as object), id: `dry-${this.writes}`, updated: new Date().toISOString() };
    }
    const url = `${API}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${await this.token(attempt > 0)}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 401 && attempt === 0) continue;
      if (r.status === 204 || (r.ok && method === "DELETE")) return null;
      const data = (await r.json().catch(() => ({}))) as any;
      if (!r.ok) throw new Error(`Google Tasks ${method} ${path}: ${r.status} ${data?.error?.message ?? ""}`.trim());
      return data;
    }
  }
  async all(path: string, query: Record<string, string> = {}) {
    const items: any[] = [];
    let pageToken = "";
    do {
      const page = await this.call("GET", path, undefined, { ...query, maxResults: "100", ...(pageToken ? { pageToken } : {}) });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken ?? "";
    } while (pageToken);
    return items;
  }
}

// ── sync ────────────────────────────────────────────────────────────────────
type Link = { provider: string; kind: string; local_id: number; external_id: string; remote_list: string | null; remote_updated: string | null; synced_at: string };

export async function syncGoogleTasks(db: Database, opts: { dryRun: boolean; fail: Fail; nowIso: () => string }) {
  const creds = readCreds();
  if (!creds?.refresh_token)
    opts.fail("Google Tasks is not connected. Run once: agentos sync google-tasks auth --client <path to client_secret.json>");
  const g = new Google(creds!, opts.dryRun, opts.fail);
  const start = opts.nowIso();
  const stats = { lists_created: 0, lists_pulled: 0, lists_pushed: 0, pulled: 0, pushed: 0, created_local: 0, created_remote: 0,
    deleted_local: 0, deleted_remote: 0, moved: 0, conflicts: 0, errors: 0 };
  const errors: string[] = [];
  const conflicts: Record<string, unknown>[] = [];
  if (opts.dryRun) db.exec("BEGIN");

  const linkOf = (kind: string, localId: number) =>
    db.query("SELECT * FROM sync_links WHERE provider = ? AND kind = ? AND local_id = ?").get(PROVIDER, kind, localId) as Link | null;
  const linkByExt = (kind: string, ext: string) =>
    db.query("SELECT * FROM sync_links WHERE provider = ? AND kind = ? AND external_id = ?").get(PROVIDER, kind, ext) as Link | null;
  const saveLink = (kind: string, localId: number, ext: string, remoteList: string | null, remoteUpdated: string | null) =>
    db.query(`INSERT INTO sync_links (provider, kind, local_id, external_id, remote_list, remote_updated, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (provider, kind, local_id) DO UPDATE SET external_id = excluded.external_id, remote_list = excluded.remote_list,
      remote_updated = excluded.remote_updated, synced_at = excluded.synced_at`)
      .run(PROVIDER, kind, localId, ext, remoteList, stampOf(remoteUpdated), opts.nowIso());
  const dropLink = (kind: string, localId: number) =>
    db.query("DELETE FROM sync_links WHERE provider = ? AND kind = ? AND local_id = ?").run(PROVIDER, kind, localId);
  const log = (kind: string, localId: number | null, ext: string | null, winner: string | null, detail: string) =>
    db.query("INSERT INTO sync_log (provider, at, kind, local_id, external_id, winner, detail) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(PROVIDER, opts.nowIso(), kind, localId, ext, winner, detail);
  const conflict = (kind: string, localId: number, ext: string, winner: "local" | "remote", detail: string) => {
    stats.conflicts++;
    conflicts.push({ kind, local: kind === "list" ? `l${localId}` : `t${localId}`, remote: ext, winner, detail });
    log("conflict", localId, ext, winner, `${kind}: ${detail}`);
  };
  const guard = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      stats.errors++;
      errors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ── lists ──
  const remoteLists = await g.all("/users/@me/lists");
  const remoteListIds = new Set(remoteLists.map((l) => l.id));
  const defaultRemote = await g.call("GET", "/users/@me/lists/@default").catch(() => null);
  const localLists = () => db.query("SELECT * FROM lists ORDER BY sort, id").all() as any[];
  const defaultLocal = localLists()[0];
  for (const rl of remoteLists) {
    await guard(`list ${rl.title}`, async () => {
      const link = linkByExt("list", rl.id);
      if (link) {
        const local = db.query("SELECT * FROM lists WHERE id = ?").get(link.local_id) as any;
        if (!local) {
          // Deleted here since the last sync.
          await g.call("DELETE", `/users/@me/lists/${rl.id}`);
          dropLink("list", link.local_id);
          log("delete", link.local_id, rl.id, "local", `list ${rl.title} deleted in agentos`);
          stats.deleted_remote++;
          return;
        }
        if (local.title === rl.title) return saveLink("list", local.id, rl.id, null, rl.updated);
        const localChanged = local.updated_at > link.synced_at, remoteChanged = stampOf(rl.updated) !== link.remote_updated;
        const localWins = localChanged && (!remoteChanged || local.updated_at > stampOf(rl.updated));
        if (localChanged && remoteChanged) conflict("list", local.id, rl.id, localWins ? "local" : "remote", `title "${local.title}" vs "${rl.title}"`);
        if (localWins) {
          const r = await g.call("PATCH", `/users/@me/lists/${rl.id}`, { title: local.title });
          stats.lists_pushed++;
          return saveLink("list", local.id, rl.id, null, r?.updated ?? rl.updated);
        }
        db.query("UPDATE lists SET title = ?, updated_at = ? WHERE id = ?").run(rl.title, start, local.id);
        stats.lists_pulled++;
        return saveLink("list", local.id, rl.id, null, rl.updated);
      }
      // New on Google: Google's default list pairs with My Tasks, otherwise match by title, otherwise create.
      const unlinked = localLists().filter((l) => !linkOf("list", l.id));
      const match = (defaultRemote?.id === rl.id && unlinked.find((l) => l.id === defaultLocal.id))
        || unlinked.find((l) => l.title.toLowerCase() === String(rl.title).toLowerCase());
      if (match) return saveLink("list", match.id, rl.id, null, rl.updated);
      const areaHit = db.query("SELECT slug FROM areas WHERE lower(name) = lower(?) OR slug = lower(?)").get(rl.title, rl.title) as any;
      const created = db.query(`INSERT INTO lists (title, area, sort, created_at, updated_at)
        VALUES (?, ?, (SELECT coalesce(max(sort),0)+1 FROM lists), ?, ?) RETURNING id`).get(rl.title, areaHit?.slug ?? null, start, start) as any;
      stats.lists_created++;
      saveLink("list", created.id, rl.id, null, rl.updated);
    });
  }
  // Linked lists that vanished from Google: drop them here too, unless edited here since.
  for (const link of db.query("SELECT * FROM sync_links WHERE provider = ? AND kind = 'list'").all(PROVIDER) as Link[]) {
    if (remoteListIds.has(link.external_id)) continue;
    const local = db.query("SELECT * FROM lists WHERE id = ?").get(link.local_id) as any;
    dropLink("list", link.local_id);
    if (!local) continue;
    if (local.id === defaultLocal.id || local.updated_at > link.synced_at) {
      log("unlink", local.id, link.external_id, "local", `list ${local.title} deleted on Google; kept here`);
      continue;
    }
    db.query("UPDATE tasks SET status = 'dropped', list_id = ?, updated_at = ? WHERE list_id = ?").run(defaultLocal.id, start, local.id);
    db.query("DELETE FROM lists WHERE id = ?").run(local.id);
    log("delete", local.id, link.external_id, "remote", `list ${local.title} deleted on Google`);
    stats.deleted_local++;
  }
  for (const l of localLists()) {
    if (linkOf("list", l.id)) continue;
    await guard(`list ${l.title}`, async () => {
      const r = await g.call("POST", "/users/@me/lists", { title: l.title });
      stats.lists_pushed++;
      saveLink("list", l.id, r.id, null, r.updated);
    });
  }

  // ── tasks ──
  const remoteListOf = (localList: number) => linkOf("list", localList)?.external_id ?? null;
  const toRemote = (t: any) => ({
    title: t.title, notes: t.notes ?? "", status: t.status === "done" ? "completed" : "needsAction",
    due: t.due ? `${t.due}T00:00:00.000Z` : null, ...(t.status === "done" ? { completed: t.done_at ?? start } : { completed: null }),
  });
  const localStatus = (r: any, current?: string) =>
    r.status === "completed" ? "done" : current && ["inbox", "todo", "doing"].includes(current) ? current : "todo";
  /** The remote id of the closest earlier sibling that is already on Google, for move/insert `previous`. */
  const previousOf = (t: any) => {
    const sib = db.query(`SELECT id FROM tasks WHERE list_id = ? AND parent_id IS ? AND status != 'dropped' AND id != ?
      AND (position < ? OR (position = ? AND id < ?)) ORDER BY position DESC, id DESC`).all(t.list_id, t.parent_id, t.id, t.position, t.position, t.id) as any[];
    for (const s of sib) { const l = linkOf("task", s.id); if (l) return l.external_id; }
    return null;
  };
  const moveQuery = (t: any, extra: Record<string, string> = {}) => {
    const q: Record<string, string> = { ...extra };
    const parentExt = t.parent_id ? linkOf("task", t.parent_id)?.external_id : null;
    if (parentExt) q.parent = parentExt;
    const prev = previousOf(t);
    if (prev) q.previous = prev;
    return q;
  };
  const pushLocal = async (t: any, link: Link, remoteList: string) => {
    if (t.status === "dropped") {
      await g.call("DELETE", `/lists/${remoteList}/tasks/${link.external_id}`);
      dropLink("task", t.id);
      stats.deleted_remote++;
      return;
    }
    await g.call("POST", `/lists/${remoteList}/tasks/${link.external_id}/move`, undefined, moveQuery(t));
    const r = await g.call("PATCH", `/lists/${remoteList}/tasks/${link.external_id}`, toRemote(t));
    stats.pushed++;
    saveLink("task", t.id, link.external_id, remoteList, r?.updated);
  };
  const applyRemote = (t: any, r: any) => {
    const parent = r.parent ? linkByExt("task", r.parent)?.local_id ?? null : null;
    const status = localStatus(r, t.status);
    // A due date cleared on Google clears the local time and repeat with it, like the app does.
    const due = r.due ? String(r.due).slice(0, 10) : null;
    db.query(`UPDATE tasks SET title = ?, notes = ?, status = ?, done_at = ?, due = ?, due_time = CASE WHEN ? IS NULL THEN NULL ELSE due_time END,
      repeat = CASE WHEN ? IS NULL THEN NULL ELSE repeat END, parent_id = ?, updated_at = ? WHERE id = ?`)
      .run(r.title ?? "", r.notes || null, status, status === "done" ? stampOf(r.completed) || start : null, due, due, due, parent, start, t.id);
    stats.pulled++;
  };

  // Tasks moved to another list here go first, so each list's pass sees them where they now live.
  for (const link of db.query("SELECT * FROM sync_links WHERE provider = ? AND kind = 'task'").all(PROVIDER) as Link[]) {
    const t = db.query("SELECT * FROM tasks WHERE id = ?").get(link.local_id) as any;
    if (!t || t.status === "dropped") continue;
    const dest = remoteListOf(t.list_id);
    if (!dest || !link.remote_list || dest === link.remote_list || t.parent_id) continue;
    await guard(`move t${t.id}`, async () => {
      const r = await g.call("POST", `/lists/${link.remote_list}/tasks/${link.external_id}/move`, undefined, { destinationTasklist: dest });
      const newId = r?.id && !String(r.id).startsWith("dry-") ? r.id : link.external_id;
      saveLink("task", t.id, newId, dest, link.remote_updated);
      for (const kid of db.query("SELECT id FROM tasks WHERE parent_id = ?").all(t.id) as any[]) {
        const kl = linkOf("task", kid.id);
        if (kl) saveLink("task", kid.id, kl.external_id, dest, kl.remote_updated);
      }
      stats.moved++;
    });
  }

  const seen = new Set<string>(), fetched = new Set<string>();
  for (const l of localLists()) {
    const remoteList = remoteListOf(l.id);
    if (!remoteList || remoteList.startsWith("dry-")) continue;
    const remote = await g.all(`/lists/${remoteList}/tasks`, { showCompleted: "true", showHidden: "true", showDeleted: "true" });
    fetched.add(remoteList);
    let wrote = false;
    // Parents before subtasks so a subtask's parent already has a local row.
    for (const r of remote.sort((x, y) => Number(!!x.parent) - Number(!!y.parent))) {
      seen.add(r.id);
      await guard(`task ${r.title}`, async () => {
        const link = linkByExt("task", r.id);
        const t = link ? (db.query("SELECT * FROM tasks WHERE id = ?").get(link.local_id) as any) : null;
        if (link && t) {
          const localChanged = t.updated_at > link.synced_at;
          const remoteChanged = stampOf(r.updated) !== link.remote_updated;
          const localWins = localChanged && (!remoteChanged || t.updated_at > stampOf(r.updated));
          if (r.deleted) {
            if (t.status === "dropped") return dropLink("task", t.id);
            if (localWins) {
              // Edited here after it was deleted there: put it back on Google.
              conflict("task", t.id, r.id, "local", "deleted on Google, edited in agentos");
              dropLink("task", t.id);
              const c = await g.call("POST", `/lists/${remoteList}/tasks`, toRemote(t), moveQuery(t));
              saveLink("task", t.id, c.id, remoteList, c.updated);
        seen.add(c.id);
              wrote = true;
              return;
            }
            db.query("UPDATE tasks SET status = 'dropped', updated_at = ? WHERE id = ?").run(start, t.id);
            dropLink("task", t.id);
            stats.deleted_local++;
            return;
          }
          if (!localChanged && !remoteChanged) return;
          if (localChanged && remoteChanged) conflict("task", t.id, r.id, localWins ? "local" : "remote", `"${t.title}" edited on both sides`);
          if (localWins) {
            await pushLocal(t, link, remoteList);
            wrote = true;
          } else {
            applyRemote(t, r);
            saveLink("task", t.id, r.id, remoteList, r.updated);
          }
          return;
        }
        if (link) dropLink("task", link.local_id);
        if (r.deleted || !r.title) return;
        const parent = r.parent ? linkByExt("task", r.parent)?.local_id ?? null : null;
        const status = localStatus(r);
        const due = r.due ? String(r.due).slice(0, 10) : null;
        const created = db.query(`INSERT INTO tasks (title, notes, area, status, due, owner, source, external_id, created_at, updated_at,
            done_at, list_id, parent_id, position)
          VALUES (?, ?, ?, ?, ?, 'me', ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET list_id = excluded.list_id RETURNING id`)
          .get(r.title, r.notes || null, l.area, status, due, PROVIDER, r.id, start, start,
            status === "done" ? stampOf(r.completed) || start : null, l.id, parent) as any;
        saveLink("task", created.id, r.id, remoteList, r.updated);
        stats.created_local++;
      });
    }
    // New here: open tasks go up (done history stays local), parents first.
    const fresh = (db.query(`SELECT * FROM tasks WHERE list_id = ? AND status IN ('inbox','todo','doing') ORDER BY parent_id IS NOT NULL, position, id`)
      .all(l.id) as any[]).filter((t) => !linkOf("task", t.id));
    for (const t of fresh) {
      await guard(`push t${t.id}`, async () => {
        if (t.parent_id && !linkOf("task", t.parent_id)) return;
        const c = await g.call("POST", `/lists/${remoteList}/tasks`, toRemote(t), moveQuery(t));
        saveLink("task", t.id, c.id, remoteList, c.updated);
        seen.add(c.id);
        stats.created_remote++;
        wrote = true;
      });
    }
    // Google's order is the merged order now: copy it into local positions without touching updated_at.
    if (!opts.dryRun) {
      const final = wrote ? await g.all(`/lists/${remoteList}/tasks`, { showCompleted: "true", showHidden: "true" }) : remote.filter((r) => !r.deleted);
      const groups = new Map<string, any[]>();
      for (const r of final) groups.set(r.parent ?? "", [...(groups.get(r.parent ?? "") ?? []), r]);
      const upd = db.prepare("UPDATE tasks SET position = ?, parent_id = ? WHERE id = ?");
      for (const [parentExt, rows] of groups) {
        const parent = parentExt ? linkByExt("task", parentExt)?.local_id ?? null : null;
        rows.sort((x, y) => (x.position < y.position ? -1 : x.position > y.position ? 1 : 0)).forEach((r, i) => {
          const link = linkByExt("task", r.id);
          if (!link) return;
          upd.run((i + 1) * 1024, parent, link.local_id);
          if (wrote) db.query("UPDATE sync_links SET remote_updated = ? WHERE provider = ? AND kind = 'task' AND local_id = ?")
            .run(stampOf(r.updated), PROVIDER, link.local_id);
        });
      }
    }
  }

  // Linked but gone from every list we read (purged on Google): treat like a delete.
  if (!opts.dryRun) for (const link of db.query("SELECT * FROM sync_links WHERE provider = ? AND kind = 'task'").all(PROVIDER) as Link[]) {
    if (seen.has(link.external_id) || !link.remote_list || !fetched.has(link.remote_list)) continue;
    const t = db.query("SELECT * FROM tasks WHERE id = ?").get(link.local_id) as any;
    dropLink("task", link.local_id);
    if (t && t.status !== "dropped") {
      db.query("UPDATE tasks SET status = 'dropped', updated_at = ? WHERE id = ?").run(start, t.id);
      stats.deleted_local++;
    }
  }

  // Everything above happened as of `start`; later local edits stay "changed" for the next run.
  db.query("UPDATE sync_links SET synced_at = ? WHERE provider = ?").run(opts.nowIso(), PROVIDER);
  log("run", null, null, null, JSON.stringify(stats));
  if (opts.dryRun) db.exec("ROLLBACK");
  return { ok: stats.errors === 0, dry_run: opts.dryRun, ...stats, conflict_log: conflicts, error_log: errors };
}

export function syncStatus(db: Database) {
  const last = db.query("SELECT at, detail FROM sync_log WHERE provider = ? AND kind = 'run' ORDER BY id DESC LIMIT 1").get(PROVIDER) as any;
  const links = db.query("SELECT kind, count(*) n FROM sync_links WHERE provider = ? GROUP BY kind").all(PROVIDER) as any[];
  const recent = (db.query("SELECT at, local_id, external_id, winner, detail FROM sync_log WHERE provider = ? AND kind = 'conflict' ORDER BY id DESC LIMIT 10")
    .all(PROVIDER) as any[]).map((c) => ({ at: c.at, local: c.local_id, remote: c.external_id, winner: c.winner, detail: c.detail }));
  return {
    google_tasks: { connected: connected(), creds: CREDS_PATH, last_sync: last?.at ?? null, last_result: last ? JSON.parse(last.detail) : null,
      lists: links.find((l) => l.kind === "list")?.n ?? 0, tasks: links.find((l) => l.kind === "task")?.n ?? 0 },
    conflicts: recent,
  };
}
