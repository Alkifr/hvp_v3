# Обновление стенда в корпоративном контуре

Документ для администратора. Команды ниже рассчитаны на **новичка** и на контур без интернета на боевом сервере.

Подставьте свои имена, если они другие:

| Что | Пример в этом документе |
|---|---|
| Каталог приложения | `/opt/hvp_v3` |
| Пользователь службы | `hvp` |
| systemd unit | `hvp.service` |
| Репозиторий | https://github.com/Alkifr/hvp_v3 |
| Сборка | Ubuntu x86_64 с интернетом, Node **20+** |
| Боевой сервер | Astra Linux **без интернета** |
| БД | PostgreSQL **16**, часто на **другом** хосте |

`.env` при обновлении **не перезаписывать** и **не копировать** с машины разработчика.

Сообщение Astra «Операционная система не активирована» на команды не влияет — его можно игнорировать.

---

## Карта машин (закрытый контур)

Типовой путь файла:

**Ubuntu (интернет, сборка)** → **Mac (скачать архив)** → **рабочий ПК / Windows jump** → **Astra (установка)**.

| Машина | Интернет | Роль |
|---|---|---|
| Ubuntu | да | `git clone`, `npm ci`, `build`, `.tgz` |
| Mac | да | веб-консоль Ubuntu и/или `scp` архива |
| Windows jump (js) | обычно нет | единственный вход во внутреннюю сеть |
| Astra (приложение) | нет | Node, `hvp.service`, UI/API :3000 |
| Хост PostgreSQL | внутренняя сеть | базу **не останавливать** |

`node_modules` **нельзя** собирать на macOS/Windows и класть на Astra (`argon2`, движки Prisma).

Архив **не открывать** 7-Zip/WinRAR, **не** переименовывать `.tgz` → `.tar`, **не** перепаковывать. Иначе `tar` даст «неожиданный конец файла».

OpenSSL 3.0.x на Ubuntu и 3.4.x на Astra совместимы. Перед `npm ci` на Ubuntu:

```bash
export PRISMA_CLI_BINARY_TARGETS="debian-openssl-3.0.x"
```

---

## Чего не делать

| Действие | Почему |
|---|---|
| `SEED_DEMO=1` / `prisma:seed:demo` | Демо-учётки на боевой базе |
| `CONFIRM_TRUNCATE=1 import:ref-data` | Снесёт справочники |
| Менять `.env` «как в примере» | Сбросит JWT, CORS, cookie, пароль БД |
| Копировать `node_modules` с Mac/Windows | Нативные модули не подойдут |
| `sudo -u hvp cp … /opt/….bak` | У `hvp` нет права создавать каталоги в `/opt` |
| Собирать архив, не проверив `gzip -t` | Битый файл доедет до Astra |
| Останавливать PostgreSQL | Приложение и БД часто на разных серверах |

---

## Вариант A. На сервере приложения есть интернет

Нужен git и npm registry.

```bash
cd /opt/hvp_v3
sudo systemctl stop hvp

sudo -u hvp -H env PATH="/usr/local/bin:$PATH" git fetch --all --tags
sudo -u hvp -H env PATH="/usr/local/bin:$PATH" git rev-parse --short HEAD
sudo -u hvp -H env PATH="/usr/local/bin:$PATH" git pull --ff-only
sudo -u hvp -H env PATH="/usr/local/bin:$PATH" npm ci
```

Дальше: backup (см. ниже) уже должен быть снят **до** stop, затем migrate → seed → build → start → health.

Если git есть, а npm registry закрыт — код через `git pull`, зависимости как в варианте B (Linux-архив).

---

## Вариант B. Astra без интернета (основной сценарий)

### B1. Ubuntu: клон и сборка

Заходите в домашний каталог. `Permission denied` на `git clone` значит, что вы не в `~` (часто `/` или `/opt`).

```bash
cd ~
uname -m          # нужно x86_64
node -v           # v20 или новее
df -h ~           # свободно гигабайты, не десятки мегабайт
```

Если Node нет:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git python3 make g++
```

```bash
cd ~
rm -rf hvp_release
git clone https://github.com/Alkifr/hvp_v3.git hvp_release
cd hvp_release
git rev-parse --short HEAD > VERSION.txt
git log -1 --oneline

export PRISMA_CLI_BINARY_TARGETS="debian-openssl-3.0.x"
npm ci
npm run build
```

Проверка сборки:

```bash
ls package.json node_modules apps/api/dist apps/web/dist
```

Архив **без** `.env`, `.git` и `backups`:

```bash
rm -f ~/hvp-*-linux.tgz
tar --exclude='.env' --exclude='.env.*' --exclude='backups' --exclude='.git' \
  -czf ~/hvp-$(cat VERSION.txt)-linux.tgz .
ls -lh ~/hvp-*-linux.tgz
gzip -t ~/hvp-*-linux.tgz && echo "gzip ok"
sha256sum ~/hvp-*-linux.tgz
```

**Пока нет `gzip ok` — никуда не копируйте.** Битый архив на Ubuntu уже встречался (размер «плавал», `gzip: unexpected end of file`). Тогда удалите `.tgz` и повторите только `tar` (если `node_modules` и `dist` на месте).

Запишите имя файла, размер и sha256.

Python `http.server` на произвольном порту с облачной ВМ обычно **не открывается** с Mac: группу безопасности не расширяйте ради этого. `transfer.sh` часто недоступен (`Connection refused`).

### B2. Ubuntu → Mac

На Mac в zsh маска `*` раскрывается **локально**. Пишите имя целиком или кавычки:

```bash
scp user_prod@UBUNTU_IP:~/hvp-XXXX-linux.tgz ~/Downloads/
```

или:

```bash
scp 'user_prod@UBUNTU_IP:~/hvp-*-linux.tgz' ~/Downloads/
```

`Permission denied (publickey)` — на Ubuntu нет ключа **этого** Mac. В веб-консоли Ubuntu **добавьте** строку из `~/.ssh/id_ed25519.pub` (или `id_rsa.pub`) в `~/.ssh/authorized_keys` **новой строкой**, старый ключ с другого Mac не удаляйте:

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys   # в конец — один ключ = одна строка
chmod 600 ~/.ssh/authorized_keys
```

Если SSH с Mac нельзя — GitHub Release (репозиторий публичный: после скачивания релиз удалите).

Токен: https://github.com/settings/tokens (настройки **аккаунта**, не репозитория). Classic PAT: `repo`, `read:org`, `workflow`.

```bash
gh auth login
gh release create "offline-XXXX" ~/hvp-XXXX-linux.tgz \
  --repo Alkifr/hvp_v3 --title "Offline linux XXXX" --notes "Без .env"
```

Скачать с https://github.com/Alkifr/hvp_v3/releases на Mac. Удалить:

```bash
gh release delete "offline-XXXX" --repo Alkifr/hvp_v3 --yes
```

На Mac сверьте размер и хеш с Ubuntu:

```bash
ls -lh ~/Downloads/hvp-XXXX-linux.tgz
shasum -a 256 ~/Downloads/hvp-XXXX-linux.tgz
```

### B3. Mac → Windows jump → Astra

На Windows файл не открывать. Класть как есть, например `C:\p_dev\hvp_releases\hvp-XXXX-linux.tgz`.

```powershell
Get-Item C:\p_dev\hvp_releases\hvp-XXXX-linux.tgz | Select-Object Name, Length
Get-FileHash C:\p_dev\hvp_releases\hvp-XXXX-linux.tgz -Algorithm SHA256
```

`Length` и хеш = как на Ubuntu. Иначе копируйте заново.

На Astra (подставьте пользователя и хост):

```powershell
scp C:\p_dev\hvp_releases\hvp-XXXX-linux.tgz USER@ASTRA_HOST:/tmp/
```

В WinSCP режим **Binary**, не Text.

На Astra:

```bash
ls -lh /tmp/hvp-XXXX-linux.tgz
sha256sum /tmp/hvp-XXXX-linux.tgz
gzip -t /tmp/hvp-XXXX-linux.tgz && echo "gzip ok"
file /tmp/hvp-XXXX-linux.tgz
```

Нужно: тот же размер и sha256, `gzip ok`, `file` говорит `gzip compressed data` **без** FAT/encrypted.  
`gzip: stdin: not in gzip format` — это не gzip (часто обрезанный или пересохранённый `.tar`).  
`tar: Неожиданный конец файла` — файл обрезан, распаковку прекратить.

### B4. Backup и остановка на Astra

Окно работ; в админке можно включить «только просмотр». PostgreSQL **не** останавливать.

`?schema=public` в `DATABASE_CLOUD_URL` нужен Prisma. **`pg_dump` его не понимает** (`неверный параметр в URI: "schema"`). Отрезайте хвост после `?`:

```bash
sudo -u hvp -H bash -lc 'cd /opt/hvp_v3 && set -a && . ./.env && set +a && mkdir -p backups && pg_dump -Fc "${DATABASE_CLOUD_URL%%\?*}" > "backups/hvp-$(date +%Y%m%d-%H%M%S).dump"'
ls -lh /opt/hvp_v3/backups/
```

Dump не нулевого размера. Без него дальше не идите.

```bash
cd /opt/hvp_v3
sudo -u hvp git rev-parse --short HEAD 2>/dev/null || echo "git на сервере не обязателен"
sudo systemctl stop hvp
```

Копию каталога в `/opt` делает **root**, не `sudo -u hvp` (`Отказано в доступе`):

```bash
sudo cp -a /opt/hvp_v3 /opt/hvp_v3.bak-$(date +%Y%m%d-%H%M%S)
sudo cp /opt/hvp_v3/.env /tmp/hvp.env.save
sudo chown hvp:hvp /tmp/hvp.env.save
ls -ld /opt/hvp_v3.bak-*
```

### B5. Распаковка

```bash
cd /opt/hvp_v3
sudo tar -xzf /tmp/hvp-XXXX-linux.tgz
sudo cp /tmp/hvp.env.save /opt/hvp_v3/.env
sudo chown -R hvp:hvp /opt/hvp_v3
sudo -u hvp test -f /opt/hvp_v3/.env && echo "env ok"
ls /opt/hvp_v3/apps/api/dist /opt/hvp_v3/apps/web/dist /opt/hvp_v3/node_modules >/dev/null && echo "tree ok"
```

Если предыдущий `tar` оборвался — сначала верните `bak`, потом распаковывайте снова. В архиве уже Linux-`node_modules` и `dist`: **`npm ci` и `build` на Astra не нужны**.

Если `file` сказал обычный `tar archive` (не gzip) — только тогда `sudo tar -xf`, не `-xzf`. Для штатного `.tgz` всегда `-xzf`.

### B6. Миграции, seed, запуск

```bash
cd /opt/hvp_v3
sudo -u hvp -H env PATH="/usr/local/bin:$PATH" npm run prisma:migrate:deploy -w apps/api
sudo -u hvp -H env PATH="/usr/local/bin:$PATH" npm run prisma:seed -w apps/api
sudo systemctl start hvp
sudo systemctl status hvp --no-pager
curl -sf http://127.0.0.1:3000/health/ready && echo OK
```

- **migrate** обязателен.
- **seed без `SEED_DEMO`** обновляет роли и права, **не** сбрасывает пароли существующих пользователей.
- Дальше вход в UI, Гантт; снять техрежим, если включали.

#### Если migrate: `P1001 Can't reach database server`

Приложение и Postgres часто на разных хостах (например 02v и 03v). Сначала сеть:

```bash
getent hosts ИМЯ_ХОСТА_БД
ping -c 2 ИМЯ_ХОСТА_БД
timeout 5 bash -c 'echo > /dev/tcp/ИМЯ_ХОСТА_БД/5432' && echo "port 5432 open"
```

Проверка **от пользователя `hvp`** (не от вашего логина):

```bash
sudo -u hvp -H bash -lc 'timeout 5 bash -c "echo > /dev/tcp/ИМЯ_ХОСТА_БД/5432" && echo "hvp: port open" || echo "hvp: port closed"'
sudo -u hvp -H bash -lc 'cd /opt/hvp_v3 && set -a && . ./.env && set +a && psql "${DATABASE_CLOUD_URL%%\?*}" -c "SELECT 1"'
```

Если `SELECT 1` проходит — повторите migrate. При спецсимволах в пароле (`:`, `)`, `@`) Prisma иногда даёт P1001, хотя `psql` уже работает. Одноразово, без правки `.env`:

```bash
cd /opt/hvp_v3
sudo -u hvp -H bash -lc 'set -a && . ./.env && set +a
export PATH="/usr/local/bin:$PATH"
export DATABASE_CLOUD_URL="$(python3 - <<"PY"
import os
from urllib.parse import urlparse, quote, urlunparse
u = os.environ["DATABASE_CLOUD_URL"]
p = urlparse(u)
password = quote(p.password or "", safe="")
netloc = f"{p.username}:{password}@{p.hostname}"
if p.port:
    netloc += f":{p.port}"
print(urlunparse((p.scheme, netloc, p.path, p.params, p.query, p.fragment)))
PY
)"
cd /opt/hvp_v3 && npm run prisma:migrate:deploy -w apps/api'
```

`.env` «наугад» не меняйте. На хосте БД: `systemctl status postgresql` (или `postgresql-16`), `ss -tlnp | grep 5432`.

---

## Откат

```bash
sudo systemctl stop hvp
sudo mv /opt/hvp_v3 /opt/hvp_v3.broken
sudo mv /opt/hvp_v3.bak-ГГГГММДД-ЧЧММСС /opt/hvp_v3
```

Если migrate уже прошёл и новая версия не стартует — restore dump, снятого **до** обновления (`?schema=` снова отрезать):

```bash
sudo -u hvp -H bash -lc 'cd /opt/hvp_v3 && set -a && . ./.env && set +a && pg_restore --clean --if-exists --no-owner -d "${DATABASE_CLOUD_URL%%\?*}" backups/hvp-….dump'
```

Миграции Prisma «назад» вручную не откатывайте.

```bash
sudo systemctl start hvp
curl -sf http://127.0.0.1:3000/health/ready && echo OK
```

---

## Частые сбои

| Симптом | Что проверить |
|---|---|
| `git clone` Permission denied | `cd ~`, не клонировать в `/` и `/opt` без root |
| zsh: no matches found при scp | имя файла целиком или путь в кавычках |
| scp: Permission denied (publickey) | ключ **этого** Mac в `authorized_keys` |
| `неверный параметр в URI: schema` | `pg_dump`/`pg_restore`: `"${DATABASE_CLOUD_URL%%\?*}"` |
| `cp: Отказано в доступе` на `*.bak` в `/opt` | `sudo cp -a`, не `sudo -u hvp` |
| `gzip: not in gzip format` | не тот файл или переименованный tar; смотреть `file` |
| `tar: Неожиданный конец файла` | архив обрезан; сверить sha256 на всех хостах |
| `file` пишет FAT/encrypted | архив трогали на Windows; везти исходный `.tgz` |
| P1001 Prisma | порт 5432, `psql` от `hvp`, кодирование пароля в URL |
| `health/ready` 503 | Postgres, `.env`, сеть до БД |
| Белая страница / старый UI | нет `dist` в архиве или службу не перезапустили |
| Cookie не держится | HTTP: `COOKIE_SECURE=0`. HTTPS: наоборот |
| Служба сразу падает | `journalctl -u hvp -n 80 --no-pager` |

---

## Краткий чеклист без интернета на Astra

1. Ubuntu: clone в `~` → `PRISMA_CLI_BINARY_TARGETS` → `npm ci` → `build` → `tar` → **`gzip -t` + sha256**
2. Mac: `scp` (кавычки / точное имя) или GitHub Release
3. Windows: только копия, Binary, тот же sha256
4. Astra `/tmp`: sha256 и `gzip -t`
5. Dump БД с отрезанным `?schema=`
6. `systemctl stop hvp` (Postgres не трогать)
7. `sudo cp -a` в `/opt/hvp_v3.bak-…`, сохранить `.env`
8. `sudo tar -xzf`, вернуть `.env`, `chown hvp:hvp`
9. `prisma:migrate:deploy` → `prisma:seed` (без `SEED_DEMO`) → `systemctl start` → `/health/ready`

Seed на обновлении — **без** `SEED_DEMO`. Справочники (`import:ref-data`) в штатное обновление не входят.
