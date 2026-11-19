'use strict';

const { Op } = require('sequelize');

function fail(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
}

function eventScope(req) {
    if (req.userRole === 'admin') return {};
    if (req.userRole === 'organizador') return { organizerId: req.userId };
    if (req.userRole === 'fotografo') {
        return { [Op.or]: [{ createdBy: req.userId }, { photographerId: req.userId }] };
    }
    fail(403, 'Acesso negado ao evento');
}

function assertEventAccess(req, event, operational = false) {
    if (!event) fail(404, 'Evento não encontrado');
    const allowed = req.userRole === 'admin'
        || (req.userRole === 'fotografo' && (event.createdBy === req.userId || event.photographerId === req.userId))
        || (!operational && req.userRole === 'organizador' && event.organizerId === req.userId);
    if (!allowed) fail(403, 'Acesso negado ao evento');
    if (operational && event.approvalStatus !== 'approved') {
        fail(409, 'Evento aguardando aprovação do administrador');
    }
}

function isEventAvailable(event) {
    return Boolean(event && event.approvalStatus === 'approved' && event.isActive && !event.archivedAt);
}

module.exports = { eventScope, assertEventAccess, isEventAvailable, fail };
