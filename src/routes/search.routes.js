const express = require('express');
const router = express.Router();
const searchController = require('../controllers/search.controller');
const { uploadSearchPhoto } = require('../middleware/upload');
const { optionalAuth } = require('../middleware/auth');

// Public routes (no authentication required)
router.post('/face', optionalAuth, uploadSearchPhoto, searchController.searchByFace);
router.get('/event/:eventId', optionalAuth, searchController.searchByEvent);
router.get('/statistics', searchController.getStatistics);
router.get('/sales-statistics', searchController.getSalesStatistics);

module.exports = router;
