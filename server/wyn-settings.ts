// Wyn's model settings: which Codex model and effort her chat brain uses, and which realtime model, voice and
// transcription model her calls use. Stored as prefs (chat_model, chat_effort, call_model, call_voice,
// call_transcribe_model); the defaults live in PREF_DEFAULTS (wyn-tools.ts). GET /wyn/models lists the choices.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SETTING_KEYS = ["chat_model", "chat_effort", "call_model", "call_voice", "call_transcribe_model", "proactive_level"] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"];
// How often she reaches out on her own (wyn-proactive.ts has what each level allows). Unset follows the older
// proactive on/off pref: off stays off, anything else is normal.
export const PROACTIVE_LEVELS = ["off", "light", "normal", "eager"] as const;
export type ProactiveLevel = (typeof PROACTIVE_LEVELS)[number];
export function proactiveLevel(p: Record<string, string | undefined>): ProactiveLevel {
  const v = p.proactive_level as ProactiveLevel;
  if ((PROACTIVE_LEVELS as readonly string[]).includes(v)) return v;
  return p.proactive === "off" ? "off" : "normal";
}

// Fallback when ~/.codex/models_cache.json can't be read (what the owner's ChatGPT login listed on 2026-10-21).
const CHAT_FALLBACK = [
  { id: "gpt-6.1-sol", name: "GPT-6.1-Sol", efforts: EFFORTS },
  { id: "gpt-6-sol", name: "GPT-6-Sol", efforts: EFFORTS },
  { id: "gpt-6-astra", name: "GPT-6-Astra", efforts: EFFORTS },
  { id: "gpt-6-luna", name: "GPT-6-Luna", efforts: EFFORTS.slice(0, 5) },
  { id: "gpt-5.6-sol", name: "GPT-5.6-Sol", efforts: EFFORTS },
  { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", efforts: EFFORTS },
  { id: "gpt-5.6-luna", name: "GPT-5.6-Luna", efforts: EFFORTS.slice(0, 5) },
];
// OpenAI realtime models this key can use (GET /v1/models, 2026-10-21). Mini is the cheap default.
export const CALL_MODELS = [
  { id: "gpt-realtime-2.1-mini", name: "Realtime 2.1 mini", note: "Cheapest, quick" },
  { id: "gpt-realtime-2.1", name: "Realtime 2.1", note: "Smarter, costs more" },
  { id: "gpt-realtime-2", name: "Realtime 2", note: "" },
  { id: "gpt-realtime-mini", name: "Realtime mini", note: "Older" },
];
// The realtime voices. Female voices and the one non-American accent are marked.
export const VOICES = [
  { id: "marin", name: "Marin", note: "Female" },
  { id: "cedar", name: "Cedar", note: "Male" },
  { id: "coral", name: "Coral", note: "Female" },
  { id: "sage", name: "Sage", note: "Female" },
  { id: "shimmer", name: "Shimmer", note: "Female" },
  { id: "alloy", name: "Alloy", note: "Neutral" },
  { id: "ash", name: "Ash", note: "Male" },
  { id: "ballad", name: "Ballad", note: "Male, British accent" },
  { id: "echo", name: "Echo", note: "Male" },
  { id: "verse", name: "Verse", note: "Male" },
];
export const TRANSCRIBE_MODELS = [
  { id: "gpt-4o-mini-transcribe", name: "4o mini transcribe", note: "Cheapest" },
  { id: "gpt-4o-transcribe", name: "4o transcribe", note: "Better with Hinglish" },
  { id: "gpt-transcribe", name: "GPT transcribe", note: "Newest" },
];

let cache: { mtime: number; list: { id: string; name: string; efforts: string[] }[] } | null = null;
/** The Codex models this PC's login may use, from Codex's own cache (visible ones only). */
export function chatModels() {
  const f = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "models_cache.json");
  try {
    if (!existsSync(f)) return CHAT_FALLBACK;
    const mtime = statSync(f).mtimeMs;
    if (cache?.mtime === mtime) return cache.list;
    const j = JSON.parse(readFileSync(f, "utf8"));
    const list = (j.models ?? []).filter((m: any) => m?.slug && m.visibility !== "hide")
      .map((m: any) => ({ id: String(m.slug), name: String(m.display_name || m.slug),
        efforts: (m.supported_reasoning_levels ?? []).map((l: any) => String(l?.effort ?? l)).filter((e: string) => EFFORTS.includes(e)) }));
    cache = { mtime, list: list.length ? list : CHAT_FALLBACK };
    return cache.list;
  } catch { return CHAT_FALLBACK; }
}

/** Checks one setting; returns the clean value or throws a message. Empty = back to the default. */
export function cleanSetting(key: string, value: unknown): string {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (key === "proactive_level") {
    if (!(PROACTIVE_LEVELS as readonly string[]).includes(v)) throw new Error(`proactive_level is one of ${PROACTIVE_LEVELS.join(", ")}.`);
    return v;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,79}$/.test(v)) throw new Error("That isn't a model name.");
  if (key === "chat_effort" && !EFFORTS.includes(v)) throw new Error(`Effort is one of ${EFFORTS.join(", ")}.`);
  if (key === "call_voice" && !VOICES.some((x) => x.id === v)) throw new Error(`Voice is one of ${VOICES.map((x) => x.id).join(", ")}.`);
  return v;
}

export const modelChoices = () => ({ chat: chatModels(), efforts: EFFORTS, call: CALL_MODELS, voices: VOICES, transcribe: TRANSCRIBE_MODELS });
