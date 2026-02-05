# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for image_generator
将图片生成工具打包成 exe
"""

import os
import sys
from pathlib import Path

# 获取目录
import pathlib
_spec_path = pathlib.Path(SPECPATH)
if _spec_path.suffix:
    TOOLS_DIR = str(_spec_path.parent.resolve())
else:
    TOOLS_DIR = str(_spec_path.resolve())
PROJECT_ROOT = str(pathlib.Path(TOOLS_DIR).parent.resolve())

print(f"SPECPATH (raw): {SPECPATH}")
print(f"TOOLS_DIR: {TOOLS_DIR}")
print(f"PROJECT_ROOT: {PROJECT_ROOT}")

# providers 目录
PROVIDERS_DIR = os.path.join(TOOLS_DIR, "providers")

# 收集 providers 模块
provider_modules = []
for py_file in pathlib.Path(PROVIDERS_DIR).glob("*.py"):
    provider_modules.append((str(py_file), 'providers'))

# 隐藏导入
hiddenimports = [
    'httpx',
    'PIL',
    'PIL.Image',
    'providers',
    'providers.base',
    'providers.config',
    'providers.doubao',
    'providers.gemini',
    'providers.gemini_proxy',
    'providers.openrouter',
    'providers.http_client',
    'providers.utils',
    'providers.wanxiang',
    'asyncio',
    'dataclasses',
]

a = Analysis(
    ['image_generator.py'],
    pathex=[TOOLS_DIR],
    binaries=[],
    datas=provider_modules,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'scipy',
        'pandas',
        'IPython',
        'jupyter',
        'notebook',
        'cv2',
        'numpy',
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
    name='image_generator',
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
    name='image_generator',
)
