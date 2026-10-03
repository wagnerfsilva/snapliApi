'use strict';

const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { Op } = require('sequelize');
const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, buckets, rekognition } = require('../config/aws');
const { Photo, MediaFace, Event, sequelize } = require('../models');
const rekognitionService = require('./rekognition.service');
const { prepareVideo } = require('./video-processing.service');
const logger = require('../utils/logger');

let ready = false;
let busy = false;

async function claim() {
    return sequelize.transaction(async transaction => {
        const photo = await Photo.findOne({
            where: {
                mediaType: 'video', uploadStatus: 'completed',
                [Op.or]: [
                    { processingStatus: 'pending' },
                    { processingStatus: 'processing', processingHeartbeatAt: { [Op.lt]: new Date(Date.now() - 20 * 60 * 1000) } }
                ]
            },
            order: [['createdAt', 'ASC']], transaction, lock: transaction.LOCK.UPDATE, skipLocked: true
        });
        if (!photo) return null;
        if (photo.processingAttempts >= 3) {
            await photo.update({ processingStatus: 'failed', processingError: 'Processamento interrompido repetidamente; solicite reprocessamento' }, { transaction });
            return null;
        }
        await photo.update({
            processingStatus: 'processing', processingOwner: randomUUID(),
            processingHeartbeatAt: new Date(), processingAttempts: photo.processingAttempts + 1, processingError: null
        }, { transaction });
        return photo;
    });
}

async function put(filePath, key, contentType) {
    const stat = await fs.stat(filePath);
    await s3Client.send(new PutObjectCommand({
        Bucket: buckets.watermarked, Key: key, Body: createReadStream(filePath), ContentLength: stat.size,
        ContentType: contentType, ServerSideEncryption: 'AES256', CacheControl: 'max-age=3600'
    }));
}

async function processVideo(photo) {
    const where = { id: photo.id, processingOwner: photo.processingOwner, processingStatus: 'processing' };
    let lostLease = false;
    const heartbeat = setInterval(() => {
        Photo.update({ processingHeartbeatAt: new Date() }, { where })
            .then(([count]) => { if (!count) lostLease = true; })
            .catch(error => logger.error('Video heartbeat failed', { id: photo.id, message: error.message }));
    }, 30000);
    heartbeat.unref();
    let sourceDirectory;
    let prepared;
    try {
        sourceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'snapli-video-source-'));
        const source = path.join(sourceDirectory, /\.mov$/i.test(photo.originalKey) ? 'original.mov' : 'original.mp4');
        const response = await s3Client.send(new GetObjectCommand({ Bucket: buckets.original, Key: photo.originalKey }), { abortSignal: AbortSignal.timeout(10 * 60 * 1000) });
        await pipeline(response.Body, createWriteStream(source));
        if ((await fs.stat(source)).size !== photo.fileSize) throw new Error('Original incompleto no S3');
        prepared = await prepareVideo(source);
        const prefix = `events/${photo.eventId}/videos/${photo.id}/v${photo.processingVersion}`;
        const previewKey = `${prefix}/preview.mp4`;
        const thumbnailKey = `${prefix}/poster.jpg`;
        await put(prepared.previewPath, previewKey, 'video/mp4');
        await put(prepared.posterPath, thumbnailKey, 'image/jpeg');
        let faceCount = 0;
        for (const frame of prepared.frames) {
            if (lostLease) throw new Error('Processamento assumido por outro worker');
            const bytes = await fs.readFile(frame.filePath);
            const indexed = await rekognitionService.indexFaces(bytes, `video_${photo.id}_v${photo.processingVersion}_t${frame.timestampMs}`, 100);
            if (indexed.faces.length) {
                await MediaFace.bulkCreate(indexed.faces.map(face => ({
                    photoId: photo.id, faceId: face.faceId, collectionId: rekognition.collectionId,
                    timestampMs: frame.timestampMs, processingVersion: photo.processingVersion,
                    confidence: face.confidence, boundingBox: face.boundingBox
                })), { updateOnDuplicate: ['timestampMs', 'processingVersion', 'confidence', 'boundingBox'] });
                faceCount += indexed.faces.length;
            }
        }
        await sequelize.transaction(async transaction => {
            const [count] = await Photo.update({
                previewKey, thumbnailKey, width: prepared.metadata.width, height: prepared.metadata.height,
                durationMs: prepared.metadata.durationMs, faceCount, processingStatus: 'completed',
                processingOwner: null, processingHeartbeatAt: null, processingError: null,
                metadata: { video: prepared.metadata, sampleRate: prepared.sampleRate }
            }, { where, transaction });
            if (count) await Event.increment('videoCount', { by: 1, where: { id: photo.eventId }, transaction });
        });
        logger.info('Video processed', { id: photo.id, faceCount });
    } catch (error) {
        await Photo.update({ processingStatus: 'failed', processingError: error.message, processingOwner: null, processingHeartbeatAt: null }, { where });
        logger.error('Video processing failed', { id: photo.id, message: error.message });
    } finally {
        clearInterval(heartbeat);
        if (prepared) await fs.rm(prepared.directory, { recursive: true, force: true });
        if (sourceDirectory) await fs.rm(sourceDirectory, { recursive: true, force: true });
    }
}

async function tick() {
    if (busy || !ready) return;
    busy = true;
    try {
        const photo = await claim();
        if (photo) await processVideo(photo);
    } catch (error) { logger.error('Video queue failed', { message: error.message }); }
    finally { busy = false; }
}

async function start() {
    if (process.env.VIDEO_PROCESSING_ENABLED === 'false' || !Photo || !s3Client || !rekognition.collectionId) return;
    try {
        const execute = promisify(execFile);
        const { stdout } = await execute('ffmpeg', ['-hide_banner', '-filters']);
        await execute('ffprobe', ['-version']);
        for (const filter of ['zscale', 'tonemap', 'drawtext']) {
            if (!stdout.includes(filter)) throw new Error(`FFmpeg sem filtro ${filter}`);
        }
        await Photo.findOne({ attributes: ['id', 'mediaType', 'uploadStatus', 'processingOwner', 'processingHeartbeatAt', 'processingAttempts'], where: { mediaType: 'video' } });
        await MediaFace.findOne({ attributes: ['faceId', 'timestampMs', 'processingVersion'] });
        ready = true;
        const interval = setInterval(tick, 5000);
        interval.unref();
        tick();
        logger.info('Video worker ready; using existing Rekognition collection');
    } catch (error) { logger.error('Video worker unavailable', { message: error.message }); }
}

module.exports = { start, isReady: () => ready, claim, processVideo };