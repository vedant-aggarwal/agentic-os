// Account admin on the PC.
//   bun server/admin.ts invite [--owner] [--uses 1] [--days 7] [--label "Rohan"]
//   bun server/admin.ts users
//   bun server/admin.ts signout <email>        ends every session of that account
//   bun server/admin.ts password <email> [new]  sets a new password (asked for when not given) and signs out every device
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { openAuth } from "./auth";

const ROOT = resolve(import.meta.dir, "..");
const auth = openAuth(
  process.env.DATA_DIR ?? join(ROOT, "data"),
  process.env.OWNER_DB ?? join(homedir(), ".agentos", "agentos.db"),
  process.env.OWNER_EVENTS ?? join(homedir(), "agentic-os", ".operator-data", "workspace.json"),
);
const [cmd, ...rest] = process.argv.slice(2);
const flag = (k: string) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };

if (cmd === "invite") {
  const owner = rest.includes("--owner");
  const inv = auth.createInvite({ role: owner ? "owner" : "member", uses: Number(flag("uses") ?? 1), days: Number(flag("days") ?? 7), label: flag("label") ?? null });
  console.log(`Invite code: ${inv.code}\nRole: ${inv.role} · uses: ${inv.uses} · expires ${inv.expiresAt.slice(0, 10)}`);
  if (owner) console.log("The account made with this code gets your real agentos data.");
} else if (cmd === "users") {
  console.table(auth.listUsers());
  console.table(auth.listInvites());
} else if (cmd === "signout" && rest[0]) {
  const u = auth.userByEmail(rest[0]);
  if (!u) { console.log("No such account."); process.exit(2); }
  auth.endAllSessions(u.id);
  console.log(`Signed out every device of ${u.email}.`);
} else if (cmd === "password" && rest[0]) {
  const u = auth.userByEmail(rest[0]);
  if (!u) { console.log("No such account."); process.exit(2); }
  const next = rest[1] ?? prompt("New password (8+ characters):") ?? "";
  if (next.length < 8 || next.length > 200) { console.log("Use 8 to 200 characters."); process.exit(2); }
  await auth.setPassword(u.id, next);
  auth.endAllSessions(u.id);
  console.log(`Password set for ${u.email}. Every device was signed out; sign in again with the new password.`);
} else {
  console.log("bun server/admin.ts invite [--owner] [--uses n] [--days n] [--label name] | users | signout <email> | password <email> [new]");
}
