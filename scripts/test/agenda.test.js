'use strict';

jest.mock('../../src/models', () => ({
    AgendaEntry: { findAll: jest.fn(), create: jest.fn(), destroy: jest.fn() },
    Event: { findAll: jest.fn() },
    User: { findByPk: jest.fn() }
}));
jest.mock('../../src/utils/logger', () => ({ error: jest.fn() }));
jest.mock('../../src/config/jwt', () => ({
    secret: 'agenda-test-secret-only',
    issuer: 'snapli-test',
    audience: 'snapli-test'
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const jwtConfig = require('../../src/config/jwt');
const { Op } = require('sequelize');
const { AgendaEntry, Event, User } = require('../../src/models');
const router = require('../../src/routes/agenda.routes');
const entryId = 'c0d582d7-b530-41a2-88fa-6e9d178e9b08';

const app = express();
app.use(express.json());
app.use('/agenda', router);
app.use((error, req, res, next) => {
    res.status(500).json({ success: false, message: error.message });
});

function token(role = 'fotografo', id = 'current-user') {
    User.findByPk.mockResolvedValue({ id, role, isActive: true });
    return jwt.sign({ userId: id }, jwtConfig.secret, {
        issuer: jwtConfig.issuer, audience: jwtConfig.audience, expiresIn: '5m'
    });
}

beforeEach(() => {
    jest.resetAllMocks();
    AgendaEntry.findAll.mockResolvedValue([]);
    Event.findAll.mockResolvedValue([]);
    AgendaEntry.create.mockImplementation(async data => ({ id: 'new-entry', ...data }));
});

test.each([
    ['fotografo', { [Op.or]: [{ createdBy: 'current-user' }, { photographerId: 'current-user' }] }],
    ['organizador', { organizerId: 'current-user' }],
    ['admin', {}]
])('agenda respects %s event visibility and always isolates personal entries', async (role, ownership) => {
    const response = await request(app).get('/agenda')
        .query({ startDate: '2026-11-01', endDate: '2026-11-30', userId: 'other-user' })
        .auth(token(role), { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(AgendaEntry.findAll.mock.calls[0][0].where).toEqual({
        userId: 'current-user',
        date: { [Op.between]: ['2026-11-01', '2026-11-30'] }
    });
    expect(Event.findAll.mock.calls[0][0].where).toEqual({
        [Op.and]: [ownership],
        date: {
            [Op.gte]: new Date('2026-11-01T00:00:00Z'),
            [Op.lt]: new Date('2026-12-01T00:00:00Z')
        }
    });
});

test('merges both sources with descriptions, stable IDs and original calendar dates', async () => {
    AgendaEntry.findAll.mockResolvedValue([{
        toJSON: () => ({ id: 'same-id', title: 'Reunião', date: '2026-11-13', description: 'Planejamento' })
    }]);
    Event.findAll.mockResolvedValue([{
        id: 'same-id', name: 'Corrida', date: new Date('2026-11-13T00:00:00Z'), description: 'Cobertura'
    }]);
    const response = await request(app).get('/agenda')
        .query({ startDate: '2026-11-01', endDate: '2026-11-30' })
        .auth(token(), { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([
        { id: 'same-id', title: 'Corrida', date: '2026-11-13', description: 'Cobertura', source: 'event' },
        { id: 'same-id', title: 'Reunião', date: '2026-11-13', description: 'Planejamento', source: 'agenda' }
    ]);
});

test('calendar periods are not truncated by the event list page limit', async () => {
    Event.findAll.mockResolvedValue(Array.from({ length: 150 }, (_, index) => ({
        id: `event-${index}`, name: `Evento ${index}`, date: new Date('2026-11-13T00:00:00Z'), description: ''
    })));
    const response = await request(app).get('/agenda')
        .query({ startDate: '2026-01-01', endDate: '2026-12-31' })
        .auth(token(), { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(150);
    expect(Event.findAll.mock.calls[0][0].limit).toBeUndefined();
});

test.each(['admin', 'fotografo', 'organizador'])('%s can persist a personal entry without impersonating another user', async role => {
    const response = await request(app).post('/agenda')
        .auth(token(role), { type: 'bearer' })
        .send({ title: ' Ensaio ', date: '2026-11-13', description: 'Na praça', userId: 'other', source: 'event' });
    expect(response.status).toBe(201);
    expect(AgendaEntry.create).toHaveBeenCalledWith({
        userId: 'current-user', title: 'Ensaio', date: '2026-11-13', description: 'Na praça'
    });
    expect(response.body.data.item).toEqual({
        id: 'new-entry', title: 'Ensaio', date: '2026-11-13', description: 'Na praça', source: 'agenda'
    });
});

test.each([
    { title: '   ', date: '2026-11-13' },
    { title: 'Evento', date: '2026-02-30' },
    { title: 'Evento', date: '2026-13-01' },
    { title: 'Evento', date: '2026-11-13T00:00:00Z' },
    { title: 'Evento', date: '2026-11-13', description: 'a'.repeat(5001) },
    { title: 'a'.repeat(256), date: '2026-11-13' },
    { title: ['Evento'], date: '2026-11-13' }
])('invalid personal entry %# returns validation errors without writing', async body => {
    const response = await request(app).post('/agenda').auth(token(), { type: 'bearer' }).send(body);
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errors.length).toBeGreaterThan(0);
    expect(AgendaEntry.create).not.toHaveBeenCalled();
});

test.each([
    {},
    { startDate: '2026-02-30', endDate: '2026-03-01' },
    { startDate: '2026-12-01', endDate: '2026-11-01' }
])('invalid ranges are rejected before querying: %j', async query => {
    const response = await request(app).get('/agenda').query(query).auth(token(), { type: 'bearer' });
    expect(response.status).toBe(400);
    expect(AgendaEntry.findAll).not.toHaveBeenCalled();
    expect(Event.findAll).not.toHaveBeenCalled();
});

test('unauthenticated requests cannot list or create entries', async () => {
    expect((await request(app).get('/agenda')).status).toBe(401);
    expect((await request(app).post('/agenda').send({})).status).toBe(401);
    expect(AgendaEntry.findAll).not.toHaveBeenCalled();
    expect(AgendaEntry.create).not.toHaveBeenCalled();
});

test('unsupported roles cannot access the agenda', async () => {
    expect((await request(app).get('/agenda').auth(token('client'), { type: 'bearer' })).status).toBe(403);
    expect(AgendaEntry.findAll).not.toHaveBeenCalled();
});

test('database failures propagate instead of returning an empty agenda or a successful write', async () => {
    AgendaEntry.findAll.mockRejectedValue(new Error('Read failed'));
    AgendaEntry.create.mockRejectedValue(new Error('Write failed'));
    const auth = token();
    const response = await request(app).get('/agenda')
        .query({ startDate: '2026-11-01', endDate: '2026-11-30' }).auth(auth, { type: 'bearer' });
    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    const creation = await request(app).post('/agenda').auth(auth, { type: 'bearer' })
        .send({ title: 'Evento', date: '2026-11-13' });
    expect(creation.status).toBe(500);
    expect(creation.body.success).toBe(false);
});

test.each(['admin', 'fotografo', 'organizador'])('%s can remove only their own personal entry', async role => {
    const storedEntries = [{ id: entryId, userId: 'owner' }];
    AgendaEntry.destroy.mockImplementation(async ({ where }) => {
        const index = storedEntries.findIndex(entry => entry.id === where.id && entry.userId === where.userId);
        if (index < 0) return 0;
        storedEntries.splice(index, 1);
        return 1;
    });

    const denied = await request(app).delete(`/agenda/${entryId}`)
        .query({ userId: 'owner' }).auth(token(role, 'other-user'), { type: 'bearer' })
        .send({ userId: 'owner' });
    expect(denied.status).toBe(404);
    expect(denied.body.success).toBe(false);
    expect(storedEntries).toHaveLength(1);
    expect(AgendaEntry.destroy).toHaveBeenLastCalledWith({
        where: { id: entryId, userId: 'other-user' }
    });

    const removed = await request(app).delete(`/agenda/${entryId}`)
        .auth(token(role, 'owner'), { type: 'bearer' });
    expect(removed.status).toBe(200);
    expect(removed.body.success).toBe(true);
    expect(storedEntries).toHaveLength(0);

    const repeated = await request(app).delete(`/agenda/${entryId}`)
        .auth(token(role, 'owner'), { type: 'bearer' });
    expect(repeated.status).toBe(404);
    expect(repeated.body.success).toBe(false);
});

test('removing an invalid ID is rejected without querying the database', async () => {
    const response = await request(app).delete('/agenda/invalid-id').auth(token(), { type: 'bearer' });
    expect(response.status).toBe(400);
    expect(AgendaEntry.destroy).not.toHaveBeenCalled();
});

test('unauthenticated and unsupported users cannot remove personal entries', async () => {
    expect((await request(app).delete(`/agenda/${entryId}`)).status).toBe(401);
    expect((await request(app).delete(`/agenda/${entryId}`)
        .auth(token('client'), { type: 'bearer' })).status).toBe(403);
    expect(AgendaEntry.destroy).not.toHaveBeenCalled();
});

test('delete failures are propagated without reporting success', async () => {
    AgendaEntry.destroy.mockRejectedValue(new Error('Delete failed'));
    const response = await request(app).delete(`/agenda/${entryId}`).auth(token(), { type: 'bearer' });
    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
});
