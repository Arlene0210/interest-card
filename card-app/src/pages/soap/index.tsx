/**
 * 解压小游戏：切香皂。
 * 点击「切一刀」削掉一层（色块变薄 + 掉屑），6 刀切完给出切面评分并可换新。
 */
import { View, Text } from '@tarojs/components'
import { useCallback, useState } from 'react'
import { CustomNavSpace } from '@/components/custom-nav-space'

/** 需要切的刀数 */
const SLICES = 6

/** 香皂配色（随机主题色系） */
const COLORS = [
  { name: '薄荷牛奶', body: '#bfe9d8', edge: '#a5d8c4' },
  { name: '奶油桃桃', body: '#ffd9c9', edge: '#f3bda7' },
  { name: '海盐柠檬', body: '#f7eeb5', edge: '#e4d68f' },
]

export default function SoapPage() {
  const [colorIndex, setColorIndex] = useState(0)
  const [cuts, setCuts] = useState(0)
  const [score, setScore] = useState<number | null>(null)

  const color = COLORS[colorIndex]

  const handleCut = useCallback(() => {
    if (cuts >= SLICES) return
    const next = cuts + 1
    setCuts(next)
    if (next >= SLICES) {
      // 切完：根据剩余厚度给一个轻松向的切面评分
      setScore(80 + Math.floor(Math.random() * 16))
    }
  }, [cuts])

  const handleNew = useCallback(() => {
    setColorIndex((prev) => (prev + 1 + Math.floor(Math.random() * (COLORS.length - 1))) % COLORS.length)
    setCuts(0)
    setScore(null)
  }, [])

  // 剩余厚度（百分比）
  const remaining = Math.max(8, Math.round((1 - cuts / SLICES) * 100))
  const done = cuts >= SLICES

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
            <View className="flex h-44 flex-col items-center justify-end rounded-2xl bg-white px-6 pb-6 pt-4">
              <View
                className="w-full rounded-xl"
                style={{
                  height: `${Math.max(12, remaining * 0.9)}%`,
                  backgroundColor: color.body,
                  border: `2px solid ${color.edge}`,
                }}
              />
              <Text className="mt-3 block text-xs text-[#9a94bd]">
                {`剩余 ${remaining}%`}
              </Text>
            </View>

            {/* 碎屑展示 */}
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
                done ? 'bg-[#c9c4e6]' : 'bg-[#6c63c9] active:bg-[#5a52b5]'
              }`}
              onClick={done ? undefined : handleCut}
            >
              <Text className="text-base font-medium text-white">
                {done ? '切完了' : '切一刀'}
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
