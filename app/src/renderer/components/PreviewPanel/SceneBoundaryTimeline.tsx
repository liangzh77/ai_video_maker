import React, { useCallback, useRef, useState, useEffect } from 'react';
import styles from './SceneBoundaryTimeline.module.css';

interface SceneBoundaryTimelineProps {
  // 源视频总时长
  duration: number;
  // 帧率
  fps: number;
  // 当前播放位置
  currentTime: number;
  // 当前分镜边界
  startTime: number;
  endTime: number;
  // 前一个分镜的结束时间（如果有）
  prevEndTime?: number;
  // 后一个分镜的开始时间（如果有）
  nextStartTime?: number;
  // 边界变更回调
  onBoundaryChange: (startTime: number, endTime: number) => void;
  // 播放位置变更回调
  onSeek: (time: number) => void;
  // 逐帧移动回调
  onFrameStep: (direction: 'prev' | 'next') => void;
  // 播放/暂停回调
  onTogglePlay: () => void;
}

// 吸附阈值（像素）
const SNAP_THRESHOLD_PX = 10;

// 格式化时间为 M:SS.ms
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
}

const SceneBoundaryTimeline: React.FC<SceneBoundaryTimelineProps> = ({
  duration,
  fps,
  currentTime,
  startTime,
  endTime,
  prevEndTime,
  nextStartTime,
  onBoundaryChange,
  onSeek,
  onFrameStep,
  onTogglePlay,
}) => {
  const boundaryTimelineRef = useRef<HTMLDivElement>(null);
  const seekTimelineRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | 'seek' | null>(null);
  const [snappingTo, setSnappingTo] = useState<'prev' | 'next' | 'current' | null>(null);

  // 计算位置百分比
  const getPositionPercent = useCallback((time: number) => {
    if (duration <= 0) return 0;
    return (time / duration) * 100;
  }, [duration]);

  // 从鼠标位置计算时间
  const getTimeFromMouseEvent = useCallback((e: MouseEvent | React.MouseEvent, timeline: HTMLDivElement | null) => {
    if (!timeline || duration <= 0) return 0;
    const rect = timeline.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    return percent * duration;
  }, [duration]);

  // 检查吸附
  const checkSnap = useCallback((time: number, timeline: HTMLDivElement | null): { time: number; snapTo: 'prev' | 'next' | 'current' | null } => {
    if (!timeline || duration <= 0) return { time, snapTo: null };

    const rect = timeline.getBoundingClientRect();
    const timeToPixel = (t: number) => (t / duration) * rect.width;
    const pixelToTime = (px: number) => (px / rect.width) * duration;

    const currentPx = timeToPixel(time);
    const snapTargets: { time: number; type: 'prev' | 'next' | 'current' }[] = [];

    // 添加吸附目标
    if (prevEndTime !== undefined) {
      snapTargets.push({ time: prevEndTime, type: 'prev' });
    }
    if (nextStartTime !== undefined) {
      snapTargets.push({ time: nextStartTime, type: 'next' });
    }
    snapTargets.push({ time: currentTime, type: 'current' });

    // 找到最近的吸附目标
    for (const target of snapTargets) {
      const targetPx = timeToPixel(target.time);
      if (Math.abs(currentPx - targetPx) <= SNAP_THRESHOLD_PX) {
        return { time: target.time, snapTo: target.type };
      }
    }

    return { time, snapTo: null };
  }, [duration, prevEndTime, nextStartTime, currentTime]);

  // 处理播放时间线点击（跳转播放位置）
  const handleSeekTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const time = getTimeFromMouseEvent(e, seekTimelineRef.current);
    onSeek(time);
  }, [getTimeFromMouseEvent, onSeek]);

  // 处理边界拖拽开始
  const handleBoundaryMouseDown = useCallback((type: 'start' | 'end') => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(type);
    setSnappingTo(null);
  }, []);

  // 处理播放位置拖拽开始
  const handleSeekMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging('seek');
  }, []);

  // 处理边界拖拽
  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (dragging === 'seek') {
        const time = getTimeFromMouseEvent(e, seekTimelineRef.current);
        const clampedTime = Math.max(0, Math.min(duration, time));
        onSeek(clampedTime);
        return;
      }

      const rawTime = getTimeFromMouseEvent(e, boundaryTimelineRef.current);
      const { time, snapTo } = checkSnap(rawTime, boundaryTimelineRef.current);
      setSnappingTo(snapTo);

      if (dragging === 'start') {
        // 开始边界：不能大于结束时间 - 1帧
        const minFrameTime = 1 / fps;
        const maxTime = endTime - minFrameTime;
        const clampedTime = Math.max(0, Math.min(maxTime, time));
        onBoundaryChange(clampedTime, endTime);
      } else if (dragging === 'end') {
        // 结束边界：不能小于开始时间 + 1帧
        const minFrameTime = 1 / fps;
        const minTime = startTime + minFrameTime;
        const clampedTime = Math.max(minTime, Math.min(duration, time));
        onBoundaryChange(startTime, clampedTime);
      }
    };

    const handleMouseUp = () => {
      setDragging(null);
      setSnappingTo(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, startTime, endTime, duration, fps, getTimeFromMouseEvent, checkSnap, onBoundaryChange, onSeek]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框中的按键
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        onTogglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        onFrameStep('prev');
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        onFrameStep('next');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onTogglePlay, onFrameStep]);

  const sceneDuration = endTime - startTime;

  return (
    <div className={styles.container}>
      {/* 边界时间线（上方） */}
      <div ref={boundaryTimelineRef} className={styles.boundaryTimeline}>
        {/* 当前分镜的有效区域 */}
        <div
          className={styles.activeRegion}
          style={{
            left: `${getPositionPercent(startTime)}%`,
            width: `${getPositionPercent(endTime) - getPositionPercent(startTime)}%`,
          }}
        />

        {/* 前一个分镜结束位置参考线 */}
        {prevEndTime !== undefined && (
          <div
            className={`${styles.referenceLine} ${styles.prev}`}
            style={{ left: `${getPositionPercent(prevEndTime)}%` }}
            title={`前一个分镜结束: ${formatTime(prevEndTime)}`}
          />
        )}

        {/* 后一个分镜开始位置参考线 */}
        {nextStartTime !== undefined && (
          <div
            className={`${styles.referenceLine} ${styles.next}`}
            style={{ left: `${getPositionPercent(nextStartTime)}%` }}
            title={`后一个分镜开始: ${formatTime(nextStartTime)}`}
          />
        )}

        {/* 当前播放位置指示器 */}
        <div
          className={styles.playhead}
          style={{ left: `${getPositionPercent(currentTime)}%` }}
        />

        {/* 开始边界标记 */}
        <div
          className={`${styles.boundaryMarker} ${dragging === 'start' ? styles.dragging : ''} ${snappingTo && dragging === 'start' ? styles.snapping : ''}`}
          style={{ left: `calc(${getPositionPercent(startTime)}% - 4px)` }}
          onMouseDown={handleBoundaryMouseDown('start')}
          title={`开始: ${formatTime(startTime)}`}
        />

        {/* 结束边界标记 */}
        <div
          className={`${styles.boundaryMarker} ${dragging === 'end' ? styles.dragging : ''} ${snappingTo && dragging === 'end' ? styles.snapping : ''}`}
          style={{ left: `calc(${getPositionPercent(endTime)}% - 4px)` }}
          onMouseDown={handleBoundaryMouseDown('end')}
          title={`结束: ${formatTime(endTime)}`}
        />
      </div>

      {/* 播放时间线（下方） */}
      <div
        ref={seekTimelineRef}
        className={styles.seekTimeline}
        onClick={handleSeekTimelineClick}
      >
        {/* 当前播放位置（可拖拽） */}
        <div
          className={styles.seekPlayhead}
          style={{ left: `${getPositionPercent(currentTime)}%` }}
          onMouseDown={handleSeekMouseDown}
        />
      </div>

      {/* 时间显示 */}
      <div className={styles.timeDisplay}>
        <div className={styles.timeInfo}>
          <span>
            <span className={styles.timeLabel}>开始: </span>
            <span className={`${styles.timeValue} ${styles.start}`}>{formatTime(startTime)}</span>
          </span>
          <span>
            <span className={styles.timeLabel}>结束: </span>
            <span className={`${styles.timeValue} ${styles.end}`}>{formatTime(endTime)}</span>
          </span>
          <span>
            <span className={styles.timeLabel}>时长: </span>
            <span className={styles.durationValue}>{formatTime(sceneDuration)}</span>
          </span>
          <span>
            <span className={styles.timeLabel}>当前: </span>
            <span className={`${styles.timeValue} ${styles.current}`}>{formatTime(currentTime)}</span>
          </span>
        </div>
        <div>
          <span className={styles.timeLabel}>源视频: </span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* 帮助提示 */}
      <div className={styles.hint}>
        空格：播放/暂停 | ← →：逐帧移动 | 拖拽绿色标记调整边界（自动吸附到参考线）
      </div>
    </div>
  );
};

export default SceneBoundaryTimeline;
