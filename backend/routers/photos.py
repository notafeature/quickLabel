"""Photo upload + serve. Photos live on disk under /app/data/photos/<uuid>.<ext>."""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from db import PHOTOS_DIR, db, ensure_dirs, new_id, now_iso, rows_to_list

router = APIRouter(prefix="/api/photos", tags=["photos"])

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


@router.post("")
async def upload_photo(
    file: UploadFile = File(...),
    lot_kind: Optional[str] = Form(None),
    lot_id: Optional[str] = Form(None),
    event_id: Optional[str] = Form(None),
    taken_at: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
) -> dict:
    if file.content_type and file.content_type not in ALLOWED_MIME:
        raise HTTPException(415, f"unsupported mime type '{file.content_type}'")
    ensure_dirs()
    pid = new_id()
    ext = Path(file.filename or "").suffix.lower() or ".jpg"
    dest = PHOTOS_DIR / f"{pid}{ext}"
    size = 0
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
        size = dest.stat().st_size
    now = now_iso()
    with db() as conn:
        conn.execute(
            "INSERT INTO photos(id, event_id, lot_kind, lot_id, filename, original_name, "
            "mime_type, size_bytes, taken_at, notes, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (pid, event_id, lot_kind, lot_id, dest.name, file.filename,
             file.content_type, size, taken_at, notes, now),
        )
    return {"id": pid, "filename": dest.name, "size_bytes": size,
            "lot_kind": lot_kind, "lot_id": lot_id, "event_id": event_id}


@router.get("")
def list_photos(
    lot_kind: str | None = None,
    lot_id: str | None = None,
    event_id: str | None = None,
) -> list[dict]:
    sql = "SELECT * FROM photos WHERE deleted_at IS NULL"
    params: list = []
    if lot_kind:
        sql += " AND lot_kind = ?"
        params.append(lot_kind)
    if lot_id:
        sql += " AND lot_id = ?"
        params.append(lot_id)
    if event_id:
        sql += " AND event_id = ?"
        params.append(event_id)
    sql += " ORDER BY created_at DESC"
    with db() as conn:
        rows = conn.execute(sql, params).fetchall()
    return rows_to_list(rows)


@router.get("/{pid}/file")
def serve_photo(pid: str):
    with db() as conn:
        row = conn.execute("SELECT filename, mime_type FROM photos WHERE id = ? AND deleted_at IS NULL",
                           (pid,)).fetchone()
    if not row:
        raise HTTPException(404, "photo not found")
    path = PHOTOS_DIR / row["filename"]
    if not path.exists():
        raise HTTPException(410, "photo file gone")
    return FileResponse(path, media_type=row["mime_type"] or "application/octet-stream")


@router.delete("/{pid}")
def delete_photo(pid: str) -> dict:
    now = now_iso()
    with db() as conn:
        conn.execute("UPDATE photos SET deleted_at = ? WHERE id = ?", (now, pid))
    return {"id": pid, "deleted": True}
