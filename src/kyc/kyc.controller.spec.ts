import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';

function buildHarness() {
  const view = { entertainerId: 'ent-1', status: 'PENDING', nextStep: 'RESOLVE_ACCOUNT' };
  const service = {
    getStatus: jest.fn().mockResolvedValue(view),
    submitBankDetails: jest.fn().mockResolvedValue(view),
    resolveAccount: jest.fn().mockResolvedValue(view),
    confirmAccount: jest.fn().mockResolvedValue(view),
    verifyIdentity: jest.fn().mockResolvedValue(view),
    decideReview: jest.fn().mockResolvedValue(view),
  };
  return { controller: new KycController(service as unknown as KycService), service };
}

const BANK = { bankName: 'GTBank', bankCode: '058', accountNumber: '0123456789' };

describe('KycController', () => {
  it('reports status', async () => {
    const h = buildHarness();
    await h.controller.status('ent-1');
    expect(h.service.getStatus).toHaveBeenCalledWith('ent-1');
  });

  it('walks the five steps in order', async () => {
    const h = buildHarness();

    await h.controller.bankDetails('ent-1', BANK);
    await h.controller.resolve('ent-1');
    await h.controller.confirm('ent-1', { confirmedAccountName: 'PATRICK IMOHIOSEN' });
    await h.controller.verifyIdentity('ent-1', {
      documentType: 'BVN',
      documentNumber: '22222222222',
    });

    expect(h.service.submitBankDetails).toHaveBeenCalledWith('ent-1', BANK);
    expect(h.service.resolveAccount).toHaveBeenCalledWith('ent-1');
    expect(h.service.confirmAccount).toHaveBeenCalledWith('ent-1', 'PATRICK IMOHIOSEN');
    expect(h.service.verifyIdentity).toHaveBeenCalledWith('ent-1', {
      documentType: 'BVN',
      documentNumber: '22222222222',
    });
  });

  it('attributes a manual review decision to the acting admin', async () => {
    const h = buildHarness();

    await h.controller.review(
      'ent-1',
      { decision: 'APPROVE', reason: 'Documents checked manually' },
      { user: { id: 'admin-7' } },
    );

    expect(h.service.decideReview).toHaveBeenCalledWith(
      'ent-1',
      'APPROVE',
      'Documents checked manually',
      'admin-7',
    );
  });
});
