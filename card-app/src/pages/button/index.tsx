/**
 * 解压小游戏：疯狂解压按钮。
 * 连点充能，满格触发爆发彩带，随后自动清零可再充。
 */
import { View, Text } from '@tarojs/components'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CustomNavSpace } from '@/components/custom-nav-space'

/** 每次点击充能值 */
const STEP = 6
/** 充能满格值 */
const FULL = 100
/** 爆发展示时长（ms） */
const BURST_MS = 1800
/** 彩带 emoji */
const CONFETTI = ['🎉', '✨', '🎊', '⭐️', '💫', '🌟']

export default function ButtonPage() {
  const [power, setPower] = useState(0)
  const [burst, setBurst] = useState(false)
  const [totalPress, setTotalPress] = useState(0)
  const burstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (burstTimerRef.current) clearTimeout(burstTimerRef.current)
    }
  }, [])

  const handlePress = useCallback(() => {
    if (burst) return
    setTotalPress((n) => n + 1)
    setPower((prev) => {
      const next = prev + STEP
      if (next >= FULL) {
        setBurst(true)
        if (burstTimerRef.current) clearTimeout(burstTimerRef.current)
        burstTimerRef.current = setTimeout(() => {
          burstTimerRef.current = null
          setBurst(false)
          setPower(0)
        }, BURST_MS)
        return FULL
      }
      return next
    })
  }, [burst])

  const levelText =
    power >= FULL ? '解压能量爆发！' : power >= 60 ? '快满了，继续按！' : power > 0 ? '充能中…' : '按住屏幕，开始发泄'

  return (
    <View className="min-h-screen bg-[#fff4ec] text-[#16181f]">
      <CustomNavSpace />
      <View className="px-4 pb-10 pt-2">
        <Text className="block text-xs tracking-widest text-[#c98a6b]">MASH BUTTON</Text>
        <Text className="mt-1 block text-xl font-semibold leading-7">疯狂解压按钮</Text>
        <Text className="mt-1 block text-sm leading-5 text-[#8a6d58]">
          {`累计按压 ${totalPress} 次 · 能量 ${Math.min(power, FULL)}%`}
        </Text>

        <View className="mt-6 flex items-center justify-center">
          <View
            className={`relative flex h-48 w-48 items-center justify-center rounded-full ${
              burst ? 'bg-[#ff5f8f]' : 'bg-[#ff8fab] active:bg-[#ff7a9c]'
            }`}
            onClick={handlePress}
          >
            <Text className="text-lg font-semibold leading-6 text-white">
              {burst ? '💥' : '按我！'}
            </Text>
            {burst ? (
              <View className="pointer-events-none absolute inset-0">
                {CONFETTI.map((item, index) => (
                  <Text
                    key={`${item}-${index}`}
                    className="absolute text-2xl leading-8"
                    style={{
                      left: `${8 + index * 15}%`,
                      top: `${(index % 3) * 30 + 6}%`,
                    }}
                  >
                    {item}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        </View>

        <View className="mx-auto mt-6 h-4 w-4/5 overflow-hidden rounded-full bg-white">
          <View
            className="h-full rounded-full bg-gradient-to-r from-[#ffd36e] to-[#ff5f8f]"
            style={{ width: `${Math.min(power, FULL)}%` }}
          />
        </View>

        <Text className="mt-3 block text-center text-sm text-[#a97c62]">{levelText}</Text>

        {burst ? (
          <Text className="mt-2 block text-center text-base font-semibold text-[#ff6b93]">
            解压能量已满格爆发，爽到了吗！
          </Text>
        ) : null}
      </View>
    </View>
  )
}
