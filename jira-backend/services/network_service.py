import httpx
import asyncio
import logging
from typing import Literal
from core.config import settings

logger = logging.getLogger("jira.network")


class NetworkDetectionService:
    def __init__(self):
        self.health_url = settings.CLOUD_HEALTH_URL
        self.timeout = settings.NETWORK_TIMEOUT_SECONDS

    async def is_online(self) -> bool:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    self.health_url,
                    timeout=self.timeout,
                    follow_redirects=True,
                )
                return response.status_code == 200
        except httpx.ConnectTimeout:
            logger.debug("Network Check: Connection timed out.")
            return False
        except httpx.ConnectError:
            logger.debug("Network Check: Connection refused or DNS failure.")
            return False
        except httpx.RequestError as e:
            logger.error(f"Network Check: Request error: {e}")
            return False
        except Exception as e:
            logger.exception(f"Network Check: Unexpected error: {e}")
            return False

    async def get_network_status(self) -> Literal["ONLINE", "OFFLINE"]:
        return "ONLINE" if await self.is_online() else "OFFLINE"

    async def wait_until_online(self) -> None:
        if await self.is_online():
            return
        logger.info("Network is OFFLINE. Entering wait loop...")
        while True:
            await asyncio.sleep(settings.SYNC_RETRY_INTERVAL)
            if await self.is_online():
                logger.info("Network restored. Resuming operations.")
                return


network_service = NetworkDetectionService()