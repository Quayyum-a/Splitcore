import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { LoggerModule } from './common/logger/logger.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { VenueScopedGuard } from './common/guards/venue-scoped.guard';
import { HealthModule } from './health/health.module';
import { getThrottlerModuleOptions } from './common/throttler/throttler.config';
import { VenuesModule } from './venues/venues.module';
import { EntertainersModule } from './entertainers/entertainers.module';
import { QrCodesModule } from './qr-codes/qr-codes.module';
import { GuestModule } from './guest/guest.module';
import { SplitRulesModule } from './split-rules/split-rules.module';
import { PaymentsModule } from './payments/payments.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { abortEarly: false },
    }),
    ThrottlerModule.forRoot(getThrottlerModuleOptions()),
    LoggerModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    AuthModule,
    HealthModule,
    VenuesModule,
    EntertainersModule,
    QrCodesModule,
    GuestModule,
    SplitRulesModule,
    PaymentsModule,
    WebhooksModule,
  ],
  providers: [
    // Runs on every request unless explicitly opted out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Runs after JwtAuthGuard; only blocks routes carrying an explicit
    // @Roles() requirement, so it's a no-op everywhere else.
    { provide: APP_GUARD, useClass: RolesGuard },
    // Runs after RolesGuard; only blocks routes marked with @VenueScoped(),
    // ensuring VENUE_ADMIN users can only access their assigned venue.
    { provide: APP_GUARD, useClass: VenueScopedGuard },
    // Rate limiting runs after authentication and authorization guards.
    // This ensures legitimate users aren't unfairly throttled during auth checks.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Every unhandled error in the app passes through one filter.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Strips unknown properties and rejects requests that don't match
    // their DTO shape, globally, so no controller can forget to validate.
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
    },
  ],
})
export class AppModule {}
