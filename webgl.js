/* ============================================================
   VERCELIX — WebGL hero
   Patterns from iart-ai/webgl-animation-skills:
   • shader-glsl        → domain-warped fbm aurora on a clip-space quad
   • particle-system    → seeded constellation (spatial grid + GPU Points)
   • threejs-animation  → setAnimationLoop, dt-based motion, damped
                          camera, scroll-linked uniforms, clean disposal
   ============================================================ */
import * as THREE from 'three';

const canvas = document.getElementById('webgl-hero');
const hero = canvas ? canvas.closest('.hero') : null;

/* seeded RNG — reproducible frames for the ?t=N harness */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260914);

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* tiny deterministic value-noise for the particle flow field */
function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash2(ix, iy), hash2(ix + 1, iy), ux),
              lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), ux), uy) * 2 - 1;
}

/* ---------- config ---------- */
const N = 140;                 // constellation nodes
const LINK = 1.7;              // connection radius
const MAX_SEG = 700;           // segment cap (bounds fill cost)
const FOV = 55, CAM_Z = 9;
const LIME = [0.784, 0.945, 0.208];

let renderer, bgScene, bgCam, bgMat, scene, camera;
let points, pointsMat, lines, linesMat, linePos, lineCol;
let posAttr, colAttr;
let nodes = [], vel = [], frac = [], seeds = [];
let halfW = 8, halfH = 4.5;
let running = false, inView = true;
let elapsed = 0;
const clock = new THREE.Clock();
const mouse = new THREE.Vector2(0, 0);            // NDC -1..1
const mouseWorld = new THREE.Vector2(9999, 9999);
const camPos = new THREE.Vector2(0, 0);
let scrollV = 0;

/* ---------- shaders ---------- */
const BG_VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`;

const BG_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float u_time;
uniform vec2  u_res;
uniform vec2  u_mouse;
uniform float u_scroll;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for(int i = 0; i < 5; i++){ v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

void main(){
  vec2 p = vUv - 0.5;
  p.x *= u_res.x / u_res.y;
  p += u_mouse * 0.06;                 // parallax drift
  p *= 1.0 + u_scroll * 0.35;          // scroll-linked zoom
  float t = u_time * 0.05;

  vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 + vec2(5.2, 1.3) - t * 0.6));
  vec2 r = vec2(fbm(p * 1.4 + 2.4 * q + vec2(1.7, 9.2) + t * 0.3),
                fbm(p * 1.4 + 2.4 * q + vec2(8.3, 2.8) - t * 0.25));
  float f = fbm(p * 1.4 + 2.8 * r);

  vec3 base   = vec3(0.032, 0.036, 0.050);
  vec3 violet = vec3(0.320, 0.270, 0.780);
  vec3 lime   = vec3(0.550, 0.780, 0.160);

  vec3 col = base;
  col = mix(col, violet * 0.6, smoothstep(0.15, 0.9, f));
  col += lime * pow(smoothstep(0.55, 0.95, f * r.x), 3.0) * 0.5;
  col += violet * q.y * 0.10;
  col += lime * 0.08 * smoothstep(0.9, 0.0, length(p - vec2(-0.55, 0.35)));

  float vig = smoothstep(1.05, 0.25, length((vUv - 0.5) * vec2(u_res.x / u_res.y, 1.0) * 1.1));
  col *= mix(0.55, 1.0, vig);
  col = mix(col, base, u_scroll * 0.85);   // dissolve to base as hero scrolls away

  gl_FragColor = vec4(col, 1.0);
}`;

const PT_VERT = `
attribute float aSeed;
uniform float u_time, u_fade, u_pixelRatio;
varying float vSeed;
void main(){
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.65 + 0.35 * sin(u_time * (0.5 + aSeed * 1.5) + aSeed * 6.2831);
  gl_PointSize = (2.0 + aSeed * 2.6) * u_pixelRatio * (9.0 / -mv.z) * tw;
  gl_Position = projectionMatrix * mv;
}`;

const PT_FRAG = `
precision mediump float;
uniform float u_fade;
varying float vSeed;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d);
  vec3 col = mix(vec3(0.784, 0.945, 0.208), vec3(0.88, 0.92, 1.0), step(0.82, vSeed));
  gl_FragColor = vec4(col, a * u_fade * 0.85);
}`;

/* ---------- init ---------- */
function computeBounds() {
  halfH = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAM_Z;
  halfW = halfH * (hero.clientWidth / Math.max(1, hero.clientHeight));
}

function layoutHomes() {
  for (let i = 0; i < N; i++) {
    const hx = frac[i][0] * halfW * 0.92;
    const hy = frac[i][1] * halfH * 0.92;
    nodes[i].set(hx, hy);
    vel[i].set(0, 0);
  }
}

function init() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));   // cap DPR — retina perf
  computeBounds();

  /* background: clip-space quad + ShaderMaterial */
  bgScene = new THREE.Scene();
  bgCam = new THREE.Camera();
  bgMat = new THREE.ShaderMaterial({
    uniforms: {
      u_time: { value: 0 }, u_res: { value: new THREE.Vector2(1, 1) },
      u_mouse: { value: new THREE.Vector2(0, 0) }, u_scroll: { value: 0 }
    },
    vertexShader: BG_VERT, fragmentShader: BG_FRAG, depthWrite: false
  });
  bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat));

  /* main scene: perspective camera + constellation */
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  camera.position.set(0, 0, CAM_Z);

  for (let i = 0; i < N; i++) {
    frac.push([(rng() * 2 - 1), (rng() * 2 - 1)]);
    seeds.push(rng());
    nodes.push(new THREE.Vector2());
    vel.push(new THREE.Vector2());
  }
  layoutHomes();

  const pGeo = new THREE.BufferGeometry();
  posAttr = new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const seedAttr = new THREE.BufferAttribute(new Float32Array(seeds), 1);
  pGeo.setAttribute('position', posAttr);
  pGeo.setAttribute('aSeed', seedAttr);
  pointsMat = new THREE.ShaderMaterial({
    uniforms: { u_time: { value: 0 }, u_fade: { value: 1 }, u_pixelRatio: { value: renderer.getPixelRatio() } },
    vertexShader: PT_VERT, fragmentShader: PT_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  points = new THREE.Points(pGeo, pointsMat);
  points.position.z = 1.5;
  scene.add(points);

  linePos = new THREE.BufferAttribute(new Float32Array(MAX_SEG * 6), 3).setUsage(THREE.DynamicDrawUsage);
  lineCol = new THREE.BufferAttribute(new Float32Array(MAX_SEG * 6), 3).setUsage(THREE.DynamicDrawUsage);
  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute('position', linePos);
  lGeo.setAttribute('color', lineCol);
  lGeo.setDrawRange(0, 0);
  linesMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  lines = new THREE.LineSegments(lGeo, linesMat);
  lines.position.z = 1.5;
  scene.add(lines);

  resize();
}

/* ---------- simulation step (deterministic: seeded + fixed dt) ---------- */
function step(dt) {
  elapsed += dt;
  const t = elapsed;
  for (let i = 0; i < N; i++) {
    const p = nodes[i], v = vel[i], h = frac[i];
    const hx = h[0] * halfW * 0.92, hy = h[1] * halfH * 0.92;

    const a = vnoise(p.x * 0.35 + t * 0.15, p.y * 0.35 - t * 0.10) * Math.PI * 2;
    let fx = Math.cos(a) * 0.35, fy = Math.sin(a) * 0.35;
    fx += (hx - p.x) * 0.22; fy += (hy - p.y) * 0.22;      // spring home

    const dx = p.x - mouseWorld.x, dy = p.y - mouseWorld.y; // mouse repel
    const d2 = dx * dx + dy * dy;
    if (d2 < 9) { const f = 6 / (d2 + 0.4); fx += dx * f; fy += dy * f; }

    v.x = (v.x + fx * dt) * 0.96; v.y = (v.y + fy * dt) * 0.96;
    p.x += v.x * dt; p.y += v.y * dt;

    const bx = halfW * 1.05, by = halfH * 1.05;            // soft bounds
    if (p.x > bx) v.x -= (p.x - bx) * 2 * dt * 60 * 0.02;  // gentle nudge back
    if (p.x < -bx) v.x -= (p.x + bx) * 2 * dt * 60 * 0.02;
    if (p.y > by) v.y -= (p.y - by) * 2 * dt * 60 * 0.02;
    if (p.y < -by) v.y -= (p.y + by) * 2 * dt * 60 * 0.02;
  }
}

/* spatial-grid constellation links (O(n) per the particle-system skill) */
function link() {
  const cell = LINK, cols = Math.ceil((halfW * 2.2) / cell);
  const grid = new Map();
  const key = (cx, cy) => cx + cy * cols;
  for (let i = 0; i < N; i++) {
    const cx = Math.floor((nodes[i].x + halfW * 1.1) / cell);
    const cy = Math.floor((nodes[i].y + halfH * 1.1) / cell);
    const k = key(cx, cy);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  let seg = 0;
  const P = linePos.array, C = lineCol.array;
  const fwd = [[1, 0], [0, 1], [1, 1], [1, -1]];             // forward neighbors only
  outer:
  for (let i = 0; i < N; i++) {
    const p = nodes[i];
    const cx = Math.floor((p.x + halfW * 1.1) / cell);
    const cy = Math.floor((p.y + halfH * 1.1) / cell);
    for (const [ox, oy] of fwd) {
      const bucket = grid.get(key(cx + ox, cy + oy));
      if (!bucket) continue;
      for (const j of bucket) {
        const q = nodes[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < LINK) {
          const s = 1 - d / LINK;
          const o = seg * 6;
          P[o] = p.x; P[o + 1] = p.y; P[o + 2] = 1.5;
          P[o + 3] = q.x; P[o + 4] = q.y; P[o + 5] = 1.5;
          C[o] = LIME[0] * s; C[o + 1] = LIME[1] * s; C[o + 2] = LIME[2] * s;
          C[o + 3] = LIME[0] * s; C[o + 4] = LIME[1] * s; C[o + 5] = LIME[2] * s;
          seg++;
          if (seg >= MAX_SEG) break outer;
        }
      }
    }
  }
  linePos.needsUpdate = true; lineCol.needsUpdate = true;
  lines.geometry.setDrawRange(0, seg * 2);
}

/* ---------- render ---------- */
function render() {
  const fade = clamp(1 - scrollV * 1.25, 0, 1);

  for (let i = 0; i < N; i++) {
    posAttr.array[i * 3] = nodes[i].x;
    posAttr.array[i * 3 + 1] = nodes[i].y;
    posAttr.array[i * 3 + 2] = 0;
  }
  posAttr.needsUpdate = true;
  link();

  camera.position.set(camPos.x, camPos.y, CAM_Z);
  camera.lookAt(0, 0, 0);

  bgMat.uniforms.u_time.value = elapsed;
  bgMat.uniforms.u_scroll.value = scrollV;
  bgMat.uniforms.u_mouse.value.set(camPos.x * 0.5, camPos.y * 0.5);
  pointsMat.uniforms.u_time.value = elapsed;
  pointsMat.uniforms.u_fade.value = fade;
  linesMat.opacity = 0.45 * fade;

  renderer.render(bgScene, bgCam);
  renderer.autoClear = false;
  renderer.render(scene, camera);
  renderer.autoClear = true;
}

function loop() {
  const dt = Math.min(clock.getDelta(), 1 / 30);            // clamp — stalled tabs don't explode
  const k = 1 - Math.exp(-4 * dt);                          // damped camera follow
  camPos.x += (mouse.x * 0.45 - camPos.x) * k;
  camPos.y += (mouse.y * 0.3 - camPos.y) * k;
  mouseWorld.set(camPos.x * halfW * 0.55, camPos.y * halfH * 0.55);
  step(dt);
  render();
}

/* ---------- lifecycle ---------- */
function start() {
  if (running || !inView || document.hidden) return;
  running = true; clock.getDelta();
  renderer.setAnimationLoop(loop);
}
function stop() { running = false; renderer.setAnimationLoop(null); }

let resizeTimer;
function resize() {
  const w = hero.clientWidth, h = hero.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  computeBounds();
  bgMat.uniforms.u_res.value.set(w, h);
  pointsMat.uniforms.u_pixelRatio.value = renderer.getPixelRatio();
}
function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 150); }

function onScroll() { scrollV = clamp(window.scrollY / Math.max(1, hero.offsetHeight), 0, 1); }

function dispose() {
  stop();
  [points, lines].forEach(o => { if (!o) return; o.geometry.dispose(); o.material.dispose(); });
  bgScene.children[0].geometry.dispose(); bgMat.dispose();
  renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss();
}

/* ---------- boot ---------- */
if (canvas && hero) {
  try {
    init();
    onScroll();
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', e => {
      mouse.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
    }, { passive: true });
    new IntersectionObserver(([e]) => { inView = e.isIntersecting; inView ? start() : stop(); }, { threshold: 0.02 }).observe(hero);
    document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
    window.addEventListener('pagehide', dispose);

    /* seek/freeze harness — ?t=N renders one deterministic frame */
    const tParam = new URLSearchParams(location.search).get('t');
    if (REDUCED || tParam !== null) {
      const end = tParam !== null ? parseFloat(tParam) : 6;
      for (let s = 0; s < end; s += 1 / 60) step(1 / 60);
      render();
      window.__ready = true;
    } else {
      start();
    }
  } catch (err) {
    hero.classList.add('no-webgl');               // CSS gradient fallback
  }
}
