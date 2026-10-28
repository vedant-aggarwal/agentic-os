// Friends: UI state, glyphs and the small pieces every Friends screen and sheet shares. Owner: the PEOPLE agent.
// Data comes from the people store (friends-data.js / people-store.js); S holds only what the screen remembers.
import { esc } from '../core.js';
import { I } from '../icons.js';
import { AGENT } from '../data.js';
import * as P from './people-store.js';
import { KIND, FROM, today, daysBetween, when, dayLabel, weekday, shiftIso, moments } from './friends-data.js';

// ── glyphs this app needs that js/icons.js doesn't have (same 24 grid, 2px line, round caps) ──
const sv = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const G = {
  seed: sv('<path d="M12 20.5V13"/><path d="M12 13C8.2 13 5.5 10.7 5.5 6.6c4 0 6.5 2.4 6.5 6.4Z"/><path d="M12 11.2c0-3.7 2.3-5.9 6.5-5.9 0 3.8-2.5 5.9-6.5 5.9Z"/><path d="M8.5 20.5h7"/>'),
  moments: sv('<rect x="3.5" y="7.2" width="13.3" height="13.3" rx="3.2"/><path d="M8 3.5h9.3a3.2 3.2 0 0 1 3.2 3.2V16"/><circle cx="8.4" cy="11.6" r="1.3"/><path d="m6.6 17.5 3-2.9 2 1.9 1.6-1.4 1.6 1.6"/>'),
  bowl: sv('<path d="M6.5 3v5.6a2.2 2.2 0 0 0 4.4 0V3M8.7 3v18"/><path d="M17.5 21V3c-2.1 1.1-3.4 3.6-3.4 6.6 0 1.9.8 3.3 2.2 3.8h1.2"/>'),
  car: sv('<path d="M5.2 16.6H4a.5.5 0 0 1-.5-.5v-3.4c0-.3.1-.6.2-.9l1.9-3.7a2 2 0 0 1 1.8-1.1h9.2a2 2 0 0 1 1.8 1.1l1.9 3.7c.1.3.2.6.2.9v3.4a.5.5 0 0 1-.5.5h-1.2"/><path d="M9.1 16.6h5.8M4 11.6h16"/><circle cx="7.1" cy="16.6" r="1.9"/><circle cx="16.9" cy="16.6" r="1.9"/>'),
  cup: sv('<path d="M4.5 9.2h11v4.9a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5Z"/><path d="M15.5 10.6h1.2a2.4 2.4 0 0 1 0 4.8h-1.5"/><path d="M8.4 3.8c-.8 1 .8 1.7 0 2.8M11.9 3.8c-.8 1 .8 1.7 0 2.8"/>'),
  bell: sv('<path d="M6.2 16.4V11a5.8 5.8 0 0 1 11.6 0v5.4l1.4 1.6H4.8z"/><path d="M10.2 20.6a1.9 1.9 0 0 0 3.6 0"/>'),
  walk: sv('<circle cx="13.5" cy="4.6" r="1.7"/><path d="m10 21 2.2-5.4-2.6-2.4.9-4.4 4.1 2.8 2.9.4"/><path d="m10.5 8.8-3 1.7-.8 3.2M12.2 15.6l3 1.4.8 4"/>'),
  hours: sv('<circle cx="12" cy="12.8" r="7.7"/><path d="M12 8.6v4.2l2.7 1.7M9.5 2.8h5"/>'),
  quote: sv('<path d="M9.5 7.5H6.8A2.3 2.3 0 0 0 4.5 9.8v2.5h5V7.5Zm0 4.8c0 2.6-1.4 4.1-4 4.7M19.5 7.5h-2.7a2.3 2.3 0 0 0-2.3 2.3v2.5h5V7.5Zm0 4.8c0 2.6-1.4 4.1-4 4.7"/>'),
};
export const ACT_ICON = { food: G.bowl, gym: I.dumbbell, drive: G.car, film: I.film, chai: G.cup, walk: G.walk };
export const ACT_NAME = { food: 'Food', gym: 'Gym', drive: 'A drive', film: 'A film', chai: 'Chai', walk: 'A walk' };
export const KIND_ICON = { meet: I.people, call: I.phone, chat: I.chat };
export const FROM_ICON = { screenshot: I.scan, share: I.share, said: I.mic, calendar: I.cal, typed: I.edit };

// ── what the screen remembers (filters, the weekly pick, the message tone); data lives in the store ──
export const S = { kind: 'all', who: null, pick: new Set(), tone: 'hinglish', _orbitFrom: null };

// one place that tells every open Friends screen to redraw: the store's changes, and local ones (filters)
const subs = new Set();
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const changed = (what = {}) => subs.forEach((fn) => { try { fn(what); } catch (e) { console.error('[friends] refresh failed', e); } });
P.onPeople(({ kinds }) => { if ([...kinds].some((k) => ['persons', 'moments', 'plans', 'rhythms', 'dates', 'drafts', 'state', 'ideas'].includes(k))) changed({ store: kinds }); });

// ── people ──
export function who(id) { const p = P.person(id); return p ? { ...p } : { id, name: id }; }
export const nameOf = (id) => P.nameOf(id) || id;
export const namesOf = (ids) => P.namesOf(ids);
const pron = (id) => { const p = P.person(id)?.pronoun; return p === 'she' ? ['she', 'her', 'her'] : p === 'he' ? ['he', 'him', 'his'] : ['they', 'them', 'their']; };
export const his = (id) => pron(id)[2];
export const him = (id) => pron(id)[1];

// A monogram on the app's colour. lit: the solid fill (a friend who's warm); otherwise the tint.
export const av = (id, size = 40, cls = '') => `<span class="fri-av ${cls}" style="--av:${size}px" aria-hidden="true">${esc((nameOf(id) || '?').trim()[0]?.toUpperCase() ?? '?')}</span>`;

// a day like a calendar leaf: weekday over the date
export const dateTile = (iso) => `<span class="fri-leaf" aria-hidden="true"><span>${weekday(iso)}</span><b class="met">${Number(iso.slice(8))}</b></span>`;

// ── moments ──
export const sourceLine = (m) => (m.by === 'you' ? FROM.typed : `${AGENT.name}, ${FROM[m.from] ?? 'from what you told her'}`);
export function momentTitle(m) { return m.title || `${KIND[m.kind]} with ${namesOf(m.people)}`; }

// the shared chat, drawn small: a WhatsApp screenshot is never shown as an image here, only what the agent read from it
export const chatThumb = (m, big = false) => !m.chat ? '' : `
  <span class="fri-chat${big ? ' big' : ''}" role="img" aria-label="The chat ${esc(AGENT.name)} read: ${esc(m.chat.map(([, t]) => t).join(' / '))}">
    <span class="fri-chat-h">${esc(nameOf(m.people[0]))} · WhatsApp</span>
    ${m.chat.map(([w, t]) => `<span class="fri-bub ${w}">${esc(t)}</span>`).join('')}
  </span>`;

export function momentCard(m, { compact = false } = {}) {
  const lead = m.people.length > 1 ? `<span class="fri-avs">${m.people.slice(0, 2).map((p) => av(p, 30)).join('')}</span>` : av(m.people[0], 36);
  return `<button class="fri-mom surface${compact ? ' compact' : ''}" data-act="fri-moment" data-id="${m.id}">
    <span class="fri-mom-av">${lead}</span>
    <span class="fri-mom-b">
      <span class="fri-mom-top"><span class="fri-mom-t">${esc(momentTitle(m))}</span><span class="fri-mom-time num">${esc(compact ? when(m.date) : m.time)}</span></span>
      ${m.text ? `<span class="fri-mom-x">${esc(m.text)}</span>` : ''}
      ${compact ? '' : chatThumb(m)}
      <span class="fri-src">${KIND_ICON[m.kind] ?? I.people}<span>${esc(KIND[m.kind] ?? 'Moment')}${m.act ? ` · ${esc((m.acts ?? [m.act]).map((a, i) => i ? (ACT_NAME[a] ?? a).toLowerCase() : (ACT_NAME[a] ?? a)).join(' and '))}` : ''}</span><i aria-hidden="true">·</i>${m.by === 'wyn' ? I.sparkle : I.edit}<span class="ell">${esc(sourceLine(m))}</span></span>
      ${m.loop && !compact ? `<span class="fri-loop">${I.clock}<span>Open: ${esc(m.loop)}</span></span>` : ''}
    </span>
  </button>`;
}

// ── keep warm: the last 8 weeks with a friend, read from the moments (the last is this week) ──
export function weeksWith(id) {
  const w0 = P.mondayOf(today());
  return Array.from({ length: 8 }, (_, i) => {
    const w = P.addDays(w0, 7 * (i - 7)), end = shiftIso(w, 6);
    const ms = moments({ person: id, from: w, to: end });
    const state = ms.some((m) => m.kind === 'meet') ? 'meet' : ms.length ? 'talk' : i === 7 ? 'now' : 'none';
    return { w, state, label: dayLabel(w).replace(/^\w+ /, '') };
  });
}

// the moments in a month, for the at-a-glance calendar
export function monthDays(iso = today()) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
  const first = new Date(Date.UTC(y, m - 1, 1)); const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;     // Monday-start
  const out = [];
  const all = moments({ from: `${iso.slice(0, 7)}-01`, to: `${iso.slice(0, 7)}-31` });
  for (let i = 0; i < lead; i++) out.push(null);
  for (let d = 1; d <= n; d++) {
    const day = `${iso.slice(0, 7)}-${String(d).padStart(2, '0')}`;
    const ms = all.filter((x) => x.date === day);
    out.push({ d, iso: day, meet: ms.some((x) => x.kind === 'meet'), talk: ms.some((x) => x.kind !== 'meet'), today: day === today(), future: daysBetween(day) < 0, n: ms.length });
  }
  return out;
}
