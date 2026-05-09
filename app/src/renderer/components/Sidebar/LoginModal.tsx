/**
 * Keychain 托管用户登录/注册弹窗
 */
import React, { useState } from 'react';
import { Modal, Form, Input, Button, Alert, Tabs } from 'antd';
import { UserOutlined, LockOutlined, CloudOutlined, KeyOutlined, ApartmentOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../stores/auth';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_BASE_URL = 'https://keychain.liangz77.cn';
const DEFAULT_CHANNEL_ID = 'ai_video_maker';

const LoginModal: React.FC<LoginModalProps> = ({ open, onClose }) => {
  const { login, register, isLoading, error, clearError } = useAuthStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [showRuntimeSettings, setShowRuntimeSettings] = useState(false);
  const [form] = Form.useForm();

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const common = {
        username: values.username.trim(),
        password: values.password,
        baseUrl: values.baseUrl?.trim() || DEFAULT_BASE_URL,
        channelId: values.channelId?.trim(),
        runtimeToken: values.runtimeToken?.trim(),
      };
      const success = mode === 'register'
        ? await register({ ...common, name: values.name?.trim() || common.username })
        : await login(common);

      if (success) {
        form.resetFields();
        onClose();
      }
    } catch {
      // 表单验证失败
    }
  };

  const cancel = () => {
    clearError();
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title="Keychain 用户"
      open={open}
      onCancel={cancel}
      footer={null}
      width={420}
      destroyOnHidden
    >
      <Tabs
        activeKey={mode}
        onChange={(key) => {
          clearError();
          setMode(key as 'login' | 'register');
        }}
        items={[
          { key: 'login', label: '登录' },
          { key: 'register', label: '注册' },
        ]}
      />

      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={{ baseUrl: DEFAULT_BASE_URL, channelId: DEFAULT_CHANNEL_ID }}
      >
        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            closable
            onClose={clearError}
            style={{ marginBottom: 16 }}
          />
        )}

        <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
          <Input prefix={<UserOutlined />} placeholder="用户名" size="large" autoFocus />
        </Form.Item>

        {mode === 'register' && (
          <Form.Item name="name">
            <Input prefix={<UserOutlined />} placeholder="显示名称（可选）" size="large" />
          </Form.Item>
        )}

        <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" />
        </Form.Item>

        {showRuntimeSettings ? (
          <>
            <Form.Item name="baseUrl" label="Keychain 地址">
              <Input prefix={<CloudOutlined />} placeholder={DEFAULT_BASE_URL} />
            </Form.Item>
            <Form.Item name="channelId" label="渠道 ID" rules={[{ required: true, message: '请输入渠道 ID' }]}>
              <Input prefix={<ApartmentOutlined />} placeholder={DEFAULT_CHANNEL_ID} />
            </Form.Item>
            <Form.Item name="runtimeToken" label="Runtime Token" rules={[{ required: true, message: '请输入 Runtime Token' }]}>
              <Input.Password prefix={<KeyOutlined />} placeholder="本地保存，不写入代码仓库" />
            </Form.Item>
          </>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <a onClick={() => setShowRuntimeSettings(true)} style={{ fontSize: 12 }}>
              配置 Keychain Runtime
            </a>
          </div>
        )}

        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={isLoading} block size="large">
            {mode === 'register' ? '注册并登录' : '登录'}
          </Button>
        </Form.Item>
      </Form>

      <div style={{ marginTop: 12, textAlign: 'center', color: '#999', fontSize: 12 }}>
        模型密钥只在每次调用前临时获取，调用后不会保存到本地
      </div>
    </Modal>
  );
};

export default LoginModal;
