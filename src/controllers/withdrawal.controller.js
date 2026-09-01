const { WithdrawalRequest, Event, User } = require('../models');
const commissionService = require('../services/commission.service');
const logger = require('../utils/logger');

const TRANSITIONS = {
    pending: ['approved', 'rejected'],
    approved: ['paid', 'rejected']
};

class WithdrawalController {
    /**
     * Balance/summary for an event's organizer commission.
     * Admin can view any event; organizador only their own.
     */
    async getBalance(req, res, next) {
        try {
            const { eventId } = req.params;

            const event = await Event.findByPk(eventId);
            if (!event) {
                return res.status(404).json({
                    success: false,
                    message: 'Evento não encontrado'
                });
            }

            if (req.userRole === 'organizador' && event.organizerId !== req.userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Acesso negado a este evento'
                });
            }

            const balance = await commissionService.getOrganizerEventBalance(event);
            const hasOpenRequest = await commissionService.hasOpenWithdrawalRequest(eventId);

            res.json({
                success: true,
                data: { balance, hasOpenRequest }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Organizador creates a withdrawal request for an event they're assigned to.
     */
    async create(req, res, next) {
        try {
            const { eventId, amount, notes } = req.body;

            const event = await Event.findByPk(eventId);
            if (!event) {
                return res.status(404).json({
                    success: false,
                    message: 'Evento não encontrado'
                });
            }

            if (event.organizerId !== req.userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Você não é o organizador deste evento'
                });
            }

            const hasOpenRequest = await commissionService.hasOpenWithdrawalRequest(eventId);
            if (hasOpenRequest) {
                return res.status(400).json({
                    success: false,
                    message: 'Já existe uma solicitação de resgate em aberto para este evento'
                });
            }

            const balance = await commissionService.getOrganizerEventBalance(event);
            const requestedAmount = parseFloat(amount);

            if (requestedAmount > balance.availableBalance) {
                return res.status(400).json({
                    success: false,
                    message: `Valor solicitado excede o saldo disponível (R$ ${balance.availableBalance.toFixed(2)})`
                });
            }

            const withdrawalRequest = await WithdrawalRequest.create({
                eventId,
                organizerId: req.userId,
                amount: requestedAmount,
                notes,
                status: 'pending'
            });

            logger.info(`Solicitação de resgate criada: ${withdrawalRequest.id} - evento ${eventId} - organizador ${req.userId}`);

            res.status(201).json({
                success: true,
                message: 'Solicitação de resgate criada com sucesso',
                data: { withdrawalRequest }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * List withdrawal requests. Admin sees all (optional ?status= filter),
     * organizador sees only their own.
     */
    async getAll(req, res, next) {
        try {
            const { status } = req.query;

            const where = {};
            if (status) where.status = status;
            if (req.userRole === 'organizador') where.organizerId = req.userId;

            const withdrawalRequests = await WithdrawalRequest.findAll({
                where,
                include: [
                    {
                        model: Event,
                        as: 'event',
                        attributes: ['id', 'name', 'date']
                    },
                    {
                        model: User,
                        as: 'organizer',
                        attributes: ['id', 'name', 'email']
                    }
                ],
                order: [['createdAt', 'DESC']]
            });

            res.json({
                success: true,
                data: { withdrawalRequests }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Admin approves/rejects/marks a withdrawal request as paid.
     */
    async updateStatus(req, res, next) {
        try {
            const { id } = req.params;
            const { status, adminNotes } = req.body;

            const withdrawalRequest = await WithdrawalRequest.findByPk(id);
            if (!withdrawalRequest) {
                return res.status(404).json({
                    success: false,
                    message: 'Solicitação de resgate não encontrada'
                });
            }

            const allowedNextStatuses = TRANSITIONS[withdrawalRequest.status] || [];
            if (!allowedNextStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `Transição de status inválida: ${withdrawalRequest.status} → ${status}`
                });
            }

            await withdrawalRequest.update({
                status,
                adminNotes,
                processedBy: req.userId,
                processedAt: new Date()
            });

            logger.info(`Solicitação de resgate ${id} atualizada para status=${status} por ${req.userId}`);

            res.json({
                success: true,
                message: 'Solicitação de resgate atualizada com sucesso',
                data: { withdrawalRequest }
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new WithdrawalController();
