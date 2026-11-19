const { WithdrawalRequest, Event, User, sequelize } = require('../models');
const commissionService = require('../services/commission.service');
const { fail } = require('../services/event-access.service');
const logger = require('../utils/logger');

const TRANSITIONS = {
    pending: ['approved', 'rejected'],
    approved: ['paid', 'rejected']
};

function commissionType(req) {
    if (req.userRole === 'admin') return req.query.commissionType || 'organizer';
    if (req.userRole === 'fotografo') return 'photographer';
    if (req.userRole === 'organizador') return 'organizer';
    fail(403, 'Acesso negado');
}

class WithdrawalController {
    async getBalance(req, res, next) {
        try {
            const type = commissionType(req);
            const fields = commissionService.commissionFields(type);
            const event = await Event.findByPk(req.params.eventId);
            if (!event) fail(404, 'Evento não encontrado');
            if (req.userRole !== 'admin' && event[fields.id] !== req.userId) fail(403, 'Acesso negado a este saldo');
            if (event.approvalStatus !== 'approved') fail(409, 'Evento aguardando aprovação do administrador');
            const [balance, hasOpenRequest] = await Promise.all([
                commissionService.getEventCommissionBalance(event, type),
                commissionService.hasOpenWithdrawalRequest(event.id, type)
            ]);
            res.json({ success: true, data: { balance, hasOpenRequest, commissionType: type } });
        } catch (error) {
            next(error);
        }
    }

    async create(req, res, next) {
        try {
            if (!['fotografo', 'organizador'].includes(req.userRole)) fail(403, 'Somente o beneficiário pode solicitar seu resgate');
            const type = commissionType(req);
            const fields = commissionService.commissionFields(type);
            const { eventId, amount, notes } = req.body;
            if (!/^\d+(\.\d{1,2})?$/.test(String(amount)) || Number(amount) <= 0 || Number(amount) > 99999999.99) {
                fail(400, 'Informe um valor positivo com até duas casas decimais');
            }
            const withdrawalRequest = await sequelize.transaction(async transaction => {
                const event = await Event.findByPk(eventId, { transaction, lock: transaction.LOCK.UPDATE });
                if (!event) fail(404, 'Evento não encontrado');
                if (event[fields.id] !== req.userId) fail(403, 'Você não é o beneficiário desta comissão');
                if (event.approvalStatus !== 'approved') fail(409, 'Evento aguardando aprovação do administrador');
                const beneficiary = await User.findByPk(req.userId, { transaction });
                if (!beneficiary?.pixKey) fail(400, 'Cadastre sua chave PIX antes de solicitar um resgate');
                if (await commissionService.hasOpenWithdrawalRequest(eventId, type, { transaction })) {
                    fail(400, 'Já existe uma solicitação de resgate em aberto para esta comissão');
                }
                const balance = await commissionService.getEventCommissionBalance(event, type, { transaction });
                if (Math.round(Number(amount) * 100) > Math.round(balance.availableBalance * 100)) {
                    fail(400, `Valor solicitado excede o saldo disponível (R$ ${balance.availableBalance.toFixed(2)})`);
                }
                return WithdrawalRequest.create({
                    eventId,
                    organizerId: type === 'organizer' ? req.userId : null,
                    photographerId: type === 'photographer' ? req.userId : null,
                    amount: Number(amount),
                    notes,
                    pixKey: beneficiary.pixKey,
                    status: 'pending'
                }, { transaction });
            });
            logger.info(`Solicitação de resgate criada: ${withdrawalRequest.id} - evento ${eventId} - ${type} ${req.userId}`);
            res.status(201).json({
                success: true,
                message: 'Solicitação de resgate criada com sucesso',
                data: { withdrawalRequest }
            });
        } catch (error) {
            next(error);
        }
    }

    async getAll(req, res, next) {
        try {
            const where = {};
            if (req.query.status) where.status = req.query.status;
            if (req.userRole !== 'admin') {
                const fields = commissionService.commissionFields(commissionType(req));
                where[fields.id] = req.userId;
            }
            const withdrawalRequests = await WithdrawalRequest.findAll({
                where,
                include: [
                    { model: Event, as: 'event', attributes: ['id', 'name', 'date'] },
                    { model: User, as: 'organizer', attributes: ['id', 'name', 'email', 'pixKey'] },
                    { model: User, as: 'photographer', attributes: ['id', 'name', 'email', 'pixKey'] }
                ],
                order: [['createdAt', 'DESC']]
            });
            res.json({ success: true, data: { withdrawalRequests } });
        } catch (error) {
            next(error);
        }
    }

    async updateStatus(req, res, next) {
        try {
            const { id } = req.params;
            const { status, adminNotes } = req.body;
            const reference = await WithdrawalRequest.findByPk(id, { attributes: ['eventId'] });
            if (!reference) fail(404, 'Solicitação de resgate não encontrada');
            const withdrawalRequest = await sequelize.transaction(async transaction => {
                await Event.findByPk(reference.eventId, { transaction, lock: transaction.LOCK.UPDATE });
                const current = await WithdrawalRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
                if (!current) fail(404, 'Solicitação de resgate não encontrada');
                if (!(TRANSITIONS[current.status] || []).includes(status)) {
                    fail(400, `Transição de status inválida: ${current.status} → ${status}`);
                }
                return current.update({ status, adminNotes, processedBy: req.userId, processedAt: new Date() }, { transaction });
            });
            logger.info(`Solicitação de resgate ${id} atualizada para status=${status} por ${req.userId}`);
            res.json({ success: true, message: 'Solicitação de resgate atualizada com sucesso', data: { withdrawalRequest } });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new WithdrawalController();
