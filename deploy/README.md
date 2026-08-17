# Стенд в закрытом контуре

Полная инструкция — в корневом [README.md](../README.md), раздел «Развёртывание в закрытом контуре».

Кратко:

```bash
cp .env.example .env
# DATABASE_CLOUD_URL, JWT_SECRET ≥ 24, COOKIE_SECURE=0, CORS_ORIGINS пустой
npm install
npm run prisma:migrate:deploy -w apps/api
npm run prisma:seed -w apps/api
npm run build
npm start
```

Адрес: **http://хост:3000**

Разработка (`npm run dev`): UI :3000, API :3001 — это не стенд.
