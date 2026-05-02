import { Controller, Get, Header, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { TracksService } from './tracks.service';

@ApiTags('Share')
@Controller('share')
export class ShareController {
  constructor(private readonly tracksService: TracksService) {}

  private buildDeepLinkHtml(targetUrl: string, title: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta http-equiv="refresh" content="0; url=${targetUrl}">
  <script>
    window.location.href = "${targetUrl}";
  </script>
</head>
<body>
  <p>Opening in app...</p>
</body>
</html>`;
  }

  @Get('track/:slugOrId')
  @Public()
  @Header('Content-Type', 'text/html')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Open a track in the mobile app' })
  @ApiParam({ name: 'slugOrId', description: 'Track slug or UUID' })
  @ApiOkResponse({ description: 'HTML redirect response.' })
  async shareTrack(@Param('slugOrId') slugOrId: string) {
    const track = await this.tracksService.findTrackShareTarget(slugOrId);
    const targetUrl = track ? `iqa3://track/${track.id}` : 'https://iqa3.tech';

    return this.buildDeepLinkHtml(
      targetUrl,
      track ? 'Opening track...' : 'Track not found',
    );
  }
}
