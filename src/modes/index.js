const FreeGraffitiMode = require('./FreeGraffitiMode');
const TerritoryBattleMode = require('./TerritoryBattleMode');

/**
 * GameModeManager
 * 방 모드 플러그인 레지스트리 및 팩토리
 */
class GameModeManager {
  constructor() {
    this.modes = new Map();

    // 기본 게임 모드 2종 등록
    this.registerMode('free', new FreeGraffitiMode());
    this.registerMode('battle', new TerritoryBattleMode());
  }

  registerMode(name, modeInstance) {
    this.modes.set(name.toLowerCase(), modeInstance);
  }

  getMode(name) {
    const key = (name || 'free').toLowerCase();
    return this.modes.get(key) || this.modes.get('free');
  }

  hasMode(name) {
    return this.modes.has((name || '').toLowerCase());
  }

  listModes() {
    return [
      { id: 'free', title: '🎨 자유 그래피티', description: '자유로운 브러시/스탬프/AI 비평이 있는 무한 드로잉 모드' },
      { id: 'battle', title: '⚔️ 영역 점령전', description: '원형 경기장에서 조이스틱만으로 영역을 넓히는 팀 점령 대전' }
    ];
  }
}

const modeManager = new GameModeManager();

module.exports = {
  modeManager,
  FreeGraffitiMode,
  TerritoryBattleMode
};
