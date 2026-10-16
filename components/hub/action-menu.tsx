"use client";
import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";

/** Keep row actions inside the viewport, including the final row on the page. */
export function JobActionMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  function position() {
    const element = details.current;
    const anchor = element?.querySelector("summary");
    const menu = element?.querySelector<HTMLElement>(".hub-job-menu-items");
    if (!element?.open || !anchor || !menu) return;
    const gutter = 16, gap = 8;
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) { element.open = false; return; }
    const width = Math.min(280, window.innerWidth - gutter * 2);
    menu.style.width = `${width}px`;
    const above = Math.max(0, rect.top - gutter - gap);
    const below = Math.max(0, window.innerHeight - rect.bottom - gutter - gap);
    const height = Math.min(menu.scrollHeight, 360);
    const opensAbove = below < height && above > below;
    const available = opensAbove ? above : below;
    const boundedHeight = Math.min(height, available);
    menu.style.maxHeight = `${Math.min(360, available)}px`;
    menu.style.left = `${Math.max(gutter, Math.min(rect.right - width, window.innerWidth - width - gutter))}px`;
    menu.style.right = "auto";
    menu.style.top = `${opensAbove ? Math.max(gutter, rect.top - gap - boundedHeight) : rect.bottom + gap}px`;
  }
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (details.current?.open && !details.current.contains(event.target as Node)) details.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, []);
  return <details ref={details} className="hub-job-menu" name="hub-job-actions" onToggle={position} onKeyDown={event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus();
  }}>
    <summary aria-label={label} onClick={event => {
      // The native toggle event is deferred; position before the open menu paints.
      event.preventDefault();
      const element = details.current!;
      element.open = !element.open;
      position();
    }}>Actions <ChevronDown size={14} /></summary>
    <div className="hub-job-menu-items" onClick={event => {
      // Every current item invokes one action; close it before navigation/dialogs.
      if ((event.target as Element).closest("button:not(:disabled),a")) details.current!.open = false;
    }}>{children}</div>
  </details>;
}
