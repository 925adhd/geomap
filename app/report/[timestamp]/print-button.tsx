"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rp-print-btn">
      Print / Save as PDF
    </button>
  );
}
