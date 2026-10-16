'use strict';

function escapeXml(value) {
    return String(value).replace(/[<>&'"]/g, character => ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;'
    })[character]);
}

function createWatermarkSvg(width, height, {
    text = process.env.WATERMARK_TEXT || 'SNAPLI',
    opacity = Number.parseFloat(process.env.WATERMARK_OPACITY) || 0.4
} = {}) {
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
        throw new Error('Dimensoes invalidas para marca dagua');
    }

    const watermarkText = String(text);
    const label = escapeXml(watermarkText);
    const strokeW = 1;
    const fs1 = Math.max(Math.floor(width / 18), 18);
    const th1 = Math.ceil(fs1 * 1.3);
    const pw1 = Math.ceil(watermarkText.length * fs1 * 0.7 * 1.15);
    const ph1 = Math.ceil(th1 * 2.0);
    const fs2 = Math.max(Math.floor(width / 9), 30);
    const th2 = Math.ceil(fs2 * 1.3);
    const pw2 = Math.ceil(watermarkText.length * fs2 * 0.7 * 1.3);
    const ph2 = Math.ceil(th2 * 2.5);
    const fs3 = Math.max(Math.floor(width / 35), 12);
    const th3 = Math.ceil(fs3 * 1.3);
    const pw3 = Math.ceil(watermarkText.length * fs3 * 0.7 * 1.1);
    const ph3 = Math.ceil(th3 * 1.6);
    const fs4 = Math.max(Math.floor(width / 7), 40);
    const bandHeight = Math.ceil(height * 0.12);
    const bandY = Math.floor((height - bandHeight) / 2);

    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="wm1" width="${pw1}" height="${ph1}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
      <text x="0" y="${th1}" font-size="${fs1}" font-weight="bold"
        font-family="DejaVu Sans, Liberation Sans, sans-serif" fill="white" fill-opacity="${opacity}"
        stroke="black" stroke-opacity="${opacity * 0.5}" stroke-width="${strokeW}">${label}</text>
    </pattern>
    <pattern id="wm2" width="${pw2}" height="${ph2}" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
      <text x="0" y="${th2}" font-size="${fs2}" font-weight="bold"
        font-family="DejaVu Sans, Liberation Sans, sans-serif" fill="white" fill-opacity="${opacity * 0.7}"
        stroke="black" stroke-opacity="${opacity * 0.35}" stroke-width="${strokeW}">${label}</text>
    </pattern>
    <pattern id="wm3" width="${pw3}" height="${ph3}" patternUnits="userSpaceOnUse" patternTransform="rotate(-55)">
      <text x="0" y="${th3}" font-size="${fs3}" font-weight="bold"
        font-family="DejaVu Sans, Liberation Sans, sans-serif" fill="white" fill-opacity="${opacity * 0.6}"
        stroke="black" stroke-opacity="${opacity * 0.3}" stroke-width="${Math.max(strokeW * 0.5, 0.5)}">${label}</text>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#wm1)"/>
  <rect width="100%" height="100%" fill="url(#wm2)"/>
  <rect width="100%" height="100%" fill="url(#wm3)"/>
  <rect x="0" y="${bandY}" width="100%" height="${bandHeight}" fill="black" fill-opacity="${opacity * 0.4}"/>
  <text x="${Math.floor(width / 2)}" y="${bandY + Math.floor(bandHeight / 2) + Math.floor(fs4 * 0.35)}" font-size="${fs4}" font-weight="bold"
    font-family="DejaVu Sans, Liberation Sans, sans-serif" fill="white" fill-opacity="${Math.min(opacity * 2, 0.85)}"
    stroke="black" stroke-opacity="${opacity * 0.6}" stroke-width="${strokeW * 2}" text-anchor="middle" letter-spacing="${Math.floor(fs4 * 0.25)}">${label}</text>
</svg>`;
}

module.exports = { createWatermarkSvg };
