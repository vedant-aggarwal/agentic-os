// Email capture: forward or write to tasks@ and it lands in the inbox; content@ goes to the "Content ideas" list.
// Both addresses deliver to one mailbox on the Stalwart server; the PC reads it over JMAP every minute,
// files what came from an allowed sender, and marks each mail read so it is filed once.
// Config (server/config.json): CAPTURE_JMAP (your JMAP server, e.g. https://mail.your-server.example), CAPTURE_USER, CAPTURE_PASSWORD,
// CAPTURE_FROM (comma-separated senders allowed in; the owner's email is always allowed).
import type { Store } from "./store";

type Cfg = { base: string; user: string; password: string; allow: string[] };
const USING = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"];

export function openCapture(cfg: Cfg | null, target: () => { store: Store; email: string } | null) {
  if (!cfg?.base || !cfg.user || !cfg.password) return { status: () => ({ on: false }) };
  const auth = `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")}`;
  let session: { apiUrl: string; accountId: string } | null = null;
  let last: { at: string; filed: number; error: string | null } = { at: "", filed: 0, error: null };

  async function jmap(calls: any[]) {
    if (!session) {
      const s = await fetch(`${cfg!.base}/jmap/session`, { headers: { Authorization: auth } }).then((r) => {
        if (!r.ok) throw new Error(`session ${r.status}`);
        return r.json();
      });
      session = { apiUrl: s.apiUrl, accountId: s.primaryAccounts?.["urn:ietf:params:jmap:mail"] };
    }
    const r = await fetch(session.apiUrl, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ using: USING, methodCalls: calls.map(([m, a], i) => [m, { accountId: session!.accountId, ...a }, String(i)]) }) });
    if (!r.ok) { session = null; throw new Error(`api ${r.status}`); }
    return (await r.json()).methodResponses as any[];
  }

  async function poll() {
    const t = target();
    if (!t) return;
    const allow = new Set([...cfg!.allow, t.email].map((x) => x.trim().toLowerCase()).filter(Boolean));
    const res = await jmap([
      ["Mailbox/query", { filter: { role: "inbox" } }],
      ["Email/query", { filter: { notKeyword: "$seen" }, sort: [{ property: "receivedAt", isAscending: true }], limit: 25 }],
      ["Email/get", { "#ids": { resultOf: "1", name: "Email/query", path: "/ids" },
        properties: ["id", "messageId", "from", "to", "cc", "subject", "receivedAt", "textBody", "bodyValues", "preview", "mailboxIds"],
        fetchTextBodyValues: true, maxBodyValueBytes: 20000 }],
    ]);
    const inbox = res[0]?.[1]?.ids?.[0];
    const mails = (res[2]?.[1]?.list ?? []).filter((m: any) => !inbox || m.mailboxIds?.[inbox]);
    const seen: Record<string, any> = {};
    let filed = 0;
    for (const m of mails) {
      seen[m.id] = { "keywords/$seen": true };
      const from = String(m.from?.[0]?.email ?? "").toLowerCase();
      if (!allow.has(from)) continue;
      const rcpt = [...(m.to ?? []), ...(m.cc ?? [])].map((a: any) => String(a.email ?? "").toLowerCase());
      const content = rcpt.some((a) => a.startsWith("content@"));
      const body = (m.textBody ?? []).map((p: any) => m.bodyValues?.[p.partId]?.value ?? "").join("\n").replace(/\r/g, "").trim();
      const subject = String(m.subject ?? "").replace(/^\s*(fwd?|fw|re):\s*/gi, "").trim();
      const title = subject || body.split("\n").find((l: string) => l.trim())?.trim().slice(0, 120) || "Email";
      const r = t.store.captureTask({
        title: title.slice(0, 300), notes: `${body.slice(0, 4000)}\n\nEmailed from ${from} on ${String(m.receivedAt ?? "").slice(0, 10)}`.trim(),
        area: content ? "content" : null, list: content ? "Content ideas" : null, source: "email", externalId: String(m.messageId?.[0] ?? m.id),
      });
      if (r) filed++;
    }
    if (Object.keys(seen).length) await jmap([["Email/set", { update: seen }]]);
    last = { at: new Date().toISOString(), filed: last.filed + filed, error: null };
    if (filed) console.log(`[capture] filed ${filed} email${filed === 1 ? "" : "s"}`);
  }
  setInterval(() => { poll().catch((e) => { last = { ...last, at: new Date().toISOString(), error: String(e?.message ?? e) }; }); }, 60_000);
  setTimeout(() => poll().catch(() => {}), 5000);
  return { status: () => ({ on: true, address: cfg.user, ...last }) };
}
