from typing import Any


def success(data: Any = None, message: str = "OK") -> dict:
    return {"success": True, "data": data, "message": message}
