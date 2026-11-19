'use strict';

const { spawnSync } = require('node:child_process');

jest.mock('../../src/models', () => ({
    Order: { findByPk: jest.fn(), findAll: jest.fn() },
    OrderItem: { findAll: jest.fn(), bulkCreate: jest.fn() },
    Photo: { findAll: jest.fn() },
    Event: { findByPk: jest.fn() },
    User: { findByPk: jest.fn() },
    sequelize: { transaction: jest.fn(), query: jest.fn() }
}));
jest.mock('../../src/config/jwt', () => ({
    secret: 'order-photo-update-test-secret', issuer: 'snapli-test', audience: 'snapli-test-users'
}));
jest.mock('../../src/services/rekognition.service', () => ({ searchFacesByImage: jest.fn() }));
jest.mock('../../src/services/s3.service', () => ({ generatePresignedUrl: jest.fn(async key => `signed:${key}`) }));
jest.mock('../../src/services/pix.service', () => ({ createPixPayment: jest.fn() }));
jest.mock('../../src/services/email.service', () => ({ sendDownloadEmail: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const models = require('../../src/models');
const config = require('../../src/config/jwt');
const service = require('../../src/services/order-photo-update.service');
const commission = require('../../src/services/commission.service');
const rekognition = require('../../src/services/rekognition.service');
const pix = require('../../src/services/pix.service');
const email = require('../../src/services/email.service');
const routes = require('../../src/routes/order.routes');

const orderId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const oldId = '33333333-3333-4333-8333-333333333333';
const newId = '44444444-4444-4444-8444-444444444444';
const otherId = '55555555-5555-4555-8555-555555555555';
const adminId = 'admin';
const basePath = `/orders/${orderId}/events/${eventId}/photo-updates`;
const transaction = { LOCK: { UPDATE: 'UPDATE', SHARE: 'SHARE' } };
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/orders', routes);
app.use((error, req, res, next) => res.status(400).json({ error: error.message }));
let order;
let event;
let items;

function auth(role = 'admin', userId = adminId) {
    models.User.findByPk.mockResolvedValue({ id: userId, role, isActive: true });
    return jwt.sign({ userId }, config.secret, { issuer: config.issuer, audience: config.audience });
}

function signedPreview(changes = {}, options = {}) {
    return jwt.sign({ orderId, eventId, adminId, photoIds: [newId], ...changes }, config.secret, {
        issuer: config.issuer, audience: 'snapli-order-photo-update', expiresIn: '15m', ...options
    });
}

function previewRequest() {
    return request(app).post(`${basePath}/preview`).auth(auth(), { type: 'bearer' })
        .attach('searchPhoto', Buffer.from('reference'), { filename: 'reference.jpg', contentType: 'image/jpeg' });
}

function confirmRequest(body = {}) {
    return request(app).post(`${basePath}/confirm`).auth(auth(), { type: 'bearer' })
        .send({ previewToken: signedPreview(), photoIds: [newId], ...body });
}

beforeEach(() => {
    jest.clearAllMocks();
    order = {
        id: orderId, status: 'paid', totalAmount: '99.90', paymentId: 'original-payment',
        paidAt: new Date('2026-11-16T20:00:00Z'), downloadToken: 'original-token',
        downloadExpiresAt: new Date('2027-02-01T00:00:00Z')
    };
    event = { id: eventId, createdBy: adminId, name: 'Evento', isActive: true, approvalStatus: 'approved', archivedAt: null, allPhotosPrice: '99.90' };
    items = [{ orderId, photoId: oldId, price: '99.90', photo: { id: oldId, eventId, mediaType: 'photo' } }];
    models.Order.findByPk.mockImplementation(async () => order);
    models.Event.findByPk.mockImplementation(async () => event);
    models.OrderItem.findAll.mockImplementation(async () => items);
    models.Order.findAll.mockImplementation(async () => [{ ...order, items }]);
    models.OrderItem.bulkCreate.mockImplementation(async additions => {
        items.push(...additions.map(item => ({ ...item, photo: { id: item.photoId, eventId, mediaType: 'photo' } })));
        return additions;
    });
    models.Photo.findAll.mockResolvedValue([{
        id: newId, eventId, mediaType: 'photo', processingStatus: 'completed',
        createdAt: new Date('2026-11-15T00:00:00Z'), watermarkedKey: 'marked.jpg',
        originalKey: 'private-original.jpg', faceData: ['private-face']
    }]);
    models.sequelize.transaction.mockImplementation(callback => callback(transaction));
    rekognition.searchFacesByImage.mockResolvedValue({
        matchCount: 1, searchedFaceConfidence: 99, matches: [{ faceId: 'face', externalImageId: newId, similarity: 99 }]
    });
});

test.each(['pending', 'processing', 'refunded', 'cancelled', 'courtesy'])('rejects %s orders before searching or adding photos', async status => {
    order.status = status;
    const preview = await previewRequest();
    const confirm = await confirmRequest();
    expect(preview.status).toBe(409);
    expect(confirm.status).toBe(409);
    expect(rekognition.searchFacesByImage).not.toHaveBeenCalled();
    expect(models.OrderItem.bulkCreate).not.toHaveBeenCalled();
});

test.each([
    ['inactive', () => { event.isActive = false; }],
    ['pending approval', () => { event.approvalStatus = 'pending'; }],
    ['archived', () => { event.archivedAt = new Date(); }],
    ['no full-photo price', () => { event.allPhotosPrice = null; }],
    ['partial purchase', () => { order.totalAmount = '99.89'; }],
    ['no payment date', () => { order.paidAt = null; }]
])('rejects %s contexts', async (name, change) => {
    change();
    expect((await previewRequest()).status).toBe(409);
    expect((await confirmRequest()).status).toBe(409);
    expect(models.OrderItem.bulkCreate).not.toHaveBeenCalled();
});

test('completed paid orders are eligible, but other events and videos do not inflate the full-photo amount', () => {
    order.status = 'completed';
    order.totalAmount = '199.80';
    items.push({ price: '99.90', photoId: otherId, photo: { eventId: otherId, mediaType: 'photo' } });
    expect(service.eligibility(order, event, items).eligible).toBe(true);
    order.totalAmount = '99.90';
    expect(service.eligibility(order, event, items).eligible).toBe(false);
    items[1].photo = { eventId, mediaType: 'video' };
    expect(service.eligibility(order, event, items).eligible).toBe(false);
});

test.each([null, 'fotografo', 'organizador'])('requires an administrator for both endpoints: %s', async role => {
    for (const action of ['preview', 'confirm']) {
        let req = request(app).post(`${basePath}/${action}`);
        if (role) req = req.auth(auth(role), { type: 'bearer' });
        expect((await req.send({})).status).toBe(role ? 403 : 401);
    }
    expect(models.Order.findByPk).not.toHaveBeenCalled();
    expect(rekognition.searchFacesByImage).not.toHaveBeenCalled();
});

test('preview includes photos from before payment, restricts the event, excludes purchased items and exposes only previews', async () => {
    const response = await previewRequest();
    expect(response.status).toBe(200);
    expect(rekognition.searchFacesByImage).toHaveBeenCalledWith(Buffer.from('reference'), 4096);
    const where = models.Photo.findAll.mock.calls[0][0].where;
    expect(where).toMatchObject({
        eventId, mediaType: 'photo', processingStatus: 'completed'
    });
    expect(where).not.toHaveProperty('createdAt');
    expect(where[Op.and][1]).toEqual({ id: { [Op.notIn]: [oldId] } });
    expect(where[Op.and][0][Op.or]).toContainEqual({ id: { [Op.in]: [newId] } });
    expect(response.body.data.photos).toEqual([expect.objectContaining({ id: newId, watermarkedUrl: 'signed:marked.jpg' })]);
    expect(new Date(response.body.data.photos[0].createdAt).getTime()).toBeLessThan(order.paidAt.getTime());
    const payload = jwt.verify(response.body.data.previewToken, config.secret, { audience: 'snapli-order-photo-update' });
    expect(payload).toMatchObject({ orderId, eventId, adminId, photoIds: [newId] });
    expect(payload.exp - payload.iat).toBe(15 * 60);
    expect(JSON.stringify(response.body)).not.toContain('private-original');
    expect(JSON.stringify(response.body)).not.toContain('private-face');
    expect(models.OrderItem.bulkCreate).not.toHaveBeenCalled();
});

test('no new matching photos returns an empty preview without a confirmation token', async () => {
    rekognition.searchFacesByImage.mockResolvedValue({ matchCount: 0, searchedFaceConfidence: 99, matches: [] });
    const response = await previewRequest();
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ photos: [], previewToken: null });
    expect(models.Photo.findAll).not.toHaveBeenCalled();
});

test('video-only face matches are not eligible photo additions', async () => {
    rekognition.searchFacesByImage.mockResolvedValue({ matchCount: 1, matches: [{ externalImageId: 'video_frame' }] });
    expect((await previewRequest()).body.data).toEqual({ photos: [], previewToken: null });
    expect(models.Photo.findAll).not.toHaveBeenCalled();
});

test('missing reference or no detected face is rejected explicitly', async () => {
    expect((await request(app).post(`${basePath}/preview`).auth(auth(), { type: 'bearer' })).status).toBe(400);
    rekognition.searchFacesByImage.mockResolvedValue({ matchCount: 0, matches: [], error: 'Nenhuma face detectada' });
    expect((await previewRequest()).status).toBe(400);
});

test('confirmation accepts photos from before payment at zero price, keeps all order fields and is idempotent', async () => {
    const originalOrder = { ...order };
    const response = await confirmRequest({ photoIds: [newId, newId] });
    expect(response.status).toBe(200);
    expect(response.body.data.addedCount).toBe(1);
    expect(models.OrderItem.bulkCreate).toHaveBeenCalledWith([{ orderId, photoId: newId, price: 0 }], {
        transaction, validate: true
    });
    expect(models.Order.findByPk).toHaveBeenCalledWith(orderId, { transaction, lock: transaction.LOCK.UPDATE });
    expect(models.Event.findByPk).toHaveBeenCalledWith(eventId, { transaction, lock: transaction.LOCK.SHARE });
    expect(models.Photo.findAll.mock.calls[0][0]).toMatchObject({
        where: { eventId, mediaType: 'photo', processingStatus: 'completed' },
        transaction, lock: transaction.LOCK.SHARE
    });
    expect(models.Photo.findAll.mock.calls[0][0].where).not.toHaveProperty('createdAt');
    expect(order).toEqual(originalOrder);
    expect(items[0].price).toBe('99.90');
    expect(pix.createPixPayment).not.toHaveBeenCalled();
    expect(email.sendDownloadEmail).not.toHaveBeenCalled();
    const retry = await confirmRequest();
    expect(retry.status).toBe(200);
    expect(retry.body.data.addedCount).toBe(0);
    expect(models.OrderItem.bulkCreate).toHaveBeenCalledTimes(1);
});

test.each([
    [{ previewToken: 'tampered-token' }],
    [{ previewToken: signedPreview({}, { expiresIn: -1 }) }],
    [{ previewToken: signedPreview({ adminId: 'other-admin' }) }],
    [{ previewToken: signedPreview({ orderId: otherId }) }],
    [{ previewToken: signedPreview({ eventId: otherId }) }],
    [{ photoIds: [otherId] }],
    [{ photoIds: [] }]
])('rejects invalid, expired or out-of-scope confirmation: %j', async body => {
    expect((await confirmRequest(body)).status).toBe(400);
    expect(models.OrderItem.bulkCreate).not.toHaveBeenCalled();
    expect(models.sequelize.transaction).not.toHaveBeenCalled();
});

test('a preview token cannot authenticate as a user', async () => {
    const response = await request(app).post(`${basePath}/confirm`)
        .auth(signedPreview(), { type: 'bearer' }).send({ previewToken: signedPreview(), photoIds: [newId] });
    expect(response.status).toBe(401);
});

test('confirmation rechecks eligibility after preview and refuses a newly refunded order', async () => {
    const preview = await previewRequest();
    order.status = 'refunded';
    expect((await confirmRequest({ previewToken: preview.body.data.previewToken })).status).toBe(409);
    expect(models.OrderItem.bulkCreate).not.toHaveBeenCalled();
});

test('confirmation rejects candidates that became unavailable rather than partially adding photos', async () => {
    models.Photo.findAll.mockResolvedValue([]);
    expect((await confirmRequest()).status).toBe(409);
    expect(models.OrderItem.bulkCreate).not.toHaveBeenCalled();
});

test('persistence errors leave the managed transaction rejected and never return success', async () => {
    models.OrderItem.bulkCreate.mockRejectedValueOnce(new Error('insert failed'));
    expect((await confirmRequest()).status).toBe(500);
});

test('event sales exposes the action only for eligible administrators', async () => {
    const admin = await request(app).get(`/orders/event/${eventId}`).auth(auth(), { type: 'bearer' });
    expect(admin.status).toBe(200);
    expect(admin.body.orders[0].canUpdatePhotos).toBe(true);
    event.isActive = false;
    const inactive = await request(app).get(`/orders/event/${eventId}`).auth(auth(), { type: 'bearer' });
    expect(inactive.body.orders[0].canUpdatePhotos).toBe(false);
    event.isActive = true;
    const photographer = await request(app).get(`/orders/event/${eventId}`).auth(auth('fotografo'), { type: 'bearer' });
    expect(photographer.body.orders[0].canUpdatePhotos).toBe(false);
});

test('zero-price additions preserve real event allocation and commission SQL', async () => {
    const fixture = `
        CREATE TABLE orders (id TEXT, "totalAmount" REAL, status TEXT);
        CREATE TABLE order_items (id TEXT, "orderId" TEXT, "photoId" TEXT, price REAL);
        CREATE TABLE photos (id TEXT, "eventId" TEXT);
        CREATE TABLE withdrawal_requests ("eventId" TEXT, amount REAL, status TEXT, "organizerId" TEXT, "photographerId" TEXT);
        INSERT INTO orders VALUES ('order', 199.80, 'paid');
        INSERT INTO photos VALUES ('old', 'event'), ('new', 'event'), ('other', 'other-event');
        INSERT INTO order_items VALUES ('old-item', 'order', 'old', 99.90), ('other-item', 'order', 'other', 99.90);
    `;
    let additions = '';
    models.sequelize.query.mockImplementation(async (sql, { replacements }) => {
        const query = sql.replace(/:eventId/g, `'${replacements.eventId}'`)
            .replace(/:statuses/g, "'pending', 'approved', 'paid'");
        const result = spawnSync('sqlite3', ['-json', ':memory:', fixture + additions + query], { encoding: 'utf8' });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(result.stderr);
        return JSON.parse(result.stdout);
    });
    const before = await commission.getOrganizerEventBalance({ id: 'event', organizerCommissionPercentage: 15 });
    additions = "INSERT INTO order_items VALUES ('new-item', 'order', 'new', 0);";
    const after = await commission.getOrganizerEventBalance({ id: 'event', organizerCommissionPercentage: 15 });
    expect(before.totalRevenue).toBeCloseTo(99.90);
    expect(after.totalRevenue).toBe(before.totalRevenue);
    expect(after.commissionTotal).toBe(before.commissionTotal);
    expect(after.availableBalance).toBe(before.availableBalance);
    expect(after.totalPhotosSold).toBe(before.totalPhotosSold + 1);
});
