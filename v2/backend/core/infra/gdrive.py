"""
gdrive.py — репозиторий Google Drive для хранения оригиналов (RAW/TIFF).

Зачем:
  Supabase Storage держит JPEG-превью и .cos. Source-файлы (CR3/TIFF, 30–80 МБ)
  туда не помещаются разумно. Drive — backend для оригиналов.

Архитектура:
  Слой infra. Никаких импортов из services/. Чистый класс с состоянием
  (creds + service), все side-effects — внутри методов.

OAuth:
  Не делает auth-flow. Ожидает уже сохранённый token.json (см. setup_gdrive.py).
  При истёкшем access_token — refresh через refresh_token (автоматически).

Scope:
  drive.file — доступ только к файлам, созданным этим приложением.
  Этого достаточно для upload / download / list / delete своих файлов.
"""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any, Optional

# Импорты Google SDK — прячем внутрь модуля, чтобы остальной код не падал
# на ImportError если зависимость ещё не установлена (например, в тестах
# фронтенда без google-api-python-client).
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload


SCOPES = ["https://www.googleapis.com/auth/drive.file"]
DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024  # 8 MiB — баланс между memory и round-trips
MIME_FOLDER = "application/vnd.google-apps.folder"


class GDriveError(Exception):
    """Любая ошибка Drive API после маппинга из HttpError."""


class GDriveRepository:
    """
    Репозиторий Google Drive: upload / download / list / delete / folder / quota.

    Использование:
        repo = GDriveRepository(token_path=".../google-token.json")
        info = repo.upload("/local/IMG_0001.CR3", parent_folder_id=folder_id)
        # info = {"file_id": "...", "web_view_link": "...", "size": 28371234, "mime_type": "image/x-canon-cr3"}

    Один экземпляр держит один service-объект; thread-safety не гарантируется
    (httplib2 под капотом не thread-safe — для конкурентных upload-ов создавай
    отдельный экземпляр на поток).
    """

    def __init__(self, token_path: str | Path, client_path: Optional[str | Path] = None):
        """
        :param token_path: путь к google-token.json (создаётся setup_gdrive.py)
        :param client_path: опциональный путь к google-oauth-client.json. Нужен
                            только если token.json не содержит client_id/secret
                            (старый формат). Современный setup_gdrive.py пишет всё
                            в один файл, так что обычно None.
        """
        self._token_path = Path(token_path)
        self._client_path = Path(client_path) if client_path else None
        self._creds: Optional[Credentials] = None
        self._service: Any = None

    # ── creds / service lifecycle ──────────────────────────────────────────

    def _load_creds(self) -> Credentials:
        if not self._token_path.exists():
            raise GDriveError(
                f"google-token.json не найден ({self._token_path}). "
                f"Запусти setup_gdrive.py — он создаст файл после OAuth."
            )

        with open(self._token_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        client_id = data.get("client_id")
        client_secret = data.get("client_secret")

        if (not client_id or not client_secret) and self._client_path and self._client_path.exists():
            with open(self._client_path, "r", encoding="utf-8") as cf:
                client_data = json.load(cf)
            inst = client_data.get("installed") or client_data.get("web") or {}
            client_id = client_id or inst.get("client_id")
            client_secret = client_secret or inst.get("client_secret")

        creds = Credentials(
            token=data.get("access_token"),
            refresh_token=data.get("refresh_token"),
            token_uri=data.get("token_uri", "https://oauth2.googleapis.com/token"),
            client_id=client_id,
            client_secret=client_secret,
            scopes=data.get("scopes", SCOPES),
        )

        if not creds.valid:
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                self._save_refreshed(creds)
            else:
                raise GDriveError(
                    "Токен невалиден и нет refresh_token. "
                    "Перезапусти setup_gdrive.py."
                )

        return creds

    def _save_refreshed(self, creds: Credentials) -> None:
        # Перезаписываем token-файл с новым access_token; refresh_token остаётся.
        # Без этого после рестарта приложение опять делало бы refresh-запрос.
        try:
            with open(self._token_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            data["access_token"] = creds.token
            data["expiry"] = creds.expiry.isoformat() if creds.expiry else None
            tmp = self._token_path.with_suffix(self._token_path.suffix + ".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            tmp.replace(self._token_path)
        except OSError:
            # Не критично — refresh повторится в следующий раз.
            pass

    def _svc(self):
        if self._service is None:
            self._creds = self._load_creds()
            self._service = build("drive", "v3", credentials=self._creds, cache_discovery=False)
        return self._service

    # ── public API ─────────────────────────────────────────────────────────

    def upload(
        self,
        local_path: str | Path,
        remote_name: Optional[str] = None,
        parent_folder_id: Optional[str] = None,
        mime_type: Optional[str] = None,
    ) -> dict:
        """
        Загружает файл на Drive (resumable, чанками по 8 MiB).
        :returns: {"file_id", "web_view_link", "size", "mime_type", "name"}
        """
        path = Path(local_path)
        if not path.exists():
            raise GDriveError(f"Файл не найден: {path}")

        body: dict = {"name": remote_name or path.name}
        if parent_folder_id:
            body["parents"] = [parent_folder_id]

        media = MediaFileUpload(
            str(path),
            mimetype=mime_type,
            resumable=True,
            chunksize=DEFAULT_CHUNK_SIZE,
        )
        try:
            file = (
                self._svc()
                .files()
                .create(
                    body=body,
                    media_body=media,
                    fields="id, name, size, mimeType, webViewLink",
                )
                .execute()
            )
        except HttpError as e:
            raise GDriveError(f"upload failed: {e}") from e

        return {
            "file_id": file["id"],
            "name": file.get("name"),
            "size": int(file["size"]) if file.get("size") else None,
            "mime_type": file.get("mimeType"),
            "web_view_link": file.get("webViewLink"),
        }

    def download(self, file_id: str, local_path: str | Path) -> None:
        """Стримит содержимое файла в local_path. Чанками, без ОЗУ-всплеска."""
        path = Path(local_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            request = self._svc().files().get_media(fileId=file_id)
            with open(path, "wb") as fh:
                downloader = MediaIoBaseDownload(fh, request, chunksize=DEFAULT_CHUNK_SIZE)
                done = False
                while not done:
                    _, done = downloader.next_chunk()
        except HttpError as e:
            raise GDriveError(f"download failed (file_id={file_id}): {e}") from e

    def list(
        self,
        parent_folder_id: Optional[str] = None,
        limit: int = 100,
        query: Optional[str] = None,
    ) -> list[dict]:
        """
        Список файлов. Без parent_folder_id — все файлы, созданные приложением
        (scope drive.file ограничивает выдачу автоматически).

        :param query: дополнительный Drive-query (см. https://developers.google.com/drive/api/guides/search-files)
        """
        clauses = ["trashed = false"]
        if parent_folder_id:
            clauses.append(f"'{parent_folder_id}' in parents")
        if query:
            clauses.append(f"({query})")
        q = " and ".join(clauses)

        try:
            res = (
                self._svc()
                .files()
                .list(
                    q=q,
                    pageSize=min(limit, 1000),
                    fields="files(id, name, size, mimeType, webViewLink, createdTime, parents)",
                    spaces="drive",
                )
                .execute()
            )
        except HttpError as e:
            raise GDriveError(f"list failed: {e}") from e

        return [
            {
                "file_id": f["id"],
                "name": f.get("name"),
                "size": int(f["size"]) if f.get("size") else None,
                "mime_type": f.get("mimeType"),
                "web_view_link": f.get("webViewLink"),
                "created_time": f.get("createdTime"),
                "parents": f.get("parents", []),
            }
            for f in res.get("files", [])
        ]

    def delete(self, file_id: str) -> None:
        """Перемещает файл в корзину Drive (через files.delete — Drive это hard-delete для drive.file scope)."""
        try:
            self._svc().files().delete(fileId=file_id).execute()
        except HttpError as e:
            raise GDriveError(f"delete failed (file_id={file_id}): {e}") from e

    def ensure_folder(self, name: str, parent_id: Optional[str] = None) -> str:
        """
        Возвращает folder_id папки с именем name (создаёт если нет).
        Идемпотентно. Полезно для структуры {brand}/{shooting}/.
        """
        clauses = [
            f"mimeType = '{MIME_FOLDER}'",
            f"name = '{name.replace(chr(39), chr(92) + chr(39))}'",
            "trashed = false",
        ]
        if parent_id:
            clauses.append(f"'{parent_id}' in parents")
        q = " and ".join(clauses)

        try:
            res = self._svc().files().list(q=q, pageSize=1, fields="files(id)").execute()
            files = res.get("files", [])
            if files:
                return files[0]["id"]

            body: dict = {"name": name, "mimeType": MIME_FOLDER}
            if parent_id:
                body["parents"] = [parent_id]
            folder = self._svc().files().create(body=body, fields="id").execute()
            return folder["id"]
        except HttpError as e:
            raise GDriveError(f"ensure_folder failed (name={name}): {e}") from e

    def usage(self) -> dict:
        """
        Drive storage quota.
        :returns: {"used", "total", "remaining", "user_email"}; "total" может быть None для unlimited.
        """
        try:
            about = (
                self._svc()
                .about()
                .get(fields="user(emailAddress), storageQuota(usage, limit, usageInDrive)")
                .execute()
            )
        except HttpError as e:
            raise GDriveError(f"about.get failed: {e}") from e

        q = about.get("storageQuota", {})
        used = int(q.get("usage", 0))
        total_raw = q.get("limit")
        total = int(total_raw) if total_raw else None
        return {
            "used": used,
            "total": total,
            "remaining": (total - used) if total is not None else None,
            "user_email": about.get("user", {}).get("emailAddress"),
        }
