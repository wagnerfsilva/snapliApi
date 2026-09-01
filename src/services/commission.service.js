'use strict';

const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

const OPEN_STATUSES = ['pending', 'approved'];
const RESERVED_OR_PAID_STATUSES = ['pending', 'approved', 'paid'];

/**
 * Aggregate sales summary for an event (paid/completed orders only).
 * Independent from the totalRevenue query in event.controller.js#getAll —
 * kept separate on purpose so that listing behavior stays unchanged.
 */
async function getEventSalesSummary(eventId) {
    const [row] = await sequelize.query(
        `
        SELECT
            COUNT(DISTINCT sub."orderId") AS "totalOrders",
            COALESCE(SUM(sub."totalAmount"), 0) AS "totalRevenue",
            COALESCE(COUNT(sub."orderItemId"), 0) AS "totalPhotosSold"
        FROM (
            SELECT DISTINCT o.id AS "orderId", o."totalAmount", oi.id AS "orderItemId"
            FROM orders o
            INNER JOIN order_items oi ON oi."orderId" = o.id
            INNER JOIN photos p ON p.id = oi."photoId"
            WHERE p."eventId" = :eventId
            AND o.status IN ('paid', 'completed')
        ) sub
        `,
        { replacements: { eventId }, type: QueryTypes.SELECT }
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

/**
 * Balance available for withdrawal by the event's organizer.
 */
async function getOrganizerEventBalance(event) {
    const salesSummary = await getEventSalesSummary(event.id);
    const commissionPercentage = parseFloat(event.organizerCommissionPercentage) || 0;
    const commissionTotal = salesSummary.totalRevenue * (commissionPercentage / 100);

    const [row] = await sequelize.query(
        `
        SELECT COALESCE(SUM(amount), 0) AS "reservedOrPaidTotal"
        FROM withdrawal_requests
        WHERE "eventId" = :eventId
        AND status IN (:statuses)
        `,
        {
            replacements: { eventId: event.id, statuses: RESERVED_OR_PAID_STATUSES },
            type: QueryTypes.SELECT
        }
    );

    const reservedOrPaidTotal = parseFloat(row.reservedOrPaidTotal) || 0;
    const availableBalance = Math.max(commissionTotal - reservedOrPaidTotal, 0);

    return {
        ...salesSummary,
        commissionPercentage,
        commissionTotal,
        reservedOrPaidTotal,
        availableBalance
    };
}

/**
 * Whether the event already has a withdrawal request awaiting resolution
 * (pending or approved) — used to enforce "one open request at a time".
 */
async function hasOpenWithdrawalRequest(eventId) {
    const [row] = await sequelize.query(
        `
        SELECT COUNT(*) AS "count"
        FROM withdrawal_requests
        WHERE "eventId" = :eventId
        AND status IN (:statuses)
        `,
        {
            replacements: { eventId, statuses: OPEN_STATUSES },
            type: QueryTypes.SELECT
        }
    );

    return parseInt(row.count, 10) > 0;
}

module.exports = {
    getEventSalesSummary,
    getOrganizerEventBalance,
    hasOpenWithdrawalRequest
};
