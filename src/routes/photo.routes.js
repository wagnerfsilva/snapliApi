const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const photoController = require('../controllers/photo.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadMultiple } = require('../middleware/upload');
const validate = require('../middleware/validate');

// Validation rules
const uploadValidation = [
    body('eventId')
        .notEmpty()
        .withMessage('ID do evento é obrigatório')
        .isUUID()
        .withMessage('ID do evento inválido')
];

// All routes require authentication and admin role
router.use(authenticate, authorize('admin'));

// Routes
router.post('/upload', uploadMultiple, uploadValidation, validate, photoController.upload);
router.get('/event/:eventId', photoController.getByEvent);
router.get('/:id', photoController.getById);
router.get('/:id/download', photoController.getDownloadUrl);
router.post('/:id/retry', photoController.retryProcessing);
router.delete('/:id', photoController.delete);

module.exports = router;
