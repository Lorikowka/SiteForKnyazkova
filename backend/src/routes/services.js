/** Служебные маршруты: каталог услуг, дипломы, health. */
import { getDiplomas, getHealth, getServices } from '../controllers/serviceController.js';
import { healthResponse } from '../schemas/responses.js';

export default async function serviceRoutes(app) {
  app.get('/services', getServices);
  app.get('/diplomas', getDiplomas);
  app.get('/health', { schema: { response: { 200: healthResponse, 503: healthResponse } } }, getHealth);
}
