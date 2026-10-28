// Body · the open app and the nav registry between Body's modules (filled by each module on import). The data itself
// lives in body-data.js (B, rebuilt from the store); nothing here is kept between sessions. Owner: the Body agent.
export const S = {
  app: null,            // the open Body app (js/aspects.js app object), set on open
  scanned: null,        // a face scan result handed in this session, before it is saved
};

// sections call each other's pages through here
export const nav = {};

// re-render the Body sections that are already built, so a change shows everywhere at once
export function refresh(...ids) {
  const app = S.app; if (!app?.scroll || !document.contains(app.scroll)) return;
  for (const id of ids.length ? ids : ['train', 'recovery', 'log', 'fuel', 'looks']) { const el = app.el(id); if (el?.dataset.built) app.refresh(id); }
}
