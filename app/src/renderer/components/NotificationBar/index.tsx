import React from 'react';
import { Button, Tooltip } from 'antd';
import {
  CloseOutlined,
  CopyOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import { useNotificationStore, NotificationType } from '../../stores/notification';
import styles from './NotificationBar.module.css';

// ============================================
// Icon Mapping
// ============================================

const iconMap: Record<NotificationType, React.ReactNode> = {
  error: <ExclamationCircleOutlined />,
  warning: <WarningOutlined />,
  info: <InfoCircleOutlined />,
  success: <CheckCircleOutlined />,
};

// ============================================
// Component
// ============================================

const NotificationBar: React.FC = () => {
  const { notifications, removeNotification, clearAll } = useNotificationStore();

  const handleCopy = async (message: string) => {
    try {
      await navigator.clipboard.writeText(message);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>
          {notifications.length} 条通知
        </span>
        <Tooltip title="清除所有">
          <Button
            type="text"
            size="small"
            icon={<ClearOutlined />}
            onClick={clearAll}
            className={styles.clearButton}
          />
        </Tooltip>
      </div>
      <div className={styles.list}>
        {notifications.map((notification) => (
          <div
            key={notification.id}
            className={`${styles.item} ${styles[notification.type]}`}
          >
            <span className={styles.icon}>{iconMap[notification.type]}</span>
            <span className={styles.message}>{notification.message}</span>
            <div className={styles.actions}>
              <Tooltip title="复制">
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => handleCopy(notification.message)}
                  className={styles.actionButton}
                />
              </Tooltip>
              <Tooltip title="关闭">
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={() => removeNotification(notification.id)}
                  className={styles.actionButton}
                />
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default NotificationBar;
