"""Bearer JWT auth. Supabase signs access tokens with HS256 and aud "authenticated"."""
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request

from .config import Settings, get_settings

DEV_USER_ID = "00000000-0000-4000-8000-000000000d3v"


@dataclass(frozen=True)
class User:
    id: str
    email: str | None = None


def _decode(token: str, settings: Settings) -> User:
    if not settings.supabase_jwt_secret:
        raise HTTPException(status_code=503, detail="auth not configured")
    try:
        claims = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            options={"require": ["sub", "exp"]},
        )
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"invalid token: {e.__class__.__name__}") from e
    return User(id=str(claims["sub"]), email=claims.get("email"))


def current_user(request: Request, settings: Annotated[Settings, Depends(get_settings)]) -> User:
    if settings.dev_auth_bypass:
        return User(id=DEV_USER_ID, email="dev@scallion.local")
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="missing bearer token")
    return _decode(token, settings)


CurrentUser = Annotated[User, Depends(current_user)]
