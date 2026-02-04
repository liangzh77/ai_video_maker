"""
Gemini API 集成 (Nano Banana Pro)
Google AI 图片生成服务
"""
import httpx
import logging
import io
from typing import Optional
from PIL import Image

from .config import settings
from .base import (
    ImageGeneratorBase,
    GenerationConfig,
    GenerationResult,
    ImageSize,
    ProviderError,
)
from .http_client import (
    encode_image_to_base64,
    decode_base64_to_image,
)

logger = logging.getLogger(__name__)

# Gemini 支持的宽高比
SUPPORTED_ASPECT_RATIOS = {
    "21:9": 21 / 9,    # 2.333 - 超宽
    "16:9": 16 / 9,    # 1.778 - 宽屏
    "3:2": 3 / 2,      # 1.5
    "4:3": 4 / 3,      # 1.333
    "5:4": 5 / 4,      # 1.25
    "1:1": 1.0,        # 正方形
    "4:5": 4 / 5,      # 0.8
    "3:4": 3 / 4,      # 0.75
    "2:3": 2 / 3,      # 0.667
    "9:16": 9 / 16,    # 0.5625 - 竖屏
}


def get_closest_aspect_ratio(width: int, height: int) -> str:
    """
    根据输入图片的宽高比，找到 Gemini 支持的最接近的宽高比
    """
    input_ratio = width / height
    closest_ratio = "1:1"
    min_diff = float("inf")

    for ratio_str, ratio_value in SUPPORTED_ASPECT_RATIOS.items():
        diff = abs(input_ratio - ratio_value)
        if diff < min_diff:
            min_diff = diff
            closest_ratio = ratio_str

    return closest_ratio


def get_image_dimensions(image_data: bytes) -> tuple[int, int]:
    """
    获取图片的宽高
    """
    with Image.open(io.BytesIO(image_data)) as img:
        return img.size


class GeminiProvider(ImageGeneratorBase):
    """
    Gemini 图片生成提供者 (Nano Banana Pro)

    API 文档: https://ai.google.dev/gemini-api/docs/image-generation
    支持 4K 分辨率和自适应宽高比
    """

    name = "gemini"
    max_size = ImageSize.SIZE_2048  # 支持 4K
    max_batch_size = 1  # Gemini 每次只生成一张

    # 默认分辨率设置
    DEFAULT_IMAGE_SIZE = "4K"  # 可选: "1K", "2K", "4K"

    def __init__(self, model: str):
        """
        初始化 Gemini Provider

        Args:
            model: 模型名称（如 gemini-3-pro-image-preview）
        """
        self.api_key = settings.GEMINI_API_KEY
        self.base_url = settings.GEMINI_BASE_URL
        self.model = model
        self.timeout = 300.0  # 4K 图片生成需要更长时间

    def _check_config(self) -> None:
        """检查配置是否完整"""
        if not self.api_key:
            raise ProviderError(
                "Gemini API Key 未配置，请在 .env.local 中设置 GEMINI_API_KEY",
                provider=self.name
            )

    async def _make_request(
        self,
        contents: list,
        aspect_ratio: Optional[str] = None,
        image_size: Optional[str] = None
    ) -> dict:
        """
        发送请求到 Gemini API

        Args:
            contents: 请求内容
            aspect_ratio: 宽高比（如 "9:16", "16:9", "1:1" 等）
            image_size: 分辨率（"1K", "2K", "4K"）

        Returns:
            API 响应
        """
        url = f"{self.base_url}/models/{self.model}:generateContent"

        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
        }

        # 构建 imageConfig
        image_config = {}
        if aspect_ratio:
            image_config["aspectRatio"] = aspect_ratio
        if image_size:
            image_config["imageSize"] = image_size

        request_data = {
            "contents": contents,
            "generationConfig": {
                "responseModalities": ["TEXT", "IMAGE"],
            }
        }

        # 如果有 imageConfig，添加到 generationConfig
        if image_config:
            request_data["generationConfig"]["imageConfig"] = image_config

        logger.info(f"[{self.name}] 请求 URL: {url}")
        logger.info(f"[{self.name}] 模型: {self.model}")
        if aspect_ratio:
            logger.info(f"[{self.name}] 宽高比: {aspect_ratio}")
        if image_size:
            logger.info(f"[{self.name}] 分辨率: {image_size}")

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.post(url, json=request_data, headers=headers)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as e:
                logger.error(f"[{self.name}] HTTP 错误: {e.response.status_code} - {e.response.text}")
                raise ProviderError(
                    f"API 请求失败: {e.response.status_code}",
                    provider=self.name,
                    error_code=str(e.response.status_code),
                    raw_error={"status": e.response.status_code, "text": e.response.text}
                )
            except httpx.TimeoutException:
                logger.error(f"[{self.name}] 请求超时")
                raise ProviderError(
                    "请求超时，请稍后重试",
                    provider=self.name
                )

    async def text_to_image(
        self,
        prompt: str,
        config: Optional[GenerationConfig] = None
    ) -> GenerationResult:
        """
        文生图 - 使用 Gemini 模型

        Args:
            prompt: 文本提示词
            config: 生成配置

        Returns:
            生成结果
        """
        self._check_config()

        if config is None:
            config = self.get_default_config()
        config = self.validate_config(config)

        # 根据配置尺寸计算宽高比
        aspect_ratio = get_closest_aspect_ratio(config.size.width, config.size.height)

        logger.info(f"[{self.name}] 文生图请求: prompt={prompt[:50]}...")

        # 构建请求内容
        contents = [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ]

        try:
            response = await self._make_request(
                contents,
                aspect_ratio=aspect_ratio,
                image_size=self.DEFAULT_IMAGE_SIZE
            )
            return self._parse_response(response, config)
        except Exception as e:
            if isinstance(e, ProviderError):
                raise
            logger.error(f"[{self.name}] 文生图失败: {e}")
            raise ProviderError(
                f"图片生成失败: {str(e)}",
                provider=self.name,
                raw_error={"error": str(e)}
            )

    async def image_to_image(
        self,
        prompt: str,
        reference_image: bytes,
        config: Optional[GenerationConfig] = None
    ) -> GenerationResult:
        """
        图生图 - 使用 Gemini 模型

        根据参考图片的宽高比自动选择最接近的 Gemini 支持比例，
        输出 4K 分辨率图片。

        Args:
            prompt: 文本提示词
            reference_image: 参考图片数据
            config: 生成配置

        Returns:
            生成结果
        """
        self._check_config()

        if config is None:
            config = self.get_default_config()
        config = self.validate_config(config)

        # 获取参考图片尺寸，计算最接近的宽高比
        ref_width, ref_height = get_image_dimensions(reference_image)
        aspect_ratio = get_closest_aspect_ratio(ref_width, ref_height)

        logger.info(f"[{self.name}] 图生图请求: prompt={prompt[:50]}...")
        logger.info(f"[{self.name}] 参考图片尺寸: {ref_width}x{ref_height}")

        # 编码参考图片为 base64
        ref_image_b64 = encode_image_to_base64(reference_image)

        # 构建请求内容（包含图片和文本）
        contents = [
            {
                "parts": [
                    {
                        "inlineData": {
                            "mimeType": "image/jpeg",
                            "data": ref_image_b64
                        }
                    },
                    {"text": prompt}
                ]
            }
        ]

        # 使用 config 中的 target_resolution，如果未设置则使用默认值
        image_size = config.target_resolution if config.target_resolution else self.DEFAULT_IMAGE_SIZE
        logger.info(f"[{self.name}] 使用分辨率: {image_size}")

        try:
            response = await self._make_request(
                contents,
                aspect_ratio=aspect_ratio,
                image_size=image_size
            )
            return self._parse_response(response, config)
        except Exception as e:
            if isinstance(e, ProviderError):
                raise
            logger.error(f"[{self.name}] 图生图失败: {e}")
            raise ProviderError(
                f"图片生成失败: {str(e)}",
                provider=self.name,
                raw_error={"error": str(e)}
            )

    def _parse_response(
        self,
        response: dict,
        config: GenerationConfig
    ) -> GenerationResult:
        """解析 API 响应"""
        # 检查错误
        if "error" in response:
            error = response["error"]
            raise ProviderError(
                error.get("message", "未知错误"),
                provider=self.name,
                error_code=error.get("code"),
                raw_error=error
            )

        # 获取候选响应
        candidates = response.get("candidates", [])
        if not candidates:
            raise ProviderError(
                "API 返回空数据",
                provider=self.name,
                raw_error=response
            )

        # 解析 parts 找到图片
        parts = candidates[0].get("content", {}).get("parts", [])
        image_data = None
        revised_prompt = None

        for part in parts:
            if "inlineData" in part:
                # 找到图片数据
                inline_data = part["inlineData"]
                base64_data = inline_data.get("data", "")
                if base64_data:
                    image_data = decode_base64_to_image(base64_data)
            elif "text" in part:
                # 可能包含修订后的提示词或描述
                revised_prompt = part["text"]

        if not image_data:
            raise ProviderError(
                "响应中未找到图片数据",
                provider=self.name,
                raw_error=response
            )

        # Gemini 返回的图片尺寸可能是动态的，使用默认值
        return GenerationResult(
            image_data=image_data,
            width=config.size.width,
            height=config.size.height,
            revised_prompt=revised_prompt,
            raw_response=response
        )

    def get_default_config(self) -> GenerationConfig:
        """获取默认配置"""
        return GenerationConfig(
            size=ImageSize.SIZE_1024,
            n=1,
            response_format="b64_json"
        )
