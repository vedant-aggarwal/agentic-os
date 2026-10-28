// Her pages, one level down from her tab, on her real data (the PC's /api/v1/wyn routes; demo mode draws the sample):
// her day (every heartbeat and what she did, noticed and asked, any of the last four days), reminders and alarms (the
// ladder, per app, quiet hours), what she can do (every app's tools, his autonomy per app and per tool), her (name,
// voice, how she talks, her soul, models, how often she reaches out), what she remembers, her calls, his mood (with the
// way out: breathe), an agent's question to answer, and meeting her (where a new user names theirs).
import { $, $$, esc, push, openSheet, closeSheet, toast, haptic, on, ring, seg, wireSegs } from './core.js';
import { I } from './icons.js';
import { ASPECTS, DEMO_MODE } from './data.js';
import { api } from './bus.js';
import * as API from './svc/api.js';
import { AG, AI, onChange, changed, act, refresh, savePrefs, answer, undoItem, agName, aspName, dot, tileFor, home, openAsks } from './agent-state.js';
import { RUNGS, ALWAYS_ASKS, AUTONOMY, VOICES, TALK, toneOf, sample, toolTitle, PRODUCT, EVERY, hm, hmOf, minOf } from './agent-data.js';
import { askHtml, answerCard, dayWord } from './agent-home.js';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const RUNG_ICON = { off: I.x, note: AI.bell, banner: AI.banner, alarm: AI.alarm, call: I.phone };
const nowMs = () => (DEMO_MODE ? Date.UTC(2026, 9, 22, 12, 10) : Date.now());
const istDay = (ms = nowMs()) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const today = () => AG.home?.day ?? istDay();
const addDays = (day, k) => new Date(Date.parse(`${day}T12:00:00+05:30`) + k * 864e5 + 330 * 60000).toISOString().slice(0, 10);
const dayLabel = (day) => { const d = new Date(Date.parse(`${day}T12:00:00+05:30`)); return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }); };
const mins = (s) => (s >= 60 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s || 0))} s`);
/** A read from the PC. Demo mode never fetches; an error comes back as { error, offline }. */
async function read(path) {
  if (DEMO_MODE) return null;
  try { return await API.api(path, { timeout: 15000 }); } catch (e) { return { error: e?.message ?? 'The PC isn\'t answering', offline: !e?.status }; }
}
const offNote = () => (AG.offline ? `<div class="note ag-off">${I.clock}<span>Offline. This is what she had at ${esc(hmOf(new Date(AG.at || Date.now()).toISOString()))}; what you change waits and syncs.</span></div>` : '');
const failNote = (r) => (r?.error ? `<div class="note ag-off">${I.x}<span>${r.offline ? 'Your PC isn\'t answering, so this can\'t load right now.' : esc(r.error)}</span></div>` : '');

// ── pages that redraw when her state changes ──────────────────────────
const live = new Map();   // redraw → the changes it cares about
onChange((what) => live.forEach((whats, f) => { if (!whats || whats.includes(what)) { try { f(); } catch (e) { console.warn('[agent] page redraw', e); } } }));
function page(opts) {
  const pg = push({ cls: `ag-pg ${opts.cls ?? ''}`, ...opts, render(sc, p) { opts.render(sc, p); wireSegs(sc); }, onPop() { live.delete(redraw); opts.onPop?.(); } });
  const redraw = () => {
    if (!pg.isConnected) { live.delete(redraw); return; }
    const sc = $('.scroll', pg), y = sc.scrollTop;
    opts.render(sc, pg); wireSegs(sc); sc.scrollTop = y;
  };
  if (opts.live) live.set(redraw, Array.isArray(opts.live) ? opts.live : null);
  pg._redraw = redraw;
  return pg;
}

// ── her day ──────────────────────────────────────────────────────────
let FILTER = 'all', DAY = null;
const DAYS = new Map();   // past days fetched: day → { beats, items } | { error }
export function openFeed(day) {
  DAY = day ?? today();
  const pg = page({ title: 'Her day', live: ['home', 'asks', 'did'], render(sc) {
    const d = dayData(DAY);
    const items = d.items ?? [], beats = d.beats ?? [];
    const did = items.filter((x) => (x.kind === 'did' || x.kind === 'call') && !x.undone).length;
    const asked = items.filter((x) => x.kind === 'ask').length, quiet = beats.filter((b) => b.kind === 'ok').length;
    const days = [0, -1, -2, -3].map((k) => addDays(today(), k));
    sc.innerHTML = `<header class="phead"><h1 class="lt">Her day</h1><p class="sub">${esc(dayLabel(DAY))} · a check every ${EVERY} minutes while you're up</p></header>
      ${offNote()}
      <div class="pad agp-days">${seg('agp-day', days.map((x, i) => [x, i === 0 ? 'Today' : i === 1 ? 'Yesterday' : dayLabel(x).split(',')[0]]), DAY)}</div>
      <div class="surface ag-stats">
        <div><b class="met">${beats.length}</b><small>checks</small></div>
        <div><b class="met">${quiet}</b><small>quiet</small></div>
        <div><b class="met">${did}</b><small>things done</small></div>
        <div><b class="met c-needs">${asked}</b><small>asks</small></div>
      </div>
      <div class="pad ag-filter">${seg('agp-filter', [['all', 'All'], ['did', 'Done'], ['ask', 'Asked'], ['ok', 'Quiet']], FILTER)}</div>
      <div class="ag-feed">${d.loading ? '<div class="ag-skel" aria-hidden="true"><i></i><i></i><i></i></div>' : d.error ? failNote(d) : feedHtml(d, DAY === today())}</div>
      <p class="hint ag-endnote">${DAY === today() ? 'That\'s all of today so far.' : `That's all of ${esc(dayLabel(DAY))}.`} She keeps a week here; older days live in her memory.</p>`;
    $('[data-seg="agp-filter"]', sc)?.addEventListener('change', (e) => { FILTER = e.detail; $('.ag-feed', sc).innerHTML = feedHtml(dayData(DAY), DAY === today()); });
    $('[data-seg="agp-day"]', sc)?.addEventListener('change', (e) => { DAY = e.detail; loadDay(DAY, pg); pg._redraw?.(); });
  } });
  loadDay(DAY, pg);
  return pg;
}
function dayData(day) {
  if (day === today()) return { beats: AG.beats, items: [...AG.items, ...AG.asks.filter((a) => a.day === day && !AG.items.some((x) => x.id === a.id)), ...AG.alarms.filter((a) => a.day === day)] };
  if (DEMO_MODE) return { beats: [], items: [] };
  return DAYS.get(day) ?? { loading: true };
}
async function loadDay(day, pg) {
  if (day === today() || DEMO_MODE || DAYS.has(day)) return;
  DAYS.set(day, { loading: true });
  const r = await read(`/wyn/feed?day=${day}`);
  DAYS.set(day, r?.error ? r : { beats: r?.beats ?? [], items: r?.items ?? [] });
  if (r?.error) setTimeout(() => DAYS.delete(day), 30000);
  pg?._redraw?.();
}
function feedHtml(d, isToday) {
  const want = (k) => FILTER === 'all' || FILTER === k;
  const beats = d.beats ?? [], items = d.items ?? [];
  const byBeat = new Map();
  for (const x of items) if (x.beat) (byBeat.get(x.beat) ?? byBeat.set(x.beat, []).get(x.beat)).push(x);
  const nodes = [];
  if (isToday && want('ok') && AG.heartbeat?.on && AG.heartbeat?.next) nodes.push({ at: AG.heartbeat.next, next: true });
  for (const b of beats) {
    const mine = (byBeat.get(b.id) ?? []).filter((x) => itemWanted(x, want));
    // a beat shows with what it found; a beat that found nothing is a quiet dot (the Quiet filter, and All)
    if (mine.length) nodes.push({ at: b.at, beat: b, items: mine });
    else if (want('ok') && (b.kind === 'ok' || !(byBeat.get(b.id) ?? []).length)) nodes.push({ at: b.at, beat: { ...b, kind: 'ok' }, items: [] });
  }
  // what she did outside a beat: from your chat, on a call, a tap, a rule, the orb
  for (const x of items.filter((i) => !i.beat || !beats.some((b) => b.id === i.beat))) if (itemWanted(x, want)) nodes.push({ at: x.at, loose: x });
  nodes.sort((a, b) => (a.at < b.at ? 1 : -1));
  // quiet checks in a row fold into one line
  const out = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.beat?.kind === 'ok' && !n.items?.length && prev?.quiet) { prev.quiet.push(n.beat); continue; }
    out.push(n.beat?.kind === 'ok' && !n.items?.length ? { at: n.at, quiet: [n.beat] } : n);
  }
  if (!out.length) return `<p class="note">${FILTER === 'all' ? (isToday ? (AG.heartbeat?.on ? 'Her first check today lands here.' : 'Heartbeats are off on this PC. Check now on her tab runs one.') : 'Nothing that day.') : 'Nothing here for this filter.'}</p>`;
  return `<section class="surface ag-tline">${out.map(nodeHtml).join('')}</section>`;
}
const itemWanted = (x, want) => (x.kind === 'ask' ? want('ask') : x.kind === 'noticed' ? want('did') || FILTER === 'ok' : want('did'));
const SOURCE = { chat: ['From your thread', 'Something you told her'], call: ['On a call', 'What you said on the phone'], tap: ['You said yes', 'One tap in the app'],
  rule: ['A rule she keeps', 'Without being asked, as you agreed'], orb: ['From her orb', 'You breathed with her'], ladder: ['She climbed the ladder', 'You hadn\'t seen it'], tool: ['From an app', 'An app asked her'], agent: ['An agent asked', 'From a session on your PC'],
  scan: ['From Scan', 'Something you scanned'], share: ['Shared in', 'Something you shared to the app'] };
function nodeHtml(n) {
  if (n.next) return `<div class="ag-tn is-next"><time class="num">${esc(hmOf(n.at))}</time><i class="ag-node k-next" aria-hidden="true"></i>
    <div class="ag-tn-b"><b>Next check</b><span>She reads every app and says nothing unless something moved.</span></div></div>`;
  if (n.quiet) {
    const first = n.quiet[n.quiet.length - 1], last = n.quiet[0];
    const note = [...new Set(n.quiet.map((x) => x.note).filter(Boolean))][0] ?? 'All on track';
    return `<div class="ag-tn is-quiet"><time class="num">${esc(last.time ?? hmOf(last.at))}</time><i class="ag-node k-ok" aria-hidden="true"></i>
      <div class="ag-tn-b"><span>${n.quiet.length > 1 ? `${n.quiet.length} quiet checks from ${esc(first.time ?? hmOf(first.at))}` : 'A quiet check'} · ${esc(note)}</span></div></div>`;
  }
  if (n.loose) {
    const x = n.loose, [h, s] = SOURCE[x.source] ?? ['On her own', 'Between checks'];
    return `<div class="ag-tn"><time class="num">${esc(x.time ?? hmOf(x.at))}</time><i class="ag-node k-${x.kind === 'ask' ? 'ask' : 'did'}" aria-hidden="true"></i>
      <div class="ag-tn-b"><b>${esc(h)}</b><span>${esc(s)}</span>${itemHtml(x)}</div></div>`;
  }
  const b = n.beat;
  return `<div class="ag-tn"><time class="num">${esc(b.time ?? hmOf(b.at))}</time><i class="ag-node k-${esc(b.kind === 'noticed' ? 'did' : b.kind)}" aria-hidden="true"></i>
    <div class="ag-tn-b"><b>Checked ${b.checked} ${b.checked === 1 ? 'place' : 'places'}</b><span>${b.secs != null ? `${b.secs < 1 ? '<1' : Math.round(b.secs)} s · ` : ''}${esc(b.model ?? 'rules only')}${b.note ? ` · ${esc(b.note)}` : ''}</span>${(n.items ?? []).map(itemHtml).join('')}</div></div>`;
}
function stateOf(x) {
  if (x.kind === 'ask') return { open: 'Waiting on you', yes: 'You said yes', no: 'You said not now', failed: 'Didn\'t go through', expired: 'Expired' }[x.status] ?? x.status;
  if (x.kind === 'nudge') return x.ladder?.seen ? 'Told you · seen' : x.ladder?.rung > 1 ? `Told you · ${RUNGS[x.ladder.rung]?.label.toLowerCase()}` : 'Told you';
  if (x.kind === 'noticed') return 'Kept to herself';
  if (x.kind === 'alarm') return x.status === 'open' ? `Rings ${hmOf(x.ladder?.alarmAt ?? x.at)}` : 'Done';
  if (x.kind === 'call') return 'Rang you';
  if (x.status === 'failed') return 'Didn\'t work';
  return x.undone ? 'Undone' : aspName(home(x));
}
function itemHtml(x) {
  const off = x.undone;
  const open = x.kind === 'ask' && x.status === 'open';
  const act = open ? `<button class="btn sm" data-act="agp-ask" data-id="${esc(x.id)}">Answer</button>`
    : x.link ? `<button class="btn sm ag-ghost" data-act="ag-link" data-link="${esc(x.link)}">Open</button>`
    : x.kind === 'did' && x.undo && !off ? `<button class="btn sm ag-ghost" data-act="agp-undo" data-id="${esc(x.id)}">Undo</button>`
    : x.kind === 'alarm' && x.status === 'open' ? `<button class="btn sm ag-ghost" data-act="agp-alarm" data-id="${esc(x.id)}">See it</button>` : '';
  return `<div class="ag-ti${off ? ' undone' : ''}">${tileFor(home(x))}<div class="ag-ti-b"><p>${esc(x.title)}</p>${x.text && x.kind !== 'did' ? `<span class="agp-ti-x">${esc(x.text)}</span>` : ''}<small class="${open ? 'c-needs' : ''}">${esc(x.time ?? hmOf(x.at))} · ${esc(stateOf(x))}</small></div>${act}</div>`;
}
on('agp-ask', (el) => openAsk(el.dataset.id));
on('agp-undo', async (el) => { haptic(8); try { await undoItem(el.dataset.id); toast('Undone'); } catch (e) { toast(e?.message ?? 'Couldn\'t undo that'); } });
on('agp-alarm', (el) => api.alarm({ item: el.dataset.id }));
/** One ask, in a sheet: answered right there; the sheet closes once it's done. */
export function openAsk(id) {
  const a = [...AG.asks, ...AG.items].find((x) => x.id === id); if (!a) return null;
  if (a.ask?.question) return openReply(id);
  const sh = openSheet({ title: 'Waiting on you', body: `<div class="ag-asksheet">${askHtml(a)}</div>` });
  const off = onChange((what) => {
    if (!sh.isConnected) { off(); return; }
    if (what !== 'asks' && what !== 'home') return;
    const cur = AG.asks.find((x) => x.id === id);
    if (!cur || cur.status !== 'open') { off(); setTimeout(() => closeSheet(sh), 1200); }
  });
  return sh;
}

// ── reminders and alarms ─────────────────────────────────────────────
const LADDER_APPS = () => [...ASPECTS.map((a) => a.id), 'tasks', 'content', 'work'];
const ceilOf = (id) => AG.ladder?.ceilings?.[id] ?? 1;
export function openAlarms() {
  return page({ title: 'Reminders and alarms', live: ['home'], render(sc) {
    const L = AG.ladder ?? { ceilings: {}, step: 15, quiet: { sleep: true, class: true } };
    const open = AG.alarms.filter((x) => x.status === 'open');
    sc.innerHTML = `<header class="phead"><h1 class="lt">Reminders</h1><p class="sub">She starts quiet and climbs one rung at a time, every ${L.step} minutes you haven't seen it. You set the top rung for each app.</p></header>
      ${offNote()}
      <ol class="surface ag-steps" aria-label="The ladder">${RUNGS.slice(1).map((r) => `<li><button class="ag-step" data-act="agp-rung" data-id="${r.id}" aria-label="${r.label}: see it">
          <span class="ag-step-ic">${RUNG_ICON[r.id]}</span>
          <span class="ag-step-b"><b>${r.label}</b><span>${esc(r.line)}</span></span>
          <span class="ag-step-go" aria-hidden="true">${AI.play}</span></button></li>`).join('')}</ol>
      <p class="hint">Tap a rung to see it. She only climbs when the one below went unseen, and never while you sleep.</p>
      ${open.length ? `<div class="sh"><h2>Set to ring</h2><span class="sh-count">${open.length}</span></div>
        <div class="group">${open.map((x) => `<button class="row ic" data-act="agp-alarm" data-id="${esc(x.id)}">${tileFor(home(x))}
          <div class="rbody"><div class="rtitle wrap">${esc(x.title)}</div><div class="rmeta"><span class="num">${esc(x.ladder?.alarmAt ? `Alarm ${hmOf(x.ladder.alarmAt)}` : `From ${hmOf(x.ladder?.next ?? x.at)}`)}</span><span>·</span><span class="ell">Up to ${esc(RUNGS[x.ladder?.ceiling ?? 1]?.label.toLowerCase() ?? 'a notification')}</span></div></div>${I.chevR}</button>`).join('')}</div>` : ''}
      <div class="sh"><h2>How far she goes</h2></div>
      <div class="group ag-ceil">${LADDER_APPS().map((id) => { const n = ceilOf(id); return `<button class="row ic" data-act="agp-ceil" data-id="${id}">${tileFor(id)}
          <div class="rbody"><div class="rtitle">${esc(aspName(id))}</div></div>
          <span class="rend"><span class="ag-meter" aria-hidden="true">${[1, 2, 3, 4].map((k) => `<i class="${k <= n ? 'on' : ''}"></i>`).join('')}</span><span class="ag-ceil-l">${RUNGS[n]?.label ?? 'Notification'}</span>${I.chevR}</span></button>`; }).join('')}</div>
      <div class="group ag-mt"><button class="row ic" data-act="agp-step"><span class="tile">${I.clock}</span><div class="rbody"><div class="rtitle">Between rungs</div><div class="rmeta"><span class="ell">How long she waits before climbing</span></div></div><span class="rend">${L.step} min${I.chevR}</span></button></div>
      <div class="sh"><h2>Quiet hours</h2></div>
      <div class="group">
        ${sw('sleep', I.moon, 'While you sleep', 'Your usual night, from Today. Nothing climbs till you\'re up', L.quiet?.sleep !== false)}
        ${sw('class', I.book, 'Class and exams', 'Blocks on your calendar: only a notification, unless it\'s urgent', L.quiet?.class !== false)}
      </div>
      <div class="sh"><h2>When you push back</h2></div>
      <div class="group">
        <div class="row ic"><span class="tile">${AI.snooze}</span><div class="rbody"><div class="rtitle">Snooze</div><div class="rmeta"><span class="ell">Once is fine. The second time, she argues</span></div></div></div>
        <div class="row ic"><span class="tile">${I.eye}</span><div class="rbody"><div class="rtitle">Seen</div><div class="rmeta"><span class="ell">Opening it, or answering, stops the climb</span></div></div></div>
      </div>`;
  } });
}
const sw = (k, icon, title, sub, onv) => `<div class="row ic"><span class="tile">${icon}</span><div class="rbody"><div class="rtitle">${title}</div><div class="rmeta"><span class="ell">${sub}</span></div></div>
  <button class="switch${onv ? ' on' : ''}" data-act="agp-quiet" data-k="${k}" role="switch" aria-checked="${onv}" aria-label="${title}"></button></div>`;
async function putLadder(body, okLine) {
  try {
    const r = await act('/wyn/ladder', body, { method: 'PUT' });
    if (r && !r.queued && !r.demo && r.ceilings) AG.ladder = r;
    changed('home');
    if (okLine) toast(r?.queued ? `${okLine}. It syncs when the PC is back.` : okLine);
    if (!r?.queued) refresh({ quiet: true });
  } catch (e) { toast(e?.message ?? 'Couldn\'t change that'); refresh({ quiet: true }); }
}
on('agp-rung', (el) => api.openAgent('preview', el.dataset.id));
on('agp-quiet', (el) => {
  const k = el.dataset.k, onv = !el.classList.contains('on');
  el.classList.toggle('on', onv); el.setAttribute('aria-checked', String(onv)); haptic(6);
  AG.ladder = { ...(AG.ladder ?? {}), quiet: { ...(AG.ladder?.quiet ?? {}), [k]: onv } };
  putLadder({ quiet: { [k]: onv } }, k === 'sleep' ? (onv ? 'Quiet while you sleep' : 'She may climb at night') : (onv ? 'Quiet in class' : 'She may climb in class'));
});
on('agp-ceil', (el) => {
  const id = el.dataset.id, cur = ceilOf(id);
  const sh = openSheet({ title: esc(aspName(id)), sub: 'How high can she climb here?', cls: 'ag-pick', body: `<div class="group ag-rungpick">${RUNGS.map((r) => `<button class="row ic" data-act="agp-ceil-set" data-id="${id}" data-n="${r.n}" aria-pressed="${r.n === cur}">
      <span class="tile">${RUNG_ICON[r.id]}</span><div class="rbody"><div class="rtitle">${r.n === 0 ? 'Off' : `Up to ${r.n === 1 ? 'a notification' : `${r.n === 3 ? 'an' : 'a'} ${r.label.toLowerCase()}`}`}</div><div class="rmeta"><span class="ell">${esc(r.line)}</span></div></div>
      ${r.n === cur ? `<span class="ag-tick">${I.check}</span>` : ''}</button>`).join('')}</div>` });
  return sh;
});
on('agp-ceil-set', (el) => {
  const id = el.dataset.id, n = Number(el.dataset.n);
  haptic(8); closeSheet(el.closest('.sheet'));
  AG.ladder = { ...(AG.ladder ?? {}), ceilings: { ...(AG.ladder?.ceilings ?? {}), [id]: n } };
  putLadder({ app: id, ceiling: n }, `${aspName(id)}: ${n === 0 ? 'she stays silent' : `up to ${RUNGS[n].label.toLowerCase()}`}`);
});
on('agp-step', () => {
  const cur = AG.ladder?.step ?? 15;
  openSheet({ title: 'Between rungs', sub: 'How long an unseen reminder waits before she climbs.', cls: 'ag-pick', body: `<div class="group">${[10, 15, 20, 30, 60].map((m) => `<button class="row" data-act="agp-step-set" data-m="${m}" aria-pressed="${m === cur}">
      <div class="rbody"><div class="rtitle">${m} minutes</div></div>${m === cur ? `<span class="ag-tick">${I.check}</span>` : ''}</button>`).join('')}</div>` });
});
on('agp-step-set', (el) => { const m = Number(el.dataset.m); haptic(8); closeSheet(el.closest('.sheet')); AG.ladder = { ...(AG.ladder ?? {}), step: m }; putLadder({ step: m }, `She waits ${m} minutes between rungs`); });

// ── what she can do ──────────────────────────────────────────────────
let TOOLS = null;          // the PC's GET /wyn/tools, or the demo catalog
const MODE = { auto: 'On her own', ask: 'Asks first', off: 'Off' };
const LEVEL = Object.fromEntries(AUTONOMY.map(([id, label, line]) => [id, { label, line }]));
function demoTools() {
  const t = (name, description, auto, x = {}) => ({ name, tool: name.replace(/^[a-z]+_/, ''), title: toolTitle(name), description, auto, hard: false, risks: [], mode: auto ? 'auto' : 'ask', own: null, lastUsed: null, summary: false, ...x });
  const apps = [
    { id: 'body', tools: [t('body_log_meal', 'Logs a meal from a photo, a scan or a sentence', true), t('body_plan_workout', 'Plans today\'s session from recovery', true), t('body_set_targets', 'Changes your calorie and protein targets', false)] },
    { id: 'money', tools: [t('money_log_expense', 'Adds an expense from a UPI message, a receipt or a statement', true), t('money_import_statement', 'Reads a bank statement into rows', true), t('money_set_budget', 'Changes a category\'s monthly budget', false)] },
    { id: 'growth', tools: [t('growth_journal_write', 'Files lines you say into today\'s journal', true), t('growth_review_draft', 'Drafts Sunday\'s review', true)] },
    { id: 'friends', tools: [t('people_log_moment', 'Files a moment with someone', true), t('people_draft_message', 'Drafts a message for you to send', true), t('people_send_message', 'Sends a message for you', false, { hard: true, risks: ['reaches_others'], mode: 'ask' })] },
    { id: 'soul', tools: [t('soul_check_habit', 'Ticks a habit from what you tell her', true), t('soul_propose_lock', 'Locks an app for a window you agree to', false)] },
  ].map((a) => ({ ...a, module: a.id, autonomy: 'normal' }));
  const core = [['add_task', 'tasks', 'auto'], ['update_task', 'tasks', 'auto'], ['drop_task', 'tasks', 'ask'], ['calendar_add', 'calendar', 'auto'], ['remember', 'memory', 'auto'], ['journal', 'growth', 'auto'], ['give_to_claude', 'work', 'ask'], ['overview', 'tasks', 'auto', true]]
    .map(([name, app, mode, rd]) => ({ name, tool: name, title: toolTitle(name), description: '', app, read: !!rd, mode, hard: mode === 'ask' }));
  const all = [...apps.flatMap((a) => a.tools), ...core.filter((c) => !c.read)];
  return { apps, core, autonomy: { apps: {}, tools: {} }, counts: { total: all.length, auto: all.filter((x) => x.mode === 'auto').length, ask: all.filter((x) => x.mode === 'ask').length, apps: apps.length } };
}
async function loadTools(pg) {
  if (DEMO_MODE) { TOOLS = TOOLS ?? demoTools(); pg?._redraw?.(); return; }
  const r = await read('/wyn/tools');
  if (r && !r.error) { TOOLS = r; AG.tools = r.counts ?? AG.tools; }
  else if (!TOOLS) TOOLS = { error: r?.error ?? 'offline', offline: r?.offline };
  pg?._redraw?.();
}
export function openTools() {
  const pg = page({ title: 'What she can do', render(sc) {
    const T = TOOLS;
    if (!T) { sc.innerHTML = `<header class="phead"><h1 class="lt">What she can do</h1></header><div class="ag-skel" aria-hidden="true"><i></i><i></i><i></i></div>`; return; }
    if (T.error) { sc.innerHTML = `<header class="phead"><h1 class="lt">What she can do</h1></header>${failNote(T)}`; return; }
    const c = T.counts ?? { total: 0, auto: 0, ask: 0 };
    const coreByApp = new Map();
    for (const t of T.core ?? []) (coreByApp.get(t.app) ?? coreByApp.set(t.app, []).get(t.app)).push(t);
    sc.innerHTML = `<header class="phead"><h1 class="lt">What she can do</h1><p class="sub">${c.total} tools across your apps: ${c.auto} on her own, ${c.ask} ask first. She uses them when you tell her something and on her checks.</p></header>
      ${offNote()}
      <div class="sh"><h2>Always asks you first</h2></div>
      <div class="group ag-always">${ALWAYS_ASKS.map(([ic, t]) => `<div class="row ic"><span class="tile">${I[ic] ?? I.lock}</span><div class="rbody"><div class="rtitle">${esc(t)}</div></div><span class="rend ag-lock" aria-label="Can't be changed">${I.lock}</span></div>`).join('')}</div>
      <p class="hint">These never run on her own, whatever a tool below is set to. The check sits outside the model.</p>
      ${(T.apps ?? []).length ? '' : `<p class="note">Your apps haven't given her tools yet. The built-in ones are below.</p>`}
      ${(T.apps ?? []).map((a) => appSection(a)).join('')}
      <div class="sh agp-sh"><h2>Built in</h2><span class="sh-count">${(T.core ?? []).filter((t) => !t.read).length}</span></div>
      <p class="hint agp-hint">Tasks, the calendar, her memory, your journal and the work on your PC. They follow each app's setting above when there is one.</p>
      ${[...coreByApp.entries()].map(([app, list]) => coreSection(app, list)).join('')}`;
  } });
  loadTools(pg);
  return pg;
}
const toolsOf = (a) => (a.tools ?? []).filter((t) => !t.summary);
function appSection(a) {
  const lv = LEVEL[a.autonomy] ?? LEVEL.normal, reads = (a.tools ?? []).filter((t) => t.summary);
  return `<div class="sh ag-tsh">${tileFor(a.id)}<h2>${esc(aspName(a.id))}</h2><button class="chip sm agp-lvl lv-${esc(a.autonomy)}" data-act="agp-level" data-app="${esc(a.id)}">${esc(lv.label)}${I.chevD}</button></div>
    <div class="group">${toolsOf(a).map((x) => toolRow(x, a.id)).join('') || `<div class="row"><div class="rbody"><div class="rmeta">No actions here yet.</div></div></div>`}</div>
    ${reads.length ? `<p class="hint agp-hint">${AI.heartbeat}<span>She also reads ${esc(aspName(a.id))}'s summary on every check.</span></p>` : ''}`;
}
function coreSection(app, list) {
  const writes = list.filter((t) => !t.read), reads = list.filter((t) => t.read);
  if (!writes.length && !reads.length) return '';
  return `<div class="sh ag-tsh">${tileFor(app)}<h2>${esc(aspName(app))}</h2><span class="sh-count">${writes.length}</span></div>
    ${writes.length ? `<div class="group">${writes.map((x) => toolRow(x, app, true)).join('')}</div>` : ''}
    ${reads.length ? `<p class="hint agp-hint">She can also read: ${esc(reads.map((t) => toolTitle(t.name, t.title).toLowerCase()).join(', '))}.</p>` : ''}`;
}
function toolRow(x, app, core = false) {
  const m = x.mode ?? (x.auto ? 'auto' : 'ask');
  const label = x.hard ? 'Always asks' : MODE[m];
  return `<button class="row ag-trow" data-act="agp-tool" data-n="${esc(x.name)}" data-app="${esc(app)}"${core ? ' data-core="1"' : ''}>
      <div class="rbody"><div class="rtitle">${esc(toolTitle(x.name, x.title))}</div>${x.description ? `<div class="ag-tdoes">${esc(firstLine(x.description))}</div>` : ''}<div class="rmeta"><span class="ell">${x.lastUsed ? `Last used ${esc(dayWord(x.lastUsed))}` : core ? 'Built in' : 'Not used yet'}</span></div></div>
      <span class="rend"><span class="ag-mode m-${x.hard ? 'ask' : m}">${label}</span>${I.chevR}</span></button>`;
}
const firstLine = (s) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); const m = t.match(/^(.{20,140}?[.!?])(\s|$)/); return m ? m[1] : t.slice(0, 140); };
const findTool = (name) => { for (const a of TOOLS?.apps ?? []) { const t = (a.tools ?? []).find((x) => x.name === name); if (t) return t; } return (TOOLS?.core ?? []).find((x) => x.name === name) ?? null; };
const RISK = { spends_money: 'it spends money', reaches_others: 'it reaches other people', deletes_data: 'it deletes something', irreversible: 'it can\'t be undone', pushes_main: 'it pushes to main', cancels_his_event: 'it cancels your own events' };
on('agp-tool', (el) => {
  const x = findTool(el.dataset.n); if (!x) return;
  const cur = TOOLS?.autonomy?.tools?.[x.name] ?? null, mode = x.mode ?? (x.auto ? 'auto' : 'ask');
  const opt = (m, label, line) => `<button class="row" data-act="agp-tool-set" data-n="${esc(x.name)}" data-m="${m}" aria-pressed="${(cur ?? 'default') === m}" ${x.hard && m === 'auto' ? 'disabled' : ''}>
      <div class="rbody"><div class="rtitle">${label}</div><div class="rmeta"><span class="ell">${line}</span></div></div>${(cur ?? 'default') === m ? `<span class="ag-tick">${I.check}</span>` : ''}</button>`;
  const why = x.hard ? (x.risks?.length ? `It always asks because ${x.risks.map((r) => RISK[r] ?? r).join(' and ')}.` : 'It always asks: it touches something that\'s hard to take back.') : '';
  openSheet({ title: esc(toolTitle(x.name, x.title)), sub: esc(firstLine(x.description) || ''), cls: 'ag-pick', body: `<div class="group">
      ${opt('default', 'Her judgment', `The app's own setting: ${MODE[x.auto || mode === 'auto' ? 'auto' : 'ask'].toLowerCase()}`)}
      ${opt('auto', 'On her own', 'She does it and it lands in her day with Undo')}
      ${opt('ask', 'Asks first', 'She brings it to you as one tap')}
      ${opt('off', 'Off', 'She never uses it')}</div>
    <p class="hint">${x.lastUsed ? `Last used ${esc(dayWord(x.lastUsed))}.` : 'She hasn\'t used it yet.'} ${esc(why)}</p>` });
});
on('agp-tool-set', async (el) => {
  const name = el.dataset.n, m = el.dataset.m;
  haptic(8); closeSheet(el.closest('.sheet'));
  if (DEMO_MODE) { const t = findTool(name); if (t) t.mode = m === 'default' ? (t.auto ? 'auto' : 'ask') : m; openToolsRedraw(); toast(`${toolTitle(name)}: ${m === 'default' ? 'her judgment' : MODE[m].toLowerCase()}`); return; }
  try {
    const r = await act('/wyn/autonomy', { tool: name, mode: m }, { method: 'PUT' });
    if (r && r.apps) { TOOLS = r; AG.tools = r.counts ?? AG.tools; }
    openToolsRedraw();
    toast(r?.queued ? 'Saved. It syncs when the PC is back.' : `${toolTitle(name)}: ${m === 'default' ? 'her judgment' : MODE[m].toLowerCase()}`);
  } catch (e) { toast(e?.message ?? 'Couldn\'t change that'); }
});
on('agp-level', (el) => {
  const app = el.dataset.app, cur = (TOOLS?.apps ?? []).find((a) => a.id === app)?.autonomy ?? 'normal';
  openSheet({ title: esc(aspName(app)), sub: 'How much she does here on her own.', cls: 'ag-pick', body: `<div class="group">${AUTONOMY.map(([id, label, line]) => `<button class="row" data-act="agp-level-set" data-app="${esc(app)}" data-l="${id}" aria-pressed="${id === cur}">
      <div class="rbody"><div class="rtitle">${esc(label)}</div><div class="rmeta"><span class="ell">${esc(line)}</span></div></div>${id === cur ? `<span class="ag-tick">${I.check}</span>` : ''}</button>`).join('')}</div>
    <p class="hint">Whatever you pick, spending money, reaching someone new, deleting and anything that can't be undone still ask.</p>` });
});
on('agp-level-set', async (el) => {
  const app = el.dataset.app, level = el.dataset.l;
  haptic(8); closeSheet(el.closest('.sheet'));
  const a = (TOOLS?.apps ?? []).find((x) => x.id === app);
  if (a) a.autonomy = level;
  openToolsRedraw();
  if (DEMO_MODE) { toast(`${aspName(app)}: ${LEVEL[level].label.toLowerCase()}`); return; }
  try {
    const r = await act('/wyn/autonomy', { app, level }, { method: 'PUT' });
    if (r && r.apps) { TOOLS = r; AG.tools = r.counts ?? AG.tools; }
    openToolsRedraw();
    toast(r?.queued ? 'Saved. It syncs when the PC is back.' : `${aspName(app)}: ${LEVEL[level].label.toLowerCase()}`);
  } catch (e) { toast(e?.message ?? 'Couldn\'t change that'); loadTools(); }
});
const openToolsRedraw = () => $$('#stack > .page.ag-pg').forEach((p) => { if (p._opts?.title === 'What she can do') p._redraw?.(); });

// ── her ──────────────────────────────────────────────────────────────
let P = null;            // the sliders, from her tone
let WYN_PREFS = null;   // GET /wyn's prefs: chat model and effort, channel, WhatsApp
let MODELS = null, SOUL = null;
/** Read the sliders back from her tone when it's one of ours; else the middle. */
function talkFrom(tone) {
  const t = String(tone ?? '');
  const at = (list) => { const i = list.findIndex((x) => t.includes(x)); return i < 0 ? 0.5 : [0.15, 0.5, 0.85][i]; };
  return { length: at(TALK.length), humour: at(TALK.humour), push: at(TALK.push), hinglish: !/English only/.test(t) };
}
async function loadHer(pg) {
  if (DEMO_MODE) { WYN_PREFS = WYN_PREFS ?? { chat_model: 'gpt-6.1-sol', chat_effort: 'high', message_channel: 'both', whatsapp: false }; SOUL = SOUL ?? { text: 'Warm, short, a little dry. Talks like a friend who has read your calendar. Says the true thing once, then lets you decide.', default: '' }; pg?._redraw?.(); return; }
  const [st, models, soul] = await Promise.all([read('/wyn?after=999999999'), MODELS ? Promise.resolve(MODELS) : read('/wyn/models'), read('/wyn/soul')]);
  if (st && !st.error) WYN_PREFS = st.prefs ?? WYN_PREFS;
  if (models && !models.error) MODELS = models;
  if (soul && !soul.error) SOUL = soul;
  pg?._redraw?.();
}
const modelName = (id) => (MODELS?.chat ?? []).find((m) => m.id === id)?.name ?? id ?? 'her default';
export function openHer(focus) {
  P = talkFrom(AG.prefs?.tone);
  const pg = page({ title: agName(), live: ['prefs', 'home'], render(sc) {
    const prefs = AG.prefs ?? {}, voice = prefs.voice ?? 'marin', realtime = !!AG.calls?.voice?.realtime;
    const level = prefs.proactive_level ?? 'normal', channel = WYN_PREFS?.message_channel ?? 'both';
    const soulText = String(SOUL?.text ?? '').replace(/^#.*$/gm, '').replace(/\{\{name\}\}/g, agName()).replace(/\s+/g, ' ').trim();
    const memN = (AG.memory?.long ?? 0) + (AG.memory?.short ?? 0);
    sc.innerHTML = `<header class="ag-herhead">
        <span class="orb md" aria-hidden="true"></span>
        <div><h1 class="title1">${esc(agName())}</h1><p class="sub">Your name for her. Everyone's agent is ${/^[aeiou]/i.test(PRODUCT) ? 'an' : 'a'} ${esc(PRODUCT)}; this one is yours.</p></div>
        <button class="btn sm" data-act="agp-rename">Rename</button>
      </header>
      ${offNote()}
      <div class="sh"><h2>How she talks</h2></div>
      <section class="surface ag-talk">
        ${slider('length', 'Length', 'Short', 'Detailed', P.length)}
        ${slider('humour', 'Humour', 'Plain', 'Playful', P.humour)}
        ${slider('push', 'How hard she pushes', 'Gentle', 'Relentless', P.push)}
        <div class="ag-sample"><span class="orb xs" aria-hidden="true"></span><p aria-live="polite">${esc(sample(P))}</p></div>
        <button class="btn block agp-tone-save" data-act="agp-tone-save" ${toneOf(P) === prefs.tone ? 'disabled' : ''}>${toneOf(P) === prefs.tone ? 'This is how she talks' : 'Talk like this'}</button>
      </section>
      <div class="group ag-mt">
        <div class="row"><div class="rbody"><div class="rtitle">Hinglish when you use it</div><div class="rmeta"><span class="ell">She answers in the language you wrote in</span></div></div>
          <button class="switch${P.hinglish ? ' on' : ''}" data-act="agp-hinglish" role="switch" aria-checked="${P.hinglish}" aria-label="Hinglish when you use it"></button></div>
      </div>
      ${prefs.tone ? `<p class="hint agp-hint">What she reads before every reply: “${esc(prefs.tone)}”</p>` : ''}
      <div class="sh"><h2>Her soul</h2><button class="sh-act" data-act="agp-soul">Edit</button></div>
      <section class="surface ag-soulc"><p>${esc(soulText ? `${soulText.slice(0, 260)}${soulText.length > 260 ? '…' : ''}` : 'Loading her soul…')}</p><small class="mono">SOUL.md · she reads it before every reply; you can also just tell her</small></section>
      <div class="sh"><h2>Her voice on calls</h2></div>
      <p class="hint agp-hint">${realtime ? 'Calls use the realtime voice you pick here.' : 'Calls are free: your phone hears you and speaks for her with its own voice, and her brain runs on your PC. These voices are for the realtime path, when a funded OpenAI key is set.'}</p>
      <div class="group">${VOICES.map((v) => `<div class="row ic ag-voice${voice === v.id ? ' on' : ''}">
          <button class="ag-play" data-act="agp-play" data-id="${v.id}" aria-label="Hear a line">${AI.play}</button>
          <button class="ag-vpick" data-act="agp-voice-set" data-id="${v.id}" aria-pressed="${voice === v.id}"><span class="rbody"><span class="rtitle">${esc(v.name)}</span><span class="rmeta">${esc(v.line)}</span></span>${voice === v.id ? `<span class="ag-tick">${I.check}</span>` : ''}</button></div>`).join('')}</div>
      <div class="sh"><h2>What she remembers</h2></div>
      <div class="group">
        <button class="row ic" data-act="ag-memory"><span class="tile">${I.brain}</span><div class="rbody"><div class="rtitle">Everything she knows</div><div class="rmeta"><span class="ell">${AG.memory?.learned?.length ? `${AG.memory.learned.length} new today` : 'Facts, people, habits and what\'s going on now'}</span></div></div><span class="rend">${memN || ''}${I.chevR}</span></button>
        <button class="row ic" data-act="agp-brain"><span class="tile">${I.folder}</span><div class="rbody"><div class="rtitle">Open the Brain</div><div class="rmeta"><span class="ell">Your notes, people and decisions, which she reads too</span></div></div>${I.chevR}</button>
      </div>
      <div class="sh" id="ag-cost"><h2>Models and cost</h2></div>
      <div class="group">
        <button class="row ic" data-act="agp-model"><span class="tile">${I.sparkle}</span><div class="rbody"><div class="rtitle">Her brain</div><div class="rmeta"><span class="ell">Codex on your ChatGPT login: chat, calls and planning</span></div></div><span class="rend">${esc(modelName(WYN_PREFS?.chat_model))}${WYN_PREFS?.chat_effort ? ` · ${esc(WYN_PREFS.chat_effort)}` : ''}${I.chevR}</span></button>
        <div class="row ic"><span class="tile">${AI.heartbeat}</span><div class="rbody"><div class="rtitle">Heartbeats</div><div class="rmeta"><span class="ell">Rules every ${EVERY} minutes; Claude Haiku on your subscription only when something moved</span></div></div></div>
        <div class="row ic"><span class="tile">${I.phone}</span><div class="rbody"><div class="rtitle">Calls</div><div class="rmeta"><span class="ell">${realtime ? 'OpenAI realtime, billed per minute' : 'Free: on-device speech, her brain on your subscription'}</span></div></div></div>
      </div>
      <p class="hint">No API bill: everything runs on the subscriptions you already pay for${realtime ? ', except realtime calls' : ''}.</p>
      <div class="sh"><h2>Reaching out</h2></div>
      <div class="pad agp-seg">${seg('agp-level', [['off', 'Off'], ['light', 'Light'], ['normal', 'Normal'], ['eager', 'Eager']], level)}</div>
      <p class="hint agp-hint">${esc({ off: 'She only answers when you write.', light: 'Up to 2 messages a day, only when it clearly matters.', normal: 'Up to 4 a day, two hours apart unless it\'s urgent.', eager: 'Up to 6 a day, and she looks further ahead.' }[level] ?? '')}</p>
      <div class="sh"><h2>Where her messages go</h2></div>
      <div class="pad agp-seg">${seg('agp-channel', [['app', 'This app'], ['whatsapp', 'WhatsApp'], ['both', 'Both']], channel)}</div>
      ${WYN_PREFS && !WYN_PREFS.whatsapp ? `<p class="hint agp-hint">WhatsApp isn't connected on this PC, so for now everything comes here.</p>` : ''}
      <div class="pad ag-meetbar"><button class="btn block" data-act="agp-meet">${I.sparkle}<span>Meet her again</span></button></div>`;
    $$('.ag-range input', sc).forEach((r) => r.addEventListener('input', () => {
      P[r.dataset.k] = Number(r.value) / 100;
      r.closest('.ag-range').style.setProperty('--v', r.value);
      $('.ag-sample p', sc).textContent = sample(P);
      const b = $('.agp-tone-save', sc); if (b) { const same = toneOf(P) === AG.prefs?.tone; b.disabled = same; b.textContent = same ? 'This is how she talks' : 'Talk like this'; }
    }));
    $('[data-seg="agp-level"]', sc)?.addEventListener('change', (e) => setPref({ proactive_level: e.detail }, `Reaching out: ${e.detail}`));
    $('[data-seg="agp-channel"]', sc)?.addEventListener('change', (e) => setPref({ message_channel: e.detail }, `Her messages go to ${{ app: 'this app', whatsapp: 'WhatsApp', both: 'the app and WhatsApp' }[e.detail]}`, () => { if (WYN_PREFS) WYN_PREFS.message_channel = e.detail; }));
  } });
  loadHer(pg);
  if (focus === 'cost') requestAnimationFrame(() => requestAnimationFrame(() => { const sc = $('.scroll', pg), el = $('#ag-cost', pg); if (sc && el) sc.scrollTo({ top: el.offsetTop - 100, behavior: reduce() ? 'auto' : 'smooth' }); }));
  return pg;
}
const slider = (k, label, lo, hi, v) => `<label class="ag-range" style="--v:${Math.round(v * 100)}"><span class="ag-range-h"><b>${label}</b></span>
  <input type="range" min="0" max="100" value="${Math.round(v * 100)}" data-k="${k}" aria-label="${label}">
  <span class="ag-range-e"><small>${lo}</small><small>${hi}</small></span></label>`;
async function setPref(patch, line, after) {
  try { const r = await savePrefs(patch); after?.(); toast(r?.queued ? `${line}. It syncs when the PC is back.` : line); }
  catch (e) { toast(e?.message ?? 'Couldn\'t save that'); refresh({ quiet: true }); }
}
on('agp-tone-save', () => { haptic(10); setPref({ tone: toneOf(P) }, 'Saved. She\'ll sound like that from her next reply'); });
on('agp-hinglish', (el) => { P.hinglish = !P.hinglish; el.classList.toggle('on', P.hinglish); el.setAttribute('aria-checked', String(P.hinglish)); haptic(6); setPref({ tone: toneOf(P) }, P.hinglish ? 'Hinglish when you use it' : 'English only'); });
on('agp-voice-set', (el) => { haptic(8); setPref({ voice: el.dataset.id }, `${VOICES.find((v) => v.id === el.dataset.id)?.name ?? 'Voice'} for realtime calls`); });
on('agp-play', async (el) => {
  haptic(6);
  $$('.ag-play.playing').forEach((x) => { x.classList.remove('playing'); x.innerHTML = AI.play; });
  el.classList.add('playing'); el.innerHTML = '<span class="ag-eq" aria-hidden="true"><i></i><i></i><i></i></span>';
  try {
    const { native } = await import('./svc/native-plugins.js');
    const r = await native.voice.speak({ text: `Hi, it's ${agName()}. This is how I sound on a free call.` });
    if (!r?.ok) toast('This phone can\'t speak a sample here');
  } catch { toast('This phone can\'t speak a sample here'); }
  setTimeout(() => { el.classList.remove('playing'); el.innerHTML = AI.play; }, 2600);
});
on('agp-brain', () => api.openBrain());
on('agp-rename', () => meet({ only: 'name' }));
on('agp-meet', () => meet());
on('agp-model', () => {
  const cur = WYN_PREFS?.chat_model, eff = WYN_PREFS?.chat_effort;
  const list = MODELS?.chat ?? [{ id: cur ?? 'gpt-6.1-sol', name: modelName(cur), efforts: ['low', 'medium', 'high'] }];
  const efforts = list.find((m) => m.id === cur)?.efforts ?? MODELS?.efforts ?? ['low', 'medium', 'high'];
  openSheet({ title: 'Her brain', sub: 'The Codex model she thinks with, on your ChatGPT login. Calls use a lighter effort so she answers fast.', cls: 'ag-pick', body: `<div class="group">${list.map((m) => `<button class="row" data-act="agp-model-set" data-k="chat_model" data-v="${esc(m.id)}" aria-pressed="${m.id === cur}">
      <div class="rbody"><div class="rtitle">${esc(m.name)}</div></div>${m.id === cur ? `<span class="ag-tick">${I.check}</span>` : ''}</button>`).join('')}</div>
    <div class="sh"><h2>How hard she thinks in chat</h2></div>
    <div class="group">${efforts.map((e) => `<button class="row" data-act="agp-model-set" data-k="chat_effort" data-v="${esc(e)}" aria-pressed="${e === eff}"><div class="rbody"><div class="rtitle">${esc(e[0].toUpperCase() + e.slice(1))}</div></div>${e === eff ? `<span class="ag-tick">${I.check}</span>` : ''}</button>`).join('')}</div>` });
});
on('agp-model-set', (el) => {
  const k = el.dataset.k, v = el.dataset.v;
  haptic(8); closeSheet(el.closest('.sheet'));
  setPref({ [k]: v }, k === 'chat_model' ? `She thinks with ${modelName(v)} now` : `Thinking effort: ${v}`, () => { WYN_PREFS = { ...(WYN_PREFS ?? {}), [k]: v }; $$('#stack > .page.ag-pg').forEach((p) => p._redraw?.()); });
});
on('agp-soul', async () => {
  if (!SOUL && !DEMO_MODE) await loadHer();
  const sh = openSheet({ title: 'Her soul', sub: 'SOUL.md: who she is and how she talks. She reads it before every reply; you can also just tell her.', large: true,
    body: `<div class="pad"><textarea class="ag-soul-ta agp-soul-ta" rows="14" aria-label="Her soul">${esc(SOUL?.text ?? '')}</textarea>
      <button class="btn primary block" data-act="agp-soul-save">Save</button>
      ${SOUL?.default ? '<button class="btn block agp-mt" data-act="agp-soul-reset">Back to the original</button>' : ''}</div>` });
  setTimeout(() => $('textarea', sh)?.focus({ preventScroll: true }), 400);
});
async function saveSoul(body, el) {
  const sh = el.closest('.sheet');
  if (DEMO_MODE) { SOUL = { ...(SOUL ?? {}), text: body.text ?? SOUL?.text }; closeSheet(sh); toast('Saved. She\'ll sound like that from her next reply'); $$('#stack > .page.ag-pg').forEach((p) => p._redraw?.()); return; }
  el.disabled = true;
  try {
    const r = await act('/wyn/soul', body, { method: 'PUT' });
    if (r?.text) SOUL = { ...(SOUL ?? {}), text: r.text };
    closeSheet(sh);
    toast(r?.queued ? 'Saved here; it reaches her when the PC is back' : 'Saved. She\'ll sound like that from her next reply');
    $$('#stack > .page.ag-pg').forEach((p) => p._redraw?.());
  } catch (e) { el.disabled = false; toast(e?.message ?? 'Couldn\'t save her soul'); }
}
on('agp-soul-save', (el) => { const t = $('textarea', el.closest('.sheet'))?.value ?? ''; if (t.trim().length < 100) { toast('Her soul needs more than that'); return; } saveSoul({ text: t }, el); });
on('agp-soul-reset', (el) => saveSoul({ reset: true }, el));

// ── meeting her: where a new user names theirs ───────────────────────
const NAMES = ['Wyn', 'Mira', 'Tara', 'Zoya', 'Ira'];
const PUSH = [['gentle', 'Gentle', 'A notification, then she lets it go', 0.15, 'light'], ['firm', 'Firm', 'Up to an alarm, and one argument', 0.5, 'normal'], ['relentless', 'Relentless', 'She will call you', 0.85, 'eager']];
export function meet({ only = null } = {}) {
  const name = agName(), voice = AG.prefs?.voice ?? 'marin', level = AG.prefs?.proactive_level ?? 'normal';
  const sh = openSheet({ title: only ? 'Rename her' : `Meet your ${esc(PRODUCT)}`, sub: only ? 'She answers to whatever you call her.' : 'Three choices. You can change every one of them later.', cls: 'ag-meet',
    body: `<div class="pad">
      <p class="ag-q">What will you call her?</p>
      <div class="field"><input class="ag-name-in" type="text" value="${esc(name)}" maxlength="16" aria-label="Her name" enterkeyhint="done" /></div>
      <div class="chips ag-namechips">${NAMES.map((n) => `<button class="chip sm${n === name ? ' on' : ''}" data-act="agp-name-pick" data-n="${n}">${n}</button>`).join('')}</div>
      ${only ? '' : `<p class="ag-q">Her voice on realtime calls</p>${seg('agp-meet-voice', VOICES.slice(0, 4).map((v) => [v.id, v.name]), voice)}
      <p class="ag-q">How hard should she push?</p>
      <div class="ag-push">${PUSH.map(([id, t, line, , lv]) => `<button class="ag-pushc${lv === level ? ' on' : ''}" data-act="agp-push" data-l="${lv}" aria-pressed="${lv === level}"><b>${t}</b><small>${line}</small></button>`).join('')}</div>`}
      <button class="btn primary block ag-wake" data-act="agp-meet-done">${only ? 'Save' : 'Wake her up'}</button>
    </div>` });
  sh._meet = { voice, level };
  wireSegs(sh);
  $('[data-seg="agp-meet-voice"]', sh)?.addEventListener('change', (e) => { sh._meet.voice = e.detail; });
  return sh;
}
on('agp-name-pick', (el) => { const sh = el.closest('.sheet'); $('.ag-name-in', sh).value = el.dataset.n; $$('.ag-namechips .chip', sh).forEach((c) => c.classList.toggle('on', c === el)); haptic(5); });
on('agp-push', (el) => { const sh = el.closest('.sheet'); $$('.ag-pushc', sh).forEach((c) => { c.classList.toggle('on', c === el); c.setAttribute('aria-pressed', String(c === el)); }); sh._meet.level = el.dataset.l; haptic(5); });
on('agp-meet-done', async (el) => {
  const sh = el.closest('.sheet'), raw = $('.ag-name-in', sh).value.trim().replace(/\s+/g, ' ').slice(0, 16);
  const patch = {};
  if (raw) patch.name = raw[0].toUpperCase() + raw.slice(1);
  if ($('[data-seg="agp-meet-voice"]', sh)) { patch.voice = sh._meet.voice; patch.proactive_level = sh._meet.level; }
  closeSheet(sh); haptic(12);
  // her name is on the tab, the top bar, the composer and the call screen
  if (patch.name) { const tab = $('#tabAgent span'); if (tab) tab.textContent = patch.name; }
  try {
    const r = await savePrefs(patch);
    toast(r?.queued ? `${patch.name ?? agName()} is saved here; the PC hears it when it's back.` : `${patch.name ?? agName()} is awake${AG.heartbeat?.next ? `. Her next check is at ${hmOf(AG.heartbeat.next)}` : ''}.`);
  } catch (e) { toast(e?.message ?? 'Couldn\'t save that'); }
});

// ── what she remembers ───────────────────────────────────────────────
let MEM = null;
const KIND = { fact: 'Facts', preference: 'Preferences', person: 'People', project: 'Projects', goal: 'Goals', habit: 'Habits', decision: 'Decisions', health: 'Health', lesson: 'What she learned about working with you', other: 'Other' };
function demoMemory() {
  const m = AG.memory ?? {};
  return { long: (m.learned ?? []).map((x) => ({ ...x, at: AG.home?.now ?? new Date().toISOString() })), short: m.now ?? [], days: [] };
}
export function openMemory() {
  const pg = page({ title: 'What she remembers', render(sc) {
    const M = MEM;
    if (!M) { sc.innerHTML = `<header class="phead"><h1 class="lt">Memory</h1></header><div class="ag-skel" aria-hidden="true"><i></i><i></i><i></i></div>`; return; }
    if (M.error) { sc.innerHTML = `<header class="phead"><h1 class="lt">Memory</h1></header>${failNote(M)}`; return; }
    const imp = (n) => `<span class="imp" aria-label="${n} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
    const d0 = today();
    const learned = (M.long ?? []).filter((x) => istDay(Date.parse(x.at ?? '')) === d0);
    const byKind = new Map();
    for (const x of M.long ?? []) (byKind.get(x.kind ?? 'other') ?? byKind.set(x.kind ?? 'other', []).get(x.kind ?? 'other')).push(x);
    const until = (iso) => { const t = Date.parse(iso ?? ''); if (!Number.isFinite(t)) return ''; return istDay(t) === d0 ? `till ${hmOf(iso)}` : `till ${dayLabel(istDay(t)).split(',')[0]}`; };
    const row = (x, extra = '') => `<div class="row ic agp-mem" data-id="${esc(x.id)}">${extra}<div class="rbody"><div class="rtitle wrap">${esc(x.text)}</div></div>${x.importance ? imp(x.importance) : ''}<button class="mem-x" data-act="agp-forget" data-id="${esc(x.id)}" aria-label="Forget this">${I.x}</button></div>`;
    const total = (M.long ?? []).length;
    sc.innerHTML = `<header class="phead"><h1 class="lt">Memory</h1><p class="sub">${total ? `${total} thing${total === 1 ? '' : 's'} she knows${learned.length ? `, ${learned.length} learned today` : ''}.` : 'Nothing yet. Tell her about yourself and it lands here.'} Every night she tidies it: the day becomes a summary, and what will still matter is kept.</p></header>
      ${offNote()}
      ${learned.length ? `<div class="sh"><h2>Learned today</h2></div><div class="group">${learned.map((x) => row(x)).join('')}</div>` : ''}
      ${(M.short ?? []).length ? `<div class="sh"><h2>Right now</h2><span class="sh-count">expires on its own</span></div>
        <div class="group">${M.short.map((x) => `<div class="row mem-now agp-mem" data-id="${esc(x.id)}"><div class="rbody"><div class="rtitle wrap">${esc(x.text)}</div><div class="rmeta"><span class="ell">${esc(x.kind === 'followup' ? 'To follow up' : 'Going on now')} ${esc(until(x.expires_at))}</span></div></div><button class="mem-x" data-act="agp-forget" data-id="${esc(x.id)}" aria-label="Forget this">${I.x}</button></div>`).join('')}</div>` : ''}
      ${[...byKind.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, list]) => `<div class="sh"><h2>${esc(KIND[k] ?? k)}</h2><span class="sh-count">${list.length}</span></div><div class="group">${list.map((x) => row(x)).join('')}</div>`).join('')}
      ${(M.journal ?? []).length ? `<div class="sh"><h2>Your journal, through her</h2><span class="sh-count">${M.journal.length}</span></div>
        <div class="group">${M.journal.slice(0, 7).map((j) => `<div class="row"><div class="rbody"><div class="rtitle">${esc(dayLabel(j.date))}${j.mood ? ` · ${esc(j.mood)}` : ''}</div><div class="agp-day-sum">${esc(j.text)}</div><div class="rmeta"><span class="ell">${j.source === 'call' ? 'Said on a call' : 'From your chat'}</span></div></div></div>`).join('')}</div>` : ''}
      ${(M.days ?? []).length ? `<div class="sh"><h2>Past days</h2></div><div class="group">${M.days.map((d) => `<div class="row"><div class="rbody"><div class="rtitle">${esc(dayLabel(d.date))}</div><div class="agp-day-sum">${esc(d.summary)}</div></div></div>`).join('')}</div>` : ''}
      <div class="pad ag-meetbar"><button class="btn block" data-act="agp-brain">${I.folder}<span>Open the Brain</span></button></div>`;
  } });
  (async () => {
    if (DEMO_MODE) { MEM = demoMemory(); pg._redraw?.(); return; }
    const [r, jr] = await Promise.all([read('/wyn/memory'), read('/wyn/journal')]);
    MEM = r && !r.error ? { ...r, journal: jr && !jr.error ? jr.journal ?? [] : MEM?.journal ?? [] } : (MEM && !MEM.error ? MEM : { error: r?.error ?? 'offline', offline: r?.offline });
    pg._redraw?.();
  })();
  return pg;
}
on('agp-forget', async (el) => {
  const id = el.dataset.id, r = el.closest('.row');
  haptic(8); r?.classList.add('gone');
  if (DEMO_MODE) { setTimeout(() => r?.remove(), 300); toast('Forgotten'); return; }
  try {
    const out = await act(`/wyn/memory/${encodeURIComponent(id)}`, {}, { method: 'DELETE' });
    if (MEM) { MEM.long = (MEM.long ?? []).filter((x) => x.id !== id); MEM.short = (MEM.short ?? []).filter((x) => x.id !== id); }
    setTimeout(() => r?.remove(), 300);
    toast(out?.queued ? 'Forgotten here; the PC forgets it when it\'s back' : 'Forgotten');
    refresh({ quiet: true });
  } catch (e) { r?.classList.remove('gone'); toast(e?.message ?? 'Couldn\'t forget that'); }
});

// ── calls ────────────────────────────────────────────────────────────
let CALLS = null;
const callTitle = (c) => c.reason || (c.direction === 'outgoing' ? 'You called' : 'She called');
const callStatus = (c) => ({ dropped: 'Dropped', missed: 'Missed', failed: 'Failed', live: 'Live now' }[c.status] ?? '');
export function openCalls() {
  const pg = page({ title: 'Calls', live: ['prefs', 'home'], render(sc) {
    const prefs = AG.prefs ?? {}, realtime = !!AG.calls?.voice?.realtime;
    const list = CALLS?.calls ?? (DEMO_MODE ? AG.calls?.recent ?? [] : null);
    const spent = (list ?? []).filter((c) => Date.parse(c.started_at) > nowMs() - 30 * 864e5).reduce((a, c) => a + (Number(c.cost_usd) || 0), 0);
    sc.innerHTML = `<header class="phead"><h1 class="lt">Calls</h1><p class="sub">She rings you in the morning and at night, and when the ladder reaches the top. Every call leaves a summary here.</p></header>
      ${offNote()}
      <div class="group">
        <button class="row ic" data-act="agp-calltime" data-k="morning_call"><span class="tile">${I.sun}</span><div class="rbody"><div class="rtitle">Morning call</div><div class="rmeta"><span class="ell">The shape of the day in under a minute</span></div></div><span class="rend">${esc(prefs.morning_call || 'Off')}${I.chevR}</span></button>
        <button class="row ic" data-act="agp-calltime" data-k="night_call"><span class="tile">${I.moon}</span><div class="rbody"><div class="rtitle">Night call</div><div class="rmeta"><span class="ell">Close the day, two lines for your journal</span></div></div><span class="rend">${esc(prefs.night_call || 'Off')}${I.chevR}</span></button>
        <button class="row ic" data-act="agp-snooze"><span class="tile">${I.clock}</span><div class="rbody"><div class="rtitle">When you say later</div><div class="rmeta"><span class="ell">She rings back after</span></div></div><span class="rend">${esc(prefs.snooze || '15')} min${I.chevR}</span></button>
      </div>
      <p class="hint">${realtime ? 'Calls use OpenAI realtime (a funded key is set on the PC).' : 'Free calls: your phone hears you and speaks for her; her brain runs on your PC, on your subscription.'}${spent > 0 ? ` Realtime calls this month: $${spent.toFixed(2)}.` : ''}</p>
      <div class="sh"><h2>Recent</h2>${list?.length ? `<span class="sh-count">${list.length}</span>` : ''}</div>
      ${list == null ? (CALLS?.error ? failNote(CALLS) : '<div class="ag-skel" aria-hidden="true"><i></i><i></i></div>')
        : !list.length ? '<p class="note">No calls yet. Ring her, or wait for the morning call.</p>'
        : `<div class="group calls">${list.slice(0, 30).map((c) => `<div class="call-item" data-id="${esc(c.id)}">
          <button class="row ic" data-act="agp-callrow" data-id="${esc(c.id)}"><span class="tile call-ic">${I.phone}</span>
            <div class="rbody"><div class="rtitle">${esc(callTitle(c))}</div><div class="rmeta"><span class="ell">${esc(c.summary ?? callStatus(c) ?? '')}</span></div></div>
            <span class="rend"><span class="cr-day">${esc(dayWord(c.started_at))}<small>${c.seconds ? esc(mins(c.seconds)) : esc(callStatus(c) || '—')}</small></span><span class="cr-chev">${I.chevD}</span></span></button>
          <div class="call-more"><div><p class="cm-sum">${esc(c.summary ?? (c.status === 'ended' ? 'No summary: the call was too short to write up.' : callStatus(c)))}</p>
            <div class="agp-actions" data-for="${esc(c.id)}"></div>
            <div class="cm-foot"><button class="chip sm" data-act="agp-transcript" data-id="${esc(c.id)}">${I.doc}Transcript</button><span class="cap">${c.direction === 'incoming' ? 'She rang' : 'You rang'}${c.cost_usd ? ` · $${Number(c.cost_usd).toFixed(2)}` : ' · free'}</span></div></div></div>
        </div>`).join('')}</div>`}
      <div class="pad ag-meetbar"><button class="btn block" data-act="ag-call">${I.phone}<span>Call ${esc(agName())} now</span></button></div>`;
  } });
  (async () => {
    if (DEMO_MODE) return;
    const r = await read('/wyn/calls');
    CALLS = r && !r.error ? r : (CALLS && !CALLS.error ? CALLS : { error: r?.error ?? 'offline', offline: r?.offline });
    pg._redraw?.();
  })();
  return pg;
}
const CALL_DETAIL = new Map();
async function callDetail(id) {
  if (CALL_DETAIL.has(id)) return CALL_DETAIL.get(id);
  if (DEMO_MODE) {
    const c = (AG.calls?.recent ?? []).find((x) => x.id === id) ?? {};
    const d = { ...c, transcript: [{ who: 'wyn', text: 'Good morning. First up, GE I at 10:30. How are you feeling about today?' }, { who: 'you', text: 'Theek hai. Put the reel at 18:45.' }, { who: 'wyn', text: 'Done. The reel is at 18:45.' }], actions: ['Reel shoot at 18:45', 'Send the Harborline quote before 17:00'] };
    CALL_DETAIL.set(id, d); return d;
  }
  const r = await read(`/wyn/calls/${encodeURIComponent(id)}`);
  if (r && !r.error) CALL_DETAIL.set(id, r);
  return r;
}
on('agp-callrow', async (el) => {
  const item = el.closest('.call-item'); if (!item) return;
  item.classList.toggle('open'); haptic(5);
  if (!item.classList.contains('open')) return;
  const host = $('.agp-actions', item); if (!host || host.dataset.loaded) return;
  host.dataset.loaded = '1';
  const d = await callDetail(el.dataset.id);
  if (d?.actions?.length) host.innerHTML = `<p class="cm-lbl">Action points</p><ul>${d.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`;
});
on('agp-transcript', (el) => openCallDetail(el.dataset.id));
export async function openCallDetail(id) {
  const sh = openSheet({ title: 'The call', large: true, cls: 'agp-call', body: `<div class="ag-skel" aria-hidden="true"><i></i><i></i><i></i></div>` });
  const d = await callDetail(id);
  const body = $('.sheet-body', sh); if (!body) return sh;
  if (!d || d.error) { body.innerHTML = failNote(d ?? { error: 'Not found' }); return sh; }
  const name = agName();
  body.innerHTML = `<div class="pad">
      <p class="agp-call-h"><b>${esc(callTitle(d))}</b><span>${esc(dayWord(d.started_at))}${d.seconds ? ` · ${esc(mins(d.seconds))}` : ''}${d.status && d.status !== 'ended' ? ` · ${esc(callStatus(d))}` : ''}</span></p>
      ${d.summary ? `<p class="cm-sum">${esc(d.summary)}</p>` : ''}
      ${d.actions?.length ? `<p class="cm-lbl">Action points</p><ul class="agp-points">${d.actions.map((a) => `<li>${I.check}<span>${esc(a)}</span></li>`).join('')}</ul>` : ''}
      <p class="cm-lbl">What was said</p>
      ${(d.transcript ?? []).length ? `<ol class="agp-trans">${d.transcript.map((t) => `<li class="${t.who === 'you' ? 'me' : 'her'}"><b>${t.who === 'you' ? 'You' : esc(name)}</b><span>${esc(t.text)}</span>${t.at ? `<time class="num">${esc(hmOf(t.at))}</time>` : ''}</li>`).join('')}</ol>` : '<p class="note">Nothing was transcribed on this call.</p>'}
    </div>`;
  return sh;
}
on('agp-calltime', (el) => {
  const k = el.dataset.k, cur = AG.prefs?.[k] || '';
  const label = k === 'morning_call' ? 'Morning call' : 'Night call';
  const sh = openSheet({ title: label, sub: k === 'morning_call' ? 'She rings to go through the day.' : 'She rings to close the day and take two lines for your journal.', body: `<div class="pad">
      <div class="field"><input class="agp-time" type="time" value="${esc(cur || (k === 'morning_call' ? '07:30' : '22:15'))}" aria-label="${label} time" /></div>
      <button class="btn primary block agp-mt" data-act="agp-calltime-set" data-k="${k}">Save</button>
      ${cur ? `<button class="btn block agp-mt" data-act="agp-calltime-off" data-k="${k}">Turn it off</button>` : ''}</div>` });
  return sh;
});
on('agp-calltime-set', (el) => {
  const k = el.dataset.k, v = $('.agp-time', el.closest('.sheet'))?.value ?? '';
  if (!/^\d\d:\d\d$/.test(v)) { toast('Pick a time'); return; }
  closeSheet(el.closest('.sheet')); haptic(8);
  setPref({ [k]: v }, `${k === 'morning_call' ? 'Morning' : 'Night'} call at ${v}`);
});
on('agp-calltime-off', (el) => { const k = el.dataset.k; closeSheet(el.closest('.sheet')); haptic(8); setPref({ [k]: '' }, `${k === 'morning_call' ? 'Morning' : 'Night'} call off`); });
on('agp-snooze', () => {
  const cur = String(AG.prefs?.snooze ?? '15');
  openSheet({ title: 'When you say later', sub: 'How long before she rings back.', cls: 'ag-pick', body: `<div class="group">${['10', '15', '30', '60'].map((m) => `<button class="row" data-act="agp-snooze-set" data-m="${m}" aria-pressed="${m === cur}">
      <div class="rbody"><div class="rtitle">${m} minutes</div></div>${m === cur ? `<span class="ag-tick">${I.check}</span>` : ''}</button>`).join('')}</div>` });
});
on('agp-snooze-set', (el) => { const m = el.dataset.m; closeSheet(el.closest('.sheet')); haptic(8); setPref({ snooze: m }, `She rings back after ${m} minutes`); });

// ── his mood ─────────────────────────────────────────────────────────
let BREATHS = null;
export function openMood() {
  const pg = page({ title: 'How you seem', live: ['home', 'mood'], render(sc) {
    const m = AG.mood;
    if (!m) { sc.innerHTML = `<header class="phead"><h1 class="lt">How you seem</h1></header>${AG.offline ? failNote({ error: 'offline', offline: true }) : '<div class="ag-skel" aria-hidden="true"><i></i><i></i></div>'}`; return; }
    const meter = (k, label, v, lo, hi, p) => `<div class="agp-meter"><div class="agp-meter-h"><b>${label}</b><span class="num">${Math.round(p * 100)}%</span></div>
      <span class="bar" style="--p:${Math.round(p * 100)}%;--c:${k === 'stress' ? (v >= 0.78 ? 'var(--needs)' : v >= 0.6 ? 'var(--warn, var(--needs))' : 'var(--lv-c1, var(--ink))') : 'var(--lv-c2, var(--ink))'}"><i></i></span><div class="ag-range-e"><small>${lo}</small><small>${hi}</small></div></div>`;
    const up = (m.reasons ?? []).filter((r) => (r.stress ?? 0) > 0 || (r.valence ?? 0) < 0 || (r.energy ?? 0) < 0);
    const down = (m.reasons ?? []).filter((r) => !up.includes(r));
    const B = BREATHS ?? AG.breaths;
    sc.innerHTML = `<header class="phead"><h1 class="lt">${esc(m.label)}</h1><p class="sub">${esc(m.line)}</p></header>
      ${offNote()}
      <section class="surface agp-mood${m.overloaded ? ' is-hot' : ''}">
        ${meter('stress', 'Stress', m.stress, 'Calm', 'Overloaded', m.stress)}
        ${meter('energy', 'Energy', m.energy, 'Drained', 'Charged', m.energy)}
        ${meter('valence', 'Mood', m.valence, 'Low', 'Good', (m.valence + 1) / 2)}
      </section>
      ${up.length ? `<div class="sh"><h2>What's weighing on it</h2></div><div class="group">${up.map((r) => `<div class="row ic"><span class="tile agp-up">${I.up}</span><div class="rbody"><div class="rtitle wrap">${esc(r.text)}</div></div></div>`).join('')}</div>` : ''}
      ${down.length ? `<div class="sh"><h2>What's helping</h2></div><div class="group">${down.map((r) => `<div class="row ic"><span class="tile agp-down">${I.check}</span><div class="rbody"><div class="rtitle wrap">${esc(r.text)}</div></div></div>`).join('')}</div>` : ''}
      <div class="pad agp-breathe"><button class="btn primary block" data-act="agp-breathe">${AI.breath}<span>Breathe with her</span></button>
        <p class="hint">Or hold her orb. Box breathing, four counts each way, guided by vibration.</p></div>
      <div class="sh"><h2>Breathing this week</h2></div>
      ${B?.sessions?.length ? `<div class="group">${B.sessions.slice(0, 10).map((s) => `<div class="row ic"><span class="tile">${AI.breath}</span><div class="rbody"><div class="rtitle">${esc(s.rounds ? `${s.rounds} round${s.rounds === 1 ? '' : 's'} of ${s.pattern}` : s.pattern)}</div><div class="rmeta"><span class="num">${esc(dayWord(s.at))}</span><span>·</span><span>${esc(mins(s.seconds))}${s.completed ? '' : ' · stopped early'}</span></div></div></div>`).join('')}</div>
        <p class="hint">${B.minutes} min in the last 7 days.</p>` : '<p class="note">None yet this week.</p>'}
      <p class="hint">Read from your day, not a diagnosis: what's booked against the time left, what's late, what's waiting on you, what you wrote to her, and sleep, screen time and money when those apps know them.</p>`;
  } });
  (async () => {
    if (DEMO_MODE) return;
    const [m, b] = await Promise.all([read('/wyn/mood?fresh=1'), read('/wyn/breaths?days=7')]);
    if (m && !m.error && typeof m.stress === 'number') { AG.mood = m; changed('mood'); }
    if (b && !b.error) BREATHS = b;
    pg._redraw?.();
  })();
  return pg;
}
on('agp-breathe', () => { haptic(8); api.startBreathing({ pattern: 'box' }); });

// ── an agent's question, answered in his words ───────────────────────
export function openReply(id) {
  const a = [...AG.asks, ...openAsks()].find((x) => x.id === id);
  if (!a) { toast('That question was already answered'); return null; }
  const sh = openSheet({ title: a.from ? `${esc(a.from)} asks` : 'A question for you', body: `<div class="pad">
      <p class="agp-q">${esc(a.title)}</p>${a.text ? `<p class="agp-qx">${esc(a.text)}</p>` : ''}
      <textarea class="ag-soul-ta agp-reply-ta" rows="4" placeholder="Your answer. ${esc(agName())} passes it on." aria-label="Your answer"></textarea>
      <button class="btn primary block" data-act="agp-reply-send" data-id="${esc(id)}" disabled>Send</button>
      <button class="btn block agp-mt" data-act="agp-reply-later" data-id="${esc(id)}">Not now</button></div>` });
  const ta = $('textarea', sh), b = $('[data-act="agp-reply-send"]', sh);
  ta?.addEventListener('input', () => { b.disabled = !ta.value.trim(); });
  setTimeout(() => ta?.focus({ preventScroll: true }), 400);
  return sh;
}
on('agp-reply-send', async (el) => {
  const id = el.dataset.id, sh = el.closest('.sheet'), text = $('textarea', sh)?.value.trim();
  if (!text) return;
  el.disabled = true; haptic(10);
  try {
    const r = await answer(id, true, { text });
    closeSheet(sh);
    toast(r?.queued ? 'Saved; it goes to the PC when it\'s back' : 'Sent. She passed it on');
  } catch (e) { el.disabled = false; toast(e?.message ?? 'Couldn\'t send that'); }
});
on('agp-reply-later', async (el) => {
  const id = el.dataset.id, sh = el.closest('.sheet');
  closeSheet(sh); haptic(6);
  try { await answer(id, false, { text: 'Not now' }); } catch {}
});
