const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const withdrawalController = require('../controllers/withdrawal.controller');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');

const createValidation = [
    body('eventId')
        .isUUID()
        .withMessage('eventId inválido'),
    body('amount')
        .isFloat({ gt: 0 })
        .withMessage('Valor deve ser maior que zero'),
    body('notes')
        .optional()
        .isLength({ max: 1000 })
        .withMessage('Observação deve ter no máximo 1000 caracteres')
];

const updateStatusValidation = [
    body('status')
        .isIn(['approved', 'rejected', 'paid'])
        .withMessage('Status inválido'),
    body('adminNotes')
        .optional()
        .isLength({ max: 1000 })
        .withMessage('Observação deve ter no máximo 1000 caracteres')
];

router.use(authenticate, authorize('admin', 'organizador'));

router.get('/balance/:eventId', param('eventId').isUUID(), validate, withdrawalController.getBalance);
router.get('/', withdrawalController.getAll);
router.post('/', createValidation, validate, withdrawalController.create);
router.patch('/:id/status', authorize('admin'), updateStatusValidation, validate, withdrawalController.updateStatus);

module.exports = router;
