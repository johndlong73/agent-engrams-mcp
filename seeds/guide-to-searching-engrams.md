---
Category: tooling
Tags: engrams, search, recall, query, best-practices, guide
Durability: permanent
Scope: universal
Agent: system
Date: SEED
Source: Engram system design and research
---

# Guide to Searching Engrams Effectively

## Context

The engram store uses semantic search over embeddings. This means search quality depends heavily on how you formulate your query. A vague query returns vague results; a specific technical query surfaces precise, actionable knowledge.

## Insight

### When to Search
- **At the start of any non-trivial task** — before writing code or making decisions. Follow up with targeted queries when the task involves debugging, API integration, architectural decisions, or unfamiliar technology.
- **When you hit a wall** — if debugging takes more than a few minutes, search for the symptoms you're observing. Another agent may have documented the exact pattern.
- **Before writing an engram** — search first to avoid duplicates. If a similar engram exists, consider updating it (via supersedes) rather than writing a new one.

### How to Write Good Queries

**Be specific and technical:**
- GOOD: "JWT token validation fails silently no error message"
- GOOD: "Express middleware execution order authentication"
- GOOD: "PostgreSQL UUID cursor pagination sorting"
- BAD: "authentication" (too broad)
- BAD: "debug" (matches everything)
- BAD: "fix the bug" (no technical content)

**Describe the PROBLEM, not the task:**
- GOOD: "streaming API response JSON parse error non-JSON line"
- BAD: "implement streaming endpoint" (describes what you're building, not what might go wrong)

**Use the terminology that would appear in an engram's insight:**
- If you're debugging a memory leak, search "memory leak AbortController fetch cleanup" not "my app uses too much RAM"
- If you're fighting CSS layout, search "CSS Grid overflow content shrink" not "the layout is broken"

### Using Search Filters

The `engrams_search` tool supports metadata filters that narrow results:

| Filter | When to use |
|--------|-------------|
| `category: "debugging"` | When you're actively debugging a specific issue |
| `category: "api"` | When integrating with an external API |
| `category: "architecture"` | When making design decisions |
| `durability: "permanent"` | When you want only verified, stable knowledge |
| `tags: ["typescript", "async"]` | When working in a specific technology area |
| `scope: "universal"` | When you want patterns that apply regardless of technology |

### Interpreting Results

- **Higher-ranked results** are more likely to be relevant — read these carefully and incorporate them.
- **Lower-ranked results** may be tangentially related — skim to check applicability.
- **Check the durability field** — `hypothesis` engrams are unverified and may be wrong. `workaround` engrams may be outdated. `permanent` engrams are the most reliable.
- **Check the supersedes field** — if an engram supersedes another, prefer the newer one. The older engram may contain outdated information.
- **Check the anti-trigger** — make sure your situation doesn't match the conditions where the engram should NOT be applied.

### Multiple Searches

Don't rely on a single query. For complex tasks, search from multiple angles:
1. Search for the technology: "PostgreSQL connection pooling"
2. Search for the symptom: "database connection timeout under load"
3. Search for the pattern: "connection pool exhaustion retry backoff"

Each query may surface different engrams that together give you a complete picture.

## Application

**Trigger:** When about to search the engram store, when search results seem poor, or when learning how to use the engram system.
**Anti-trigger:** Do not over-search for trivial tasks (typo fixes, simple renames, formatting changes). Manual search is for tasks where prior knowledge would meaningfully change your approach.
