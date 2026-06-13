"use client";

/**
 * Root error boundary — replaces the whole document when the root layout
 * throws. No providers available here, so it's self-contained + English.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "Inter, system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          textAlign: "center",
          padding: "24px",
          color: "#2e2e3d",
          background: "#fcfdf4",
        }}
      >
        <h1 style={{ fontSize: "22px", fontWeight: 700 }}>
          Something went wrong
        </h1>
        <p style={{ color: "#4d4d66", marginTop: "8px" }}>
          An unexpected error happened.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: "20px",
            background: "#cad12c",
            color: "#2e2e3d",
            fontWeight: 600,
            border: "none",
            borderRadius: "8px",
            padding: "10px 20px",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        {error.digest ? (
          <p style={{ color: "#9a9aa5", marginTop: "16px", fontSize: "11px" }}>
            Ref: {error.digest}
          </p>
        ) : null}
      </body>
    </html>
  );
}
