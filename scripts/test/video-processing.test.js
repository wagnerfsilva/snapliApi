'use strict';

const { validateVideoMetadata, sampleTimestamps, imageFilter, MAX_VIDEO_BYTES } = require('../../src/services/video-processing.service');

const mockSend = jest.fn();
const mockDestroy = jest.fn();
jest.mock('@aws-sdk/client-rekognition', () => ({
    ...jest.requireActual('@aws-sdk/client-rekognition'),
    RekognitionClient: jest.fn(() => ({ send: mockSend, destroy: mockDestroy }))
}));
jest.mock('dotenv', () => ({ config: jest.fn() }));

const fs = require('node:fs/promises');
const { validateRekognition } = require('./validate-video');

const metadata = {
    format: { duration: '89.636667', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    streams: [
        { codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160, color_transfer: 'arib-std-b67', side_data_list: [{ rotation: -90 }] },
        { codec_type: 'audio', codec_name: 'aac' }
    ]
};

test('IMG_5416 metadata fits 500 MiB and preserves portrait HDR information', () => {
    expect(validateVideoMetadata(metadata, 510090617)).toMatchObject({
        durationMs: 89637, width: 2160, height: 3840, hdr: true, rotation: -90, hasAudio: true
    });
    expect(510090617).toBeGreaterThan(500000000);
    expect(510090617).toBeLessThan(MAX_VIDEO_BYTES);
});

test('samples one frame every ten seconds by default', () => {
    const frames = sampleTimestamps(89637);
    expect(frames).toEqual([0, 10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000]);
    expect(sampleTimestamps(10000)).toEqual([0]);
    expect(sampleTimestamps(10001)).toEqual([0, 10000]);
    expect(sampleTimestamps(120000)).toHaveLength(12);
    expect(sampleTimestamps(89637, 1)).toHaveLength(90);
    expect(sampleTimestamps(89637, 0.5)).toHaveLength(45);
    expect(sampleTimestamps(89637, 2)).toHaveLength(180);
});

test('HDR is tone mapped but ordinary SDR does not need HDR conversion', () => {
    expect(imageFilter({ hdr: true }, 1280)).toContain('tonemap=tonemap=hable');
    expect(imageFilter({ hdr: true }, 1280)).toContain('zscale=t=bt709');
    expect(imageFilter({ hdr: false }, 1280)).not.toContain('tonemap');
    expect(imageFilter({ hdr: false }, 1280)).toContain('min(1280,iw)');
});

test.each([0, MAX_VIDEO_BYTES + 1, NaN])('rejects invalid size %s', size => {
    expect(() => validateVideoMetadata(metadata, size)).toThrow();
});

test.each(['0', '121', 'NaN'])('rejects invalid duration %s', duration => {
    expect(() => validateVideoMetadata({ ...metadata, format: { ...metadata.format, duration } }, 100)).toThrow();
});

test('rejects unsupported codec, corrupt format and missing video', () => {
    expect(() => validateVideoMetadata({ ...metadata, streams: [{ ...metadata.streams[0], codec_name: 'vp9' }] }, 100)).toThrow();
    expect(() => validateVideoMetadata({ ...metadata, format: { ...metadata.format, format_name: 'matroska' } }, 100)).toThrow();
    expect(() => validateVideoMetadata({ ...metadata, streams: [] }, 100)).toThrow();
});

test.each([0, -1, 120001, NaN])('rejects invalid sampling duration %s', duration => {
    expect(() => sampleTimestamps(duration)).toThrow();
});

test.each([0, 30, Infinity])('rejects unbounded sampling rate %s', rate => {
    expect(() => sampleTimestamps(1000, rate)).toThrow();
});

describe('AWS test cleanup gates', () => {
    const localReport = { originalUnchanged: true, sampleRate: 1, frames: [{ timestampMs: 0 }], source: 'fixture.MOV' };

    afterEach(() => {
        jest.restoreAllMocks();
        mockSend.mockReset();
        mockDestroy.mockReset();
    });

    test('existing pending collection blocks all AWS requests', async () => {
        jest.spyOn(fs, 'readFile')
            .mockResolvedValueOnce(JSON.stringify(localReport))
            .mockResolvedValueOnce(JSON.stringify({ collectionId: 'pending-test', collectionDeleted: false }));
        await expect(validateRekognition('/fixture/report.json')).rejects.toThrow('Limpeza AWS pendente');
        expect(mockSend).not.toHaveBeenCalled();
    });

    test('deletion permission is checked before any images and denied calls are not retried', async () => {
        jest.spyOn(fs, 'readFile')
            .mockResolvedValueOnce(JSON.stringify(localReport))
            .mockRejectedValueOnce(Object.assign(new Error('Not found'), { code: 'ENOENT' }));
        const write = jest.spyOn(fs, 'writeFile').mockResolvedValue();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        mockSend
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(Object.assign(new Error('Cleanup denied'), { name: 'AccessDeniedException' }));
        await expect(validateRekognition('/fixture/report.json')).rejects.toThrow('Cleanup denied');
        expect(mockSend.mock.calls.map(call => call[0].constructor.name)).toEqual(['CreateCollectionCommand', 'DeleteCollectionCommand']);
        const report = JSON.parse(write.mock.calls.at(-1)[1]);
        expect(report).toMatchObject({ framesProcessed: 0, indexCalls: 0, collectionDeleted: false, status: 'cleanup_failed' });
        expect(mockDestroy).toHaveBeenCalled();
    });
});