"""Загрузка переменных окружения из .env-файлов.

Реализация намеренно не тянет сторонние зависимости (python-dotenv):
формат простой, а первое найденное значение должно побеждать — так
локальный `.env` бота перекрывает корневой `.env`.
"""

from __future__ import annotations

import os
from pathlib import Path


def load_env_file(path: Path | str) -> None:
    """Читает .env и выставляет переменные, не перезатирая уже заданные."""
    path = Path(path)
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def load_env_files(*paths: Path | str) -> None:
    """Загружает несколько .env-файлов по порядку (первый имеет приоритет)."""
    for path in paths:
        load_env_file(path)
