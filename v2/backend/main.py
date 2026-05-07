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
import threading
from datetime import datetime, timezone
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


# ─── Auto-update via git pull ───

def _update_log_path() -> Path:
    if sys.platform == "darwin":
        log_dir = Path.home() / "Library" / "Logs" / "Maket CP"
    elif sys.platform.startswith("win"):
        log_dir = Path(os.environ.get("APPDATA", str(Path.home()))) / "MaketCP" / "logs"
    else:
        log_dir = Path.home() / ".local" / "state" / "MaketCP" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / "update.log"


def _git_repo_root() -> Path | None:
    """Locate the git repo containing the running source.

    Inside a frozen .app bundle there is no .git — auto-update is a no-op.
    In dev (or in a git-checkout install) we walk up from main.py until we
    find a .git directory.
    """
    if getattr(sys, "frozen", False):
        return None
    current = Path(__file__).resolve().parent
    for parent in [current, *current.parents]:
        if (parent / ".git").exists():
            return parent
    return None


def _log_update(line: str) -> None:
    try:
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        with _update_log_path().open("a", encoding="utf-8") as f:
            f.write(f"[{ts}] {line}\n")
    except Exception:
        pass


def _try_git_pull(api: "AppAPI | None" = None) -> None:
    """Attempt git pull --ff-only in a background thread.

    On success with new commits — logs and triggers a soft restart by
    spawning a new process and exiting; the user sees a brief notification
    via JS push.
    On no-change, error, or missing repo — silent in UI, logged to disk.
    """
    repo = _git_repo_root()
    if repo is None:
        _log_update("skip — no .git (frozen bundle or detached source)")
        return

    def task() -> None:
        try:
            before = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=str(repo),
                capture_output=True,
                text=True,
                timeout=15,
            )
            head_before = (before.stdout or "").strip()
            pull = subprocess.run(
                ["git", "pull", "--ff-only", "--quiet"],
                cwd=str(repo),
                capture_output=True,
                text=True,
                timeout=60,
            )
            after = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=str(repo),
                capture_output=True,
                text=True,
                timeout=15,
            )
            head_after = (after.stdout or "").strip()
            if pull.returncode != 0:
                _log_update(f"pull failed rc={pull.returncode} stderr={pull.stderr.strip()}")
                return
            if head_before == head_after:
                _log_update("no updates")
                return
            _log_update(f"updated {head_before[:8]} -> {head_after[:8]}; restarting")
            if api is not None:
                try:
                    api._emit("onAppUpdated", {
                        "from": head_before[:8],
                        "to": head_after[:8],
                    })
                except Exception:
                    pass
            # Soft restart: spawn a new process with same argv, then exit.
            try:
                subprocess.Popen([sys.executable, *sys.argv], cwd=str(repo))
            except Exception as e:
                _log_update(f"respawn failed: {e}")
                return
            os._exit(0)
        except Exception as e:
            _log_update(f"exception: {e}")

    threading.Thread(target=task, daemon=True).start()

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

    # Background self-update via git pull. Will respawn the process if HEAD
    # changes; otherwise no-op. Skipped inside frozen .app bundle.
    _try_git_pull(api)

    # Где хранить cookies / localStorage между запусками.
    # По умолчанию pywebview использует private_mode=True — это стирает
    # localStorage при каждом запуске, из-за чего Supabase-сессия теряется
    # и пользователю приходится логиниться заново. Кладём хранилище в
    # ~/Library/Application Support/MaketCP (macOS) / %APPDATA%/MaketCP (Windows) /
    # ~/.config/MaketCP (Linux), чтобы сессия жила.
    home = Path.home()
    if sys.platform == "darwin":
        storage_dir = home / "Library" / "Application Support" / "MaketCP"
    elif sys.platform.startswith("win"):
        storage_dir = Path(os.environ.get("APPDATA", str(home))) / "MaketCP"
    else:
        storage_dir = home / ".config" / "MaketCP"
    try:
        storage_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        storage_dir = None

    start_kwargs = {
        "debug": "--debug" in sys.argv,
        "private_mode": False,  # включаем persistent storage
    }
    if storage_dir:
        start_kwargs["storage_path"] = str(storage_dir)

    webview.start(**start_kwargs)


if __name__ == "__main__":
    main()
