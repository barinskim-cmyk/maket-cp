#!/usr/bin/env python3
"""
Maket CP v2 — Entry Point.

Запуск: python main.py
Требует: pip install pywebview
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def _ensure_deps() -> None:
    """Автоматически доустановить зависимости при первом запуске.

    Проверяет наличие обязательных пакетов и ставит недостающие
    через pip, чтобы пользователю не приходилось заходить в терминал.
    """
    required = {
        "pdfplumber": "pdfplumber",
        "PIL": "Pillow",
        "openpyxl": "openpyxl",
    }
    missing = []
    for import_name, pip_name in required.items():
        try:
            __import__(import_name)
        except ImportError:
            missing.append(pip_name)

    if missing:
        print(f"[Maket CP] Устанавливаю зависимости: {', '.join(missing)} ...")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--quiet"] + missing
        )
        print("[Maket CP] Зависимости установлены.")


_ensure_deps()

import webview

from core.api.app_api import AppAPI

# ─── Пути ───

if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys._MEIPASS)
    APP_DIR = Path(os.path.dirname(sys.executable))
else:
    BASE_DIR = Path(__file__).resolve().parent
    APP_DIR = BASE_DIR

FRONTEND_DIR = APP_DIR.parent / "frontend"


def find_frontend(filename: str) -> Path | None:
    """Найти HTML-файл фронтенда."""
    candidates = [
        FRONTEND_DIR / filename,
        APP_DIR / filename,
        APP_DIR.parent / filename,
    ]
    for p in candidates:
        if p.exists():
            return p.resolve()
    return None


def main():
    api = AppAPI()

    index = find_frontend("index.html")
    if index:
        url = index.as_uri()
    else:
        url = None

    window = webview.create_window(
        title="Maket CP",
        url=url,
        js_api=api,  # стабильнее в PyInstaller чем window.expose()
        width=1440,
        height=860,
        min_size=(1000, 600),
    )

    api.set_window(window)

    webview.start(debug="--debug" in sys.argv)


if __name__ == "__main__":
    main()
