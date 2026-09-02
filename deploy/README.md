# Развёртывание

Полная инструкция — в корневом [README.md](../README.md). Обновление стенда (онлайн / офлайн) — [UPDATE.md](UPDATE.md).

Кратко:

```bash
cp .env.example .env
# DATABASE_CLOUD_URL, JWT_SECRET ≥ 24, CORS_ORIGINS пустой
# COOKIE_SECURE=0 — только HTTP без TLS
npm install
npm run prisma:migrate:deploy -w apps/api
npm run prisma:seed -w apps/api
npm run build
npm start
```

Адрес: **http://хост:3000**

Разработка (`npm run dev`): UI :3000, API :3001 — это не стенд.

## Справочники из JSON

Файл `apps/api/prisma/ref-data.json` — только справочники (без событий и пользователей). Перед заливкой остановите службу.

```bash
CONFIRM_TRUNCATE=1 npm run import:ref-data -w apps/api
```

Без `CONFIRM_TRUNCATE=1` скрипт не запустится. `TRUNCATE` снимает справочники; таблица пользователей не трогается.

## HTTPS (nginx)

Шаблон: `deploy/nginx-https.conf.example`. Подставьте свой домен и пути к сертификату.

Скрипт самоподписанного сертификата (для закрытой сети, браузер покажет предупреждение):

```bash
sudo HVP_DOMAIN=planning.example.internal bash deploy/setup-selfsigned-https.sh
```

`HVP_DOMAIN` обязателен. После выпуска сертификата УЦ замените файлы в `/etc/ssl/certs/` и `/etc/ssl/private/`, затем `sudo nginx -t && sudo systemctl reload nginx`.

Для HTTPS в `.env` приложения: `HOST=127.0.0.1`, `COOKIE_SECURE=0` не задавать.
