interface Props {
  className?: string;
}
export function Plumbob({ className }: Props) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="pbg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(145 90% 70%)" />
          <stop offset="100%" stopColor="hsl(145 70% 40%)" />
        </linearGradient>
      </defs>
      <polygon points="32,4 56,32 32,60 8,32" fill="url(#pbg)" stroke="hsl(145 60% 30%)" strokeWidth="1.5" strokeLinejoin="round" />
      <polygon points="32,4 32,60 8,32" fill="hsl(145 90% 80% / 0.35)" />
      <circle cx="22" cy="22" r="3.5" fill="white" opacity="0.85" />
    </svg>
  );
}
