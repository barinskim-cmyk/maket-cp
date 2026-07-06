#!/usr/bin/env python3
"""
Content Pulse Analyzer — отчёт по съёмочной смене из сессии Capture One.

Читает .cos-файлы сессии (Exp_Date, рейтинг, камера/оптика, слайдеры),
опционально проект Cardboard (.cardboard) для группировки по артикулам.
Одна смена = один отчёт = один cpreport-файл (архитектура: файл — контракт
между инструментами, см. docs/analyzer-spec.md).

Запуск: python3 main.py
"""
from __future__ import annotations

import base64
import csv
import io
import json
import os
import re
import statistics
import subprocess
import sys
from pathlib import Path
from typing import Optional


def _ensure_deps() -> None:
    required = {"webview": "pywebview", "PIL": "Pillow", "certifi": "certifi"}
    missing = [pip for imp, pip in required.items() if not _importable(imp)]
    if missing:
        print(f"[Analyzer] Устанавливаю зависимости: {', '.join(missing)} ...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet"] + missing)


def _importable(name: str) -> bool:
    try:
        __import__(name)
        return True
    except ImportError:
        return False


if not getattr(sys, "frozen", False) and __name__ == "__main__":
    _ensure_deps()

SCHEMA = 1
APP_VERSION = "0.1.0"
IMG_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".dng"}
SHIFT_GAP_H = 6.0          # разрыв > 6 часов = новая смена
PAUSE_MIN_S = 60           # пауза = перерыв дольше минуты
CLUSTER_GAP_S = 180        # фолбэк-граница артикула без Cardboard-проекта

# ---------------------------------------------------------------------------
# Парсер .cos
# ---------------------------------------------------------------------------

_E_RE = re.compile(r'<E\s+K="([^"]+)"\s+V="([^"]*)"')


def parse_cos(path: Path) -> Optional[dict]:
    """Один .cos -> {key: value}. Устойчив к NUL-паддингу и битым файлам."""
    try:
        raw = path.read_bytes().replace(b"\x00", b"")
        text = raw.decode("utf-8", errors="replace")
    except OSError:
        return None
    d = dict(_E_RE.findall(text))
    if "Exp_Date" not in d:
        return None
    try:
        ts = float(d["Exp_Date"])
    except ValueError:
        return None
    if ts <= 0:
        return None
    # имя кадра: IMG_0001.CR3.cos -> stem IMG_0001, base IMG_0001.CR3
    base = path.name[:-4] if path.name.lower().endswith(".cos") else path.name
    stem = base.split(".")[0]
    def _num(key: str) -> Optional[float]:
        try:
            return float(d[key])
        except (KeyError, ValueError):
            return None
    rating = 0
    try:
        rating = int(float(d.get("Basic_Rating", "0") or 0))
    except ValueError:
        pass
    return {
        "ts": ts,
        "base": base,
        "stem": stem,
        "rating": rating,
        "camera": d.get("Camera_Model", ""),
        "lens": d.get("Camera_Lens", ""),
        "aperture": _num("FNumber") or _num("Aperture") or _num("LensAperture"),
        "iso": _num("ISO") or _num("FilmISO") or _num("ExposureIso"),
        "focal": _num("FocalLength") or _num("LensFocalLength"),
        "raw": d,   # для слайдеров
    }


SLIDER_KEYS = ["Exposure", "Contrast", "Brightness", "Saturation", "Clarity",
               "DehazeAmount", "HighlightRecovery", "ShadowRecovery",
               "UsmAmount", "CnrAmount", "Crop", "ColorCorrections"]


def scan_session(folder: str) -> list:
    """Все кадры сессии: рекурсивно собрать и распарсить .cos, сортировка по времени."""
    frames = []
    for root, dirs, files in os.walk(folder):
        dirs[:] = [x for x in dirs if x != "Trash"]   # корзину сессии не считаем
        for fn in files:
            if fn.lower().endswith(".cos"):
                f = parse_cos(Path(root) / fn)
                if f:
                    frames.append(f)
    # дубль настроек одного кадра (разные Settings-папки) — берём последний
    seen: dict = {}
    for f in frames:
        seen[f["base"]] = f
    frames = sorted(seen.values(), key=lambda x: x["ts"])
    return frames


# ---------------------------------------------------------------------------
# Проект Cardboard: stem кадра -> артикул (карточка)
# ---------------------------------------------------------------------------

def load_cardboard(path: str) -> Optional[dict]:
    """{stem: {"card": n, "title": str}} по слотам и авто-страницам проекта."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if data.get("app") != "cardboard":
            return None
    except Exception:
        return None
    by_id = {p.get("id"): p for p in data.get("photos", [])}
    mapping: dict = {}
    for ci, card in enumerate(data.get("cards", []), 1):
        pids = [s.get("pid") for s in card.get("slots", []) if s.get("pid")]
        pids += [p for p in card.get("pids", []) if p]
        for pid in pids:
            p = by_id.get(pid)
            if not p:
                continue
            stem = str(p.get("name", "")).split(".")[0]
            if stem:
                mapping[stem] = {"card": ci, "title": card.get("title", "")}
    return mapping or None


# ---------------------------------------------------------------------------
# Метрики
# ---------------------------------------------------------------------------

def split_shifts(frames: list) -> list:
    """Кадры -> смены (разрыв > SHIFT_GAP_H часов). Одна смена = один отчёт."""
    if not frames:
        return []
    shifts = [[frames[0]]]
    for prev, cur in zip(frames, frames[1:]):
        if cur["ts"] - prev["ts"] > SHIFT_GAP_H * 3600:
            shifts.append([])
        shifts[-1].append(cur)
    return shifts


def group_articles(frames: list, cb_map: Optional[dict]) -> list:
    """Кадры смены -> артикулы. С Cardboard — по карточкам, иначе кластеры по паузам."""
    groups: dict = {}
    if cb_map:
        order = []
        for f in frames:
            hit = cb_map.get(f["stem"])
            key = ("card", hit["card"]) if hit else ("free", "вне карточек")
            if key not in groups:
                groups[key] = {"frames": [], "title": (hit["title"] if hit else "вне карточек"),
                               "card": (hit["card"] if hit else None)}
                order.append(key)
            groups[key]["frames"].append(f)
        arts = [groups[k] for k in order]
    else:
        arts = []
        for f in frames:
            if not arts or f["ts"] - arts[-1]["frames"][-1]["ts"] > CLUSTER_GAP_S:
                arts.append({"frames": [], "title": f"группа {len(arts) + 1}", "card": None})
            arts[-1]["frames"].append(f)
    for a in arts:
        fs = a["frames"]
        a["n"] = len(fs)
        a["start"] = fs[0]["ts"]
        a["end"] = fs[-1]["ts"]
        a["spent"] = a["end"] - a["start"]
        keys = [f for f in fs if f["rating"] >= 1]
        a["n_key"] = len(keys)
        a["effective"] = (keys[-1]["ts"] - keys[0]["ts"]) if len(keys) >= 2 else (0 if not keys else 0.0)
        a["search"] = max(0.0, a["spent"] - a["effective"]) if keys else None
        a["first_base"] = fs[0]["base"]
    return arts


def shift_report(frames: list, cb_map: Optional[dict], pause_min: int = PAUSE_MIN_S) -> dict:
    """Все метрики одной смены."""
    t0, t1 = frames[0]["ts"], frames[-1]["ts"]
    span = t1 - t0
    pauses = []
    for prev, cur in zip(frames, frames[1:]):
        gap = cur["ts"] - prev["ts"]
        if gap > pause_min:
            pauses.append({"at": prev["ts"] - t0, "dur": gap})
    active = span - sum(p["dur"] for p in pauses)
    arts_all = group_articles(frames, cb_map)
    arts = [a for a in arts_all if a.get("card") is not None] or arts_all
    durs = [a["spent"] for a in arts if a["n"] > 1]
    rated = sum(1 for f in frames if f["rating"] >= 1)

    def top(lst, key, rev, n=5):
        return sorted([a for a in lst if a["n"] > 1], key=lambda a: a[key], reverse=rev)[:n]

    import collections
    def dist(key, fmt):
        c = collections.Counter()
        for f in frames:
            v = f.get(key)
            if v:
                c[fmt(v)] += 1
        return dict(c.most_common(12))

    cameras = dist("camera", str)
    lenses = dist("lens", str)
    sliders: dict = {}
    for k in SLIDER_KEYS:
        n = sum(1 for f in frames if f["raw"].get(k) not in (None, "", "0", "0.000000"))
        if n:
            sliders[k] = n
    return {
        "date": frames[0]["ts"],
        "frames": len(frames),
        "rated": rated,
        "span_s": span,
        "active_s": active,
        "per_hour": round(len(frames) / (active / 3600), 1) if active > 0 else 0,
        "articles": len(arts),
        "articles_per_hour": round(len(arts) / (active / 3600), 2) if active > 0 else 0,
        "art_min": min(durs) if durs else 0,
        "art_med": statistics.median(durs) if durs else 0,
        "art_max": max(durs) if durs else 0,
        "search_total_s": sum(a["search"] or 0 for a in arts),
        "effective_total_s": sum(a["effective"] for a in arts),
        "pauses": sorted(pauses, key=lambda p: -p["dur"]),
        "pauses_n": len(pauses),
        "top_slow": top(arts, "spent", True),
        "top_fast": top(arts, "spent", False, 3),
        "top_search": top([a for a in arts if a.get("search") is not None], "search", True, 3),
        "cameras": cameras,
        "lenses": lenses,
        "sliders": sliders,
        "apertures": dist("aperture", lambda v: f"f/{v:g}"),
        "isos": dist("iso", lambda v: f"{int(v)}"),
        "focals": dist("focal", lambda v: f"{int(v // 5 * 5)}мм"),
        "arts": arts,
        "t0": t0,
    }


def analyze(session: str, cardboard: Optional[str], pause_min: int = PAUSE_MIN_S) -> dict:
    frames = scan_session(session)
    if not frames:
        return {"error": "В папке не нашлось .cos с временем съёмки — это сессия Capture One?"}
    cb_map = load_cardboard(cardboard) if cardboard else None
    shifts = [shift_report(s, cb_map, pause_min) for s in split_shifts(frames)]
    return {
        "schema": SCHEMA,
        "app": "cp-analyzer",
        "version": APP_VERSION,
        "session": os.path.basename(session.rstrip("/")),
        "cardboard": bool(cb_map),
        "frames_total": len(frames),
        "shifts": shifts,
    }


# ---------------------------------------------------------------------------
# Экспорты: cpreport.json (по смене) + CSV по артикулам
# ---------------------------------------------------------------------------

def write_reports(report: dict, out_dir: str) -> list:
    """Файлы накоплений: <сессия>_<дата>.cpreport.json + .csv на каждую смену."""
    import datetime
    written = []
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for sh in report["shifts"]:
        day = datetime.date.fromtimestamp(sh["date"]).isoformat()
        stem = f"{report['session']}_{day}"
        slim = {k: v for k, v in sh.items() if k != "arts"}
        slim["arts"] = [{k: a[k] for k in
                         ("title", "card", "n", "n_key", "spent", "effective", "search", "start")}
                        for a in sh["arts"]]
        jpath = out / f"{stem}.cpreport.json"
        jpath.write_text(json.dumps({
            "schema": SCHEMA, "app": "cp-analyzer", "version": APP_VERSION,
            "session": report["session"], "shift": slim,
        }, ensure_ascii=False, indent=1), encoding="utf-8")
        written.append(str(jpath))
        cpath = out / f"{stem}.csv"
        with open(cpath, "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh, delimiter=";")
            w.writerow(["Артикул", "Карточка", "Кадров", "Ключевых",
                        "Затрачено, с", "Эффективно, с", "Поиск, с", "Час смены"])
            for a in sh["arts"]:
                w.writerow([a["title"], a["card"] or "", a["n"], a["n_key"],
                            round(a["spent"]), round(a["effective"]),
                            round(a["search"]) if a["search"] is not None else "",
                            round((a["start"] - sh["t0"]) / 3600, 1)])
        written.append(str(cpath))
    return written


# ---------------------------------------------------------------------------
# Мост pywebview
# ---------------------------------------------------------------------------

class AnalyzerAPI:
    def __init__(self) -> None:
        self._window = None
        self._session: Optional[str] = None
        self._report: Optional[dict] = None

    def pick_session(self) -> Optional[str]:
        import webview
        r = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not r:
            return None
        self._session = r[0]
        return self._session

    def pick_cardboard(self) -> Optional[str]:
        import webview
        r = self._window.create_file_dialog(
            webview.OPEN_DIALOG, allow_multiple=False,
            file_types=("Проект Cardboard (*.cardboard)",))
        return r[0] if r else None

    def run_analyze(self, session: str, cardboard: Optional[str], pause_min: int) -> dict:
        self._report = analyze(session, cardboard or None, int(pause_min or PAUSE_MIN_S))
        self._session = session
        return self._report

    def thumb(self, base: str) -> Optional[str]:
        """Превью кадра по имени файла (ищем в сессии; для топ-артикулов)."""
        if not self._session:
            return None
        from PIL import Image, ImageOps
        stem = base.split(".")[0]
        for root, dirs, files in os.walk(self._session):
            dirs[:] = [x for x in dirs if x not in ("Trash", "CaptureOne")]
            for fn in files:
                if fn.split(".")[0] == stem and Path(fn).suffix.lower() in IMG_EXT - {".cr2", ".cr3", ".nef", ".arw", ".raf", ".dng"}:
                    try:
                        with Image.open(Path(root) / fn) as im:
                            im = ImageOps.exif_transpose(im)
                            im.thumbnail((400, 400))
                            buf = io.BytesIO()
                            im.convert("RGB").save(buf, "JPEG", quality=80)
                            return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
                    except Exception:
                        return None
        return None

    def save_reports(self) -> Optional[dict]:
        """cpreport.json + CSV в папку накоплений (спрашиваем один раз)."""
        import webview
        if not self._report or "error" in self._report:
            return None
        r = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not r:
            return None
        files = write_reports(self._report, r[0])
        return {"dir": r[0], "files": [os.path.basename(f) for f in files]}


def find_frontend() -> Path:
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        c = base / "index.html"
        if c.exists():
            return c.resolve()
    return (Path(__file__).parent / "index.html").resolve()


def main() -> None:
    import webview
    api = AnalyzerAPI()
    window = webview.create_window(
        "Content Pulse Analyzer", find_frontend().as_uri(), js_api=api,
        width=1280, height=860, min_size=(960, 620))
    api._window = window
    home = Path.home()
    if sys.platform == "darwin":
        storage = home / "Library" / "Application Support" / "CPAnalyzer"
    elif sys.platform.startswith("win"):
        storage = Path(os.environ.get("APPDATA", str(home))) / "CPAnalyzer"
    else:
        storage = home / ".config" / "CPAnalyzer"
    kwargs = {"private_mode": False}
    try:
        storage.mkdir(parents=True, exist_ok=True)
        kwargs["storage_path"] = str(storage)
    except OSError:
        pass
    if os.environ.get("CB_DIAG"):
        def _diag():
            import time
            time.sleep(5)
            print("DIAG READY:", window.evaluate_js("document.readyState"))
            print("DIAG TOPBAR:", window.evaluate_js("document.querySelector('.an-topbar') ? 'yes' : 'no'"))
            print("DIAG BRIDGE:", window.evaluate_js("window.pywebview && window.pywebview.api ? true : false"))
            window.destroy()
        webview.start(_diag, **kwargs)
    else:
        webview.start(**kwargs)


if __name__ == "__main__":
    main()
