import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { AiChatDto } from './dto/chat.dto';

@ApiTags('AI Assistant')
@ApiBearerAuth()
@ApiCookieAuth('access_token')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  @ApiOperation({
    summary: 'Chat with the IQA3 AI action assistant',
    description:
      'Accepts a natural-language user message, detects the intended action, and either answers an FAQ or performs a safe whitelisted app action. ' +
      'The frontend calls only this endpoint. The backend executes all real app actions using existing services.',
  })
  @ApiBody({ type: AiChatDto })
  @ApiResponse({
    status: 200,
    description: 'AI assistant response.',
    schema: {
      example: {
        reply: 'Created playlist "Sha3by Mix" with 5 tracks.',
        provider: 'mock',
        intent: 'create_playlist_from_genre',
        actionsTaken: ['created playlist', 'added 5 tracks'],
        data: {
          playlist: {
            playlistId: 'playlist-uuid',
            title: 'Sha3by Mix',
            tracksCount: 5,
          },
        },
        suggestions: ['Open the playlist', 'Find more Sha3by tracks'],
      },
    },
  })
  async chat(@CurrentUser('userId') userId: string, @Body() dto: AiChatDto) {
    return this.aiService.chat(userId, dto);
  }
}