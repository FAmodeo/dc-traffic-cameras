// DC traffic camera map: legend/filters, main map with watched stretches, neighbourhood close-up, list
const DATA = /*__DATA__*/null;
const BASE = /*__BASEMAP__*/null;
const NS = 'http://www.w3.org/2000/svg';
const TYPES = {
  spd:{name:'Speed', desc:'Posted speed limit'},
  red:{name:'Red light', desc:'Entering on red'},
  stp:{name:'Stop sign', desc:'Rolling through a stop'},
  trk:{name:'Truck restriction', desc:'Trucks on a no-truck street'}};   // only cameras listed in data/corrections.csv
const KEYTYPES = ['spd', 'red', 'stp'];   // legend rows; the rare truck camera has none
const STATS = {
  live:{name:'Fining', desc:'Tickets mailed to the owner'},
  warn:{name:'Warning period', desc:'New: warnings only, ~30 days'},
  soon:{name:'Not live yet', desc:'Being set up or tested'},
  unv:{name:'Under verification', desc:'Reported by visitors; not in DDOT data yet'}};
const KEYSTATS = ['live', 'warn', 'soon'];   // legend rows; reported-only cameras have none
const on = {spd:true, red:true, stp:true, trk:true, live:true, warn:true, soon:true, unv:true};
const cams = DATA.cams, meta = DATA.meta;
const NLISTED = cams.filter(c => c.s !== 'unv').length;   // cameras in DDOT's data (reported-only ones excluded)
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
  if (t === 'trk') { const a = r * .95; return ['rect', {x:-a, y:-a, width:2 * a, height:2 * a, rx:a * .2}]; }
  const a = r * 1.1, p = []; for (let i = 0; i < 8; i++) { const th = Math.PI / 8 + i * Math.PI / 4; p.push((a * Math.cos(th)).toFixed(2) + ' ' + (a * Math.sin(th)).toFixed(2)); }
  return ['path', {d:'M' + p.join('L') + 'Z'}];
}
function glyph(parent, t, s, r) {
  const [tag, at] = shape(t, r), g = el(tag, at, parent);
  g.setAttribute('class', 'm-' + s);
  if (s === 'live') g.setAttribute('fill', `var(--${t})`); else g.setAttribute('stroke', s === 'unv' ? 'var(--unv)' : `var(--${t})`);
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
countUp(document.getElementById('hUsd'), S.usd, v => '$' + big(v) + '+');
countUp(document.getElementById('hTop'), busiest.n, v => Math.round(v).toLocaleString('en-US'));
document.getElementById('hTopL').textContent = `fines at one camera: ${busiest.loc.split(',')[0].replace(/\s+\d.*$/, '')}`;
document.getElementById('hSec').textContent = S.sec.toFixed(1);
document.getElementById('ring').style.setProperty('--T', S.sec + 's');
const AVG = S.usd / S.fines;   // average fine at the lowest amount per type (~$106)
(function liveCount() {   // fines and dollars since arrival at the 12-month average pace; both tick when the ring completes
  const ring = document.getElementById('ring'), outN = document.getElementById('hLive'), outD = document.getElementById('hCash');
  if (poster || cardmode) { outD.textContent = big(S.fines); document.getElementById('hCashL').textContent = 'fines a year'; return; }
  ring.style.animation = 'none'; void ring.getBoundingClientRect(); ring.style.animation = '';   // restart the ring at t0
  const t0 = performance.now(); let last = -1;
  const tick = () => {
    const k = Math.floor((performance.now() - t0) / 1000 / S.sec);
    if (k === last) return; last = k;
    outN.textContent = k.toLocaleString('en-US');
    outD.textContent = '$' + Math.round(k * AVG).toLocaleString('en-US');
    if (k > 0 && !calm) { outD.classList.remove('bump'); void outD.offsetWidth; outD.classList.add('bump'); }
  };
  setInterval(tick, 200); tick();
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
// sharing: the phone's own share sheet where there is one; elsewhere a small menu (copy link + five services)
const ranked0 = cams.reduce((a, c) => (c.n || 0) > (a.n || 0) ? c : a, cams[0]);
const SITE_URL = meta.site.site_url || location.href.split('#')[0];
const slugOf = id => id.replace(/\s+/g, '').toLowerCase();
let shareBox = null;
function closeShare() { shareBox?.remove(); shareBox = null; }
async function share(anchor, d) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share(d); } catch (err) {} return; }
  if (shareBox) { const same = shareBox.anchor === anchor; closeShare(); if (same) return; }
  const u = encodeURIComponent(d.url), t = encodeURIComponent(d.text), both = encodeURIComponent(d.text + ' ' + d.url);
  const box = shareBox = document.createElement('div'); box.className = 'sharebox'; box.anchor = anchor; box.setAttribute('role', 'menu');
  box.innerHTML = `<button type="button" class="sb-copy">Copy link</button>
    <a href="https://wa.me/?text=${both}">WhatsApp</a><a href="https://x.com/intent/tweet?text=${t}&url=${u}">X</a>
    <a href="https://www.reddit.com/submit?url=${u}&title=${encodeURIComponent(d.title)}">Reddit</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=${u}">Facebook</a>
    <a href="mailto:?subject=${encodeURIComponent(d.title)}&body=${encodeURIComponent(d.text + '\n\n' + d.url)}">Email</a>`;
  box.querySelectorAll('a').forEach(a => { if (!a.href.startsWith('mailto')) { a.target = '_blank'; a.rel = 'noopener'; } a.onclick = () => setTimeout(closeShare, 0); });
  box.querySelector('.sb-copy').onclick = async ev => {
    const btn = ev.currentTarget;
    try { await navigator.clipboard.writeText(d.url); btn.textContent = 'Copied ✓'; } catch (err) { btn.textContent = d.url; }
    setTimeout(closeShare, 1400);
  };
  document.body.appendChild(box);
  const r = anchor.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
  const left = Math.max(8, Math.min(r.left, innerWidth - bw - 8)), up = (anchor.closest('.pop') || r.bottom + bh + 8 > innerHeight) && r.top > bh + 8;
  box.style.left = left + scrollX + 'px'; box.style.top = (up ? r.top - bh - 6 : r.bottom + 6) + scrollY + 'px';
}
document.addEventListener('click', e => { if (shareBox && !shareBox.contains(e.target) && !shareBox.anchor.contains(e.target)) closeShare(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeShare(); });
document.getElementById('share').onclick = e => share(e.currentTarget, {title:'DC Traffic Cameras',
  text:`Every speed, red-light and stop-sign camera in DC, and how often each one fines. The busiest one issued ${fmt(ranked0.n)} fines in a year.`, url:SITE_URL});
const count = f => cams.filter(f).length;
function keyRow(host, k, info, glyphEl, n) {
  const b = document.createElement('button'); b.className = 'key'; b.type = 'button'; b.setAttribute('aria-pressed', on[k]); b.id = 'key-' + k;
  const g = document.createElement('span'); g.appendChild(glyphEl);
  b.append(g); b.insertAdjacentHTML('beforeend', `<span class="kname">${info.name}<span class="kdesc">${info.desc}</span></span><span class="kn">${n}</span>`);
  b.onclick = () => { if (poster) return; on[k] = !on[k]; b.setAttribute('aria-pressed', on[k]); applyFilter(); };
  host.appendChild(b);
}
for (const t of KEYTYPES) keyRow(document.getElementById('keysType'), t, TYPES[t], mini(t, 'live', 6), count(c => c.t === t));
for (const s of KEYSTATS) keyRow(document.getElementById('keysStat'), s, STATS[s], mini('spd', s, 6), count(c => c.s === s));
document.getElementById('sizes').innerHTML = [1000, 10000, 40000, 90000].map(v => {
  const r = rad(v) * 1.15; return `<figure><svg viewBox="${-r - 2} ${-r - 2} ${2 * r + 4} ${2 * r + 4}" width="${(2 * r + 4) / 15}rem" aria-hidden="true"><circle r="${r}" fill="var(--muted)"/></svg><span class="num">${v / 1000}k</span></figure>`;
}).join('');
const um = meta.unmapped;
document.getElementById('unmapped').innerHTML = `<p><strong>${(um['Clear Lane'] || 0) + (um['School Bus'] || 0)} cameras ride on buses</strong> (bus lanes, school-bus stop arms): no fixed spot to map. Truck-route cameras left out, bar one visitors reported.</p>`;
function stats() {
  const v = cams.filter(vis);
  document.getElementById('tot').textContent = v.filter(c => c.s !== 'unv').length;
  for (const t of KEYTYPES) document.querySelector(`#key-${t} .kn`).textContent = count(c => c.t === t && on[c.s]);
  for (const k of KEYSTATS) document.querySelector(`#key-${k} .kn`).textContent = count(c => c.s === k && on[c.t]);
  document.getElementById('split').innerHTML = KEYSTATS.filter(s => on[s]).map(s => `<span><b class="num">${v.filter(c => c.s === s).length}</b> ${STATS[s].name.toLowerCase()}</span>`).join('');
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
const homeBtn = document.getElementById('home');
const mk = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mk')) || 1;
function pxPerUnit(svg, box) { const r = svg.getBoundingClientRect(); return Math.min(r.width / box.w, r.height / box.h); }
function setVB() {
  map.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const k = pxPerUnit(map, vb), fit = Math.max(.5, Math.min(1, pxPerUnit(map, FULL) * FULL.h / 950)), z = Math.min(1.6 / fit, Math.pow(vb.w / FULL.w, -0.35));
  map.style.setProperty('--s', (mk() * fit * z / k).toFixed(4));
  map.style.setProperty('--sl', (mk() * Math.max(fit, .72) * Math.min(z, 1.3) / k).toFixed(4));
  homeBtn?.classList.toggle('on', vb.w < FULL.w * .8);
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
const ptrs = new Map(); let moved = 0, pinch0 = null, downId = null;   // downId: camera under the finger at touch start (capture retargets later events)
map.addEventListener('pointerdown', e => { downId = ptrs.size ? null : e.target.closest?.('[data-id]')?.dataset.id ?? null; map.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); } map.classList.add('drag'); });
map.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const prev = ptrs.get(e.pointerId), k = pxPerUnit(map, vb);
  if (ptrs.size === 1) { const dx = e.clientX - prev[0], dy = e.clientY - prev[1]; moved += Math.abs(dx) + Math.abs(dy); vb.x -= dx / k; vb.y -= dy / k; setVB(); }
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0) { const [ux, uy] = toUser({clientX:(a[0] + b[0]) / 2, clientY:(a[1] + b[1]) / 2}); zoomAt(pinch0 / d, ux, uy); } pinch0 = d; moved += 10; }
});
const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; if (!ptrs.size) map.classList.remove('drag'); };
map.addEventListener('pointerup', e => { if (moved < 6 && ptrs.size === 1 && downId) select(downId, false); up(e); });
map.addEventListener('pointercancel', up);
// wheel zooms only with Ctrl/⌘ held (trackpad pinch arrives as ctrl+wheel); a plain wheel scrolls the page
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent), KEY = MAC ? '⌘' : 'Ctrl';
document.getElementById('hintZoom').textContent = `pinch or ${KEY} + scroll to zoom`;
const wtip = document.getElementById('wtip'); wtip.firstChild.textContent = `Hold ${KEY} and scroll to zoom`; let wtT;
map.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) { wtip.classList.add('on'); clearTimeout(wtT); wtT = setTimeout(() => wtip.classList.remove('on'), 1100); return; }
  e.preventDefault(); wtip.classList.remove('on'); const [ux, uy] = toUser(e); zoomAt(Math.exp(e.deltaY * 0.0022), ux, uy);
}, {passive:false});
map.addEventListener('dblclick', e => { const [ux, uy] = toUser(e); zoomAt(0.5, ux, uy); });
document.getElementById('zin').onclick = () => zoomAt(0.6, vb.x + vb.w / 2, vb.y + vb.h / 2);
document.getElementById('zout').onclick = () => zoomAt(1 / 0.6, vb.x + vb.w / 2, vb.y + vb.h / 2);
document.getElementById('zfit').onclick = () => flyHome();
document.getElementById('home').onclick = () => flyHome();

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
hoodSel.onchange = () => { hood = hoods[+hoodSel.value]; try { localStorage.setItem('dcc-hood', hood.n); } catch (e) {} drawInset(); if (!calm) { inset.classList.remove('fade'); void inset.getBoundingClientRect(); inset.classList.add('fade'); } };
try { const saved = localStorage.getItem('dcc-hood'), i = hoods.findIndex(h => h.n === saved); if (i > 0 && !poster) { hood = hoods[i]; hoodSel.value = i; } } catch (e) {}
inset.addEventListener('click', e => { const t = e.target.closest('[data-id]'); if (t) select(t.dataset.id, true); });
function setInsetScale() { const sc = (poster ? 1.9 : 1) / pxPerUnit(inset, {w:2 * HALF, h:2 * HALF}); if (Math.abs(sc - lastSc) > 1e-3) drawInset(); }

/* ---------- by ward: top 3 per ward, expandable ---------- */
const WARDS = [...new Set(cams.map(c => c.ward))].filter(Boolean).sort();
const wardHost = document.getElementById('wards'), rowEls = new Map(), wardEls = [];
const recent = d => d && (new Date(meta.asof_iso) - new Date(d)) / 864e5 <= 92;
const FLOOR = {spd:100, red:150, stp:100, trk:0};   // lowest fine per type, as in the citywide $ figure
let WIN = 12;   // months shown in the ward list
const winN = c => (c.m || []).slice(-WIN).reduce((a, v) => a + v, 0);
const usd = v => v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : `$${Math.round(v / 1e3)}k`;
for (const w of WARDS) {
  const band = cams.filter(c => c.ward === w).sort((a, b) => (b.n || 0) - (a.n || 0));
  const box = document.createElement('div'); box.className = 'ward';
  box.innerHTML = `<div class="ward-h"><b>Ward ${w}</b><svg preserveAspectRatio="none" aria-hidden="true"></svg><span class="wn"></span></div>`;
  for (const c of band) {
    const r = document.createElement('div'); r.className = 'row'; r.tabIndex = 0; r.dataset.id = c.id;
    const g = document.createElement('span'); g.appendChild(mini(c.t, c.s));
    const what = c.t === 'spd' && c.lim ? `<span class="limit">${c.lim}</span>` : `<span class="ttype">${TYPES[c.t].name}</span>`;
    const tags = (c.s !== 'live' ? `<span class="tag">${c.s === 'warn' ? 'warning' : 'not live'}</span>` : '') + (recent(c.since) ? '<span class="tag">new</span>' : '') + (c.port ? '<span class="tag">portable</span>' : '');
    r.appendChild(g);
    r.insertAdjacentHTML('beforeend', `<span class="l">${c.loc}${tags}<small class="nb">near ${c.hood}</small></span><span class="t">${what}</span><span class="n">${fmt(c.n)}</span>`);
    r.querySelector('.n').dataset.id = c.id;
    r.onclick = () => select(c.id, true); r.onkeydown = e => { if (e.key === 'Enter') select(c.id, true); };
    box.appendChild(r); rowEls.set(c.id, r);
  }
  const more = document.createElement('button'); more.className = 'more'; more.type = 'button';
  more.onclick = () => { box.classList.toggle('open'); wardRefresh(); };
  box.appendChild(more); wardHost.appendChild(box);
  wardEls.push({box, band, more, svg:box.querySelector('svg'), wn:box.querySelector('.wn')});
}
document.querySelectorAll('#wwin button').forEach(b => b.onclick = () => {
  WIN = +b.dataset.m; document.querySelectorAll('#wwin button').forEach(x => x.setAttribute('aria-pressed', x === b)); wardRefresh();
});
function wardRefresh() {
  const mx = Math.max(1, ...wardEls.map(W => W.band.filter(vis).length));
  for (const W of wardEls) {
    const v = W.band.filter(vis).sort((a, b) => winN(b) - winN(a)), open = W.box.classList.contains('open');
    v.forEach(c => { const r = rowEls.get(c.id); r.querySelector('.n').textContent = fmt(winN(c)); W.box.insertBefore(r, W.more); });
    W.box.classList.toggle('hide', !v.length);
    v.forEach((c, i) => rowEls.get(c.id).classList.toggle('extra', i >= 3));
    W.svg.innerHTML = ''; W.svg.setAttribute('viewBox', `0 0 ${mx} 10`);
    let x = 0;
    for (const t in TYPES) { const n = v.filter(c => c.t === t).length; if (!n) continue; el('rect', {x, y:0, width:Math.max(n - .35, .3), height:10, fill:`var(--${t})`}, W.svg); x += n; }
    W.wn.textContent = `${v.length} cameras · ${big(v.reduce((a, c) => a + winN(c), 0))} fines · ${usd(v.reduce((a, c) => a + winN(c) * FLOOR[c.t], 0))}`;
    W.more.hidden = v.length <= 3;
    W.more.textContent = open ? 'Show top 3' : `Show all ${v.length}`;
  }
}

/* ---------- selection + filters ---------- */
const byId = new Map(cams.map(c => [c.id, c]));
const CLICK_MODE = location.hash === '#lens' ? 'lens' : 'zoom';   // 'zoom' flies the map in; 'lens' magnifies in the panel
const ranked = cams.filter(c => c.n).sort((a, b) => b.n - a.n), rankOf = new Map(ranked.map((c, i) => [c.id, i + 1]));
const wrap = map.closest('.mapwrap');
const every = n => { if (!n) return null; const m = 365.25 * 1440 / n; return m < 60 ? `${Math.max(1, Math.round(m))} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`; };
let anim = 0;
function flyTo(c) {   // smooth zoom to street level, camera kept clear of the panel
  const r = map.getBoundingClientRect(), narrow = r.width < 700, asp = r.height / r.width;
  const w = FULL.w / 14, h = w * asp, fx = narrow ? .5 : .62, fy = narrow ? .27 : .42;
  const to = {x:c.x - fx * w, y:c.y - fy * h, w, h}, from = {...vb};
  if (Math.abs(from.h / from.w - asp) > 1e-3) { const cy = from.y + from.h / 2; from.h = from.w * asp; from.y = cy - from.h / 2; }
  cancelAnimationFrame(anim);
  if (calm) { vb = to; setVB(); return; }
  const t0 = performance.now(), T = 650, lw0 = Math.log(from.w), lw1 = Math.log(to.w);
  const fc = [from.x + from.w * fx, from.y + from.h * fy], tc = [c.x, c.y];
  const step = t => {
    const p = Math.min(1, (t - t0) / T), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const ww = Math.exp(lw0 + (lw1 - lw0) * e), hh = ww * asp, cx = fc[0] + (tc[0] - fc[0]) * e, cy = fc[1] + (tc[1] - fc[1]) * e;
    vb = {x:cx - fx * ww, y:cy - fy * hh, w:ww, h:hh}; setVB();
    if (p < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
function flyHome() {   // glide back to the whole city and close any camera panel
  closePop(); cancelAnimationFrame(anim);
  const from = {...vb}, to = {...FULL};
  if (calm) { vb = to; setVB(); return; }
  const t0 = performance.now(), T = 600, c0 = [from.x + from.w / 2, from.y + from.h / 2], c1 = [to.x + to.w / 2, to.y + to.h / 2];
  const step = t => {
    const p = Math.min(1, (t - t0) / T), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const w = Math.exp(Math.log(from.w) + (Math.log(to.w) - Math.log(from.w)) * e), h = Math.exp(Math.log(from.h) + (Math.log(to.h) - Math.log(from.h)) * e);
    vb = {x:c0[0] + (c1[0] - c0[0]) * e - w / 2, y:c0[1] + (c1[1] - c0[1]) * e - h / 2, w, h}; setVB();
    if (p < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
function drawLens(svg, c) {   // magnified street-level view around one camera, drawn in its own small SVG
  const HW = 24, px = svg.getBoundingClientRect().width || 220, sc = 2 * HW / px;
  svg.setAttribute('viewBox', `${c.x - HW} ${c.y - HW} ${2 * HW} ${2 * HW}`); svg.style.setProperty('--s', sc.toFixed(4));
  const cid = 'lens' + Math.random().toString(36).slice(2, 7), defs = el('defs', {}, svg);
  el('circle', {cx:c.x, cy:c.y, r:HW - .5}, el('clipPath', {id:cid}, defs));
  const g = el('g', {'clip-path':`url(#${cid})`}, svg);
  el('rect', {x:c.x - HW, y:c.y - HW, width:2 * HW, height:2 * HW, fill:'var(--land)'}, g);
  el('path', {d:BASE.parks, fill:'var(--park)'}, g); el('path', {d:BASE.water, fill:'var(--water)'}, g);
  el('path', {d:BASE.local, fill:'none', stroke:'var(--road)', 'stroke-width':1.6, 'vector-effect':'non-scaling-stroke'}, g);
  el('path', {d:BASE.min + BASE.art, fill:'none', stroke:'var(--road)', 'stroke-width':2.6, 'vector-effect':'non-scaling-stroke'}, g);
  el('path', {d:BASE.fwy, fill:'none', stroke:'var(--road-fwy)', 'stroke-width':3.4, 'vector-effect':'non-scaling-stroke'}, g);
  const nearby = cams.filter(o => vis(o) && Math.abs(o.x - c.x) < HW * 1.3 && Math.abs(o.y - c.y) < HW * 1.3);
  for (const o of nearby) if (o.st) { streak(g, o, 7).setAttribute('stroke-opacity', o.id === c.id ? .6 : .35); chevron(g, o); }
  const taken = [];
  for (const a of DATA.anchors) {
    if (taken.length >= 5 || Math.hypot(a[0] - c.x, a[1] - c.y) > HW * .8 || taken.some(t => t[3] === a[3] || Math.hypot(t[0] - a[0], t[1] - a[1]) < HW * .35)) continue;
    taken.push(a);
    el('text', {class:'cs lbl', 'text-anchor':'middle', y:-3, 'font-size':9, 'font-style':'italic', fill:'var(--ink-2)'}, el('g', {transform:`translate(${a[0]} ${a[1]}) rotate(${a[2]})`}, g)).textContent = a[3];
  }
  for (const o of nearby) {
    const inner = el('g', {class:'cs'}, el('g', {transform:`translate(${o.x} ${o.y})`}, g));
    if (o.t === 'spd' && o.lim) { const [ux, uy] = heading(o); badge(el('g', {transform:`translate(${(ux * 9).toFixed(1)} ${(uy * 9).toFixed(1)}) scale(1.25)`}, inner), o); }
    else glyph(inner, o.t, o.s, 5);
  }
  el('circle', {cx:c.x, cy:c.y, r:HW - .5, fill:'none', stroke:'var(--edge)', 'stroke-width':1, 'vector-effect':'non-scaling-stroke'}, svg);
}
function bars(c) {   // 12 monthly bars for one camera, one hue, faint baseline, latest month emphasised
  const m = c.m || [], mx = Math.max(1, ...m), W = 240, H = 46, bw = W / m.length;
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Fines per month, ${meta.months[0]} to ${meta.months[meta.months.length - 1]}`);
  el('line', {x1:0, x2:W, y1:H - .5, y2:H - .5, stroke:'var(--hair)', 'stroke-width':1, 'vector-effect':'non-scaling-stroke'}, svg);
  m.forEach((v, i) => {
    const h = v ? Math.max(1.5, (H - 4) * v / mx) : 0;
    el('rect', {x:i * bw + 1.5, y:H - h, width:bw - 3, height:h, rx:1.5, fill:`var(--${c.t})`, 'fill-opacity':i === m.length - 1 ? 1 : .55}, svg);
    el('title', {}, el('rect', {x:i * bw, y:0, width:bw, height:H, fill:'transparent'}, svg)).textContent = `${monthName(meta.months[i])}: ${v.toLocaleString('en-US')} fines`;
  });
  return svg;
}
function select(id, fromOutside) {
  const c = byId.get(id); if (!c) return;
  selRing.setAttribute('transform', `translate(${c.x} ${c.y})`); selRing.classList.remove('hide');
  wrap.querySelector('.pop')?.remove();
  const pop = document.createElement('div'); pop.className = 'pop' + (CLICK_MODE === 'lens' ? ' lensmode' : ''); pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Camera details'); pop.dataset.id = c.id;
  const since = c.since ? new Date(c.since + 'T12:00').toLocaleDateString('en-US', {month:'short', year:'numeric'}) : null;
  const what = c.t === 'spd' && c.lim ? `<span class="limit">${c.lim}</span>` : '';
  const sub = [TYPES[c.t].name, STATS[c.s].name, `near ${c.hood}, Ward ${c.ward}`].concat(since ? [`since ${since}`] : []).concat(c.port ? ['portable'] : []);
  const ev = every(c.n), rk = rankOf.get(c.id);
  pop.innerHTML = `<button class="pop-x" type="button" aria-label="Close">×</button>
    ${CLICK_MODE === 'lens' ? '<svg class="lens" aria-hidden="true"></svg>' : ''}
    <div class="pop-h"><span class="pg"></span><b>${c.loc}</b>${what}</div>
    <div class="pop-sub">${sub.join('<i class="dot"></i>')}</div>
    ${c.fix && c.fix.by ? `<div class="pop-fix">${({move:'Location corrected', include:'Added to the map', report:'Reported'})[c.fix.a]} thanks to ${c.fix.by.replace(/\.$/, '')}. Thank you!</div>` : ''}
    <div class="pop-stats">
      <div><b>${c.n ? fmt(c.n) : '0'}</b><span>fines, 12 months</span></div>
      <div><b>${ev ? '1 / ' + ev : '—'}</b><span>${ev ? 'on average' : c.s === 'live' ? 'no fines logged' : 'not fining yet'}</span></div>
      <div><b>${rk ? '#' + rk : '—'}</b><span>of ${NLISTED} cameras</span></div>
    </div>
    ${c.n ? `<div class="pop-bars"></div><div class="pop-cap"><span>${monthName(meta.months[0])}</span><span>fines per month</span><span>${monthName(meta.months[meta.months.length - 1])}</span></div>` : ''}
    <div class="pop-acts"><span><button class="pop-got" type="button"></button><button class="pop-less" type="button" aria-label="Remove one" hidden>−</button></span><button class="pop-share" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Share this camera</button></div>`;
  pop.querySelector('.pg').appendChild(mini(c.t, c.s, 7));
  if (c.n) pop.querySelector('.pop-bars').appendChild(bars(c));
  pop.querySelector('.pop-x').onclick = closePop;
  pop.querySelector('.pop-share').onclick = e => share(e.currentTarget, {title:`${c.loc} · DC Traffic Cameras`,
    text:c.n ? `This camera on ${c.loc} issued ${fmt(c.n)} fines in 12 months, one every ${ev}. #${rk} of ${NLISTED} in DC.` : `${TYPES[c.t].name} camera on ${c.loc}, not fining yet.`,
    url:`${SITE_URL}c/${slugOf(c.id)}/#map`});
  const got = pop.querySelector('.pop-got'), less = pop.querySelector('.pop-less'), sl = slugOf(c.id);
  const paint = () => { const k = TAB[sl] || 0; got.textContent = k ? `Got me${k > 1 ? ' ×' + k : ''} ✓` : 'This one got me'; got.classList.toggle('on', !!k); less.hidden = !k; };
  got.onclick = () => { setTab(sl, (TAB[sl] || 0) + 1); paint(); got.classList.remove('bumped'); void got.offsetWidth; got.classList.add('bumped'); };
  less.onclick = () => { setTab(sl, (TAB[sl] || 0) - 1); paint(); };
  paint();
  if (!poster && !cardmode && CLICK_MODE === 'zoom') history.replaceState(null, '', '#cam-' + slugOf(c.id));
  wrap.appendChild(pop);
  if (CLICK_MODE === 'lens') drawLens(pop.querySelector('.lens'), c); else flyTo(c);
  if (fromOutside) wrap.scrollIntoView({behavior:calm ? 'auto' : 'smooth', block:'start'});
}
// "your tab": tickets a visitor says a camera gave them; kept in this browser only, never sent anywhere
const TAB_KEY = 'dctc-tab', FINE = {spd:100, red:150, stp:100};
let TAB = {}; try { TAB = JSON.parse(localStorage.getItem(TAB_KEY)) || {}; } catch (err) {}
const tabBtn = document.getElementById('tabBtn');
function tabSum() { let n = 0, usd = 0; for (const [sl, k] of Object.entries(TAB)) { const c = cams.find(x => slugOf(x.id) === sl); if (!c) continue; n += k; usd += k * (FINE[c.t] || 100); } return {n, usd}; }
function setTab(sl, k) { if (k > 0) TAB[sl] = k; else delete TAB[sl]; try { localStorage.setItem(TAB_KEY, JSON.stringify(TAB)); } catch (err) {} paintTab(); }
function paintTab() {
  const {n, usd} = tabSum(); tabBtn.hidden = !n || poster || cardmode;
  document.getElementById('tabN').textContent = n ? `${n} · $${usd.toLocaleString('en-US')}+` : '';
  if (wrap.querySelector('.tabbox')) openTab(true);
}
function openTab(refresh) {
  const old = wrap.querySelector('.tabbox'); if (old) { old.remove(); if (!refresh) return; }
  const {n, usd} = tabSum(); if (!n) return;
  const rows = Object.entries(TAB).map(([sl, k]) => [cams.find(x => slugOf(x.id) === sl), k]).filter(r => r[0]).sort((a, b) => b[1] - a[1]);
  const box = document.createElement('div'); box.className = 'tabbox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Your tab');
  box.innerHTML = `<h3>Your DC camera tab</h3><p class="tb-sum">${n} ticket${n > 1 ? 's' : ''}, at least $${usd.toLocaleString('en-US')}</p>
    <ol>${rows.map(([c, k]) => `<li data-id="${c.id}"><span>${c.loc}</span><b>×${k}</b><button class="tb-del" type="button" aria-label="Remove ${c.loc}">×</button></li>`).join('')}</ol>
    <div class="tb-row"><button class="tb-share" type="button">Share my tab</button></div>
    <p class="tb-note">Saved on this device only. Amounts are the lowest fine for each camera type.</p>`;
  box.querySelectorAll('li').forEach(li => li.onclick = () => { box.remove(); select(li.dataset.id, false); });
  box.querySelector('.tb-share').onclick = e => share(e.currentTarget, {title:'My DC camera tab',
    text:`My DC traffic camera tab: ${n} ticket${n > 1 ? 's' : ''}, at least $${usd.toLocaleString('en-US')}. Which cameras got you?`, url:SITE_URL});
  box.querySelectorAll('.tb-del').forEach(x => x.onclick = e => {   // remove one camera from the tab, no questions asked
    e.stopPropagation(); const id = x.closest('li').dataset.id; setTab(slugOf(id), 0);
    const pop = wrap.querySelector('.pop'); if (pop && pop.dataset.id === id) { const g = pop.querySelector('.pop-got'); g.textContent = 'This one got me'; g.classList.remove('on'); pop.querySelector('.pop-less').hidden = true; }
  });
  wrap.appendChild(box);
}
tabBtn.onclick = () => openTab(false);
document.addEventListener('keydown', e => { if (e.key === 'Escape') wrap.querySelector('.tabbox')?.remove(); });
paintTab();
function closePop() { if (!wrap.querySelector('.pop')) return; wrap.querySelector('.pop').remove(); selRing.classList.add('hide'); closeShare(); if (location.hash.startsWith('#cam-')) history.replaceState(null, '', location.pathname + location.search); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });
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
const src = `Data: DDOT Automated Safety Cameras and DC GIS, via ${A('https://opendata.dc.gov/datasets/automated-safety-cameras', 'Open Data DC')}, licensed ${A('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')}; adapted for this map. Cameras as of ${meta.asof}; fines through ${meta.last_record}. Fine amounts: ${A('https://ddot.dc.gov/page/dc-streetsafe-faqs', 'DDOT')}. * Fines DDOT logged in months a camera was live, ${meta.window}; dollars count each fine at its lowest amount ($100 speed or stop sign, $150 red light), a floor on fines issued, not money collected. Typeface: Overpass, SIL Open Font License.${meta.site.goatcounter ? ' Visits are counted with GoatCounter, without cookies or personal data.' : ''}`;
document.getElementById('sources').innerHTML = `<p>${src}</p><p class="note" id="counter-note"><b>How the live counters work.</b> DC's ${cams.length} mapped cameras issued ${S.fines.toLocaleString('en-US')} fines in ${meta.window}: one every ${S.sec.toFixed(1)} seconds on average. Each time the ring completes, the counters add one fine and $${AVG.toFixed(0)}, the average fine counted at the lowest amount for its type. Many fines are higher (speeding 16+ mph over costs $150–500), and fines issued are not the same as money collected. It is an average pace, not a live feed.</p>`;
document.getElementById('posterfoot').innerHTML = src;
if (meta.site.tip_url) {
  const tb = document.getElementById('tipBtn'); tb.href = meta.site.tip_url; tb.querySelector('span').textContent = meta.site.tip_label; tb.hidden = false;
  const tk = document.getElementById('ticket'), amts = meta.site.tip_amounts || [{label:meta.site.tip_label, url:meta.site.tip_url}];   // one click per amount, straight to checkout
  document.getElementById('tkAmts').innerHTML = amts.map(a => `<a class="tk-pay" href="${a.url}" target="_blank" rel="noopener">${a.label}</a>`).join(''); tk.hidden = false;
  const t = document.getElementById('tip'); t.innerHTML = `Free, no ads, no tracking. Saved you a ticket? ${A(meta.site.tip_url, meta.site.tip_label)}.`; t.hidden = false;
}
if (meta.site.repo_url) document.getElementById('links').innerHTML = `<a href="c/">All ${NLISTED} cameras, listed</a> · ` + A(meta.site.repo_url, 'Code, data and method') + (meta.site.newsletter && meta.site.note_form ? ` · <a id="footMonthly" href="#nl">Monthly email for your ward</a>` : '') + (meta.site.feedback_url || meta.site.note_form ? ` · <a id="footSuggest" href="${meta.site.note_form ? '#suggest' : meta.site.feedback_url}"${meta.site.note_form ? '' : ' target="_blank" rel="noopener"'}>Suggest a fix or an idea</a>` : '');
// suggestion box: with a Google Form configured, notes post in place (no account, no redirect); else the GitHub form
(function suggest() {
  const S2 = meta.site, box = document.getElementById('suggest'), open = document.getElementById('sgOpen'), form = document.getElementById('sgForm');
  const txt = document.getElementById('sgText'), done = document.getElementById('sgDone'), send = document.getElementById('sgSend');
  if (S2.tip_url) document.getElementById('sgCoffee').innerHTML = `Consider <a href="${S2.tip_url}" target="_blank" rel="noopener">buying me a coffee ☕</a>. It helps keep the map free and accessible to everyone!`;
  const inline = !!(S2.note_form && S2.note_entry);
  if (!inline && !S2.feedback_url) return;
  box.hidden = false;
  const show = on => { form.hidden = !on; box.classList.toggle('open', on); open.setAttribute('aria-expanded', on); if (on) { done.hidden = true; txt.focus({preventScroll:true}); } };
  open.onclick = () => inline ? show(form.hidden) : window.open(S2.feedback_url, '_blank', 'noopener');
  const fl = document.getElementById('footSuggest');
  if (fl) fl.onclick = e => { if (!inline) return; e.preventDefault(); box.scrollIntoView({block:'center'}); show(true); };
  form.onsubmit = async e => {
    e.preventDefault(); const v = txt.value.trim(); if (!v) return;
    send.disabled = true; send.textContent = 'Sending…';
    try { if (!document.getElementById('sgWeb').value) { const body = new URLSearchParams({[S2.note_entry]:v}), nm = document.getElementById('sgName'), ml = document.getElementById('sgMail');
      const add = (k, x) => { x = x.trim(); if (k && x) body.set(k, body.has(k) ? body.get(k) + ' · ' + x : x); };   // name and email may share one form field
      add(S2.note_name_entry, nm.value); add(S2.note_email_entry, ml.value);
      await fetch(S2.note_form, {method:'POST', mode:'no-cors', body}); } }
    catch (err) { send.disabled = false; send.textContent = 'Retry'; return; }
    txt.value = ''; document.getElementById('sgName').value = document.getElementById('sgMail').value = ''; send.disabled = false; send.textContent = 'Send'; form.hidden = true; box.classList.remove('open'); open.setAttribute('aria-expanded', false); done.hidden = false;
  };
})();

// monthly ward email: sign-ups post to the same Google Form as suggestions, marked "[monthly email] Ward N"; the
// Apps Script in the project account files them separately and sends the latest issue at once
(function newsletter() {
  const S2 = meta.site; if (!S2.newsletter || !S2.note_form || !S2.note_email_entry || poster || cardmode) return;
  const form = document.getElementById('nl'), mail = document.getElementById('nlMail'), ward = document.getElementById('nlWard'),
        send = document.getElementById('nlSend'), done = document.getElementById('nlDone'), row = form.querySelector('.nl-row');
  const HINT = ['Columbia Heights, Adams Morgan', 'Downtown, Dupont, Georgetown', 'Cleveland Park, Tenleytown', 'Petworth, Takoma',
                'Brookland, Trinidad', 'Capitol Hill, Navy Yard', 'Deanwood, Benning', 'Anacostia, Congress Heights'];
  ward.insertAdjacentHTML('beforeend', HINT.map((h, i) => `<option value="${i + 1}">Ward ${i + 1} · ${h}</option>`).join(''));
  form.hidden = false;
  form.onsubmit = async e => {
    e.preventDefault(); const em = mail.value.trim(), w = ward.value; if (!em || !w) return;
    send.disabled = true; send.textContent = 'Signing up…';
    try { if (!document.getElementById('nlWeb').value) await fetch(S2.note_form, {method:'POST', mode:'no-cors',
      body:new URLSearchParams({[S2.note_entry]:`[monthly email] Ward ${w}`, [S2.note_email_entry]:em})}); }
    catch (err) { send.disabled = false; send.textContent = 'Retry'; return; }
    row.hidden = true; form.querySelector('.nl-lab').hidden = true; done.hidden = false;
    done.innerHTML = `You're in. Last month's numbers for Ward ${w} are on their way to your inbox.<span>Not there in a few minutes? Check spam or promotions.</span>`;
  };
  const fl = document.getElementById('footMonthly'); if (fl) fl.onclick = e => { e.preventDefault(); form.scrollIntoView({block:'center'}); mail.focus({preventScroll:true}); };
})();

function layout() { if (poster) document.documentElement.style.setProperty('--mk', 2.2); if (cardmode) document.documentElement.style.setProperty('--mk', 1.5); setVB(); setInsetScale(); }
new ResizeObserver(layout).observe(map); new ResizeObserver(setInsetScale).observe(inset);
applyFilter(); layout();
{ const m = location.hash.match(/^#cam-([a-z0-9]+)$/), c = m && cams.find(k => slugOf(k.id) === m[1]); if (c) requestAnimationFrame(() => select(c.id, true)); }
// visit count (GoatCounter, cookieless): one request per page view, only on the live site; a shared camera link counts
// as c/<id> so its shares show up. Open the site once with #nocount to stop counting that browser (#count undoes it).
(function count() {
  const code = meta.site.goatcounter; if (!code || poster || cardmode) return;
  try { if (location.hash === '#nocount') localStorage.setItem('dctc-nocount', '1'); if (location.hash === '#count') localStorage.removeItem('dctc-nocount'); if (localStorage.getItem('dctc-nocount')) return; } catch (err) {}
  if (!meta.site.site_url || location.host !== new URL(meta.site.site_url).host) return;
  const m = location.hash.match(/^#cam-([a-z0-9]+)$/), q = new URLSearchParams({p:m ? `/c/${m[1]}` : '/', t:document.title, r:document.referrer, s:`${screen.width},${screen.height},${devicePixelRatio}`, rnd:Math.random().toString(36).slice(2)});
  new Image().src = `https://${code}.goatcounter.com/count?${q}`;
})();
