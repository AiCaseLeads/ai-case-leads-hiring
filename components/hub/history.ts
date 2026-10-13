/**
 * Run in the server-rendered /team document before framework hydration. Window
 * popstate listeners can run in registration order even for capture listeners:
 * a component effect is too late to stop a framework RSC traversal from starting.
 * Only a mounted hiring workspace owns query changes on its own pathname.
 * Navigating to/from another page remains the framework/browser's responsibility.
 */
export const HUB_HISTORY_GUARD = `(function(){
  if(window.__aiclHubHistoryGuard)return;
  window.__aiclHubHistoryGuard=true;
  var path=window.location.pathname;
  window.addEventListener('popstate',function(event){
    if(window.location.pathname!==path||!document.querySelector('[data-hiring-workspace]'))return;
    event.stopImmediatePropagation();
    window.dispatchEvent(new Event('hub:navigate'));
  },true);
})();`;
