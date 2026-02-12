"""测试 Seedance 2.0 Omni Reference 模式"""
import requests
import time
import os
import sys
import json
import math
import cv2

# 强制 stdout 使用 UTF-8
sys.stdout.reconfigure(encoding='utf-8')

BASE_URL = "http://61.219.23.150:5015"
TOKEN = "51cacc23c9fca45cb3c8386872bcd63a"
DIR = os.path.dirname(os.path.abspath(__file__))


def get_video_info(path: str) -> dict:
    """获取视频时长（秒）和宽高比"""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频: {path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    duration = frame_count / fps if fps > 0 else 0
    return {"duration": duration, "width": width, "height": height}


def calc_ratio(width: int, height: int) -> str:
    """根据宽高计算最接近的 API 支持的 ratio"""
    # API 支持的比例: 1:1, 4:3, 3:4, 16:9, 9:16, 21:9
    supported = [
        ("1:1", 1.0),
        ("4:3", 4 / 3),
        ("3:4", 3 / 4),
        ("16:9", 16 / 9),
        ("9:16", 9 / 16),
        ("21:9", 21 / 9),
    ]
    actual = width / height if height > 0 else 1.0
    best = min(supported, key=lambda x: abs(x[1] - actual))
    return best[0]


# 分析输入视频
video_path = os.path.join(DIR, "视频.mp4")
info = get_video_info(video_path)
duration_raw = info["duration"]
# duration 需要在 4~15 范围内，取整
duration = max(4, min(15, math.ceil(duration_raw)))
ratio = calc_ratio(info["width"], info["height"])

print(f"=== 输入视频分析 ===")
print(f"分辨率: {info['width']}x{info['height']}")
print(f"时长: {duration_raw:.1f}s → API duration: {duration}s")
print(f"宽高比: {info['width']}:{info['height']} → API ratio: {ratio}")
print()

prompt = (
    "把@video_file_1 里面的女人换成 @image_file_1 里面的女人，"
    "新生成的视频中，完整使用 @image_file_1 中的整体环境，"
    "说话的内容遵循@video_file_1里面的语音，"
    "去除所有字幕，和屏幕上所有的文字的贴片，重新出一个视频。"
)

print(f"Prompt: {prompt}")
print(f"Submitting request (duration={duration}, ratio={ratio})...")

start = time.time()

with open(os.path.join(DIR, "图片.jpg"), "rb") as img, \
     open(os.path.join(DIR, "视频.mp4"), "rb") as vid:
    resp = requests.post(
        f"{BASE_URL}/v1/videos/generations",
        headers={"Authorization": f"Bearer {TOKEN}"},
        data={
            "model": "jimeng-video-seedance-2.0",
            "functionMode": "omni_reference",
            "duration": str(duration),
            "ratio": ratio,
            "prompt": prompt,
        },
        files={
            "image_file_1": ("图片.jpg", img, "image/jpeg"),
            "video_file_1": ("视频.mp4", vid, "video/mp4"),
        },
        timeout=600,
    )

elapsed = time.time() - start
print(f"\nCompleted in {elapsed:.0f}s")
print(f"Status: {resp.status_code}")

resp.encoding = 'utf-8'
result = resp.json()

# 保存原始响应到文件
with open(os.path.join(DIR, "response.json"), "wb") as f:
    f.write(resp.content)
print(f"Raw response saved to response.json")
print(f"Response: {json.dumps(result, ensure_ascii=False, indent=2)}")

if "data" in result and result["data"]:
    video_url = result["data"][0].get("url")
    revised = result["data"][0].get("revised_prompt", "")
    print(f"\nRevised prompt: {revised}")
    print(f"Video URL: {video_url[:100]}...")

    # Download
    output_path = os.path.join(DIR, "生成结果_python.mp4")
    print(f"\nDownloading to {output_path}...")
    dl = requests.get(video_url, timeout=120)
    with open(output_path, "wb") as f:
        f.write(dl.content)
    print(f"Downloaded: {len(dl.content) / 1024:.0f} KB")

    # 验证输出视频
    out_info = get_video_info(output_path)
    print(f"\n=== 输出视频信息 ===")
    print(f"分辨率: {out_info['width']}x{out_info['height']}")
    print(f"时长: {out_info['duration']:.1f}s")
    print(f"宽高比: {calc_ratio(out_info['width'], out_info['height'])}")
else:
    print("Generation failed!")
