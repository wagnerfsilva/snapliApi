const {
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, buckets } = require('../config/aws');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

class S3Service {
    /**
     * Upload file to S3
     */
    async uploadFile(buffer, filename, mimeType, bucket = 'original') {
        try {
            const bucketName = bucket === 'original' ? buckets.original : buckets.watermarked;
            const key = `${uuidv4()}${path.extname(filename)}`;

            const command = new PutObjectCommand({
                Bucket: bucketName,
                Key: key,
                Body: buffer,
                ContentType: mimeType,
                ServerSideEncryption: 'AES256'
            });

            await s3Client.send(command);

            logger.info(`Arquivo enviado para S3: ${bucketName}/${key}`);

            return {
                key,
                bucket: bucketName,
                url: `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
            };
        } catch (error) {
            logger.error('Erro ao fazer upload para S3:', error);
            throw new Error(`Erro ao fazer upload: ${error.message}`);
        }
    }

    /**
     * Upload to original bucket (Bucket A)
     */
    async uploadOriginal(buffer, filename, mimeType, eventId) {
        const key = `events/${eventId}/originals/${uuidv4()}${path.extname(filename)}`;

        const command = new PutObjectCommand({
            Bucket: buckets.original,
            Key: key,
            Body: buffer,
            ContentType: mimeType,
            ServerSideEncryption: 'AES256',
            Metadata: {
                originalFilename: filename,
                eventId: eventId
            }
        });

        await s3Client.send(command);

        return key;
    }

    /**
     * Upload to watermarked bucket (Bucket B)
     */
    async uploadWatermarked(buffer, filename, mimeType, eventId, type = 'watermarked') {
        const folder = type === 'thumbnail' ? 'thumbnails' : 'watermarked';
        const key = `events/${eventId}/${folder}/${uuidv4()}${path.extname(filename)}`;

        const command = new PutObjectCommand({
            Bucket: buckets.watermarked,
            Key: key,
            Body: buffer,
            ContentType: mimeType,
            CacheControl: 'max-age=31536000',
            Metadata: {
                originalFilename: filename,
                eventId: eventId,
                type: type
            }
        });

        await s3Client.send(command);

        return key;
    }

    /**
     * Get file from S3
     */
    async getFile(key, bucket = 'original') {
        try {
            const bucketName = bucket === 'original' ? buckets.original : buckets.watermarked;

            const command = new GetObjectCommand({
                Bucket: bucketName,
                Key: key
            });

            const response = await s3Client.send(command);

            // Convert stream to buffer
            const chunks = [];
            for await (const chunk of response.Body) {
                chunks.push(chunk);
            }

            return Buffer.concat(chunks);
        } catch (error) {
            logger.error('Erro ao buscar arquivo do S3:', error);
            throw new Error(`Erro ao buscar arquivo: ${error.message}`);
        }
    }

    /**
     * Generate pre-signed URL for secure download
     */
    async generatePresignedUrl(key, bucket = 'original', expiresIn = 3600) {
        try {
            const bucketName = bucket === 'original' ? buckets.original : buckets.watermarked;

            const command = new GetObjectCommand({
                Bucket: bucketName,
                Key: key
            });

            const url = await getSignedUrl(s3Client, command, { expiresIn });

            return url;
        } catch (error) {
            logger.error('Erro ao gerar URL pré-assinada:', error);
            throw new Error(`Erro ao gerar URL de download: ${error.message}`);
        }
    }

    /**
     * Delete file from S3
     */
    async deleteFile(key, bucket = 'original') {
        try {
            const bucketName = bucket === 'original' ? buckets.original : buckets.watermarked;

            const command = new DeleteObjectCommand({
                Bucket: bucketName,
                Key: key
            });

            await s3Client.send(command);

            logger.info(`Arquivo deletado do S3: ${bucketName}/${key}`);
        } catch (error) {
            logger.error('Erro ao deletar arquivo do S3:', error);
            throw new Error(`Erro ao deletar arquivo: ${error.message}`);
        }
    }

    /**
     * Check if file exists
     */
    async fileExists(key, bucket = 'original') {
        try {
            const bucketName = bucket === 'original' ? buckets.original : buckets.watermarked;

            const command = new HeadObjectCommand({
                Bucket: bucketName,
                Key: key
            });

            await s3Client.send(command);
            return true;
        } catch (error) {
            if (error.name === 'NotFound') {
                return false;
            }
            throw error;
        }
    }

    /**
     * Get public URL for watermarked images (Bucket B)
     */
    getPublicUrl(key) {
        return `https://${buckets.watermarked}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    }
}

module.exports = new S3Service();
