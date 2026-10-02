'use strict';

const assert = require('node:assert/strict');
const { quoteVideos, validateVideoPricing } = require('../../src/services/video-pricing.service');

jest.mock('../../src/models', () => ({
    Photo: { findAll: jest.fn() },
    Event: { create: jest.fn(), findByPk: jest.fn() },
    User: { findByPk: jest.fn() },
    Order: { create: jest.fn(), findByPk: jest.fn() },
    OrderItem: { create: jest.fn() }
}));
jest.mock('../../src/services/pix.service', () => ({ createPixPayment: jest.fn() }));
jest.mock('../../src/services/email.service', () => ({}));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const { Photo, Event, Order, OrderItem } = require('../../src/models');
const pixService = require('../../src/services/pix.service');
const { createOrder } = require('../../src/controllers/order.controller');
const eventController = require('../../src/controllers/event.controller');
const migration = require('../../src/migrations/20261002000001-add-video-foundation');

const pricing = { videoEnabled: true, pricePerVideo: '10.00', videoPricingPackages: [] };

test('videos use their own price and the same event freebies as photos', () => {
    const quote = quoteVideos(3, { ...pricing, pricePerPhoto: 1, freePhotosCount: 3 });
    assert.equal(quote.total, 10);
    assert.deepEqual(quote.itemPrices, [0, 0, 10]);
});

test('uses largest packages first exactly like photo pricing', () => {
    assert.equal(quoteVideos(6, {
        ...pricing,
        videoPricingPackages: [{ quantity: 4, price: 25 }, { quantity: 3, price: 15 }]
    }).total, 45);
});

test('all-video price uses the same selected-item rule as all-photo price and distributes exact cents', () => {
    const quote = quoteVideos(3, { ...pricing, allVideosPrice: '10.00' });
    assert.deepEqual(quote.itemPrices, [3.34, 3.33, 3.33]);
    assert.equal(quote.itemPrices.reduce((total, price) => total + Math.round(price * 100), 0), quote.totalCents);
});

test('rejects disabled videos, missing prices and invalid package configuration', () => {
    assert.throws(() => quoteVideos(1, { ...pricing, videoEnabled: false }));
    assert.throws(() => quoteVideos(1, { ...pricing, pricePerVideo: null }));
    assert.throws(() => quoteVideos(0, pricing));
    for (const quantity of [0, -1, 1.5, '3', 1001]) {
        assert.throws(() => validateVideoPricing({ ...pricing, videoPricingPackages: [{ quantity, price: 1 }] }));
    }
    for (const price of [0, -1, 'NaN', '1.001', Infinity]) {
        assert.throws(() => quoteVideos(1, { ...pricing, pricePerVideo: price }));
    }
});

function response() {
    return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe('video event configuration', () => {
    beforeEach(() => jest.clearAllMocks());

    test('existing event creation leaves video disabled', async () => {
        const res = response();
        Event.create.mockResolvedValue({ id: 'event', name: 'Event' });
        await eventController.create({ body: { name: 'Event' }, userId: 'owner' }, res, jest.fn());
        expect(Event.create.mock.calls[0][0]).toMatchObject({ videoEnabled: false, pricePerVideo: null });
        expect(res.status).toHaveBeenCalledWith(201);
    });

    test('cannot enable video sales without a video price', async () => {
        const res = response();
        await eventController.create({ body: { videoEnabled: true } }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(400);
        expect(Event.create).not.toHaveBeenCalled();
    });

    test('partial update preserves existing video packages and price', async () => {
        const update = jest.fn();
        Event.findByPk.mockResolvedValue({ ...pricing, videoPricingPackages: [{ quantity: 3, price: '20.00' }], createdBy: 'owner', update });
        await eventController.update({ params: { id: 'event' }, body: { name: 'Renamed' }, userRole: 'fotografo', userId: 'owner' }, response(), jest.fn());
        expect(update.mock.calls[0][0]).toMatchObject({ name: 'Renamed', ...pricing, videoPricingPackages: [{ quantity: 3, price: '20.00' }] });
    });

    test('another photographer cannot edit video pricing', async () => {
        const update = jest.fn();
        const res = response();
        Event.findByPk.mockResolvedValue({ createdBy: 'owner', update });
        await eventController.update({ params: { id: 'event' }, body: { videoEnabled: true, pricePerVideo: 10 }, userRole: 'fotografo', userId: 'other' }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(403);
        expect(update).not.toHaveBeenCalled();
    });
});

describe('mixed order pricing', () => {
    const event = { ...pricing, id: 'event', name: 'Event', isActive: true, pricePerPhoto: '5.00', freePhotosCount: 1 };
    const video = { id: 'video', eventId: 'event', mediaType: 'video', processingStatus: 'completed', previewKey: 'preview.mp4', event };
    const photo = { id: 'photo', eventId: 'event', mediaType: 'photo', event };

    beforeEach(() => {
        jest.clearAllMocks();
        Order.create.mockResolvedValue({ id: 'order', update: jest.fn() });
        Order.findByPk.mockResolvedValue({ id: 'order', items: [] });
        OrderItem.create.mockImplementation(async item => item);
        pixService.createPixPayment.mockResolvedValue({ id: 'payment' });
    });

    async function submit(media, items = media.map(item => ({ photoId: item.id }))) {
        Photo.findAll.mockResolvedValue(media);
        const res = response();
        await createOrder({ body: { customerName: 'Buyer', customerEmail: 'buyer@example.com', items } }, res);
        return res;
    }

    test('photo-only order keeps existing photo freebies', async () => {
        await submit([photo, { ...photo, id: 'photo2' }]);
        expect(Order.create.mock.calls[0][0].totalAmount).toBe(5);
        expect(OrderItem.create.mock.calls.map(call => call[0].price)).toEqual([0, 5]);
    });

    test('photo and video in the same event use independent rules', async () => {
        const res = await submit([photo, { ...photo, id: 'photo2' }, video]);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(Order.create.mock.calls[0][0].totalAmount).toBe(15);
        expect(OrderItem.create.mock.calls.map(call => call[0].price)).toEqual([0, 5, 10]);
        expect(pixService.createPixPayment.mock.calls[0][0].amount).toBe(15);
        expect(pixService.createPixPayment.mock.calls[0][0].description).not.toContain('2 evento');
    });

    test('video groups in different events use their own prices', async () => {
        await submit([video, { ...video, id: 'video2', eventId: 'event2', event: { ...event, id: 'event2', pricePerVideo: '12.50' } }]);
        expect(Order.create.mock.calls[0][0].totalAmount).toBe(22.5);
        expect(OrderItem.create.mock.calls.map(call => call[0].price)).toEqual([10, 12.5]);
    });

    test('all-video price applies event freebies and rateio sums exactly to the PIX amount', async () => {
        const media = [0, 1, 2].map(index => ({ ...video, id: `video${index}`, event: { ...event, allVideosPrice: '10.00' } }));
        await submit(media);
        expect(OrderItem.create.mock.calls.map(call => call[0].price)).toEqual([0, 5, 5]);
        expect(pixService.createPixPayment.mock.calls[0][0].amount).toBe(10);
    });

    test.each([
        { quantity: 6, freePhotosCount: 0, packages: [{ quantity: 4, price: 25 }, { quantity: 3, price: 15 }], allPrice: null },
        { quantity: 6, freePhotosCount: 1, packages: [{ quantity: 3, price: 15 }], allPrice: null },
        { quantity: 6, freePhotosCount: 2, packages: [{ quantity: 3, price: 15 }], allPrice: '12.00' },
        { quantity: 1, freePhotosCount: 3, packages: [], allPrice: null }
    ])('photo and video totals match for identical pricing: %j', async configuration => {
        const sharedEvent = { ...event, freePhotosCount: configuration.freePhotosCount, pricePerPhoto: '10.00', pricingPackages: configuration.packages, allPhotosPrice: configuration.allPrice, videoPricingPackages: configuration.packages, allVideosPrice: configuration.allPrice };
        await submit(Array.from({ length: configuration.quantity }, (_, index) => ({ ...photo, id: `photo${index}`, event: sharedEvent })));
        const photoTotal = Order.create.mock.calls[0][0].totalAmount;
        Order.create.mockClear();
        OrderItem.create.mockClear();
        await submit(Array.from({ length: configuration.quantity }, (_, index) => ({ ...video, id: `video${index}`, event: sharedEvent })));
        expect(Order.create.mock.calls[0][0].totalAmount).toBe(photoTotal);
        expect(OrderItem.create.mock.calls.slice(0, Math.min(configuration.freePhotosCount, configuration.quantity - 1)).map(call => call[0].price)).toEqual(Array(Math.min(configuration.freePhotosCount, configuration.quantity - 1)).fill(0));
    });

    test.each([
        { processingStatus: 'pending' },
        { previewKey: null },
        { event: { ...event, isActive: false } },
        { event: { ...event, videoEnabled: false } },
        { event: { ...event, pricePerVideo: null } }
    ])('rejects unavailable video without creating an order: %j', async overrides => {
        const res = await submit([{ ...video, ...overrides }]);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(Order.create).not.toHaveBeenCalled();
        expect(pixService.createPixPayment).not.toHaveBeenCalled();
    });

    test('client-supplied price and media type never override database values', async () => {
        await submit([video], [{ photoId: video.id, price: 0, mediaType: 'photo' }]);
        expect(Order.create.mock.calls[0][0].totalAmount).toBe(10);
    });

    test.each([
        { items: [{ photoId: 'video' }, { photoId: 'video' }] },
        { items: [null] },
        { items: { photoId: 'video' } }
    ])('rejects duplicate or malformed items: %j', async ({ items }) => {
        const res = await submit([video], items);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(Photo.findAll).not.toHaveBeenCalled();
        expect(Order.create).not.toHaveBeenCalled();
    });
});

test('migration is transactional, defaults to photos and protects face records with RLS', async () => {
    const transaction = {};
    const queryInterface = {
        sequelize: {
            transaction: jest.fn(async callback => callback(transaction)),
            query: jest.fn()
        }
    };
    for (const method of ['addColumn', 'addConstraint', 'createTable', 'addIndex', 'dropTable', 'removeColumn', 'removeConstraint']) {
        queryInterface[method] = jest.fn();
    }
    await migration.up(queryInterface, require('sequelize'));
    expect(queryInterface.addColumn).toHaveBeenCalledWith('photos', 'mediaType', expect.objectContaining({ defaultValue: 'photo', allowNull: false }), { transaction });
    expect(queryInterface.addColumn).toHaveBeenCalledWith('events', 'videoEnabled', expect.objectContaining({ defaultValue: false }), { transaction });
    expect(queryInterface.sequelize.query).toHaveBeenCalledWith(expect.stringContaining('ENABLE ROW LEVEL SECURITY'), { transaction });
    expect(queryInterface.sequelize.query).toHaveBeenCalledWith(expect.stringContaining('USING (false)'), { transaction });
    await migration.down(queryInterface);
    expect(queryInterface.dropTable).toHaveBeenCalledWith('media_faces', { transaction });
    expect(queryInterface.removeColumn).toHaveBeenCalledTimes(9);
});