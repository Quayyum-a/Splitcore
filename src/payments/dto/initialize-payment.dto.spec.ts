/**
 * Unit tests for request validation (phase-1-production-ready task 16.3).
 *
 * The guest payment DTO is where an untrusted amount enters the system, so
 * its constraints are asserted directly rather than only through HTTP.
 */

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InitializePaymentDto } from './initialize-payment.dto';

const VALID = {
  sessionId: '3f1b2c9e-5a7d-4e2b-9c11-8d6e4f2a1b30',
  amountKobo: 500000,
  email: 'guest@example.com',
  guestDisplayName: 'Ada',
  displayNameEnabled: true,
};

async function errorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(InitializePaymentDto, payload);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('InitializePaymentDto', () => {
  it('accepts a well-formed request', async () => {
    await expect(errorsFor(VALID)).resolves.toEqual([]);
  });

  it('accepts a request with only the required fields', async () => {
    await expect(
      errorsFor({ sessionId: VALID.sessionId, amountKobo: VALID.amountKobo }),
    ).resolves.toEqual([]);
  });

  describe('sessionId', () => {
    it('is required', async () => {
      await expect(errorsFor({ amountKobo: 500000 })).resolves.not.toEqual([]);
    });

    it('must be a UUID, not an arbitrary string', async () => {
      const errors = await errorsFor({ ...VALID, sessionId: 'not-a-uuid' });
      expect(errors.join(' ')).toMatch(/uuid/i);
    });
  });

  describe('amountKobo', () => {
    it('is required', async () => {
      await expect(errorsFor({ sessionId: VALID.sessionId })).resolves.not.toEqual([]);
    });

    it('rejects a fractional amount, since kobo is the smallest unit', async () => {
      const errors = await errorsFor({ ...VALID, amountKobo: 100.5 });
      expect(errors.join(' ')).toMatch(/integer/i);
    });

    it.each([0, -1, -500000])('rejects a non-positive amount (%s)', async (amountKobo) => {
      await expect(errorsFor({ ...VALID, amountKobo })).resolves.not.toEqual([]);
    });

    it('rejects a string amount', async () => {
      await expect(errorsFor({ ...VALID, amountKobo: '500000abc' })).resolves.not.toEqual([]);
    });
  });

  describe('email', () => {
    it('is optional', async () => {
      const { email: _email, ...withoutEmail } = VALID;
      await expect(errorsFor(withoutEmail)).resolves.toEqual([]);
    });

    it('must be well-formed when supplied', async () => {
      const errors = await errorsFor({ ...VALID, email: 'not-an-email' });
      expect(errors.join(' ')).toMatch(/email/i);
    });
  });

  describe('guest identity', () => {
    it('allows an anonymous tip', async () => {
      await expect(
        errorsFor({
          sessionId: VALID.sessionId,
          amountKobo: VALID.amountKobo,
          displayNameEnabled: false,
        }),
      ).resolves.toEqual([]);
    });

    it('rejects a non-boolean display flag', async () => {
      await expect(errorsFor({ ...VALID, displayNameEnabled: 'yes' })).resolves.not.toEqual([]);
    });
  });
});
