// DC traffic camera map: legend/filters, main map with watched stretches, neighbourhood close-up, list
const DATA = /*__DATA__*/null;
const BASE = /*__BASEMAP__*/null;
const NS = 'http://www.w3.org/2000/svg';
const TYPES = {
  spd:{name:'Speed', desc:'Posted speed limit'},
  red:{name:'Red light', desc:'Entering on red'},
  stp:{name:'Stop sign', desc:'Rolling through a stop'}};
const STATS = {
  live:{name:'Fining', desc:'Tickets mailed to the owner'},
  warn:{name:'Warning period', desc:'New: warnings only, ~30 days'},
  soon:{name:'Not live yet', desc:'Being set up or tested'}};
const on = {spd:true, red:true, stp:true, live:true, warn:true, soon:true};
const cams = DATA.cams, meta = DATA.meta;
const maxN = Math.max(...cams.map(c => c.n || 0));
const rad = n => 0.646875 * (3 + 9 * Math.sqrt((n || 0) / maxN));   // big-map dot radius in px (0.5625 × 1.15)
const fmt = n => n == null ? '—' : n.toLocaleString('en-US');
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const vis = c => on[c.t] && on[c.s];
const poster = location.hash === '#poster', cardmode = location.hash === '#card';
if (poster) document.documentElement.classList.add('poster');
if (cardmode) document.documentElement.classList.add('cardmode');

function shape(t, r) {
  if (t === 'spd') return ['circle', {r}];
  if (t === 'red') { const a = r * 1.3; return ['path', {d:`M0 ${-a}L${a} 0L0 ${a}L${-a} 0Z`}]; }
  const a = r * 1.1, p = []; for (let i = 0; i < 8; i++) { const th = Math.PI / 8 + i * Math.PI / 4; p.push((a * Math.cos(th)).toFixed(2) + ' ' + (a * Math.sin(th)).toFixed(2)); }
  return ['path', {d:'M' + p.join('L') + 'Z'}];
}
function glyph(parent, t, s, r) {
  const [tag, at] = shape(t, r), g = el(tag, at, parent);
  g.setAttribute('class', 'm-' + s);
  if (s === 'live') g.setAttribute('fill', `var(--${t})`); else g.setAttribute('stroke', `var(--${t})`);
  return g;
}
function mini(t, s, r = 5.5) {
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '-9 -9 18 18'); svg.setAttribute('width', '1.3em'); svg.setAttribute('height', '1.3em'); svg.setAttribute('aria-hidden', 'true');
  glyph(svg, t, s, r); return svg;
}
// point and heading at a fraction of a polyline
function along(pts, f) {
  const seg = []; let L = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
  let t = f * L;
  for (let i = 1; i < pts.length; i++) {
    if (t <= seg[i - 1] || i === pts.length - 1) {
      const a = pts[i - 1], b = pts[i], u = seg[i - 1] ? Math.min(1, t / seg[i - 1]) : 0;
      return [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1]), Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI];
    }
    t -= seg[i - 1];
  }
}
const pathD = pts => 'M' + pts.map(p => p[0] + ' ' + p[1]).join('L');
// unit vector of travel at the camera (last leg of its watched stretch), in map units
function heading(c) {
  if (!c.st) return [0, 0];
  const a = c.st[Math.max(0, c.st.length - 2)], b = c.st[c.st.length - 1], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
}
// posted-limit badge, in screen-px units (parent is counter-scaled)
function badge(parent, c) {
  const live = c.s === 'live';
  el('rect', {x:-7, y:-5.25, width:14, height:10.5, rx:2, class:'bdg-r', fill:live ? 'var(--spd)' : 'var(--land)', stroke:live ? 'var(--land)' : 'var(--spd)', 'stroke-width':live ? .8 : 1.3, 'stroke-dasharray':c.s === 'soon' ? '2 1.4' : 'none'}, parent);
  el('text', {'text-anchor':'middle', y:2.7, 'font-size':7.5, 'font-weight':700, fill:live ? '#fff' : 'var(--spd)', 'font-family':'var(--f-mono)'}, parent).textContent = c.lim;
}
function streak(parent, c, width) {
  return el('path', {d:pathD(c.st), class:'streak', stroke:`var(--${c.t})`, 'stroke-width':width, 'vector-effect':'non-scaling-stroke'}, parent);
}
function chevron(parent, c) {
  const [x, y, a] = along(c.st, 0.38), g = el('g', {transform:`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a.toFixed(0)})`}, parent);
  el('path', {class:'cs chev', d:'M-2.4 -3.2L1.8 0L-2.4 3.2', stroke:`var(--${c.t})`}, g);
  return g;
}

/* ---------- header + legend ---------- */
document.getElementById('stamp').textContent = `DDOT data · updated ${meta.asof}`;

/* ---------- landing figures ---------- */
const S = meta.stats;
const big = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e8 ? 0 : 2) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));
const monthName = ym => new Date(ym + '-15').toLocaleDateString('en-US', {month:'short', year:'2-digit'});
const busiest = cams.reduce((a, b) => (b.n || 0) > (a.n || 0) ? b : a);
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches || poster || cardmode;
function countUp(node, to, f, ms = 1400) {   // final value is set first, so the page reads right even without animation
  node.textContent = f(to); if (calm) return;
  const t0 = performance.now(), step = t => { const p = Math.min(1, (t - t0) / ms); node.textContent = f(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
countUp(document.getElementById('hFines'), S.fines, big);
countUp(document.getElementById('hUsd'), S.usd, v => '$' + big(v) + '+');
countUp(document.getElementById('hTop'), busiest.n, v => Math.round(v).toLocaleString('en-US'));
document.getElementById('hTopL').textContent = `fines at one camera: ${busiest.loc.split(',')[0].replace(/\s+\d.*$/, '')}`;
document.getElementById('hSec').textContent = S.sec.toFixed(1);
document.getElementById('ring').style.setProperty('--T', S.sec + 's');
(function liveCount() {   // running total at the 12-month average rate, in step with the ring
  const t0 = performance.now(), out = document.getElementById('hLive');
  const tick = () => { out.textContent = Math.floor((performance.now() - t0) / 1000 / S.sec).toLocaleString('en-US'); };
  setInterval(tick, 250); tick();
})();
(function sparkline() {
  const svg = document.getElementById('sSpark'), m = S.monthly, W = 200, H = 44, pad = 3;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none');
  const mx = Math.max(...m.map(d => d[1])), x = i => pad + i * (W - 2 * pad) / (m.length - 1), y = v => H - 2 - (H - 8) * v / mx;
  const line = m.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[1]).toFixed(1)}`).join('');
  el('path', {d:line + `L${x(m.length - 1).toFixed(1)} ${H}L${x(0).toFixed(1)} ${H}Z`, fill:'currentColor', 'fill-opacity':.13}, svg);
  el('path', {d:line, fill:'none', stroke:'currentColor', 'stroke-opacity':.85, 'stroke-width':2, 'stroke-linejoin':'round', 'vector-effect':'non-scaling-stroke'}, svg);
  const last = m[m.length - 1]; el('circle', {cx:x(m.length - 1), cy:y(last[1]), r:3, fill:'var(--red)', 'vector-effect':'non-scaling-stroke'}, svg);
  m.forEach((d, i) => { const h = el('rect', {x:x(i) - (W / m.length) / 2, y:0, width:W / m.length, height:H, fill:'transparent'}, svg); el('title', {}, h).textContent = `${monthName(d[0])}: ${d[1].toLocaleString('en-US')} fines`; });
  document.getElementById('sSparkL').textContent = `fines per month, ${monthName(m[0][0])}–${monthName(last[0])}`;
})();
document.getElementById('share').onclick = async e => {
  const b = e.currentTarget, url = meta.site.site_url || location.href.split('#')[0];
  try { if (navigator.share) { await navigator.share({title:'DC Traffic Cameras', url}); return; } await navigator.clipboard.writeText(url); b.textContent = 'Link copied'; }
  catch (err) { b.textContent = url; }
  setTimeout(() => { b.textContent = 'Share'; }, 2500);
};
const count = f => cams.filter(f).length;
function keyRow(host, k, info, glyphEl, n) {
  const b = document.createElement('button'); b.className = 'key'; b.type = 'button'; b.setAttribute('aria-pressed', on[k]); b.id = 'key-' + k;
  const g = document.createElement('span'); g.appendChild(glyphEl);
  b.append(g); b.insertAdjacentHTML('beforeend', `<span class="kname">${info.name}<span class="kdesc">${info.desc}</span></span><span class="kn">${n}</span>`);
  b.onclick = () => { if (poster) return; on[k] = !on[k]; b.setAttribute('aria-pressed', on[k]); applyFilter(); };
  host.appendChild(b);
}
for (const t in TYPES) keyRow(document.getElementById('keysType'), t, TYPES[t], mini(t, 'live', 6), count(c => c.t === t));
for (const s in STATS) keyRow(document.getElementById('keysStat'), s, STATS[s], mini('spd', s, 6), count(c => c.s === s));
document.getElementById('sizes').innerHTML = [1000, 10000, 40000, 90000].map(v => {
  const r = rad(v) * 1.15; return `<figure><svg viewBox="${-r - 2} ${-r - 2} ${2 * r + 4} ${2 * r + 4}" width="${(2 * r + 4) / 15}rem" aria-hidden="true"><circle r="${r}" fill="var(--muted)"/></svg><span class="num">${v / 1000}k</span></figure>`;
}).join('');
const um = meta.unmapped;
document.getElementById('unmapped').innerHTML = `<p><strong>${(um['Clear Lane'] || 0) + (um['School Bus'] || 0)} cameras ride on buses</strong> (bus lanes, school-bus stop arms): no fixed spot to map. Truck-route cameras left out.</p>`;
function stats() {
  const v = cams.filter(vis);
  document.getElementById('tot').textContent = v.length;
  for (const t in TYPES) document.querySelector(`#key-${t} .kn`).textContent = count(c => c.t === t && on[c.s]);
  for (const k in STATS) document.querySelector(`#key-${k} .kn`).textContent = count(c => c.s === k && on[c.t]);
  document.getElementById('split').innerHTML = Object.keys(STATS).filter(s => on[s]).map(s => `<span><b class="num">${v.filter(c => c.s === s).length}</b> ${STATS[s].name.toLowerCase()}</span>`).join('');
}

const nb = Math.ceil(meta.maxd);

/* ---------- main map ---------- */
const map = document.getElementById('map');
const P0 = (() => { const xs = [], ys = []; BASE.boundary.replace(/(-?\d+) (-?\d+)/g, (_, a, b) => { xs.push(+a); ys.push(+b); }); return {x0:Math.min(...xs), x1:Math.max(...xs), y0:Math.min(...ys), y1:Math.max(...ys)}; })();
const PAD = 25, FULL = {x:P0.x0 - PAD, y:P0.y0 - PAD, w:P0.x1 - P0.x0 + 2 * PAD, h:P0.y1 - P0.y0 + 2 * PAD};
const defs = el('defs', {}, map);
el('path', {d:BASE.boundary}, el('clipPath', {id:'dc'}, defs));
const world = el('g', {}, map);
el('path', {d:BASE.boundary, fill:'var(--land)', stroke:'var(--edge)', 'stroke-width':1.2, 'vector-effect':'non-scaling-stroke'}, world);
const clipped = el('g', {'clip-path':'url(#dc)'}, world);
el('path', {d:BASE.parks, fill:'var(--park)'}, clipped);
el('path', {d:BASE.water, fill:'var(--water)'}, clipped);
el('path', {d:BASE.local, class:'loc', fill:'none', stroke:'var(--road-min)', 'stroke-width':.8, 'vector-effect':'non-scaling-stroke'}, clipped);
el('path', {d:BASE.min, class:'mn', fill:'none', stroke:'var(--road-min)', 'stroke-width':.7, 'vector-effect':'non-scaling-stroke'}, clipped);
el('path', {d:BASE.art, class:'ar', fill:'none', stroke:'var(--road)', 'stroke-width':1.1, 'vector-effect':'non-scaling-stroke'}, clipped);
el('path', {d:BASE.fwy, class:'fw', fill:'none', stroke:'var(--road-fwy)', 'stroke-width':1.8, 'stroke-linecap':'round', 'vector-effect':'non-scaling-stroke'}, clipped);
const rings = el('g', {}, world);
for (let k = 1; k <= nb; k++) el('circle', {r:k * 100, fill:'none', stroke:'var(--ring)', 'stroke-width':.8, 'stroke-dasharray':'1 4', 'stroke-linecap':'round', 'vector-effect':'non-scaling-stroke'}, rings);
const insetMark = el('circle', {r:120, fill:'none', stroke:'var(--ink-2)', 'stroke-width':.8, 'stroke-dasharray':'5 3', 'vector-effect':'non-scaling-stroke'}, rings);
const labels = el('g', {'pointer-events':'none'});
for (let k = 1; k <= nb; k++) {
  const g = el('g', {transform:`translate(${(-k * 100 * Math.SQRT1_2).toFixed(1)} ${(k * 100 * Math.SQRT1_2).toFixed(1)})`}, labels), t = el('text', {class:'cs lbl', 'text-anchor':'middle', y:3.5, 'font-size':10, 'font-weight':600, fill:'var(--ring)'}, g);
  t.textContent = k + ' mi';
}
for (const L of DATA.labels) {
  const g = el('g', {transform:`translate(${L.x} ${L.y})`}, labels);
  const st = {poi:{fs:9.5, fill:'var(--ink-2)', fw:600}, hood:{fs:9, fill:'var(--muted)', fw:600, up:1}, water:{fs:10, fill:'var(--water-ink)', fw:400, it:1}, park:{fs:9, fill:'var(--park-ink)', fw:600, up:1}}[L.k];
  const t = el('text', {class:'cs lbl', 'text-anchor':'middle', 'font-size':st.fs, 'font-weight':st.fw, fill:st.fill, 'letter-spacing':st.up ? .8 : 0, 'font-style':st.it ? 'italic' : 'normal'}, g);
  t.textContent = st.up ? L.t.toUpperCase() : L.t;
}
const capG = el('g', {}), capI = el('g', {class:'cs'}, capG);
el('circle', {r:7, fill:'none', stroke:'var(--ink)', 'stroke-width':1.3}, capI); el('circle', {r:2.4, fill:'var(--ink)'}, capI);
el('text', {class:'lblc', x:10, y:-8, 'font-size':10.5, 'font-weight':800, fill:'var(--ink)'}, capI).textContent = 'US Capitol';

const streaks = el('g', {class:'streaks'}, world), arrows = el('g', {class:'arrows'}, world), marks = el('g', {}, world), selRing = el('g', {class:'hide'});
el('circle', {class:'cs', r:12, fill:'none', stroke:'var(--sel)', 'stroke-width':2}, selRing);
const markEls = new Map(), streakEls = new Map();
for (const c of cams) if (c.st) streakEls.set(c.id, [streak(streaks, c, 4.5), chevron(arrows, c)]);
[...cams].sort((a, b) => rad(b.n) - rad(a.n)).forEach(c => {
  const g = el('g', {transform:`translate(${c.x} ${c.y})`}, marks), inner = el('g', {class:'cs'}, g);
  const r = rad(c.n); glyph(inner, c.t, c.s, r).classList.add('dot'); el('circle', {class:'hit', r:Math.max(r + 3, 8)}, inner);
  if (c.t === 'spd' && c.lim) { inner.classList.add('hasb'); const [ux, uy] = heading(c); badge(el('g', {class:'bdg', transform:`translate(${(ux * 8).toFixed(1)} ${(uy * 8).toFixed(1)})`}, inner), c); }
  g.dataset.id = c.id; markEls.set(c.id, g);
});
const snames = el('g', {class:'snames', 'pointer-events':'none'});
const ANCH = [...DATA.anchors].sort((a, b) => a[4] - b[4]);   // arterials first
let LBLPX = 8, MKPX = 1, dq = 0;
function declutter() {
  dq = 0; snames.innerHTML = '';
  if (!map.classList.contains('near')) return;
  const k = pxPerUnit(map, vb), nearer = map.classList.contains('nearer'), fs = LBLPX;
  const inView = (x, y, m) => x > vb.x - m && x < vb.x + vb.w + m && y > vb.y - m && y < vb.y + vb.h + m;
  const boxes = [];
  for (const c of cams) if (vis(c) && inView(c.x, c.y, 0)) { const r = (nearer && c.t === 'spd' && c.lim ? 9 : rad(c.n) + 2) * MKPX / k; boxes.push([c.x, c.y, r, r]); }
  const placed = [];
  for (const a of ANCH) {
    if (placed.length >= 60) break;
    if ((a[4] && !nearer) || !inView(a[0], a[1], -20 / k)) continue;
    if (placed.some(t => t[3] === a[3] && Math.hypot(t[0] - a[0], t[1] - a[1]) < 260 / k)) continue;
    const th = a[2] * Math.PI / 180, w0 = (a[3].length * fs * .27 + 3) / k, h0 = fs * .62 / k;
    const hw = Math.abs(Math.cos(th)) * w0 + Math.abs(Math.sin(th)) * h0, hh = Math.abs(Math.sin(th)) * w0 + Math.abs(Math.cos(th)) * h0;
    if (boxes.some(b => Math.abs(b[0] - a[0]) < b[2] + hw && Math.abs(b[1] - a[1]) < b[3] + hh)) continue;
    boxes.push([a[0], a[1], hw, hh]); placed.push(a);
    const g = el('g', {transform:`translate(${a[0]} ${a[1]}) rotate(${a[2]})`}, snames);
    el('text', {class:'cs lbl', 'text-anchor':'middle', y:-2.5, 'font-size':8, 'font-style':'italic', fill:'var(--ink-2)'}, g).textContent = a[3];
  }
}
world.insertBefore(snames, streaks);
world.append(labels, capG, selRing);

/* pan / zoom */
let vb = {...FULL};
const mk = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mk')) || 1;
function pxPerUnit(svg, box) { const r = svg.getBoundingClientRect(); return Math.min(r.width / box.w, r.height / box.h); }
function setVB() {
  map.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const k = pxPerUnit(map, vb), fit = Math.max(.5, Math.min(1, pxPerUnit(map, FULL) * FULL.h / 950)), z = Math.min(1.6 / fit, Math.pow(vb.w / FULL.w, -0.35));
  map.style.setProperty('--s', (mk() * fit * z / k).toFixed(4));
  map.style.setProperty('--sl', (mk() * Math.max(fit, .72) * Math.min(z, 1.3) / k).toFixed(4));
  map.classList.toggle('near', vb.w < FULL.w / 3.5); map.classList.toggle('nearer', vb.w < FULL.w / 10);
  MKPX = mk() * fit * z; LBLPX = 8 * mk() * Math.max(fit, .72) * Math.min(z, 1.3);
  if (!dq) dq = requestAnimationFrame(declutter);
  scaleBar(k);
}
// scale bar: 100 map units = 1 mile at the Capitol's latitude (east-west scale exact there, within 0.2% citywide)
function scaleBar(k) {
  const host = document.getElementById('scale'); if (!host) return;
  const pxMile = k * 100, maxPx = poster ? 230 : 96;
  const imp = [[50, 'ft'], [100, 'ft'], [200, 'ft'], [500, 'ft'], [1000, 'ft'], [2000, 'ft'], [.5, 'mi'], [1, 'mi'], [2, 'mi'], [5, 'mi']]
    .map(([v, u]) => [v, u, (u === 'ft' ? v / 5280 : v) * pxMile]).filter(x => x[2] <= maxPx).pop() || [50, 'ft', 50 / 5280 * pxMile];
  const met = [[20, 'm'], [50, 'm'], [100, 'm'], [200, 'm'], [500, 'm'], [1, 'km'], [2, 'km'], [5, 'km']]
    .map(([v, u]) => [v, u, (u === 'm' ? v : v * 1000) / 1609.344 * pxMile]).filter(x => x[2] <= maxPx).pop() || [20, 'm', 20 / 1609.344 * pxMile];
  host.innerHTML = `<div class="sb"><span>${imp[0].toLocaleString('en-US')} ${imp[1]}</span><i style="width:${imp[2].toFixed(1)}px"></i></div><div class="sb"><i style="width:${met[2].toFixed(1)}px"></i><span>${met[0].toLocaleString('en-US')} ${met[1]}</span></div>`;
}
function zoomAt(f, cx, cy) {
  const nw = Math.min(FULL.w * 1.1, Math.max(FULL.w / 24, vb.w * f)), s = nw / vb.w;
  vb = {x:cx - (cx - vb.x) * s, y:cy - (cy - vb.y) * s, w:vb.w * s, h:vb.h * s}; setVB();
}
function toUser(e) { const r = map.getBoundingClientRect(), k = pxPerUnit(map, vb), ox = (r.width - vb.w * k) / 2, oy = (r.height - vb.h * k) / 2; return [vb.x + (e.clientX - r.left - ox) / k, vb.y + (e.clientY - r.top - oy) / k]; }
const ptrs = new Map(); let moved = 0, pinch0 = null;
map.addEventListener('pointerdown', e => { map.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); } map.classList.add('drag'); });
map.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const prev = ptrs.get(e.pointerId), k = pxPerUnit(map, vb);
  if (ptrs.size === 1) { const dx = e.clientX - prev[0], dy = e.clientY - prev[1]; moved += Math.abs(dx) + Math.abs(dy); vb.x -= dx / k; vb.y -= dy / k; setVB(); }
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0) { const [ux, uy] = toUser({clientX:(a[0] + b[0]) / 2, clientY:(a[1] + b[1]) / 2}); zoomAt(pinch0 / d, ux, uy); } pinch0 = d; moved += 10; }
});
const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; if (!ptrs.size) map.classList.remove('drag'); };
map.addEventListener('pointerup', e => { if (moved < 6 && ptrs.size === 1) { const t = e.target.closest && e.target.closest('[data-id]'); if (t) select(t.dataset.id, false); } up(e); });
map.addEventListener('pointercancel', up);
map.addEventListener('wheel', e => { e.preventDefault(); const [ux, uy] = toUser(e); zoomAt(Math.exp(e.deltaY * 0.0022), ux, uy); }, {passive:false});
map.addEventListener('dblclick', e => { const [ux, uy] = toUser(e); zoomAt(0.5, ux, uy); });
document.getElementById('zin').onclick = () => zoomAt(0.6, vb.x + vb.w / 2, vb.y + vb.h / 2);
document.getElementById('zout').onclick = () => zoomAt(1 / 0.6, vb.x + vb.w / 2, vb.y + vb.h / 2);
document.getElementById('zfit').onclick = () => { vb = {...FULL}; setVB(); };

/* ---------- neighbourhood close-up ---------- */
const R = 120, HALF = 138;   // circle radius and half-view, map units (100 = 1 mile)
const CAPITOL = {n:'Capitol Hill (US Capitol)', x:0, y:0, capitol:true};
const POPULAR = ['Downtown', 'Penn Quarter', 'Dupont Circle', 'Logan Circle/Shaw', 'Cardozo/Shaw', 'Adams Morgan', 'Columbia Heights', 'Georgetown',
  'Foggy Bottom', 'Navy Yard', 'Southwest/Waterfront', 'Near Northeast', 'Brookland', 'Petworth', 'Tenleytown', 'Cleveland Park', 'Historic Anacostia', 'Congress Heights', 'Deanwood'];
const hoods = [CAPITOL, ...DATA.hoods];
const hoodSel = document.getElementById('hood');
hoodSel.innerHTML = `<option value="0">${CAPITOL.n}</option><optgroup label="Popular">${POPULAR.map(n => hoods.findIndex(h => h.n === n)).filter(i => i > 0).map(i => `<option value="${i}">${hoods[i].n}</option>`).join('')}</optgroup><optgroup label="All neighbourhoods, A–Z">${DATA.hoods.map((h, i) => `<option value="${i + 1}">${h.n}</option>`).join('')}</optgroup>`;
const inset = document.getElementById('inset');
const idefs = el('defs', {}, inset), iclip = el('circle', {r:R}, el('clipPath', {id:'ic'}, idefs));
el('path', {d:BASE.boundary}, el('clipPath', {id:'idc'}, idefs));
const iback = el('circle', {r:R, fill:'var(--bg)', stroke:'none'}, inset);
const ig = el('g', {'clip-path':'url(#ic)'}, inset);
el('path', {d:BASE.boundary, fill:'var(--land)'}, ig);
const igc = el('g', {'clip-path':'url(#idc)'}, ig);
el('path', {d:BASE.iparks, fill:'var(--park)'}, igc);
el('path', {d:BASE.iwater, fill:'var(--water)'}, igc);
el('path', {d:BASE.local, fill:'none', stroke:'var(--road-min)', 'stroke-width':1, 'vector-effect':'non-scaling-stroke'}, igc);
el('path', {d:BASE.min + BASE.art, fill:'none', stroke:'var(--road)', 'stroke-width':1.5, 'vector-effect':'non-scaling-stroke'}, igc);
el('path', {d:BASE.fwy, fill:'none', stroke:'var(--road-fwy)', 'stroke-width':2.4, 'vector-effect':'non-scaling-stroke'}, igc);
el('path', {d:BASE.boundary, fill:'none', stroke:'var(--edge)', 'stroke-width':1, 'vector-effect':'non-scaling-stroke'}, ig);
const idyn = el('g', {}, ig), istreak = el('g', {}, ig), iring = el('circle', {r:R, fill:'none', stroke:'var(--edge)', 'stroke-width':1, 'vector-effect':'non-scaling-stroke'}, inset);
const ilead = el('g', {}, inset), imarks = el('g', {}, inset);
let hood = CAPITOL, lastSc = 0;
const near = (o, r) => Math.hypot(o.x - hood.x, o.y - hood.y) <= r;
function drawInset() {
  if (!inset.getBoundingClientRect().width) return;   // hidden (share-card mode): nothing to lay out
  const sc = (poster ? 1.9 : 1) / pxPerUnit(inset, {w:2 * HALF, h:2 * HALF});
  lastSc = sc; inset.style.setProperty('--s', sc.toFixed(4));
  const {x:hx, y:hy} = hood;
  inset.setAttribute('viewBox', `${hx - HALF} ${hy - HALF} ${2 * HALF} ${2 * HALF}`);
  for (const c of [iclip, iback, iring]) { c.setAttribute('cx', hx); c.setAttribute('cy', hy); }
  insetMark.setAttribute('cx', hx); insetMark.setAttribute('cy', hy);
  idyn.innerHTML = ''; istreak.innerHTML = ''; ilead.innerHTML = ''; imarks.innerHTML = '';
  for (const r of [50, 100]) {
    el('circle', {cx:hx, cy:hy, r, fill:'none', stroke:'var(--ring)', 'stroke-width':.8, 'stroke-dasharray':'1 4', 'stroke-linecap':'round', 'vector-effect':'non-scaling-stroke'}, idyn);
    const g = el('g', {transform:`translate(${hx} ${hy - r})`}, idyn); el('text', {class:'cs lbl', 'text-anchor':'middle', y:3.5, 'font-size':9.5, 'font-weight':600, fill:'var(--ring)'}, g).textContent = r === 50 ? '½ mi' : '1 mi';
  }
  if (near({x:0, y:0}, R)) { const ic = el('g', {class:'cs'}, el('g', {}, idyn)); el('circle', {r:6, fill:'none', stroke:'var(--ink)', 'stroke-width':1.3}, ic); el('circle', {r:2.2, fill:'var(--ink)'}, ic); }
  else { const g = el('g', {transform:`translate(${hx} ${hy})`}, idyn); el('path', {class:'cs', d:'M-4 0H4M0 -4V4', stroke:'var(--ink-2)', 'stroke-width':1.2}, g); }
  // cameras: stretches + arrows, then badges pushed apart so none overlap
  const ic = cams.filter(c => near(c, R + 2) && vis(c));
  for (const c of ic) if (c.st) { streak(istreak, c, 5); chevron(istreak, c); }
  const W = 7.8 * sc, H = 6 * sc, pad = 1.5 * sc;
  const Pp = ic.map(c => { const [ux, uy] = c.t === 'spd' && c.lim ? heading(c) : [0, 0], hx0 = c.x + ux * 8 * sc, hy0 = c.y + uy * 8 * sc; return {c, x:hx0, y:hy0, hx0, hy0}; });
  for (let it = 0; it < 220; it++) {
    for (let i = 0; i < Pp.length; i++) for (let j = i + 1; j < Pp.length; j++) {
      const a = Pp[i], b = Pp[j], dx = b.x - a.x, dy = b.y - a.y, ox = 2 * W + pad - Math.abs(dx), oy = 2 * H + pad - Math.abs(dy);
      if (ox > 0 && oy > 0) {
        if (ox / W < oy / H) { const m = (ox / 2 + .01) * (dx < 0 ? -1 : 1); a.x -= m; b.x += m; }
        else { const m = (oy / 2 + .01) * (dy < 0 ? -1 : 1); a.y -= m; b.y += m; }
      }
    }
    for (const q of Pp) { q.x += (q.hx0 - q.x) * .04; q.y += (q.hy0 - q.y) * .04; }
  }
  // labels go where no badge or other label sits: neighbourhood names, landmarks, then street names
  const boxes = Pp.map(q => [q.x, q.y, W, H]);
  const free = (x, y, hw, hh) => Math.hypot(x - hx, y - hy) < R - 6 && !boxes.some(b => Math.abs(b[0] - x) < b[2] + hw && Math.abs(b[1] - y) < b[3] + hh);
  const hoodNames = new Set(DATA.hoods.map(h => h.n));
  const placesL = [...DATA.hoods.map(h => ({x:h.x, y:h.y, t:h.n, k:'hood'})), ...DATA.poi.filter(p => !hoodNames.has(p.t)).map(p => ({...p, k:'poi'}))]
    .filter(p => near(p, 110)).sort((a, b) => (b.t === hood.n) - (a.t === hood.n) || Math.hypot(a.x - hx, a.y - hy) - Math.hypot(b.x - hx, b.y - hy));
  let nP = 0;
  for (const L of placesL) {
    const fs = L.k === 'hood' ? 8.5 : 8, txt = L.k === 'hood' ? L.t.toUpperCase() : L.t, hw = txt.length * fs * (L.k === 'hood' ? .36 : .29) * sc + 2 * sc, hh = fs * .6 * sc;
    if (nP >= 9 || !free(L.x, L.y, hw, hh)) continue;
    boxes.push([L.x, L.y, hw, hh]); nP++;
    const g = el('g', {transform:`translate(${L.x} ${L.y})`}, idyn);
    el('text', {class:'cs lbl', 'text-anchor':'middle', y:3, 'font-size':fs, 'font-weight':600, fill:L.k === 'hood' ? 'var(--muted)' : 'var(--ink-2)', 'letter-spacing':L.k === 'hood' ? .6 : 0}, g).textContent = txt;
  }
  const seen = [];
  const anchors = DATA.anchors.filter(a => !a[4] && Math.hypot(a[0] - hx, a[1] - hy) < 104).sort((a, b) => Math.hypot(a[0] - hx, a[1] - hy) - Math.hypot(b[0] - hx, b[1] - hy));
  for (const a of anchors) {
    if (seen.length >= 12) break;
    if (seen.some(t => t[3] === a[3] && Math.hypot(t[0] - a[0], t[1] - a[1]) < 75)) continue;
    const th = a[2] * Math.PI / 180, w0 = a[3].length * 8 * .27 * sc + 2 * sc, h0 = 5 * sc;
    const hw = Math.abs(Math.cos(th)) * w0 + Math.abs(Math.sin(th)) * h0, hh = Math.abs(Math.sin(th)) * w0 + Math.abs(Math.cos(th)) * h0;
    if (!free(a[0], a[1], hw, hh)) continue;
    boxes.push([a[0], a[1], hw, hh]); seen.push(a);
    const g = el('g', {transform:`translate(${a[0]} ${a[1]}) rotate(${a[2]})`}, idyn);
    el('text', {class:'cs lbl', 'text-anchor':'middle', y:2.8, 'font-size':8, 'font-style':'italic', fill:'var(--ink-2)'}, g).textContent = a[3];
  }
  for (const q of Pp) {
    const c = q.c;
    if (Math.hypot(q.x - q.hx0, q.y - q.hy0) > 2 * sc) {
      el('line', {x1:c.x, y1:c.y, x2:q.x, y2:q.y, stroke:'var(--ink-2)', 'stroke-width':.8, 'vector-effect':'non-scaling-stroke'}, ilead);
      el('circle', {cx:c.x, cy:c.y, r:1.8 * sc, fill:'var(--ink-2)'}, ilead);
    }
    const g = el('g', {transform:`translate(${q.x.toFixed(2)} ${q.y.toFixed(2)})`, 'data-id':c.id, style:'cursor:pointer'}, imarks), inner = el('g', {class:'cs'}, g);
    if (c.t === 'spd' && c.lim) badge(inner, c); else glyph(inner, c.t, c.s, 4);
  }
  const name = hood.capitol ? 'Capitol Hill' : hood.n;
  document.getElementById('insetTitle').textContent = name;
  const nSpd = ic.filter(c => c.t === 'spd').length;
  document.getElementById('insetCap').textContent = `${ic.length} camera${ic.length === 1 ? '' : 's'} within 1.2 mi${nSpd ? `; badges show the speed limit` : ''}`;
}
hoodSel.onchange = () => { hood = hoods[+hoodSel.value]; try { localStorage.setItem('dcc-hood', hood.n); } catch (e) {} drawInset(); };
try { const saved = localStorage.getItem('dcc-hood'), i = hoods.findIndex(h => h.n === saved); if (i > 0 && !poster) { hood = hoods[i]; hoodSel.value = i; } } catch (e) {}
inset.addEventListener('click', e => { const t = e.target.closest('[data-id]'); if (t) select(t.dataset.id, false); });
function setInsetScale() { const sc = (poster ? 1.9 : 1) / pxPerUnit(inset, {w:2 * HALF, h:2 * HALF}); if (Math.abs(sc - lastSc) > 1e-3) drawInset(); }

/* ---------- by ward: top 5 per ward, expandable ---------- */
const WARDS = [...new Set(cams.map(c => c.ward))].filter(Boolean).sort();
const wardHost = document.getElementById('wards'), rowEls = new Map(), wardEls = [];
const recent = d => d && (new Date(meta.asof_iso) - new Date(d)) / 864e5 <= 92;
for (const w of WARDS) {
  const band = cams.filter(c => c.ward === w).sort((a, b) => (b.n || 0) - (a.n || 0));
  const box = document.createElement('div'); box.className = 'ward';
  box.innerHTML = `<div class="ward-h"><b>Ward ${w}</b><svg preserveAspectRatio="none" aria-hidden="true"></svg><span class="wn"></span></div>`;
  for (const c of band) {
    const r = document.createElement('div'); r.className = 'row'; r.tabIndex = 0; r.dataset.id = c.id;
    const g = document.createElement('span'); g.appendChild(mini(c.t, c.s));
    const what = c.t === 'spd' && c.lim ? `<span class="limit">${c.lim}</span>` : `<span class="ttype">${TYPES[c.t].name}</span>`;
    const tags = (c.s !== 'live' ? `<span class="tag">${c.s === 'warn' ? 'warning' : 'not live'}</span>` : '') + (recent(c.since) ? '<span class="tag">new</span>' : '') + (c.port ? '<span class="tag">portable</span>' : '') + (c.off ? '<span class="tag">position approx.</span>' : '');
    r.appendChild(g);
    r.insertAdjacentHTML('beforeend', `<span class="l">${c.loc}${tags}<small class="nb">near ${c.hood}</small></span><span class="t">${what}</span><span class="n">${fmt(c.n)}</span>`);
    r.onclick = () => select(c.id, true); r.onkeydown = e => { if (e.key === 'Enter') select(c.id, true); };
    box.appendChild(r); rowEls.set(c.id, r);
  }
  const more = document.createElement('button'); more.className = 'more'; more.type = 'button';
  more.onclick = () => { box.classList.toggle('open'); wardRefresh(); };
  box.appendChild(more); wardHost.appendChild(box);
  wardEls.push({box, band, more, svg:box.querySelector('svg'), wn:box.querySelector('.wn')});
}
function wardRefresh() {
  const mx = Math.max(1, ...wardEls.map(W => W.band.filter(vis).length));
  for (const W of wardEls) {
    const v = W.band.filter(vis), open = W.box.classList.contains('open');
    W.box.classList.toggle('hide', !v.length);
    v.forEach((c, i) => rowEls.get(c.id).classList.toggle('extra', i >= 5));
    W.svg.innerHTML = ''; W.svg.setAttribute('viewBox', `0 0 ${mx} 10`);
    let x = 0;
    for (const t in TYPES) { const n = v.filter(c => c.t === t).length; if (!n) continue; el('rect', {x, y:0, width:Math.max(n - .35, .3), height:10, fill:`var(--${t})`}, W.svg); x += n; }
    W.wn.textContent = `${v.length} cameras · ${big(v.reduce((a, c) => a + (c.n || 0), 0))} fines`;
    W.more.hidden = v.length <= 5;
    W.more.textContent = open ? 'Show top 5' : `Show all ${v.length}`;
  }
}

/* ---------- selection + filters ---------- */
const byId = new Map(cams.map(c => [c.id, c]));
function select(id, fly) {
  const c = byId.get(id); if (!c) return;
  selRing.setAttribute('transform', `translate(${c.x} ${c.y})`); selRing.classList.remove('hide');
  const lim = c.t === 'spd' && c.lim ? `${c.lim} mph limit, ` : '';
  const since = c.since ? new Date(c.since + 'T12:00').toLocaleDateString('en-US', {month:'short', year:'numeric'}) : '—';
  const card = document.getElementById('card'); card.innerHTML = '';
  const g = document.createElement('span'); g.appendChild(mini(c.t, c.s, 7)); g.firstChild.setAttribute('width', '2rem'); g.firstChild.setAttribute('height', '2rem');
  card.appendChild(g);
  const bits = [TYPES[c.t].name, lim + STATS[c.s].name.toLowerCase() + (c.raw === 'Test' ? ' (testing)' : ''), 'near ' + c.hood + ', Ward ' + c.ward, 'since ' + since];
  if (c.port) bits.push('portable unit');
  if (c.off) bits.push("DDOT's map position doesn't match the street it names");
  card.insertAdjacentHTML('beforeend', `<div><div class="loc">${c.loc}</div><div class="sub">${bits.join('<i class="dot"></i>')}</div></div><div class="big"><b>${fmt(c.n)}</b><span>fines, last 12 months</span></div>`);
  if (fly) {
    const w = FULL.w / 12; vb = {x:c.x - w / 2, y:c.y - (w * FULL.h / FULL.w) / 2, w, h:w * FULL.h / FULL.w}; setVB();
    map.closest('.mapwrap').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'start'});
  }
}
function applyFilter() {
  for (const c of cams) {
    const v = vis(c); markEls.get(c.id).classList.toggle('hide', !v); rowEls.get(c.id).classList.toggle('hide', !v);
    const s = streakEls.get(c.id); if (s) s.forEach(e => e.classList.toggle('hide', !v));
  }
  stats(); wardRefresh();
  if (lastSc) drawInset();
}

/* ---------- small print ---------- */
const A = (href, t) => `<a href="${href}" target="_blank" rel="noopener">${t}</a>`;
const src = `Data: DDOT Automated Safety Cameras and DC GIS, via ${A('https://opendata.dc.gov/datasets/automated-safety-cameras', 'Open Data DC')}, licensed ${A('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')}; adapted for this map. Cameras as of ${meta.asof}; fines through ${meta.last_record}. Fine amounts: ${A('https://ddot.dc.gov/page/dc-streetsafe-faqs', 'DDOT')}. * Fines DDOT logged in months a camera was live, ${meta.window}; dollars count each fine at its lowest amount ($100 speed or stop sign, $150 red light), a floor on fines issued, not money collected. Typeface: Overpass, SIL Open Font License.`;
document.getElementById('sources').innerHTML = `<p>${src}</p>`;
document.getElementById('posterfoot').innerHTML = src;
if (meta.site.tip_url) { const tb = document.getElementById('tipBtn'); tb.href = meta.site.tip_url; tb.textContent = meta.site.tip_label; tb.hidden = false; }
if (meta.site.tip_url) { const t = document.getElementById('tip'); t.innerHTML = `Free, no ads, no tracking. If it saved you a fine, ${A(meta.site.tip_url, meta.site.tip_label.toLowerCase())}.`; t.hidden = false; }
if (meta.site.repo_url) document.getElementById('links').innerHTML = A(meta.site.repo_url, 'Code, data and method');

function layout() { if (poster) document.documentElement.style.setProperty('--mk', 2.2); if (cardmode) document.documentElement.style.setProperty('--mk', 1.5); setVB(); setInsetScale(); }
new ResizeObserver(layout).observe(map); new ResizeObserver(setInsetScale).observe(inset);
applyFilter(); layout();
if (!poster && !cardmode) select(busiest.id, false);
