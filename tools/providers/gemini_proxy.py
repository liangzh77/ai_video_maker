"""
中转 Gemini API 集成 (OpenAI 兼容格式)
使用中转代理访问 Gemini 服务
"""
import httpx
import logging
import io
import base64
from typing import Optional, List, Union
from PIL import Image

from .config import settings
from .base import (
    ImageGeneratorBase,
    GenerationConfig,
    GenerationResult,
    ImageSize,
    ProviderError,
)

logger = logging.getLogger(__name__)


def get_image_dimensions(image_data: bytes) -> tuple[int, int]:
    """获取图片的宽高"""
    with Image.open(io.BytesIO(image_data)) as img:
        return img.size


class GeminiProxyProvider(ImageGeneratorBase):
    """
    中转 Gemini 图片生成提供者

    使用 OpenAI 兼容格式调用中转代理
    """

    name = "gemini_proxy"
    max_size = ImageSize.SIZE_2048
    max_batch_size = 1

    def __init__(self, model: str):
        """
        初始化中转 Gemini Provider

        Args:
            model: 模型名称（如 gemini-3-pro-image-preview）
        """
        self.api_key = settings.GEMINI_PROXY_API_KEY
        self.base_url = settings.GEMINI_PROXY_BASE_URL
        self.model = model
        self.timeout = 300.0  # 5分钟超时

    def _check_config(self) -> None:
        """检查配置是否完整"""
        if not self.api_key:
            raise ProviderError(
                "中转 Gemini API Key 未配置，请在 .env.local 中设置 GEMINI_PROXY_API_KEY",
                provider=self.name
            )
        if not self.base_url:
            raise ProviderError(
                "中转 Gemini Base URL 未配置，请在 .env.local 中设置 GEMINI_PROXY_BASE_URL",
                provider=self.name
            )

    async def _make_request(self, messages: list) -> dict:
        """
        发送请求到中转 API (OpenAI 兼容格式)

        Args:
            messages: OpenAI 格式的消息列表

        Returns:
            API 响应
        """
        url = f"{self.base_url}/chat/completions"

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

        request_data = {
            "model": self.model,
            "messages": messages,
            "max_tokens": 4096,
        }

        logger.info(f"[{self.name}] 请求 URL: {url}")
        logger.info(f"[{self.name}] 模型: {self.model}")

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.post(url, json=request_data, headers=headers)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as e:
                logger.error(f"[{self.name}] HTTP 错误: {e.response.status_code} - {e.response.text}")
                # 尝试从响应中提取详细错误信息
                error_detail = ""
                try:
                    error_json = e.response.json()
                    if "error" in error_json:
                        error_detail = error_json["error"].get("message", "")
                except Exception:
                    error_detail = e.response.text[:200] if e.response.text else ""

                error_msg = f"API 请求失败 ({e.response.status_code})"
                if error_detail:
                    error_msg += f": {error_detail}"

                raise ProviderError(
                    error_msg,
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
            except httpx.ConnectError as e:
                logger.error(f"[{self.name}] 连接失败: {e}")
                raise ProviderError(
                    f"无法连接到 API 服务器: {str(e)}",
                    provider=self.name
                )

    async def text_to_image(
        self,
        prompt: str,
        config: Optional[GenerationConfig] = None
    ) -> GenerationResult:
        """
        文生图 - 使用中转 Gemini

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

        logger.info(f"[{self.name}] 文生图请求: prompt={prompt[:50]}...")

        # OpenAI 格式消息
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt}
                ]
            }
        ]

        try:
            response = await self._make_request(messages)
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
        reference_images: Union[bytes, List[bytes]],
        config: Optional[GenerationConfig] = None
    ) -> GenerationResult:
        """
        图生图 - 使用中转 Gemini

        Args:
            prompt: 文本提示词
            reference_images: 参考图片数据，支持单张 (bytes) 或多张 (List[bytes])
                              注意：当前实现仅使用第一张图片
            config: 生成配置

        Returns:
            生成结果
        """
        self._check_config()

        if config is None:
            config = self.get_default_config()
        config = self.validate_config(config)

        # 统一转换为列表格式，取第一张图片
        if isinstance(reference_images, bytes):
            reference_image = reference_images
        else:
            if not reference_images:
                raise ProviderError("至少需要提供一张参考图片", provider=self.name)
            reference_image = reference_images[0]
            if len(reference_images) > 1:
                logger.warning(f"[{self.name}] 当前仅支持单图输入，将只使用第一张图片")

        ref_width, ref_height = get_image_dimensions(reference_image)
        logger.info(f"[{self.name}] 图生图请求: prompt={prompt[:50]}...")
        logger.info(f"[{self.name}] 参考图片尺寸: {ref_width}x{ref_height}")

        # 从 config 获取目标分辨率，默认 2K
        image_size = config.target_resolution if config.target_resolution else '2K'
        logger.info(f"[{self.name}] 目标分辨率: {image_size}")

        # 计算宽高比
        aspect_ratio = f"{ref_width}:{ref_height}"
        if ref_width > ref_height:
            # 横向
            if ref_width / ref_height > 1.5:
                aspect_ratio = "16:9"
            else:
                aspect_ratio = "4:3"
        elif ref_height > ref_width:
            # 竖向
            if ref_height / ref_width > 1.5:
                aspect_ratio = "9:16"
            else:
                aspect_ratio = "3:4"
        else:
            aspect_ratio = "1:1"

        # 增强 prompt：添加宽高比和分辨率提示（中转服务可能不支持 imageConfig，在 prompt 中指定）
        enhanced_prompt = f"宽高比{aspect_ratio}。{image_size}分辨率。{prompt}"
        logger.info(f"[{self.name}] 增强后的 prompt: {enhanced_prompt[:80]}...")

        # 编码参考图片为 base64
        ref_image_b64 = base64.b64encode(reference_image).decode('utf-8')

        # OpenAI 格式消息（包含图片）
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{ref_image_b64}"
                        }
                    },
                    {"type": "text", "text": enhanced_prompt}
                ]
            }
        ]

        try:
            response = await self._make_request(messages)
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
        """解析 OpenAI 格式的 API 响应"""
        # 检查错误
        if "error" in response:
            error = response["error"]
            raise ProviderError(
                error.get("message", "未知错误"),
                provider=self.name,
                error_code=error.get("code"),
                raw_error=error
            )

        # 获取 choices
        choices = response.get("choices", [])
        if not choices:
            raise ProviderError(
                "API 返回空数据",
                provider=self.name,
                raw_error=response
            )

        # 解析 message
        message = choices[0].get("message", {})
        content = message.get("content")
        images = message.get("images", [])  # 某些中转服务可能返回 images 数组

        # 记录响应结构便于调试
        logger.info(f"[{self.name}] message keys: {list(message.keys())}")
        if images:
            logger.info(f"[{self.name}] images 数组长度: {len(images)}")

        image_data = None
        revised_prompt = None

        # 优先从 images 数组获取图片
        if images:
            image_item = images[0]

            image_b64 = ""
            if isinstance(image_item, str):
                image_b64 = image_item
            elif isinstance(image_item, dict):
                if "image_url" in image_item:
                    image_b64 = image_item["image_url"].get("url", "")
                else:
                    image_b64 = image_item.get("url") or image_item.get("b64_json") or image_item.get("data", "")

            if image_b64:
                if image_b64.startswith("data:"):
                    b64_data = image_b64.split(",")[1] if "," in image_b64 else ""
                    image_data = base64.b64decode(b64_data)
                else:
                    image_data = base64.b64decode(image_b64)
                logger.info(f"[{self.name}] 从 message.images 获取图片")

        # 如果 images 为空，尝试从 content 解析
        if not image_data:
            if isinstance(content, list):
                # 多模态响应
                for part in content:
                    part_type = part.get("type", "")
                    if part_type == "image_url":
                        img_url = part.get("image_url", {}).get("url", "")
                        if img_url.startswith("data:"):
                            # base64 数据 URL
                            b64_data = img_url.split(",")[1] if "," in img_url else ""
                            image_data = base64.b64decode(b64_data)
                    elif part_type == "text":
                        revised_prompt = part.get("text", "")
            elif isinstance(content, str):
                # 纯文本响应，检查是否包含 base64 图片
                revised_prompt = content
                import re
                b64_pattern = r'data:image/[^;]+;base64,([A-Za-z0-9+/=]+)'
                match = re.search(b64_pattern, content)
                if match:
                    image_data = base64.b64decode(match.group(1))
                    logger.info(f"[{self.name}] 从 content 正则匹配获取图片")

        if not image_data:
            # 记录更多调试信息
            logger.error(f"[{self.name}] 未找到图片，content 类型: {type(content)}")
            if isinstance(content, str):
                logger.error(f"[{self.name}] content 前200字符: {content[:200]}")
            elif isinstance(content, list):
                logger.error(f"[{self.name}] content 列表: {content}")
            raise ProviderError(
                "响应中未找到图片数据",
                provider=self.name,
                raw_error=response
            )

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
