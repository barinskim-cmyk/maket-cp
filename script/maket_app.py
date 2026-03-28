#!/usr/bin/env python3
"""
Maket CP — единое приложение:
  Вкладка 1: Вёрстка карточек товара (card-maker)
  Вкладка 2: Rate Setter (Capture One .cos → 5★)

Требует: pip install pywebview
"""
from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path

import webview  # pip install pywebview

from rate_setter_core import (
    collect_source_stems,
    parse_stems_from_text,
    process,
)

# ─── Определяем путь к ресурсам ───
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys._MEIPASS)
    APP_DIR = Path(os.path.dirname(sys.executable))
else:
    BASE_DIR = Path(__file__).resolve().parent
    APP_DIR = BASE_DIR


def find_card_maker() -> Path | None:
    """Найти card-maker.html."""
    candidates = [
        APP_DIR / "card-maker.html",
        APP_DIR.parent / "card-maker.html",
        BASE_DIR / "card-maker.html",
        BASE_DIR.parent / "card-maker.html",
    ]
    for p in candidates:
        if p.exists():
            return p.resolve()
    return None


class Api:
    """Python-бэкенд, вызывается из JS через window.pywebview.api.*"""

    def __init__(self, window_ref=None):
        self._window = window_ref

    # ── Навигация ──

    def go_to_cards(self):
        """Переключиться на Card Maker."""
        cm = find_card_maker()
        if cm:
            self._window.load_url(cm.as_uri())
        else:
            self._window.evaluate_js("alert('card-maker.html не найден')")

    def go_to_rater(self):
        """Переключиться на Rate Setter."""
        self._window.load_html(RATER_HTML)

    def go_to_home(self):
        """На главную."""
        self._window.load_html(HOME_HTML)

    # ── Rate Setter ──

    def select_folder(self, title: str = "Выберите папку") -> str | None:
        result = self._window.create_file_dialog(
            webview.FOLDER_DIALOG, directory="", allow_multiple=False
        )
        if result and len(result) > 0:
            return result[0]
        return None

    def select_txt_file(self) -> str | None:
        result = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            directory="",
            allow_multiple=False,
            file_types=("Text files (*.txt)",),
        )
        if result and len(result) > 0:
            return result[0]
        return None

    def read_txt_file(self, path: str) -> str:
        try:
            return Path(path).read_text(encoding="utf-8")
        except Exception as e:
            return f"ERROR: {e}"

    def run_rate_setter(self, mode, text_list, source_dir, session_dir, strip_tails) -> dict:
        log_lines = []

        def log(msg: str):
            log_lines.append(msg)
            safe_msg = json.dumps(msg)
            self._window.evaluate_js(f"appendRateLog({safe_msg})")

        if mode == "folder":
            src = Path(source_dir)
            if not src.exists():
                return {"error": "Папка источника не найдена"}
            stems = collect_source_stems(src, strip_tails=strip_tails)
            log(f"Режим: папка — найдено {len(stems)} имён в {src}")
        else:
            stems = parse_stems_from_text(text_list, strip_tails=strip_tails)
            if not stems:
                return {"error": "Список имён пуст"}
            log(f"Режим: список — {len(stems)} имён")

        log("Расширения (.jpeg, .cr3, .dng и т.п.) убираются автоматически")
        if strip_tails:
            log("Хвостики убраны (_preview, _web, _copy и т.п.)")

        session = Path(session_dir)
        if not session.exists():
            return {"error": "Папка сессии не найдена"}

        log("=== Старт ===")
        log("Совет: закройте Capture One на время обработки.\n")

        result = process(stems, session, log=log)

        log("\n=== Готово ===")
        log(f"Обновлено .cos: {result['updated']}")
        log(f"Без изменений : {result['unchanged']}")
        log(f"Не найдено    : {result['missing']}")
        log(f"Дубликаты     : {result['duplicates']}")
        log(f"Ошибки        : {result['errors']}")

        return result


# ─── Общие стили и навбар ───

NAV_BAR = """
<div style="display:flex; background:#fff; border-bottom:1px solid #e0e0e0; padding:0 20px; position:sticky; top:0; z-index:50;">
  <button onclick="window.pywebview.api.go_to_home()" style="padding:14px 24px; font-size:14px; font-weight:600; border:none; background:none; cursor:pointer; color:#333;">Maket CP</button>
  <button onclick="window.pywebview.api.go_to_cards()" style="padding:14px 24px; font-size:14px; font-weight:500; border:none; background:none; cursor:pointer; color:#888; border-bottom:3px solid transparent;" onmouseover="this.style.color='#333'" onmouseout="this.style.color='#888'">Вёрстка карточек</button>
  <button onclick="window.pywebview.api.go_to_rater()" style="padding:14px 24px; font-size:14px; font-weight:500; border:none; background:none; cursor:pointer; color:#888; border-bottom:3px solid transparent;" onmouseover="this.style.color='#333'" onmouseout="this.style.color='#888'">Rate Setter ★</button>
</div>
"""

COMMON_STYLE = """
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; }
</style>
"""

# ─── Главная ───

HOME_HTML = f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">{COMMON_STYLE}</head><body>
{NAV_BAR}
<div style="max-width:600px; margin:80px auto; text-align:center;">
  <h1 style="font-size:28px; font-weight:600; margin-bottom:12px;">Maket CP</h1>
  <p style="color:#888; margin-bottom:40px;">Digital Asset Manager для фотографов</p>
  <div style="display:flex; gap:20px; justify-content:center;">
    <button onclick="window.pywebview.api.go_to_cards()" style="padding:20px 32px; font-size:16px; background:#333; color:#fff; border:none; border-radius:12px; cursor:pointer; min-width:200px;">
      Вёрстка карточек
    </button>
    <button onclick="window.pywebview.api.go_to_rater()" style="padding:20px 32px; font-size:16px; background:#fff; color:#333; border:2px solid #333; border-radius:12px; cursor:pointer; min-width:200px;">
      Rate Setter ★
    </button>
  </div>
</div>
</body></html>
"""

# ─── Rate Setter ───

RATER_HTML = f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">{COMMON_STYLE}
<style>
  .rs-container {{ max-width: 900px; margin: 24px auto; padding: 0 20px; }}
  .rs-card {{ background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 10px rgba(0,0,0,0.06); }}
  .rs-card h2 {{ font-size: 16px; margin-bottom: 16px; color: #333; }}
  .rs-row {{ display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }}
  .rs-input {{ flex: 1; padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; outline: none; }}
  .rs-input:focus {{ border-color: #333; }}
  .rs-textarea {{ width: 100%; height: 120px; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; font-family: monospace; outline: none; resize: vertical; }}
  .rs-textarea:focus {{ border-color: #333; }}
  .rs-radio-row {{ display: flex; gap: 16px; margin-bottom: 12px; }}
  .rs-radio-row label {{ display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 14px; color: #333; }}
  .rs-btn {{ padding: 10px 24px; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; transition: all 0.2s; }}
  .rs-btn-primary {{ background: #333; color: #fff; }}
  .rs-btn-primary:hover {{ background: #555; }}
  .rs-btn-primary:disabled {{ background: #ccc; cursor: not-allowed; }}
  .rs-btn-outline {{ background: #fff; color: #333; border: 1px solid #ddd; }}
  .rs-btn-outline:hover {{ background: #f5f5f5; }}
  .rs-btn-row {{ display: flex; gap: 10px; flex-wrap: wrap; }}
  .rs-checkbox {{ display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }}
  .rs-checkbox label {{ font-size: 13px; color: #555; cursor: pointer; }}
  .rs-log {{ width: 100%; height: 300px; padding: 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 12px; font-family: 'SF Mono', Monaco, 'Courier New', monospace; background: #1a1a2e; color: #a8d8a8; overflow-y: auto; white-space: pre-wrap; }}
  .rs-status {{ font-size: 13px; color: #888; margin-top: 8px; }}
  .hidden {{ display: none !important; }}
</style>
</head><body>
{NAV_BAR}
<div class="rs-container">
  <div class="rs-card">
    <h2>1) Источник имён фотографий</h2>
    <div class="rs-radio-row">
      <label><input type="radio" name="rs-mode" value="folder" checked onchange="toggleRsMode()"> Из папки</label>
      <label><input type="radio" name="rs-mode" value="list" onchange="toggleRsMode()"> Из списка (текст)</label>
    </div>
    <div id="rs-folder-mode">
      <div class="rs-row">
        <input type="text" class="rs-input" id="rs-source-dir" placeholder="Путь к папке с фотографиями" readonly>
        <button class="rs-btn rs-btn-outline" onclick="pickSourceDir()">Выбрать…</button>
      </div>
    </div>
    <div id="rs-list-mode" class="hidden">
      <p style="font-size:13px; color:#666; margin-bottom:8px;">Вставьте имена файлов (по одному на строку):</p>
      <textarea class="rs-textarea" id="rs-names-text" placeholder="IMG_0001.jpg&#10;IMG_0002.CR3&#10;photo_preview.jpeg"></textarea>
      <div class="rs-btn-row" style="margin-top:8px;">
        <button class="rs-btn rs-btn-outline" onclick="loadTxtFile()">Загрузить .txt…</button>
        <button class="rs-btn rs-btn-outline" onclick="document.getElementById('rs-names-text').value=''">Очистить</button>
      </div>
    </div>
    <div class="rs-checkbox" style="margin-top:12px;">
      <input type="checkbox" id="rs-strip-tails">
      <label for="rs-strip-tails">Убрать хвостики (_preview, _web, _copy и т.п.)</label>
    </div>
  </div>
  <div class="rs-card">
    <h2>2) Папка сессии — где искать *.cos</h2>
    <div class="rs-row">
      <input type="text" class="rs-input" id="rs-session-dir" placeholder="Путь к папке сессии Capture One" readonly>
      <button class="rs-btn rs-btn-outline" onclick="pickSessionDir()">Выбрать…</button>
    </div>
  </div>
  <div class="rs-card">
    <div class="rs-btn-row">
      <button class="rs-btn rs-btn-primary" id="rs-start-btn" onclick="startRating()">Старт: поставить 5★</button>
      <button class="rs-btn rs-btn-outline" onclick="clearRateLog()">Очистить лог</button>
    </div>
  </div>
  <div class="rs-card">
    <h2>Лог</h2>
    <div class="rs-log" id="rs-log"></div>
    <div class="rs-status" id="rs-status">Готово.</div>
  </div>
</div>
<script>
function toggleRsMode() {{
  const mode = document.querySelector('input[name="rs-mode"]:checked').value;
  document.getElementById('rs-folder-mode').classList.toggle('hidden', mode !== 'folder');
  document.getElementById('rs-list-mode').classList.toggle('hidden', mode !== 'list');
}}

async function pickSourceDir() {{
  const path = await window.pywebview.api.select_folder('Выберите папку с фотографиями');
  if (path) document.getElementById('rs-source-dir').value = path;
}}

async function pickSessionDir() {{
  const path = await window.pywebview.api.select_folder('Выберите папку сессии Capture One');
  if (path) document.getElementById('rs-session-dir').value = path;
}}

async function loadTxtFile() {{
  const path = await window.pywebview.api.select_txt_file();
  if (path) {{
    const text = await window.pywebview.api.read_txt_file(path);
    if (!text.startsWith('ERROR:')) {{
      document.getElementById('rs-names-text').value = text;
    }} else {{
      alert(text);
    }}
  }}
}}

function appendRateLog(msg) {{
  const log = document.getElementById('rs-log');
  log.textContent += msg + '\\n';
  log.scrollTop = log.scrollHeight;
}}

function clearRateLog() {{
  document.getElementById('rs-log').textContent = '';
}}

async function startRating() {{
  const mode = document.querySelector('input[name="rs-mode"]:checked').value;
  const textList = document.getElementById('rs-names-text').value;
  const sourceDir = document.getElementById('rs-source-dir').value;
  const sessionDir = document.getElementById('rs-session-dir').value;
  const stripTails = document.getElementById('rs-strip-tails').checked;

  if (!sessionDir) {{ alert('Не выбрана папка сессии (пункт 2)'); return; }}
  if (mode === 'folder' && !sourceDir) {{ alert('Не выбрана папка источника (пункт 1)'); return; }}
  if (mode === 'list' && !textList.trim()) {{ alert('Список имён пуст'); return; }}

  const btn = document.getElementById('rs-start-btn');
  btn.disabled = true;
  document.getElementById('rs-status').textContent = 'Выполняется…';

  try {{
    const result = await window.pywebview.api.run_rate_setter(mode, textList, sourceDir, sessionDir, stripTails);
    if (result.error) {{
      alert(result.error);
    }} else {{
      alert('Готово!\\nОбновлено: ' + result.updated + '\\nНе найдено: ' + result.missing + '\\nОшибки: ' + result.errors);
    }}
  }} catch(e) {{
    alert('Ошибка: ' + e);
  }}

  btn.disabled = false;
  document.getElementById('rs-status').textContent = 'Готово.';
}}
</script>
</body></html>
"""


def main():
    api = Api(window_ref=None)  # window ещё не создан

    window = webview.create_window(
        title="Maket CP",
        html=HOME_HTML,
        js_api=api,  # js_api стабильнее в PyInstaller чем window.expose()
        width=1200,
        height=800,
        min_size=(800, 600),
    )

    api._window = window  # теперь передаём ссылку на окно

    webview.start(debug="--debug" in sys.argv)


if __name__ == "__main__":
    main()
