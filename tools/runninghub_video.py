"""
RunningHub API 视频生成工具
通过 RunningHub 云平台 API 调用 ComfyUI 工作流生成视频

用法:
    # AI 应用模式（推荐）
    python runninghub_video.py \
        --app-id 1998011856453296130 \
        --node "nodeId1:fieldName1=value1" \
        --node "nodeId2:fieldName2=value2" \
        --output output.mp4

    # 工作流模式
    python runninghub_video.py \
        --workflow-id <workflow_id> \
        --node "nodeId:fieldName=value" \
        --output output.mp4

    # 上传图片后引用
    python runninghub_video.py \
        --app-id 1998011856453296130 \
        --upload source.jpg \
        --node "nodeId:image={upload_0}" \
        --output output.mp4

环境变量:
    RUNNINGHUB_API_KEY   API 密钥（必须）
    RUNNINGHUB_BASE_URL  API 地址（可选，默认 https://www.runninghub.cn）
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

import os
import argparse
import asyncio
import json
import time
import logging
import httpx
from pathlib import Path

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)

# ============================================
# Constants
# ============================================

DEFAULT_BASE_URL = "https://www.runninghub.cn"
DEFAULT_TIMEOUT = 3600       # 任务超时 1 小时
DEFAULT_POLL_INTERVAL = 3    # 轮询间隔 3 秒
HTTP_TIMEOUT = 60.0          # HTTP 请求超时 60 秒
UPLOAD_TIMEOUT = 120.0       # 上传超时 120 秒
DOWNLOAD_TIMEOUT = 300.0     # 下载超时 5 分钟
MAX_UPLOAD_RETRIES = 3       # 上传重试次数
QUEUE_FULL_RETRY_DELAY = 10  # 队列满时重试间隔（秒）
MAX_QUEUE_RETRIES = 1        # 队列满时不重试，由前端控制重试


# ============================================
# Errors
# ============================================

class RunningHubError(Exception):
    """RunningHub API 错误"""
    def __init__(self, message: str, code: str = None, raw: dict = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.raw = raw


# ============================================
# Client
# ============================================

class RunningHubClient:
    """RunningHub API 客户端"""

    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL):
        if not api_key:
            raise RunningHubError("RunningHub API Key 未配置")
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')

    async def upload_file(self, file_path: str, file_type: str = "image") -> str:
        """
        上传文件到 RunningHub

        Args:
            file_path: 本地文件路径
            file_type: 文件类型 (image/video/audio)

        Returns:
            服务端文件名
        """
        file_path = Path(file_path)
        if not file_path.exists():
            raise RunningHubError(f"文件不存在: {file_path}")

        file_size = file_path.stat().st_size
        if file_size > 10 * 1024 * 1024:
            raise RunningHubError(f"文件大小超过 10MB 限制: {file_size / 1024 / 1024:.1f}MB")

        url = f"{self.base_url}/task/openapi/upload"
        logger.info(f"[RunningHub] 上传文件: {file_path.name} ({file_size / 1024:.0f} KB)")

        last_error = None
        for attempt in range(1, MAX_UPLOAD_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=UPLOAD_TIMEOUT) as client:
                    with open(file_path, 'rb') as f:
                        files = {'file': (file_path.name, f)}
                        data = {'apiKey': self.api_key, 'fileType': file_type}
                        response = await client.post(url, data=data, files=files)
                        response.raise_for_status()
                        result = response.json()

                if result.get('code') != 0:
                    raise RunningHubError(
                        f"上传失败: {result.get('msg', '未知错误')}",
                        code=str(result.get('code')),
                        raw=result
                    )

                filename = result.get('data', {}).get('fileName', '')
                if not filename:
                    raise RunningHubError("上传成功但未返回文件名", raw=result)

                logger.info(f"[RunningHub] 上传成功: {filename}")
                return filename

            except RunningHubError:
                raise
            except Exception as e:
                last_error = e
                if attempt < MAX_UPLOAD_RETRIES:
                    logger.info(f"[RunningHub] 上传失败 ({attempt}/{MAX_UPLOAD_RETRIES})，重试中...")
                    await asyncio.sleep(1 * attempt)

        raise RunningHubError(f"上传失败（重试 {MAX_UPLOAD_RETRIES} 次）: {last_error}")

    async def create_task(self, workflow_id: str, node_info_list: list) -> str:
        """
        创建工作流任务（V1 API）

        Args:
            workflow_id: 工作流 ID
            node_info_list: 节点参数列表 [{nodeId, fieldName, fieldValue}, ...]

        Returns:
            任务 ID
        """
        url = f"{self.base_url}/task/openapi/create"
        payload = {
            "apiKey": self.api_key,
            "workflowId": workflow_id,
            "nodeInfoList": node_info_list,
        }
        return await self._submit_task(url, payload)

    async def create_ai_app_task(
        self,
        webapp_id: str,
        node_info_list: list,
        instance_type: str = None,
        use_personal_queue: str = None,
    ) -> str:
        """
        创建 AI 应用任务（V2 API）

        Args:
            webapp_id: AI 应用 ID
            node_info_list: 节点参数列表 [{nodeId, fieldName, fieldValue}, ...]
            instance_type: 实例类型，如 "default"、"plus"（可选）
            use_personal_queue: 是否使用个人队列，"true"/"false"（可选）

        Returns:
            任务 ID
        """
        url = f"{self.base_url}/openapi/v2/run/ai-app/{webapp_id}"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        payload = {
            "nodeInfoList": node_info_list,
        }
        if instance_type is not None:
            payload["instanceType"] = instance_type
        if use_personal_queue is not None:
            payload["usePersonalQueue"] = use_personal_queue
        return await self._submit_task(url, payload, headers=headers)

    async def _submit_task(self, url: str, payload: dict, headers: dict = None) -> str:
        """提交任务（支持队列满时自动重试，兼容 V1/V2 响应格式）"""
        for attempt in range(1, MAX_QUEUE_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
                    response = await client.post(url, json=payload, headers=headers)
                    response.raise_for_status()
                    result = response.json()
            except httpx.HTTPStatusError as e:
                raise RunningHubError(
                    f"API 请求失败 ({e.response.status_code}): {e.response.text[:200]}",
                    code=str(e.response.status_code)
                )
            except httpx.TimeoutException:
                raise RunningHubError("API 请求超时")
            except httpx.ConnectError as e:
                raise RunningHubError(f"无法连接到 RunningHub 服务器: {e}")

            # ---- V2 响应格式: {taskId, status, errorCode, errorMessage, ...} ----
            if 'errorCode' in result or 'errorMessage' in result:
                error_code = result.get('errorCode', '')
                error_message = result.get('errorMessage', '')

                if error_code and error_code != '0':
                    # 队列满
                    if 'QUEUE' in error_message.upper() or 'MAXED' in error_message.upper():
                        if attempt < MAX_QUEUE_RETRIES:
                            logger.info(f"[RunningHub] 队列已满，{QUEUE_FULL_RETRY_DELAY}秒后重试 ({attempt}/{MAX_QUEUE_RETRIES})...")
                            await asyncio.sleep(QUEUE_FULL_RETRY_DELAY)
                            continue
                        else:
                            raise RunningHubError("任务队列已满，请稍后重试")

                    raise RunningHubError(
                        f"创建任务失败: {error_message}",
                        code=error_code,
                        raw=result
                    )

                task_id = result.get('taskId', '')
                if task_id:
                    logger.info(f"[RunningHub] 任务已创建: {task_id}")
                    return task_id

                raise RunningHubError("创建任务成功但未返回 taskId", raw=result)

            # ---- V1 响应格式: {code, msg, data: {taskId, ...}} ----
            msg = result.get('msg', '')

            # 检查队列满
            if msg == 'TASK_QUEUE_MAXED':
                if attempt < MAX_QUEUE_RETRIES:
                    logger.info(f"[RunningHub] 队列已满，{QUEUE_FULL_RETRY_DELAY}秒后重试 ({attempt}/{MAX_QUEUE_RETRIES})...")
                    await asyncio.sleep(QUEUE_FULL_RETRY_DELAY)
                    continue
                else:
                    raise RunningHubError("任务队列已满，请稍后重试")

            if result.get('code') != 0:
                raise RunningHubError(
                    f"创建任务失败: {msg or '未知错误'}",
                    code=str(result.get('code')),
                    raw=result
                )

            task_id = result.get('data', {}).get('taskId', '')
            if not task_id:
                raise RunningHubError("创建任务成功但未返回 taskId", raw=result)

            logger.info(f"[RunningHub] 任务已创建: {task_id}")
            return task_id

        raise RunningHubError("创建任务失败：超过最大重试次数")

    async def get_task_output(self, task_id: str) -> dict:
        """
        查询任务输出

        Returns:
            API 原始响应
        """
        url = f"{self.base_url}/task/openapi/outputs"
        payload = {
            "apiKey": self.api_key,
            "taskId": task_id,
        }

        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            return response.json()

    async def poll_task(
        self,
        task_id: str,
        timeout: int = DEFAULT_TIMEOUT,
        poll_interval: int = DEFAULT_POLL_INTERVAL,
        on_progress=None,
    ) -> list:
        """
        轮询任务直到完成

        Args:
            task_id: 任务 ID
            timeout: 超时时间（秒）
            poll_interval: 轮询间隔（秒）
            on_progress: 进度回调 (status: str) -> None

        Returns:
            输出文件列表 [{fileUrl, fileType}, ...]
        """
        start_time = time.time()
        poll_count = 0

        while True:
            elapsed = time.time() - start_time
            if elapsed > timeout:
                raise RunningHubError(f"任务超时（{timeout}秒）")

            await asyncio.sleep(poll_interval)
            poll_count += 1

            try:
                result = await self.get_task_output(task_id)
            except Exception as e:
                # 网络错误不中断轮询
                if poll_count % 5 == 0:
                    logger.info(f"[RunningHub] 查询失败: {e}")
                continue

            code = result.get('code', -1)
            msg = result.get('msg', '')
            data = result.get('data')

            # 检查工作流错误
            if msg == 'APIKEY_TASK_STATUS_ERROR':
                raise RunningHubError("工作流执行出错")

            # code=804 + APIKEY_TASK_IS_RUNNING → 任务进行中
            if code == 804 or msg == 'APIKEY_TASK_IS_RUNNING':
                if on_progress:
                    on_progress('RUNNING')
                if poll_count % 10 == 0:
                    logger.info(f"[RunningHub] 状态: 生成中 (已等待 {int(elapsed)}秒)")
                continue

            # code=0 + data 是列表 → 任务完成，返回输出文件
            if code == 0 and isinstance(data, list):
                logger.info(f"[RunningHub] 任务完成，输出文件数: {len(data)}")
                return data

            # code=0 + data 是字典 → 可能含 taskStatus
            if code == 0 and isinstance(data, dict):
                task_status = data.get('taskStatus', '')

                if task_status == 'FAILED':
                    raise RunningHubError("任务执行失败")

                if task_status in ('QUEUED', 'RUNNING'):
                    if on_progress:
                        on_progress(task_status)
                    if poll_count % 10 == 0:
                        logger.info(f"[RunningHub] 状态: {task_status} (已等待 {int(elapsed)}秒)")
                    continue

            # 其他非零 code → 错误
            if code != 0:
                raise RunningHubError(f"查询失败: {msg}", code=str(code), raw=result)

            # 未知格式
            if poll_count % 10 == 0:
                logger.info(f"[RunningHub] 未知响应: {json.dumps(result, ensure_ascii=False)[:200]}")

    async def download_file(self, url: str, output_path: str) -> str:
        """
        下载文件

        Args:
            url: 文件 URL
            output_path: 本地保存路径

        Returns:
            保存路径
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        logger.info(f"[RunningHub] 下载文件: {url[:80]}...")

        async with httpx.AsyncClient(timeout=DOWNLOAD_TIMEOUT, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()

            with open(output_path, 'wb') as f:
                f.write(response.content)

        file_size = output_path.stat().st_size
        logger.info(f"[RunningHub] 下载完成: {file_size / 1024:.0f} KB → {output_path}")
        return str(output_path)


# ============================================
# CLI
# ============================================

def parse_node_arg(node_str: str) -> dict:
    """
    解析 --node 参数

    格式: nodeId:fieldName=fieldValue

    Returns:
        {nodeId, fieldName, fieldValue}
    """
    if ':' not in node_str or '=' not in node_str:
        raise argparse.ArgumentTypeError(
            f"节点参数格式错误: {node_str}\n"
            f"正确格式: nodeId:fieldName=fieldValue"
        )

    node_id, rest = node_str.split(':', 1)
    field_name, field_value = rest.split('=', 1)

    return {
        "nodeId": node_id.strip(),
        "fieldName": field_name.strip(),
        "fieldValue": field_value.strip(),
    }


def substitute_uploads(node_info_list: list, uploaded_filenames: list) -> list:
    """
    替换节点值中的 {upload_0}, {upload_1}... 占位符为实际的上传文件名
    """
    result = []
    for node in node_info_list:
        value = node['fieldValue']
        for i, filename in enumerate(uploaded_filenames):
            value = value.replace(f'{{upload_{i}}}', filename)
        result.append({**node, 'fieldValue': value})
    return result


async def run(args) -> dict:
    """执行视频生成任务"""

    # 获取 API Key
    api_key = args.api_key or os.environ.get('RUNNINGHUB_API_KEY', '')
    base_url = args.base_url or os.environ.get('RUNNINGHUB_BASE_URL', DEFAULT_BASE_URL)

    client = RunningHubClient(api_key=api_key, base_url=base_url)

    print(f"进度: 5%")

    # 1. 上传文件（如果有）
    uploaded_filenames = []
    if args.upload:
        for i, file_path in enumerate(args.upload):
            logger.info(f"[RunningHub] 上传文件 {i + 1}/{len(args.upload)}: {file_path}")
            # 根据文件扩展名判断类型
            ext = Path(file_path).suffix.lower()
            if ext in ('.mp4', '.avi', '.mov', '.mkv', '.webm'):
                file_type = 'video'
            elif ext in ('.mp3', '.wav', '.aac', '.flac', '.ogg'):
                file_type = 'audio'
            else:
                file_type = 'image'
            filename = await client.upload_file(file_path, file_type=file_type)
            uploaded_filenames.append(filename)

    print(f"进度: 15%")

    # 2. 解析节点参数
    node_info_list = []
    if args.node:
        for node_str in args.node:
            node_info_list.append(parse_node_arg(node_str))

    # 替换上传文件占位符
    if uploaded_filenames:
        node_info_list = substitute_uploads(node_info_list, uploaded_filenames)

    logger.info(f"[RunningHub] 节点参数: {json.dumps(node_info_list, ensure_ascii=False)}")

    # 3. 创建任务
    print(f"进度: 20%")
    if args.app_id:
        logger.info(f"[RunningHub] 创建 AI 应用任务: appId={args.app_id}")
        task_id = await client.create_ai_app_task(args.app_id, node_info_list)
    elif args.workflow_id:
        logger.info(f"[RunningHub] 创建工作流任务: workflowId={args.workflow_id}")
        task_id = await client.create_task(args.workflow_id, node_info_list)
    else:
        raise RunningHubError("必须指定 --app-id 或 --workflow-id")

    # 通知前端 API 提交成功（用于释放排队槽位）
    print("[RunningHub] API_SUBMITTED")

    # 4. 轮询任务
    print(f"进度: 25%")
    last_status = ""

    def on_progress(status):
        nonlocal last_status
        if status != last_status:
            last_status = status
            status_label = {'QUEUED': '排队中', 'RUNNING': '生成中'}.get(status, status)
            logger.info(f"[RunningHub] 状态: {status_label}")

    outputs = await client.poll_task(
        task_id=task_id,
        timeout=args.timeout,
        poll_interval=args.poll_interval,
        on_progress=on_progress,
    )

    print(f"进度: 80%")

    if not outputs:
        raise RunningHubError("任务完成但无输出文件")

    # 5. 查找视频文件并下载
    video_output = None
    for item in outputs:
        file_url = item.get('fileUrl', '')
        file_type = item.get('fileType', '')
        if file_type.startswith('video') or file_url.endswith(('.mp4', '.webm', '.mov')):
            video_output = item
            break

    # 如果没找到视频，取第一个文件
    if not video_output:
        video_output = outputs[0]
        logger.info(f"[RunningHub] 未找到视频输出，使用第一个输出: {video_output.get('fileType', 'unknown')}")

    file_url = video_output.get('fileUrl', '')
    if not file_url:
        raise RunningHubError("输出文件无下载 URL", raw=video_output)

    # 下载
    output_path = args.output
    await client.download_file(file_url, output_path)

    print(f"进度: 100%")
    print(f"Output: {output_path}")

    return {
        "output_path": output_path,
        "task_id": task_id,
        "file_type": video_output.get('fileType', ''),
        "all_outputs": outputs,
    }


def main():
    parser = argparse.ArgumentParser(
        description="RunningHub API 视频生成工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
节点参数格式:
  --node "nodeId:fieldName=fieldValue"

  nodeId     工作流中的节点 ID
  fieldName  节点输入字段名
  fieldValue 字段值（文本、数字等）

上传文件引用:
  使用 --upload 上传文件后，可在 --node 的 fieldValue 中用
  {upload_0}, {upload_1} 等占位符引用上传后的文件名。

示例:
  # AI 应用模式 - 纯文本提示
  python runninghub_video.py \\
      --app-id 1998011856453296130 \\
      --node "1:prompt=一只猫在草地上奔跑" \\
      --output output.mp4

  # 上传图片后生成视频
  python runninghub_video.py \\
      --app-id 1998011856453296130 \\
      --upload source.jpg \\
      --node "1:image={upload_0}" \\
      --node "2:prompt=让图片中的人物动起来" \\
      --output output.mp4

  # 工作流模式
  python runninghub_video.py \\
      --workflow-id my_workflow_id \\
      --node "1:text=hello world" \\
      --output output.mp4
        """
    )

    # 认证
    parser.add_argument(
        "--api-key",
        default=None,
        help="RunningHub API Key（也可通过 RUNNINGHUB_API_KEY 环境变量设置）"
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help=f"RunningHub API 地址（默认: {DEFAULT_BASE_URL}）"
    )

    # 任务模式（二选一）
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--app-id",
        help="AI 应用 ID"
    )
    group.add_argument(
        "--workflow-id",
        help="工作流 ID"
    )

    # 参数
    parser.add_argument(
        "--node",
        action="append",
        default=[],
        help="节点参数: nodeId:fieldName=fieldValue（可多次使用）"
    )
    parser.add_argument(
        "--upload",
        action="append",
        default=[],
        help="上传文件路径（可多次使用，在 --node 中用 {upload_0} 等引用）"
    )
    parser.add_argument(
        "--output", "-o",
        required=True,
        help="输出文件路径"
    )

    # 高级选项
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT,
        help=f"任务超时时间，秒（默认: {DEFAULT_TIMEOUT}）"
    )
    parser.add_argument(
        "--poll-interval",
        type=int,
        default=DEFAULT_POLL_INTERVAL,
        help=f"轮询间隔，秒（默认: {DEFAULT_POLL_INTERVAL}）"
    )

    args = parser.parse_args()

    # 检查上传文件是否存在
    for file_path in args.upload:
        if not os.path.exists(file_path):
            print(f"Error: 文件不存在: {file_path}")
            sys.exit(1)

    logger.info(f"[RunningHub] Starting...")
    if args.app_id:
        logger.info(f"[RunningHub] 模式: AI 应用 (appId={args.app_id})")
    else:
        logger.info(f"[RunningHub] 模式: 工作流 (workflowId={args.workflow_id})")
    logger.info(f"[RunningHub] 节点参数数: {len(args.node)}")
    logger.info(f"[RunningHub] 上传文件数: {len(args.upload)}")
    logger.info(f"[RunningHub] 输出路径: {args.output}")

    try:
        result = asyncio.run(run(args))
        print(f"Success: Video generated at {result['output_path']}")

    except RunningHubError as e:
        error_msg = e.message.replace('\n', ' | ')
        print(f"Error: [runninghub] {error_msg}")
        sys.exit(1)
    except Exception as e:
        error_msg = str(e).replace('\n', ' | ')
        print(f"Error: {error_msg}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
