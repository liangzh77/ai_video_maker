#!/usr/bin/env python3
"""
文本生成命令行工具
调用各种 AI 模型进行文生文

支持的 Provider:
  - gemini: Google Gemini 原生 API
  - gemini_proxy: 中转 Gemini (OpenAI 兼容格式)
  - openrouter: OpenRouter (OpenAI 兼容格式)

用法:
    python text_generator.py --model <provider:model> --prompt <prompt> [--system <system_prompt>]

示例:
    python text_generator.py \
        --model "gemini:gemini-2.5-flash" \
        --prompt "用三句话介绍一下自己"

    python text_generator.py \
        --model "openrouter:google/gemini-2.5-flash" \
        --prompt "写一首关于春天的诗" \
        --system "你是一位中国古典诗人"
"""
# ============================================
# Windows UTF-8 输出强制设置
# ============================================
import sys
import io

if sys.stdout is None or (hasattr(sys.stdout, 'encoding') and sys.stdout.encoding != 'utf-8'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer if hasattr(sys.stdout, 'buffer') else sys.stdout, encoding='utf-8', errors='replace')
if sys.stderr is None or (hasattr(sys.stderr, 'encoding') and sys.stderr.encoding != 'utf-8'):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer if hasattr(sys.stderr, 'buffer') else sys.stderr, encoding='utf-8', errors='replace')

import argparse
import asyncio
import os
import logging
import json
from pathlib import Path

# 添加 tools 目录到 path
sys.path.insert(0, str(Path(__file__).parent))

from providers.config import settings
from providers.base import ProviderError

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    stream=sys.stderr  # 日志输出到 stderr，文本结果输出到 stdout
)
logger = logging.getLogger(__name__)


async def generate_text_gemini(
    model: str,
    prompt: str,
    system_prompt: str | None = None,
) -> str:
    """
    使用 Gemini 原生 API 生成文本

    Args:
        model: 模型名称 (如 gemini-2.5-flash)
        prompt: 用户提示词
        system_prompt: 系统提示词 (可选)

    Returns:
        生成的文本
    """
    import httpx

    api_key = settings.GEMINI_API_KEY
    base_url = settings.GEMINI_BASE_URL

    if not api_key:
        raise ProviderError("Gemini API Key 未配置", provider="gemini")

    url = f"{base_url}/models/{model}:generateContent"
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }

    # 构建请求
    contents = []

    if system_prompt:
        contents.append({
            "role": "user",
            "parts": [{"text": system_prompt}]
        })
        contents.append({
            "role": "model",
            "parts": [{"text": "好的，我会按照你的要求来回答。"}]
        })

    contents.append({
        "role": "user",
        "parts": [{"text": prompt}]
    })

    request_data = {
        "contents": contents,
        "generationConfig": {
            "responseMimeType": "text/plain",
            "responseModalities": ["TEXT"],
        }
    }

    # 如果有 system_prompt，用 systemInstruction
    if system_prompt:
        request_data = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}]
                }
            ],
            "systemInstruction": {
                "parts": [{"text": system_prompt}]
            },
            "generationConfig": {
                "responseMimeType": "text/plain",
                "responseModalities": ["TEXT"],
            }
        }

    logger.info(f"[gemini] 请求 URL: {url}")
    logger.info(f"[gemini] 模型: {model}")

    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            response = await client.post(url, json=request_data, headers=headers)
            response.raise_for_status()
            result = response.json()
        except httpx.HTTPStatusError as e:
            error_detail = ""
            try:
                error_json = e.response.json()
                if "error" in error_json:
                    error_detail = error_json["error"].get("message", "")
            except Exception:
                error_detail = e.response.text[:200] if e.response.text else ""
            raise ProviderError(
                f"API 请求失败 ({e.response.status_code}): {error_detail}",
                provider="gemini"
            )
        except httpx.TimeoutException:
            raise ProviderError("请求超时", provider="gemini")
        except httpx.ConnectError as e:
            raise ProviderError(f"连接失败: {e}", provider="gemini")

    # 解析响应
    candidates = result.get("candidates", [])
    if not candidates:
        raise ProviderError("API 返回空数据", provider="gemini", raw_error=result)

    parts = candidates[0].get("content", {}).get("parts", [])
    text_parts = [p["text"] for p in parts if "text" in p]

    if not text_parts:
        raise ProviderError("响应中未找到文本", provider="gemini", raw_error=result)

    return "\n".join(text_parts)


async def generate_text_openai_compat(
    provider_name: str,
    model: str,
    prompt: str,
    system_prompt: str | None = None,
) -> str:
    """
    使用 OpenAI 兼容格式 API 生成文本 (Gemini Proxy / OpenRouter)

    Args:
        provider_name: 提供者名称 (gemini_proxy / openrouter)
        model: 模型名称
        prompt: 用户提示词
        system_prompt: 系统提示词 (可选)

    Returns:
        生成的文本
    """
    import httpx

    if provider_name == "gemini_proxy":
        api_key = settings.GEMINI_PROXY_API_KEY
        base_url = settings.GEMINI_PROXY_BASE_URL
        if not api_key:
            raise ProviderError("中转 Gemini API Key 未配置", provider=provider_name)
        if not base_url:
            raise ProviderError("中转 Gemini Base URL 未配置", provider=provider_name)
    elif provider_name == "openrouter":
        api_key = settings.OPENROUTER_API_KEY
        base_url = settings.OPENROUTER_BASE_URL or "https://openrouter.ai/api/v1"
        if not api_key:
            raise ProviderError("OpenRouter API Key 未配置", provider=provider_name)
    else:
        raise ProviderError(f"不支持的 provider: {provider_name}", provider=provider_name)

    url = f"{base_url}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    if provider_name == "openrouter":
        headers["HTTP-Referer"] = "https://github.com/ai-video-maker"
        headers["X-Title"] = "AI Text Generator"

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    request_data = {
        "model": model,
        "messages": messages,
        "max_tokens": 4096,
    }

    logger.info(f"[{provider_name}] 请求 URL: {url}")
    logger.info(f"[{provider_name}] 模型: {model}")

    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            response = await client.post(url, json=request_data, headers=headers)
            response.raise_for_status()
            result = response.json()
        except httpx.HTTPStatusError as e:
            error_detail = ""
            try:
                error_json = e.response.json()
                if "error" in error_json:
                    error_detail = error_json["error"].get("message", "")
            except Exception:
                error_detail = e.response.text[:200] if e.response.text else ""
            raise ProviderError(
                f"API 请求失败 ({e.response.status_code}): {error_detail}",
                provider=provider_name
            )
        except httpx.TimeoutException:
            raise ProviderError("请求超时", provider=provider_name)
        except httpx.ConnectError as e:
            raise ProviderError(f"连接失败: {e}", provider=provider_name)

    # 检查错误
    if "error" in result:
        error = result["error"]
        raise ProviderError(
            error.get("message", "未知错误"),
            provider=provider_name,
            raw_error=error
        )

    # 解析响应
    choices = result.get("choices", [])
    if not choices:
        raise ProviderError("API 返回空数据", provider=provider_name, raw_error=result)

    message = choices[0].get("message", {})
    content = message.get("content", "")

    if not content:
        raise ProviderError("响应中未找到文本", provider=provider_name, raw_error=result)

    return content


async def generate_text(
    model_id: str,
    prompt: str,
    system_prompt: str | None = None,
) -> str:
    """
    根据 model_id 路由到对应的 provider 生成文本

    Args:
        model_id: 模型 ID (provider:model)
        prompt: 用户提示词
        system_prompt: 系统提示词 (可选)

    Returns:
        生成的文本
    """
    if ":" not in model_id:
        raise ValueError(f"无效的 model_id 格式: {model_id}，应为 'provider:model'")

    provider_name, model = model_id.split(":", 1)

    if provider_name == "gemini":
        return await generate_text_gemini(model, prompt, system_prompt)
    elif provider_name in ("gemini_proxy", "openrouter"):
        return await generate_text_openai_compat(provider_name, model, prompt, system_prompt)
    else:
        raise ValueError(f"不支持的 provider: {provider_name}，可选: gemini, gemini_proxy, openrouter")


def main():
    parser = argparse.ArgumentParser(description="AI 文本生成工具")
    parser.add_argument(
        "--model", "-m",
        required=True,
        help="模型 ID (格式: provider:model，如 gemini:gemini-2.5-flash)"
    )
    parser.add_argument(
        "--prompt", "-p",
        required=True,
        help="用户提示词"
    )
    parser.add_argument(
        "--system", "-s",
        default=None,
        help="系统提示词 (可选)"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="以 JSON 格式输出结果"
    )

    args = parser.parse_args()

    logger.info(f"[TextGenerator] 启动...")
    logger.info(f"[TextGenerator] 模型: {args.model}")
    logger.info(f"[TextGenerator] Prompt: {args.prompt[:80]}...")
    if args.system:
        logger.info(f"[TextGenerator] System: {args.system[:80]}...")

    try:
        result = asyncio.run(generate_text(
            model_id=args.model,
            prompt=args.prompt,
            system_prompt=args.system,
        ))

        if args.json:
            print(json.dumps({"text": result}, ensure_ascii=False))
        else:
            print(result)

    except ProviderError as e:
        logger.error(f"Error: [{e.provider}] {e.message}")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
