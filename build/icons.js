// Render build/favicon.svg to the PNG icons in docs/ (run once after editing the SVG)
// usage: NODE_PATH=$(npm root -g) node build/icons.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const svg = fs.readFileSync(path.join(__dirname, 'favicon.svg'), 'utf8'), docs = path.join(__dirname, '..', 'docs');
(async () => {
  const b = await chromium.launch();
  for (const [name, px, bleed] of [['icon-32.png', 32, false], ['icon-192.png', 192, false], ['apple-touch-icon.png', 180, true]]) {
    const p = await b.newPage({viewport:{width:px, height:px}});
    const s = bleed ? svg.replace('rx="7"', 'rx="0"') : svg;   // iOS rounds the corners itself
    await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${s}`);
    await p.screenshot({path:path.join(docs, name), omitBackground:true});
  }
  fs.copyFileSync(path.join(__dirname, 'favicon.svg'), path.join(docs, 'favicon.svg'));
  await b.close();
})();
