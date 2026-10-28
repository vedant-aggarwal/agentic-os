// Every phone-server module: one name each (alphabetical), the file ./<name>.ts exporting `<name>`.
// v2: modules load side by side, so one that fails to load (a syntax error mid-edit, a bad import) is skipped with its
// error in the server log instead of taking the whole server down; the others keep answering.
import type { Module } from "./types";

const NAMES = [
  "body", "bounty", "brain", "cabinet", "clients", "content", "crm", "demand", "doctrine", "growth", "life", "mind",
  "mission", "money", "people", "ping", "price", "ribbon", "runbooks", "scan", "soul", "thumbs", "weather", "work",
];

const loaded = await Promise.allSettled(NAMES.map((n) => import(`./${n}.ts`)));
export const MODULES: Module[] = loaded.flatMap((r, i) => {
  const n = NAMES[i];
  if (r.status === "rejected") { console.error(`[mod] ${n} failed to load, skipped: ${String(r.reason?.message ?? r.reason).slice(0, 300)}`); return []; }
  const m = (r.value as Record<string, Module>)[n];
  if (!m) { console.error(`[mod] ${n}.ts has no export named ${n}, skipped`); return []; }
  return [m];
});
