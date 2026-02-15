import React, { useState, useEffect } from 'react';
import { Button, InputNumber, Segmented, Empty, Tooltip } from 'antd';
import {
  LoadingOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  StopOutlined,
  DeleteOutlined,
  PictureOutlined,
  FileTextOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { useGenerationStore, type GenerationTask, type TaskStatus } from '../../stores/generation';
import styles from './ActiveTasksPanel.module.css';

type FilterMode = 'all' | 'running' | 'pending' | 'finished' | 'failed';

const TYPE_LABELS: Record<string, string> = {
  image: '图片',
  text: '文本',
  video: '视频',
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  image: <PictureOutlined />,
  text: <FileTextOutlined />,
  video: <VideoCameraOutlined />,
};

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m${secs}s`;
}

/** 实时计时器组件 */
const ElapsedTimer: React.FC<{ startedAt: number }> = ({ startedAt }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span>{formatElapsed(now - startedAt)}</span>;
};

const STATUS_CONFIG: Record<TaskStatus, { icon: React.ReactNode; className: string }> = {
  running: { icon: <LoadingOutlined spin />, className: styles.taskRunning },
  pending: { icon: <ClockCircleOutlined />, className: styles.taskPending },
  completed: { icon: <CheckCircleOutlined />, className: styles.taskCompleted },
  failed: { icon: <CloseCircleOutlined />, className: styles.taskFailed },
  cancelled: { icon: <StopOutlined />, className: styles.taskCancelled },
};

interface ActiveTasksPanelProps {
  onNavigateToResult?: (task: GenerationTask) => void;
}

const ActiveTasksPanel: React.FC<ActiveTasksPanelProps> = ({ onNavigateToResult }) => {
  const { tasks, threadCounts, setThreadCount, cancelTask, clearFinished } = useGenerationStore();
  const [filter, setFilter] = useState<FilterMode>('all');

  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const finishedCount = tasks.filter(
    (t) => t.status === 'completed',
  ).length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;

  const filtered = tasks.filter((t) => {
    switch (filter) {
      case 'running':
        return t.status === 'running';
      case 'pending':
        return t.status === 'pending';
      case 'finished':
        return t.status === 'completed';
      case 'failed':
        return t.status === 'failed';
      default:
        return true;
    }
  });

  // Sort: running first, then pending, then finished (newest first within each group)
  const sorted = [...filtered].sort((a, b) => {
    const statusOrder: Record<TaskStatus, number> = {
      running: 0,
      pending: 1,
      completed: 2,
      failed: 2,
      cancelled: 2,
    };
    const orderDiff = statusOrder[a.status] - statusOrder[b.status];
    if (orderDiff !== 0) return orderDiff;
    return b.createdAt - a.createdAt;
  });

  const handleTaskClick = (task: GenerationTask) => {
    if (task.status !== 'completed') return;
    if (onNavigateToResult) {
      onNavigateToResult(task);
    }
  };

  const renderTaskItem = (task: GenerationTask) => {
    const config = STATUS_CONFIG[task.status];
    const canCancel = task.status === 'pending' || task.status === 'running';
    const isClickable = task.status === 'completed' && (task.params as any).targetSectionId;

    return (
      <div
        key={task.id}
        className={`${styles.taskItem} ${isClickable ? styles.taskClickable : ''}`}
        onClick={() => handleTaskClick(task)}
      >
        <span className={`${styles.taskIcon} ${config.className}`}>{config.icon}</span>
        <div className={styles.taskBody}>
          <div className={styles.taskHeader}>
            <span className={styles.taskLabel}>{task.label}</span>
            <span className={styles.taskTypeTag}>
              {TYPE_ICONS[task.type]} {TYPE_LABELS[task.type]}
            </span>
          </div>
          <div className={styles.taskPrompt} title={task.prompt}>
            {task.prompt.length > 80 ? task.prompt.slice(0, 80) + '...' : task.prompt}
          </div>
          <div className={styles.taskStatus}>
            {task.status === 'running' && task.startedAt && (
              <>{task.progressMessage || '运行中'} <ElapsedTimer startedAt={task.startedAt} /></>
            )}
            {task.status === 'pending' && '等待中'}
            {task.status === 'completed' && task.startedAt && task.completedAt && (
              <>完成 ({formatElapsed(task.completedAt - task.startedAt)})</>
            )}
            {task.status === 'failed' && '失败'}
            {task.status === 'cancelled' && '已取消'}
          </div>
          {task.status === 'failed' && task.error && (
            <div className={styles.taskError}>{task.error}</div>
          )}
        </div>
        {canCancel && (
          <div className={styles.taskActions}>
            <Tooltip title={task.status === 'running' ? '取消运行' : '取消任务'}>
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  cancelTask(task.id);
                }}
                danger
              />
            </Tooltip>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.container}>
      {/* Thread count settings */}
      <div className={styles.threadRow}>
        <span className={styles.threadLabel}>线程数</span>
        <div className={styles.threadGroup}>
          <span className={styles.threadType}>图片:</span>
          <InputNumber
            min={1}
            max={8}
            value={threadCounts.image}
            onChange={(v) => setThreadCount('image', v || 1)}
            size="small"
            style={{ width: 56 }}
          />
        </div>
        <div className={styles.threadGroup}>
          <span className={styles.threadType}>文本:</span>
          <InputNumber
            min={1}
            max={8}
            value={threadCounts.text}
            onChange={(v) => setThreadCount('text', v || 1)}
            size="small"
            style={{ width: 56 }}
          />
        </div>
        <div className={styles.threadGroup}>
          <span className={styles.threadType}>视频:</span>
          <InputNumber
            min={1}
            max={4}
            value={threadCounts.video}
            onChange={(v) => setThreadCount('video', v || 1)}
            size="small"
            style={{ width: 56 }}
          />
        </div>
      </div>

      {/* Filter bar */}
      <div className={styles.filterRow}>
        <Segmented
          size="small"
          value={filter}
          onChange={(val) => setFilter(val as FilterMode)}
          options={[
            { label: `全部 ${tasks.length}`, value: 'all' },
            { label: `运行中 ${runningCount}`, value: 'running' },
            { label: `等待中 ${pendingCount}`, value: 'pending' },
            { label: `已完成 ${finishedCount}`, value: 'finished' },
            { label: `失败 ${failedCount}`, value: 'failed' },
          ]}
        />
        {(finishedCount > 0 || failedCount > 0) && (
          <Button
            size="small"
            onClick={clearFinished}
            className={styles.clearButton}
          >
            清除已完成
          </Button>
        )}
      </div>

      {/* Task list */}
      <div className={styles.taskList}>
        {sorted.length === 0 ? (
          <div className={styles.emptyState}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无任务"
            />
          </div>
        ) : (
          sorted.map(renderTaskItem)
        )}
      </div>
    </div>
  );
};

export default ActiveTasksPanel;
