import { type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "quiet" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-cobalt text-white hover:bg-[#1f3bb3] disabled:bg-ink-3",
  quiet: "bg-paper text-ink border border-line-2 hover:border-ink-3 disabled:text-ink-3",
  ghost: "text-ink-2 hover:text-ink hover:bg-black/5 disabled:text-ink-3",
  danger: "text-brick border border-brick/40 hover:bg-brick-soft",
};

export function Button({
  variant = "quiet",
  size = "md",
  busy,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; busy?: boolean }) {
  const sz = size === "sm" ? "text-[13px] px-2.5 py-1" : "text-sm px-3.5 py-1.5";
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed ${sz} ${VARIANTS[variant]} ${className}`}
    >
      {busy ? <span className="thinking">Thinking…</span> : children}
    </button>
  );
}

export function Tag({ tone = "plain", children, title }: { tone?: "plain" | "cobalt" | "amber" | "brick"; children: ReactNode; title?: string }) {
  const tones = {
    plain: "bg-ground text-ink-2",
    cobalt: "bg-cobalt-soft text-cobalt",
    amber: "bg-amber-soft text-amber",
    brick: "bg-brick-soft text-brick",
  };
  return (
    <span title={title} className={`inline-flex items-center rounded px-1.5 py-[1px] text-[12px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function TineMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <path d="M16 30V14M16 14L7 3M16 14l9-11M16 14V3" stroke="currentColor" strokeWidth="3.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function download(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
