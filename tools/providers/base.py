"""
AI 模型提供者基类
定义统一的接口供不同 API 实现
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, List
from enum import Enum


class ImageSize(Enum):
    """图片尺寸枚举"""
    SIZE_512 = "512x512"
    SIZE_768 = "768x768"
    SIZE_1024 = "1024x1024"
    SIZE_1536 = "1536x1536"
    SIZE_1920 = "1920x1920"
    SIZE_2048 = "2048x2048"
    SIZE_4096 = "4096x4096"

    def __init__(self, value: str):
        self._value = value
        # 解析宽高
        parts = value.split("x")
        self._width = int(parts[0])
        self._height = int(parts[1])

    @classmethod
    def from_string(cls, size_str: str) -> "ImageSize":
        """从字符串解析尺寸"""
        for size in cls:
            if size.value == size_str:
                return size
        return cls.SIZE_1024  # 默认

    @classmethod
    def custom(cls, width: int, height: int) -> "ImageSize":
        """创建自定义尺寸

        Args:
            width: 宽度
            height: 高度

        Returns:
            创建临时 ImageSize 实例（不在枚举中）
        """
        # 创建一个新的枚举实例（不注册到枚举类）
        size_str = f"{width}x{height}"
        # 使用 __new__ 创建实例，并设置 _value_ 属性（Enum 需要）
        obj = object.__new__(cls)
        obj._value_ = size_str  # Enum 的 value 属性需要这个
        obj._value = size_str   # 我们的内部使用
        obj._width = width
        obj._height = height
        return obj

    @property
    def width(self) -> int:
        """获取宽度"""
        return self._width

    @property
    def height(self) -> int:
        """获取高度"""
        return self._height

    @property
    def aspect_ratio(self) -> float:
        """获取宽高比"""
        return self._width / self._height

    @property
    def is_landscape(self) -> bool:
        """是否为横向"""
        return self._width > self._height

    @property
    def is_portrait(self) -> bool:
        """是否为纵向"""
        return self._height > self._width


@dataclass
class GenerationConfig:
    """图片生成配置"""
    # 图片尺寸
    size: ImageSize = ImageSize.SIZE_1024
    # 生成数量（单次请求）
    n: int = 1
    # 提示词增强
    prompt_enhancement: bool = False
    # 返回格式: "url" 或 "b64_json"
    response_format: str = "b64_json"
    # 种子（用于可复现生成）
    seed: Optional[int] = None
    # 是否添加水印
    watermark: bool = False
    # 目标分辨率（图生图专用）："2K" 或 "4K"
    target_resolution: str = "2K"
    # 额外参数（不同 API 可能有特定参数）
    extra_params: dict = field(default_factory=dict)

    @property
    def width(self) -> int:
        """获取宽度"""
        return int(self.size.value.split("x")[0])

    @property
    def height(self) -> int:
        """获取高度"""
        return int(self.size.value.split("x")[1])


@dataclass
class GenerationResult:
    """图片生成结果"""
    # 图片数据（bytes）
    image_data: bytes
    # 宽度
    width: int
    # 高度
    height: int
    # 修订后的提示词（如果有）
    revised_prompt: Optional[str] = None
    # 原始响应（用于调试）
    raw_response: Optional[dict] = None


class ImageGeneratorBase(ABC):
    """图片生成器基类"""

    # 提供者名称
    name: str = "base"
    # 支持的最大尺寸
    max_size: ImageSize = ImageSize.SIZE_2048
    # 单次最大生成数量
    max_batch_size: int = 4

    @abstractmethod
    async def text_to_image(
        self,
        prompt: str,
        config: Optional[GenerationConfig] = None
    ) -> GenerationResult:
        """
        文生图

        Args:
            prompt: 文本提示词
            config: 生成配置

        Returns:
            生成结果

        Raises:
            ProviderError: 生成失败
        """
        pass

    @abstractmethod
    async def image_to_image(
        self,
        prompt: str,
        reference_image: bytes,
        config: Optional[GenerationConfig] = None
    ) -> GenerationResult:
        """
        图生图

        Args:
            prompt: 文本提示词
            reference_image: 参考图片字节数据
            config: 生成配置

        Returns:
            生成结果

        Raises:
            ProviderError: 生成失败
        """
        pass

    def validate_config(self, config: GenerationConfig) -> GenerationConfig:
        """验证并调整配置"""
        # 确保尺寸不超过最大值
        if config.size.width > self.max_size.width:
            config.size = self.max_size
        # 确保批量大小不超过限制
        if config.n > self.max_batch_size:
            config.n = self.max_batch_size
        return config

    def get_default_config(self) -> GenerationConfig:
        """获取默认配置"""
        return GenerationConfig()


class ProviderError(Exception):
    """提供者错误"""

    def __init__(
        self,
        message: str,
        provider: str = "unknown",
        error_code: Optional[str] = None,
        raw_error: Optional[dict] = None
    ):
        self.message = message
        self.provider = provider
        self.error_code = error_code
        self.raw_error = raw_error
        super().__init__(f"[{provider}] {message}")
