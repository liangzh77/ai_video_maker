import React, { useState, useEffect } from 'react';
import { Modal, Progress, App, Empty, Select } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';
import type { Resource } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import styles from './GenerateImageDialog.module.css';

interface ModelInfo {
  id: string;
  name: string;
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
  const { selectedDraftId, resources, loadResources } = useDraftStore();

  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Filter source character images
  const sourceImages = resources.filter((r) => r.type === 'source_character');

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
      setSelectedImageId(null);
      setIsGenerating(false);
      setProgress(0);
      setStatusText('');
      setElapsedSeconds(0);
    }
  }, [visible]);

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

  // Listen for task progress events
  useEffect(() => {
    if (!isGenerating) return;

    const handleProgress = (_: any, event: { taskId: string; progress: number; status: string; error?: string }) => {
      console.log('[GenerateImageDialog] Progress event:', event);
      setProgress(event.progress);

      if (event.status === 'failed') {
        setStatusText(`失败: ${event.error || '未知错误'}`);
        setIsGenerating(false);
        message.error(event.error || '生成失败');
        return;
      }

      if (event.status === 'processing') {
        if (event.progress < 30) {
          setStatusText('准备中...');
        } else if (event.progress < 90) {
          setStatusText('生成中...');
        } else {
          setStatusText('保存中...');
        }
      }
    };

    const handleCompleted = (_: any, event: { taskId: string; outputResourceIds: string[] }) => {
      console.log('[GenerateImageDialog] Completed event:', event);
      setProgress(100);
      setStatusText('生成完成!');
      setIsGenerating(false);

      // Reload resources to show new image
      if (selectedDraftId) {
        loadResources(selectedDraftId);
      }

      message.success('图片生成成功');

      // Close dialog after a short delay
      setTimeout(() => {
        onClose();
      }, 1000);
    };

    const unsubProgress = window.api.on('task:progress', handleProgress);
    const unsubCompleted = window.api.on('task:completed', handleCompleted);

    return () => {
      unsubProgress();
      unsubCompleted();
    };
  }, [isGenerating, selectedDraftId, loadResources, message, onClose]);

  const handleGenerate = async () => {
    if (!selectedDraftId || !selectedImageId) {
      message.error('请先选择源角色图片');
      return;
    }

    if (!selectedModel) {
      message.error('请先选择模型');
      return;
    }

    if (!promptContent || promptContent.trim().length === 0) {
      message.error('提示词内容不能为空');
      return;
    }

    setIsGenerating(true);
    setProgress(0);
    setStatusText('提交任务...');

    try {
      const result = await window.api.task.generateImage({
        draftId: selectedDraftId,
        sourceImageId: selectedImageId,
        promptResourceId: promptResource.id,
        modelEndpoint: selectedModel,
      });

      if (!result.success) {
        throw new Error(result.error || '生成失败');
      }

      // Task created, wait for progress events
      setStatusText('任务已创建，等待处理...');
    } catch (error) {
      console.error('Generate image error:', error);
      message.error(error instanceof Error ? error.message : '生成失败');
      setIsGenerating(false);
    }
  };

  const getImageUrl = (resource: Resource) => {
    // Use triple slash for Windows paths: local-file:///C:/path/to/file
    const normalizedPath = resource.filePath.replace(/\\/g, '/');
    return `local-file:///${normalizedPath}`;
  };

  return (
    <Modal
      title="生成新角色图片"
      open={visible}
      onCancel={isGenerating ? undefined : onClose}
      closable={!isGenerating}
      maskClosable={!isGenerating}
      okText={isGenerating ? '生成中...' : '生成'}
      cancelText="取消"
      onOk={handleGenerate}
      okButtonProps={{
        disabled: !selectedImageId || !selectedModel || isGenerating,
        loading: isGenerating,
      }}
      cancelButtonProps={{ disabled: isGenerating }}
      width={800}
    >
      <div className={styles.content}>
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

        {/* Prompt Preview */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>提示词</div>
          <div className={styles.promptPreview}>
            {promptContent || '(空提示词)'}
          </div>
        </div>

        {/* Source Image Selection */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            选择源角色图片
            <span className={styles.count}>({sourceImages.length})</span>
          </div>

          {sourceImages.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无源角色图片，请先添加"
              className={styles.empty}
            />
          ) : (
            <div className={styles.imageGrid}>
              {sourceImages.map((img) => (
                <div
                  key={img.id}
                  className={`${styles.imageItem} ${selectedImageId === img.id ? styles.selected : ''}`}
                  onClick={() => !isGenerating && setSelectedImageId(img.id)}
                >
                  <img
                    src={getImageUrl(img)}
                    alt={img.fileName}
                    className={styles.thumbnail}
                  />
                  {selectedImageId === img.id && (
                    <div className={styles.selectedBadge}>
                      <CheckCircleFilled />
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

        {/* Progress */}
        {isGenerating && (
          <div className={styles.progressSection}>
            <Progress percent={progress} status="active" />
            <div className={styles.statusText}>
              {statusText} <span className={styles.timer}>({elapsedSeconds}秒)</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default GenerateImageDialog;
