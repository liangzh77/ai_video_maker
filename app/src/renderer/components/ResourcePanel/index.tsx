import React, { useState, useCallback } from 'react';
import { Tooltip, Popconfirm } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useDraftStore } from '../../stores/draft';
import { useSectionOrderStore, SECTION_CONFIGS, ALL_SECTION_TYPES } from '../../stores/sectionOrder';
import type { ResourceType } from '@shared/types';
import ResourceSection from './ResourceSection';
import styles from './ResourcePanel.module.css';

const ResourcePanel: React.FC = () => {
  const { selectedDraftId, getSelectedDraft, getResourcesByType } = useDraftStore();
  const { order, moveSection, moveSectionToEnd, resetOrder } = useSectionOrderStore();
  const selectedDraft = getSelectedDraft();

  // 拖拽状态
  const [draggingSectionType, setDraggingSectionType] = useState<ResourceType | null>(null);
  const [dragOverSectionType, setDragOverSectionType] = useState<ResourceType | null>(null);

  // 处理 section 拖拽开始
  const handleSectionDragStart = useCallback((e: React.DragEvent, type: ResourceType) => {
    setDraggingSectionType(type);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', type);
  }, []);

  // 处理 section 拖拽悬停
  const handleSectionDragOver = useCallback((e: React.DragEvent, type: ResourceType) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggingSectionType && type !== draggingSectionType) {
      setDragOverSectionType(type);
    }
  }, [draggingSectionType]);

  // 处理 section 拖拽离开
  const handleSectionDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverSectionType(null);
  }, []);

  // 处理 section 放置
  const handleSectionDrop = useCallback((e: React.DragEvent, targetType: ResourceType) => {
    e.preventDefault();
    e.stopPropagation();

    if (draggingSectionType && draggingSectionType !== targetType) {
      moveSection(draggingSectionType, targetType);
    }

    setDraggingSectionType(null);
    setDragOverSectionType(null);
  }, [draggingSectionType, moveSection]);

  // 处理拖拽结束
  const handleSectionDragEnd = useCallback(() => {
    setDraggingSectionType(null);
    setDragOverSectionType(null);
  }, []);

  if (!selectedDraftId) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyIcon}>📁</div>
        <h3 className={styles.emptyTitle}>选择一个草稿</h3>
        <p className={styles.emptyDescription}>从左侧选择草稿或创建新草稿开始</p>
      </div>
    );
  }

  // 确保 order 包含所有 section 类型（处理新增类型的情况）
  const validOrder = order.filter((type) => ALL_SECTION_TYPES.includes(type));
  const missingTypes = ALL_SECTION_TYPES.filter((type) => !validOrder.includes(type));
  const finalOrder = [...validOrder, ...missingTypes];

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>{selectedDraft?.name || '未命名草稿'}</h2>
        <Tooltip title="重置分组顺序">
          <Popconfirm
            title="重置分组顺序"
            description="确定要将所有分组恢复为默认顺序吗？"
            onConfirm={resetOrder}
            okText="确认"
            cancelText="取消"
          >
            <button className={styles.resetButton}>
              <ReloadOutlined />
            </button>
          </Popconfirm>
        </Tooltip>
      </div>

      <div className={styles.content}>
        {finalOrder.map((type) => {
          const config = SECTION_CONFIGS[type];
          const resources = getResourcesByType(type);

          return (
            <ResourceSection
              key={type}
              title={config.title}
              type={type}
              resources={resources}
              acceptFormats={config.acceptFormats}
              isText={config.isText}
              // 拖拽相关 props
              isDragging={draggingSectionType === type}
              isDragOver={dragOverSectionType === type}
              onSectionDragStart={(e) => handleSectionDragStart(e, type)}
              onSectionDragOver={(e) => handleSectionDragOver(e, type)}
              onSectionDragLeave={handleSectionDragLeave}
              onSectionDrop={(e) => handleSectionDrop(e, type)}
              onSectionDragEnd={handleSectionDragEnd}
            />
          );
        })}
      </div>
    </div>
  );
};

export default ResourcePanel;
