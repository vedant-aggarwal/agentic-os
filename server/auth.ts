// Accounts for the Agentic OS app. Invite-only sign-up, email + password or Google.
// One SQLite file (data/auth.db). Each user gets their own agentos database; the owner's
// is the real one at ~/.agentos/agentos.db, so the CLI and the phone see the same tasks.
import { Database } from "bun:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type User = {
  id: number; email: string; name: string; role: "owner" | "member";
  agentos_db: string; events_path: string | null; google_sub: string | null; created_at: string;
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const iso = () => new Date().toISOString();
const SESSION_DAYS = 60;

export function openAuth(dataDir: string, ownerDb: string, ownerEvents: string | null) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "auth.db"), { create: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
      password_hash TEXT, google_sub TEXT UNIQUE, role TEXT NOT NULL DEFAULT 'member', agentos_db TEXT NOT NULL,
      events_path TEXT, created_at TEXT NOT NULL, last_login_at TEXT);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at TEXT NOT NULL, user_agent TEXT);
    CREATE TABLE IF NOT EXISTS invites (code_hash TEXT PRIMARY KEY, label TEXT, role TEXT NOT NULL DEFAULT 'member',
      uses_left INTEGER NOT NULL DEFAULT 1, expires_at INTEGER NOT NULL, created_by INTEGER, created_at TEXT NOT NULL);`);

  const userById = (id: number) => db.query("SELECT * FROM users WHERE id = ?").get(id) as User | null;
  const userByEmail = (email: string) => db.query("SELECT * FROM users WHERE email = ?").get(email.trim()) as (User & { password_hash: string | null }) | null;
  const hasOwner = () => !!db.query("SELECT 1 FROM users WHERE role = 'owner'").get();

  // Codes read like ABCD-EFGH-JKLM: no 0/O/1/I so they survive being read out over the phone.
  function createInvite({ role = "member", uses = 1, days = 7, label = null as string | null, by = null as number | null } = {}) {
    if (role === "owner" && hasOwner()) throw new Error("An owner already exists.");
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const raw = [...randomBytes(12)].map((b) => abc[b % abc.length]).join("");
    const code = raw.match(/.{4}/g)!.join("-");
    db.query("INSERT INTO invites (code_hash, label, role, uses_left, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(sha(code), label, role, uses, Date.now() + days * 864e5, by, iso());
    return { code, role, uses, expiresAt: new Date(Date.now() + days * 864e5).toISOString() };
  }
  function takeInvite(code: string) {
    const norm = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").match(/.{1,4}/g)?.join("-") ?? "";
    const row = db.query("SELECT * FROM invites WHERE code_hash = ?").get(sha(norm)) as any;
    if (!row || row.uses_left < 1 || row.expires_at < Date.now()) return null;
    return { row, use: () => db.query("UPDATE invites SET uses_left = uses_left - 1 WHERE code_hash = ?").run(row.code_hash) };
  }
  function listInvites() {
    return (db.query("SELECT label, role, uses_left, expires_at, created_at FROM invites WHERE uses_left > 0 AND expires_at > ? ORDER BY created_at DESC")
      .all(Date.now()) as any[]).map((r) => ({ label: r.label, role: r.role, usesLeft: r.uses_left, expiresAt: new Date(r.expires_at).toISOString() }));
  }

  function createUser({ email, name, password, googleSub, role }: { email: string; name: string; password?: string; googleSub?: string; role: "owner" | "member" }) {
    const stamp = iso();
    const r = db.query(`INSERT INTO users (email, name, password_hash, google_sub, role, agentos_db, events_path, created_at)
      VALUES (?, ?, ?, ?, ?, '', ?, ?) RETURNING id`).get(
      email.trim(), name.trim() || email.split("@")[0], password ? Bun.password.hashSync(password, { algorithm: "argon2id" }) : null,
      googleSub ?? null, role, role === "owner" ? ownerEvents : null, stamp) as any;
    const path = role === "owner" ? ownerDb : join(dataDir, "users", String(r.id), "agentos.db");
    db.query("UPDATE users SET agentos_db = ? WHERE id = ?").run(path, r.id);
    return userById(r.id)!;
  }

  // Constant work whether or not the email exists, so timing does not reveal accounts.
  const DUMMY = Bun.password.hashSync(randomBytes(16).toString("hex"), { algorithm: "argon2id" });
  async function checkPassword(email: string, password: string) {
    const u = userByEmail(email);
    const ok = await Bun.password.verify(String(password ?? ""), u?.password_hash ?? DUMMY);
    return ok && u?.password_hash ? userById(u.id) : null;
  }
  function setPassword(userId: number, password: string) {
    db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(Bun.password.hashSync(password, { algorithm: "argon2id" }), userId);
  }

  function createSession(userId: number, userAgent: string | null) {
    const token = randomBytes(32).toString("base64url");
    db.query("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
    db.query("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?)")
      .run(sha(token), userId, Date.now() + SESSION_DAYS * 864e5, iso(), userAgent?.slice(0, 200) ?? null);
    db.query("UPDATE users SET last_login_at = ? WHERE id = ?").run(iso(), userId);
    return { token, maxAge: SESSION_DAYS * 86400 };
  }
  function sessionUser(token: string | null | undefined): User | null {
    if (!token || token.length > 100) return null;
    const s = db.query("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?").get(sha(token)) as any;
    if (!s || s.expires_at < Date.now()) return null;
    return userById(s.user_id);
  }
  const endSession = (token: string) => db.query("DELETE FROM sessions WHERE token_hash = ?").run(sha(token));
  const endAllSessions = (userId: number) => db.query("DELETE FROM sessions WHERE user_id = ?").run(userId);

  const linkGoogle = (userId: number, sub: string) => db.query("UPDATE users SET google_sub = ? WHERE id = ?").run(sub, userId);
  const userByGoogle = (sub: string) => db.query("SELECT * FROM users WHERE google_sub = ?").get(sub) as User | null;
  const listUsers = () => db.query("SELECT id, email, name, role, created_at, last_login_at, google_sub IS NOT NULL AS google FROM users ORDER BY id").all();

  return { db, hasOwner, createInvite, takeInvite, listInvites, createUser, checkPassword, setPassword, createSession,
    sessionUser, endSession, endAllSessions, userByEmail, userById, linkGoogle, userByGoogle, listUsers };
}
export type Auth = ReturnType<typeof openAuth>;

/** Verifies a Google Identity Services credential (ID token) with Google's tokeninfo endpoint. Free, no SDK. */
export async function verifyGoogle(credential: string, clientId: string) {
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!r.ok) return null;
  const t = (await r.json()) as any;
  const issOk = t.iss === "accounts.google.com" || t.iss === "https://accounts.google.com";
  if (t.aud !== clientId || !issOk || String(t.email_verified) !== "true" || Number(t.exp) * 1000 < Date.now()) return null;
  return { sub: String(t.sub), email: String(t.email), name: String(t.name ?? t.given_name ?? "") };
}

// In-memory throttle: 8 tries per key per 15 minutes.
const tries = new Map<string, { n: number; reset: number }>();
export function throttle(key: string, limit = 8, windowMs = 15 * 60_000) {
  const now = Date.now();
  const t = tries.get(key);
  if (!t || t.reset < now) { tries.set(key, { n: 1, reset: now + windowMs }); return true; }
  t.n++;
  return t.n <= limit;
}
export const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
