"""
音频驱动人像说话视频生成工具
通过 RunningHub AI 应用（appId: 2006270540499128322）生成口播视频

输入：人像图片 + 音频 + 提示词
输出：人物说话的视频

用法:
    python portrait_animator.py \\
        --image portrait.jpg \\
        --audio speech.mp3 \\
        --output output.mp4

    # 自定义提示词和参数
    python portrait_animator.py \\
        --image portrait.jpg \\
        --audio speech.mp3 \\
        --prompt "人物在接受采访，身体保持静止，只有嘴部在讲话" \\
        --max-size 1080 \\
        --jitter 0 \\
        --zoom 1.0 \\
        --output output.mp4

环境变量:
    RUNNINGHUB_API_KEY   API 密钥（必须）
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
import sys
import argparse
import asyncio

# 支持直接运行（tools/ 目录下）和作为模块导入
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

from runninghub_video import RunningHubClient, RunningHubError, DEFAULT_BASE_URL, DEFAULT_TIMEOUT

# ============================================
# 该 AI 应用的固定配置
# ============================================

APP_ID = "2006270540499128322"

# 节点 ID 映射（对应 log.txt 中的 nodeInfoList）
NODE_IMAGE    = "284"   # 图片上传
NODE_MAX_SIZE = "312"   # 最长边尺寸
NODE_AUDIO    = "125"   # 音频上传
NODE_PROMPT   = "314"   # 提示词
NODE_JITTER   = "369"   # 抖动强度
NODE_ZOOM     = "370"   # 缩放大小

DEFAULT_PROMPT  = "人物在说话"
DEFAULT_MAX_SIZE = 1280
DEFAULT_JITTER  = 0
DEFAULT_ZOOM    = 1.0


# ============================================
# 核心逻辑
# ============================================

async def run(args) -> dict:
    api_key  = args.api_key or os.environ.get('RUNNINGHUB_API_KEY', '')
    base_url = args.base_url or os.environ.get('RUNNINGHUB_BASE_URL', DEFAULT_BASE_URL)

    client = RunningHubClient(api_key=api_key, base_url=base_url)

    print("进度: 5%")

    # 1. 上传图片
    print(f"[PortraitAnimator] 上传图片: {args.image}")
    image_filename = await client.upload_file(args.image, file_type='image')
    print("进度: 20%")

    # 2. 上传音频
    print(f"[PortraitAnimator] 上传音频: {args.audio}")
    audio_filename = await client.upload_file(args.audio, file_type='audio')
    print("进度: 35%")

    # 3. 构建节点参数
    node_info_list = [
        {"nodeId": NODE_IMAGE,    "fieldName": "image",  "fieldValue": image_filename,       "description": "图片上传"},
        {"nodeId": NODE_MAX_SIZE, "fieldName": "value",  "fieldValue": str(args.max_size),   "description": "最长边尺寸"},
        {"nodeId": NODE_AUDIO,    "fieldName": "audio",  "fieldValue": audio_filename,        "description": "音频上传"},
        {"nodeId": NODE_PROMPT,   "fieldName": "prompt", "fieldValue": args.prompt,           "description": "提示词"},
        {"nodeId": NODE_JITTER,   "fieldName": "value",  "fieldValue": str(args.jitter),      "description": "抖动强度"},
        {"nodeId": NODE_ZOOM,     "fieldName": "value",  "fieldValue": str(args.zoom),        "description": "缩放大小"},
    ]

    # 4. 创建任务
    print(f"[PortraitAnimator] 创建任务 appId={APP_ID}")
    print("进度: 40%")
    task_id = await client.create_ai_app_task(
        APP_ID, node_info_list,
        instance_type="plus",
        use_personal_queue="false",
    )
    print("[PortraitAnimator] API_SUBMITTED")

    # 5. 轮询任务
    print("进度: 45%")
    last_status = ""

    def on_progress(status):
        nonlocal last_status
        if status != last_status:
            last_status = status
            label = {'QUEUED': '排队中', 'RUNNING': '生成中'}.get(status, status)
            print(f"[PortraitAnimator] 状态: {label}")

    outputs = await client.poll_task(
        task_id=task_id,
        timeout=args.timeout,
        poll_interval=args.poll_interval,
        on_progress=on_progress,
    )
    print("进度: 85%")

    if not outputs:
        raise RunningHubError("任务完成但无输出文件")

    # 6. 找到视频并下载
    video_output = None
    for item in outputs:
        file_url  = item.get('fileUrl', '')
        file_type = item.get('fileType', '')
        if file_type.startswith('video') or file_url.endswith(('.mp4', '.webm', '.mov')):
            video_output = item
            break
    if not video_output:
        video_output = outputs[0]
        print(f"[PortraitAnimator] 未找到视频输出，使用第一个: {video_output.get('fileType')}")

    file_url = video_output.get('fileUrl', '')
    if not file_url:
        raise RunningHubError("输出文件无下载 URL", raw=video_output)

    await client.download_file(file_url, args.output)
    print("进度: 100%")
    print(f"Output: {args.output}")

    return {
        "output_path": args.output,
        "task_id": task_id,
        "file_type": video_output.get('fileType', ''),
        "all_outputs": outputs,
    }


# ============================================
# CLI
# ============================================

def main():
    parser = argparse.ArgumentParser(
        description="音频驱动人像说话视频生成工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 最简用法
  python portrait_animator.py \\
      --image portrait.jpg \\
      --audio speech.mp3 \\
      --output output.mp4

  # 自定义提示词
  python portrait_animator.py \\
      --image portrait.jpg \\
      --audio speech.mp3 \\
      --prompt "新闻主播正在播报新闻" \\
      --output output.mp4
        """
    )

    parser.add_argument("--api-key",   default=None, help="RunningHub API Key（也可用 RUNNINGHUB_API_KEY 环境变量）")
    parser.add_argument("--base-url",  default=None, help="RunningHub API 地址")
    parser.add_argument("--image",     required=True, help="人像图片路径（支持 jpg/png）")
    parser.add_argument("--audio",     required=True, help="音频文件路径（支持 mp3/wav/aac）")
    parser.add_argument("--output",    required=True, help="输出视频路径")
    parser.add_argument("--prompt",    default=DEFAULT_PROMPT,   help=f"运动提示词（默认: {DEFAULT_PROMPT}）")
    parser.add_argument("--max-size",  type=int,   default=DEFAULT_MAX_SIZE, help=f"最长边尺寸（默认: {DEFAULT_MAX_SIZE}）")
    parser.add_argument("--jitter",    type=float, default=DEFAULT_JITTER,   help=f"抖动强度 0~1（默认: {DEFAULT_JITTER}）")
    parser.add_argument("--zoom",      type=float, default=DEFAULT_ZOOM,     help=f"缩放大小（默认: {DEFAULT_ZOOM}）")
    parser.add_argument("--timeout",       type=int, default=DEFAULT_TIMEOUT, help=f"任务超时（秒，默认 {DEFAULT_TIMEOUT}）")
    parser.add_argument("--poll-interval", type=int, default=3,    help="轮询间隔（秒，默认 3）")

    args = parser.parse_args()

    # 检查输入文件
    for path_arg, name in [(args.image, '图片'), (args.audio, '音频')]:
        if not os.path.exists(path_arg):
            print(f"Error: {name}文件不存在: {path_arg}")
            sys.exit(1)

    print(f"[PortraitAnimator] 图片: {args.image}")
    print(f"[PortraitAnimator] 音频: {args.audio}")
    print(f"[PortraitAnimator] 提示词: {args.prompt}")
    print(f"[PortraitAnimator] 最长边: {args.max_size}  抖动: {args.jitter}  缩放: {args.zoom}")
    print(f"[PortraitAnimator] 输出: {args.output}")

    try:
        result = asyncio.run(run(args))
        print(f"Success: 视频已生成 → {result['output_path']}")
    except RunningHubError as e:
        print(f"Error: [portrait_animator] {e.message.replace(chr(10), ' | ')}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {str(e).replace(chr(10), ' | ')}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
