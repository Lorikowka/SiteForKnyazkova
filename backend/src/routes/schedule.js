/** Маршруты расписания. */
import { blockDate, getSchedule, listBlockedDates, unblockDate } from '../controllers/scheduleController.js';
import { requireApiKey } from '../middleware/auth.js';

export default async function scheduleRoutes(app) {
  app.get('/', getSchedule);

  app.get('/admin/blocks', { preHandler: requireApiKey }, listBlockedDates);
  app.post('/admin/block', { preHandler: requireApiKey }, blockDate);
  app.delete('/admin/block/:date', { preHandler: requireApiKey }, unblockDate);
}
