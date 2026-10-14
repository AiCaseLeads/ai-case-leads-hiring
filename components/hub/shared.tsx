"use client";
import { AlertCircle, Check, LoaderCircle, RefreshCw } from "lucide-react";
import { Children, cloneElement, isValidElement, useId } from "react";
export function ResourceState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  if (loading)
    return (
      <div className="hub-loading" role="status">
        <LoaderCircle size={20} className="hub-spinner" /> Loading hiring
        records…
      </div>
    );
  if (error)
    return (
      <div className="hub-notice hub-error" role="alert">
        <AlertCircle size={20} />
        <div>
          <p>{error}</p>
          <button className="hub-button secondary" onClick={retry}>
            <RefreshCw size={15} /> Try again
          </button>
        </div>
      </div>
    );
  return null;
}
export function Feedback({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  return (
    <>
      {error && (
        <p className="hub-notice hub-error" role="alert">
          <AlertCircle size={17} />
          {error}
        </p>
      )}
      {success && (
        <p className="hub-notice hub-success" role="status">
          <Check size={17} />
          {success}
        </p>
      )}
    </>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"hub-badge " + tone}>{children}</span>;
}
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="hub-empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  const id = useId(),
    descriptionId = id + "-description";
  const path = controlPath(children);
  return (
    <div className="hub-field">
      <label htmlFor={id}>{label}</label>
      {path
        ? bindControl(children, path, id, hint ? descriptionId : undefined)
        : children}
      {hint && <small id={descriptionId}>{hint}</small>}
    </div>
  );
}

function formControl(
  node: React.ReactNode,
): node is React.ReactElement<Record<string, unknown>> {
  return (
    isValidElement<Record<string, unknown>>(node) &&
    ((typeof node.type === "string" &&
      ["input", "select", "textarea"].includes(node.type)) ||
      node.props["data-field-control"] === true)
  );
}
function controlPath(children: React.ReactNode): number[] | null {
  const nodes = Children.toArray(children);
  const index = nodes.findIndex(
    (node) =>
      formControl(node) ||
      (isValidElement<Record<string, unknown>>(node) &&
        controlPath(node.props.children as React.ReactNode) !== null),
  );
  if (index < 0) return null;
  const node = nodes[index];
  if (formControl(node)) return [index];
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  return [
    index,
    ...(controlPath(node.props.children as React.ReactNode) || []),
  ];
}
function bindControl(
  children: React.ReactNode,
  path: number[],
  id: string,
  descriptionId?: string,
): React.ReactNode {
  return Children.toArray(children).map((node, index) => {
    if (index !== path[0] || !isValidElement<Record<string, unknown>>(node))
      return node;
    return path.length === 1
      ? cloneElement(node, {
          id,
          ...(descriptionId ? { "aria-describedby": descriptionId } : {}),
        })
      : cloneElement(node, {
          children: bindControl(
            node.props.children as React.ReactNode,
            path.slice(1),
            id,
            descriptionId,
          ),
        });
  });
}
