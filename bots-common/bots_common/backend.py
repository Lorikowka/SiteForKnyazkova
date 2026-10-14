"""HTTP-клиент backend API.

Боты никогда не обращаются к SQLite напрямую — только к backend. Этот
клиент — единственная точка доступа к данным.
"""

from __future__ import annotations

import asyncio
import logging
import urllib.parse
from typing import Any

import aiohttp

logger = logging.getLogger(__name__)


class BackendClient:
    """Асинхронный клиент backend с единым ключом доступа к закрытым путям."""

    def __init__(
        self,
        base_url: str,
        api_key: str = "",
        *,
        disable_ssl_verify: bool = False,
        timeout: int = 15,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.disable_ssl_verify = disable_ssl_verify
        self.timeout = timeout
        self._session: aiohttp.ClientSession | None = None

    async def open(self) -> aiohttp.ClientSession:
        """Открывает переиспользуемую HTTP-сессию (лениво)."""
        if self._session is None or self._session.closed:
            connector = aiohttp.TCPConnector(ssl=False) if self.disable_ssl_verify else None
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.timeout),
                connector=connector,
            )
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()
        self._session = None

    async def request(self, method: str, endpoint: str, **kwargs: Any) -> dict[str, Any] | None:
        """Выполняет запрос; при ошибке/не-2xx возвращает None."""
        session = await self.open()

        headers = dict(kwargs.pop("headers", {}) or {})
        if self.api_key:
            headers.setdefault("X-Bot-API-Key", self.api_key)
            headers.setdefault("X-API-Key", self.api_key)

        try:
            async with session.request(
                method,
                f"{self.base_url}{endpoint}",
                headers=headers,
                **kwargs,
            ) as response:
                text = await response.text()
                if response.status >= 400:
                    logger.warning(
                        "Backend %s %s failed: %s %s",
                        method,
                        endpoint,
                        response.status,
                        text,
                    )
                    return None
                if not text:
                    return {}

                try:
                    data = await response.json()
                except (aiohttp.ContentTypeError, ValueError):
                    logger.warning("Backend returned non-JSON response: %s", text)
                    return None
                return data if isinstance(data, dict) else None
        except (aiohttp.ClientError, asyncio.TimeoutError) as error:
            logger.warning("Backend request error: %s %s: %s", method, endpoint, error)
            return None

    # ————————————————————— Здоровье сервиса —————————————————————

    async def health(self) -> dict[str, Any] | None:
        return await self.request("GET", "/api/health")

    async def can_access_protected_api(self) -> bool:
        data = await self.request("GET", "/api/sessions?limit=1")
        return bool(data and data.get("success"))

    # ————————————————————————— Записи —————————————————————————

    async def sessions(
        self,
        *,
        past: bool = False,
        limit: int = 100,
        start: str | None = None,
        end: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        params = {"past": str(past).lower(), "limit": str(limit)}
        if start:
            params["from"] = start
        if end:
            params["to"] = end
        if status:
            params["status"] = status

        data = await self.request("GET", f"/api/sessions?{urllib.parse.urlencode(params)}")
        return data.get("sessions", []) if data and data.get("success") else []

    async def create_session(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        return await self.request("POST", "/api/sessions", json=payload)

    async def update_session_status(self, session_id: int, status: str) -> bool:
        data = await self.request("PATCH", f"/api/sessions/{session_id}/status", json={"status": status})
        return bool(data and data.get("success"))

    async def delete_session(self, session_id: int) -> bool:
        data = await self.request("DELETE", f"/api/sessions/{session_id}")
        return bool(data and data.get("success"))

    async def reminders_due(self) -> list[dict[str, Any]]:
        data = await self.request("GET", "/api/sessions/reminders/due")
        return data.get("sessions", []) if data and data.get("success") else []

    async def mark_reminder_sent(self, session_id: int) -> bool:
        data = await self.request("POST", f"/api/sessions/reminders/{session_id}/mark-sent")
        return bool(data and data.get("success"))

    # ————————————————————————— Платежи —————————————————————————

    async def payments(self, *, limit: int = 20) -> list[dict[str, Any]]:
        data = await self.request("GET", f"/api/payments?limit={limit}")
        return data.get("payments", []) if data and data.get("success") else []

    # ———————————————————————— Расписание ————————————————————————

    async def schedule(self, service_id: str = "consult-online") -> dict[str, Any] | None:
        return await self.request("GET", f"/api/schedule?serviceId={urllib.parse.quote(service_id)}")

    async def blocked_dates(self) -> list[dict[str, Any]]:
        data = await self.request("GET", "/api/schedule/admin/blocks")
        return data.get("blocks", []) if data and data.get("success") else []

    async def block_date(self, date: str, reason: str = "") -> bool:
        data = await self.request("POST", "/api/schedule/admin/block", json={"date": date, "reason": reason})
        return bool(data and data.get("success"))

    async def unblock_date(self, date: str) -> bool:
        data = await self.request("DELETE", f"/api/schedule/admin/block/{date}")
        return bool(data and data.get("success"))
