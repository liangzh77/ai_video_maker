#!/usr/bin/env python3
"""
图片生成命令行工具
调用各种 AI 模型进行图生图

用法:
    python image_generator.py --model <model_id> --source <source_image> --prompt <prompt> --resolution <2K|4K> --output <output_path>

示例:
    python image_generator.py \
        --model "gemini:gemini-2.0-flash-exp-image-generation" \
        --source "/path/to/source.jpg" \
        --prompt "将图片转换为动漫风格" \
        --resolution "2K" \
        --output "/path/to/output.png"
"""
import argparse
import asyncio
import sys
import os
import logging
from pathlib import Path

# 添加 tools 目录到 path
sys.path.insert(0, str(Path(__file__).parent))

from providers import create_provider, GenerationConfig, ImageSize, ProviderError
from providers.utils import get_image_size


# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',  # 简化格式，便于 TypeScript 解析
    stream=sys.stdout
)
logger = logging.getLogger(__name__)


def resolution_to_config(resolution: str, ref_width: int, ref_height: int) -> GenerationConfig:
    """
    根据分辨率和参考图片尺寸创建生成配置

    Args:
        resolution: "2K" 或 "4K"
        ref_width: 参考图片宽度
        ref_height: 参考图片高度

    Returns:
        GenerationConfig 配置对象
    """
    config = GenerationConfig()
    config.target_resolution = resolution

    # 根据参考图片尺寸设置 size
    if ref_width >= ref_height:
        # 横向
        if resolution == "4K":
            config.size = ImageSize.custom(3840, int(3840 * ref_height / ref_width))
        else:
            config.size = ImageSize.custom(1920, int(1920 * ref_height / ref_width))
    else:
        # 纵向
        if resolution == "4K":
            config.size = ImageSize.custom(int(2160 * ref_width / ref_height), 2160)
        else:
            config.size = ImageSize.custom(int(1080 * ref_width / ref_height), 1080)

    return config


async def generate_image(
    model_id: str,
    source_path: str,
    prompt: str,
    resolution: str,
    output_path: str
) -> dict:
    """
    执行图片生成

    Args:
        model_id: 模型 ID (provider:endpoint)
        source_path: 源图片路径
        prompt: 提示词
        resolution: 分辨率 (2K/4K)
        output_path: 输出路径

    Returns:
        生成结果信息
    """
    # 读取源图片
    print(f"进度: 5%")
    print(f"[ImageGenerator] Reading source image: {source_path}")

    with open(source_path, "rb") as f:
        source_image = f.read()

    # 获取源图片尺寸
    ref_width, ref_height = get_image_size(source_image)
    print(f"[ImageGenerator] Source image size: {ref_width}x{ref_height}")

    # 创建配置
    config = resolution_to_config(resolution, ref_width, ref_height)
    print(f"[ImageGenerator] Target resolution: {resolution}")
    print(f"[ImageGenerator] Target size: {config.size.width}x{config.size.height}")

    print(f"进度: 10%")

    # 创建 provider
    print(f"[ImageGenerator] Creating provider for model: {model_id}")
    provider = create_provider(model_id)

    print(f"进度: 15%")
    print(f"[ImageGenerator] Generating image...")

    # 调用图生图
    try:
        result = await provider.image_to_image(
            prompt=prompt,
            reference_image=source_image,
            config=config
        )
    except ProviderError as e:
        print(f"[ImageGenerator] Error: {e.message}")
        raise

    print(f"进度: 90%")

    # 确保输出目录存在
    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    # 保存生成的图片
    print(f"[ImageGenerator] Saving to: {output_path}")
    with open(output_path, "wb") as f:
        f.write(result.image_data)

    # 获取实际输出尺寸
    actual_width, actual_height = get_image_size(result.image_data)

    print(f"进度: 100%")
    print(f"[ImageGenerator] Done!")
    print(f"Output: {output_path}")
    print(f"Output size: {actual_width}x{actual_height}")

    return {
        "output_path": output_path,
        "width": actual_width,
        "height": actual_height,
        "revised_prompt": result.revised_prompt
    }


def main():
    parser = argparse.ArgumentParser(description="AI 图片生成工具")
    parser.add_argument(
        "--model", "-m",
        required=True,
        help="模型 ID (格式: provider:endpoint)"
    )
    parser.add_argument(
        "--source", "-s",
        required=True,
        help="源图片路径"
    )
    parser.add_argument(
        "--prompt", "-p",
        required=True,
        help="提示词"
    )
    parser.add_argument(
        "--resolution", "-r",
        choices=["2K", "4K"],
        default="2K",
        help="输出分辨率 (默认: 2K)"
    )
    parser.add_argument(
        "--output", "-o",
        required=True,
        help="输出图片路径"
    )

    args = parser.parse_args()

    # 检查源文件是否存在
    if not os.path.exists(args.source):
        print(f"Error: Source file not found: {args.source}")
        sys.exit(1)

    print(f"[ImageGenerator] Starting...")
    print(f"[ImageGenerator] Model: {args.model}")
    print(f"[ImageGenerator] Source: {args.source}")
    print(f"[ImageGenerator] Prompt: {args.prompt[:50]}...")
    print(f"[ImageGenerator] Resolution: {args.resolution}")
    print(f"[ImageGenerator] Output: {args.output}")

    try:
        # 运行异步任务
        result = asyncio.run(generate_image(
            model_id=args.model,
            source_path=args.source,
            prompt=args.prompt,
            resolution=args.resolution,
            output_path=args.output
        ))

        print(f"Success: Image generated at {result['output_path']}")

    except ProviderError as e:
        print(f"Error: [{e.provider}] {e.message}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
