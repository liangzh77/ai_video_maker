"""
视频合成工具
将多个视频按顺序合成为一个视频，支持统一分辨率和帧率
基于 FFmpeg 实现
"""

# 导入路径设置模块（设置 FFmpeg 路径）
import path_setup  # noqa: F401

import sys

import os
import json
import subprocess
import re
import tempfile
from pathlib import Path
from typing import Optional, List, Tuple
from dataclasses import dataclass


# 预设分辨率
RESOLUTION_PRESETS = {
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
    has_audio: bool = False


@dataclass
class SynthesizeResult:
    """合成结果"""
    input_paths: List[str]
    output_path: str
    total_duration: float  # 秒
    output_info: VideoInfo
    processing_time: float  # 秒
    hardware_accelerated: bool


class VideoSynthesizer:
    """视频合成器"""

    def __init__(
        self,
        target_width: int = 1080,
        target_height: int = 1920,
        target_fps: float = 30,
        preset: str = "veryfast",
        use_hwaccel: bool = True,
        crf: int = 23,
    ):
        """
        初始化视频合成器

        Args:
            target_width: 目标宽度（像素）
            target_height: 目标高度（像素）
            target_fps: 目标帧率
            preset: 编码预设
            use_hwaccel: 是否使用硬件加速
            crf: 恒定质量因子 (0-51, 越低质量越高, 默认 23)
        """
        self.target_width = target_width
        self.target_height = target_height
        self.target_fps = target_fps
        self.preset = preset if preset in ENCODER_PRESETS else "veryfast"
        self.use_hwaccel = use_hwaccel
        self.crf = crf

    def get_video_info(self, video_path: str) -> VideoInfo:
        """获取视频信息"""
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
        """检测可用的硬件编码器"""
        if not self.use_hwaccel:
            return ("libx264", None)

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

    def synthesize(
        self,
        input_paths: List[str],
        output_path: str,
        show_progress: bool = True,
        progress_callback=None,
    ) -> SynthesizeResult:
        """
        合成多个视频

        Args:
            input_paths: 输入视频文件路径列表（按顺序）
            output_path: 输出视频文件路径
            show_progress: 是否显示进度
            progress_callback: 进度回调函数 (progress: int) -> None

        Returns:
            合成结果
        """
        import time
        start_time = time.time()

        if not input_paths:
            raise ValueError("至少需要一个输入视频")

        # 获取所有视频信息
        video_infos = []
        total_duration = 0
        any_has_audio = False
        for path in input_paths:
            info = self.get_video_info(path)
            video_infos.append(info)
            total_duration += info.duration
            if info.has_audio:
                any_has_audio = True

        # 确保输出目录存在
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        # 检测硬件编码器
        encoder_type, hwaccel = self.detect_hardware_encoder()

        # 尝试使用硬件编码，多级回退
        actual_encoder = encoder_type
        actual_hwaccel = hwaccel

        try:
            self._run_ffmpeg(
                input_paths=input_paths,
                output_path=output_path,
                video_infos=video_infos,
                any_has_audio=any_has_audio,
                total_duration=total_duration,
                encoder_type=encoder_type,
                hwaccel=hwaccel,
                show_progress=show_progress,
                progress_callback=progress_callback,
            )
        except (subprocess.CalledProcessError, Exception) as e:
            if encoder_type != "libx264":
                try:
                    if show_progress:
                        print(f"\n硬件编码失败，回退到软件编码...")
                    actual_encoder = "libx264"
                    actual_hwaccel = None
                    self._run_ffmpeg(
                        input_paths=input_paths,
                        output_path=output_path,
                        video_infos=video_infos,
                        any_has_audio=any_has_audio,
                        total_duration=total_duration,
                        encoder_type="libx264",
                        hwaccel=None,
                        show_progress=show_progress,
                        progress_callback=progress_callback,
                    )
                except Exception as e2:
                    raise e2
            else:
                raise

        processing_time = time.time() - start_time

        # 获取输出视频信息
        output_info = self.get_video_info(output_path)

        return SynthesizeResult(
            input_paths=input_paths,
            output_path=output_path,
            total_duration=total_duration,
            output_info=output_info,
            processing_time=processing_time,
            hardware_accelerated=actual_encoder != "libx264",
        )

    def _run_ffmpeg(
        self,
        input_paths: List[str],
        output_path: str,
        video_infos: List[VideoInfo],
        any_has_audio: bool,
        total_duration: float,
        encoder_type: str,
        hwaccel: Optional[str],
        show_progress: bool = True,
        progress_callback=None,
    ) -> None:
        """运行 FFmpeg 命令"""
        # 构建命令
        cmd = ["ffmpeg", "-y"]

        # 添加所有输入
        for path in input_paths:
            cmd.extend(["-i", path])

        # 构建 filter_complex
        n = len(input_paths)

        # 视频和音频滤镜
        filter_parts = []
        video_streams = []
        audio_streams = []

        for i in range(n):
            # 视频处理：缩放和帧率统一
            video_filter = f"[{i}:v]scale={self.target_width}:{self.target_height}:force_original_aspect_ratio=disable,fps={self.target_fps},setsar=1[v{i}]"
            filter_parts.append(video_filter)
            video_streams.append(f"[v{i}]")

            # 音频处理（如果有音频）
            if video_infos[i].has_audio:
                audio_filter = f"[{i}:a]aresample=44100[a{i}]"
                filter_parts.append(audio_filter)
                audio_streams.append(f"[a{i}]")

        # 合并视频流
        video_concat = "".join(video_streams) + f"concat=n={n}:v=1:a=0[outv]"
        filter_parts.append(video_concat)

        # 合并音频流（如果有音频）
        if audio_streams:
            # 如果某些视频没有音频，需要生成静音轨道
            if len(audio_streams) == n:
                audio_concat = "".join(audio_streams) + f"concat=n={n}:v=0:a=1[outa]"
            else:
                # 为没有音频的视频生成静音
                new_audio_streams = []
                for i in range(n):
                    if video_infos[i].has_audio:
                        new_audio_streams.append(f"[a{i}]")
                    else:
                        # 生成静音
                        silence_filter = f"anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration={video_infos[i].duration}[silence{i}]"
                        filter_parts.append(silence_filter)
                        new_audio_streams.append(f"[silence{i}]")
                audio_concat = "".join(new_audio_streams) + f"concat=n={n}:v=0:a=1[outa]"
            filter_parts.append(audio_concat)

        # 组合滤镜
        filter_complex = ";".join(filter_parts)
        cmd.extend(["-filter_complex", filter_complex])

        # 映射输出
        cmd.extend(["-map", "[outv]"])
        if audio_streams or any_has_audio:
            cmd.extend(["-map", "[outa]"])

        # 编码器参数
        if encoder_type == "nvenc":
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
                "-b:v", "0",
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

        # 音频编码
        if audio_streams or any_has_audio:
            cmd.extend(["-c:a", "aac", "-b:a", "128k"])

        # 输出
        cmd.append(output_path)

        # 执行
        if show_progress:
            print(f"正在合成 {len(input_paths)} 个视频...")
            print(f"  目标: {self.target_width}x{self.target_height} @ {self.target_fps}fps")
            print(f"  编码器: {encoder_type}")

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace',
        )

        # 解析进度
        last_progress = 0
        for line in process.stdout:
            if show_progress or progress_callback:
                match = re.search(r"time=(\d+):(\d+):(\d+\.\d+)", line)
                if match:
                    h, m, s = match.groups()
                    current_time = int(h) * 3600 + int(m) * 60 + float(s)
                    progress = int(current_time / total_duration * 100) if total_duration > 0 else 0
                    progress = min(progress, 99)  # 保留到99，完成时才100
                    if progress > last_progress:
                        if show_progress:
                            print(f"\r进度: {progress}%", end="", flush=True)
                        if progress_callback:
                            progress_callback(progress)
                        last_progress = progress

        if show_progress:
            print()

        return_code = process.wait()
        if return_code != 0:
            raise subprocess.CalledProcessError(return_code, cmd)


def synthesize_videos(
    input_paths: List[str],
    output_path: str,
    width: int = 1080,
    height: int = 1920,
    fps: float = 30,
    resolution_preset: Optional[str] = None,
    preset: str = "veryfast",
    use_hwaccel: bool = True,
    crf: int = 23,
    show_progress: bool = True,
    progress_callback=None,
) -> SynthesizeResult:
    """
    便捷函数：合成多个视频

    Args:
        input_paths: 输入视频文件路径列表
        output_path: 输出视频文件路径
        width: 目标宽度
        height: 目标高度
        fps: 目标帧率
        resolution_preset: 预设分辨率
        preset: 编码预设
        use_hwaccel: 是否使用硬件加速
        crf: 质量因子
        show_progress: 是否显示进度
        progress_callback: 进度回调函数

    Returns:
        合成结果
    """
    if resolution_preset:
        if resolution_preset not in RESOLUTION_PRESETS:
            raise ValueError(f"未知的预设分辨率: {resolution_preset}")
        width, height = RESOLUTION_PRESETS[resolution_preset]

    synthesizer = VideoSynthesizer(
        target_width=width,
        target_height=height,
        target_fps=fps,
        preset=preset,
        use_hwaccel=use_hwaccel,
        crf=crf,
    )

    return synthesizer.synthesize(
        input_paths=input_paths,
        output_path=output_path,
        show_progress=show_progress,
        progress_callback=progress_callback,
    )


# 命令行接口
def cli_main():
    """命令行入口"""
    import argparse

    parser = argparse.ArgumentParser(
        description="视频合成工具 - 将多个视频合成为一个",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
预设分辨率:
  720p          1280x720
  1080p         1920x1080
  portrait_720p 720x1280
  portrait_1080p 1080x1920
  4k            3840x2160
  portrait_4k   2160x3840

示例:
  # 合成多个视频
  python -m tools.video_synthesizer video1.mp4 video2.mp4 video3.mp4 -o output.mp4

  # 指定分辨率和帧率
  python -m tools.video_synthesizer video1.mp4 video2.mp4 -o output.mp4 -w 1080 -H 1920 -f 30

  # 使用预设分辨率
  python -m tools.video_synthesizer video1.mp4 video2.mp4 -o output.mp4 --resolution portrait_1080p
        """
    )

    parser.add_argument("inputs", nargs="+", help="输入视频文件路径（按顺序）")
    parser.add_argument("-o", "--output", required=True, help="输出视频文件路径")
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
    parser.add_argument("--no-hwaccel", action="store_true", help="禁用硬件加速")
    parser.add_argument("-q", "--quiet", action="store_true", help="静默模式")

    args = parser.parse_args()

    result = synthesize_videos(
        input_paths=args.inputs,
        output_path=args.output,
        width=args.width,
        height=args.height,
        fps=args.fps,
        resolution_preset=args.resolution,
        preset=args.preset,
        use_hwaccel=not args.no_hwaccel,
        crf=args.crf,
        show_progress=not args.quiet,
    )

    if not args.quiet:
        print(f"\n合成完成!")
        print(f"  输出文件: {result.output_path}")
        print(f"  输入视频数: {len(result.input_paths)}")
        print(f"  总时长: {result.total_duration:.2f} 秒")
        print(f"  处理时间: {result.processing_time:.2f} 秒")
        print(f"  硬件加速: {'是' if result.hardware_accelerated else '否'}")
        print(f"  输出分辨率: {result.output_info.width}x{result.output_info.height}")
        print(f"  输出帧率: {result.output_info.fps:.2f} fps")


if __name__ == "__main__":
    cli_main()
