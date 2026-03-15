import { NestFactory } from '@nestjs/core';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global prefix
  app.setGlobalPrefix('v1');

  // Global validation pipe — strips unknown fields, transforms types
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS
  let envOrigins: string[] = [];
  if (process.env.FRONTEND_URL) {
    try {
      const parsed = JSON.parse(process.env.FRONTEND_URL);
      envOrigins = Array.isArray(parsed) ? parsed : [process.env.FRONTEND_URL];
    } catch {
      envOrigins = [process.env.FRONTEND_URL];
    }
  }

  const allowedOrigins = [
    ...envOrigins,
    'http://localhost:3001',
    'http://localhost:3000',
  ].filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, etc) or allowed origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new BadRequestException('not allowed'));
      }
    },
    credentials: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') || 3000;

  await app.listen(port);
  console.log(`🚀 CLM API running on http://localhost:${port}/v1`);
}
bootstrap();
