# 声音卡片栏实现计划

## 概述

在现有的 `视频`、`图片`、`提示词` 三种媒体类型基础上，增加 `声音` 类型，支持音频文件的导入、预览播放和元数据显示。

## 修改文件清单（9 个文件）

### 1. `app/src/shared/types.ts` — 类型定义

- `MediaType` 联合类型添加 `'声音'`
- 新增 `AudioMetadata` 接口：
  ```typescript
  export interface AudioMetadata {
    duration: number;      // 秒
    sampleRate: number;    // 采样率 (Hz)
    bitrate: number;       // 比特率 (kbps)
    channels: number;      // 声道数
    codec: string;         // 编解码器
  }
  ```
- `ResourceMetadata` 联合类型添加 `AudioMetadata`
- 新增 `isAudioMetadata()` 类型守卫

### 2. `app/src/shared/section-utils.ts` — Section 工具

- `VALID_MEDIA_TYPES` 集合添加 `'声音'`
- `getAcceptFormats()` 添加 `case '声音': return ['audio/*', '.mp3', '.wav', '.flac', '.aac', '.ogg']`
- `getMediaTypeFromMime()` 添加 `if (mimeType.startsWith('audio/')) return '声音'`

### 3. `app/src/main/services/metadata.ts` — 元数据提取

- `MIME_TYPES` 字典添加音频格式：`.mp3`, `.wav`, `.flac`, `.aac`, `.ogg`
- `getResourceTypeFromMime()` 添加 `audio` 返回值
- 新增 `SUPPORTED_AUDIO_EXTENSIONS` 和 `isSupportedAudioFormat()`
- 新增 `extractAudioMetadata()` 函数：用 ffprobe 提取音频信息
- `extractMetadata()` 主函数添加 `case 'audio'` 分支

### 4. `app/src/renderer/components/Sidebar/TemplateDialog.tsx` — 模板对话框

- `MEDIA_TYPE_OPTIONS` 数组添加 `{ label: '声音', value: '声音' }`

### 5. `app/src/renderer/components/ResourcePanel/ResourceSection.tsx` — 卡片栏

- 添加 `isAudio` 标志：`const isAudio = section.mediaType === '声音'`
- 音频 section：使用 `ResourceCard` 渲染（与视频/图片相同），支持拖拽
- `EXTENSION_MEDIA_TYPES` 添加音频扩展名映射

### 6. `app/src/renderer/components/ResourcePanel/ResourceCard.tsx` — 资源卡片

- 添加 `isAudio` 判断：`const isAudio = resource.mimeType.startsWith('audio/')`
- `getThumbnail()` 添加音频占位图（`SoundOutlined` 图标）
- 音频卡片显示时长（复用 `isAudioMetadata` + `formatDuration`）
- 双击音频不打开全屏预览（音频无需全屏）

### 7. `app/src/renderer/components/PreviewPanel/index.tsx` — 预览面板

- 添加 `isAudio` 判断
- 音频资源渲染 `<audio>` 播放器：
  ```tsx
  {isAudio && (
    <audio
      controls
      src={getLocalFileUrl(selectedResource.filePath, selectedResource.fileSize)}
      style={{ width: '100%' }}
    />
  )}
  ```

### 8. `app/src/renderer/components/PreviewPanel/ResourceInfo.tsx` — 资源信息

- 导入 `isAudioMetadata`
- 添加音频元数据显示：时长、采样率、比特率、声道数、编解码器

### 9. `app/src/renderer/stores/playback.ts` — 播放状态

- `isContinuousPlayType()` 添加对声音类型的支持（音频也可连续播放）

## 不需要修改的部分

- **IPC 通道 / preload**：音频导入复用现有的 `addResource` 流程，无需新增 IPC
- **storage 服务**：`findOrCreateSection` 等函数已经是通用的，无需修改
- **缩略图服务**：音频不需要缩略图，`ResourceCard` 直接显示图标占位

## 验证方法

1. `cd app && npx electron-vite build` 编译通过
2. 启动应用 → 模板设置中能看到"声音"选项
3. 创建含声音 section 的草稿 → 拖入音频文件 → 显示音频卡片
4. 点击音频卡片 → 预览面板显示播放器 + 资源信息
5. 音频播放结束 → 自动播放下一个
