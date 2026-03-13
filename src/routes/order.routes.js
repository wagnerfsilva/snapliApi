const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { authenticate } = require('../middleware/auth');

/**
 * PUBLIC ROUTES
 */

// Create new order
router.post('/', orderController.createOrder);

// Get order by ID (public for now, can add auth later)
router.get('/:orderId', orderController.getOrder);

// Validate payment status
router.get('/:orderId/validate-payment', orderController.validatePayment);

// Asaas webhook
router.post('/webhook/asaas', orderController.asaasWebhook);

/**
 * PROTECTED ROUTES (admin only)
 */

// List all orders
router.get('/', authenticate, orderController.listOrders);

/**
 * DEV MODE ONLY
 */

// Confirm payment manually (testing)
router.post('/:orderId/confirm-payment', orderController.confirmPaymentManually);

// Simulate payment confirmation (bypass for testing)
router.post('/:orderId/simulate-payment', orderController.simulatePayment);

module.exports = router;
