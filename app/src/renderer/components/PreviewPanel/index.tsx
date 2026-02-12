import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, Tooltip, Space, App, Modal, Select } from 'antd';
import { FolderOpenOutlined, ScissorOutlined, SearchOutlined, ExpandOutlined, EditOutlined, LinkOutlined, SoundOutlined, PlaySquareOutlined } from '@ant-design/icons';
import { useDraftStore } from '../../stores/draft';
import { useSplitPointsStore } from '../../stores/splitPoints';
import { usePlaybackStore, isContinuousPlayType } from '../../stores/playback';
import { useSceneLinkStore } from '../../stores/sceneLink';
import { useSectionsStore } from '../../stores/sections';
import { isVideoMetadata, isImageMetadata, isTextMetadata } from '@shared/types';
import type { VideoMetadata, Resource } from '@shared/types';
import { parseFolderName } from '@shared/section-utils';
import VideoPlayer, { type VideoPlayerRef } from './VideoPlayer';
import ImagePreview from './ImagePreview';
import TextEditor from './TextEditor';
import ResourceInfo from './ResourceInfo';
import SplitVideoDialog from './SplitVideoDialog';
import AnalyzeVideoDialog from './AnalyzeVideoDialog';
import SplitPointEditorDialog from './SplitPointEditorDialog';
import SceneBoundaryEditorDialog from './SceneBoundaryEditorDialog';
import DualVideoPlayerDialog from './DualVideoPlayerDialog';
import FullscreenVideoDialog from './FullscreenVideoDialog';
import styles from './PreviewPanel.module.css';

const PreviewPanel: React.FC = () => {
  const { message } = App.useApp();
  const { selectedDraftId, selectedResourceId, getSelectedResource, openResourceFolder, selectResource, getResourcesByType, getResourceById, loadResources } = useDraftStore();
  const { splitPoints, videoId, loadSplitPoints, clearPoints } = useSplitPointsStore();
  const { shouldAutoPlay, setShouldAutoPlay, activePlayerType, startPlaying } = usePlaybackStore();
  const { getLinkedId } = useSceneLinkStore();
  const { sections } = useSectionsStore();
  const selectedResource = getSelectedResource();
  const [splitDialogVisible, setSplitDialogVisible] = useState(false);
  const [analyzeDialogVisible, setAnalyzeDialogVisible] = useState(false);
  const [editorDialogVisible, setEditorDialogVisible] = useState(false);
  const [boundaryEditorVisible, setBoundaryEditorVisible] = useState(false);
  const [dualPlayerVisible, setDualPlayerVisible] = useState(false);
  const [fullscreenVideoVisible, setFullscreenVideoVisible] = useState(false);
  const videoPlayerRef = useRef<VideoPlayerRef>(null);
  const audioPlayerRef = useRef<HTMLAudioElement>(null);

  // 获取按文件名排序的资源列表（getResourcesByType 已自动排序）
  const getSortedResources = useCallback((sectionId: string) => {
    return getResourcesByType(sectionId);
  }, [getResourcesByType]);

  // 获取分镜相关的信息（源视频、前后分镜）
  const getSceneRelatedResources = useCallback((sceneResource: Resource) => {
    const meta = sceneResource.metadata as VideoMetadata;
    if (!meta.sourceVideoId) {
      return { sourceVideo: null, prevScene: null, nextScene: null };
    }

    // 通过资源 ID 直接获取源视频
    const sourceVideo = getResourceById(meta.sourceVideoId);

    // 获取同一 section 中同一源视频的所有分镜
    const sameSectionResources = getResourcesByType(sceneResource.type);
    const relatedScenes = sameSectionResources
      .filter(r => {
        const rMeta = r.metadata as VideoMetadata;
        return rMeta.sourceVideoId === meta.sourceVideoId;
      })
      .sort((a, b) => {
        const aMeta = a.metadata as VideoMetadata;
        const bMeta = b.metadata as VideoMetadata;
        return (aMeta.sceneIndex || 0) - (bMeta.sceneIndex || 0);
      });

    const currentIndex = relatedScenes.findIndex(r => r.id === sceneResource.id);
    const prevScene = currentIndex > 0 ? relatedScenes[currentIndex - 1] : null;
    const nextScene = currentIndex < relatedScenes.length - 1 ? relatedScenes[currentIndex + 1] : null;

    return { sourceVideo, prevScene, nextScene };
  }, [getResourcesByType, getResourceById]);

  // 处理重切分镜
  const handleResplitScene = useCallback(async (startTime: number, endTime: number) => {
    if (!selectedDraftId || !selectedResourceId) {
      throw new Error('No draft or resource selected');
    }

    const result = await window.api.task.resplitScene({
      draftId: selectedDraftId,
      sceneResourceId: selectedResourceId,
      newStartTime: startTime,
      newEndTime: endTime,
    });

    if (!result.success) {
      throw new Error(result.error || 'Resplit failed');
    }

    // 刷新资源列表
    await loadResources(selectedDraftId);
  }, [selectedDraftId, selectedResourceId, loadResources]);

  // 处理视频播放结束 - 自动播放下一个
  const handleVideoEnded = useCallback(() => {
    if (!selectedResource) return;

    // 只有当预览播放器是活跃播放器时，才触发连续播放
    // 如果边界编辑对话框正在播放，不触发连续播放
    if (activePlayerType !== 'preview') {
      return;
    }

    // 只对视频类型 section 生效
    if (!isContinuousPlayType(selectedResource.type)) {
      return;
    }

    // 获取同 section 的所有资源（使用自定义排序）
    const resources = getSortedResources(selectedResource.type);
    const currentIndex = resources.findIndex((r) => r.id === selectedResource.id);

    // 找到下一个视频
    if (currentIndex >= 0 && currentIndex < resources.length - 1) {
      const nextResource = resources[currentIndex + 1];
      // 设置自动播放标志，然后选中下一个资源
      setShouldAutoPlay(true);
      selectResource(nextResource.id);
    }
  }, [selectedResource, getSortedResources, setShouldAutoPlay, selectResource, activePlayerType]);

  // 当资源切换后重置自动播放标志
  useEffect(() => {
    // 自动播放后重置标志（在下一帧），确保 VideoPlayer 已经收到 autoPlay=true
    if (shouldAutoPlay) {
      const timer = setTimeout(() => {
        setShouldAutoPlay(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [selectedResourceId, shouldAutoPlay, setShouldAutoPlay]);

  // 全局空格键播放/暂停（仅对支持连续播放的视频类型生效）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果有全屏播放器正在活动（包括 ResourceCard 的全屏视频），不响应空格键
      if (activePlayerType === 'fullscreen') {
        return;
      }

      // 如果对话框打开，不响应空格键（由对话框自己处理）
      if (dualPlayerVisible || boundaryEditorVisible || editorDialogVisible || fullscreenVideoVisible) {
        return;
      }

      // 忽略输入框中的空格键
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // 只响应空格键
      if (e.code !== 'Space') return;

      if (!selectedResource) return;

      // 视频：空格键播放/暂停
      if (selectedResource.mimeType.startsWith('video/')) {
        e.preventDefault();
        videoPlayerRef.current?.togglePlay();
        return;
      }

      // 音频：空格键播放/暂停
      if (selectedResource.mimeType.startsWith('audio/')) {
        e.preventDefault();
        const audio = audioPlayerRef.current;
        if (audio) {
          if (audio.paused) {
            audio.play();
          } else {
            audio.pause();
          }
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedResource, dualPlayerVisible, boundaryEditorVisible, editorDialogVisible, fullscreenVideoVisible, activePlayerType]);

  // Auto-load split points when selecting a video
  useEffect(() => {
    if (!selectedDraftId || !selectedResourceId || !selectedResource) {
      return;
    }

    // Only auto-load for video resources
    if (!selectedResource.mimeType.startsWith('video/')) {
      return;
    }

    // Skip if already loaded for this video
    if (videoId === selectedResourceId) {
      return;
    }

    // Try to load saved split points
    loadSplitPoints(selectedDraftId, selectedResourceId);
  }, [selectedDraftId, selectedResourceId, selectedResource, videoId, loadSplitPoints]);

  const handleOpenFolder = async () => {
    if (selectedResourceId) {
      await openResourceFolder(selectedResourceId);
    }
  };

  // 处理手动关联源视频（为旧版本分镜补充缺失的 metadata）
  const handleLinkSourceVideo = useCallback(async () => {
    if (!selectedDraftId || !selectedResourceId || !selectedResource) return;

    // 在所有视频 section 中查找源视频（没有 sourceVideoId 的视频即为源视频）
    const sourceVideos: Resource[] = [];
    for (const section of sections) {
      const desc = parseFolderName(section.id);
      if (desc?.mediaType === '视频') {
        const sectionResources = getResourcesByType(section.id);
        for (const r of sectionResources) {
          if (isVideoMetadata(r.metadata) && !r.metadata.sourceVideoId) {
            sourceVideos.push(r);
          }
        }
      }
    }

    if (sourceVideos.length === 0) {
      message.warning('没有可用的源视频');
      return;
    }

    // 如果只有一个源视频，直接关联
    const sourceVideo = sourceVideos[0];
    const meta = selectedResource.metadata as VideoMetadata;

    // 获取同 section 中该源视频的所有分镜，计算当前分镜的位置
    const allScenes = getResourcesByType(selectedResource.type);
    const sceneIndex = allScenes.findIndex(r => r.id === selectedResourceId) + 1;

    // 估算时间范围：使用分镜自身的 duration
    const duration = meta.duration || 0;
    // 如果有多个分镜，尝试根据序号估算 startTime
    let startTime = 0;
    for (let i = 0; i < sceneIndex - 1; i++) {
      const prevMeta = allScenes[i].metadata as VideoMetadata;
      startTime += prevMeta.duration || 0;
    }
    const endTime = startTime + duration;

    try {
      // 更新资源 metadata
      const result = await window.api.resource.update({
        id: selectedResourceId,
        metadata: {
          ...meta,
          sourceVideoId: sourceVideo.id,
          startTime,
          endTime,
          sceneIndex,
        },
      });

      if (!result.success) {
        throw new Error(result.error || 'Update failed');
      }

      message.success('已关联源视频，现在可以编辑边界了');
      // 刷新资源列表
      await loadResources(selectedDraftId);
    } catch (error) {
      message.error('关联失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  }, [selectedDraftId, selectedResourceId, selectedResource, sections, getResourcesByType, loadResources, message]);

  // 提取声音对话框状态
  const [extractAudioVisible, setExtractAudioVisible] = useState(false);
  const [extractAudioTargetSection, setExtractAudioTargetSection] = useState<string>('');
  const [extractAudioLoading, setExtractAudioLoading] = useState(false);

  // 获取所有声音类型的 section
  const audioSections = useMemo(() => {
    return sections.filter((s) => {
      const desc = parseFolderName(s.id);
      return desc?.mediaType === '声音';
    });
  }, [sections]);

  // 打开提取声音对话框
  const handleOpenExtractAudio = useCallback(() => {
    // 默认选中第一个声音 section
    setExtractAudioTargetSection(audioSections.length > 0 ? audioSections[0].id : '');
    setExtractAudioVisible(true);
  }, [audioSections]);

  // 确认提取声音
  const handleConfirmExtractAudio = useCallback(async () => {
    if (!selectedDraftId || !selectedResourceId || !extractAudioTargetSection) return;

    setExtractAudioLoading(true);
    try {
      const result = await window.api.task.extractAudio({
        draftId: selectedDraftId,
        videoResourceId: selectedResourceId,
        targetSectionId: extractAudioTargetSection,
      });

      if (!result.success) {
        throw new Error(result.error || 'Extract audio failed');
      }

      message.success('声音已提取');
      setExtractAudioVisible(false);
      // 刷新资源列表
      await loadResources(selectedDraftId);
    } catch (error) {
      message.error('提取声音失败: ' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setExtractAudioLoading(false);
    }
  }, [selectedDraftId, selectedResourceId, extractAudioTargetSection, message, loadResources]);

  // Check if split points are for current video
  const hasSplitPoints = splitPoints.length > 0 && videoId === selectedResourceId;

  // Build local file URL - need triple slash for Windows paths
  // 添加 fileSize 作为缓存参数，确保文件更新后能重新加载
  const getLocalFileUrl = (filePath: string, fileSize?: number) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const cacheKey = fileSize ? `?v=${fileSize}` : '';
    return `local-file:///${normalizedPath}${cacheKey}`;
  };

  // 获取关联的视频资源（用于双视频对比播放）
  // 注意：useMemo 必须在 early return 之前调用
  const linkedVideoResource = useMemo(() => {
    if (!selectedResource) return null;
    if (!selectedResource.mimeType.startsWith('video/')) return null;

    const linkedId = getLinkedId(selectedResource.id);
    if (!linkedId) return null;

    return getResourceById(linkedId) || null;
  }, [selectedResource, getLinkedId, getResourceById]);

  // 准备双视频播放所需的资源
  const dualPlayerResources = useMemo(() => {
    if (!linkedVideoResource || !selectedResource) return null;
    // 当前选中的为左侧（source），关联的为右侧（new）
    return {
      sourceResource: selectedResource,
      newResource: linkedVideoResource,
    };
  }, [selectedResource, linkedVideoResource]);

  if (!selectedResourceId || !selectedResource) {
    return (
      <div className={styles.panel}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>👁️</div>
          <p className={styles.emptyText}>选择一个资源进行预览</p>
        </div>
      </div>
    );
  }

  const isVideo = selectedResource.mimeType.startsWith('video/');
  const isImage = selectedResource.mimeType.startsWith('image/');
  const isAudio = selectedResource.mimeType.startsWith('audio/');
  const isText = isTextMetadata(selectedResource.metadata);

  // 视频 metadata
  const videoMeta = isVideo && isVideoMetadata(selectedResource.metadata) ? selectedResource.metadata : null;
  // 是否为场景片段（有源视频关联）
  const isSceneClip = isVideo && !!videoMeta?.sourceVideoId;
  // 是否可以进行视频分析和切分（非场景片段的视频）
  const canAnalyzeAndSplit = isVideo && !isSceneClip;

  // 获取分镜相关资源（仅当是场景片段时）
  const sceneRelated = isSceneClip ? getSceneRelatedResources(selectedResource) : null;
  const canEditBoundary = isSceneClip && sceneRelated?.sourceVideo;

  // 检查分镜是否缺少源视频关联（需要手动关联）
  const needsSourceLink = isSceneClip && !videoMeta?.sourceVideoId;

  // 检查视频是否有音频（用于显示保存音频按钮）
  const hasAudio = videoMeta?.hasAudio;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>预览</h3>
        <div className={styles.headerActions}>
          {canAnalyzeAndSplit && (
            <Space size={0}>
              {/* Analyze button */}
              <Tooltip title="分析视频场景">
                <Button
                  type="text"
                  icon={<SearchOutlined />}
                  onClick={() => setAnalyzeDialogVisible(true)}
                />
              </Tooltip>
              {/* Split button - only enabled when has split points */}
              <Tooltip title={hasSplitPoints ? '切分视频' : '请先分析视频'}>
                <Button
                  type="text"
                  icon={<ScissorOutlined />}
                  onClick={() => setSplitDialogVisible(true)}
                  disabled={!hasSplitPoints}
                />
              </Tooltip>
              {/* Editor button - always enabled, can manually add split points */}
              <Tooltip title="编辑分割点">
                <Button
                  type="text"
                  icon={<ExpandOutlined />}
                  onClick={() => setEditorDialogVisible(true)}
                />
              </Tooltip>
            </Space>
          )}
          {needsSourceLink && (
            <Tooltip title="关联源视频（用于编辑边界）">
              <Button
                type="text"
                icon={<LinkOutlined />}
                onClick={handleLinkSourceVideo}
              />
            </Tooltip>
          )}
          {canEditBoundary && (
            <Tooltip title="编辑分镜边界">
              <Button
                type="text"
                icon={<EditOutlined />}
                onClick={() => setBoundaryEditorVisible(true)}
              />
            </Tooltip>
          )}
          {isVideo && hasAudio && (
            <Tooltip title="提取声音">
              <Button
                type="text"
                icon={<SoundOutlined />}
                onClick={handleOpenExtractAudio}
              />
            </Tooltip>
          )}
          {dualPlayerResources && (
            <Tooltip title="对比播放（源/新）">
              <Button
                type="text"
                icon={<PlaySquareOutlined />}
                onClick={() => {
                  // 先暂停主视频播放器
                  videoPlayerRef.current?.pause();
                  setDualPlayerVisible(true);
                }}
              />
            </Tooltip>
          )}
          <Tooltip title="打开所在文件夹">
            <Button
              type="text"
              icon={<FolderOpenOutlined />}
              onClick={handleOpenFolder}
            />
          </Tooltip>
        </div>
      </div>

      <div className={styles.content}>
        {isVideo && (
          <div
            onDoubleClick={() => {
              videoPlayerRef.current?.pause();
              startPlaying('fullscreen');
              setFullscreenVideoVisible(true);
            }}
            title="双击放大播放"
          >
            <VideoPlayer
              ref={videoPlayerRef}
              src={getLocalFileUrl(selectedResource.filePath, selectedResource.fileSize)}
              resource={selectedResource}
              showSplitTimeline={canAnalyzeAndSplit}
              onEnded={handleVideoEnded}
              autoPlay={shouldAutoPlay && isContinuousPlayType(selectedResource.type)}
            />
          </div>
        )}

        {isImage && (
          <ImagePreview
            src={getLocalFileUrl(selectedResource.filePath, selectedResource.fileSize)}
            resource={selectedResource}
          />
        )}

        {isAudio && (
          <div style={{ padding: '16px 0' }}>
            <audio
              ref={audioPlayerRef}
              key={selectedResource.id}
              controls
              src={getLocalFileUrl(selectedResource.filePath, selectedResource.fileSize)}
              style={{ width: '100%' }}
            />
          </div>
        )}

        {isText && (
          <TextEditor resource={selectedResource} />
        )}

        <ResourceInfo resource={selectedResource} />
      </div>

      {/* Analyze Video Dialog */}
      {canAnalyzeAndSplit && (
        <AnalyzeVideoDialog
          visible={analyzeDialogVisible}
          resource={selectedResource}
          onClose={() => setAnalyzeDialogVisible(false)}
        />
      )}

      {/* Split Video Dialog */}
      {canAnalyzeAndSplit && (
        <SplitVideoDialog
          visible={splitDialogVisible}
          resource={selectedResource}
          onClose={() => setSplitDialogVisible(false)}
        />
      )}

      {/* Split Point Editor Dialog */}
      {canAnalyzeAndSplit && (
        <SplitPointEditorDialog
          visible={editorDialogVisible}
          src={getLocalFileUrl(selectedResource.filePath, selectedResource.fileSize)}
          resource={selectedResource}
          onClose={() => setEditorDialogVisible(false)}
        />
      )}

      {/* Scene Boundary Editor Dialog */}
      {canEditBoundary && sceneRelated?.sourceVideo && (
        <SceneBoundaryEditorDialog
          visible={boundaryEditorVisible}
          sceneResource={selectedResource}
          sourceVideoResource={sceneRelated.sourceVideo}
          prevSceneResource={sceneRelated.prevScene || undefined}
          nextSceneResource={sceneRelated.nextScene || undefined}
          onClose={() => setBoundaryEditorVisible(false)}
          onConfirm={handleResplitScene}
        />
      )}

      {/* Dual Video Player Dialog */}
      {dualPlayerResources && (
        <DualVideoPlayerDialog
          visible={dualPlayerVisible}
          sourceResource={dualPlayerResources.sourceResource}
          newResource={dualPlayerResources.newResource}
          onClose={() => setDualPlayerVisible(false)}
        />
      )}

      {/* Fullscreen Video Dialog */}
      {isVideo && (
        <FullscreenVideoDialog
          visible={fullscreenVideoVisible}
          src={getLocalFileUrl(selectedResource.filePath, selectedResource.fileSize)}
          resource={selectedResource}
          onClose={() => setFullscreenVideoVisible(false)}
        />
      )}

      {/* Extract Audio Dialog */}
      <Modal
        title="提取声音"
        open={extractAudioVisible}
        onCancel={() => setExtractAudioVisible(false)}
        onOk={handleConfirmExtractAudio}
        okText="提取"
        cancelText="取消"
        confirmLoading={extractAudioLoading}
        okButtonProps={{ disabled: !extractAudioTargetSection }}
        width={360}
      >
        {audioSections.length === 0 ? (
          <p>没有声音分组，请先创建一个声音分组</p>
        ) : (
          <div>
            <p style={{ marginBottom: 8 }}>选择目标分组：</p>
            <Select
              value={extractAudioTargetSection}
              onChange={setExtractAudioTargetSection}
              style={{ width: '100%' }}
              options={audioSections.map((s) => {
                const desc = parseFolderName(s.id);
                return { label: `${desc?.order}. ${desc?.label}`, value: s.id };
              })}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default PreviewPanel;
