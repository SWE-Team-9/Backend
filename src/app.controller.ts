import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

@ApiTags('Health')
@Controller()
export class AppController {
  @Public()
  @ApiOperation({ summary: 'Health check', description: 'Returns server status and timestamp.' })
  @ApiResponse({ status: 200, description: '{ status: "ok", timestamp: string }' })
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}