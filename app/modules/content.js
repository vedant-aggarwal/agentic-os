// Content OS on the phone: the Content tab. A hero (this week's reels as a ring, the edits waiting for you, and the
// shoot as the one action), then Inbox · Pack · Edits · Posts, a search sheet and the teleprompter.
// Server: server/modules/content.ts answers /api/v1/mod/content/*; the data lives in content.db through the CLI.
// Design: j15/mockup/final/js/content.js and css/screens/content.css, both skins (app/ui/STRUCTURE.md, area (d)).
const { AOS } = window;
AOS.css('modules/content.css');

const I = AOS.icons;
const esc = AOS.esc;
const IST = 'Asia/Kolkata';
const api = (path, body, method) => AOS.api(`/mod/content${path}`, body === undefined ? undefined : { method: method ?? 'POST', body: JSON.stringify(body) });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? `${one}s`}`;
const istDate = (d = new Date()) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateText = (date) => { const d = new Date(`${date}T12:00:00Z`); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const shortDate = (date) => { const d = new Date(`${date}T12:00:00Z`); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: IST }) : '');
const dayOfIso = (iso) => (iso ? istDate(new Date(iso)) : null);
const todayOf = () => st.ov?.today ?? AOS.today;
function dayName(date) {
  const diff = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${todayOf()}T12:00:00Z`)) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : dateText(date);
}
// "Today 18:30", "Tomorrow 09:00", "Fri 18:30" within the week, else "28 Oct 18:30"
function whenText(iso) {
  const d = dayOfIso(iso);
  if (!d) return '';
  const diff = Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${todayOf()}T12:00:00Z`)) / 864e5);
  return `${diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff > 1 && diff < 7 ? dateText(d).slice(0, 3) : shortDate(d)} ${hm(iso)}`;
}
// a scheduled job's last run: "ran 21 Oct 02:30" / "failed …" / null
const ranText = (j) => (j?.at ? `${j.ok ? 'ran' : 'failed'} ${shortDate(dayOfIso(j.at))} ${hm(j.at)}` : null);
const bytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

// Both channels live in the Content domain: two steps of its colour, always written next to the handle.
const TINT = { northwindstudio: 'var(--content)', example_creator: 'var(--content-2)' };
const tint = (ch) => TINT[ch] ?? 'var(--content)';
const mark = (ch) => (ch ? `<span class="dot" style="--c:${tint(ch)}"></span>` : '');
const SOURCE = { evidence: 'From your work', share: 'Shared', email: 'Email', keyword: 'From a task', radar: 'Radar', agent: 'Agent', chat: 'Typed', import: 'Imported', cli: 'CLI', reel: 'Reel' };
const srcIcon = (i) => (i.reference ? I.film : i.source === 'evidence' ? I.hammer : I.bulb);
// a status is a coloured word that leads the meta line
const word = (text, c, spin = false) => `<span class="ct-st" style="--c:${c}">${spin ? '<span class="spin" style="--c:var(--content)" aria-hidden="true"></span>' : ''}${esc(text)}</span>`;

const st = {
  ov: null, todayPack: null, error: null, at: 0, loading: null, loadingFor: null,
  tab: 'inbox', filter: 'all', open: null, date: null, dayLoading: false,
  busy: new Set(), gone: new Set(), ideaStatus: new Map(), local: {}, timers: new Map(), uploads: [],
  page: null, card: null, cardM: null,
};
const busy = (k) => st.busy.has(k);
const visible = () => { const p = document.getElementById('pageContent'); return !!p && !p.hidden; };

// ── data ──────────────────────────────────────────────────────────────────
function load(date = st.date) {
  const want = date ?? '';
  if (st.loading && st.loadingFor === want) return st.loading;
  st.loadingFor = want;
  const run = (async () => {
    try {
      const ov = await api(`/overview${date ? `?date=${date}` : ''}`);
      if (st.loadingFor !== want) return;                     // a newer day was asked for meanwhile
      st.ov = ov; st.date = ov.date; st.error = null; st.at = Date.now();
      if (ov.pack?.date === ov.today) st.todayPack = ov.pack;
      st.gone.clear(); st.ideaStatus.clear();
    } catch (e) {
      if (st.loadingFor !== want) return;
      st.error = e.message || 'Your PC isn’t reachable right now.';
      if (st.ov?.pack?.loading) st.ov.pack = { ...st.ov.pack, loading: false, failed: true };
    } finally {
      if (st.loadingFor === want) { st.loading = null; st.dayLoading = false; }
    }
    draw();
    renderCard();
  })();
  st.loading = run;
  return run;
}
// one write: mark it busy, call the server, say what happened, then read the overview again
async function act(key, fn, ok) {
  if (busy(key)) return;
  st.busy.add(key);
  draw();
  try {
    const r = await fn();
    const text = typeof ok === 'function' ? ok(r) : ok;
    if (text) AOS.toast(text);
    AOS.haptic('success');
  } catch (e) { AOS.toast(e.message || 'That didn’t work'); AOS.haptic('light'); }
  finally { st.busy.delete(key); }
  await load(st.date);
}

// ── the tab ───────────────────────────────────────────────────────────────
const head = () => '<div class="phead"><h1 class="large-title">Content</h1></div>';
function draw() {
  const el = st.page;
  if (!el?.isConnected) return;
  acts();
  if (!st.ov) {
    el.innerHTML = head() + (st.error
      ? `<div class="note ct-state" role="alert"><b>${esc(st.error)}</b><span>Content OS lives on your PC.</span><button class="btn sm" data-ct="retry">Try again</button></div>`
      : '<div class="ct-state ct-loading" role="status"><span class="spin" aria-hidden="true"></span>Reading Content OS on your PC</div>');
    return;
  }
  const first = !el.querySelector('#ctPanel');
  if (first) el.innerHTML = `${head()}<div id="ctHero"></div><div class="ct-segwrap" id="ctSeg"></div><div class="ct-panel" id="ctPanel" role="tabpanel"></div>`;
  renderHero();
  renderSeg();
  renderPanel();
  if (first && visible()) AOS.pulse(el);
}
/** The bar's two buttons: search everything, and a new idea. */
function acts() {
  const a = document.getElementById('contentActs');
  if (!a || a.dataset.ct) return;
  a.dataset.ct = '1';
  a.innerHTML = `<button class="gbtn chrome icon" data-ct="search" aria-label="Search content">${I.search}</button><button class="gbtn chrome icon" data-ct="new" aria-label="New idea">${I.plus}</button>`;
  a.addEventListener('click', onClick);
}

// ── hero: this week's reels as a ring beside the edits waiting for you; the shoot is the one action ──
function weekOf(t) { const d = new Date(`${t}T12:00:00Z`); const mon = addDays(t, -((d.getUTCDay() + 6) % 7)); return [mon, addDays(mon, 6)]; }
const booked = (p) => !!p.at && !['failed', 'cancelled', 'canceled'].includes(p.status);
const live = (p) => booked(p) && p.status !== 'dry-run';
function heroHTML() {
  const ov = st.ov, t = ov.today;
  const [mon, sun] = weekOf(t);
  const week = ov.posts.filter((p) => live(p) && dayOfIso(p.at) >= mon && dayOfIso(p.at) <= sun).length;
  const perDay = Object.keys(ov.settings.reels_per_day ?? {}).reduce((s, ch) => s + (ov.settings.reels_per_day[ch] ?? ov.defaults?.[ch] ?? 0), 0);
  const goal = perDay * 7;
  const n = (s) => ov.edits.filter((e) => e.status === s).length;
  const review = n('review'), redo = n('redo'), draft = n('draft');
  const sub = [redo ? `${redo} with the editor` : '', draft ? `${draft} not rendered` : ''].filter(Boolean).join(' · ') || (review ? 'Rendered and waiting for you' : 'Nothing waiting for you');
  const next = ov.posts.filter((p) => booked(p) && Date.parse(p.at) > Date.now()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  // a dry run books the slot and sends nothing, so it is a slot, not a post
  const nextLine = next ? `${next.status === 'dry-run' ? 'Next slot' : 'Next post'} <b class="num">${esc(whenText(next.at))}</b>` : 'No post booked yet';
  const ring = AOS.ring(goal ? week / goal : 0, 'content', 100, 12, {
    inner: `<span class="ct-ring-in"><b class="met" data-count="${week}">${week}</b>${goal ? `<small class="met">/${goal}</small>` : ''}</span>`,
    label: goal ? `${week} of ${goal} reels this week` : `${week} reels this week`,
  });
  return `<section class="ct-hero surface" aria-label="This week">
    <div class="ct-hero-main">
      <div class="ct-ringcol">${ring}<span class="ct-ring-l">Reels this week</span></div>
      <div class="ct-stats">
        <span class="ct-k">Edits to approve</span>
        <b class="met ct-big${review ? ' c-content' : ''}"><span data-count="${review}">${review}</span></b>
        <span class="ct-sl">${esc(sub)}</span>
        <span class="ct-sl">${nextLine}</span>
      </div>
    </div>
    ${nextHTML()}
  </section>`;
}
// the hero's last line: what to do with today's pack
function nextHTML() {
  const p = st.todayPack;
  const scripts = p?.scripts ?? [], pending = p?.pending ?? [];
  const shot = scripts.filter((s) => s.status === 'shot').length;
  let text, foot, btn = '';
  if (scripts.length && shot < scripts.length) {
    text = 'Shoot pack ready';
    foot = `${plural(scripts.length, 'script')} · ${plural(p.setups.length, 'setup')}${shot ? ` · ${shot} shot` : ''}`;
    btn = `<button class="btn sm primary" style="--c:var(--content-fill)" data-ct="shoot">${I.play}Start shoot</button>`;
  } else if (scripts.length) {
    text = 'Pack shot';
    foot = `${shot} of ${scripts.length} shot today`;
    btn = `<button class="btn sm" data-ct="footage">${I.up}Footage</button>`;
  } else if (pending.length) {
    text = busy('plan') ? 'Claude is writing the pack' : 'Pack picked, not written';
    foot = `${plural(pending.length, 'script')} to write for today`;
    btn = `<button class="btn sm" data-ct="to-pack">Open pack</button>`;
  } else {
    text = 'No shoot pack today';
    const ran = ranText(st.ov.jobs?.plan);
    foot = ran ? `The nightly plan ${esc(ran)}` : 'The nightly plan runs at 02:30';
    btn = planBtn(todayOf(), 'Plan now');
  }
  return `<div class="ct-next"><span class="ct-next-t"><b>${esc(text)}</b><span class="foot">${foot}</span></span>${btn}</div>`;
}
const planBtn = (date, label) => {
  const on = busy('plan');
  return `<button class="btn sm" data-ct="plan" data-date="${esc(date)}" ${on ? 'disabled' : ''}>${on ? '<span class="spin" aria-hidden="true"></span>Planning' : `${I.sparkle}${esc(label)}`}</button>`;
};
function renderHero() {
  const el = st.page?.querySelector('#ctHero');
  if (el) el.innerHTML = heroHTML();
}

// ── the view switch ───────────────────────────────────────────────────────
// open ideas on the PC (the overview sends the newest 120 of them), the day's pack, the edits not yet approved
const openIdeas = (ov) => ['inbox', 'picked', 'scripted'].reduce((s, k) => s + (ov.counts?.ideas?.[k] ?? 0), 0);
function counts() {
  const ov = st.ov;
  const shown = ov.inbox.filter((i) => !st.gone.has(i.id)).length;
  return {
    inbox: Math.max(shown, openIdeas(ov) - (ov.inbox.length - shown)),
    pack: ov.pack.scripts.length + ov.pack.pending.length,
    edits: ov.edits.filter((e) => e.status !== 'approved').length,
  };
}
function renderSeg() {
  const el = st.page?.querySelector('#ctSeg');
  if (!el) return;
  const c = counts();
  el.innerHTML = AOS.seg('ct-view', [['inbox', 'Inbox', c.inbox || ''], ['pack', 'Pack', c.pack || ''], ['edits', 'Edits', c.edits || ''], ['posts', 'Posts']], st.tab, { role: 'tab', label: 'Content' });
}
function renderPanel(anim = false) {
  const el = st.page?.querySelector('#ctPanel');
  if (!el || !st.ov) return;
  // a redraw keeps what you were typing in the idea field
  const inp = el.querySelector('#ctIdea');
  const keep = inp ? { v: inp.value, f: document.activeElement === inp, s: inp.selectionStart ?? inp.value.length } : null;
  el.innerHTML = offlineHTML() + ({ inbox: inboxHTML, pack: packHTML, edits: editsHTML, posts: postsHTML }[st.tab] ?? inboxHTML)();
  if (keep) {
    const n = el.querySelector('#ctIdea');
    if (n) { n.value = keep.v; if (keep.f) { n.focus({ preventScroll: true }); try { n.setSelectionRange(keep.s, keep.s); } catch {} } }
  }
  if (anim) { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); AOS.pulse(el); }
}
// the PC stopped answering after a first read: keep what is here and say how old it is
const offlineHTML = () => (st.error ? `<div class="note ct-offline" role="status"><span><b>Offline</b> Showing what this phone read at ${esc(hm(new Date(st.at).toISOString()))}. ${esc(st.error)}</span><button class="btn sm" data-ct="retry">Try again</button></div>` : '');

// ── inbox ─────────────────────────────────────────────────────────────────
const FILTERS = [['all', 'All'], ['write', 'To write'], ['work', 'From work'], ['reels', 'Reels'], ['scripted', 'Scripted']];
const statusOf = (i) => st.ideaStatus.get(i.id) ?? i.status;
const fits = (f, i) => f === 'all' || (f === 'write' && ['inbox', 'picked'].includes(statusOf(i))) || (f === 'work' && i.source === 'evidence') || (f === 'reels' && !!i.reference) || (f === 'scripted' && statusOf(i) === 'scripted');
function inboxHTML() {
  const ov = st.ov;
  const ideas = ov.inbox.filter((i) => !st.gone.has(i.id));
  const list = ideas.filter((i) => fits(st.filter, i));
  const label = FILTERS.find(([v]) => v === st.filter)?.[1] ?? 'All';
  const total = openIdeas(ov) - (ov.inbox.length - ideas.length);
  const capBusy = busy('capture');
  // a filter with nothing in it stays out of the row, unless it is the one you chose
  const chips = FILTERS.map(([v, l]) => [v, l, ideas.filter((i) => fits(v, i)).length]).filter(([v, , n]) => n || v === 'all' || v === st.filter)
    .map(([v, l, n]) => `<button class="chip-btn${st.filter === v ? ' on' : ''}" data-ct="filter" data-v="${v}" aria-pressed="${st.filter === v}">${l}<span class="chip-count">${n}</span></button>`).join('');
  return `<form class="ct-add" data-ct-form="idea">
      <label class="ifield ct-field">${I.bulb}<input id="ctIdea" name="text" type="text" placeholder="An idea, or paste a reel link" enterkeyhint="done" autocomplete="off" aria-label="New idea" ${capBusy ? 'disabled' : ''}></label>
      <button class="btn ct-addbtn" type="submit" ${capBusy ? 'disabled' : ''}>${capBusy ? '<span class="spin" aria-hidden="true"></span>' : 'Add'}</button>
    </form>
    <div class="chips scroll ct-filters" role="group" aria-label="Filter the inbox">${chips}</div>
    ${total > ideas.length ? `<p class="ct-hint ct-window">Newest ${ideas.length} of ${total}. The rest stay on your PC.</p>` : ''}
    ${list.length ? `<div class="group ct-list">${list.map(ideaRow).join('')}</div>`
      : ideas.length ? `<div class="note ct-empty"><span>Nothing in ${esc(label)}.</span><button class="btn sm" data-ct="filter" data-v="all">Show all</button></div>`
      : '<div class="note">The inbox is empty. Type an idea above, or share a reel to the app from Instagram.</div>'}`;
}
function ideaWord(i) {
  if (busy(`script:${i.id}`)) return word('Writing script', 'var(--content-ink)', true);
  const s = statusOf(i);
  if (s === 'scripted') return word('Scripted', 'var(--done)');
  if (s === 'picked') return word('Picked', 'var(--ink)');
  if (i.reference) return i.transcript === 'done' ? word('Card ready', 'var(--content-ink)') : i.transcript === 'failed' ? word('Transcript failed', 'var(--fail-ink)') : word('Reel saved', 'var(--ink-2)');
  return word('New', 'var(--ink-3)');
}
function ideaRow(i) {
  const open = st.open === i.id;
  const s = statusOf(i);
  const writing = busy(`script:${i.id}`), moving = busy(`status:${i.id}`);
  const tags = (i.tags ?? []).filter(Boolean);
  return `<div class="ct-item${open ? ' open' : ''}" data-id="${esc(i.id)}">
    <button class="lrow ic" data-ct="open" aria-expanded="${open}">
      <span class="tile" style="--t:${tint(i.channel)}">${srcIcon(i)}</span>
      <span class="rbody">
        <span class="rtitle wrap">${esc(i.title)}</span>
        <span class="rmeta">${ideaWord(i)}<span>·</span>${mark(i.channel)}<span class="ell">${i.channel ? `@${esc(i.channel)} · ` : ''}${esc(SOURCE[i.source] ?? i.source ?? '')}</span></span>
      </span>
      <span class="ct-caret">${I.chevD}</span>
    </button>
    <div class="ct-acts"${open ? '' : ' inert'}><div>
      ${tags.length ? `<p class="ct-tags">Tagged ${tags.map(esc).join(' · ')}</p>` : ''}
      <div class="ct-acts-b">
        <button class="btn sm" data-ct="write" ${writing ? 'disabled' : ''}>${writing ? '<span class="spin" aria-hidden="true"></span>Writing' : `${I.edit}${s === 'scripted' ? 'Write again' : 'Write script'}`}</button>
        ${s === 'inbox' ? `<button class="btn sm" data-ct="pick" ${moving ? 'disabled' : ''}>${I.check}Pick</button>` : s === 'picked' ? `<button class="btn sm" disabled>${I.check}Picked</button>` : ''}
        ${i.link ? `<a class="btn sm" href="${esc(i.link)}" target="_blank" rel="noopener">${I.link}${i.reference ? 'Reel' : 'Link'}</a>` : ''}
        <button class="btn sm ct-drop" data-ct="drop" aria-label="Drop this idea" ${moving ? 'disabled' : ''}>${I.trash}</button>
      </div>
    </div></div>
  </div>`;
}
function addIdea(form) {
  const input = form.querySelector('#ctIdea');
  const text = input?.value.trim();
  if (!text) { input?.focus(); return; }
  const link = text.match(/https?:\/\/\S+/)?.[0];
  st.filter = 'all'; st.open = null;
  act('capture', async () => {
    const r = await api('/ideas', { text: link ? text.replace(link, '').trim() || text : text, link: link ?? '', source: 'chat' });
    const live = st.page?.querySelector('#ctIdea');   // the busy redraw replaced the field: clear the one on screen
    if (live) live.value = '';
    st.fresh = r?.idea?.id ?? null;
    return r;
  }, link ? 'Saved. The reel is being fetched' : 'Idea saved').then(() => {
    const row = st.fresh && st.page?.querySelector(`.ct-item[data-id="${CSS.escape(st.fresh)}"]`);
    if (row) row.classList.add('ct-in');
    st.fresh = null;
  });
}
function toggleIdea(item) {
  const id = item.dataset.id;
  st.open = st.open === id ? null : id;
  for (const it of st.page.querySelectorAll('.ct-item')) {
    const o = it.dataset.id === st.open;
    it.classList.toggle('open', o);
    it.querySelector('.lrow')?.setAttribute('aria-expanded', String(o));
    const a = it.querySelector('.ct-acts');
    if (a) a.inert = !o;
  }
  AOS.haptic('selection');
}
function setIdeaStatus(i, status, { undo }) {
  const was = statusOf(i);
  const key = `status:${i.id}`;
  const done = () => { if (status === 'dropped') st.gone.add(i.id); else st.ideaStatus.set(i.id, status); st.open = null; renderSeg(); renderPanel(); };
  const row = st.page?.querySelector(`.ct-item[data-id="${CSS.escape(i.id)}"]`);
  if (status === 'dropped' && row && !matchMedia('(prefers-reduced-motion: reduce)').matches) { row.classList.add('ct-out'); setTimeout(done, 240); } else done();
  st.busy.add(key);
  api(`/ideas/${i.id}`, { status })
    .then(() => {
      AOS.haptic('success');
      AOS.toast(undo, async () => {
        st.gone.delete(i.id); st.ideaStatus.set(i.id, was); renderSeg(); renderPanel();
        try { await api(`/ideas/${i.id}`, { status: was }); } catch (e) { AOS.toast(e.message || 'Undo didn’t reach your PC'); }
        load(st.date);
      });
    })
    .catch((e) => { st.gone.delete(i.id); st.ideaStatus.delete(i.id); AOS.toast(e.message || 'That didn’t work'); renderSeg(); renderPanel(); })
    .finally(() => { st.busy.delete(key); });
}
function writeScript(i, date = st.date ?? todayOf()) {
  st.open = null;
  act(`script:${i.id}`, () => api(`/ideas/${i.id}/script`, { date }), (r) => {
    const code = r?.script?.take;
    return `Script written${code ? ` as ${code}` : ''} in ${date === todayOf() ? 'today’s pack' : `the pack for ${dateText(date)}`}`;
  });
}

// ── pack ──────────────────────────────────────────────────────────────────
const SCRIPT_WORD = { draft: ['Ready', 'var(--done)'], approved: ['Approved', 'var(--done)'], shot: ['Shot', 'var(--ink-3)'], rejected: ['Rejected', 'var(--fail-ink)'] };
function packHTML() {
  const ov = st.ov, p = ov.pack, date = p.date;
  const rel = dayName(date);
  const sum = p.shootDay ? `${plural(p.scripts.length, 'script')} · ${plural(p.setups.length, 'setup')}` : 'No pack yet';
  const nav = `<div class="ct-daynav">
      <button class="ct-daybtn" data-ct="day" data-d="-1" aria-label="Previous day">${I.chevL}</button>
      <div class="ct-day" aria-live="polite"><b>${esc(rel)}</b><span class="foot">${rel === dateText(date) ? '' : `${esc(dateText(date))} · `}${sum}</span></div>
      <button class="ct-daybtn ct-flip" data-ct="day" data-d="1" aria-label="Next day">${I.chevL}</button>
    </div>`;
  const dim = st.dayLoading ? ' ct-dim' : '';
  if (p.loading) return `${nav}<div class="ct-state ct-loading" role="status"><span class="spin" aria-hidden="true"></span>Reading the pack for ${esc(dateText(date))}</div>`;
  if (p.failed) return `${nav}<div class="note ct-empty"><span>Couldn’t read the pack for ${esc(dateText(date))}.</span><button class="btn sm" data-ct="retry">Try again</button></div>`;
  if (!p.shootDay) {
    const isToday = date === ov.today;
    return `${nav}<div class="${dim}">
      <div class="note ct-empty"><span>No shoot pack for ${esc(isToday ? 'today' : dateText(date))} yet. ${isToday ? 'The nightly plan makes one at 02:30.' : 'Claude can plan one now.'}</span>${isToday ? '' : planBtn(date, 'Plan now')}</div>
      ${settingsHTML()}${jobsHint()}</div>`;
  }
  const byId = new Map(p.scripts.map((s) => [s.id, s]));
  const placed = new Set(p.setups.flatMap((g) => g.scripts));
  const loose = p.scripts.filter((s) => !placed.has(s.id));
  const groups = p.setups.map((g) => ({ ...g, list: g.scripts.map((id) => byId.get(id)).filter(Boolean) }));
  if (loose.length) groups.push({ location: 'No setup yet', framing: '', props: '', list: loose });
  const setups = groups.map((g, n) => `<section class="group ct-setup${busy('plan') ? ' ct-dim' : ''}">
      <header class="ct-setup-h">
        <span class="ct-setup-k">Setup ${n + 1}</span>
        <h3 class="t2">${esc(g.location)}</h3>
        ${g.framing ? `<p class="ct-fl">${I.camera}<span>${esc(g.framing)}</span></p>` : ''}
        ${g.props ? `<p class="ct-fl">${I.tag}<span>${esc(g.props)}</span></p>` : ''}
      </header>
      ${g.list.map(takeRow).join('')}
    </section>`).join('');
  const pending = p.pending.length ? `<section class="group ct-setup">
      <header class="ct-setup-h"><span class="ct-setup-k">Picked, no script yet</span></header>
      ${p.pending.map(pendingRow).join('')}
    </section>` : '';
  const ran = ranText(ov.jobs?.plan);
  return `${nav}<div class="${dim}">${setups}${pending}
    <div class="ct-actrow">
      <p class="foot">${busy('plan') ? 'Claude is planning the pack' : ran ? `Nightly plan ${esc(ran)}` : 'The nightly plan runs at 02:30'}${p.task ? ` · ${esc(p.task)} on Today` : ''}</p>
      ${planBtn(date, 'Plan again')}
    </div>
    ${footageHTML()}
    ${settingsHTML()}${jobsHint()}</div>`;
}
function takeRow(s) {
  const [w, c] = SCRIPT_WORD[s.status] ?? [s.status, 'var(--ink-2)'];
  const meta = [s.seconds ? `~${s.seconds}s` : '', s.words ? plural(s.words, 'word') : ''].filter(Boolean).join(' · ');
  return `<button class="lrow ct-take" data-ct="take" data-id="${esc(s.id)}" aria-label="${esc(s.take ?? '')} ${esc(s.title)}. Open in the teleprompter">
    <span class="ct-code num">${esc(s.take ?? '–')}</span>
    <span class="rbody"><span class="rtitle wrap">${esc(s.title)}</span><span class="rmeta num">${word(w, c)}${meta ? `<span>· ${esc(meta)}</span>` : ''}</span></span>
    <span class="ct-play" aria-hidden="true">${I.play}</span>
  </button>`;
}
function pendingRow(x) {
  const on = busy(`script:${x.idea}`) || busy('plan');
  return `<div class="lrow ct-take">
    <span class="ct-code num">${esc(x.takeCode || '–')}</span>
    <span class="rbody"><span class="rtitle wrap">${esc(x.title)}</span><span class="rmeta">${on ? word('Claude is writing it', 'var(--content-ink)', true) : word('Not written yet', 'var(--ink-2)')}${x.channel ? `<span>·</span>${mark(x.channel)}<span class="ell">@${esc(x.channel)}</span>` : ''}</span></span>
    ${on ? '' : `<button class="btn sm" data-ct="write-pick" data-id="${esc(x.idea)}">${I.edit}Write</button>`}
  </div>`;
}
function footageHTML() {
  const ups = st.uploads.filter((u) => u.date === st.date);
  const rows = ups.map((u, k) => {
    const p = u.size ? Math.min(1, u.sent / u.size) : 0;
    const end = u.error ? `<span class="ct-st" style="--c:var(--fail-ink)">Failed</span>`
      : u.done ? `<span class="ct-ok" role="img" aria-label="Uploaded">${I.check}</span>`
      : `<span class="ct-up">${AOS.ring(p, 'content', 36, 4, { cls: 'ct-upring', label: `${Math.round(p * 100)}% uploaded` })}<b class="met ct-upn">${Math.round(p * 100)}</b></span>`;
    const meta = u.error ? esc(u.error) : u.done ? `Uploaded${u.take ? ` · take ${esc(u.take)}` : ''}` : 'Uploading';
    return `<div class="lrow ic ct-foot" data-u="${k}"><span class="tile">${I.film}</span><span class="rbody"><span class="rtitle">${esc(u.name)}</span><span class="rmeta num"><span>${bytes(u.size)}</span><span>·</span><span class="ell ct-fp">${meta}</span></span></span>${end}</div>`;
  }).join('');
  return `<div class="sh" id="ctFootage"><h2>Footage</h2>${ups.length ? `<span class="sh-count">${ups.length}</span>` : ''}</div>
    <div class="group">${rows}
      <label class="lrow ic ct-uprow"><span class="tile">${I.up}</span><span class="rbody"><span class="rtitle">Upload takes</span></span>${I.chevR}<input type="file" accept="video/*" multiple data-ct-upload class="vh" aria-label="Upload takes"></label>
    </div>
    <p class="ct-hint">${st.ov.flags?.transcribe ? 'Say the take code before the hook. Each upload is matched to its script by that code.' : 'Uploads are kept on your PC. They are matched to a script once a transcript key is set.'}</p>`;
}
// settings that still need a number say so, and show the default the pack uses until then
function perDay(ch) { const key = `reels_per_day.${ch}`; return key in st.local ? st.local[key] : st.ov.settings.reels_per_day?.[ch] ?? null; }
function settingsHTML() {
  const ov = st.ov;
  const chans = Object.keys(ov.settings.reels_per_day ?? {});
  const rows = chans.map((ch) => {
    const v = perDay(ch), unset = v == null, n = unset ? ov.defaults?.[ch] ?? 0 : v;
    return `<div class="lrow ct-set" data-ch="${esc(ch)}">
      <span class="ct-lead">${mark(ch)}</span>
      <span class="rbody"><span class="rtitle">@${esc(ch)}</span><span class="rmeta">${unset ? `${word('Needs a number', 'var(--needs-ink)')}<span class="ell">· using ${n} a day</span>` : 'Reels per day'}</span></span>
      <span class="ct-step${unset ? ' unset' : ''}">
        <button type="button" data-ct="step" data-ch="${esc(ch)}" data-d="-1" aria-label="Fewer reels a day for @${esc(ch)}" ${n <= 0 ? 'disabled' : ''}>${I.minus}</button>
        <b class="num" aria-live="polite">${n}</b>
        <button type="button" data-ct="step" data-ch="${esc(ch)}" data-d="1" aria-label="More reels a day for @${esc(ch)}" ${n >= 9 ? 'disabled' : ''}>${I.plus}</button>
      </span>
    </div>`;
  }).join('');
  const at = 'shoot_at' in st.local ? st.local.shoot_at : ov.settings.shoot_at;
  return `<div class="sh"><h2>Pack settings</h2></div>
    <div class="group">${rows}
      <div class="lrow ct-set ct-timerow">
        <span class="ct-lead">${I.clock}</span>
        <span class="rbody"><span class="rtitle">Shoot time</span><span class="rmeta">${at ? 'The Shoot block lands on Today at this time' : `${word('Needs a number', 'var(--needs-ink)')}<span class="ell">· the block lands without a time</span>`}</span></span>
        <span class="rend num ct-time${at ? '' : ' unset'}">${at ? esc(at) : 'Set'}</span>${I.chevR}
        <input type="time" class="ct-tin" data-ct-time="shoot_at" value="${esc(at ?? '')}" aria-label="Shoot time">
      </div>
    </div>`;
}
// the two jobs that feed the inbox: build in public (21:30) drafts ideas from done work, the sweep (every 15 min)
// files content: tasks and fetches pending reels
function jobsHint() {
  const j = st.ov.jobs ?? {};
  const b = ranText(j.buildpublic), s = ranText(j.sweep);
  const text = b || s ? `Build in public ${b ?? 'has not run yet'} · the inbox sweep ${s ?? 'has not run yet'}.` : 'Build in public (21:30) and the inbox sweep (every 15 minutes) have not run on this PC yet.';
  return `<p class="ct-hint">${esc(text)}</p>`;
}
function step(ch, d) {
  const key = `reels_per_day.${ch}`;
  const cur = perDay(ch) ?? st.ov.defaults?.[ch] ?? 0;
  const v = Math.max(0, Math.min(9, cur + d));
  if (v === perDay(ch)) return;
  st.local[key] = v;
  AOS.haptic('selection');
  renderPanel();
  renderHero();
  saveLater(key, v);
}
// a stepper saves a moment after the last tap, so three taps are one write
function saveLater(key, value, ms = 650) {
  clearTimeout(st.timers.get(key));
  st.timers.set(key, setTimeout(async () => {
    st.timers.delete(key);
    try { await api('/settings', { [key]: value }, 'PUT'); await load(st.date); }
    catch (e) { AOS.toast(e.message || 'Couldn’t save that'); }
    if (!st.timers.has(key)) delete st.local[key];   // a tap made while it saved keeps its own value
    renderHero(); renderPanel();
  }, ms));
}
function saveTime(key, value) {
  st.local[key] = value || null;
  renderPanel();
  saveLater(key, value ?? '', 0);
}
async function uploadFile(file) {
  const u = { name: file.name, size: file.size, sent: 0, done: false, error: null, take: null, date: st.date };
  st.uploads.unshift(u);
  renderPanel();
  const paint = () => {
    const k = st.uploads.filter((x) => x.date === st.date).indexOf(u);
    const row = k >= 0 && st.page?.querySelector(`.ct-foot[data-u="${k}"]`);
    if (!row || u.done || u.error) { if (st.tab === 'pack') renderPanel(); return; }
    const p = u.size ? u.sent / u.size : 0;
    AOS.setRing(row.querySelector('.ct-upring'), p, { bleed: false });
    const n = row.querySelector('.ct-upn'); if (n) n.textContent = Math.round(p * 100);
  };
  try {
    const start = await api('/uploads', { name: file.name, size: file.size, date: u.date });
    const chunk = start.chunk || 5 * 1024 * 1024;
    let offset = 0, tries = 0;
    while (offset < file.size) {
      const part = file.slice(offset, Math.min(file.size, offset + chunk));
      try {
        const r = await AOS.api(`/mod/content/uploads/${start.id}?offset=${offset}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: part });
        offset = r.offset; u.sent = offset; u.done = r.done; u.take = r.take; tries = 0;
      } catch (e) {
        if (++tries > 5) throw e;
        const s = await api(`/uploads/${start.id}`).catch(() => null);   // resume where the server is
        offset = s?.offset ?? offset;
        await new Promise((r) => setTimeout(r, 1500 * tries));
      }
      paint();
    }
    AOS.toast(`${file.name} uploaded`);
    AOS.haptic('success');
  } catch (e) { u.error = e.message || 'Upload failed'; }
  paint();
}

// ── edits ─────────────────────────────────────────────────────────────────
function editWord(e) {
  if (busy(`approve:${e.id}`)) return word('Approving', 'var(--ink-2)', true);
  return { review: word('Needs approval', 'var(--needs-ink)'), redo: word('Back with the editor', 'var(--content-ink)'), draft: word('Not rendered yet', 'var(--ink-2)'), approved: word('Approved', 'var(--done)') }[e.status] ?? word(e.status, 'var(--ink-2)');
}
function editsHTML() {
  const ov = st.ov;
  const postOf = new Map(ov.posts.filter((p) => p.edit).map((p) => [p.edit, p]));
  const rows = ov.edits.map((e) => {
    const post = postOf.get(e.id);
    const slot = post?.at ? `${post.status === 'dry-run' ? 'Booked' : 'Posts'} ${whenText(post.at)}${post.status === 'dry-run' ? ' · dry run' : ''}` : e.status === 'approved' ? 'No posting slot set' : `Made ${shortDate(e.created)}`;
    const note = e.notes?.length ? e.notes.at(-1).text : '';
    const ok = e.status === 'approved';
    const canApprove = !ok && !!e.render && !busy(`approve:${e.id}`);
    return `<div class="ct-edit${ok ? ' ok' : ''}" data-id="${esc(e.id)}">
      <span class="tile" style="--t:${tint(e.channel)}">${I.film}</span>
      <div class="ct-edit-b">
        <div class="rtitle wrap">${esc(e.title ?? e.id)}</div>
        <div class="rmeta">${editWord(e)}<span>·</span>${mark(e.channel)}<span class="ell">${e.channel ? `@${esc(e.channel)} · ` : ''}${esc(slot)}</span></div>
        ${note ? `<p class="ct-note">${I.chat}<span>${esc(note)}</span></p>` : ''}
        <div class="ct-edit-acts">
          ${ok ? '' : `<button class="btn sm tint" style="--c:var(--done)" data-ct="approve" ${canApprove ? '' : 'disabled'}>${busy(`approve:${e.id}`) ? '<span class="spin" aria-hidden="true"></span>' : I.check}Approve</button>`}
          <button class="btn sm" data-ct="note">${I.edit}Note</button>
        </div>
      </div>
    </div>`;
  }).join('');
  return `${rows ? `<div class="group ct-edits">${rows}</div>` : '<div class="note">No edits waiting. Rendered reels from Content OS land here for your OK.</div>'}
    <p class="ct-hint">${ov.flags?.post ? 'Approve books the next posting slot and schedules it through RealFlow.' : 'Posting is off on your PC, so Approve books the slot as a dry run and sends nothing.'} A note sends the edit back for another pass.</p>`;
}
function approve(e) {
  act(`approve:${e.id}`, () => api(`/edits/${e.id}/approve`, {}), (r) => {
    const at = r?.post?.at;
    return r?.dryRun ? `Approved as a dry run${at ? ` · slot ${whenText(at)}` : ' · set a posting slot to book one'}` : `Approved · posts ${at ? whenText(at) : 'in the next slot'}`;
  });
}
function noteSheet(e) {
  const last = e.notes?.length ? e.notes.at(-1).text : '';
  openSheet({
    title: 'Note for the editor', sub: esc(e.title ?? e.id),
    body: (b) => {
      b.innerHTML = `<div class="ct-notesheet">
        <label class="ifield ct-ta"><textarea rows="4" placeholder="What should change?" aria-label="Note for the editor" enterkeyhint="enter"></textarea></label>
        ${last ? `<p class="foot">Last note: ${esc(last)}</p>` : ''}
        <button class="btn primary block" style="--c:var(--content-fill)" data-ct-sheet="note-send" data-id="${esc(e.id)}" disabled>Send note</button>
      </div>`;
      const ta = b.querySelector('textarea'), btn = b.querySelector('.btn');
      ta.addEventListener('input', () => { btn.disabled = !ta.value.trim(); });
      setTimeout(() => ta.focus({ preventScroll: true }), 420);
    },
  });
}

// ── posts ─────────────────────────────────────────────────────────────────
function postRow(p, withDay = false) {
  const posted = p.status === 'posted';
  const meta = posted ? 'Posted' : p.status === 'scheduled' ? `Scheduled${p.realflow ? ' in RealFlow' : ''}` : p.status === 'dry-run' ? 'Dry run, not sent' : p.status === 'failed' ? 'Failed to post' : p.status;
  const failed = p.status === 'failed';
  return `<div class="lrow ic"><span class="tile" style="--t:${tint(p.channel)}">${posted ? I.check : I.clock}</span>
    <span class="rbody"><span class="rtitle">${esc(p.title ?? p.edit ?? p.id)}</span><span class="rmeta">${failed ? word('Failed to post', 'var(--fail-ink)') : ''}${mark(p.channel)}<span class="ell">@${esc(p.channel)}${failed ? '' : ` · ${esc(meta)}`}</span></span></span>
    ${p.at ? `<span class="rend num ct-ptime${p.status === 'dry-run' ? ' dry' : ''}">${esc(withDay ? `${shortDate(dayOfIso(p.at))} ${hm(p.at)}` : hm(p.at))}</span>` : ''}</div>`;
}
function postsHTML() {
  const ov = st.ov, t = ov.today;
  const groups = new Map();
  for (const p of ov.posts) { const k = p.at ? dayOfIso(p.at) : 'none'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  for (const list of groups.values()) list.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  const days = [...groups.keys()].filter((k) => k !== 'none');
  const ahead = days.filter((d) => d >= t).sort(), past = days.filter((d) => d < t).sort().reverse();
  const block = (title, list, first, withDay = false) => `<div class="sh ct-day-h${first ? ' first' : ''}"><h2>${esc(title)}</h2><span class="sh-count">${list.length}</span></div><div class="group">${list.map((p) => postRow(p, withDay)).join('')}</div>`;
  let n = 0;
  const parts = [];
  if (groups.has('none')) parts.push(block('No slot yet', groups.get('none'), !n++));
  for (const d of ahead) parts.push(block(dayName(d), groups.get(d), !n++));
  if (past.length) parts.push(block('Earlier', past.flatMap((d) => [...groups.get(d)].reverse()), !n++, true));
  return `${parts.join('') || '<div class="note ct-first">Nothing booked yet. Approve an edit and it takes the next posting slot.</div>'}
    ${slotsHTML()}`;
}
function slotsOf(ch) { const key = `slots.${ch}`; const v = key in st.local ? st.local[key] : st.ov.settings.slots?.[ch]; return String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean).sort(); }
function slotsHTML() {
  const chans = Object.keys(st.ov.settings.slots ?? {});
  const rows = chans.map((ch) => {
    const times = slotsOf(ch);
    return `<div class="lrow ct-slots">
      <span class="ct-lead">${mark(ch)}</span>
      <span class="rbody"><span class="rtitle">@${esc(ch)}</span>${times.length ? '' : `<span class="rmeta">${word('Needs a number', 'var(--needs-ink)')}<span class="ell">· Approve can’t book a time</span></span>`}
        <span class="ct-slotchips">${times.map((t) => `<button type="button" class="ct-slot num" data-ct="slot" data-ch="${esc(ch)}" data-t="${esc(t)}" aria-label="Remove the ${esc(t)} slot for @${esc(ch)}">${esc(t)}</button>`).join('')}<span class="ct-slot ct-slot-add" role="button" aria-label="Add a slot for @${esc(ch)}">${I.plus}<input type="time" class="ct-tin" data-ct-time="slot" data-ch="${esc(ch)}" aria-label="Add a posting slot for @${esc(ch)}"></span></span>
      </span>
    </div>`;
  }).join('');
  return `<div class="sh"><h2>Posting slots</h2></div><div class="group">${rows}</div>
    <p class="ct-hint">${st.ov.flags?.post ? 'Posts go out through RealFlow at these times.' : 'Posting is off on your PC, so these slots are booked as dry runs.'} Tap a time to remove it.</p>`;
}
function setSlots(ch, times) {
  const key = `slots.${ch}`;
  st.local[key] = times.join(',');
  renderPanel();
  saveLater(key, times.join(','), 0);
}

// ── search: ideas, the day's scripts, edits and posts; a result takes you to it ──
function searchSheet() {
  const ov = st.ov;
  if (!ov) return;
  const all = [
    ...ov.inbox.filter((i) => !st.gone.has(i.id)).map((i) => ({ t: i.title, m: `Idea · ${i.channel ? `@${i.channel}` : SOURCE[i.source] ?? ''}`, i: srcIcon(i), go: ['inbox', i.id] })),
    ...ov.pack.scripts.map((s) => ({ t: s.title, m: `Script ${s.take ?? ''} · ${dayName(ov.pack.date)}`, i: I.doc, go: ['pack', s.id] })),
    ...ov.edits.map((e) => ({ t: e.title ?? e.id, m: `Edit · ${{ review: 'Needs approval', redo: 'Back with the editor', draft: 'Not rendered yet', approved: 'Approved' }[e.status] ?? e.status}`, i: I.film, go: ['edits', e.id] })),
    ...ov.posts.map((p) => ({ t: p.title ?? p.edit ?? p.id, m: `Post · ${p.at ? whenText(p.at) : 'No slot yet'}`, i: I.clock, go: ['posts', p.id] })),
  ];
  openSheet({
    title: 'Search content', size: 'large', cls: 'ct-search-sheet',
    body: (b) => {
      b.innerHTML = `<label class="search ct-q">${I.search}<input type="search" placeholder="Ideas, scripts, edits, posts" autocomplete="off" enterkeyhint="search" aria-label="Search content"></label><div class="ct-res" aria-live="polite"></div>`;
      const res = b.querySelector('.ct-res');
      const paint = (q) => {
        const hits = all.map((x, k) => [x, k]).filter(([x]) => !q || String(x.t).toLowerCase().includes(q.toLowerCase()));
        res.innerHTML = hits.length
          ? `<p class="ct-res-n">${q ? plural(hits.length, 'match', 'matches') : `Everything · ${hits.length}`}</p><div class="group">${hits.slice(0, 80).map(([x, k]) => `<button class="lrow ic" data-ct-sheet="go" data-k="${k}"><span class="tile">${x.i}</span><span class="rbody"><span class="rtitle">${esc(x.t)}</span><span class="rmeta">${esc(x.m)}</span></span>${I.chevR}</button>`).join('')}</div>${hits.length > 80 ? `<p class="ct-hint">${hits.length - 80} more. Type a few more letters.</p>` : ''}`
          : `<div class="note">Nothing matches “${esc(q)}” in the newest ideas, this pack, the edits or the posts.</div>`;
      };
      b._all = all;
      paint('');
      const input = b.querySelector('input');
      input.addEventListener('input', () => paint(input.value.trim()));
      setTimeout(() => input.focus({ preventScroll: true }), 420);
    },
  });
}
function goTo(view, id) {
  closeSheet();
  if (view === 'pack' && id) { const list = st.ov.pack.scripts; if (list.some((s) => s.id === id)) { setTimeout(() => openTp(list, id), 300); return; } }
  showView(view);
  if (view === 'inbox' && id) { st.filter = 'all'; st.open = id; renderPanel(); }
  setTimeout(() => {
    const sc = st.page?.closest('.scroller');
    const sel = view === 'inbox' && id ? `.ct-item[data-id="${CSS.escape(id)}"]` : view === 'edits' && id ? `.ct-edit[data-id="${CSS.escape(id)}"]` : '#ctPanel';
    const target = st.page?.querySelector(sel) ?? st.page?.querySelector('#ctPanel');
    if (sc && target) sc.scrollTo({ top: target.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 120, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, 80);
}
function showView(v, anim = true) {
  if (st.tab === v) return;
  st.tab = v; st.open = null;
  AOS.selectSeg(st.page?.querySelector('[data-seg="ct-view"]'), v);
  renderPanel(anim);
}
function scrollToPanel(sel = '#ctPanel') {
  setTimeout(() => {
    const sc = st.page?.closest('.scroller'), t = st.page?.querySelector(sel);
    if (sc && t) sc.scrollTo({ top: Math.max(0, t.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 110), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, 60);
}
async function toTodayPack(sel) {
  if (st.date !== todayOf()) { st.dayLoading = true; await load(todayOf()); }
  showView('pack');
  scrollToPanel(sel);
}

// ── one sheet for this module (search, a note for the editor) ─────────────
let SH = null;
function sheet() {
  if (SH) return SH;
  const el = document.createElement('section');
  el.id = 'ctSheet';
  el.className = 'sheet ct-sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="grabber"></div><div class="sheet-head"></div><div class="sheet-body"></div>';
  (document.getElementById('screen') ?? document.body).appendChild(el);
  const fit = (H) => { const h = el.querySelector('.sheet-head')?.offsetHeight ?? 0, b = el.querySelector('.ct-sb')?.offsetHeight ?? 0; return { large: 0, fit: Math.max(0, Math.round(H - (22 + h + b + 34))) }; };
  SH = { el, s: AOS.makeSheet(el, { detents: fit, scrimFor: (y, H) => Math.min(1, Math.max(0, 1 - y / (H * 0.85))) }) };
  el.addEventListener('click', onSheetClick);
  return SH;
}
function openSheet({ title, sub = '', body, size = 'fit', cls = '' }) {
  const { el, s } = sheet();
  el.className = `sheet ct-sheet ${cls}${el.classList.contains('open') ? ' open' : ''}`;
  el.setAttribute('aria-label', title);
  el.querySelector('.sheet-head').innerHTML = `<div class="ct-shead"><div class="ct-shead-t"><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button class="sheet-close" data-ct-sheet="close" aria-label="Close">${I.x}</button></div>`;
  const b = el.querySelector('.sheet-body');
  b.innerHTML = '<div class="ct-sb"></div>';
  b.scrollTop = 0;
  body(b.querySelector('.ct-sb'));
  requestAnimationFrame(() => s.open(size));
  AOS.haptic('light');
}
const closeSheet = () => { if (SH?.s.isOpen) SH.s.close(); };
function onSheetClick(e) {
  const b = e.target.closest('[data-ct-sheet]');
  if (!b) return;
  const what = b.dataset.ctSheet;
  if (what === 'close') { closeSheet(); return; }
  if (what === 'go') { const x = SH.el.querySelector('.ct-sb')?._all?.[Number(b.dataset.k)]; if (x) goTo(...x.go); return; }
  if (what === 'note-send') {
    const id = b.dataset.id, text = SH.el.querySelector('textarea')?.value.trim();
    if (!text) return;
    closeSheet();
    act(`note:${id}`, () => api(`/edits/${id}/note`, { text }), 'Sent back to the editor with your note');
  }
}

// ── events ────────────────────────────────────────────────────────────────
const ideaBy = (id) => st.ov?.inbox.find((x) => x.id === id);
const editBy = (id) => st.ov?.edits.find((x) => x.id === id);
function onClick(e) {
  const b = e.target.closest('[data-ct]');
  if (!b || b.disabled) return;
  const what = b.dataset.ct;
  const item = b.closest('.ct-item'), ed = b.closest('.ct-edit');
  switch (what) {
    case 'search': searchSheet(); return;
    case 'new': {
      showView('inbox');
      const f = () => st.page?.querySelector('#ctIdea');
      scrollToPanel('.ct-add');
      setTimeout(() => f()?.focus({ preventScroll: true }), 380);
      return;
    }
    case 'retry': st.error = null; if (!st.ov) draw(); load(st.date); return;
    case 'open': if (item) toggleIdea(item); return;
    case 'filter': st.filter = b.dataset.v; st.open = null; AOS.haptic('selection'); renderPanel(); return;
    case 'write': { const i = ideaBy(item?.dataset.id); if (i) writeScript(i); return; }
    case 'write-pick': { const i = ideaBy(b.dataset.id) ?? { id: b.dataset.id }; writeScript(i); return; }
    case 'pick': { const i = ideaBy(item?.dataset.id); if (i) setIdeaStatus(i, 'picked', { undo: 'Picked for the next pack' }); return; }
    case 'drop': { const i = ideaBy(item?.dataset.id); if (i) setIdeaStatus(i, 'dropped', { undo: 'Idea dropped' }); return; }
    case 'day': {
      const next = addDays(st.date ?? todayOf(), Number(b.dataset.d));
      st.date = next; st.dayLoading = true; AOS.haptic('selection');
      st.ov = { ...st.ov, pack: { date: next, shootDay: null, task: null, scripts: [], setups: [], pending: [], loading: true } };
      renderSeg(); renderPanel();
      load(next);
      return;
    }
    case 'plan': {
      const date = b.dataset.date || st.date || todayOf();
      const fresh = date === st.ov.pack.date ? !!st.ov.pack.shootDay : date === todayOf() && !!st.todayPack?.shootDay;
      act('plan', () => api('/plan', { date, fresh }), (r) => `Pack planned: ${plural(r?.scripts?.length ?? 0, 'script')} for ${date === todayOf() ? 'today' : dateText(date)}`);
      return;
    }
    case 'take': { const list = st.ov.pack.scripts; openTp(list, b.dataset.id); return; }
    case 'shoot': { const list = st.todayPack?.scripts ?? []; const first = list.find((s) => s.status !== 'shot') ?? list[0]; if (first) openTp(list, first.id); return; }
    case 'footage': toTodayPack('#ctFootage'); return;
    case 'to-pack': toTodayPack('#ctPanel'); return;
    case 'step': step(b.dataset.ch, Number(b.dataset.d)); return;
    case 'approve': { const x = editBy(ed?.dataset.id); if (x) approve(x); return; }
    case 'note': { const x = editBy(ed?.dataset.id); if (x) noteSheet(x); return; }
    case 'slot': {
      const ch = b.dataset.ch, t = b.dataset.t, before = slotsOf(ch);
      setSlots(ch, before.filter((x) => x !== t));
      AOS.haptic('light');
      AOS.toast(`Removed the ${t} slot for @${ch}`, () => setSlots(ch, before));
      return;
    }
    default:
  }
}
function wire(el) {
  if (el._ctWired) return;
  el._ctWired = true;
  el.classList.add('ct');
  el.addEventListener('click', onClick);
  el.addEventListener('segchange', (e) => { if (e.target.dataset?.seg !== 'ct-view') return; st.tab = e.detail; st.open = null; renderPanel(true); });
  el.addEventListener('submit', (e) => { const f = e.target.closest('[data-ct-form="idea"]'); if (!f) return; e.preventDefault(); addIdea(f); });
  // a time field covers its row: a tap opens the phone's own picker (a desktop click asks for it)
  el.addEventListener('click', (e) => { const t = e.target.closest('.ct-tin'); if (t && typeof t.showPicker === 'function') { try { t.showPicker(); } catch {} } });
  el.addEventListener('change', (e) => {
    const up = e.target.closest('[data-ct-upload]');
    if (up) { for (const f of up.files) uploadFile(f); up.value = ''; return; }
    const t = e.target.closest('[data-ct-time]');
    if (!t) return;
    if (t.dataset.ctTime === 'shoot_at') { saveTime('shoot_at', t.value); AOS.haptic('selection'); return; }
    if (t.dataset.ctTime === 'slot' && t.value) {
      const ch = t.dataset.ch, before = slotsOf(ch);
      if (!before.includes(t.value)) { setSlots(ch, [...before, t.value].sort()); AOS.haptic('success'); AOS.toast(`Slot added · @${ch} at ${t.value}`, () => setSlots(ch, before)); }
      t.value = '';
    }
  });
}

// ── teleprompter: always dark, one line lit at a time ─────────────────────
let TP = null;
const SPEED_KEY = 'aos-tp-speed';
const savedSpeed = () => { try { const v = Number(localStorage.getItem(SPEED_KEY)); return v >= 0.3 && v <= 3 ? v : 1; } catch { return 1; } };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// a script's spoken text in reading units: one sentence a line, short fragments ("Rs.") kept with what follows
function linesOf(s) {
  const text = String(s?.teleprompter || s?.body || '').replace(/\r/g, '').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  if (!text) return ['This script has no spoken text yet.'];
  const out = [];
  for (const para of text.split(/\n+/)) {
    const p = para.trim();
    if (!p || /^#+\s/.test(p)) continue;
    const parts = (p.match(/[^.!?…।]+(?:[.!?…।]+["'”’)\]]*|$)/g) ?? [p]).map((x) => x.trim()).filter(Boolean);
    let carry = '';
    for (const x of parts) {
      const line = carry ? `${carry} ${x}` : x;
      if (line.length < 8) { carry = line; continue; }
      out.push(line); carry = '';
    }
    if (carry) out.push(carry);
  }
  return out.length ? out : [text];
}
function openTp(list, id) {
  const scripts = (list ?? []).filter(Boolean);
  if (!scripts.some((s) => s.id === id)) return;
  if (TP) closeTp(true);
  const el = document.createElement('div');
  el.className = 'ct-tp stay-dark';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Teleprompter');
  (document.getElementById('screen') ?? document.body).appendChild(el);
  TP = { el, list: scripts, id, y: 0, playing: false, speed: savedSpeed(), raf: 0, last: 0, counted: false, ended: false, cd: 0, shot: new Set(), lock: null, from: document.activeElement };
  fillTp();
  requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('in'); el.querySelector('[data-tp="play"]')?.focus({ preventScroll: true }); }));
  AOS.haptic('light');
  wake();
  el.addEventListener('click', onTpClick);
  // the words follow a drag while paused (1:1, from where you grabbed them); a tap on them starts or pauses
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    const v = e.target.closest('.ct-tp-view');
    if (!v || !TP) return;
    drag = { y0: e.clientY, start: TP.y, moved: false, paused: !TP.playing };
    if (drag.paused) { try { v.setPointerCapture(e.pointerId); } catch {} }
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag?.paused || !TP) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) > 6) { drag.moved = true; if (TP.ended) setPlaying(false); }
    if (drag.moved) { TP.y = clampY(drag.start - dy); drawTp(); }
  });
  el.addEventListener('pointerup', () => {
    const d = drag;
    drag = null;
    if (d && !d.moved && TP && !TP.el.querySelector('.ct-tp-play')?.disabled) togglePlay();
  });
  el.addEventListener('pointercancel', () => { drag = null; });
}
function current() { return TP.list.find((s) => s.id === TP.id); }
const isShot = (s) => s.status === 'shot' || TP.shot.has(s.id);
function nextOf(id) { const k = TP.list.findIndex((s) => s.id === id); return TP.list[(k + 1) % TP.list.length]; }
function fillTp() {
  const s = current();
  const lines = linesOf(s);
  const next = TP.list.length > 1 ? nextOf(TP.id) : null;
  const shot = isShot(s);
  const meta = [s.seconds ? `~${s.seconds}s` : '', s.words ? plural(s.words, 'word') : ''].filter(Boolean).join(' · ');
  TP.el.innerHTML = `
    <div class="ct-tp-top">
      <button class="gbtn chrome icon" data-tp="close" aria-label="Close the teleprompter">${I.x}</button>
      <div class="ct-tp-title"><b class="ct-tp-tt">${esc(s.title)}</b><small class="num"><span class="ct-tp-code">${esc(s.take ?? '')}</span>${meta ? ` · ${esc(meta)}` : ''}${shot ? ' · shot' : ''}</small></div>
      <span class="ct-tp-pos num">1/${lines.length}</span>
    </div>
    <div class="ct-tp-prog" aria-hidden="true"><i></i></div>
    <div class="ct-tp-view">
      <span class="ct-tp-guide" aria-hidden="true"></span>
      <div class="ct-tp-text">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
      <div class="ct-tp-count" aria-hidden="true"></div>
    </div>
    <div class="ct-tp-bot chrome">
      <div class="ct-tp-speed">
        <span class="foot">Speed</span>
        <input class="ct-range" type="range" min="0.3" max="3" step="0.1" value="${TP.speed}" aria-label="Scroll speed">
        <b class="num ct-tp-sv">${TP.speed.toFixed(1)}×</b>
      </div>
      <div class="ct-tp-ctl">
        <button class="btn sm" data-tp="mark" ${shot ? 'disabled' : ''}>${I.check}${shot ? 'Shot' : 'Mark shot'}</button>
        <button class="ct-tp-play" data-tp="play" aria-label="Start">${I.play}</button>
        <button class="btn sm" data-tp="next" ${next ? '' : 'disabled'}>${next ? `Next ${esc(next.take ?? '')}` : 'Next'}${I.arrowR}</button>
      </div>
    </div>`;
  TP.y = 0; TP.playing = false; TP.counted = false; TP.ended = false;
  TP.cd += 1;                                          // cancels a countdown left running for the last script
  TP.el.classList.remove('counting', 'playing');
  const r = TP.el.querySelector('.ct-range');
  const paint = () => r.style.setProperty('--v', `${((TP.speed - 0.3) / 2.7) * 100}%`);
  paint();
  r.addEventListener('input', () => { TP.speed = Number(r.value); TP.el.querySelector('.ct-tp-sv').textContent = `${TP.speed.toFixed(1)}×`; paint(); try { localStorage.setItem(SPEED_KEY, String(TP.speed)); } catch {} });
  requestAnimationFrame(() => { if (!TP) return; TP.y = firstY(); drawTp(); });
}
const tpLines = () => [...(TP?.el.querySelectorAll('.ct-tp-text p') ?? [])];
const mid = (p) => p.offsetTop + p.offsetHeight / 2;
const firstY = () => { const p = tpLines()[0]; return p ? mid(p) : 0; };
const lastY = () => { const ps = tpLines(); const p = ps[ps.length - 1]; return p ? mid(p) : 0; };
const clampY = (y) => Math.max(firstY(), Math.min(lastY(), y));
function drawTp() {
  if (!TP) return;
  TP.el.querySelector('.ct-tp-text').style.transform = `translate3d(0, ${-TP.y}px, 0)`;
  const ps = tpLines();
  let best = 0, bd = Infinity;
  ps.forEach((p, i) => { const d = Math.abs(mid(p) - TP.y); if (d < bd) { bd = d; best = i; } });
  ps.forEach((p, i) => { p.classList.toggle('cur', i === best); p.classList.toggle('past', i < best); });
  TP.el.querySelector('.ct-tp-pos').textContent = `${best + 1}/${ps.length}`;
  // the hairline under the title is how far through the script you are
  const span = lastY() - firstY();
  TP.el.querySelector('.ct-tp-prog i')?.style.setProperty('--k', span > 0 ? ((TP.y - firstY()) / span).toFixed(4) : '0');
}
function tick(ts) {
  if (!TP?.playing) return;
  const dt = TP.last ? Math.min(64, ts - TP.last) : 16;
  TP.last = ts;
  TP.y += (dt / 1000) * 42 * TP.speed;
  if (TP.y >= lastY()) { TP.y = lastY(); drawTp(); setPlaying(false, true); return; }
  drawTp();
  TP.raf = requestAnimationFrame(tick);
}
function setPlaying(v, ended = false) {
  if (!TP) return;
  TP.playing = v;
  const b = TP.el.querySelector('.ct-tp-play');
  b.innerHTML = v ? I.pause : ended ? I.undo : I.play;
  b.setAttribute('aria-label', v ? 'Pause' : ended ? 'Start again' : 'Start');
  TP.el.classList.toggle('playing', v);
  TP.ended = ended;
  if (v) { TP.last = 0; TP.raf = requestAnimationFrame(tick); } else cancelAnimationFrame(TP.raf);
}
// a workout-style countdown: each second closes a ring around its number
function countdown(done) {
  const c = TP.el.querySelector('.ct-tp-count');
  let n = 3;
  const token = (TP.cd += 1);
  TP.el.classList.add('counting');
  const stepCd = () => {
    if (!TP || TP.cd !== token) return;
    if (n === 0) { c.classList.remove('on'); c.innerHTML = ''; TP.el.classList.remove('counting'); done(); return; }
    c.innerHTML = `${AOS.ring(0, 'content', 184, 13, { cls: 'ct-cd-ring' })}<b class="met">${n}</b>`;
    c.classList.remove('on'); void c.offsetWidth; c.classList.add('on');
    AOS.haptic('selection');
    n -= 1;
    setTimeout(stepCd, 650);
  };
  stepCd();
}
function togglePlay() {
  if (!TP) return;
  if (TP.playing) { setPlaying(false); return; }
  if (TP.ended) { TP.y = firstY(); drawTp(); TP.ended = false; }
  if (!TP.counted && !reducedMotion()) {
    TP.counted = true;
    const b = TP.el.querySelector('.ct-tp-play');
    b.disabled = true;
    countdown(() => { if (!TP) return; TP.el.querySelector('.ct-tp-play').disabled = false; setPlaying(true); });
    return;
  }
  TP.counted = true;
  setPlaying(true);
}
function swapTp() {
  const v = TP.el.querySelector('.ct-tp-view');
  if (reducedMotion()) { fillTp(); return; }
  v.classList.add('ct-tp-swap');
  setTimeout(() => { if (!TP) return; fillTp(); TP.el.querySelector('.ct-tp-view').classList.add('ct-tp-swapin'); }, 220);
}
function markShot() {
  const s = current();
  if (!s || isShot(s)) return;
  const was = s.status;
  TP.shot.add(s.id);
  AOS.haptic('success');
  api(`/scripts/${s.id}`, { status: 'shot' })
    .then(() => {
      AOS.toast(`${s.take ?? 'Script'} marked shot`, async () => {
        TP?.shot.delete(s.id);
        try { await api(`/scripts/${s.id}`, { status: was === 'shot' ? 'draft' : was }); } catch (e) { AOS.toast(e.message || 'Undo didn’t reach your PC'); }
        if (TP && TP.id === s.id) fillTp();
        load(st.date);
      });
      load(st.date);
    })
    .catch((e) => { TP?.shot.delete(s.id); AOS.toast(e.message || 'Couldn’t mark it shot'); if (TP && TP.id === s.id) fillTp(); });
  const next = TP.list.find((x) => x.id !== s.id && !isShot(x));
  if (next) { setPlaying(false); TP.id = next.id; swapTp(); }
  else { const b = TP.el.querySelector('[data-tp="mark"]'); if (b) { b.disabled = true; b.innerHTML = `${I.check}Shot`; } }
}
function onTpClick(e) {
  const b = e.target.closest('[data-tp]');
  if (!b || b.disabled || !TP) return;
  const what = b.dataset.tp;
  if (what === 'close') closeTp();
  else if (what === 'play') togglePlay();
  else if (what === 'mark') markShot();
  else if (what === 'next') { setPlaying(false); TP.id = nextOf(TP.id).id; swapTp(); }
}
function closeTp(instant = false) {
  if (!TP) return;
  const { el, raf, lock, from } = TP;
  cancelAnimationFrame(raf);
  lock?.release().catch(() => {});
  TP.cd += 1;
  TP = null;
  if (from?.isConnected) from.focus?.({ preventScroll: true });   // back to the button that opened it
  if (instant || reducedMotion()) { el.remove(); return; }
  el.classList.remove('in');
  setTimeout(() => el.remove(), 420);
}
// keep the screen on while the teleprompter is open (where the phone allows it)
async function wake() {
  if (!navigator.wakeLock || !TP || TP.lock) return;
  const t = TP;
  try { const l = await navigator.wakeLock.request('screen'); if (TP === t) t.lock = l; else l.release().catch(() => {}); } catch {}
}
document.addEventListener('visibilitychange', () => { if (TP && document.visibilityState === 'visible') { TP.lock = null; wake(); } });
addEventListener('keydown', (e) => {
  if (!TP) return;
  if (e.key === 'Escape') { e.preventDefault(); closeTp(); }
  else if (e.key === ' ' && !e.target.closest?.('input, textarea, button')) { e.preventDefault(); togglePlay(); }
});

// ── Today card: the pack is ready ──────────────────────────────────────────
function renderCard() {
  const el = st.card;
  if (!el) return;
  const m = st.cardM;
  const p = st.todayPack;
  if (!p || (!p.scripts.length && !p.pending.length) || (m && !m.isToday)) { el.innerHTML = ''; return; }
  const n = p.scripts.length, shot = p.scripts.filter((s) => s.status === 'shot').length;
  const title = n ? (shot === n ? `Pack shot: ${plural(n, 'script')}` : `Shoot pack ready: ${plural(n, 'script')}`) : `Shoot pack: ${plural(p.pending.length, 'script')} to write`;
  const where = [...new Set(p.setups.map((g) => g.location))].join(' and ');
  const at = st.ov?.settings?.shoot_at;
  const meta = [at ?? '', where, shot && shot < n ? `${shot} shot` : '', p.pending.length && n ? `${p.pending.length} still to write` : ''].filter(Boolean).join(' · ') || plural(p.setups.length, 'setup');
  // a row of the brief's list on Today (area (a) frames the slot): a neutral glyph, what is ready, where and when
  el.innerHTML = `<button class="lrow b-row mcard" data-ct-open-pack><span class="bi">${I.camera}</span><span class="rbody"><span class="rtitle">${esc(title)}</span><span class="rmeta"><span class="ell">${esc(meta)}</span></span></span>${I.chevR}</button>`;
}

AOS.register({
  // tab: the Content tab is this page (AOS.openPage('content') opens the tab; More no longer lists it)
  id: 'content', title: 'Content', order: 10, tab: 'content',
  icon: '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2"/><path d="M8.5 7.5v5l4-2.5z"/></svg>',
  page(el) {
    st.page = el;
    wire(el);
    draw();
    if (!st.ov || Date.now() - st.at > 60_000) load(st.date);
  },
  onShow(el) {
    st.page = el;
    wire(el);
    draw();
    if (Date.now() - st.at > 60_000) load(st.date);
  },
  cards: {
    todayTop(el, m) {
      st.card = el; st.cardM = m;
      if (!el._wired) {
        el._wired = true;
        el.addEventListener('click', (e) => {
          if (!e.target.closest('[data-ct-open-pack]')) return;
          AOS.haptic('light');
          st.tab = 'pack';
          AOS.openPage('content');
          if (st.date !== todayOf()) { st.dayLoading = true; load(todayOf()); }
          draw();
        });
      }
      renderCard();
      if (!st.ov && !st.loading) load();
    },
  },
  onData() { if ((st.page?.isConnected || st.card) && Date.now() - st.at > 15_000) load(st.date); },
});
