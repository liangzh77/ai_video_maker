import React, { useState, useEffect } from 'react';
import { Modal, Progress, App, Select, InputNumber } from 'antd';
import type { Resource, SplitConfig } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import { useNotificationStore } from '../../stores/notification';
import { useSplitPointsStore } from '../../stores/splitPoints';
import styles from './SplitVideoDialog.module.css';

interface AnalyzeVideoDialogProps {
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

const AnalyzeVideoDialog: React.FC<AnalyzeVideoDialogProps> = ({
  visible,
  resource,
  onClose,
}) => {
  const { message } = App.useApp();
  const { selectedDraftId } = useDraftStore();
  const { showError } = useNotificationStore();
  const { analyze, splitPoints, clearPoints, videoId } = useSplitPointsStore();

  const [detectorType, setDetectorType] = useState<SplitConfig['detectorType']>('content');
  const [minSceneLen, setMinSceneLen] = useState(15);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [resultCount, setResultCount] = useState<number | null>(null);

  // Check if we already have split points for this video
  const hasSplitPoints = splitPoints.length > 0 && videoId === resource.id;

  // Reset state when dialog opens
  useEffect(() => {
    if (visible) {
      setDetectorType('content');
      setMinSceneLen(15);
      setIsAnalyzing(false);
      setProgress(0);
      setStatusText('');
      setElapsedSeconds(0);
      setResultCount(null);
    }
  }, [visible]);

  // Timer for elapsed time during analyzing
  useEffect(() => {
    if (!isAnalyzing) {
      return;
    }

    setElapsedSeconds(0);
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [isAnalyzing]);

  // Simulate progress during analysis
  useEffect(() => {
    if (!isAnalyzing) {
      return;
    }

    const progressTimer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 10;
      });
    }, 500);

    return () => clearInterval(progressTimer);
  }, [isAnalyzing]);

  const handleAnalyze = async () => {
    if (!selectedDraftId) {
      message.error('请先选择草稿');
      return;
    }

    // Clear previous points if analyzing
    if (hasSplitPoints) {
      clearPoints();
    }

    setIsAnalyzing(true);
    setProgress(0);
    setStatusText('正在分析视频场景...');
    setResultCount(null);

    try {
      console.log('[AnalyzeVideoDialog] Starting analysis with config:', {
        detectorType,
        minSceneLen,
      });

      const success = await analyze(selectedDraftId, resource.id, {
        detectorType,
        minSceneLen,
      });

      setProgress(100);

      if (success) {
        // Get the updated split points count from the store
        const storeState = useSplitPointsStore.getState();
        const updatedPoints = storeState.splitPoints;
        console.log('[AnalyzeVideoDialog] Analysis success, store state:', {
          videoId: storeState.videoId,
          splitPointsCount: updatedPoints.length,
          resourceId: resource.id,
        });
        setResultCount(updatedPoints.length);

        if (updatedPoints.length > 0) {
          setStatusText(`分析完成! 检测到 ${updatedPoints.length} 个分割点`);
          message.success(`检测到 ${updatedPoints.length} 个分割点`);
        } else {
          setStatusText('分析完成，但未检测到场景切换点');
          message.warning('未检测到场景切换点，视频可能是连续拍摄的');
        }
      } else {
        setStatusText('分析失败');
        showError('视频分析失败，请检查视频文件');
      }
    } catch (error) {
      console.error('Analyze video error:', error);
      const errorMsg = error instanceof Error ? error.message : '分析失败';
      setStatusText(`失败: ${errorMsg}`);
      showError(`视频分析失败: ${errorMsg}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleClose = () => {
    if (!isAnalyzing) {
      onClose();
    }
  };

  return (
    <Modal
      title="分析视频场景"
      open={visible}
      onCancel={handleClose}
      closable={!isAnalyzing}
      maskClosable={!isAnalyzing}
      okText={isAnalyzing ? '分析中...' : '开始分析'}
      cancelText={resultCount !== null && resultCount > 0 ? '完成' : '取消'}
      onOk={handleAnalyze}
      okButtonProps={{
        disabled: isAnalyzing || (resultCount !== null && resultCount > 0),
        loading: isAnalyzing,
      }}
      cancelButtonProps={{ disabled: isAnalyzing }}
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

        {/* Warning if already has split points */}
        {hasSplitPoints && resultCount === null && (
          <div className={styles.section}>
            <div className={styles.hint} style={{ color: '#faad14' }}>
              已有 {splitPoints.length} 个分割点，重新分析将覆盖现有分割点
            </div>
          </div>
        )}

        {/* Detector Type */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>场景检测方式</div>
          <Select
            value={detectorType}
            onChange={setDetectorType}
            disabled={isAnalyzing || resultCount !== null}
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
            disabled={isAnalyzing || resultCount !== null}
            className={styles.inputNumber}
          />
          <div className={styles.hint}>
            避免过短的场景，默认 15 帧 (约 0.5 秒)
          </div>
        </div>

        {/* Progress */}
        {(isAnalyzing || resultCount !== null) && (
          <div className={styles.progressSection}>
            <Progress
              percent={Math.round(progress)}
              status={resultCount !== null ? (resultCount > 0 ? 'success' : 'exception') : 'active'}
            />
            <div className={styles.statusText}>
              {statusText}
              {isAnalyzing && <span className={styles.timer}> ({elapsedSeconds}秒)</span>}
            </div>
          </div>
        )}

        {/* Result */}
        {resultCount !== null && resultCount > 0 && (
          <div className={styles.result}>
            检测到 <strong>{resultCount}</strong> 个分割点，关闭对话框后可在时间轴上查看和编辑
          </div>
        )}
      </div>
    </Modal>
  );
};

export default AnalyzeVideoDialog;
