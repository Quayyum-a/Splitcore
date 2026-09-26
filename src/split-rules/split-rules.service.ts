import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Prisma, SplitRule, SplitRuleOrigin, SplitRuleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { CreateSplitRuleDto } from './dto/create-split-rule.dto';
import { OverrideSplitRuleDto } from './dto/override-split-rule.dto';
import { SplitRuleTermsDto } from './dto/respond-split-rule.dto';

export interface ProposedSplitRule {
  rule: SplitRule;
  /** Raw token. Returned once, never stored, never logged. */
  consentToken: string;
}

/** Statuses a rule can be in while still awaiting an answer. */
const OPEN_PROPOSAL: SplitRuleStatus = SplitRuleStatus.PENDING_ENTERTAINER_APPROVAL;

@Injectable()
export class SplitRulesService {
  private readonly logger = new Logger(SplitRulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  /**
   * A venue proposes venue/entertainer shares. Nothing takes effect here.
   *
   * The platform's cut is stamped on from stored settings, so a venue cannot
   * express an opinion about it (the DTO has no field for it and the global
   * ValidationPipe rejects one that appears anyway). The two shares the venue
   * does control must account for exactly what is left.
   */
  async propose(dto: CreateSplitRuleDto, proposedByUserId: string): Promise<ProposedSplitRule> {
    const platformBps = await this.platformSettings.getPlatformFeeBps();
    const splittableBps = 10000 - platformBps;
    const proposedSum = dto.entertainerBps + dto.venueBps;

    if (proposedSum !== splittableBps) {
      throw new BadRequestException(
        `entertainerBps + venueBps must equal ${splittableBps} ` +
          `(10000 minus the ${platformBps} bps platform fee), but got ${proposedSum}.`,
      );
    }

    const entertainer = await this.prisma.entertainer.findUnique({
      where: { id: dto.entertainerId },
    });
    if (!entertainer) {
      throw new NotFoundException(`Entertainer ${dto.entertainerId} not found`);
    }

    // Proposing terms to someone who does not perform at the venue is
    // meaningless, and would let any venue collect a signature from anyone.
    const link = await this.prisma.venueEntertainer.findFirst({
      where: { venueId: dto.venueId, entertainerId: dto.entertainerId },
    });
    if (!link) {
      throw new BadRequestException(
        'That entertainer is not linked to this venue, so they cannot agree terms for it.',
      );
    }

    // Only the hash is stored: a leaked database must not let anyone consent
    // on the entertainer's behalf.
    const consentToken = randomBytes(32).toString('hex');
    const responseTokenHash = hashToken(consentToken);

    const rule = await this.prisma.$transaction(async (tx) => {
      // Supersede any earlier unanswered proposal for this venue, so an
      // entertainer cannot be handed two live links with different terms.
      const withdrawn = await tx.splitRule.updateMany({
        where: { venueId: dto.venueId, status: OPEN_PROPOSAL },
        data: { status: SplitRuleStatus.WITHDRAWN, responseTokenHash: null },
      });

      const created = await tx.splitRule.create({
        data: {
          venueId: dto.venueId,
          entertainerId: dto.entertainerId,
          entertainerBps: dto.entertainerBps,
          venueBps: dto.venueBps,
          platformBps,
          status: OPEN_PROPOSAL,
          origin: SplitRuleOrigin.VENUE_PROPOSAL,
          proposedByUserId,
          // Deliberately null: not in force, so no date from which it applied.
          effectiveFrom: null,
          effectiveTo: null,
          responseTokenHash,
        },
      });

      await writeAudit(tx, created.id, 'PROPOSED', 'VENUE_ADMIN', proposedByUserId, {
        entertainerBps: dto.entertainerBps,
        venueBps: dto.venueBps,
        platformBps,
        entertainerId: dto.entertainerId,
        withdrewOpenProposals: withdrawn.count,
      });

      return created;
    });

    this.logger.log('Split rule proposed, awaiting entertainer consent', {
      splitRuleId: rule.id,
      venueId: dto.venueId,
      entertainerId: dto.entertainerId,
    });

    return { rule, consentToken };
  }

  /**
   * PLATFORM_ADMIN force-set, for genuine operational necessity. Takes effect
   * at once and is stamped ADMIN_OVERRIDE, so nothing downstream can mistake it
   * for terms an entertainer agreed to.
   */
  async override(dto: OverrideSplitRuleDto, adminUserId: string): Promise<SplitRule> {
    const rule = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await this.closeOutActive(tx, dto.venueId, now);

      const created = await tx.splitRule.create({
        data: {
          venueId: dto.venueId,
          // No entertainer agreed to this, so none is recorded as having done so.
          entertainerId: null,
          entertainerBps: dto.entertainerBps,
          venueBps: dto.venueBps,
          platformBps: dto.platformBps,
          status: SplitRuleStatus.ACTIVE,
          origin: SplitRuleOrigin.ADMIN_OVERRIDE,
          proposedByUserId: adminUserId,
          effectiveFrom: now,
          effectiveTo: null,
        },
      });

      await writeAudit(tx, created.id, 'ADMIN_OVERRIDE', 'PLATFORM_ADMIN', adminUserId, {
        reason: dto.reason,
        entertainerBps: dto.entertainerBps,
        venueBps: dto.venueBps,
        platformBps: dto.platformBps,
      });

      return created;
    });

    this.logger.warn('Split rule force-set by platform admin, bypassing entertainer consent', {
      splitRuleId: rule.id,
      venueId: dto.venueId,
      adminUserId,
      reason: dto.reason,
    });

    return rule;
  }

  /** The terms to show an entertainer before they decide. */
  async getProposedTerms(splitRuleId: string, token: string): Promise<SplitRuleTermsDto> {
    const rule = await this.findByConsentToken(splitRuleId, token);

    const [venue, entertainer] = await Promise.all([
      this.prisma.venue.findUnique({ where: { id: rule.venueId } }),
      rule.entertainerId
        ? this.prisma.entertainer.findUnique({ where: { id: rule.entertainerId } })
        : Promise.resolve(null),
    ]);

    const exampleTipKobo = 500_000;
    const entertainerCutKobo = Math.floor((exampleTipKobo * rule.entertainerBps) / 10000);

    return {
      venueName: venue?.name ?? 'Unknown venue',
      entertainerName: entertainer?.stageName ?? 'Unknown entertainer',
      entertainerPercentage: rule.entertainerBps / 100,
      venuePercentage: rule.venueBps / 100,
      platformPercentage: rule.platformBps / 100,
      entertainerBps: rule.entertainerBps,
      venueBps: rule.venueBps,
      platformBps: rule.platformBps,
      proposedAt: rule.proposedAt,
      example:
        `On a ${formatNaira(exampleTipKobo)} tip you would receive ` +
        `${formatNaira(entertainerCutKobo)}.`,
    };
  }

  /**
   * The entertainer's answer. Accepting activates the rule and closes out the
   * previously-active one in the same transaction, so there is never a moment
   * with two active rules or none.
   */
  async respond(
    splitRuleId: string,
    token: string,
    decision: 'ACCEPT' | 'REJECT',
  ): Promise<SplitRule> {
    const rule = await this.findByConsentToken(splitRuleId, token);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Re-read inside the transaction and require it to still be open, so two
      // taps on the link cannot both activate.
      const claimed = await tx.splitRule.updateMany({
        where: { id: rule.id, status: OPEN_PROPOSAL },
        data:
          decision === 'ACCEPT'
            ? {
                status: SplitRuleStatus.ACTIVE,
                effectiveFrom: now,
                respondedAt: now,
                // Burn the token: one decision per proposal.
                responseTokenHash: null,
              }
            : {
                status: SplitRuleStatus.REJECTED,
                respondedAt: now,
                responseTokenHash: null,
              },
      });

      if (claimed.count === 0) {
        throw new ConflictException('This proposal has already been answered.');
      }

      if (decision === 'ACCEPT') {
        // Close the outgoing rule only now that the incoming one is certain.
        await this.closeOutActive(tx, rule.venueId, now, rule.id);
      }

      await writeAudit(
        tx,
        rule.id,
        decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
        'ENTERTAINER',
        rule.entertainerId,
        { via: 'CONSENT_TOKEN_LINK' },
      );

      const updated = await tx.splitRule.findUniqueOrThrow({ where: { id: rule.id } });

      this.logger.log('Entertainer answered a split proposal', {
        splitRuleId: rule.id,
        venueId: rule.venueId,
        decision,
      });

      return updated;
    });
  }

  async findAllByVenue(venueId: string): Promise<SplitRule[]> {
    return this.prisma.splitRule.findMany({
      where: { venueId },
      orderBy: { proposedAt: 'desc' },
    });
  }

  /**
   * The rule money is actually divided by. A pending proposal is not one, which
   * is the whole point of the status: an unanswered proposal must never split a
   * guest's tip.
   */
  async findActiveByVenue(venueId: string): Promise<SplitRule> {
    const activeRule = await this.prisma.splitRule.findFirst({
      where: { venueId, status: SplitRuleStatus.ACTIVE, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!activeRule) {
      throw new NotFoundException(`No active split rule found for venue ${venueId}`);
    }

    return activeRule;
  }

  /** Full history for a rule, oldest first. Append-only; enforced by trigger. */
  async findAuditTrail(splitRuleId: string) {
    return this.prisma.splitRuleAuditEvent.findMany({
      where: { splitRuleId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Looks a proposal up by id and verifies the token against the stored hash.
   *
   * Compared with timingSafeEqual, and the "wrong token" and "no such proposal"
   * answers are identical, so the endpoint cannot be used to discover which
   * proposal ids exist.
   */
  private async findByConsentToken(splitRuleId: string, token: string): Promise<SplitRule> {
    const notFound = new NotFoundException('This approval link is not valid.');

    const rule = await this.prisma.splitRule.findUnique({ where: { id: splitRuleId } });
    if (!rule || !rule.responseTokenHash) throw notFound;

    const provided = Buffer.from(hashToken(token), 'hex');
    const stored = Buffer.from(rule.responseTokenHash, 'hex');
    if (provided.length !== stored.length || !timingSafeEqual(provided, stored)) {
      throw notFound;
    }
    if (rule.status !== OPEN_PROPOSAL) throw notFound;

    return rule;
  }

  /** Ends the venue's currently-active rule, leaving the history intact. */
  private async closeOutActive(
    tx: Prisma.TransactionClient,
    venueId: string,
    at: Date,
    exceptRuleId?: string,
  ): Promise<void> {
    const outgoing = await tx.splitRule.findMany({
      where: {
        venueId,
        status: SplitRuleStatus.ACTIVE,
        effectiveTo: null,
        ...(exceptRuleId ? { id: { not: exceptRuleId } } : {}),
      },
    });

    for (const rule of outgoing) {
      // Never edited away, only closed: append-only versioning.
      await tx.splitRule.update({
        where: { id: rule.id },
        data: { status: SplitRuleStatus.SUPERSEDED, effectiveTo: at },
      });
      await writeAudit(tx, rule.id, 'SUPERSEDED', 'SYSTEM', null, {
        supersededBy: exceptRuleId ?? null,
      });
    }
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function formatNaira(kobo: number): string {
  return `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  splitRuleId: string,
  event: string,
  actorType: string,
  actorId: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  await tx.splitRuleAuditEvent.create({
    data: { splitRuleId, event, actorType, actorId, detail: detail as Prisma.InputJsonValue },
  });
}
