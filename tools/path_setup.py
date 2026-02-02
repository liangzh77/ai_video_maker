"""
路径设置模块
用于在开发模式和打包模式下正确设置 FFmpeg 和其他依赖的路径

支持的模式：
1. 开发模式：直接运行 Python 脚本
2. Electron 打包模式：Python 脚本在 resources 目录
3. PyInstaller 打包模式：Python 被打包成 exe
"""

import os
import sys
from pathlib import Path


def get_base_dir():
    """获取基础目录"""
    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后
        return Path(sys.executable).parent
    else:
        # 开发模式或 Electron 打包
        return Path(__file__).parent


def setup_ffmpeg_path():
    """
    设置 FFmpeg 路径
    """
    base_dir = get_base_dir()

    # 检查环境变量覆盖
    ffmpeg_bin = os.environ.get("FFMPEG_BIN")
    if ffmpeg_bin and Path(ffmpeg_bin).exists():
        os.environ["PATH"] = ffmpeg_bin + os.pathsep + os.environ.get("PATH", "")
        print(f"[PathSetup] Using FFmpeg from env FFMPEG_BIN: {ffmpeg_bin}", file=sys.stderr)
        return

    # 查找 FFmpeg 路径（按优先级）
    possible_paths = []

    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后
        possible_paths = [
            base_dir,  # 同级目录
            base_dir / "_internal",  # onefile 模式内部目录
        ]
    else:
        # 开发模式或 Electron 打包
        possible_paths = [
            base_dir.parent / "bin",  # 开发模式：项目根目录/bin
            base_dir.parent / "bin",  # Electron 打包：resources/bin
        ]

    for bin_path in possible_paths:
        ffmpeg_exe = bin_path / "ffmpeg.exe"
        if ffmpeg_exe.exists():
            os.environ["PATH"] = str(bin_path) + os.pathsep + os.environ.get("PATH", "")
            print(f"[PathSetup] Using FFmpeg from: {bin_path}", file=sys.stderr)
            return

    print(f"[PathSetup] FFmpeg not found, using system PATH", file=sys.stderr)


def setup_scenedetect_path():
    """
    设置 PySceneDetect 模块路径
    在 PyInstaller 打包后，scenedetect 已经被打包进 exe，无需设置
    在 Electron 打包模式下，scenedetect 位于 resources/scenedetect 目录
    """
    # PyInstaller 打包后，模块已经被打包，无需额外设置
    if getattr(sys, 'frozen', False):
        print("[PathSetup] PyInstaller mode, scenedetect is bundled", file=sys.stderr)
        return

    base_dir = get_base_dir()

    # 查找 PySceneDetect 模块路径
    # 1. 开发模式：submodules/PySceneDetect
    # 2. Electron 打包模式：与 tools 同级的 scenedetect 目录
    possible_paths = [
        base_dir.parent / "submodules" / "PySceneDetect",  # 开发模式
        base_dir.parent / "scenedetect",  # Electron 打包模式
    ]

    for path in possible_paths:
        if path.exists():
            # 如果是 PySceneDetect 仓库，添加仓库根目录
            if (path / "scenedetect").exists():
                sys.path.insert(0, str(path))
                print(f"[PathSetup] Using PySceneDetect from: {path}", file=sys.stderr)
            else:
                # 如果是直接的 scenedetect 包目录，添加其父目录
                sys.path.insert(0, str(path.parent))
                print(f"[PathSetup] Using scenedetect package from: {path.parent}", file=sys.stderr)
            return

    print("[PathSetup] PySceneDetect not found, using system installation", file=sys.stderr)


def setup_all():
    """设置所有路径"""
    setup_ffmpeg_path()
    setup_scenedetect_path()


# 自动执行设置
setup_ffmpeg_path()
