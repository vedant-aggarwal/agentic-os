// Quick add: one line that understands people, days, times, lengths, areas and projects as you type, marked inside the
// field. A line that holds several tasks or Hinglish ("kal subah dad ko call aur 6 baje gym") is read by the agent on
// the PC (POST /ai/parse) into rows he ticks; a question or an instruction ("move the invoice to Friday", "what's
// slipping?") is asked (POST /ai/ask) and comes back as changes to tick or an answer. Offline, or for an account
// without the agent, the line is added as typed (the local parse), which is also what every simple line uses.
import { $, $$, esc, on, openSheet, closeSheet, toast, haptic, ring } from './core.js';
import { I } from './icons.js';
import { PEOPLE, PROJECTS, AREAS, AREA_ASPECTS, GOALS, AGENT, USER, area, project, person, aspect } from './data.js';
import { api, provide } from './bus.js';
import { stagger, presence } from './motion.js';
import { learned, rel, snapUp } from './today-data.js';
import { TODAY, REAL, DEMO_MODE, NOW, addDays, day, hm, dur, plural, task, goal, goalShort, aspectName, W, snapOf } from './today-state.js';
import { canAI, aiOn, readLine, ask, decide } from './today-ai.js';
import { whenText } from './today-tasks.js';

const aspectDot = (id) => (id ? `<i class="dot" style="--c:var(--${id})"></i>` : '');
// ── the local parse ──────────────────────────────────────────────────
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ASPECT_WORDS = [
  [/\b(gym|workout|run|walk|cardio|protein|doctor|sleep|yoga|meal)\b/i, 'body'],
  [/\b(read|book|course|study|exam|class|lecture|revise|assignment|notes)\b/i, 'mind'],
  [/\b(meditate|pray|habit|detox)\b/i, 'soul'],
  [/\b(invoice|quote|payment|pay|bill|fee|₹|rs\.?|bank|tax|gst)\b/i, 'money'],
  [/\b(journal|review|plan the week)\b/i, 'growth'],
  [/\b(reel|shoot|post|script|pitch|ship|build|launch|deploy|client)\b/i, 'mission'],
];
const findArea = (tag) => {
  const t = tag.toLowerCase();
  for (const [slug, a] of Object.entries(AREAS)) {
    if (slug === 'none') continue;
    const initials = slug.split('-').map((w) => w[0]).join('');
    const words = String(a.name).toLowerCase().split(/[^a-z]+/).filter(Boolean);
    if (slug === t || slug.startsWith(t) || initials === t || words.some((w) => w.startsWith(t))) return slug;
  }
  return null;
};
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function parseTask(text) {
  const tokens = [];
  const mark = (re, kind) => { const m = re.exec(text); if (m) tokens.push([m.index, m.index + m[0].length, kind]); return m; };
  const out = { title: text, date: null, at: null, len: null, person: null, aspect: null, area: null, project: null, goal: null, tonight: false };
  for (const p of PEOPLE) { if (!p?.name) continue; const m = mark(new RegExp(`\\b${reEsc(p.name)}\\b`, 'i'), 'person'); if (m) { out.person = p.id; out.aspect = p.aspect ?? null; break; } }
  let m = mark(/(^|\s)#([\p{L}\d-]+)/u, 'area');
  if (m) { const a = findArea(m[2]); if (a) out.area = a; else tokens.pop(); }
  m = mark(/\b(today|tonight|tomorrow|tmrw|(next )?(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?)\b/i, 'date');
  if (m) {
    const w = m[0].toLowerCase();
    if (w === 'today' || w === 'tonight') { out.date = TODAY; out.tonight = w === 'tonight'; }
    else if (w === 'tomorrow' || w === 'tmrw') out.date = addDays(TODAY, 1);
    else {
      const i = WEEKDAYS.findIndex((d) => d.startsWith(w.replace('next ', '').slice(0, 3)));
      let n = ((i + 6) % 7 - day(TODAY).dow + 7) % 7;   // Monday-first, days ahead; the same weekday means next week
      if (n === 0 || /next/.test(w)) n += n === 0 ? 7 : 0;
      out.date = addDays(TODAY, n);
    }
  }
  m = mark(/\b(at )?(\d{1,2})(:(\d{2}))? ?(am|pm)\b|\b(at )?([01]?\d|2[0-3]):([0-5]\d)\b|\bat (\d{1,2})\b(?! ?(m|min|h))/i, 'time');
  if (m) {
    if (m[2]) { let h = Number(m[2]) % 12; if (/pm/i.test(m[5])) h += 12; out.at = h * 60 + Number(m[4] ?? 0); }
    else if (m[7] != null) out.at = Number(m[7]) * 60 + Number(m[8]);
    else if (m[9] != null) { const h = Number(m[9]); out.at = ((h < 8 ? h + 12 : h) % 24) * 60; out.bare = h; }
    const said = !!out.date;
    if (!out.date) out.date = TODAY;
    // "tonight at 2" is 02:00 after midnight; a time already gone today, with no day said, is tomorrow's
    if (out.date === TODAY) {
      if (out.tonight && out.bare != null && out.bare <= 5) { out.at = out.bare * 60; out.date = addDays(TODAY, 1); }
      else if (out.tonight && out.bare != null && out.bare <= 12) out.at = ((out.bare % 12) + 12) * 60;
      else if ((!said || out.tonight) && out.at < NOW - 30) out.date = addDays(TODAY, 1);
    }
  }
  m = mark(/\bfor (\d+(?:\.\d+)?) ?(m|min|mins|minutes|h|hr|hrs|hours?)\b|\bfor (an|one) hour\b|\bfor half an hour\b/i, 'len');
  if (m) out.len = /half/i.test(m[0]) ? 30 : m[3] ? 60 : /^h/i.test(m[2]) ? Math.round(parseFloat(m[1]) * 60) : Math.round(parseFloat(m[1]));
  for (const p of PROJECTS) {
    const names = [p.name, p.slug.replace(/-/g, ' ')].filter((x) => x && x.length > 2);
    for (const n of names) { if (mark(new RegExp(`\\b${reEsc(n)}\\b`, 'i'), 'project')) { out.project = p.slug; break; } }
    if (out.project) break;
  }
  if (!out.area && out.project) out.area = project(out.project)?.area ?? null;
  if (!out.aspect && out.area) out.aspect = AREA_ASPECTS[out.area]?.[0] ?? null;
  if (!out.aspect) for (const [re, id] of ASPECT_WORDS) { if (re.test(text)) { out.aspect = id; break; } }
  if (!out.aspect && out.project) out.aspect = 'mission';
  if (out.project) out.goal = project(out.project)?.goal ?? null;
  // the title is the sentence without its date, time, length and #area
  const cut = tokens.filter(([, , k]) => k === 'date' || k === 'time' || k === 'len' || k === 'area').sort((a, b) => b[0] - a[0]);
  let title = text; for (const [s, e] of cut) title = title.slice(0, s) + title.slice(e);
  out.title = title.replace(/\s{2,}/g, ' ').replace(/\s+([,.?!])/g, '$1').replace(/(\s+(on|at|by))+\s*$/i, '').trim();
  if (!out.len) out.len = learned(out.title, out.area) ?? (out.person ? 10 : 30);
  out.tokens = tokens.sort((a, b) => a[0] - b[0]);
  return out;
}
// a question or an instruction for the agent · a line that holds several tasks, or Hinglish, worth her read
const isAsk = (s) => /^\s*(move|push|shift|reschedule|fill|mark|tick|drop|cancel|give|what|what’s|whats|when|which|how|why|is|am|do|did|show|find|done with|clear)\b/i.test(s) || /\?\s*$/.test(s);
const HINGLISH = /\b(aur|kal|parso|aaj|baje|subah|shaam|raat|dopahar|karna|karni|karne|hai|hain|ko|ke|ki|wala|wali|phir|bhi|mujhe|liye)\b/i;
const isRead = (s) => s.trim().split(/\s+/).length >= 4 && (HINGLISH.test(s) || /[,;]|\b(and|then|also)\b/i.test(s));
const isPlan = (s) => /^\s*plan( my| the)?( day| today| rest of (the )?day)?\s*$/i.test(s);
function modeOf(text) {
  if (!text.trim()) return 'add';
  if (isPlan(text)) return 'plan';
  if (!aiOn()) return 'add';
  if (isAsk(text)) return 'ask';
  if (isRead(text)) return 'read';
  return 'add';
}
const samples = () => {
  if (DEMO_MODE) return ['Message Kabir Saturday 6pm', 'Call Dad tomorrow 11am about the website fee', 'Atlas ERP demo prep for 1 hour Friday', 'Read 20 pages tonight at 21:30'];
  const p = PEOPLE[0]?.name, pr = PROJECTS[0]?.name;
  return [p ? `Call ${p} tomorrow 11am` : 'Call the bank tomorrow 11am', 'Gym 6pm for 1 hour', pr ? `${pr}: review the build Friday` : 'Pay the electricity bill Friday', ...(aiOn() ? ['What’s slipping this week?'] : ['Read 20 pages tonight at 21:30'])];
};

// ── the sheet ─────────────────────────────────────────────────────────
export function addTask(prefill = {}) {
  const pre = typeof prefill === 'string' ? { title: prefill } : { ...(prefill ?? {}) };
  const el = openSheet({
    cls: 'td-qa-sheet',
    head: `<div class="sheet-head"><div class="sh-text"><h3>${pre.parent ? 'New step' : 'New task'}</h3><p>Type it the way you'd say it${aiOn() ? `, or ask ${esc(AGENT.name)}` : ''}</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: `<div class="pad"><div class="td-qa-field"><div class="td-qa-mirror" aria-hidden="true"></div><input class="td-qa-input" type="text" enterkeyhint="done" autocomplete="off" aria-label="Task" placeholder="${esc(samples()[0])}" value="${esc(pre.title ?? '')}" /></div></div>
      <div class="td-qa-parsed" aria-live="polite"></div>
      <div class="td-qa-ai" hidden></div>
      <div class="td-qa-try"><p class="foot">Try</p><div class="td-qa-samples">${samples().map((s) => `<button class="chip sm" data-act="td-qa-sample">${esc(s)}</button>`).join('')}</div></div>
      <div class="pad td-qa-go"><p class="hint td-qa-hint"></p><button class="btn primary block" style="--c:var(--today-fill)" data-act="td-qa-add" disabled>Add task</button></div>`,
  });
  el._pre = pre; el._ai = null;
  const input = $('.td-qa-input', el);
  input.addEventListener('input', () => { el._ai = null; draw(el); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('[data-act="td-qa-add"]', el).click(); } });
  draw(el);
  setTimeout(() => input.focus({ preventScroll: true }), 380);
  return el;
}
function draw(el) {
  const input = $('.td-qa-input', el); const text = input.value;
  const p = parseTask(text); el._p = p;
  const mode = modeOf(text); el._mode = mode;
  // the mirror draws the same words behind the input, the recognised ones marked
  let html = '', i = 0;
  if (mode === 'add') for (const [s, e, k] of p.tokens) { if (s < i) continue; html += esc(text.slice(i, s)) + `<mark class="td-qa-tk td-qa-${k}">${esc(text.slice(s, e))}</mark>`; i = e; }
  html += esc(text.slice(i));
  $('.td-qa-mirror', el).innerHTML = html + '&#8203;';
  const pre = el._pre ?? {};
  const asp = pre.aspect ?? p.aspect, gl = pre.goal ?? p.goal, pr = pre.project ?? p.project, who = pre.person ?? p.person, ar = pre.area ?? p.area;
  const date = p.date ?? pre.date ?? null, at = p.at ?? pre.at ?? null;
  const g = gl ? goal(gl) : null;
  const ch = (k, v) => `<span class="td-qa-c" data-k="${k}"><span class="td-qa-k">${k}</span>${v}</span>`;
  const inbox = !pr && !date && !pre.parent;
  const chips = mode !== 'add' ? '' : [
    who ? ch('Person', esc(person(who)?.name ?? who)) : '',
    date ? ch('Day', esc(date === TODAY ? 'Today' : day(date).short)) : '',
    at != null ? ch('Time', `<span class="num">${hm(at)}</span>`) : '',
    ch('Length', dur(pre.len ?? p.len)),
    ar ? ch('Area', `${aspectDot(AREA_ASPECTS[ar]?.[0])}${esc(area(ar).name.split(' ')[0])}`) : asp ? ch('Aspect', `${aspectDot(asp)}${esc(aspect(asp)?.name ?? '')}`) : '',
    pr ? ch('Project', esc(project(pr)?.name ?? pr)) : '',
    inbox && text.trim() ? ch('Goes to', `${I.inbox}Inbox`) : '',
  ].filter(Boolean).join('');
  const host = $('.td-qa-parsed', el);
  const before = new Set($$('.td-qa-c', host).map((c) => c.dataset.k + c.textContent));
  host.innerHTML = text.trim() && mode === 'add' ? `<div class="td-qa-chips">${chips}</div>${g ? `<p class="td-qa-goal">${ring(g.pace, g.aspects?.[0] ?? 'mission', 22, 3, { k: g.time })}<span>Counts toward <b>${esc(g.title)}</b></span></p>` : ''}` : '';
  // a chip that is new springs in (what it just understood)
  stagger($$('.td-qa-c', host).filter((c) => !before.has(c.dataset.k + c.textContent)), { y: 6, scale: 0.9, each: 40 });
  $('.td-qa-try', el).hidden = !!text.trim();
  const hint = $('.td-qa-hint', el), btn = $('[data-act="td-qa-add"]', el);
  const ai = el._ai;
  $('.td-qa-ai', el).hidden = !ai;
  if (ai) { drawAi(el); return; }
  const off = REAL && USER?.owner && !canAI();
  if (mode === 'ask') { btn.textContent = `Ask ${AGENT.name}`; btn.disabled = off; hint.textContent = off ? 'Asking needs your PC. It’s offline right now.' : `${AGENT.name} shows the change first. Nothing moves until you tap Apply.`; }
  else if (mode === 'read') { btn.textContent = off ? 'Add as typed' : `Add with ${AGENT.name}`; btn.disabled = !p.title; hint.textContent = off ? 'Offline: it goes in as one task. Online, she splits it.' : `${AGENT.name} splits this into tasks with their day, time and area. You see them first.`; }
  else if (mode === 'plan') { btn.textContent = 'Plan my day'; btn.disabled = false; hint.textContent = ''; }
  else { btn.textContent = pre.parent ? 'Add step' : 'Add task'; btn.disabled = !p.title; hint.textContent = text.trim() && inbox ? 'No project and no day: it lands in the inbox. Try “at 6pm” or “tomorrow”.' : ''; }
}
on('td-qa-sample', (el) => { const sh = el.closest('.sheet'); const input = $('.td-qa-input', sh); input.value = el.textContent; sh._ai = null; draw(sh); input.focus({ preventScroll: true }); haptic('selection'); });
on('td-qa-add', async (el) => {
  const sh = el.closest('.sheet'); const p = sh._p; const pre = sh._pre ?? {};
  const text = $('.td-qa-input', sh).value.trim();
  if (sh._ai?.state === 'ready') { applyAi(sh); return; }
  if (sh._ai?.state === 'answer') { closeSheet(sh); return; }
  const mode = sh._mode;
  if (mode === 'plan') { closeSheet(sh); setTimeout(() => api.planDay('rest'), 300); return; }
  if ((mode === 'ask' || mode === 'read') && canAI()) { runAi(sh, mode, text); return; }
  if (!p?.title) return;
  addLocal(sh, p, pre);
});
function addLocal(sh, p, pre) {
  const date = p.date ?? pre.date ?? null;
  const at = p.at ?? pre.at ?? null;
  const title = p.title[0].toUpperCase() + p.title.slice(1);
  const projectSlug = pre.project ?? (p.project && project(p.project) ? p.project : null);
  const t = W.add({ title, area: pre.area ?? p.area ?? (projectSlug ? project(projectSlug)?.area : null) ?? null, project: projectSlug, goal: pre.goal ?? p.goal ?? null, date, due: date, at, len: pre.len ?? p.len, aspect: pre.aspect ?? p.aspect, person: pre.person ?? p.person });
  if (t && pre.parent) W.update(t.id, { parent: pre.parent });
  closeSheet(sh); haptic('success');
  const where = !date && !projectSlug && !pre.parent ? 'Added to the inbox' : projectSlug && !date ? `Added to ${project(projectSlug)?.name ?? 'the project'}` : `Added for ${date === TODAY ? 'today' : rel(date)}${at != null ? ` at ${hm(at)}` : ''}`;
  toast(where, () => { if (t) W.drop(t.id); });
  if (t && date === TODAY && at != null) document.dispatchEvent(new CustomEvent('td-reveal', { detail: { id: t.id, fresh: true } }));
}

// ── the agent's read and answer, inside the sheet ─────────────────────
const KIND_ICON = { move: I.clock, defer: I.cal, add: I.plus, done: I.check, drop: I.x, agent: I.claude, miss: I.search };
async function runAi(sh, mode, text) {
  sh._ai = { state: 'thinking', mode, q: text };
  const btn = $('[data-act="td-qa-add"]', sh); btn.disabled = true; btn.textContent = mode === 'read' ? 'Reading…' : 'Asking…';
  drawAi(sh);
  const steps = mode === 'read' ? ['Reading what you wrote', 'Splitting it into tasks', 'Matching days and areas'] : ['Reading your day', 'Matching tasks', 'Checking free time', 'Writing it up'];
  let i = 0;
  const tick = setInterval(() => { const t = $('.td-qa-think-t', sh); if (t) t.textContent = steps[Math.min(++i, steps.length - 1)]; }, 1600);
  try {
    const r = mode === 'read' ? await readLine(text) : await ask(text);
    sh._ai = r.kind === 'answer' ? { state: 'answer', mode, q: text, ...r } : { state: 'ready', mode, q: text, ...r };
    haptic('light');
  } catch (e) {
    sh._ai = { state: 'error', mode, q: text, error: e?.status ? e.message : 'Your PC isn’t reachable right now.' };
  }
  clearInterval(tick);
  if (sh.isConnected) drawAi(sh);
}
function rowAfter(x) {
  if (x.kind === 'add') { const t = x.task; const at = t.at ?? (t.scheduled ? Math.round((Date.parse(t.scheduled.start) - Date.parse(`${t.date ?? TODAY}T00:00:00+05:30`)) / 60000) : null); return t.date ? `${rel(t.date)}${at != null ? ` ${hm(at)}` : ''}` : 'Inbox'; }
  const p = x.patch ?? {};
  if (x.kind === 'move' && p.scheduled) { const d = p.due ?? TODAY; const s = Math.round((Date.parse(p.scheduled.start) - Date.parse(`${d}T00:00:00+05:30`)) / 60000); const e = Math.round((Date.parse(p.scheduled.end) - Date.parse(`${d}T00:00:00+05:30`)) / 60000); return `${rel(d)} ${hm(s)}–${hm(e)}`; }
  if (x.kind === 'defer') return `Due ${rel(p.due)}`;
  return { done: 'Done', drop: 'Dropped', agent: 'Hand to an agent', miss: 'Skipped' }[x.kind] ?? '';
}
function drawAi(sh) {
  const r = sh._ai, box = $('.td-qa-ai', sh), btn = $('[data-act="td-qa-add"]', sh), hint = $('.td-qa-hint', sh);
  box.hidden = !r;
  if (!r) return;
  $('.td-qa-try', sh).hidden = true;
  const head = `<div class="td-ai-k"><span class="orb xs" aria-hidden="true"></span><span class="ell">${esc(r.q.length > 60 ? `${r.q.slice(0, 58)}…` : r.q)}</span><button class="td-ai-x" data-act="td-ai-x" aria-label="Dismiss">${I.x}</button></div>`;
  hint.textContent = '';
  if (r.state === 'thinking') {
    box.innerHTML = `<div class="td-ai surface">${head}<p class="td-ai-load"><span class="spin" aria-hidden="true"></span><span class="td-qa-think-t td-shimmer">${r.mode === 'read' ? 'Reading what you wrote' : 'Reading your day'}</span></p></div>`;
    presence($('.td-ai', box), true);
    return;
  }
  if (r.state === 'error') {
    box.innerHTML = `<div class="td-ai surface">${head}<p class="td-ai-say td-ai-err">${esc(AGENT.name)} couldn’t answer. ${esc(r.error)}</p></div>`;
    btn.disabled = false; btn.textContent = r.mode === 'read' ? 'Add as typed' : 'Try again';
    sh._mode = r.mode === 'read' ? 'add' : 'ask';
    sh._ai = null;
    return;
  }
  const meta = `<p class="td-ai-meta">${esc(r.model)} on your PC${r.ms ? ` · ${(r.ms / 1000).toFixed(1)}s` : ''}</p>`;
  if (r.state === 'answer') {
    box.innerHTML = `<div class="td-ai surface">${head}<p class="td-ai-say">${esc(r.say || 'Nothing to change.')}</p>${(r.refs ?? []).map((id) => { const t = task(id); return t ? `<button class="td-ai-ref" data-act="task" data-id="${t.id}">${aspectDot(t.aspect)}<span class="ell">${esc(t.title)}</span><em class="num">${esc(whenText(t) || (t.late ?? ''))}</em></button>` : ''; }).join('')}${meta}</div>`;
    btn.disabled = false; btn.textContent = 'Done';
    stagger($$('.td-ai > *', box), { y: 6, each: 40 });
    return;
  }
  const n = r.rows.filter((x) => x.on).length;
  const rows = r.rows.map((x, i) => {
    const t = x.id ? task(x.id) : null;
    const title = x.kind === 'add' ? x.task.title : x.kind === 'miss' ? `Couldn’t find “${x.title}”` : t?.title ?? '';
    const before = x.kind === 'add' ? '<span class="td-ai-new">New</span>' : x.kind === 'miss' ? '' : `<s>${esc(t ? whenText(t) || t.late || 'No date' : '')}</s><span class="arr" aria-hidden="true">→</span>`;
    return `<button class="row td-ai-row k-${x.kind}${x.on ? ' on' : ''}" data-act="td-ai-tog" data-i="${i}" aria-pressed="${x.on}"${x.kind === 'miss' ? ' disabled' : ''}><span class="tile">${KIND_ICON[x.kind] ?? I.clock}</span><span class="rbody"><span class="rtitle">${esc(title)}</span><span class="rmeta">${before}<b>${esc(rowAfter(x))}</b></span></span><span class="td-ai-ck" aria-hidden="true">${I.check}</span></button>`;
  }).join('');
  box.innerHTML = `<div class="td-ai surface">${head}${r.say && r.mode === 'ask' ? `<p class="td-ai-say">${esc(r.say)}</p>` : ''}<p class="td-ai-sum"><b>${plural(r.rows.filter((x) => x.kind !== 'miss').length, r.mode === 'read' ? 'task' : 'change')}.</b> Untick any you don’t want.</p><div class="group td-ai-rows">${rows}</div>${meta}</div>`;
  const adds = r.rows.every((x) => x.kind === 'add' || x.kind === 'miss');
  btn.disabled = !n; btn.textContent = n ? (adds ? `Add ${plural(n, 'task')}` : `Apply ${plural(n, 'change')}`) : 'Nothing to apply';
  if (!r._shown) { r._shown = true; stagger($$('.td-ai-row', box), { y: 8, each: 45 }); }
}
on('td-ai-x', (el) => { const sh = el.closest('.sheet'); sh._ai = null; draw(sh); haptic('selection'); $('.td-qa-input', sh).focus({ preventScroll: true }); });
on('td-ai-tog', (el) => { const sh = el.closest('.sheet'); const x = sh._ai?.rows?.[Number(el.dataset.i)]; if (!x || x.kind === 'miss') return; x.on = !x.on; haptic('selection'); drawAi(sh); });
function applyAi(sh) {
  const r = sh._ai; if (!r) return;
  const rows = r.rows.filter((x) => x.on && x.kind !== 'miss');
  const snaps = [], made = [];
  let hand = null;
  for (const x of rows) {
    if (x.kind === 'add') {
      const t = x.task;
      const at = t.at ?? (t.scheduled && t.date ? Math.round((Date.parse(t.scheduled.start) - Date.parse(`${t.date}T00:00:00+05:30`)) / 60000) : null);
      const nt = W.add({ title: t.title, area: t.area ?? null, goal: t.goal ?? null, date: t.date ?? null, due: t.date ?? null, at, len: t.len ?? learned(t.title, t.area) ?? 30 });
      if (nt) made.push(nt.id);
      continue;
    }
    const t = task(x.id); if (!t) continue;
    if (x.kind === 'agent') { hand = t.id; continue; }
    snaps.push([t.id, snapOf(t.id)]);
    if (x.kind === 'drop') W.drop(t.id);
    else if (x.kind === 'done') W.done(t.id, true);
    else W.update(t.id, x.patch);
  }
  if (r.mode === 'read') decide(r.batchId, { kept: r.rows.filter((x) => x.on && x.pid).map((x) => x.pid), removed: r.rows.filter((x) => !x.on && x.pid).map((x) => x.pid) });
  closeSheet(sh); haptic('success');
  const n = rows.filter((x) => x.kind !== 'agent').length;
  if (n) toast(rows.every((x) => x.kind === 'add') ? `Added ${plural(n, 'task')}` : `Applied ${plural(n, 'change')}`, () => { for (const [id, s] of snaps) W.restore(id, s); for (const id of made) W.drop(id); });
  if (hand) setTimeout(() => api.handToAgent(hand), 380);
}
on('td-add', () => addTask());
provide('addTask', (prefill) => addTask(prefill ?? {}));
