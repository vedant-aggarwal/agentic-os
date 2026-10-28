// Wyn on WhatsApp: the owner chats with her there, in the same thread as the app, and she can message him there.
//
// Route (see WHATSAPP-SETUP in the job folder): Meta → your public webhook host (e.g. https://your-server.example, a Cloudflare tunnel) → the
// control bridge on :8090 (scripts/whatsapp/bridge.mjs, holds the number's Meta token) → POST /api/v1/whatsapp/inbound here, signed
// with WA_SECRET. Outbound goes back through the bridge (/wyn/send), or straight to Meta's Graph API with
// WA_TRANSPORT=cloud. Only WA_OWNER's number is served; everyone else is ignored.
//
// Config (server/config.json or the environment; never committed):
//   WA_TRANSPORT  bridge | cloud | off (default off)
//   WA_OWNER      the owner's WhatsApp number, digits with country code
//   WA_SECRET     shared with the bridge (config.json wynSecret): signs both directions; 32+ characters
//   WA_BRIDGE_URL default http://127.0.0.1:8090
//   WA_ENV_FILE   cloud only: an env file with WHATSAPP_CLOUD_PHONE_NUMBER_ID and WHATSAPP_CLOUD_ACCESS_TOKEN
//                 (or set WA_PHONE_ID and WA_TOKEN directly)
//   WA_TEMPLATE   an approved template with one body variable, used outside WhatsApp's 24-hour window
//   WA_TEMPLATE_LANG default en
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "./store";
import type { User } from "./auth";
import type { Wyn } from "./wyn";
import { waOutbox, WA_READY_PREF, WA_TEMPLATE_PREF } from "./wyn-whatsapp-tool";
import { ACK_EMOJI, ackKind, asksSomething, DONE_NOTE, REACT_NOTE, SILENT_ACKS, SLOW_MS, SLOW_TOOLS, speakable, spokenText, voiceMode, wantsVoice } from "./wyn-touch";
import { speak } from "./wyn-voice-reply";
import { prefsOf } from "./wyn-tools";

const iso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const mask = (phone: string) => `…${phone.slice(-4)}`;
const WINDOW_MS = 23.5 * 3600_000; // WhatsApp's customer-service window is 24 h; keep a margin.

// ── splitting a reply into 1-3 WhatsApp messages ────────────────────────────
// wt-chat adds server/wyn-reply.ts with splitReply(text): string[]. Until that merges, this stand-in is used;
// once the file exists it is picked up on its own. (Merge note: delete localSplit then, if you like.)
export function localSplit(text: string): string[] {
  const paras = String(text ?? "").replace(/\r/g, "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (paras.length <= 3) return paras;
  // Keep the opener and the closer on their own; the middle goes together.
  return [paras[0], paras.slice(1, -1).join("\n\n"), paras.at(-1)!];
}
let splitReply: (text: string) => string[] = localSplit;
const REPLY_MODULE = "./wyn-reply.ts";
import(REPLY_MODULE).then((m: any) => { if (typeof m?.splitReply === "function") splitReply = m.splitReply; }).catch(() => {});
/** WhatsApp takes 4,096 characters a message; split long parts on line breaks. */
function chunk(part: string, max = 3900): string[] {
  const out: string[] = [];
  let rest = part;
  while (rest.length > max) {
    const at = rest.lastIndexOf("\n", max);
    const cut = at > max / 3 ? at : max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
export const waParts = (text: string) => splitReply(text).flatMap((p) => chunk(p)).filter(Boolean);

// ── transports: how a message reaches Meta ──────────────────────────────────
type Template = { name: string; language: string; variables: string[] };
export interface WaTransport {
  name: string;
  sendText(to: string, text: string): Promise<{ id: string | null }>;
  sendTemplate(to: string, t: Template): Promise<{ id: string | null }>;
  /** Blue ticks, and "typing…" on his side while Wyn thinks (typing false: ticks only). Best effort. */
  markRead(messageId: string, typing?: boolean): Promise<void>;
  /** An emoji reaction on one of his messages. */
  react(to: string, messageId: string, emoji: string): Promise<{ id: string | null }>;
  /** A voice note: Ogg/Opus bytes, uploaded to WhatsApp and sent as audio. */
  sendAudio(to: string, ogg: Uint8Array): Promise<{ id: string | null }>;
}
const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

function bridgeTransport(url: string, secret: string): WaTransport {
  async function post(path: string, payload: unknown) {
    const body = JSON.stringify(payload);
    let res: Response;
    try {
      res = await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-wyn-signature": sign(secret, body) }, body, signal: AbortSignal.timeout(25_000) });
    } catch (e) { throw new Error(`The WhatsApp bridge at ${url} isn't answering (${e instanceof Error ? e.message : e}). Start it (scripts/whatsapp/install-bridge.ps1 installs and starts it).`); }
    const text = await res.text();
    // The old bridge passes unknown paths to Hermes, which is usually down.
    if (res.status === 404 || /Hermes is not running/.test(text)) throw new Error("The WhatsApp bridge doesn't know Wyn yet: install the patched bridge (WHATSAPP-SETUP.md, step 2).");
    if (res.status === 401) throw new Error("The WhatsApp bridge rejected Wyn's signature: WA_SECRET here and wynSecret in the bridge's config.json must match.");
    if (!res.ok) throw new Error(`WhatsApp refused it: ${text.slice(0, 200) || `HTTP ${res.status}`}`);
    try { return JSON.parse(text); } catch { return {}; }
  }
  return {
    name: "bridge",
    sendText: async (to, text) => ({ id: (await post("/wyn/send", { to, text })).id ?? null }),
    sendTemplate: async (to, template) => ({ id: (await post("/wyn/send", { to, template })).id ?? null }),
    markRead: async (id, typing = true) => { await post("/wyn/read", { id, typing }).catch(() => {}); },
    // Reactions and voice notes need the bridge from scripts/whatsapp/bridge.mjs (2026-10-21 or later); an older one says "text or template is required".
    react: async (to, message_id, emoji) => ({ id: (await post("/wyn/send", { to, reaction: { message_id, emoji } })).id ?? null }),
    sendAudio: async (to, ogg) => ({ id: (await post("/wyn/send", { to, audio: { data: Buffer.from(ogg).toString("base64"), mime: "audio/ogg", voice: true } })).id ?? null }),
  };
}

function cloudTransport(phoneId: string, token: string, version = "v20.0", base = `https://graph.facebook.com/${version}`): WaTransport {
  const refused = (res: Response, data: any) => new Error(`WhatsApp refused it: ${data?.error?.code ?? res.status} ${data?.error?.message ?? ""}`.trim());
  async function graph(payload: Record<string, unknown>) {
    const res = await fetch(`${base}/${phoneId}/messages`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }), signal: AbortSignal.timeout(20_000) });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw refused(res, data);
    return data;
  }
  const idOf = (data: any) => data?.messages?.[0]?.id ?? null;
  return {
    name: "cloud",
    sendText: async (to, body) => ({ id: idOf(await graph({ to, type: "text", text: { body, preview_url: false } })) }),
    sendTemplate: async (to, t) => ({ id: idOf(await graph({ to, type: "template", template: { name: t.name, language: { code: t.language },
      components: t.variables.length ? [{ type: "body", parameters: t.variables.map((v) => ({ type: "text", text: v })) }] : [] } })) }),
    markRead: async (id, typing = true) => { await graph({ status: "read", message_id: id, ...(typing ? { typing_indicator: { type: "text" } } : {}) }).catch(() => {}); },
    react: async (to, message_id, emoji) => ({ id: idOf(await graph({ to, type: "reaction", reaction: { message_id, emoji } })) }),
    sendAudio: async (to, ogg) => {
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", "audio/ogg");
      form.append("file", new Blob([ogg], { type: "audio/ogg" }), "wyn.ogg");
      const res = await fetch(`${base}/${phoneId}/media`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(30_000) });
      const up: any = await res.json().catch(() => ({}));
      if (!res.ok || !up?.id) throw refused(res, up);
      // voice: true shows it as a voice note (play bar, "recorded" style); an API version without it gets a plain audio file.
      try { return { id: idOf(await graph({ to, type: "audio", audio: { id: up.id, voice: true } })) }; }
      catch { return { id: idOf(await graph({ to, type: "audio", audio: { id: up.id } })) }; }
    },
  };
}

const readEnvFile = (path: string) => Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/)
  .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m![1], m![2].replace(/^["']|["']$/g, "")]));

/** The configured route, or why there isn't one (shown in the app and to Wyn). */
export function waRoute(conf: (k: string, d: string) => string): { transport: WaTransport | null; owner: string; secret: string; problem: string | null } {
  const mode = conf("WA_TRANSPORT", "off").toLowerCase();
  const owner = digits(conf("WA_OWNER", ""));
  const secret = conf("WA_SECRET", "");
  const off = (problem: string) => ({ transport: null, owner, secret, problem });
  if (mode === "off" || !mode) return off("WhatsApp is off (WA_TRANSPORT isn't set)");
  if (!/^[1-9]\d{7,14}$/.test(owner)) return off("WA_OWNER (your number, with country code) isn't set");
  if (secret.length < 32) return off("WA_SECRET (shared with the bridge, 32+ characters) isn't set");
  if (mode === "bridge") return { transport: bridgeTransport(conf("WA_BRIDGE_URL", "http://127.0.0.1:8090").replace(/\/$/, ""), secret), owner, secret, problem: null };
  if (mode === "cloud") {
    let phoneId = conf("WA_PHONE_ID", ""), token = conf("WA_TOKEN", "");
    const file = conf("WA_ENV_FILE", "");
    if ((!phoneId || !token) && file) {
      if (!existsSync(file)) return off(`WA_ENV_FILE ${file} doesn't exist`);
      const e = readEnvFile(file);
      phoneId ||= e.WHATSAPP_CLOUD_PHONE_NUMBER_ID ?? "";
      token ||= e.WHATSAPP_CLOUD_ACCESS_TOKEN ?? "";
    }
    if (!phoneId || !token) return off("cloud mode needs WA_PHONE_ID and WA_TOKEN, or WA_ENV_FILE");
    const version = conf("WA_GRAPH_VERSION", "v20.0");
    return { transport: cloudTransport(phoneId, token, version, conf("WA_GRAPH_URL", "") || undefined), owner, secret, problem: null };
  }
  return off(`WA_TRANSPORT ${mode} isn't one of bridge, cloud, off`);
}

type Deps = { conf: (k: string, d: string) => string; wyn: Wyn; owner: () => User | null; transcribe: (path: string) => Promise<string>; dataDir: string };
export const CHANNELS = ["app", "whatsapp", "both"] as const;
const WA_NOTE = "[This message came on WhatsApp and your reply goes back there. Write it like a WhatsApp chat: plain text, short, no headings or tables. " +
  "A blank line splits your reply into separate messages; use at most three.]";

export function openWhatsApp(d: Deps) {
  const route = waRoute(d.conf);
  const { transport, owner } = route;
  const tpl = d.conf("WA_TEMPLATE", "");
  const tplLang = d.conf("WA_TEMPLATE_LANG", "en");
  const log = (m: string) => console.log(`[whatsapp] ${m}`);
  if (route.problem) log(route.problem); else log(`on, through the ${transport!.name}, for ${mask(owner)}`);

  const db = (u: User) => {
    const n = d.wyn.db(u);
    n.exec(`CREATE TABLE IF NOT EXISTS wa_log (id INTEGER PRIMARY KEY, wa_id TEXT, dir TEXT NOT NULL, kind TEXT NOT NULL, text TEXT, status TEXT NOT NULL,
      error TEXT, turn TEXT, at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS wa_log_id ON wa_log (wa_id);`);
    waOutbox(n);
    return n;
  };
  const pref = (u: User, k: string) => ((d.wyn.db(u).query("SELECT value FROM prefs WHERE key = ?").get(k) as any)?.value ?? "") as string;
  const setPref = (u: User, k: string, v: string) => d.wyn.db(u).query("INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
  const channel = (u: User) => (CHANNELS as readonly string[]).includes(pref(u, "message_channel")) ? pref(u, "message_channel") : "both";
  const lastIn = (u: User) => ((db(u).query("SELECT max(at) a FROM wa_log WHERE dir = 'in'").get() as any)?.a ?? null) as string | null;
  const windowOpen = (u: User) => { const t = lastIn(u); return !!t && Date.now() - Date.parse(t) < WINDOW_MS; };

  // Tell the tool (in the MCP process) whether it can queue.
  const u0 = d.owner();
  if (u0) { db(u0); setPref(u0, WA_READY_PREF, route.problem ? `off: ${route.problem}` : "on"); setPref(u0, WA_TEMPLATE_PREF, tpl ? "on" : ""); }

  // ── sending: one queue per person, so split messages stay in order ──
  const chains = new Map<number, Promise<unknown>>();
  const serial = <T>(u: User, job: () => Promise<T>) => {
    const next = (chains.get(u.id) ?? Promise.resolve()).catch(() => {}).then(job);
    chains.set(u.id, next);
    return next;
  };
  /** Sends Wyn's text as 1-3 messages with short human gaps. Returns false (and says why in chat) when it can't. */
  function deliver(u: User, text: string, turn: string | null, kind: string) {
    return serial(u, async () => {
      const n = db(u);
      if (!transport) { fallback(u, text, route.problem!); return false; }
      const parts = waParts(text);
      const open = windowOpen(u);
      try {
        if (!open && tpl) {
          // Outside the 24-hour window only a template goes through: the whole text as its one variable.
          const v = text.replace(/\s*\n+\s*/g, " · ").replace(/ {4,}/g, "   ").slice(0, 1000);
          const r = await transport.sendTemplate(owner, { name: tpl, language: tplLang, variables: [v] });
          n.query("INSERT INTO wa_log (wa_id, dir, kind, text, status, turn, at) VALUES (?, 'out', ?, ?, 'sent', ?, ?)").run(r.id, `${kind}:template`, text, turn, iso());
          return true;
        }
        for (const [i, p] of parts.entries()) {
          if (i) await sleep(Math.min(2500, Math.max(700, 300 + p.length * 12)));
          const r = await transport.sendText(owner, p);
          n.query("INSERT INTO wa_log (wa_id, dir, kind, text, status, turn, at) VALUES (?, 'out', ?, ?, 'sent', ?, ?)").run(r.id, kind, p, turn, iso());
        }
        if (!open) log(`sent outside the 24-hour window without a template (${kind}); Meta will likely refuse it. Set WA_TEMPLATE.`);
        return true;
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        n.query("INSERT INTO wa_log (dir, kind, text, status, error, turn, at) VALUES ('out', ?, ?, 'failed', ?, ?, ?)").run(kind, text, why.slice(0, 500), turn, iso());
        fallback(u, text, why);
        return false;
      }
    });
  }
  /** WhatsApp didn't take it: a note in the thread and a phone notification, so the message isn't lost. */
  function fallback(u: User, text: string, why: string) {
    log(`not delivered: ${why}`);
    d.wyn.post(u, "system", `WhatsApp didn't take this one (${why.slice(0, 200)}), so it's only here.`, { via: "whatsapp", error: true });
    d.wyn.pushAlert(u, { title: "Wyn", body: text.slice(0, 180) }).catch(() => {});
  }

  // ── what goes to WhatsApp: replies to WhatsApp messages, and her own messages per message_channel ──
  // post() and the phone notification run back to back, so the decision made here also mutes the push.
  let mute: { uid: number; at: number } | null = null;
  d.wyn.onPost((u, m) => {
    if (u.id !== d.owner()?.id || m.meta?.via) return;
    const turn = m.turn ?? "";
    let send = false, push = true, kind = "message";
    if (turn.startsWith("chat-")) {
      // A reply: back where the message came from.
      const q = asked(u, turn);
      if (!q.fromWa || !["wyn", "system"].includes(m.role)) return;
      send = true; push = false; kind = "reply";
      pending.delete(turn); // she's answering: no 👀 now
      // A voice note back: hold the parts and speak the whole reply when the turn ends (onTurn done, below).
      if (m.role === "wyn" && wantsVoice(voiceMode(pref(u, "voice_replies")), q.voice, "x")) {
        const held = voiceHeld.get(turn) ?? [];
        held.push(m.text);
        voiceHeld.set(turn, held);
        mute = { uid: u.id, at: Date.now() };
        return;
      }
    } else if (turn.startsWith("onboard-") && ["wyn", "system"].includes(m.role)) {
      // Her roast-me turn follows the channel of the chat that started it.
      if (pref(u, "onboard.via") !== "whatsapp" || !transport || !windowOpen(u)) return;
      send = true; push = false; kind = "onboard";
    } else if (m.role === "wyn" && !m.meta?.calling && (turn === "" || /^(reach|job)-/.test(turn) || (turn.startsWith("ask-") && m.meta?.ask))) {
      const ch = channel(u);
      // Her own messages need the 24-hour window (he wrote in the last day) or an approved template; otherwise
      // Meta refuses them, so they stay in the app with the usual notification.
      if (ch === "app" || !transport || (!windowOpen(u) && !tpl)) return;
      send = true; push = ch === "both"; kind = turn.split("-")[0] || "scheduled";
    }
    if (!send) return;
    if (!push) mute = { uid: u.id, at: Date.now() };
    deliver(u, m.text, m.turn, kind).catch((e) => log(`deliver: ${e}`));
  });
  d.wyn.setQuiet((u, x) => {
    const q = mute;
    mute = null;
    return !!q && x.kind === "message" && q.uid === u.id && Date.now() - q.at < 1000;
  });

  // ── human touches: reactions, 👀 while she works, voice notes back (server/wyn-touch.ts) ──
  /** The message from him that started a turn: did it come on WhatsApp, as a voice note, and its WhatsApp id. */
  function asked(u: User, turn: string) {
    const q = db(u).query("SELECT id, meta FROM messages WHERE turn = ? AND role = 'user' ORDER BY id LIMIT 1").get(turn) as any;
    let meta: any = null;
    try { meta = q?.meta ? JSON.parse(q.meta) : null; } catch {}
    return { rowId: q?.id as number | undefined, meta, fromWa: meta?.via === "whatsapp", voice: !!meta?.voice, wa: meta?.wa ? String(meta.wa) : null };
  }
  const voiceHeld = new Map<string, string[]>();
  const eyes = new Set<string>(), pending = new Set<string>();
  /** An emoji on his message. When it fails (an old bridge) and `orText`, the emoji goes as a message instead. */
  function reactTo(u: User, waId: string, emoji: string, turn: string | null, orText = false) {
    return serial(u, async () => {
      if (!transport) return false;
      try {
        const r = await transport.react(owner, waId, emoji);
        db(u).query("INSERT INTO wa_log (wa_id, dir, kind, text, status, turn, at) VALUES (?, 'out', 'reaction', ?, 'sent', ?, ?)").run(r.id, emoji, turn, iso());
        return true;
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        db(u).query("INSERT INTO wa_log (dir, kind, text, status, error, turn, at) VALUES ('out', 'reaction', ?, 'failed', ?, ?, ?)").run(emoji, why.slice(0, 300), turn, iso());
        log(`reaction: ${why}`);
        if (!orText) return false;
        const r = await transport.sendText(owner, emoji).catch(() => null);
        if (r) db(u).query("INSERT INTO wa_log (wa_id, dir, kind, text, status, turn, at) VALUES (?, 'out', 'reply', ?, 'sent', ?, ?)").run(r.id, emoji, turn, iso());
        return !!r;
      }
    });
  }
  /** Keeps the reaction on his message in the thread too, for the app. */
  const markReaction = (u: User, rowId: number | undefined, meta: any, emoji: string) => {
    if (rowId) db(u).query("UPDATE messages SET meta = ? WHERE id = ?").run(JSON.stringify({ ...(meta ?? {}), reaction: emoji }), rowId);
  };
  const lookingAt = (u: User, turn: string) => {
    const q = asked(u, turn);
    if (!q.fromWa || !q.wa || eyes.has(turn) || !pending.has(turn)) return;
    eyes.add(turn);
    reactTo(u, q.wa, "👀", turn).catch(() => {});
  };
  /** One voice note for the whole reply; text when it can't be spoken or the voice fails. */
  async function voiceReply(u: User, turn: string, text: string) {
    const ok = await serial(u, async () => {
      if (!transport || !speakable(text)) return false;
      try {
        const key = d.wyn.openaiKey();
        const voice = prefsOf(d.wyn.db(u)).call_voice;
        const ogg = await speak(spokenText(text), { key, voice, url: d.conf("OPENAI_TTS_URL", "") || undefined });
        const r = await transport.sendAudio(owner, ogg);
        db(u).query("INSERT INTO wa_log (wa_id, dir, kind, text, status, turn, at) VALUES (?, 'out', 'reply:voice', ?, 'sent', ?, ?)").run(r.id, text, turn, iso());
        return true;
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        log(`voice note: ${why}; sending text`);
        db(u).query("INSERT INTO wa_log (dir, kind, text, status, error, turn, at) VALUES ('out', 'reply:voice', ?, 'failed', ?, ?, ?)").run(text, why.slice(0, 300), turn, iso());
        return false;
      }
    });
    if (!ok) await deliver(u, text, turn, "reply");
  }
  d.wyn.onTurn({
    react: (u, turn, emoji) => {
      if (u.id !== d.owner()?.id || !transport) return false;
      const q = asked(u, turn);
      if (!q.fromWa || !q.wa) return false;
      markReaction(u, q.rowId, q.meta, emoji);
      reactTo(u, q.wa, emoji, turn, true).catch(() => {});
      return true;
    },
    status: (u, turn, _status, tool) => { if (tool && SLOW_TOOLS.has(tool)) lookingAt(u, turn); },
    done: (u, turn, text) => {
      pending.delete(turn);
      eyes.delete(turn);
      const held = voiceHeld.get(turn);
      if (!held) return;
      voiceHeld.delete(turn);
      voiceReply(u, turn, held.join("\n\n") || text).catch((e) => log(`voice reply: ${e}`));
    },
  });

  // ── the tool's queue ──
  setInterval(() => {
    const u = d.owner();
    if (!u) return;
    const n = db(u);
    for (const r of n.query("SELECT * FROM wa_outbox WHERE status = 'queued' ORDER BY id LIMIT 5").all() as any[]) {
      n.query("UPDATE wa_outbox SET status = 'sending' WHERE id = ?").run(r.id);
      d.wyn.post(u, "wyn", r.text, { via: "whatsapp", outbox: r.id }, r.turn);
      deliver(u, r.text, r.turn, "tool").then((ok) => n.query("UPDATE wa_outbox SET status = ?, sent_at = ? WHERE id = ?").run(ok ? "sent" : "failed", iso(), r.id))
        .catch(() => {});
    }
  }, 3000);

  // ── inbound from the bridge ──
  const seen = (n: ReturnType<typeof db>, id: string) => !!id && !!n.query("SELECT 1 FROM wa_log WHERE wa_id = ? AND dir = 'in'").get(id);
  async function inbound(raw: string, signature: string | null) {
    if (!route.secret || route.secret.length < 32) throw new ApiError(503, "WhatsApp isn't set up here (WA_SECRET).");
    const want = sign(route.secret, raw), got = String(signature ?? "").replace(/^sha256=/, "");
    if (got.length !== want.length || !/^[0-9a-f]+$/i.test(got) || !timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(want, "hex"))) throw new ApiError(401, "Bad signature.");
    const u = d.owner();
    if (!u) throw new ApiError(503, "No owner account yet.");
    let b: any;
    try { b = JSON.parse(raw); } catch { throw new ApiError(400, "Bad JSON."); }
    const n = db(u);
    // Delivery receipts: a failed one becomes a note in the thread.
    for (const s of Array.isArray(b.statuses) ? b.statuses : []) {
      const id = String(s?.id ?? ""), st = String(s?.status ?? "");
      if (!id || !st) continue;
      const err = s.errors?.[0] ? `${s.errors[0].code ?? ""} ${s.errors[0].title ?? s.errors[0].message ?? ""}`.trim() : null;
      const row = n.query("UPDATE wa_log SET status = ?, error = coalesce(?, error) WHERE wa_id = ? AND dir = 'out' RETURNING text").get(st, err, id) as any;
      if (st === "failed" && row) {
        const hint = /131047|re-engagement/i.test(err ?? "") ? " It's been more than 24 hours since you last wrote to Wyn there; set WA_TEMPLATE, or message her first." : "";
        d.wyn.post(u, "system", `WhatsApp didn't deliver “${String(row.text).slice(0, 80)}” (${err ?? "failed"}).${hint}`, { via: "whatsapp", error: true });
        d.wyn.pushAlert(u, { title: "Wyn", body: String(row.text).slice(0, 180) }).catch(() => {});
      }
    }
    const msgs = Array.isArray(b.messages) ? b.messages : b.message ? [b.message] : [];
    let taken = 0;
    for (const m of msgs) {
      const from = digits(m?.from), id = String(m?.id ?? "");
      if (from !== owner) { log(`ignored a message from ${mask(from)}: not the owner`); continue; }
      if (seen(n, id)) continue;
      n.query("INSERT INTO wa_log (wa_id, dir, kind, text, status, at) VALUES (?, 'in', ?, ?, 'received', ?)").run(id || null, String(m.type ?? "text"), m.text ? String(m.text).slice(0, 4000) : null, iso());
      taken++;
      handle(u, m).catch((e) => log(`inbound: ${e instanceof Error ? e.message : e}`));
    }
    return { ok: true, taken };
  }
  async function handle(u: User, m: any) {
    const meta: Record<string, unknown> = { via: "whatsapp", wa: m.id ?? null };
    let text = String(m.text ?? "").trim();
    // A plain "ok", "thanks" or "👍" when she hasn't asked anything: an emoji on it, the way a friend answers, and no reply.
    const ack = !(m.type === "audio" || m.audio) ? ackKind(text) : null;
    if (ack && SILENT_ACKS.includes(ack) && m.id && transport) {
      const last = db(u).query("SELECT text FROM messages WHERE role = 'wyn' ORDER BY id DESC LIMIT 1").get() as any;
      if (!asksSomething(last?.text)) {
        transport.markRead(String(m.id), false).catch(() => {});
        const emoji = ACK_EMOJI[ack];
        const turn = `ack-${Date.now().toString(36)}`;
        d.wyn.post(u, "user", text.slice(0, 4000), { ...meta, ack, reaction: emoji }, turn);
        await reactTo(u, String(m.id), emoji, turn);
        return;
      }
    }
    if (m.id && transport) transport.markRead(String(m.id)).catch(() => {});
    if (m.type === "audio" || m.audio) {
      meta.voice = true;
      try {
        const dir = join(d.dataDir, "wyn", `user-${u.id}`, "whatsapp");
        mkdirSync(dir, { recursive: true });
        const ext = /mpeg|mp3/.test(String(m.mime)) ? "mp3" : /mp4|m4a|aac/.test(String(m.mime)) ? "m4a" : "ogg";
        const file = join(dir, `${String(m.id || Date.now()).replace(/[^\w.-]/g, "_").slice(-60)}.${ext}`);
        if (!m.audio) throw new Error("The bridge sent no audio.");
        writeFileSync(file, Buffer.from(String(m.audio), "base64"));
        text = (await d.transcribe(file)).trim();
        if (!text) throw new Error("Nothing to hear.");
      } catch (e) {
        log(`voice note: ${e instanceof Error ? e.message : e}`);
        await deliver(u, "I couldn't make out that voice note. Type it, or send it again?", null, "reply");
        return;
      }
    }
    if (!text) {
      await deliver(u, `I can read text and voice notes here; I can't open a ${m.type || "message"} like that yet.`, null, "reply");
      return;
    }
    const notes = `${WA_NOTE}\n${REACT_NOTE}${ackKind(text) === "done" ? `\n${DONE_NOTE}` : ""}`;
    const { turn } = d.wyn.send(u, text.slice(0, 4000), { meta, extra: notes });
    // Still thinking after the typing dots fade (or on a slow tool, through onTurn status): 👀 on his message.
    pending.add(turn);
    setTimeout(() => lookingAt(u, turn), SLOW_MS).unref?.();
  }

  /** For the app: is WhatsApp on, and how. */
  function status(u: User) {
    const t = lastIn(u);
    return { on: !route.problem, transport: transport?.name ?? null, problem: route.problem, owner: owner ? mask(owner) : null, channel: channel(u),
      lastIn: t, windowOpen: windowOpen(u), template: tpl || null,
      recent: db(u).query("SELECT dir, kind, status, error, at FROM wa_log ORDER BY id DESC LIMIT 8").all() };
  }
  /** One short test message from the app's settings. */
  async function test(u: User) {
    if (!transport) throw new ApiError(503, route.problem!);
    const ok = await deliver(u, "Wyn WhatsApp test ✓", "wa-test", "test");
    if (!ok) throw new ApiError(502, "WhatsApp didn't take the test message; the reason is in the chat.");
    return { sent: true, windowOpen: windowOpen(u) };
  }
  return { inbound, status, test, deliver, route };
}
export type WhatsApp = ReturnType<typeof openWhatsApp>;
