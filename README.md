# Agent Engrams MCP Server

An MCP (Model Context Protocol) server that provides access to a structured engram knowledge store. Agents can learn and self-improve through engram documents.

## Features

- **write-engram**: Write structured engrams to capture valuable knowledge
- **search-engrams**: Semantic search over the engram knowledge base
- **reindex**: Force full re-index of all engram documents
- **Seed resources**: Three seed engram documents for guidance
- **Dual transport**: Supports both HTTP (Streamable HTTP) and local (stdio) communication

## Installation

```bash
cd agent-engrams-mcp
npm install
npm run build
```

### Global Installation (for npx usage)

To use with npx, install globally:

```bash
npm install -g agent-engrams-mcp
```

Or use directly from a local project:

```bash
npx ./dist/index.js
```

## Configuration

The server reads configuration from `~/.config/agent-engrams-mcp/mcp.json` (or `$XDG_CONFIG_HOME/agent-engrams-mcp/mcp.json`, or `$MCP_CONFIG` if set). Environment variables can override file values.

### mcp.json Format

```json
{
  "dir": "~/.config/agent-engrams-mcp/docs",
  "dimensions": 512,
  "provider": {
    "type": "openai",
    "model": "Qwen3-Embedding-0.6B-4bit-DWQ",
    "baseUrl": "http://localhost:11434/v1",
    "apiKey": "your-api-key"
  },
  "minSearchScore": 0.40
}
```

### Provider Types

**OpenAI-compatible (default):**
```json
{
  "type": "openai",
  "model": "embedding-model-name",
  "baseUrl": "http://localhost:11434/v1",
  "apiKey": "optional-api-key"
}
```

**Bedrock:**
```json
{
  "type": "bedrock",
  "profile": "default",
  "region": "us-east-1",
  "model": "amazon.titan-embed-text-v2:0"
}
```

**Ollama:**
```json
{
  "type": "ollama",
  "url": "http://localhost:11434",
  "model": "nomic-embed-text"
}
```

### Environment Variables (overrides file values)

| Variable | Description |
|----------|-------------|
| `ENGrams_DIR` | Directory containing engram markdown files |
| `EMBEDDER_TYPE` | Embedding provider type: `openai`, `bedrock`, `ollama` |
| `EMBEDDER_BASE_URL` | Base URL for embedding API |
| `EMBEDDER_MODEL` | Embedding model name |
| `EMBEDDER_API_KEY` | API key for embedding provider |
| `EMBEDDER_DIMENSIONS` | Embedding vector dimensions |
| `MCP_CONFIG` | Custom path to config file (overrides default under XDG config dir) |
| `XDG_CONFIG_HOME` | Base directory for config (default: `~/.config`); config lives in `agent-engrams-mcp/mcp.json` |
| `USE_STDIO` | Set to `true` to use stdio mode |
| `PORT` | HTTP server port (only in HTTP mode) |

### Setup

To create a default configuration file:

```bash
mkdir -p ~/.config/agent-engrams-mcp
cp mcp.json.example ~/.config/agent-engrams-mcp/mcp.json
# Edit ~/.config/agent-engrams-mcp/mcp.json with your settings
```

Or set environment variables to override values in the config file.

## Usage

### Start the server

```bash
npm start
```

The server will start on port 3000 by default (HTTP mode).

### Stdio Mode

For local process communication (e.g., with Claude Desktop), run in stdio mode:

```bash
npm start -- --stdio
# or
USE_STDIO=true npm start
```

### Command-Line Arguments

You can override configuration values via command-line arguments:

```bash
# Override directory
npm start -- --dir=/path/to/engrams

# Override dimensions
npm start -- --dimensions=768

# Override provider (JSON format)
npm start -- --provider='{"type":"openai","model":"text-embedding-3-small","baseUrl":"https://api.openai.com/v1","apiKey":"sk-..."}'

# Combined usage
npm start -- --dir=/path/to/engrams --dimensions=768 --provider='{"type":"openai","model":"text-embedding-3-small"}'
```

### Connect as an MCP client

The server implements both Streamable HTTP and stdio transports:
- **HTTP mode**: Connect via `POST /mcp` endpoint on the configured port
- **Stdio mode**: Spawn as a child process with stdin/stdout connected

## Engram Format

Engrams are markdown files with YAML frontmatter:

```markdown
---
Category: debugging
Tags: async, testing, jest
Durability: permanent
Scope: universal
Agent: system
Date: 2024-01-01
Source: Task #123
---

# Title of the Engram

## Context

What situation triggered this learning? Include specific details.

## Insight

What was learned? What is the non-obvious part? Be specific.

## Application

**Trigger:** When to apply this knowledge
**Anti-trigger:** When NOT to apply this knowledge

## Supersedes

None
```

## Seed Engrams

The server includes three seed engrams as resources:

1. **engram-flywheel-effect.md**: Explains the knowledge flywheel concept
2. **guide-to-searching-engrams.md**: How to search effectively
3. **guide-to-writing-high-quality-engrams.md**: Best practices for writing engrams

## Development

```bash
# Type check
npm run typecheck

# Lint
npm run lint

# Format
npm run format

# Build
npm run build
```

## License

MIT