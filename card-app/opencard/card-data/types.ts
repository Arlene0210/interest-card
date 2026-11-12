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
  /** 形状 ID（round / toast / onigiri / heart） */
  shapeId: string;
  /** 耳朵/头顶装饰部件 ID（none / round / point / bow / horn） */
  earId: string;
  /** 内馅 ID（爆浆色来源；none 表示无馅，捏爆时仍会爆出米白内瓤） */
  fillingId: string;
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

/** DIY 形象预设（卡通形象一键配置） */
export interface DiyPreset {
  /** 预设 ID（strawbear / ultraman / nailong） */
  id: string;
  /** 形象名 */
  name: string;
  /** 主体色（hex） */
  color: string;
  /** 身体形状 ID */
  shapeId: string;
  /** 耳朵/头顶装饰 ID */
  earId: string;
  /** 内馅 ID */
  fillingId: string;
  /** 形象说明 */
  desc: string;
}

/** DIY 身体形状选项 */
export interface DiyShapeOption {
  /** 形状 ID（round / toast / onigiri / heart） */
  id: string;
  /** 形状名 */
  name: string;
}

/** DIY 耳朵/头顶装饰选项 */
export interface DiyEarOption {
  /** 装饰 ID（none / round / point / bow / horn） */
  id: string;
  /** 装饰名 */
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
  /** 形象预设行标签 */
  presetLabel: string;
  /** 身体行标签 */
  shapeLabel: string;
  /** 耳朵行标签 */
  earLabel: string;
  /** 颜色行标签 */
  colorLabel: string;
  /** 内馅行标签 */
  fillingLabel: string;
  /** 形象预设列表 */
  presets: DiyPreset[];
  /** 身体形状选项 */
  shapes: DiyShapeOption[];
  /** 耳朵/头顶装饰选项 */
  ears: DiyEarOption[];
  /** 颜色选项 */
  colors: DiyColorOption[];
  /** 内馅选项 */
  fillings: DiyFillingOption[];
}

/** 叠捏数量配置（加减号步进 + 数字输入） */
export interface StackConfig {
  /** 数字输入标签（"数量"） */
  customLabel: string;
  /** 数量上限 */
  max: number;
  /** 数量下限 */
  min: number;
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
  /** 叠捏数量配置 */
  stack: StackConfig;
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
