/**
 * Zero-library map (README §10 rule 7): equirectangular projection around `center`, rings at the wave radii.
 * Coordinates are real; the background is a stylised street grid from the Figma design.
 */
type Pt = { lat: number; lng: number };
export type MapMarker = { id: string; at: Pt; color: string; label?: string; kind: "helper" | "request" | "you" | "target"; pulse?: boolean; ring?: string };

export function LiveMap({ center, radiusKm, markers, rings = [], height = 200, route, className = "" }: {
  center: Pt; radiusKm: number; markers: MapMarker[]; rings?: number[]; height?: number; route?: [Pt, Pt]; className?: string;
}) {
  const W = 400, H = 300;
  const kmPerPx = (radiusKm * 2) / Math.min(W, H);
  const cos = Math.cos((center.lat * Math.PI) / 180);
  const xy = (p: Pt) => ({ x: W / 2 + ((p.lng - center.lng) * 111.32 * cos) / kmPerPx, y: H / 2 - ((p.lat - center.lat) * 111.32) / kmPerPx });
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ height, background: "linear-gradient(145deg, #dbeafe 0%, #e0f2fe 40%, #bfdbfe 100%)" }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" role="img" aria-label="Map">
        <g opacity=".18" stroke="#1E3A5F" fill="none">
          <path d="M0 150 Q100 120 200 150 T400 130" strokeWidth="8" /><path d="M150 0 Q180 100 160 150 Q140 200 170 300" strokeWidth="6" />
          <path d="M0 220 Q80 200 160 220 T400 200" strokeWidth="5" /><path d="M50 0 Q70 80 60 150 Q50 220 80 300" strokeWidth="4" />
          <path d="M280 0 Q300 100 290 150 Q280 200 310 300" strokeWidth="4" />
        </g>
        {rings.map((r) => (
          <g key={r}>
            <circle cx={W / 2} cy={H / 2} r={r / kmPerPx} fill="none" stroke="#1E3A5F" strokeOpacity=".25" strokeDasharray="4 4" />
            <text x={W / 2 + r / kmPerPx - 4} y={H / 2 - 4} fontSize="10" textAnchor="end" fill="#1E3A5F" opacity=".5">{r} km</text>
          </g>
        ))}
        {route && (() => { const a = xy(route[0]), b = xy(route[1]); return (
          <path d={`M${a.x},${a.y} Q${(a.x + b.x) / 2 + 30},${(a.y + b.y) / 2 - 30} ${b.x},${b.y}`} stroke="#16A34A" strokeWidth="3" fill="none" strokeDasharray="7 5" />
        ); })()}
        {markers.map((m) => {
          const p = xy(m.at);
          if (m.kind === "helper") return (
            <g key={m.id}>
              {m.ring && <circle cx={p.x} cy={p.y} r="9" fill="none" stroke={m.ring} strokeWidth="2.5" />}
              <circle cx={p.x} cy={p.y} r="5.5" fill={m.color} stroke="white" strokeWidth="1.5"><title>{m.label}</title></circle>
            </g>
          );
          return (
            <g key={m.id}>
              {m.pulse !== false && <circle cx={p.x} cy={p.y} r="6" fill={m.color} className="marker-pulse" />}
              <circle cx={p.x} cy={p.y} r="8" fill={m.color} stroke="white" strokeWidth="2.5"><title>{m.label}</title></circle>
              {m.label && m.kind !== "request" && (
                <g><rect x={p.x - 24} y={p.y - 30} width="48" height="17" rx="8.5" fill={m.color} />
                  <text x={p.x} y={p.y - 18} fontSize="10" fontWeight="700" textAnchor="middle" fill="white">{m.label}</text></g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
