import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Slider, Tooltip } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  SoundOutlined,
  MutedOutlined,
  FullscreenOutlined,
  CameraOutlined,
} from '@ant-design/icons';
import type { Resource, VideoMetadata } from '@shared/types';
import SplitPointTimeline from './SplitPointTimeline';
import styles from './VideoPlayer.module.css';

// Custom MIME type for frame data transfer
const FRAME_DATA_MIME = 'application/x-video-frame';

interface VideoPlayerProps {
  src: string;
  resource: Resource;
  showSplitTimeline?: boolean;
  onTimeUpdate?: (time: number) => void;
}

// 节流间隔（毫秒）
const SEEK_THROTTLE_MS = 100;

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  resource,
  showSplitTimeline = false,
  onTimeUpdate,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 拖拽相关引用
  const wasPlayingRef = useRef(false);
  const lastSeekTimeRef = useRef(0);
  const isSeekingRef = useRef(false);

  // 状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Reset state when src changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setHasError(false);
    isSeekingRef.current = false;
    wasPlayingRef.current = false;
  }, [src]);

  // Setup video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      setHasError(false);
    };

    const handleTimeUpdate = () => {
      if (!isSeekingRef.current) {
        setCurrentTime(video.currentTime);
        onTimeUpdate?.(video.currentTime);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    const handleError = () => {
      // MEDIA_ERR_DECODE (code 3) 在 seek 过程中可能发生，忽略
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
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    video.addEventListener('canplay', handleCanPlay);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      video.removeEventListener('canplay', handleCanPlay);
    };
  }, [src]);

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

  // 空格键播放/暂停
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 只在焦点在容器内或视频区域时响应
      if (e.code === 'Space' && containerRef.current?.contains(document.activeElement as Node)) {
        e.preventDefault();
        togglePlay();
      }
    };

    // 全局监听，但只在容器获得焦点时响应
    const container = containerRef.current;
    if (container) {
      container.addEventListener('keydown', handleKeyDown);
      // 让容器可以获得焦点
      container.tabIndex = 0;
    }

    return () => {
      if (container) {
        container.removeEventListener('keydown', handleKeyDown);
      }
    };
  }, [togglePlay]);

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

  // Get video fps from metadata
  const getVideoFps = useCallback(() => {
    const meta = resource.metadata as VideoMetadata;
    return meta?.fps || 30;
  }, [resource.metadata]);

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
    onTimeUpdate?.(video.currentTime);
  }, [isPlaying, getVideoFps, onTimeUpdate]);

  // Seek to specific time (for split point timeline)
  const seekToTime = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;

    // Pause video if playing
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    }

    video.currentTime = time;
    setCurrentTime(time);
    onTimeUpdate?.(time);
  }, [isPlaying, onTimeUpdate]);

  const handleVolumeChange = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = value;
    setVolume(value);
    setIsMuted(value === 0);
  }, []);

  const handleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  }, []);

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Capture current frame as base64 image
  const captureCurrentFrame = useCallback((): { imageData: string; fileName: string } | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      console.log('captureCurrentFrame: video not ready', video?.readyState);
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    // Remove data URL prefix to get pure base64
    const imageData = dataUrl.replace(/^data:image\/png;base64,/, '');

    // Generate filename based on video name and timestamp
    const baseName = resource.fileName.replace(/\.[^/.]+$/, '');
    const timeStr = formatTime(currentTime).replace(':', '-');
    const fileName = `${baseName}_frame_${timeStr}.png`;

    console.log('captureCurrentFrame: captured', { fileName, imageDataLength: imageData.length });
    return { imageData, fileName };
  }, [resource.fileName, currentTime]);

  // Handle drag start - capture frame and set data
  const handleDragStart = useCallback((e: React.DragEvent) => {
    console.log('handleDragStart called');
    const frameData = captureCurrentFrame();
    if (!frameData) {
      console.log('handleDragStart: no frame data, preventing drag');
      e.preventDefault();
      return;
    }

    // Set custom data for frame transfer
    e.dataTransfer.setData(FRAME_DATA_MIME, JSON.stringify(frameData));
    e.dataTransfer.effectAllowed = 'copy';
    console.log('handleDragStart: data set successfully');

    // Create drag image from current frame
    const video = videoRef.current;
    if (video) {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = Math.round(120 * video.videoHeight / video.videoWidth);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        e.dataTransfer.setDragImage(canvas, 60, canvas.height / 2);
      }
    }
  }, [captureCurrentFrame]);

  return (
    <div className={styles.playerWrapper}>
      <div
        ref={containerRef}
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
          draggable
          onDragStart={handleDragStart}
        />

        <div className={`${styles.controls} ${showControls ? styles.visible : ''}`}>
          <div className={styles.progress}>
            <Slider
              value={currentTime}
              min={0}
              max={duration || 100}
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
                {formatTime(currentTime)} / {formatTime(duration)}
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

              <Tooltip title="全屏">
                <button className={styles.controlButton} onClick={handleFullscreen}>
                  <FullscreenOutlined />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        {hasError && (
          <div className={styles.errorOverlay}>
            <span className={styles.errorText}>视频加载失败</span>
          </div>
        )}

        {!hasError && !isPlaying && currentTime === 0 && (
          <div className={styles.playOverlay} onClick={togglePlay}>
            <PlayCircleOutlined className={styles.playOverlayIcon} />
          </div>
        )}
      </div>

      {/* Split Point Timeline - rendered outside of player to avoid overflow:hidden */}
      {showSplitTimeline && (
        <SplitPointTimeline
          currentTime={currentTime}
          duration={duration}
          fps={getVideoFps()}
          onSeek={seekToTime}
          onFrameStep={handleFrameStep}
        />
      )}
    </div>
  );
};

export default VideoPlayer;
