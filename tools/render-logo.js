// Renders assets/logo.svg into PNGs and a multi-size Windows .ico
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const pngToIco = require('png-to-ico').default || require('png-to-ico');

const assets = path.join(__dirname, '..', 'assets');
const svg = fs.readFileSync(path.join(assets, 'logo.svg'));

function render(size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

(async () => {
  fs.writeFileSync(path.join(assets, 'logo-1024.png'), render(1024));
  fs.writeFileSync(path.join(assets, 'logo-256.png'), render(256));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const bufs = sizes.map(render);
  const ico = await pngToIco(bufs);
  fs.writeFileSync(path.join(assets, 'icon.ico'), ico);
  console.log('ok', ico.length);
})();
