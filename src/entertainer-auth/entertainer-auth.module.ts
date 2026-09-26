import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { EntertainerAuthController } from './entertainer-auth.controller';
import { EntertainerAuthService } from './entertainer-auth.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('auth.jwtSecret'),
      }),
    }),
  ],
  controllers: [EntertainerAuthController],
  providers: [EntertainerAuthService],
  exports: [EntertainerAuthService],
})
export class EntertainerAuthModule {}
