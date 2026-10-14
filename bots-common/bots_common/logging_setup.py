"""Единая настройка логирования с ротацией файлов.

Корневой логгер настраивается один раз, поэтому сообщения из модулей
пакета и библиотек попадают в общий файл и консоль.
"""

from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

# Библиотеки, которые слишком шумно логируют на INFO.
_NOISY_LOGGERS = ("aiohttp", "aiogram", "vkbottle", "httpx", "httpcore")

_LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def _make_console_stream() -> "object":
    """Возвращает поток вывода, способный печатать кириллицу на Windows."""
    stream = sys.stdout
    reconfigure = getattr(stream, "reconfigure", None)
    if callable(reconfigure):
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass
    return stream


def setup_logging(name: str, log_dir: Path | str, level: int = logging.INFO) -> logging.Logger:
    """Настраивает корневой логгер и возвращает именованный логгер."""
    log_dir = Path(log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    if not root.handlers:
        formatter = logging.Formatter(_LOG_FORMAT)

        # Ротация: 5 файлов по 5 МБ.
        file_handler = RotatingFileHandler(
            log_dir / "bot.log",
            maxBytes=5 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)

        console_handler = logging.StreamHandler(_make_console_stream())
        console_handler.setFormatter(formatter)

        root.addHandler(file_handler)
        root.addHandler(console_handler)
        root.setLevel(level)

    for noisy in _NOISY_LOGGERS:
        logging.getLogger(noisy).setLevel(logging.WARNING)

    return logging.getLogger(name)
