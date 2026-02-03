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

Если Docker Desktop не установлен/не запущен, можно использовать локальный PostgreSQL и просто прописать правильный `DATABASE_URL` в `.env` и `apps/api/.env`.

2) Скопировать переменные окружения:

```bash
copy .env.example .env
copy apps\api\.env.example apps\api\.env
```

3) Установить зависимости:

```bash
npm install
```

4) Применить миграции и сид (нужна доступная БД):

```bash
cd apps/api
npm run prisma:migrate -- --name init
npm run prisma:seed
cd ../..
```

5) Запустить dev:

```bash
npm run dev
```

## Важные замечания по окружению (Windows)

- **Docker**: `docker compose up -d` требует установленный и запущенный Docker Desktop.
- **PostgreSQL без Docker**: создайте БД `hangar_planning`, пользователя/пароль или используйте свои — и обновите `DATABASE_URL`.

## Скрипты

- `npm run dev` — поднять API+Web
- `npm run build` — production build
- `npm run lint` — линт

## Публикация на GitHub

- **Не коммитить секреты**: файлы `.env` игнорируются через `.gitignore`; используйте `.env.example` как шаблон.
- **CI**: добавлен workflow `.github/workflows/ci.yml` (lint+build).

## Структура

- `apps/api` — backend API (Fastify, Prisma)
- `apps/web` — frontend (React, Vite)
- `packages/shared` — общие типы/DTO/валидация
