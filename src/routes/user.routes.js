const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const userController = require('../controllers/user.controller');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');

const searchOrganizersValidation = [
    query('q')
        .trim()
        .isLength({ min: 2 })
        .withMessage('Termo de busca deve ter no mínimo 2 caracteres')
];

const createUserValidation = [
    body('name')
        .notEmpty()
        .withMessage('Nome é obrigatório')
        .isLength({ max: 255 })
        .withMessage('Nome deve ter no máximo 255 caracteres'),
    body('email')
        .isEmail()
        .withMessage('Email inválido')
        .normalizeEmail(),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Senha deve ter no mínimo 6 caracteres'),
    body('role')
        .isIn(['fotografo', 'organizador'])
        .withMessage('Role deve ser fotografo ou organizador')
];

router.use(authenticate);

// Search organizadores — admin and fotografo (used by the event form autocomplete)
router.get('/search-organizers', authorize('admin', 'fotografo'), searchOrganizersValidation, validate, userController.searchOrganizers);

// User management — admin only
router.use(authorize('admin'));
router.get('/', userController.getAll);
router.post('/', createUserValidation, validate, userController.create);
router.patch('/:id/toggle-active', userController.toggleActive);

module.exports = router;
