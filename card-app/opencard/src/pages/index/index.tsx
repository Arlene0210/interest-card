import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Input } from "@tarojs/components";
import { useDidHide, useLoad, useCardTaro, useUnload } from "@tarojs/taro";
import {
  extractOpenCardLoadData,
  resolveCardData,
  type CardData,
  type OpenCardLoadData,
  type SqueezeLevel,
  type SquishyToy,
} from "@/services/card-data";
import { Network } from "@/network";
import "./index.css";

/** 力度增长间隔（ms） */
const POWER_TICK_MS = 80;
/** 每次力度增长基础量 */
const POWER_STEP = 8;
/** 反馈文案展示时长（ms） */
const FEEDBACK_MS = 1600;
/** 解压值上报节流间隔（ms）：窗口尽量短，配合隐藏冲账避免跳转丢增量 */
const REPORT_THROTTLE_MS = 400;
/** 叠捏连播音效基础间隔（ms，数量越大越密） */
const STACK_SOUND_GAP_MS = 55;
/** 爆裂动画总时长（ms）：蜡皮碎裂飞散 0-1.1s（抛物弧线）→ 馅料从裂缝泵出 0.3-1.9s（流动瘫软） */
const BURST_MS = 1950;
/** 数量输入上限 */
const STACK_MAX = 100;
/** 音效连播抽样上限（超过该数量按比例抽样播放） */
const SOUND_SAMPLE_MAX = 12;
/** 裂纹浮现的最低力度（%） */
const CRACK_MIN_POWER = 60;
/** 深捏加深开始的力度（%）：此力度以上凹坑/裂纹额外加深加粗（粘土被真正压到深处） */
const DEEP_PRESS_POWER = 75;
/** 三处凹陷依次出现的力度阈值（%） */
const DENT_STEPS = [30, 60, 90];
/** 数量越界提示时长（ms） */
const STACK_HINT_MS = 800;
/** 长按步进首次延迟（ms） */
const STEP_HOLD_DELAY_MS = 450;
/** 长按步进连续间隔（ms） */
const STEP_HOLD_INTERVAL_MS = 110;
/** 长按步进连发步长 */
const STEP_HOLD_BATCH = 5;
/** 蜡皮混白比例：主体色 → 泛白蜡壳（外层白蜡膜的浓度） */
const WAX_MIX_RATIO = 0.55;
/** 蜡皮膜不透明度（白蜂蜡+大豆蜡的乳白半透明感） */
const WAX_FILM_OPACITY = 0.52;

/** 松手反馈对象 */
interface PressFeedback {
  level: SqueezeLevel;
  gain: number;
}

/** 十六进制色混合（向 target 色靠拢 ratio 比例） */
function mixHexColor(hex: string, target: string, ratio: number): string {
  const parse = (value: string) => {
    const normalized = value.replace("#", "");
    if (normalized.length !== 6) return null;
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r, g, b };
  };
  const from = parse(hex);
  const to = parse(target);
  if (!from || !to) return hex;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * ratio);
  const r = mix(from.r, to.r);
  const g = mix(from.g, to.g);
  const b = mix(from.b, to.b);
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}

/** 根据当前力度返回命中的档位（取满足 min 的最高档） */
function matchLevel(power: number, levels: SqueezeLevel[]): SqueezeLevel | null {
  let hit: SqueezeLevel | null = null;
  for (const level of levels) {
    if (power >= level.min && (!hit || level.min > hit.min)) {
      hit = level;
    }
  }
  return hit;
}

/**
 * 侧视堆叠布局（JS 计算，返回容器 px 偏移）：垂直叠成一座捏捏塔。
 * 底部对齐、整体垂直居中；每只带轻微横向错位（正弦自然抖动），层间距按数量压缩重叠。
 */
function stackLayout(
  count: number,
  ballHeightPx: number,
  containerHeightPx: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  if (count <= 1) {
    return [{ x: 0, y: 0 }];
  }
  // 层间距：单层完整高度的 55%（自然堆叠重叠），超出可用高度时按比例压缩
  const naturalStep = ballHeightPx * 0.55;
  const maxTower = containerHeightPx * 0.86;
  const stepY = Math.min(naturalStep, maxTower / count);
  const centerYOffset = ((count - 1) * stepY) / 2;
  for (let i = 0; i < count; i += 1) {
    const jitter = Math.sin(i * 2.3) * containerHeightPx * 0.018 + Math.cos(i * 0.7) * containerHeightPx * 0.009;
    points.push({
      x: (jitter / (containerHeightPx * 0.86)) * 100,
      y: (centerYOffset - i * stepY) / containerHeightPx * 100,
    });
  }
  return points;
}

/** 单只捏捏尺寸（%）：数量 1 为正视图大球（完整展示形象），>1 为侧视压扁椭圆垂直堆叠 */
function stackBallSize(count: number): { widthPct: number; heightRatio: number } {
  // heightRatio：高度 = 宽度 px × ratio（1 = 正视图近圆；<1 = 侧视压扁）
  if (count <= 1) return { widthPct: 52, heightRatio: 1 };
  if (count <= 3) return { widthPct: 34, heightRatio: 0.62 };
  if (count <= 10) return { widthPct: 30, heightRatio: 0.58 };
  if (count <= 25) return { widthPct: 25, heightRatio: 0.52 };
  if (count <= 50) return { widthPct: 19, heightRatio: 0.46 };
  return { widthPct: 14, heightRatio: 0.42 };
}

/** 渲染爱心形状的三片结构件（容器内按百分比定位，可任意缩放） */
function renderHeartParts(color: string, keyPrefix: string) {
  return [
    <View
      key={`${keyPrefix}-core`}
      className="squishy-heart-core"
      style={`background-color: ${color};`}
    />,
    <View
      key={`${keyPrefix}-lobe-l`}
      className="squishy-heart-lobe squishy-heart-lobe-left"
      style={`background-color: ${color};`}
    />,
    <View
      key={`${keyPrefix}-lobe-r`}
      className="squishy-heart-lobe squishy-heart-lobe-right"
      style={`background-color: ${color};`}
    />,
  ];
}

/**
 * 渲染耳朵/头顶装饰结构件（CSS 拼装，按身体顶部定位）。
 * round 圆耳 / point 尖耳 / bow 蝴蝶结 / horn 犄角。
 */
function renderEarParts(earId: string, color: string, keyPrefix: string) {
  if (earId === "none") return null;
  if (earId === "round") {
    return [
      <View
        key={`${keyPrefix}-ear-l`}
        className="squishy-ear squishy-ear-round squishy-ear-left"
        style={`background-color: ${color};`}
      />,
      <View
        key={`${keyPrefix}-ear-r`}
        className="squishy-ear squishy-ear-round squishy-ear-right"
        style={`background-color: ${color};`}
      />,
    ];
  }
  if (earId === "point") {
    return [
      <View
        key={`${keyPrefix}-ear-l`}
        className="squishy-ear squishy-ear-point squishy-ear-left"
        style={`background-color: ${color};`}
      />,
      <View
        key={`${keyPrefix}-ear-r`}
        className="squishy-ear squishy-ear-point squishy-ear-right"
        style={`background-color: ${color};`}
      />,
    ];
  }
  if (earId === "bow") {
    return [
      <View key={`${keyPrefix}-bow`} className="squishy-ear squishy-ear-bow">
        <View className="squishy-ear-bow-left" />
        <View className="squishy-ear-bow-right" />
        <View className="squishy-ear-bow-knot" />
      </View>,
    ];
  }
  if (earId === "horn") {
    return [
      <View
        key={`${keyPrefix}-horn-l`}
        className="squishy-ear squishy-ear-horn squishy-ear-left"
        style={`background-color: ${color};`}
      />,
      <View
        key={`${keyPrefix}-horn-r`}
        className="squishy-ear squishy-ear-horn squishy-ear-right"
        style={`background-color: ${color};`}
      />,
    ];
  }
  return null;
}

export default function IndexPage() {
  const taroRef = useRef<openCardTaro>();
  const mountedRef = useRef(true);
  const bootstrappedRef = useRef(false);
  const loadDataRef = useRef<OpenCardLoadData>();

  const [cardData, setCardData] = useState<CardData | null>(null);
  const [loadError, setLoadError] = useState(false);

  // 玩法状态
  const [toyIndex, setToyIndex] = useState(0);
  const [power, setPower] = useState(0); // 0-100 力度
  const [pressing, setPressing] = useState(false);
  const [squeezed, setSqueezed] = useState(false); // 松手后保持凹陷
  const [relief, setRelief] = useState(0); // 累计解压值
  const [feedback, setFeedback] = useState<PressFeedback | null>(null); // 松手反馈
  const [pressCount, setPressCount] = useState(0); // 本次捏捏次数
  const [bestLabel, setBestLabel] = useState<string>("—"); // 最高压力等级档
  const [soundOn, setSoundOn] = useState(true);

  // v3 状态
  const [diyOpen, setDiyOpen] = useState(false); // DIY 弹层
  const [stackCount, setStackCount] = useState(1); // 叠捏数量 1-100
  const [stackInput, setStackInput] = useState("1"); // 自定义数量输入框文本
  const [stackHint, setStackHint] = useState(false); // 数量越界提示
  const [bursting, setBursting] = useState(false); // 爆裂动画中
  const [burstShaped, setBurstShaped] = useState(false); // 捏爆后破相残体（换新前保持）
  const [seepSettled, setSeepSettled] = useState(0); // 松手后裂缝渗馅程度（0-1，按本次按压峰值力度换算）
  const [dentSettled, setDentSettled] = useState(0); // 松手后粘土指印保留程度（0-1，按本次按压峰值力度换算）
  const [selPreset, setSelPreset] = useState<string>(""); // DIY 选中形象预设（空=自定义）
  const [selShape, setSelShape] = useState<string>("round"); // DIY 身体形状
  const [selEar, setSelEar] = useState<string>("none"); // DIY 耳朵
  const [selColor, setSelColor] = useState<string>("strawbear"); // DIY 配色
  const [selFilling, setSelFilling] = useState<string>("strawberry"); // DIY 内馅
  const [customToy, setCustomToy] = useState<SquishyToy | null>(null); // 用户 DIY 的捏捏

  // 长生命周期逻辑状态（ref 镜像）
  const powerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const soundOnRef = useRef(true);
  const reliefRef = useRef(0);
  const pressCountRef = useRef(0);
  const bestRankRef = useRef(-1);
  const taroApiRef = useRef<openCardTaro | null>(null);
  const reportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReportRef = useRef(0);
  const lastReportAtRef = useRef(0);
  const lastLevelRef = useRef<string>(""); // 最近一次捏压档位（隐藏冲账/落地页延续用）
  const currentToyRef = useRef<SquishyToy | null>(null);
  const powerRef = useRef(0);
  const pressingRef = useRef(false);
  const seepLatchRef = useRef(0); // 本次按压峰值力度（渗馅残留依据）
  const soundLatchCrackRef = useRef(0); // 本次按压已播过实时脆裂音的力度阈值（防重复播）
  const stackCountRef = useRef(1);
  const stackHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 长按步进计时器（−/+ 按钮）
  const stepHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepHoldIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 堆叠容器实测尺寸（px）：侧视堆叠布局按容器实际尺寸计算层距
  const [stackSize, setStackSize] = useState<{ w: number; h: number } | null>(null);
  const stackSizeQueriedRef = useRef(false);

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  // 同步 ref 镜像
  useEffect(() => {
    powerRef.current = power;
  }, [power]);

  useEffect(() => {
    pressingRef.current = pressing;
  }, [pressing]);

  useEffect(() => {
    stackCountRef.current = stackCount;
  }, [stackCount]);

  // 卸载时清理全部计时器
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (powerTimerRef.current) clearInterval(powerTimerRef.current);
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
      if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
      if (stackHintTimerRef.current) clearTimeout(stackHintTimerRef.current);
      if (stepHoldTimerRef.current) clearTimeout(stepHoldTimerRef.current);
      if (stepHoldIntervalRef.current) clearInterval(stepHoldIntervalRef.current);
      soundTimersRef.current.forEach((timer) => clearTimeout(timer));
      soundTimersRef.current = [];
    };
  }, []);

  const bootstrapCardData = useCallback(async () => {
    const taro = taroRef.current;
    if (!taro) {
      return;
    }

    const data = await resolveCardData(taro, loadDataRef.current);
    if (!mountedRef.current) {
      return;
    }
    if (data) {
      setCardData(data);
      setLoadError(false);
      // 回读服务端已知的累计统计：卡片再次进入时接续累计（解压值/次数/最高档不归零），
      // 与落地页报告同源同口径，避免「卡上捏了、页里看不到；页里看了、卡上又归零」的割裂
      const userState = data.userState;
      if (userState) {
        const serverRelief = Number(userState.totalRelief);
        const serverPress = Number(userState.pressCount);
        if (Number.isFinite(serverRelief) && serverRelief > 0) {
          reliefRef.current = serverRelief;
          setRelief(serverRelief);
        }
        if (Number.isFinite(serverPress) && serverPress > 0) {
          pressCountRef.current = serverPress;
          setPressCount(serverPress);
        }
        const serverBest = userState.bestLevel;
        if (typeof serverBest === "string" && serverBest.length > 0 && serverBest !== "—") {
          // bootstrap 时机早于 cardData state 更新：直接用本次 data 的档位表换算排名
          const levelsNow = data.views?.initial?.levels ?? [];
          const rank = levelsNow.findIndex(
            (item) => item.label === serverBest || item.label.endsWith(serverBest),
          );
          if (rank >= 0 && rank > bestRankRef.current) {
            bestRankRef.current = rank;
            // 用档位表原始 label（含 Lv. 前缀）保持卡片文案一致
            setBestLabel(levelsNow[rank].label);
          }
        }
      }
    } else {
      setLoadError(true);
    }
  }, []);

  const tryBootstrapCardData = useCallback(() => {
    if (bootstrappedRef.current || !taroRef.current) {
      return;
    }
    bootstrappedRef.current = true;
    void bootstrapCardData();
  }, [bootstrapCardData]);

  useLoad((...args: unknown[]) => {
    const query = args[0] as Record<string, unknown> | undefined;
    const data = args[1] as OpenCardLoadData | undefined;
    loadDataRef.current = extractOpenCardLoadData(query, data);
    tryBootstrapCardData();
  });

  useCardTaro((taro) => {
    taroRef.current = taro;
    taroApiRef.current = taro;
    tryBootstrapCardData();
    // 量取堆叠容器实际尺寸（px），用于百分比布局点 → px 偏移换算
    if (!stackSizeQueriedRef.current) {
      stackSizeQueriedRef.current = true;
      try {
        const query = taro.createSelectorQuery() as unknown as {
          select: (selector: string) => unknown;
        };
        const chain = query.select(".squishy-stack") as unknown as {
          boundingClientRect: () => unknown;
        };
        const exec = chain.boundingClientRect() as unknown as {
          exec: (callback: (result: unknown) => void) => void;
        };
        exec.exec((result: unknown) => {
          const rect = Array.isArray(result) ? (result[0] as { width?: number; height?: number } | null) : null;
          if (rect && typeof rect.width === "number" && typeof rect.height === "number" && mountedRef.current) {
            setStackSize({ w: rect.width, h: rect.height });
          }
        });
      } catch (error) {
        console.error("[squishy] measure stack failed", error);
      }
    }
  });

  const toys = cardData?.views?.initial?.toys ?? [];
  const levels = cardData?.views?.initial?.levels ?? [];
  const diy = cardData?.views?.initial?.diy;
  const stack = cardData?.views?.initial?.stack;
  const stackMin = stack?.min ?? 1;
  const stackMax = stack?.max ?? STACK_MAX;
  // 当前生效捏捏：DIY 捏捏优先，否则为预设玩具
  const activeToy = customToy ?? toys[toyIndex];
  const currentLevel = matchLevel(power, levels);

  // 同步当前玩具到 ref（供定时器/松手回调读取）
  useEffect(() => {
    currentToyRef.current = activeToy ?? null;
  }, [activeToy]);

/** 捏压音效源（按真实脆皮捏捏材料合成，响度已按宿主 BGM 掩蔽校准增强）：蜡皮脆裂（大豆蜡+蜂蜡壳）/ 蜡壳崩裂（捏爆）/ 内馅湿陷（超轻粘土+甘油+珍珠岩） */
const SFX_WAX_CRACK = "https://lf-aihub.douyinvod.com/obj/developer/card_7706443532244896531_ext/2ab69d940daf.mp3";
const SFX_WAX_BURST = "https://lf-aihub.douyinvod.com/obj/developer/card_7706443532244896531_ext/6bc2d34f6184.mp3";
const SFX_CLAY_SQUISH = "https://lf-aihub.douyinvod.com/obj/developer/card_7706443532244896531_ext/94ac8324021b.mp3";

/** 播放一次指定音效（可指定播放速率与音量） */
const playSfxOnce = (taro: openCardTaro | null, src: string, rate: number, volume: number) => {
  if (!taro) return;
  try {
    const audio = taro.createInnerAudioContext();
    audio.src = src;
    audio.playbackRate = rate;
    audio.volume = volume;
    let destroyed = false;
    const destroyAudio = () => {
      if (destroyed) return;
      destroyed = true;
      try {
        audio.destroy();
      } catch (destroyError) {
        console.error("[squishy] destroy audio failed", destroyError);
      }
    };
    audio.onError((err: unknown) => {
      console.error("[squishy] squeeze sound failed", err);
      destroyAudio();
    });
    audio.onEnded(() => {
      destroyAudio();
    });
    audio.play();
    // 兜底释放：若事件未触发，2.5s 后回收
    setTimeout(destroyAudio, 2500);
  } catch (error) {
    console.error("[squishy] create audio context failed", error);
  }
};

  /**
   * 播放捏压音效 + 触觉反馈（真实脆皮捏捏双层声学）。
   * 轻捏 = 纯内馅湿陷（闷、软）；用力捏 = 蜡皮脆裂 + 内馅湿陷；捏爆 = 蜡壳崩裂 + 大口湿陷。
   * 叠捏按只数密集连播（间隔 40-90ms、速率缓升封顶 2.2），超过抽样上限按比例抽样。
   */
  const playSqueezeFeedback = useCallback(
    (level: SqueezeLevel | null) => {
      if (!soundOnRef.current) return;
      const isBurst = !!level && level.min >= 70;
      const isHard = !!level && level.min >= 35;
      const count = stackCountRef.current;
      // 抽样：大数量时只播满 SOUND_SAMPLE_MAX 只的密集节奏，避免 100 只音频风暴
      const playedCount = Math.min(count, SOUND_SAMPLE_MAX);
      // 数量越大间隔越密（90ms → 40ms），对齐视频里「捏一盘」的密集沙沙声
      const gap = Math.max(40, STACK_SOUND_GAP_MS - Math.min(50, playedCount * 4));
      soundTimersRef.current.forEach((timer) => clearTimeout(timer));
      soundTimersRef.current = [];
      const schedule = (src: string, rate: number, volume: number, at: number) => {
        if (at <= 0) {
          playSfxOnce(taroApiRef.current, src, rate, volume);
        } else {
          const timer = setTimeout(() => {
            playSfxOnce(taroApiRef.current, src, rate, volume);
          }, at);
          soundTimersRef.current.push(timer);
        }
      };
      for (let i = 0; i < playedCount; i += 1) {
        const rate = Math.min(2.2, (isBurst ? 1.15 : isHard ? 1.05 : 0.92) * (1 + i * 0.08));
        const at = i * gap;
        if (isBurst) {
          // 捏爆：蜡壳崩裂为主 + 0.22s 后内馅大口湿陷
          schedule(SFX_WAX_BURST, rate, 1, at);
          schedule(SFX_CLAY_SQUISH, Math.min(2.2, rate * 1.12), 0.9, at + 220);
        } else if (isHard) {
          // 用力捏：脆裂 + 0.085s 后湿陷
          schedule(SFX_WAX_CRACK, rate, 0.9, at);
          schedule(SFX_CLAY_SQUISH, rate, 1, at + 85);
        } else {
          // 轻捏：只有内馅闷湿陷
          schedule(SFX_CLAY_SQUISH, rate, 0.75, at);
        }
      }
      // 轻震动反馈（当前运行环境仅支持 vibrateShort，统一轻震动，叠捏保持单次）
      const taro = taroApiRef.current;
      if (taro) {
        try {
          taro.vibrateShort?.();
        } catch (error) {
          console.error("[squishy] vibrate failed", error);
        }
      }
    },
    [],
  );

  /** 真实上报捏压记录（写库语义，仅返回成功标志，不返回渲染字段） */
  const flushReport = useCallback((levelLabel: string, count: number) => {
    const taro = taroApiRef.current;
    if (!taro) return;
    const amount = pendingReportRef.current;
    pendingReportRef.current = 0;
    if (amount <= 0) return;
    lastReportAtRef.current = Date.now();
    void Network.request(taro, {
      url: "/api/squishy/report",
      method: "POST",
      data: {
        relief: amount,
        levelLabel,
        count,
      },
    } as never).catch((error: unknown) => {
      console.error("[squishy] report failed", error);
    });
  }, []);

  /** 上报一次捏压记录（节流合并，超窗自动补报） */
  const reportSqueeze = useCallback(
    (level: SqueezeLevel, gain: number, count: number) => {
      pendingReportRef.current += gain;
      // 记录最近一次档位：隐藏兜底冲账与落地页「最近一次操作」都用它
      lastLevelRef.current = level.label;
      const now = Date.now();
      if (now - lastReportAtRef.current < REPORT_THROTTLE_MS) {
        if (!reportTimerRef.current) {
          reportTimerRef.current = setTimeout(() => {
            reportTimerRef.current = null;
            flushReport(lastLevelRef.current, stackCountRef.current);
          }, REPORT_THROTTLE_MS);
        }
        return;
      }
      flushReport(level.label, count);
    },
    [flushReport],
  );

  /** 卡片隐藏（用户滑走/进入落地页）时立即冲账：把节流窗口内未上报的增量落库，避免丢数 */
  useDidHide(() => {
    if (reportTimerRef.current) {
      clearTimeout(reportTimerRef.current);
      reportTimerRef.current = null;
    }
    if (pendingReportRef.current > 0) {
      flushReport(lastLevelRef.current || "轻捏", stackCountRef.current);
    }
  });

  /** 卡片卸载时同样冲账兜底（进程回收等极端场景） */
  useUnload(() => {
    if (reportTimerRef.current) {
      clearTimeout(reportTimerRef.current);
      reportTimerRef.current = null;
    }
    if (pendingReportRef.current > 0) {
      flushReport(lastLevelRef.current || "轻捏", stackCountRef.current);
    }
  });

  /** 清理爆裂计时器并复位爆裂态 */
  const cancelBurst = useCallback(() => {
    if (burstTimerRef.current) {
      clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
    }
    setBursting(false);
  }, []);

  /** 完全重置捏压状态（换新 / 切换玩具 / DIY 应用时调用，恢复全新蜡皮） */
  const resetBurst = useCallback(() => {
    cancelBurst();
    setBurstShaped(false);
    setSeepSettled(0);
    setDentSettled(0);
    seepLatchRef.current = 0;
    soundLatchCrackRef.current = 0;
  }, [cancelBurst]);

  /** 开始按压 */
  const handlePressStart = useCallback(() => {
    if (!cardData || pressingRef.current) return;
    cancelBurst();
    setPressing(true);
    setSqueezed(false);
    setFeedback(null);
    seepLatchRef.current = 0; // 新一次按压峰值从零开始
    soundLatchCrackRef.current = 0; // 实时脆裂音闩锁复位
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    // 起手一声内馅闷陷（粘土内馅被指头压住的软声）
    if (soundOnRef.current) {
      playSfxOnce(taroApiRef.current, SFX_CLAY_SQUISH, 0.85, 0.35);
    }
    // 力度随按住时长增长
    if (powerTimerRef.current) clearInterval(powerTimerRef.current);
    const advancePower = () => {
      const softness = currentToyRef.current?.softness ?? 0.6;
      const step = POWER_STEP * (0.7 + softness * 0.6);
      const next = Math.min(100, powerRef.current + step);
      powerRef.current = next; // ref 与 state 同帧推进，松手回调读取最终力度
      setPower(next);
      if (next > seepLatchRef.current) {
        seepLatchRef.current = next; // 记录峰值：松手后裂缝渗馅按峰值保留
      }
      // 实时脆裂反馈：力度首次跨过用力捏阈值（35%）→ 一声蜡裂；跨过裂纹阈值（60%）→ 一声更脆的崩裂
      if (soundOnRef.current) {
        if (seepLatchRef.current >= CRACK_MIN_POWER && soundLatchCrackRef.current < CRACK_MIN_POWER) {
          soundLatchCrackRef.current = CRACK_MIN_POWER;
          playSfxOnce(taroApiRef.current, SFX_WAX_CRACK, 1.25, 0.5);
        } else if (seepLatchRef.current >= 35 && soundLatchCrackRef.current < 35) {
          soundLatchCrackRef.current = 35;
          playSfxOnce(taroApiRef.current, SFX_WAX_CRACK, 0.95, 0.32);
        }
      }
      if (next >= 100 && powerTimerRef.current) {
        clearInterval(powerTimerRef.current);
        powerTimerRef.current = null;
      }
    };
    advancePower();
    powerTimerRef.current = setInterval(advancePower, POWER_TICK_MS);
  }, [cardData, cancelBurst]);

  /** 结束按压：保持形变不回弹 + 即时反馈 + 捏爆触发真实爆浆 */
  const handlePressEnd = useCallback(() => {
    if (!cardData || !pressingRef.current) return;
    if (powerTimerRef.current) {
      clearInterval(powerTimerRef.current);
      powerTimerRef.current = null;
    }
    const finalPower = powerRef.current;
    setPressing(false);
    setSqueezed(true); // 不回弹：凹陷/裂纹/渗馅按峰值保留（陶土记忆）
    setSeepSettled(Math.min(1, Math.max(0, (finalPower - CRACK_MIN_POWER) / (100 - CRACK_MIN_POWER))));
    setDentSettled(Math.min(1, finalPower / 100)); // 粘土指印：按本次力度保留
    soundLatchCrackRef.current = 0; // 实时脆裂音复位（下一次按压重新播）
    setPower(0);
    powerRef.current = 0;
    const level = matchLevel(finalPower, levels);
    if (level) {
      // 叠捏数量放大本次解压值
      const count = stackCountRef.current;
      const gain = Math.round(level.relief * count);
      setFeedback({ level, gain });
      playSqueezeFeedback(level);
      reliefRef.current += gain;
      pressCountRef.current += count;
      setRelief(reliefRef.current);
      setPressCount(pressCountRef.current);
      const rank = levels.findIndex((item) => item.label === level.label);
      if (rank > bestRankRef.current) {
        bestRankRef.current = rank;
        setBestLabel(level.label);
      }
      // 捏爆档触发蜡皮崩裂：碎片飞溅 + 露馅 + 挂壁拉丝；动画结束进入破相残体态
      if (level.min >= 70) {
        setBursting(true);
        if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
        burstTimerRef.current = setTimeout(() => {
          burstTimerRef.current = null;
          if (mountedRef.current) {
            setBursting(false);
            setBurstShaped(true); // 爆后保持变形残体：不规则圆角 + 馅芯外露
          }
        }, BURST_MS);
      }
      reportSqueeze(level, gain, count);
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
      feedbackTimerRef.current = setTimeout(() => {
        feedbackTimerRef.current = null;
        if (mountedRef.current) {
          setFeedback(null);
        }
      }, FEEDBACK_MS);
    }
  }, [cardData, levels, playSqueezeFeedback, reportSqueeze]);

  /** 应用叠捏数量（钳制 1-100，越界高亮提示；回显钳制后数值）；数量变化时自动把捏捏复原到全新蜡皮 */
  const applyStackCount = useCallback(
    (raw: number) => {
      const next = Math.min(stackMax, Math.max(stackMin, Math.round(raw) || stackMin));
      if (raw > stackMax || raw < stackMin) {
        setStackHint(true);
        if (stackHintTimerRef.current) clearTimeout(stackHintTimerRef.current);
        stackHintTimerRef.current = setTimeout(() => {
          stackHintTimerRef.current = null;
          if (mountedRef.current) {
            setStackHint(false);
          }
        }, STACK_HINT_MS);
      }
      if (next === stackCountRef.current) {
        return; // 数量未变不触发复原
      }
      // 数量切换即换一盘：中断按压、清残体/渗馅，回到全新蜡皮
      if (powerTimerRef.current) {
        clearInterval(powerTimerRef.current);
        powerTimerRef.current = null;
      }
      setPressing(false);
      pressingRef.current = false;
      setSqueezed(false);
      setPower(0);
      powerRef.current = 0;
      resetBurst();
      stackCountRef.current = next; // 同步写 ref：连点/长按连发立即读到最新数量
      setStackCount(next);
      setStackInput(String(next));
    },
    [stackMin, stackMax, resetBurst],
  );

  /** 自定义数量输入（Input 文本变化） */
  const handleStackInput = useCallback(
    (value: string) => {
      const parsed = parseInt(value, 10);
      if (!Number.isFinite(parsed) || value.trim() === "") {
        // 非数字/清空：不钳制，仅回显原始文本（步进按钮点击会重置）
        setStackInput(value);
        return;
      }
      if (pressingRef.current) {
        setStackInput(value);
        return;
      }
      applyStackCount(parsed);
    },
    [applyStackCount],
  );

  /** 停止长按连步 */
  const stopStepHold = useCallback(() => {
    if (stepHoldTimerRef.current) {
      clearTimeout(stepHoldTimerRef.current);
      stepHoldTimerRef.current = null;
    }
    if (stepHoldIntervalRef.current) {
      clearInterval(stepHoldIntervalRef.current);
      stepHoldIntervalRef.current = null;
    }
  }, []);

  /** 步进 ±delta：单击一次；长按 450ms 后每 110ms 连发（连发步长 5），松手停止；任何数量变化都走 applyStackCount 复原捏捏 */
  const startStep = useCallback(
    (delta: 1 | -1) => {
      if (pressingRef.current) return;
      applyStackCount(stackCountRef.current + delta);
      stopStepHold();
      stepHoldTimerRef.current = setTimeout(() => {
        stepHoldTimerRef.current = null;
        stepHoldIntervalRef.current = setInterval(() => {
          applyStackCount(stackCountRef.current + delta * STEP_HOLD_BATCH);
        }, STEP_HOLD_INTERVAL_MS);
      }, STEP_HOLD_DELAY_MS);
    },
    [applyStackCount, stopStepHold],
  );

  /** 切换玩具 */
  const handleSwitchToy = useCallback(
    (index: number) => {
      if (index === toyIndex && !customToy) return;
      if (powerTimerRef.current) {
        clearInterval(powerTimerRef.current);
        powerTimerRef.current = null;
      }
      resetBurst();
      setCustomToy(null); // 回到预设玩具
      setToyIndex(index);
      setPower(0);
      powerRef.current = 0;
      setPressing(false);
      setSqueezed(false);
      setFeedback(null);
    },
    [toyIndex, customToy, resetBurst],
  );

  /** 换新一个捏捏（当前玩具回弹到全新状态） */
  const handleRenew = useCallback(() => {
    if (powerTimerRef.current) {
      clearInterval(powerTimerRef.current);
      powerTimerRef.current = null;
    }
    resetBurst();
    setSqueezed(false);
    setPower(0);
    powerRef.current = 0;
    setFeedback(null);
  }, [resetBurst]);

  /** 打开 DIY 弹层（以当前捏捏初始化部位） */
  const handleOpenDiy = useCallback(() => {
    if (!diy) return;
    if (!customToy) {
      const toy = toys[toyIndex];
      if (toy) {
        setSelShape(toy.shapeId);
        setSelEar(toy.earId);
        const matched = diy.colors.find((item) => item.hex === toy.color);
        if (matched) {
          setSelColor(matched.id);
        }
      }
    }
    setDiyOpen(true);
  }, [diy, customToy, toys, toyIndex]);

  /** 关闭 DIY 弹层 */
  const handleCloseDiy = useCallback(() => {
    setDiyOpen(false);
  }, []);

  /** 选中形象预设：一键填充身体/耳朵/配色/内馅 */
  const handleSelectPreset = useCallback(
    (presetId: string) => {
      const preset = diy?.presets.find((item) => item.id === presetId);
      if (!preset) return;
      setSelPreset(preset.id);
      setSelShape(preset.shapeId);
      setSelEar(preset.earId);
      const matched = diy?.colors.find((item) => item.hex === preset.color);
      if (matched) {
        setSelColor(matched.id);
      }
      setSelFilling(preset.fillingId);
    },
    [diy],
  );

  /** 确认 DIY：应用为当前捏捏（拼装形象） */
  const handleConfirmDiy = useCallback(() => {
    if (!diy) return;
    const shape = diy.shapes.find((item) => item.id === selShape) ?? diy.shapes[0];
    const color = diy.colors.find((item) => item.id === selColor) ?? diy.colors[0];
    const filling = diy.fillings.find((item) => item.id === selFilling);
    const preset = diy.presets.find((item) => item.id === selPreset);
    const toy: SquishyToy = {
      id: "toy-custom",
      name: preset ? preset.name : diy.customName,
      color: color.hex,
      shapeId: shape.id,
      earId: selEar,
      fillingId: selFilling,
      desc: filling && filling.id !== "none" ? `${filling.name}爆心` : "脆皮Q弹",
      softness: 0.75,
    };
    setCustomToy(toy);
    setDiyOpen(false);
    // 应用新捏捏后重置捏压状态
    if (powerTimerRef.current) {
      clearInterval(powerTimerRef.current);
      powerTimerRef.current = null;
    }
    resetBurst();
    setPower(0);
    powerRef.current = 0;
    setPressing(false);
    setSqueezed(false);
    setFeedback(null);
  }, [diy, selShape, selColor, selEar, selFilling, selPreset, resetBurst]);

  /** 重新拉取卡片数据 */
  const handleRetry = useCallback(() => {
    setLoadError(false);
    bootstrappedRef.current = false;
    tryBootstrapCardData();
  }, [tryBootstrapCardData]);

  const hint = cardData?.views?.initial?.hint ?? "长按捏瘪它 · 按得越久捏得越瘪";
  const canRenew = squeezed || burstShaped;
  // DIY 弹层开启时 Footer 不渲染（避免与弹层重叠交互）
  const showFooter = !!cardData && !diyOpen;

  // 形变几何值（JS 计算，动态内联）：粘土材质——按压以「局部凹陷」为主，整体只轻微紧绷不整球压扁；
  // 松手后形体基本回位、凹陷保留（陶土记忆）；捏爆仍是整体塌陷（0.7 → 0.46 → 0.42，一次塌到位绝不向上回弹）
  const squishScaleX = bursting
    ? 1.26
    : burstShaped
      ? 1.3
      : pressing
        ? 1 + 0.05 * (power / 100)
        : squeezed
          ? 1.02
          : 1;
  const squishScaleY = bursting
    ? 0.46
    : burstShaped
      ? 0.42
      : pressing
        ? 1 - 0.1 * (power / 100)
        : squeezed
          ? 0.97
          : 1;
  const squishScale = `scaleX(${squishScaleX.toFixed(3)}) scaleY(${squishScaleY.toFixed(3)})`;
  // 粘土主凹陷（捏的位置）：力度越深凹陷越大越深；松手后按本次峰值保留指印
  const effectivePower = pressing ? Math.max(power, dentSettled * 100) : dentSettled * 100;
  const dentDepth = Math.min(1, effectivePower / 100);
  // 深捏加重（≥75% 力度）：凹坑明显更大更深（粘土被真正压到深处）
  const deepBoost = Math.min(1, Math.max(0, (effectivePower - DEEP_PRESS_POWER) / 25));
  const dentGroupOpacity = 0.34 + 0.66 * dentDepth;
  // 满力深捏时凹陷明显扩大加深（真实粘土被拇指压出的深坑），轻捏只留浅印
  const dentGroupScale = 0.64 + 0.7 * dentDepth + 0.14 * deepBoost;
  // 三处次级压痕随力度依次显现（松手后按峰值保留）
  const stepOpacities = DENT_STEPS.map((step, index) => {
    const span = index === DENT_STEPS.length - 1 ? 10 : 20;
    return Math.min(1, Math.max(0, (effectivePower - step) / span + 0.4));
  });
  // 蜡皮裂纹：力度 ≥60% 浮现并随力度上升；松手/捏爆后按峰值保留（蜡裂不可逆）
  const crackOpacity = bursting
    ? 0.95
    : Math.min(0.95, Math.max(0, (effectivePower - CRACK_MIN_POWER) / 40));
  // 爆浆内馅色：当前玩具（预设或 DIY）的内馅决定；无馅捏爆也爆出米白内瓤（真实脆皮都有白瓤）
  const activeToyFillingId = activeToy?.fillingId ?? "none";
  const activeFilling = diy?.fillings?.find((item) => item.id === activeToyFillingId);
  // 爆浆色：有馅用馅色，无馅用米白内瓤色
  const burstJamColor =
    activeFilling && activeFilling.id !== "none" ? activeFilling.hex : "#fff7ec";
  // 内馅芯：常驻渲染但捏爆前完全透明（蜡皮未破不露馅），捏爆时 0.34s 延迟后从裂口涌出（先见碎裂再见爆浆）
  // 爆裂中 transform 全权交给 CSS 果冻流动动画（squishyFillingJelly 帧内含定位），内联只保留定位；
  // 残体态内联收敛为 1.45 饱满常驻露出（位置偏移与动画结束帧对齐，切换不跳变）
  const fillingCoreTransform = bursting
    ? "translate(-50%, -50%)"
    : `translate(-50%, -50%) scale(${burstShaped ? 1.45 : 1}) translate(${burstShaped ? "5%, -8%" : "0, 0"})`;
  const fillingCoreOpacity = bursting ? 0.94 : burstShaped ? 0.88 : 0;
  const fillingCoreRadius =
    bursting || burstShaped ? "62% 38% 58% 42% / 52% 66% 34% 48%" : "50%";
  // 爆裂中透明度/圆角也交给动画起始帧（0% 帧 opacity 0），内联仅背景色与定位；transition 只服务残体收敛
  const fillingCoreTransition = bursting ? "" : "transition: transform 0.3s ease-out, opacity 0.25s ease-out;";

  // 叠捏堆叠：侧视垂直堆叠成塔（底部对齐、整体居中）；单只尺寸按数量收缩
  const containerW = stackSize?.w ?? 300;
  const containerH = stackSize?.h ?? 240;
  const ballSize = stackBallSize(stackCount);
  const ballWidthPx = (ballSize.widthPct / 100) * containerW;
  const ballHeightPx = ballWidthPx * ballSize.heightRatio;
  const stackList = stackLayout(stackCount, ballHeightPx, containerH);
  const isMultiStack = stackCount > 1;
  // 蜡皮碎片色：白蜡壳崩开的碎片（更高白度，白蜂蜡乳白壳）
  const waxShellColor = mixHexColor(activeToy?.color ?? "#ffe6d8", "#ffffff", 0.8);
  // 捏爆变形圆角（不对称，蜡皮局部塌陷鼓包）：爆裂中偏规则崩裂，残体态更歪扭不对称
  const burstRadius = "52% 48% 55% 45% / 62% 38% 58% 42%";
  const remnantRadius = "64% 40% 58% 44% / 48% 70% 36% 66%";
  // 真实爆浆时序（先碎裂后爆浆）：白闪（0-160ms）→ 冲击波（0-550ms）→ 蜡皮碎片炸出（0-1.05s 主体）
  // → 内馅爆出 + 浆帽 + 浆滴拉丝（0.32s 起）→ 顶部破口翻皮；爆裂元素锚定塔中心（容器中心）
  const burstFlash = bursting;
  const burstWave = bursting;
  const jamSpatterIds = bursting ? [0, 1, 2, 3, 4, 5, 6, 7] : [];
  const peelIds = bursting ? [0, 1] : [];
  // 蜡皮碎片编号（6 大块 + 6 细屑 = 12 块，从球缘炸出；颜色为蜡皮色）
  const fragmentIds = bursting ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [];
  // 蜡皮掉屑编号（3 片向下坠落，重力掉落）
  const waxDropIds = bursting ? [0, 1, 2] : [];
  // 爆浆滴落编号（捏爆时，无馅用米白内瓤）：5 滴挂壁下坠 + 4 滴斜飞迸溅 + 4 滴边缘溢流
  const jamDropIds = bursting ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [];

  // 裂缝渗馅进度（与捏的过程同步）：按压中力度 ≥60% 起从裂缝逐渐渗出；松手后保持本次峰值对应的渗出量
  const seepProgress = pressing
    ? Math.min(1, Math.max(0, (power - CRACK_MIN_POWER) / (100 - CRACK_MIN_POWER)))
    : squeezed && !bursting
      ? seepSettled * 0.85
      : 0;
  // 裂缝渗馅泉眼编号：六处裂缝口各一处馅色（位置与裂线一一对应）
  const oozeIds = [0, 1, 2, 3, 4, 5];
  const oozeVisible = (seepProgress > 0 || bursting || burstShaped) && stackCount <= 6;

  /** 渲染单只捏捏（蜡皮壳 + 主色晕染 + 耳朵 + 凹陷 + 裂纹 + 内馅芯） */
  const renderSquishy = (index: number) => {
    const point = stackList[index] ?? { x: 0, y: 0 };
    const shapeId = activeToy?.shapeId ?? "round";
    const toyColor = activeToy?.color ?? "#ffe6d8";
    const earId = activeToy?.earId ?? "none";
    const isHeart = shapeId === "heart";
    // 蜡皮壳：泛白底色；耳朵/装饰保持主色
    const shellColor = mixHexColor(toyColor, "#ffffff", WAX_MIX_RATIO);
    // 尺寸链路：宽度 %（容器宽）+ 高度 px（侧视椭圆压扁）；单只保持近圆
    const widthStyle = `width: ${ballSize.widthPct}%; height: ${ballHeightPx.toFixed(1)}px;`;
    // 堆叠偏移：首只在文档流中定位，其余绝对定位叠放；偏移按容器 px 换算
    const posPrefix = index === 0 ? "" : "translate(-50%, -50%) ";
    const offsetTranslate =
      point.x === 0 && point.y === 0
        ? ""
        : `translate(${((point.x / 100) * containerW).toFixed(1)}px, ${((point.y / 100) * containerH).toFixed(1)}px) `;
    // 捏爆/爆后残体：不规则变形圆角（蜡皮局部塌陷鼓包）；常态按形状
    const shellRadius =
      bursting
        ? burstRadius
        : burstShaped
          ? remnantRadius
          : isHeart
            ? "0"
            : undefined;
    const radiusStyle = shellRadius ? ` border-radius: ${shellRadius};` : "";
    // 外层容器样式：尺寸 + 形变/堆叠 transform（耳朵/蝴蝶结挂此层，不受球壳裁剪）
    const wrapStyle = `transform: ${posPrefix}${offsetTranslate}${squishScale};`;
    // 球壳样式：底色 + 形状圆角（材质层由壳的 overflow hidden 按椭圆轮廓裁切）
    const shellStyle =
      isHeart && !(bursting || burstShaped)
        ? ""
        : `background-color: ${shellColor};${radiusStyle}`;
    return (
      <View
        key={`squishy-${index}`}
        className={`squishy-ball-wrap${index === 0 ? " is-base" : " is-stacked"}${
          bursting ? " is-bursting" : ""
        }${burstShaped ? " is-remnant" : ""}`}
        style={`${widthStyle}${wrapStyle}`}
        onTouchStart={handlePressStart}
        onTouchEnd={handlePressEnd}
        onTouchCancel={handlePressEnd}
      >
        <View
          className={`squishy-ball squishy-shape-${shapeId}${
            stackCount > 3 ? " is-dense" : ""
          }${bursting ? " is-bursting" : ""}${burstShaped ? " is-remnant" : ""}`}
          style={shellStyle}
        >
        {/* 主色晕染层（蜡皮的彩色晕染） */}
        <View
          className="squishy-tint"
          style={`background-color: ${toyColor};`}
        />
        {/* 白蜡膜层：外层乳白半透蜡壳（大豆蜡+蜂蜡），任何颜色都罩在外面；捏爆/残体态蜡碎减淡（粘土外露） */}
        <View
          className="squishy-wax-film"
          style={`opacity: ${(bursting ? WAX_FILM_OPACITY * 0.45 : burstShaped ? WAX_FILM_OPACITY * 0.3 : WAX_FILM_OPACITY).toFixed(2)}; transition: opacity ${bursting ? "0.3s ease-out 0.25s" : "0.35s ease-out"};`}
        />
        {/* 蜡面粉霜颗粒：大豆蜡冷凝的哑光霜感，与蜡膜同层减淡 */}
        <View
          className="squishy-wax-frost"
          style={`opacity: ${(bursting ? 0.6 * 0.45 : burstShaped ? 0.6 * 0.3 : 0.6).toFixed(2)};`}
        />
        <View className="squishy-highlight" />
        {/* 粘土主凹陷：捏的位置深影内陷 + 下缘受光隆起唇（陶土记忆：松手保留） */}
        <View
          className={`squishy-dent-group${deepBoost > 0.3 ? " is-deep" : ""}`}
          style={`opacity: ${dentGroupOpacity.toFixed(2)}; transform: scale(${dentGroupScale.toFixed(2)});`}
        >
          <View className="squishy-dent-pit" />
          <View className="squishy-dent-edge" />
          <View className="squishy-dent-rim" />
        </View>
        <View
          className="squishy-dent squishy-dent-2"
          style={`opacity: ${stepOpacities[0].toFixed(2)};`}
        />
        <View
          className="squishy-dent squishy-dent-3"
          style={`opacity: ${stepOpacities[1].toFixed(2)};`}
        />
        <View
          className="squishy-dent squishy-dent-4"
          style={`opacity: ${stepOpacities[2].toFixed(2)};`}
        />
        {/* 内馅芯：常驻挂载但捏爆前全透明，捏爆 0.32s 后从裂口涌出；爆裂中带流动脉冲（果冻质感） */}
        <View
          className={`squishy-filling-core${bursting ? " is-flowing" : ""}`}
          style={`background-color: ${burstJamColor}; transform: ${fillingCoreTransform}; opacity: ${fillingCoreOpacity.toFixed(2)}; border-radius: ${fillingCoreRadius}; ${fillingCoreTransition}`}
        />
        {/* 爆后残体主裂口：蜡皮破口常驻（不对称裂口边 + 偏侧塌陷），burstShaped 时渲染 */}
        {burstShaped ? (
          <View className="squishy-remnant-cleft">
            <View className="squishy-remnant-cleft-line squishy-remnant-cleft-line-1" />
            <View className="squishy-remnant-cleft-line squishy-remnant-cleft-line-2" />
            <View className="squishy-remnant-cleft-nick squishy-remnant-cleft-nick-0" />
            <View className="squishy-remnant-cleft-nick squishy-remnant-cleft-nick-1" />
            <View className="squishy-remnant-cleft-nick squishy-remnant-cleft-nick-2" />
            <View className="squishy-remnant-cleft-lip squishy-remnant-cleft-lip-l" />
            <View className="squishy-remnant-cleft-lip squishy-remnant-cleft-lip-r" />
            {/* 粘土/蜡屑残留（裂口周边小碎屑，受力后的随机感：7 片大小错落） */}
            {[0, 1, 2, 3, 4, 5, 6].map((id) => (
              <View
                key={`crumb-${id}`}
                className={`squishy-remnant-crumb squishy-remnant-crumb-${id}`}
                style={`background-color: ${id % 3 === 0 ? waxShellColor : id % 3 === 1 ? burstJamColor : shellColor};`}
              />
            ))}
          </View>
        ) : null}
        {/* 蜡皮裂纹（≥60% 力度浮现，捏爆后常驻；6 条放射裂缝 + 2 条分叉细屑） */}
        <View className="squishy-crack-wrap" style={`opacity: ${crackOpacity.toFixed(2)};`}>
          <View className="squishy-crack squishy-crack-1" />
          <View className="squishy-crack squishy-crack-2" />
          <View className="squishy-crack squishy-crack-3" />
          <View className="squishy-crack squishy-crack-4" />
          <View className="squishy-crack squishy-crack-5" />
          <View className="squishy-crack squishy-crack-6" />
          <View className="squishy-crack squishy-crack-7" />
          <View className="squishy-crack squishy-crack-8" />
        </View>
        {/* 裂缝渗馅/泵浆：六处裂缝口各一处馅色；按压时随力度同步渗出（内联透明度渐变），捏爆时由 is-burst 动画涌出流动 */}
        {oozeVisible ? (
          <View className="squishy-ooze-wrap">
            {oozeIds.map((id) => (
              <View
                key={`ooze-${id}`}
                className={`squishy-ooze squishy-ooze-${id}${bursting ? " is-burst" : ""}`}
                style={`background-color: ${burstJamColor}; opacity: ${(bursting ? 0.92 : seepProgress * 0.8).toFixed(2)}; transform: scale(${(bursting ? 1.05 : 0.3 + seepProgress * 0.5).toFixed(2)});`}
              />
            ))}
          </View>
        ) : null}
      </View>
      {/* 耳朵/头顶装饰（结构件，叠在球壳之上）：挂外层容器不受球壳椭圆轮廓裁剪，超出球体的部分完整显示 */}
      {renderEarParts(earId, toyColor, `ball-${index}`)}
      {/* 爱心由三片结构件组成（其余形状为容器本体）；同样挂外层容器完整显示 */}
      {isHeart && !(bursting || burstShaped) ? renderHeartParts(toyColor, `ball-${index}`) : null}
    </View>
    );
  };

  // DIY 弹层预览数据
  const previewShape = selShape;
  const previewColor = diy?.colors?.find((item) => item.id === selColor)?.hex ?? "#ffb3c1";
  const previewEar = selEar;
  const previewFilling = diy?.fillings?.find((item) => item.id === selFilling);
  const previewFillingVisible = !!previewFilling && previewFilling.id !== "none";

  return (
    <View className="widget-root">
      <View
        className="widget-body widget-adaptive squishy-stage"
        __lynx_timing_flag="__lynx_timing_actual_fmp"
      >
        {loadError ? (
          <View className="squishy-state">
            <Text className="widget-state-message">捏捏乐暂时没有加载出来</Text>
            <View className="squishy-retry" onClick={handleRetry}>
              <Text className="squishy-retry-text">重试</Text>
            </View>
          </View>
        ) : !cardData ? (
          <Text className="widget-state-message">正在准备捏捏乐～</Text>
        ) : (
          <View className="squishy-content">
            <View className="squishy-inner">
              {/* 提示行 + 解压值 */}
              <View className="squishy-topbar">
                <Text className="squishy-hint">{hint}</Text>
                <Text className="squishy-relief">{`解压值 ${relief}`}</Text>
              </View>

              {/* 捏捏主体区 + 右侧叠捏数量 */}
              <View
                className={`squishy-playzone${pressing ? " is-pressing" : ""}${
                  squeezed ? " is-squeezed" : ""
                }`}
              >
                <View className="squishy-shadow" />
                <View className={`squishy-stack${isMultiStack ? " is-multi" : ""}`}>
                  {stackList.map((_, index) => renderSquishy(index))}
                  {/* 爆浆白闪：捏爆瞬间中心高光一闪（最底层） */}
                  {burstFlash ? <View className="squishy-burst-flash" /> : null}
                  {/* 爆浆冲击波：从球心向外扩散的蜡皮震动环 */}
                  {burstWave ? <View className="squishy-burst-wave" /> : null}
                  {/* 自然流浆：捏爆时三团馅料从主裂口涌出成堆、沿球面摊开下淌（替代旧竖直浆柱，无喷射长条） */}
                  {bursting ? (
                    <View className="squishy-flow-wrap">
                      {[0, 1, 2].map((id) => (
                        <View
                          key={`flow-${id}`}
                          className={`squishy-flow squishy-flow-${id}`}
                          style={`background-color: ${burstJamColor};`}
                        />
                      ))}
                    </View>
                  ) : null}
                  {/* 顶部破口翻皮：裂口两片蜡皮翘起（泛白蜡壳色） */}
                  {peelIds.map((id) => (
                    <View
                      key={`peel-${id}`}
                      className={`squishy-peel squishy-peel-${id}`}
                      style={`background-color: ${waxShellColor};`}
                    />
                  ))}
                  {/* 飞溅浆点：8 颗小瓤点向四周迸溅（无馅用米白内瓤） */}
                  {jamSpatterIds.map((id) => (
                    <View
                      key={`spat-${id}`}
                      className={`squishy-spat squishy-spat-${id}`}
                      style={`background-color: ${burstJamColor};`}
                    />
                  ))}
                  {/* 蜡皮爆裂碎片：6 大块 + 6 细屑（从球缘炸出，泛白蜡壳色） */}
                  {fragmentIds.map((id) => (
                    <View
                      key={`frag-${id}`}
                      className={`squishy-fragment squishy-frag-${id}`}
                      style={`background-color: ${waxShellColor};`}
                    />
                  ))}
                  {/* 蜡皮掉屑：3 片碎片向下坠落（重力掉落感） */}
                  {waxDropIds.map((id) => (
                    <View
                      key={`wax-${id}`}
                      className={`squishy-wax-drop squishy-wax-drop-${id}`}
                      style={`background-color: ${waxShellColor};`}
                    />
                  ))}
                  {/* 爆浆滴落：4 滴斜飞迸溅 + 5 滴圆润滴头自然下坠（无馅用米白内瓤，不拉长条） */}
                  {jamDropIds.map((id) => (
                    <View
                      key={`jam-${id}`}
                      className={`squishy-jam squishy-jam-${id}`}
                      style={`background-color: ${burstJamColor};`}
                    />
                  ))}
                </View>
                {/* 力度条（按压中显示当前压力等级） */}
                {pressing && currentLevel ? (
                  <View className="squishy-powerbar">
                    <View className="squishy-powerbar-fill" style={`width: ${power}%;`} />
                    <Text className="squishy-powerbar-label">{`${currentLevel.label} ${Math.round(power)}`}</Text>
                  </View>
                ) : null}
                {feedback ? (
                  <View className="squishy-feedback">
                    <Text className="squishy-feedback-ono">{feedback.level.onomatopoeia}</Text>
                    <Text className="squishy-feedback-text">{`${feedback.level.feedback} +${feedback.gain}`}</Text>
                  </View>
                ) : null}
              </View>

              {/* 叠捏数量控制条：− 数字 +（加减号实时步进，长按连发） */}
              <View className="squishy-stepbar">
                <View
                  className={`squishy-step-btn${stackCount <= stackMin ? " is-disabled" : ""}`}
                  onTouchStart={() => {
                    startStep(-1);
                  }}
                  onTouchEnd={stopStepHold}
                  onTouchCancel={stopStepHold}
                >
                  <Text className="squishy-step-btn-text">−</Text>
                </View>
                <View className={`squishy-stack-input${stackHint ? " is-hint" : ""}`}>
                  <Input
                    className="squishy-stack-input-field"
                    type="number"
                    value={stackInput}
                    maxlength={3}
                    onInput={(e) => {
                      handleStackInput(String(e.detail.value ?? ""));
                    }}
                  />
                  <Text className="squishy-stack-input-label">{stack?.customLabel ?? "数量"}</Text>
                </View>
                <View
                  className={`squishy-step-btn${stackCount >= stackMax ? " is-disabled" : ""}`}
                  onTouchStart={() => {
                    startStep(1);
                  }}
                  onTouchEnd={stopStepHold}
                  onTouchCancel={stopStepHold}
                >
                  <Text className="squishy-step-btn-text">+</Text>
                </View>
              </View>

              {/* 统计行 */}
              <View className="squishy-stats">
                <Text className="squishy-stat">{`已捏 ${pressCount} 次`}</Text>
                <Text className="squishy-stat">{`最高压力等级 ${bestLabel}`}</Text>
              </View>
            </View>

          </View>
        )}
      </View>

      {showFooter ? (
        <View className="widget-footer squishy-footer">
          <View className="squishy-toys">
            {toys.map((toy, index) => (
              <View
                key={toy.id}
                className={`squishy-toy-dot${index === toyIndex && !customToy ? " is-active" : ""}`}
                onClick={() => {
                  handleSwitchToy(index);
                }}
              >
                <View className="squishy-toy-dot-inner" style={`background-color: ${toy.color};`} />
              </View>
            ))}
            {/* 音效开关（DIY 按钮已移至底部主操作行） */}
            <View
              className={`squishy-sound-toggle${soundOn ? " is-on" : ""}`}
              onClick={() => {
                setSoundOn((on) => !on);
              }}
            >
              <Text className="squishy-sound-text">{soundOn ? "音效开" : "音效关"}</Text>
            </View>
          </View>
          {/* 主操作行：DIY 捏捏 + 再捏一次（并排双钮，替代原换新满行） */}
          <View className="squishy-actions">
            {diy ? (
              <View className="squishy-action squishy-action-diy" onClick={handleOpenDiy}>
                <Text className="squishy-action-text">{diy.openLabel}</Text>
              </View>
            ) : null}
            <View
              className={`squishy-action squishy-action-renew${canRenew ? " is-ready" : ""}`}
              onClick={handleRenew}
            >
              <Text className="squishy-action-text">
                {cardData?.views?.initial?.renewLabel ?? "再捏一次"}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
      {/* DIY 拼装形象工坊（覆盖主玩区，Footer 同步隐藏） */}
      {diyOpen && diy ? (
        <View className="squishy-diy-overlay">
          <View className="squishy-diy-panel">
            <View className="squishy-diy-head">
              <Text className="squishy-diy-title">{diy.title}</Text>
              <View className="squishy-diy-preview-wrap">
                <View
                  className={`squishy-diy-preview squishy-shape-${previewShape}`}
                  style={
                    previewShape === "heart"
                      ? "background-color: transparent;"
                      : `background-color: ${mixHexColor(previewColor, "#ffffff", WAX_MIX_RATIO)};`
                  }
                >
                  {/* 蜡皮主色晕染（与真实捏捏外观一致） */}
                  {previewShape !== "heart" ? (
                    <View
                      className="squishy-tint"
                      style={`background-color: ${previewColor};`}
                    />
                  ) : null}
                  {/* 白蜡膜层：外层乳白半透蜡壳（DIY 预览与实捏一致） */}
                  {previewShape !== "heart" ? (
                    <View
                      className="squishy-wax-film"
                      style={`opacity: ${WAX_FILM_OPACITY.toFixed(2)};`}
                    />
                  ) : null}
                  {/* 蜡面粉霜颗粒：与实捏一致的哑光霜感 */}
                  {previewShape !== "heart" ? (
                    <View className="squishy-wax-frost" style="opacity: 0.6;" />
                  ) : null}
                  {renderEarParts(previewEar, previewColor, "preview")}
                  {previewShape === "heart"
                    ? renderHeartParts(previewColor, "preview")
                    : null}
                  {previewFillingVisible ? (
                    <View
                      className="squishy-filling-core"
                      style={`background-color: ${previewFilling?.hex}; transform: translate(-50%, -50%); opacity: 0.55;`}
                    />
                  ) : null}
                </View>
              </View>
              {/* 实时拼装预览（标题行右侧小球，随配置实时更新） */}
              <View className="squishy-diy-close" onClick={handleCloseDiy}>
                <Text className="squishy-diy-close-text">收起</Text>
              </View>
            </View>
              {/* 配置行区 */}
              <View className="squishy-diy-rows">
                {/* 形象预设行 */}
                <View className="squishy-diy-row">
                  <View className="squishy-diy-options">
                    <Text className="squishy-diy-row-label">{diy.presetLabel}</Text>
                    {diy.presets.map((preset) => (
                      <View
                        key={`preset-${preset.id}`}
                        className={`squishy-diy-option squishy-diy-preset${
                          selPreset === preset.id ? " is-active" : ""
                        }`}
                        onClick={() => {
                          handleSelectPreset(preset.id);
                        }}
                      >
                        <View
                          className="squishy-diy-preset-dot"
                          style={`background-color: ${preset.color};`}
                        />
                        <Text className="squishy-diy-option-text">{preset.name}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                {/* 身体行 */}
                <View className="squishy-diy-row">
                  <View className="squishy-diy-options">
                    <Text className="squishy-diy-row-label">{diy.shapeLabel}</Text>
                    {diy.shapes.map((shape) => (
                      <View
                        key={`shape-${shape.id}`}
                        className={`squishy-diy-option${
                          selShape === shape.id ? " is-active" : ""
                        }`}
                        onClick={() => {
                          setSelShape(shape.id);
                          setSelPreset("");
                        }}
                      >
                        {shape.id === "heart" ? (
                          <View className="squishy-diy-shape squishy-shape-heart">
                            <View className="squishy-heart-core" />
                            <View className="squishy-heart-lobe squishy-heart-lobe-left" />
                            <View className="squishy-heart-lobe squishy-heart-lobe-right" />
                          </View>
                        ) : (
                          <View className={`squishy-diy-shape squishy-shape-${shape.id}`} />
                        )}
                        <Text className="squishy-diy-option-text">{shape.name}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                {/* 耳朵行 */}
                <View className="squishy-diy-row">
                  <View className="squishy-diy-options">
                    <Text className="squishy-diy-row-label">{diy.earLabel}</Text>
                    {diy.ears.map((ear) => (
                      <View
                        key={`ear-${ear.id}`}
                        className={`squishy-diy-option${
                          selEar === ear.id ? " is-active" : ""
                        }`}
                        onClick={() => {
                          setSelEar(ear.id);
                          setSelPreset("");
                        }}
                      >
                        <View className={`squishy-diy-ear-icon squishy-ear-icon-${ear.id}`} />
                        <Text className="squishy-diy-option-text">{ear.name}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                {/* 配色行 */}
                <View className="squishy-diy-row">
                  <View className="squishy-diy-options">
                    <Text className="squishy-diy-row-label">{diy.colorLabel}</Text>
                    {diy.colors.map((color) => (
                      <View
                        key={`color-${color.id}`}
                        className={`squishy-diy-color${
                          selColor === color.id ? " is-active" : ""
                        }`}
                        onClick={() => {
                          setSelColor(color.id);
                          setSelPreset("");
                        }}
                      >
                        <View
                          className="squishy-diy-color-dot"
                          style={`background-color: ${color.hex};`}
                        />
                      </View>
                    ))}
                  </View>
                </View>
                {/* 内馅行 */}
                <View className="squishy-diy-row">
                  <View className="squishy-diy-options">
                    <Text className="squishy-diy-row-label">{diy.fillingLabel}</Text>
                    {diy.fillings.map((filling) => (
                      <View
                        key={`filling-${filling.id}`}
                        className={`squishy-diy-option squishy-diy-filling${
                          selFilling === filling.id ? " is-active" : ""
                        }`}
                        onClick={() => {
                          setSelFilling(filling.id);
                          setSelPreset("");
                        }}
                      >
                        <View
                          className="squishy-diy-filling-dot"
                          style={
                            filling.id === "none"
                              ? "background-color: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.4);"
                              : `background-color: ${filling.hex};`
                          }
                        />
                        <Text className="squishy-diy-option-text">{filling.name}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            {/* 确认按钮 */}
            <View className="squishy-diy-confirm" onClick={handleConfirmDiy}>
              <Text className="squishy-diy-confirm-text">{diy.confirmLabel}</Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
