/**
 * 兴趣卡落地页首页：解压报告 + 解压小游戏馆。
 * 样式使用 TailwindCSS；数据来自服务端接口（useDidShow 刷新，承接卡片捏压记录）。
 */
import { View, Text, Image } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useCallback, useState } from 'react'
import { CustomNavSpace } from '@/components/custom-nav-space'
import { Network } from '@/network'
import emptyImage from '@/assets/empty.png'

/** 解压报告（服务端口径） */
interface SquishyStats {
  totalRelief: number
  pressCount: number
  bestLevel: string
  lastPlayedAt: number
}

/** 小游戏条目 */
interface GameEntry {
  emoji: string
  name: string
  desc: string
  path: string
}

/** 压力等级画像：按最高力度档位给出俏皮解释 + 解压建议（用语俏皮有趣） */
const LEVEL_PROFILES: Record<string, { emoji: string; tag: string; explain: string; advice: string }> = {
  轻捏: {
    emoji: '🫧',
    tag: '指尖SPA级',
    explain: '温柔一捏，蜻蜓点水～你的手指刚做完一场迷你马杀鸡，情绪毫无波动甚至想哼歌。',
    advice: '下次试试按住不放，攒到力度条满格，体验一把「砰」的快意！',
  },
  用力捏: {
    emoji: '💪',
    tag: '高压释放级',
    explain: '深呼吸、咬紧牙、狠狠一攥——压力顺着指尖 biu 地飞出去了，蜡皮都替你捏出了裂纹。',
    advice: '离「捏爆」只差临门一脚，长按再坚持一秒，把烦恼连壳捏碎！',
  },
  捏爆: {
    emoji: '💥',
    tag: '彻底爆浆级',
    explain: '砰——！内馅四溅、蜡皮崩飞，你的压力也跟着原地蒸发，这波解压非常彻底。',
    advice: '火力全开的同时也记得心疼下捏捏，换只新的或 DIY 一只新造型，快乐可持续～',
  },
}

/** 查询压力等级画像（未游玩/未知档位回退引导文案） */
const getLevelProfile = (bestLevel: string) =>
  LEVEL_PROFILES[bestLevel] ?? {
    emoji: '🧸',
    tag: '待开张',
    explain: '还没有捏爆过任何一只捏捏，情绪小怪兽正在排队等你出手。',
    advice: '回到信息流长按捏一捏，先攒个「轻捏」热热身！',
  }

const GAMES: GameEntry[] = [
  {
    emoji: '🫧',
    name: '捏泡泡纸',
    desc: '一排排捏爆泡泡，听啵啵声',
    path: '/pages/bubble/index',
  },
  {
    emoji: '🔴',
    name: '疯狂解压按钮',
    desc: '连按充能，满格爆发彩带',
    path: '/pages/button/index',
  },
  {
    emoji: '🧼',
    name: '切香皂',
    desc: '一刀一刀切出光洁切面',
    path: '/pages/soap/index',
  },
]

export default function Index() {
  const [stats, setStats] = useState<SquishyStats | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshStats = useCallback(async () => {
    setLoading(true)
    try {
      const res = await Network.request<{ success: boolean; data: SquishyStats | null }>({
        url: '/api/squishy/stats',
        method: 'GET',
      })
      const body = res?.data as { success?: boolean; data?: SquishyStats | null } | null
      if (body?.success) {
        setStats(body.data ?? null)
      } else {
        setStats(null)
      }
    } catch (error) {
      console.error('[squishy-stats] request failed', error)
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    void refreshStats()
  })

  const handleGameTap = useCallback((path: string) => {
    Taro.navigateTo({ url: path })
  }, [])

  return (
    <View className="min-h-screen bg-[#fff9f4] text-[#16181f]">
      <CustomNavSpace />

      <View className="px-4 pb-10 pt-2">
        {/* 解压报告区 */}
        <View className="mb-5">
          <Text className="block text-[#9c8b7d] text-xs tracking-widest">SQUISHY RELIEF</Text>
          <Text className="mt-1 block text-xl font-semibold leading-7">今日捏捏解压报告</Text>
          <Text className="mt-1 block text-sm leading-5 text-[#7a6a5c]">
            记录你在捏捏乐里的每一次放松
          </Text>
        </View>

        {loading ? (
          <View className="rounded-2xl bg-[#f6ecdf] px-5 py-8">
            <Text className="block text-center text-sm text-[#9c8b7d]">正在整理你的解压数据…</Text>
          </View>
        ) : stats ? (
          (() => {
            const profile = getLevelProfile(stats.bestLevel)
            return (
              <View className="rounded-2xl bg-gradient-to-br from-[#ffe6d8] via-[#fff3e8] to-[#cef3e2] p-5">
                {/* 压力等级行 */}
                <View className="flex items-center gap-2.5 rounded-xl bg-white/70 px-3.5 py-3">
                  <View className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#ffe1ea]">
                    <Text className="text-xl leading-7">{profile.emoji}</Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="block text-xs text-[#9c8b7d]">压力等级</Text>
                    <Text className="block text-base font-semibold leading-6 text-[#16181f]">
                      {`${stats.bestLevel === '—' ? '还没捏过' : stats.bestLevel} · ${profile.tag}`}
                    </Text>
                  </View>
                </View>
                {/* 俏皮解释 */}
                <Text className="mt-3 block text-sm leading-6 text-[#5f5347]">
                  {profile.explain}
                </Text>
                {/* 解压建议 */}
                <View className="mt-3 flex items-start gap-2 rounded-xl bg-[#fff7e6] px-3.5 py-2.5">
                  <Text className="shrink-0 text-sm leading-6">💡</Text>
                  <Text className="min-w-0 flex-1 text-sm leading-6 text-[#8a6a2f]">
                    {profile.advice}
                  </Text>
                </View>
                <View className="mt-4 flex items-end justify-between">
                  <View>
                    <Text className="block text-xs text-[#9c8b7d]">累计解压值</Text>
                    <Text className="block font-bold leading-10 text-[#ff6b93]">
                      {`${stats.totalRelief}`}
                    </Text>
                  </View>
                  <Image
                    src={emptyImage}
                    mode="aspectFit"
                    className="h-10 w-10 opacity-80"
                  />
                </View>
                <View className="mt-4 flex gap-2">
                  <View className="flex-1 rounded-xl bg-white/70 px-3 py-2.5">
                    <Text className="block text-xs text-[#9c8b7d]">捏捏次数</Text>
                    <Text className="block text-base font-semibold text-[#16181f]">
                      {`${stats.pressCount} 次`}
                    </Text>
                  </View>
                  <View className="flex-1 rounded-xl bg-white/70 px-3 py-2.5">
                    <Text className="block text-xs text-[#9c8b7d]">最高力度</Text>
                    <Text className="block text-base font-semibold text-[#16181f]">
                      {stats.bestLevel === '—' ? '—' : stats.bestLevel}
                    </Text>
                  </View>
                </View>
              </View>
            )
          })()
        ) : (
          <View className="rounded-2xl bg-[#f6ecdf] px-5 py-8">
            <Image
              src={emptyImage}
              mode="aspectFit"
              className="mx-auto mb-3 h-12 w-12 opacity-70"
            />
            <Text className="block text-center text-base font-medium leading-6 text-[#7a6a5c]">
              还没有解压记录
            </Text>
            <Text className="mt-1 block text-center text-sm leading-5 text-[#9c8b7d]">
              回到信息流长按捏一捏捏捏乐，回来就能看到你的解压报告
            </Text>
          </View>
        )}

        {/* 小游戏馆 */}
        <View className="mt-8">
          <Text className="block text-lg font-semibold leading-7">解压小游戏馆</Text>
          <Text className="mt-1 block text-sm leading-5 text-[#7a6a5c]">
            换个花样继续放松，点开就玩
          </Text>
        </View>

        <View className="mt-4 flex flex-col gap-3">
          {GAMES.map((game) => (
            <View
              key={game.path}
              className="flex items-center gap-3 rounded-2xl bg-white px-4 py-4"
              onClick={() => {
                handleGameTap(game.path)
              }}
            >
              <View className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f6ecdf]">
                <Text className="text-2xl leading-8">{game.emoji}</Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text className="block text-base font-medium leading-6 text-[#16181f]">
                  {game.name}
                </Text>
                <Text className="mt-0.5 block truncate text-sm leading-5 text-[#9c8b7d]">
                  {game.desc}
                </Text>
              </View>
              <Text className="shrink-0 text-lg leading-6 text-[#d8c4b0]">›</Text>
            </View>
          ))}
        </View>

        <Text className="mt-6 block text-center text-xs leading-4 text-[#b5a695]">
          想再捏一次？回到信息流就能找到捏捏乐
        </Text>
      </View>
    </View>
  )
}
