import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { OutboxDispatcher } from './platform/outbox/outbox.service';
import { AuditReadQueue } from './platform/audit/audit.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(cookieParser());
  // Deployed topology (D1/D2): the API sits behind the admin nginx proxy /
  // platform TLS terminator — trust the first hop so req.ip (login audit
  // source) reflects the client via X-Forwarded-For, not the proxy.
  app.set('trust proxy', 1);

  // In-process background sweeps [Proposed MVP]: outbox dispatch + audit read-queue
  // drain. Off in tests (OUTBOX_DISPATCHER=off); upgradeable to a queue runner later.
  if (process.env.OUTBOX_DISPATCHER !== 'off') {
    const dispatcher = app.get(OutboxDispatcher);
    const readQueue = app.get(AuditReadQueue);
    setInterval(() => {
      void dispatcher.sweep().catch(() => undefined);
      void readQueue.drain().catch(() => undefined);
    }, 2_000).unref();
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
