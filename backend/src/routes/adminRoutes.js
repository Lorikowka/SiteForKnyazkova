const express = require('express');
const adminController = require('../controllers/adminController');
const { requireApiKey } = require('../middleware/auth');
const { cancelLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/webhook', adminController.handleWebhook);
router.post('/database/cleanup', requireApiKey, cancelLimiter, adminController.cleanupDatabase);

module.exports = router;
