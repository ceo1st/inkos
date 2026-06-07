import { ChevronLeft } from "lucide-react";
import type { HoldingRow } from "./types";
import { KIND_LABEL_ZH, KIND_LABEL_EN, LADDER_LABEL_ZH, LADDER_LABEL_EN } from "./types";
import { RelationWeb } from "./RelationWeb";

export function HoldingInspect(props: {
  readonly row: HoldingRow;
  readonly isZh: boolean;
  readonly generating?: boolean;
  readonly onBack: () => void;
}) {
  const { row, isZh, generating, onBack } = props;
  const { lifecycle } = row;
  const kind = (isZh ? KIND_LABEL_ZH : KIND_LABEL_EN)[row.kind] ?? row.kind;
  const ladderLabel = isZh ? LADDER_LABEL_ZH : LADDER_LABEL_EN;
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
        <ChevronLeft size={14} /> {isZh ? "返回" : "Back"}
      </button>

      <div className="overflow-hidden rounded-xl border border-border/40 bg-secondary/30">
        <div className="flex h-24 items-center justify-center bg-gradient-to-b from-secondary/60 to-transparent text-4xl">
          {row.imageUrl ? <img src={row.imageUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" /> : <span>{generating ? "⏳" : row.glyph}</span>}
        </div>

        <div className="space-y-3 px-3 py-3">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-[15px] font-bold text-foreground">{row.label}</span>
              <span className="text-[11px] text-muted-foreground">{kind}</span>
            </div>
            {row.summary ? <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{row.summary}</p> : null}
          </div>

          {lifecycle ? (
            <div>
              <div className="flex gap-1">
                {lifecycle.stages.map((stage) => (
                  <span
                    key={stage}
                    className={`flex-1 rounded px-1 py-1 text-center text-[9px] ${
                      stage === lifecycle.current ? "bg-primary/20 font-bold text-primary" : "bg-secondary/40 text-muted-foreground/50"
                    }`}
                  >
                    {ladderLabel[stage] ?? stage}
                  </span>
                ))}
              </div>
              {lifecycle.reason ? <p className="mt-1.5 text-[11px] text-emerald-300">▲ {lifecycle.reason}</p> : null}
            </div>
          ) : row.statusPill ? (
            <div>
              <span className="inline-block rounded-full bg-secondary/60 px-2.5 py-1 text-[12px] font-medium text-foreground">{row.statusPill}</span>
              {row.isFresh ? (
                <p className="mt-1.5 text-[11px] text-emerald-300">▲ {isZh ? "刚获得" : "Just acquired"}</p>
              ) : row.changeReason ? (
                <p className="mt-1.5 text-[11px] text-emerald-300">▲ {row.changeReason}</p>
              ) : null}
            </div>
          ) : null}

          {row.meters.length > 0 ? (
            <div className="space-y-1.5">
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{isZh ? "属性" : "Stats"}</h4>
              {row.meters.map((m) => (
                <div key={m.id} className="flex items-center gap-2 text-[12px]">
                  <span className="w-12 shrink-0 text-muted-foreground">{m.label}</span>
                  {m.ratio != null ? (
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/60">
                      <span className="block h-full bg-primary" style={{ width: `${Math.round(m.ratio * 100)}%` }} />
                    </span>
                  ) : null}
                  <span className="ml-auto font-semibold text-primary">{m.value}</span>
                </div>
              ))}
            </div>
          ) : null}

          {row.relations.length > 0 ? (
            <div>
              <h4 className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">{isZh ? "牵动" : "Connections"}</h4>
              <RelationWeb centerLabel={row.label} relations={row.relations} isZh={isZh} />
            </div>
          ) : null}

          {row.provenanceTurn != null ? (
            <p className="border-t border-border/30 pt-2 text-[11px] text-muted-foreground/70">
              {isZh ? `第 ${row.provenanceTurn} 幕 取得` : `Acquired · Turn ${row.provenanceTurn}`}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
