import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSplitRuleDto } from './dto/create-split-rule.dto';
import { SplitRule, Role } from '@prisma/client';

@Injectable()
export class SplitRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSplitRuleDto): Promise<SplitRule> {
    // Use transaction to set effectiveTo on current rule and create new rule
    return await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Find current active rule (effectiveTo is null)
      const currentRule = await tx.splitRule.findFirst({
        where: {
          venueId: dto.venueId,
          effectiveTo: null,
        },
      });

      // If there's an active rule, close it out
      if (currentRule) {
        await tx.splitRule.update({
          where: { id: currentRule.id },
          data: { effectiveTo: now },
        });
      }

      // Create new rule with effectiveFrom = now, effectiveTo = null
      return await tx.splitRule.create({
        data: {
          venueId: dto.venueId,
          entertainerBps: dto.entertainerBps,
          venueBps: dto.venueBps,
          platformBps: dto.platformBps,
          effectiveFrom: now,
          effectiveTo: null,
        },
      });
    });
  }

  async findAllByVenue(venueId: string): Promise<SplitRule[]> {
    return this.prisma.splitRule.findMany({
      where: { venueId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async findActiveByVenue(venueId: string): Promise<SplitRule> {
    const activeRule = await this.prisma.splitRule.findFirst({
      where: {
        venueId,
        effectiveTo: null,
      },
    });

    if (!activeRule) {
      throw new NotFoundException(`No active split rule found for venue ${venueId}`);
    }

    return activeRule;
  }
}
