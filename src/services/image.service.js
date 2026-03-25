const sharp = require('sharp');
const logger = require('../utils/logger');

class ImageService {
    /**
     * Get image metadata
     */
    async getMetadata(buffer) {
        try {
            const metadata = await sharp(buffer).metadata();
            return {
                width: metadata.width,
                height: metadata.height,
                format: metadata.format,
                size: buffer.length,
                hasAlpha: metadata.hasAlpha,
                orientation: metadata.orientation
            };
        } catch (error) {
            logger.error('Erro ao obter metadados da imagem:', error);
            throw new Error(`Erro ao processar metadados: ${error.message}`);
        }
    }

    /**
     * Create thumbnail
     */
    async createThumbnail(buffer, width = 300, height = 300) {
        try {
            return await sharp(buffer)
                .resize(width, height, {
                    fit: 'cover',
                    position: 'center'
                })
                .jpeg({ quality: 80 })
                .toBuffer();
        } catch (error) {
            logger.error('Erro ao criar thumbnail:', error);
            throw new Error(`Erro ao criar thumbnail: ${error.message}`);
        }
    }

    /**
     * Apply watermark to image
     */
    async applyWatermark(buffer, watermarkText = null) {
        try {
            const text = watermarkText || process.env.WATERMARK_TEXT || 'SNAPLI';
            const opacity = parseFloat(process.env.WATERMARK_OPACITY) || 0.4;

            // Step 1: Resize image first
            const resizedBuffer = await sharp(buffer)
                .resize(1920, null, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .toBuffer();

            const metadata = await sharp(resizedBuffer).metadata();
            const width = metadata.width;
            const height = metadata.height;

            // Step 2: Build SVG watermark using generic 'sans-serif' font
            // (Arial/Helvetica are NOT available on Linux production servers)
            const strokeW = 1;

            // Layer 1 - Dense diagonal pattern
            const fs1 = Math.max(Math.floor(width / 18), 18);
            const th1 = Math.ceil(fs1 * 1.3);
            const pw1 = Math.ceil(text.length * fs1 * 0.7 * 1.15);
            const ph1 = Math.ceil(th1 * 2.0);

            // Layer 2 - Larger text, opposite angle
            const fs2 = Math.max(Math.floor(width / 9), 30);
            const th2 = Math.ceil(fs2 * 1.3);
            const pw2 = Math.ceil(text.length * fs2 * 0.7 * 1.3);
            const ph2 = Math.ceil(th2 * 2.5);

            // Layer 3 - Small dense micro-text
            const fs3 = Math.max(Math.floor(width / 35), 12);
            const th3 = Math.ceil(fs3 * 1.3);
            const pw3 = Math.ceil(text.length * fs3 * 0.7 * 1.1);
            const ph3 = Math.ceil(th3 * 1.6);

            // Layer 4 - Center band
            const fs4 = Math.max(Math.floor(width / 7), 40);
            const bandHeight = Math.ceil(height * 0.12);
            const bandY = Math.floor((height - bandHeight) / 2);

            const svgWatermark = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="wm1" width="${pw1}" height="${ph1}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
      <text x="0" y="${th1}" font-size="${fs1}" font-weight="bold"
        font-family="DejaVu Sans, Liberation Sans, sans-serif" fill="white" fill-opacity="${opacity}"
        stroke="black" stroke-opacity="${opacity * 0.5}" stroke-width="${strokeW}">${text}</text>
    </pattern>
    <pattern id="wm2" width="${pw2}" height="${ph2}" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
      <text x="0" y="${th2}" font-size="${fs2}" font-weight="bold"
        font-family="DejaVu Sans, Liberation Sans, sans-serif" fill="white" fill-opacity="${opacity * 0.7}"
        stroke="black" stroke-opacity="${opacity * 0.35}" stroke-width="${strokeW}">${text}</text>
    </pattern>
    <pattern id="wm3" width="${pw3}" height="${ph3}" patternUnits="userSpaceOnUse" patternTransform="rotate(-55)">
      <text x="0" y="${th3}" font-size="${fs3}" font-weight="bold"
        font-family="DejaVu Sans, Liberation Sans, sans-serif" fill="white" fill-opacity="${opacity * 0.6}"
        stroke="black" stroke-opacity="${opacity * 0.3}" stroke-width="${Math.max(strokeW * 0.5, 0.5)}">${text}</text>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#wm1)"/>
  <rect width="100%" height="100%" fill="url(#wm2)"/>
  <rect width="100%" height="100%" fill="url(#wm3)"/>
  <rect x="0" y="${bandY}" width="100%" height="${bandHeight}" fill="black" fill-opacity="${opacity * 0.4}"/>
  <text x="${Math.floor(width / 2)}" y="${bandY + Math.floor(bandHeight / 2) + Math.floor(fs4 * 0.35)}" font-size="${fs4}" font-weight="bold"
    font-family="DejaVu Sans, Liberation Sans, sans-serif" fill="white" fill-opacity="${Math.min(opacity * 2, 0.85)}"
    stroke="black" stroke-opacity="${opacity * 0.6}" stroke-width="${strokeW * 2}" text-anchor="middle" letter-spacing="${Math.floor(fs4 * 0.25)}">${text}</text>
</svg>`;

            const watermarkBuffer = Buffer.from(svgWatermark);

            // Step 3: Composite watermark onto resized image
            return await sharp(resizedBuffer)
                .composite([{
                    input: watermarkBuffer,
                    top: 0,
                    left: 0
                }])
                .jpeg({ quality: 85 })
                .toBuffer();
        } catch (error) {
            logger.error('Erro ao aplicar marca d\'água:', error);
            throw new Error(`Erro ao aplicar marca d'água: ${error.message}`);
        }
    }

    /**
     * Optimize image for web
     */
    async optimizeForWeb(buffer, maxWidth = 1920) {
        try {
            return await sharp(buffer)
                .resize(maxWidth, null, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .jpeg({ quality: 85, progressive: true })
                .toBuffer();
        } catch (error) {
            logger.error('Erro ao otimizar imagem:', error);
            throw new Error(`Erro ao otimizar imagem: ${error.message}`);
        }
    }

    /**
     * Rotate image based on EXIF orientation
     */
    async autoRotate(buffer) {
        try {
            return await sharp(buffer)
                .rotate()
                .toBuffer();
        } catch (error) {
            logger.error('Erro ao rotacionar imagem:', error);
            throw new Error(`Erro ao rotacionar imagem: ${error.message}`);
        }
    }

    /**
     * Convert image to JPEG
     */
    async convertToJpeg(buffer, quality = 90) {
        try {
            return await sharp(buffer)
                .jpeg({ quality, progressive: true })
                .toBuffer();
        } catch (error) {
            logger.error('Erro ao converter imagem:', error);
            throw new Error(`Erro ao converter imagem: ${error.message}`);
        }
    }

    /**
     * Process image for upload (auto-rotate + optimize)
     */
    async processForUpload(buffer) {
        try {
            const rotated = await this.autoRotate(buffer);
            return await this.optimizeForWeb(rotated);
        } catch (error) {
            logger.error('Erro ao processar imagem para upload:', error);
            throw new Error(`Erro ao processar imagem: ${error.message}`);
        }
    }
}

module.exports = new ImageService();
