// A mounted editor owns this guard. No applicant or credential data is stored here.
declare global {
  interface Window {
    __aiclDraftGuard?: (leave: () => void, target?: string) => boolean;
  }
}
export function requestDraftNavigation(leave: () => void, target?: string) {
  if (typeof window !== "undefined" && window.__aiclDraftGuard?.(leave, target))
    return;
  leave();
}
