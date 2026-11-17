'use strict';

const { spawnSync } = require('node:child_process');

jest.mock('../../src/models', () => ({
    Order: { create: jest.fn(), findByPk: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), destroy: jest.fn() },
    OrderItem: { bulkCreate: jest.fn(), create: jest.fn() },
    Photo: { findAll: jest.fn(), destroy: jest.fn() },
    Event: {},
    User: { findByPk: jest.fn() },
    sequelize: { transaction: jest.fn() }
}));
jest.mock('../../src/services/pix.service', () => ({
    createPixPayment: jest.fn(), validatePixPayment: jest.fn(),
    getPixQrCode: jest.fn(), handleAsaasWebhook: jest.fn(), confirmPixPaymentManually: jest.fn()
}));
jest.mock('../../src/services/email.service', () => ({ sendDownloadEmail: jest.fn() }));
jest.mock('../../src/services/s3.service', () => ({ generatePresignedUrl: jest.fn(async () => 'signed-original') }));
jest.mock('../../src/services/media-preview.service', () => ({
    previewUrls: jest.fn(async photo => ({ mediaType: photo.mediaType, previewUrl: 'signed-preview' }))
}));
jest.mock('../../src/utils/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../../src/config/jwt', () => ({
    secret: 'courtesy-test-secret-only', issuer: 'snapli-test', audience: 'snapli-test'
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Sequelize, DataTypes, Op, fn, col, where } = require('sequelize');
const jwtConfig = require('../../src/config/jwt');
const { Order, OrderItem, Photo, User, sequelize } = require('../../src/models');
const pix = require('../../src/services/pix.service');
const email = require('../../src/services/email.service');
const storage = require('../../src/services/s3.service');
const controller = require('../../src/controllers/order.controller');
const orderRoutes = require('../../src/routes/order.routes');
const downloadRoutes = require('../../src/routes/download.routes');
const logger = require('../../src/utils/logger');
const photoId = 'c0d582d7-b530-41a2-88fa-6e9d178e9b08';
const videoId = 'c0d582d7-b530-41a2-88fa-6e9d178e9b09';
const transaction = { LOCK: { SHARE: 'SHARE' } };
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/orders', orderRoutes);
app.use('/downloads', downloadRoutes);

function token(role = 'admin', claims = {}) {
    User.findByPk.mockResolvedValue({ id: 'admin-id', role, isActive: true });
    return jwt.sign({ ...claims, userId: 'admin-id' }, jwtConfig.secret, {
        issuer: jwtConfig.issuer, audience: jwtConfig.audience, expiresIn: '5m'
    });
}

function media(id = photoId, mediaType = 'photo') {
    return {
        id, mediaType, originalKey: `original/${id}`, originalFilename: 'original.jpg',
        processingStatus: 'completed', previewKey: 'preview',
        event: { id: 'event', isActive: true, videoEnabled: true }
    };
}

function postCourtesy(body = {}) {
    return request(app).post('/orders/courtesy').auth(token(), { type: 'bearer' }).send({
        customerName: ' Destinatario ', items: [{ photoId }], ...body
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    sequelize.transaction.mockImplementation(callback => callback(transaction));
    Order.create.mockImplementation(async data => ({ id: 'order-id', ...data }));
    OrderItem.bulkCreate.mockResolvedValue([]);
    Photo.findAll.mockResolvedValue([media()]);
    Order.findByPk.mockResolvedValue(null);
    Order.findOne.mockResolvedValue(null);
    Order.findAll.mockResolvedValue([]);
    Order.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
    Order.destroy.mockResolvedValue(0);
});

test.each([null, 'fotografo', 'organizador'])('rejects courtesy creation for role %s', async role => {
    let req = request(app).post('/orders/courtesy');
    if (role) req = req.auth(token(role), { type: 'bearer' });
    const response = await req.send({ customerName: 'Pessoa', items: [{ photoId }] });
    expect(response.status).toBe(role ? 403 : 401);
    expect(Order.create).not.toHaveBeenCalled();
});

test.each([undefined, null, '', ' person@example.com '])('creates a mixed courtesy with optional email %s and no payment or email side effects', async customerEmail => {
    Photo.findAll.mockResolvedValue([media(), media(videoId, 'video')]);
    const before = Date.now();
    const response = await postCourtesy({
        customerEmail, items: [{ photoId }, { photoId: videoId }],
        status: 'paid', totalAmount: 99, createdBy: 'attacker', paidAt: new Date().toISOString(),
        paymentId: 'fake', downloadToken: 'guessable', downloadExpiresAt: '2100-01-01'
    });
    expect(response.status).toBe(201);
    expect(response.body.order).toMatchObject({
        id: 'order-id', customerName: 'Destinatario', itemCount: 2, status: 'courtesy'
    });
    const [data, options] = Order.create.mock.calls[0];
    expect(options.transaction).toBe(transaction);
    expect(data).toMatchObject({
        customerEmail: customerEmail ? customerEmail.trim() : null,
        createdBy: 'admin-id', status: 'courtesy', totalAmount: 0,
        paymentId: null, paymentMethod: null, paymentLink: null, paidAt: null
    });
    expect(data.downloadToken).toMatch(/^[a-f0-9]{64}$/);
    expect(response.body.order.downloadUrl.endsWith(`/downloads/${data.downloadToken}`)).toBe(true);
    const expires = new Date(response.body.order.downloadExpiresAt).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 90 * 86400000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 90 * 86400000);
    expect(OrderItem.bulkCreate).toHaveBeenCalledWith([
        { orderId: 'order-id', photoId, price: 0 },
        { orderId: 'order-id', photoId: videoId, price: 0 }
    ], { transaction, validate: true });
    expect(pix.createPixPayment).not.toHaveBeenCalled();
    expect(email.sendDownloadEmail).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(data.downloadToken);
});

test('accepts exactly 1000 distinct files', async () => {
    const ids = Array.from({ length: 1000 }, () => require('crypto').randomUUID());
    Photo.findAll.mockResolvedValue(ids.map(id => media(id)));
    const response = await postCourtesy({ items: ids.map(id => ({ photoId: id })) });
    expect(response.status).toBe(201);
    expect(response.body.order.itemCount).toBe(1000);
});

test.each([
    { customerName: '  ' }, { customerName: 123 }, { customerName: 'x'.repeat(256) },
    { customerEmail: 'not-an-email' }, { customerEmail: false }, { customerEmail: [] },
    { items: [] }, { items: null }, { items: [{ photoId: 'bad-id' }] },
    { items: [{ photoId }, { photoId }] },
    { items: Array.from({ length: 1001 }, () => ({ photoId })) }
])('rejects invalid input %j before persistence', async body => {
    expect((await postCourtesy(body)).status).toBe(400);
    expect(Order.create).not.toHaveBeenCalled();
});

test.each([
    [], [media(), media(videoId)],
    [{ ...media(), originalKey: null }],
    [{ ...media(), processingStatus: 'pending' }],
    [{ ...media(), event: { isActive: false } }],
    [{ ...media(photoId, 'video'), event: { isActive: true, videoEnabled: false } }],
    [{ ...media(photoId, 'video'), previewKey: null }]
].map(files => [files]))('rejects unavailable files without creating partial orders', async files => {
    Photo.findAll.mockResolvedValue(files);
    expect((await postCourtesy()).status).toBe(400);
    expect(Order.create).not.toHaveBeenCalled();
    expect(OrderItem.bulkCreate).not.toHaveBeenCalled();
});

test('propagates item persistence failure out of the managed transaction and never returns a link', async () => {
    OrderItem.bulkCreate.mockRejectedValueOnce(new Error('item persistence failed'));
    let transactionFailure;
    sequelize.transaction.mockImplementation(async callback => {
        try {
            return await callback(transaction);
        } catch (error) {
            transactionFailure = error;
            throw error;
        }
    });
    const response = await postCourtesy();
    expect(response.status).toBe(500);
    expect(response.body.order).toBeUndefined();
    expect(transactionFailure.message).toBe('item persistence failed');
    expect(logger.error).toHaveBeenCalled();
});

test('download URLs are not exposed until the transaction commits', async () => {
    let commit;
    const committed = new Promise(resolve => { commit = resolve; });
    let staged;
    const created = new Promise(resolve => { staged = resolve; });
    sequelize.transaction.mockImplementation(async callback => {
        const order = await callback(transaction);
        staged();
        await committed;
        return order;
    });
    let responded = false;
    const pending = postCourtesy().then(response => { responded = true; return response; });
    await created;
    expect(responded).toBe(false);
    commit();
    expect((await pending).status).toBe(201);
});

test.each(['validate-payment', 'pix-qrcode'])('courtesy rejects public payment action %s', async action => {
    Order.findByPk.mockResolvedValue({ status: 'courtesy' });
    expect((await request(app).get(`/orders/order-id/${action}`)).status).toBe(400);
    expect(pix.createPixPayment).not.toHaveBeenCalled();
    expect(pix.validatePixPayment).not.toHaveBeenCalled();
    expect(pix.getPixQrCode).not.toHaveBeenCalled();
});

test('courtesy rejects Asaas sync and email resend', async () => {
    Order.findByPk.mockResolvedValue({ status: 'courtesy', paymentId: 'unexpected' });
    const auth = token();
    expect((await request(app).post('/orders/order-id/sync-asaas').auth(auth, { type: 'bearer' })).status).toBe(400);
    expect((await request(app).post('/downloads/resend/order-id').auth(auth, { type: 'bearer' })).status).toBe(400);
    expect(pix.validatePixPayment).not.toHaveBeenCalled();
    expect(email.sendDownloadEmail).not.toHaveBeenCalled();
});

test.each(['confirmPaymentManually', 'simulatePayment'])('courtesy rejects development action %s', async action => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
        Order.findByPk.mockResolvedValue({ status: 'courtesy' });
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await controller[action]({ params: { orderId: 'order-id' } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(pix.confirmPixPaymentManually).not.toHaveBeenCalled();
        expect(email.sendDownloadEmail).not.toHaveBeenCalled();
    } finally {
        process.env.NODE_ENV = original;
    }
});

test('Asaas webhook cannot transform courtesy into a sale', async () => {
    pix.handleAsaasWebhook.mockResolvedValue({ processed: true, externalReference: 'order-id' });
    const save = jest.fn();
    Order.findByPk.mockResolvedValue({ id: 'order-id', status: 'courtesy', save });
    const response = await request(app).post('/orders/webhook/asaas')
        .set('asaas-access-token', process.env.ASAAS_WEBHOOK_TOKEN || 'test')
        .send({ event: 'PAYMENT_CONFIRMED' });
    expect(response.status).toBe(200);
    expect(response.body.ignored).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(email.sendDownloadEmail).not.toHaveBeenCalled();
});

test.each(['courtesy', 'paid', 'completed'])('public portal allows %s with no login and preserves media previews', async status => {
    Order.findOne.mockResolvedValue({
        id: 'order-id', status, customerEmail: 'private@example.com', createdBy: 'admin-id',
        createdAt: '2026-11-13T00:00:00Z', downloadExpiresAt: new Date(Date.now() + 86400000),
        items: [media(), media(videoId, 'video')].map(photo => ({ photo, price: 0 }))
    });
    const response = await request(app).get('/downloads/random-token');
    expect(response.status).toBe(200);
    expect(response.body.photos.map(photo => photo.mediaType)).toEqual(['photo', 'video']);
    expect(response.body.order.createdBy).toBeUndefined();
    expect(response.body.order.customerEmail).toBe(status === 'courtesy' ? undefined : 'private@example.com');
});

test.each(['photo', 'video'])('courtesy signs only the requested %s item original', async mediaType => {
    const save = jest.fn();
    Order.findOne.mockResolvedValue({
        status: 'courtesy', downloadExpiresAt: new Date(Date.now() + 86400000),
        items: [{ photo: media(photoId, mediaType), save }]
    });
    const response = await request(app).get(`/downloads/random-token/photo/${photoId}`);
    expect(response.status).toBe(200);
    expect(Order.findOne.mock.calls[0][0]).toMatchObject({
        where: { downloadToken: 'random-token' }, include: [{ where: { photoId } }]
    });
    expect(storage.generatePresignedUrl).toHaveBeenCalledWith(`original/${photoId}`, 'original', 3600, { downloadFilename: 'original.jpg' });
    expect(save).toHaveBeenCalled();
});

test.each([
    [null, 404], [{ status: 'pending' }, 403], [{ status: 'cancelled' }, 403],
    [{ status: 'courtesy', downloadExpiresAt: new Date(0) }, 410]
])('rejects invalid, unauthorized or expired portal and original requests', async (order, status) => {
    Order.findOne.mockResolvedValue(order);
    expect((await request(app).get('/downloads/random-token')).status).toBe(status);
    expect((await request(app).get(`/downloads/random-token/photo/${photoId}`)).status).toBe(status);
    expect(storage.generatePresignedUrl).not.toHaveBeenCalled();
});

test('normal public checkout still requires email even when free-order fields are forged', async () => {
    const response = await request(app).post('/orders').send({
        customerName: 'Pessoa', status: 'courtesy', totalAmount: 0, items: [{ photoId }]
    });
    expect(response.status).toBe(400);
    expect(Order.create).not.toHaveBeenCalled();
});

test('public checkout ignores forged courtesy and pricing fields and still creates a paid PIX charge', async () => {
    Photo.findAll.mockResolvedValue([{
        ...media(), eventId: 'event', event: { id: 'event', name: 'Evento', pricePerPhoto: 15, isActive: true }
    }]);
    Order.create.mockImplementation(async data => ({ id: 'order-id', ...data, update: jest.fn() }));
    OrderItem.create.mockResolvedValue({});
    Order.findByPk.mockResolvedValue({ items: [{}] });
    pix.createPixPayment.mockResolvedValue({ id: 'payment-id', invoiceUrl: 'invoice' });
    const response = await request(app).post('/orders').send({
        customerName: 'Pessoa', customerEmail: 'person@example.com',
        status: 'courtesy', totalAmount: 0, items: [{ photoId, price: 0 }]
    });
    expect(response.status).toBe(201);
    expect(Order.create.mock.calls[0][0]).toMatchObject({ status: 'pending', totalAmount: 15 });
    expect(pix.createPixPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 15 }));
    expect(response.body.order).toMatchObject({ status: 'pending', totalAmount: 15, paymentId: 'payment-id' });
});

test('checkout checks normalized email and overlapping files only in paid purchases from the last seven days', async () => {
    Order.findOne.mockResolvedValue({ id: 'previous-order', downloadToken: 'private-token' });
    const before = Date.now();
    const response = await request(app).post('/orders').send({
        customerName: 'Pessoa', customerEmail: ' PERSON@Example.com ', items: [{ photoId }]
    });
    const after = Date.now();
    const options = Order.findOne.mock.calls[0][0];
    expect(options.where[Op.and]).toEqual([
        where(fn('lower', fn('trim', col('Order.customerEmail'))), 'person@example.com')
    ]);
    expect(options.where.status[Op.in]).toEqual(['paid', 'completed']);
    const [since, until] = options.where.paidAt[Op.between];
    expect(until.getTime()).toBeGreaterThanOrEqual(before);
    expect(until.getTime()).toBeLessThanOrEqual(after);
    expect(until.getTime() - since.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(options).toMatchObject({
        attributes: ['id'], subQuery: false,
        include: [{ model: OrderItem, as: 'items', attributes: [], required: true, where: { photoId: { [Op.in]: [photoId] } } }]
    });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
        code: 'RECENT_PURCHASE_OVERLAP',
        error: 'Você já possui uma compra paga com arquivos deste carrinho nos últimos 7 dias. Uma nova cobrança não será gerada.'
    });
    expect(JSON.stringify(response.body)).not.toContain('previous-order');
    expect(JSON.stringify(response.body)).not.toContain('private-token');
    expect(Order.create).not.toHaveBeenCalled();
    expect(OrderItem.create).not.toHaveBeenCalled();
    expect(pix.createPixPayment).not.toHaveBeenCalled();
});

test('adding new files does not bypass the recent purchase check for an already purchased file', async () => {
    Photo.findAll.mockResolvedValue([media(), media(videoId, 'video')]);
    Order.findOne.mockResolvedValue({ id: 'previous-order' });
    const response = await request(app).post('/orders').send({
        customerName: 'Pessoa', customerEmail: 'person@example.com',
        items: [{ photoId: videoId }, { photoId }]
    });
    expect(response.status).toBe(409);
    expect(Order.findOne.mock.calls[0][0].include[0].where.photoId[Op.in]).toEqual([videoId, photoId]);
    expect(Order.create).not.toHaveBeenCalled();
    expect(pix.createPixPayment).not.toHaveBeenCalled();
});

test('checkout fails explicitly without creating an order or PIX when the recent purchase lookup fails', async () => {
    Order.findOne.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await request(app).post('/orders').send({
        customerName: 'Pessoa', customerEmail: 'person@example.com', items: [{ photoId }]
    });
    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalled();
    expect(Order.create).not.toHaveBeenCalled();
    expect(pix.createPixPayment).not.toHaveBeenCalled();
});

describe('recent purchase matching against the generated SQL', () => {
    const lookupDb = new Sequelize('postgres://test:test@localhost/test', { logging: false });
    const LookupOrder = lookupDb.define('Order', {
        id: { type: DataTypes.STRING, primaryKey: true },
        customerEmail: DataTypes.STRING,
        status: DataTypes.STRING,
        paidAt: DataTypes.DATE
    }, { tableName: 'orders', timestamps: false });
    const LookupItem = lookupDb.define('OrderItem', {
        id: { type: DataTypes.STRING, primaryKey: true },
        orderId: DataTypes.STRING,
        photoId: DataTypes.STRING
    }, { tableName: 'order_items', timestamps: false });
    LookupOrder.hasMany(LookupItem, { as: 'items', foreignKey: 'orderId' });
    const day = 24 * 60 * 60 * 1000;

    test.each([
        ['paid', day, ' PERSON@Example.com ', photoId, 409],
        ['completed', day, 'person@example.com', photoId, 409],
        ['paid', 7 * day, 'person@example.com', photoId, 409],
        ['paid', 7 * day + 1, 'person@example.com', photoId, 201],
        ['paid', -1, 'person@example.com', photoId, 201],
        ['paid', null, 'person@example.com', photoId, 201],
        ['pending', day, 'person@example.com', photoId, 201],
        ['processing', day, 'person@example.com', photoId, 201],
        ['refunded', day, 'person@example.com', photoId, 201],
        ['cancelled', day, 'person@example.com', photoId, 201],
        ['courtesy', day, 'person@example.com', photoId, 201],
        ['paid', day, 'other@example.com', photoId, 201],
        ['paid', day, 'person@example.com', videoId, 201]
    ])('previous %s purchase, age %s, email %s and file %s returns %s', async (status, age, email, previousPhotoId, expectedStatus) => {
        Photo.findAll.mockResolvedValue([{
            ...media(), eventId: 'event', event: { id: 'event', name: 'Evento', pricePerPhoto: 15, isActive: true }
        }]);
        Order.create.mockImplementation(async data => ({ id: 'order-id', ...data, update: jest.fn() }));
        OrderItem.create.mockResolvedValue({});
        Order.findByPk.mockResolvedValue({ items: [{}] });
        pix.createPixPayment.mockResolvedValue({ id: 'payment-id' });
        Order.findOne.mockImplementation(async options => {
            const now = options.where.paidAt[Op.between][1].getTime();
            const paidAt = age === null ? null : new Date(now - age);
            lookupDb.query = async (sql, queryOptions) => {
                const fixture = `
                    CREATE TABLE orders (id TEXT, "customerEmail" TEXT, status TEXT, "paidAt" TEXT);
                    CREATE TABLE order_items (id TEXT, "orderId" TEXT, "photoId" TEXT);
                    INSERT INTO orders VALUES ('previous', ${lookupDb.escape(email)}, ${lookupDb.escape(status)}, ${lookupDb.escape(paidAt)});
                    INSERT INTO order_items VALUES ('previous-item', 'previous', ${lookupDb.escape(previousPhotoId)});
                `;
                const result = spawnSync('sqlite3', ['-json', ':memory:', fixture + sql], { encoding: 'utf8' });
                if (result.error) throw result.error;
                if (result.status !== 0) throw new Error(result.stderr);
                const rows = result.stdout.trim() ? JSON.parse(result.stdout) : [];
                return rows.length ? queryOptions.model.build(rows[0], { isNewRecord: false }) : null;
            };
            return LookupOrder.findOne({
                ...options, include: options.include.map(include => ({ ...include, model: LookupItem }))
            });
        });
        const response = await request(app).post('/orders').send({
            customerName: 'Pessoa', customerEmail: 'person@example.com', items: [{ photoId }]
        });
        expect(response.status).toBe(expectedStatus);
        if (expectedStatus === 409) {
            expect(Order.create).not.toHaveBeenCalled();
            expect(pix.createPixPayment).not.toHaveBeenCalled();
        } else {
            expect(Order.create).toHaveBeenCalledTimes(1);
            expect(pix.createPixPayment).toHaveBeenCalledTimes(1);
        }
    });
});

test('administrative token generation accepts courtesy without resetting its expiration', async () => {
    const expiresAt = new Date(Date.now() + 86400000);
    const save = jest.fn();
    Order.findByPk.mockResolvedValue({ status: 'courtesy', downloadExpiresAt: expiresAt, items: [{}], save });
    const response = await request(app).post('/downloads/generate/order-id').auth(token(), { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(response.body.downloadToken).toMatch(/^[a-f0-9]{64}$/);
    expect(response.body.expiresAt).toBe(expiresAt.toISOString());
    expect(save).toHaveBeenCalled();
});

test.each([null, 'fotografo', 'organizador'])('courtesy management rejects role %s', async role => {
    for (const [method, path] of [['get', '/orders/courtesy'], ['delete', `/orders/courtesy/${photoId}`]]) {
        let req = request(app)[method](path);
        if (role) req = req.auth(token(role), { type: 'bearer' });
        expect((await req).status).toBe(role ? 403 : 401);
    }
    expect(Order.findAndCountAll).not.toHaveBeenCalled();
    expect(Order.destroy).not.toHaveBeenCalled();
});

test('lists all courtesy creators with real pagination totals, file counts and links but no private payment data', async () => {
    Order.findAndCountAll.mockResolvedValue({
        count: 23,
        rows: [{
            id: photoId, customerName: 'Pessoa', createdBy: 'another-admin',
            customerEmail: 'private@example.com', paymentId: 'private-payment',
            createdAt: '2026-11-13T10:00:00Z', downloadExpiresAt: '2027-02-11T10:00:00Z',
            downloadToken: 'random-token', items: [{ id: 'item-1' }, { id: 'item-2' }]
        }]
    });
    const response = await request(app).get('/orders/courtesy')
        .query({ limit: 2, offset: 20, status: 'paid', createdBy: 'attacker' })
        .auth(token(), { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(Order.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
        where: { status: 'courtesy' }, limit: 2, offset: 20, distinct: true,
        order: [['createdAt', 'DESC'], ['id', 'DESC']]
    }));
    expect(response.body).toMatchObject({ success: true, total: 23, limit: 2, offset: 20 });
    expect(response.body.orders).toEqual([{
        id: photoId, customerName: 'Pessoa', itemCount: 2, createdAt: '2026-11-13T10:00:00Z',
        downloadExpiresAt: '2027-02-11T10:00:00Z', downloadUrl: expect.stringMatching(/\/downloads\/random-token$/)
    }]);
    expect(Order.findByPk).not.toHaveBeenCalled();
});

test('empty courtesy list uses a bounded default page', async () => {
    const response = await request(app).get('/orders/courtesy').auth(token(), { type: 'bearer' });
    expect(response.body).toEqual({ success: true, orders: [], total: 0, limit: 20, offset: 0 });
    expect(Order.findAndCountAll.mock.calls[0][0]).toMatchObject({ limit: 20, offset: 0 });
});

test.each([
    { limit: 0 }, { limit: 101 }, { limit: 'bad' }, { limit: [1, 2] },
    { offset: -1 }, { offset: 'bad' }, { offset: '999999999999999999999999' }
])('rejects invalid courtesy pagination %j', async query => {
    const response = await request(app).get('/orders/courtesy').query(query).auth(token(), { type: 'bearer' });
    expect(response.status).toBe(400);
    expect(Order.findAndCountAll).not.toHaveBeenCalled();
});

test('removing a courtesy disables its portal and download without deleting originals', async () => {
    let deleted = false;
    Order.findOne.mockImplementation(async () => deleted ? null : { status: 'courtesy', items: [] });
    Order.destroy.mockImplementation(async options => {
        expect(options.where).toEqual({ id: photoId, status: 'courtesy' });
        deleted = true;
        return 1;
    });
    expect((await request(app).get('/downloads/random-token')).status).toBe(200);
    const response = await request(app).delete(`/orders/courtesy/${photoId}`).auth(token(), { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect((await request(app).get('/downloads/random-token')).status).toBe(404);
    expect((await request(app).get(`/downloads/random-token/photo/${videoId}`)).status).toBe(404);
    expect(Photo.destroy).not.toHaveBeenCalled();
    expect(storage.generatePresignedUrl).not.toHaveBeenCalled();
});

test('missing or non-courtesy orders cannot be removed through courtesy management', async () => {
    const response = await request(app).delete(`/orders/courtesy/${photoId}`).auth(token(), { type: 'bearer' });
    expect(response.status).toBe(404);
    expect(Order.destroy).toHaveBeenCalledWith({ where: { id: photoId, status: 'courtesy' } });
});

test('rejects malformed deletion IDs before reaching persistence', async () => {
    const response = await request(app).delete('/orders/courtesy/bad-id').auth(token(), { type: 'bearer' });
    expect(response.status).toBe(400);
    expect(Order.destroy).not.toHaveBeenCalled();
});

test('list and deletion failures are explicit and logged', async () => {
    Order.findAndCountAll.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await request(app).get('/orders/courtesy').auth(token(), { type: 'bearer' })).status).toBe(500);
    Order.destroy.mockRejectedValueOnce(new Error('delete failed'));
    const response = await request(app).delete(`/orders/courtesy/${photoId}`).auth(token(), { type: 'bearer' });
    expect(response.status).toBe(500);
    expect(response.body.success).toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(2);
});

test.each([null, 'fotografo', 'organizador'])('courtesy details by ID reject role %s without exposing recipient data', async role => {
    Order.findByPk.mockResolvedValue({ id: photoId, status: 'courtesy', customerName: 'Private recipient', items: [] });
    let req = request(app).get(`/orders/${photoId}`);
    if (role) req = req.auth(token(role, { role: 'admin' }), { type: 'bearer' });
    const response = await req;
    expect(response.status).toBe(403);
    expect(response.body.order).toBeUndefined();
    expect(response.body.items).toBeUndefined();
});

test('admin can read courtesy details by ID', async () => {
    Order.findByPk.mockResolvedValue({ id: photoId, status: 'courtesy', items: [] });
    const response = await request(app).get(`/orders/${photoId}`).auth(token(), { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe('courtesy');
});

test.each(['pending', 'paid', 'completed'])('ordinary %s checkout details remain public', async status => {
    Order.findByPk.mockResolvedValue({ id: photoId, status, items: [] });
    const response = await request(app).get(`/orders/${photoId}`);
    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe(status);
    expect(User.findByPk).not.toHaveBeenCalled();
});

test.each(['fotografo', 'organizador'])('courtesy token generation rejects %s even with a forged admin claim', async role => {
    const save = jest.fn();
    for (const downloadToken of [null, 'existing-private-token']) {
        Order.findByPk.mockResolvedValue({ status: 'courtesy', downloadToken, items: [], save });
        const response = await request(app).post(`/downloads/generate/${photoId}`)
            .auth(token(role, { role: 'admin' }), { type: 'bearer' });
        expect(response.status).toBe(403);
        expect(response.body.downloadToken).toBeUndefined();
        expect(response.body.downloadUrl).toBeUndefined();
    }
    expect(save).not.toHaveBeenCalled();
});

test.each(['fotografo', 'organizador'])('ordinary paid token retrieval remains available to authenticated %s', async role => {
    Order.findByPk.mockResolvedValue({ status: 'paid', downloadToken: 'paid-token', items: [] });
    const response = await request(app).post(`/downloads/generate/${photoId}`)
        .auth(token(role), { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(response.body.downloadToken).toBe('paid-token');
});

test.each(['fotografo', 'organizador'])('generic listings exclude courtesy for %s regardless of status filter shape', async role => {
    for (const query of [{}, { status: 'paid' }, { status: ['paid', 'courtesy'] }]) {
        const response = await request(app).get('/orders').query(query)
            .auth(token(role, { role: 'admin' }), { type: 'bearer' });
        expect(response.status).toBe(200);
        const options = Order.findAll.mock.calls.at(-1)[0];
        expect(options.where[Op.and]).toEqual([{ status: { [Op.ne]: 'courtesy' } }]);
        if (query.status) expect(options.where.status).toEqual(query.status);
    }
});

test.each(['fotografo', 'organizador'])('generic explicit courtesy listing rejects %s before querying orders', async role => {
    const response = await request(app).get('/orders?status=courtesy')
        .auth(token(role), { type: 'bearer' });
    expect(response.status).toBe(403);
    expect(Order.findAll).not.toHaveBeenCalled();
});

test('admin retains courtesy access through the generic listing', async () => {
    Order.findAll.mockResolvedValue([{ id: photoId, status: 'courtesy', items: [] }]);
    const response = await request(app).get('/orders?status=courtesy').auth(token(), { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(response.body.orders[0].status).toBe('courtesy');
    expect(Order.findAll.mock.calls[0][0].where).toEqual({ status: 'courtesy' });
});

test('event listing excludes courtesy before loading orders for photographers', async () => {
    const response = await request(app).get('/orders/event/event-id')
        .auth(token('fotografo'), { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(Order.findAll.mock.calls[0][0].where).toEqual({ status: { [Op.ne]: 'courtesy' } });
});

test('organizers remain blocked from event order details', async () => {
    const response = await request(app).get('/orders/event/event-id')
        .auth(token('organizador'), { type: 'bearer' });
    expect(response.status).toBe(403);
    expect(Order.findAll).not.toHaveBeenCalled();
});

test('admin retains courtesy links in the event listing', async () => {
    Order.findAll.mockResolvedValue([{
        id: photoId, status: 'courtesy', items: [{}], downloadToken: 'private-courtesy-token'
    }]);
    const response = await request(app).get('/orders/event/event-id').auth(token(), { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(response.body.orders[0]).toMatchObject({
        status: 'courtesy', downloadToken: 'private-courtesy-token',
        downloadUrl: expect.stringMatching(/\/downloads\/private-courtesy-token$/)
    });
});
