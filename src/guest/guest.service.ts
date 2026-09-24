import { Injectable, NotFoundException, GoneException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GuestService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveQrCode(publicToken: string) {
    // Find QR code by public token
    const qrCode = await this.prisma.qrCode.findUnique({
      where: { publicToken },
      include: {
        venue: true,
        entertainer: true,
      },
    });

    // 404: Token never existed
    if (!qrCode) {
      throw new NotFoundException('QR code not found');
    }

    // 410: QR code is deactivated
    if (!qrCode.isActive) {
      throw new GoneException('QR code has been deactivated');
    }

    // 410: Venue is deactivated
    if (!qrCode.venue.isActive) {
      throw new GoneException('Venue is no longer active');
    }

    // 410: Entertainer is deactivated (if QR has an entertainer)
    if (qrCode.entertainer && !qrCode.entertainer.isActive) {
      throw new GoneException('Entertainer is no longer active');
    }

    // Create guest session with 24-hour expiry
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const guestSession = await this.prisma.guestSession.create({
      data: {
        qrCodeId: qrCode.id,
        expiresAt,
      },
    });

    // Return venue details, entertainer details (nullable), location, sessionId, expiresAt
    return {
      venue: {
        id: qrCode.venue.id,
        name: qrCode.venue.name,
        logoUrl: qrCode.venue.logoUrl,
        location: qrCode.venue.location,
      },
      entertainer: qrCode.entertainer
        ? {
            id: qrCode.entertainer.id,
            stageName: qrCode.entertainer.stageName,
          }
        : null,
      location: qrCode.location,
      sessionId: guestSession.id,
      expiresAt: guestSession.expiresAt,
    };
  }
}
