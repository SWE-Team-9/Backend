import { Controller, Get, Header, Headers, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { DiscoveryService } from '../discovery/discovery.service';
import { TracksService } from './tracks.service';

@ApiTags('Share')
@Controller('share')
export class ShareController {
  constructor(
    private readonly tracksService: TracksService,
    private readonly discoveryService: DiscoveryService,
  ) {}

  private isMobileUserAgent(userAgent: string | undefined): boolean {
    if (!userAgent) {
      return false;
    }

    return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  }

  @Get('track/:slugOrId')
  @Public()
  @Header('Content-Type', 'text/html')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Open a track in the mobile app' })
  @ApiParam({ name: 'slugOrId', description: 'Track slug or UUID' })
  @ApiOkResponse({ description: 'HTML redirect response.' })
  async shareTrack(@Param('slugOrId') slugOrId: string, @Headers('user-agent') userAgent?: string) {
    const track = await this.tracksService.findTrackShareTarget(slugOrId);

    if (!track) {
      return this.discoveryService.buildRedirectHtml('https://iqa3.tech', 'Track not found');
    }

    return this.discoveryService.buildTrackShareRedirectHtml(
      track.id,
      track.artistHandle,
      this.isMobileUserAgent(userAgent),
    );
  }
}
