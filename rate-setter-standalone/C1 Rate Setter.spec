# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec для standalone-сборки Capture One Rate Setter под macOS.
# Сборка:  pyinstaller "C1 Rate Setter.spec"
# Результат: dist/C1 Rate Setter.app

a = Analysis(
    ['C1_RateSetter.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Content Pulse Rate Setter',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='Content Pulse Rate Setter',
)
app = BUNDLE(
    coll,
    name='Content Pulse Rate Setter.app',
    icon='icon.icns',
    bundle_identifier='pulse.content.ratesetter',
    info_plist={
        'CFBundleName': 'C1 Rate Setter',
        'CFBundleDisplayName': 'C1 Rate Setter',
        'CFBundleShortVersionString': '1.0.0',
        'NSHighResolutionCapable': True,
        # Всегда светлая тема: иначе нативные поля Tk становятся
        # тёмными по тёмному в Dark Mode macOS и их не видно.
        'NSRequiresAquaSystemAppearance': True,
    },
)
