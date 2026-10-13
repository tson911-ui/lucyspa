# CI-C1: report assistant (Wave C, 2026-10-13)

Design: `docs/PHASE_CLAUDE_INTEGRATION.md` 7.1 and the Owner's answer OQ-CI-9. Read-only by construction: there is no write tool, no SQL, and the model never sees a table. Off until the Owner turns on "Trợ lý hỏi đáp" in the AI settings and grants "Dùng trợ lý AI" to a person (global permission, standard, granted to nobody).

## What changed

- **Migration 133** (`20261213000005_claude_assistant_questions`): table `ai_assistant_questions` (who, status, question, answer, tools called with arguments, model, requests, cost, error code). The text is kept 30 days and then cleared by the worker (`purged_at`); the row stays. Insert-only apart from that clearing; never deleted (trigger).
- **Client**: `ClaudeClient.converse` (our own tool loop over the official SDK: strict tools, automatic tool choice, at most 6 calls, one 30 s deadline for the whole question, usage summed, results of the turn in one message). `generateJson` is unchanged.
- **Tools** (`apps/api/src/assistant/assistant.tools.ts`): 13 thin wrappers over the Phase 8 report services (revenue with the change against the previous period computed in code, refunds, services, products, visits, bookings, cash, fund balances, labour cost, payroll totals, advances totals, profit, ratings). Each runs with the ASKER's own token (the report's permission and branch scope apply again). The list offered to the model is cut to the reports the person may open (from the report registry) and the branch codes in the schema are only theirs. Arguments are validated (real dates, at most 366 days, a branch only from their list). Results are allow-listed projections: totals, labels, counts; never a name, phone, individual pay or advance, comment, reason or invoice code (a unit test pins this).
- **Number check** (`packages/server/src/ai/assistant.ts`): every number the answer speaks must be among the tool results (money with dots, "12,5 triệu", percentages with one-point rounding; dates, months, hours and list numbers are not figures); otherwise the answer is the fixed "Em chưa chắc chắn…" sentence, still billed and logged. The clinic word, links and markup in an answer also fail it.
- **Money and limits**: a hold on the monthly cap (feature `ASSISTANT`, sized for the worst case) before the call, released in the same transaction as the ledger row; 30 questions an hour and 100 a day per person, one at a time; a failed call bills nothing and logs the question as failed. Audit `AI_ASSISTANT_QUESTION` holds the tools and the cost, never the text.
- **Screen**: "Hỏi trợ lý" card at the top of the report pages (revenue, sales, customers, cash, pay, stock, staff, profit, reviews) for holders; says why when off (AI off, assistant off, no rate, no key); the answer, the exact dates used and buttons to the report pages it read.

## Needs on the server

The API process reads `ANTHROPIC_API_KEY` from the same `.env` as the worker (no new variable). The assistant model is the one in the AI settings (default Sonnet 5.5).

## Tests run

Unit: number check and prompt (4), tool catalogue, arguments, projections without names (5), client tool loop (10 with the whole-argument check), web helpers (3). Integration on a scratch DB: assistant (authority and switches, filtered tools, good answer with ledger, hold, question log and audit, wrong number, not-offered tool, bad arguments, refused report, limits, cap, failed call, six-call limit, 30-day text), database foundation (table rules and trigger). End to end on the audit stack with a fake model: the real revenue report answered 804.860.000 đ and the number check passed.

## UX gate

Idle, answered, not-sure, 130 % text at 360, 768, 1440 light and 1440 dark (opened and read). The ask button is secondary (the page keeps one primary action). DOM audit: the box adds no finding; the findings on the three report pages are the chart tools and the info notice that were there before.

## Open

- The box is on every report page but "Hoàn tiền" (its own frame); say if you want it there too.
- Version 1 has no question history screen; the log is for audit and cost only.
