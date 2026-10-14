/** Маршруты записей на сеансы. */
import { z } from 'zod';

import {
  cancelBookingByClient,
  cancelSession,
  createSession,
  getRemindersDue,
  getSessions,
  markReminderSent,
  updateSessionStatus
} from '../controllers/sessionController.js';
import { requireApiKey } from '../middleware/auth.js';
import { limitOptions } from '../middleware/rateLimit.js';
import { bodyValidator } from '../validation.js';

const createSessionSchema = z.object({
  clientName: z.string().trim().min(1),
  clientPhone: z.string().trim().min(1),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionTime: z.string().regex(/^\d{2}:\d{2}$/),
  clientEmail: z.string().optional(),
  serviceId: z.string().optional(),
  serviceName: z.string().optional(),
  sessionDatetime: z.string().optional(),
  amount: z.coerce.number().optional(),
  comment: z.string().optional()
});

const statusSchema = z.object({
  status: z.enum(['scheduled', 'completed', 'cancelled'])
});

const cancelBookingSchema = z.object({
  paymentId: z.string(),
  token: z.string(),
  reason: z.string().optional()
});

export default async function sessionRoutes(app) {
  app.get('/', { preHandler: requireApiKey }, getSessions);

  app.post('/', {
    preHandler: [requireApiKey, bodyValidator(createSessionSchema)]
  }, createSession);

  app.patch('/:id/status', {
    preHandler: [requireApiKey, bodyValidator(statusSchema)]
  }, updateSessionStatus);

  app.delete('/:id', { preHandler: requireApiKey }, cancelSession);

  app.post('/cancel-booking', {
    preHandler: bodyValidator(cancelBookingSchema),
    config: limitOptions(5)
  }, cancelBookingByClient);

  app.get('/reminders/due', { preHandler: requireApiKey }, getRemindersDue);
  app.post('/reminders/:id/mark-sent', { preHandler: requireApiKey }, markReminderSent);
}
