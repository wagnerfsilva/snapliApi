const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { Order, OrderItem, Photo, Event, sequelize } = require('../models');
const jwtConfig = require('../config/jwt');
const rekognition = require('./rekognition.service');
const { photoMatchConditions } = require('./face-search.service');
const { previewUrls } = require('./media-preview.service');

const previewAudience = 'snapli-order-photo-update';

function fail(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
}

function eligibility(order, event, items) {
    if (!['paid', 'completed'].includes(order.status) || !order.paidAt) {
        return { eligible: false, reason: 'Apenas pedidos pagos podem receber novas fotos.' };
    }
    if (!event?.isActive || event.archivedAt) {
        return { eligible: false, reason: 'O evento precisa estar ativo e não arquivado.' };
    }
    const fullPriceCents = Math.round(Number(event.allPhotosPrice) * 100);
    const itemCents = items.map(item => Math.round(Number(item.price) * 100));
    const totalItemCents = itemCents.reduce((sum, price) => sum + price, 0);
    const eventPhotoCents = items.reduce((sum, item, index) => (
        item.photo?.eventId === event.id && item.photo.mediaType === 'photo' ? sum + itemCents[index] : sum
    ), 0);
    const amountCents = Math.round(Number(order.totalAmount) * 100);
    const eventPaidCents = Math.round(amountCents * eventPhotoCents / totalItemCents);
    if (!(fullPriceCents > 0) || !(eventPhotoCents > 0) || !Number.isFinite(eventPaidCents) || eventPaidCents !== fullPriceCents) {
        return { eligible: false, reason: 'O valor pago pelas fotos deste evento precisa corresponder ao preço de Todas as fotos.' };
    }
    return { eligible: true };
}

async function context(orderId, eventId, transaction) {
    const order = await Order.findByPk(orderId, {
        transaction, ...(transaction && { lock: transaction.LOCK.UPDATE })
    });
    if (!order) fail(404, 'Pedido não encontrado.');
    const event = await Event.findByPk(eventId, {
        transaction, ...(transaction && { lock: transaction.LOCK.SHARE })
    });
    if (!event) fail(404, 'Evento não encontrado.');
    const items = await OrderItem.findAll({
        where: { orderId },
        include: [{ model: Photo, as: 'photo', attributes: ['id', 'eventId', 'mediaType'], required: true }],
        transaction
    });
    const result = eligibility(order, event, items);
    if (!result.eligible) fail(409, result.reason);
    return { order, event, items };
}

function candidateWhere(eventId) {
    return {
        eventId, mediaType: 'photo', processingStatus: 'completed'
    };
}

async function preview(orderId, eventId, adminId, imageBuffer) {
    const { event, items } = await context(orderId, eventId);
    const result = await rekognition.searchFacesByImage(imageBuffer, 4096);
    if (!result.matchCount && (result.error || !result.searchedFaceConfidence)) {
        fail(400, 'Nenhum rosto detectado. Envie uma foto com o rosto da pessoa visível.');
    }
    const conditions = photoMatchConditions(result.matches);
    const photos = conditions.length ? await Photo.findAll({
        where: {
            ...candidateWhere(eventId),
            [Op.and]: [
                { [Op.or]: conditions },
                { id: { [Op.notIn]: items.map(item => item.photoId) } }
            ]
        },
        order: [['createdAt', 'ASC'], ['id', 'ASC']]
    }) : [];
    const candidates = await Promise.all(photos.map(async photo => ({
        id: photo.id, eventId, mediaType: 'photo', createdAt: photo.createdAt,
        event: { id: event.id, name: event.name, date: event.date, location: event.location },
        ...(await previewUrls(photo))
    })));
    const previewToken = photos.length ? jwt.sign({
        orderId, eventId, adminId, photoIds: photos.map(photo => photo.id)
    }, jwtConfig.secret, {
        algorithm: 'HS256', issuer: jwtConfig.issuer, audience: previewAudience, expiresIn: '15m'
    }) : null;
    return { photos: candidates, previewToken };
}

async function confirm(orderId, eventId, adminId, previewToken, photoIds) {
    let payload;
    try {
        payload = jwt.verify(previewToken, jwtConfig.secret, {
            algorithms: ['HS256'], issuer: jwtConfig.issuer, audience: previewAudience
        });
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
            fail(400, 'Prévia inválida ou expirada. Faça uma nova busca.');
        }
        throw error;
    }
    if (payload.orderId !== orderId || payload.eventId !== eventId || payload.adminId !== adminId ||
        !Array.isArray(payload.photoIds) || photoIds.some(id => !payload.photoIds.includes(id))) {
        fail(400, 'Os arquivos selecionados não pertencem a esta prévia.');
    }
    return sequelize.transaction(async transaction => {
        const { items } = await context(orderId, eventId, transaction);
        const existingIds = new Set(items.map(item => item.photoId));
        const newIds = [...new Set(photoIds)].filter(id => !existingIds.has(id));
        if (!newIds.length) return { addedCount: 0 };
        const photos = await Photo.findAll({
            where: { ...candidateWhere(eventId), id: { [Op.in]: newIds } },
            transaction, lock: transaction.LOCK.SHARE
        });
        if (photos.length !== newIds.length) {
            fail(409, 'Algumas fotos não estão mais disponíveis. Faça uma nova busca.');
        }
        // Zero-price additions keep event allocation, revenue and commission unchanged.
        await OrderItem.bulkCreate(newIds.map(photoId => ({ orderId, photoId, price: 0 })), {
            transaction, validate: true
        });
        return { addedCount: newIds.length };
    });
}

module.exports = { eligibility, preview, confirm };
