"""py2app setup for Maket CP desktop bundle.

Build:
    cd v2/backend
    python3 setup_py2app.py py2app --no-strip

Outputs:
    v2/backend/dist/Maket CP.app

The bundle contains:
- The Python entry point (main.py).
- Bundled pywebview, Pillow, pdfplumber, openpyxl runtime.
- The frontend tree (v2/frontend/) copied as a Resource so main.py can
  resolve index.html via sys._MEIPASS / Resources.

After build the script `build_app.sh` re-codesigns the bundle ad-hoc so it
opens by double-click on macOS without "unidentified developer" friction.
"""
from __future__ import annotations

import sys
from pathlib import Path

from setuptools import setup

HERE = Path(__file__).resolve().parent
FRONTEND_DIR = HERE.parent / "frontend"

APP = ["main.py"]

# Resources: ship the frontend bundle alongside the app so the desktop window
# can load index.html. py2app copies these into Maket CP.app/Contents/Resources.
DATA_FILES: list = []
if FRONTEND_DIR.exists():
    DATA_FILES.append(("frontend", [str(p) for p in FRONTEND_DIR.iterdir() if p.is_file()]))
    for sub in ("css", "js"):
        sub_dir = FRONTEND_DIR / sub
        if sub_dir.exists():
            DATA_FILES.append(
                (f"frontend/{sub}", [str(p) for p in sub_dir.iterdir() if p.is_file()])
            )

OPTIONS: dict = {
    "argv_emulation": False,
    "iconfile": None,
    "plist": {
        "CFBundleName": "Maket CP",
        "CFBundleDisplayName": "Maket CP",
        "CFBundleIdentifier": "app.maketcp.desktop",
        "CFBundleVersion": "0.1.0",
        "CFBundleShortVersionString": "0.1.0",
        "LSMinimumSystemVersion": "11.0",
        "NSHighResolutionCapable": True,
        # Microphone / camera not used; AppleScript automation requires
        # NSAppleEventsUsageDescription so first-run TCC prompt is human-readable.
        "NSAppleEventsUsageDescription": (
            "Maket CP управляет Capture One через AppleScript: "
            "получает выбранные кадры и экспортирует JPEG."
        ),
        "NSAppleScriptEnabled": True,
    },
    "packages": [
        "webview",
        "PIL",
    ],
    "includes": [
        "core",
        "core.api",
        "core.api.app_api",
        "core.services",
        "core.services.rate_setter",
        "core.services.card_service",
        "core.services.project_service",
        "core.services.preview_service",
        "core.services.article_service",
        "core.services.version_service",
        "core.services.shooting_service",
        "core.services.permissions_service",
        "core.infra",
        "core.infra.cos_repository",
        "core.infra.filesystem",
        "core.infra.c1_bridge",
        "core.domain",
        "core.domain.card",
        "core.domain.photo",
        "core.domain.photo_version",
        "core.domain.project",
        "core.domain.shoot_session",
    ],
    # pdfplumber/openpyxl are heavy and only used on demand; they will be
    # auto-installed by main.py._ensure_deps if missing inside the bundle.
    "excludes": [
        "tkinter",
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
    ],
    "optimize": 0,
    "strip": False,
    "semi_standalone": False,
    "site_packages": True,
}


def main() -> None:
    setup(
        app=APP,
        name="Maket CP",
        data_files=DATA_FILES,
        options={"py2app": OPTIONS},
        setup_requires=["py2app"],
    )


if __name__ == "__main__":
    # py2app expects "py2app" as the setup command. Allow plain
    # `python setup_py2app.py` to default to it for convenience.
    if len(sys.argv) == 1:
        sys.argv.append("py2app")
    main()
