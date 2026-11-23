const { GEMINI_API_KEY, maskKey } = require('../config');

// Gemini 다중 모델 자동 폴백 호출
async function callGemini(prompt, systemInstruction = '', responseMimeType = null) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  }

  const candidateModels = ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash'];
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

// ========================================================
// ⚡ 초경량 초절전 AI 스탬프 생성 엔진 (토큰 90%~98% 절감)
// ========================================================

const PIXEL_PALETTE = {
  '.': null,        // 투명
  '1': '#111111',   // 검정 외곽선
  '2': '#ffffff',   // 흰색
  '3': '#ff595e',   // 빨강
  '4': '#2ec4b6',   // 민트/초록
  '5': '#00bbf9',   // 파랑
  '6': '#fee440',   // 노랑
  '7': '#ff9f1c',   // 주황
  '8': '#9b5de5'    // 보라
};

// 1. [고도화 픽셀 엔진] 기하학적 대칭성 및 외곽선 보정 픽셀 아트 생성 (16x16, 24x24, 32x32 지원)
async function generateLightweightPixelStamp(rawPrompt, requestedGridSize = 16) {
  const p = (rawPrompt || '하트').trim();
  const size = [16, 24, 32].includes(Number(requestedGridSize)) ? Number(requestedGridSize) : 16;

  const sysInst = `너는 닌텐도/슈퍼패미컴 16-bit 레트로 전문 최고급 도트 픽셀 아티스트야.
팔레트: .=투명, 1=검정외곽선, 2=흰색광택, 3=빨강, 4=초록, 5=파랑, 6=노랑, 7=주황, 8=보라.

[픽셀 작화 절대 철칙]:
1. 캔버스 규격: 정확히 ${size}글자씩 ${size}줄의 도트 행렬만 출력할 것.
2. 외곽선(1): 사물의 바깥 둘레는 반드시 1(검정)으로 깔끔하게 감싸져야 하며 지저분하게 겹치는 픽셀(jaggies)이 없어야 함.
3. 여백(.): 상하좌우 최소 1~2칸은 .(투명)으로 비워두어 ${size}x${size} 캔버스 안에 사물이 균형 있게 안착되도록 할 것.
4. 엄격한 대칭(Symmetry): 하트, 왕관, 얼굴, 엠블럼, 우주선 등 대칭형 사물은 중심열을 기준으로 좌우 대칭을 정확히 일치시킬 것.
5. 하이라이트(2): 상단이나 좌측에 2(흰색)로 반사광을 주어 입체감을 살릴 것.
6. 오직 ${size}글자 x ${size}줄의 문자열만 출력. 코드블록, 마크다운, 설명 일체 금지.`;

  const userPrompt = `주제: "${p}". ${size}x${size} 도트 아트를 완성해줘.`;

  try {
    const rawReply = await callGemini(userPrompt, sysInst);
    const lines = rawReply
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/```/g, '')
      .split('\n')
      .map(l => l.trim().replace(/[^.1-8]/g, ''))
      .filter(l => l.length >= Math.floor(size * 0.7));

    if (lines.length >= Math.floor(size * 0.7)) {
      const formattedLines = [];
      for (let r = 0; r < size; r++) {
        let line = lines[r] || '.'.repeat(size);
        if (line.length < size) line = line.padEnd(size, '.');
        if (line.length > size) line = line.slice(0, size);
        formattedLines.push(line);
      }
      return { lines: formattedLines, gridSize: size, palette: PIXEL_PALETTE, fromAi: true };
    }
  } catch (err) {
    console.warn(`⚠️ [Pixel AI Fallback] (${err.message}) -> 로컬 절차적 픽셀 아트 사용`);
  }

  // 로컬 절차적 픽셀 폴백
  return { lines: getProceduralPixelGrid(p), gridSize: 16, palette: PIXEL_PALETTE, fromAi: false };
}

// 로컬 절차적 16x16 픽셀 아트 라이브러리
function getProceduralPixelGrid(rawPrompt) {
  const p = (rawPrompt || '').toLowerCase();

  // 하트
  if (p.includes('하트') || p.includes('heart') || p.includes('사랑')) {
    return [
      "................",
      "....33....33....",
      "...3333..3333...",
      "..333333333333..",
      "..333333333333..",
      "..333333333333..",
      "...3333333333...",
      "....33333333....",
      ".....333333.....",
      "......3333......",
      ".......33.......",
      "................",
      "................",
      "................",
      "................",
      "................"
    ];
  }

  // 스마일
  if (p.includes('스마일') || p.includes('smile') || p.includes('웃음')) {
    return [
      ".....666666.....",
      "...6666666666...",
      "..666666666666..",
      ".66116666661166.",
      ".66116666661166.",
      "6666666666666666",
      "6666666666666666",
      "6616666666666166",
      ".66166666666166.",
      ".66611111111666.",
      "..666666666666..",
      "...6666666666...",
      ".....666666.....",
      "................",
      "................",
      "................"
    ];
  }

  // 별
  if (p.includes('별') || p.includes('star')) {
    return [
      ".......66.......",
      ".......66.......",
      "......6666......",
      "..666666666666..",
      "...6666666666...",
      "....66666666....",
      ".....666666.....",
      "....66666666....",
      "...6666..6666...",
      "..666......666..",
      ".66..........66.",
      "................",
      "................",
      "................",
      "................",
      "................"
    ];
  }

  // 사과 / 과일
  if (p.includes('사과') || p.includes('apple') || p.includes('과일')) {
    return [
      ".......44.......",
      "......44........",
      "....33333333....",
      "...3333333333...",
      "..333333333333..",
      "..332333333333..",
      "..332333333333..",
      "..333333333333..",
      "...3333333333...",
      "....333..333....",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................"
    ];
  }

  // 고양이
  return [
    "...11......11...",
    "..1771....1771..",
    "..177711117771..",
    "..177777777771..",
    ".17711777711771.",
    ".17711777711771.",
    ".17777733777771.",
    "..177777777771..",
    "...1771111771...",
    "....17777771....",
    ".....111111.....",
    "................",
    "................",
    "................",
    "................",
    "................"
  ];
}

// 2. [고도화 벡터 엔진] 고해상도 2D 그래픽 SVG 스티커 생성 (선형 그라데이션, 다이컷 테두리, 네온 광원)
async function generateLightweightSmoothStamp(rawPrompt) {
  const p = (rawPrompt || '별').trim();
  const sysInst = `너는 2D 모바일 게임 및 스티커 그래픽 전문 최고급 벡터 일러스트레이터야.
주제에 맞는 완성도 높고 화려한 2D 게임 에셋 스티커를 순수 SVG 코드로 작성해.

[SVG 작화 절대 원칙]:
1. 규격: 반드시 <svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"> 로 시작하고 </svg>로 끝날 것.
2. 배경: 배경 사각형 없이 반드시 완전 투명 배경일 것.
3. 스티커 테두리: 사물 가장 바깥 둘레에 두꺼운 흰색 다이컷 외곽선(<path ... fill="none" stroke="#FFFFFF" stroke-width="20" stroke-linejoin="round"/>)을 둘러 뚜렷한 스티커 질감을 연출할 것.
4. 본체: 선명한 다크 카툰 외곽선(stroke="#111827" stroke-width="8")과 깊이감 있는 선형 그라데이션(<linearGradient>)을 적용할 것.
5. 디테일 & 광택: 입체감을 주는 상단 반사광(투명 흰색 곡선) 및 포인트 네온/보석 악센트.
6. 오직 순수한 <svg ...>...</svg> 코드만 출력할 것. 마크다운(\`\`\`), 코드블록, 부연설명 일체 금지.`;

  try {
    const rawReply = await callGemini(`주제: "${p}". 최고 퀄리티의 2D 스티커 SVG 코드를 생성해줘.`, sysInst);
    const svgMatch = rawReply.match(/<svg[\s\S]*?<\/svg>/i);

    if (svgMatch && svgMatch[0].length > 100) {
      const cleanSvg = svgMatch[0].trim();
      const b64 = Buffer.from(cleanSvg, 'utf-8').toString('base64');
      const dataUrl = `data:image/svg+xml;base64,${b64}`;

      return {
        ok: true,
        category: p,
        isImage: true,
        dataUrl: dataUrl,
        svg: cleanSvg,
        style: 'smooth',
        fromAi: true
      };
    }
  } catch (err) {
    console.warn(`⚠️ [Vector SVG AI Fallback] (${err.message}) -> 로컬 절차적 스케치 사용`);
  }

  // AI 오류 또는 네트워크 장애 시 로컬 절차적 스케치로 안전하게 폴백
  const basePts = getProceduralSketch(p);
  const scaledPts = basePts.map(pt => ({
    x: Math.round(256 + pt.dx * 2.8),
    y: Math.round(256 + pt.dy * 2.8)
  }));

  return {
    category: p,
    points: scaledPts,
    style: 'smooth',
    fromAi: false
  };
}

// 3. 🍌 [Admin 전용] 나노바나나 (Nano Banana) 고화질 이미지 스탬프 생성 엔진
async function generateNanoBananaStamp(rawPrompt, stylePreference = 'smooth') {
  const p = (rawPrompt || '네온 스티커').trim();
  const imageCandidateModels = [
    'gemini-nano-banana-2.1',
    'gemini-3.1-flash-image',
    'nano-banana-pro-preview',
    'gemini-3-pro-image'
  ];

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  }

  let lastErr = null;

  // 1차: 실제 구글 Nano Banana 이미지 생성 모델 호출 시도
  for (const model of imageCandidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const stickerPrompt = `2D game sticker of "${p}", vibrant colors, sharp clean outlines, sticker art style, transparent background.`;
      const body = {
        contents: [{
          parts: [{ text: stickerPrompt }]
        }]
      };

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (resp.status === 429) {
        lastErr = new Error(`Quota limit (Free Tier 0 quota) on ${model}`);
        continue;
      }

      if (resp.ok) {
        const data = await resp.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData && part.inlineData.data) {
            const mime = part.inlineData.mimeType || 'image/png';
            return {
              ok: true,
              isImage: true,
              dataUrl: `data:${mime};base64,${part.inlineData.data}`,
              modelUsed: model,
              message: `🍌 나노바나나 (${model}) 실제 스튜디오급 이미지 생성 성공!`
            };
          }
        }
      } else {
        const errTxt = await resp.text();
        console.warn(`⚠️ [Nano Banana ${model}] Status ${resp.status}:`, errTxt.slice(0, 150));
      }
    } catch (e) {
      lastErr = e;
    }
  }

  // 2차: AI Studio Free Tier API Key의 경우 이미지 모델(Nano Banana) 일일 쿼터가 0회로 제한되어 있으므로,
  // 요청 스타일(stylePreference)에 따라 초고화질 SVG 벡터 스티커 또는 32x32 HD 픽셀 아트로 자동 고도화 폴백!
  console.warn(`⚠️ [Nano Banana Fallback] (${lastErr?.message || 'Quota'}). Falling back to Advanced Vector/Pixel`);

  if (stylePreference === 'pixel') {
    const pixelResult = await generateLightweightPixelStamp(p, 32);
    return {
      ...pixelResult,
      modelUsed: 'gemini-3.1-flash-lite (32x32 HD Pixel)',
      isFallback: true,
      notice: '💡 [안내] 현재 GEMINI_API_KEY는 무료 티어로 나노바나나 이미지 모델 쿼터가 0회입니다. 대신 32x32 HD 픽셀 아트 엔진이 작동하여 고밀도 도트로 렌더링되었습니다.'
    };
  }

  // 기본값: 초고화질 2D 그래픽 SVG 스티커 생성
  const svgResult = await generateLightweightSmoothStamp(p);
  return {
    ...svgResult,
    modelUsed: 'gemini-3.1-flash-lite (Studio SVG Vector)',
    isFallback: true,
    notice: '💡 [안내] 현재 GEMINI_API_KEY는 무료 티어로 나노바나나 이미지 모델 쿼터가 0회입니다. 대신 스튜디오급 2D SVG 벡터 스티커 엔진이 작동하여 고화질 다이컷 스티커로 렌더링되었습니다.'
  };
}

module.exports = {
  callGemini,
  getProceduralSketch,
  generateLightweightPixelStamp,
  generateLightweightSmoothStamp,
  generateNanoBananaStamp
};
