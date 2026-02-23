import React, { useState, useEffect } from 'react';
import { Input, Button, App, Segmented } from 'antd';
import { SaveOutlined, ThunderboltOutlined, CopyOutlined, SplitCellsOutlined } from '@ant-design/icons';
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
  const { updateResource, addTextResource, pendingGenerateResourceId, setPendingGenerate } = useDraftStore();
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

  // 尝试从内容中提取 JSON（支持 ```json ... ``` 包裹）
  const extractJson = (text: string): unknown | null => {
    let s = text.trim();
    // 剥离 markdown 代码块
    const fenceMatch = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (fenceMatch) s = fenceMatch[1].trim();
    if (!s.startsWith('[') && !s.startsWith('{')) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  // 检查内容是否可分解（JSON 数组且至少有一项包含 prompt 字段）
  const canDecompose = (() => {
    const parsed = extractJson(content);
    if (!Array.isArray(parsed)) return false;
    const withPrompt = parsed.filter(
      (item: unknown) => typeof item === 'object' && item !== null && 'prompt' in item,
    );
    return withPrompt.length > 1;
  })();

  const handleDecompose = async () => {
    const parsed = extractJson(content);
    if (!Array.isArray(parsed)) {
      message.error('JSON 解析失败');
      return;
    }
    // 只提取包含 prompt 字段的项
    const arr = (parsed as Array<Record<string, unknown>>).filter(
      (item) => typeof item === 'object' && item !== null && 'prompt' in item,
    );
    const draftId = resource.draftId;
    const sectionId = resource.type;
    let created = 0;
    for (const item of arr) {
      const itemContent = JSON.stringify(item, null, 2);
      const newResource = await addTextResource(draftId, sectionId, itemContent);
      if (newResource) {
        if (tag) {
          await updateResource(newResource.id, { tag } as Partial<Resource['metadata']>);
        }
        created++;
      }
    }
    if (created > 0) {
      message.success(`已分解为 ${created} 个提示词卡片`);
    } else {
      message.error('分解失败');
    }
  };

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <span className={styles.label}>内容编辑</span>
        <div className={styles.actions}>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => {
              navigator.clipboard.writeText(content).then(() => {
                message.success('已复制到剪贴板');
              }).catch(() => {
                message.error('复制失败');
              });
            }}
            disabled={!content}
          >
            复制
          </Button>
          <Button
            size="small"
            icon={<SplitCellsOutlined />}
            onClick={handleDecompose}
            disabled={!canDecompose}
            title={canDecompose ? '将 JSON 数组拆分为多个提示词卡片' : '内容需要是 JSON 数组且每项包含 prompt 字段'}
          >
            分解
          </Button>
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
