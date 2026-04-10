import * as path from 'node:path';
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import type { EngramIndex } from './index-store.js';
import type { Config } from './config.js';
import type { IFileSystem } from './abstractions.js';

/**
 * Service class for managing the MCP server
 * Encapsulates server initialization and tool registration
 */
export class McpServerService {
  private server: McpServer;
  private index: EngramIndex;
  private config: Config;
  private fileSystem: IFileSystem;
  private docsDir: string;

  constructor(server: McpServer, index: EngramIndex, config: Config, fileSystem: IFileSystem) {
    this.server = server;
    this.index = index;
    this.config = config;
    this.fileSystem = fileSystem;
    this.docsDir = config.docsDir;
  }

  /**
   * Register all MCP tools
   */
  registerTools(): void {
    this.registerWriteEngramTool();
    this.registerSearchEngramsTool();
    this.registerReindexTool();
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    // Server is started by the caller via server.connect(transport)
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    // Server is stopped by the caller via transport.close()
  }

  private registerWriteEngramTool(): void {
    const writeEngramSchema = fromJsonSchema({
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short descriptive title for the engram' },
        category: {
          type: 'string',
          enum: ['debugging', 'api', 'architecture', 'tooling', 'domain', 'performance', 'testing'],
          description: 'Primary knowledge category',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords for discoverability',
        },
        scope: {
          type: 'string',
          description:
            'How broadly applicable is this knowledge? (universal, language, framework, project)',
        },
        durability: {
          type: 'string',
          enum: ['permanent', 'workaround', 'hypothesis'],
          description:
            'How stable is this knowledge? (permanent=verified, workaround=temporary, hypothesis=unverified)',
        },
        agent: { type: 'string', description: 'Name of the agent authoring this engram' },
        source: {
          type: 'string',
          description: 'Ticket key, PR URL, or task description that triggered this learning',
        },
        context: {
          type: 'string',
          description: 'What situation triggered this learning? Include specific details.',
        },
        insight: {
          type: 'string',
          description: 'What was learned? What is the non-obvious part? Be specific.',
        },
        trigger: {
          type: 'string',
          description:
            'Specific conditions when this engram is relevant (for future retrieval). Include concrete examples.',
        },
        anti_trigger: {
          type: 'string',
          description:
            'Conditions when this engram should NOT be applied. What would make it wrong to apply this knowledge?',
        },
        supersedes: {
          type: 'string',
          description: 'Relative path to an older engram this replaces, or omit if none',
        },
      },
      required: [
        'title',
        'category',
        'tags',
        'scope',
        'durability',
        'agent',
        'source',
        'context',
        'insight',
        'trigger',
        'anti_trigger',
      ],
    });

    this.server.registerTool(
      'write-engram',
      {
        title: 'Write Engram',
        description:
          'Write a structured engram to the shared knowledge store. Engrams capture TRANSFERABLE engineering knowledge — debugging techniques, API quirks, architectural patterns, performance insights — that help agents across ANY project.',
        inputSchema: writeEngramSchema,
      },
      async params => {
        if (!this.index) {
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

        const writeParams = { ...p, scope: this.normalizeScope(p.scope) };
        const markdown = this.renderEngram(writeParams);
        const date = new Date().toISOString().split('T')[0];
        let filename = `${date}-${this.slugify(p.title)}.md`;
        let filePath = path.join(this.docsDir, filename);
        let suffix = 1;
        while (this.fileSystem.existsSync(filePath)) {
          filename = `${date}-${this.slugify(p.title)}-${suffix}.md`;
          filePath = path.join(this.docsDir, filename);
          suffix++;
        }

        this.fileSystem.mkdirSync(this.docsDir, { recursive: true });
        this.fileSystem.writeFileSync(filePath, markdown, 'utf-8');

        // Update index
        await this.index.updateFile(filePath, this.docsDir);

        const home = process.env.HOME || '';
        const displayPath = filePath.replace(home, '~');

        return {
          content: [
            {
              type: 'text',
              text: `Engram written: ${displayPath}\n\nTitle: ${p.title}\nCategory: ${p.category}\nScope: ${writeParams.scope}\nDurability: ${p.durability}\nTags: ${p.tags.join(', ')}`,
            },
          ],
        };
      }
    );
  }

  private registerSearchEngramsTool(): void {
    const searchEngramsSchema = fromJsonSchema({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        limit: {
          type: 'number',
          description: 'Max results to return (default 8, max 20)',
          default: 8,
        },
        category: {
          type: 'string',
          description:
            'Filter by category: debugging, api, architecture, tooling, domain, performance, testing',
        },
        agent: { type: 'string', description: 'Filter by authoring agent name' },
        durability: {
          type: 'string',
          description: 'Filter by durability: permanent, workaround, hypothesis',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags (match any)',
        },
        scope: {
          type: 'string',
          description: 'Filter by scope: universal, language, framework, project',
        },
      },
      required: ['query'],
    });

    this.server.registerTool(
      'search-engrams',
      {
        title: 'Search Engrams',
        description:
          'Semantic search over the agent engram memory store. Returns the most relevant engrams for a natural language query, with optional metadata filtering.',
        inputSchema: searchEngramsSchema,
      },
      async params => {
        if (!this.index || this.index.size() === 0) {
          const msg = !this.index
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

        const filters: Record<string, unknown> = {};
        if (p.category) filters.category = p.category;
        if (p.agent) filters.agent = p.agent;
        if (p.durability) filters.durability = p.durability;
        if (p.tags && p.tags.length > 0) filters.tags = p.tags;
        if (p.scope) filters.scope = this.normalizeScope(p.scope);

        const hasFilters = Object.keys(filters).length > 0;

        try {
          const results = await this.index.search(
            p.query,
            Math.min(p.limit ?? 8, 20),
            hasFilters ? filters : undefined
          );

          if (results.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: `No relevant engrams found for: "${p.query}"`,
                },
              ],
            };
          }

          const home = process.env.HOME || '';
          const output = results
            .map((r: any, i: number) => {
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

          const header = `Found ${results.length} engrams for "${p.query}" (${this.index.size()} total indexed):\n\n`;

          return {
            content: [{ type: 'text', text: header + output }],
          };
        } catch (err: unknown) {
          return {
            content: [
              {
                type: 'text',
                text: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  private registerReindexTool(): void {
    const reindexSchema = fromJsonSchema({
      type: 'object',
      properties: {},
    });

    this.server.registerTool(
      'reindex',
      {
        title: 'Reindex Engrams',
        description:
          'Force full re-index of all engram documents. Use this after adding new engram files to the directory.',
        inputSchema: reindexSchema,
      },
      async _params => {
        if (!this.index) {
          return {
            content: [{ type: 'text', text: 'Engram index not initialized.' }],
            isError: true,
          };
        }

        try {
          await this.index.rebuild();
          return {
            content: [{ type: 'text', text: `Re-indexed: ${this.index.size()} engrams` }],
          };
        } catch (err: unknown) {
          return {
            content: [
              {
                type: 'text',
                text: `Re-index failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  private normalizeScope(raw: string): string {
    const key = raw.trim().toLowerCase();
    const CANONICAL_SCOPES: Record<string, string> = {
      universal: 'universal',
      general: 'universal',
      global: 'universal',
      broad: 'universal',
      language: 'language',
      lang: 'language',
      framework: 'framework',
      library: 'framework',
      lib: 'framework',
      project: 'project',
      repo: 'project',
      codebase: 'project',
    };
    return CANONICAL_SCOPES[key] ?? 'universal';
  }

  private renderEngram(params: any): string {
    const date = new Date().toISOString().split('T')[0];
    const supersedes = params.supersedes || 'None';

    return `---
Category: ${params.category}
Tags: ${params.tags.join(', ')}
Durability: ${params.durability}
Scope: ${params.scope}
Agent: ${params.agent}
Date: ${date}
Source: ${params.source}
---

# ${params.title}

## Context

${params.context}

## Insight

${params.insight}

## Application

**Trigger:** ${params.trigger}
**Anti-trigger:** ${params.anti_trigger}

## Supersedes

${supersedes}
`;
  }

  private slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
  }
}
