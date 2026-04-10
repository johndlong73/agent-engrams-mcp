import YAML from 'yaml';

export interface EngramMetadata {
  category?: string;
  tags?: string[];
  durability?: string;
  scope?: string;
  agent?: string;
  date?: string;
  source?: string;
  trigger?: string;
  antiTrigger?: string;
  supersedes?: string;
}

export interface EngramWriteParams {
  title: string;
  category: string;
  tags: string[];
  durability: string;
  scope: string;
  agent: string;
  source: string;
  context: string;
  insight: string;
  trigger: string;
  anti_trigger: string;
  supersedes?: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

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

export function normalizeScope(raw: string): string {
  const key = raw.trim().toLowerCase();
  return CANONICAL_SCOPES[key] ?? 'universal';
}

/**
 * Extract YAML frontmatter and body from a raw markdown string.
 * Returns parsed metadata and the remaining body text.
 */
export function parseFrontmatter(raw: string): {
  metadata: EngramMetadata;
  body: string;
} {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { metadata: {}, body: raw };
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = YAML.parse(match[1]) ?? {};
  } catch {
    return { metadata: {}, body: raw.replace(FRONTMATTER_RE, '') };
  }

  const metadata: EngramMetadata = {};

  if (typeof parsed.Category === 'string') metadata.category = parsed.Category.toLowerCase();
  if (typeof parsed.Tags === 'string') {
    metadata.tags = parsed.Tags.split(',')
      .map((t: string) => t.trim())
      .filter(Boolean);
  }
  if (typeof parsed.Durability === 'string') metadata.durability = parsed.Durability.toLowerCase();
  if (typeof parsed.Scope === 'string') metadata.scope = normalizeScope(parsed.Scope);
  if (typeof parsed.Agent === 'string') metadata.agent = parsed.Agent;
  if (typeof parsed.Date === 'string') metadata.date = parsed.Date;
  if (typeof parsed.Source === 'string') metadata.source = parsed.Source;
  if (typeof parsed.Trigger === 'string') metadata.trigger = parsed.Trigger;
  if (typeof parsed['Anti-trigger'] === 'string') metadata.antiTrigger = parsed['Anti-trigger'];
  if (typeof parsed.Supersedes === 'string' && parsed.Supersedes !== 'None') {
    metadata.supersedes = parsed.Supersedes;
  }

  const body = raw.replace(FRONTMATTER_RE, '');
  return { metadata, body };
}

/**
 * Render a complete engram markdown document from structured parameters.
 */
export function renderEngram(params: EngramWriteParams): string {
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

/**
 * Convert a title string into a filename-safe slug.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}