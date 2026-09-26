import { EntertainerDashboardController, VenueDashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { VenueOverviewResponseDto, EntertainerOverviewResponseDto } from './dto/dashboard.dto';

function buildHarness() {
  const service = {
    venueOverview: jest.fn().mockResolvedValue({ venueId: 'venue-1' } as VenueOverviewResponseDto),
    venueEntertainerEarnings: jest.fn().mockResolvedValue([]),
    venueTransactions: jest.fn().mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] }),
    venuePayouts: jest.fn().mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] }),
    entertainerOverview: jest
      .fn()
      .mockResolvedValue({ entertainerId: 'ent-1' } as EntertainerOverviewResponseDto),
    entertainerTransactions: jest
      .fn()
      .mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] }),
    entertainerPayouts: jest.fn().mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] }),
  };
  return {
    venue: new VenueDashboardController(service as unknown as DashboardService),
    entertainer: new EntertainerDashboardController(service as unknown as DashboardService),
    service,
  };
}

describe('VenueDashboardController', () => {
  it('passes the venue through to the overview', async () => {
    const h = buildHarness();
    await h.venue.overview('venue-1');
    expect(h.service.venueOverview).toHaveBeenCalledWith('venue-1');
  });

  it('returns per-entertainer earnings', async () => {
    const h = buildHarness();
    await expect(h.venue.entertainerEarnings('venue-1')).resolves.toEqual([]);
  });

  it('forwards pagination for transactions and payouts', async () => {
    const h = buildHarness();

    await h.venue.transactions('venue-1', 25, 50);
    await h.venue.payouts('venue-1', 10, 0);

    expect(h.service.venueTransactions).toHaveBeenCalledWith('venue-1', 25, 50);
    expect(h.service.venuePayouts).toHaveBeenCalledWith('venue-1', 10, 0);
  });

  it('leaves pagination undefined when not supplied, so the service defaults apply', async () => {
    const h = buildHarness();

    await h.venue.transactions('venue-1');

    expect(h.service.venueTransactions).toHaveBeenCalledWith('venue-1', undefined, undefined);
  });
});

describe('EntertainerDashboardController', () => {
  it('scopes every read to the entertainer in the path', async () => {
    const h = buildHarness();

    await h.entertainer.overview('ent-1');
    await h.entertainer.transactions('ent-1', 5, 0);
    await h.entertainer.payouts('ent-1');

    expect(h.service.entertainerOverview).toHaveBeenCalledWith('ent-1');
    expect(h.service.entertainerTransactions).toHaveBeenCalledWith('ent-1', 5, 0);
    expect(h.service.entertainerPayouts).toHaveBeenCalledWith('ent-1', undefined, undefined);
  });

  // There is deliberately no venue-wide figure reachable from these routes.
  it('exposes no venue-scoped service call', async () => {
    const h = buildHarness();

    await h.entertainer.overview('ent-1');

    expect(h.service.venueOverview).not.toHaveBeenCalled();
    expect(h.service.venuePayouts).not.toHaveBeenCalled();
  });
});
