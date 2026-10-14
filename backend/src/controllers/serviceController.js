const path = require('path');
const fs = require('fs');
const db = require('../../database');
const config = require('../utils/config');
const logger = require('../utils/logger');

const DIPLOMAS_PATH = path.join(__dirname, '..', '..', 'diplomas.json');
const { version: APP_VERSION } = require('../../package.json');

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

const getServices = (req, res) => {
  res.json({
    success: true,
    services: config.services,
    schedule: config.schedule
  });
};

const getDiplomas = (req, res) => {
  res.json({ success: true, diplomas: loadDiplomas() });
};

const getHealth = async (req, res) => {
  let database = 'ok';
  try {
    await db.get('SELECT 1');
  } catch {
    database = 'error';
  }

  res.status(database === 'ok' ? 200 : 503).json({
    status: database === 'ok' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    service: 'psixolog-payment-backend',
    version: APP_VERSION,
    environment: config.app.nodeEnv,
    payment_mode: config.app.mockMode ? 'MOCK' : 'YooKassa',
    database
  });
};

module.exports = { getServices, getHealth, getDiplomas };
