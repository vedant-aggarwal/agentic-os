// Where a capture goes. One place that knows every destination the one lens can suggest: the nine apps' scan handlers
// (registerAspect({ scan })), Content OS (api.addContentIdea, through the bus) and the Brain (api.remember).
// Owner: CAPTURE. Read by js/capture.js, js/capture-share.js and js/brain.js.
//
// The handler contract (CONTRACT.md §4, extended in v2): handle(result, ctx)
//   result = { kind, title, fields, image (data URL or null), imageUrl (the PC's copy), id (the scan's id), summary, source }
//   ctx    = { auto, id, source }   auto: true when the agent files it without a tap (only for handlers with `auto: true`)
//   return (optional, may be a Promise) { undo?: () => void, where?: string, id?: string }: a handler that files silently says
//   so, and the lens shows "Filed · Undo". A handler that opens its own review sheet or page needs to return nothing.
import { $, $$ } from './core.js';
import { aspectsWith, aspectDef } from './aspects.js';
import { person, PEOPLE } from './data.js';
import { api, has } from './bus.js';

/** A person from a name as a chat shows it ("Dad", "Kabir Sharma"), or an id. */
export function personFrom(name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  return person(name) ?? PEOPLE.find((p) => p.name?.toLowerCase() === n || p.name?.toLowerCase().split(' ')[0] === n.split(' ')[0]
    || (p.aliases ?? []).some((a) => String(a).toLowerCase() === n)) ?? null;
}

// the app that takes a kind, and the handler it registered (null while that app is still a stub)
export function handlerFor(kind, fields = {}) {
  // a chat goes to the app of the person in it (Dad → Family); a chat with no one we know goes to Friends
  if (kind === 'chat') {
    for (const id of [personFrom(fields.person)?.aspect, 'friends']) {
      const def = id && aspectDef(id);
      const h = def?.scan?.find((s) => s.kind === 'chat');
      if (h) return { app: def.id, h };
    }
  }
  for (const def of aspectsWith('scan')) {
    const h = def.scan.find((s) => s.kind === kind);
    if (h) return { app: def.id, h };
  }
  return null;
}
/** Does anyone take this kind on this phone right now? (Content and the Brain take theirs through the bus.) */
export function takes(kind, fields = {}) {
  if (kind === 'reel' || kind === 'link') return has('addContentIdea');
  if (kind === 'document') return has('remember');
  return !!handlerFor(kind, fields);
}

// Hand a result to whoever owns it. Most apps open their own review (a sheet, or their page): returns { sheet } when
// the owner put a sheet on screen (it sits over the lens; scanning resumes when it closes) and { page } when it pushed a
// page (the lens steps aside so you see it). `ret` is what the handler returned (its undo), `handled` whether anyone took it.
export function routeScan(result, ctx = {}) {
  const sheetsBefore = new Set($$('#phone > .sheet'));
  const before = { sheets: sheetsBefore.size, pages: $('#stack')?.children.length ?? 0 };
  let ret = null, handled = false;
  if (result.kind === 'reel' || result.kind === 'link') {
    if (has('addContentIdea')) try { ret = api.addContentIdea(result.fields); handled = true; } catch (e) { console.warn('[capture] addContentIdea failed', e); }
  } else if (result.kind === 'document' || result.kind === 'brain') {
    if (has('remember')) { ret = api.remember(result.fields.text ?? result.title, { aspect: result.fields.aspect ?? null, title: result.title, via: result.via ?? 'scan', by: ctx.auto ? 'wyn' : 'you', quiet: true }); handled = true; }
  } else {
    const found = handlerFor(result.kind, result.fields);
    if (found) try { ret = found.h.handle(result, ctx); handled = true; } catch (e) { console.warn('[capture] handler failed', result.kind, e); }
  }
  const sheet = $$('#phone > .sheet').find((s) => !sheetsBefore.has(s)) ?? null;
  const page = ($('#stack')?.children.length ?? 0) > before.pages;
  return { opened: !!sheet || page, sheet, page, ret, handled };
}
