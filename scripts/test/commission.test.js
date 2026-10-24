'use strict';

const { spawnSync } = require('node:child_process');

jest.mock('../../src/models', () => ({
    sequelize: { query: jest.fn() },
    Event: { findAndCountAll: jest.fn() },
    Photo: {},
    User: {}
}));
jest.mock('../../src/utils/logger', () => ({ error: jest.fn() }));

const { sequelize, Event } = require('../../src/models');
const commissionService = require('../../src/services/commission.service');
const eventController = require('../../src/controllers/event.controller');

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
    return JSON.parse(result.stdout);
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