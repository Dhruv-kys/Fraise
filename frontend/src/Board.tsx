// The board. Two zones: your documents, then things to say. It recedes the
// moment a conversation begins — a shelf, not a feed. (Upload lives in the dock
// so it stays reachable while the board is receded.)
//
// The suggestions are derived from state, not a fixed list: we never tell you to
// summarize a document you haven't uploaded.

import { DocCover, Icon, type IconName } from "./icons";

type Suggestion = { icon: IconName; label: string; text: string; accent?: boolean };
type Doc = { name: string; chunks: number };

// One line of pure editorial texture — the thesis of the whole product.
const QUOTE = "The best interface is a conversation you forget you're having.";

// Research leads, and takes the accent card — it's the thing people don't know
// they can ask for, and it's the most capable thing here.
const RESTING: Suggestion[] = [
  { icon: "search", label: "Research", text: "Research the best SDE internships and make me a deck", accent: true },
  { icon: "web", label: "Compare", text: "Compare the best electric cars under 20 lakhs" },
  { icon: "remember", label: "Memory", text: "Remember I prefer window seats" },
  { icon: "math", label: "Quick math", text: "What's 18% of 240?" },
];

function titleOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  return stem.length > 24 ? `${stem.slice(0, 23)}…` : stem;
}

// With a document in hand, retrieval is the interesting thing to do — so it
// takes the accent card, and the generic prompts step back.
function suggestionsFor(docs: Doc[]): Suggestion[] {
  if (!docs.length) return RESTING;
  const title = titleOf(docs[0].name);
  return [
    { icon: "doc", label: "Summarize", text: `Summarize ${title}`, accent: true },
    { icon: "search", label: "Ask", text: `What does ${title} say about…?` },
    { icon: "web", label: "Research", text: "Research this topic and write it up" },
    { icon: "recall", label: "Recall", text: "What have I asked you to remember?" },
  ];
}

interface BoardProps {
  docs: Doc[];
  uploading: string;
  receded: boolean;
}

// Upload lives in the dock now (always visible, even while talking) — the board
// only holds what's meant to recede: your documents and things to say.
export default function Board({ docs, uploading, receded }: BoardProps) {
  const suggestions = suggestionsFor(docs);
  const hasDocs = docs.length > 0 || !!uploading;

  return (
    <div className={`board${receded ? " receded" : ""}`} aria-hidden={receded}>
      {hasDocs && (
        <section className="board-section">
          <h2 className="board-label">Your documents</h2>
          <div className="docs-masonry">
            {uploading && (
              <div className="card doc-card pending">
                <DocCover name={uploading} />
                <div className="card-meta">
                  <span className="meta-name">{uploading}</span>
                  <span className="chunks">adding…</span>
                </div>
              </div>
            )}
            {docs.map((d) => (
              <div key={d.name} className="card doc-card">
                <DocCover name={d.name} />
                <div className="card-meta">
                  <span className="meta-name">{d.name}</span>
                  <span className="chunks">{d.chunks} passages</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* The agents, at rest. People can't ask for what they don't know exists —
          this shows the fan-out before it ever happens. */}
      <section className="board-section">
        <h2 className="board-label">Research agents</h2>
        <div className="agents-idle">
          <p className="agents-idle-copy">
            Ask me to research anything and I'll put a team of agents on it — each
            searching a different source at the same time, then writing the findings
            up as a document or a deck.
          </p>
          <div className="agents-idle-chips">
            {["Job boards", "Reviews", "Forums", "News", "Docs", "The open web"].map((c) => (
              <span key={c} className="agent-chip">{c}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="board-section">
        <h2 className="board-label">Try saying</h2>
        <div className="suggest-grid">
          {suggestions.map((s) => (
            <button key={s.text} className={`card${s.accent ? " accent" : ""}`}>
              <span className="card-icon">
                <Icon name={s.icon} />
                {s.label}
              </span>
              <span className="card-say">{s.text}</span>
            </button>
          ))}
          {!hasDocs && (
            <div className="card quote">
              <span className="card-say">{QUOTE}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
