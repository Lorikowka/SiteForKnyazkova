const express = require('express');
const { body } = require('express-validator');
const paymentController = require('../controllers/paymentController');
const sessionController = require('../controllers/sessionController');
const { requireApiKey } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');
const { strictLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/create-payment', strictLimiter, [
  body('customerEmail').optional({ values: 'falsy' }).isEmail(),
  body('customerName').optional().isString(),
  body('customerPhone').optional().isString(),
  body('serviceName').optional().isString(),
  body('sessionDate').optional().isString(),
  body('sessionTime').optional().isString(),
  handleValidationErrors
], paymentController.createPayment);

// Подтверждение записи после успешной оплаты (создаёт сеанс).
// Данные записи необязательны в теле: если их нет, они берутся из метаданных платежа.
router.post('/:id/confirm-booking', strictLimiter, [
  body('token').isString(),
  handleValidationErrors
], sessionController.confirmBooking);

router.get('/:id', paymentController.getPayment);
router.get('/', requireApiKey, paymentController.getAllPayments);
router.delete('/:id', requireApiKey, paymentController.deletePayment);
router.post('/:id/discard', strictLimiter, [body('token').isString(), handleValidationErrors], paymentController.discardPayment);

module.exports = router;
