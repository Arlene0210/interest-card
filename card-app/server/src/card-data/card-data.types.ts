/**
 * 与 opencard/card-data/types.ts 保持同步（server 独立部署时随 CardDataModule 一起发布）。
 */

/** 捏捏玩具档案 */
export interface SquishyToy {
  /** 玩具 ID（toy-1 / toy-2 / toy-3） */
  id: string;
  /** 展示名 */
  name: string;
  /** 主体颜色（hex） */
  color: string;
  /** 口头禅式说明 */
  desc: string;
  /** 材质软硬：影响捏瘪速率（0-1，越大越软） */
  softness: number;
}

/** 力度档位文案 */
export interface SqueezeLevel {
  /** 档位最小力度（0-100） */
  min: number;
  /** 档位名（轻捏 / 用力捏 / 捏爆） */
  label: string;
  /** 该档位反馈文案 */
  feedback: string;
  /** 解压值增量 */
  relief: number;
  /** 拟声词 */
  onomatopoeia: string;
}

/** 首屏视图：捏捏乐玩法主体 */
export interface InitialViewPayload {
  /** 玩法提示 */
  hint: string;
  /** 玩具列表（3 款） */
  toys: SquishyToy[];
  /** 力度档位表 */
  levels: SqueezeLevel[];
  /** 音效开关默认文案 */
  soundLabel: string;
}

/** 反馈视图：松手后文案 */
export interface ExpandedViewPayload {
  /** 标题 */
  title: string;
  /** 正文 */
  body: string;
  /** 标签 */
  tags: string[];
}

export interface CardDataViews {
  initial: InitialViewPayload;
  expanded: ExpandedViewPayload;
}

export interface CardData {
  contractVersion: string;
  displayMode: string;
  views: CardDataViews;
  userState?: {
    hasExpanded?: boolean;
  };
  meta?: {
    source?: string;
  };
}

/** 平台 dy_card/data 外层响应壳（固定） */
export interface DyCardApiResponse {
  success: boolean;
  data: string;
}
