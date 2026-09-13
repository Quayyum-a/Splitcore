import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // bufferLogs holds any log lines emitted during module initialization
  // until the real (pino) logger is attached below, instead of losing them
  // to Nest's default console logger.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors();
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 3000;

  await app.listen(port);
  app.get(Logger).log(`Splitcore backend listening on port ${port}`);
}

bootstrap();
