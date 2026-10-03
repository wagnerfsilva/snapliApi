'use strict';

const mockSend = jest.fn();
jest.mock('../../src/config/aws', () => ({ s3Client: { send: mockSend }, buckets: { original: 'private', watermarked: 'marked' }, rekognition: { collectionId: 'existing-collection' } }));
jest.mock('../../src/models', () => ({
    Photo: { findOne: jest.fn(), update: jest.fn() }, MediaFace: { bulkCreate: jest.fn() }, Event: { increment: jest.fn() },
    sequelize: { transaction: jest.fn(async callback => callback({ LOCK: { UPDATE: 'UPDATE' } })) }
}));
jest.mock('../../src/services/rekognition.service', () => ({ indexFaces: jest.fn() }));
jest.mock('../../src/services/video-processing.service', () => ({ prepareVideo: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('node:fs/promises', () => ({ mkdtemp: jest.fn(async () => '/fake/source'), stat: jest.fn(async () => ({ size: 100 })), readFile: jest.fn(async () => Buffer.from('frame')), rm: jest.fn() }));
jest.mock('node:fs', () => ({ createReadStream: jest.fn(() => 'stream'), createWriteStream: jest.fn(() => 'stream') }));
jest.mock('node:stream/promises', () => ({ pipeline: jest.fn() }));

const { Photo, MediaFace, Event } = require('../../src/models');
const faces = require('../../src/services/rekognition.service');
const { prepareVideo } = require('../../src/services/video-processing.service');
const worker = require('../../src/services/video-worker.service');

const photo = { id: 'video', eventId: 'event', fileSize: 100, originalKey: 'original.mov', processingOwner: 'owner', processingVersion: 1 };

beforeEach(() => {
    jest.clearAllMocks();
    Photo.update.mockResolvedValue([1]);
    mockSend.mockResolvedValue({ Body: 'source' });
    prepareVideo.mockResolvedValue({ directory: '/fake/output', previewPath: '/fake/preview.mp4', posterPath: '/fake/poster.jpg', sampleRate: 0.1, metadata: { width: 720, height: 1280, durationMs: 2000 }, frames: [{ filePath: '/fake/frame.jpg', timestampMs: 0 }] });
    faces.indexFaces.mockResolvedValue({ faces: [{ faceId: 'face', confidence: 99, boundingBox: {} }] });
});

test('worker streams original, indexes existing collection and publishes only after faces are saved', async () => {
    await worker.processVideo(photo);
    expect(mockSend.mock.calls.map(call => call[0].constructor.name)).toEqual(['GetObjectCommand', 'PutObjectCommand', 'PutObjectCommand']);
    expect(faces.indexFaces).toHaveBeenCalledWith(Buffer.from('frame'), 'video_video_v1_t0', 100);
    expect(MediaFace.bulkCreate.mock.calls[0][0][0]).toMatchObject({ photoId: 'video', collectionId: 'existing-collection', timestampMs: 0, processingVersion: 1 });
    expect(Photo.update.mock.calls[0][0]).toMatchObject({ processingStatus: 'completed', durationMs: 2000, faceCount: 1, metadata: { sampleRate: 0.1 } });
    expect(Event.increment).toHaveBeenCalledWith('videoCount', expect.objectContaining({ by: 1 }));
});

test('failed indexing is never published and can be retried', async () => {
    faces.indexFaces.mockRejectedValueOnce(new Error('AWS unavailable'));
    await worker.processVideo(photo);
    expect(Photo.update.mock.calls[0][0]).toMatchObject({ processingStatus: 'failed', processingError: 'AWS unavailable' });
    expect(Event.increment).not.toHaveBeenCalled();
});

test('job claim locks rows and excludes unfinished uploads', async () => {
    const update = jest.fn();
    Photo.findOne.mockResolvedValue({ ...photo, processingAttempts: 0, update });
    await worker.claim();
    expect(Photo.findOne.mock.calls[0][0]).toMatchObject({ where: { mediaType: 'video', uploadStatus: 'completed' }, lock: 'UPDATE', skipLocked: true });
    expect(update.mock.calls[0][0]).toMatchObject({ processingStatus: 'processing', processingAttempts: 1 });
});

test('repeatedly interrupted jobs become failed instead of looping forever', async () => {
    const update = jest.fn();
    Photo.findOne.mockResolvedValue({ ...photo, processingAttempts: 3, update });
    expect(await worker.claim()).toBeNull();
    expect(update.mock.calls[0][0]).toMatchObject({ processingStatus: 'failed' });
});