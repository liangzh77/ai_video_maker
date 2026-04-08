# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['runninghub_video.py'],
    pathex=['.'],
    binaries=[],
    datas=[],
    hiddenimports=[
        'httpx', 'anyio', 'anyio._backends', 'anyio._backends._asyncio',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib', 'numpy', 'scipy',
        'PyQt5', 'PySide6', 'tkinter', 'IPython', 'jedi', 'parso',
        'pygments', 'sqlite3', 'xml', 'setuptools', 'pkg_resources',
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='runninghub_video',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
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
    upx=True,
    upx_exclude=[],
    name='runninghub_video',
)
