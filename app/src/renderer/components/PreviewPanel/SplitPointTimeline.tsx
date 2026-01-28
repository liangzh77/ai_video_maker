import React, { useCallback, useRef, useEffect } from 'react';
import { Tooltip, Button } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useSplitPointsStore } from '../../stores/splitPoints';
import styles from './SplitPointTimeline.module.css';

interface SplitPointTimelineProps {
  currentTime: number;
  duration: number;
  fps: number;
  onSeek: (time: number) => void;
  onFrameStep: (direction: 'prev' | 'next') => void;
}

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

const SplitPointTimeline: React.FC<SplitPointTimelineProps> = ({
  currentTime,
  duration,
  fps,
  onSeek,
  onFrameStep,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    splitPoints,
    selectedPointId,
    selectPoint,
    addPoint,
    removePoint,
  } = useSplitPointsStore();

  // Handle clicking a marker
  const handleMarkerClick = useCallback(
    (pointId: string, time: number, e: React.MouseEvent) => {
      e.stopPropagation();
      selectPoint(pointId);
      onSeek(time);
    },
    [selectPoint, onSeek]
  );

  // Handle adding a new split point at current time
  const handleAddPoint = useCallback(() => {
    addPoint(currentTime);
  }, [currentTime, addPoint]);

  // Handle removing the selected point
  const handleRemoveSelectedPoint = useCallback(() => {
    if (selectedPointId) {
      removePoint(selectedPointId);
    }
  }, [selectedPointId, removePoint]);

  // Handle clicking on the timeline track to seek
  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = x / rect.width;
      const seekTime = percentage * duration;
      onSeek(seekTime);
    },
    [duration, onSeek]
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if timeline container is focused or has focus within
      if (!containerRef.current?.contains(document.activeElement) &&
          document.activeElement !== containerRef.current) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          onFrameStep('prev');
          break;
        case 'ArrowRight':
          e.preventDefault();
          onFrameStep('next');
          break;
        case 'Delete':
        case 'Backspace':
          if (selectedPointId) {
            e.preventDefault();
            removePoint(selectedPointId);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onFrameStep, selectedPointId, removePoint]);

  const selectedPoint = splitPoints.find((p) => p.id === selectedPointId);

  return (
    <div className={styles.container} ref={containerRef} tabIndex={0}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <Tooltip title="在当前位置添加分割点">
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            onClick={handleAddPoint}
          />
        </Tooltip>
        <Tooltip title="删除选中的分割点 (Delete)">
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            onClick={handleRemoveSelectedPoint}
            disabled={!selectedPointId}
            danger={!!selectedPointId}
          />
        </Tooltip>
        <span className={styles.hint}>
          {splitPoints.length} 个分割点 | 左右方向键逐帧移动
        </span>
      </div>

      {/* Timeline */}
      <div className={styles.timeline} onClick={handleTrackClick}>
        <div className={styles.track}>
          {/* Split point markers */}
          {splitPoints.map((point) => {
            const position = duration > 0 ? (point.time / duration) * 100 : 0;
            const isSelected = point.id === selectedPointId;
            return (
              <Tooltip
                key={point.id}
                title={`${formatTime(point.time)} (帧 ${point.frame})`}
              >
                <div
                  className={`${styles.marker} ${
                    isSelected ? styles.selected : ''
                  } ${point.isAutoDetected ? styles.auto : styles.manual}`}
                  style={{ left: `${position}%` }}
                  onClick={(e) => handleMarkerClick(point.id, point.time, e)}
                />
              </Tooltip>
            );
          })}

          {/* Playhead (current position indicator) */}
          <div
            className={styles.playhead}
            style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Selected point info */}
      {selectedPoint && (
        <div className={styles.pointInfo}>
          已选择: {formatTime(selectedPoint.time)} | 帧 {selectedPoint.frame} |{' '}
          {selectedPoint.isAutoDetected ? '自动检测' : '手动添加'}
        </div>
      )}
    </div>
  );
};

export default SplitPointTimeline;
