import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { AiChatDto } from './dto/chat.dto';

@ApiTags('ai')
@ApiBearerAuth()
@ApiCookieAuth('access_token')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  @ApiOperation({
    summary: 'Chat with the AI assistant',
    description:
      'Send a message and receive an intelligent response with optional app actions.',
  })
  async chat(
    @CurrentUser('id') userId: string,
    @Body() dto: AiChatDto,
  ) {
    return this.aiService.chat(userId, dto);
  }
}
