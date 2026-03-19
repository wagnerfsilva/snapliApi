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
            const text = watermarkText || process.env.WATERMARK_TEXT || 'FOTOW';
            const opacity = parseFloat(process.env.WATERMARK_OPACITY) || 0.3;

            // Step 1: Resize image first to get actual output dimensions
            const resizedBuffer = await sharp(buffer)
                .resize(1920, null, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .toBuffer();

            // Step 2: Get metadata of the RESIZED image
            const metadata = await sharp(resizedBuffer).metadata();
            const width = metadata.width;
            const height = metadata.height;

            // Step 3: Multi-layer watermark for maximum protection
            // Layer 1 - Dense diagonal pattern (primary)
            const fontSize1 = Math.max(Math.floor(width / 20), 16);
            const th1 = Math.ceil(fontSize1 * 1.2);
            const tw1 = Math.ceil(text.length * fontSize1 * 0.6);
            const pw1 = Math.ceil(tw1 * 1.2);
            const ph1 = Math.ceil(th1 * 2.2);

            // Layer 2 - Larger text, opposite angle
            const fontSize2 = Math.max(Math.floor(width / 10), 28);
            const th2 = Math.ceil(fontSize2 * 1.2);
            const tw2 = Math.ceil(text.length * fontSize2 * 0.6);
            const pw2 = Math.ceil(tw2 * 1.4);
            const ph2 = Math.ceil(th2 * 2.8);

            // Layer 3 - Small dense micro-text (hard to clone-stamp out)
            const fontSize3 = Math.max(Math.floor(width / 40), 10);
            const th3 = Math.ceil(fontSize3 * 1.2);
            const tw3 = Math.ceil(text.length * fontSize3 * 0.6);
            const pw3 = Math.ceil(tw3 * 1.1);
            const ph3 = Math.ceil(th3 * 1.8);

            // Layer 4 - Center band with larger prominent text
            const fontSize4 = Math.max(Math.floor(width / 8), 36);
            const bandHeight = Math.ceil(height * 0.15);
            const bandY = Math.floor((height - bandHeight) / 2);

            const svgWatermark = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="wm1" width="${pw1}" height="${ph1}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
      <text x="0" y="${th1}" font-size="${fontSize1}" font-family="Arial, Helvetica, sans-serif" font-weight="bold" fill="white" fill-opacity="${opacity}">${text}</text>
    </pattern>
    <pattern id="wm2" width="${pw2}" height="${ph2}" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <text x="0" y="${th2}" font-size="${fontSize2}" font-family="Arial, Helvetica, sans-serif" font-weight="bold" fill="white" fill-opacity="${opacity * 0.6}">${text}</text>
    </pattern>
    <pattern id="wm3" width="${pw3}" height="${ph3}" patternUnits="userSpaceOnUse" patternTransform="rotate(-60)">
      <text x="0" y="${th3}" font-size="${fontSize3}" font-family="Arial, Helvetica, sans-serif" fill="white" fill-opacity="${opacity * 0.5}">${text}</text>
    </pattern>
  </defs>
  <!-- Layer 1: Dense diagonal pattern -->
  <rect width="100%" height="100%" fill="url(#wm1)"/>
  <!-- Layer 2: Larger counter-angle pattern -->
  <rect width="100%" height="100%" fill="url(#wm2)"/>
  <!-- Layer 3: Micro-text dense fill -->
  <rect width="100%" height="100%" fill="url(#wm3)"/>
  <!-- Layer 4: Prominent center band -->
  <rect x="0" y="${bandY}" width="100%" height="${bandHeight}" fill="rgba(0,0,0,${opacity * 0.35})"/>
  <text x="${Math.floor(width / 2)}" y="${bandY + Math.floor(bandHeight / 2) + Math.floor(fontSize4 * 0.35)}" font-size="${fontSize4}" font-family="Arial, Helvetica, sans-serif" font-weight="bold" fill="white" fill-opacity="${opacity * 1.8}" text-anchor="middle" letter-spacing="${Math.floor(fontSize4 * 0.3)}">${text}</text>
</svg>`;

            const watermarkBuffer = Buffer.from(svgWatermark);

            // Step 4: Composite watermark onto resized image
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
