import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Modal, Slider, Button, Space } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined } from '@ant-design/icons';
import type { Resource, VideoMetadata } from '@shared/types';
import { parseFolderName } from '@shared/section-utils';
import { usePlaybackStore } from '../../stores/playback';
import styles from './MultiVideoPlayerDialog.module.css';

interface MultiVideoPlayerDialogProps {
  visible: boolean;
  videos: Resource[];
  onClose: () => void;
}

const MultiVideoPlayerDialog: React.FC<MultiVideoPlayerDialogProps> = ({
  visible,
  videos,
  onClose,
}) => {
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const isSeekingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const { startPlaying, stopPlaying } = usePlaybackStore();

  // 获取视频 URL
  const getLocalFileUrl = (filePath: string, fileSize?: number) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const cacheKey = fileSize ? `?v=${fileSize}` : '';
    return `local-file:///${normalizedPath}${cacheKey}`;
  };

  // 计算最大时长
  const maxDuration = useMemo(() => {
    return Math.max(...videos.map(v => {
      const meta = v.metadata as VideoMetadata;
      return meta.duration || 0;
    }));
  }, [videos]);

  // 判断是否是竖屏视频（根据第一个视频判断布局）
  const isPortraitLayout = useMemo(() => {
    if (videos.length === 0) return false;
    const firstVideo = videos[0];
    const meta = firstVideo.metadata as VideoMetadata;
    if (meta.width && meta.height) {
      return meta.height > meta.width;
    }
    return false;
  }, [videos]);

  // 格式化时间
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  // 同步播放/暂停
  const togglePlay = useCallback(() => {
    const videoElements = videoRefs.current.filter(v => v !== null);
    if (videoElements.length === 0) return;

    if (isPlaying) {
      videoElements.forEach(v => v?.pause());
      setIsPlaying(false);
      stopPlaying('multi-video');
    } else {
      // 通知其他播放器暂停
      startPlaying('multi-video');
      Promise.all(videoElements.map(v => v?.play())).catch(() => {
        // 忽略播放错误
      });
      setIsPlaying(true);
    }
  }, [isPlaying, startPlaying, stopPlaying]);

  // 同步跳转
  const handleSeek = useCallback((value: number) => {
    const videoElements = videoRefs.current.filter(v => v !== null);
    if (videoElements.length === 0) return;

    isSeekingRef.current = true;
    const time = value;

    // 同步设置所有视频的时间
    videoElements.forEach(v => {
      if (v) {
        v.currentTime = Math.min(time, v.duration || time);
      }
    });
    setCurrentTime(time);

    // 如果当前是播放状态，确保所有视频都在播放
    if (isPlaying) {
      Promise.all(videoElements.map(v => v?.play())).catch(() => {
        // 忽略播放错误
      });
    }

    setTimeout(() => {
      isSeekingRef.current = false;
    }, 100);
  }, [isPlaying]);

  // 视频时间更新处理（取所有视频中最大的 currentTime）
  const handleTimeUpdate = useCallback(() => {
    if (isSeekingRef.current) return;

    const videoElements = videoRefs.current.filter(v => v !== null);
    if (videoElements.length === 0) return;

    const maxTime = Math.max(...videoElements.map(v => v?.currentTime || 0));
    setCurrentTime(maxTime);
  }, []);

  // 视频元数据加载完成
  const handleLoadedMetadata = useCallback(() => {
    setDuration(maxDuration);
  }, [maxDuration]);

  // 视频播放结束（只有当所有视频都播放完时才停止）
  const handleEnded = useCallback(() => {
    const videoElements = videoRefs.current.filter(v => v !== null);
    if (videoElements.length === 0) return;

    const allEnded = videoElements.every(v => {
      if (!v) return true;
      return v.ended || v.currentTime >= v.duration;
    });

    if (allEnded) {
      setIsPlaying(false);
      stopPlaying('multi-video');
    }
  }, [stopPlaying]);

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

  // 关闭时停止播放并重置状态，释放文件句柄
  useEffect(() => {
    if (!visible) {
      videoRefs.current.forEach(v => {
        if (v) {
          v.pause();
          v.src = '';
          v.load();
        }
      });
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      stopPlaying('multi-video');
    }
  }, [visible, stopPlaying]);

  // 组件卸载时清理所有 video src
  useEffect(() => {
    return () => {
      videoRefs.current.forEach(v => {
        if (v) {
          v.pause();
          v.src = '';
          v.load();
        }
      });
    };
  }, []);

  // 根据视频数量和方向决定布局类名
  const getLayoutClass = () => {
    const count = videos.length;
    if (isPortraitLayout) {
      // 竖屏视频：并排布局
      return `${styles.videoContainer} ${styles.portrait} ${styles[`count${count}`]}`;
    } else {
      // 横屏视频：2x2 网格布局
      return `${styles.videoContainer} ${styles.landscape} ${styles[`count${count}`]}`;
    }
  };

  // 获取视频标签名称
  const getVideoLabel = (index: number) => {
    const video = videos[index];
    if (!video) return '';
    const desc = parseFolderName(video.type);
    return desc?.label || video.fileName;
  };

  return (
    <Modal
      title={`多视频对比 (${videos.length}个)`}
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
        <div className={getLayoutClass()}>
          {videos.map((video, index) => (
            <div key={video.id} className={styles.videoWrapper}>
              <div className={styles.videoLabel}>{getVideoLabel(index)}</div>
              <video
                ref={(el) => { videoRefs.current[index] = el; }}
                src={getLocalFileUrl(video.filePath, video.fileSize)}
                className={styles.video}
                onClick={togglePlay}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={handleEnded}
              />
            </div>
          ))}
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

export default MultiVideoPlayerDialog;
