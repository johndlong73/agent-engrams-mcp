import type { Config, ProviderConfig } from './config.js';

/**
 * Build the embedding index identity fields from config.
 * These fields are used to validate that an existing index can be safely loaded.
 */
export function buildEmbeddingIndexIdentity(config: Config): {
  embeddingModelId: string;
  providerFingerprint: string;
  dimensions: number;
} {
  const dimensions = config.dimensions;
  const embeddingModelId = resolveEmbeddingModelId(config.provider);
  const providerFingerprint = buildProviderFingerprint(config.provider);

  return { dimensions, embeddingModelId, providerFingerprint };
}

/**
 * Resolve the embedding model ID from provider config.
 * Uses the model value directly (after env/config defaults have been applied).
 */
function resolveEmbeddingModelId(provider: ProviderConfig): string {
  switch (provider.type) {
    case 'openai':
      return provider.model ?? '';
    case 'bedrock':
      return provider.model ?? '';
    case 'ollama':
      return provider.model ?? '';
  }
}

/**
 * Build a stable, non-secret fingerprint for the embedding provider.
 * Same logical provider always produces the same string (all lowercase).
 */
function buildProviderFingerprint(provider: ProviderConfig): string {
  switch (provider.type) {
    case 'openai': {
      const baseUrl = provider.baseUrl ?? 'http://localhost:11434/v1';
      const normalized = normalizeUrl(baseUrl);
      return `openai:${normalized}`;
    }
    case 'bedrock': {
      const region = (provider.region ?? 'us-east-1').toLowerCase();
      const profile = (provider.profile ?? 'default').toLowerCase();
      return `bedrock:${region}:profile=${profile}`;
    }
    case 'ollama': {
      const url = provider.url ?? 'http://localhost:11434';
      const normalized = normalizeUrl(url);
      return `ollama:${normalized}`;
    }
  }
}

/**
 * Normalize a URL for consistent fingerprinting:
 * - All lowercase
 * - No trailing slash on path
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Lowercase the origin (protocol + host)
    const normalizedOrigin = parsed.origin.toLowerCase();
    // Remove trailing slash from pathname, then reconstruct
    let normalizedPath = parsed.pathname;
    while (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
      normalizedPath = normalizedPath.slice(0, -1);
    }
    // Keep query and hash as-is
    let result = normalizedOrigin + normalizedPath;
    if (parsed.search) {
      result += parsed.search;
    }
    if (parsed.hash) {
      result += parsed.hash;
    }
    return result;
  } catch {
    // If URL parsing fails, just lowercase and trim
    let trimmed = url.trim();
    while (trimmed.length > 1 && trimmed.endsWith('/')) {
      trimmed = trimmed.slice(0, -1);
    }
    return trimmed.toLowerCase();
  }
}
