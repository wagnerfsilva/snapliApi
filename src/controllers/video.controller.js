'use strict';

const { randomUUID } = require('node:crypto');
const { Photo, Event, sequelize } = require('../models');
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
        if (!require('../services/video-worker.service').isReady()) {
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
            ...(photo.processingStatus === 'completed' ? await previewUrls(photo) : {})
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