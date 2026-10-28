// Builders: one Claude job per project (plus a global one for jobs without a project) that ships other jobs' finished
// work. A job calls publish_changes; the request (a "ship", s<n>) waits batchSec for company, then goes to the Builder
// in one message. Requests that arrive while the Builder works wait for its turn to end and go together in the next,
// so a running build is never interrupted. The Builder reports each ship with ship_status (committed, building, live,
// failed). While its prompt cache is warm the same Builder session carries on; when it's cold a fresh Builder starts
// from a summary of the last one and the recent ledger, and the old one is archived.
// Files: <DATA_DIR>/jobs/ships.json (the ledger), <DATA_DIR>/jobs/builders.json (model, effort, notes, current job).
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "./store";
import { SHIP_STATES, type ShipReport } from "./ship-tools";

export type ShipState = "queued" | "sent" | ShipReport;
export type Ship = {
  id: string; jobId: number; key: string; title: string; project: string | null; cwd: string | null; branch: string | null;
  summary: string; notes: string | null; deploy: boolean; state: ShipState; note: string | null; commit: string | null;
  at: string; sentAt: string | null; doneAt: string | null; builderJob: number | null; history: { state: ShipState; at: string; note?: string | null }[];
};
export type BuilderConf = { model: string; effort: string; notes: string | null; jobId: number | null };
export const GLOBAL = "_global";
const DEFAULT_CONF: BuilderConf = { model: "sonnet", effort: "medium", notes: null, jobId: null };
const FINAL: ShipState[] = ["live", "failed"];
const iso = () => new Date().toISOString();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** What builders need from the job runner (server/jobs.ts). */
export type BuilderHost = {
  /** Start a Builder job for this key with its first message; returns the job number. */
  start(key: string, conf: BuilderConf, prompt: string): Promise<number>;
  /** Send a message to a Builder job (it's idle). */
  send(jobId: number, text: string): Promise<void>;
  /** busy: a turn running or waiting on him. warm: its prompt cache is still warm. gone: deleted, archived or done. */
  state(jobId: number): { busy: boolean; warm: boolean; gone: boolean };
  archive(jobId: number, note: string): void;
  summary(jobId: number): string | null;
  /** A job's ship changed: refresh it on the phone. */
  touched(jobId: number): void;
  push(title: string, body: string, data: Record<string, unknown>): void;
  projectExists(slug: string): boolean;
};

export function openBuilders(o: { dataDir: string; batchMs: () => number; host: () => BuilderHost }) {
  const shipsFile = join(o.dataDir, "jobs", "ships.json");
  const confFile = join(o.dataDir, "jobs", "builders.json");
  let ledger: { next: number; ships: Ship[] } = { next: 1, ships: [] };
  let confs: Record<string, BuilderConf> = {};
  try { ledger = { ...ledger, ...JSON.parse(readFileSync(shipsFile, "utf8")) }; } catch {}
  try { confs = JSON.parse(readFileSync(confFile, "utf8")); } catch {}
  const write = (f: string, v: unknown) => { writeFileSync(`${f}.tmp`, JSON.stringify(v, null, 1)); renameSync(`${f}.tmp`, f); };
  const saveShips = () => { ledger.ships = ledger.ships.slice(-500); write(shipsFile, ledger); };
  const saveConfs = () => write(confFile, confs);
  const conf = (key: string): BuilderConf => ({ ...DEFAULT_CONF, ...(confs[key] ?? {}) });
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const kicking = new Set<string>();

  function branchOf(cwd: string | null) {
    if (!cwd) return null;
    try {
      const p = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd, stdout: "pipe", stderr: "ignore" });
      return p.exitCode === 0 ? new TextDecoder().decode(p.stdout).trim() || null : null;
    } catch { return null; }
  }
  function mark(s: Ship, state: ShipState, note?: string | null) {
    s.state = state;
    if (note !== undefined) s.note = note ? clip(String(note), 400) : null;
    if (FINAL.includes(state)) s.doneAt = iso();
    s.history.push({ state, at: iso(), ...(note ? { note: clip(String(note), 400) } : {}) });
  }

  /** A job's publish_changes call. waiting: requests ahead of it for the same Builder. */
  async function request(b: { jobId: number; title: string; project: string | null; cwd: string | null; summary: string; deploy: boolean; notes: string | null }) {
    const key = b.project && o.host().projectExists(b.project) ? b.project : GLOBAL;
    const waiting = ledger.ships.filter((s) => s.key === key && (s.state === "queued" || s.state === "sent")).length;
    // A second call from the same job before it was sent replaces the first.
    const old = ledger.ships.find((s) => s.jobId === b.jobId && s.state === "queued");
    const s: Ship = old ?? {
      id: `s${ledger.next++}`, jobId: b.jobId, key, title: b.title, project: b.project, cwd: b.cwd, branch: null,
      summary: "", notes: null, deploy: true, state: "queued", note: null, commit: null, at: iso(), sentAt: null, doneAt: null, builderJob: null, history: [],
    };
    Object.assign(s, { summary: clip(b.summary, 4000), notes: b.notes ? clip(b.notes, 2000) : null, deploy: b.deploy, branch: branchOf(b.cwd) });
    if (!old) { mark(s, "queued"); ledger.ships.push(s); }
    saveShips();
    schedule(key);
    return { ...s, waiting: old ? waiting - 1 : waiting };
  }
  function schedule(key: string, ms = o.batchMs()) {
    if (timers.has(key)) return;
    timers.set(key, setTimeout(() => { timers.delete(key); kick(key).catch((e) => console.error("[builders] kick", e)); }, ms));
  }
  function batchText(ships: Ship[]) {
    const lines = [`${ships.length === 1 ? "A ship request" : `${ships.length} ship requests`} for you. Report each with ship_status.`];
    for (const s of ships) {
      lines.push("", `- ${s.id} · job j${s.jobId} "${s.title}" · folder ${s.cwd ?? "unknown"}${s.branch ? ` · branch ${s.branch}` : ""} · deploy: ${s.deploy ? "yes" : "no, commit only"}`,
        `  Summary: ${s.summary.replace(/\n+/g, " ")}`, ...(s.notes ? [`  Notes: ${s.notes.replace(/\n+/g, " ")}`] : []));
    }
    return lines.join("\n");
  }
  /** Send what's queued for this key, unless its Builder is busy (its turn end kicks again). */
  async function kick(key: string) {
    if (kicking.has(key)) return;
    kicking.add(key);
    try {
      const q = ledger.ships.filter((s) => s.key === key && s.state === "queued");
      if (!q.length) return;
      const c = conf(key);
      const h = o.host();
      const st = c.jobId ? h.state(c.jobId) : null;
      if (st && !st.gone && st.busy) return;
      const text = batchText(q);
      if (st && !st.gone && st.warm) {
        try { await h.send(c.jobId!, text); } catch { schedule(key, 30_000); return; }   // it got busy: try again shortly
        for (const s of q) { mark(s, "sent"); s.sentAt = iso(); s.builderJob = c.jobId; }
        saveShips();
      } else {
        // Cold or none: a fresh Builder, told what the last one did.
        const prev = c.jobId && st && !st.gone ? c.jobId : null;
        const recent = ledger.ships.filter((s) => s.key === key && !q.includes(s)).slice(-10);
        const intro = [
          prev ? `You take over from the previous Builder (job j${prev}), whose session went cold.${h.summary(prev) ? ` Its last summary:\n${clip(h.summary(prev)!, 1500)}` : ""}` : "You are a new Builder.",
          recent.length ? `\nRecent ships:\n${recent.map((s) => `- ${s.id} j${s.jobId} "${s.title}": ${s.state}${s.commit ? ` ${s.commit}` : ""}${s.note ? ` (${s.note})` : ""}`).join("\n")}` : "",
          "", text,
        ].join("\n");
        if (prev) h.archive(prev, "Replaced by a fresh Builder (its cache went cold).");
        for (const s of q) { mark(s, "sent"); s.sentAt = iso(); }
        saveShips();
        const id = await h.start(key, c, intro);
        confs[key] = { ...c, jobId: id };
        saveConfs();
        for (const s of q) s.builderJob = id;
        saveShips();
      }
      for (const s of q) h.touched(s.jobId);
    } catch (e) {
      for (const s of ledger.ships.filter((x) => x.key === key && x.state === "sent" && !x.builderJob)) { mark(s, "failed", `Couldn't reach the Builder: ${String((e as Error)?.message ?? e).slice(0, 200)}`); o.host().touched(s.jobId); }
      saveShips();
    } finally { kicking.delete(key); }
  }
  /** A Builder's turn ended (or failed): requests it never reported fail, and the next batch goes. */
  function turnEnded(builderJob: number) {
    const key = Object.keys(confs).find((k) => confs[k].jobId === builderJob);
    for (const s of ledger.ships.filter((x) => x.builderJob === builderJob && x.state === "sent")) {
      mark(s, "failed", "The Builder ended its turn without reporting this one.");
      o.host().touched(s.jobId);
      o.host().push(`Ship failed: ${s.title}`, "The Builder didn't report it. Open the Builder to see why.", { kind: "job", event: "failed", jobId: `j${s.jobId}`, url: `agenticos://job/j${s.jobId}` });
    }
    saveShips();
    if (key) schedule(key, 1000);
  }
  /** ship_status from a Builder job. */
  function report(builderJob: number, a: any): { ok: boolean; text: string } {
    const s = ledger.ships.find((x) => x.id === String(a.id ?? "").trim());
    if (!s) return { ok: false, text: `No ship ${a.id}.` };
    const key = Object.keys(confs).find((k) => confs[k].jobId === builderJob);
    if (key !== s.key) return { ok: false, text: `${s.id} belongs to another Builder.` };
    const state = String(a.state ?? "") as ShipReport;
    if (!SHIP_STATES.includes(state)) return { ok: false, text: `state is one of ${SHIP_STATES.join(", ")}.` };
    if (a.commit) s.commit = clip(String(a.commit).trim(), 64);
    s.builderJob = builderJob;
    mark(s, state, a.note ?? null);
    saveShips();
    o.host().touched(s.jobId);
    if (state === "live" || state === "failed")
      o.host().push(`${state === "live" ? "Live" : "Ship failed"}: ${s.title}`, clip(s.note ?? (state === "live" ? "It's live." : "The Builder couldn't ship it."), 180),
        { kind: "job", event: state === "live" ? "finished" : "failed", jobId: `j${s.jobId}`, url: `agenticos://job/j${s.jobId}` });
    return { ok: true, text: `${s.id}: ${state}.` };
  }

  /** A job's newest ship, as the phone shows it. */
  function latest(jobId: number) {
    for (let i = ledger.ships.length - 1; i >= 0; i--) {
      const s = ledger.ships[i];
      if (s.jobId === jobId) return { id: s.id, state: s.state, note: s.note, commit: s.commit, at: s.at, doneAt: s.doneAt, builderJob: s.builderJob ? `j${s.builderJob}` : null, deploy: s.deploy };
    }
    return null;
  }
  const notes = (key: string) => conf(key).notes;
  function list(keys: string[]) {
    const all = [...new Set([GLOBAL, ...keys, ...Object.keys(confs)])];
    return all.map((key) => ({ key, ...conf(key), jobId: conf(key).jobId ? `j${conf(key).jobId}` : null,
      ships: ledger.ships.filter((s) => s.key === key).slice(-15).reverse().map((s) => ({ ...s, jobId: `j${s.jobId}`, builderJob: s.builderJob ? `j${s.builderJob}` : null })) }));
  }
  function configure(key: string, b: any) {
    if (key !== GLOBAL && !o.host().projectExists(key)) throw new ApiError(404, `No project "${key}".`);
    const c = conf(key);
    const word = (v: unknown, re: RegExp, what: string) => { const s = String(v ?? "").trim(); if (!re.test(s)) throw new ApiError(400, `That isn't a ${what}.`); return s; };
    if (b.model !== undefined) c.model = word(b.model, /^[A-Za-z0-9][A-Za-z0-9_.:\-[\]]{0,99}$/, "model name");
    if (b.effort !== undefined) c.effort = word(b.effort, /^(low|medium|high|xhigh|max)$/, "Claude effort");
    if (b.notes !== undefined) c.notes = b.notes ? clip(String(b.notes), 4000) : null;
    confs[key] = c;
    saveConfs();
    return list([key]).find((x) => x.key === key)!;
  }
  /** Builder job numbers, so the board can keep them out of the lanes. */
  const isBuilderJob = (id: number) => Object.values(confs).some((c) => c.jobId === id);
  return { request, report, turnEnded, latest, notes, list, configure, isBuilderJob, kick };
}
export type Builders = ReturnType<typeof openBuilders>;
