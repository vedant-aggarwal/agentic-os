// Soul · Clean, the quit tracker he named. It sits behind Face ID, says nothing about what it is for, and handles a
// reset without shame or red. Also here: the urge flow (Soul's primary action), one tool for any pull, Clean's or an
// app's: breathe, remember why, one thing that helps, then a calm close.
// Every figure uses one formula: days since the last start, over his goal or 90. No "rewired %". Real records only
// (soul-store.js): with none yet, Clean offers to start and the urge card waits for its first entry.
import { $, $$, esc, push, closeSheet, toast, on, ring, setRing, haptic, pulse, seg } from '../core.js';
import { I } from '../icons.js';
import { aspHead } from '../aspects.js';
import { api } from '../bus.js';
import { stagger, rollHTML } from '../motion.js';
import { MILESTONES, STAGES, URGE_CHIPS } from './soul-data.js';
import * as ST from './soul-store.js';
import { SI, S, who, now, hhmm, pad, plural, span, cleanElapsed, cleanSince, onTick, emit, soulSheet } from './soul-ui.js';
import { unlockClean } from './soul-native.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (d) => ST.dayLabel(new Date(d.getTime() + ST.off() * 6e4).toISOString().slice(0, 10));
const dayAt = (n) => new Date(cleanSince().getTime() + n * 864e5);
const clockText = (e) => `${e.h} h ${pad(e.m)} m ${pad(e.s)} s`;
const CL = () => ST.clean();
const monthOf = (ms) => MONTHS[new Date(ms + ST.off() * 6e4).getUTCMonth()];

// ── the lock ──────────────────────────────────────────────────────────────
const lockHtml = (app) => { const t = ST.cleanText(); return `${aspHead(app, { title: 'Clean' })}
  <section class="sou-lock surface">
    <span class="sou-fid" aria-hidden="true">${SI.faceId}${I.check}</span>
    <h2 class="title2">Clean is private</h2>
    <p class="sub">${t ? `Your streak, your reasons and your log stay behind Face ID. Everywhere else in the app it only ever says “${t}”.` : 'A streak for something you are leaving behind. It stays behind Face ID, and you name it.'}</p>
    <button class="btn block sou-unlock" data-act="sou-unlock">${SI.faceId}${t ? 'Unlock with Face ID' : 'Open with Face ID'}</button>
  </section>
  <p class="hint sou-lock-h">Not in notifications or Home. ${esc(who())} never names it outside this tab.</p>`; };
on('sou-unlock', async (el) => {
  const sec = el.closest('.asp-sec'); const fid = $('.sou-fid', sec);
  if (!fid || fid.classList.contains('scan')) return;
  fid.classList.add('scan'); haptic(6);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [r] = await Promise.all([unlockClean(), new Promise((res) => setTimeout(res, reduce ? 60 : 640))]);
  if (!r.ok) { fid.classList.remove('scan'); if (!r.cancelled) toast('Face ID didn’t match. Try again'); return; }
  fid.classList.add('ok'); haptic(12);
  setTimeout(() => { S.unlocked = true; S.app?.refresh('clean'); }, reduce ? 140 : 410);
});
on('sou-lock-clean', () => { S.unlocked = false; S.app?.refresh('clean'); toast('Clean locked'); });

// ── starting it: a name, when the run began, a goal ──────────────────────
function setupHtml(app) {
  return `${aspHead(app, { title: 'Clean', sub: 'Private. Only you and the agent see this tab.', right: `<button class="sou-ibtn" data-act="sou-lock-clean" aria-label="Lock Clean">${I.lock}</button>` })}
    <section class="sou-setup surface">
      <span class="sou-empty-ic">${SI.seedling}</span>
      <h3 class="headline">Start your streak</h3>
      <p class="sub">Name it whatever you like; Clean is the default. Outside this tab it only ever shows as “Day N”.</p>
      <div class="sou-form">
        <label class="field"><input id="sou-cl-name" maxlength="24" placeholder="Clean" autocomplete="off" /></label>
        <p class="sou-form-l">This run began</p>
        <div class="pad">${seg('sou-cl-when', [['now', 'Today'], ['date', 'Earlier']], 'now')}</div>
        <label class="field sou-cl-date" hidden><input id="sou-cl-date" type="date" max="${ST.today()}" /></label>
        <p class="sou-form-l">Goal</p>
        <div class="pad">${seg('sou-cl-goal', [['30', '30 days'], ['60', '60 days'], ['90', '90 days']], '30')}</div>
      </div>
      <div class="sou-sheet-acts"><button class="btn primary block" style="--c:var(--as-fill)" data-act="sou-cl-start">Start</button></div>
    </section>`;
}
document.addEventListener('click', (e) => {   // "Earlier" shows the date field
  const b = e.target.closest?.('[data-seg="sou-cl-when"] [data-v]'); if (!b) return;
  setTimeout(() => { const f = $('.sou-cl-date'); if (f) f.hidden = b.dataset.v !== 'date'; }, 0);
});
on('sou-cl-start', (el) => {
  const sec = el.closest('.asp-sec') ?? document;
  const name = $('#sou-cl-name', sec)?.value.trim() || 'Clean';
  const when = $('[data-seg="sou-cl-when"] [aria-selected="true"]', sec)?.dataset.v ?? 'now';
  const date = $('#sou-cl-date', sec)?.value;
  const goal = Number($('[data-seg="sou-cl-goal"] [aria-selected="true"]', sec)?.dataset.v ?? 30);
  const since = when === 'date' && date ? new Date(Date.parse(`${date}T00:00:00Z`) - ST.off() * 6e4 + 8 * 36e5).toISOString() : new Date(ST.nowMs()).toISOString();
  ST.startClean({ since, name, goal }); haptic(12); S.arrived = false; S.app?.refresh('clean');
  toast(`${name}: day 1 counts from ${when === 'date' && date ? ST.dayLabel(date) : 'now'}`);
});

// ── the chain: the goal's days round a circle, the days he has are lit, today fills as it goes ──
function chainSvg(e, { goal = 30, size = 300 } = {}) {
  const c = size / 2; const R = size / 2 - 22;
  const n = Math.min(goal, 90);
  const marks = new Set(MILESTONES.filter((m) => m.d <= n).map((m) => m.d - 1));
  const beads = []; const light = []; const rr = n > 45 ? 0.6 : 1;
  for (let i = 0; i < n; i++) {
    const a = (-90 + (i + 0.5) * (360 / n)) * (Math.PI / 180);
    const x = (c + R * Math.cos(a)).toFixed(2); const y = (c + R * Math.sin(a)).toFixed(2);
    const r = (marks.has(i) ? 9 : 7) * rr;
    if (i < e.d) {
      beads.push(`<circle class="b lit${marks.has(i) ? ' ms' : ''}" cx="${x}" cy="${y}" r="${r}" style="--i:${i}"/>`);
      light.push(`<circle cx="${x}" cy="${y}" r="${r}"/>`);
    } else if (i === e.d) {
      const f = e.days - e.d; const top = (Number(y) + r - 2 * r * f).toFixed(2);
      beads.push(`<circle class="b now-t" cx="${x}" cy="${y}" r="${r}"/><clipPath id="sou-now-clip"><rect x="${Number(x) - r}" y="${top}" width="${2 * r}" height="${(2 * r * f).toFixed(2)}"/></clipPath><circle class="b now" cx="${x}" cy="${y}" r="${r}" clip-path="url(#sou-now-clip)" style="--i:${i}"/><circle class="b now-o" cx="${x}" cy="${y}" r="${r + 3.5}"/>`);
    } else beads.push(`<circle class="b${marks.has(i) ? ' ms' : ''}" cx="${x}" cy="${y}" r="${r}"/>`);
  }
  return `<svg class="sou-chain-s" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <defs><filter id="sou-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter></defs>
    <g class="sou-chain-l" filter="url(#sou-blur)">${light.join('')}</g>
    <g class="sou-chain-b">${beads.join('')}</g></svg>`;
}

const nextMs = (e) => MILESTONES.find((m) => m.d > e.days) ?? MILESTONES[MILESTONES.length - 1];
function heroHtml() {
  const c = CL(); const e = cleanElapsed();
  const goal = e.d >= c.goal ? Math.max(c.goal, MILESTONES.find((m) => m.d > e.d)?.d ?? c.goal) : c.goal;
  const next = nextMs(e); const nextAt = dayAt(next.d);
  const best = Math.max(c.best, e.d);
  return `<section class="sou-hero surface">
    <div class="sou-chain${S.arrived ? '' : ' arrive'}">
      ${chainSvg(e, { goal })}
      <div class="sou-chain-c">
        <span class="sou-chain-n"><b class="met">${S.arrived ? e.d : rollHTML(e.d)}</b><span>${e.d === 1 ? 'day' : 'days'}</span></span>
        <span class="met sou-clock" data-sou-clock>${clockText(e)}</span>
        <span class="sou-chain-k">of ${goal}</span>
      </div>
    </div>
    <div class="sou-tiles">
      <button class="sou-tile" data-act="sou-goal"><span>To your goal</span><b class="met">${Math.max(0, c.goal - e.d)}<small> days</small></b><em>${fmtDay(dayAt(c.goal))}</em></button>
      <button class="sou-tile" data-act="sou-ms" data-i="${MILESTONES.indexOf(next)}"><span>Next: ${next.label}</span><b class="met sou-next">${span(nextAt - now())}</b><em>${fmtDay(nextAt)}</em></button>
      <div class="sou-tile"><span>Best run</span><b class="met">${best}<small> days</small></b><em>${c.bestCurrent || best === e.d ? 'This one' : c.bestTo ? monthOf(c.bestTo) : '–'}</em></div>
    </div>
  </section>`;
}

function startClock() {
  onTick(() => {
    const els = $$('[data-sou-clock]'); if (!els.length || !CL()) return false;
    const e = cleanElapsed();
    els.forEach((x) => { x.textContent = clockText(e); });
    const nx = $('.sou-next'); if (nx) nx.textContent = span(dayAt(nextMs(e).d) - now());
    return true;
  });
}

// ── milestones: every one in reach, the next one half lit ───────────────
function milestonesHtml() {
  const e = cleanElapsed();
  const nextI = MILESTONES.findIndex((m) => m.d > e.days);
  return `<div class="sh"><h2>Milestones</h2><span class="sh-count">${nextI < 0 ? MILESTONES.length : nextI} of ${MILESTONES.length}</span></div>
    <section class="sou-ms surface">${MILESTONES.map((m, i) => {
      const got = e.days >= m.d; const p = got ? 1 : Math.min(1, e.days / m.d);
      return `<button class="sou-ms-i${got ? ' got' : i === nextI ? ' next' : ''}" data-act="sou-ms" data-i="${i}" aria-label="${m.label}: ${got ? 'reached' : `in ${span(dayAt(m.d) - now())}`}">
        ${ring(p, 'as', 56, 5, { inner: `<b class="met">${m.short}</b>` })}
        <span class="sou-ms-l">${m.label}</span>
        <span class="sou-ms-m">${got ? fmtDay(dayAt(m.d)).slice(4) : i === nextI ? `in ${span(dayAt(m.d) - now()).split(' ').slice(0, 2).join(' ')}` : fmtDay(dayAt(m.d)).slice(4)}</span>
      </button>`;
    }).join('')}</section>`;
}
function milestoneSheet(i) {
  const m = MILESTONES[i]; if (!m) return;
  const e = cleanElapsed(); const got = e.days >= m.d; const at = dayAt(m.d);
  const line = m.d === 30 && CL()?.goal === 30 ? 'Your goal: 30 days.' : m.line;
  soulSheet({
    title: m.label, sub: got ? `Reached ${fmtDay(at)}` : `${fmtDay(at)} · in ${span(at - now())}`, cls: 'sou-mss',
    body: `<div class="sou-ms-big">${ring(got ? 1 : e.days / m.d, 'as', 132, 11, { inner: `<span class="sou-ms-bn"><b class="met">${m.short}</b><span>${m.unit}</span></span>` })}</div>
      <p class="sou-ms-line">${esc(line)}</p>
      <p class="hint">${got ? 'Kept, whatever happens next. A restart never takes a milestone away.' : `${esc(who())} tells you the morning you get there. Nobody else.`}</p>`,
  });
}
on('sou-ms', (el) => milestoneSheet(Number(el.dataset.i)));
on('sou-goal', () => {
  const c = CL(); if (!c) return;
  if (c.goal_id) { api.openGoal(c.goal_id); return; }
  soulSheet({ title: 'Your goal', sub: 'Days in a row. You can raise it once you get there.',
    body: `<div class="pad">${seg('sou-goal-n', [['30', '30 days'], ['60', '60 days'], ['90', '90 days']], String(c.goal))}</div>
      <div class="sou-sheet-acts"><button class="btn primary block" style="--c:var(--as-fill)" data-act="sou-goal-save">Save</button></div>` });
});
on('sou-goal-save', (el) => { const sh = el.closest('.sheet'); const g = Number($('[data-seg="sou-goal-n"] [aria-selected="true"]', sh)?.dataset.v ?? 30); ST.updateClean({ goal: g }); closeSheet(sh); S.app?.refresh('clean'); });

// ── how it gets easier: what many people notice, stage by stage ─────────
function stagesHtml() {
  const e = cleanElapsed(); const day = e.d + 1;
  return `<div class="sh"><h2>How it gets easier</h2><span class="sh-count">to 90 days</span></div>
    <div class="group sou-stages">${STAGES.map((s) => {
      const st = day > s.to ? 'done' : day >= s.from ? 'now' : '';
      const p = st === 'done' ? 1 : st === 'now' ? (day - s.from + 0.5) / (s.to - s.from + 1) : 0;
      return `<button class="row sou-stage ${st}${st === 'now' ? ' open' : ''}" data-act="sou-stage" aria-expanded="${st === 'now'}">
        <span class="sou-stage-n" style="--p:${p.toFixed(2)}" aria-hidden="true"><i></i></span>
        <span class="rbody"><span class="sou-stage-d">Days ${s.from}–${s.to}${st === 'now' ? ' · you are here' : ''}</span><span class="rtitle">${esc(s.title)}</span><span class="sou-stage-x">${esc(s.text)}</span></span>
      </button>`;
    }).join('')}</div>
    <p class="hint">What many people notice, week by week. Every path is different, and none of it is a test.</p>`;
}
on('sou-stage', (el) => { const o = !el.classList.contains('open'); el.classList.toggle('open', o); el.setAttribute('aria-expanded', String(o)); haptic(4); });

// ── his reasons ───────────────────────────────────────────────────────────
const reasonsHtml = () => { const rs = CL().reasons; return `<div class="sh"><h2>Why I’m doing this</h2><button class="sh-act" data-act="sou-reasons-edit">${rs.length ? 'Edit' : 'Add'}</button></div>
  <section class="sou-reasons surface">${rs.length ? rs.map((r) => `<p class="sou-rsn"><span>${esc(r)}</span></p>`).join('') : '<p class="sub">Write two or three, in your words. They come up when an urge does.</p>'}</section>`; };
on('sou-reasons-edit', () => {
  const rs = CL()?.reasons ?? [];
  soulSheet({
    title: 'Why I’m doing this', sub: 'In your words. They come up when an urge does.', large: true,
    body: `<div class="sou-form">${rs.map((r, i) => `<label class="field sou-ta"><textarea rows="2" maxlength="200" data-i="${i}">${esc(r)}</textarea></label>`).join('')}
      <label class="field sou-ta"><textarea rows="2" maxlength="200" data-i="${rs.length}" placeholder="${rs.length ? 'Another reason' : 'The first reason'}"></textarea></label></div>
      <div class="sou-sheet-acts"><button class="btn primary block" style="--c:var(--as-fill)" data-act="sou-reasons-save">Save</button></div>`,
  });
});
on('sou-reasons-save', (el) => {
  const sh = el.closest('.sheet');
  const next = $$('textarea', sh).map((t) => t.value.trim()).filter(Boolean);
  ST.updateClean({ reasons: next });
  closeSheet(sh); S.app?.refresh('clean'); toast('Reasons saved');
});

// ── urges: when they come, and what it shows ────────────────────────────
const U = () => ST.urges();
const RODE = () => U().filter((u) => u.out === 'rode');
const avgMins = () => { const r = RODE().filter((u) => u.mins > 0); return r.length ? Math.round(r.reduce((a, u) => a + u.mins, 0) / r.length) : null; };
function peakRange() {
  const c = Array(24).fill(0); U().forEach((u) => { c[u.h] += 1; });
  let best = -1, at = 0; for (let h = 0; h < 24; h++) { const s = c[h] + c[(h + 1) % 24] + c[(h + 2) % 24]; if (s > best) { best = s; at = h; } }
  return { from: at, to: (at + 3) % 24, n: best };
}
function hourBars({ big = false } = {}) {
  const counts = Array(24).fill(0); U().forEach((u) => { counts[(u.h - 6 + 24) % 24] += 1; });
  const max = Math.max(1, ...counts); const Hp = big ? 84 : 56;
  const peak = counts.indexOf(Math.max(...counts));
  const pr = peakRange();
  return `<div class="sou-hb${big ? ' big' : ''}" role="img" aria-label="Urges by hour: most between ${pad(pr.from)}:00 and ${pad(pr.to)}:00">
      ${counts.map((n, c) => `<span class="sou-hb-c">${c === peak && n ? `<b class="sou-hb-v">${pad((c + 6) % 24)}:00</b>` : ''}<i style="height:${n ? Math.max(4, Math.round((n / max) * Hp)) : 0}px"></i></span>`).join('')}
    </div>
    <div class="sou-hb-x" aria-hidden="true"><span>06</span><span>12</span><span>18</span><span>00</span><span>05</span></div>`;
}
const urgeStats = () => { const a = avgMins(); return `<div class="sou-urg-h"><div><b class="met">${U().length}</b><span>${U().length === 1 ? 'urge' : 'urges'}</span></div><div><b class="met">${RODE().length}</b><span>ridden out</span></div><div><b class="met">${a ?? '–'}${a != null ? '<small> min</small>' : ''}</b><span>to pass</span></div></div>`; };
function urgesCard() {
  const us = U();
  if (!us.length) return `<div class="sh"><h2>Urges</h2><span class="sh-count">last 30 days</span></div>
    <section class="sou-urg surface"><p class="sub">None logged yet. When one comes, tap the round button below: a minute of breathing, your reasons, then two taps to log it. After a few, this shows when they come and what helps.</p></section>`;
  const pr = peakRange();
  return `<div class="sh"><h2>Urges</h2><span class="sh-count">last 30 days</span><button class="sh-act" data-act="sou-urges">See all ${I.chevR}</button></div>
    <section class="sou-urg surface">
      ${urgeStats()}
      ${hourBars()}
      ${us.length >= 3 ? `<div class="sou-urg-n">${I.sparkle}<p>${pr.n} of ${us.length} came between ${pad(pr.from)}:00 and ${pad(pr.to)}:00. That is the window to cover.</p></div>` : ''}
    </section>`;
}
const tally = (key) => { const m = new Map(); U().forEach((u) => m.set(u[key], (m.get(u[key]) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
function tallyHtml(title, key) {
  const rows = tally(key); if (!rows.length) return ''; const max = rows[0][1];
  return `<div class="sou-tal"><p class="sou-tal-h">${title}</p>${rows.slice(0, 4).map(([k, n]) => `<div class="sou-tal-r"><span>${esc(k)}</span><i style="--w:${(n / max).toFixed(2)}"></i><b class="met">${n}</b></div>`).join('')}</div>`;
}
function insightsHtml() {
  const us = U(); if (us.length < 3) return '';
  const pr = peakRange(); const before = tally('before').filter(([k]) => k !== 'Not said')[0]; const where = tally('place').filter(([k]) => k !== 'Not said')[0];
  const bed = ST.locks().find((l) => l.kind === 'bedtime' && l.on);
  const a = avgMins(); const longest = Math.max(0, ...RODE().map((u) => u.mins));
  const helped = RODE().filter((u) => u.did && u.did !== 'Rode it out in Soul').map((u) => u.did);
  return `<div class="sh"><h2>What it shows</h2></div>
    <div class="group sou-ins">
      <div class="row ic"><span class="tile">${I.clock}</span><span class="rbody"><span class="rtitle wrap">Most come ${pad(pr.from)}:00–${pad(pr.to)}:00</span><span class="rmeta sou-wrap">${pr.n} of ${us.length}${where ? `, most often at ${esc(where[0].toLowerCase())}` : ''}.</span></span></div>
      ${before && before[1] >= 2 ? `<${bed ? 'button' : 'div'} class="row ic"${bed ? ' data-act="sou-bed-early"' : ''}><span class="tile">${I.lock}</span><span class="rbody"><span class="rtitle wrap">${esc(before[0])} comes first</span><span class="rmeta sou-wrap">${before[1]} of ${us.length} came right after it.${bed ? ` Start the bedtime lock 15 minutes earlier, at ${bedEarlier(bed)}?` : ''}</span></span>${bed ? '<span class="btn sm tint" style="--c:var(--as-ink)">Move it</span>' : ''}</${bed ? 'button' : 'div'}>` : ''}
      ${a != null ? `<div class="row ic"><span class="tile">${SI.wind}</span><span class="rbody"><span class="rtitle wrap">They pass</span><span class="rmeta sou-wrap">About ${a} minutes when you ride them out. The longest took ${longest}.</span></span></div>` : ''}
      ${helped.length ? `<div class="row ic"><span class="tile">${I.people}</span><span class="rbody"><span class="rtitle wrap">What helped</span><span class="rmeta sou-wrap">${esc([...new Set(helped)].slice(0, 3).join(' · '))}</span></span></div>` : ''}
    </div>`;
}
const bedEarlier = (l) => { const [h, m] = l.start.split(':').map(Number); const t = (h * 60 + m - 15 + 1440) % 1440; return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };
function openUrges() {
  push({
    title: 'Urges', back: 'Clean', aspect: 'soul', cls: 'asp-soul sou-page',
    render(sc) {
      const us = U();
      sc.innerHTML = aspHead({ aspect: { name: 'Clean' } }, { title: 'Urges', sub: 'The last 30 days. Only you and the agent see this.' })
        + `<section class="sou-urg surface">${urgeStats()}${hourBars({ big: true })}</section>`
        + insightsHtml()
        + `<div class="sh"><h2>Around them</h2></div>
        <section class="sou-tals surface">${tallyHtml('Before it', 'before')}${tallyHtml('How you felt', 'feel')}${tallyHtml('Where', 'place')}</section>
        <div class="sh"><h2>The log</h2><span class="sh-count">${us.length}</span></div>
        <div class="group">${us.map((u) => `<div class="row sou-ulog"><span class="sou-ulog-t"><b class="met">${u.at}</b><span>${u.day.split(' ').slice(0, 2).join(' ')}</span></span><span class="rbody"><span class="rtitle">${u.out === 'rode' ? esc(u.did || 'Rode it out') : 'Started again'}</span><span class="rmeta"><span class="ell">${esc(u.place)} · ${esc(u.feel)} · ${esc(u.before)}</span></span></span><span class="rend">${u.out === 'rode' ? (u.mins ? `${u.mins} min` : '') : 'Day 1'}</span></div>`).join('')}</div>`;
      stagger($$('.sou-ulog', sc), { y: 6, each: 25 });
    },
  });
}
on('sou-urges', () => openUrges());
on('sou-bed-early', () => { const l = ST.locks().find((x) => x.kind === 'bedtime' && x.on); if (!l) return; const t = bedEarlier(l); ST.updateLock(l.id, { start: t }); toast(`Bedtime lock moves to ${t} from tonight`, () => ST.updateLock(l.id, { start: l.start })); });

// ── starting again, without shame ────────────────────────────────────────
function resetSheet() {
  const c = CL(); if (!c) return;
  const e = cleanElapsed();
  soulSheet({
    title: 'Start again', sub: 'It happens. What you built still counts.', large: true, cls: 'sou-rss',
    body: `
      <section class="sou-rs-k"><b class="met">${e.d}<small> ${e.d === 1 ? 'day' : 'days'}, ${e.h} h</small></b><p>That run was real and it stays in your record. ${plural(c.year, 'clean day')} this year. Best run ${plural(Math.max(c.best, e.d), 'day')}.</p></section>
      <p class="sou-form-l">When</p>
      <div class="pad">${seg('sou-rs-when', [['now', 'Just now'], ['today', 'Earlier today'], ['yday', 'Yesterday']], 'now')}</div>
      <p class="sou-form-l">What came before it <span>optional, only for the pattern</span></p>
      <div class="chips pad">${['Scrolling', 'Late night', 'Alone', 'Tired', 'Stressed', 'Bored'].map((x) => `<button class="chip" data-act="sou-chip" data-v="${x}">${x}</button>`).join('')}</div>
      <div class="sh"><h2>After this</h2></div>
      <div class="group">
        <div class="row ic"><span class="tile">${I.sparkle}</span><span class="rbody"><span class="rtitle wrap">${esc(who())} won’t bring it up unless you do</span><span class="rmeta sou-wrap">Nothing changes anywhere else in the app but the day number.</span></span></div>
      </div>
      <div class="sou-sheet-acts"><button class="btn block" data-act="sou-rs-go">Start day 1</button></div>`,
  });
}
on('sou-reset', () => resetSheet());
on('sou-chip', (el) => { el.classList.toggle('on'); haptic(4); });
on('sou-rs-go', (el) => {
  const sh = el.closest('.sheet');
  const when = $('[data-seg="sou-rs-when"] [aria-selected="true"]', sh)?.dataset.v ?? 'now';
  const before = $$('.chip.on', sh).map((c) => c.dataset.v);
  const nowMs = ST.nowMs(); const startOfDay = nowMs - ST.nowMin() * 6e4;
  const at = when === 'yday' ? Math.max(CL().sinceMs, startOfDay - 12 * 36e5) : when === 'today' ? Math.max(CL().sinceMs, startOfDay + Math.floor(ST.nowMin() / 2) * 6e4) : nowMs;
  const r = ST.resetClean({ at: new Date(at).toISOString(), before });
  ST.logUrge({ at: new Date(at).toISOString(), out: 'slip', before: before[0] ?? null, did: '' });
  S.arrived = false;
  closeSheet(sh); emit(); S.app?.refresh('clean');
  toast(`Day 1 starts ${when === 'now' ? 'now' : 'from then'}. Your best run stays ${plural(CL()?.best ?? 0, 'day')}`, () => { ST.undoReset(r); S.app?.refresh('clean'); emit(); });
});
on('sou-pledge', () => { ST.updateClean({ pledge: { date: ST.today(), at: new Date(ST.nowMs()).toISOString() } }); haptic(10); S.app?.refresh('clean'); toast('Pledge made for today'); });
on('sou-cl-widget', (el) => { const on1 = !CL()?.widget; ST.updateClean({ widget: on1 }); el.setAttribute('aria-checked', String(on1)); $('.switch', el)?.classList.toggle('on', on1); });

// ── the section ───────────────────────────────────────────────────────────
export function renderClean(el, app) {
  if (!S.unlocked) { el.innerHTML = lockHtml(app); return; }
  const c = CL();
  if (!c) { el.innerHTML = setupHtml(app); return; }
  const e = cleanElapsed();
  const pledged = c.pledge?.date === ST.today();
  el.innerHTML = aspHead(app, { title: esc(c.name), sub: `Since ${fmtDay(cleanSince())}${ST.today() === new Date(c.sinceMs + ST.off() * 6e4).toISOString().slice(0, 10) ? `, ${hhmm(c.sinceMs)}` : ''}`, right: `<button class="sou-ibtn" data-act="sou-lock-clean" aria-label="Lock Clean">${I.lock}</button>` })
    + heroHtml()
    + `<div class="group sou-pledge">
        ${pledged ? `<div class="row ic"><span class="tile sou-tile-ok">${I.check}</span><span class="rbody"><span class="rtitle">Today’s pledge</span><span class="rmeta"><span class="ell">Made at ${Number.isFinite(Date.parse(c.pledge.at)) ? hhmm(Date.parse(c.pledge.at)) : esc(String(c.pledge.at ?? ""))}</span></span></span></div>`
          : `<button class="row ic" data-act="sou-pledge"><span class="tile">${SI.seedling}</span><span class="rbody"><span class="rtitle">Make today’s pledge</span><span class="rmeta"><span class="ell">Just for today. One tap.</span></span></span>${I.chevR}</button>`}
        <button class="row ic" data-act="sou-urge"><span class="tile asp-tile">${SI.wind}</span><span class="rbody"><span class="rtitle">If the pull gets strong</span><span class="rmeta"><span class="ell">The round button below, on every Soul screen</span></span></span>${I.chevR}</button>
        <button class="row ic" data-act="sou-talk"><span class="tile">${I.sparkle}</span><span class="rbody"><span class="rtitle">Talk it through with ${esc(who())}</span><span class="rmeta"><span class="ell">It stays between the two of you</span></span></span>${I.chevR}</button>
      </div>`
    + milestonesHtml() + stagesHtml() + reasonsHtml() + urgesCard()
    + `<div class="sh"><h2>Your record</h2></div>
      <div class="group">
        <div class="row ic"><span class="tile">${SI.seedling}</span><span class="rbody"><span class="rtitle">${plural(c.year, 'clean day')} this year</span><span class="rmeta"><span class="ell">Best run ${plural(Math.max(c.best, e.d), 'day')} · this one ${e.d}</span></span></span></div>
        <button class="row ic" data-act="sou-reset"><span class="tile">${I.rewind}</span><span class="rbody"><span class="rtitle">Start again</span><span class="rmeta"><span class="ell">If you slipped. No judgement, and nothing you built is lost.</span></span></span>${I.chevR}</button>
        <button class="row ic" data-act="sou-cl-widget" role="switch" aria-checked="${!!c.widget}"><span class="tile">${SI.chain}</span><span class="rbody"><span class="rtitle">“${esc(ST.cleanText())}” on widgets</span><span class="rmeta"><span class="ell">Home screen only, never the lock screen</span></span></span><span class="switch${c.widget ? ' on' : ''}" aria-hidden="true"></span></button>
      </div>
      <p class="hint">Locked with Face ID. Outside this tab it only ever shows “${esc(ST.cleanText())}”.</p>`;
  if (!S.arrived) stagger($$('.sou-ms-i', el), { y: 8, scale: 0.9, each: 40, delay: 260 });
  S.arrived = true;
  startClock();
}
on('sou-urge', () => openSteady());
on('sou-talk', () => api.askAgent('', { aspect: 'soul', about: 'clean' }));

// ── the urge flow: breathe, remember why, one thing that helps, a calm close ──
const BREATH = 60;   // seconds: six slow breaths, in 4, hold 1, out 5
export function openSteady({ from } = {}) {
  closeSheet(); // one overlay at a time
  const sheet = soulSheet({
    large: true, cls: 'sou-steady stay-dark',
    head: `<div class="sheet-head sou-st-head"><div class="sh-text"><h3>Ride it out</h3><p>${from === 'blocker' ? 'A minute before the decision' : 'One minute, then what helps'}</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: '<div class="sou-st" data-step="breathe"></div>',
    onClose() { clearInterval(sheet?._br); },
  });
  sheet._from = from; sheet._t0 = performance.now();
  stepBreathe(sheet);
}
function stepBreathe(sheet) {
  const st = $('.sou-st', sheet); st.dataset.step = 'breathe';
  const a = avgMins(); const n = U().length;
  st.innerHTML = `
    <div class="sou-br">
      ${ring(0, 'as', 264, 4, { cls: 'sou-br-ring', label: 'One minute of breathing' })}
      <span class="sou-br-o" aria-hidden="true"></span>
      <span class="sou-br-t" aria-live="polite"><b class="sou-br-p">Breathe in</b><span class="met sou-br-n">4</span></span>
    </div>
    <p class="sou-st-f">An urge rises, peaks and passes, like a wave.${a != null && n >= 3 ? ` Yours pass in about ${a} minutes, and you have ridden out ${RODE().length} of the last ${n}.` : ' Most pass within minutes.'}</p>
    <div class="sou-st-a"><button class="btn block" data-act="sou-st-reasons">Skip to ${CL()?.reasons.length ? 'my reasons' : 'what helps'}</button></div>`;
  const t0 = performance.now();
  const o = $('.sou-br-o', st); o.classList.add('go');
  const rg = $('.sou-br-ring', st);
  let last = '';
  clearInterval(sheet._br);
  sheet._br = setInterval(() => {
    if (!sheet.isConnected) { clearInterval(sheet._br); return; }
    const t = (performance.now() - t0) / 1000;
    if (t >= BREATH) { clearInterval(sheet._br); stepReasons(sheet, true); return; }
    const ph = t % 10;
    const [label, k] = ph < 4 ? ['Breathe in', 4 - Math.floor(ph)] : ph < 5 ? ['Hold', 1] : ['Breathe out', 5 - Math.floor(ph - 5)];
    const p = $('.sou-br-p', st); if (p && p.textContent !== label) p.textContent = label;
    if (label !== last) { last = label; haptic(label === 'Hold' ? 4 : 8); }   // a soft tap at each turn of the breath
    const nn = $('.sou-br-n', st); if (nn) nn.textContent = k;
    rg?.style.setProperty('--rp', (t / BREATH).toFixed(4));
  }, 100);
}
function stepReasons(sheet, breathed) {
  clearInterval(sheet._br);
  const st = $('.sou-st', sheet); st.dataset.step = 'reasons';
  const c = CL(); const e = c ? cleanElapsed() : null;
  const apps = ST.locks()[0]?.apps?.join(', ') || null;
  st.innerHTML = `
    <div class="sou-st-in">
      <p class="sou-st-k">${breathed ? 'One minute done. ' : ''}${e ? `${plural(e.d, 'day')}, ${plural(e.h, 'hour')}. ` : ''}${c?.reasons.length ? 'Remember why.' : 'You’re still here.'}</p>
      ${c?.reasons.length ? `<ul class="sou-st-rs">${c.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      <div class="sh"><h2>What helps right now</h2></div>
      <div class="group sou-st-g">
        <button class="row ic" data-act="sou-st-call"><span class="tile">${I.phone}</span><span class="rbody"><span class="rtitle">Call ${esc(who())}</span><span class="rmeta"><span class="ell">She picks up now, and it stays between you</span></span></span>${I.chevR}</button>
        <button class="row ic" data-act="sou-st-walk"><span class="tile">${SI.walk}</span><span class="rbody"><span class="rtitle">Walk for ten minutes</span><span class="rmeta"><span class="ell">Leave the phone behind</span></span></span>${I.chevR}</button>
        <button class="row ic" data-act="sou-st-people"><span class="tile">${I.people}</span><span class="rbody"><span class="rtitle">Go where people are</span><span class="rmeta"><span class="ell">The shop floor, the kitchen, a chai stall</span></span></span>${I.chevR}</button>
        <button class="row ic" data-act="sou-st-water"><span class="tile">${SI.drop}</span><span class="rbody"><span class="rtitle">Cold water on your face</span><span class="rmeta"><span class="ell">Thirty seconds slows the body down</span></span></span>${I.chevR}</button>
        ${apps ? `<button class="row ic" data-act="sou-st-lock"><span class="tile">${I.lock}</span><span class="rbody"><span class="rtitle">Lock ${esc(apps)} for an hour</span><span class="rmeta"><span class="ell">One tap, no talk needed</span></span></span>${I.chevR}</button>` : ''}
      </div>
    </div>
    <div class="sou-st-a"><button class="btn primary block" style="--c:var(--as-fill)" data-act="sou-st-passed">It passed</button><button class="btn block sou-st-slip" data-act="sou-st-slip">I slipped</button></div>`;
  $('.sheet-body', sheet).scrollTop = 0;
  stagger($$('.sou-st-rs li, .sou-st-g .row', st), { y: 8, each: 45 });
}
function stepWalk(sheet) {
  const st = $('.sou-st', sheet); st.dataset.step = 'walk';
  const until = new Date(now().getTime() + 10 * 6e4);
  st.innerHTML = `
    <div class="sou-walk">
      ${ring(1, 'as', 200, 9, { cls: 'sou-walk-r', inner: `<span class="sou-walk-c"><b class="met" data-sou-walk>10:00</b><span>walk</span></span>` })}
      <p class="sou-st-k">Back at ${hhmm(until)}.</p>
      <p class="sou-st-f">Leave the phone on the table. The urge will be smaller when you’re back.</p>
    </div>
    <div class="sou-st-a"><button class="btn primary block" style="--c:var(--as-fill)" data-act="sou-st-passed">I’m back, it passed</button><button class="btn block" data-act="sou-st-reasons">Not yet</button></div>`;
  const total = 10 * 6e4;
  onTick(() => {
    const el = $('[data-sou-walk]', st); if (!el || !st.isConnected || st.dataset.step !== 'walk') return false;
    const ms = Math.max(0, until - now()); const s = Math.ceil(ms / 1000);
    el.textContent = `${Math.floor(s / 60)}:${pad(s % 60)}`;
    setRing($('.sou-walk-r', st), ms / total, { bleed: false });
    return ms > 0;
  });
}
function stepDone(sheet) {
  const st = $('.sou-st', sheet); st.dataset.step = 'done';
  const sel = { place: null, feel: null, before: null };
  sheet._log = sel;
  st.innerHTML = `
    <div class="sou-done">
      ${ring(1, 'as', 96, 9, { cls: 'sou-done-r', inner: `<span class="sou-done-g">${I.check}</span>` })}
      <h2 class="title2">You rode it out</h2>
      <p class="sub">${U().length ? `${RODE().length + 1} of ${U().length + 1} now. ` : ''}Two taps, so ${esc(who())} learns what comes before them.</p>
    </div>
    ${Object.entries({ place: 'Where', feel: 'How you felt', before: 'Before it' }).map(([k, label]) => `<p class="sou-form-l">${label}</p><div class="chips pad" data-k="${k}">${URGE_CHIPS[k].map((c) => `<button class="chip" data-act="sou-log-chip" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>`).join('')}
    <div class="sou-st-a"><button class="btn primary block" style="--c:var(--as-fill)" data-act="sou-log-save">Save</button><button class="btn block" data-act="sou-log-skip">Skip</button></div>`;
  pulse(st);
  $('.sheet-body', sheet).scrollTop = 0;
}
on('sou-st-reasons', (el) => stepReasons(el.closest('.sheet'), false));
on('sou-st-call', (el) => { closeSheet(el.closest('.sheet')); api.startCall({ why: 'You asked to talk' }); });
on('sou-st-walk', (el) => stepWalk(el.closest('.sheet')));
on('sou-st-people', () => toast('Go now. Leave the phone in your pocket'));
on('sou-st-water', () => toast('Go. Thirty seconds, cold as it comes'));
on('sou-st-lock', () => { const l = ST.lockFor(60, ST.locks()[0]?.apps ?? []); emit(); haptic(10); toast(`${(l.apps ?? []).join(', ') || 'Apps'} locked till ${hhmm(Date.parse(l.until))}`, () => ST.endNowLock()); });
on('sou-st-passed', (el) => { haptic(12); stepDone(el.closest('.sheet')); });
on('sou-st-slip', (el) => {
  closeSheet(el.closest('.sheet'));
  if (CL()) { setTimeout(resetSheet, 220); return; }
  ST.logUrge({ out: 'slip' }); toast('Logged. It happens; the next one is a new start');
});
on('sou-log-chip', (el) => {
  const box = el.closest('[data-k]'); const sheet = el.closest('.sheet');
  const on1 = !el.classList.contains('on');            // one choice per row; tap again to clear it
  $$('.chip', box).forEach((c) => c.classList.toggle('on', on1 && c === el));
  if (sheet._log) sheet._log[box.dataset.k] = on1 ? el.dataset.v : null;
  haptic(4);
});
function saveUrge(sheet, l = {}) {
  ST.logUrge({ place: l.place ?? null, feel: l.feel ?? null, before: l.before ?? null, did: 'Rode it out in Soul', out: 'rode', mins: Math.max(1, Math.round((performance.now() - (sheet._t0 ?? performance.now())) / 6e4)) });
  closeSheet(sheet);
  if (S.unlocked) S.app?.refresh('clean');
}
on('sou-log-save', (el) => { const sheet = el.closest('.sheet'); saveUrge(sheet, sheet._log ?? {}); toast(`Logged. ${RODE().length} of ${U().length} ridden out`); });
on('sou-log-skip', (el) => { saveUrge(el.closest('.sheet')); });
