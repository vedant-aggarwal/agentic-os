// Instant search on the phone: words, a person, a day and a place, over the Brain's notes already on the phone, so
// results appear with the first letter and work offline. The PC's answer (meaning through Ollama, his vault through the
// brain CLI, the same rules on every note) replaces it a moment later. Owner: BRAIN. Pure, no DOM except markHtml.
import { esc } from './core.js';
import { PEOPLE } from './data.js';
import * as clock from './svc/clock.js';

const STOP = new Set(('what did i we save saved about the from at in on my me show all things thing notes note anything any is was to for of a an and with do does have has had it that this ' +
  'there who where when which how tell find search look up get give everything something stuff kya ka ki ke se mein hai tha today yesterday week month last since ago').split(' '));
export const WHEN = [['any', 'Any time'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month']];
// the places the app knows by name; a note's place is free text matched by any of the words
export const PLACES = { shop: { label: 'The shop', words: ['morgan & co', 'the store', 'shop', 'dukaan'] }, home: { label: 'Midtown', words: ['midtown', 'home', 'ghar'] }, college: { label: 'City College', words: ['city college', 'college'] }, gym: { label: 'The gym', words: ['gym'] } };
export const placeKey = (s) => { const p = String(s ?? '').toLowerCase(); for (const [k, v] of Object.entries(PLACES)) if (v.words.some((w) => p.includes(w))) return k; return null; };

function windowOf(key) {
  const t = clock.today(), day = (d) => clock.dayStart(d);
  if (key === 'today') return [day(t), day(clock.addDays(t, 1))];
  if (key === 'yesterday') return [day(clock.addDays(t, -1)), day(t)];
  if (key === 'week') { const dow = clock.dparts(t).dow; const mon = clock.addDays(t, -((dow + 6) % 7)); return [day(mon), day(clock.addDays(t, 1))]; }
  if (key === 'month') return [day(`${t.slice(0, 7)}-01`), day(clock.addDays(t, 1))];
  return null;
}
/** What a question asks for: { terms, when, place, person }. */
export function parse(q) {
  const s = ` ${String(q ?? '').toLowerCase().replace(/[?!.,]/g, ' ')} `;
  const when = /\btoday\b|\baaj\b/.test(s) ? 'today' : /\byesterday\b/.test(s) ? 'yesterday' : /\bthis week\b|\blast few days\b/.test(s) ? 'week' : /\bthis month\b/.test(s) ? 'month' : null;
  let place = null;
  for (const [k, v] of Object.entries(PLACES)) if (v.words.some((w) => new RegExp(`\\b(at|from|in) (the )?${w}\\b`).test(s) || (w.length > 4 && s.includes(` ${w} `)))) { place = k; break; }
  const who = PEOPLE.find((p) => new RegExp(`(^|[^a-z])${p.name.toLowerCase()}([^a-z]|$)`).test(s));
  const drop = new Set([...(place ? PLACES[place].words.flatMap((w) => w.split(' ')) : []), ...(who ? [who.name.toLowerCase(), who.id] : [])]);
  const terms = [...new Set(s.split(/[^\p{L}\p{N}₹&]+/u).filter((w) => w.length > 1 && !STOP.has(w) && !drop.has(w)))].slice(0, 10);
  return { terms, when, place, person: who?.id ?? null };
}
export function marks(text, terms) {
  const s = String(text ?? '').toLowerCase(); const out = [];
  for (const t of terms) { let i = s.indexOf(t); while (i >= 0 && out.length < 30) { out.push([i, i + t.length]); i = s.indexOf(t, i + t.length); } }
  out.sort((a, b) => a[0] - b[0]);
  const m = []; for (const x of out) { const l = m[m.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else m.push([...x]); }
  return m;
}
/** Escaped text with <mark> round each hit. */
export function markHtml(text, mk = []) {
  const t = String(text ?? ''); if (!mk?.length) return esc(t);
  let out = '', at = 0;
  for (const [a, b] of mk) { if (a < at || b > t.length) continue; out += esc(t.slice(at, a)) + `<mark class="br-hl">${esc(t.slice(a, b))}</mark>`; at = b; }
  return out + esc(t.slice(at));
}
/** The bit of a long text around its first hit. */
export function snip(text, terms, width = 140) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  const mk = marks(t, terms);
  if (t.length <= width) return { text: t, marks: mk };
  const start = Math.max(0, Math.min((mk[0]?.[0] ?? 0) - 30, t.length - width));
  let s = t.slice(start, start + width), off = start;
  if (start > 0) { s = `…${s}`; off -= 1; }
  if (start + width < t.length) s += '…';
  return { text: s, marks: mk.map(([a, b]) => [a - off, b - off]).filter(([a, b]) => a >= 0 && b <= s.length) };
}
/** Rank the phone's notes (views from brain-data) for a question and the chips' filters. */
export function localSearch(notes, q, { when = 'any', place = 'any' } = {}) {
  const p = parse(q);
  const W = windowOf(when !== 'any' ? when : p.when);
  const P = place !== 'any' ? place : p.place;
  const hits = [];
  for (const n of notes) {
    if (W && !(n.ms >= W[0] && n.ms < W[1])) continue;
    if (P && placeKey(n.where) !== P) continue;
    const about = p.person && (n.person === p.person || n.links?.person === p.person || new RegExp(`\\b${PEOPLE.find((x) => x.id === p.person)?.name ?? '#'}\\b`, 'i').test(`${n.title} ${n.text}`));
    if (p.person && !about) continue;
    const ti = n.title.toLowerCase(), tx = n.text.toLowerCase(), meta = `${n.where} ${n.sub ?? ''}`.toLowerCase();
    let score = about ? 4 : 0, hit = 0;
    for (const t of p.terms) { const m = (ti.includes(t) ? 3 : 0) + (tx.includes(t) ? 1.2 : 0) + (meta.includes(t) ? 0.5 : 0); if (m) { hit++; score += m; } }
    if (p.terms.length && !hit && !about) continue;
    if (!p.terms.length) score += 1;
    hits.push({ n, score: score + Math.max(0, 0.5 - (Date.now() - n.ms) / (864e5 * 60)), title: { text: n.title, marks: marks(n.title, p.terms) }, snip: snip(n.text, p.terms) });
  }
  hits.sort((a, b) => b.score - a.score || b.n.ms - a.n.ms);
  return { parsed: { ...p, when: when !== 'any' ? when : p.when, place: P }, hits };
}
