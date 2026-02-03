import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Modal, Slider } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  SoundOutlined,
  MutedOutlined,
} from '@ant-design/icons';
import { useDraftStore } from '../../stores/draft';
import { usePlaybackStore } from '../../stores/playback';
import { useFullscreenPreviewStore } from '../../stores/fullscreenPreview';
import styles from './FullscreenPreviewModal.module.css';

// 构建本地文件 URL
const getLocalFileUrl = (filePath: string) => {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return `local-file:///${normalizedPath}`;
};

const FullscreenPreviewModal: React.FC = () => {
  const { resourceId, previewType, resourceType, closeFullscreen, switchToResource } = useFullscreenPreviewStore();
  const { getResourceById, getResourcesByType, selectResource } = useDraftStore();
  const { startPlaying, stopPlaying } = usePlaybackStore();

  // 视频播放状态
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [showControls, setShowControls] = useState(true);

  // 获取当前资源
  const resource = resourceId ? getResourceById(resourceId) : null;

  // 重置视频状态
  useEffect(() => {
    if (previewType === 'video' && resourceId) {
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [resourceId, previewType]);

  // 获取同类型资源列表
  const getSiblingResources = useCallback(() => {
    if (!resourceType) return [];
    return getResourcesByType(resourceType);
  }, [resourceType, getResourcesByType]);

  // 切换到上一个/下一个资源
  const switchResource = useCallback((direction: 'prev' | 'next') => {
    if (!resourceId) return null;
    const siblings = getSiblingResources();
    const currentIndex = siblings.findIndex(r => r.id === resourceId);
    if (currentIndex === -1) return null;

    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= siblings.length) return null;

    return siblings[newIndex];
  }, [resourceId, getSiblingResources]);

  // 视频播放控制
  const toggleVideoPlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      stopPlaying('fullscreen');
    } else {
      try {
        startPlaying('fullscreen');
        await video.play();
        setIsPlaying(true);
      } catch (err) {
        stopPlaying('fullscreen');
      }
    }
  }, [isPlaying, startPlaying, stopPlaying]);

  // 关闭处理
  const handleClose = useCallback(() => {
    const video = videoRef.current;
    if (video && !video.paused) {
      video.pause();
      stopPlaying('fullscreen');
    }
    setIsPlaying(false);
    closeFullscreen();
  }, [stopPlaying, closeFullscreen]);

  // 键盘控制
  useEffect(() => {
    if (!resourceId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        const newResource = switchResource(e.code === 'ArrowLeft' ? 'prev' : 'next');
        if (newResource) {
          // 如果是视频，先暂停当前视频
          if (previewType === 'video') {
            const video = videoRef.current;
            if (video && !video.paused) {
              video.pause();
              stopPlaying('fullscreen');
            }
            setIsPlaying(false);
          }
          // 切换资源（保持全屏状态）
          switchToResource(newResource.id);
          selectResource(newResource.id);
        }
      } else if (e.code === 'Escape') {
        handleClose();
      } else if (e.code === 'Space' && previewType === 'video') {
        e.preventDefault();
        toggleVideoPlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [resourceId, previewType, switchResource, switchToResource, selectResource, handleClose, toggleVideoPlay, stopPlaying]);

  // 视频事件监听
  useEffect(() => {
    const video = videoRef.current;
    if (!video || previewType !== 'video') return;

    const handleLoadedMetadata = () => setDuration(video.duration);
    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleEnded = () => {
      setIsPlaying(false);
      stopPlaying('fullscreen');
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
    };
  }, [resourceId, previewType, stopPlaying]);

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!resource || !previewType) return null;

  const isImage = previewType === 'image';
  const isVideo = previewType === 'video';
  const src = getLocalFileUrl(resource.filePath);

  return (
    <Modal
      open={!!resourceId}
      onCancel={handleClose}
      footer={null}
      width="90vw"
      centered
      className={styles.modal}
      styles={{
        body: {
          padding: 0,
          backgroundColor: '#000',
        },
      }}
    >
      {isImage && (
        <div className={styles.imageContainer}>
          <img
            src={src}
            alt={resource.fileName}
            className={styles.image}
          />
          <div className={styles.hint}>按左右箭头键切换，ESC 退出</div>
        </div>
      )}

      {isVideo && (
        <div
          className={styles.videoContainer}
          onMouseEnter={() => setShowControls(true)}
          onMouseLeave={() => setShowControls(!isPlaying)}
        >
          <video
            key={resourceId}
            ref={videoRef}
            src={src}
            className={styles.video}
            onClick={toggleVideoPlay}
            preload="metadata"
          />

          <div className={`${styles.controls} ${showControls ? styles.visible : ''}`}>
            <div className={styles.progress}>
              <Slider
                value={currentTime}
                min={0}
                max={duration || 100}
                step={0.1}
                onChange={(value) => {
                  const video = videoRef.current;
                  if (video) {
                    video.currentTime = value;
                    setCurrentTime(value);
                  }
                }}
                tooltip={{ formatter: (value) => formatTime(value || 0) }}
                className={styles.progressSlider}
              />
            </div>

            <div className={styles.controlBar}>
              <div className={styles.leftControls}>
                <button className={styles.controlButton} onClick={toggleVideoPlay}>
                  {isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                </button>
                <span className={styles.time}>
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              <div className={styles.rightControls}>
                <div className={styles.volumeControl}>
                  <button
                    className={styles.controlButton}
                    onClick={() => {
                      const video = videoRef.current;
                      if (video) {
                        video.muted = !isMuted;
                        setIsMuted(!isMuted);
                      }
                    }}
                  >
                    {isMuted || volume === 0 ? <MutedOutlined /> : <SoundOutlined />}
                  </button>
                  <Slider
                    value={isMuted ? 0 : volume}
                    min={0}
                    max={1}
                    step={0.1}
                    onChange={(value) => {
                      const video = videoRef.current;
                      if (video) {
                        video.volume = value;
                        setVolume(value);
                        setIsMuted(value === 0);
                      }
                    }}
                    className={styles.volumeSlider}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className={styles.hint}>空格播放/暂停，左右箭头键切换，ESC 退出</div>
        </div>
      )}
    </Modal>
  );
};

export default FullscreenPreviewModal;
