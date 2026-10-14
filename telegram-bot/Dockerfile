# ВАЖНО: контекст сборки — корень репозитория, потому что боту нужен
# общий пакет bots-common. Сборка:
#   docker build -f telegram-bot/Dockerfile -t telegram-bot .
FROM cr.yandex/mirror/python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/opt/bots-common

WORKDIR /app

COPY bots-common /opt/bots-common
COPY telegram-bot/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY telegram-bot/ ./

CMD ["python", "bot.py"]
