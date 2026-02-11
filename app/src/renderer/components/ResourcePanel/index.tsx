import React, { useState, useCallback, useEffect } from 'react';
import { Tooltip, Popconfirm, Dropdown, App } from 'antd';
import { ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import { useDraftStore } from '../../stores/draft';
import { useSectionsStore } from '../../stores/sections';
import type { MediaType } from '@shared/types';
import { getAcceptFormats, isTextSection } from '@shared/section-utils';
import ResourceSection from './ResourceSection';
import styles from './ResourcePanel.module.css';

const ResourcePanel: React.FC = () => {
  const { selectedDraftId, getSelectedDraft, getResourcesByType, loadResources } = useDraftStore();
  const { sections, loadSections, createSection, reorderSections } = useSectionsStore();
  const { message } = App.useApp();
  const selectedDraft = getSelectedDraft();

  // 拖拽状态
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);

  // 加载 sections
  useEffect(() => {
    if (selectedDraftId) {
      loadSections(selectedDraftId);
    }
  }, [selectedDraftId, loadSections]);

  // 处理 section 拖拽开始
  const handleSectionDragStart = useCallback((e: React.DragEvent, sectionId: string) => {
    setDraggingSectionId(sectionId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sectionId);
  }, []);

  // 处理 section 拖拽悬停
  const handleSectionDragOver = useCallback((e: React.DragEvent, sectionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggingSectionId && sectionId !== draggingSectionId) {
      setDragOverSectionId(sectionId);
    }
  }, [draggingSectionId]);

  // 处理 section 拖拽离开
  const handleSectionDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverSectionId(null);
  }, []);

  // 处理 section 放置
  const handleSectionDrop = useCallback(async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (draggingSectionId && draggingSectionId !== targetId && selectedDraftId) {
      // 构建新的顺序
      const currentIds = sections.map((s) => s.id);
      const fromIndex = currentIds.indexOf(draggingSectionId);
      const toIndex = currentIds.indexOf(targetId);
      if (fromIndex !== -1 && toIndex !== -1) {
        const newOrder = [...currentIds];
        newOrder.splice(fromIndex, 1);
        const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
        newOrder.splice(insertIndex, 0, draggingSectionId);
        const success = await reorderSections(selectedDraftId, newOrder);
        if (success) {
          // 重排序后文件夹名变了（序号改变），需要重新加载资源
          await loadResources(selectedDraftId);
        }
      }
    }

    setDraggingSectionId(null);
    setDragOverSectionId(null);
  }, [draggingSectionId, selectedDraftId, sections, reorderSections, loadResources]);

  // 处理拖拽结束
  const handleSectionDragEnd = useCallback(() => {
    setDraggingSectionId(null);
    setDragOverSectionId(null);
  }, []);

  // 处理新建 section
  const handleCreateSection = useCallback(async (mediaType: MediaType) => {
    if (!selectedDraftId) return;
    const labelMap: Record<MediaType, string> = {
      '视频': '视频',
      '图片': '图片',
      '提示词': '提示词',
    };
    const result = await createSection(selectedDraftId, mediaType, labelMap[mediaType]);
    if (result) {
      message.success(`已创建"${result.label}"分组`);
    } else {
      message.error('创建分组失败');
    }
  }, [selectedDraftId, createSection, message]);

  if (!selectedDraftId) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyIcon}>📁</div>
        <h3 className={styles.emptyTitle}>选择一个草稿</h3>
        <p className={styles.emptyDescription}>从左侧选择草稿或创建新草稿开始</p>
      </div>
    );
  }

  const createMenuItems = [
    { key: '视频', label: '视频分组' },
    { key: '图片', label: '图片分组' },
    { key: '提示词', label: '提示词分组' },
  ];

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>{selectedDraft?.name || '未命名草稿'}</h2>
        <Dropdown
          menu={{
            items: createMenuItems,
            onClick: ({ key }) => handleCreateSection(key as MediaType),
          }}
          trigger={['click']}
        >
          <Tooltip title="新建分组">
            <button className={styles.resetButton}>
              <PlusOutlined />
            </button>
          </Tooltip>
        </Dropdown>
      </div>

      <div className={styles.content}>
        {sections.map((section) => {
          const resources = getResourcesByType(section.id);

          return (
            <ResourceSection
              key={section.id}
              section={section}
              resources={resources}
              // 拖拽相关 props
              isDragging={draggingSectionId === section.id}
              isDragOver={dragOverSectionId === section.id}
              onSectionDragStart={(e) => handleSectionDragStart(e, section.id)}
              onSectionDragOver={(e) => handleSectionDragOver(e, section.id)}
              onSectionDragLeave={handleSectionDragLeave}
              onSectionDrop={(e) => handleSectionDrop(e, section.id)}
              onSectionDragEnd={handleSectionDragEnd}
            />
          );
        })}
      </div>
    </div>
  );
};

export default ResourcePanel;
