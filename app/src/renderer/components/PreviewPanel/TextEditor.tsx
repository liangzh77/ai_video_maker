import React, { useState, useEffect } from 'react';
import { Input, Button, App } from 'antd';
import { SaveOutlined, PictureOutlined } from '@ant-design/icons';
import type { Resource, TextMetadata } from '@shared/types';
import { isTextMetadata } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import GenerateImageDialog from './GenerateImageDialog';
import styles from './TextEditor.module.css';

const { TextArea } = Input;

interface TextEditorProps {
  resource: Resource;
}

const TextEditor: React.FC<TextEditorProps> = ({ resource }) => {
  const { message } = App.useApp();
  const { updateResource } = useDraftStore();
  const [content, setContent] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);

  const originalContent = isTextMetadata(resource.metadata)
    ? resource.metadata.content
    : '';

  useEffect(() => {
    setContent(originalContent);
    setHasChanges(false);
  }, [originalContent, resource.id]);

  const handleChange = (value: string) => {
    setContent(value);
    setHasChanges(value !== originalContent);
  };

  const handleSave = async () => {
    const updatedMeta: TextMetadata = {
      content,
      encoding: 'utf-8',
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
            icon={<PictureOutlined />}
            onClick={handleOpenGenerateDialog}
            title="生成图片"
          >
            生成图片
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
