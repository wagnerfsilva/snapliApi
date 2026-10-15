'use strict';

const { randomUUID } = require('node:crypto');
const { Photo, MediaFace, Event, sequelize } = require('../models');
const { rekognition } = require('../config/aws');
const upload = require('../services/video-upload.service');
const { validateVideoPricing } = require('../services/video-pricing.service');
const { previewUrls } = require('../services/media-preview.service');

function allowed(req, event) {
    return req.userRole === 'admin' || (req.userRole === 'fotografo' && event.createdBy === req.userId);
}

async function ownVideo(req, res, transaction) {
    const photo = await Photo.findByPk(req.params.id, {
        include: [{ model: Event, as: 'event', required: true }],
        ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {})
    });
    if (!photo || photo.mediaType !== 'video') {
        res.status(404).json({ success: false, message: 'Video nao encontrado' });
        return null;
    }
    if (!allowed(req, photo.event)) {
        res.status(403).json({ success: false, message: 'Acesso negado ao evento' });
        return null;
    }
    return photo;
}

exports.start = async (req, res, next) => {
    let photo;
    let uploadId;
    try {
        const event = await Event.findByPk(req.body.eventId);
        if (!event) return res.status(404).json({ success: false, message: 'Evento nao encontrado' });
        if (!allowed(req, event)) return res.status(403).json({ success: false, message: 'Acesso negado ao evento' });
        if (!event.isActive || !event.videoEnabled) return res.status(400).json({ success: false, message: 'Habilite videos e configure seus precos no evento' });
        if (!require('../services/video-lambda.service').isReady()) {
            return res.status(503).json({ success: false, message: 'Processador de video ainda nao esta disponivel' });
        }
        let mimeType;
        try {
            validateVideoPricing(event);
            mimeType = upload.validateUpload(req.body);
        } catch (error) {
            return res.status(400).json({ success: false, message: error.message });
        }
        const id = randomUUID();
        const extension = mimeType === 'video/quicktime' ? 'mov' : 'mp4';
        const key = `events/${event.id}/videos/${id}/original.${extension}`;
        photo = await Photo.create({
            id, eventId: event.id, mediaType: 'video', originalFilename: req.body.filename,
            originalKey: key, mimeType, fileSize: req.body.fileSize, uploadedBy: req.userId,
            uploadStatus: 'uploading', processingStatus: 'pending'
        });
        uploadId = await upload.start(key, mimeType);
        await photo.update({ uploadId });
        res.status(201).json({ success: true, data: { id, partSize: upload.PART_SIZE, partCount: Math.ceil(photo.fileSize / upload.PART_SIZE) } });
    } catch (error) {
        if (photo && uploadId) await upload.cancel({ originalKey: photo.originalKey, uploadId }).catch(() => {});
        if (photo) await photo.update({ uploadStatus: 'failed', processingStatus: 'failed', processingError: 'Falha ao iniciar upload' }).catch(() => {});
        next(error);
    }
};

exports.part = async (req, res, next) => {
    try {
        const photo = await ownVideo(req, res);
        if (!photo) return;
        if (photo.uploadStatus !== 'uploading' || !photo.uploadId) return res.status(409).json({ success: false, message: 'Upload nao esta aberto' });
        let result;
        try {
            result = await upload.part(photo, Number(req.params.partNumber), req.body);
        } catch (error) {
            if (/parte invalido|parte invalida/.test(error.message)) return res.status(400).json({ success: false, message: error.message });
            throw error;
        }
        res.json({ success: true, data: result });
    } catch (error) { next(error); }
};

exports.finish = async (req, res, next) => {
    try {
        const result = await sequelize.transaction(async transaction => {
            const photo = await ownVideo(req, res, transaction);
            if (!photo) return;
            if (photo.uploadStatus === 'completed') return { id: photo.id, processingStatus: photo.processingStatus };
            if (photo.uploadStatus !== 'uploading' || !photo.uploadId) return res.status(409).json({ success: false, message: 'Upload nao esta aberto' });
            try { upload.validateParts(req.body.parts, photo.fileSize); }
            catch (error) { return res.status(400).json({ success: false, message: error.message }); }
            await upload.finish(photo, req.body.parts);
            await photo.update({ uploadStatus: 'completed', uploadId: null, processingStatus: 'pending', processingError: null }, { transaction });
            return { id: photo.id, processingStatus: 'pending' };
        });
        if (result && !res.headersSent) res.json({ success: true, data: result });
    } catch (error) { next(error); }
};

exports.status = async (req, res, next) => {
    try {
        const photo = await ownVideo(req, res);
        if (!photo) return;
        res.json({ success: true, data: {
            id: photo.id, uploadStatus: photo.uploadStatus, processingStatus: photo.processingStatus,
            processingError: photo.processingError, faceCount: photo.faceCount,
            ...(photo.processingStatus === 'completed' ? await previewUrls(photo, { includeVideoPreview: true }) : {})
        } });
    } catch (error) { next(error); }
};

exports.cancel = async (req, res, next) => {
    try {
        const cancelled = await sequelize.transaction(async transaction => {
            const photo = await ownVideo(req, res, transaction);
            if (!photo) return false;
            if (photo.uploadStatus !== 'uploading') {
                res.status(409).json({ success: false, message: 'Upload nao pode ser cancelado' });
                return false;
            }
            await upload.cancel(photo);
            await photo.update({ uploadStatus: 'aborted', uploadId: null, processingStatus: 'failed', processingError: 'Upload cancelado' }, { transaction });
            return true;
        });
        if (cancelled) res.json({ success: true });
    } catch (error) { next(error); }
};

exports.lambdaCallback = async (req, res, next) => {
    const supplied = Buffer.from(req.headers['x-lambda-secret'] || '');
    const expected = Buffer.from(process.env.LAMBDA_INTERNAL_SECRET || '');
    if (!expected.length || supplied.length !== expected.length || !require('node:crypto').timingSafeEqual(supplied, expected)) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const { action, originalKey, owner, processingVersion, faces, metadata, previewKey, thumbnailKey, sampleRate, faceCount, processingError } = req.body;
    if (!['claim', 'faces', 'completed', 'failed'].includes(action) || typeof originalKey !== 'string' || typeof owner !== 'string' || !/^[0-9a-f-]{36}$/i.test(owner)) {
        return res.status(400).json({ success: false, message: 'Callback de video invalido' });
    }
    try {
        const result = await sequelize.transaction(async transaction => {
            const photo = await Photo.findOne({ where: { originalKey, mediaType: 'video' }, transaction, lock: transaction.LOCK.UPDATE });
            if (!photo) return { status: 404, message: 'Video nao encontrado' };
            if (photo.uploadStatus !== 'completed') return { status: 409, message: 'Upload ainda nao confirmado' };
            if (photo.processingStatus === 'completed') return { status: 200, data: { claimed: false, completed: true } };
            if (action === 'claim') {
                if (photo.processingStatus === 'processing' && Date.now() - new Date(photo.processingHeartbeatAt).getTime() < 15 * 60 * 1000) {
                    return { status: 200, data: { claimed: false } };
                }
                if (photo.processingAttempts >= 3) {
                    await photo.update({ processingStatus: 'failed', processingError: 'Lambda interrompida repetidamente; solicite reprocessamento' }, { transaction });
                    return { status: 200, data: { claimed: false } };
                }
                await photo.update({ processingStatus: 'processing', processingOwner: owner, processingHeartbeatAt: new Date(), processingAttempts: photo.processingAttempts + 1, processingError: null }, { transaction });
                return { status: 200, data: { claimed: true, id: photo.id, eventId: photo.eventId, fileSize: photo.fileSize, processingVersion: photo.processingVersion } };
            }
            if (photo.processingStatus !== 'processing' || photo.processingOwner !== owner || photo.processingVersion !== processingVersion) {
                return { status: 409, message: 'Execucao Lambda nao e a atual' };
            }
            if (action === 'faces') {
                if (!Array.isArray(faces) || faces.length > 100 || faces.some(face => typeof face.faceId !== 'string' || !face.faceId || !Number.isInteger(face.timestampMs) || face.timestampMs < 0 || face.timestampMs >= 120000)) {
                    return { status: 400, message: 'Rostos invalidos' };
                }
                if (faces.length) await MediaFace.bulkCreate(faces.map(face => ({
                    photoId: photo.id, faceId: face.faceId, collectionId: rekognition.collectionId,
                    timestampMs: face.timestampMs, processingVersion,
                    confidence: face.confidence, boundingBox: face.boundingBox
                })), { transaction, updateOnDuplicate: ['timestampMs', 'processingVersion', 'confidence', 'boundingBox'] });
            } else if (action === 'completed') {
                const prefix = `events/${photo.eventId}/videos/${photo.id}/v${photo.processingVersion}`;
                if (previewKey !== `${prefix}/preview.mp4` || thumbnailKey !== `${prefix}/poster.jpg` || !metadata || metadata.fileSize !== photo.fileSize || !Number.isInteger(metadata.durationMs) || metadata.durationMs < 1 || metadata.durationMs > 120000 || !Number.isInteger(metadata.width) || metadata.width < 2 || metadata.width > 4096 || !Number.isInteger(metadata.height) || metadata.height < 2 || metadata.height > 4096 || sampleRate !== 0.1 || !Number.isInteger(faceCount) || faceCount < 0 || faceCount > 1200) {
                    return { status: 400, message: 'Resultado de video invalido' };
                }
                await photo.update({ previewKey, thumbnailKey, durationMs: metadata.durationMs, width: metadata.width, height: metadata.height, faceCount,
                    metadata: { video: metadata, sampleRate }, processingStatus: 'completed', processingOwner: null, processingHeartbeatAt: null, processingError: null }, { transaction });
                await Event.increment('videoCount', { by: 1, where: { id: photo.eventId }, transaction });
            } else {
                await photo.update({ processingStatus: 'failed', processingError: String(processingError || 'Falha na Lambda').slice(0, 2000), processingOwner: null, processingHeartbeatAt: null }, { transaction });
            }
            return { status: 200, data: { id: photo.id } };
        });
        res.status(result.status).json({ success: result.status === 200, ...(result.message ? { message: result.message } : { data: result.data }) });
    } catch (error) { next(error); }
};