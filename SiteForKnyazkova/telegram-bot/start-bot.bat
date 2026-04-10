@echo off
echo ═══════════════════════════════════════════════════════════
echo    🚀 Запуск Telegram бота
echo ═══════════════════════════════════════════════════════════
echo.

REM Проверка Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python не найден! Установите Python 3.8+
    echo https://www.python.org/downloads/
    pause
    exit /b 1
)

echo ✅ Python найден

REM Проверка .env файла
if not exist .env (
    echo.
    echo ⚠️ Файл .env не найден!
    echo.
    echo 1. Скопируйте .env.example в .env
    echo 2. Отредактируйте .env и укажите:
    echo    - TELEGRAM_BOT_TOKEN (от @BotFather)
    echo    - TELEGRAM_ADMIN_ID (ваш ID от @userinfobot)
    echo.
    pause
    exit /b 1
)

REM Установка зависимостей
echo.
echo 📦 Установка зависимостей...
pip install -r requirements.txt -q

echo.
echo ═══════════════════════════════════════════════════════════
echo    🤖 Запуск бота...
echo ═══════════════════════════════════════════════════════════
echo.
echo Для остановки нажмите Ctrl+C
echo.

python bot.py

pause
