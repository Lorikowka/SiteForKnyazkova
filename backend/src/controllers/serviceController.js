/**
 * Служебные эндпоинты: каталог услуг, дипломы и health-check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import config from '../config/index.js';
import db from '../db/index.js';
import logger from '../utils/logger.js';

const CONTROLLER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DIPLOMAS_PATH = path.join(CONTROLLER_DIR, '..', '..', 'diplomas.json');

let diplomasCache = null;

function loadDiplomas() {
  if (diplomasCache) return diplomasCache;
  try {
    diplomasCache = fs.existsSync(DIPLOMAS_PATH)
      ? JSON.parse(fs.readFileSync(DIPLOMAS_PATH, 'utf8'))
      : [];
  } catch (error) {
    logger.error(`Не удалось прочитать diplomas.json: ${error.message}`);
    diplomasCache = [];
  }
  return diplomasCache;
}

export async function getServices(request, reply) {
  return reply.send({
    success: true,
    services: config.services,
    schedule: config.schedule
  });
}

export async function getDiplomas(request, reply) {
  return reply.send({ success: true, diplomas: loadDiplomas() });
}

export async function getHealth(request, reply) {
  let database = 'ok';
  try {
    db.get('SELECT 1');
  } catch {
    database = 'error';
  }

  return reply.code(database === 'ok' ? 200 : 503).send({
    status: database === 'ok' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    service: 'psixolog-payment-backend',
    database
  });
}
