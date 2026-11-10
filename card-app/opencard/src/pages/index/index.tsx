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
  const [feedback, setFeedback] = useState<SqueezeLevel | null>(null); // 松手反馈
  const [pressCount, setPressCount] = useState(0); // 本次捏捏次数
  const [bestLabel, setBestLabel] = useState<string>("—"); // 最高力度档
  const [soundOn, setSoundOn] = useState(true);

  // 长生命周期逻辑状态（ref 镜像）
  const powerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundOnRef = useRef(true);
  const reliefRef = useRef(0);
  const pressCountRef = useRef(0);
  const bestRankRef = useRef(-1);
  const taroApiRef = useRef<openCardTaro | null>(null);
  const reportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReportRef = useRef(0);
  const lastReportAtRef = useRef(0);
  const currentToyRef = useRef<SquishyToy | null>(null);

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  // 卸载时清理全部计时器
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (powerTimerRef.current) clearInterval(powerTimerRef.current);
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
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
  const currentToy = toys[toyIndex];
  const currentLevel = matchLevel(power, levels);

  // 同步当前玩具到 ref（供定时器回调读取）
  useEffect(() => {
    currentToyRef.current = currentToy ?? null;
  }, [currentToy]);

  /** 播放捏压音效 + 触觉反馈（力度档位决定音效节奏与震动强度） */
  const playSqueezeFeedback = useCallback((level: SqueezeLevel | null) => {
    const taro = taroApiRef.current;
    if (!taro || !soundOnRef.current) return;
    try {
      const audio = taro.createInnerAudioContext();
      audio.src = "https://lf-aihub.douyinvod.com/obj/developer/card_7706443532244896531_ext/c9d6699ae1a4.mp3";
      // 轻捏原速 / 用力捏 1.25 倍速 / 捏爆 1.5 倍速，音调随力度升高
      audio.playbackRate = level && level.min >= 70 ? 1.5 : level && level.min >= 35 ? 1.25 : 1.0;
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
    // 轻震动反馈（当前运行环境仅支持 vibrateShort，统一用轻震动）
    try {
      taro.vibrateShort?.();
    } catch (error) {
      console.error("[squishy] vibrate failed", error);
    }
  }, []);

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
    (level: SqueezeLevel) => {
      pendingReportRef.current += level.relief;
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

  /** 开始按压 */
  const handlePressStart = useCallback(() => {
    if (!cardData || pressing) return;
    setPressing(true);
    setSqueezed(false);
    setFeedback(null);
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    // 力度随按住时长增长
    if (powerTimerRef.current) clearInterval(powerTimerRef.current);
    powerTimerRef.current = setInterval(() => {
      const softness = currentToyRef.current?.softness ?? 0.6;
      const step = POWER_STEP * (0.7 + softness * 0.6);
      setPower((prev) => {
        const next = Math.min(100, prev + step);
        if (next >= 100 && powerTimerRef.current) {
          clearInterval(powerTimerRef.current);
          powerTimerRef.current = null;
        }
        return next;
      });
    }, POWER_TICK_MS);
  }, [cardData, pressing]);

  /** 结束按压：保持形变不回弹 + 即时反馈 */
  const handlePressEnd = useCallback(() => {
    if (!cardData || !pressing) return;
    if (powerTimerRef.current) {
      clearInterval(powerTimerRef.current);
      powerTimerRef.current = null;
    }
    setPressing(false);
    setSqueezed(true); // 不回弹：形状保持凹陷
    setPower(0);

    const level = matchLevel(power, levels);
    if (level) {
      setFeedback(level);
      playSqueezeFeedback(level);
      // 更新累计与最佳档位
      reliefRef.current += level.relief;
      pressCountRef.current += 1;
      setRelief(reliefRef.current);
      setPressCount(pressCountRef.current);
      const rank = levels.findIndex((item) => item.label === level.label);
      if (rank > bestRankRef.current) {
        bestRankRef.current = rank;
        setBestLabel(level.label);
      }
      reportSqueeze(level);
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
  }, [cardData, pressing, power, levels, playSqueezeFeedback, reportSqueeze]);

  /** 切换玩具 */
  const handleSwitchToy = useCallback(
    (index: number) => {
      if (index === toyIndex) return;
      if (powerTimerRef.current) {
        clearInterval(powerTimerRef.current);
        powerTimerRef.current = null;
      }
      setToyIndex(index);
      setPower(0);
      setPressing(false);
      setSqueezed(false);
      setFeedback(null);
    },
    [toyIndex],
  );

  /** 换新一个捏捏（当前玩具回弹到全新状态） */
  const handleRenew = useCallback(() => {
    if (powerTimerRef.current) {
      clearInterval(powerTimerRef.current);
      powerTimerRef.current = null;
    }
    setSqueezed(false);
    setPower(0);
    setFeedback(null);
  }, []);

  /** 重新拉取卡片数据 */
  const handleRetry = useCallback(() => {
    setLoadError(false);
    bootstrappedRef.current = false;
    tryBootstrapCardData();
  }, [tryBootstrapCardData]);

  const hint = cardData?.views?.initial?.hint ?? "长按捏瘪它 · 按得越久捏得越瘪";
  const canRenew = squeezed;

  // 形变几何值（JS 计算，动态内联）：按住时随力度压扁；松手后保持凹陷
  const squishScaleX = pressing ? 1 + 0.14 * (power / 100) : squeezed ? 1.06 : 1;
  const squishScaleY = pressing ? 1 - 0.3 * (power / 100) : squeezed ? 0.78 : 1;
  const squishTransform = `scaleX(${squishScaleX.toFixed(3)}) scaleY(${squishScaleY.toFixed(3)})`;
  // 捏痕透明度（JS 计算）
  const dentOpacity = pressing ? 0.25 + 0.75 * (power / 100) : squeezed ? 0.9 : 0;

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
          <View className="squishy-inner">
            {/* 提示行 + 解压值 */}
            <View className="squishy-topbar">
              <Text className="squishy-hint">{hint}</Text>
              <Text className="squishy-relief">{`解压值 ${relief}`}</Text>
            </View>

            {/* 捏捏主体区 */}
            <View
              className={`squishy-playzone${pressing ? " is-pressing" : ""}${
                squeezed ? " is-squeezed" : ""
              }`}
            >
              <View className="squishy-shadow" />
              <View
                className="squishy-ball"
                style={`background-color: ${currentToy?.color ?? "#ffe6d8"}; transform: ${squishTransform};`}
                onTouchStart={handlePressStart}
                onTouchEnd={handlePressEnd}
                onTouchCancel={handlePressEnd}
              >
                <View className="squishy-highlight" />
                <View className="squishy-dent" style={`opacity: ${dentOpacity.toFixed(2)};`} />
                <View
                  className="squishy-dent squishy-dent-2"
                  style={`opacity: ${dentOpacity.toFixed(2)};`}
                />
              </View>
              {pressing && currentLevel ? (
                <View className="squishy-powerbar">
                  <View className="squishy-powerbar-fill" style={`width: ${power}%;`} />
                  <Text className="squishy-powerbar-label">{`${currentLevel.label} ${Math.round(power)}`}</Text>
                </View>
              ) : null}
              {feedback ? (
                <View className="squishy-feedback">
                  <Text className="squishy-feedback-ono">{feedback.onomatopoeia}</Text>
                  <Text className="squishy-feedback-text">{`${feedback.feedback} +${feedback.relief}`}</Text>
                </View>
              ) : null}
            </View>

            {/* 统计行 */}
            <View className="squishy-stats">
              <Text className="squishy-stat">{`已捏 ${pressCount} 次`}</Text>
              <Text className="squishy-stat">{`最高力度 ${bestLabel}`}</Text>
            </View>
          </View>
        )}
      </View>

      {cardData ? (
        <View className="widget-footer squishy-footer">
          <View className="squishy-toys">
            {toys.map((toy, index) => (
              <View
                key={toy.id}
                className={`squishy-toy-dot${index === toyIndex ? " is-active" : ""}`}
                onClick={() => {
                  handleSwitchToy(index);
                }}
              >
                <View className="squishy-toy-dot-inner" style={`background-color: ${toy.color};`} />
              </View>
            ))}
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
              {currentToy ? `换新的${currentToy.name}` : "换一个捏捏"}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
