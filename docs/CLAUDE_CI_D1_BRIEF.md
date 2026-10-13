# CI-D1: customer card and product talking points for the staff member (Wave D, 2026-10-13)

Design: `docs/PHASE_CLAUDE_INTEGRATION.md` 7.2 and 7.3, Owner answer OQ-CI-10. **Built switched off** (`brief_enabled`, default false); a lawyer check of the wording and of what is sent to Anthropic comes before it is turned on (design 9.3). Nothing here is shown to or sent to the customer.

## What changed

- **Migration 134** (`20261213000006_claude_customer_briefs`): table `ai_customer_briefs`, one cached result per visit participant and kind (`BRIEF`, `SUGGESTIONS`) with its input hash, deleted by the worker once the day after "service date + 7 days" has passed.
- **Access** (`apps/api/src/brief`): `GET api/v1/briefs/lines/:lineId` (customer card) and `.../suggestions`. The relationship is the rule, not a role: the person must be the one assigned to that visit line (a line of someone else is "not found"), hold `VIEW_CUSTOMER_BRIEF` at the branch, and the visit must be open (not completed or cancelled) and not earlier than 2 hours before the line's planned start. Every view writes `CUSTOMER_BRIEF_VIEWED` (who, which line, which part, never the content).
- **Facts by code, no AI**: this customer's completed visits at the same branch before this one: how many, the last date, who served last time, the average days between visits, the three usual services, cosmetics bought before (names only); a guest or a child has no history.
- **Summary of staff notes** (the only AI part of the card): the newest six notes (participant notes and assignment-change notes; links, e-mails and phone numbers removed; 300 characters each) condensed to two or three lines by the model chosen in the settings. The model sees an anonymous "khách", the facts and the notes, never a name, phone, e-mail or address. The result is kept only when it passes the claim, hygiene and language checks, is at most 400 characters, adds no number the notes do not carry and names no skin condition the notes do not name; otherwise the card says it could not be summarized and still shows the facts. Cached with the visit; a new note changes the input and the summary is made again.
- **Product talking points**: candidates chosen by code (published, in stock at the branch, with an approved description, not bought by this customer in 60 days, best sellers first, at most 8); the model may only pick their ids (an enum in the answer schema), at most 3, and writes one line from the product's approved text; a line with a number the description lacks (a price, a discount) or a claim is dropped. **Deviation**: the design says "categories mapped to the service done"; the catalogue has no such mapping, so the model chooses which of the eight fit what was done today. A mapping screen would be a new feature and was not built.
- Money: each generation takes a hold and writes a ledger row (features `BRIEF` and `SUGGESTIONS`) in the same transaction as releasing it; a failed call bills nothing and caches nothing.
- **Screen**: on "Dịch vụ của tôi", the service card's menu has "Thông tin khách" (only for who holds the right at the branch and only while the visit is open); a drawer shows the facts, the notes summary (marked as written by AI) and the talking points.

## Tests run

Unit: prompts, schemas, note cleaning, summary and line checks (4), web dictionary (1). Integration on a scratch DB: access (assigned person only, branch right, open visit, 2-hour window, refused views write no event), off by default (still audited), facts, summary (anonymous request, cached, regenerated on a new note, dropped when it adds a condition or a number, failed call), talking points (candidates by code, enum picks, unchecked line dropped, cached), audit without content, retention.

## UX gate

Menu entry, the card at 360, 768, 1440 light and 1440 dark, and 130 % text (opened and read). The DOM audit script signs in with the owner's e-mail; the KTV signs in with an employee id, so this page was checked by the screenshots only.

## Open for the Owner

- The lawyer check before switching it on (what is sent: an anonymous "khách", facts, notes without contacts).
- A preference field for staff ("ghi chú sở thích") would make the card much richer; today's notes are thin (design OQ-CI-10). Not built.
- Whether a branch manager should also see the card (the design says no by default).
