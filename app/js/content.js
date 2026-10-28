// Content OS · the Content tab: his content engine for @northwindstudio and @example_creator, from ideas to scripts to the
// shoot (pack and teleprompter) to edits he approves, to posts and the numbers. The tab is the control room: the week's
// seven day rings and the streak, today's shoot, what needs him, the pipeline, what posts next, what the agent did here
// today, and the two channels. Each stage opens one level down (content-ideas.js, content-make.js, content-ship.js).
// Real mode draws the PC's content module (content-data.js); ?data=demo draws the prototype's sample.
import { registerTab, $, $$, esc, on, setTab, currentTab, openSheet, closeSheet, toast, haptic, ring, pulse, topbar } from './core.js';
import { I } from './icons.js';
import { AGENT, TODAY_LABEL, addTask, USER, DEMO_MODE } from './data.js';
import { provide, api } from './bus.js';
import { registerRoute } from './svc/route.js';
import * as clock from './svc/clock.js';
import { S, CI, inCh, newIdeas, toSortCount, srcSentence, route, go, onRedraw, redraw, askBtn, chAv, chDot, chOf, cover, word, plural, hm, untilText, dur, kfmt, SHOOT, CHS, secsOf, codeOf, REAL, META } from './content-ui.js';
import { SHIFT, STATS, STREAK, POSTS, coverOf, refresh, send, ready } from './content-data.js';
import { addContentIdea, newIdeaSheet, openIdea } from './content-ideas.js';
import { openShootPack, openTeleprompter, packInfo, isShot, codes } from './content-make.js';
import { approve } from './content-ship.js';
import { stagger, roll } from './motion.js';

let page = null;
let entered = false;

registerTab('content', {
  title: 'Content',
  render(p) {
    page = p;
    p.innerHTML = `${topbar({ title: 'Content', right: `<button class="gbtn chrome icon" data-act="ct-search" aria-label="Search content">${I.search}</button><button class="gbtn chrome icon" data-act="ct-new" aria-label="New idea">${I.plus}</button>${askBtn()}` })}
      <div class="scroll ct" id="ctHome"></div>`;
    drawHome();
  },
  onShow() { drawHome(); refresh(); },
});
onRedraw(() => { if (page?.isConnected) drawHome(); });
route('home', () => { if (currentTab() !== 'content') setTab('content'); });

const DAYNAME = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const reviewEdits = () => S.edits.filter((d) => d.status === 'review' && inCh(d));
// what posts next: booked reels from now on (any week), soonest first
const ahead = () => (REAL ? POSTS.filter((p) => p.s !== 'posted' && inCh(p) && (!p.at || Date.parse(p.at) > clock.nowMs())).map((p) => ({ ...p, w: S.week.find((w) => w.iso === p.iso) ?? { d: clock.dayLabel(p.iso), iso: p.iso } }))
  : S.week.filter((w) => w.n >= 22).flatMap((w) => w.posts.filter((p) => p.s !== 'posted' && inCh(p)).map((p) => ({ ...p, w }))));
const dayName = (w) => (w.today ? 'Today' : w.tomorrow ? 'Tomorrow' : DAYNAME[w.d] ?? w.d);

// ── what needs him, in one list (Home's summary reads the same) ──────────
function needs() {
  const out = [];
  const d2 = reviewEdits()[0];
  if (d2) {
    const day = d2.post ? d2.post.split(' ')[0] : null;
    out.push({ id: 'edit', act: 'ct-go', v: `edit:${d2.id}`, btn: 'Review', icon: cover(d2.cover, { ch: d2.ch, w: 26 }),
      title: `Approve “${d2.title.split(' in ')[0].slice(0, 60)}”`, meta: REAL ? (d2.post ? `Posts ${d2.post} on ${d2.ch}` : `${plural(reviewEdits().length, 'edit')} rendered and waiting for you`) : `Posts ${d2.post} on ${d2.ch} and keeps ${({ Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' })[day] ?? 'that day'} in the streak` });
  }
  const warn = codes().find((c) => (S.scripts[c].checks ?? []).some(([k]) => k === 'warn') && inCh(S.scripts[c]) && !isShot(c));
  if (warn) {
    const w = (S.scripts[warn].checks.find(([k]) => k === 'warn') ?? [])[1] ?? '';
    out.push({ id: 'cta', act: 'ct-go', v: `script:${warn}`, btn: 'Fix', icon: `<span class="tile ct-ntile">${I.doc}</span>`,
      title: REAL ? `${codeOf(warn)}: ${w.split(':')[0]}` : `${warn}'s CTA promises a DM`, meta: REAL ? (w.split(':')[1]?.trim() ? capFirst(w.split(':')[1].trim()) : 'Open the script to fix it') : 'No reply is set up for “OS” yet. One tap swaps the line' });
  }
  const fresh = newIdeas();
  const n = toSortCount();
  if (n) out.push({ id: 'ideas', act: 'ct-triage', btn: 'Sort', icon: `<span class="tile ct-ntile">${CI.swipe}</span>`, title: `Sort ${plural(n, 'new idea')}`, meta: srcSentence(fresh) || 'Keep or kill each one' });
  if (REAL && CHS.some((k) => k.main && !k.slotsSet)) out.push({ id: 'slots', act: 'ct-go', v: 'calendar', btn: 'Set', icon: `<span class="tile ct-ntile">${I.clock}</span>`,
    title: 'Posting slots need a time', meta: 'Approve books the next open slot; there is none until you set one' });
  return out;
}
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// the seven day rings: posted closes the ring, booked is pencilled in, waiting on you is orange, open is a track
function dayState(w) {
  const ps = w.posts.filter(inCh);
  const posted = ps.filter((p) => p.s === 'posted').length;
  const st = posted ? 'posted' : ps.some((p) => p.s === 'review') ? 'review' : ps.some((p) => p.s === 'scheduled' || p.s === 'dry') ? 'booked' : w.past ? 'missed' : 'open';
  return { st, posted, ps };
}
function weekCell(w, i) {
  const { st, posted } = dayState(w);
  const hue = st === 'review' ? 'needs' : 'content';
  const p = st === 'posted' || st === 'booked' ? 1 : 0;
  const lbl = { posted: `${plural(posted, 'reel')} ${REAL ? 'sent' : 'posted'}`, booked: 'booked', review: 'waiting on your OK', missed: 'no reel', open: 'nothing yet' }[st];
  return `<button class="ct-day ${st} ${w.today ? 'today' : ''}" data-act="ct-dayring" data-iso="${w.iso}" aria-label="${dayName(w)} ${w.n}: ${lbl}">
    <span class="ct-day-l">${w.today ? 'Today' : w.d[0]}</span>
    ${ring(p, hue, 38, 4, { cls: st === 'booked' ? 'ct-ghost' : st === 'missed' ? 'ct-missed' : '', inner: `<b class="met ct-day-n">${w.n}</b>`, delay: 40 * i })}
    ${st === 'review' ? '<i class="ct-day-badge" aria-hidden="true"></i>' : ''}
  </button>`;
}
function weekLine() {
  const say = S.week.filter((w) => w.future).map((w) => {
    const ps = w.posts.filter(inCh);
    if (ps.some((p) => p.s === 'review')) return `${dayName(w)} waits on your OK`;
    if (ps.some((p) => p.s === 'scheduled')) return `${dayName(w)} is booked`;
    if (ps.some((p) => p.s === 'dry')) return `${dayName(w)} is approved (dry run)`;
    return `${dayName(w)} is open`;
  });
  if (!say.length) { const t = S.week.find((w) => w.today); const st = t ? dayState(t).st : 'open'; return st === 'posted' ? 'Today\'s reel is out. A new week starts tomorrow.' : 'The last day of the week.'; }
  return `${say.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`;
}

function drawHome() {
  const el = page && $('#ctHome', page); if (!el) return;
  const y = el.scrollTop;
  if (REAL && !META.loaded) {
    el.innerHTML = `<div class="phead ct-homehead"><h1 class="lt">Content</h1><p class="sub">${META.error ? esc(META.error) : 'Loading from your PC'}</p></div>
      ${META.error ? `<div class="note">${META.offline ? 'Your PC isn\'t reachable, and this phone has no copy of Content yet. It loads when the PC is back.' : esc(META.error)}</div>` : '<div class="ct-skel surface" aria-hidden="true"><i></i><i></i><i></i></div>'}`;
    return;
  }
  const nd = needs();
  const pk = packInfo();
  const r1 = pk.first ? S.scripts[pk.first] : null;
  const sameDesk = pk.ready.filter((c) => S.scripts[c].setup === (r1?.setup ?? 0) && !isShot(c));
  const weekN = S.week.reduce((n, w) => n + w.posts.filter((p) => p.s === 'posted' && inCh(p)).length, 0);
  const streak = STREAK.n;
  const fresh = toSortCount();
  const inPack = REAL ? codes().filter((c) => S.pack.includes(c) && inCh(S.scripts[c])) : codes().filter((c) => ['R1', 'R2', 'R3', 'R4'].includes(c) || S.scripts[c].status === 'ready').filter((c) => inCh(S.scripts[c]));
  const writing = inPack.filter((c) => S.scripts[c].status === 'writing' || S.scripts[c].rewriting).length;
  const warnN = inPack.filter((c) => (S.scripts[c].checks ?? []).some(([k]) => k === 'warn') && !isShot(c)).length;
  const toShoot = pk.ready.filter((c) => !isShot(c) && inCh(S.scripts[c])).length;
  const edits = S.edits.filter((d) => ['review', 'rendering', 'redo', 'draft'].includes(d.status) && inCh(d));
  const review = edits.filter((d) => d.status === 'review').length;
  const next = ahead();
  const booked = next.filter((p) => p.s === 'scheduled' || p.s === 'dry');
  const station = (key, icon, n, label, sub, needsYou = false) => `<button class="ct-st8n ${needsYou ? 'needs' : ''}" data-act="ct-go" data-v="${key}" aria-label="${label}: ${n}. ${esc(sub)}">
      <span class="tile">${icon}${needsYou ? '<i class="ct-st8n-dot" aria-hidden="true"></i>' : ''}</span><b class="met" data-count="${n}">${n}</b><span class="ct-st8n-l">${label}</span><span class="ct-st8n-s">${esc(sub)}</span></button>`;
  const openDays = S.week.filter((w) => w.future && !w.posts.some(inCh));
  const firstSlot = (CHS.find((k) => k.main)?.slots ?? [])[0] ?? (REAL ? null : '09:00');
  const rail = [...next.slice(0, 3).map((p) => `<button class="ct-rcard" data-act="ct-go" data-v="${p.edit ? `edit:${p.edit}` : 'calendar'}">
      ${cover(p.cover, { ch: p.ch, w: 104, label: p.title })}
      <b class="num">${esc(p.w.d ?? '')} ${esc(p.t)}</b>
      <span class="ct-rcard-m">${chDot(p.ch)}<span class="ell">${esc(p.title)}</span></span>
      ${p.s === 'review' ? word('Needs your OK', 'var(--needs-ink)') : p.s === 'dry' ? word('Approved · dry run', 'var(--ink-2)') : word(p.pencil ? 'Pencilled in' : REAL ? 'Booked in RealFlow' : 'Scheduled', 'var(--done)')}
    </button>`),
    ...openDays.slice(0, 3).map((w) => `<button class="ct-rcard empty" data-act="ct-fill" data-iso="${w.iso}">
      <span class="ct-rcard-empty">${I.plus}<span>Fill ${w.d}</span></span>
      <b class="num">${w.d}${firstSlot ? ` ${firstSlot}` : ''}</b><span class="ct-rcard-m"><span class="ell">An open day</span></span>${word('Keeps the streak', 'var(--ink-2)')}
    </button>`)].join('');
  const spark = (ch) => {
    const v = REAL ? STATS[ch]?.sent ?? [] : STATS[ch].followers;
    if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v);
    const yy = (n) => (26 - (n - lo) / Math.max(1, hi - lo) * 22).toFixed(1);
    return `<svg class="ct-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${v.map((n, i) => `${(i / (v.length - 1) * 100).toFixed(1)},${yy(n)}`).join(' ')}"/><circle cx="100" cy="${yy(v[v.length - 1])}" r="2.6"/></svg>`;
  };
  const learned = S.learn.find((l) => l.fresh && l.on) ?? S.learn.find((l) => l.on);
  const tl = TODAY_LABEL;
  const shootLine = r1 ? `${sameDesk.length > 1 ? `${sameDesk.map(codeOf).join(' and ')}` : codeOf(pk.first)} ${r1.real ? `· ${esc(SHOOT.setups[r1.setup]?.name ?? 'the desk')}` : 'at the desk'}` : '';
  const chCard = (k) => {
    const st = STATS[k.id] ?? {};
    if (!REAL) return `<button class="ct-chcard surface" data-act="ct-go" data-v="channel:${k.id}">
      <span class="ct-chcard-h">${chAv(k.id)}<span class="ell">${esc(k.short)}</span></span>
      <b class="met ct-chcard-n" data-count="${k.followers}">${k.followers.toLocaleString('en-IN')}</b>
      <span class="ct-chcard-d">${I.up}+${k.delta} this week</span>
      ${spark(k.id)}
      <span class="foot ct-chcard-f">${k.goal ? '46% of the 5,000 goal' : esc(k.short2 ?? k.focus)}</span>
    </button>`;
    return `<button class="ct-chcard surface" data-act="ct-go" data-v="channel:${k.id}">
      <span class="ct-chcard-h">${chAv(k.id)}<span class="ell">${esc(k.short)}</span></span>
      <b class="met ct-chcard-n" data-count="${st.reels ?? 0}">${st.reels ?? 0}</b>
      <span class="ct-chcard-d">${plural(st.reels ?? 0, 'reel')} sent in 30 days</span>
      ${spark(k.id)}
      <span class="foot ct-chcard-f">${st.ahead ? `${st.ahead} booked ahead` : esc(k.short2 ?? k.focus)}</span>
    </button>`;
  };

  el.innerHTML = `
    <div class="phead ct-homehead">
      <h1 class="lt">Content</h1>
      <p class="sub">${esc(tl.weekday)} ${tl.day} ${esc(String(tl.month ?? 'Oct').slice(0, 3))} · ${nd.length ? `<b>${plural(nd.length, 'thing needs', 'things need')} you</b>` : 'nothing needs you'}${REAL && META.offline ? ' · <span class="ct-stale">from this phone\'s copy</span>' : ''}</p>
    </div>
    <div class="chips ct-chfilter" role="group" aria-label="Channel">
      <button class="chip sm ${S.ch === 'all' ? 'on' : ''}" data-act="ct-ch" data-v="all" aria-pressed="${S.ch === 'all'}">Both</button>
      ${CHS.map((k) => `<button class="chip sm ${S.ch === k.id ? 'on' : ''}" data-act="ct-ch" data-v="${k.id}" aria-pressed="${S.ch === k.id}">${chAv(k.id, 'sm')}${esc(k.short)}</button>`).join('')}
    </div>

    <section class="surface ct-hero">
      <div class="ct-hero-top">
        <span class="ct-streak">${I.flame}<b class="met" data-count="${streak}">${streak}</b><span>day streak</span></span>
        <span class="ct-weekn"><b class="met">${weekN}</b> of ${STREAK.weekGoal} reels this week</span>
      </div>
      <div class="ct-week" role="group" aria-label="This week, one reel a day">${S.week.map(weekCell).join('')}</div>
      <p class="ct-week-say">${esc(weekLine())}</p>
      ${r1 ? `<div class="ct-hero-shoot">
        <button class="ct-hero-r" data-act="ct-go" data-v="pack">
          ${cover(r1.real ? coverOf(r1.title) : { lines: ['Five agents.', 'One lecture.'], hi: 0, scene: 'agents' }, { ch: r1.ch, w: 46 })}
          <span class="ct-hero-rt">
            <span class="ct-k">Shoot · ${SHOOT.at != null ? `${hm(SHOOT.at)} · <span class="c-content">${untilText(SHOOT.at)}</span>` : 'today'}</span>
            <b>${shootLine}</b>
            <span class="foot">${esc(r1.title)} · ~${secsOf(pk.first)} s</span>
          </span>
        </button>
        <div class="ct-hero-acts">
          <button class="btn primary ct-grow" style="--c:var(--content-fill)" data-act="ct-shoot">${CI.rec}Start shoot</button>
          <button class="btn" data-act="ct-go" data-v="pack">Pack</button>
        </div>
      </div>` : pk.ready.length || !REAL ? `<div class="ct-hero-shoot done"><p class="ct-k">Today's pack is shot</p><button class="btn" data-act="ct-go" data-v="pack">${CI.upload}Takes</button></div>`
        : `<div class="ct-hero-shoot done"><p class="ct-k">No shoot planned today</p><button class="btn" data-act="ct-go" data-v="pack">${I.sparkle}Plan a pack</button></div>`}
    </section>

    ${nd.length ? `<div class="sh"><h2>Needs you</h2><span class="sh-count">${nd.length}</span></div>
    <div class="group ct-needs">${nd.map((n) => `<div class="row ct-need">
      <span class="ct-need-i">${n.icon}</span>
      <button class="rbody ct-need-b" data-act="${n.act}" ${n.v ? `data-v="${n.v}"` : ''}><span class="rtitle wrap">${esc(n.title)}</span><span class="rmeta"><span class="ell">${esc(n.meta)}</span></span></button>
      <button class="btn sm" data-act="${n.act}" ${n.v ? `data-v="${n.v}"` : ''}>${n.btn}</button>
    </div>`).join('')}</div>` : ''}

    <div class="sh"><h2>Pipeline</h2><button class="sh-act" data-act="ct-go" data-v="stats">Stats ${I.chevR}</button></div>
    <section class="surface ct-pipe" aria-label="The pipeline">
      ${station('ideas', I.bulb, fresh, 'Ideas', fresh ? 'to sort' : 'all sorted')}
      ${station('scripts', I.doc, inPack.length, 'Scripts', warnN ? `${warnN} to fix` : writing ? `${writing} writing` : inPack.length ? 'ready' : 'none today', warnN > 0)}
      ${station('pack', I.camera, toShoot, 'Shoot', toShoot ? (SHOOT.at != null ? hm(SHOOT.at) : 'today') : pk.ready.length ? 'shot' : 'none today')}
      ${station('edits', CI.layers, edits.length, 'Edits', review ? `${review} for you` : edits.length ? 'with the editor' : 'none', review > 0)}
      ${station('calendar', I.clock, booked.length, 'Posts', booked[0] ? `next ${booked[0].w.d ?? ''}` : 'none booked')}
    </section>

    <div class="sh"><h2>Posting next</h2><button class="sh-act" data-act="ct-go" data-v="calendar">Calendar ${I.chevR}</button></div>
    ${rail ? `<div class="ct-rail" data-scroll-x>${rail}</div>` : `<div class="note">Nothing is booked yet. Approve an edit and it takes the next open slot.</div>`}

    <div class="sh"><h2>${esc(AGENT.name)} in Content today</h2></div>
    <div class="group ct-shift">
      ${SHIFT.map((s) => `<button class="row ct-shiftrow" data-act="ct-go" data-v="${s.go}"><span class="ct-shift-t num">${esc(s.at ?? '')}</span><span class="tile">${{ radar: I.radar, layers: CI.layers, hammer: I.hammer, film: I.film }[s.icon] ?? I.sparkle}</span><span class="rbody"><span class="rtitle wrap">${esc(s.text)}</span>${s.job ? `<span class="rmeta">Job ${s.job} on your PC</span>` : ''}</span>${I.chevR}</button>`).join('')}
      ${!SHIFT.length ? `<div class="row ct-shiftrow"><span class="ct-shift-t num"></span><span class="tile">${I.sparkle}</span><span class="rbody"><span class="rtitle wrap">Nothing ran here yet today</span><span class="rmeta"><span class="ell">The plan runs at 02:30 and reads your work at 21:30</span></span></span></div>` : ''}
      ${learned ? `<button class="row ct-shiftrow" data-act="ct-go" data-v="learning"><span class="ct-shift-t num">${learned.fresh ? 'Week' : 'Rule'}</span><span class="tile">${I.sparkle}</span><span class="rbody"><span class="rtitle wrap ct-clamp2">Learned: ${esc(learned.rule)}</span><span class="rmeta"><span class="ell">${esc(learned.from ?? '')}</span></span></span>${I.chevR}</button>` : ''}
      <button class="row ct-shiftrow ct-askrow" data-act="ct-ask"><span class="ct-shift-t"></span><span class="tile">${I.chat}</span><span class="rbody"><span class="rtitle">Ask ${esc(AGENT.name)} about Content</span><span class="rmeta"><span class="ell">“What should I shoot tomorrow?”</span></span></span>${I.chevR}</button>
    </div>

    <div class="sh"><h2>Channels</h2></div>
    <div class="ct-chcards">${CHS.map(chCard).join('')}</div>`;
  el.scrollTop = y;
  pulse(el);
  if (!entered) { entered = true; try { stagger($$('.ct-hero, .ct-needs, .ct-pipe, .ct-rail, .ct-shift, .ct-chcards', el), { y: 10, each: 45 }); } catch {} }
}

// ── home actions ─────────────────────────────────────────────────────────
on('ct-ch', (el) => { S.ch = el.dataset.v; haptic(5); redraw('channel'); });
on('ct-ask', () => api.askAgent('', { about: 'content' }));
on('ct-new', () => newIdeaSheet());
on('ct-dayring', (el) => {
  const w = S.week.find((x) => x.iso === el.dataset.iso); if (!w) return;
  const rev = w.posts.find((p) => p.s === 'review');
  if (rev) { go(`edit:${rev.edit}`); return; }
  if (!w.posts.length && (w.future || (w.today && !REAL))) { streakSheet(w); return; }
  go('calendar');
  setTimeout(() => { const sc = $('#stack .page:last-child .scroll'); const t = sc && $(`#ctDay${w.iso}`, sc); if (t) sc.scrollTo({ top: t.offsetTop - 110, behavior: 'smooth' }); }, 520);
});

// an open day: the two ways to keep the streak alive (and in the prototype, the freeze that covers one miss a month)
function streakSheet(w) {
  const first = packInfo().first;
  openSheet({
    title: `${dayName(w)} has no reel yet`, sub: STREAK.n ? `One reel keeps your ${STREAK.n}-day streak going` : 'One reel a day starts a streak',
    body: (b) => {
      b.innerHTML = `<div class="group">
        ${REAL ? `<button class="row ic" data-act="ct-go" data-v="edits"><span class="tile">${CI.layers}</span><span class="rbody"><span class="rtitle">Approve an edit for it</span><span class="rmeta"><span class="ell">${plural(reviewEdits().length, 'edit')} rendered and waiting</span></span></span>${I.chevR}</button>
        <button class="row ic" data-act="ct-go" data-v="pack"><span class="tile">${I.camera}</span><span class="rbody"><span class="rtitle">${first ? `Shoot ${codeOf(first)} today` : 'Plan a shoot pack'}</span><span class="rmeta"><span class="ell">${first ? 'The edit lands for your OK' : `${esc(AGENT.name)} writes it from your kept ideas`}</span></span></span>${I.chevR}</button>`
        : `<button class="row ic" data-act="ct-fill-r1" data-iso="${w.iso}"><span class="tile">${I.camera}</span><span class="rbody"><span class="rtitle">Pencil in R1 for ${w.d} 09:00</span><span class="rmeta"><span class="ell">It shoots tonight; the edit lands tomorrow</span></span></span>${I.chevR}</button>`}
        <button class="row ic" data-act="ct-streak-remind" data-iso="${w.iso}" data-d="${w.d}"><span class="tile">${I.clock}</span><span class="rbody"><span class="rtitle">Remind me the evening before</span><span class="rmeta"><span class="ell">${REAL ? 'A task on Today at 20:00' : `${esc(AGENT.name)} calls at 21:00 if it's still open`}</span></span></span>${I.chevR}</button>
      </div>
      ${STREAK.freeze ? `<p class="hint">Best streak: ${STREAK.best} days. One streak freeze left this month; it covers a missed day on its own.</p>` : STREAK.best ? `<p class="hint">Best streak so far: ${plural(STREAK.best, 'day')}.</p>` : ''}`;
    },
  });
}
on('ct-streak-remind', (el) => {
  closeSheet(el.closest('.sheet'));
  if (!REAL) { toast(`${AGENT.name} reminds you at 20:00 and calls at 21:00 if ${DAYNAME[el.dataset.d] ?? 'it'} is still open`, () => toast('Reminder removed')); return; }
  const iso = el.dataset.iso; const eve = clock.addDays(iso, -1);
  const day = eve < clock.today() ? clock.today() : eve;
  try { addTask({ title: `Book a reel for ${DAYNAME[el.dataset.d] ?? iso}`, area: 'content', date: day, due: day, at: '20:00', len: 15, notes: 'Content OS: one reel a day keeps the streak.' }); toast(`On Today at 20:00, ${clock.dayLabel(day).toLowerCase()}`); }
  catch (e) { toast(e.message || 'That didn\'t save'); }
});

// ── search: every idea, script, edit and post; a result takes you to it ──
on('ct-search', () => {
  const all = [
    ...S.ideas.filter((x) => x.status !== 'killed').map((x) => ({ t: x.title, m: `Idea · ${x.ch}`, i: I.bulb, go: `idea:${x.id}` })),
    ...codes().map((c) => ({ t: S.scripts[c].title, m: `Script ${codeOf(c)} · ${S.scripts[c].status === 'writing' ? 'writing' : isShot(c) ? 'shot' : 'ready'}`, i: I.doc, go: `script:${c}` })),
    ...S.edits.map((d) => ({ t: d.title, m: `Edit · ${d.status === 'review' ? 'needs your OK' : d.status === 'draft' ? 'not rendered yet' : d.status}`, i: CI.layers, go: d.status === 'rendering' ? 'edits' : `edit:${d.id}` })),
    ...(REAL ? POSTS.slice(-40).reverse().map((p) => ({ t: p.title, m: `Post · ${clock.dayLabel(p.iso)} ${p.t} · ${p.ch}`, i: I.clock, go: 'calendar' }))
      : S.week.flatMap((w) => w.posts.map((p) => ({ t: p.title, m: `Post · ${w.d} ${p.t} · ${p.ch}`, i: I.clock, go: 'calendar' })))),
  ];
  openSheet({
    title: 'Search content', large: true,
    body: (b) => {
      b.innerHTML = `<div class="pad"><label class="field">${I.search}<input class="ct-search-in" type="search" placeholder="Ideas, scripts, edits, posts" autocomplete="off" aria-label="Search content" /></label></div><div class="ct-res"></div>`;
      const res = $('.ct-res', b);
      const draw = (q) => {
        const hits = all.map((x, k) => [x, k]).filter(([x]) => !q || x.t.toLowerCase().includes(q.toLowerCase()) || x.m.toLowerCase().includes(q.toLowerCase())).slice(0, 80);
        res.innerHTML = hits.length ? `<p class="ct-res-n">${q ? `${plural(hits.length, 'match', 'matches')}` : `Everything · ${all.length}`}</p><div class="group">${hits.map(([x, k]) => `<button class="row ic" data-act="ct-res-go" data-k="${k}"><span class="tile">${x.i}</span><span class="rbody"><span class="rtitle">${esc(x.t)}</span><span class="rmeta"><span class="ell">${esc(x.m)}</span></span></span>${I.chevR}</button>`).join('')}</div>`
          : `<div class="note">Nothing matches “${esc(q)}”.</div>`;
      };
      b._all = all; draw('');
      $('input', b).addEventListener('input', (e) => draw(e.target.value.trim()));
      setTimeout(() => $('input', b)?.focus({ preventScroll: true }), 450);
    },
  });
});
on('ct-res-go', (el) => {
  const hit = el.closest('.sheet-body')?._all?.[Number(el.dataset.k)]; if (!hit) return;
  closeSheet(el.closest('.sheet'));
  setTimeout(() => go(hit.go), 260);
});

// ── the summary Home, Life, Growth and the agent read (the same shape as an aspect's summary()) ──
function contentSummary() {
  const pk = packInfo();
  const d2 = S.edits.find((d) => d.status === 'review');
  const fresh = toSortCount();
  const all = S.week.flatMap((w) => w.posts.map((p) => ({ ...p, w })));
  const posted = all.filter((p) => p.s === 'posted').length;
  const desk = pk.ready.filter((c) => S.scripts[c].setup === 0 && !isShot(c));
  const nextPost = ahead().find((p) => p.s === 'scheduled');
  const at = SHOOT.at != null ? hm(SHOOT.at) : null;
  if (REAL && !META.loaded) return { line: META.error ? 'Content: not loaded' : 'Content: loading', metric: { v: 0, of: STREAK.weekGoal, unit: '', label: 'reels this week', p: 0 }, today: [], streak: { n: 0, label: 'day posting streak', atRisk: false },
    next: { at: '', text: 'Content loads from your PC' }, quick: [{ label: 'Idea', icon: I.bulb, act: 'ct-q-idea' }], followers: null, week: null, loaded: false };
  const main = CHS.find((k) => k.main) ?? CHS[0];
  return {
    line: pk.first ? `${plural(pk.ready.length, 'script')} ready in ${plural(SHOOT.setups.length || 1, 'setup')} · ${desk.length > 1 ? `${desk.map(codeOf).join(' and ')} first` : `${codeOf(pk.first)} first`}`
      : pk.ready.length ? 'Today’s pack is shot · takes are uploading' : fresh ? `${plural(fresh, 'idea')} to sort · no shoot today` : 'Nothing planned in Content today',
    metric: { v: posted, of: STREAK.weekGoal, unit: '', label: 'reels this week', p: Math.min(1, posted / Math.max(1, STREAK.weekGoal)) },
    today: [
      ...(pk.first ? [{ id: 'ct-t-shoot', text: at ? `Shoot ${codeOf(pk.first)} at ${at}` : `Shoot ${codeOf(pk.first)}`, done: false, act: 'ct-sum-shoot' }] : pk.ready.length ? [{ id: 'ct-t-shoot', text: 'Upload today’s takes', done: true, act: 'ct-sum-shoot' }] : []),
      ...(d2 ? [{ id: 'ct-t-edit', text: `Approve “${d2.title.split(' in ')[0].slice(0, 40)}”${d2.post ? ` for ${d2.post}` : ''}`, done: false, act: 'ct-sum-edit' }] : []),
      ...(fresh ? [{ id: 'ct-t-ideas', text: `Sort ${plural(fresh, 'new idea')}`, done: false, act: 'ct-sum-ideas' }] : []),
    ].slice(0, 3),
    streak: { n: STREAK.n, label: 'day posting streak', atRisk: !!STREAK.atRisk && STREAK.n > 0 },
    // always an object: the shoot while one is pending, else the next reel that posts
    next: pk.first ? { at: at ?? 'Today', text: `Shoot ${codeOf(pk.first)}${REAL ? '' : ' at the desk'}` }
      : nextPost ? { at: `${nextPost.w.d ?? ''} ${nextPost.t}`.trim(), text: `${nextPost.title} posts on ${nextPost.ch}` }
      : { at: '02:30', text: 'Tonight’s plan writes tomorrow’s pack' },
    quick: [{ label: 'Start shoot', icon: I.camera, act: 'ct-q-shoot' }, { label: 'Idea', icon: I.bulb, act: 'ct-q-idea' }],
    // followers (g3 in the prototype): real mode has no follower numbers on the PC yet, so it says so (null), never a guess
    followers: REAL ? { total: null, gained: null, lastWeek: null, goal: null, channel: main.id, goalId: META.goal, known: false }
      : (() => { const v = STATS['@northwindstudio'].followers; return { total: v[v.length - 1], gained: v[v.length - 1] - v[v.length - 2], lastWeek: v[v.length - 2] - v[v.length - 3], goal: 5000, channel: '@northwindstudio' }; })(),
    // the week for the Sunday review: reels out against the plan, and (prototype only) followers gained
    week: {
      posted, planned: STREAK.weekGoal, followersGained: REAL ? null : CHS.reduce((n, k) => n + (k.delta ?? 0), 0),
      scheduled: all.filter((p) => p.s === 'scheduled').length, waiting: REAL ? S.edits.filter((d) => d.status === 'review').length : all.filter((p) => p.s === 'review').length,
      daysWithReel: S.week.filter((w) => w.posts.some((p) => p.s === 'posted')).length,
      byChannel: CHS.map((k) => ({ ch: k.id, posted: all.filter((p) => p.ch === k.id && p.s === 'posted').length, followers: REAL ? null : k.followers, gained: REAL ? null : k.delta })),
    },
    loaded: true,
  };
}
on('ct-sum-shoot', () => { if (packInfo().first) openTeleprompter(); else openContent('pack'); });
on('ct-sum-edit', () => { const d = S.edits.find((x) => x.status === 'review'); openContent(d ? `edit:${d.id}` : 'edits'); });
on('ct-sum-ideas', () => { openContent(); setTimeout(() => go('triage'), 120); });
on('ct-q-shoot', () => openTeleprompter());
on('ct-q-idea', () => newIdeaSheet());
addEventListener('content-op-failed', (e) => { const d = e.detail ?? {}; toast(`Not saved on your PC${d.error ? `: ${String(d.error).slice(0, 80)}` : ''}`); });

// ── the bus: what Content provides to every other area ─────────────────────
// Content OS is the owner's channels: a member has no Content tab (main.js), and links from other apps stop here
const member = () => !DEMO_MODE && !!USER && !USER.owner;
function openContent(view, arg) {
  if (member()) { toast('Content is on the owner\'s phone only'); return; }
  if (currentTab() !== 'content') setTab('content');
  if (!view || view === 'home') return;
  const v = arg && !String(view).includes(':') ? `${view}:${arg}` : view;
  requestAnimationFrame(() => go(v));
}
provide('openContent', openContent);
// a member's reels and links go to the Brain instead (capture-route.js and brain.js check has('addContentIdea'))
if (!member()) provide('addContentIdea', (prefill = {}) => addContentIdea(prefill));
provide('openShootPack', (day) => { if (member()) return openContent(); if (currentTab() !== 'content') setTab('content'); requestAnimationFrame(() => openShootPack(day)); });
provide('openTeleprompter', (take) => openTeleprompter(take));
provide('contentSummary', contentSummary);
provide('approveEdit', (id) => approve(id));
// the widget's streak row for Content (one reel a day on either channel); native.js's 'streaks' part should merge it in
provide('contentStreak', () => ({ id: 'content', label: 'Reel a day', n: STREAK.n, today: !!STREAK.today, atRisk: !STREAK.today && !!STREAK.atRisk && STREAK.n > 0, aspect: 'mission', url: 'agenticos://content' }));
provide('openContentIdea', (id) => { if (member()) return openContent(); openContent(); requestAnimationFrame(() => openIdea(id)); });
// what the agent can do in Content (the real tools live on the PC: server/modules/content.ts `tools`, aggregated into her MCP server)
provide('contentTools', () => [
  { name: 'content_file_idea', does: 'Files a reel, link or thought into Ideas', auto: true },
  { name: 'content_mine_work', does: 'Turns what you finished today into reel ideas with a hook and a skeleton', auto: true },
  { name: 'content_list_ideas', does: 'Reads the inbox with the plan\'s score and reasons', auto: true },
  { name: 'content_plan_pack', does: 'Plans a shoot pack: picks per channel, writes the scripts, files the Shoot block', auto: true },
  { name: 'content_write_script', does: 'Writes a script for one idea with your doctrine and the loop\'s rules', auto: true },
  { name: 'content_rewrite_script', does: 'Rewrites a hook, cuts it shorter, more Hinglish; your version is kept for Revert', auto: true },
  { name: 'content_revert_script', does: 'Puts a script back the way it was before the last rewrite', auto: true },
  { name: 'content_note_edit', does: 'Sends an edit back to the editor with a note', auto: true },
  { name: 'content_verdict', does: 'Keeps or kills an idea (your verdicts teach the loop, so she asks first)', auto: false },
  { name: 'content_approve_edit', does: 'Approves an edit: it books the next RealFlow slot (asks first)', auto: false },
  { name: 'content_set_setting', does: 'Changes reels a day, posting slots or the shoot time (asks first)', auto: false },
]);
// deep links: #content/<view>[/<arg>] and agenticos://content/edit/e3 (route.js's built-in calls openContent the same way)
registerRoute('content', (L, ctx) => { ctx.tab('content'); if (L.sub) ctx.after(() => openContent(L.sub, L.arg)); }, { owner: true, tab: 'content' });
ready.then(() => { if (page?.isConnected) drawHome(); });

export { contentSummary, openContent };
