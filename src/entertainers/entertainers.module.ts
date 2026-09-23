import { Module } from '@nestjs/common';
import { EntertainersController } from './entertainers.controller';
import { EntertainersService } from './entertainers.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EntertainersController],
  providers: [EntertainersService],
  exports: [EntertainersService],
})
export class EntertainersModule {}
