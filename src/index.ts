#!/usr/bin/env node

import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import * as express from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EngramIndex, type EngramIndexConfig } from './index-store.js';
import { createEmbedder, type EmbedderConfig } from './embedder.js';
import { parseFrontmatter, renderEngram, slugify, normalizeScope } from './frontmatter.js';
import {
  defaultEngramsStorePaths,
  getConfigPath,
  loadConfig,
  resolveEngramsStoreFromInput,
  type Config,
} from './config.js';
import { NodeFileSystem, createHttpFetch } from './abstractions.js';
import { McpServerService } from './mcp-server-service.js';
import { buildEmbeddingIndexIdentity } from './index-identity.js';

// Parse command-line arguments
const args = process.argv.slice(2);
const argsMap = new Map<string, string>();

args.forEach(arg => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    if (key && value !== undefined) {
      argsMap.set(key, value);
    } else if (key) {
      argsMap.set(key, 'true');
    }
  }
});

// Configuration loaded from mcp.json file (with env var overrides and CLI args)
let config = loadConfig();

// Apply CLI argument overrides
if (argsMap.has('dir') && argsMap.get('dir')) {
  const paths = resolveEngramsStoreFromInput(argsMap.get('dir')!);
  if (!config) {
    config = { ...paths, dimensions: 512, provider: { type: 'openai' } };
  } else {
    config.root = paths.root;
    config.docsDir = paths.docsDir;
    config.indexDir = paths.indexDir;
  }
}

if (argsMap.has('dimensions') && argsMap.get('dimensions')) {
  if (!config) {
    config = { ...defaultEngramsStorePaths(), dimensions: 512, provider: { type: 'openai' } };
  }
  config.dimensions = parseInt(argsMap.get('dimensions')!, 10);
}

if (argsMap.has('provider') && argsMap.get('provider')) {
  if (!config) {
    config = { ...defaultEngramsStorePaths(), dimensions: 512, provider: { type: 'openai' } };
  }
  try {
    config.provider = JSON.parse(argsMap.get('provider')!);
  } catch {
    console.error('Invalid provider JSON');
    process.exit(1);
  }
}

if (!config) {
  console.error(
    `MCP server not configured. Set ENGRAMS_DIR (and embedding env vars) or create ${getConfigPath()} (or set MCP_CONFIG).`
  );
  process.exit(1);
}

const storeConfig: Config = config;

function ensureStoreDirectories(cfg: Config) {
  fs.mkdirSync(cfg.root, { recursive: true });
  fs.mkdirSync(cfg.docsDir, { recursive: true });
  fs.mkdirSync(cfg.indexDir, { recursive: true });
}

const DOCS_DIR = storeConfig.docsDir;
const EMBEDDER_DIMENSIONS = storeConfig.dimensions;

// Server info
const SERVER_NAME = 'agent-engrams-mcp';
const SERVER_VERSION = '0.1.0';

// Main entry point
async function main() {
  ensureStoreDirectories(storeConfig);

  // Create embedder
  const embedderConfig: EmbedderConfig = createEmbedderConfig(storeConfig, EMBEDDER_DIMENSIONS);
  const httpFetch = createHttpFetch();
  const embedder = createEmbedder(embedderConfig, httpFetch);

  // Create file system
  const fileSystem = new NodeFileSystem();

  // Create index
  const identity = buildEmbeddingIndexIdentity(storeConfig);
  const indexConfig: EngramIndexConfig = {
    dir: DOCS_DIR,
    indexJsonPath: path.join(storeConfig.root, 'index.json'),
    dimensions: EMBEDDER_DIMENSIONS,
    embeddingModelId: identity.embeddingModelId,
    providerFingerprint: identity.providerFingerprint,
    embedder,
    minSearchScore: storeConfig.minSearchScore ?? 0.4,
  };
  const index = new EngramIndex(indexConfig, fileSystem);
  await index.load();
  await index.sync();

  // Create MCP server
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        logging: {},
      },
    }
  );

  // Create and configure server service
  const serverService = new McpServerService(server, index, storeConfig, fileSystem);
  serverService.registerTools();

  // Determine transport mode from environment or CLI
  const USE_STDIO = process.env.USE_STDIO === 'true' || argsMap.has('stdio');

  let transport: NodeStreamableHTTPServerTransport | StdioServerTransport;

  if (USE_STDIO) {
    // Use stdio transport for local process communication
    transport = new StdioServerTransport();
    // One line on stderr for operators; avoid console.error so Cursor does not tag it as [error].
    process.stderr.write(
      `[agent-engrams-mcp] stdio | root=${storeConfig.root} docs=${DOCS_DIR} indexDir=${storeConfig.indexDir} | indexed=${index.size()} engrams\n`
    );
  } else {
    // Use Streamable HTTP transport
    transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => Math.random().toString(36).substring(2),
    });

    // Create Express app with MCP middleware
    const app = createMcpExpressApp();
    app.post('/mcp', async (req, res) => {
      await (transport as NodeStreamableHTTPServerTransport).handleRequest(req, res, req.body);
    });

    // Start HTTP server
    const PORT = parseInt(process.env.PORT || '3000', 10);
    const httpServer = app.listen(PORT, () => {
      console.log(`Engram MCP server running on port ${PORT}`);
      console.log(`Server name: ${SERVER_NAME}`);
      console.log(`Version: ${SERVER_VERSION}`);
      console.log(`Store root: ${storeConfig.root}`);
      console.log(`Engrams docs: ${DOCS_DIR}`);
      console.log(`Index dir (reserved): ${storeConfig.indexDir}`);
      console.log(`Index size: ${index.size()} engrams`);
    });

    // Store httpServer for shutdown
    (transport as any).__httpServer = httpServer;
  }

  // Load seed engrams as resources
  await loadSeedEngrams(server);

  // Connect server to transport
  await server.connect(transport);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await transport.close();
    if ((transport as any).__httpServer) {
      (transport as any).__httpServer.close();
    }
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    await transport.close();
    if ((transport as any).__httpServer) {
      (transport as any).__httpServer.close();
    }
    process.exit(0);
  });
}

function createEmbedderConfig(storeConfig: Config, dimensions: number): EmbedderConfig {
  if (storeConfig.provider.type === 'openai') {
    return {
      type: 'openai',
      baseUrl: storeConfig.provider.baseUrl,
      model: storeConfig.provider.model,
      apiKey: storeConfig.provider.apiKey,
      dimensions,
    };
  } else if (storeConfig.provider.type === 'bedrock') {
    return {
      type: 'bedrock',
      profile: storeConfig.provider.profile,
      region: storeConfig.provider.region,
      model: storeConfig.provider.model,
      dimensions,
    };
  } else {
    return {
      type: 'ollama',
      baseUrl: storeConfig.provider.url,
      model: storeConfig.provider.model,
      dimensions,
    };
  }
}

// Load seed engrams as resources
const SEEDS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'seeds');

async function loadSeedEngrams(server: McpServer): Promise<void> {
  if (!fs.existsSync(SEEDS_DIR)) {
    console.warn(`Seed directory not found: ${SEEDS_DIR}`);
    return;
  }

  const seedFiles = fs.readdirSync(SEEDS_DIR).filter(f => f.endsWith('.md'));

  for (const file of seedFiles) {
    const filePath = path.join(SEEDS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { metadata } = parseFrontmatter(content);

    const uri = `engram://seed/${file}`;
    const title = file.replace('.md', '');

    server.registerResource(
      `seed-${file.replace('.md', '')}`,
      uri,
      {
        title: title,
        description: `Seed engram: ${title}`,
        mimeType: 'text/markdown',
      },
      async () => ({
        contents: [
          {
            uri,
            text: content,
          },
        ],
      })
    );
  }
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
