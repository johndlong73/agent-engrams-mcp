import { describe, it, expect, beforeEach } from 'vitest';
import { MockEmbedder } from '../test-helpers.js';

describe('MockEmbedder', () => {
  let embedder: MockEmbedder;

  beforeEach(() => {
    embedder = new MockEmbedder(512);
  });

  it('should create embedder with specified dimensions', () => {
    const embedder512 = new MockEmbedder(512);
    expect(embedder512).toBeDefined();
  });

  it('should embed single text', async () => {
    const result = await embedder.embed('test text');
    expect(result).toHaveLength(512);
    expect(result[0]).toBe(0.1);
  });

  it('should embed batch of texts', async () => {
    const texts = ['text1', 'text2', 'text3'];
    const results = await embedder.embedBatch(texts);

    expect(results).toHaveLength(3);
    results.forEach(result => {
      expect(result).toHaveLength(512);
    });
  });
});
