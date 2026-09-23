import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEntertainerDto } from './dto/create-entertainer.dto';
import { UpdateEntertainerDto } from './dto/update-entertainer.dto';
import { Entertainer, Role } from '@prisma/client';
import { Prisma } from '@prisma/client';

@Injectable()
export class EntertainersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEntertainerDto): Promise<Entertainer & { venueIds: string[] }> {
    try {
      const entertainer = await this.prisma.entertainer.create({
        data: {
          stageName: dto.stageName,
          legalName: dto.legalName,
          phone: dto.phone,
          bankName: dto.bankName,
          accountNumber: dto.accountNumber,
          // kycStatus defaults to NOT_STARTED in schema
        },
      });
      return { ...entertainer, venueIds: [] };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An entertainer with this phone number already exists');
      }
      throw error;
    }
  }

  async findAll(userId: string, userRole: Role): Promise<Array<Entertainer & { venueIds: string[] }>> {
    if (userRole === Role.PLATFORM_ADMIN) {
      const entertainers = await this.prisma.entertainer.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          venueEntertainers: {
            select: { venueId: true },
          },
        },
      });
      return entertainers.map((ent) => ({
        ...ent,
        venueIds: ent.venueEntertainers.map((ve) => ve.venueId),
        venueEntertainers: undefined,
      })) as Array<Entertainer & { venueIds: string[] }>;
    }

    // For VENUE_ADMIN, find entertainers linked to their venue
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { venueId: true },
    });

    if (!user?.venueId) {
      return [];
    }

    // Find all entertainers linked to this venue via VenueEntertainer
    const venueEntertainers = await this.prisma.venueEntertainer.findMany({
      where: { venueId: user.venueId },
      include: {
        entertainer: {
          include: {
            venueEntertainers: {
              select: { venueId: true },
            },
          },
        },
      },
    });

    return venueEntertainers.map((ve) => ({
      ...ve.entertainer,
      venueIds: ve.entertainer.venueEntertainers.map((veInner) => veInner.venueId),
      venueEntertainers: undefined,
    })) as Array<Entertainer & { venueIds: string[] }>;
  }

  async findOne(id: string): Promise<Entertainer & { venueIds: string[] }> {
    const entertainer = await this.prisma.entertainer.findUnique({
      where: { id },
      include: {
        venueEntertainers: {
          select: { venueId: true },
        },
      },
    });

    if (!entertainer) {
      throw new NotFoundException(`Entertainer with ID ${id} not found`);
    }

    const venueIds = entertainer.venueEntertainers.map((ve) => ve.venueId);

    // Return entertainer with venueIds array
    const { venueEntertainers, ...entertainerData } = entertainer;
    return {
      ...entertainerData,
      venueIds,
    };
  }

  async update(id: string, dto: UpdateEntertainerDto): Promise<Entertainer & { venueIds: string[] }> {
    try {
      const entertainer = await this.prisma.entertainer.update({
        where: { id },
        data: dto,
        include: {
          venueEntertainers: {
            select: { venueId: true },
          },
        },
      });
      const venueIds = entertainer.venueEntertainers.map((ve) => ve.venueId);
      const { venueEntertainers, ...entertainerData } = entertainer;
      return { ...entertainerData, venueIds };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(`Entertainer with ID ${id} not found`);
        }
        if (error.code === 'P2002') {
          throw new ConflictException('An entertainer with this phone number already exists');
        }
      }
      throw error;
    }
  }

  async deactivate(id: string): Promise<Entertainer & { venueIds: string[] }> {
    // Use transaction to deactivate entertainer AND all related QR codes
    return await this.prisma.$transaction(async (tx) => {
      // Deactivate the entertainer
      const entertainer = await tx.entertainer.update({
        where: { id },
        data: { isActive: false },
        include: {
          venueEntertainers: {
            select: { venueId: true },
          },
        },
      }).catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          throw new NotFoundException(`Entertainer with ID ${id} not found`);
        }
        throw error;
      });

      // Deactivate all QR codes associated with this entertainer
      await tx.qrCode.updateMany({
        where: { entertainerId: id },
        data: { isActive: false },
      });

      const venueIds = entertainer.venueEntertainers.map((ve) => ve.venueId);
      const { venueEntertainers, ...entertainerData } = entertainer;
      return { ...entertainerData, venueIds };
    });
  }

  async linkToVenue(entertainerId: string, venueId: string): Promise<any> {
    try {
      return await this.prisma.venueEntertainer.create({
        data: {
          venueId,
          entertainerId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Entertainer is already linked to this venue');
      }
      throw error;
    }
  }

  async unlinkFromVenue(entertainerId: string, venueId: string): Promise<void> {
    const link = await this.prisma.venueEntertainer.findFirst({
      where: {
        venueId,
        entertainerId,
      },
    });

    if (!link) {
      throw new NotFoundException('Entertainer is not linked to this venue');
    }

    await this.prisma.venueEntertainer.delete({
      where: { id: link.id },
    });
  }
}
