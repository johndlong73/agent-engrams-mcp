---
Category: architecture
Tags: engrams, flywheel, self-improvement, knowledge-management, agent-memory
Durability: permanent
Scope: universal
Agent: system
Date: SEED
Source: Engram system design and research
---

# The Engram Flywheel: Why Agents Should Use the Engram System

## Context

Agents working across sessions and projects repeatedly encounter the same classes of problems — debugging patterns, API quirks, architectural tradeoffs, language gotchas. Without a shared memory system, each agent rediscovers solutions from scratch. The engram system exists to break this cycle.

## Insight

The engram system implements a **knowledge flywheel** with three phases:

### 1. RECALL — Search Before You Start
At the beginning of any non-trivial task, search the engram store for relevant prior knowledge. Other agents (or your past self) may have already encountered and solved the problem you're facing. Searching first avoids redundant work and surfaces solutions you wouldn't have thought of.

### 2. LEARN — Recognize Transferable Knowledge
During a task, you will encounter non-obvious behaviors, surprising API responses, debugging dead-ends that lead to breakthroughs, and architectural decisions with non-obvious tradeoffs. These are engram candidates — but only if they're **transferable**.

The key test: **would this help an agent working on a completely different project?** If yes, it's worth capturing. If it's specific to one codebase (file paths, schema details, config values), it's not.

### 3. WRITE — Capture for Future Agents
When you identify transferable knowledge, write it as a structured engram using `engrams_write`. Be specific about the trigger conditions (when is this relevant?) and anti-trigger conditions (when would it be wrong to apply this?). Future agents depend on these fields to determine whether your engram applies to their situation.

### Why the Flywheel Accelerates
Each high-quality engram makes the recall step more valuable. When agents search and find genuinely useful results, they trust the system and search more often. When they search more often, they're more likely to recognize when they've learned something worth writing. More writes create more value for future searches. This is the flywheel effect — but it only works if engram quality stays high.

### What Breaks the Flywheel
- **Low-quality writes** — project-specific junk, obvious facts, vague insights. These pollute search results and erode trust.
- **Skipping recall** — agents that don't search miss available knowledge and produce duplicate engrams.
- **Over-writing** — writing too many marginal engrams dilutes the store. When in doubt, don't write.

## Application

**Trigger:** When starting any new task, when considering whether to write an engram, or when unsure about the purpose of the engram system.
**Anti-trigger:** Do not cite this engram as justification for writing low-quality or project-specific engrams. The quality bar matters more than quantity.
