const sharp = require('sharp');

const LOGO_SVG = `<svg width="128" height="128" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="16" fill="#C8FF00" />
  <circle cx="32" cy="32" r="18" stroke="#09090B" stroke-width="2.8" fill="none" />
  <circle cx="32" cy="32" r="9" stroke="#09090B" stroke-width="2.8" fill="none" />
  <line x1="32" y1="14" x2="32" y2="23" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
  <line x1="47.6" y1="23" x2="39.8" y2="27.5" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
  <line x1="47.6" y1="41" x2="39.8" y2="36.5" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
  <line x1="32" y1="50" x2="32" y2="41" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
  <line x1="16.4" y1="41" x2="24.2" y2="36.5" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
  <line x1="16.4" y1="23" x2="24.2" y2="27.5" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
</svg>`;

sharp(Buffer.from(LOGO_SVG)).resize(64, 64).png().toBuffer().then(buf => {
    console.log(buf.toString('base64'));
});
