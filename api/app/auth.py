"""Bearer JWT auth for Supabase access tokens (aud "authenticated").

Supabase projects created since mid-2025 sign with an asymmetric key (ES256, published at
<SUPABASE_URL>/auth/v1/.well-known/jwks.json); the legacy path is HS256 with the project's JWT
secret. Ours has been rotated between the two (docs/log/C.md session 15), and a browser session
established under one key keeps presenting that token until it refreshes, so the API accepts
both: HS256 against SUPABASE_JWT_SECRET, anything asymmetric against the JWKS (fetched once and
cached for the life of the process; a kid we have not seen forces one refetch).
"""
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request
from jwt import PyJWKClient

from .config import Settings, get_settings

DEV_USER_ID = "00000000-0000-4000-8000-000000000001"  # must be a valid uuid: tables key on user_id uuid

JWKS_ALGORITHMS = ["ES256", "ES384", "ES512", "RS256", "RS384", "RS512", "EdDSA"]
_jwks_clients: dict[str, PyJWKClient] = {}


def jwks_url(settings: Settings) -> str:
    base = settings.supabase_url.rstrip("/")
    return f"{base}/auth/v1/.well-known/jwks.json" if base else ""


def _jwks_client(url: str) -> PyJWKClient:
    client = _jwks_clients.get(url)
    if client is None:
        # PyJWKClient refetches on an unknown kid, so a future key rotation needs no restart.
        client = _jwks_clients[url] = PyJWKClient(url, cache_keys=True, lifespan=3600, timeout=5)
    return client


@dataclass(frozen=True)
class User:
    id: str
    email: str | None = None


def _decode(token: str, settings: Settings) -> User:
    url = jwks_url(settings)
    if not settings.supabase_jwt_secret and not url:
        raise HTTPException(status_code=503, detail="auth not configured")
    try:
        alg = jwt.get_unverified_header(token).get("alg")
        if alg == "HS256":
            if not settings.supabase_jwt_secret:
                raise jwt.InvalidAlgorithmError("HS256 token but SUPABASE_JWT_SECRET is empty")
            key, algorithms = settings.supabase_jwt_secret, ["HS256"]
        elif alg in JWKS_ALGORITHMS:
            if not url:
                raise jwt.InvalidAlgorithmError(f"{alg} token but SUPABASE_URL is empty")
            key, algorithms = _jwks_client(url).get_signing_key_from_jwt(token).key, [alg]
        else:
            raise jwt.InvalidAlgorithmError(f"unsupported alg {alg!r}")
        claims = jwt.decode(
            token,
            key,
            algorithms=algorithms,
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
