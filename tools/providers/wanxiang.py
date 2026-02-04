"""
万相 API 集成
阿里云通义万相图片生成服务
"""
import httpx
import base64
from typing import Optional

from .config import settings
from .base import ImageGeneratorBase


class WanxiangProvider(ImageGeneratorBase):
    """万相图片生成提供者"""

    def __init__(self):
        self.access_key = settings.WANXIANG_ACCESS_KEY
        self.access_secret = settings.WANXIANG_ACCESS_SECRET
        self.endpoint = settings.WANXIANG_ENDPOINT
        self.timeout = 120.0

    async def text_to_image(self, prompt: str) -> bytes:
        """
        文生图

        注意: 这是一个模拟实现。实际使用时需要根据万相 API 文档调整。
        """
        if not self.access_key or not self.access_secret:
            raise ValueError("万相 API 密钥未配置")

        # 模拟 API 调用（实际实现需参考阿里云 API 文档）
        return self._generate_placeholder_image(prompt)

    async def image_to_image(self, prompt: str, reference_image: bytes) -> bytes:
        """
        图生图

        注意: 这是一个模拟实现。实际使用时需要根据万相 API 文档调整。
        """
        if not self.access_key or not self.access_secret:
            raise ValueError("万相 API 密钥未配置")

        # 模拟 API 调用
        return self._generate_placeholder_image(prompt)

    def _generate_placeholder_image(self, prompt: str) -> bytes:
        """
        生成占位图片（用于测试）

        实际使用时，这里应该调用真实的万相 API
        """
        from PIL import Image, ImageDraw
        from io import BytesIO

        # 创建一个简单的占位图片
        img = Image.new('RGB', (512, 512), color=(230, 245, 255))
        draw = ImageDraw.Draw(img)

        # 添加文字
        text = f"万相生成\n{prompt[:30]}..."
        draw.text((50, 200), text, fill=(50, 100, 150))

        # 添加边框
        draw.rectangle([10, 10, 501, 501], outline=(150, 200, 230), width=2)

        buffer = BytesIO()
        img.save(buffer, format='PNG')
        return buffer.getvalue()


# 单例实例
wanxiang_provider = WanxiangProvider()
