import React, { useState, useEffect } from 'react';
import { Modal, Input, Select, Button, Space } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { MediaType } from '@shared/types';

export interface TemplateItem {
  mediaType: MediaType;
  label: string;
}

const STORAGE_KEY = 'draft-template';

const DEFAULT_TEMPLATE: TemplateItem[] = [
  { mediaType: '视频', label: '源视频' },
  { mediaType: '图片', label: '源角色图片' },
  { mediaType: '提示词', label: '提示词' },
  { mediaType: '图片', label: '新角色图片' },
  { mediaType: '视频', label: '分镜源视频' },
  { mediaType: '视频', label: '分镜新视频' },
  { mediaType: '视频', label: '合成新视频' },
];

const MEDIA_TYPE_OPTIONS = [
  { label: '视频', value: '视频' },
  { label: '图片', value: '图片' },
  { label: '提示词', value: '提示词' },
  { label: '声音', value: '声音' },
  { label: '混合', value: '混合' },
];

export function getTemplate(): TemplateItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_TEMPLATE;
}

interface TemplateDialogProps {
  open: boolean;
  onClose: () => void;
}

const TemplateDialog: React.FC<TemplateDialogProps> = ({ open, onClose }) => {
  const [items, setItems] = useState<TemplateItem[]>([]);

  useEffect(() => {
    if (open) {
      setItems(getTemplate());
    }
  }, [open]);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    onClose();
  };

  const handleAdd = () => {
    setItems([...items, { mediaType: '视频', label: '' }]);
  };

  const handleDelete = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleLabelChange = (index: number, label: string) => {
    const next = [...items];
    next[index] = { ...next[index], label };
    setItems(next);
  };

  const handleMediaTypeChange = (index: number, mediaType: MediaType) => {
    const next = [...items];
    next[index] = { ...next[index], mediaType };
    setItems(next);
  };

  return (
    <Modal
      title="草稿模板"
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      okText="保存"
      cancelText="取消"
      width={420}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {items.map((item, index) => (
          <Space key={index} style={{ width: '100%' }} size={8}>
            <span style={{ width: 20, textAlign: 'center', color: '#999', fontSize: 12, flexShrink: 0 }}>
              {index + 1}
            </span>
            <Input
              value={item.label}
              onChange={(e) => handleLabelChange(index, e.target.value)}
              placeholder="卡片栏名称"
              style={{ flex: 1 }}
              size="small"
            />
            <Select
              value={item.mediaType}
              onChange={(v) => handleMediaTypeChange(index, v)}
              options={MEDIA_TYPE_OPTIONS}
              style={{ width: 90 }}
              size="small"
            />
            <Button
              type="text"
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(index)}
              danger
            />
          </Space>
        ))}
      </div>
      <Button
        type="dashed"
        onClick={handleAdd}
        icon={<PlusOutlined />}
        size="small"
        block
      >
        添加
      </Button>
    </Modal>
  );
};

export default TemplateDialog;
