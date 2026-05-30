const { Photo, Event, Order, OrderItem, sequelize } = require('../models');
const { Op, fn, col, literal, QueryTypes } = require('sequelize');
const rekognitionService = require('../services/rekognition.service');
const s3Service = require('../services/s3.service');
const logger = require('../utils/logger');

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function basenameWithoutExt(value) {
    if (!value) return null;
    return value.split('/').pop().replace(/\.[^.]+$/, '');
}

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

            const externalImageIds = [...new Set(searchResult.matches.map(match => match.externalImageId).filter(Boolean))];
            const photoIds = externalImageIds.filter(id => uuidRegex.test(id));

            const matchConditions = externalImageIds.flatMap(externalImageId => ([
                { originalKey: { [Op.like]: `%/${externalImageId}.%` } },
                { originalFilename: { [Op.like]: `${externalImageId}.%` } }
            ]));

            if (photoIds.length > 0) {
                matchConditions.push({ id: { [Op.in]: photoIds } });
            }

            // Get photos from database
            const photos = await Photo.findAll({
                where: {
                    [Op.or]: matchConditions,
                    processingStatus: 'completed'
                },
                include: [
                    {
                        model: Event,
                        as: 'event',
                        attributes: ['id', 'name', 'date', 'location', 'pricePerPhoto', 'pricingPackages', 'allPhotosPrice'],
                        where: { isActive: true },
                        required: true
                    }
                ],
                attributes: { exclude: ['faceData'] }
            });

            // Map similarity scores to photos and generate signed URLs
            const photosWithSimilarity = await Promise.all(photos.map(async (photo) => {
                const externalImageIdCandidates = [
                    photo.id,
                    basenameWithoutExt(photo.originalKey),
                    basenameWithoutExt(photo.originalFilename)
                ].filter(Boolean);
                const match = searchResult.matches.find(m => externalImageIdCandidates.includes(m.externalImageId));

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

            const safePage  = Math.max(parseInt(page)  || 1,  1);
            const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 100);
            const offset = (safePage - 1) * safeLimit;

            const where = {
                eventId,
                processingStatus: 'completed'
            };

            if (hasFaces === 'true') {
                where.faceCount = { [Op.gt]: 0 };
            }

            const { count, rows: photos } = await Photo.findAndCountAll({
                where,
                limit: safeLimit,
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
                        page: safePage,
                        limit: safeLimit,
                        totalPages: Math.ceil(count / safeLimit)
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
            const isPhotografo = req.userRole === 'fotografo';

            // Fotografo: scope to their own events
            if (isPhotografo) {
                const myEvents = await Event.findAll({
                    where: { createdBy: req.userId },
                    attributes: ['id'],
                    raw: true
                });
                const eventIds = myEvents.map(e => e.id);

                if (eventIds.length === 0) {
                    return res.json({
                        success: true,
                        data: { totalPhotos: 0, photosWithFaces: 0, totalEvents: 0, totalFaces: 0, totalPhotosSold: 0, totalRevenue: '0.00' }
                    });
                }

                const photoWhere = { processingStatus: 'completed', eventId: { [Op.in]: eventIds } };

                const [totalPhotos, photosWithFaces, totalFaces, salesRow] = await Promise.all([
                    Photo.count({ where: photoWhere }),
                    Photo.count({ where: { ...photoWhere, faceCount: { [Op.gt]: 0 } } }),
                    Photo.sum('faceCount', { where: photoWhere }),
                    sequelize.query(
                        `SELECT COUNT(oi.id)::int AS photos_sold, COALESCE(SUM(oi.price), 0) AS revenue
                         FROM order_items oi
                         INNER JOIN orders o ON o.id = oi."orderId"
                         INNER JOIN photos p ON p.id = oi."photoId"
                         WHERE o.status IN ('paid', 'completed') AND p."eventId" IN (:eventIds)`,
                        { replacements: { eventIds }, type: QueryTypes.SELECT }
                    )
                ]);

                return res.json({
                    success: true,
                    data: {
                        totalPhotos,
                        photosWithFaces,
                        totalEvents: eventIds.length,
                        totalFaces: totalFaces || 0,
                        totalPhotosSold: salesRow[0]?.photos_sold || 0,
                        totalRevenue: parseFloat(salesRow[0]?.revenue || 0).toFixed(2)
                    }
                });
            }

            // Admin: global stats
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
            const isPhotografo = req.userRole === 'fotografo';

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

            // Fotografo: scope to their own events
            if (isPhotografo) {
                const myEvents = await Event.findAll({
                    where: { createdBy: req.userId },
                    attributes: ['id'],
                    raw: true
                });
                const eventIds = myEvents.map(e => e.id);

                if (eventIds.length === 0) {
                    return res.json({ success: true, data: { sales: [], groupBy, period: startDate && endDate ? 'custom' : period } });
                }

                const months = parseInt(period) || 12;
                const dateFilter = startDate && endDate
                    ? `o."paidAt" BETWEEN :startDate AND :endDate`
                    : `o."paidAt" >= NOW() - INTERVAL '${months} months'`;

                const salesData = await sequelize.query(
                    `SELECT TO_CHAR(o."paidAt", :dateFormat) AS period,
                            SUM(oi.price) AS revenue,
                            COUNT(DISTINCT o.id)::int AS "ordersCount"
                     FROM order_items oi
                     INNER JOIN orders o ON o.id = oi."orderId"
                     INNER JOIN photos p ON p.id = oi."photoId"
                     WHERE o.status IN ('paid', 'completed')
                       AND o."paidAt" IS NOT NULL
                       AND ${dateFilter}
                       AND p."eventId" IN (:eventIds)
                     GROUP BY TO_CHAR(o."paidAt", :dateFormat)
                     ORDER BY TO_CHAR(o."paidAt", :dateFormat) ASC`,
                    {
                        replacements: { dateFormat, eventIds, startDate: startDate || null, endDate: endDate || null },
                        type: QueryTypes.SELECT
                    }
                );

                return res.json({
                    success: true,
                    data: {
                        sales: salesData.map(sale => ({
                            period: sale.period,
                            revenue: parseFloat(sale.revenue).toFixed(2),
                            ordersCount: sale.ordersCount
                        })),
                        groupBy,
                        period: startDate && endDate ? 'custom' : period
                    }
                });
            }

            // Admin: global stats
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
                    [fn('SUM', col('totalAmount')), 'revenue'],
                    [fn('COUNT', col('id')), 'ordersCount']
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
                        revenue: parseFloat(sale.revenue).toFixed(2),
                        ordersCount: parseInt(sale.ordersCount, 10)
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
