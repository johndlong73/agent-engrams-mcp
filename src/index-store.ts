import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseFrontmatter, type EngramMetadata } from './frontmatter.js';

export interface SearchFilters {
  category?: string;
  agent?: string;
  durability?: string;
  tags?: string[];
  scope?: string;
}

export interface SearchResult {
  path: string;
  score: number;
  excerpt: string;
  metadata: EngramMetadata;
}

const EXCERPT_LENGTH = 2000;

/** Default minimum similarity score for search results (0.0 to 1.0) */
export const DEFAULT_MIN_SEARCH_SCORE = 0.40;

export class EngramIndex {
  private entries: Map<string, IndexEntry> = new Map();
  private config: EngramIndexConfig;

  constructor(config: EngramIndexConfig) {
    this.config = config;
  }

  size(): number {
    return this.entries.size;
  }

  async load(): Promise<void> {
    // For MCP server, we'll load on demand from the file system
    // This is a simplified version - in production you might cache
  }

  async sync(): Promise<{ added: number; updated: number; removed: number }> {
    const allFiles = this.scanAllFiles();
    const currentPaths = new Set(allFiles.map(f => f.absPath));

    let added = 0;
    let updated = 0;
    let removed = 0;

    // Remove files that no longer exist
    for (const absPath of this.entries.keys()) {
      if (!currentPaths.has(absPath)) {
        this.entries.delete(absPath);
        removed++;
      }
    }

    // Add/update existing files
    for (const file of allFiles) {
      const existing = this.entries.get(file.absPath);
      const shouldUpdate = !existing || existing.mtime < file.mtime;

      if (shouldUpdate) {
        const result = this.readAndParseFile(file.absPath);
        if (result && result.content.trim().length > 20) {
          const title = file.relPath.replace(/\.[^.]+$/, '').replace(/\//g, ' > ');
          const text = `Title: ${title}\n\n${result.content}`;
          const vector = await this.config.embedder.embed(text);

          if (vector) {
            this.entries.set(file.absPath, {
              relPath: file.relPath,
              sourceDir: file.sourceDir,
              mtime: file.mtime,
              vector,
              excerpt: result.content.slice(0, EXCERPT_LENGTH),
              metadata: result.metadata,
            });
            if (existing) {
              updated++;
            } else {
              added++;
            }
          }
        }
      }
    }

    return { added, updated, removed };
  }

  async rebuild(): Promise<void> {
    this.entries.clear();
    await this.sync();
  }

  async search(
    query: string,
    limit: number,
    filters?: SearchFilters
  ): Promise<SearchResult[]> {
    const queryVector = await this.config.embedder.embed(query);
    const minScore = this.config.minSearchScore ?? DEFAULT_MIN_SEARCH_SCORE;

    const scored: { absPath: string; score: number }[] = [];
    for (const [absPath, entry] of this.entries.entries()) {
      if (!entry.vector) continue;
      if (filters && !matchesFilters(entry.metadata, filters)) continue;
      let score = dotProduct(queryVector, entry.vector);

      if (entry.metadata.scope === 'project' && filters?.scope !== 'project') {
        score *= 0.75;
      }

      scored.push({ absPath, score });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored
      .filter(s => s.score > minScore)
      .slice(0, limit)
      .map(s => ({
        path: s.absPath,
        score: s.score,
        excerpt: this.entries.get(s.absPath)!.excerpt,
        metadata: this.entries.get(s.absPath)!.metadata,
      }));
  }

  async updateFile(absPath: string, sourceDir: string): Promise<void> {
    if (!fs.existsSync(absPath)) {
      this.removeFile(absPath);
      return;
    }

    const relPath = path.relative(sourceDir, absPath);
    if (this.shouldSkip(relPath, path.basename(absPath))) return;

    const stat = fs.statSync(absPath);
    const result = this.readAndParseFile(absPath);
    if (!result || result.content.trim().length <= 20) {
      this.removeFile(absPath);
      return;
    }

    const title = relPath.replace(/\.[^.]+$/, '').replace(/\//g, ' > ');
    const text = `Title: ${title}\n\n${result.content}`;
    const vector = await this.config.embedder.embed(text);

    if (!vector) return;

    this.entries.set(absPath, {
      relPath,
      sourceDir,
      mtime: stat.mtimeMs,
      vector,
      excerpt: result.content.slice(0, EXCERPT_LENGTH),
      metadata: result.metadata,
    });
  }

  removeFile(absPath: string): void {
    this.entries.delete(absPath);
  }

  // -----------------------------------------------------------------------
  // Scanning
  // -----------------------------------------------------------------------

  private scanAllFiles(): {
    absPath: string;
    relPath: string;
    sourceDir: string;
    mtime: number;
  }[] {
    const results: {
      absPath: string;
      relPath: string;
      sourceDir: string;
      mtime: number;
    }[] = [];

    this.walkDir(this.config.dir, this.config.dir, results);
    return results;
  }

  private walkDir(
    currentDir: string,
    sourceDir: string,
    results: {
      absPath: string;
      relPath: string;
      sourceDir: string;
      mtime: number;
    }[]
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) {
          continue;
        }
        this.walkDir(absPath, sourceDir, results);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (ext !== '.md') continue;
        const relPath = path.relative(sourceDir, absPath);
        if (this.shouldSkip(relPath, entry.name)) continue;
        try {
          const stat = fs.statSync(absPath);
          results.push({ absPath, relPath, sourceDir, mtime: stat.mtimeMs });
        } catch {
          // Skip unreadable
        }
      }
    }
  }

  private shouldSkip(relPath: string, _basename: string): boolean {
    const parts = relPath.split(path.sep);
    for (const part of parts) {
      if (part.startsWith('.')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Read a file and parse its frontmatter. Returns the full raw content
   * (frontmatter included) for embedding, plus the parsed metadata.
   */
  private readAndParseFile(absPath: string): { content: string; metadata: EngramMetadata } | null {
    try {
      const raw = fs.readFileSync(absPath, 'utf-8');
      const { metadata } = parseFrontmatter(raw);
      return { content: raw, metadata };
    } catch {
      return null;
    }
  }
}

interface IndexEntry {
  relPath: string;
  sourceDir: string;
  mtime: number;
  vector: number[];
  excerpt: string;
  metadata: EngramMetadata;
}

export interface EngramIndexConfig {
  dir: string;
  embedder: Embedder;
  minSearchScore?: number;
}

export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

function matchesFilters(metadata: EngramMetadata, filters: SearchFilters): boolean {
  if (filters.category && metadata.category !== filters.category) return false;
  if (filters.agent && metadata.agent !== filters.agent) return false;
  if (filters.durability && metadata.durability !== filters.durability) return false;
  if (filters.scope && metadata.scope !== filters.scope) return false;
  if (filters.tags && filters.tags.length > 0) {
    const entryTags = new Set(metadata.tags ?? []);
    const hasAny = filters.tags.some(t => entryTags.has(t));
    if (!hasAny) return false;
  }
  return true;
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}