const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const eventController = require('../controllers/event.controller');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');

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
        .withMessage('Localização deve ter no máximo 255 caracteres')
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
        .withMessage('isActive deve ser booleano')
];

// All routes require authentication and admin role
router.use(authenticate, authorize('admin'));

// Routes
router.get('/', eventController.getAll);
router.get('/:id', eventController.getById);
router.get('/:id/statistics', eventController.getStatistics);
router.post('/', createEventValidation, validate, eventController.create);
router.put('/:id', updateEventValidation, validate, eventController.update);
router.delete('/:id', eventController.delete);

module.exports = router;
