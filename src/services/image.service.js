const sharp = require('sharp');
const logger = require('../utils/logger');
const { createWatermarkSvg } = require('../../lambda/shared/watermark');

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
     * Resize image to fit within AWS Rekognition 5MB limit
     */
    async resizeForRekognition(buffer, maxBytes = 4.5 * 1024 * 1024) {
        try {
            const metadata = await sharp(buffer).metadata();
            let quality = 85;
            let scale = 1;
            let result = buffer;

            // Reduce progressively until under limit
            while (result.length > maxBytes && (quality > 30 || scale > 0.3)) {
                if (quality > 40) {
                    quality -= 10;
                } else {
                    scale -= 0.1;
                }

                const newWidth = Math.round(metadata.width * scale);
                result = await sharp(buffer)
                    .resize(newWidth, null, { fit: 'inside' })
                    .jpeg({ quality })
                    .toBuffer();
            }

            return result;
        } catch (error) {
            logger.error('Erro ao redimensionar para Rekognition:', error);
            throw new Error(`Erro ao redimensionar imagem: ${error.message}`);
        }
    }

    /**
     * Apply watermark to image
     */
    async applyWatermark(buffer, watermarkText = null) {
        try {
            const resizedBuffer = await sharp(buffer)
                .resize(1920, null, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .toBuffer();

            const metadata = await sharp(resizedBuffer).metadata();
            const width = metadata.width;
            const height = metadata.height;
            const svgWatermark = createWatermarkSvg(width, height, { text: watermarkText || undefined });

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
