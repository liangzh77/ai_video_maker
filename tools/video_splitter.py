"""
视频自动切分工具
基于 PySceneDetect 实现视频场景检测和自动切分
"""

import os
import sys
from pathlib import Path
from typing import Optional, List, Tuple, Literal
from dataclasses import dataclass

# 添加 PySceneDetect submodule 到路径
SUBMODULES_PATH = Path(__file__).parent.parent / "submodules" / "PySceneDetect"
if SUBMODULES_PATH.exists():
    sys.path.insert(0, str(SUBMODULES_PATH))

from scenedetect import (
    open_video,
    SceneManager,
    StatsManager,
    ContentDetector,
    AdaptiveDetector,
    ThresholdDetector,
    HistogramDetector,
    HashDetector,
    split_video_ffmpeg,
    save_images,
)
from scenedetect.scene_manager import SceneList


# 检测器类型
DetectorType = Literal["content", "adaptive", "threshold", "histogram", "hash"]


@dataclass
class SceneInfo:
    """场景信息"""
    index: int
    start_time: float  # 秒
    end_time: float    # 秒
    start_frame: int
    end_frame: int
    duration: float    # 秒
    start_timecode: str
    end_timecode: str


@dataclass
class SplitResult:
    """切分结果"""
    video_path: str
    output_dir: str
    scenes: List[SceneInfo]
    output_files: List[str]
    stats_file: Optional[str] = None


class VideoSplitter:
    """视频自动切分器"""

    def __init__(
        self,
        detector_type: DetectorType = "content",
        threshold: Optional[float] = None,
        min_scene_len: int = 15,
        auto_downscale: bool = True,
    ):
        """
        初始化视频切分器

        Args:
            detector_type: 检测器类型
                - "content": 内容检测器，适用于大多数场景（默认）
                - "adaptive": 自适应检测器，适用于快速相机运动
                - "threshold": 阈值检测器，适用于淡入淡出效果
                - "histogram": 直方图检测器
                - "hash": 感知哈希检测器，较慢但准确
            threshold: 检测阈值，None 时使用默认值
            min_scene_len: 最小场景长度（帧数）
            auto_downscale: 是否自动缩放大分辨率视频以提高性能
        """
        self.detector_type = detector_type
        self.threshold = threshold
        self.min_scene_len = min_scene_len
        self.auto_downscale = auto_downscale

    def _create_detector(self):
        """创建检测器实例"""
        if self.detector_type == "content":
            return ContentDetector(
                threshold=self.threshold or 27.0,
                min_scene_len=self.min_scene_len,
            )
        elif self.detector_type == "adaptive":
            return AdaptiveDetector(
                adaptive_threshold=self.threshold or 3.0,
                min_scene_len=self.min_scene_len,
            )
        elif self.detector_type == "threshold":
            return ThresholdDetector(
                threshold=self.threshold or 12,
                min_scene_len=self.min_scene_len,
            )
        elif self.detector_type == "histogram":
            return HistogramDetector(
                threshold=self.threshold or 0.05,
                min_scene_len=self.min_scene_len,
            )
        elif self.detector_type == "hash":
            return HashDetector(
                threshold=self.threshold or 0.395,
                min_scene_len=self.min_scene_len,
            )
        else:
            raise ValueError(f"未知的检测器类型: {self.detector_type}")

    def detect_scenes(
        self,
        video_path: str,
        start_time: Optional[float] = None,
        end_time: Optional[float] = None,
        show_progress: bool = True,
        stats_file: Optional[str] = None,
    ) -> List[SceneInfo]:
        """
        检测视频中的场景

        Args:
            video_path: 视频文件路径
            start_time: 开始时间（秒），None 表示从头开始
            end_time: 结束时间（秒），None 表示到结尾
            show_progress: 是否显示进度
            stats_file: 统计数据保存路径（CSV 文件）

        Returns:
            场景信息列表
        """
        # 打开视频
        video = open_video(video_path)

        # 设置时间范围
        if start_time is not None:
            video.seek(start_time)

        # 创建场景管理器
        stats_manager = StatsManager() if stats_file else None
        scene_manager = SceneManager(stats_manager=stats_manager)
        scene_manager.auto_downscale = self.auto_downscale

        # 添加检测器
        scene_manager.add_detector(self._create_detector())

        # 执行检测
        scene_manager.detect_scenes(
            video,
            end_time=end_time,
            show_progress=show_progress,
        )

        # 获取场景列表
        scene_list = scene_manager.get_scene_list()

        # 保存统计数据
        if stats_file and stats_manager:
            stats_manager.save_to_csv(stats_file)

        # 转换为 SceneInfo 列表
        scenes = []
        for i, (start, end) in enumerate(scene_list):
            scenes.append(SceneInfo(
                index=i + 1,
                start_time=start.seconds,
                end_time=end.seconds,
                start_frame=start.frame_num,
                end_frame=end.frame_num,
                duration=(end - start).seconds,
                start_timecode=str(start),
                end_timecode=str(end),
            ))

        return scenes

    def split_video(
        self,
        video_path: str,
        output_dir: str,
        scenes: Optional[List[SceneInfo]] = None,
        output_template: str = "$VIDEO_NAME-Scene-$SCENE_NUMBER",
        ffmpeg_args: Optional[str] = None,
        show_progress: bool = True,
        start_time: Optional[float] = None,
        end_time: Optional[float] = None,
        stats_file: Optional[str] = None,
        save_scene_images: bool = False,
        images_per_scene: int = 3,
    ) -> SplitResult:
        """
        切分视频为多个场景

        Args:
            video_path: 视频文件路径
            output_dir: 输出目录
            scenes: 场景列表，None 时自动检测
            output_template: 输出文件名模板
                - $VIDEO_NAME: 视频名称（不含扩展名）
                - $SCENE_NUMBER: 场景编号（3位）
                - $START_TIME: 开始时间码
                - $END_TIME: 结束时间码
            ffmpeg_args: FFmpeg 参数，None 时使用默认参数（复制编码）
            show_progress: 是否显示进度
            start_time: 开始时间（秒）
            end_time: 结束时间（秒）
            stats_file: 统计数据保存路径
            save_scene_images: 是否保存场景图像
            images_per_scene: 每个场景保存的图像数量

        Returns:
            切分结果
        """
        # 创建输出目录
        os.makedirs(output_dir, exist_ok=True)

        # 检测场景（如果未提供）
        if scenes is None:
            scenes = self.detect_scenes(
                video_path,
                start_time=start_time,
                end_time=end_time,
                show_progress=show_progress,
                stats_file=stats_file,
            )

        if not scenes:
            print("未检测到任何场景")
            return SplitResult(
                video_path=video_path,
                output_dir=output_dir,
                scenes=[],
                output_files=[],
                stats_file=stats_file,
            )

        # 转换为 SceneList 格式
        video = open_video(video_path)
        fps = video.frame_rate
        from scenedetect import FrameTimecode

        scene_list: SceneList = []
        for scene in scenes:
            start = FrameTimecode(scene.start_frame, fps)
            end = FrameTimecode(scene.end_frame, fps)
            scene_list.append((start, end))

        # 获取视频扩展名
        video_ext = Path(video_path).suffix
        output_file_template = f"{output_template}{video_ext}"

        # 使用 FFmpeg 切分
        split_kwargs = {
            "output_dir": output_dir,
            "output_file_template": output_file_template,
            "show_progress": show_progress,
        }
        if ffmpeg_args is not None:
            split_kwargs["arg_override"] = ffmpeg_args

        split_video_ffmpeg(video_path, scene_list, **split_kwargs)

        # 生成输出文件列表
        video_name = Path(video_path).stem
        output_files = []
        for i, scene in enumerate(scenes):
            filename = output_template.replace("$VIDEO_NAME", video_name)
            filename = filename.replace("$SCENE_NUMBER", f"{i+1:03d}")
            filename = filename.replace("$START_TIME", scene.start_timecode.replace(":", "-"))
            filename = filename.replace("$END_TIME", scene.end_timecode.replace(":", "-"))
            output_files.append(os.path.join(output_dir, f"{filename}{video_ext}"))

        # 保存场景图像
        if save_scene_images:
            images_dir = os.path.join(output_dir, "images")
            os.makedirs(images_dir, exist_ok=True)
            save_images(
                video_path,
                scene_list,
                output_dir=images_dir,
                num_images=images_per_scene,
                image_extension="jpg",
            )

        return SplitResult(
            video_path=video_path,
            output_dir=output_dir,
            scenes=scenes,
            output_files=output_files,
            stats_file=stats_file,
        )

    def print_scenes(self, scenes: List[SceneInfo]) -> None:
        """打印场景列表"""
        print(f"\n检测到 {len(scenes)} 个场景:\n")
        print(f"{'编号':^6} {'开始时间':^15} {'结束时间':^15} {'时长':^10}")
        print("-" * 50)
        for scene in scenes:
            print(
                f"{scene.index:^6} "
                f"{scene.start_timecode:^15} "
                f"{scene.end_timecode:^15} "
                f"{scene.duration:^10.2f}s"
            )
        print()


def split_video(
    video_path: str,
    output_dir: str,
    detector_type: DetectorType = "content",
    threshold: Optional[float] = None,
    min_scene_len: int = 15,
    output_template: str = "$VIDEO_NAME-Scene-$SCENE_NUMBER",
    ffmpeg_args: Optional[str] = None,
    show_progress: bool = True,
    start_time: Optional[float] = None,
    end_time: Optional[float] = None,
    stats_file: Optional[str] = None,
    save_scene_images: bool = False,
    images_per_scene: int = 3,
) -> SplitResult:
    """
    便捷函数：自动检测并切分视频

    Args:
        video_path: 视频文件路径
        output_dir: 输出目录
        detector_type: 检测器类型 ("content", "adaptive", "threshold", "histogram", "hash")
        threshold: 检测阈值
        min_scene_len: 最小场景长度（帧数）
        output_template: 输出文件名模板
        ffmpeg_args: FFmpeg 参数
        show_progress: 是否显示进度
        start_time: 开始时间（秒）
        end_time: 结束时间（秒）
        stats_file: 统计数据保存路径
        save_scene_images: 是否保存场景图像
        images_per_scene: 每个场景保存的图像数量

    Returns:
        切分结果
    """
    splitter = VideoSplitter(
        detector_type=detector_type,
        threshold=threshold,
        min_scene_len=min_scene_len,
    )

    return splitter.split_video(
        video_path=video_path,
        output_dir=output_dir,
        output_template=output_template,
        ffmpeg_args=ffmpeg_args,
        show_progress=show_progress,
        start_time=start_time,
        end_time=end_time,
        stats_file=stats_file,
        save_scene_images=save_scene_images,
        images_per_scene=images_per_scene,
    )


def detect_scenes(
    video_path: str,
    detector_type: DetectorType = "content",
    threshold: Optional[float] = None,
    min_scene_len: int = 15,
    start_time: Optional[float] = None,
    end_time: Optional[float] = None,
    show_progress: bool = True,
    stats_file: Optional[str] = None,
) -> List[SceneInfo]:
    """
    便捷函数：检测视频场景

    Args:
        video_path: 视频文件路径
        detector_type: 检测器类型
        threshold: 检测阈值
        min_scene_len: 最小场景长度（帧数）
        start_time: 开始时间（秒）
        end_time: 结束时间（秒）
        show_progress: 是否显示进度
        stats_file: 统计数据保存路径

    Returns:
        场景信息列表
    """
    splitter = VideoSplitter(
        detector_type=detector_type,
        threshold=threshold,
        min_scene_len=min_scene_len,
    )

    return splitter.detect_scenes(
        video_path=video_path,
        start_time=start_time,
        end_time=end_time,
        show_progress=show_progress,
        stats_file=stats_file,
    )


# 命令行接口
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="视频自动切分工具")
    parser.add_argument("video", help="输入视频文件路径")
    parser.add_argument("-o", "--output", default="./output", help="输出目录")
    parser.add_argument(
        "-d", "--detector",
        choices=["content", "adaptive", "threshold", "histogram", "hash"],
        default="content",
        help="检测器类型",
    )
    parser.add_argument("-t", "--threshold", type=float, help="检测阈值")
    parser.add_argument("-m", "--min-scene-len", type=int, default=15, help="最小场景长度（帧数）")
    parser.add_argument("--start", type=float, help="开始时间（秒）")
    parser.add_argument("--end", type=float, help="结束时间（秒）")
    parser.add_argument("--stats", help="统计数据保存路径（CSV）")
    parser.add_argument("--save-images", action="store_true", help="保存场景图像")
    parser.add_argument("--images-per-scene", type=int, default=3, help="每个场景保存的图像数量")
    parser.add_argument("--detect-only", action="store_true", help="仅检测场景，不切分")
    parser.add_argument("-q", "--quiet", action="store_true", help="静默模式")

    args = parser.parse_args()

    splitter = VideoSplitter(
        detector_type=args.detector,
        threshold=args.threshold,
        min_scene_len=args.min_scene_len,
    )

    if args.detect_only:
        # 仅检测场景
        scenes = splitter.detect_scenes(
            args.video,
            start_time=args.start,
            end_time=args.end,
            show_progress=not args.quiet,
            stats_file=args.stats,
        )
        splitter.print_scenes(scenes)
    else:
        # 检测并切分
        result = splitter.split_video(
            args.video,
            args.output,
            start_time=args.start,
            end_time=args.end,
            show_progress=not args.quiet,
            stats_file=args.stats,
            save_scene_images=args.save_images,
            images_per_scene=args.images_per_scene,
        )

        if not args.quiet:
            splitter.print_scenes(result.scenes)
            print(f"输出目录: {result.output_dir}")
            print(f"生成文件: {len(result.output_files)} 个")
