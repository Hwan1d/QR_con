# ==========================================
# Production Dockerfile for QR Graffiti Canvas
# ==========================================
FROM node:20-alpine

# 작업 디렉토리 설정
WORKDIR /app

# 프로덕션 환경 변수
ENV NODE_ENV=production
ENV PORT=3000

# 의존성 캐싱을 위해 package 파일 먼저 복사
COPY package*.json ./
RUN npm ci --omit=dev

# 애플리케이션 소스 복사
COPY server.js ./
COPY pbl04_qr_db.json ./
COPY index.html controller.html ./
COPY src/ ./src/
COPY public/ ./public/

# 포트 노출
EXPOSE 3000

# 컨테이너 보안을 위해 non-root 유저로 실행
USER node

# 서버 실행
CMD ["node", "server.js"]
