const { Event, Photo, User, sequelize } = require('../models');
const { Op, QueryTypes } = require('sequelize');
const logger = require('../utils/logger');
const { validateVideoPricing } = require('../services/video-pricing.service');
const { eventScope, assertEventAccess, fail } = require('../services/event-access.service');
const { validateEventCommissions, calculateCommissionBalance } = require('../services/commission.service');

const commissionKeys = ['organizerId', 'organizerCommissionPercentage', 'photographerId', 'photographerCommissionPercentage'];

function eventChanges(body, current) {
    const data = {};
    for (const key of ['name', 'date', 'description', 'location', 'isActive', 'pricePerPhoto', 'pricingPackages', 'allPhotosPrice']) {
        if (body[key] !== undefined) data[key] = body[key];
    }
    if (body.freePhotosCount !== undefined) data.freePhotosCount = clampFreePhotosCount(body.freePhotosCount);
    try {
        Object.assign(data, videoPricingFields(body, current));
    } catch (error) {
        fail(400, error.message);
    }
    return data;
}

function videoPricingFields(body, current = {}) {
    const fields = {
        videoEnabled: current.videoEnabled ?? false,
        pricePerVideo: current.pricePerVideo ?? null,
        videoPricingPackages: current.videoPricingPackages ?? null,
        allVideosPrice: current.allVideosPrice ?? null,
        freeVideosCount: current.freeVideosCount ?? 0
    };
    for (const field of Object.keys(fields)) {
        if (body[field] !== undefined) fields[field] = body[field];
    }
    validateVideoPricing(fields);
    return fields;
}

// Clampa entre 0 e 3; preserva undefined para não sobrescrever em updates parciais
function clampFreePhotosCount(value) {
    if (value === undefined) return undefined;
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) return 0;
    return Math.min(Math.max(parsed, 0), 3);
}

// Computes revenue/paid orders/requested amount for the given events in 2 batched
// queries (instead of correlated subqueries evaluated per event row).
async function attachSalesMetrics(events) {
    if (events.length === 0) return;
    const eventIds = events.map(e => e.id);

    const [salesRows, withdrawalRows] = await Promise.all([
        sequelize.query(
            `
            WITH event_orders AS (
                SELECT p."eventId", o.id AS "orderId", o."totalAmount", SUM(oi.price) AS "eventPrice"
                FROM photos p
                INNER JOIN order_items oi ON oi."photoId" = p.id
                INNER JOIN orders o ON o.id = oi."orderId"
                WHERE p."eventId" IN (:eventIds)
                AND o.status IN ('paid', 'completed')
                GROUP BY p."eventId", o.id, o."totalAmount"
            ),
            order_totals AS (
                SELECT oi."orderId", SUM(oi.price) AS "orderPrice"
                FROM order_items oi
                WHERE oi."orderId" IN (SELECT DISTINCT "orderId" FROM event_orders)
                GROUP BY oi."orderId"
            )
            SELECT eo."eventId",
                COUNT(*) AS "paidOrdersCount",
                COALESCE(SUM(eo."totalAmount" * eo."eventPrice" / NULLIF(ot."orderPrice", 0)), 0) AS "totalRevenue"
            FROM event_orders eo
            INNER JOIN order_totals ot ON ot."orderId" = eo."orderId"
            GROUP BY eo."eventId"
            `,
            { replacements: { eventIds }, type: QueryTypes.SELECT }
        ),
        sequelize.query(
            `
            SELECT "eventId",
                COALESCE(SUM(CASE WHEN "organizerId" IS NOT NULL THEN amount ELSE 0 END), 0) AS "requestedAmount",
                COALESCE(SUM(CASE WHEN "photographerId" IS NOT NULL THEN amount ELSE 0 END), 0) AS "photographerRequestedAmount"
            FROM withdrawal_requests
            WHERE "eventId" IN (:eventIds)
            AND status IN ('pending', 'approved', 'paid')
            GROUP BY "eventId"
            `,
            { replacements: { eventIds }, type: QueryTypes.SELECT }
        )
    ]);

    const sales = new Map(salesRows.map(r => [r.eventId, r]));
    const withdrawals = new Map(withdrawalRows.map(r => [r.eventId, r]));

    for (const event of events) {
        const sale = sales.get(event.id);
        event.setDataValue('totalRevenue', sale ? sale.totalRevenue : '0');
        event.setDataValue('paidOrdersCount', sale ? sale.paidOrdersCount : '0');
        event.setDataValue('requestedAmount', withdrawals.get(event.id)?.requestedAmount ?? '0');
        event.setDataValue('photographerRequestedAmount', withdrawals.get(event.id)?.photographerRequestedAmount ?? '0');
        event.setDataValue('organizerBalance', calculateCommissionBalance(sale?.totalRevenue || 0, event.organizerCommissionPercentage, withdrawals.get(event.id)?.requestedAmount));
        event.setDataValue('photographerBalance', calculateCommissionBalance(sale?.totalRevenue || 0, event.photographerCommissionPercentage, withdrawals.get(event.id)?.photographerRequestedAmount));
    }
}

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
                approvalStatus,
                includeArchived,
                startDate,
                endDate,
                sortBy = 'date',
                sortOrder = 'DESC'
            } = req.query;

            const safePage  = Math.max(parseInt(page)  || 1,  1);
            const safeLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
            const offset = (safePage - 1) * safeLimit;

            // Build where clause
            const where = {};
            where[Op.and] = [eventScope(req)];
            if (approvalStatus !== undefined) where.approvalStatus = approvalStatus;

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

            // Archived events are hidden unless explicitly requested
            if (includeArchived !== 'true') {
                where.archivedAt = null;
            }

            if (startDate || endDate) {
                where.date = {};
                if (startDate) where.date[Op.gte] = new Date(startDate);
                if (endDate) where.date[Op.lte] = new Date(endDate);
            }

            const { count, rows: events } = await Event.findAndCountAll({
                where,
                limit: safeLimit,
                offset,
                order: [[sortBy, sortOrder]],
                include: [
                    {
                        model: User,
                        as: 'creator',
                        attributes: ['id', 'name', 'email']
                    },
                    {
                        model: User,
                        as: 'organizer',
                        attributes: ['id', 'name', 'email']
                    },
                    {
                        model: User,
                        as: 'photographer',
                        attributes: ['id', 'name', 'email']
                    }
                ]
            });

            await attachSalesMetrics(events);

            res.json({
                success: true,
                data: {
                    events,
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
                    },
                    {
                        model: User,
                        as: 'organizer',
                        attributes: ['id', 'name', 'email']
                    },
                    {
                        model: User,
                        as: 'photographer',
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

            assertEventAccess(req, event);

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
            const isPhotographer = req.userRole === 'fotografo';
            const commissions = await validateEventCommissions({
                ...req.body,
                ...(isPhotographer && { photographerId: req.userId })
            }, {}, { requirePercentages: true });
            const event = await Event.create({
                ...eventChanges(req.body),
                ...commissions,
                createdBy: req.userId,
                approvalStatus: isPhotographer ? 'pending' : 'approved',
                isActive: !isPhotographer,
                approvedBy: isPhotographer ? null : req.userId,
                approvedAt: isPhotographer ? null : new Date()
            });

            logger.info(`Evento criado: ${event.id} - ${event.name}`);

            res.status(201).json({
                success: true,
                message: isPhotographer ? 'Evento enviado para aprovação do administrador' : 'Evento criado com sucesso',
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
            if (['approvalStatus', 'approvedBy', 'approvedAt'].some(key => req.body[key] !== undefined)) {
                fail(400, 'Utilize a ação de aprovação do evento');
            }
            const changesCommissions = commissionKeys.some(key => req.body[key] !== undefined);
            if (req.userRole !== 'admin' && changesCommissions) fail(403, 'Somente o administrador pode alterar comissões');
            const event = await sequelize.transaction(async transaction => {
                const current = await Event.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
                assertEventAccess(req, current, req.userRole !== 'admin');
                if (current.archivedAt) fail(409, 'Evento arquivado não pode ser editado');
                if (current.approvalStatus !== 'approved' && [true, 'true'].includes(req.body.isActive)) {
                    fail(409, 'Aprove o evento antes de ativá-lo');
                }
                const data = eventChanges(req.body, current);
                if (changesCommissions) Object.assign(data, await validateEventCommissions(req.body, current, { transaction }));
                return current.update(data, { transaction });
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

    async approve(req, res, next) {
        try {
            if (req.userRole !== 'admin') fail(403, 'Somente o administrador pode aprovar eventos');
            const event = await sequelize.transaction(async transaction => {
                const current = await Event.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
                if (!current) fail(404, 'Evento não encontrado');
                if (current.archivedAt || current.approvalStatus !== 'pending') {
                    fail(409, 'Somente eventos pendentes e não arquivados podem ser aprovados');
                }
                const commissions = await validateEventCommissions(req.body, current, { requirePercentages: true, transaction });
                return current.update({
                    ...eventChanges(req.body, current),
                    ...commissions,
                    approvalStatus: 'approved',
                    isActive: true,
                    approvedBy: req.userId,
                    approvedAt: new Date()
                }, { transaction });
            });
            logger.info(`Evento aprovado: ${event.id} por ${req.userId}`);
            res.json({ success: true, message: 'Evento aprovado e liberado', data: { event } });
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

            assertEventAccess(req, event, req.userRole !== 'admin');
            if (event.archivedAt) {
                return res.status(409).json({
                    success: false,
                    message: 'Evento arquivado não pode ser excluído'
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

            assertEventAccess(req, event);

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
