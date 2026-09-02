# Hangar Planning

Планирование технического обслуживания и расстановка воздушных судов по ангарам.

Стек: **Node.js 20+**, **React**, **PostgreSQL 16**.

Один процесс Node раздаёт API и интерфейс на порту **3000**. Для HTTPS перед ним ставится reverse proxy (nginx) — см. [deploy/README.md](deploy/README.md).

---

## Разработка

Vite на **:3000**, API на **:3001**, прокси `/api` → 3001.

```bash
cp .env.example .env
# DATABASE_CLOUD_URL=postgresql://USER:PASSWORD@localhost:5432/hangar_planning?schema=public
npm install
npm run prisma:migrate:deploy -w apps/api
npm run prisma:seed:demo -w apps/api
npm run dev
```

Откройте http://localhost:3000

`SEED_DEMO=1` создаёт демо-пользователей (`admin@local.dev` / `admin`, `planner@local.dev` / `planner123`, `viewer@local.dev` / `viewer123`) и минимальные справочники. Без флага seed заполняет только роли, права, статусы и администратора.

---

## Production

На сервере: Node 20+, PostgreSQL 16.

### 1. База

```bash
createdb hangar_planning
```

### 2. Конфиг

```bash
cp .env.example .env
```

Минимум в `.env`:

```bash
DATABASE_CLOUD_URL="postgresql://USER:PASSWORD@127.0.0.1:5432/hangar_planning?schema=public"
DATABASE_URL="$DATABASE_CLOUD_URL"
TZ="Europe/Moscow"
NODE_ENV="production"
JWT_SECRET="случайная_строка_не_короче_24_символов"
CORS_ORIGINS=
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="свой_пароль_не_admin"
```

- `CORS_ORIGINS` пустой — UI и API с одного адреса.
- `PORT` **не ставьте**: процесс слушает **3000**.
- `SEED_DEMO` в production **запрещён**.
- Пароль `admin` и почта `admin@local.dev` в production seed **запрещены**.
- Стенд по HTTP без TLS: добавьте `COOKIE_SECURE=0`, иначе браузер не сохранит cookie.
- HTTPS за nginx: `HOST=127.0.0.1`, `COOKIE_SECURE=0` **не** задавать.

### 3. Сборка и первый запуск

```bash
npm install
npm run prisma:migrate:deploy -w apps/api
npm run prisma:seed -w apps/api
npm run build
npm start
```

Откройте `http://хост:3000`. Проверка: `curl -sf http://127.0.0.1:3000/health/ready`.

### 4. Обновление

Пошагово для корпоративного стенда (с интернетом и без) — [deploy/UPDATE.md](deploy/UPDATE.md).

Кратко, если на сервере есть git и npm:

```bash
git pull
npm ci
npm run prisma:migrate:deploy -w apps/api
npm run prisma:seed -w apps/api
npm run build
# перезапустить процесс npm start
```

### 5. Backup

```bash
mkdir -p backups
pg_dump -Fc "$DATABASE_CLOUD_URL" > "backups/hvp-$(date +%Y%m%d-%H%M%S).dump"
```

Восстановление:

```bash
pg_restore --clean --if-exists --no-owner -d "$DATABASE_CLOUD_URL" backups/hvp-….dump
```

### systemd (по желанию)

`/etc/systemd/system/hvp.service`:

```ini
[Unit]
Description=Hangar Planning
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/hangar-planning
EnvironmentFile=/opt/hangar-planning/.env
ExecStart=/usr/bin/npm start
Restart=on-failure
User=hvp

[Install]
WantedBy=multi-user.target
```

---

## Скрипты

| Команда | Что делает |
|---|---|
| `npm run dev` | разработка: UI :3000, API :3001 |
| `npm run build` | сборка API + UI |
| `npm start` | production: всё на :3000 (нужен `build`) |
| `npm test` / `npm run lint` | тесты / линт |
| `npm run prisma:migrate:deploy -w apps/api` | миграции в `DATABASE_CLOUD_URL` |
| `npm run prisma:seed -w apps/api` | роли, права, статусы, администратор |
| `npm run prisma:seed:demo -w apps/api` | то же + демо-данные (`SEED_DEMO=1`) |

`import:ref-data` затирает справочники и требует явного `CONFIRM_TRUNCATE=1`.

---

## Структура

- `apps/api` — Fastify + Prisma
- `apps/web` — React (Vite)
- `deploy/` — nginx, Docker, backup

Не коммитить `.env`. CI: `.github/workflows/ci.yml`.
