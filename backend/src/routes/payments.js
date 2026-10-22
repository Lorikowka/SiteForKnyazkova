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
import { requireApiKey, requireAdminKey, requireNonProduction } from '../middleware/auth.js';
import { limitOptions } from '../middleware/rateLimit.js';
import { bodyValidator } from '../validation.js';
import { createPaymentResponse, paymentListResponse, paymentStatusResponse } from '../schemas/responses.js';

const namePart = z.string().trim().min(1).max(80).regex(/^[\p{L}\p{M}'’ -]+$/u);

const createPaymentSchema = z.object({
  amount: z.union([z.number(), z.string()]).optional(),
  description: z.string().optional(),
  orderId: z.string().optional(),
  customerEmail: z.union([z.literal(''), z.string().email()]).optional(),
  customerName: z.string().trim().min(1).max(240).optional(),
  customerLastName: namePart.optional(),
  customerFirstName: namePart.optional(),
  customerMiddleName: namePart.optional(),
  customerPhone: z.string().trim().min(1),
  serviceId: z.string().optional(),
  serviceName: z.string().optional(),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  sessionDatetime: z.string().optional(),
  comment: z.string().optional()
}).superRefine((value, context) => {
  if (!value.customerName && (!value.customerLastName || !value.customerFirstName)) {
    context.addIssue({ code: 'custom', message: 'Укажите фамилию и имя' });
  }
});

const confirmBookingSchema = z.object({
  token: z.string(),
  customerName: z.string().optional(),
  customerLastName: namePart.optional(),
  customerFirstName: namePart.optional(),
  customerMiddleName: namePart.optional(),
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
    config: limitOptions(10),
    schema: { response: { 200: createPaymentResponse } }
  }, createPayment);

  // Подтверждение записи после успешной оплаты (создаёт сеанс).
  app.post('/:id/confirm-booking', {
    preHandler: bodyValidator(confirmBookingSchema),
    config: limitOptions(10)
  }, confirmBooking);

  app.get('/:id', { schema: { response: { 200: paymentStatusResponse } } }, getPayment);
  app.get('/', { preHandler: requireApiKey, schema: { response: { 200: paymentListResponse } } }, getAllPayments);
  app.delete('/:id', { preHandler: [requireAdminKey, requireNonProduction] }, deletePayment);

  app.post('/:id/discard', {
    preHandler: bodyValidator(tokenSchema),
    config: limitOptions(10)
  }, discardPayment);
}
