import { EntertainerAuthController } from './entertainer-auth.controller';
import { EntertainerAuthService } from './entertainer-auth.service';

function buildHarness() {
  const service = {
    issueLoginLink: jest.fn().mockResolvedValue({
      loginUrl: 'https://splitcore-app.netlify.app/entertainer/login/tok',
      token: 'tok',
      expiresAt: new Date('2026-09-26T16:30:00Z'),
    }),
    redeem: jest.fn().mockResolvedValue({
      accessToken: 'signed.jwt.token',
      entertainerId: 'ent-1',
      stageName: 'DJ Neptune',
    }),
  };
  return {
    controller: new EntertainerAuthController(service as unknown as EntertainerAuthService),
    service,
  };
}

describe('EntertainerAuthController', () => {
  it('issues a login link for the entertainer in the path', async () => {
    const h = buildHarness();

    const result = await h.controller.issue('ent-1');

    expect(h.service.issueLoginLink).toHaveBeenCalledWith('ent-1');
    expect(result.loginUrl).toContain('/entertainer/login/');
  });

  it('exchanges a token for a session', async () => {
    const h = buildHarness();

    const result = await h.controller.redeem({ token: 'a'.repeat(64) });

    expect(h.service.redeem).toHaveBeenCalledWith('a'.repeat(64));
    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.entertainerId).toBe('ent-1');
  });
});
