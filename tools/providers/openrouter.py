"""
OpenRouter API 集成 (OpenAI 兼容格式)
通过 OpenRouter 访问多种 AI 模型
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

# 支持的宽高比
SUPPORTED_ASPECT_RATIOS = {
    "21:9": 21 / 9,
    "16:9": 16 / 9,
    "3:2": 3 / 2,
    "4:3": 4 / 3,
    "5:4": 5 / 4,
    "1:1": 1.0,
    "4:5": 4 / 5,
    "3:4": 3 / 4,
    "2:3": 2 / 3,
    "9:16": 9 / 16,
}


def get_closest_aspect_ratio(width: int, height: int) -> str:
    """根据输入图片的宽高比，找到最接近的支持比例"""
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
    """获取图片的宽高"""
    with Image.open(io.BytesIO(image_data)) as img:
        return img.size


class OpenRouterProvider(ImageGeneratorBase):
    """
    OpenRouter 图片生成提供者

    使用 OpenAI 兼容格式调用 OpenRouter API
    支持多种模型，包括 Gemini、GPT-4o 等
    """

    name = "openrouter"
    max_size = ImageSize.SIZE_2048
    max_batch_size = 1

    def __init__(self, model: str):
        """
        初始化 OpenRouter Provider

        Args:
            model: 模型名称（如 google/gemini-2.0-flash-exp:free）
        """
        self.api_key = settings.OPENROUTER_API_KEY
        self.base_url = settings.OPENROUTER_BASE_URL or "https://openrouter.ai/api/v1"
        self.model = model
        self.timeout = 300.0  # 5分钟超时

    def _check_config(self) -> None:
        """检查配置是否完整"""
        if not self.api_key:
            raise ProviderError(
                "OpenRouter API Key 未配置，请在 .env.local 中设置 OPENROUTER_API_KEY",
                provider=self.name
            )

    async def _make_request(self, messages: list) -> dict:
        """
        发送请求到 OpenRouter API (OpenAI 兼容格式)

        注意：分辨率和宽高比应在 prompt 文本中指定，OpenRouter 不支持 image_config 参数

        Args:
            messages: OpenAI 格式的消息列表

        Returns:
            API 响应
        """
        url = f"{self.base_url}/chat/completions"

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://github.com/anthropics/claude-code",
            "X-Title": "AI Image Generator",
        }

        request_data = {
            "model": self.model,
            "messages": messages,
            "max_tokens": 4096,
            "modalities": ["image", "text"],  # 需要图片输出
            "stream": False,  # 禁用流式响应，确保返回完整 JSON
        }

        logger.info(f"[{self.name}] 请求 URL: {url}")
        logger.info(f"[{self.name}] 模型: {self.model}")

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.post(url, json=request_data, headers=headers)
                response.raise_for_status()

                # 记录响应长度便于调试
                response_text = response.text.strip()  # 去除前后空白
                logger.info(f"[{self.name}] 响应长度: {len(response_text)} 字符 (strip后)")

                # 尝试解析 JSON
                try:
                    import json
                    return json.loads(response_text)
                except Exception as json_err:
                    # JSON 解析失败，记录响应内容前500字符
                    logger.error(f"[{self.name}] JSON 解析失败: {json_err}")
                    logger.error(f"[{self.name}] 响应内容前500字符: {response_text[:500]}")
                    logger.error(f"[{self.name}] 响应内容后500字符: {response_text[-500:]}")
                    raise ProviderError(
                        f"响应解析失败: {str(json_err)}",
                        provider=self.name,
                        raw_error={"response_preview": response_text[:1000]}
                    )
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
        文生图 - 使用 OpenRouter

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
        图生图 - 使用 OpenRouter

        支持多张参考图片输入，所有图片会作为上下文发送给模型。

        Args:
            prompt: 文本提示词
            reference_images: 参考图片数据，支持单张 (bytes) 或多张 (List[bytes])
            config: 生成配置

        Returns:
            生成结果
        """
        self._check_config()

        if config is None:
            config = self.get_default_config()
        config = self.validate_config(config)

        # 统一转换为列表格式
        if isinstance(reference_images, bytes):
            images_list = [reference_images]
        else:
            images_list = reference_images

        if not images_list:
            raise ProviderError("至少需要提供一张参考图片", provider=self.name)

        # 使用第一张图片计算宽高比
        ref_width, ref_height = get_image_dimensions(images_list[0])
        aspect_ratio = get_closest_aspect_ratio(ref_width, ref_height)
        logger.info(f"[{self.name}] 图生图请求: prompt={prompt[:50]}...")
        logger.info(f"[{self.name}] 参考图片数量: {len(images_list)}")
        logger.info(f"[{self.name}] 第一张图片尺寸: {ref_width}x{ref_height}, 宽高比: {aspect_ratio}")

        # 从 config 获取目标分辨率，默认 4K
        image_size = getattr(config, 'target_resolution', '4K') or '4K'

        # 增强 prompt：添加宽高比和分辨率前缀（OpenRouter 需要在 prompt 中指定）
        enhanced_prompt = f"宽高比{aspect_ratio}。{image_size}分辨率。{prompt}"
        logger.info(f"[{self.name}] 增强后的 prompt: {enhanced_prompt[:80]}...")

        # 构建 content 数组，包含所有参考图片
        content = []
        for i, img_data in enumerate(images_list):
            img_b64 = base64.b64encode(img_data).decode('utf-8')
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{img_b64}"
                }
            })
            img_w, img_h = get_image_dimensions(img_data)
            logger.info(f"[{self.name}] 图片 {i+1} 尺寸: {img_w}x{img_h}")

        # 添加文本 prompt
        content.append({"type": "text", "text": enhanced_prompt})

        # OpenAI 格式消息（包含多张图片）
        messages = [
            {
                "role": "user",
                "content": content
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
        images = message.get("images", [])  # OpenRouter 图片在 images 数组中

        image_data = None
        revised_prompt = None

        # 优先从 images 数组获取图片（OpenRouter 格式）
        if images:
            image_item = images[0]

            # images 可能是字符串数组或 dict 数组
            image_b64 = ""
            if isinstance(image_item, str):
                image_b64 = image_item
            elif isinstance(image_item, dict):
                # 嵌套格式: {"type": "image_url", "image_url": {"url": "data:..."}}
                if "image_url" in image_item:
                    image_b64 = image_item["image_url"].get("url", "")
                else:
                    # 简单格式: {"url": "data:..."} 或 {"b64_json": "..."}
                    image_b64 = image_item.get("url") or image_item.get("b64_json") or image_item.get("data", "")

            if image_b64:
                # 可能带有 data URL 前缀，也可能是纯 base64
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

        if not image_data:
            import json as _json
            # 收集诊断信息：finish_reason、error 字段、模型文本
            finish_reason = choices[0].get("finish_reason", "unknown")
            choice_error = choices[0].get("error")
            response_error = response.get("error")
            model_text = ""
            if choice_error:
                model_text = choice_error if isinstance(choice_error, str) else _json.dumps(choice_error, ensure_ascii=False)[:300]
            elif response_error:
                model_text = response_error if isinstance(response_error, str) else _json.dumps(response_error, ensure_ascii=False)[:300]
            elif revised_prompt:
                model_text = revised_prompt[:200]
            elif isinstance(content, str):
                model_text = content[:200]
            # 兜底：输出 choice 关键字段
            if not model_text:
                model_text = f"choice: {_json.dumps(choices[0], ensure_ascii=False)[:300]}"
            detail = f"finish_reason={finish_reason}, {model_text}"
            raise ProviderError(
                f"响应中未找到图片数据 ({detail})",
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
