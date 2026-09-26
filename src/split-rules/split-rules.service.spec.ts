import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SplitRuleOrigin, SplitRuleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { SplitRulesService } from './split-rules.service';
import { CreateSplitRuleDto } from './dto/create-split-rule.dto';
import { OverrideSplitRuleDto } from './dto/override-split-rule.dto';
import { createHash } from 'crypto';

const VENUE = 'venue-1';
const ENTERTAINER = 'ent-1';

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-1',
    venueId: VENUE,
    entertainerId: ENTERTAINER,
    entertainerBps: 7000,
    venueBps: 2500,
    platformBps: 500,
    status: SplitRuleStatus.PENDING_ENTERTAINER_APPROVAL,
    origin: SplitRuleOrigin.VENUE_PROPOSAL,
    effectiveFrom: null,
    effectiveTo: null,
    proposedByUserId: 'user-1',
    proposedAt: new Date('2026-09-26T10:00:00Z'),
    respondedAt: null,
    responseTokenHash: null,
    createdAt: new Date('2026-09-26T10:00:00Z'),
    updatedAt: new Date('2026-09-26T10:00:00Z'),
    ...overrides,
  };
}

function buildHarness(platformFeeBps = 500) {
  const tx = {
    splitRule: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(makeRule(data))),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn().mockResolvedValue(makeRule({ status: SplitRuleStatus.ACTIVE })),
    },
    splitRuleAuditEvent: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    splitRule: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    splitRuleAuditEvent: { findMany: jest.fn().mockResolvedValue([]) },
    entertainer: {
      findUnique: jest.fn().mockResolvedValue({ id: ENTERTAINER, stageName: 'DJ Neptune' }),
    },
    venue: { findUnique: jest.fn().mockResolvedValue({ id: VENUE, name: 'Quilox Nightclub' }) },
    venueEntertainer: { findFirst: jest.fn().mockResolvedValue({ id: 'link-1' }) },
    $transaction: jest.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
  };

  const platformSettings = {
    getPlatformFeeBps: jest.fn().mockResolvedValue(platformFeeBps),
  } as unknown as PlatformSettingsService;

  const service = new SplitRulesService(prisma as unknown as PrismaService, platformSettings);
  return { service, prisma, tx, platformSettings };
}

const PROPOSAL: CreateSplitRuleDto = {
  venueId: VENUE,
  entertainerId: ENTERTAINER,
  entertainerBps: 7000,
  venueBps: 2500,
};

describe('SplitRulesService.propose', () => {
  it('stamps the platform fee from settings rather than taking it from the caller', async () => {
    const h = buildHarness(500);

    await h.service.propose(PROPOSAL, 'user-1');

    expect(h.tx.splitRule.create.mock.calls[0][0].data.platformBps).toBe(500);
  });

  // The governance rule that matters: an unanswered proposal must not be able
  // to divide anyone's money.
  it('creates the rule PENDING with no effectiveFrom, so it cannot split anything', async () => {
    const h = buildHarness();

    await h.service.propose(PROPOSAL, 'user-1');

    const data = h.tx.splitRule.create.mock.calls[0][0].data;
    expect(data.status).toBe(SplitRuleStatus.PENDING_ENTERTAINER_APPROVAL);
    expect(data.origin).toBe(SplitRuleOrigin.VENUE_PROPOSAL);
    expect(data.effectiveFrom).toBeNull();
  });

  it('rejects shares that do not account for exactly what the fee leaves', async () => {
    const h = buildHarness(500);

    // 7000 + 2000 = 9000, but 9500 is splittable
    await expect(h.service.propose({ ...PROPOSAL, venueBps: 2000 }, 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('follows the platform fee when it changes, not a hardcoded 9500', async () => {
    const h = buildHarness(1000); // 9000 splittable

    await expect(h.service.propose(PROPOSAL, 'user-1')).rejects.toThrow(BadRequestException);
    await expect(
      h.service.propose({ ...PROPOSAL, entertainerBps: 6500, venueBps: 2500 }, 'user-1'),
    ).resolves.toBeDefined();
  });

  it('refuses to propose terms to an entertainer who does not work at the venue', async () => {
    const h = buildHarness();
    h.prisma.venueEntertainer.findFirst.mockResolvedValue(null);

    await expect(h.service.propose(PROPOSAL, 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects an unknown entertainer', async () => {
    const h = buildHarness();
    h.prisma.entertainer.findUnique.mockResolvedValue(null);

    await expect(h.service.propose(PROPOSAL, 'user-1')).rejects.toThrow(NotFoundException);
  });

  // Only the hash is persisted, so a database leak cannot be used to consent on
  // the entertainer's behalf.
  it('stores only a hash of the consent token and returns the token once', async () => {
    const h = buildHarness();

    const { consentToken } = await h.service.propose(PROPOSAL, 'user-1');

    const stored = h.tx.splitRule.create.mock.calls[0][0].data.responseTokenHash;
    expect(consentToken).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toBe(consentToken);
    expect(stored).toBe(createHash('sha256').update(consentToken).digest('hex'));
  });

  it('withdraws any earlier unanswered proposal so two live links cannot disagree', async () => {
    const h = buildHarness();

    await h.service.propose(PROPOSAL, 'user-1');

    expect(h.tx.splitRule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { venueId: VENUE, status: SplitRuleStatus.PENDING_ENTERTAINER_APPROVAL },
        data: expect.objectContaining({ status: SplitRuleStatus.WITHDRAWN }),
      }),
    );
  });

  it('records who proposed it in the audit trail', async () => {
    const h = buildHarness();

    await h.service.propose(PROPOSAL, 'user-7');

    const audit = h.tx.splitRuleAuditEvent.create.mock.calls[0][0].data;
    expect(audit.event).toBe('PROPOSED');
    expect(audit.actorType).toBe('VENUE_ADMIN');
    expect(audit.actorId).toBe('user-7');
  });

  it('does not close out the active rule, because nothing has been agreed yet', async () => {
    const h = buildHarness();

    await h.service.propose(PROPOSAL, 'user-1');

    expect(h.tx.splitRule.update).not.toHaveBeenCalled();
  });
});

const OVERRIDE: OverrideSplitRuleDto = {
  venueId: VENUE,
  entertainerBps: 7000,
  venueBps: 2500,
  platformBps: 500,
  reason: 'Dispute resolution ticket SC-1042',
};

describe('SplitRulesService.override', () => {
  it('activates immediately and is stamped ADMIN_OVERRIDE, never VENUE_PROPOSAL', async () => {
    const h = buildHarness();

    await h.service.override(OVERRIDE, 'admin-1');

    const data = h.tx.splitRule.create.mock.calls[0][0].data;
    expect(data.status).toBe(SplitRuleStatus.ACTIVE);
    expect(data.origin).toBe(SplitRuleOrigin.ADMIN_OVERRIDE);
    expect(data.effectiveFrom).toBeInstanceOf(Date);
  });

  // An override records no entertainer as having agreed, because none did.
  it('records no consenting entertainer', async () => {
    const h = buildHarness();

    await h.service.override(OVERRIDE, 'admin-1');

    expect(h.tx.splitRule.create.mock.calls[0][0].data.entertainerId).toBeNull();
  });

  it('writes the stated reason to the audit trail', async () => {
    const h = buildHarness();

    await h.service.override(OVERRIDE, 'admin-1');

    const audit = h.tx.splitRuleAuditEvent.create.mock.calls[0][0].data;
    expect(audit.event).toBe('ADMIN_OVERRIDE');
    expect(audit.actorType).toBe('PLATFORM_ADMIN');
    expect(audit.detail.reason).toBe('Dispute resolution ticket SC-1042');
  });

  it('accepts a platform share different from the current fee', async () => {
    const h = buildHarness(500);

    await h.service.override(
      { ...OVERRIDE, entertainerBps: 6000, venueBps: 3000, platformBps: 1000 },
      'admin-1',
    );

    expect(h.tx.splitRule.create.mock.calls[0][0].data.platformBps).toBe(1000);
  });
});

describe('SplitRulesService.respond', () => {
  const TOKEN = 'a'.repeat(64);
  const HASH = createHash('sha256').update(TOKEN).digest('hex');

  function withOpenProposal(h: ReturnType<typeof buildHarness>) {
    h.prisma.splitRule.findUnique.mockResolvedValue(makeRule({ responseTokenHash: HASH }));
  }

  it('activates the rule and sets effectiveFrom on ACCEPT', async () => {
    const h = buildHarness();
    withOpenProposal(h);

    await h.service.respond('rule-1', TOKEN, 'ACCEPT');

    const data = h.tx.splitRule.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe(SplitRuleStatus.ACTIVE);
    expect(data.effectiveFrom).toBeInstanceOf(Date);
  });

  it('never activates on REJECT and leaves effectiveFrom unset', async () => {
    const h = buildHarness();
    withOpenProposal(h);

    await h.service.respond('rule-1', TOKEN, 'REJECT');

    const data = h.tx.splitRule.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe(SplitRuleStatus.REJECTED);
    expect(data.effectiveFrom).toBeUndefined();
  });

  it('spends the token so one proposal gets one decision', async () => {
    const h = buildHarness();
    withOpenProposal(h);

    await h.service.respond('rule-1', TOKEN, 'ACCEPT');

    expect(h.tx.splitRule.updateMany.mock.calls[0][0].data.responseTokenHash).toBeNull();
  });

  // Two taps on the same link must not both activate.
  it('rejects a second answer to the same proposal', async () => {
    const h = buildHarness();
    withOpenProposal(h);
    h.tx.splitRule.updateMany.mockResolvedValue({ count: 0 });

    await expect(h.service.respond('rule-1', TOKEN, 'ACCEPT')).rejects.toThrow(ConflictException);
  });

  it('closes out the previously active rule in the same transaction on ACCEPT', async () => {
    const h = buildHarness();
    withOpenProposal(h);
    h.tx.splitRule.findMany.mockResolvedValue([
      makeRule({ id: 'old', status: SplitRuleStatus.ACTIVE }),
    ]);

    await h.service.respond('rule-1', TOKEN, 'ACCEPT');

    expect(h.tx.splitRule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'old' },
        data: expect.objectContaining({
          status: SplitRuleStatus.SUPERSEDED,
          effectiveTo: expect.any(Date),
        }),
      }),
    );
  });

  it('leaves the outgoing rule alone on REJECT', async () => {
    const h = buildHarness();
    withOpenProposal(h);
    h.tx.splitRule.findMany.mockResolvedValue([
      makeRule({ id: 'old', status: SplitRuleStatus.ACTIVE }),
    ]);

    await h.service.respond('rule-1', TOKEN, 'REJECT');

    expect(h.tx.splitRule.update).not.toHaveBeenCalled();
  });

  it('records the entertainer decision in the audit trail', async () => {
    const h = buildHarness();
    withOpenProposal(h);

    await h.service.respond('rule-1', TOKEN, 'ACCEPT');

    const audit = h.tx.splitRuleAuditEvent.create.mock.calls[0][0].data;
    expect(audit.event).toBe('ACCEPTED');
    expect(audit.actorType).toBe('ENTERTAINER');
    expect(audit.detail.via).toBe('CONSENT_TOKEN_LINK');
  });

  it('rejects a wrong token', async () => {
    const h = buildHarness();
    withOpenProposal(h);

    await expect(h.service.respond('rule-1', 'b'.repeat(64), 'ACCEPT')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a token of the wrong length without throwing a comparison error', async () => {
    const h = buildHarness();
    withOpenProposal(h);

    await expect(h.service.respond('rule-1', 'short', 'ACCEPT')).rejects.toThrow(NotFoundException);
  });

  it('rejects a proposal that is no longer open', async () => {
    const h = buildHarness();
    h.prisma.splitRule.findUnique.mockResolvedValue(
      makeRule({ responseTokenHash: HASH, status: SplitRuleStatus.ACTIVE }),
    );

    await expect(h.service.respond('rule-1', TOKEN, 'ACCEPT')).rejects.toThrow(NotFoundException);
  });

  // An unknown id and a wrong token answer identically, so the endpoint cannot
  // be used to enumerate which proposals exist.
  it('gives an unknown id and a wrong token the identical error', async () => {
    const h = buildHarness();

    h.prisma.splitRule.findUnique.mockResolvedValue(null);
    const unknownId = await h.service.respond('nope', TOKEN, 'ACCEPT').catch((e) => e);

    h.prisma.splitRule.findUnique.mockResolvedValue(makeRule({ responseTokenHash: HASH }));
    const wrongToken = await h.service.respond('rule-1', 'c'.repeat(64), 'ACCEPT').catch((e) => e);

    expect(unknownId.message).toBe(wrongToken.message);
    expect(unknownId.getStatus()).toBe(wrongToken.getStatus());
  });
});

describe('SplitRulesService.getProposedTerms', () => {
  const TOKEN = 'd'.repeat(64);
  const HASH = createHash('sha256').update(TOKEN).digest('hex');

  it('shows plain percentages and a worked example', async () => {
    const h = buildHarness();
    h.prisma.splitRule.findUnique.mockResolvedValue(makeRule({ responseTokenHash: HASH }));

    const terms = await h.service.getProposedTerms('rule-1', TOKEN);

    expect(terms.venueName).toBe('Quilox Nightclub');
    expect(terms.entertainerName).toBe('DJ Neptune');
    expect(terms.entertainerPercentage).toBe(70);
    expect(terms.venuePercentage).toBe(25);
    expect(terms.platformPercentage).toBe(5);
    // 70% of a 5,000 naira tip
    expect(terms.example).toContain('3,500');
  });
});

describe('SplitRulesService.findActiveByVenue', () => {
  it('only ever returns an ACTIVE rule, never a pending proposal', async () => {
    const h = buildHarness();
    h.prisma.splitRule.findFirst.mockResolvedValue(makeRule({ status: SplitRuleStatus.ACTIVE }));

    await h.service.findActiveByVenue(VENUE);

    expect(h.prisma.splitRule.findFirst.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ status: SplitRuleStatus.ACTIVE, effectiveTo: null }),
    );
  });

  it('throws NotFound when no rule is in force, so payments refuse rather than guess', async () => {
    const h = buildHarness();
    h.prisma.splitRule.findFirst.mockResolvedValue(null);

    await expect(h.service.findActiveByVenue(VENUE)).rejects.toThrow(NotFoundException);
  });
});

describe('SplitRulesService.findAllByVenue', () => {
  it('returns the whole history newest first, pending and rejected included', async () => {
    const h = buildHarness();

    await h.service.findAllByVenue(VENUE);

    expect(h.prisma.splitRule.findMany).toHaveBeenCalledWith({
      where: { venueId: VENUE },
      orderBy: { proposedAt: 'desc' },
    });
  });
});
