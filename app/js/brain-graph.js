// The Brain's living graph, drawn by MOTION's engine (js/graph.js): the Brain at the centre, the nine folders on their
// wheel angles (sized by what's in them), the people, goals, projects and notes that tie to each, and, for the owner,
// his vault's people and projects as rings (hollow nodes) joined to the app's own when they're the same thing. Things in
// two places keep both links. A locked folder (Romance, Soul) shows as a closed ring with nothing round it.
// Owner: BRAIN. graphModel() is pure on the live data; brain.js mounts and updates it.
import { ASPECTS, PEOPLE, GOALS, PROJECTS, AREA_ASPECTS, aspect, DEMO_MODE } from './data.js';
import { NOTES, FOLDERS, isLocked } from './brain-data.js';

export const FILTERS = [['all', 'All'], ['person', 'People'], ['goal', 'Goals'], ['project', 'Projects'], ['note', 'Notes'], ['vault', 'Vault']];
const slugOf = (vid) => String(vid).split('/').pop();

/** { nodes, links } for mountGraph. filter: all | person | goal | project | note | vault. vault: GET /vault/graph's answer. */
export function graphModel({ filter = 'all', vault = null, mini = false } = {}) {
  const nodes = [{ id: 'hub', kind: 'hub', label: 'Brain', initial: '' }];
  const links = [];
  const seen = new Set(['hub']);
  const add = (n) => { if (seen.has(n.id)) return false; seen.add(n.id); nodes.push(n); return true; };
  const link = (a, b, o = {}) => { if (seen.has(a) && seen.has(b) && a !== b) links.push({ source: a, target: b, ...o }); };
  const want = (k) => filter === 'all' || filter === k;
  const max = Math.max(1, ...ASPECTS.map((a) => (FOLDERS[a.id]?.count ?? 0) + (FOLDERS[a.id]?.vault ?? 0) / 8));
  for (const a of ASPECTS) {
    const F = FOLDERS[a.id] ?? { count: 0 };
    const locked = isLocked(a.id);
    add({ id: `a:${a.id}`, kind: 'aspect', label: a.name, group: a.id, size: locked ? 0.3 : 0.35 + 0.65 * Math.min(1, ((F.count ?? 0) + (F.vault ?? 0) / 8) / max), hollow: locked });
    link('hub', `a:${a.id}`);
  }
  const open = (asp) => asp && aspect(asp) && !isLocked(asp);
  if (want('person') || want('note') || want('vault')) for (const p of PEOPLE) {
    if (!open(p.aspect)) continue;
    add({ id: `p:${p.id}`, kind: 'person', label: p.name, group: p.aspect, initial: p.name[0] });
    link(`a:${p.aspect}`, `p:${p.id}`);
  }
  if (want('goal')) for (const g of GOALS) {
    const asp = (g.aspects ?? []).filter(open);
    if (!asp.length) continue;
    add({ id: `g:${g.id}`, kind: 'goal', label: g.title, group: asp[0], ring: Array.isArray(g.tasks) && g.tasks[1] ? g.tasks[0] / g.tasks[1] : undefined });
    asp.forEach((x, i) => link(`a:${x}`, `g:${g.id}`, i ? { dotted: true } : {}));
  }
  if (want('project')) for (const p of PROJECTS) {
    const asp = (DEMO_MODE ? p.aspects ?? [] : AREA_ASPECTS[p.area] ?? []).filter(open);
    const group = asp[0] ?? 'mission';
    if (!open(group)) continue;
    add({ id: `j:${p.slug}`, kind: 'project', label: p.name, group });
    (asp.length ? asp : ['mission']).forEach((x, i) => link(`a:${x}`, `j:${p.slug}`, i ? { dotted: true } : {}));
  }
  if (want('note')) {
    const list = NOTES.filter((n) => open(n.folder) && n.kind !== 'fact').slice(0, mini ? 60 : 240);
    for (const n of list) {
      add({ id: `n:${n.id}`, kind: 'note', label: n.title, group: n.folder });
      const pid = n.links?.person ?? n.person;
      if (pid && seen.has(`p:${pid}`)) link(`n:${n.id}`, `p:${pid}`); else link(`a:${n.folder}`, `n:${n.id}`);
      if (n.links?.goal) link(`n:${n.id}`, `g:${n.links.goal}`, { dotted: true });
      if (n.links?.project) link(`n:${n.id}`, `j:${n.links.project}`, { dotted: true });
    }
  }
  // the vault: its people join the app's people, its projects the app's projects; the rest sit by their domain's folder
  if (vault?.nodes && (filter === 'all' || filter === 'vault')) {
    const DOM = { work: 'mission', system: 'mission', money: 'money', learn: 'mind', self: 'growth', people: 'friends' };
    const asApp = (vid) => {
      const s = slugOf(vid);
      if (vid.startsWith('entity/') && PEOPLE.some((p) => p.id === s)) return `p:${s}`;
      if (vid.startsWith('project/') && PROJECTS.some((p) => p.slug === s)) return `j:${s}`;
      return null;
    };
    const idOf = (vid) => (seen.has(asApp(vid) ?? '') ? asApp(vid) : `v:${vid}`);
    for (const v of vault.nodes.slice(0, mini ? 24 : 80)) {
      const mine = asApp(v.id);
      if (mine && seen.has(mine)) { const n = nodes.find((x) => x.id === mine); if (n) { n.vault = v.id; n.ring = n.ring ?? 1; } continue; }
      const group = v.kind === 'project' ? 'mission' : DOM[v.domain] ?? 'mission';
      if (!open(group)) continue;
      add({ id: `v:${v.id}`, kind: v.kind === 'project' ? 'project' : v.kind === 'entity' ? 'area' : 'note', label: v.title, group, hollow: true, vault: v.id });
      link(`a:${group}`, `v:${v.id}`, { dotted: true });
    }
    for (const [a, b] of vault.edges ?? []) link(idOf(a), idOf(b));
  }
  return { nodes, links };
}

/** What a node is, for the card under the graph: its kind's name, what opens it, and its neighbours. */
export function nodeInfo(n) {
  if (!n) return null;
  const k = n.id.slice(0, 2), ref = n.id.slice(2);
  const KIND = { hub: 'Your Brain', aspect: 'Folder', person: 'Person', goal: 'Goal', project: 'Project', note: 'Note', area: 'In your vault' };
  const kind = n.vault && k === 'v:' ? (n.kind === 'project' ? 'Vault project' : n.kind === 'area' ? 'Vault entity' : 'Vault note') : KIND[n.kind] ?? 'Node';
  const open = n.id === 'hub' ? ['br-home', '', 'Open'] : k === 'a:' ? ['br-folder', ref, 'Open folder'] : k === 'p:' ? ['br-person', ref, 'Open file'] : k === 'g:' ? ['br-goal', ref, 'Open goal']
    : k === 'j:' ? ['br-project', ref, 'Open project'] : k === 'n:' ? ['br-note', ref, 'Open note'] : k === 'v:' ? ['br-vnote', ref, 'Read'] : ['br-home', '', 'Open'];
  return { kind, open, group: n.group ?? null };
}
