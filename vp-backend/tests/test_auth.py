"""The workplace login in front of every Vessel Performance route.

Run from vp-backend/:  python -m pytest tests/test_auth.py
Needs vp-backend/.env (database settings and SECRET_KEY); no database rows are read or written.
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jose import jwt
from starlette.requests import Request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import auth                      # noqa: E402
from backend.config import config             # noqa: E402

SECRET = config.SECRET_KEY or "test-secret"
if not config.SECRET_KEY:
    config.SECRET_KEY = SECRET


def token_for(user_id, **extra):
    claims = {"sub": str(user_id), "exp": datetime.now(timezone.utc) + timedelta(minutes=5), **extra}
    return jwt.encode(claims, SECRET, algorithm="HS256")


def request(method="GET"):
    return Request({"type": "http", "method": method, "headers": [], "path": "/"})


def creds(token):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


@pytest.fixture
def users(monkeypatch):
    """Fake control database: id -> User (None = unknown or inactive)."""
    table = {}
    monkeypatch.setattr(auth, "load_control_user", lambda uid: table.get(uid))
    return table


def make_user(role, **permissions):
    return auth.User(id=uuid.uuid4(), full_name="Test User", email="t@example.com", role=role, permissions=permissions)


def call(token, method="GET"):
    return auth.get_current_user(request(method), creds(token) if token else None)


def code_of(fn):
    with pytest.raises(HTTPException) as e:
        fn()
    return e.value.status_code


# ── who gets in ─────────────────────────────────────────────────────────────
def test_no_token_is_401():
    assert code_of(lambda: call(None)) == 401


def test_garbage_and_wrong_signature_are_401():
    assert code_of(lambda: call("not-a-jwt")) == 401
    bad = jwt.encode({"sub": str(uuid.uuid4())}, "another-secret", algorithm="HS256")
    assert code_of(lambda: call(bad)) == 401


def test_unknown_or_inactive_user_is_401(users):
    assert code_of(lambda: call(token_for(uuid.uuid4()))) == 401


def test_sub_that_is_not_a_uuid_is_401():
    assert code_of(lambda: call(token_for("12"))) == 401


def test_admin_gets_in(users):
    u = make_user("ADMIN"); users[u.id] = u
    assert call(token_for(u.id)).id == u.id


def test_shore_needs_the_permission(users):
    with_perm = make_user("SHORE", vessel_performance=True); users[with_perm.id] = with_perm
    without = make_user("SHORE", orb=True); users[without.id] = without
    false_flag = make_user("SHORE", vessel_performance=False); users[false_flag.id] = false_flag
    assert call(token_for(with_perm.id)).id == with_perm.id
    assert code_of(lambda: call(token_for(without.id))) == 403
    assert code_of(lambda: call(token_for(false_flag.id))) == 403


def test_vessel_role_never_gets_in(users):
    u = make_user("VESSEL", vessel_performance=True); users[u.id] = u
    assert code_of(lambda: call(token_for(u.id))) == 403


# ── admin only ──────────────────────────────────────────────────────────────
def test_require_admin(users):
    shore = make_user("SHORE", vessel_performance=True); admin = make_user("ADMIN")
    assert code_of(lambda: auth.require_admin(shore)) == 403
    assert auth.require_admin(admin) is admin


# ── the PDF renderer's token ────────────────────────────────────────────────
def test_render_token_reads_but_never_writes():
    t = auth.create_render_token()
    assert call(t, "GET").is_render
    assert call(t, "HEAD").is_render
    assert code_of(lambda: call(t, "POST")) == 403
    assert code_of(lambda: call(t, "PUT")) == 403
    assert code_of(lambda: call(t, "DELETE")) == 403


def test_render_token_is_not_an_admin_or_a_person():
    r = call(auth.create_render_token())
    assert code_of(lambda: auth.require_admin(r)) == 403
    assert code_of(lambda: auth.require_person(r)) == 403


def test_expired_render_token_is_401():
    old = jwt.encode({"purpose": "vp_render", "exp": datetime.now(timezone.utc) - timedelta(seconds=5)}, SECRET, algorithm="HS256")
    assert code_of(lambda: call(old)) == 401


def test_a_plain_user_token_is_not_a_render_token(users):
    u = make_user("SHORE", vessel_performance=True); users[u.id] = u
    assert not call(token_for(u.id)).is_render


# ── every route is behind the login ────────────────────────────────────────
def test_every_api_route_requires_a_token():
    from fastapi.routing import APIRoute
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    open_paths = {"/", "/health", "/api/health", "/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect"}
    checked = 0
    for route in app.routes:
        if not isinstance(route, APIRoute) or route.path in open_paths:
            continue
        path = route.path
        for p in route.dependant.path_params:
            path = path.replace("{" + p.name + "}", "x")
        for method in route.methods - {"HEAD", "OPTIONS"}:
            r = client.request(method, path, json={})
            assert r.status_code == 401, f"{method} {route.path} answered {r.status_code} without a token"
            checked += 1
    assert checked >= 90   # 95 route+method pairs at the time of writing; guards against the loop checking nothing


def test_the_removed_login_and_user_routes_are_gone():
    from fastapi.testclient import TestClient
    from app.main import app
    paths = {getattr(r, "path", "") for r in app.routes}
    assert not any(p.startswith("/api/v1/auth") for p in paths)
    assert TestClient(app).get("/health").json() == {"status": "ok"}
