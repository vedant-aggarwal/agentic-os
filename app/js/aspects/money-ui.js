// Money's shared pieces: its own glyphs (the same 2px line as js/icons.js), rows, the agent's card and small helpers.
// Owner: the Money agent. Classes are prefixed mon-; css/aspects/money.css styles them.
import { esc, push, openSheet } from '../core.js';
import { I } from '../icons.js';
import { AGENT } from '../data.js';
import { fmt, inr, cat, incat, dayName, dayLabel, upiMessage, MONTH } from './money-data.js';

const s = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const MI = {
  cup: s('<path d="M5 9.5h11v4.4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 11h1.1a2.4 2.4 0 0 1 0 4.8H16"/><path d="M8.6 3.4v2.8M12.2 3v3.2"/>'),
  car: s('<path d="M4.8 17.2H4a1 1 0 0 1-1-1v-3a2 2 0 0 1 .4-1.2L6 8.4A2 2 0 0 1 7.6 7.6h8.8a2 2 0 0 1 1.6.8l2.6 3.6a2 2 0 0 1 .4 1.2v3a1 1 0 0 1-1 1h-.8"/><path d="M9.2 17.2h5.6M3.4 12.6h17.2"/><circle cx="7" cy="17.2" r="2.1"/><circle cx="17" cy="17.2" r="2.1"/>'),
  bag: s('<path d="M5.4 8.2h13.2l-1 11.3a1.6 1.6 0 0 1-1.6 1.5H8a1.6 1.6 0 0 1-1.6-1.5z"/><path d="M9 10.6V7.1a3 3 0 0 1 6 0v3.5"/>'),
  cap: s('<path d="m2.6 9.6 9.4-4.5 9.4 4.5-9.4 4.5z"/><path d="M6.5 11.7v4.1c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.1M21.4 9.6v5"/>'),
  ticket: s('<path d="M4 7.6A1.6 1.6 0 0 1 5.6 6h12.8A1.6 1.6 0 0 1 20 7.6V10a2 2 0 0 0 0 4v2.4a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 16.4V14a2 2 0 0 0 0-4z"/><path d="M14.6 6.4v1.8M14.6 11.1v1.8M14.6 15.8v1.8"/>'),
  repeat: s('<path d="m16.8 2.9 3 3-3 3"/><path d="M19.8 5.9H8.6A4.6 4.6 0 0 0 4 10.5v.6"/><path d="m7.2 21.1-3-3 3-3"/><path d="M4.2 18.1h11.2a4.6 4.6 0 0 0 4.6-4.6v-.6"/>'),
  wallet: s('<path d="M17 8V6.3A1.3 1.3 0 0 0 15.7 5H6.6A2.6 2.6 0 0 0 4 7.6"/><rect x="4" y="8" width="16.5" height="11.5" rx="2.6"/><path d="M20.5 11.8H17a1.9 1.9 0 0 0 0 3.8h3.5"/>'),
  bank: s('<path d="M3.4 9.2 12 4.6l8.6 4.6"/><path d="M5.6 10.4v6.8M9.9 10.4v6.8M14.1 10.4v6.8M18.4 10.4v6.8M3.4 20.2h17.2"/>'),
  card: s('<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M3 10.2h18M7 14.6h3.2"/>'),
  phone: s('<rect x="6.8" y="2.8" width="10.4" height="18.4" rx="2.7"/><path d="M10.6 17.7h2.8"/>'),
  dollar: s('<path d="M12 3v18"/><path d="M16.4 7.6c-.7-1.4-2.4-2.3-4.4-2.3-2.6 0-4.4 1.3-4.4 3.3 0 4.3 9 2.6 9 7 0 2-1.9 3.3-4.6 3.3-2.1 0-3.9-.9-4.6-2.4"/>'),
  chart: s('<path d="M7.2 3.8v3.1M7.2 15.3V20M16.8 3.8V9M16.8 16.4v3.8"/><rect x="5" y="6.9" width="4.4" height="8.4" rx="1.2"/><rect x="14.6" y="9" width="4.4" height="7.4" rx="1.2"/>'),
  drop: s('<path d="M12 3.4s-6 6.5-6 10.7a6 6 0 0 0 12 0c0-4.2-6-10.7-6-10.7Z"/>'),
  inflow: s('<path d="M12 3.6v10.8M7.6 10l4.4 4.4 4.4-4.4"/><path d="M4.4 15.2v2.4A2.5 2.5 0 0 0 6.9 20h10.2a2.5 2.5 0 0 0 2.5-2.4v-2.4"/>'),
  receipt: s('<path d="M6 3.4h12v17.2l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 8h6M9 11.5h6M9 15h3.4"/>'),
  split: s('<path d="M12 20.6v-6a3 3 0 0 0-.9-2.1L5.6 7M12 14.6a3 3 0 0 1 .9-2.1L18.4 7"/><path d="M5.6 11.2V7h4.2M18.4 11.2V7h-4.2"/>'),
  back: s('<path d="M9.3 5.6h9.2a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H9.3a2 2 0 0 1-1.5-.7L3.5 12l4.3-5.7a2 2 0 0 1 1.5-.7Z"/><path d="m11.6 9.5 4.9 5M16.5 9.5l-4.9 5"/>', 'stroke-width="1.9"'),
  piggy: s('<path d="M5.5 11.5A6.5 5.5 0 0 1 12 6h1.5a6.5 5.5 0 0 1 6 3.4l1.3.1v3.4l-1.6.4A6.3 6.3 0 0 1 17 16.5V19h-2.4l-.6-1.6a8 8 0 0 1-3.6 0L9.8 19H7.4v-2.6a5.4 5.4 0 0 1-1.9-4.9Z"/><path d="M10 6.2A2.5 2.5 0 0 1 12.4 3.4"/><circle cx="15.6" cy="10.6" r=".6" fill="currentColor"/>'),
  pause: s('<path d="M9 5.5v13M15 5.5v13"/>', 'stroke-width="2.4"'),
  // the app's own tab glyphs: the day's money, the budget split, money in and out, what you're worth
  pie: s('<path d="M12 3.4a8.6 8.6 0 1 0 8.6 8.6H12z"/><path d="M15.2 3.9a8.6 8.6 0 0 1 4.9 4.9h-4.9z"/>'),
  io: s('<path d="M7.6 19.8V5.2M4.2 8.6l3.4-3.4L11 8.6M16.4 4.2v14.6M13 15.4l3.4 3.4 3.4-3.4"/>'),
};
export const G = (name) => MI[name] ?? I[name] ?? I.tag;
export const tile = (name, cls = '') => `<span class="tile ${cls}" aria-hidden="true">${G(name)}</span>`;
export const catTile = (id, cls = '') => tile(id === 'bill' ? 'repeat' : cat(id).icon, cls);

// a counted figure: the ₹ stays put, the number counts up when the page opens (core.js pulse)
export const fig = (n, { count = true, sign = '' } = {}) =>
  `${sign}<span class="mon-c">₹</span>${count ? `<span data-count="${Math.round(Math.abs(n))}">${fmt(n)}</span>` : `<span>${fmt(n)}</span>`}`;

// who logged a row: the agent from a UPI message, a scan, him, something he told her, a statement, Siri, a client ledger
export const SRC = {
  upi: ['chat', `UPI · ${AGENT.name}`], scan: ['scan', 'Scanned'], you: ['edit', 'You'], told: ['mic', `Told ${AGENT.name}`],
  statement: ['doc', `Statement · ${AGENT.name}`], bill: ['repeat', 'Recurring'], siri: ['mic', 'Siri'], northwind: ['rocket', 'Northwind ledger'], cli: ['edit', 'From the PC'],
};
export const srcChip = (by, pay) => { const [g, label] = SRC[by] ?? SRC.you; return `<small class="mon-src">${G(g)}${label}${by === 'you' && pay === 'cash' ? ' · cash' : ''}</small>`; };

// one transaction as a row: category glyph, merchant, what · when · who logged it, amount
export function txRow(t, { day = false } = {}) {
  const meta = [day ? dayLabel(t.date) : null, t.t, t.split ? (t.share ? `half of ${inr(t.a)}` : `lent · ${esc(t.splitName ?? '')}`) : null, t.note && esc(t.note)].filter(Boolean).join(' · ');
  return `<button class="row ic mon-tx" data-act="mon-tx" data-id="${t.id}">
    ${catTile(t.c)}
    <span class="rbody"><span class="rtitle">${esc(t.m)}</span><span class="rmeta"><span class="ell">${meta}</span></span></span>
    <span class="rend mon-rend"><span class="mon-amt">${inr(t.share)}</span>${srcChip(t.by, t.pay)}</span></button>`;
}
export const incomeRow = (x) => `<button class="row ic mon-tx" data-act="mon-intx" data-id="${x.id}">
    ${tile(incat(x.src).icon, 'mon-in-tile')}
    <span class="rbody"><span class="rtitle">${esc(x.name)}</span><span class="rmeta"><span class="ell">${[x.from && esc(x.from), dayLabel(x.date), x.t].filter(Boolean).join(' · ')}</span></span></span>
    <span class="rend mon-rend"><span class="mon-amt c-as">+${inr(x.a)}</span>${srcChip(x.by)}</span></button>`;

// a section header in the system's .sh form
export const sh = (title, { count = '', act = '', label = 'See all', id = '' } = {}) =>
  `<div class="sh"><h2>${title}</h2>${count !== '' ? `<span class="sh-count">${count}</span>` : ''}${act ? `<button class="sh-act" data-act="${act}"${id ? ` data-id="${id}"` : ''}>${label}${I.chevR}</button>` : ''}</div>`;

// the agent, inside Money: what she did or noticed here, with at most two actions. Not a chat; the ✦ button is the chat
export const wynCard = ({ at = '', text, acts = [], cls = '', id = '' }) => `
  <section class="mon-wyn surface ${cls}"${id ? ` data-wyn="${id}"` : ''}>
    <div class="mon-wyn-h"><span class="mon-orb" aria-hidden="true">${I.sparkle}</span><b>${esc(AGENT.name)}</b>${at ? `<span class="mon-wyn-at num">${at}</span>` : ''}</div>
    <p class="mon-wyn-t">${text}</p>
    ${acts.length ? `<div class="mon-wyn-acts">${acts.map(([label, act, extra = '', tint]) => `<button class="btn ${tint ? 'tint' : ''}" data-act="${act}" ${extra}${tint ? ' style="--c:var(--as-ink)"' : ''}>${label}</button>`).join('')}</div>` : ''}
  </section>`;

// the large title of a page pushed from inside Money (the same markup as aspHead, so it reads as one app)
export const pageHead = ({ title, sub = '', kicker = 'Money', right = '' }) => `
  <div class="phead asp-head">
    <div class="asp-head-l"><p class="kicker c-as">${kicker}</p><h1 class="lt">${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
    ${right ? `<div class="asp-head-r">${right}</div>` : ''}
  </div>`;
export const pushMoney = ({ title, back = 'Money', render, right = '', cls = '', onPop }) =>
  push({ title, back, aspect: 'money', cls: `mon-page ${cls}`, right, render, onPop });

// the original message, for trust: what she read when she logged it
export const rawMessage = (t) => {
  const msg = upiMessage(t);
  if (!msg) return '';
  return `<div class="mon-raw"><p class="mon-raw-k">${I.chat}<span>The UPI message ${esc(AGENT.name)} read${t.t ? ` · ${t.t}` : ''}</span></p><p class="mon-raw-t">${esc(msg)}</p></div>`;
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// every Money sheet wears Money's colour: sheets live outside the app's page, so they carry data-aspect themselves
export const monSheet = (o) => { const el = openSheet(o); el.dataset.aspect = 'money'; return el; };
export const pct = (p) => `${Math.round(p * 100)}%`;
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const monthDay = (d) => `${d} ${MONTH.short}`;
// an empty state in Money's own words, with one way forward
export const emptyRow = (title, meta, act = '', label = '') => `<div class="row mon-empty"><span class="rbody"><span class="rtitle">${title}</span>${meta ? `<span class="rmeta mon-wrap">${meta}</span>` : ''}</span>${act ? `<button class="btn sm tint" data-act="${act}" style="--c:var(--as-ink)">${label}</button>` : ''}</div>`;
