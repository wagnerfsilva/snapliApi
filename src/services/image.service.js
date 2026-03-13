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

            const image = sharp(buffer);
            const metadata = await image.metadata();

            // Calculate dimensions for watermark
            const fontSize = Math.floor(metadata.width / 15);
            const textHeight = fontSize * 1.5;
            const textWidth = text.length * fontSize * 0.6; // Estimate text width

            // Create SVG watermark that covers the entire image
            const svgWatermark = `
        <svg width="${metadata.width}" height="${metadata.height}">
          <defs>
            <pattern id="watermark-pattern" x="0" y="0" width="${textWidth * 1.5}" height="${textHeight * 3}" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <text x="0" y="${textHeight}" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold" fill="white" fill-opacity="${opacity}" letter-spacing="${fontSize * 0.05}">
                ${text}
              </text>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#watermark-pattern)"/>
        </svg>
      `;

            const watermarkBuffer = Buffer.from(svgWatermark);

            // Resize image for preview (max 1920px width) and apply watermark
            return await image
                .resize(1920, null, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .composite([{
                    input: watermarkBuffer,
                    gravity: 'center'
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
