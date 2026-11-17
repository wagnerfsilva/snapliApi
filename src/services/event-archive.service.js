'use strict';

const { Event, sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const s3Service = require('./s3.service');
const rekognitionService = require('./rekognition.service');
const logger = require('../utils/logger');

const DEFAULT_DOWNLOAD_DAYS = 90;
const UNPAID_GRACE_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAID_STATUSES = ['paid', 'completed', 'courtesy'];
const UNPAID_STATUSES = ['pending', 'processing'];

// Same fallback the download flow uses when the link was never generated: 90 days after payment
function effectiveDownloadExpiry(order) {
    if (order.downloadExpiresAt) return new Date(order.downloadExpiresAt);
    const base = new Date(order.paidAt || order.createdAt);
    return new Date(base.getTime() + DEFAULT_DOWNLOAD_DAYS * DAY_MS);
}

async function loadEventOrders(eventId) {
    return sequelize.query(
        `SELECT DISTINCT o.id, o.status, o."customerName", o."downloadExpiresAt", o."paidAt", o."createdAt"
         FROM orders o
         INNER JOIN order_items oi ON oi."orderId" = o.id
         INNER JOIN photos p ON p.id = oi."photoId"
         WHERE p."eventId" = :eventId AND o.status IN (:statuses)`,
        {
            replacements: { eventId, statuses: [...PAID_STATUSES, ...UNPAID_STATUSES] },
            type: QueryTypes.SELECT
        }
    );
}

/**
 * Returns the reasons an event can't be archived yet (empty list = eligible).
 */
async function getArchiveBlockers(event, now = new Date()) {
    const blockers = [];

    if (event.archivedAt) {
        blockers.push({ code: 'ALREADY_ARCHIVED', message: 'Evento já está arquivado' });
        return blockers;
    }

    const orders = await loadEventOrders(event.id);
    const unpaidCutoff = now.getTime() - UNPAID_GRACE_DAYS * DAY_MS;

    for (const order of orders) {
        if (PAID_STATUSES.includes(order.status)) {
            const expiresAt = effectiveDownloadExpiry(order);
            if (expiresAt > now) {
                blockers.push({
                    code: 'DOWNLOAD_ACTIVE',
                    orderId: order.id,
                    expiresAt,
                    message: `Pedido ${order.id} (${order.customerName}) ainda pode baixar até ${expiresAt.toISOString()}`
                });
            }
        } else if (new Date(order.createdAt).getTime() > unpaidCutoff) {
            blockers.push({
                code: 'UNPAID_RECENT',
                orderId: order.id,
                message: `Pedido ${order.id} (${order.customerName}) está ${order.status} e foi criado há menos de ${UNPAID_GRACE_DAYS} dias`
            });
        }
    }

    return blockers;
}

/**
 * Read-only snapshot used by the CLI to show the admin what is about to be archived.
 */
async function getEventOverview(eventId, now = new Date()) {
    const event = await Event.findByPk(eventId);
    if (!event) throw new Error('Evento não encontrado');

    const orders = await loadEventOrders(event.id);
    const paid = orders.filter(order => PAID_STATUSES.includes(order.status));
    const lastExpiry = paid.reduce((latest, order) => {
        const expiresAt = effectiveDownloadExpiry(order);
        return !latest || expiresAt > latest ? expiresAt : latest;
    }, null);

    return {
        event,
        orders: {
            paid: paid.filter(order => order.status !== 'courtesy').length,
            courtesy: paid.filter(order => order.status === 'courtesy').length,
            unpaid: orders.length - paid.length,
            lastDownloadExpiry: lastExpiry
        },
        blockers: await getArchiveBlockers(event, now)
    };
}

async function collectMedia(eventId) {
    const photos = await sequelize.query(
        `SELECT "originalKey", "watermarkedKey", "thumbnailKey", "previewKey", "rekognitionFaceId"
         FROM photos WHERE "eventId" = :eventId`,
        { replacements: { eventId }, type: QueryTypes.SELECT }
    );
    const videoFaces = await sequelize.query(
        `SELECT mf."faceId"
         FROM media_faces mf INNER JOIN photos p ON p.id = mf."photoId"
         WHERE p."eventId" = :eventId`,
        { replacements: { eventId }, type: QueryTypes.SELECT }
    );

    const originalKeys = new Set();
    const watermarkedKeys = new Set();
    const faceIds = new Set(videoFaces.map(row => row.faceId));
    for (const photo of photos) {
        if (photo.originalKey) originalKeys.add(photo.originalKey);
        if (photo.watermarkedKey) watermarkedKeys.add(photo.watermarkedKey);
        if (photo.thumbnailKey) watermarkedKeys.add(photo.thumbnailKey);
        if (photo.previewKey) watermarkedKeys.add(photo.previewKey);
        if (photo.rekognitionFaceId) faceIds.add(photo.rekognitionFaceId);
    }

    // Also sweep the event prefix to catch objects with no matching database row
    const prefix = `events/${eventId}/`;
    const [originalByPrefix, watermarkedByPrefix] = await Promise.all([
        s3Service.listKeysByPrefix(prefix, 'original'),
        s3Service.listKeysByPrefix(prefix, 'watermarked')
    ]);
    originalByPrefix.forEach(key => originalKeys.add(key));
    watermarkedByPrefix.forEach(key => watermarkedKeys.add(key));

    return { originalKeys: [...originalKeys], watermarkedKeys: [...watermarkedKeys], faceIds: [...faceIds] };
}

/**
 * Archives an event: deactivates it, removes every media object from S3 and the faces from
 * Rekognition, then stamps archivedAt. Database rows are kept so sales/metrics stay intact.
 * Safe to re-run after a partial failure (archivedAt is only set at the very end).
 */
async function archiveEvent(eventId, { dryRun = false, now = new Date() } = {}) {
    const event = await Event.findByPk(eventId);
    if (!event) throw new Error('Evento não encontrado');

    const blockers = await getArchiveBlockers(event, now);
    if (blockers.length > 0) return { archived: false, blockers };

    const media = await collectMedia(event.id);
    const summary = {
        originalObjects: media.originalKeys.length,
        watermarkedObjects: media.watermarkedKeys.length,
        faces: media.faceIds.length
    };
    if (dryRun) return { archived: false, dryRun: true, blockers: [], summary };

    // Deactivate first so no new order can start, then re-check for orders created meanwhile
    const wasActive = event.isActive;
    await event.update({ isActive: false });
    const lateBlockers = await getArchiveBlockers(event, now);
    if (lateBlockers.length > 0) {
        await event.update({ isActive: wasActive });
        return { archived: false, blockers: lateBlockers };
    }

    for (let offset = 0; offset < media.faceIds.length; offset += 1000) {
        await rekognitionService.deleteFaces(media.faceIds.slice(offset, offset + 1000));
    }
    await s3Service.deleteFiles(media.originalKeys, 'original');
    await s3Service.deleteFiles(media.watermarkedKeys, 'watermarked');

    await event.update({ archivedAt: new Date() });
    logger.info(`Evento arquivado: ${event.id} - ${event.name}`, summary);

    return { archived: true, blockers: [], summary };
}

module.exports = {
    UNPAID_GRACE_DAYS,
    DEFAULT_DOWNLOAD_DAYS,
    effectiveDownloadExpiry,
    getArchiveBlockers,
    getEventOverview,
    archiveEvent
};
