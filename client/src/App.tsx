import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";
import { Office3D } from "./Office3D";

type Office = ApiResponse<typeof api, "getOffice">;
type StatusEntry = Office["status"][number];
type PipelineItem = Office["pipeline"][number];
type Desk = Office["desks"][number];
type InboxItem = Office["inbox"][number];
type Verdict = InboxItem["verdict"];

function fmtUpdated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `更新于 ${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

function latestUpdated(items: { updated_at: string }[]): string {
  let best = "";
  let bestTime = -1;
  for (const it of items) {
    const t = new Date(it.updated_at).getTime();
    if (!Number.isNaN(t) && t > bestTime) {
      bestTime = t;
      best = it.updated_at;
    }
  }
  return best;
}

function greetingFor(hour: number): string {
  if (hour < 5) return "夜深了";
  if (hour < 9) return "早上好";
  if (hour < 12) return "上午好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

type Phase = "dawn" | "day" | "dusk" | "night";

function phaseFor(hour: number): Phase {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

const SKY: Record<Phase, { from: string; to: string; glow: string }> = {
  // Every phase stays in the deep ink-blue / slate range per spec — the
  // office is lamplit; only the glow tint shifts with the hour.
  dawn: { from: "#141f38", to: "#2c3350", glow: "rgba(255,183,120,.45)" },
  day: { from: "#16233c", to: "#2b4066", glow: "rgba(255,220,160,.4)" },
  dusk: { from: "#131c33", to: "#33304a", glow: "rgba(255,160,80,.5)" },
  night: { from: "#0e1730", to: "#1d2c49", glow: "rgba(232,163,61,.5)" },
};

/** Muse's default look: a cream plush round face, drawn as decoration. */
function Mascot({ mood }: { mood: "working" | "waiting" | "resting" }) {
  return (
    <svg
      viewBox="0 0 120 120"
      role="img"
      aria-label="Muse 的工位头像"
      className="h-full w-full drop-shadow-[0_10px_24px_rgba(0,0,0,0.45)]"
    >
      <ellipse cx="60" cy="108" rx="34" ry="7" fill="rgba(0,0,0,0.35)" />
      <circle cx="60" cy="58" r="44" fill="#f6ead2" />
      <circle cx="60" cy="58" r="44" fill="url(#plushShade)" />
      <defs>
        <radialGradient id="plushShade" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" stopColor="#fff8ea" stopOpacity="0.9" />
          <stop offset="55%" stopColor="#f6ead2" stopOpacity="0" />
          <stop offset="100%" stopColor="#d9c39c" stopOpacity="0.55" />
        </radialGradient>
      </defs>
      <circle cx="33" cy="66" r="8" fill="#f3b8a0" opacity="0.55" />
      <circle cx="87" cy="66" r="8" fill="#f3b8a0" opacity="0.55" />
      {mood === "resting" ? (
        <>
          <path d="M42 54 q6 5 12 0" stroke="#4a3b28" strokeWidth="3.4" fill="none" strokeLinecap="round" />
          <path d="M66 54 q6 5 12 0" stroke="#4a3b28" strokeWidth="3.4" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="48" cy="52" r="4.6" fill="#3d2f1e" />
          <circle cx="72" cy="52" r="4.6" fill="#3d2f1e" />
          <circle cx="49.6" cy="50.4" r="1.5" fill="#fff8ea" />
          <circle cx="73.6" cy="50.4" r="1.5" fill="#fff8ea" />
        </>
      )}
      {mood === "working" ? (
        <path d="M50 74 q10 8 20 0" stroke="#4a3b28" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      ) : mood === "waiting" ? (
        <ellipse cx="60" cy="76" rx="5" ry="6" fill="#4a3b28" />
      ) : (
        <path d="M52 73 q8 5 16 0" stroke="#4a3b28" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      )}
      <path d="M24 34 q-6 10 -2 20" stroke="#e7d5ae" strokeWidth="5" fill="none" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

function SectionHeading({
  id,
  title,
  sub,
  updated,
}: {
  id: string;
  title: string;
  sub?: string;
  updated?: string;
}) {
  return (
    <div id={id} className="scroll-mt-32">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          className="text-[22px] font-semibold tracking-wide text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h2>
        {sub ? <span className="text-sm text-[var(--dim)]">{sub}</span> : null}
        {updated ? (
          <span className="ml-auto text-xs text-[var(--faint)]">{fmtUpdated(updated)}</span>
        ) : null}
      </div>
      <div className="mt-2 h-px bg-[var(--border)]" />
    </div>
  );
}

function CounterTile({
  label,
  count,
  hint,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  hint: string;
  tone: "amber" | "rose" | "slate" | "teal";
  onClick: () => void;
}) {
  const tones: Record<string, string> = {
    amber: "text-[var(--accent)]",
    rose: "text-[#e58a96]",
    slate: "text-[#b9c6da]",
    teal: "text-[var(--teal)]",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}，${count} 件，查看详情`}
      className="group rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-left shadow-[0_8px_24px_rgba(0,0,0,0.25)] transition duration-300 hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] sm:px-5"
    >
      <div className="flex items-baseline gap-2">
        <span
          className={`text-[40px] font-bold leading-none tabular-nums transition-transform duration-300 group-hover:scale-[1.04] ${tones[tone]}`}
          style={{ fontFamily: "var(--font-display)" }}
        >
          {count}
        </span>
        <span className="text-sm text-[var(--dim)]">件</span>
      </div>
      <div className="mt-2 text-[15px] font-medium text-[var(--text)]">{label}</div>
      <div className="mt-0.5 truncate text-xs text-[var(--faint)]">{hint}</div>
    </button>
  );
}

function StatusList({
  title,
  entries,
  emptyText,
}: {
  title: string;
  entries: StatusEntry[];
  emptyText: string;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.22)] sm:p-5">
      <h3 className="text-sm font-semibold tracking-wide text-[var(--dim)]">{title}</h3>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--faint)]">{emptyText}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span
                className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                  e.is_headline ? "bg-[var(--accent)]" : "bg-[var(--faint)]"
                }`}
              />
              <div className="min-w-0">
                <p
                  className={`text-[15px] leading-relaxed ${
                    e.is_headline ? "font-semibold text-[var(--text)]" : "text-[#d7dde8]"
                  }`}
                >
                  {e.title}
                </p>
                {e.detail ? (
                  <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--dim)]">{e.detail}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PipelineCard({ item, index }: { item: PipelineItem; index: number }) {
  const [open, setOpen] = useState(index === 0);
  const useRose = [...item.platform].reduce((a, c) => a + c.charCodeAt(0), 0) % 2 === 0;
  return (
    <article className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_24px_rgba(0,0,0,0.22)] transition duration-300 hover:border-[var(--border-strong)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${item.title}，${open ? "收起" : "展开"}详情`}
        className="flex w-full items-start gap-3 px-4 py-4 text-left sm:px-5"
      >
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold tabular-nums"
          style={{
            background: "var(--accent-soft)",
            color: "var(--accent)",
            fontFamily: "var(--font-display)",
          }}
        >
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                useRose
                  ? "bg-[rgba(217,112,126,0.16)] text-[#eda3ad]"
                  : "bg-[var(--teal-soft)] text-[#8fd0c4]"
              }`}
            >
              {item.platform}
            </span>
            <span className="text-xs text-[var(--faint)]">{fmtUpdated(item.updated_at)}</span>
          </span>
          <span className="mt-1.5 block text-[16px] font-semibold leading-snug text-[var(--text)]">
            {item.title}
          </span>
          <span className="mt-1 block text-sm text-[var(--dim)]">阶段：{item.stage}</span>
        </span>
        <span
          className={`mt-1 shrink-0 text-[var(--faint)] transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>
      <div
        className={`grid transition-all duration-300 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <div className="space-y-2.5 border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 sm:px-5">
            {item.missing ? (
              <p className="text-sm leading-relaxed">
                <span className="mr-2 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-xs font-medium text-[var(--accent)]">
                  还缺
                </span>
                <span className="text-[#e6ebf2]">{item.missing}</span>
              </p>
            ) : (
              <p className="text-sm text-[var(--teal)]">万事俱备，可以推进。</p>
            )}
            {item.note ? (
              <p className="text-sm leading-relaxed text-[var(--dim)]">
                <span className="mr-2 text-xs text-[var(--faint)]">备注</span>
                {item.note}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function DeskCard({ desk }: { desk: Desk }) {
  return (
    <article className="flex flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.22)] transition duration-300 hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3
          className="text-[17px] font-semibold text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {desk.name}
        </h3>
        <span className="shrink-0 text-xs text-[var(--faint)]">{fmtUpdated(desk.updated_at)}</span>
      </div>
      {desk.subtitle ? (
        <p className="mt-0.5 text-[13px] text-[var(--faint)]">{desk.subtitle}</p>
      ) : null}
      <p className="mt-3 text-[15px] font-medium leading-relaxed text-[var(--accent)]">
        {desk.metrics}
      </p>
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <p className="text-xs text-[var(--faint)]">下一步</p>
        <p className="mt-1 text-sm leading-relaxed text-[#d7dde8]">{desk.next_step}</p>
      </div>
    </article>
  );
}

const VERDICT_CHIP: Record<Verdict, { label: string; className: string } | null> = {
  pending: null,
  approved: { label: "已拍板", className: "bg-[var(--teal-soft)] text-[#8fd0c4]" },
  redo: { label: "待重做", className: "bg-[var(--accent-soft)] text-[var(--accent)]" },
  dropped: { label: "已去掉", className: "bg-[var(--surface-3)] text-[var(--faint)]" },
};

function InboxRow({
  item,
  onVerdict,
  busy,
}: {
  item: InboxItem;
  onVerdict: (item: InboxItem, verdict: Verdict) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const v = item.verdict;
  const settled = v === "approved" || v === "dropped";
  const chip = VERDICT_CHIP[v];
  const verdictBtn = (verdict: Verdict, label: string, className: string) => (
    <button
      key={verdict}
      type="button"
      disabled={busy}
      onClick={() => onVerdict(item, verdict)}
      aria-label={`${label}：${item.title}`}
      className={`rounded-full px-3.5 py-2 text-[13px] font-medium transition duration-200 disabled:opacity-50 active:scale-95 ${className}`}
    >
      {label}
    </button>
  );
  return (
    <article
      className={`rounded-[var(--radius)] border bg-[var(--surface)] shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition duration-300 ${
        v === "pending"
          ? "border-[rgba(232,163,61,0.28)]"
          : v === "redo"
            ? "border-[rgba(232,163,61,0.18)]"
            : "border-[var(--border)]"
      } ${settled ? "opacity-70" : ""}`}
    >
      <div className="px-4 py-4 sm:px-5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${item.title}，${open ? "收起" : "展开"}利害说明`}
          className="block w-full min-w-0 text-left"
        >
          <span
            className={`block text-[15px] font-medium leading-snug ${
              settled
                ? "text-[var(--dim)] line-through decoration-[var(--faint)]"
                : "text-[var(--text)]"
            }`}
          >
            {item.title}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--faint)]">
            {chip ? (
              <span className={`rounded-full px-2 py-0.5 font-medium ${chip.className}`}>
                {chip.label}
              </span>
            ) : null}
            {item.since ? <span>自 {item.since} 起</span> : null}
            <span>{fmtUpdated(item.updated_at)}</span>
            <span className="text-[var(--accent)]">{open ? "收起 ▴" : "看利害 ▾"}</span>
          </span>
        </button>
        <div className="mt-3 flex flex-wrap gap-2">
          {v === "pending" ? (
            <>
              {verdictBtn(
                "approved",
                "拍板通过",
                "bg-[var(--accent)] text-[#241703] hover:brightness-110",
              )}
              {verdictBtn(
                "redo",
                "打回重做",
                "border border-[rgba(90,167,155,0.45)] text-[#8fd0c4] hover:bg-[var(--teal-soft)]",
              )}
              {verdictBtn(
                "dropped",
                "去掉",
                "border border-[rgba(217,112,126,0.4)] text-[#eda3ad] hover:bg-[rgba(217,112,126,0.12)]",
              )}
            </>
          ) : v === "redo" ? (
            <>
              {verdictBtn(
                "approved",
                "拍板通过",
                "bg-[var(--accent)] text-[#241703] hover:brightness-110",
              )}
              {verdictBtn(
                "dropped",
                "去掉",
                "border border-[rgba(217,112,126,0.4)] text-[#eda3ad] hover:bg-[rgba(217,112,126,0.12)]",
              )}
              {verdictBtn(
                "pending",
                "放回待拍板",
                "border border-[var(--border-strong)] text-[var(--dim)] hover:text-[var(--text)]",
              )}
            </>
          ) : v === "approved" ? (
            verdictBtn(
              "pending",
              "撤销裁决",
              "border border-[var(--border-strong)] text-[var(--dim)] hover:text-[var(--text)]",
            )
          ) : (
            verdictBtn(
              "pending",
              "恢复",
              "border border-[var(--border-strong)] text-[var(--dim)] hover:text-[var(--text)]",
            )
          )}
        </div>
      </div>
      <div
        className={`grid transition-all duration-300 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <p className="border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-3.5 text-sm leading-relaxed text-[#d7dde8] sm:px-5">
            {item.stakes}
          </p>
        </div>
      </div>
    </article>
  );
}

const DESK_TAG_RULES: { match: string; tag: string }[] = [
  { match: "样品图", tag: "等样品图" },
  { match: "待发", tag: "待发布" },
  { match: "发布", tag: "待发布" },
  { match: "拍板", tag: "等拍板" },
  { match: "定稿", tag: "待定稿" },
  { match: "调研", tag: "调研中" },
  { match: "推进", tag: "推进中" },
];

/** Short floating tag for a business desk in the 3D scene, derived from its real next step. */
function shortTagFor(desk: Desk): string {
  const text = `${desk.next_step} ${desk.metrics}`;
  for (const r of DESK_TAG_RULES) {
    if (text.includes(r.match)) return r.tag;
  }
  const first = desk.next_step.split(/[，。；、,;]/)[0]?.trim() ?? "";
  return first.length >= 2 ? first.slice(0, 5) : "进行中";
}

const FALLBACK_DESKS_3D = [
  { name: "业务线 A", short: "进行中" },
  { name: "业务线 B", short: "进行中" },
  { name: "业务线 C", short: "进行中" },
  { name: "业务线 D", short: "进行中" },
  { name: "业务线 E", short: "进行中" },
];

const NAV = [
  { id: "office", label: "办公室" },
  { id: "board", label: "大屏" },
  { id: "pipeline", label: "发布流水线" },
  { id: "desks", label: "业务桌" },
  { id: "inbox", label: "拍板箱" },
] as const;

export function App() {
  const queryClient = useQueryClient();
  const office = useQuery({
    queryKey: ["office"],
    queryFn: () => api.getOffice({}),
  });

  const setVerdict = useMutation({
    mutationFn: async (vars: { id: number; verdict: Verdict }) =>
      await api.setInboxVerdict(vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["office"] }),
  });

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [activeNav, setActiveNav] = useState<string>("board");
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveNav(e.target.id);
        }
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    for (const n of NAV) {
      const el = document.getElementById(n.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [office.data]);

  const scrollTo = (id: string) => {
    setActiveNav(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const data = office.data;
  const working = useMemo(
    () => (data?.status ?? []).filter((s) => s.kind === "working"),
    [data],
  );
  const scheduled = useMemo(
    () => (data?.status ?? []).filter((s) => s.kind === "scheduled"),
    [data],
  );
  const done = useMemo(
    () => (data?.status ?? []).filter((s) => s.kind === "done"),
    [data],
  );
  const pendingItems = useMemo(
    () => (data?.inbox ?? []).filter((i) => i.verdict === "pending"),
    [data],
  );
  const redoItems = useMemo(
    () => (data?.inbox ?? []).filter((i) => i.verdict === "redo"),
    [data],
  );
  const decidedItems = useMemo(
    () => (data?.inbox ?? []).filter((i) => i.verdict === "approved"),
    [data],
  );
  const droppedItems = useMemo(
    () => (data?.inbox ?? []).filter((i) => i.verdict === "dropped"),
    [data],
  );
  const waitingCount = pendingItems.length;

  const hour = now.getHours();
  const phase = phaseFor(hour);
  const sky = SKY[phase];
  const headline = working.find((w) => w.is_headline) ?? working[0];
  const mood: "working" | "waiting" | "resting" =
    working.length > 0 ? "working" : waitingCount > 0 ? "waiting" : "resting";
  const badgeText =
    mood === "working" ? "干活中" : mood === "waiting" ? "等你拍板" : "歇口气";
  const clock = `${String(hour).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const dateLine = `${now.getMonth() + 1}月${now.getDate()}日 · 星期${"日一二三四五六"[now.getDay()] ?? ""}`;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />

      {/* ——— 3D office scene (first screen hero) ——— */}
      <header className="relative overflow-hidden">
        <div
          className="absolute inset-0 transition-all duration-1000"
          style={{
            background: `linear-gradient(160deg, ${sky.from} 0%, ${sky.to} 78%, #0b111e 100%)`,
          }}
          aria-hidden="true"
        />
        <div
          id="office"
          className="relative h-[68svh] max-h-[680px] min-h-[460px] scroll-mt-16"
        >
          <div className="absolute inset-0">
            <Office3D
              working={working.length}
              waiting={waitingCount}
              scheduled={scheduled.length}
              done={done.length}
              headline={headline?.title}
              tasks={working.map((w) => w.title)}
              desks={
                data && data.desks.length > 0
                  ? data.desks.map((d) => ({ name: d.name, short: shortTagFor(d) }))
                  : FALLBACK_DESKS_3D
              }
              mood={mood}
              phase={phase}
            />
          </div>
          {/* greeting overlay — floats over the scene, never blocks dragging */}
          <div className="office-rise pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center px-4 pt-5 text-center sm:pt-7">
            <span className="flex items-center gap-1.5 rounded-full border border-[rgba(232,163,61,0.4)] bg-[#0d1424]/80 px-3 py-1 text-xs font-medium text-[var(--accent)] shadow-lg backdrop-blur">
              <span
                className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
                style={{ animation: "status-pulse 2.2s ease-in-out infinite" }}
              />
              Muse 在主工位 · {badgeText}
            </span>
            <h1
              className="mt-3 text-[26px] font-semibold leading-snug drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] sm:text-[30px]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {greetingFor(hour)}，老板
            </h1>
            <p className="mt-1 text-sm text-[#c3cede] drop-shadow-[0_1px_6px_rgba(0,0,0,0.7)]">
              {dateLine} · {clock}
              {phase === "night" ? " · 办公室的灯还亮着" : ""}
            </p>
            {headline ? (
              <p className="mt-3 hidden max-w-xl rounded-2xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm leading-relaxed text-[#f0e9d8] backdrop-blur-sm sm:block">
                <span className="mr-2 text-xs font-medium tracking-wider text-[var(--accent)]">
                  正在忙
                </span>
                {headline.title}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      {/* ——— Sticky nav ——— */}
      <nav
        aria-label="办公室分区"
        className="sticky top-0 z-20 border-b border-[var(--border)] bg-[rgba(11,17,30,0.88)] backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => scrollTo(n.id)}
              aria-current={activeNav === n.id ? "true" : undefined}
              className={`relative shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition duration-200 sm:px-4 sm:py-2 sm:text-sm ${
                activeNav === n.id
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--dim)] hover:text-[var(--text)]"
              }`}
            >
              {n.label}
              {n.id === "inbox" && waitingCount > 0 ? (
                <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-bold tabular-nums text-[#241703]">
                  {waitingCount}
                </span>
              ) : null}
            </button>
          ))}
          {data ? (
            <span className="ml-auto hidden text-xs text-[var(--faint)] sm:block">
              {fmtUpdated(latestUpdated([...data.status, ...data.pipeline, ...data.desks, ...data.inbox]))}
            </span>
          ) : null}
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-4 pb-10 sm:px-6">
        {office.isPending ? (
          <div className="py-20 text-center" role="status">
            <div className="mx-auto h-16 w-16 opacity-80">
              <Mascot mood="working" />
            </div>
            <p className="mt-4 text-sm text-[var(--dim)]">正在开灯、摆桌子…</p>
          </div>
        ) : office.error ? (
          <div className="py-20 text-center">
            <p className="text-[15px] text-[#eda3ad]">办公室的灯没打开。</p>
            <button
              type="button"
              onClick={() => office.refetch()}
              className="mt-4 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[#241703] transition hover:brightness-110"
            >
              再试一次
            </button>
          </div>
        ) : data && data.status.length === 0 && data.pipeline.length === 0 ? (
          <div className="py-20 text-center">
            <div className="mx-auto h-16 w-16 opacity-80">
              <Mascot mood="resting" />
            </div>
            <p className="mt-4 text-[15px] text-[var(--text)]">办公室刚落成，桌子还是空的。</p>
            <p className="mt-1 text-sm text-[var(--dim)]">Muse 查办完第一轮，就会把状态填进来。</p>
          </div>
        ) : data ? (
          <>
            {/* ——— 大屏 ——— */}
            <section aria-label="状态大屏" className="pt-7">
              <SectionHeading
                id="board"
                title="老板大屏"
                sub="Muse 此刻的状态"
                updated={latestUpdated(data.status)}
              />
              <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-4">
                <CounterTile
                  label="正在干"
                  count={working.length}
                  hint={headline ? headline.title : "暂无进行中的事"}
                  tone="amber"
                  onClick={() => scrollTo("board")}
                />
                <CounterTile
                  label="等你拍板"
                  count={waitingCount}
                  hint={
                    pendingItems[0]
                      ? pendingItems[0].title
                      : redoItems.length > 0
                        ? `${redoItems.length} 件已打回重做`
                        : "没有悬着的事"
                  }
                  tone="rose"
                  onClick={() => scrollTo("inbox")}
                />
                <CounterTile
                  label="定时任务"
                  count={scheduled.length}
                  hint={scheduled[0] ? scheduled[0].title : "暂无定时任务"}
                  tone="slate"
                  onClick={() => scrollTo("board")}
                />
                <CounterTile
                  label="今日已完成"
                  count={done.length}
                  hint={done[0] ? done[0].title : "今天还没收尾的事"}
                  tone="teal"
                  onClick={() => scrollTo("board")}
                />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <StatusList title="正在干" entries={working} emptyText="手头暂时没活。" />
                <StatusList title="定时任务" entries={scheduled} emptyText="没有在跑的定时任务。" />
                <StatusList title="今日已完成" entries={done} emptyText="今天还没有完成项。" />
              </div>
            </section>

            {/* ——— 发布流水线 ——— */}
            <section aria-label="发布流水线" className="pt-10">
              <SectionHeading
                id="pipeline"
                title="发布流水线"
                sub="作品发布第一 · 按优先级排"
                updated={latestUpdated(data.pipeline)}
              />
              <div className="mt-5 space-y-3">
                {data.pipeline.map((item, i) => (
                  <PipelineCard key={item.id} item={item} index={i} />
                ))}
                {data.pipeline.length === 0 ? (
                  <p className="rounded-[var(--radius)] border border-dashed border-[var(--border-strong)] px-4 py-8 text-center text-sm text-[var(--faint)]">
                    流水线上暂时没有待发的作品。
                  </p>
                ) : null}
              </div>
            </section>

            {/* ——— 业务桌 ——— */}
            <section aria-label="业务桌" className="pt-10">
              <SectionHeading
                id="desks"
                title="业务桌"
                sub="每个摊子一张桌，只放状态和下一步"
                updated={latestUpdated(data.desks)}
              />
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.desks.map((desk) => (
                  <DeskCard key={desk.id} desk={desk} />
                ))}
              </div>
            </section>

            {/* ——— 拍板箱 ——— */}
            <section aria-label="拍板收件箱" className="pt-10">
              <SectionHeading
                id="inbox"
                title="拍板收件箱"
                sub={
                  waitingCount > 0
                    ? `${waitingCount} 件等你一句话`
                    : redoItems.length > 0
                      ? `${redoItems.length} 件打回重做中`
                      : "都处理完了，难得清净"
                }
                updated={latestUpdated(data.inbox)}
              />
              <div className="mt-5 space-y-3">
                {pendingItems.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    busy={setVerdict.isPending}
                    onVerdict={(it, v) => setVerdict.mutate({ id: it.id, verdict: v })}
                  />
                ))}
                {pendingItems.length === 0 &&
                (decidedItems.length > 0 ||
                  redoItems.length > 0 ||
                  droppedItems.length > 0) ? (
                  <p className="rounded-[var(--radius)] border border-[var(--teal-soft)] bg-[var(--teal-soft)] px-4 py-4 text-center text-sm text-[#8fd0c4]">
                    待拍板的都处理完了。
                  </p>
                ) : null}
                {redoItems.length > 0 ? (
                  <div className="pt-2">
                    <p className="mb-2 text-xs font-medium tracking-wide text-[var(--faint)]">
                      打回重做 · {redoItems.length} 件
                    </p>
                    <div className="space-y-3">
                      {redoItems.map((item) => (
                        <InboxRow
                          key={item.id}
                          item={item}
                          busy={setVerdict.isPending}
                          onVerdict={(it, v) =>
                            setVerdict.mutate({ id: it.id, verdict: v })
                          }
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {decidedItems.length > 0 ? (
                  <div className="pt-2">
                    <p className="mb-2 text-xs font-medium tracking-wide text-[var(--faint)]">
                      已拍板 · {decidedItems.length} 件
                    </p>
                    <div className="space-y-3">
                      {decidedItems.map((item) => (
                        <InboxRow
                          key={item.id}
                          item={item}
                          busy={setVerdict.isPending}
                          onVerdict={(it, v) =>
                            setVerdict.mutate({ id: it.id, verdict: v })
                          }
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {droppedItems.length > 0 ? (
                  <div className="pt-2">
                    <p className="mb-2 text-xs font-medium tracking-wide text-[var(--faint)]">
                      已去掉 · {droppedItems.length} 件
                    </p>
                    <div className="space-y-3">
                      {droppedItems.map((item) => (
                        <InboxRow
                          key={item.id}
                          item={item}
                          busy={setVerdict.isPending}
                          onVerdict={(it, v) =>
                            setVerdict.mutate({ id: it.id, verdict: v })
                          }
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <footer className="mt-12 border-t border-[var(--border)] pt-5 pb-2 text-center">
              <p className="text-xs leading-relaxed text-[var(--faint)]">
                数据由 Muse 查办后回填，非平台实时同步；每项都标了更新时间，旧数不会冒充现况。
              </p>
            </footer>
          </>
        ) : null}
      </main>
    </div>
  );
}
