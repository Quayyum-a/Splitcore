import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from './platform-settings.service';

function buildHarness() {
  const prisma = {
    platformSettings: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const service = new PlatformSettingsService(prisma as unknown as PrismaService);
  return { service, prisma };
}

const ROW = {
  id: 'singleton',
  platformFeeBps: 500,
  updatedByUserId: null,
  createdAt: new Date('2026-09-26T10:00:00Z'),
  updatedAt: new Date('2026-09-26T10:00:00Z'),
};

describe('PlatformSettingsService.get', () => {
  it('reads the singleton row', async () => {
    const h = buildHarness();
    h.prisma.platformSettings.findUnique.mockResolvedValue(ROW);

    await expect(h.service.get()).resolves.toEqual(ROW);
    expect(h.prisma.platformSettings.findUnique).toHaveBeenCalledWith({
      where: { id: 'singleton' },
    });
  });

  // The migration seeds this row, so its absence means a database restored from
  // before the migration. Creating it beats a 500 on every split proposal.
  it('creates the row with the default fee when it is missing', async () => {
    const h = buildHarness();
    h.prisma.platformSettings.findUnique.mockResolvedValue(null);
    h.prisma.platformSettings.create.mockResolvedValue(ROW);

    await h.service.get();

    expect(h.prisma.platformSettings.create).toHaveBeenCalledWith({
      data: { id: 'singleton', platformFeeBps: 500 },
    });
  });

  it('exposes just the number for callers that only need that', async () => {
    const h = buildHarness();
    h.prisma.platformSettings.findUnique.mockResolvedValue({ ...ROW, platformFeeBps: 750 });

    await expect(h.service.getPlatformFeeBps()).resolves.toBe(750);
  });
});

describe('PlatformSettingsService.update', () => {
  it('records who changed the fee', async () => {
    const h = buildHarness();
    h.prisma.platformSettings.findUnique.mockResolvedValue(ROW);
    h.prisma.platformSettings.update.mockResolvedValue({ ...ROW, platformFeeBps: 600 });

    await h.service.update(600, 'admin-9');

    expect(h.prisma.platformSettings.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { platformFeeBps: 600, updatedByUserId: 'admin-9' },
    });
  });

  // Rules already agreed keep the fee they were agreed under; this service only
  // ever touches the settings row.
  it('does not rewrite any existing split rule', async () => {
    const h = buildHarness();
    h.prisma.platformSettings.findUnique.mockResolvedValue(ROW);
    h.prisma.platformSettings.update.mockResolvedValue(ROW);

    await h.service.update(600, 'admin-9');

    expect(Object.keys(h.prisma)).toEqual(['platformSettings']);
  });
});
