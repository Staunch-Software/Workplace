from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from core.config import settings
from core.security import decode_token
from db.database import get_control_db
from models.control import User

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="http://localhost:8003/login/access-token"
)

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    control_db: AsyncSession = Depends(get_control_db),
) -> User:
    try:
        payload = decode_token(token)
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Could not validate credentials")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Could not validate credentials")

    stmt = (
        select(User)
        .where(User.id == user_id)
        .options(selectinload(User.vessels))
    )
    result = await control_db.execute(stmt)
    user = result.scalars().first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    return user

def require_role(*roles):
    async def checker(user: User = Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Access denied")
        return user
    return checker