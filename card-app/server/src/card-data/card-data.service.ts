import { Injectable } from '@nestjs/common';
import type { CardData } from './card-data.types';

/** 捏捏乐静态玩法配置（玩具与力度档位） */
const SQUISHY_CARD_DATA: CardData = {
  contractVersion: '1.0.0',
  displayMode: 'initial',
  views: {
    initial: {
      hint: '长按捏瘪它 · 按得越久捏得越瘪',
      toys: [
        {
          id: 'toy-1',
          name: '奶油小方',
          color: '#ffe6d8',
          shapeId: 'toast',
          desc: '奶fufu的入门款，一捏就陷',
          softness: 0.6,
        },
        {
          id: 'toy-2',
          name: '薄荷团子',
          color: '#cef3e2',
          shapeId: 'round',
          desc: '清爽解腻，回弹最慢',
          softness: 0.75,
        },
        {
          id: 'toy-3',
          name: '奶黄包',
          color: '#fff0c6',
          shapeId: 'onigiri',
          desc: '软到极限，一按一个坑',
          softness: 0.9,
        },
      ],
      levels: [
        {
          min: 0,
          label: '轻捏',
          feedback: '轻轻一捏，压力松了一点',
          relief: 5,
          onomatopoeia: '啵嘤～',
        },
        {
          min: 35,
          label: '用力捏',
          feedback: '狠狠捏下去，超解气！',
          relief: 10,
          onomatopoeia: '噗叽！',
        },
        {
          min: 70,
          label: '捏爆',
          feedback: '把它完全捏爆了！太爽了！',
          relief: 20,
          onomatopoeia: '啪叽！！',
        },
      ],
      soundLabel: '音效',
      diy: {
        title: '制作专属捏捏',
        openLabel: 'DIY 捏捏',
        customName: '专属捏捏',
        confirmLabel: '开捏！',
        shapeLabel: '形状',
        colorLabel: '颜色',
        fillingLabel: '内馅',
        layerLabel: '层数',
        shapes: [
          { id: 'round', name: '圆球' },
          { id: 'toast', name: '方包' },
          { id: 'onigiri', name: '饭团' },
          { id: 'heart', name: '爱心' },
        ],
        colors: [
          { id: 'peach', name: '蜜桃粉', hex: '#ffd3d8' },
          { id: 'mint', name: '薄荷绿', hex: '#cef3e2' },
          { id: 'cream', name: '奶油黄', hex: '#fff0c6' },
          { id: 'taro', name: '香芋紫', hex: '#e3d7ff' },
          { id: 'sky', name: '天空蓝', hex: '#cfe6ff' },
          { id: 'orange', name: '橘子汽水', hex: '#ffdfc2' },
        ],
        fillings: [
          { id: 'none', name: '无馅', hex: '' },
          { id: 'strawberry', name: '草莓爆浆', hex: '#ff6b81' },
          { id: 'chocolate', name: '巧克力爆浆', hex: '#8a5a3b' },
          { id: 'custard', name: '奶黄流心', hex: '#ffc53d' },
        ],
        layers: [
          { count: 1, label: '1 层', multiplier: 1 },
          { count: 2, label: '2 层', multiplier: 1.5 },
          { count: 3, label: '3 层', multiplier: 2 },
        ],
      },
      stackOptions: [
        { count: 1, label: '×1' },
        { count: 2, label: '×2' },
        { count: 3, label: '×3' },
      ],
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
  /**
   * 组装 CardData payload。
   * 玩具与力度档位为静态玩法配置（无个性化数据），直接返回完整配置。
   */
  buildCardData(_openId?: string, _delegateToken?: string): CardData {
    return SQUISHY_CARD_DATA;
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
