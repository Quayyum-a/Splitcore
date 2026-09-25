/**
 * Unit tests for the guest-facing payments controller. It is a pass-through,
 * so these check only that requests reach the service unchanged and that
 * errors are not swallowed on the way back.
 */

import { GoneException, NotFoundException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { InitializePaymentDto } from './dto';

function build() {
  const service = {
    initializePayment: jest.fn(),
    getPaymentStatus: jest.fn(),
  };
  return { controller: new PaymentsController(service as unknown as PaymentsService), service };
}

describe('PaymentsController', () => {
  it('passes the initialize request through unchanged', async () => {
    const { controller, service } = build();
    const dto = { sessionId: 'sess-1', amountKobo: 500000 } as InitializePaymentDto;
    service.initializePayment.mockResolvedValue({ reference: 'pay_1' });

    await expect(controller.initializePayment(dto)).resolves.toEqual({ reference: 'pay_1' });
    expect(service.initializePayment).toHaveBeenCalledWith(dto);
  });

  it('surfaces an expired session as 410 rather than masking it', async () => {
    const { controller, service } = build();
    service.initializePayment.mockRejectedValue(new GoneException('Guest session has expired'));

    await expect(
      controller.initializePayment({ sessionId: 'sess-1' } as InitializePaymentDto),
    ).rejects.toThrow(GoneException);
  });

  it('passes the status lookup through by reference', async () => {
    const { controller, service } = build();
    service.getPaymentStatus.mockResolvedValue({ status: 'SUCCESS' });

    await expect(controller.getPaymentStatus('pay_1')).resolves.toEqual({ status: 'SUCCESS' });
    expect(service.getPaymentStatus).toHaveBeenCalledWith('pay_1');
  });

  it('surfaces an unknown reference as 404', async () => {
    const { controller, service } = build();
    service.getPaymentStatus.mockRejectedValue(new NotFoundException('Payment not found'));

    await expect(controller.getPaymentStatus('pay_nope')).rejects.toThrow(NotFoundException);
  });

  describe('GET /payments/callback', () => {
    const settled = {
      transactionId: 'txn-1',
      reference: 'pay_abc123',
      status: 'SUCCESS',
      amountKobo: 500000,
      venueName: 'Quilox',
      entertainerName: 'DJ Mike',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('verifies server-side rather than trusting the redirect', async () => {
      const { controller, service } = build();
      service.getPaymentStatus.mockResolvedValue(settled);

      const html = await controller.paymentCallback('pay_abc123');

      // The redirect itself proves nothing; the status endpoint re-verifies
      // with the provider and settles.
      expect(service.getPaymentStatus).toHaveBeenCalledWith('pay_abc123');
      expect(html).toContain('Payment confirmed');
    });

    it('falls back to Paystack’s trxref when reference is absent', async () => {
      const { controller, service } = build();
      service.getPaymentStatus.mockResolvedValue(settled);

      await controller.paymentCallback(undefined, 'pay_abc123');

      expect(service.getPaymentStatus).toHaveBeenCalledWith('pay_abc123');
    });

    it('takes the first value when a query parameter arrives twice', async () => {
      // Our configured callback URL carries ?reference=, and Paystack appends
      // its own, so Express hands over an array.
      const { controller, service } = build();
      service.getPaymentStatus.mockResolvedValue(settled);

      await controller.paymentCallback(['pay_abc123', 'pay_abc123']);

      expect(service.getPaymentStatus).toHaveBeenCalledWith('pay_abc123');
    });

    it('renders a helpful page when no reference was supplied', async () => {
      const { controller, service } = build();

      const html = await controller.paymentCallback(undefined, undefined);

      expect(html).toContain('No payment reference was supplied');
      expect(service.getPaymentStatus).not.toHaveBeenCalled();
    });

    it('treats a blank reference as missing', async () => {
      const { controller, service } = build();

      await controller.paymentCallback('   ');

      expect(service.getPaymentStatus).not.toHaveBeenCalled();
    });

    it('renders a not-found page instead of a 404 for an unknown reference', async () => {
      // The guest is looking at this page in a browser; an error payload
      // would be useless to them.
      const { controller, service } = build();
      service.getPaymentStatus.mockRejectedValue(new NotFoundException('Payment not found'));

      const html = await controller.paymentCallback('pay_nope');

      expect(html).toContain('Payment not found');
    });

    it('lets an unexpected failure surface rather than rendering a false success', async () => {
      const { controller, service } = build();
      service.getPaymentStatus.mockRejectedValue(new Error('database down'));

      await expect(controller.paymentCallback('pay_abc123')).rejects.toThrow('database down');
    });

    it('shows a pending payment as still confirming', async () => {
      const { controller, service } = build();
      service.getPaymentStatus.mockResolvedValue({ ...settled, status: 'PENDING' });

      expect(await controller.paymentCallback('pay_abc123')).toContain('Still confirming');
    });
  });
});
