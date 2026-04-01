"""AppAPI — bridge между JS (frontend) и Python (backend).

Регистрируется в pywebview через js_api=, доступен из JS как window.pywebview.api.*
Имеет ссылку на window для нативных диалогов и push-событий.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

import webview

from ..services.rate_setter import RateSetterService
from ..services.card_service import CardService
from ..services.project_service import ProjectService
from ..services.preview_service import PreviewService
from ..services.article_service import ArticleService
from ..domain.project import Project
from ..domain.card import CardTemplate


class AppAPI:
    """Python-бэкенд, доступен из JS через window.pywebview.api.*"""

    def __init__(self):
        self._window: webview.Window | None = None
        self.rate_setter = RateSetterService()
        self.card_service = CardService()
        self.project_service = ProjectService()
        self.preview_service = PreviewService()
        self.article_service = ArticleService()
        self._project: Project | None = None

    def set_window(self, window: webview.Window) -> None:
        """Устанавливается после создания окна."""
        self._window = window

    # ── Push-события ──

    def _emit(self, event_name: str, data) -> None:
        """Универсальный push из Python в JS."""
        if self._window:
            self._window.evaluate_js(f"window.{event_name}({json.dumps(data)})")

    # ── Системные ──

    def ping(self) -> str:
        return "pong"

    def select_folder(self, title: str = "Выберите папку") -> str | None:
        if not self._window:
            return None
        result = self._window.create_file_dialog(
            webview.FOLDER_DIALOG, directory="", allow_multiple=False
        )
        return result[0] if result else None

    def select_file(self, file_types: tuple = ("Text files (*.txt)",)) -> str | None:
        if not self._window:
            return None
        result = self._window.create_file_dialog(
            webview.OPEN_DIALOG, directory="", allow_multiple=False, file_types=file_types
        )
        return result[0] if result else None

    def read_text_file(self, path: str) -> str:
        try:
            return Path(path).read_text(encoding="utf-8")
        except Exception as e:
            return f"ERROR: {e}"

    # ── Rate Setter ──

    def rate_setter_run(self, payload: dict) -> dict:
        """Запуск в отдельном потоке с push-прогрессом."""

        def task():
            mode = payload.get("mode", "folder")
            strip_tails = payload.get("strip_tails", False)

            if mode == "folder":
                source_dir = Path(payload.get("source_dir", ""))
                if not source_dir.exists():
                    self._emit("onRateSetterDone", {"error": "Папка источника не найдена"})
                    return
                stems = self.rate_setter.collect_source_stems(source_dir, strip_tails=strip_tails)
            else:
                text = payload.get("text_list", "")
                stems = self.rate_setter.parse_stems_from_text(text, strip_tails=strip_tails)
                if not stems:
                    self._emit("onRateSetterDone", {"error": "Список имён пуст"})
                    return

            session_root = Path(payload.get("session_dir", ""))
            if not session_root.exists():
                self._emit("onRateSetterDone", {"error": "Папка сессии не найдена"})
                return

            def log(msg: str):
                self._emit("onRateSetterLog", msg)

            result = self.rate_setter.run(stems=stems, session_root=session_root, log=log)
            self._emit("onRateSetterDone", result)

        threading.Thread(target=task, daemon=True).start()
        return {"status": "started"}

    # ── Превью ──

    def scan_preview_folder(self, folder_path: str = "") -> dict:
        """Выбрать папку (если не указана) и сканировать превью.

        Запускается в отдельном потоке. Push-события:
          onPreviewProgress({loaded, total, pct})
          onPreviewDone({folder, total, loaded, items: [{name, path, thumb, w, h}]})
        """
        def task(path: str):
            def on_progress(loaded: int, total: int):
                pct = round(loaded / total * 100) if total else 0
                self._emit("onPreviewProgress", {
                    "loaded": loaded, "total": total, "pct": pct
                })

            result = self.preview_service.scan_folder(path, on_progress=on_progress)
            self._emit("onPreviewDone", result.to_dict())

        if not folder_path:
            # Открываем нативный диалог выбора папки
            folder_path = self.select_folder("Выберите папку с превью")
            if not folder_path:
                return {"cancelled": True}

        threading.Thread(target=task, args=(folder_path,), daemon=True).start()
        return {"status": "started", "folder": folder_path}

    def get_full_image(self, path: str) -> dict:
        """Получить полное изображение по пути (для слотов карточек)."""
        data_url = self.preview_service.get_full_image(path)
        if data_url:
            return {"ok": True, "dataUrl": data_url}
        return {"error": "Файл не найден"}

    # ── Проект ──

    def new_project(self, brand: str, shoot_date: str, template_name: str = "h3") -> dict:
        """Создать новый проект."""
        templates = {
            "h2": CardTemplate.horizontal_plus_verticals(2),
            "h3": CardTemplate.horizontal_plus_verticals(3),
            "h4": CardTemplate.horizontal_plus_verticals(4),
            "v4": CardTemplate.all_vertical(4),
            "v5": CardTemplate.all_vertical(5),
            "v6": CardTemplate.all_vertical(6),
        }
        template = templates.get(template_name, templates["h3"])
        self._project = self.project_service.create(brand, shoot_date, template)
        return self.project_service.to_dict(self._project)

    def save_project(self) -> dict:
        """Сохранить проект через файловый диалог."""
        if not self._project or not self._window:
            return {"error": "Нет проекта"}
        result = self._window.create_file_dialog(
            webview.SAVE_DIALOG,
            directory="",
            save_filename=f"{self._project.brand}_{self._project.shoot_date}.json",
        )
        if result:
            path = Path(result) if isinstance(result, str) else Path(result[0])
            self.project_service.save(self._project, path)
            return {"ok": True, "path": str(path)}
        return {"cancelled": True}

    def load_project(self) -> dict:
        """Загрузить проект через файловый диалог."""
        if not self._window:
            return {"error": "Нет окна"}
        result = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            directory="",
            allow_multiple=False,
            file_types=("JSON files (*.json)",),
        )
        if result:
            path = Path(result[0]) if isinstance(result, (list, tuple)) else Path(result)
            self._project = self.project_service.load(path)
            return self.project_service.to_dict(self._project)
        return {"cancelled": True}

    def get_project(self) -> dict | None:
        """Получить текущий проект."""
        if not self._project:
            return None
        return self.project_service.to_dict(self._project)

    # ── Артикулы ──

    def parse_article_file(self, file_path: str = "") -> dict:
        """Парсить файл с артикулами (PDF/JSON/CSV/XLSX).

        Если file_path пустой — открывает нативный диалог выбора файла.
        PDF: извлекает артикулы + каталожные изображения (base64).
        JSON/CSV/XLSX: извлекает артикулы из таблицы.

        Returns:
            {"articles": [{sku, category, color, refImage}], "total": int}
            или {"error": "..."}
        """
        if not file_path:
            if not self._window:
                return {"error": "Нет окна"}
            result = self._window.create_file_dialog(
                webview.OPEN_DIALOG,
                directory="",
                allow_multiple=False,
                file_types=(
                    "PDF (*.pdf)",
                    "JSON (*.json)",
                    "CSV (*.csv)",
                    "TXT (*.txt)",
                    "Excel (*.xlsx)",
                ),
            )
            if not result:
                return {"cancelled": True}
            file_path = result[0] if isinstance(result, (list, tuple)) else result

        return self.article_service.parse_file(file_path)

    def parse_article_pdf_async(self, file_path: str = "") -> dict:
        """Асинхронная версия для больших PDF (с прогрессом).

        Push-события:
          onArticleParseDone({articles: [...], total: int})
          или onArticleParseDone({error: "..."})
        """
        def task(path: str):
            result = self.article_service.parse_file(path)
            self._emit("onArticleParseDone", result)

        if not file_path:
            if not self._window:
                return {"error": "Нет окна"}
            result = self._window.create_file_dialog(
                webview.OPEN_DIALOG,
                directory="",
                allow_multiple=False,
                file_types=(
                    "PDF (*.pdf)",
                    "JSON (*.json)",
                    "CSV (*.csv)",
                    "TXT (*.txt)",
                    "Excel (*.xlsx)",
                ),
            )
            if not result:
                return {"cancelled": True}
            file_path = result[0] if isinstance(result, (list, tuple)) else result

        import threading
        threading.Thread(target=task, args=(file_path,), daemon=True).start()
        return {"status": "started", "file": file_path}
