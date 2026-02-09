import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Modal, Button, Slider, App } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  SoundOutlined,
  MutedOutlined,
} from '@ant-design/icons';
import type { Resource, VideoMetadata } from '@shared/types';
import { usePlaybackStore } from '../../stores/playback';
import SceneBoundaryTimeline from './SceneBoundaryTimeline';
import styles from './SceneBoundaryEditorDialog.module.css';

// 播放器类型常量
const PLAYER_TYPE = 'boundary-editor' as const;

interface SceneBoundaryEditorDialogProps {
  visible: boolean;
  sceneResource: Resource;
  sourceVideoResource: Resource;
  prevSceneResource?: Resource;
  nextSceneResource?: Resource;
  onClose: () => void;
  onConfirm: (startTime: number, endTime: number) => Promise<void>;
}

// 格式化时间为 M:SS.ms
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
}

const SceneBoundaryEditorDialog: React.FC<SceneBoundaryEditorDialogProps> = ({
  visible,
  sceneResource,
  sourceVideoResource,
  prevSceneResource,
  nextSceneResource,
  onClose,
  onConfirm,
}) => {
  const { message } = App.useApp();
  const videoRef = useRef<HTMLVideoElement>(null);

  // 全局播放状态管理
  const { startPlaying, stopPlaying, pauseRequestId, activePlayerType } = usePlaybackStore();
  const prevPauseRequestIdRef = useRef(pauseRequestId);

  // 视频状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 边界状态
  const sceneMeta = sceneResource.metadata as VideoMetadata;
  const [startTime, setStartTime] = useState(sceneMeta.startTime ?? 0);
  // endTime 应该是源视频中的绝对时间，不是分镜的时长
  // 如果 endTime 未定义，使用 startTime + duration 来计算
  const [endTime, setEndTime] = useState(
    sceneMeta.endTime ?? ((sceneMeta.startTime ?? 0) + sceneMeta.duration)
  );

  // 获取前后分镜的边界时间
  const prevEndTime = prevSceneResource
    ? (prevSceneResource.metadata as VideoMetadata).endTime
    : undefined;
  const nextStartTime = nextSceneResource
    ? (nextSceneResource.metadata as VideoMetadata).startTime
    : undefined;

  // 构建源视频 URL
  const getLocalFileUrl = (filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return `local-file:///${normalizedPath}`;
  };

  const sourceVideoUrl = getLocalFileUrl(sourceVideoResource.filePath);

  // 重置状态
  useEffect(() => {
    if (visible) {
      setIsPlaying(false);
      setCurrentTime(sceneMeta.startTime ?? 0);
      setHasError(false);
      setIsLoading(true);
      setStartTime(sceneMeta.startTime ?? 0);
      // endTime 应该是源视频中的绝对时间，不是分镜的时长
      setEndTime(sceneMeta.endTime ?? ((sceneMeta.startTime ?? 0) + sceneMeta.duration));
    }
  }, [visible, sceneMeta.startTime, sceneMeta.endTime, sceneMeta.duration]);

  // 监听其他播放器开始播放时，暂停当前播放器
  useEffect(() => {
    if (pauseRequestId !== prevPauseRequestIdRef.current) {
      prevPauseRequestIdRef.current = pauseRequestId;
      // 如果当前不是活跃播放器，暂停视频
      if (activePlayerType !== PLAYER_TYPE && isPlaying) {
        const video = videoRef.current;
        if (video) {
          video.pause();
          setIsPlaying(false);
        }
      }
    }
  }, [pauseRequestId, activePlayerType, isPlaying]);

  // 对话框关闭时停止播放状态，释放文件句柄
  useEffect(() => {
    if (!visible) {
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.src = '';
        video.load();
      }
      stopPlaying(PLAYER_TYPE);
    }
  }, [visible, stopPlaying]);

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

  // 视频事件监听
  useEffect(() => {
    if (!visible) return;

    // 使用 setTimeout 确保 video 元素已渲染
    const timeoutId = setTimeout(() => {
      const video = videoRef.current;
      if (!video) {
        console.warn('[SceneBoundaryEditor] Video element not found');
        return;
      }

      const handleLoadedMetadata = () => {
        console.log('[SceneBoundaryEditor] loadedmetadata, duration:', video.duration);
        setDuration(video.duration);
        setIsLoading(false);
        // 跳转到分镜开始位置
        video.currentTime = startTime;
      };

      const handleTimeUpdate = () => {
        setCurrentTime(video.currentTime);
      };

      const handleEnded = () => {
        setIsPlaying(false);
        stopPlaying(PLAYER_TYPE);
      };

      const handleError = (e: Event) => {
        console.error('[SceneBoundaryEditor] Video error:', video.error);
        setHasError(true);
        setIsLoading(false);
      };

      const handleCanPlay = () => {
        console.log('[SceneBoundaryEditor] canplay');
        setIsLoading(false);
      };

      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      video.addEventListener('timeupdate', handleTimeUpdate);
      video.addEventListener('ended', handleEnded);
      video.addEventListener('error', handleError);
      video.addEventListener('canplay', handleCanPlay);

      // 如果视频已经加载了 metadata（可能是缓存）
      if (video.readyState >= 1 && video.duration > 0) {
        console.log('[SceneBoundaryEditor] Already loaded, readyState:', video.readyState);
        setDuration(video.duration);
        setIsLoading(false);
        video.currentTime = startTime;
      } else {
        // 强制重新加载视频
        console.log('[SceneBoundaryEditor] Loading video...');
        video.load();
      }

      // 保存清理函数的引用
      (videoRef as any).cleanup = () => {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.removeEventListener('timeupdate', handleTimeUpdate);
        video.removeEventListener('ended', handleEnded);
        video.removeEventListener('error', handleError);
        video.removeEventListener('canplay', handleCanPlay);
      };
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      if ((videoRef as any).cleanup) {
        (videoRef as any).cleanup();
        (videoRef as any).cleanup = null;
      }
    };
  }, [visible, startTime, sourceVideoUrl, stopPlaying]);

  // 播放/暂停
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      stopPlaying(PLAYER_TYPE);
    } else {
      // 通知全局 store 开始播放，这会让其他播放器暂停
      startPlaying(PLAYER_TYPE);
      video.play().then(() => {
        setIsPlaying(true);
      }).catch((err) => {
        console.warn('Play failed:', err);
        stopPlaying(PLAYER_TYPE);
      });
    }
  }, [isPlaying, startPlaying, stopPlaying]);

  // 静音切换
  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  // 音量变化
  const handleVolumeChange = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = value;
    setVolume(value);
    if (value > 0 && isMuted) {
      video.muted = false;
      setIsMuted(false);
    }
  }, [isMuted]);

  // 跳转到指定时间
  const handleSeek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
    setCurrentTime(time);
  }, []);

  // 逐帧移动
  const handleFrameStep = useCallback((direction: 'prev' | 'next') => {
    const video = videoRef.current;
    if (!video || duration <= 0) return;

    const fps = (sceneMeta.fps || 30);
    const frameTime = 1 / fps;
    const newTime = direction === 'next'
      ? Math.min(duration, video.currentTime + frameTime)
      : Math.max(0, video.currentTime - frameTime);

    video.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration, sceneMeta.fps]);

  // 边界变化
  const handleBoundaryChange = useCallback((newStartTime: number, newEndTime: number) => {
    setStartTime(newStartTime);
    setEndTime(newEndTime);
  }, []);

  // 确认重切
  const handleConfirm = async () => {
    // 检查是否有变化
    if (startTime === sceneMeta.startTime && endTime === sceneMeta.endTime) {
      message.info('边界未改变');
      onClose();
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(startTime, endTime);
      message.success('分镜边界已更新');
      onClose();
    } catch (error) {
      message.error('更新失败: ' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // 视频点击播放/暂停
  const handleVideoClick = useCallback(() => {
    togglePlay();
  }, [togglePlay]);

  // 空格键播放/暂停（对话框内，使用捕获阶段优先拦截）
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        togglePlay();
      }
    };

    // 在捕获阶段监听，确保优先于其他处理器（如预览页的 VideoPlayer）
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [visible, togglePlay]);

  return (
    <Modal
      title="分镜边界编辑"
      open={visible}
      onCancel={onClose}
      width={800}
      className={styles.modal}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="confirm"
          type="primary"
          loading={isSubmitting}
          onClick={handleConfirm}
        >
          确认并重切
        </Button>,
      ]}
      destroyOnClose
    >
      <div className={styles.content}>
        {isLoading && !hasError && (
          <div className={styles.loading}>加载源视频中...</div>
        )}

        {hasError && (
          <div className={styles.error}>
            <span>无法加载源视频</span>
            <span>{sourceVideoResource.filePath}</span>
          </div>
        )}

        {!hasError && (
          <>
            <div className={styles.videoContainer}>
              <video
                ref={videoRef}
                src={sourceVideoUrl}
                className={styles.video}
                onClick={handleVideoClick}
                style={{ display: isLoading ? 'none' : 'block' }}
              />

              {!isLoading && (
                <div className={styles.videoControls}>
                  <button className={styles.playButton} onClick={togglePlay}>
                    {isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                  </button>

                  <span className={styles.timeDisplay}>
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>

                  <div className={styles.volumeControl}>
                    <button className={styles.volumeButton} onClick={toggleMute}>
                      {isMuted || volume === 0 ? <MutedOutlined /> : <SoundOutlined />}
                    </button>
                    <Slider
                      className={styles.volumeSlider}
                      min={0}
                      max={1}
                      step={0.1}
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      tooltip={{ formatter: (v) => `${Math.round((v ?? 0) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {!isLoading && (
              <div className={styles.timelineSection}>
                <div className={styles.sectionTitle}>调整分镜边界</div>
                <SceneBoundaryTimeline
                  duration={duration}
                  fps={sceneMeta.fps || 30}
                  currentTime={currentTime}
                  startTime={startTime}
                  endTime={endTime}
                  prevEndTime={prevEndTime}
                  nextStartTime={nextStartTime}
                  onBoundaryChange={handleBoundaryChange}
                  onSeek={handleSeek}
                  onFrameStep={handleFrameStep}
                  onTogglePlay={togglePlay}
                />
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default SceneBoundaryEditorDialog;
