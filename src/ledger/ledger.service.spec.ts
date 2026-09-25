import {
  LedgerEntrySpec,
  LedgerService,
  InvalidPostingError,
  UnbalancedLedgerError,
} from './ledger.service';

const sum = (entries: LedgerEntrySpec[], direction: 'DEBIT' | 'CREDIT') =>
  entries.filter((e) => e.direction === direction).reduce((total, e) => total + e.amountKobo, 0);

const amountFor = (entries: LedgerEntrySpec[], accountType: LedgerEntrySpec['accountType']) =>
  entries.find((e) => e.accountType === accountType)?.amountKobo;

describe('LedgerService (pure posting logic)', () => {
  // No constructor arguments: the service has no I/O dependencies to mock.
  const ledger = new LedgerService();
  const split85105 = { entertainerBps: 8500, venueBps: 1000, platformBps: 500 };
  const tip = (grossAmountKobo: number, entertainerId: string | null = 'ent-1') => ({
    grossAmountKobo,
    venueId: 'venue-1',
    entertainerId,
  });

  describe('computePaymentEntries', () => {
    it('matches the worked example: ₦5,000 at 85/10/5', () => {
      const entries = ledger.computePaymentEntries(tip(500000), split85105);

      expect(entries).toEqual([
        {
          accountType: 'PROCESSOR_CLEARING',
          ownerId: null,
          direction: 'DEBIT',
          amountKobo: 500000,
        },
        {
          accountType: 'ENTERTAINER_PAYABLE',
          ownerId: 'ent-1',
          direction: 'CREDIT',
          amountKobo: 425000,
        },
        {
          accountType: 'VENUE_PAYABLE',
          ownerId: 'venue-1',
          direction: 'CREDIT',
          amountKobo: 50000,
        },
        { accountType: 'PLATFORM_REVENUE', ownerId: null, direction: 'CREDIT', amountKobo: 25000 },
      ]);
    });

    it('gives the rounding remainder to the platform and still balances', () => {
      // 10001 kobo × 85% = 8500.85 -> 8500; × 10% = 1000.1 -> 1000; platform = 501
      const entries = ledger.computePaymentEntries(tip(10001), split85105);

      expect(amountFor(entries, 'ENTERTAINER_PAYABLE')).toBe(8500);
      expect(amountFor(entries, 'VENUE_PAYABLE')).toBe(1000);
      expect(amountFor(entries, 'PLATFORM_REVENUE')).toBe(501);
      expect(sum(entries, 'DEBIT')).toBe(sum(entries, 'CREDIT'));
    });

    it('balances exactly and uses only integers across many amounts and splits', () => {
      const splits = [
        split85105,
        { entertainerBps: 3333, venueBps: 3333, platformBps: 3334 },
        { entertainerBps: 9999, venueBps: 0, platformBps: 1 },
        { entertainerBps: 0, venueBps: 10000, platformBps: 0 },
        { entertainerBps: 7777, venueBps: 1111, platformBps: 1112 },
      ];
      const amounts = [1, 2, 3, 7, 99, 101, 9999, 10001, 123457, 999999, 1000000000];

      for (const split of splits) {
        for (const gross of amounts) {
          for (const entertainerId of ['ent-1', null]) {
            const entries = ledger.computePaymentEntries(tip(gross, entertainerId), split);
            expect(sum(entries, 'DEBIT')).toBe(gross);
            expect(sum(entries, 'CREDIT')).toBe(gross);
            for (const e of entries) {
              expect(Number.isInteger(e.amountKobo)).toBe(true);
              expect(e.amountKobo).toBeGreaterThan(0);
            }
          }
        }
      }
    });

    it('gives the entertainer share to the venue when there is no entertainer', () => {
      const entries = ledger.computePaymentEntries(tip(500000, null), split85105);

      expect(amountFor(entries, 'ENTERTAINER_PAYABLE')).toBeUndefined();
      expect(amountFor(entries, 'VENUE_PAYABLE')).toBe(475000);
      expect(amountFor(entries, 'PLATFORM_REVENUE')).toBe(25000);
    });

    it('omits zero-value lines rather than writing them', () => {
      const entries = ledger.computePaymentEntries(tip(500000), {
        entertainerBps: 9000,
        venueBps: 1000,
        platformBps: 0,
      });

      expect(entries.map((e) => e.accountType)).toEqual([
        'PROCESSOR_CLEARING',
        'ENTERTAINER_PAYABLE',
        'VENUE_PAYABLE',
      ]);
    });

    it.each([
      [{ entertainerBps: 8500, venueBps: 1000, platformBps: 400 }, 'sum to 9900'],
      [{ entertainerBps: 8500, venueBps: 1000, platformBps: 600 }, 'sum to 10100'],
      [{ entertainerBps: 8500.5, venueBps: 999.5, platformBps: 500 }, 'non-negative integers'],
      [{ entertainerBps: 11000, venueBps: -1000, platformBps: 0 }, 'non-negative integers'],
    ])('rejects an invalid split %j', (split, message) => {
      expect(() => ledger.computePaymentEntries(tip(500000), split)).toThrow(message);
    });

    it.each([0, -100, 100.5, Number.NaN])('rejects gross amount %p', (gross) => {
      expect(() => ledger.computePaymentEntries(tip(gross), split85105)).toThrow(
        InvalidPostingError,
      );
    });
  });

  describe('payout postings', () => {
    const payout = {
      accountType: 'ENTERTAINER_PAYABLE' as const,
      ownerId: 'ent-1',
      amountKobo: 425000,
    };

    it('debits the payable account and credits processor clearing', () => {
      expect(ledger.computePayoutEntries(payout)).toEqual([
        {
          accountType: 'ENTERTAINER_PAYABLE',
          ownerId: 'ent-1',
          direction: 'DEBIT',
          amountKobo: 425000,
        },
        {
          accountType: 'PROCESSOR_CLEARING',
          ownerId: null,
          direction: 'CREDIT',
          amountKobo: 425000,
        },
      ]);
    });

    it('reversal is the exact mirror of the payout posting', () => {
      const paid = ledger.computePayoutEntries(payout);
      const reversed = ledger.computePayoutReversalEntries(payout);

      const net = (type: string) =>
        [...paid, ...reversed]
          .filter((e) => e.accountType === type)
          .reduce((t, e) => t + (e.direction === 'DEBIT' ? e.amountKobo : -e.amountKobo), 0);
      expect(net('ENTERTAINER_PAYABLE')).toBe(0);
      expect(net('PROCESSOR_CLEARING')).toBe(0);
    });

    it('refuses to pay out of a non-payable account', () => {
      expect(() =>
        ledger.computePayoutEntries({
          accountType: 'PLATFORM_REVENUE',
          ownerId: null,
          amountKobo: 1,
        }),
      ).toThrow(InvalidPostingError);
    });
  });

  describe('balanceOf', () => {
    it('reports a payable balance as owed, net of confirmed payouts', () => {
      const earned = ledger.computePaymentEntries(tip(500000), split85105);
      const paidOut = ledger.computePayoutEntries({
        accountType: 'ENTERTAINER_PAYABLE',
        ownerId: 'ent-1',
        amountKobo: 425000,
      });
      const payable = (entries: LedgerEntrySpec[]) =>
        entries.filter((e) => e.accountType === 'ENTERTAINER_PAYABLE');

      expect(ledger.balanceOf('ENTERTAINER_PAYABLE', payable(earned))).toBe(425000);
      expect(ledger.balanceOf('ENTERTAINER_PAYABLE', payable([...earned, ...paidOut]))).toBe(0);
    });

    it('treats processor clearing as debit-normal (money held)', () => {
      const earned = ledger.computePaymentEntries(tip(500000), split85105);
      const clearing = earned.filter((e) => e.accountType === 'PROCESSOR_CLEARING');
      expect(ledger.balanceOf('PROCESSOR_CLEARING', clearing)).toBe(500000);
    });
  });

  describe('assertBalanced', () => {
    it('rejects unbalanced entries', () => {
      expect(() =>
        ledger.assertBalanced([
          { accountType: 'PROCESSOR_CLEARING', ownerId: null, direction: 'DEBIT', amountKobo: 100 },
          { accountType: 'PLATFORM_REVENUE', ownerId: null, direction: 'CREDIT', amountKobo: 99 },
        ]),
      ).toThrow(UnbalancedLedgerError);
    });

    it('rejects an empty posting', () => {
      expect(() => ledger.assertBalanced([])).toThrow(UnbalancedLedgerError);
    });

    it('rejects fractional kobo', () => {
      expect(() =>
        ledger.assertBalanced([
          { accountType: 'PROCESSOR_CLEARING', ownerId: null, direction: 'DEBIT', amountKobo: 0.5 },
          { accountType: 'PLATFORM_REVENUE', ownerId: null, direction: 'CREDIT', amountKobo: 0.5 },
        ]),
      ).toThrow(InvalidPostingError);
    });
  });
});
