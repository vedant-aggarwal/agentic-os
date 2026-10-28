// Content OS · the data the Content tab draws, from the PC's content module (content.db through `agentos content`):
// ideas and the swipe deck (scored the way the nightly plan scores them, with the reasons), scripts and their rewrites,
// today's shoot pack and takes, edits, posts (the RealFlow ledger content-os keeps, plus approvals), the week, the
// streak, the learning loop's rules and his verdicts.
// Offline first: the last overview stays on the phone, and every write is an op in the content/ops collection (svc/store:
// outbox, client ids, retries) that the PC applies once by its id; ops still waiting are drawn over the overview, so a
// verdict made on the metro shows at once, survives a reload and lands when the PC answers.
// ?data=demo serves the prototype's sample (content-demo.js) unchanged.
import * as DEMO from './content-demo.js';
import { DEMO_MODE, GOALS, TASKS, AGENT, CONTENT, USER } from './data.js';
import * as API from './svc/api.js';
import * as clock from './svc/clock.js';
import { collection } from './svc/store.js';

export const REAL = !DEMO_MODE;
// a member has no Content (the owner's channels): nothing loads from the PC for them, nothing is asked of it
const MEMBER = REAL && !!USER && !USER.owner;
const G = globalThis;
const refill = (arr, items) => { arr.length = 0; arr.push(...items); return arr; };
const reset = (obj, next) => { for (const k of Object.keys(obj)) delete obj[k]; Object.assign(obj, next); return obj; };
const words = (t) => String(t ?? '').split(/\s+/).filter(Boolean).length;
const sentences = (t) => (String(t ?? '').match(/[^.!?।]+[.!?।]+["'”’)]*|[^.!?।]+$/g) ?? [t]).map((x) => x.trim()).filter(Boolean);
const paragraphs = (t) => String(t ?? '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const at = (iso) => (iso ? clock.hm(clock.toMin(iso, clock.dateOfIso(iso))) : null);
const dayOf = (iso) => (iso ? clock.dateOfIso(iso) : null);

// ── the two channels (plan decision 2): their identity is fixed, their numbers and settings come from the PC ──
const CH_BASE = {
  northwindstudio: { mono: 'N', tint: 'var(--content)', main: true, focus: 'The company channel: AI and what he builds, on camera', short2: 'Company channel' },
  example_creator: { mono: 'E', tint: 'var(--content-2)', main: false, focus: 'Magic and fun videos, casual', short2: 'Magic and fun' },
};
const chSkeleton = (handle, i) => ({ id: `@${handle}`, handle, short: handle, ...CH_BASE[handle], sort: i, voice: 'Hinglish', look: '', followers: null, delta: null,
  goal: null, slots: [], slotsSet: false, perDay: handle === 'northwindstudio' ? 1 : 0, perDaySet: false, setup: null });
export const CHS = REAL ? ['northwindstudio', 'example_creator'].map(chSkeleton) : DEMO.CHS;
export const chOf = (id) => CHS.find((c) => c.id === id || c.handle === String(id ?? '').replace(/^@/, '')) ?? CHS[0];
const atCh = (h) => `@${String(h ?? 'northwindstudio').replace(/^@/, '')}`;

// ── the bindings every Content screen reads (refilled in place; identity kept) ──
export const IDEAS = REAL ? [] : DEMO.IDEAS;
export const SCRIPTS = REAL ? {} : DEMO.SCRIPTS;
export const EDITS = REAL ? [] : DEMO.EDITS;
export const WEEK = REAL ? [] : DEMO.WEEK;
export const LEARN = REAL ? [] : DEMO.LEARN;
export const PROPOSALS = REAL ? [] : DEMO.PROPOSALS;
export const VERDICTS = REAL ? [] : DEMO.VERDICTS;
export const SHIFT = REAL ? [] : DEMO.SHIFT;
export const PACK = REAL ? [] : DEMO.PACK;
export const TAKES = [];                    // the PC's takes for today's pack (demo: none; the prototype's are local)
export const POSTS = [];                    // every real post (calendar month, the grid, stats)
export const SHOOT = REAL ? { at: null, len: 0, task: null, job: null, planned: null, setups: [], date: null, day: null, status: null } : DEMO.SHOOT;
export const STREAK = REAL ? { n: 0, best: 0, weekGoal: 7, freeze: false, today: false, atRisk: false, days: [] } : DEMO.STREAK;
export const RADAR = REAL ? { last: null, read: null, filed: 0, sources: [] } : DEMO.RADAR;
const emptyStats = () => ({ weeks: [], sent: [], followers: null, reels: 0, views: null, hold: null, follows: null, hook: [], format: [], topic: [], top: [], ahead: 0 });
export const STATS = REAL ? { '@northwindstudio': emptyStats(), '@example_creator': emptyStats() } : DEMO.STATS;
/** What the screens need to know about the data itself: loaded, stale, offline, the PC's flags and counts. */
export const META = { real: REAL, loaded: !REAL, fetchedAt: null, error: null, offline: false, flags: {}, counts: {}, deckCount: REAL ? 0 : DEMO.IDEAS.filter((x) => x.status === 'new').length,
  settings: {}, needs: [], jobs: {}, days: [], today: null, date: null, goal: null, kept30: 0, killed30: 0, rules: 0 };

// ── subscribers: the screens redraw when the data moves ──
const subs = new Set();
export const onData = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const tell = (why) => { for (const fn of subs) { try { fn(why); } catch (e) { console.warn('[content] data listener', e); } } G.document?.dispatchEvent?.(new CustomEvent('aspect-summary', { detail: { id: 'content' } })); };   // Today, Life and the widget redraw Content's figures

// ── the PC's overview → the shapes the prototype's screens draw ─────────────────────────────────────────
const SRC_OF = { evidence: 'work', share: 'reel', reel: 'reel', radar: 'radar', email: 'email', agent: 'agent', chat: 'you', cli: 'you', keyword: 'you' };
function srcKind(x) {
  if (x.source === 'import') {
    const t = (x.tags ?? [])[0];
    return ({ radar: 'radar', share: 'reel', email: 'email', agent: 'agent' })[t] ?? 'agent';
  }
  const k = SRC_OF[x.source] ?? 'you';
  if (k === 'reel' && x.link && !/instagram|youtu|tiktok/i.test(x.link)) return 'link';
  return k;
}
const IDEA_STATUS = { inbox: 'new', picked: 'kept', scripted: 'scripted', approved: 'scripted', shot: 'shot', edited: 'edited', scheduled: 'scheduled', posted: 'posted', dropped: 'killed' };
const NEG = /older|killed|lower|stale|not /i;
const reason = (w) => [NEG.test(w) ? '−' : '+', capFirst(String(w).replace(/^your verdict/, 'your verdict'))];
function fromLine(x, kind) {
  const d = clock.dayLabel(x.created);
  const lead = { work: 'From your work', radar: 'The radar filed it', reel: 'You shared a reel', link: 'You shared a link', email: 'From an email', agent: 'Research', you: 'You wrote it' }[kind] ?? 'Filed';
  return `${lead} · ${d}`;
}
function ideaView(x) {
  const kind = srcKind(x);
  const card = x.card && typeof x.card === 'object' ? x.card : null;
  const score = typeof x.score === 'number' && Number.isFinite(x.score) ? x.score : null;
  return {
    id: x.id, title: x.title, ch: atCh(x.channel), source: kind, status: IDEA_STATUS[x.status] ?? 'new', raw: x.status,
    score: score == null ? null : Math.max(0, Math.min(10, score)), rawScore: score, why: Array.isArray(x.why) ? x.why.map(reason) : [], at: x.created, from: fromLine(x, kind),
    hook: x.hook ? String(x.hook).trim().replace(/^["“”']+|["“”']+$/g, '') : null, angle: String(x.raw ?? '').match(/^Angle:\s*(.+)$/m)?.[1]?.trim() ?? null, proof: null, link: x.link ?? null, take: null, script: x.script ?? null, note: x.raw ? String(x.raw).split('\n').filter((l) => !/^(Angle|Hook):/i.test(l.trim())).join('\n').trim() || null : null, evidence: x.evidence ?? null,
    skeleton: Array.isArray(x.skeleton) ? x.skeleton : null,
    ref: card ? { views: null, age: null, hook: card.hook ?? '', structure: card.structure ?? '', why: card.why ?? '', format: card.format ?? '', summary: card.summary ?? '', useFor: card.useFor ?? '', basis: card.basis ?? null, note: null } : null,
    real: true,
  };
}
/** A script for the screens: hook (first paragraph), beats (the middle paragraphs, sentence by sentence), CTA (the last). */
export function scriptView(s, setups = SHOOT.setups) {
  const P = paragraphs(s.teleprompter);
  const full = P.length > 0;
  const cta = full ? (P.length >= 3 ? P[P.length - 1] : '') : (s.cta ?? '');
  const mid = full ? P.slice(1, P.length >= 3 ? -1 : undefined) : [];
  const v = {
    id: s.id, code: s.take ?? null, idea: s.idea ?? null, ch: atCh(s.channel), setup: Math.max(0, setups.findIndex((g) => (g.codes ?? []).includes(s.id))),
    status: s.status === 'shot' ? 'shot' : s.status === 'rejected' ? 'rejected' : 'ready', raw: s.status, title: s.title,
    hooks: [full ? P[0] : (s.hook ?? s.title)], hook: 0, beats: mid.map((t, i) => ({ k: mid.length > 1 ? `Beat ${i + 1}` : 'Body', say: sentences(t), show: '' })), cta,
    words: s.words ?? null, secs: s.seconds ?? null, full, language: s.language ?? null, day: s.day ?? null, version: s.version ?? 1,
    revisions: (s.revisions ?? []).length, previous: s.previous ?? null, created: s.created, real: true, src: sourceOf(s),
  };
  if (full) { v.words = words(P.join(' ')); v.secs = s.seconds ?? Math.round(v.words / 2.3); }
  v.checks = checksOf(v);
  return v;
}
/** What a remix copies, from the script file's front matter (outlier, archive, posted: written by `content-axi intel`)
 *  and its "Based on" line; null for a script with neither (or before the full script has loaded). */
function sourceOf(s) {
  const body = String(s.body ?? '');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1] ?? '';
  const key = (k) => fm.match(new RegExp(`^${k}:\\s*(https?://\\S+)\\s*$`, 'm'))?.[1] ?? null;
  const by = body.match(/^## Based on\s+- \[@([\w.]+)\]\([^)]*\):\s*([^\n]*)/m);
  const src = { outlier: key('outlier'), archive: key('archive'), posted: key('posted'), owner: by?.[1] ?? null, stats: by?.[2]?.trim().replace(/\.$/, '') || null };
  return src.outlier || src.archive || src.posted ? src : null;
}
/** The ready check, from the text itself (his doctrine: hook in two seconds, under a minute, one CTA, no keyword DM promise). */
function checksOf(v) {
  if (!v.full) return [];
  const out = [];
  const hw = words(v.hooks[0]);
  const hs = Math.max(1, Math.round(hw / 2.5));
  out.push(hw <= 14 ? ['ok', `Hook is ${hw} words: it lands in about ${hs} s`] : ['warn', `Hook runs ${hw} words: about ${hs} s before it lands`]);
  if (v.secs) out.push(v.secs <= 60 ? ['ok', `About ${v.secs} s long`] : ['warn', `About ${v.secs} s: over a minute`]);
  if (!v.cta) out.push(['warn', 'No call to action at the end']);
  else if (/\b(comment|dm)\b/i.test(v.cta)) out.push(['warn', 'The CTA asks for a comment or DM: is its reply set up?']);
  else out.push(['ok', 'One call to action at the end']);
  return out;
}
const SCENE = [[/claude|codex|agent|code|ai\b|gpt|gemini|model|bot/i, 'agents'], [/kurta|drape|pallu|fold/i, 'kurta'], [/shop|dukaan|store/i, 'shop'],
  [/₹|rupee|lakh|price|money|paise/i, 'coin'], [/site|web|page|domain/i, 'site'], [/magic|trick|coin|card/i, 'card'], [/metro|delhi|road|car|roadster/i, 'metro']];
export const coverOf = (title) => {
  const w = String(title ?? '').split(/\s+/).filter(Boolean);
  const k = Math.min(w.length, Math.max(2, Math.ceil(w.length / 2)));
  return { lines: [w.slice(0, Math.min(k, 4)).join(' '), w.slice(Math.min(k, 4), Math.min(k, 4) + 4).join(' ')], hi: 0, scene: (SCENE.find(([re]) => re.test(title ?? '')) ?? [0, 'desk'])[1] };
};
const EDIT_STATUS = { review: 'review', redo: 'redo', draft: 'draft', approved: 'scheduled' };
function editView(e, postsByEdit) {
  const p = postsByEdit.get(e.id) ?? null;
  const notes = Array.isArray(e.notes) ? e.notes : [];
  return {
    id: e.id, title: e.title ?? 'Untitled edit', ch: atCh(e.channel), status: EDIT_STATUS[e.status] ?? e.status, raw: e.status, v: 1, len: null,
    post: p?.at ? `${clock.dayLabel(dayOf(p.at))} ${at(p.at)}` : null, postAt: p?.at ?? null, postStatus: p?.status ?? null, postId: p?.id ?? null,
    cover: coverOf(e.title), changes: [], checks: [], caption: null, tags: [], render: !!e.render, script: e.script ?? null, recipe: e.recipe ?? null,
    history: [['v1', clock.dayLabel(e.created), e.render ? 'Rendered' : 'Not rendered yet'], ...notes.map((n) => ['note', `${clock.dayLabel(dayOf(n.at))} ${at(n.at)}`, n.text])],
    real: true,
  };
}
/** sent = RealFlow had it scheduled and the time passed (the ledger has no read-back of the publish itself) */
const postState = (p, now) => (p.status === 'posted' || (p.status === 'scheduled' && p.at && Date.parse(p.at) <= now) ? 'posted' : p.status === 'dry-run' ? 'dry' : 'scheduled');
function postView(p, now) {
  const d = dayOf(p.at);
  return { id: p.id, ch: atCh(p.channel), t: at(p.at) ?? '', iso: d, at: p.at, title: p.title ?? 'A reel', s: postState(p, now), status: p.status, edit: p.edit ?? null, idea: p.idea ?? null,
    realflow: p.realflow ?? null, cover: coverOf(p.title), source: p.source ?? null, views: null };
}

function ingest(o) {
  const now = clock.nowMs();
  const today = clock.today();
  META.today = o.today ?? today; META.date = o.date ?? today;
  reset(META.flags, o.flags ?? {}); reset(META.counts, o.counts ?? {}); reset(META.settings, o.settings ?? {});
  META.needs = o.settings?.needs ?? []; META.jobs = o.jobs ?? {}; META.days = o.days ?? [];
  META.deckCount = o.deck?.count ?? 0; META.kept30 = o.learnings?.counts?.kept30 ?? 0; META.killed30 = o.learnings?.counts?.killed30 ?? 0; META.rules = o.learnings?.counts?.rules ?? 0;
  const goal = GOALS.find((g) => /follower/i.test(g.title ?? '')) ?? GOALS.find((g) => /instagram/i.test(g.title ?? '')) ?? GOALS.find((g) => /audience|reels/i.test(g.title ?? '')) ?? null;
  META.goal = goal?.id ?? null;

  // channels: settings and the PC's own description
  const st = o.settings ?? {};
  for (const ch of o.channels ?? []) {
    let c = CHS.find((x) => x.handle === ch.handle);
    if (!c) { c = chSkeleton(ch.handle, CHS.length); CHS.push(c); }
    const slots = String(st.slots?.[ch.handle] ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.padStart(5, '0')).sort();
    const per = st.reels_per_day?.[ch.handle];
    Object.assign(c, { voice: capFirst(ch.language ?? 'hinglish'), look: ch.setup ? [ch.setup.location, ch.setup.framing].filter(Boolean).join(' · ') : '', setup: ch.setup ?? null,
      slots, slotsSet: slots.length > 0, perDay: per ?? o.defaults?.[ch.handle] ?? c.perDay, perDaySet: per != null, goal: ch.handle === 'northwindstudio' ? META.goal : null });
  }

  // today's pack: setups, scripts in take order, takes
  const pk = o.pack ?? {};
  const setups = (pk.setups ?? []).map((g) => ({ name: g.location || 'Anywhere', framing: g.framing || 'Talking head', props: g.props || '', light: null, outfit: null,
    frame: /wide|handheld|walk/i.test(g.framing ?? '') ? 'wide' : 'mcu', codes: g.scripts ?? [], when: null }));
  const shootAt = /^\d{1,2}:\d{2}$/.test(st.shoot_at ?? '') ? Number(st.shoot_at.split(':')[0]) * 60 + Number(st.shoot_at.split(':')[1]) : null;
  const task = pk.task ? TASKS.find((t) => t.id === pk.task) : null;
  const taskAt = task?.at && /^\d{1,2}:\d{2}$/.test(task.at) ? Number(task.at.split(':')[0]) * 60 + Number(task.at.split(':')[1]) : null;
  reset(SHOOT, { at: shootAt ?? taskAt, len: (pk.scripts?.length ?? 0) * 20, task: pk.task ?? null, job: null, planned: null, setups, date: pk.date ?? today, day: pk.shootDay ?? null,
    status: pk.status ?? null, pending: pk.pending ?? [] });
  const keep = {};
  for (const [id, s] of Object.entries(SCRIPTS)) if (s.full && !(pk.scripts ?? []).some((x) => x.id === id)) keep[id] = s;   // opened earlier: keep its text
  reset(SCRIPTS, keep);
  for (const s of o.recent ?? []) if (!SCRIPTS[s.id]) SCRIPTS[s.id] = scriptView(s, setups);
  for (const s of pk.scripts ?? []) SCRIPTS[s.id] = scriptView(s, setups);
  refill(PACK, (pk.scripts ?? []).slice().sort((a, b) => String(a.take ?? '').localeCompare(String(b.take ?? ''), undefined, { numeric: true })).map((s) => s.id));
  const perScript = new Map();
  refill(TAKES, (o.takes ?? []).map((t) => {
    const n = (perScript.get(t.script) ?? 0) + 1; perScript.set(t.script, n);
    return { id: t.id, code: t.script ? (SCRIPTS[t.script]?.code ?? t.script) : null, script: t.script, n, secs: t.duration ?? null, p: 1, kept: !!t.chosen, best: !!t.chosen,
      src: 'pc', match: t.match ?? null, transcript: t.transcript, real: true };
  }));

  // ideas: the deck (scored, best first) then the rest of the inbox, kept and scripted ones
  const seen = new Set();
  const ideas = [];
  for (const x of o.deck?.ideas ?? []) { seen.add(x.id); ideas.push(ideaView(x)); }
  for (const x of o.inbox ?? []) if (!seen.has(x.id)) { seen.add(x.id); ideas.push(ideaView(x)); }
  for (const i of ideas) { const s = i.script && SCRIPTS[i.script]; if (s) i.take = s.code ?? s.id; }
  refill(IDEAS, ideas);

  // edits and posts
  const posts = (o.posts ?? []).filter((p) => p.at && ['scheduled', 'posted', 'dry-run'].includes(p.status)).map((p) => postView(p, now));
  refill(POSTS, posts.sort((a, b) => String(a.at).localeCompare(String(b.at))));
  const byEdit = new Map();
  for (const p of o.posts ?? []) if (p.edit && ['scheduled', 'dry-run', 'posted'].includes(p.status) && !byEdit.has(p.edit)) byEdit.set(p.edit, p);
  refill(EDITS, (o.edits ?? []).map((e) => editView(e, byEdit)));

  // the week (Monday to Sunday, IST) and the streak: a day counts when a reel went out on either channel
  const dow = clock.dparts(today).dow;
  const monday = clock.addDays(today, -((dow + 6) % 7));
  const sentDays = new Set(POSTS.filter((p) => p.s === 'posted').map((p) => p.iso));
  refill(WEEK, Array.from({ length: 7 }, (_, i) => {
    const iso = clock.addDays(monday, i), p = clock.dparts(iso);
    return { d: clock.WEEKDAYS[p.dow].slice(0, 3), n: p.day, iso, today: iso === today, past: iso < today, future: iso > today, tomorrow: iso === clock.addDays(today, 1),
      posts: POSTS.filter((x) => x.iso === iso) };
  }));
  let n = 0, d = sentDays.has(today) ? today : clock.addDays(today, -1);
  while (sentDays.has(d)) { n++; d = clock.addDays(d, -1); }
  let best = 0, run = 0, prev = null;
  for (const day of [...sentDays].sort()) { run = prev && clock.daysBetween(prev, day) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = day; }
  const todayPosts = POSTS.filter((p) => p.iso === today);
  reset(STREAK, { n, best: Math.max(best, n), weekGoal: Math.max(1, CHS.reduce((a, c) => a + (Number(c.perDay) || 0), 0)) * 7, freeze: false,
    today: todayPosts.some((p) => p.s === 'posted'), atRisk: !todayPosts.length, days: [...sentDays] });

  // stats per channel: reels that went out per week (8 weeks), the last 30 days, what's booked ahead
  const mondays = Array.from({ length: 8 }, (_, i) => clock.addDays(monday, -7 * (7 - i)));
  for (const c of CHS) {
    const mine = POSTS.filter((p) => p.ch === c.id);
    const sent = mine.filter((p) => p.s === 'posted');
    STATS[c.id] = { ...emptyStats(), weeks: mondays.map((m) => { const q = clock.dparts(m); return `${q.day} ${clock.MONTHS[q.month].slice(0, 3)}`; }),
      sent: mondays.map((m) => sent.filter((p) => p.iso >= m && p.iso < clock.addDays(m, 7)).length),
      reels: sent.filter((p) => p.iso >= clock.addDays(today, -30)).length, ahead: mine.filter((p) => p.s === 'scheduled').length, top: sent.slice(-3).reverse().map((p) => p.title) };
  }

  // the learning loop: rules with their receipts, his verdicts
  const fresh = clock.addDays(today, -7);
  refill(LEARN, (o.learnings?.rules ?? []).map((r) => ({ id: r.id, on: !r.muted, rule: r.text, ch: null, count: r.count ?? 1,
    from: r.count > 1 ? `From ${r.count} reels` : r.kind === 'note' ? `Your note on ${r.receipts?.[0] ?? 'an edit'}` : `Receipt: ${r.receipts?.[0] ?? 'content-os'}`,
    since: clock.dayLabel(r.date), date: r.date, shapes: r.kind === 'note' ? 'Edits' : 'Scripts', fresh: r.date >= fresh, kind: r.kind })));
  refill(VERDICTS, (o.learnings?.verdicts ?? []).map((v) => ({ id: v.id, at: clock.dayLabel(dayOf(v.at)), title: v.title, v: v.v, why: v.why, idea: v.idea })));
  refill(PROPOSALS, []);

  // the radar and what ran in Content today
  const runs = META.jobs ?? {};
  const todayIdeas = (o.inbox ?? []).concat(o.deck?.ideas ?? []).filter((x, i, a) => x.created === today && a.findIndex((y) => y.id === x.id) === i);
  reset(RADAR, { last: runs.sweep?.at ? at(runs.sweep.at) : null, read: null, filed: todayIdeas.filter((x) => srcKind(x) === 'radar').length,
    sources: [['Reels and links you share', (o.counts?.references && Object.values(o.counts.references).reduce((a, b) => a + Number(b), 0)) || 0], ['Your work, every evening', null]] });
  buildShift(todayIdeas, runs, today);
  META.loaded = true;
  bindShared();
}
function buildShift(todayIdeas, runs, today) {
  const rows = [];
  const ranToday = (r) => r?.at && clock.dateOfIso(r.at) === today;
  if (ranToday(runs.plan)) rows.push({ at: at(runs.plan.at), icon: 'layers', text: runs.plan.ok === false ? 'The nightly plan failed; open the pack to run it again' : `Planned today's pack: ${PACK.length} ${PACK.length === 1 ? 'script' : 'scripts'}`, go: 'pack' });
  if (ranToday(runs.buildpublic)) rows.push({ at: at(runs.buildpublic.at), icon: 'hammer', text: 'Read what you finished today for reel ideas', go: 'ideas' });
  const work = todayIdeas.filter((x) => srcKind(x) === 'work');
  if (work.length) rows.push({ at: at(work[work.length - 1].updated_at ?? `${today}T15:30:00Z`) ?? '21:30', icon: 'hammer', text: `Found ${work.length} reel ${work.length === 1 ? 'idea' : 'ideas'} in what you built`, go: 'ideas' });
  for (const op of OPS ? OPS.list().filter((d) => d.source === 'agent' && clock.dateOfIso(d.created_at) === today && d.state === 'done') : []) {
    const text = { capture: 'Filed an idea', rewrite: `Rewrote ${op.script ?? 'a script'}`, write: `Wrote a script for ${op.idea ?? 'an idea'}`, note: `Sent ${op.edit ?? 'an edit'} back with a note`, plan: 'Planned the pack', revert: `Put ${op.script ?? 'a script'} back` }[op.kind];
    if (text) rows.push({ at: at(op.created_at), icon: op.kind === 'capture' ? 'radar' : 'film', text, go: op.kind === 'capture' ? 'ideas' : op.script ? `script:${op.script}` : 'pack' });
  }
  refill(SHIFT, rows.sort((a, b) => String(a.at).localeCompare(String(b.at))));
}
/** data.js CONTENT: the shape other areas read (Today's fallback line, Growth's week) from the same real data. */
function bindShared() {
  if (!REAL || !CONTENT || typeof CONTENT !== 'object') return;
  CONTENT.inbox = IDEAS.filter((x) => x.status === 'new').slice(0, 20).map((x) => ({ id: x.id, title: x.title, ch: x.ch, source: x.source, status: 'Inbox', tags: [] }));
  CONTENT.pack = { day: clock.label(SHOOT.date ?? clock.today()).short, scripts: PACK.length, setups: SHOOT.setups.map((g) => ({ name: g.name, framing: g.framing, props: g.props,
    takes: g.codes.map((id) => ({ code: SCRIPTS[id]?.code ?? id, title: SCRIPTS[id]?.title ?? id, secs: SCRIPTS[id]?.secs ?? null, words: SCRIPTS[id]?.words ?? null, status: SCRIPTS[id]?.status === 'shot' ? 'Shot' : 'Ready' })) })) };
  CONTENT.edits = EDITS.map((d) => ({ id: d.id, title: d.title, ch: d.ch, status: d.status === 'review' ? 'Needs approval' : d.status, note: '', post: d.post }));
  CONTENT.posts = WEEK.filter((w) => !w.past).map((w) => ({ day: w.today ? 'Today' : `${w.d} ${w.n}`, items: w.posts.map((p) => ({ ch: p.ch, title: p.title, status: p.s === 'posted' ? 'Sent' : 'Scheduled', time: p.t })) }));
  CONTENT.stats = { followers: null, goal: null, week: WEEK.reduce((a, w) => a + w.posts.filter((p) => p.s === 'posted').length, 0), weekGoal: STREAK.weekGoal, streak: STREAK.n };
}

// ── the outbox: every write is an op (svc/store) the PC applies once; waiting ones are drawn over the overview ──
const OPS = REAL && !MEMBER ? collection('content/ops', { endpoint: '/api/v1/mod/content/ops', prefix: 'op', interval: 0 }) : null;
const done = (d) => !!d.applied_at || d.state === 'refused' || d.state === 'failed';
/** Ops not yet applied on the PC (offline, in flight, or running there). */
export const pendingOps = (kind = null) => (OPS ? OPS.list().filter((d) => !done(d) && (!kind || d.kind === kind)) : []);
export const opOf = (id) => OPS?.get(id) ?? null;
export const opsErrors = () => (OPS ? OPS.errors() : new Map());
/** What one op looks like on the phone before the PC answers. */
function applyLocal(op) {
  const idea = op.idea && IDEAS.find((x) => x.id === op.idea);
  const ed = op.edit && EDITS.find((x) => x.id === op.edit);
  const sc = op.script && SCRIPTS[op.script];
  switch (op.kind) {
    case 'verdict':
      if (idea) {
        idea.status = op.v === 'kill' ? 'killed' : op.v === 'restore' ? (IDEA_STATUS[op.was] ?? 'new') : op.v === 'script' ? 'writing' : 'kept';
        if (op.v !== 'restore' && !VERDICTS.some((v) => v.op === op.id)) VERDICTS.unshift({ op: op.id, at: 'Now', title: idea.title, v: op.v === 'kill' ? 'kill' : 'keep', why: op.why ?? null, idea: idea.id });
        if (op.v === 'restore') { const i = VERDICTS.findIndex((v) => v.op === op.undo || (v.idea === idea.id && v.at === 'Now')); if (i >= 0) VERDICTS.splice(i, 1); }
      }
      break;
    case 'write': if (idea) idea.status = 'writing'; break;
    case 'capture':
      if (!IDEAS.some((x) => x.op === op.id)) {
        const link = op.link ?? op.url ?? null;
        IDEAS.unshift({ id: `op:${op.id}`, op: op.id, title: op.title || op.text || link || 'A new idea', ch: atCh(op.channel), source: link ? (/instagram|youtu|tiktok/i.test(link) ? 'reel' : 'link') : 'you',
          status: 'new', score: null, why: [['+', 'You saved it yourself']], at: clock.today(), from: `${link ? 'You shared it' : 'You wrote it'} · just now`, hook: null, link, ref: null, pending: true, real: true });
      }
      break;
    case 'idea': if (idea && op.channel) idea.ch = atCh(op.channel); break;
    case 'approve': if (ed) { ed.status = 'scheduled'; ed.pending = true; } break;
    case 'unapprove': if (ed) { ed.status = 'review'; ed.post = null; } break;
    case 'note': if (ed) { ed.status = 'redo'; if (!ed.history.some((h) => h[3] === op.id)) ed.history.push(['note', 'Now', op.text, op.id]); } break;
    case 'script': if (sc) sc.status = op.status === 'shot' ? 'shot' : 'ready'; break;
    case 'rewrite': if (sc) sc.rewriting = op.id; break;
    case 'revert': if (sc) sc.reverting = op.id; break;
    case 'settings':
      for (const [k, v] of Object.entries(op.values ?? {})) {
        const m = k.match(/^(reels_per_day|slots)\.(\w+)$/);
        const c = m && CHS.find((x) => x.handle === m[2]);
        if (c && m[1] === 'reels_per_day') { c.perDay = Number(v) || 0; c.perDaySet = v != null && v !== ''; }
        if (c && m[1] === 'slots') { c.slots = String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean).sort(); c.slotsSet = c.slots.length > 0; }
        if (k === 'shoot_at') SHOOT.at = /^\d{1,2}:\d{2}$/.test(v ?? '') ? Number(v.split(':')[0]) * 60 + Number(v.split(':')[1]) : null;
      }
      break;
    case 'rule': { const l = LEARN.find((x) => x.id === op.learning); if (l) l.on = op.on !== false; break; }
    case 'plan': META.planning = op.id; break;
  }
}
const reapply = () => { for (const d of pendingOps().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) applyLocal(d); };
/** Make a change: on screen now, on the PC when it answers (offline: whenever it comes back). Returns the op. */
export function send(kind, fields = {}) {
  if (!REAL) return null;
  const doc = OPS.add({ kind, ...fields, date: fields.date ?? clock.today(), source: 'phone' });
  applyLocal(doc);
  tell('local');
  later(400);
  return doc;
}
let laterT = 0;
function later(ms) {
  G.clearTimeout?.(laterT);
  laterT = G.setTimeout?.(() => OPS.flush().then(() => refresh()).catch(() => {}), ms);
}
// a slow op (a rewrite, the plan) runs on the PC: look again every few seconds until it lands
let watchT = 0;
function watchRunning() {
  G.clearTimeout?.(watchT);
  if (!OPS || !OPS.list().some((d) => d.state === 'running')) return;
  watchT = G.setTimeout?.(() => { OPS.refresh().then(watchRunning); }, 3000);
}
if (OPS) {
  OPS.on('change', (e) => {
    if (e.why === 'server') {   // an op finished (or failed) on the PC: the overview has its outcome
      const failed = OPS.list().filter((d) => e.ids?.includes(d.id) && (d.state === 'failed' || d.state === 'refused') && !shown.has(d.id));
      for (const d of failed) { shown.add(d.id); G.dispatchEvent?.(new CustomEvent('content-op-failed', { detail: { id: d.id, kind: d.kind, error: d.error } })); }
      refresh();
    }
    watchRunning();
  });
  OPS.on('error', (e) => { G.dispatchEvent?.(new CustomEvent('content-op-failed', { detail: { id: e.id, error: e.error } })); refresh(); });
}
const shown = new Set();

// ── loading: the phone's copy first, then the PC ──
const CACHE = 'agentos-app:content';
let inflight = null, lastFetch = 0;
export function refresh({ force = false } = {}) {
  if (!REAL || MEMBER) return Promise.resolve();
  if (inflight) return inflight;
  if (!force && Date.now() - lastFetch < 1500) return Promise.resolve();
  inflight = (async () => {
    try {
      const o = await API.api('/mod/content/overview', { timeout: 25000 });
      lastFetch = Date.now();
      ingest(o); reapply();
      META.fetchedAt = new Date().toISOString(); META.error = null; META.offline = false;
      try { API.ls.set(CACHE, JSON.stringify({ at: META.fetchedAt, o })); } catch { /* full: the next load fetches */ }
      tell('server');
      watchRunning();
    } catch (e) {
      META.error = e.status === 403 ? 'Content OS is the owner\'s.' : e.message; META.offline = !e.status;
      tell('error');
    } finally { inflight = null; }
  })();
  return inflight;
}
export const ready = REAL && !MEMBER ? (async () => {
  const c = API.ls.json(CACHE);
  await OPS.ready.catch(() => {});
  if (c?.o) { try { ingest(c.o); META.fetchedAt = c.at; reapply(); tell('cache'); } catch (e) { console.warn('[content] cache', e); } }
  else { reapply(); }
  refresh({ force: true });
  G.document?.addEventListener('visibilitychange', () => { if (G.document.visibilityState === 'visible' && Date.now() - lastFetch > 30000) refresh(); });
  G.addEventListener?.('online', () => { OPS.flush().then(() => refresh({ force: true })); });
  G.setInterval?.(() => { if (G.document?.visibilityState === 'visible' && G.document.querySelector?.('.ct, .ct-page') && Date.now() - lastFetch > 55000) refresh(); }, 60000);
  clock.onDay?.(() => refresh({ force: true }));
})() : Promise.resolve();

/** One script with its full text (the overview carries today's pack in full; others load on open, then stay). */
export async function loadScript(id) {
  if (!REAL) return SCRIPTS[id] ?? null;
  if (SCRIPTS[id]?.full) return SCRIPTS[id];
  try {
    const r = await API.api(`/mod/content/scripts/${encodeURIComponent(id)}`);
    if (r?.script) { SCRIPTS[id] = scriptView(r.script); reapply(); tell('script'); }
  } catch (e) { if (!SCRIPTS[id]) throw e; }
  return SCRIPTS[id] ?? null;
}
/** A playable link for an edit's render or a take (a signed URL: a <video> carries no session). */
export async function mediaUrl(ref) {
  const kind = ref.startsWith('k') ? 'takes' : 'edits';
  const r = await API.api(`/mod/content/${kind}/${encodeURIComponent(ref)}/media`);
  return { url: `${API.apiBase()}${r.url}`, type: r.type, bytes: r.bytes };
}
/** The edit's caption, from its script (hook and CTA), for the post field. */
export async function captionFor(d) {
  if (!REAL || !d.script || d.caption != null) return d.caption;
  try { const s = await loadScript(d.script); d.caption = s ? [s.hooks[0], s.cta].filter(Boolean).join('\n\n') : ''; } catch { d.caption = ''; }
  return d.caption;
}
