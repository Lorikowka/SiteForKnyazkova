const db = require('../../database');
const config = require('../utils/config');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

const getServices = (req, res) => {
  res.json({ 
    success: true, 
    services: config.services, 
    schedule: config.schedule 
  });
};

const getDiplomas = (req, res) => {
  try {
    const diplomasPath = path.join(__dirname, '..', '..', 'diplomas.json');
    if (fs.existsSync(diplomasPath)) {
      const diplomas = JSON.parse(fs.readFileSync(diplomasPath, 'utf8'));
      res.json({ success: true, diplomas });
    } else {
      res.json({ success: true, diplomas: [] });
    }
  } catch (error) {
    logger.error(`Get diplomas error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Не удалось загрузить список дипломов' });
  }
};

const getHealth = (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'psixolog-payment-backend',
    version: '1.0.0',
    environment: config.app.nodeEnv,
    payment_mode: config.app.mockMode ? 'MOCK' : 'YooKassa',
    port: config.app.port
  });
};

module.exports = { getServices, getHealth, getDiplomas };
