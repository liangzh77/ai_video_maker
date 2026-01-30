import { create } from 'zustand';

// 支持连续播放和空格键播放/暂停的资源类型
export const CONTINUOUS_PLAY_TYPES = ['scene_source', 'scene_new', 'scene_hd', 'lipsync', 'synthesized'] as const;
export type ContinuousPlayType = (typeof CONTINUOUS_PLAY_TYPES)[number];

interface PlaybackState {
  // 是否启用自动播放（下一个选中的视频自动播放）
  shouldAutoPlay: boolean;

  // 当前是否正在播放
  isPlaying: boolean;

  // 设置自动播放标志
  setShouldAutoPlay: (value: boolean) => void;

  // 设置播放状态
  setIsPlaying: (value: boolean) => void;

  // 检查资源类型是否支持连续播放
  isContinuousPlayType: (type: string) => boolean;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  shouldAutoPlay: false,
  isPlaying: false,

  setShouldAutoPlay: (value: boolean) => {
    set({ shouldAutoPlay: value });
  },

  setIsPlaying: (value: boolean) => {
    set({ isPlaying: value });
  },

  isContinuousPlayType: (type: string) => {
    return CONTINUOUS_PLAY_TYPES.includes(type as ContinuousPlayType);
  },
}));

export default usePlaybackStore;
