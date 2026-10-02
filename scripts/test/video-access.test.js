'use strict';

jest.mock('../../src/models', () => ({
    Photo: { findByPk: jest.fn(), create: jest.fn(), update: jest.fn() }, Event: { findByPk: jest.fn() },
    Order: { findOne: jest.fn() }, OrderItem: {}, MediaFace: {},
    sequelize: { transaction: jest.fn() }
}));
jest.mock('../../src/services/video-upload.service', () => ({ PART_SIZE: 8388608, validateUpload: jest.fn(() => 'video/mp4'), validateParts: jest.fn(), start: jest.fn(), finish: jest.fn(), cancel: jest.fn(), part: jest.fn() }));
jest.mock('../../src/services/video-worker.service', () => ({ isReady: () => true }));
jest.mock('../../src/services/media-preview.service', () => ({ previewUrls: jest.fn(async () => ({ mediaType: 'video', previewUrl: 'marked-preview', thumbnailUrl: 'marked-poster' })) }));
jest.mock('../../src/services/s3.service', () => ({ generatePresignedUrl: jest.fn(async () => 'private-original') }));
jest.mock('../../src/services/email.service', () => ({}));
jest.mock('../../src/services/image.service', () => ({}));
jest.mock('../../src/services/rekognition.service', () => ({}));
jest.mock('../../src/utils/logger', () => ({ error: jest.fn() }));

const { Photo, Event, Order, sequelize } = require('../../src/models');
const uploads = require('../../src/services/video-upload.service');
const storage = require('../../src/services/s3.service');
const { previewUrls } = require('../../src/services/media-preview.service');
const video = require('../../src/controllers/video.controller');
const photos = require('../../src/controllers/photo.controller');
const download = require('../../src/controllers/download.controller');
const request = { userRole: 'fotografo', userId: 'owner', params: { id: 'video', token: 'token', photoId: 'video' }, body: { eventId: 'event', parts: [] } };
let committed;
let response;
let next;

beforeEach(() => {
    jest.clearAllMocks();
    committed = false;
    response = { headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn(function () { this.headersSent = true; return this; }) };
    next = jest.fn();
    sequelize.transaction.mockImplementation(async callback => { const result = await callback({ LOCK: { UPDATE: 'UPDATE' } }); committed = true; return result; });
});

test('photographers cannot start uploads into another event', async () => {
    Event.findByPk.mockResolvedValue({ createdBy: 'other' });
    await video.start(request, response, next);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(uploads.start).not.toHaveBeenCalled();
});

test('completion enqueues exactly once and returns only after commit', async () => {
    const update = jest.fn();
    const media = { id: 'video', mediaType: 'video', uploadStatus: 'uploading', uploadId: 's3', event: { createdBy: 'owner' }, update };
    Photo.findByPk.mockResolvedValue(media);
    response.json.mockImplementation(() => { expect(committed).toBe(true); });
    await video.finish(request, response, next);
    expect(update.mock.calls[0][0]).toMatchObject({ uploadStatus: 'completed', processingStatus: 'pending', uploadId: null });
    media.uploadStatus = 'completed';
    media.processingStatus = 'pending';
    await video.finish(request, response, next);
    expect(uploads.finish).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
});

test('part upload rejects another photographer before sending to AWS', async () => {
    Photo.findByPk.mockResolvedValue({ mediaType: 'video', event: { createdBy: 'other' } });
    await video.part(request, response, next);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(uploads.part).not.toHaveBeenCalled();
});

test('retry queues completed uploads with failure without reading original as an image', async () => {
    Photo.findByPk.mockResolvedValue({ id: 'video', eventId: 'event', mediaType: 'video', uploadStatus: 'completed', processingStatus: 'failed' });
    Event.findByPk.mockResolvedValue({ createdBy: 'owner' });
    Photo.update.mockResolvedValue([1]);
    await photos.retryProcessing(request, response, next);
    expect(Photo.update.mock.calls[0][0]).toMatchObject({ processingStatus: 'pending', processingAttempts: 0 });
    expect(next).not.toHaveBeenCalled();
});

test.each(['pending', 'processing', 'completed'])('retry cannot race an active or completed %s video', async processingStatus => {
    Photo.findByPk.mockResolvedValue({ id: 'video', eventId: 'event', mediaType: 'video', uploadStatus: 'completed', processingStatus });
    Event.findByPk.mockResolvedValue({ createdBy: 'owner' });
    await photos.retryProcessing(request, response, next);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(Photo.update).not.toHaveBeenCalled();
});

test.each([['pending', null, 403], ['paid', new Date(0), 410]])('original download is blocked for %s / expiry %s', async (status, downloadExpiresAt, expected) => {
    Order.findOne.mockResolvedValue({ status, downloadExpiresAt });
    await download.downloadPhoto(request, response);
    expect(response.status).toHaveBeenCalledWith(expected);
    expect(storage.generatePresignedUrl).not.toHaveBeenCalled();
});

test('paid token signs only the original belonging to its order item', async () => {
    const save = jest.fn();
    Order.findOne.mockResolvedValue({ status: 'paid', items: [{ photo: { originalKey: 'secret.mov', originalFilename: 'original.mov' }, save }] });
    await download.downloadPhoto(request, response);
    expect(Order.findOne.mock.calls[0][0].include[0].where).toEqual({ photoId: 'video' });
    expect(storage.generatePresignedUrl).toHaveBeenCalledWith('secret.mov', 'original', 3600, { downloadFilename: 'original.mov' });
    expect(save).toHaveBeenCalledTimes(1);
});

test('unknown token or media never signs an original', async () => {
    Order.findOne.mockResolvedValue(null);
    await download.downloadPhoto(request, response);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(storage.generatePresignedUrl).not.toHaveBeenCalled();
});

test.each([['pending', null, 403], ['paid', new Date(0), 410]])('portal does not expose video playback for %s / expiry %s', async (status, downloadExpiresAt, expected) => {
    Order.findOne.mockResolvedValue({ status, downloadExpiresAt });
    await download.getOrderByToken(request, response);
    expect(response.status).toHaveBeenCalledWith(expected);
    expect(previewUrls).not.toHaveBeenCalled();
});

test('paid portal opts in to video playback only after checking payment and expiry', async () => {
    Order.findOne.mockResolvedValue({ status: 'paid', downloadExpiresAt: new Date(Date.now() + 60000), items: [{ photo: { id: 'video', mediaType: 'video' } }] });
    await download.getOrderByToken(request, response);
    expect(previewUrls).toHaveBeenCalledWith(expect.objectContaining({ id: 'video' }), { includeVideoPreview: true });
    expect(response.json.mock.calls[0][0].photos[0].previewUrl).toBe('marked-preview');
});