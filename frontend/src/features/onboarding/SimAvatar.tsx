/**
 * SimAvatar — animated, 3D-looking SVG avatars used in onboarding.
 * Pure CSS/SVG (no WebGL) so they always load and stay lightweight,
 * but rendered with depth: gradients, soft shadows, floating idle motion,
 * and a Sims-style plumbob hovering above the head.
 */
import { CSSProperties } from "react";

export type AvatarKind =
  | "renter"
  | "buyer"
  | "landlord"
  | "explorer"   // openness
  | "planner"    // conscientiousness
  | "host"       // extraversion
  | "peacemaker" // agreeableness
  | "calm"       // neuroticism
  | "lifestyle"; // bundle step

interface Props {
  kind: AvatarKind;
  size?: number;
  className?: string;
}

const SKIN_TONES: Record<AvatarKind, { skin: string; hair: string; shirt: string; accent: string }> = {
  renter:     { skin: "#f5cfa8", hair: "#3a2a1f", shirt: "#a0e7e5", accent: "#ffd6e0" },
  buyer:      { skin: "#e8b890", hair: "#1f1410", shirt: "#ffd6e0", accent: "#a0e7e5" },
  landlord:   { skin: "#f0d2a8", hair: "#5a3a22", shirt: "#c9a84c", accent: "#5b6c8a" },
  explorer:   { skin: "#e8b890", hair: "#2d1810", shirt: "#86d3ff", accent: "#ffe066" },
  planner:    { skin: "#f5cfa8", hair: "#1a1a1a", shirt: "#b8a8e0", accent: "#a0e7e5" },
  host:       { skin: "#f0c098", hair: "#8b3a2a", shirt: "#ff9aa9", accent: "#ffe066" },
  peacemaker: { skin: "#eecaa0", hair: "#3a2818", shirt: "#a8e8c8", accent: "#ffd6e0" },
  calm:       { skin: "#f5d0b0", hair: "#4a3020", shirt: "#9ad8e8", accent: "#c8b8e8" },
  lifestyle:  { skin: "#e8b890", hair: "#2a1a14", shirt: "#ffb8a8", accent: "#a0e7e5" },
};

export function SimAvatar({ kind, size = 180, className = "" }: Props) {
  const c = SKIN_TONES[kind];
  const idleStyle: CSSProperties = { animation: "sim-idle 3.2s ease-in-out infinite" };
  const plumbobStyle: CSSProperties = { animation: "sim-plumbob 2.4s ease-in-out infinite", transformOrigin: "center" };

  return (
    <div className={`relative inline-block ${className}`} style={{ width: size, height: size }} aria-hidden>
      <style>{`
        @keyframes sim-idle {
          0%, 100% { transform: translateY(0) rotate(-1deg); }
          50%      { transform: translateY(-6px) rotate(1deg); }
        }
        @keyframes sim-plumbob {
          0%, 100% { transform: translateY(0) rotate(0deg) scale(1); }
          50%      { transform: translateY(-4px) rotate(180deg) scale(1.05); }
        }
        @keyframes sim-blink {
          0%, 92%, 100% { transform: scaleY(1); }
          95%           { transform: scaleY(0.1); }
        }
        @keyframes sim-shadow {
          0%, 100% { transform: scaleX(1); opacity: 0.35; }
          50%      { transform: scaleX(0.85); opacity: 0.25; }
        }
        .sim-eye { transform-box: fill-box; transform-origin: center; animation: sim-blink 4s infinite; }
        .sim-shadow { transform-origin: center; animation: sim-shadow 3.2s ease-in-out infinite; }
      `}</style>

      <svg viewBox="0 0 200 200" width={size} height={size}>
        <defs>
          <radialGradient id={`g-skin-${kind}`} cx="0.35" cy="0.3" r="0.9">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="40%" stopColor={c.skin} />
            <stop offset="100%" stopColor={shade(c.skin, -25)} />
          </radialGradient>
          <radialGradient id={`g-hair-${kind}`} cx="0.4" cy="0.3" r="0.9">
            <stop offset="0%" stopColor={shade(c.hair, 35)} />
            <stop offset="100%" stopColor={c.hair} />
          </radialGradient>
          <radialGradient id={`g-shirt-${kind}`} cx="0.3" cy="0.2" r="0.9">
            <stop offset="0%" stopColor={shade(c.shirt, 25)} />
            <stop offset="100%" stopColor={shade(c.shirt, -15)} />
          </radialGradient>
          <radialGradient id={`g-plumbob-${kind}`} cx="0.5" cy="0.3" r="0.6">
            <stop offset="0%" stopColor="#d8ffe6" />
            <stop offset="50%" stopColor="#5fe388" />
            <stop offset="100%" stopColor="#1a8a3d" />
          </radialGradient>
        </defs>

        {/* Ground shadow */}
        <ellipse cx="100" cy="188" rx="42" ry="6" fill="#000" className="sim-shadow" />

        {/* Floating body group */}
        <g style={idleStyle}>
          {/* Plumbob above head */}
          <g style={plumbobStyle} transform="translate(100 22)">
            <polygon points="0,-14 10,4 0,14 -10,4" fill={`url(#g-plumbob-${kind})`} stroke="#1a8a3d" strokeWidth="0.6" />
            <polygon points="0,-14 10,4 0,4" fill="#fff" opacity="0.35" />
          </g>

          {/* Torso / shirt */}
          <path
            d="M 60 130 Q 60 110 80 108 L 120 108 Q 140 110 140 130 L 145 175 Q 100 188 55 175 Z"
            fill={`url(#g-shirt-${kind})`}
            stroke={shade(c.shirt, -30)}
            strokeWidth="1.2"
          />
          {/* Collar accent */}
          <path d="M 85 110 Q 100 120 115 110 L 115 116 Q 100 124 85 116 Z" fill={c.accent} opacity="0.85" />

          {/* Neck */}
          <rect x="92" y="98" width="16" height="14" rx="4" fill={`url(#g-skin-${kind})`} />

          {/* Head */}
          <ellipse cx="100" cy="78" rx="32" ry="34" fill={`url(#g-skin-${kind})`} stroke={shade(c.skin, -35)} strokeWidth="0.8" />

          {/* Hair — varies subtly by kind */}
          {renderHair(kind, c)}

          {/* Cheeks */}
          <ellipse cx="80" cy="86" rx="6" ry="3.5" fill="#ff8aa0" opacity="0.45" />
          <ellipse cx="120" cy="86" rx="6" ry="3.5" fill="#ff8aa0" opacity="0.45" />

          {/* Eyes */}
          <g>
            <ellipse className="sim-eye" cx="88" cy="76" rx="3.2" ry="4.2" fill="#1a1a1a" />
            <ellipse className="sim-eye" cx="112" cy="76" rx="3.2" ry="4.2" fill="#1a1a1a" />
            <circle cx="89" cy="74.5" r="1" fill="#fff" />
            <circle cx="113" cy="74.5" r="1" fill="#fff" />
          </g>

          {/* Smile */}
          <path d="M 88 92 Q 100 100 112 92" stroke="#5a2a2a" strokeWidth="1.6" fill="none" strokeLinecap="round" />

          {/* Optional accessory by kind */}
          {renderAccessory(kind, c)}
        </g>
      </svg>
    </div>
  );
}

/* -------- helpers -------- */

function shade(hex: string, percent: number): string {
  const h = hex.replace("#", "");
  const num = parseInt(h, 16);
  let r = (num >> 16) + percent;
  let g = ((num >> 8) & 0x00ff) + percent;
  let b = (num & 0x0000ff) + percent;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function renderHair(kind: AvatarKind, c: { hair: string }) {
  const fill = `url(#g-hair-${kind})`;
  switch (kind) {
    case "renter":
    case "explorer":
      return <path d="M 70 60 Q 100 30 130 60 Q 134 76 128 84 Q 120 64 100 62 Q 80 64 72 84 Q 66 76 70 60 Z" fill={fill} />;
    case "buyer":
    case "planner":
      return <path d="M 68 62 Q 100 36 132 62 L 132 76 Q 116 66 100 66 Q 84 66 68 76 Z" fill={fill} />;
    case "landlord":
      return (
        <>
          <path d="M 70 62 Q 100 38 130 62 Q 132 74 126 80 Q 116 66 100 66 Q 84 66 74 80 Q 68 74 70 62 Z" fill={fill} />
          <ellipse cx="100" cy="50" rx="36" ry="10" fill={c.hair} opacity="0.6" />
        </>
      );
    case "host":
      return <path d="M 66 64 Q 100 28 134 64 Q 138 90 124 100 Q 120 70 100 66 Q 80 70 76 100 Q 62 90 66 64 Z" fill={fill} />;
    case "peacemaker":
      return <path d="M 72 60 Q 100 40 128 60 Q 130 70 126 78 Q 116 68 100 68 Q 84 68 74 78 Q 70 70 72 60 Z" fill={fill} />;
    case "calm":
      return <path d="M 70 64 Q 100 38 130 64 Q 132 78 124 86 Q 118 70 100 68 Q 82 70 76 86 Q 68 78 70 64 Z" fill={fill} />;
    case "lifestyle":
      return <path d="M 68 62 Q 100 32 132 62 Q 136 84 122 96 Q 118 70 100 66 Q 82 70 78 96 Q 64 84 68 62 Z" fill={fill} />;
  }
}

function renderAccessory(kind: AvatarKind, c: { accent: string }) {
  switch (kind) {
    case "landlord":
      // tiny key
      return (
        <g transform="translate(138 132) rotate(20)">
          <circle cx="0" cy="0" r="6" fill="none" stroke={c.accent} strokeWidth="2.5" />
          <rect x="5" y="-1.5" width="14" height="3" fill={c.accent} />
          <rect x="14" y="-1.5" width="2" height="6" fill={c.accent} />
        </g>
      );
    case "explorer":
      // compass dot
      return <circle cx="100" cy="148" r="6" fill={c.accent} stroke="#fff" strokeWidth="1.5" />;
    case "planner":
      // pocket clipboard rectangle
      return <rect x="92" y="138" width="16" height="20" rx="2" fill={c.accent} stroke="#fff" strokeWidth="1" />;
    case "host":
      // party confetti
      return (
        <g>
          <circle cx="56" cy="40" r="3" fill="#ffe066" />
          <circle cx="148" cy="46" r="3" fill="#ff8aa0" />
          <circle cx="40" cy="100" r="2.5" fill="#a0e7e5" />
          <circle cx="160" cy="110" r="2.5" fill="#c8b8e8" />
        </g>
      );
    case "peacemaker":
      // little heart
      return <path d="M 100 142 l -4 -4 a 3 3 0 1 1 4 -4 a 3 3 0 1 1 4 4 z" fill={c.accent} />;
    case "calm":
      // zen leaf
      return <path d="M 100 145 q 6 -10 12 0 q -6 10 -12 0 z" fill={c.accent} />;
    default:
      return null;
  }
}
