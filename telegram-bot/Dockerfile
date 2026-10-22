# ВАЖНО: контекст сборки — корень репозитория, потому что боту нужен
# общий пакет bots-common. Сборка:
#   docker build -f telegram-bot/Dockerfile -t telegram-bot .
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/opt/bots-common

WORKDIR /app

COPY bots-common /opt/bots-common
COPY telegram-bot/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

RUN useradd --create-home --uid 10001 appuser
COPY --chown=appuser:appuser telegram-bot/ ./
RUN mkdir -p /app/logs && chown appuser:appuser /app/logs
USER appuser

CMD ["python", "bot.py"]
