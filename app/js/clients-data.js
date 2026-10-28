// Clients: fictional demo data shaped like a client system kept on the owner's PC:
//   brain:  ~/northwind-brain/clients/<slug>/{dossier.md, work-log.md, results.md}, clients/_pipeline.md, NOW.md
//   OS:     ~/northwind-os/clients/<slug>/{index.md, payments.md, contract.md, goals.md, brand.md, raw/, <workflow>/}
//   leads:  ~/northwind-os/sales/<slug>/{index.md, potential.md, pitch.md, raw/}
// No contact details here on purpose (contacts.md is never surfaced).

export const CLIENT_STAGES = ['onboarding', 'active', 'paused', 'churned'];          // OS client card
export const LEAD_STAGES = ['new', 'warming', 'pitched', 'negotiating', 'snoozed', 'dead']; // OS lead card
export const HEALTH = { green: 'On track', yellow: 'Needs attention', red: 'At risk' };   // dossier traffic light

export const SYNC = { source: 'northwind-os + northwind-brain', at: '2 min ago', issues: [
  { kind: 'missing-os-folder', text: '2 clients have no OS folder yet', slugs: ['harbor-sons', 'dad-shop'], action: 'Create from template' },
] };

export const CLIENTS = [
  {
    slug: 'harbor-sons', name: 'Harbor & Sons', mono: 'HS', kind: 'client',
    product: 'Harborline OS', package: 'Basic + Advanced', stage: 'active', stageNote: 'unpaid', since: 'Oct 2026',
    health: 'yellow', summary: 'Shop OS for a family business. Live, first-year price not final yet.',
    next: { text: 'Ask them about the first-year payment', due: 'Today', owner: 'you' },
    waitingOn: { them: ['Who owns the A12 bills going forward', "Shop's WhatsApp number and hours", 'Cashfree keys after incorporation'], you: ['Pick the first-year price (D-034)'] },
    money: { outstanding: 'Price not set', state: 'due', rows: [
      { date: 'Oct 2026', what: 'Harborline OS · first year', amount: 'Not set', status: 'due', note: 'D-034: price not final' },
    ] },
    workflows: [{ name: 'Harborline OS rollout', status: 'running' }],
    keyDates: [{ what: 'Payment ask', when: 'Today' }],
    log: [
      { date: '2026-10-20', title: 'Basic and Advanced tiers shown', body: 'Walked them through both tiers; waiting on a price.' },
      { date: '2026-10-14', title: 'Went live in the shop', body: 'Counter and bills running on Harborline OS.' },
    ],
    contract: { term: 'Yearly', deliverables: ['Harborline OS Basic', 'Advanced tier'], payment: 'Yearly, price not final' },
    goals: ['Run the counter and bills without paper', 'See stock and dues on one screen'],
    osFolder: null, brainFolder: 'northwind-brain\\clients\\harbor-sons', projects: [],
  },
  {
    slug: 'glowbox', name: 'Glowbox', mono: 'GB', kind: 'client',
    product: 'Storefront + catalog fill', package: 'Legacy service', stage: 'active', stageNote: 'legacy', since: 'Jun 2026',
    health: 'yellow', summary: 'Online beauty store. Storefront live; catalog fill done, invoice not sent.',
    next: { text: 'Invoice the catalog fill and ask the four launch inputs', due: 'Overdue 1 day', owner: 'you' },
    waitingOn: { them: ['Owner inventory list', 'Grievance officer and policies'], you: ['Meta WhatsApp templates', 'Deploy the variant fix (a1b2c3d)'] },
    money: { outstanding: '₹15,000', state: 'due', rows: [
      { date: 'Aug 2026', what: 'Storefront build', amount: '₹30,000', status: 'paid', note: '' },
      { date: 'Oct 2026', what: 'Catalog fill (D-013)', amount: '₹15,000', status: 'due', note: 'Not quoted yet' },
    ] },
    workflows: [{ name: 'catalog-fill', status: 'running' }, { name: 'website-build', status: 'running' }],
    keyDates: [{ what: 'Invoice catalog fill', when: 'Overdue' }, { what: 'Launch', when: 'After the four inputs' }],
    log: [
      { date: '2026-10-19', title: 'Variant fix ready', body: 'Fix for product variants is in a1b2c3d, not deployed.' },
      { date: '2026-10-12', title: 'Catalog fill finished', body: 'All products in. Invoice still to go out.' },
      { date: '2026-08-28', title: 'Storefront paid', body: '₹30,000 received for the build.' },
    ],
    contract: { term: 'Per project', deliverables: ['Storefront', 'Catalog fill'], payment: 'Per deliverable' },
    goals: ['Sell online without the owner touching code', 'Launch with a full catalog'],
    osFolder: 'northwind-os\\clients\\glowbox', brainFolder: 'northwind-brain\\clients\\glowbox', projects: [],
  },
  {
    slug: 'dad-shop', name: 'Morgan & Co.', mono: 'MC', kind: 'own', ownerNote: "Dad's shop",
    product: 'Atlas ERP / ShopBrain pilot', package: 'Pilot · website (legacy)', stage: 'onboarding', stageNote: 'pilot', since: '2026',
    health: 'green', summary: "Dad's shop in Midtown. Atlas ERP pilot; the Corner Market website is older work.",
    next: { text: 'Close the website payment; propose a monthly software fee', due: 'Fri 23', owner: 'you' },
    waitingOn: { them: [], you: ['ShopBrain store release (open decision 5)', 'Website ops and security clean-up'] },
    money: { outstanding: '≈ ₹18,000', state: 'due', rows: [
      { date: '2026', what: 'Website (cornermarket.example)', amount: '≈ ₹18,000', status: 'due', note: 'Close this week' },
    ] },
    workflows: [{ name: 'Atlas ERP pilot', status: 'setting up' }],
    keyDates: [{ what: 'Payment talk', when: 'Fri 23' }],
    log: [
      { date: '2026-10-19', title: 'Atlas ERP wave 1 planned', body: '11 parallel agents: counter, bills, customers and money, stock buying and more.' },
      { date: '2026-10-10', title: 'Pilot agreed', body: 'Atlas ERP runs the shop counter first.' },
    ],
    contract: { term: 'Pilot', deliverables: ['Atlas ERP', 'Phone apps'], payment: 'Monthly fee to propose' },
    goals: ['Run the shop from one system', 'Know stock and dues without asking anyone'],
    osFolder: null, brainFolder: 'northwind-brain\\clients\\dad-shop', projects: ['atlas'],
  },
  {
    slug: 'brightmark', name: 'BrightMark', mono: 'BM', kind: 'client', freeNote: 'Not a paying client (D-022)',
    product: 'Website + society OS', package: 'Free', stage: 'active', stageNote: 'build', since: '2026',
    health: 'green', summary: 'Free build: website and a society OS.',
    next: { text: 'Set up the Google OAuth web client', due: 'No date', owner: 'you' },
    waitingOn: { them: [], you: ['Google OAuth web client'] },
    money: { outstanding: '₹0', state: 'none', rows: [] },
    workflows: [{ name: 'website-build', status: 'running' }],
    keyDates: [],
    log: [{ date: '2026-10-08', title: 'Marked as not a client', body: 'D-022: free work, no invoices.' }],
    contract: { term: 'None', deliverables: ['Website', 'Society OS'], payment: 'Free' },
    goals: ['Society members sign in with Google'],
    osFolder: 'northwind-os\\clients\\brightmark', brainFolder: 'northwind-brain\\clients\\brightmark', projects: [],
  },
];

export const LEADS = [
  {
    slug: 'silver-lens', name: 'Silver Lens', mono: 'SL', kind: 'lead', stage: 'new', warmth: 'cold',
    nextTouch: 'Not set (ask)', potential: 'Unknown', pitch: 'Not started', since: 'Jul 2026',
    osFolder: 'northwind-os\\sales\\silver-lens', note: 'Created by the lead-intake test run',
  },
];

export const RETIRED = [{ slug: 'northwind-own', name: 'Northwind (own brand)', note: 'Retired (D-035)' }];

// Workflows you can run on a client or lead (northwind-os\WORKFLOWS.md + skills). Agency-era ones need your OK first.
export const WORKFLOWS = [
  { id: 'lead-intake', name: 'Lead intake', built: true, for: 'lead', line: 'Capture a new lead, check duplicates, file it' },
  { id: 'lead-research', name: 'Lead research', built: true, for: 'lead', line: 'Sweep their online presence' },
  { id: 'prepare-pitch', name: 'Prepare pitch', built: false, for: 'lead', line: 'Build the pitch plan' },
  { id: 'client-onboarding', name: 'Client onboarding', built: false, for: 'lead', line: 'Convert a lead into a client folder' },
  { id: 'web-client-intake', name: 'Website intake', built: true, for: 'client', line: 'Step 0 of a website build' },
  { id: 'meeting-notes', name: 'Meeting notes', built: false, for: 'client', line: 'Recording to notes in the work log' },
  { id: 'audit-xray', name: 'Audit X-ray', built: false, for: 'client', line: 'Paid audit report', needsOk: true },
];
