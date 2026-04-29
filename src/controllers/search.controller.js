const { Photo, Event, Order, OrderItem } = require('../models');
const { Op, fn, col, literal } = require('sequelize');
const rekognitionService = require('../services/rekognition.service');
const s3Service = require('../services/s3.service');
const logger = require('../utils/logger');

class SearchController {
    /**
     * Search photos by facial recognition
     */
    async searchByFace(req, res, next) {
        try {
            const file = req.file;

            if (!file) {
                return res.status(400).json({
                    success: false,
                    message: 'Nenhuma imagem enviada'
                });
            }

            logger.info('Iniciando busca facial');

            // Search for matching faces in Rekognition
            const searchResult = await rekognitionService.searchFacesByImage(file.buffer, 4096);

            if (searchResult.matchCount === 0) {
                return res.json({
                    success: true,
                    message: 'Nenhuma foto encontrada',
                    data: {
                        photos: [],
                        matchCount: 0,
                        searchedFaceDetected: searchResult.searchedFaceConfidence > 0
                    }
                });
            }

            // Extract filenames from external image IDs (Lambda uses filename as externalImageId)
            const filenameIds = searchResult.matches.map(match => match.externalImageId);

            // Build originalKey patterns to match against DB (key ends with /<externalImageId>.jpg/jpeg/png)
            const originalKeyConditions = filenameIds.map(fid => ({
                originalKey: { [Op.like]: `%/${fid}.%` }
            }));

            // Get photos from database
            const photos = await Photo.findAll({
                where: {
                    [Op.or]: originalKeyConditions,
                    processingStatus: 'completed'
                },
                include: [
                    {
                        model: Event,
                        as: 'event',
                        attributes: ['id', 'name', 'date', 'location', 'pricePerPhoto', 'pricingPackages', 'allPhotosPrice']
                    }
                ],
                attributes: { exclude: ['faceData'] }
            });

            // Map similarity scores to photos and generate signed URLs
            const photosWithSimilarity = await Promise.all(photos.map(async (photo) => {
                const fileBasename = photo.originalKey.split('/').pop().replace(/\.[^.]+$/, '');
                const match = searchResult.matches.find(m => m.externalImageId === fileBasename);

                // Generate pre-signed URLs (valid for 1 hour)
                const watermarkedUrl = await s3Service.generatePresignedUrl(photo.watermarkedKey, 'watermarked', 3600);

                return {
                    id: photo.id,
                    eventId: photo.eventId,
                    event: photo.event,
                    width: photo.width,
                    height: photo.height,
                    faceCount: photo.faceCount,
                    originalFilename: photo.originalFilename,
                    createdAt: photo.createdAt,
                    similarity: match?.similarity || 0,
                    watermarkedUrl
                };
            }));

            // Sort by similarity (highest first)
            photosWithSimilarity.sort((a, b) => b.similarity - a.similarity);

            logger.info(`Busca facial concluída: ${photosWithSimilarity.length} fotos encontradas`);

            res.json({
                success: true,
                message: `${photosWithSimilarity.length} foto(s) encontrada(s)`,
                data: {
                    photos: photosWithSimilarity,
                    matchCount: photosWithSimilarity.length,
                    searchedFaceDetected: true,
                    searchedFaceConfidence: searchResult.searchedFaceConfidence
                }
            });
        } catch (error) {
            if (error.message.includes('Nenhuma face detectada')) {
                return res.status(400).json({
                    success: false,
                    message: 'Nenhuma face detectada na imagem enviada. Por favor, envie uma foto com seu rosto visível.'
                });
            }
            next(error);
        }
    }

    /**
     * Search photos by event
     */
    async searchByEvent(req, res, next) {
        try {
            const { eventId } = req.params;
            const {
                page = 1,
                limit = 50,
                hasFaces
            } = req.query;

            const offset = (parseInt(page) - 1) * parseInt(limit);

            const where = {
                eventId,
                processingStatus: 'completed'
            };

            if (hasFaces === 'true') {
                where.faceCount = { [Op.gt]: 0 };
            }

            const { count, rows: photos } = await Photo.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset,
                order: [['createdAt', 'DESC']],
                attributes: { exclude: ['faceData'] }
            });

            const photosWithUrls = await Promise.all(photos.map(async (photo) => ({
                id: photo.id,
                eventId: photo.eventId,
                width: photo.width,
                height: photo.height,
                faceCount: photo.faceCount,
                originalFilename: photo.originalFilename,
                createdAt: photo.createdAt,
                watermarkedUrl: await s3Service.generatePresignedUrl(photo.watermarkedKey, 'watermarked', 3600)
            })));

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
     * Get search statistics
     */
    async getStatistics(req, res, next) {
        try {
            const totalPhotos = await Photo.count({
                where: { processingStatus: 'completed' }
            });

            const photosWithFaces = await Photo.count({
                where: {
                    processingStatus: 'completed',
                    faceCount: { [Op.gt]: 0 }
                }
            });

            const totalEvents = await Event.count({
                where: { isActive: true }
            });

            const totalFaces = await Photo.sum('faceCount', {
                where: { processingStatus: 'completed' }
            });

            // Sales statistics
            const totalPhotosSold = await OrderItem.count({
                include: [{
                    model: Order,
                    as: 'order',
                    where: {
                        status: { [Op.in]: ['paid', 'completed'] }
                    }
                }]
            });

            const totalRevenue = await Order.sum('totalAmount', {
                where: {
                    status: { [Op.in]: ['paid', 'completed'] }
                }
            });

            res.json({
                success: true,
                data: {
                    totalPhotos,
                    photosWithFaces,
                    totalEvents,
                    totalFaces: totalFaces || 0,
                    totalPhotosSold: totalPhotosSold || 0,
                    totalRevenue: parseFloat(totalRevenue || 0).toFixed(2)
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get sales statistics with filters
     */
    async getSalesStatistics(req, res, next) {
        try {
            const { period = '12', groupBy = 'month', startDate, endDate } = req.query;

            let dateFormat, dateFormatLabel;
            switch (groupBy) {
                case 'day':
                    dateFormat = 'YYYY-MM-DD';
                    dateFormatLabel = 'DD/MM/YYYY';
                    break;
                case 'year':
                    dateFormat = 'YYYY';
                    dateFormatLabel = 'YYYY';
                    break;
                case 'month':
                default:
                    dateFormat = 'YYYY-MM';
                    dateFormatLabel = 'MM/YYYY';
                    break;
            }

            // Build where clause for date range
            const whereClause = {
                status: { [Op.in]: ['paid', 'completed'] },
                paidAt: { [Op.ne]: null }
            };

            if (startDate && endDate) {
                // Custom date range
                whereClause.paidAt = {
                    [Op.between]: [new Date(startDate), new Date(endDate)]
                };
            } else {
                // Predefined period (last N months)
                const months = parseInt(period) || 12;
                whereClause.paidAt[Op.gte] = literal(`NOW() - INTERVAL '${months} months'`);
            }

            const salesData = await Order.findAll({
                attributes: [
                    [fn('TO_CHAR', col('paidAt'), dateFormat), 'period'],
                    [fn('SUM', col('totalAmount')), 'revenue']
                ],
                where: whereClause,
                group: [fn('TO_CHAR', col('paidAt'), dateFormat)],
                order: [[fn('TO_CHAR', col('paidAt'), dateFormat), 'ASC']],
                raw: true
            });

            res.json({
                success: true,
                data: {
                    sales: salesData.map(sale => ({
                        period: sale.period,
                        revenue: parseFloat(sale.revenue).toFixed(2)
                    })),
                    groupBy,
                    period: startDate && endDate ? 'custom' : period
                }
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new SearchController();
