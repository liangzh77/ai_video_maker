import React, { useState, useEffect, useRef } from 'react';
import { Modal, App, Empty, Select, Radio, Button, Input, Segmented, InputNumber, Checkbox, Spin } from 'antd';
import { CopyOutlined, MinusOutlined, PlusOutlined, HistoryOutlined, DeleteOutlined, PlayCircleOutlined, SoundOutlined } from '@ant-design/icons';
import type { Resource, ImageResolution, OperationResult } from '@shared/types';
import { isTextMetadata, isVideoMetadata, isAudioMetadata } from '@shared/types';
import { parseFolderName } from '@shared/section-utils';
import { useDraftStore } from '../../stores/draft';
import { useSectionsStore } from '../../stores/sections';
import { useGenerationStore, type TaskType, type GenerationTask } from '../../stores/generation';
import ActiveTasksPanel from './ActiveTasksPanel';
import styles from './GenerateImageDialog.module.css';

// 视频缩略图缓存
const videoThumbCache = new Map<string, string>();

// 提示词标签显示名
const TAG_LABELS: Record<string, string> = { text: '文本', image: '图片', video: '视频' };

// 缓存每种生成模式上次选择的输出卡片栏标签（跨对话框打开保持）
const targetSectionLabelCache: Record<string, string | null> = {};

/** 视频缩略图组件 */
const VideoThumbnail: React.FC<{ resource: Resource; style?: React.CSSProperties }> = ({ resource, style }) => {
  const cacheKey = `${resource.id}_${resource.fileSize}`;
  const [thumbPath, setThumbPath] = useState<string | null>(() => videoThumbCache.get(cacheKey) || null);
  const [loading, setLoading] = useState(!thumbPath);

  useEffect(() => {
    if (thumbPath) return;
    let mounted = true;
    (async () => {
      try {
        const result: OperationResult<string> = await window.api.resource.getThumbnail({
          draftId: resource.draftId,
          resourceId: resource.id,
        });
        if (result.success && result.data) {
          videoThumbCache.set(cacheKey, result.data);
          if (mounted) setThumbPath(result.data);
        }
      } catch { /* ignore */ }
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [resource.id, resource.draftId]);

  if (loading) {
    return (
      <div className={styles.videoThumbPlaceholder} style={style}>
        <Spin size="small" />
      </div>
    );
  }

  if (!thumbPath) {
    return (
      <div className={styles.videoThumbPlaceholder} style={style}>
        <PlayCircleOutlined style={{ fontSize: 24, color: '#999' }} />
      </div>
    );
  }

  const url = `local-file:///${thumbPath.replace(/\\/g, '/')}?v=${resource.fileSize}`;
  return <img src={url} alt={resource.fileName} className={styles.thumbnail} style={style} />;
};

interface ModelInfo {
  id: string;
  name: string;
}

type GenerateMode = 'image' | 'text' | 'video' | 'tasks';

// 根据视频宽高计算最接近的 API 比例
function calcRatioFromDimensions(width: number, height: number): string {
  const supported: [string, number][] = [
    ['1:1', 1.0],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['21:9', 21 / 9],
  ];
  const actual = height > 0 ? width / height : 1.0;
  const best = supported.reduce((prev, curr) =>
    Math.abs(curr[1] - actual) < Math.abs(prev[1] - actual) ? curr : prev
  );
  return best[0];
}

interface GenerateImageDialogProps {
  visible: boolean;
  promptResource?: Resource;
  promptContent?: string;
  sectionId?: string; // 当没有 promptResource 时，用于文本生成的目标 section
  initialMode?: GenerateMode;
  onClose: () => void;
}

const GenerateImageDialog: React.FC<GenerateImageDialogProps> = ({
  visible,
  promptResource,
  promptContent = '',
  sectionId,
  initialMode,
  onClose,
}) => {
  const { message } = App.useApp();
  const { selectedDraftId, resources, selectResource } = useDraftStore();
  const { sections } = useSectionsStore();
  const { addTasks, tasks: allStoreTasks, threadCounts, setThreadCount: setStoreThreadCount } = useGenerationStore();

  const [mode, setMode] = useState<GenerateMode>('image');
  const [targetImageSection, setTargetImageSection] = useState<string | null>(null);
  const [targetTextSection, setTargetTextSection] = useState<string | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [videoModeImageIds, setVideoModeImageIds] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<ImageResolution>('2K');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<string>('auto');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  // 批量生成状态
  const [batchCount, setBatchCount] = useState(1);

  // 一图一任务模式
  const [oneImagePerTask, setOneImagePerTask] = useState(false);

  // 参考提示词（文本模式）
  const [selectedTextIds, setSelectedTextIds] = useState<string[]>([]);

  // 视频生成状态
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [videoDuration, setVideoDuration] = useState<number>(6);
  const [videoRatio, setVideoRatio] = useState<string>('9:16');
  const [targetVideoSection, setTargetVideoSection] = useState<string | null>(null);
  const [videoModeAudioIds, setVideoModeAudioIds] = useState<string[]>([]);

  // 提示词历史
  const [promptHistory, setPromptHistory] = useState<string[]>([]);

  // 进行中的任务数（running + pending）
  const activeCount = allStoreTasks.filter((t) => t.status === 'running' || t.status === 'pending').length;

  // 对话框打开时从文件加载提示词历史
  useEffect(() => {
    if (visible && selectedDraftId) {
      window.api.promptHistory.load({ draftId: selectedDraftId }).then((result) => {
        if (result.success) {
          setPromptHistory(result.data.prompts || []);
        }
      }).catch(() => {});
    }
  }, [visible, selectedDraftId]);

  const savePromptToHistory = async (prompt: string) => {
    if (!selectedDraftId || !prompt.trim()) return;
    const result = await window.api.promptHistory.save({ draftId: selectedDraftId, prompt });
    if (result.success) {
      setPromptHistory(result.data.prompts || []);
    }
  };

  const removePromptFromHistory = async (prompt: string) => {
    if (!selectedDraftId) return;
    const result = await window.api.promptHistory.remove({ draftId: selectedDraftId, prompt });
    if (result.success) {
      setPromptHistory(result.data.prompts || []);
    }
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(editedPrompt).then(() => {
      message.success('提示词已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败');
    });
  };

  // 卡片大小比例，从 localStorage 读取缓存
  const CARD_SCALE_KEY = 'generateImageDialog_cardScale';
  const SCALE_STEPS = [0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.25, 1.5, 2];
  const [cardScale, setCardScale] = useState(() => {
    const cached = localStorage.getItem(CARD_SCALE_KEY);
    return cached ? parseFloat(cached) : 1;
  });

  // 保存卡片大小到 localStorage
  const updateCardScale = (newScale: number) => {
    setCardScale(newScale);
    localStorage.setItem(CARD_SCALE_KEY, String(newScale));
  };

  // 缩小卡片
  const handleDecreaseScale = () => {
    const currentIndex = SCALE_STEPS.indexOf(cardScale);
    if (currentIndex > 0) {
      updateCardScale(SCALE_STEPS[currentIndex - 1]);
    } else if (currentIndex === -1) {
      const smaller = SCALE_STEPS.filter(s => s < cardScale);
      if (smaller.length > 0) {
        updateCardScale(smaller[smaller.length - 1]);
      }
    }
  };

  // 放大卡片
  const handleIncreaseScale = () => {
    const currentIndex = SCALE_STEPS.indexOf(cardScale);
    if (currentIndex >= 0 && currentIndex < SCALE_STEPS.length - 1) {
      updateCardScale(SCALE_STEPS[currentIndex + 1]);
    } else if (currentIndex === -1) {
      const larger = SCALE_STEPS.filter(s => s > cardScale);
      if (larger.length > 0) {
        updateCardScale(larger[0]);
      }
    }
  };

  // Filter image resources by mediaType (all image sections)
  const allImages = resources.filter((r) => {
    const desc = parseFolderName(r.type);
    return desc?.mediaType === '图片';
  });

  // 多选图片的处理函数
  const toggleImageSelection = (imageId: string) => {
    setSelectedImageIds((prev) => {
      if (prev.includes(imageId)) {
        return prev.filter((id) => id !== imageId);
      } else {
        return [...prev, imageId];
      }
    });
  };

  // 视频资源列表
  const allVideos = resources.filter((r) => {
    const desc = parseFolderName(r.type);
    return desc?.mediaType === '视频';
  });

  // 音频资源列表
  const allAudios = resources.filter((r) => {
    const desc = parseFolderName(r.type);
    return desc?.mediaType === '声音';
  });

  // 多选音频的处理函数
  const toggleAudioSelection = (audioId: string) => {
    setVideoModeAudioIds((prev) =>
      prev.includes(audioId) ? prev.filter((id) => id !== audioId) : [...prev, audioId]
    );
  };

  // 视频选择变化时，自动根据第一个选中视频的元数据更新时长和比例
  useEffect(() => {
    if (selectedVideoIds.length === 0) return;
    const firstVideo = allVideos.find((v) => v.id === selectedVideoIds[0]);
    if (!firstVideo?.metadata || !isVideoMetadata(firstVideo.metadata)) return;
    const meta = firstVideo.metadata;
    // 时长取整：小数部分 < 0.3 舍去，>= 0.3 进 1，限制在 4~15 范围
    const frac = meta.duration - Math.floor(meta.duration);
    const rounded = frac < 0.3 ? Math.floor(meta.duration) : Math.ceil(meta.duration);
    setVideoDuration(Math.min(15, Math.max(4, rounded)));
    // 比例从宽高推算
    if (meta.width > 0 && meta.height > 0) {
      setVideoRatio(calcRatioFromDimensions(meta.width, meta.height));
    }
  }, [selectedVideoIds, allVideos]);

  // 多选视频的处理函数
  const toggleVideoSelection = (videoId: string) => {
    setSelectedVideoIds((prev) => {
      if (prev.includes(videoId)) {
        return prev.filter((id) => id !== videoId);
      } else if (prev.length < 3) {
        return [...prev, videoId];
      } else {
        return prev; // 最多 3 个
      }
    });
  };

  // 所有提示词资源（用于文本模式参考选择）
  const allTexts = resources.filter((r) => {
    const desc = parseFolderName(r.type);
    return desc?.mediaType === '提示词' && isTextMetadata(r.metadata) && (r.metadata as any).content;
  });

  // 多选提示词的处理函数
  const toggleTextSelection = (textId: string) => {
    setSelectedTextIds((prev) =>
      prev.includes(textId) ? prev.filter((id) => id !== textId) : [...prev, textId]
    );
  };

  // 校验并替换 @文本N 占位符
  const resolveTextReferences = (prompt: string): { resolved?: string; error?: string } => {
    const refs = [...prompt.matchAll(/@文本(\d+)/g)];
    if (refs.length === 0) {
      // 没有占位符但选择了文本 → 提示
      if (selectedTextIds.length > 0) {
        return { error: `选择了 ${selectedTextIds.length} 条参考提示词，但提示词中没有 @文本N 引用` };
      }
      return { resolved: prompt };
    }
    if (selectedTextIds.length === 0) {
      return { error: `提示词中包含 ${refs.length} 个文本引用，但未选择参考提示词` };
    }
    const refNumbers = [...new Set(refs.map((m) => parseInt(m[1], 10)))];
    const maxRef = Math.max(...refNumbers);
    if (maxRef > selectedTextIds.length) {
      return { error: `提示词中引用了 @文本${maxRef}，但只选择了 ${selectedTextIds.length} 条参考提示词` };
    }
    if (refNumbers.length < selectedTextIds.length) {
      return { error: `选择了 ${selectedTextIds.length} 条参考提示词，但提示词中只引用了 ${refNumbers.length} 条` };
    }
    const resolved = prompt.replace(/@文本(\d+)/g, (_match, numStr) => {
      const index = parseInt(numStr, 10) - 1;
      const res = resources.find((r) => r.id === selectedTextIds[index]);
      if (res && isTextMetadata(res.metadata)) {
        return (res.metadata as any).content;
      }
      return _match;
    });
    return { resolved };
  };

  // 输出卡片栏变更时更新缓存
  const handleTargetImageSectionChange = (sectionId: string) => {
    setTargetImageSection(sectionId || null);
    if (sectionId) {
      const sec = sections.find((s) => s.id === sectionId);
      if (sec) targetSectionLabelCache.image = sec.label;
    }
  };
  const handleTargetTextSectionChange = (sectionId: string) => {
    setTargetTextSection(sectionId || null);
    if (sectionId) {
      const sec = sections.find((s) => s.id === sectionId);
      if (sec) targetSectionLabelCache.text = sec.label;
    }
  };
  const handleTargetVideoSectionChange = (sectionId: string) => {
    setTargetVideoSection(sectionId || null);
    if (sectionId) {
      const sec = sections.find((s) => s.id === sectionId);
      if (sec) targetSectionLabelCache.video = sec.label;
    }
  };

  // Load models when dialog opens
  useEffect(() => {
    if (visible) {
      window.api.task.getModels().then((modelList) => {
        setModels(modelList);
        // Select first model by default if available
        if (modelList.length > 0 && !selectedModel) {
          setSelectedModel(modelList[0].id);
        }
      }).catch((err) => {
        console.error('Failed to load models:', err);
        message.error('加载模型列表失败');
      });
    }
  }, [visible, message]);

  // Reset state when dialog opens
  const prevVisibleRef = useRef(false);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      // 对话框刚打开，重置表单状态
      setSelectedImageIds([]);
      setVideoModeImageIds([]);
      setSelectedTextIds([]);
      setSystemPrompt('');

      // 尝试解析 JSON 格式提示词（提取 prompt / seconds）
      // 支持 ```json ... ``` markdown 代码块包裹
      let resolvedPrompt = promptContent;
      let parsedVideoSeconds: number | null = null;
      {
        let s = promptContent.trim();
        const fenceMatch = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
        if (fenceMatch) s = fenceMatch[1].trim();
        if (s.startsWith('{') || s.startsWith('[')) {
          try {
            const json = JSON.parse(s);
            const obj = Array.isArray(json) ? json[0] : json;
            if (obj && obj.prompt && typeof obj.prompt === 'string') {
              resolvedPrompt = obj.prompt;
              if (typeof obj.seconds === 'number') {
                parsedVideoSeconds = Math.min(15, Math.max(4, obj.seconds));
              }
            }
          } catch { /* not JSON, ignore */ }
        }
      }
      setEditedPrompt(resolvedPrompt);

      // 图片模式：从缓存恢复，或默认第一个
      const imageSections = sections.filter((s) => s.mediaType === '图片');
      const cachedImageSection = targetSectionLabelCache.image
        ? imageSections.find((s) => s.label === targetSectionLabelCache.image)
        : null;
      setTargetImageSection(cachedImageSection?.id || (imageSections.length > 0 ? imageSections[0].id : null));
      // 文本模式：从缓存恢复，或默认第一个提示词栏
      const textSections = sections.filter((s) => s.mediaType === '提示词');
      const cachedTextSection = targetSectionLabelCache.text
        ? textSections.find((s) => s.label === targetSectionLabelCache.text)
        : null;
      setTargetTextSection(
        cachedTextSection?.id
        || (textSections.length > 0 ? textSections[0].id : null),
      );
      // 视频模式：从缓存恢复，或默认第一个
      const videoSections = sections.filter((s) => s.mediaType === '视频');
      const cachedVideoSection = targetSectionLabelCache.video
        ? videoSections.find((s) => s.label === targetSectionLabelCache.video)
        : null;
      setTargetVideoSection(cachedVideoSection?.id || (videoSections.length > 0 ? videoSections[0].id : null));
      setSelectedVideoIds([]);
      setVideoModeAudioIds([]);
      setVideoDuration(parsedVideoSeconds ?? 6);
      setVideoRatio('9:16');
      // 根据 initialMode 或 prompt 的 tag 设置默认生成模式
      let resolvedMode: string;
      if (initialMode) {
        resolvedMode = initialMode;
      } else {
        const meta = promptResource?.metadata;
        if (meta && isTextMetadata(meta) && meta.tag === 'video') {
          resolvedMode = 'video';
        } else if (meta && isTextMetadata(meta) && meta.tag === 'image') {
          resolvedMode = 'image';
        } else {
          resolvedMode = 'text';
        }
      }
      setMode(resolvedMode as GenerateMode);
    }
    prevVisibleRef.current = visible;
  }, [visible, promptContent, promptResource]);

  // 提交图片生成任务到全局 store
  const handleGenerateImage = () => {
    if (!selectedDraftId) {
      message.error('请先选择草稿');
      return;
    }
    if (!selectedModel) {
      message.error('请先选择模型');
      return;
    }
    if (oneImagePerTask && selectedImageIds.length === 0) {
      message.error('一图一任务模式请先选择图片');
      return;
    }
    if (!editedPrompt || editedPrompt.trim().length === 0) {
      message.error('提示词内容不能为空');
      return;
    }

    savePromptToHistory(editedPrompt);

    const taskCount = oneImagePerTask ? selectedImageIds.length : batchCount;
    const newTasks = [];

    if (oneImagePerTask && selectedImageIds.length > 0) {
      for (let i = 0; i < selectedImageIds.length; i++) {
        newTasks.push({
          type: 'image' as const,
          draftId: selectedDraftId,
          prompt: editedPrompt,
          label: `图片 #${i + 1}`,
          params: {
            sourceImageIds: [selectedImageIds[i]],
            modelEndpoint: selectedModel!,
            resolution: selectedResolution,
            aspectRatio: selectedAspectRatio !== 'auto' ? selectedAspectRatio : undefined,
            targetSectionId: targetImageSection || undefined,
            promptResourceId: promptResource?.id,
          },
        });
      }
    } else {
      for (let i = 0; i < batchCount; i++) {
        newTasks.push({
          type: 'image' as const,
          draftId: selectedDraftId,
          prompt: editedPrompt,
          label: `图片 #${i + 1}`,
          params: {
            sourceImageIds: selectedImageIds,
            modelEndpoint: selectedModel!,
            resolution: selectedResolution,
            aspectRatio: selectedAspectRatio !== 'auto' ? selectedAspectRatio : undefined,
            targetSectionId: targetImageSection || undefined,
            promptResourceId: promptResource?.id,
          },
        });
      }
    }

    addTasks(newTasks);
    message.success(`已提交 ${taskCount} 个图片任务`);
    setMode('tasks');
  };

  // 提交文本生成任务到全局 store
  const handleGenerateText = () => {
    if (!selectedDraftId) {
      message.error('请先选择草稿');
      return;
    }
    if (!selectedModel) {
      message.error('请先选择模型');
      return;
    }
    if (!editedPrompt || editedPrompt.trim().length === 0) {
      message.error('提示词内容不能为空');
      return;
    }

    // 校验并替换 @文本N 引用
    const { resolved: resolvedPrompt, error: refError } = resolveTextReferences(editedPrompt);
    if (refError) {
      message.error(refError);
      return;
    }

    savePromptToHistory(editedPrompt); // 保存原始提示词（含 @文本N）到历史

    const newTasks = [];
    for (let i = 0; i < batchCount; i++) {
      newTasks.push({
        type: 'text' as const,
        draftId: selectedDraftId,
        prompt: resolvedPrompt!,
        label: `文本 #${i + 1}`,
        params: {
          modelEndpoint: selectedModel!,
          systemPrompt: systemPrompt.trim() || undefined,
          targetSectionId: targetTextSection || undefined,
        },
      });
    }

    addTasks(newTasks);
    message.success(`已提交 ${batchCount} 个文本任务`);
    setMode('tasks');
  };

  // 提交视频生成任务到全局 store
  const handleGenerateVideo = () => {
    if (!selectedDraftId) {
      message.error('请先选择草稿');
      return;
    }
    if (!editedPrompt || editedPrompt.trim().length === 0) {
      message.error('提示词内容不能为空');
      return;
    }

    // 校验 @音频N 占位符与选中音频数量一致
    const audioRefs = [...editedPrompt.matchAll(/@音频(\d+)/g)];
    if (audioRefs.length > 0 || videoModeAudioIds.length > 0) {
      const refNumbers = [...new Set(audioRefs.map((m) => parseInt(m[1], 10)))];
      const maxRef = refNumbers.length > 0 ? Math.max(...refNumbers) : 0;
      if (audioRefs.length > 0 && videoModeAudioIds.length === 0) {
        message.error(`提示词中包含 @音频 引用，但未选择音频`);
        return;
      }
      if (videoModeAudioIds.length > 0 && audioRefs.length === 0) {
        message.error(`选择了 ${videoModeAudioIds.length} 个音频，但提示词中没有 @音频N 引用`);
        return;
      }
      if (maxRef > videoModeAudioIds.length) {
        message.error(`提示词中引用了 @音频${maxRef}，但只选择了 ${videoModeAudioIds.length} 个音频`);
        return;
      }
      if (refNumbers.length < videoModeAudioIds.length) {
        message.error(`选择了 ${videoModeAudioIds.length} 个音频，但提示词中只引用了 ${refNumbers.length} 个`);
        return;
      }
    }

    savePromptToHistory(editedPrompt);

    addTasks([{
      type: 'video' as const,
      draftId: selectedDraftId,
      prompt: editedPrompt,
      label: '视频 #1',
      params: {
        imageResourceIds: videoModeImageIds,
        videoResourceIds: selectedVideoIds,
        audioResourceIds: videoModeAudioIds,
        duration: videoDuration,
        ratio: videoRatio,
        targetSectionId: targetVideoSection || undefined,
      },
    }]);

    message.success('已提交 1 个视频任务');
    setMode('tasks');
  };

  const handleGenerate = () => {
    if (mode === 'image') {
      handleGenerateImage();
    } else if (mode === 'video') {
      handleGenerateVideo();
    } else if (mode === 'text') {
      handleGenerateText();
    }
  };

  const getImageUrl = (resource: Resource) => {
    const normalizedPath = resource.filePath.replace(/\\/g, '/');
    return `local-file:///${normalizedPath}`;
  };

  // 根据模式判断确定按钮是否可用
  const isOkDisabled = (() => {
    if (mode === 'tasks') return true; // tasks 模式无提交按钮
    if (mode === 'video') return false; // 视频模式不需要选模型
    if (!selectedModel) return true;
    return false;
  })();

  const dialogTitle = mode === 'image'
    ? '生成新角色图片'
    : mode === 'video'
      ? '生成视频'
      : mode === 'tasks'
        ? '进行中的任务'
        : '生成文本';

  // 当前模式对应的线程数
  const currentThreadCount = mode === 'image' ? threadCounts.image : threadCounts.text;

  return (
    <Modal
      title={dialogTitle}
      open={visible}
      onCancel={onClose}
      maskClosable
      okText={mode === 'tasks' ? '提交' : '提交任务'}
      cancelText="关闭"
      onOk={handleGenerate}
      okButtonProps={{
        disabled: isOkDisabled,
        style: mode === 'tasks' ? { display: 'none' } : {},
      }}
      width="85vw"
      styles={{
        body: {
          height: '85vh',
          padding: '16px 24px',
          overflow: 'hidden',
        },
      }}
      centered
    >
      <div className={styles.content}>
        {/* Mode Selection */}
        <div className={styles.section}>
          <Segmented
            options={[
              { label: '生成图片', value: 'image' },
              { label: '生成文本', value: 'text' },
              { label: '生成视频', value: 'video' },
              { label: `进行中${activeCount > 0 ? ` (${activeCount})` : ''}`, value: 'tasks' },
            ]}
            value={mode}
            onChange={(val) => setMode(val as GenerateMode)}
          />
        </div>

        {/* === Tasks Mode === */}
        {mode === 'tasks' && (
          <ActiveTasksPanel
            onNavigateToResult={(task: GenerationTask) => {
              const targetSectionId = (task.params as any).targetSectionId;
              const resourceId = task.resultResourceId;
              onClose();
              // 延迟等待 Modal 关闭后再选中资源并滚动
              setTimeout(() => {
                // 选中生成的资源卡片
                if (resourceId) {
                  selectResource(resourceId);
                }
                // 滚动到目标卡片栏
                if (targetSectionId) {
                  const el = document.querySelector(`[data-section-id="${targetSectionId}"]`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }
              }, 300);
            }}
          />
        )}

        {/* === Generation Modes (image/text/video) === */}
        {mode !== 'tasks' && (
          <>
            {/* Model Selection - not needed for video mode */}
            {mode !== 'video' && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>选择模型</div>
                <Select
                  value={selectedModel}
                  onChange={setSelectedModel}
                  placeholder="请选择模型"
                  className={styles.modelSelect}
                  options={models.map((m) => ({ value: m.id, label: m.name }))}
                />
              </div>
            )}

            {/* Batch Controls - not for video mode */}
            {mode !== 'video' && (
              <div className={styles.section}>
                <div className={styles.batchControls}>
                  {mode === 'image' && (
                    <>
                      <Checkbox
                        checked={oneImagePerTask}
                        onChange={(e) => setOneImagePerTask(e.target.checked)}
                      >
                        一图一任务
                      </Checkbox>
                      <span style={{ width: 8 }} />
                    </>
                  )}
                  <span className={styles.batchLabel}>生成份数</span>
                  <InputNumber
                    min={1}
                    max={50}
                    value={(mode === 'image' && oneImagePerTask) ? selectedImageIds.length || 1 : batchCount}
                    onChange={(v) => setBatchCount(v || 1)}
                    disabled={mode === 'image' && oneImagePerTask}
                    size="small"
                    style={{ width: 70 }}
                  />
                  <span className={styles.batchLabel}>线程数</span>
                  <InputNumber
                    min={1}
                    max={8}
                    value={currentThreadCount}
                    onChange={(v) => setStoreThreadCount(mode as TaskType, v || 1)}
                    size="small"
                    style={{ width: 70 }}
                  />
                </div>
              </div>
            )}

            {/* Output Target & Resolution */}
            <div className={styles.section}>
              <div className={styles.batchControls}>
                <span className={styles.batchLabel}>输出到</span>
                {mode === 'image' ? (
                  <Select
                    value={targetImageSection}
                    onChange={handleTargetImageSectionChange}
                    placeholder="默认（新角色图片）"
                    allowClear
                    style={{ width: 200 }}
                    size="small"
                    options={sections
                      .filter((s) => s.mediaType === '图片')
                      .map((s) => ({
                        label: `${s.order}. ${s.label}`,
                        value: s.id,
                      }))}
                  />
                ) : mode === 'video' ? (
                  <Select
                    value={targetVideoSection}
                    onChange={handleTargetVideoSectionChange}
                    placeholder="默认（生成视频）"
                    allowClear
                    style={{ width: 200 }}
                    size="small"
                    options={sections
                      .filter((s) => s.mediaType === '视频')
                      .map((s) => ({
                        label: `${s.order}. ${s.label}`,
                        value: s.id,
                      }))}
                  />
                ) : (
                  <Select
                    value={targetTextSection}
                    onChange={handleTargetTextSectionChange}
                    placeholder="当前提示词栏"
                    style={{ width: 200 }}
                    size="small"
                    options={sections
                      .filter((s) => s.mediaType === '提示词')
                      .map((s) => ({
                        label: `${s.order}. ${s.label}`,
                        value: s.id,
                      }))}
                  />
                )}
                {mode === 'image' && (
                  <>
                    <span style={{ width: 16 }} />
                    <span className={styles.batchLabel}>分辨率</span>
                    <Radio.Group
                      value={selectedResolution}
                      onChange={(e) => setSelectedResolution(e.target.value)}
                    >
                      <Radio value="2K">2K</Radio>
                      <Radio value="4K">4K</Radio>
                    </Radio.Group>
                    <span style={{ width: 16 }} />
                    <span className={styles.batchLabel}>宽高比</span>
                    <Select
                      value={selectedAspectRatio}
                      onChange={setSelectedAspectRatio}
                      size="small"
                      style={{ width: 90 }}
                      options={[
                        { label: '自动', value: 'auto' },
                        { label: '1:1', value: '1:1' },
                        { label: '16:9', value: '16:9' },
                        { label: '9:16', value: '9:16' },
                        { label: '4:3', value: '4:3' },
                        { label: '3:4', value: '3:4' },
                        { label: '3:2', value: '3:2' },
                        { label: '2:3', value: '2:3' },
                        { label: '4:5', value: '4:5' },
                        { label: '5:4', value: '5:4' },
                        { label: '21:9', value: '21:9' },
                      ]}
                    />
                  </>
                )}
                {mode === 'video' && (
                  <>
                    <span style={{ width: 16 }} />
                    <span className={styles.batchLabel}>时长</span>
                    <InputNumber
                      min={4}
                      max={15}
                      value={videoDuration}
                      onChange={(v) => setVideoDuration(v || 6)}
                      size="small"
                      style={{ width: 70 }}
                      addonAfter="秒"
                    />
                    <span style={{ width: 8 }} />
                    <span className={styles.batchLabel}>比例</span>
                    <Select
                      value={videoRatio}
                      onChange={setVideoRatio}
                      size="small"
                      style={{ width: 90 }}
                      options={[
                        { label: '1:1', value: '1:1' },
                        { label: '4:3', value: '4:3' },
                        { label: '3:4', value: '3:4' },
                        { label: '16:9', value: '16:9' },
                        { label: '9:16', value: '9:16' },
                        { label: '21:9', value: '21:9' },
                      ]}
                    />
                  </>
                )}
              </div>
            </div>

            {/* System Prompt - Text mode only */}
            {mode === 'text' && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>系统提示词（可选）</div>
                <Input.TextArea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="设定 AI 的角色或行为，例如：你是一位专业的文案编辑"
                  className={styles.promptInput}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                />
              </div>
            )}

            {/* Prompt Editor */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                提示词
                <span className={styles.promptActions}>
                  {promptHistory.length > 0 && (
                    <Select
                      placeholder="历史提示词"
                      value={null as any}
                      onChange={(val: string) => setEditedPrompt(val)}
                      size="small"
                      style={{ width: 160 }}
                      suffixIcon={<HistoryOutlined />}
                      popupMatchSelectWidth={false}
                      options={promptHistory.map((p, i) => ({
                        value: p,
                        label: (
                          <div className={styles.historyOption}>
                            <span className={styles.historyText}>{p.length > 80 ? p.slice(0, 80) + '...' : p}</span>
                            <Button
                              type="text"
                              size="small"
                              icon={<DeleteOutlined />}
                              className={styles.historyDelete}
                              onClick={(e) => {
                                e.stopPropagation();
                                removePromptFromHistory(p);
                              }}
                            />
                          </div>
                        ),
                      }))}
                    />
                  )}
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={handleCopyPrompt}
                    disabled={!editedPrompt}
                    title="复制提示词"
                  />
                </span>
              </div>
              <Input.TextArea
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                placeholder="输入提示词"
                className={styles.promptInput}
                autoSize={{ minRows: 2, maxRows: 6 }}
              />
            </div>

            {/* 参考提示词选择 - Text mode only */}
            {mode === 'text' && allTexts.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  选择参考提示词（可选，用 @文本1 @文本2 引用）
                  <span className={styles.count}>
                    已选 {selectedTextIds.length} / 共 {allTexts.length} 条
                  </span>
                </div>
                <div className={styles.textRefGrid}>
                  {allTexts.map((txt) => {
                    const meta = isTextMetadata(txt.metadata) ? txt.metadata : null;
                    const textContent = (meta as any)?.content ?? '';
                    const tag = (meta as any)?.tag;
                    return (
                      <div
                        key={txt.id}
                        className={`${styles.textRefItem} ${selectedTextIds.includes(txt.id) ? styles.selected : ''}`}
                        onClick={() => toggleTextSelection(txt.id)}
                      >
                        {tag && <span className={styles.textRefTag}>{TAG_LABELS[tag] || tag}</span>}
                        <div className={styles.textRefContent}>{textContent}</div>
                        <div className={styles.textRefName} title={txt.fileName}>{txt.fileName}</div>
                        {selectedTextIds.includes(txt.id) && (
                          <div className={styles.selectedBadge}>
                            {selectedTextIds.indexOf(txt.id) + 1}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Image Selection - Image mode only */}
            {mode === 'image' && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  选择参考图片（可选，支持多选）
                  <span className={styles.count}>
                    已选 {selectedImageIds.length} / 共 {allImages.length} 张
                  </span>
                  <span className={styles.scaleControls}>
                    <Button
                      type="text"
                      size="small"
                      icon={<MinusOutlined />}
                      onClick={handleDecreaseScale}
                      disabled={cardScale <= SCALE_STEPS[0]}
                    />
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={handleIncreaseScale}
                      disabled={cardScale >= SCALE_STEPS[SCALE_STEPS.length - 1]}
                    />
                  </span>
                </div>

                {allImages.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="暂无角色图片，请先添加"
                    className={styles.empty}
                  />
                ) : (
                  <div className={styles.imageGrid}>
                    {allImages.map((img) => (
                      <div
                        key={img.id}
                        className={`${styles.imageItem} ${selectedImageIds.includes(img.id) ? styles.selected : ''}`}
                        onClick={() => toggleImageSelection(img.id)}
                      >
                        <img
                          src={getImageUrl(img)}
                          alt={img.fileName}
                          className={styles.thumbnail}
                          style={{
                            height: `calc(37.5vh * ${cardScale})`,
                            maxWidth: `calc(52.5vw * ${cardScale})`,
                          }}
                        />
                        {selectedImageIds.includes(img.id) && (
                          <div className={styles.selectedBadge}>
                            {selectedImageIds.indexOf(img.id) + 1}
                          </div>
                        )}
                        <div className={styles.imageName} title={img.fileName}>
                          {img.fileName}
                        </div>
                        {/* 显示图片所属分组标签 */}
                        <div className={`${styles.typeTag} ${styles.newTag}`}>
                          {parseFolderName(img.type)?.label || img.type}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Video mode: Image & Video Selection */}
            {mode === 'video' && (
              <>
                {/* 参考图片选择 */}
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>
                    参考图片（可选，最多 9 张）
                    <span className={styles.count}>
                      已选 {videoModeImageIds.length} / 共 {allImages.length} 张
                    </span>
                    <span className={styles.scaleControls}>
                      <Button type="text" size="small" icon={<MinusOutlined />} onClick={handleDecreaseScale} disabled={cardScale <= SCALE_STEPS[0]} />
                      <Button type="text" size="small" icon={<PlusOutlined />} onClick={handleIncreaseScale} disabled={cardScale >= SCALE_STEPS[SCALE_STEPS.length - 1]} />
                    </span>
                  </div>
                  {allImages.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="暂无图片资源"
                      className={styles.empty}
                      style={{ padding: '8px 0' }}
                    />
                  ) : (
                    <div className={styles.imageGrid} style={{ maxHeight: '30vh' }}>
                      {allImages.map((img) => (
                        <div
                          key={img.id}
                          className={`${styles.imageItem} ${videoModeImageIds.includes(img.id) ? styles.selected : ''}`}
                          onClick={() => {
                            setVideoModeImageIds((prev) => {
                              if (prev.includes(img.id)) return prev.filter((id) => id !== img.id);
                              if (prev.length < 9) return [...prev, img.id];
                              return prev;
                            });
                          }}
                        >
                          <img
                            src={getImageUrl(img)}
                            alt={img.fileName}
                            className={styles.thumbnail}
                            style={{
                              height: `calc(37.5vh * ${cardScale})`,
                              maxWidth: `calc(52.5vw * ${cardScale})`,
                            }}
                          />
                          {videoModeImageIds.includes(img.id) && (
                            <div className={styles.selectedBadge}>
                              {videoModeImageIds.indexOf(img.id) + 1}
                            </div>
                          )}
                          <div className={styles.imageName} title={img.fileName}>
                            {img.fileName}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 参考视频选择 */}
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>
                    参考视频（可选，最多 3 个）
                    <span className={styles.count}>
                      已选 {selectedVideoIds.length} / 共 {allVideos.length} 个
                    </span>
                  </div>
                  {allVideos.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="暂无视频资源"
                      className={styles.empty}
                      style={{ padding: '8px 0' }}
                    />
                  ) : (
                    <div className={styles.imageGrid} style={{ maxHeight: '30vh' }}>
                      {allVideos.map((vid) => (
                        <div
                          key={vid.id}
                          className={`${styles.imageItem} ${selectedVideoIds.includes(vid.id) ? styles.selected : ''}`}
                          onClick={() => toggleVideoSelection(vid.id)}
                        >
                          <VideoThumbnail
                            resource={vid}
                            style={{
                              height: `calc(37.5vh * ${cardScale})`,
                              maxWidth: `calc(52.5vw * ${cardScale})`,
                            }}
                          />
                          {selectedVideoIds.includes(vid.id) && (
                            <div className={styles.selectedBadge}>
                              {selectedVideoIds.indexOf(vid.id) + 1}
                            </div>
                          )}
                          <div className={styles.imageName} title={vid.fileName}>
                            {vid.fileName}
                          </div>
                          <div className={`${styles.typeTag} ${styles.newTag}`}>
                            {parseFolderName(vid.type)?.label || vid.type}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 参考音频选择 */}
                {allAudios.length > 0 && (
                  <div className={styles.section}>
                    <div className={styles.sectionTitle}>
                      音频（可选，用 @音频1 引用）
                      <span className={styles.count}>
                        已选 {videoModeAudioIds.length} / 共 {allAudios.length} 个
                      </span>
                    </div>
                    <div className={styles.imageGrid} style={{ maxHeight: '20vh' }}>
                      {allAudios.map((audio) => {
                        const sel = videoModeAudioIds.includes(audio.id);
                        const meta = isAudioMetadata(audio.metadata) ? audio.metadata : null;
                        return (
                          <div
                            key={audio.id}
                            className={`${styles.imageItem} ${sel ? styles.selected : ''}`}
                            onClick={() => toggleAudioSelection(audio.id)}
                          >
                            <div className={styles.videoThumbPlaceholder} style={{ width: 120, height: 80 }}>
                              <SoundOutlined style={{ fontSize: 24, color: 'var(--color-text-tertiary)' }} />
                            </div>
                            <div className={styles.imageName} title={audio.fileName}>
                              {audio.fileName}
                            </div>
                            {meta && (
                              <span style={{
                                position: 'absolute', top: 4, left: 4,
                                fontSize: 10, color: '#fff',
                                background: 'rgba(0,0,0,0.5)', borderRadius: 3, padding: '1px 4px',
                              }}>
                                {Math.floor(meta.duration / 60)}:{String(Math.floor(meta.duration % 60)).padStart(2, '0')}
                              </span>
                            )}
                            {sel && (
                              <div className={styles.selectedBadge}>
                                {videoModeAudioIds.indexOf(audio.id) + 1}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default GenerateImageDialog;
