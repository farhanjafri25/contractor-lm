import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EncryptionService } from './services/encryption.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CommonModule {}
