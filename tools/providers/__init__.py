"""
AI 模型提供者包
支持多个图片生成 API: Doubao, Gemini, OpenRouter, GeminiProxy
"""
from .base import (
    ImageGeneratorBase,
    GenerationConfig,
    GenerationResult,
    ImageSize,
    ProviderError,
)
from .config import settings
from .doubao import DoubaoProvider
from .gemini import GeminiProvider
from .gemini_proxy import GeminiProxyProvider
from .openrouter import OpenRouterProvider

__all__ = [
    # 基础类
    "ImageGeneratorBase",
    "GenerationConfig",
    "GenerationResult",
    "ImageSize",
    "ProviderError",
    # 配置
    "settings",
    # Providers
    "DoubaoProvider",
    "GeminiProvider",
    "GeminiProxyProvider",
    "OpenRouterProvider",
]


def create_provider(model_id: str) -> ImageGeneratorBase:
    """
    根据模型 ID 创建对应的 Provider

    Args:
        model_id: 模型 ID，格式为 provider:endpoint
                  例如: gemini:gemini-2.0-flash-exp-image-generation
                       doubao:ep-xxx
                       openrouter:google/gemini-2.0-flash

    Returns:
        对应的 Provider 实例
    """
    if ":" not in model_id:
        raise ValueError(f"Invalid model_id format: {model_id}. Expected 'provider:endpoint'")

    provider_name, endpoint = model_id.split(":", 1)

    if provider_name == "gemini":
        return GeminiProvider(model=endpoint)
    elif provider_name == "doubao":
        return DoubaoProvider(model_endpoint=endpoint)
    elif provider_name == "openrouter":
        return OpenRouterProvider(model=endpoint)
    elif provider_name == "gemini_proxy":
        return GeminiProxyProvider(model=endpoint)
    else:
        raise ValueError(f"Unknown provider: {provider_name}")
