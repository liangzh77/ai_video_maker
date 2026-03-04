/**
 * 集中式内存密钥/配置管理
 *
 * 加载优先级（后加载的覆盖先加载的）：
 * 1. 内置默认值（default.config，打包在安装包中）
 * 2. .env.local（如果存在，完全覆盖，用于开发/自定义）
 * 3. 云端密钥（登录后合并，只覆盖云端返回的 key）
 */

class KeyStore {
  private keys: Map<string, string> = new Map();
  private defaults: Record<string, string> = {};

  /** 获取值（替代 process.env.XXX） */
  get(name: string): string {
    return this.keys.get(name) || '';
  }

  /** 批量设置（清空后写入，用于初始化默认值或 .env.local 全量覆盖） */
  setAll(entries: Record<string, string>): void {
    this.keys.clear();
    for (const [k, v] of Object.entries(entries)) {
      this.keys.set(k, v);
    }
    // 记住首次加载的默认值，供 reloadDefaults() 使用
    if (Object.keys(this.defaults).length === 0) {
      this.defaults = { ...entries };
    }
    console.log(`[KeyStore] Set ${this.keys.size} entries`);
  }

  /** 合并写入（不清空，只覆盖传入的 key，用于云端密钥叠加） */
  merge(entries: Record<string, string>): void {
    for (const [k, v] of Object.entries(entries)) {
      this.keys.set(k, v);
    }
    console.log(`[KeyStore] Merged ${Object.keys(entries).length} entries, total ${this.keys.size}`);
  }

  /** 恢复到内置默认值（退出登录时调用） */
  reloadDefaults(): void {
    this.keys.clear();
    for (const [k, v] of Object.entries(this.defaults)) {
      this.keys.set(k, v);
    }
    console.log(`[KeyStore] Reset to defaults (${this.keys.size} entries)`);
  }

  /** 清空所有 */
  clear(): void {
    this.keys.clear();
    console.log('[KeyStore] Cleared all');
  }

  /** 是否有 API 密钥（判断是否可以使用 AI 功能） */
  hasKeys(): boolean {
    return this.keys.size > 0;
  }
}

export const keyStore = new KeyStore();
