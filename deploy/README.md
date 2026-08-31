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

## Справочники из JSON (без событий и пользователей)

Файл `apps/api/prisma/ref-data.json` — только справочники. Перед заливкой остановите службу и работайте от сервисной УЗ:

```bash
sudo systemctl stop hvp
cd /opt/hvp_v3
sudo -u hvp -H env PATH="/usr/local/bin:$PATH" git pull
sudo -u hvp -H env PATH="/usr/local/bin:$PATH" npm run import:ref-data -w apps/api
sudo systemctl start hvp
```

`TRUNCATE` снимет демо-события seed; таблица пользователей не трогается.
