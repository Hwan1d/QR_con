const { GEMINI_API_KEY, maskKey } = require('../config');

// Gemini 다중 모델 자동 폴백 호출
async function callGemini(prompt, systemInstruction = '', responseMimeType = null) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  }

  const candidateModels = ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
  let lastErr = null;

  for (const modelName of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
      const contents = [];
      if (systemInstruction) {
        contents.push({ role: 'user', parts: [{ text: systemInstruction }] });
        contents.push({ role: 'model', parts: [{ text: '네, 알겠습니다. 지침에 따라 답변하겠습니다.' }] });
      }
      contents.push({ role: 'user', parts: [{ text: prompt }] });

      const generationConfig = {
        maxOutputTokens: 2500,
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 0 }
      };
      if (responseMimeType) {
        generationConfig.responseMimeType = responseMimeType;
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({ contents, generationConfig })
      });

      if (resp.status === 429) {
        console.warn(`⚠️ [Gemini 429 Quota Exceeded] on ${modelName}, trying fallback model...`);
        lastErr = new Error(`Gemini API Error (429): Quota Exceeded on ${modelName}`);
        continue;
      }

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Gemini API Error (${resp.status}): ${maskKey(errText)}`);
      }

      const data = await resp.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      let reply = '';
      for (const part of parts) {
        if (part.text) reply += part.text;
      }
      return reply.trim();
    } catch (e) {
      lastErr = e;
      if (e.message && e.message.includes('429')) continue;
      throw e;
    }
  }

  throw lastErr || new Error('Gemini API Error (429): Quota limit reached on all models');
}

// 🎨 스마트 로컬 절차적 벡터 스케치 엔진 (할당량 초과 시 자동 가동)
function getProceduralSketch(rawPrompt) {
  const p = (rawPrompt || '').toLowerCase().trim();

  // 1. 고양이
  if (p.includes('고양이') || p.includes('cat') || p.includes('야옹')) {
    return [
      { dx: -30, dy: 10 }, { dx: -35, dy: -25 }, { dx: -15, dy: -12 },
      { dx: 15, dy: -12 }, { dx: 35, dy: -25 }, { dx: 30, dy: 10 },
      { dx: 25, dy: 35 }, { dx: 0, dy: 45 }, { dx: -25, dy: 35 },
      { dx: -30, dy: 10 }, { dx: -45, dy: 15 }, { dx: -30, dy: 20 },
      { dx: 45, dy: 15 }, { dx: 30, dy: 20 }, { dx: 0, dy: 45 },
      { dx: 40, dy: 50 }, { dx: 55, dy: 25 }
    ];
  }

  // 2. 강아지
  if (p.includes('강아지') || p.includes('개') || p.includes('dog') || p.includes('puppy')) {
    return [
      { dx: -25, dy: 10 }, { dx: -40, dy: -15 }, { dx: -35, dy: 5 },
      { dx: -20, dy: -20 }, { dx: 20, dy: -20 }, { dx: 35, dy: 5 },
      { dx: 40, dy: -15 }, { dx: 25, dy: 10 }, { dx: 30, dy: 35 },
      { dx: 0, dy: 45 }, { dx: -30, dy: 35 }, { dx: -25, dy: 10 },
      { dx: 0, dy: 25 }, { dx: -10, dy: 20 }, { dx: 10, dy: 20 }
    ];
  }

  // 3. 하트
  if (p.includes('하트') || p.includes('heart') || p.includes('사랑') || p.includes('love')) {
    return [
      { dx: 0, dy: -20 }, { dx: 25, dy: -45 }, { dx: 50, dy: -35 },
      { dx: 55, dy: -10 }, { dx: 40, dy: 20 }, { dx: 0, dy: 60 },
      { dx: -40, dy: 20 }, { dx: -55, dy: -10 }, { dx: -50, dy: -35 },
      { dx: -25, dy: -45 }, { dx: 0, dy: -20 }
    ];
  }

  // 4. 별
  if (p.includes('별') || p.includes('star')) {
    return [
      { dx: 0, dy: -50 }, { dx: 15, dy: -15 }, { dx: 50, dy: -15 },
      { dx: 25, dy: 10 }, { dx: 35, dy: 45 }, { dx: 0, dy: 25 },
      { dx: -35, dy: 45 }, { dx: -25, dy: 10 }, { dx: -50, dy: -15 },
      { dx: -15, dy: -15 }, { dx: 0, dy: -50 }
    ];
  }

  // 5. 자동차
  if (p.includes('자동차') || p.includes('차') || p.includes('car')) {
    return [
      { dx: -50, dy: 20 }, { dx: -50, dy: 0 }, { dx: -30, dy: 0 },
      { dx: -15, dy: -25 }, { dx: 20, dy: -25 }, { dx: 35, dy: 0 },
      { dx: 50, dy: 0 }, { dx: 50, dy: 20 }, { dx: 35, dy: 20 },
      { dx: 25, dy: 30 }, { dx: 15, dy: 20 }, { dx: -15, dy: 20 },
      { dx: -25, dy: 30 }, { dx: -35, dy: 20 }, { dx: -50, dy: 20 }
    ];
  }

  // 6. 피카츄 / 포켓몬
  if (p.includes('피카츄') || p.includes('pikachu') || p.includes('포켓몬')) {
    return [
      { dx: -30, dy: -10 }, { dx: -45, dy: -50 }, { dx: -25, dy: -30 },
      { dx: 0, dy: -25 }, { dx: 25, dy: -30 }, { dx: 45, dy: -50 },
      { dx: 30, dy: -10 }, { dx: 35, dy: 25 }, { dx: 0, dy: 40 },
      { dx: -35, dy: 25 }, { dx: -30, dy: -10 }, { dx: 40, dy: 10 },
      { dx: 55, dy: -10 }, { dx: 50, dy: 20 }, { dx: 65, dy: 5 }
    ];
  }

  // 7. 집
  if (p.includes('집') || p.includes('house') || p.includes('건물')) {
    return [
      { dx: 0, dy: -45 }, { dx: 45, dy: -10 }, { dx: 35, dy: -10 },
      { dx: 35, dy: 35 }, { dx: 10, dy: 35 }, { dx: 10, dy: 10 },
      { dx: -10, dy: 10 }, { dx: -10, dy: 35 }, { dx: -35, dy: 35 },
      { dx: -35, dy: -10 }, { dx: -45, dy: -10 }, { dx: 0, dy: -45 },
      { dx: 20, dy: -30 }, { dx: 20, dy: -45 }, { dx: 28, dy: -45 }, { dx: 28, dy: -22 }
    ];
  }

  // 8. 꽃
  if (p.includes('꽃') || p.includes('flower')) {
    return [
      { dx: 0, dy: -10 }, { dx: 0, dy: -35 }, { dx: 15, dy: -25 },
      { dx: 0, dy: -10 }, { dx: 25, dy: -15 }, { dx: 25, dy: 5 },
      { dx: 0, dy: -10 }, { dx: 15, dy: 15 }, { dx: -5, dy: 15 },
      { dx: 0, dy: -10 }, { dx: -20, dy: 5 }, { dx: -20, dy: -15 },
      { dx: 0, dy: -10 }, { dx: 0, dy: 45 }
    ];
  }

  // 9. 나무
  if (p.includes('나무') || p.includes('tree')) {
    return [
      { dx: 0, dy: -45 }, { dx: 20, dy: -25 }, { dx: 10, dy: -25 },
      { dx: 30, dy: -5 }, { dx: 15, dy: -5 }, { dx: 40, dy: 20 },
      { dx: 10, dy: 20 }, { dx: 10, dy: 45 }, { dx: -10, dy: 45 },
      { dx: -10, dy: 20 }, { dx: -40, dy: 20 }, { dx: -15, dy: -5 },
      { dx: -30, dy: -5 }, { dx: -10, dy: -25 }, { dx: -20, dy: -25 }, { dx: 0, dy: -45 }
    ];
  }

  // 10. 스마일
  if (p.includes('스마일') || p.includes('smile') || p.includes('웃음') || p.includes('얼굴')) {
    return [
      { dx: 0, dy: -40 }, { dx: 28, dy: -28 }, { dx: 40, dy: 0 },
      { dx: 28, dy: 28 }, { dx: 0, dy: 40 }, { dx: -28, dy: 28 },
      { dx: -40, dy: 0 }, { dx: -28, dy: -28 }, { dx: 0, dy: -40 },
      { dx: -20, dy: 5 }, { dx: 0, dy: 20 }, { dx: 20, dy: 5 },
      { dx: -15, dy: -15 }, { dx: -10, dy: -15 }, { dx: 10, dy: -15 }, { dx: 15, dy: -15 }
    ];
  }

  // 11. 기본 스트리트 아트 추상 엠블럼
  const seed = (rawPrompt || 'art').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const pts = [];
  const count = 16;
  for (let i = 0; i <= count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const r = (i % 2 === 0) ? 45 : 20 + (seed % 15);
    pts.push({
      dx: Math.round(Math.cos(angle) * r),
      dy: Math.round(Math.sin(angle) * r)
    });
  }
  return pts;
}

module.exports = {
  callGemini,
  getProceduralSketch
};
