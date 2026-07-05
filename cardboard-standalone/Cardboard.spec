# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec для Cardboard (macOS .app / Windows .exe).
# Сборка: python3 -m PyInstaller Cardboard.spec --noconfirm
# Иконка: когда появится design/brand-cardboard/icon.icns — вписать в BUNDLE (icon=...).

import sys

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[('index.html', '.')],   # frontend внутрь бандла (см. find_frontend)
    hiddenimports=[],
    hookspath=[],
    runtime_hooks=[],
    excludes=['tkinter'],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Cardboard',
    debug=False,
    strip=False,
    upx=False,
    console=False,          # windowed: без терминала
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='Cardboard',
)

if sys.platform == 'darwin':
    app = BUNDLE(
        coll,
        name='Cardboard.app',
        icon=None,          # TODO: design/brand-cardboard/icon.icns
        bundle_identifier='pulse.content.cardboard',
        info_plist={
            'CFBundleName': 'Cardboard',
            'CFBundleDisplayName': 'Cardboard',
            'CFBundleShortVersionString': '1.0.0',
            'NSHighResolutionCapable': True,
        },
    )
