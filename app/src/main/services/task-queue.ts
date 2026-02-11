import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { ProcessingTask, TaskType, TaskConfig, TaskStatus } from '@shared/types';

// ============================================
// Types
// ============================================

export type TaskHandler = (
  task: ProcessingTask,
  onProgress: (progress: number) => void
) => Promise<string[]>; // Returns output resource IDs

export interface TaskProgressEvent {
  taskId: string;
  progress: number;
  status: TaskStatus;
  error?: string;
}

export interface TaskCompletedEvent {
  taskId: string;
  outputResourceIds: string[];
}

// ============================================
// Task Queue Implementation
// ============================================

class TaskQueue extends EventEmitter {
  private queue: ProcessingTask[] = [];
  private currentTask: ProcessingTask | null = null;
  private handlers: Map<TaskType, TaskHandler> = new Map();
  private updateCallback?: (task: ProcessingTask) => Promise<void>;

  /**
   * Register a handler for a specific task type
   */
  registerHandler(type: TaskType, handler: TaskHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Set a callback for persisting task updates
   */
  setUpdateCallback(callback: (task: ProcessingTask) => Promise<void>): void {
    this.updateCallback = callback;
  }

  /**
   * Add a new task to the queue
   */
  addTask(
    draftId: string,
    type: TaskType,
    inputResourceIds: string[],
    config: TaskConfig,
    targetSectionId?: string
  ): ProcessingTask {
    const task: ProcessingTask = {
      id: uuidv4(),
      draftId,
      type,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
      inputResourceIds,
      outputResourceIds: [],
      targetSectionId,
      config,
    };

    this.queue.push(task);
    this.processNext();

    return task;
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): ProcessingTask | null {
    if (this.currentTask?.id === taskId) {
      return this.currentTask;
    }
    return this.queue.find((t) => t.id === taskId) || null;
  }

  /**
   * Get all pending tasks
   */
  getPendingTasks(): ProcessingTask[] {
    return [...this.queue];
  }

  /**
   * Get current processing task
   */
  getCurrentTask(): ProcessingTask | null {
    return this.currentTask;
  }

  /**
   * Cancel a pending task
   */
  cancelTask(taskId: string): boolean {
    const index = this.queue.findIndex((t) => t.id === taskId);
    if (index === -1) return false;

    const [task] = this.queue.splice(index, 1);
    task.status = 'failed';
    task.error = 'Cancelled by user';
    this.emitProgress(task);

    return true;
  }

  /**
   * Process the next task in the queue
   */
  private async processNext(): Promise<void> {
    if (this.currentTask || this.queue.length === 0) {
      return;
    }

    this.currentTask = this.queue.shift()!;
    this.currentTask.status = 'processing';
    this.currentTask.startedAt = new Date().toISOString();

    this.emitProgress(this.currentTask);
    await this.persistTask(this.currentTask);

    const handler = this.handlers.get(this.currentTask.type);
    if (!handler) {
      this.currentTask.status = 'failed';
      this.currentTask.error = `No handler registered for task type: ${this.currentTask.type}`;
      this.emitProgress(this.currentTask);
      await this.persistTask(this.currentTask);
      this.currentTask = null;
      this.processNext();
      return;
    }

    try {
      const outputResourceIds = await handler(this.currentTask, (progress) => {
        if (this.currentTask) {
          this.currentTask.progress = progress;
          this.emitProgress(this.currentTask);
        }
      });

      this.currentTask.status = 'completed';
      this.currentTask.progress = 100;
      this.currentTask.completedAt = new Date().toISOString();
      this.currentTask.outputResourceIds = outputResourceIds;

      this.emitProgress(this.currentTask);
      this.emitCompleted(this.currentTask);
    } catch (error) {
      this.currentTask.status = 'failed';
      this.currentTask.completedAt = new Date().toISOString();
      this.currentTask.error = error instanceof Error ? error.message : String(error);

      this.emitProgress(this.currentTask);
    }

    await this.persistTask(this.currentTask);
    this.currentTask = null;
    this.processNext();
  }

  /**
   * Emit progress event
   */
  private emitProgress(task: ProcessingTask): void {
    const event: TaskProgressEvent = {
      taskId: task.id,
      progress: task.progress,
      status: task.status,
      error: task.error,
    };
    this.emit('progress', event);
  }

  /**
   * Emit completed event
   */
  private emitCompleted(task: ProcessingTask): void {
    const event: TaskCompletedEvent = {
      taskId: task.id,
      outputResourceIds: task.outputResourceIds,
    };
    this.emit('completed', event);
  }

  /**
   * Persist task to storage
   */
  private async persistTask(task: ProcessingTask): Promise<void> {
    if (this.updateCallback) {
      await this.updateCallback(task);
    }
  }
}

// ============================================
// Singleton Instance
// ============================================

export const taskQueue = new TaskQueue();

export default taskQueue;
