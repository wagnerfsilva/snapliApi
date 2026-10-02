'use strict';

jest.mock('../../src/models', () => ({ Photo: { findAll: jest.fn() }, MediaFace: { findAll: jest.fn() }, Event: {} }));
jest.mock('../../src/services/rekognition.service', () => ({ searchFacesByImage: jest.fn() }));
jest.mock('../../src/services/s3.service', () => ({ generatePresignedUrl: jest.fn(async key => `signed:${key}`) }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const { Photo, MediaFace } = require('../../src/models');
const rekognition = require('../../src/services/rekognition.service');
const s3 = require('../../src/services/s3.service');
const controller = require('../../src/controllers/search.controller');

const video = { id: 'video', mediaType: 'video', processingVersion: 1, previewKey: 'marked.mp4', thumbnailKey: 'poster.jpg', event: { videoEnabled: true } };

beforeEach(() => jest.clearAllMocks());

async function search(media = [video]) {
    rekognition.searchFacesByImage.mockResolvedValue({ matchCount: 2, matches: [
        { faceId: 'face1', externalImageId: 'video_id_v1_t1000', similarity: 95 },
        { faceId: 'face2', externalImageId: 'video_id_v1_t2000', similarity: 99 }
    ] });
    MediaFace.findAll.mockResolvedValue([
        { faceId: 'face1', photoId: 'video', processingVersion: 1, timestampMs: 1000 },
        { faceId: 'face2', photoId: 'video', processingVersion: 1, timestampMs: 2000 }
    ]);
    Photo.findAll.mockResolvedValue(media);
    const res = { json: jest.fn() };
    const next = jest.fn();
    await controller.searchByFace({ file: { buffer: Buffer.from('selfie') } }, res, next);
    expect(next).not.toHaveBeenCalled();
    return res.json.mock.calls[0][0].data;
}

test('same collection matches yield one video, highest similarity and timestamps', async () => {
    const result = await search();
    expect(rekognition.searchFacesByImage).toHaveBeenCalledTimes(1);
    expect(result.photos).toHaveLength(1);
    expect(result.photos[0]).toMatchObject({ mediaType: 'video', similarity: 99, matchedTimestampsMs: [1000, 2000], previewUrl: 'signed:marked.mp4' });
    expect(s3.generatePresignedUrl.mock.calls.every(call => call[1] === 'watermarked')).toBe(true);
    expect(result.photos[0]).not.toHaveProperty('originalKey');
});

test.each([
    { event: { videoEnabled: false } }, { previewKey: null }, { processingVersion: 2 }
])('disabled, incomplete or stale video matches are not returned: %j', async change => {
    expect((await search([{ ...video, ...change }])).photos).toEqual([]);
    expect(s3.generatePresignedUrl).not.toHaveBeenCalled();
});

test('legacy photo lookup is unchanged and never queries video face records', async () => {
    rekognition.searchFacesByImage.mockResolvedValue({ matchCount: 1, matches: [{ externalImageId: 'photo-file', similarity: 96 }] });
    Photo.findAll.mockResolvedValue([{ id: 'photo', originalFilename: 'photo-file.jpg', watermarkedKey: 'photo.jpg' }]);
    const res = { json: jest.fn() };
    await controller.searchByFace({ file: { buffer: Buffer.from('selfie') } }, res, jest.fn());
    expect(MediaFace.findAll).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data.photos[0]).toMatchObject({ mediaType: 'photo', similarity: 96, watermarkedUrl: 'signed:photo.jpg' });
});