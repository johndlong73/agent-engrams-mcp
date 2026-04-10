import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EngramIndex } from '../index-store.js';
import { MockFileSystem, MockEmbedder, buildEmbeddingIndexIdentity } from '../test-helpers.js';

describe('EngramIndex', () => {
  let fileSystem: MockFileSystem;
  let index: EngramIndex;

  beforeEach(() => {
    fileSystem = new MockFileSystem();
    const embedder = new MockEmbedder(512);

    // Create identity for test config
    const mockConfig = {
      root: '/test/root',
      docsDir: '/test/root/docs',
      indexDir: '/test/root/index',
      dimensions: 512,
      provider: { type: 'openai' as const, model: 'test-model', baseUrl: 'http://test' },
    };
    const identity = buildEmbeddingIndexIdentity(mockConfig);

    index = new EngramIndex(
      {
        dir: '/test/root/docs',
        indexJsonPath: '/test/root/index.json',
        dimensions: 512,
        embeddingModelId: identity.embeddingModelId,
        providerFingerprint: identity.providerFingerprint,
        embedder: embedder as any,
        minSearchScore: 0.4,
      },
      fileSystem
    );
  });

  afterEach(() => {
    fileSystem.clear();
  });

  it('should initialize with empty index', () => {
    expect(index.size()).toBe(0);
  });

  it('ignores index.json when dimensions do not match config', async () => {
    fileSystem.addFile(
      '/test/root/index.json',
      JSON.stringify({
        version: 3,
        dimensions: 768,
        entries: {
          '/test/root/docs/wrong.md': {
            vector: [],
            relPath: 'x',
            sourceDir: '/test/root/docs',
            mtime: 1,
            excerpt: '',
            metadata: {},
          },
        },
      })
    );
    await index.load();
    expect(index.size()).toBe(0);
  });

  it('writes index.json after sync (pi-agent-engrams compatible shape)', async () => {
    fileSystem.addFile(
      '/test/root/docs/persist.md',
      `---
Category: testing
Tags: persist
Durability: permanent
Scope: universal
Agent: system
Date: 2024-01-01
Source: Test
---

# Persist

Body content for embedding minimum length requirement here.
`
    );
    await index.sync();
    expect(fileSystem.existsSync('/test/root/index.json')).toBe(true);
    const raw = fileSystem.readFileSync('/test/root/index.json', 'utf-8');
    const data = JSON.parse(raw) as { dimensions: number; entries: Record<string, unknown> };
    expect(data.dimensions).toBe(512);
    expect(Object.keys(data.entries).length).toBe(1);
  });

  it('should sync files from mock file system', async () => {
    // Add a test file
    fileSystem.addFile(
      '/test/root/docs/test.md',
      `---
Category: testing
Tags: unit, mock
Durability: permanent
Scope: universal
Agent: system
Date: 2024-01-01
Source: Test
---

# Test Engram

## Context

This is a test.

## Insight

Testing works.

## Application

**Trigger:** When testing
**Anti-trigger:** When not testing

## Supersedes

None
`
    );

    await index.sync();
    expect(index.size()).toBe(1);
  });

  it('should search with filters', async () => {
    // Add test files
    fileSystem.addFile(
      '/test/root/docs/test1.md',
      `---
Category: debugging
Tags: async, testing
Durability: permanent
Scope: universal
Agent: system
Date: 2024-01-01
Source: Test
---

# Test 1

Debugging async issues.
`
    );

    fileSystem.addFile(
      '/test/root/docs/test2.md',
      `---
Category: testing
Tags: unit, mock
Durability: permanent
Scope: universal
Agent: system
Date: 2024-01-01
Source: Test
---

# Test 2

Unit testing examples.
`
    );

    await index.sync();

    // Search with category filter
    const results = await index.search('testing', 10, { category: 'testing' });
    expect(results.length).toBe(1);
    expect(results[0].metadata.category).toBe('testing');
  });

  it('should rebuild index from scratch', async () => {
    // Add files
    fileSystem.addFile(
      '/test/root/docs/test1.md',
      `---
Category: testing
Tags: unit
Durability: permanent
Scope: universal
Agent: system
Date: 2024-01-01
Source: Test
---

# Test 1

Content.
`
    );

    await index.sync();
    expect(index.size()).toBe(1);

    // Add more files
    fileSystem.addFile(
      '/test/root/docs/test2.md',
      `---
Category: debugging
Tags: async
Durability: permanent
Scope: universal
Agent: system
Date: 2024-01-01
Source: Test
---

# Test 2

More content.
`
    );

    // Rebuild
    await index.rebuild();
    expect(index.size()).toBe(2);
  });

  it('should update a single file', async () => {
    // Add initial file
    fileSystem.addFile(
      '/test/root/docs/test.md',
      `---
Category: testing
Tags: initial
Durability: permanent
Scope: universal
Agent: system
Date: 2024-01-01
Source: Test
---

# Test

Initial content.
`
    );

    await index.sync();
    expect(index.size()).toBe(1);

    // Update file
    fileSystem.addFile(
      '/test/root/docs/test.md',
      `---
Category: testing
Tags: updated
Durability: permanent
Scope: universal
Agent: system
Date: 2024-01-01
Source: Test
---

# Test

Updated content.
`
    );

    await index.updateFile('/test/root/docs/test.md', '/test/root/docs');
    expect(index.size()).toBe(1);
  });
});
