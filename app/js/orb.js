// The living orb: the agent's body. A fluid blob that reads her state (calm, listening, thinking, speaking with her
// voice) and his mood: setMood({ stress 0–1, energy 0–1, valence −1…1 }) runs from cool violets and blues when he is
// calm, through magenta and pink, to amber and then red when he is stressed or carrying too much, and its motion goes
// from slow and round to quick and choppy. It squishes under a finger and follows it like jelly. Hold it to breathe:
// it vibrates, you let go, and it guides you through box (4-4-4-4) or 4-7-8 breathing, a vibration at each change.
//
// mountOrb(el, opts) → { setMood, setState, setLevel, startBreathing, stop, destroy }
// setMood(mood) (module level) is his mood for the whole app: every mounted orb and every small orb mark follows it.
// Drawn in WebGL; Canvas 2D where WebGL is missing; a still CSS orb as the last resort. Owner: MOTION (notes/motion.md).
import { SPRINGS, Spring, SpringSet, clock, clamp, lerp, haptic, reduced, onReduced, onVisible, tracker, rubberband, easeFn, springCurve, nativeApi } from './motion.js';

// ── colour: palettes in OKLCH, mixed along the short way round the hue circle, so calm → stressed passes through
//    violet, magenta and pink instead of grey ─────────────────────────────────────────────────────────────────────
// [deep, body, current, light]: the deep colour pools at the bottom and the rim, the light sits up top
const P_CALM = [[0.42, 0.2, 284], [0.58, 0.2, 263], [0.8, 0.13, 218], [0.84, 0.09, 296]];
const P_WARM = [[0.5, 0.19, 36], [0.68, 0.19, 50], [0.83, 0.15, 80], [0.91, 0.07, 72]];
const P_HOT = [[0.42, 0.19, 25], [0.6, 0.235, 27], [0.71, 0.2, 40], [0.83, 0.1, 18]];
const P_BREATH = [[0.44, 0.13, 244], [0.56, 0.12, 222], [0.7, 0.1, 198], [0.7, 0.09, 266]];   // deep enough for white words
const smooth = (t) => t * t * (3 - 2 * t);
// dir +1 warms (cool hues up through magenta and red to amber), −1 cools back the same way: never through green
const mixHue = (a, b, t, dir = 0) => { let d = ((b - a + 540) % 360) - 180; if (dir > 0 && d < 0) d += 360; if (dir < 0 && d > 0) d -= 360; return (a + d * t + 720) % 360; };
const mixLch = (A, B, t, dir = 0) => A.map((a, i) => [lerp(a[0], B[i][0], t), lerp(a[1], B[i][1], t), mixHue(a[2], B[i][2], t, dir)]);
function lchToRgb([L, C, h]) {
  const hr = (h * Math.PI) / 180, a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((c) => clamp(c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055));
}
const norm = (m = {}) => ({ stress: clamp(+(m.stress ?? 0.2)), energy: clamp(+(m.energy ?? 0.55)), valence: clamp(+(m.valence ?? 0.1), -1, 1) });
/** The four colours of a mood, as [r, g, b] 0–1. breath (0–1) pulls toward the breathing session's deep teal. */
export function moodPalette(mood, breath = 0) {
  const { stress: s, energy: e, valence: v } = norm(mood);
  // calm holds to 0.22, warms by 0.62, red by 0.92
  let P = s <= 0.62 ? mixLch(P_CALM, P_WARM, smooth(clamp((s - 0.22) / 0.4)), 1) : mixLch(P_WARM, P_HOT, smooth(clamp((s - 0.62) / 0.3)));
  P = P.map(([L, C, h]) => [clamp(L * (0.86 + 0.28 * e) + 0.045 * v, 0.2, 0.95), clamp(C * (0.78 + 0.44 * e) * (1 + 0.18 * v), 0, 0.33), h]);
  if (breath > 0) P = mixLch(P, P_BREATH, breath, -1);
  return P.map(lchToRgb);
}
const css = (c) => `rgb(${c.map((x) => Math.round(x * 255)).join(' ')})`;
/** A mood's main colour as CSS, for anything else that wants to follow it (a chip, a line, a ring). */
export const moodColor = (mood, i = 1) => css(moodPalette(mood)[i]);
// how a mood moves: calm is slow and round; stress is quick, lumpier, and past 0.7 it trembles
function moodMotion(m) {
  const { stress: s, energy: e } = norm(m);
  return { speed: 0.14 + 1.15 * s ** 1.5 + 0.18 * e, flow: 0.06 + 0.2 * e + 0.32 * s, amp: 0.011 + 0.042 * s ** 1.3 + 0.01 * e, chop: s * s, freq: 0.72 + 0.62 * s, glow: 0.5 + 0.35 * e, jitter: clamp((s - 0.7) / 0.3) };
}

// ── his mood, app-wide ────────────────────────────────────────────────────────────────────────────────────────────
let MOOD = norm({});
const orbs = new Set();
const writeRoot = () => {
  if (typeof document === 'undefined') return;
  const p = moodPalette(MOOD); const st = document.documentElement.style;
  p.forEach((c, i) => st.setProperty(`--lv-c${i}`, css(c)));
  st.setProperty('--lv-stress', MOOD.stress.toFixed(3));
};
/** His mood for the whole app (the agent sets it from what she knows). Orbs and small orb marks follow it. */
export function setMood(m) { MOOD = norm({ ...MOOD, ...m }); writeRoot(); orbs.forEach((o) => !o.local && o._mood(MOOD)); return MOOD; }
export const getMood = () => ({ ...MOOD });

// ── breathing ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const BREATH = {
  box: { id: 'box', name: 'Box breathing', steps: [['in', 4], ['hold', 4], ['out', 4], ['rest', 4]], cycles: 4 },
  '478': { id: '478', name: '4-7-8 breathing', steps: [['in', 4], ['hold', 7], ['out', 8]], cycles: 4 },
  calm: { id: 'calm', name: 'Calm breathing', steps: [['in', 4], ['hold', 4], ['out', 6]], cycles: 5 },
};
const WORD = { in: 'Breathe in', hold: 'Hold', out: 'Breathe out', rest: 'Hold' };
const BUZZ = { in: 'breathe-in', hold: 'breathe-hold', out: 'breathe-out', rest: 'breathe-rest' };
function plan(pattern = 'box', cycles) {
  const p = typeof pattern === 'object' ? pattern : BREATH[pattern] ?? BREATH.box;
  const steps = p.steps.filter(([, s]) => s > 0);
  const len = steps.reduce((a, [, s]) => a + s, 0); const n = cycles ?? p.cycles ?? 4;
  return { ...p, steps, cycles: n, len, total: len * n };
}
function where(P, sec) {
  if (sec >= P.total) return null;
  const cycle = Math.floor(sec / P.len); let t = sec - cycle * P.len;
  for (let i = 0; i < P.steps.length; i++) { const [kind, s] = P.steps[i]; if (t < s) return { cycle, i, kind, k: t / s, left: s - t, dur: s }; t -= s; }
  return null;
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
// Inside the app, NATIVE's breathing programme keeps time and buzzes with the screen off (notes/native.md 2):
// native.haptics.breathe() runs it; its `breath` events (each phase, then 'done') keep the orb in step. follow: a
// session that is already running (started from Control Center or Siri: agenticos://breathe?running=1).
async function nativeBreath(P, onEvent, { follow = false } = {}) {
  try {
    const N = await nativeApi();
    if (!N?.available || typeof N.haptics?.breathe !== 'function') return null;
    const off = N.on?.('breath', onEvent);
    if (!follow) {
      const pattern = BREATH[P.id] ? P.id : P.steps.map(([phase, s]) => ({ phase, s }));
      const r = await N.haptics.breathe({ pattern, cycles: P.cycles, title: P.name });
      if (!r || r.available === false || r.ok === false) { off?.(); return null; }
    }
    return { stop: () => { off?.(); if (!follow) N.haptics.stop?.(); }, off: () => off?.(), follow };
  } catch { return null; }
}

// ── the WebGL body ────────────────────────────────────────────────────────────────────────────────────────────────
const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
// simplex noise: Ian McEwan, Ashima Arts (MIT licence), github.com/ashima/webgl-noise
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uDetail, uR, uScale, uPhase, uFlow, uAmp, uChop, uFreq, uGlow, uBand, uBandA, uRim, uLevel, uSkin, uLight, uTime, uDim, uDrop;
uniform vec2 uOff, uStretch; uniform vec3 uPress, uC0, uC1, uC2, uC3;
vec3 m289(vec3 x){return x-floor(x*(1./289.))*289.;} vec4 m289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 perm(vec4 x){return m289(((x*34.)+10.)*x);} vec4 tis(vec4 r){return 1.79284291400159-.85373472095314*r;}
float sn(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
i=m289(i);vec4 p=perm(perm(perm(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
vec4 nm=tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=nm.x;p1*=nm.y;p2*=nm.z;p3*=nm.w;
vec4 m=max(.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;return 105.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
float edge(vec2 p,vec2 dir,float len){
  float n=sn(vec3(dir*uFreq,uPhase))*uAmp;
  n+=sn(vec3(dir*uFreq*1.7+7.1,uPhase*2.3))*uAmp*.32*uChop;
  n+=sin(atan(dir.y,dir.x)*5.+uTime*7.)*uLevel*.014;
  if(uPress.z>0.){float k=max(0.,dot(dir,normalize(uPress.xy+vec2(1e-5))));n-=uPress.z*.11*k*k*k*smoothstep(0.,.45,length(uPress.xy));}
  return len-(1.+n);
}
void main(){
  vec2 px=gl_FragCoord.xy-.5*uRes-uOff;
  float rr=uR*uScale; vec2 p=px/rr;
  float sl=length(uStretch);
  if(sl>1e-4){vec2 d=uStretch/sl;float a=dot(p,d);vec2 pe=p-a*d;p=d*a/(1.+sl)+pe*(1.+sl*.5);}
  float len=length(p); vec2 dir=len>1e-5?p/len:vec2(0.,1.);
  float d=edge(p,dir,len);
  float aa=1.6/rr; float ins=1.-smoothstep(-aa,aa,d);
  vec3 col=vec3(0.); float A=0.;
  if(d<aa*2.){
    float R=len-d; vec2 q=p/max(R,.5); float lq=length(q);
    // big, slow currents, like ink turning in water: a warped field, then two colour fields read through it
    vec2 qd=q*uDetail;
    vec2 w=vec2(sn(vec3(qd*.55,uFlow*.21)),sn(vec3(qd*.55+5.2,uFlow*.19+4.)));
    vec2 qq=qd+w*.6*uDetail;
    float f1=sn(vec3(qq*.82,uFlow*.17+3.));
    float f2=sn(vec3(qq*1.15+8.1,uFlow*.23));
    float yv=smoothstep(-1.,1.,q.y);
    float z=sqrt(max(0.,1.-min(dot(q,q),1.))); vec3 N=normalize(vec3(q,z+.0001)); float fr=pow(1.-z,2.4);
    float ang=atan(q.y,q.x);
    if(uSkin<.5){
      col=mix(uC0,uC1,smoothstep(-.75,.55,f1*.85+yv*.6-.2));
      col=mix(col,uC2,smoothstep(.12,.9,f2+w.x*.25)*.72);
      col=mix(col,uC3,smoothstep(.5,1.1,f1*.55+yv*.75-lq*.35)*.62);
      col*=.7+.3*yv*(1.-uLight*.5)+uLight*.12;
      col+=uC3*.07*(1.-lq);
      col=mix(col,mix(uC2,vec3(1.),.45),fr*(.3+uRim*.8));
      float band=pow(.5+.5*cos(ang-uBandA),10.)*uBand;
      col+=mix(uC2,vec3(1.),.6)*band*(.12+fr*.85);
      vec3 L=normalize(vec3(-.45,.6,.66)); vec3 H=normalize(L+vec3(0.,0.,1.)); float nh=max(dot(N,H),0.);
      col+=vec3(1.)*(pow(nh,70.)*.34+pow(nh,5.)*.05);
      col+=vec3(1.)*.12*smoothstep(.6,1.,-q.y)*fr;
    } else {
      // Matte: pigment pooled on violet stock. Flat inks with soft-printed edges, a fall-off at the rim, the grain on top
      vec3 base=mix(uC0,uC1,smoothstep(-.32,.3,f1+yv*.5-.3));
      base=mix(base,uC2,smoothstep(-.12,.26,f2-.3)*.78);
      base=mix(base,uC3,smoothstep(-.1,.24,f1*.6+yv*.6-.75)*.62);
      base=mix(base,uC2,pow(.5+.5*cos(ang-uBandA),12.)*uBand*.55);
      col=base*(1.-.32*pow(min(lq,1.),5.));
      col*=1.-.1*smoothstep(-.2,-1.,q.y);
      col+=(hash(floor(gl_FragCoord.xy))-.5)*.07;
    }
    col*=uDim; A=ins;
  }
  float g=0.;
  if(uGlow>0.&&d>-aa){vec2 pg=p+vec2(0.,uDrop);float dg=length(pg)-(len-d); g=exp(-max(dg,0.)*3.6)*uGlow*(1.-ins);}
  vec3 gc=mix(uC1,uC2,.35);
  gl_FragColor=vec4(col*A+gc*g*.62,clamp(A+g*.62,0.,1.));
}`;
const UNI = ['uRes', 'uDetail', 'uR', 'uScale', 'uPhase', 'uFlow', 'uAmp', 'uChop', 'uFreq', 'uGlow', 'uBand', 'uBandA', 'uRim', 'uLevel', 'uSkin', 'uLight', 'uTime', 'uDim', 'uDrop', 'uOff', 'uStretch', 'uPress', 'uC0', 'uC1', 'uC2', 'uC3'];
function glRenderer(canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[orb]', gl.getShaderInfoLog(s)); return null; } return s; };
  const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn('[orb]', gl.getProgramInfoLog(pr)); return null; }
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = Object.fromEntries(UNI.map((n) => [n, gl.getUniformLocation(pr, n)]));
  gl.clearColor(0, 0, 0, 0);
  return {
    kind: 'webgl',
    draw(f) {
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      for (const k of ['uDetail', 'uR', 'uScale', 'uPhase', 'uFlow', 'uAmp', 'uChop', 'uFreq', 'uGlow', 'uBand', 'uBandA', 'uRim', 'uLevel', 'uSkin', 'uLight', 'uTime', 'uDim', 'uDrop']) gl.uniform1f(U[k], f[k]);
      gl.uniform2f(U.uOff, f.uOff[0], f.uOff[1]); gl.uniform2f(U.uStretch, f.uStretch[0], f.uStretch[1]);
      gl.uniform3f(U.uPress, f.uPress[0], f.uPress[1], f.uPress[2]);
      for (let i = 0; i < 4; i++) gl.uniform3f(U[`uC${i}`], ...f.pal[i]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    lost: () => gl.isContextLost(),
    dispose() { try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch {} },
  };
}

// ── the Canvas 2D body: the same blob, a sum of slow waves round the rim, gradients for the colour ─────────────────
function ctxRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  let grain = null;
  const grainPat = () => {
    if (grain) return grain;
    const g = document.createElement('canvas'); g.width = g.height = 96; const c = g.getContext('2d'); const im = c.createImageData(96, 96);
    for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 22; }
    c.putImageData(im, 0, 0); grain = ctx.createPattern(g, 'repeat'); return grain;
  };
  const K = [[2, 1, 0.31], [3, 0.7, 1.7], [4, 0.45, 2.9], [5, 0.3, 4.1], [7, 0.18, 5.3]];
  return {
    kind: '2d',
    draw(f) {
      const W = canvas.width, H = canvas.height; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      const rr = f.uR * f.uScale; const cx = W / 2 + f.uOff[0], cy = H / 2 - f.uOff[1];
      const pts = 72; const path = new Path2D();
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2; let n = 0;
        for (const [k, w, ph] of K) n += Math.sin(k * a + ph + f.uPhase * (0.6 + k * 0.25)) * w * (k > 3 ? f.uChop + 0.2 : 1);
        n = n * f.uAmp * 0.55 + Math.sin(a * 5 + f.uTime * 7) * f.uLevel * 0.014;
        const dx = Math.cos(a), dy = -Math.sin(a);
        if (f.uPress[2] > 0) { const pl = Math.hypot(f.uPress[0], f.uPress[1]) || 1; const k = Math.max(0, (dx * f.uPress[0] - dy * f.uPress[1]) / pl); n -= f.uPress[2] * 0.11 * k ** 3; }
        const r = rr * (1 + n); const x = cx + dx * r, y = cy + dy * r;
        if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
      }
      path.closePath();
      const [c0, c1, c2, c3] = f.pal.map((c) => c.map((v) => Math.round(v * 255 * f.uDim)));
      const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
      if (f.uGlow > 0) { const g = ctx.createRadialGradient(cx, cy + rr * f.uDrop, rr * 0.7, cx, cy + rr * f.uDrop, rr * 1.55); g.addColorStop(0, rgb(c1, 0.5 * f.uGlow)); g.addColorStop(1, rgb(c1, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
      ctx.save(); ctx.clip(path);
      const base = ctx.createRadialGradient(cx + rr * 0.25, cy - rr * 0.45, rr * 0.1, cx, cy, rr * 1.15); base.addColorStop(0, rgb(c1)); base.addColorStop(1, rgb(c0));
      ctx.fillStyle = base; ctx.fillRect(cx - rr * 1.5, cy - rr * 1.5, rr * 3, rr * 3);
      const blob = (c, x, y, s) => { const g = ctx.createRadialGradient(x, y, 0, x, y, rr * s); g.addColorStop(0, rgb(c, f.uSkin ? 0.95 : 0.85)); g.addColorStop(f.uSkin ? 0.45 : 1, rgb(c, f.uSkin ? 0.9 : 0)); if (f.uSkin) g.addColorStop(0.6, rgb(c, 0)); ctx.fillStyle = g; ctx.fillRect(cx - rr * 1.5, cy - rr * 1.5, rr * 3, rr * 3); };
      const t = f.uFlow;
      blob(c2, cx + rr * (0.4 * Math.cos(t * 0.9) - 0.1), cy + rr * (0.45 + 0.2 * Math.sin(t * 1.1)), 0.7);
      blob(c3, cx + rr * (-0.45 + 0.2 * Math.sin(t * 0.7)), cy + rr * (0.3 * Math.cos(t * 0.8)), 0.62);
      if (!f.uSkin) {
        const hl = ctx.createRadialGradient(cx - rr * 0.32, cy - rr * 0.5, 0, cx - rr * 0.32, cy - rr * 0.5, rr * 0.5); hl.addColorStop(0, 'rgba(255,255,255,.85)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hl; ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
        const sh = ctx.createLinearGradient(0, cy - rr, 0, cy + rr); sh.addColorStop(0.55, 'rgba(10,0,30,0)'); sh.addColorStop(1, 'rgba(10,0,30,.32)'); ctx.fillStyle = sh; ctx.fillRect(cx - rr * 1.5, cy - rr, rr * 3, rr * 2.2);
      } else { ctx.globalAlpha = 1; ctx.fillStyle = grainPat(); ctx.fillRect(cx - rr * 1.5, cy - rr * 1.5, rr * 3, rr * 3); }
      ctx.restore();
    },
    lost: () => false,
    dispose() {},
  };
}

// ── mountOrb ──────────────────────────────────────────────────────────────────────────────────────────────────────
const SKIN = () => (document.documentElement.dataset.skin === 'matte' ? 1 : 0);
const LIGHT = () => (document.documentElement.dataset.theme === 'light' ? 1 : 0);
const sine = easeFn('sine');

/**
 * Mount the living orb in el (its box is the orb; the canvas spills past it for the glow and the breath).
 * opts: size (px, default el's width), mood (else his app-wide mood), local (this orb keeps its own mood),
 * state 'calm' | 'listening' | 'thinking' | 'speaking', interactive 'full' (squish, follow, hold) | 'press'
 * (tap and hold only) | false, hold (hold to breathe, default true), pattern 'box' | '478' | 'calm', cycles,
 * overlay 'auto' (small orbs breathe in a full-screen overlay) | true | false, overlayRoot, renderer 'auto' | 'webgl'
 * | '2d' | 'css', label, onTap, onBreathStart(plan), onBreathPhase(phase), onBreathEnd(summary).
 */
export function mountOrb(el, opts = {}) {
  const o = { interactive: undefined, hold: true, pattern: 'box', overlay: 'auto', renderer: 'auto', label: 'Wyn', ...opts };
  let S = o.size ?? (el.getBoundingClientRect().width || 200);
  if (o.interactive === undefined) o.interactive = S >= 120 ? 'full' : 'press';
  el.classList.add('lv');
  el.style.setProperty('--lv-s', `${S}px`);
  el.classList.toggle('lv-small', S < 120);
  if (!el.hasAttribute('role')) { el.setAttribute('role', o.interactive ? 'button' : 'img'); }
  el.setAttribute('aria-label', o.hold && o.interactive ? `${o.label}. Hold to breathe` : o.label);
  if (o.interactive && !el.hasAttribute('tabindex')) el.tabIndex = 0;
  el.insertAdjacentHTML('beforeend', '<canvas class="lv-cv" aria-hidden="true"></canvas><svg class="lv-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="lv-rt" cx="50" cy="50" r="47"/><circle class="lv-ra" cx="50" cy="50" r="47" pathLength="1"/></svg><div class="lv-cap" aria-live="polite"><b class="lv-w"></b><span class="lv-n"></span></div>');
  const cv = el.querySelector('.lv-cv'), ringA = el.querySelector('.lv-ra'), ringSvg = el.querySelector('.lv-ring'), capW = el.querySelector('.lv-w'), capN = el.querySelector('.lv-n'), cap = el.querySelector('.lv-cap');
  const PAD = 1.8;
  let R = null;
  const pick = () => {
    if (o.renderer === 'css') return null;
    if (o.renderer !== '2d') { const r = glRenderer(cv); if (r) return r; }
    return ctxRenderer(cv);
  };
  const size = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr ?? (S >= 160 ? 1.75 : S >= 80 ? 2 : 3));
    const css = Math.round(S * PAD);
    cv.style.width = cv.style.height = `${css}px`;
    cv.width = cv.height = Math.max(2, Math.round(css * dpr));
    return dpr;
  };
  let dpr = size();
  R = pick();
  if (!R) { el.classList.add('lv-css'); cv.remove(); }
  const me = { local: !!o.mood || !!o.local };
  let mood = norm(o.mood ?? MOOD), state = o.state ?? 'calm';
  let pal = moodPalette(mood), palTo = pal, mot = moodMotion(mood);
  const live = { speed: mot.speed, flow: mot.flow, amp: mot.amp, chop: mot.chop, freq: mot.freq, glow: mot.glow, jitter: mot.jitter, band: 0, rim: 0, dim: 1 };
  let phase = Math.random() * 10, flow = Math.random() * 10, bandA = 0, last = clock.now(), lastDraw = -1e9, level = 0, levelTo = 0, breathK = 0, alive = true, visible = true, sub = null;
  const press = new Spring({ value: 0, spring: SPRINGS.snappy });
  const pos = new SpringSet({ x: 0, y: 0, sx: 0, sy: 0 }, { spring: SPRINGS.jelly });
  const scale = new Spring({ value: 1, spring: SPRINGS.gentle });
  const hold = new Spring({ value: 0, spring: SPRINGS.snappy });
  let pressAt = [0, 0], breath = null;
  const target = () => {
    const m = moodMotion(mood); const st = state;
    const k = { speed: m.speed, flow: m.flow, amp: m.amp, chop: m.chop, freq: m.freq, glow: m.glow, jitter: m.jitter, band: 0, rim: 0, dim: live.dim };
    if (st === 'listening') { k.amp += 0.006; k.rim = 0.35; }
    if (st === 'thinking') { k.flow *= 2.6; k.speed *= 1.35; k.band = 1; }
    if (st === 'speaking') { k.rim = 0.2; }
    if (breath) { k.amp = 0.006; k.speed *= 0.35; k.flow *= 0.5; k.chop = 0; k.band = 0; k.glow *= 0.8; }
    if (LIGHT()) k.glow *= 0.32;
    if (SKIN()) k.glow = 0;
    return k;
  };
  const kick = () => { if (alive && visible && !sub) { last = clock.now(); sub = clock.add(frame); } };
  const scaleTo = () => (breath ? null : state === 'listening' ? 1.05 : 1);
  function frame(t) {
    if (!alive || !visible) { sub = null; return false; }
    const dt = clamp((t - last) / 1000, 0, 0.05); last = t;
    const rm = reduced();
    const want = target();
    const ease = 1 - Math.exp(-dt * 2.6);   // ~1.2 s to settle a mood or a state
    for (const k in want) live[k] += (want[k] - live[k]) * ease;
    const pk = 1 - Math.exp(-dt * (rm ? 4 : 2.4));
    palTo = moodPalette(mood, breathK);
    pal = pal.map((c, i) => c.map((v, j) => v + (palTo[i][j] - v) * pk));
    const lk = 1 - Math.exp(-dt * (levelTo > level ? 28 : 9)); level += (levelTo - level) * lk;
    if (!rm) {
      phase += live.speed * dt * (1 + live.jitter * 0.7 * Math.sin(t / 61) * Math.sin(t / 23));
      flow += live.flow * dt;
      bandA += dt * 2.3;
    }
    let sc = scale.value;
    if (breath) sc = breathScale(t);
    sc *= 1 - press.value * 0.06 - hold.value * 0.05 + level * 0.075;
    const p = pos.values;
    const busy = rm ? (Math.abs(levelTo - level) > 0.002 || pal.some((c, i) => c.some((v, j) => Math.abs(v - palTo[i][j]) > 0.002)) || press.moving || pos.moving || scale.moving || !!breath || hold.moving) : true;
    // calm and untouched: 30 frames a second is plenty for something this slow
    const slow = !rm && state === 'calm' && !breath && !press.moving && !pos.moving && !hold.moving && level < 0.01 && mood.stress < 0.45;
    if (!slow || t - lastDraw >= 31) { draw(sc, p); lastDraw = t; }
    if (breath) tickBreath(t);
    const ringing = paintRing(t, sc);
    if (!busy && !ringing) { sub = null; return false; }
    return true;
  }
  function draw(sc, p) {
    if (!R) { paintCss(); return; }
    if (R.lost()) return;
    const rr = (S / 2) * dpr;
    R.draw({
      uDetail: clamp(0.55 + (S - 36) / 240, 0.55, 1), uR: rr, uScale: sc, uPhase: phase, uFlow: flow, uAmp: live.amp + level * 0.04, uChop: live.chop, uFreq: live.freq,
      uGlow: live.glow, uBand: live.band, uBandA: bandA, uRim: live.rim + level * 0.3, uLevel: level, uSkin: SKIN(), uLight: LIGHT(),
      uTime: clock.now() / 1000, uDim: live.dim, uDrop: 0.07,
      uOff: [p.x * dpr, -p.y * dpr], uStretch: [p.sx, -p.sy], uPress: [pressAt[0], pressAt[1], Math.max(press.value, 0)], pal,
    });
  }
  function paintCss() { pal.forEach((c, i) => el.style.setProperty(`--lv-o${i}`, css(c))); }

  // ── touch: squish on press, follow the finger, jelly on release, hold to breathe ───────────────────────────────
  let ptr = null; const vt = tracker();
  const HOLD_MS = 650;
  const rel = (e) => { const r = el.getBoundingClientRect(); return [(e.clientX - (r.left + r.width / 2)), (e.clientY - (r.top + r.height / 2))]; };
  const down = (e) => {
    if (!o.interactive || ptr || e.button > 0) return;
    if (breath) { ptr = { id: e.pointerId, breathTap: true, x0: e.clientX, y0: e.clientY }; return; }
    const [x, y] = rel(e);
    ptr = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: clock.now(), drag: false, held: false };
    try { el.setPointerCapture(e.pointerId); } catch {}
    pressAt = [x / (S / 2), -y / (S / 2)];
    press.set(1, { spring: SPRINGS.snappy });
    vt.reset(); vt.add(e.clientX, e.clientY);
    if (o.hold) {
      ptr.holdT = setTimeout(() => { if (ptr && !ptr.drag) { hold.set(1, { response: (HOLD_MS - 180) / 1000 * 1.6, damping: 1 }); ringTo((HOLD_MS - 180) / 1000); } }, 180);
      ptr.fireT = setTimeout(() => { if (ptr && !ptr.drag) { ptr.held = true; startBreathing({ fromHold: true }); } }, HOLD_MS);
    }
    kick();
  };
  const move = (e) => {
    if (!ptr || e.pointerId !== ptr.id || ptr.breathTap) return;
    const dx = e.clientX - ptr.x0, dy = e.clientY - ptr.y0;
    if (!ptr.drag && Math.hypot(dx, dy) > 8) { ptr.drag = true; cancelHold(); }
    if (!ptr.drag || o.interactive !== 'full' || ptr.held) return;
    vt.add(e.clientX, e.clientY);
    const v = vt.velocity(); const lim = S * 0.32;
    const x = rubberband(dx, lim * 2, 0.5), y = rubberband(dy, lim * 2, 0.5);
    const sp = Math.hypot(v.x, v.y); const st = clamp(sp / 2600, 0, 0.22);
    pos.jump({ x, y, sx: sp ? (v.x / sp) * st : 0, sy: sp ? (v.y / sp) * st : 0 });
    const [px, py] = rel(e); pressAt = [px / (S / 2), -py / (S / 2)];
    kick();
  };
  const up = (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const p = ptr; ptr = null;
    if (p.breathTap) { eat = true; if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 12) stopBreathing(); return; }
    clearTimeout(p.holdT); clearTimeout(p.fireT);
    if (p.held || p.drag) eat = true;
    if (!p.held) { hold.set(0, { spring: SPRINGS.snappy }); ringTo(0, true); }
    press.set(0, { spring: p.drag ? SPRINGS.jelly : SPRINGS.lift });
    if (p.drag) {
      const v = vt.velocity();
      const c = pos.values;
      pos.set({ x: 0, y: 0, sx: 0, sy: 0 }, { velocity: { x: v.x, y: v.y, sx: -c.sx * 9, sy: -c.sy * 9 }, spring: reduced() ? SPRINGS.default : SPRINGS.jelly });
    } else if (!p.held && e.type === 'pointerup') o.onTap?.(api);
    kick();
  };
  let eat = false;
  el.addEventListener('click', (e) => { if (eat) { eat = false; e.stopPropagation(); e.preventDefault(); } }, true);
  const cancelHold = () => { if (!ptr) return; clearTimeout(ptr.holdT); clearTimeout(ptr.fireT); hold.set(0, { spring: SPRINGS.snappy }); ringTo(0, true); };
  if (o.interactive) {
    el.style.touchAction = o.interactive === 'full' ? 'none' : 'manipulation';
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (breath) stopBreathing(); else o.onTap?.(api); }
      if ((e.key === 'b' || e.key === 'B') && o.hold && !breath) startBreathing();
    });
  }
  // the ring: the hold that gathers (linear, deliberate), and each held breath counting down. Drawn by the frame loop,
  // so it keeps the orb's clock; going back is quick (200 ms)
  const ring = { from: 0, to: 0, t0: 0, dur: 0, shown: -1 };
  const ringNow = (t) => (ring.dur <= 0 ? ring.to : lerp(ring.from, ring.to, ring.to < ring.from ? 1 - (1 - clamp((t - ring.t0) / ring.dur)) ** 3 : clamp((t - ring.t0) / ring.dur)));
  function ringTo(sec, back = false) {
    const t = clock.now(); const cur = ringNow(t);
    if (sec <= 0) { Object.assign(ring, { from: cur, to: 0, t0: t, dur: back ? 200 : 0 }); el.classList.remove('lv-ringing'); }
    else { Object.assign(ring, { from: 0, to: 1, t0: t, dur: sec * 1000 }); el.classList.add('lv-ringing'); }
    kick();
  }
  let ringScale = -1;
  function paintRing(t, sc) {
    const p = ringNow(t); if (Math.abs(p - ring.shown) > 0.0005) { ring.shown = p; ringA.style.strokeDashoffset = String(1 - p); }
    // the ring's circle is 0.6956 of the orb's size across at scale 1: keep it ~5% outside her edge
    const rs = (0.5 * sc + 0.055) / 0.6956;
    if (Math.abs(rs - ringScale) > 0.002) { ringScale = rs; ringSvg.style.transform = `scale(${rs.toFixed(4)})`; }
    return p !== ring.to;
  }

  // ── breathing ──────────────────────────────────────────────────────────────────────────────────────────────────
  const LO = 1, HI = 1.3;
  // each new word rises in: played on the words themselves, so nothing has to re-measure the page
  function wordIn() {
    if (reduced()) { capW.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease' }); return; }
    const k = [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }];
    capW.animate(k, { duration: 420, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    capN.animate(k, { duration: 420, delay: 60, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'backwards' });
  }
  function breathScale(t) {
    if (!breath) return 1;
    const w = where(breath.P, (t - breath.t0) / 1000);
    if (!w) return LO;
    if (reduced()) return 1;
    const lift = breath.lead;   // the hold that started it ends condensed; the first breath swells from there
    if (w.kind === 'in') return lerp(w.cycle === 0 ? lift : LO, HI, sine(w.k));
    if (w.kind === 'hold') return HI;
    if (w.kind === 'out') return lerp(HI, LO, sine(w.k));
    return LO;
  }
  function tickBreath(t) {
    const b = breath; if (!b) return;
    const sec = (t - b.t0) / 1000;
    const w = where(b.P, sec);
    const k = 1 - Math.exp(-Math.max(0, (t - (b.lastT ?? t)) / 1000) * 1.5); b.lastT = t;
    breathK += ((b.ending ? 0 : 0.85) - breathK) * k;
    if (!w) { endBreath(true); return; }
    const key = `${w.cycle}:${w.i}`;
    if (key !== b.key) {
      b.key = key;
      if (!b.native && !b.quiet) haptic(BUZZ[w.kind]);
      b.quiet = false;
      capW.textContent = WORD[w.kind];
      el.dataset.breath = w.kind;
      if (w.kind === 'hold' || w.kind === 'rest') ringTo(w.left); else ringTo(0, true);
      wordIn();
      o.onBreathPhase?.({ kind: w.kind, word: WORD[w.kind], cycle: w.cycle, cycles: b.P.cycles, seconds: w.dur });
      if (reduced()) live.dim = w.kind === 'in' || w.kind === 'hold' ? 1.08 : 0.92;
    }
    const n = Math.ceil(w.left - 1e-6);
    if (n !== b.n) { b.n = n; capN.textContent = String(n); }   // the text changes once a second, not every frame
    b.rounds = w.cycle;
  }
  async function startBreathing({ pattern = o.pattern, cycles = o.cycles, fromHold = false, quietFirst = false, follow = false } = {}) {
    if (breath) return api;
    const small = o.overlay === true || (o.overlay === 'auto' && S < 120);
    if (small && !o._inOverlay) { hold.set(0, { spring: SPRINGS.snappy }); ringTo(0, true); press.set(0); haptic('breathe-in'); breathOverlay(api, { pattern, cycles, from: el, mood: me.local ? mood : null, onEnd: o.onBreathEnd, onPhase: o.onBreathPhase, root: o.overlayRoot }); return api; }
    const P = plan(pattern, cycles);
    const b = breath = { P, t0: clock.now(), key: '', rounds: 0, lead: fromHold ? 0.92 : LO, native: null, quiet: quietFirst };
    el.classList.add('lv-breathing');
    hold.jump(0); press.set(0, { spring: SPRINGS.gentle }); ringTo(0, true);
    o.onBreathStart?.(P);
    // each native phase pins the orb's timeline to the programme's clock: this phase ends at e.phaseEndsAt
    const onNative = (e) => {
      if (breath !== b) return;
      if (e.phase === 'done') { if (e.reason !== 'replaced') endBreath(e.reason === 'complete'); return; }
      const i = P.steps.findIndex(([k]) => k === e.phase); if (i < 0) return;
      const end = (Math.max(1, e.cycle) - 1) * P.len + P.steps.slice(0, i + 1).reduce((a, [, s]) => a + s, 0);
      const left = Math.max(0, ((e.phaseEndsAt ?? Date.now()) - Date.now()) / 1000);
      b.t0 = clock.now() - (end - left) * 1000;
    };
    nativeBreath(P, onNative, { follow }).then((n) => { if (breath === b && n) b.native = n; else n?.stop(); });
    kick();
    return api;
  }
  function endBreath(completed) {
    const b = breath; if (!b) return;
    const secs = Math.min(b.P.total, (clock.now() - b.t0) / 1000);
    const rounds = completed ? b.P.cycles : b.rounds;
    const was = breathScale(clock.now());
    breath = null;
    if (completed) b.native?.off(); else b.native?.stop();   // a programme that finished needs no stop
    el.classList.remove('lv-breathing'); delete el.dataset.breath; ringTo(0, true);
    scale.jump(was); scale.set(scaleTo() ?? 1, { spring: SPRINGS.gentle });
    live.dim = 1;
    if (!(completed && b.native)) haptic(completed ? 'success' : 'light');   // the native programme buzzes its own end
    const sum = { pattern: b.P.id, name: b.P.name, rounds, seconds: Math.round(secs), completed };
    capW.textContent = completed ? 'Done' : 'Stopped';
    capN.textContent = rounds ? `${rounds} ${rounds === 1 ? 'round' : 'rounds'} · ${mmss(secs)}` : `after ${Math.max(1, Math.round(secs))} s`;
    el.classList.add('lv-summary');
    wordIn();
    clearTimeout(el._lvSum); el._lvSum = setTimeout(() => { el.classList.remove('lv-summary'); capW.textContent = ''; capN.textContent = ''; }, 3600);
    // the colours drift back to his mood over a second or so
    const back = { t: clock.now() };
    const fade = (t) => { const k = clamp((t - back.t) / 1400); breathK = 0.85 * (1 - sine(k)); if (k >= 1) { breathK = 0; return false; } return true; };
    clock.add(fade);
    o.onBreathEnd?.(sum);
    kick();
  }
  function stopBreathing() { if (breath) endBreath(false); else el.classList.remove('lv-summary'); return api; }

  // ── life ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const offVis = onVisible(el, (v) => { visible = v; if (v) kick(); });
  const ro = typeof ResizeObserver !== 'undefined' && o.size == null ? new ResizeObserver(() => { const w = el.getBoundingClientRect().width; if (w && Math.abs(w - S) > 0.5) { S = w; el.style.setProperty('--lv-s', `${S}px`); el.classList.toggle('lv-small', S < 120); dpr = size(); kick(); } }) : null;
  ro?.observe(el);
  const offRm = onReduced(() => kick());
  const skinObs = new MutationObserver(() => kick());
  skinObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin', 'data-theme'] });
  if (R?.kind === 'webgl') {
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
    cv.addEventListener('webglcontextrestored', () => { R = glRenderer(cv) ?? ctxRenderer(cv); kick(); });
  }
  const api = {
    el,
    get renderer() { return R?.kind ?? 'css'; },
    get state() { return state; },
    get mood() { return { ...mood }; },
    get breathing() { return !!breath; },
    /** His mood (stress 0–1, energy 0–1, valence −1…1). Sets it app-wide unless this orb was mounted local. */
    setMood(m) { if (me.local) { mood = norm({ ...mood, ...m }); kick(); } else setMood(m); return api; },
    _mood(m) { mood = norm(m); kick(); },
    /** 'calm' | 'listening' | 'thinking' | 'speaking' */
    setState(s) { if (!['calm', 'listening', 'thinking', 'speaking'].includes(s)) return api; state = s; el.dataset.state = s; if (s !== 'speaking' && s !== 'listening') levelTo = 0; scale.set(scaleTo() ?? 1, { spring: SPRINGS.gentle }); kick(); return api; },
    /** Her voice (or his, while she listens): 0–1, as often as the audio meter gives it. */
    setLevel(v) { levelTo = clamp(+v || 0); kick(); return api; },
    startBreathing, stop: stopBreathing, stopBreathing,
    /** Draw one frame now (tests, and the frame-by-frame lab captures). */
    render() { draw(breath ? breathScale(clock.now()) : scale.value, pos.values); return api; },
    destroy() {
      alive = false; stopBreathing(); sub && clock.remove(sub); sub = null; offVis(); offRm(); ro?.disconnect(); skinObs.disconnect(); R?.dispose(); orbs.delete(me);
      el.classList.remove('lv', 'lv-css', 'lv-small', 'lv-breathing', 'lv-summary', 'lv-ringing'); el.querySelectorAll('.lv-cv, .lv-ring, .lv-cap').forEach((n) => n.remove());
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    },
  };
  me._mood = api._mood; orbs.add(me);
  el.dataset.state = state;
  if (!R) paintCss();
  kick();
  return api;
}

// ── a small orb breathes in a full-screen overlay: the orb flies out of where it sat, grows, guides you, flies back ──
function breathOverlay(src, { pattern, cycles, from, mood, onEnd, onPhase, root }) {
  const host = root ?? from.closest('.phone') ?? document.body;
  const ov = document.createElement('div');
  ov.className = 'lv-over stay-dark';
  ov.innerHTML = '<div class="lv-over-veil"></div><div class="lv-over-stage"><div class="lv-over-orb"></div></div><p class="lv-over-hint">Tap anywhere to stop</p>';
  host.append(ov);
  const stage = ov.querySelector('.lv-over-orb');
  const big = mountOrb(stage, { size: 220, interactive: 'press', hold: false, overlay: false, mood: mood ?? undefined, label: 'Breathing', onBreathPhase: onPhase, _inOverlay: true,
    onBreathEnd: (sum) => { onEnd?.(sum); setTimeout(close, 2400); } });
  // fly out of the small orb
  const a = from.getBoundingClientRect(), b = stage.getBoundingClientRect();
  const dx = a.left + a.width / 2 - (b.left + b.width / 2), dy = a.top + a.height / 2 - (b.top + b.height / 2), s0 = a.width / b.width;
  from.classList.add('lv-lent');
  const fly = (dir) => {
    if (reduced()) return stage.animate([{ opacity: dir ? 0 : 1 }, { opacity: dir ? 1 : 0 }], { duration: 200, fill: 'both' });
    const k = [{ transform: `translate(${dx}px, ${dy}px) scale(${s0})` }, { transform: 'none' }];
    const c = springCurve('page');
    return stage.animate(dir ? k : k.reverse(), { duration: dir ? c.duration : 520, easing: dir ? c.easing : 'cubic-bezier(.32, .72, 0, 1)', fill: 'both' });
  };
  fly(true);
  requestAnimationFrame(() => ov.classList.add('lv-over-in'));
  big.startBreathing({ pattern, cycles, fromHold: true, quietFirst: true });
  let closing = false;
  function close() {
    if (closing) return; closing = true;
    ov.classList.remove('lv-over-in');
    const f = fly(false);
    f.finished.then(() => { from.classList.remove('lv-lent'); big.destroy(); ov.remove(); }, () => { from.classList.remove('lv-lent'); ov.remove(); });
  }
  ov.addEventListener('click', () => { if (big.breathing) big.stop(); else close(); });
  ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') { big.stop(); close(); } });
  return { close };
}

writeRoot();
