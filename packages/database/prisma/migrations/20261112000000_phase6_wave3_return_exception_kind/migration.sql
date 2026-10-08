-- Phase 6 P6-12 follow-up (Owner, 2026-10-08), migration 1 of 2: enum value only.
-- A new enum value cannot be used in the transaction that adds it, so it is committed on its own here (as 20261109000000 did) and the
-- migration that follows (20261112000001) builds everything that uses it.
--   ProductReturnEventKind WINDOW_EXCEPTION: the Owner opened a case after its return window with a written reason.

ALTER TYPE "ProductReturnEventKind" ADD VALUE 'WINDOW_EXCEPTION';
