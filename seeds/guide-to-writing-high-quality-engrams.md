---
Category: tooling
Tags: engrams, writing, quality, best-practices, guide
Durability: permanent
Scope: universal
Agent: system
Date: SEED
Source: Engram system design and research
---

# Guide to Writing High-Quality Engrams

## Context

The value of the engram store depends entirely on the quality of what's written to it. A store full of project-specific facts, vague observations, or obvious best practices is worse than an empty store — it wastes search time and erodes trust in the system.

## Insight

### The Transferability Test
Before writing any engram, ask: **would this help an agent working on a completely different project, in a different language, in a different domain?** This single question filters out most low-value engrams.

### What Makes a Good Engram

**Good engrams capture non-obvious, transferable patterns:**
- A debugging technique that applies broadly: "When async tests pass individually but fail together, check for shared mutable state in module-level variables — Jest doesn't reset module state between tests by default."
- An API quirk that isn't well-documented: "The OpenAI streaming API sends `[DONE]` as a non-JSON line in SSE streams. Always guard `JSON.parse()` calls with a sentinel check."
- An architectural insight with real tradeoffs: "Cursor-based pagination is more stable than offset-based for tables with frequent inserts, but requires a monotonically increasing column — UUID v4 breaks this, UUID v7 works."
- A language gotcha: "In Python, default mutable arguments (e.g., `def foo(items=[])`) are shared across all calls. Use `None` as default and create inside the function."

**Good engrams have specific trigger and anti-trigger conditions:**
- Trigger: "When JWT authentication fails silently with no error message" — specific, searchable.
- Anti-trigger: "Does not apply to OAuth token refresh flows, which have a different failure mode" — prevents misapplication.

### What NOT to Write

**Project-specific facts:**
- BAD: "The users table primary key is a UUID in this project"
- BAD: "The API base URL is configured in src/config/api.ts"
- BAD: "The auth middleware is at src/middleware/auth.ts"
- WHY: These are useless to any agent not working on that exact project.

**Obvious best practices:**
- BAD: "Always handle errors in async functions"
- BAD: "Use meaningful variable names"
- BAD: "Write tests for your code"
- WHY: Every agent already knows these. Engrams should teach something non-obvious.

**Vague observations:**
- BAD: "The code had a bug that was fixed"
- BAD: "Performance was improved by optimizing the query"
- BAD: "The configuration needed to be updated"
- WHY: These contain no actionable knowledge. What was the bug? What optimization? What configuration?

**One-time configuration values:**
- BAD: "Set REDIS_URL to redis://localhost:6379"
- BAD: "The CI pipeline uses Node 20"
- WHY: Configuration is project-specific and changes frequently.

### Field-by-Field Guidance

| Field | Guidance |
|-------|----------|
| **title** | Specific and descriptive. Include the core insight. "API quirk: OpenAI streaming sends non-JSON [DONE] sentinel" not "OpenAI API issue". |
| **category** | Choose the most specific: `debugging`, `api`, `architecture`, `tooling`, `domain`, `performance`, `testing`. |
| **scope** | Prefer `universal` or `language`. Use `framework` sparingly. Avoid `project`. |
| **durability** | `permanent` for verified, stable knowledge. `workaround` for temporary fixes. `hypothesis` for unverified insights. |
| **trigger** | Describe a GENERAL situation, not a project context. "When JWT auth fails silently" not "When the auth module in project X breaks". |
| **anti_trigger** | When would this knowledge be WRONG to apply? Be specific. |
| **tags** | 3-6 specific, searchable keywords. Include the technology, the problem type, and the domain. |
| **supersedes** | If this replaces an older engram, point to it. Creates an invalidation chain. |

### The Quality Bar
- Fewer high-quality engrams are far better than many low-quality ones
- If you're unsure whether to write an engram, don't
- Re-read your engram before submitting — would you find this useful if you encountered it during a search?

## Application

**Trigger:** When considering writing a new engram, when reviewing engram quality, or when unsure what makes a good engram.
**Anti-trigger:** Do not use this as a checklist to force-write engrams that don't meet the transferability test. The best response to "should I write this?" is often "no."
