# Обновление стенда в корпоративном контуре

Документ для администратора сервера. Путь установки ниже — **пример**; подставьте свой каталог, пользователя службы и имя unit в systemd.

Предположения:

- Node.js **20+**, PostgreSQL **16**
- Код лежит в `/opt/hangar-planning`
- Служба: `hvp.service`, пользователь `hvp`
- Процесс: `npm start` → API и UI на порту **3000**
- Конфиг: `/opt/hangar-planning/.env` (не из git)

`.env` при обновлении **не перезаписывать** и **не копировать** с машины разработчика.

---

## Что общее для обеих схем

### Перед любым обновлением

1. Сообщите пользователям окно работ. В админке можно включить режим «только просмотр» (блокировка записи).
2. Сделайте backup базы **на сервере**:

```bash
sudo -u hvp -H bash -lc 'cd /opt/hangar-planning && set -a && . ./.env && set +a && mkdir -p backups && pg_dump -Fc "$DATABASE_CLOUD_URL" > "backups/hvp-$(date +%Y%m%d-%H%M%S).dump"'
```

Проверьте, что файл появился и размер не нулевой.

3. Запишите текущую версию кода (чтобы откатиться):

```bash
cd /opt/hangar-planning
sudo -u hvp git rev-parse --short HEAD
sudo -u hvp git log -1 --oneline
```

Если git нет (офлайн-архив) — сохраните копию каталога или имя файла прошлого архива.

4. Остановите приложение:

```bash
sudo systemctl stop hvp
```

Не останавливайте PostgreSQL.

### Чего не делать

| Действие | Почему |
|---|---|
| `SEED_DEMO=1` / `prisma:seed:demo` | Создаст демо-учётки на боевой базе |
| `CONFIRM_TRUNCATE=1 import:ref-data` | Снесёт справочники |
| Менять `.env` «как в примере» | Сбросит JWT, CORS, cookie, пароль БД |
| Копировать `node_modules` с macOS/Windows на Linux | Нативные модули (`argon2`, Prisma) не подойдут |
| `git pull` с незакоммиченными правками на сервере | Конфликт, сломанный стенд |

### После получения новой версии кода

Шаги **одинаковые**, откуда бы ни пришёл код (git или архив).

Работать от пользователя службы, с тем же `PATH`, что у Node:

```bash
cd /opt/hangar-planning
sudo systemctl stop hvp

# зависимости — см. разделы «с интернетом» / «без интернета»

sudo -u hvp -H env PATH="/usr/local/bin:$PATH" npm run prisma:migrate:deploy -w apps/api
sudo -u hvp -H env PATH="/usr/local/bin:$PATH" npm run prisma:seed -w apps/api
sudo -u hvp -H env PATH="/usr/local/bin:$PATH" npm run build
sudo systemctl start hvp
sudo systemctl status hvp --no-pager
```

- **migrate** — обязателен. Накатывает SQL из `apps/api/prisma/migrations/`.
- **seed без `SEED_DEMO`** — безопасен для уже существующей базы: обновляет роли и права, **не сбрасывает пароли** существующих пользователей. Нужен, когда в версии появились новые permission-коды.
- **build** — обязателен: `npm start` раздаёт собранный UI из `dist`.

Проверка:

```bash
curl -sf http://127.0.0.1:3000/health/ready && echo OK
```

Ожидание: HTTP 200. Дальше откройте UI в браузере, войдите, проверьте Гантт.

Снимите техрежим в админке, если включали.

---

## Вариант 1. На сервере есть интернет

Нужен доступ:

- к git-репозиторию (GitHub или внутренний git);
- к npm registry (`registry.npmjs.org`), если в релизе менялись зависимости.

```bash
cd /opt/hangar-planning
sudo systemctl stop hvp

sudo -u hvp -H env PATH="/usr/local/bin:$PATH" git fetch --all --tags
sudo -u hvp -H env PATH="/usr/local/bin:$PATH" git rev-parse --short HEAD   # запомнить
sudo -u hvp -H env PATH="/usr/local/bin:$PATH" git pull --ff-only

sudo -u hvp -H env PATH="/usr/local/bin:$PATH" npm ci
```

`npm ci` ставит пакеты строго по `package-lock.json`. Если `npm ci` ругается на lockfile — не удаляйте lockfile на сервере; разберитесь с версией, которую принёс git.

Дальше — общие шаги: migrate → seed → build → start → health.

Если git на сервере есть, а **npm registry закрыт**, код обновляете `git pull`, а `node_modules` — как в варианте 2 (архив зависимостей, собранный на той же ОС).

---

## Вариант 2. Интернета на сервере нет

Типовая схема: подготовка **на машине с той же ОС и архитектурой**, что сервер (Linux x86_64 / Astra и т.п.), перенос носителем или через внутреннюю сеть.

Не готовьте `node_modules` на Mac/Windows для Linux-сервера.

### 2.1. Что приготовить на машине с интернетом

Нужны: Node 20+, git, tar.

```bash
git clone --depth 1 <url-репозитория> hvp_release
# или: git fetch && git checkout <тег-или-коммит>
cd hvp_release
git rev-parse --short HEAD > VERSION.txt
npm ci
npm run build
```

Соберите архив **без** `.env` и без чужих backup:

```bash
tar --exclude='.env' --exclude='.env.*' --exclude='backups' --exclude='.git' \
  -czf hvp-$(cat VERSION.txt)-linux.tgz .
```

В архиве должны быть:

- исходники;
- `package-lock.json`;
- `node_modules/` (уже под Linux);
- `apps/api/dist/`, `apps/web/dist/` (если build уже сделали).

Если на сборочной машине **нет** той же ОС, что на сервере:

1. Упакуйте **только исходники** (без `node_modules`, без `dist`):

```bash
git archive --format=tar.gz -o hvp-src-$(git rev-parse --short HEAD).tgz HEAD
```

2. На сервере после распаковки зависимости взять неоткуда. Тогда нужен **офлайн-кэш npm**, собранный на Linux:

```bash
# на Linux с интернетом, в каталоге релиза:
npm ci --cache ./npm-cache
tar -czf hvp-npm-cache.tgz npm-cache package-lock.json
```

На сервере:

```bash
tar -xzf hvp-src-….tgz
tar -xzf hvp-npm-cache.tgz
npm ci --offline --cache ./npm-cache
npm run build
```

`--offline` не ходит в сеть. Кэш и lockfile должны быть от **того же** `package-lock.json`.

### 2.2. На сервере без интернета

```bash
sudo systemctl stop hvp
sudo -u hvp cp -a /opt/hangar-planning /opt/hangar-planning.bak-$(date +%Y%m%d-%H%M%S)

# сохранить .env
sudo -u hvp cp /opt/hangar-planning/.env /tmp/hvp.env.save

cd /opt/hangar-planning
sudo -u hvp tar -xzf /path/to/hvp-XXXX-linux.tgz
sudo -u hvp cp /tmp/hvp.env.save /opt/hangar-planning/.env
rm -f /tmp/hvp.env.save
```

Если архив уже содержит `node_modules` и `dist` под Linux — `npm ci` и `build` можно не повторять. Если только исходники + npm-cache — выполните `npm ci --offline` и `build`, как выше.

Дальше — общие шаги: migrate → seed → start → health.

Права на файлы:

```bash
sudo chown -R hvp:hvp /opt/hangar-planning
```

---

## Откат

1. `sudo systemctl stop hvp`
2. Вернуть код:
   - **с git:** `sudo -u hvp git checkout <старый-хеш>` затем `npm ci`, `npm run build`
   - **без git:** распаковать предыдущий архив / вернуть `/opt/hangar-planning.bak-…`, снова положить сохранённый `.env`
3. Если уже накатились миграции и новая версия не стартует — восстановить базу:

```bash
sudo -u hvp -H bash -lc 'cd /opt/hangar-planning && set -a && . ./.env && set +a && pg_restore --clean --if-exists --no-owner -d "$DATABASE_CLOUD_URL" backups/hvp-….dump'
```

Откат миграций Prisma «назад» вручную не делайте: для контура надёжнее restore из dump, снятого **до** migrate.

4. `sudo systemctl start hvp` и проверка `/health/ready`.

---

## Частые сбои

| Симптом | Что проверить |
|---|---|
| `health/ready` 503 | PostgreSQL, `DATABASE_CLOUD_URL` в `.env`, сеть до БД |
| Белая страница / старый UI | Не сделали `npm run build` или не перезапустили службу |
| Cookie не держится | HTTP без TLS: в `.env` должен быть `COOKIE_SECURE=0`. За HTTPS — наоборот, не ставить |
| `JWT_SECRET must be set…` | В `.env` на сервере `NODE_ENV=production` и секрет ≥ 24 символов |
| Seed ругается на demo-админа | Не заданы `ADMIN_EMAIL` / `ADMIN_PASSWORD`, либо они demo-значения |
| `CREATEROLE` / доступ к БД из профиля | Учётка приложения в Postgres без права создавать роли — это не ломает обновление, только выдачу DBeaver |
| `npm ci` тянет сеть в офлайне | Нет `--offline` или кэш/lockfile от другой версии |
| Служба сразу падает | `journalctl -u hvp -n 80 --no-pager` |

---

## Краткий чеклист

**Интернет на сервере**

1. Backup dump  
2. `systemctl stop hvp`  
3. `git pull --ff-only`  
4. `npm ci`  
5. `prisma:migrate:deploy` → `prisma:seed` → `build`  
6. `systemctl start hvp`  
7. `curl` health + вход в UI  

**Без интернета**

1. На Linux с сетью: `npm ci` (+ лучше сразу `build`), архив без `.env`  
2. На сервере: backup dump, stop, сохранить `.env`, распаковать архив, вернуть `.env`  
3. Если в архиве не было `node_modules` под Linux: `npm ci --offline --cache …` и `build`  
4. migrate → seed → start → health  

Seed на обновлении — **без** `SEED_DEMO`. Справочники (`import:ref-data`) в штатное обновление не входят.
