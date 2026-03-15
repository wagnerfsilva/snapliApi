const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth.routes');
const eventRoutes = require('./event.routes');
const photoRoutes = require('./photo.routes');
const searchRoutes = require('./search.routes');
const downloadRoutes = require('./download.routes');
const orderRoutes = require('./order.routes');

// Health check
router.get('/health', (req, res) => {
    const asaasKey = process.env.ASAAS_API_KEY;
    res.json({
        success: true,
        message: 'API is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        asaas: {
            configured: !!asaasKey,
            environment: process.env.ASAAS_ENVIRONMENT || 'NOT SET'
        }
    });
});

// Mount routes
router.use('/auth', authRoutes);
router.use('/events', eventRoutes);
router.use('/photos', photoRoutes);
router.use('/search', searchRoutes);
router.use('/orders', orderRoutes);
router.use('/downloads', downloadRoutes);

module.exports = router;
