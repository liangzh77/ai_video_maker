"""
Provider 配置模块
从环境变量或 .env.local 文件读取配置
"""
import os
import sys
from dataclasses import dataclass, field
from typing import Dict, Optional
from pathlib import Path


def load_env_file():
    """
    加载 .env.local 文件
    优先级：
    1. ENV_FILE 环境变量指定的路径
    2. 从当前脚本目录向上查找
    3. app 子目录
    """
    env_file = None

    # 1. 优先使用环境变量指定的路径
    env_path_from_env = os.environ.get("ENV_FILE")
    if env_path_from_env:
        env_file = Path(env_path_from_env)
        if not env_file.exists():
            print(f"[Config] Warning: ENV_FILE specified but not found: {env_file}", file=sys.stderr)
            env_file = None

    # 2. 从当前脚本目录向上查找
    if not env_file:
        current = Path(__file__).parent.parent.parent  # tools/providers -> tools -> project_root
        env_file = current / ".env.local"

        if not env_file.exists():
            # 也尝试 app 目录
            env_file = current / "app" / ".env.local"

        if not env_file.exists():
            env_file = None

    if env_file and env_file.exists():
        print(f"[Config] Loading .env.local from: {env_file}", file=sys.stderr)
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and value:
                        os.environ.setdefault(key, value)
    else:
        print(f"[Config] Warning: .env.local not found", file=sys.stderr)


# 在模块加载时自动加载环境变量
load_env_file()


@dataclass
class ProviderSettings:
    """Provider 配置"""

    # 豆包
    DOUBAO_API_KEY: str = field(default_factory=lambda: os.getenv("DOUBAO_API_KEY", ""))
    DOUBAO_BASE_URL: str = field(default_factory=lambda: os.getenv("DOUBAO_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"))

    # Gemini
    GEMINI_API_KEY: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", ""))
    GEMINI_BASE_URL: str = field(default_factory=lambda: os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"))

    # Gemini 中转
    GEMINI_PROXY_API_KEY: str = field(default_factory=lambda: os.getenv("GEMINI_PROXY_API_KEY", ""))
    GEMINI_PROXY_BASE_URL: str = field(default_factory=lambda: os.getenv("GEMINI_PROXY_BASE_URL", ""))

    # OpenRouter
    OPENROUTER_API_KEY: str = field(default_factory=lambda: os.getenv("OPENROUTER_API_KEY", ""))
    OPENROUTER_BASE_URL: str = field(default_factory=lambda: os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"))

    # 模型显示名称映射（从环境变量加载）
    _model_names: Dict[str, str] = field(default_factory=dict)

    def __post_init__(self):
        """加载模型显示名称"""
        # 加载各 provider 的模型配置
        # 格式: PROVIDER_MODEL_N=endpoint:display_name
        for prefix in ["GEMINI_MODEL_", "OPENROUTER_MODEL_", "DOUBAO_MODEL_", "GEMINI_PROXY_MODEL_"]:
            for i in range(1, 11):
                env_key = f"{prefix}{i}"
                env_value = os.getenv(env_key, "")
                if env_value and ":" in env_value:
                    endpoint, name = env_value.split(":", 1)
                    provider = prefix.replace("_MODEL_", "").lower()
                    self._model_names[f"{provider}:{endpoint}"] = name

    def get_model_display_name(self, provider: str, endpoint: str) -> str:
        """
        获取模型显示名称

        Args:
            provider: 提供者名称 (doubao, gemini, openrouter, gemini_proxy)
            endpoint: 模型端点

        Returns:
            显示名称，如果未找到则返回端点本身
        """
        key = f"{provider}:{endpoint}"
        return self._model_names.get(key, endpoint)


# 全局配置实例
settings = ProviderSettings()
