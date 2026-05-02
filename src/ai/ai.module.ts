import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { DiscoveryModule } from '../discovery/discovery.module';

@Module({
  imports: [
    ConfigModule,
    DiscoveryModule,
  ],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
