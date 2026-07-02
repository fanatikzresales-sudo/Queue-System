# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for Walmart Queue Optimizer.

Build commands:
  Windows: pyinstaller walmart_queue.spec
  Mac:     pyinstaller walmart_queue.spec
"""

import sys

block_cipher = None

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=[
        # Bundle the web UI assets into the executable
        ("templates", "templates"),
        ("static",    "static"),
    ],
    hiddenimports=[
        # zoneinfo / timezone support (critical for Windows which has no system tz db)
        "zoneinfo",
        "zoneinfo._tzpath",
        "tzdata",
        "tzdata.zoneinfo",
        # Flask internals sometimes missed by auto-analysis
        "flask",
        "flask.templating",
        "jinja2",
        "jinja2.ext",
        "werkzeug",
        "werkzeug.routing",
        "werkzeug.serving",
        "click",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="WalmartQueueOptimizer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    # Windows: hide the console window so users just see the browser
    console=sys.platform != "win32",
    # Mac: windowed mode gives a proper .app bundle behaviour
    windowed=sys.platform == "darwin",
    icon=None,
)

# Mac: wrap the exe in a .app bundle
if sys.platform == "darwin":
    app = BUNDLE(
        exe,
        name="WalmartQueueOptimizer.app",
        icon=None,
        bundle_identifier="com.walmartqueue.optimizer",
        info_plist={
            "NSPrincipalClass": "NSApplication",
            "NSHighResolutionCapable": True,
            "CFBundleShortVersionString": "1.0.0",
        },
    )
