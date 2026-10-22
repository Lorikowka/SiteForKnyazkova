# ВАЖНО: контекст сборки — корень репозитория (см. docker-compose.yml),
# потому что боту нужен общий пакет bots-common.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/opt/bots-common

WORKDIR /app

COPY bots-common /opt/bots-common
COPY vk-bot/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

RUN useradd --create-home --uid 10001 appuser
COPY --chown=appuser:appuser vk-bot/ ./
RUN mkdir -p /app/logs /app/data && chown appuser:appuser /app/logs /app/data
USER appuser

CMD ["python", "bot.py"]
