/** Административные маршруты: вебхук ЮKassa и очистка базы. */
import { cleanupDatabase, handleWebhook } from '../controllers/adminController.js';
import { requireApiKey } from '../middleware/auth.js';
import { limitOptions } from '../middleware/rateLimit.js';

export default async function adminRoutes(app) {
  app.post('/webhook', handleWebhook);

  app.post('/database/cleanup', {
    preHandler: requireApiKey,
    config: limitOptions(5)
  }, cleanupDatabase);
}
