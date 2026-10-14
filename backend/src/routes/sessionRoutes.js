const express = require('express');
const { body } = require('express-validator');
const sessionController = require('../controllers/sessionController');
const { requireApiKey } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');
const { cancelLimiter } = require('../middleware/rateLimit');

const router = express.Router();

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

router.post('/cancel-booking', cancelLimiter, [
  body('paymentId').isString(),
  body('token').isString(),
  handleValidationErrors
], sessionController.cancelBookingByClient);

router.get('/reminders/due', requireApiKey, sessionController.getRemindersDue);
router.post('/reminders/:id/mark-sent', requireApiKey, sessionController.markReminderSent);

module.exports = router;
