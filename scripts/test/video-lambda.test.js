'use strict';

const mockS3Send = jest.fn();
const mockFaceSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(() => ({ send: mockS3Send })), GetObjectCommand: class GetObjectCommand {}, PutObjectCommand: class PutObjectCommand {}, CopyObjectCommand: class CopyObjectCommand { constructor(input) { this.input = input; } } }));
jest.mock('../../src/config/aws', () => ({ s3Client: { send: mockS3Send }, buckets: { original: 'originals', watermarked: 'marked' }, rekognition: { collectionId: 'existing' } }));
jest.mock('@aws-sdk/client-rekognition', () => ({ RekognitionClient: jest.fn(() => ({ send: mockFaceSend })), IndexFacesCommand: class IndexFacesCommand { constructor(input) { this.input = input; } } }));
jest.mock('../../src/services/video-processing.service', () => ({ prepareVideo: jest.fn() }));
jest.mock('node:fs/promises', () => ({ mkdtemp: jest.fn(async () => '/fake/source'), stat: jest.fn(async () => ({ size: 100 })), readFile: jest.fn(async () => Buffer.from('frame')), rm: jest.fn() }));
jest.mock('node:fs', () => ({ createReadStream: jest.fn(() => 'stream'), createWriteStream: jest.fn(() => 'stream') }));
jest.mock('node:stream/promises', () => ({ pipeline: jest.fn() }));

const { prepareVideo } = require('../../src/services/video-processing.service');
const { handler } = require('../../lambda/video');
const originalKey = 'events/event/videos/video/original.mov';
const event = { Records: [{ s3: { bucket: { name: 'originals' }, object: { key: originalKey } } }] };
const context = { awsRequestId: '11111111-1111-4111-8111-111111111111', getRemainingTimeInMillis: () => 600000 };
const originalFetch = global.fetch;

beforeEach(() => {
    jest.clearAllMocks();
    process.env.API_CALLBACK_URL = 'https://api.example/api/videos/lambda-callback';
    process.env.LAMBDA_INTERNAL_SECRET = 'test-secret';
    process.env.S3_BUCKET_ORIGINAL = 'originals';
    process.env.S3_BUCKET_WATERMARKED = 'marked';
    process.env.REKOGNITION_COLLECTION_ID = 'existing';
    process.env.VIDEO_LAMBDA_ENABLED = 'true';
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: { claimed: true, id: 'video', eventId: 'event', processingVersion: 1, fileSize: 100 } }) }));
    mockS3Send.mockResolvedValue({ Body: 'source' });
    mockFaceSend.mockResolvedValue({ FaceRecords: [{ Face: { FaceId: 'face', Confidence: 99 } }] });
    prepareVideo.mockResolvedValue({ directory: '/fake/output', previewPath: '/fake/preview.mp4', posterPath: '/fake/poster.jpg', metadata: { durationMs: 89637, width: 720, height: 1280 }, sampleRate: 1, frames: [{ filePath: '/fake/frame.jpg', timestampMs: 10000 }] });
});

afterAll(() => { global.fetch = originalFetch; });

test('S3 video Lambda processes media and persists frames through authenticated callbacks', async () => {
    await handler(event, context);
    const payloads = global.fetch.mock.calls.map(call => JSON.parse(call[1].body));
    expect(payloads.map(payload => payload.action)).toEqual(['claim', 'faces', 'completed']);
    expect(payloads[1]).toMatchObject({ faces: [{ faceId: 'face', timestampMs: 10000 }] });
    expect(prepareVideo).toHaveBeenCalledWith(expect.any(String), { sampleRate: 1 });
    expect(payloads[2]).toMatchObject({ sampleRate: 1, faceCount: 1, previewKey: 'events/event/videos/video/v1/preview.mp4' });
    expect(global.fetch.mock.calls[0][1].headers['x-lambda-secret']).toBe('test-secret');
    expect(mockFaceSend.mock.calls[0][0].input).toMatchObject({ CollectionId: 'existing', ExternalImageId: 'video_video_v1_t10000' });
});

test('duplicate completed event does not download, index or count video twice', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: { claimed: false } }) });
    await handler(event, context);
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(prepareVideo).not.toHaveBeenCalled();
});

test('photo S3 paths are never handled by video Lambda', async () => {
    await handler({ Records: [{ s3: { bucket: { name: 'originals' }, object: { key: 'events/event/originals/photo.jpg' } } }] }, context);
    expect(global.fetch).not.toHaveBeenCalled();
});

test('failure reports failed state and throws for Lambda retry', async () => {
    prepareVideo.mockRejectedValueOnce(new Error('bad video'));
    await expect(handler(event, context)).rejects.toThrow('bad video');
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toMatchObject({ action: 'failed', processingError: 'bad video' });
});

test('video uploads remain unavailable until the deployed Lambda is enabled', () => {
    const service = require('../../src/services/video-lambda.service');
    delete process.env.VIDEO_LAMBDA_ENABLED;
    expect(service.isReady()).toBe(false);
    process.env.VIDEO_LAMBDA_ENABLED = 'true';
    expect(service.isReady()).toBe(true);
});

test('manual retry triggers S3 copy without changing the original key', async () => {
    await require('../../src/services/video-lambda.service').retry({ originalKey });
    expect(mockS3Send.mock.calls[0][0].input).toMatchObject({ Bucket: 'originals', Key: originalKey, CopySource: `originals/${originalKey}`, MetadataDirective: 'COPY' });
});