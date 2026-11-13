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
  lastLevel: string
  lastPlayedAt: number
}

/** 小游戏条目 */
interface GameEntry {
  emoji: string
  name: string
  desc: string
  path: string
}

/** 压力等级档（按累计解压值从轻到重，各档名 + 俏皮解释 + 解压建议） */
interface ReliefTier {
  /** 累计解压值下限（含） */
  min: number
  /** 等级名（从轻到重） */
  name: string
  emoji: string
  /** 俏皮解释 */
  explain: string
  /** 解压建议 */
  advice: string
}

const RELIEF_TIERS: ReliefTier[] = [
  {
    min: 1000,
    name: '解压狂人',
    emoji: '🏆',
    explain: '千锤百炼的指尖战神！累计解压值破千，你的捏捏已经捏出了包浆，压力在你面前毫无还手之力。',
    advice: '劳模就是你了～劳逸结合，偶尔也去泡泡纸和香皂那边团建一下？',
  },
  {
    min: 400,
    name: '资深捏捏家',
    emoji: '🎯',
    explain: '四百点解压值入账，你已经是捏捏乐的常客。蜡皮的每一声脆响，都是压力碎掉的声音。',
    advice: '手感已经练出来了，试试 DIY 一只专属造型，把解压捏出个人风格！',
  },
  {
    min: 150,
    name: '熟练解压手',
    emoji: '💪',
    explain: '累计解压值稳步上涨，你摸清了捏捏的脾气：什么时候轻抚、什么时候狠捏，门儿清。',
    advice: '继续攒！下一个百点里程碑就在眼前，坚持捏就是胜利。',
  },
  {
    min: 50,
    name: '入门捏捏生',
    emoji: '🫧',
    explain: '刚上手不久，累计五十点解压值入袋。捏捏乐的新手村大门已经为你敞开。',
    advice: '长按不松手可以攒大力，力度条拉满试试「捏爆」的爽感！',
  },
  {
    min: 1,
    name: '初来乍到',
    emoji: '🧸',
    explain: '解压档案刚刚开张，第一次捏捏的脆响还在耳边。万事开头甜，接下来会越来越上头。',
    advice: '回到信息流多捏几把，解压值攒起来就能升到下一档！',
  },
]

/** 按累计解压值查询压力等级档（从重到轻找首个命中；无记录时返回引导档） */
const getReliefTier = (totalRelief: number): ReliefTier =>
  RELIEF_TIERS.find((tier) => totalRelief >= tier.min) ?? {
    min: 0,
    name: '待开张',
    emoji: '🧸',
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
            const tier = getReliefTier(stats.totalRelief)
            return (
              <View className="rounded-2xl bg-gradient-to-br from-[#ffe6d8] via-[#fff3e8] to-[#cef3e2] p-5">
                {/* 压力等级行：按累计解压值从轻到重分档 */}
                <View className="flex items-center gap-2.5 rounded-xl bg-white/70 px-3.5 py-3">
                  <View className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#ffe1ea]">
                    <Text className="text-xl leading-7">{tier.emoji}</Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="block text-xs text-[#9c8b7d]">压力等级</Text>
                    <Text className="block text-base font-semibold leading-6 text-[#16181f]">
                      {`${tier.name} · 累计解压值 ${stats.totalRelief}`}
                    </Text>
                  </View>
                </View>
                {/* 俏皮解释（随等级变化） */}
                <Text className="mt-3 block text-sm leading-6 text-[#5f5347]">
                  {tier.explain}
                </Text>
                {/* 解压建议（随等级变化） */}
                <View className="mt-3 flex items-start gap-2 rounded-xl bg-[#fff7e6] px-3.5 py-2.5">
                  <Text className="shrink-0 text-sm leading-6">💡</Text>
                  <Text className="min-w-0 flex-1 text-sm leading-6 text-[#8a6a2f]">
                    {tier.advice}
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
