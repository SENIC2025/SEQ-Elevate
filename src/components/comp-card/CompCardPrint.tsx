"use client";

import { useTranslations } from "next-intl";
import type { CompCardData } from "@/store/demo-state";

export function CompCardPrint({
  courseTitle,
  dateStr,
  scenarioSummary,
  compCard,
}: {
  courseTitle: string;
  dateStr: string;
  scenarioSummary: string;
  compCard: CompCardData;
}) {
  const t = useTranslations("compCard");
  const tCommon = useTranslations("common");

  return (
    <div id="comp-card-print" aria-hidden="true">
      <div
        style={{
          fontFamily:
            "Inter, system-ui, -apple-system, sans-serif",
          maxWidth: "640px",
          margin: "0 auto",
          padding: "40px 32px",
          color: "#2e2e3d",
          background: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            borderBottom: "3px solid #cad12c",
            paddingBottom: "12px",
            marginBottom: "20px",
          }}
        >
          <div>
            <p
              style={{
                fontSize: "10px",
                letterSpacing: "0.12em",
                color: "#7467ae",
                fontWeight: 700,
                textTransform: "uppercase",
                margin: 0,
              }}
            >
              SEQ Elevate · Comp Card
            </p>
            <h1
              style={{
                fontSize: "22px",
                fontWeight: 700,
                margin: "4px 0 0",
                color: "#2e2e3d",
              }}
            >
              {t("title")}
            </h1>
          </div>
          <div style={{ textAlign: "right", fontSize: "11px", color: "#4d4d66" }}>
            <p style={{ margin: 0 }}>{tCommon("appName")}</p>
            <p style={{ margin: 0 }}>{dateStr}</p>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            marginBottom: "16px",
          }}
        >
          <div>
            <p style={tinyLabel}>{t("courseLabel")}</p>
            <p style={fieldVal}>{courseTitle}</p>
          </div>
          <div>
            <p style={tinyLabel}>{t("dateLabel")}</p>
            <p style={fieldVal}>{dateStr}</p>
          </div>
        </div>

        <FieldRow label={t("fieldScenario")} value={scenarioSummary} />
        <FieldRow label={t("fieldWentWell")} value={compCard.wentWell || "—"} />
        <FieldRow label={t("fieldDifficult")} value={compCard.difficult || "—"} />
        <FieldRow label={t("fieldImprove")} value={compCard.improve || "—"} />
        <FieldRow label={t("fieldBehaviour")} value={compCard.behaviour || "—"} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            marginTop: "8px",
            paddingTop: "12px",
            borderTop: "1px solid #e4e4e8",
          }}
        >
          <div>
            <p style={tinyLabel}>{t("fieldConfidence")}</p>
            <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "22px",
                    height: "22px",
                    fontSize: "11px",
                    fontWeight: 600,
                    borderRadius: "4px",
                    border: "1px solid #d4d4dc",
                    background: compCard.confidence >= n ? "#7467ae" : "#fff",
                    color: compCard.confidence >= n ? "#fff" : "#4d4d66",
                  }}
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p style={tinyLabel}>{t("privacyLabel")}</p>
            <p style={{ ...fieldVal, fontSize: "12px" }}>
              {t(`privacyChoice.${compCard.privacy}`)}
            </p>
          </div>
        </div>

        <div
          style={{
            marginTop: "32px",
            paddingTop: "16px",
            borderTop: "1px solid #e4e4e8",
            fontSize: "10px",
            color: "#4d4d66",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Created and Powered by SENIC · senic.world</span>
          <span>This Comp Card belongs to the learner.</span>
        </div>
      </div>
    </div>
  );
}

const tinyLabel: React.CSSProperties = {
  fontSize: "9px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: "#4d4d66",
  margin: 0,
};

const fieldVal: React.CSSProperties = {
  fontSize: "13px",
  margin: "2px 0 0",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
};

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: "14px" }}>
      <p style={tinyLabel}>{label}</p>
      <p style={fieldVal}>{value}</p>
    </div>
  );
}
