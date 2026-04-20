# Hangar Planning (v3)

Веб‑приложение для планирования и расстановки ВС по ангарам (Node.js + React + PostgreSQL).

## Что здесь будет

- Справочники: операторы, типы ВС, борта, события (A‑check, C‑check, …), ангары и варианты расстановки
- Планирование: стратегический и оперативный план (единый объект события с разными уровнями)
- Резервирование мест: привязка события к месту стоянки в конкретном варианте расстановки, контроль конфликтов
- Визуализация:
  - Диаграмма Гантта по событиям/бортам/ангарам
  - Схема ангара (план‑вид) с подсветкой занятости мест и быстрым резервированием
- Аналитика ресурса: занятость мест и агрегаты по периодам (расширяемо до людей/техники)

## Быстрый старт (после установки зависимостей)

1) Запустить PostgreSQL:

```bash
docker compose up -d
```

Если Docker Desktop не установлен/не запущен, можно использовать локальный PostgreSQL и просто прописать правильный `DATABASE_URL` (локальная БД-источник) и `DATABASE_CLOUD_URL` (основная облачная БД) в `.env`.

2) Скопировать переменные окружения:

```bash
copy .env.example .env
copy apps\api\.env.example apps\api\.env
```

3) Установить зависимости:

```bash
npm install
```

4) Применить миграции и сид в основную БД (`DATABASE_CLOUD_URL`):

```bash
cd apps/api
npm run prisma:migrate:deploy
npm run prisma:seed
cd ../..
```

5) Запустить dev:

```bash
npm run dev
```

## Демо‑снимок данных (как “развернуть ту же БД” в другом месте)

В репозитории хранится файл `apps/api/prisma/demo-data.json` — это **снимок данных** (справочники, события, резервы, ресурсы и т.д.) из вашей БД `hangar_planning`, чтобы можно было быстро поднять демонстрационный стенд с теми же данными.

- **Перенести данные из локальной БД (`DATABASE_URL`) в облачную (`DATABASE_CLOUD_URL`)**:

```bash
npm run db:clone:cloud -w apps/api
```

- **Импорт на новом окружении**:
  - выполните миграции в `DATABASE_CLOUD_URL`
  - затем перенесите данные командой выше или запустите seed

```bash
cd apps/api
npm run prisma:migrate:deploy
npm run prisma:seed
cd ../..
```

Приложение и Prisma используют `DATABASE_CLOUD_URL` как основной datasource. `DATABASE_URL` можно оставить как локальную БД-источник для разовых переносов в облако.

## Важные замечания по окружению (Windows)

- **Docker**: `docker compose up -d` требует установленный и запущенный Docker Desktop.
- **PostgreSQL без Docker**: создайте локальную БД `hangar_planning`, обновите `DATABASE_URL`, а строку облачной БД храните в `DATABASE_CLOUD_URL`.

## Скрипты

- `npm run dev` — поднять API+Web
- `npm run build` — production build
- `npm run lint` — линт
- `npm run prisma:migrate:deploy -w apps/api` — применить миграции в `DATABASE_CLOUD_URL`
- `npm run db:clone:cloud -w apps/api` — перенести все данные из `DATABASE_URL` в `DATABASE_CLOUD_URL`

## Публикация на GitHub

- **Не коммитить секреты**: файлы `.env` игнорируются через `.gitignore`; используйте `.env.example` как шаблон.
- **CI**: добавлен workflow `.github/workflows/ci.yml` (lint+build).

## Структура

- `apps/api` — backend API (Fastify, Prisma)
- `apps/web` — frontend (React, Vite)
- `packages/shared` — общие типы/DTO/валидация
