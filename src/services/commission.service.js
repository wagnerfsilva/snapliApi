'use strict';

const { sequelize, User } = require('../models');
const { QueryTypes } = require('sequelize');
const { fail } = require('./event-access.service');

const OPEN_STATUSES = ['pending', 'approved'];
const RESERVED_OR_PAID_STATUSES = ['pending', 'approved', 'paid'];
const COMMISSION_TYPES = {
    organizer: { id: 'organizerId', percentage: 'organizerCommissionPercentage', role: 'organizador' },
    photographer: { id: 'photographerId', percentage: 'photographerCommissionPercentage', role: 'fotografo' }
};

function commissionFields(type) {
    if (!Object.hasOwn(COMMISSION_TYPES, type)) fail(400, 'Tipo de comissão inválido');
    return COMMISSION_TYPES[type];
}

async function validateEventCommissions(body, current = {}, { requirePercentages = false, transaction } = {}) {
    const data = {};
    for (const fields of Object.values(COMMISSION_TYPES)) {
        const id = body[fields.id] !== undefined ? body[fields.id] : current[fields.id] ?? null;
        const percentage = body[fields.percentage] !== undefined ? body[fields.percentage] : current[fields.percentage] ?? null;
        const changed = body[fields.id] !== undefined || body[fields.percentage] !== undefined;
        data[fields.id] = id || null;
        data[fields.percentage] = id ? percentage : null;
        if (!id) {
            if (body[fields.percentage] != null) fail(400, 'Selecione o beneficiário da comissão');
            continue;
        }
        if (percentage !== null || changed || requirePercentages) {
            if (!/^\d{1,3}(\.\d{1,2})?$/.test(String(percentage)) || Number(percentage) > 100) {
                fail(400, 'Informe a comissão entre 0 e 100, com até duas casas decimais');
            }
        }
        if (requirePercentages || id !== current[fields.id]) {
            const user = await User.findByPk(id, { transaction });
            if (!user || !user.isActive || user.role !== fields.role) {
                fail(400, `Selecione um usuário ativo com perfil ${fields.role}`);
            }
        }
    }
    const total = Object.values(COMMISSION_TYPES).reduce((sum, fields) => (
        sum + Math.round(Number(data[fields.percentage] || 0) * 100)
    ), 0);
    if (total > 10000) fail(400, 'A soma das comissões não pode ultrapassar 100%');
    return data;
}

/**
 * Aggregate sales summary for an event (paid/completed orders only).
 * Independent from the totalRevenue query in event.controller.js#getAll —
 * kept separate on purpose so that listing behavior stays unchanged.
 */
async function getEventSalesSummary(eventId, { transaction } = {}) {
    const [row] = await sequelize.query(
        `
        SELECT
            COUNT(*) AS "totalOrders",
            COALESCE(SUM(sub."eventRevenue"), 0) AS "totalRevenue",
            COALESCE(SUM(sub."itemCount"), 0) AS "totalPhotosSold"
        FROM (
            SELECT o.id AS "orderId",
                o."totalAmount" * SUM(oi.price) / NULLIF((
                    SELECT SUM(all_items.price)
                    FROM order_items all_items
                    WHERE all_items."orderId" = o.id
                ), 0) AS "eventRevenue",
                COUNT(oi.id) AS "itemCount"
            FROM orders o
            INNER JOIN order_items oi ON oi."orderId" = o.id
            INNER JOIN photos p ON p.id = oi."photoId"
            WHERE p."eventId" = :eventId
            AND o.status IN ('paid', 'completed')
            GROUP BY o.id, o."totalAmount"
        ) sub
        `,
        { replacements: { eventId }, type: QueryTypes.SELECT, transaction }
    );

    const totalOrders = parseInt(row.totalOrders, 10) || 0;
    const totalRevenue = parseFloat(row.totalRevenue) || 0;
    const totalPhotosSold = parseInt(row.totalPhotosSold, 10) || 0;

    return {
        totalOrders,
        totalRevenue,
        totalPhotosSold,
        avgPhotosPerOrder: totalOrders > 0 ? totalPhotosSold / totalOrders : 0,
        avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0
    };
}

function calculateCommissionBalance(revenue, percentage, reservedOrPaidTotal) {
    const commissionPercentage = Number(percentage) || 0;
    const commissionInCents = Number(revenue) * commissionPercentage;
    // Compensate for binary precision at half-cent rounding boundaries.
    const commissionTotalCents = Math.round(
        commissionInCents + Number.EPSILON * Math.max(1, Math.abs(commissionInCents))
    );
    const reservedOrPaidTotalCents = Math.round((Number(reservedOrPaidTotal) || 0) * 100);
    return {
        commissionPercentage,
        commissionTotal: commissionTotalCents / 100,
        reservedOrPaidTotal: reservedOrPaidTotalCents / 100,
        availableBalance: Math.max(commissionTotalCents - reservedOrPaidTotalCents, 0) / 100
    };
}

async function getEventCommissionBalance(event, type, { transaction } = {}) {
    const fields = commissionFields(type);
    const salesSummary = await getEventSalesSummary(event.id, { transaction });
    const [row] = await sequelize.query(
        `
        SELECT COALESCE(SUM(amount), 0) AS "reservedOrPaidTotal"
        FROM withdrawal_requests
        WHERE "eventId" = :eventId
        AND "${fields.id}" IS NOT NULL
        AND status IN (:statuses)
        `,
        {
            replacements: { eventId: event.id, statuses: RESERVED_OR_PAID_STATUSES },
            type: QueryTypes.SELECT,
            transaction
        }
    );

    return {
        ...salesSummary,
        ...calculateCommissionBalance(salesSummary.totalRevenue, event[fields.percentage], row.reservedOrPaidTotal)
    };
}

/**
 * Whether the event already has a withdrawal request awaiting resolution
 * (pending or approved) — used to enforce "one open request at a time".
 */
async function hasOpenWithdrawalRequest(eventId, type = 'organizer', { transaction } = {}) {
    const fields = commissionFields(type);
    const [row] = await sequelize.query(
        `
        SELECT COUNT(*) AS "count"
        FROM withdrawal_requests
        WHERE "eventId" = :eventId
        AND "${fields.id}" IS NOT NULL
        AND status IN (:statuses)
        `,
        {
            replacements: { eventId, statuses: OPEN_STATUSES },
            type: QueryTypes.SELECT,
            transaction
        }
    );

    return parseInt(row.count, 10) > 0;
}

module.exports = {
    commissionFields,
    validateEventCommissions,
    calculateCommissionBalance,
    getEventSalesSummary,
    getEventCommissionBalance,
    getOrganizerEventBalance: (event, options) => getEventCommissionBalance(event, 'organizer', options),
    hasOpenWithdrawalRequest
};
