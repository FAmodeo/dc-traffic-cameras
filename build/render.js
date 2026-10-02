// CC Opus 5.5 — render the map page to PNG (desktop / phone / 4K poster). Fonts are fetched with curl so
// headless Chromium never needs to trust the container's proxy certificate.
// usage: NODE_PATH=$(npm root -g) node render.js <page.html> <outdir> [desktop,phone,poster,poster8k]
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const [,, file, out, which = 'desktop,phone,poster'] = process.argv;
const RUNS = {
  desktop:{w:1440, h:1000, cs:'light', full:true},
  phone:{w:400, h:860, cs:'dark', full:true, dpr:2},
  poster:{w:3840, h:2160, cs:'light', hash:'#poster'},
  poster_dark:{w:3840, h:2160, cs:'dark', hash:'#poster'},
  poster8k:{w:3840, h:2160, cs:'light', hash:'#poster', dpr:2},
  card:{w:1200, h:630, cs:'light', hash:'#card'}};
const cache = {};
const curl = url => cache[url] ??= execFileSync('curl', ['-sS', '-m', '30', '-A', 'Mozilla/5.0 Chrome/120', url]);
(async () => {
  const b = await chromium.launch();
  for (const n of which.split(',')) {
    const r = RUNS[n];
    const p = await b.newPage({viewport:{width:r.w, height:r.h}, colorScheme:r.cs, deviceScaleFactor:r.dpr || 1});
    await p.route(/fonts\.(googleapis|gstatic)\.com/, route => {
      const u = route.request().url();
      route.fulfill({status:200, body:curl(u), contentType:u.includes('googleapis') ? 'text/css' : 'font/ttf', headers:{'access-control-allow-origin':'*'}});
    });
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
    await p.goto('file://' + file + (r.hash || ''), {waitUntil:'networkidle'});
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
    await p.screenshot({path:`${out}/${n}.png`, fullPage:!!r.full});
    const info = await p.evaluate(() => ({ov:document.documentElement.scrollWidth - innerWidth, font:document.fonts.check('16px Overpass'),
      clip:[...document.querySelectorAll('.side,.inset')].map(e => Math.round(e.getBoundingClientRect().bottom))}));
    console.log(n, 'errors:', errs.length ? errs : 'none', JSON.stringify(info));
  }
  await b.close();
})();
