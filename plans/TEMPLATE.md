# <Plan title>

**Branch:** `<branch>`
**Started:** `<YYYY-MM-DD>`
**Status:** in-progress | paused | completed | abandoned
**Plan file (local):** `~/.claude/plans/<slug>.md` (Claude's working copy — not committed)

## Problem

What are we trying to solve? Why is it worth doing? What's failing or suboptimal today?

## Plan

Phased list. Each phase should be testable/reversible on its own.

- **Phase 1 — <name>.** <brief>
- **Phase 2 — <name>.** <brief>
- ...

### Safety rails

Things we will NOT do (no-push-to-main, no-bypass-failing-tests, time caps, etc).

### Fallback

If the plan fails, how do we get back to a safe state?

## Status log

Append one entry per phase transition or material event. Each entry opens with
an ISO-8601 UTC timestamp heading. Do not edit prior entries — this log is a
chronological ledger.

### YYYY-MM-DDTHH:MMZ — <event>

Body: what happened, what the state of the branch is, and what's next.
