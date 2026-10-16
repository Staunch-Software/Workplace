"""One-time migration: give every ORB upload a copy in Azure Blob Storage.

New uploads already send the original PDF to blob storage (best effort) and
store its URL in `orb_uploads.pdf_blob_url`. Older uploads, or ones where the
blob upload failed, only exist on local disk. This script uploads those local
PDFs and records the blob URL so Azure becomes the durable copy.

Local files are never deleted or moved: extraction still needs a local working
copy, and the preview endpoint prefers it.

Safe by design:
  * Dry run by default - lists what would be uploaded, changes nothing.
  * Only uploads whose `pdf_blob_url` is empty are touched, so re-running is
    harmless.
  * Every upload is verified (size + SHA-256 of the downloaded blob) before the
    database row is updated.
  * Uploads whose local file cannot be found are reported and skipped.
  * Also reports local files under UPLOAD_DIR that no upload row refers to
    (report only, nothing is deleted).

Usage (from orb-backend/, with the same .env the API uses):
    python scripts/migrate_uploads_to_blob.py            # dry run
    python scripts/migrate_uploads_to_blob.py --apply    # upload + record URLs
"""
import argparse
import asyncio
import hashlib
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.config import get_settings  # noqa: E402


def resolve_local_path(storage_path: str, upload_dir: str) -> str | None:
    """Find the file even if the stored path was relative or from another folder."""
    candidates = [storage_path]
    if not os.path.isabs(storage_path):
        candidates.append(os.path.join(BACKEND_DIR, storage_path))
    parts = storage_path.replace("\\", "/").split("/")
    if len(parts) >= 2:  # <vessel_id>/<file> under the current UPLOAD_DIR
        candidates.append(os.path.join(upload_dir, parts[-2], parts[-1]))
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


async def main(apply: bool) -> int:
    settings = get_settings()
    upload_dir = settings.UPLOAD_DIR if os.path.isabs(settings.UPLOAD_DIR) else os.path.join(BACKEND_DIR, settings.UPLOAD_DIR)

    if apply and not settings.AZURE_STORAGE_CONNECTION_STRING:
        print("AZURE_STORAGE_CONNECTION_STRING is not set in .env - cannot upload.")
        return 1

    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.connect() as c:
        pending = (await c.execute(text(
            "SELECT id, original_filename, storage_path FROM orb_uploads "
            "WHERE pdf_blob_url IS NULL OR pdf_blob_url = '' ORDER BY created_at"
        ))).all()
        total = (await c.execute(text("SELECT count(*) FROM orb_uploads"))).scalar()
        referenced = {r[0] for r in (await c.execute(text("SELECT storage_path FROM orb_uploads"))).all()}

    print(f"Uploads: {total} total, {len(pending)} without a blob copy")
    ready, missing = [], []
    for row in pending:
        path = resolve_local_path(row.storage_path, upload_dir)
        (ready if path else missing).append((row, path))

    for row, path in ready:
        print(f"  upload  {row.id}  {row.original_filename}  ({os.path.getsize(path):,} bytes)")
    for row, _ in missing:
        print(f"  MISSING {row.id}  {row.original_filename}  (no local file at {row.storage_path})")

    if os.path.isdir(upload_dir):
        on_disk = {os.path.join(d, f) for d, _, fs in os.walk(upload_dir) for f in fs}
        known = {os.path.abspath(p) for p in referenced} | {os.path.abspath(os.path.join(BACKEND_DIR, p)) for p in referenced}
        orphans = [p for p in on_disk if os.path.abspath(p) not in known]
        print(f"Local files in {upload_dir}: {len(on_disk)} | not referenced by any upload: {len(orphans)} (left alone)")

    if not apply:
        print("\nDry run only. Re-run with --apply to upload these files.")
        return 0
    if not ready:
        print("\nNothing to upload.")
        return 0

    from app.services.azure_storage import upload_orb_pdf, download_iopp_document

    done = failed = 0
    for row, path in ready:
        with open(path, "rb") as f:
            content = f.read()
        try:
            url = await upload_orb_pdf(content, row.original_filename)
            back, _ = await download_iopp_document(url)
            if len(back) != len(content) or hashlib.sha256(back).hexdigest() != hashlib.sha256(content).hexdigest():
                raise RuntimeError("downloaded blob does not match the local file")
            async with engine.begin() as c:
                await c.execute(text("UPDATE orb_uploads SET pdf_blob_url = :u WHERE id = :i"), {"u": url, "i": row.id})
            done += 1
            print(f"  ok      {row.id}  -> {url}")
        except Exception as exc:
            failed += 1
            print(f"  FAILED  {row.id}  {row.original_filename}: {exc}")
    print(f"\nUploaded and recorded: {done} | failed: {failed} | missing locally: {len(missing)}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Copy local ORB upload PDFs to Azure Blob Storage.")
    parser.add_argument("--apply", action="store_true", help="upload and record URLs (default is a dry run)")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.apply)))
