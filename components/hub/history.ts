/** Own query-only workspace traversal before framework hydration. Keep actual
 * history entries intact when an unsaved editor temporarily blocks Back/Forward. */
export const HUB_HISTORY_GUARD = `(function(){
  if(window.__aiclHubHistoryGuard)return;
  window.__aiclHubHistoryGuard=true;
  var path=window.location.pathname,index=Number(window.history.state&&window.history.state.aiclHistoryIndex)||0,restoring=false;
  var push=window.history.pushState.bind(window.history),replace=window.history.replaceState.bind(window.history);
  replace(Object.assign({},window.history.state,{aiclHistoryIndex:index}),'',window.location.href);
  window.history.pushState=function(state,title,url){index++;push(Object.assign({},state,{aiclHistoryIndex:index}),title,url);};
  window.history.replaceState=function(state,title,url){replace(Object.assign({},state,{aiclHistoryIndex:index}),title,url);};
  window.addEventListener('popstate',function(event){
    if(window.location.pathname!==path||!document.querySelector('[data-hiring-workspace]'))return;
    event.stopImmediatePropagation();
    var targetIndex=event.state&&event.state.aiclHistoryIndex;
    if(typeof targetIndex!=='number')targetIndex=index-1;
    if(restoring){restoring=false;index=targetIndex;return;}
    var target=window.location.href,delta=targetIndex-index;
    if(delta&&window.__aiclDraftGuard&&window.__aiclDraftGuard(function(){window.history.go(targetIndex-index);},target)){
      restoring=true;window.history.go(-delta);return;
    }
    index=targetIndex;
    window.dispatchEvent(new Event('hub:navigate'));
  },true);
})();`;
