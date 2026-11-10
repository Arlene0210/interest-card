import { All, Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { SquishyService } from './squishy.service';

/**
 * 捏捏乐解压记录接口。
 * report 为 mutation（只写库语义，不返回 UI 渲染字段）；stats 供落地页报告查询。
 */
@Controller('api')
export class SquishyController {
  constructor(private readonly squishyService: SquishyService) {}

  @Post('squishy/report')
  @HttpCode(200)
  report(
    @Body() body: { relief: number; levelLabel: string; count: number },
    @Headers('x-tt-openid') openId?: string,
  ): { success: boolean } {
    return this.squishyService.report(openId, body);
  }

  @All('squishy/stats')
  @HttpCode(200)
  stats(@Headers('x-tt-openid') openId?: string): unknown {
    return this.squishyService.getStats(openId);
  }
}
