-- Follow-up Step 6: collaborator work schedule permissions (code-owned catalog). Enum
-- values only; they are committed on their own before any statement uses them. Catalog
-- rows are inserted by the operator sync (`pnpm db:permissions:sync`), as for every code.
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_WORK_SCHEDULE';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_WORK_SCHEDULE';
