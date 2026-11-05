"use client";

import { useState } from "react";

/** Seek bar over the whole playlist. Commits once on release (a drag would otherwise reload parts continuously). */
export function CounselSeekBar({
  value,
  onCommit,
  label,
  className = "",
}: {
  /** 0..1 */
  value: number;
  onCommit: (v: number) => void;
  label: string;
  className?: string;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const commit = () => {
    if (drag !== null) onCommit(drag);
    setDrag(null);
  };
  return (
    <input
      type="range"
      min={0}
      max={1000}
      step={1}
      value={Math.round(Math.min(1, Math.max(0, shown)) * 1000)}
      aria-label={label}
      onChange={(e) => setDrag(Number(e.target.value) / 1000)}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
      className={`w-full cursor-pointer accent-[var(--color-primary)] ${className}`}
    />
  );
}
