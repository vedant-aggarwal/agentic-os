// The bus: how areas call each other without importing each other. Owned by the lead.
// An area provides what it owns:   provide('openPerson', (id) => …)
// anyone calls it:                  api.openPerson('kabir')
// A call nobody has provided yet logs and toasts instead of throwing, so parallel areas can link to each other
// before the other side exists. The names, their owners and their arguments are listed in CONTRACT.md.
import { toast } from './core.js';

const impl = new Map();
export function provide(name, fn) { impl.set(name, fn); }
export const has = (name) => impl.has(name);
export const api = new Proxy({}, {
  get(_, name) {
    if (typeof name !== 'string' || name === 'then') return undefined;
    return (...args) => {
      const fn = impl.get(name);
      if (fn) return fn(...args);
      console.info('[bus] not provided yet:', name, args);
      toast(`Not built yet: ${name}`);
    };
  },
});
// for debugging in the console: __bus.list()
window.__bus = { list: () => [...impl.keys()].sort(), api };
