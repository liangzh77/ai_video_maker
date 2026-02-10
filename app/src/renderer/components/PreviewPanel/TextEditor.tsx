import React, { useState, useEffect } from 'react';
import { Input, Button, App, Segmented } from 'antd';
import { SaveOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { Resource, TextMetadata, PromptTag } from '@shared/types';
import { isTextMetadata } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import GenerateImageDialog from './GenerateImageDialog';
import styles from './TextEditor.module.css';

const { TextArea } = Input;

const TAG_OPTIONS: Array<{ label: string; value: PromptTag | '' }> = [
  { label: '无标签', value: '' },
  { label: '文本', value: 'text' },
  { label: '图片', value: 'image' },
  { label: '视频', value: 'video' },
];

interface TextEditorProps {
  resource: Resource;
}

const TextEditor: React.FC<TextEditorProps> = ({ resource }) => {
  const { message } = App.useApp();
  const { updateResource, pendingGenerateResourceId, setPendingGenerate } = useDraftStore();
  const [content, setContent] = useState('');
  const [tag, setTag] = useState<PromptTag | ''>('');
  const [hasChanges, setHasChanges] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);

  const metadata = isTextMetadata(resource.metadata) ? resource.metadata : null;
  const originalContent = metadata?.content ?? '';
  const originalTag = metadata?.tag ?? '';

  useEffect(() => {
    setContent(originalContent);
    setTag(originalTag);
    setHasChanges(false);
  }, [originalContent, originalTag, resource.id]);

  // 响应卡片上的"生成"按钮
  useEffect(() => {
    if (pendingGenerateResourceId === resource.id) {
      setPendingGenerate(null);
      // 延迟一帧确保 content 已设置
      requestAnimationFrame(() => {
        setShowGenerateDialog(true);
      });
    }
  }, [pendingGenerateResourceId, resource.id, setPendingGenerate]);

  const handleChange = (value: string) => {
    setContent(value);
    setHasChanges(value !== originalContent || tag !== originalTag);
  };

  const handleTagChange = (value: string | number) => {
    const newTag = (value as string) as PromptTag | '';
    setTag(newTag);
    setHasChanges(content !== originalContent || newTag !== originalTag);
  };

  const handleSave = async () => {
    const updatedMeta: TextMetadata = {
      content,
      encoding: 'utf-8',
      ...(tag ? { tag } : {}),
    };
    const result = await updateResource(resource.id, updatedMeta);
    if (result) {
      message.success('保存成功');
      setHasChanges(false);
    } else {
      message.error('保存失败');
    }
  };

  const handleOpenGenerateDialog = () => {
    if (!content || content.trim().length === 0) {
      message.warning('请先输入提示词内容');
      return;
    }
    setShowGenerateDialog(true);
  };

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <span className={styles.label}>内容编辑</span>
        <div className={styles.actions}>
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={handleOpenGenerateDialog}
            title="生成"
          >
            生成
          </Button>
          {hasChanges && (
            <Button
              type="primary"
              size="small"
              icon={<SaveOutlined />}
              onClick={handleSave}
            >
              保存
            </Button>
          )}
        </div>
      </div>

      <div className={styles.tagRow}>
        <span className={styles.tagLabel}>用途标签</span>
        <Segmented
          size="small"
          options={TAG_OPTIONS}
          value={tag}
          onChange={handleTagChange}
        />
      </div>

      <TextArea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        autoSize={{ minRows: 6, maxRows: 15 }}
        placeholder="输入提示词内容..."
        className={styles.textarea}
      />

      <GenerateImageDialog
        visible={showGenerateDialog}
        promptResource={resource}
        promptContent={content}
        onClose={() => setShowGenerateDialog(false)}
      />
    </div>
  );
};

export default TextEditor;
