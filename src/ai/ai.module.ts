import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiActionService } from './ai-action.service';
import { DiscoveryModule } from '../discovery/discovery.module';
import { PlaylistsModule } from '../playlists/playlists.module';

@Module({
  imports: [ConfigModule, DiscoveryModule, PlaylistsModule],
  controllers: [AiController],
  providers: [AiService, AiActionService],
})
export class AiModule {}
