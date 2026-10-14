/** Маршруты платежей. */
import { z } from 'zod';

import {
  createPayment,
  deletePayment,
  discardPayment,
  getAllPayments,
  getPayment
} from '../controllers/paymentController.js';
import { confirmBooking } from '../controllers/sessionController.js';
import { requireApiKey } from '../middleware/auth.js';
import { limitOptions } from '../middleware/rateLimit.js';
import { bodyValidator } from '../validation.js';

const createPaymentSchema = z.object({
  amount: z.union([z.number(), z.string()]).optional(),
  description: z.string().optional(),
  orderId: z.string().optional(),
  customerEmail: z.union([z.literal(''), z.string().email()]).optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  serviceId: z.string().optional(),
  serviceName: z.string().optional(),
  sessionDate: z.string().optional(),
  sessionTime: z.string().optional(),
  sessionDatetime: z.string().optional(),
  comment: z.string().optional()
});

const confirmBookingSchema = z.object({
  token: z.string(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  customerEmail: z.string().optional(),
  serviceId: z.string().optional(),
  serviceName: z.string().optional(),
  sessionDate: z.string().optional(),
  sessionTime: z.string().optional(),
  sessionDatetime: z.string().optional(),
  comment: z.string().optional()
});

const tokenSchema = z.object({ token: z.string() });

export default async function paymentRoutes(app) {
  app.post('/create-payment', {
    preHandler: bodyValidator(createPaymentSchema),
    config: limitOptions(10)
  }, createPayment);

  // Подтверждение записи после успешной оплаты (создаёт сеанс).
  app.post('/:id/confirm-booking', {
    preHandler: bodyValidator(confirmBookingSchema),
    config: limitOptions(10)
  }, confirmBooking);

  app.get('/:id', getPayment);
  app.get('/', { preHandler: requireApiKey }, getAllPayments);
  app.delete('/:id', { preHandler: requireApiKey }, deletePayment);

  app.post('/:id/discard', {
    preHandler: bodyValidator(tokenSchema),
    config: limitOptions(10)
  }, discardPayment);
}
