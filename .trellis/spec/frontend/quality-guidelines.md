# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

### Discourse Polls in Modal Posts

- Use `post.polls` and `post.polls_votes` as the authoritative state. The cooked `.poll` node is only a location marker and source for its sanitized title.
- Render only the supported Discourse poll types (`regular` and `multiple`). Unsupported or incomplete poll data must keep the cooked DOM unchanged.
- Treat numeric `votes` fields on every option as the server-side permission to show results. Do not infer visibility from `poll.results` in the userscript.
- Encode array request values as repeated `key[]` form fields; Discourse poll voting requires multiple `options[]` values for multi-select polls.
- Keep multiple-poll selections local until submit. On request failure, preserve those selections and show the error inside the poll block.
- Any post inserted into the modal after initial load must carry poll data and be registered in the modal post lookup before its poll controls can be used.

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
