import Link from "next/link";

/**
 * Root not-found — for unmatched top-level paths (no locale context).
 * Localized 404s for in-app notFound() calls use [locale]/not-found.tsx.
 */
export default function NotFound() {
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
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "#cad12c",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            fontWeight: 800,
            color: "#2e2e3d",
          }}
        >
          ?
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 20 }}>
          We couldn&apos;t find that page
        </h1>
        <p style={{ color: "#4d4d66", marginTop: 8 }}>
          The page doesn&apos;t exist or has moved.
        </p>
        <Link
          href="/en"
          style={{
            marginTop: 20,
            background: "#cad12c",
            color: "#2e2e3d",
            fontWeight: 600,
            textDecoration: "none",
            borderRadius: 8,
            padding: "10px 20px",
          }}
        >
          Go home
        </Link>
      </body>
    </html>
  );
}
