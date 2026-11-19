const express = require('express');
const router = express.Router();
const { body, query, param } = require('express-validator');
const eventController = require('../controllers/event.controller');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const photographerValidation = [
    body('photographerId').optional({ nullable: true }).isUUID().withMessage('photographerId inválido'),
    body('photographerCommissionPercentage').optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage('Comissão deve ser entre 0 e 100')
];

// Validation rules
const createEventValidation = [
    body('name')
        .notEmpty()
        .withMessage('Nome do evento é obrigatório')
        .isLength({ max: 255 })
        .withMessage('Nome deve ter no máximo 255 caracteres'),
    body('date')
        .notEmpty()
        .withMessage('Data do evento é obrigatória')
        .isISO8601()
        .withMessage('Data inválida'),
    body('description')
        .optional()
        .isLength({ max: 5000 })
        .withMessage('Descrição deve ter no máximo 5000 caracteres'),
    body('location')
        .optional()
        .isLength({ max: 255 })
        .withMessage('Localização deve ter no máximo 255 caracteres'),
    body('organizerId')
        .optional({ nullable: true })
        .isUUID()
        .withMessage('organizerId inválido'),
    body('organizerCommissionPercentage')
        .optional({ nullable: true })
        .isFloat({ min: 0, max: 100 })
        .withMessage('Comissão deve ser entre 0 e 100')
];

const updateEventValidation = [
    body('name')
        .optional()
        .notEmpty()
        .withMessage('Nome não pode estar vazio')
        .isLength({ max: 255 })
        .withMessage('Nome deve ter no máximo 255 caracteres'),
    body('date')
        .optional()
        .isISO8601()
        .withMessage('Data inválida'),
    body('description')
        .optional()
        .isLength({ max: 5000 })
        .withMessage('Descrição deve ter no máximo 5000 caracteres'),
    body('location')
        .optional()
        .isLength({ max: 255 })
        .withMessage('Localização deve ter no máximo 255 caracteres'),
    body('isActive')
        .optional()
        .isBoolean()
        .withMessage('isActive deve ser booleano'),
    body('organizerId')
        .optional({ nullable: true })
        .isUUID()
        .withMessage('organizerId inválido'),
    body('organizerCommissionPercentage')
        .optional({ nullable: true })
        .isFloat({ min: 0, max: 100 })
        .withMessage('Comissão deve ser entre 0 e 100')
];

// All routes require authentication
router.use(authenticate);

// Read routes — admin, fotografo and organizador (own events, filtered in controller)
router.get('/', authorize('admin', 'fotografo', 'organizador'), [
    query('approvalStatus').optional().isIn(['pending', 'approved']).withMessage('Status de aprovação inválido')
], validate, eventController.getAll);
router.get('/:id', authorize('admin', 'fotografo', 'organizador'), eventController.getById);
router.get('/:id/statistics', authorize('admin', 'fotografo', 'organizador'), eventController.getStatistics);

// Write routes — admin and fotografo only (organizador never creates/edits events)
router.post('/', authorize('admin', 'fotografo'), createEventValidation, photographerValidation, validate, eventController.create);
router.put('/:id', authorize('admin', 'fotografo'), updateEventValidation, photographerValidation, validate, eventController.update);
router.patch('/:id/approve', authorize('admin'), [
    param('id').isUUID().withMessage('Evento inválido')
], updateEventValidation, photographerValidation, validate, eventController.approve);
router.delete('/:id', authorize('admin', 'fotografo'), eventController.delete);

module.exports = router;
