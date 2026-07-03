# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for FR Queue Optimizer.

Build commands:
  Windows: pyinstaller walmart_queue.spec
  Mac:     pyinstaller walmart_queue.spec
"""

import sys

block_cipher = None

# Platform-specific pywebview hidden imports
if sys.platform == "win32":
    webview_imports = [
        "webview",
        "webview.platforms.edgechromium",
        "webview.platforms.winforms",
        "clr",
        "System",
        "System.Windows.Forms",
    ]
elif sys.platform == "darwin":
    webview_imports = [
        "webview",
        "webview.platforms.cocoa",
        "objc",
    ]
else:
    webview_imports = ["webview", "webview.platforms.gtk"]

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=[
        ("templates",  "templates"),
        ("static",     "static"),
        ("version.py", "."),
    ],
    hiddenimports=[
        "version",
        # zoneinfo / timezone support (critical on Windows)
        "zoneinfo",
        "zoneinfo._tzpath",
        "tzdata",
        "tzdata.zoneinfo",
        # Flask internals
        "flask",
        "flask.templating",
        "jinja2",
        "jinja2.ext",
        "werkzeug",
        "werkzeug.routing",
        "werkzeug.serving",
        "click",
    ] + webview_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
    collect_all=["webview"],
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="FRQueueOptimizer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    windowed=True,
    icon="assets/icon.ico" if sys.platform == "win32" else "assets/icon.icns",
)

# Mac: wrap in a proper .app bundle
if sys.platform == "darwin":
    app = BUNDLE(
        exe,
        name="FRQueueOptimizer.app",
        icon=None,
        bundle_identifier="com.walmartqueue.optimizer",
        info_plist={
            "NSPrincipalClass": "NSApplication",
            "NSHighResolutionCapable": True,
            "CFBundleShortVersionString": "1.0.5",
        },
    )
