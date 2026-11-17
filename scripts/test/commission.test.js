'use strict';

const { spawnSync } = require('node:child_process');

jest.mock('../../src/models', () => ({
    sequelize: { query: jest.fn() },
    Event: { findAndCountAll: jest.fn(), findByPk: jest.fn() },
    Photo: {},
    User: { findByPk: jest.fn() },
    WithdrawalRequest: { create: jest.fn() }
}));
jest.mock('../../src/utils/logger', () => ({ error: jest.fn(), info: jest.fn() }));

const { sequelize, Event, User, WithdrawalRequest } = require('../../src/models');
const commissionService = require('../../src/services/commission.service');
const eventController = require('../../src/controllers/event.controller');
const withdrawalController = require('../../src/controllers/withdrawal.controller');

const fixture = `
    CREATE TABLE orders (id TEXT, "totalAmount" REAL, status TEXT);
    CREATE TABLE photos (id TEXT, "eventId" TEXT, "mediaType" TEXT);
    CREATE TABLE order_items (id TEXT, "orderId" TEXT, "photoId" TEXT, price REAL);
    CREATE TABLE withdrawal_requests ("eventId" TEXT, amount REAL, status TEXT);
    INSERT INTO orders VALUES ('mixed', 100, 'paid');
    INSERT INTO photos VALUES
        ('photo-a', 'event-a', 'photo'),
        ('free-photo-a', 'event-a', 'photo'),
        ('video-b', 'event-b', 'video');
    INSERT INTO order_items VALUES
        ('item-a', 'mixed', 'photo-a', 30),
        ('free-item-a', 'mixed', 'free-photo-a', 0),
        ('item-b', 'mixed', 'video-b', 70);
`;

let adjustment;

function executeSql(sql) {
    const result = spawnSync('sqlite3', ['-json', ':memory:', fixture + adjustment + sql], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim() ? JSON.parse(result.stdout) : [];
}

beforeEach(() => {
    jest.clearAllMocks();
    adjustment = '';
    sequelize.query.mockImplementation(async (sql, { replacements }) => executeSql(
        sql.replace(/:eventId/g, `'${replacements.eventId}'`)
            .replace(/:statuses/g, "'pending', 'approved', 'paid'")
    ));
    Event.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
});

async function listedRevenue(eventId) {
    const next = jest.fn();
    const res = { json: jest.fn(body => JSON.parse(JSON.stringify(body))) };
    await eventController.getAll({ query: {}, userRole: 'admin' }, res, next);
    expect(next).not.toHaveBeenCalled();
    const options = Event.findAndCountAll.mock.calls.at(-1)[0];
    const [expression] = options.attributes.include.find(([, alias]) => alias === 'totalRevenue');
    const [row] = executeSql(`
        SELECT ${expression.val} AS "totalRevenue"
        FROM (SELECT '${eventId}' AS id) AS "Event";
    `);
    return row.totalRevenue;
}

test.each([
    ['event-a', 30, 2],
    ['event-b', 70, 1]
])('attributes only the items from %s, including free photos and videos', async (eventId, revenue, itemCount) => {
    const summary = await commissionService.getEventSalesSummary(eventId);
    expect(summary).toEqual({
        totalOrders: 1,
        totalRevenue: revenue,
        totalPhotosSold: itemCount,
        avgPhotosPerOrder: itemCount,
        avgOrderValue: revenue
    });
    expect(await listedRevenue(eventId)).toBe(revenue);
    const balance = await commissionService.getOrganizerEventBalance({ id: eventId, organizerCommissionPercentage: 10 });
    expect(balance.commissionTotal).toBeCloseTo(revenue * 0.1);
    expect(balance.availableBalance).toBeCloseTo(revenue * 0.1);
});

test.each([['event-a', 24], ['event-b', 56]])('allocates adjusted order totals proportionally for %s', async (eventId, revenue) => {
    adjustment = 'UPDATE orders SET "totalAmount" = 80;';
    expect((await commissionService.getEventSalesSummary(eventId)).totalRevenue).toBe(revenue);
    expect(await listedRevenue(eventId)).toBe(revenue);
});

test('keeps the entire paid amount for a single-event order despite item rounding', async () => {
    adjustment = `
        UPDATE photos SET "eventId" = 'event-a';
        UPDATE order_items SET price = 33.33;
    `;
    expect((await commissionService.getEventSalesSummary('event-a')).totalRevenue).toBeCloseTo(100);
    expect(await listedRevenue('event-a')).toBeCloseTo(100);
});

test.each(['pending', 'refunded'])('excludes %s orders', async status => {
    adjustment = `UPDATE orders SET status = '${status}';`;
    expect(await commissionService.getEventSalesSummary('event-a')).toMatchObject({ totalOrders: 0, totalRevenue: 0, totalPhotosSold: 0 });
    expect(await listedRevenue('event-a')).toBe(0);
});

test('includes completed orders', async () => {
    adjustment = "UPDATE orders SET status = 'completed';";
    expect((await commissionService.getEventSalesSummary('event-a')).totalRevenue).toBe(30);
    expect(await listedRevenue('event-a')).toBe(30);
});

test('returns zero when an event has no sales or all item prices are zero', async () => {
    expect((await commissionService.getEventSalesSummary('empty')).totalRevenue).toBe(0);
    expect(await listedRevenue('empty')).toBe(0);
    adjustment = 'UPDATE order_items SET price = 0;';
    expect((await commissionService.getEventSalesSummary('event-a')).totalRevenue).toBe(0);
    expect(await listedRevenue('event-a')).toBe(0);
});

test('deducts only reserved or paid withdrawals from the corrected commission', async () => {
    adjustment = `
        INSERT INTO withdrawal_requests VALUES
            ('event-a', 1, 'pending'),
            ('event-a', 0.5, 'approved'),
            ('event-a', 0.5, 'paid'),
            ('event-a', 100, 'rejected'),
            ('event-b', 100, 'pending');
    `;
    const balance = await commissionService.getOrganizerEventBalance({ id: 'event-a', organizerCommissionPercentage: 10 });
    expect(balance.commissionTotal).toBe(3);
    expect(balance.reservedOrPaidTotal).toBe(2);
    expect(balance.availableBalance).toBe(1);
});

test('does not expose negative available balances after existing withdrawals', async () => {
    adjustment = "INSERT INTO withdrawal_requests VALUES ('event-a', 10, 'paid');";
    const balance = await commissionService.getOrganizerEventBalance({ id: 'event-a', organizerCommissionPercentage: 10 });
    expect(balance.commissionTotal).toBe(3);
    expect(balance.availableBalance).toBe(0);
});

test.each([
    ['1997.86', 30, 599.36],
    ['1997.84', 30, 599.35],
    ['1.15', 50, 0.58]
])('rounds commission on revenue %s at %s percent to cents', async (revenue, percentage, expected) => {
    sequelize.query
        .mockResolvedValueOnce([{ totalOrders: '1', totalRevenue: revenue, totalPhotosSold: '1' }])
        .mockResolvedValueOnce([{ reservedOrPaidTotal: '0' }]);

    const balance = await commissionService.getOrganizerEventBalance({
        id: 'event-a', organizerCommissionPercentage: percentage
    });

    expect(balance.commissionTotal).toBe(expected);
    expect(balance.availableBalance).toBe(expected);
});

test('subtracts withdrawals in cents from the rounded commission without floating-point residue', async () => {
    sequelize.query
        .mockResolvedValueOnce([{ totalOrders: '1', totalRevenue: '1997.86', totalPhotosSold: '1' }])
        .mockResolvedValueOnce([{ reservedOrPaidTotal: '590.17' }]);

    const balance = await commissionService.getOrganizerEventBalance({
        id: 'event-a', organizerCommissionPercentage: 30
    });

    expect(balance.commissionTotal).toBe(599.36);
    expect(balance.reservedOrPaidTotal).toBe(590.17);
    expect(balance.availableBalance).toBe(9.19);
});

test.each([
    [599.36, 201],
    [599.37, 400]
])('responds with %s withdrawal using the rounded balance (HTTP %s)', async (amount, status) => {
    Event.findByPk.mockResolvedValue({
        id: 'event-a', organizerId: 'organizer-a', organizerCommissionPercentage: 30
    });
    User.findByPk.mockResolvedValue({ pixKey: 'test-pix-key' });
    WithdrawalRequest.create.mockResolvedValue({ id: 'withdrawal-a', amount });
    sequelize.query
        .mockResolvedValueOnce([{ count: '0' }])
        .mockResolvedValueOnce([{ totalOrders: '1', totalRevenue: '1997.86', totalPhotosSold: '1' }])
        .mockResolvedValueOnce([{ reservedOrPaidTotal: '0' }]);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await withdrawalController.create({
        body: { eventId: 'event-a', amount }, userId: 'organizer-a'
    }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(status);
    if (status === 201) {
        expect(WithdrawalRequest.create).toHaveBeenCalledWith(expect.objectContaining({ amount }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    } else {
        expect(WithdrawalRequest.create).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: 'Valor solicitado excede o saldo disponível (R$ 599.36)'
        });
    }
});

test('courtesy does not add sales, sold files, revenue, commission or withdrawal balance', async () => {
    adjustment = `
        INSERT INTO orders VALUES ('gift', 0, 'courtesy');
        INSERT INTO order_items VALUES ('gift-photo', 'gift', 'photo-a', 0), ('gift-video', 'gift', 'video-b', 0);
    `;
    expect(await commissionService.getEventSalesSummary('event-a')).toMatchObject({
        totalOrders: 1, totalRevenue: 30, totalPhotosSold: 2
    });
    expect(await commissionService.getOrganizerEventBalance({ id: 'event-a', organizerCommissionPercentage: 10 }))
        .toMatchObject({ commissionTotal: 3, availableBalance: 3 });

    const event = { id: 'event-a', setDataValue: jest.fn() };
    Event.findAndCountAll.mockResolvedValue({ count: 1, rows: [event] });
    sequelize.query.mockImplementation(async (sql, { replacements }) => executeSql(
        sql.replace(/:eventIds/g, replacements.eventIds.map(id => `'${id}'`).join(','))
    ));
    const next = jest.fn();
    await eventController.getAll({ query: {}, userRole: 'admin' }, { json: jest.fn() }, next);
    expect(next).not.toHaveBeenCalled();
    expect(event.setDataValue).toHaveBeenCalledWith('paidOrdersCount', 1);
    expect(event.setDataValue).toHaveBeenCalledWith('totalRevenue', 30);
});