/**
 * 登录弹窗组件
 */
import React, { useState } from 'react';
import { Modal, Form, Input, Button, Alert, App } from 'antd';
import { UserOutlined, LockOutlined, CloudOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../stores/auth';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_BASE_URL = 'https://distribute-keys.vercel.app';

const LoginModal: React.FC<LoginModalProps> = ({ open, onClose }) => {
  const { login, isLoading, error, clearError, missingKeys } = useAuthStore();
  const [showServerUrl, setShowServerUrl] = useState(false);
  const { notification } = App.useApp();

  const [form] = Form.useForm();

  const handleLogin = async () => {
    try {
      const values = await form.validateFields();
      const baseUrl = values.serverUrl?.trim() || DEFAULT_BASE_URL;
      const success = await login(values.username, values.password, baseUrl);
      if (success) {
        form.resetFields();
        onClose();

        // 登录成功后检查缺失密钥
        const { missingKeys: missing } = useAuthStore.getState();
        if (missing.length > 0) {
          notification.warning({
            message: '部分 API 密钥缺失',
            description: `以下服务的密钥未在云端配置，相关模型不可用：${missing.map(k => k.label).join('、')}`,
            duration: 8,
          });
        }
      }
    } catch {
      // 表单验证失败
    }
  };

  const handleCancel = () => {
    clearError();
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title="登录"
      open={open}
      onCancel={handleCancel}
      footer={null}
      width={400}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleLogin}
        initialValues={{ serverUrl: DEFAULT_BASE_URL }}
        style={{ marginTop: 16 }}
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

        <Form.Item
          name="username"
          rules={[{ required: true, message: '请输入用户名' }]}
        >
          <Input
            prefix={<UserOutlined />}
            placeholder="用户名"
            size="large"
            autoFocus
          />
        </Form.Item>

        <Form.Item
          name="password"
          rules={[{ required: true, message: '请输入密码' }]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="密码"
            size="large"
          />
        </Form.Item>

        {showServerUrl ? (
          <Form.Item
            name="serverUrl"
            label="服务器地址"
          >
            <Input
              prefix={<CloudOutlined />}
              placeholder={DEFAULT_BASE_URL}
              size="middle"
            />
          </Form.Item>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <a onClick={() => setShowServerUrl(true)} style={{ fontSize: 12 }}>
              自定义服务器地址
            </a>
          </div>
        )}

        <Form.Item style={{ marginBottom: 0 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={isLoading}
            block
            size="large"
          >
            登录
          </Button>
        </Form.Item>
      </Form>

      <div style={{ marginTop: 12, textAlign: 'center', color: '#999', fontSize: 12 }}>
        登录后可使用 AI 生成功能
      </div>
    </Modal>
  );
};

export default LoginModal;
