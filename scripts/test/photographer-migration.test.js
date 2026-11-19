'use strict';

const { spawnSync } = require('node:child_process');
const { Sequelize, DataTypes } = require('sequelize');
const migration = require('../../src/migrations/20261119000001-add-photographer-and-event-approval');

let queryInterface;
const transaction = { test: true };

beforeEach(() => {
    queryInterface = {
        addColumn: jest.fn(), addIndex: jest.fn(), removeColumn: jest.fn(),
        sequelize: {
            transaction: jest.fn(callback => callback(transaction)),
            query: jest.fn(async () => [[], {}])
        }
    };
});

function executeSql(sql) {
    const result = spawnSync('sqlite3', ['-json', ':memory:', sql], { encoding: 'utf8' });
    if (result.error) throw result.error;
    return result;
}

function checkConstraint(name) {
    const sql = queryInterface.sequelize.query.mock.calls.find(([query]) => query.includes(name))[0];
    return sql.match(/CHECK\s*(\([\s\S]*\))\s*$/)[1];
}

test('migration backfills only approval, preserving legacy state and leaving new events pending', async () => {
    await migration.up(queryInterface, Sequelize);
    const approvalColumn = queryInterface.addColumn.mock.calls.find(([table, column]) => table === 'events' && column === 'approvalStatus')[2];
    const backfill = queryInterface.sequelize.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE events'))[0];
    const result = executeSql(`
        CREATE TABLE events (id TEXT, "isActive" INTEGER, "archivedAt" TEXT, "organizerCommissionPercentage" NUMERIC,
            "approvalStatus" TEXT DEFAULT '${approvalColumn.defaultValue}');
        INSERT INTO events(id,"isActive","organizerCommissionPercentage") VALUES ('active',1,15);
        INSERT INTO events(id,"isActive","archivedAt","organizerCommissionPercentage") VALUES ('archived',0,'2026-11-01',50);
        ${backfill};
        INSERT INTO events(id,"isActive") VALUES ('new',0);
        SELECT * FROM events ORDER BY id;
    `);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
        { id: 'active', isActive: 1, archivedAt: null, organizerCommissionPercentage: 15, approvalStatus: 'approved' },
        { id: 'archived', isActive: 0, archivedAt: '2026-11-01', organizerCommissionPercentage: 50, approvalStatus: 'approved' },
        { id: 'new', isActive: 0, archivedAt: null, organizerCommissionPercentage: null, approvalStatus: 'pending' }
    ]);
    for (const [, options] of queryInterface.sequelize.query.mock.calls) expect(options.transaction).toBe(transaction);
    expect(queryInterface.sequelize.query.mock.calls.filter(([sql]) => /\bUPDATE\b/i.test(sql))).toHaveLength(1);
});

test.each([
    ['NULL, NULL', true], ['15.15, 84.85', true], ['100, 0', true],
    ['15, 85.01', false], ['-1, 50', false], ['0, 100.01', false]
])('database commission constraint validates %s', async (values, valid) => {
    await migration.up(queryInterface, Sequelize);
    const result = executeSql(`
        CREATE TABLE events ("organizerCommissionPercentage" NUMERIC, "photographerCommissionPercentage" NUMERIC,
            CHECK ${checkConstraint('event_commission_limit')});
        INSERT INTO events VALUES (${values});
    `);
    expect(result.status === 0).toBe(valid);
});

test.each([
    ["'organizer', NULL", true], ["NULL, 'photographer'", true],
    ["NULL, NULL", false], ["'organizer', 'photographer'", false]
])('database withdrawal constraint requires one beneficiary: %s', async (values, valid) => {
    await migration.up(queryInterface, Sequelize);
    const result = executeSql(`
        CREATE TABLE withdrawal_requests ("organizerId" TEXT, "photographerId" TEXT,
            CHECK ${checkConstraint('withdrawal_one_beneficiary')});
        INSERT INTO withdrawal_requests VALUES (${values});
    `);
    expect(result.status === 0).toBe(valid);
});

test('rollback refuses to erase photographer withdrawal history', async () => {
    queryInterface.sequelize.query.mockImplementation(async sql => (
        sql.startsWith('SELECT') ? [[{ id: 'existing-photographer-withdrawal' }], {}] : [[], {}]
    ));
    await expect(migration.down(queryInterface)).rejects.toThrow('Existem saques de fotografos');
    expect(queryInterface.removeColumn).not.toHaveBeenCalled();
    expect(queryInterface.sequelize.query.mock.calls[0][0]).toMatch(/^LOCK TABLE withdrawal_requests/);
});

test('models enforce the commission ceiling and exactly one withdrawal beneficiary without connecting to a database', async () => {
    const sequelize = new Sequelize('postgres://test:test@127.0.0.1/test', { logging: false });
    try {
        const Event = require('../../src/models/event')(sequelize, DataTypes);
        const Withdrawal = require('../../src/models/withdrawalRequest')(sequelize, DataTypes);
        const event = Event.build({
            name: 'Evento', date: new Date(), createdBy: 'creator',
            organizerCommissionPercentage: 15, photographerCommissionPercentage: 85.01
        });
        await expect(event.validate()).rejects.toThrow('A soma das comissões');
        event.photographerCommissionPercentage = 85;
        await expect(event.validate()).resolves.toBeDefined();
        const withdrawal = Withdrawal.build({ eventId: 'event', amount: 10 });
        await expect(withdrawal.validate()).rejects.toThrow('exatamente um beneficiário');
        withdrawal.photographerId = 'photographer';
        await expect(withdrawal.validate()).resolves.toBeDefined();
        withdrawal.organizerId = 'organizer';
        await expect(withdrawal.validate()).rejects.toThrow('exatamente um beneficiário');
    } finally {
        await sequelize.close();
    }
});
