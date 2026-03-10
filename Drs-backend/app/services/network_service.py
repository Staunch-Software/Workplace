import httpx
import asyncio
import logging
from typing import Literal
from app.core.config import settings

# Setup logger
logger = logging.getLogger("drs.network")

class NetworkDetectionService:
    """
    Service to detect network connectivity between Vessel (Offline) 
    and Shore (Online) environments.
    """

    def __init__(self):
        self.health_url = settings.CLOUD_HEALTH_URL
        self.timeout = settings.NETWORK_TIMEOUT_SECONDS

    async def is_online(self) -> bool:
        """
        Checks if the cloud backend is reachable.
        Returns True if reachable (200 OK), False otherwise.
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    self.health_url, 
                    timeout=self.timeout,
                    follow_redirects=True
                )
                
                if response.status_code == 200:
                    return True
                else:
                    logger.warning(f"Network Check: Cloud reachable but returned status {response.status_code}")
                    return False

        except httpx.ConnectTimeout:
            logger.debug("Network Check: Connection timed out (Slow Network).")
            return False
        except httpx.ConnectError:
            logger.debug("Network Check: Connection refused or DNS failure (No Internet).")
            return False
        except httpx.RequestError as e:
            logger.error(f"Network Check: Request error: {str(e)}")
            return False
        except Exception as e:
            logger.exception(f"Network Check: Unexpected error: {str(e)}")
            return False

    async def get_network_status(self) -> Literal["ONLINE", "OFFLINE"]:
        """
        Returns the status as a string.
        """
        online = await self.is_online()
        return "ONLINE" if online else "OFFLINE"

    async def wait_until_online(self) -> None:
        """
        Blocks (asynchronously) until the network is restored.
        Used by Sync Workers to pause execution during outages.
        """
        if await self.is_online():
            return

        logger.info("Network is OFFLINE. Entering wait loop...")
        
        while True:
            await asyncio.sleep(settings.SYNC_RETRY_INTERVAL)
            if await self.is_online():
                logger.info("Network restored. Resuming operations.")
                return

# Singleton instance
network_service = NetworkDetectionService()