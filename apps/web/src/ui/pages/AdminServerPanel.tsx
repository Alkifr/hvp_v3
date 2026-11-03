import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { apiGet } from "../../lib/api";

type StatusLevel = "ok" | "warn" | "down" | "unknown";

type ServerStatus = {
  ok: true;
  collectedAt: string;
  process: {
    pid: number;
    node: string;
    uptimeSec: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    level: StatusLevel;
    note: string | null;
  };
  host: {
    hostname: string;
    platform: string;
    arch: string;
    cpuCount: number;
    loadAvg: [number, number, number];
    memTotalBytes: number;
    memFreeBytes: number;
    uptimeSec: number;
    level: StatusLevel;
    note: string | null;
  };
  disk: {
    path: string;
    totalBytes: number | null;
    freeBytes: number | null;
    level: StatusLevel;
    note: string | null;
  };
  database: {
    connected: boolean;
    latencyMs: number | null;
    name: string | null;
    sizeBytes: number | null;
    connections: number | null;
    version: string | null;
    level: StatusLevel;
    note: string | null;
  };
};

const LEVEL_LABEL: Record<StatusLevel, string> = {
  ok: "в норме",
  warn: "внимание",
  down: "недоступно",
  unknown: "нет данных"
};

function formatBytes(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let value = n;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = index === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${mins} мин`;
  if (mins > 0) return `${mins} мин`;
  return `${total} с`;
}

function formatPercent(part: number | null, total: number | null): string {
  if (part == null || total == null || !(total > 0)) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Metric(props: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={props.wide ? "adminServerMetricWide" : undefined}>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

function StatusCard(props: { title: string; level: StatusLevel; note: string | null; children: ReactNode }) {
  return (
    <section className={`card adminPanel adminServerCard adminServerCard-${props.level}`}>
      <div className="adminSectionHead">
        <strong>{props.title}</strong>
        <span className="adminServerLevel">{LEVEL_LABEL[props.level]}</span>
      </div>
      <dl className="adminServerMetrics">{props.children}</dl>
      {props.note ? <p className="adminServerNote">{props.note}</p> : null}
    </section>
  );
}

export function AdminServerPanel() {
  const statusQ = useQuery({
    queryKey: ["admin", "server"],
    queryFn: () => apiGet<ServerStatus>("/api/admin/server"),
    refetchInterval: 5000
  });
  const data = statusQ.data;

  return (
    <div className="adminServerLayout">
      <section className="card adminPanel">
        <div className="adminSectionHead">
          <div>
            <strong>Состояние сервера</strong>
            <div className="muted adminHint">Процесс, машина, диск приложения и база. Обновление каждые 5 секунд.</div>
          </div>
          <span className="muted adminHint">{data ? `снято в ${formatWhen(data.collectedAt)}` : "снимаем показания…"}</span>
        </div>
        {statusQ.error && !data ? <div className="error">{String(statusQ.error.message || statusQ.error)}</div> : null}
        {statusQ.error && data ? <div className="error">Не удалось обновить показания. На экране предыдущий снимок.</div> : null}
      </section>

      {data ? (
        <div className="adminServerGrid">
          <StatusCard title="Процесс" level={data.process.level} note={data.process.note}>
            <Metric label="Node" value={data.process.node} />
            <Metric label="PID" value={String(data.process.pid)} />
            <Metric label="Аптайм" value={formatDuration(data.process.uptimeSec)} />
            <Metric label="Память (RSS)" value={formatBytes(data.process.rssBytes)} />
            <Metric label="Куча" value={`${formatBytes(data.process.heapUsedBytes)} / ${formatBytes(data.process.heapTotalBytes)}`} wide />
          </StatusCard>

          <StatusCard title="Машина" level={data.host.level} note={data.host.note}>
            <Metric label="Хост" value={data.host.hostname} />
            <Metric label="Система" value={`${data.host.platform} ${data.host.arch}`} />
            <Metric label="Ядра" value={String(data.host.cpuCount)} />
            <Metric label="Аптайм" value={formatDuration(data.host.uptimeSec)} />
            <Metric
              label="Нагрузка 1 / 5 / 15 мин"
              value={data.host.loadAvg.map((n) => n.toFixed(2)).join(" / ")}
              wide
            />
            <Metric
              label="Память свободна"
              value={`${formatBytes(data.host.memFreeBytes)} из ${formatBytes(data.host.memTotalBytes)} (${formatPercent(data.host.memFreeBytes, data.host.memTotalBytes)})`}
              wide
            />
          </StatusCard>

          <StatusCard title="Диск" level={data.disk.level} note={data.disk.note}>
            <Metric label="Каталог приложения" value={data.disk.path} wide />
            <Metric label="Свободно" value={formatBytes(data.disk.freeBytes)} />
            <Metric label="Всего" value={formatBytes(data.disk.totalBytes)} />
            <Metric label="Свободно, %" value={formatPercent(data.disk.freeBytes, data.disk.totalBytes)} />
          </StatusCard>

          <StatusCard title="База" level={data.database.level} note={data.database.note}>
            <Metric label="Имя" value={data.database.name ?? "—"} />
            <Metric label="Версия" value={data.database.version ?? "—"} />
            <Metric label="Ответ" value={data.database.latencyMs == null ? "—" : `${data.database.latencyMs} мс`} />
            <Metric label="Размер" value={formatBytes(data.database.sizeBytes)} />
            <Metric label="Соединения" value={data.database.connections == null ? "—" : String(data.database.connections)} />
            <Metric label="Связь" value={data.database.connected ? "есть" : "нет"} />
          </StatusCard>
        </div>
      ) : null}
    </div>
  );
}
