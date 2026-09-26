import { Injectable, Logger } from '@nestjs/common';
import { PlatformSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** The one row. Pinned by a database CHECK, not by convention. */
const SINGLETON_ID = 'singleton';

/** Used only if the settings row is somehow absent; matches the migration. */
const DEFAULT_PLATFORM_FEE_BPS = 500;

/**
 * The platform's own cut.
 *
 * Deliberately a single global value rather than per-venue overrides: a
 * per-venue fee is the thing that lets the number be quietly negotiated
 * downward for one venue and not another, which is exactly the opacity this
 * product exists to remove. One number, one place, one role that can change it.
 */
@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Readable by any authenticated caller, including VENUE_ADMIN — a venue
   * dashboard has to be able to show the fee it is being charged. There is no
   * write path on this service reachable from a venue-scoped route.
   */
  async get(): Promise<PlatformSettings> {
    const existing = await this.prisma.platformSettings.findUnique({
      where: { id: SINGLETON_ID },
    });
    if (existing) return existing;

    // Self-heal rather than 500: the migration seeds this row, so its absence
    // means a database restored from before the migration.
    this.logger.warn('Platform settings row missing; creating it with the default fee', {
      platformFeeBps: DEFAULT_PLATFORM_FEE_BPS,
    });
    return this.prisma.platformSettings.create({
      data: { id: SINGLETON_ID, platformFeeBps: DEFAULT_PLATFORM_FEE_BPS },
    });
  }

  /** Convenience for callers that only need the number. */
  async getPlatformFeeBps(): Promise<number> {
    return (await this.get()).platformFeeBps;
  }

  /**
   * PLATFORM_ADMIN only — enforced by @Roles on the controller. Changing the
   * fee never rewrites split rules already in force: those keep the platformBps
   * they were agreed under, and the new fee applies to the next rule proposed.
   */
  async update(platformFeeBps: number, updatedByUserId: string): Promise<PlatformSettings> {
    const previous = await this.get();

    const updated = await this.prisma.platformSettings.update({
      where: { id: SINGLETON_ID },
      data: { platformFeeBps, updatedByUserId },
    });

    this.logger.log('Platform fee changed', {
      fromBps: previous.platformFeeBps,
      toBps: platformFeeBps,
      updatedByUserId,
    });

    return updated;
  }
}
