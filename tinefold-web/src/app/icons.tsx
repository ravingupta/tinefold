/** Small line icons. Stroke follows currentColor. */
type Name = "comment" | "progress" | "document" | "exit" | "focus" | "pencil" | "outcome";

const PATHS: Record<Name, string> = {
  comment: "M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z",
  progress: "M5 7h2M5 12h2M5 17h2M10 7h9M10 12h9M10 17h9",
  document: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  exit: "M9 5H5v14h4M14 8l5 4-5 4M19 12H9",
  focus: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  pencil: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  outcome: "M12 3v3M12 10v4M12 18v3M8 6h8M8 14h8M8 10h8",
};

export function Icon({ name, className = "size-[18px]" }: { name: Name; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
