'use strict';

const { createWatermarkSvg } = require('../../lambda/shared/watermark');
const sharp = require('sharp');
const imageService = require('../../src/services/image.service');

test('shared watermark uses the same layered pattern and center band for all media', () => {
    const svg = createWatermarkSvg(720, 1280);

    expect(svg).toContain('<pattern id="wm1"');
    expect(svg).toContain('<pattern id="wm2"');
    expect(svg).toContain('<pattern id="wm3"');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('width="720" height="1280"');
});

test('escapes configured watermark text before inserting it into SVG', () => {
    const svg = createWatermarkSvg(640, 480, { text: 'A&B <Snapli>' });

    expect(svg).toContain('A&amp;B &lt;Snapli&gt;');
    expect(svg).not.toContain('A&B <Snapli>');
});

test.each([[0, 100], [100, 0], [1.5, 200]])('rejects invalid watermark dimensions %sx%s', (width, height) => {
    expect(() => createWatermarkSvg(width, height)).toThrow('Dimensoes invalidas');
});

test('photo watermark service applies the shared mark to its output image', async () => {
    const input = await sharp({ create: { width: 320, height: 480, channels: 3, background: '#555555' } })
        .jpeg()
        .toBuffer();
    const output = await imageService.applyWatermark(input);
    const metadata = await sharp(output).metadata();

    expect(metadata).toMatchObject({ format: 'jpeg', width: 320, height: 480 });
});
