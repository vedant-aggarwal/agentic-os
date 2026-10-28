// The agent on Today, small: her open questions (the Agent area's feed when it provides one, else her real asks from
// GET /wyn), answered right here, and his mood for the orb in the header (GET /wyn/mood when the PC has it, else an
// estimate from Today's own numbers: how much the day is short, what is late, how the night went).
import { api as call, ls } from './svc/api.js';
import { api, has } from './bus.js';
import { USER, AGENT, DEMO_MODE, boot, onData } from './data.js';
import { mountOrb, setMood, getMood } from './orb.js';
import { send } from './today-data.js';
import { S, REAL, NOW, TODAY, fit, unplanned, needsJobs, doneToday, leftToday, morningOf, changed, demoAsks } from './today-state.js';

const G = globalThis;
/** Load a shared stylesheet once (the motion kit's, until the shell links it). */
export function ensureCss(href) {
  if (document.querySelector(`link[href$="${href}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.append(l);
}

// ── her open questions ───────────────────────────────────────────────
// An ask, as Today shows it: { id, title, text, at: 'HH:MM', aspect, acts: [[label, value]] | null, from, source }
const ASK_KEY = 'aos-today:asks';
let wynAsks = REAL ? (ls.json(ASK_KEY) ?? []) : [];
let lastFetch = 0, fetching = null;
const hhmm = (iso) => { const d = new Date(Date.parse(iso) + 330 * 60000); return d.toISOString().slice(11, 16); };
const ownerAI = () => REAL && !!USER?.owner && boot()?.ai !== false;
async function fetchWyn(force = false) {
  if (!ownerAI() || has('agentAsks')) return;
  if (!force && Date.now() - lastFetch < 90000) return;
  if (fetching) return fetching;
  lastFetch = Date.now();
  fetching = call('/wyn', { timeout: 12000 }).then((st) => {
    const open = [];
    for (const m of st.messages ?? []) {
      const a = m.meta?.askState;
      if (m.role !== 'wyn' || !a || !['asked', 'calling'].includes(a.status)) continue;
      if (open.some((x) => x.id === a.id)) continue;
      // "Claude Code (client demo + studio site page) asks: Which number…" → who asks, and the question itself
      const from = String(a.from ?? '').trim();
      let q = String(m.text ?? '').trim();
      const lead = new RegExp(`^${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(asks|wants to know|needs)?\\s*[:,-]?\\s*`, 'i');
      if (from && lead.test(q)) q = q.replace(lead, '');
      q = q.replace(/^[a-z]/, (c) => c.toUpperCase());
      const who = from.replace(/\s*\(.*$/, '').trim();
      open.push({ id: a.id, title: q.length > 140 ? `${q.slice(0, 138).trimEnd()}…` : q, text: q.length > 140 ? q : '', at: m.at ? hhmm(m.at) : '', aspect: null, acts: null, from: who, source: 'wyn' });
    }
    wynAsks = open.reverse();
    ls.set(ASK_KEY, JSON.stringify(wynAsks));
    changed('asks');
  }).catch(() => {}).finally(() => { fetching = null; });
  return fetching;
}
if (REAL) {
  G.document?.addEventListener('visibilitychange', () => { if (G.document.visibilityState === 'visible') fetchWyn(); });
  setInterval(() => { if (G.document?.visibilityState === 'visible') fetchWyn(); }, 120000);
  setTimeout(() => fetchWyn(true), 1500);
  // her feed in the Agent area changed: read it again
  onData((why) => { if (why === 'agent') changed('asks'); });
  G.document?.addEventListener('agent-changed', () => changed('asks'));
}
/** The asks Today shows, newest first (answered ones leave at once). */
export function asks() {
  if (DEMO_MODE) return demoAsks().map((f) => ({ id: f.id, title: f.title, text: f.text, at: f.at, aspect: f.aspect, acts: (f.acts ?? []).map(([l, v]) => [l, v === 'feed-yes' ? 'yes' : 'no']), source: 'demo' }));
  let list = [];
  if (has('agentAsks')) { try { list = api.agentAsks() ?? []; } catch { list = []; } }
  else list = wynAsks;
  return list.filter((a) => a && !S.feed.has(a.id));
}
export const refreshAsks = () => fetchWyn(true);
/** Answer one: a choice (yes/no) or his words. The Agent area hears it; her ask is answered on the PC (queued). */
export function answer(a, value, text = null) {
  S.feed.set(a.id, value);
  if (DEMO_MODE) { if (has('agentAskDone')) api.agentAskDone(a.id, value === 'yes'); changed('feed'); return; }
  // the Agent area's answer does it all (her tab, badge, thread and the PC); agentAskDone only when it can't
  if (has('agentAnswer')) { try { api.agentAnswer(a.id, value, text); } catch {} }
  else {
    if (a.source === 'wyn') {
      send('POST', `/wyn/asks/${encodeURIComponent(a.id)}/answer`, { text: text ?? (value === 'yes' ? 'Yes' : 'No'), choice: value });
      wynAsks = wynAsks.filter((x) => x.id !== a.id); ls.set(ASK_KEY, JSON.stringify(wynAsks));
    }
    if (has('agentAskDone')) { try { api.agentAskDone(a.id, value === 'yes'); } catch {} }
  }
  changed('feed');
}
/** Later: out of the way here; her own snooze when the Agent area has one (her ask comes back in an hour). */
export function later(a) {
  S.feed.set(a.id, 'later');
  if (!DEMO_MODE && has('agentAnswer')) { try { api.agentAnswer(a.id, 'later'); } catch {} }
  changed('feed');
}
export const undoAnswer = (a) => { S.feed.delete(a.id); changed('feed'); };

// ── his mood ──────────────────────────────────────────────────────────
let moodSrc = 'none', moodAt = 0, moodMissing = false;
/** What Today's own numbers say: a day that doesn't fit, late work, a short night push the stress up. */
export function estimateMood() {
  const f = fit(), late = unplanned().late.length;
  const m = morningOf(TODAY);
  const slept = m.bed != null ? m.wake - m.bed : null;
  const done = doneToday().length, left = leftToday().length;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const stress = clamp(0.16 + 0.42 * clamp(f.over / 300) + 0.16 * clamp(late / 6) + (needsJobs().length ? 0.05 : 0) + (slept != null && slept < 360 ? 0.12 : 0));
  const hour = NOW / 60;
  const energy = clamp((hour < 6 ? 0.25 : hour < 11 ? 0.75 : hour < 15 ? 0.62 : hour < 20 ? 0.5 : 0.32) + (slept != null ? clamp((slept - 420) / 300, -0.25, 0.15) : 0));
  const valence = clamp((done + left ? done / (done + left) : 0.5) - 0.35 - 0.3 * clamp(f.over / 400), -1, 1);
  return { stress, energy, valence };
}
async function fetchMood() {
  if (!ownerAI() || moodMissing || Date.now() - moodAt < 8 * 60000) return null;
  moodAt = Date.now();
  try { const r = await call('/wyn/mood', { timeout: 10000 }); if (r && typeof r.stress === 'number') { moodSrc = 'pc'; return r; } }
  catch (e) { if (e?.status === 404) moodMissing = true; }
  return null;
}
/** Bring the orb (every orb in the app) to his mood: hers from the PC when it answers, else Today's estimate. */
export async function syncMood() {
  if (has('agentMood')) return;   // the Agent area sets it
  const pc = await fetchMood();
  if (pc) { setMood({ stress: pc.stress, energy: pc.energy ?? getMood().energy, valence: pc.valence ?? getMood().valence }); return; }
  if (moodSrc !== 'pc') { moodSrc = 'today'; setMood(estimateMood()); }
}
export const moodSource = () => moodSrc;

// ── the orb in the header ────────────────────────────────────────────
let orb = null;
export function mountHeaderOrb(host) {
  if (!host || host._orb) return host?._orb ?? null;
  ensureCss('css/motion.css');
  ensureCss('css/orb.css');
  try {
    orb = mountOrb(host, {
      size: 36, interactive: 'press', hold: true, pattern: 'box', label: AGENT.name,
      onTap: () => { if (REAL && USER && !USER.owner) return; api.openAgent(); },
    });
    host._orb = orb;
  } catch (e) { console.warn('[today] the orb could not start', e); host.classList.add('td-orb-off'); }
  syncMood();
  return orb;
}
