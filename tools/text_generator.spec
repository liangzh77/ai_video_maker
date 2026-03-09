# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['text_generator.py'],
    pathex=['.'],
    binaries=[],
    datas=[('providers', 'providers')],
    hiddenimports=[
        'httpx', 'anyio', 'anyio._backends', 'anyio._backends._asyncio',
        'providers', 'providers.base', 'providers.config', 'providers.utils', 'providers.http_client',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib', 'numpy', 'scipy',
        'PyQt5', 'PySide6', 'tkinter', 'IPython', 'jedi', 'parso',
        'pygments', 'sqlite3', 'xml', 'setuptools', 'pkg_resources',
        'google.generativeai',
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
    name='text_generator',
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
    name='text_generator',
)
