const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { authenticate, authorize, optionalAuth } = require('../middleware/auth');
const { body, query, param } = require('express-validator');
const validate = require('../middleware/validate');

/**
 * PUBLIC ROUTES
 */

// Create new order
router.post('/', orderController.createOrder);

router.get('/courtesy', authenticate, authorize('admin'), [
    query('limit').optional().isString().bail().isInt({ min: 1, max: 100 }).withMessage('Limite deve ser de 1 a 100'),
    query('offset').optional().isString().bail().isInt({ min: 0, max: Number.MAX_SAFE_INTEGER }).withMessage('Deslocamento inválido')
], validate, orderController.listCourtesyOrders);

router.delete('/courtesy/:orderId', authenticate, authorize('admin'), [
    param('orderId').isUUID().withMessage('Identificador de cortesia inválido')
], validate, orderController.deleteCourtesyOrder);

router.post('/courtesy', authenticate, authorize('admin'), [
    body('customerEmail').optional({ nullable: true }).isString().bail()
        .trim().if(body('customerEmail').notEmpty())
        .isEmail().isLength({ max: 255 }).withMessage('Email invalido'),
    body('items').isArray({ min: 1, max: 1000 }).withMessage('Selecione entre 1 e 1000 arquivos'),
    body('items.*.photoId').isUUID().withMessage('Identificador de arquivo invalido')
], validate, orderController.createCourtesyOrder);

// Ordinary checkout remains public; courtesy details require an authenticated admin.
router.get('/:orderId', optionalAuth, orderController.getOrder);

// Validate payment status
router.get('/:orderId/validate-payment', orderController.validatePayment);

// Get PIX QR Code for an order
router.get('/:orderId/pix-qrcode', orderController.getPixQrCode);

// Asaas webhook
router.post('/webhook/asaas', orderController.asaasWebhook);

/**
 * PROTECTED ROUTES (admin only)
 */

// List all orders
router.get('/', authenticate, orderController.listOrders);

// List orders by event
router.get('/event/:eventId', authenticate, orderController.listOrdersByEvent);

// Sync order with Asaas
router.post('/:orderId/sync-asaas', authenticate, orderController.syncOrderWithAsaas);

if (process.env.NODE_ENV === 'development') {
    // Confirm payment manually (testing only — requires admin auth)
    router.post('/:orderId/confirm-payment', authenticate, authorize('admin'), orderController.confirmPaymentManually);

    // Simulate payment confirmation (testing only — requires admin auth)
    router.post('/:orderId/simulate-payment', authenticate, authorize('admin'), orderController.simulatePayment);
}

module.exports = router;
