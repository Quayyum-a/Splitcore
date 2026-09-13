import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

describe('AuthService.hashPassword', () => {
  it('produces a hash that verifies against the original password', async () => {
    const hash = await AuthService.hashPassword('correct-horse-battery-staple');
    await expect(bcrypt.compare('correct-horse-battery-staple', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password against the hash', async () => {
    const hash = await AuthService.hashPassword('correct-horse-battery-staple');
    await expect(bcrypt.compare('wrong-password', hash)).resolves.toBe(false);
  });
});
