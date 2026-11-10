/**
 * CardData 类型定义（SSOT）。
 * 扩展业务时改本文件，并同步 server/src/card-data/card-data.types.ts 与 buildCardData() 返回值。
 * `@/services/card-data` 会 re-export 本文件全部类型；业务类型写在这里即可从服务层导入。
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

/** 反馈视图：松手后文案（用于落地页报告口径一致性） */
export interface ExpandedViewPayload {
  /** 标题 */
  title: string;
  /** 正文 */
  body: string;
  /** 标签 */
  tags: string[];
}

/** 模板示例 views；扩展业务时在此增减 view 定义 */
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
