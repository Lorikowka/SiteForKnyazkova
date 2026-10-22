/** Административные маршруты: вебхук ЮKassa и очистка базы. */
import { cleanupDatabase, handleWebhook } from '../controllers/adminController.js';
import { requireAdminKey, requireNonProduction } from '../middleware/auth.js';
import { limitOptions } from '../middleware/rateLimit.js';
import { getOperations } from '../controllers/operationsController.js';

export default async function adminRoutes(app) {
  app.post('/webhook', handleWebhook);
  app.get('/operations', { preHandler: requireAdminKey }, getOperations);

  app.post('/database/cleanup', {
    preHandler: [requireAdminKey, requireNonProduction],
    config: limitOptions(5)
  }, cleanupDatabase);
}
