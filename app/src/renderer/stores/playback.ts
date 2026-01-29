import { create } from 'zustand';

// 支持连续播放的资源类型
export const CONTINUOUS_PLAY_TYPES = ['scene_source', 'scene_new'] as const;
export type ContinuousPlayType = (typeof CONTINUOUS_PLAY_TYPES)[number];

interface PlaybackState {
  // 是否启用自动播放（下一个选中的视频自动播放）
  shouldAutoPlay: boolean;

  // 设置自动播放标志
  setShouldAutoPlay: (value: boolean) => void;

  // 检查资源类型是否支持连续播放
  isContinuousPlayType: (type: string) => boolean;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  shouldAutoPlay: false,

  setShouldAutoPlay: (value: boolean) => {
    set({ shouldAutoPlay: value });
  },

  isContinuousPlayType: (type: string) => {
    return CONTINUOUS_PLAY_TYPES.includes(type as ContinuousPlayType);
  },
}));

export default usePlaybackStore;
