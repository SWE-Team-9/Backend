import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AiActionService } from './ai-action.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { DiscoveryModule } from '../discovery/discovery.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { MessagesModule } from '../messages/messages.module';
import { PlayerModule } from '../player/player.module';
import { PlaylistsModule } from '../playlists/playlists.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    DiscoveryModule,
    PlaylistsModule,
    MessagesModule,
    PlayerModule,
    EntitlementsModule,
  ],
  controllers: [AiController],
  providers: [AiService, AiActionService],
})
export class AiModule {}