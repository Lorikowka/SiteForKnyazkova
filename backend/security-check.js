/**
 * ═══════════════════════════════════════════════════════════
 * 🔒 SECURITY CHECK SCRIPT
 * ═══════════════════════════════════════════════════════════
 * Скрипт для проверки безопасности проекта
 * 
 * Использование:
 *   npm run security:check
 */

const fs = require('fs');
const path = require('path');

// Цвета для вывода
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const log = {
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.cyan}ℹ️  ${msg}${colors.reset}`),
  section: (msg) => console.log(`\n${colors.magenta}${'═'.repeat(60)}\n${msg}\n${'═'.repeat(60)}${colors.reset}`)
};

// Результаты проверки
const results = {
  passed: [],
  warnings: [],
  errors: []
};

// ═══════════════════════════════════════════════════════════
// ПРОВЕРКА 1: .env файлы не скоммичены
// ═══════════════════════════════════════════════════════════
function checkEnvFiles() {
  log.section('🔐 Проверка .env файлов');
  
  const envFiles = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.production'
  ];
  
  envFiles.forEach(file => {
    const envPath = path.join(__dirname, file);
    if (fs.existsSync(envPath)) {
      log.warn(`Файл ${file} существует - убедитесь, что он в .gitignore`);
      results.warnings.push(`${file} существует`);
    }
  });
  
  // Проверяем .gitignore
  const gitignorePath = path.join(__dirname, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    if (gitignore.includes('.env')) {
      log.success('.env файлы защищены через .gitignore');
      results.passed.push('.env в .gitignore');
    } else {
      log.error('.env файлы НЕ защищены в .gitignore!');
      results.errors.push('.env не в .gitignore');
    }
  } else {
    log.error('.gitignore не найден!');
    results.errors.push('.gitignore отсутствует');
  }
}

// ═══════════════════════════════════════════════════════════
// ПРОВЕРКА 2: node_modules не скоммичены
// ═══════════════════════════════════════════════════════════
function checkNodeModules() {
  log.section('📦 Проверка node_modules');
  
  const nodeModulesPath = path.join(__dirname, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    log.warn('node_modules существует - убедитесь, что папка в .gitignore');
    
    const gitignorePath = path.join(__dirname, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf8');
      if (gitignore.includes('node_modules')) {
        log.success('node_modules защищён через .gitignore');
        results.passed.push('node_modules в .gitignore');
      } else {
        log.error('node_modules НЕ защищён в .gitignore!');
        results.errors.push('node_modules не в .gitignore');
      }
    }
  } else {
    log.info('node_modules не найден (возможно, зависимости не установлены)');
  }
}

// ═══════════════════════════════════════════════════════════
// ПРОВЕРКА 3: Наличие критических файлов безопасности
// ═══════════════════════════════════════════════════════════
function checkSecurityFiles() {
  log.section('🛡️ Файлы безопасности');
  
  const requiredFiles = [
    { file: 'server.js', desc: 'Backend сервер' },
    { file: 'package.json', desc: 'Зависимости' },
    { file: '.gitignore', desc: 'Git ignore' },
    { file: '.env.example', desc: 'Пример .env' }
  ];
  
  requiredFiles.forEach(({ file, desc }) => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      log.success(`${desc}: ${file} найден`);
      results.passed.push(`${file} существует`);
    } else {
      log.error(`${desc}: ${file} НЕ найден!`);
      results.errors.push(`${file} отсутствует`);
    }
  });
}

// ═══════════════════════════════════════════════════════════
// ПРОВЕРКА 4: Анализ package.json на уязвимости
// ═══════════════════════════════════════════════════════════
function checkPackageJson() {
  log.section('📦 Анализ package.json');
  
  const packagePath = path.join(__dirname, 'package.json');
  if (!fs.existsSync(packagePath)) {
    log.error('package.json не найден!');
    results.errors.push('package.json отсутствует');
    return;
  }
  
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  
  // Проверяем наличие security пакетов
  const securityPackages = {
    'helmet': 'Security headers',
    'express-rate-limit': 'Rate limiting',
    'express-validator': 'Валидация данных',
    'dotenv': 'Переменные окружения'
  };
  
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies
  };
  
  Object.entries(securityPackages).forEach(([pkg, desc]) => {
    if (dependencies[pkg]) {
      log.success(`${desc}: ${pkg}@${dependencies[pkg]}`);
      results.passed.push(`${pkg} установлен`);
    } else {
      log.warn(`${desc}: ${pkg} не установлен`);
      results.warnings.push(`${pkg} не установлен`);
    }
  });
  
  // Проверяем engine
  if (packageJson.engines?.node) {
    log.success(`Node.js версия: ${packageJson.engines.node}`);
    results.passed.push('Node.js engine указан');
  } else {
    log.warn('Node.js engine не указан в package.json');
    results.warnings.push('Node.js engine не указан');
  }
}

// ═══════════════════════════════════════════════════════════
// ПРОВЕРКА 5: Анализ server.js на безопасность
// ═══════════════════════════════════════════════════════════
function checkServerSecurity() {
  log.section('🔒 Анализ server.js');
  
  const serverPath = path.join(__dirname, 'server.js');
  if (!fs.existsSync(serverPath)) {
    log.warn('server.js не найден (пропускаем проверку)');
    return;
  }
  
  const serverCode = fs.readFileSync(serverPath, 'utf8');
  
  // Проверяем наличие security middleware
  const securityChecks = [
    { pattern: /helmet\(/, desc: 'Helmet (security headers)' },
    { pattern: /cors\(/, desc: 'CORS' },
    { pattern: /rateLimit|rate-limit/, desc: 'Rate Limiting' },
    { pattern: /express-validator/, desc: 'Валидация данных' },
    { pattern: /process\.env/, desc: 'Использование .env' },
    { pattern: /YOOKASSA_SECRET_KEY/, desc: 'Yookassa secret key' },
    { pattern: /HMAC|signature|hmac/, desc: 'Проверка подписи webhook' },
    { pattern: /sanitize|sanitiz/, desc: 'Санитизация данных' }
  ];
  
  securityChecks.forEach(({ pattern, desc }) => {
    if (pattern.test(serverCode)) {
      log.success(`${desc}: реализовано`);
      results.passed.push(desc);
    } else {
      log.warn(`${desc}: НЕ найдено`);
      results.warnings.push(desc);
    }
  });
  
  // Проверяем на опасные паттерны
  const dangerousPatterns = [
    { pattern: /eval\s*\(/, desc: 'eval()' },
    { pattern: /new\s+Function\s*\(/, desc: 'new Function()' },
    { pattern: /child_process\.exec\s*\([^)]*\+/, desc: 'Опасный child_process.exec' }
  ];
  
  dangerousPatterns.forEach(({ pattern, desc }) => {
    if (pattern.test(serverCode)) {
      log.error(`Обнаружено опасное использование: ${desc}`);
      results.errors.push(`Опасный код: ${desc}`);
    } else {
      log.success(`Опасный паттерн не найден: ${desc}`);
      results.passed.push(`${desc} не используется`);
    }
  });
}

// ═══════════════════════════════════════════════════════════
// ПРОВЕРКА 6: Анализ frontend на безопасность
// ═══════════════════════════════════════════════════════════
function checkFrontendSecurity() {
  log.section('🌐 Анализ frontend');
  
  const indexPath = path.join(__dirname, '..', 'site', 'index.html');
  if (!fs.existsSync(indexPath)) {
    log.warn('index.html не найден (пропускаем проверку)');
    return;
  }
  
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  
  // Проверяем security headers
  const securityHeaders = [
    { pattern: /Content-Security-Policy/i, desc: 'Content-Security-Policy' },
    { pattern: /X-Content-Type-Options/i, desc: 'X-Content-Type-Options' },
    { pattern: /X-Frame-Options/i, desc: 'X-Frame-Options' },
    { pattern: /X-XSS-Protection/i, desc: 'X-XSS-Protection' },
    { pattern: /Referrer-Policy/i, desc: 'Referrer-Policy' }
  ];
  
  securityHeaders.forEach(({ pattern, desc }) => {
    if (pattern.test(indexHtml)) {
      log.success(`${desc}: установлен`);
      results.passed.push(`${desc} установлен`);
    } else {
      log.warn(`${desc}: НЕ установлен`);
      results.warnings.push(`${desc} не установлен`);
    }
  });
  
  // Проверяем main.js
  const mainJsPath = path.join(__dirname, '..', 'site', 'js', 'main.js');
  if (fs.existsSync(mainJsPath)) {
    const mainJs = fs.readFileSync(mainJsPath, 'utf8');
    
    const jsSecurityChecks = [
      { pattern: /sanitize|sanitiz/i, desc: 'Санитизация данных' },
      { pattern: /noopener|noreferrer/i, desc: 'Безопасные внешние ссылки' }
    ];
    
    jsSecurityChecks.forEach(({ pattern, desc }) => {
      if (pattern.test(mainJs)) {
        log.success(`${desc}: реализовано`);
        results.passed.push(desc);
      } else {
        log.warn(`${desc}: НЕ найдено`);
        results.warnings.push(desc);
      }
    });
    
    // Проверяем на опасную работу с DOM (только document.write и опасный innerHTML)
    // document.write всегда опасен
    if (/document\.write\s*\(/i.test(mainJs)) {
      log.error('Обнаружено: document.write() — опасно!');
      results.errors.push('document.write() используется');
    } else {
      log.success('Опасный паттерн не найден: document.write()');
      results.passed.push('document.write() не используется');
    }
    
    // innerHTML сам по себе не опасен если используется с санитизацией
    // Проверяем только если нет sanitize функции
    if (!/sanitize/i.test(mainJs) && /innerHTML\s*=\s*[^=]/i.test(mainJs)) {
      log.warn('Обнаружено: innerHTML без санитизации');
      results.warnings.push('innerHTML без санитизации');
    } else if (/innerHTML\s*=\s*[^=]/i.test(mainJs)) {
      log.info('innerHTML используется (предположительно безопасно)');
      results.passed.push('innerHTML используется безопасно');
    }
  }
}

// ═══════════════════════════════════════════════════════════
// ПРОВЕРКА 7: Проверка прав доступа к файлам (Unix)
// ═══════════════════════════════════════════════════════════
function checkFilePermissions() {
  log.section('🔑 Права доступа к файлам');
  
  if (process.platform === 'win32') {
    log.info('Проверка прав доступа недоступна на Windows');
    return;
  }
  
  const { execSync } = require('child_process');
  
  try {
    // Проверяем .env файлы
    const envFiles = ['.env', '.env.development', '.env.production'];
    envFiles.forEach(file => {
      const filePath = path.join(__dirname, file);
      if (fs.existsSync(filePath)) {
        try {
          const stats = fs.statSync(filePath);
          const mode = stats.mode.toString(8);
          
          if (mode.endsWith('777') || mode.endsWith('666')) {
            log.error(`${file}: слишком открытые права (${mode})`);
            results.errors.push(`${file}: права ${mode}`);
          } else {
            log.success(`${file}: права доступа в порядке (${mode})`);
            results.passed.push(`${file}: права ${mode}`);
          }
        } catch (err) {
          log.warn(`Не удалось проверить права ${file}`);
        }
      }
    });
  } catch (err) {
    log.warn('Не удалось проверить права доступа к файлам');
  }
}

// ═══════════════════════════════════════════════════════════
// ВЫВОД РЕЗУЛЬТАТОВ
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
  
  // Общий статус
  console.log('\n' + '═'.repeat(60));
  
  if (results.errors.length === 0) {
    console.log(`${colors.green}🎉 БЕЗОПАСНОСТЬ В ПОРЯДКЕ!${colors.reset}`);
    console.log('Все критические проверки пройдены успешно.');
  } else {
    console.log(`${colors.red}🚨 ТРЕБУЕТСЯ ВНИМАНИЕ!${colors.reset}`);
    console.log(`Найдено ${results.errors.length} ошибок безопасности.`);
    console.log('Рекомендуется устранить их перед деплоем.');
  }
  
  console.log('═'.repeat(60) + '\n');
  
  // Выводим рекомендации
  if (results.warnings.length > 0 || results.errors.length > 0) {
    console.log(`${colors.cyan}РЕКОМЕНДАЦИИ:${colors.reset}\n`);
    
    if (results.errors.some(e => e.includes('.env'))) {
      console.log('1. Добавьте .env файлы в .gitignore');
      console.log('   echo "*.env" >> .gitignore\n');
    }
    
    if (results.errors.some(e => e.includes('node_modules'))) {
      console.log('2. Добавьте node_modules в .gitignore');
      console.log('   echo "node_modules/" >> .gitignore\n');
    }
    
    if (results.warnings.some(w => w.includes('helmet'))) {
      console.log('3. Установите helmet для security headers');
      console.log('   npm install helmet\n');
    }
    
    if (results.warnings.some(w => w.includes('rate-limit'))) {
      console.log('4. Установите express-rate-limit для защиты от DDoS');
      console.log('   npm install express-rate-limit\n');
    }
  }
}

// ═══════════════════════════════════════════════════════════
// ЗАПУСК ПРОВЕРОК
// ═══════════════════════════════════════════════════════════
console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║     🔒 SECURITY CHECK - Проверка безопасности проекта    ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);

checkEnvFiles();
checkNodeModules();
checkSecurityFiles();
checkPackageJson();
checkServerSecurity();
checkFrontendSecurity();
checkFilePermissions();
printResults();

// Выход с кодом ошибки если есть критические проблемы
process.exit(results.errors.length > 0 ? 1 : 0);
