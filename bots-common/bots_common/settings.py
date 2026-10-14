"""Хелперы для чтения настроек из переменных окружения."""

from __future__ import annotations

import os

_TRUTHY = {"1", "true", "yes", "on"}


def env_str(name: str, default: str = "") -> str:
    """Строковое значение переменной (обрезанное по краям)."""
    value = os.getenv(name)
    return (value if value is not None else default).strip()


def env_bool(name: str, default: bool = False) -> bool:
    """Булево значение: 1/true/yes/on (без учёта регистра)."""
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in _TRUTHY


def env_int(name: str, default: int = 0) -> int:
    """Целое значение; при ошибке разбора возвращает значение по умолчанию."""
    value = (os.getenv(name) or "").strip()
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def parse_int_list(value: str) -> set[int]:
    """Разбирает строку вида ``1, 2, 3`` в множество целых чисел."""
    result: set[int] = set()
    for raw_item in value.split(","):
        item = raw_item.strip()
        if not item:
            continue
        try:
            result.add(int(item))
        except ValueError:
            continue
    return result
