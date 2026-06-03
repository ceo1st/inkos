import { useEffect, useState } from "react";
import { Bell, Bot, Radar, Settings2 } from "lucide-react";
import { fetchJson, putApi, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface Nav {
  toDashboard: () => void;
  toServices: () => void;
}

type NoticeTone = "success" | "error" | "info";

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseJsonField(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

function SettingsCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary">{icon}</div>
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export function ProjectSettings({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data: overridesData, refetch: refetchOverrides } = useApi<{ overrides: Record<string, unknown> }>("/project/model-overrides");
  const { data: notifyData, refetch: refetchNotify } = useApi<{ channels: unknown[] }>("/project/notify");
  const { data: modeData, refetch: refetchMode } = useApi<{ mode: "legacy" | "v2" }>("/project/input-governance-mode");
  const { data: detectionData, refetch: refetchDetection } = useApi<{ detection: unknown | null }>("/project/detection");
  const [mode, setMode] = useState<"legacy" | "v2">("v2");
  const [overridesText, setOverridesText] = useState("{}");
  const [notifyText, setNotifyText] = useState("[]");
  const [detectionText, setDetectionText] = useState("null");
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (modeData?.mode) setMode(modeData.mode);
  }, [modeData]);

  useEffect(() => {
    if (overridesData) setOverridesText(prettyJson(overridesData.overrides ?? {}));
  }, [overridesData]);

  useEffect(() => {
    if (notifyData) setNotifyText(prettyJson(notifyData.channels ?? []));
  }, [notifyData]);

  useEffect(() => {
    if (detectionData) setDetectionText(prettyJson(detectionData.detection ?? null));
  }, [detectionData]);

  const runSave = async (key: string, work: () => Promise<void>, success: string) => {
    setSaving(key);
    setNotice(null);
    try {
      await work();
      setNotice({ tone: "success", message: success });
    } catch (e) {
      setNotice({ tone: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("settings.title")}</span>
      </div>

      <div className="space-y-2">
        <h1 className="font-serif text-3xl flex items-center gap-3">
          <Settings2 size={28} className="text-primary" />
          {t("settings.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("settings.subtitle")}
        </p>
      </div>

      {notice && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            notice.tone === "error"
              ? "bg-destructive/10 text-destructive"
              : notice.tone === "info"
                ? "bg-secondary text-muted-foreground"
                : "bg-emerald-500/10 text-emerald-600"
          }`}
        >
          {notice.message}
        </div>
      )}

      <SettingsCard
        title={t("settings.inputGovernance")}
        description={t("settings.inputGovernanceHint")}
        icon={<Radar size={18} />}
      >
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value === "legacy" ? "legacy" : "v2")}
            className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm outline-none"
          >
            <option value="v2">v2</option>
            <option value="legacy">legacy</option>
          </select>
          <button
            onClick={() => runSave("mode", async () => {
              await putApi("/project/input-governance-mode", { mode });
              await refetchMode();
            }, t("settings.saved"))}
            disabled={saving === "mode"}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${c.btnPrimary} disabled:opacity-40`}
          >
            {saving === "mode" ? t("config.saving") : t("config.save")}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard
        title={t("settings.modelOverrides")}
        description={t("settings.modelOverridesHint")}
        icon={<Bot size={18} />}
      >
        <textarea
          value={overridesText}
          onChange={(e) => setOverridesText(e.target.value)}
          rows={8}
          className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 font-mono text-xs outline-none focus:border-primary/50"
        />
        <div className="flex gap-2">
          <button
            onClick={() => runSave("overrides", async () => {
              const parsed = parseJsonField(overridesText);
              if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("modelOverrides must be a JSON object");
              await putApi("/project/model-overrides", { overrides: parsed });
              await refetchOverrides();
            }, t("settings.saved"))}
            disabled={saving === "overrides"}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${c.btnPrimary} disabled:opacity-40`}
          >
            {saving === "overrides" ? t("config.saving") : t("config.save")}
          </button>
          <button onClick={nav.toServices} className={`rounded-lg px-4 py-2 text-sm font-bold ${c.btnSecondary}`}>
            {t("settings.openModelConfig")}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard
        title={t("settings.notify")}
        description={t("settings.notifyHint")}
        icon={<Bell size={18} />}
      >
        <textarea
          value={notifyText}
          onChange={(e) => setNotifyText(e.target.value)}
          rows={8}
          className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 font-mono text-xs outline-none focus:border-primary/50"
        />
        <button
          onClick={() => runSave("notify", async () => {
            const parsed = parseJsonField(notifyText);
            if (!Array.isArray(parsed)) throw new Error("notify channels must be a JSON array");
            await putApi("/project/notify", { channels: parsed });
            await refetchNotify();
          }, t("settings.saved"))}
          disabled={saving === "notify"}
          className={`rounded-lg px-4 py-2 text-sm font-bold ${c.btnPrimary} disabled:opacity-40`}
        >
          {saving === "notify" ? t("config.saving") : t("config.save")}
        </button>
      </SettingsCard>

      <SettingsCard
        title={t("settings.detection")}
        description={t("settings.detectionHint")}
        icon={<Radar size={18} />}
      >
        <textarea
          value={detectionText}
          onChange={(e) => setDetectionText(e.target.value)}
          rows={9}
          className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 font-mono text-xs outline-none focus:border-primary/50"
        />
        <button
          onClick={() => runSave("detection", async () => {
            await fetchJson("/project/detection", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ detection: parseJsonField(detectionText) }),
            });
            await refetchDetection();
          }, t("settings.saved"))}
          disabled={saving === "detection"}
          className={`rounded-lg px-4 py-2 text-sm font-bold ${c.btnPrimary} disabled:opacity-40`}
        >
          {saving === "detection" ? t("config.saving") : t("config.save")}
        </button>
      </SettingsCard>
    </div>
  );
}
