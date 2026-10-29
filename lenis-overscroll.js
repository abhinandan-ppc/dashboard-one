// lenis-overscroll.js — iOS/Android elastic end-scroll stretch
(function(){'use strict';
  const MAX_STRETCH = 0.2; const PULL_RATIO = 0.5; const SPRING = 0.25;
  const style = document.createElement('style');
  style.textContent = ['html,body{overscroll-behavior:none !important;}','.os-container{overscroll-behavior:contain;}','.os-snap{transition:transform 0.4s cubic-bezier(0.16,1,0.3,1);}','.os-stretched{transform:scaleY(1+var(--os-s,0))transform-origin:top;background:rgba(0,0,0,.05);}'].join('
');
  document.head.appendChild(style);
  function isAtTop(e){return e.scrollTop<=0}
  function isAtBot(e){return e.scrollHeight-e.clientHeight-1<=e.scrollTop}
  function setup(el){
    if(el.dataset.osReady)return;
    el.dataset.osReady='1'; el.classList.add('os-container');
    let S={dir:null,scale:0,raf:null,rel:false};
    function release(){if(S.rel||S.scale===0)return;
      S.rel=true;el.classList.add('os-snap');
      (function f(){S.scale*=(1-SPRING);
        if(Math.abs(S.scale)<0.01){S.scale=0;el.classList.remove('os-stretched');el.removeAttribute('data-os-dir');el.style.removeProperty('--os-s');S.rel=false;S.raf=null;return}
      apply();S.raf=requestAnimationFrame(f)
      })()
    }
    function apply(){el.style.setProperty('--os-s',S.scale);el.dataset.osDir=S.scale>0?S.dir:null}
    function onWheel(e){if(S.rel)return;const atTop=isAtTop(el),atBot=isAtBot(el),str=false;
      if(atTop&&e.deltaY<0){e.preventDefault();e.stopPropagation();S.scale=Math.min(MAX_STRETCH,S.scale-e.deltaY*PULL_RATIO);S.dir='top';str=true}
      else if(atBot&&e.deltaY>0){e.preventDefault();e.stopPropagation();S.scale=Math.min(MAX_STRETCH,S.scale+e.deltaY*PULL_RATIO);S.dir='bottom';str=true}
      if(str){apply();if(S.raf)cancelAnimationFrame(S.raf);S.raf=null}else if(S.scale!==0&&S.raf===null)release()}
    let touchStartY=0;
    function onTouchStart(e){touchStartY=e.touches[0].clientY}
    function onTouchMove(e){if(S.rel)return;const atTop=isAtTop(el),atBot=isAtBot(el),const dy=touchStartY-e.touches[0].clientY;let str=false;
      if(atTop&&dy<0){e.stopPropagation();
        S.scale=Math.min(0.2,S.scale-dy*0.5);S.dir='top';str=true}
      else if(atBot&&dy>0){e.stopPropagation();
        S.scale=Math.min(0.2,S.scale+dy*0.5);S.dir='bottom';str=true}
      if(str){apply();if(S.raf)cancelAnimationFrame(S.raf);S.raf=null}else if(S.scale!==0&&S.raf===null)release()}
    function onTouchEnd(){release()}
    el.addEventListener('wheel',onWheel,{capture:true,passive:false});
    el.addEventListener('touchstart',onTouchStart,{passive:true});
    el.addEventListener('touchmove',onTouchMove,{passive:true});
    el.addEventListener('touchend',onTouchEnd);
    el.addEventListener('mouseup',release);el.addEventListener('mouseleave',release)
  }
  function init(){setup(document.documentElement);setup(document.body);
    document.querySelectorAll('table,.table-scroll,.scroll-container,[data-scroll-stretch]').forEach(setup)}
  if(document.readyState=='loading'){document.addEventListener('DOMContentLoaded',init)}
  else{init()}
  window.setupOverscrollStretch=setup;})();
