const express = require('express');
const adminController = require('../controllers/adminController');
const { requireApiKey } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();

router.post('/webhook', adminController.handleWebhook);
router.post('/database/cleanup', requireApiKey, rateLimit({ windowMs: 60000, max: 5 }), adminController.cleanupDatabase);

module.exports = router;
