'use strict';

jest.mock('../../src/models', () => ({
    Event: { create: jest.fn(), findByPk: jest.fn(), findAndCountAll: jest.fn() },
    User: { findByPk: jest.fn(), findAll: jest.fn() },
    Photo: { findByPk: jest.fn(), findAll: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
    WithdrawalRequest: { create: jest.fn(), findAll: jest.fn(), findByPk: jest.fn() },
    MediaFace: {}, OrderItem: {},
    sequelize: { transaction: jest.fn(), query: jest.fn() }
}));
jest.mock('../../src/config/jwt', () => ({ secret: 'event-approval-tests-only', issuer: 'tests', audience: 'tests' }));
jest.mock('../../src/config/aws', () => ({ rekognition: { collectionId: 'tests' } }));
jest.mock('../../src/services/s3.service', () => ({ uploadOriginal: jest.fn(), generatePresignedUrl: jest.fn() }));
jest.mock('../../src/services/image.service', () => ({ getMetadata: jest.fn() }));
jest.mock('../../src/services/rekognition.service', () => ({ searchFacesByImage: jest.fn() }));
jest.mock('../../src/services/video-upload.service', () => ({ start: jest.fn(), part: jest.fn(), finish: jest.fn(), cancel: jest.fn() }));
jest.mock('../../src/services/media-preview.service', () => ({ previewUrls: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const config = require('../../src/config/jwt');
const { Event, User, Photo, WithdrawalRequest, sequelize } = require('../../src/models');
const storage = require('../../src/services/s3.service');
const uploads = require('../../src/services/video-upload.service');
const rekognition = require('../../src/services/rekognition.service');
const { errorHandler } = require('../../src/middleware/errorHandler');
const app = express();
app.use(express.json());
app.use('/events', require('../../src/routes/event.routes'));
app.use('/withdrawals', require('../../src/routes/withdrawal.routes'));
app.use('/photos', require('../../src/routes/photo.routes'));
app.use('/videos', require('../../src/routes/video.routes'));
app.use('/search', require('../../src/routes/search.routes'));
app.use('/users', require('../../src/routes/user.routes'));
app.use(errorHandler);

const photographerId = '11111111-1111-4111-8111-111111111111';
const organizerId = '22222222-2222-4222-8222-222222222222';
const adminId = '33333333-3333-4333-8333-333333333333';
const eventId = '44444444-4444-4444-8444-444444444444';
const otherId = '55555555-5555-4555-8555-555555555555';
const mediaId = '66666666-6666-4666-8666-666666666666';
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
let event;
let users;
let withdrawals;

function auth(role = 'fotografo', id) {
    const userId = id || { admin: adminId, fotografo: photographerId, organizador: organizerId }[role];
    return jwt.sign({ userId }, config.secret, { issuer: config.issuer, audience: config.audience });
}

function send(method, path, body, role = 'fotografo', id) {
    return request(app)[method](path).auth(auth(role, id), { type: 'bearer' }).send(body);
}

beforeEach(() => {
    jest.resetAllMocks();
    users = {
        [adminId]: { id: adminId, role: 'admin', isActive: true },
        [photographerId]: { id: photographerId, role: 'fotografo', isActive: true, pixKey: 'photo-pix' },
        [organizerId]: { id: organizerId, role: 'organizador', isActive: true, pixKey: 'organizer-pix' },
        [otherId]: { id: otherId, role: 'fotografo', isActive: true, pixKey: 'other-pix' }
    };
    event = {
        id: eventId, name: 'Evento', date: '2026-11-20', createdBy: photographerId,
        approvalStatus: 'pending', isActive: false, archivedAt: null,
        photographerId, photographerCommissionPercentage: 50,
        organizerId, organizerCommissionPercentage: 15,
        update: jest.fn(async function (values) { Object.assign(this, values); return this; })
    };
    withdrawals = [];
    let tail = Promise.resolve();
    sequelize.transaction.mockImplementation(callback => {
        const result = tail.then(() => callback(transaction));
        tail = result.catch(() => {});
        return result;
    });
    User.findByPk.mockImplementation(async id => users[id]);
    User.findAll.mockResolvedValue([]);
    Event.findByPk.mockImplementation(async () => event);
    Event.create.mockImplementation(async values => ({ id: eventId, ...values }));
    Event.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
    Photo.findByPk.mockImplementation(async () => ({ id: mediaId, eventId, mediaType: 'video', event }));
    Photo.findAll.mockResolvedValue([]);
    Photo.count.mockResolvedValue(0);
    WithdrawalRequest.create.mockImplementation(async data => {
        const stored = {
            id: `withdrawal-${withdrawals.length}`, ...data,
            update: async function (values) { Object.assign(this, values); return this; }
        };
        withdrawals.push(stored);
        return stored;
    });
    WithdrawalRequest.findByPk.mockImplementation(async id => withdrawals.find(row => row.id === id));
    WithdrawalRequest.findAll.mockImplementation(async ({ where }) => withdrawals.filter(row => (
        Object.entries(where).every(([key, value]) => row[key] === value)
    )));
    sequelize.query.mockImplementation(async (sql, options) => {
        expect(options.transaction === undefined || options.transaction === transaction).toBe(true);
        const field = sql.includes('"photographerId" IS NOT NULL') ? 'photographerId' : 'organizerId';
        const reserved = withdrawals.filter(row => row[field] && ['pending', 'approved', 'paid'].includes(row.status));
        if (sql.includes('AS "count"')) return [{ count: reserved.filter(row => row.status !== 'paid').length }];
        if (sql.includes('AS "reservedOrPaidTotal"')) return [{ reservedOrPaidTotal: reserved.reduce((sum, row) => sum + row.amount, 0) }];
        if (sql.includes('AS "totalOrders"')) return [{ totalOrders: 1, totalRevenue: 100, totalPhotosSold: 3 }];
        return [];
    });
});

test('photographer creation fixes the beneficiary and approval state on the server', async () => {
    const response = await send('post', '/events', {
        name: 'Evento', date: '2026-11-20', organizerId, organizerCommissionPercentage: 15,
        photographerId: otherId, photographerCommissionPercentage: 50,
        isActive: true, approvalStatus: 'approved', approvedBy: adminId
    });
    expect(response.status).toBe(201);
    expect(Event.create).toHaveBeenCalledWith(expect.objectContaining({
        createdBy: photographerId, photographerId, approvalStatus: 'pending',
        isActive: false, approvedBy: null, approvedAt: null
    }));
});

test('admin can create an immediately approved event without either beneficiary', async () => {
    const response = await send('post', '/events', { name: 'Evento', date: '2026-11-20' }, 'admin');
    expect(response.status).toBe(201);
    expect(response.body.data.event).toMatchObject({
        approvalStatus: 'approved', isActive: true, organizerId: null, photographerId: null, approvedBy: adminId
    });
});

test.each([
    { photographerCommissionPercentage: 85.01 },
    { photographerCommissionPercentage: 1.001 },
    { photographerCommissionPercentage: null },
    { photographerCommissionPercentage: -1 }
])('rejects invalid or combined commissions before creating an event: %j', async changes => {
    const response = await send('post', '/events', {
        name: 'Evento', date: '2026-11-20', organizerId, organizerCommissionPercentage: 15,
        photographerCommissionPercentage: 50, ...changes
    });
    expect(response.status).toBe(400);
    expect(Event.create).not.toHaveBeenCalled();
});

test('accepts fractional commissions whose sum is exactly 100%', async () => {
    const response = await send('post', '/events', {
        name: 'Evento', date: '2026-11-20', organizerId, organizerCommissionPercentage: 15.15,
        photographerCommissionPercentage: 84.85
    });
    expect(response.status).toBe(201);
});

test('inactive or wrong-role beneficiaries are refused', async () => {
    users[organizerId].isActive = false;
    expect((await send('post', '/events', {
        name: 'Evento', date: '2026-11-20', organizerId, organizerCommissionPercentage: 15, photographerCommissionPercentage: 50
    })).status).toBe(400);
    users[organizerId].isActive = true;
    users[organizerId].role = 'fotografo';
    expect((await send('patch', `/events/${eventId}/approve`, {}, 'admin')).status).toBe(400);
});

test.each(['fotografo', 'organizador'])('only admin can approve; %s cannot', async role => {
    expect((await send('patch', `/events/${eventId}/approve`, {}, role)).status).toBe(403);
    expect(event.update).not.toHaveBeenCalled();
});

test('admin validates and saves the final commissions in the approval transaction', async () => {
    const response = await send('patch', `/events/${eventId}/approve`, { name: 'Validado', photographerCommissionPercentage: 60 }, 'admin');
    expect(response.status).toBe(200);
    expect(event).toMatchObject({ name: 'Validado', approvalStatus: 'approved', isActive: true, photographerCommissionPercentage: 60, approvedBy: adminId });
    expect(event.approvedAt).toBeInstanceOf(Date);
    expect(Event.findByPk).toHaveBeenCalledWith(eventId, { transaction, lock: 'UPDATE' });
    expect(event.update.mock.calls[0][1].transaction).toBe(transaction);
    expect((await send('patch', `/events/${eventId}/approve`, { name: 'Sobrescrito' }, 'admin')).status).toBe(409);
    expect(event.name).toBe('Validado');
});

test('two approval requests cannot replace the first approved configuration', async () => {
    const results = await Promise.all([
        send('patch', `/events/${eventId}/approve`, { photographerCommissionPercentage: 60 }, 'admin'),
        send('patch', `/events/${eventId}/approve`, { photographerCommissionPercentage: 70 }, 'admin')
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(event.update).toHaveBeenCalledTimes(1);
});

test.each([
    ['put', { name: 'Alterado' }, 'fotografo', 409],
    ['delete', {}, 'fotografo', 409],
    ['put', { isActive: true }, 'admin', 409],
    ['put', { approvalStatus: 'approved' }, 'admin', 400]
])('pending event rejects %s %j for %s', async (method, body, role, status) => {
    expect((await send(method, `/events/${eventId}`, body, role)).status).toBe(status);
    expect(event.update).not.toHaveBeenCalled();
});

test('approved financial fields remain admin-only and partial edits validate the final sum', async () => {
    event.approvalStatus = 'approved';
    expect((await send('put', `/events/${eventId}`, { photographerCommissionPercentage: 60 })).status).toBe(403);
    expect((await send('put', `/events/${eventId}`, { organizerCommissionPercentage: 51 }, 'admin')).status).toBe(400);
    expect(event.update).not.toHaveBeenCalled();
    expect((await send('put', `/events/${eventId}`, { photographerCommissionPercentage: 0 }, 'admin')).status).toBe(200);
});

test('assigned photographer can access and edit an approved event created by admin', async () => {
    event.createdBy = adminId;
    event.approvalStatus = 'approved';
    expect((await send('get', `/events/${eventId}`)).status).toBe(200);
    expect((await send('put', `/events/${eventId}`, { name: 'Renomeado' })).status).toBe(200);
    expect((await send('get', `/events/${eventId}`, undefined, 'fotografo', otherId)).status).toBe(403);
});

test('photographer listing combines ownership and assignment without replacing search criteria', async () => {
    expect((await request(app).get('/events?search=Festival').auth(auth(), { type: 'bearer' })).status).toBe(200);
    const { where } = Event.findAndCountAll.mock.calls[0][0];
    expect(where[Op.and]).toEqual([{ [Op.or]: [{ createdBy: photographerId }, { photographerId }] }]);
    expect(where[Op.or]).toHaveLength(3);
});

test('only admin searches photographers; the lookup remains bounded to active photographers', async () => {
    expect((await send('get', '/users/search-photographers?q=ab')).status).toBe(403);
    expect((await send('get', '/users/search-photographers?q=ab', undefined, 'admin')).status).toBe(200);
    expect(User.findAll).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ role: 'fotografo', isActive: true }), limit: 8
    }));
});

test('pending photo upload by event ID is refused before any storage write', async () => {
    const response = await request(app).post('/photos/upload').auth(auth(), { type: 'bearer' })
        .field('eventId', eventId).attach('photos', Buffer.from('image'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(response.status).toBe(409);
    expect(storage.uploadOriginal).not.toHaveBeenCalled();
    expect(Photo.create).not.toHaveBeenCalled();
});

test.each([
    ['get', `/photos/event/${eventId}`, {}],
    ['get', `/photos/event/${eventId}/gallery`, {}],
    ['get', `/photos/${mediaId}`, {}],
    ['get', `/photos/${mediaId}/download`, {}],
    ['post', `/photos/${mediaId}/retry`, {}],
    ['delete', `/photos/${mediaId}`, {}],
    ['post', '/videos/uploads', { eventId }],
    ['put', `/videos/uploads/${mediaId}/parts/1`, {}],
    ['post', `/videos/uploads/${mediaId}/complete`, { parts: [] }],
    ['delete', `/videos/uploads/${mediaId}`, {}],
    ['get', `/videos/${mediaId}/status`, {}],
    ['get', `/search/event/${eventId}`, {}]
])('pending event blocks %s %s, including admin operational use', async (method, path, body) => {
    expect((await send(method, path, body)).status).toBe(409);
    expect((await send(method, path, body, 'admin')).status).toBe(409);
    expect(storage.generatePresignedUrl).not.toHaveBeenCalled();
    expect(uploads.start).not.toHaveBeenCalled();
    expect(uploads.part).not.toHaveBeenCalled();
    expect(uploads.finish).not.toHaveBeenCalled();
});

test('facial lookup requires approved, active and nonarchived events in the database query', async () => {
    rekognition.searchFacesByImage.mockResolvedValue({ matchCount: 1, matches: [{ externalImageId: mediaId }] });
    const result = await request(app).post('/search/face')
        .attach('searchPhoto', Buffer.from('reference'), { filename: 'face.jpg', contentType: 'image/jpeg' });
    expect(result.status).toBe(200);
    expect(Photo.findAll.mock.calls[0][0].include[0].where).toEqual({ approvalStatus: 'approved', isActive: true, archivedAt: null });
});

test('authorship alone does not grant withdrawal rights', async () => {
    event.approvalStatus = 'approved';
    event.photographerId = otherId;
    expect((await send('get', `/withdrawals/balance/${eventId}`)).status).toBe(403);
    expect((await send('post', '/withdrawals', { eventId, amount: 10 })).status).toBe(403);
});

test('pending approval and missing PIX prevent withdrawals', async () => {
    expect((await send('post', '/withdrawals', { eventId, amount: 10 })).status).toBe(409);
    event.approvalStatus = 'approved';
    users[photographerId].pixKey = null;
    expect((await send('post', '/withdrawals', { eventId, amount: 10 })).status).toBe(400);
    expect(WithdrawalRequest.create).not.toHaveBeenCalled();
});

test('both beneficiaries can reserve independently and cannot choose the other commission', async () => {
    event.approvalStatus = 'approved';
    expect((await send('post', '/withdrawals', { eventId, amount: 10 }, 'organizador')).status).toBe(201);
    expect((await send('post', '/withdrawals', { eventId, amount: 40, organizerId, photographerId: otherId })).status).toBe(201);
    expect(withdrawals).toEqual([
        expect.objectContaining({ organizerId, photographerId: null, pixKey: 'organizer-pix' }),
        expect.objectContaining({ organizerId: null, photographerId, pixKey: 'photo-pix' })
    ]);
    const photoBalance = await send('get', `/withdrawals/balance/${eventId}?commissionType=organizer`);
    const organizerBalance = await send('get', `/withdrawals/balance/${eventId}?commissionType=photographer`, undefined, 'organizador');
    expect(photoBalance.body.data).toMatchObject({ commissionType: 'photographer', balance: { commissionTotal: 50, availableBalance: 10 } });
    expect(organizerBalance.body.data).toMatchObject({ commissionType: 'organizer', balance: { commissionTotal: 15, availableBalance: 5 } });
    expect(Event.findByPk).toHaveBeenCalledWith(eventId, { transaction, lock: 'UPDATE' });
});

test('duplicate concurrent withdrawals reserve only once; rejecting frees that commission', async () => {
    event.approvalStatus = 'approved';
    const results = await Promise.all([
        send('post', '/withdrawals', { eventId, amount: 40 }),
        send('post', '/withdrawals', { eventId, amount: 40 })
    ]);
    expect(results.map(result => result.status).sort()).toEqual([201, 400]);
    expect(withdrawals).toHaveLength(1);
    expect((await send('patch', '/withdrawals/withdrawal-0/status', { status: 'rejected' }, 'admin')).status).toBe(200);
    expect((await send('post', '/withdrawals', { eventId, amount: 50 })).status).toBe(201);
});

test('each beneficiary sees only their own withdrawal history after reassignment', async () => {
    event.approvalStatus = 'approved';
    await send('post', '/withdrawals', { eventId, amount: 40 });
    withdrawals[0].status = 'paid';
    event.photographerId = otherId;
    const previous = await send('get', '/withdrawals');
    const current = await send('get', `/withdrawals/balance/${eventId}`, undefined, 'fotografo', otherId);
    expect(previous.body.data.withdrawalRequests).toHaveLength(1);
    expect(current.body.data.balance.availableBalance).toBe(10);
    expect((await send('get', '/withdrawals', undefined, 'fotografo', otherId)).body.data.withdrawalRequests).toEqual([]);
    expect(withdrawals[0]).toMatchObject({ photographerId, amount: 40, pixKey: 'photo-pix' });
});
