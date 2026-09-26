-- Phase 3 Step 2: the seven locked Booking & Visits permission codes (design O8). Enum
-- values only; they are committed on their own before any statement uses them. Catalog
-- rows are inserted by the operator sync (`pnpm db:permissions:sync`), as for every code.
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_BOOKINGS';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_BOOKINGS';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_QUEUE';
ALTER TYPE "PermissionCode" ADD VALUE 'REASSIGN_SERVICES';
ALTER TYPE "PermissionCode" ADD VALUE 'PERFORM_SERVICES';
ALTER TYPE "PermissionCode" ADD VALUE 'RESOLVE_SERVICE_EXECUTION';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_BOOKING_SETTINGS';
