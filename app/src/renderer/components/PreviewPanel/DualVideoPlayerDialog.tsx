import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Modal, Slider, Button, Space } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined } from '@ant-design/icons';
import type { Resource, VideoMetadata } from '@shared/types';
import styles from './DualVideoPlayerDialog.module.css';

interface DualVideoPlayerDialogProps {
  visible: boolean;
  sourceResource: Resource;  // 分镜源视频
  newResource: Resource;     // 分镜新视频
  onClose: () => void;
}

const DualVideoPlayerDialog: React.FC<DualVideoPlayerDialogProps> = ({
  visible,
  sourceResource,
  newResource,
  onClose,
}) => {
  const sourceVideoRef = useRef<HTMLVideoElement>(null);
  const newVideoRef = useRef<HTMLVideoElement>(null);
  const isSeekingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // 获取视频 URL
  const getLocalFileUrl = (filePath: string, fileSize?: number) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const cacheKey = fileSize ? `?v=${fileSize}` : '';
    return `local-file:///${normalizedPath}${cacheKey}`;
  };

  const sourceVideoUrl = getLocalFileUrl(sourceResource.filePath, sourceResource.fileSize);
  const newVideoUrl = getLocalFileUrl(newResource.filePath, newResource.fileSize);

  // 获取视频时长（取较长的那个）
  const sourceMeta = sourceResource.metadata as VideoMetadata;
  const newMeta = newResource.metadata as VideoMetadata;
  const maxDuration = Math.max(sourceMeta.duration || 0, newMeta.duration || 0);

  // 格式化时间
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  // 同步播放/暂停
  const togglePlay = useCallback(() => {
    const sourceVideo = sourceVideoRef.current;
    const newVideo = newVideoRef.current;
    if (!sourceVideo || !newVideo) return;

    if (isPlaying) {
      sourceVideo.pause();
      newVideo.pause();
      setIsPlaying(false);
    } else {
      // 同步开始播放
      Promise.all([sourceVideo.play(), newVideo.play()]).catch(() => {
        // 忽略播放错误（例如用户交互限制）
      });
      setIsPlaying(true);
    }
  }, [isPlaying]);

  // 同步跳转
  const handleSeek = useCallback((value: number) => {
    const sourceVideo = sourceVideoRef.current;
    const newVideo = newVideoRef.current;
    if (!sourceVideo || !newVideo) return;

    isSeekingRef.current = true;
    const time = value;

    // 同步设置两个视频的时间
    sourceVideo.currentTime = Math.min(time, sourceVideo.duration || time);
    newVideo.currentTime = Math.min(time, newVideo.duration || time);
    setCurrentTime(time);

    // 如果当前是播放状态，确保两个视频都在播放
    // （处理一个视频已经 ended 的情况）
    if (isPlaying) {
      Promise.all([sourceVideo.play(), newVideo.play()]).catch(() => {
        // 忽略播放错误
      });
    }

    setTimeout(() => {
      isSeekingRef.current = false;
    }, 100);
  }, [isPlaying]);

  // 视频时间更新处理（取两个视频中较大的 currentTime）
  const handleTimeUpdate = useCallback(() => {
    if (isSeekingRef.current) return;

    const sourceVideo = sourceVideoRef.current;
    const newVideo = newVideoRef.current;
    if (!sourceVideo || !newVideo) return;

    // 取两个视频中 currentTime 更大的那个
    // 这样当短视频播放完后，进度条会继续跟随长视频
    const maxTime = Math.max(sourceVideo.currentTime, newVideo.currentTime);
    setCurrentTime(maxTime);
  }, []);

  // 视频元数据加载完成
  const handleLoadedMetadata = useCallback(() => {
    const sourceVideo = sourceVideoRef.current;
    if (sourceVideo) {
      setDuration(maxDuration || sourceVideo.duration);
    }
  }, [maxDuration]);

  // 视频播放结束（只有当两个视频都播放完时才停止）
  const handleEnded = useCallback(() => {
    const sourceVideo = sourceVideoRef.current;
    const newVideo = newVideoRef.current;
    if (!sourceVideo || !newVideo) return;

    // 只有当两个视频都播放完了才设置 isPlaying 为 false
    const sourceEnded = sourceVideo.ended || sourceVideo.currentTime >= sourceVideo.duration;
    const newEnded = newVideo.ended || newVideo.currentTime >= newVideo.duration;

    if (sourceEnded && newEnded) {
      setIsPlaying(false);
    }
  }, []);

  // 空格键控制播放/暂停
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, togglePlay]);

  // 关闭时停止播放并重置状态
  useEffect(() => {
    if (!visible) {
      sourceVideoRef.current?.pause();
      newVideoRef.current?.pause();
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [visible]);

  return (
    <Modal
      title="对比播放"
      open={visible}
      onCancel={onClose}
      footer={null}
      width="85vw"
      styles={{
        body: {
          height: '85vh',
          padding: '16px 24px',
          overflow: 'hidden',
        },
      }}
      centered
      destroyOnClose
      className={styles.modal}
    >
      <div className={styles.container}>
        {/* 视频区域 */}
        <div className={styles.videoContainer}>
          {/* 左侧：分镜源视频 */}
          <div className={styles.videoWrapper}>
            <div className={styles.videoLabel}>分镜源视频</div>
            <video
              ref={sourceVideoRef}
              src={sourceVideoUrl}
              className={styles.video}
              onClick={togglePlay}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={handleEnded}
            />
          </div>

          {/* 右侧：分镜新视频 */}
          <div className={styles.videoWrapper}>
            <div className={styles.videoLabel}>分镜新视频</div>
            <video
              ref={newVideoRef}
              src={newVideoUrl}
              className={styles.video}
              onClick={togglePlay}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleEnded}
            />
          </div>
        </div>

        {/* 控制区域 */}
        <div className={styles.controls}>
          <Space align="center">
            <Button
              type="text"
              icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={togglePlay}
              className={styles.playButton}
            />
            <span className={styles.time}>
              {formatTime(currentTime)} / {formatTime(duration || maxDuration)}
            </span>
          </Space>

          <Slider
            className={styles.progressBar}
            min={0}
            max={duration || maxDuration || 1}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            tooltip={{ formatter: (value) => formatTime(value || 0) }}
          />

          <div className={styles.hint}>
            按空格键播放/暂停，点击视频也可控制
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default DualVideoPlayerDialog;
