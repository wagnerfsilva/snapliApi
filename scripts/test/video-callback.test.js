'use strict';

jest.mock('../../src/models', () => ({
    Photo: { findOne: jest.fn() }, MediaFace: { bulkCreate: jest.fn() }, Event: { increment: jest.fn() },
    sequelize: { transaction: jest.fn(async callback => callback({ LOCK: { UPDATE: 'UPDATE' } })) }
}));
jest.mock('../../src/config/aws', () => ({ rekognition: { collectionId: 'existing' } }));
jest.mock('../../src/services/video-upload.service', () => ({}));
jest.mock('../../src/services/media-preview.service', () => ({}));
const { Photo, MediaFace, Event } = require('../../src/models');
const { lambdaCallback } = require('../../src/controllers/video.controller');
const owner = '11111111-1111-4111-8111-111111111111';
let photo;
let res;
let next;

beforeEach(() => {
    jest.clearAllMocks();
    process.env.LAMBDA_INTERNAL_SECRET = 'test-secret';
    photo = { id: 'video', eventId: 'event', fileSize: 100, processingVersion: 1, processingAttempts: 0, uploadStatus: 'completed', processingStatus: 'pending' };
    photo.update = jest.fn(async data => Object.assign(photo, data));
    Photo.findOne.mockResolvedValue(photo);
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
});

async function send(action, body = {}, secret = 'test-secret') {
    await lambdaCallback({ headers: { 'x-lambda-secret': secret }, body: { action, originalKey: 'events/event/videos/video/original.mov', owner, processingVersion: 1, ...body } }, res, next);
    expect(next).not.toHaveBeenCalled();
}

test('callback rejects missing or incorrect secret before database access', async () => {
    await send('claim', {}, 'wrong');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(Photo.findOne).not.toHaveBeenCalled();
});

test('claim locks video and returns only required processing metadata', async () => {
    await send('claim');
    expect(photo.processingOwner).toBe(owner);
    expect(photo.processingStatus).toBe('processing');
    expect(Photo.findOne.mock.calls[0][0]).toMatchObject({ lock: 'UPDATE', where: { mediaType: 'video' } });
    expect(res.json.mock.calls[0][0].data).toMatchObject({ claimed: true, fileSize: 100, processingVersion: 1 });
});

test('S3 event before multipart database commit is retriable, not discarded', async () => {
    photo.uploadStatus = 'uploading';
    await send('claim');
    expect(res.status).toHaveBeenCalledWith(409);
    expect(photo.update).not.toHaveBeenCalled();
});

test('duplicate event cannot claim an active execution', async () => {
    await send('claim');
    photo.update.mockClear();
    await send('claim', { owner: '22222222-2222-4222-8222-222222222222' });
    expect(photo.update).not.toHaveBeenCalled();
    expect(res.json.mock.calls[1][0].data.claimed).toBe(false);
});

test('timed-out Lambda can be claimed again, with capped attempts', async () => {
    photo.processingStatus = 'processing';
    photo.processingHeartbeatAt = new Date(Date.now() - 16 * 60 * 1000);
    await send('claim');
    expect(photo.processingAttempts).toBe(1);
    photo.processingAttempts = 3;
    photo.processingHeartbeatAt = new Date(0);
    await send('claim');
    expect(photo.processingStatus).toBe('failed');
});

test('face callback preserves timestamp and existing collection without exposing media', async () => {
    await send('claim');
    await send('faces', { faces: [{ faceId: 'face', timestampMs: 10000, confidence: 99 }] });
    expect(MediaFace.bulkCreate.mock.calls[0][0][0]).toMatchObject({ faceId: 'face', photoId: 'video', collectionId: 'existing', timestampMs: 10000, processingVersion: 1 });
});

test('stale execution cannot publish or change the video', async () => {
    await send('claim');
    photo.update.mockClear();
    await send('failed', { owner: '22222222-2222-4222-8222-222222222222' });
    expect(res.status).toHaveBeenLastCalledWith(409);
    expect(photo.update).not.toHaveBeenCalled();
});

test('frame callbacks cannot extend the lease beyond the Lambda timeout', async () => {
    await send('claim');
    const claimedAt = new Date(Date.now() - 14 * 60 * 1000);
    photo.processingHeartbeatAt = claimedAt;
    await send('faces', { faces: [] });
    expect(photo.processingHeartbeatAt).toBe(claimedAt);
});

test('completion is transactional and increments videoCount exactly once', async () => {
    await send('claim');
    const result = { previewKey: 'events/event/videos/video/v1/preview.mp4', thumbnailKey: 'events/event/videos/video/v1/poster.jpg', sampleRate: 1, faceCount: 2, metadata: { fileSize: 100, durationMs: 89637, width: 720, height: 1280 } };
    await send('completed', result);
    await send('completed', result);
    expect(photo.processingStatus).toBe('completed');
    expect(photo.metadata.sampleRate).toBe(1);
    expect(Event.increment).toHaveBeenCalledTimes(1);
});

test('completion rejects derivative keys outside this video', async () => {
    await send('claim');
    await send('completed', { previewKey: 'events/other/preview.mp4' });
    expect(res.status).toHaveBeenLastCalledWith(400);
    expect(Event.increment).not.toHaveBeenCalled();
});