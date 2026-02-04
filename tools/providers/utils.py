"""
图片处理工具函数
"""
from PIL import Image
from io import BytesIO
from typing import Tuple
import math


def get_image_size(image_data: bytes) -> Tuple[int, int]:
    """
    获取图片尺寸

    Args:
        image_data: 图片字节数据

    Returns:
        (width, height) 元组
    """
    img = Image.open(BytesIO(image_data))
    return img.size


def calculate_output_size(
    ref_width: int,
    ref_height: int,
    min_size: int = 1024,
    max_size: int = 8888,
    min_pixels: int = 0,
    target_short_side: int = 0
) -> Tuple[int, int]:
    """
    根据参考图片的宽高比计算输出尺寸（保持原始宽高比）

    Args:
        ref_width: 参考图片宽度
        ref_height: 参考图片高度
        min_size: 最小边长（会确保短边不小于此值）
        max_size: 最大边长（会确保长边不超过此值）
        min_pixels: 最小总像素数（会确保宽*高不小于此值）
        target_short_side: 目标短边长度（如果指定，会优先使用）

    Returns:
        (output_width, output_height) 元组，结果会对齐到 8 的倍数
    """
    aspect_ratio = ref_width / ref_height
    is_landscape = ref_width >= ref_height

    # 如果指定了目标短边长度，优先使用
    if target_short_side > 0:
        if is_landscape:
            # 横向：高度是短边
            height = target_short_side
            width = int(height * aspect_ratio)
        else:
            # 纵向：宽度是短边
            width = target_short_side
            height = int(width / aspect_ratio)
    else:
        # 根据 min_pixels 计算
        if min_pixels > 0:
            # 计算满足最小像素要求的尺寸
            current_pixels = ref_width * ref_height
            if current_pixels < min_pixels:
                scale = math.sqrt(min_pixels / current_pixels)
                width = int(ref_width * scale)
                height = int(ref_height * scale)
            else:
                width = ref_width
                height = ref_height
        else:
            width = ref_width
            height = ref_height

        # 确保满足最小边长要求
        short_side = min(width, height)
        if short_side < min_size and min_size > 0:
            scale = min_size / short_side
            width = int(width * scale)
            height = int(height * scale)

    # 确保不超过最大边长
    long_side = max(width, height)
    if long_side > max_size:
        scale = max_size / long_side
        width = int(width * scale)
        height = int(height * scale)

    # 对齐到 8 的倍数（很多图像模型需要）
    width = (width // 8) * 8
    height = (height // 8) * 8

    # 确保至少是 8
    width = max(width, 8)
    height = max(height, 8)

    return width, height
