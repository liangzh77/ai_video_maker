# -*- mode: python ; coding: utf-8 -*-

import os
import pathlib

TOOLS_DIR = str(pathlib.Path(SPECPATH).resolve()) if not pathlib.Path(SPECPATH).suffix else str(pathlib.Path(SPECPATH).parent.resolve())
PROJECT_ROOT = str(pathlib.Path(TOOLS_DIR).parent.resolve())
SCENEDETECT_DIR = os.path.join(PROJECT_ROOT, 'submodules', 'PySceneDetect')

a = Analysis(
    ['main.py'],
    pathex=[TOOLS_DIR, SCENEDETECT_DIR],
    binaries=[],
    datas=[
        ('video_splitter.py', '.'),
        ('video_upscaler.py', '.'),
        ('video_synthesizer.py', '.'),
        ('path_setup.py', '.'),
    ],
    hiddenimports=[
        # scenedetect 核心模块
        'scenedetect',
        'scenedetect.common',
        'scenedetect.detector',
        'scenedetect.scene_detector',
        'scenedetect.scene_manager',
        'scenedetect.stats_manager',
        'scenedetect.frame_timecode',
        'scenedetect.video_stream',
        'scenedetect.video_splitter',
        'scenedetect.platform',
        'scenedetect.output',
        # detectors
        'scenedetect.detectors',
        'scenedetect.detectors.content_detector',
        'scenedetect.detectors.adaptive_detector',
        'scenedetect.detectors.threshold_detector',
        'scenedetect.detectors.histogram_detector',
        'scenedetect.detectors.hash_detector',
        # backends
        'scenedetect.backends',
        'scenedetect.backends.opencv',
        'scenedetect.backends.pyav',
        # 依赖
        'numpy',
        'cv2',
        'tqdm',
        'av',
        'click',
        'platformdirs',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['scipy', 'matplotlib', 'tkinter', 'pandas', 'IPython', 'jupyter'],
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
