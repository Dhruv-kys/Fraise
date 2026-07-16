// The mark and the icon set.
//
// Emoji were doing this job before. They render differently on every OS, ignore
// brand color, and sit at whatever optical weight the vendor chose — which is
// why a UI full of them never looks designed. These are one family: 24px grid,
// 1.6 stroke, round caps, currentColor.

type IconName =
  | "math"
  | "remember"
  | "recall"
  | "web"
  | "doc"
  | "search";

const PATHS: Record<IconName, React.ReactNode> = {
  math: (
    <>
      <rect x="3.75" y="3" width="16.5" height="18" rx="3" />
      <path d="M8 8h8M8 13h2.5M13.5 13h2.5M8 17h2.5M13.5 17h2.5" />
    </>
  ),
  remember: <path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.8L6 20V5.5a1 1 0 0 1 1-1z" />,
  recall: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
  web: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5a13 13 0 0 1 0 17M12 3.5a13 13 0 0 0 0 17" />
    </>
  ),
  doc: (
    <>
      <path d="M13.8 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8.2z" />
      <path d="M13.8 3v5.2H19" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.6" />
      <path d="M15.6 15.6 20 20" />
    </>
  ),
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

export type { IconName };

export function GitHubMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="15" height="15">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.13-.3-.54-1.53.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

// Fraise = strawberry. Drawn rather than typed: a calyx of three leaves over a
// berry, seeds in the page's ivory. Two-tone so it survives both themes.
export function FraiseMark({ className = "" }: { className?: string }) {
  return (
    <svg className={`fraise-mark ${className}`} viewBox="0 0 32 32" aria-hidden="true">
      <path className="mark-stem" d="M16 6.4V2.8" strokeWidth="1.6" strokeLinecap="round" />
      <g className="mark-leaf">
        <ellipse cx="16" cy="7.2" rx="4.8" ry="1.75" transform="rotate(-38 16 7.2)" />
        <ellipse cx="16" cy="7.2" rx="4.8" ry="1.75" transform="rotate(38 16 7.2)" />
        <ellipse cx="16" cy="8.1" rx="4.3" ry="1.6" />
      </g>
      <path
        className="mark-berry"
        d="M7.5 17a8.5 8.5 0 0 1 17 0c0 4.7-4.2 8.9-8.5 11.4C11.7 25.9 7.5 21.7 7.5 17z"
      />
      <g className="mark-seed">
        <ellipse cx="13" cy="15.4" rx=".72" ry="1.05" transform="rotate(-18 13 15.4)" />
        <ellipse cx="19" cy="15.4" rx=".72" ry="1.05" transform="rotate(18 19 15.4)" />
        <ellipse cx="16" cy="18.6" rx=".72" ry="1.05" />
        <ellipse cx="12.6" cy="20.2" rx=".72" ry="1.05" transform="rotate(-14 12.6 20.2)" />
        <ellipse cx="19.4" cy="20.2" rx=".72" ry="1.05" transform="rotate(14 19.4 20.2)" />
        <ellipse cx="16" cy="23.4" rx=".68" ry="1" />
      </g>
    </svg>
  );
}

// Deterministic cover art for an uploaded document.
//
// This replaced a random picsum.photos image per file — a stock photo of a
// beach standing in for your tax return is noise pretending to be content, and
// it cost a network request per card. The motif is derived from the filename,
// so a given document always wears the same face.
const FNV_OFFSET = 2166136261;

function hash(s: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "DOC";
}

export function DocCover({ name }: { name: string }) {
  const h = hash(name);
  const motif = h % 4;
  const angle = (h >> 3) % 90;
  const id = `cover-${h.toString(36)}`;

  return (
    <div className="cover">
      <svg className="cover-art" viewBox="0 0 120 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <pattern id={id} patternUnits="userSpaceOnUse" width="20" height="20" patternTransform={`rotate(${angle})`}>
            {motif === 0 && <circle cx="10" cy="10" r="2.4" />}
            {motif === 1 && <rect x="0" y="0" width="20" height="6" />}
            {motif === 2 && <path d="M0 20 L20 0 M-4 4 L4 -4 M16 24 L24 16" strokeWidth="2.6" stroke="currentColor" fill="none" />}
            {motif === 3 && <path d="M10 0a10 10 0 0 0 10 10 10 10 0 0 0-10 10A10 10 0 0 0 0 10 10 10 0 0 0 10 0z" />}
          </pattern>
        </defs>
        <rect width="120" height="90" fill={`url(#${id})`} />
      </svg>
      <span className="cover-ext">{extOf(name)}</span>
    </div>
  );
}
