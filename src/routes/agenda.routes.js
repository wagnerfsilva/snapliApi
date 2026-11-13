const express = require('express');
const { body, query, param } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const controller = require('../controllers/agenda.controller');

const router = express.Router();
const calendarDate = field => field
    .isString().bail()
    .matches(/^\d{4}-\d{2}-\d{2}$/).bail()
    .isISO8601({ strict: true })
    .withMessage('Informe uma data válida no formato AAAA-MM-DD');

router.use(authenticate, authorize('admin', 'fotografo', 'organizador'));

router.get('/', [
    calendarDate(query('startDate')),
    calendarDate(query('endDate')),
    query('endDate').custom((value, { req }) => {
        if (value < req.query.startDate) throw new Error('Data final deve ser igual ou posterior à inicial');
        return true;
    })
], validate, controller.getAll);

router.post('/', [
    body('title').isString().bail().trim().notEmpty()
        .withMessage('Título é obrigatório')
        .isLength({ max: 255 }).withMessage('Título deve ter no máximo 255 caracteres'),
    calendarDate(body('date')),
    body('description').optional().isString().bail()
        .isLength({ max: 5000 }).withMessage('Descrição deve ter no máximo 5000 caracteres')
], validate, controller.create);

router.delete('/:id', [
    param('id').isUUID().withMessage('Identificador do compromisso inválido')
], validate, controller.delete);

module.exports = router;
