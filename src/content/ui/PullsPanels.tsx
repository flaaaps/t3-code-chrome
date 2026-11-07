import { isActiveStatus, type PromptTemplate } from "@shared/models";
import { prKeyToString, pullsPath } from "@shared/prKey";
import {
  groupStacks,
  type PanelEntry,
  type PanelId,
  type PrListItem,
  panelQuery,
  primaryActionFor,
  sortPanelEntries,
} from "@shared/pulls";
import { usesStackReview } from "@shared/templates/render";
import { useEffect, useRef, useState } from "preact/hooks";
import { Alert, Icon, relativeTime, Spinner, StatusChip, statusLabel } from "./components";
import * as pulls from "./pullsStore";
import * as store from "./store";

const PANELS: Array<{ id: PanelId; title: string; empty: string }> = [
  { id: "review", title: "Review angefragt", empty: "Niemand wartet auf dein Review." },
  { id: "mine", title: "Meine Pull Requests", empty: "Keine offenen Pull Requests von dir oder für dich." },
];

/** Panels above GitHub's PR list: review requests first, then the viewer's own PRs. */
export function PullsPanels() {
  const status = pulls.status.value;
  const collapsed = pulls.collapsed.value;
  const data = pulls.panels.value;
  if (!pulls.repo.value) return null;

  return (
    <section
      class={`t3-box t3-pulls ${collapsed ? "collapsed" : ""}`}
      aria-label="T3 Code: Pull-Request-Übersicht"
    >
      <header class="t3-box-head">
        <span class="title">
          <Icon name="t3" /> T3 Code
        </span>
        <HeadSummary />
        <span class="spacer" />
        <button
          type="button"
          class="t3-btn quiet small"
          title="Neu laden"
          aria-label="Neu laden"
          disabled={status === "loading"}
          onClick={() => void pulls.reload(true)}
        >
          {status === "loading" ? <Spinner /> : <Icon name="refresh" size={14} />}
        </button>
        <button
          type="button"
          class="t3-btn quiet small"
          aria-expanded={!collapsed}
          onClick={() => pulls.setCollapsed(!collapsed)}
        >
          {collapsed ? "Ausklappen" : "Einklappen"}
        </button>
      </header>
      {collapsed ? null : status === "error" ? (
        <div class="t3-pulls-body">
          <Alert kind="error">
            <span>{pulls.error.value ?? "Die GitHub-Liste konnte nicht gelesen werden."}</span>
            <span>
              <button type="button" class="t3-btn small" onClick={() => void pulls.reload(true)}>
                Erneut versuchen
              </button>
            </span>
          </Alert>
        </div>
      ) : (
        <div class="t3-pulls-body">
          {PANELS.map((panel) => (
            <Panel
              key={panel.id}
              id={panel.id}
              title={panel.title}
              empty={panel.empty}
              items={data ? data[panel.id] : undefined}
              total={data?.totals[panel.id]}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function HeadSummary() {
  const link = pulls.t3Link.value;
  if (link === "none" || link === "unpaired") {
    return (
      <button type="button" class="t3-btn link" onClick={() => void pulls.openSetup()}>
        T3 Code einrichten
      </button>
    );
  }
  if (link === "offline" || link === "error") {
    return (
      <button
        type="button"
        class="t3-btn link"
        title={pulls.t3Error.value}
        onClick={() => void pulls.refreshSessions(true)}
      >
        T3 Code offline · erneut prüfen
      </button>
    );
  }
  const waiting = pulls.waitingCount.value;
  const running = pulls.runningCount.value;
  if (waiting === 0 && running === 0) return null;
  return (
    <span class="counts">
      {waiting > 0 ? (
        <span>
          <span class="t3-dot waiting" /> {waiting} wartet
        </span>
      ) : null}
      {running > 0 ? (
        <span>
          <span class="t3-dot running" /> {running} läuft
        </span>
      ) : null}
    </span>
  );
}

function Panel({
  id,
  title,
  empty,
  items,
  total,
}: {
  id: PanelId;
  title: string;
  empty: string;
  items: PrListItem[] | undefined;
  total: number | undefined;
}) {
  const repo = pulls.repo.value;
  const headingId = `t3-panel-${id}`;
  const sorted = items
    ? sortPanelEntries(groupStacks(items, pulls.branches.value), pulls.sessionsByPr.value)
    : undefined;
  const more = items && total !== undefined ? total - items.length : 0;
  return (
    <section class="t3-panel" aria-labelledby={headingId}>
      <div class="t3-panel-head">
        <h3 id={headingId}>{title}</h3>
        {items ? <span class="t3-counter">{total ?? items.length}</span> : null}
        <span class="spacer" />
        {repo && items ? (
          <a class="t3-panel-link" href={pullsPath(repo, panelQuery(id))}>
            {more > 0 ? `+ ${more} weitere auf GitHub` : "Auf GitHub filtern"}
          </a>
        ) : null}
      </div>
      {!sorted ? (
        <ul class="t3-prlist" aria-busy="true">
          <SkeletonRow />
          <SkeletonRow />
        </ul>
      ) : sorted.length === 0 ? (
        <p class="t3-panel-empty">{empty}</p>
      ) : (
        <ul class="t3-prlist">
          {sorted.map((entry) => (
            <StackRows key={prKeyToString(entry.root)} entry={entry} panel={id} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SkeletonRow() {
  return (
    <li class="t3-prrow skeleton" aria-hidden="true">
      <span class="t3-skel icon" />
      <span class="main">
        <span class="t3-skel line" style={{ width: "55%" }} />
        <span class="t3-skel line short" style={{ width: "30%" }} />
      </span>
    </li>
  );
}

function SessionSummary({ item }: { item: PrListItem }) {
  const sessions = pulls.sessionsFor(item);
  if (sessions.length === 0) return null;
  const top = sessions[0];
  if (!top) return null;
  const waiting = sessions.filter((s) => s.status === "waiting").length;
  const label =
    sessions.length > 1
      ? `${sessions.length} Sessions${waiting > 0 ? ` · ${waiting} wartet` : ""}`
      : top.status === "completed"
        ? `fertig · ${relativeTime(top.updatedAt)}`
        : statusLabel(top.status);
  const quote = top.pending?.[0]?.text ?? (top.status === "waiting" ? top.lastMessage?.text : undefined);
  return (
    <span class="t3-prrow-session" title={top.title}>
      <StatusChip status={top.status}>{label}</StatusChip>
      <span class="what">{quote ? `„${quote}“` : top.title}</span>
    </span>
  );
}

function LabelChip({ name, color }: { name: string; color?: string | undefined }) {
  const style = color
    ? {
        "--label": `#${color}`,
      }
    : undefined;
  return (
    <span class={`t3-label ${color ? "colored" : ""}`} style={style}>
      {name}
    </span>
  );
}

/** A single PR, or the bottom of a stack with a toggle for the PRs built on top of it. */
function StackRows({ entry, panel }: { entry: PanelEntry; panel: PanelId }) {
  const key = prKeyToString(entry.root);
  if (entry.stacked.length === 0)
    return <PrRow item={entry.root} panel={panel} inStack={!!entry.root.stack} />;
  const expanded = pulls.expandedStacks.value.has(key);
  return (
    <>
      <PrRow
        item={entry.root}
        panel={panel}
        inStack
        stack={{ entry, expanded, onToggle: () => pulls.toggleStack(key) }}
      />
      {expanded
        ? entry.stacked.map(({ item, depth, parent }) => (
            <PrRow
              key={prKeyToString(item)}
              item={item}
              panel={panel}
              inStack
              stackedOn={{ depth, parent }}
            />
          ))
        : null}
    </>
  );
}

function StackToggle({
  entry,
  expanded,
  onToggle,
}: {
  entry: PanelEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hidden = entry.stacked.flatMap((s) => pulls.sessionsFor(s.item));
  const waiting = hidden.filter((s) => s.status === "waiting").length;
  const running = hidden.filter((s) => isActiveStatus(s.status) && s.status !== "waiting").length;
  const size = entry.stacked.length + 1;
  return (
    <button
      type="button"
      class={`t3-stack-toggle ${expanded ? "open" : ""}`}
      aria-expanded={expanded}
      title={expanded ? "Stack zuklappen" : `${size - 1} darauf aufbauende PRs zeigen`}
      onClick={onToggle}
    >
      <Icon name="chevron" size={12} />
      Stack · {size} PRs
      {!expanded && waiting > 0 ? <span class="t3-dot waiting" /> : null}
      {!expanded && waiting === 0 && running > 0 ? <span class="t3-dot running" /> : null}
    </button>
  );
}

function PrRow({
  item,
  panel,
  inStack = false,
  stack,
  stackedOn,
}: {
  item: PrListItem;
  panel: PanelId;
  /** Part of a stack the list knows of (native, or grouped by branches). */
  inStack?: boolean;
  stack?: { entry: PanelEntry; expanded: boolean; onToggle: () => void };
  stackedOn?: { depth: number; parent: number };
}) {
  const viewer = pulls.viewer.value;
  const assignedOnly = item.roles.includes("assignee") && !item.roles.includes("author");
  const classes = ["t3-prrow", stack?.expanded ? "stack-root" : "", stackedOn ? "stacked" : ""].join(" ");
  return (
    <li class={classes} style={stackedOn ? { "--depth": String(stackedOn.depth) } : undefined}>
      <span class={`state ${item.isDraft ? "draft" : "open"}`} title={item.isDraft ? "Draft" : "Offen"}>
        <Icon name={item.isDraft ? "pr-draft" : "pr"} />
      </span>
      <span class="main">
        <span class="line1">
          <a class="title" href={item.url}>
            {item.title}
          </a>
          {item.labels.map((label) => (
            <LabelChip key={label.name} name={label.name} color={label.color} />
          ))}
        </span>
        <span class="line2">
          {stack ? <StackToggle {...stack} /> : null}
          {stackedOn ? <span class="t3-stacked-on">baut auf #{stackedOn.parent} auf</span> : null}
          {!stack && !stackedOn && item.stack ? (
            <span
              class="t3-badge"
              title={`Teil eines GitHub-Stacks, Position ${item.stack.position} von ${item.stack.size} (von unten)`}
            >
              Stack {item.stack.position}/{item.stack.size}
            </span>
          ) : null}
          <span>#{item.number}</span>
          {item.author ? (
            <span>{item.author.toLowerCase() === viewer?.toLowerCase() ? "von dir" : item.author}</span>
          ) : null}
          {item.updatedAt ? <span>aktualisiert {relativeTime(item.updatedAt)}</span> : null}
          {item.commentCount ? (
            <span class="comments" title={`${item.commentCount} Kommentare`}>
              <Icon name="comment" size={12} /> {item.commentCount}
            </span>
          ) : null}
          {item.isDraft ? <span class="t3-badge">Draft</span> : null}
          {assignedOnly ? <span class="t3-badge">zugewiesen</span> : null}
          <SessionSummary item={item} />
        </span>
      </span>
      <RowActions item={item} panel={panel} inStack={inStack} />
    </li>
  );
}

function RowActions({ item, panel, inStack }: { item: PrListItem; panel: PanelId; inStack: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const sessions = pulls.sessionsFor(item);
  const templates = store.templates.value;
  const link = pulls.t3Link.value;
  const busy = pulls.busyKey.value === prKeyToString(item);
  const blocked = !!pulls.busyKey.value || pulls.countdownActive.value;
  const action = primaryActionFor(item, panel, sessions, templates, pulls.viewer.value);
  const usable = link === "ready" || link === "unknown";
  const suggestedId = action.kind === "intent" ? action.template.id : undefined;
  const defaultIntentId = suggestedId ?? (panel === "mine" ? "builtin:summarize" : "builtin:review");
  // A review of a PR the list knows to be stacked covers the whole stack (looked up on click).
  const coversStack = (template: PromptTemplate) =>
    inStack && store.composerReviewStack.value && usesStackReview(template);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: Event) => {
      if (wrap.current && !event.composedPath().includes(wrap.current)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
      if (items.length === 0) return;
      event.preventDefault();
      const root = wrap.current?.getRootNode() as Document | ShadowRoot | undefined;
      const index = items.indexOf(root?.activeElement as HTMLButtonElement);
      const next =
        event.key === "ArrowDown"
          ? items[(index + 1) % items.length]
          : items[(index - 1 + items.length) % items.length];
      next?.focus();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    const first = menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]");
    first?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const runPrimary = () => {
    if (action.kind === "open") void pulls.openSession(action.session);
    else void pulls.runIntent(item, action.template.id);
  };
  const primaryDisabled = !usable || (action.kind === "intent" && blocked);
  const primaryTitle = !usable
    ? "T3 Code ist nicht verbunden"
    : action.kind === "open"
      ? `${action.session.title} in T3 Code öffnen`
      : blocked && !busy
        ? "Warte auf den laufenden Start"
        : `${action.label} für #${item.number}${coversStack(action.template) ? " (ganzer Stack)" : ""}`;

  return (
    <div class="t3-menu-wrap t3-prrow-actions" ref={wrap}>
      <div class={`t3-split small ${usable && !primaryDisabled ? "primary" : ""}`}>
        <button type="button" disabled={primaryDisabled || busy} title={primaryTitle} onClick={runPrimary}>
          {busy ? (
            <Spinner label="Lade PR" />
          ) : (
            <Icon name={action.kind === "open" ? "external" : "play"} size={12} />
          )}
          <span class="label">{busy ? "Lade PR…" : action.label}</span>
        </button>
        <button
          type="button"
          ref={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Weitere Aktionen für #${item.number}`}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="chevron" size={12} />
        </button>
      </div>
      <div class="t3-menu" role="menu" hidden={!open} ref={menu}>
        {!usable ? (
          <button
            type="button"
            role="menuitem"
            class="t3-menu-item primary"
            onClick={() => {
              setOpen(false);
              void pulls.openSetup();
            }}
          >
            <span class="label">T3 Code einrichten…</span>
          </button>
        ) : (
          <>
            {sessions.length > 0 ? (
              <>
                <div class="t3-menu-group">Sessions zu #{item.number}</div>
                {sessions.slice(0, 5).map((session) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={session.key}
                    class="t3-menu-item"
                    title={`${session.title} in T3 Code öffnen`}
                    onClick={() => {
                      setOpen(false);
                      void pulls.openSession(session);
                    }}
                  >
                    <StatusChip status={session.status} />
                    <span class="label ellipsis">{session.title}</span>
                    <Icon name="external" size={12} />
                  </button>
                ))}
                <div class="t3-menu-sep" />
              </>
            ) : null}
            {templates.map((template) => (
              <button
                type="button"
                role="menuitem"
                key={template.id}
                class={`t3-menu-item ${template.id === suggestedId ? "primary" : ""}`}
                disabled={blocked}
                onClick={() => {
                  setOpen(false);
                  void pulls.runIntent(item, template.id);
                }}
              >
                <span class="label">{template.actionLabel ?? template.name}</span>
                {template.id === suggestedId ? <span class="hint">Standard</span> : null}
                {coversStack(template) ? <span class="hint">ganzer Stack</span> : null}
              </button>
            ))}
            <div class="t3-menu-sep" />
            <button
              type="button"
              role="menuitem"
              class="t3-menu-item"
              disabled={!!pulls.busyKey.value}
              onClick={() => {
                setOpen(false);
                void pulls.openComposerFor(item, defaultIntentId);
              }}
            >
              <span class="label">Anpassen…</span>
            </button>
            <div class="t3-menu-target">
              Ziel: passendes Projekt ·{" "}
              {store.settings.value.defaultWorkspace === "worktree"
                ? "Worktree auf dem PR-Branch"
                : "Projekt-Checkout"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
