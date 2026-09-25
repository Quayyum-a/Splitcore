import { Module } from '@nestjs/common';
import { PAYMENT_PROVIDER, PAYOUT_PROVIDER } from '../interfaces';
import { PaystackProvider } from './paystack.provider';
import { PaystackPayoutProvider } from './paystack-payout.provider';

/**
 * Binds the provider abstractions to their current implementations.
 *
 * This is the only place that knows Paystack is the processor. Adding
 * Flutterwave later means a new implementation and a change here, with no
 * change to ledger, settlement or payout logic.
 */
@Module({
  providers: [
    PaystackProvider,
    PaystackPayoutProvider,
    { provide: PAYMENT_PROVIDER, useExisting: PaystackProvider },
    { provide: PAYOUT_PROVIDER, useExisting: PaystackPayoutProvider },
  ],
  exports: [PAYMENT_PROVIDER, PAYOUT_PROVIDER],
})
export class PaymentProvidersModule {}
