/**
 * 分割点放大编辑对话框
 * 提供独立的视频播放器和分割点时间线编辑功能
 */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Modal, Slider, Tooltip, Button } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  SoundOutlined,
  MutedOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useSplitPointsStore } from '../../stores/splitPoints';
import type { Resource, VideoMetadata } from '@shared/types';
import styles from './SplitPointEditorDialog.module.css';

interface SplitPointEditorDialogProps {
  visible: boolean;
  src: string;
  resource: Resource;
  onClose: () => void;
}

// 节流间隔（毫秒）
const SEEK_THROTTLE_MS = 100;

const formatTime = (seconds: number): string => {
  if (!isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatTimeWithMs = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

const SplitPointEditorDialog: React.FC<SplitPointEditorDialogProps> = ({
  visible,
  src,
  resource,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // 拖拽相关引用
  const wasPlayingRef = useRef(false);
  const lastSeekTimeRef = useRef(0);
  const isSeekingRef = useRef(false);

  // 视频状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [hasError, setHasError] = useState(false);

  // 分割点状态
  const {
    splitPoints,
    selectedPointId,
    videoDuration: storeDuration,
    videoFps: storeFps,
    selectPoint,
    addPoint,
    removePoint,
  } = useSplitPointsStore();

  // 优先使用视频实际时长，否则使用 store 中的
  const effectiveDuration = duration > 0 ? duration : storeDuration;

  // 获取视频 fps
  const getVideoFps = useCallback(() => {
    const meta = resource.metadata as VideoMetadata;
    return meta?.fps || storeFps || 30;
  }, [resource.metadata, storeFps]);

  // Reset state when dialog opens
  useEffect(() => {
    if (visible) {
      setIsPlaying(false);
      setCurrentTime(0);
      setHasError(false);
      isSeekingRef.current = false;
      wasPlayingRef.current = false;
      // 延迟聚焦容器，确保 Modal 动画完成后 DOM 已就绪
      setTimeout(() => containerRef.current?.focus(), 200);
    }
  }, [visible]);

  // 对话框关闭时释放文件句柄
  useEffect(() => {
    if (!visible) {
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.src = '';
        video.load();
      }
    }
  }, [visible]);

  // 组件卸载时清理 video src
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.src = '';
        video.load();
      }
    };
  }, []);

  // Setup video event listeners (duration / error / ended)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !visible) return;

    const trySetDuration = () => {
      if (isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      }
    };

    const handleLoadedMetadata = () => {
      trySetDuration();
      setHasError(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    const handleError = () => {
      if (video.error?.code === 3 && isSeekingRef.current) {
        return;
      }
      setHasError(true);
      setIsPlaying(false);
    };

    const handleCanPlay = () => {
      setHasError(false);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('durationchange', trySetDuration);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    video.addEventListener('canplay', handleCanPlay);

    // 如果视频已经加载完成（可能是缓存），直接读取 duration
    if (video.readyState >= 1) {
      trySetDuration();
    }

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('durationchange', trySetDuration);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      video.removeEventListener('canplay', handleCanPlay);
    };
  }, [visible, src]);

  // 使用 requestAnimationFrame 轮询更新播放进度（比 timeupdate 事件更可靠）
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !visible || !isPlaying) return;

    let rafId: number;
    let lastUpdate = 0;
    const INTERVAL = 50; // ~20fps，足够平滑

    const update = (timestamp: number) => {
      if (timestamp - lastUpdate >= INTERVAL) {
        if (!isSeekingRef.current) {
          setCurrentTime(video.currentTime);
        }
        // 顺便检查 duration
        if (duration === 0 && isFinite(video.duration) && video.duration > 0) {
          setDuration(video.duration);
        }
        lastUpdate = timestamp;
      }
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);

    return () => cancelAnimationFrame(rafId);
  }, [visible, isPlaying, duration]);

  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || hasError) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      try {
        await video.play();
        setIsPlaying(true);
      } catch (err) {
        setHasError(true);
      }
    }
  }, [isPlaying, hasError]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  // 节流 seek 函数
  const throttledSeek = useCallback((time: number) => {
    const now = Date.now();
    if (now - lastSeekTimeRef.current >= SEEK_THROTTLE_MS) {
      const video = videoRef.current;
      if (video) {
        video.currentTime = time;
      }
      lastSeekTimeRef.current = now;
    }
  }, []);

  // 拖拽进行中
  const handleSliderChange = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;

    if (!isSeekingRef.current) {
      isSeekingRef.current = true;
      wasPlayingRef.current = isPlaying;

      if (isPlaying) {
        video.pause();
        setIsPlaying(false);
      }
    }

    setCurrentTime(value);
    throttledSeek(value);
  }, [isPlaying, throttledSeek]);

  // 拖拽结束
  const handleSliderAfterChange = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = value;
    setCurrentTime(value);

    const handleSeeked = () => {
      video.removeEventListener('seeked', handleSeeked);
      isSeekingRef.current = false;

      if (wasPlayingRef.current) {
        video.play().then(() => {
          setIsPlaying(true);
        }).catch(() => {
          video.load();
          video.currentTime = value;
        });
      }
      wasPlayingRef.current = false;
    };

    video.addEventListener('seeked', handleSeeked);

    // 超时保护
    setTimeout(() => {
      if (isSeekingRef.current) {
        video.removeEventListener('seeked', handleSeeked);
        isSeekingRef.current = false;
        wasPlayingRef.current = false;
      }
    }, 2000);
  }, []);

  // Frame step navigation
  const handleFrameStep = useCallback((direction: 'prev' | 'next') => {
    const video = videoRef.current;
    if (!video) return;

    const fps = getVideoFps();
    const frameDuration = 1 / fps;

    // Pause video if playing
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    }

    if (direction === 'prev') {
      video.currentTime = Math.max(0, video.currentTime - frameDuration);
    } else {
      video.currentTime = Math.min(video.duration, video.currentTime + frameDuration);
    }
    setCurrentTime(video.currentTime);
  }, [isPlaying, getVideoFps]);

  // Seek to specific time
  const seekToTime = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    }

    video.currentTime = time;
    setCurrentTime(time);
  }, [isPlaying]);

  const handleVolumeChange = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = value;
    setVolume(value);
    setIsMuted(value === 0);
  }, []);

  // Handle clicking a marker
  const handleMarkerClick = useCallback(
    (pointId: string, time: number, e: React.MouseEvent) => {
      e.stopPropagation();
      selectPoint(pointId);
      seekToTime(time);
    },
    [selectPoint, seekToTime]
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
      const seekTime = percentage * effectiveDuration;
      seekToTime(seekTime);
    },
    [effectiveDuration, seekToTime]
  );

  // 跳转到前一个分割点
  const goToPrevSplitPoint = useCallback(() => {
    if (splitPoints.length === 0) return;

    const sortedPoints = [...splitPoints].sort((a, b) => a.time - b.time);
    // 找到当前时间之前的分割点
    const prevPoint = sortedPoints.filter(p => p.time < currentTime - 0.05).pop();

    if (prevPoint) {
      selectPoint(prevPoint.id);
      seekToTime(prevPoint.time);
    } else {
      // 如果没有前一个，跳到最后一个（循环）
      const lastPoint = sortedPoints[sortedPoints.length - 1];
      selectPoint(lastPoint.id);
      seekToTime(lastPoint.time);
    }
  }, [splitPoints, currentTime, selectPoint, seekToTime]);

  // 跳转到后一个分割点
  const goToNextSplitPoint = useCallback(() => {
    if (splitPoints.length === 0) return;

    const sortedPoints = [...splitPoints].sort((a, b) => a.time - b.time);
    // 找到当前时间之后的分割点
    const nextPoint = sortedPoints.find(p => p.time > currentTime + 0.05);

    if (nextPoint) {
      selectPoint(nextPoint.id);
      seekToTime(nextPoint.time);
    } else {
      // 如果没有后一个，跳到第一个（循环）
      const firstPoint = sortedPoints[0];
      selectPoint(firstPoint.id);
      seekToTime(firstPoint.time);
    }
  }, [splitPoints, currentTime, selectPoint, seekToTime]);

  // Keyboard navigation
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 只在对话框内容获得焦点时响应
      const isInContainer = containerRef.current?.contains(document.activeElement as Node);
      const isInTimeline = timelineRef.current?.contains(document.activeElement as Node);
      const isActiveTimeline = document.activeElement === timelineRef.current;

      if (!isInContainer && !isInTimeline && !isActiveTimeline) {
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault();
          handleFrameStep('prev');
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault();
          handleFrameStep('next');
          break;
        case 's':
        case 'S':
          e.preventDefault();
          goToPrevSplitPoint();
          break;
        case 'w':
        case 'W':
          e.preventDefault();
          goToNextSplitPoint();
          break;
        case 'e':
        case 'E':
          e.preventDefault();
          addPoint(currentTime);
          break;
        case 'q':
        case 'Q':
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
  }, [visible, togglePlay, handleFrameStep, selectedPointId, removePoint, goToPrevSplitPoint, goToNextSplitPoint, addPoint, currentTime]);

  const selectedPoint = splitPoints.find((p) => p.id === selectedPointId);

  return (
    <Modal
      title="分割点编辑"
      open={visible}
      onCancel={onClose}
      footer={null}
      width="85vw"
      styles={{
        body: {
          /* 给 body 明确的高度，让子元素的 height 百分比能生效 */
          height: '85vh',
          padding: '16px 24px',
          overflow: 'hidden',
        },
      }}
      centered
      destroyOnClose
    >
      <div className={styles.dialogContent} ref={containerRef} tabIndex={0}>
        {/* Video Player */}
        <div className={styles.playerWrapper}>
          <div
            className={styles.player}
            onMouseEnter={() => setShowControls(true)}
            onMouseLeave={() => setShowControls(!isPlaying)}
          >
            <video
              ref={videoRef}
              src={src}
              className={styles.video}
              onClick={togglePlay}
              preload="metadata"
            />

            <div className={`${styles.controls} ${showControls ? styles.visible : ''}`}>
              <div className={styles.progress}>
                <Slider
                  value={currentTime}
                  min={0}
                  max={effectiveDuration || 100}
                  step={0.1}
                  onChange={handleSliderChange}
                  onChangeComplete={handleSliderAfterChange}
                  tooltip={{ formatter: (value) => formatTime(value || 0) }}
                  className={styles.progressSlider}
                />
              </div>

              <div className={styles.controlBar}>
                <div className={styles.leftControls}>
                  <button className={styles.controlButton} onClick={togglePlay}>
                    {isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                  </button>

                  <span className={styles.time}>
                    {formatTime(currentTime)} / {formatTime(effectiveDuration)}
                  </span>
                </div>

                <div className={styles.rightControls}>
                  <div className={styles.volumeControl}>
                    <button className={styles.controlButton} onClick={toggleMute}>
                      {isMuted || volume === 0 ? <MutedOutlined /> : <SoundOutlined />}
                    </button>
                    <Slider
                      value={isMuted ? 0 : volume}
                      min={0}
                      max={1}
                      step={0.1}
                      onChange={handleVolumeChange}
                      className={styles.volumeSlider}
                    />
                  </div>
                </div>
              </div>
            </div>

            {hasError && (
              <div className={styles.errorOverlay}>
                <span className={styles.errorText}>视频加载失败</span>
              </div>
            )}
          </div>
        </div>

        {/* Split Point Timeline */}
        <div className={styles.timelineContainer} ref={timelineRef} tabIndex={0}>
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
              {splitPoints.length} 个分割点 | A/D 逐帧 | W/S 跳转分割点 | E 添加 | Q 删除 | 空格播放
            </span>
          </div>

          {/* Timeline */}
          <div className={styles.timeline} onClick={handleTrackClick}>
            <div className={styles.track}>
              {/* Split point markers */}
              {splitPoints.map((point) => {
                const position = effectiveDuration > 0 ? (point.time / effectiveDuration) * 100 : 0;
                const isSelected = point.id === selectedPointId;
                return (
                  <Tooltip
                    key={point.id}
                    title={`${formatTimeWithMs(point.time)} (帧 ${point.frame})`}
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
                style={{ left: `${effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Current position info - always visible */}
          <div className={styles.pointInfo}>
            {formatTimeWithMs(currentTime)} | 帧 {Math.round(currentTime * getVideoFps())}
            {(() => {
              // 检查当前帧是否和某个分割点的帧数完全相等
              const currentFrame = Math.round(currentTime * getVideoFps());
              const sortedPoints = [...splitPoints].sort((a, b) => a.time - b.time);
              const matchIndex = sortedPoints.findIndex(p => p.frame === currentFrame);
              if (matchIndex !== -1) {
                return ` | 分割点 #${matchIndex + 1}`;
              }
              return null;
            })()}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default SplitPointEditorDialog;
