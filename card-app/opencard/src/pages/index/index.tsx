import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text } from "@tarojs/components";
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
/** 叠捏连播音效间隔（ms） */
const STACK_SOUND_GAP_MS = 90;
/** 爆裂碎片动画清理时长（ms） */
const BURST_MS = 900;
/** 叠捏堆叠错位步长（px） */
const STACK_OFFSET_PX = 34;
/** 裂纹浮现的最低力度（%） */
const CRACK_MIN_POWER = 60;
/** 三处凹陷依次出现的力度阈值（%） */
const DENT_STEPS = [30, 60, 90];
/** 层数色环基础透明度（由外向内） */
const RING_OPACITIES = [0.72, 0.48, 0.3];

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

/** 叠捏堆叠偏移（JS 几何计算，逐只错位） */
function stackOffset(index: number, total: number): { x: number; y: number } {
  if (total <= 1) return { x: 0, y: 0 };
  const spread = total === 2 ? 1 : 0.9;
  const mid = (total - 1) / 2;
  return {
    x: (index - mid) * STACK_OFFSET_PX * spread,
    y: Math.abs(index - mid) * STACK_OFFSET_PX * 0.35,
  };
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

  // 脆皮爽感迭代状态
  const [diyOpen, setDiyOpen] = useState(false); // DIY 弹层
  const [stackCount, setStackCount] = useState(1); // 叠捏数量 1-3
  const [bursting, setBursting] = useState(false); // 爆裂动画中
  const [selShape, setSelShape] = useState<string>("round"); // DIY 选中形状
  const [selColor, setSelColor] = useState<string>("peach"); // DIY 选中颜色
  const [selFilling, setSelFilling] = useState<string>("strawberry"); // DIY 选内馅
  const [selLayers, setSelLayers] = useState(1); // DIY 选层数
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
  const layerMultiplierRef = useRef(1);

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
  });

  const toys = cardData?.views?.initial?.toys ?? [];
  const levels = cardData?.views?.initial?.levels ?? [];
  const diy = cardData?.views?.initial?.diy;
  const stackOptions = cardData?.views?.initial?.stackOptions ?? [];
  // 当前生效捏捏：DIY 捏捏优先，否则为预设玩具
  const activeToy = customToy ?? toys[toyIndex];
  const currentLevel = matchLevel(power, levels);
  // 当前生效层数：仅 DIY 捏捏携带层数配置
  const activeToyLayers = customToy ? selLayers : 1;

  // 同步当前玩具与层数倍率到 ref（供定时器/松手回调读取）
  useEffect(() => {
    currentToyRef.current = activeToy ?? null;
  }, [activeToy]);

  useEffect(() => {
    const option = diy?.layers?.find((layer) => layer.count === selLayers);
    layerMultiplierRef.current = customToy && option ? option.multiplier : 1;
  }, [diy, selLayers, customToy]);

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

  /** 播放捏压音效 + 触觉反馈（档位决定速率；叠捏时逐只连播更脆更密） */
  const playSqueezeFeedback = useCallback(
    (level: SqueezeLevel | null) => {
      if (!soundOnRef.current) return;
      const baseRate = level && level.min >= 70 ? 1.5 : level && level.min >= 35 ? 1.25 : 1.0;
      const count = stackCountRef.current;
      soundTimersRef.current.forEach((timer) => clearTimeout(timer));
      soundTimersRef.current = [];
      if (count <= 1) {
        playSqueezeOnce(baseRate);
      } else {
        // 逐只连播：间隔约 90ms、播放速率逐只递增，叠越多越脆越密
        for (let i = 0; i < count; i += 1) {
          const rate = Math.min(2, baseRate * (1 + i * 0.12));
          if (i === 0) {
            playSqueezeOnce(rate);
          } else {
            const timer = setTimeout(() => {
              playSqueezeOnce(rate);
            }, i * STACK_SOUND_GAP_MS);
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
  const flushReport = useCallback((levelLabel: string) => {
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
        count: 1,
      },
    } as never).catch((error: unknown) => {
      console.error("[squishy] report failed", error);
    });
  }, []);

  /** 上报一次捏压记录（节流合并，超窗自动补报） */
  const reportSqueeze = useCallback(
    (level: SqueezeLevel, gain: number) => {
      pendingReportRef.current += gain;
      const now = Date.now();
      if (now - lastReportAtRef.current < REPORT_THROTTLE_MS) {
        if (!reportTimerRef.current) {
          reportTimerRef.current = setTimeout(() => {
            reportTimerRef.current = null;
            flushReport(level.label);
          }, REPORT_THROTTLE_MS);
        }
        return;
      }
      flushReport(level.label);
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

  /** 结束按压：保持形变不回弹 + 即时反馈 + 捏爆触发爆裂爆浆 */
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
      // 层数倍率 × 叠捏数量放大本次解压值
      const gain = Math.round(level.relief * layerMultiplierRef.current * stackCountRef.current);
      setFeedback({ level, gain });
      playSqueezeFeedback(level);
      reliefRef.current += gain;
      pressCountRef.current += 1;
      setRelief(reliefRef.current);
      setPressCount(pressCountRef.current);
      const rank = levels.findIndex((item) => item.label === level.label);
      if (rank > bestRankRef.current) {
        bestRankRef.current = rank;
        setBestLabel(level.label);
      }
      // 捏爆档触发脆皮爆裂 + 爆浆动画
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
      reportSqueeze(level, gain);
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

  /** 打开 DIY 弹层（以当前捏捏初始化形状/颜色） */
  const handleOpenDiy = useCallback(() => {
    if (!diy) return;
    if (!customToy) {
      const toy = toys[toyIndex];
      if (toy) {
        setSelShape(toy.shapeId);
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

  /** 确认 DIY：应用为当前捏捏 */
  const handleConfirmDiy = useCallback(() => {
    if (!diy) return;
    const shape = diy.shapes.find((item) => item.id === selShape) ?? diy.shapes[0];
    const color = diy.colors.find((item) => item.id === selColor) ?? diy.colors[0];
    const filling = diy.fillings.find((item) => item.id === selFilling);
    const toy: SquishyToy = {
      id: "toy-custom",
      name: diy.customName,
      color: color.hex,
      shapeId: shape.id,
      desc: filling && filling.id !== "none" ? `${filling.name}·${selLayers}层` : `${selLayers}层加厚`,
      softness: Math.min(1, 0.55 + selLayers * 0.15),
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
  }, [diy, selShape, selColor, selFilling, selLayers, cancelBurst]);

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

  // 形变几何值（JS 计算，动态内联）：按住时随力度压扁；松手后保持凹陷；爆裂时更塌
  const squishScaleX = bursting ? 1.22 : pressing ? 1 + 0.14 * (power / 100) : squeezed ? 1.06 : 1;
  const squishScaleY = bursting ? 0.42 : pressing ? 1 - 0.3 * (power / 100) : squeezed ? 0.78 : 1;
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
  // 裂纹透明度：力度 ≥60% 浮现并随力度上升；捏爆后常驻
  const crackOpacity = bursting
    ? 0.95
    : pressing
      ? Math.min(0.85, Math.max(0, (power - CRACK_MIN_POWER) / 50))
      : squeezed
        ? 0.6
        : 0;
  // 爆浆内馅芯
  const activeFilling = diy?.fillings?.find((item) => item.id === selFilling);
  const fillingVisible = !!customToy && !!activeFilling && activeFilling.id !== "none";
  const fillingCoreTransform = `translate(-50%, -50%) scale(${bursting ? 1.6 : 1})`;
  const fillingCoreOpacity = bursting ? 0.95 : pressing ? 0.72 : squeezed ? 0.8 : 0.55;
  // 层数色环（层数 - 1 个，由外向内）
  const layerRingOpacities = activeToyLayers >= 2 ? RING_OPACITIES.slice(0, activeToyLayers - 1) : [];

  // 叠捏堆叠：渲染 stackCount 个捏捏（同配置同色，错位堆叠）
  const stackList = Array.from({ length: stackCount }, (_, index) => index);
  const frontIndex = Math.floor((stackCount - 1) / 2);
  // 爆裂碎片编号（捏爆瞬时动画）
  const fragmentIds = bursting ? [0, 1, 2, 3, 4, 5] : [];
  // 爆浆滴落编号（有馅捏爆时）：3 下坠 + 2 左右飞溅
  const jamDropIds = bursting && fillingVisible ? [0, 1, 2, 3, 4] : [];

  /** 渲染单只捏捏（形状 + 凹陷 + 裂纹 + 内馅 + 层环） */
  const renderSquishy = (index: number) => {
    const offset = stackOffset(index, stackCount);
    const shapeId = activeToy?.shapeId ?? "round";
    const toyColor = activeToy?.color ?? "#ffe6d8";
    const isHeart = shapeId === "heart";
    // 首只在文档流中定位，其余绝对定位叠放
    const posPrefix = index === 0 ? "" : "translate(-50%, -50%) ";
    const offsetTranslate =
      offset.x === 0 && offset.y === 0
        ? ""
        : `translate(${offset.x.toFixed(1)}px, ${offset.y.toFixed(1)}px) `;
    const ballStyle = isHeart
      ? `transform: ${posPrefix}${offsetTranslate}${squishScale};`
      : `background-color: ${toyColor}; transform: ${posPrefix}${offsetTranslate}${squishScale};`;
    return (
      <View
        key={`squishy-${index}`}
        className={`squishy-ball squishy-shape-${shapeId}${index === frontIndex ? " is-front" : ""}${
          index === 0 ? "" : " is-stacked"
        }`}
        style={ballStyle}
        onTouchStart={handlePressStart}
        onTouchEnd={handlePressEnd}
        onTouchCancel={handlePressEnd}
      >
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
        {/* 层数嵌套色环（≥2 层） */}
        {layerRingOpacities.map((ringOpacity, ringIndex) => (
          <View
            key={`ring-${index}-${ringIndex}`}
            className={`squishy-layer-ring${ringIndex === 1 ? " squishy-layer-ring-2" : ""}${
              ringIndex === 2 ? " squishy-layer-ring-3" : ""
            }`}
            style={`opacity: ${ringOpacity.toFixed(2)};`}
          />
        ))}
        {/* 爆浆内馅芯（有馅时） */}
        {fillingVisible ? (
          <View
            className="squishy-filling-core"
            style={`background-color: ${activeFilling?.hex ?? "#ff6b81"}; transform: ${fillingCoreTransform}; opacity: ${fillingCoreOpacity.toFixed(2)};`}
          />
        ) : null}
        {/* 脆皮裂纹（≥60% 力度浮现，捏爆后常驻） */}
        <View className="squishy-crack-wrap" style={`opacity: ${crackOpacity.toFixed(2)};`}>
          <View className="squishy-crack squishy-crack-1" />
          <View className="squishy-crack squishy-crack-2" />
          <View className="squishy-crack squishy-crack-3" />
        </View>
      </View>
    );
  };

  // DIY 弹层预览数据
  const previewShape = selShape;
  const previewColor = diy?.colors?.find((item) => item.id === selColor)?.hex ?? "#ffd3d8";
  const previewFilling = diy?.fillings?.find((item) => item.id === selFilling);
  const previewFillingVisible = !!previewFilling && previewFilling.id !== "none";
  const previewRingOpacities =
    selLayers >= 2 ? RING_OPACITIES.slice(0, selLayers - 1) : [];

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

              {/* 捏捏主体区 + 右侧叠捏数量按钮 */}
              <View
                className={`squishy-playzone${pressing ? " is-pressing" : ""}${
                  squeezed ? " is-squeezed" : ""
                }`}
              >
                <View className="squishy-shadow" />
                <View className={`squishy-stack${stackCount > 1 ? " is-multi" : ""}`}>
                  {stackList.map((index) => renderSquishy(index))}
                  {/* 脆皮爆裂碎片（捏爆瞬时动画） */}
                  {fragmentIds.map((id) => (
                    <View
                      key={`frag-${id}`}
                      className={`squishy-fragment squishy-frag-${id}`}
                      style={`background-color: ${activeToy?.color ?? "#ffe6d8"};`}
                    />
                  ))}
                  {/* 爆浆滴落（有馅捏爆时） */}
                  {jamDropIds.map((id) => (
                    <View
                      key={`jam-${id}`}
                      className={`squishy-jam squishy-jam-${id}`}
                      style={`background-color: ${activeFilling?.hex ?? "#ff6b81"};`}
                    />
                  ))}
                </View>
                {/* 右侧叠捏数量按钮 */}
                <View className="squishy-stack-picker">
                  {stackOptions.map((option) => (
                    <View
                      key={`stack-${option.count}`}
                      className={`squishy-stack-btn${
                        stackCount === option.count ? " is-active" : ""
                      }`}
                      onClick={() => {
                        if (!pressingRef.current) {
                          setStackCount(option.count);
                        }
                      }}
                    >
                      <Text className="squishy-stack-btn-text">{option.label}</Text>
                    </View>
                  ))}
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

            {/* DIY 制作弹层（覆盖主玩区，Footer 同步隐藏） */}
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
                    {/* 实时预览 */}
                    <View className="squishy-diy-preview-wrap">
                      <View
                        className={`squishy-diy-preview squishy-shape-${previewShape}`}
                        style={
                          previewShape === "heart"
                            ? "background-color: transparent;"
                            : `background-color: ${previewColor};`
                        }
                      >
                        {previewShape === "heart"
                          ? renderHeartParts(previewColor, "preview")
                          : null}
                        {previewFillingVisible ? (
                          <View
                            className="squishy-filling-core"
                            style={`background-color: ${previewFilling?.hex}; transform: translate(-50%, -50%); opacity: 0.55;`}
                          />
                        ) : null}
                        {previewRingOpacities.map((ringOpacity, ringIndex) => (
                          <View
                            key={`preview-ring-${ringIndex}`}
                            className={`squishy-layer-ring${
                              ringIndex === 1 ? " squishy-layer-ring-2" : ""
                            }${ringIndex === 2 ? " squishy-layer-ring-3" : ""}`}
                            style={`opacity: ${ringOpacity.toFixed(2)};`}
                          />
                        ))}
                      </View>
                    </View>
                    {/* 配置行 */}
                    <View className="squishy-diy-rows">
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
                      <View className="squishy-diy-row">
                        <Text className="squishy-diy-row-label">{diy.layerLabel}</Text>
                        <View className="squishy-diy-options">
                          {diy.layers.map((layer) => (
                            <View
                              key={`layer-${layer.count}`}
                              className={`squishy-diy-option squishy-diy-layer${
                                selLayers === layer.count ? " is-active" : ""
                              }`}
                              onClick={() => {
                                setSelLayers(layer.count);
                              }}
                            >
                              <Text className="squishy-diy-layer-count">{layer.label}</Text>
                              <Text className="squishy-diy-option-text">{`解压×${layer.multiplier}`}</Text>
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
