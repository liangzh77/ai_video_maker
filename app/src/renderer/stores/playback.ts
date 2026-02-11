import { create } from 'zustand';
import { parseFolderName } from '@shared/section-utils';

// 所有视频类型 section 都支持连续播放
export function isContinuousPlayType(sectionId: string): boolean {
  const desc = parseFolderName(sectionId);
  return desc?.mediaType === '视频';
}

// 播放器类型：用于区分不同的播放位置，实现互斥播放
export type PlayerType = 'preview' | 'boundary-editor' | 'fullscreen' | 'multi-video' | null;

interface PlaybackState {
  // 是否启用自动播放（下一个选中的视频自动播放）
  shouldAutoPlay: boolean;

  // 当前是否正在播放
  isPlaying: boolean;

  // 当前活跃的播放器类型（用于互斥播放）
  activePlayerType: PlayerType;

  // 播放器暂停请求计数器（用于通知其他播放器暂停）
  pauseRequestId: number;

  // 设置自动播放标志
  setShouldAutoPlay: (value: boolean) => void;

  // 设置播放状态（已废弃，请使用 startPlaying/stopPlaying）
  setIsPlaying: (value: boolean) => void;

  // 开始播放：设置当前播放器为活跃，通知其他播放器暂停
  startPlaying: (playerType: PlayerType) => void;

  // 停止播放：清除活跃播放器状态
  stopPlaying: (playerType: PlayerType) => void;

  // 检查 section 是否支持连续播放
  isContinuousPlayType: (sectionId: string) => boolean;

  // 检查当前播放器是否是活跃播放器
  isActivePlayer: (playerType: PlayerType) => boolean;
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  shouldAutoPlay: false,
  isPlaying: false,
  activePlayerType: null,
  pauseRequestId: 0,

  setShouldAutoPlay: (value: boolean) => {
    set({ shouldAutoPlay: value });
  },

  setIsPlaying: (value: boolean) => {
    set({ isPlaying: value });
  },

  startPlaying: (playerType: PlayerType) => {
    const state = get();
    // 如果有其他播放器在播放，增加 pauseRequestId 通知它们暂停
    if (state.activePlayerType !== null && state.activePlayerType !== playerType) {
      set({
        activePlayerType: playerType,
        isPlaying: true,
        pauseRequestId: state.pauseRequestId + 1,
      });
    } else {
      set({
        activePlayerType: playerType,
        isPlaying: true,
      });
    }
  },

  stopPlaying: (playerType: PlayerType) => {
    const state = get();
    // 只有当前活跃播放器才能清除状态
    if (state.activePlayerType === playerType) {
      set({
        activePlayerType: null,
        isPlaying: false,
      });
    }
  },

  isContinuousPlayType: (sectionId: string) => {
    return isContinuousPlayType(sectionId);
  },

  isActivePlayer: (playerType: PlayerType) => {
    return get().activePlayerType === playerType;
  },
}));

export default usePlaybackStore;
