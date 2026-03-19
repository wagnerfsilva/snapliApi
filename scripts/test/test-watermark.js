const sharp = require('sharp');

async function testWatermark() {
  // Create a test 4000x3000 image (simulating a high-res photo)
  const testBuffer = await sharp({
    create: { width: 4000, height: 3000, channels: 3, background: { r: 100, g: 150, b: 200 } }
  }).jpeg().toBuffer();

  console.log('Test image created: 4000x3000');

  const imageService = require('../../src/services/image.service');
  const result = await imageService.applyWatermark(testBuffer);
  
  const meta = await sharp(result).metadata();
  console.log('Result dimensions:', meta.width, 'x', meta.height);
  console.log('Result format:', meta.format);
  console.log('Result size:', result.length, 'bytes');
  
  // Save to verify visually
  await sharp(result).toFile('/tmp/fotow-watermark-test.jpg');
  console.log('Saved to /tmp/fotow-watermark-test.jpg - check visually!');
  
  console.log('Watermark test PASSED');
}

testWatermark().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
