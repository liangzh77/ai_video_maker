import React, { useState, useEffect, useRef } from 'react';
import { Modal, Progress, App, Empty, Select, Radio, Button, Input, Segmented, InputNumber } from 'antd';
import { CopyOutlined, CloseCircleOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons';
import type { Resource, ImageResolution, TextMetadata } from '@shared/types';
import { isTextMetadata } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import styles from './GenerateImageDialog.module.css';

interface ModelInfo {
  id: string;
  name: string;
}

type GenerateMode = 'image' | 'text';

// 并发池：创建 N 个任务，最多同时运行 M 个
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  onTaskComplete: (result: T, index: number) => void,
  onTaskError: (error: Error, index: number) => void,
  abortSignal?: { aborted: boolean },
): Promise<void> {
  let nextIndex = 0;
  const runNext = async (): Promise<void> => {
    const index = nextIndex++;
    if (index >= tasks.length) return;
    if (abortSignal?.aborted) return;
    try {
      const result = await tasks[index]();
      onTaskComplete(result, index);
    } catch (err) {
      onTaskError(err instanceof Error ? err : new Error(String(err)), index);
    }
    if (!abortSignal?.aborted) {
      await runNext();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => runNext())
  );
}

interface GenerateImageDialogProps {
  visible: boolean;
  promptResource: Resource;
  promptContent: string;
  onClose: () => void;
}

const GenerateImageDialog: React.FC<GenerateImageDialogProps> = ({
  visible,
  promptResource,
  promptContent,
  onClose,
}) => {
  const { message } = App.useApp();
  const { selectedDraftId, resources, loadResources, addTextResource } = useDraftStore();

  const [mode, setMode] = useState<GenerateMode>('image');
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<ImageResolution>('2K');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorModalVisible, setErrorModalVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [editedPrompt, setEditedPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  // 批量生成状态
  const [batchCount, setBatchCount] = useState(1);
  const [threadCount, setThreadCount] = useState(2);
  const [completedCount, setCompletedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [textResults, setTextResults] = useState<string[]>([]);

  const [isStopping, setIsStopping] = useState(false);

  // 用于取消正在进行的生成
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });

  // debounce loadResources，避免并发完成时多次刷新竞争
  const loadResourcesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // 显示持久错误弹窗
  const showError = (error: string) => {
    setErrorMessage(error);
    setErrorModalVisible(true);
  };

  // 复制错误信息到剪贴板
  const handleCopyError = () => {
    navigator.clipboard.writeText(errorMessage).then(() => {
      message.success('错误信息已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败');
    });
  };

  // Filter source character images and new character images
  const sourceImages = resources.filter((r) => r.type === 'source_character');
  const newImages = resources.filter((r) => r.type === 'new_character');
  const allImages = [...sourceImages, ...newImages];

  // 多选图片的处理函数
  const toggleImageSelection = (imageId: string) => {
    if (isGenerating) return;
    setSelectedImageIds((prev) => {
      if (prev.includes(imageId)) {
        return prev.filter((id) => id !== imageId);
      } else {
        return [...prev, imageId];
      }
    });
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
  useEffect(() => {
    if (visible) {
      setSelectedImageIds([]);
      setIsGenerating(false);
      setElapsedSeconds(0);
      setEditedPrompt(promptContent);
      setSystemPrompt('');
      setCompletedCount(0);
      setFailedCount(0);
      setTextResults([]);
      setIsStopping(false);
      abortRef.current = { aborted: false };
      // 根据 prompt 的 tag 设置默认生成模式
      const meta = promptResource.metadata;
      if (meta && isTextMetadata(meta) && meta.tag === 'text') {
        setMode('text');
      } else {
        setMode('image');
      }
    }
  }, [visible, promptContent, promptResource]);

  // Timer for elapsed time during generation
  useEffect(() => {
    if (!isGenerating) {
      return;
    }

    setElapsedSeconds(0);
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [isGenerating]);

  // 生成图片（批量）
  const handleGenerateImage = async () => {
    if (!selectedDraftId || selectedImageIds.length === 0) {
      message.error('请先选择至少一张参考图片');
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

    setIsGenerating(true);
    setIsStopping(false);
    setCompletedCount(0);
    setFailedCount(0);
    abortRef.current = { aborted: false };

    try {
      const tasks = Array.from({ length: batchCount }, () => async () => {
        const result = await window.api.task.generateImageDirect({
          draftId: selectedDraftId,
          sourceImageIds: selectedImageIds,
          promptResourceId: promptResource.id,
          prompt: editedPrompt,
          modelEndpoint: selectedModel!,
          resolution: selectedResolution,
        });
        if (!result.success) throw new Error(result.error || '生成失败');
        return result.data;
      });

      await runWithConcurrency(
        tasks,
        threadCount,
        (_result, _index) => {
          setCompletedCount((prev) => prev + 1);
          // debounce 刷新资源列表，避免并发完成时多次刷新竞争
          if (selectedDraftId) {
            if (loadResourcesTimerRef.current) {
              clearTimeout(loadResourcesTimerRef.current);
            }
            loadResourcesTimerRef.current = setTimeout(() => {
              loadResources(selectedDraftId);
            }, 300);
          }
        },
        (error, index) => {
          setFailedCount((prev) => prev + 1);
          console.error(`Image task ${index} failed:`, error);
        },
        abortRef.current,
      );

      // 全部完成后最终刷新一次，确保所有结果都显示
      if (loadResourcesTimerRef.current) {
        clearTimeout(loadResourcesTimerRef.current);
      }
      if (selectedDraftId) {
        await loadResources(selectedDraftId);
      }

      setIsGenerating(false);
      setIsStopping(false);
      if (abortRef.current.aborted) {
        message.info('已停止生成');
      } else {
        message.success('图片生成完成');
      }
    } catch (error) {
      console.error('Batch image generation error:', error);
      showError(error instanceof Error ? error.message : '生成失败');
      setIsGenerating(false);
      setIsStopping(false);
    }
  };

  // 生成文本（批量）
  const handleGenerateText = async () => {
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

    setIsGenerating(true);
    setIsStopping(false);
    setCompletedCount(0);
    setFailedCount(0);
    setTextResults([]);
    abortRef.current = { aborted: false };

    try {
      const tasks = Array.from({ length: batchCount }, () => async () => {
        const result = await window.api.task.generateText({
          draftId: selectedDraftId,
          prompt: editedPrompt,
          systemPrompt: systemPrompt.trim() || undefined,
          modelEndpoint: selectedModel!,
        });
        if (!result.success) throw new Error(result.error || '生成失败');
        return result.data.text;
      });

      await runWithConcurrency(
        tasks,
        threadCount,
        async (text, _index) => {
          setCompletedCount((prev) => prev + 1);
          setTextResults((prev) => [...prev, text]);
          // 创建新的提示词卡片
          await addTextResource(selectedDraftId, 'prompt', text);
        },
        (error, index) => {
          setFailedCount((prev) => prev + 1);
          console.error(`Text task ${index} failed:`, error);
        },
        abortRef.current,
      );

      setIsGenerating(false);
      setIsStopping(false);
      if (abortRef.current.aborted) {
        message.info('已停止生成');
      } else {
        message.success('文本生成完成');
      }
    } catch (error) {
      console.error('Batch text generation error:', error);
      showError(error instanceof Error ? error.message : '生成失败');
      setIsGenerating(false);
      setIsStopping(false);
    }
  };

  const handleGenerate = () => {
    if (mode === 'image') {
      handleGenerateImage();
    } else {
      handleGenerateText();
    }
  };

  const getImageUrl = (resource: Resource) => {
    const normalizedPath = resource.filePath.replace(/\\/g, '/');
    return `local-file:///${normalizedPath}`;
  };

  // 根据模式判断确定按钮是否可用
  const isOkDisabled = (() => {
    if (isGenerating || !selectedModel) return true;
    if (mode === 'image') return selectedImageIds.length === 0;
    return false;
  })();

  const dialogTitle = mode === 'image' ? '生成新角色图片' : '生成文本';

  // 计算进度百分比
  const totalTasks = batchCount;
  const progressPercent = totalTasks > 0 ? Math.round(((completedCount + failedCount) / totalTasks) * 100) : 0;

  return (
    <Modal
      title={dialogTitle}
      open={visible}
      onCancel={isGenerating ? () => { abortRef.current.aborted = true; setIsStopping(true); } : onClose}
      closable={!isStopping}
      maskClosable={!isGenerating}
      okText={isGenerating ? '生成中...' : '生成'}
      cancelText={isStopping ? '停止中...' : isGenerating ? '停止生成' : '取消'}
      onOk={handleGenerate}
      okButtonProps={{
        disabled: isOkDisabled,
        loading: isGenerating,
      }}
      cancelButtonProps={{ danger: isGenerating, disabled: isStopping }}
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
            ]}
            value={mode}
            onChange={(val) => setMode(val as GenerateMode)}
            disabled={isGenerating}
          />
        </div>

        {/* Model Selection */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>选择模型</div>
          <Select
            value={selectedModel}
            onChange={setSelectedModel}
            placeholder="请选择模型"
            disabled={isGenerating}
            className={styles.modelSelect}
            options={models.map((m) => ({ value: m.id, label: m.name }))}
          />
        </div>

        {/* Batch Controls */}
        <div className={styles.section}>
          <div className={styles.batchControls}>
            <span className={styles.batchLabel}>生成份数</span>
            <InputNumber
              min={1}
              max={50}
              value={batchCount}
              onChange={(v) => setBatchCount(v || 1)}
              disabled={isGenerating}
              size="small"
              style={{ width: 70 }}
            />
            <span className={styles.batchLabel}>线程数</span>
            <InputNumber
              min={1}
              max={8}
              value={threadCount}
              onChange={(v) => setThreadCount(v || 1)}
              disabled={isGenerating}
              size="small"
              style={{ width: 70 }}
            />
          </div>
        </div>

        {/* Resolution Selection - Image mode only */}
        {mode === 'image' && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>分辨率</div>
            <Radio.Group
              value={selectedResolution}
              onChange={(e) => setSelectedResolution(e.target.value)}
              disabled={isGenerating}
            >
              <Radio value="2K">2K</Radio>
              <Radio value="4K">4K</Radio>
            </Radio.Group>
          </div>
        )}

        {/* System Prompt - Text mode only */}
        {mode === 'text' && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>系统提示词（可选）</div>
            <Input.TextArea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="设定 AI 的角色或行为，例如：你是一位专业的文案编辑"
              disabled={isGenerating}
              className={styles.promptInput}
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          </div>
        )}

        {/* Prompt Editor */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>提示词</div>
          <Input.TextArea
            value={editedPrompt}
            onChange={(e) => setEditedPrompt(e.target.value)}
            placeholder="输入提示词"
            disabled={isGenerating}
            className={styles.promptInput}
            autoSize={{ minRows: 2, maxRows: 6 }}
          />
        </div>

        {/* Image Selection - Image mode only */}
        {mode === 'image' && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              选择参考图片（支持多选）
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
                    {/* 显示图片类型标签 */}
                    <div className={`${styles.typeTag} ${img.type === 'source_character' ? styles.sourceTag : styles.newTag}`}>
                      {img.type === 'source_character' ? '源' : '新'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Text Results - Text mode, show generated text cards */}
        {mode === 'text' && textResults.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              生成结果
              <span className={styles.count}>{textResults.length} 条</span>
            </div>
            <div className={styles.textResultsGrid}>
              {textResults.map((text, index) => (
                <div key={index} className={styles.textResultCard}>
                  <div className={styles.textResultIndex}>#{index + 1}</div>
                  <div className={styles.textResultContent}>{text}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Progress */}
        {isGenerating && (
          <div className={styles.progressSection}>
            <Progress percent={progressPercent} status="active" />
            <div className={styles.statusText}>
              生成中: {completedCount}/{totalTasks} 完成
              {failedCount > 0 && <span className={styles.failedText}>，{failedCount} 失败</span>}
              <span className={styles.timer}> ({elapsedSeconds}秒)</span>
            </div>
          </div>
        )}

        {/* Completed summary (after generation) */}
        {!isGenerating && (completedCount > 0 || failedCount > 0) && (
          <div className={styles.progressSection}>
            <div className={styles.statusText}>
              生成完成: {completedCount} 成功
              {failedCount > 0 && <span className={styles.failedText}>，{failedCount} 失败</span>}
              <span className={styles.timer}> (耗时 {elapsedSeconds}秒)</span>
            </div>
          </div>
        )}
      </div>

      {/* 错误信息弹窗 */}
      <Modal
        title={
          <span style={{ color: '#ff4d4f' }}>
            <CloseCircleOutlined style={{ marginRight: 8 }} />
            生成失败
          </span>
        }
        open={errorModalVisible}
        onCancel={() => setErrorModalVisible(false)}
        footer={[
          <Button
            key="copy"
            icon={<CopyOutlined />}
            onClick={handleCopyError}
          >
            复制错误信息
          </Button>,
          <Button
            key="close"
            type="primary"
            onClick={() => setErrorModalVisible(false)}
          >
            关闭
          </Button>,
        ]}
        width={600}
      >
        <div
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            padding: '12px',
            backgroundColor: '#fafafa',
            borderRadius: '4px',
            border: '1px solid #f0f0f0',
            maxHeight: '300px',
            overflowY: 'auto',
          }}
        >
          {errorMessage}
        </div>
      </Modal>
    </Modal>
  );
};

export default GenerateImageDialog;
