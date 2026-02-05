"""
通用 HTTP 客户端
封装认证和请求逻辑，供各提供者复用
"""
import httpx
import base64
import logging
from typing import Optional, Dict, Any
from abc import ABC, abstractmethod

from .base import ProviderError

logger = logging.getLogger(__name__)


class BaseHttpClient(ABC):
    """HTTP 客户端基类"""

    def __init__(
        self,
        base_url: str,
        timeout: float = 120.0,
        max_retries: int = 3
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries

    @abstractmethod
    def get_auth_headers(self) -> Dict[str, str]:
        """获取认证头（子类实现）"""
        pass

    def get_default_headers(self) -> Dict[str, str]:
        """获取默认请求头"""
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        headers.update(self.get_auth_headers())
        return headers

    async def post(
        self,
        endpoint: str,
        data: Dict[str, Any],
        extra_headers: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        发送 POST 请求

        Args:
            endpoint: API 端点路径
            data: 请求数据
            extra_headers: 额外的请求头

        Returns:
            响应 JSON 数据

        Raises:
            httpx.HTTPError: HTTP 错误
        """
        url = f"{self.base_url}{endpoint}"
        headers = self.get_default_headers()
        if extra_headers:
            headers.update(extra_headers)

        logger.info(f"POST {url}")
        logger.debug(f"Request data: {data}")

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for attempt in range(self.max_retries):
                try:
                    response = await client.post(url, json=data, headers=headers)
                    response.raise_for_status()
                    result = response.json()
                    logger.debug(f"Response: {result}")
                    return result
                except httpx.HTTPStatusError as e:
                    logger.error(f"HTTP error: {e.response.status_code} - {e.response.text}")
                    # 只重试 5xx 错误
                    if e.response.status_code < 500 or attempt == self.max_retries - 1:
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
                            provider="http_client",
                            error_code=str(e.response.status_code),
                            raw_error={"status": e.response.status_code, "text": e.response.text}
                        )
                except httpx.TimeoutException:
                    logger.warning(f"Timeout, attempt {attempt + 1}/{self.max_retries}")
                    if attempt == self.max_retries - 1:
                        raise ProviderError(
                            "请求超时，请稍后重试",
                            provider="http_client"
                        )
                except httpx.ConnectError as e:
                    logger.error(f"Connection error: {e}")
                    if attempt == self.max_retries - 1:
                        raise ProviderError(
                            f"无法连接到 API 服务器: {str(e)}",
                            provider="http_client"
                        )

        return {}


class BearerTokenClient(BaseHttpClient):
    """Bearer Token 认证客户端"""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 120.0,
        max_retries: int = 3
    ):
        super().__init__(base_url, timeout, max_retries)
        self.api_key = api_key

    def get_auth_headers(self) -> Dict[str, str]:
        """Bearer Token 认证"""
        return {"Authorization": f"Bearer {self.api_key}"}


class AKSKClient(BaseHttpClient):
    """
    Access Key / Secret Key 认证客户端
    用于需要签名认证的 API（如阿里云）
    """

    def __init__(
        self,
        base_url: str,
        access_key: str,
        secret_key: str,
        timeout: float = 120.0,
        max_retries: int = 3
    ):
        super().__init__(base_url, timeout, max_retries)
        self.access_key = access_key
        self.secret_key = secret_key

    def get_auth_headers(self) -> Dict[str, str]:
        """
        AKSK 认证
        注意：具体签名算法需要根据 API 文档实现
        """
        # 基础实现，具体签名逻辑由子类覆盖
        return {"X-Access-Key": self.access_key}


def encode_image_to_base64(image_data: bytes) -> str:
    """将图片数据编码为 base64 字符串"""
    return base64.b64encode(image_data).decode("utf-8")


def decode_base64_to_image(base64_str: str) -> bytes:
    """将 base64 字符串解码为图片数据"""
    # 处理可能存在的 data URL 前缀
    if "," in base64_str:
        base64_str = base64_str.split(",")[1]
    return base64.b64decode(base64_str)
