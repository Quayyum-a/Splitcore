import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { Venue, Role } from '@prisma/client';
import { Prisma } from '@prisma/client';

@Injectable()
export class VenuesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateVenueDto): Promise<Venue> {
    try {
      return await this.prisma.venue.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          logoUrl: dto.logoUrl,
          location: dto.location,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A venue with this slug already exists');
      }
      throw error;
    }
  }

  async findAll(userId: string, userRole: Role): Promise<Venue[]> {
    if (userRole === Role.PLATFORM_ADMIN) {
      return this.prisma.venue.findMany({
        orderBy: { createdAt: 'desc' },
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

    return this.prisma.venue.findMany({
      where: { id: user.venueId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<Venue> {
    const venue = await this.prisma.venue.findUnique({
      where: { id },
    });

    if (!venue) {
      throw new NotFoundException(`Venue with ID ${id} not found`);
    }

    return venue;
  }

  async update(id: string, dto: UpdateVenueDto): Promise<Venue> {
    try {
      return await this.prisma.venue.update({
        where: { id },
        data: dto,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException(`Venue with ID ${id} not found`);
      }
      throw error;
    }
  }

  async deactivate(id: string): Promise<Venue> {
    try {
      return await this.prisma.venue.update({
        where: { id },
        data: { isActive: false },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException(`Venue with ID ${id} not found`);
      }
      throw error;
    }
  }
}
