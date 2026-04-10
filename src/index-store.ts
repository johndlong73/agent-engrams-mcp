import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { parseFrontmatter, type EngramMetadata } from './frontmatter.js';
import { IFileSystem, NodeFileSystem } from './abstractions.js';

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

/** Written into `index.json` for interoperability (e.g. pi-agent-engrams). Not validated on load. */
export const INDEX_JSON_VERSION = 3;

/** Default minimum similarity score for search results (0.0 to 1.0) */
export const DEFAULT_MIN_SEARCH_SCORE = 0.4;

interface IndexEntry {
  relPath: string;
  sourceDir: string;
  mtime: number;
  vector: number[];
  excerpt: string;
  metadata: EngramMetadata;
}

interface IndexData {
  /** Optional when reading legacy or hand-edited files; always set on save. */
  version?: number;
  dimensions: number;
  embeddingModelId: string;
  providerFingerprint: string;
  entries: Record<string, IndexEntry>;
}

export class EngramIndex {
  private entries: Map<string, IndexEntry> = new Map();
  public config: EngramIndexConfig;
  private fileSystem: IFileSystem;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: EngramIndexConfig, fileSystem: IFileSystem = new NodeFileSystem()) {
    this.config = config;
    this.fileSystem = fileSystem;
  }

  size(): number {
    return this.entries.size;
  }

  async load(): Promise<void> {
    if (!this.fileSystem.existsSync(this.config.indexJsonPath)) {
      return;
    }
    try {
      const raw = this.fileSystem.readFileSync(this.config.indexJsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<IndexData>;

      // Strict validation: reject if extra fields exist
      const keys = Object.keys(parsed);
      const allowedKeys = new Set([
        'version',
        'dimensions',
        'embeddingModelId',
        'providerFingerprint',
        'entries',
      ]);
      for (const key of keys) {
        if (!allowedKeys.has(key)) {
          console.warn(`index.json has unknown field '${key}', ignoring`);
          return;
        }
      }

      if (
        typeof parsed.dimensions === 'number' &&
        parsed.dimensions === this.config.dimensions &&
        typeof parsed.embeddingModelId === 'string' &&
        parsed.embeddingModelId === this.config.embeddingModelId &&
        typeof parsed.providerFingerprint === 'string' &&
        parsed.providerFingerprint === this.config.providerFingerprint &&
        parsed.entries &&
        typeof parsed.entries === 'object' &&
        !Array.isArray(parsed.entries)
      ) {
        this.entries = new Map(Object.entries(parsed.entries));
      }
    } catch {
      // Corrupted — start fresh in memory; sync will rebuild embeddings
    }
  }

  private save(): void {
    const dir = path.dirname(this.config.indexJsonPath);
    this.fileSystem.mkdirSync(dir, { recursive: true });
    const data: IndexData = {
      version: INDEX_JSON_VERSION,
      dimensions: this.config.dimensions,
      embeddingModelId: this.config.embeddingModelId,
      providerFingerprint: this.config.providerFingerprint,
      entries: Object.fromEntries(this.entries),
    };
    this.fileSystem.writeFileSync(this.config.indexJsonPath, JSON.stringify(data), 'utf-8');
    this.dirty = false;
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.dirty = true;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) this.save();
    }, 5000);
  }

  async sync(): Promise<{ added: number; updated: number; removed: number }> {
    const allFiles = this.scanAllFiles();
    const currentPaths = new Set(allFiles.map(f => f.absPath));

    let removed = 0;
    for (const absPath of this.entries.keys()) {
      if (!currentPaths.has(absPath)) {
        this.entries.delete(absPath);
        removed++;
      }
    }

    const toEmbed: {
      absPath: string;
      relPath: string;
      sourceDir: string;
      mtime: number;
      content: string;
      metadata: EngramMetadata;
    }[] = [];

    for (const file of allFiles) {
      const existing = this.entries.get(file.absPath);
      if (!existing || existing.mtime < file.mtime) {
        const result = this.readAndParseFile(file.absPath);
        if (result && result.content.trim().length > 20) {
          toEmbed.push({
            absPath: file.absPath,
            relPath: file.relPath,
            sourceDir: file.sourceDir,
            mtime: file.mtime,
            content: result.content,
            metadata: result.metadata,
          });
        }
      }
    }

    let added = 0;
    let updated = 0;

    const BATCH_SIZE = 50;
    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + BATCH_SIZE);
      const texts = batch.map(f => {
        const title = f.relPath.replace(/\.[^.]+$/, '').replace(/\//g, ' > ');
        return `Title: ${title}\n\n${f.content}`;
      });
      const vectors = await this.config.embedder.embedBatch(texts);

      for (let j = 0; j < batch.length; j++) {
        const vector = vectors[j];
        if (!vector?.length) continue;
        const file = batch[j];
        const isNew = !this.entries.has(file.absPath);
        this.entries.set(file.absPath, {
          relPath: file.relPath,
          sourceDir: file.sourceDir,
          mtime: file.mtime,
          vector,
          excerpt: file.content.slice(0, EXCERPT_LENGTH),
          metadata: file.metadata,
        });
        if (isNew) added++;
        else updated++;
      }
    }

    if (added + updated + removed > 0) {
      this.save();
    }

    return { added, updated, removed };
  }

  async rebuild(): Promise<void> {
    this.entries.clear();
    await this.sync();
  }

  async search(query: string, limit: number, filters?: SearchFilters): Promise<SearchResult[]> {
    const queryVector = await this.config.embedder.embed(query);
    const minScore = this.config.minSearchScore ?? DEFAULT_MIN_SEARCH_SCORE;

    const scored: { absPath: string; score: number }[] = [];
    for (const [absPath, entry] of this.entries.entries()) {
      if (!entry.vector?.length) continue;
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
    if (!this.fileSystem.existsSync(absPath)) {
      this.removeFile(absPath);
      return;
    }

    const relPath = path.relative(sourceDir, absPath);
    if (this.shouldSkip(relPath, path.basename(absPath))) return;

    const stat = this.fileSystem.statSync(absPath);
    const result = this.readAndParseFile(absPath);
    if (!result || result.content.trim().length <= 20) {
      this.removeFile(absPath);
      return;
    }

    const title = relPath.replace(/\.[^.]+$/, '').replace(/\//g, ' > ');
    const text = `Title: ${title}\n\n${result.content}`;
    const vector = await this.config.embedder.embed(text);

    if (!vector?.length) return;

    this.entries.set(absPath, {
      relPath,
      sourceDir,
      mtime: stat.mtimeMs,
      vector,
      excerpt: result.content.slice(0, EXCERPT_LENGTH),
      metadata: result.metadata,
    });
    this.scheduleSave();
  }

  removeFile(absPath: string): void {
    if (this.entries.delete(absPath)) {
      this.scheduleSave();
    }
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
    let dirents: Dirent[];
    try {
      dirents = this.fileSystem.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirents) {
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
          const stat = this.fileSystem.statSync(absPath);
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
      const raw = this.fileSystem.readFileSync(absPath, 'utf-8');
      const { metadata } = parseFrontmatter(raw);
      return { content: raw, metadata };
    } catch {
      return null;
    }
  }
}

export interface EngramIndexConfig {
  /** Absolute path to the docs directory (markdown engrams) */
  dir: string;
  /** Absolute path to persisted vector index: `<store root>/index.json` (pi-agent-engrams compatible) */
  indexJsonPath: string;
  /** Embedding vector size; must match index.json when loading */
  dimensions: number;
  /** Resolved embedding model ID */
  embeddingModelId: string;
  /** Provider fingerprint for identity validation */
  providerFingerprint: string;
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
