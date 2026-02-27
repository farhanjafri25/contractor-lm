/**
 * Shared request-scoped types used across controllers.
 * Import these as `import type { ... }` in decorated method signatures.
 */
export interface RequestUser {
    userId: string;
    tenantId: string;
    role: string;
    email: string;
}
