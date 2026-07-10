// The board. Two zones: your documents, then things to say. It recedes the
// moment a conversation begins — a shelf, not a feed. (Upload lives in the dock
// so it stays reachable while the board is receded.)
//
// The suggestions are derived from state, not a fixed list: we never tell you to
// summarize a document you haven't uploaded.

import { DocCover, Icon, type IconName } from "./icons";

type Suggestion = { icon: IconName; text: string; accent?: boolean };
type Doc = { name: string; chunks: number };

// One line of pure editorial texture — the thesis of the whole product.
const QUOTE = "The best interface is a conversation you forget you're having.";

const RESTING: Suggestion[] = [
  { icon: "math", text: "What's 18% of 240?" },
  { icon: "remember", text: "Remember I prefer window seats" },
  { icon: "web", text: "Search the web for tonight's weather", accent: true },
  { icon: "folder", text: "List the files in my Fraise folder" },
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
    { icon: "doc", text: `Summarize ${title}`, accent: true },
    { icon: "search", text: `What does ${title} say about…?` },
    { icon: "recall", text: "What have I asked you to remember?" },
    { icon: "web", text: "Search the web for tonight's weather" },
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

      <section className="board-section">
        <h2 className="board-label">Try saying</h2>
        <div className="suggest-grid">
          {suggestions.map((s) => (
            <button key={s.text} className={`card${s.accent ? " accent" : ""}`}>
              <span className="card-icon">
                <Icon name={s.icon} />
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
