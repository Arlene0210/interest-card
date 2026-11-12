import { Injectable, Logger } from '@nestjs/common';

/** 单次捏压上报 */
export interface SquishyReportDto {
  /** 本次解压值增量 */
  relief: number;
  /** 力度档位名 */
  levelLabel: string;
  /** 本次捏捏次数（增量） */
  count: number;
}

/** 用户维度的累计游玩记录 */
export interface SquishyUserStats {
  /** 累计解压值 */
  totalRelief: number;
  /** 累计捏捏次数 */
  pressCount: number;
  /** 最高力度档位名 */
  bestLevel: string;
  /** 最近一次游玩时间戳 */
  lastPlayedAt: number;
}

/** 力度档位排名（越大越强） */
const LEVEL_RANK: Record<string, number> = {
  轻捏: 1,
  用力捏: 2,
  捏爆: 3,
};

/** 归一化档位名：去掉「Lv.1/Lv.2/Lv.3」前缀与空白，映射到标准档位 key */
function normalizeLevelLabel(label: string): string {
  const trimmed = label.replace(/^Lv\.\d+\s*/i, '').trim();
  return LEVEL_RANK[trimmed] !== undefined ? trimmed : label;
}

/**
 * 捏捏乐解压记录服务（内存实现，demo 场景不依赖数据库）。
 * key 为用户 openId；未携带身份时使用匿名桶。
 */
@Injectable()
export class SquishyService {
  private readonly logger = new Logger(SquishyService.name);
  private readonly stats = new Map<string, SquishyUserStats>();

  /** 记录一次捏压（mutation：只写，不返回渲染字段） */
  report(openId: string | undefined, dto: SquishyReportDto): { success: boolean } {
    const key = openId && openId.length > 0 ? openId : 'anonymous';
    const relief = Number(dto?.relief) || 0;
    const count = Number(dto?.count) || 1;
    const rawLabel = typeof dto?.levelLabel === 'string' ? dto.levelLabel : '轻捏';
    const levelLabel = normalizeLevelLabel(rawLabel);

    const current = this.stats.get(key) ?? {
      totalRelief: 0,
      pressCount: 0,
      bestLevel: '—',
      lastPlayedAt: 0,
    };

    current.totalRelief += relief;
    current.pressCount += count;
    if ((LEVEL_RANK[levelLabel] ?? 0) > (LEVEL_RANK[current.bestLevel] ?? 0)) {
      current.bestLevel = levelLabel;
    }
    current.lastPlayedAt = Date.now();

    this.stats.set(key, current);
    this.logger.log(
      `[squishy] report key=${key} relief=${relief} level=${levelLabel} total=${current.totalRelief} count=${current.pressCount}`,
    );
    return { success: true };
  }

  /** 查询累计记录（供落地页报告展示） */
  getStats(openId: string | undefined): { success: boolean; data: SquishyUserStats | null } {
    const key = openId && openId.length > 0 ? openId : 'anonymous';
    const record = this.stats.get(key);
    if (!record) {
      return { success: true, data: null };
    }
    return { success: true, data: record };
  }
}
