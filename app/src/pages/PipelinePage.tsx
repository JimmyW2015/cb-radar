import { useState } from "react";
import { PipelineCard } from "../components/PipelineCard";
import { useSimpleTable } from "../lib/useSimpleTable";
import type { PipelineRow } from "../lib/types";

type Stage = PipelineRow["stage"];

const STAGES: { key: Stage; title: string; hint: string; dotColor: string }[] = [
  { key: "board_announcement", title: "董事會公告", hint: "承銷方式未定", dotColor: "var(--ink-faint)" },
  { key: "effective", title: "已申報生效", hint: "排定詢圈／競拍時程", dotColor: "var(--accent)" },
  { key: "recently_listed", title: "即將上市", hint: "已完成競拍／詢圈", dotColor: "var(--down)" },
];

const ALL_STAGES = new Set<Stage>(STAGES.map((s) => s.key));

export function PipelinePage() {
  const { rows, loading, error } = useSimpleTable<PipelineRow>("pipeline");
  const [visible, setVisible] = useState<Set<Stage>>(ALL_STAGES);

  function toggle(stage: Stage) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next.size === 0 ? new Set(ALL_STAGES) : next;
    });
  }

  return (
    <div className="list">
      <div className="panel-title">預計發行</div>
      <div className="panel-sub">資料來源：統一證券 CBAS · 董事會公告 → 申報生效 → 即將上市</div>

      <div className="chips" style={{ padding: "2px 2px 12px" }}>
        {STAGES.map((s) => (
          <div key={s.key} className={`chip ${visible.has(s.key) ? "on" : ""}`} onClick={() => toggle(s.key)}>
            {s.title}
          </div>
        ))}
      </div>

      {loading && <div className="state-msg">載入中…</div>}
      {error && <div className="state-msg error">讀取失敗：{error}</div>}

      {STAGES.filter((s) => visible.has(s.key)).map((stage) => {
        const items = rows.filter((r) => r.stage === stage.key);
        if (items.length === 0) return null;
        return (
          <div className="stage-group" key={stage.key}>
            <div className="stage-head">
              <span className="stage-dot" style={{ background: stage.dotColor }} />
              <h4>{stage.title}</h4>
              <span className="stage-line" />
              <span className="stage-n">{stage.hint}</span>
            </div>
            {items.map((row) => (
              <PipelineCard row={row} key={`${row.cb_code}-${row.stage}`} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
