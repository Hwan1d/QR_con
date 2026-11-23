/**
 * BaseGameMode.js
 * 모든 게임 모드가 상속받아 구현해야 하는 표준 인터페이스 및 베이스 클래스
 */
class BaseGameMode {
  constructor(modeName) {
    this.modeName = modeName;
  }

  /**
   * 플레이어가 방에 접속할 때 호출 (스폰 위치, 팀, 기본 속성 초기화)
   * @param {Object} data 클라이언트가 보낸 join 데이터
   * @param {Object} room 방 정보
   * @param {Object} context 엔진 전역 컨텍스트 ({ ARENA_CX, ARENA_CY, WORLD_WIDTH, WORLD_HEIGHT, roomPlayers })
   * @returns {Object} { spawnX, spawnY, spawnColor, spawnTeam, teamLocked, isDrawing, trailStyle }
   */
  onPlayerSpawn(data, room, context) {
    return {
      spawnX: Math.round(data.x || 300 + Math.random() * 400),
      spawnY: Math.round(data.y || 250 + Math.random() * 300),
      spawnColor: data.color || '#00f5d4',
      spawnTeam: null,
      teamLocked: false,
      isDrawing: false,
      trailStyle: 'solid'
    };
  }

  /**
   * 컨트롤러의 조이스틱/도구 조작 이벤트 수신 시 모드별 제어
   * @param {Object} player 대상 플레이어 객체
   * @param {Object} data 클라이언트 조작 데이터
   * @param {Object} room 방 정보
   */
  onPlayerControl(player, data, room) {
    // 기본 구현: 자유 그래피티 방식
    if (data.isDrawing !== undefined) player.isDrawing = !!data.isDrawing;
    if (data.trailStyle !== undefined) player.trailStyle = data.trailStyle;
    if (data.isErasing !== undefined) player.isErasing = !!data.isErasing;
    if (data.eraserRadius !== undefined) player.eraserRadius = data.eraserRadius;
    if (data.color !== undefined) {
      player.color = data.color;
      if (data.color === 'eraser') {
        player.isErasing = true;
        player.isDrawing = false;
      } else if (data.color === 'transparent') {
        player.isErasing = false;
        player.isDrawing = false;
      }
    }
    if (data.nickname) player.nickname = data.nickname;
  }

  /**
   * 40 FPS 물리/이동 틱마다 호출 (위치 이동 제한, 트레일 획 생성, 점유율 연산 등)
   * @param {Array} activePlayers 해당 방의 활성 플레이어 목록
   * @param {Object} room 방 정보
   * @param {Object} context 엔진 컨텍스트 ({ io, db, addStroke, makeStrokeId })
   */
  onPhysicsTick(activePlayers, room, context) {
    // 서브클래스에서 재정의
  }

  /**
   * 직접 그리기 (터치 패드 드로잉) 허용 여부 및 처리
   */
  onDirectDraw(player, stroke, room, context) {
    return true; // 기본적으로 허용
  }

  /**
   * 스탬프 도장 찍기 허용 여부 및 처리
   */
  onStampPlace(player, stampStroke, room, context) {
    return true; // 기본적으로 허용
  }

  /**
   * 지우개로 획 지우기 허용 여부
   */
  onErase(player, eraseData, room, context) {
    return true; // 기본적으로 허용
  }

  /**
   * 방장/관리자에 의한 게임 시작 이벤트 처리
   */
  onGameStart(room, context, socket) {
    // 기본 모드는 별도 시작 액션 없음
  }

  /**
   * 게임 리셋 이벤트 처리
   */
  onGameReset(room, context, socket) {
    // 기본 모드는 별도 리셋 액션 없음
  }

  /**
   * 1초 주기 타이머 루프에서 호출 (매치 타이머, 점수 틱 등)
   */
  onSecondTick(room, context) {
    // 서브클래스에서 필요 시 구현
  }

  /**
   * 클라이언트가 방에 접속했을 때 전달할 모드 전용 상태 HUD
   */
  getHUDState(roomCode) {
    return { mode: this.modeName };
  }
}

module.exports = BaseGameMode;
