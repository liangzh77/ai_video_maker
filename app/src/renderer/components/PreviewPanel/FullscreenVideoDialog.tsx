import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Modal, Slider } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  SoundOutlined,
  MutedOutlined,
} from '@ant-design/icons';
import type { Resource } from '@shared/types';
import { usePlaybackStore } from '../../stores/playback';
import styles from './FullscreenVideoDialog.module.css';

interface FullscreenVideoDialogProps {
  visible: boolean;
  src: string;
  resource: Resource;
  onClose: () => void;
}

const FullscreenVideoDialog: React.FC<FullscreenVideoDialogProps> = ({
  visible,
  src,
  resource,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { startPlaying, stopPlaying, pauseRequestId, activePlayerType } = usePlaybackStore();

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [showControls, setShowControls] = useState(true);

  // Reset state when dialog opens
  useEffect(() => {
    if (visible) {
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [visible]);

  // 组件卸载或关闭时清理 video src，释放文件句柄
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (video) {
        video.pause();
        video.src = '';
        video.load();
      }
    };
  }, []);

  // 监听其他播放器开始播放时，暂停当前播放器
  const prevPauseRequestIdRef = useRef(pauseRequestId);
  useEffect(() => {
    if (pauseRequestId !== prevPauseRequestIdRef.current) {
      prevPauseRequestIdRef.current = pauseRequestId;
      if (activePlayerType !== 'fullscreen' && isPlaying) {
        const video = videoRef.current;
        if (video) {
          video.pause();
          setIsPlaying(false);
        }
      }
    }
  }, [pauseRequestId, activePlayerType, isPlaying]);

  // Video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !visible) return;

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

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
  }, [visible, stopPlaying]);

  // 空格键播放/暂停
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible]);

  const togglePlay = useCallback(async () => {
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

  const handleClose = useCallback(() => {
    const video = videoRef.current;
    if (video && !video.paused) {
      video.pause();
      stopPlaying('fullscreen');
    }
    setIsPlaying(false);
    onClose();
  }, [stopPlaying, onClose]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const handleSliderChange = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = value;
    setCurrentTime(value);
  }, []);

  const handleVolumeChange = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = value;
    setVolume(value);
    setIsMuted(value === 0);
  }, []);

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Modal
      open={visible}
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
      <div
        ref={containerRef}
        className={styles.container}
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
              max={duration || 100}
              step={0.1}
              onChange={handleSliderChange}
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
            </div>
          </div>
        </div>

        <div className={styles.hint}>按空格键播放/暂停，按 ESC 退出</div>
      </div>
    </Modal>
  );
};

export default FullscreenVideoDialog;
