"""
视频工具统一入口
用于 PyInstaller 打包

使用方法:
    video_tools.exe split <video> [options]
    video_tools.exe upscale <video> [options]
    video_tools.exe synthesize <videos...> -o <output> [options]
"""

import sys
import os

# Windows 下强制 stdout/stderr 使用 UTF-8 编码（必须在所有其他 import 之前）
if sys.platform == 'win32':
    import io
    # PyInstaller 打包后，buffer 可能不可用，需要检查
    try:
        if hasattr(sys.stdout, 'buffer') and sys.stdout.buffer is not None:
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        if hasattr(sys.stderr, 'buffer') and sys.stderr.buffer is not None:
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        # 如果无法设置，忽略错误
        pass

import runpy

# 设置路径
def setup_paths():
    """设置 FFmpeg 和模块路径"""
    # 获取可执行文件所在目录
    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后
        base_dir = os.path.dirname(sys.executable)
        internal_dir = os.path.join(base_dir, "_internal")

        # 将 _internal 目录添加到模块搜索路径
        if internal_dir not in sys.path:
            sys.path.insert(0, internal_dir)
    else:
        # 开发模式
        base_dir = os.path.dirname(os.path.abspath(__file__))

    # 查找 FFmpeg 路径
    possible_paths = [
        os.path.join(base_dir, "..", "bin"),  # 开发模式
        base_dir,  # 打包后同级目录
        os.path.join(base_dir, "_internal") if getattr(sys, 'frozen', False) else None,
    ]

    for path in possible_paths:
        if path is None:
            continue
        ffmpeg_path = os.path.join(path, "ffmpeg.exe")
        if os.path.exists(ffmpeg_path):
            os.environ["PATH"] = os.path.abspath(path) + os.pathsep + os.environ.get("PATH", "")
            print(f"[VideoTools] Using FFmpeg from: {os.path.abspath(path)}", file=sys.stderr)
            return

    print("[VideoTools] FFmpeg not found, using system PATH", file=sys.stderr)


def main():
    setup_paths()

    if len(sys.argv) < 2:
        print("视频工具集 - 统一入口")
        print()
        print("使用方法:")
        print("  video_tools.exe split <video> [options]     - 切分视频")
        print("  video_tools.exe upscale <video> [options]   - 高清化视频")
        print("  video_tools.exe synthesize <videos...> -o <output> [options] - 合成视频")
        print()
        print("使用 --help 查看各工具详细选项")
        sys.exit(1)

    tool = sys.argv[1]
    # 移除工具名称，让子模块能正确解析参数
    sys.argv = [sys.argv[0]] + sys.argv[2:]

    if tool == "split":
        from video_splitter import cli_main
        cli_main()
    elif tool == "upscale":
        from video_upscaler import cli_main
        cli_main()
    elif tool == "synthesize":
        from video_synthesizer import cli_main
        cli_main()
    else:
        print(f"未知工具: {tool}")
        print("可用工具: split, upscale, synthesize")
        sys.exit(1)


if __name__ == "__main__":
    main()
