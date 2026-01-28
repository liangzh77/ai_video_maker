import React, { useState, useEffect } from 'react';
import { Modal, Progress, App, Select, InputNumber } from 'antd';
import type { Resource, SplitConfig } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import { useNotificationStore } from '../../stores/notification';
import styles from './SplitVideoDialog.module.css';

interface SplitVideoDialogProps {
  visible: boolean;
  resource: Resource;
  onClose: () => void;
}

const DETECTOR_OPTIONS = [
  { value: 'content', label: '内容检测 (推荐)', description: '适用于大多数场景' },
  { value: 'adaptive', label: '自适应检测', description: '适用于快速相机运动' },
  { value: 'threshold', label: '阈值检测', description: '适用于淡入淡出' },
  { value: 'histogram', label: '直方图检测', description: '基于颜色分布' },
  { value: 'hash', label: '感知哈希', description: '较慢但准确' },
];

const SplitVideoDialog: React.FC<SplitVideoDialogProps> = ({
  visible,
  resource,
  onClose,
}) => {
  const { message } = App.useApp();
  const { selectedDraftId, loadResources } = useDraftStore();
  const { showError } = useNotificationStore();

  const [detectorType, setDetectorType] = useState<SplitConfig['detectorType']>('content');
  const [minSceneLen, setMinSceneLen] = useState(15);
  const [isSplitting, setIsSplitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sceneCount, setSceneCount] = useState(0);

  // Reset state when dialog opens
  useEffect(() => {
    if (visible) {
      setDetectorType('content');
      setMinSceneLen(15);
      setIsSplitting(false);
      setProgress(0);
      setStatusText('');
      setElapsedSeconds(0);
      setSceneCount(0);
    }
  }, [visible]);

  // Timer for elapsed time during splitting
  useEffect(() => {
    if (!isSplitting) {
      return;
    }

    setElapsedSeconds(0);
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [isSplitting]);

  // Listen for task progress events
  useEffect(() => {
    if (!isSplitting) return;

    const handleProgress = (_: any, event: { taskId: string; progress: number; status: string; error?: string }) => {
      console.log('[SplitVideoDialog] Progress event:', event);
      setProgress(event.progress);

      if (event.status === 'failed') {
        const errorMsg = event.error || '分割失败';
        setStatusText(`失败: ${errorMsg}`);
        setIsSplitting(false);
        showError(`视频分割失败: ${errorMsg}`);
        return;
      }

      if (event.status === 'processing') {
        if (event.progress < 10) {
          setStatusText('准备中...');
        } else if (event.progress < 90) {
          setStatusText('分割中...');
        } else {
          setStatusText('保存中...');
        }
      }
    };

    const handleCompleted = (_: any, event: { taskId: string; outputResourceIds: string[] }) => {
      console.log('[SplitVideoDialog] Completed event:', event);
      setProgress(100);
      setSceneCount(event.outputResourceIds.length);
      setStatusText(`分割完成! 生成 ${event.outputResourceIds.length} 个分镜`);
      setIsSplitting(false);

      // Reload resources to show new scenes
      if (selectedDraftId) {
        loadResources(selectedDraftId);
      }

      message.success(`视频分割成功，生成 ${event.outputResourceIds.length} 个分镜`);

      // Close dialog after a short delay
      setTimeout(() => {
        onClose();
      }, 1500);
    };

    const unsubProgress = window.api.on('task:progress', handleProgress);
    const unsubCompleted = window.api.on('task:completed', handleCompleted);

    return () => {
      unsubProgress();
      unsubCompleted();
    };
  }, [isSplitting, selectedDraftId, loadResources, message, onClose, showError]);

  const handleSplit = async () => {
    if (!selectedDraftId) {
      message.error('请先选择草稿');
      return;
    }

    setIsSplitting(true);
    setProgress(0);
    setStatusText('提交任务...');

    try {
      const result = await window.api.task.splitVideo({
        draftId: selectedDraftId,
        sourceVideoId: resource.id,
        config: {
          detectorType,
          minSceneLen,
        },
      });

      if (!result.success) {
        throw new Error(result.error || '分割失败');
      }

      // Task created, wait for progress events
      setStatusText('任务已创建，等待处理...');
    } catch (error) {
      console.error('Split video error:', error);
      const errorMsg = error instanceof Error ? error.message : '分割失败';
      showError(`视频分割失败: ${errorMsg}`);
      setIsSplitting(false);
    }
  };

  return (
    <Modal
      title="分割视频"
      open={visible}
      onCancel={isSplitting ? undefined : onClose}
      closable={!isSplitting}
      maskClosable={!isSplitting}
      okText={isSplitting ? '分割中...' : '开始分割'}
      cancelText="取消"
      onOk={handleSplit}
      okButtonProps={{
        disabled: isSplitting,
        loading: isSplitting,
      }}
      cancelButtonProps={{ disabled: isSplitting }}
      width={500}
    >
      <div className={styles.content}>
        {/* Video Info */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>源视频</div>
          <div className={styles.videoInfo}>
            <span className={styles.fileName}>{resource.fileName}</span>
          </div>
        </div>

        {/* Detector Type */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>场景检测方式</div>
          <Select
            value={detectorType}
            onChange={setDetectorType}
            disabled={isSplitting}
            className={styles.select}
            options={DETECTOR_OPTIONS.map((opt) => ({
              value: opt.value,
              label: (
                <div className={styles.optionLabel}>
                  <span>{opt.label}</span>
                  <span className={styles.optionDesc}>{opt.description}</span>
                </div>
              ),
            }))}
          />
        </div>

        {/* Min Scene Length */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>最小场景长度 (帧)</div>
          <InputNumber
            value={minSceneLen}
            onChange={(value) => setMinSceneLen(value || 15)}
            min={1}
            max={300}
            disabled={isSplitting}
            className={styles.inputNumber}
          />
          <div className={styles.hint}>
            避免过短的场景，默认 15 帧 (约 0.5 秒)
          </div>
        </div>

        {/* Progress */}
        {isSplitting && (
          <div className={styles.progressSection}>
            <Progress percent={progress} status="active" />
            <div className={styles.statusText}>
              {statusText} <span className={styles.timer}>({elapsedSeconds}秒)</span>
            </div>
          </div>
        )}

        {/* Result */}
        {sceneCount > 0 && !isSplitting && (
          <div className={styles.result}>
            已生成 <strong>{sceneCount}</strong> 个分镜视频
          </div>
        )}
      </div>
    </Modal>
  );
};

export default SplitVideoDialog;
