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
    res.json({
        success: true,
        message: 'API is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV
    });
});

// Temporary debug: test login flow
router.get('/debug-login', async (req, res) => {
    try {
        const { User } = require('../models');
        const bcrypt = require('bcryptjs');
        const steps = {};

        steps.bcryptjs_loaded = typeof bcrypt.compare === 'function';
        steps.user_model = typeof User === 'function';

        const user = await User.findOne({ where: { email: 'fotografo@gmail.com' } });
        steps.user_found = !!user;

        if (user) {
            steps.has_validatePassword = typeof user.validatePassword === 'function';
            steps.password_hash_prefix = user.password ? user.password.substring(0, 7) : 'null';

            const isValid = await user.validatePassword('%65434343');
            steps.password_valid = isValid;
        }

        res.json({ success: true, steps });
    } catch (err) {
        res.json({ success: false, error: err.message, name: err.name, stack: err.stack });
    }
});

// Mount routes
router.use('/auth', authRoutes);
router.use('/events', eventRoutes);
router.use('/photos', photoRoutes);
router.use('/search', searchRoutes);
router.use('/orders', orderRoutes);
router.use('/downloads', downloadRoutes);

module.exports = router;
