import { create } from 'zustand';
import type { SplitPoint, SplitConfig, AnalyzeResult, OperationResult } from '@shared/types';

// ============================================
// Types
// ============================================

interface SplitPointsState {
  // State
  draftId: string | null;
  videoId: string | null;
  splitPoints: SplitPoint[];
  selectedPointId: string | null;
  isAnalyzing: boolean;
  analyzeProgress: number;
  videoDuration: number;
  videoFps: number;
  error: string | null;

  // Actions
  analyze: (draftId: string, videoId: string, config?: Partial<SplitConfig>) => Promise<boolean>;
  loadSplitPoints: (draftId: string, videoId: string) => Promise<boolean>;
  saveSplitPoints: () => Promise<void>;
  addPoint: (time: number) => void;
  removePoint: (id: string) => void;
  selectPoint: (id: string | null) => void;
  clearPoints: () => void;
  setVideoInfo: (duration: number, fps: number) => void;

  // Computed
  getSortedPoints: () => SplitPoint[];
  getSelectedPoint: () => SplitPoint | null;
}

// ============================================
// Store Implementation
// ============================================

export const useSplitPointsStore = create<SplitPointsState>((set, get) => ({
  // Initial State
  draftId: null,
  videoId: null,
  splitPoints: [],
  selectedPointId: null,
  isAnalyzing: false,
  analyzeProgress: 0,
  videoDuration: 0,
  videoFps: 30,
  error: null,

  // Analyze video to detect split points
  analyze: async (draftId: string, videoId: string, config?: Partial<SplitConfig>) => {
    set({
      isAnalyzing: true,
      analyzeProgress: 0,
      draftId,
      videoId,
      error: null,
      splitPoints: [],
      selectedPointId: null,
    });

    try {
      const result: OperationResult<AnalyzeResult> = await window.api.task.analyzeVideo({
        draftId,
        sourceVideoId: videoId,
        config,
      });

      if (result.success && result.data) {
        set({
          splitPoints: result.data.splitPoints,
          videoDuration: result.data.duration,
          videoFps: result.data.fps,
          isAnalyzing: false,
          analyzeProgress: 100,
        });

        // Auto-save split points after analysis
        await get().saveSplitPoints();

        return true;
      } else {
        set({
          error: result.error || 'Failed to analyze video',
          isAnalyzing: false,
        });
        return false;
      }
    } catch (err) {
      set({
        error: (err as Error).message,
        isAnalyzing: false,
      });
      return false;
    }
  },

  // Load split points from file
  loadSplitPoints: async (draftId: string, videoId: string) => {
    try {
      const result = await window.api.resource.loadSplitPoints({ draftId, videoId });

      if (result.success && result.data) {
        set({
          draftId,
          videoId,
          splitPoints: result.data.splitPoints,
          videoDuration: result.data.duration,
          videoFps: result.data.fps,
          selectedPointId: null,
          error: null,
        });
        console.log('[SplitPointsStore] Loaded split points:', result.data.splitPoints.length);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[SplitPointsStore] Failed to load split points:', err);
      return false;
    }
  },

  // Save split points to file
  saveSplitPoints: async () => {
    const { draftId, videoId, splitPoints, videoDuration, videoFps } = get();

    if (!draftId || !videoId) {
      console.warn('[SplitPointsStore] Cannot save: missing draftId or videoId');
      return;
    }

    try {
      await window.api.resource.saveSplitPoints({
        draftId,
        videoId,
        duration: videoDuration,
        fps: videoFps,
        splitPoints,
      });
      console.log('[SplitPointsStore] Saved split points:', splitPoints.length);
    } catch (err) {
      console.error('[SplitPointsStore] Failed to save split points:', err);
    }
  },

  // Add a new split point at current time
  addPoint: (time: number) => {
    const { videoFps, splitPoints } = get();
    const frame = Math.round(time * videoFps);

    // Check if a point already exists at this time (within 0.1s tolerance)
    const existingPoint = splitPoints.find(
      (p) => Math.abs(p.time - time) < 0.1
    );
    if (existingPoint) {
      return; // Don't add duplicate
    }

    const newPoint: SplitPoint = {
      id: `point-manual-${Date.now()}`,
      time,
      frame,
      isAutoDetected: false,
    };

    set((state) => ({
      splitPoints: [...state.splitPoints, newPoint].sort((a, b) => a.time - b.time),
      selectedPointId: newPoint.id,
    }));

    // Auto-save after adding
    get().saveSplitPoints();
  },

  // Remove a split point
  removePoint: (id: string) => {
    set((state) => ({
      splitPoints: state.splitPoints.filter((p) => p.id !== id),
      selectedPointId: state.selectedPointId === id ? null : state.selectedPointId,
    }));

    // Auto-save after removing
    get().saveSplitPoints();
  },

  // Select a split point
  selectPoint: (id: string | null) => {
    set({ selectedPointId: id });
  },

  // Clear all split points
  clearPoints: () => {
    set({
      splitPoints: [],
      selectedPointId: null,
      videoId: null,
      draftId: null,
      analyzeProgress: 0,
    });
  },

  // Set video info (called when video loads)
  setVideoInfo: (duration: number, fps: number) => {
    set({ videoDuration: duration, videoFps: fps });
  },

  // Get sorted split points
  getSortedPoints: () => {
    return get().splitPoints.sort((a, b) => a.time - b.time);
  },

  // Get selected point
  getSelectedPoint: () => {
    const { splitPoints, selectedPointId } = get();
    return splitPoints.find((p) => p.id === selectedPointId) || null;
  },
}));

export default useSplitPointsStore;
