const express = require('express');
const serviceController = require('../controllers/serviceController');

const router = express.Router();

router.get('/services', serviceController.getServices);
router.get('/diplomas', serviceController.getDiplomas);
router.get('/health', serviceController.getHealth);

module.exports = router;
