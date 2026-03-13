const { Event, Photo, User } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

class EventController {
    /**
     * Get all events with pagination and filters
     */
    async getAll(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                search = '',
                isActive,
                startDate,
                endDate,
                sortBy = 'date',
                sortOrder = 'DESC'
            } = req.query;

            const offset = (parseInt(page) - 1) * parseInt(limit);

            // Build where clause
            const where = {};

            if (search) {
                where[Op.or] = [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { description: { [Op.iLike]: `%${search}%` } },
                    { location: { [Op.iLike]: `%${search}%` } }
                ];
            }

            if (isActive !== undefined) {
                where.isActive = isActive === 'true';
            }

            if (startDate || endDate) {
                where.date = {};
                if (startDate) where.date[Op.gte] = new Date(startDate);
                if (endDate) where.date[Op.lte] = new Date(endDate);
            }

            const { count, rows: events } = await Event.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset,
                order: [[sortBy, sortOrder]],
                include: [
                    {
                        model: User,
                        as: 'creator',
                        attributes: ['id', 'name', 'email']
                    }
                ]
            });

            res.json({
                success: true,
                data: {
                    events,
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
     * Get event by ID
     */
    async getById(req, res, next) {
        try {
            const { id } = req.params;

            const event = await Event.findByPk(id, {
                include: [
                    {
                        model: User,
                        as: 'creator',
                        attributes: ['id', 'name', 'email']
                    }
                ]
            });

            if (!event) {
                return res.status(404).json({
                    success: false,
                    message: 'Evento não encontrado'
                });
            }

            res.json({
                success: true,
                data: { event }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Create new event
     */
    async create(req, res, next) {
        try {
            const {
                name,
                date,
                description,
                location,
                pricePerPhoto,
                pricingPackages,
                allPhotosPrice
            } = req.body;
            const createdBy = req.userId;

            const event = await Event.create({
                name,
                date,
                description,
                location,
                createdBy,
                pricePerPhoto,
                pricingPackages,
                allPhotosPrice
            });

            logger.info(`Evento criado: ${event.id} - ${event.name}`);

            res.status(201).json({
                success: true,
                message: 'Evento criado com sucesso',
                data: { event }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Update event
     */
    async update(req, res, next) {
        try {
            const { id } = req.params;
            const {
                name,
                date,
                description,
                location,
                isActive,
                pricePerPhoto,
                pricingPackages,
                allPhotosPrice
            } = req.body;

            const event = await Event.findByPk(id);

            if (!event) {
                return res.status(404).json({
                    success: false,
                    message: 'Evento não encontrado'
                });
            }

            await event.update({
                name,
                date,
                description,
                location,
                isActive,
                pricePerPhoto,
                pricingPackages,
                allPhotosPrice
            });

            logger.info(`Evento atualizado: ${event.id} - ${event.name}`);

            res.json({
                success: true,
                message: 'Evento atualizado com sucesso',
                data: { event }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Delete event
     */
    async delete(req, res, next) {
        try {
            const { id } = req.params;

            const event = await Event.findByPk(id);

            if (!event) {
                return res.status(404).json({
                    success: false,
                    message: 'Evento não encontrado'
                });
            }

            // Check if event has photos
            const photoCount = await Photo.count({ where: { eventId: id } });

            if (photoCount > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Não é possível excluir evento com ${photoCount} foto(s) associada(s). Exclua as fotos primeiro.`
                });
            }

            await event.destroy();

            logger.info(`Evento deletado: ${id}`);

            res.json({
                success: true,
                message: 'Evento excluído com sucesso'
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get event statistics
     */
    async getStatistics(req, res, next) {
        try {
            const { id } = req.params;

            const event = await Event.findByPk(id);

            if (!event) {
                return res.status(404).json({
                    success: false,
                    message: 'Evento não encontrado'
                });
            }

            const photos = await Photo.findAll({
                where: { eventId: id },
                attributes: ['processingStatus', 'faceCount']
            });

            const stats = {
                totalPhotos: photos.length,
                processingStatuses: {
                    completed: photos.filter(p => p.processingStatus === 'completed').length,
                    processing: photos.filter(p => p.processingStatus === 'processing').length,
                    pending: photos.filter(p => p.processingStatus === 'pending').length,
                    failed: photos.filter(p => p.processingStatus === 'failed').length
                },
                totalFaces: photos.reduce((sum, p) => sum + (p.faceCount || 0), 0),
                photosWithFaces: photos.filter(p => p.faceCount > 0).length
            };

            res.json({
                success: true,
                data: { event, statistics: stats }
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new EventController();
