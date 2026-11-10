import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Input } from "@tarojs/components";
import { useLoad, useCardTaro } from "@tarojs/taro";
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
/** 解压值上报节流间隔（ms） */
const REPORT_THROTTLE_MS = 1200;
/** 叠捏连播音效基础间隔（ms，数量越大越密） */
const STACK_SOUND_GAP_MS = 55;
/** 爆裂动画总时长（ms）：碎片飞溅 0.85s + 浆液挂壁拉丝 1.3s */
const BURST_MS = 1400;
/** 数量输入上限 */
const STACK_MAX = 100;
/** 音效连播抽样上限（超过该数量按比例抽样播放） */
const SOUND_SAMPLE_MAX = 12;
/** 裂纹浮现的最低力度（%） */
const CRACK_MIN_POWER = 60;
/** 三处凹陷依次出现的力度阈值（%） */
const DENT_STEPS = [30, 60, 90];
/** 数量越界提示时长（ms） */
const STACK_HINT_MS = 800;

/** 松手反馈对象 */
interface PressFeedback {
  level: SqueezeLevel;
  gain: number;
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
 * 蜂窝密堆布局（JS 计算，返回容器坐标百分比 -50% ~ +50%）：按数量决定列数与行列偏移。
 * 1 只居中大号；2-3 只品字对开；4-7 两列蜂窝；8-19 三列蜂窝；20-49 四列；50+ 五列密堆。
 * 调用方将百分比换算为容器 px 偏移（百分比偏移相对球体自身尺寸，大数量时会挤成一团）。
 */
function stackLayout(count: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  if (count <= 1) {
    return [{ x: 0, y: 0 }];
  }
  let cols = 1;
  if (count <= 3) cols = count;
  else if (count <= 7) cols = 2;
  else if (count <= 19) cols = 3;
  else if (count <= 49) cols = 4;
  else cols = 5;
  // 行列蜂窝：偶数行错开半格，形成紧密堆叠的「捏捏山」
  const rows = Math.ceil(count / cols);
  const stepX = 100 / cols;
  const stepY = 100 / rows;
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const rowOffset = row % 2 === 1 ? stepX * 0.5 : 0;
    const colLimit = Math.min(cols, count - row * cols);
    let x = (col + (rowOffset > 0 ? 0.5 : 0)) * stepX;
    if (colLimit < cols && rowOffset > 0) {
      x = (col + 0.5 + (cols - colLimit) * 0.5) * stepX;
    }
    points.push({ x: x - 50, y: (row + 0.5) * stepY - 50 });
  }
  return points;
}

/** 单只捏捏宽度占比（%）：数量越多单只越小，形成大→小的视觉密度 */
function stackBallWidth(count: number): number {
  if (count <= 1) return 40;
  if (count <= 3) return 30;
  if (count <= 7) return 24;
  if (count <= 19) return 18;
  if (count <= 49) return 14;
  return 11;
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
  const [bestLabel, setBestLabel] = useState<string>("—"); // 最高力度档
  const [soundOn, setSoundOn] = useState(true);

  // v3 状态
  const [diyOpen, setDiyOpen] = useState(false); // DIY 弹层
  const [stackCount, setStackCount] = useState(1); // 叠捏数量 1-100
  const [stackInput, setStackInput] = useState("1"); // 自定义数量输入框文本
  const [stackHint, setStackHint] = useState(false); // 数量越界提示
  const [bursting, setBursting] = useState(false); // 爆裂动画中
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
  const currentToyRef = useRef<SquishyToy | null>(null);
  const powerRef = useRef(0);
  const pressingRef = useRef(false);
  const stackCountRef = useRef(1);
  const stackHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 堆叠容器实测尺寸（px）：百分比布局点换算 px 偏移用（百分比偏移相对球体自身，大数量会挤成一团）
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
  const quickOptions = stack?.quickOptions ?? [];
  const stackMin = stack?.min ?? 1;
  const stackMax = stack?.max ?? STACK_MAX;
  // 当前生效捏捏：DIY 捏捏优先，否则为预设玩具
  const activeToy = customToy ?? toys[toyIndex];
  const currentLevel = matchLevel(power, levels);

  // 同步当前玩具到 ref（供定时器/松手回调读取）
  useEffect(() => {
    currentToyRef.current = activeToy ?? null;
  }, [activeToy]);

  /** 播放一次捏压音效（可指定播放速率） */
  const playSqueezeOnce = useCallback((rate: number) => {
    const taro = taroApiRef.current;
    if (!taro) return;
    try {
      const audio = taro.createInnerAudioContext();
      audio.src = "https://lf-aihub.douyinvod.com/obj/developer/card_7706443532244896531_ext/c9d6699ae1a4.mp3";
      audio.playbackRate = rate;
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
  }, []);

  /**
   * 播放捏压音效 + 触觉反馈（真实脆皮节奏）。
   * 档位决定节奏：轻捏 1 声、用力捏 2 连、捏爆「先脆后闷」双段（间隔约 70ms）。
   * 叠捏按只数密集连播（间隔 40-90ms、速率缓升封顶 2.2），超过抽样上限按比例抽样。
   */
  const playSqueezeFeedback = useCallback(
    (level: SqueezeLevel | null) => {
      if (!soundOnRef.current) return;
      const baseRate = level && level.min >= 70 ? 1.7 : level && level.min >= 35 ? 1.35 : 1.05;
      const playsPerToy = level && level.min >= 35 ? 2 : 1;
      const burstGapMs = 70; // 捏爆「外壳碎裂 + 爆浆扑哧」双段间隔
      const count = stackCountRef.current;
      // 抽样：大数量时只播满 SOUND_SAMPLE_MAX 只的密集节奏，避免 100 只音频风暴
      const playedCount = Math.min(count, SOUND_SAMPLE_MAX);
      // 数量越大间隔越密（90ms → 40ms），对齐视频里「捏一盘」的密集沙沙声
      const gap = Math.max(40, STACK_SOUND_GAP_MS - Math.min(50, playedCount * 4));
      soundTimersRef.current.forEach((timer) => clearTimeout(timer));
      soundTimersRef.current = [];
      for (let i = 0; i < playedCount; i += 1) {
        const rate = Math.min(2.2, baseRate * (1 + i * 0.08));
        for (let seg = 0; seg < playsPerToy; seg += 1) {
          const segRate = seg === 0 ? rate : Math.max(1, rate * 0.55); // 第二段更闷（爆浆扑哧）
          const at = i * gap + seg * burstGapMs;
          if (at <= 0) {
            playSqueezeOnce(segRate);
          } else {
            const timer = setTimeout(() => {
              playSqueezeOnce(segRate);
            }, at);
            soundTimersRef.current.push(timer);
          }
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
    [playSqueezeOnce],
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
      const now = Date.now();
      if (now - lastReportAtRef.current < REPORT_THROTTLE_MS) {
        if (!reportTimerRef.current) {
          reportTimerRef.current = setTimeout(() => {
            reportTimerRef.current = null;
            flushReport(level.label, stackCountRef.current);
          }, REPORT_THROTTLE_MS);
        }
        return;
      }
      flushReport(level.label, count);
    },
    [flushReport],
  );

  /** 清理爆裂计时器并复位爆裂态 */
  const cancelBurst = useCallback(() => {
    if (burstTimerRef.current) {
      clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
    }
    setBursting(false);
  }, []);

  /** 开始按压 */
  const handlePressStart = useCallback(() => {
    if (!cardData || pressingRef.current) return;
    cancelBurst();
    setPressing(true);
    setSqueezed(false);
    setFeedback(null);
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    // 力度随按住时长增长
    if (powerTimerRef.current) clearInterval(powerTimerRef.current);
    const advancePower = () => {
      const softness = currentToyRef.current?.softness ?? 0.6;
      const step = POWER_STEP * (0.7 + softness * 0.6);
      const next = Math.min(100, powerRef.current + step);
      powerRef.current = next; // ref 与 state 同帧推进，松手回调读取最终力度
      setPower(next);
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
    setSqueezed(true); // 不回弹：形状保持凹陷
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
      // 捏爆档触发外壳崩裂 + 屑屑狂掉 + 爆浆拉丝
      if (level.min >= 70) {
        setBursting(true);
        if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
        burstTimerRef.current = setTimeout(() => {
          burstTimerRef.current = null;
          if (mountedRef.current) {
            setBursting(false);
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

  /** 应用叠捏数量（钳制 1-100，越界高亮提示；回显钳制后数值） */
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
      setStackCount(next);
      setStackInput(String(next));
    },
    [stackMin, stackMax],
  );

  /** 自定义数量输入（Input 文本变化） */
  const handleStackInput = useCallback(
    (value: string) => {
      const parsed = parseInt(value, 10);
      if (!Number.isFinite(parsed) || value.trim() === "") {
        // 非数字/清空：不钳制，仅回显原始文本（快捷档点击会重置）
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

  /** 切换玩具 */
  const handleSwitchToy = useCallback(
    (index: number) => {
      if (index === toyIndex && !customToy) return;
      if (powerTimerRef.current) {
        clearInterval(powerTimerRef.current);
        powerTimerRef.current = null;
      }
      cancelBurst();
      setCustomToy(null); // 回到预设玩具
      setToyIndex(index);
      setPower(0);
      powerRef.current = 0;
      setPressing(false);
      setSqueezed(false);
      setFeedback(null);
    },
    [toyIndex, customToy, cancelBurst],
  );

  /** 换新一个捏捏（当前玩具回弹到全新状态） */
  const handleRenew = useCallback(() => {
    if (powerTimerRef.current) {
      clearInterval(powerTimerRef.current);
      powerTimerRef.current = null;
    }
    cancelBurst();
    setSqueezed(false);
    setPower(0);
    powerRef.current = 0;
    setFeedback(null);
  }, [cancelBurst]);

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
    cancelBurst();
    setPower(0);
    powerRef.current = 0;
    setPressing(false);
    setSqueezed(false);
    setFeedback(null);
  }, [diy, selShape, selColor, selEar, selFilling, selPreset, cancelBurst]);

  /** 重新拉取卡片数据 */
  const handleRetry = useCallback(() => {
    setLoadError(false);
    bootstrappedRef.current = false;
    tryBootstrapCardData();
  }, [tryBootstrapCardData]);

  const hint = cardData?.views?.initial?.hint ?? "长按捏瘪它 · 按得越久捏得越瘪";
  const canRenew = squeezed;
  // DIY 弹层开启时 Footer 不渲染（避免与弹层重叠交互）
  const showFooter = !!cardData && !diyOpen;

  // 形变几何值（JS 计算，动态内联）：按住时随力度压扁；松手后保持凹陷；爆裂时塌陷外扩压扁
  const squishScaleX = bursting ? 1.42 : pressing ? 1 + 0.14 * (power / 100) : squeezed ? 1.06 : 1;
  const squishScaleY = bursting ? 0.3 : pressing ? 1 - 0.3 * (power / 100) : squeezed ? 0.78 : 1;
  const squishScale = `scaleX(${squishScaleX.toFixed(3)}) scaleY(${squishScaleY.toFixed(3)})`;
  // 基础捏痕透明度：按压中随力度加深；松手后保持
  const dentOpacity = pressing ? Math.min(0.9, 0.25 + 0.75 * (power / 100)) : squeezed ? 0.9 : 0;
  // 三处凹陷点随力度依次显现
  const stepOpacities = DENT_STEPS.map((step, index) => {
    if (squeezed && !pressing) return 1;
    if (!pressing) return 0;
    const span = index === DENT_STEPS.length - 1 ? 10 : 20;
    return Math.min(1, Math.max(0, (power - step) / span + 0.4));
  });
  // 裂纹透明度：力度 ≥60% 浮现并随力度上升；捏爆后常驻（真实爆浆：6 条放射裂缝）
  const crackOpacity = bursting
    ? 0.95
    : pressing
      ? Math.min(0.85, Math.max(0, (power - CRACK_MIN_POWER) / 50))
      : squeezed
        ? 0.6
        : 0;
  // 爆浆内馅色：当前玩具（预设或 DIY）的内馅决定；无馅捏爆也爆出米白内瓤（真实脆皮都有白瓤）
  const activeToyFillingId = activeToy?.fillingId ?? "none";
  const activeFilling = diy?.fillings?.find((item) => item.id === activeToyFillingId);
  // 爆浆色：有馅用馅色，无馅用米白内瓤色
  const burstJamColor =
    activeFilling && activeFilling.id !== "none" ? activeFilling.hex : "#fff7ec";
  // 内馅芯可见：DIY 捏捏有馅时常驻展示；预设玩具与无馅捏捏在爆裂时展示内瓤
  const fillingVisible = !!activeFilling && activeFilling.id !== "none";
  const fillingCoreTransform = `translate(-50%, -50%) scale(${bursting ? 1.8 : 1})`;
  const fillingCoreOpacity = bursting ? 0.95 : pressing ? 0.72 : squeezed ? 0.8 : 0.55;

  // 叠捏堆叠：蜂窝密堆布局 + 数量反比尺寸；百分比点换算容器 px 偏移（相对容器而非球体自身）
  const stackList = stackLayout(stackCount);
  const ballWidthPct = stackBallWidth(stackCount);
  const isMultiStack = stackCount > 1;
  // 真实爆浆冲击序：白闪（0-220ms）→ 冲击波扩散环（0-550ms）→ 碎片从边缘炸出（6 大块 + 6 细屑）
  // → 浆帽喷涌 + 浆滴挂壁拉丝（0-1.3s，无馅用米白内瓤色）→ 浆点四溅（0-0.6s）→ 顶部破口翻皮
  const burstFlash = bursting;
  const burstWave = bursting;
  const burstCap = bursting;
  // 飞溅浆点编号：8 颗小瓤点向四周迸溅
  const jamSpatterIds = bursting ? [0, 1, 2, 3, 4, 5, 6, 7] : [];
  // 破口翻皮编号：顶部裂口左右两片翘皮
  const peelIds = bursting ? [0, 1] : [];
  // 爆裂碎片编号（真实脆皮：6 大块 + 6 细屑 = 12 块，从球缘炸出）
  const fragmentIds = bursting ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [];
  // 爆浆滴落编号（捏爆时，无馅用米白内瓤）：5 滴挂壁下坠 + 4 滴斜飞迸溅 + 4 滴边缘溢流
  const jamDropIds = bursting ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [];

  /** 渲染单只捏捏（身体 + 耳朵 + 凹陷 + 裂纹 + 内馅） */
  const renderSquishy = (index: number) => {
    const point = stackList[index] ?? { x: 0, y: 0 };
    const shapeId = activeToy?.shapeId ?? "round";
    const toyColor = activeToy?.color ?? "#ffe6d8";
    const earId = activeToy?.earId ?? "none";
    const isHeart = shapeId === "heart";
    // 堆叠球宽度必须显式给值（Lynx 无 auto 收缩）：统一百分比宽度
    const widthStyle = `width: ${ballWidthPct}%;`;
    // 首只在文档流中定位，其余绝对定位叠放
    const posPrefix = index === 0 ? "" : "translate(-50%, -50%) ";
    // 容器 px 偏移：百分比布局点 × 实测容器尺寸（未量得前用 300px 兜底，量得后自动展开）
    const containerW = stackSize?.w ?? 300;
    const containerH = stackSize?.h ?? 240;
    const offsetTranslate =
      point.x === 0 && point.y === 0
        ? ""
        : `translate(${((point.x / 100) * containerW).toFixed(1)}px, ${((point.y / 100) * containerH).toFixed(1)}px) `;
    const ballStyle = isHeart
      ? `transform: ${posPrefix}${offsetTranslate}${squishScale};`
      : `background-color: ${toyColor}; transform: ${posPrefix}${offsetTranslate}${squishScale};`;
    return (
      <View
        key={`squishy-${index}`}
        className={`squishy-ball squishy-shape-${shapeId}${index === 0 ? " is-base" : " is-stacked"}${
          stackCount > 3 ? " is-dense" : ""
        }`}
        style={`${widthStyle}${ballStyle}`}
        onTouchStart={handlePressStart}
        onTouchEnd={handlePressEnd}
        onTouchCancel={handlePressEnd}
      >
        {/* 耳朵/头顶装饰（结构件，叠在身体上方） */}
        {renderEarParts(earId, toyColor, `ball-${index}`)}
        {/* 爱心由三片结构件组成（其余形状为容器本体） */}
        {isHeart ? renderHeartParts(toyColor, `ball-${index}`) : null}
        <View className="squishy-highlight" />
        <View className="squishy-dent" style={`opacity: ${dentOpacity.toFixed(2)};`} />
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
        {/* 爆浆内馅芯（有馅时） */}
        {fillingVisible ? (
          <View
            className="squishy-filling-core"
            style={`background-color: ${burstJamColor}; transform: ${fillingCoreTransform}; opacity: ${fillingCoreOpacity.toFixed(2)};`}
          />
        ) : null}
        {/* 脆皮裂纹（≥60% 力度浮现，捏爆后常驻；6 条放射裂缝） */}
        <View className="squishy-crack-wrap" style={`opacity: ${crackOpacity.toFixed(2)};`}>
          <View className="squishy-crack squishy-crack-1" />
          <View className="squishy-crack squishy-crack-2" />
          <View className="squishy-crack squishy-crack-3" />
          <View className="squishy-crack squishy-crack-4" />
          <View className="squishy-crack squishy-crack-5" />
          <View className="squishy-crack squishy-crack-6" />
        </View>
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
                  {/* 爆浆冲击波：从球心向外扩散的脆皮震动环 */}
                  {burstWave ? <View className="squishy-burst-wave" /> : null}
                  {/* 有馅时浆帽：爆浆中心喷涌鼓包（盖在球上，无馅用米白内瓤） */}
                  {burstCap ? (
                    <View
                      className="squishy-burst-cap"
                      style={`background-color: ${burstJamColor};`}
                    />
                  ) : null}
                  {/* 顶部破口翻皮：裂口两片脆皮翘起（颜色随玩具主体） */}
                  {peelIds.map((id) => (
                    <View
                      key={`peel-${id}`}
                      className={`squishy-peel squishy-peel-${id}`}
                      style={`background-color: ${activeToy?.color ?? "#ffe6d8"};`}
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
                  {/* 脆皮爆裂碎片：6 大块 + 6 细屑（从球缘炸出，颜色由 TSX 内联提供） */}
                  {fragmentIds.map((id) => (
                    <View
                      key={`frag-${id}`}
                      className={`squishy-fragment squishy-frag-${id}`}
                      style={`background-color: ${activeToy?.color ?? "#ffe6d8"};`}
                    />
                  ))}
                  {/* 爆浆滴落：4 滴斜飞迸溅 + 5 滴挂壁下坠拉丝（无馅用米白内瓤） */}
                  {jamDropIds.map((id) => (
                    <View
                      key={`jam-${id}`}
                      className={`squishy-jam squishy-jam-${id}`}
                      style={`background-color: ${burstJamColor};`}
                    />
                  ))}
                </View>
                {/* 右侧叠捏数量：快捷档 + 自定义输入 */}
                <View className="squishy-stack-picker">
                  {quickOptions.map((option) => (
                    <View
                      key={`stack-${option.count}`}
                      className={`squishy-stack-btn${
                        stackCount === option.count ? " is-active" : ""
                      }`}
                      onClick={() => {
                        if (!pressingRef.current) {
                          applyStackCount(option.count);
                        }
                      }}
                    >
                      <Text className="squishy-stack-btn-text">{option.label}</Text>
                    </View>
                  ))}
                  <View className={`squishy-stack-input${stackHint ? " is-hint" : ""}`}>
                    <Text className="squishy-stack-input-label">{stack?.customLabel ?? "自定义"}</Text>
                    <Input
                      className="squishy-stack-input-field"
                      type="number"
                      value={stackInput}
                      maxlength={3}
                      onInput={(e) => {
                        handleStackInput(String(e.detail.value ?? ""));
                      }}
                    />
                  </View>
                </View>
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

              {/* 统计行 */}
              <View className="squishy-stats">
                <Text className="squishy-stat">{`已捏 ${pressCount} 次`}</Text>
                <Text className="squishy-stat">{`最高力度 ${bestLabel}`}</Text>
              </View>
            </View>

            {/* DIY 拼装形象工坊（覆盖主玩区，Footer 同步隐藏） */}
            {diyOpen && diy ? (
              <View className="squishy-diy-overlay">
                <View className="squishy-diy-panel">
                  <View className="squishy-diy-head">
                    <Text className="squishy-diy-title">{diy.title}</Text>
                    <View className="squishy-diy-close" onClick={handleCloseDiy}>
                      <Text className="squishy-diy-close-text">收起</Text>
                    </View>
                  </View>
                  <View className="squishy-diy-main">
                    {/* 实时拼装预览 */}
                    <View className="squishy-diy-preview-wrap">
                      <View
                        className={`squishy-diy-preview squishy-shape-${previewShape}`}
                        style={
                          previewShape === "heart"
                            ? "background-color: transparent;"
                            : `background-color: ${previewColor};`
                        }
                      >
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
                    {/* 配置行区 */}
                    <View className="squishy-diy-rows">
                      {/* 形象预设行 */}
                      <View className="squishy-diy-row">
                        <Text className="squishy-diy-row-label">{diy.presetLabel}</Text>
                        <View className="squishy-diy-options">
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
                        <Text className="squishy-diy-row-label">{diy.shapeLabel}</Text>
                        <View className="squishy-diy-options">
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
                        <Text className="squishy-diy-row-label">{diy.earLabel}</Text>
                        <View className="squishy-diy-options">
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
                        <Text className="squishy-diy-row-label">{diy.colorLabel}</Text>
                        <View className="squishy-diy-options">
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
                        <Text className="squishy-diy-row-label">{diy.fillingLabel}</Text>
                        <View className="squishy-diy-options">
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
                  </View>
                  {/* 确认按钮 */}
                  <View className="squishy-diy-confirm" onClick={handleConfirmDiy}>
                    <Text className="squishy-diy-confirm-text">{diy.confirmLabel}</Text>
                  </View>
                </View>
              </View>
            ) : null}
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
            {/* DIY 打开按钮 */}
            {diy ? (
              <View
                className={`squishy-diy-open${customToy ? " is-active" : ""}`}
                onClick={handleOpenDiy}
              >
                <Text className="squishy-diy-open-text">{diy.openLabel}</Text>
              </View>
            ) : null}
            <View
              className={`squishy-sound-toggle${soundOn ? " is-on" : ""}`}
              onClick={() => {
                setSoundOn((on) => !on);
              }}
            >
              <Text className="squishy-sound-text">{soundOn ? "音效开" : "音效关"}</Text>
            </View>
          </View>
          <View
            className={`squishy-renew${canRenew ? " is-ready" : ""}`}
            onClick={canRenew ? handleRenew : undefined}
          >
            <Text className="squishy-renew-text">
              {activeToy ? `换新的${activeToy.name}` : "换一个捏捏"}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
