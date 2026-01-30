"""
视频分辨率和帧率提升工具
基于 FFmpeg 实现视频分辨率和帧率提升，支持硬件加速
"""

import os
import json
import subprocess
import re
from pathlib import Path
from typing import Optional, Tuple, Literal, Dict
from dataclasses import dataclass


# 预设分辨率
RESOLUTION_PRESETS: Dict[str, Tuple[int, int]] = {
    "720p": (1280, 720),
    "1080p": (1920, 1080),
    "portrait_720p": (720, 1280),
    "portrait_1080p": (1080, 1920),
    "4k": (3840, 2160),
    "portrait_4k": (2160, 3840),
}

# 编码预设
ENCODER_PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"]


@dataclass
class VideoInfo:
    """视频信息"""
    width: int
    height: int
    fps: float
    duration: float  # 秒
    codec: str
    bitrate: Optional[str] = None
    has_audio: bool = False


@dataclass
class UpscaleResult:
    """提升结果"""
    input_path: str
    output_path: str
    original_info: VideoInfo
    output_info: VideoInfo
    processing_time: float  # 秒
    hardware_accelerated: bool


class VideoUpscaler:
    """视频分辨率和帧率提升器"""

    def __init__(
        self,
        target_width: int = 1080,
        target_height: int = 1920,
        target_fps: float = 30,
        preset: str = "veryfast",
        use_hwaccel: bool = True,
        crf: int = 23,
        interpolate_frames: bool = False,
    ):
        """
        初始化视频提升器

        Args:
            target_width: 目标宽度（像素）
            target_height: 目标高度（像素）
            target_fps: 目标帧率
            preset: 编码预设，越快质量越低
                - ultrafast/superfast: 最快，质量较低
                - veryfast/faster/fast: 平衡（推荐 veryfast）
                - medium: 默认
                - slow/slower/veryslow: 最慢，质量最高
            use_hwaccel: 是否使用硬件加速
            crf: 恒定质量因子 (0-51, 越低质量越高, 默认 23)
            interpolate_frames: 是否使用帧插值（更流畅但更慢）
        """
        self.target_width = target_width
        self.target_height = target_height
        self.target_fps = target_fps
        self.preset = preset if preset in ENCODER_PRESETS else "veryfast"
        self.use_hwaccel = use_hwaccel
        self.crf = crf
        self.interpolate_frames = interpolate_frames

    def get_video_info(self, video_path: str) -> VideoInfo:
        """
        获取视频信息

        Args:
            video_path: 视频文件路径

        Returns:
            视频信息
        """
        cmd = [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,r_frame_rate,codec_name",
            "-show_entries", "format=duration",
            "-of", "json",
            video_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, check=True, encoding='utf-8', errors='replace')
        data = json.loads(result.stdout)

        video_stream = data["streams"][0]
        format_info = data["format"]

        width = int(video_stream["width"])
        height = int(video_stream["height"])

        # 解析帧率
        fps_str = video_stream.get("r_frame_rate", "30/1")
        if "/" in fps_str:
            num, den = fps_str.split("/")
            fps = float(num) / float(den)
        else:
            fps = float(fps_str)

        duration = float(format_info.get("duration", 0))
        codec = video_stream.get("codec_name", "unknown")

        # 检查是否有音频
        audio_cmd = [
            "ffprobe",
            "-v", "error",
            "-select_streams", "a",
            "-show_entries", "stream=codec_type",
            "-of", "json",
            video_path
        ]
        audio_result = subprocess.run(audio_cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        audio_data = json.loads(audio_result.stdout)
        has_audio = len(audio_data.get("streams", [])) > 0

        return VideoInfo(
            width=width,
            height=height,
            fps=fps,
            duration=duration,
            codec=codec,
            has_audio=has_audio,
        )

    def detect_hardware_encoder(self) -> Tuple[str, Optional[str]]:
        """
        检测可用的硬件编码器

        Returns:
            (编码器类型, 硬件加速参数) 元组
            - 编码器类型: "nvenc", "qsv", "amf", "libx264"
            - 硬件加速参数: 用于 ffmpeg 的 -hwaccel 参数
        """
        if not self.use_hwaccel:
            return ("libx264", None)

        # 检测 NVIDIA NVENC
        try:
            result = subprocess.run(
                ["ffmpeg", "-hide_banner", "-encoders"],
                capture_output=True, text=True, check=True, encoding='utf-8', errors='replace'
            )
            encoders = result.stdout

            if "h264_nvenc" in encoders:
                return ("nvenc", "cuda")
            elif "h264_qsv" in encoders:
                return ("qsv", "qsv")
            elif "h264_amf" in encoders:
                return ("amf", "d3d11va")
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass

        return ("libx264", None)

    def upscale(
        self,
        input_path: str,
        output_path: str,
        show_progress: bool = True,
    ) -> UpscaleResult:
        """
        执行视频分辨率和帧率提升

        Args:
            input_path: 输入视频文件路径
            output_path: 输出视频文件路径
            show_progress: 是否显示进度

        Returns:
            提升结果
        """
        import time
        start_time = time.time()

        # 获取原始视频信息
        original_info = self.get_video_info(input_path)

        # 确保输出目录存在
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        # 检测硬件编码器
        encoder_type, hwaccel = self.detect_hardware_encoder()

        # 尝试使用硬件编码，多级回退
        fallback_to_software = False
        actual_encoder = encoder_type
        actual_hwaccel = hwaccel

        try:
            # 第一次尝试：硬件编码 + 硬件解码加速
            result = self._run_ffmpeg(
                input_path=input_path,
                output_path=output_path,
                original_info=original_info,
                encoder_type=encoder_type,
                hwaccel=hwaccel,
                show_progress=show_progress,
            )
        except (subprocess.CalledProcessError, Exception) as e:
            if encoder_type != "libx264":
                # 第二次尝试：硬件编码 + 软件解码 (禁用 hwaccel)
                try:
                    if show_progress:
                        print(f"\n硬件解码加速失败，尝试仅硬件编码...")
                    result = self._run_ffmpeg(
                        input_path=input_path,
                        output_path=output_path,
                        original_info=original_info,
                        encoder_type=encoder_type,
                        hwaccel=None,
                        show_progress=show_progress,
                    )
                    actual_hwaccel = None
                except (subprocess.CalledProcessError, Exception) as e2:
                    # 第三次尝试：完全软件编码
                    if show_progress:
                        print(f"\n硬件编码失败: {e2}")
                        print("回退到软件编码 (libx264)...")
                    fallback_to_software = True
                    actual_encoder = "libx264"
                    result = self._run_ffmpeg(
                        input_path=input_path,
                        output_path=output_path,
                        original_info=original_info,
                        encoder_type="libx264",
                        hwaccel=None,
                        show_progress=show_progress,
                    )
            else:
                raise

        processing_time = time.time() - start_time

        # 获取输出视频信息
        output_info = self.get_video_info(output_path)

        return UpscaleResult(
            input_path=input_path,
            output_path=output_path,
            original_info=original_info,
            output_info=output_info,
            processing_time=processing_time,
            hardware_accelerated=actual_encoder != "libx264",
        )

    def _run_ffmpeg(
        self,
        input_path: str,
        output_path: str,
        original_info: VideoInfo,
        encoder_type: str,
        hwaccel: Optional[str],
        show_progress: bool = True,
    ) -> None:
        """
        运行 FFmpeg 命令

        Args:
            input_path: 输入路径
            output_path: 输出路径
            original_info: 原始视频信息
            encoder_type: 编码器类型
            hwaccel: 硬件加速参数
            show_progress: 是否显示进度
        """
        # 构建 FFmpeg 命令
        cmd = self._build_ffmpeg_command(
            input_path=input_path,
            output_path=output_path,
            original_info=original_info,
            encoder_type=encoder_type,
            hwaccel=hwaccel,
        )

        # 执行转换
        if show_progress:
            print(f"正在处理: {input_path}")
            print(f"  原始: {original_info.width}x{original_info.height} @ {original_info.fps:.2f}fps")
            print(f"  目标: {self.target_width}x{self.target_height} @ {self.target_fps}fps")
            print(f"  编码器: {encoder_type}")

        # FFmpeg 进度处理
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace',
        )

        # 解析进度
        duration = original_info.duration
        last_progress = 0
        for line in process.stdout:
            if show_progress:
                # 解析时间进度
                match = re.search(r"time=(\d+):(\d+):(\d+\.\d+)", line)
                if match:
                    h, m, s = match.groups()
                    current_time = int(h) * 3600 + int(m) * 60 + float(s)
                    progress = int(current_time / duration * 100) if duration > 0 else 0
                    if progress > last_progress:
                        print(f"\r进度: {progress}%", end="", flush=True)
                        last_progress = progress

        if show_progress:
            print()  # 换行

        # 等待完成
        return_code = process.wait()
        if return_code != 0:
            raise subprocess.CalledProcessError(return_code, cmd)

    def _build_ffmpeg_command(
        self,
        input_path: str,
        output_path: str,
        original_info: VideoInfo,
        encoder_type: str,
        hwaccel: Optional[str],
    ) -> list:
        """
        构建 FFmpeg 命令

        Args:
            input_path: 输入路径
            output_path: 输出路径
            original_info: 原始视频信息
            encoder_type: 编码器类型
            hwaccel: 硬件加速参数

        Returns:
            FFmpeg 命令列表
        """
        cmd = ["ffmpeg", "-y"]

        # 硬件加速解码
        if hwaccel:
            cmd.extend(["-hwaccel", hwaccel])

        cmd.append("-i")
        cmd.append(input_path)

        # 视频滤镜
        filters = []

        # 分辨率缩放 - 使用 Lanczos 算法
        needs_resize = (original_info.width != self.target_width or
                       original_info.height != self.target_height)
        if needs_resize:
            filters.append(f"scale={self.target_width}:{self.target_height}:flags=lanczos")

        # 帧率转换
        needs_fps_change = abs(original_info.fps - self.target_fps) > 0.1
        if needs_fps_change:
            if self.interpolate_frames:
                # 使用帧插值（更流畅但更慢）
                filters.append(f"minterpolate=fps={self.target_fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir")
            else:
                # 简单帧率调整（速度快）
                filters.append(f"fps={self.target_fps}")

        # 应用滤镜
        if filters:
            cmd.extend(["-vf", ",".join(filters)])

        # 编码器参数
        if encoder_type == "nvenc":
            # NVENC preset 映射 (fastest, fast, medium, slow, slowest)
            nvenc_preset_map = {
                "ultrafast": "fastest",
                "superfast": "faster",
                "veryfast": "fast",
                "faster": "fast",
                "fast": "medium",
                "medium": "medium",
                "slow": "slow",
                "slower": "slower",
                "veryslow": "slowest",
            }
            nvenc_preset = nvenc_preset_map.get(self.preset, "fast")
            cmd.extend([
                "-c:v", "h264_nvenc",
                "-preset", nvenc_preset,
                "-cq", str(self.crf),
                "-b:v", "0",  # VBR 模式
            ])
        elif encoder_type == "qsv":
            cmd.extend([
                "-c:v", "h264_qsv",
                "-preset", self.preset,
                "-global_quality", str(self.crf),
            ])
        elif encoder_type == "amf":
            cmd.extend([
                "-c:v", "h264_amf",
                "-quality", self.preset,
                "-crf", str(self.crf),
            ])
        else:  # libx264
            cmd.extend([
                "-c:v", "libx264",
                "-preset", self.preset,
                "-crf", str(self.crf),
            ])

        # 音频直接复制（不重新编码）
        if original_info.has_audio:
            cmd.extend(["-c:a", "copy"])

        # 输出
        cmd.append(output_path)

        return cmd


def upscale_video(
    input_path: str,
    output_path: Optional[str] = None,
    width: int = 1080,
    height: int = 1920,
    fps: float = 30,
    resolution_preset: Optional[str] = None,
    preset: str = "veryfast",
    use_hwaccel: bool = True,
    crf: int = 23,
    interpolate_frames: bool = False,
    show_progress: bool = True,
) -> UpscaleResult:
    """
    便捷函数：提升视频分辨率和帧率

    Args:
        input_path: 输入视频文件路径
        output_path: 输出视频文件路径，None 时自动生成
        width: 目标宽度
        height: 目标高度
        fps: 目标帧率
        resolution_preset: 预设分辨率 ("720p", "1080p", "portrait_720p", "portrait_1080p", "4k", "portrait_4k")
        preset: 编码预设
        use_hwaccel: 是否使用硬件加速
        crf: 质量因子
        interpolate_frames: 是否使用帧插值
        show_progress: 是否显示进度

    Returns:
        提升结果
    """
    # 应用预设分辨率
    if resolution_preset:
        if resolution_preset not in RESOLUTION_PRESETS:
            raise ValueError(f"未知的预设分辨率: {resolution_preset}")
        width, height = RESOLUTION_PRESETS[resolution_preset]

    # 生成输出路径
    if output_path is None:
        input_path_obj = Path(input_path)
        output_path = str(input_path_obj.parent / f"{input_path_obj.stem}_upscaled{input_path_obj.suffix}")

    upscaler = VideoUpscaler(
        target_width=width,
        target_height=height,
        target_fps=fps,
        preset=preset,
        use_hwaccel=use_hwaccel,
        crf=crf,
        interpolate_frames=interpolate_frames,
    )

    return upscaler.upscale(
        input_path=input_path,
        output_path=output_path,
        show_progress=show_progress,
    )


def get_video_info(video_path: str) -> VideoInfo:
    """
    便捷函数：获取视频信息

    Args:
        video_path: 视频文件路径

    Returns:
        视频信息
    """
    upscaler = VideoUpscaler()
    return upscaler.get_video_info(video_path)


# 命令行接口
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="视频分辨率和帧率提升工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
预设分辨率:
  720p          1280x720
  1080p         1920x1080
  portrait_720p 720x1280
  portrait_1080p 1080x1920
  4k            3840x2160
  portrait_4k   2160x3840

编码预设 (速度越快质量越低):
  ultrafast, superfast, veryfast (推荐), faster, fast, medium, slow, slower, veryslow

示例:
  # 提升到竖屏 1080p, 30fps
  python -m tools.video_upscaler input.mp4 -o output.mp4

  # 使用预设分辨率
  python -m tools.video_upscaler input.mp4 -o output.mp4 --resolution portrait_1080p

  # 提升帧率到 60fps
  python -m tools.video_upscaler input.mp4 -o output.mp4 -f 60

  # 启用帧插值（更流畅但更慢）
  python -m tools.video_upscaler input.mp4 -o output.mp4 --interpolate

  # 查看视频信息
  python -m tools.video_upscaler input.mp4 --info
        """
    )

    parser.add_argument("input", help="输入视频文件路径")
    parser.add_argument("-o", "--output", help="输出视频文件路径")
    parser.add_argument("-w", "--width", type=int, default=1080, help="目标宽度（像素，默认 1080）")
    parser.add_argument("-H", "--height", type=int, default=1920, help="目标高度（像素，默认 1920）")
    parser.add_argument("-f", "--fps", type=float, default=30, help="目标帧率（默认 30）")
    parser.add_argument(
        "-r", "--resolution",
        choices=list(RESOLUTION_PRESETS.keys()),
        help="预设分辨率（覆盖 --width 和 --height）"
    )
    parser.add_argument(
        "--preset",
        choices=ENCODER_PRESETS,
        default="veryfast",
        help="编码预设（默认 veryfast）"
    )
    parser.add_argument("--crf", type=int, default=23, help="质量因子 0-51（默认 23，越小质量越高）")
    parser.add_argument(
        "--interpolate",
        action="store_true",
        help="启用帧插值（更流畅的帧率提升但更慢）"
    )
    parser.add_argument("--no-hwaccel", action="store_true", help="禁用硬件加速")
    parser.add_argument("--info", action="store_true", help="仅显示视频信息，不进行处理")
    parser.add_argument("-q", "--quiet", action="store_true", help="静默模式")

    args = parser.parse_args()

    if args.info:
        # 仅显示视频信息
        info = get_video_info(args.input)
        print(f"视频信息: {args.input}")
        print(f"  分辨率: {info.width}x{info.height}")
        print(f"  帧率: {info.fps:.2f} fps")
        print(f"  时长: {info.duration:.2f} 秒")
        print(f"  编解码器: {info.codec}")
        print(f"  音频: {'有' if info.has_audio else '无'}")
    else:
        # 执行提升
        result = upscale_video(
            input_path=args.input,
            output_path=args.output,
            width=args.width,
            height=args.height,
            fps=args.fps,
            resolution_preset=args.resolution,
            preset=args.preset,
            use_hwaccel=not args.no_hwaccel,
            crf=args.crf,
            interpolate_frames=args.interpolate,
            show_progress=not args.quiet,
        )

        if not args.quiet:
            print(f"\n处理完成!")
            print(f"  输出文件: {result.output_path}")
            print(f"  处理时间: {result.processing_time:.2f} 秒")
            print(f"  硬件加速: {'是' if result.hardware_accelerated else '否'}")
            print(f"  输出分辨率: {result.output_info.width}x{result.output_info.height}")
            print(f"  输出帧率: {result.output_info.fps:.2f} fps")
