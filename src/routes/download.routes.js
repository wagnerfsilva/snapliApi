const express = require('express');
const router = express.Router();
const downloadController = require('../controllers/download.controller');
const { authenticate } = require('../middleware/auth');

/**
 * PUBLIC ROUTES (require download token, not auth)
 */

// Get order details by token
router.get('/:token', downloadController.getOrderByToken);

// Download specific photo
router.get('/:token/photo/:photoId', downloadController.downloadPhoto);

// Download all photos as ZIP (future)
router.get('/:token/zip', downloadController.downloadAllPhotos);

/**
 * PROTECTED ROUTES (require authentication)
 */

// Generate download token for order (admin or order owner)
router.post('/generate/:orderId', authenticate, downloadController.generateDownloadToken);

// Resend download email
router.post('/resend/:orderId', authenticate, downloadController.resendDownloadEmail);

// TEST: Endpoint temporário para validar email em produção (remover depois)
router.get('/test-email/:orderId', downloadController.resendDownloadEmail);

module.exports = router;
