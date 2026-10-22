/** Fail closed on configurations that would lose payments or expose admin APIs. */
export function validateProductionConfig(env) {
  if (env.NODE_ENV !== 'production') return;
  const problems = [];
  try {
    const url = new URL(env.SITE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
  } catch { problems.push('SITE_URL must be an explicit HTTPS URL'); }
  if (env.MOCK_MODE === 'true') problems.push('MOCK_MODE must be false in production');
  if (!env.YOOKASSA_SHOP_ID || !env.YOOKASSA_SECRET_KEY) problems.push('YooKassa credentials are required');
  const split = value => String(value || '').split(',').map(v => v.trim()).filter(Boolean);
  const admins = split(env.ADMIN_API_KEYS || env.API_KEY);
  const bots = split(env.BOT_API_KEYS || env.BOT_API_KEY);
  if (!admins.length || admins.some(key => key.length < 32)) problems.push('Admin keys must contain at least 32 characters');
  if (bots.some(key => key.length < 32 || admins.includes(key))) problems.push('Bot keys must be long and distinct from admin keys');
  if ((env.TELEGRAM_BOT_TOKEN || env.VK_BOT_TOKEN) && !bots.length) problems.push('Configure a separate BOT_API_KEYS for enabled bots');
  if (env.VERCEL === '1' || env.NOW_REGION) problems.push('This SQLite deployment requires a persistent server, not serverless /tmp');
  if (env.SQLITE_PATH === ':memory:') problems.push('Production requires a persistent SQLite database');
  if (problems.length) throw new Error(`Invalid production configuration: ${problems.join('; ')}`);
}
