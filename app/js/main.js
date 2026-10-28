// Boot: the engine first (the session, the day from the PC or this phone's offline copy), then the skin, the tab bar
// (Today · Life · Work · Content · Agent) and the capture lens; then every area registers itself on import.
// Areas load side by side, so a file that fails to load breaks only its own area (the error is in the console).
// Links, the native bridge and the shipping app's Work and module pages come after (svc/boot.js afterAreas).
import { $, on, closePeek, haptic, setTab } from './core.js';
import { initSkin } from './skin.js';
import { I } from './icons.js';
import { JOBS, AGENT, USER, DEMO_MODE, NOW, onData } from './data.js';
import { provide, has, api } from './bus.js';
import { aspectIds, summary } from './aspects.js';
import { snapshotPart } from './svc/native.js';
import { startEngine, afterAreas } from './svc/boot.js';

initSkin();
await startEngine();

const AREAS = ['./today.js', './life.js', './brain.js', './jobs.js', './clients.js', './content.js', './more.js', './capture.js', './wyn.js',
  ...aspectIds().map((id) => `./aspects/${id}.js`)];
const loaded = await Promise.allSettled(AREAS.map((p) => import(p)));
const mod = {};
loaded.forEach((r, i) => { if (r.status === 'fulfilled') mod[AREAS[i]] = r.value; else console.error('[boot] failed to load', AREAS[i], r.reason); });

// The Work tab keeps the id 'jobs' that the Jobs code was written against. A member (not the owner) has no Work, no
// Content (the owner's channels) and no agent: those tabs leave the bar (svc/route.js refuses their links too).
const member = !DEMO_MODE && USER && !USER.owner;
const TABS = [['today', 'Today', I.today], ['life', 'Life', I.wheel], ['jobs', 'Work', I.work], ['content', 'Content', I.content], ['agent', AGENT.name, I.agent]];
for (const [id, label, icon] of TABS) {
  const b = $(`.tab[data-tab="${id}"]`);
  if (!b) continue;
  if (member && (id === 'jobs' || id === 'content' || id === 'agent')) { b.remove(); continue; }
  b.innerHTML = `${icon}<span>${label}</span>`;
}
if (member) $('.tabbar')?.style.setProperty('--tabs', String(document.querySelectorAll('.tab').length));
$('#captureBtn').innerHTML = I.scan;

// the Work badge counts what waits on you; the agent's tab carries her name (both can change after boot)
function syncChrome() {
  const n = JOBS.filter((j) => j.lane === 'needs').length;
  const tab = $('#tabJobs');
  if (tab) {
    let b = $('.tbadge', tab);
    if (!b && n) { tab.insertAdjacentHTML('beforeend', `<i class="tbadge" aria-label="${n} need you">${n}</i>`); b = $('.tbadge', tab); }
    if (b) { b.textContent = n; b.hidden = !n; b.setAttribute('aria-label', `${n} need you`); }
  }
  const label = $('#tabAgent span');
  if (label && label.textContent !== AGENT.name) label.textContent = AGENT.name;
}
syncChrome();
onData(syncChrome);
// the desk frame's status bar (wide screens only) shows the real time
const deskTime = () => { const el = $('.desk-status .num'); if (el) el.textContent = `${String(Math.floor(NOW / 60)).padStart(2, '0')}:${String(NOW % 60).padStart(2, '0')}`; };
deskTime();
document.addEventListener('clock-tick', deskTime);

on('close-peek', (el, e) => { if (e.target === el || e.target.closest('.peek-menu')) closePeek(); });
provide('setTab', (id) => setTab(id));

// widget streak rows for areas that expose theirs only on the bus or in their summary (svc/native merges every
// 'streaks:<area>'; Growth, Soul and Body add their own)
if (!DEMO_MODE) {
  snapshotPart('streaks:content', () => (has('contentStreak') ? [api.contentStreak()].filter((r) => r && r.n > 0) : undefined));
  snapshotPart('streaks:mind', () => {
    const s = summary('mind'); const k = s?.streak;
    if (!k?.n) return undefined;
    return [{ id: 'checkin', label: 'Evening check-in', n: k.n, today: !!s.today?.find((t) => t.id === 'min-1')?.done, atRisk: !!k.atRisk, aspect: 'mind' }];
  });
}

// Deep links, #links, agenticos:// links and push taps: svc/route.js (one checked entry)
afterAreas();
mod['./today.js']?.renderAccessory?.();
document.body.classList.add('ready');
haptic(0);
