# ВАЖНО: контекст сборки — корень репозитория (см. docker-compose.yml),
# потому что боту нужен общий пакет bots-common.
FROM cr.yandex/mirror/python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/opt/bots-common

WORKDIR /app

COPY bots-common /opt/bots-common
COPY vk-bot/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY vk-bot/ ./

CMD ["python", "bot.py"]
