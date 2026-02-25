import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Modal, Spin, App, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { Resource, TextMetadata } from '@shared/types';
import { parseFolderName } from '@shared/section-utils';
import styles from './CompareTranscriptDialog.module.css';

interface CompareTranscriptDialogProps {
  visible: boolean;
  resources: Resource[];
  onClose: () => void;
}

// Diff 行类型
type DiffType = 'equal' | 'removed' | 'added' | 'modified' | 'empty';

// 字符级 diff 片段
interface CharFragment {
  text: string;
  type: 'equal' | 'removed' | 'added';
}

interface DiffLine {
  leftText: string;
  rightText: string;
  type: DiffType;
  leftFragments?: CharFragment[];   // modified 行的左侧字符级高亮
  rightFragments?: CharFragment[];  // modified 行的右侧字符级高亮
}

// 按中文标点分句
function splitSentences(text: string): string[] {
  return text.split(/(?<=[。？！.?!\n])/).map(s => s.trim()).filter(s => s.length > 0);
}

// 字符级 LCS diff
function computeCharDiff(
  leftStr: string,
  rightStr: string,
): { leftFragments: CharFragment[]; rightFragments: CharFragment[] } {
  const left = [...leftStr];
  const right = [...rightStr];
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

  // 回溯
  const ops: Array<{ leftChar: string; rightChar: string; type: 'equal' | 'removed' | 'added' }> = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && left[i - 1] === right[j - 1]) {
      ops.push({ leftChar: left[i - 1], rightChar: right[j - 1], type: 'equal' });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ leftChar: '', rightChar: right[j - 1], type: 'added' });
      j--;
    } else {
      ops.push({ leftChar: left[i - 1], rightChar: '', type: 'removed' });
      i--;
    }
  }
  ops.reverse();

  // 合并连续同类型字符为片段
  const leftFragments: CharFragment[] = [];
  const rightFragments: CharFragment[] = [];

  for (const op of ops) {
    // 左侧片段：equal 和 removed 可见
    if (op.type === 'equal' || op.type === 'removed') {
      const lastLeft = leftFragments[leftFragments.length - 1];
      if (lastLeft && lastLeft.type === op.type) {
        lastLeft.text += op.leftChar;
      } else {
        leftFragments.push({ text: op.leftChar, type: op.type });
      }
    }
    // 右侧片段：equal 和 added 可见
    if (op.type === 'equal' || op.type === 'added') {
      const lastRight = rightFragments[rightFragments.length - 1];
      if (lastRight && lastRight.type === op.type) {
        lastRight.text += op.rightChar;
      } else {
        rightFragments.push({ text: op.rightChar, type: op.type });
      }
    }
  }

  return { leftFragments, rightFragments };
}

// 字符串相似度（基于 LCS 长度比例，0~1）
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const charsA = [...a];
  const charsB = [...b];
  const m = charsA.length;
  const n = charsB.length;
  // 空间优化的 LCS 长度计算（只需要两行）
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (charsA[i - 1] === charsB[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  const lcsLen = prev[n];
  return (2 * lcsLen) / (m + n);
}

// 相似度阈值：高于此值认为是同一句的修改版本
const SIMILARITY_THRESHOLD = 0.5;

// LCS diff 算法（句子级别，支持模糊匹配）
function computeSentenceDiff(left: string[], right: string[]): DiffLine[] {
  const m = left.length;
  const n = right.length;

  // 预计算相似度矩阵
  const sim: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      sim[i][j] = stringSimilarity(left[i], right[j]);
    }
  }

  // 构建 LCS 表（相似度 >= 阈值即视为匹配）
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (sim[i - 1][j - 1] >= SIMILARITY_THRESHOLD) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯生成 diff
  let i = m;
  let j = n;

  const tempLines: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && sim[i - 1][j - 1] >= SIMILARITY_THRESHOLD) {
      if (left[i - 1] === right[j - 1]) {
        // 完全相同
        tempLines.push({ leftText: left[i - 1], rightText: right[j - 1], type: 'equal' });
      } else {
        // 相似但有差异，标记为 modified 并计算字符级 diff
        const { leftFragments, rightFragments } = computeCharDiff(left[i - 1], right[j - 1]);
        tempLines.push({
          leftText: left[i - 1],
          rightText: right[j - 1],
          type: 'modified',
          leftFragments,
          rightFragments,
        });
      }
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
  const rawLines = tempLines.reverse();

  // 后处理：将相邻的 removed + added 如果相似度足够也合并为 modified
  const result: DiffLine[] = [];
  let idx = 0;
  while (idx < rawLines.length) {
    const cur = rawLines[idx];
    const next = rawLines[idx + 1];

    if (cur.type === 'removed' && next?.type === 'added') {
      const s = stringSimilarity(cur.leftText, next.rightText);
      if (s >= SIMILARITY_THRESHOLD) {
        const { leftFragments, rightFragments } = computeCharDiff(cur.leftText, next.rightText);
        result.push({
          leftText: cur.leftText,
          rightText: next.rightText,
          type: 'modified',
          leftFragments,
          rightFragments,
        });
        idx += 2;
        continue;
      }
    } else if (cur.type === 'added' && next?.type === 'removed') {
      const s = stringSimilarity(next.leftText, cur.rightText);
      if (s >= SIMILARITY_THRESHOLD) {
        const { leftFragments, rightFragments } = computeCharDiff(next.leftText, cur.rightText);
        result.push({
          leftText: next.leftText,
          rightText: cur.rightText,
          type: 'modified',
          leftFragments,
          rightFragments,
        });
        idx += 2;
        continue;
      }
    }

    result.push(cur);
    idx++;
  }

  return result;
}

// 判断资源是否是文本类型（提示词）
function isTextResource(resource: Resource): boolean {
  const desc = parseFolderName(resource.type);
  return desc?.mediaType === '提示词';
}

const CompareTranscriptDialog: React.FC<CompareTranscriptDialogProps> = ({
  visible,
  resources,
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

  // 是否有需要语音识别的资源
  const hasNonTextResource = useMemo(() => {
    return resources.some(r => !isTextResource(r));
  }, [resources]);

  // 获取资源标签
  const getResourceLabel = (resource: Resource) => {
    const desc = parseFolderName(resource.type);
    return desc?.label ? `${desc.label}/${resource.fileName}` : resource.fileName;
  };

  // 获取单个资源的文案文本
  const getResourceText = useCallback(async (resource: Resource, useCache = true): Promise<string> => {
    // 提示词资源：直接读取 content
    if (isTextResource(resource)) {
      const meta = resource.metadata as TextMetadata;
      return meta.content || '';
    }

    // 视频/音频资源：语音识别
    // 1. 检查 metadata 缓存
    if (useCache) {
      const metaResult = await window.api.resource.loadMetadata({
        draftId: resource.draftId,
        resourceId: resource.id,
      });
      if (metaResult.success && metaResult.data?.transcript) {
        return metaResult.data.transcript;
      }
    }

    // 2. 调用语音识别（handler 内部会自动提取音频）
    const recognizeResult = await window.api.task.recognizeSpeech({
      filePath: resource.filePath,
      modelEndpoint: 'gemini:gemini-2.5-flash',
    });

    if (!recognizeResult.success) {
      throw new Error(recognizeResult.error || '语音识别失败');
    }

    const text = recognizeResult.data.text;

    // 3. 缓存结果到 metadata
    await window.api.resource.saveMetadata({
      draftId: resource.draftId,
      resourceId: resource.id,
      transcript: text,
    });

    return text;
  }, []);

  // 并行获取两个资源的文本
  const startComparison = useCallback(async (forceRefresh = false) => {
    if (resources.length < 2) return;

    setError(null);
    setLeftText(null);
    setRightText(null);
    setLeftLoading(true);
    setRightLoading(true);

    const leftPromise = getResourceText(resources[0], !forceRefresh)
      .then((text) => {
        setLeftText(text);
        setLeftLoading(false);
      })
      .catch((err) => {
        setLeftLoading(false);
        setError((prev) => {
          const msg = `左侧资源获取失败: ${err.message}`;
          return prev ? `${prev}\n${msg}` : msg;
        });
      });

    const rightPromise = getResourceText(resources[1], !forceRefresh)
      .then((text) => {
        setRightText(text);
        setRightLoading(false);
      })
      .catch((err) => {
        setRightLoading(false);
        setError((prev) => {
          const msg = `右侧资源获取失败: ${err.message}`;
          return prev ? `${prev}\n${msg}` : msg;
        });
      });

    await Promise.allSettled([leftPromise, rightPromise]);
  }, [resources, getResourceText]);

  // 打开对话框时自动开始
  useEffect(() => {
    if (visible && resources.length >= 2) {
      startComparison();
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

  // 渲染字符级 diff 片段
  const renderFragments = (fragments: CharFragment[], side: 'left' | 'right') => {
    return fragments.map((frag, i) => {
      if (frag.type === 'equal') {
        return <span key={i}>{frag.text}</span>;
      }
      const className = side === 'left' ? styles.charRemoved : styles.charAdded;
      return <span key={i} className={className}>{frag.text}</span>;
    });
  };

  // 计算 diff
  const diffLines: DiffLine[] = React.useMemo(() => {
    if (!leftText || !rightText) return [];
    const leftSentences = splitSentences(leftText);
    const rightSentences = splitSentences(rightText);
    return computeSentenceDiff(leftSentences, rightSentences);
  }, [leftText, rightText]);

  const isLoading = leftLoading || rightLoading;
  const hasResult = leftText !== null || rightText !== null;

  // 加载提示文案
  const loadingText = hasNonTextResource ? '正在识别语音...' : '正在加载...';

  // 资源不足时不渲染内容
  if (resources.length < 2) {
    return (
      <Modal title="对比文案" open={visible} onCancel={onClose} footer={null} centered destroyOnClose>
        <div style={{ textAlign: 'center', padding: 24, color: 'var(--color-text-tertiary)' }}>
          请先拖入至少 2 个资源
        </div>
      </Modal>
    );
  }

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
      {hasResult && !isLoading && hasNonTextResource && (
        <div className={styles.toolbar}>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => startComparison(true)}
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
          <span className={styles.loadingText}>{loadingText}</span>
        </div>
      )}

      {/* Diff 对比区域 */}
      {(hasResult || isLoading) && (
        <div className={styles.diffContainer}>
          {/* 左栏 */}
          <div className={styles.diffColumn}>
            <div className={styles.diffHeader}>
              {getResourceLabel(resources[0])}
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
                    {line.type === 'added'
                      ? '\u00A0'
                      : line.type === 'modified' && line.leftFragments
                        ? renderFragments(line.leftFragments, 'left')
                        : line.leftText}
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
              {resources.length > 1 ? getResourceLabel(resources[1]) : ''}
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
                    {line.type === 'removed'
                      ? '\u00A0'
                      : line.type === 'modified' && line.rightFragments
                        ? renderFragments(line.rightFragments, 'right')
                        : line.rightText}
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
