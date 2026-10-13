# CI-B2: website chat, callback inbox, booking prefill (Wave B, 2026-10-13)

Design: `docs/PHASE_CLAUDE_INTEGRATION.md` 6.3 and the Owner's answers OQ-CI-6, OQ-CI-7 (messages of 2026-10-12 and 2026-10-13). The chat is read-only by construction: it creates no booking, order, payment or discount, and the transcript is never stored. Everything is off until the Owner turns it on.

## What changed

- **Migrations 129 + 130** (`20261213000001_claude_wave_b_permission_codes`, `20261213000002_claude_wave_b_chat`): three permission codes (`MANAGE_CHAT_REQUESTS` and `USE_AI_ASSISTANT` global, `VIEW_CUSTOMER_BRIEF` branch-capable; all standard, granted to nobody; 79 to **82**), switches and models in `ai_settings` (chat, SEO/English, assistant, brief; chat cap 300 a day), table `chat_callback_requests` (status NEW/CALLED/CLOSED, reason, phone/name/note cleared with `purged_at`), and the notification type `CHAT_CALLBACK_REQUEST`.
- **API** (`apps/api/src/chat`): `POST api/v1/public/chat/messages` (JSON, exact Origin and the visitor's anonymous CSRF token like every public form: no guard exemption exists), relay to the n8n webhook (`N8N_CHAT_WEBHOOK_URL` + `CHAT_WEBHOOK_SECRET`, both or none, http only for localhost/private addresses; header secret, 20 s timeout, no redirects, strict answer reading; breaker opens after 5 failures in 60 s, one probe after 30 s), answer = plain text (HTML, links, e-mails removed, 1,500 characters) plus a booking link the API builds from the structured slot. Limits (Redis, fail closed for the bot): 8 a minute and 40 an hour per address, 30 a day per session, the shop's daily cap (settings, shop-time day); 429 with `Retry-After`. Honeypot field. `POST api/v1/public/chat/callback`: consent + a real phone (normalized to +84…), cleaned name/note, 5 an hour and 12 a day per address (never blocked by a dead counter), the same number within 10 minutes is one request; staff with `MANAGE_CHAT_REQUESTS` are told through the Notification Center (no phone in the message). Inbox `api/v1/chat-requests` (list, status forward only, row version, audit without the phone).
- **Worker**: once an hour the phone, name and note of requests closed more than 90 days ago are cleared (`runAiRetention`; the assistant and brief retention join it in their steps).
- **Settings**: "Cài đặt AI" has the four switches, the chat cap, the models of the other features and whether the n8n webhook and the bot data key exist on the server (never their values).
- **Website**: the floating contact control has a first item "Chat với Lucy" (only while the chat is on); it opens the shared dialog (a sheet on a phone): notice, greeting, conversation in rose-cream and brand pebbles, "Để lại số điện thoại, tiệm gọi lại" always available, the form shows by itself when the bot cannot answer. Staff screen "Yêu cầu gọi lại" (operations menu, 20 per page, row menu: Đã gọi, Đóng yêu cầu).
- **Booking prefill**: the booking page reads `branch`, `services` (and the old `service`), `date` and `time` from the link; the day and time are used only when valid and bookable; the sign-in hand-back now keeps the query string.
- **Bug fix (deployed Wave A)**: the bot data API's `bookingUrl` pointed at `/{locale}/book`, which does not exist; the booking page is `/{locale}/account/book`. Fixed in `availability` and shared with the chat (one builder). The n8n bots on the server link the old address until the deploy.

## Provisional (Owner/lawyer)

The notice text at the top of the chat ("trợ lý tự động, nhân viên không đọc… đừng nhập số điện thoại hay thông tin sức khỏe") and the consent line are provisional wording until the lawyer check of design 9.3.

## Tests run

Unit: chat rules (cleaning, replies, slot, link, shop day, breaker), limits (all windows, cap, fail closed/open), relay (real local HTTP server: headers, strict answers, timeout, redirect, breaker), environment, notification registry, authorization catalog, contact control, web chat helpers, prefill, nav and permissions. Integration on a scratch DB: database foundation (permissions, switches, table rules, notice pairing), settings (switches, models, cap, env flags), chat flow (10 steps incl. retention and inbox).

## UX gate

Entry, panel, reply, slot with booking button, callback form, form errors, sent, inbox, row menu and the settings page at 360, 768, 1440 light and 1440 dark (opened and read); fixed after review: the send button was squeezed to a narrow pill (now never shrinks), the inbox table heading repeated the page title. 130 % text checked on the panel.
