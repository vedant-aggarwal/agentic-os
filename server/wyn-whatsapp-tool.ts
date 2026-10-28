// Wyn's send_whatsapp tool. Her chat brain runs tools in the MCP process (wyn-mcp.ts), which can't reach the
// WhatsApp route, so the tool only queues the text in her db; the server (wyn-whatsapp.ts) sends it within seconds.
// Kept apart from wyn-whatsapp.ts so wyn-tools.ts can import it without an import cycle.
import type { Database } from "bun:sqlite";

const iso = () => new Date().toISOString();

/** The queue the tool writes and the server drains. Safe to call from either process. */
export function waOutbox(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS wa_outbox (id INTEGER PRIMARY KEY, text TEXT NOT NULL, turn TEXT, status TEXT NOT NULL DEFAULT 'queued',
    error TEXT, created_at TEXT NOT NULL, sent_at TEXT)`);
}

/** Set by the server at start: "on", or "off: <why>". */
export const WA_READY_PREF = "wa.ready";
/** "on" when WA_TEMPLATE is set, so she can message outside the 24-hour window. */
export const WA_TEMPLATE_PREF = "wa.template";

export const WA_TOOLS = [
  {
    name: "send_whatsapp",
    description: "Message the user on WhatsApp, from your own WhatsApp number. Use it when they ask you to send something there, or when you reach out on your own and it should land on their phone. " +
      "When they wrote to you on WhatsApp, don't use this: your normal reply already goes back there. Plain text, short; a blank line splits it into separate messages (three at most).",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run: (a: any, c: { n: Database; turn: string; user: { role: string } }) => {
      if (c.user.role !== "owner") throw new Error("That's for the owner only.");
      const text = String(a?.text ?? "").trim();
      if (!text) throw new Error("What should I send?");
      if (text.length > 3500) throw new Error("Too long for WhatsApp; keep it under 3,500 characters.");
      const ready = ((c.n.query("SELECT value FROM prefs WHERE key = ?").get(WA_READY_PREF) as any)?.value ?? "") as string;
      if (ready !== "on") throw new Error(`WhatsApp isn't set up on the PC${ready.startsWith("off:") ? ` (${ready.slice(4).trim()})` : ""}. Say so, and reply here instead.`);
      waOutbox(c.n);
      // Without an approved template, WhatsApp only delivers within 24 hours of his last message there.
      const hasLog = c.n.query("SELECT 1 FROM sqlite_master WHERE name = 'wa_log'").get();
      const lastIn = hasLog ? (c.n.query("SELECT max(at) a FROM wa_log WHERE dir = 'in'").get() as any)?.a : null;
      const template = ((c.n.query("SELECT value FROM prefs WHERE key = ?").get(WA_TEMPLATE_PREF) as any)?.value ?? "") === "on";
      if (!template && !(lastIn && Date.now() - Date.parse(lastIn) < 23.5 * 3600_000))
        throw new Error("He hasn't written to you on WhatsApp in the last 24 hours, and WhatsApp only lets you message him inside that window. Tell him here instead.");
      const r = c.n.query("INSERT INTO wa_outbox (text, turn, created_at) VALUES (?, ?, ?) RETURNING id").get(text, c.turn, iso()) as any;
      return { queued: r.id, note: "It goes out within seconds and shows in this chat. If WhatsApp refuses it, a note appears here." };
    },
  },
];
