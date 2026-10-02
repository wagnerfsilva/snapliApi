'use strict';

const mockSend = jest.fn();
jest.mock('../../src/config/aws', () => ({ s3Client: { send: mockSend }, buckets: { original: 'private-originals' } }));
const upload = require('../../src/services/video-upload.service');

test('accepts the real MOV size and normalizes MIME without trusting the browser', () => {
    expect(upload.validateUpload({ filename: 'IMG_5416.MOV', fileSize: 510090617, mimeType: '' })).toBe('video/quicktime');
});

test.each(['../file.MOV', 'file\r\n.MOV', 'photo.jpg'])('rejects unsafe or unsupported filename %s', filename => {
    expect(() => upload.validateUpload({ filename, fileSize: 100 })).toThrow();
});

test('rejects wrong size and incomplete or duplicate parts', () => {
    expect(() => upload.validateUpload({ filename: 'video.mp4', fileSize: 500 * 1024 * 1024 + 1 })).toThrow();
    expect(() => upload.validateParts([], 1)).toThrow();
    expect(() => upload.validateParts([{ PartNumber: 1, ETag: 'one' }, { PartNumber: 1, ETag: 'two' }], upload.PART_SIZE + 1)).toThrow();
});

test('checks exact part length before any S3 write', async () => {
    mockSend.mockClear();
    await expect(upload.part({ fileSize: upload.PART_SIZE + 1 }, 1, Buffer.alloc(1))).rejects.toThrow();
    expect(mockSend).not.toHaveBeenCalled();
});

test('completion tolerates a completed S3 upload only if the final object size matches', async () => {
    mockSend.mockReset();
    mockSend.mockRejectedValueOnce(Object.assign(new Error('Completed'), { name: 'NoSuchUpload' })).mockResolvedValueOnce({ ContentLength: 10 });
    await upload.finish({ fileSize: 10, originalKey: 'video', uploadId: 'upload' }, [{ PartNumber: 1, ETag: 'etag' }]);
    mockSend.mockRejectedValueOnce(Object.assign(new Error('Completed'), { name: 'NoSuchUpload' })).mockResolvedValueOnce({ ContentLength: 11 });
    await expect(upload.finish({ fileSize: 10, originalKey: 'video', uploadId: 'upload' }, [{ PartNumber: 1, ETag: 'etag' }])).rejects.toThrow();
});