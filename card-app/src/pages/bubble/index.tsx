/**
 * 解压小游戏：捏泡泡纸。
 * 点击捏爆泡泡（凹陷 + 换色），全部捏完显示完成态并可重置。
 */
import { View, Text } from '@tarojs/components'
import { useMemo, useState } from 'react'
import { CustomNavSpace } from '@/components/custom-nav-space'

const ROWS = 8
const COLS = 6
const TOTAL = ROWS * COLS

export default function BubblePage() {
  // 已捏爆的泡泡索引集合
  const [popped, setPopped] = useState<Set<number>>(() => new Set())
  const [lastPop, setLastPop] = useState<number | null>(null)

  const cells = useMemo(() => Array.from({ length: TOTAL }, (_, i) => i), [])

  const handlePop = (index: number) => {
    setPopped((prev) => {
      if (prev.has(index)) return prev
      const next = new Set(prev)
      next.add(index)
      return next
    })
    setLastPop(index)
  }

  const handleReset = () => {
    setPopped(new Set())
    setLastPop(null)
  }

  const done = popped.size >= TOTAL

  return (
    <View className="min-h-screen bg-[#eef7f2] text-[#16181f]">
      <CustomNavSpace />
      <View className="px-4 pb-10 pt-2">
        <Text className="block text-xs tracking-widest text-[#7fa890]">BUBBLE WRAP</Text>
        <Text className="mt-1 block text-xl font-semibold leading-7">捏泡泡纸</Text>
        <Text className="mt-1 block text-sm leading-5 text-[#5f7a68]">
          {`已捏 ${popped.size} / ${TOTAL} 颗`}
        </Text>

        {done ? (
          <View className="mt-6 rounded-2xl bg-white px-5 py-8 text-center">
            <Text className="block text-4xl leading-12">🎉</Text>
            <Text className="mt-2 block text-base font-semibold leading-6">
              本片泡泡全部捏爆！
            </Text>
            <Text className="mt-1 block text-sm leading-5 text-[#5f7a68]">
              解压度 100%，要不要再来一片？
            </Text>
            <View
              className="mx-auto mt-5 flex w-40 items-center justify-center rounded-full bg-[#3fae7a] py-3"
              onClick={handleReset}
            >
              <Text className="text-base font-medium text-white">再来一片</Text>
            </View>
          </View>
        ) : (
          <View className="mt-4 rounded-2xl bg-white p-3">
            <View className="flex flex-row flex-wrap justify-between">
              {cells.map((index) => {
                const isPopped = popped.has(index)
                return (
                  <View
                    key={index}
                    className={`mb-[6px] flex h-[46px] w-[46px] items-center justify-center rounded-full ${
                      isPopped ? 'bg-[#dce9e1]' : 'bg-[#cfe8dc] active:bg-[#b8ddcb]'
                    }`}
                    onClick={() => {
                      handlePop(index)
                    }}
                  >
                    <View
                      className={`h-4 w-4 rounded-full ${
                        isPopped ? 'bg-[#eef4ee]' : 'bg-white/70'
                      }`}
                    />
                  </View>
                )
              })}
            </View>
          </View>
        )}

        {lastPop !== null && !done ? (
          <Text className="mt-3 block text-center text-sm text-[#7fa890]">啵～</Text>
        ) : null}
      </View>
    </View>
  )
}
