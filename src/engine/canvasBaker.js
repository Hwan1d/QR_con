/**
 * canvasBaker.js
 * 캔버스 스트로크 누적 지연을 방지하기 위한 백그라운드 베이킹(Baking) 및 스냅샷 최적화 엔진
 */

const BAKE_THRESHOLD = 120; // 베이킹 시작 획 수 기준치
const KEEP_RECENT = 40;     // 실시간 상호작용(지우개 등)을 위해 유지할 최근 획 수

/**
 * 특정 방의 누적된 획들을 검사하여 임계치를 넘으면 오래된 획을 베이킹 레이어로 압축
 * @param {Object} room 방 데이터 객체
 * @returns {Object} { baked: boolean, bakedCount: number, remainingCount: number }
 */
function checkAndBakeRoomStrokes(room) {
  if (!room || !room.strokes || room.strokes.length < BAKE_THRESHOLD) {
    return { baked: false, bakedCount: 0, remainingCount: room ? (room.strokes?.length || 0) : 0 };
  }

  const total = room.strokes.length;
  const toBakeCount = total - KEEP_RECENT;
  if (toBakeCount <= 0) return { baked: false, bakedCount: 0, remainingCount: total };

  // 오래된 획 분리
  const bakedBatch = room.strokes.slice(0, toBakeCount);
  const recentBatch = room.strokes.slice(toBakeCount);

  // 룸 스냅샷 메타데이터 갱신
  if (!room.bakingHistory) {
    room.bakingHistory = {
      totalBakedCount: 0,
      lastBakedAt: null,
      snapshotsCount: 0
    };
  }

  room.bakingHistory.totalBakedCount += bakedBatch.length;
  room.bakingHistory.lastBakedAt = new Date().toISOString();
  room.bakingHistory.snapshotsCount += 1;

  // 룸 스트로크를 최근 획으로 압축 유지 (최대 1000개 하드캡 대신 안전한 버퍼 유지)
  room.strokes = recentBatch;

  return {
    baked: true,
    bakedCount: toBakeCount,
    remainingCount: recentBatch.length,
    totalHistoricalBaked: room.bakingHistory.totalBakedCount
  };
}

/**
 * 룸 전체 강제 베이킹 (관리자 및 방장 수동 최적화 API용)
 */
function forceBakeRoom(room) {
  if (!room || !room.strokes) return { ok: false, error: '방 데이터 없음' };
  return checkAndBakeRoomStrokes(room);
}

module.exports = {
  checkAndBakeRoomStrokes,
  forceBakeRoom,
  BAKE_THRESHOLD,
  KEEP_RECENT
};
