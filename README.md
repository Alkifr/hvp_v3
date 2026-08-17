# Hangar Planning (v3)

Планирование и расстановка ВС по ангарам. Node.js + React + PostgreSQL.

В закрытом контуре Docker и nginx **не нужны**: один процесс Node раздаёт и API, и интерфейс на порту **3000**.

---

## Развёртывание в закрытом контуре (стенд)

На сервере: **Node 20+**, **PostgreSQL 16**, репозиторий.

### 1. База

```bash
createdb hangar_planning
# или: psql -c "CREATE DATABASE hangar_planning;"
```

### 2. Конфиг

```bash
cp .env.example .env
```

В `.env` минимум:

```bash
DATABASE_CLOUD_URL="postgresql://USER:PASSWORD@127.0.0.1:5432/hangar_planning?schema=public"
DATABASE_URL="$DATABASE_CLOUD_URL"
TZ="Europe/Moscow"
NODE_ENV="production"
JWT_SECRET="случайная_строка_не_короче_24_символов"
COOKIE_SECURE=0
CORS_ORIGINS=
ADMIN_EMAIL="ваш.админ@компания.local"
ADMIN_PASSWORD="свой_пароль_не_admin"
```

- `COOKIE_SECURE=0` — стенд по HTTP внутри контура (без TLS). Иначе браузер не сохранит cookie.
- `CORS_ORIGINS` пустой — UI и API с одного адреса `http://сервер:3000`.
- `PORT` в `.env` **не ставьте**: стенд сам слушает **3000**.
- Пароль `admin` и почта `admin@local.dev` в production seed **запрещены**.

### 3. Сборка и первый запуск

```bash
npm install
npm run prisma:migrate:deploy -w apps/api
npm run prisma:seed -w apps/api
npm run build
npm start
```

Откройте **http://IP-или-имя:3000**

Проверка: `curl -sf http://127.0.0.1:3000/health/ready`

Остановка: Ctrl+C. Для фона — `tmux` / `systemd` (пример ниже).

### 4. Обновление версии

```bash
git pull
npm install
npm run prisma:migrate:deploy -w apps/api
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

Команда `db:clone:cloud` — не backup: она **затирает** приёмник.

### systemd (по желанию)

`/etc/systemd/system/hvp.service`:

```ini
[Unit]
Description=Hangar Planning
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/hvp_v3
EnvironmentFile=/opt/hvp_v3/.env
ExecStart=/usr/bin/npm start
Restart=on-failure
User=hvp

[Install]
WantedBy=multi-user.target
```

`EnvironmentFile` не подставляет `COOKIE_SECURE=0`, если его нет в `.env` — добавьте строку туда.

---

## Разработка на машине разработчика

Vite на **:3000**, API на **:3001**, прокси `/api` → 3001.

```bash
cp .env.example .env
# DATABASE_CLOUD_URL=postgresql://USER:PASSWORD@localhost:5432/hangar_planning?schema=public
# CORS_ORIGINS=http://localhost:3000
# NODE_ENV=development
npm install
npm run prisma:migrate:deploy -w apps/api
npm run prisma:seed -w apps/api
npm run dev
```

Откройте http://localhost:3000

---

## Скрипты

| Команда | Что делает |
|---|---|
| `npm run dev` | разработка: UI :3000, API :3001 |
| `npm run build` | сборка API + UI |
| `npm start` | стенд: всё на :3000 (нужен `build`) |
| `npm test` / `npm run lint` | тесты / линт |
| `npm run prisma:migrate:deploy -w apps/api` | миграции в `DATABASE_CLOUD_URL` |

## Публикация на GitHub

Не коммитить `.env`. CI: `.github/workflows/ci.yml`.

## Структура

- `apps/api` — Fastify + Prisma
- `apps/web` — React (Vite)
- `packages/shared` — общие типы
