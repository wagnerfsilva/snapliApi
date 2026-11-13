const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const validate = require('../middleware/validate');

/**
 * PUBLIC ROUTES
 */

// Create new order
router.post('/', orderController.createOrder);

router.post('/courtesy', authenticate, authorize('admin'), [
    body('customerEmail').optional({ nullable: true }).isString().bail()
        .trim().if(body('customerEmail').notEmpty())
        .isEmail().isLength({ max: 255 }).withMessage('Email invalido'),
    body('items').isArray({ min: 1, max: 1000 }).withMessage('Selecione entre 1 e 1000 arquivos'),
    body('items.*.photoId').isUUID().withMessage('Identificador de arquivo invalido')
], validate, orderController.createCourtesyOrder);

// Get order by ID (public for now, can add auth later)
router.get('/:orderId', orderController.getOrder);

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
