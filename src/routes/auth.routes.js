const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');

// Validation rules
const loginValidation = [
    body('email')
        .isEmail()
        .withMessage('Email inválido')
        .normalizeEmail(),
    body('password')
        .notEmpty()
        .withMessage('Senha é obrigatória')
];

const changePasswordValidation = [
    body('currentPassword')
        .notEmpty()
        .withMessage('Senha atual é obrigatória'),
    body('newPassword')
        .isLength({ min: 6 })
        .withMessage('Nova senha deve ter no mínimo 6 caracteres')
];

// Routes
router.post('/login', loginValidation, validate, authController.login);
router.get('/me', authenticate, authController.me);
router.post('/logout', authenticate, authController.logout);
router.post('/change-password', authenticate, changePasswordValidation, validate, authController.changePassword);

module.exports = router;
