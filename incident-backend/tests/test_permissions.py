import os
from types import SimpleNamespace

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/x")
os.environ.setdefault("CONTROL_DATABASE_URL", "postgresql+asyncpg://u:p@localhost/y")
os.environ.setdefault("SECRET_KEY", "test")

from fastapi import HTTPException  # noqa: E402

from app.dependencies import can_create, has_module_access  # noqa: E402
from app.services import storage  # noqa: E402


def user(role, **perms):
    return SimpleNamespace(role=role, permissions=perms)


def test_creating_needs_the_flag_even_for_admin():
    assert not can_create(user("ADMIN"))
    assert not can_create(user("SHORE", incident_report=True))
    assert can_create(user("SHORE", incident_report=True, incident_create=True))


def test_module_access():
    assert has_module_access(user("ADMIN"))
    assert has_module_access(user("SHORE", incident_report=True))
    assert not has_module_access(user("SHORE"))
    assert not has_module_access(user("VESSEL", incident_report=True))


def test_photo_must_be_an_image():
    assert storage.validate_file("a.jpg", 10, 25, images_only=True) == "image/jpeg"
    with pytest.raises(HTTPException):
        storage.validate_file("a.pdf", 10, 25, images_only=True)


def test_size_and_type_limits():
    with pytest.raises(HTTPException):
        storage.validate_file("a.exe", 10, 25)
    with pytest.raises(HTTPException):
        storage.validate_file("a.pdf", 26 * 1024 * 1024, 25)
    with pytest.raises(HTTPException):
        storage.validate_file("a.pdf", 0, 25)


def test_safe_filename_strips_paths():
    assert storage.safe_filename("..\\..\\etc/pass wd.pdf") == "pass wd.pdf"
