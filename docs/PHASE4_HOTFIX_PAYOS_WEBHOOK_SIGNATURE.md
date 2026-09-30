# Hotfix: PayOS webhook signature verification (after 82a0862)

## Symptom

PayOS's webhook URL confirmation call to `/api/v1/webhooks/payos` was answered `401 AUTHENTICATION_FAILED`.

## Findings (PayOS docs + official SDK rules, re-verified 2026-09-30)

- Signature = HMAC-SHA256 (checksum key, hex) over `data`: keys sorted ascending, `key=value` joined by `&`, null/`"null"`/`"undefined"` as
  empty, arrays as JSON with each item's keys sorted. Our canonical form already matches: PayOS's documented sample
  (key `1a54716c…7675`) reproduces the documented signature `412e915d…eaa03` exactly, so the algorithm is not the defect.
- The defect is the ORDER of checks: `verifyNotification` parsed the whole body with a strict schema (`success`, `reference`
  min 1, positive `orderCode`/`amount`) BEFORE looking at the signature. Any authentic delivery not shaped like a real payment
  (the confirmation probe) failed that parse and got the same 401 as a forgery, in a few ms.
- I could not observe the live probe body. The exact field that failed in production is therefore inferred, not proven;
  the new sanitized log line will name the rejection reason on the next attempt.

## Changes

- `PaymentProvider.checkNotification(body)` (new): signature over `data` alone first; then interpretation.
  Result: `REJECTED{reason, signatureLength, dataFields}` | `UNACTIONABLE` | `VERIFIED`. `verifyNotification` is kept on top of it.
- Signature hex compare is case-insensitive (PayOS's own helpers lower-case both sides).
- Webhook service: `UNACTIONABLE` (authentic, no actionable payment) answers 200 `{received:true}` and touches nothing;
  `REJECTED` still answers the constant 401 (429 when throttled) and logs `PayOS webhook refused` with reason
  (`BODY_NOT_OBJECT|DATA_MISSING|SIGNATURE_MISSING|SIGNATURE_MISMATCH`), signature length, `data` field NAMES and body size. Never a key,
  signature or value.
- A verified success notification for an unknown order is unchanged: 200, recorded as `IGNORED/UNKNOWN_ORDER`, nothing applied.

## Migrations / permissions

None.

## Tests run

- `packages/server` `payos.test.ts`: 9 pass (new: PayOS documented vector incl. null fields and upper-case hex; authentic
  non-payment probe is UNACTIONABLE; rejection detail is sanitized).
- `apps/api` `payos.http.test.ts`: pass (new: signed probe answers 200, no database access).
- `tsc` server + api, eslint and prettier on touched files: clean. Full regression not run (Owner's rule).

## Open questions

- If PayOS still reports 401 after deploy, read the `PayOS webhook refused` log line: `SIGNATURE_MISMATCH` with the expected
  `dataFields` means the checksum key on the server differs from the one in the PayOS channel.
