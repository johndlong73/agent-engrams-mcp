import { EngramIndex, type EngramIndexConfig } from './index-store.js';
import { createEmbedder, type EmbedderConfig } from './embedder.js';
import { IFileSystem, NodeFileSystem } from './abstractions.js';

/**
 * Service class for managing engram operations
 * Wraps EngramIndex and provides higher-level operations
 */
export class EngramService {
  private index: EngramIndex;
  private fileSystem: IFileSystem;

  constructor(config: EngramIndexConfig, fileSystem: IFileSystem = new NodeFileSystem()) {
    this.index = new EngramIndex(config, fileSystem);
    this.fileSystem = fileSystem;
  }

  /**
   * Load the index from disk
   */
  async load(): Promise<void> {
    await this.index.load();
  }

  /**
   * Sync the index with files on disk
   */
  async sync(): Promise<{ added: number; updated: number; removed: number }> {
    return this.index.sync();
  }

  /**
   * Rebuild the index from scratch
   */
  async rebuild(): Promise<void> {
    await this.index.rebuild();
  }

  /**
   * Search the index
   */
  async search(
    query: string,
    limit: number,
    filters?: Record<string, unknown>
  ): Promise<unknown[]> {
    return this.index.search(query, limit, filters as any);
  }

  /**
   * Update a single file in the index
   */
  async updateFile(absPath: string, sourceDir: string): Promise<void> {
    await this.index.updateFile(absPath, sourceDir);
  }

  /**
   * Remove a file from the index
   */
  removeFile(absPath: string): void {
    this.index.removeFile(absPath);
  }

  /**
   * Get the size of the index
   */
  size(): number {
    return this.index.size();
  }

  /**
   * Get the directory being indexed
   */
  getDir(): string {
    return this.index.config.dir;
  }
}
