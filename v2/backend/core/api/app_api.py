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
from ..services.version_service import VersionService
from ..services.shooting_service import ShootingService
from ..services import permissions_service
from ..infra.c1_bridge import CaptureOneBridge
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
        self.version_service = VersionService()

        # Shoot mode wiring: ShootingService logs through _emit so JS gets a
        # push for every state transition (started/ended/aborted/event,
        # watcher.*, hotkey.*). We mangle '.' into '_' so the dispatched
        # JS callbacks have plain identifiers.
        def _shoot_emit(name: str, payload: dict) -> None:
            self._emit("onShoot_" + name.replace(".", "_"), payload)
        self.c1_bridge = CaptureOneBridge()
        self.shooting_service = ShootingService(
            event_logger=_shoot_emit, bridge=self.c1_bridge
        )

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
            webview.FileDialog.FOLDER, directory="", allow_multiple=False
        )
        return result[0] if result else None

    def select_file(self, file_types: tuple = ("Text files (*.txt)",)) -> str | None:
        if not self._window:
            return None
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN, directory="", allow_multiple=False, file_types=file_types
        )
        return result[0] if result else None

    def get_config_value(self, key: str) -> str:
        """Прочитать значение из config.json (лежит в v2/frontend/).

        Ищет config.json в нескольких местах относительно backend/.
        Возвращает значение ключа или пустую строку.
        """
        candidates = [
            Path(__file__).resolve().parent.parent.parent.parent / "frontend" / "config.json",  # v2/frontend/config.json
            Path.cwd() / ".." / "frontend" / "config.json",
            Path.cwd() / "config.json",
            Path.cwd().parent / "config.json",
        ]
        for p in candidates:
            try:
                p = p.resolve()
                if p.exists():
                    import json
                    cfg = json.loads(p.read_text(encoding="utf-8"))
                    val = cfg.get(key, "")
                    if val:
                        return val
            except Exception:
                continue
        return ""

    def read_text_file(self, path: str) -> str:
        try:
            return Path(path).read_text(encoding="utf-8")
        except Exception as e:
            return f"ERROR: {e}"

    def save_text_to_file(self, content: str, suggested_name: str = "project.json") -> dict:
        """Сохранить текст в файл через нативный диалог.

        Используется фронтендом для сохранения полного проекта (включая артикулы).

        Args:
            content: текстовое содержимое для записи
            suggested_name: предложенное имя файла

        Returns:
            {"ok": True, "path": str} | {"cancelled": True} | {"error": str}
        """
        if not self._window:
            return {"error": "Нет окна"}
        try:
            result = self._window.create_file_dialog(
                webview.FileDialog.SAVE,
                directory="",
                save_filename=suggested_name,
            )
            if result:
                path = Path(result) if isinstance(result, str) else Path(result[0])
                path.write_text(content, encoding="utf-8")
                return {"ok": True, "path": str(path)}
            return {"cancelled": True}
        except Exception as e:
            return {"error": str(e)}

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

    def load_native_paths(self, paths: list) -> dict:
        """Загрузить превью по абсолютным путям (desktop-only drag-and-drop).

        Используется когда пользователь тащит файлы/папки из Finder или
        Capture One — там приходят обычные file:// URI с реальными путями
        на диске, и мы можем прочитать байты напрямую без HTML5 File API.

        Запускается в отдельном потоке. Push-события:
          onNativeDropProgress({loaded, total, pct})
          onNativeDropDone({total, loaded, items: [...]})

        Args:
            paths: список абсолютных путей (файлы или папки).

        Returns:
            {"status": "started", "expected": N} — сразу; результат придёт
            через onNativeDropDone.
        """
        from ..services.preview_service import IMAGE_EXTENSIONS

        # Разворачиваем папки в файлы, сохраняем порядок, фильтруем по расширению
        collected: list[Path] = []
        seen: set[str] = set()
        for raw in paths or []:
            try:
                p = Path(raw)
            except Exception:
                continue
            if not p.exists():
                continue
            if p.is_dir():
                for f in sorted(p.rglob("*"), key=lambda x: str(x).lower()):
                    if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS:
                        key = str(f.resolve())
                        if key not in seen:
                            seen.add(key)
                            collected.append(f)
            elif p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS:
                key = str(p.resolve())
                if key not in seen:
                    seen.add(key)
                    collected.append(p)

        total = len(collected)

        def task(files: list):
            items: list[dict] = []
            for i, fp in enumerate(files, 1):
                try:
                    item = self.preview_service._make_preview(fp)
                    if item:
                        items.append(item.to_dict())
                except Exception as e:
                    print(f"[load_native_paths] failed on {fp}: {e}")
                pct = round(i / total * 100) if total else 0
                self._emit("onNativeDropProgress", {
                    "loaded": i, "total": total, "pct": pct
                })
            self._emit("onNativeDropDone", {
                "total": total, "loaded": len(items), "items": items,
            })

        if total == 0:
            self._emit("onNativeDropDone", {
                "total": 0, "loaded": 0, "items": [],
            })
            return {"status": "done", "expected": 0}

        threading.Thread(target=task, args=(collected,), daemon=True).start()
        return {"status": "started", "expected": total}

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
            webview.FileDialog.SAVE,
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
            webview.FileDialog.OPEN,
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
                webview.FileDialog.OPEN,
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
            result["file"] = path
            self._emit("onArticleParseDone", result)

        if not file_path:
            if not self._window:
                return {"error": "Нет окна"}
            result = self._window.create_file_dialog(
                webview.FileDialog.OPEN,
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

    # ── Версии фото (постпродакшн) ──

    def version_set_session(self, session_dir: str) -> dict:
        """Установить корень сессии Capture One для поиска COS-файлов.

        Вызывается при открытии проекта или выборе папки сессии.
        """
        p = Path(session_dir)
        if not p.exists():
            return {"error": f"Папка не найдена: {session_dir}"}
        self.version_service.set_session_root(p)
        return {"ok": True, "path": session_dir}

    def version_collect_cos(self, photo_stem: str) -> dict:
        """Собрать COS-файл для фото (base64 + метаданные).

        Используется при загрузке версии ЦК: фронт получает COS как base64,
        потом загружает в Supabase Storage через JS SDK.

        Returns:
            {"cos_base64": str, "cos_filename": str, "cos_size_bytes": int}
            или {"error": "..."}
        """
        result = self.version_service.collect_cos_for_photo(photo_stem)
        if result:
            return result
        return {"error": f"COS не найден для {photo_stem}"}

    def version_read_preview(self, jpeg_path: str) -> dict:
        """Прочитать JPEG превью версии с диска (base64).

        Пользователь экспортирует JPEG из Capture One,
        фронт получает base64 и загружает в Supabase Storage.

        Returns:
            {"preview_base64": str, "filename": str, "size_bytes": int}
            или {"error": "..."}
        """
        result = self.version_service.read_preview_jpeg(jpeg_path)
        if result:
            return result
        return {"error": f"Файл не найден: {jpeg_path}"}

    def version_select_preview(self) -> dict:
        """Выбрать JPEG превью через нативный диалог и прочитать.

        Объединяет select_file + read_preview для удобства фронта.
        """
        if not self._window:
            return {"error": "Нет окна"}
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            directory="",
            allow_multiple=False,
            file_types=("JPEG images (*.jpg;*.jpeg)",),
        )
        if not result:
            return {"cancelled": True}
        file_path = result[0] if isinstance(result, (list, tuple)) else result
        preview = self.version_service.read_preview_jpeg(file_path)
        if preview:
            return preview
        return {"error": f"Не удалось прочитать: {file_path}"}

    def version_restore_cos(self, photo_stem: str, cos_base64: str, target_dir: str = "") -> dict:
        """Восстановить COS-файл на диск из base64 (скачанного из Storage).

        Capture One подхватит файл автоматически.
        Перед перезаписью создаёт .bak если его нет.

        Returns:
            {"ok": True, "path": str} или {"error": "..."}
        """
        try:
            path = self.version_service.restore_cos_to_disk(
                photo_stem, cos_base64, target_dir or None
            )
            if path:
                return {"ok": True, "path": path}
            return {"error": "Не удалось определить папку для COS"}
        except Exception as e:
            return {"error": str(e)}

    def pdf_pages_to_images(self, file_path: str) -> dict:
        """Конвертировать страницы PDF в base64 JPEG (для AI Vision).

        Returns:
            {"pages": ["data:image/jpeg;base64,...", ...], "total": int}
        """
        import base64
        import io
        try:
            import pdfplumber
            from PIL import Image
        except ImportError:
            return {"error": "pdfplumber/Pillow не установлен"}

        path = Path(file_path)
        if not path.exists():
            return {"error": f"Файл не найден: {file_path}"}

        pages_b64: list[str] = []
        try:
            with pdfplumber.open(str(path)) as pdf:
                for page in pdf.pages:
                    img = page.to_image(resolution=300).original
                    buf = io.BytesIO()
                    if img.mode in ("RGBA", "P"):
                        img = img.convert("RGB")
                    img.save(buf, format="JPEG", quality=80)
                    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
                    pages_b64.append(f"data:image/jpeg;base64,{b64}")
        except Exception as e:
            return {"error": str(e)}

        return {"pages": pages_b64, "total": len(pages_b64)}

    # ── Shoot mode ──

    def shoot_pick_session(self) -> dict:
        """Open a folder picker for the Capture One session root.

        Returns {"path": str} or {"cancelled": True}. Frontend then calls
        shoot_start_session with the chosen path.
        """
        print("[shoot] shoot_pick_session: opening folder dialog", flush=True)
        if not self._window:
            print("[shoot] ERROR: no window", flush=True)
            return {"error": "Нет окна"}
        try:
            result = self._window.create_file_dialog(
                webview.FileDialog.FOLDER, directory="", allow_multiple=False
            )
            print(f"[shoot] dialog returned: {result!r}", flush=True)
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"[shoot] dialog ERROR: {e!r}", flush=True)
            return {"error": f"dialog: {e}"}
        if not result:
            return {"cancelled": True}
        path = result[0] if isinstance(result, (list, tuple)) else result
        print(f"[shoot] picked path: {path}", flush=True)
        return {"path": str(path)}

    def shoot_start_session(self, session_path: str, project_id: str | None = None) -> dict:
        """Begin a shoot session. Records start_time in UTC."""
        print(f"[shoot] shoot_start_session called: path={session_path!r} project_id={project_id!r}", flush=True)
        if not session_path:
            print("[shoot] ERROR: empty session_path", flush=True)
            return {"error": "Не указан путь до сессии"}
        try:
            session = self.shooting_service.start_session(session_path, project_id)
            print(f"[shoot] session started: id={session.id}", flush=True)
            return {"ok": True, "session": session.to_dict()}
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"[shoot] start_session ERROR: {e!r}", flush=True)
            return {"error": str(e)}

    def shoot_end_session(self, session_id: str) -> dict:
        """Close the shoot session normally."""
        try:
            session = self.shooting_service.end_session(session_id)
            return {"ok": True, "session": session.to_dict()}
        except KeyError as e:
            return {"error": str(e)}

    def shoot_abort_session(self, session_id: str) -> dict:
        """Abort an active shoot session (no completion event)."""
        try:
            session = self.shooting_service.abort_session(session_id)
            return {"ok": True, "session": session.to_dict()}
        except KeyError as e:
            return {"error": str(e)}

    def shoot_get_active(self) -> dict | None:
        active = self.shooting_service.get_active()
        if active is None:
            return None
        return active.to_dict()

    def shoot_c1_status(self) -> dict:
        """Cheap status snapshot for the shoot view (is C1 running, path)."""
        return {
            "is_running": self.c1_bridge.is_running(),
            "session_path": self.c1_bridge.get_session_path(),
        }

    def shoot_export_previews(self) -> dict:
        """Trigger Capture One to Process variants matching shoot-mode
        selection criteria using a Maket-CP-managed recipe (created /
        configured from this script — NOT C1's active recipe).

        Маша 2026-05-02: «нужен не активный рецепт а скриптом задавать
        нужные настройки экспорта прямо из макета».

        Selection criteria (OR):
          - rating >= 1, OR
          - variant has any keyword starting with "_card:" (added by
            shoot-mode hotkey when user pulls a variant into a card)

        Output goes wherever C1's currently-active recipe is configured to
        write — not into a Maket-CP-controlled folder. Маша's preference:
        Output folder shouldn't fill up. So the recipe should be set to
        either an ephemeral location (e.g. /tmp/MaketCP_Previews/) or to
        ~/Library/Application Support/MaketCP/previews/<session>/. The
        upcoming auto-pull half of this feature will discover those JPGs
        wherever they land via watchdog events on the session root.

        Returns {ok, count, recipe_hint} or {error}.
        """
        try:
            app = self.c1_bridge._app_name or self.c1_bridge._detect_app_name()
            if not app:
                return {"error": "Capture One не запущен или AppleScript-доступ не выдан"}

            # Maket-CP-managed recipe: create or update with our settings.
            # JPEG, sRGB, ~1920px long edge, output to a session-relative
            # subfolder so the watcher trivially picks up JPGs without us
            # configuring a global path.
            recipe_name = "Maket CP Preview"
            sub_folder = "MaketCP_Previews"

            # Selection: rating >= 1 OR has any _card:* keyword.
            # We then dedupe via AppleScript `does not contain`.
            # Recipe configuration uses the most common C1 property names —
            # if any is unrecognized in your C1 version, the property
            # assignment is wrapped in its own try so the rest still runs.
            script = (
                f'on hasCardKeyword(v)\n'
                f'  try\n'
                f'    tell application "{app}"\n'
                f'      repeat with k in (keywords of v)\n'
                f'        if (name of k as text) starts with "_card:" then return true\n'
                f'      end repeat\n'
                f'    end tell\n'
                f'  end try\n'
                f'  return false\n'
                f'end hasCardKeyword\n'
                f'tell application "{app}"\n'
                f'  try\n'
                f'    set doc to current document\n'
                f'  on error\n'
                f'    return "no current document — open a session in C1 first"\n'
                f'  end try\n'
                f'  -- Find or create our recipe.\n'
                f'  set r to missing value\n'
                f'  try\n'
                f'    set r to (first recipe of doc whose name is "{recipe_name}")\n'
                f'  end try\n'
                f'  if r is missing value then\n'
                f'    try\n'
                f'      set r to make new recipe at end of recipes of doc with properties {{name:"{recipe_name}"}}\n'
                f'    on error errMake\n'
                f'      return ("create recipe: " & errMake)\n'
                f'    end try\n'
                f'  end if\n'
                f'  -- Configure recipe; each setter wrapped in its own try.\n'
                f'  try\n'
                f'    set output format of r to JPEG\n'
                f'  end try\n'
                f'  try\n'
                f'    set output sub folder of r to "{sub_folder}"\n'
                f'  end try\n'
                f'  try\n'
                f'    set color space of r to "sRGB"\n'
                f'  end try\n'
                f'  try\n'
                f'    set jpeg quality of r to 85\n'
                f'  end try\n'
                f'  try\n'
                f'    set scaling of r to long edge\n'
                f'  end try\n'
                f'  try\n'
                f'    set scale value of r to 1920\n'
                f'  end try\n'
                f'  try\n'
                f'    set enabled of r to true\n'
                f'  end try\n'
                f'  -- Build target list (rating>=1 ∪ has _card: keyword).\n'
                f'  set picked to {{}}\n'
                f'  set rated to (variants of doc whose rating >= 1)\n'
                f'  repeat with v in rated\n'
                f'    set end of picked to v\n'
                f'  end repeat\n'
                f'  repeat with v in (variants of doc)\n'
                f'    if my hasCardKeyword(v) then\n'
                f'      if picked does not contain v then set end of picked to v\n'
                f'    end if\n'
                f'  end repeat\n'
                f'  if (count of picked) is 0 then return "no variants matched (rating>=1 or _card: keyword)"\n'
                f'  -- Process with our recipe specifically.\n'
                f'  try\n'
                f'    process picked with recipe r\n'
                f'  on error errProc\n'
                f'    -- Some C1 versions use `using recipe`. Fallback.\n'
                f'    try\n'
                f'      process picked using recipe r\n'
                f'    on error\n'
                f'      return ("process: " & errProc)\n'
                f'    end try\n'
                f'  end try\n'
                f'  return ("queued:" & (count of picked))\n'
                f'end tell'
            )
            raw = self.c1_bridge._run_script(script).strip()
            if not raw:
                return {"error": "пустой ответ AppleScript (Capture One не отвечает)"}
            if raw.startswith("queued:"):
                try:
                    count = int(raw.split(":", 1)[1])
                except Exception:
                    count = 0
                return {
                    "ok": True,
                    "count": count,
                    "recipe": recipe_name,
                    "output_subfolder": sub_folder,
                }
            return {"error": raw}
        except Exception as e:
            return {"error": str(e)}

    def shoot_get_thumb(self, image_path: str, max_edge: int = 600) -> dict:
        """Read a thumbnail for a photo and return as base64 data URL.

        Why: WebKit (pywebview's WKWebView on macOS) blocks
        ``file://`` <img> loads from a different directory than the page,
        so we shuttle JPEG bytes through Python and inject as base64.

        Source priority — Маша 2026-05-02 «найти где превью которые
        Capture One рендерит» — мы хотим картинку с применёнными
        Color Correction'ами C1, не голую RAW-декодировку:

        1. **Capture One thumbnail cache** at
           ``<session>/Capture/CaptureOne/Cache/Thumbnails/<name>.<uuid>.cot``.
           These are standard JPEGs (~300x450) with C1's CC applied —
           fastest, smallest, и уже с правильными цветами.
        2. **Capture One proxy** ``.cop`` — JPEG XL, нужен pillow-jxl;
           пропускаем пока (пишем в TODO).
        3. **Source JPG** via Pillow — when the original is itself a JPG
           with no C1 cache yet (rare on a session that's been opened in C1).
        4. **macOS sips** — fallback for raw CR3/ARW/NEF/RAF; uses
           Apple's RAW pipeline (no CC, but at least renders something).

        Returns ``{data_url, width, height, source}`` or ``{error: ...}``.
        ``source`` is one of ``"c1_thumb" | "pillow" | "sips"`` so the
        UI can show a hint when CC isn't available yet.
        Never raises.
        """
        print(f"[shoot_get_thumb] called: path={image_path!r}", flush=True)
        try:
            p = Path(image_path)
        except Exception as e:
            return {"error": f"bad path: {e}"}
        if not p.exists():
            return {"error": "file not found"}

        edge = max(64, min(int(max_edge), 2000))

        from PIL import Image, ImageOps
        import io
        import base64

        def _encode(img, source: str) -> dict:
            try:
                img = ImageOps.exif_transpose(img)
            except Exception:
                pass
            if img.mode in ("RGBA", "P", "LA"):
                img = img.convert("RGB")
            # Image.thumbnail only downsizes. When the source is smaller
            # than the requested edge (typical for .cot ~300x450 vs a 600
            # request), explicitly LANCZOS-upscale so the browser doesn't
            # nearest-neighbor-stretch and pixelate. We don't gain real
            # detail but the result reads cleanly at card-slot sizes.
            longest = max(img.width, img.height)
            if longest < edge:
                scale = edge / float(longest)
                new_size = (int(round(img.width * scale)), int(round(img.height * scale)))
                img = img.resize(new_size, Image.LANCZOS)
            else:
                img.thumbnail((edge, edge), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=82, optimize=True)
            return {
                "data_url": "data:image/jpeg;base64,"
                            + base64.b64encode(buf.getvalue()).decode("ascii"),
                "width": img.width,
                "height": img.height,
                "source": source,
            }

        import subprocess
        import tempfile

        def _read_c1_rotation(image_path: Path) -> int:
            """Read the `Rotation` field from C1's .cos sidecar.

            Layout: <session>/Capture/CaptureOne/Settings<N>/<image.name>.cos
            <N> varies (Settings82, Settings1670, etc.) so we glob.
            Returns 0 / 90 / 180 / 270, or 0 on any failure.
            """
            try:
                cap_co = image_path.parent / "CaptureOne"
                if not cap_co.is_dir():
                    return 0
                target = image_path.name + ".cos"
                for settings_dir in cap_co.iterdir():
                    if not settings_dir.is_dir():
                        continue
                    if not settings_dir.name.startswith("Settings"):
                        continue
                    cos_path = settings_dir / target
                    if cos_path.exists() and not cos_path.name.startswith("._"):
                        import xml.etree.ElementTree as ET
                        try:
                            root = ET.fromstring(cos_path.read_bytes())
                        except Exception:
                            return 0
                        rotation = 0
                        for elem in root.iter("E"):
                            if elem.get("K") == "Rotation":
                                try:
                                    rotation = int(elem.get("V") or "0") % 360
                                except (TypeError, ValueError):
                                    rotation = 0
                                # Don't break — last value wins, mirroring
                                # cos_repository.read_metadata's fix for
                                # multi-entry Basic_Rating quirk.
                        return rotation
            except Exception:
                pass
            return 0

        def _sips_to_jpg(src: Path, dst: Path) -> bool:
            """Run macOS sips to decode any image (incl. JXL `.cop`, RAW)
            into a temp JPEG sized to fit `edge`. Returns True on success."""
            try:
                cp = subprocess.run(
                    [
                        "sips",
                        "-s", "format", "jpeg",
                        "-Z", str(edge),
                        str(src),
                        "--out", str(dst),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
                return cp.returncode == 0 and dst.exists()
            except Exception:
                return False

        # ── Stage 1: Capture One Thumbnails (.cot — only source with CC) ────
        # Маша 2026-05-02: «явно смещённый ББ и отсутствуют коррекции»
        # после .cop захода. Diagnosed: .cop is the camera-embedded JPEG
        # that C1 stores as-is for fast loading, NOT a C1-rendered output.
        # CC is applied live in C1's viewer over the .cop. Reading .cop
        # natively (даже с ICC-конверсией) даёт исходник без ЦК.
        #
        # .cot is the only on-disk source where C1 has actually baked CC
        # in — it's the small grid thumbnail. Resolution is ~300x450, so
        # for bigger card slots / lightbox we'd need either:
        #   1. trigger C1 Process Recipe per photo (slow, queue-based), or
        #   2. C1's "Optimized previews" preference re-generating bigger
        #      .cot files (Маша parallel set the quality preference,
        #      should propagate as those previews rebuild).
        # Until either lands, .cot stays primary.
        try:
            thumbs_dir = p.parent / "CaptureOne" / "Cache" / "Thumbnails"
            if thumbs_dir.is_dir():
                candidates = sorted(
                    [c for c in thumbs_dir.glob(p.name + ".*.cot")
                     if not c.name.startswith("._")]
                )
                if candidates:
                    img = Image.open(candidates[0])
                    img.load()
                    return _encode(img, "c1_thumb")
        except Exception:
            pass

        # ── Stage 3: Pillow direct (source JPG/PNG/TIFF) ─────────
        try:
            img = Image.open(p)
            img.load()
            return _encode(img, "pillow")
        except Exception:
            pass

        # ── Stage 4: macOS sips fallback (CR3/ARW/NEF/RAF) ──────
        # Last resort — no CC, just a renderable preview from RAW.
        try:
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                tmp_path = Path(tmp.name)
            try:
                if not _sips_to_jpg(p, tmp_path):
                    return {"error": "sips failed (raw fallback)"}
                img = Image.open(tmp_path)
                img.load()
                return _encode(img, "sips")
            finally:
                try:
                    tmp_path.unlink(missing_ok=True)
                except Exception:
                    pass
        except Exception as e:
            return {"error": f"thumb (raw fallback): {e}"}

    def shoot_c1_session_path(self) -> dict:
        """Return the current C1 document path, or {error: ...}.

        Frontend uses this to skip the FilePicker when C1 already has a
        session open. Falls through to manual pick when bridge denies.
        """
        path = self.c1_bridge.get_session_path()
        if path:
            return {"path": path}
        return {"error": "Capture One не запущен или не выдан Automation access"}

    def shoot_hotkey_smoke(self) -> dict:
        """Manual smoke trigger for the hotkey path.

        Mirrors what Cmd+Shift+C does on the active session: read selected
        variants from the bridge, mint a card_id, write keywords. Useful
        for testing without granting Accessibility, OR when the bridge is
        denied — caller can verify the wiring end-to-end.
        """
        if self.shooting_service._hotkey is None:
            return {"error": "no active shoot session"}
        # Direct call to the same _fire path the listener uses.
        self.shooting_service._hotkey._fire()
        return {"ok": True}

    # ── Permissions (first-run flow) ──

    def permissions_check_all(self) -> dict:
        """Snapshot all three permission checks for the JS modal."""
        return permissions_service.check_all()

    def permissions_check(self, name: str) -> dict:
        """Re-check a single permission by name.

        name ∈ {"accessibility", "input_monitoring", "automation_capture_one"}.
        """
        fn = {
            "accessibility": permissions_service.check_accessibility,
            "input_monitoring": permissions_service.check_input_monitoring,
            "automation_capture_one": permissions_service.check_automation_capture_one,
        }.get(name)
        if not fn:
            return {"error": f"Unknown permission: {name}"}
        return {"name": name, "granted": bool(fn())}

    def permissions_open_settings(self, name: str) -> dict:
        """Open System Settings deep-link for a denied permission."""
        ok = permissions_service.open_settings_for_permission(name)
        return {"ok": ok, "name": name}
