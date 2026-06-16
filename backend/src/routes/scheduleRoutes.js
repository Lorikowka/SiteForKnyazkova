const express = require('express');
const scheduleController = require('../controllers/scheduleController');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

router.get('/', scheduleController.getSchedule);
router.post('/admin/block', requireApiKey, scheduleController.blockDate);
router.delete('/admin/block/:date', requireApiKey, scheduleController.unblockDate);

module.exports = router;
