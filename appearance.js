(function(){'use strict';
 const media=matchMedia('(prefers-color-scheme: dark)');
 let systemDark=window.PenDesktopAPI?PenDesktopAPI.dark:media.matches;let theme='system';try{theme=JSON.parse(localStorage.getItem('bambu-ui-preferences')||'{}').theme||'system';}catch{}
 if(!['system','light','dark'].includes(theme))theme='system';
 function apply(){document.documentElement.dataset.theme=theme==='system'?(systemDark?'dark':'light'):theme;document.documentElement.dataset.themeChoice=theme;window.dispatchEvent(new Event('penappearancechange'));}
 apply();if(window.PenDesktopAPI?.onSystemTheme)PenDesktopAPI.onSystemTheme(dark=>{systemDark=dark;apply();});else media.addEventListener('change',()=>{systemDark=media.matches;apply();});
 window.PenAppearance={get theme(){return theme;},async setTheme(value){
  if(!['system','light','dark'].includes(value))throw Error('Invalid theme');
  if(window.PenDesktopAPI?.setPreferences)await PenDesktopAPI.setPreferences({theme:value});
  theme=value;try{localStorage.setItem('bambu-ui-preferences',JSON.stringify({theme}));}catch{}apply();
 }};
})();
