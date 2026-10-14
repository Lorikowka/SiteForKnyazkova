/** Служебные маршруты: каталог услуг, дипломы, health. */
import { getDiplomas, getHealth, getServices } from '../controllers/serviceController.js';

export default async function serviceRoutes(app) {
  app.get('/services', getServices);
  app.get('/diplomas', getDiplomas);
  app.get('/health', getHealth);
}
