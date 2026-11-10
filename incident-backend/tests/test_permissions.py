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


# ── File storage: blob by default, never a silent local fallback ────────────────────────────────

import asyncio  # noqa: E402
import uuid  # noqa: E402


def test_blob_mode_refuses_upload_without_connection_string(monkeypatch):
    monkeypatch.setattr(storage.settings, "FILE_STORAGE", "blob")
    monkeypatch.setattr(storage.settings, "AZURE_STORAGE_CONNECTION_STRING", "")
    with pytest.raises(HTTPException) as e:
        asyncio.run(storage.save(b"x", "a.jpg", "image/jpeg", uuid.uuid4()))
    assert e.value.status_code == 503


def test_local_mode_stores_and_deletes(monkeypatch, tmp_path):
    monkeypatch.setattr(storage.settings, "FILE_STORAGE", "local")
    monkeypatch.setattr(storage.settings, "UPLOAD_DIR", str(tmp_path))
    path = asyncio.run(storage.save(b"hello", "a.txt", "text/plain", uuid.uuid4()))
    assert asyncio.run(storage.read(path)) == b"hello"
    asyncio.run(storage.delete(path))
    assert not os.path.exists(path)
    asyncio.run(storage.delete(path))   # deleting twice is harmless


def test_blob_url_parsing_for_azure_and_azurite():
    assert storage._parse_blob_url("https://acct.blob.core.windows.net/incident-files/abc/x.jpg") == ("incident-files", "abc/x.jpg")
    assert storage._parse_blob_url("http://127.0.0.1:10000/devstoreaccount1/incident-chat/abc/x.pdf") == ("incident-chat", "abc/x.pdf")


def test_container_creation_race_is_not_an_error():
    from azure.core.exceptions import ResourceExistsError

    class Lost:
        container_name = "incident-files"

        def create_container(self):
            raise ResourceExistsError("The specified container already exists.")

    storage._ensure_container(Lost())   # another worker created it first: must not raise


def test_container_creation_other_errors_still_raise():
    class Broken:
        container_name = "incident-files"

        def create_container(self):
            raise RuntimeError("storage unreachable")

    with pytest.raises(RuntimeError):
        storage._ensure_container(Broken())


# ── Notification text helpers ───────────────────────────────────────────────────────────────────

from app.services import incident_notify as notify  # noqa: E402


def test_snippet_collapses_whitespace_and_truncates():
    assert notify.snippet("  hello \n  world ") == "hello world"
    long = "x" * 500
    out = notify.snippet(long)
    assert len(out) == notify.SNIPPET and out.endswith("…")


def test_snippet_for_attachment_only_message():
    assert notify.snippet("", has_files=True) == "sent an attachment"
    assert notify.snippet("", has_files=False) == ""


def test_files_phrase_pluralises():
    assert notify.files_phrase("PHOTO", 1) == "1 photo"
    assert notify.files_phrase("PHOTO", 3) == "3 photos"
    assert notify.files_phrase("LOG", 2) == "2 alarm/event log files"


def test_incident_link_is_relative_to_the_module():
    assert notify.incident_link("abc") == "?open=abc"
