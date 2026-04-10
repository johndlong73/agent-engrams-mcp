import { EngramIndex, type EngramIndexConfig } from './index-store.js';
import { createEmbedder, type EmbedderConfig } from './embedder.js';
import { IFileSystem, IHttpFetch } from './abstractions.js';
import { buildEmbeddingIndexIdentity } from './index-identity.js';

// Re-export for tests
export { buildEmbeddingIndexIdentity } from './index-identity.js';

/**
 * Mock file system implementation for testing
 * Stores files in memory using a Map
 */
export class MockFileSystem implements IFileSystem {
  private files: Map<string, string> = new Map();
  private dirs: Set<string> = new Set();
  private stats: Map<string, { mtimeMs: number }> = new Map();

  readFileSync(path: string, encoding: string): string {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  writeFileSync(path: string, data: string, encoding: string): void {
    this.files.set(path, data);
    // Ensure parent directory exists
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash > 0) {
      const dir = path.substring(0, lastSlash);
      this.dirs.add(dir);
    }
  }

  mkdirSync(dir: string, options: { recursive: boolean }): void {
    // Normalize the path - remove trailing slash if present
    const normalizedDir = dir.replace(/\/$/, '');

    if (options.recursive) {
      // Create all parent directories
      const parts = normalizedDir.split('/').filter(p => p.length > 0);
      let current = '';
      for (const part of parts) {
        current += '/' + part;
        this.dirs.add(current);
      }
    } else {
      this.dirs.add(normalizedDir);
    }
  }

  existsSync(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  statSync(path: string): { mtimeMs: number } {
    if (this.stats.has(path)) {
      return this.stats.get(path)!;
    }
    // Default stat for testing
    return { mtimeMs: Date.now() };
  }

  readdirSync(dir: string, options: { withFileTypes: boolean }): any[] {
    const results: any[] = [];
    const prefix = dir.endsWith('/') ? dir : dir + '/';

    for (const dirName of this.dirs) {
      if (dirName.startsWith(prefix) && dirName !== dir) {
        const rel = dirName.substring(prefix.length);
        if (!rel.includes('/')) {
          results.push({
            name: rel,
            isDirectory: () => true,
            isFile: () => false,
          });
        }
      }
    }

    for (const [filePath] of this.files) {
      if (filePath.startsWith(prefix)) {
        const rel = filePath.substring(prefix.length);
        if (!rel.includes('/')) {
          results.push({
            name: rel,
            isDirectory: () => false,
            isFile: () => true,
          });
        }
      }
    }

    return results;
  }

  /**
   * Add a file to the mock file system
   */
  addFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  /**
   * Get all files in the mock file system
   */
  getAllFiles(): Map<string, string> {
    return this.files;
  }

  /**
   * Clear all files and directories
   */
  clear(): void {
    this.files.clear();
    this.dirs.clear();
    this.stats.clear();
  }
}

/**
 * Mock HTTP fetch implementation for testing
 */
export function createMockHttpFetch(): MockHttpFetch {
  const responses: Map<string, Response> = new Map();
  const calls: Array<{ url: string; options: RequestInit }> = [];

  const mockFetch: MockHttpFetch = async (url: string, options: RequestInit): Promise<Response> => {
    calls.push({ url, options });

    const response = responses.get(url);
    if (response) {
      return response;
    }

    // Default mock response
    return new Response(
      JSON.stringify({
        data: [{ embedding: new Array(512).fill(0.1) }],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  };

  mockFetch.setResponse = (url: string, response: Response) => {
    responses.set(url, response);
  };

  mockFetch.getCalls = () => calls;

  mockFetch.clear = () => {
    calls.length = 0;
    responses.clear();
  };

  return mockFetch;
}

// Add methods to the function for testing
export interface MockHttpFetch extends IHttpFetch {
  setResponse(url: string, response: Response): void;
  getCalls(): Array<{ url: string; options: RequestInit }>;
  clear(): void;
}

/**
 * Mock embedder for testing
 */
export class MockEmbedder {
  private dimensions: number;

  constructor(dimensions: number = 512) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    return new Array(this.dimensions).fill(0.1);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(this.dimensions).fill(0.1));
  }
}

/**
 * Create a test configuration object
 */
export function createTestConfig(): {
  root: string;
  docsDir: string;
  indexDir: string;
  dimensions: number;
  provider: any;
  minSearchScore?: number;
} {
  return {
    root: '/test/root',
    docsDir: '/test/root/docs',
    indexDir: '/test/root/index',
    dimensions: 512,
    provider: { type: 'openai', model: 'test-model', baseUrl: 'http://test' },
    minSearchScore: 0.4,
  };
}

/**
 * Create a test EngramIndex with mock dependencies
 */
export function createTestEngramIndex(
  fileSystem?: IFileSystem,
  dimensions: number = 512
): EngramIndex {
  const fs = fileSystem || new MockFileSystem();
  const embedder = new MockEmbedder(dimensions);

  // Create a mock config to compute identity
  const mockConfig = {
    root: '/test/root',
    docsDir: '/test/root/docs',
    indexDir: '/test/root/index',
    dimensions,
    provider: { type: 'openai' as const, model: 'test-model', baseUrl: 'http://test' },
  };
  const identity = buildEmbeddingIndexIdentity(mockConfig);

  return new EngramIndex({
    dir: '/test/root/docs',
    indexJsonPath: '/test/root/index.json',
    dimensions,
    embeddingModelId: identity.embeddingModelId,
    providerFingerprint: identity.providerFingerprint,
    embedder: embedder as any,
    minSearchScore: 0.4,
  });
}

/**
 * Reset test state between tests
 */
export function resetTestState(): void {
  // Clear any global state if needed
  // Currently no global state in the refactored code
}
