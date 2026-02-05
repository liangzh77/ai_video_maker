"""
豆包 API 集成（火山方舟）
字节跳动 AI 图片生成服务 - Seedream 模型
"""
import logging
from typing import Optional, List, Union

from .config import settings
from .base import (
    ImageGeneratorBase,
    GenerationConfig,
    GenerationResult,
    ImageSize,
    ProviderError,
)
from .http_client import (
    BearerTokenClient,
    encode_image_to_base64,
    decode_base64_to_image,
)
from .utils import get_image_size, calculate_output_size

logger = logging.getLogger(__name__)


class DoubaoProvider(ImageGeneratorBase):
    """
    豆包图片生成提供者（火山方舟 Seedream）

    API 文档: https://www.volcengine.com/docs/82379/1541523
    """

    name = "doubao"
    max_size = ImageSize.custom(8888, 8888)  # 不限制，由 API 自行处理
    max_batch_size = 4

    def __init__(self, model_endpoint: str):
        """
        初始化豆包 Provider

        Args:
            model_endpoint: 模型端点 ID（如 ep-m-xxx）
        """
        self.api_key = settings.DOUBAO_API_KEY
        self.base_url = settings.DOUBAO_BASE_URL
        self.model_endpoint = model_endpoint

        # 创建 HTTP 客户端
        if self.api_key:
            self.client = BearerTokenClient(
                base_url=self.base_url,
                api_key=self.api_key,
                timeout=90.0,  # 1分半超时
                max_retries=2
            )
        else:
            self.client = None

    def _check_config(self) -> None:
        """检查配置是否完整"""
        if not self.api_key:
            raise ProviderError(
                "豆包 API Key 未配置，请在 .env.local 中设置 DOUBAO_API_KEY",
                provider=self.name
            )
        if not self.model_endpoint:
            raise ProviderError(
                "豆包模型端点未配置",
                provider=self.name
            )

    def _get_min_size(self) -> ImageSize:
        """根据模型判断最小边长要求"""
        # 从 settings 获取模型显示名称
        model_name = settings.get_model_display_name("doubao", self.model_endpoint)

        # Seedream 4.5 最小边长无硬性限制，由 min_pixels 控制
        if "4.5" in model_name or "4_5" in model_name:
            return ImageSize.custom(0, 0)

        # 其他版本使用 1024
        return ImageSize.SIZE_1024

    def _get_min_pixels(self) -> int:
        """根据模型判断最小总像素要求"""
        model_name = settings.get_model_display_name("doubao", self.model_endpoint)

        # Seedream 4.5 要求最小 1920*1920 = 3686400 像素
        # 参考: https://www.volcengine.com/docs/82379/1541523
        if "4.5" in model_name or "4_5" in model_name:
            return 1920 * 1920  # 3686400

        # 其他版本无最小像素要求
        return 0

    def _resolution_to_short_side(self, resolution: str) -> int:
        """将分辨率档位转换为目标短边长度"""
        resolution_map = {
            "2K": 1440,
            "4K": 2160,
        }
        return resolution_map.get(resolution, 1440)  # 默认 2K

    def _ensure_min_size(self, config: GenerationConfig) -> GenerationConfig:
        """确保图片尺寸满足最小要求"""
        min_size = self._get_min_size()
        if config.size.width < min_size.width:
            logger.info(f"[{self.name}] 尺寸 {config.size.value} 小于最小要求 {min_size.value}，自动调整")
            config.size = min_size
        return config

    async def text_to_image(
        self,
        prompt: str,
        config: Optional[GenerationConfig] = None
    ) -> GenerationResult:
        """
        文生图 - 使用 Seedream 模型

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
        config = self._ensure_min_size(config)

        # 构建请求体
        request_data = {
            "model": self.model_endpoint,
            "prompt": prompt,
            "size": config.size.value,
            "n": 1,  # 每次生成一张
            "response_format": "b64_json",
            "watermark": config.watermark,  # 水印控制
        }

        # 添加可选参数
        if config.seed is not None:
            request_data["seed"] = config.seed

        # 添加额外参数
        if config.extra_params:
            request_data.update(config.extra_params)

        logger.info(f"[{self.name}] 文生图请求: prompt={prompt[:50]}... version={self.version.value} watermark={config.watermark}")

        try:
            response = await self.client.post(
                "/images/generations",
                data=request_data
            )

            # 解析响应
            return self._parse_response(response, config)

        except Exception as e:
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
        图生图 - 使用 Seedream 模型

        支持多张参考图片输入（最多 14 张），使用 image_urls 数组参数。

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

        # Seedream API 最多支持 14 张参考图片
        if len(images_list) > 14:
            logger.warning(f"[{self.name}] 参考图片数量 {len(images_list)} 超过限制，将只使用前 14 张")
            images_list = images_list[:14]

        logger.info(f"[{self.name}] 图生图请求: 参考图片数量={len(images_list)}")

        # 获取第一张参考图片尺寸（用于计算输出尺寸）
        ref_width, ref_height = get_image_size(images_list[0])
        logger.info(f"[{self.name}] 第一张参考图片尺寸: {ref_width}x{ref_height}")

        # 根据目标分辨率和参考图片宽高比计算输出尺寸
        min_size = self._get_min_size().width
        min_pixels = self._get_min_pixels()
        target_short_side = self._resolution_to_short_side(config.target_resolution)
        output_width, output_height = calculate_output_size(
            ref_width, ref_height,
            min_size=min_size,
            max_size=self.max_size.width,
            min_pixels=min_pixels,
            target_short_side=target_short_side
        )
        logger.info(f"[{self.name}] 目标分辨率: {config.target_resolution} (短边={target_short_side})")

        # 使用计算出的尺寸创建自定义 ImageSize
        config.size = ImageSize.custom(output_width, output_height)
        logger.info(f"[{self.name}] 输出尺寸（保持宽高比）: {output_width}x{output_height}")

        # 编码所有参考图片为 data URI 格式
        image_urls = []
        for i, img_data in enumerate(images_list):
            img_b64 = encode_image_to_base64(img_data)
            img_data_uri = f"data:image/jpeg;base64,{img_b64}"
            image_urls.append(img_data_uri)
            img_w, img_h = get_image_size(img_data)
            logger.info(f"[{self.name}] 图片 {i+1} 尺寸: {img_w}x{img_h}")

        # 构建请求体（多图生图格式，使用 image_urls 数组）
        request_data = {
            "model": self.model_endpoint,
            "prompt": prompt,
            "size": config.size.value,
            "n": 1,
            "response_format": "b64_json",
            "image_urls": image_urls,  # 多张参考图片（data URI 数组格式）
            "watermark": config.watermark,  # 水印控制
        }

        # 添加可选参数
        if config.seed is not None:
            request_data["seed"] = config.seed

        if config.extra_params:
            request_data.update(config.extra_params)

        # 详细的API参数日志（用于调试）
        logger.info(f"[{self.name}] === 图生图API调用参数 ===")
        logger.info(f"[{self.name}] model: {self.model_endpoint}")
        logger.info(f"[{self.name}] size: {config.size.value} (width={config.size.width}, height={config.size.height})")
        logger.info(f"[{self.name}] prompt: {prompt[:100]}...")
        logger.info(f"[{self.name}] image_urls count: {len(image_urls)}")
        logger.info(f"[{self.name}] watermark: {config.watermark}")
        logger.info(f"[{self.name}] =========================")

        try:
            response = await self.client.post(
                "/images/generations",
                data=request_data
            )

            return self._parse_response(response, config)

        except Exception as e:
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

        # 获取生成的图片
        data = response.get("data", [])
        if not data:
            raise ProviderError(
                "API 返回空数据",
                provider=self.name,
                raw_error=response
            )

        image_info = data[0]

        # 获取图片数据
        if "b64_json" in image_info:
            image_data = decode_base64_to_image(image_info["b64_json"])
        elif "url" in image_info:
            # 如果返回 URL，需要下载图片
            raise ProviderError(
                "URL 响应格式暂不支持，请使用 b64_json",
                provider=self.name
            )
        else:
            raise ProviderError(
                "响应中未找到图片数据",
                provider=self.name,
                raw_error=response
            )

        # 获取修订后的提示词
        revised_prompt = image_info.get("revised_prompt")

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
