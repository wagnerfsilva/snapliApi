const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function testWatermark() {
  const imageService = require('../../src/services/image.service');
  const dir = '/Users/pulpa/Downloads';
  const outDir = '/tmp/snapli-wm-test';

  fs.mkdirSync(outDir, { recursive: true });

  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('WhatsApp Image 2026-03-19') && f.endsWith('.jpeg'))
    .sort();

  console.log('Encontradas', files.length, 'imagens reais\n');

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const buffer = fs.readFileSync(path.join(dir, file));
    const meta = await sharp(buffer).metadata();
    console.log((i + 1) + '.', file.substring(0, 45) + '...', '-', meta.width + 'x' + meta.height);

    const result = await imageService.applyWatermark(buffer);
    const outName = 'wm-' + (i + 1).toString().padStart(2, '0') + '.jpg';
    await sharp(result).toFile(path.join(outDir, outName));
    console.log('   -> ' + outName);
  }

  console.log('\nTodas processadas! Abrindo...');
}

testWatermark().catch(e => { console.error('FAILED:', e.message, e.stack); process.exit(1); });
