const config = require('../utils/config');
const logger = require('../utils/logger');
const { createApiKeyAuth } = require('../../lib/security');

const requireApiKey = createApiKeyAuth({
  logger,
  adminKeys: config.app.adminApiKeys,
  botKeys: config.app.botApiKeys
});

module.exports = { requireApiKey };
