import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Draft, Resource, ResourceType, ProcessingTask } from '@shared/types';

// ============================================
// Storage Paths
// ============================================

function getStorageRoot(): string {
  // Use app data directory in production, local directory in development
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'storage');
  }
  return path.join(process.cwd(), 'storage');
}

function getDraftPath(draftId: string): string {
  return path.join(getStorageRoot(), draftId);
}

function getMetaPath(draftId: string): string {
  return path.join(getDraftPath(draftId), 'meta.json');
}

function getResourcesPath(draftId: string): string {
  return path.join(getDraftPath(draftId), 'resources.json');
}

function getTasksPath(draftId: string): string {
  return path.join(getDraftPath(draftId), 'tasks.json');
}

function getThumbnailsPath(draftId: string): string {
  return path.join(getDraftPath(draftId), 'thumbnails');
}

function getFilesPath(draftId: string): string {
  return path.join(getDraftPath(draftId), 'files');
}

// ============================================
// JSON Read/Write Utilities
// ============================================

async function readJson<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return defaultValue;
  }
}

async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================
// Storage Initialization
// ============================================

export async function initStorage(): Promise<void> {
  const storageRoot = getStorageRoot();
  await fs.mkdir(storageRoot, { recursive: true });
}

// ============================================
// Draft CRUD Operations
// ============================================

export async function listDrafts(): Promise<Draft[]> {
  const storageRoot = getStorageRoot();

  try {
    const entries = await fs.readdir(storageRoot, { withFileTypes: true });
    const drafts: Draft[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metaPath = getMetaPath(entry.name);
        try {
          const meta = await readJson<Draft>(metaPath, null as unknown as Draft);
          if (meta) {
            drafts.push(meta);
          }
        } catch {
          // Skip invalid draft directories
        }
      }
    }

    // Sort by updatedAt descending
    drafts.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return drafts;
  } catch {
    return [];
  }
}

export async function getDraft(id: string): Promise<Draft | null> {
  const metaPath = getMetaPath(id);
  return readJson<Draft | null>(metaPath, null);
}

export async function createDraft(name: string): Promise<Draft> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const draft: Draft = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    storagePath: id,
  };

  const draftPath = getDraftPath(id);
  await fs.mkdir(draftPath, { recursive: true });
  await fs.mkdir(getThumbnailsPath(id), { recursive: true });
  await fs.mkdir(getFilesPath(id), { recursive: true });

  await writeJson(getMetaPath(id), draft);
  await writeJson(getResourcesPath(id), { resources: [] });
  await writeJson(getTasksPath(id), { tasks: [] });

  return draft;
}

export async function updateDraft(id: string, updates: Partial<Draft>): Promise<Draft | null> {
  const draft = await getDraft(id);
  if (!draft) return null;

  const updatedDraft: Draft = {
    ...draft,
    ...updates,
    id, // Ensure ID cannot be changed
    updatedAt: new Date().toISOString(),
  };

  await writeJson(getMetaPath(id), updatedDraft);
  return updatedDraft;
}

export async function deleteDraft(id: string): Promise<boolean> {
  const draftPath = getDraftPath(id);

  try {
    await fs.rm(draftPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Resource CRUD Operations
// ============================================

interface ResourcesFile {
  resources: Resource[];
}

export async function listResources(draftId: string, type?: ResourceType): Promise<Resource[]> {
  const resourcesPath = getResourcesPath(draftId);
  const data = await readJson<ResourcesFile>(resourcesPath, { resources: [] });

  if (type) {
    return data.resources.filter((r) => r.type === type);
  }
  return data.resources;
}

export async function getResource(draftId: string, resourceId: string): Promise<Resource | null> {
  const resources = await listResources(draftId);
  return resources.find((r) => r.id === resourceId) || null;
}

export async function addResource(draftId: string, resource: Omit<Resource, 'id' | 'draftId' | 'createdAt'>): Promise<Resource> {
  const resourcesPath = getResourcesPath(draftId);
  const data = await readJson<ResourcesFile>(resourcesPath, { resources: [] });

  const newResource: Resource = {
    ...resource,
    id: uuidv4(),
    draftId,
    createdAt: new Date().toISOString(),
  };

  data.resources.push(newResource);
  await writeJson(resourcesPath, data);

  // Update draft's updatedAt
  await updateDraft(draftId, {});

  return newResource;
}

export async function updateResource(
  draftId: string,
  resourceId: string,
  updates: Partial<Resource>
): Promise<Resource | null> {
  const resourcesPath = getResourcesPath(draftId);
  const data = await readJson<ResourcesFile>(resourcesPath, { resources: [] });

  const index = data.resources.findIndex((r) => r.id === resourceId);
  if (index === -1) return null;

  data.resources[index] = {
    ...data.resources[index],
    ...updates,
    id: resourceId, // Ensure ID cannot be changed
    draftId, // Ensure draftId cannot be changed
  };

  await writeJson(resourcesPath, data);
  await updateDraft(draftId, {});

  return data.resources[index];
}

export async function deleteResource(draftId: string, resourceId: string): Promise<boolean> {
  const resourcesPath = getResourcesPath(draftId);
  const data = await readJson<ResourcesFile>(resourcesPath, { resources: [] });

  const index = data.resources.findIndex((r) => r.id === resourceId);
  if (index === -1) return false;

  data.resources.splice(index, 1);
  await writeJson(resourcesPath, data);
  await updateDraft(draftId, {});

  return true;
}

// ============================================
// Split Points Storage
// ============================================

function getSplitPointsPath(draftId: string, videoId: string): string {
  return path.join(getDraftPath(draftId), `split_points_${videoId}.json`);
}

interface SplitPointsFile {
  videoId: string;
  duration: number;
  fps: number;
  splitPoints: Array<{
    id: string;
    time: number;
    frame: number;
    isAutoDetected: boolean;
  }>;
  savedAt: string;
}

export async function saveSplitPoints(
  draftId: string,
  videoId: string,
  data: Omit<SplitPointsFile, 'savedAt'>
): Promise<void> {
  const filePath = getSplitPointsPath(draftId, videoId);
  await writeJson(filePath, {
    ...data,
    savedAt: new Date().toISOString(),
  });
}

export async function loadSplitPoints(
  draftId: string,
  videoId: string
): Promise<SplitPointsFile | null> {
  const filePath = getSplitPointsPath(draftId, videoId);
  return readJson<SplitPointsFile | null>(filePath, null);
}

export async function deleteSplitPoints(draftId: string, videoId: string): Promise<boolean> {
  const filePath = getSplitPointsPath(draftId, videoId);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Task CRUD Operations
// ============================================

interface TasksFile {
  tasks: ProcessingTask[];
}

export async function listTasks(draftId: string): Promise<ProcessingTask[]> {
  const tasksPath = getTasksPath(draftId);
  const data = await readJson<TasksFile>(tasksPath, { tasks: [] });
  return data.tasks;
}

export async function getTask(draftId: string, taskId: string): Promise<ProcessingTask | null> {
  const tasks = await listTasks(draftId);
  return tasks.find((t) => t.id === taskId) || null;
}

export async function addTask(draftId: string, task: Omit<ProcessingTask, 'id' | 'draftId' | 'createdAt'>): Promise<ProcessingTask> {
  const tasksPath = getTasksPath(draftId);
  const data = await readJson<TasksFile>(tasksPath, { tasks: [] });

  const newTask: ProcessingTask = {
    ...task,
    id: uuidv4(),
    draftId,
    createdAt: new Date().toISOString(),
  };

  data.tasks.push(newTask);
  await writeJson(tasksPath, data);

  return newTask;
}

export async function updateTask(
  draftId: string,
  taskId: string,
  updates: Partial<ProcessingTask>
): Promise<ProcessingTask | null> {
  const tasksPath = getTasksPath(draftId);
  const data = await readJson<TasksFile>(tasksPath, { tasks: [] });

  const index = data.tasks.findIndex((t) => t.id === taskId);
  if (index === -1) return null;

  data.tasks[index] = {
    ...data.tasks[index],
    ...updates,
    id: taskId,
    draftId,
  };

  await writeJson(tasksPath, data);
  return data.tasks[index];
}

// ============================================
// Exports
// ============================================

export const storage = {
  init: initStorage,
  getStorageRoot,
  getDraftPath,
  getThumbnailsPath,
  getFilesPath,
  draft: {
    list: listDrafts,
    get: getDraft,
    create: createDraft,
    update: updateDraft,
    delete: deleteDraft,
  },
  resource: {
    list: listResources,
    get: getResource,
    add: addResource,
    update: updateResource,
    delete: deleteResource,
  },
  task: {
    list: listTasks,
    get: getTask,
    add: addTask,
    update: updateTask,
  },
  splitPoints: {
    save: saveSplitPoints,
    load: loadSplitPoints,
    delete: deleteSplitPoints,
  },
};

export default storage;
