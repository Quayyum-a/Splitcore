import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQrCodeDto } from './dto/create-qr-code.dto';
import { QrCode, Role } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class QrCodesService {
  constructor(private readonly prisma: PrismaService) {}

  generatePublicToken(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  async create(dto: CreateQrCodeDto): Promise<QrCode> {
    // Validate venue exists
    const venue = await this.prisma.venue.findUnique({
      where: { id: dto.venueId },
    });

    if (!venue) {
      throw new NotFoundException(`Venue with ID ${dto.venueId} not found`);
    }

    // If entertainerId provided, validate entertainer exists and is linked to venue
    if (dto.entertainerId) {
      const entertainer = await this.prisma.entertainer.findUnique({
        where: { id: dto.entertainerId },
      });

      if (!entertainer) {
        throw new NotFoundException(`Entertainer with ID ${dto.entertainerId} not found`);
      }

      // Check if entertainer is linked to venue
      const link = await this.prisma.venueEntertainer.findFirst({
        where: {
          venueId: dto.venueId,
          entertainerId: dto.entertainerId,
        },
      });

      if (!link) {
        throw new BadRequestException('Entertainer is not linked to this venue');
      }
    }

    const publicToken = this.generatePublicToken();

    return await this.prisma.qrCode.create({
      data: {
        publicToken,
        venueId: dto.venueId,
        entertainerId: dto.entertainerId,
        location: dto.location,
      },
    });
  }

  async findAll(userId: string, userRole: Role): Promise<QrCode[]> {
    if (userRole === Role.PLATFORM_ADMIN) {
      return this.prisma.qrCode.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          venue: true,
          entertainer: true,
        },
      });
    }

    // For VENUE_ADMIN, filter by their venueId
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { venueId: true },
    });

    if (!user?.venueId) {
      return [];
    }

    return this.prisma.qrCode.findMany({
      where: { venueId: user.venueId },
      orderBy: { createdAt: 'desc' },
      include: {
        venue: true,
        entertainer: true,
      },
    });
  }

  async findOne(id: string): Promise<QrCode> {
    const qrCode = await this.prisma.qrCode.findUnique({
      where: { id },
      include: {
        venue: true,
        entertainer: true,
      },
    });

    if (!qrCode) {
      throw new NotFoundException(`QR code with ID ${id} not found`);
    }

    return qrCode;
  }

  async deactivate(id: string): Promise<QrCode> {
    try {
      return await this.prisma.qrCode.update({
        where: { id },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
        },
      });
    } catch (error) {
      throw new NotFoundException(`QR code with ID ${id} not found`);
    }
  }

  async regenerate(id: string): Promise<QrCode> {
    // Use transaction to deactivate old code and create new one
    return await this.prisma.$transaction(async (tx) => {
      // Get the existing QR code
      const oldQrCode = await tx.qrCode.findUnique({
        where: { id },
      });

      if (!oldQrCode) {
        throw new NotFoundException(`QR code with ID ${id} not found`);
      }

      // Deactivate the old QR code
      await tx.qrCode.update({
        where: { id },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
        },
      });

      // Create new QR code with same venue/entertainer/location
      const newPublicToken = this.generatePublicToken();
      return await tx.qrCode.create({
        data: {
          publicToken: newPublicToken,
          venueId: oldQrCode.venueId,
          entertainerId: oldQrCode.entertainerId,
          location: oldQrCode.location,
        },
      });
    });
  }
}
