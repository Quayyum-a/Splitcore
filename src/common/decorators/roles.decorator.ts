import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

// Usage: @Roles(Role.PLATFORM_ADMIN) on a controller method, combined with
// RolesGuard. Kept separate from JwtAuthGuard deliberately — authentication
// (who are you) and authorization (what are you allowed to do) are
// different questions, and Phase 2+ will need routes that require the
// former without the latter.
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
