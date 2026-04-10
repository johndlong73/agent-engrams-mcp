import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Config {
  /** Directory to index (engrams) */
  dir: string;
  /** Embedding dimensions */
  dimensions: number;
  /** Embedding provider config */
  provider: ProviderConfig;
  /** Minimum similarity score for search results (0.0 to 1.0, default 0.40) */
  minSearchScore?: number;
}

export type ProviderConfig =
  | { type: 'openai'; apiKey?: string; model?: string; baseUrl?: string }
  | { type: 'bedrock'; profile?: string; region?: string; model?: string }
  | { type: 'ollama'; url?: string; model?: string };

/** Raw shape stored in the config file. */
export interface ConfigFile {
  dir?: string;
  dimensions?: number;
  provider?:
    | { type: 'openai'; apiKey?: string; model?: string; baseUrl?: string }
    | { type: 'bedrock'; profile?: string; region?: string; model?: string }
    | { type: 'ollama'; url?: string; model?: string };
  minSearchScore?: number;
}

/** Default when no model is set (suited to local OpenAI-compatible servers such as omlx). */
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'Qwen3-Embedding-0.6B-4bit-DWQ';

const configHome =
  process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '/tmp', '.config');

const DEFAULT_DIR = path.join(configHome, 'agent-engrams-mcp', 'docs');

const CONFIG_PATH =
  process.env.MCP_CONFIG || path.join(configHome, 'agent-engrams-mcp', 'mcp.json');

export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Load config from file, with env var overrides.
 * Returns null if no config file exists (needs setup).
 */
export function loadConfig(): Config | null {
  // Try config file first
  let file: ConfigFile | null = null;
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {
      // Corrupted file
    }
  }

  // Check env var fallback for dir (the one required field)
  const envDir = process.env.ENGrams_DIR;

  if (!file && !envDir) {
    return null; // Not configured yet
  }

  // Build config: file values, then env overrides
  const home = process.env.HOME || '/tmp';
  const resolvePath = (p: string) => p.replace(/^~/, home);

  const dir = envDir ? resolvePath(envDir) : file?.dir ? resolvePath(file.dir) : DEFAULT_DIR;

  const dimensions = envInt('EMBEDDER_DIMENSIONS') ?? file?.dimensions ?? 512;

  const providerType = envStr('EMBEDDER_TYPE') ?? file?.provider?.type ?? 'openai';

  let provider: ProviderConfig;
  switch (providerType) {
    case 'openai': {
      const baseUrl =
        envStr('EMBEDDER_BASE_URL') ??
        (file?.provider?.type === 'openai' ? file.provider.baseUrl : undefined);

      const apiKey =
        envStr('EMBEDDER_API_KEY') ??
        process.env.OPENAI_API_KEY ??
        (file?.provider?.type === 'openai' ? file.provider.apiKey : undefined);

      provider = {
        type: 'openai',
        apiKey: apiKey?.trim() ?? '',
        model:
          envStr('EMBEDDER_MODEL') ??
          (file?.provider?.type === 'openai' ? file.provider.model : undefined) ??
          DEFAULT_OPENAI_EMBEDDING_MODEL,
        baseUrl: baseUrl?.trim() || undefined,
      };
      break;
    }
    case 'bedrock':
      provider = {
        type: 'bedrock',
        profile:
          envStr('EMBEDDER_BEDROCK_PROFILE') ??
          (file?.provider?.type === 'bedrock' ? file.provider.profile : undefined) ??
          'default',
        region:
          envStr('EMBEDDER_BEDROCK_REGION') ??
          (file?.provider?.type === 'bedrock' ? file.provider.region : undefined) ??
          'us-east-1',
        model:
          envStr('EMBEDDER_BEDROCK_MODEL') ??
          (file?.provider?.type === 'bedrock' ? file.provider.model : undefined) ??
          'amazon.titan-embed-text-v2:0',
      };
      break;
    case 'ollama':
      provider = {
        type: 'ollama',
        url:
          envStr('EMBEDDER_OLLAMA_URL') ??
          (file?.provider?.type === 'ollama' ? file.provider.url : undefined) ??
          'http://localhost:11434',
        model:
          envStr('EMBEDDER_OLLAMA_MODEL') ??
          (file?.provider?.type === 'ollama' ? file.provider.model : undefined) ??
          'nomic-embed-text',
      };
      break;
    default:
      throw new Error(`Unknown provider: "${providerType}". Use "openai", "bedrock", or "ollama".`);
  }

  return {
    dir,
    dimensions,
    provider,
    minSearchScore: file?.minSearchScore,
  };
}

/**
 * Save config to file.
 */
export function saveConfig(config: ConfigFile): void {
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

function envStr(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

function envInt(key: string): number | undefined {
  const v = envStr(key);
  return v ? parseInt(v, 10) : undefined;
}