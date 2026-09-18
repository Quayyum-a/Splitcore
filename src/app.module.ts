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
import { HealthModule } from './health/health.module';
import { getThrottlerModuleOptions } from './common/throttler/throttler.config';

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
  ],
  providers: [
    // Runs on every request unless explicitly opted out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Runs after JwtAuthGuard; only blocks routes carrying an explicit
    // @Roles() requirement, so it's a no-op everywhere else.
    { provide: APP_GUARD, useClass: RolesGuard },
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
