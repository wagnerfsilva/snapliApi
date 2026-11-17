'use strict';

jest.mock('../../src/models', () => ({
    sequelize: { query: jest.fn() },
    Event: { findByPk: jest.fn() }
}));
jest.mock('../../src/services/s3.service', () => ({
    listKeysByPrefix: jest.fn(),
    deleteFiles: jest.fn()
}));
jest.mock('../../src/services/rekognition.service', () => ({ deleteFaces: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const { sequelize, Event } = require('../../src/models');
const s3Service = require('../../src/services/s3.service');
const rekognitionService = require('../../src/services/rekognition.service');
const { archiveEvent, getArchiveBlockers } = require('../../src/services/event-archive.service');

const NOW = new Date('2026-11-17T12:00:00Z');
const daysAgo = days => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
const daysAhead = days => daysAgo(-days);

let orders;
let event;

beforeEach(() => {
    jest.clearAllMocks();
    orders = [];
    event = { id: 'event-1', name: 'Evento', isActive: true, archivedAt: null, update: jest.fn(async function (values) { Object.assign(this, values); }) };
    Event.findByPk.mockResolvedValue(event);
    sequelize.query.mockImplementation(async sql => {
        if (sql.includes('FROM orders')) return orders;
        if (sql.includes('media_faces')) return [{ faceId: 'video-face' }];
        return [{ originalKey: 'events/event-1/originals/a.jpg', watermarkedKey: 'w/a.jpg', thumbnailKey: 't/a.jpg', previewKey: null, rekognitionFaceId: 'face-1' }];
    });
    s3Service.listKeysByPrefix.mockImplementation(async (prefix, bucket) => (bucket === 'original' ? ['events/event-1/originals/orphan.jpg'] : []));
});

describe('getArchiveBlockers', () => {
    test('allows events whose paid orders all have an expired download window', async () => {
        orders = [{ id: 'o1', status: 'paid', downloadExpiresAt: daysAgo(1), createdAt: daysAgo(100) }];
        expect(await getArchiveBlockers(event, NOW)).toEqual([]);
    });

    test('blocks while any paid or courtesy order can still download', async () => {
        orders = [
            { id: 'o1', status: 'paid', downloadExpiresAt: daysAgo(1), createdAt: daysAgo(100) },
            { id: 'o2', status: 'courtesy', downloadExpiresAt: daysAhead(5), createdAt: daysAgo(85) }
        ];
        const blockers = await getArchiveBlockers(event, NOW);
        expect(blockers.map(b => [b.code, b.orderId])).toEqual([['DOWNLOAD_ACTIVE', 'o2']]);
    });

    test('falls back to paidAt/createdAt + 90 days when the expiry was never set', async () => {
        orders = [
            { id: 'old', status: 'paid', downloadExpiresAt: null, paidAt: daysAgo(91), createdAt: daysAgo(95) },
            { id: 'recent', status: 'completed', downloadExpiresAt: null, paidAt: null, createdAt: daysAgo(30) }
        ];
        const blockers = await getArchiveBlockers(event, NOW);
        expect(blockers.map(b => b.orderId)).toEqual(['recent']);
    });

    test('blocks unpaid orders created less than 10 days ago only', async () => {
        orders = [
            { id: 'fresh', status: 'pending', createdAt: daysAgo(3) },
            { id: 'stale', status: 'processing', createdAt: daysAgo(11) }
        ];
        const blockers = await getArchiveBlockers(event, NOW);
        expect(blockers.map(b => [b.code, b.orderId])).toEqual([['UNPAID_RECENT', 'fresh']]);
    });

    test('blocks events that have not happened yet', async () => {
        event.date = daysAhead(10);
        expect((await getArchiveBlockers(event, NOW)).map(b => b.code)).toEqual(['EVENT_NOT_HAPPENED']);
    });

    test('rejects an already archived event', async () => {
        event.archivedAt = daysAgo(1);
        expect((await getArchiveBlockers(event, NOW))[0].code).toBe('ALREADY_ARCHIVED');
    });
});

describe('archiveEvent', () => {
    test('does not touch anything when blocked or on dry-run', async () => {
        orders = [{ id: 'o1', status: 'paid', downloadExpiresAt: daysAhead(2), createdAt: daysAgo(88) }];
        expect((await archiveEvent('event-1', { now: NOW })).archived).toBe(false);

        orders = [];
        const preview = await archiveEvent('event-1', { dryRun: true, now: NOW });
        expect(preview.summary).toEqual({ originalObjects: 2, watermarkedObjects: 2, faces: 2 });

        expect(event.update).not.toHaveBeenCalled();
        expect(s3Service.deleteFiles).not.toHaveBeenCalled();
        expect(rekognitionService.deleteFaces).not.toHaveBeenCalled();
    });

    test('removes media and faces, then deactivates and stamps archivedAt last', async () => {
        const result = await archiveEvent('event-1', { now: NOW });

        expect(result.archived).toBe(true);
        expect(rekognitionService.deleteFaces).toHaveBeenCalledWith(expect.arrayContaining(['video-face', 'face-1']));
        expect(s3Service.deleteFiles).toHaveBeenCalledWith(expect.arrayContaining(['events/event-1/originals/a.jpg', 'events/event-1/originals/orphan.jpg']), 'original');
        expect(s3Service.deleteFiles).toHaveBeenCalledWith(expect.arrayContaining(['w/a.jpg', 't/a.jpg']), 'watermarked');
        expect(event.update.mock.calls[0][0]).toEqual({ isActive: false });
        expect(event.update.mock.calls.at(-1)[0].archivedAt).toBeInstanceOf(Date);
    });

    test('keeps the event unarchived when S3 deletion fails so it can be retried', async () => {
        s3Service.deleteFiles.mockRejectedValueOnce(new Error('boom'));
        await expect(archiveEvent('event-1', { now: NOW })).rejects.toThrow('boom');
        expect(event.archivedAt).toBeNull();
    });
});
