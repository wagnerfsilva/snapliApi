'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const controller = require('../controllers/video.controller');
const router = express.Router();

router.use(authenticate, authorize('admin', 'fotografo'));
router.post('/uploads', body('eventId').isUUID(), validate, controller.start);
router.param('id', (req, res, next, id) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ success: false, message: 'ID invalido' });
    next();
});
router.put('/uploads/:id/parts/:partNumber', param('partNumber').isInt({ min: 1, max: 63 }), validate,
    express.raw({ type: 'application/octet-stream', limit: '8mb' }), controller.part);
router.post('/uploads/:id/complete', controller.finish);
router.delete('/uploads/:id', controller.cancel);
router.get('/:id/status', controller.status);

module.exports = router;