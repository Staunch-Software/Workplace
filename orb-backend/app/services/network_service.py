"""Is the VM reachable right now, and how far is this PC's clock from it? (vessel side)

Same shape as DRS / Report Tracker's network_service, plus the clock check: the VM's /health answers with its UTC time,
and the difference to this PC's clock is what services/clock.py corrects every stored time by."""
import logging
import time
from datetime import datetime, timezone
from typing import Optional

import httpx

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("orb.network")

MAX_ROUND_TRIP = 10.0      # seconds; a slower answer says little about the VM's clock


class NetworkDetectionService:
    async def probe(self) -> tuple[bool, Optional[float]]:
        """(online, clock offset in seconds = VM time - this PC's time, or None if it could not be measured)."""
        try:
            async with httpx.AsyncClient(verify=settings.SYNC_VERIFY_TLS, timeout=settings.NETWORK_TIMEOUT_SECONDS) as client:
                sent = time.monotonic()
                before = datetime.now(timezone.utc)
                resp = await client.get(settings.CLOUD_HEALTH_URL or f"{settings.CLOUD_BASE_URL.rstrip('/')}/health")
                rtt = time.monotonic() - sent
            if resp.status_code != 200:
                return False, None
            offset = None
            server_time = resp.json().get("server_time") if "json" in resp.headers.get("content-type", "") else None
            if server_time and rtt <= MAX_ROUND_TRIP:
                vm = datetime.fromisoformat(server_time.replace("Z", "+00:00"))
                midpoint = before.timestamp() + rtt / 2
                offset = vm.timestamp() - midpoint
            return True, offset
        except Exception:
            return False, None

    async def is_online(self) -> bool:
        return (await self.probe())[0]

    async def get_network_status(self) -> str:
        return "ONLINE" if await self.is_online() else "OFFLINE"


network_service = NetworkDetectionService()
