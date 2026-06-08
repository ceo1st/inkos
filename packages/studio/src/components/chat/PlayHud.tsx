import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gamepad2, X, ChevronDown } from "lucide-react";
import { fetchJson } from "../../hooks/use-api";
import {
  HOLDING_TYPES, HOLDING_GLYPH, SLOT_GLYPH, EVIDENCE_LADDER,
  type HudDetail, type HudRow, type HoldingRow, type HoldingRelation, type HoldingLifecycle,
} from "./play-hud/types";
import { HoldingSlot } from "./play-hud/HoldingSlot";
import { HoldingInspect } from "./play-hud/HoldingInspect";
import { StateGauge } from "./play-hud/StateGauge";

// The HUD is genre-neutral: it renders whatever the world graph contains,
// grouped into "what I face" (world/here-now) and "what I hold" (backpack).
// It never hardcodes a mystery-only layout — sections derive from entity
// types, edge types, and state-slot kinds, and empty sections are hidden.

interface PlayEntity {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly summary?: string;
  readonly status?: string;
  readonly imageUrl?: string;
  readonly createdEventId?: string;
  readonly updatedEventId?: string;
}
interface PlayEdge {
  readonly id: string;
  readonly fromId: string;
  readonly type: string;
  readonly toId: string;
  readonly value?: Record<string, unknown>;
  readonly validUntilEventId?: string | null;
  readonly strength?: number | null;
}
interface PlayStateSlot {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly value: unknown;
  readonly updatedEventId?: string;
  readonly ownerEntityId?: string | null;
}
interface PlayEvent {
  readonly id: string;
  readonly turn: number;
  readonly outcomeSummary?: string;
  readonly timeAdvance?: PlayTimeAdvance | null;
}
interface PlayTimeAdvance {
  readonly elapsed?: string;
  readonly anchor?: string;
  readonly rationale?: string;
  readonly synchronized?: ReadonlyArray<string>;
}
interface PlayGraph {
  readonly entities: ReadonlyArray<PlayEntity>;
  readonly edges: ReadonlyArray<PlayEdge>;
  readonly stateSlots: ReadonlyArray<PlayStateSlot>;
  readonly events: ReadonlyArray<PlayEvent>;
}
interface PlayImageSettings {
  readonly actors: boolean;
  readonly moments: boolean;
  readonly inventory: boolean;
}
interface PlayRunResponse {
  readonly title?: string;
  readonly currentState?: { turn?: number; mode?: string; premise?: string; timeAdvance?: PlayTimeAdvance | null } | null;
  readonly graph?: PlayGraph;
  readonly imageSettings?: PlayImageSettings;
  readonly sceneImageUrl?: string;
}
interface CoverConfigResponse {
  readonly service?: string | null;
  readonly configured?: boolean;
  readonly providers?: ReadonlyArray<{ readonly service: string; readonly connected?: boolean }>;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

// Render a state-slot value for display. Numeric {current,min?,max?} becomes
// "62/80" plus a 0..1 ratio for a progress bar; everything else falls back to
// formatValue (string/number as-is, objects/arrays JSON-stringified).
function meterDisplay(value: unknown): { text: string; ratio?: number } {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if (typeof v.current === "number") {
      const cur = v.current;
      const min = typeof v.min === "number" ? v.min : 0;
      const max = typeof v.max === "number" ? v.max : undefined;
      const text = max != null ? `${cur}/${max}` : String(cur);
      const ratio = max != null && max > min ? Math.max(0, Math.min(1, (cur - min) / (max - min))) : undefined;
      return { text, ratio };
    }
  }
  return { text: formatValue(value) };
}

function isHoldingEdge(edge: PlayEdge, entity: PlayEntity): boolean {
  if (edge.value?.role !== "holding") return false;
  if (entity.type === "item") return true;
  return edge.value?.physical === true || edge.value?.portable === true;
}

function isRelationEdge(edge: PlayEdge): boolean {
  return edge.value?.role === "relation";
}

function isHeldEntity(entity: PlayEntity, currentEdges: ReadonlyArray<PlayEdge>): boolean {
  if (!HOLDING_TYPES.has(entity.type)) return false;
  return currentEdges.some((edge) =>
    edge.fromId === "actor_player"
    && edge.toId === entity.id
    && isHoldingEdge(edge, entity)
  );
}

interface HudView {
  readonly turn: number | null;
  readonly mode: string | null;
  readonly premise: string;
  readonly time: HudRow | null;
  readonly facing: ReadonlyArray<HudRow>;
  // Actor subset of `facing` (excludes locations) — only actors auto-illustrate.
  readonly actors: ReadonlyArray<HudRow>;
  readonly holdings: ReadonlyArray<HoldingRow>;
  readonly meters: ReadonlyArray<HudRow>;
}

type AutoImageRequest =
  | { readonly key: string; readonly body: { readonly target: "entity"; readonly entityId: string } }
  | { readonly key: string; readonly body: { readonly target: "scene" } };

export function buildAutoImageRequests(
  view: HudView | null,
  settings: PlayImageSettings,
  sceneImageUrl?: string,
): ReadonlyArray<AutoImageRequest> {
  if (!view) return [];
  const requests: AutoImageRequest[] = [];
  if (settings.actors) {
    view.actors.forEach((row) => {
      if (!row.imageUrl) requests.push({ key: row.id, body: { target: "entity", entityId: row.id } });
    });
  }
  if (settings.inventory) {
    view.holdings.forEach((row) => {
      if (!row.imageUrl) requests.push({ key: row.id, body: { target: "entity", entityId: row.id } });
    });
  }
  if (settings.moments && view.turn != null && !sceneImageUrl) {
    requests.push({ key: `scene-turn-${view.turn}`, body: { target: "scene" } });
  }
  return requests;
}

export function buildView(run: PlayRunResponse | null): HudView | null {
  if (!run?.graph) return null;
  const { entities, edges, stateSlots, events } = run.graph;
  const labelOf = new Map(entities.map((e) => [e.id, e.label]));
  const outcomeOf = new Map(events.map((e) => [e.id, e.outcomeSummary ?? ""]));
  const currentEdges = edges.filter((e) => e.validUntilEventId == null);

  const latestEvent = events.reduce<PlayEvent | null>((acc, e) => (acc && acc.turn > e.turn ? acc : e), null);
  const latestEventId = latestEvent?.id ?? null;
  const turnOf = new Map(events.map((e) => [e.id, e.turn]));

  const summaryDetail = (e: PlayEntity): HudDetail[] => {
    const summary = e.summary?.trim();
    if (!summary) return [];
    if (summary === e.label || summary === e.status) return [];
    return [{ text: summary }];
  };
  const statusNote = (e: PlayEntity): string | null => {
    const status = e.status?.trim();
    if (!status || status === e.label) return null;
    return status;
  };
  // All current relationships involving an entity, ids resolved to labels.
  const relationDetails = (id: string): HudDetail[] =>
    currentEdges
      .filter((e) => isRelationEdge(e) && (e.fromId === id || e.toId === id))
      .map((e) => {
        const other = e.fromId === id ? labelOf.get(e.toId) : labelOf.get(e.fromId);
        const strength = typeof e.strength === "number" ? ` ${e.strength}` : "";
        return { label: "关系", text: `${e.type}${strength}${other ? ` · ${other}` : ""}` };
      });

  const locations: HudRow[] = entities
    .filter((e) => e.type === "location")
    .map((e) => ({ id: e.id, glyph: "📍", label: e.label, note: statusNote(e), details: summaryDetail(e) }));
  const actors: HudRow[] = entities
    .filter((e) => e.type === "actor")
    .map((e) => ({
      id: e.id,
      glyph: "👤",
      label: e.label,
      note: statusNote(e),
      details: [...summaryDetail(e), ...relationDetails(e.id)],
      imageUrl: e.imageUrl,
    }));
  const surroundings: HudRow[] = entities
    .filter((e) => HOLDING_TYPES.has(e.type) && !isHeldEntity(e, currentEdges))
    .map((e) => ({
      id: e.id,
      glyph: HOLDING_GLYPH[e.type] ?? "•",
      label: e.label,
      note: statusNote(e),
      details: summaryDetail(e),
      imageUrl: e.imageUrl,
    }));
  const ownedMeters = (id: string): HudRow[] =>
    stateSlots
      .filter((s) => s.ownerEntityId === id && s.kind !== "evidence")
      .map((slot) => {
        const { text, ratio } = meterDisplay(slot.value);
        return { id: slot.id, glyph: SLOT_GLYPH[slot.kind] ?? "•", label: slot.label, value: text, note: null, details: [], ratio };
      });
  // The holding's web shows what it connects to in the world. The player is
  // excluded entirely — "you hold/wield it" is already implied by it being a
  // holding, so any actor_player edge (holding or relation) is not a web node.
  const relationsOf = (id: string): HoldingRelation[] =>
    currentEdges
      .filter((edge) =>
        (edge.fromId === id || edge.toId === id)
        && edge.fromId !== "actor_player" && edge.toId !== "actor_player")
      .map((edge) => {
        const otherId = edge.fromId === id ? edge.toId : edge.fromId;
        return {
          targetLabel: labelOf.get(otherId) ?? otherId,
          type: edge.type,
          strength: typeof edge.strength === "number" ? edge.strength : undefined,
        };
      });
  const lifecycleOf = (id: string): HoldingLifecycle | undefined => {
    const slot = stateSlots.find((s) => s.ownerEntityId === id && s.kind === "evidence");
    if (!slot || typeof slot.value !== "object" || slot.value === null) return undefined;
    const v = slot.value as Record<string, unknown>;
    const current = typeof v.status === "string" ? v.status : undefined;
    if (!current) return undefined;
    return { stages: EVIDENCE_LADDER, current, reason: typeof v.reason === "string" && v.reason ? v.reason : undefined };
  };

  const holdings: HoldingRow[] = entities
    .filter((e) => isHeldEntity(e, currentEdges))
    .map((e) => {
      const meters = ownedMeters(e.id);
      const relations = relationsOf(e.id);
      const lifecycle = lifecycleOf(e.id);
      const statusPill = lifecycle ? undefined : (statusNote(e) ?? undefined);
      const isFresh = !!e.createdEventId && e.createdEventId === latestEventId;
      const changeReason = !isFresh && e.updatedEventId && e.updatedEventId === latestEventId
        ? (outcomeOf.get(e.updatedEventId) || undefined)
        : undefined;
      const summaryText = e.summary?.trim();
      const summary = summaryText && summaryText !== e.label && summaryText !== e.status ? summaryText : undefined;
      const preview = meters[0]?.value
        || (relations[0] ? `${relations[0].type}${relations[0].targetLabel ? `·${relations[0].targetLabel}` : ""}` : undefined)
        || (lifecycle ? lifecycle.current : statusPill);
      return {
        id: e.id, kind: e.type, glyph: HOLDING_GLYPH[e.type] ?? "•", label: e.label,
        imageUrl: e.imageUrl, summary, preview, statusPill, lifecycle, meters, relations,
        provenanceTurn: e.createdEventId ? turnOf.get(e.createdEventId) : undefined,
        isFresh, changeReason,
      };
    });
  const meters: HudRow[] = stateSlots
    .filter((slot) => !slot.ownerEntityId)
    .map((slot) => {
      const cause = slot.updatedEventId ? outcomeOf.get(slot.updatedEventId) || "" : "";
      const { text, ratio } = meterDisplay(slot.value);
      return {
        id: slot.id, glyph: SLOT_GLYPH[slot.kind] ?? "•", label: slot.label, kind: slot.kind,
        value: text, ratio, note: null,
        details: cause ? [{ label: "因为", text: cause }] : [],
      };
    });
  const latestTime = run.currentState?.timeAdvance
    ?? [...events].reverse().find((event) => event.timeAdvance)?.timeAdvance
    ?? null;
  const time: HudRow | null = latestTime && (latestTime.elapsed || latestTime.anchor || latestTime.rationale || (latestTime.synchronized?.length ?? 0) > 0)
    ? {
        id: "world-time",
        glyph: "⏳",
        label: "世界时间",
        value: latestTime.anchor || latestTime.elapsed || "",
        note: latestTime.rationale || null,
        details: [
          ...(latestTime.elapsed && latestTime.anchor ? [{ label: "经过", text: latestTime.elapsed }] : []),
          ...(latestTime.synchronized ?? []).map((text) => ({ label: "同步", text })),
        ],
      }
    : null;

  const turnFromEvents = events.reduce((max, e) => Math.max(max, e.turn), 0);
  return {
    turn: run.currentState?.turn ?? (events.length > 0 ? turnFromEvents : null),
    mode: run.currentState?.mode ?? null,
    premise: run.currentState?.premise ?? "",
    time,
    facing: [...locations, ...actors, ...surroundings],
    actors,
    holdings,
    meters,
  };
}

export function PlayHud(props: {
  readonly sessionId: string;
  readonly isStreaming: boolean;
  readonly isZh: boolean;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly sessionTitle?: string | null;
  // Reports the current turn's scene image up so the chat can render it centrally.
  readonly onSceneImageUrl?: (url: string | undefined) => void;
}) {
  const { sessionId, isStreaming, isZh, open, onClose, onSceneImageUrl } = props;
  const base = `/play/runs/${encodeURIComponent(sessionId)}/main`;
  const [selectedHoldingId, setSelectedHoldingId] = useState<string | null>(null);
  const [run, setRun] = useState<PlayRunResponse | null>(null);
  const [settings, setSettings] = useState<PlayImageSettings>({ actors: false, moments: false, inventory: false });
  const [coverReady, setCoverReady] = useState(false);
  const [generating, setGenerating] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef<Set<string>>(new Set());
  const prevStreaming = useRef(isStreaming);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<PlayRunResponse>(base);
      setRun(data);
      if (data.imageSettings) setSettings(data.imageSettings);
      onSceneImageUrl?.(data.sceneImageUrl);
    } catch {
      // A play session may not have a persisted world yet (no first action).
      // Leaving run null renders the empty state; do not surface an error.
    }
  }, [base, onSceneImageUrl]);

  useEffect(() => { void load(); }, [load]);

  // Refetch when a turn finishes (streaming true -> false).
  useEffect(() => {
    if (prevStreaming.current && !isStreaming) void load();
    prevStreaming.current = isStreaming;
  }, [isStreaming, load]);

  // Image toggles can only be enabled once an image API is configured + connected.
  useEffect(() => {
    fetchJson<CoverConfigResponse>("/cover/config")
      .then((cfg) => {
        // Prefer the server's explicit `configured` (covers the env path too);
        // fall back to "a selected service is connected" for older servers.
        const selected = cfg.service ?? null;
        setCoverReady(
          cfg.configured ?? (!!selected && (cfg.providers ?? []).some((p) => p.service === selected && p.connected)),
        );
      })
      .catch(() => setCoverReady(false));
  }, []);

  const toggleSetting = useCallback(async (key: keyof PlayImageSettings) => {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    try {
      await fetchJson(`${base}/image-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch {
      setSettings(settings); // revert on failure
    }
  }, [settings, base]);

  const generate = useCallback(async (
    key: string,
    body: { target: "entity"; entityId: string } | { target: "scene" },
  ) => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setGenerating((s) => new Set(s).add(key));
    try {
      await fetchJson(`${base}/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
    } catch {
      // Generation blip — the row simply stays image-less; user can retry.
    } finally {
      inFlight.current.delete(key);
      setGenerating((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  }, [base, load]);

  const view = useMemo(() => buildView(run), [run]);
  // The selected holding is looked up fresh from the current view, so if it
  // disappears on the next turn the panel falls back to the list automatically.
  const selectedHolding = view?.holdings.find((h) => h.id === selectedHoldingId) ?? null;

  // Auto-illustrate new actors / inventory / current moment when the toggle is on and an image
  // API is configured. Decoupled + deduped (inFlight): never blocks a turn,
  // images appear on the next refresh.
  useEffect(() => {
    if (!coverReady || !view) return;
    buildAutoImageRequests(view, settings, run?.sceneImageUrl)
      .forEach((request) => void generate(request.key, request.body));
  }, [coverReady, settings, view, run?.sceneImageUrl, generate]);

  const title = props.sessionTitle?.trim() || run?.title?.trim() || (isZh ? "互动世界" : "Play World");

  // Collapsed: render nothing (the chat input row owns the prominent toggle).
  // Hooks above still run, so the run keeps polling and reporting the scene image.
  if (!open) return null;

  return (
    <aside className="absolute bottom-28 right-0 top-0 z-20 flex w-[330px] flex-col border-l border-border/40 bg-card/95 backdrop-blur shadow-xl">
      <header className="relative flex items-center gap-2.5 border-b border-border/40 px-4 py-3">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        {view?.turn != null ? (
          <div className="flex shrink-0 flex-col items-center leading-none">
            <span className="text-xl font-extrabold text-primary">{view.turn}</span>
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">{isZh ? "幕" : "Turn"}</span>
          </div>
        ) : (
          <Gamepad2 size={16} className="shrink-0 text-primary" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-foreground">{title}</div>
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
            {view?.turn == null
              ? (isZh ? "尚未开始" : "Not started")
              : view?.mode
                ? (view.mode === "guided" ? (isZh ? "互动模式" : "Guided") : (isZh ? "开放模式" : "Open"))
                : (isZh ? "互动世界" : "Play World")}
          </div>
        </div>
        {view?.time?.value ? (
          <span className="shrink-0 rounded-full bg-secondary/60 px-2 py-0.5 text-[10.5px] text-muted-foreground" title={view.time.note ?? undefined}>
            {view.time.value}
          </span>
        ) : null}
        <button type="button" onClick={() => { onClose(); setSelectedHoldingId(null); }} className="shrink-0 text-muted-foreground hover:text-foreground" title={isZh ? "收起" : "Collapse"}>
          <X size={15} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
        {!view ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/50 bg-secondary/10 px-4 py-8 text-center">
            <span className="text-3xl opacity-80">🎲</span>
            <p className="text-[13px] font-semibold text-foreground">{isZh ? "这个世界还在沉睡" : "This world is still asleep"}</p>
            <p className="text-[11.5px] leading-6 text-muted-foreground">
              {isZh
                ? "在左边写下你的第一个动作，人物、线索、状态会在这里逐渐点亮。"
                : "Take your first action on the left — characters, clues, and state will light up here."}
            </p>
          </div>
        ) : selectedHolding ? (
          <HoldingInspect
            row={selectedHolding}
            isZh={isZh}
            generating={generating.has(selectedHolding.id)}
            onBack={() => setSelectedHoldingId(null)}
          />
        ) : (
          <>
            {view.time && (view.time.note || view.time.details.length > 0) ? (
              <Zone
                title={isZh ? "世界时间" : "World time"}
                icon="⏳"
                empty={false}
                emptyText=""
              >
                <Row row={view.time} isZh={isZh} />
              </Zone>
            ) : null}
            <Zone
              title={isZh ? "我面对的" : "Around me"}
              icon="🧭"
              empty={view.facing.length === 0}
              emptyText={isZh ? "周围还没有出现地点或人物" : "No places or people around yet"}
            >
              {view.facing.map((row) => (
                <Row key={row.id} row={row} isZh={isZh} generating={generating.has(row.id)} />
              ))}
            </Zone>

            <Zone
              title={isZh ? "我握有的" : "What I hold"}
              icon="🎒"
              empty={view.holdings.length === 0}
              emptyText={isZh ? "还没有获得物品、证据或线索" : "No items, evidence, or clues yet"}
            >
              {view.holdings.map((row) => (
                <HoldingSlot
                  key={row.id}
                  row={row}
                  isZh={isZh}
                  generating={generating.has(row.id)}
                  onOpen={() => setSelectedHoldingId(row.id)}
                />
              ))}
            </Zone>

            <Zone
              title={isZh ? "状态" : "State"}
              icon="📊"
              empty={view.meters.length === 0}
              emptyText={isZh ? "还没有出现数值（压力、资源、关系、倒计时等）" : "No meters yet (pressure, resources, relations, timers…)"}
            >
              {view.meters.map((row) => (
                <StateGauge key={row.id} row={row} />
              ))}
            </Zone>

            {view.premise && (
              <div className="rounded-lg border border-border/30 bg-secondary/30 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                {view.premise}
              </div>
            )}

            <PlayImagePanel
              isZh={isZh}
              settings={settings}
              coverReady={coverReady}
              onToggle={toggleSetting}
              onIllustrateMoment={() => generate("scene", { target: "scene" })}
              momentBusy={generating.has("scene")}
            />
          </>
        )}
      </div>
    </aside>
  );
}

function PlayImagePanel(props: {
  readonly isZh: boolean;
  readonly settings: PlayImageSettings;
  readonly coverReady: boolean;
  readonly onToggle: (key: keyof PlayImageSettings) => void;
  readonly onIllustrateMoment: () => void;
  readonly momentBusy: boolean;
}) {
  const { isZh, settings, coverReady, onToggle, onIllustrateMoment, momentBusy } = props;
  const options: ReadonlyArray<{ key: keyof PlayImageSettings; label: string }> = [
    { key: "actors", label: isZh ? "为角色配图" : "Illustrate characters" },
    { key: "moments", label: isZh ? "为时刻配图" : "Illustrate moments" },
    { key: "inventory", label: isZh ? "为背包配图" : "Illustrate inventory" },
  ];
  return (
    <section className="relative rounded-xl border border-border/40 bg-secondary/20 px-3 pb-3 pt-2.5">
      <span aria-hidden className="absolute left-3 top-0 h-0.5 w-5 -translate-y-px rounded-full bg-primary/70" />
      <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        <span className="text-xs">🎨</span>{isZh ? "自动配图" : "Auto illustration"}
      </h3>
      <div className="space-y-1.5">
        {options.map((opt) => (
          <label
            key={opt.key}
            className={`flex items-center gap-2 text-[12px] ${coverReady ? "cursor-pointer text-foreground" : "cursor-not-allowed text-muted-foreground/40"}`}
            title={coverReady ? undefined : (isZh ? "先在「模型配置」里配好生图 API 才能开启" : "Configure an image API in Model Settings first")}
          >
            <input
              type="checkbox"
              disabled={!coverReady}
              checked={coverReady && settings[opt.key]}
              onChange={() => onToggle(opt.key)}
              className="h-3.5 w-3.5 accent-primary"
            />
            {opt.label}
          </label>
        ))}
      </div>
      {!coverReady ? (
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground/50">
          {isZh ? "未检测到可用的生图 API。在「模型配置」里配好后即可勾选。" : "No image API configured. Set one up in Model Settings to enable."}
        </p>
      ) : settings.moments ? (
        <button
          type="button"
          onClick={onIllustrateMoment}
          disabled={momentBusy}
          className="mt-2 w-full rounded-lg border border-border/40 bg-secondary/40 px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:text-primary disabled:opacity-50"
        >
          {momentBusy ? (isZh ? "配图中…" : "Illustrating…") : (isZh ? "为这一刻配图" : "Illustrate this moment")}
        </button>
      ) : null}
    </section>
  );
}

function Zone(props: {
  readonly title: string;
  readonly icon: string;
  readonly empty: boolean;
  readonly emptyText: string;
  readonly children: React.ReactNode;
}) {
  // Always render the category so the player sees the structure ("what kinds of
  // things can show up here"); content fills in as the story produces it. The
  // bordered block + accent tick give the panel a game-HUD feel without leaving
  // Studio's muted theme tokens.
  return (
    <section className="relative rounded-xl border border-border/40 bg-secondary/20 px-3 pb-3 pt-2.5">
      <span aria-hidden className="absolute left-3 top-0 h-0.5 w-5 -translate-y-px rounded-full bg-primary/70" />
      <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        <span className="text-xs">{props.icon}</span>{props.title}
      </h3>
      {props.empty ? (
        <p className="text-[11px] leading-5 text-muted-foreground/50">{props.emptyText}</p>
      ) : (
        <div className="space-y-1.5">{props.children}</div>
      )}
    </section>
  );
}

function Row({ row, isZh, generating }: { readonly row: HudRow; readonly isZh: boolean; readonly generating?: boolean }) {
  const [open, setOpen] = useState(false);
  const expandable = row.details.length > 0;
  return (
    <div className="rounded-lg border border-border/30 bg-secondary/30">
      <div
        role={expandable ? "button" : undefined}
        title={expandable ? (open ? (isZh ? "收起" : "Collapse") : (isZh ? "展开详情" : "Show details")) : undefined}
        onClick={expandable ? () => setOpen((o) => !o) : undefined}
        className={`px-2.5 py-1.5 ${expandable ? "cursor-pointer" : ""}`}
      >
        <div className="flex items-baseline gap-1.5">
          {row.imageUrl ? (
            <img src={row.imageUrl} alt="" aria-hidden="true" className="h-7 w-7 shrink-0 self-center rounded object-cover" />
          ) : (
            <span className="shrink-0 text-xs">{generating ? "⏳" : row.glyph}</span>
          )}
          <span className="text-[13px] font-medium text-foreground">{row.label}</span>
          {row.value ? <span className="ml-auto text-[13px] font-semibold text-primary">{row.value}</span> : null}
          {expandable ? (
            <ChevronDown
              size={12}
              className={`${row.value ? "ml-1.5" : "ml-auto"} shrink-0 text-muted-foreground/50 transition-transform ${open ? "rotate-180" : ""}`}
            />
          ) : null}
        </div>
        {row.note ? <div className="mt-0.5 pl-5 text-[11px] leading-4 text-muted-foreground">{row.note}</div> : null}
      </div>
      {open && (
        <div className="space-y-1 px-2.5 pb-2 pl-7">
          {row.details.map((detail, i) => (
            <p key={i} className="text-[11px] leading-5 text-muted-foreground">
              {detail.label ? <span className="text-muted-foreground/50">{detail.label} </span> : null}
              {detail.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
