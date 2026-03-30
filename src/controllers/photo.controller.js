const { Photo, Event, OrderItem } = require('../models');
const { Op } = require('sequelize');
const crypto = require('crypto');
const path = require('path');
const s3Service = require('../services/s3.service');
const imageService = require('../services/image.service');
const rekognitionService = require('../services/rekognition.service');
const logger = require('../utils/logger');

class PhotoController {
    /**
     * Upload photos to event
     */
    async upload(req, res, next) {
        try {
            const { eventId } = req.body;
            const files = req.files;

            if (!files || files.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Nenhum arquivo enviado'
                });
            }

            // Verify event exists
            const event = await Event.findByPk(eventId);
            if (!event) {
                return res.status(404).json({
                    success: false,
                    message: 'Evento não encontrado'
                });
            }

            const uploadResults = [];
            const errors = [];

            // Process each file
            for (const file of files) {
                try {
                    // Generate hash-based filename preserving only the extension
                    const ext = path.extname(file.originalname).toLowerCase();
                    const hash = crypto.randomBytes(16).toString('hex');
                    const hashedFilename = `${hash}${ext}`;

                    // Get image metadata
                    const metadata = await imageService.getMetadata(file.buffer);

                    // Upload original to Bucket A
                    const originalKey = await s3Service.uploadOriginal(
                        file.buffer,
                        hashedFilename,
                        file.mimetype,
                        eventId
                    );

                    // Create watermarked version
                    const watermarkedBuffer = await imageService.applyWatermark(file.buffer);
                    const watermarkedKey = await s3Service.uploadWatermarked(
                        watermarkedBuffer,
                        hashedFilename,
                        'image/jpeg',
                        eventId,
                        'watermarked'
                    );

                    // Create thumbnail (from watermarked version to keep watermark)
                    const thumbnailBuffer = await imageService.createThumbnail(watermarkedBuffer);
                    const thumbnailKey = await s3Service.uploadWatermarked(
                        thumbnailBuffer,
                        hashedFilename,
                        'image/jpeg',
                        eventId,
                        'thumbnail'
                    );

                    // Create photo record
                    const photo = await Photo.create({
                        eventId,
                        originalFilename: hashedFilename,
                        originalKey,
                        watermarkedKey,
                        thumbnailKey,
                        width: metadata.width,
                        height: metadata.height,
                        fileSize: file.size,
                        mimeType: file.mimetype,
                        metadata: metadata,
                        processingStatus: 'pending',
                        uploadedBy: req.userId
                    });

                    // Process facial recognition asynchronously (in background)
                    PhotoController.processFacialRecognition(photo.id, file.buffer).catch(err => {
                        logger.error(`Erro ao processar reconhecimento facial: ${photo.id}`, err);
                    });

                    uploadResults.push({
                        id: photo.id,
                        filename: hashedFilename,
                        status: 'success'
                    });

                } catch (error) {
                    logger.error(`Erro ao processar arquivo ${file.originalname}:`, error);
                    errors.push({
                        filename: file.originalname,
                        error: error.message
                    });
                }
            }

            // Update event photo count
            await event.increment('photoCount', { by: uploadResults.length });

            logger.info(`Upload concluído: ${uploadResults.length} fotos para evento ${eventId}`);

            res.status(201).json({
                success: true,
                message: `${uploadResults.length} foto(s) enviada(s) com sucesso`,
                data: {
                    uploaded: uploadResults,
                    errors: errors.length > 0 ? errors : undefined
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Process facial recognition (async)
     */
    static async processFacialRecognition(photoId, imageBuffer) {
        try {
            const photo = await Photo.findByPk(photoId);
            if (!photo) return;

            await photo.update({ processingStatus: 'processing' });

            // Resize image if larger than 5MB (AWS Rekognition limit)
            let processBuffer = imageBuffer;
            if (imageBuffer.length > 5 * 1024 * 1024) {
                processBuffer = await imageService.resizeForRekognition(imageBuffer);
                logger.info(`Imagem redimensionada para Rekognition: ${photoId} (${imageBuffer.length} -> ${processBuffer.length} bytes)`);
            }

            // Process with Rekognition
            const faceResult = await rekognitionService.processPhoto(processBuffer, photoId);

            await photo.update({
                faceData: faceResult.faces || [],
                faceCount: faceResult.faceCount || 0,
                rekognitionFaceId: faceResult.faces?.[0]?.faceId || null,
                processingStatus: 'completed'
            });

            logger.info(`Reconhecimento facial concluído: ${photoId} - ${faceResult.faceCount} face(s)`);
        } catch (error) {
            logger.error(`Erro no reconhecimento facial: ${photoId}`, error);
            await Photo.update(
                {
                    processingStatus: 'failed',
                    processingError: error.message
                },
                { where: { id: photoId } }
            );
        }
    }

    /**
     * Get photos from event
     */
    async getByEvent(req, res, next) {
        try {
            const { eventId } = req.params;
            const {
                page = 1,
                limit = 50,
                processingStatus
            } = req.query;

            const offset = (parseInt(page) - 1) * parseInt(limit);

            const where = { eventId };
            if (processingStatus) {
                where.processingStatus = processingStatus;
            }

            const { count, rows: photos } = await Photo.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset,
                order: [['createdAt', 'DESC']],
                attributes: { exclude: ['faceData'] } // Exclude large JSONB field
            });

            // Add presigned URLs for watermarked images
            const photosWithUrls = await Promise.all(photos.map(async (photo) => {
                const data = photo.toJSON();
                return {
                    ...data,
                    watermarkedUrl: await s3Service.generatePresignedUrl(photo.watermarkedKey, 'watermarked', 3600),
                    thumbnailUrl: photo.thumbnailKey ? await s3Service.generatePresignedUrl(photo.thumbnailKey, 'watermarked', 3600) : null
                };
            }));

            res.json({
                success: true,
                data: {
                    photos: photosWithUrls,
                    pagination: {
                        total: count,
                        page: parseInt(page),
                        limit: parseInt(limit),
                        totalPages: Math.ceil(count / parseInt(limit))
                    }
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get photo by ID
     */
    async getById(req, res, next) {
        try {
            const { id } = req.params;

            const photo = await Photo.findByPk(id, {
                include: [
                    {
                        model: Event,
                        as: 'event',
                        attributes: ['id', 'name', 'date']
                    }
                ]
            });

            if (!photo) {
                return res.status(404).json({
                    success: false,
                    message: 'Foto não encontrada'
                });
            }

            const photoData = {
                ...photo.toJSON(),
                watermarkedUrl: await s3Service.generatePresignedUrl(photo.watermarkedKey, 'watermarked', 3600),
                thumbnailUrl: photo.thumbnailKey ? await s3Service.generatePresignedUrl(photo.thumbnailKey, 'watermarked', 3600) : null
            };

            res.json({
                success: true,
                data: { photo: photoData }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Delete photo
     */
    async delete(req, res, next) {
        try {
            const { id } = req.params;

            const photo = await Photo.findByPk(id);

            if (!photo) {
                return res.status(404).json({
                    success: false,
                    message: 'Foto não encontrada'
                });
            }

            // Check if photo has been sold
            const salesCount = await OrderItem.count({ where: { photoId: id } });
            if (salesCount > 0) {
                return res.status(409).json({
                    success: false,
                    message: `Esta foto não pode ser excluída pois possui ${salesCount} venda(s) associada(s)`
                });
            }

            // Delete from S3
            try {
                await s3Service.deleteFile(photo.originalKey, 'original');
                await s3Service.deleteFile(photo.watermarkedKey, 'watermarked');
                if (photo.thumbnailKey) {
                    await s3Service.deleteFile(photo.thumbnailKey, 'watermarked');
                }
            } catch (s3Error) {
                logger.error('Erro ao deletar arquivos do S3:', s3Error);
            }

            // Delete from Rekognition
            if (photo.rekognitionFaceId) {
                try {
                    await rekognitionService.deleteFaces([photo.rekognitionFaceId]);
                } catch (rekError) {
                    logger.error('Erro ao deletar face do Rekognition:', rekError);
                }
            }

            // Delete from database
            await photo.destroy();

            // Update event photo count
            await Event.decrement('photoCount', { where: { id: photo.eventId } });

            logger.info(`Foto deletada: ${id}`);

            res.json({
                success: true,
                message: 'Foto excluída com sucesso'
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get download URL for original photo (admin only, or after purchase)
     */
    async getDownloadUrl(req, res, next) {
        try {
            const { id } = req.params;

            const photo = await Photo.findByPk(id);

            if (!photo) {
                return res.status(404).json({
                    success: false,
                    message: 'Foto não encontrada'
                });
            }

            // Generate pre-signed URL (valid for 1 hour)
            const downloadUrl = await s3Service.generatePresignedUrl(
                photo.originalKey,
                'original',
                3600
            );

            res.json({
                success: true,
                data: {
                    downloadUrl,
                    expiresIn: 3600,
                    filename: photo.originalFilename
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get event photos for authenticated users (watermarked only)
     * Returns only watermarked/thumbnail URLs - never original
     */
    async getEventPhotosPublic(req, res, next) {
        try {
            const { eventId } = req.params;
            const {
                page = 1,
                limit = 50
            } = req.query;

            const offset = (parseInt(page) - 1) * parseInt(limit);

            // Verify event exists and is active
            const event = await Event.findByPk(eventId);
            if (!event) {
                return res.status(404).json({
                    success: false,
                    message: 'Evento não encontrado'
                });
            }

            // Verify user is the event owner
            if (event.createdBy !== req.userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Acesso negado. Você não é o administrador deste evento.'
                });
            }

            if (!event.isActive) {
                return res.status(403).json({
                    success: false,
                    message: 'Evento não está ativo'
                });
            }

            const { count, rows: photos } = await Photo.findAndCountAll({
                where: {
                    eventId,
                    processingStatus: 'completed'
                },
                limit: parseInt(limit),
                offset,
                order: [['createdAt', 'DESC']],
                attributes: ['id', 'eventId', 'watermarkedKey', 'thumbnailKey', 'width', 'height', 'faceCount', 'createdAt']
            });

            // Return ONLY watermarked and thumbnail presigned URLs
            const photosWithUrls = await Promise.all(photos.map(async (photo) => ({
                id: photo.id,
                eventId: photo.eventId,
                width: photo.width,
                height: photo.height,
                faceCount: photo.faceCount,
                createdAt: photo.createdAt,
                watermarkedUrl: await s3Service.generatePresignedUrl(photo.watermarkedKey, 'watermarked', 3600),
                thumbnailUrl: photo.thumbnailKey ? await s3Service.generatePresignedUrl(photo.thumbnailKey, 'watermarked', 3600) : null
            })));

            res.json({
                success: true,
                data: {
                    event: {
                        id: event.id,
                        name: event.name,
                        date: event.date,
                        location: event.location
                    },
                    photos: photosWithUrls,
                    pagination: {
                        total: count,
                        page: parseInt(page),
                        limit: parseInt(limit),
                        totalPages: Math.ceil(count / parseInt(limit))
                    }
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Retry failed processing
     */
    async retryProcessing(req, res, next) {
        try {
            const { id } = req.params;

            const photo = await Photo.findByPk(id);

            if (!photo) {
                return res.status(404).json({
                    success: false,
                    message: 'Foto não encontrada'
                });
            }

            if (!['failed', 'processing'].includes(photo.processingStatus)) {
                return res.status(400).json({
                    success: false,
                    message: 'Foto não está com status de falha ou travada'
                });
            }

            // Get original image from S3
            const imageBuffer = await s3Service.getFile(photo.originalKey, 'original');

            // Retry processing
            await photo.update({
                processingStatus: 'pending',
                processingError: null
            });

            PhotoController.processFacialRecognition(photo.id, imageBuffer).catch(err => {
                logger.error(`Erro ao reprocessar foto ${photo.id}:`, err);
            });

            res.json({
                success: true,
                message: 'Reprocessamento iniciado'
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new PhotoController();
