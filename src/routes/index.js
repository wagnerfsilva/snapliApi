const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth.routes');
const eventRoutes = require('./event.routes');
const photoRoutes = require('./photo.routes');
const searchRoutes = require('./search.routes');
const downloadRoutes = require('./download.routes');
const orderRoutes = require('./order.routes');
const userRoutes = require('./user.routes');
const withdrawalRoutes = require('./withdrawal.routes');
const videoRoutes = require('./video.routes');

// Health check
router.get('/health', (req, res) => {
    const asaasKey = process.env.ASAAS_API_KEY;
    res.json({
        success: true,
        message: 'API is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        revision: process.env.RAILWAY_GIT_COMMIT_SHA || null,
        video: { ready: require('../services/video-worker.service').isReady(), maxBytes: 500 * 1024 * 1024, maxSeconds: 120 },
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
router.use('/videos', videoRoutes);
router.use('/search', searchRoutes);
router.use('/orders', orderRoutes);
router.use('/downloads', downloadRoutes);
router.use('/users', userRoutes);
router.use('/withdrawals', withdrawalRoutes);

module.exports = router;
