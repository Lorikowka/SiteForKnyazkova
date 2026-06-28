const express = require('express');
const { body } = require('express-validator');
const sessionController = require('../controllers/sessionController');
const { requireApiKey } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const strictLimiter = rateLimit({ windowMs: 60000, max: 10, message: { success: false, error: 'Слишком много попыток' } });

router.get('/', requireApiKey, sessionController.getSessions);
router.post('/', requireApiKey, [
  body('clientName').isString().trim().notEmpty(),
  body('clientPhone').isString().trim().notEmpty(),
  body('sessionDate').matches(/^\d{4}-\d{2}-\d{2}$/),
  body('sessionTime').matches(/^\d{2}:\d{2}$/),
  body('clientEmail').optional().isString(),
  body('serviceId').optional().isString(),
  body('serviceName').optional().isString(),
  body('sessionDatetime').optional().isString(),
  body('amount').optional().isNumeric(),
  body('comment').optional().isString(),
  handleValidationErrors
], sessionController.createSession);
router.patch('/:id/status', requireApiKey, [body('status').isIn(['scheduled', 'completed', 'cancelled']), handleValidationErrors], sessionController.updateSessionStatus);
router.delete('/:id', requireApiKey, sessionController.cancelSession);

router.post('/:id/confirm-booking', strictLimiter, [
  body('token').isString(),
  body('customerName').isString(),
  body('customerPhone').isString(),
  body('serviceName').isString(),
  body('sessionDate').isString(),
  body('sessionTime').isString(),
  body('sessionDatetime').isString(),
  handleValidationErrors
], sessionController.confirmBooking);

router.post('/cancel-booking', rateLimit({ windowMs: 60000, max: 5 }), [
  body('paymentId').isString(),
  body('token').isString(),
  handleValidationErrors
], sessionController.cancelBookingByClient);

router.get('/reminders/due', requireApiKey, sessionController.getRemindersDue);
router.post('/reminders/:id/mark-sent', requireApiKey, sessionController.markReminderSent);

module.exports = router;
