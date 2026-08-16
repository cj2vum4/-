# 可部署到 Render / Railway / Fly.io / Cloud Run 等任何吃 Docker 的平台
FROM node:22-alpine

WORKDIR /app

# 先裝相依，讓這層可以被快取
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# 憑證一律由平台的環境變數注入，絕不寫進映像檔
CMD ["npm", "start"]
