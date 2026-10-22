/**
 * ═══════════════════════════════════════════════════════════
 * 🔒 SECURITY CHECK SCRIPT
 * ═══════════════════════════════════════════════════════════
 * Быстрая статическая проверка базовых требований безопасности.
 *
 * Использование:
 *   npm run security:check
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

const log = {
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.cyan}ℹ️  ${msg}${colors.reset}`),
  section: (msg) => console.log(`\n${colors.magenta}${'═'.repeat(60)}\n${msg}\n${'═'.repeat(60)}${colors.reset}`)
};

const results = { passed: [], warnings: [], errors: [] };

const BACKEND_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(BACKEND_DIR, '..');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');

/** Рекурсивно собирает файлы с нужными расширениями. */
function collectFiles(dir, extensions, skipDirs = ['node_modules', '.git', 'data', '__pycache__']) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipDirs.includes(entry.name)) continue;
      found.push(...collectFiles(path.join(dir, entry.name), extensions, skipDirs));
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

function readAll(files) {
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
}

// ═══════════════════════════════════════════════════════════
// 1. .env файлы
// ═══════════════════════════════════════════════════════════
function checkEnvFiles() {
  log.section('🔐 Проверка .env файлов');

  const envFiles = ['.env', '.env.local', '.env.development', '.env.production'];
  for (const dir of [ROOT_DIR, BACKEND_DIR]) {
    for (const file of envFiles) {
      if (fs.existsSync(path.join(dir, file))) {
        const label = path.relative(ROOT_DIR, path.join(dir, file));
        log.warn(`${label} существует — убедитесь, что он не попадает в git`);
        results.warnings.push(`${label} существует`);
      }
    }
  }

  const gitignorePath = path.join(ROOT_DIR, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    log.error('.gitignore не найден!');
    results.errors.push('.gitignore отсутствует');
    return;
  }

  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  for (const entry of ['.env', 'node_modules']) {
    if (gitignore.includes(entry)) {
      log.success(`${entry} защищён через .gitignore`);
      results.passed.push(`${entry} в .gitignore`);
    } else {
      log.error(`${entry} НЕ защищён в .gitignore!`);
      results.errors.push(`${entry} не в .gitignore`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 2. Критические файлы
// ═══════════════════════════════════════════════════════════
function checkRequiredFiles() {
  log.section('🛡️ Обязательные файлы');

  const required = [
    { file: path.join(BACKEND_DIR, 'server.js'), desc: 'Backend-сервер' },
    { file: path.join(BACKEND_DIR, 'src', 'db', 'index.js'), desc: 'Модуль БД' },
    { file: path.join(BACKEND_DIR, 'package.json'), desc: 'Зависимости' },
    { file: path.join(ROOT_DIR, '.env.example'), desc: 'Пример .env' },
    { file: path.join(ROOT_DIR, '.gitignore'), desc: 'Git ignore' }
  ];

  for (const { file, desc } of required) {
    if (fs.existsSync(file)) {
      log.success(`${desc}: ${path.relative(ROOT_DIR, file)} найден`);
      results.passed.push(`${path.relative(ROOT_DIR, file)} существует`);
    } else {
      log.error(`${desc}: ${path.relative(ROOT_DIR, file)} НЕ найден!`);
      results.errors.push(`${path.relative(ROOT_DIR, file)} отсутствует`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 3. Зависимости
// ═══════════════════════════════════════════════════════════
function checkPackageJson() {
  log.section('📦 Анализ package.json');

  const packagePath = path.join(BACKEND_DIR, 'package.json');
  if (!fs.existsSync(packagePath)) {
    log.error('package.json не найден!');
    results.errors.push('package.json отсутствует');
    return;
  }

  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

  const securityPackages = {
    '@fastify/helmet': 'Security headers',
    '@fastify/rate-limit': 'Rate limiting',
    zod: 'Валидация данных',
    dotenv: 'Переменные окружения'
  };

  for (const [pkg, desc] of Object.entries(securityPackages)) {
    if (dependencies[pkg]) {
      log.success(`${desc}: ${pkg}@${dependencies[pkg]}`);
      results.passed.push(`${pkg} установлен`);
    } else {
      log.warn(`${desc}: ${pkg} не установлен`);
      results.warnings.push(`${pkg} не установлен`);
    }
  }

  if (packageJson.engines?.node) {
    log.success(`Node.js версия: ${packageJson.engines.node}`);
    results.passed.push('Node.js engine указан');
  } else {
    log.warn('Node.js engine не указан в package.json');
    results.warnings.push('Node.js engine не указан');
  }
}

// ═══════════════════════════════════════════════════════════
// 4. Безопасность backend
// ═══════════════════════════════════════════════════════════
function checkBackendSecurity() {
  log.section('🔒 Анализ backend-кода');

  const backendFiles = collectFiles(BACKEND_DIR, ['.js'], ['node_modules', 'data', 'test'])
    .filter(file => path.basename(file) !== 'security-check.js');
  const code = readAll(backendFiles);

  const checks = [
    { pattern: /register\(helmet|@fastify\/helmet/, desc: 'Helmet (security headers)' },
    { pattern: /register\(cors|@fastify\/cors/, desc: 'CORS' },
    { pattern: /rateLimit|RateLimit|Limiter/, desc: 'Rate limiting' },
    { pattern: /from ['"]zod['"]|safeParse/, desc: 'Валидация данных' },
    { pattern: /process\.env/, desc: 'Использование переменных окружения' },
    { pattern: /YOOKASSA_SECRET_KEY/, desc: 'Ключ ЮKassa' },
    { pattern: /checkYooKassaPayment/, desc: 'Проверка платежа через API провайдера' },
    { pattern: /sanitizeInput|sanitize/, desc: 'Санитизация данных' },
    { pattern: /contentSecurityPolicy|frameSrc|X-Frame-Options/, desc: 'Защита от clickjacking' }
  ];

  for (const { pattern, desc } of checks) {
    if (pattern.test(code)) {
      log.success(`${desc}: реализовано`);
      results.passed.push(desc);
    } else {
      log.warn(`${desc}: НЕ найдено`);
      results.warnings.push(desc);
    }
  }

  const dangerous = [
    { pattern: /eval\s*\(/, desc: 'eval()' },
    { pattern: /new\s+Function\s*\(/, desc: 'new Function()' },
    { pattern: /child_process\.exec\s*\([^)]*\+/, desc: 'опасный child_process.exec' }
  ];

  for (const { pattern, desc } of dangerous) {
    if (pattern.test(code)) {
      log.error(`Обнаружено опасное использование: ${desc}`);
      results.errors.push(`Опасный код: ${desc}`);
    } else {
      log.success(`Опасный паттерн не найден: ${desc}`);
      results.passed.push(`${desc} не используется`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 5. Безопасность frontend
// ═══════════════════════════════════════════════════════════
function checkFrontendSecurity() {
  log.section('🌐 Анализ frontend');

  const indexHtmlPath = path.join(FRONTEND_DIR, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    log.warn('index.html не найден (пропускаем проверку)');
    return;
  }

  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  const htmlChecks = [
    { pattern: /Content-Security-Policy/i, desc: 'Content-Security-Policy' },
    { pattern: /Referrer-Policy|name=["']referrer["']/i, desc: 'Referrer-Policy' }
  ];

  for (const { pattern, desc } of htmlChecks) {
    if (pattern.test(indexHtml)) {
      log.success(`${desc}: установлен`);
      results.passed.push(`${desc} установлен`);
    } else {
      log.warn(`${desc}: НЕ установлен`);
      results.warnings.push(`${desc} не установлен`);
    }
  }

  // X-Content-Type-Options не работает как <meta>-тег — это только заголовок
  // ответа, поэтому проверяем его там, где он реально задаётся: в nginx.
  const nginxPath = path.join(FRONTEND_DIR, 'nginx.conf');
  const nginxConf = fs.existsSync(nginxPath) ? fs.readFileSync(nginxPath, 'utf8') : '';
  if (/X-Content-Type-Options/i.test(nginxConf)) {
    log.success('X-Content-Type-Options: заголовок задан в nginx.conf');
    results.passed.push('X-Content-Type-Options (заголовок nginx)');
  } else {
    log.warn('X-Content-Type-Options: НЕ найден в nginx.conf');
    results.warnings.push('X-Content-Type-Options не установлен');
  }

  // Инлайн-скрипты нежелательны (CSP script-src 'self').
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(indexHtml)) {
    log.warn('Обнаружен инлайн-<script> в index.html');
    results.warnings.push('инлайн-скрипт в index.html');
  } else {
    log.success('Инлайн-скрипты отсутствуют');
    results.passed.push('нет инлайн-скриптов');
  }

  // Анализ JS-файлов frontend.
  const jsFiles = collectFiles(path.join(FRONTEND_DIR, 'js'), ['.js']);
  const jsCode = readAll(jsFiles);

  if (/sanitize/i.test(jsCode)) {
    log.success('Санитизация данных: реализовано');
    results.passed.push('frontend санитизация');
  } else {
    log.warn('Санитизация данных: НЕ найдено');
    results.warnings.push('frontend санитизация не найдена');
  }

  if (/document\.write\s*\(/i.test(jsCode)) {
    log.error('Обнаружено: document.write() — опасно!');
    results.errors.push('document.write() используется');
  } else {
    log.success('Опасный паттерн не найден: document.write()');
    results.passed.push('document.write() не используется');
  }

  if (/eval\s*\(/.test(jsCode)) {
    log.error('Обнаружено: eval() во frontend');
    results.errors.push('eval() во frontend');
  }

  // Внешние ссылки должны открываться с rel="noopener" (проверяем HTML-страницы).
  const htmlFiles = collectFiles(FRONTEND_DIR, ['.html']);
  const htmlCode = readAll(htmlFiles);
  const externalBlankLinks = htmlCode.match(/target\s*=\s*["']_blank["'][^>]*>/gi) || [];
  const unsafeBlankLinks = externalBlankLinks.filter(tag => !/rel\s*=\s*["'][^"']*noopener/i.test(tag));
  if (unsafeBlankLinks.length === 0) {
    log.success('Внешние ссылки: rel="noopener" указан');
    results.passed.push('безопасные внешние ссылки');
  } else {
    log.warn(`Внешние ссылки: ${unsafeBlankLinks.length} без rel="noopener"`);
    results.warnings.push('внешние ссылки без rel="noopener"');
  }
}

// ═══════════════════════════════════════════════════════════
// 6. Права доступа к файлам (только Unix)
// ═══════════════════════════════════════════════════════════
function checkFilePermissions() {
  log.section('🔑 Права доступа к файлам');

  if (process.platform === 'win32') {
    log.info('Проверка прав доступа недоступна на Windows');
    return;
  }

  for (const file of ['.env', '.env.production']) {
    const filePath = path.join(ROOT_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    const mode = fs.statSync(filePath).mode.toString(8);
    if (mode.endsWith('777') || mode.endsWith('666')) {
      log.error(`${file}: слишком открытые права (${mode})`);
      results.errors.push(`${file}: права ${mode}`);
    } else {
      log.success(`${file}: права доступа в порядке (${mode})`);
      results.passed.push(`${file}: права ${mode}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// ИТОГИ
// ═══════════════════════════════════════════════════════════
function printResults() {
  log.section('📊 ИТОГОВЫЙ ОТЧЁТ');

  console.log(`\n${colors.green}✅ Пройдено: ${results.passed.length}${colors.reset}`);
  console.log(`${colors.yellow}⚠️  Предупреждения: ${results.warnings.length}${colors.reset}`);
  console.log(`${colors.red}❌ Ошибки: ${results.errors.length}${colors.reset}\n`);

  if (results.errors.length > 0) {
    console.log(`${colors.red}ОШИБКИ:${colors.reset}`);
    results.errors.forEach(err => console.log(`  - ${err}`));
  }
  if (results.warnings.length > 0) {
    console.log(`\n${colors.yellow}ПРЕДУПРЕЖДЕНИЯ:${colors.reset}`);
    results.warnings.forEach(warn => console.log(`  - ${warn}`));
  }

  console.log('\n' + '═'.repeat(60));
  if (results.errors.length === 0) {
    console.log(`${colors.green}🎉 БЕЗОПАСНОСТЬ В ПОРЯДКЕ!${colors.reset}`);
    console.log('Критические проверки пройдены успешно.');
  } else {
    console.log(`${colors.red}🚨 ТРЕБУЕТСЯ ВНИМАНИЕ!${colors.reset}`);
    console.log(`Найдено ${results.errors.length} ошибок безопасности.`);
  }
  console.log('═'.repeat(60) + '\n');
}

console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║     🔒 SECURITY CHECK — проверка безопасности проекта     ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);

checkEnvFiles();
checkRequiredFiles();
checkPackageJson();
checkBackendSecurity();
checkFrontendSecurity();
checkFilePermissions();
printResults();

process.exit(results.errors.length > 0 ? 1 : 0);
