const express = require('express');
const { body } = require('express-validator');
const paymentController = require('../controllers/paymentController');
const { requireApiKey } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const strictLimiter = rateLimit({ windowMs: 60000, max: 10, message: { success: false, error: 'Слишком много попыток' } });

router.post('/create-payment', strictLimiter, [
  body('customerEmail').optional({ values: 'falsy' }).isEmail(),
  body('customerName').optional().isString(),
  body('customerPhone').optional().isString(),
  handleValidationErrors
], paymentController.createPayment);

router.get('/:id', paymentController.getPayment);
router.get('/', requireApiKey, paymentController.getAllPayments);
router.delete('/:id', requireApiKey, paymentController.deletePayment);
router.post('/:id/discard', strictLimiter, [body('token').isString(), handleValidationErrors], paymentController.discardPayment);

module.exports = router;
