"""Общее ядро Telegram- и VK-ботов.

Пакет содержит всё, что не зависит от конкретного мессенджера:

- :mod:`bots_common.backend` — HTTP-клиент backend API;
- :mod:`bots_common.formatting` — форматирование записей и экспорт .ics;
- :mod:`bots_common.parsers` — разбор текстовых команд;
- :mod:`bots_common.events` — отслеживание новых записей/платежей;
- :mod:`bots_common.loops` — напоминания и утренние сводки;
- :mod:`bots_common.settings` — чтение настроек из окружения;
- :mod:`bots_common.env` — загрузка .env-файлов;
- :mod:`bots_common.logging_setup` — единое логирование.
"""

__all__ = ["__version__"]

__version__ = "2.0.0"
