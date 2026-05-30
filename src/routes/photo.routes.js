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

// Authenticated routes (event admin only)
router.get('/event/:eventId/gallery', authenticate, authorize('admin', 'fotografo'), photoController.getEventPhotosPublic);

// Internal Lambda callback (authenticated via x-lambda-secret header, no JWT needed)
router.post('/lambda-callback', photoController.lambdaCallback);

// Admin/fotografo routes
router.post('/upload', authenticate, authorize('admin', 'fotografo'), uploadMultiple, uploadValidation, validate, photoController.upload);
router.get('/event/:eventId', authenticate, authorize('admin', 'fotografo'), photoController.getByEvent);
router.get('/:id', authenticate, authorize('admin', 'fotografo'), photoController.getById);
router.get('/:id/download', authenticate, authorize('admin', 'fotografo'), photoController.getDownloadUrl);
router.post('/:id/retry', authenticate, authorize('admin', 'fotografo'), photoController.retryProcessing);
router.delete('/:id', authenticate, authorize('admin', 'fotografo'), photoController.delete);

module.exports = router;
