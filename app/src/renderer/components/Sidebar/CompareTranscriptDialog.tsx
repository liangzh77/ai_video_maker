import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, Spin, App, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { Resource } from '@shared/types';
import { parseFolderName } from '@shared/section-utils';
import styles from './CompareTranscriptDialog.module.css';

interface CompareTranscriptDialogProps {
  visible: boolean;
  videos: Resource[];
  onClose: () => void;
}

// Diff 行类型
type DiffType = 'equal' | 'removed' | 'added' | 'empty';

interface DiffLine {
  leftText: string;
  rightText: string;
  type: DiffType;
}

// 按中文标点分句
function splitSentences(text: string): string[] {
  return text.split(/(?<=[。？！.?!\n])/).map(s => s.trim()).filter(s => s.length > 0);
}

// LCS diff 算法
function computeDiff(left: string[], right: string[]): DiffLine[] {
  const m = left.length;
  const n = right.length;

  // 构建 LCS 表
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (left[i - 1] === right[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯生成 diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;

  const tempLines: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && left[i - 1] === right[j - 1]) {
      tempLines.push({ leftText: left[i - 1], rightText: right[j - 1], type: 'equal' });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      tempLines.push({ leftText: '', rightText: right[j - 1], type: 'added' });
      j--;
    } else {
      tempLines.push({ leftText: left[i - 1], rightText: '', type: 'removed' });
      i--;
    }
  }

  // 反转得到正序
  return tempLines.reverse();
}

const CompareTranscriptDialog: React.FC<CompareTranscriptDialogProps> = ({
  visible,
  videos,
  onClose,
}) => {
  const { message } = App.useApp();
  const [leftText, setLeftText] = useState<string | null>(null);
  const [rightText, setRightText] = useState<string | null>(null);
  const [leftLoading, setLeftLoading] = useState(false);
  const [rightLoading, setRightLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leftBodyRef = useRef<HTMLDivElement>(null);
  const rightBodyRef = useRef<HTMLDivElement>(null);
  const isSyncingScroll = useRef(false);

  // 获取视频标签
  const getVideoLabel = (video: Resource) => {
    const desc = parseFolderName(video.type);
    return desc?.label ? `${desc.label}/${video.fileName}` : video.fileName;
  };

  // 语音识别单个视频
  const transcribeVideo = useCallback(async (video: Resource, useCache = true): Promise<string> => {
    // 1. 检查 metadata 缓存
    if (useCache) {
      const metaResult = await window.api.resource.loadMetadata({
        draftId: video.draftId,
        resourceId: video.id,
      });
      if (metaResult.success && metaResult.data?.transcript) {
        return metaResult.data.transcript;
      }
    }

    // 2. 调用语音识别（handler 内部会自动提取音频）
    const recognizeResult = await window.api.task.recognizeSpeech({
      filePath: video.filePath,
      modelEndpoint: 'gemini:gemini-2.5-flash',
    });

    if (!recognizeResult.success) {
      throw new Error(recognizeResult.error || '语音识别失败');
    }

    const text = recognizeResult.data.text;

    // 3. 缓存结果到 metadata
    await window.api.resource.saveMetadata({
      draftId: video.draftId,
      resourceId: video.id,
      transcript: text,
    });

    return text;
  }, []);

  // 并行识别两个视频
  const startTranscription = useCallback(async (forceRefresh = false) => {
    if (videos.length < 2) return;

    setError(null);
    setLeftText(null);
    setRightText(null);
    setLeftLoading(true);
    setRightLoading(true);

    // 并行执行两个视频的语音识别
    const leftPromise = transcribeVideo(videos[0], !forceRefresh)
      .then((text) => {
        setLeftText(text);
        setLeftLoading(false);
      })
      .catch((err) => {
        setLeftLoading(false);
        setError((prev) => {
          const msg = `左侧视频识别失败: ${err.message}`;
          return prev ? `${prev}\n${msg}` : msg;
        });
      });

    const rightPromise = transcribeVideo(videos[1], !forceRefresh)
      .then((text) => {
        setRightText(text);
        setRightLoading(false);
      })
      .catch((err) => {
        setRightLoading(false);
        setError((prev) => {
          const msg = `右侧视频识别失败: ${err.message}`;
          return prev ? `${prev}\n${msg}` : msg;
        });
      });

    await Promise.allSettled([leftPromise, rightPromise]);
  }, [videos, transcribeVideo]);

  // 打开对话框时自动开始识别
  useEffect(() => {
    if (visible && videos.length >= 2) {
      startTranscription();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // 同步滚动
  const handleScroll = useCallback((source: 'left' | 'right') => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;

    const sourceEl = source === 'left' ? leftBodyRef.current : rightBodyRef.current;
    const targetEl = source === 'left' ? rightBodyRef.current : leftBodyRef.current;

    if (sourceEl && targetEl) {
      const scrollRatio = sourceEl.scrollTop / (sourceEl.scrollHeight - sourceEl.clientHeight || 1);
      targetEl.scrollTop = scrollRatio * (targetEl.scrollHeight - targetEl.clientHeight);
    }

    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  }, []);

  // 计算 diff
  const diffLines: DiffLine[] = React.useMemo(() => {
    if (!leftText || !rightText) return [];
    const leftSentences = splitSentences(leftText);
    const rightSentences = splitSentences(rightText);
    return computeDiff(leftSentences, rightSentences);
  }, [leftText, rightText]);

  const isLoading = leftLoading || rightLoading;
  const hasResult = leftText !== null || rightText !== null;

  return (
    <Modal
      title="对比文案"
      open={visible}
      onCancel={onClose}
      footer={null}
      width="80vw"
      styles={{
        body: {
          height: '70vh',
          padding: '16px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
      centered
      destroyOnClose
    >
      {/* 工具栏 */}
      {hasResult && !isLoading && (
        <div className={styles.toolbar}>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => startTranscription(true)}
          >
            重新识别
          </Button>
        </div>
      )}

      {/* 错误信息 */}
      {error && (
        <div className={styles.error}>{error}</div>
      )}

      {/* 加载状态 */}
      {isLoading && !hasResult && (
        <div className={styles.loading}>
          <Spin size="large" />
          <span className={styles.loadingText}>正在识别语音...</span>
        </div>
      )}

      {/* Diff 对比区域 */}
      {(hasResult || isLoading) && (
        <div className={styles.diffContainer}>
          {/* 左栏 */}
          <div className={styles.diffColumn}>
            <div className={styles.diffHeader}>
              {getVideoLabel(videos[0])}
              {leftLoading && <Spin size="small" className={styles.headerSpin} />}
            </div>
            <div
              className={styles.diffBody}
              ref={leftBodyRef}
              onScroll={() => handleScroll('left')}
            >
              {leftText !== null && rightText !== null ? (
                diffLines.map((line, idx) => (
                  <div
                    key={idx}
                    className={`${styles.diffLine} ${styles[line.type]}`}
                  >
                    {line.type === 'added' ? '\u00A0' : line.leftText}
                  </div>
                ))
              ) : leftText !== null ? (
                <div className={styles.plainText}>{leftText}</div>
              ) : null}
            </div>
          </div>

          {/* 右栏 */}
          <div className={styles.diffColumn}>
            <div className={styles.diffHeader}>
              {videos.length > 1 ? getVideoLabel(videos[1]) : ''}
              {rightLoading && <Spin size="small" className={styles.headerSpin} />}
            </div>
            <div
              className={styles.diffBody}
              ref={rightBodyRef}
              onScroll={() => handleScroll('right')}
            >
              {leftText !== null && rightText !== null ? (
                diffLines.map((line, idx) => (
                  <div
                    key={idx}
                    className={`${styles.diffLine} ${styles[line.type]}`}
                  >
                    {line.type === 'removed' ? '\u00A0' : line.rightText}
                  </div>
                ))
              ) : rightText !== null ? (
                <div className={styles.plainText}>{rightText}</div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default CompareTranscriptDialog;
