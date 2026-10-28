// Reality ribbon: what the PC actually did today, drawn under the plan. Server side: server/modules/ribbon.ts
// (the watcher server/bin/ribbon-watch.ts posts foreground-window samples; the server classifies them).
// Design: j15/mockup/final/js/more.js PAGES.ribbon (app/ui/STRUCTURE.md, area (d)).
const { AOS } = window;
AOS.css('modules/ribbon.css');

const I = AOS.icons;
const ICON = I.ribbon;
const esc = AOS.esc;
const fmt = (m) => { const h = Math.floor(m / 60), r = Math.round(m % 60); return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
const istHour = () => Number(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).slice(0, 2));
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const word = (t, c) => `<span class="mp-st" style="--c:${c}">${esc(t)}</span>`;
const head = (sub) => `<div class="mp-head"><span class="mp-ic" aria-hidden="true">${ICON}</span><h1 class="large-title">Reality ribbon</h1><p class="sub">${sub}</p></div>`;

let state = null, error = null, pageEl = null, cardEl = null, lastM = null, lastLoad = 0, loading = false, timer = null, openUnknown = null;
const colorOf = (slug) => (slug && slug !== 'idle' && AOS.areas.get(slug)?.color) || 'var(--ink-3)';
const areaName = (slug) => AOS.areas.get(slug)?.name ?? slug;
const areaShort = (slug) => { const n = areaName(slug) ?? ''; return n.split(/[\s+&]/)[0] || n; };
const projectName = (slug) => state?.projects?.find((p) => p.slug === slug)?.name ?? slug;

// ---------- data ----------
async function load(force = false) {
  if (loading || (!force && Date.now() - lastLoad < 20000)) return;
  loading = true;
  try {
    state = await AOS.api('/api/v1/mod/ribbon/today');
    error = null;
    lastLoad = Date.now();
  } catch (e) {
    error = e.status === 403 ? 'The ribbon shows the owner’s PC.' : e.message || 'Your PC isn’t reachable right now.';
  } finally { loading = false; }
  renderCard(cardEl, lastM);
  renderPage();
  figSync();
}
// More's row (app.js modFigure): where today's time went, or why there is nothing yet. Asked for once when More
// draws before anything loaded (the owner's PC only); More redraws when it changes and is on screen
let figKey = null, figAsked = 0;
function figure() {
  if (!state) {
    if (AOS.user?.role === 'owner' && !loading && Date.now() - figAsked > 60_000) { figAsked = Date.now(); load(true); }
    return null;
  }
  const d = state.day;
  if (d?.samples) {
    const byProject = Object.entries(d.byProject ?? {});
    const top = byProject[0] ?? Object.entries(d.byArea ?? {})[0];
    if (top) return { value: fmt(top[1]), label: `On ${byProject.length ? projectName(top[0]) : areaName(top[0])} today` };
    return { value: fmt(d.minutes), label: 'Watched today' };
  }
  return { value: '', label: state.watcher?.alive ? 'Watching, nothing yet today' : 'The watcher is off' };
}
function figSync() {
  const k = JSON.stringify(figure());
  if (k === figKey) return;
  figKey = k;
  const ui = AOS.ui?.();
  if (ui?.tab === 'more' && !ui.stack?.more?.length) AOS.renderTab?.('more');
}
async function post(path, body, method = 'POST') {
  AOS.haptic('light');
  try {
    const r = await AOS.api(`/api/v1/mod/ribbon${path}`, { method, body: JSON.stringify(body ?? {}) });
    await load(true);
    return r;
  } catch (e) { AOS.toast(e.message || 'That didn’t work'); return null; }
}

// ---------- Today card: a row of the brief ----------
function renderCard(el, m) {
  if (!el) return;
  if (!state?.day || !m?.isToday) { el.innerHTML = ''; return; }
  const d = state.day, alive = state.watcher?.alive;
  let title, meta;
  if (!d.samples) {
    if (!alive) { el.innerHTML = ''; return; }
    title = 'Reality ribbon is watching'; meta = 'Nothing recorded yet today';
  } else {
    const byProject = Object.entries(d.byProject ?? {});
    const top = byProject[0] ?? Object.entries(d.byArea ?? {})[0];
    title = top ? `Reality: ${fmt(top[1])} on ${byProject.length ? projectName(top[0]) : areaName(top[0])}` : `Reality: ${fmt(d.minutes)} watched`;
    meta = [`${fmt(d.minutes)} watched today`, d.untagged ? `${fmt(d.untagged)} untagged` : '', alive ? '' : 'watcher off'].filter(Boolean).join(' · ');
  }
  el.innerHTML = `<button class="lrow b-row mcard" data-rb-open><span class="bi">${ICON}</span><span class="rbody"><span class="rtitle">${esc(title)}</span><span class="rmeta"><span class="ell">${esc(meta)}</span></span></span>${I.chevR}</button>`;
}

// ---------- page ----------
// one cell an hour: the area's colour, a quiet hatch for away, a ringed cell for time no rule matched
function cell(slug, min, untagged, fut) {
  const f = fut ? ' fut' : '';
  if (!min && !untagged) return `<i class="rb-c${f}"></i>`;
  if (slug === 'idle') return `<i class="rb-c rb-away${f}" title="Away"></i>`;
  if (!slug) return `<i class="rb-c rb-unk${f}" title="No area yet"></i>`;
  return `<i class="rb-c on${f}" style="--c:${colorOf(slug)}" title="${esc(areaName(slug))}"></i>`;
}
function stripHTML(d) {
  const hours = d.hours ?? [];
  if (!hours.length) return `<p class="mp-text rb-empty">${state.watcher?.alive ? 'Watching. The first hour draws itself in a few minutes.' : 'Nothing planned or recorded today yet.'}</p>`;
  const isToday = d.date === AOS.today;
  const now = isToday ? istHour() : 99;
  const byH = new Map(hours.map((h) => [h.h, h]));
  const first = Math.min(...hours.map((h) => h.h)), last = Math.max(...hours.map((h) => h.h), isToday ? now : 0);
  const cols = [];
  for (let h = first; h <= last; h++) cols.push(byH.get(h) ?? { h });
  const n = cols.length;
  // labels: every fourth hour, and the last one when it has room
  const marks = cols.map((c) => c.h).filter((h, i) => h % 4 === 2 || i === 0);
  if (marks.at(-1) !== last && last - marks.at(-1) >= 2) marks.push(last);
  const ticks = marks.map((h) => `<i style="left:${(((h - first) + 0.5) / n) * 100}%"${h === now ? ' class="now"' : ''}>${String(h).padStart(2, '0')}</i>`).join('');
  return `<div class="rb-strip" style="--n:${n}" role="img" aria-label="Plan and what happened, by hour, from ${String(first).padStart(2, '0')}:00 to ${String(last).padStart(2, '0')}:00">
      <div class="rb-row"><span class="foot">Plan</span><span class="rb-cells">${cols.map((c) => cell(c.planned, c.plannedMin, 0, false)).join('')}</span></div>
      <div class="rb-row"><span class="foot">Real</span><span class="rb-cells">${cols.map((c) => cell(c.actual, c.actualMin, c.actualUntagged, c.h > now)).join('')}</span></div>
      <div class="rb-ticks"><span>${ticks}</span></div>
    </div>`;
}
function heroHTML(d) {
  const alive = state.watcher?.alive;
  const status = alive ? word('Watching', 'var(--done)') : word('Watcher off', 'var(--needs-ink)');
  const facts = d.samples ? [`${fmt(d.minutes)} watched`, d.lastAt ? `last ${hhmm(d.lastAt)}` : '', d.away ? `${fmt(d.away)} away` : ''].filter(Boolean).join(' · ') : alive ? 'Nothing recorded yet today' : '';
  const areas = Object.entries(d.byArea ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const stats = areas.length ? `<div class="rb-stats">${areas.map(([a, m]) => `<span class="rb-stat"><span class="rb-stat-n"><i class="dot" style="--c:${colorOf(a)}"></i><span>${esc(areaShort(a))}</span></span><b class="met">${fmt(m)}</b></span>`).join('')}</div>` : '';
  const plan = d.plan?.known && d.plan.hoursPlanned ? `<p class="mp-text rb-plan"><b class="num">${d.plan.hoursMatched} of ${d.plan.hoursPlanned}</b> planned hours went to the planned area.</p>` : '';
  const off = alive ? '' : `<p class="mp-text rb-off">Start it on your PC: <span class="mono">server\\bin\\ribbon-watch.ps1</span>. Nothing leaves the PC.</p>`;
  return `<section class="mp-card rb-hero">
    <p class="mp-k rb-k">${status}${facts ? `<span class="rb-facts">· ${esc(facts)}</span>` : ''}</p>
    ${off}${stripHTML(d)}${stats}${plan}
  </section>`;
}
function pageHTML() {
  const sub = 'Today, as it happened, next to what you planned.';
  if (error && !state) return `${head(sub)}<div class="note mp-note fail" role="alert"><b>${esc(error)}</b><span>The PC watches itself, locally only.</span><button class="btn sm" data-rb-reload>Try again</button></div>`;
  if (!state) return `${head(sub)}<div class="mp-load" role="status"><span class="spin" aria-hidden="true"></span>Asking your PC</div>`;
  const d = state.day;
  const projects = Object.entries(d.byProject ?? {}).sort((a, b) => b[1] - a[1]);
  const top = Math.max(1, ...projects.map(([, m]) => m));
  const byProject = projects.length ? `<div class="sh"><h2>By project</h2></div><div class="group">${projects.map(([p, m]) => {
    const area = state.projects.find((x) => x.slug === p)?.area;
    return `<div class="lrow rb-prow"><span class="rbody"><span class="rb-prow-t"><span class="rtitle">${esc(projectName(p))}</span><b class="num">${fmt(m)}</b></span><span class="bar rb-pbar" style="--p:${Math.max(2, Math.round((m / top) * 100))}%;--c:${colorOf(area)}"><i></i></span></span></div>`;
  }).join('')}</div>` : '';
  const starts = d.starts?.length ? `<div class="sh"><h2>Started by itself</h2><span class="sh-count">${d.starts.length}</span></div><div class="group">${d.starts.map((s) => `<div class="lrow ic rb-start"><span class="tile">${I.claude}</span><span class="rbody"><span class="rtitle">${esc(`${s.task ?? ''} ${s.title ?? ''}`.trim())}</span><span class="rmeta"><span class="ell">Started ${esc(hhmm(s.at))}${s.project ? ` · ${esc(projectName(s.project))}` : ''}</span></span></span></div>`).join('')}</div>
    <p class="mp-hint">A project’s repo in front for 10 minutes starts its next open task.</p>` : '';
  const unknown = state.unknown?.length ? `<div class="sh"><h2>No area yet</h2><span class="sh-count">${state.unknown.length}</span></div><div class="group rb-unks">${state.unknown.map((u, i) => {
    const open = openUnknown === i;
    return `<div class="rb-unk${open ? ' open' : ''}">
      <div class="lrow"><span class="rbody"><span class="rtitle">${esc(clip(u.title, 60))}</span><span class="rmeta"><span class="ell">${esc(u.process ?? '')}${u.process ? ' · ' : ''}${fmt(u.minutes)}</span></span></span><button class="btn sm rb-tag" data-rb-unknown="${i}" aria-expanded="${open}">${open ? 'Cancel' : 'Tag'}</button></div>
      ${open ? `<div class="chips rb-chips" role="group" aria-label="Pick an area for ${esc(clip(u.title, 40))}">${[...AOS.areas.values()].map((a) => `<button class="chip-btn" style="--c:${a.color}" data-rb-tag="${esc(a.slug)}" data-title="${esc(u.title)}"><i></i>${esc(a.name)}</button>`).join('')}</div>` : ''}
    </div>`;
  }).join('')}</div><p class="mp-hint">Pick an area once and that title tags itself from now on.</p>` : '';
  const proposed = state.proposed?.length ? `<div class="sh"><h2>Rules to keep</h2><span class="sh-count">${state.proposed.length}</span></div><div class="group">${state.proposed.map((r) => `<div class="lrow mp-tall rb-rule">
      <span class="rbody"><span class="rtitle mono">${esc(r.pattern)}</span>
        <span class="rmeta">${word('Proposed', 'var(--needs-ink)')}<span>·</span><span class="dot" style="--c:${colorOf(r.area)}"></span><span class="ell">${esc(areaName(r.area))}${r.project ? ` · ${esc(projectName(r.project))}` : ''}</span></span>
        ${r.why ? `<span class="mp-why">${esc(r.why)}</span>` : ''}
        <span class="mp-racts"><button class="btn sm" data-rb-keep="${esc(r.id)}">${I.check}Keep</button><button class="btn sm" data-rb-drop="${esc(r.id)}">Drop</button></span></span>
    </div>`).join('')}</div><p class="mp-hint">Haiku read the titles nothing matched. A rule you keep tags from now on.</p>` : '';
  const redact = state.redact ?? [];
  const hidden = `<div class="sh"><h2>Hidden titles</h2>${redact.length ? `<span class="sh-count">${redact.length}</span>` : ''}</div>
    ${redact.length ? `<div class="group">${redact.map((p, i) => `<div class="lrow"><span class="rbody"><span class="rtitle mono">${esc(p)}</span></span><button class="btn sm icon rb-x" data-rb-redact-del="${i}" aria-label="Stop hiding ${esc(p)}">${I.x}</button></div>`).join('')}</div>` : ''}
    <form class="mp-add" data-rb-redact-form><label class="ifield">${I.eye}<input type="text" placeholder="bank|password" aria-label="Pattern to hide" autocapitalize="off" autocomplete="off" spellcheck="false" enterkeyhint="done"></label><button class="btn" type="submit">Hide</button></form>
    <p class="mp-hint">Titles that match are stored as [redacted]. ${state.rulesKept} rule${state.rulesKept === 1 ? '' : 's'} kept.</p>`;
  return `${head(sub)}${heroHTML(d)}${byProject}${starts}${unknown}${proposed}${hidden}`;
}
function renderPage() {
  if (!pageEl?.isConnected) return;
  // a redraw keeps what you were typing in the hide field
  const input = pageEl.querySelector('[data-rb-redact-form] input');
  const typed = input?.value ?? '', focused = !!input && document.activeElement === input;
  pageEl.innerHTML = pageHTML();
  const again = pageEl.querySelector('[data-rb-redact-form] input');
  if (again && typed) again.value = typed;
  if (again && focused) again.focus({ preventScroll: true });
}

// ---------- module ----------
AOS.register({
  id: 'ribbon', title: 'Reality ribbon', order: 20,
  icon: ICON, figure,
  page(el) {
    pageEl = el;
    el.classList.add('rb-page');
    renderPage();
    load(true);
    clearInterval(timer);
    timer = setInterval(() => { if (pageEl?.isConnected && document.visibilityState === 'visible') load(true); else if (!pageEl?.isConnected) clearInterval(timer); }, 60000);
    el.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.closest('[data-rb-reload]')) { error = null; renderPage(); return load(true); }
      const unk = t.closest('[data-rb-unknown]');
      if (unk) { const i = Number(unk.dataset.rbUnknown); openUnknown = openUnknown === i ? null : i; AOS.haptic('selection'); renderPage(); return; }
      const tag = t.closest('[data-rb-tag]');
      if (tag) {
        tag.disabled = true;
        const r = await post('/rules', { pattern: rx(tag.dataset.title), area: tag.dataset.rbTag });
        if (r) { openUnknown = null; AOS.haptic('success'); AOS.toast(`Rule kept · ${r.applied ?? 0} sample${r.applied === 1 ? '' : 's'} tagged`); renderPage(); }
        else tag.disabled = false;
        return;
      }
      const keep = t.closest('[data-rb-keep]');
      if (keep) { keep.disabled = true; const r = await post(`/rules/${keep.dataset.rbKeep}/keep`); if (r) { AOS.haptic('success'); AOS.toast(`Kept · ${r.applied ?? 0} tagged`); } else keep.disabled = false; return; }
      const drop = t.closest('[data-rb-drop]');
      if (drop) { drop.disabled = true; if (await post(`/rules/${drop.dataset.rbDrop}/drop`)) AOS.toast('Dropped'); else drop.disabled = false; return; }
      const del = t.closest('[data-rb-redact-del]');
      if (del) { const list = [...(state.redact ?? [])]; list.splice(Number(del.dataset.rbRedactDel), 1); if (await post('/settings', { redact: list }, 'PUT')) AOS.toast('Pattern removed'); }
    });
    el.addEventListener('submit', async (e) => {
      if (!e.target.matches('[data-rb-redact-form]')) return;
      e.preventDefault();
      const input = e.target.querySelector('input'), v = input.value.trim();
      if (!v) { input.focus(); return; }
      if (await post('/settings', { redact: [...(state.redact ?? []), v] }, 'PUT')) {
        const again = pageEl?.querySelector('[data-rb-redact-form] input');
        if (again) again.value = '';
        AOS.toast('Hidden from now on');
      }
    });
  },
  cards: {
    todayTop(el, m) {
      cardEl = el; lastM = m;
      if (!el._rbWired) { el._rbWired = true; el.addEventListener('click', (e) => { if (e.target.closest('[data-rb-open]')) { AOS.haptic('light'); AOS.openPage('ribbon'); } }); }
      renderCard(el, m);
      if (!state && !loading) load();
    },
  },
  onData() { if (AOS.user?.role === 'owner') load(); },
});
