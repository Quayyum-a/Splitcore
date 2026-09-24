import { faker } from '@faker-js/faker';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

export class UserFactory {
  constructor(private prisma: PrismaClient) {}

  async create(overrides?: { email?: string; password?: string; role?: Role }) {
    const email = overrides?.email || faker.internet.email();
    const password = overrides?.password || 'Password123!';
    const role = overrides?.role || 'USER';

    const passwordHash = await bcrypt.hash(password, 10);

    return this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role,
      },
    });
  }

  async createMany(count: number, overrides?: { role?: Role }) {
    const users = [];
    for (let i = 0; i < count; i++) {
      users.push(await this.create(overrides));
    }
    return users;
  }
}

export class JobFactory {
  static create(overrides?: {
    name?: string;
    data?: Record<string, any>;
    opts?: Record<string, any>;
  }) {
    return {
      name: overrides?.name || faker.word.noun(),
      data: overrides?.data || { key: faker.word.noun(), value: faker.word.adjective() },
      opts: overrides?.opts || { attempts: 3, backoff: 1000 },
    };
  }
}
