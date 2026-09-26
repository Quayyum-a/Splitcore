import { ConfigService } from '@nestjs/config';
import { SplitRuleOrigin, SplitRuleStatus } from '@prisma/client';
import { SplitRulesController } from './split-rules.controller';
import { SplitRulesService } from './split-rules.service';

const TOKEN = 'f'.repeat(64);

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-1',
    venueId: 'venue-1',
    entertainerId: 'ent-1',
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
    // Present on the entity, and must never survive into a response.
    responseTokenHash: 'a-secret-hash',
    createdAt: new Date('2026-09-26T10:00:00Z'),
    updatedAt: new Date('2026-09-26T10:00:00Z'),
    ...overrides,
  };
}

function buildHarness(config: Record<string, string | undefined> = {}) {
  const service = {
    propose: jest.fn().mockResolvedValue({ rule: makeRule(), consentToken: TOKEN }),
    override: jest.fn().mockResolvedValue(
      makeRule({
        status: SplitRuleStatus.ACTIVE,
        origin: SplitRuleOrigin.ADMIN_OVERRIDE,
        entertainerId: null,
        effectiveFrom: new Date('2026-09-26T10:00:00Z'),
      }),
    ),
    respond: jest.fn().mockResolvedValue(makeRule({ status: SplitRuleStatus.ACTIVE })),
    getProposedTerms: jest.fn().mockResolvedValue({ venueName: 'Quilox' }),
    findAllByVenue: jest.fn().mockResolvedValue([makeRule()]),
    findActiveByVenue: jest.fn().mockResolvedValue(makeRule({ status: SplitRuleStatus.ACTIVE })),
    findAuditTrail: jest.fn().mockResolvedValue([{ event: 'PROPOSED' }]),
  };
  const configService = {
    get: jest.fn((key: string) => config[key]),
  } as unknown as ConfigService;

  const controller = new SplitRulesController(
    service as unknown as SplitRulesService,
    configService,
  );
  return { controller, service };
}

const REQ = { user: { id: 'user-1' } };

describe('SplitRulesController.propose', () => {
  it('returns a consent URL on the frontend origin', async () => {
    const h = buildHarness({ FRONTEND_URL: 'https://splitcore-app.netlify.app' });

    const result = await h.controller.propose(
      { venueId: 'venue-1', entertainerId: 'ent-1', entertainerBps: 7000, venueBps: 2500 },
      REQ,
    );

    expect(result.consentUrl).toBe(
      `https://splitcore-app.netlify.app/split-rules/rule-1/respond/${TOKEN}`,
    );
    expect(result.consentToken).toBe(TOKEN);
  });

  it('tolerates a trailing slash on the configured origin', async () => {
    const h = buildHarness({ FRONTEND_URL: 'https://splitcore-app.netlify.app/' });

    const result = await h.controller.propose(
      { venueId: 'venue-1', entertainerId: 'ent-1', entertainerBps: 7000, venueBps: 2500 },
      REQ,
    );

    expect(result.consentUrl).not.toContain('.app//');
  });

  it('falls back to APP_URL when no frontend origin is configured', async () => {
    const h = buildHarness({ APP_URL: 'https://splitcore-api.onrender.com' });

    const result = await h.controller.propose(
      { venueId: 'venue-1', entertainerId: 'ent-1', entertainerBps: 7000, venueBps: 2500 },
      REQ,
    );

    expect(result.consentUrl).toContain('https://splitcore-api.onrender.com/split-rules/');
  });

  // The hash is the only thing preventing someone who sees a response body from
  // consenting on the entertainer's behalf.
  it('never leaks responseTokenHash', async () => {
    const h = buildHarness({ FRONTEND_URL: 'https://x.example.com' });

    const result = await h.controller.propose(
      { venueId: 'venue-1', entertainerId: 'ent-1', entertainerBps: 7000, venueBps: 2500 },
      REQ,
    );

    expect(result).not.toHaveProperty('responseTokenHash');
    expect(JSON.stringify(result)).not.toContain('a-secret-hash');
  });

  it('passes the authenticated user through as the proposer', async () => {
    const h = buildHarness();

    await h.controller.propose(
      { venueId: 'venue-1', entertainerId: 'ent-1', entertainerBps: 7000, venueBps: 2500 },
      { user: { id: 'user-42' } },
    );

    expect(h.service.propose.mock.calls[0][1]).toBe('user-42');
  });
});

describe('SplitRulesController.override', () => {
  it('reports the rule as ADMIN_OVERRIDE so a client can show it differently', async () => {
    const h = buildHarness();

    const result = await h.controller.override(
      {
        venueId: 'venue-1',
        entertainerBps: 7000,
        venueBps: 2500,
        platformBps: 500,
        reason: 'Dispute SC-1042',
      },
      REQ,
    );

    expect(result.origin).toBe(SplitRuleOrigin.ADMIN_OVERRIDE);
    expect(result).not.toHaveProperty('consentToken');
    expect(result).not.toHaveProperty('responseTokenHash');
  });
});

describe('SplitRulesController.respond', () => {
  it('forwards the decision and returns the updated rule without secrets', async () => {
    const h = buildHarness();

    const result = await h.controller.respond('rule-1', TOKEN, { decision: 'ACCEPT' });

    expect(h.service.respond).toHaveBeenCalledWith('rule-1', TOKEN, 'ACCEPT');
    expect(result.status).toBe(SplitRuleStatus.ACTIVE);
    expect(result).not.toHaveProperty('responseTokenHash');
  });
});

describe('SplitRulesController read routes', () => {
  it('keeps every field the pre-governance response shape carried', async () => {
    const h = buildHarness();

    const result = await h.controller.findActiveByVenue('venue-1');

    // Section 2.4: additive only. These are the fields existing callers read.
    for (const key of [
      'id',
      'venueId',
      'entertainerBps',
      'venueBps',
      'platformBps',
      'effectiveFrom',
      'effectiveTo',
      'createdAt',
      'updatedAt',
    ]) {
      expect(result).toHaveProperty(key);
    }
  });

  it('maps every rule in the history without leaking secrets', async () => {
    const h = buildHarness();

    const result = await h.controller.findAllByVenue('venue-1');

    expect(result).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('a-secret-hash');
  });

  it('exposes the audit trail', async () => {
    const h = buildHarness();

    await expect(h.controller.findAuditTrail('rule-1')).resolves.toEqual([{ event: 'PROPOSED' }]);
  });
});
