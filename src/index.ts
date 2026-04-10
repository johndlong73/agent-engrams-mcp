#!/usr/bin/env node

import { McpServer, fromJsonSchema, StdioServerTransport } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import * as express from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EngramIndex, type SearchFilters, type SearchResult } from './index-store.js';
import { createEmbedder, type EmbedderConfig } from './embedder.js';
import { parseFrontmatter, renderEngram, slugify, normalizeScope } from './frontmatter.js';
import {
  defaultEngramsStorePaths,
  getConfigPath,
  loadConfig,
  resolveEngramsStoreFromInput,
  type Config,
} from './config.js';

// Parse command-line arguments
const args = process.argv.slice(2);
const argsMap = new Map<string, string>();

args.forEach((arg) => {
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

// Create the MCP server
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

// Initialize index
let index: EngramIndex | null = null;
let embedderConfig: EmbedderConfig;

if (storeConfig.provider.type === 'openai') {
  embedderConfig = {
    type: 'openai',
    baseUrl: storeConfig.provider.baseUrl,
    model: storeConfig.provider.model,
    apiKey: storeConfig.provider.apiKey,
    dimensions: EMBEDDER_DIMENSIONS,
  };
} else if (storeConfig.provider.type === 'bedrock') {
  embedderConfig = {
    type: 'bedrock',
    profile: storeConfig.provider.profile,
    region: storeConfig.provider.region,
    model: storeConfig.provider.model,
    dimensions: EMBEDDER_DIMENSIONS,
  };
} else {
  embedderConfig = {
    type: 'ollama',
    baseUrl: storeConfig.provider.url,
    model: storeConfig.provider.model,
    dimensions: EMBEDDER_DIMENSIONS,
  };
}

async function initIndex() {
  const embedder = createEmbedder(embedderConfig);
  index = new EngramIndex({
    dir: DOCS_DIR,
    embedder,
    minSearchScore: storeConfig.minSearchScore ?? 0.4,
  });
  await index.load();
  await index.sync();
}

// 1. write-engram tool
const writeEngramSchema = fromJsonSchema({
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short descriptive title for the engram' },
    category: { 
      type: 'string', 
      enum: ['debugging', 'api', 'architecture', 'tooling', 'domain', 'performance', 'testing'],
      description: 'Primary knowledge category' 
    },
    tags: { 
      type: 'array', 
      items: { type: 'string' },
      description: 'Keywords for discoverability' 
    },
    scope: { 
      type: 'string', 
      description: 'How broadly applicable is this knowledge? (universal, language, framework, project)' 
    },
    durability: { 
      type: 'string', 
      enum: ['permanent', 'workaround', 'hypothesis'],
      description: 'How stable is this knowledge? (permanent=verified, workaround=temporary, hypothesis=unverified)' 
    },
    agent: { 
      type: 'string', 
      description: 'Name of the agent authoring this engram' 
    },
    source: { 
      type: 'string', 
      description: 'Ticket key, PR URL, or task description that triggered this learning' 
    },
    context: { 
      type: 'string', 
      description: 'What situation triggered this learning? Include specific details.' 
    },
    insight: { 
      type: 'string', 
      description: 'What was learned? What is the non-obvious part? Be specific.' 
    },
    trigger: { 
      type: 'string', 
      description: 'Specific conditions when this engram is relevant (for future retrieval). Include concrete examples.' 
    },
    anti_trigger: { 
      type: 'string', 
      description: 'Conditions when this engram should NOT be applied. What would make it wrong to apply this knowledge?' 
    },
    supersedes: { 
      type: 'string', 
      description: 'Relative path to an older engram this replaces, or omit if none' 
    },
  },
  required: ['title', 'category', 'tags', 'scope', 'durability', 'agent', 'source', 'context', 'insight', 'trigger', 'anti_trigger'],
});

server.registerTool(
  'write-engram',
  {
    title: 'Write Engram',
    description: 'Write a structured engram to the shared knowledge store. Engrams capture TRANSFERABLE engineering knowledge — debugging techniques, API quirks, architectural patterns, performance insights — that help agents across ANY project.',
    inputSchema: writeEngramSchema,
  },
  async (params, _ctx) => {
    if (!index) {
      return {
        content: [{ type: 'text', text: 'Engram index not initialized. Run reindex first.' }],
        isError: true,
      };
    }

    const p = params as {
      title: string;
      category: string;
      tags: string[];
      scope: string;
      durability: string;
      agent: string;
      source: string;
      context: string;
      insight: string;
      trigger: string;
      anti_trigger: string;
      supersedes?: string;
    };

    const writeParams = { ...p, scope: normalizeScope(p.scope) };
    const markdown = renderEngram(writeParams);
    const date = new Date().toISOString().split('T')[0];
    let filename = `${date}-${slugify(p.title)}.md`;
    let filePath = path.join(DOCS_DIR, filename);

    let suffix = 1;
    while (fs.existsSync(filePath)) {
      filename = `${date}-${slugify(p.title)}-${suffix}.md`;
      filePath = path.join(DOCS_DIR, filename);
      suffix++;
    }

    fs.mkdirSync(DOCS_DIR, { recursive: true });
    fs.writeFileSync(filePath, markdown, 'utf-8');

    // Update index
    await index.updateFile(filePath, DOCS_DIR);

    const home = process.env.HOME || '';
    const displayPath = filePath.replace(home, '~');

    return {
      content: [{
        type: 'text',
        text: `Engram written: ${displayPath}\n\nTitle: ${p.title}\nCategory: ${p.category}\nScope: ${writeParams.scope}\nDurability: ${p.durability}\nTags: ${p.tags.join(', ')}`,
      }],
    };
  }
);

// 2. search-engrams tool
const searchEngramsSchema = fromJsonSchema({
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Natural language search query' },
    limit: { 
      type: 'number', 
      description: 'Max results to return (default 8, max 20)',
      default: 8 
    },
    category: { 
      type: 'string',
      description: 'Filter by category: debugging, api, architecture, tooling, domain, performance, testing' 
    },
    agent: { 
      type: 'string', 
      description: 'Filter by authoring agent name' 
    },
    durability: { 
      type: 'string',
      description: 'Filter by durability: permanent, workaround, hypothesis' 
    },
    tags: { 
      type: 'array', 
      items: { type: 'string' },
      description: 'Filter by tags (match any)' 
    },
    scope: { 
      type: 'string',
      description: 'Filter by scope: universal, language, framework, project' 
    },
  },
  required: ['query'],
});

server.registerTool(
  'search-engrams',
  {
    title: 'Search Engrams',
    description: 'Semantic search over the agent engram memory store. Returns the most relevant engrams for a natural language query, with optional metadata filtering.',
    inputSchema: searchEngramsSchema,
  },
  async (params, _ctx) => {
    if (!index || index.size() === 0) {
      const msg = !index
        ? 'Engram index not initialized. Run reindex first.'
        : 'Engram index is empty — no engrams have been written yet.';
      return { content: [{ type: 'text', text: msg }], isError: true };
    }

    const p = params as {
      query: string;
      limit?: number;
      category?: string;
      agent?: string;
      durability?: string;
      tags?: string[];
      scope?: string;
    };

    const filters: SearchFilters = {};
    if (p.category) filters.category = p.category;
    if (p.agent) filters.agent = p.agent;
    if (p.durability) filters.durability = p.durability;
    if (p.tags && p.tags.length > 0) filters.tags = p.tags;
    if (p.scope) filters.scope = normalizeScope(p.scope);

    const hasFilters = Object.keys(filters).length > 0;

    try {
      const results = await index.search(
        p.query,
        Math.min(p.limit ?? 8, 20),
        hasFilters ? filters : undefined
      );

      if (results.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No relevant engrams found for: "${p.query}"`,
          }],
        };
      }

      const home = process.env.HOME || '';
      const output = results
        .map((r: SearchResult, i: number) => {
          const displayPath = r.path.replace(home, '~');
          const score = (r.score * 100).toFixed(1);
          const m = r.metadata;
          const metaLine = [
            m.category && `Category: ${m.category}`,
            m.scope && `Scope: ${m.scope}`,
            m.durability && `Durability: ${m.durability}`,
            m.agent && `Agent: ${m.agent}`,
            m.tags?.length && `Tags: ${m.tags.join(', ')}`,
            m.supersedes && `Supersedes: ${m.supersedes}`,
          ]
            .filter(Boolean)
            .join(' | ');

          return `### ${i + 1}. ${displayPath} (${score}% match)\n${metaLine}\n\n${r.excerpt}`;
        })
        .join('\n\n---\n\n');

      const header = `Found ${results.length} engrams for "${p.query}" (${index.size()} total indexed):\n\n`;

      return {
        content: [{ type: 'text', text: header + output }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text', text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// 3. reindex tool
const reindexSchema = fromJsonSchema({
  type: 'object',
  properties: {},
});

server.registerTool(
  'reindex',
  {
    title: 'Reindex Engrams',
    description: 'Force full re-index of all engram documents. Use this after adding new engram files to the directory.',
    inputSchema: reindexSchema,
  },
  async (_params, _ctx) => {
    if (!index) {
      return {
        content: [{ type: 'text', text: 'Engram index not initialized.' }],
        isError: true,
      };
    }

    try {
      await index.rebuild();
      return {
        content: [{ type: 'text', text: `Re-indexed: ${index.size()} engrams` }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text', text: `Re-index failed: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// Register resources (seed engrams)
const SEEDS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'seeds');

async function loadSeedEngrams(): Promise<void> {
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
        contents: [{
          uri,
          text: content,
        }],
      })
    );
  }
}

// Main
async function main() {
  ensureStoreDirectories(storeConfig);
  // Initialize index
  await initIndex();
  
  // Load seed engrams as resources
  await loadSeedEngrams();
  
  // Determine transport mode from environment or CLI
  const USE_STDIO = process.env.USE_STDIO === 'true' || argsMap.has('stdio');
  
  let transport: NodeStreamableHTTPServerTransport | StdioServerTransport;
  
  if (USE_STDIO) {
    // Use stdio transport for local process communication
    transport = new StdioServerTransport();
    // One line on stderr for operators; avoid console.error so Cursor does not tag it as [error].
    process.stderr.write(
      `[agent-engrams-mcp] stdio | root=${storeConfig.root} docs=${DOCS_DIR} indexDir=${storeConfig.indexDir} | indexed=${index?.size() ?? 0} engrams\n`
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
      console.log(`Index size: ${index?.size() || 0} engrams`);
    });
    
    // Store httpServer for shutdown
    (transport as any).__httpServer = httpServer;
  }

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

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});