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
  /** 形状 ID（round / toast / onigiri / heart） */
  shapeId: string;
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

/** DIY 形状选项 */
export interface DiyShapeOption {
  /** 形状 ID（round / toast / onigiri / heart） */
  id: string;
  /** 形状名 */
  name: string;
}

/** DIY 颜色选项 */
export interface DiyColorOption {
  /** 颜色 ID */
  id: string;
  /** 颜色名 */
  name: string;
  /** 色值（hex） */
  hex: string;
}

/** DIY 内馅选项 */
export interface DiyFillingOption {
  /** 内馅 ID（none 表示无馅） */
  id: string;
  /** 内馅名 */
  name: string;
  /** 内馅色值；无馅为空字符串 */
  hex: string;
}

/** DIY 层数档位 */
export interface DiyLayerOption {
  /** 层数（1-3） */
  count: number;
  /** 档位名 */
  label: string;
  /** 解压值倍率 */
  multiplier: number;
}

/** DIY 制作器配置（服务端下发，前端只渲染不拼装业务文案） */
export interface DiyPayload {
  /** 弹层标题 */
  title: string;
  /** Footer 打开弹层按钮文案 */
  openLabel: string;
  /** DIY 捏捏展示名 */
  customName: string;
  /** 确认按钮文案 */
  confirmLabel: string;
  /** 形状行标签 */
  shapeLabel: string;
  /** 颜色行标签 */
  colorLabel: string;
  /** 内馅行标签 */
  fillingLabel: string;
  /** 层数行标签 */
  layerLabel: string;
  /** 形状选项 */
  shapes: DiyShapeOption[];
  /** 颜色选项 */
  colors: DiyColorOption[];
  /** 内馅选项 */
  fillings: DiyFillingOption[];
  /** 层数档位 */
  layers: DiyLayerOption[];
}

/** 右侧叠捏数量档位 */
export interface StackOption {
  /** 数量（1-3） */
  count: number;
  /** 按钮标签（×1 / ×2 / ×3） */
  label: string;
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
  /** DIY 制作器配置 */
  diy: DiyPayload;
  /** 叠捏数量档位 */
  stackOptions: StackOption[];
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
