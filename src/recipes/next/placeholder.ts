import { PLACEHOLDER_LINE } from '../../runs/placeholder.js';

/** What a new slot shows until its agent has written it: a React component saying so. */
export const PLACEHOLDER_INDEX = `export default function NotYetGenerated() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "2rem",
        textAlign: "center",
        fontFamily: "system-ui, sans-serif",
        color: "#5b6274",
        background: "#f6f8fa",
      }}
    >
      <p>${PLACEHOLDER_LINE}</p>
    </div>
  );
}
`;
