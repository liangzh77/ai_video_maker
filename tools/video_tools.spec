# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for video_tools
将所有视频处理工具打包成一个 exe
"""

import os
import sys
from pathlib import Path

# 获取目录
# 直接硬编码路径以避免 SPECPATH 解析问题
# SPECPATH 格式如 "C:\...\ai_video_maker\tools" (目录，不是文件)
import pathlib
_spec_path = pathlib.Path(SPECPATH)
# 如果 SPECPATH 看起来像一个文件路径，取其父目录；否则直接使用
if _spec_path.suffix:
    TOOLS_DIR = str(_spec_path.parent.resolve())
else:
    # SPECPATH 已经是目录
    TOOLS_DIR = str(_spec_path.resolve())
PROJECT_ROOT = str(pathlib.Path(TOOLS_DIR).parent.resolve())

print(f"SPECPATH (raw): {SPECPATH}")
print(f"TOOLS_DIR: {TOOLS_DIR}")
print(f"PROJECT_ROOT: {PROJECT_ROOT}")

# PySceneDetect 路径
SCENEDETECT_PATH = os.path.join(PROJECT_ROOT, "submodules", "PySceneDetect", "scenedetect")

# 收集 scenedetect 模块
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

# 收集所有 scenedetect 子模块
scenedetect_hiddenimports = collect_submodules('scenedetect')

# 添加其他可能需要的隐藏导入
hiddenimports = scenedetect_hiddenimports + [
    'numpy',
    'cv2',
    'tqdm',
    'av',
    'video_splitter',
    'video_upscaler',
    'video_synthesizer',
    'path_setup',
]

# 将工具模块作为数据文件包含
tool_modules = [
    (os.path.join(TOOLS_DIR, 'video_splitter.py'), '.'),
    (os.path.join(TOOLS_DIR, 'video_upscaler.py'), '.'),
    (os.path.join(TOOLS_DIR, 'video_synthesizer.py'), '.'),
    (os.path.join(TOOLS_DIR, 'path_setup.py'), '.'),
]

a = Analysis(
    ['main.py'],
    pathex=[
        TOOLS_DIR,
        os.path.join(PROJECT_ROOT, "submodules", "PySceneDetect"),
    ],
    binaries=[],
    datas=tool_modules,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'PIL.ImageTk',
        'scipy',
        'pandas',
        'IPython',
        'jupyter',
        'notebook',
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
    name='video_tools',
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
    name='video_tools',
)
