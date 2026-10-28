// The lens's sample scenes: what the camera "sees" while you swipe, drawn as SVG (no photos), and what the agent reads
// from each: the kind, the draft it makes, where it suggests filing it, and the alternatives one tap away.
// Owner: the Life hub + Brain + Capture agent. Every scene is 402 × 874 (the phone), sliced to fill other screens.
// quad: the detected object's corners in scene units, for the outline. result: the shape CONTRACT.md §4 gives per kind.
import { TODAY_LABEL } from './data.js';

const W = 402, H = 874;
const rot = (pts, deg, cx, cy) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]); };
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";
const SANS = "-apple-system,'SF Pro Text','Segoe UI',system-ui,sans-serif";
const SERIF = "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif";
const HAND = "'Bradley Hand','Noteworthy','Segoe Print','Ink Free','Comic Sans MS',cursive";
// a soft photographic finish shared by the scenes: light from the window, the lens's own vignette
const finish = (p, { cy = '42%', dark = 0.58 } = {}) => `
  <radialGradient id="${p}vg" cx="50%" cy="${cy}" r="78%"><stop offset="52%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="${dark}"/></radialGradient>
  <linearGradient id="${p}lt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <filter id="${p}sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10"/></filter>`;
const grain = (p, id, freq, seed, m) => `<filter id="${p}${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}"/><feColorMatrix values="${m}"/></filter>`;
const WOOD = '0.5 0 0 0 0.04  0.3 0 0 0 0.025  0.17 0 0 0 0.015  0 0 0 0 1';
const SLATE = '0.13 0 0 0 0.07  0.13 0 0 0 0.075  0.14 0 0 0 0.085  0 0 0 0 1';

// ── 1 · a restaurant receipt on a café table ──
const RQ = rot(rect(104, 190, 196, 346), -5, 201, 372);
function receipt(p) {
  let zig = 'M104 190H300V536';
  for (let x = 300; x > 104; x -= 14) zig += `L${x - 7} 544L${x - 14} 536`;
  zig += 'Z';
  const qr = [[0, 0, 1, 1, 1, 0, 1], [1, 0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 0, 1, 0], [0, 1, 1, 0, 1, 0, 1], [1, 0, 0, 1, 1, 1, 0], [1, 1, 0, 0, 1, 0, 1], [0, 1, 1, 1, 0, 1, 1]]
    .flatMap((r, y) => r.map((v, x) => (v ? `<rect x="${178 + x * 6.5}" y="${448 + y * 6.5}" width="6.5" height="6.5"/>` : ''))).join('');
  const item = (y, n, q, v) => `<text x="116" y="${y}" font-size="12.5">${n}</text><text x="252" y="${y}" font-size="12.5" text-anchor="end">${q}</text><text x="288" y="${y}" font-size="12.5" text-anchor="end">${v}</text>`;
  return `<defs>${finish(p)}${grain(p, 'w', '0.005 0.11', 7, WOOD)}
    <linearGradient id="${p}pa" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e9e4d8"/><stop offset=".55" stop-color="#f7f4ed"/><stop offset="1" stop-color="#e6e0d3"/></linearGradient>
    <radialGradient id="${p}st" cx="38%" cy="32%" r="72%"><stop offset="0" stop-color="#eef1f3"/><stop offset=".55" stop-color="#9ea5ac"/><stop offset="1" stop-color="#596067"/></radialGradient>
    <radialGradient id="${p}ch" cx="40%" cy="38%" r="65%"><stop offset="0" stop-color="#9a6234"/><stop offset="1" stop-color="#5b3618"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="#23160e"/><rect width="${W}" height="${H}" filter="url(#${p}w)"/><rect width="${W}" height="${H}" fill="url(#${p}lt)"/>
    <circle cx="372" cy="146" r="66" fill="#000" opacity=".45" filter="url(#${p}sh)"/>
    <circle cx="364" cy="136" r="60" fill="url(#${p}st)"/><circle cx="364" cy="136" r="48" fill="url(#${p}ch)"/><ellipse cx="350" cy="122" rx="20" ry="10" fill="#fff" opacity=".12"/>
    <g transform="rotate(-5 201 372)">
      <rect x="104" y="196" width="196" height="346" fill="#000" opacity=".55" filter="url(#${p}sh)" transform="translate(9 12)"/>
      <path d="${zig}" fill="url(#${p}pa)"/>
      <g font-family="${MONO}" fill="#2c2a27">
        <text x="202" y="228" text-anchor="middle" font-size="18" font-weight="700" letter-spacing="1.5">HALDIRAM'S</text>
        <text x="202" y="248" text-anchor="middle" font-size="12">Midtown Mall</text>
        <text x="202" y="264" text-anchor="middle" font-size="12">Tax invoice · Table 14</text>
        <line x1="116" y1="278" x2="288" y2="278" stroke="#2c2a27" stroke-dasharray="3 3" opacity=".55"/>
        <text x="116" y="296" font-size="12">22/10/26</text><text x="288" y="296" text-anchor="end" font-size="12">13:52</text>
        <line x1="116" y1="308" x2="288" y2="308" stroke="#2c2a27" stroke-dasharray="3 3" opacity=".55"/>
        ${item(330, 'Raj kachori', '1', '180')}${item(350, 'Chole bhature', '1', '230')}${item(370, 'Masala chaas', '2', '76')}
        <line x1="116" y1="384" x2="288" y2="384" stroke="#2c2a27" stroke-dasharray="3 3" opacity=".55"/>
        <text x="116" y="408" font-size="15" font-weight="700">TOTAL</text><text x="288" y="408" text-anchor="end" font-size="15" font-weight="700">₹486.00</text>
        <text x="116" y="428" font-size="12">Paid by UPI</text>
        <g>${qr}</g>
        <text x="202" y="522" text-anchor="middle" font-size="12">Thank you. Visit again.</text>
      </g>
    </g>
    <rect width="${W}" height="${H}" fill="url(#${p}vg)"/>`;
}

// ── 2 · a thali, from above ──
function food(p) {
  const spots = (cx, cy, r, n, c, o, seed) => Array.from({ length: n }, (_, i) => { const a = (i * 137.5 + seed) * Math.PI / 180, d = r * Math.sqrt((i + 0.5) / n); return `<circle cx="${(cx + d * Math.cos(a)).toFixed(1)}" cy="${(cy + d * Math.sin(a)).toFixed(1)}" r="${(1.4 + (i % 3) * 0.7).toFixed(1)}" fill="${c}" opacity="${o}"/>`; }).join('');
  const katori = (cx, cy, r, fill, inner = '') => `<circle cx="${cx + 4}" cy="${cy + 6}" r="${r + 2}" fill="#000" opacity=".35" filter="url(#${p}sh)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${p}kt)"/><circle cx="${cx}" cy="${cy}" r="${r - 7}" fill="${fill}"/>${inner}<circle cx="${cx}" cy="${cy}" r="${r - 7}" fill="url(#${p}gl)"/>`;
  const cube = (x, y, a) => `<rect x="${x}" y="${y}" width="15" height="13" rx="3" fill="#f2e5c3" transform="rotate(${a} ${x + 7} ${y + 6})"/>`;
  return `<defs>${finish(p, { cy: '44%' })}${grain(p, 's', '0.9', 3, SLATE)}
    <radialGradient id="${p}th" cx="40%" cy="34%" r="74%"><stop offset="0" stop-color="#f1f3f5"/><stop offset=".45" stop-color="#b9bfc5"/><stop offset=".8" stop-color="#8d949b"/><stop offset="1" stop-color="#cfd3d7"/></radialGradient>
    <radialGradient id="${p}kt" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#f3f5f7"/><stop offset=".6" stop-color="#9aa1a8"/><stop offset="1" stop-color="#6b7279"/></radialGradient>
    <radialGradient id="${p}gl" cx="35%" cy="30%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="${p}ro" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#e3c08a"/><stop offset="1" stop-color="#c99a5b"/></radialGradient>
    <filter id="${p}ri" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="9" result="n"/><feColorMatrix in="n" values="0 0 0 0 .62  0 0 0 0 .58  0 0 0 0 .5  0 0 0 -2.4 1.3" result="c"/><feComposite in="c" in2="SourceGraphic" operator="in"/></filter></defs>
    <rect width="${W}" height="${H}" fill="#191b1e"/><rect width="${W}" height="${H}" filter="url(#${p}s)"/><rect width="${W}" height="${H}" fill="url(#${p}lt)"/>
    <circle cx="208" cy="384" r="172" fill="#000" opacity=".55" filter="url(#${p}sh)"/>
    <circle cx="201" cy="372" r="168" fill="url(#${p}th)"/><circle cx="201" cy="372" r="150" fill="#aeb4ba"/><circle cx="201" cy="372" r="150" fill="url(#${p}gl)"/>
    <ellipse cx="150" cy="444" rx="64" ry="48" fill="#f1ede3"/><ellipse cx="150" cy="444" rx="64" ry="48" filter="url(#${p}ri)" opacity=".5"/>${spots(150, 444, 50, 14, '#6b4a22', '.8', 20)}
    <circle cx="232" cy="486" r="52" fill="url(#${p}ro)"/>${spots(232, 486, 44, 16, '#7a4a1e', '.55', 60)}
    <circle cx="200" cy="470" r="52" fill="url(#${p}ro)"/>${spots(200, 470, 44, 16, '#7a4a1e', '.5', 10)}<path d="M150 470a50 50 0 0 1 100 0" fill="none" stroke="#f3dcae" stroke-width="2" opacity=".55"/>
    ${katori(128, 296, 54, '#5a2614', `<path d="M104 296c10-16 36-18 46-4s-6 26-20 22-12-12-4-14" fill="none" stroke="#f4e9d8" stroke-width="5" stroke-linecap="round" opacity=".8"/><circle cx="140" cy="284" r="6" fill="#f6d36b" opacity=".9"/>${spots(128, 296, 40, 10, '#2e130a', '.6', 40)}`)}
    ${katori(266, 278, 58, '#c34d1a', `${cube(238, 258, 12)}${cube(268, 250, -18)}${cube(254, 284, 30)}${cube(284, 284, 4)}${cube(236, 290, -8)}<path d="M240 300c14 8 34 8 50-4" fill="none" stroke="#f6ead8" stroke-width="4" stroke-linecap="round" opacity=".75"/>${spots(266, 278, 44, 9, '#3f7a2c', '.95', 80)}`)}
    ${katori(296, 420, 48, '#efede5', `${spots(296, 420, 36, 16, '#4f8a35', '.9', 15)}${spots(296, 420, 30, 6, '#c2421d', '.8', 95)}`)}
    <rect width="${W}" height="${H}" fill="url(#${p}vg)"/>`;
}

// ── 3 · your face, from the front camera: a landmark mesh, no photo ──
function faceMesh() {
  const cx = 201, cy = 362, rx = 104, ry = 138;
  const jaw = Array.from({ length: 17 }, (_, i) => { const t = Math.PI * (1.08 - i / 16 * 1.16); return [cx + rx * 0.96 * Math.cos(t), cy + ry * (-0.18 + 0.98 * Math.sin(t) * (Math.sin(t) > 0 ? 1 : 0.2))]; });
  const brow = (s) => Array.from({ length: 5 }, (_, i) => [cx + s * (rx * (0.16 + i * 0.15)), cy - ry * (0.42 + Math.sin(i / 4 * Math.PI) * 0.07)]);
  const eye = (s) => Array.from({ length: 6 }, (_, i) => { const t = i / 6 * Math.PI * 2; return [cx + s * rx * 0.42 + rx * 0.17 * Math.cos(t), cy - ry * 0.22 + ry * 0.055 * Math.sin(t)]; });
  const nose = [...Array.from({ length: 4 }, (_, i) => [cx, cy - ry * (0.22 - i * 0.12)]), ...[-2, -1, 0, 1, 2].map((k) => [cx + k * rx * 0.075, cy + ry * 0.24 - Math.abs(k) * 4])];
  const mouth = Array.from({ length: 12 }, (_, i) => { const t = i / 12 * Math.PI * 2; return [cx + rx * 0.3 * Math.cos(t), cy + ry * 0.5 + ry * (Math.sin(t) > 0 ? 0.1 : 0.06) * Math.sin(t)]; });
  const pts = [...jaw, ...brow(-1), ...brow(1), ...eye(-1), ...eye(1), ...nose, ...mouth];
  const chain = (arr, close) => arr.map((q, i) => (i || close ? `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}` : `M${q[0].toFixed(1)} ${q[1].toFixed(1)}`)).join('') + (close ? 'Z' : '');
  const links = [jaw, brow(-1), brow(1)].map((a) => chain(a, false)).join('') + [eye(-1), eye(1), mouth].map((a) => chain(a, true)).join('') + chain(nose.slice(0, 4), false);
  // a few lines across the face that read as its surface
  const contours = [-0.55, -0.05, 0.32, 0.72].map((k) => `<path d="M${cx - rx * 0.92} ${cy + ry * k}Q${cx} ${cy + ry * k + 26} ${cx + rx * 0.92} ${cy + ry * k}" />`).join('');
  return { pts, links, contours };
}
function face(p) {
  const { pts, links, contours } = faceMesh();
  return `<defs><radialGradient id="${p}bg" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#1f2a33"/><stop offset=".7" stop-color="#0d1216"/><stop offset="1" stop-color="#06080a"/></radialGradient>
    <radialGradient id="${p}fc" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#3a4752" stop-opacity=".55"/><stop offset="1" stop-color="#3a4752" stop-opacity="0"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#${p}bg)"/>
    <ellipse cx="201" cy="368" rx="118" ry="158" fill="url(#${p}fc)"/>
    <ellipse cx="201" cy="368" rx="128" ry="168" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="2"/>
    <g fill="none" stroke="#bfe6ff" stroke-opacity=".12" stroke-width="1">${contours}</g>
    <path d="${links}" fill="none" stroke="#dff2ff" stroke-opacity=".34" stroke-width="1.1"/>
    <g fill="#f2fbff">${pts.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i % 4 ? 2 : 2.6}" opacity="${(0.62 + (i % 3) * 0.14).toFixed(2)}"/>`).join('')}</g>`;
}

// ── 4 · a book on the desk ──
const BQ = rot(rect(96, 206, 208, 312), -4, 201, 362);
function book(p) {
  const pageLines = Array.from({ length: 9 }, (_, i) => `<line x1="${306 + i * 0.6}" y1="${214 + i}" x2="${306 + i * 0.6}" y2="${520 - i}" stroke="#cfc6b2" stroke-width=".8"/>`).join('');
  return `<defs>${finish(p)}${grain(p, 'd', '0.65 0.04', 11, '0.16 0 0 0 0.07  0.15 0 0 0 0.065  0.14 0 0 0 0.06  0 0 0 0 1')}
    <linearGradient id="${p}cv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5f1e8"/><stop offset="1" stop-color="#e6dfd0"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="#1d1b19"/><rect width="${W}" height="${H}" filter="url(#${p}d)"/><rect width="${W}" height="${H}" fill="url(#${p}lt)"/>
    <g transform="rotate(-4 201 362)">
      <rect x="100" y="214" width="214" height="314" fill="#000" opacity=".6" filter="url(#${p}sh)" transform="translate(10 14)"/>
      <rect x="104" y="212" width="210" height="312" rx="3" fill="#ece5d4"/>${pageLines}
      <rect x="96" y="206" width="208" height="312" rx="4" fill="url(#${p}cv)"/>
      <rect x="96" y="206" width="10" height="312" fill="#000" opacity=".06"/>
      <g fill="#d9822b"><rect x="124" y="236" width="9" height="9" rx="1.5" opacity=".45"/><rect x="138" y="232" width="13" height="13" rx="2" opacity=".65"/><rect x="156" y="227" width="18" height="18" rx="2.5"/></g>
      <text x="124" y="296" font-family="${SERIF}" font-size="38" font-weight="700" fill="#1b1a18">Atomic</text>
      <text x="124" y="336" font-family="${SERIF}" font-size="38" font-weight="700" fill="#1b1a18">Habits</text>
      <line x1="124" y1="354" x2="190" y2="354" stroke="#1b1a18" stroke-width="2"/>
      <text x="124" y="378" font-family="${SANS}" font-size="12.5" fill="#3a3834">Tiny changes,</text>
      <text x="124" y="394" font-family="${SANS}" font-size="12.5" fill="#3a3834">remarkable results</text>
      <rect x="96" y="440" width="208" height="78" fill="#1f3a32"/>
      <text x="124" y="486" font-family="${SANS}" font-size="15" font-weight="600" letter-spacing="1.2" fill="#efe7d6">JAMES CLEAR</text>
    </g>
    <g transform="rotate(28 320 600)"><rect x="248" y="592" width="150" height="14" rx="2" fill="#e7b623"/><rect x="248" y="592" width="150" height="4" rx="1" fill="#f3cf55"/><path d="M398 592l22 7-22 7z" fill="#e9caa0"/><path d="M413 597l7 2-7 2z" fill="#2b2b2b"/><rect x="236" y="592" width="14" height="14" rx="2" fill="#c9c9c9"/></g>
    <rect width="${W}" height="${H}" fill="url(#${p}vg)"/>`;
}

// ── 5 · a handwritten page ──
const PQ = rot(rect(80, 168, 248, 392), 3, 204, 364);
function page(p) {
  const lines = Array.from({ length: 14 }, (_, i) => `<line x1="80" y1="${212 + i * 26}" x2="328" y2="${212 + i * 26}" stroke="#a9c3e4" stroke-width="1"/>`).join('');
  const holes = Array.from({ length: 8 }, (_, i) => `<circle cx="94" cy="${196 + i * 48}" r="4.5" fill="#1b1815"/>`).join('');
  const hand = (y, t, x = 116, s = 17) => `<text x="${x}" y="${y}" font-size="${s}">${t}</text>`;
  return `<defs>${finish(p)}${grain(p, 'w', '0.005 0.1', 5, WOOD)}</defs>
    <rect width="${W}" height="${H}" fill="#1e1712"/><rect width="${W}" height="${H}" filter="url(#${p}w)" opacity=".85"/><rect width="${W}" height="${H}" fill="url(#${p}lt)"/>
    <g transform="rotate(3 204 364)">
      <rect x="80" y="168" width="248" height="392" fill="#000" opacity=".55" filter="url(#${p}sh)" transform="translate(9 12)"/>
      <rect x="80" y="168" width="248" height="392" rx="2" fill="#fbf8ef"/>${lines}
      <line x1="108" y1="168" x2="108" y2="560" stroke="#e5a3a3" stroke-width="1.2"/>${holes}
      <g font-family="${HAND}" fill="#23407e">
        ${hand(202, '22 Oct', 262, 15)}${hand(232, 'Shop day. Dad liked')}${hand(258, 'the new listings.')}${hand(284, '12 kurtas online')}${hand(310, 'by Sunday.')}${hand(336, 'Gym 6:30 tomorrow.')}${hand(362, 'Ask Kabir: Saturday?')}
      </g>
      <path d="M118 372c30 4 70 3 104-2" fill="none" stroke="#23407e" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>
    </g>
    <rect width="${W}" height="${H}" fill="url(#${p}vg)"/>`;
}

// ── 6 · your latest screenshot: a chat with Kabir, held up in the lens like a photo of it ──
const SHOT = { x: 51, y: 132, k: 0.746 };
const CQ = rect(SHOT.x + 10 * SHOT.k, SHOT.y + 290 * SHOT.k, 382 * SHOT.k, 210 * SHOT.k);
function chat(p) {
  const bub = (y, t, out, time, w) => { const x = out ? 386 - w : 16; return `<rect x="${x}" y="${y}" width="${w}" height="40" rx="10" fill="${out ? '#145c4b' : '#1f2c34'}"/><text x="${x + 12}" y="${y + 25}" font-size="15" fill="#e9edef">${t}</text><text x="${x + w - 10}" y="${y + 33}" font-size="12" text-anchor="end" fill="#8fa3ad">${time}</text>`; };
  return `<defs><pattern id="${p}pt" width="46" height="46" patternUnits="userSpaceOnUse"><circle cx="8" cy="10" r="1.5" fill="#fff" opacity=".035"/><circle cx="30" cy="32" r="1.5" fill="#fff" opacity=".035"/><path d="M20 4l4 4-4 4" fill="none" stroke="#fff" stroke-opacity=".03"/></pattern>
      <radialGradient id="${p}bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#262a31"/><stop offset="1" stop-color="#0b0c0e"/></radialGradient>
      <clipPath id="${p}cl"><rect width="${W}" height="700" rx="52"/></clipPath>
      <filter id="${p}sh" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter></defs>
    <rect width="${W}" height="${H}" fill="url(#${p}bg)"/>
    <rect x="${SHOT.x + 6}" y="${SHOT.y + 16}" width="${(W * SHOT.k).toFixed(1)}" height="${(700 * SHOT.k).toFixed(1)}" rx="39" fill="#000" opacity=".6" filter="url(#${p}sh)"/>
    <g transform="translate(${SHOT.x} ${SHOT.y}) scale(${SHOT.k})"><g clip-path="url(#${p}cl)">
    <rect width="${W}" height="${H}" fill="#0b141a"/><rect width="${W}" height="${H}" fill="url(#${p}pt)"/>
    <rect width="${W}" height="128" fill="#1d2930"/>
    <g font-family="${SANS}">
      <path d="M22 92l-8-8 8-8" fill="none" stroke="#e9edef" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" transform="translate(4 0)"/>
      <circle cx="62" cy="84" r="20" fill="#7a8b3a"/><text x="62" y="90" font-size="17" font-weight="700" text-anchor="middle" fill="#fff">A</text>
      <text x="94" y="80" font-size="17" font-weight="600" fill="#e9edef">Kabir</text><text x="94" y="99" font-size="13" fill="#8fa3ad">online</text>
      <rect x="140" y="244" width="122" height="26" rx="8" fill="#1d2930"/><text x="201" y="262" font-size="12.5" text-anchor="middle" fill="#a4b4bc">Today</text>
      ${bub(304, 'bhai saturday free hai?', false, '17:02', 236)}${bub(352, 'momos at 8? the usual place', false, '17:02', 270)}${bub(400, 'haan done', true, '17:05', 132)}${bub(448, 'sahi hai, 8 baje', false, '17:06', 186)}
      <rect x="10" y="${H - 116}" width="318" height="48" rx="24" fill="#1f2c34"/><text x="34" y="${H - 86}" font-size="15" fill="#8fa3ad">Message</text>
      <circle cx="360" cy="${H - 92}" r="24" fill="#21c063"/>
    </g></g><rect width="${W}" height="700" rx="52" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="2.5"/></g>`;
}

// ── 7 · a printed notice from college ──
const DQ = rot(rect(70, 158, 262, 380), 2, 201, 348);
function doc(p) {
  const bar = (y, w, o = 0.16) => `<rect x="92" y="${y}" width="${w}" height="7" rx="3.5" fill="#222" opacity="${o}"/>`;
  return `<defs>${finish(p)}${grain(p, 'w', '0.004 0.09', 13, '0.55 0 0 0 0.07  0.36 0 0 0 0.045  0.22 0 0 0 0.025  0 0 0 0 1')}</defs>
    <rect width="${W}" height="${H}" fill="#2e2016"/><rect width="${W}" height="${H}" filter="url(#${p}w)"/><rect width="${W}" height="${H}" fill="url(#${p}lt)"/>
    <g transform="rotate(2 201 348)">
      <rect x="70" y="160" width="262" height="380" fill="#000" opacity=".55" filter="url(#${p}sh)" transform="translate(8 12)"/>
      <rect x="70" y="158" width="262" height="380" fill="#fdfcf8"/>
      <g font-family="${SANS}" fill="#1f1f1f">
        <text x="201" y="194" text-anchor="middle" font-size="14" font-weight="700" letter-spacing="1.6">CITY COLLEGE</text>
        <text x="201" y="212" text-anchor="middle" font-size="12" fill="#555">Exams office</text>
        <line x1="92" y1="226" x2="310" y2="226" stroke="#1f1f1f" stroke-width="1"/>
        <text x="92" y="252" font-size="15" font-weight="700">GE I: Internal assessment</text>
        <text x="92" y="270" font-size="12" fill="#555">Semester I, 2026–27</text>
        <text x="92" y="302" font-size="13" font-weight="700">Test 1</text><text x="310" y="302" font-size="13" text-anchor="end">30 Oct, 10:30</text>
        <text x="92" y="320" font-size="12" fill="#555">Room 14, Block B</text>
        <text x="92" y="350" font-size="13" font-weight="700">Assignment</text><text x="310" y="350" font-size="13" text-anchor="end">Due 6 Nov</text>
        <text x="92" y="368" font-size="12" fill="#555">Two pages, handwritten</text>
        ${bar(392, 218)}${bar(408, 196)}${bar(424, 210)}${bar(440, 150)}${bar(462, 204)}${bar(478, 120)}
        <text x="92" y="516" font-size="12" fill="#555">Weightage: 25 marks</text>
      </g>
    </g>
    <rect width="${W}" height="${H}" fill="url(#${p}vg)"/>`;
}

// ── 8 · a whiteboard of goals (Mission takes a written goal list or a vision board) ──
const GQ = rect(34, 176, 334, 364);
function goals(p) {
  const line = (y, t) => `<text x="64" y="${y}" font-size="19">${t}</text>`;
  return `<defs>${finish(p, { cy: '40%', dark: 0.5 })}${grain(p, 'wl', '0.9', 31, '0.12 0 0 0 0.52  0.12 0 0 0 0.51  0.12 0 0 0 0.49  0 0 0 0 1')}
    <linearGradient id="${p}fr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9dde2"/><stop offset="1" stop-color="#9ea4ab"/></linearGradient>
    <linearGradient id="${p}wb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbfcfb"/><stop offset="1" stop-color="#eceeed"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="#7d7a74"/><rect width="${W}" height="${H}" filter="url(#${p}wl)"/><rect width="${W}" height="${H}" fill="url(#${p}lt)"/>
    <rect x="40" y="186" width="334" height="364" rx="6" fill="#000" opacity=".4" filter="url(#${p}sh)" transform="translate(6 10)"/>
    <rect x="34" y="176" width="334" height="364" rx="6" fill="url(#${p}fr)"/>
    <rect x="44" y="186" width="314" height="344" rx="3" fill="url(#${p}wb)"/>
    <g font-family="${HAND}" fill="#1d3f8f">
      <text x="64" y="232" font-size="24" font-weight="700">2026 goals</text>
      <path d="M64 242c40 3 84 3 120-1" fill="none" stroke="#c0392b" stroke-width="2.4" stroke-linecap="round"/>
      ${line(282, '₹2 lakh a month by Dec')}${line(320, 'Bench 60 kg')}${line(358, '12 books (7 done)')}${line(396, '5,000 followers')}${line(434, 'Host their 25th myself')}
      <text x="64" y="476" font-size="19" fill="#b5341f">Learn to swim by March</text>
    </g>
    <rect x="96" y="548" width="210" height="10" rx="3" fill="#8d939a"/>
    <g transform="rotate(-4 150 552)"><rect x="118" y="540" width="70" height="12" rx="4" fill="#c0392b"/><rect x="186" y="542" width="12" height="8" rx="2" fill="#7d1f16"/></g>
    <rect width="${W}" height="${H}" fill="url(#${p}vg)"/>`;
}

// ── 9 · a printed bank statement ──
const STQ = rot(rect(58, 146, 286, 412), -2, 201, 352);
function statement(p) {
  const row = (y, d, t, a, credit = false) => `<text x="80" y="${y}" font-size="12">${d}</text><text x="122" y="${y}" font-size="12">${t}</text><text x="324" y="${y}" font-size="12" text-anchor="end" fill="${credit ? '#1a7f3c' : '#1f1f1f'}">${a}</text>`;
  return `<defs>${finish(p)}${grain(p, 'd', '0.65 0.04', 17, '0.15 0 0 0 0.075  0.15 0 0 0 0.07  0.15 0 0 0 0.065  0 0 0 0 1')}</defs>
    <rect width="${W}" height="${H}" fill="#1c1b1a"/><rect width="${W}" height="${H}" filter="url(#${p}d)"/><rect width="${W}" height="${H}" fill="url(#${p}lt)"/>
    <g transform="rotate(-2 201 352)">
      <rect x="58" y="148" width="286" height="412" fill="#000" opacity=".55" filter="url(#${p}sh)" transform="translate(8 12)"/>
      <rect x="58" y="146" width="286" height="412" fill="#fdfdfb"/>
      <rect x="58" y="146" width="286" height="44" fill="#123a73"/>
      <g font-family="${SANS}" fill="#1f1f1f">
        <text x="80" y="174" font-size="15" font-weight="700" letter-spacing="1.4" fill="#ffffff">DEMO BANK</text>
        <text x="324" y="174" font-size="12" text-anchor="end" fill="#dbe6f5">Statement of account</text>
        <text x="80" y="214" font-size="13" font-weight="700">Alex Morgan</text>
        <text x="80" y="232" font-size="12" fill="#555">Savings · A/c ending 4021</text>
        <text x="80" y="250" font-size="12" fill="#555">1 Oct to 21 Oct 2026</text>
        <line x1="80" y1="266" x2="324" y2="266" stroke="#1f1f1f"/>
        <text x="80" y="284" font-size="12" font-weight="700">Date</text><text x="122" y="284" font-size="12" font-weight="700">Narration</text><text x="324" y="284" font-size="12" font-weight="700" text-anchor="end">Amount</text>
        <line x1="80" y1="292" x2="324" y2="292" stroke="#c9c9c9"/>
        ${row(312, '21/10', 'UPI · Swiggy', '−340')}${row(334, '20/10', 'UPI · Uber India', '−210')}${row(356, '19/10', 'Myntra', '−2,400')}${row(378, '18/10', 'UPI · Morgan & Co.', '+5,000', true)}
        ${row(400, '17/10', 'Cursor subscription', '−1,700')}${row(422, '16/10', 'UPI · Chai Point', '−40')}${row(444, '15/10', 'UPI · Print Hub', '−90')}${row(466, '14/10', 'UPI · Metro card', '−200')}
        <line x1="80" y1="482" x2="324" y2="482" stroke="#c9c9c9"/>
        <text x="80" y="504" font-size="12" fill="#555">38 transactions</text><text x="324" y="504" font-size="13" font-weight="700" text-anchor="end">Closing ₹18,240</text>
        <text x="80" y="540" font-size="12" fill="#888">Page 1 of 3</text>
      </g>
    </g>
    <rect width="${W}" height="${H}" fill="url(#${p}vg)"/>`;
}

// ── 10 · a card someone handed you at the City College E-Summit ──
const KQ = rot(rect(54, 272, 294, 172), -6, 201, 358);
function card(p) {
  return `<defs>${finish(p)}${grain(p, 'w', '0.005 0.1', 21, WOOD)}
    <linearGradient id="${p}cd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbfaf6"/><stop offset="1" stop-color="#ecebe5"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="#24170f"/><rect width="${W}" height="${H}" filter="url(#${p}w)"/><rect width="${W}" height="${H}" fill="url(#${p}lt)"/>
    <g transform="rotate(-6 201 358)">
      <rect x="54" y="272" width="294" height="172" rx="8" fill="#000" opacity=".55" filter="url(#${p}sh)" transform="translate(9 12)"/>
      <rect x="54" y="272" width="294" height="172" rx="8" fill="url(#${p}cd)"/>
      <rect x="54" y="272" width="12" height="172" fill="#c2410c"/>
      <g font-family="${SANS}" fill="#1c1c1c">
        <text x="86" y="318" font-size="21" font-weight="700">Arjun Sethi</text>
        <text x="86" y="340" font-size="12.5" fill="#555">Organising team, City College E-Summit</text>
        <line x1="86" y1="358" x2="146" y2="358" stroke="#c2410c" stroke-width="2"/>
        <text x="86" y="386" font-size="13" font-family="${MONO}">+1 555 0142</text>
        <text x="86" y="408" font-size="12" fill="#555">City College</text>
      </g>
      <g transform="translate(294 386)"><rect width="40" height="40" rx="9" fill="#1c1c1c"/><text x="20" y="26" font-family="${SANS}" font-size="13" font-weight="700" text-anchor="middle" fill="#fff">E·S</text></g>
    </g>
    <rect width="${W}" height="${H}" fill="url(#${p}vg)"/>`;
}

const FQ = rect(33, 204, 336, 336);
const FACEQ = rect(73, 200, 256, 336);
const iso = TODAY_LABEL.iso;

// What the agent reads from each scene. app: who takes it (an aspect id, 'content', 'brain' or 'today').
export const SCENES = [
  { id: 'receipt', name: 'Receipt', draw: receipt, quad: RQ, kind: 'receipt', tag: 'Receipt · Haldiram\'s · ₹486',
    title: 'Receipt · Haldiram\'s', sub: '₹486 · 3 items · today 13:52',
    rows: [['Raj kachori', '₹180'], ['Chole bhature', '₹230'], ['Masala chaas × 2', '₹76']], total: ['Total', '₹486'],
    to: { app: 'money', where: 'Money · Food & drinks', act: 'Add expense', done: 'Added ₹486 to Food & drinks' },
    alts: [
      { label: 'Split it', app: 'money', where: 'Money · Split with someone', act: 'Split ₹486', done: 'Split ₹486 in Money', patch: { split: true } },
      { label: 'It was for the shop', app: 'money', where: 'Money › Morgan & Co.', act: 'Add shop expense', done: 'Added ₹486 to the shop', patch: { category: 'Shop' } },
      { label: 'Save to Brain', app: 'brain', where: 'Brain › Money › Receipts', act: 'Save', done: 'Saved to Money › Receipts' },
    ],
    result: { kind: 'receipt', title: 'Haldiram\'s', fields: { merchant: 'Haldiram\'s', total: 486, date: iso, items: [{ name: 'Raj kachori', price: 180 }, { name: 'Chole bhature', price: 230 }, { name: 'Masala chaas × 2', price: 76 }], category: 'Food & drinks' } } },
  { id: 'food', name: 'Food', draw: food, quad: FQ, round: true, kind: 'food', tag: 'Thali · about 1,000 kcal',
    title: 'Dal makhani thali', sub: 'About 1,000 kcal · 36 g protein',
    rows: [['Dal makhani, 180 g', '9 g'], ['Paneer butter masala, 150 g', '14 g'], ['2 roti, jeera rice, raita', '13 g']], total: ['Protein after this', '98 of 120 g'],
    to: { app: 'body', where: 'Body · Fuel, lunch', act: 'Log meal', done: 'Logged the thali: protein 98 of 120 g' },
    alts: [
      { label: 'It\'s tonight\'s dinner', app: 'body', where: 'Body · Fuel, dinner 20:30', act: 'Log for 20:30', done: 'Logged for dinner at 20:30', patch: { meal: 'dinner' } },
      { label: 'I ate half', app: 'body', where: 'Body · Fuel, half portion', act: 'Log half', done: 'Logged half: protein 80 of 120 g', patch: { portion: 0.5 } },
      { label: 'Save to Brain', app: 'brain', where: 'Brain › Body › Fuel', act: 'Save', done: 'Saved to Body › Fuel' },
    ],
    result: { kind: 'food', title: 'Dal makhani thali', fields: { name: 'Dal makhani thali', items: [{ name: 'Dal makhani', grams: 180, kcal: 230, protein: 9 }, { name: 'Paneer butter masala', grams: 150, kcal: 330, protein: 14 }, { name: 'Roti × 2', grams: 80, kcal: 210, protein: 7 }, { name: 'Jeera rice', grams: 120, kcal: 170, protein: 3 }, { name: 'Raita', grams: 100, kcal: 60, protein: 3 }], kcal: 1000, protein: 36, carbs: 118, fat: 38 } } },
  { id: 'face', name: 'Face', draw: face, quad: FACEQ, round: true, kind: 'face', front: true, tag: 'Face · front · good light',
    title: 'Face scan · front', sub: 'Good light, neutral face. Compares with 8 Oct',
    rows: [['Light', 'Even'], ['Angle', 'Straight on'], ['Last scan', '8 Oct, 14 days ago']],
    to: { app: 'body', where: 'Body › Looks', act: 'Add to my scans', done: 'Added to Looks. Compare it there' },
    alts: [
      { label: 'Side profile next', app: 'body', where: 'Body › Looks, side', act: 'Scan the side', done: 'Front saved. Turn to the side', patch: { angle: 'side' } },
      { label: 'Retake', app: 'none', where: 'Nothing saved', act: 'Retake', done: 'Ready to retake' },
    ],
    result: { kind: 'face', title: 'Face scan · front', fields: { angle: 'front', scores: { overall: 6.4, jawline: 5.8, skin: 6.9, symmetry: 7.2 } } } },
  { id: 'book', name: 'Book', draw: book, quad: BQ, kind: 'book', tag: 'Book · Atomic Habits',
    title: 'Atomic Habits', sub: 'James Clear · page 142 of 320',
    progress: 142 / 320, progressLabel: ['Where you are', 'Page 142 of 320'],
    rows: [['Reading today', '21:30, 20 pages'], ['This year', '7 of 12 books']],
    to: { app: 'mind', where: 'Mind · Library', act: 'Log reading', done: 'Logged: Atomic Habits, page 142' },
    alts: [
      { label: 'Save a highlight', app: 'brain', where: 'Brain › Mind › Library', act: 'Save highlight', done: 'Saved a highlight to Mind › Library' },
      { label: 'I finished it', app: 'mind', where: 'Mind · 8 of 12 books', act: 'Mark finished', done: 'Finished. 8 of 12 books this year', patch: { page: 320 } },
    ],
    result: { kind: 'book', title: 'Atomic Habits', fields: { title: 'Atomic Habits', author: 'James Clear', pages: 320, page: 142 } } },
  { id: 'page', name: 'Page', draw: page, quad: PQ, kind: 'page', tag: 'Handwriting · 22 Oct',
    title: 'Handwritten page', sub: '6 lines, read in 0.8 s',
    quote: 'Shop day. Dad liked the new listings. 12 kurtas online by Sunday. Gym 6:30 tomorrow. Ask Kabir: Saturday?',
    to: { app: 'growth', where: 'Growth · today\'s journal', act: 'Add to journal', done: 'Added to tonight\'s journal. The streak is safe' },
    alts: [
      { label: 'Make 3 tasks', app: 'today', where: 'Today · 3 tasks', act: 'Add 3 tasks', done: '3 tasks added to Today', task: { title: 'Upload 12 kurtas online', when: 'Sun 25' } },
      { label: 'Save to Brain', app: 'brain', where: 'Brain › Growth › Journal', act: 'Save', done: 'Saved to Growth › Journal' },
    ],
    result: { kind: 'page', title: 'Handwritten page', fields: { text: 'Shop day. Dad liked the new listings. 12 kurtas online by Sunday. Gym 6:30 tomorrow. Ask Kabir: Saturday?', date: iso } } },
  { id: 'chat', name: 'Chat', draw: chat, quad: CQ, kind: 'chat', shot: '17:06', tag: 'Chat · Kabir · Saturday 20:00',
    title: 'Chat with Kabir', sub: 'Your latest screenshot, 17:06',
    quote: '“momos at 8? the usual place” · you said yes', event: 'Saturday 24 Oct, 20:00 · momos',
    to: { app: 'friends', where: 'Friends › Kabir', act: 'Log plan', done: 'Saturday 20:00 with Kabir, logged' },
    alts: [
      { label: 'Add to calendar', app: 'today', where: 'Today · Sat 24, 20:00', act: 'Add to calendar', done: 'Added to Saturday, 20:00', task: { title: 'Momos with Kabir', when: 'Sat 24 20:00', person: 'kabir' } },
      { label: 'Save to his file', app: 'brain', where: 'Brain › People › Kabir', act: 'Save', done: 'Saved to Kabir\'s file', person: 'kabir' },
    ],
    result: { kind: 'chat', title: 'Chat with Kabir', fields: { app: 'WhatsApp', person: 'kabir', text: 'Kabir: bhai saturday free hai?\nKabir: momos at 8? the usual place\nMe: haan done\nKabir: sahi hai, 8 baje' } } },
  { id: 'doc', name: 'Document', draw: doc, quad: DQ, kind: 'document', tag: 'Document · GE I assessment',
    title: 'GE I internal assessment', sub: 'City College · 2 dates found',
    rows: [['Test 1', 'Fri 30 Oct, 10:30'], ['Assignment due', 'Fri 6 Nov']],
    to: { app: 'brain', where: 'Brain › Mind › City College', act: 'Save to Brain', done: 'Saved to Mind › City College' },
    alts: [
      { label: 'Add 2 dates to calendar', app: 'today', where: 'Today · 30 Oct and 6 Nov', act: 'Add 2 dates', done: 'Test 1 and the assignment are on your calendar', task: { title: 'GE I test 1', when: 'Fri 30 Oct 10:30' } },
      { label: 'Make a task', app: 'today', where: 'Today · task for 5 Nov', act: 'Add task', done: 'Task added: write the GE I assignment', task: { title: 'Write the GE I assignment', when: 'Thu 5 Nov' } },
    ],
    result: { kind: 'document', title: 'GE I internal assessment', fields: { name: 'GE I internal assessment', text: 'Test 1 on 30 October at 10:30, Room 14, Block B. Assignment due 6 November.', aspect: 'mind' } } },
  { id: 'goals', name: 'Goals', draw: goals, quad: GQ, kind: 'goals', lookFor: 'goal list', tag: 'Goal list · 6 goals, 1 new',
    title: 'Your 2026 goals', sub: 'From the whiteboard · 6 goals, 5 already in Mission',
    rows: [['Already in Mission', '5 goals'], ['New', 'Learn to swim by March'], ['Horizon it suggests', 'This year']],
    to: { app: 'mission', where: 'Mission · this year', act: 'Add the new goal', done: 'Over to Mission to set it up' },
    alts: [{ label: 'Save to Brain', app: 'brain', where: 'Brain › Mission › Purpose', act: 'Save', done: 'Saved to Mission › Purpose' }],
    result: { kind: 'goals', title: '2026 goals', fields: { lines: ['Learn to swim by March'], text: '2026 goals: ₹2 lakh a month by Dec. Bench 60 kg. 12 books. 5,000 followers. Host their 25th myself. Learn to swim by March.' } } },
  { id: 'statement', name: 'Statement', draw: statement, quad: STQ, kind: 'statement', lookFor: 'bank statement', tag: 'Bank statement · Demo Bank · 1 to 21 Oct',
    title: 'Bank statement · Demo Bank', sub: '1 to 21 Oct · page 1 of 3 · 38 rows',
    rows: [['New to Money', '31 rows'], ['Already logged from UPI', '7 rows'], ['Leak it spotted', 'Cursor, ₹1,700']],
    to: { app: 'money', where: 'Money · import October', act: 'Review 31 rows', done: '31 rows sent to Money for review' },
    alts: [{ label: 'Save to Brain', app: 'brain', where: 'Brain › Money › Statements', act: 'Save', done: 'Saved to Money › Statements' }],
    result: { kind: 'statement', title: 'Demo Bank statement', fields: { bank: 'Demo Bank', period: '1–21 Oct', rows: [
      { date: '2026-10-21', desc: 'UPI · Swiggy', amount: -340 }, { date: '2026-10-20', desc: 'UPI · Uber India', amount: -210 }, { date: '2026-10-19', desc: 'Myntra', amount: -2400 },
      { date: '2026-10-18', desc: 'UPI · Morgan & Co.', amount: 5000 }, { date: '2026-10-17', desc: 'Cursor subscription', amount: -1700 }, { date: '2026-10-16', desc: 'UPI · Chai Point', amount: -40 },
      { date: '2026-10-15', desc: 'UPI · Print Hub', amount: -90 }, { date: '2026-10-14', desc: 'UPI · Metro card', amount: -200 }] } } },
  { id: 'card', name: 'Card', draw: card, quad: KQ, kind: 'card', lookFor: 'card', tag: 'Card · Arjun Sethi · City College',
    title: 'Arjun Sethi', sub: 'Someone you met at the City College E-Summit',
    rows: [['Phone', '+1 555 0142'], ['Where you met', 'City College E-Summit, today']],
    to: { app: 'friends', where: 'Friends · someone new', act: 'Add to your circle', done: 'Arjun is in Friends. Wyn will ask how it went' },
    alts: [
      { label: 'Remind me to follow up', app: 'today', where: 'Today · Sat 24', act: 'Add reminder', done: 'Reminder set for Saturday', task: { title: 'Follow up with Arjun from the E-Summit', when: 'Sat 24' } },
      { label: 'Save to Brain only', app: 'brain', where: 'Brain › People', act: 'Save', done: 'Saved to People in your Brain' },
    ],
    result: { kind: 'card', title: 'Arjun Sethi', fields: { name: 'Arjun Sethi', phone: '+1 555 0142', where: 'City College E-Summit, 22 Oct' } } },
];
const LOOK_FOR = { receipt: 'receipt', food: 'meal', face: 'face', book: 'book', page: 'page', chat: 'chat', doc: 'document' };
SCENES.forEach((s) => { s.lookFor ??= LOOK_FOR[s.id]; });
export const sceneById = (id) => SCENES.find((s) => s.id === id);
export const sceneIndex = (hint) => Math.max(0, SCENES.findIndex((s) => s.id === hint || s.kind === hint));
export const sceneSvg = (s, p = `cs-${s.id}-`) => `<svg class="cap-scene-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${s.draw(p)}</svg>`;
export const SCENE_BOX = { W, H };
