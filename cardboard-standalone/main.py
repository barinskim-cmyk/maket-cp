#!/usr/bin/env python3
"""
Cardboard — desktop-запуск (pywebview).

Локальный инструмент вёрстки карточек товара. Ничего не копирует и не
создаёт лишних файлов: фотографии остаются на своих местах, приложение
хранит только пути к ним. Миниатюры генерируются в памяти (RAM-кэш)
и на диск не пишутся. Единственный файл, который создаёт приложение, —
файл проекта `имя.cardboard` (JSON: пути к фото + структура карточек).

Запуск: python3 main.py
Зависимости: pywebview, Pillow (доустановятся сами при первом запуске).
"""
from __future__ import annotations

import base64
import io
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional


def _ensure_deps() -> None:
    """Доустановить зависимости при первом запуске, чтобы не лезть в терминал."""
    required = {"webview": "pywebview", "PIL": "Pillow"}
    missing = [pip for imp, pip in required.items() if not _importable(imp)]
    if missing:
        print(f"[Cardboard] Устанавливаю зависимости: {', '.join(missing)} ...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet"] + missing)
        print("[Cardboard] Готово.")


def _importable(name: str) -> bool:
    try:
        __import__(name)
        return True
    except ImportError:
        return False


if not getattr(sys, "frozen", False) and __name__ == "__main__":
    _ensure_deps()

from PIL import Image, ImageOps  # noqa: E402

IMG_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".tif", ".tiff", ".bmp"}
THUMB_SIDE = 1400   # макс. сторона миниатюры (хватает и для PDF-экспорта)
JPEG_Q = 85
FILE_TYPES = ("Изображения (*.jpg;*.jpeg;*.png;*.gif;*.webp;*.tif;*.tiff;*.bmp)",)
PROJ_TYPES = ("Проект Cardboard (*.cardboard)",)


def make_thumb(path: str) -> Optional[dict]:
    """Прочитать изображение с диска и вернуть миниатюру как base64 dataURL.

    Ничего не пишет на диск. Возвращает None, если файл не читается.
    """
    try:
        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im)
            im.thumbnail((THUMB_SIDE, THUMB_SIDE))
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=JPEG_Q)
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            return {"dataUrl": "data:image/jpeg;base64," + b64, "w": im.width, "h": im.height}
    except Exception:
        return None


class CardboardAPI:
    """Мост JS <-> Python. Все методы вызываются из frontend через pywebview."""

    def __init__(self) -> None:
        self._window = None                 # webview.Window, задаётся при старте
        self._thumb_cache: dict = {}        # path -> {dataUrl, w, h} (только RAM)
        self._watch_dir: Optional[str] = None
        self._watch_seen: set = set()
        self._project_path: Optional[str] = None
        self._dirty: bool = False           # есть несохранённые изменения
        self._native_menu: bool = False     # удалось ли собрать нативное меню

    # ---------- служебное ----------

    def ping(self) -> str:
        """Проверка живости моста (frontend определяет desktop-режим)."""
        return "cardboard"

    def set_dirty(self, dirty: bool) -> None:
        """Frontend сообщает о несохранённых изменениях (для диалога при выходе)."""
        self._dirty = bool(dirty)

    def set_title(self, title: str) -> None:
        """Имя проекта в заголовке окна (топбар лаконичный, имени там нет)."""
        if self._window:
            self._window.set_title(str(title)[:120])

    def has_native_menu(self) -> bool:
        """Frontend спрашивает: есть ли нативное меню (тогда HTML-меню прячется)."""
        return self._native_menu

    def _thumb_cached(self, path: str) -> Optional[dict]:
        if path not in self._thumb_cache:
            t = make_thumb(path)
            if t is None:
                return None
            self._thumb_cache[path] = t
        return self._thumb_cache[path]

    def _import_paths(self, paths: list) -> list:
        """Пути -> список фото для frontend: name, path, размеры, миниатюра."""
        out = []
        for p in paths:
            if Path(p).suffix.lower() not in IMG_EXT:
                continue
            t = self._thumb_cached(p)
            if t is None:
                continue
            out.append({
                "name": Path(p).name,
                "path": str(p),
                "w": t["w"], "h": t["h"],
                "dataUrl": t["dataUrl"],
            })
        return out

    # ---------- импорт фото ----------

    def pick_photos(self) -> list:
        """Диалог выбора фото (мультивыбор). Возвращает список фото."""
        import webview
        result = self._window.create_file_dialog(
            webview.OPEN_DIALOG, allow_multiple=True, file_types=FILE_TYPES)
        return self._import_paths(list(result)) if result else []

    def pick_folder(self) -> list:
        """Диалог выбора папки — импорт всех изображений из неё (без подпапок)."""
        import webview
        result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return []
        folder = Path(result[0])
        paths = sorted(str(f) for f in folder.iterdir()
                       if f.is_file() and f.suffix.lower() in IMG_EXT)
        return self._import_paths(paths)

    def pick_folder_paths(self) -> list:
        """Диалог выбора папки — только СПИСОК путей, без миниатюр.

        Миниатюры frontend запрашивает батчами (import_dropped) и
        показывает прогресс: на больших съёмках (сотни кадров) один
        синхронный вызов замораживал интерфейс без обратной связи.
        """
        import webview
        result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return []
        folder = Path(result[0])
        return sorted(str(f) for f in folder.iterdir()
                      if f.is_file() and f.suffix.lower() in IMG_EXT)

    def import_dropped(self, paths: list) -> list:
        """Импорт файлов, брошенных drag-and-drop (пути передаёт frontend)."""
        return self._import_paths([p for p in paths if p])

    def thumbs_for(self, paths: list) -> dict:
        """Миниатюры для списка путей (при открытии проекта).

        Возвращает {path: {dataUrl,w,h} | None} — None, если файл пропал.
        """
        return {p: self._thumb_cached(p) for p in paths}

    # ---------- слежение за папкой (Capture One hot key) ----------

    def watch_pick(self) -> Optional[str]:
        """Выбрать папку для слежения. Уже лежащие файлы попадут в первый скан."""
        import webview
        result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return None
        self._watch_dir = result[0]
        self._watch_seen = set()
        return self._watch_dir

    def watch_stop(self) -> None:
        self._watch_dir = None
        self._watch_seen = set()

    def watch_scan(self) -> list:
        """Один проход по папке слежения: вернуть новые фото (frontend зовёт по таймеру)."""
        if not self._watch_dir or not os.path.isdir(self._watch_dir):
            return []
        fresh = []
        for f in sorted(Path(self._watch_dir).iterdir()):
            if f.is_file() and f.suffix.lower() in IMG_EXT and f.name not in self._watch_seen:
                self._watch_seen.add(f.name)
                fresh.append(str(f))
        return self._import_paths(fresh)

    # ---------- проект ----------

    def save_project(self, name: str, json_str: str, force_dialog: bool = False) -> Optional[str]:
        """Сохранить проект. Первый раз — диалог, дальше перезапись того же файла.

        Возвращает путь к файлу или None (пользователь отменил).
        """
        import webview
        path = self._project_path
        if path is None or force_dialog:
            result = self._window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=f"{name or 'Проект'}.cardboard",
                file_types=PROJ_TYPES)
            if not result:
                return None
            path = result if isinstance(result, str) else result[0]
            if not path.endswith(".cardboard"):
                path += ".cardboard"
        Path(path).write_text(json_str, encoding="utf-8")
        self._project_path = path
        return path

    def open_project(self) -> Optional[dict]:
        """Диалог открытия проекта. Возвращает {path, data(str)} или None."""
        import webview
        result = self._window.create_file_dialog(
            webview.OPEN_DIALOG, allow_multiple=False, file_types=PROJ_TYPES)
        if not result:
            return None
        path = result[0]
        try:
            data = Path(path).read_text(encoding="utf-8")
            json.loads(data)  # валидация
        except Exception:
            return {"path": path, "data": None}
        self._project_path = path
        return {"path": path, "data": data}

    def project_path(self) -> Optional[str]:
        return self._project_path

    def open_project_at(self, path: str) -> Optional[dict]:
        """Открыть проект по известному пути (лаунчер недавних проектов)."""
        try:
            data = Path(path).read_text(encoding="utf-8")
            json.loads(data)  # валидация
        except Exception:
            return None
        self._project_path = path
        return {"path": path, "data": data}

    def reveal(self, path: str) -> None:
        """Показать файл в Finder/Explorer."""
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-R", path])
        elif sys.platform.startswith("win"):
            subprocess.Popen(["explorer", "/select,", path])
        else:
            subprocess.Popen(["xdg-open", os.path.dirname(path)])


def find_frontend() -> Path:
    """Путь к index.html: рядом с main.py или внутри frozen-бандла (PyInstaller).

    ВАЖНО: .resolve() обязателен — в .app-бандле PyInstaller кладёт data-файлы
    в Resources и делает симлинк из Frameworks; WKWebView отказывается грузить
    file:// по симлинку, ведущему за пределы разрешённой папки (белое окно).
    """
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        candidate = base / "index.html"
        if candidate.exists():
            return candidate.resolve()
    return (Path(__file__).parent / "index.html").resolve()


def main() -> None:
    import webview

    api = CardboardAPI()
    html = find_frontend()
    window = webview.create_window(
        "Cardboard — вёрстка карточек",
        html.as_uri(),
        js_api=api,
        width=1440, height=900,
        min_size=(1000, 640),
    )
    api._window = window

    def on_closing() -> bool:
        """Диалоги при закрытии окна.

        1. Несохранённые изменения — предложить не терять их.
        2. Спросить, удалить ли файл проекта (по просьбе Маши: локальная
           версия — гарантия сохранности, но после работы можно подчистить).
        Возврат False отменяет закрытие.
        """
        if api._dirty:
            keep = window.create_confirmation_dialog(
                "Cardboard",
                "Есть несохранённые изменения. Закрыть без сохранения?")
            if not keep:
                return False
        if api._project_path and os.path.isfile(api._project_path):
            delete = window.create_confirmation_dialog(
                "Cardboard",
                "Удалить файл проекта?\n\n" + api._project_path +
                "\n\nOK — удалить файл, Cancel — оставить.")
            if delete:
                try:
                    os.remove(api._project_path)
                except OSError:
                    pass
        return True

    window.events.closing += on_closing

    def _diag() -> None:
        """CB_DIAG=1 — самопроверка после запуска: загрузился ли frontend."""
        import time
        time.sleep(5)
        try:
            print("DIAG READY:", window.evaluate_js("document.readyState"))
            print("DIAG TOPBAR:", window.evaluate_js(
                "document.querySelector('.cb-topbar') ? 'yes' : 'no'"))
            print("DIAG BRIDGE:", window.evaluate_js(
                "!!(window.pywebview && window.pywebview.api)"))
        except Exception as exc:   # noqa: BLE001
            print("DIAG FAIL:", exc)
        window.destroy()

    # Нативное меню (macOS: системный бар сверху — «где обычно Файл»).
    # Пункты дёргают JS-обработчики через evaluate_js; HTML-меню при этом
    # прячется (frontend спрашивает has_native_menu).
    menu = None
    try:
        import webview.menu as wm

        def _js(action: str):
            def _cb():
                window.evaluate_js(f'cbMenuNative("{action}")')
            return _cb

        menu = [
            wm.Menu("Файл", [
                wm.MenuAction("Новый проект", _js("new")),
                wm.MenuAction("Открыть проект", _js("open")),
                wm.MenuAction("Сохранить", _js("save")),
                wm.MenuAction("Переименовать проект", _js("rename")),
                wm.MenuSeparator(),
                wm.MenuAction("Импорт фото", _js("pick")),
                wm.MenuAction("Импорт референсов", _js("pickref")),
                wm.MenuAction("Импорт папки целиком", _js("folder")),
                wm.MenuAction("Следить за папкой (вкл/выкл)", _js("watch")),
                wm.MenuSeparator(),
                wm.MenuAction("Экспорт PDF", _js("pdf")),
                wm.MenuAction("Экспорт списка (CSV + TXT)", _js("list")),
            ]),
            wm.Menu("Шаблон", [
                wm.MenuAction("Создать шаблон", _js("tplnew")),
                wm.MenuAction("Галерея шаблонов", _js("tplgal")),
            ]),
            wm.Menu("Справка Cardboard", [
                wm.MenuAction("Инструкция", _js("helpguide")),
                wm.MenuAction("Синхронизация с Capture One", _js("helpsync")),
                wm.MenuAction("Другие продукты", _js("helpprod")),
            ]),
        ]
        api._native_menu = True
    except Exception:
        menu = None
        api._native_menu = False

    # Persistent storage: иначе pywebview (private_mode по умолчанию) стирает
    # localStorage при каждом запуске — пропадала бы библиотека шаблонов.
    home = Path.home()
    if sys.platform == "darwin":
        storage_dir = home / "Library" / "Application Support" / "Cardboard"
    elif sys.platform.startswith("win"):
        storage_dir = Path(os.environ.get("APPDATA", str(home))) / "Cardboard"
    else:
        storage_dir = home / ".config" / "Cardboard"
    start_kwargs = {"private_mode": False, "debug": "--debug" in sys.argv}
    if menu:
        start_kwargs["menu"] = menu
    try:
        storage_dir.mkdir(parents=True, exist_ok=True)
        start_kwargs["storage_path"] = str(storage_dir)
    except OSError:
        pass

    if os.environ.get("CB_DIAG"):
        print("DIAG HTML:", find_frontend())
        webview.start(_diag, **start_kwargs)
    else:
        webview.start(**start_kwargs)


if __name__ == "__main__":
    main()
