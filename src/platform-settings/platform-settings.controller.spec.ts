import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';

const ROW = {
  id: 'singleton',
  platformFeeBps: 500,
  updatedByUserId: null,
  createdAt: new Date('2026-09-26T10:00:00Z'),
  updatedAt: new Date('2026-09-26T10:00:00Z'),
};

function buildHarness() {
  const service = {
    get: jest.fn().mockResolvedValue(ROW),
    update: jest.fn().mockResolvedValue({ ...ROW, platformFeeBps: 700 }),
  };
  const controller = new PlatformSettingsController(service as unknown as PlatformSettingsService);
  return { controller, service };
}

describe('PlatformSettingsController', () => {
  // splittableBps is what a venue's proposal has to sum to, so computing it here
  // saves every client from re-deriving it and getting it wrong.
  it('reports what is left for the venue and entertainer to divide', async () => {
    const h = buildHarness();

    await expect(h.controller.get()).resolves.toEqual({
      platformFeeBps: 500,
      splittableBps: 9500,
      updatedAt: ROW.updatedAt,
    });
  });

  it('recomputes splittableBps after a change', async () => {
    const h = buildHarness();

    const result = await h.controller.update({ platformFeeBps: 700 }, { user: { id: 'admin-1' } });

    expect(result.platformFeeBps).toBe(700);
    expect(result.splittableBps).toBe(9300);
  });

  it('attributes the change to the authenticated admin', async () => {
    const h = buildHarness();

    await h.controller.update({ platformFeeBps: 700 }, { user: { id: 'admin-5' } });

    expect(h.service.update).toHaveBeenCalledWith(700, 'admin-5');
  });

  it('never exposes the internal row id', async () => {
    const h = buildHarness();

    await expect(h.controller.get()).resolves.not.toHaveProperty('id');
  });
});
