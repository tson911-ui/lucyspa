# CI-B1: the bot data API (Wave A, 2026-10-12)

Design: `docs/PHASE_CLAUDE_INTEGRATION.md` section 6.2; Owner answers OQ-CI-6 and OQ-CI-7. The n8n bots read shop facts, prices and slots from here instead of a copy kept by hand; they can never write, and bookings stay member-only.

## What changed

- **Migration 127** `20261212000004_claude_discount_bot_visible`: `discounts.bot_visible` (default false). Discount detail screen: "Cho bot nhắc đến" / "Không cho bot nhắc đến" in the header menu of a code-free program (`POST api/v1/discounts/:id/bot-visible`, `MANAGE_DISCOUNTS`, audited with before/after, refused for a code program or a terminated one).
- **The listener** (`apps/api/src/bot`): a second `http` server inside the API process on `BOT_DATA_HOST:BOT_DATA_PORT` (default `127.0.0.1:3101`), **no new pm2 process**. No `BOT_DATA_KEY` means no listener; the port must differ from `API_PORT`; a start failure (port taken) is logged and never touches the API. nginx and the web proxy forward to the API's own port only (a test pins that the web config has no bot route).
- **Layers**: separate port; `Authorization: Bearer <BOT_DATA_KEY>` compared in constant time (a missing or wrong key is the same 401 whatever the path); GET only (405 otherwise); 60 requests a minute; allow-list serializers (a test serializes every answer and fails on any key outside `BOT_ALLOWED_KEYS`, and on cost, SKU, barcode, quantity, e-mail, voucher, review words); server cache 60 s (15 s for slots) with ETag/304; unexpected errors answer a bare 500 and never repeat the message.
- **Endpoints** (`/bot/v1/…`, `?locale=vi|en`): `shop` (name, tagline, address, hotline, map, Facebook/Zalo/Messenger, hours in words, open now, branch codes), `services` (groups, services, public price range, per-nail flag, customer time estimate), `promotions` (only programs the Owner ticked that have no code, are active, not terminated and inside their dates; name, conditions in words, dates; **never a code, limit or customer**), `products` (the public catalog: published and priced only, public price, `inStock`/`preOrder` as flags, product page URL), `availability` (`branch`, `date`, 1 to 3 service codes: start times only, from the booking planner with the employee fixed to ANY and no customer; plus the booking page URL), `knowledge` (one bundle for the prompt, read one part after the other to spare the connection pool), `health`.

## Not done / deviations

- **Book-page prefill** (design 6.2, last bullet): the booking page does not read URL parameters yet, so the link opens the booking page without prefilling it. A later web step adds the prefill; nothing else depends on it.
- The practical check of availability with real shifts and employees is the Owner's n8n test; the planner call is the member endpoint's own code with ANY lines and no customer (the engine already accepted `customerUserId` being absent). Bad input is covered by tests.
- Docker n8n: its "localhost" is the container's; the guide starts with that check (see the deploy guide).

## Tests run

Unit: server (auth, rate window, 401/405/404/429/304/500, cache), serializers (hours, open now, promotions words, allow-list), environment (key, port), web proxy isolation. Integration on a scratch DB: promotions rules and the tick (6 hidden cases), products and bundle with an allow-list scan, availability input refusals; discount tick audit. Root lint, typecheck, format, whole-repo tests.
