/**
 * 解压小游戏：切香皂。
 * 点击「切一刀」：小刀从左向右扫过香皂顶面，切面闪光、切屑崩落、皂片掉上台面，
 * 6 刀切完给出切面评分并可换新。
 */
import Taro from '@tarojs/taro'
import { View, Text } from '@tarojs/components'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CustomNavSpace } from '@/components/custom-nav-space'
import './soap.css'

/** 需要切的刀数 */
const SLICES = 6

/** 香皂配色（随机主题色系） */
const COLORS = [
  { name: '薄荷牛奶', body: '#bfe9d8', edge: '#a5d8c4' },
  { name: '奶油桃桃', body: '#ffd9c9', edge: '#f3bda7' },
  { name: '海盐柠檬', body: '#f7eeb5', edge: '#e4d68f' },
]

/** 真实切皂音效（离散颗粒崩解脉冲合成；主版为主、备用版随机点缀，轻微变速避免重复感） */
const SFX_CUT_MAIN = 'https://lf-aihub.douyinvod.com/obj/developer/card_7706443532244896531_ext/bbeed5a8068d.mp3'
const SFX_CUT_ALT = 'https://lf-aihub.douyinvod.com/obj/developer/card_7706443532244896531_ext/f2c1cb45fb10.mp3'

/** 正在崩落的切屑 */
type Shaving = {
  id: number
  left: number
  bottomPct: number
  color: string
  delay: number
  dir: 'l' | 'c' | 'r'
  size: 's' | 'm' | 'lg'
}

/** 已落在台面上的皂片 */
type SlicePiece = { id: number; left: number; rot: number; color: string; edge: string }

let shavingSeq = 0
let sliceSeq = 0

export default function SoapPage() {
  const [colorIndex, setColorIndex] = useState(0)
  const [cuts, setCuts] = useState(0)
  const [score, setScore] = useState<number | null>(null)
  const [cutting, setCutting] = useState(false)
  const [shavings, setShavings] = useState<Shaving[]>([])
  const [slices, setSlices] = useState<SlicePiece[]>([])

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const color = COLORS[colorIndex]
  const done = cuts >= SLICES

  // 剩余厚度（百分比）与香皂顶面（切割线）在台面容器中的位置
  const remaining = Math.max(8, Math.round((1 - cuts / SLICES) * 100))
  const soapH = Math.max(12, Math.round(remaining * 0.9))
  const cutLine = 9 + soapH

  // 卸载时清理动画定时器
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach(clearTimeout)
    }
  }, [])

  const schedule = useCallback((fn: () => void, ms: number) => {
    const timer = setTimeout(fn, ms)
    timersRef.current.push(timer)
  }, [])

  /** 播放一次真实切皂音效（两版随机 + 轻微变速，播完即销毁实例） */
  const playCutSfx = useCallback(() => {
    try {
      const audio = Taro.createInnerAudioContext()
      audio.src = Math.random() < 0.75 ? SFX_CUT_MAIN : SFX_CUT_ALT
      audio.volume = 0.9
      const audioWithRate = audio as Taro.InnerAudioContext & { playbackRate?: number }
      audioWithRate.playbackRate = 0.94 + Math.random() * 0.14
      let destroyed = false
      const destroyAudio = () => {
        if (destroyed) return
        destroyed = true
        try {
          audio.destroy()
        } catch (destroyError) {
          console.error('[soap] destroy cut sfx failed', destroyError)
        }
      }
      audio.onError((error) => {
        console.error('[soap] cut sfx failed', error)
        destroyAudio()
      })
      audio.onEnded(() => destroyAudio())
      audio.play()
      // 兜底释放：若事件未触发，2.5s 后回收
      schedule(destroyAudio, 2500)
    } catch (error) {
      console.error('[soap] create cut sfx failed', error)
    }
  }, [schedule])

  /** 生成一崩切屑（从当前切面崩落，随刀锋错峰出现，落定后自行移除） */
  const spawnShavings = useCallback(
    (topPct: number) => {
      const theme = COLORS[colorIndex]
      const batch: Shaving[] = []
      for (let i = 0; i < 7; i++) {
        const dirRoll = Math.random()
        batch.push({
          id: shavingSeq++,
          left: 8 + Math.random() * 84,
          bottomPct: topPct,
          color: i % 3 === 2 ? '#ffffff' : i % 2 === 0 ? theme.body : theme.edge,
          delay: Math.round(Math.random() * 120),
          dir: dirRoll < 0.35 ? 'l' : dirRoll > 0.65 ? 'r' : 'c',
          size: Math.random() < 0.3 ? 's' : Math.random() < 0.78 ? 'm' : 'lg',
        })
      }
      setShavings((prev) => [...prev, ...batch])
      batch.forEach((shaving) => {
        schedule(() => {
          setShavings((prev) => prev.filter((item) => item.id !== shaving.id))
        }, 1850 + shaving.delay)
      })
    },
    [colorIndex, schedule],
  )

  const handleCut = useCallback(() => {
    if (cutting || done) return
    setCutting(true)
    const topPct = 9 + Math.max(12, Math.round((1 - cuts / SLICES) * 100 * 0.9))

    // 刀锋切入：音效 + 切面高光 + 切屑崩落
    schedule(() => {
      playCutSfx()
      spawnShavings(topPct)
    }, 280)

    // 切下的皂片坠落到台面留存
    schedule(() => {
      setSlices((prev) => [
        ...prev,
        {
          id: sliceSeq++,
          left: 16 + prev.length * 10 + Math.random() * 8,
          rot: Math.round(Math.random() * 22 - 11),
          color: color.body,
          edge: color.edge,
        },
      ])
    }, 450)

    // 刀扫过、香皂变薄；切完等切屑落定后再出评分
    schedule(() => {
      const nextCuts = cuts + 1
      setCuts(nextCuts)
      setCutting(false)
      if (nextCuts >= SLICES) {
        schedule(() => setScore(80 + Math.floor(Math.random() * 16)), 1000)
      }
    }, 620)
  }, [cutting, done, cuts, color, playCutSfx, spawnShavings, schedule])

  const handleNew = useCallback(() => {
    setColorIndex((prev) => (prev + 1 + Math.floor(Math.random() * (COLORS.length - 1))) % COLORS.length)
    setCuts(0)
    setScore(null)
    setShavings([])
    setSlices([])
    setCutting(false)
  }, [])

  return (
    <View className="min-h-screen bg-[#f4f2fb] text-[#16181f]">
      <CustomNavSpace />
      <View className="px-4 pb-10 pt-2">
        <Text className="block text-xs tracking-widest text-[#8b84b8]">SOAP CUTTING</Text>
        <Text className="mt-1 block text-xl font-semibold leading-7">切香皂</Text>
        <Text className="mt-1 block text-sm leading-5 text-[#6e6a8e]">
          {`当前口味：${color.name} · 已切 ${cuts} / ${SLICES} 刀`}
        </Text>

        {done && score !== null ? (
          <View className="mt-6 rounded-2xl bg-white px-5 py-8 text-center">
            <Text className="block text-4xl leading-12">🧼✨</Text>
            <Text className="mt-2 block text-base font-semibold leading-6">切面太治愈了！</Text>
            <Text className="mt-1 block text-sm leading-5 text-[#6e6a8e]">
              {`${color.name}切面光洁度 ${score} 分`}
            </Text>
            <View
              className="mx-auto mt-5 flex w-40 items-center justify-center rounded-full bg-[#6c63c9] py-3"
              onClick={handleNew}
            >
              <Text className="text-base font-medium text-white">换一块新的</Text>
            </View>
          </View>
        ) : (
          <View className="mt-6">
            {/* 香皂台 */}
            <View className="relative h-44 overflow-hidden rounded-2xl bg-white">
              {/* 台面 */}
              <View className="absolute inset-x-0 bottom-0" style={{ height: '14%', backgroundColor: '#f1eefb' }} />
              {/* 台面上的皂片 */}
              {slices.map((piece) => (
                <View key={piece.id} className="soap-slice-slot" style={{ left: `${piece.left}%` }}>
                  <View style={{ transform: `rotate(${piece.rot}deg)` }}>
                    <View className="soap-slice" style={{ backgroundColor: piece.color, borderColor: piece.edge }} />
                  </View>
                </View>
              ))}
              {/* 香皂本体 */}
              <View
                className="absolute inset-x-6 rounded-xl"
                style={{
                  bottom: '9%',
                  height: `${soapH}%`,
                  backgroundColor: color.body,
                  border: `2px solid ${color.edge}`,
                }}
              />
              {/* 切割瞬间切面高光 */}
              {cutting ? <View className="soap-cut-flash" style={{ bottom: `${cutLine}%` }} /> : null}
              {/* 崩落的切屑 */}
              {shavings.map((shaving) => (
                <View
                  key={shaving.id}
                  className={`soap-shaving soap-shaving--${shaving.dir} soap-shaving--${shaving.size}`}
                  style={{
                    left: `${shaving.left}%`,
                    bottom: `${shaving.bottomPct}%`,
                    backgroundColor: shaving.color,
                    animationDelay: `${shaving.delay}ms`,
                  }}
                />
              ))}
              {/* 小刀：从左向右扫过切面 */}
              {cutting ? (
                <View className="soap-knife" style={{ bottom: `${cutLine}%` }}>
                  <View className="soap-knife-handle" />
                  <View className="soap-knife-blade" />
                </View>
              ) : null}
            </View>

            <Text className="mt-3 block text-center text-xs text-[#9a94bd]">
              {`剩余 ${remaining}%`}
            </Text>

            {/* 碎屑展示（切割进度） */}
            <View className="mt-3 flex items-center justify-center gap-1.5">
              {Array.from({ length: SLICES }, (_, i) => (
                <View
                  key={i}
                  className={`h-2.5 w-2.5 rounded-full ${
                    i < cuts ? 'bg-[#8b84b8]' : 'bg-[#ded9ef]'
                  }`}
                />
              ))}
            </View>

            <View
              className={`mx-auto mt-5 flex w-44 items-center justify-center rounded-full py-3 ${
                cutting || done ? 'bg-[#c9c4e6]' : 'bg-[#6c63c9] active:bg-[#5a52b5]'
              }`}
              onClick={cutting || done ? undefined : handleCut}
            >
              <Text className="text-base font-medium text-white">
                {cutting ? '咔嚓…' : done ? '切面生成中…' : '切一刀'}
              </Text>
            </View>
            <Text className="mt-2 block text-center text-sm text-[#8b84b8]">
              {done ? '看看你的切面评分' : '咔嚓～屑屑掉下来了'}
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}
