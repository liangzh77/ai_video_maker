#!/usr/bin/env python3
"""
语音识别命令行工具
调用 Gemini API 进行语音转文字

支持的 Provider:
  - gemini: Google Gemini 原生 API (推荐，支持音频 inlineData)
  - gemini_proxy: 中转 Gemini (OpenAI 兼容格式，需支持 input_audio)
  - openrouter: OpenRouter (OpenAI 兼容格式，需支持 input_audio)

支持的音频格式: mp3, wav, flac, aac, ogg

用法:
    python speech_recognizer.py --model <provider:model> --audio <audio_file> [--prompt <prompt>]

示例:
    python speech_recognizer.py \
        --model "gemini:gemini-2.5-flash" \
        --audio "recording.mp3"

    python speech_recognizer.py \
        --model "gemini:gemini-2.5-flash" \
        --audio "interview.wav" \
        --prompt "请将这段音频转录为文字，并添加标点符号"

    python speech_recognizer.py \
        --model "gemini:gemini-2.5-flash" \
        --audio "meeting.mp3" \
        --prompt "请将这段会议录音整理为会议纪要" \
        --json
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
import base64
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
    stream=sys.stderr  # 日志输出到 stderr，识别结果输出到 stdout
)
logger = logging.getLogger(__name__)

# 音频格式 -> MIME 类型映射
AUDIO_MIME_TYPES = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.wma': 'audio/x-ms-wma',
    '.opus': 'audio/opus',
}

DEFAULT_PROMPT = "请将这段音频转录为文字，保持原始语言，添加合适的标点符号。"


def get_audio_mime_type(file_path: str) -> str:
    ext = Path(file_path).suffix.lower()
    mime = AUDIO_MIME_TYPES.get(ext)
    if not mime:
        raise ValueError(f"不支持的音频格式: {ext}，支持: {', '.join(AUDIO_MIME_TYPES.keys())}")
    return mime


def read_audio_base64(file_path: str) -> str:
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"音频文件不存在: {file_path}")
    file_size = path.stat().st_size
    if file_size > 20 * 1024 * 1024:  # 20MB 限制
        raise ValueError(f"音频文件过大: {file_size / 1024 / 1024:.1f}MB，上限 20MB")
    logger.info(f"[SpeechRecognizer] 文件大小: {file_size / 1024:.1f}KB")
    with open(path, "rb") as f:
        return base64.standard_b64encode(f.read()).decode("ascii")


async def recognize_gemini(
    model: str,
    audio_path: str,
    prompt: str,
) -> str:
    """
    使用 Gemini 原生 API 识别语音

    通过 generateContent 端点，将音频以 inlineData (base64) 方式传入。

    Args:
        model: 模型名称 (如 gemini-2.5-flash)
        audio_path: 音频文件路径
        prompt: 提示词

    Returns:
        识别出的文本
    """
    import httpx

    api_key = settings.GEMINI_API_KEY
    base_url = settings.GEMINI_BASE_URL

    if not api_key:
        raise ProviderError("Gemini API Key 未配置", provider="gemini")

    mime_type = get_audio_mime_type(audio_path)
    audio_b64 = read_audio_base64(audio_path)

    url = f"{base_url}/models/{model}:generateContent"
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }

    request_data = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": audio_b64,
                        }
                    },
                    {"text": prompt},
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "text/plain",
            "responseModalities": ["TEXT"],
        }
    }

    logger.info(f"[gemini] 请求 URL: {url}")
    logger.info(f"[gemini] 模型: {model}")
    logger.info(f"[gemini] 音频 MIME: {mime_type}")

    async with httpx.AsyncClient(timeout=120.0) as client:
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
            raise ProviderError("请求超时（音频文件可能过大）", provider="gemini")
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


async def recognize_openai_compat(
    provider_name: str,
    model: str,
    audio_path: str,
    prompt: str,
) -> str:
    """
    使用 OpenAI 兼容格式 API 识别语音 (Gemini Proxy / OpenRouter)

    通过 chat/completions 端点，将音频以 input_audio content part 传入。

    Args:
        provider_name: 提供者名称 (gemini_proxy / openrouter)
        model: 模型名称
        audio_path: 音频文件路径
        prompt: 提示词

    Returns:
        识别出的文本
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

    mime_type = get_audio_mime_type(audio_path)
    audio_b64 = read_audio_base64(audio_path)

    # 音频格式标识 (OpenAI 格式用不带前缀的格式名)
    ext = Path(audio_path).suffix.lower().lstrip('.')
    audio_format = ext if ext != 'mp3' else 'mp3'

    url = f"{base_url}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    if provider_name == "openrouter":
        headers["HTTP-Referer"] = "https://github.com/ai-video-maker"
        headers["X-Title"] = "AI Speech Recognizer"

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": audio_b64,
                        "format": audio_format,
                    }
                },
                {
                    "type": "text",
                    "text": prompt,
                }
            ]
        }
    ]

    request_data = {
        "model": model,
        "messages": messages,
        "max_tokens": 4096,
    }

    logger.info(f"[{provider_name}] 请求 URL: {url}")
    logger.info(f"[{provider_name}] 模型: {model}")
    logger.info(f"[{provider_name}] 音频格式: {audio_format}")

    async with httpx.AsyncClient(timeout=120.0) as client:
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
            raise ProviderError("请求超时（音频文件可能过大）", provider=provider_name)
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


async def recognize_speech(
    model_id: str,
    audio_path: str,
    prompt: str | None = None,
) -> str:
    """
    根据 model_id 路由到对应的 provider 进行语音识别

    Args:
        model_id: 模型 ID (provider:model)
        audio_path: 音频文件路径
        prompt: 提示词 (可选，默认为转录指令)

    Returns:
        识别出的文本
    """
    if ":" not in model_id:
        raise ValueError(f"无效的 model_id 格式: {model_id}，应为 'provider:model'")

    provider_name, model = model_id.split(":", 1)
    actual_prompt = prompt or DEFAULT_PROMPT

    if provider_name == "gemini":
        return await recognize_gemini(model, audio_path, actual_prompt)
    elif provider_name in ("gemini_proxy", "openrouter"):
        return await recognize_openai_compat(provider_name, model, audio_path, actual_prompt)
    else:
        raise ValueError(f"不支持的 provider: {provider_name}，可选: gemini, gemini_proxy, openrouter")


def main():
    parser = argparse.ArgumentParser(description="AI 语音识别工具")
    parser.add_argument(
        "--model", "-m",
        required=True,
        help="模型 ID (格式: provider:model，如 gemini:gemini-2.5-flash)"
    )
    parser.add_argument(
        "--audio", "-a",
        required=True,
        help="音频文件路径 (支持 mp3/wav/flac/aac/ogg/m4a)"
    )
    parser.add_argument(
        "--prompt", "-p",
        default=None,
        help="提示词 (可选，默认为转录指令)"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="以 JSON 格式输出结果"
    )

    args = parser.parse_args()

    logger.info(f"[SpeechRecognizer] 启动...")
    logger.info(f"[SpeechRecognizer] 模型: {args.model}")
    logger.info(f"[SpeechRecognizer] 音频: {args.audio}")
    if args.prompt:
        logger.info(f"[SpeechRecognizer] Prompt: {args.prompt[:80]}...")

    try:
        result = asyncio.run(recognize_speech(
            model_id=args.model,
            audio_path=args.audio,
            prompt=args.prompt,
        ))

        if args.json:
            print(json.dumps({"text": result}, ensure_ascii=False))
        else:
            print(result)

    except ProviderError as e:
        logger.error(f"Error: [{e.provider}] {e.message}")
        sys.exit(1)
    except FileNotFoundError as e:
        logger.error(f"Error: {str(e)}")
        sys.exit(1)
    except ValueError as e:
        logger.error(f"Error: {str(e)}")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
