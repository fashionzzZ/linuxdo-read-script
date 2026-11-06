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

### Modal User Cards

- Fetch user cards from `/u/{username}/card.json` on demand and cache requests by username as promises; remove rejected promises so a later click can retry.
- User-card responses can split data across `user`, `user_badges`, and `badges`. Merge side-loaded collections before rendering; featured badges may be referenced by `featured_user_badge_ids` (user-badge IDs) rather than embedded badge objects.
- Render text fields with `textContent`/`esc`; only `bio_excerpt` may use HTML because Discourse sanitizes it server-side.
- Append in-modal popovers to `.ldp-overlay`, not `.ldp-modal`, so the modal's `overflow:hidden` cannot clip them. Position them fixed against the modal rectangle.
- While a popover is open, handle Escape in the capture phase and stop propagation so the outer modal stays open. Remove all document/body/window listeners when it closes.
- Follow controls use the Follow plugin contract: show when `is_followed || can_follow`, then send `PUT` or `DELETE /follow/{username}.json`. Keep the prior state on failure and surface the error inside the card; mutate the cached card data on success.
- In-modal links use overlay-scoped `:visited` overrides when their normal color must remain stable. The site's author-level `a:visited` rule can otherwise beat component colors; define `:visited:hover` explicitly when the normal hover color should remain.

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
