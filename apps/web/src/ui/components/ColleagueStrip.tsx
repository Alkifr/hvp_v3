import { useEffect, useState } from "react";

import { peersOnPage, subscribePeers, type LivePeer } from "../../lib/liveSync";

export function ColleagueStrip(props: { page: "gantt" | "hangar"; selfId: string }) {
  const [peers, setPeers] = useState<LivePeer[]>(() => peersOnPage(props.page, props.selfId));

  useEffect(() => {
    const refresh = () => setPeers(peersOnPage(props.page, props.selfId));
    refresh();
    const stop = subscribePeers(refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      stop();
      window.clearInterval(timer);
    };
  }, [props.page, props.selfId]);

  if (peers.length === 0) return null;
  const label = peers.map((peer) => peer.displayName).join(", ");
  return (
    <div className="colleagueStrip" role="status">
      <span className="muted">Сейчас здесь:</span>
      {peers.map((peer) => (
        <span key={peer.userId} className="colleagueChip" title={peer.eventId ? "Открыта карточка события" : undefined}>
          {peer.displayName}
        </span>
      ))}
      <span className="srOnly">{label}</span>
    </div>
  );
}
