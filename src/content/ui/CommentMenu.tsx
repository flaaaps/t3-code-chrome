import type { CommentContext } from "@shared/models";
import { isActiveStatus } from "@shared/models";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./components";
import * as store from "./store";

/** `[T3 ▾]` next to a review comment: implement, answer, or attach to the PR's session. */
export function CommentMenu({ read }: { read: () => CommentContext }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: Event) => {
      if (wrap.current && !event.composedPath().includes(wrap.current)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const linked = store.sessions.value.find((s) => isActiveStatus(s.status)) ?? store.sessions.value[0];

  const implement = () => {
    setOpen(false);
    store.composerComment.value = read();
    store.composerNote.value = "";
    store.quickDispatch("builtin:reply-comment");
  };
  const answer = () => {
    setOpen(false);
    store.openComposer({
      intentId: "builtin:reply-comment",
      comment: read(),
    });
    store.composerNote.value = "Nur antworten, keine Codeänderung.";
  };
  const attach = () => {
    setOpen(false);
    if (!linked) return;
    store.openComposer({
      intentId: "builtin:free",
      comment: read(),
      target: { kind: "session", session: linked },
    });
  };

  return (
    <span class="t3-menu-wrap" ref={wrap} style="position:relative">
      <button
        type="button"
        class="t3-cbtn"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Diesen Kommentar an T3 Code geben"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Icon name="t3" size={14} /> <Icon name="chevron" size={10} />
      </button>
      <div class="t3-cmenu" role="menu" hidden={!open}>
        <button type="button" role="menuitem" class="t3-menu-item" onClick={implement}>
          <span class="label">Umsetzen</span>
          <span class="hint">Agent ändert den Code</span>
        </button>
        <button type="button" role="menuitem" class="t3-menu-item" onClick={answer}>
          <span class="label">Beantworten</span>
          <span class="hint">nur antworten</span>
        </button>
        {linked ? (
          <button type="button" role="menuitem" class="t3-menu-item" onClick={attach}>
            <span class="label">
              An „{linked.title.length > 28 ? `${linked.title.slice(0, 28)}…` : linked.title}“ anhängen
            </span>
          </button>
        ) : null}
      </div>
    </span>
  );
}
