import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';

// Structured (JSON) logging via pino, not console.log. In production this
// means every log line is a queryable JSON object — searchable by request
// ID, status code, or venue ID once that context is added — instead of a
// wall of unstructured text.
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<string>('nodeEnv') === 'production';

        return {
          pinoHttp: {
            level: config.get<string>('logLevel'),
            // Pretty-printed, human-readable logs locally; raw JSON in
            // every other environment, since that's what log aggregators
            // (and grep on a server) actually want.
            transport: isProd
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true } },
            genReqId: (req: any) => req.headers['x-request-id'] ?? randomUUID(),
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.passwordHash',
                'req.body.bvn',
                'req.body.nin',
              ],
              censor: '[redacted]',
            },
            customLogLevel: (_req: any, res: any, err: any) => {
              if (res.statusCode >= 500 || err) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
