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

## HTTPS: https://hvp.atechnics.ru (порт 443, только корпсеть)

Пока корпоративного сертификата нет — **самоподписанный**. Браузер покажет предупреждение («небезопасно») — это нормально: «Дополнительно» → «Перейти на сайт». Cookie и `HOST` пока **не меняйте**, HTTP :3000 останется запасным входом.

### 0. Имя должно резолвиться

Нужна A-запись `hvp.atechnics.ru` → `10.50.24.227`. Пока DNS нет — на своей рабочей машине в `/etc/hosts` (Windows: `C:\Windows\System32\drivers\etc\hosts`):

```text
10.50.24.227  hvp.atechnics.ru
```

Без этого в адресной строке `https://hvp.atechnics.ru` не откроется, даже если nginx уже слушает.

### 1. На srv-fin-02v

```bash
cd /opt/hvp_v3
sudo -u hvp -H env PATH="/usr/local/bin:$PATH" git pull
sudo bash /opt/hvp_v3/deploy/setup-selfsigned-https.sh
curl -skI --resolve hvp.atechnics.ru:443:127.0.0.1 https://hvp.atechnics.ru/health/ready
```

Ожидание: `HTTP/2 200` или `HTTP/1.1 200`.

С рабочей станции: `https://hvp.atechnics.ru` → предупреждение → перейти на сайт.

Файрвол: **443/tcp** с рабочих сетей до `srv-fin-02v`.

### 2. Когда выдадут нормальный сертификат УЦ

Заменить файлы `/etc/ssl/certs/hvp.atechnics.ru.crt` и `/etc/ssl/private/hvp.atechnics.ru.key`, `sudo nginx -t && sudo systemctl reload nginx`. После этого в `.env` можно `HOST=127.0.0.1` и убрать `COOKIE_SECURE=0`, затем `sudo systemctl restart hvp`.
