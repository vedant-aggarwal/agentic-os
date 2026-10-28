// Job progress (CONTRACT §1 and §4): the strip above the job composer, the thin bar in job rows, and the full
// stage/step list for the progress sheet. `job.progress` is null until the agent reports a plan.
const { AOS } = window;
const { esc } = AOS;

const FINISHED = ['done', 'skipped'];
const stepsOf = (p) => (p?.stages ?? []).flatMap((s) => (s.steps ?? []).map((t) => ({ ...t, stage: s.name })));
export const hasProgress = (p) => !!p && ((p.total ?? 0) > 0 || stepsOf(p).length > 0);
function counts(p) {
  const all = stepsOf(p);
  return { all, total: p.total ?? all.length, done: p.done ?? all.filter((s) => FINISHED.includes(s.status)).length };
}
const activeOf = (p, all) => p.active ?? all.find((s) => s.status === 'active')?.title ?? all.find((s) => s.status === 'pending')?.title ?? null;
const stageOf = (p, all) => p.stage ?? all.find((s) => s.title === activeOf(p, all))?.stage ?? null;
const STATE = { running: 'Working', needs_input: 'Needs you', error: 'Stuck', done: 'Done' };
/** Where a job stands, for its ring and figure: { done, total, active, stage, state }, or null without a plan. */
export function progOf(p) {
  if (!hasProgress(p)) return null;
  const { all, total, done } = counts(p);
  return { done, total: Math.max(total, done, 1), active: p.state === 'done' ? 'Done' : activeOf(p, all), stage: stageOf(p, all), state: p.state ?? null };
}

/** Job rows: a thin bar under the title plus "3/7 · Active step". Empty when there is no progress. */
export function progRowHTML(p) {
  if (!hasProgress(p)) return '';
  const { all, total, done } = counts(p);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const now = p.state === 'done' ? 'Done' : activeOf(p, all);
  return `<span class="wr-prog s-${esc(p.state)}"><span class="wp-bar" aria-hidden="true"><i style="width:${pct}%"></i></span><span class="wp-text">${done}/${total}${now ? ` · ${esc(now)}` : ''}</span></span>`;
}

/** The strip above the composer: one segment per step, "3/7", the active step, its stage. */
export function progStripHTML(p) {
  const { all, total, done } = counts(p);
  const many = all.length > 40 || !all.length;
  const bar = many
    ? `<i class="fill" style="width:${total ? Math.round((done / total) * 100) : 0}%"></i>`
    : all.map((s) => `<i class="s-${esc(s.status)}"></i>`).join('');
  const now = p.state === 'done' ? 'All done' : activeOf(p, all) ?? '';
  const stage = (p.stages?.length ?? 0) > 1 && p.state !== 'done' ? stageOf(p, all) : null;
  return `<span class="jps-bar${many ? ' many' : ''}" aria-hidden="true">${bar}</span><span class="jps-text"><b>${done}/${total}</b><span class="jps-step">${esc(now)}</span>${stage ? `<span class="jps-stage">${esc(stage)}</span>` : ''}<svg class="jps-up" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 8.5 7 4.5l4 4"/></svg></span>`;
}
export const progLabel = (p) => { const { all, total, done } = counts(p); const now = activeOf(p, all); return `Progress: ${done} of ${total} steps done${now && p.state !== 'done' ? `, now ${now}` : ''}. Show all steps`; };

const MARK = {
  done: '<svg viewBox="0 0 14 14"><path d="m3.5 7.3 2.4 2.3 4.6-5"/></svg>',
  error: '<svg viewBox="0 0 14 14"><path d="m4.5 4.5 5 5m0-5-5 5"/></svg>',
  skipped: '<svg viewBox="0 0 14 14"><path d="M4 7h6"/></svg>',
};
const hhmm = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }); };

/** The plan sheet: its title, "3 of 7 done · Build", then every stage with its steps (the mockup's plan card). */
export function progHeadHTML(p) {
  const { all, total, done } = counts(p);
  const sub = [`${done} of ${total} done`, p.state && p.state !== 'running' ? STATE[p.state] : null, p.state !== 'done' ? stageOf(p, all) : null].filter(Boolean).join(' · ');
  return `<div class="jsh-head"><div><h2>${esc(p.title && p.title !== 'Plan' ? p.title : 'Plan')}</h2><p class="pl-sub s-${esc(p.state ?? '')}">${esc(sub)}</p></div><button type="button" class="sheet-close" data-sheet-close aria-label="Close">${AOS.icons.x}</button></div>`;
}
export function progListHTML(p) {
  return `${p.note ? `<p class="pl-note">${esc(p.note)}</p>` : ''}<div class="jplan"><ol class="pl">${(p.stages ?? []).map((s) => {
    const st = s.steps ?? [];
    const fin = st.filter((x) => FINISHED.includes(x.status)).length;
    return `<li class="pl-s"><span class="pl-n">${esc(s.name)}<span class="num">${fin}/${st.length}</span></span>${st.map((x) => `<div class="pl-r s-${esc(x.status)}"${x.status === 'active' ? ' aria-current="step"' : ''}><span class="pl-c" aria-hidden="true">${MARK[x.status] ?? ''}</span><span class="pl-t">${esc(x.title)}</span>${x.at && x.status !== 'pending' ? `<time class="cap num">${esc(hhmm(x.at))}</time>` : ''}</div>`).join('')}</li>`;
  }).join('')}</ol></div>`;
}
