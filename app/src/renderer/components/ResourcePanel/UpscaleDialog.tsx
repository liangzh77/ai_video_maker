import React, { useState } from 'react';
import { Modal, Form, InputNumber, Select, Switch, Space, Typography, Progress, Input } from 'antd';
import type { UpscaleConfig, SectionDescriptor } from '@shared/types';

const { Text } = Typography;

const NEW_SECTION_VALUE = '__new__';

// 预设分辨率
const RESOLUTION_PRESETS = [
  { label: '720p (1280x720)', width: 1280, height: 720 },
  { label: '1080p (1920x1080)', width: 1920, height: 1080 },
  { label: '竖屏 720p (720x1280)', width: 720, height: 1280 },
  { label: '竖屏 1080p (1080x1920)', width: 1080, height: 1920 },
  { label: '4K (3840x2160)', width: 3840, height: 2160 },
  { label: '竖屏 4K (2160x3840)', width: 2160, height: 3840 },
  { label: '自定义', width: 0, height: 0 },
];

// 编码预设
const ENCODER_PRESETS = [
  { label: '极快 (ultrafast)', value: 'ultrafast' },
  { label: '超快 (superfast)', value: 'superfast' },
  { label: '很快 (veryfast) - 推荐', value: 'veryfast' },
  { label: '较快 (faster)', value: 'faster' },
  { label: '快 (fast)', value: 'fast' },
  { label: '中等 (medium)', value: 'medium' },
  { label: '慢 (slow)', value: 'slow' },
  { label: '较慢 (slower)', value: 'slower' },
  { label: '极慢 (veryslow)', value: 'veryslow' },
];

export interface UpscaleDialogResult {
  config: UpscaleConfig;
  targetSectionId: string | null; // null 表示新建
  newSectionLabel?: string;
  clearTarget: boolean;
}

interface UpscaleDialogProps {
  open: boolean;
  videoCount: number;
  sections: SectionDescriptor[];
  currentSectionId: string;
  isProcessing?: boolean;
  progress?: number;
  onCancel: () => void;
  onOk: (result: UpscaleDialogResult) => void;
}

const UpscaleDialog: React.FC<UpscaleDialogProps> = ({
  open,
  videoCount,
  sections,
  currentSectionId,
  isProcessing = false,
  progress = 0,
  onCancel,
  onOk,
}) => {
  const [form] = Form.useForm();
  const [selectedPreset, setSelectedPreset] = useState(3); // 默认竖屏 1080p
  const [isCustom, setIsCustom] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string>(NEW_SECTION_VALUE);

  const videoSections = sections.filter((s) => s.mediaType === '视频');

  const targetOptions = [
    ...videoSections.map((s) => ({
      label: s.id === currentSectionId ? `${s.label} (当前)` : s.label,
      value: s.id,
    })),
    { label: '+ 新建卡片栏', value: NEW_SECTION_VALUE },
  ];

  const handlePresetChange = (value: number) => {
    setSelectedPreset(value);
    const preset = RESOLUTION_PRESETS[value];
    if (preset.width === 0) {
      setIsCustom(true);
    } else {
      setIsCustom(false);
      form.setFieldsValue({
        targetWidth: preset.width,
        targetHeight: preset.height,
      });
    }
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const config: UpscaleConfig = {
        targetWidth: values.targetWidth,
        targetHeight: values.targetHeight,
        targetFps: values.targetFps,
        preset: values.preset,
        crf: values.crf,
        interpolateFrames: values.interpolateFrames || false,
      };
      const isNew = selectedTarget === NEW_SECTION_VALUE;
      onOk({
        config,
        targetSectionId: isNew ? null : selectedTarget,
        newSectionLabel: isNew ? (values.newSectionLabel || '高清视频') : undefined,
        clearTarget: isNew ? false : (values.clearTarget || false),
      });
    } catch (error) {
      // 验证失败
    }
  };

  return (
    <Modal
      title="高清化设置"
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText={isProcessing ? '处理中...' : '开始高清化'}
      cancelText={isProcessing ? '关闭' : '取消'}
      okButtonProps={{ disabled: isProcessing, loading: isProcessing }}
      closable={!isProcessing}
      maskClosable={!isProcessing}
      width={480}
    >
      {isProcessing ? (
        <div style={{ padding: '24px 0' }}>
          <Text style={{ display: 'block', marginBottom: 16, textAlign: 'center' }}>
            正在高清化 {videoCount} 个视频...
          </Text>
          <Progress
            percent={progress}
            status="active"
            strokeColor={{ from: '#108ee9', to: '#87d068' }}
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 8, textAlign: 'center' }}>
            请勿关闭窗口，处理完成后会自动更新
          </Text>
        </div>
      ) : (
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            targetWidth: 1080,
            targetHeight: 1920,
            targetFps: 30,
            preset: 'veryfast',
            crf: 23,
            interpolateFrames: false,
            newSectionLabel: '高清视频',
            clearTarget: false,
          }}
        >
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            将对 {videoCount} 个视频进行高清化处理
          </Text>

          <Form.Item label="输出到">
            <Select
              value={selectedTarget}
              onChange={setSelectedTarget}
              options={targetOptions}
            />
          </Form.Item>

          {selectedTarget === NEW_SECTION_VALUE && (
            <Form.Item
              name="newSectionLabel"
              label="新卡片栏名称"
              rules={[{ required: true, message: '请输入名称' }]}
            >
              <Input placeholder="高清视频" />
            </Form.Item>
          )}

          {selectedTarget !== NEW_SECTION_VALUE && (
            <Form.Item
              name="clearTarget"
              label="清空目标卡片栏已有视频"
              valuePropName="checked"
              tooltip="开启后会先删除目标卡片栏中已有的所有视频，再写入高清化结果"
            >
              <Switch />
            </Form.Item>
          )}

          <Form.Item label="分辨率预设">
            <Select
              value={selectedPreset}
              onChange={handlePresetChange}
              options={RESOLUTION_PRESETS.map((p, i) => ({ label: p.label, value: i }))}
            />
          </Form.Item>

          <Space style={{ width: '100%' }} size="middle">
            <Form.Item
              name="targetWidth"
              label="宽度"
              rules={[{ required: true, message: '请输入宽度' }]}
              style={{ flex: 1 }}
            >
              <InputNumber
                min={1}
                max={7680}
                style={{ width: '100%' }}
                disabled={!isCustom}
              />
            </Form.Item>

            <Form.Item
              name="targetHeight"
              label="高度"
              rules={[{ required: true, message: '请输入高度' }]}
              style={{ flex: 1 }}
            >
              <InputNumber
                min={1}
                max={4320}
                style={{ width: '100%' }}
                disabled={!isCustom}
              />
            </Form.Item>
          </Space>

          <Form.Item
            name="targetFps"
            label="帧率 (FPS)"
            rules={[{ required: true, message: '请输入帧率' }]}
          >
            <InputNumber min={1} max={120} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="preset"
            label="编码速度"
            tooltip="越快质量越低，越慢质量越高"
          >
            <Select options={ENCODER_PRESETS} />
          </Form.Item>

          <Form.Item
            name="crf"
            label="质量 (CRF)"
            tooltip="0-51，越小质量越高，文件越大。推荐 18-28"
          >
            <InputNumber min={0} max={51} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="interpolateFrames"
            label="帧插值"
            valuePropName="checked"
            tooltip="启用后帧率提升更流畅，但处理速度更慢"
          >
            <Switch />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
};

export default UpscaleDialog;
