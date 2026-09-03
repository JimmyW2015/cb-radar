import "./DualRange.css";

interface Props {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  formatLabel?: (n: number) => string;
}

export function DualRange({ min, max, step = 1, value, onChange, formatLabel }: Props) {
  const [lo, hi] = value;
  const fmt = formatLabel ?? ((n: number) => String(n));

  function setLo(next: number) {
    onChange([Math.min(next, hi), hi]);
  }
  function setHi(next: number) {
    onChange([lo, Math.max(next, lo)]);
  }

  const loPct = ((lo - min) / (max - min)) * 100;
  const hiPct = ((hi - min) / (max - min)) * 100;

  return (
    <div className="dual-range">
      <div className="dual-range-track">
        <div className="dual-range-fill" style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }} />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={lo}
        onChange={(e) => setLo(Number(e.target.value))}
        aria-label="下限"
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={hi}
        onChange={(e) => setHi(Number(e.target.value))}
        aria-label="上限"
      />
      <div className="dual-range-labels">
        <span>{fmt(lo)}</span>
        <span>{fmt(hi)}</span>
      </div>
    </div>
  );
}
