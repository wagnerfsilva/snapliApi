const { AgendaEntry, Event } = require('../models');
const { Op } = require('sequelize');

class AgendaController {
    async getAll(req, res, next) {
        try {
            const { startDate, endDate } = req.query;
            const endExclusive = new Date(`${endDate}T00:00:00.000Z`);
            endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
            const eventWhere = {
                date: { [Op.gte]: new Date(`${startDate}T00:00:00.000Z`), [Op.lt]: endExclusive }
            };
            if (req.userRole === 'fotografo') eventWhere.createdBy = req.userId;
            if (req.userRole === 'organizador') eventWhere.organizerId = req.userId;

            const [entries, events] = await Promise.all([
                AgendaEntry.findAll({
                    where: {
                        userId: req.userId,
                        date: { [Op.between]: [startDate, endDate] }
                    },
                    attributes: ['id', 'title', 'date', 'description'],
                    order: [['date', 'ASC'], ['title', 'ASC']]
                }),
                Event.findAll({
                    where: eventWhere,
                    attributes: ['id', 'name', 'date', 'description'],
                    order: [['date', 'ASC'], ['name', 'ASC']]
                })
            ]);

            const items = [
                ...entries.map(entry => ({ ...entry.toJSON(), source: 'agenda' })),
                ...events.map(event => ({
                    id: event.id,
                    title: event.name,
                    // Existing event forms store their selected calendar day in UTC.
                    date: new Date(event.date).toISOString().slice(0, 10),
                    description: event.description,
                    source: 'event'
                }))
            ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'pt-BR'));

            res.json({ success: true, data: { items } });
        } catch (error) {
            next(error);
        }
    }

    async create(req, res, next) {
        try {
            const entry = await AgendaEntry.create({
                userId: req.userId,
                title: req.body.title,
                date: req.body.date,
                description: req.body.description ?? ''
            });
            res.status(201).json({
                success: true,
                data: {
                    item: {
                        id: entry.id,
                        title: entry.title,
                        date: entry.date,
                        description: entry.description,
                        source: 'agenda'
                    }
                }
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new AgendaController();
