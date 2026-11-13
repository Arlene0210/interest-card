import { Injectable } from '@nestjs/common';
import { SquishyService } from '../squishy/squishy.service';
import type { CardData } from './card-data.types';

/** 捏捏乐静态玩法配置（玩具与力度档位） */
const SQUISHY_CARD_DATA: CardData = {
  contractVersion: '1.0.0',
  displayMode: 'initial',
  views: {
    initial: {
      hint: '长按捏瘪它 · 按得越久捏得越瘪',
      renewLabel: '再捏一次',
      toys: [
        {
          id: 'toy-1',
          name: '奶油小方',
          color: '#ffe6d8',
          shapeId: 'toast',
          earId: 'none',
          fillingId: 'custard',
          desc: '奶fufu的入门款，一捏就陷',
          softness: 0.6,
        },
        {
          id: 'toy-2',
          name: '薄荷团子',
          color: '#cef3e2',
          shapeId: 'round',
          earId: 'round',
          fillingId: 'mint',
          desc: '清爽解腻，回弹最慢',
          softness: 0.75,
        },
        {
          id: 'toy-3',
          name: '奶黄包',
          color: '#fff0c6',
          shapeId: 'onigiri',
          earId: 'none',
          fillingId: 'custard',
          desc: '软到极限，一按一个坑',
          softness: 0.9,
        },
      ],
      levels: [
        {
          min: 0,
          label: 'Lv.1 轻捏',
          feedback: '轻轻一捏，压力松了一点',
          relief: 5,
          onomatopoeia: '啵嘤～',
        },
        {
          min: 35,
          label: 'Lv.2 用力捏',
          feedback: '狠狠捏下去，超解气！',
          relief: 10,
          onomatopoeia: '噗叽！',
        },
        {
          min: 70,
          label: 'Lv.3 捏爆',
          feedback: '把它完全捏爆了！太爽了！',
          relief: 20,
          onomatopoeia: '啪叽！！',
        },
      ],
      soundLabel: '音效',
      diy: {
        title: '捏捏形象工坊',
        openLabel: 'DIY 捏捏',
        customName: '专属捏捏',
        confirmLabel: '开捏！',
        presetLabel: '形象',
        shapeLabel: '身体',
        earLabel: '耳朵',
        colorLabel: '配色',
        fillingLabel: '内馅',
        presets: [
          {
            id: 'peachy',
            name: '蜜桃团子',
            color: '#ffb3c1',
            shapeId: 'round',
            earId: 'round',
            fillingId: 'strawberry',
            desc: '粉嫩软团，头顶小圆耳',
          },
          {
            id: 'cocoabun',
            name: '可可方包',
            color: '#b98a6b',
            shapeId: 'toast',
            earId: 'point',
            fillingId: 'chocolate',
            desc: '厚切脆皮方包，巧克力流心',
          },
          {
            id: 'custardhorn',
            name: '芝士角角',
            color: '#ffd45e',
            shapeId: 'onigiri',
            earId: 'horn',
            fillingId: 'custard',
            desc: '头顶小犄角的奶黄团',
          },
        ],
        shapes: [
          { id: 'round', name: '圆球' },
          { id: 'toast', name: '方包' },
          { id: 'onigiri', name: '饭团' },
          { id: 'heart', name: '爱心' },
        ],
        ears: [
          { id: 'none', name: '无耳' },
          { id: 'round', name: '圆耳' },
          { id: 'point', name: '尖耳' },
          { id: 'bow', name: '蝴蝶结' },
          { id: 'horn', name: '犄角' },
        ],
        colors: [
          { id: 'peach', name: '蜜桃粉', hex: '#ffb3c1' },
          { id: 'berry', name: '莓果红', hex: '#ff5a5a' },
          { id: 'cheese', name: '奶孚黄', hex: '#ffd45e' },
          { id: 'mint', name: '薄荷绿', hex: '#cef3e2' },
          { id: 'taro', name: '香芋紫', hex: '#e3d7ff' },
          { id: 'sky', name: '天空蓝', hex: '#cfe6ff' },
          { id: 'cocoa', name: '可可棕', hex: '#b98a6b' },
          { id: 'cream', name: '奶油白', hex: '#fff0e0' },
        ],
        fillings: [
          { id: 'none', name: '无馅', hex: '' },
          { id: 'strawberry', name: '草莓爆浆', hex: '#ff6b81' },
          { id: 'chocolate', name: '巧克力爆浆', hex: '#8a5a3b' },
          { id: 'custard', name: '奶黄流心', hex: '#ffc53d' },
          { id: 'mint', name: '薄荷夹心', hex: '#8fe8c2' },
        ],
      },
      stack: {
        customLabel: '数量',
        max: 100,
        min: 1,
      },
    },
    expanded: {
      title: '今日解压报告',
      body: '捏一捏，烦恼少一半。继续去信息流捏捏，或换一款小游戏放松。',
      tags: ['解压', '捏捏乐', '小游戏'],
    },
  },
  userState: {
    hasExpanded: false,
  },
  meta: {
    source: 'squishy-static-config',
  },
};

@Injectable()
export class CardDataService {
  constructor(private readonly squishyService: SquishyService) {}

  /**
   * 组装 CardData payload。
   * 玩具与力度档位为静态玩法配置；userState 注入服务端已知用户累计统计，
   * 卡片进入时回读接续（解压值/次数/最高档不归零），落地页报告可延续。
   */
  buildCardData(openId?: string, _delegateToken?: string): CardData {
    const { data: stats } = this.squishyService.getStats(openId);
    const userState: CardData['userState'] = stats
      ? {
          hasExpanded: false,
          totalRelief: stats.totalRelief,
          pressCount: stats.pressCount,
          bestLevel: stats.bestLevel,
          lastLevel: stats.lastLevel,
        }
      : { hasExpanded: false };
    // 浅拷贝静态配置再覆写 userState，避免共享常量被运行时污染
    return { ...SQUISHY_CARD_DATA, userState };
  }

  buildDyCardResponse(openId?: string, delegateToken?: string): { success: boolean; data: string } {
    try {
      const payload = this.buildCardData(openId, delegateToken);
      return {
        success: true,
        data: JSON.stringify(payload),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '获取卡片数据失败';
      console.error('[CardData] build failed:', error);
      return {
        success: false,
        data: JSON.stringify({ error: message }),
      };
    }
  }
}
