// Work: projects, ideas, jobs and voice for the phone app (CONTRACT.md section 5).
// Loaded by app.js right after the first render; everything talks to app.js through window.AOS.
import * as voice from './recorder.js';
import { W, liveTaskIds, isLive, loadJobs, loadIdeas, emit } from './state.js';
import { openJobSheet, openJob, openIdea, openProjectSheet, renderCapJob, saveIdea, startJobFromCapture } from './sheets.js';
import { jobsForTask, openProject } from './projects.js';
import { renderJobPage } from './job.js';
import { openVoice } from './voice.js';
import { openCode, openNewSession, loadCode } from './code.js';
import './jobdiff.js';
import './tab.js';

const { AOS } = window;
AOS.css('work/work.css');
AOS.detail('job', { render: renderJobPage });

AOS.work = {
  voice, W, liveTaskIds, isLive, jobsForTask, openJobSheet, openJob, openIdea, openProject, openProjectSheet,
  renderCapJob, saveIdea, startJobFromCapture, openVoice, openCode, openNewSession, reload: () => Promise.all([loadJobs(), loadIdeas(), loadCode()]), handleLink,
  // openJobSheet takes { folder, folders, title, context, client }: the job works in that folder (Clients' "Start a job").
  jobFolders: true,
};
emit();
AOS.render();

// ---------- Deep links ----------
// agenticos://capture?type=idea|task|job&voice=1&project=<slug>   agenticos://job/<id>   agenticos://project/<slug>
// agenticos://code   agenticos://term/<id>   agenticos://compare/<group>   agenticos://copy/<id>
// agenticos://today | jobs | clients | content | more | tasks | life | goals   (a tab, or where an old tab's content is now)
// In a browser (PWA, testing): #capture?type=idea&voice=1, #job/j2, #project/<slug>, #jobs, or ?link=<agenticos url>.
let lastLink = { url: '', at: 0 };
export function handleLink(raw) {
  if (!raw) return false;
  let s = String(raw).trim();
  // Cold start can deliver the same URL twice (getLaunchUrl and a retained appUrlOpen): handle it once.
  if (s === lastLink.url && Date.now() - lastLink.at < 3000) return true;
  lastLink = { url: s, at: Date.now() };
  s = s.replace(/^agenticos:\/\//i, '').replace(/^#\/?/, '').replace(/^\/+/, '');
  const [path, query = ''] = s.split('?');
  const q = new URLSearchParams(query);
  const [head, arg] = path.split('/').map((x) => decodeURIComponent(x ?? ''));
  if (head === 'capture') {
    const type = ['idea', 'task', 'job'].includes(q.get('type')) ? q.get('type') : 'idea';
    // Over any open sheet: close it first so the capture sheet is on top.
    for (let i = 0; i < 4 && AOS.topSheet(); i++) AOS.topSheet().close();
    AOS.openCapture({ type, project: q.get('project') || null, voice: q.get('voice') === '1', source: q.get('source') || (q.get('voice') === '1' ? 'widget' : 'capture') });
    return true;
  }
  if (head === 'job' && arg) { openJob(arg); return true; }
  if (head === 'code') { openCode(); return true; }
  if (head === 'term' && arg) { loadCode().then(() => openCode('term', arg)); return true; }
  if (head === 'compare' && arg) { loadCode().then(() => openCode('compare', arg)); return true; }
  if (head === 'copy' && arg) { loadCode().then(() => openCode('copy', arg)); return true; }
  if (head === 'project' && arg) { openProject(arg); return true; }
  // the Jobs tab's segments, and every tab by name (old names open where their content lives now)
  if (head === 'projects' || head === 'ideas') { AOS.setTab(head); return true; }
  if (['today', 'jobs', 'clients', 'content', 'more', 'tasks', 'life', 'goals'].includes(head)) { AOS.setTab(head); return true; }
  if (head === 'idea' && arg) { openIdea(arg); return true; }
  if (head === 'voice') { openVoice(); return true; }
  return false;
}
const App = window.Capacitor?.Plugins?.App;
App?.addListener?.('appUrlOpen', (d) => handleLink(d?.url ?? ''));
App?.getLaunchUrl?.().then((r) => { if (r?.url) handleLink(r.url); }).catch(() => {});
function fromLocation() {
  const qs = new URLSearchParams(location.search);
  const link = qs.get('link') ?? (location.hash.length > 1 ? location.hash : null);
  if (link && handleLink(link) && location.hash) history.replaceState(null, '', location.pathname + location.search);
}
addEventListener('hashchange', fromLocation);
fromLocation();
