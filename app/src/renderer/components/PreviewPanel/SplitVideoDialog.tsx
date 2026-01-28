import React, { useState, useEffect } from 'react';
import { Modal, Progress, App } from 'antd';
import type { Resource } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import { useNotificationStore } from '../../stores/notification';
import { useSplitPointsStore } from '../../stores/splitPoints';
import styles from './SplitVideoDialog.module.css';

interface SplitVideoDialogProps {
  visible: boolean;
  resource: Resource;
  onClose: () => void;
}

const SplitVideoDialog: React.FC<SplitVideoDialogProps> = ({
  visible,
  resource,
  onClose,
}) => {
  const { message } = App.useApp();
  const { selectedDraftId, loadResources } = useDraftStore();
  const { showError } = useNotificationStore();
  const { splitPoints, videoId } = useSplitPointsStore();

  const [isSplitting, setIsSplitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sceneCount, setSceneCount] = useState(0);

  // Check if we have split points for current video
  const hasSplitPoints = splitPoints.length > 0 && videoId === resource.id;

  // Reset state when dialog opens
  useEffect(() => {
    if (visible) {
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

    if (!hasSplitPoints) {
      message.error('没有可用的分割点');
      return;
    }

    setIsSplitting(true);
    setProgress(0);
    setStatusText('提交任务...');

    try {
      // 使用已编辑的分割点
      const result = await window.api.task.splitVideoWithPoints({
        draftId: selectedDraftId,
        sourceVideoId: resource.id,
        splitPoints: splitPoints,
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
      title="切分视频"
      open={visible}
      onCancel={isSplitting ? undefined : onClose}
      closable={!isSplitting}
      maskClosable={!isSplitting}
      okText={isSplitting ? '切分中...' : '确认切分'}
      cancelText={sceneCount > 0 ? '完成' : '取消'}
      onOk={handleSplit}
      okButtonProps={{
        disabled: isSplitting || sceneCount > 0,
        loading: isSplitting,
      }}
      cancelButtonProps={{ disabled: isSplitting }}
      width={400}
    >
      <div className={styles.content}>
        {/* Video Info */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>源视频</div>
          <div className={styles.videoInfo}>
            <span className={styles.fileName}>{resource.fileName}</span>
          </div>
        </div>

        {/* Split Points Info */}
        <div className={styles.section}>
          <div className={styles.splitInfo}>
            将按 <strong>{splitPoints.length}</strong> 个分割点切分为 <strong>{splitPoints.length + 1}</strong> 个分镜视频
          </div>
        </div>

        {/* Progress */}
        {(isSplitting || sceneCount > 0) && (
          <div className={styles.progressSection}>
            <Progress
              percent={Math.round(progress)}
              status={sceneCount > 0 ? 'success' : 'active'}
            />
            <div className={styles.statusText}>
              {statusText}
              {isSplitting && <span className={styles.timer}> ({elapsedSeconds}秒)</span>}
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
