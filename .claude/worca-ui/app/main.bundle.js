var Uf=Object.defineProperty;var Dn=(e,t)=>()=>(e&&(t=e(e=0)),t);var Rn=(e,t)=>{for(var i in t)Uf(e,i,{get:t[i],enumerable:!0})};var wl={};Rn(wl,{Terminal:()=>lb});function $m(e){return e.replace(/\r?\n/g,"\r")}function Tm(e,t){return t?"\x1B[200~"+e+"\x1B[201~":e}function Lm(e,t){e.clipboardData&&e.clipboardData.setData("text/plain",t.selectionText),e.preventDefault()}function Dm(e,t,i,s){if(e.stopPropagation(),e.clipboardData){let r=e.clipboardData.getData("text/plain");pd(r,t,i,s)}}function pd(e,t,i,s){e=$m(e),e=Tm(e,i.decPrivateModes.bracketedPasteMode&&s.rawOptions.ignoreBracketedPasteMode!==!0),i.triggerDataEvent(e,!0),t.value=""}function fd(e,t,i){let s=i.getBoundingClientRect(),r=e.clientX-s.left-10,o=e.clientY-s.top-10;t.style.width="20px",t.style.height="20px",t.style.left=`${r}px`,t.style.top=`${o}px`,t.style.zIndex="1000",t.focus()}function dc(e,t,i,s,r){fd(e,t,i),r&&s.rightClickSelect(e),t.value=s.selectionText,t.select()}function vi(e){return e>65535?(e-=65536,String.fromCharCode((e>>10)+55296)+String.fromCharCode(e%1024+56320)):String.fromCharCode(e)}function Fo(e,t=0,i=e.length){let s="";for(let r=t;r<i;++r){let o=e[r];o>65535?(o-=65536,s+=String.fromCharCode((o>>10)+55296)+String.fromCharCode(o%1024+56320)):s+=String.fromCharCode(o)}return s}function Bm(e){return e[Ta]||[]}function Oe(e){if(da.has(e))return da.get(e);let t=function(i,s,r){if(arguments.length!==3)throw new Error("@IServiceName-decorator can only be used to decorate a parameter");Pm(t,i,r)};return t._id=e,da.set(e,t),t}function Pm(e,t,i){t[uc]===t?t[Ta].push({id:e,index:i}):(t[Ta]=[{id:e,index:i}],t[uc]=t)}function zm(e,t){if(confirm(`Do you want to navigate to ${t}?

WARNING: This link could potentially be dangerous`)){let i=window.open();if(i){try{i.opener=null}catch{}i.location.href=t}else console.warn("Opening link blocked as opener could not be cleared")}}function So(e){Wm(e)||Fm.onUnexpectedError(e)}function Wm(e){return e instanceof Vm?!0:e instanceof Error&&e.name===Da&&e.message===Da}function Um(e){return e?new Error(`Illegal argument: ${e}`):new Error("Illegal argument")}function qm(e,t,i=0,s=e.length){let r=i,o=s;for(;r<o;){let n=Math.floor((r+o)/2);t(e[n])?r=n+1:o=n}return r-1}function ht(e,t=0){return e[e.length-(1+t)]}function jm(e,t){return(i,s)=>t(e(i),e(s))}function Gm(e,t){let i=Object.create(null);for(let s of e){let r=t(s),o=i[r];o||(o=i[r]=[]),o.push(s)}return i}function Jm(e,t){let i=this,s=!1,r;return function(){if(s)return r;if(s=!0,t)try{r=e.apply(i,arguments)}finally{t()}else r=e.apply(i,arguments);return r}}function e_(e){Yi=e}function Vo(e){return Yi?.trackDisposable(e),e}function Uo(e){Yi?.markAsDisposed(e)}function xr(e,t){Yi?.setParent(e,t)}function t_(e,t){if(Yi)for(let i of e)Yi.setParent(i,t)}function gc(e){return Yi?.markAsSingleton(e),e}function Gi(e){if(Ad.is(e)){let t=[];for(let i of e)if(i)try{i.dispose()}catch(s){t.push(s)}if(t.length===1)throw t[0];if(t.length>1)throw new AggregateError(t,"Encountered errors while disposing of store");return Array.isArray(e)?[]:e}else if(e)return e.dispose(),e}function i_(...e){let t=me(()=>Gi(e));return t_(e,t),t}function me(e){let t=Vo({dispose:Jm(()=>{Uo(t),e()})});return t}function m_(e,t,i){typeof t=="string"&&(t=e.matchMedia(t)),t.addEventListener("change",i)}function __(e){return pl.INSTANCE.getZoomFactor(e)}function g_(){return Eo}function B_(e){if(e.charCode){let i=String.fromCharCode(e.charCode).toUpperCase();return Hd.fromString(i)}let t=e.keyCode;if(t===3)return 7;if(Fa)switch(t){case 59:return 85;case 60:if(k_)return 97;break;case 61:return 86;case 107:return 109;case 109:return 111;case 173:return 88;case 224:if(zt)return 57;break}else if(ko&&(zt&&t===93||!zt&&t===92))return 57;return D_[t]||0}function N_(e){if(!e.parent||e.parent===e)return null;try{let t=e.location,i=e.parent.location;if(t.origin!=="null"&&i.origin!=="null"&&t.origin!==i.origin)return null}catch{return null}return e.parent}function K_(e){return 55296<=e&&e<=56319}function Ac(e){return 56320<=e&&e<=57343}function j_(e,t){return(e-55296<<10)+(t-56320)+65536}function Y_(e){return gl(e,0)}function gl(e,t){switch(typeof e){case"object":return e===null?Zt(349,t):Array.isArray(e)?X_(e,t):J_(e,t);case"string":return Vd(e,t);case"boolean":return G_(e,t);case"number":return Zt(e,t);case"undefined":return Zt(937,t);default:return Zt(617,t)}}function Zt(e,t){return(t<<5)-t+e|0}function G_(e,t){return Zt(e?433:863,t)}function Vd(e,t){t=Zt(149417,t);for(let i=0,s=e.length;i<s;i++)t=Zt(e.charCodeAt(i),t);return t}function X_(e,t){return t=Zt(104579,t),e.reduce((i,s)=>gl(s,i),t)}function J_(e,t){return t=Zt(181387,t),Object.keys(e).sort().reduce((i,s)=>(i=Vd(s,i),gl(e[s],i)),t)}function _a(e,t,i=32){let s=i-t,r=~((1<<s)-1);return(e<<t|(r&e)>>>s)>>>0}function $c(e,t=0,i=e.byteLength,s=0){for(let r=0;r<i;r++)e[t+r]=s}function Z_(e,t,i="0"){for(;e.length<t;)e=i+e;return e}function hr(e,t=32){return e instanceof ArrayBuffer?Array.from(new Uint8Array(e)).map(i=>i.toString(16).padStart(2,"0")).join(""):Z_((e>>>0).toString(16),t/4)}function W(e,t,i,s){return new tg(e,t,i,s)}function ig(e,t){return function(i){return t(new _r(e,i))}}function sg(e){return function(t){return e(new Wa(t))}}function ng(e){let t=e.getBoundingClientRect(),i=Tt(e);return{left:t.left+i.scrollX,top:t.top+i.scrollY,width:t.width,height:t.height}}function qd(e,t,i,...s){let r=ag.exec(t);if(!r)throw new Error("Bad use of emmet");let o=r[1]||"div",n;return e!=="http://www.w3.org/1999/xhtml"?n=document.createElementNS(e,o):n=document.createElement(o),r[3]&&(n.id=r[3]),r[4]&&(n.className=r[4].replace(/\./g," ").trim()),i&&Object.entries(i).forEach(([a,h])=>{typeof h>"u"||(/^on\w+$/.test(a)?n[a]=h:a==="selected"?h&&n.setAttribute(a,"true"):n.setAttribute(a,h))}),n.append(...s),n}function lg(e,t,...i){return qd("http://www.w3.org/1999/xhtml",e,t,...i)}function ot(e){return typeof e=="number"?`${e}px`:e}function Cr(e){return new hg(e)}function cg(e,t,i){let s=null,r=null;if(typeof i.value=="function"?(s="value",r=i.value,r.length!==0&&console.warn("Memoize should only be used in functions with zero parameters")):typeof i.get=="function"&&(s="get",r=i.get),!r)throw new Error("not supported");let o=`$memoize$${t}`;i[s]=function(...n){return this.hasOwnProperty(o)||Object.defineProperty(this,o,{configurable:!1,enumerable:!1,writable:!1,value:r.apply(this,n)}),this[o]}}function va(e,t){let i=t-e;return function(s){return e+i*gg(s)}}function mg(e,t,i){return function(s){return s<i?e(s/i):t((s-i)/(1-i))}}function _g(e){return Math.pow(e,3)}function gg(e){return 1-_g(1-e)}function Ag(e){let t={lazyRender:typeof e.lazyRender<"u"?e.lazyRender:!1,className:typeof e.className<"u"?e.className:"",useShadows:typeof e.useShadows<"u"?e.useShadows:!0,handleMouseWheel:typeof e.handleMouseWheel<"u"?e.handleMouseWheel:!0,flipAxes:typeof e.flipAxes<"u"?e.flipAxes:!1,consumeMouseWheelIfScrollbarIsNeeded:typeof e.consumeMouseWheelIfScrollbarIsNeeded<"u"?e.consumeMouseWheelIfScrollbarIsNeeded:!1,alwaysConsumeMouseWheel:typeof e.alwaysConsumeMouseWheel<"u"?e.alwaysConsumeMouseWheel:!1,scrollYToX:typeof e.scrollYToX<"u"?e.scrollYToX:!1,mouseWheelScrollSensitivity:typeof e.mouseWheelScrollSensitivity<"u"?e.mouseWheelScrollSensitivity:1,fastScrollSensitivity:typeof e.fastScrollSensitivity<"u"?e.fastScrollSensitivity:5,scrollPredominantAxis:typeof e.scrollPredominantAxis<"u"?e.scrollPredominantAxis:!0,mouseWheelSmoothScroll:typeof e.mouseWheelSmoothScroll<"u"?e.mouseWheelSmoothScroll:!0,arrowSize:typeof e.arrowSize<"u"?e.arrowSize:11,listenOnDomNode:typeof e.listenOnDomNode<"u"?e.listenOnDomNode:null,horizontal:typeof e.horizontal<"u"?e.horizontal:1,horizontalScrollbarSize:typeof e.horizontalScrollbarSize<"u"?e.horizontalScrollbarSize:10,horizontalSliderSize:typeof e.horizontalSliderSize<"u"?e.horizontalSliderSize:0,horizontalHasArrows:typeof e.horizontalHasArrows<"u"?e.horizontalHasArrows:!1,vertical:typeof e.vertical<"u"?e.vertical:1,verticalScrollbarSize:typeof e.verticalScrollbarSize<"u"?e.verticalScrollbarSize:10,verticalHasArrows:typeof e.verticalHasArrows<"u"?e.verticalHasArrows:!1,verticalSliderSize:typeof e.verticalSliderSize<"u"?e.verticalSliderSize:0,scrollByPage:typeof e.scrollByPage<"u"?e.scrollByPage:!1};return t.horizontalSliderSize=typeof e.horizontalSliderSize<"u"?e.horizontalSliderSize:t.horizontalScrollbarSize,t.verticalSliderSize=typeof e.verticalSliderSize<"u"?e.verticalSliderSize:t.verticalScrollbarSize,zt&&(t.className+=" mac"),t}function Ui(e){let t=e.toString(16);return t.length<2?"0"+t:t}function Xt(e,t){return e<t?(t+.05)/(e+.05):(e+.05)/(t+.05)}function Lg(e){return 57508<=e&&e<=57558}function Dg(e){return 9472<=e&&e<=9631}function Rg(e){return Lg(e)||Dg(e)}function Mg(){return{css:{canvas:vo(),cell:vo()},device:{canvas:vo(),cell:vo(),char:{width:0,height:0,left:0,top:0}}}}function vo(){return{width:0,height:0}}function zc(e,t,i){for(;e.length<i;)e=t+e;return e}function Og(){return new Pg}function bl(e,t,i){let s=i.getBoundingClientRect(),r=e.getComputedStyle(i),o=parseInt(r.getPropertyValue("padding-left")),n=parseInt(r.getPropertyValue("padding-top"));return[t.clientX-s.left-o,t.clientY-s.top-n]}function Vg(e,t,i,s,r,o,n,a,h){if(!o)return;let l=bl(e,t,i);if(l)return l[0]=Math.ceil((l[0]+(h?n/2:0))/n),l[1]=Math.ceil(l[1]/a),l[0]=Math.min(Math.max(l[0],1),s+(h?1:0)),l[1]=Math.min(Math.max(l[1],1),r),l}function Kg(){if(!Qd)return 0;let e=Lr.match(/Version\/(\d+)/);return e===null||e.length<2?0:parseInt(e[1])}function Qg(e,t,i,s){let r=i.buffer.x,o=i.buffer.y;if(!i.buffer.hasScrollback)return iv(r,o,e,t,i,s)+Ko(o,t,i,s)+sv(r,o,e,t,i,s);let n;if(o===t)return n=r>e?"D":"C",Er(Math.abs(r-e),kr(n,s));n=o>t?"D":"C";let a=Math.abs(o-t),h=tv(o>t?e:r,i)+(a-1)*i.cols+1+ev(o>t?r:e,i);return Er(h,kr(n,s))}function ev(e,t){return e-1}function tv(e,t){return t.cols-e}function iv(e,t,i,s,r,o){return Ko(t,s,r,o).length===0?"":Er(ru(e,t,e,t-Xi(t,r),!1,r).length,kr("D",o))}function Ko(e,t,i,s){let r=e-Xi(e,i),o=t-Xi(t,i),n=Math.abs(r-o)-rv(e,t,i);return Er(n,kr(su(e,t),s))}function sv(e,t,i,s,r,o){let n;Ko(t,s,r,o).length>0?n=s-Xi(s,r):n=t;let a=s,h=ov(e,t,i,s,r,o);return Er(ru(e,n,i,a,h==="C",r).length,kr(h,o))}function rv(e,t,i){let s=0,r=e-Xi(e,i),o=t-Xi(t,i);for(let n=0;n<Math.abs(r-o);n++){let a=su(e,t)==="A"?-1:1;i.buffer.lines.get(r+a*n)?.isWrapped&&s++}return s}function Xi(e,t){let i=0,s=t.buffer.lines.get(e),r=s?.isWrapped;for(;r&&e>=0&&e<t.rows;)i++,s=t.buffer.lines.get(--e),r=s?.isWrapped;return i}function ov(e,t,i,s,r,o){let n;return Ko(i,s,r,o).length>0?n=s-Xi(s,r):n=t,e<i&&n<=s||e>=i&&n<s?"C":"D"}function su(e,t){return e>t?"A":"B"}function ru(e,t,i,s,r,o){let n=e,a=t,h="";for(;(n!==i||a!==s)&&a>=0&&a<o.buffer.lines.length;)n+=r?1:-1,r&&n>o.cols-1?(h+=o.buffer.translateBufferLineToString(a,!1,e,n),n=0,e=0,a++):!r&&n<0&&(h+=o.buffer.translateBufferLineToString(a,!1,0,e+1),n=o.cols-1,e=n,a--);return h+o.buffer.translateBufferLineToString(a,!1,e,n)}function kr(e,t){let i=t?"O":"[";return $.ESC+i+e}function Er(e,t){e=Math.floor(e);let i="";for(let s=0;s<e;s++)i+=t;return i}function Hc(e,t){if(e.start.y>e.end.y)throw new Error(`Buffer range end (${e.end.x}, ${e.end.y}) cannot be before start (${e.start.x}, ${e.start.y})`);return t*(e.end.y-e.start.y)+(e.end.x-e.start.x+1)}function ue(e,t){if(e!==void 0)try{return be.toColor(e)}catch{}return t}function vv(e,t,i,s,r,o){let n=[];for(let a=0;a<e.length-1;a++){let h=a,l=e.get(++h);if(!l.isWrapped)continue;let c=[e.get(a)];for(;h<e.length&&l.isWrapped;)c.push(l),l=e.get(++h);if(!o&&s>=a&&s<h){a+=c.length-1;continue}let d=0,p=Ar(c,d,t),f=1,m=0;for(;f<c.length;){let C=Ar(c,f,t),k=C-m,R=i-p,T=Math.min(k,R);c[d].copyCellsFrom(c[f],m,p,T,!1),p+=T,p===i&&(d++,p=0),m+=T,m===C&&(f++,m=0),p===0&&d!==0&&c[d-1].getWidth(i-1)===2&&(c[d].copyCellsFrom(c[d-1],i-1,p++,1,!1),c[d-1].setCell(i-1,r))}c[d].replaceCells(p,i,r);let _=0;for(let C=c.length-1;C>0&&(C>d||c[C].getTrimmedLength()===0);C--)_++;_>0&&(n.push(a+c.length-_),n.push(_)),a+=c.length-1}return n}function bv(e,t){let i=[],s=0,r=t[s],o=0;for(let n=0;n<e.length;n++)if(r===n){let a=t[++s];e.onDeleteEmitter.fire({index:n-o,amount:a}),n+=a-1,o+=a,r=t[++s]}else i.push(n);return{layout:i,countRemoved:o}}function yv(e,t){let i=[];for(let s=0;s<t.length;s++)i.push(e.get(t[s]));for(let s=0;s<i.length;s++)e.set(s,i[s]);e.length=t.length}function wv(e,t,i){let s=[],r=e.map((h,l)=>Ar(e,l,t)).reduce((h,l)=>h+l),o=0,n=0,a=0;for(;a<r;){if(r-a<i){s.push(r-a);break}o+=i;let h=Ar(e,n,t);o>h&&(o-=h,n++);let l=e[n].getWidth(o-1)===2;l&&o--;let c=l?i-1:i;s.push(c),a+=c}return s}function Ar(e,t,i){if(t===e.length-1)return e[t].getTrimmedLength();let s=!e[t].hasContent(i-1)&&e[t].getWidth(i-1)===1,r=e[t+1].getWidth(0)===2;return s&&r?i-1:i}function Ev(e){return e==="block"||e==="underline"||e==="bar"}function yr(e,t=5){if(typeof e!="object")return e;let i=Array.isArray(e)?[]:{};for(let s in e)i[s]=t<=1?e[s]:e[s]&&yr(e[s],t-1);return i}function Sa(e,t){let i=(e.ctrl?16:0)|(e.shift?4:0)|(e.alt?8:0);return e.button===4?(i|=64,i|=e.action):(i|=e.button&3,e.button&4&&(i|=64),e.button&8&&(i|=128),e.action===32?i|=32:e.action===0&&!t&&(i|=3)),i}function $v(e,t){let i=0,s=t.length-1,r;if(e<t[0][0]||e>t[s][1])return!1;for(;s>=i;)if(r=i+s>>1,e>t[r][1])i=r+1;else if(e<t[r][0])s=r-1;else return!0;return!1}function Zc(e){let t=e.buffer.lines.get(e.buffer.ybase+e.buffer.y-1)?.get(e.cols-1),i=e.buffer.lines.get(e.buffer.ybase+e.buffer.y);i&&t&&(i.isWrapped=t[3]!==0&&t[3]!==32)}function ed(e){if(!e)return;let t=e.toLowerCase();if(t.indexOf("rgb:")===0){t=t.slice(4);let i=Iv.exec(t);if(i){let s=i[1]?15:i[4]?255:i[7]?4095:65535;return[Math.round(parseInt(i[1]||i[4]||i[7]||i[10],16)/s*255),Math.round(parseInt(i[2]||i[5]||i[8]||i[11],16)/s*255),Math.round(parseInt(i[3]||i[6]||i[9]||i[12],16)/s*255)]}}else if(t.indexOf("#")===0&&(t=t.slice(1),zv.exec(t)&&[3,6,9,12].includes(t.length))){let i=t.length/3,s=[0,0,0];for(let r=0;r<3;++r){let o=parseInt(t.slice(i*r,i*r+i),16);s[r]=i===1?o<<4:i===2?o:i===3?o>>4:o>>8}return s}}function ka(e,t){let i=e.toString(16),s=i.length<2?"0"+i:i;switch(t){case 4:return i[0];case 8:return s;case 12:return(s+s).slice(0,3);default:return s+s}}function Nv(e,t=16){let[i,s,r]=e;return`rgb:${ka(i,t)}/${ka(s,t)}/${ka(r,t)}`}function id(e,t){if(e>24)return t.setWinLines||!1;switch(e){case 1:return!!t.restoreWin;case 2:return!!t.minimizeWin;case 3:return!!t.setWinPosition;case 4:return!!t.setWinSizePixels;case 5:return!!t.raiseWin;case 6:return!!t.lowerWin;case 7:return!!t.refreshWin;case 8:return!!t.setWinSizeChars;case 9:return!!t.maximizeWin;case 10:return!!t.fullscreenWin;case 11:return!!t.getWinState;case 13:return!!t.getWinPosition;case 14:return!!t.getWinSizePixels;case 15:return!!t.getScreenSizePixels;case 16:return!!t.getCellSizePixels;case 18:return!!t.getWinSizeChars;case 19:return!!t.getScreenSizeChars;case 20:return!!t.getIconTitle;case 21:return!!t.getWinTitle;case 22:return!!t.pushTitle;case 23:return!!t.popTitle;case 24:return!!t.setWinLines}return!1}function od(e){return 0<=e&&e<256}function jv(e,t,i,s){let r={type:0,cancel:!1,key:void 0},o=(e.shiftKey?1:0)|(e.altKey?2:0)|(e.ctrlKey?4:0)|(e.metaKey?8:0);switch(e.keyCode){case 0:e.key==="UIKeyInputUpArrow"?t?r.key=$.ESC+"OA":r.key=$.ESC+"[A":e.key==="UIKeyInputLeftArrow"?t?r.key=$.ESC+"OD":r.key=$.ESC+"[D":e.key==="UIKeyInputRightArrow"?t?r.key=$.ESC+"OC":r.key=$.ESC+"[C":e.key==="UIKeyInputDownArrow"&&(t?r.key=$.ESC+"OB":r.key=$.ESC+"[B");break;case 8:r.key=e.ctrlKey?"\b":$.DEL,e.altKey&&(r.key=$.ESC+r.key);break;case 9:if(e.shiftKey){r.key=$.ESC+"[Z";break}r.key=$.HT,r.cancel=!0;break;case 13:r.key=e.altKey?$.ESC+$.CR:$.CR,r.cancel=!0;break;case 27:r.key=$.ESC,e.altKey&&(r.key=$.ESC+$.ESC),r.cancel=!0;break;case 37:if(e.metaKey)break;o?r.key=$.ESC+"[1;"+(o+1)+"D":t?r.key=$.ESC+"OD":r.key=$.ESC+"[D";break;case 39:if(e.metaKey)break;o?r.key=$.ESC+"[1;"+(o+1)+"C":t?r.key=$.ESC+"OC":r.key=$.ESC+"[C";break;case 38:if(e.metaKey)break;o?r.key=$.ESC+"[1;"+(o+1)+"A":t?r.key=$.ESC+"OA":r.key=$.ESC+"[A";break;case 40:if(e.metaKey)break;o?r.key=$.ESC+"[1;"+(o+1)+"B":t?r.key=$.ESC+"OB":r.key=$.ESC+"[B";break;case 45:!e.shiftKey&&!e.ctrlKey&&(r.key=$.ESC+"[2~");break;case 46:o?r.key=$.ESC+"[3;"+(o+1)+"~":r.key=$.ESC+"[3~";break;case 36:o?r.key=$.ESC+"[1;"+(o+1)+"H":t?r.key=$.ESC+"OH":r.key=$.ESC+"[H";break;case 35:o?r.key=$.ESC+"[1;"+(o+1)+"F":t?r.key=$.ESC+"OF":r.key=$.ESC+"[F";break;case 33:e.shiftKey?r.type=2:e.ctrlKey?r.key=$.ESC+"[5;"+(o+1)+"~":r.key=$.ESC+"[5~";break;case 34:e.shiftKey?r.type=3:e.ctrlKey?r.key=$.ESC+"[6;"+(o+1)+"~":r.key=$.ESC+"[6~";break;case 112:o?r.key=$.ESC+"[1;"+(o+1)+"P":r.key=$.ESC+"OP";break;case 113:o?r.key=$.ESC+"[1;"+(o+1)+"Q":r.key=$.ESC+"OQ";break;case 114:o?r.key=$.ESC+"[1;"+(o+1)+"R":r.key=$.ESC+"OR";break;case 115:o?r.key=$.ESC+"[1;"+(o+1)+"S":r.key=$.ESC+"OS";break;case 116:o?r.key=$.ESC+"[15;"+(o+1)+"~":r.key=$.ESC+"[15~";break;case 117:o?r.key=$.ESC+"[17;"+(o+1)+"~":r.key=$.ESC+"[17~";break;case 118:o?r.key=$.ESC+"[18;"+(o+1)+"~":r.key=$.ESC+"[18~";break;case 119:o?r.key=$.ESC+"[19;"+(o+1)+"~":r.key=$.ESC+"[19~";break;case 120:o?r.key=$.ESC+"[20;"+(o+1)+"~":r.key=$.ESC+"[20~";break;case 121:o?r.key=$.ESC+"[21;"+(o+1)+"~":r.key=$.ESC+"[21~";break;case 122:o?r.key=$.ESC+"[23;"+(o+1)+"~":r.key=$.ESC+"[23~";break;case 123:o?r.key=$.ESC+"[24;"+(o+1)+"~":r.key=$.ESC+"[24~";break;default:if(e.ctrlKey&&!e.shiftKey&&!e.altKey&&!e.metaKey)e.keyCode>=65&&e.keyCode<=90?r.key=String.fromCharCode(e.keyCode-64):e.keyCode===32?r.key=$.NUL:e.keyCode>=51&&e.keyCode<=55?r.key=String.fromCharCode(e.keyCode-51+27):e.keyCode===56?r.key=$.DEL:e.keyCode===219?r.key=$.ESC:e.keyCode===220?r.key=$.FS:e.keyCode===221&&(r.key=$.GS);else if((!i||s)&&e.altKey&&!e.metaKey){let n=Kv[e.keyCode]?.[e.shiftKey?1:0];if(n)r.key=$.ESC+n;else if(e.keyCode>=65&&e.keyCode<=90){let a=e.ctrlKey?e.keyCode-64:e.keyCode+32,h=String.fromCharCode(a);e.shiftKey&&(h=h.toUpperCase()),r.key=$.ESC+h}else if(e.keyCode===32)r.key=$.ESC+(e.ctrlKey?$.NUL:" ");else if(e.key==="Dead"&&e.code.startsWith("Key")){let a=e.code.slice(3,4);e.shiftKey||(a=a.toLowerCase()),r.key=$.ESC+a,r.cancel=!0}}else i&&!e.altKey&&!e.ctrlKey&&!e.shiftKey&&e.metaKey?e.keyCode===65&&(r.type=1):e.key&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&e.keyCode>=48&&e.key.length===1?r.key=e.key:e.key&&e.ctrlKey&&(e.key==="_"&&(r.key=$.US),e.key==="@"&&(r.key=$.NUL));break}return r}function Qv(e,t){return e.text===t.text&&e.range.start.x===t.range.start.x&&e.range.start.y===t.range.start.y&&e.range.end.x===t.range.end.x&&e.range.end.y===t.range.end.y}function tb(e){return e.keyCode===16||e.keyCode===17||e.keyCode===18}var ud,Em,Am,we,z,hc,Aa,cc,$a,Rm,Mm,md,bi,$r,Ro,bt,uc,Ta,da,Ze,bd,Ji,Om,dl,yd,Qe,wd,Im,Tr,La,Wo,ei,ul,ti,Nm,Sd,Cs,Cd,Hm,Fm,Da,Vm,pc,Ma,Km,Ed,Ym,fc,mc,_c,_S,Xm,Ad,Zm,Yi,Qm,Td,yi,G,Ss,ut,Pa,ve,vc,s_,r_,o_,bc,n_,Ve,Ia,a_,yc,Rd,l_,Na,h_,c_,d_,Co,u_,p_,xo,M,f_,Ha,pl,vS,bS,xs,Fa,ko,fl,Pd,yS,wS,Eo,ws,Mo,Bo,Sr,v_,Od,Id,b_,y_,w_,S_,go,Ao,wc,C_,Jt,Qt,dt,zd,x_,ua,Nd,zt,k_,pa,E_,SS,Nt,fi,A_,$_,T_,L_,CS,xS,kS,ES,mi,AS,ml,fa,Sc,Cc,D_,Hd,R_,M_,P_,O_,I_,z_,Wa,xc,H_,_r,kc,Wd,F_,W_,_l,V_,U_,ma,q_,Ec,Q_,$S,Tt,TS,LS,DS,Tc,RS,MS,eg,BS,PS,tg,Lc,rg,Po,og,ga,Dc,OS,Re,ag,hg,Kd,It,gr,dg,vl,Rc,ug,pg,fg,Mc,Bc,vg,bg,jd,Yd,yg,wg,Sg,Pc,Oc,Cg,Ka,xg,kg,Eg,ja,Ya,$g,Pt,_i,cr,Oo,$,To,Gd,Ga,Me,Be,Pe,ye,Ic,Ae,fe,be,Je,Lo,Tg,Io,Xa,Bg,Pg,ba,_t,bo,Nc,dr,yo,Ig,Ja,Za,Xd,zg,Ng,Hg,Fg,Wg,Qa,Ug,Jd,qo,Lr,Dr,Zd,qg,Qd,zo,jg,Yg,eu,yl,tu,iu,Gg,Xg,No,Jg,el,Zg,nv,ya,av,lv,hv,cv,dv,tl,Fc,Wc,Te,qi,vr,Vc,Uc,ur,uv,il,pv,fv,mv,_v,sl,gv,qc,Z,Ee,wo,wa,br,nu,Sv,De,Ki,Kc,jc,Cv,lu,hu,rl,ys,xv,kv,Yc,Gc,ol,Xc,Ca,Jc,nl,xa,Av,Le,Tv,ji,Lv,pr,Dv,cu,fr,Rv,ct,mr,Mv,wr,Qc,Bv,vt,Pv,Ov,Iv,zv,Hv,gi,td,sd,rd,Fv,ll,Wv,nd,Vv,Uv,hl,ad,qv,Kv,Ce,Yv,Ea,ld,Gv,Xv,Jv,Zv,hd,cd,Ho,cl,eb,ib,sb,dd,rb,ob,nb,ab,Ot,lb,Sl=Dn(()=>{ud=Object.defineProperty,Em=Object.getOwnPropertyDescriptor,Am=(e,t)=>{for(var i in t)ud(e,i,{get:t[i],enumerable:!0})},we=(e,t,i,s)=>{for(var r=s>1?void 0:s?Em(t,i):t,o=e.length-1,n;o>=0;o--)(n=e[o])&&(r=(s?n(t,i,r):n(r))||r);return s&&r&&ud(t,i,r),r},z=(e,t)=>(i,s)=>t(i,s,e),hc="Terminal input",Aa={get:()=>hc,set:e=>hc=e},cc="Too much output to announce, navigate to rows manually to read",$a={get:()=>cc,set:e=>cc=e};Rm=class{constructor(){this._interim=0}clear(){this._interim=0}decode(e,t){let i=e.length;if(!i)return 0;let s=0,r=0;if(this._interim){let o=e.charCodeAt(r++);56320<=o&&o<=57343?t[s++]=(this._interim-55296)*1024+o-56320+65536:(t[s++]=this._interim,t[s++]=o),this._interim=0}for(let o=r;o<i;++o){let n=e.charCodeAt(o);if(55296<=n&&n<=56319){if(++o>=i)return this._interim=n,s;let a=e.charCodeAt(o);56320<=a&&a<=57343?t[s++]=(n-55296)*1024+a-56320+65536:(t[s++]=n,t[s++]=a);continue}n!==65279&&(t[s++]=n)}return s}},Mm=class{constructor(){this.interim=new Uint8Array(3)}clear(){this.interim.fill(0)}decode(e,t){let i=e.length;if(!i)return 0;let s=0,r,o,n,a,h=0,l=0;if(this.interim[0]){let p=!1,f=this.interim[0];f&=(f&224)===192?31:(f&240)===224?15:7;let m=0,_;for(;(_=this.interim[++m]&63)&&m<4;)f<<=6,f|=_;let C=(this.interim[0]&224)===192?2:(this.interim[0]&240)===224?3:4,k=C-m;for(;l<k;){if(l>=i)return 0;if(_=e[l++],(_&192)!==128){l--,p=!0;break}else this.interim[m++]=_,f<<=6,f|=_&63}p||(C===2?f<128?l--:t[s++]=f:C===3?f<2048||f>=55296&&f<=57343||f===65279||(t[s++]=f):f<65536||f>1114111||(t[s++]=f)),this.interim.fill(0)}let c=i-4,d=l;for(;d<i;){for(;d<c&&!((r=e[d])&128)&&!((o=e[d+1])&128)&&!((n=e[d+2])&128)&&!((a=e[d+3])&128);)t[s++]=r,t[s++]=o,t[s++]=n,t[s++]=a,d+=4;if(r=e[d++],r<128)t[s++]=r;else if((r&224)===192){if(d>=i)return this.interim[0]=r,s;if(o=e[d++],(o&192)!==128){d--;continue}if(h=(r&31)<<6|o&63,h<128){d--;continue}t[s++]=h}else if((r&240)===224){if(d>=i)return this.interim[0]=r,s;if(o=e[d++],(o&192)!==128){d--;continue}if(d>=i)return this.interim[0]=r,this.interim[1]=o,s;if(n=e[d++],(n&192)!==128){d--;continue}if(h=(r&15)<<12|(o&63)<<6|n&63,h<2048||h>=55296&&h<=57343||h===65279)continue;t[s++]=h}else if((r&248)===240){if(d>=i)return this.interim[0]=r,s;if(o=e[d++],(o&192)!==128){d--;continue}if(d>=i)return this.interim[0]=r,this.interim[1]=o,s;if(n=e[d++],(n&192)!==128){d--;continue}if(d>=i)return this.interim[0]=r,this.interim[1]=o,this.interim[2]=n,s;if(a=e[d++],(a&192)!==128){d--;continue}if(h=(r&7)<<18|(o&63)<<12|(n&63)<<6|a&63,h<65536||h>1114111)continue;t[s++]=h}}return s}},md="",bi=" ",$r=class _d{constructor(){this.fg=0,this.bg=0,this.extended=new Ro}static toColorRGB(t){return[t>>>16&255,t>>>8&255,t&255]}static fromColorRGB(t){return(t[0]&255)<<16|(t[1]&255)<<8|t[2]&255}clone(){let t=new _d;return t.fg=this.fg,t.bg=this.bg,t.extended=this.extended.clone(),t}isInverse(){return this.fg&67108864}isBold(){return this.fg&134217728}isUnderline(){return this.hasExtendedAttrs()&&this.extended.underlineStyle!==0?1:this.fg&268435456}isBlink(){return this.fg&536870912}isInvisible(){return this.fg&1073741824}isItalic(){return this.bg&67108864}isDim(){return this.bg&134217728}isStrikethrough(){return this.fg&2147483648}isProtected(){return this.bg&536870912}isOverline(){return this.bg&1073741824}getFgColorMode(){return this.fg&50331648}getBgColorMode(){return this.bg&50331648}isFgRGB(){return(this.fg&50331648)===50331648}isBgRGB(){return(this.bg&50331648)===50331648}isFgPalette(){return(this.fg&50331648)===16777216||(this.fg&50331648)===33554432}isBgPalette(){return(this.bg&50331648)===16777216||(this.bg&50331648)===33554432}isFgDefault(){return(this.fg&50331648)===0}isBgDefault(){return(this.bg&50331648)===0}isAttributeDefault(){return this.fg===0&&this.bg===0}getFgColor(){switch(this.fg&50331648){case 16777216:case 33554432:return this.fg&255;case 50331648:return this.fg&16777215;default:return-1}}getBgColor(){switch(this.bg&50331648){case 16777216:case 33554432:return this.bg&255;case 50331648:return this.bg&16777215;default:return-1}}hasExtendedAttrs(){return this.bg&268435456}updateExtended(){this.extended.isEmpty()?this.bg&=-268435457:this.bg|=268435456}getUnderlineColor(){if(this.bg&268435456&&~this.extended.underlineColor)switch(this.extended.underlineColor&50331648){case 16777216:case 33554432:return this.extended.underlineColor&255;case 50331648:return this.extended.underlineColor&16777215;default:return this.getFgColor()}return this.getFgColor()}getUnderlineColorMode(){return this.bg&268435456&&~this.extended.underlineColor?this.extended.underlineColor&50331648:this.getFgColorMode()}isUnderlineColorRGB(){return this.bg&268435456&&~this.extended.underlineColor?(this.extended.underlineColor&50331648)===50331648:this.isFgRGB()}isUnderlineColorPalette(){return this.bg&268435456&&~this.extended.underlineColor?(this.extended.underlineColor&50331648)===16777216||(this.extended.underlineColor&50331648)===33554432:this.isFgPalette()}isUnderlineColorDefault(){return this.bg&268435456&&~this.extended.underlineColor?(this.extended.underlineColor&50331648)===0:this.isFgDefault()}getUnderlineStyle(){return this.fg&268435456?this.bg&268435456?this.extended.underlineStyle:1:0}getUnderlineVariantOffset(){return this.extended.underlineVariantOffset}},Ro=class gd{constructor(t=0,i=0){this._ext=0,this._urlId=0,this._ext=t,this._urlId=i}get ext(){return this._urlId?this._ext&-469762049|this.underlineStyle<<26:this._ext}set ext(t){this._ext=t}get underlineStyle(){return this._urlId?5:(this._ext&469762048)>>26}set underlineStyle(t){this._ext&=-469762049,this._ext|=t<<26&469762048}get underlineColor(){return this._ext&67108863}set underlineColor(t){this._ext&=-67108864,this._ext|=t&67108863}get urlId(){return this._urlId}set urlId(t){this._urlId=t}get underlineVariantOffset(){let t=(this._ext&3758096384)>>29;return t<0?t^4294967288:t}set underlineVariantOffset(t){this._ext&=536870911,this._ext|=t<<29&3758096384}clone(){return new gd(this._ext,this._urlId)}isEmpty(){return this.underlineStyle===0&&this._urlId===0}},bt=class vd extends $r{constructor(){super(...arguments),this.content=0,this.fg=0,this.bg=0,this.extended=new Ro,this.combinedData=""}static fromCharData(t){let i=new vd;return i.setFromCharData(t),i}isCombined(){return this.content&2097152}getWidth(){return this.content>>22}getChars(){return this.content&2097152?this.combinedData:this.content&2097151?vi(this.content&2097151):""}getCode(){return this.isCombined()?this.combinedData.charCodeAt(this.combinedData.length-1):this.content&2097151}setFromCharData(t){this.fg=t[0],this.bg=0;let i=!1;if(t[1].length>2)i=!0;else if(t[1].length===2){let s=t[1].charCodeAt(0);if(55296<=s&&s<=56319){let r=t[1].charCodeAt(1);56320<=r&&r<=57343?this.content=(s-55296)*1024+r-56320+65536|t[2]<<22:i=!0}else i=!0}else this.content=t[1].charCodeAt(0)|t[2]<<22;i&&(this.combinedData=t[1],this.content=2097152|t[2]<<22)}getAsCharData(){return[this.fg,this.getChars(),this.getWidth(),this.getCode()]}},uc="di$target",Ta="di$dependencies",da=new Map;Ze=Oe("BufferService"),bd=Oe("CoreMouseService"),Ji=Oe("CoreService"),Om=Oe("CharsetService"),dl=Oe("InstantiationService"),yd=Oe("LogService"),Qe=Oe("OptionsService"),wd=Oe("OscLinkService"),Im=Oe("UnicodeService"),Tr=Oe("DecorationService"),La=class{constructor(e,t,i){this._bufferService=e,this._optionsService=t,this._oscLinkService=i}provideLinks(e,t){let i=this._bufferService.buffer.lines.get(e-1);if(!i){t(void 0);return}let s=[],r=this._optionsService.rawOptions.linkHandler,o=new bt,n=i.getTrimmedLength(),a=-1,h=-1,l=!1;for(let c=0;c<n;c++)if(!(h===-1&&!i.hasContent(c))){if(i.loadCell(c,o),o.hasExtendedAttrs()&&o.extended.urlId)if(h===-1){h=c,a=o.extended.urlId;continue}else l=o.extended.urlId!==a;else h!==-1&&(l=!0);if(l||h!==-1&&c===n-1){let d=this._oscLinkService.getLinkData(a)?.uri;if(d){let p={start:{x:h+1,y:e},end:{x:c+(!l&&c===n-1?1:0),y:e}},f=!1;if(!r?.allowNonHttpProtocols)try{let m=new URL(d);["http:","https:"].includes(m.protocol)||(f=!0)}catch{f=!0}f||s.push({text:d,range:p,activate:(m,_)=>r?r.activate(m,_,p):zm(m,_),hover:(m,_)=>r?.hover?.(m,_,p),leave:(m,_)=>r?.leave?.(m,_,p)})}l=!1,o.hasExtendedAttrs()&&o.extended.urlId?(h=c,a=o.extended.urlId):(h=-1,a=-1)}}t(s)}};La=we([z(0,Ze),z(1,Qe),z(2,wd)],La);Wo=Oe("CharSizeService"),ei=Oe("CoreBrowserService"),ul=Oe("MouseService"),ti=Oe("RenderService"),Nm=Oe("SelectionService"),Sd=Oe("CharacterJoinerService"),Cs=Oe("ThemeService"),Cd=Oe("LinkProviderService"),Hm=class{constructor(){this.listeners=[],this.unexpectedErrorHandler=function(e){setTimeout(()=>{throw e.stack?pc.isErrorNoTelemetry(e)?new pc(e.message+`

`+e.stack):new Error(e.message+`

`+e.stack):e},0)}}addListener(e){return this.listeners.push(e),()=>{this._removeListener(e)}}emit(e){this.listeners.forEach(t=>{t(e)})}_removeListener(e){this.listeners.splice(this.listeners.indexOf(e),1)}setUnexpectedErrorHandler(e){this.unexpectedErrorHandler=e}getUnexpectedErrorHandler(){return this.unexpectedErrorHandler}onUnexpectedError(e){this.unexpectedErrorHandler(e),this.emit(e)}onUnexpectedExternalError(e){this.unexpectedErrorHandler(e)}},Fm=new Hm;Da="Canceled";Vm=class extends Error{constructor(){super(Da),this.name=this.message}};pc=class Ra extends Error{constructor(t){super(t),this.name="CodeExpectedError"}static fromError(t){if(t instanceof Ra)return t;let i=new Ra;return i.message=t.message,i.stack=t.stack,i}static isErrorNoTelemetry(t){return t.name==="CodeExpectedError"}},Ma=class xd extends Error{constructor(t){super(t||"An unexpected bug occurred."),Object.setPrototypeOf(this,xd.prototype)}};Km=class kd{constructor(t){this._array=t,this._findLastMonotonousLastIdx=0}findLastMonotonous(t){if(kd.assertInvariants){if(this._prevFindLastPredicate){for(let s of this._array)if(this._prevFindLastPredicate(s)&&!t(s))throw new Error("MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.")}this._prevFindLastPredicate=t}let i=qm(this._array,t,this._findLastMonotonousLastIdx);return this._findLastMonotonousLastIdx=i+1,i===-1?void 0:this._array[i]}};Km.assertInvariants=!1;(e=>{function t(o){return o<0}e.isLessThan=t;function i(o){return o<=0}e.isLessThanOrEqual=i;function s(o){return o>0}e.isGreaterThan=s;function r(o){return o===0}e.isNeitherLessOrGreaterThan=r,e.greaterThan=1,e.lessThan=-1,e.neitherLessOrGreaterThan=0})(Ed||(Ed={}));Ym=(e,t)=>e-t,fc=class Ba{constructor(t){this.iterate=t}forEach(t){this.iterate(i=>(t(i),!0))}toArray(){let t=[];return this.iterate(i=>(t.push(i),!0)),t}filter(t){return new Ba(i=>this.iterate(s=>t(s)?i(s):!0))}map(t){return new Ba(i=>this.iterate(s=>i(t(s))))}some(t){let i=!1;return this.iterate(s=>(i=t(s),!i)),i}findFirst(t){let i;return this.iterate(s=>t(s)?(i=s,!1):!0),i}findLast(t){let i;return this.iterate(s=>(t(s)&&(i=s),!0)),i}findLastMaxBy(t){let i,s=!0;return this.iterate(r=>((s||Ed.isGreaterThan(t(r,i)))&&(s=!1,i=r),!0)),i}};fc.empty=new fc(e=>{});_S=class{constructor(e,t){this.toKey=t,this._map=new Map,this[mc]="SetWithKey";for(let i of e)this.add(i)}get size(){return this._map.size}add(e){let t=this.toKey(e);return this._map.set(t,e),this}delete(e){return this._map.delete(this.toKey(e))}has(e){return this._map.has(this.toKey(e))}*entries(){for(let e of this._map.values())yield[e,e]}keys(){return this.values()}*values(){for(let e of this._map.values())yield e}clear(){this._map.clear()}forEach(e,t){this._map.forEach(i=>e.call(t,i,i,this))}[(_c=Symbol.iterator,mc=Symbol.toStringTag,_c)](){return this.values()}},Xm=class{constructor(){this.map=new Map}add(e,t){let i=this.map.get(e);i||(i=new Set,this.map.set(e,i)),i.add(t)}delete(e,t){let i=this.map.get(e);i&&(i.delete(t),i.size===0&&this.map.delete(e))}forEach(e,t){let i=this.map.get(e);i&&i.forEach(t)}get(e){return this.map.get(e)||new Set}};(e=>{function t(y){return y&&typeof y=="object"&&typeof y[Symbol.iterator]=="function"}e.is=t;let i=Object.freeze([]);function s(){return i}e.empty=s;function*r(y){yield y}e.single=r;function o(y){return t(y)?y:r(y)}e.wrap=o;function n(y){return y||i}e.from=n;function*a(y){for(let L=y.length-1;L>=0;L--)yield y[L]}e.reverse=a;function h(y){return!y||y[Symbol.iterator]().next().done===!0}e.isEmpty=h;function l(y){return y[Symbol.iterator]().next().value}e.first=l;function c(y,L){let D=0;for(let O of y)if(L(O,D++))return!0;return!1}e.some=c;function d(y,L){for(let D of y)if(L(D))return D}e.find=d;function*p(y,L){for(let D of y)L(D)&&(yield D)}e.filter=p;function*f(y,L){let D=0;for(let O of y)yield L(O,D++)}e.map=f;function*m(y,L){let D=0;for(let O of y)yield*L(O,D++)}e.flatMap=m;function*_(...y){for(let L of y)yield*L}e.concat=_;function C(y,L,D){let O=D;for(let te of y)O=L(O,te);return O}e.reduce=C;function*k(y,L,D=y.length){for(L<0&&(L+=y.length),D<0?D+=y.length:D>y.length&&(D=y.length);L<D;L++)yield y[L]}e.slice=k;function R(y,L=Number.POSITIVE_INFINITY){let D=[];if(L===0)return[D,y];let O=y[Symbol.iterator]();for(let te=0;te<L;te++){let re=O.next();if(re.done)return[D,e.empty()];D.push(re.value)}return[D,{[Symbol.iterator](){return O}}]}e.consume=R;async function T(y){let L=[];for await(let D of y)L.push(D);return Promise.resolve(L)}e.asyncToArray=T})(Ad||(Ad={}));Zm=!1,Yi=null,Qm=class $d{constructor(){this.livingDisposables=new Map}getDisposableData(t){let i=this.livingDisposables.get(t);return i||(i={parent:null,source:null,isSingleton:!1,value:t,idx:$d.idx++},this.livingDisposables.set(t,i)),i}trackDisposable(t){let i=this.getDisposableData(t);i.source||(i.source=new Error().stack)}setParent(t,i){let s=this.getDisposableData(t);s.parent=i}markAsDisposed(t){this.livingDisposables.delete(t)}markAsSingleton(t){this.getDisposableData(t).isSingleton=!0}getRootParent(t,i){let s=i.get(t);if(s)return s;let r=t.parent?this.getRootParent(this.getDisposableData(t.parent),i):t;return i.set(t,r),r}getTrackedDisposables(){let t=new Map;return[...this.livingDisposables.entries()].filter(([,i])=>i.source!==null&&!this.getRootParent(i,t).isSingleton).flatMap(([i])=>i)}computeLeakingDisposables(t=10,i){let s;if(i)s=i;else{let h=new Map,l=[...this.livingDisposables.values()].filter(d=>d.source!==null&&!this.getRootParent(d,h).isSingleton);if(l.length===0)return;let c=new Set(l.map(d=>d.value));if(s=l.filter(d=>!(d.parent&&c.has(d.parent))),s.length===0)throw new Error("There are cyclic diposable chains!")}if(!s)return;function r(h){function l(d,p){for(;d.length>0&&p.some(f=>typeof f=="string"?f===d[0]:d[0].match(f));)d.shift()}let c=h.source.split(`
`).map(d=>d.trim().replace("at ","")).filter(d=>d!=="");return l(c,["Error",/^trackDisposable \(.*\)$/,/^DisposableTracker.trackDisposable \(.*\)$/]),c.reverse()}let o=new Xm;for(let h of s){let l=r(h);for(let c=0;c<=l.length;c++)o.add(l.slice(0,c).join(`
`),h)}s.sort(jm(h=>h.idx,Ym));let n="",a=0;for(let h of s.slice(0,t)){a++;let l=r(h),c=[];for(let d=0;d<l.length;d++){let p=l[d];p=`(shared with ${o.get(l.slice(0,d+1).join(`
`)).size}/${s.length} leaks) at ${p}`;let f=o.get(l.slice(0,d).join(`
`)),m=Gm([...f].map(_=>r(_)[d]),_=>_);delete m[l[d]];for(let[_,C]of Object.entries(m))c.unshift(`    - stacktraces of ${C.length} other leaks continue with ${_}`);c.unshift(p)}n+=`


==================== Leaking disposable ${a}/${s.length}: ${h.value.constructor.name} ====================
${c.join(`
`)}
============================================================

`}return s.length>t&&(n+=`


... and ${s.length-t} more leaking disposables

`),{leaks:s,details:n}}};Qm.idx=0;if(Zm){let e="__is_disposable_tracked__";e_(new class{trackDisposable(t){let i=new Error("Potentially leaked disposable").stack;setTimeout(()=>{t[e]||console.log(i)},3e3)}setParent(t,i){if(t&&t!==G.None)try{t[e]=!0}catch{}}markAsDisposed(t){if(t&&t!==G.None)try{t[e]=!0}catch{}}markAsSingleton(t){}})}Td=class Ld{constructor(){this._toDispose=new Set,this._isDisposed=!1,Vo(this)}dispose(){this._isDisposed||(Uo(this),this._isDisposed=!0,this.clear())}get isDisposed(){return this._isDisposed}clear(){if(this._toDispose.size!==0)try{Gi(this._toDispose)}finally{this._toDispose.clear()}}add(t){if(!t)return t;if(t===this)throw new Error("Cannot register a disposable on itself!");return xr(t,this),this._isDisposed?Ld.DISABLE_DISPOSED_WARNING||console.warn(new Error("Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!").stack):this._toDispose.add(t),t}delete(t){if(t){if(t===this)throw new Error("Cannot dispose a disposable on itself!");this._toDispose.delete(t),t.dispose()}}deleteAndLeak(t){t&&this._toDispose.has(t)&&(this._toDispose.delete(t),xr(t,null))}};Td.DISABLE_DISPOSED_WARNING=!1;yi=Td,G=class{constructor(){this._store=new yi,Vo(this),xr(this._store,this)}dispose(){Uo(this),this._store.dispose()}_register(e){if(e===this)throw new Error("Cannot register a disposable on itself!");return this._store.add(e)}};G.None=Object.freeze({dispose(){}});Ss=class{constructor(){this._isDisposed=!1,Vo(this)}get value(){return this._isDisposed?void 0:this._value}set value(e){this._isDisposed||e===this._value||(this._value?.dispose(),e&&xr(e,this),this._value=e)}clear(){this.value=void 0}dispose(){this._isDisposed=!0,Uo(this),this._value?.dispose(),this._value=void 0}clearAndLeak(){let e=this._value;return this._value=void 0,e&&xr(e,null),e}},ut=typeof window=="object"?window:globalThis,Pa=class Oa{constructor(t){this.element=t,this.next=Oa.Undefined,this.prev=Oa.Undefined}};Pa.Undefined=new Pa(void 0);ve=Pa,vc=class{constructor(){this._first=ve.Undefined,this._last=ve.Undefined,this._size=0}get size(){return this._size}isEmpty(){return this._first===ve.Undefined}clear(){let e=this._first;for(;e!==ve.Undefined;){let t=e.next;e.prev=ve.Undefined,e.next=ve.Undefined,e=t}this._first=ve.Undefined,this._last=ve.Undefined,this._size=0}unshift(e){return this._insert(e,!1)}push(e){return this._insert(e,!0)}_insert(e,t){let i=new ve(e);if(this._first===ve.Undefined)this._first=i,this._last=i;else if(t){let r=this._last;this._last=i,i.prev=r,r.next=i}else{let r=this._first;this._first=i,i.next=r,r.prev=i}this._size+=1;let s=!1;return()=>{s||(s=!0,this._remove(i))}}shift(){if(this._first!==ve.Undefined){let e=this._first.element;return this._remove(this._first),e}}pop(){if(this._last!==ve.Undefined){let e=this._last.element;return this._remove(this._last),e}}_remove(e){if(e.prev!==ve.Undefined&&e.next!==ve.Undefined){let t=e.prev;t.next=e.next,e.next.prev=t}else e.prev===ve.Undefined&&e.next===ve.Undefined?(this._first=ve.Undefined,this._last=ve.Undefined):e.next===ve.Undefined?(this._last=this._last.prev,this._last.next=ve.Undefined):e.prev===ve.Undefined&&(this._first=this._first.next,this._first.prev=ve.Undefined);this._size-=1}*[Symbol.iterator](){let e=this._first;for(;e!==ve.Undefined;)yield e.element,e=e.next}},s_=globalThis.performance&&typeof globalThis.performance.now=="function",r_=class Dd{static create(t){return new Dd(t)}constructor(t){this._now=s_&&t===!1?Date.now:globalThis.performance.now.bind(globalThis.performance),this._startTime=this._now(),this._stopTime=-1}stop(){this._stopTime=this._now()}reset(){this._startTime=this._now(),this._stopTime=-1}elapsed(){return this._stopTime!==-1?this._stopTime-this._startTime:this._now()-this._startTime}},o_=!1,bc=!1,n_=!1;(e=>{e.None=()=>G.None;function t(S){if(n_){let{onDidAddListener:b}=S,x=Na.create(),w=0;S.onDidAddListener=()=>{++w===2&&(console.warn("snapshotted emitter LIKELY used public and SHOULD HAVE BEEN created with DisposableStore. snapshotted here"),x.print()),b?.()}}}function i(S,b){return p(S,()=>{},0,void 0,!0,void 0,b)}e.defer=i;function s(S){return(b,x=null,w)=>{let A=!1,E;return E=S(P=>{if(!A)return E?E.dispose():A=!0,b.call(x,P)},null,w),A&&E.dispose(),E}}e.once=s;function r(S,b,x){return c((w,A=null,E)=>S(P=>w.call(A,b(P)),null,E),x)}e.map=r;function o(S,b,x){return c((w,A=null,E)=>S(P=>{b(P),w.call(A,P)},null,E),x)}e.forEach=o;function n(S,b,x){return c((w,A=null,E)=>S(P=>b(P)&&w.call(A,P),null,E),x)}e.filter=n;function a(S){return S}e.signal=a;function h(...S){return(b,x=null,w)=>{let A=i_(...S.map(E=>E(P=>b.call(x,P))));return d(A,w)}}e.any=h;function l(S,b,x,w){let A=x;return r(S,E=>(A=b(A,E),A),w)}e.reduce=l;function c(S,b){let x,w={onWillAddFirstListener(){x=S(A.fire,A)},onDidRemoveLastListener(){x?.dispose()}};b||t(w);let A=new M(w);return b?.add(A),A.event}function d(S,b){return b instanceof Array?b.push(S):b&&b.add(S),S}function p(S,b,x=100,w=!1,A=!1,E,P){let V,ne,We,rt=0,_e,Et={leakWarningThreshold:E,onWillAddFirstListener(){V=S(jt=>{rt++,ne=b(ne,jt),w&&!We&&(ke.fire(ne),ne=void 0),_e=()=>{let Li=ne;ne=void 0,We=void 0,(!w||rt>1)&&ke.fire(Li),rt=0},typeof x=="number"?(clearTimeout(We),We=setTimeout(_e,x)):We===void 0&&(We=0,queueMicrotask(_e))})},onWillRemoveListener(){A&&rt>0&&_e?.()},onDidRemoveLastListener(){_e=void 0,V.dispose()}};P||t(Et);let ke=new M(Et);return P?.add(ke),ke.event}e.debounce=p;function f(S,b=0,x){return e.debounce(S,(w,A)=>w?(w.push(A),w):[A],b,void 0,!0,void 0,x)}e.accumulate=f;function m(S,b=(w,A)=>w===A,x){let w=!0,A;return n(S,E=>{let P=w||!b(E,A);return w=!1,A=E,P},x)}e.latch=m;function _(S,b,x){return[e.filter(S,b,x),e.filter(S,w=>!b(w),x)]}e.split=_;function C(S,b=!1,x=[],w){let A=x.slice(),E=S(ne=>{A?A.push(ne):V.fire(ne)});w&&w.add(E);let P=()=>{A?.forEach(ne=>V.fire(ne)),A=null},V=new M({onWillAddFirstListener(){E||(E=S(ne=>V.fire(ne)),w&&w.add(E))},onDidAddFirstListener(){A&&(b?setTimeout(P):P())},onDidRemoveLastListener(){E&&E.dispose(),E=null}});return w&&w.add(V),V.event}e.buffer=C;function k(S,b){return(x,w,A)=>{let E=b(new T);return S(function(P){let V=E.evaluate(P);V!==R&&x.call(w,V)},void 0,A)}}e.chain=k;let R=Symbol("HaltChainable");class T{constructor(){this.steps=[]}map(b){return this.steps.push(b),this}forEach(b){return this.steps.push(x=>(b(x),x)),this}filter(b){return this.steps.push(x=>b(x)?x:R),this}reduce(b,x){let w=x;return this.steps.push(A=>(w=b(w,A),w)),this}latch(b=(x,w)=>x===w){let x=!0,w;return this.steps.push(A=>{let E=x||!b(A,w);return x=!1,w=A,E?A:R}),this}evaluate(b){for(let x of this.steps)if(b=x(b),b===R)break;return b}}function y(S,b,x=w=>w){let w=(...V)=>P.fire(x(...V)),A=()=>S.on(b,w),E=()=>S.removeListener(b,w),P=new M({onWillAddFirstListener:A,onDidRemoveLastListener:E});return P.event}e.fromNodeEventEmitter=y;function L(S,b,x=w=>w){let w=(...V)=>P.fire(x(...V)),A=()=>S.addEventListener(b,w),E=()=>S.removeEventListener(b,w),P=new M({onWillAddFirstListener:A,onDidRemoveLastListener:E});return P.event}e.fromDOMEventEmitter=L;function D(S){return new Promise(b=>s(S)(b))}e.toPromise=D;function O(S){let b=new M;return S.then(x=>{b.fire(x)},()=>{b.fire(void 0)}).finally(()=>{b.dispose()}),b.event}e.fromPromise=O;function te(S,b){return S(x=>b.fire(x))}e.forward=te;function re(S,b,x){return b(x),S(w=>b(w))}e.runAndSubscribe=re;class xe{constructor(b,x){this._observable=b,this._counter=0,this._hasChanged=!1;let w={onWillAddFirstListener:()=>{b.addObserver(this)},onDidRemoveLastListener:()=>{b.removeObserver(this)}};x||t(w),this.emitter=new M(w),x&&x.add(this.emitter)}beginUpdate(b){this._counter++}handlePossibleChange(b){}handleChange(b,x){this._hasChanged=!0}endUpdate(b){this._counter--,this._counter===0&&(this._observable.reportChanges(),this._hasChanged&&(this._hasChanged=!1,this.emitter.fire(this._observable.get())))}}function ie(S,b){return new xe(S,b).emitter.event}e.fromObservable=ie;function Ke(S){return(b,x,w)=>{let A=0,E=!1,P={beginUpdate(){A++},endUpdate(){A--,A===0&&(S.reportChanges(),E&&(E=!1,b.call(x)))},handlePossibleChange(){},handleChange(){E=!0}};S.addObserver(P),S.reportChanges();let V={dispose(){S.removeObserver(P)}};return w instanceof yi?w.add(V):Array.isArray(w)&&w.push(V),V}}e.fromObservableLight=Ke})(Ve||(Ve={}));Ia=class za{constructor(t){this.listenerCount=0,this.invocationCount=0,this.elapsedOverall=0,this.durations=[],this.name=`${t}_${za._idPool++}`,za.all.add(this)}start(t){this._stopWatch=new r_,this.listenerCount=t}stop(){if(this._stopWatch){let t=this._stopWatch.elapsed();this.durations.push(t),this.elapsedOverall+=t,this.invocationCount+=1,this._stopWatch=void 0}}};Ia.all=new Set,Ia._idPool=0;a_=Ia,yc=-1,Rd=class Md{constructor(t,i,s=(Md._idPool++).toString(16).padStart(3,"0")){this._errorHandler=t,this.threshold=i,this.name=s,this._warnCountdown=0}dispose(){this._stacks?.clear()}check(t,i){let s=this.threshold;if(s<=0||i<s)return;this._stacks||(this._stacks=new Map);let r=this._stacks.get(t.value)||0;if(this._stacks.set(t.value,r+1),this._warnCountdown-=1,this._warnCountdown<=0){this._warnCountdown=s*.5;let[o,n]=this.getMostFrequentStack(),a=`[${this.name}] potential listener LEAK detected, having ${i} listeners already. MOST frequent listener (${n}):`;console.warn(a),console.warn(o);let h=new h_(a,o);this._errorHandler(h)}return()=>{let o=this._stacks.get(t.value)||0;this._stacks.set(t.value,o-1)}}getMostFrequentStack(){if(!this._stacks)return;let t,i=0;for(let[s,r]of this._stacks)(!t||i<r)&&(t=[s,r],i=r);return t}};Rd._idPool=1;l_=Rd,Na=class Bd{constructor(t){this.value=t}static create(){let t=new Error;return new Bd(t.stack??"")}print(){console.warn(this.value.split(`
`).slice(2).join(`
`))}},h_=class extends Error{constructor(e,t){super(e),this.name="ListenerLeakError",this.stack=t}},c_=class extends Error{constructor(e,t){super(e),this.name="ListenerRefusalError",this.stack=t}},d_=0,Co=class{constructor(e){this.value=e,this.id=d_++}},u_=2,p_=(e,t)=>{if(e instanceof Co)t(e);else for(let i=0;i<e.length;i++){let s=e[i];s&&t(s)}};if(o_){let e=[];setInterval(()=>{e.length!==0&&(console.warn("[LEAKING LISTENERS] GC'ed these listeners that were NOT yet disposed:"),console.warn(e.join(`
`)),e.length=0)},3e3),xo=new FinalizationRegistry(t=>{typeof t=="string"&&e.push(t)})}M=class{constructor(e){this._size=0,this._options=e,this._leakageMon=yc>0||this._options?.leakWarningThreshold?new l_(e?.onListenerError??So,this._options?.leakWarningThreshold??yc):void 0,this._perfMon=this._options?._profName?new a_(this._options._profName):void 0,this._deliveryQueue=this._options?.deliveryQueue}dispose(){if(!this._disposed){if(this._disposed=!0,this._deliveryQueue?.current===this&&this._deliveryQueue.reset(),this._listeners){if(bc){let e=this._listeners;queueMicrotask(()=>{p_(e,t=>t.stack?.print())})}this._listeners=void 0,this._size=0}this._options?.onDidRemoveLastListener?.(),this._leakageMon?.dispose()}}get event(){return this._event??(this._event=(e,t,i)=>{if(this._leakageMon&&this._size>this._leakageMon.threshold**2){let a=`[${this._leakageMon.name}] REFUSES to accept new listeners because it exceeded its threshold by far (${this._size} vs ${this._leakageMon.threshold})`;console.warn(a);let h=this._leakageMon.getMostFrequentStack()??["UNKNOWN stack",-1],l=new c_(`${a}. HINT: Stack shows most frequent listener (${h[1]}-times)`,h[0]);return(this._options?.onListenerError||So)(l),G.None}if(this._disposed)return G.None;t&&(e=e.bind(t));let s=new Co(e),r,o;this._leakageMon&&this._size>=Math.ceil(this._leakageMon.threshold*.2)&&(s.stack=Na.create(),r=this._leakageMon.check(s.stack,this._size+1)),bc&&(s.stack=o??Na.create()),this._listeners?this._listeners instanceof Co?(this._deliveryQueue??(this._deliveryQueue=new f_),this._listeners=[this._listeners,s]):this._listeners.push(s):(this._options?.onWillAddFirstListener?.(this),this._listeners=s,this._options?.onDidAddFirstListener?.(this)),this._size++;let n=me(()=>{xo?.unregister(n),r?.(),this._removeListener(s)});if(i instanceof yi?i.add(n):Array.isArray(i)&&i.push(n),xo){let a=new Error().stack.split(`
`).slice(2,3).join(`
`).trim(),h=/(file:|vscode-file:\/\/vscode-app)?(\/[^:]*:\d+:\d+)/.exec(a);xo.register(n,h?.[2]??a,n)}return n}),this._event}_removeListener(e){if(this._options?.onWillRemoveListener?.(this),!this._listeners)return;if(this._size===1){this._listeners=void 0,this._options?.onDidRemoveLastListener?.(this),this._size=0;return}let t=this._listeners,i=t.indexOf(e);if(i===-1)throw console.log("disposed?",this._disposed),console.log("size?",this._size),console.log("arr?",JSON.stringify(this._listeners)),new Error("Attempted to dispose unknown listener");this._size--,t[i]=void 0;let s=this._deliveryQueue.current===this;if(this._size*u_<=t.length){let r=0;for(let o=0;o<t.length;o++)t[o]?t[r++]=t[o]:s&&(this._deliveryQueue.end--,r<this._deliveryQueue.i&&this._deliveryQueue.i--);t.length=r}}_deliver(e,t){if(!e)return;let i=this._options?.onListenerError||So;if(!i){e.value(t);return}try{e.value(t)}catch(s){i(s)}}_deliverQueue(e){let t=e.current._listeners;for(;e.i<e.end;)this._deliver(t[e.i++],e.value);e.reset()}fire(e){if(this._deliveryQueue?.current&&(this._deliverQueue(this._deliveryQueue),this._perfMon?.stop()),this._perfMon?.start(this._size),this._listeners)if(this._listeners instanceof Co)this._deliver(this._listeners,e);else{let t=this._deliveryQueue;t.enqueue(this,e,this._listeners.length),this._deliverQueue(t)}this._perfMon?.stop()}hasListeners(){return this._size>0}},f_=class{constructor(){this.i=-1,this.end=0}enqueue(e,t,i){this.i=0,this.end=i,this.current=e,this.value=t}reset(){this.i=this.end,this.current=void 0,this.value=void 0}},Ha=class{constructor(){this.mapWindowIdToZoomLevel=new Map,this._onDidChangeZoomLevel=new M,this.onDidChangeZoomLevel=this._onDidChangeZoomLevel.event,this.mapWindowIdToZoomFactor=new Map,this._onDidChangeFullscreen=new M,this.onDidChangeFullscreen=this._onDidChangeFullscreen.event,this.mapWindowIdToFullScreen=new Map}getZoomLevel(t){return this.mapWindowIdToZoomLevel.get(this.getWindowId(t))??0}setZoomLevel(t,i){if(this.getZoomLevel(i)===t)return;let s=this.getWindowId(i);this.mapWindowIdToZoomLevel.set(s,t),this._onDidChangeZoomLevel.fire(s)}getZoomFactor(t){return this.mapWindowIdToZoomFactor.get(this.getWindowId(t))??1}setZoomFactor(t,i){this.mapWindowIdToZoomFactor.set(this.getWindowId(i),t)}setFullscreen(t,i){if(this.isFullscreen(i)===t)return;let s=this.getWindowId(i);this.mapWindowIdToFullScreen.set(s,t),this._onDidChangeFullscreen.fire(s)}isFullscreen(t){return!!this.mapWindowIdToFullScreen.get(this.getWindowId(t))}getWindowId(t){return t.vscodeWindowId}};Ha.INSTANCE=new Ha;pl=Ha;vS=pl.INSTANCE.onDidChangeZoomLevel;bS=pl.INSTANCE.onDidChangeFullscreen,xs=typeof navigator=="object"?navigator.userAgent:"",Fa=xs.indexOf("Firefox")>=0,ko=xs.indexOf("AppleWebKit")>=0,fl=xs.indexOf("Chrome")>=0,Pd=!fl&&xs.indexOf("Safari")>=0,yS=xs.indexOf("Electron/")>=0,wS=xs.indexOf("Android")>=0,Eo=!1;if(typeof ut.matchMedia=="function"){let e=ut.matchMedia("(display-mode: standalone) or (display-mode: window-controls-overlay)"),t=ut.matchMedia("(display-mode: fullscreen)");Eo=e.matches,m_(ut,e,({matches:i})=>{Eo&&t.matches||(Eo=i)})}ws="en",Mo=!1,Bo=!1,Sr=!1,v_=!1,Od=!1,Id=!1,b_=!1,y_=!1,w_=!1,S_=!1,Ao=ws,wc=ws,Qt=globalThis;typeof Qt.vscode<"u"&&typeof Qt.vscode.process<"u"?dt=Qt.vscode.process:typeof process<"u"&&typeof process?.versions?.node=="string"&&(dt=process);zd=typeof dt?.versions?.electron=="string",x_=zd&&dt?.type==="renderer";if(typeof dt=="object"){Mo=dt.platform==="win32",Bo=dt.platform==="darwin",Sr=dt.platform==="linux",v_=Sr&&!!dt.env.SNAP&&!!dt.env.SNAP_REVISION,b_=zd,w_=!!dt.env.CI||!!dt.env.BUILD_ARTIFACTSTAGINGDIRECTORY,go=ws,Ao=ws;let e=dt.env.VSCODE_NLS_CONFIG;if(e)try{let t=JSON.parse(e);go=t.userLocale,wc=t.osLocale,Ao=t.resolvedLanguage||ws,C_=t.languagePack?.translationsConfigFile}catch{}Od=!0}else typeof navigator=="object"&&!x_?(Jt=navigator.userAgent,Mo=Jt.indexOf("Windows")>=0,Bo=Jt.indexOf("Macintosh")>=0,y_=(Jt.indexOf("Macintosh")>=0||Jt.indexOf("iPad")>=0||Jt.indexOf("iPhone")>=0)&&!!navigator.maxTouchPoints&&navigator.maxTouchPoints>0,Sr=Jt.indexOf("Linux")>=0,S_=Jt?.indexOf("Mobi")>=0,Id=!0,Ao=globalThis._VSCODE_NLS_LANGUAGE||ws,go=navigator.language.toLowerCase(),wc=go):console.error("Unable to resolve platform.");ua=0;Bo?ua=1:Mo?ua=3:Sr&&(ua=2);Nd=Mo,zt=Bo,k_=Sr,pa=Od,E_=Id&&typeof Qt.importScripts=="function",SS=E_?Qt.origin:void 0,Nt=Jt,fi=Ao;(e=>{function t(){return fi}e.value=t;function i(){return fi.length===2?fi==="en":fi.length>=3?fi[0]==="e"&&fi[1]==="n"&&fi[2]==="-":!1}e.isDefaultVariant=i;function s(){return fi==="en"}e.isDefault=s})(A_||(A_={}));$_=typeof Qt.postMessage=="function"&&!Qt.importScripts,T_=(()=>{if($_){let e=[];Qt.addEventListener("message",i=>{if(i.data&&i.data.vscodeScheduleAsyncWork)for(let s=0,r=e.length;s<r;s++){let o=e[s];if(o.id===i.data.vscodeScheduleAsyncWork){e.splice(s,1),o.callback();return}}});let t=0;return i=>{let s=++t;e.push({id:s,callback:i}),Qt.postMessage({vscodeScheduleAsyncWork:s},"*")}}return e=>setTimeout(e)})(),L_=!!(Nt&&Nt.indexOf("Chrome")>=0),CS=!!(Nt&&Nt.indexOf("Firefox")>=0),xS=!!(!L_&&Nt&&Nt.indexOf("Safari")>=0),kS=!!(Nt&&Nt.indexOf("Edg/")>=0),ES=!!(Nt&&Nt.indexOf("Android")>=0),mi=typeof navigator=="object"?navigator:{},AS={clipboard:{writeText:pa||document.queryCommandSupported&&document.queryCommandSupported("copy")||!!(mi&&mi.clipboard&&mi.clipboard.writeText),readText:pa||!!(mi&&mi.clipboard&&mi.clipboard.readText)},keyboard:pa||g_()?0:mi.keyboard||Pd?1:2,touch:"ontouchstart"in ut||mi.maxTouchPoints>0,pointerEvents:ut.PointerEvent&&("ontouchstart"in ut||navigator.maxTouchPoints>0)},ml=class{constructor(){this._keyCodeToStr=[],this._strToKeyCode=Object.create(null)}define(e,t){this._keyCodeToStr[e]=t,this._strToKeyCode[t.toLowerCase()]=e}keyCodeToStr(e){return this._keyCodeToStr[e]}strToKeyCode(e){return this._strToKeyCode[e.toLowerCase()]||0}},fa=new ml,Sc=new ml,Cc=new ml,D_=new Array(230);(e=>{function t(a){return fa.keyCodeToStr(a)}e.toString=t;function i(a){return fa.strToKeyCode(a)}e.fromString=i;function s(a){return Sc.keyCodeToStr(a)}e.toUserSettingsUS=s;function r(a){return Cc.keyCodeToStr(a)}e.toUserSettingsGeneral=r;function o(a){return Sc.strToKeyCode(a)||Cc.strToKeyCode(a)}e.fromUserSettings=o;function n(a){if(a>=98&&a<=113)return null;switch(a){case 16:return"Up";case 18:return"Down";case 15:return"Left";case 17:return"Right"}return fa.keyCodeToStr(a)}e.toElectronAccelerator=n})(Hd||(Hd={}));R_=class Fd{constructor(t,i,s,r,o){this.ctrlKey=t,this.shiftKey=i,this.altKey=s,this.metaKey=r,this.keyCode=o}equals(t){return t instanceof Fd&&this.ctrlKey===t.ctrlKey&&this.shiftKey===t.shiftKey&&this.altKey===t.altKey&&this.metaKey===t.metaKey&&this.keyCode===t.keyCode}getHashCode(){let t=this.ctrlKey?"1":"0",i=this.shiftKey?"1":"0",s=this.altKey?"1":"0",r=this.metaKey?"1":"0";return`K${t}${i}${s}${r}${this.keyCode}`}isModifierKey(){return this.keyCode===0||this.keyCode===5||this.keyCode===57||this.keyCode===6||this.keyCode===4}toKeybinding(){return new M_([this])}isDuplicateModifierCase(){return this.ctrlKey&&this.keyCode===5||this.shiftKey&&this.keyCode===4||this.altKey&&this.keyCode===6||this.metaKey&&this.keyCode===57}},M_=class{constructor(e){if(e.length===0)throw Um("chords");this.chords=e}getHashCode(){let e="";for(let t=0,i=this.chords.length;t<i;t++)t!==0&&(e+=";"),e+=this.chords[t].getHashCode();return e}equals(e){if(e===null||this.chords.length!==e.chords.length)return!1;for(let t=0;t<this.chords.length;t++)if(!this.chords[t].equals(e.chords[t]))return!1;return!0}};P_=zt?256:2048,O_=512,I_=1024,z_=zt?2048:256,Wa=class{constructor(e){this._standardKeyboardEventBrand=!0;let t=e;this.browserEvent=t,this.target=t.target,this.ctrlKey=t.ctrlKey,this.shiftKey=t.shiftKey,this.altKey=t.altKey,this.metaKey=t.metaKey,this.altGraphKey=t.getModifierState?.("AltGraph"),this.keyCode=B_(t),this.code=t.code,this.ctrlKey=this.ctrlKey||this.keyCode===5,this.altKey=this.altKey||this.keyCode===6,this.shiftKey=this.shiftKey||this.keyCode===4,this.metaKey=this.metaKey||this.keyCode===57,this._asKeybinding=this._computeKeybinding(),this._asKeyCodeChord=this._computeKeyCodeChord()}preventDefault(){this.browserEvent&&this.browserEvent.preventDefault&&this.browserEvent.preventDefault()}stopPropagation(){this.browserEvent&&this.browserEvent.stopPropagation&&this.browserEvent.stopPropagation()}toKeyCodeChord(){return this._asKeyCodeChord}equals(e){return this._asKeybinding===e}_computeKeybinding(){let e=0;this.keyCode!==5&&this.keyCode!==4&&this.keyCode!==6&&this.keyCode!==57&&(e=this.keyCode);let t=0;return this.ctrlKey&&(t|=P_),this.altKey&&(t|=O_),this.shiftKey&&(t|=I_),this.metaKey&&(t|=z_),t|=e,t}_computeKeyCodeChord(){let e=0;return this.keyCode!==5&&this.keyCode!==4&&this.keyCode!==6&&this.keyCode!==57&&(e=this.keyCode),new R_(this.ctrlKey,this.shiftKey,this.altKey,this.metaKey,e)}},xc=new WeakMap;H_=class{static getSameOriginWindowChain(e){let t=xc.get(e);if(!t){t=[],xc.set(e,t);let i=e,s;do s=N_(i),s?t.push({window:new WeakRef(i),iframeElement:i.frameElement||null}):t.push({window:new WeakRef(i),iframeElement:null}),i=s;while(i)}return t.slice(0)}static getPositionOfChildWindowRelativeToAncestorWindow(e,t){if(!t||e===t)return{top:0,left:0};let i=0,s=0,r=this.getSameOriginWindowChain(e);for(let o of r){let n=o.window.deref();if(i+=n?.scrollY??0,s+=n?.scrollX??0,n===t||!o.iframeElement)break;let a=o.iframeElement.getBoundingClientRect();i+=a.top,s+=a.left}return{top:i,left:s}}},_r=class{constructor(e,t){this.timestamp=Date.now(),this.browserEvent=t,this.leftButton=t.button===0,this.middleButton=t.button===1,this.rightButton=t.button===2,this.buttons=t.buttons,this.target=t.target,this.detail=t.detail||1,t.type==="dblclick"&&(this.detail=2),this.ctrlKey=t.ctrlKey,this.shiftKey=t.shiftKey,this.altKey=t.altKey,this.metaKey=t.metaKey,typeof t.pageX=="number"?(this.posx=t.pageX,this.posy=t.pageY):(this.posx=t.clientX+this.target.ownerDocument.body.scrollLeft+this.target.ownerDocument.documentElement.scrollLeft,this.posy=t.clientY+this.target.ownerDocument.body.scrollTop+this.target.ownerDocument.documentElement.scrollTop);let i=H_.getPositionOfChildWindowRelativeToAncestorWindow(e,t.view);this.posx-=i.left,this.posy-=i.top}preventDefault(){this.browserEvent.preventDefault()}stopPropagation(){this.browserEvent.stopPropagation()}},kc=class{constructor(e,t=0,i=0){this.browserEvent=e||null,this.target=e?e.target||e.targetNode||e.srcElement:null,this.deltaY=i,this.deltaX=t;let s=!1;if(fl){let r=navigator.userAgent.match(/Chrome\/(\d+)/);s=(r?parseInt(r[1]):123)<=122}if(e){let r=e,o=e,n=e.view?.devicePixelRatio||1;if(typeof r.wheelDeltaY<"u")s?this.deltaY=r.wheelDeltaY/(120*n):this.deltaY=r.wheelDeltaY/120;else if(typeof o.VERTICAL_AXIS<"u"&&o.axis===o.VERTICAL_AXIS)this.deltaY=-o.detail/3;else if(e.type==="wheel"){let a=e;a.deltaMode===a.DOM_DELTA_LINE?Fa&&!zt?this.deltaY=-e.deltaY/3:this.deltaY=-e.deltaY:this.deltaY=-e.deltaY/40}if(typeof r.wheelDeltaX<"u")Pd&&Nd?this.deltaX=-(r.wheelDeltaX/120):s?this.deltaX=r.wheelDeltaX/(120*n):this.deltaX=r.wheelDeltaX/120;else if(typeof o.HORIZONTAL_AXIS<"u"&&o.axis===o.HORIZONTAL_AXIS)this.deltaX=-e.detail/3;else if(e.type==="wheel"){let a=e;a.deltaMode===a.DOM_DELTA_LINE?Fa&&!zt?this.deltaX=-e.deltaX/3:this.deltaX=-e.deltaX:this.deltaX=-e.deltaX/40}this.deltaY===0&&this.deltaX===0&&e.wheelDelta&&(s?this.deltaY=e.wheelDelta/(120*n):this.deltaY=e.wheelDelta/120)}}preventDefault(){this.browserEvent?.preventDefault()}stopPropagation(){this.browserEvent?.stopPropagation()}},Wd=Object.freeze(function(e,t){let i=setTimeout(e.bind(t),0);return{dispose(){clearTimeout(i)}}});(e=>{function t(i){return i===e.None||i===e.Cancelled||i instanceof W_?!0:!i||typeof i!="object"?!1:typeof i.isCancellationRequested=="boolean"&&typeof i.onCancellationRequested=="function"}e.isCancellationToken=t,e.None=Object.freeze({isCancellationRequested:!1,onCancellationRequested:Ve.None}),e.Cancelled=Object.freeze({isCancellationRequested:!0,onCancellationRequested:Wd})})(F_||(F_={}));W_=class{constructor(){this._isCancelled=!1,this._emitter=null}cancel(){this._isCancelled||(this._isCancelled=!0,this._emitter&&(this._emitter.fire(void 0),this.dispose()))}get isCancellationRequested(){return this._isCancelled}get onCancellationRequested(){return this._isCancelled?Wd:(this._emitter||(this._emitter=new M),this._emitter.event)}dispose(){this._emitter&&(this._emitter.dispose(),this._emitter=null)}},_l=class{constructor(e,t){this._isDisposed=!1,this._token=-1,typeof e=="function"&&typeof t=="number"&&this.setIfNotSet(e,t)}dispose(){this.cancel(),this._isDisposed=!0}cancel(){this._token!==-1&&(clearTimeout(this._token),this._token=-1)}cancelAndSet(e,t){if(this._isDisposed)throw new Ma("Calling 'cancelAndSet' on a disposed TimeoutTimer");this.cancel(),this._token=setTimeout(()=>{this._token=-1,e()},t)}setIfNotSet(e,t){if(this._isDisposed)throw new Ma("Calling 'setIfNotSet' on a disposed TimeoutTimer");this._token===-1&&(this._token=setTimeout(()=>{this._token=-1,e()},t))}},V_=class{constructor(){this.disposable=void 0,this.isDisposed=!1}cancel(){this.disposable?.dispose(),this.disposable=void 0}cancelAndSet(e,t,i=globalThis){if(this.isDisposed)throw new Ma("Calling 'cancelAndSet' on a disposed IntervalTimer");this.cancel();let s=i.setInterval(()=>{e()},t);this.disposable=me(()=>{i.clearInterval(s),this.disposable=void 0})}dispose(){this.cancel(),this.isDisposed=!0}};(function(){typeof globalThis.requestIdleCallback!="function"||typeof globalThis.cancelIdleCallback!="function"?ma=(e,t)=>{T_(()=>{if(i)return;let s=Date.now()+15;t(Object.freeze({didTimeout:!0,timeRemaining(){return Math.max(0,s-Date.now())}}))});let i=!1;return{dispose(){i||(i=!0)}}}:ma=(e,t,i)=>{let s=e.requestIdleCallback(t,typeof i=="number"?{timeout:i}:void 0),r=!1;return{dispose(){r||(r=!0,e.cancelIdleCallback(s))}}},U_=e=>ma(globalThis,e)})();(e=>{async function t(s){let r,o=await Promise.all(s.map(n=>n.then(a=>a,a=>{r||(r=a)})));if(typeof r<"u")throw r;return o}e.settled=t;function i(s){return new Promise(async(r,o)=>{try{await s(r,o)}catch(n){o(n)}})}e.withAsyncBody=i})(q_||(q_={}));Ec=class gt{static fromArray(t){return new gt(i=>{i.emitMany(t)})}static fromPromise(t){return new gt(async i=>{i.emitMany(await t)})}static fromPromises(t){return new gt(async i=>{await Promise.all(t.map(async s=>i.emitOne(await s)))})}static merge(t){return new gt(async i=>{await Promise.all(t.map(async s=>{for await(let r of s)i.emitOne(r)}))})}constructor(t,i){this._state=0,this._results=[],this._error=null,this._onReturn=i,this._onStateChanged=new M,queueMicrotask(async()=>{let s={emitOne:r=>this.emitOne(r),emitMany:r=>this.emitMany(r),reject:r=>this.reject(r)};try{await Promise.resolve(t(s)),this.resolve()}catch(r){this.reject(r)}finally{s.emitOne=void 0,s.emitMany=void 0,s.reject=void 0}})}[Symbol.asyncIterator](){let t=0;return{next:async()=>{do{if(this._state===2)throw this._error;if(t<this._results.length)return{done:!1,value:this._results[t++]};if(this._state===1)return{done:!0,value:void 0};await Ve.toPromise(this._onStateChanged.event)}while(!0)},return:async()=>(this._onReturn?.(),{done:!0,value:void 0})}}static map(t,i){return new gt(async s=>{for await(let r of t)s.emitOne(i(r))})}map(t){return gt.map(this,t)}static filter(t,i){return new gt(async s=>{for await(let r of t)i(r)&&s.emitOne(r)})}filter(t){return gt.filter(this,t)}static coalesce(t){return gt.filter(t,i=>!!i)}coalesce(){return gt.coalesce(this)}static async toPromise(t){let i=[];for await(let s of t)i.push(s);return i}toPromise(){return gt.toPromise(this)}emitOne(t){this._state===0&&(this._results.push(t),this._onStateChanged.fire())}emitMany(t){this._state===0&&(this._results=this._results.concat(t),this._onStateChanged.fire())}resolve(){this._state===0&&(this._state=1,this._onStateChanged.fire())}reject(t){this._state===0&&(this._state=2,this._error=t,this._onStateChanged.fire())}};Ec.EMPTY=Ec.fromArray([]);Q_=class Ud{constructor(){this._h0=1732584193,this._h1=4023233417,this._h2=2562383102,this._h3=271733878,this._h4=3285377520,this._buff=new Uint8Array(67),this._buffDV=new DataView(this._buff.buffer),this._buffLen=0,this._totalLen=0,this._leftoverHighSurrogate=0,this._finished=!1}update(t){let i=t.length;if(i===0)return;let s=this._buff,r=this._buffLen,o=this._leftoverHighSurrogate,n,a;for(o!==0?(n=o,a=-1,o=0):(n=t.charCodeAt(0),a=0);;){let h=n;if(K_(n))if(a+1<i){let l=t.charCodeAt(a+1);Ac(l)?(a++,h=j_(n,l)):h=65533}else{o=n;break}else Ac(n)&&(h=65533);if(r=this._push(s,r,h),a++,a<i)n=t.charCodeAt(a);else break}this._buffLen=r,this._leftoverHighSurrogate=o}_push(t,i,s){return s<128?t[i++]=s:s<2048?(t[i++]=192|(s&1984)>>>6,t[i++]=128|(s&63)>>>0):s<65536?(t[i++]=224|(s&61440)>>>12,t[i++]=128|(s&4032)>>>6,t[i++]=128|(s&63)>>>0):(t[i++]=240|(s&1835008)>>>18,t[i++]=128|(s&258048)>>>12,t[i++]=128|(s&4032)>>>6,t[i++]=128|(s&63)>>>0),i>=64&&(this._step(),i-=64,this._totalLen+=64,t[0]=t[64],t[1]=t[65],t[2]=t[66]),i}digest(){return this._finished||(this._finished=!0,this._leftoverHighSurrogate&&(this._leftoverHighSurrogate=0,this._buffLen=this._push(this._buff,this._buffLen,65533)),this._totalLen+=this._buffLen,this._wrapUp()),hr(this._h0)+hr(this._h1)+hr(this._h2)+hr(this._h3)+hr(this._h4)}_wrapUp(){this._buff[this._buffLen++]=128,$c(this._buff,this._buffLen),this._buffLen>56&&(this._step(),$c(this._buff));let t=8*this._totalLen;this._buffDV.setUint32(56,Math.floor(t/4294967296),!1),this._buffDV.setUint32(60,t%4294967296,!1),this._step()}_step(){let t=Ud._bigBlock32,i=this._buffDV;for(let d=0;d<64;d+=4)t.setUint32(d,i.getUint32(d,!1),!1);for(let d=64;d<320;d+=4)t.setUint32(d,_a(t.getUint32(d-12,!1)^t.getUint32(d-32,!1)^t.getUint32(d-56,!1)^t.getUint32(d-64,!1),1),!1);let s=this._h0,r=this._h1,o=this._h2,n=this._h3,a=this._h4,h,l,c;for(let d=0;d<80;d++)d<20?(h=r&o|~r&n,l=1518500249):d<40?(h=r^o^n,l=1859775393):d<60?(h=r&o|r&n|o&n,l=2400959708):(h=r^o^n,l=3395469782),c=_a(s,5)+h+a+l+t.getUint32(d*4,!1)&4294967295,a=n,n=o,o=_a(r,30),r=s,s=c;this._h0=this._h0+s&4294967295,this._h1=this._h1+r&4294967295,this._h2=this._h2+o&4294967295,this._h3=this._h3+n&4294967295,this._h4=this._h4+a&4294967295}};Q_._bigBlock32=new DataView(new ArrayBuffer(320));({registerWindow:$S,getWindow:Tt,getDocument:TS,getWindows:LS,getWindowsCount:DS,getWindowId:Tc,getWindowById:RS,hasWindow:MS,onDidRegisterWindow:eg,onWillUnregisterWindow:BS,onDidUnregisterWindow:PS}=(function(){let e=new Map,t={window:ut,disposables:new yi};e.set(ut.vscodeWindowId,t);let i=new M,s=new M,r=new M;function o(n,a){return(typeof n=="number"?e.get(n):void 0)??(a?t:void 0)}return{onDidRegisterWindow:i.event,onWillUnregisterWindow:r.event,onDidUnregisterWindow:s.event,registerWindow(n){if(e.has(n.vscodeWindowId))return G.None;let a=new yi,h={window:n,disposables:a.add(new yi)};return e.set(n.vscodeWindowId,h),a.add(me(()=>{e.delete(n.vscodeWindowId),s.fire(n)})),a.add(W(n,Re.BEFORE_UNLOAD,()=>{r.fire(n)})),i.fire(h),a},getWindows(){return e.values()},getWindowsCount(){return e.size},getWindowId(n){return n.vscodeWindowId},hasWindow(n){return e.has(n)},getWindowById:o,getWindow(n){let a=n;if(a?.ownerDocument?.defaultView)return a.ownerDocument.defaultView.window;let h=n;return h?.view?h.view.window:ut},getDocument(n){return Tt(n).document}}})()),tg=class{constructor(e,t,i,s){this._node=e,this._type=t,this._handler=i,this._options=s||!1,this._node.addEventListener(this._type,this._handler,this._options)}dispose(){this._handler&&(this._node.removeEventListener(this._type,this._handler,this._options),this._node=null,this._handler=null)}};Lc=function(e,t,i,s){let r=i;return t==="click"||t==="mousedown"||t==="contextmenu"?r=ig(Tt(e),i):(t==="keydown"||t==="keypress"||t==="keyup")&&(r=sg(i)),W(e,t,r,s)},og=class extends V_{constructor(e){super(),this.defaultTarget=e&&Tt(e)}cancelAndSet(e,t,i){return super.cancelAndSet(e,t,i??this.defaultTarget)}},ga=class{constructor(e,t=0){this._runner=e,this.priority=t,this._canceled=!1}dispose(){this._canceled=!0}execute(){if(!this._canceled)try{this._runner()}catch(e){So(e)}}static sort(e,t){return t.priority-e.priority}};(function(){let e=new Map,t=new Map,i=new Map,s=new Map,r=o=>{i.set(o,!1);let n=e.get(o)??[];for(t.set(o,n),e.set(o,[]),s.set(o,!0);n.length>0;)n.sort(ga.sort),n.shift().execute();s.set(o,!1)};Po=(o,n,a=0)=>{let h=Tc(o),l=new ga(n,a),c=e.get(h);return c||(c=[],e.set(h,c)),c.push(l),i.get(h)||(i.set(h,!0),o.requestAnimationFrame(()=>r(h))),l},rg=(o,n,a)=>{let h=Tc(o);if(s.get(h)){let l=new ga(n,a),c=t.get(h);return c||(c=[],t.set(h,c)),c.push(l),l}else return Po(o,n,a)}})();Dc=class $o{constructor(t,i){this.width=t,this.height=i}with(t=this.width,i=this.height){return t!==this.width||i!==this.height?new $o(t,i):this}static is(t){return typeof t=="object"&&typeof t.height=="number"&&typeof t.width=="number"}static lift(t){return t instanceof $o?t:new $o(t.width,t.height)}static equals(t,i){return t===i?!0:!t||!i?!1:t.width===i.width&&t.height===i.height}};Dc.None=new Dc(0,0);OS=new class{constructor(){this.mutationObservers=new Map}observe(e,t,i){let s=this.mutationObservers.get(e);s||(s=new Map,this.mutationObservers.set(e,s));let r=Y_(i),o=s.get(r);if(o)o.users+=1;else{let n=new M,a=new MutationObserver(l=>n.fire(l));a.observe(e,i);let h=o={users:1,observer:a,onDidMutate:n.event};t.add(me(()=>{h.users-=1,h.users===0&&(n.dispose(),a.disconnect(),s?.delete(r),s?.size===0&&this.mutationObservers.delete(e))})),s.set(r,o)}return o.onDidMutate}},Re={CLICK:"click",AUXCLICK:"auxclick",DBLCLICK:"dblclick",MOUSE_UP:"mouseup",MOUSE_DOWN:"mousedown",MOUSE_OVER:"mouseover",MOUSE_MOVE:"mousemove",MOUSE_OUT:"mouseout",MOUSE_ENTER:"mouseenter",MOUSE_LEAVE:"mouseleave",MOUSE_WHEEL:"wheel",POINTER_UP:"pointerup",POINTER_DOWN:"pointerdown",POINTER_MOVE:"pointermove",POINTER_LEAVE:"pointerleave",CONTEXT_MENU:"contextmenu",WHEEL:"wheel",KEY_DOWN:"keydown",KEY_PRESS:"keypress",KEY_UP:"keyup",LOAD:"load",BEFORE_UNLOAD:"beforeunload",UNLOAD:"unload",PAGE_SHOW:"pageshow",PAGE_HIDE:"pagehide",PASTE:"paste",ABORT:"abort",ERROR:"error",RESIZE:"resize",SCROLL:"scroll",FULLSCREEN_CHANGE:"fullscreenchange",WK_FULLSCREEN_CHANGE:"webkitfullscreenchange",SELECT:"select",CHANGE:"change",SUBMIT:"submit",RESET:"reset",FOCUS:"focus",FOCUS_IN:"focusin",FOCUS_OUT:"focusout",BLUR:"blur",INPUT:"input",STORAGE:"storage",DRAG_START:"dragstart",DRAG:"drag",DRAG_ENTER:"dragenter",DRAG_LEAVE:"dragleave",DRAG_OVER:"dragover",DROP:"drop",DRAG_END:"dragend",ANIMATION_START:ko?"webkitAnimationStart":"animationstart",ANIMATION_END:ko?"webkitAnimationEnd":"animationend",ANIMATION_ITERATION:ko?"webkitAnimationIteration":"animationiteration"},ag=/([\w\-]+)?(#([\w\-]+))?((\.([\w\-]+))*)/;lg.SVG=function(e,t,...i){return qd("http://www.w3.org/2000/svg",e,t,...i)};hg=class{constructor(e){this.domNode=e,this._maxWidth="",this._width="",this._height="",this._top="",this._left="",this._bottom="",this._right="",this._paddingTop="",this._paddingLeft="",this._paddingBottom="",this._paddingRight="",this._fontFamily="",this._fontWeight="",this._fontSize="",this._fontStyle="",this._fontFeatureSettings="",this._fontVariationSettings="",this._textDecoration="",this._lineHeight="",this._letterSpacing="",this._className="",this._display="",this._position="",this._visibility="",this._color="",this._backgroundColor="",this._layerHint=!1,this._contain="none",this._boxShadow=""}setMaxWidth(e){let t=ot(e);this._maxWidth!==t&&(this._maxWidth=t,this.domNode.style.maxWidth=this._maxWidth)}setWidth(e){let t=ot(e);this._width!==t&&(this._width=t,this.domNode.style.width=this._width)}setHeight(e){let t=ot(e);this._height!==t&&(this._height=t,this.domNode.style.height=this._height)}setTop(e){let t=ot(e);this._top!==t&&(this._top=t,this.domNode.style.top=this._top)}setLeft(e){let t=ot(e);this._left!==t&&(this._left=t,this.domNode.style.left=this._left)}setBottom(e){let t=ot(e);this._bottom!==t&&(this._bottom=t,this.domNode.style.bottom=this._bottom)}setRight(e){let t=ot(e);this._right!==t&&(this._right=t,this.domNode.style.right=this._right)}setPaddingTop(e){let t=ot(e);this._paddingTop!==t&&(this._paddingTop=t,this.domNode.style.paddingTop=this._paddingTop)}setPaddingLeft(e){let t=ot(e);this._paddingLeft!==t&&(this._paddingLeft=t,this.domNode.style.paddingLeft=this._paddingLeft)}setPaddingBottom(e){let t=ot(e);this._paddingBottom!==t&&(this._paddingBottom=t,this.domNode.style.paddingBottom=this._paddingBottom)}setPaddingRight(e){let t=ot(e);this._paddingRight!==t&&(this._paddingRight=t,this.domNode.style.paddingRight=this._paddingRight)}setFontFamily(e){this._fontFamily!==e&&(this._fontFamily=e,this.domNode.style.fontFamily=this._fontFamily)}setFontWeight(e){this._fontWeight!==e&&(this._fontWeight=e,this.domNode.style.fontWeight=this._fontWeight)}setFontSize(e){let t=ot(e);this._fontSize!==t&&(this._fontSize=t,this.domNode.style.fontSize=this._fontSize)}setFontStyle(e){this._fontStyle!==e&&(this._fontStyle=e,this.domNode.style.fontStyle=this._fontStyle)}setFontFeatureSettings(e){this._fontFeatureSettings!==e&&(this._fontFeatureSettings=e,this.domNode.style.fontFeatureSettings=this._fontFeatureSettings)}setFontVariationSettings(e){this._fontVariationSettings!==e&&(this._fontVariationSettings=e,this.domNode.style.fontVariationSettings=this._fontVariationSettings)}setTextDecoration(e){this._textDecoration!==e&&(this._textDecoration=e,this.domNode.style.textDecoration=this._textDecoration)}setLineHeight(e){let t=ot(e);this._lineHeight!==t&&(this._lineHeight=t,this.domNode.style.lineHeight=this._lineHeight)}setLetterSpacing(e){let t=ot(e);this._letterSpacing!==t&&(this._letterSpacing=t,this.domNode.style.letterSpacing=this._letterSpacing)}setClassName(e){this._className!==e&&(this._className=e,this.domNode.className=this._className)}toggleClassName(e,t){this.domNode.classList.toggle(e,t),this._className=this.domNode.className}setDisplay(e){this._display!==e&&(this._display=e,this.domNode.style.display=this._display)}setPosition(e){this._position!==e&&(this._position=e,this.domNode.style.position=this._position)}setVisibility(e){this._visibility!==e&&(this._visibility=e,this.domNode.style.visibility=this._visibility)}setColor(e){this._color!==e&&(this._color=e,this.domNode.style.color=this._color)}setBackgroundColor(e){this._backgroundColor!==e&&(this._backgroundColor=e,this.domNode.style.backgroundColor=this._backgroundColor)}setLayerHinting(e){this._layerHint!==e&&(this._layerHint=e,this.domNode.style.transform=this._layerHint?"translate3d(0px, 0px, 0px)":"")}setBoxShadow(e){this._boxShadow!==e&&(this._boxShadow=e,this.domNode.style.boxShadow=e)}setContain(e){this._contain!==e&&(this._contain=e,this.domNode.style.contain=this._contain)}setAttribute(e,t){this.domNode.setAttribute(e,t)}removeAttribute(e){this.domNode.removeAttribute(e)}appendChild(e){this.domNode.appendChild(e.domNode)}removeChild(e){this.domNode.removeChild(e.domNode)}};Kd=class{constructor(){this._hooks=new yi,this._pointerMoveCallback=null,this._onStopCallback=null}dispose(){this.stopMonitoring(!1),this._hooks.dispose()}stopMonitoring(e,t){if(!this.isMonitoring())return;this._hooks.clear(),this._pointerMoveCallback=null;let i=this._onStopCallback;this._onStopCallback=null,e&&i&&i(t)}isMonitoring(){return!!this._pointerMoveCallback}startMonitoring(e,t,i,s,r){this.isMonitoring()&&this.stopMonitoring(!1),this._pointerMoveCallback=s,this._onStopCallback=r;let o=e;try{e.setPointerCapture(t),this._hooks.add(me(()=>{try{e.releasePointerCapture(t)}catch{}}))}catch{o=Tt(e)}this._hooks.add(W(o,Re.POINTER_MOVE,n=>{if(n.buttons!==i){this.stopMonitoring(!0);return}n.preventDefault(),this._pointerMoveCallback(n)})),this._hooks.add(W(o,Re.POINTER_UP,n=>this.stopMonitoring(!0)))}};(e=>(e.Tap="-xterm-gesturetap",e.Change="-xterm-gesturechange",e.Start="-xterm-gesturestart",e.End="-xterm-gesturesend",e.Contextmenu="-xterm-gesturecontextmenu"))(It||(It={}));gr=class Ye extends G{constructor(){super(),this.dispatched=!1,this.targets=new vc,this.ignoreTargets=new vc,this.activeTouches={},this.handle=null,this._lastSetTapCountTime=0,this._register(Ve.runAndSubscribe(eg,({window:t,disposables:i})=>{i.add(W(t.document,"touchstart",s=>this.onTouchStart(s),{passive:!1})),i.add(W(t.document,"touchend",s=>this.onTouchEnd(t,s))),i.add(W(t.document,"touchmove",s=>this.onTouchMove(s),{passive:!1}))},{window:ut,disposables:this._store}))}static addTarget(t){if(!Ye.isTouchDevice())return G.None;Ye.INSTANCE||(Ye.INSTANCE=gc(new Ye));let i=Ye.INSTANCE.targets.push(t);return me(i)}static ignoreTarget(t){if(!Ye.isTouchDevice())return G.None;Ye.INSTANCE||(Ye.INSTANCE=gc(new Ye));let i=Ye.INSTANCE.ignoreTargets.push(t);return me(i)}static isTouchDevice(){return"ontouchstart"in ut||navigator.maxTouchPoints>0}dispose(){this.handle&&(this.handle.dispose(),this.handle=null),super.dispose()}onTouchStart(t){let i=Date.now();this.handle&&(this.handle.dispose(),this.handle=null);for(let s=0,r=t.targetTouches.length;s<r;s++){let o=t.targetTouches.item(s);this.activeTouches[o.identifier]={id:o.identifier,initialTarget:o.target,initialTimeStamp:i,initialPageX:o.pageX,initialPageY:o.pageY,rollingTimestamps:[i],rollingPageX:[o.pageX],rollingPageY:[o.pageY]};let n=this.newGestureEvent(It.Start,o.target);n.pageX=o.pageX,n.pageY=o.pageY,this.dispatchEvent(n)}this.dispatched&&(t.preventDefault(),t.stopPropagation(),this.dispatched=!1)}onTouchEnd(t,i){let s=Date.now(),r=Object.keys(this.activeTouches).length;for(let o=0,n=i.changedTouches.length;o<n;o++){let a=i.changedTouches.item(o);if(!this.activeTouches.hasOwnProperty(String(a.identifier))){console.warn("move of an UNKNOWN touch",a);continue}let h=this.activeTouches[a.identifier],l=Date.now()-h.initialTimeStamp;if(l<Ye.HOLD_DELAY&&Math.abs(h.initialPageX-ht(h.rollingPageX))<30&&Math.abs(h.initialPageY-ht(h.rollingPageY))<30){let c=this.newGestureEvent(It.Tap,h.initialTarget);c.pageX=ht(h.rollingPageX),c.pageY=ht(h.rollingPageY),this.dispatchEvent(c)}else if(l>=Ye.HOLD_DELAY&&Math.abs(h.initialPageX-ht(h.rollingPageX))<30&&Math.abs(h.initialPageY-ht(h.rollingPageY))<30){let c=this.newGestureEvent(It.Contextmenu,h.initialTarget);c.pageX=ht(h.rollingPageX),c.pageY=ht(h.rollingPageY),this.dispatchEvent(c)}else if(r===1){let c=ht(h.rollingPageX),d=ht(h.rollingPageY),p=ht(h.rollingTimestamps)-h.rollingTimestamps[0],f=c-h.rollingPageX[0],m=d-h.rollingPageY[0],_=[...this.targets].filter(C=>h.initialTarget instanceof Node&&C.contains(h.initialTarget));this.inertia(t,_,s,Math.abs(f)/p,f>0?1:-1,c,Math.abs(m)/p,m>0?1:-1,d)}this.dispatchEvent(this.newGestureEvent(It.End,h.initialTarget)),delete this.activeTouches[a.identifier]}this.dispatched&&(i.preventDefault(),i.stopPropagation(),this.dispatched=!1)}newGestureEvent(t,i){let s=document.createEvent("CustomEvent");return s.initEvent(t,!1,!0),s.initialTarget=i,s.tapCount=0,s}dispatchEvent(t){if(t.type===It.Tap){let i=new Date().getTime(),s=0;i-this._lastSetTapCountTime>Ye.CLEAR_TAP_COUNT_TIME?s=1:s=2,this._lastSetTapCountTime=i,t.tapCount=s}else(t.type===It.Change||t.type===It.Contextmenu)&&(this._lastSetTapCountTime=0);if(t.initialTarget instanceof Node){for(let s of this.ignoreTargets)if(s.contains(t.initialTarget))return;let i=[];for(let s of this.targets)if(s.contains(t.initialTarget)){let r=0,o=t.initialTarget;for(;o&&o!==s;)r++,o=o.parentElement;i.push([r,s])}i.sort((s,r)=>s[0]-r[0]);for(let[s,r]of i)r.dispatchEvent(t),this.dispatched=!0}}inertia(t,i,s,r,o,n,a,h,l){this.handle=Po(t,()=>{let c=Date.now(),d=c-s,p=0,f=0,m=!0;r+=Ye.SCROLL_FRICTION*d,a+=Ye.SCROLL_FRICTION*d,r>0&&(m=!1,p=o*r*d),a>0&&(m=!1,f=h*a*d);let _=this.newGestureEvent(It.Change);_.translationX=p,_.translationY=f,i.forEach(C=>C.dispatchEvent(_)),m||this.inertia(t,i,c,r,o,n+p,a,h,l+f)})}onTouchMove(t){let i=Date.now();for(let s=0,r=t.changedTouches.length;s<r;s++){let o=t.changedTouches.item(s);if(!this.activeTouches.hasOwnProperty(String(o.identifier))){console.warn("end of an UNKNOWN touch",o);continue}let n=this.activeTouches[o.identifier],a=this.newGestureEvent(It.Change,n.initialTarget);a.translationX=o.pageX-ht(n.rollingPageX),a.translationY=o.pageY-ht(n.rollingPageY),a.pageX=o.pageX,a.pageY=o.pageY,this.dispatchEvent(a),n.rollingPageX.length>3&&(n.rollingPageX.shift(),n.rollingPageY.shift(),n.rollingTimestamps.shift()),n.rollingPageX.push(o.pageX),n.rollingPageY.push(o.pageY),n.rollingTimestamps.push(i)}this.dispatched&&(t.preventDefault(),t.stopPropagation(),this.dispatched=!1)}};gr.SCROLL_FRICTION=-.005,gr.HOLD_DELAY=700,gr.CLEAR_TAP_COUNT_TIME=400,we([cg],gr,"isTouchDevice",1);dg=gr,vl=class extends G{onclick(e,t){this._register(W(e,Re.CLICK,i=>t(new _r(Tt(e),i))))}onmousedown(e,t){this._register(W(e,Re.MOUSE_DOWN,i=>t(new _r(Tt(e),i))))}onmouseover(e,t){this._register(W(e,Re.MOUSE_OVER,i=>t(new _r(Tt(e),i))))}onmouseleave(e,t){this._register(W(e,Re.MOUSE_LEAVE,i=>t(new _r(Tt(e),i))))}onkeydown(e,t){this._register(W(e,Re.KEY_DOWN,i=>t(new Wa(i))))}onkeyup(e,t){this._register(W(e,Re.KEY_UP,i=>t(new Wa(i))))}oninput(e,t){this._register(W(e,Re.INPUT,t))}onblur(e,t){this._register(W(e,Re.BLUR,t))}onfocus(e,t){this._register(W(e,Re.FOCUS,t))}onchange(e,t){this._register(W(e,Re.CHANGE,t))}ignoreGesture(e){return dg.ignoreTarget(e)}},Rc=11,ug=class extends vl{constructor(e){super(),this._onActivate=e.onActivate,this.bgDomNode=document.createElement("div"),this.bgDomNode.className="arrow-background",this.bgDomNode.style.position="absolute",this.bgDomNode.style.width=e.bgWidth+"px",this.bgDomNode.style.height=e.bgHeight+"px",typeof e.top<"u"&&(this.bgDomNode.style.top="0px"),typeof e.left<"u"&&(this.bgDomNode.style.left="0px"),typeof e.bottom<"u"&&(this.bgDomNode.style.bottom="0px"),typeof e.right<"u"&&(this.bgDomNode.style.right="0px"),this.domNode=document.createElement("div"),this.domNode.className=e.className,this.domNode.style.position="absolute",this.domNode.style.width=Rc+"px",this.domNode.style.height=Rc+"px",typeof e.top<"u"&&(this.domNode.style.top=e.top+"px"),typeof e.left<"u"&&(this.domNode.style.left=e.left+"px"),typeof e.bottom<"u"&&(this.domNode.style.bottom=e.bottom+"px"),typeof e.right<"u"&&(this.domNode.style.right=e.right+"px"),this._pointerMoveMonitor=this._register(new Kd),this._register(Lc(this.bgDomNode,Re.POINTER_DOWN,t=>this._arrowPointerDown(t))),this._register(Lc(this.domNode,Re.POINTER_DOWN,t=>this._arrowPointerDown(t))),this._pointerdownRepeatTimer=this._register(new og),this._pointerdownScheduleRepeatTimer=this._register(new _l)}_arrowPointerDown(e){if(!e.target||!(e.target instanceof Element))return;let t=()=>{this._pointerdownRepeatTimer.cancelAndSet(()=>this._onActivate(),1e3/24,Tt(e))};this._onActivate(),this._pointerdownRepeatTimer.cancel(),this._pointerdownScheduleRepeatTimer.cancelAndSet(t,200),this._pointerMoveMonitor.startMonitoring(e.target,e.pointerId,e.buttons,i=>{},()=>{this._pointerdownRepeatTimer.cancel(),this._pointerdownScheduleRepeatTimer.cancel()}),e.preventDefault()}},pg=class Va{constructor(t,i,s,r,o,n,a){this._forceIntegerValues=t,this._scrollStateBrand=void 0,this._forceIntegerValues&&(i=i|0,s=s|0,r=r|0,o=o|0,n=n|0,a=a|0),this.rawScrollLeft=r,this.rawScrollTop=a,i<0&&(i=0),r+i>s&&(r=s-i),r<0&&(r=0),o<0&&(o=0),a+o>n&&(a=n-o),a<0&&(a=0),this.width=i,this.scrollWidth=s,this.scrollLeft=r,this.height=o,this.scrollHeight=n,this.scrollTop=a}equals(t){return this.rawScrollLeft===t.rawScrollLeft&&this.rawScrollTop===t.rawScrollTop&&this.width===t.width&&this.scrollWidth===t.scrollWidth&&this.scrollLeft===t.scrollLeft&&this.height===t.height&&this.scrollHeight===t.scrollHeight&&this.scrollTop===t.scrollTop}withScrollDimensions(t,i){return new Va(this._forceIntegerValues,typeof t.width<"u"?t.width:this.width,typeof t.scrollWidth<"u"?t.scrollWidth:this.scrollWidth,i?this.rawScrollLeft:this.scrollLeft,typeof t.height<"u"?t.height:this.height,typeof t.scrollHeight<"u"?t.scrollHeight:this.scrollHeight,i?this.rawScrollTop:this.scrollTop)}withScrollPosition(t){return new Va(this._forceIntegerValues,this.width,this.scrollWidth,typeof t.scrollLeft<"u"?t.scrollLeft:this.rawScrollLeft,this.height,this.scrollHeight,typeof t.scrollTop<"u"?t.scrollTop:this.rawScrollTop)}createScrollEvent(t,i){let s=this.width!==t.width,r=this.scrollWidth!==t.scrollWidth,o=this.scrollLeft!==t.scrollLeft,n=this.height!==t.height,a=this.scrollHeight!==t.scrollHeight,h=this.scrollTop!==t.scrollTop;return{inSmoothScrolling:i,oldWidth:t.width,oldScrollWidth:t.scrollWidth,oldScrollLeft:t.scrollLeft,width:this.width,scrollWidth:this.scrollWidth,scrollLeft:this.scrollLeft,oldHeight:t.height,oldScrollHeight:t.scrollHeight,oldScrollTop:t.scrollTop,height:this.height,scrollHeight:this.scrollHeight,scrollTop:this.scrollTop,widthChanged:s,scrollWidthChanged:r,scrollLeftChanged:o,heightChanged:n,scrollHeightChanged:a,scrollTopChanged:h}}},fg=class extends G{constructor(e){super(),this._scrollableBrand=void 0,this._onScroll=this._register(new M),this.onScroll=this._onScroll.event,this._smoothScrollDuration=e.smoothScrollDuration,this._scheduleAtNextAnimationFrame=e.scheduleAtNextAnimationFrame,this._state=new pg(e.forceIntegerValues,0,0,0,0,0,0),this._smoothScrolling=null}dispose(){this._smoothScrolling&&(this._smoothScrolling.dispose(),this._smoothScrolling=null),super.dispose()}setSmoothScrollDuration(e){this._smoothScrollDuration=e}validateScrollPosition(e){return this._state.withScrollPosition(e)}getScrollDimensions(){return this._state}setScrollDimensions(e,t){let i=this._state.withScrollDimensions(e,t);this._setState(i,!!this._smoothScrolling),this._smoothScrolling?.acceptScrollDimensions(this._state)}getFutureScrollPosition(){return this._smoothScrolling?this._smoothScrolling.to:this._state}getCurrentScrollPosition(){return this._state}setScrollPositionNow(e){let t=this._state.withScrollPosition(e);this._smoothScrolling&&(this._smoothScrolling.dispose(),this._smoothScrolling=null),this._setState(t,!1)}setScrollPositionSmooth(e,t){if(this._smoothScrollDuration===0)return this.setScrollPositionNow(e);if(this._smoothScrolling){e={scrollLeft:typeof e.scrollLeft>"u"?this._smoothScrolling.to.scrollLeft:e.scrollLeft,scrollTop:typeof e.scrollTop>"u"?this._smoothScrolling.to.scrollTop:e.scrollTop};let i=this._state.withScrollPosition(e);if(this._smoothScrolling.to.scrollLeft===i.scrollLeft&&this._smoothScrolling.to.scrollTop===i.scrollTop)return;let s;t?s=new Bc(this._smoothScrolling.from,i,this._smoothScrolling.startTime,this._smoothScrolling.duration):s=this._smoothScrolling.combine(this._state,i,this._smoothScrollDuration),this._smoothScrolling.dispose(),this._smoothScrolling=s}else{let i=this._state.withScrollPosition(e);this._smoothScrolling=Bc.start(this._state,i,this._smoothScrollDuration)}this._smoothScrolling.animationFrameDisposable=this._scheduleAtNextAnimationFrame(()=>{this._smoothScrolling&&(this._smoothScrolling.animationFrameDisposable=null,this._performSmoothScrolling())})}hasPendingScrollAnimation(){return!!this._smoothScrolling}_performSmoothScrolling(){if(!this._smoothScrolling)return;let e=this._smoothScrolling.tick(),t=this._state.withScrollPosition(e);if(this._setState(t,!0),!!this._smoothScrolling){if(e.isDone){this._smoothScrolling.dispose(),this._smoothScrolling=null;return}this._smoothScrolling.animationFrameDisposable=this._scheduleAtNextAnimationFrame(()=>{this._smoothScrolling&&(this._smoothScrolling.animationFrameDisposable=null,this._performSmoothScrolling())})}}_setState(e,t){let i=this._state;i.equals(e)||(this._state=e,this._onScroll.fire(this._state.createScrollEvent(i,t)))}},Mc=class{constructor(e,t,i){this.scrollLeft=e,this.scrollTop=t,this.isDone=i}};Bc=class Ua{constructor(t,i,s,r){this.from=t,this.to=i,this.duration=r,this.startTime=s,this.animationFrameDisposable=null,this._initAnimations()}_initAnimations(){this.scrollLeft=this._initAnimation(this.from.scrollLeft,this.to.scrollLeft,this.to.width),this.scrollTop=this._initAnimation(this.from.scrollTop,this.to.scrollTop,this.to.height)}_initAnimation(t,i,s){if(Math.abs(t-i)>2.5*s){let r,o;return t<i?(r=t+.75*s,o=i-.75*s):(r=t-.75*s,o=i+.75*s),mg(va(t,r),va(o,i),.33)}return va(t,i)}dispose(){this.animationFrameDisposable!==null&&(this.animationFrameDisposable.dispose(),this.animationFrameDisposable=null)}acceptScrollDimensions(t){this.to=t.withScrollPosition(this.to),this._initAnimations()}tick(){return this._tick(Date.now())}_tick(t){let i=(t-this.startTime)/this.duration;if(i<1){let s=this.scrollLeft(i),r=this.scrollTop(i);return new Mc(s,r,!1)}return new Mc(this.to.scrollLeft,this.to.scrollTop,!0)}combine(t,i,s){return Ua.start(t,i,s)}static start(t,i,s){s=s+10;let r=Date.now()-10;return new Ua(t,i,r,s)}};vg=class extends G{constructor(e,t,i){super(),this._visibility=e,this._visibleClassName=t,this._invisibleClassName=i,this._domNode=null,this._isVisible=!1,this._isNeeded=!1,this._rawShouldBeVisible=!1,this._shouldBeVisible=!1,this._revealTimer=this._register(new _l)}setVisibility(e){this._visibility!==e&&(this._visibility=e,this._updateShouldBeVisible())}setShouldBeVisible(e){this._rawShouldBeVisible=e,this._updateShouldBeVisible()}_applyVisibilitySetting(){return this._visibility===2?!1:this._visibility===3?!0:this._rawShouldBeVisible}_updateShouldBeVisible(){let e=this._applyVisibilitySetting();this._shouldBeVisible!==e&&(this._shouldBeVisible=e,this.ensureVisibility())}setIsNeeded(e){this._isNeeded!==e&&(this._isNeeded=e,this.ensureVisibility())}setDomNode(e){this._domNode=e,this._domNode.setClassName(this._invisibleClassName),this.setShouldBeVisible(!1)}ensureVisibility(){if(!this._isNeeded){this._hide(!1);return}this._shouldBeVisible?this._reveal():this._hide(!0)}_reveal(){this._isVisible||(this._isVisible=!0,this._revealTimer.setIfNotSet(()=>{this._domNode?.setClassName(this._visibleClassName)},0))}_hide(e){this._revealTimer.cancel(),this._isVisible&&(this._isVisible=!1,this._domNode?.setClassName(this._invisibleClassName+(e?" fade":"")))}},bg=140,jd=class extends vl{constructor(e){super(),this._lazyRender=e.lazyRender,this._host=e.host,this._scrollable=e.scrollable,this._scrollByPage=e.scrollByPage,this._scrollbarState=e.scrollbarState,this._visibilityController=this._register(new vg(e.visibility,"visible scrollbar "+e.extraScrollbarClassName,"invisible scrollbar "+e.extraScrollbarClassName)),this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()),this._pointerMoveMonitor=this._register(new Kd),this._shouldRender=!0,this.domNode=Cr(document.createElement("div")),this.domNode.setAttribute("role","presentation"),this.domNode.setAttribute("aria-hidden","true"),this._visibilityController.setDomNode(this.domNode),this.domNode.setPosition("absolute"),this._register(W(this.domNode.domNode,Re.POINTER_DOWN,t=>this._domNodePointerDown(t)))}_createArrow(e){let t=this._register(new ug(e));this.domNode.domNode.appendChild(t.bgDomNode),this.domNode.domNode.appendChild(t.domNode)}_createSlider(e,t,i,s){this.slider=Cr(document.createElement("div")),this.slider.setClassName("slider"),this.slider.setPosition("absolute"),this.slider.setTop(e),this.slider.setLeft(t),typeof i=="number"&&this.slider.setWidth(i),typeof s=="number"&&this.slider.setHeight(s),this.slider.setLayerHinting(!0),this.slider.setContain("strict"),this.domNode.domNode.appendChild(this.slider.domNode),this._register(W(this.slider.domNode,Re.POINTER_DOWN,r=>{r.button===0&&(r.preventDefault(),this._sliderPointerDown(r))})),this.onclick(this.slider.domNode,r=>{r.leftButton&&r.stopPropagation()})}_onElementSize(e){return this._scrollbarState.setVisibleSize(e)&&(this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()),this._shouldRender=!0,this._lazyRender||this.render()),this._shouldRender}_onElementScrollSize(e){return this._scrollbarState.setScrollSize(e)&&(this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()),this._shouldRender=!0,this._lazyRender||this.render()),this._shouldRender}_onElementScrollPosition(e){return this._scrollbarState.setScrollPosition(e)&&(this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()),this._shouldRender=!0,this._lazyRender||this.render()),this._shouldRender}beginReveal(){this._visibilityController.setShouldBeVisible(!0)}beginHide(){this._visibilityController.setShouldBeVisible(!1)}render(){this._shouldRender&&(this._shouldRender=!1,this._renderDomNode(this._scrollbarState.getRectangleLargeSize(),this._scrollbarState.getRectangleSmallSize()),this._updateSlider(this._scrollbarState.getSliderSize(),this._scrollbarState.getArrowSize()+this._scrollbarState.getSliderPosition()))}_domNodePointerDown(e){e.target===this.domNode.domNode&&this._onPointerDown(e)}delegatePointerDown(e){let t=this.domNode.domNode.getClientRects()[0].top,i=t+this._scrollbarState.getSliderPosition(),s=t+this._scrollbarState.getSliderPosition()+this._scrollbarState.getSliderSize(),r=this._sliderPointerPosition(e);i<=r&&r<=s?e.button===0&&(e.preventDefault(),this._sliderPointerDown(e)):this._onPointerDown(e)}_onPointerDown(e){let t,i;if(e.target===this.domNode.domNode&&typeof e.offsetX=="number"&&typeof e.offsetY=="number")t=e.offsetX,i=e.offsetY;else{let r=ng(this.domNode.domNode);t=e.pageX-r.left,i=e.pageY-r.top}let s=this._pointerDownRelativePosition(t,i);this._setDesiredScrollPositionNow(this._scrollByPage?this._scrollbarState.getDesiredScrollPositionFromOffsetPaged(s):this._scrollbarState.getDesiredScrollPositionFromOffset(s)),e.button===0&&(e.preventDefault(),this._sliderPointerDown(e))}_sliderPointerDown(e){if(!e.target||!(e.target instanceof Element))return;let t=this._sliderPointerPosition(e),i=this._sliderOrthogonalPointerPosition(e),s=this._scrollbarState.clone();this.slider.toggleClassName("active",!0),this._pointerMoveMonitor.startMonitoring(e.target,e.pointerId,e.buttons,r=>{let o=this._sliderOrthogonalPointerPosition(r),n=Math.abs(o-i);if(Nd&&n>bg){this._setDesiredScrollPositionNow(s.getScrollPosition());return}let a=this._sliderPointerPosition(r)-t;this._setDesiredScrollPositionNow(s.getDesiredScrollPositionFromDelta(a))},()=>{this.slider.toggleClassName("active",!1),this._host.onDragEnd()}),this._host.onDragStart()}_setDesiredScrollPositionNow(e){let t={};this.writeScrollPosition(t,e),this._scrollable.setScrollPositionNow(t)}updateScrollbarSize(e){this._updateScrollbarSize(e),this._scrollbarState.setScrollbarSize(e),this._shouldRender=!0,this._lazyRender||this.render()}isNeeded(){return this._scrollbarState.isNeeded()}},Yd=class qa{constructor(t,i,s,r,o,n){this._scrollbarSize=Math.round(i),this._oppositeScrollbarSize=Math.round(s),this._arrowSize=Math.round(t),this._visibleSize=r,this._scrollSize=o,this._scrollPosition=n,this._computedAvailableSize=0,this._computedIsNeeded=!1,this._computedSliderSize=0,this._computedSliderRatio=0,this._computedSliderPosition=0,this._refreshComputedValues()}clone(){return new qa(this._arrowSize,this._scrollbarSize,this._oppositeScrollbarSize,this._visibleSize,this._scrollSize,this._scrollPosition)}setVisibleSize(t){let i=Math.round(t);return this._visibleSize!==i?(this._visibleSize=i,this._refreshComputedValues(),!0):!1}setScrollSize(t){let i=Math.round(t);return this._scrollSize!==i?(this._scrollSize=i,this._refreshComputedValues(),!0):!1}setScrollPosition(t){let i=Math.round(t);return this._scrollPosition!==i?(this._scrollPosition=i,this._refreshComputedValues(),!0):!1}setScrollbarSize(t){this._scrollbarSize=Math.round(t)}setOppositeScrollbarSize(t){this._oppositeScrollbarSize=Math.round(t)}static _computeValues(t,i,s,r,o){let n=Math.max(0,s-t),a=Math.max(0,n-2*i),h=r>0&&r>s;if(!h)return{computedAvailableSize:Math.round(n),computedIsNeeded:h,computedSliderSize:Math.round(a),computedSliderRatio:0,computedSliderPosition:0};let l=Math.round(Math.max(20,Math.floor(s*a/r))),c=(a-l)/(r-s),d=o*c;return{computedAvailableSize:Math.round(n),computedIsNeeded:h,computedSliderSize:Math.round(l),computedSliderRatio:c,computedSliderPosition:Math.round(d)}}_refreshComputedValues(){let t=qa._computeValues(this._oppositeScrollbarSize,this._arrowSize,this._visibleSize,this._scrollSize,this._scrollPosition);this._computedAvailableSize=t.computedAvailableSize,this._computedIsNeeded=t.computedIsNeeded,this._computedSliderSize=t.computedSliderSize,this._computedSliderRatio=t.computedSliderRatio,this._computedSliderPosition=t.computedSliderPosition}getArrowSize(){return this._arrowSize}getScrollPosition(){return this._scrollPosition}getRectangleLargeSize(){return this._computedAvailableSize}getRectangleSmallSize(){return this._scrollbarSize}isNeeded(){return this._computedIsNeeded}getSliderSize(){return this._computedSliderSize}getSliderPosition(){return this._computedSliderPosition}getDesiredScrollPositionFromOffset(t){if(!this._computedIsNeeded)return 0;let i=t-this._arrowSize-this._computedSliderSize/2;return Math.round(i/this._computedSliderRatio)}getDesiredScrollPositionFromOffsetPaged(t){if(!this._computedIsNeeded)return 0;let i=t-this._arrowSize,s=this._scrollPosition;return i<this._computedSliderPosition?s-=this._visibleSize:s+=this._visibleSize,s}getDesiredScrollPositionFromDelta(t){if(!this._computedIsNeeded)return 0;let i=this._computedSliderPosition+t;return Math.round(i/this._computedSliderRatio)}},yg=class extends jd{constructor(e,t,i){let s=e.getScrollDimensions(),r=e.getCurrentScrollPosition();if(super({lazyRender:t.lazyRender,host:i,scrollbarState:new Yd(t.horizontalHasArrows?t.arrowSize:0,t.horizontal===2?0:t.horizontalScrollbarSize,t.vertical===2?0:t.verticalScrollbarSize,s.width,s.scrollWidth,r.scrollLeft),visibility:t.horizontal,extraScrollbarClassName:"horizontal",scrollable:e,scrollByPage:t.scrollByPage}),t.horizontalHasArrows)throw new Error("horizontalHasArrows is not supported in xterm.js");this._createSlider(Math.floor((t.horizontalScrollbarSize-t.horizontalSliderSize)/2),0,void 0,t.horizontalSliderSize)}_updateSlider(e,t){this.slider.setWidth(e),this.slider.setLeft(t)}_renderDomNode(e,t){this.domNode.setWidth(e),this.domNode.setHeight(t),this.domNode.setLeft(0),this.domNode.setBottom(0)}onDidScroll(e){return this._shouldRender=this._onElementScrollSize(e.scrollWidth)||this._shouldRender,this._shouldRender=this._onElementScrollPosition(e.scrollLeft)||this._shouldRender,this._shouldRender=this._onElementSize(e.width)||this._shouldRender,this._shouldRender}_pointerDownRelativePosition(e,t){return e}_sliderPointerPosition(e){return e.pageX}_sliderOrthogonalPointerPosition(e){return e.pageY}_updateScrollbarSize(e){this.slider.setHeight(e)}writeScrollPosition(e,t){e.scrollLeft=t}updateOptions(e){this.updateScrollbarSize(e.horizontal===2?0:e.horizontalScrollbarSize),this._scrollbarState.setOppositeScrollbarSize(e.vertical===2?0:e.verticalScrollbarSize),this._visibilityController.setVisibility(e.horizontal),this._scrollByPage=e.scrollByPage}},wg=class extends jd{constructor(e,t,i){let s=e.getScrollDimensions(),r=e.getCurrentScrollPosition();if(super({lazyRender:t.lazyRender,host:i,scrollbarState:new Yd(t.verticalHasArrows?t.arrowSize:0,t.vertical===2?0:t.verticalScrollbarSize,0,s.height,s.scrollHeight,r.scrollTop),visibility:t.vertical,extraScrollbarClassName:"vertical",scrollable:e,scrollByPage:t.scrollByPage}),t.verticalHasArrows)throw new Error("horizontalHasArrows is not supported in xterm.js");this._createSlider(0,Math.floor((t.verticalScrollbarSize-t.verticalSliderSize)/2),t.verticalSliderSize,void 0)}_updateSlider(e,t){this.slider.setHeight(e),this.slider.setTop(t)}_renderDomNode(e,t){this.domNode.setWidth(t),this.domNode.setHeight(e),this.domNode.setRight(0),this.domNode.setTop(0)}onDidScroll(e){return this._shouldRender=this._onElementScrollSize(e.scrollHeight)||this._shouldRender,this._shouldRender=this._onElementScrollPosition(e.scrollTop)||this._shouldRender,this._shouldRender=this._onElementSize(e.height)||this._shouldRender,this._shouldRender}_pointerDownRelativePosition(e,t){return t}_sliderPointerPosition(e){return e.pageY}_sliderOrthogonalPointerPosition(e){return e.pageX}_updateScrollbarSize(e){this.slider.setWidth(e)}writeScrollPosition(e,t){e.scrollTop=t}updateOptions(e){this.updateScrollbarSize(e.vertical===2?0:e.verticalScrollbarSize),this._scrollbarState.setOppositeScrollbarSize(0),this._visibilityController.setVisibility(e.vertical),this._scrollByPage=e.scrollByPage}},Sg=500,Pc=50,Oc=!0,Cg=class{constructor(e,t,i){this.timestamp=e,this.deltaX=t,this.deltaY=i,this.score=0}},Ka=class{constructor(){this._capacity=5,this._memory=[],this._front=-1,this._rear=-1}isPhysicalMouseWheel(){if(this._front===-1&&this._rear===-1)return!1;let t=1,i=0,s=1,r=this._rear;do{let o=r===this._front?t:Math.pow(2,-s);if(t-=o,i+=this._memory[r].score*o,r===this._front)break;r=(this._capacity+r-1)%this._capacity,s++}while(!0);return i<=.5}acceptStandardWheelEvent(t){if(fl){let i=Tt(t.browserEvent),s=__(i);this.accept(Date.now(),t.deltaX*s,t.deltaY*s)}else this.accept(Date.now(),t.deltaX,t.deltaY)}accept(t,i,s){let r=null,o=new Cg(t,i,s);this._front===-1&&this._rear===-1?(this._memory[0]=o,this._front=0,this._rear=0):(r=this._memory[this._rear],this._rear=(this._rear+1)%this._capacity,this._rear===this._front&&(this._front=(this._front+1)%this._capacity),this._memory[this._rear]=o),o.score=this._computeScore(o,r)}_computeScore(t,i){if(Math.abs(t.deltaX)>0&&Math.abs(t.deltaY)>0)return 1;let s=.5;if((!this._isAlmostInt(t.deltaX)||!this._isAlmostInt(t.deltaY))&&(s+=.25),i){let r=Math.abs(t.deltaX),o=Math.abs(t.deltaY),n=Math.abs(i.deltaX),a=Math.abs(i.deltaY),h=Math.max(Math.min(r,n),1),l=Math.max(Math.min(o,a),1),c=Math.max(r,n),d=Math.max(o,a);c%h===0&&d%l===0&&(s-=.5)}return Math.min(Math.max(s,0),1)}_isAlmostInt(t){return Math.abs(Math.round(t)-t)<.01}};Ka.INSTANCE=new Ka;xg=Ka,kg=class extends vl{constructor(e,t,i){super(),this._onScroll=this._register(new M),this.onScroll=this._onScroll.event,this._onWillScroll=this._register(new M),this.onWillScroll=this._onWillScroll.event,this._options=Ag(t),this._scrollable=i,this._register(this._scrollable.onScroll(r=>{this._onWillScroll.fire(r),this._onDidScroll(r),this._onScroll.fire(r)}));let s={onMouseWheel:r=>this._onMouseWheel(r),onDragStart:()=>this._onDragStart(),onDragEnd:()=>this._onDragEnd()};this._verticalScrollbar=this._register(new wg(this._scrollable,this._options,s)),this._horizontalScrollbar=this._register(new yg(this._scrollable,this._options,s)),this._domNode=document.createElement("div"),this._domNode.className="xterm-scrollable-element "+this._options.className,this._domNode.setAttribute("role","presentation"),this._domNode.style.position="relative",this._domNode.appendChild(e),this._domNode.appendChild(this._horizontalScrollbar.domNode.domNode),this._domNode.appendChild(this._verticalScrollbar.domNode.domNode),this._options.useShadows?(this._leftShadowDomNode=Cr(document.createElement("div")),this._leftShadowDomNode.setClassName("shadow"),this._domNode.appendChild(this._leftShadowDomNode.domNode),this._topShadowDomNode=Cr(document.createElement("div")),this._topShadowDomNode.setClassName("shadow"),this._domNode.appendChild(this._topShadowDomNode.domNode),this._topLeftShadowDomNode=Cr(document.createElement("div")),this._topLeftShadowDomNode.setClassName("shadow"),this._domNode.appendChild(this._topLeftShadowDomNode.domNode)):(this._leftShadowDomNode=null,this._topShadowDomNode=null,this._topLeftShadowDomNode=null),this._listenOnDomNode=this._options.listenOnDomNode||this._domNode,this._mouseWheelToDispose=[],this._setListeningToMouseWheel(this._options.handleMouseWheel),this.onmouseover(this._listenOnDomNode,r=>this._onMouseOver(r)),this.onmouseleave(this._listenOnDomNode,r=>this._onMouseLeave(r)),this._hideTimeout=this._register(new _l),this._isDragging=!1,this._mouseIsOver=!1,this._shouldRender=!0,this._revealOnScroll=!0}get options(){return this._options}dispose(){this._mouseWheelToDispose=Gi(this._mouseWheelToDispose),super.dispose()}getDomNode(){return this._domNode}getOverviewRulerLayoutInfo(){return{parent:this._domNode,insertBefore:this._verticalScrollbar.domNode.domNode}}delegateVerticalScrollbarPointerDown(e){this._verticalScrollbar.delegatePointerDown(e)}getScrollDimensions(){return this._scrollable.getScrollDimensions()}setScrollDimensions(e){this._scrollable.setScrollDimensions(e,!1)}updateClassName(e){this._options.className=e,zt&&(this._options.className+=" mac"),this._domNode.className="xterm-scrollable-element "+this._options.className}updateOptions(e){typeof e.handleMouseWheel<"u"&&(this._options.handleMouseWheel=e.handleMouseWheel,this._setListeningToMouseWheel(this._options.handleMouseWheel)),typeof e.mouseWheelScrollSensitivity<"u"&&(this._options.mouseWheelScrollSensitivity=e.mouseWheelScrollSensitivity),typeof e.fastScrollSensitivity<"u"&&(this._options.fastScrollSensitivity=e.fastScrollSensitivity),typeof e.scrollPredominantAxis<"u"&&(this._options.scrollPredominantAxis=e.scrollPredominantAxis),typeof e.horizontal<"u"&&(this._options.horizontal=e.horizontal),typeof e.vertical<"u"&&(this._options.vertical=e.vertical),typeof e.horizontalScrollbarSize<"u"&&(this._options.horizontalScrollbarSize=e.horizontalScrollbarSize),typeof e.verticalScrollbarSize<"u"&&(this._options.verticalScrollbarSize=e.verticalScrollbarSize),typeof e.scrollByPage<"u"&&(this._options.scrollByPage=e.scrollByPage),this._horizontalScrollbar.updateOptions(this._options),this._verticalScrollbar.updateOptions(this._options),this._options.lazyRender||this._render()}setRevealOnScroll(e){this._revealOnScroll=e}delegateScrollFromMouseWheelEvent(e){this._onMouseWheel(new kc(e))}_setListeningToMouseWheel(e){if(this._mouseWheelToDispose.length>0!==e&&(this._mouseWheelToDispose=Gi(this._mouseWheelToDispose),e)){let t=i=>{this._onMouseWheel(new kc(i))};this._mouseWheelToDispose.push(W(this._listenOnDomNode,Re.MOUSE_WHEEL,t,{passive:!1}))}}_onMouseWheel(e){if(e.browserEvent?.defaultPrevented)return;let t=xg.INSTANCE;Oc&&t.acceptStandardWheelEvent(e);let i=!1;if(e.deltaY||e.deltaX){let r=e.deltaY*this._options.mouseWheelScrollSensitivity,o=e.deltaX*this._options.mouseWheelScrollSensitivity;this._options.scrollPredominantAxis&&(this._options.scrollYToX&&o+r===0?o=r=0:Math.abs(r)>=Math.abs(o)?o=0:r=0),this._options.flipAxes&&([r,o]=[o,r]);let n=!zt&&e.browserEvent&&e.browserEvent.shiftKey;(this._options.scrollYToX||n)&&!o&&(o=r,r=0),e.browserEvent&&e.browserEvent.altKey&&(o=o*this._options.fastScrollSensitivity,r=r*this._options.fastScrollSensitivity);let a=this._scrollable.getFutureScrollPosition(),h={};if(r){let l=Pc*r,c=a.scrollTop-(l<0?Math.floor(l):Math.ceil(l));this._verticalScrollbar.writeScrollPosition(h,c)}if(o){let l=Pc*o,c=a.scrollLeft-(l<0?Math.floor(l):Math.ceil(l));this._horizontalScrollbar.writeScrollPosition(h,c)}h=this._scrollable.validateScrollPosition(h),(a.scrollLeft!==h.scrollLeft||a.scrollTop!==h.scrollTop)&&(Oc&&this._options.mouseWheelSmoothScroll&&t.isPhysicalMouseWheel()?this._scrollable.setScrollPositionSmooth(h):this._scrollable.setScrollPositionNow(h),i=!0)}let s=i;!s&&this._options.alwaysConsumeMouseWheel&&(s=!0),!s&&this._options.consumeMouseWheelIfScrollbarIsNeeded&&(this._verticalScrollbar.isNeeded()||this._horizontalScrollbar.isNeeded())&&(s=!0),s&&(e.preventDefault(),e.stopPropagation())}_onDidScroll(e){this._shouldRender=this._horizontalScrollbar.onDidScroll(e)||this._shouldRender,this._shouldRender=this._verticalScrollbar.onDidScroll(e)||this._shouldRender,this._options.useShadows&&(this._shouldRender=!0),this._revealOnScroll&&this._reveal(),this._options.lazyRender||this._render()}renderNow(){if(!this._options.lazyRender)throw new Error("Please use `lazyRender` together with `renderNow`!");this._render()}_render(){if(this._shouldRender&&(this._shouldRender=!1,this._horizontalScrollbar.render(),this._verticalScrollbar.render(),this._options.useShadows)){let e=this._scrollable.getCurrentScrollPosition(),t=e.scrollTop>0,i=e.scrollLeft>0,s=i?" left":"",r=t?" top":"",o=i||t?" top-left-corner":"";this._leftShadowDomNode.setClassName(`shadow${s}`),this._topShadowDomNode.setClassName(`shadow${r}`),this._topLeftShadowDomNode.setClassName(`shadow${o}${r}${s}`)}}_onDragStart(){this._isDragging=!0,this._reveal()}_onDragEnd(){this._isDragging=!1,this._hide()}_onMouseLeave(e){this._mouseIsOver=!1,this._hide()}_onMouseOver(e){this._mouseIsOver=!0,this._reveal()}_reveal(){this._verticalScrollbar.beginReveal(),this._horizontalScrollbar.beginReveal(),this._scheduleHide()}_hide(){!this._mouseIsOver&&!this._isDragging&&(this._verticalScrollbar.beginHide(),this._horizontalScrollbar.beginHide())}_scheduleHide(){!this._mouseIsOver&&!this._isDragging&&this._hideTimeout.cancelAndSet(()=>this._hide(),Sg)}},Eg=class extends kg{constructor(e,t,i){super(e,t,i)}setScrollPosition(e){e.reuseAnimation?this._scrollable.setScrollPositionSmooth(e,e.reuseAnimation):this._scrollable.setScrollPositionNow(e)}getScrollPosition(){return this._scrollable.getCurrentScrollPosition()}};ja=class extends G{constructor(e,t,i,s,r,o,n,a){super(),this._bufferService=i,this._optionsService=n,this._renderService=a,this._onRequestScrollLines=this._register(new M),this.onRequestScrollLines=this._onRequestScrollLines.event,this._isSyncing=!1,this._isHandlingScroll=!1,this._suppressOnScrollHandler=!1;let h=this._register(new fg({forceIntegerValues:!1,smoothScrollDuration:this._optionsService.rawOptions.smoothScrollDuration,scheduleAtNextAnimationFrame:l=>Po(s.window,l)}));this._register(this._optionsService.onSpecificOptionChange("smoothScrollDuration",()=>{h.setSmoothScrollDuration(this._optionsService.rawOptions.smoothScrollDuration)})),this._scrollableElement=this._register(new Eg(t,{vertical:1,horizontal:2,useShadows:!1,mouseWheelSmoothScroll:!0,...this._getChangeOptions()},h)),this._register(this._optionsService.onMultipleOptionChange(["scrollSensitivity","fastScrollSensitivity","overviewRuler"],()=>this._scrollableElement.updateOptions(this._getChangeOptions()))),this._register(r.onProtocolChange(l=>{this._scrollableElement.updateOptions({handleMouseWheel:!(l&16)})})),this._scrollableElement.setScrollDimensions({height:0,scrollHeight:0}),this._register(Ve.runAndSubscribe(o.onChangeColors,()=>{this._scrollableElement.getDomNode().style.backgroundColor=o.colors.background.css})),e.appendChild(this._scrollableElement.getDomNode()),this._register(me(()=>this._scrollableElement.getDomNode().remove())),this._styleElement=s.mainDocument.createElement("style"),t.appendChild(this._styleElement),this._register(me(()=>this._styleElement.remove())),this._register(Ve.runAndSubscribe(o.onChangeColors,()=>{this._styleElement.textContent=[".xterm .xterm-scrollable-element > .scrollbar > .slider {",`  background: ${o.colors.scrollbarSliderBackground.css};`,"}",".xterm .xterm-scrollable-element > .scrollbar > .slider:hover {",`  background: ${o.colors.scrollbarSliderHoverBackground.css};`,"}",".xterm .xterm-scrollable-element > .scrollbar > .slider.active {",`  background: ${o.colors.scrollbarSliderActiveBackground.css};`,"}"].join(`
`)})),this._register(this._bufferService.onResize(()=>this.queueSync())),this._register(this._bufferService.buffers.onBufferActivate(()=>{this._latestYDisp=void 0,this.queueSync()})),this._register(this._bufferService.onScroll(()=>this._sync())),this._register(this._scrollableElement.onScroll(l=>this._handleScroll(l)))}scrollLines(e){let t=this._scrollableElement.getScrollPosition();this._scrollableElement.setScrollPosition({reuseAnimation:!0,scrollTop:t.scrollTop+e*this._renderService.dimensions.css.cell.height})}scrollToLine(e,t){t&&(this._latestYDisp=e),this._scrollableElement.setScrollPosition({reuseAnimation:!t,scrollTop:e*this._renderService.dimensions.css.cell.height})}_getChangeOptions(){return{mouseWheelScrollSensitivity:this._optionsService.rawOptions.scrollSensitivity,fastScrollSensitivity:this._optionsService.rawOptions.fastScrollSensitivity,verticalScrollbarSize:this._optionsService.rawOptions.overviewRuler?.width||14}}queueSync(e){e!==void 0&&(this._latestYDisp=e),this._queuedAnimationFrame===void 0&&(this._queuedAnimationFrame=this._renderService.addRefreshCallback(()=>{this._queuedAnimationFrame=void 0,this._sync(this._latestYDisp)}))}_sync(e=this._bufferService.buffer.ydisp){!this._renderService||this._isSyncing||(this._isSyncing=!0,this._suppressOnScrollHandler=!0,this._scrollableElement.setScrollDimensions({height:this._renderService.dimensions.css.canvas.height,scrollHeight:this._renderService.dimensions.css.cell.height*this._bufferService.buffer.lines.length}),this._suppressOnScrollHandler=!1,e!==this._latestYDisp&&this._scrollableElement.setScrollPosition({scrollTop:e*this._renderService.dimensions.css.cell.height}),this._isSyncing=!1)}_handleScroll(e){if(!this._renderService||this._isHandlingScroll||this._suppressOnScrollHandler)return;this._isHandlingScroll=!0;let t=Math.round(e.scrollTop/this._renderService.dimensions.css.cell.height),i=t-this._bufferService.buffer.ydisp;i!==0&&(this._latestYDisp=t,this._onRequestScrollLines.fire(i)),this._isHandlingScroll=!1}};ja=we([z(2,Ze),z(3,ei),z(4,bd),z(5,Cs),z(6,Qe),z(7,ti)],ja);Ya=class extends G{constructor(e,t,i,s,r){super(),this._screenElement=e,this._bufferService=t,this._coreBrowserService=i,this._decorationService=s,this._renderService=r,this._decorationElements=new Map,this._altBufferIsActive=!1,this._dimensionsChanged=!1,this._container=document.createElement("div"),this._container.classList.add("xterm-decoration-container"),this._screenElement.appendChild(this._container),this._register(this._renderService.onRenderedViewportChange(()=>this._doRefreshDecorations())),this._register(this._renderService.onDimensionsChange(()=>{this._dimensionsChanged=!0,this._queueRefresh()})),this._register(this._coreBrowserService.onDprChange(()=>this._queueRefresh())),this._register(this._bufferService.buffers.onBufferActivate(()=>{this._altBufferIsActive=this._bufferService.buffer===this._bufferService.buffers.alt})),this._register(this._decorationService.onDecorationRegistered(()=>this._queueRefresh())),this._register(this._decorationService.onDecorationRemoved(o=>this._removeDecoration(o))),this._register(me(()=>{this._container.remove(),this._decorationElements.clear()}))}_queueRefresh(){this._animationFrame===void 0&&(this._animationFrame=this._renderService.addRefreshCallback(()=>{this._doRefreshDecorations(),this._animationFrame=void 0}))}_doRefreshDecorations(){for(let e of this._decorationService.decorations)this._renderDecoration(e);this._dimensionsChanged=!1}_renderDecoration(e){this._refreshStyle(e),this._dimensionsChanged&&this._refreshXPosition(e)}_createElement(e){let t=this._coreBrowserService.mainDocument.createElement("div");t.classList.add("xterm-decoration"),t.classList.toggle("xterm-decoration-top-layer",e?.options?.layer==="top"),t.style.width=`${Math.round((e.options.width||1)*this._renderService.dimensions.css.cell.width)}px`,t.style.height=`${(e.options.height||1)*this._renderService.dimensions.css.cell.height}px`,t.style.top=`${(e.marker.line-this._bufferService.buffers.active.ydisp)*this._renderService.dimensions.css.cell.height}px`,t.style.lineHeight=`${this._renderService.dimensions.css.cell.height}px`;let i=e.options.x??0;return i&&i>this._bufferService.cols&&(t.style.display="none"),this._refreshXPosition(e,t),t}_refreshStyle(e){let t=e.marker.line-this._bufferService.buffers.active.ydisp;if(t<0||t>=this._bufferService.rows)e.element&&(e.element.style.display="none",e.onRenderEmitter.fire(e.element));else{let i=this._decorationElements.get(e);i||(i=this._createElement(e),e.element=i,this._decorationElements.set(e,i),this._container.appendChild(i),e.onDispose(()=>{this._decorationElements.delete(e),i.remove()})),i.style.display=this._altBufferIsActive?"none":"block",this._altBufferIsActive||(i.style.width=`${Math.round((e.options.width||1)*this._renderService.dimensions.css.cell.width)}px`,i.style.height=`${(e.options.height||1)*this._renderService.dimensions.css.cell.height}px`,i.style.top=`${t*this._renderService.dimensions.css.cell.height}px`,i.style.lineHeight=`${this._renderService.dimensions.css.cell.height}px`),e.onRenderEmitter.fire(i)}}_refreshXPosition(e,t=e.element){if(!t)return;let i=e.options.x??0;(e.options.anchor||"left")==="right"?t.style.right=i?`${i*this._renderService.dimensions.css.cell.width}px`:"":t.style.left=i?`${i*this._renderService.dimensions.css.cell.width}px`:""}_removeDecoration(e){this._decorationElements.get(e)?.remove(),this._decorationElements.delete(e),e.dispose()}};Ya=we([z(1,Ze),z(2,ei),z(3,Tr),z(4,ti)],Ya);$g=class{constructor(){this._zones=[],this._zonePool=[],this._zonePoolIndex=0,this._linePadding={full:0,left:0,center:0,right:0}}get zones(){return this._zonePool.length=Math.min(this._zonePool.length,this._zones.length),this._zones}clear(){this._zones.length=0,this._zonePoolIndex=0}addDecoration(e){if(e.options.overviewRulerOptions){for(let t of this._zones)if(t.color===e.options.overviewRulerOptions.color&&t.position===e.options.overviewRulerOptions.position){if(this._lineIntersectsZone(t,e.marker.line))return;if(this._lineAdjacentToZone(t,e.marker.line,e.options.overviewRulerOptions.position)){this._addLineToZone(t,e.marker.line);return}}if(this._zonePoolIndex<this._zonePool.length){this._zonePool[this._zonePoolIndex].color=e.options.overviewRulerOptions.color,this._zonePool[this._zonePoolIndex].position=e.options.overviewRulerOptions.position,this._zonePool[this._zonePoolIndex].startBufferLine=e.marker.line,this._zonePool[this._zonePoolIndex].endBufferLine=e.marker.line,this._zones.push(this._zonePool[this._zonePoolIndex++]);return}this._zones.push({color:e.options.overviewRulerOptions.color,position:e.options.overviewRulerOptions.position,startBufferLine:e.marker.line,endBufferLine:e.marker.line}),this._zonePool.push(this._zones[this._zones.length-1]),this._zonePoolIndex++}}setPadding(e){this._linePadding=e}_lineIntersectsZone(e,t){return t>=e.startBufferLine&&t<=e.endBufferLine}_lineAdjacentToZone(e,t,i){return t>=e.startBufferLine-this._linePadding[i||"full"]&&t<=e.endBufferLine+this._linePadding[i||"full"]}_addLineToZone(e,t){e.startBufferLine=Math.min(e.startBufferLine,t),e.endBufferLine=Math.max(e.endBufferLine,t)}},Pt={full:0,left:0,center:0,right:0},_i={full:0,left:0,center:0,right:0},cr={full:0,left:0,center:0,right:0},Oo=class extends G{constructor(e,t,i,s,r,o,n,a){super(),this._viewportElement=e,this._screenElement=t,this._bufferService=i,this._decorationService=s,this._renderService=r,this._optionsService=o,this._themeService=n,this._coreBrowserService=a,this._colorZoneStore=new $g,this._shouldUpdateDimensions=!0,this._shouldUpdateAnchor=!0,this._lastKnownBufferLength=0,this._canvas=this._coreBrowserService.mainDocument.createElement("canvas"),this._canvas.classList.add("xterm-decoration-overview-ruler"),this._refreshCanvasDimensions(),this._viewportElement.parentElement?.insertBefore(this._canvas,this._viewportElement),this._register(me(()=>this._canvas?.remove()));let h=this._canvas.getContext("2d");if(h)this._ctx=h;else throw new Error("Ctx cannot be null");this._register(this._decorationService.onDecorationRegistered(()=>this._queueRefresh(void 0,!0))),this._register(this._decorationService.onDecorationRemoved(()=>this._queueRefresh(void 0,!0))),this._register(this._renderService.onRenderedViewportChange(()=>this._queueRefresh())),this._register(this._bufferService.buffers.onBufferActivate(()=>{this._canvas.style.display=this._bufferService.buffer===this._bufferService.buffers.alt?"none":"block"})),this._register(this._bufferService.onScroll(()=>{this._lastKnownBufferLength!==this._bufferService.buffers.normal.lines.length&&(this._refreshDrawHeightConstants(),this._refreshColorZonePadding())})),this._register(this._renderService.onRender(()=>{(!this._containerHeight||this._containerHeight!==this._screenElement.clientHeight)&&(this._queueRefresh(!0),this._containerHeight=this._screenElement.clientHeight)})),this._register(this._coreBrowserService.onDprChange(()=>this._queueRefresh(!0))),this._register(this._optionsService.onSpecificOptionChange("overviewRuler",()=>this._queueRefresh(!0))),this._register(this._themeService.onChangeColors(()=>this._queueRefresh())),this._queueRefresh(!0)}get _width(){return this._optionsService.options.overviewRuler?.width||0}_refreshDrawConstants(){let e=Math.floor((this._canvas.width-1)/3),t=Math.ceil((this._canvas.width-1)/3);_i.full=this._canvas.width,_i.left=e,_i.center=t,_i.right=e,this._refreshDrawHeightConstants(),cr.full=1,cr.left=1,cr.center=1+_i.left,cr.right=1+_i.left+_i.center}_refreshDrawHeightConstants(){Pt.full=Math.round(2*this._coreBrowserService.dpr);let e=this._canvas.height/this._bufferService.buffer.lines.length,t=Math.round(Math.max(Math.min(e,12),6)*this._coreBrowserService.dpr);Pt.left=t,Pt.center=t,Pt.right=t}_refreshColorZonePadding(){this._colorZoneStore.setPadding({full:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*Pt.full),left:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*Pt.left),center:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*Pt.center),right:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*Pt.right)}),this._lastKnownBufferLength=this._bufferService.buffers.normal.lines.length}_refreshCanvasDimensions(){this._canvas.style.width=`${this._width}px`,this._canvas.width=Math.round(this._width*this._coreBrowserService.dpr),this._canvas.style.height=`${this._screenElement.clientHeight}px`,this._canvas.height=Math.round(this._screenElement.clientHeight*this._coreBrowserService.dpr),this._refreshDrawConstants(),this._refreshColorZonePadding()}_refreshDecorations(){this._shouldUpdateDimensions&&this._refreshCanvasDimensions(),this._ctx.clearRect(0,0,this._canvas.width,this._canvas.height),this._colorZoneStore.clear();for(let t of this._decorationService.decorations)this._colorZoneStore.addDecoration(t);this._ctx.lineWidth=1,this._renderRulerOutline();let e=this._colorZoneStore.zones;for(let t of e)t.position!=="full"&&this._renderColorZone(t);for(let t of e)t.position==="full"&&this._renderColorZone(t);this._shouldUpdateDimensions=!1,this._shouldUpdateAnchor=!1}_renderRulerOutline(){this._ctx.fillStyle=this._themeService.colors.overviewRulerBorder.css,this._ctx.fillRect(0,0,1,this._canvas.height),this._optionsService.rawOptions.overviewRuler.showTopBorder&&this._ctx.fillRect(1,0,this._canvas.width-1,1),this._optionsService.rawOptions.overviewRuler.showBottomBorder&&this._ctx.fillRect(1,this._canvas.height-1,this._canvas.width-1,this._canvas.height)}_renderColorZone(e){this._ctx.fillStyle=e.color,this._ctx.fillRect(cr[e.position||"full"],Math.round((this._canvas.height-1)*(e.startBufferLine/this._bufferService.buffers.active.lines.length)-Pt[e.position||"full"]/2),_i[e.position||"full"],Math.round((this._canvas.height-1)*((e.endBufferLine-e.startBufferLine)/this._bufferService.buffers.active.lines.length)+Pt[e.position||"full"]))}_queueRefresh(e,t){this._shouldUpdateDimensions=e||this._shouldUpdateDimensions,this._shouldUpdateAnchor=t||this._shouldUpdateAnchor,this._animationFrame===void 0&&(this._animationFrame=this._coreBrowserService.window.requestAnimationFrame(()=>{this._refreshDecorations(),this._animationFrame=void 0}))}};Oo=we([z(2,Ze),z(3,Tr),z(4,ti),z(5,Qe),z(6,Cs),z(7,ei)],Oo);(e=>(e.NUL="\0",e.SOH="",e.STX="",e.ETX="",e.EOT="",e.ENQ="",e.ACK="",e.BEL="\x07",e.BS="\b",e.HT="	",e.LF=`
`,e.VT="\v",e.FF="\f",e.CR="\r",e.SO="",e.SI="",e.DLE="",e.DC1="",e.DC2="",e.DC3="",e.DC4="",e.NAK="",e.SYN="",e.ETB="",e.CAN="",e.EM="",e.SUB="",e.ESC="\x1B",e.FS="",e.GS="",e.RS="",e.US="",e.SP=" ",e.DEL="\x7F"))($||($={}));(e=>(e.PAD="\x80",e.HOP="\x81",e.BPH="\x82",e.NBH="\x83",e.IND="\x84",e.NEL="\x85",e.SSA="\x86",e.ESA="\x87",e.HTS="\x88",e.HTJ="\x89",e.VTS="\x8A",e.PLD="\x8B",e.PLU="\x8C",e.RI="\x8D",e.SS2="\x8E",e.SS3="\x8F",e.DCS="\x90",e.PU1="\x91",e.PU2="\x92",e.STS="\x93",e.CCH="\x94",e.MW="\x95",e.SPA="\x96",e.EPA="\x97",e.SOS="\x98",e.SGCI="\x99",e.SCI="\x9A",e.CSI="\x9B",e.ST="\x9C",e.OSC="\x9D",e.PM="\x9E",e.APC="\x9F"))(To||(To={}));(e=>e.ST=`${$.ESC}\\`)(Gd||(Gd={}));Ga=class{constructor(e,t,i,s,r,o){this._textarea=e,this._compositionView=t,this._bufferService=i,this._optionsService=s,this._coreService=r,this._renderService=o,this._isComposing=!1,this._isSendingComposition=!1,this._compositionPosition={start:0,end:0},this._dataAlreadySent=""}get isComposing(){return this._isComposing}compositionstart(){this._isComposing=!0,this._compositionPosition.start=this._textarea.value.length,this._compositionView.textContent="",this._dataAlreadySent="",this._compositionView.classList.add("active")}compositionupdate(e){this._compositionView.textContent=e.data,this.updateCompositionElements(),setTimeout(()=>{this._compositionPosition.end=this._textarea.value.length},0)}compositionend(){this._finalizeComposition(!0)}keydown(e){if(this._isComposing||this._isSendingComposition){if(e.keyCode===20||e.keyCode===229||e.keyCode===16||e.keyCode===17||e.keyCode===18)return!1;this._finalizeComposition(!1)}return e.keyCode===229?(this._handleAnyTextareaChanges(),!1):!0}_finalizeComposition(e){if(this._compositionView.classList.remove("active"),this._isComposing=!1,e){let t={start:this._compositionPosition.start,end:this._compositionPosition.end};this._isSendingComposition=!0,setTimeout(()=>{if(this._isSendingComposition){this._isSendingComposition=!1;let i;t.start+=this._dataAlreadySent.length,this._isComposing?i=this._textarea.value.substring(t.start,this._compositionPosition.start):i=this._textarea.value.substring(t.start),i.length>0&&this._coreService.triggerDataEvent(i,!0)}},0)}else{this._isSendingComposition=!1;let t=this._textarea.value.substring(this._compositionPosition.start,this._compositionPosition.end);this._coreService.triggerDataEvent(t,!0)}}_handleAnyTextareaChanges(){let e=this._textarea.value;setTimeout(()=>{if(!this._isComposing){let t=this._textarea.value,i=t.replace(e,"");this._dataAlreadySent=i,t.length>e.length?this._coreService.triggerDataEvent(i,!0):t.length<e.length?this._coreService.triggerDataEvent(`${$.DEL}`,!0):t.length===e.length&&t!==e&&this._coreService.triggerDataEvent(t,!0)}},0)}updateCompositionElements(e){if(this._isComposing){if(this._bufferService.buffer.isCursorInViewport){let t=Math.min(this._bufferService.buffer.x,this._bufferService.cols-1),i=this._renderService.dimensions.css.cell.height,s=this._bufferService.buffer.y*this._renderService.dimensions.css.cell.height,r=t*this._renderService.dimensions.css.cell.width;this._compositionView.style.left=r+"px",this._compositionView.style.top=s+"px",this._compositionView.style.height=i+"px",this._compositionView.style.lineHeight=i+"px",this._compositionView.style.fontFamily=this._optionsService.rawOptions.fontFamily,this._compositionView.style.fontSize=this._optionsService.rawOptions.fontSize+"px";let o=this._compositionView.getBoundingClientRect();this._textarea.style.left=r+"px",this._textarea.style.top=s+"px",this._textarea.style.width=Math.max(o.width,1)+"px",this._textarea.style.height=Math.max(o.height,1)+"px",this._textarea.style.lineHeight=o.height+"px"}e||setTimeout(()=>this.updateCompositionElements(!0),0)}}};Ga=we([z(2,Ze),z(3,Qe),z(4,Ji),z(5,ti)],Ga);Me=0,Be=0,Pe=0,ye=0,Ic={css:"#00000000",rgba:0};(e=>{function t(r,o,n,a){return a!==void 0?`#${Ui(r)}${Ui(o)}${Ui(n)}${Ui(a)}`:`#${Ui(r)}${Ui(o)}${Ui(n)}`}e.toCss=t;function i(r,o,n,a=255){return(r<<24|o<<16|n<<8|a)>>>0}e.toRgba=i;function s(r,o,n,a){return{css:e.toCss(r,o,n,a),rgba:e.toRgba(r,o,n,a)}}e.toColor=s})(Ae||(Ae={}));(e=>{function t(h,l){if(ye=(l.rgba&255)/255,ye===1)return{css:l.css,rgba:l.rgba};let c=l.rgba>>24&255,d=l.rgba>>16&255,p=l.rgba>>8&255,f=h.rgba>>24&255,m=h.rgba>>16&255,_=h.rgba>>8&255;Me=f+Math.round((c-f)*ye),Be=m+Math.round((d-m)*ye),Pe=_+Math.round((p-_)*ye);let C=Ae.toCss(Me,Be,Pe),k=Ae.toRgba(Me,Be,Pe);return{css:C,rgba:k}}e.blend=t;function i(h){return(h.rgba&255)===255}e.isOpaque=i;function s(h,l,c){let d=Lo.ensureContrastRatio(h.rgba,l.rgba,c);if(d)return Ae.toColor(d>>24&255,d>>16&255,d>>8&255)}e.ensureContrastRatio=s;function r(h){let l=(h.rgba|255)>>>0;return[Me,Be,Pe]=Lo.toChannels(l),{css:Ae.toCss(Me,Be,Pe),rgba:l}}e.opaque=r;function o(h,l){return ye=Math.round(l*255),[Me,Be,Pe]=Lo.toChannels(h.rgba),{css:Ae.toCss(Me,Be,Pe,ye),rgba:Ae.toRgba(Me,Be,Pe,ye)}}e.opacity=o;function n(h,l){return ye=h.rgba&255,o(h,ye*l/255)}e.multiplyOpacity=n;function a(h){return[h.rgba>>24&255,h.rgba>>16&255,h.rgba>>8&255]}e.toColorRGB=a})(fe||(fe={}));(e=>{let t,i;try{let r=document.createElement("canvas");r.width=1,r.height=1;let o=r.getContext("2d",{willReadFrequently:!0});o&&(t=o,t.globalCompositeOperation="copy",i=t.createLinearGradient(0,0,1,1))}catch{}function s(r){if(r.match(/#[\da-f]{3,8}/i))switch(r.length){case 4:return Me=parseInt(r.slice(1,2).repeat(2),16),Be=parseInt(r.slice(2,3).repeat(2),16),Pe=parseInt(r.slice(3,4).repeat(2),16),Ae.toColor(Me,Be,Pe);case 5:return Me=parseInt(r.slice(1,2).repeat(2),16),Be=parseInt(r.slice(2,3).repeat(2),16),Pe=parseInt(r.slice(3,4).repeat(2),16),ye=parseInt(r.slice(4,5).repeat(2),16),Ae.toColor(Me,Be,Pe,ye);case 7:return{css:r,rgba:(parseInt(r.slice(1),16)<<8|255)>>>0};case 9:return{css:r,rgba:parseInt(r.slice(1),16)>>>0}}let o=r.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*(0|1|\d?\.(\d+))\s*)?\)/);if(o)return Me=parseInt(o[1]),Be=parseInt(o[2]),Pe=parseInt(o[3]),ye=Math.round((o[5]===void 0?1:parseFloat(o[5]))*255),Ae.toColor(Me,Be,Pe,ye);if(!t||!i)throw new Error("css.toColor: Unsupported css format");if(t.fillStyle=i,t.fillStyle=r,typeof t.fillStyle!="string")throw new Error("css.toColor: Unsupported css format");if(t.fillRect(0,0,1,1),[Me,Be,Pe,ye]=t.getImageData(0,0,1,1).data,ye!==255)throw new Error("css.toColor: Unsupported css format");return{rgba:Ae.toRgba(Me,Be,Pe,ye),css:r}}e.toColor=s})(be||(be={}));(e=>{function t(s){return i(s>>16&255,s>>8&255,s&255)}e.relativeLuminance=t;function i(s,r,o){let n=s/255,a=r/255,h=o/255,l=n<=.03928?n/12.92:Math.pow((n+.055)/1.055,2.4),c=a<=.03928?a/12.92:Math.pow((a+.055)/1.055,2.4),d=h<=.03928?h/12.92:Math.pow((h+.055)/1.055,2.4);return l*.2126+c*.7152+d*.0722}e.relativeLuminance2=i})(Je||(Je={}));(e=>{function t(n,a){if(ye=(a&255)/255,ye===1)return a;let h=a>>24&255,l=a>>16&255,c=a>>8&255,d=n>>24&255,p=n>>16&255,f=n>>8&255;return Me=d+Math.round((h-d)*ye),Be=p+Math.round((l-p)*ye),Pe=f+Math.round((c-f)*ye),Ae.toRgba(Me,Be,Pe)}e.blend=t;function i(n,a,h){let l=Je.relativeLuminance(n>>8),c=Je.relativeLuminance(a>>8);if(Xt(l,c)<h){if(c<l){let f=s(n,a,h),m=Xt(l,Je.relativeLuminance(f>>8));if(m<h){let _=r(n,a,h),C=Xt(l,Je.relativeLuminance(_>>8));return m>C?f:_}return f}let d=r(n,a,h),p=Xt(l,Je.relativeLuminance(d>>8));if(p<h){let f=s(n,a,h),m=Xt(l,Je.relativeLuminance(f>>8));return p>m?d:f}return d}}e.ensureContrastRatio=i;function s(n,a,h){let l=n>>24&255,c=n>>16&255,d=n>>8&255,p=a>>24&255,f=a>>16&255,m=a>>8&255,_=Xt(Je.relativeLuminance2(p,f,m),Je.relativeLuminance2(l,c,d));for(;_<h&&(p>0||f>0||m>0);)p-=Math.max(0,Math.ceil(p*.1)),f-=Math.max(0,Math.ceil(f*.1)),m-=Math.max(0,Math.ceil(m*.1)),_=Xt(Je.relativeLuminance2(p,f,m),Je.relativeLuminance2(l,c,d));return(p<<24|f<<16|m<<8|255)>>>0}e.reduceLuminance=s;function r(n,a,h){let l=n>>24&255,c=n>>16&255,d=n>>8&255,p=a>>24&255,f=a>>16&255,m=a>>8&255,_=Xt(Je.relativeLuminance2(p,f,m),Je.relativeLuminance2(l,c,d));for(;_<h&&(p<255||f<255||m<255);)p=Math.min(255,p+Math.ceil((255-p)*.1)),f=Math.min(255,f+Math.ceil((255-f)*.1)),m=Math.min(255,m+Math.ceil((255-m)*.1)),_=Xt(Je.relativeLuminance2(p,f,m),Je.relativeLuminance2(l,c,d));return(p<<24|f<<16|m<<8|255)>>>0}e.increaseLuminance=r;function o(n){return[n>>24&255,n>>16&255,n>>8&255,n&255]}e.toChannels=o})(Lo||(Lo={}));Tg=class extends $r{constructor(e,t,i){super(),this.content=0,this.combinedData="",this.fg=e.fg,this.bg=e.bg,this.combinedData=t,this._width=i}isCombined(){return 2097152}getWidth(){return this._width}getChars(){return this.combinedData}getCode(){return 2097151}setFromCharData(e){throw new Error("not implemented")}getAsCharData(){return[this.fg,this.getChars(),this.getWidth(),this.getCode()]}},Io=class{constructor(e){this._bufferService=e,this._characterJoiners=[],this._nextCharacterJoinerId=0,this._workCell=new bt}register(e){let t={id:this._nextCharacterJoinerId++,handler:e};return this._characterJoiners.push(t),t.id}deregister(e){for(let t=0;t<this._characterJoiners.length;t++)if(this._characterJoiners[t].id===e)return this._characterJoiners.splice(t,1),!0;return!1}getJoinedCharacters(e){if(this._characterJoiners.length===0)return[];let t=this._bufferService.buffer.lines.get(e);if(!t||t.length===0)return[];let i=[],s=t.translateToString(!0),r=0,o=0,n=0,a=t.getFg(0),h=t.getBg(0);for(let l=0;l<t.getTrimmedLength();l++)if(t.loadCell(l,this._workCell),this._workCell.getWidth()!==0){if(this._workCell.fg!==a||this._workCell.bg!==h){if(l-r>1){let c=this._getJoinedRanges(s,n,o,t,r);for(let d=0;d<c.length;d++)i.push(c[d])}r=l,n=o,a=this._workCell.fg,h=this._workCell.bg}o+=this._workCell.getChars().length||bi.length}if(this._bufferService.cols-r>1){let l=this._getJoinedRanges(s,n,o,t,r);for(let c=0;c<l.length;c++)i.push(l[c])}return i}_getJoinedRanges(e,t,i,s,r){let o=e.substring(t,i),n=[];try{n=this._characterJoiners[0].handler(o)}catch(a){console.error(a)}for(let a=1;a<this._characterJoiners.length;a++)try{let h=this._characterJoiners[a].handler(o);for(let l=0;l<h.length;l++)Io._mergeRanges(n,h[l])}catch(h){console.error(h)}return this._stringRangesToCellRanges(n,s,r),n}_stringRangesToCellRanges(e,t,i){let s=0,r=!1,o=0,n=e[s];if(n){for(let a=i;a<this._bufferService.cols;a++){let h=t.getWidth(a),l=t.getString(a).length||bi.length;if(h!==0){if(!r&&n[0]<=o&&(n[0]=a,r=!0),n[1]<=o){if(n[1]=a,n=e[++s],!n)break;n[0]<=o?(n[0]=a,r=!0):r=!1}o+=l}}n&&(n[1]=this._bufferService.cols)}}static _mergeRanges(e,t){let i=!1;for(let s=0;s<e.length;s++){let r=e[s];if(i){if(t[1]<=r[0])return e[s-1][1]=t[1],e;if(t[1]<=r[1])return e[s-1][1]=Math.max(t[1],r[1]),e.splice(s,1),e;e.splice(s,1),s--}else{if(t[1]<=r[0])return e.splice(s,0,t),e;if(t[1]<=r[1])return r[0]=Math.min(t[0],r[0]),e;t[0]<r[1]&&(r[0]=Math.min(t[0],r[0]),i=!0);continue}}return i?e[e.length-1][1]=t[1]:e.push(t),e}};Io=we([z(0,Ze)],Io);Xa=class{constructor(e,t,i,s,r,o,n){this._document=e,this._characterJoinerService=t,this._optionsService=i,this._coreBrowserService=s,this._coreService=r,this._decorationService=o,this._themeService=n,this._workCell=new bt,this._columnSelectMode=!1,this.defaultSpacing=0}handleSelectionChanged(e,t,i){this._selectionStart=e,this._selectionEnd=t,this._columnSelectMode=i}createRow(e,t,i,s,r,o,n,a,h,l,c){let d=[],p=this._characterJoinerService.getJoinedCharacters(t),f=this._themeService.colors,m=e.getNoBgTrimmedLength();i&&m<o+1&&(m=o+1);let _,C=0,k="",R=0,T=0,y=0,L=0,D=!1,O=0,te=!1,re=0,xe=0,ie=[],Ke=l!==-1&&c!==-1;for(let S=0;S<m;S++){e.loadCell(S,this._workCell);let b=this._workCell.getWidth();if(b===0)continue;let x=!1,w=S>=xe,A=S,E=this._workCell;if(p.length>0&&S===p[0][0]&&w){let ce=p.shift(),Ln=this._isCellInSelection(ce[0],t);for(R=ce[0]+1;R<ce[1];R++)w&&(w=Ln===this._isCellInSelection(R,t));w&&(w=!i||o<ce[0]||o>=ce[1]),w?(x=!0,E=new Tg(this._workCell,e.translateToString(!0,ce[0],ce[1]),ce[1]-ce[0]),A=ce[1]-1,b=E.getWidth()):xe=ce[1]}let P=this._isCellInSelection(S,t),V=i&&S===o,ne=Ke&&S>=l&&S<=c,We=!1;this._decorationService.forEachDecorationAtCell(S,t,void 0,ce=>{We=!0});let rt=E.getChars()||bi;if(rt===" "&&(E.isUnderline()||E.isOverline())&&(rt="\xA0"),re=b*a-h.get(rt,E.isBold(),E.isItalic()),!_)_=this._document.createElement("span");else if(C&&(P&&te||!P&&!te&&E.bg===T)&&(P&&te&&f.selectionForeground||E.fg===y)&&E.extended.ext===L&&ne===D&&re===O&&!V&&!x&&!We&&w){E.isInvisible()?k+=bi:k+=rt,C++;continue}else C&&(_.textContent=k),_=this._document.createElement("span"),C=0,k="";if(T=E.bg,y=E.fg,L=E.extended.ext,D=ne,O=re,te=P,x&&o>=S&&o<=A&&(o=S),!this._coreService.isCursorHidden&&V&&this._coreService.isCursorInitialized){if(ie.push("xterm-cursor"),this._coreBrowserService.isFocused)n&&ie.push("xterm-cursor-blink"),ie.push(s==="bar"?"xterm-cursor-bar":s==="underline"?"xterm-cursor-underline":"xterm-cursor-block");else if(r)switch(r){case"outline":ie.push("xterm-cursor-outline");break;case"block":ie.push("xterm-cursor-block");break;case"bar":ie.push("xterm-cursor-bar");break;case"underline":ie.push("xterm-cursor-underline");break;default:break}}if(E.isBold()&&ie.push("xterm-bold"),E.isItalic()&&ie.push("xterm-italic"),E.isDim()&&ie.push("xterm-dim"),E.isInvisible()?k=bi:k=E.getChars()||bi,E.isUnderline()&&(ie.push(`xterm-underline-${E.extended.underlineStyle}`),k===" "&&(k="\xA0"),!E.isUnderlineColorDefault()))if(E.isUnderlineColorRGB())_.style.textDecorationColor=`rgb(${$r.toColorRGB(E.getUnderlineColor()).join(",")})`;else{let ce=E.getUnderlineColor();this._optionsService.rawOptions.drawBoldTextInBrightColors&&E.isBold()&&ce<8&&(ce+=8),_.style.textDecorationColor=f.ansi[ce].css}E.isOverline()&&(ie.push("xterm-overline"),k===" "&&(k="\xA0")),E.isStrikethrough()&&ie.push("xterm-strikethrough"),ne&&(_.style.textDecoration="underline");let _e=E.getFgColor(),Et=E.getFgColorMode(),ke=E.getBgColor(),jt=E.getBgColorMode(),Li=!!E.isInverse();if(Li){let ce=_e;_e=ke,ke=ce;let Ln=Et;Et=jt,jt=Ln}let hi,io,Us=!1;this._decorationService.forEachDecorationAtCell(S,t,void 0,ce=>{ce.options.layer!=="top"&&Us||(ce.backgroundColorRGB&&(jt=50331648,ke=ce.backgroundColorRGB.rgba>>8&16777215,hi=ce.backgroundColorRGB),ce.foregroundColorRGB&&(Et=50331648,_e=ce.foregroundColorRGB.rgba>>8&16777215,io=ce.foregroundColorRGB),Us=ce.options.layer==="top")}),!Us&&P&&(hi=this._coreBrowserService.isFocused?f.selectionBackgroundOpaque:f.selectionInactiveBackgroundOpaque,ke=hi.rgba>>8&16777215,jt=50331648,Us=!0,f.selectionForeground&&(Et=50331648,_e=f.selectionForeground.rgba>>8&16777215,io=f.selectionForeground)),Us&&ie.push("xterm-decoration-top");let ci;switch(jt){case 16777216:case 33554432:ci=f.ansi[ke],ie.push(`xterm-bg-${ke}`);break;case 50331648:ci=Ae.toColor(ke>>16,ke>>8&255,ke&255),this._addStyle(_,`background-color:#${zc((ke>>>0).toString(16),"0",6)}`);break;default:Li?(ci=f.foreground,ie.push("xterm-bg-257")):ci=f.background}switch(hi||E.isDim()&&(hi=fe.multiplyOpacity(ci,.5)),Et){case 16777216:case 33554432:E.isBold()&&_e<8&&this._optionsService.rawOptions.drawBoldTextInBrightColors&&(_e+=8),this._applyMinimumContrast(_,ci,f.ansi[_e],E,hi,void 0)||ie.push(`xterm-fg-${_e}`);break;case 50331648:let ce=Ae.toColor(_e>>16&255,_e>>8&255,_e&255);this._applyMinimumContrast(_,ci,ce,E,hi,io)||this._addStyle(_,`color:#${zc(_e.toString(16),"0",6)}`);break;default:this._applyMinimumContrast(_,ci,f.foreground,E,hi,io)||Li&&ie.push("xterm-fg-257")}ie.length&&(_.className=ie.join(" "),ie.length=0),!V&&!x&&!We&&w?C++:_.textContent=k,re!==this.defaultSpacing&&(_.style.letterSpacing=`${re}px`),d.push(_),S=A}return _&&C&&(_.textContent=k),d}_applyMinimumContrast(e,t,i,s,r,o){if(this._optionsService.rawOptions.minimumContrastRatio===1||Rg(s.getCode()))return!1;let n=this._getContrastCache(s),a;if(!r&&!o&&(a=n.getColor(t.rgba,i.rgba)),a===void 0){let h=this._optionsService.rawOptions.minimumContrastRatio/(s.isDim()?2:1);a=fe.ensureContrastRatio(r||t,o||i,h),n.setColor((r||t).rgba,(o||i).rgba,a??null)}return a?(this._addStyle(e,`color:${a.css}`),!0):!1}_getContrastCache(e){return e.isDim()?this._themeService.colors.halfContrastCache:this._themeService.colors.contrastCache}_addStyle(e,t){e.setAttribute("style",`${e.getAttribute("style")||""}${t};`)}_isCellInSelection(e,t){let i=this._selectionStart,s=this._selectionEnd;return!i||!s?!1:this._columnSelectMode?i[0]<=s[0]?e>=i[0]&&t>=i[1]&&e<s[0]&&t<=s[1]:e<i[0]&&t>=i[1]&&e>=s[0]&&t<=s[1]:t>i[1]&&t<s[1]||i[1]===s[1]&&t===i[1]&&e>=i[0]&&e<s[0]||i[1]<s[1]&&t===s[1]&&e<s[0]||i[1]<s[1]&&t===i[1]&&e>=i[0]}};Xa=we([z(1,Sd),z(2,Qe),z(3,ei),z(4,Ji),z(5,Tr),z(6,Cs)],Xa);Bg=class{constructor(e,t){this._flat=new Float32Array(256),this._font="",this._fontSize=0,this._weight="normal",this._weightBold="bold",this._measureElements=[],this._container=e.createElement("div"),this._container.classList.add("xterm-width-cache-measure-container"),this._container.setAttribute("aria-hidden","true"),this._container.style.whiteSpace="pre",this._container.style.fontKerning="none";let i=e.createElement("span");i.classList.add("xterm-char-measure-element");let s=e.createElement("span");s.classList.add("xterm-char-measure-element"),s.style.fontWeight="bold";let r=e.createElement("span");r.classList.add("xterm-char-measure-element"),r.style.fontStyle="italic";let o=e.createElement("span");o.classList.add("xterm-char-measure-element"),o.style.fontWeight="bold",o.style.fontStyle="italic",this._measureElements=[i,s,r,o],this._container.appendChild(i),this._container.appendChild(s),this._container.appendChild(r),this._container.appendChild(o),t.appendChild(this._container),this.clear()}dispose(){this._container.remove(),this._measureElements.length=0,this._holey=void 0}clear(){this._flat.fill(-9999),this._holey=new Map}setFont(e,t,i,s){e===this._font&&t===this._fontSize&&i===this._weight&&s===this._weightBold||(this._font=e,this._fontSize=t,this._weight=i,this._weightBold=s,this._container.style.fontFamily=this._font,this._container.style.fontSize=`${this._fontSize}px`,this._measureElements[0].style.fontWeight=`${i}`,this._measureElements[1].style.fontWeight=`${s}`,this._measureElements[2].style.fontWeight=`${i}`,this._measureElements[3].style.fontWeight=`${s}`,this.clear())}get(e,t,i){let s=0;if(!t&&!i&&e.length===1&&(s=e.charCodeAt(0))<256){if(this._flat[s]!==-9999)return this._flat[s];let n=this._measure(e,0);return n>0&&(this._flat[s]=n),n}let r=e;t&&(r+="B"),i&&(r+="I");let o=this._holey.get(r);if(o===void 0){let n=0;t&&(n|=1),i&&(n|=2),o=this._measure(e,n),o>0&&this._holey.set(r,o)}return o}_measure(e,t){let i=this._measureElements[t];return i.textContent=e.repeat(32),i.offsetWidth/32}},Pg=class{constructor(){this.clear()}clear(){this.hasSelection=!1,this.columnSelectMode=!1,this.viewportStartRow=0,this.viewportEndRow=0,this.viewportCappedStartRow=0,this.viewportCappedEndRow=0,this.startCol=0,this.endCol=0,this.selectionStart=void 0,this.selectionEnd=void 0}update(e,t,i,s=!1){if(this.selectionStart=t,this.selectionEnd=i,!t||!i||t[0]===i[0]&&t[1]===i[1]){this.clear();return}let r=e.buffers.active.ydisp,o=t[1]-r,n=i[1]-r,a=Math.max(o,0),h=Math.min(n,e.rows-1);if(a>=e.rows||h<0){this.clear();return}this.hasSelection=!0,this.columnSelectMode=s,this.viewportStartRow=o,this.viewportEndRow=n,this.viewportCappedStartRow=a,this.viewportCappedEndRow=h,this.startCol=t[0],this.endCol=i[0]}isCellSelected(e,t,i){return this.hasSelection?(i-=e.buffer.active.viewportY,this.columnSelectMode?this.startCol<=this.endCol?t>=this.startCol&&i>=this.viewportCappedStartRow&&t<this.endCol&&i<=this.viewportCappedEndRow:t<this.startCol&&i>=this.viewportCappedStartRow&&t>=this.endCol&&i<=this.viewportCappedEndRow:i>this.viewportStartRow&&i<this.viewportEndRow||this.viewportStartRow===this.viewportEndRow&&i===this.viewportStartRow&&t>=this.startCol&&t<this.endCol||this.viewportStartRow<this.viewportEndRow&&i===this.viewportEndRow&&t<this.endCol||this.viewportStartRow<this.viewportEndRow&&i===this.viewportStartRow&&t>=this.startCol):!1}};ba="xterm-dom-renderer-owner-",_t="xterm-rows",bo="xterm-fg-",Nc="xterm-bg-",dr="xterm-focus",yo="xterm-selection",Ig=1,Ja=class extends G{constructor(e,t,i,s,r,o,n,a,h,l,c,d,p,f){super(),this._terminal=e,this._document=t,this._element=i,this._screenElement=s,this._viewportElement=r,this._helperContainer=o,this._linkifier2=n,this._charSizeService=h,this._optionsService=l,this._bufferService=c,this._coreService=d,this._coreBrowserService=p,this._themeService=f,this._terminalClass=Ig++,this._rowElements=[],this._selectionRenderModel=Og(),this.onRequestRedraw=this._register(new M).event,this._rowContainer=this._document.createElement("div"),this._rowContainer.classList.add(_t),this._rowContainer.style.lineHeight="normal",this._rowContainer.setAttribute("aria-hidden","true"),this._refreshRowElements(this._bufferService.cols,this._bufferService.rows),this._selectionContainer=this._document.createElement("div"),this._selectionContainer.classList.add(yo),this._selectionContainer.setAttribute("aria-hidden","true"),this.dimensions=Mg(),this._updateDimensions(),this._register(this._optionsService.onOptionChange(()=>this._handleOptionsChanged())),this._register(this._themeService.onChangeColors(m=>this._injectCss(m))),this._injectCss(this._themeService.colors),this._rowFactory=a.createInstance(Xa,document),this._element.classList.add(ba+this._terminalClass),this._screenElement.appendChild(this._rowContainer),this._screenElement.appendChild(this._selectionContainer),this._register(this._linkifier2.onShowLinkUnderline(m=>this._handleLinkHover(m))),this._register(this._linkifier2.onHideLinkUnderline(m=>this._handleLinkLeave(m))),this._register(me(()=>{this._element.classList.remove(ba+this._terminalClass),this._rowContainer.remove(),this._selectionContainer.remove(),this._widthCache.dispose(),this._themeStyleElement.remove(),this._dimensionsStyleElement.remove()})),this._widthCache=new Bg(this._document,this._helperContainer),this._widthCache.setFont(this._optionsService.rawOptions.fontFamily,this._optionsService.rawOptions.fontSize,this._optionsService.rawOptions.fontWeight,this._optionsService.rawOptions.fontWeightBold),this._setDefaultSpacing()}_updateDimensions(){let e=this._coreBrowserService.dpr;this.dimensions.device.char.width=this._charSizeService.width*e,this.dimensions.device.char.height=Math.ceil(this._charSizeService.height*e),this.dimensions.device.cell.width=this.dimensions.device.char.width+Math.round(this._optionsService.rawOptions.letterSpacing),this.dimensions.device.cell.height=Math.floor(this.dimensions.device.char.height*this._optionsService.rawOptions.lineHeight),this.dimensions.device.char.left=0,this.dimensions.device.char.top=0,this.dimensions.device.canvas.width=this.dimensions.device.cell.width*this._bufferService.cols,this.dimensions.device.canvas.height=this.dimensions.device.cell.height*this._bufferService.rows,this.dimensions.css.canvas.width=Math.round(this.dimensions.device.canvas.width/e),this.dimensions.css.canvas.height=Math.round(this.dimensions.device.canvas.height/e),this.dimensions.css.cell.width=this.dimensions.css.canvas.width/this._bufferService.cols,this.dimensions.css.cell.height=this.dimensions.css.canvas.height/this._bufferService.rows;for(let i of this._rowElements)i.style.width=`${this.dimensions.css.canvas.width}px`,i.style.height=`${this.dimensions.css.cell.height}px`,i.style.lineHeight=`${this.dimensions.css.cell.height}px`,i.style.overflow="hidden";this._dimensionsStyleElement||(this._dimensionsStyleElement=this._document.createElement("style"),this._screenElement.appendChild(this._dimensionsStyleElement));let t=`${this._terminalSelector} .${_t} span { display: inline-block; height: 100%; vertical-align: top;}`;this._dimensionsStyleElement.textContent=t,this._selectionContainer.style.height=this._viewportElement.style.height,this._screenElement.style.width=`${this.dimensions.css.canvas.width}px`,this._screenElement.style.height=`${this.dimensions.css.canvas.height}px`}_injectCss(e){this._themeStyleElement||(this._themeStyleElement=this._document.createElement("style"),this._screenElement.appendChild(this._themeStyleElement));let t=`${this._terminalSelector} .${_t} { pointer-events: none; color: ${e.foreground.css}; font-family: ${this._optionsService.rawOptions.fontFamily}; font-size: ${this._optionsService.rawOptions.fontSize}px; font-kerning: none; white-space: pre}`;t+=`${this._terminalSelector} .${_t} .xterm-dim { color: ${fe.multiplyOpacity(e.foreground,.5).css};}`,t+=`${this._terminalSelector} span:not(.xterm-bold) { font-weight: ${this._optionsService.rawOptions.fontWeight};}${this._terminalSelector} span.xterm-bold { font-weight: ${this._optionsService.rawOptions.fontWeightBold};}${this._terminalSelector} span.xterm-italic { font-style: italic;}`;let i=`blink_underline_${this._terminalClass}`,s=`blink_bar_${this._terminalClass}`,r=`blink_block_${this._terminalClass}`;t+=`@keyframes ${i} { 50% {  border-bottom-style: hidden; }}`,t+=`@keyframes ${s} { 50% {  box-shadow: none; }}`,t+=`@keyframes ${r} { 0% {  background-color: ${e.cursor.css};  color: ${e.cursorAccent.css}; } 50% {  background-color: inherit;  color: ${e.cursor.css}; }}`,t+=`${this._terminalSelector} .${_t}.${dr} .xterm-cursor.xterm-cursor-blink.xterm-cursor-underline { animation: ${i} 1s step-end infinite;}${this._terminalSelector} .${_t}.${dr} .xterm-cursor.xterm-cursor-blink.xterm-cursor-bar { animation: ${s} 1s step-end infinite;}${this._terminalSelector} .${_t}.${dr} .xterm-cursor.xterm-cursor-blink.xterm-cursor-block { animation: ${r} 1s step-end infinite;}${this._terminalSelector} .${_t} .xterm-cursor.xterm-cursor-block { background-color: ${e.cursor.css}; color: ${e.cursorAccent.css};}${this._terminalSelector} .${_t} .xterm-cursor.xterm-cursor-block:not(.xterm-cursor-blink) { background-color: ${e.cursor.css} !important; color: ${e.cursorAccent.css} !important;}${this._terminalSelector} .${_t} .xterm-cursor.xterm-cursor-outline { outline: 1px solid ${e.cursor.css}; outline-offset: -1px;}${this._terminalSelector} .${_t} .xterm-cursor.xterm-cursor-bar { box-shadow: ${this._optionsService.rawOptions.cursorWidth}px 0 0 ${e.cursor.css} inset;}${this._terminalSelector} .${_t} .xterm-cursor.xterm-cursor-underline { border-bottom: 1px ${e.cursor.css}; border-bottom-style: solid; height: calc(100% - 1px);}`,t+=`${this._terminalSelector} .${yo} { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none;}${this._terminalSelector}.focus .${yo} div { position: absolute; background-color: ${e.selectionBackgroundOpaque.css};}${this._terminalSelector} .${yo} div { position: absolute; background-color: ${e.selectionInactiveBackgroundOpaque.css};}`;for(let[o,n]of e.ansi.entries())t+=`${this._terminalSelector} .${bo}${o} { color: ${n.css}; }${this._terminalSelector} .${bo}${o}.xterm-dim { color: ${fe.multiplyOpacity(n,.5).css}; }${this._terminalSelector} .${Nc}${o} { background-color: ${n.css}; }`;t+=`${this._terminalSelector} .${bo}257 { color: ${fe.opaque(e.background).css}; }${this._terminalSelector} .${bo}257.xterm-dim { color: ${fe.multiplyOpacity(fe.opaque(e.background),.5).css}; }${this._terminalSelector} .${Nc}257 { background-color: ${e.foreground.css}; }`,this._themeStyleElement.textContent=t}_setDefaultSpacing(){let e=this.dimensions.css.cell.width-this._widthCache.get("W",!1,!1);this._rowContainer.style.letterSpacing=`${e}px`,this._rowFactory.defaultSpacing=e}handleDevicePixelRatioChange(){this._updateDimensions(),this._widthCache.clear(),this._setDefaultSpacing()}_refreshRowElements(e,t){for(let i=this._rowElements.length;i<=t;i++){let s=this._document.createElement("div");this._rowContainer.appendChild(s),this._rowElements.push(s)}for(;this._rowElements.length>t;)this._rowContainer.removeChild(this._rowElements.pop())}handleResize(e,t){this._refreshRowElements(e,t),this._updateDimensions(),this.handleSelectionChanged(this._selectionRenderModel.selectionStart,this._selectionRenderModel.selectionEnd,this._selectionRenderModel.columnSelectMode)}handleCharSizeChanged(){this._updateDimensions(),this._widthCache.clear(),this._setDefaultSpacing()}handleBlur(){this._rowContainer.classList.remove(dr),this.renderRows(0,this._bufferService.rows-1)}handleFocus(){this._rowContainer.classList.add(dr),this.renderRows(this._bufferService.buffer.y,this._bufferService.buffer.y)}handleSelectionChanged(e,t,i){if(this._selectionContainer.replaceChildren(),this._rowFactory.handleSelectionChanged(e,t,i),this.renderRows(0,this._bufferService.rows-1),!e||!t||(this._selectionRenderModel.update(this._terminal,e,t,i),!this._selectionRenderModel.hasSelection))return;let s=this._selectionRenderModel.viewportStartRow,r=this._selectionRenderModel.viewportEndRow,o=this._selectionRenderModel.viewportCappedStartRow,n=this._selectionRenderModel.viewportCappedEndRow,a=this._document.createDocumentFragment();if(i){let h=e[0]>t[0];a.appendChild(this._createSelectionElement(o,h?t[0]:e[0],h?e[0]:t[0],n-o+1))}else{let h=s===o?e[0]:0,l=o===r?t[0]:this._bufferService.cols;a.appendChild(this._createSelectionElement(o,h,l));let c=n-o-1;if(a.appendChild(this._createSelectionElement(o+1,0,this._bufferService.cols,c)),o!==n){let d=r===n?t[0]:this._bufferService.cols;a.appendChild(this._createSelectionElement(n,0,d))}}this._selectionContainer.appendChild(a)}_createSelectionElement(e,t,i,s=1){let r=this._document.createElement("div"),o=t*this.dimensions.css.cell.width,n=this.dimensions.css.cell.width*(i-t);return o+n>this.dimensions.css.canvas.width&&(n=this.dimensions.css.canvas.width-o),r.style.height=`${s*this.dimensions.css.cell.height}px`,r.style.top=`${e*this.dimensions.css.cell.height}px`,r.style.left=`${o}px`,r.style.width=`${n}px`,r}handleCursorMove(){}_handleOptionsChanged(){this._updateDimensions(),this._injectCss(this._themeService.colors),this._widthCache.setFont(this._optionsService.rawOptions.fontFamily,this._optionsService.rawOptions.fontSize,this._optionsService.rawOptions.fontWeight,this._optionsService.rawOptions.fontWeightBold),this._setDefaultSpacing()}clear(){for(let e of this._rowElements)e.replaceChildren()}renderRows(e,t){let i=this._bufferService.buffer,s=i.ybase+i.y,r=Math.min(i.x,this._bufferService.cols-1),o=this._coreService.decPrivateModes.cursorBlink??this._optionsService.rawOptions.cursorBlink,n=this._coreService.decPrivateModes.cursorStyle??this._optionsService.rawOptions.cursorStyle,a=this._optionsService.rawOptions.cursorInactiveStyle;for(let h=e;h<=t;h++){let l=h+i.ydisp,c=this._rowElements[h],d=i.lines.get(l);if(!c||!d)break;c.replaceChildren(...this._rowFactory.createRow(d,l,l===s,n,a,r,o,this.dimensions.css.cell.width,this._widthCache,-1,-1))}}get _terminalSelector(){return`.${ba}${this._terminalClass}`}_handleLinkHover(e){this._setCellUnderline(e.x1,e.x2,e.y1,e.y2,e.cols,!0)}_handleLinkLeave(e){this._setCellUnderline(e.x1,e.x2,e.y1,e.y2,e.cols,!1)}_setCellUnderline(e,t,i,s,r,o){i<0&&(e=0),s<0&&(t=0);let n=this._bufferService.rows-1;i=Math.max(Math.min(i,n),0),s=Math.max(Math.min(s,n),0),r=Math.min(r,this._bufferService.cols);let a=this._bufferService.buffer,h=a.ybase+a.y,l=Math.min(a.x,r-1),c=this._optionsService.rawOptions.cursorBlink,d=this._optionsService.rawOptions.cursorStyle,p=this._optionsService.rawOptions.cursorInactiveStyle;for(let f=i;f<=s;++f){let m=f+a.ydisp,_=this._rowElements[f],C=a.lines.get(m);if(!_||!C)break;_.replaceChildren(...this._rowFactory.createRow(C,m,m===h,d,p,l,c,this.dimensions.css.cell.width,this._widthCache,o?f===i?e:0:-1,o?(f===s?t:r)-1:-1))}}};Ja=we([z(7,dl),z(8,Wo),z(9,Qe),z(10,Ze),z(11,Ji),z(12,ei),z(13,Cs)],Ja);Za=class extends G{constructor(e,t,i){super(),this._optionsService=i,this.width=0,this.height=0,this._onCharSizeChange=this._register(new M),this.onCharSizeChange=this._onCharSizeChange.event;try{this._measureStrategy=this._register(new Ng(this._optionsService))}catch{this._measureStrategy=this._register(new zg(e,t,this._optionsService))}this._register(this._optionsService.onMultipleOptionChange(["fontFamily","fontSize"],()=>this.measure()))}get hasValidSize(){return this.width>0&&this.height>0}measure(){let e=this._measureStrategy.measure();(e.width!==this.width||e.height!==this.height)&&(this.width=e.width,this.height=e.height,this._onCharSizeChange.fire())}};Za=we([z(2,Qe)],Za);Xd=class extends G{constructor(){super(...arguments),this._result={width:0,height:0}}_validateAndSet(e,t){e!==void 0&&e>0&&t!==void 0&&t>0&&(this._result.width=e,this._result.height=t)}},zg=class extends Xd{constructor(e,t,i){super(),this._document=e,this._parentElement=t,this._optionsService=i,this._measureElement=this._document.createElement("span"),this._measureElement.classList.add("xterm-char-measure-element"),this._measureElement.textContent="W".repeat(32),this._measureElement.setAttribute("aria-hidden","true"),this._measureElement.style.whiteSpace="pre",this._measureElement.style.fontKerning="none",this._parentElement.appendChild(this._measureElement)}measure(){return this._measureElement.style.fontFamily=this._optionsService.rawOptions.fontFamily,this._measureElement.style.fontSize=`${this._optionsService.rawOptions.fontSize}px`,this._validateAndSet(Number(this._measureElement.offsetWidth)/32,Number(this._measureElement.offsetHeight)),this._result}},Ng=class extends Xd{constructor(e){super(),this._optionsService=e,this._canvas=new OffscreenCanvas(100,100),this._ctx=this._canvas.getContext("2d");let t=this._ctx.measureText("W");if(!("width"in t&&"fontBoundingBoxAscent"in t&&"fontBoundingBoxDescent"in t))throw new Error("Required font metrics not supported")}measure(){this._ctx.font=`${this._optionsService.rawOptions.fontSize}px ${this._optionsService.rawOptions.fontFamily}`;let e=this._ctx.measureText("W");return this._validateAndSet(e.width,e.fontBoundingBoxAscent+e.fontBoundingBoxDescent),this._result}},Hg=class extends G{constructor(e,t,i){super(),this._textarea=e,this._window=t,this.mainDocument=i,this._isFocused=!1,this._cachedIsFocused=void 0,this._screenDprMonitor=this._register(new Fg(this._window)),this._onDprChange=this._register(new M),this.onDprChange=this._onDprChange.event,this._onWindowChange=this._register(new M),this.onWindowChange=this._onWindowChange.event,this._register(this.onWindowChange(s=>this._screenDprMonitor.setWindow(s))),this._register(Ve.forward(this._screenDprMonitor.onDprChange,this._onDprChange)),this._register(W(this._textarea,"focus",()=>this._isFocused=!0)),this._register(W(this._textarea,"blur",()=>this._isFocused=!1))}get window(){return this._window}set window(e){this._window!==e&&(this._window=e,this._onWindowChange.fire(this._window))}get dpr(){return this.window.devicePixelRatio}get isFocused(){return this._cachedIsFocused===void 0&&(this._cachedIsFocused=this._isFocused&&this._textarea.ownerDocument.hasFocus(),queueMicrotask(()=>this._cachedIsFocused=void 0)),this._cachedIsFocused}},Fg=class extends G{constructor(e){super(),this._parentWindow=e,this._windowResizeListener=this._register(new Ss),this._onDprChange=this._register(new M),this.onDprChange=this._onDprChange.event,this._outerListener=()=>this._setDprAndFireIfDiffers(),this._currentDevicePixelRatio=this._parentWindow.devicePixelRatio,this._updateDpr(),this._setWindowResizeListener(),this._register(me(()=>this.clearListener()))}setWindow(e){this._parentWindow=e,this._setWindowResizeListener(),this._setDprAndFireIfDiffers()}_setWindowResizeListener(){this._windowResizeListener.value=W(this._parentWindow,"resize",()=>this._setDprAndFireIfDiffers())}_setDprAndFireIfDiffers(){this._parentWindow.devicePixelRatio!==this._currentDevicePixelRatio&&this._onDprChange.fire(this._parentWindow.devicePixelRatio),this._updateDpr()}_updateDpr(){this._outerListener&&(this._resolutionMediaMatchList?.removeListener(this._outerListener),this._currentDevicePixelRatio=this._parentWindow.devicePixelRatio,this._resolutionMediaMatchList=this._parentWindow.matchMedia(`screen and (resolution: ${this._parentWindow.devicePixelRatio}dppx)`),this._resolutionMediaMatchList.addListener(this._outerListener))}clearListener(){!this._resolutionMediaMatchList||!this._outerListener||(this._resolutionMediaMatchList.removeListener(this._outerListener),this._resolutionMediaMatchList=void 0,this._outerListener=void 0)}},Wg=class extends G{constructor(){super(),this.linkProviders=[],this._register(me(()=>this.linkProviders.length=0))}registerLinkProvider(e){return this.linkProviders.push(e),{dispose:()=>{let t=this.linkProviders.indexOf(e);t!==-1&&this.linkProviders.splice(t,1)}}}};Qa=class{constructor(e,t){this._renderService=e,this._charSizeService=t}getCoords(e,t,i,s,r){return Vg(window,e,t,i,s,this._charSizeService.hasValidSize,this._renderService.dimensions.css.cell.width,this._renderService.dimensions.css.cell.height,r)}getMouseReportCoords(e,t){let i=bl(window,e,t);if(this._charSizeService.hasValidSize)return i[0]=Math.min(Math.max(i[0],0),this._renderService.dimensions.css.canvas.width-1),i[1]=Math.min(Math.max(i[1],0),this._renderService.dimensions.css.canvas.height-1),{col:Math.floor(i[0]/this._renderService.dimensions.css.cell.width),row:Math.floor(i[1]/this._renderService.dimensions.css.cell.height),x:Math.floor(i[0]),y:Math.floor(i[1])}}};Qa=we([z(0,ti),z(1,Wo)],Qa);Ug=class{constructor(e,t){this._renderCallback=e,this._coreBrowserService=t,this._refreshCallbacks=[]}dispose(){this._animationFrame&&(this._coreBrowserService.window.cancelAnimationFrame(this._animationFrame),this._animationFrame=void 0)}addRefreshCallback(e){return this._refreshCallbacks.push(e),this._animationFrame||(this._animationFrame=this._coreBrowserService.window.requestAnimationFrame(()=>this._innerRefresh())),this._animationFrame}refresh(e,t,i){this._rowCount=i,e=e!==void 0?e:0,t=t!==void 0?t:this._rowCount-1,this._rowStart=this._rowStart!==void 0?Math.min(this._rowStart,e):e,this._rowEnd=this._rowEnd!==void 0?Math.max(this._rowEnd,t):t,!this._animationFrame&&(this._animationFrame=this._coreBrowserService.window.requestAnimationFrame(()=>this._innerRefresh()))}_innerRefresh(){if(this._animationFrame=void 0,this._rowStart===void 0||this._rowEnd===void 0||this._rowCount===void 0){this._runRefreshCallbacks();return}let e=Math.max(this._rowStart,0),t=Math.min(this._rowEnd,this._rowCount-1);this._rowStart=void 0,this._rowEnd=void 0,this._renderCallback(e,t),this._runRefreshCallbacks()}_runRefreshCallbacks(){for(let e of this._refreshCallbacks)e(0);this._refreshCallbacks=[]}},Jd={};Am(Jd,{getSafariVersion:()=>Kg,isChromeOS:()=>tu,isFirefox:()=>Zd,isIpad:()=>jg,isIphone:()=>Yg,isLegacyEdge:()=>qg,isLinux:()=>yl,isMac:()=>zo,isNode:()=>qo,isSafari:()=>Qd,isWindows:()=>eu});qo=typeof process<"u"&&"title"in process,Lr=qo?"node":navigator.userAgent,Dr=qo?"node":navigator.platform,Zd=Lr.includes("Firefox"),qg=Lr.includes("Edge"),Qd=/^((?!chrome|android).)*safari/i.test(Lr);zo=["Macintosh","MacIntel","MacPPC","Mac68K"].includes(Dr),jg=Dr==="iPad",Yg=Dr==="iPhone",eu=["Windows","Win16","Win32","WinCE"].includes(Dr),yl=Dr.indexOf("Linux")>=0,tu=/\bCrOS\b/.test(Lr),iu=class{constructor(){this._tasks=[],this._i=0}enqueue(e){this._tasks.push(e),this._start()}flush(){for(;this._i<this._tasks.length;)this._tasks[this._i]()||this._i++;this.clear()}clear(){this._idleCallback&&(this._cancelCallback(this._idleCallback),this._idleCallback=void 0),this._i=0,this._tasks.length=0}_start(){this._idleCallback||(this._idleCallback=this._requestCallback(this._process.bind(this)))}_process(e){this._idleCallback=void 0;let t=0,i=0,s=e.timeRemaining(),r=0;for(;this._i<this._tasks.length;){if(t=performance.now(),this._tasks[this._i]()||this._i++,t=Math.max(1,performance.now()-t),i=Math.max(t,i),r=e.timeRemaining(),i*1.5>r){s-t<-20&&console.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(s-t))}ms`),this._start();return}s=r}this.clear()}},Gg=class extends iu{_requestCallback(e){return setTimeout(()=>e(this._createDeadline(16)))}_cancelCallback(e){clearTimeout(e)}_createDeadline(e){let t=performance.now()+e;return{timeRemaining:()=>Math.max(0,t-performance.now())}}},Xg=class extends iu{_requestCallback(e){return requestIdleCallback(e)}_cancelCallback(e){cancelIdleCallback(e)}},No=!qo&&"requestIdleCallback"in window?Xg:Gg,Jg=class{constructor(){this._queue=new No}set(e){this._queue.clear(),this._queue.enqueue(e)}flush(){this._queue.flush()}},el=class extends G{constructor(e,t,i,s,r,o,n,a,h){super(),this._rowCount=e,this._optionsService=i,this._charSizeService=s,this._coreService=r,this._coreBrowserService=a,this._renderer=this._register(new Ss),this._pausedResizeTask=new Jg,this._observerDisposable=this._register(new Ss),this._isPaused=!1,this._needsFullRefresh=!1,this._isNextRenderRedrawOnly=!0,this._needsSelectionRefresh=!1,this._canvasWidth=0,this._canvasHeight=0,this._selectionState={start:void 0,end:void 0,columnSelectMode:!1},this._onDimensionsChange=this._register(new M),this.onDimensionsChange=this._onDimensionsChange.event,this._onRenderedViewportChange=this._register(new M),this.onRenderedViewportChange=this._onRenderedViewportChange.event,this._onRender=this._register(new M),this.onRender=this._onRender.event,this._onRefreshRequest=this._register(new M),this.onRefreshRequest=this._onRefreshRequest.event,this._renderDebouncer=new Ug((l,c)=>this._renderRows(l,c),this._coreBrowserService),this._register(this._renderDebouncer),this._syncOutputHandler=new Zg(this._coreBrowserService,this._coreService,()=>this._fullRefresh()),this._register(me(()=>this._syncOutputHandler.dispose())),this._register(this._coreBrowserService.onDprChange(()=>this.handleDevicePixelRatioChange())),this._register(n.onResize(()=>this._fullRefresh())),this._register(n.buffers.onBufferActivate(()=>this._renderer.value?.clear())),this._register(this._optionsService.onOptionChange(()=>this._handleOptionsChanged())),this._register(this._charSizeService.onCharSizeChange(()=>this.handleCharSizeChanged())),this._register(o.onDecorationRegistered(()=>this._fullRefresh())),this._register(o.onDecorationRemoved(()=>this._fullRefresh())),this._register(this._optionsService.onMultipleOptionChange(["customGlyphs","drawBoldTextInBrightColors","letterSpacing","lineHeight","fontFamily","fontSize","fontWeight","fontWeightBold","minimumContrastRatio","rescaleOverlappingGlyphs"],()=>{this.clear(),this.handleResize(n.cols,n.rows),this._fullRefresh()})),this._register(this._optionsService.onMultipleOptionChange(["cursorBlink","cursorStyle"],()=>this.refreshRows(n.buffer.y,n.buffer.y,!0))),this._register(h.onChangeColors(()=>this._fullRefresh())),this._registerIntersectionObserver(this._coreBrowserService.window,t),this._register(this._coreBrowserService.onWindowChange(l=>this._registerIntersectionObserver(l,t)))}get dimensions(){return this._renderer.value.dimensions}_registerIntersectionObserver(e,t){if("IntersectionObserver"in e){let i=new e.IntersectionObserver(s=>this._handleIntersectionChange(s[s.length-1]),{threshold:0});i.observe(t),this._observerDisposable.value=me(()=>i.disconnect())}}_handleIntersectionChange(e){this._isPaused=e.isIntersecting===void 0?e.intersectionRatio===0:!e.isIntersecting,!this._isPaused&&!this._charSizeService.hasValidSize&&this._charSizeService.measure(),!this._isPaused&&this._needsFullRefresh&&(this._pausedResizeTask.flush(),this.refreshRows(0,this._rowCount-1),this._needsFullRefresh=!1)}refreshRows(e,t,i=!1){if(this._isPaused){this._needsFullRefresh=!0;return}if(this._coreService.decPrivateModes.synchronizedOutput){this._syncOutputHandler.bufferRows(e,t);return}let s=this._syncOutputHandler.flush();s&&(e=Math.min(e,s.start),t=Math.max(t,s.end)),i||(this._isNextRenderRedrawOnly=!1),this._renderDebouncer.refresh(e,t,this._rowCount)}_renderRows(e,t){if(this._renderer.value){if(this._coreService.decPrivateModes.synchronizedOutput){this._syncOutputHandler.bufferRows(e,t);return}e=Math.min(e,this._rowCount-1),t=Math.min(t,this._rowCount-1),this._renderer.value.renderRows(e,t),this._needsSelectionRefresh&&(this._renderer.value.handleSelectionChanged(this._selectionState.start,this._selectionState.end,this._selectionState.columnSelectMode),this._needsSelectionRefresh=!1),this._isNextRenderRedrawOnly||this._onRenderedViewportChange.fire({start:e,end:t}),this._onRender.fire({start:e,end:t}),this._isNextRenderRedrawOnly=!0}}resize(e,t){this._rowCount=t,this._fireOnCanvasResize()}_handleOptionsChanged(){this._renderer.value&&(this.refreshRows(0,this._rowCount-1),this._fireOnCanvasResize())}_fireOnCanvasResize(){this._renderer.value&&(this._renderer.value.dimensions.css.canvas.width===this._canvasWidth&&this._renderer.value.dimensions.css.canvas.height===this._canvasHeight||this._onDimensionsChange.fire(this._renderer.value.dimensions))}hasRenderer(){return!!this._renderer.value}setRenderer(e){this._renderer.value=e,this._renderer.value&&(this._renderer.value.onRequestRedraw(t=>this.refreshRows(t.start,t.end,!0)),this._needsSelectionRefresh=!0,this._fullRefresh())}addRefreshCallback(e){return this._renderDebouncer.addRefreshCallback(e)}_fullRefresh(){this._isPaused?this._needsFullRefresh=!0:this.refreshRows(0,this._rowCount-1)}clearTextureAtlas(){this._renderer.value&&(this._renderer.value.clearTextureAtlas?.(),this._fullRefresh())}handleDevicePixelRatioChange(){this._charSizeService.measure(),this._renderer.value&&(this._renderer.value.handleDevicePixelRatioChange(),this.refreshRows(0,this._rowCount-1))}handleResize(e,t){this._renderer.value&&(this._isPaused?this._pausedResizeTask.set(()=>this._renderer.value?.handleResize(e,t)):this._renderer.value.handleResize(e,t),this._fullRefresh())}handleCharSizeChanged(){this._renderer.value?.handleCharSizeChanged()}handleBlur(){this._renderer.value?.handleBlur()}handleFocus(){this._renderer.value?.handleFocus()}handleSelectionChanged(e,t,i){this._selectionState.start=e,this._selectionState.end=t,this._selectionState.columnSelectMode=i,this._renderer.value?.handleSelectionChanged(e,t,i)}handleCursorMove(){this._renderer.value?.handleCursorMove()}clear(){this._renderer.value?.clear()}};el=we([z(2,Qe),z(3,Wo),z(4,Ji),z(5,Tr),z(6,Ze),z(7,ei),z(8,Cs)],el);Zg=class{constructor(e,t,i){this._coreBrowserService=e,this._coreService=t,this._onTimeout=i,this._start=0,this._end=0,this._isBuffering=!1}bufferRows(e,t){this._isBuffering?(this._start=Math.min(this._start,e),this._end=Math.max(this._end,t)):(this._start=e,this._end=t,this._isBuffering=!0),this._timeout===void 0&&(this._timeout=this._coreBrowserService.window.setTimeout(()=>{this._timeout=void 0,this._coreService.decPrivateModes.synchronizedOutput=!1,this._onTimeout()},1e3))}flush(){if(this._timeout!==void 0&&(this._coreBrowserService.window.clearTimeout(this._timeout),this._timeout=void 0),!this._isBuffering)return;let e={start:this._start,end:this._end};return this._isBuffering=!1,e}dispose(){this._timeout!==void 0&&(this._coreBrowserService.window.clearTimeout(this._timeout),this._timeout=void 0)}};nv=class{constructor(e){this._bufferService=e,this.isSelectAllActive=!1,this.selectionStartLength=0}clearSelection(){this.selectionStart=void 0,this.selectionEnd=void 0,this.isSelectAllActive=!1,this.selectionStartLength=0}get finalSelectionStart(){return this.isSelectAllActive?[0,0]:!this.selectionEnd||!this.selectionStart?this.selectionStart:this.areSelectionValuesReversed()?this.selectionEnd:this.selectionStart}get finalSelectionEnd(){if(this.isSelectAllActive)return[this._bufferService.cols,this._bufferService.buffer.ybase+this._bufferService.rows-1];if(this.selectionStart){if(!this.selectionEnd||this.areSelectionValuesReversed()){let e=this.selectionStart[0]+this.selectionStartLength;return e>this._bufferService.cols?e%this._bufferService.cols===0?[this._bufferService.cols,this.selectionStart[1]+Math.floor(e/this._bufferService.cols)-1]:[e%this._bufferService.cols,this.selectionStart[1]+Math.floor(e/this._bufferService.cols)]:[e,this.selectionStart[1]]}if(this.selectionStartLength&&this.selectionEnd[1]===this.selectionStart[1]){let e=this.selectionStart[0]+this.selectionStartLength;return e>this._bufferService.cols?[e%this._bufferService.cols,this.selectionStart[1]+Math.floor(e/this._bufferService.cols)]:[Math.max(e,this.selectionEnd[0]),this.selectionEnd[1]]}return this.selectionEnd}}areSelectionValuesReversed(){let e=this.selectionStart,t=this.selectionEnd;return!e||!t?!1:e[1]>t[1]||e[1]===t[1]&&e[0]>t[0]}handleTrim(e){return this.selectionStart&&(this.selectionStart[1]-=e),this.selectionEnd&&(this.selectionEnd[1]-=e),this.selectionEnd&&this.selectionEnd[1]<0?(this.clearSelection(),!0):(this.selectionStart&&this.selectionStart[1]<0&&(this.selectionStart[1]=0),!1)}};ya=50,av=15,lv=50,hv=500,cv="\xA0",dv=new RegExp(cv,"g"),tl=class extends G{constructor(e,t,i,s,r,o,n,a,h){super(),this._element=e,this._screenElement=t,this._linkifier=i,this._bufferService=s,this._coreService=r,this._mouseService=o,this._optionsService=n,this._renderService=a,this._coreBrowserService=h,this._dragScrollAmount=0,this._enabled=!0,this._workCell=new bt,this._mouseDownTimeStamp=0,this._oldHasSelection=!1,this._oldSelectionStart=void 0,this._oldSelectionEnd=void 0,this._onLinuxMouseSelection=this._register(new M),this.onLinuxMouseSelection=this._onLinuxMouseSelection.event,this._onRedrawRequest=this._register(new M),this.onRequestRedraw=this._onRedrawRequest.event,this._onSelectionChange=this._register(new M),this.onSelectionChange=this._onSelectionChange.event,this._onRequestScrollLines=this._register(new M),this.onRequestScrollLines=this._onRequestScrollLines.event,this._mouseMoveListener=l=>this._handleMouseMove(l),this._mouseUpListener=l=>this._handleMouseUp(l),this._coreService.onUserInput(()=>{this.hasSelection&&this.clearSelection()}),this._trimListener=this._bufferService.buffer.lines.onTrim(l=>this._handleTrim(l)),this._register(this._bufferService.buffers.onBufferActivate(l=>this._handleBufferActivate(l))),this.enable(),this._model=new nv(this._bufferService),this._activeSelectionMode=0,this._register(me(()=>{this._removeMouseDownListeners()})),this._register(this._bufferService.onResize(l=>{l.rowsChanged&&this.clearSelection()}))}reset(){this.clearSelection()}disable(){this.clearSelection(),this._enabled=!1}enable(){this._enabled=!0}get selectionStart(){return this._model.finalSelectionStart}get selectionEnd(){return this._model.finalSelectionEnd}get hasSelection(){let e=this._model.finalSelectionStart,t=this._model.finalSelectionEnd;return!e||!t?!1:e[0]!==t[0]||e[1]!==t[1]}get selectionText(){let e=this._model.finalSelectionStart,t=this._model.finalSelectionEnd;if(!e||!t)return"";let i=this._bufferService.buffer,s=[];if(this._activeSelectionMode===3){if(e[0]===t[0])return"";let r=e[0]<t[0]?e[0]:t[0],o=e[0]<t[0]?t[0]:e[0];for(let n=e[1];n<=t[1];n++){let a=i.translateBufferLineToString(n,!0,r,o);s.push(a)}}else{let r=e[1]===t[1]?t[0]:void 0;s.push(i.translateBufferLineToString(e[1],!0,e[0],r));for(let o=e[1]+1;o<=t[1]-1;o++){let n=i.lines.get(o),a=i.translateBufferLineToString(o,!0);n?.isWrapped?s[s.length-1]+=a:s.push(a)}if(e[1]!==t[1]){let o=i.lines.get(t[1]),n=i.translateBufferLineToString(t[1],!0,0,t[0]);o&&o.isWrapped?s[s.length-1]+=n:s.push(n)}}return s.map(r=>r.replace(dv," ")).join(eu?`\r
`:`
`)}clearSelection(){this._model.clearSelection(),this._removeMouseDownListeners(),this.refresh(),this._onSelectionChange.fire()}refresh(e){this._refreshAnimationFrame||(this._refreshAnimationFrame=this._coreBrowserService.window.requestAnimationFrame(()=>this._refresh())),yl&&e&&this.selectionText.length&&this._onLinuxMouseSelection.fire(this.selectionText)}_refresh(){this._refreshAnimationFrame=void 0,this._onRedrawRequest.fire({start:this._model.finalSelectionStart,end:this._model.finalSelectionEnd,columnSelectMode:this._activeSelectionMode===3})}_isClickInSelection(e){let t=this._getMouseBufferCoords(e),i=this._model.finalSelectionStart,s=this._model.finalSelectionEnd;return!i||!s||!t?!1:this._areCoordsInSelection(t,i,s)}isCellInSelection(e,t){let i=this._model.finalSelectionStart,s=this._model.finalSelectionEnd;return!i||!s?!1:this._areCoordsInSelection([e,t],i,s)}_areCoordsInSelection(e,t,i){return e[1]>t[1]&&e[1]<i[1]||t[1]===i[1]&&e[1]===t[1]&&e[0]>=t[0]&&e[0]<i[0]||t[1]<i[1]&&e[1]===i[1]&&e[0]<i[0]||t[1]<i[1]&&e[1]===t[1]&&e[0]>=t[0]}_selectWordAtCursor(e,t){let i=this._linkifier.currentLink?.link?.range;if(i)return this._model.selectionStart=[i.start.x-1,i.start.y-1],this._model.selectionStartLength=Hc(i,this._bufferService.cols),this._model.selectionEnd=void 0,!0;let s=this._getMouseBufferCoords(e);return s?(this._selectWordAt(s,t),this._model.selectionEnd=void 0,!0):!1}selectAll(){this._model.isSelectAllActive=!0,this.refresh(),this._onSelectionChange.fire()}selectLines(e,t){this._model.clearSelection(),e=Math.max(e,0),t=Math.min(t,this._bufferService.buffer.lines.length-1),this._model.selectionStart=[0,e],this._model.selectionEnd=[this._bufferService.cols,t],this.refresh(),this._onSelectionChange.fire()}_handleTrim(e){this._model.handleTrim(e)&&this.refresh()}_getMouseBufferCoords(e){let t=this._mouseService.getCoords(e,this._screenElement,this._bufferService.cols,this._bufferService.rows,!0);if(t)return t[0]--,t[1]--,t[1]+=this._bufferService.buffer.ydisp,t}_getMouseEventScrollAmount(e){let t=bl(this._coreBrowserService.window,e,this._screenElement)[1],i=this._renderService.dimensions.css.canvas.height;return t>=0&&t<=i?0:(t>i&&(t-=i),t=Math.min(Math.max(t,-ya),ya),t/=ya,t/Math.abs(t)+Math.round(t*(av-1)))}shouldForceSelection(e){return zo?e.altKey&&this._optionsService.rawOptions.macOptionClickForcesSelection:e.shiftKey}handleMouseDown(e){if(this._mouseDownTimeStamp=e.timeStamp,!(e.button===2&&this.hasSelection)&&e.button===0){if(!this._enabled){if(!this.shouldForceSelection(e))return;e.stopPropagation()}e.preventDefault(),this._dragScrollAmount=0,this._enabled&&e.shiftKey?this._handleIncrementalClick(e):e.detail===1?this._handleSingleClick(e):e.detail===2?this._handleDoubleClick(e):e.detail===3&&this._handleTripleClick(e),this._addMouseDownListeners(),this.refresh(!0)}}_addMouseDownListeners(){this._screenElement.ownerDocument&&(this._screenElement.ownerDocument.addEventListener("mousemove",this._mouseMoveListener),this._screenElement.ownerDocument.addEventListener("mouseup",this._mouseUpListener)),this._dragScrollIntervalTimer=this._coreBrowserService.window.setInterval(()=>this._dragScroll(),lv)}_removeMouseDownListeners(){this._screenElement.ownerDocument&&(this._screenElement.ownerDocument.removeEventListener("mousemove",this._mouseMoveListener),this._screenElement.ownerDocument.removeEventListener("mouseup",this._mouseUpListener)),this._coreBrowserService.window.clearInterval(this._dragScrollIntervalTimer),this._dragScrollIntervalTimer=void 0}_handleIncrementalClick(e){this._model.selectionStart&&(this._model.selectionEnd=this._getMouseBufferCoords(e))}_handleSingleClick(e){if(this._model.selectionStartLength=0,this._model.isSelectAllActive=!1,this._activeSelectionMode=this.shouldColumnSelect(e)?3:0,this._model.selectionStart=this._getMouseBufferCoords(e),!this._model.selectionStart)return;this._model.selectionEnd=void 0;let t=this._bufferService.buffer.lines.get(this._model.selectionStart[1]);t&&t.length!==this._model.selectionStart[0]&&t.hasWidth(this._model.selectionStart[0])===0&&this._model.selectionStart[0]++}_handleDoubleClick(e){this._selectWordAtCursor(e,!0)&&(this._activeSelectionMode=1)}_handleTripleClick(e){let t=this._getMouseBufferCoords(e);t&&(this._activeSelectionMode=2,this._selectLineAt(t[1]))}shouldColumnSelect(e){return e.altKey&&!(zo&&this._optionsService.rawOptions.macOptionClickForcesSelection)}_handleMouseMove(e){if(e.stopImmediatePropagation(),!this._model.selectionStart)return;let t=this._model.selectionEnd?[this._model.selectionEnd[0],this._model.selectionEnd[1]]:null;if(this._model.selectionEnd=this._getMouseBufferCoords(e),!this._model.selectionEnd){this.refresh(!0);return}this._activeSelectionMode===2?this._model.selectionEnd[1]<this._model.selectionStart[1]?this._model.selectionEnd[0]=0:this._model.selectionEnd[0]=this._bufferService.cols:this._activeSelectionMode===1&&this._selectToWordAt(this._model.selectionEnd),this._dragScrollAmount=this._getMouseEventScrollAmount(e),this._activeSelectionMode!==3&&(this._dragScrollAmount>0?this._model.selectionEnd[0]=this._bufferService.cols:this._dragScrollAmount<0&&(this._model.selectionEnd[0]=0));let i=this._bufferService.buffer;if(this._model.selectionEnd[1]<i.lines.length){let s=i.lines.get(this._model.selectionEnd[1]);s&&s.hasWidth(this._model.selectionEnd[0])===0&&this._model.selectionEnd[0]<this._bufferService.cols&&this._model.selectionEnd[0]++}(!t||t[0]!==this._model.selectionEnd[0]||t[1]!==this._model.selectionEnd[1])&&this.refresh(!0)}_dragScroll(){if(!(!this._model.selectionEnd||!this._model.selectionStart)&&this._dragScrollAmount){this._onRequestScrollLines.fire({amount:this._dragScrollAmount,suppressScrollEvent:!1});let e=this._bufferService.buffer;this._dragScrollAmount>0?(this._activeSelectionMode!==3&&(this._model.selectionEnd[0]=this._bufferService.cols),this._model.selectionEnd[1]=Math.min(e.ydisp+this._bufferService.rows,e.lines.length-1)):(this._activeSelectionMode!==3&&(this._model.selectionEnd[0]=0),this._model.selectionEnd[1]=e.ydisp),this.refresh()}}_handleMouseUp(e){let t=e.timeStamp-this._mouseDownTimeStamp;if(this._removeMouseDownListeners(),this.selectionText.length<=1&&t<hv&&e.altKey&&this._optionsService.rawOptions.altClickMovesCursor){if(this._bufferService.buffer.ybase===this._bufferService.buffer.ydisp){let i=this._mouseService.getCoords(e,this._element,this._bufferService.cols,this._bufferService.rows,!1);if(i&&i[0]!==void 0&&i[1]!==void 0){let s=Qg(i[0]-1,i[1]-1,this._bufferService,this._coreService.decPrivateModes.applicationCursorKeys);this._coreService.triggerDataEvent(s,!0)}}}else this._fireEventIfSelectionChanged()}_fireEventIfSelectionChanged(){let e=this._model.finalSelectionStart,t=this._model.finalSelectionEnd,i=!!e&&!!t&&(e[0]!==t[0]||e[1]!==t[1]);if(!i){this._oldHasSelection&&this._fireOnSelectionChange(e,t,i);return}!e||!t||(!this._oldSelectionStart||!this._oldSelectionEnd||e[0]!==this._oldSelectionStart[0]||e[1]!==this._oldSelectionStart[1]||t[0]!==this._oldSelectionEnd[0]||t[1]!==this._oldSelectionEnd[1])&&this._fireOnSelectionChange(e,t,i)}_fireOnSelectionChange(e,t,i){this._oldSelectionStart=e,this._oldSelectionEnd=t,this._oldHasSelection=i,this._onSelectionChange.fire()}_handleBufferActivate(e){this.clearSelection(),this._trimListener.dispose(),this._trimListener=e.activeBuffer.lines.onTrim(t=>this._handleTrim(t))}_convertViewportColToCharacterIndex(e,t){let i=t;for(let s=0;t>=s;s++){let r=e.loadCell(s,this._workCell).getChars().length;this._workCell.getWidth()===0?i--:r>1&&t!==s&&(i+=r-1)}return i}setSelection(e,t,i){this._model.clearSelection(),this._removeMouseDownListeners(),this._model.selectionStart=[e,t],this._model.selectionStartLength=i,this.refresh(),this._fireEventIfSelectionChanged()}rightClickSelect(e){this._isClickInSelection(e)||(this._selectWordAtCursor(e,!1)&&this.refresh(!0),this._fireEventIfSelectionChanged())}_getWordAt(e,t,i=!0,s=!0){if(e[0]>=this._bufferService.cols)return;let r=this._bufferService.buffer,o=r.lines.get(e[1]);if(!o)return;let n=r.translateBufferLineToString(e[1],!1),a=this._convertViewportColToCharacterIndex(o,e[0]),h=a,l=e[0]-a,c=0,d=0,p=0,f=0;if(n.charAt(a)===" "){for(;a>0&&n.charAt(a-1)===" ";)a--;for(;h<n.length&&n.charAt(h+1)===" ";)h++}else{let C=e[0],k=e[0];o.getWidth(C)===0&&(c++,C--),o.getWidth(k)===2&&(d++,k++);let R=o.getString(k).length;for(R>1&&(f+=R-1,h+=R-1);C>0&&a>0&&!this._isCharWordSeparator(o.loadCell(C-1,this._workCell));){o.loadCell(C-1,this._workCell);let T=this._workCell.getChars().length;this._workCell.getWidth()===0?(c++,C--):T>1&&(p+=T-1,a-=T-1),a--,C--}for(;k<o.length&&h+1<n.length&&!this._isCharWordSeparator(o.loadCell(k+1,this._workCell));){o.loadCell(k+1,this._workCell);let T=this._workCell.getChars().length;this._workCell.getWidth()===2?(d++,k++):T>1&&(f+=T-1,h+=T-1),h++,k++}}h++;let m=a+l-c+p,_=Math.min(this._bufferService.cols,h-a+c+d-p-f);if(!(!t&&n.slice(a,h).trim()==="")){if(i&&m===0&&o.getCodePoint(0)!==32){let C=r.lines.get(e[1]-1);if(C&&o.isWrapped&&C.getCodePoint(this._bufferService.cols-1)!==32){let k=this._getWordAt([this._bufferService.cols-1,e[1]-1],!1,!0,!1);if(k){let R=this._bufferService.cols-k.start;m-=R,_+=R}}}if(s&&m+_===this._bufferService.cols&&o.getCodePoint(this._bufferService.cols-1)!==32){let C=r.lines.get(e[1]+1);if(C?.isWrapped&&C.getCodePoint(0)!==32){let k=this._getWordAt([0,e[1]+1],!1,!1,!0);k&&(_+=k.length)}}return{start:m,length:_}}}_selectWordAt(e,t){let i=this._getWordAt(e,t);if(i){for(;i.start<0;)i.start+=this._bufferService.cols,e[1]--;this._model.selectionStart=[i.start,e[1]],this._model.selectionStartLength=i.length}}_selectToWordAt(e){let t=this._getWordAt(e,!0);if(t){let i=e[1];for(;t.start<0;)t.start+=this._bufferService.cols,i--;if(!this._model.areSelectionValuesReversed())for(;t.start+t.length>this._bufferService.cols;)t.length-=this._bufferService.cols,i++;this._model.selectionEnd=[this._model.areSelectionValuesReversed()?t.start:t.start+t.length,i]}}_isCharWordSeparator(e){return e.getWidth()===0?!1:this._optionsService.rawOptions.wordSeparator.indexOf(e.getChars())>=0}_selectLineAt(e){let t=this._bufferService.buffer.getWrappedRangeForLine(e),i={start:{x:0,y:t.first},end:{x:this._bufferService.cols-1,y:t.last}};this._model.selectionStart=[0,t.first],this._model.selectionEnd=void 0,this._model.selectionStartLength=Hc(i,this._bufferService.cols)}};tl=we([z(3,Ze),z(4,Ji),z(5,ul),z(6,Qe),z(7,ti),z(8,ei)],tl);Fc=class{constructor(){this._data={}}set(e,t,i){this._data[e]||(this._data[e]={}),this._data[e][t]=i}get(e,t){return this._data[e]?this._data[e][t]:void 0}clear(){this._data={}}},Wc=class{constructor(){this._color=new Fc,this._css=new Fc}setCss(e,t,i){this._css.set(e,t,i)}getCss(e,t){return this._css.get(e,t)}setColor(e,t,i){this._color.set(e,t,i)}getColor(e,t){return this._color.get(e,t)}clear(){this._color.clear(),this._css.clear()}},Te=Object.freeze((()=>{let e=[be.toColor("#2e3436"),be.toColor("#cc0000"),be.toColor("#4e9a06"),be.toColor("#c4a000"),be.toColor("#3465a4"),be.toColor("#75507b"),be.toColor("#06989a"),be.toColor("#d3d7cf"),be.toColor("#555753"),be.toColor("#ef2929"),be.toColor("#8ae234"),be.toColor("#fce94f"),be.toColor("#729fcf"),be.toColor("#ad7fa8"),be.toColor("#34e2e2"),be.toColor("#eeeeec")],t=[0,95,135,175,215,255];for(let i=0;i<216;i++){let s=t[i/36%6|0],r=t[i/6%6|0],o=t[i%6];e.push({css:Ae.toCss(s,r,o),rgba:Ae.toRgba(s,r,o)})}for(let i=0;i<24;i++){let s=8+i*10;e.push({css:Ae.toCss(s,s,s),rgba:Ae.toRgba(s,s,s)})}return e})()),qi=be.toColor("#ffffff"),vr=be.toColor("#000000"),Vc=be.toColor("#ffffff"),Uc=vr,ur={css:"rgba(255, 255, 255, 0.3)",rgba:4294967117},uv=qi,il=class extends G{constructor(e){super(),this._optionsService=e,this._contrastCache=new Wc,this._halfContrastCache=new Wc,this._onChangeColors=this._register(new M),this.onChangeColors=this._onChangeColors.event,this._colors={foreground:qi,background:vr,cursor:Vc,cursorAccent:Uc,selectionForeground:void 0,selectionBackgroundTransparent:ur,selectionBackgroundOpaque:fe.blend(vr,ur),selectionInactiveBackgroundTransparent:ur,selectionInactiveBackgroundOpaque:fe.blend(vr,ur),scrollbarSliderBackground:fe.opacity(qi,.2),scrollbarSliderHoverBackground:fe.opacity(qi,.4),scrollbarSliderActiveBackground:fe.opacity(qi,.5),overviewRulerBorder:qi,ansi:Te.slice(),contrastCache:this._contrastCache,halfContrastCache:this._halfContrastCache},this._updateRestoreColors(),this._setTheme(this._optionsService.rawOptions.theme),this._register(this._optionsService.onSpecificOptionChange("minimumContrastRatio",()=>this._contrastCache.clear())),this._register(this._optionsService.onSpecificOptionChange("theme",()=>this._setTheme(this._optionsService.rawOptions.theme)))}get colors(){return this._colors}_setTheme(e={}){let t=this._colors;if(t.foreground=ue(e.foreground,qi),t.background=ue(e.background,vr),t.cursor=fe.blend(t.background,ue(e.cursor,Vc)),t.cursorAccent=fe.blend(t.background,ue(e.cursorAccent,Uc)),t.selectionBackgroundTransparent=ue(e.selectionBackground,ur),t.selectionBackgroundOpaque=fe.blend(t.background,t.selectionBackgroundTransparent),t.selectionInactiveBackgroundTransparent=ue(e.selectionInactiveBackground,t.selectionBackgroundTransparent),t.selectionInactiveBackgroundOpaque=fe.blend(t.background,t.selectionInactiveBackgroundTransparent),t.selectionForeground=e.selectionForeground?ue(e.selectionForeground,Ic):void 0,t.selectionForeground===Ic&&(t.selectionForeground=void 0),fe.isOpaque(t.selectionBackgroundTransparent)&&(t.selectionBackgroundTransparent=fe.opacity(t.selectionBackgroundTransparent,.3)),fe.isOpaque(t.selectionInactiveBackgroundTransparent)&&(t.selectionInactiveBackgroundTransparent=fe.opacity(t.selectionInactiveBackgroundTransparent,.3)),t.scrollbarSliderBackground=ue(e.scrollbarSliderBackground,fe.opacity(t.foreground,.2)),t.scrollbarSliderHoverBackground=ue(e.scrollbarSliderHoverBackground,fe.opacity(t.foreground,.4)),t.scrollbarSliderActiveBackground=ue(e.scrollbarSliderActiveBackground,fe.opacity(t.foreground,.5)),t.overviewRulerBorder=ue(e.overviewRulerBorder,uv),t.ansi=Te.slice(),t.ansi[0]=ue(e.black,Te[0]),t.ansi[1]=ue(e.red,Te[1]),t.ansi[2]=ue(e.green,Te[2]),t.ansi[3]=ue(e.yellow,Te[3]),t.ansi[4]=ue(e.blue,Te[4]),t.ansi[5]=ue(e.magenta,Te[5]),t.ansi[6]=ue(e.cyan,Te[6]),t.ansi[7]=ue(e.white,Te[7]),t.ansi[8]=ue(e.brightBlack,Te[8]),t.ansi[9]=ue(e.brightRed,Te[9]),t.ansi[10]=ue(e.brightGreen,Te[10]),t.ansi[11]=ue(e.brightYellow,Te[11]),t.ansi[12]=ue(e.brightBlue,Te[12]),t.ansi[13]=ue(e.brightMagenta,Te[13]),t.ansi[14]=ue(e.brightCyan,Te[14]),t.ansi[15]=ue(e.brightWhite,Te[15]),e.extendedAnsi){let i=Math.min(t.ansi.length-16,e.extendedAnsi.length);for(let s=0;s<i;s++)t.ansi[s+16]=ue(e.extendedAnsi[s],Te[s+16])}this._contrastCache.clear(),this._halfContrastCache.clear(),this._updateRestoreColors(),this._onChangeColors.fire(this.colors)}restoreColor(e){this._restoreColor(e),this._onChangeColors.fire(this.colors)}_restoreColor(e){if(e===void 0){for(let t=0;t<this._restoreColors.ansi.length;++t)this._colors.ansi[t]=this._restoreColors.ansi[t];return}switch(e){case 256:this._colors.foreground=this._restoreColors.foreground;break;case 257:this._colors.background=this._restoreColors.background;break;case 258:this._colors.cursor=this._restoreColors.cursor;break;default:this._colors.ansi[e]=this._restoreColors.ansi[e]}}modifyColors(e){e(this._colors),this._onChangeColors.fire(this.colors)}_updateRestoreColors(){this._restoreColors={foreground:this._colors.foreground,background:this._colors.background,cursor:this._colors.cursor,ansi:this._colors.ansi.slice()}}};il=we([z(0,Qe)],il);pv=class{constructor(...e){this._entries=new Map;for(let[t,i]of e)this.set(t,i)}set(e,t){let i=this._entries.get(e);return this._entries.set(e,t),i}forEach(e){for(let[t,i]of this._entries.entries())e(t,i)}has(e){return this._entries.has(e)}get(e){return this._entries.get(e)}},fv=class{constructor(){this._services=new pv,this._services.set(dl,this)}setService(e,t){this._services.set(e,t)}getService(e){return this._services.get(e)}createInstance(e,...t){let i=Bm(e).sort((o,n)=>o.index-n.index),s=[];for(let o of i){let n=this._services.get(o.id);if(!n)throw new Error(`[createInstance] ${e.name} depends on UNKNOWN service ${o.id._id}.`);s.push(n)}let r=i.length>0?i[0].index:t.length;if(t.length!==r)throw new Error(`[createInstance] First service dependency of ${e.name} at position ${r+1} conflicts with ${t.length} static arguments`);return new e(...t,...s)}},mv={trace:0,debug:1,info:2,warn:3,error:4,off:5},_v="xterm.js: ",sl=class extends G{constructor(e){super(),this._optionsService=e,this._logLevel=5,this._updateLogLevel(),this._register(this._optionsService.onSpecificOptionChange("logLevel",()=>this._updateLogLevel())),gv=this}get logLevel(){return this._logLevel}_updateLogLevel(){this._logLevel=mv[this._optionsService.rawOptions.logLevel]}_evalLazyOptionalParams(e){for(let t=0;t<e.length;t++)typeof e[t]=="function"&&(e[t]=e[t]())}_log(e,t,i){this._evalLazyOptionalParams(i),e.call(console,(this._optionsService.options.logger?"":_v)+t,...i)}trace(e,...t){this._logLevel<=0&&this._log(this._optionsService.options.logger?.trace.bind(this._optionsService.options.logger)??console.log,e,t)}debug(e,...t){this._logLevel<=1&&this._log(this._optionsService.options.logger?.debug.bind(this._optionsService.options.logger)??console.log,e,t)}info(e,...t){this._logLevel<=2&&this._log(this._optionsService.options.logger?.info.bind(this._optionsService.options.logger)??console.info,e,t)}warn(e,...t){this._logLevel<=3&&this._log(this._optionsService.options.logger?.warn.bind(this._optionsService.options.logger)??console.warn,e,t)}error(e,...t){this._logLevel<=4&&this._log(this._optionsService.options.logger?.error.bind(this._optionsService.options.logger)??console.error,e,t)}};sl=we([z(0,Qe)],sl);qc=class extends G{constructor(e){super(),this._maxLength=e,this.onDeleteEmitter=this._register(new M),this.onDelete=this.onDeleteEmitter.event,this.onInsertEmitter=this._register(new M),this.onInsert=this.onInsertEmitter.event,this.onTrimEmitter=this._register(new M),this.onTrim=this.onTrimEmitter.event,this._array=new Array(this._maxLength),this._startIndex=0,this._length=0}get maxLength(){return this._maxLength}set maxLength(e){if(this._maxLength===e)return;let t=new Array(e);for(let i=0;i<Math.min(e,this.length);i++)t[i]=this._array[this._getCyclicIndex(i)];this._array=t,this._maxLength=e,this._startIndex=0}get length(){return this._length}set length(e){if(e>this._length)for(let t=this._length;t<e;t++)this._array[t]=void 0;this._length=e}get(e){return this._array[this._getCyclicIndex(e)]}set(e,t){this._array[this._getCyclicIndex(e)]=t}push(e){this._array[this._getCyclicIndex(this._length)]=e,this._length===this._maxLength?(this._startIndex=++this._startIndex%this._maxLength,this.onTrimEmitter.fire(1)):this._length++}recycle(){if(this._length!==this._maxLength)throw new Error("Can only recycle when the buffer is full");return this._startIndex=++this._startIndex%this._maxLength,this.onTrimEmitter.fire(1),this._array[this._getCyclicIndex(this._length-1)]}get isFull(){return this._length===this._maxLength}pop(){return this._array[this._getCyclicIndex(this._length---1)]}splice(e,t,...i){if(t){for(let s=e;s<this._length-t;s++)this._array[this._getCyclicIndex(s)]=this._array[this._getCyclicIndex(s+t)];this._length-=t,this.onDeleteEmitter.fire({index:e,amount:t})}for(let s=this._length-1;s>=e;s--)this._array[this._getCyclicIndex(s+i.length)]=this._array[this._getCyclicIndex(s)];for(let s=0;s<i.length;s++)this._array[this._getCyclicIndex(e+s)]=i[s];if(i.length&&this.onInsertEmitter.fire({index:e,amount:i.length}),this._length+i.length>this._maxLength){let s=this._length+i.length-this._maxLength;this._startIndex+=s,this._length=this._maxLength,this.onTrimEmitter.fire(s)}else this._length+=i.length}trimStart(e){e>this._length&&(e=this._length),this._startIndex+=e,this._length-=e,this.onTrimEmitter.fire(e)}shiftElements(e,t,i){if(!(t<=0)){if(e<0||e>=this._length)throw new Error("start argument out of range");if(e+i<0)throw new Error("Cannot shift elements in list beyond index 0");if(i>0){for(let r=t-1;r>=0;r--)this.set(e+r+i,this.get(e+r));let s=e+t+i-this._length;if(s>0)for(this._length+=s;this._length>this._maxLength;)this._length--,this._startIndex++,this.onTrimEmitter.fire(1)}else for(let s=0;s<t;s++)this.set(e+s+i,this.get(e+s))}}_getCyclicIndex(e){return(this._startIndex+e)%this._maxLength}},Z=3,Ee=Object.freeze(new $r),wo=0,wa=2,br=class ou{constructor(t,i,s=!1){this.isWrapped=s,this._combined={},this._extendedAttrs={},this._data=new Uint32Array(t*Z);let r=i||bt.fromCharData([0,md,1,0]);for(let o=0;o<t;++o)this.setCell(o,r);this.length=t}get(t){let i=this._data[t*Z+0],s=i&2097151;return[this._data[t*Z+1],i&2097152?this._combined[t]:s?vi(s):"",i>>22,i&2097152?this._combined[t].charCodeAt(this._combined[t].length-1):s]}set(t,i){this._data[t*Z+1]=i[0],i[1].length>1?(this._combined[t]=i[1],this._data[t*Z+0]=t|2097152|i[2]<<22):this._data[t*Z+0]=i[1].charCodeAt(0)|i[2]<<22}getWidth(t){return this._data[t*Z+0]>>22}hasWidth(t){return this._data[t*Z+0]&12582912}getFg(t){return this._data[t*Z+1]}getBg(t){return this._data[t*Z+2]}hasContent(t){return this._data[t*Z+0]&4194303}getCodePoint(t){let i=this._data[t*Z+0];return i&2097152?this._combined[t].charCodeAt(this._combined[t].length-1):i&2097151}isCombined(t){return this._data[t*Z+0]&2097152}getString(t){let i=this._data[t*Z+0];return i&2097152?this._combined[t]:i&2097151?vi(i&2097151):""}isProtected(t){return this._data[t*Z+2]&536870912}loadCell(t,i){return wo=t*Z,i.content=this._data[wo+0],i.fg=this._data[wo+1],i.bg=this._data[wo+2],i.content&2097152&&(i.combinedData=this._combined[t]),i.bg&268435456&&(i.extended=this._extendedAttrs[t]),i}setCell(t,i){i.content&2097152&&(this._combined[t]=i.combinedData),i.bg&268435456&&(this._extendedAttrs[t]=i.extended),this._data[t*Z+0]=i.content,this._data[t*Z+1]=i.fg,this._data[t*Z+2]=i.bg}setCellFromCodepoint(t,i,s,r){r.bg&268435456&&(this._extendedAttrs[t]=r.extended),this._data[t*Z+0]=i|s<<22,this._data[t*Z+1]=r.fg,this._data[t*Z+2]=r.bg}addCodepointToCell(t,i,s){let r=this._data[t*Z+0];r&2097152?this._combined[t]+=vi(i):r&2097151?(this._combined[t]=vi(r&2097151)+vi(i),r&=-2097152,r|=2097152):r=i|1<<22,s&&(r&=-12582913,r|=s<<22),this._data[t*Z+0]=r}insertCells(t,i,s){if(t%=this.length,t&&this.getWidth(t-1)===2&&this.setCellFromCodepoint(t-1,0,1,s),i<this.length-t){let r=new bt;for(let o=this.length-t-i-1;o>=0;--o)this.setCell(t+i+o,this.loadCell(t+o,r));for(let o=0;o<i;++o)this.setCell(t+o,s)}else for(let r=t;r<this.length;++r)this.setCell(r,s);this.getWidth(this.length-1)===2&&this.setCellFromCodepoint(this.length-1,0,1,s)}deleteCells(t,i,s){if(t%=this.length,i<this.length-t){let r=new bt;for(let o=0;o<this.length-t-i;++o)this.setCell(t+o,this.loadCell(t+i+o,r));for(let o=this.length-i;o<this.length;++o)this.setCell(o,s)}else for(let r=t;r<this.length;++r)this.setCell(r,s);t&&this.getWidth(t-1)===2&&this.setCellFromCodepoint(t-1,0,1,s),this.getWidth(t)===0&&!this.hasContent(t)&&this.setCellFromCodepoint(t,0,1,s)}replaceCells(t,i,s,r=!1){if(r){for(t&&this.getWidth(t-1)===2&&!this.isProtected(t-1)&&this.setCellFromCodepoint(t-1,0,1,s),i<this.length&&this.getWidth(i-1)===2&&!this.isProtected(i)&&this.setCellFromCodepoint(i,0,1,s);t<i&&t<this.length;)this.isProtected(t)||this.setCell(t,s),t++;return}for(t&&this.getWidth(t-1)===2&&this.setCellFromCodepoint(t-1,0,1,s),i<this.length&&this.getWidth(i-1)===2&&this.setCellFromCodepoint(i,0,1,s);t<i&&t<this.length;)this.setCell(t++,s)}resize(t,i){if(t===this.length)return this._data.length*4*wa<this._data.buffer.byteLength;let s=t*Z;if(t>this.length){if(this._data.buffer.byteLength>=s*4)this._data=new Uint32Array(this._data.buffer,0,s);else{let r=new Uint32Array(s);r.set(this._data),this._data=r}for(let r=this.length;r<t;++r)this.setCell(r,i)}else{this._data=this._data.subarray(0,s);let r=Object.keys(this._combined);for(let n=0;n<r.length;n++){let a=parseInt(r[n],10);a>=t&&delete this._combined[a]}let o=Object.keys(this._extendedAttrs);for(let n=0;n<o.length;n++){let a=parseInt(o[n],10);a>=t&&delete this._extendedAttrs[a]}}return this.length=t,s*4*wa<this._data.buffer.byteLength}cleanupMemory(){if(this._data.length*4*wa<this._data.buffer.byteLength){let t=new Uint32Array(this._data.length);return t.set(this._data),this._data=t,1}return 0}fill(t,i=!1){if(i){for(let s=0;s<this.length;++s)this.isProtected(s)||this.setCell(s,t);return}this._combined={},this._extendedAttrs={};for(let s=0;s<this.length;++s)this.setCell(s,t)}copyFrom(t){this.length!==t.length?this._data=new Uint32Array(t._data):this._data.set(t._data),this.length=t.length,this._combined={};for(let i in t._combined)this._combined[i]=t._combined[i];this._extendedAttrs={};for(let i in t._extendedAttrs)this._extendedAttrs[i]=t._extendedAttrs[i];this.isWrapped=t.isWrapped}clone(){let t=new ou(0);t._data=new Uint32Array(this._data),t.length=this.length;for(let i in this._combined)t._combined[i]=this._combined[i];for(let i in this._extendedAttrs)t._extendedAttrs[i]=this._extendedAttrs[i];return t.isWrapped=this.isWrapped,t}getTrimmedLength(){for(let t=this.length-1;t>=0;--t)if(this._data[t*Z+0]&4194303)return t+(this._data[t*Z+0]>>22);return 0}getNoBgTrimmedLength(){for(let t=this.length-1;t>=0;--t)if(this._data[t*Z+0]&4194303||this._data[t*Z+2]&50331648)return t+(this._data[t*Z+0]>>22);return 0}copyCellsFrom(t,i,s,r,o){let n=t._data;if(o)for(let h=r-1;h>=0;h--){for(let l=0;l<Z;l++)this._data[(s+h)*Z+l]=n[(i+h)*Z+l];n[(i+h)*Z+2]&268435456&&(this._extendedAttrs[s+h]=t._extendedAttrs[i+h])}else for(let h=0;h<r;h++){for(let l=0;l<Z;l++)this._data[(s+h)*Z+l]=n[(i+h)*Z+l];n[(i+h)*Z+2]&268435456&&(this._extendedAttrs[s+h]=t._extendedAttrs[i+h])}let a=Object.keys(t._combined);for(let h=0;h<a.length;h++){let l=parseInt(a[h],10);l>=i&&(this._combined[l-i+s]=t._combined[l])}}translateToString(t,i,s,r){i=i??0,s=s??this.length,t&&(s=Math.min(s,this.getTrimmedLength())),r&&(r.length=0);let o="";for(;i<s;){let n=this._data[i*Z+0],a=n&2097151,h=n&2097152?this._combined[i]:a?vi(a):bi;if(o+=h,r)for(let l=0;l<h.length;++l)r.push(i);i+=n>>22||1}return r&&r.push(i),o}};nu=class au{constructor(t){this.line=t,this.isDisposed=!1,this._disposables=[],this._id=au._nextId++,this._onDispose=this.register(new M),this.onDispose=this._onDispose.event}get id(){return this._id}dispose(){this.isDisposed||(this.isDisposed=!0,this.line=-1,this._onDispose.fire(),Gi(this._disposables),this._disposables.length=0)}register(t){return this._disposables.push(t),t}};nu._nextId=1;Sv=nu,De={},Ki=De.B;De[0]={"`":"\u25C6",a:"\u2592",b:"\u2409",c:"\u240C",d:"\u240D",e:"\u240A",f:"\xB0",g:"\xB1",h:"\u2424",i:"\u240B",j:"\u2518",k:"\u2510",l:"\u250C",m:"\u2514",n:"\u253C",o:"\u23BA",p:"\u23BB",q:"\u2500",r:"\u23BC",s:"\u23BD",t:"\u251C",u:"\u2524",v:"\u2534",w:"\u252C",x:"\u2502",y:"\u2264",z:"\u2265","{":"\u03C0","|":"\u2260","}":"\xA3","~":"\xB7"};De.A={"#":"\xA3"};De.B=void 0;De[4]={"#":"\xA3","@":"\xBE","[":"ij","\\":"\xBD","]":"|","{":"\xA8","|":"f","}":"\xBC","~":"\xB4"};De.C=De[5]={"[":"\xC4","\\":"\xD6","]":"\xC5","^":"\xDC","`":"\xE9","{":"\xE4","|":"\xF6","}":"\xE5","~":"\xFC"};De.R={"#":"\xA3","@":"\xE0","[":"\xB0","\\":"\xE7","]":"\xA7","{":"\xE9","|":"\xF9","}":"\xE8","~":"\xA8"};De.Q={"@":"\xE0","[":"\xE2","\\":"\xE7","]":"\xEA","^":"\xEE","`":"\xF4","{":"\xE9","|":"\xF9","}":"\xE8","~":"\xFB"};De.K={"@":"\xA7","[":"\xC4","\\":"\xD6","]":"\xDC","{":"\xE4","|":"\xF6","}":"\xFC","~":"\xDF"};De.Y={"#":"\xA3","@":"\xA7","[":"\xB0","\\":"\xE7","]":"\xE9","`":"\xF9","{":"\xE0","|":"\xF2","}":"\xE8","~":"\xEC"};De.E=De[6]={"@":"\xC4","[":"\xC6","\\":"\xD8","]":"\xC5","^":"\xDC","`":"\xE4","{":"\xE6","|":"\xF8","}":"\xE5","~":"\xFC"};De.Z={"#":"\xA3","@":"\xA7","[":"\xA1","\\":"\xD1","]":"\xBF","{":"\xB0","|":"\xF1","}":"\xE7"};De.H=De[7]={"@":"\xC9","[":"\xC4","\\":"\xD6","]":"\xC5","^":"\xDC","`":"\xE9","{":"\xE4","|":"\xF6","}":"\xE5","~":"\xFC"};De["="]={"#":"\xF9","@":"\xE0","[":"\xE9","\\":"\xE7","]":"\xEA","^":"\xEE",_:"\xE8","`":"\xF4","{":"\xE4","|":"\xF6","}":"\xFC","~":"\xFB"};Kc=4294967295,jc=class{constructor(e,t,i){this._hasScrollback=e,this._optionsService=t,this._bufferService=i,this.ydisp=0,this.ybase=0,this.y=0,this.x=0,this.tabs={},this.savedY=0,this.savedX=0,this.savedCurAttrData=Ee.clone(),this.savedCharset=Ki,this.markers=[],this._nullCell=bt.fromCharData([0,md,1,0]),this._whitespaceCell=bt.fromCharData([0,bi,1,32]),this._isClearing=!1,this._memoryCleanupQueue=new No,this._memoryCleanupPosition=0,this._cols=this._bufferService.cols,this._rows=this._bufferService.rows,this.lines=new qc(this._getCorrectBufferLength(this._rows)),this.scrollTop=0,this.scrollBottom=this._rows-1,this.setupTabStops()}getNullCell(e){return e?(this._nullCell.fg=e.fg,this._nullCell.bg=e.bg,this._nullCell.extended=e.extended):(this._nullCell.fg=0,this._nullCell.bg=0,this._nullCell.extended=new Ro),this._nullCell}getWhitespaceCell(e){return e?(this._whitespaceCell.fg=e.fg,this._whitespaceCell.bg=e.bg,this._whitespaceCell.extended=e.extended):(this._whitespaceCell.fg=0,this._whitespaceCell.bg=0,this._whitespaceCell.extended=new Ro),this._whitespaceCell}getBlankLine(e,t){return new br(this._bufferService.cols,this.getNullCell(e),t)}get hasScrollback(){return this._hasScrollback&&this.lines.maxLength>this._rows}get isCursorInViewport(){let e=this.ybase+this.y-this.ydisp;return e>=0&&e<this._rows}_getCorrectBufferLength(e){if(!this._hasScrollback)return e;let t=e+this._optionsService.rawOptions.scrollback;return t>Kc?Kc:t}fillViewportRows(e){if(this.lines.length===0){e===void 0&&(e=Ee);let t=this._rows;for(;t--;)this.lines.push(this.getBlankLine(e))}}clear(){this.ydisp=0,this.ybase=0,this.y=0,this.x=0,this.lines=new qc(this._getCorrectBufferLength(this._rows)),this.scrollTop=0,this.scrollBottom=this._rows-1,this.setupTabStops()}resize(e,t){let i=this.getNullCell(Ee),s=0,r=this._getCorrectBufferLength(t);if(r>this.lines.maxLength&&(this.lines.maxLength=r),this.lines.length>0){if(this._cols<e)for(let n=0;n<this.lines.length;n++)s+=+this.lines.get(n).resize(e,i);let o=0;if(this._rows<t)for(let n=this._rows;n<t;n++)this.lines.length<t+this.ybase&&(this._optionsService.rawOptions.windowsMode||this._optionsService.rawOptions.windowsPty.backend!==void 0||this._optionsService.rawOptions.windowsPty.buildNumber!==void 0?this.lines.push(new br(e,i)):this.ybase>0&&this.lines.length<=this.ybase+this.y+o+1?(this.ybase--,o++,this.ydisp>0&&this.ydisp--):this.lines.push(new br(e,i)));else for(let n=this._rows;n>t;n--)this.lines.length>t+this.ybase&&(this.lines.length>this.ybase+this.y+1?this.lines.pop():(this.ybase++,this.ydisp++));if(r<this.lines.maxLength){let n=this.lines.length-r;n>0&&(this.lines.trimStart(n),this.ybase=Math.max(this.ybase-n,0),this.ydisp=Math.max(this.ydisp-n,0),this.savedY=Math.max(this.savedY-n,0)),this.lines.maxLength=r}this.x=Math.min(this.x,e-1),this.y=Math.min(this.y,t-1),o&&(this.y+=o),this.savedX=Math.min(this.savedX,e-1),this.scrollTop=0}if(this.scrollBottom=t-1,this._isReflowEnabled&&(this._reflow(e,t),this._cols>e))for(let o=0;o<this.lines.length;o++)s+=+this.lines.get(o).resize(e,i);this._cols=e,this._rows=t,this._memoryCleanupQueue.clear(),s>.1*this.lines.length&&(this._memoryCleanupPosition=0,this._memoryCleanupQueue.enqueue(()=>this._batchedMemoryCleanup()))}_batchedMemoryCleanup(){let e=!0;this._memoryCleanupPosition>=this.lines.length&&(this._memoryCleanupPosition=0,e=!1);let t=0;for(;this._memoryCleanupPosition<this.lines.length;)if(t+=this.lines.get(this._memoryCleanupPosition++).cleanupMemory(),t>100)return!0;return e}get _isReflowEnabled(){let e=this._optionsService.rawOptions.windowsPty;return e&&e.buildNumber?this._hasScrollback&&e.backend==="conpty"&&e.buildNumber>=21376:this._hasScrollback&&!this._optionsService.rawOptions.windowsMode}_reflow(e,t){this._cols!==e&&(e>this._cols?this._reflowLarger(e,t):this._reflowSmaller(e,t))}_reflowLarger(e,t){let i=this._optionsService.rawOptions.reflowCursorLine,s=vv(this.lines,this._cols,e,this.ybase+this.y,this.getNullCell(Ee),i);if(s.length>0){let r=bv(this.lines,s);yv(this.lines,r.layout),this._reflowLargerAdjustViewport(e,t,r.countRemoved)}}_reflowLargerAdjustViewport(e,t,i){let s=this.getNullCell(Ee),r=i;for(;r-- >0;)this.ybase===0?(this.y>0&&this.y--,this.lines.length<t&&this.lines.push(new br(e,s))):(this.ydisp===this.ybase&&this.ydisp--,this.ybase--);this.savedY=Math.max(this.savedY-i,0)}_reflowSmaller(e,t){let i=this._optionsService.rawOptions.reflowCursorLine,s=this.getNullCell(Ee),r=[],o=0;for(let n=this.lines.length-1;n>=0;n--){let a=this.lines.get(n);if(!a||!a.isWrapped&&a.getTrimmedLength()<=e)continue;let h=[a];for(;a.isWrapped&&n>0;)a=this.lines.get(--n),h.unshift(a);if(!i){let T=this.ybase+this.y;if(T>=n&&T<n+h.length)continue}let l=h[h.length-1].getTrimmedLength(),c=wv(h,this._cols,e),d=c.length-h.length,p;this.ybase===0&&this.y!==this.lines.length-1?p=Math.max(0,this.y-this.lines.maxLength+d):p=Math.max(0,this.lines.length-this.lines.maxLength+d);let f=[];for(let T=0;T<d;T++){let y=this.getBlankLine(Ee,!0);f.push(y)}f.length>0&&(r.push({start:n+h.length+o,newLines:f}),o+=f.length),h.push(...f);let m=c.length-1,_=c[m];_===0&&(m--,_=c[m]);let C=h.length-d-1,k=l;for(;C>=0;){let T=Math.min(k,_);if(h[m]===void 0)break;if(h[m].copyCellsFrom(h[C],k-T,_-T,T,!0),_-=T,_===0&&(m--,_=c[m]),k-=T,k===0){C--;let y=Math.max(C,0);k=Ar(h,y,this._cols)}}for(let T=0;T<h.length;T++)c[T]<e&&h[T].setCell(c[T],s);let R=d-p;for(;R-- >0;)this.ybase===0?this.y<t-1?(this.y++,this.lines.pop()):(this.ybase++,this.ydisp++):this.ybase<Math.min(this.lines.maxLength,this.lines.length+o)-t&&(this.ybase===this.ydisp&&this.ydisp++,this.ybase++);this.savedY=Math.min(this.savedY+d,this.ybase+t-1)}if(r.length>0){let n=[],a=[];for(let _=0;_<this.lines.length;_++)a.push(this.lines.get(_));let h=this.lines.length,l=h-1,c=0,d=r[c];this.lines.length=Math.min(this.lines.maxLength,this.lines.length+o);let p=0;for(let _=Math.min(this.lines.maxLength-1,h+o-1);_>=0;_--)if(d&&d.start>l+p){for(let C=d.newLines.length-1;C>=0;C--)this.lines.set(_--,d.newLines[C]);_++,n.push({index:l+1,amount:d.newLines.length}),p+=d.newLines.length,d=r[++c]}else this.lines.set(_,a[l--]);let f=0;for(let _=n.length-1;_>=0;_--)n[_].index+=f,this.lines.onInsertEmitter.fire(n[_]),f+=n[_].amount;let m=Math.max(0,h+o-this.lines.maxLength);m>0&&this.lines.onTrimEmitter.fire(m)}}translateBufferLineToString(e,t,i=0,s){let r=this.lines.get(e);return r?r.translateToString(t,i,s):""}getWrappedRangeForLine(e){let t=e,i=e;for(;t>0&&this.lines.get(t).isWrapped;)t--;for(;i+1<this.lines.length&&this.lines.get(i+1).isWrapped;)i++;return{first:t,last:i}}setupTabStops(e){for(e!=null?this.tabs[e]||(e=this.prevStop(e)):(this.tabs={},e=0);e<this._cols;e+=this._optionsService.rawOptions.tabStopWidth)this.tabs[e]=!0}prevStop(e){for(e==null&&(e=this.x);!this.tabs[--e]&&e>0;);return e>=this._cols?this._cols-1:e<0?0:e}nextStop(e){for(e==null&&(e=this.x);!this.tabs[++e]&&e<this._cols;);return e>=this._cols?this._cols-1:e<0?0:e}clearMarkers(e){this._isClearing=!0;for(let t=0;t<this.markers.length;t++)this.markers[t].line===e&&(this.markers[t].dispose(),this.markers.splice(t--,1));this._isClearing=!1}clearAllMarkers(){this._isClearing=!0;for(let e=0;e<this.markers.length;e++)this.markers[e].dispose();this.markers.length=0,this._isClearing=!1}addMarker(e){let t=new Sv(e);return this.markers.push(t),t.register(this.lines.onTrim(i=>{t.line-=i,t.line<0&&t.dispose()})),t.register(this.lines.onInsert(i=>{t.line>=i.index&&(t.line+=i.amount)})),t.register(this.lines.onDelete(i=>{t.line>=i.index&&t.line<i.index+i.amount&&t.dispose(),t.line>i.index&&(t.line-=i.amount)})),t.register(t.onDispose(()=>this._removeMarker(t))),t}_removeMarker(e){this._isClearing||this.markers.splice(this.markers.indexOf(e),1)}},Cv=class extends G{constructor(e,t){super(),this._optionsService=e,this._bufferService=t,this._onBufferActivate=this._register(new M),this.onBufferActivate=this._onBufferActivate.event,this.reset(),this._register(this._optionsService.onSpecificOptionChange("scrollback",()=>this.resize(this._bufferService.cols,this._bufferService.rows))),this._register(this._optionsService.onSpecificOptionChange("tabStopWidth",()=>this.setupTabStops()))}reset(){this._normal=new jc(!0,this._optionsService,this._bufferService),this._normal.fillViewportRows(),this._alt=new jc(!1,this._optionsService,this._bufferService),this._activeBuffer=this._normal,this._onBufferActivate.fire({activeBuffer:this._normal,inactiveBuffer:this._alt}),this.setupTabStops()}get alt(){return this._alt}get active(){return this._activeBuffer}get normal(){return this._normal}activateNormalBuffer(){this._activeBuffer!==this._normal&&(this._normal.x=this._alt.x,this._normal.y=this._alt.y,this._alt.clearAllMarkers(),this._alt.clear(),this._activeBuffer=this._normal,this._onBufferActivate.fire({activeBuffer:this._normal,inactiveBuffer:this._alt}))}activateAltBuffer(e){this._activeBuffer!==this._alt&&(this._alt.fillViewportRows(e),this._alt.x=this._normal.x,this._alt.y=this._normal.y,this._activeBuffer=this._alt,this._onBufferActivate.fire({activeBuffer:this._alt,inactiveBuffer:this._normal}))}resize(e,t){this._normal.resize(e,t),this._alt.resize(e,t),this.setupTabStops(e)}setupTabStops(e){this._normal.setupTabStops(e),this._alt.setupTabStops(e)}},lu=2,hu=1,rl=class extends G{constructor(e){super(),this.isUserScrolling=!1,this._onResize=this._register(new M),this.onResize=this._onResize.event,this._onScroll=this._register(new M),this.onScroll=this._onScroll.event,this.cols=Math.max(e.rawOptions.cols||0,lu),this.rows=Math.max(e.rawOptions.rows||0,hu),this.buffers=this._register(new Cv(e,this)),this._register(this.buffers.onBufferActivate(t=>{this._onScroll.fire(t.activeBuffer.ydisp)}))}get buffer(){return this.buffers.active}resize(e,t){let i=this.cols!==e,s=this.rows!==t;this.cols=e,this.rows=t,this.buffers.resize(e,t),this._onResize.fire({cols:e,rows:t,colsChanged:i,rowsChanged:s})}reset(){this.buffers.reset(),this.isUserScrolling=!1}scroll(e,t=!1){let i=this.buffer,s;s=this._cachedBlankLine,(!s||s.length!==this.cols||s.getFg(0)!==e.fg||s.getBg(0)!==e.bg)&&(s=i.getBlankLine(e,t),this._cachedBlankLine=s),s.isWrapped=t;let r=i.ybase+i.scrollTop,o=i.ybase+i.scrollBottom;if(i.scrollTop===0){let n=i.lines.isFull;o===i.lines.length-1?n?i.lines.recycle().copyFrom(s):i.lines.push(s.clone()):i.lines.splice(o+1,0,s.clone()),n?this.isUserScrolling&&(i.ydisp=Math.max(i.ydisp-1,0)):(i.ybase++,this.isUserScrolling||i.ydisp++)}else{let n=o-r+1;i.lines.shiftElements(r+1,n-1,-1),i.lines.set(o,s.clone())}this.isUserScrolling||(i.ydisp=i.ybase),this._onScroll.fire(i.ydisp)}scrollLines(e,t){let i=this.buffer;if(e<0){if(i.ydisp===0)return;this.isUserScrolling=!0}else e+i.ydisp>=i.ybase&&(this.isUserScrolling=!1);let s=i.ydisp;i.ydisp=Math.max(Math.min(i.ydisp+e,i.ybase),0),s!==i.ydisp&&(t||this._onScroll.fire(i.ydisp))}};rl=we([z(0,Qe)],rl);ys={cols:80,rows:24,cursorBlink:!1,cursorStyle:"block",cursorWidth:1,cursorInactiveStyle:"outline",customGlyphs:!0,drawBoldTextInBrightColors:!0,documentOverride:null,fastScrollModifier:"alt",fastScrollSensitivity:5,fontFamily:"monospace",fontSize:15,fontWeight:"normal",fontWeightBold:"bold",ignoreBracketedPasteMode:!1,lineHeight:1,letterSpacing:0,linkHandler:null,logLevel:"info",logger:null,scrollback:1e3,scrollOnEraseInDisplay:!1,scrollOnUserInput:!0,scrollSensitivity:1,screenReaderMode:!1,smoothScrollDuration:0,macOptionIsMeta:!1,macOptionClickForcesSelection:!1,minimumContrastRatio:1,disableStdin:!1,allowProposedApi:!1,allowTransparency:!1,tabStopWidth:8,theme:{},reflowCursorLine:!1,rescaleOverlappingGlyphs:!1,rightClickSelectsWord:zo,windowOptions:{},windowsMode:!1,windowsPty:{},wordSeparator:" ()[]{}',\"`",altClickMovesCursor:!0,convertEol:!1,termName:"xterm",cancelEvents:!1,overviewRuler:{}},xv=["normal","bold","100","200","300","400","500","600","700","800","900"],kv=class extends G{constructor(e){super(),this._onOptionChange=this._register(new M),this.onOptionChange=this._onOptionChange.event;let t={...ys};for(let i in e)if(i in t)try{let s=e[i];t[i]=this._sanitizeAndValidateOption(i,s)}catch(s){console.error(s)}this.rawOptions=t,this.options={...t},this._setupOptions(),this._register(me(()=>{this.rawOptions.linkHandler=null,this.rawOptions.documentOverride=null}))}onSpecificOptionChange(e,t){return this.onOptionChange(i=>{i===e&&t(this.rawOptions[e])})}onMultipleOptionChange(e,t){return this.onOptionChange(i=>{e.indexOf(i)!==-1&&t()})}_setupOptions(){let e=i=>{if(!(i in ys))throw new Error(`No option with key "${i}"`);return this.rawOptions[i]},t=(i,s)=>{if(!(i in ys))throw new Error(`No option with key "${i}"`);s=this._sanitizeAndValidateOption(i,s),this.rawOptions[i]!==s&&(this.rawOptions[i]=s,this._onOptionChange.fire(i))};for(let i in this.rawOptions){let s={get:e.bind(this,i),set:t.bind(this,i)};Object.defineProperty(this.options,i,s)}}_sanitizeAndValidateOption(e,t){switch(e){case"cursorStyle":if(t||(t=ys[e]),!Ev(t))throw new Error(`"${t}" is not a valid value for ${e}`);break;case"wordSeparator":t||(t=ys[e]);break;case"fontWeight":case"fontWeightBold":if(typeof t=="number"&&1<=t&&t<=1e3)break;t=xv.includes(t)?t:ys[e];break;case"cursorWidth":t=Math.floor(t);case"lineHeight":case"tabStopWidth":if(t<1)throw new Error(`${e} cannot be less than 1, value: ${t}`);break;case"minimumContrastRatio":t=Math.max(1,Math.min(21,Math.round(t*10)/10));break;case"scrollback":if(t=Math.min(t,4294967295),t<0)throw new Error(`${e} cannot be less than 0, value: ${t}`);break;case"fastScrollSensitivity":case"scrollSensitivity":if(t<=0)throw new Error(`${e} cannot be less than or equal to 0, value: ${t}`);break;case"rows":case"cols":if(!t&&t!==0)throw new Error(`${e} must be numeric, value: ${t}`);break;case"windowsPty":t=t??{};break}return t}};Yc=Object.freeze({insertMode:!1}),Gc=Object.freeze({applicationCursorKeys:!1,applicationKeypad:!1,bracketedPasteMode:!1,cursorBlink:void 0,cursorStyle:void 0,origin:!1,reverseWraparound:!1,sendFocus:!1,synchronizedOutput:!1,wraparound:!0}),ol=class extends G{constructor(e,t,i){super(),this._bufferService=e,this._logService=t,this._optionsService=i,this.isCursorInitialized=!1,this.isCursorHidden=!1,this._onData=this._register(new M),this.onData=this._onData.event,this._onUserInput=this._register(new M),this.onUserInput=this._onUserInput.event,this._onBinary=this._register(new M),this.onBinary=this._onBinary.event,this._onRequestScrollToBottom=this._register(new M),this.onRequestScrollToBottom=this._onRequestScrollToBottom.event,this.modes=yr(Yc),this.decPrivateModes=yr(Gc)}reset(){this.modes=yr(Yc),this.decPrivateModes=yr(Gc)}triggerDataEvent(e,t=!1){if(this._optionsService.rawOptions.disableStdin)return;let i=this._bufferService.buffer;t&&this._optionsService.rawOptions.scrollOnUserInput&&i.ybase!==i.ydisp&&this._onRequestScrollToBottom.fire(),t&&this._onUserInput.fire(),this._logService.debug(`sending data "${e}"`),this._logService.trace("sending data (codes)",()=>e.split("").map(s=>s.charCodeAt(0))),this._onData.fire(e)}triggerBinaryEvent(e){this._optionsService.rawOptions.disableStdin||(this._logService.debug(`sending binary "${e}"`),this._logService.trace("sending binary (codes)",()=>e.split("").map(t=>t.charCodeAt(0))),this._onBinary.fire(e))}};ol=we([z(0,Ze),z(1,yd),z(2,Qe)],ol);Xc={NONE:{events:0,restrict:()=>!1},X10:{events:1,restrict:e=>e.button===4||e.action!==1?!1:(e.ctrl=!1,e.alt=!1,e.shift=!1,!0)},VT200:{events:19,restrict:e=>e.action!==32},DRAG:{events:23,restrict:e=>!(e.action===32&&e.button===3)},ANY:{events:31,restrict:e=>!0}};Ca=String.fromCharCode,Jc={DEFAULT:e=>{let t=[Sa(e,!1)+32,e.col+32,e.row+32];return t[0]>255||t[1]>255||t[2]>255?"":`\x1B[M${Ca(t[0])}${Ca(t[1])}${Ca(t[2])}`},SGR:e=>{let t=e.action===0&&e.button!==4?"m":"M";return`\x1B[<${Sa(e,!0)};${e.col};${e.row}${t}`},SGR_PIXELS:e=>{let t=e.action===0&&e.button!==4?"m":"M";return`\x1B[<${Sa(e,!0)};${e.x};${e.y}${t}`}},nl=class extends G{constructor(e,t,i){super(),this._bufferService=e,this._coreService=t,this._optionsService=i,this._protocols={},this._encodings={},this._activeProtocol="",this._activeEncoding="",this._lastEvent=null,this._wheelPartialScroll=0,this._onProtocolChange=this._register(new M),this.onProtocolChange=this._onProtocolChange.event;for(let s of Object.keys(Xc))this.addProtocol(s,Xc[s]);for(let s of Object.keys(Jc))this.addEncoding(s,Jc[s]);this.reset()}addProtocol(e,t){this._protocols[e]=t}addEncoding(e,t){this._encodings[e]=t}get activeProtocol(){return this._activeProtocol}get areMouseEventsActive(){return this._protocols[this._activeProtocol].events!==0}set activeProtocol(e){if(!this._protocols[e])throw new Error(`unknown protocol "${e}"`);this._activeProtocol=e,this._onProtocolChange.fire(this._protocols[e].events)}get activeEncoding(){return this._activeEncoding}set activeEncoding(e){if(!this._encodings[e])throw new Error(`unknown encoding "${e}"`);this._activeEncoding=e}reset(){this.activeProtocol="NONE",this.activeEncoding="DEFAULT",this._lastEvent=null,this._wheelPartialScroll=0}consumeWheelEvent(e,t,i){if(e.deltaY===0||e.shiftKey||t===void 0||i===void 0)return 0;let s=t/i,r=this._applyScrollModifier(e.deltaY,e);return e.deltaMode===WheelEvent.DOM_DELTA_PIXEL?(r/=s+0,Math.abs(e.deltaY)<50&&(r*=.3),this._wheelPartialScroll+=r,r=Math.floor(Math.abs(this._wheelPartialScroll))*(this._wheelPartialScroll>0?1:-1),this._wheelPartialScroll%=1):e.deltaMode===WheelEvent.DOM_DELTA_PAGE&&(r*=this._bufferService.rows),r}_applyScrollModifier(e,t){return t.altKey||t.ctrlKey||t.shiftKey?e*this._optionsService.rawOptions.fastScrollSensitivity*this._optionsService.rawOptions.scrollSensitivity:e*this._optionsService.rawOptions.scrollSensitivity}triggerMouseEvent(e){if(e.col<0||e.col>=this._bufferService.cols||e.row<0||e.row>=this._bufferService.rows||e.button===4&&e.action===32||e.button===3&&e.action!==32||e.button!==4&&(e.action===2||e.action===3)||(e.col++,e.row++,e.action===32&&this._lastEvent&&this._equalEvents(this._lastEvent,e,this._activeEncoding==="SGR_PIXELS"))||!this._protocols[this._activeProtocol].restrict(e))return!1;let t=this._encodings[this._activeEncoding](e);return t&&(this._activeEncoding==="DEFAULT"?this._coreService.triggerBinaryEvent(t):this._coreService.triggerDataEvent(t,!0)),this._lastEvent=e,!0}explainEvents(e){return{down:!!(e&1),up:!!(e&2),drag:!!(e&4),move:!!(e&8),wheel:!!(e&16)}}_equalEvents(e,t,i){if(i){if(e.x!==t.x||e.y!==t.y)return!1}else if(e.col!==t.col||e.row!==t.row)return!1;return!(e.button!==t.button||e.action!==t.action||e.ctrl!==t.ctrl||e.alt!==t.alt||e.shift!==t.shift)}};nl=we([z(0,Ze),z(1,Ji),z(2,Qe)],nl);xa=[[768,879],[1155,1158],[1160,1161],[1425,1469],[1471,1471],[1473,1474],[1476,1477],[1479,1479],[1536,1539],[1552,1557],[1611,1630],[1648,1648],[1750,1764],[1767,1768],[1770,1773],[1807,1807],[1809,1809],[1840,1866],[1958,1968],[2027,2035],[2305,2306],[2364,2364],[2369,2376],[2381,2381],[2385,2388],[2402,2403],[2433,2433],[2492,2492],[2497,2500],[2509,2509],[2530,2531],[2561,2562],[2620,2620],[2625,2626],[2631,2632],[2635,2637],[2672,2673],[2689,2690],[2748,2748],[2753,2757],[2759,2760],[2765,2765],[2786,2787],[2817,2817],[2876,2876],[2879,2879],[2881,2883],[2893,2893],[2902,2902],[2946,2946],[3008,3008],[3021,3021],[3134,3136],[3142,3144],[3146,3149],[3157,3158],[3260,3260],[3263,3263],[3270,3270],[3276,3277],[3298,3299],[3393,3395],[3405,3405],[3530,3530],[3538,3540],[3542,3542],[3633,3633],[3636,3642],[3655,3662],[3761,3761],[3764,3769],[3771,3772],[3784,3789],[3864,3865],[3893,3893],[3895,3895],[3897,3897],[3953,3966],[3968,3972],[3974,3975],[3984,3991],[3993,4028],[4038,4038],[4141,4144],[4146,4146],[4150,4151],[4153,4153],[4184,4185],[4448,4607],[4959,4959],[5906,5908],[5938,5940],[5970,5971],[6002,6003],[6068,6069],[6071,6077],[6086,6086],[6089,6099],[6109,6109],[6155,6157],[6313,6313],[6432,6434],[6439,6440],[6450,6450],[6457,6459],[6679,6680],[6912,6915],[6964,6964],[6966,6970],[6972,6972],[6978,6978],[7019,7027],[7616,7626],[7678,7679],[8203,8207],[8234,8238],[8288,8291],[8298,8303],[8400,8431],[12330,12335],[12441,12442],[43014,43014],[43019,43019],[43045,43046],[64286,64286],[65024,65039],[65056,65059],[65279,65279],[65529,65531]],Av=[[68097,68099],[68101,68102],[68108,68111],[68152,68154],[68159,68159],[119143,119145],[119155,119170],[119173,119179],[119210,119213],[119362,119364],[917505,917505],[917536,917631],[917760,917999]];Tv=class{constructor(){if(this.version="6",!Le){Le=new Uint8Array(65536),Le.fill(1),Le[0]=0,Le.fill(0,1,32),Le.fill(0,127,160),Le.fill(2,4352,4448),Le[9001]=2,Le[9002]=2,Le.fill(2,11904,42192),Le[12351]=1,Le.fill(2,44032,55204),Le.fill(2,63744,64256),Le.fill(2,65040,65050),Le.fill(2,65072,65136),Le.fill(2,65280,65377),Le.fill(2,65504,65511);for(let e=0;e<xa.length;++e)Le.fill(0,xa[e][0],xa[e][1]+1)}}wcwidth(e){return e<32?0:e<127?1:e<65536?Le[e]:$v(e,Av)?0:e>=131072&&e<=196605||e>=196608&&e<=262141?2:1}charProperties(e,t){let i=this.wcwidth(e),s=i===0&&t!==0;if(s){let r=ji.extractWidth(t);r===0?s=!1:r>i&&(i=r)}return ji.createPropertyValue(0,i,s)}},ji=class Do{constructor(){this._providers=Object.create(null),this._active="",this._onChange=new M,this.onChange=this._onChange.event;let t=new Tv;this.register(t),this._active=t.version,this._activeProvider=t}static extractShouldJoin(t){return(t&1)!==0}static extractWidth(t){return t>>1&3}static extractCharKind(t){return t>>3}static createPropertyValue(t,i,s=!1){return(t&16777215)<<3|(i&3)<<1|(s?1:0)}dispose(){this._onChange.dispose()}get versions(){return Object.keys(this._providers)}get activeVersion(){return this._active}set activeVersion(t){if(!this._providers[t])throw new Error(`unknown Unicode version "${t}"`);this._active=t,this._activeProvider=this._providers[t],this._onChange.fire(t)}register(t){this._providers[t.version]=t}wcwidth(t){return this._activeProvider.wcwidth(t)}getStringCellWidth(t){let i=0,s=0,r=t.length;for(let o=0;o<r;++o){let n=t.charCodeAt(o);if(55296<=n&&n<=56319){if(++o>=r)return i+this.wcwidth(n);let l=t.charCodeAt(o);56320<=l&&l<=57343?n=(n-55296)*1024+l-56320+65536:i+=this.wcwidth(l)}let a=this.charProperties(n,s),h=Do.extractWidth(a);Do.extractShouldJoin(a)&&(h-=Do.extractWidth(s)),i+=h,s=a}return i}charProperties(t,i){return this._activeProvider.charProperties(t,i)}},Lv=class{constructor(){this.glevel=0,this._charsets=[]}reset(){this.charset=void 0,this._charsets=[],this.glevel=0}setgLevel(e){this.glevel=e,this.charset=this._charsets[e]}setgCharset(e,t){this._charsets[e]=t,this.glevel===e&&(this.charset=t)}};pr=2147483647,Dv=256,cu=class al{constructor(t=32,i=32){if(this.maxLength=t,this.maxSubParamsLength=i,i>Dv)throw new Error("maxSubParamsLength must not be greater than 256");this.params=new Int32Array(t),this.length=0,this._subParams=new Int32Array(i),this._subParamsLength=0,this._subParamsIdx=new Uint16Array(t),this._rejectDigits=!1,this._rejectSubDigits=!1,this._digitIsSub=!1}static fromArray(t){let i=new al;if(!t.length)return i;for(let s=Array.isArray(t[0])?1:0;s<t.length;++s){let r=t[s];if(Array.isArray(r))for(let o=0;o<r.length;++o)i.addSubParam(r[o]);else i.addParam(r)}return i}clone(){let t=new al(this.maxLength,this.maxSubParamsLength);return t.params.set(this.params),t.length=this.length,t._subParams.set(this._subParams),t._subParamsLength=this._subParamsLength,t._subParamsIdx.set(this._subParamsIdx),t._rejectDigits=this._rejectDigits,t._rejectSubDigits=this._rejectSubDigits,t._digitIsSub=this._digitIsSub,t}toArray(){let t=[];for(let i=0;i<this.length;++i){t.push(this.params[i]);let s=this._subParamsIdx[i]>>8,r=this._subParamsIdx[i]&255;r-s>0&&t.push(Array.prototype.slice.call(this._subParams,s,r))}return t}reset(){this.length=0,this._subParamsLength=0,this._rejectDigits=!1,this._rejectSubDigits=!1,this._digitIsSub=!1}addParam(t){if(this._digitIsSub=!1,this.length>=this.maxLength){this._rejectDigits=!0;return}if(t<-1)throw new Error("values lesser than -1 are not allowed");this._subParamsIdx[this.length]=this._subParamsLength<<8|this._subParamsLength,this.params[this.length++]=t>pr?pr:t}addSubParam(t){if(this._digitIsSub=!0,!!this.length){if(this._rejectDigits||this._subParamsLength>=this.maxSubParamsLength){this._rejectSubDigits=!0;return}if(t<-1)throw new Error("values lesser than -1 are not allowed");this._subParams[this._subParamsLength++]=t>pr?pr:t,this._subParamsIdx[this.length-1]++}}hasSubParams(t){return(this._subParamsIdx[t]&255)-(this._subParamsIdx[t]>>8)>0}getSubParams(t){let i=this._subParamsIdx[t]>>8,s=this._subParamsIdx[t]&255;return s-i>0?this._subParams.subarray(i,s):null}getSubParamsAll(){let t={};for(let i=0;i<this.length;++i){let s=this._subParamsIdx[i]>>8,r=this._subParamsIdx[i]&255;r-s>0&&(t[i]=this._subParams.slice(s,r))}return t}addDigit(t){let i;if(this._rejectDigits||!(i=this._digitIsSub?this._subParamsLength:this.length)||this._digitIsSub&&this._rejectSubDigits)return;let s=this._digitIsSub?this._subParams:this.params,r=s[i-1];s[i-1]=~r?Math.min(r*10+t,pr):t}},fr=[],Rv=class{constructor(){this._state=0,this._active=fr,this._id=-1,this._handlers=Object.create(null),this._handlerFb=()=>{},this._stack={paused:!1,loopPosition:0,fallThrough:!1}}registerHandler(e,t){this._handlers[e]===void 0&&(this._handlers[e]=[]);let i=this._handlers[e];return i.push(t),{dispose:()=>{let s=i.indexOf(t);s!==-1&&i.splice(s,1)}}}clearHandler(e){this._handlers[e]&&delete this._handlers[e]}setHandlerFallback(e){this._handlerFb=e}dispose(){this._handlers=Object.create(null),this._handlerFb=()=>{},this._active=fr}reset(){if(this._state===2)for(let e=this._stack.paused?this._stack.loopPosition-1:this._active.length-1;e>=0;--e)this._active[e].end(!1);this._stack.paused=!1,this._active=fr,this._id=-1,this._state=0}_start(){if(this._active=this._handlers[this._id]||fr,!this._active.length)this._handlerFb(this._id,"START");else for(let e=this._active.length-1;e>=0;e--)this._active[e].start()}_put(e,t,i){if(!this._active.length)this._handlerFb(this._id,"PUT",Fo(e,t,i));else for(let s=this._active.length-1;s>=0;s--)this._active[s].put(e,t,i)}start(){this.reset(),this._state=1}put(e,t,i){if(this._state!==3){if(this._state===1)for(;t<i;){let s=e[t++];if(s===59){this._state=2,this._start();break}if(s<48||57<s){this._state=3;return}this._id===-1&&(this._id=0),this._id=this._id*10+s-48}this._state===2&&i-t>0&&this._put(e,t,i)}}end(e,t=!0){if(this._state!==0){if(this._state!==3)if(this._state===1&&this._start(),!this._active.length)this._handlerFb(this._id,"END",e);else{let i=!1,s=this._active.length-1,r=!1;if(this._stack.paused&&(s=this._stack.loopPosition-1,i=t,r=this._stack.fallThrough,this._stack.paused=!1),!r&&i===!1){for(;s>=0&&(i=this._active[s].end(e),i!==!0);s--)if(i instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=s,this._stack.fallThrough=!1,i;s--}for(;s>=0;s--)if(i=this._active[s].end(!1),i instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=s,this._stack.fallThrough=!0,i}this._active=fr,this._id=-1,this._state=0}}},ct=class{constructor(e){this._handler=e,this._data="",this._hitLimit=!1}start(){this._data="",this._hitLimit=!1}put(e,t,i){this._hitLimit||(this._data+=Fo(e,t,i),this._data.length>1e7&&(this._data="",this._hitLimit=!0))}end(e){let t=!1;if(this._hitLimit)t=!1;else if(e&&(t=this._handler(this._data),t instanceof Promise))return t.then(i=>(this._data="",this._hitLimit=!1,i));return this._data="",this._hitLimit=!1,t}},mr=[],Mv=class{constructor(){this._handlers=Object.create(null),this._active=mr,this._ident=0,this._handlerFb=()=>{},this._stack={paused:!1,loopPosition:0,fallThrough:!1}}dispose(){this._handlers=Object.create(null),this._handlerFb=()=>{},this._active=mr}registerHandler(e,t){this._handlers[e]===void 0&&(this._handlers[e]=[]);let i=this._handlers[e];return i.push(t),{dispose:()=>{let s=i.indexOf(t);s!==-1&&i.splice(s,1)}}}clearHandler(e){this._handlers[e]&&delete this._handlers[e]}setHandlerFallback(e){this._handlerFb=e}reset(){if(this._active.length)for(let e=this._stack.paused?this._stack.loopPosition-1:this._active.length-1;e>=0;--e)this._active[e].unhook(!1);this._stack.paused=!1,this._active=mr,this._ident=0}hook(e,t){if(this.reset(),this._ident=e,this._active=this._handlers[e]||mr,!this._active.length)this._handlerFb(this._ident,"HOOK",t);else for(let i=this._active.length-1;i>=0;i--)this._active[i].hook(t)}put(e,t,i){if(!this._active.length)this._handlerFb(this._ident,"PUT",Fo(e,t,i));else for(let s=this._active.length-1;s>=0;s--)this._active[s].put(e,t,i)}unhook(e,t=!0){if(!this._active.length)this._handlerFb(this._ident,"UNHOOK",e);else{let i=!1,s=this._active.length-1,r=!1;if(this._stack.paused&&(s=this._stack.loopPosition-1,i=t,r=this._stack.fallThrough,this._stack.paused=!1),!r&&i===!1){for(;s>=0&&(i=this._active[s].unhook(e),i!==!0);s--)if(i instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=s,this._stack.fallThrough=!1,i;s--}for(;s>=0;s--)if(i=this._active[s].unhook(!1),i instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=s,this._stack.fallThrough=!0,i}this._active=mr,this._ident=0}},wr=new cu;wr.addParam(0);Qc=class{constructor(e){this._handler=e,this._data="",this._params=wr,this._hitLimit=!1}hook(e){this._params=e.length>1||e.params[0]?e.clone():wr,this._data="",this._hitLimit=!1}put(e,t,i){this._hitLimit||(this._data+=Fo(e,t,i),this._data.length>1e7&&(this._data="",this._hitLimit=!0))}unhook(e){let t=!1;if(this._hitLimit)t=!1;else if(e&&(t=this._handler(this._data,this._params),t instanceof Promise))return t.then(i=>(this._params=wr,this._data="",this._hitLimit=!1,i));return this._params=wr,this._data="",this._hitLimit=!1,t}},Bv=class{constructor(e){this.table=new Uint8Array(e)}setDefault(e,t){this.table.fill(e<<4|t)}add(e,t,i,s){this.table[t<<8|e]=i<<4|s}addMany(e,t,i,s){for(let r=0;r<e.length;r++)this.table[t<<8|e[r]]=i<<4|s}},vt=160,Pv=(function(){let e=new Bv(4095),t=Array.apply(null,Array(256)).map((a,h)=>h),i=(a,h)=>t.slice(a,h),s=i(32,127),r=i(0,24);r.push(25),r.push.apply(r,i(28,32));let o=i(0,14),n;e.setDefault(1,0),e.addMany(s,0,2,0);for(n in o)e.addMany([24,26,153,154],n,3,0),e.addMany(i(128,144),n,3,0),e.addMany(i(144,152),n,3,0),e.add(156,n,0,0),e.add(27,n,11,1),e.add(157,n,4,8),e.addMany([152,158,159],n,0,7),e.add(155,n,11,3),e.add(144,n,11,9);return e.addMany(r,0,3,0),e.addMany(r,1,3,1),e.add(127,1,0,1),e.addMany(r,8,0,8),e.addMany(r,3,3,3),e.add(127,3,0,3),e.addMany(r,4,3,4),e.add(127,4,0,4),e.addMany(r,6,3,6),e.addMany(r,5,3,5),e.add(127,5,0,5),e.addMany(r,2,3,2),e.add(127,2,0,2),e.add(93,1,4,8),e.addMany(s,8,5,8),e.add(127,8,5,8),e.addMany([156,27,24,26,7],8,6,0),e.addMany(i(28,32),8,0,8),e.addMany([88,94,95],1,0,7),e.addMany(s,7,0,7),e.addMany(r,7,0,7),e.add(156,7,0,0),e.add(127,7,0,7),e.add(91,1,11,3),e.addMany(i(64,127),3,7,0),e.addMany(i(48,60),3,8,4),e.addMany([60,61,62,63],3,9,4),e.addMany(i(48,60),4,8,4),e.addMany(i(64,127),4,7,0),e.addMany([60,61,62,63],4,0,6),e.addMany(i(32,64),6,0,6),e.add(127,6,0,6),e.addMany(i(64,127),6,0,0),e.addMany(i(32,48),3,9,5),e.addMany(i(32,48),5,9,5),e.addMany(i(48,64),5,0,6),e.addMany(i(64,127),5,7,0),e.addMany(i(32,48),4,9,5),e.addMany(i(32,48),1,9,2),e.addMany(i(32,48),2,9,2),e.addMany(i(48,127),2,10,0),e.addMany(i(48,80),1,10,0),e.addMany(i(81,88),1,10,0),e.addMany([89,90,92],1,10,0),e.addMany(i(96,127),1,10,0),e.add(80,1,11,9),e.addMany(r,9,0,9),e.add(127,9,0,9),e.addMany(i(28,32),9,0,9),e.addMany(i(32,48),9,9,12),e.addMany(i(48,60),9,8,10),e.addMany([60,61,62,63],9,9,10),e.addMany(r,11,0,11),e.addMany(i(32,128),11,0,11),e.addMany(i(28,32),11,0,11),e.addMany(r,10,0,10),e.add(127,10,0,10),e.addMany(i(28,32),10,0,10),e.addMany(i(48,60),10,8,10),e.addMany([60,61,62,63],10,0,11),e.addMany(i(32,48),10,9,12),e.addMany(r,12,0,12),e.add(127,12,0,12),e.addMany(i(28,32),12,0,12),e.addMany(i(32,48),12,9,12),e.addMany(i(48,64),12,0,11),e.addMany(i(64,127),12,12,13),e.addMany(i(64,127),10,12,13),e.addMany(i(64,127),9,12,13),e.addMany(r,13,13,13),e.addMany(s,13,13,13),e.add(127,13,0,13),e.addMany([27,156,24,26],13,14,0),e.add(vt,0,2,0),e.add(vt,8,5,8),e.add(vt,6,0,6),e.add(vt,11,0,11),e.add(vt,13,13,13),e})(),Ov=class extends G{constructor(e=Pv){super(),this._transitions=e,this._parseStack={state:0,handlers:[],handlerPos:0,transition:0,chunkPos:0},this.initialState=0,this.currentState=this.initialState,this._params=new cu,this._params.addParam(0),this._collect=0,this.precedingJoinState=0,this._printHandlerFb=(t,i,s)=>{},this._executeHandlerFb=t=>{},this._csiHandlerFb=(t,i)=>{},this._escHandlerFb=t=>{},this._errorHandlerFb=t=>t,this._printHandler=this._printHandlerFb,this._executeHandlers=Object.create(null),this._csiHandlers=Object.create(null),this._escHandlers=Object.create(null),this._register(me(()=>{this._csiHandlers=Object.create(null),this._executeHandlers=Object.create(null),this._escHandlers=Object.create(null)})),this._oscParser=this._register(new Rv),this._dcsParser=this._register(new Mv),this._errorHandler=this._errorHandlerFb,this.registerEscHandler({final:"\\"},()=>!0)}_identifier(e,t=[64,126]){let i=0;if(e.prefix){if(e.prefix.length>1)throw new Error("only one byte as prefix supported");if(i=e.prefix.charCodeAt(0),i&&60>i||i>63)throw new Error("prefix must be in range 0x3c .. 0x3f")}if(e.intermediates){if(e.intermediates.length>2)throw new Error("only two bytes as intermediates are supported");for(let r=0;r<e.intermediates.length;++r){let o=e.intermediates.charCodeAt(r);if(32>o||o>47)throw new Error("intermediate must be in range 0x20 .. 0x2f");i<<=8,i|=o}}if(e.final.length!==1)throw new Error("final must be a single byte");let s=e.final.charCodeAt(0);if(t[0]>s||s>t[1])throw new Error(`final must be in range ${t[0]} .. ${t[1]}`);return i<<=8,i|=s,i}identToString(e){let t=[];for(;e;)t.push(String.fromCharCode(e&255)),e>>=8;return t.reverse().join("")}setPrintHandler(e){this._printHandler=e}clearPrintHandler(){this._printHandler=this._printHandlerFb}registerEscHandler(e,t){let i=this._identifier(e,[48,126]);this._escHandlers[i]===void 0&&(this._escHandlers[i]=[]);let s=this._escHandlers[i];return s.push(t),{dispose:()=>{let r=s.indexOf(t);r!==-1&&s.splice(r,1)}}}clearEscHandler(e){this._escHandlers[this._identifier(e,[48,126])]&&delete this._escHandlers[this._identifier(e,[48,126])]}setEscHandlerFallback(e){this._escHandlerFb=e}setExecuteHandler(e,t){this._executeHandlers[e.charCodeAt(0)]=t}clearExecuteHandler(e){this._executeHandlers[e.charCodeAt(0)]&&delete this._executeHandlers[e.charCodeAt(0)]}setExecuteHandlerFallback(e){this._executeHandlerFb=e}registerCsiHandler(e,t){let i=this._identifier(e);this._csiHandlers[i]===void 0&&(this._csiHandlers[i]=[]);let s=this._csiHandlers[i];return s.push(t),{dispose:()=>{let r=s.indexOf(t);r!==-1&&s.splice(r,1)}}}clearCsiHandler(e){this._csiHandlers[this._identifier(e)]&&delete this._csiHandlers[this._identifier(e)]}setCsiHandlerFallback(e){this._csiHandlerFb=e}registerDcsHandler(e,t){return this._dcsParser.registerHandler(this._identifier(e),t)}clearDcsHandler(e){this._dcsParser.clearHandler(this._identifier(e))}setDcsHandlerFallback(e){this._dcsParser.setHandlerFallback(e)}registerOscHandler(e,t){return this._oscParser.registerHandler(e,t)}clearOscHandler(e){this._oscParser.clearHandler(e)}setOscHandlerFallback(e){this._oscParser.setHandlerFallback(e)}setErrorHandler(e){this._errorHandler=e}clearErrorHandler(){this._errorHandler=this._errorHandlerFb}reset(){this.currentState=this.initialState,this._oscParser.reset(),this._dcsParser.reset(),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingJoinState=0,this._parseStack.state!==0&&(this._parseStack.state=2,this._parseStack.handlers=[])}_preserveStack(e,t,i,s,r){this._parseStack.state=e,this._parseStack.handlers=t,this._parseStack.handlerPos=i,this._parseStack.transition=s,this._parseStack.chunkPos=r}parse(e,t,i){let s=0,r=0,o=0,n;if(this._parseStack.state)if(this._parseStack.state===2)this._parseStack.state=0,o=this._parseStack.chunkPos+1;else{if(i===void 0||this._parseStack.state===1)throw this._parseStack.state=1,new Error("improper continuation due to previous async handler, giving up parsing");let a=this._parseStack.handlers,h=this._parseStack.handlerPos-1;switch(this._parseStack.state){case 3:if(i===!1&&h>-1){for(;h>=0&&(n=a[h](this._params),n!==!0);h--)if(n instanceof Promise)return this._parseStack.handlerPos=h,n}this._parseStack.handlers=[];break;case 4:if(i===!1&&h>-1){for(;h>=0&&(n=a[h](),n!==!0);h--)if(n instanceof Promise)return this._parseStack.handlerPos=h,n}this._parseStack.handlers=[];break;case 6:if(s=e[this._parseStack.chunkPos],n=this._dcsParser.unhook(s!==24&&s!==26,i),n)return n;s===27&&(this._parseStack.transition|=1),this._params.reset(),this._params.addParam(0),this._collect=0;break;case 5:if(s=e[this._parseStack.chunkPos],n=this._oscParser.end(s!==24&&s!==26,i),n)return n;s===27&&(this._parseStack.transition|=1),this._params.reset(),this._params.addParam(0),this._collect=0;break}this._parseStack.state=0,o=this._parseStack.chunkPos+1,this.precedingJoinState=0,this.currentState=this._parseStack.transition&15}for(let a=o;a<t;++a){switch(s=e[a],r=this._transitions.table[this.currentState<<8|(s<160?s:vt)],r>>4){case 2:for(let p=a+1;;++p){if(p>=t||(s=e[p])<32||s>126&&s<vt){this._printHandler(e,a,p),a=p-1;break}if(++p>=t||(s=e[p])<32||s>126&&s<vt){this._printHandler(e,a,p),a=p-1;break}if(++p>=t||(s=e[p])<32||s>126&&s<vt){this._printHandler(e,a,p),a=p-1;break}if(++p>=t||(s=e[p])<32||s>126&&s<vt){this._printHandler(e,a,p),a=p-1;break}}break;case 3:this._executeHandlers[s]?this._executeHandlers[s]():this._executeHandlerFb(s),this.precedingJoinState=0;break;case 0:break;case 1:if(this._errorHandler({position:a,code:s,currentState:this.currentState,collect:this._collect,params:this._params,abort:!1}).abort)return;break;case 7:let h=this._csiHandlers[this._collect<<8|s],l=h?h.length-1:-1;for(;l>=0&&(n=h[l](this._params),n!==!0);l--)if(n instanceof Promise)return this._preserveStack(3,h,l,r,a),n;l<0&&this._csiHandlerFb(this._collect<<8|s,this._params),this.precedingJoinState=0;break;case 8:do switch(s){case 59:this._params.addParam(0);break;case 58:this._params.addSubParam(-1);break;default:this._params.addDigit(s-48)}while(++a<t&&(s=e[a])>47&&s<60);a--;break;case 9:this._collect<<=8,this._collect|=s;break;case 10:let c=this._escHandlers[this._collect<<8|s],d=c?c.length-1:-1;for(;d>=0&&(n=c[d](),n!==!0);d--)if(n instanceof Promise)return this._preserveStack(4,c,d,r,a),n;d<0&&this._escHandlerFb(this._collect<<8|s),this.precedingJoinState=0;break;case 11:this._params.reset(),this._params.addParam(0),this._collect=0;break;case 12:this._dcsParser.hook(this._collect<<8|s,this._params);break;case 13:for(let p=a+1;;++p)if(p>=t||(s=e[p])===24||s===26||s===27||s>127&&s<vt){this._dcsParser.put(e,a,p),a=p-1;break}break;case 14:if(n=this._dcsParser.unhook(s!==24&&s!==26),n)return this._preserveStack(6,[],0,r,a),n;s===27&&(r|=1),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingJoinState=0;break;case 4:this._oscParser.start();break;case 5:for(let p=a+1;;p++)if(p>=t||(s=e[p])<32||s>127&&s<vt){this._oscParser.put(e,a,p),a=p-1;break}break;case 6:if(n=this._oscParser.end(s!==24&&s!==26),n)return this._preserveStack(5,[],0,r,a),n;s===27&&(r|=1),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingJoinState=0;break}this.currentState=r&15}}},Iv=/^([\da-f])\/([\da-f])\/([\da-f])$|^([\da-f]{2})\/([\da-f]{2})\/([\da-f]{2})$|^([\da-f]{3})\/([\da-f]{3})\/([\da-f]{3})$|^([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})$/,zv=/^[\da-f]+$/;Hv={"(":0,")":1,"*":2,"+":3,"-":1,".":2},gi=131072,td=10;sd=5e3,rd=0,Fv=class extends G{constructor(e,t,i,s,r,o,n,a,h=new Ov){super(),this._bufferService=e,this._charsetService=t,this._coreService=i,this._logService=s,this._optionsService=r,this._oscLinkService=o,this._coreMouseService=n,this._unicodeService=a,this._parser=h,this._parseBuffer=new Uint32Array(4096),this._stringDecoder=new Rm,this._utf8Decoder=new Mm,this._windowTitle="",this._iconName="",this._windowTitleStack=[],this._iconNameStack=[],this._curAttrData=Ee.clone(),this._eraseAttrDataInternal=Ee.clone(),this._onRequestBell=this._register(new M),this.onRequestBell=this._onRequestBell.event,this._onRequestRefreshRows=this._register(new M),this.onRequestRefreshRows=this._onRequestRefreshRows.event,this._onRequestReset=this._register(new M),this.onRequestReset=this._onRequestReset.event,this._onRequestSendFocus=this._register(new M),this.onRequestSendFocus=this._onRequestSendFocus.event,this._onRequestSyncScrollBar=this._register(new M),this.onRequestSyncScrollBar=this._onRequestSyncScrollBar.event,this._onRequestWindowsOptionsReport=this._register(new M),this.onRequestWindowsOptionsReport=this._onRequestWindowsOptionsReport.event,this._onA11yChar=this._register(new M),this.onA11yChar=this._onA11yChar.event,this._onA11yTab=this._register(new M),this.onA11yTab=this._onA11yTab.event,this._onCursorMove=this._register(new M),this.onCursorMove=this._onCursorMove.event,this._onLineFeed=this._register(new M),this.onLineFeed=this._onLineFeed.event,this._onScroll=this._register(new M),this.onScroll=this._onScroll.event,this._onTitleChange=this._register(new M),this.onTitleChange=this._onTitleChange.event,this._onColor=this._register(new M),this.onColor=this._onColor.event,this._parseStack={paused:!1,cursorStartX:0,cursorStartY:0,decodedLength:0,position:0},this._specialColors=[256,257,258],this._register(this._parser),this._dirtyRowTracker=new ll(this._bufferService),this._activeBuffer=this._bufferService.buffer,this._register(this._bufferService.buffers.onBufferActivate(l=>this._activeBuffer=l.activeBuffer)),this._parser.setCsiHandlerFallback((l,c)=>{this._logService.debug("Unknown CSI code: ",{identifier:this._parser.identToString(l),params:c.toArray()})}),this._parser.setEscHandlerFallback(l=>{this._logService.debug("Unknown ESC code: ",{identifier:this._parser.identToString(l)})}),this._parser.setExecuteHandlerFallback(l=>{this._logService.debug("Unknown EXECUTE code: ",{code:l})}),this._parser.setOscHandlerFallback((l,c,d)=>{this._logService.debug("Unknown OSC code: ",{identifier:l,action:c,data:d})}),this._parser.setDcsHandlerFallback((l,c,d)=>{c==="HOOK"&&(d=d.toArray()),this._logService.debug("Unknown DCS code: ",{identifier:this._parser.identToString(l),action:c,payload:d})}),this._parser.setPrintHandler((l,c,d)=>this.print(l,c,d)),this._parser.registerCsiHandler({final:"@"},l=>this.insertChars(l)),this._parser.registerCsiHandler({intermediates:" ",final:"@"},l=>this.scrollLeft(l)),this._parser.registerCsiHandler({final:"A"},l=>this.cursorUp(l)),this._parser.registerCsiHandler({intermediates:" ",final:"A"},l=>this.scrollRight(l)),this._parser.registerCsiHandler({final:"B"},l=>this.cursorDown(l)),this._parser.registerCsiHandler({final:"C"},l=>this.cursorForward(l)),this._parser.registerCsiHandler({final:"D"},l=>this.cursorBackward(l)),this._parser.registerCsiHandler({final:"E"},l=>this.cursorNextLine(l)),this._parser.registerCsiHandler({final:"F"},l=>this.cursorPrecedingLine(l)),this._parser.registerCsiHandler({final:"G"},l=>this.cursorCharAbsolute(l)),this._parser.registerCsiHandler({final:"H"},l=>this.cursorPosition(l)),this._parser.registerCsiHandler({final:"I"},l=>this.cursorForwardTab(l)),this._parser.registerCsiHandler({final:"J"},l=>this.eraseInDisplay(l,!1)),this._parser.registerCsiHandler({prefix:"?",final:"J"},l=>this.eraseInDisplay(l,!0)),this._parser.registerCsiHandler({final:"K"},l=>this.eraseInLine(l,!1)),this._parser.registerCsiHandler({prefix:"?",final:"K"},l=>this.eraseInLine(l,!0)),this._parser.registerCsiHandler({final:"L"},l=>this.insertLines(l)),this._parser.registerCsiHandler({final:"M"},l=>this.deleteLines(l)),this._parser.registerCsiHandler({final:"P"},l=>this.deleteChars(l)),this._parser.registerCsiHandler({final:"S"},l=>this.scrollUp(l)),this._parser.registerCsiHandler({final:"T"},l=>this.scrollDown(l)),this._parser.registerCsiHandler({final:"X"},l=>this.eraseChars(l)),this._parser.registerCsiHandler({final:"Z"},l=>this.cursorBackwardTab(l)),this._parser.registerCsiHandler({final:"`"},l=>this.charPosAbsolute(l)),this._parser.registerCsiHandler({final:"a"},l=>this.hPositionRelative(l)),this._parser.registerCsiHandler({final:"b"},l=>this.repeatPrecedingCharacter(l)),this._parser.registerCsiHandler({final:"c"},l=>this.sendDeviceAttributesPrimary(l)),this._parser.registerCsiHandler({prefix:">",final:"c"},l=>this.sendDeviceAttributesSecondary(l)),this._parser.registerCsiHandler({final:"d"},l=>this.linePosAbsolute(l)),this._parser.registerCsiHandler({final:"e"},l=>this.vPositionRelative(l)),this._parser.registerCsiHandler({final:"f"},l=>this.hVPosition(l)),this._parser.registerCsiHandler({final:"g"},l=>this.tabClear(l)),this._parser.registerCsiHandler({final:"h"},l=>this.setMode(l)),this._parser.registerCsiHandler({prefix:"?",final:"h"},l=>this.setModePrivate(l)),this._parser.registerCsiHandler({final:"l"},l=>this.resetMode(l)),this._parser.registerCsiHandler({prefix:"?",final:"l"},l=>this.resetModePrivate(l)),this._parser.registerCsiHandler({final:"m"},l=>this.charAttributes(l)),this._parser.registerCsiHandler({final:"n"},l=>this.deviceStatus(l)),this._parser.registerCsiHandler({prefix:"?",final:"n"},l=>this.deviceStatusPrivate(l)),this._parser.registerCsiHandler({intermediates:"!",final:"p"},l=>this.softReset(l)),this._parser.registerCsiHandler({intermediates:" ",final:"q"},l=>this.setCursorStyle(l)),this._parser.registerCsiHandler({final:"r"},l=>this.setScrollRegion(l)),this._parser.registerCsiHandler({final:"s"},l=>this.saveCursor(l)),this._parser.registerCsiHandler({final:"t"},l=>this.windowOptions(l)),this._parser.registerCsiHandler({final:"u"},l=>this.restoreCursor(l)),this._parser.registerCsiHandler({intermediates:"'",final:"}"},l=>this.insertColumns(l)),this._parser.registerCsiHandler({intermediates:"'",final:"~"},l=>this.deleteColumns(l)),this._parser.registerCsiHandler({intermediates:'"',final:"q"},l=>this.selectProtected(l)),this._parser.registerCsiHandler({intermediates:"$",final:"p"},l=>this.requestMode(l,!0)),this._parser.registerCsiHandler({prefix:"?",intermediates:"$",final:"p"},l=>this.requestMode(l,!1)),this._parser.setExecuteHandler($.BEL,()=>this.bell()),this._parser.setExecuteHandler($.LF,()=>this.lineFeed()),this._parser.setExecuteHandler($.VT,()=>this.lineFeed()),this._parser.setExecuteHandler($.FF,()=>this.lineFeed()),this._parser.setExecuteHandler($.CR,()=>this.carriageReturn()),this._parser.setExecuteHandler($.BS,()=>this.backspace()),this._parser.setExecuteHandler($.HT,()=>this.tab()),this._parser.setExecuteHandler($.SO,()=>this.shiftOut()),this._parser.setExecuteHandler($.SI,()=>this.shiftIn()),this._parser.setExecuteHandler(To.IND,()=>this.index()),this._parser.setExecuteHandler(To.NEL,()=>this.nextLine()),this._parser.setExecuteHandler(To.HTS,()=>this.tabSet()),this._parser.registerOscHandler(0,new ct(l=>(this.setTitle(l),this.setIconName(l),!0))),this._parser.registerOscHandler(1,new ct(l=>this.setIconName(l))),this._parser.registerOscHandler(2,new ct(l=>this.setTitle(l))),this._parser.registerOscHandler(4,new ct(l=>this.setOrReportIndexedColor(l))),this._parser.registerOscHandler(8,new ct(l=>this.setHyperlink(l))),this._parser.registerOscHandler(10,new ct(l=>this.setOrReportFgColor(l))),this._parser.registerOscHandler(11,new ct(l=>this.setOrReportBgColor(l))),this._parser.registerOscHandler(12,new ct(l=>this.setOrReportCursorColor(l))),this._parser.registerOscHandler(104,new ct(l=>this.restoreIndexedColor(l))),this._parser.registerOscHandler(110,new ct(l=>this.restoreFgColor(l))),this._parser.registerOscHandler(111,new ct(l=>this.restoreBgColor(l))),this._parser.registerOscHandler(112,new ct(l=>this.restoreCursorColor(l))),this._parser.registerEscHandler({final:"7"},()=>this.saveCursor()),this._parser.registerEscHandler({final:"8"},()=>this.restoreCursor()),this._parser.registerEscHandler({final:"D"},()=>this.index()),this._parser.registerEscHandler({final:"E"},()=>this.nextLine()),this._parser.registerEscHandler({final:"H"},()=>this.tabSet()),this._parser.registerEscHandler({final:"M"},()=>this.reverseIndex()),this._parser.registerEscHandler({final:"="},()=>this.keypadApplicationMode()),this._parser.registerEscHandler({final:">"},()=>this.keypadNumericMode()),this._parser.registerEscHandler({final:"c"},()=>this.fullReset()),this._parser.registerEscHandler({final:"n"},()=>this.setgLevel(2)),this._parser.registerEscHandler({final:"o"},()=>this.setgLevel(3)),this._parser.registerEscHandler({final:"|"},()=>this.setgLevel(3)),this._parser.registerEscHandler({final:"}"},()=>this.setgLevel(2)),this._parser.registerEscHandler({final:"~"},()=>this.setgLevel(1)),this._parser.registerEscHandler({intermediates:"%",final:"@"},()=>this.selectDefaultCharset()),this._parser.registerEscHandler({intermediates:"%",final:"G"},()=>this.selectDefaultCharset());for(let l in De)this._parser.registerEscHandler({intermediates:"(",final:l},()=>this.selectCharset("("+l)),this._parser.registerEscHandler({intermediates:")",final:l},()=>this.selectCharset(")"+l)),this._parser.registerEscHandler({intermediates:"*",final:l},()=>this.selectCharset("*"+l)),this._parser.registerEscHandler({intermediates:"+",final:l},()=>this.selectCharset("+"+l)),this._parser.registerEscHandler({intermediates:"-",final:l},()=>this.selectCharset("-"+l)),this._parser.registerEscHandler({intermediates:".",final:l},()=>this.selectCharset("."+l)),this._parser.registerEscHandler({intermediates:"/",final:l},()=>this.selectCharset("/"+l));this._parser.registerEscHandler({intermediates:"#",final:"8"},()=>this.screenAlignmentPattern()),this._parser.setErrorHandler(l=>(this._logService.error("Parsing error: ",l),l)),this._parser.registerDcsHandler({intermediates:"$",final:"q"},new Qc((l,c)=>this.requestStatusString(l,c)))}getAttrData(){return this._curAttrData}_preserveStack(e,t,i,s){this._parseStack.paused=!0,this._parseStack.cursorStartX=e,this._parseStack.cursorStartY=t,this._parseStack.decodedLength=i,this._parseStack.position=s}_logSlowResolvingAsync(e){this._logService.logLevel<=3&&Promise.race([e,new Promise((t,i)=>setTimeout(()=>i("#SLOW_TIMEOUT"),sd))]).catch(t=>{if(t!=="#SLOW_TIMEOUT")throw t;console.warn(`async parser handler taking longer than ${sd} ms`)})}_getCurrentLinkId(){return this._curAttrData.extended.urlId}parse(e,t){let i,s=this._activeBuffer.x,r=this._activeBuffer.y,o=0,n=this._parseStack.paused;if(n){if(i=this._parser.parse(this._parseBuffer,this._parseStack.decodedLength,t))return this._logSlowResolvingAsync(i),i;s=this._parseStack.cursorStartX,r=this._parseStack.cursorStartY,this._parseStack.paused=!1,e.length>gi&&(o=this._parseStack.position+gi)}if(this._logService.logLevel<=1&&this._logService.debug(`parsing data ${typeof e=="string"?` "${e}"`:` "${Array.prototype.map.call(e,l=>String.fromCharCode(l)).join("")}"`}`),this._logService.logLevel===0&&this._logService.trace("parsing data (codes)",typeof e=="string"?e.split("").map(l=>l.charCodeAt(0)):e),this._parseBuffer.length<e.length&&this._parseBuffer.length<gi&&(this._parseBuffer=new Uint32Array(Math.min(e.length,gi))),n||this._dirtyRowTracker.clearRange(),e.length>gi)for(let l=o;l<e.length;l+=gi){let c=l+gi<e.length?l+gi:e.length,d=typeof e=="string"?this._stringDecoder.decode(e.substring(l,c),this._parseBuffer):this._utf8Decoder.decode(e.subarray(l,c),this._parseBuffer);if(i=this._parser.parse(this._parseBuffer,d))return this._preserveStack(s,r,d,l),this._logSlowResolvingAsync(i),i}else if(!n){let l=typeof e=="string"?this._stringDecoder.decode(e,this._parseBuffer):this._utf8Decoder.decode(e,this._parseBuffer);if(i=this._parser.parse(this._parseBuffer,l))return this._preserveStack(s,r,l,0),this._logSlowResolvingAsync(i),i}(this._activeBuffer.x!==s||this._activeBuffer.y!==r)&&this._onCursorMove.fire();let a=this._dirtyRowTracker.end+(this._bufferService.buffer.ybase-this._bufferService.buffer.ydisp),h=this._dirtyRowTracker.start+(this._bufferService.buffer.ybase-this._bufferService.buffer.ydisp);h<this._bufferService.rows&&this._onRequestRefreshRows.fire({start:Math.min(h,this._bufferService.rows-1),end:Math.min(a,this._bufferService.rows-1)})}print(e,t,i){let s,r,o=this._charsetService.charset,n=this._optionsService.rawOptions.screenReaderMode,a=this._bufferService.cols,h=this._coreService.decPrivateModes.wraparound,l=this._coreService.modes.insertMode,c=this._curAttrData,d=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._activeBuffer.x&&i-t>0&&d.getWidth(this._activeBuffer.x-1)===2&&d.setCellFromCodepoint(this._activeBuffer.x-1,0,1,c);let p=this._parser.precedingJoinState;for(let f=t;f<i;++f){if(s=e[f],s<127&&o){let k=o[String.fromCharCode(s)];k&&(s=k.charCodeAt(0))}let m=this._unicodeService.charProperties(s,p);r=ji.extractWidth(m);let _=ji.extractShouldJoin(m),C=_?ji.extractWidth(p):0;if(p=m,n&&this._onA11yChar.fire(vi(s)),this._getCurrentLinkId()&&this._oscLinkService.addLineToLink(this._getCurrentLinkId(),this._activeBuffer.ybase+this._activeBuffer.y),this._activeBuffer.x+r-C>a){if(h){let k=d,R=this._activeBuffer.x-C;for(this._activeBuffer.x=C,this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData(),!0)):(this._activeBuffer.y>=this._bufferService.rows&&(this._activeBuffer.y=this._bufferService.rows-1),this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!0),d=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y),C>0&&d instanceof br&&d.copyCellsFrom(k,R,0,C,!1);R<a;)k.setCellFromCodepoint(R++,0,1,c)}else if(this._activeBuffer.x=a-1,r===2)continue}if(_&&this._activeBuffer.x){let k=d.getWidth(this._activeBuffer.x-1)?1:2;d.addCodepointToCell(this._activeBuffer.x-k,s,r);for(let R=r-C;--R>=0;)d.setCellFromCodepoint(this._activeBuffer.x++,0,0,c);continue}if(l&&(d.insertCells(this._activeBuffer.x,r-C,this._activeBuffer.getNullCell(c)),d.getWidth(a-1)===2&&d.setCellFromCodepoint(a-1,0,1,c)),d.setCellFromCodepoint(this._activeBuffer.x++,s,r,c),r>0)for(;--r;)d.setCellFromCodepoint(this._activeBuffer.x++,0,0,c)}this._parser.precedingJoinState=p,this._activeBuffer.x<a&&i-t>0&&d.getWidth(this._activeBuffer.x)===0&&!d.hasContent(this._activeBuffer.x)&&d.setCellFromCodepoint(this._activeBuffer.x,0,1,c),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}registerCsiHandler(e,t){return e.final==="t"&&!e.prefix&&!e.intermediates?this._parser.registerCsiHandler(e,i=>id(i.params[0],this._optionsService.rawOptions.windowOptions)?t(i):!0):this._parser.registerCsiHandler(e,t)}registerDcsHandler(e,t){return this._parser.registerDcsHandler(e,new Qc(t))}registerEscHandler(e,t){return this._parser.registerEscHandler(e,t)}registerOscHandler(e,t){return this._parser.registerOscHandler(e,new ct(t))}bell(){return this._onRequestBell.fire(),!0}lineFeed(){return this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._optionsService.rawOptions.convertEol&&(this._activeBuffer.x=0),this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData())):this._activeBuffer.y>=this._bufferService.rows?this._activeBuffer.y=this._bufferService.rows-1:this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!1,this._activeBuffer.x>=this._bufferService.cols&&this._activeBuffer.x--,this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._onLineFeed.fire(),!0}carriageReturn(){return this._activeBuffer.x=0,!0}backspace(){if(!this._coreService.decPrivateModes.reverseWraparound)return this._restrictCursor(),this._activeBuffer.x>0&&this._activeBuffer.x--,!0;if(this._restrictCursor(this._bufferService.cols),this._activeBuffer.x>0)this._activeBuffer.x--;else if(this._activeBuffer.x===0&&this._activeBuffer.y>this._activeBuffer.scrollTop&&this._activeBuffer.y<=this._activeBuffer.scrollBottom&&this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y)?.isWrapped){this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!1,this._activeBuffer.y--,this._activeBuffer.x=this._bufferService.cols-1;let e=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);e.hasWidth(this._activeBuffer.x)&&!e.hasContent(this._activeBuffer.x)&&this._activeBuffer.x--}return this._restrictCursor(),!0}tab(){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let e=this._activeBuffer.x;return this._activeBuffer.x=this._activeBuffer.nextStop(),this._optionsService.rawOptions.screenReaderMode&&this._onA11yTab.fire(this._activeBuffer.x-e),!0}shiftOut(){return this._charsetService.setgLevel(1),!0}shiftIn(){return this._charsetService.setgLevel(0),!0}_restrictCursor(e=this._bufferService.cols-1){this._activeBuffer.x=Math.min(e,Math.max(0,this._activeBuffer.x)),this._activeBuffer.y=this._coreService.decPrivateModes.origin?Math.min(this._activeBuffer.scrollBottom,Math.max(this._activeBuffer.scrollTop,this._activeBuffer.y)):Math.min(this._bufferService.rows-1,Math.max(0,this._activeBuffer.y)),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}_setCursor(e,t){this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._coreService.decPrivateModes.origin?(this._activeBuffer.x=e,this._activeBuffer.y=this._activeBuffer.scrollTop+t):(this._activeBuffer.x=e,this._activeBuffer.y=t),this._restrictCursor(),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}_moveCursor(e,t){this._restrictCursor(),this._setCursor(this._activeBuffer.x+e,this._activeBuffer.y+t)}cursorUp(e){let t=this._activeBuffer.y-this._activeBuffer.scrollTop;return t>=0?this._moveCursor(0,-Math.min(t,e.params[0]||1)):this._moveCursor(0,-(e.params[0]||1)),!0}cursorDown(e){let t=this._activeBuffer.scrollBottom-this._activeBuffer.y;return t>=0?this._moveCursor(0,Math.min(t,e.params[0]||1)):this._moveCursor(0,e.params[0]||1),!0}cursorForward(e){return this._moveCursor(e.params[0]||1,0),!0}cursorBackward(e){return this._moveCursor(-(e.params[0]||1),0),!0}cursorNextLine(e){return this.cursorDown(e),this._activeBuffer.x=0,!0}cursorPrecedingLine(e){return this.cursorUp(e),this._activeBuffer.x=0,!0}cursorCharAbsolute(e){return this._setCursor((e.params[0]||1)-1,this._activeBuffer.y),!0}cursorPosition(e){return this._setCursor(e.length>=2?(e.params[1]||1)-1:0,(e.params[0]||1)-1),!0}charPosAbsolute(e){return this._setCursor((e.params[0]||1)-1,this._activeBuffer.y),!0}hPositionRelative(e){return this._moveCursor(e.params[0]||1,0),!0}linePosAbsolute(e){return this._setCursor(this._activeBuffer.x,(e.params[0]||1)-1),!0}vPositionRelative(e){return this._moveCursor(0,e.params[0]||1),!0}hVPosition(e){return this.cursorPosition(e),!0}tabClear(e){let t=e.params[0];return t===0?delete this._activeBuffer.tabs[this._activeBuffer.x]:t===3&&(this._activeBuffer.tabs={}),!0}cursorForwardTab(e){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let t=e.params[0]||1;for(;t--;)this._activeBuffer.x=this._activeBuffer.nextStop();return!0}cursorBackwardTab(e){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let t=e.params[0]||1;for(;t--;)this._activeBuffer.x=this._activeBuffer.prevStop();return!0}selectProtected(e){let t=e.params[0];return t===1&&(this._curAttrData.bg|=536870912),(t===2||t===0)&&(this._curAttrData.bg&=-536870913),!0}_eraseInBufferLine(e,t,i,s=!1,r=!1){let o=this._activeBuffer.lines.get(this._activeBuffer.ybase+e);o.replaceCells(t,i,this._activeBuffer.getNullCell(this._eraseAttrData()),r),s&&(o.isWrapped=!1)}_resetBufferLine(e,t=!1){let i=this._activeBuffer.lines.get(this._activeBuffer.ybase+e);i&&(i.fill(this._activeBuffer.getNullCell(this._eraseAttrData()),t),this._bufferService.buffer.clearMarkers(this._activeBuffer.ybase+e),i.isWrapped=!1)}eraseInDisplay(e,t=!1){this._restrictCursor(this._bufferService.cols);let i;switch(e.params[0]){case 0:for(i=this._activeBuffer.y,this._dirtyRowTracker.markDirty(i),this._eraseInBufferLine(i++,this._activeBuffer.x,this._bufferService.cols,this._activeBuffer.x===0,t);i<this._bufferService.rows;i++)this._resetBufferLine(i,t);this._dirtyRowTracker.markDirty(i);break;case 1:for(i=this._activeBuffer.y,this._dirtyRowTracker.markDirty(i),this._eraseInBufferLine(i,0,this._activeBuffer.x+1,!0,t),this._activeBuffer.x+1>=this._bufferService.cols&&(this._activeBuffer.lines.get(i+1).isWrapped=!1);i--;)this._resetBufferLine(i,t);this._dirtyRowTracker.markDirty(0);break;case 2:if(this._optionsService.rawOptions.scrollOnEraseInDisplay){for(i=this._bufferService.rows,this._dirtyRowTracker.markRangeDirty(0,i-1);i--&&!this._activeBuffer.lines.get(this._activeBuffer.ybase+i)?.getTrimmedLength(););for(;i>=0;i--)this._bufferService.scroll(this._eraseAttrData())}else{for(i=this._bufferService.rows,this._dirtyRowTracker.markDirty(i-1);i--;)this._resetBufferLine(i,t);this._dirtyRowTracker.markDirty(0)}break;case 3:let s=this._activeBuffer.lines.length-this._bufferService.rows;s>0&&(this._activeBuffer.lines.trimStart(s),this._activeBuffer.ybase=Math.max(this._activeBuffer.ybase-s,0),this._activeBuffer.ydisp=Math.max(this._activeBuffer.ydisp-s,0),this._onScroll.fire(0));break}return!0}eraseInLine(e,t=!1){switch(this._restrictCursor(this._bufferService.cols),e.params[0]){case 0:this._eraseInBufferLine(this._activeBuffer.y,this._activeBuffer.x,this._bufferService.cols,this._activeBuffer.x===0,t);break;case 1:this._eraseInBufferLine(this._activeBuffer.y,0,this._activeBuffer.x+1,!1,t);break;case 2:this._eraseInBufferLine(this._activeBuffer.y,0,this._bufferService.cols,!0,t);break}return this._dirtyRowTracker.markDirty(this._activeBuffer.y),!0}insertLines(e){this._restrictCursor();let t=e.params[0]||1;if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let i=this._activeBuffer.ybase+this._activeBuffer.y,s=this._bufferService.rows-1-this._activeBuffer.scrollBottom,r=this._bufferService.rows-1+this._activeBuffer.ybase-s+1;for(;t--;)this._activeBuffer.lines.splice(r-1,1),this._activeBuffer.lines.splice(i,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y,this._activeBuffer.scrollBottom),this._activeBuffer.x=0,!0}deleteLines(e){this._restrictCursor();let t=e.params[0]||1;if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let i=this._activeBuffer.ybase+this._activeBuffer.y,s;for(s=this._bufferService.rows-1-this._activeBuffer.scrollBottom,s=this._bufferService.rows-1+this._activeBuffer.ybase-s;t--;)this._activeBuffer.lines.splice(i,1),this._activeBuffer.lines.splice(s,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y,this._activeBuffer.scrollBottom),this._activeBuffer.x=0,!0}insertChars(e){this._restrictCursor();let t=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return t&&(t.insertCells(this._activeBuffer.x,e.params[0]||1,this._activeBuffer.getNullCell(this._eraseAttrData())),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}deleteChars(e){this._restrictCursor();let t=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return t&&(t.deleteCells(this._activeBuffer.x,e.params[0]||1,this._activeBuffer.getNullCell(this._eraseAttrData())),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}scrollUp(e){let t=e.params[0]||1;for(;t--;)this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollTop,1),this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollBottom,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollDown(e){let t=e.params[0]||1;for(;t--;)this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollBottom,1),this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollTop,0,this._activeBuffer.getBlankLine(Ee));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollLeft(e){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let t=e.params[0]||1;for(let i=this._activeBuffer.scrollTop;i<=this._activeBuffer.scrollBottom;++i){let s=this._activeBuffer.lines.get(this._activeBuffer.ybase+i);s.deleteCells(0,t,this._activeBuffer.getNullCell(this._eraseAttrData())),s.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollRight(e){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let t=e.params[0]||1;for(let i=this._activeBuffer.scrollTop;i<=this._activeBuffer.scrollBottom;++i){let s=this._activeBuffer.lines.get(this._activeBuffer.ybase+i);s.insertCells(0,t,this._activeBuffer.getNullCell(this._eraseAttrData())),s.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}insertColumns(e){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let t=e.params[0]||1;for(let i=this._activeBuffer.scrollTop;i<=this._activeBuffer.scrollBottom;++i){let s=this._activeBuffer.lines.get(this._activeBuffer.ybase+i);s.insertCells(this._activeBuffer.x,t,this._activeBuffer.getNullCell(this._eraseAttrData())),s.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}deleteColumns(e){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let t=e.params[0]||1;for(let i=this._activeBuffer.scrollTop;i<=this._activeBuffer.scrollBottom;++i){let s=this._activeBuffer.lines.get(this._activeBuffer.ybase+i);s.deleteCells(this._activeBuffer.x,t,this._activeBuffer.getNullCell(this._eraseAttrData())),s.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}eraseChars(e){this._restrictCursor();let t=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return t&&(t.replaceCells(this._activeBuffer.x,this._activeBuffer.x+(e.params[0]||1),this._activeBuffer.getNullCell(this._eraseAttrData())),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}repeatPrecedingCharacter(e){let t=this._parser.precedingJoinState;if(!t)return!0;let i=e.params[0]||1,s=ji.extractWidth(t),r=this._activeBuffer.x-s,o=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).getString(r),n=new Uint32Array(o.length*i),a=0;for(let l=0;l<o.length;){let c=o.codePointAt(l)||0;n[a++]=c,l+=c>65535?2:1}let h=a;for(let l=1;l<i;++l)n.copyWithin(h,0,a),h+=a;return this.print(n,0,h),!0}sendDeviceAttributesPrimary(e){return e.params[0]>0||(this._is("xterm")||this._is("rxvt-unicode")||this._is("screen")?this._coreService.triggerDataEvent($.ESC+"[?1;2c"):this._is("linux")&&this._coreService.triggerDataEvent($.ESC+"[?6c")),!0}sendDeviceAttributesSecondary(e){return e.params[0]>0||(this._is("xterm")?this._coreService.triggerDataEvent($.ESC+"[>0;276;0c"):this._is("rxvt-unicode")?this._coreService.triggerDataEvent($.ESC+"[>85;95;0c"):this._is("linux")?this._coreService.triggerDataEvent(e.params[0]+"c"):this._is("screen")&&this._coreService.triggerDataEvent($.ESC+"[>83;40003;0c")),!0}_is(e){return(this._optionsService.rawOptions.termName+"").indexOf(e)===0}setMode(e){for(let t=0;t<e.length;t++)switch(e.params[t]){case 4:this._coreService.modes.insertMode=!0;break;case 20:this._optionsService.options.convertEol=!0;break}return!0}setModePrivate(e){for(let t=0;t<e.length;t++)switch(e.params[t]){case 1:this._coreService.decPrivateModes.applicationCursorKeys=!0;break;case 2:this._charsetService.setgCharset(0,Ki),this._charsetService.setgCharset(1,Ki),this._charsetService.setgCharset(2,Ki),this._charsetService.setgCharset(3,Ki);break;case 3:this._optionsService.rawOptions.windowOptions.setWinLines&&(this._bufferService.resize(132,this._bufferService.rows),this._onRequestReset.fire());break;case 6:this._coreService.decPrivateModes.origin=!0,this._setCursor(0,0);break;case 7:this._coreService.decPrivateModes.wraparound=!0;break;case 12:this._optionsService.options.cursorBlink=!0;break;case 45:this._coreService.decPrivateModes.reverseWraparound=!0;break;case 66:this._logService.debug("Serial port requested application keypad."),this._coreService.decPrivateModes.applicationKeypad=!0,this._onRequestSyncScrollBar.fire();break;case 9:this._coreMouseService.activeProtocol="X10";break;case 1e3:this._coreMouseService.activeProtocol="VT200";break;case 1002:this._coreMouseService.activeProtocol="DRAG";break;case 1003:this._coreMouseService.activeProtocol="ANY";break;case 1004:this._coreService.decPrivateModes.sendFocus=!0,this._onRequestSendFocus.fire();break;case 1005:this._logService.debug("DECSET 1005 not supported (see #2507)");break;case 1006:this._coreMouseService.activeEncoding="SGR";break;case 1015:this._logService.debug("DECSET 1015 not supported (see #2507)");break;case 1016:this._coreMouseService.activeEncoding="SGR_PIXELS";break;case 25:this._coreService.isCursorHidden=!1;break;case 1048:this.saveCursor();break;case 1049:this.saveCursor();case 47:case 1047:this._bufferService.buffers.activateAltBuffer(this._eraseAttrData()),this._coreService.isCursorInitialized=!0,this._onRequestRefreshRows.fire(void 0),this._onRequestSyncScrollBar.fire();break;case 2004:this._coreService.decPrivateModes.bracketedPasteMode=!0;break;case 2026:this._coreService.decPrivateModes.synchronizedOutput=!0;break}return!0}resetMode(e){for(let t=0;t<e.length;t++)switch(e.params[t]){case 4:this._coreService.modes.insertMode=!1;break;case 20:this._optionsService.options.convertEol=!1;break}return!0}resetModePrivate(e){for(let t=0;t<e.length;t++)switch(e.params[t]){case 1:this._coreService.decPrivateModes.applicationCursorKeys=!1;break;case 3:this._optionsService.rawOptions.windowOptions.setWinLines&&(this._bufferService.resize(80,this._bufferService.rows),this._onRequestReset.fire());break;case 6:this._coreService.decPrivateModes.origin=!1,this._setCursor(0,0);break;case 7:this._coreService.decPrivateModes.wraparound=!1;break;case 12:this._optionsService.options.cursorBlink=!1;break;case 45:this._coreService.decPrivateModes.reverseWraparound=!1;break;case 66:this._logService.debug("Switching back to normal keypad."),this._coreService.decPrivateModes.applicationKeypad=!1,this._onRequestSyncScrollBar.fire();break;case 9:case 1e3:case 1002:case 1003:this._coreMouseService.activeProtocol="NONE";break;case 1004:this._coreService.decPrivateModes.sendFocus=!1;break;case 1005:this._logService.debug("DECRST 1005 not supported (see #2507)");break;case 1006:this._coreMouseService.activeEncoding="DEFAULT";break;case 1015:this._logService.debug("DECRST 1015 not supported (see #2507)");break;case 1016:this._coreMouseService.activeEncoding="DEFAULT";break;case 25:this._coreService.isCursorHidden=!0;break;case 1048:this.restoreCursor();break;case 1049:case 47:case 1047:this._bufferService.buffers.activateNormalBuffer(),e.params[t]===1049&&this.restoreCursor(),this._coreService.isCursorInitialized=!0,this._onRequestRefreshRows.fire(void 0),this._onRequestSyncScrollBar.fire();break;case 2004:this._coreService.decPrivateModes.bracketedPasteMode=!1;break;case 2026:this._coreService.decPrivateModes.synchronizedOutput=!1,this._onRequestRefreshRows.fire(void 0);break}return!0}requestMode(e,t){(_=>(_[_.NOT_RECOGNIZED=0]="NOT_RECOGNIZED",_[_.SET=1]="SET",_[_.RESET=2]="RESET",_[_.PERMANENTLY_SET=3]="PERMANENTLY_SET",_[_.PERMANENTLY_RESET=4]="PERMANENTLY_RESET"))(void 0||(i={}));let s=this._coreService.decPrivateModes,{activeProtocol:r,activeEncoding:o}=this._coreMouseService,n=this._coreService,{buffers:a,cols:h}=this._bufferService,{active:l,alt:c}=a,d=this._optionsService.rawOptions,p=(_,C)=>(n.triggerDataEvent(`${$.ESC}[${t?"":"?"}${_};${C}$y`),!0),f=_=>_?1:2,m=e.params[0];return t?m===2?p(m,4):m===4?p(m,f(n.modes.insertMode)):m===12?p(m,3):m===20?p(m,f(d.convertEol)):p(m,0):m===1?p(m,f(s.applicationCursorKeys)):m===3?p(m,d.windowOptions.setWinLines?h===80?2:h===132?1:0:0):m===6?p(m,f(s.origin)):m===7?p(m,f(s.wraparound)):m===8?p(m,3):m===9?p(m,f(r==="X10")):m===12?p(m,f(d.cursorBlink)):m===25?p(m,f(!n.isCursorHidden)):m===45?p(m,f(s.reverseWraparound)):m===66?p(m,f(s.applicationKeypad)):m===67?p(m,4):m===1e3?p(m,f(r==="VT200")):m===1002?p(m,f(r==="DRAG")):m===1003?p(m,f(r==="ANY")):m===1004?p(m,f(s.sendFocus)):m===1005?p(m,4):m===1006?p(m,f(o==="SGR")):m===1015?p(m,4):m===1016?p(m,f(o==="SGR_PIXELS")):m===1048?p(m,1):m===47||m===1047||m===1049?p(m,f(l===c)):m===2004?p(m,f(s.bracketedPasteMode)):m===2026?p(m,f(s.synchronizedOutput)):p(m,0)}_updateAttrColor(e,t,i,s,r){return t===2?(e|=50331648,e&=-16777216,e|=$r.fromColorRGB([i,s,r])):t===5&&(e&=-50331904,e|=33554432|i&255),e}_extractColor(e,t,i){let s=[0,0,-1,0,0,0],r=0,o=0;do{if(s[o+r]=e.params[t+o],e.hasSubParams(t+o)){let n=e.getSubParams(t+o),a=0;do s[1]===5&&(r=1),s[o+a+1+r]=n[a];while(++a<n.length&&a+o+1+r<s.length);break}if(s[1]===5&&o+r>=2||s[1]===2&&o+r>=5)break;s[1]&&(r=1)}while(++o+t<e.length&&o+r<s.length);for(let n=2;n<s.length;++n)s[n]===-1&&(s[n]=0);switch(s[0]){case 38:i.fg=this._updateAttrColor(i.fg,s[1],s[3],s[4],s[5]);break;case 48:i.bg=this._updateAttrColor(i.bg,s[1],s[3],s[4],s[5]);break;case 58:i.extended=i.extended.clone(),i.extended.underlineColor=this._updateAttrColor(i.extended.underlineColor,s[1],s[3],s[4],s[5])}return o}_processUnderline(e,t){t.extended=t.extended.clone(),(!~e||e>5)&&(e=1),t.extended.underlineStyle=e,t.fg|=268435456,e===0&&(t.fg&=-268435457),t.updateExtended()}_processSGR0(e){e.fg=Ee.fg,e.bg=Ee.bg,e.extended=e.extended.clone(),e.extended.underlineStyle=0,e.extended.underlineColor&=-67108864,e.updateExtended()}charAttributes(e){if(e.length===1&&e.params[0]===0)return this._processSGR0(this._curAttrData),!0;let t=e.length,i,s=this._curAttrData;for(let r=0;r<t;r++)i=e.params[r],i>=30&&i<=37?(s.fg&=-50331904,s.fg|=16777216|i-30):i>=40&&i<=47?(s.bg&=-50331904,s.bg|=16777216|i-40):i>=90&&i<=97?(s.fg&=-50331904,s.fg|=16777216|i-90|8):i>=100&&i<=107?(s.bg&=-50331904,s.bg|=16777216|i-100|8):i===0?this._processSGR0(s):i===1?s.fg|=134217728:i===3?s.bg|=67108864:i===4?(s.fg|=268435456,this._processUnderline(e.hasSubParams(r)?e.getSubParams(r)[0]:1,s)):i===5?s.fg|=536870912:i===7?s.fg|=67108864:i===8?s.fg|=1073741824:i===9?s.fg|=2147483648:i===2?s.bg|=134217728:i===21?this._processUnderline(2,s):i===22?(s.fg&=-134217729,s.bg&=-134217729):i===23?s.bg&=-67108865:i===24?(s.fg&=-268435457,this._processUnderline(0,s)):i===25?s.fg&=-536870913:i===27?s.fg&=-67108865:i===28?s.fg&=-1073741825:i===29?s.fg&=2147483647:i===39?(s.fg&=-67108864,s.fg|=Ee.fg&16777215):i===49?(s.bg&=-67108864,s.bg|=Ee.bg&16777215):i===38||i===48||i===58?r+=this._extractColor(e,r,s):i===53?s.bg|=1073741824:i===55?s.bg&=-1073741825:i===59?(s.extended=s.extended.clone(),s.extended.underlineColor=-1,s.updateExtended()):i===100?(s.fg&=-67108864,s.fg|=Ee.fg&16777215,s.bg&=-67108864,s.bg|=Ee.bg&16777215):this._logService.debug("Unknown SGR attribute: %d.",i);return!0}deviceStatus(e){switch(e.params[0]){case 5:this._coreService.triggerDataEvent(`${$.ESC}[0n`);break;case 6:let t=this._activeBuffer.y+1,i=this._activeBuffer.x+1;this._coreService.triggerDataEvent(`${$.ESC}[${t};${i}R`);break}return!0}deviceStatusPrivate(e){switch(e.params[0]){case 6:let t=this._activeBuffer.y+1,i=this._activeBuffer.x+1;this._coreService.triggerDataEvent(`${$.ESC}[?${t};${i}R`);break;case 15:break;case 25:break;case 26:break;case 53:break}return!0}softReset(e){return this._coreService.isCursorHidden=!1,this._onRequestSyncScrollBar.fire(),this._activeBuffer.scrollTop=0,this._activeBuffer.scrollBottom=this._bufferService.rows-1,this._curAttrData=Ee.clone(),this._coreService.reset(),this._charsetService.reset(),this._activeBuffer.savedX=0,this._activeBuffer.savedY=this._activeBuffer.ybase,this._activeBuffer.savedCurAttrData.fg=this._curAttrData.fg,this._activeBuffer.savedCurAttrData.bg=this._curAttrData.bg,this._activeBuffer.savedCharset=this._charsetService.charset,this._coreService.decPrivateModes.origin=!1,!0}setCursorStyle(e){let t=e.length===0?1:e.params[0];if(t===0)this._coreService.decPrivateModes.cursorStyle=void 0,this._coreService.decPrivateModes.cursorBlink=void 0;else{switch(t){case 1:case 2:this._coreService.decPrivateModes.cursorStyle="block";break;case 3:case 4:this._coreService.decPrivateModes.cursorStyle="underline";break;case 5:case 6:this._coreService.decPrivateModes.cursorStyle="bar";break}let i=t%2===1;this._coreService.decPrivateModes.cursorBlink=i}return!0}setScrollRegion(e){let t=e.params[0]||1,i;return(e.length<2||(i=e.params[1])>this._bufferService.rows||i===0)&&(i=this._bufferService.rows),i>t&&(this._activeBuffer.scrollTop=t-1,this._activeBuffer.scrollBottom=i-1,this._setCursor(0,0)),!0}windowOptions(e){if(!id(e.params[0],this._optionsService.rawOptions.windowOptions))return!0;let t=e.length>1?e.params[1]:0;switch(e.params[0]){case 14:t!==2&&this._onRequestWindowsOptionsReport.fire(0);break;case 16:this._onRequestWindowsOptionsReport.fire(1);break;case 18:this._bufferService&&this._coreService.triggerDataEvent(`${$.ESC}[8;${this._bufferService.rows};${this._bufferService.cols}t`);break;case 22:(t===0||t===2)&&(this._windowTitleStack.push(this._windowTitle),this._windowTitleStack.length>td&&this._windowTitleStack.shift()),(t===0||t===1)&&(this._iconNameStack.push(this._iconName),this._iconNameStack.length>td&&this._iconNameStack.shift());break;case 23:(t===0||t===2)&&this._windowTitleStack.length&&this.setTitle(this._windowTitleStack.pop()),(t===0||t===1)&&this._iconNameStack.length&&this.setIconName(this._iconNameStack.pop());break}return!0}saveCursor(e){return this._activeBuffer.savedX=this._activeBuffer.x,this._activeBuffer.savedY=this._activeBuffer.ybase+this._activeBuffer.y,this._activeBuffer.savedCurAttrData.fg=this._curAttrData.fg,this._activeBuffer.savedCurAttrData.bg=this._curAttrData.bg,this._activeBuffer.savedCharset=this._charsetService.charset,!0}restoreCursor(e){return this._activeBuffer.x=this._activeBuffer.savedX||0,this._activeBuffer.y=Math.max(this._activeBuffer.savedY-this._activeBuffer.ybase,0),this._curAttrData.fg=this._activeBuffer.savedCurAttrData.fg,this._curAttrData.bg=this._activeBuffer.savedCurAttrData.bg,this._charsetService.charset=this._savedCharset,this._activeBuffer.savedCharset&&(this._charsetService.charset=this._activeBuffer.savedCharset),this._restrictCursor(),!0}setTitle(e){return this._windowTitle=e,this._onTitleChange.fire(e),!0}setIconName(e){return this._iconName=e,!0}setOrReportIndexedColor(e){let t=[],i=e.split(";");for(;i.length>1;){let s=i.shift(),r=i.shift();if(/^\d+$/.exec(s)){let o=parseInt(s);if(od(o))if(r==="?")t.push({type:0,index:o});else{let n=ed(r);n&&t.push({type:1,index:o,color:n})}}}return t.length&&this._onColor.fire(t),!0}setHyperlink(e){let t=e.indexOf(";");if(t===-1)return!0;let i=e.slice(0,t).trim(),s=e.slice(t+1);return s?this._createHyperlink(i,s):i.trim()?!1:this._finishHyperlink()}_createHyperlink(e,t){this._getCurrentLinkId()&&this._finishHyperlink();let i=e.split(":"),s,r=i.findIndex(o=>o.startsWith("id="));return r!==-1&&(s=i[r].slice(3)||void 0),this._curAttrData.extended=this._curAttrData.extended.clone(),this._curAttrData.extended.urlId=this._oscLinkService.registerLink({id:s,uri:t}),this._curAttrData.updateExtended(),!0}_finishHyperlink(){return this._curAttrData.extended=this._curAttrData.extended.clone(),this._curAttrData.extended.urlId=0,this._curAttrData.updateExtended(),!0}_setOrReportSpecialColor(e,t){let i=e.split(";");for(let s=0;s<i.length&&!(t>=this._specialColors.length);++s,++t)if(i[s]==="?")this._onColor.fire([{type:0,index:this._specialColors[t]}]);else{let r=ed(i[s]);r&&this._onColor.fire([{type:1,index:this._specialColors[t],color:r}])}return!0}setOrReportFgColor(e){return this._setOrReportSpecialColor(e,0)}setOrReportBgColor(e){return this._setOrReportSpecialColor(e,1)}setOrReportCursorColor(e){return this._setOrReportSpecialColor(e,2)}restoreIndexedColor(e){if(!e)return this._onColor.fire([{type:2}]),!0;let t=[],i=e.split(";");for(let s=0;s<i.length;++s)if(/^\d+$/.exec(i[s])){let r=parseInt(i[s]);od(r)&&t.push({type:2,index:r})}return t.length&&this._onColor.fire(t),!0}restoreFgColor(e){return this._onColor.fire([{type:2,index:256}]),!0}restoreBgColor(e){return this._onColor.fire([{type:2,index:257}]),!0}restoreCursorColor(e){return this._onColor.fire([{type:2,index:258}]),!0}nextLine(){return this._activeBuffer.x=0,this.index(),!0}keypadApplicationMode(){return this._logService.debug("Serial port requested application keypad."),this._coreService.decPrivateModes.applicationKeypad=!0,this._onRequestSyncScrollBar.fire(),!0}keypadNumericMode(){return this._logService.debug("Switching back to normal keypad."),this._coreService.decPrivateModes.applicationKeypad=!1,this._onRequestSyncScrollBar.fire(),!0}selectDefaultCharset(){return this._charsetService.setgLevel(0),this._charsetService.setgCharset(0,Ki),!0}selectCharset(e){return e.length!==2?(this.selectDefaultCharset(),!0):(e[0]==="/"||this._charsetService.setgCharset(Hv[e[0]],De[e[1]]||Ki),!0)}index(){return this._restrictCursor(),this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData())):this._activeBuffer.y>=this._bufferService.rows&&(this._activeBuffer.y=this._bufferService.rows-1),this._restrictCursor(),!0}tabSet(){return this._activeBuffer.tabs[this._activeBuffer.x]=!0,!0}reverseIndex(){if(this._restrictCursor(),this._activeBuffer.y===this._activeBuffer.scrollTop){let e=this._activeBuffer.scrollBottom-this._activeBuffer.scrollTop;this._activeBuffer.lines.shiftElements(this._activeBuffer.ybase+this._activeBuffer.y,e,1),this._activeBuffer.lines.set(this._activeBuffer.ybase+this._activeBuffer.y,this._activeBuffer.getBlankLine(this._eraseAttrData())),this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom)}else this._activeBuffer.y--,this._restrictCursor();return!0}fullReset(){return this._parser.reset(),this._onRequestReset.fire(),!0}reset(){this._curAttrData=Ee.clone(),this._eraseAttrDataInternal=Ee.clone()}_eraseAttrData(){return this._eraseAttrDataInternal.bg&=-67108864,this._eraseAttrDataInternal.bg|=this._curAttrData.bg&67108863,this._eraseAttrDataInternal}setgLevel(e){return this._charsetService.setgLevel(e),!0}screenAlignmentPattern(){let e=new bt;e.content=1<<22|69,e.fg=this._curAttrData.fg,e.bg=this._curAttrData.bg,this._setCursor(0,0);for(let t=0;t<this._bufferService.rows;++t){let i=this._activeBuffer.ybase+this._activeBuffer.y+t,s=this._activeBuffer.lines.get(i);s&&(s.fill(e),s.isWrapped=!1)}return this._dirtyRowTracker.markAllDirty(),this._setCursor(0,0),!0}requestStatusString(e,t){let i=n=>(this._coreService.triggerDataEvent(`${$.ESC}${n}${$.ESC}\\`),!0),s=this._bufferService.buffer,r=this._optionsService.rawOptions;return i(e==='"q'?`P1$r${this._curAttrData.isProtected()?1:0}"q`:e==='"p'?'P1$r61;1"p':e==="r"?`P1$r${s.scrollTop+1};${s.scrollBottom+1}r`:e==="m"?"P1$r0m":e===" q"?`P1$r${{block:2,underline:4,bar:6}[r.cursorStyle]-(r.cursorBlink?1:0)} q`:"P0$r")}markRangeDirty(e,t){this._dirtyRowTracker.markRangeDirty(e,t)}},ll=class{constructor(e){this._bufferService=e,this.clearRange()}clearRange(){this.start=this._bufferService.buffer.y,this.end=this._bufferService.buffer.y}markDirty(e){e<this.start?this.start=e:e>this.end&&(this.end=e)}markRangeDirty(e,t){e>t&&(rd=e,e=t,t=rd),e<this.start&&(this.start=e),t>this.end&&(this.end=t)}markAllDirty(){this.markRangeDirty(0,this._bufferService.rows-1)}};ll=we([z(0,Ze)],ll);Wv=5e7,nd=12,Vv=50,Uv=class extends G{constructor(e){super(),this._action=e,this._writeBuffer=[],this._callbacks=[],this._pendingData=0,this._bufferOffset=0,this._isSyncWriting=!1,this._syncCalls=0,this._didUserInput=!1,this._onWriteParsed=this._register(new M),this.onWriteParsed=this._onWriteParsed.event}handleUserInput(){this._didUserInput=!0}writeSync(e,t){if(t!==void 0&&this._syncCalls>t){this._syncCalls=0;return}if(this._pendingData+=e.length,this._writeBuffer.push(e),this._callbacks.push(void 0),this._syncCalls++,this._isSyncWriting)return;this._isSyncWriting=!0;let i;for(;i=this._writeBuffer.shift();){this._action(i);let s=this._callbacks.shift();s&&s()}this._pendingData=0,this._bufferOffset=2147483647,this._isSyncWriting=!1,this._syncCalls=0}write(e,t){if(this._pendingData>Wv)throw new Error("write data discarded, use flow control to avoid losing data");if(!this._writeBuffer.length){if(this._bufferOffset=0,this._didUserInput){this._didUserInput=!1,this._pendingData+=e.length,this._writeBuffer.push(e),this._callbacks.push(t),this._innerWrite();return}setTimeout(()=>this._innerWrite())}this._pendingData+=e.length,this._writeBuffer.push(e),this._callbacks.push(t)}_innerWrite(e=0,t=!0){let i=e||performance.now();for(;this._writeBuffer.length>this._bufferOffset;){let s=this._writeBuffer[this._bufferOffset],r=this._action(s,t);if(r){let n=a=>performance.now()-i>=nd?setTimeout(()=>this._innerWrite(0,a)):this._innerWrite(i,a);r.catch(a=>(queueMicrotask(()=>{throw a}),Promise.resolve(!1))).then(n);return}let o=this._callbacks[this._bufferOffset];if(o&&o(),this._bufferOffset++,this._pendingData-=s.length,performance.now()-i>=nd)break}this._writeBuffer.length>this._bufferOffset?(this._bufferOffset>Vv&&(this._writeBuffer=this._writeBuffer.slice(this._bufferOffset),this._callbacks=this._callbacks.slice(this._bufferOffset),this._bufferOffset=0),setTimeout(()=>this._innerWrite())):(this._writeBuffer.length=0,this._callbacks.length=0,this._pendingData=0,this._bufferOffset=0),this._onWriteParsed.fire()}},hl=class{constructor(e){this._bufferService=e,this._nextId=1,this._entriesWithId=new Map,this._dataByLinkId=new Map}registerLink(e){let t=this._bufferService.buffer;if(e.id===void 0){let a=t.addMarker(t.ybase+t.y),h={data:e,id:this._nextId++,lines:[a]};return a.onDispose(()=>this._removeMarkerFromLink(h,a)),this._dataByLinkId.set(h.id,h),h.id}let i=e,s=this._getEntryIdKey(i),r=this._entriesWithId.get(s);if(r)return this.addLineToLink(r.id,t.ybase+t.y),r.id;let o=t.addMarker(t.ybase+t.y),n={id:this._nextId++,key:this._getEntryIdKey(i),data:i,lines:[o]};return o.onDispose(()=>this._removeMarkerFromLink(n,o)),this._entriesWithId.set(n.key,n),this._dataByLinkId.set(n.id,n),n.id}addLineToLink(e,t){let i=this._dataByLinkId.get(e);if(i&&i.lines.every(s=>s.line!==t)){let s=this._bufferService.buffer.addMarker(t);i.lines.push(s),s.onDispose(()=>this._removeMarkerFromLink(i,s))}}getLinkData(e){return this._dataByLinkId.get(e)?.data}_getEntryIdKey(e){return`${e.id};;${e.uri}`}_removeMarkerFromLink(e,t){let i=e.lines.indexOf(t);i!==-1&&(e.lines.splice(i,1),e.lines.length===0&&(e.data.id!==void 0&&this._entriesWithId.delete(e.key),this._dataByLinkId.delete(e.id)))}};hl=we([z(0,Ze)],hl);ad=!1,qv=class extends G{constructor(e){super(),this._windowsWrappingHeuristics=this._register(new Ss),this._onBinary=this._register(new M),this.onBinary=this._onBinary.event,this._onData=this._register(new M),this.onData=this._onData.event,this._onLineFeed=this._register(new M),this.onLineFeed=this._onLineFeed.event,this._onResize=this._register(new M),this.onResize=this._onResize.event,this._onWriteParsed=this._register(new M),this.onWriteParsed=this._onWriteParsed.event,this._onScroll=this._register(new M),this._instantiationService=new fv,this.optionsService=this._register(new kv(e)),this._instantiationService.setService(Qe,this.optionsService),this._bufferService=this._register(this._instantiationService.createInstance(rl)),this._instantiationService.setService(Ze,this._bufferService),this._logService=this._register(this._instantiationService.createInstance(sl)),this._instantiationService.setService(yd,this._logService),this.coreService=this._register(this._instantiationService.createInstance(ol)),this._instantiationService.setService(Ji,this.coreService),this.coreMouseService=this._register(this._instantiationService.createInstance(nl)),this._instantiationService.setService(bd,this.coreMouseService),this.unicodeService=this._register(this._instantiationService.createInstance(ji)),this._instantiationService.setService(Im,this.unicodeService),this._charsetService=this._instantiationService.createInstance(Lv),this._instantiationService.setService(Om,this._charsetService),this._oscLinkService=this._instantiationService.createInstance(hl),this._instantiationService.setService(wd,this._oscLinkService),this._inputHandler=this._register(new Fv(this._bufferService,this._charsetService,this.coreService,this._logService,this.optionsService,this._oscLinkService,this.coreMouseService,this.unicodeService)),this._register(Ve.forward(this._inputHandler.onLineFeed,this._onLineFeed)),this._register(this._inputHandler),this._register(Ve.forward(this._bufferService.onResize,this._onResize)),this._register(Ve.forward(this.coreService.onData,this._onData)),this._register(Ve.forward(this.coreService.onBinary,this._onBinary)),this._register(this.coreService.onRequestScrollToBottom(()=>this.scrollToBottom(!0))),this._register(this.coreService.onUserInput(()=>this._writeBuffer.handleUserInput())),this._register(this.optionsService.onMultipleOptionChange(["windowsMode","windowsPty"],()=>this._handleWindowsPtyOptionChange())),this._register(this._bufferService.onScroll(()=>{this._onScroll.fire({position:this._bufferService.buffer.ydisp}),this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop,this._bufferService.buffer.scrollBottom)})),this._writeBuffer=this._register(new Uv((t,i)=>this._inputHandler.parse(t,i))),this._register(Ve.forward(this._writeBuffer.onWriteParsed,this._onWriteParsed))}get onScroll(){return this._onScrollApi||(this._onScrollApi=this._register(new M),this._onScroll.event(e=>{this._onScrollApi?.fire(e.position)})),this._onScrollApi.event}get cols(){return this._bufferService.cols}get rows(){return this._bufferService.rows}get buffers(){return this._bufferService.buffers}get options(){return this.optionsService.options}set options(e){for(let t in e)this.optionsService.options[t]=e[t]}write(e,t){this._writeBuffer.write(e,t)}writeSync(e,t){this._logService.logLevel<=3&&!ad&&(this._logService.warn("writeSync is unreliable and will be removed soon."),ad=!0),this._writeBuffer.writeSync(e,t)}input(e,t=!0){this.coreService.triggerDataEvent(e,t)}resize(e,t){isNaN(e)||isNaN(t)||(e=Math.max(e,lu),t=Math.max(t,hu),this._bufferService.resize(e,t))}scroll(e,t=!1){this._bufferService.scroll(e,t)}scrollLines(e,t){this._bufferService.scrollLines(e,t)}scrollPages(e){this.scrollLines(e*(this.rows-1))}scrollToTop(){this.scrollLines(-this._bufferService.buffer.ydisp)}scrollToBottom(e){this.scrollLines(this._bufferService.buffer.ybase-this._bufferService.buffer.ydisp)}scrollToLine(e){let t=e-this._bufferService.buffer.ydisp;t!==0&&this.scrollLines(t)}registerEscHandler(e,t){return this._inputHandler.registerEscHandler(e,t)}registerDcsHandler(e,t){return this._inputHandler.registerDcsHandler(e,t)}registerCsiHandler(e,t){return this._inputHandler.registerCsiHandler(e,t)}registerOscHandler(e,t){return this._inputHandler.registerOscHandler(e,t)}_setup(){this._handleWindowsPtyOptionChange()}reset(){this._inputHandler.reset(),this._bufferService.reset(),this._charsetService.reset(),this.coreService.reset(),this.coreMouseService.reset()}_handleWindowsPtyOptionChange(){let e=!1,t=this.optionsService.rawOptions.windowsPty;t&&t.buildNumber!==void 0&&t.buildNumber!==void 0?e=t.backend==="conpty"&&t.buildNumber<21376:this.optionsService.rawOptions.windowsMode&&(e=!0),e?this._enableWindowsWrappingHeuristics():this._windowsWrappingHeuristics.clear()}_enableWindowsWrappingHeuristics(){if(!this._windowsWrappingHeuristics.value){let e=[];e.push(this.onLineFeed(Zc.bind(null,this._bufferService))),e.push(this.registerCsiHandler({final:"H"},()=>(Zc(this._bufferService),!1))),this._windowsWrappingHeuristics.value=me(()=>{for(let t of e)t.dispose()})}}},Kv={48:["0",")"],49:["1","!"],50:["2","@"],51:["3","#"],52:["4","$"],53:["5","%"],54:["6","^"],55:["7","&"],56:["8","*"],57:["9","("],186:[";",":"],187:["=","+"],188:[",","<"],189:["-","_"],190:[".",">"],191:["/","?"],192:["`","~"],219:["[","{"],220:["\\","|"],221:["]","}"],222:["'",'"']};Ce=0,Yv=class{constructor(e){this._getKey=e,this._array=[],this._insertedValues=[],this._flushInsertedTask=new No,this._isFlushingInserted=!1,this._deletedIndices=[],this._flushDeletedTask=new No,this._isFlushingDeleted=!1}clear(){this._array.length=0,this._insertedValues.length=0,this._flushInsertedTask.clear(),this._isFlushingInserted=!1,this._deletedIndices.length=0,this._flushDeletedTask.clear(),this._isFlushingDeleted=!1}insert(e){this._flushCleanupDeleted(),this._insertedValues.length===0&&this._flushInsertedTask.enqueue(()=>this._flushInserted()),this._insertedValues.push(e)}_flushInserted(){let e=this._insertedValues.sort((r,o)=>this._getKey(r)-this._getKey(o)),t=0,i=0,s=new Array(this._array.length+this._insertedValues.length);for(let r=0;r<s.length;r++)i>=this._array.length||this._getKey(e[t])<=this._getKey(this._array[i])?(s[r]=e[t],t++):s[r]=this._array[i++];this._array=s,this._insertedValues.length=0}_flushCleanupInserted(){!this._isFlushingInserted&&this._insertedValues.length>0&&this._flushInsertedTask.flush()}delete(e){if(this._flushCleanupInserted(),this._array.length===0)return!1;let t=this._getKey(e);if(t===void 0||(Ce=this._search(t),Ce===-1)||this._getKey(this._array[Ce])!==t)return!1;do if(this._array[Ce]===e)return this._deletedIndices.length===0&&this._flushDeletedTask.enqueue(()=>this._flushDeleted()),this._deletedIndices.push(Ce),!0;while(++Ce<this._array.length&&this._getKey(this._array[Ce])===t);return!1}_flushDeleted(){this._isFlushingDeleted=!0;let e=this._deletedIndices.sort((r,o)=>r-o),t=0,i=new Array(this._array.length-e.length),s=0;for(let r=0;r<this._array.length;r++)e[t]===r?t++:i[s++]=this._array[r];this._array=i,this._deletedIndices.length=0,this._isFlushingDeleted=!1}_flushCleanupDeleted(){!this._isFlushingDeleted&&this._deletedIndices.length>0&&this._flushDeletedTask.flush()}*getKeyIterator(e){if(this._flushCleanupInserted(),this._flushCleanupDeleted(),this._array.length!==0&&(Ce=this._search(e),!(Ce<0||Ce>=this._array.length)&&this._getKey(this._array[Ce])===e))do yield this._array[Ce];while(++Ce<this._array.length&&this._getKey(this._array[Ce])===e)}forEachByKey(e,t){if(this._flushCleanupInserted(),this._flushCleanupDeleted(),this._array.length!==0&&(Ce=this._search(e),!(Ce<0||Ce>=this._array.length)&&this._getKey(this._array[Ce])===e))do t(this._array[Ce]);while(++Ce<this._array.length&&this._getKey(this._array[Ce])===e)}values(){return this._flushCleanupInserted(),this._flushCleanupDeleted(),[...this._array].values()}_search(e){let t=0,i=this._array.length-1;for(;i>=t;){let s=t+i>>1,r=this._getKey(this._array[s]);if(r>e)i=s-1;else if(r<e)t=s+1;else{for(;s>0&&this._getKey(this._array[s-1])===e;)s--;return s}}return t}},Ea=0,ld=0,Gv=class extends G{constructor(){super(),this._decorations=new Yv(e=>e?.marker.line),this._onDecorationRegistered=this._register(new M),this.onDecorationRegistered=this._onDecorationRegistered.event,this._onDecorationRemoved=this._register(new M),this.onDecorationRemoved=this._onDecorationRemoved.event,this._register(me(()=>this.reset()))}get decorations(){return this._decorations.values()}registerDecoration(e){if(e.marker.isDisposed)return;let t=new Xv(e);if(t){let i=t.marker.onDispose(()=>t.dispose()),s=t.onDispose(()=>{s.dispose(),t&&(this._decorations.delete(t)&&this._onDecorationRemoved.fire(t),i.dispose())});this._decorations.insert(t),this._onDecorationRegistered.fire(t)}return t}reset(){for(let e of this._decorations.values())e.dispose();this._decorations.clear()}*getDecorationsAtCell(e,t,i){let s=0,r=0;for(let o of this._decorations.getKeyIterator(t))s=o.options.x??0,r=s+(o.options.width??1),e>=s&&e<r&&(!i||(o.options.layer??"bottom")===i)&&(yield o)}forEachDecorationAtCell(e,t,i,s){this._decorations.forEachByKey(t,r=>{Ea=r.options.x??0,ld=Ea+(r.options.width??1),e>=Ea&&e<ld&&(!i||(r.options.layer??"bottom")===i)&&s(r)})}},Xv=class extends yi{constructor(e){super(),this.options=e,this.onRenderEmitter=this.add(new M),this.onRender=this.onRenderEmitter.event,this._onDispose=this.add(new M),this.onDispose=this._onDispose.event,this._cachedBg=null,this._cachedFg=null,this.marker=e.marker,this.options.overviewRulerOptions&&!this.options.overviewRulerOptions.position&&(this.options.overviewRulerOptions.position="full")}get backgroundColorRGB(){return this._cachedBg===null&&(this.options.backgroundColor?this._cachedBg=be.toColor(this.options.backgroundColor):this._cachedBg=void 0),this._cachedBg}get foregroundColorRGB(){return this._cachedFg===null&&(this.options.foregroundColor?this._cachedFg=be.toColor(this.options.foregroundColor):this._cachedFg=void 0),this._cachedFg}dispose(){this._onDispose.fire(),super.dispose()}},Jv=1e3,Zv=class{constructor(e,t=Jv){this._renderCallback=e,this._debounceThresholdMS=t,this._lastRefreshMs=0,this._additionalRefreshRequested=!1}dispose(){this._refreshTimeoutID&&clearTimeout(this._refreshTimeoutID)}refresh(e,t,i){this._rowCount=i,e=e!==void 0?e:0,t=t!==void 0?t:this._rowCount-1,this._rowStart=this._rowStart!==void 0?Math.min(this._rowStart,e):e,this._rowEnd=this._rowEnd!==void 0?Math.max(this._rowEnd,t):t;let s=performance.now();if(s-this._lastRefreshMs>=this._debounceThresholdMS)this._lastRefreshMs=s,this._innerRefresh();else if(!this._additionalRefreshRequested){let r=s-this._lastRefreshMs,o=this._debounceThresholdMS-r;this._additionalRefreshRequested=!0,this._refreshTimeoutID=window.setTimeout(()=>{this._lastRefreshMs=performance.now(),this._innerRefresh(),this._additionalRefreshRequested=!1,this._refreshTimeoutID=void 0},o)}}_innerRefresh(){if(this._rowStart===void 0||this._rowEnd===void 0||this._rowCount===void 0)return;let e=Math.max(this._rowStart,0),t=Math.min(this._rowEnd,this._rowCount-1);this._rowStart=void 0,this._rowEnd=void 0,this._renderCallback(e,t)}},hd=20,cd=!1,Ho=class extends G{constructor(e,t,i,s){super(),this._terminal=e,this._coreBrowserService=i,this._renderService=s,this._rowColumns=new WeakMap,this._liveRegionLineCount=0,this._charsToConsume=[],this._charsToAnnounce="";let r=this._coreBrowserService.mainDocument;this._accessibilityContainer=r.createElement("div"),this._accessibilityContainer.classList.add("xterm-accessibility"),this._rowContainer=r.createElement("div"),this._rowContainer.setAttribute("role","list"),this._rowContainer.classList.add("xterm-accessibility-tree"),this._rowElements=[];for(let o=0;o<this._terminal.rows;o++)this._rowElements[o]=this._createAccessibilityTreeNode(),this._rowContainer.appendChild(this._rowElements[o]);if(this._topBoundaryFocusListener=o=>this._handleBoundaryFocus(o,0),this._bottomBoundaryFocusListener=o=>this._handleBoundaryFocus(o,1),this._rowElements[0].addEventListener("focus",this._topBoundaryFocusListener),this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._accessibilityContainer.appendChild(this._rowContainer),this._liveRegion=r.createElement("div"),this._liveRegion.classList.add("live-region"),this._liveRegion.setAttribute("aria-live","assertive"),this._accessibilityContainer.appendChild(this._liveRegion),this._liveRegionDebouncer=this._register(new Zv(this._renderRows.bind(this))),!this._terminal.element)throw new Error("Cannot enable accessibility before Terminal.open");cd?(this._accessibilityContainer.classList.add("debug"),this._rowContainer.classList.add("debug"),this._debugRootContainer=r.createElement("div"),this._debugRootContainer.classList.add("xterm"),this._debugRootContainer.appendChild(r.createTextNode("------start a11y------")),this._debugRootContainer.appendChild(this._accessibilityContainer),this._debugRootContainer.appendChild(r.createTextNode("------end a11y------")),this._terminal.element.insertAdjacentElement("afterend",this._debugRootContainer)):this._terminal.element.insertAdjacentElement("afterbegin",this._accessibilityContainer),this._register(this._terminal.onResize(o=>this._handleResize(o.rows))),this._register(this._terminal.onRender(o=>this._refreshRows(o.start,o.end))),this._register(this._terminal.onScroll(()=>this._refreshRows())),this._register(this._terminal.onA11yChar(o=>this._handleChar(o))),this._register(this._terminal.onLineFeed(()=>this._handleChar(`
`))),this._register(this._terminal.onA11yTab(o=>this._handleTab(o))),this._register(this._terminal.onKey(o=>this._handleKey(o.key))),this._register(this._terminal.onBlur(()=>this._clearLiveRegion())),this._register(this._renderService.onDimensionsChange(()=>this._refreshRowsDimensions())),this._register(W(r,"selectionchange",()=>this._handleSelectionChange())),this._register(this._coreBrowserService.onDprChange(()=>this._refreshRowsDimensions())),this._refreshRowsDimensions(),this._refreshRows(),this._register(me(()=>{cd?this._debugRootContainer.remove():this._accessibilityContainer.remove(),this._rowElements.length=0}))}_handleTab(e){for(let t=0;t<e;t++)this._handleChar(" ")}_handleChar(e){this._liveRegionLineCount<hd+1&&(this._charsToConsume.length>0?this._charsToConsume.shift()!==e&&(this._charsToAnnounce+=e):this._charsToAnnounce+=e,e===`
`&&(this._liveRegionLineCount++,this._liveRegionLineCount===hd+1&&(this._liveRegion.textContent+=$a.get())))}_clearLiveRegion(){this._liveRegion.textContent="",this._liveRegionLineCount=0}_handleKey(e){this._clearLiveRegion(),/\p{Control}/u.test(e)||this._charsToConsume.push(e)}_refreshRows(e,t){this._liveRegionDebouncer.refresh(e,t,this._terminal.rows)}_renderRows(e,t){let i=this._terminal.buffer,s=i.lines.length.toString();for(let r=e;r<=t;r++){let o=i.lines.get(i.ydisp+r),n=[],a=o?.translateToString(!0,void 0,void 0,n)||"",h=(i.ydisp+r+1).toString(),l=this._rowElements[r];l&&(a.length===0?(l.textContent="\xA0",this._rowColumns.set(l,[0,1])):(l.textContent=a,this._rowColumns.set(l,n)),l.setAttribute("aria-posinset",h),l.setAttribute("aria-setsize",s),this._alignRowWidth(l))}this._announceCharacters()}_announceCharacters(){this._charsToAnnounce.length!==0&&(this._liveRegion.textContent+=this._charsToAnnounce,this._charsToAnnounce="")}_handleBoundaryFocus(e,t){let i=e.target,s=this._rowElements[t===0?1:this._rowElements.length-2],r=i.getAttribute("aria-posinset"),o=t===0?"1":`${this._terminal.buffer.lines.length}`;if(r===o||e.relatedTarget!==s)return;let n,a;if(t===0?(n=i,a=this._rowElements.pop(),this._rowContainer.removeChild(a)):(n=this._rowElements.shift(),a=i,this._rowContainer.removeChild(n)),n.removeEventListener("focus",this._topBoundaryFocusListener),a.removeEventListener("focus",this._bottomBoundaryFocusListener),t===0){let h=this._createAccessibilityTreeNode();this._rowElements.unshift(h),this._rowContainer.insertAdjacentElement("afterbegin",h)}else{let h=this._createAccessibilityTreeNode();this._rowElements.push(h),this._rowContainer.appendChild(h)}this._rowElements[0].addEventListener("focus",this._topBoundaryFocusListener),this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._terminal.scrollLines(t===0?-1:1),this._rowElements[t===0?1:this._rowElements.length-2].focus(),e.preventDefault(),e.stopImmediatePropagation()}_handleSelectionChange(){if(this._rowElements.length===0)return;let e=this._coreBrowserService.mainDocument.getSelection();if(!e)return;if(e.isCollapsed){this._rowContainer.contains(e.anchorNode)&&this._terminal.clearSelection();return}if(!e.anchorNode||!e.focusNode){console.error("anchorNode and/or focusNode are null");return}let t={node:e.anchorNode,offset:e.anchorOffset},i={node:e.focusNode,offset:e.focusOffset};if((t.node.compareDocumentPosition(i.node)&Node.DOCUMENT_POSITION_PRECEDING||t.node===i.node&&t.offset>i.offset)&&([t,i]=[i,t]),t.node.compareDocumentPosition(this._rowElements[0])&(Node.DOCUMENT_POSITION_CONTAINED_BY|Node.DOCUMENT_POSITION_FOLLOWING)&&(t={node:this._rowElements[0].childNodes[0],offset:0}),!this._rowContainer.contains(t.node))return;let s=this._rowElements.slice(-1)[0];if(i.node.compareDocumentPosition(s)&(Node.DOCUMENT_POSITION_CONTAINED_BY|Node.DOCUMENT_POSITION_PRECEDING)&&(i={node:s,offset:s.textContent?.length??0}),!this._rowContainer.contains(i.node))return;let r=({node:a,offset:h})=>{let l=a instanceof Text?a.parentNode:a,c=parseInt(l?.getAttribute("aria-posinset"),10)-1;if(isNaN(c))return console.warn("row is invalid. Race condition?"),null;let d=this._rowColumns.get(l);if(!d)return console.warn("columns is null. Race condition?"),null;let p=h<d.length?d[h]:d.slice(-1)[0]+1;return p>=this._terminal.cols&&(++c,p=0),{row:c,column:p}},o=r(t),n=r(i);if(!(!o||!n)){if(o.row>n.row||o.row===n.row&&o.column>=n.column)throw new Error("invalid range");this._terminal.select(o.column,o.row,(n.row-o.row)*this._terminal.cols-o.column+n.column)}}_handleResize(e){this._rowElements[this._rowElements.length-1].removeEventListener("focus",this._bottomBoundaryFocusListener);for(let t=this._rowContainer.children.length;t<this._terminal.rows;t++)this._rowElements[t]=this._createAccessibilityTreeNode(),this._rowContainer.appendChild(this._rowElements[t]);for(;this._rowElements.length>e;)this._rowContainer.removeChild(this._rowElements.pop());this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._refreshRowsDimensions()}_createAccessibilityTreeNode(){let e=this._coreBrowserService.mainDocument.createElement("div");return e.setAttribute("role","listitem"),e.tabIndex=-1,this._refreshRowDimensions(e),e}_refreshRowsDimensions(){if(this._renderService.dimensions.css.cell.height){Object.assign(this._accessibilityContainer.style,{width:`${this._renderService.dimensions.css.canvas.width}px`,fontSize:`${this._terminal.options.fontSize}px`}),this._rowElements.length!==this._terminal.rows&&this._handleResize(this._terminal.rows);for(let e=0;e<this._terminal.rows;e++)this._refreshRowDimensions(this._rowElements[e]),this._alignRowWidth(this._rowElements[e])}}_refreshRowDimensions(e){e.style.height=`${this._renderService.dimensions.css.cell.height}px`}_alignRowWidth(e){e.style.transform="";let t=e.getBoundingClientRect().width,i=this._rowColumns.get(e)?.slice(-1)?.[0];if(!i)return;let s=i*this._renderService.dimensions.css.cell.width;e.style.transform=`scaleX(${s/t})`}};Ho=we([z(1,dl),z(2,ei),z(3,ti)],Ho);cl=class extends G{constructor(e,t,i,s,r){super(),this._element=e,this._mouseService=t,this._renderService=i,this._bufferService=s,this._linkProviderService=r,this._linkCacheDisposables=[],this._isMouseOut=!0,this._wasResized=!1,this._activeLine=-1,this._onShowLinkUnderline=this._register(new M),this.onShowLinkUnderline=this._onShowLinkUnderline.event,this._onHideLinkUnderline=this._register(new M),this.onHideLinkUnderline=this._onHideLinkUnderline.event,this._register(me(()=>{Gi(this._linkCacheDisposables),this._linkCacheDisposables.length=0,this._lastMouseEvent=void 0,this._activeProviderReplies?.clear()})),this._register(this._bufferService.onResize(()=>{this._clearCurrentLink(),this._wasResized=!0})),this._register(W(this._element,"mouseleave",()=>{this._isMouseOut=!0,this._clearCurrentLink()})),this._register(W(this._element,"mousemove",this._handleMouseMove.bind(this))),this._register(W(this._element,"mousedown",this._handleMouseDown.bind(this))),this._register(W(this._element,"mouseup",this._handleMouseUp.bind(this)))}get currentLink(){return this._currentLink}_handleMouseMove(e){this._lastMouseEvent=e;let t=this._positionFromMouseEvent(e,this._element,this._mouseService);if(!t)return;this._isMouseOut=!1;let i=e.composedPath();for(let s=0;s<i.length;s++){let r=i[s];if(r.classList.contains("xterm"))break;if(r.classList.contains("xterm-hover"))return}(!this._lastBufferCell||t.x!==this._lastBufferCell.x||t.y!==this._lastBufferCell.y)&&(this._handleHover(t),this._lastBufferCell=t)}_handleHover(e){if(this._activeLine!==e.y||this._wasResized){this._clearCurrentLink(),this._askForLink(e,!1),this._wasResized=!1;return}this._currentLink&&this._linkAtPosition(this._currentLink.link,e)||(this._clearCurrentLink(),this._askForLink(e,!0))}_askForLink(e,t){(!this._activeProviderReplies||!t)&&(this._activeProviderReplies?.forEach(s=>{s?.forEach(r=>{r.link.dispose&&r.link.dispose()})}),this._activeProviderReplies=new Map,this._activeLine=e.y);let i=!1;for(let[s,r]of this._linkProviderService.linkProviders.entries())t?this._activeProviderReplies?.get(s)&&(i=this._checkLinkProviderResult(s,e,i)):r.provideLinks(e.y,o=>{if(this._isMouseOut)return;let n=o?.map(a=>({link:a}));this._activeProviderReplies?.set(s,n),i=this._checkLinkProviderResult(s,e,i),this._activeProviderReplies?.size===this._linkProviderService.linkProviders.length&&this._removeIntersectingLinks(e.y,this._activeProviderReplies)})}_removeIntersectingLinks(e,t){let i=new Set;for(let s=0;s<t.size;s++){let r=t.get(s);if(r)for(let o=0;o<r.length;o++){let n=r[o],a=n.link.range.start.y<e?0:n.link.range.start.x,h=n.link.range.end.y>e?this._bufferService.cols:n.link.range.end.x;for(let l=a;l<=h;l++){if(i.has(l)){r.splice(o--,1);break}i.add(l)}}}}_checkLinkProviderResult(e,t,i){if(!this._activeProviderReplies)return i;let s=this._activeProviderReplies.get(e),r=!1;for(let o=0;o<e;o++)(!this._activeProviderReplies.has(o)||this._activeProviderReplies.get(o))&&(r=!0);if(!r&&s){let o=s.find(n=>this._linkAtPosition(n.link,t));o&&(i=!0,this._handleNewLink(o))}if(this._activeProviderReplies.size===this._linkProviderService.linkProviders.length&&!i)for(let o=0;o<this._activeProviderReplies.size;o++){let n=this._activeProviderReplies.get(o)?.find(a=>this._linkAtPosition(a.link,t));if(n){i=!0,this._handleNewLink(n);break}}return i}_handleMouseDown(){this._mouseDownLink=this._currentLink}_handleMouseUp(e){if(!this._currentLink)return;let t=this._positionFromMouseEvent(e,this._element,this._mouseService);t&&this._mouseDownLink&&Qv(this._mouseDownLink.link,this._currentLink.link)&&this._linkAtPosition(this._currentLink.link,t)&&this._currentLink.link.activate(e,this._currentLink.link.text)}_clearCurrentLink(e,t){!this._currentLink||!this._lastMouseEvent||(!e||!t||this._currentLink.link.range.start.y>=e&&this._currentLink.link.range.end.y<=t)&&(this._linkLeave(this._element,this._currentLink.link,this._lastMouseEvent),this._currentLink=void 0,Gi(this._linkCacheDisposables),this._linkCacheDisposables.length=0)}_handleNewLink(e){if(!this._lastMouseEvent)return;let t=this._positionFromMouseEvent(this._lastMouseEvent,this._element,this._mouseService);t&&this._linkAtPosition(e.link,t)&&(this._currentLink=e,this._currentLink.state={decorations:{underline:e.link.decorations===void 0?!0:e.link.decorations.underline,pointerCursor:e.link.decorations===void 0?!0:e.link.decorations.pointerCursor},isHovered:!0},this._linkHover(this._element,e.link,this._lastMouseEvent),e.link.decorations={},Object.defineProperties(e.link.decorations,{pointerCursor:{get:()=>this._currentLink?.state?.decorations.pointerCursor,set:i=>{this._currentLink?.state&&this._currentLink.state.decorations.pointerCursor!==i&&(this._currentLink.state.decorations.pointerCursor=i,this._currentLink.state.isHovered&&this._element.classList.toggle("xterm-cursor-pointer",i))}},underline:{get:()=>this._currentLink?.state?.decorations.underline,set:i=>{this._currentLink?.state&&this._currentLink?.state?.decorations.underline!==i&&(this._currentLink.state.decorations.underline=i,this._currentLink.state.isHovered&&this._fireUnderlineEvent(e.link,i))}}}),this._linkCacheDisposables.push(this._renderService.onRenderedViewportChange(i=>{if(!this._currentLink)return;let s=i.start===0?0:i.start+1+this._bufferService.buffer.ydisp,r=this._bufferService.buffer.ydisp+1+i.end;if(this._currentLink.link.range.start.y>=s&&this._currentLink.link.range.end.y<=r&&(this._clearCurrentLink(s,r),this._lastMouseEvent)){let o=this._positionFromMouseEvent(this._lastMouseEvent,this._element,this._mouseService);o&&this._askForLink(o,!1)}})))}_linkHover(e,t,i){this._currentLink?.state&&(this._currentLink.state.isHovered=!0,this._currentLink.state.decorations.underline&&this._fireUnderlineEvent(t,!0),this._currentLink.state.decorations.pointerCursor&&e.classList.add("xterm-cursor-pointer")),t.hover&&t.hover(i,t.text)}_fireUnderlineEvent(e,t){let i=e.range,s=this._bufferService.buffer.ydisp,r=this._createLinkUnderlineEvent(i.start.x-1,i.start.y-s-1,i.end.x,i.end.y-s-1,void 0);(t?this._onShowLinkUnderline:this._onHideLinkUnderline).fire(r)}_linkLeave(e,t,i){this._currentLink?.state&&(this._currentLink.state.isHovered=!1,this._currentLink.state.decorations.underline&&this._fireUnderlineEvent(t,!1),this._currentLink.state.decorations.pointerCursor&&e.classList.remove("xterm-cursor-pointer")),t.leave&&t.leave(i,t.text)}_linkAtPosition(e,t){let i=e.range.start.y*this._bufferService.cols+e.range.start.x,s=e.range.end.y*this._bufferService.cols+e.range.end.x,r=t.y*this._bufferService.cols+t.x;return i<=r&&r<=s}_positionFromMouseEvent(e,t,i){let s=i.getCoords(e,t,this._bufferService.cols,this._bufferService.rows);if(s)return{x:s[0],y:s[1]+this._bufferService.buffer.ydisp}}_createLinkUnderlineEvent(e,t,i,s,r){return{x1:e,y1:t,x2:i,y2:s,cols:this._bufferService.cols,fg:r}}};cl=we([z(1,ul),z(2,ti),z(3,Ze),z(4,Cd)],cl);eb=class extends qv{constructor(e={}){super(e),this._linkifier=this._register(new Ss),this.browser=Jd,this._keyDownHandled=!1,this._keyDownSeen=!1,this._keyPressHandled=!1,this._unprocessedDeadKey=!1,this._accessibilityManager=this._register(new Ss),this._onCursorMove=this._register(new M),this.onCursorMove=this._onCursorMove.event,this._onKey=this._register(new M),this.onKey=this._onKey.event,this._onRender=this._register(new M),this.onRender=this._onRender.event,this._onSelectionChange=this._register(new M),this.onSelectionChange=this._onSelectionChange.event,this._onTitleChange=this._register(new M),this.onTitleChange=this._onTitleChange.event,this._onBell=this._register(new M),this.onBell=this._onBell.event,this._onFocus=this._register(new M),this._onBlur=this._register(new M),this._onA11yCharEmitter=this._register(new M),this._onA11yTabEmitter=this._register(new M),this._onWillOpen=this._register(new M),this._setup(),this._decorationService=this._instantiationService.createInstance(Gv),this._instantiationService.setService(Tr,this._decorationService),this._linkProviderService=this._instantiationService.createInstance(Wg),this._instantiationService.setService(Cd,this._linkProviderService),this._linkProviderService.registerLinkProvider(this._instantiationService.createInstance(La)),this._register(this._inputHandler.onRequestBell(()=>this._onBell.fire())),this._register(this._inputHandler.onRequestRefreshRows(t=>this.refresh(t?.start??0,t?.end??this.rows-1))),this._register(this._inputHandler.onRequestSendFocus(()=>this._reportFocus())),this._register(this._inputHandler.onRequestReset(()=>this.reset())),this._register(this._inputHandler.onRequestWindowsOptionsReport(t=>this._reportWindowsOptions(t))),this._register(this._inputHandler.onColor(t=>this._handleColorEvent(t))),this._register(Ve.forward(this._inputHandler.onCursorMove,this._onCursorMove)),this._register(Ve.forward(this._inputHandler.onTitleChange,this._onTitleChange)),this._register(Ve.forward(this._inputHandler.onA11yChar,this._onA11yCharEmitter)),this._register(Ve.forward(this._inputHandler.onA11yTab,this._onA11yTabEmitter)),this._register(this._bufferService.onResize(t=>this._afterResize(t.cols,t.rows))),this._register(me(()=>{this._customKeyEventHandler=void 0,this.element?.parentNode?.removeChild(this.element)}))}get linkifier(){return this._linkifier.value}get onFocus(){return this._onFocus.event}get onBlur(){return this._onBlur.event}get onA11yChar(){return this._onA11yCharEmitter.event}get onA11yTab(){return this._onA11yTabEmitter.event}get onWillOpen(){return this._onWillOpen.event}_handleColorEvent(e){if(this._themeService)for(let t of e){let i,s="";switch(t.index){case 256:i="foreground",s="10";break;case 257:i="background",s="11";break;case 258:i="cursor",s="12";break;default:i="ansi",s="4;"+t.index}switch(t.type){case 0:let r=fe.toColorRGB(i==="ansi"?this._themeService.colors.ansi[t.index]:this._themeService.colors[i]);this.coreService.triggerDataEvent(`${$.ESC}]${s};${Nv(r)}${Gd.ST}`);break;case 1:if(i==="ansi")this._themeService.modifyColors(o=>o.ansi[t.index]=Ae.toColor(...t.color));else{let o=i;this._themeService.modifyColors(n=>n[o]=Ae.toColor(...t.color))}break;case 2:this._themeService.restoreColor(t.index);break}}}_setup(){super._setup(),this._customKeyEventHandler=void 0}get buffer(){return this.buffers.active}focus(){this.textarea&&this.textarea.focus({preventScroll:!0})}_handleScreenReaderModeOptionChange(e){e?!this._accessibilityManager.value&&this._renderService&&(this._accessibilityManager.value=this._instantiationService.createInstance(Ho,this)):this._accessibilityManager.clear()}_handleTextAreaFocus(e){this.coreService.decPrivateModes.sendFocus&&this.coreService.triggerDataEvent($.ESC+"[I"),this.element.classList.add("focus"),this._showCursor(),this._onFocus.fire()}blur(){return this.textarea?.blur()}_handleTextAreaBlur(){this.textarea.value="",this.refresh(this.buffer.y,this.buffer.y),this.coreService.decPrivateModes.sendFocus&&this.coreService.triggerDataEvent($.ESC+"[O"),this.element.classList.remove("focus"),this._onBlur.fire()}_syncTextArea(){if(!this.textarea||!this.buffer.isCursorInViewport||this._compositionHelper.isComposing||!this._renderService)return;let e=this.buffer.ybase+this.buffer.y,t=this.buffer.lines.get(e);if(!t)return;let i=Math.min(this.buffer.x,this.cols-1),s=this._renderService.dimensions.css.cell.height,r=t.getWidth(i),o=this._renderService.dimensions.css.cell.width*r,n=this.buffer.y*this._renderService.dimensions.css.cell.height,a=i*this._renderService.dimensions.css.cell.width;this.textarea.style.left=a+"px",this.textarea.style.top=n+"px",this.textarea.style.width=o+"px",this.textarea.style.height=s+"px",this.textarea.style.lineHeight=s+"px",this.textarea.style.zIndex="-5"}_initGlobal(){this._bindKeys(),this._register(W(this.element,"copy",t=>{this.hasSelection()&&Lm(t,this._selectionService)}));let e=t=>Dm(t,this.textarea,this.coreService,this.optionsService);this._register(W(this.textarea,"paste",e)),this._register(W(this.element,"paste",e)),Zd?this._register(W(this.element,"mousedown",t=>{t.button===2&&dc(t,this.textarea,this.screenElement,this._selectionService,this.options.rightClickSelectsWord)})):this._register(W(this.element,"contextmenu",t=>{dc(t,this.textarea,this.screenElement,this._selectionService,this.options.rightClickSelectsWord)})),yl&&this._register(W(this.element,"auxclick",t=>{t.button===1&&fd(t,this.textarea,this.screenElement)}))}_bindKeys(){this._register(W(this.textarea,"keyup",e=>this._keyUp(e),!0)),this._register(W(this.textarea,"keydown",e=>this._keyDown(e),!0)),this._register(W(this.textarea,"keypress",e=>this._keyPress(e),!0)),this._register(W(this.textarea,"compositionstart",()=>this._compositionHelper.compositionstart())),this._register(W(this.textarea,"compositionupdate",e=>this._compositionHelper.compositionupdate(e))),this._register(W(this.textarea,"compositionend",()=>this._compositionHelper.compositionend())),this._register(W(this.textarea,"input",e=>this._inputEvent(e),!0)),this._register(this.onRender(()=>this._compositionHelper.updateCompositionElements()))}open(e){if(!e)throw new Error("Terminal requires a parent element.");if(e.isConnected||this._logService.debug("Terminal.open was called on an element that was not attached to the DOM"),this.element?.ownerDocument.defaultView&&this._coreBrowserService){this.element.ownerDocument.defaultView!==this._coreBrowserService.window&&(this._coreBrowserService.window=this.element.ownerDocument.defaultView);return}this._document=e.ownerDocument,this.options.documentOverride&&this.options.documentOverride instanceof Document&&(this._document=this.optionsService.rawOptions.documentOverride),this.element=this._document.createElement("div"),this.element.dir="ltr",this.element.classList.add("terminal"),this.element.classList.add("xterm"),e.appendChild(this.element);let t=this._document.createDocumentFragment();this._viewportElement=this._document.createElement("div"),this._viewportElement.classList.add("xterm-viewport"),t.appendChild(this._viewportElement),this.screenElement=this._document.createElement("div"),this.screenElement.classList.add("xterm-screen"),this._register(W(this.screenElement,"mousemove",r=>this.updateCursorStyle(r))),this._helperContainer=this._document.createElement("div"),this._helperContainer.classList.add("xterm-helpers"),this.screenElement.appendChild(this._helperContainer),t.appendChild(this.screenElement);let i=this.textarea=this._document.createElement("textarea");this.textarea.classList.add("xterm-helper-textarea"),this.textarea.setAttribute("aria-label",Aa.get()),tu||this.textarea.setAttribute("aria-multiline","false"),this.textarea.setAttribute("autocorrect","off"),this.textarea.setAttribute("autocapitalize","off"),this.textarea.setAttribute("spellcheck","false"),this.textarea.tabIndex=0,this._register(this.optionsService.onSpecificOptionChange("disableStdin",()=>i.readOnly=this.optionsService.rawOptions.disableStdin)),this.textarea.readOnly=this.optionsService.rawOptions.disableStdin,this._coreBrowserService=this._register(this._instantiationService.createInstance(Hg,this.textarea,e.ownerDocument.defaultView??window,this._document??typeof window<"u"?window.document:null)),this._instantiationService.setService(ei,this._coreBrowserService),this._register(W(this.textarea,"focus",r=>this._handleTextAreaFocus(r))),this._register(W(this.textarea,"blur",()=>this._handleTextAreaBlur())),this._helperContainer.appendChild(this.textarea),this._charSizeService=this._instantiationService.createInstance(Za,this._document,this._helperContainer),this._instantiationService.setService(Wo,this._charSizeService),this._themeService=this._instantiationService.createInstance(il),this._instantiationService.setService(Cs,this._themeService),this._characterJoinerService=this._instantiationService.createInstance(Io),this._instantiationService.setService(Sd,this._characterJoinerService),this._renderService=this._register(this._instantiationService.createInstance(el,this.rows,this.screenElement)),this._instantiationService.setService(ti,this._renderService),this._register(this._renderService.onRenderedViewportChange(r=>this._onRender.fire(r))),this.onResize(r=>this._renderService.resize(r.cols,r.rows)),this._compositionView=this._document.createElement("div"),this._compositionView.classList.add("composition-view"),this._compositionHelper=this._instantiationService.createInstance(Ga,this.textarea,this._compositionView),this._helperContainer.appendChild(this._compositionView),this._mouseService=this._instantiationService.createInstance(Qa),this._instantiationService.setService(ul,this._mouseService);let s=this._linkifier.value=this._register(this._instantiationService.createInstance(cl,this.screenElement));this.element.appendChild(t);try{this._onWillOpen.fire(this.element)}catch{}this._renderService.hasRenderer()||this._renderService.setRenderer(this._createRenderer()),this._register(this.onCursorMove(()=>{this._renderService.handleCursorMove(),this._syncTextArea()})),this._register(this.onResize(()=>this._renderService.handleResize(this.cols,this.rows))),this._register(this.onBlur(()=>this._renderService.handleBlur())),this._register(this.onFocus(()=>this._renderService.handleFocus())),this._viewport=this._register(this._instantiationService.createInstance(ja,this.element,this.screenElement)),this._register(this._viewport.onRequestScrollLines(r=>{super.scrollLines(r,!1),this.refresh(0,this.rows-1)})),this._selectionService=this._register(this._instantiationService.createInstance(tl,this.element,this.screenElement,s)),this._instantiationService.setService(Nm,this._selectionService),this._register(this._selectionService.onRequestScrollLines(r=>this.scrollLines(r.amount,r.suppressScrollEvent))),this._register(this._selectionService.onSelectionChange(()=>this._onSelectionChange.fire())),this._register(this._selectionService.onRequestRedraw(r=>this._renderService.handleSelectionChanged(r.start,r.end,r.columnSelectMode))),this._register(this._selectionService.onLinuxMouseSelection(r=>{this.textarea.value=r,this.textarea.focus(),this.textarea.select()})),this._register(Ve.any(this._onScroll.event,this._inputHandler.onScroll)(()=>{this._selectionService.refresh(),this._viewport?.queueSync()})),this._register(this._instantiationService.createInstance(Ya,this.screenElement)),this._register(W(this.element,"mousedown",r=>this._selectionService.handleMouseDown(r))),this.coreMouseService.areMouseEventsActive?(this._selectionService.disable(),this.element.classList.add("enable-mouse-events")):this._selectionService.enable(),this.options.screenReaderMode&&(this._accessibilityManager.value=this._instantiationService.createInstance(Ho,this)),this._register(this.optionsService.onSpecificOptionChange("screenReaderMode",r=>this._handleScreenReaderModeOptionChange(r))),this.options.overviewRuler.width&&(this._overviewRulerRenderer=this._register(this._instantiationService.createInstance(Oo,this._viewportElement,this.screenElement))),this.optionsService.onSpecificOptionChange("overviewRuler",r=>{!this._overviewRulerRenderer&&r&&this._viewportElement&&this.screenElement&&(this._overviewRulerRenderer=this._register(this._instantiationService.createInstance(Oo,this._viewportElement,this.screenElement)))}),this._charSizeService.measure(),this.refresh(0,this.rows-1),this._initGlobal(),this.bindMouse()}_createRenderer(){return this._instantiationService.createInstance(Ja,this,this._document,this.element,this.screenElement,this._viewportElement,this._helperContainer,this.linkifier)}bindMouse(){let e=this,t=this.element;function i(o){let n=e._mouseService.getMouseReportCoords(o,e.screenElement);if(!n)return!1;let a,h;switch(o.overrideType||o.type){case"mousemove":h=32,o.buttons===void 0?(a=3,o.button!==void 0&&(a=o.button<3?o.button:3)):a=o.buttons&1?0:o.buttons&4?1:o.buttons&2?2:3;break;case"mouseup":h=0,a=o.button<3?o.button:3;break;case"mousedown":h=1,a=o.button<3?o.button:3;break;case"wheel":if(e._customWheelEventHandler&&e._customWheelEventHandler(o)===!1)return!1;let l=o.deltaY;if(l===0||e.coreMouseService.consumeWheelEvent(o,e._renderService?.dimensions?.device?.cell?.height,e._coreBrowserService?.dpr)===0)return!1;h=l<0?0:1,a=4;break;default:return!1}return h===void 0||a===void 0||a>4?!1:e.coreMouseService.triggerMouseEvent({col:n.col,row:n.row,x:n.x,y:n.y,button:a,action:h,ctrl:o.ctrlKey,alt:o.altKey,shift:o.shiftKey})}let s={mouseup:null,wheel:null,mousedrag:null,mousemove:null},r={mouseup:o=>(i(o),o.buttons||(this._document.removeEventListener("mouseup",s.mouseup),s.mousedrag&&this._document.removeEventListener("mousemove",s.mousedrag)),this.cancel(o)),wheel:o=>(i(o),this.cancel(o,!0)),mousedrag:o=>{o.buttons&&i(o)},mousemove:o=>{o.buttons||i(o)}};this._register(this.coreMouseService.onProtocolChange(o=>{o?(this.optionsService.rawOptions.logLevel==="debug"&&this._logService.debug("Binding to mouse events:",this.coreMouseService.explainEvents(o)),this.element.classList.add("enable-mouse-events"),this._selectionService.disable()):(this._logService.debug("Unbinding from mouse events."),this.element.classList.remove("enable-mouse-events"),this._selectionService.enable()),o&8?s.mousemove||(t.addEventListener("mousemove",r.mousemove),s.mousemove=r.mousemove):(t.removeEventListener("mousemove",s.mousemove),s.mousemove=null),o&16?s.wheel||(t.addEventListener("wheel",r.wheel,{passive:!1}),s.wheel=r.wheel):(t.removeEventListener("wheel",s.wheel),s.wheel=null),o&2?s.mouseup||(s.mouseup=r.mouseup):(this._document.removeEventListener("mouseup",s.mouseup),s.mouseup=null),o&4?s.mousedrag||(s.mousedrag=r.mousedrag):(this._document.removeEventListener("mousemove",s.mousedrag),s.mousedrag=null)})),this.coreMouseService.activeProtocol=this.coreMouseService.activeProtocol,this._register(W(t,"mousedown",o=>{if(o.preventDefault(),this.focus(),!(!this.coreMouseService.areMouseEventsActive||this._selectionService.shouldForceSelection(o)))return i(o),s.mouseup&&this._document.addEventListener("mouseup",s.mouseup),s.mousedrag&&this._document.addEventListener("mousemove",s.mousedrag),this.cancel(o)})),this._register(W(t,"wheel",o=>{if(!s.wheel){if(this._customWheelEventHandler&&this._customWheelEventHandler(o)===!1)return!1;if(!this.buffer.hasScrollback){if(o.deltaY===0)return!1;if(e.coreMouseService.consumeWheelEvent(o,e._renderService?.dimensions?.device?.cell?.height,e._coreBrowserService?.dpr)===0)return this.cancel(o,!0);let n=$.ESC+(this.coreService.decPrivateModes.applicationCursorKeys?"O":"[")+(o.deltaY<0?"A":"B");return this.coreService.triggerDataEvent(n,!0),this.cancel(o,!0)}}},{passive:!1}))}refresh(e,t){this._renderService?.refreshRows(e,t)}updateCursorStyle(e){this._selectionService?.shouldColumnSelect(e)?this.element.classList.add("column-select"):this.element.classList.remove("column-select")}_showCursor(){this.coreService.isCursorInitialized||(this.coreService.isCursorInitialized=!0,this.refresh(this.buffer.y,this.buffer.y))}scrollLines(e,t){this._viewport?this._viewport.scrollLines(e):super.scrollLines(e,t),this.refresh(0,this.rows-1)}scrollPages(e){this.scrollLines(e*(this.rows-1))}scrollToTop(){this.scrollLines(-this._bufferService.buffer.ydisp)}scrollToBottom(e){e&&this._viewport?this._viewport.scrollToLine(this.buffer.ybase,!0):this.scrollLines(this._bufferService.buffer.ybase-this._bufferService.buffer.ydisp)}scrollToLine(e){let t=e-this._bufferService.buffer.ydisp;t!==0&&this.scrollLines(t)}paste(e){pd(e,this.textarea,this.coreService,this.optionsService)}attachCustomKeyEventHandler(e){this._customKeyEventHandler=e}attachCustomWheelEventHandler(e){this._customWheelEventHandler=e}registerLinkProvider(e){return this._linkProviderService.registerLinkProvider(e)}registerCharacterJoiner(e){if(!this._characterJoinerService)throw new Error("Terminal must be opened first");let t=this._characterJoinerService.register(e);return this.refresh(0,this.rows-1),t}deregisterCharacterJoiner(e){if(!this._characterJoinerService)throw new Error("Terminal must be opened first");this._characterJoinerService.deregister(e)&&this.refresh(0,this.rows-1)}get markers(){return this.buffer.markers}registerMarker(e){return this.buffer.addMarker(this.buffer.ybase+this.buffer.y+e)}registerDecoration(e){return this._decorationService.registerDecoration(e)}hasSelection(){return this._selectionService?this._selectionService.hasSelection:!1}select(e,t,i){this._selectionService.setSelection(e,t,i)}getSelection(){return this._selectionService?this._selectionService.selectionText:""}getSelectionPosition(){if(!(!this._selectionService||!this._selectionService.hasSelection))return{start:{x:this._selectionService.selectionStart[0],y:this._selectionService.selectionStart[1]},end:{x:this._selectionService.selectionEnd[0],y:this._selectionService.selectionEnd[1]}}}clearSelection(){this._selectionService?.clearSelection()}selectAll(){this._selectionService?.selectAll()}selectLines(e,t){this._selectionService?.selectLines(e,t)}_keyDown(e){if(this._keyDownHandled=!1,this._keyDownSeen=!0,this._customKeyEventHandler&&this._customKeyEventHandler(e)===!1)return!1;let t=this.browser.isMac&&this.options.macOptionIsMeta&&e.altKey;if(!t&&!this._compositionHelper.keydown(e))return this.options.scrollOnUserInput&&this.buffer.ybase!==this.buffer.ydisp&&this.scrollToBottom(!0),!1;!t&&(e.key==="Dead"||e.key==="AltGraph")&&(this._unprocessedDeadKey=!0);let i=jv(e,this.coreService.decPrivateModes.applicationCursorKeys,this.browser.isMac,this.options.macOptionIsMeta);if(this.updateCursorStyle(e),i.type===3||i.type===2){let s=this.rows-1;return this.scrollLines(i.type===2?-s:s),this.cancel(e,!0)}if(i.type===1&&this.selectAll(),this._isThirdLevelShift(this.browser,e)||(i.cancel&&this.cancel(e,!0),!i.key)||e.key&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&e.key.length===1&&e.key.charCodeAt(0)>=65&&e.key.charCodeAt(0)<=90)return!0;if(this._unprocessedDeadKey)return this._unprocessedDeadKey=!1,!0;if((i.key===$.ETX||i.key===$.CR)&&(this.textarea.value=""),this._onKey.fire({key:i.key,domEvent:e}),this._showCursor(),this.coreService.triggerDataEvent(i.key,!0),!this.optionsService.rawOptions.screenReaderMode||e.altKey||e.ctrlKey)return this.cancel(e,!0);this._keyDownHandled=!0}_isThirdLevelShift(e,t){let i=e.isMac&&!this.options.macOptionIsMeta&&t.altKey&&!t.ctrlKey&&!t.metaKey||e.isWindows&&t.altKey&&t.ctrlKey&&!t.metaKey||e.isWindows&&t.getModifierState("AltGraph");return t.type==="keypress"?i:i&&(!t.keyCode||t.keyCode>47)}_keyUp(e){this._keyDownSeen=!1,!(this._customKeyEventHandler&&this._customKeyEventHandler(e)===!1)&&(tb(e)||this.focus(),this.updateCursorStyle(e),this._keyPressHandled=!1)}_keyPress(e){let t;if(this._keyPressHandled=!1,this._keyDownHandled||this._customKeyEventHandler&&this._customKeyEventHandler(e)===!1)return!1;if(this.cancel(e),e.charCode)t=e.charCode;else if(e.which===null||e.which===void 0)t=e.keyCode;else if(e.which!==0&&e.charCode!==0)t=e.which;else return!1;return!t||(e.altKey||e.ctrlKey||e.metaKey)&&!this._isThirdLevelShift(this.browser,e)?!1:(t=String.fromCharCode(t),this._onKey.fire({key:t,domEvent:e}),this._showCursor(),this.coreService.triggerDataEvent(t,!0),this._keyPressHandled=!0,this._unprocessedDeadKey=!1,!0)}_inputEvent(e){if(e.data&&e.inputType==="insertText"&&(!e.composed||!this._keyDownSeen)&&!this.optionsService.rawOptions.screenReaderMode){if(this._keyPressHandled)return!1;this._unprocessedDeadKey=!1;let t=e.data;return this.coreService.triggerDataEvent(t,!0),this.cancel(e),!0}return!1}resize(e,t){if(e===this.cols&&t===this.rows){this._charSizeService&&!this._charSizeService.hasValidSize&&this._charSizeService.measure();return}super.resize(e,t)}_afterResize(e,t){this._charSizeService?.measure()}clear(){if(!(this.buffer.ybase===0&&this.buffer.y===0)){this.buffer.clearAllMarkers(),this.buffer.lines.set(0,this.buffer.lines.get(this.buffer.ybase+this.buffer.y)),this.buffer.lines.length=1,this.buffer.ydisp=0,this.buffer.ybase=0,this.buffer.y=0;for(let e=1;e<this.rows;e++)this.buffer.lines.push(this.buffer.getBlankLine(Ee));this._onScroll.fire({position:this.buffer.ydisp}),this.refresh(0,this.rows-1)}}reset(){this.options.rows=this.rows,this.options.cols=this.cols;let e=this._customKeyEventHandler;this._setup(),super.reset(),this._selectionService?.reset(),this._decorationService.reset(),this._customKeyEventHandler=e,this.refresh(0,this.rows-1)}clearTextureAtlas(){this._renderService?.clearTextureAtlas()}_reportFocus(){this.element?.classList.contains("focus")?this.coreService.triggerDataEvent($.ESC+"[I"):this.coreService.triggerDataEvent($.ESC+"[O")}_reportWindowsOptions(e){if(this._renderService)switch(e){case 0:let t=this._renderService.dimensions.css.canvas.width.toFixed(0),i=this._renderService.dimensions.css.canvas.height.toFixed(0);this.coreService.triggerDataEvent(`${$.ESC}[4;${i};${t}t`);break;case 1:let s=this._renderService.dimensions.css.cell.width.toFixed(0),r=this._renderService.dimensions.css.cell.height.toFixed(0);this.coreService.triggerDataEvent(`${$.ESC}[6;${r};${s}t`);break}}cancel(e,t){if(!(!this.options.cancelEvents&&!t))return e.preventDefault(),e.stopPropagation(),!1}};ib=class{constructor(){this._addons=[]}dispose(){for(let e=this._addons.length-1;e>=0;e--)this._addons[e].instance.dispose()}loadAddon(e,t){let i={instance:t,dispose:t.dispose,isDisposed:!1};this._addons.push(i),t.dispose=()=>this._wrappedAddonDispose(i),t.activate(e)}_wrappedAddonDispose(e){if(e.isDisposed)return;let t=-1;for(let i=0;i<this._addons.length;i++)if(this._addons[i]===e){t=i;break}if(t===-1)throw new Error("Could not dispose an addon that has not been loaded");e.isDisposed=!0,e.dispose.apply(e.instance),this._addons.splice(t,1)}},sb=class{constructor(e){this._line=e}get isWrapped(){return this._line.isWrapped}get length(){return this._line.length}getCell(e,t){if(!(e<0||e>=this._line.length))return t?(this._line.loadCell(e,t),t):this._line.loadCell(e,new bt)}translateToString(e,t,i){return this._line.translateToString(e,t,i)}},dd=class{constructor(e,t){this._buffer=e,this.type=t}init(e){return this._buffer=e,this}get cursorY(){return this._buffer.y}get cursorX(){return this._buffer.x}get viewportY(){return this._buffer.ydisp}get baseY(){return this._buffer.ybase}get length(){return this._buffer.lines.length}getLine(e){let t=this._buffer.lines.get(e);if(t)return new sb(t)}getNullCell(){return new bt}},rb=class extends G{constructor(e){super(),this._core=e,this._onBufferChange=this._register(new M),this.onBufferChange=this._onBufferChange.event,this._normal=new dd(this._core.buffers.normal,"normal"),this._alternate=new dd(this._core.buffers.alt,"alternate"),this._core.buffers.onBufferActivate(()=>this._onBufferChange.fire(this.active))}get active(){if(this._core.buffers.active===this._core.buffers.normal)return this.normal;if(this._core.buffers.active===this._core.buffers.alt)return this.alternate;throw new Error("Active buffer is neither normal nor alternate")}get normal(){return this._normal.init(this._core.buffers.normal)}get alternate(){return this._alternate.init(this._core.buffers.alt)}},ob=class{constructor(e){this._core=e}registerCsiHandler(e,t){return this._core.registerCsiHandler(e,i=>t(i.toArray()))}addCsiHandler(e,t){return this.registerCsiHandler(e,t)}registerDcsHandler(e,t){return this._core.registerDcsHandler(e,(i,s)=>t(i,s.toArray()))}addDcsHandler(e,t){return this.registerDcsHandler(e,t)}registerEscHandler(e,t){return this._core.registerEscHandler(e,t)}addEscHandler(e,t){return this.registerEscHandler(e,t)}registerOscHandler(e,t){return this._core.registerOscHandler(e,t)}addOscHandler(e,t){return this.registerOscHandler(e,t)}},nb=class{constructor(e){this._core=e}register(e){this._core.unicodeService.register(e)}get versions(){return this._core.unicodeService.versions}get activeVersion(){return this._core.unicodeService.activeVersion}set activeVersion(e){this._core.unicodeService.activeVersion=e}},ab=["cols","rows"],Ot=0,lb=class extends G{constructor(e){super(),this._core=this._register(new eb(e)),this._addonManager=this._register(new ib),this._publicOptions={...this._core.options};let t=s=>this._core.options[s],i=(s,r)=>{this._checkReadonlyOptions(s),this._core.options[s]=r};for(let s in this._core.options){let r={get:t.bind(this,s),set:i.bind(this,s)};Object.defineProperty(this._publicOptions,s,r)}}_checkReadonlyOptions(e){if(ab.includes(e))throw new Error(`Option "${e}" can only be set in the constructor`)}_checkProposedApi(){if(!this._core.optionsService.rawOptions.allowProposedApi)throw new Error("You must set the allowProposedApi option to true to use proposed API")}get onBell(){return this._core.onBell}get onBinary(){return this._core.onBinary}get onCursorMove(){return this._core.onCursorMove}get onData(){return this._core.onData}get onKey(){return this._core.onKey}get onLineFeed(){return this._core.onLineFeed}get onRender(){return this._core.onRender}get onResize(){return this._core.onResize}get onScroll(){return this._core.onScroll}get onSelectionChange(){return this._core.onSelectionChange}get onTitleChange(){return this._core.onTitleChange}get onWriteParsed(){return this._core.onWriteParsed}get element(){return this._core.element}get parser(){return this._parser||(this._parser=new ob(this._core)),this._parser}get unicode(){return this._checkProposedApi(),new nb(this._core)}get textarea(){return this._core.textarea}get rows(){return this._core.rows}get cols(){return this._core.cols}get buffer(){return this._buffer||(this._buffer=this._register(new rb(this._core))),this._buffer}get markers(){return this._checkProposedApi(),this._core.markers}get modes(){let e=this._core.coreService.decPrivateModes,t="none";switch(this._core.coreMouseService.activeProtocol){case"X10":t="x10";break;case"VT200":t="vt200";break;case"DRAG":t="drag";break;case"ANY":t="any";break}return{applicationCursorKeysMode:e.applicationCursorKeys,applicationKeypadMode:e.applicationKeypad,bracketedPasteMode:e.bracketedPasteMode,insertMode:this._core.coreService.modes.insertMode,mouseTrackingMode:t,originMode:e.origin,reverseWraparoundMode:e.reverseWraparound,sendFocusMode:e.sendFocus,synchronizedOutputMode:e.synchronizedOutput,wraparoundMode:e.wraparound}}get options(){return this._publicOptions}set options(e){for(let t in e)this._publicOptions[t]=e[t]}blur(){this._core.blur()}focus(){this._core.focus()}input(e,t=!0){this._core.input(e,t)}resize(e,t){this._verifyIntegers(e,t),this._core.resize(e,t)}open(e){this._core.open(e)}attachCustomKeyEventHandler(e){this._core.attachCustomKeyEventHandler(e)}attachCustomWheelEventHandler(e){this._core.attachCustomWheelEventHandler(e)}registerLinkProvider(e){return this._core.registerLinkProvider(e)}registerCharacterJoiner(e){return this._checkProposedApi(),this._core.registerCharacterJoiner(e)}deregisterCharacterJoiner(e){this._checkProposedApi(),this._core.deregisterCharacterJoiner(e)}registerMarker(e=0){return this._verifyIntegers(e),this._core.registerMarker(e)}registerDecoration(e){return this._checkProposedApi(),this._verifyPositiveIntegers(e.x??0,e.width??0,e.height??0),this._core.registerDecoration(e)}hasSelection(){return this._core.hasSelection()}select(e,t,i){this._verifyIntegers(e,t,i),this._core.select(e,t,i)}getSelection(){return this._core.getSelection()}getSelectionPosition(){return this._core.getSelectionPosition()}clearSelection(){this._core.clearSelection()}selectAll(){this._core.selectAll()}selectLines(e,t){this._verifyIntegers(e,t),this._core.selectLines(e,t)}dispose(){super.dispose()}scrollLines(e){this._verifyIntegers(e),this._core.scrollLines(e)}scrollPages(e){this._verifyIntegers(e),this._core.scrollPages(e)}scrollToTop(){this._core.scrollToTop()}scrollToBottom(){this._core.scrollToBottom()}scrollToLine(e){this._verifyIntegers(e),this._core.scrollToLine(e)}clear(){this._core.clear()}write(e,t){this._core.write(e,t)}writeln(e,t){this._core.write(e),this._core.write(`\r
`,t)}paste(e){this._core.paste(e)}refresh(e,t){this._verifyIntegers(e,t),this._core.refresh(e,t)}reset(){this._core.reset()}clearTextureAtlas(){this._core.clearTextureAtlas()}loadAddon(e){this._addonManager.loadAddon(this,e)}static get strings(){return{get promptLabel(){return Aa.get()},set promptLabel(e){Aa.set(e)},get tooMuchOutput(){return $a.get()},set tooMuchOutput(e){$a.set(e)}}}_verifyIntegers(...e){for(Ot of e)if(Ot===1/0||isNaN(Ot)||Ot%1!==0)throw new Error("This API only accepts integers")}_verifyPositiveIntegers(...e){for(Ot of e)if(Ot&&(Ot===1/0||isNaN(Ot)||Ot%1!==0||Ot<0))throw new Error("This API only accepts positive integers")}}});var Cl={};Rn(Cl,{FitAddon:()=>db});var hb,cb,db,xl=Dn(()=>{hb=2,cb=1,db=class{activate(e){this._terminal=e}dispose(){}fit(){let e=this.proposeDimensions();if(!e||!this._terminal||isNaN(e.cols)||isNaN(e.rows))return;let t=this._terminal._core;(this._terminal.rows!==e.rows||this._terminal.cols!==e.cols)&&(t._renderService.clear(),this._terminal.resize(e.cols,e.rows))}proposeDimensions(){if(!this._terminal||!this._terminal.element||!this._terminal.element.parentElement)return;let e=this._terminal._core._renderService.dimensions;if(e.css.cell.width===0||e.css.cell.height===0)return;let t=this._terminal.options.scrollback===0?0:this._terminal.options.overviewRuler?.width||14,i=window.getComputedStyle(this._terminal.element.parentElement),s=parseInt(i.getPropertyValue("height")),r=Math.max(0,parseInt(i.getPropertyValue("width"))),o=window.getComputedStyle(this._terminal.element),n={top:parseInt(o.getPropertyValue("padding-top")),bottom:parseInt(o.getPropertyValue("padding-bottom")),right:parseInt(o.getPropertyValue("padding-right")),left:parseInt(o.getPropertyValue("padding-left"))},a=n.top+n.bottom,h=n.right+n.left,l=s-a,c=r-h-t;return{cols:Math.max(hb,Math.floor(c/e.css.cell.width)),rows:Math.max(cb,Math.floor(l/e.css.cell.height))}}}});var Pu={};Rn(Pu,{SearchAddon:()=>a0});function kl(e){fb(e)||pb.onUnexpectedError(e)}function fb(e){return e instanceof mb?!0:e instanceof Error&&e.name===$l&&e.message===$l}function _b(e,t,i=0,s=e.length){let r=i,o=s;for(;r<o;){let n=Math.floor((r+o)/2);t(e[n])?r=n+1:o=n}return r-1}function vb(e,t){return(i,s)=>t(e(i),e(s))}function yb(e,t){let i=Object.create(null);for(let s of e){let r=t(s),o=i[r];o||(o=i[r]=[]),o.push(s)}return i}function Sb(e,t){let i=this,s=!1,r;return function(){if(s)return r;if(s=!0,t)try{r=e.apply(i,arguments)}finally{t()}else r=e.apply(i,arguments);return r}}function kb(e){Es=e}function Qo(e){return Es?.trackDisposable(e),e}function en(e){Es?.markAsDisposed(e)}function Mr(e,t){Es?.setParent(e,t)}function Eb(e,t){if(Es)for(let i of e)Es.setParent(i,t)}function Rr(e){if(Su.is(e)){let t=[];for(let i of e)if(i)try{i.dispose()}catch(s){t.push(s)}if(t.length===1)throw t[0];if(t.length>1)throw new AggregateError(t,"Encountered errors while disposing of store");return Array.isArray(e)?[]:e}else if(e)return e.dispose(),e}function xu(...e){let t=As(()=>Rr(e));return Eb(e,t),t}function As(e){let t=Qo({dispose:Sb(()=>{en(t),e()})});return t}function Bu(e,t=0,i){let s=setTimeout(()=>{e(),i&&r.dispose()},t),r=As(()=>{clearTimeout(s),i?.deleteAndLeak(r)});return i?.add(r),r}var ub,pb,$l,mb,du,gb,wu,bb,uu,pu,fu,Fx,wb,Su,Cb,Es,xb,ku,Il,Ft,Zo,mu,Ab,$b,Tb,_u,Lb,zl,Rl,Db,gu,$u,Rb,Bl,Mb,Bb,Pb,Yo,Ob,Ib,Go,Ht,zb,Du,Nb,Hb,ks,Pl,Ol,Xo,Fb,Wb,Ru,Vb,Ub,qb,Kb,jo,Jo,vu,jb,ii,si,pt,Mu,Yb,El,Gb,Wx,Wt,wi,Xb,Jb,Zb,Qb,Vx,Ux,qx,Kx,e0,Al,t0,bu,i0,s0,r0,o0,n0,a0,Ou=Dn(()=>{ub=class{constructor(){this.listeners=[],this.unexpectedErrorHandler=function(e){setTimeout(()=>{throw e.stack?du.isErrorNoTelemetry(e)?new du(e.message+`

`+e.stack):new Error(e.message+`

`+e.stack):e},0)}}addListener(e){return this.listeners.push(e),()=>{this._removeListener(e)}}emit(e){this.listeners.forEach(t=>{t(e)})}_removeListener(e){this.listeners.splice(this.listeners.indexOf(e),1)}setUnexpectedErrorHandler(e){this.unexpectedErrorHandler=e}getUnexpectedErrorHandler(){return this.unexpectedErrorHandler}onUnexpectedError(e){this.unexpectedErrorHandler(e),this.emit(e)}onUnexpectedExternalError(e){this.unexpectedErrorHandler(e)}},pb=new ub;$l="Canceled";mb=class extends Error{constructor(){super($l),this.name=this.message}},du=class Tl extends Error{constructor(t){super(t),this.name="CodeExpectedError"}static fromError(t){if(t instanceof Tl)return t;let i=new Tl;return i.message=t.message,i.stack=t.stack,i}static isErrorNoTelemetry(t){return t.name==="CodeExpectedError"}};gb=class yu{constructor(t){this._array=t,this._findLastMonotonousLastIdx=0}findLastMonotonous(t){if(yu.assertInvariants){if(this._prevFindLastPredicate){for(let s of this._array)if(this._prevFindLastPredicate(s)&&!t(s))throw new Error("MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.")}this._prevFindLastPredicate=t}let i=_b(this._array,t,this._findLastMonotonousLastIdx);return this._findLastMonotonousLastIdx=i+1,i===-1?void 0:this._array[i]}};gb.assertInvariants=!1;(e=>{function t(o){return o<0}e.isLessThan=t;function i(o){return o<=0}e.isLessThanOrEqual=i;function s(o){return o>0}e.isGreaterThan=s;function r(o){return o===0}e.isNeitherLessOrGreaterThan=r,e.greaterThan=1,e.lessThan=-1,e.neitherLessOrGreaterThan=0})(wu||(wu={}));bb=(e,t)=>e-t,uu=class Ll{constructor(t){this.iterate=t}forEach(t){this.iterate(i=>(t(i),!0))}toArray(){let t=[];return this.iterate(i=>(t.push(i),!0)),t}filter(t){return new Ll(i=>this.iterate(s=>t(s)?i(s):!0))}map(t){return new Ll(i=>this.iterate(s=>i(t(s))))}some(t){let i=!1;return this.iterate(s=>(i=t(s),!i)),i}findFirst(t){let i;return this.iterate(s=>t(s)?(i=s,!1):!0),i}findLast(t){let i;return this.iterate(s=>(t(s)&&(i=s),!0)),i}findLastMaxBy(t){let i,s=!0;return this.iterate(r=>((s||wu.isGreaterThan(t(r,i)))&&(s=!1,i=r),!0)),i}};uu.empty=new uu(e=>{});Fx=class{constructor(e,t){this.toKey=t,this._map=new Map,this[pu]="SetWithKey";for(let i of e)this.add(i)}get size(){return this._map.size}add(e){let t=this.toKey(e);return this._map.set(t,e),this}delete(e){return this._map.delete(this.toKey(e))}has(e){return this._map.has(this.toKey(e))}*entries(){for(let e of this._map.values())yield[e,e]}keys(){return this.values()}*values(){for(let e of this._map.values())yield e}clear(){this._map.clear()}forEach(e,t){this._map.forEach(i=>e.call(t,i,i,this))}[(fu=Symbol.iterator,pu=Symbol.toStringTag,fu)](){return this.values()}},wb=class{constructor(){this.map=new Map}add(e,t){let i=this.map.get(e);i||(i=new Set,this.map.set(e,i)),i.add(t)}delete(e,t){let i=this.map.get(e);i&&(i.delete(t),i.size===0&&this.map.delete(e))}forEach(e,t){let i=this.map.get(e);i&&i.forEach(t)}get(e){return this.map.get(e)||new Set}};(e=>{function t(y){return y&&typeof y=="object"&&typeof y[Symbol.iterator]=="function"}e.is=t;let i=Object.freeze([]);function s(){return i}e.empty=s;function*r(y){yield y}e.single=r;function o(y){return t(y)?y:r(y)}e.wrap=o;function n(y){return y||i}e.from=n;function*a(y){for(let L=y.length-1;L>=0;L--)yield y[L]}e.reverse=a;function h(y){return!y||y[Symbol.iterator]().next().done===!0}e.isEmpty=h;function l(y){return y[Symbol.iterator]().next().value}e.first=l;function c(y,L){let D=0;for(let O of y)if(L(O,D++))return!0;return!1}e.some=c;function d(y,L){for(let D of y)if(L(D))return D}e.find=d;function*p(y,L){for(let D of y)L(D)&&(yield D)}e.filter=p;function*f(y,L){let D=0;for(let O of y)yield L(O,D++)}e.map=f;function*m(y,L){let D=0;for(let O of y)yield*L(O,D++)}e.flatMap=m;function*_(...y){for(let L of y)yield*L}e.concat=_;function C(y,L,D){let O=D;for(let te of y)O=L(O,te);return O}e.reduce=C;function*k(y,L,D=y.length){for(L<0&&(L+=y.length),D<0?D+=y.length:D>y.length&&(D=y.length);L<D;L++)yield y[L]}e.slice=k;function R(y,L=Number.POSITIVE_INFINITY){let D=[];if(L===0)return[D,y];let O=y[Symbol.iterator]();for(let te=0;te<L;te++){let re=O.next();if(re.done)return[D,e.empty()];D.push(re.value)}return[D,{[Symbol.iterator](){return O}}]}e.consume=R;async function T(y){let L=[];for await(let D of y)L.push(D);return Promise.resolve(L)}e.asyncToArray=T})(Su||(Su={}));Cb=!1,Es=null,xb=class Cu{constructor(){this.livingDisposables=new Map}getDisposableData(t){let i=this.livingDisposables.get(t);return i||(i={parent:null,source:null,isSingleton:!1,value:t,idx:Cu.idx++},this.livingDisposables.set(t,i)),i}trackDisposable(t){let i=this.getDisposableData(t);i.source||(i.source=new Error().stack)}setParent(t,i){let s=this.getDisposableData(t);s.parent=i}markAsDisposed(t){this.livingDisposables.delete(t)}markAsSingleton(t){this.getDisposableData(t).isSingleton=!0}getRootParent(t,i){let s=i.get(t);if(s)return s;let r=t.parent?this.getRootParent(this.getDisposableData(t.parent),i):t;return i.set(t,r),r}getTrackedDisposables(){let t=new Map;return[...this.livingDisposables.entries()].filter(([,i])=>i.source!==null&&!this.getRootParent(i,t).isSingleton).flatMap(([i])=>i)}computeLeakingDisposables(t=10,i){let s;if(i)s=i;else{let h=new Map,l=[...this.livingDisposables.values()].filter(d=>d.source!==null&&!this.getRootParent(d,h).isSingleton);if(l.length===0)return;let c=new Set(l.map(d=>d.value));if(s=l.filter(d=>!(d.parent&&c.has(d.parent))),s.length===0)throw new Error("There are cyclic diposable chains!")}if(!s)return;function r(h){function l(d,p){for(;d.length>0&&p.some(f=>typeof f=="string"?f===d[0]:d[0].match(f));)d.shift()}let c=h.source.split(`
`).map(d=>d.trim().replace("at ","")).filter(d=>d!=="");return l(c,["Error",/^trackDisposable \(.*\)$/,/^DisposableTracker.trackDisposable \(.*\)$/]),c.reverse()}let o=new wb;for(let h of s){let l=r(h);for(let c=0;c<=l.length;c++)o.add(l.slice(0,c).join(`
`),h)}s.sort(vb(h=>h.idx,bb));let n="",a=0;for(let h of s.slice(0,t)){a++;let l=r(h),c=[];for(let d=0;d<l.length;d++){let p=l[d];p=`(shared with ${o.get(l.slice(0,d+1).join(`
`)).size}/${s.length} leaks) at ${p}`;let f=o.get(l.slice(0,d).join(`
`)),m=yb([...f].map(_=>r(_)[d]),_=>_);delete m[l[d]];for(let[_,C]of Object.entries(m))c.unshift(`    - stacktraces of ${C.length} other leaks continue with ${_}`);c.unshift(p)}n+=`


==================== Leaking disposable ${a}/${s.length}: ${h.value.constructor.name} ====================
${c.join(`
`)}
============================================================

`}return s.length>t&&(n+=`


... and ${s.length-t} more leaking disposables

`),{leaks:s,details:n}}};xb.idx=0;if(Cb){let e="__is_disposable_tracked__";kb(new class{trackDisposable(t){let i=new Error("Potentially leaked disposable").stack;setTimeout(()=>{t[e]||console.log(i)},3e3)}setParent(t,i){if(t&&t!==Ft.None)try{t[e]=!0}catch{}}markAsDisposed(t){if(t&&t!==Ft.None)try{t[e]=!0}catch{}}markAsSingleton(t){}})}ku=class Eu{constructor(){this._toDispose=new Set,this._isDisposed=!1,Qo(this)}dispose(){this._isDisposed||(en(this),this._isDisposed=!0,this.clear())}get isDisposed(){return this._isDisposed}clear(){if(this._toDispose.size!==0)try{Rr(this._toDispose)}finally{this._toDispose.clear()}}add(t){if(!t)return t;if(t===this)throw new Error("Cannot register a disposable on itself!");return Mr(t,this),this._isDisposed?Eu.DISABLE_DISPOSED_WARNING||console.warn(new Error("Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!").stack):this._toDispose.add(t),t}delete(t){if(t){if(t===this)throw new Error("Cannot dispose a disposable on itself!");this._toDispose.delete(t),t.dispose()}}deleteAndLeak(t){t&&this._toDispose.has(t)&&(this._toDispose.delete(t),Mr(t,null))}};ku.DISABLE_DISPOSED_WARNING=!1;Il=ku,Ft=class{constructor(){this._store=new Il,Qo(this),Mr(this._store,this)}dispose(){en(this),this._store.dispose()}_register(e){if(e===this)throw new Error("Cannot register a disposable on itself!");return this._store.add(e)}};Ft.None=Object.freeze({dispose(){}});Zo=class{constructor(){this._isDisposed=!1,Qo(this)}get value(){return this._isDisposed?void 0:this._value}set value(e){this._isDisposed||e===this._value||(this._value?.dispose(),e&&Mr(e,this),this._value=e)}clear(){this.value=void 0}dispose(){this._isDisposed=!0,en(this),this._value?.dispose(),this._value=void 0}clearAndLeak(){let e=this._value;return this._value=void 0,e&&Mr(e,null),e}},mu=class Dl{constructor(t){this.element=t,this.next=Dl.Undefined,this.prev=Dl.Undefined}};mu.Undefined=new mu(void 0);Ab=globalThis.performance&&typeof globalThis.performance.now=="function",$b=class Au{static create(t){return new Au(t)}constructor(t){this._now=Ab&&t===!1?Date.now:globalThis.performance.now.bind(globalThis.performance),this._startTime=this._now(),this._stopTime=-1}stop(){this._stopTime=this._now()}reset(){this._startTime=this._now(),this._stopTime=-1}elapsed(){return this._stopTime!==-1?this._stopTime-this._startTime:this._now()-this._startTime}},Tb=!1,_u=!1,Lb=!1;(e=>{e.None=()=>Ft.None;function t(S){if(Lb){let{onDidAddListener:b}=S,x=Bl.create(),w=0;S.onDidAddListener=()=>{++w===2&&(console.warn("snapshotted emitter LIKELY used public and SHOULD HAVE BEEN created with DisposableStore. snapshotted here"),x.print()),b?.()}}}function i(S,b){return p(S,()=>{},0,void 0,!0,void 0,b)}e.defer=i;function s(S){return(b,x=null,w)=>{let A=!1,E;return E=S(P=>{if(!A)return E?E.dispose():A=!0,b.call(x,P)},null,w),A&&E.dispose(),E}}e.once=s;function r(S,b,x){return c((w,A=null,E)=>S(P=>w.call(A,b(P)),null,E),x)}e.map=r;function o(S,b,x){return c((w,A=null,E)=>S(P=>{b(P),w.call(A,P)},null,E),x)}e.forEach=o;function n(S,b,x){return c((w,A=null,E)=>S(P=>b(P)&&w.call(A,P),null,E),x)}e.filter=n;function a(S){return S}e.signal=a;function h(...S){return(b,x=null,w)=>{let A=xu(...S.map(E=>E(P=>b.call(x,P))));return d(A,w)}}e.any=h;function l(S,b,x,w){let A=x;return r(S,E=>(A=b(A,E),A),w)}e.reduce=l;function c(S,b){let x,w={onWillAddFirstListener(){x=S(A.fire,A)},onDidRemoveLastListener(){x?.dispose()}};b||t(w);let A=new Ht(w);return b?.add(A),A.event}function d(S,b){return b instanceof Array?b.push(S):b&&b.add(S),S}function p(S,b,x=100,w=!1,A=!1,E,P){let V,ne,We,rt=0,_e,Et={leakWarningThreshold:E,onWillAddFirstListener(){V=S(jt=>{rt++,ne=b(ne,jt),w&&!We&&(ke.fire(ne),ne=void 0),_e=()=>{let Li=ne;ne=void 0,We=void 0,(!w||rt>1)&&ke.fire(Li),rt=0},typeof x=="number"?(clearTimeout(We),We=setTimeout(_e,x)):We===void 0&&(We=0,queueMicrotask(_e))})},onWillRemoveListener(){A&&rt>0&&_e?.()},onDidRemoveLastListener(){_e=void 0,V.dispose()}};P||t(Et);let ke=new Ht(Et);return P?.add(ke),ke.event}e.debounce=p;function f(S,b=0,x){return e.debounce(S,(w,A)=>w?(w.push(A),w):[A],b,void 0,!0,void 0,x)}e.accumulate=f;function m(S,b=(w,A)=>w===A,x){let w=!0,A;return n(S,E=>{let P=w||!b(E,A);return w=!1,A=E,P},x)}e.latch=m;function _(S,b,x){return[e.filter(S,b,x),e.filter(S,w=>!b(w),x)]}e.split=_;function C(S,b=!1,x=[],w){let A=x.slice(),E=S(ne=>{A?A.push(ne):V.fire(ne)});w&&w.add(E);let P=()=>{A?.forEach(ne=>V.fire(ne)),A=null},V=new Ht({onWillAddFirstListener(){E||(E=S(ne=>V.fire(ne)),w&&w.add(E))},onDidAddFirstListener(){A&&(b?setTimeout(P):P())},onDidRemoveLastListener(){E&&E.dispose(),E=null}});return w&&w.add(V),V.event}e.buffer=C;function k(S,b){return(x,w,A)=>{let E=b(new T);return S(function(P){let V=E.evaluate(P);V!==R&&x.call(w,V)},void 0,A)}}e.chain=k;let R=Symbol("HaltChainable");class T{constructor(){this.steps=[]}map(b){return this.steps.push(b),this}forEach(b){return this.steps.push(x=>(b(x),x)),this}filter(b){return this.steps.push(x=>b(x)?x:R),this}reduce(b,x){let w=x;return this.steps.push(A=>(w=b(w,A),w)),this}latch(b=(x,w)=>x===w){let x=!0,w;return this.steps.push(A=>{let E=x||!b(A,w);return x=!1,w=A,E?A:R}),this}evaluate(b){for(let x of this.steps)if(b=x(b),b===R)break;return b}}function y(S,b,x=w=>w){let w=(...V)=>P.fire(x(...V)),A=()=>S.on(b,w),E=()=>S.removeListener(b,w),P=new Ht({onWillAddFirstListener:A,onDidRemoveLastListener:E});return P.event}e.fromNodeEventEmitter=y;function L(S,b,x=w=>w){let w=(...V)=>P.fire(x(...V)),A=()=>S.addEventListener(b,w),E=()=>S.removeEventListener(b,w),P=new Ht({onWillAddFirstListener:A,onDidRemoveLastListener:E});return P.event}e.fromDOMEventEmitter=L;function D(S){return new Promise(b=>s(S)(b))}e.toPromise=D;function O(S){let b=new Ht;return S.then(x=>{b.fire(x)},()=>{b.fire(void 0)}).finally(()=>{b.dispose()}),b.event}e.fromPromise=O;function te(S,b){return S(x=>b.fire(x))}e.forward=te;function re(S,b,x){return b(x),S(w=>b(w))}e.runAndSubscribe=re;class xe{constructor(b,x){this._observable=b,this._counter=0,this._hasChanged=!1;let w={onWillAddFirstListener:()=>{b.addObserver(this)},onDidRemoveLastListener:()=>{b.removeObserver(this)}};x||t(w),this.emitter=new Ht(w),x&&x.add(this.emitter)}beginUpdate(b){this._counter++}handlePossibleChange(b){}handleChange(b,x){this._hasChanged=!0}endUpdate(b){this._counter--,this._counter===0&&(this._observable.reportChanges(),this._hasChanged&&(this._hasChanged=!1,this.emitter.fire(this._observable.get())))}}function ie(S,b){return new xe(S,b).emitter.event}e.fromObservable=ie;function Ke(S){return(b,x,w)=>{let A=0,E=!1,P={beginUpdate(){A++},endUpdate(){A--,A===0&&(S.reportChanges(),E&&(E=!1,b.call(x)))},handlePossibleChange(){},handleChange(){E=!0}};S.addObserver(P),S.reportChanges();let V={dispose(){S.removeObserver(P)}};return w instanceof Il?w.add(V):Array.isArray(w)&&w.push(V),V}}e.fromObservableLight=Ke})(zl||(zl={}));Rl=class Ml{constructor(t){this.listenerCount=0,this.invocationCount=0,this.elapsedOverall=0,this.durations=[],this.name=`${t}_${Ml._idPool++}`,Ml.all.add(this)}start(t){this._stopWatch=new $b,this.listenerCount=t}stop(){if(this._stopWatch){let t=this._stopWatch.elapsed();this.durations.push(t),this.elapsedOverall+=t,this.invocationCount+=1,this._stopWatch=void 0}}};Rl.all=new Set,Rl._idPool=0;Db=Rl,gu=-1,$u=class Tu{constructor(t,i,s=(Tu._idPool++).toString(16).padStart(3,"0")){this._errorHandler=t,this.threshold=i,this.name=s,this._warnCountdown=0}dispose(){this._stacks?.clear()}check(t,i){let s=this.threshold;if(s<=0||i<s)return;this._stacks||(this._stacks=new Map);let r=this._stacks.get(t.value)||0;if(this._stacks.set(t.value,r+1),this._warnCountdown-=1,this._warnCountdown<=0){this._warnCountdown=s*.5;let[o,n]=this.getMostFrequentStack(),a=`[${this.name}] potential listener LEAK detected, having ${i} listeners already. MOST frequent listener (${n}):`;console.warn(a),console.warn(o);let h=new Mb(a,o);this._errorHandler(h)}return()=>{let o=this._stacks.get(t.value)||0;this._stacks.set(t.value,o-1)}}getMostFrequentStack(){if(!this._stacks)return;let t,i=0;for(let[s,r]of this._stacks)(!t||i<r)&&(t=[s,r],i=r);return t}};$u._idPool=1;Rb=$u,Bl=class Lu{constructor(t){this.value=t}static create(){let t=new Error;return new Lu(t.stack??"")}print(){console.warn(this.value.split(`
`).slice(2).join(`
`))}},Mb=class extends Error{constructor(e,t){super(e),this.name="ListenerLeakError",this.stack=t}},Bb=class extends Error{constructor(e,t){super(e),this.name="ListenerRefusalError",this.stack=t}},Pb=0,Yo=class{constructor(e){this.value=e,this.id=Pb++}},Ob=2,Ib=(e,t)=>{if(e instanceof Yo)t(e);else for(let i=0;i<e.length;i++){let s=e[i];s&&t(s)}};if(Tb){let e=[];setInterval(()=>{e.length!==0&&(console.warn("[LEAKING LISTENERS] GC'ed these listeners that were NOT yet disposed:"),console.warn(e.join(`
`)),e.length=0)},3e3),Go=new FinalizationRegistry(t=>{typeof t=="string"&&e.push(t)})}Ht=class{constructor(e){this._size=0,this._options=e,this._leakageMon=gu>0||this._options?.leakWarningThreshold?new Rb(e?.onListenerError??kl,this._options?.leakWarningThreshold??gu):void 0,this._perfMon=this._options?._profName?new Db(this._options._profName):void 0,this._deliveryQueue=this._options?.deliveryQueue}dispose(){if(!this._disposed){if(this._disposed=!0,this._deliveryQueue?.current===this&&this._deliveryQueue.reset(),this._listeners){if(_u){let e=this._listeners;queueMicrotask(()=>{Ib(e,t=>t.stack?.print())})}this._listeners=void 0,this._size=0}this._options?.onDidRemoveLastListener?.(),this._leakageMon?.dispose()}}get event(){return this._event??(this._event=(e,t,i)=>{if(this._leakageMon&&this._size>this._leakageMon.threshold**2){let a=`[${this._leakageMon.name}] REFUSES to accept new listeners because it exceeded its threshold by far (${this._size} vs ${this._leakageMon.threshold})`;console.warn(a);let h=this._leakageMon.getMostFrequentStack()??["UNKNOWN stack",-1],l=new Bb(`${a}. HINT: Stack shows most frequent listener (${h[1]}-times)`,h[0]);return(this._options?.onListenerError||kl)(l),Ft.None}if(this._disposed)return Ft.None;t&&(e=e.bind(t));let s=new Yo(e),r,o;this._leakageMon&&this._size>=Math.ceil(this._leakageMon.threshold*.2)&&(s.stack=Bl.create(),r=this._leakageMon.check(s.stack,this._size+1)),_u&&(s.stack=o??Bl.create()),this._listeners?this._listeners instanceof Yo?(this._deliveryQueue??(this._deliveryQueue=new zb),this._listeners=[this._listeners,s]):this._listeners.push(s):(this._options?.onWillAddFirstListener?.(this),this._listeners=s,this._options?.onDidAddFirstListener?.(this)),this._size++;let n=As(()=>{Go?.unregister(n),r?.(),this._removeListener(s)});if(i instanceof Il?i.add(n):Array.isArray(i)&&i.push(n),Go){let a=new Error().stack.split(`
`).slice(2,3).join(`
`).trim(),h=/(file:|vscode-file:\/\/vscode-app)?(\/[^:]*:\d+:\d+)/.exec(a);Go.register(n,h?.[2]??a,n)}return n}),this._event}_removeListener(e){if(this._options?.onWillRemoveListener?.(this),!this._listeners)return;if(this._size===1){this._listeners=void 0,this._options?.onDidRemoveLastListener?.(this),this._size=0;return}let t=this._listeners,i=t.indexOf(e);if(i===-1)throw console.log("disposed?",this._disposed),console.log("size?",this._size),console.log("arr?",JSON.stringify(this._listeners)),new Error("Attempted to dispose unknown listener");this._size--,t[i]=void 0;let s=this._deliveryQueue.current===this;if(this._size*Ob<=t.length){let r=0;for(let o=0;o<t.length;o++)t[o]?t[r++]=t[o]:s&&(this._deliveryQueue.end--,r<this._deliveryQueue.i&&this._deliveryQueue.i--);t.length=r}}_deliver(e,t){if(!e)return;let i=this._options?.onListenerError||kl;if(!i){e.value(t);return}try{e.value(t)}catch(s){i(s)}}_deliverQueue(e){let t=e.current._listeners;for(;e.i<e.end;)this._deliver(t[e.i++],e.value);e.reset()}fire(e){if(this._deliveryQueue?.current&&(this._deliverQueue(this._deliveryQueue),this._perfMon?.stop()),this._perfMon?.start(this._size),this._listeners)if(this._listeners instanceof Yo)this._deliver(this._listeners,e);else{let t=this._deliveryQueue;t.enqueue(this,e,this._listeners.length),this._deliverQueue(t)}this._perfMon?.stop()}hasListeners(){return this._size>0}},zb=class{constructor(){this.i=-1,this.end=0}enqueue(e,t,i){this.i=0,this.end=i,this.current=e,this.value=t}reset(){this.i=this.end,this.current=void 0,this.value=void 0}},Du=Object.freeze(function(e,t){let i=setTimeout(e.bind(t),0);return{dispose(){clearTimeout(i)}}});(e=>{function t(i){return i===e.None||i===e.Cancelled||i instanceof Hb?!0:!i||typeof i!="object"?!1:typeof i.isCancellationRequested=="boolean"&&typeof i.onCancellationRequested=="function"}e.isCancellationToken=t,e.None=Object.freeze({isCancellationRequested:!1,onCancellationRequested:zl.None}),e.Cancelled=Object.freeze({isCancellationRequested:!0,onCancellationRequested:Du})})(Nb||(Nb={}));Hb=class{constructor(){this._isCancelled=!1,this._emitter=null}cancel(){this._isCancelled||(this._isCancelled=!0,this._emitter&&(this._emitter.fire(void 0),this.dispose()))}get isCancellationRequested(){return this._isCancelled}get onCancellationRequested(){return this._isCancelled?Du:(this._emitter||(this._emitter=new Ht),this._emitter.event)}dispose(){this._emitter&&(this._emitter.dispose(),this._emitter=null)}},ks="en",Pl=!1,Ol=!1,Xo=!1,Fb=!1,Wb=!1,Ru=!1,Vb=!1,Ub=!1,qb=!1,Kb=!1,Jo=ks,vu=ks,si=globalThis;typeof si.vscode<"u"&&typeof si.vscode.process<"u"?pt=si.vscode.process:typeof process<"u"&&typeof process?.versions?.node=="string"&&(pt=process);Mu=typeof pt?.versions?.electron=="string",Yb=Mu&&pt?.type==="renderer";if(typeof pt=="object"){Pl=pt.platform==="win32",Ol=pt.platform==="darwin",Xo=pt.platform==="linux",Fb=Xo&&!!pt.env.SNAP&&!!pt.env.SNAP_REVISION,Vb=Mu,qb=!!pt.env.CI||!!pt.env.BUILD_ARTIFACTSTAGINGDIRECTORY,jo=ks,Jo=ks;let e=pt.env.VSCODE_NLS_CONFIG;if(e)try{let t=JSON.parse(e);jo=t.userLocale,vu=t.osLocale,Jo=t.resolvedLanguage||ks,jb=t.languagePack?.translationsConfigFile}catch{}Wb=!0}else typeof navigator=="object"&&!Yb?(ii=navigator.userAgent,Pl=ii.indexOf("Windows")>=0,Ol=ii.indexOf("Macintosh")>=0,Ub=(ii.indexOf("Macintosh")>=0||ii.indexOf("iPad")>=0||ii.indexOf("iPhone")>=0)&&!!navigator.maxTouchPoints&&navigator.maxTouchPoints>0,Xo=ii.indexOf("Linux")>=0,Kb=ii?.indexOf("Mobi")>=0,Ru=!0,Jo=globalThis._VSCODE_NLS_LANGUAGE||ks,jo=navigator.language.toLowerCase(),vu=jo):console.error("Unable to resolve platform.");El=0;Ol?El=1:Pl?El=3:Xo&&(El=2);Gb=Ru&&typeof si.importScripts=="function",Wx=Gb?si.origin:void 0,Wt=ii,wi=Jo;(e=>{function t(){return wi}e.value=t;function i(){return wi.length===2?wi==="en":wi.length>=3?wi[0]==="e"&&wi[1]==="n"&&wi[2]==="-":!1}e.isDefaultVariant=i;function s(){return wi==="en"}e.isDefault=s})(Xb||(Xb={}));Jb=typeof si.postMessage=="function"&&!si.importScripts,Zb=(()=>{if(Jb){let e=[];si.addEventListener("message",i=>{if(i.data&&i.data.vscodeScheduleAsyncWork)for(let s=0,r=e.length;s<r;s++){let o=e[s];if(o.id===i.data.vscodeScheduleAsyncWork){e.splice(s,1),o.callback();return}}});let t=0;return i=>{let s=++t;e.push({id:s,callback:i}),si.postMessage({vscodeScheduleAsyncWork:s},"*")}}return e=>setTimeout(e)})(),Qb=!!(Wt&&Wt.indexOf("Chrome")>=0),Vx=!!(Wt&&Wt.indexOf("Firefox")>=0),Ux=!!(!Qb&&Wt&&Wt.indexOf("Safari")>=0),qx=!!(Wt&&Wt.indexOf("Edg/")>=0),Kx=!!(Wt&&Wt.indexOf("Android")>=0);(function(){typeof globalThis.requestIdleCallback!="function"||typeof globalThis.cancelIdleCallback!="function"?Al=(e,t)=>{Zb(()=>{if(i)return;let s=Date.now()+15;t(Object.freeze({didTimeout:!0,timeRemaining(){return Math.max(0,s-Date.now())}}))});let i=!1;return{dispose(){i||(i=!0)}}}:Al=(e,t,i)=>{let s=e.requestIdleCallback(t,typeof i=="number"?{timeout:i}:void 0),r=!1;return{dispose(){r||(r=!0,e.cancelIdleCallback(s))}}},e0=e=>Al(globalThis,e)})();(e=>{async function t(s){let r,o=await Promise.all(s.map(n=>n.then(a=>a,a=>{r||(r=a)})));if(typeof r<"u")throw r;return o}e.settled=t;function i(s){return new Promise(async(r,o)=>{try{await s(r,o)}catch(n){o(n)}})}e.withAsyncBody=i})(t0||(t0={}));bu=class yt{static fromArray(t){return new yt(i=>{i.emitMany(t)})}static fromPromise(t){return new yt(async i=>{i.emitMany(await t)})}static fromPromises(t){return new yt(async i=>{await Promise.all(t.map(async s=>i.emitOne(await s)))})}static merge(t){return new yt(async i=>{await Promise.all(t.map(async s=>{for await(let r of s)i.emitOne(r)}))})}constructor(t,i){this._state=0,this._results=[],this._error=null,this._onReturn=i,this._onStateChanged=new Ht,queueMicrotask(async()=>{let s={emitOne:r=>this.emitOne(r),emitMany:r=>this.emitMany(r),reject:r=>this.reject(r)};try{await Promise.resolve(t(s)),this.resolve()}catch(r){this.reject(r)}finally{s.emitOne=void 0,s.emitMany=void 0,s.reject=void 0}})}[Symbol.asyncIterator](){let t=0;return{next:async()=>{do{if(this._state===2)throw this._error;if(t<this._results.length)return{done:!1,value:this._results[t++]};if(this._state===1)return{done:!0,value:void 0};await zl.toPromise(this._onStateChanged.event)}while(!0)},return:async()=>(this._onReturn?.(),{done:!0,value:void 0})}}static map(t,i){return new yt(async s=>{for await(let r of t)s.emitOne(i(r))})}map(t){return yt.map(this,t)}static filter(t,i){return new yt(async s=>{for await(let r of t)i(r)&&s.emitOne(r)})}filter(t){return yt.filter(this,t)}static coalesce(t){return yt.filter(t,i=>!!i)}coalesce(){return yt.coalesce(this)}static async toPromise(t){let i=[];for await(let s of t)i.push(s);return i}toPromise(){return yt.toPromise(this)}emitOne(t){this._state===0&&(this._results.push(t),this._onStateChanged.fire())}emitMany(t){this._state===0&&(this._results=this._results.concat(t),this._onStateChanged.fire())}resolve(){this._state===0&&(this._state=1,this._onStateChanged.fire())}reject(t){this._state===0&&(this._state=2,this._error=t,this._onStateChanged.fire())}};bu.EMPTY=bu.fromArray([]);i0=class extends Ft{constructor(e){super(),this._terminal=e,this._linesCacheTimeout=this._register(new Zo),this._linesCacheDisposables=this._register(new Zo),this._register(As(()=>this._destroyLinesCache()))}initLinesCache(){this._linesCache||(this._linesCache=new Array(this._terminal.buffer.active.length),this._linesCacheDisposables.value=xu(this._terminal.onLineFeed(()=>this._destroyLinesCache()),this._terminal.onCursorMove(()=>this._destroyLinesCache()),this._terminal.onResize(()=>this._destroyLinesCache()))),this._linesCacheTimeout.value=Bu(()=>this._destroyLinesCache(),15e3)}_destroyLinesCache(){this._linesCache=void 0,this._linesCacheDisposables.clear(),this._linesCacheTimeout.clear()}getLineFromCache(e){return this._linesCache?.[e]}setLineInCache(e,t){this._linesCache&&(this._linesCache[e]=t)}translateBufferLineToStringWithWrap(e,t){let i=[],s=[0],r=this._terminal.buffer.active.getLine(e);for(;r;){let o=this._terminal.buffer.active.getLine(e+1),n=o?o.isWrapped:!1,a=r.translateToString(!n&&t);if(n&&o){let h=r.getCell(r.length-1);h&&h.getCode()===0&&h.getWidth()===1&&o.getCell(0)?.getWidth()===2&&(a=a.slice(0,-1))}if(i.push(a),n)s.push(s[s.length-1]+a.length);else break;e++,r=o}return[i.join(""),s]}},s0=class{get cachedSearchTerm(){return this._cachedSearchTerm}set cachedSearchTerm(e){this._cachedSearchTerm=e}get lastSearchOptions(){return this._lastSearchOptions}set lastSearchOptions(e){this._lastSearchOptions=e}isValidSearchTerm(e){return!!(e&&e.length>0)}didOptionsChange(e){return this._lastSearchOptions?e?this._lastSearchOptions.caseSensitive!==e.caseSensitive||this._lastSearchOptions.regex!==e.regex||this._lastSearchOptions.wholeWord!==e.wholeWord:!1:!0}shouldUpdateHighlighting(e,t){return t?.decorations?this._cachedSearchTerm===void 0||e!==this._cachedSearchTerm||this.didOptionsChange(t):!1}clearCachedTerm(){this._cachedSearchTerm=void 0}reset(){this._cachedSearchTerm=void 0,this._lastSearchOptions=void 0}},r0=class{constructor(e,t){this._terminal=e,this._lineCache=t}find(e,t,i,s){if(!e||e.length===0){this._terminal.clearSelection();return}if(i>this._terminal.cols)throw new Error(`Invalid col: ${i} to search in terminal of ${this._terminal.cols} cols`);this._lineCache.initLinesCache();let r={startRow:t,startCol:i},o=this._findInLine(e,r,s);if(!o)for(let n=t+1;n<this._terminal.buffer.active.baseY+this._terminal.rows&&(r.startRow=n,r.startCol=0,o=this._findInLine(e,r,s),!o);n++);return o}findNextWithSelection(e,t,i){if(!e||e.length===0){this._terminal.clearSelection();return}let s=this._terminal.getSelectionPosition();this._terminal.clearSelection();let r=0,o=0;s&&(i===e?(r=s.end.x,o=s.end.y):(r=s.start.x,o=s.start.y)),this._lineCache.initLinesCache();let n={startRow:o,startCol:r},a=this._findInLine(e,n,t);if(!a)for(let h=o+1;h<this._terminal.buffer.active.baseY+this._terminal.rows&&(n.startRow=h,n.startCol=0,a=this._findInLine(e,n,t),!a);h++);if(!a&&o!==0)for(let h=0;h<o&&(n.startRow=h,n.startCol=0,a=this._findInLine(e,n,t),!a);h++);return!a&&s&&(n.startRow=s.start.y,n.startCol=0,a=this._findInLine(e,n,t)),a}findPreviousWithSelection(e,t,i){if(!e||e.length===0){this._terminal.clearSelection();return}let s=this._terminal.getSelectionPosition();this._terminal.clearSelection();let r=this._terminal.buffer.active.baseY+this._terminal.rows-1,o=this._terminal.cols,n=!0;this._lineCache.initLinesCache();let a={startRow:r,startCol:o},h;if(s&&(a.startRow=r=s.start.y,a.startCol=o=s.start.x,i!==e&&(h=this._findInLine(e,a,t,!1),h||(a.startRow=r=s.end.y,a.startCol=o=s.end.x))),h||(h=this._findInLine(e,a,t,n)),!h){a.startCol=Math.max(a.startCol,this._terminal.cols);for(let l=r-1;l>=0&&(a.startRow=l,h=this._findInLine(e,a,t,n),!h);l--);}if(!h&&r!==this._terminal.buffer.active.baseY+this._terminal.rows-1)for(let l=this._terminal.buffer.active.baseY+this._terminal.rows-1;l>=r&&(a.startRow=l,h=this._findInLine(e,a,t,n),!h);l--);return h}_isWholeWord(e,t,i){return(e===0||" ~!@#$%^&*()+`-=[]{}|\\;:\"',./<>?".includes(t[e-1]))&&(e+i.length===t.length||" ~!@#$%^&*()+`-=[]{}|\\;:\"',./<>?".includes(t[e+i.length]))}_findInLine(e,t,i={},s=!1){let r=t.startRow,o=t.startCol;if(this._terminal.buffer.active.getLine(r)?.isWrapped){if(s){t.startCol+=this._terminal.cols;return}return t.startRow--,t.startCol+=this._terminal.cols,this._findInLine(e,t,i)}let n=this._lineCache.getLineFromCache(r);n||(n=this._lineCache.translateBufferLineToStringWithWrap(r,!0),this._lineCache.setLineInCache(r,n));let[a,h]=n,l=this._bufferColsToStringOffset(r,o),c=e,d=a;i.regex||(c=i.caseSensitive?e:e.toLowerCase(),d=i.caseSensitive?a:a.toLowerCase());let p=-1;if(i.regex){let f=RegExp(c,i.caseSensitive?"g":"gi"),m;if(s)for(;m=f.exec(d.slice(0,l));)p=f.lastIndex-m[0].length,e=m[0],f.lastIndex-=e.length-1;else m=f.exec(d.slice(l)),m&&m[0].length>0&&(p=l+(f.lastIndex-m[0].length),e=m[0])}else s?l-c.length>=0&&(p=d.lastIndexOf(c,l-c.length)):p=d.indexOf(c,l);if(p>=0){if(i.wholeWord&&!this._isWholeWord(p,d,e))return;let f=0;for(;f<h.length-1&&p>=h[f+1];)f++;let m=f;for(;m<h.length-1&&p+e.length>=h[m+1];)m++;let _=p-h[f],C=p+e.length-h[m],k=this._stringLengthToBufferSize(r+f,_),R=this._stringLengthToBufferSize(r+m,C)-k+this._terminal.cols*(m-f);return{term:e,col:k,row:r+f,size:R}}}_stringLengthToBufferSize(e,t){let i=this._terminal.buffer.active.getLine(e);if(!i)return 0;for(let s=0;s<t;s++){let r=i.getCell(s);if(!r)break;let o=r.getChars();o.length>1&&(t-=o.length-1);let n=i.getCell(s+1);n&&n.getWidth()===0&&t++}return t}_bufferColsToStringOffset(e,t){let i=e,s=0,r=this._terminal.buffer.active.getLine(i);for(;t>0&&r;){for(let o=0;o<t&&o<this._terminal.cols;o++){let n=r.getCell(o);if(!n)break;n.getWidth()&&(s+=n.getCode()===0?1:n.getChars().length)}if(i++,r=this._terminal.buffer.active.getLine(i),r&&!r.isWrapped)break;t-=this._terminal.cols}return s}},o0=class extends Ft{constructor(e){super(),this._terminal=e,this._highlightDecorations=[],this._highlightedLines=new Set,this._register(As(()=>this.clearHighlightDecorations()))}createHighlightDecorations(e,t){this.clearHighlightDecorations();for(let i of e){let s=this._createResultDecorations(i,t,!1);if(s)for(let r of s)this._storeDecoration(r,i)}}createActiveDecoration(e,t){let i=this._createResultDecorations(e,t,!0);if(i)return{decorations:i,match:e,dispose(){Rr(i)}}}clearHighlightDecorations(){Rr(this._highlightDecorations),this._highlightDecorations=[],this._highlightedLines.clear()}_storeDecoration(e,t){this._highlightedLines.add(e.marker.line),this._highlightDecorations.push({decoration:e,match:t,dispose(){e.dispose()}})}_applyStyles(e,t,i){e.classList.contains("xterm-find-result-decoration")||(e.classList.add("xterm-find-result-decoration"),t&&(e.style.outline=`1px solid ${t}`)),i&&e.classList.add("xterm-find-active-result-decoration")}_createResultDecorations(e,t,i){let s=[],r=e.col,o=e.size,n=-this._terminal.buffer.active.baseY-this._terminal.buffer.active.cursorY+e.row;for(;o>0;){let h=Math.min(this._terminal.cols-r,o);s.push([n,r,h]),r=0,o-=h,n++}let a=[];for(let h of s){let l=this._terminal.registerMarker(h[0]),c=this._terminal.registerDecoration({marker:l,x:h[1],width:h[2],backgroundColor:i?t.activeMatchBackground:t.matchBackground,overviewRulerOptions:this._highlightedLines.has(l.line)?void 0:{color:i?t.activeMatchColorOverviewRuler:t.matchOverviewRuler,position:"center"}});if(c){let d=[];d.push(l),d.push(c.onRender(p=>this._applyStyles(p,i?t.activeMatchBorder:t.matchBorder,!1))),d.push(c.onDispose(()=>Rr(d))),a.push(c)}}return a.length===0?void 0:a}},n0=class extends Ft{constructor(){super(...arguments),this._searchResults=[],this._onDidChangeResults=this._register(new Ht)}get onDidChangeResults(){return this._onDidChangeResults.event}get searchResults(){return this._searchResults}get selectedDecoration(){return this._selectedDecoration}set selectedDecoration(e){this._selectedDecoration=e}updateResults(e,t){this._searchResults=e.slice(0,t)}clearResults(){this._searchResults=[]}clearSelectedDecoration(){this._selectedDecoration&&(this._selectedDecoration.dispose(),this._selectedDecoration=void 0)}findResultIndex(e){for(let t=0;t<this._searchResults.length;t++){let i=this._searchResults[t];if(i.row===e.row&&i.col===e.col&&i.size===e.size)return t}return-1}fireResultsChanged(e){if(!e)return;let t=-1;this._selectedDecoration&&(t=this.findResultIndex(this._selectedDecoration.match)),this._onDidChangeResults.fire({resultIndex:t,resultCount:this._searchResults.length})}reset(){this.clearSelectedDecoration(),this.clearResults()}},a0=class extends Ft{constructor(e){super(),this._highlightTimeout=this._register(new Zo),this._lineCache=this._register(new Zo),this._state=new s0,this._resultTracker=this._register(new n0),this._highlightLimit=e?.highlightLimit??1e3}get onDidChangeResults(){return this._resultTracker.onDidChangeResults}activate(e){this._terminal=e,this._lineCache.value=new i0(e),this._engine=new r0(e,this._lineCache.value),this._decorationManager=new o0(e),this._register(this._terminal.onWriteParsed(()=>this._updateMatches())),this._register(this._terminal.onResize(()=>this._updateMatches())),this._register(As(()=>this.clearDecorations()))}_updateMatches(){this._highlightTimeout.clear(),this._state.cachedSearchTerm&&this._state.lastSearchOptions?.decorations&&(this._highlightTimeout.value=Bu(()=>{let e=this._state.cachedSearchTerm;this._state.clearCachedTerm(),this.findPrevious(e,{...this._state.lastSearchOptions,incremental:!0},{noScroll:!0})},200))}clearDecorations(e){this._resultTracker.clearSelectedDecoration(),this._decorationManager?.clearHighlightDecorations(),this._resultTracker.clearResults(),e||this._state.clearCachedTerm()}clearActiveDecoration(){this._resultTracker.clearSelectedDecoration()}findNext(e,t,i){if(!this._terminal||!this._engine)throw new Error("Cannot use addon until it has been loaded");this._state.lastSearchOptions=t,this._state.shouldUpdateHighlighting(e,t)&&this._highlightAllMatches(e,t);let s=this._findNextAndSelect(e,t,i);return this._fireResults(t),this._state.cachedSearchTerm=e,s}_highlightAllMatches(e,t){if(!this._terminal||!this._engine||!this._decorationManager)throw new Error("Cannot use addon until it has been loaded");if(!this._state.isValidSearchTerm(e)){this.clearDecorations();return}this.clearDecorations(!0);let i=[],s,r=this._engine.find(e,0,0,t);for(;r&&(s?.row!==r.row||s?.col!==r.col)&&!(i.length>=this._highlightLimit);)s=r,i.push(s),r=this._engine.find(e,s.col+s.term.length>=this._terminal.cols?s.row+1:s.row,s.col+s.term.length>=this._terminal.cols?0:s.col+1,t);this._resultTracker.updateResults(i,this._highlightLimit),t.decorations&&this._decorationManager.createHighlightDecorations(i,t.decorations)}_findNextAndSelect(e,t,i){if(!this._terminal||!this._engine)return!1;if(!this._state.isValidSearchTerm(e))return this._terminal.clearSelection(),this.clearDecorations(),!1;let s=this._engine.findNextWithSelection(e,t,this._state.cachedSearchTerm);return this._selectResult(s,t?.decorations,i?.noScroll)}findPrevious(e,t,i){if(!this._terminal||!this._engine)throw new Error("Cannot use addon until it has been loaded");this._state.lastSearchOptions=t,this._state.shouldUpdateHighlighting(e,t)&&this._highlightAllMatches(e,t);let s=this._findPreviousAndSelect(e,t,i);return this._fireResults(t),this._state.cachedSearchTerm=e,s}_fireResults(e){this._resultTracker.fireResultsChanged(!!e?.decorations)}_findPreviousAndSelect(e,t,i){if(!this._terminal||!this._engine)return!1;if(!this._state.isValidSearchTerm(e))return this._terminal.clearSelection(),this.clearDecorations(),!1;let s=this._engine.findPreviousWithSelection(e,t,this._state.cachedSearchTerm);return this._selectResult(s,t?.decorations,i?.noScroll)}_selectResult(e,t,i){if(!this._terminal||!this._decorationManager)return!1;if(this._resultTracker.clearSelectedDecoration(),!e)return this._terminal.clearSelection(),!1;if(this._terminal.select(e.col,e.row,e.size),t){let s=this._decorationManager.createActiveDecoration(e,t);s&&(this._resultTracker.selectedDecoration=s)}if(!i&&(e.row>=this._terminal.buffer.active.viewportY+this._terminal.rows||e.row<this._terminal.buffer.active.viewportY)){let s=e.row-this._terminal.buffer.active.viewportY;s-=Math.floor(this._terminal.rows/2),this._terminal.scrollLines(s)}return!0}}});var Ks=globalThis,Ah=e=>e,so=Ks.trustedTypes,$h=so?so.createPolicy("lit-html",{createHTML:e=>e}):void 0,Bn="$lit$",Yt=`lit$${Math.random().toFixed(9).slice(2)}$`,Pn="?"+Yt,qf=`<${Pn}>`,Mi=document,js=()=>Mi.createComment(""),Ys=e=>e===null||typeof e!="object"&&typeof e!="function",On=Array.isArray,Bh=e=>On(e)||typeof e?.[Symbol.iterator]=="function",Mn=`[ 	
\f\r]`,qs=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,Th=/-->/g,Lh=/>/g,Di=RegExp(`>|${Mn}(?:([^\\s"'>=/]+)(${Mn}*=${Mn}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),Dh=/'/g,Rh=/"/g,Ph=/^(?:script|style|textarea|title)$/i,In=e=>(t,...i)=>({_$litType$:e,strings:t,values:i}),g=In(1),Oh=In(2),Ih=In(3),je=Symbol.for("lit-noChange"),B=Symbol.for("lit-nothing"),Mh=new WeakMap,Ri=Mi.createTreeWalker(Mi,129);function zh(e,t){if(!On(e)||!e.hasOwnProperty("raw"))throw Error("invalid template strings array");return $h!==void 0?$h.createHTML(t):t}var Nh=(e,t)=>{let i=e.length-1,s=[],r,o=t===2?"<svg>":t===3?"<math>":"",n=qs;for(let a=0;a<i;a++){let h=e[a],l,c,d=-1,p=0;for(;p<h.length&&(n.lastIndex=p,c=n.exec(h),c!==null);)p=n.lastIndex,n===qs?c[1]==="!--"?n=Th:c[1]!==void 0?n=Lh:c[2]!==void 0?(Ph.test(c[2])&&(r=RegExp("</"+c[2],"g")),n=Di):c[3]!==void 0&&(n=Di):n===Di?c[0]===">"?(n=r??qs,d=-1):c[1]===void 0?d=-2:(d=n.lastIndex-c[2].length,l=c[1],n=c[3]===void 0?Di:c[3]==='"'?Rh:Dh):n===Rh||n===Dh?n=Di:n===Th||n===Lh?n=qs:(n=Di,r=void 0);let f=n===Di&&e[a+1].startsWith("/>")?" ":"";o+=n===qs?h+qf:d>=0?(s.push(l),h.slice(0,d)+Bn+h.slice(d)+Yt+f):h+Yt+(d===-2?a:f)}return[zh(e,o+(e[i]||"<?>")+(t===2?"</svg>":t===3?"</math>":"")),s]},Gs=class e{constructor({strings:t,_$litType$:i},s){let r;this.parts=[];let o=0,n=0,a=t.length-1,h=this.parts,[l,c]=Nh(t,i);if(this.el=e.createElement(l,s),Ri.currentNode=this.el.content,i===2||i===3){let d=this.el.content.firstChild;d.replaceWith(...d.childNodes)}for(;(r=Ri.nextNode())!==null&&h.length<a;){if(r.nodeType===1){if(r.hasAttributes())for(let d of r.getAttributeNames())if(d.endsWith(Bn)){let p=c[n++],f=r.getAttribute(d).split(Yt),m=/([.?@])?(.*)/.exec(p);h.push({type:1,index:o,name:m[2],strings:f,ctor:m[1]==="."?oo:m[1]==="?"?no:m[1]==="@"?ao:Pi}),r.removeAttribute(d)}else d.startsWith(Yt)&&(h.push({type:6,index:o}),r.removeAttribute(d));if(Ph.test(r.tagName)){let d=r.textContent.split(Yt),p=d.length-1;if(p>0){r.textContent=so?so.emptyScript:"";for(let f=0;f<p;f++)r.append(d[f],js()),Ri.nextNode(),h.push({type:2,index:++o});r.append(d[p],js())}}}else if(r.nodeType===8)if(r.data===Pn)h.push({type:2,index:o});else{let d=-1;for(;(d=r.data.indexOf(Yt,d+1))!==-1;)h.push({type:7,index:o}),d+=Yt.length-1}o++}}static createElement(t,i){let s=Mi.createElement("template");return s.innerHTML=t,s}};function Bi(e,t,i=e,s){if(t===je)return t;let r=s!==void 0?i._$Co?.[s]:i._$Cl,o=Ys(t)?void 0:t._$litDirective$;return r?.constructor!==o&&(r?._$AO?.(!1),o===void 0?r=void 0:(r=new o(e),r._$AT(e,i,s)),s!==void 0?(i._$Co??(i._$Co=[]))[s]=r:i._$Cl=r),r!==void 0&&(t=Bi(e,r._$AS(e,t.values),r,s)),t}var ro=class{constructor(t,i){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=i}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){let{el:{content:i},parts:s}=this._$AD,r=(t?.creationScope??Mi).importNode(i,!0);Ri.currentNode=r;let o=Ri.nextNode(),n=0,a=0,h=s[0];for(;h!==void 0;){if(n===h.index){let l;h.type===2?l=new us(o,o.nextSibling,this,t):h.type===1?l=new h.ctor(o,h.name,h.strings,this,t):h.type===6&&(l=new lo(o,this,t)),this._$AV.push(l),h=s[++a]}n!==h?.index&&(o=Ri.nextNode(),n++)}return Ri.currentNode=Mi,r}p(t){let i=0;for(let s of this._$AV)s!==void 0&&(s.strings!==void 0?(s._$AI(t,s,i),i+=s.strings.length-2):s._$AI(t[i])),i++}},us=class e{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,i,s,r){this.type=2,this._$AH=B,this._$AN=void 0,this._$AA=t,this._$AB=i,this._$AM=s,this.options=r,this._$Cv=r?.isConnected??!0}get parentNode(){let t=this._$AA.parentNode,i=this._$AM;return i!==void 0&&t?.nodeType===11&&(t=i.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,i=this){t=Bi(this,t,i),Ys(t)?t===B||t==null||t===""?(this._$AH!==B&&this._$AR(),this._$AH=B):t!==this._$AH&&t!==je&&this._(t):t._$litType$!==void 0?this.$(t):t.nodeType!==void 0?this.T(t):Bh(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==B&&Ys(this._$AH)?this._$AA.nextSibling.data=t:this.T(Mi.createTextNode(t)),this._$AH=t}$(t){let{values:i,_$litType$:s}=t,r=typeof s=="number"?this._$AC(t):(s.el===void 0&&(s.el=Gs.createElement(zh(s.h,s.h[0]),this.options)),s);if(this._$AH?._$AD===r)this._$AH.p(i);else{let o=new ro(r,this),n=o.u(this.options);o.p(i),this.T(n),this._$AH=o}}_$AC(t){let i=Mh.get(t.strings);return i===void 0&&Mh.set(t.strings,i=new Gs(t)),i}k(t){On(this._$AH)||(this._$AH=[],this._$AR());let i=this._$AH,s,r=0;for(let o of t)r===i.length?i.push(s=new e(this.O(js()),this.O(js()),this,this.options)):s=i[r],s._$AI(o),r++;r<i.length&&(this._$AR(s&&s._$AB.nextSibling,r),i.length=r)}_$AR(t=this._$AA.nextSibling,i){for(this._$AP?.(!1,!0,i);t!==this._$AB;){let s=Ah(t).nextSibling;Ah(t).remove(),t=s}}setConnected(t){this._$AM===void 0&&(this._$Cv=t,this._$AP?.(t))}},Pi=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,i,s,r,o){this.type=1,this._$AH=B,this._$AN=void 0,this.element=t,this.name=i,this._$AM=r,this.options=o,s.length>2||s[0]!==""||s[1]!==""?(this._$AH=Array(s.length-1).fill(new String),this.strings=s):this._$AH=B}_$AI(t,i=this,s,r){let o=this.strings,n=!1;if(o===void 0)t=Bi(this,t,i,0),n=!Ys(t)||t!==this._$AH&&t!==je,n&&(this._$AH=t);else{let a=t,h,l;for(t=o[0],h=0;h<o.length-1;h++)l=Bi(this,a[s+h],i,h),l===je&&(l=this._$AH[h]),n||(n=!Ys(l)||l!==this._$AH[h]),l===B?t=B:t!==B&&(t+=(l??"")+o[h+1]),this._$AH[h]=l}n&&!r&&this.j(t)}j(t){t===B?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"")}},oo=class extends Pi{constructor(){super(...arguments),this.type=3}j(t){this.element[this.name]=t===B?void 0:t}},no=class extends Pi{constructor(){super(...arguments),this.type=4}j(t){this.element.toggleAttribute(this.name,!!t&&t!==B)}},ao=class extends Pi{constructor(t,i,s,r,o){super(t,i,s,r,o),this.type=5}_$AI(t,i=this){if((t=Bi(this,t,i,0)??B)===je)return;let s=this._$AH,r=t===B&&s!==B||t.capture!==s.capture||t.once!==s.once||t.passive!==s.passive,o=t!==B&&(s===B||r);r&&this.element.removeEventListener(this.name,this,s),o&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t)}},lo=class{constructor(t,i,s){this.element=t,this.type=6,this._$AN=void 0,this._$AM=i,this.options=s}get _$AU(){return this._$AM._$AU}_$AI(t){Bi(this,t)}},Hh={M:Bn,P:Yt,A:Pn,C:1,L:Nh,R:ro,D:Bh,V:Bi,I:us,H:Pi,N:no,U:ao,B:oo,F:lo},Kf=Ks.litHtmlPolyfillSupport;Kf?.(Gs,us),(Ks.litHtmlVersions??(Ks.litHtmlVersions=[])).push("3.3.2");var ho=(e,t,i)=>{let s=i?.renderBefore??t,r=s._$litPart$;if(r===void 0){let o=i?.renderBefore??null;s._$litPart$=r=new us(t.insertBefore(js(),o),o,void 0,i??{})}return r._$AI(e),r};function Fh(e={}){let t={activeRunId:e.activeRunId??null,runs:e.runs??{},logLines:e.logLines??[],preferences:{theme:e.preferences?.theme??"light",sidebarCollapsed:e.preferences?.sidebarCollapsed??!1,notifications:e.preferences?.notifications??null},beads:e.beads??{issues:[],dbExists:!1,loading:!1}},i=new Set;function s(){for(let r of Array.from(i))try{r(t)}catch{}}return{getState(){return t},setState(r){let o={...t,...r,preferences:{...t.preferences,...r.preferences||{}}};o.activeRunId===t.activeRunId&&o.runs===t.runs&&o.logLines===t.logLines&&o.preferences.theme===t.preferences.theme&&o.preferences.sidebarCollapsed===t.preferences.sidebarCollapsed&&o.preferences.notifications===t.preferences.notifications&&o.beads===t.beads||(t=o,s())},setRun(r,o){let n={...t.runs,[r]:o};t={...t,runs:n},s()},appendLog(r){let o=[...t.logLines,r];o.length>5e3&&o.splice(0,o.length-5e3),t={...t,logLines:o},s()},clearLog(){t={...t,logLines:[]},s()},subscribe(r){return i.add(r),()=>i.delete(r)}}}var Wh=["subscribe-run","unsubscribe-run","subscribe-log","unsubscribe-log","list-runs","get-agent-prompt","get-preferences","set-preferences","stop-run","resume-run","list-beads-issues","start-beads-issue","list-beads-by-run","run-snapshot","run-update","runs-list","log-line","log-bulk","preferences","run-started","run-stopped","stage-restarted","beads-update"];function zn(){let e=Date.now().toString(36),t=Math.random().toString(36).slice(2,8);return`${e}-${t}`}function Vh(e,t,i=zn()){return{id:i,type:e,payload:t}}function Uh(e={}){let t={initialMs:e.backoff?.initialMs??1e3,maxMs:e.backoff?.maxMs??3e4,factor:e.backoff?.factor??2,jitterRatio:e.backoff?.jitterRatio??.2},i=()=>e.url&&e.url.length>0?e.url:typeof location<"u"?(location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws":"ws://localhost/ws",s=null,r="closed",o=0,n=null,a=!0,h=new Map,l=[],c=new Map,d=new Set;function p(T){for(let y of Array.from(d))try{y(T)}catch{}}function f(){if(!a||n)return;r="reconnecting",p(r);let T=Math.min(t.maxMs,t.initialMs*Math.pow(t.factor,o)),y=t.jitterRatio*T,L=Math.max(0,Math.round(T+(Math.random()*2-1)*y));n=setTimeout(()=>{n=null,R()},L)}function m(T){try{s?.send(JSON.stringify(T))}catch{}}function _(){for(r="open",p(r),o=0;l.length;){let T=l.shift();T&&m(T)}}function C(T){let y;try{y=JSON.parse(String(T.data))}catch{return}if(!y||typeof y.id!="string"||typeof y.type!="string")return;if(h.has(y.id)){let D=h.get(y.id);h.delete(y.id),y.ok?D?.resolve(y.payload):D?.reject(y.error||new Error("ws error"));return}let L=c.get(y.type);if(L&&L.size>0)for(let D of Array.from(L))try{D(y.payload)}catch{}}function k(){r="closed",p(r);for(let[T,y]of h.entries())y.reject(new Error("ws disconnected")),h.delete(T);o+=1,f()}function R(){if(!a)return;let T=i();try{s=new WebSocket(T),r="connecting",p(r),s.addEventListener("open",_),s.addEventListener("message",C),s.addEventListener("error",()=>{}),s.addEventListener("close",k)}catch{f()}}return R(),{send(T,y){if(!Wh.includes(T))return Promise.reject(new Error(`unknown message type: ${T}`));let L=zn(),D=Vh(T,y,L);return new Promise((O,te)=>{h.set(L,{resolve:O,reject:te,type:T}),s&&s.readyState===s.OPEN?m(D):l.push(D)})},on(T,y){c.has(T)||c.set(T,new Set);let L=c.get(T);return L?.add(y),()=>{L?.delete(y)}},onConnection(T){return d.add(T),()=>{d.delete(T)}},close(){a=!1,n&&(clearTimeout(n),n=null);try{s?.close()}catch{}},getState(){return r}}}function Nn(e){let t=(e||"").replace(/^#\/?/,""),[i,s]=t.split("?"),r=i||"active",o=new URLSearchParams(s||"");return{section:r,runId:o.get("run")||null}}function jf(e,t){let i=`#/${e}`;return t?`${i}?run=${t}`:i}function qh(e){let t=()=>e(Nn(location.hash));return window.addEventListener("hashchange",t),()=>window.removeEventListener("hashchange",t)}function lt(e,t){location.hash=jf(e,t)}function Xs(e){document.documentElement.setAttribute("data-theme",e)}var At={ATTRIBUTE:1,CHILD:2,PROPERTY:3,BOOLEAN_ATTRIBUTE:4,EVENT:5,ELEMENT:6},ps=e=>(...t)=>({_$litDirective$:e,values:t}),di=class{constructor(t){}get _$AU(){return this._$AM._$AU}_$AT(t,i,s){this._$Ct=t,this._$AM=i,this._$Ci=s}_$AS(t,i){return this.update(t,i)}update(t,i){return this.render(...i)}};var Js=class extends di{constructor(t){if(super(t),this.it=B,t.type!==At.CHILD)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(t){if(t===B||t==null)return this._t=void 0,this.it=t;if(t===je)return t;if(typeof t!="string")throw Error(this.constructor.directiveName+"() called with a non-string value");if(t===this.it)return this._t;this.it=t;let i=[t];return i.raw=i,this._t={_$litType$:this.constructor.resultType,strings:i,values:[]}}};Js.directiveName="unsafeHTML",Js.resultType=1;var I=ps(Js);var fs=[["circle",{cx:"12",cy:"12",r:"10"}]];var Oi=[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"m9 12 2 2 4-4"}]];var Ii=[["circle",{cx:"12",cy:"12",r:"10"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16"}]];var Mt=[["path",{d:"M12 2v4"}],["path",{d:"m16.2 7.8 2.9-2.9"}],["path",{d:"M18 12h4"}],["path",{d:"m16.2 16.2 2.9 2.9"}],["path",{d:"M12 18v4"}],["path",{d:"m4.9 19.1 2.9-2.9"}],["path",{d:"M2 12h4"}],["path",{d:"m4.9 4.9 2.9 2.9"}]];var Zs=[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{d:"M21 3v5h-5"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{d:"M8 16H3v5"}]];var Hn=[["path",{d:"M12 5v14"}],["path",{d:"m19 12-7 7-7-7"}]];var zi=[["rect",{x:"14",y:"3",width:"5",height:"18",rx:"1"}],["rect",{x:"5",y:"3",width:"5",height:"18",rx:"1"}]];var Fn=[["path",{d:"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"}]];var ms=[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"M12 6v6l4 2"}]];var Wn=[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{d:"M12 9v4"}],["path",{d:"M12 17h.01"}]];var Ni=[["path",{d:"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]];var Vn=[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"}],["path",{d:"M10 12h4"}]];var Un=[["path",{d:"m21 21-4.34-4.34"}],["circle",{cx:"11",cy:"11",r:"8"}]];var qn=[["path",{d:"m12 19-7-7 7-7"}],["path",{d:"M19 12H5"}]];var Kn=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2"}]];var co=[["path",{d:"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"}]];var uo=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{d:"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{cx:"9",cy:"7",r:"4"}]];var jn=[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}]];var Qs=[["path",{d:"M15 6a9 9 0 0 0-9 9V3"}],["circle",{cx:"18",cy:"6",r:"3"}],["circle",{cx:"6",cy:"18",r:"3"}]];var Yn=[["path",{d:"m9 18 6-6-6-6"}]];var _s=[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7"}]];var er=[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{cx:"12",cy:"12",r:"3"}]];var Gn=[["line",{x1:"10",x2:"14",y1:"2",y2:"2"}],["line",{x1:"12",x2:"15",y1:"14",y2:"11"}],["circle",{cx:"12",cy:"14",r:"8"}]];var po=[["path",{d:"M12 20v2"}],["path",{d:"M12 2v2"}],["path",{d:"M17 20v2"}],["path",{d:"M17 2v2"}],["path",{d:"M2 12h2"}],["path",{d:"M2 17h2"}],["path",{d:"M2 7h2"}],["path",{d:"M20 12h2"}],["path",{d:"M20 17h2"}],["path",{d:"M20 7h2"}],["path",{d:"M7 20v2"}],["path",{d:"M7 2v2"}],["rect",{x:"4",y:"4",width:"16",height:"16",rx:"2"}],["rect",{x:"8",y:"8",width:"8",height:"8",rx:"1"}]];var Xn=[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]];var tr=[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{d:"M10 9H8"}],["path",{d:"M16 13H8"}],["path",{d:"M16 17H8"}]];var ir=[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1"}],["path",{d:"M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v4"}],["path",{d:"M21 14H11"}],["path",{d:"m15 10-4 4 4 4"}]];var Jn=[["path",{d:"M13.744 17.736a6 6 0 1 1-7.48-7.48"}],["path",{d:"M15 6h1v4"}],["path",{d:"m6.134 14.768.866-.5 2 3.464"}],["circle",{cx:"16",cy:"8",r:"6"}]];var Zn=[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0"}],["path",{d:"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}]];var sr=[["path",{d:"M5 12h14"}],["path",{d:"M12 5v14"}]];var Qn=[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{d:"M3 3v5h5"}]];var ea=[["path",{d:"M3 5h.01"}],["path",{d:"M3 12h.01"}],["path",{d:"M3 19h.01"}],["path",{d:"M8 5h13"}],["path",{d:"M8 12h13"}],["path",{d:"M8 19h13"}]];var ta=[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4"}]];var ia=[["ellipse",{cx:"12",cy:"5",rx:"9",ry:"3"}],["path",{d:"M3 5V19A9 3 0 0 0 21 19V5"}],["path",{d:"M3 12A9 3 0 0 0 21 12"}]];function Yf(e){return e.map(([t,i])=>{let s=Object.entries(i).map(([r,o])=>`${r}="${o}"`).join(" ");return`<${t} ${s}/>`}).join("")}function N(e,t=16,i=""){let s=i?` class="${i}"`:"";return`<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${s}>${Yf(e)}</svg>`}function Kh(e,t,i,{onNavigate:s}){let{runs:r,preferences:o}=e,n=Object.values(r),a=n.filter(m=>m.active).length,h=n.filter(m=>!m.active).length,c=(e.beads?.issues||[]).filter(m=>m.status==="ready"&&(m.blocked_by?.length??0)===0).length,d=e.beads?.dbExists??!1,p=i==="open"?"connected":i==="reconnecting"?"reconnecting":"disconnected",f=i==="open"?"Connected":i==="reconnecting"?"Reconnecting\u2026":"Disconnected";return g`
    <aside class="sidebar ${o.sidebarCollapsed?"collapsed":""}">
      <div class="sidebar-logo" @click=${()=>s("dashboard")} style="cursor:pointer">
        <span class="logo-text">WORCA</span>
      </div>

      <div class="sidebar-new-run">
        <button class="sidebar-new-run-btn" @click=${()=>s("new-run")}>
          ${I(N(sr,16))}
          <span>New Pipeline</span>
        </button>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Pipeline</div>
        <div class="sidebar-item ${t.section==="active"?"active":""}"
             @click=${()=>s("active")}>
          <span class="sidebar-item-left">
            ${I(N(Ni,16))}
            <span>Running</span>
          </span>
          ${a>0?g`<sl-badge variant="primary" pill>${a}</sl-badge>`:""}
        </div>
        <div class="sidebar-item ${t.section==="history"?"active":""}"
             @click=${()=>s("history")}>
          <span class="sidebar-item-left">
            ${I(N(Vn,16))}
            <span>History</span>
          </span>
          ${h>0?g`<sl-badge variant="neutral" pill>${h}</sl-badge>`:""}
        </div>
      </div>

      ${d?g`
        <div class="sidebar-section">
          <div class="sidebar-section-header">Work</div>
          <div class="sidebar-item ${t.section==="beads"?"active":""}"
               @click=${()=>s("beads")}>
            <span class="sidebar-item-left">
              ${I(N(ea,16))}
              <span>Beads</span>
            </span>
            ${c>0?g`<sl-badge variant="success" pill>${c}</sl-badge>`:""}
          </div>
        </div>
      `:""}

      <div class="sidebar-footer">
        <div class="connection-indicator ${p}">
          <span class="conn-dot"></span>
          <span class="conn-label">${f}</span>
        </div>
        <button
          class="theme-toggle-btn ${t.section==="settings"?"active":""}"
          aria-label="Settings"
          @click=${()=>s("settings")}
        >${I(N(er,18))}</button>
      </div>
    </aside>
  `}var Gf={pending:"status-pending",in_progress:"status-in-progress",completed:"status-completed",error:"status-error",interrupted:"status-interrupted"},Xf={pending:fs,in_progress:Mt,completed:Oi,error:Ii,interrupted:zi};function gs(e,t){return e==="in_progress"&&t===!1?"interrupted":e}function fo(e){return Gf[e]||"status-unknown"}function Bt(e,t=14){let i=Xf[e];return i?N(i,t,e==="in_progress"?"icon-spin":""):"?"}var Jf={pending:fs,in_progress:Mt,completed:Oi,error:Ii,interrupted:zi};function Zf(e,t){return t&&t[e]?.label?t[e].label:e.replace(/_/g," ").toUpperCase()}function jh(e,t={},i=!0){if(!e||typeof e!="object")return g``;let s=Object.entries(e);return s.length===0?g`<div class="empty-state">No stages</div>`:g`
    <div class="stage-timeline">
      ${s.map(([r,o],n)=>{let a=gs(o.status||"pending",i),h=Jf[a]||fs,l=Zf(r,t),c=a==="in_progress",d=o.iteration,p=a==="in_progress"?"icon-spin":"";return g`
          ${n>0?g`<div class="stage-connector ${s[n-1]?.[1]?.status==="completed"?"completed":""}"></div>`:""}
          <div class="stage-node ${fo(a)} ${c?"pulse":""}">
            <div class="stage-icon">${I(N(h,22,p))}</div>
            <div class="stage-label">${l}</div>
            ${d>1?g`<span class="loop-indicator">${I(N(Zs,10))}${d}</span>`:""}
          </div>
        `})}
    </div>
  `}function Gt(e){let t=Math.floor(e/1e3),i=Math.floor(t/3600),s=Math.floor(t%3600/60),r=t%60;return i>0?`${i}h ${s}m ${r}s`:s>0?`${s}m ${r}s`:`${r}s`}function ui(e,t){let i=new Date(e).getTime();return(t?new Date(t).getTime():Date.now())-i}function Hi(e){if(!e)return"N/A";let t=new Date(e),i=s=>String(s).padStart(2,"0");return`${t.getFullYear()}.${i(t.getMonth()+1)}.${i(t.getDate())} ${i(t.getHours())}:${i(t.getMinutes())}`}function sa(e){return e===0||e===1?"danger":e===2?"warning":"neutral"}function ra(e){return e==="open"?"success":"neutral"}function Qf(e){return e.blocked_by&&e.blocked_by.length>0?"blocked":e.status}function em(e){let t=new Set(e.map(r=>r.id)),i=new Map(e.map(r=>[r.id,0])),s=!0;for(;s;){s=!1;for(let r of e)for(let o of r.depends_on){if(!t.has(o))continue;let n=(i.get(o)??0)+1;n>i.get(r.id)&&(i.set(r.id,n),s=!0)}}return i}function oa(e){if(!e||e.length===0)return"";let t=140,i=40,s=60,r=24,o=16,n=em(e),a=Math.max(...n.values(),0),h=new Map;for(let C of e){let k=n.get(C.id)??0;h.has(k)||h.set(k,[]),h.get(k).push(C)}let l=Math.max(...[...h.values()].map(C=>C.length),1),c=Math.round(o*2+(a+1)*(t+s)),d=Math.round(o*2+l*(i+r)),p=new Map;for(let[C,k]of h)for(let R=0;R<k.length;R++)p.set(k[R].id,{x:Math.round(o+C*(t+s)),y:Math.round(o+R*(i+r))});let f=new Map(e.map(C=>[C.id,C])),m="";for(let C of e){let k=p.get(C.id);if(k)for(let R of C.depends_on){let T=p.get(R);if(!T)continue;let y=T.x+t,L=T.y+i/2,D=k.x,O=k.y+i/2,te=Math.round((y+D)/2),re=C.blocked_by&&C.blocked_by.includes(R);m+=`<path class="${re?"beads-graph-edge beads-graph-edge--blocked":"beads-graph-edge"}" d="M${y},${L} C${te},${L} ${te},${O} ${D},${O}" marker-end="${re?"url(#beads-arrow-blocked)":"url(#beads-arrow)"}"/>`}}let _="";for(let C of e){let k=p.get(C.id);if(!k)continue;let R=Qf(C),T=C.title||"",y=T.length>18?T.slice(0,18)+"...":T;_+=`<g class="beads-graph-node beads-graph-node--${R}" transform="translate(${k.x},${k.y})">
      <rect width="${t}" height="${i}" rx="6"/>
      <text x="8" y="14" class="beads-graph-node-id">#${C.id}</text>
      <text x="8" y="28">${tm(y)}</text>
    </g>`}return`<svg xmlns="http://www.w3.org/2000/svg" width="${c}" height="${d}" viewBox="0 0 ${c} ${d}">
    <defs>
      <marker id="beads-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border)"/>
      </marker>
      <marker id="beads-arrow-blocked" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--status-error)"/>
      </marker>
    </defs>
    ${m}
    ${_}
  </svg>`}function tm(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function im(e,{starting:t,onStartIssue:i}){let s=e.blocked_by&&e.blocked_by.length>0,r=e.status==="open"&&!s&&t===null,o=t===e.id;return g`
    <div class="beads-issue-row">
      <sl-badge variant="${sa(e.priority)}" pill>P${e.priority}</sl-badge>
      <sl-badge variant="${ra(e.status)}">${e.status}</sl-badge>
      <div class="beads-issue-body">
        <div class="beads-issue-title">${e.title}</div>
        ${e.body?g`<div class="beads-issue-excerpt">${(e.body||"").slice(0,120)}</div>`:""}
        ${e.depends_on&&e.depends_on.length>0?g`
          <div class="beads-issue-deps">
            ${e.depends_on.map(n=>g`
              <span class="beads-dep-chip ${e.blocked_by&&e.blocked_by.includes(n)?"beads-dep-chip--blocked":""}">
                ${e.blocked_by&&e.blocked_by.includes(n)?I(N(ta,10)):""}
                #${n}
              </span>
            `)}
          </div>
        `:""}
      </div>
      <div class="beads-issue-actions">
        <sl-button variant="primary" size="small"
          ?disabled=${!r}
          @click=${()=>r&&i(e.id)}>
          ${o?I(N(Mt,14,"icon-spin")):""}
          ${o?"Starting...":"Start Pipeline"}
        </sl-button>
      </div>
    </div>
  `}function Yh(e,{statusFilter:t,priorityFilter:i,starting:s,startError:r,onStatusFilter:o,onPriorityFilter:n,onStartIssue:a,onDismissError:h}){if(e.dbExists===!1)return g`<div class="empty-state">No Beads database found. Initialize Beads with <code>bd init</code> in your project.</div>`;if(e.loading)return g`<div class="empty-state">Loading Beads issues...</div>`;let l=e.issues??[];return t!=="all"&&(l=l.filter(c=>c.status===t)),i!=="all"&&(l=l.filter(c=>String(c.priority)===i)),e.issues.length===0?g`<div class="empty-state">No open Beads issues found.</div>`:l.length===0?g`
      <div class="beads-panel">
        <div class="beads-filters">
          <sl-select value=${t} @sl-change=${c=>o(c.target.value)}>
            <sl-option value="all">All statuses</sl-option>
            <sl-option value="open">Open</sl-option>
          </sl-select>
          <sl-select value=${i} @sl-change=${c=>n(c.target.value)}>
            <sl-option value="all">All priorities</sl-option>
            <sl-option value="0">P0 - Critical</sl-option>
            <sl-option value="1">P1 - High</sl-option>
            <sl-option value="2">P2 - Medium</sl-option>
            <sl-option value="3">P3 - Low</sl-option>
            <sl-option value="4">P4 - Backlog</sl-option>
          </sl-select>
          <span class="beads-filter-count">0 issues</span>
        </div>
        <div class="empty-state">No issues match the current filters.</div>
      </div>
    `:g`
    <div class="beads-panel">
      <div class="beads-filters">
        <sl-select value=${t} @sl-change=${c=>o(c.target.value)}>
          <sl-option value="all">All statuses</sl-option>
          <sl-option value="ready">Ready</sl-option>
          <sl-option value="backlog">Backlog</sl-option>
          <sl-option value="in_progress">In Progress</sl-option>
        </sl-select>
        <sl-select value=${i} @sl-change=${c=>n(c.target.value)}>
          <sl-option value="all">All priorities</sl-option>
          <sl-option value="high">High</sl-option>
          <sl-option value="medium">Medium</sl-option>
          <sl-option value="low">Low</sl-option>
        </sl-select>
        <span class="beads-filter-count">${l.length} issue${l.length!==1?"s":""}</span>
      </div>

      <div class="beads-issue-list">
        ${l.map(c=>im(c,{starting:s,onStartIssue:a}))}
      </div>

      ${l.length>1?g`
        <div class="beads-graph-section">
          <div class="beads-graph-section-title">Dependencies</div>
          <div class="beads-graph-container">
            ${I(oa(l))}
          </div>
        </div>
      `:""}

      ${r?g`
        <sl-dialog label="Could Not Start Pipeline" open @sl-after-hide=${h}>
          <p>${r}</p>
          <sl-button slot="footer" variant="primary" @click=${()=>document.querySelector('sl-dialog[label="Could Not Start Pipeline"]')?.hide()}>
            OK
          </sl-button>
        </sl-dialog>
      `:""}
    </div>
  `}function Gh(e,t,i){return!i||i.length===0?null:e?.get(t)??i[i.length-1].number}function sm(e){if(!e)return null;let t=null;for(let i of Object.values(e))i.completed_at&&(!t||i.completed_at>t)&&(t=i.completed_at);return t}function rm(e){return e==="completed"?"success":e==="error"?"danger":e==="in_progress"||e==="interrupted"?"warning":"neutral"}function om(e){let t=e.status||"pending";return t==="completed"&&e.outcome==="success"?g`<span class="iter-status-icon success">${I(Bt("completed",12))}</span>`:t==="completed"?g`<span class="iter-status-icon">${I(Bt("completed",12))}</span>`:t==="error"?g`<span class="iter-status-icon failure">${I(Bt("error",12))}</span>`:t==="in_progress"?g`<span class="iter-status-icon in-progress">${I(Bt("in_progress",12))}</span>`:B}function Xh(e){return e?g`<span class="iteration-trigger">${{initial:"Initial run",test_failure:"Test failure",review_changes:"Review changes",restart_planning:"Restart planning"}[e]||e}</span>`:B}function Jh(e){return e?g`<span class="iteration-outcome ${e==="success"?"success":"failure"}">${e.replace(/_/g," ")}</span>`:B}function Zh(e){return e.reduce((t,i)=>t+(i.cost_usd||0),0)}function nm(e,t,i,s,r){let o=t.iterations||[],n=Qh(t);return{stage:e,status:t.status,agent:i||void 0,model:s||void 0,cost_usd:Zh(o),duration:n>0?Gt(n):void 0,duration_ms:n>0?n:void 0,started_at:t.started_at||void 0,completed_at:t.completed_at||void 0,error:t.error||void 0,iterations:o.map(a=>({number:a.number,status:a.status,outcome:a.outcome||void 0,trigger:a.trigger||void 0,agent:a.agent||void 0,model:a.model||void 0,turns:a.turns||void 0,cost_usd:a.cost_usd||void 0,duration_ms:a.duration_ms||void 0,started_at:a.started_at||void 0,completed_at:a.completed_at||void 0})),prompts:r?{agent_instructions:r.agentInstructions||void 0,user_prompt:r.userPrompt||void 0}:void 0}}function Qh(e){let t=e.iterations||[];if(t.length===0)return e.started_at?ui(e.started_at,e.completed_at||null):0;let i=0;for(let s of t)s.started_at&&(i+=ui(s.started_at,s.completed_at||null));return i}function na(e,t,i=B){let s=e?Gt(ui(e,t||null)):"";return g`
    <div class="timing-strip">
      ${e?g`<span class="timing-strip-item"><span class="meta-label">Started:</span> <span class="meta-value">${Hi(e)}</span></span>`:B}
      ${t?g`<span class="timing-strip-item"><span class="meta-label">Finished:</span> <span class="meta-value">${Hi(t)}</span></span>`:B}
      ${s?g`<span class="timing-strip-item"><span class="meta-label">Duration:</span> <span class="meta-value">${s}</span></span>`:B}
      ${i}
    </div>
  `}function am(e,t,i,s){let r=e.agent||i||t,o=e.model||"",n=e.number??0,l=(s?.iterationPrompts||[]).find(p=>p.iteration===n)?.prompt||s?.userPrompt||null,c=l?{agentInstructions:s?.agentInstructions,userPrompt:l}:s,d=e.started_at?Gt(ui(e.started_at,e.completed_at||null)):"";return g`
    <div class="iteration-detail">
      ${na(e.started_at,e.completed_at)}
      <div class="stage-info-strip">
        ${r?g`<span class="stage-info-item"><span class="stage-meta-icon">${I(N(po,12))}</span> ${r}${o?g` <span class="text-muted">(${o})</span>`:""}</span>`:B}
        ${e.turns?g`<span class="stage-info-item"><span class="meta-label">Turns:</span> <span class="meta-value">${e.turns}</span></span>`:B}
        ${e.cost_usd!=null?g`<span class="stage-info-item"><span class="meta-label">Iteration Cost:</span> <span class="meta-value">$${Number(e.cost_usd).toFixed(2)}</span></span>`:B}
        ${d?g`<span class="stage-info-item"><span class="meta-label">Iteration Duration:</span> <span class="meta-value">${d}</span></span>`:B}
      </div>
      ${e.trigger?g`<div class="detail-row">${Xh(e.trigger)}</div>`:B}
      ${e.outcome?g`<div class="detail-row">${Jh(e.outcome)}</div>`:B}
      ${ec(t,c)}
    </div>
  `}function aa(e,t){navigator.clipboard.writeText(e).then(()=>{t.textContent="Copied!",setTimeout(()=>{t.textContent="Copy"},1500)})}function ec(e,t){if(!t)return B;let{agentInstructions:i,userPrompt:s}=t;return!i&&!s?B:g`
    <sl-details class="agent-prompt-section">
      <div slot="summary" class="agent-prompt-header">
        <span class="stage-meta-icon">${I(N(tr,12))}</span>
        Agent Instructions
      </div>
      ${s?g`
        <div class="agent-prompt-block">
          <div class="agent-prompt-label-row">
            <span class="agent-prompt-label">User Prompt (-p)</span>
            <button class="copy-btn" @click=${r=>aa(s,r.currentTarget)}>
              ${I(N(ir,11))} Copy
            </button>
          </div>
          <pre class="agent-prompt-content">${s}</pre>
        </div>
      `:B}
      ${i?g`
        <div class="agent-prompt-block">
          <div class="agent-prompt-label-row">
            <span class="agent-prompt-label">System Prompt (agent .md)</span>
            <button class="copy-btn" @click=${r=>aa(i,r.currentTarget)}>
              ${I(N(ir,11))} Copy
            </button>
          </div>
          <pre class="agent-prompt-content">${i}</pre>
        </div>
      `:B}
    </sl-details>
  `}function lm(e){return e?e.length===0?g`
      <div class="run-beads-section">
        <div class="run-beads-header">Linked Beads Issues</div>
        <div class="run-beads-empty">No linked Beads issues</div>
      </div>
    `:g`
    <div class="run-beads-section">
      <div class="run-beads-header">Linked Beads Issues <span class="run-beads-count">${e.length}</span></div>
      <div class="run-beads-list">
        ${e.map(t=>g`
          <div class="run-bead-row">
            <sl-badge variant="${ra(t.status)}" pill>${t.status}</sl-badge>
            <sl-badge variant="${sa(t.priority)}" pill>P${t.priority}</sl-badge>
            <span class="run-bead-id">#${t.id}</span>
            <span class="run-bead-title">${t.title}</span>
          </div>
        `)}
      </div>
      ${e.length>1?g`
        <div class="run-beads-graph">
          ${I(oa(e))}
        </div>
      `:""}
    </div>
  `:B}function tc(e,t={},i={}){if(!e)return g`<div class="empty-state">Select a run to view details</div>`;let s=e.branch||e.work_request?.branch||"",r=e.pr_url||null,o=e.completed_at||(e.active?null:sm(e.stages)),n=e.stages||{},a=t.stageUi||{},h=t.agents||{};return g`
    <div class="run-detail">
      ${jh(n,a,e.active)}

      <div class="run-info-section">
        ${s?g`
          <div class="run-branch">
            <span class="stage-meta-icon">${I(N(Qs,14))}</span>
            <span>${s}</span>
            ${r?g`<a class="run-pr-link" href="${r}" target="_blank">View PR</a>`:B}
          </div>
        `:B}
        ${na(e.started_at,o)}
        ${(()=>{let c=Object.values(n).flatMap(d=>d.iterations||[]).reduce((d,p)=>d+(p.cost_usd||0),0);return c>0?g`
            <div class="pipeline-cost-strip">
              <span class="meta-label">Pipeline Cost:</span> <span class="meta-value">$${c.toFixed(2)}</span>
            </div>
          `:B})()}
      </div>

      ${lm(i.beads)}

      <div class="stage-panels">
        ${Object.entries(n).map(([l,c])=>{let d=a[l]?.label||l.replace(/_/g," ").toUpperCase(),p=gs(c.status||"pending",e.active),f=c.agent||h[l]?.agent||l,m=c.model||h[l]?.model||"",_=Qh(c),C=_>0?Gt(_):"",k=c.iterations||[],R=k.length>1,T=Zh(k);return g`
            <sl-details ?open=${p==="in_progress"} class="stage-panel"
              @sl-after-show=${y=>{if(!R)return;let L=y.target.querySelector("sl-tab-group");if(!L)return;let D=Gh(i.stageIterationTab,l,k),O=`iter-${l}-${D}`;requestAnimationFrame(()=>L.show(O))}}>
              <div slot="summary" class="stage-panel-header">
                <span class="stage-panel-icon ${fo(p)}">${I(Bt(p))}</span>
                <span class="stage-panel-label">${d}</span>
                <span class="stage-panel-meta">
                  ${R?g`
                    <span class="stage-meta-item stage-meta-iteration">
                      <span class="stage-meta-icon">${I(N(Zs,11))}</span>
                      <span class="meta-value">${k.length} iterations</span>
                    </span>
                  `:B}
                  ${T>0?g`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${I(N(Jn,11))}</span>
                      <span class="meta-value">$${T.toFixed(2)}</span>
                    </span>
                  `:B}
                  ${c.completed_at?g`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${I(N(ms,11))}</span>
                      <span class="meta-value">${Hi(c.completed_at)}</span>
                    </span>
                  `:B}
                  ${C?g`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${I(N(Gn,11))}</span>
                      <span class="meta-value">${C}</span>
                    </span>
                  `:B}
                </span>
                <sl-badge variant="${rm(p)}" pill>
                  ${p.replace(/_/g," ")}
                </sl-badge>
              </div>
              ${(()=>{let y=p!=="pending"?i.promptCache?.[l]:null,L=g`
                  <button class="stage-copy-btn" title="Copy stage data as JSON" @click=${D=>{let O=nm(l,c,f,m,y);aa(JSON.stringify(O,null,2),D.currentTarget)}}>
                    ${I(N(ir,12))} Copy
                  </button>
                `;if(R){let D=_>0?Gt(_):"";return g`
                    <div class="stage-content-wrapper">
                      ${L}
                      <div class="stage-totals-strip">
                        <span class="stage-totals-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${T.toFixed(2)}</span></span>
                        <span class="stage-totals-item"><span class="meta-label">Duration:</span> <span class="meta-value">${D}</span></span>
                      </div>
                      <sl-tab-group @sl-tab-show=${O=>{let te=O.detail.name,re=parseInt(te.split("-").pop(),10);isNaN(re)||i.onStageTabChange?.(l,re)}}>
                        ${k.map(O=>g`
                          <sl-tab slot="nav" panel="iter-${l}-${O.number}">
                            Iter ${O.number} ${om(O)}
                          </sl-tab>
                        `)}
                        ${k.map(O=>g`
                          <sl-tab-panel name="iter-${l}-${O.number}">
                            ${am(O,l,f,y)}
                          </sl-tab-panel>
                        `)}
                      </sl-tab-group>
                    </div>
                  `}return g`
                  <div class="stage-content-wrapper">
                    ${L}
                    <div class="stage-detail">
                      ${na(c.started_at,c.completed_at)}
                      <div class="stage-info-strip">
                        ${f?g`<span class="stage-info-item"><span class="stage-meta-icon">${I(N(po,12))}</span> ${f}${m?g` <span class="text-muted">(${m})</span>`:""}</span>`:B}
                        ${k.length===1&&k[0].turns?g`<span class="stage-info-item"><span class="meta-label">Turns:</span> <span class="meta-value">${k[0].turns}</span></span>`:B}
                        ${k.length===1&&k[0].cost_usd!=null?g`<span class="stage-info-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${Number(k[0].cost_usd).toFixed(2)}</span></span>`:B}
                      </div>
                      ${k.length===1&&k[0].trigger?g`<div class="detail-row">${Xh(k[0].trigger)}</div>`:B}
                      ${k.length===1&&k[0].outcome?g`<div class="detail-row">${Jh(k[0].outcome)}</div>`:B}
                      ${c.task_progress?g`<div class="detail-row"><span class="detail-label">Progress:</span> ${c.task_progress}</div>`:B}
                      ${c.error?g`<div class="detail-row detail-error"><span class="detail-label">Error:</span> ${c.error}</div>`:B}
                      ${y?ec(l,y):B}
                    </div>
                  </div>
                `})()}
              ${p==="error"&&!e.active&&i.onRestartStage?g`
                <div class="stage-restart-btn">
                  <sl-button variant="warning" size="small" @click=${()=>i.onRestartStage(l)}>
                    ${I(N(Qn,14))}
                    Restart Stage
                  </sl-button>
                </div>
              `:B}
            </sl-details>
          `})}
      </div>
    </div>
  `}var hm={completed:"success",in_progress:"warning",error:"danger",interrupted:"warning",pending:"neutral"};function mo(e,{onClick:t}={}){let i=e.work_request?.title||"Untitled",s=e.active,r=s?"in_progress":e.stage==="error"?"error":"completed",o=e.started_at&&e.completed_at?Gt(ui(e.started_at,e.completed_at)):e.started_at&&s?Gt(ui(e.started_at,null)):"N/A",n=e.branch||e.work_request?.branch||"",a=e.stages?Object.entries(e.stages):[];return g`
    <div class="run-card" @click=${t?()=>t(e.id):null}>
      <div class="run-card-top">
        <span class="run-card-status">${I(Bt(r,16))}</span>
        <span class="run-card-title">${i}</span>
      </div>
      ${n?g`<div class="run-card-meta"><span class="run-card-meta-item"><span class="meta-label">Branch:</span> ${n}</span></div>`:B}
      <div class="run-card-meta">
        <span class="run-card-meta-item"><span class="meta-label">Started:</span> ${Hi(e.started_at)}</span>
        <span class="run-card-meta-item"><span class="meta-label">Finished:</span> ${Hi(e.completed_at)}</span>
        <span class="run-card-meta-item"><span class="meta-label">Duration:</span> ${o}</span>
      </div>
      ${a.length>0?g`
        <div class="run-card-stages">
          ${a.map(([h,l])=>{let c=gs(l.status||"pending",s),d=hm[c]||"neutral",p=h.replace(/_/g," ").toUpperCase();return g`<sl-badge variant="${d}" pill class="run-card-stage-badge">${p}</sl-badge>`})}
        </div>
      `:B}
    </div>
  `}function la(e,t,{onSelectRun:i}){let s=e.filter(r=>t==="active"?r.active:!r.active);return s.length===0?g`<div class="empty-state">
      ${t==="active"?"No running pipelines":"No completed runs yet"}
    </div>`:g`
    <div class="run-list">
      ${s.map(r=>mo(r,{onClick:i}))}
    </div>
  `}function ic(e,{onSelectRun:t,onNavigate:i}={}){let s=Object.values(e.runs),r=s.filter(h=>h.active),o=s.filter(h=>!h.active),n=s.filter(h=>(h.stages?Object.values(h.stages):[]).some(c=>c.status==="error")),a=s.length;return g`
    <div class="dashboard">
      <div class="dashboard-stats">
        <div class="stat-card stat-total">
          <div class="stat-icon-ring">${I(N(Fn,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${a}</span>
            <span class="stat-label">Total Runs</span>
          </div>
        </div>
        <div class="stat-card stat-active">
          <div class="stat-icon-ring">${I(N(Ni,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${r.length}</span>
            <span class="stat-label">Active</span>
          </div>
        </div>
        <div class="stat-card stat-completed">
          <div class="stat-icon-ring">${I(N(Oi,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${o.length}</span>
            <span class="stat-label">Completed</span>
          </div>
        </div>
        <div class="stat-card stat-errors">
          <div class="stat-icon-ring">${I(N(Ii,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${n.length}</span>
            <span class="stat-label">Errors</span>
          </div>
        </div>
      </div>

      <div class="dashboard-actions">
        <sl-button variant="primary" @click=${()=>i&&i("new-run")}>
          ${I(N(sr,16))}
          New Pipeline
        </sl-button>
      </div>

      <h3 class="dashboard-section-title">Active Runs</h3>
      ${r.length>0?g`
        <div class="run-list">
          ${r.map(h=>mo(h,{onClick:t}))}
        </div>
      `:g`<div class="empty-state">No running pipelines</div>`}
    </div>
  `}var cm={plan:"planner",coordinate:"coordinator",implement:"implementer",test:"tester",review:"guardian",pr:"guardian"},_o=["plan","coordinate","implement","test","review","pr"],or=["planner","coordinator","implementer","tester","guardian"],dm=["opus","sonnet","haiku"],rr={plan:{agent:"planner",enabled:!0},coordinate:{agent:"coordinator",enabled:!0},implement:{agent:"implementer",enabled:!0},test:{agent:"tester",enabled:!0},review:{agent:"guardian",enabled:!0},pr:{agent:"guardian",enabled:!0}},rc=[{key:"block_rm_rf",label:"Block rm -rf",description:"Prevent recursive force-delete commands"},{key:"block_env_write",label:"Block .env writes",description:"Prevent writing to .env files"},{key:"block_force_push",label:"Block force push",description:"Prevent git push --force"},{key:"restrict_git_commit",label:"Restrict git commit",description:"Only guardian agent may commit"}],Fi={guards:{block_rm_rf:!0,block_env_write:!0,block_force_push:!0,restrict_git_commit:!0},test_gate_strikes:2,dispatch:{planner:[],coordinator:["implementer"],implementer:[],tester:[],guardian:[]}},ge=null,$t=null,Wi="";async function ha(){try{let e=await fetch("/api/settings");if(!e.ok)throw new Error(`HTTP ${e.status}`);if(ge=await e.json(),ge.worca||(ge.worca={}),!ge.worca.stages)ge.worca.stages={...rr};else for(let t of _o)ge.worca.stages[t]||(ge.worca.stages[t]={...rr[t]});ge.worca.governance?ge.worca.governance={...Fi,...ge.worca.governance,guards:{...Fi.guards,...ge.worca.governance.guards||{}},dispatch:{...Fi.dispatch,...ge.worca.governance.dispatch||{}}}:ge.worca.governance={...Fi}}catch(e){ge=null,$t="error",Wi="Failed to load settings: "+e.message}}async function ca(e,t){$t="saving",Wi="",t();try{let i=await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(e)});if(!i.ok)throw new Error(`HTTP ${i.status}`);let s=await i.json();ge={worca:s.worca,permissions:s.permissions},$t="success",Wi="Settings saved successfully"}catch(i){$t="error",Wi="Failed to save: "+i.message}t(),$t==="success"&&setTimeout(()=>{$t==="success"&&($t=null,Wi="",t())},3e3)}function um(){let e={};for(let t of or){let i=document.getElementById(`agent-${t}-model`),s=document.getElementById(`agent-${t}-turns`);e[t]={model:i?.value||"sonnet",max_turns:parseInt(s?.value,10)||30}}return e}function pm(){let e={};for(let t of["implement_test","code_review","pr_changes","restart_planning"]){let i=document.getElementById(`loop-${t}`);e[t]=parseInt(i?.value,10)||0}return{loops:e}}function fm(){let e={};for(let t of _o){let i=document.getElementById(`stage-${t}-enabled`),s=document.getElementById(`stage-${t}-agent`);e[t]={agent:s?.value||rr[t].agent,enabled:i?.checked??!0}}return e}function mm(){let e={};for(let r of rc){let o=document.getElementById(`guard-${r.key}`);e[r.key]=o?.checked??!0}let t=document.getElementById("test-gate-strikes"),i=parseInt(t?.value,10)||2,s={};for(let r of or){let n=(document.getElementById(`dispatch-${r}`)?.value||"").trim();s[r]=n?n.split(",").map(a=>a.trim()).filter(Boolean):[]}return{guards:e,test_gate_strikes:i,dispatch:s}}function _m(e,t){let i=e.agents||{};return g`
    <div class="settings-tab-content">
      <div class="settings-cards">
        ${or.map(s=>{let r=i[s]||{};return g`
            <div class="settings-card">
              <div class="settings-card-header">
                <span class="settings-card-icon">${I(N(uo,18))}</span>
                <span class="settings-card-title">${s}</span>
              </div>
              <div class="settings-card-body">
                <div class="settings-field">
                  <label class="settings-label">Model</label>
                  <sl-select id="agent-${s}-model" .value="${r.model||"sonnet"}" size="small">
                    ${dm.map(o=>g`<sl-option value="${o}">${o}</sl-option>`)}
                  </sl-select>
                </div>
                <div class="settings-field">
                  <label class="settings-label">Max Turns</label>
                  <sl-input id="agent-${s}-turns" type="number" value="${r.max_turns||30}" size="small" min="1" max="200"></sl-input>
                </div>
              </div>
            </div>
          `})}
      </div>
      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${()=>{let s=um();ca({worca:{...ge.worca,agents:s},permissions:ge.permissions},t)}}>
          ${I(N(_s,14))}
          Save Agents
        </sl-button>
      </div>
    </div>
  `}function gm(e,t){let i=e.loops||{},s=e.stages||rr;return g`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Stage Configuration</h3>
      <div class="pipeline-flow">
        ${_o.map((r,o)=>{let n=s[r]||rr[r],a=n.enabled!==!1;return g`
            <div class="pipeline-stage-node ${a?"pipeline-stage-node--enabled":"pipeline-stage-node--disabled"}">
              <div class="pipeline-stage-header">
                <span class="pipeline-stage-name ${a?"":"pipeline-stage-name--disabled"}">${r}</span>
                <sl-switch id="stage-${r}-enabled" ?checked=${a} size="small"
                  @sl-change=${h=>{let l=h.target.closest(".pipeline-stage-node");h.target.checked?(l.classList.remove("pipeline-stage-node--disabled"),l.classList.add("pipeline-stage-node--enabled"),l.querySelector(".pipeline-stage-name").classList.remove("pipeline-stage-name--disabled")):(l.classList.remove("pipeline-stage-node--enabled"),l.classList.add("pipeline-stage-node--disabled"),l.querySelector(".pipeline-stage-name").classList.add("pipeline-stage-name--disabled"))}}></sl-switch>
              </div>
              <div class="settings-field pipeline-stage-field">
                <label class="settings-label">Agent</label>
                <sl-select id="stage-${r}-agent" .value="${n.agent||cm[r]}" size="small">
                  ${or.map(h=>g`<sl-option value="${h}">${h}</sl-option>`)}
                </sl-select>
              </div>
            </div>
            ${o<_o.length-1?g`
              <span class="pipeline-arrow">${I(N(Yn,16))}</span>
            `:B}
          `})}
      </div>

      <h3 class="settings-section-title">Loop Limits</h3>
      <div class="settings-grid">
        ${[{key:"implement_test",label:"Implement \u2194 Test"},{key:"code_review",label:"Code Review"},{key:"pr_changes",label:"PR Changes"},{key:"restart_planning",label:"Restart Planning"}].map(r=>g`
          <div class="settings-field">
            <label class="settings-label">${r.label}</label>
            <sl-input id="loop-${r.key}" type="number" value="${i[r.key]||0}" size="small" min="0" max="50"></sl-input>
          </div>
        `)}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${()=>{let{loops:r}=pm(),o=fm();ca({worca:{...ge.worca,loops:r,stages:o},permissions:ge.permissions},t)}}>
          ${I(N(_s,14))}
          Save Pipeline
        </sl-button>
      </div>
    </div>
  `}function vm(e,t,i){let s=e.governance||Fi,r=s.guards||Fi.guards,o=s.dispatch||Fi.dispatch,n=t.allow||[];return g`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Guard Rules</h3>
      <div class="settings-switches">
        ${rc.map(a=>g`
          <div class="settings-switch-row">
            <sl-switch id="guard-${a.key}" ?checked=${r[a.key]!==!1} size="small">
              ${a.label}
            </sl-switch>
            <span class="settings-switch-desc">${a.description}</span>
          </div>
        `)}
      </div>

      <h3 class="settings-section-title">Test Gate</h3>
      <div class="settings-grid">
        <div class="settings-field">
          <label class="settings-label">Strike Threshold</label>
          <sl-input id="test-gate-strikes" type="number" value="${s.test_gate_strikes||2}" size="small" min="1" max="10"></sl-input>
          <span class="settings-field-hint">Consecutive test failures before blocking</span>
        </div>
      </div>

      <h3 class="settings-section-title">Dispatch Rules</h3>
      <div class="settings-dispatch-table">
        ${or.map(a=>g`
          <div class="settings-dispatch-row">
            <span class="settings-dispatch-agent">${a}</span>
            <sl-input id="dispatch-${a}" value="${(o[a]||[]).join(", ")}" size="small" placeholder="none"></sl-input>
          </div>
        `)}
      </div>

      <h3 class="settings-section-title">Permissions</h3>
      <div class="settings-permissions">
        ${n.length>0?n.map(a=>g`<div class="settings-perm-item"><code>${a}</code></div>`):g`<span class="settings-muted">No permissions configured</span>`}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${()=>{let a=mm();ca({worca:{...ge.worca,governance:a},permissions:ge.permissions},i)}}>
          ${I(N(_s,14))}
          Save Governance
        </sl-button>
      </div>
    </div>
  `}function bm(e,t){let i=e?.theme||"light";return g`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Appearance</h3>
      <div class="settings-switches">
        <div class="settings-switch-row">
          <sl-switch ?checked=${i==="dark"} size="small" @sl-change=${t}>Dark Mode</sl-switch>
          <span class="settings-switch-desc">Toggle between light and dark theme</span>
        </div>
      </div>
    </div>
  `}var sc={run_completed:{label:"Run Completed",desc:"When a pipeline run finishes successfully"},run_failed:{label:"Run Failed",desc:"When a pipeline run fails at any stage"},approval_needed:{label:"Approval Required",desc:"When a stage is waiting for plan or PR approval"},test_failures:{label:"Test Failures",desc:"When a test iteration ends with failures"},loop_limit_warning:{label:"Loop Limit Warning",desc:"When a stage approaches its configured loop limit"}};function ym(e,{rerender:t,onSaveNotifications:i}){let s=e?.notifications||{},r=s.enabled??!0,o=s.sound??!1,n=s.events||{},a=typeof Notification<"u"?Notification.permission:"unsupported",h=a==="granted"?g`<sl-badge variant="success" pill>Granted</sl-badge>`:a==="denied"?g`<sl-badge variant="danger" pill>Blocked</sl-badge>`:a==="default"?g`<sl-badge variant="neutral" pill>Not Yet Asked</sl-badge>`:g`<sl-badge variant="neutral" pill>Not Supported</sl-badge>`,l=a!=="granted";return g`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Browser Notifications</h3>
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
        <span style="font-size: 13px; color: var(--muted);">Permission Status:</span>
        ${h}
        ${a==="default"?g`
          <sl-button size="small" variant="primary" @click=${async()=>{typeof Notification<"u"&&(await Notification.requestPermission(),t())}}>Enable Notifications</sl-button>
        `:""}
      </div>

      ${l?g`
        <div style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">
          ${a==="denied"?"Notifications are blocked. Enable in your browser settings to use these controls.":"Grant notification permission to use these controls."}
        </div>
      `:""}

      <div class="settings-switches">
        <div class="settings-switch-row">
          <sl-switch id="notif-enabled" ?checked=${r} size="small" ?disabled=${l}>Notifications Enabled</sl-switch>
          <span class="settings-switch-desc">Master toggle for all browser notifications</span>
        </div>
        <div class="settings-switch-row">
          <sl-switch id="notif-sound" ?checked=${o} size="small" ?disabled=${l}>Sound for Critical Events</sl-switch>
          <span class="settings-switch-desc">Play a short audio cue for failed runs and approval requests</span>
        </div>
      </div>

      <h3 class="settings-section-title">Notification Events</h3>
      <div class="settings-switches">
        ${Object.entries(sc).map(([c,{label:d,desc:p}])=>g`
          <div class="settings-switch-row">
            <sl-switch id="notif-evt-${c}" ?checked=${n[c]??!0} size="small" ?disabled=${l}>${d}</sl-switch>
            <span class="settings-switch-desc">${p}</span>
          </div>
        `)}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" ?disabled=${l} @click=${()=>{let c=document.getElementById("notif-enabled")?.checked??!0,d=document.getElementById("notif-sound")?.checked??!1,p={};for(let f of Object.keys(sc))p[f]=document.getElementById(`notif-evt-${f}`)?.checked??!0;i({enabled:c,sound:d,events:p})}}>
          ${I(N(_s,14))}
          Save Notifications
        </sl-button>
      </div>
    </div>
  `}function wm(e){return!$t||$t==="saving"?B:g`
    <div class="settings-toast">
      <sl-alert variant="${$t==="success"?"success":"danger"}" open closable duration="3000"
        @sl-after-hide=${()=>{$t=null,Wi="",e()}}>
        ${Wi}
      </sl-alert>
    </div>
  `}function oc(e,{rerender:t,onThemeToggle:i,onSaveNotifications:s}){if(!ge)return g`<div class="empty-state">Loading settings\u2026</div>`;let r=ge.worca||{},o=ge.permissions||{};return g`
    ${wm(t)}
    <div class="settings-page">
      <sl-tab-group>
        <sl-tab slot="nav" panel="agents">
          ${I(N(uo,14))}
          Agents
        </sl-tab>
        <sl-tab slot="nav" panel="pipeline">
          ${I(N(Qs,14))}
          Pipeline
        </sl-tab>
        <sl-tab slot="nav" panel="governance">
          ${I(N(jn,14))}
          Governance
        </sl-tab>
        <sl-tab slot="nav" panel="preferences">
          ${I(N(er,14))}
          Preferences
        </sl-tab>
        <sl-tab slot="nav" panel="notifications">
          ${I(N(Zn,14))}
          Notifications
        </sl-tab>

        <sl-tab-panel name="agents">${_m(r,t)}</sl-tab-panel>
        <sl-tab-panel name="pipeline">${gm(r,t)}</sl-tab-panel>
        <sl-tab-panel name="governance">${vm(r,o,t)}</sl-tab-panel>
        <sl-tab-panel name="preferences">${bm(e,i)}</sl-tab-panel>
        <sl-tab-panel name="notifications">${ym(e,{rerender:t,onSaveNotifications:s})}</sl-tab-panel>
      </sl-tab-group>
    </div>
  `}var vs="prompt",pi=null,ar="",Vi=null,bs="",nr=!1,lr="";function Sm(e){return e==="source"?"GitHub Issue URL":e==="spec"?"Spec File Path":"Prompt"}function Cm(){return Vi?Promise.resolve(Vi):fetch("/api/plan-files").then(e=>e.json()).then(e=>(e.ok&&(Vi=e.files),Vi||[])).catch(()=>[])}function xm(){if(!Vi)return[];if(!bs)return Vi;let e=bs.toLowerCase();return Vi.filter(t=>t.name.toLowerCase().includes(e)||t.path.toLowerCase().includes(e))}function km(e){let t={};for(let i of e)t[i.dir]||(t[i.dir]=[]),t[i.dir].push(i);return t}function nc(){return{submitStatus:pi,isSubmitting:pi==="submitting"}}async function ac({rerender:e,onStarted:t}){let i=document.getElementById("new-run-input-value"),s=document.getElementById("new-run-msize"),r=document.getElementById("new-run-mloops"),o=i?.value?.trim()||"";if(!o){pi="error",ar="Please enter a value.",e();return}let n=s&&parseInt(s.value,10)||1,a=r&&parseInt(r.value,10)||1;pi="submitting",ar="",e();try{let h={inputType:vs,inputValue:o,msize:Math.max(1,Math.min(10,n)),mloops:Math.max(1,Math.min(10,a))};lr&&(h.planFile=lr);let c=await(await fetch("/api/runs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(h)})).json();c.ok?(pi=null,t()):(pi="error",ar=c.error||"Failed to start pipeline",e())}catch(h){pi="error",ar=h.message||"Network error",e()}}function lc(e,{rerender:t}){function i(c){vs=c.target.value,t()}function s(){Cm().then(()=>{nr=!0,t()})}function r(c){bs=c.target.value,lr="",nr=!0,t()}function o(){setTimeout(()=>{nr=!1,t()},200)}function n(c){lr=c.path,bs=c.path,nr=!1,t()}function a(){lr="",bs="",t()}let h=xm(),l=km(h);return g`
    <div class="new-run-page">
      ${pi==="error"?g`<div class="new-run-error">${ar}</div>`:B}

      <div class="new-run-form">
        <div class="new-run-section">
          <div class="settings-field">
            <label class="settings-label">Input Type</label>
            <sl-select id="new-run-input-type" value=${vs} @sl-change=${i}>
              <sl-option value="prompt">Prompt</sl-option>
              <sl-option value="source">GitHub Issue</sl-option>
              <sl-option value="spec">Spec File</sl-option>
            </sl-select>
          </div>

          <div class="settings-field">
            <label class="settings-label">${Sm(vs)}</label>
            ${vs==="prompt"?g`<sl-textarea id="new-run-input-value" rows="8" placeholder="Describe what the pipeline should do..."></sl-textarea>`:g`<sl-input id="new-run-input-value" placeholder=${vs==="source"?"https://github.com/...":"path/to/spec.md"}></sl-input>`}
          </div>
        </div>

        <div class="new-run-section">
          <h3 class="new-run-section-title">Advanced Options</h3>
          <div class="new-run-advanced">
            <div class="new-run-grid">
              <div class="settings-field">
                <label class="settings-label">Size Multiplier (msize)</label>
                <sl-input id="new-run-msize" type="number" min="1" max="10" value="1"></sl-input>
                <span class="settings-field-hint">Scales max_turns per stage (1-10)</span>
              </div>

              <div class="settings-field">
                <label class="settings-label">Loop Multiplier (mloops)</label>
                <sl-input id="new-run-mloops" type="number" min="1" max="10" value="1"></sl-input>
                <span class="settings-field-hint">Scales max loop iterations (1-10)</span>
              </div>
            </div>

            <div class="settings-field">
              <label class="settings-label">Plan File (optional)</label>
              <div class="plan-autocomplete">
                <sl-input
                  id="new-run-plan"
                  placeholder="Type to search plan files..."
                  .value=${bs}
                  @sl-input=${r}
                  @sl-focus=${s}
                  @sl-blur=${o}
                  clearable
                  @sl-clear=${a}
                >
                  <span slot="prefix">${I(N(tr,14))}</span>
                </sl-input>
                ${nr&&h.length>0?g`
                  <div class="plan-dropdown">
                    ${Object.entries(l).map(([c,d])=>g`
                      <div class="plan-group-header">${c}/</div>
                      ${d.map(p=>g`
                        <div class="plan-item" @mousedown=${()=>n(p)}>
                          ${p.name}
                        </div>
                      `)}
                    `)}
                  </div>
                `:B}
              </div>
              <span class="settings-field-hint">Skips the planning stage. Relative to project root.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `}var Iu=["\x1B[36m","\x1B[33m","\x1B[35m","\x1B[32m","\x1B[34m","\x1B[91m","\x1B[96m","\x1B[93m"],Nl="\x1B[0m",zu="\x1B[2m",tn=new Map,Hl=0;function l0(e){return tn.has(e)||(tn.set(e,Iu[Hl%Iu.length]),Hl++),tn.get(e)}var et=null,Si=null,$s=null,Fl=null,Ci=null,Zi=null;async function h0(e){if(et&&e.querySelector(".xterm")){Si.fit();return}if(Zi){await Zi;return}Zi=(async()=>{let[{Terminal:t},{FitAddon:i},{SearchAddon:s}]=await Promise.all([Promise.resolve().then(()=>(Sl(),wl)),Promise.resolve().then(()=>(xl(),Cl)),Promise.resolve().then(()=>(Ou(),Pu))]);et=new t({theme:{background:"#0f172a",foreground:"#e2e8f0",cursor:"#60a5fa",selectionBackground:"rgba(96, 165, 250, 0.3)"},fontFamily:"'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",fontSize:13,lineHeight:1.4,scrollback:5e4,convertEol:!0,cursorBlink:!1,disableStdin:!0}),Si=new i,$s=new s,et.loadAddon(Si),et.loadAddon($s),et.open(e),Si.fit(),Ci=new ResizeObserver(()=>{Si&&Si.fit()}),Ci.observe(e)})(),await Zi,Zi=null}function Wl(e){if(!et)return;let t=e.timestamp?`${zu}${e.timestamp}${Nl} `:"",i=e.stage?`${l0(e.stage)}[${e.stage.toUpperCase()}]${Nl} `:"",s=e.line||e;et.writeln(`${t}${i}${s}`)}function Ts(){Ci&&Ci.disconnect(),et&&et.dispose(),et=null,Si=null,$s=null,Ci=null,Zi=null,tn.clear(),Hl=0}function Nu(){Ci&&Ci.disconnect(),et&&et.dispose(),et=null,Si=null,$s=null,Ci=null,Zi=null,Fl=null}function Hu(e){$s&&e&&$s.findNext(e,{incremental:!0})}async function Fu(e){let t=document.getElementById("log-terminal");t&&(e!==Fl&&(Ts(),Fl=e),await h0(t))}function Wu(e){et&&et.writeln(`
${zu}${"\u2500".repeat(40)} Iteration ${e} ${"\u2500".repeat(40)}${Nl}
`)}function Vu(e,{onStageFilter:t,onIterationFilter:i,onSearch:s,onToggleAutoScroll:r,autoScroll:o,stageIterations:n,runStages:a}){let h=a?["orchestrator",...Object.keys(a)]:null,l=[...new Set(["orchestrator",...e.logLines.map(_=>_.stage).filter(Boolean)])],c=h||l,d=e.currentLogStage,p=n?.[d]||0,f=d&&d!=="*"&&p>0,m=d&&d!=="*";return g`
    <div class="log-history-container">
      <sl-details class="log-history-panel">
        <div slot="summary" class="log-history-header">
          <span class="log-history-icon">${I(N(ms,16))}</span>
          <span class="log-history-title">Log History</span>
        </div>
        <div class="log-history-body">
          <div class="log-controls">
            <sl-select
              .value=${d||""}
              placeholder="Select a stage\u2026"
              size="small"
              clearable
              @sl-change=${_=>t(_.target.value||"*")}
            >
              ${c.map(_=>g`<sl-option value="${_}">${_==="orchestrator"?g`<span style="display:inline-flex;align-items:center;gap:4px">${I(N(Xn,12))} ORCHESTRATOR</span>`:_.toUpperCase()}</sl-option>`)}
            </sl-select>
            ${f?g`
              <sl-select
                .value=${String(e.currentLogIteration||p)}
                size="small"
                @sl-change=${_=>i(_.target.value?parseInt(_.target.value):null)}
              >
                ${Array.from({length:p},(_,C)=>g`<sl-option value="${C+1}">Iteration ${C+1}</sl-option>`)}
              </sl-select>
            `:B}
            <sl-input
              class="log-search"
              type="text"
              placeholder="Search logs\u2026"
              size="small"
              clearable
              @sl-input=${_=>s(_.target.value)}
            >
              <span slot="prefix">${I(N(Un,14))}</span>
            </sl-input>
            <sl-button
              size="small"
              variant="${o?"primary":"default"}"
              @click=${r}
            >
              ${I(N(o?Hn:zi,14))}
              ${o?"Auto":"Paused"}
            </sl-button>
          </div>
          ${m?g`
            <div class="log-terminal-wrapper">
              <div id="log-terminal" class="log-terminal"></div>
            </div>
          `:g`
            <div class="log-history-empty">
              <span class="log-history-empty-icon">${I(N(ms,32))}</span>
              <p>Select a stage from the dropdown to review past output.</p>
            </div>
          `}
        </div>
      </sl-details>
    </div>
  `}var Uu=["\x1B[36m","\x1B[33m","\x1B[35m","\x1B[32m","\x1B[34m","\x1B[91m","\x1B[96m","\x1B[93m"],sn="\x1B[0m",ql="\x1B[2m",Vl=new Map,qu=0;function c0(e){return Vl.has(e)||(Vl.set(e,Uu[qu%Uu.length]),qu++),Vl.get(e)}var Ge=null,Qi=null,Br=null,Ul=null,Ls=null,xi=null;async function d0(e){if(Ge&&e.querySelector(".xterm")){Qi.fit();return}if(Ls){await Ls;return}Ls=(async()=>{let[{Terminal:t},{FitAddon:i}]=await Promise.all([Promise.resolve().then(()=>(Sl(),wl)),Promise.resolve().then(()=>(xl(),Cl))]);Ge=new t({theme:{background:"#0f172a",foreground:"#e2e8f0",cursor:"#60a5fa",selectionBackground:"rgba(96, 165, 250, 0.3)"},fontFamily:"'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",fontSize:13,lineHeight:1.4,scrollback:1e4,convertEol:!0,cursorBlink:!1,disableStdin:!0}),Qi=new i,Ge.loadAddon(Qi),Ge.open(e),Qi.fit(),Br=new ResizeObserver(()=>{Qi&&Qi.fit()}),Br.observe(e)})(),await Ls,Ls=null}function Kl(e){if(!Ge||!xi||e.stage!==xi)return;let t=e.timestamp?`${ql}${e.timestamp}${sn} `:"",i=e.stage?`${c0(e.stage)}[${e.stage.toUpperCase()}]${sn} `:"",s=e.line||e;Ge.writeln(`${t}${i}${s}`)}function Ku(e){Ge&&Ge.writeln(`
${ql}${"\u2500".repeat(40)} Iteration ${e} ${"\u2500".repeat(40)}${sn}
`)}function jl(){Ge&&Ge.clear()}function ju(){Br&&Br.disconnect(),Ge&&Ge.dispose(),Ge=null,Qi=null,Br=null,Ls=null,Ul=null,xi=null}function u0(e){if(!e)return null;for(let[s,r]of Object.entries(e))if(r.status==="in_progress")return s;let t=null,i=null;for(let[s,r]of Object.entries(e))r.started_at&&(!i||r.started_at>i)&&(i=r.started_at,t=s);return t}function rn(e){let t=e?.stages,i=u0(t);if(i!==xi){let s=xi;return xi=i,Ge&&s!==null&&(Ge.clear(),i&&Ge.writeln(`${ql}--- Switched to stage: ${i.toUpperCase()} ---${sn}
`)),{changed:!0,activeStage:i}}return{changed:!1,activeStage:xi}}function Yl(){return xi}async function Yu(e){let t=document.getElementById("live-output-terminal");t&&(e!==Ul&&(jl(),Ul=e),await d0(t))}function Gu(e,t){if(!t)return B;let i=e?e.replace(/_/g," ").toUpperCase():"WAITING";return g`
    <div class="live-output-container">
      <sl-details open class="live-output-panel">
        <div slot="summary" class="live-output-header">
          <span class="live-output-icon">${I(N(Ni,16))}</span>
          <span class="live-output-title">Live Output</span>
          ${e?g`<sl-badge variant="warning" pill>${i}</sl-badge>`:B}
        </div>
        <div class="live-output-terminal-wrapper">
          <div id="live-output-terminal" class="live-output-terminal"></div>
        </div>
      </sl-details>
    </div>
  `}var Ds={run_completed:{severity:"info",title:"Pipeline Complete",requireInteraction:!1},run_failed:{severity:"critical",title:"Pipeline Failed",requireInteraction:!1},approval_needed:{severity:"critical",title:"Approval Required",requireInteraction:!0},test_failures:{severity:"warning",title:"Tests Failed",requireInteraction:!1},loop_limit_warning:{severity:"warning",title:"Loop Limit Warning",requireInteraction:!1}};function p0(e,t,i){if(!i||!t)return null;let s=i.active===!0,r=t.active===!1;if(!s||!r)return null;let o=t.stages||{};if(Object.values(o).some(h=>h.status==="error"))return null;let a=Pr(t);return{event:"run_completed",title:Ds.run_completed.title,body:`"${a}" finished successfully`,tag:`worca-complete-${e}`,requireInteraction:!1,runId:e}}function f0(e,t,i){if(!i||!t)return null;let s=i.active===!0,r=t.active===!1;if(!s||!r)return null;let o=t.stages||{},n=Object.entries(o).find(([,h])=>h.status==="error");if(!n)return null;let a=Pr(t);return{event:"run_failed",title:Ds.run_failed.title,body:`"${a}" failed at ${n[0]} stage`,tag:`worca-failed-${e}`,requireInteraction:!1,runId:e}}function m0(e,t,i){if(!t)return null;let s=t.stages||{},r=i&&i.stages||{};for(let[o,n]of Object.entries(s))if(n.status==="waiting_approval"&&r[o]?.status!=="waiting_approval"){let h=Pr(t),l=o==="pr"?"PR":o;return{event:"approval_needed",title:Ds.approval_needed.title,body:`"${h}" is waiting for ${l} approval`,tag:`worca-approval-${e}-${o}`,requireInteraction:!0,runId:e}}return null}function _0(e,t,i){if(!t)return null;let s=t.stages?.test;if(!s)return null;let r=s.iterations||[],o=i?.stages?.test?.iterations||[];if(r.length>o.length){let n=r[r.length-1];if(n&&n.result==="failed"){let a=Pr(t);return{event:"test_failures",title:Ds.test_failures.title,body:`"${a}" test iteration ${r.length} failed`,tag:`worca-test-${e}-iter${r.length}`,requireInteraction:!1,runId:e}}}return null}function g0(e,t,i,s,r){if(!t||!s)return null;let o=s?.worca?.loops;if(!o)return null;let n=t.stages||{},a={implement_test:["implement","test"],code_review:["review"],pr_changes:["pr"],restart_planning:["plan"]};for(let[h,l]of Object.entries(o)){if(!l||l<2)continue;let c=a[h];if(c)for(let d of c){let p=n[d];if(!p)continue;let f=(p.iterations||[]).length;if(f===l-1){let m=`${e}-${d}`;if(r.has(m))continue;r.add(m);let _=Pr(t);return{event:"loop_limit_warning",title:Ds.loop_limit_warning.title,body:`"${_}" ${d} stage approaching loop limit (${f}/${l})`,tag:`worca-loop-${e}-${d}`,requireInteraction:!1,runId:e}}}}return null}function Pr(e){let i=(e?.work_request?.title||e?.id||"Pipeline").split(`
`)[0];return i.length>60?i.slice(0,60)+"\u2026":i}var ri=null;function v0(){try{ri||(ri=new AudioContext);let e=ri.createOscillator(),t=ri.createGain();e.type="sine",e.frequency.value=440,t.gain.value=.3,e.connect(t),t.connect(ri.destination),e.start(),e.stop(ri.currentTime+.2)}catch{}}var on={enabled:!0,sound:!1,events:{run_completed:!0,run_failed:!0,approval_needed:!0,test_failures:!0,loop_limit_warning:!0}};function Xu({store:e,ws:t,getSettings:i}){let s=typeof Notification<"u"?Notification.permission:"denied",r=new Set,o=!1,n=null;function a(_){n=_}function h(){return typeof Notification<"u"&&(s=Notification.permission),s}async function l(){if(typeof Notification>"u")return"denied";let _=await Notification.requestPermission();return s=_,n&&n(),_}function c(){let _=e.getState().preferences.notifications;return _?{enabled:_.enabled??on.enabled,sound:_.sound??on.sound,events:{...on.events,..._.events||{}}}:{...on}}function d({event:_,title:C,body:k,tag:R,requireInteraction:T,runId:y}){if(typeof Notification>"u")return;let L=new Notification(C,{body:k,icon:"/favicon.svg",tag:R,requireInteraction:T});L.onclick=()=>{window.focus(),lt("active",y),L.close()};let D=c(),O=Ds[_];D.sound&&O&&O.severity==="critical"&&v0()}function p(_,C,k){if(typeof Notification>"u"||Notification.permission!=="granted")return;let R=c();if(!R.enabled)return;let T=i(),y=[p0,f0,m0,_0];for(let D of y){let O=D(_,C,k);O&&R.events[O.event]&&d(O)}let L=g0(_,C,k,T,r);L&&R.events[L.event]&&d(L)}function f(){return typeof Notification>"u"?B:(h(),s==="default"?g`
        <div class="notification-banner notification-banner--info">
          <span class="notification-banner-text">
            Enable browser notifications to stay informed about pipeline events
          </span>
          <sl-button size="small" variant="primary" @click=${()=>l()}>
            Enable Notifications
          </sl-button>
        </div>
      `:s==="denied"&&!o?g`
        <div class="notification-banner notification-banner--warning">
          <span class="notification-banner-text">
            Notifications blocked. Enable in browser settings.
          </span>
          <button class="notification-banner-dismiss" @click=${()=>{o=!0,n&&n()}}>&times;</button>
        </div>
      `:B)}function m(){ri&&(ri.close().catch(()=>{}),ri=null)}return{checkPermission:h,requestPermission:l,handleRunUpdate:p,renderBanner:f,getPreferences:c,setRerender:a,dispose:m}}var nn=globalThis,an=nn.ShadowRoot&&(nn.ShadyCSS===void 0||nn.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,Gl=Symbol(),Ju=new WeakMap,Or=class{constructor(t,i,s){if(this._$cssResult$=!0,s!==Gl)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=i}get styleSheet(){let t=this.o,i=this.t;if(an&&t===void 0){let s=i!==void 0&&i.length===1;s&&(t=Ju.get(i)),t===void 0&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),s&&Ju.set(i,t))}return t}toString(){return this.cssText}},Zu=e=>new Or(typeof e=="string"?e:e+"",void 0,Gl),U=(e,...t)=>{let i=e.length===1?e[0]:t.reduce((s,r,o)=>s+(n=>{if(n._$cssResult$===!0)return n.cssText;if(typeof n=="number")return n;throw Error("Value passed to 'css' function must be a 'css' function result: "+n+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(r)+e[o+1],e[0]);return new Or(i,e,Gl)},Qu=(e,t)=>{if(an)e.adoptedStyleSheets=t.map(i=>i instanceof CSSStyleSheet?i:i.styleSheet);else for(let i of t){let s=document.createElement("style"),r=nn.litNonce;r!==void 0&&s.setAttribute("nonce",r),s.textContent=i.cssText,e.appendChild(s)}},Xl=an?e=>e:e=>e instanceof CSSStyleSheet?(t=>{let i="";for(let s of t.cssRules)i+=s.cssText;return Zu(i)})(e):e;var{is:b0,defineProperty:y0,getOwnPropertyDescriptor:w0,getOwnPropertyNames:S0,getOwnPropertySymbols:C0,getPrototypeOf:x0}=Object,ki=globalThis,ep=ki.trustedTypes,k0=ep?ep.emptyScript:"",E0=ki.reactiveElementPolyfillSupport,Ir=(e,t)=>e,Ei={toAttribute(e,t){switch(t){case Boolean:e=e?k0:null;break;case Object:case Array:e=e==null?e:JSON.stringify(e)}return e},fromAttribute(e,t){let i=e;switch(t){case Boolean:i=e!==null;break;case Number:i=e===null?null:Number(e);break;case Object:case Array:try{i=JSON.parse(e)}catch{i=null}}return i}},ln=(e,t)=>!b0(e,t),tp={attribute:!0,type:String,converter:Ei,reflect:!1,useDefault:!1,hasChanged:ln};Symbol.metadata??(Symbol.metadata=Symbol("metadata")),ki.litPropertyMetadata??(ki.litPropertyMetadata=new WeakMap);var oi=class extends HTMLElement{static addInitializer(t){this._$Ei(),(this.l??(this.l=[])).push(t)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(t,i=tp){if(i.state&&(i.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(t)&&((i=Object.create(i)).wrapped=!0),this.elementProperties.set(t,i),!i.noAccessor){let s=Symbol(),r=this.getPropertyDescriptor(t,s,i);r!==void 0&&y0(this.prototype,t,r)}}static getPropertyDescriptor(t,i,s){let{get:r,set:o}=w0(this.prototype,t)??{get(){return this[i]},set(n){this[i]=n}};return{get:r,set(n){let a=r?.call(this);o?.call(this,n),this.requestUpdate(t,a,s)},configurable:!0,enumerable:!0}}static getPropertyOptions(t){return this.elementProperties.get(t)??tp}static _$Ei(){if(this.hasOwnProperty(Ir("elementProperties")))return;let t=x0(this);t.finalize(),t.l!==void 0&&(this.l=[...t.l]),this.elementProperties=new Map(t.elementProperties)}static finalize(){if(this.hasOwnProperty(Ir("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(Ir("properties"))){let i=this.properties,s=[...S0(i),...C0(i)];for(let r of s)this.createProperty(r,i[r])}let t=this[Symbol.metadata];if(t!==null){let i=litPropertyMetadata.get(t);if(i!==void 0)for(let[s,r]of i)this.elementProperties.set(s,r)}this._$Eh=new Map;for(let[i,s]of this.elementProperties){let r=this._$Eu(i,s);r!==void 0&&this._$Eh.set(r,i)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(t){let i=[];if(Array.isArray(t)){let s=new Set(t.flat(1/0).reverse());for(let r of s)i.unshift(Xl(r))}else t!==void 0&&i.push(Xl(t));return i}static _$Eu(t,i){let s=i.attribute;return s===!1?void 0:typeof s=="string"?s:typeof t=="string"?t.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(t=>t(this))}addController(t){(this._$EO??(this._$EO=new Set)).add(t),this.renderRoot!==void 0&&this.isConnected&&t.hostConnected?.()}removeController(t){this._$EO?.delete(t)}_$E_(){let t=new Map,i=this.constructor.elementProperties;for(let s of i.keys())this.hasOwnProperty(s)&&(t.set(s,this[s]),delete this[s]);t.size>0&&(this._$Ep=t)}createRenderRoot(){let t=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Qu(t,this.constructor.elementStyles),t}connectedCallback(){this.renderRoot??(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),this._$EO?.forEach(t=>t.hostConnected?.())}enableUpdating(t){}disconnectedCallback(){this._$EO?.forEach(t=>t.hostDisconnected?.())}attributeChangedCallback(t,i,s){this._$AK(t,s)}_$ET(t,i){let s=this.constructor.elementProperties.get(t),r=this.constructor._$Eu(t,s);if(r!==void 0&&s.reflect===!0){let o=(s.converter?.toAttribute!==void 0?s.converter:Ei).toAttribute(i,s.type);this._$Em=t,o==null?this.removeAttribute(r):this.setAttribute(r,o),this._$Em=null}}_$AK(t,i){let s=this.constructor,r=s._$Eh.get(t);if(r!==void 0&&this._$Em!==r){let o=s.getPropertyOptions(r),n=typeof o.converter=="function"?{fromAttribute:o.converter}:o.converter?.fromAttribute!==void 0?o.converter:Ei;this._$Em=r;let a=n.fromAttribute(i,o.type);this[r]=a??this._$Ej?.get(r)??a,this._$Em=null}}requestUpdate(t,i,s,r=!1,o){if(t!==void 0){let n=this.constructor;if(r===!1&&(o=this[t]),s??(s=n.getPropertyOptions(t)),!((s.hasChanged??ln)(o,i)||s.useDefault&&s.reflect&&o===this._$Ej?.get(t)&&!this.hasAttribute(n._$Eu(t,s))))return;this.C(t,i,s)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(t,i,{useDefault:s,reflect:r,wrapped:o},n){s&&!(this._$Ej??(this._$Ej=new Map)).has(t)&&(this._$Ej.set(t,n??i??this[t]),o!==!0||n!==void 0)||(this._$AL.has(t)||(this.hasUpdated||s||(i=void 0),this._$AL.set(t,i)),r===!0&&this._$Em!==t&&(this._$Eq??(this._$Eq=new Set)).add(t))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(i){Promise.reject(i)}let t=this.scheduleUpdate();return t!=null&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??(this.renderRoot=this.createRenderRoot()),this._$Ep){for(let[r,o]of this._$Ep)this[r]=o;this._$Ep=void 0}let s=this.constructor.elementProperties;if(s.size>0)for(let[r,o]of s){let{wrapped:n}=o,a=this[r];n!==!0||this._$AL.has(r)||a===void 0||this.C(r,void 0,o,a)}}let t=!1,i=this._$AL;try{t=this.shouldUpdate(i),t?(this.willUpdate(i),this._$EO?.forEach(s=>s.hostUpdate?.()),this.update(i)):this._$EM()}catch(s){throw t=!1,this._$EM(),s}t&&this._$AE(i)}willUpdate(t){}_$AE(t){this._$EO?.forEach(i=>i.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(t)),this.updated(t)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(t){return!0}update(t){this._$Eq&&(this._$Eq=this._$Eq.forEach(i=>this._$ET(i,this[i]))),this._$EM()}updated(t){}firstUpdated(t){}};oi.elementStyles=[],oi.shadowRootOptions={mode:"open"},oi[Ir("elementProperties")]=new Map,oi[Ir("finalized")]=new Map,E0?.({ReactiveElement:oi}),(ki.reactiveElementVersions??(ki.reactiveElementVersions=[])).push("2.1.2");var zr=globalThis,Ai=class extends oi{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var i;let t=super.createRenderRoot();return(i=this.renderOptions).renderBefore??(i.renderBefore=t.firstChild),t}update(t){let i=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=ho(i,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return je}};Ai._$litElement$=!0,Ai.finalized=!0,zr.litElementHydrateSupport?.({LitElement:Ai});var A0=zr.litElementPolyfillSupport;A0?.({LitElement:Ai});(zr.litElementVersions??(zr.litElementVersions=[])).push("4.2.2");var ip=U`
  :host {
    display: block;
  }

  .details {
    border: solid 1px var(--sl-color-neutral-200);
    border-radius: var(--sl-border-radius-medium);
    background-color: var(--sl-color-neutral-0);
    overflow-anchor: none;
  }

  .details--disabled {
    opacity: 0.5;
  }

  .details__header {
    display: flex;
    align-items: center;
    border-radius: inherit;
    padding: var(--sl-spacing-medium);
    user-select: none;
    -webkit-user-select: none;
    cursor: pointer;
  }

  .details__header::-webkit-details-marker {
    display: none;
  }

  .details__header:focus {
    outline: none;
  }

  .details__header:focus-visible {
    outline: var(--sl-focus-ring);
    outline-offset: calc(1px + var(--sl-focus-ring-offset));
  }

  .details--disabled .details__header {
    cursor: not-allowed;
  }

  .details--disabled .details__header:focus-visible {
    outline: none;
    box-shadow: none;
  }

  .details__summary {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
  }

  .details__summary-icon {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    transition: var(--sl-transition-medium) rotate ease;
  }

  .details--open .details__summary-icon {
    rotate: 90deg;
  }

  .details--open.details--rtl .details__summary-icon {
    rotate: -90deg;
  }

  .details--open slot[name='expand-icon'],
  .details:not(.details--open) slot[name='collapse-icon'] {
    display: none;
  }

  .details__body {
    overflow: hidden;
  }

  .details__content {
    display: block;
    padding: var(--sl-spacing-medium);
  }
`;var op=Object.defineProperty,$0=Object.defineProperties,T0=Object.getOwnPropertyDescriptor,L0=Object.getOwnPropertyDescriptors,sp=Object.getOwnPropertySymbols,D0=Object.prototype.hasOwnProperty,R0=Object.prototype.propertyIsEnumerable,Jl=(e,t)=>(t=Symbol[e])?t:Symbol.for("Symbol."+e),Zl=e=>{throw TypeError(e)},rp=(e,t,i)=>t in e?op(e,t,{enumerable:!0,configurable:!0,writable:!0,value:i}):e[t]=i,Xe=(e,t)=>{for(var i in t||(t={}))D0.call(t,i)&&rp(e,i,t[i]);if(sp)for(var i of sp(t))R0.call(t,i)&&rp(e,i,t[i]);return e},ni=(e,t)=>$0(e,L0(t)),u=(e,t,i,s)=>{for(var r=s>1?void 0:s?T0(t,i):t,o=e.length-1,n;o>=0;o--)(n=e[o])&&(r=(s?n(t,i,r):n(r))||r);return s&&r&&op(t,i,r),r},np=(e,t,i)=>t.has(e)||Zl("Cannot "+i),ap=(e,t,i)=>(np(e,t,"read from private field"),i?i.call(e):t.get(e)),lp=(e,t,i)=>t.has(e)?Zl("Cannot add the same private member more than once"):t instanceof WeakSet?t.add(e):t.set(e,i),hp=(e,t,i,s)=>(np(e,t,"write to private field"),s?s.call(e,i):t.set(e,i),i),M0=function(e,t){this[0]=e,this[1]=t},cp=e=>{var t=e[Jl("asyncIterator")],i=!1,s,r={};return t==null?(t=e[Jl("iterator")](),s=o=>r[o]=n=>t[o](n)):(t=t.call(e),s=o=>r[o]=n=>{if(i){if(i=!1,o==="throw")throw n;return n}return i=!0,{done:!1,value:new M0(new Promise(a=>{var h=t[o](n);h instanceof Object||Zl("Object expected"),a(h)}),1)}}),r[Jl("iterator")]=()=>r,s("next"),"throw"in t?s("throw"):r.throw=o=>{throw o},"return"in t&&s("return"),r};var up=new Map,B0=new WeakMap;function P0(e){return e??{keyframes:[],options:{duration:0}}}function dp(e,t){return t.toLowerCase()==="rtl"?{keyframes:e.rtlKeyframes||e.keyframes,options:e.options}:e}function Ie(e,t){up.set(e,P0(t))}function ze(e,t,i){let s=B0.get(e);if(s?.[t])return dp(s[t],i.dir);let r=up.get(t);return r?dp(r,i.dir):{keyframes:[],options:{duration:0}}}function tt(e,t){return new Promise(i=>{function s(r){r.target===e&&(e.removeEventListener(t,s),i())}e.addEventListener(t,s)})}function Ne(e,t,i){return new Promise(s=>{if(i?.duration===1/0)throw new Error("Promise-based animations must be finite.");let r=e.animate(t,ni(Xe({},i),{duration:O0()?0:i.duration}));r.addEventListener("cancel",s,{once:!0}),r.addEventListener("finish",s,{once:!0})})}function Ql(e){return e=e.toString().toLowerCase(),e.indexOf("ms")>-1?parseFloat(e):e.indexOf("s")>-1?parseFloat(e)*1e3:parseFloat(e)}function O0(){return window.matchMedia("(prefers-reduced-motion: reduce)").matches}function Ue(e){return Promise.all(e.getAnimations().map(t=>new Promise(i=>{t.cancel(),requestAnimationFrame(i)})))}function eh(e,t){return e.map(i=>ni(Xe({},i),{height:i.height==="auto"?`${t}px`:i.height}))}var th=new Set,Rs=new Map,es,ih="ltr",sh="en",pp=typeof MutationObserver<"u"&&typeof document<"u"&&typeof document.documentElement<"u";if(pp){let e=new MutationObserver(fp);ih=document.documentElement.dir||"ltr",sh=document.documentElement.lang||navigator.language,e.observe(document.documentElement,{attributes:!0,attributeFilter:["dir","lang"]})}function Nr(...e){e.map(t=>{let i=t.$code.toLowerCase();Rs.has(i)?Rs.set(i,Object.assign(Object.assign({},Rs.get(i)),t)):Rs.set(i,t),es||(es=t)}),fp()}function fp(){pp&&(ih=document.documentElement.dir||"ltr",sh=document.documentElement.lang||navigator.language),[...th.keys()].map(e=>{typeof e.requestUpdate=="function"&&e.requestUpdate()})}var hn=class{constructor(t){this.host=t,this.host.addController(this)}hostConnected(){th.add(this.host)}hostDisconnected(){th.delete(this.host)}dir(){return`${this.host.dir||ih}`.toLowerCase()}lang(){return`${this.host.lang||sh}`.toLowerCase()}getTranslationData(t){var i,s;let r=new Intl.Locale(t.replace(/_/g,"-")),o=r?.language.toLowerCase(),n=(s=(i=r?.region)===null||i===void 0?void 0:i.toLowerCase())!==null&&s!==void 0?s:"",a=Rs.get(`${o}-${n}`),h=Rs.get(o);return{locale:r,language:o,region:n,primary:a,secondary:h}}exists(t,i){var s;let{primary:r,secondary:o}=this.getTranslationData((s=i.lang)!==null&&s!==void 0?s:this.lang());return i=Object.assign({includeFallback:!1},i),!!(r&&r[t]||o&&o[t]||i.includeFallback&&es&&es[t])}term(t,...i){let{primary:s,secondary:r}=this.getTranslationData(this.lang()),o;if(s&&s[t])o=s[t];else if(r&&r[t])o=r[t];else if(es&&es[t])o=es[t];else return console.error(`No translation found for: ${String(t)}`),String(t);return typeof o=="function"?o(...i):o}date(t,i){return t=new Date(t),new Intl.DateTimeFormat(this.lang(),i).format(t)}number(t,i){return t=Number(t),isNaN(t)?"":new Intl.NumberFormat(this.lang(),i).format(t)}relativeTime(t,i,s){return new Intl.RelativeTimeFormat(this.lang(),s).format(t,i)}};var mp={$code:"en",$name:"English",$dir:"ltr",carousel:"Carousel",clearEntry:"Clear entry",close:"Close",copied:"Copied",copy:"Copy",currentValue:"Current value",error:"Error",goToSlide:(e,t)=>`Go to slide ${e} of ${t}`,hidePassword:"Hide password",loading:"Loading",nextSlide:"Next slide",numOptionsSelected:e=>e===0?"No options selected":e===1?"1 option selected":`${e} options selected`,previousSlide:"Previous slide",progress:"Progress",remove:"Remove",resize:"Resize",scrollToEnd:"Scroll to end",scrollToStart:"Scroll to start",selectAColorFromTheScreen:"Select a color from the screen",showPassword:"Show password",slideNum:e=>`Slide ${e}`,toggleColorFormat:"Toggle color format"};Nr(mp);var _p=mp;var pe=class extends hn{};Nr(_p);var rh="";function gp(e){rh=e}function vp(e=""){if(!rh){let t=[...document.getElementsByTagName("script")],i=t.find(s=>s.hasAttribute("data-shoelace"));if(i)gp(i.getAttribute("data-shoelace"));else{let s=t.find(o=>/shoelace(\.min)?\.js($|\?)/.test(o.src)||/shoelace-autoloader(\.min)?\.js($|\?)/.test(o.src)),r="";s&&(r=s.getAttribute("src")),gp(r.split("/").slice(0,-1).join("/"))}}return rh.replace(/\/$/,"")+(e?`/${e.replace(/^\//,"")}`:"")}var I0={name:"default",resolver:e=>vp(`assets/icons/${e}.svg`)},bp=I0;var yp={caret:`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  `,check:`
    <svg part="checked-icon" class="checkbox__icon" viewBox="0 0 16 16">
      <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" stroke-linecap="round">
        <g stroke="currentColor">
          <g transform="translate(3.428571, 3.428571)">
            <path d="M0,5.71428571 L3.42857143,9.14285714"></path>
            <path d="M9.14285714,0 L3.42857143,9.14285714"></path>
          </g>
        </g>
      </g>
    </svg>
  `,"chevron-down":`
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chevron-down" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
    </svg>
  `,"chevron-left":`
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chevron-left" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
    </svg>
  `,"chevron-right":`
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chevron-right" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
    </svg>
  `,copy:`
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-copy" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2Zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6ZM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2Z"/>
    </svg>
  `,eye:`
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eye" viewBox="0 0 16 16">
      <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/>
      <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/>
    </svg>
  `,"eye-slash":`
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eye-slash" viewBox="0 0 16 16">
      <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/>
      <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
      <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/>
    </svg>
  `,eyedropper:`
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eyedropper" viewBox="0 0 16 16">
      <path d="M13.354.646a1.207 1.207 0 0 0-1.708 0L8.5 3.793l-.646-.647a.5.5 0 1 0-.708.708L8.293 5l-7.147 7.146A.5.5 0 0 0 1 12.5v1.793l-.854.853a.5.5 0 1 0 .708.707L1.707 15H3.5a.5.5 0 0 0 .354-.146L11 7.707l1.146 1.147a.5.5 0 0 0 .708-.708l-.647-.646 3.147-3.146a1.207 1.207 0 0 0 0-1.708l-2-2zM2 12.707l7-7L10.293 7l-7 7H2v-1.293z"></path>
    </svg>
  `,"grip-vertical":`
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-grip-vertical" viewBox="0 0 16 16">
      <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"></path>
    </svg>
  `,indeterminate:`
    <svg part="indeterminate-icon" class="checkbox__icon" viewBox="0 0 16 16">
      <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" stroke-linecap="round">
        <g stroke="currentColor" stroke-width="2">
          <g transform="translate(2.285714, 6.857143)">
            <path d="M10.2857143,1.14285714 L1.14285714,1.14285714"></path>
          </g>
        </g>
      </g>
    </svg>
  `,"person-fill":`
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-person-fill" viewBox="0 0 16 16">
      <path d="M3 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3zm5-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
    </svg>
  `,"play-fill":`
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16">
      <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"></path>
    </svg>
  `,"pause-fill":`
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pause-fill" viewBox="0 0 16 16">
      <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"></path>
    </svg>
  `,radio:`
    <svg part="checked-icon" class="radio__icon" viewBox="0 0 16 16">
      <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g fill="currentColor">
          <circle cx="8" cy="8" r="3.42857143"></circle>
        </g>
      </g>
    </svg>
  `,"star-fill":`
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star-fill" viewBox="0 0 16 16">
      <path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/>
    </svg>
  `,"x-lg":`
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-lg" viewBox="0 0 16 16">
      <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
    </svg>
  `,"x-circle-fill":`
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-circle-fill" viewBox="0 0 16 16">
      <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z"></path>
    </svg>
  `},z0={name:"system",resolver:e=>e in yp?`data:image/svg+xml,${encodeURIComponent(yp[e])}`:""},wp=z0;var N0=[bp,wp],oh=[];function Sp(e){oh.push(e)}function Cp(e){oh=oh.filter(t=>t!==e)}function nh(e){return N0.find(t=>t.name===e)}var xp=U`
  :host {
    display: inline-block;
    width: 1em;
    height: 1em;
    box-sizing: content-box !important;
  }

  svg {
    display: block;
    height: 100%;
    width: 100%;
  }
`;function q(e,t){let i=Xe({waitUntilFirstUpdate:!1},t);return(s,r)=>{let{update:o}=s,n=Array.isArray(e)?e:[e];s.update=function(a){n.forEach(h=>{let l=h;if(a.has(l)){let c=a.get(l),d=this[l];c!==d&&(!i.waitUntilFirstUpdate||this.hasUpdated)&&this[r](c,d)}}),o.call(this,a)}}}var J=U`
  :host {
    box-sizing: border-box;
  }

  :host *,
  :host *::before,
  :host *::after {
    box-sizing: inherit;
  }

  [hidden] {
    display: none !important;
  }
`;var H0={attribute:!0,type:String,converter:Ei,reflect:!1,hasChanged:ln},F0=(e=H0,t,i)=>{let{kind:s,metadata:r}=i,o=globalThis.litPropertyMetadata.get(r);if(o===void 0&&globalThis.litPropertyMetadata.set(r,o=new Map),s==="setter"&&((e=Object.create(e)).wrapped=!0),o.set(i.name,e),s==="accessor"){let{name:n}=i;return{set(a){let h=t.get.call(this);t.set.call(this,a),this.requestUpdate(n,h,e,!0,a)},init(a){return a!==void 0&&this.C(n,void 0,e,a),a}}}if(s==="setter"){let{name:n}=i;return function(a){let h=this[n];t.call(this,a),this.requestUpdate(n,h,e,!0,a)}}throw Error("Unsupported decorator location: "+s)};function v(e){return(t,i)=>typeof i=="object"?F0(e,t,i):((s,r,o)=>{let n=r.hasOwnProperty(o);return r.constructor.createProperty(o,s),n?Object.getOwnPropertyDescriptor(r,o):void 0})(e,t,i)}function le(e){return v({...e,state:!0,attribute:!1})}function kp(e){return(t,i)=>{let s=typeof t=="function"?t:t[i];Object.assign(s,e)}}var ts=(e,t,i)=>(i.configurable=!0,i.enumerable=!0,Reflect.decorate&&typeof t!="object"&&Object.defineProperty(e,t,i),i);function K(e,t){return(i,s,r)=>{let o=n=>n.renderRoot?.querySelector(e)??null;if(t){let{get:n,set:a}=typeof s=="object"?i:r??(()=>{let h=Symbol();return{get(){return this[h]},set(l){this[h]=l}}})();return ts(i,s,{get(){let h=n.call(this);return h===void 0&&(h=o(this),(h!==null||this.hasUpdated)&&a.call(this,h)),h}})}return ts(i,s,{get(){return o(this)}})}}var cn,j=class extends Ai{constructor(){super(),lp(this,cn,!1),this.initialReflectedProperties=new Map,Object.entries(this.constructor.dependencies).forEach(([e,t])=>{this.constructor.define(e,t)})}emit(e,t){let i=new CustomEvent(e,Xe({bubbles:!0,cancelable:!1,composed:!0,detail:{}},t));return this.dispatchEvent(i),i}static define(e,t=this,i={}){let s=customElements.get(e);if(!s){try{customElements.define(e,t,i)}catch{customElements.define(e,class extends t{},i)}return}let r=" (unknown version)",o=r;"version"in t&&t.version&&(r=" v"+t.version),"version"in s&&s.version&&(o=" v"+s.version),!(r&&o&&r===o)&&console.warn(`Attempted to register <${e}>${r}, but <${e}>${o} has already been registered.`)}attributeChangedCallback(e,t,i){ap(this,cn)||(this.constructor.elementProperties.forEach((s,r)=>{s.reflect&&this[r]!=null&&this.initialReflectedProperties.set(r,this[r])}),hp(this,cn,!0)),super.attributeChangedCallback(e,t,i)}willUpdate(e){super.willUpdate(e),this.initialReflectedProperties.forEach((t,i)=>{e.has(i)&&this[i]==null&&(this[i]=t)})}};cn=new WeakMap;j.version="2.20.1";j.dependencies={};u([v()],j.prototype,"dir",2);u([v()],j.prototype,"lang",2);var{I:j2}=Hh;var Ep=(e,t)=>t===void 0?e?._$litType$!==void 0:e?._$litType$===t;var Ap=e=>e.strings===void 0;var W0={},$p=(e,t=W0)=>e._$AH=t;var Hr=Symbol(),dn=Symbol(),ah,lh=new Map,$e=class extends j{constructor(){super(...arguments),this.initialRender=!1,this.svg=null,this.label="",this.library="default"}async resolveIcon(e,t){var i;let s;if(t?.spriteSheet)return this.svg=g`<svg part="svg">
        <use part="use" href="${e}"></use>
      </svg>`,this.svg;try{if(s=await fetch(e,{mode:"cors"}),!s.ok)return s.status===410?Hr:dn}catch{return dn}try{let r=document.createElement("div");r.innerHTML=await s.text();let o=r.firstElementChild;if(((i=o?.tagName)==null?void 0:i.toLowerCase())!=="svg")return Hr;ah||(ah=new DOMParser);let a=ah.parseFromString(o.outerHTML,"text/html").body.querySelector("svg");return a?(a.part.add("svg"),document.adoptNode(a)):Hr}catch{return Hr}}connectedCallback(){super.connectedCallback(),Sp(this)}firstUpdated(){this.initialRender=!0,this.setIcon()}disconnectedCallback(){super.disconnectedCallback(),Cp(this)}getIconSource(){let e=nh(this.library);return this.name&&e?{url:e.resolver(this.name),fromLibrary:!0}:{url:this.src,fromLibrary:!1}}handleLabelChange(){typeof this.label=="string"&&this.label.length>0?(this.setAttribute("role","img"),this.setAttribute("aria-label",this.label),this.removeAttribute("aria-hidden")):(this.removeAttribute("role"),this.removeAttribute("aria-label"),this.setAttribute("aria-hidden","true"))}async setIcon(){var e;let{url:t,fromLibrary:i}=this.getIconSource(),s=i?nh(this.library):void 0;if(!t){this.svg=null;return}let r=lh.get(t);if(r||(r=this.resolveIcon(t,s),lh.set(t,r)),!this.initialRender)return;let o=await r;if(o===dn&&lh.delete(t),t===this.getIconSource().url){if(Ep(o)){if(this.svg=o,s){await this.updateComplete;let n=this.shadowRoot.querySelector("[part='svg']");typeof s.mutator=="function"&&n&&s.mutator(n)}return}switch(o){case dn:case Hr:this.svg=null,this.emit("sl-error");break;default:this.svg=o.cloneNode(!0),(e=s?.mutator)==null||e.call(s,this.svg),this.emit("sl-load")}}}render(){return this.svg}};$e.styles=[J,xp];u([le()],$e.prototype,"svg",2);u([v({reflect:!0})],$e.prototype,"name",2);u([v()],$e.prototype,"src",2);u([v()],$e.prototype,"label",2);u([v({reflect:!0})],$e.prototype,"library",2);u([q("label")],$e.prototype,"handleLabelChange",1);u([q(["name","src","library"])],$e.prototype,"setIcon",1);var Y=ps(class extends di{constructor(e){if(super(e),e.type!==At.ATTRIBUTE||e.name!=="class"||e.strings?.length>2)throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.")}render(e){return" "+Object.keys(e).filter(t=>e[t]).join(" ")+" "}update(e,[t]){if(this.st===void 0){this.st=new Set,e.strings!==void 0&&(this.nt=new Set(e.strings.join(" ").split(/\s/).filter(s=>s!=="")));for(let s in t)t[s]&&!this.nt?.has(s)&&this.st.add(s);return this.render(t)}let i=e.element.classList;for(let s of this.st)s in t||(i.remove(s),this.st.delete(s));for(let s in t){let r=!!t[s];r===this.st.has(s)||this.nt?.has(s)||(r?(i.add(s),this.st.add(s)):(i.remove(s),this.st.delete(s)))}return je}});var wt=class extends j{constructor(){super(...arguments),this.localize=new pe(this),this.open=!1,this.disabled=!1}firstUpdated(){this.body.style.height=this.open?"auto":"0",this.open&&(this.details.open=!0),this.detailsObserver=new MutationObserver(e=>{for(let t of e)t.type==="attributes"&&t.attributeName==="open"&&(this.details.open?this.show():this.hide())}),this.detailsObserver.observe(this.details,{attributes:!0})}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this.detailsObserver)==null||e.disconnect()}handleSummaryClick(e){e.preventDefault(),this.disabled||(this.open?this.hide():this.show(),this.header.focus())}handleSummaryKeyDown(e){(e.key==="Enter"||e.key===" ")&&(e.preventDefault(),this.open?this.hide():this.show()),(e.key==="ArrowUp"||e.key==="ArrowLeft")&&(e.preventDefault(),this.hide()),(e.key==="ArrowDown"||e.key==="ArrowRight")&&(e.preventDefault(),this.show())}async handleOpenChange(){if(this.open){if(this.details.open=!0,this.emit("sl-show",{cancelable:!0}).defaultPrevented){this.open=!1,this.details.open=!1;return}await Ue(this.body);let{keyframes:t,options:i}=ze(this,"details.show",{dir:this.localize.dir()});await Ne(this.body,eh(t,this.body.scrollHeight),i),this.body.style.height="auto",this.emit("sl-after-show")}else{if(this.emit("sl-hide",{cancelable:!0}).defaultPrevented){this.details.open=!0,this.open=!0;return}await Ue(this.body);let{keyframes:t,options:i}=ze(this,"details.hide",{dir:this.localize.dir()});await Ne(this.body,eh(t,this.body.scrollHeight),i),this.body.style.height="auto",this.details.open=!1,this.emit("sl-after-hide")}}async show(){if(!(this.open||this.disabled))return this.open=!0,tt(this,"sl-after-show")}async hide(){if(!(!this.open||this.disabled))return this.open=!1,tt(this,"sl-after-hide")}render(){let e=this.localize.dir()==="rtl";return g`
      <details
        part="base"
        class=${Y({details:!0,"details--open":this.open,"details--disabled":this.disabled,"details--rtl":e})}
      >
        <summary
          part="header"
          id="header"
          class="details__header"
          role="button"
          aria-expanded=${this.open?"true":"false"}
          aria-controls="content"
          aria-disabled=${this.disabled?"true":"false"}
          tabindex=${this.disabled?"-1":"0"}
          @click=${this.handleSummaryClick}
          @keydown=${this.handleSummaryKeyDown}
        >
          <slot name="summary" part="summary" class="details__summary">${this.summary}</slot>

          <span part="summary-icon" class="details__summary-icon">
            <slot name="expand-icon">
              <sl-icon library="system" name=${e?"chevron-left":"chevron-right"}></sl-icon>
            </slot>
            <slot name="collapse-icon">
              <sl-icon library="system" name=${e?"chevron-left":"chevron-right"}></sl-icon>
            </slot>
          </span>
        </summary>

        <div class="details__body" role="region" aria-labelledby="header">
          <slot part="content" id="content" class="details__content"></slot>
        </div>
      </details>
    `}};wt.styles=[J,ip];wt.dependencies={"sl-icon":$e};u([K(".details")],wt.prototype,"details",2);u([K(".details__header")],wt.prototype,"header",2);u([K(".details__body")],wt.prototype,"body",2);u([K(".details__expand-icon-slot")],wt.prototype,"expandIconSlot",2);u([v({type:Boolean,reflect:!0})],wt.prototype,"open",2);u([v()],wt.prototype,"summary",2);u([v({type:Boolean,reflect:!0})],wt.prototype,"disabled",2);u([q("open",{waitUntilFirstUpdate:!0})],wt.prototype,"handleOpenChange",1);Ie("details.show",{keyframes:[{height:"0",opacity:"0"},{height:"auto",opacity:"1"}],options:{duration:250,easing:"linear"}});Ie("details.hide",{keyframes:[{height:"auto",opacity:"1"},{height:"0",opacity:"0"}],options:{duration:250,easing:"linear"}});wt.define("sl-details");var Tp=U`
  :host {
    display: inline-block;
  }

  .tag {
    display: flex;
    align-items: center;
    border: solid 1px;
    line-height: 1;
    white-space: nowrap;
    user-select: none;
    -webkit-user-select: none;
  }

  .tag__remove::part(base) {
    color: inherit;
    padding: 0;
  }

  /*
   * Variant modifiers
   */

  .tag--primary {
    background-color: var(--sl-color-primary-50);
    border-color: var(--sl-color-primary-200);
    color: var(--sl-color-primary-800);
  }

  .tag--primary:active > sl-icon-button {
    color: var(--sl-color-primary-600);
  }

  .tag--success {
    background-color: var(--sl-color-success-50);
    border-color: var(--sl-color-success-200);
    color: var(--sl-color-success-800);
  }

  .tag--success:active > sl-icon-button {
    color: var(--sl-color-success-600);
  }

  .tag--neutral {
    background-color: var(--sl-color-neutral-50);
    border-color: var(--sl-color-neutral-200);
    color: var(--sl-color-neutral-800);
  }

  .tag--neutral:active > sl-icon-button {
    color: var(--sl-color-neutral-600);
  }

  .tag--warning {
    background-color: var(--sl-color-warning-50);
    border-color: var(--sl-color-warning-200);
    color: var(--sl-color-warning-800);
  }

  .tag--warning:active > sl-icon-button {
    color: var(--sl-color-warning-600);
  }

  .tag--danger {
    background-color: var(--sl-color-danger-50);
    border-color: var(--sl-color-danger-200);
    color: var(--sl-color-danger-800);
  }

  .tag--danger:active > sl-icon-button {
    color: var(--sl-color-danger-600);
  }

  /*
   * Size modifiers
   */

  .tag--small {
    font-size: var(--sl-button-font-size-small);
    height: calc(var(--sl-input-height-small) * 0.8);
    line-height: calc(var(--sl-input-height-small) - var(--sl-input-border-width) * 2);
    border-radius: var(--sl-input-border-radius-small);
    padding: 0 var(--sl-spacing-x-small);
  }

  .tag--medium {
    font-size: var(--sl-button-font-size-medium);
    height: calc(var(--sl-input-height-medium) * 0.8);
    line-height: calc(var(--sl-input-height-medium) - var(--sl-input-border-width) * 2);
    border-radius: var(--sl-input-border-radius-medium);
    padding: 0 var(--sl-spacing-small);
  }

  .tag--large {
    font-size: var(--sl-button-font-size-large);
    height: calc(var(--sl-input-height-large) * 0.8);
    line-height: calc(var(--sl-input-height-large) - var(--sl-input-border-width) * 2);
    border-radius: var(--sl-input-border-radius-large);
    padding: 0 var(--sl-spacing-medium);
  }

  .tag__remove {
    margin-inline-start: var(--sl-spacing-x-small);
  }

  /*
   * Pill modifier
   */

  .tag--pill {
    border-radius: var(--sl-border-radius-pill);
  }
`;var Lp=U`
  :host {
    display: inline-block;
    color: var(--sl-color-neutral-600);
  }

  .icon-button {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    background: none;
    border: none;
    border-radius: var(--sl-border-radius-medium);
    font-size: inherit;
    color: inherit;
    padding: var(--sl-spacing-x-small);
    cursor: pointer;
    transition: var(--sl-transition-x-fast) color;
    -webkit-appearance: none;
  }

  .icon-button:hover:not(.icon-button--disabled),
  .icon-button:focus-visible:not(.icon-button--disabled) {
    color: var(--sl-color-primary-600);
  }

  .icon-button:active:not(.icon-button--disabled) {
    color: var(--sl-color-primary-700);
  }

  .icon-button:focus {
    outline: none;
  }

  .icon-button--disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .icon-button:focus-visible {
    outline: var(--sl-focus-ring);
    outline-offset: var(--sl-focus-ring-offset);
  }

  .icon-button__icon {
    pointer-events: none;
  }
`;var Rp=Symbol.for(""),V0=e=>{if(e?.r===Rp)return e?._$litStatic$};var Ms=(e,...t)=>({_$litStatic$:t.reduce((i,s,r)=>i+(o=>{if(o._$litStatic$!==void 0)return o._$litStatic$;throw Error(`Value passed to 'literal' function must be a 'literal' result: ${o}. Use 'unsafeStatic' to pass non-literal values, but
            take care to ensure page security.`)})(s)+e[r+1],e[0]),r:Rp}),Dp=new Map,hh=e=>(t,...i)=>{let s=i.length,r,o,n=[],a=[],h,l=0,c=!1;for(;l<s;){for(h=t[l];l<s&&(o=i[l],(r=V0(o))!==void 0);)h+=r+t[++l],c=!0;l!==s&&a.push(o),n.push(h),l++}if(l===s&&n.push(t[s]),c){let d=n.join("$$lit$$");(t=Dp.get(d))===void 0&&(n.raw=n,Dp.set(d,t=n)),i=a}return e(t,...i)},Bs=hh(g),iA=hh(Oh),sA=hh(Ih);var H=e=>e??B;var Se=class extends j{constructor(){super(...arguments),this.hasFocus=!1,this.label="",this.disabled=!1}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleClick(e){this.disabled&&(e.preventDefault(),e.stopPropagation())}click(){this.button.click()}focus(e){this.button.focus(e)}blur(){this.button.blur()}render(){let e=!!this.href,t=e?Ms`a`:Ms`button`;return Bs`
      <${t}
        part="base"
        class=${Y({"icon-button":!0,"icon-button--disabled":!e&&this.disabled,"icon-button--focused":this.hasFocus})}
        ?disabled=${H(e?void 0:this.disabled)}
        type=${H(e?void 0:"button")}
        href=${H(e?this.href:void 0)}
        target=${H(e?this.target:void 0)}
        download=${H(e?this.download:void 0)}
        rel=${H(e&&this.target?"noreferrer noopener":void 0)}
        role=${H(e?void 0:"button")}
        aria-disabled=${this.disabled?"true":"false"}
        aria-label="${this.label}"
        tabindex=${this.disabled?"-1":"0"}
        @blur=${this.handleBlur}
        @focus=${this.handleFocus}
        @click=${this.handleClick}
      >
        <sl-icon
          class="icon-button__icon"
          name=${H(this.name)}
          library=${H(this.library)}
          src=${H(this.src)}
          aria-hidden="true"
        ></sl-icon>
      </${t}>
    `}};Se.styles=[J,Lp];Se.dependencies={"sl-icon":$e};u([K(".icon-button")],Se.prototype,"button",2);u([le()],Se.prototype,"hasFocus",2);u([v()],Se.prototype,"name",2);u([v()],Se.prototype,"library",2);u([v()],Se.prototype,"src",2);u([v()],Se.prototype,"href",2);u([v()],Se.prototype,"target",2);u([v()],Se.prototype,"download",2);u([v()],Se.prototype,"label",2);u([v({type:Boolean,reflect:!0})],Se.prototype,"disabled",2);var $i=class extends j{constructor(){super(...arguments),this.localize=new pe(this),this.variant="neutral",this.size="medium",this.pill=!1,this.removable=!1}handleRemoveClick(){this.emit("sl-remove")}render(){return g`
      <span
        part="base"
        class=${Y({tag:!0,"tag--primary":this.variant==="primary","tag--success":this.variant==="success","tag--neutral":this.variant==="neutral","tag--warning":this.variant==="warning","tag--danger":this.variant==="danger","tag--text":this.variant==="text","tag--small":this.size==="small","tag--medium":this.size==="medium","tag--large":this.size==="large","tag--pill":this.pill,"tag--removable":this.removable})}
      >
        <slot part="content" class="tag__content"></slot>

        ${this.removable?g`
              <sl-icon-button
                part="remove-button"
                exportparts="base:remove-button__base"
                name="x-lg"
                library="system"
                label=${this.localize.term("remove")}
                class="tag__remove"
                @click=${this.handleRemoveClick}
                tabindex="-1"
              ></sl-icon-button>
            `:""}
      </span>
    `}};$i.styles=[J,Tp];$i.dependencies={"sl-icon-button":Se};u([v({reflect:!0})],$i.prototype,"variant",2);u([v({reflect:!0})],$i.prototype,"size",2);u([v({type:Boolean,reflect:!0})],$i.prototype,"pill",2);u([v({type:Boolean})],$i.prototype,"removable",2);var Mp=U`
  :host {
    display: block;
  }

  /** The popup */
  .select {
    flex: 1 1 auto;
    display: inline-flex;
    width: 100%;
    position: relative;
    vertical-align: middle;
  }

  .select::part(popup) {
    z-index: var(--sl-z-index-dropdown);
  }

  .select[data-current-placement^='top']::part(popup) {
    transform-origin: bottom;
  }

  .select[data-current-placement^='bottom']::part(popup) {
    transform-origin: top;
  }

  /* Combobox */
  .select__combobox {
    flex: 1;
    display: flex;
    width: 100%;
    min-width: 0;
    position: relative;
    align-items: center;
    justify-content: start;
    font-family: var(--sl-input-font-family);
    font-weight: var(--sl-input-font-weight);
    letter-spacing: var(--sl-input-letter-spacing);
    vertical-align: middle;
    overflow: hidden;
    cursor: pointer;
    transition:
      var(--sl-transition-fast) color,
      var(--sl-transition-fast) border,
      var(--sl-transition-fast) box-shadow,
      var(--sl-transition-fast) background-color;
  }

  .select__display-input {
    position: relative;
    width: 100%;
    font: inherit;
    border: none;
    background: none;
    color: var(--sl-input-color);
    cursor: inherit;
    overflow: hidden;
    padding: 0;
    margin: 0;
    -webkit-appearance: none;
  }

  .select__display-input::placeholder {
    color: var(--sl-input-placeholder-color);
  }

  .select:not(.select--disabled):hover .select__display-input {
    color: var(--sl-input-color-hover);
  }

  .select__display-input:focus {
    outline: none;
  }

  /* Visually hide the display input when multiple is enabled */
  .select--multiple:not(.select--placeholder-visible) .select__display-input {
    position: absolute;
    z-index: -1;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
  }

  .select__value-input {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    margin: 0;
    opacity: 0;
    z-index: -1;
  }

  .select__tags {
    display: flex;
    flex: 1;
    align-items: center;
    flex-wrap: wrap;
    margin-inline-start: var(--sl-spacing-2x-small);
  }

  .select__tags::slotted(sl-tag) {
    cursor: pointer !important;
  }

  .select--disabled .select__tags,
  .select--disabled .select__tags::slotted(sl-tag) {
    cursor: not-allowed !important;
  }

  /* Standard selects */
  .select--standard .select__combobox {
    background-color: var(--sl-input-background-color);
    border: solid var(--sl-input-border-width) var(--sl-input-border-color);
  }

  .select--standard.select--disabled .select__combobox {
    background-color: var(--sl-input-background-color-disabled);
    border-color: var(--sl-input-border-color-disabled);
    color: var(--sl-input-color-disabled);
    opacity: 0.5;
    cursor: not-allowed;
    outline: none;
  }

  .select--standard:not(.select--disabled).select--open .select__combobox,
  .select--standard:not(.select--disabled).select--focused .select__combobox {
    background-color: var(--sl-input-background-color-focus);
    border-color: var(--sl-input-border-color-focus);
    box-shadow: 0 0 0 var(--sl-focus-ring-width) var(--sl-input-focus-ring-color);
  }

  /* Filled selects */
  .select--filled .select__combobox {
    border: none;
    background-color: var(--sl-input-filled-background-color);
    color: var(--sl-input-color);
  }

  .select--filled:hover:not(.select--disabled) .select__combobox {
    background-color: var(--sl-input-filled-background-color-hover);
  }

  .select--filled.select--disabled .select__combobox {
    background-color: var(--sl-input-filled-background-color-disabled);
    opacity: 0.5;
    cursor: not-allowed;
  }

  .select--filled:not(.select--disabled).select--open .select__combobox,
  .select--filled:not(.select--disabled).select--focused .select__combobox {
    background-color: var(--sl-input-filled-background-color-focus);
    outline: var(--sl-focus-ring);
  }

  /* Sizes */
  .select--small .select__combobox {
    border-radius: var(--sl-input-border-radius-small);
    font-size: var(--sl-input-font-size-small);
    min-height: var(--sl-input-height-small);
    padding-block: 0;
    padding-inline: var(--sl-input-spacing-small);
  }

  .select--small .select__clear {
    margin-inline-start: var(--sl-input-spacing-small);
  }

  .select--small .select__prefix::slotted(*) {
    margin-inline-end: var(--sl-input-spacing-small);
  }

  .select--small.select--multiple:not(.select--placeholder-visible) .select__prefix::slotted(*) {
    margin-inline-start: var(--sl-input-spacing-small);
  }

  .select--small.select--multiple:not(.select--placeholder-visible) .select__combobox {
    padding-block: 2px;
    padding-inline-start: 0;
  }

  .select--small .select__tags {
    gap: 2px;
  }

  .select--medium .select__combobox {
    border-radius: var(--sl-input-border-radius-medium);
    font-size: var(--sl-input-font-size-medium);
    min-height: var(--sl-input-height-medium);
    padding-block: 0;
    padding-inline: var(--sl-input-spacing-medium);
  }

  .select--medium .select__clear {
    margin-inline-start: var(--sl-input-spacing-medium);
  }

  .select--medium .select__prefix::slotted(*) {
    margin-inline-end: var(--sl-input-spacing-medium);
  }

  .select--medium.select--multiple:not(.select--placeholder-visible) .select__prefix::slotted(*) {
    margin-inline-start: var(--sl-input-spacing-medium);
  }

  .select--medium.select--multiple:not(.select--placeholder-visible) .select__combobox {
    padding-inline-start: 0;
    padding-block: 3px;
  }

  .select--medium .select__tags {
    gap: 3px;
  }

  .select--large .select__combobox {
    border-radius: var(--sl-input-border-radius-large);
    font-size: var(--sl-input-font-size-large);
    min-height: var(--sl-input-height-large);
    padding-block: 0;
    padding-inline: var(--sl-input-spacing-large);
  }

  .select--large .select__clear {
    margin-inline-start: var(--sl-input-spacing-large);
  }

  .select--large .select__prefix::slotted(*) {
    margin-inline-end: var(--sl-input-spacing-large);
  }

  .select--large.select--multiple:not(.select--placeholder-visible) .select__prefix::slotted(*) {
    margin-inline-start: var(--sl-input-spacing-large);
  }

  .select--large.select--multiple:not(.select--placeholder-visible) .select__combobox {
    padding-inline-start: 0;
    padding-block: 4px;
  }

  .select--large .select__tags {
    gap: 4px;
  }

  /* Pills */
  .select--pill.select--small .select__combobox {
    border-radius: var(--sl-input-height-small);
  }

  .select--pill.select--medium .select__combobox {
    border-radius: var(--sl-input-height-medium);
  }

  .select--pill.select--large .select__combobox {
    border-radius: var(--sl-input-height-large);
  }

  /* Prefix and Suffix */
  .select__prefix,
  .select__suffix {
    flex: 0;
    display: inline-flex;
    align-items: center;
    color: var(--sl-input-placeholder-color);
  }

  .select__suffix::slotted(*) {
    margin-inline-start: var(--sl-spacing-small);
  }

  /* Clear button */
  .select__clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: inherit;
    color: var(--sl-input-icon-color);
    border: none;
    background: none;
    padding: 0;
    transition: var(--sl-transition-fast) color;
    cursor: pointer;
  }

  .select__clear:hover {
    color: var(--sl-input-icon-color-hover);
  }

  .select__clear:focus {
    outline: none;
  }

  /* Expand icon */
  .select__expand-icon {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    transition: var(--sl-transition-medium) rotate ease;
    rotate: 0;
    margin-inline-start: var(--sl-spacing-small);
  }

  .select--open .select__expand-icon {
    rotate: -180deg;
  }

  /* Listbox */
  .select__listbox {
    display: block;
    position: relative;
    font-family: var(--sl-font-sans);
    font-size: var(--sl-font-size-medium);
    font-weight: var(--sl-font-weight-normal);
    box-shadow: var(--sl-shadow-large);
    background: var(--sl-panel-background-color);
    border: solid var(--sl-panel-border-width) var(--sl-panel-border-color);
    border-radius: var(--sl-border-radius-medium);
    padding-block: var(--sl-spacing-x-small);
    padding-inline: 0;
    overflow: auto;
    overscroll-behavior: none;

    /* Make sure it adheres to the popup's auto size */
    max-width: var(--auto-size-available-width);
    max-height: var(--auto-size-available-height);
  }

  .select__listbox ::slotted(sl-divider) {
    --spacing: var(--sl-spacing-x-small);
  }

  .select__listbox ::slotted(small) {
    display: block;
    font-size: var(--sl-font-size-small);
    font-weight: var(--sl-font-weight-semibold);
    color: var(--sl-color-neutral-500);
    padding-block: var(--sl-spacing-2x-small);
    padding-inline: var(--sl-spacing-x-large);
  }
`;function U0(e,t){return{top:Math.round(e.getBoundingClientRect().top-t.getBoundingClientRect().top),left:Math.round(e.getBoundingClientRect().left-t.getBoundingClientRect().left)}}var ch=new Set;function q0(){let e=document.documentElement.clientWidth;return Math.abs(window.innerWidth-e)}function K0(){let e=Number(getComputedStyle(document.body).paddingRight.replace(/px/,""));return isNaN(e)||!e?0:e}function dh(e){if(ch.add(e),!document.documentElement.classList.contains("sl-scroll-lock")){let t=q0()+K0(),i=getComputedStyle(document.documentElement).scrollbarGutter;(!i||i==="auto")&&(i="stable"),t<2&&(i=""),document.documentElement.style.setProperty("--sl-scroll-lock-gutter",i),document.documentElement.classList.add("sl-scroll-lock"),document.documentElement.style.setProperty("--sl-scroll-lock-size",`${t}px`)}}function uh(e){ch.delete(e),ch.size===0&&(document.documentElement.classList.remove("sl-scroll-lock"),document.documentElement.style.removeProperty("--sl-scroll-lock-size"))}function Fr(e,t,i="vertical",s="smooth"){let r=U0(e,t),o=r.top+t.scrollTop,n=r.left+t.scrollLeft,a=t.scrollLeft,h=t.scrollLeft+t.offsetWidth,l=t.scrollTop,c=t.scrollTop+t.offsetHeight;(i==="horizontal"||i==="both")&&(n<a?t.scrollTo({left:n,behavior:s}):n+e.clientWidth>h&&t.scrollTo({left:n-t.offsetWidth+e.clientWidth,behavior:s})),(i==="vertical"||i==="both")&&(o<l?t.scrollTo({top:o,behavior:s}):o+e.clientHeight>c&&t.scrollTo({top:o-t.offsetHeight+e.clientHeight,behavior:s}))}var Ti=U`
  .form-control .form-control__label {
    display: none;
  }

  .form-control .form-control__help-text {
    display: none;
  }

  /* Label */
  .form-control--has-label .form-control__label {
    display: inline-block;
    color: var(--sl-input-label-color);
    margin-bottom: var(--sl-spacing-3x-small);
  }

  .form-control--has-label.form-control--small .form-control__label {
    font-size: var(--sl-input-label-font-size-small);
  }

  .form-control--has-label.form-control--medium .form-control__label {
    font-size: var(--sl-input-label-font-size-medium);
  }

  .form-control--has-label.form-control--large .form-control__label {
    font-size: var(--sl-input-label-font-size-large);
  }

  :host([required]) .form-control--has-label .form-control__label::after {
    content: var(--sl-input-required-content);
    margin-inline-start: var(--sl-input-required-content-offset);
    color: var(--sl-input-required-content-color);
  }

  /* Help text */
  .form-control--has-help-text .form-control__help-text {
    display: block;
    color: var(--sl-input-help-text-color);
    margin-top: var(--sl-spacing-3x-small);
  }

  .form-control--has-help-text.form-control--small .form-control__help-text {
    font-size: var(--sl-input-help-text-font-size-small);
  }

  .form-control--has-help-text.form-control--medium .form-control__help-text {
    font-size: var(--sl-input-help-text-font-size-medium);
  }

  .form-control--has-help-text.form-control--large .form-control__help-text {
    font-size: var(--sl-input-help-text-font-size-large);
  }

  .form-control--has-help-text.form-control--radio-group .form-control__help-text {
    margin-top: var(--sl-spacing-2x-small);
  }
`;var Bp=U`
  :host {
    --arrow-color: var(--sl-color-neutral-1000);
    --arrow-size: 6px;

    /*
     * These properties are computed to account for the arrow's dimensions after being rotated 45º. The constant
     * 0.7071 is derived from sin(45), which is the diagonal size of the arrow's container after rotating.
     */
    --arrow-size-diagonal: calc(var(--arrow-size) * 0.7071);
    --arrow-padding-offset: calc(var(--arrow-size-diagonal) - var(--arrow-size));

    display: contents;
  }

  .popup {
    position: absolute;
    isolation: isolate;
    max-width: var(--auto-size-available-width, none);
    max-height: var(--auto-size-available-height, none);
  }

  .popup--fixed {
    position: fixed;
  }

  .popup:not(.popup--active) {
    display: none;
  }

  .popup__arrow {
    position: absolute;
    width: calc(var(--arrow-size-diagonal) * 2);
    height: calc(var(--arrow-size-diagonal) * 2);
    rotate: 45deg;
    background: var(--arrow-color);
    z-index: -1;
  }

  /* Hover bridge */
  .popup-hover-bridge:not(.popup-hover-bridge--visible) {
    display: none;
  }

  .popup-hover-bridge {
    position: fixed;
    z-index: calc(var(--sl-z-index-dropdown) - 1);
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    clip-path: polygon(
      var(--hover-bridge-top-left-x, 0) var(--hover-bridge-top-left-y, 0),
      var(--hover-bridge-top-right-x, 0) var(--hover-bridge-top-right-y, 0),
      var(--hover-bridge-bottom-right-x, 0) var(--hover-bridge-bottom-right-y, 0),
      var(--hover-bridge-bottom-left-x, 0) var(--hover-bridge-bottom-left-y, 0)
    );
  }
`;var Vt=Math.min,it=Math.max,Vr=Math.round,Ur=Math.floor,Lt=e=>({x:e,y:e}),j0={left:"right",right:"left",bottom:"top",top:"bottom"};function pn(e,t,i){return it(e,Vt(t,i))}function is(e,t){return typeof e=="function"?e(t):e}function ai(e){return e.split("-")[0]}function ss(e){return e.split("-")[1]}function ph(e){return e==="x"?"y":"x"}function fn(e){return e==="y"?"height":"width"}function Ut(e){let t=e[0];return t==="t"||t==="b"?"y":"x"}function mn(e){return ph(Ut(e))}function Ip(e,t,i){i===void 0&&(i=!1);let s=ss(e),r=mn(e),o=fn(r),n=r==="x"?s===(i?"end":"start")?"right":"left":s==="start"?"bottom":"top";return t.reference[o]>t.floating[o]&&(n=Wr(n)),[n,Wr(n)]}function zp(e){let t=Wr(e);return[un(e),t,un(t)]}function un(e){return e.includes("start")?e.replace("start","end"):e.replace("end","start")}var Pp=["left","right"],Op=["right","left"],Y0=["top","bottom"],G0=["bottom","top"];function X0(e,t,i){switch(e){case"top":case"bottom":return i?t?Op:Pp:t?Pp:Op;case"left":case"right":return t?Y0:G0;default:return[]}}function Np(e,t,i,s){let r=ss(e),o=X0(ai(e),i==="start",s);return r&&(o=o.map(n=>n+"-"+r),t&&(o=o.concat(o.map(un)))),o}function Wr(e){let t=ai(e);return j0[t]+e.slice(t.length)}function J0(e){return{top:0,right:0,bottom:0,left:0,...e}}function fh(e){return typeof e!="number"?J0(e):{top:e,right:e,bottom:e,left:e}}function rs(e){let{x:t,y:i,width:s,height:r}=e;return{width:s,height:r,top:i,left:t,right:t+s,bottom:i+r,x:t,y:i}}function Hp(e,t,i){let{reference:s,floating:r}=e,o=Ut(t),n=mn(t),a=fn(n),h=ai(t),l=o==="y",c=s.x+s.width/2-r.width/2,d=s.y+s.height/2-r.height/2,p=s[a]/2-r[a]/2,f;switch(h){case"top":f={x:c,y:s.y-r.height};break;case"bottom":f={x:c,y:s.y+s.height};break;case"right":f={x:s.x+s.width,y:d};break;case"left":f={x:s.x-r.width,y:d};break;default:f={x:s.x,y:s.y}}switch(ss(t)){case"start":f[n]-=p*(i&&l?-1:1);break;case"end":f[n]+=p*(i&&l?-1:1);break}return f}async function Fp(e,t){var i;t===void 0&&(t={});let{x:s,y:r,platform:o,rects:n,elements:a,strategy:h}=e,{boundary:l="clippingAncestors",rootBoundary:c="viewport",elementContext:d="floating",altBoundary:p=!1,padding:f=0}=is(t,e),m=fh(f),C=a[p?d==="floating"?"reference":"floating":d],k=rs(await o.getClippingRect({element:(i=await(o.isElement==null?void 0:o.isElement(C)))==null||i?C:C.contextElement||await(o.getDocumentElement==null?void 0:o.getDocumentElement(a.floating)),boundary:l,rootBoundary:c,strategy:h})),R=d==="floating"?{x:s,y:r,width:n.floating.width,height:n.floating.height}:n.reference,T=await(o.getOffsetParent==null?void 0:o.getOffsetParent(a.floating)),y=await(o.isElement==null?void 0:o.isElement(T))?await(o.getScale==null?void 0:o.getScale(T))||{x:1,y:1}:{x:1,y:1},L=rs(o.convertOffsetParentRelativeRectToViewportRelativeRect?await o.convertOffsetParentRelativeRectToViewportRelativeRect({elements:a,rect:R,offsetParent:T,strategy:h}):R);return{top:(k.top-L.top+m.top)/y.y,bottom:(L.bottom-k.bottom+m.bottom)/y.y,left:(k.left-L.left+m.left)/y.x,right:(L.right-k.right+m.right)/y.x}}var Z0=50,Wp=async(e,t,i)=>{let{placement:s="bottom",strategy:r="absolute",middleware:o=[],platform:n}=i,a=n.detectOverflow?n:{...n,detectOverflow:Fp},h=await(n.isRTL==null?void 0:n.isRTL(t)),l=await n.getElementRects({reference:e,floating:t,strategy:r}),{x:c,y:d}=Hp(l,s,h),p=s,f=0,m={};for(let _=0;_<o.length;_++){let C=o[_];if(!C)continue;let{name:k,fn:R}=C,{x:T,y,data:L,reset:D}=await R({x:c,y:d,initialPlacement:s,placement:p,strategy:r,middlewareData:m,rects:l,platform:a,elements:{reference:e,floating:t}});c=T??c,d=y??d,m[k]={...m[k],...L},D&&f<Z0&&(f++,typeof D=="object"&&(D.placement&&(p=D.placement),D.rects&&(l=D.rects===!0?await n.getElementRects({reference:e,floating:t,strategy:r}):D.rects),{x:c,y:d}=Hp(l,p,h)),_=-1)}return{x:c,y:d,placement:p,strategy:r,middlewareData:m}},Vp=e=>({name:"arrow",options:e,async fn(t){let{x:i,y:s,placement:r,rects:o,platform:n,elements:a,middlewareData:h}=t,{element:l,padding:c=0}=is(e,t)||{};if(l==null)return{};let d=fh(c),p={x:i,y:s},f=mn(r),m=fn(f),_=await n.getDimensions(l),C=f==="y",k=C?"top":"left",R=C?"bottom":"right",T=C?"clientHeight":"clientWidth",y=o.reference[m]+o.reference[f]-p[f]-o.floating[m],L=p[f]-o.reference[f],D=await(n.getOffsetParent==null?void 0:n.getOffsetParent(l)),O=D?D[T]:0;(!O||!await(n.isElement==null?void 0:n.isElement(D)))&&(O=a.floating[T]||o.floating[m]);let te=y/2-L/2,re=O/2-_[m]/2-1,xe=Vt(d[k],re),ie=Vt(d[R],re),Ke=xe,S=O-_[m]-ie,b=O/2-_[m]/2+te,x=pn(Ke,b,S),w=!h.arrow&&ss(r)!=null&&b!==x&&o.reference[m]/2-(b<Ke?xe:ie)-_[m]/2<0,A=w?b<Ke?b-Ke:b-S:0;return{[f]:p[f]+A,data:{[f]:x,centerOffset:b-x-A,...w&&{alignmentOffset:A}},reset:w}}});var Up=function(e){return e===void 0&&(e={}),{name:"flip",options:e,async fn(t){var i,s;let{placement:r,middlewareData:o,rects:n,initialPlacement:a,platform:h,elements:l}=t,{mainAxis:c=!0,crossAxis:d=!0,fallbackPlacements:p,fallbackStrategy:f="bestFit",fallbackAxisSideDirection:m="none",flipAlignment:_=!0,...C}=is(e,t);if((i=o.arrow)!=null&&i.alignmentOffset)return{};let k=ai(r),R=Ut(a),T=ai(a)===a,y=await(h.isRTL==null?void 0:h.isRTL(l.floating)),L=p||(T||!_?[Wr(a)]:zp(a)),D=m!=="none";!p&&D&&L.push(...Np(a,_,m,y));let O=[a,...L],te=await h.detectOverflow(t,C),re=[],xe=((s=o.flip)==null?void 0:s.overflows)||[];if(c&&re.push(te[k]),d){let b=Ip(r,n,y);re.push(te[b[0]],te[b[1]])}if(xe=[...xe,{placement:r,overflows:re}],!re.every(b=>b<=0)){var ie,Ke;let b=(((ie=o.flip)==null?void 0:ie.index)||0)+1,x=O[b];if(x&&(!(d==="alignment"?R!==Ut(x):!1)||xe.every(E=>Ut(E.placement)===R?E.overflows[0]>0:!0)))return{data:{index:b,overflows:xe},reset:{placement:x}};let w=(Ke=xe.filter(A=>A.overflows[0]<=0).sort((A,E)=>A.overflows[1]-E.overflows[1])[0])==null?void 0:Ke.placement;if(!w)switch(f){case"bestFit":{var S;let A=(S=xe.filter(E=>{if(D){let P=Ut(E.placement);return P===R||P==="y"}return!0}).map(E=>[E.placement,E.overflows.filter(P=>P>0).reduce((P,V)=>P+V,0)]).sort((E,P)=>E[1]-P[1])[0])==null?void 0:S[0];A&&(w=A);break}case"initialPlacement":w=a;break}if(r!==w)return{reset:{placement:w}}}return{}}}};var Q0=new Set(["left","top"]);async function ey(e,t){let{placement:i,platform:s,elements:r}=e,o=await(s.isRTL==null?void 0:s.isRTL(r.floating)),n=ai(i),a=ss(i),h=Ut(i)==="y",l=Q0.has(n)?-1:1,c=o&&h?-1:1,d=is(t,e),{mainAxis:p,crossAxis:f,alignmentAxis:m}=typeof d=="number"?{mainAxis:d,crossAxis:0,alignmentAxis:null}:{mainAxis:d.mainAxis||0,crossAxis:d.crossAxis||0,alignmentAxis:d.alignmentAxis};return a&&typeof m=="number"&&(f=a==="end"?m*-1:m),h?{x:f*c,y:p*l}:{x:p*l,y:f*c}}var qp=function(e){return e===void 0&&(e=0),{name:"offset",options:e,async fn(t){var i,s;let{x:r,y:o,placement:n,middlewareData:a}=t,h=await ey(t,e);return n===((i=a.offset)==null?void 0:i.placement)&&(s=a.arrow)!=null&&s.alignmentOffset?{}:{x:r+h.x,y:o+h.y,data:{...h,placement:n}}}}},Kp=function(e){return e===void 0&&(e={}),{name:"shift",options:e,async fn(t){let{x:i,y:s,placement:r,platform:o}=t,{mainAxis:n=!0,crossAxis:a=!1,limiter:h={fn:k=>{let{x:R,y:T}=k;return{x:R,y:T}}},...l}=is(e,t),c={x:i,y:s},d=await o.detectOverflow(t,l),p=Ut(ai(r)),f=ph(p),m=c[f],_=c[p];if(n){let k=f==="y"?"top":"left",R=f==="y"?"bottom":"right",T=m+d[k],y=m-d[R];m=pn(T,m,y)}if(a){let k=p==="y"?"top":"left",R=p==="y"?"bottom":"right",T=_+d[k],y=_-d[R];_=pn(T,_,y)}let C=h.fn({...t,[f]:m,[p]:_});return{...C,data:{x:C.x-i,y:C.y-s,enabled:{[f]:n,[p]:a}}}}}};var jp=function(e){return e===void 0&&(e={}),{name:"size",options:e,async fn(t){var i,s;let{placement:r,rects:o,platform:n,elements:a}=t,{apply:h=()=>{},...l}=is(e,t),c=await n.detectOverflow(t,l),d=ai(r),p=ss(r),f=Ut(r)==="y",{width:m,height:_}=o.floating,C,k;d==="top"||d==="bottom"?(C=d,k=p===(await(n.isRTL==null?void 0:n.isRTL(a.floating))?"start":"end")?"left":"right"):(k=d,C=p==="end"?"top":"bottom");let R=_-c.top-c.bottom,T=m-c.left-c.right,y=Vt(_-c[C],R),L=Vt(m-c[k],T),D=!t.middlewareData.shift,O=y,te=L;if((i=t.middlewareData.shift)!=null&&i.enabled.x&&(te=T),(s=t.middlewareData.shift)!=null&&s.enabled.y&&(O=R),D&&!p){let xe=it(c.left,0),ie=it(c.right,0),Ke=it(c.top,0),S=it(c.bottom,0);f?te=m-2*(xe!==0||ie!==0?xe+ie:it(c.left,c.right)):O=_-2*(Ke!==0||S!==0?Ke+S:it(c.top,c.bottom))}await h({...t,availableWidth:te,availableHeight:O});let re=await n.getDimensions(a.floating);return m!==re.width||_!==re.height?{reset:{rects:!0}}:{}}}};function _n(){return typeof window<"u"}function ns(e){return Gp(e)?(e.nodeName||"").toLowerCase():"#document"}function nt(e){var t;return(e==null||(t=e.ownerDocument)==null?void 0:t.defaultView)||window}function Dt(e){var t;return(t=(Gp(e)?e.ownerDocument:e.document)||window.document)==null?void 0:t.documentElement}function Gp(e){return _n()?e instanceof Node||e instanceof nt(e).Node:!1}function St(e){return _n()?e instanceof Element||e instanceof nt(e).Element:!1}function qt(e){return _n()?e instanceof HTMLElement||e instanceof nt(e).HTMLElement:!1}function Yp(e){return!_n()||typeof ShadowRoot>"u"?!1:e instanceof ShadowRoot||e instanceof nt(e).ShadowRoot}function Os(e){let{overflow:t,overflowX:i,overflowY:s,display:r}=Ct(e);return/auto|scroll|overlay|hidden|clip/.test(t+s+i)&&r!=="inline"&&r!=="contents"}function Xp(e){return/^(table|td|th)$/.test(ns(e))}function qr(e){try{if(e.matches(":popover-open"))return!0}catch{}try{return e.matches(":modal")}catch{return!1}}var ty=/transform|translate|scale|rotate|perspective|filter/,iy=/paint|layout|strict|content/,os=e=>!!e&&e!=="none",mh;function Is(e){let t=St(e)?Ct(e):e;return os(t.transform)||os(t.translate)||os(t.scale)||os(t.rotate)||os(t.perspective)||!gn()&&(os(t.backdropFilter)||os(t.filter))||ty.test(t.willChange||"")||iy.test(t.contain||"")}function Jp(e){let t=li(e);for(;qt(t)&&!as(t);){if(Is(t))return t;if(qr(t))return null;t=li(t)}return null}function gn(){return mh==null&&(mh=typeof CSS<"u"&&CSS.supports&&CSS.supports("-webkit-backdrop-filter","none")),mh}function as(e){return/^(html|body|#document)$/.test(ns(e))}function Ct(e){return nt(e).getComputedStyle(e)}function Kr(e){return St(e)?{scrollLeft:e.scrollLeft,scrollTop:e.scrollTop}:{scrollLeft:e.scrollX,scrollTop:e.scrollY}}function li(e){if(ns(e)==="html")return e;let t=e.assignedSlot||e.parentNode||Yp(e)&&e.host||Dt(e);return Yp(t)?t.host:t}function Zp(e){let t=li(e);return as(t)?e.ownerDocument?e.ownerDocument.body:e.body:qt(t)&&Os(t)?t:Zp(t)}function Ps(e,t,i){var s;t===void 0&&(t=[]),i===void 0&&(i=!0);let r=Zp(e),o=r===((s=e.ownerDocument)==null?void 0:s.body),n=nt(r);if(o){let a=vn(n);return t.concat(n,n.visualViewport||[],Os(r)?r:[],a&&i?Ps(a):[])}else return t.concat(r,Ps(r,[],i))}function vn(e){return e.parent&&Object.getPrototypeOf(e.parent)?e.frameElement:null}function sf(e){let t=Ct(e),i=parseFloat(t.width)||0,s=parseFloat(t.height)||0,r=qt(e),o=r?e.offsetWidth:i,n=r?e.offsetHeight:s,a=Vr(i)!==o||Vr(s)!==n;return a&&(i=o,s=n),{width:i,height:s,$:a}}function gh(e){return St(e)?e:e.contextElement}function zs(e){let t=gh(e);if(!qt(t))return Lt(1);let i=t.getBoundingClientRect(),{width:s,height:r,$:o}=sf(t),n=(o?Vr(i.width):i.width)/s,a=(o?Vr(i.height):i.height)/r;return(!n||!Number.isFinite(n))&&(n=1),(!a||!Number.isFinite(a))&&(a=1),{x:n,y:a}}var sy=Lt(0);function rf(e){let t=nt(e);return!gn()||!t.visualViewport?sy:{x:t.visualViewport.offsetLeft,y:t.visualViewport.offsetTop}}function ry(e,t,i){return t===void 0&&(t=!1),!i||t&&i!==nt(e)?!1:t}function ls(e,t,i,s){t===void 0&&(t=!1),i===void 0&&(i=!1);let r=e.getBoundingClientRect(),o=gh(e),n=Lt(1);t&&(s?St(s)&&(n=zs(s)):n=zs(e));let a=ry(o,i,s)?rf(o):Lt(0),h=(r.left+a.x)/n.x,l=(r.top+a.y)/n.y,c=r.width/n.x,d=r.height/n.y;if(o){let p=nt(o),f=s&&St(s)?nt(s):s,m=p,_=vn(m);for(;_&&s&&f!==m;){let C=zs(_),k=_.getBoundingClientRect(),R=Ct(_),T=k.left+(_.clientLeft+parseFloat(R.paddingLeft))*C.x,y=k.top+(_.clientTop+parseFloat(R.paddingTop))*C.y;h*=C.x,l*=C.y,c*=C.x,d*=C.y,h+=T,l+=y,m=nt(_),_=vn(m)}}return rs({width:c,height:d,x:h,y:l})}function bn(e,t){let i=Kr(e).scrollLeft;return t?t.left+i:ls(Dt(e)).left+i}function of(e,t){let i=e.getBoundingClientRect(),s=i.left+t.scrollLeft-bn(e,i),r=i.top+t.scrollTop;return{x:s,y:r}}function oy(e){let{elements:t,rect:i,offsetParent:s,strategy:r}=e,o=r==="fixed",n=Dt(s),a=t?qr(t.floating):!1;if(s===n||a&&o)return i;let h={scrollLeft:0,scrollTop:0},l=Lt(1),c=Lt(0),d=qt(s);if((d||!d&&!o)&&((ns(s)!=="body"||Os(n))&&(h=Kr(s)),d)){let f=ls(s);l=zs(s),c.x=f.x+s.clientLeft,c.y=f.y+s.clientTop}let p=n&&!d&&!o?of(n,h):Lt(0);return{width:i.width*l.x,height:i.height*l.y,x:i.x*l.x-h.scrollLeft*l.x+c.x+p.x,y:i.y*l.y-h.scrollTop*l.y+c.y+p.y}}function ny(e){return Array.from(e.getClientRects())}function ay(e){let t=Dt(e),i=Kr(e),s=e.ownerDocument.body,r=it(t.scrollWidth,t.clientWidth,s.scrollWidth,s.clientWidth),o=it(t.scrollHeight,t.clientHeight,s.scrollHeight,s.clientHeight),n=-i.scrollLeft+bn(e),a=-i.scrollTop;return Ct(s).direction==="rtl"&&(n+=it(t.clientWidth,s.clientWidth)-r),{width:r,height:o,x:n,y:a}}var Qp=25;function ly(e,t){let i=nt(e),s=Dt(e),r=i.visualViewport,o=s.clientWidth,n=s.clientHeight,a=0,h=0;if(r){o=r.width,n=r.height;let c=gn();(!c||c&&t==="fixed")&&(a=r.offsetLeft,h=r.offsetTop)}let l=bn(s);if(l<=0){let c=s.ownerDocument,d=c.body,p=getComputedStyle(d),f=c.compatMode==="CSS1Compat"&&parseFloat(p.marginLeft)+parseFloat(p.marginRight)||0,m=Math.abs(s.clientWidth-d.clientWidth-f);m<=Qp&&(o-=m)}else l<=Qp&&(o+=l);return{width:o,height:n,x:a,y:h}}function hy(e,t){let i=ls(e,!0,t==="fixed"),s=i.top+e.clientTop,r=i.left+e.clientLeft,o=qt(e)?zs(e):Lt(1),n=e.clientWidth*o.x,a=e.clientHeight*o.y,h=r*o.x,l=s*o.y;return{width:n,height:a,x:h,y:l}}function ef(e,t,i){let s;if(t==="viewport")s=ly(e,i);else if(t==="document")s=ay(Dt(e));else if(St(t))s=hy(t,i);else{let r=rf(e);s={x:t.x-r.x,y:t.y-r.y,width:t.width,height:t.height}}return rs(s)}function nf(e,t){let i=li(e);return i===t||!St(i)||as(i)?!1:Ct(i).position==="fixed"||nf(i,t)}function cy(e,t){let i=t.get(e);if(i)return i;let s=Ps(e,[],!1).filter(a=>St(a)&&ns(a)!=="body"),r=null,o=Ct(e).position==="fixed",n=o?li(e):e;for(;St(n)&&!as(n);){let a=Ct(n),h=Is(n);!h&&a.position==="fixed"&&(r=null),(o?!h&&!r:!h&&a.position==="static"&&!!r&&(r.position==="absolute"||r.position==="fixed")||Os(n)&&!h&&nf(e,n))?s=s.filter(c=>c!==n):r=a,n=li(n)}return t.set(e,s),s}function dy(e){let{element:t,boundary:i,rootBoundary:s,strategy:r}=e,n=[...i==="clippingAncestors"?qr(t)?[]:cy(t,this._c):[].concat(i),s],a=ef(t,n[0],r),h=a.top,l=a.right,c=a.bottom,d=a.left;for(let p=1;p<n.length;p++){let f=ef(t,n[p],r);h=it(f.top,h),l=Vt(f.right,l),c=Vt(f.bottom,c),d=it(f.left,d)}return{width:l-d,height:c-h,x:d,y:h}}function uy(e){let{width:t,height:i}=sf(e);return{width:t,height:i}}function py(e,t,i){let s=qt(t),r=Dt(t),o=i==="fixed",n=ls(e,!0,o,t),a={scrollLeft:0,scrollTop:0},h=Lt(0);function l(){h.x=bn(r)}if(s||!s&&!o)if((ns(t)!=="body"||Os(r))&&(a=Kr(t)),s){let f=ls(t,!0,o,t);h.x=f.x+t.clientLeft,h.y=f.y+t.clientTop}else r&&l();o&&!s&&r&&l();let c=r&&!s&&!o?of(r,a):Lt(0),d=n.left+a.scrollLeft-h.x-c.x,p=n.top+a.scrollTop-h.y-c.y;return{x:d,y:p,width:n.width,height:n.height}}function _h(e){return Ct(e).position==="static"}function tf(e,t){if(!qt(e)||Ct(e).position==="fixed")return null;if(t)return t(e);let i=e.offsetParent;return Dt(e)===i&&(i=i.ownerDocument.body),i}function af(e,t){let i=nt(e);if(qr(e))return i;if(!qt(e)){let r=li(e);for(;r&&!as(r);){if(St(r)&&!_h(r))return r;r=li(r)}return i}let s=tf(e,t);for(;s&&Xp(s)&&_h(s);)s=tf(s,t);return s&&as(s)&&_h(s)&&!Is(s)?i:s||Jp(e)||i}var fy=async function(e){let t=this.getOffsetParent||af,i=this.getDimensions,s=await i(e.floating);return{reference:py(e.reference,await t(e.floating),e.strategy),floating:{x:0,y:0,width:s.width,height:s.height}}};function my(e){return Ct(e).direction==="rtl"}var jr={convertOffsetParentRelativeRectToViewportRelativeRect:oy,getDocumentElement:Dt,getClippingRect:dy,getOffsetParent:af,getElementRects:fy,getClientRects:ny,getDimensions:uy,getScale:zs,isElement:St,isRTL:my};function lf(e,t){return e.x===t.x&&e.y===t.y&&e.width===t.width&&e.height===t.height}function _y(e,t){let i=null,s,r=Dt(e);function o(){var a;clearTimeout(s),(a=i)==null||a.disconnect(),i=null}function n(a,h){a===void 0&&(a=!1),h===void 0&&(h=1),o();let l=e.getBoundingClientRect(),{left:c,top:d,width:p,height:f}=l;if(a||t(),!p||!f)return;let m=Ur(d),_=Ur(r.clientWidth-(c+p)),C=Ur(r.clientHeight-(d+f)),k=Ur(c),T={rootMargin:-m+"px "+-_+"px "+-C+"px "+-k+"px",threshold:it(0,Vt(1,h))||1},y=!0;function L(D){let O=D[0].intersectionRatio;if(O!==h){if(!y)return n();O?n(!1,O):s=setTimeout(()=>{n(!1,1e-7)},1e3)}O===1&&!lf(l,e.getBoundingClientRect())&&n(),y=!1}try{i=new IntersectionObserver(L,{...T,root:r.ownerDocument})}catch{i=new IntersectionObserver(L,T)}i.observe(e)}return n(!0),o}function hf(e,t,i,s){s===void 0&&(s={});let{ancestorScroll:r=!0,ancestorResize:o=!0,elementResize:n=typeof ResizeObserver=="function",layoutShift:a=typeof IntersectionObserver=="function",animationFrame:h=!1}=s,l=gh(e),c=r||o?[...l?Ps(l):[],...t?Ps(t):[]]:[];c.forEach(k=>{r&&k.addEventListener("scroll",i,{passive:!0}),o&&k.addEventListener("resize",i)});let d=l&&a?_y(l,i):null,p=-1,f=null;n&&(f=new ResizeObserver(k=>{let[R]=k;R&&R.target===l&&f&&t&&(f.unobserve(t),cancelAnimationFrame(p),p=requestAnimationFrame(()=>{var T;(T=f)==null||T.observe(t)})),i()}),l&&!h&&f.observe(l),t&&f.observe(t));let m,_=h?ls(e):null;h&&C();function C(){let k=ls(e);_&&!lf(_,k)&&i(),_=k,m=requestAnimationFrame(C)}return i(),()=>{var k;c.forEach(R=>{r&&R.removeEventListener("scroll",i),o&&R.removeEventListener("resize",i)}),d?.(),(k=f)==null||k.disconnect(),f=null,h&&cancelAnimationFrame(m)}}var cf=qp;var df=Kp,uf=Up,vh=jp;var pf=Vp;var ff=(e,t,i)=>{let s=new Map,r={platform:jr,...i},o={...r.platform,_c:s};return Wp(e,t,{...r,platform:o})};function mf(e){return gy(e)}function bh(e){return e.assignedSlot?e.assignedSlot:e.parentNode instanceof ShadowRoot?e.parentNode.host:e.parentNode}function gy(e){for(let t=e;t;t=bh(t))if(t instanceof Element&&getComputedStyle(t).display==="none")return null;for(let t=bh(e);t;t=bh(t)){if(!(t instanceof Element))continue;let i=getComputedStyle(t);if(i.display!=="contents"&&(i.position!=="static"||Is(i)||t.tagName==="BODY"))return t}return null}function vy(e){return e!==null&&typeof e=="object"&&"getBoundingClientRect"in e&&("contextElement"in e?e.contextElement instanceof Element:!0)}var de=class extends j{constructor(){super(...arguments),this.localize=new pe(this),this.active=!1,this.placement="top",this.strategy="absolute",this.distance=0,this.skidding=0,this.arrow=!1,this.arrowPlacement="anchor",this.arrowPadding=10,this.flip=!1,this.flipFallbackPlacements="",this.flipFallbackStrategy="best-fit",this.flipPadding=0,this.shift=!1,this.shiftPadding=0,this.autoSizePadding=0,this.hoverBridge=!1,this.updateHoverBridge=()=>{if(this.hoverBridge&&this.anchorEl){let e=this.anchorEl.getBoundingClientRect(),t=this.popup.getBoundingClientRect(),i=this.placement.includes("top")||this.placement.includes("bottom"),s=0,r=0,o=0,n=0,a=0,h=0,l=0,c=0;i?e.top<t.top?(s=e.left,r=e.bottom,o=e.right,n=e.bottom,a=t.left,h=t.top,l=t.right,c=t.top):(s=t.left,r=t.bottom,o=t.right,n=t.bottom,a=e.left,h=e.top,l=e.right,c=e.top):e.left<t.left?(s=e.right,r=e.top,o=t.left,n=t.top,a=e.right,h=e.bottom,l=t.left,c=t.bottom):(s=t.right,r=t.top,o=e.left,n=e.top,a=t.right,h=t.bottom,l=e.left,c=e.bottom),this.style.setProperty("--hover-bridge-top-left-x",`${s}px`),this.style.setProperty("--hover-bridge-top-left-y",`${r}px`),this.style.setProperty("--hover-bridge-top-right-x",`${o}px`),this.style.setProperty("--hover-bridge-top-right-y",`${n}px`),this.style.setProperty("--hover-bridge-bottom-left-x",`${a}px`),this.style.setProperty("--hover-bridge-bottom-left-y",`${h}px`),this.style.setProperty("--hover-bridge-bottom-right-x",`${l}px`),this.style.setProperty("--hover-bridge-bottom-right-y",`${c}px`)}}}async connectedCallback(){super.connectedCallback(),await this.updateComplete,this.start()}disconnectedCallback(){super.disconnectedCallback(),this.stop()}async updated(e){super.updated(e),e.has("active")&&(this.active?this.start():this.stop()),e.has("anchor")&&this.handleAnchorChange(),this.active&&(await this.updateComplete,this.reposition())}async handleAnchorChange(){if(await this.stop(),this.anchor&&typeof this.anchor=="string"){let e=this.getRootNode();this.anchorEl=e.getElementById(this.anchor)}else this.anchor instanceof Element||vy(this.anchor)?this.anchorEl=this.anchor:this.anchorEl=this.querySelector('[slot="anchor"]');this.anchorEl instanceof HTMLSlotElement&&(this.anchorEl=this.anchorEl.assignedElements({flatten:!0})[0]),this.anchorEl&&this.active&&this.start()}start(){!this.anchorEl||!this.active||(this.cleanup=hf(this.anchorEl,this.popup,()=>{this.reposition()}))}async stop(){return new Promise(e=>{this.cleanup?(this.cleanup(),this.cleanup=void 0,this.removeAttribute("data-current-placement"),this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height"),requestAnimationFrame(()=>e())):e()})}reposition(){if(!this.active||!this.anchorEl)return;let e=[cf({mainAxis:this.distance,crossAxis:this.skidding})];this.sync?e.push(vh({apply:({rects:i})=>{let s=this.sync==="width"||this.sync==="both",r=this.sync==="height"||this.sync==="both";this.popup.style.width=s?`${i.reference.width}px`:"",this.popup.style.height=r?`${i.reference.height}px`:""}})):(this.popup.style.width="",this.popup.style.height=""),this.flip&&e.push(uf({boundary:this.flipBoundary,fallbackPlacements:this.flipFallbackPlacements,fallbackStrategy:this.flipFallbackStrategy==="best-fit"?"bestFit":"initialPlacement",padding:this.flipPadding})),this.shift&&e.push(df({boundary:this.shiftBoundary,padding:this.shiftPadding})),this.autoSize?e.push(vh({boundary:this.autoSizeBoundary,padding:this.autoSizePadding,apply:({availableWidth:i,availableHeight:s})=>{this.autoSize==="vertical"||this.autoSize==="both"?this.style.setProperty("--auto-size-available-height",`${s}px`):this.style.removeProperty("--auto-size-available-height"),this.autoSize==="horizontal"||this.autoSize==="both"?this.style.setProperty("--auto-size-available-width",`${i}px`):this.style.removeProperty("--auto-size-available-width")}})):(this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height")),this.arrow&&e.push(pf({element:this.arrowEl,padding:this.arrowPadding}));let t=this.strategy==="absolute"?i=>jr.getOffsetParent(i,mf):jr.getOffsetParent;ff(this.anchorEl,this.popup,{placement:this.placement,middleware:e,strategy:this.strategy,platform:ni(Xe({},jr),{getOffsetParent:t})}).then(({x:i,y:s,middlewareData:r,placement:o})=>{let n=this.localize.dir()==="rtl",a={top:"bottom",right:"left",bottom:"top",left:"right"}[o.split("-")[0]];if(this.setAttribute("data-current-placement",o),Object.assign(this.popup.style,{left:`${i}px`,top:`${s}px`}),this.arrow){let h=r.arrow.x,l=r.arrow.y,c="",d="",p="",f="";if(this.arrowPlacement==="start"){let m=typeof h=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";c=typeof l=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"",d=n?m:"",f=n?"":m}else if(this.arrowPlacement==="end"){let m=typeof h=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";d=n?"":m,f=n?m:"",p=typeof l=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:""}else this.arrowPlacement==="center"?(f=typeof h=="number"?"calc(50% - var(--arrow-size-diagonal))":"",c=typeof l=="number"?"calc(50% - var(--arrow-size-diagonal))":""):(f=typeof h=="number"?`${h}px`:"",c=typeof l=="number"?`${l}px`:"");Object.assign(this.arrowEl.style,{top:c,right:d,bottom:p,left:f,[a]:"calc(var(--arrow-size-diagonal) * -1)"})}}),requestAnimationFrame(()=>this.updateHoverBridge()),this.emit("sl-reposition")}render(){return g`
      <slot name="anchor" @slotchange=${this.handleAnchorChange}></slot>

      <span
        part="hover-bridge"
        class=${Y({"popup-hover-bridge":!0,"popup-hover-bridge--visible":this.hoverBridge&&this.active})}
      ></span>

      <div
        part="popup"
        class=${Y({popup:!0,"popup--active":this.active,"popup--fixed":this.strategy==="fixed","popup--has-arrow":this.arrow})}
      >
        <slot></slot>
        ${this.arrow?g`<div part="arrow" class="popup__arrow" role="presentation"></div>`:""}
      </div>
    `}};de.styles=[J,Bp];u([K(".popup")],de.prototype,"popup",2);u([K(".popup__arrow")],de.prototype,"arrowEl",2);u([v()],de.prototype,"anchor",2);u([v({type:Boolean,reflect:!0})],de.prototype,"active",2);u([v({reflect:!0})],de.prototype,"placement",2);u([v({reflect:!0})],de.prototype,"strategy",2);u([v({type:Number})],de.prototype,"distance",2);u([v({type:Number})],de.prototype,"skidding",2);u([v({type:Boolean})],de.prototype,"arrow",2);u([v({attribute:"arrow-placement"})],de.prototype,"arrowPlacement",2);u([v({attribute:"arrow-padding",type:Number})],de.prototype,"arrowPadding",2);u([v({type:Boolean})],de.prototype,"flip",2);u([v({attribute:"flip-fallback-placements",converter:{fromAttribute:e=>e.split(" ").map(t=>t.trim()).filter(t=>t!==""),toAttribute:e=>e.join(" ")}})],de.prototype,"flipFallbackPlacements",2);u([v({attribute:"flip-fallback-strategy"})],de.prototype,"flipFallbackStrategy",2);u([v({type:Object})],de.prototype,"flipBoundary",2);u([v({attribute:"flip-padding",type:Number})],de.prototype,"flipPadding",2);u([v({type:Boolean})],de.prototype,"shift",2);u([v({type:Object})],de.prototype,"shiftBoundary",2);u([v({attribute:"shift-padding",type:Number})],de.prototype,"shiftPadding",2);u([v({attribute:"auto-size"})],de.prototype,"autoSize",2);u([v()],de.prototype,"sync",2);u([v({type:Object})],de.prototype,"autoSizeBoundary",2);u([v({attribute:"auto-size-padding",type:Number})],de.prototype,"autoSizePadding",2);u([v({attribute:"hover-bridge",type:Boolean})],de.prototype,"hoverBridge",2);var Yr=new WeakMap,Gr=new WeakMap,Xr=new WeakMap,yh=new WeakSet,yn=new WeakMap,Kt=class{constructor(e,t){this.handleFormData=i=>{let s=this.options.disabled(this.host),r=this.options.name(this.host),o=this.options.value(this.host),n=this.host.tagName.toLowerCase()==="sl-button";this.host.isConnected&&!s&&!n&&typeof r=="string"&&r.length>0&&typeof o<"u"&&(Array.isArray(o)?o.forEach(a=>{i.formData.append(r,a.toString())}):i.formData.append(r,o.toString()))},this.handleFormSubmit=i=>{var s;let r=this.options.disabled(this.host),o=this.options.reportValidity;this.form&&!this.form.noValidate&&((s=Yr.get(this.form))==null||s.forEach(n=>{this.setUserInteracted(n,!0)})),this.form&&!this.form.noValidate&&!r&&!o(this.host)&&(i.preventDefault(),i.stopImmediatePropagation())},this.handleFormReset=()=>{this.options.setValue(this.host,this.options.defaultValue(this.host)),this.setUserInteracted(this.host,!1),yn.set(this.host,[])},this.handleInteraction=i=>{let s=yn.get(this.host);s.includes(i.type)||s.push(i.type),s.length===this.options.assumeInteractionOn.length&&this.setUserInteracted(this.host,!0)},this.checkFormValidity=()=>{if(this.form&&!this.form.noValidate){let i=this.form.querySelectorAll("*");for(let s of i)if(typeof s.checkValidity=="function"&&!s.checkValidity())return!1}return!0},this.reportFormValidity=()=>{if(this.form&&!this.form.noValidate){let i=this.form.querySelectorAll("*");for(let s of i)if(typeof s.reportValidity=="function"&&!s.reportValidity())return!1}return!0},(this.host=e).addController(this),this.options=Xe({form:i=>{let s=i.form;if(s){let o=i.getRootNode().querySelector(`#${s}`);if(o)return o}return i.closest("form")},name:i=>i.name,value:i=>i.value,defaultValue:i=>i.defaultValue,disabled:i=>{var s;return(s=i.disabled)!=null?s:!1},reportValidity:i=>typeof i.reportValidity=="function"?i.reportValidity():!0,checkValidity:i=>typeof i.checkValidity=="function"?i.checkValidity():!0,setValue:(i,s)=>i.value=s,assumeInteractionOn:["sl-input"]},t)}hostConnected(){let e=this.options.form(this.host);e&&this.attachForm(e),yn.set(this.host,[]),this.options.assumeInteractionOn.forEach(t=>{this.host.addEventListener(t,this.handleInteraction)})}hostDisconnected(){this.detachForm(),yn.delete(this.host),this.options.assumeInteractionOn.forEach(e=>{this.host.removeEventListener(e,this.handleInteraction)})}hostUpdated(){let e=this.options.form(this.host);e||this.detachForm(),e&&this.form!==e&&(this.detachForm(),this.attachForm(e)),this.host.hasUpdated&&this.setValidity(this.host.validity.valid)}attachForm(e){e?(this.form=e,Yr.has(this.form)?Yr.get(this.form).add(this.host):Yr.set(this.form,new Set([this.host])),this.form.addEventListener("formdata",this.handleFormData),this.form.addEventListener("submit",this.handleFormSubmit),this.form.addEventListener("reset",this.handleFormReset),Gr.has(this.form)||(Gr.set(this.form,this.form.reportValidity),this.form.reportValidity=()=>this.reportFormValidity()),Xr.has(this.form)||(Xr.set(this.form,this.form.checkValidity),this.form.checkValidity=()=>this.checkFormValidity())):this.form=void 0}detachForm(){if(!this.form)return;let e=Yr.get(this.form);e&&(e.delete(this.host),e.size<=0&&(this.form.removeEventListener("formdata",this.handleFormData),this.form.removeEventListener("submit",this.handleFormSubmit),this.form.removeEventListener("reset",this.handleFormReset),Gr.has(this.form)&&(this.form.reportValidity=Gr.get(this.form),Gr.delete(this.form)),Xr.has(this.form)&&(this.form.checkValidity=Xr.get(this.form),Xr.delete(this.form)),this.form=void 0))}setUserInteracted(e,t){t?yh.add(e):yh.delete(e),e.requestUpdate()}doAction(e,t){if(this.form){let i=document.createElement("button");i.type=e,i.style.position="absolute",i.style.width="0",i.style.height="0",i.style.clipPath="inset(50%)",i.style.overflow="hidden",i.style.whiteSpace="nowrap",t&&(i.name=t.name,i.value=t.value,["formaction","formenctype","formmethod","formnovalidate","formtarget"].forEach(s=>{t.hasAttribute(s)&&i.setAttribute(s,t.getAttribute(s))})),this.form.append(i),i.click(),i.remove()}}getForm(){var e;return(e=this.form)!=null?e:null}reset(e){this.doAction("reset",e)}submit(e){this.doAction("submit",e)}setValidity(e){let t=this.host,i=!!yh.has(t),s=!!t.required;t.toggleAttribute("data-required",s),t.toggleAttribute("data-optional",!s),t.toggleAttribute("data-invalid",!e),t.toggleAttribute("data-valid",e),t.toggleAttribute("data-user-invalid",!e&&i),t.toggleAttribute("data-user-valid",e&&i)}updateValidity(){let e=this.host;this.setValidity(e.validity.valid)}emitInvalidEvent(e){let t=new CustomEvent("sl-invalid",{bubbles:!1,composed:!1,cancelable:!0,detail:{}});e||t.preventDefault(),this.host.dispatchEvent(t)||e?.preventDefault()}},wn=Object.freeze({badInput:!1,customError:!1,patternMismatch:!1,rangeOverflow:!1,rangeUnderflow:!1,stepMismatch:!1,tooLong:!1,tooShort:!1,typeMismatch:!1,valid:!0,valueMissing:!1}),_$=Object.freeze(ni(Xe({},wn),{valid:!1,valueMissing:!0})),g$=Object.freeze(ni(Xe({},wn),{valid:!1,customError:!0}));var at=class{constructor(e,...t){this.slotNames=[],this.handleSlotChange=i=>{let s=i.target;(this.slotNames.includes("[default]")&&!s.name||s.name&&this.slotNames.includes(s.name))&&this.host.requestUpdate()},(this.host=e).addController(this),this.slotNames=t}hasDefaultSlot(){return[...this.host.childNodes].some(e=>{if(e.nodeType===e.TEXT_NODE&&e.textContent.trim()!=="")return!0;if(e.nodeType===e.ELEMENT_NODE){let t=e;if(t.tagName.toLowerCase()==="sl-visually-hidden")return!1;if(!t.hasAttribute("slot"))return!0}return!1})}hasNamedSlot(e){return this.host.querySelector(`:scope > [slot="${e}"]`)!==null}test(e){return e==="[default]"?this.hasDefaultSlot():this.hasNamedSlot(e)}hostConnected(){this.host.shadowRoot.addEventListener("slotchange",this.handleSlotChange)}hostDisconnected(){this.host.shadowRoot.removeEventListener("slotchange",this.handleSlotChange)}};var ee=class extends j{constructor(){super(...arguments),this.formControlController=new Kt(this,{assumeInteractionOn:["sl-blur","sl-input"]}),this.hasSlotController=new at(this,"help-text","label"),this.localize=new pe(this),this.typeToSelectString="",this.hasFocus=!1,this.displayLabel="",this.selectedOptions=[],this.valueHasChanged=!1,this.name="",this._value="",this.defaultValue="",this.size="medium",this.placeholder="",this.multiple=!1,this.maxOptionsVisible=3,this.disabled=!1,this.clearable=!1,this.open=!1,this.hoist=!1,this.filled=!1,this.pill=!1,this.label="",this.placement="bottom",this.helpText="",this.form="",this.required=!1,this.getTag=e=>g`
      <sl-tag
        part="tag"
        exportparts="
              base:tag__base,
              content:tag__content,
              remove-button:tag__remove-button,
              remove-button__base:tag__remove-button__base
            "
        ?pill=${this.pill}
        size=${this.size}
        removable
        @sl-remove=${t=>this.handleTagRemove(t,e)}
      >
        ${e.getTextLabel()}
      </sl-tag>
    `,this.handleDocumentFocusIn=e=>{let t=e.composedPath();this&&!t.includes(this)&&this.hide()},this.handleDocumentKeyDown=e=>{let t=e.target,i=t.closest(".select__clear")!==null,s=t.closest("sl-icon-button")!==null;if(!(i||s)){if(e.key==="Escape"&&this.open&&!this.closeWatcher&&(e.preventDefault(),e.stopPropagation(),this.hide(),this.displayInput.focus({preventScroll:!0})),e.key==="Enter"||e.key===" "&&this.typeToSelectString===""){if(e.preventDefault(),e.stopImmediatePropagation(),!this.open){this.show();return}this.currentOption&&!this.currentOption.disabled&&(this.valueHasChanged=!0,this.multiple?this.toggleOptionSelection(this.currentOption):this.setSelectedOptions(this.currentOption),this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}),this.multiple||(this.hide(),this.displayInput.focus({preventScroll:!0})));return}if(["ArrowUp","ArrowDown","Home","End"].includes(e.key)){let r=this.getAllOptions(),o=r.indexOf(this.currentOption),n=Math.max(0,o);if(e.preventDefault(),!this.open&&(this.show(),this.currentOption))return;e.key==="ArrowDown"?(n=o+1,n>r.length-1&&(n=0)):e.key==="ArrowUp"?(n=o-1,n<0&&(n=r.length-1)):e.key==="Home"?n=0:e.key==="End"&&(n=r.length-1),this.setCurrentOption(r[n])}if(e.key&&e.key.length===1||e.key==="Backspace"){let r=this.getAllOptions();if(e.metaKey||e.ctrlKey||e.altKey)return;if(!this.open){if(e.key==="Backspace")return;this.show()}e.stopPropagation(),e.preventDefault(),clearTimeout(this.typeToSelectTimeout),this.typeToSelectTimeout=window.setTimeout(()=>this.typeToSelectString="",1e3),e.key==="Backspace"?this.typeToSelectString=this.typeToSelectString.slice(0,-1):this.typeToSelectString+=e.key.toLowerCase();for(let o of r)if(o.getTextLabel().toLowerCase().startsWith(this.typeToSelectString)){this.setCurrentOption(o);break}}}},this.handleDocumentMouseDown=e=>{let t=e.composedPath();this&&!t.includes(this)&&this.hide()}}get value(){return this._value}set value(e){this.multiple?e=Array.isArray(e)?e:e.split(" "):e=Array.isArray(e)?e.join(" "):e,this._value!==e&&(this.valueHasChanged=!0,this._value=e)}get validity(){return this.valueInput.validity}get validationMessage(){return this.valueInput.validationMessage}connectedCallback(){super.connectedCallback(),setTimeout(()=>{this.handleDefaultSlotChange()}),this.open=!1}addOpenListeners(){var e;document.addEventListener("focusin",this.handleDocumentFocusIn),document.addEventListener("keydown",this.handleDocumentKeyDown),document.addEventListener("mousedown",this.handleDocumentMouseDown),this.getRootNode()!==document&&this.getRootNode().addEventListener("focusin",this.handleDocumentFocusIn),"CloseWatcher"in window&&((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>{this.open&&(this.hide(),this.displayInput.focus({preventScroll:!0}))})}removeOpenListeners(){var e;document.removeEventListener("focusin",this.handleDocumentFocusIn),document.removeEventListener("keydown",this.handleDocumentKeyDown),document.removeEventListener("mousedown",this.handleDocumentMouseDown),this.getRootNode()!==document&&this.getRootNode().removeEventListener("focusin",this.handleDocumentFocusIn),(e=this.closeWatcher)==null||e.destroy()}handleFocus(){this.hasFocus=!0,this.displayInput.setSelectionRange(0,0),this.emit("sl-focus")}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleLabelClick(){this.displayInput.focus()}handleComboboxMouseDown(e){let i=e.composedPath().some(s=>s instanceof Element&&s.tagName.toLowerCase()==="sl-icon-button");this.disabled||i||(e.preventDefault(),this.displayInput.focus({preventScroll:!0}),this.open=!this.open)}handleComboboxKeyDown(e){e.key!=="Tab"&&(e.stopPropagation(),this.handleDocumentKeyDown(e))}handleClearClick(e){e.stopPropagation(),this.valueHasChanged=!0,this.value!==""&&(this.setSelectedOptions([]),this.displayInput.focus({preventScroll:!0}),this.updateComplete.then(()=>{this.emit("sl-clear"),this.emit("sl-input"),this.emit("sl-change")}))}handleClearMouseDown(e){e.stopPropagation(),e.preventDefault()}handleOptionClick(e){let i=e.target.closest("sl-option"),s=this.value;i&&!i.disabled&&(this.valueHasChanged=!0,this.multiple?this.toggleOptionSelection(i):this.setSelectedOptions(i),this.updateComplete.then(()=>this.displayInput.focus({preventScroll:!0})),this.value!==s&&this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}),this.multiple||(this.hide(),this.displayInput.focus({preventScroll:!0})))}handleDefaultSlotChange(){customElements.get("sl-option")||customElements.whenDefined("sl-option").then(()=>this.handleDefaultSlotChange());let e=this.getAllOptions(),t=this.valueHasChanged?this.value:this.defaultValue,i=Array.isArray(t)?t:[t],s=[];e.forEach(r=>s.push(r.value)),this.setSelectedOptions(e.filter(r=>i.includes(r.value)))}handleTagRemove(e,t){e.stopPropagation(),this.valueHasChanged=!0,this.disabled||(this.toggleOptionSelection(t,!1),this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}))}getAllOptions(){return[...this.querySelectorAll("sl-option")]}getFirstOption(){return this.querySelector("sl-option")}setCurrentOption(e){this.getAllOptions().forEach(i=>{i.current=!1,i.tabIndex=-1}),e&&(this.currentOption=e,e.current=!0,e.tabIndex=0,e.focus())}setSelectedOptions(e){let t=this.getAllOptions(),i=Array.isArray(e)?e:[e];t.forEach(s=>s.selected=!1),i.length&&i.forEach(s=>s.selected=!0),this.selectionChanged()}toggleOptionSelection(e,t){t===!0||t===!1?e.selected=t:e.selected=!e.selected,this.selectionChanged()}selectionChanged(){var e,t,i;let s=this.getAllOptions();this.selectedOptions=s.filter(o=>o.selected);let r=this.valueHasChanged;if(this.multiple)this.value=this.selectedOptions.map(o=>o.value),this.placeholder&&this.value.length===0?this.displayLabel="":this.displayLabel=this.localize.term("numOptionsSelected",this.selectedOptions.length);else{let o=this.selectedOptions[0];this.value=(e=o?.value)!=null?e:"",this.displayLabel=(i=(t=o?.getTextLabel)==null?void 0:t.call(o))!=null?i:""}this.valueHasChanged=r,this.updateComplete.then(()=>{this.formControlController.updateValidity()})}get tags(){return this.selectedOptions.map((e,t)=>{if(t<this.maxOptionsVisible||this.maxOptionsVisible<=0){let i=this.getTag(e,t);return g`<div @sl-remove=${s=>this.handleTagRemove(s,e)}>
          ${typeof i=="string"?I(i):i}
        </div>`}else if(t===this.maxOptionsVisible)return g`<sl-tag size=${this.size}>+${this.selectedOptions.length-t}</sl-tag>`;return g``})}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleDisabledChange(){this.disabled&&(this.open=!1,this.handleOpenChange())}attributeChangedCallback(e,t,i){if(super.attributeChangedCallback(e,t,i),e==="value"){let s=this.valueHasChanged;this.value=this.defaultValue,this.valueHasChanged=s}}handleValueChange(){if(!this.valueHasChanged){let i=this.valueHasChanged;this.value=this.defaultValue,this.valueHasChanged=i}let e=this.getAllOptions(),t=Array.isArray(this.value)?this.value:[this.value];this.setSelectedOptions(e.filter(i=>t.includes(i.value)))}async handleOpenChange(){if(this.open&&!this.disabled){this.setCurrentOption(this.selectedOptions[0]||this.getFirstOption()),this.emit("sl-show"),this.addOpenListeners(),await Ue(this),this.listbox.hidden=!1,this.popup.active=!0,requestAnimationFrame(()=>{this.setCurrentOption(this.currentOption)});let{keyframes:e,options:t}=ze(this,"select.show",{dir:this.localize.dir()});await Ne(this.popup.popup,e,t),this.currentOption&&Fr(this.currentOption,this.listbox,"vertical","auto"),this.emit("sl-after-show")}else{this.emit("sl-hide"),this.removeOpenListeners(),await Ue(this);let{keyframes:e,options:t}=ze(this,"select.hide",{dir:this.localize.dir()});await Ne(this.popup.popup,e,t),this.listbox.hidden=!0,this.popup.active=!1,this.emit("sl-after-hide")}}async show(){if(this.open||this.disabled){this.open=!1;return}return this.open=!0,tt(this,"sl-after-show")}async hide(){if(!this.open||this.disabled){this.open=!1;return}return this.open=!1,tt(this,"sl-after-hide")}checkValidity(){return this.valueInput.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.valueInput.reportValidity()}setCustomValidity(e){this.valueInput.setCustomValidity(e),this.formControlController.updateValidity()}focus(e){this.displayInput.focus(e)}blur(){this.displayInput.blur()}render(){let e=this.hasSlotController.test("label"),t=this.hasSlotController.test("help-text"),i=this.label?!0:!!e,s=this.helpText?!0:!!t,r=this.clearable&&!this.disabled&&this.value.length>0,o=this.placeholder&&this.value&&this.value.length<=0;return g`
      <div
        part="form-control"
        class=${Y({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-label":i,"form-control--has-help-text":s})}
      >
        <label
          id="label"
          part="form-control-label"
          class="form-control__label"
          aria-hidden=${i?"false":"true"}
          @click=${this.handleLabelClick}
        >
          <slot name="label">${this.label}</slot>
        </label>

        <div part="form-control-input" class="form-control-input">
          <sl-popup
            class=${Y({select:!0,"select--standard":!0,"select--filled":this.filled,"select--pill":this.pill,"select--open":this.open,"select--disabled":this.disabled,"select--multiple":this.multiple,"select--focused":this.hasFocus,"select--placeholder-visible":o,"select--top":this.placement==="top","select--bottom":this.placement==="bottom","select--small":this.size==="small","select--medium":this.size==="medium","select--large":this.size==="large"})}
            placement=${this.placement}
            strategy=${this.hoist?"fixed":"absolute"}
            flip
            shift
            sync="width"
            auto-size="vertical"
            auto-size-padding="10"
          >
            <div
              part="combobox"
              class="select__combobox"
              slot="anchor"
              @keydown=${this.handleComboboxKeyDown}
              @mousedown=${this.handleComboboxMouseDown}
            >
              <slot part="prefix" name="prefix" class="select__prefix"></slot>

              <input
                part="display-input"
                class="select__display-input"
                type="text"
                placeholder=${this.placeholder}
                .disabled=${this.disabled}
                .value=${this.displayLabel}
                autocomplete="off"
                spellcheck="false"
                autocapitalize="off"
                readonly
                aria-controls="listbox"
                aria-expanded=${this.open?"true":"false"}
                aria-haspopup="listbox"
                aria-labelledby="label"
                aria-disabled=${this.disabled?"true":"false"}
                aria-describedby="help-text"
                role="combobox"
                tabindex="0"
                @focus=${this.handleFocus}
                @blur=${this.handleBlur}
              />

              ${this.multiple?g`<div part="tags" class="select__tags">${this.tags}</div>`:""}

              <input
                class="select__value-input"
                type="text"
                ?disabled=${this.disabled}
                ?required=${this.required}
                .value=${Array.isArray(this.value)?this.value.join(", "):this.value}
                tabindex="-1"
                aria-hidden="true"
                @focus=${()=>this.focus()}
                @invalid=${this.handleInvalid}
              />

              ${r?g`
                    <button
                      part="clear-button"
                      class="select__clear"
                      type="button"
                      aria-label=${this.localize.term("clearEntry")}
                      @mousedown=${this.handleClearMouseDown}
                      @click=${this.handleClearClick}
                      tabindex="-1"
                    >
                      <slot name="clear-icon">
                        <sl-icon name="x-circle-fill" library="system"></sl-icon>
                      </slot>
                    </button>
                  `:""}

              <slot name="suffix" part="suffix" class="select__suffix"></slot>

              <slot name="expand-icon" part="expand-icon" class="select__expand-icon">
                <sl-icon library="system" name="chevron-down"></sl-icon>
              </slot>
            </div>

            <div
              id="listbox"
              role="listbox"
              aria-expanded=${this.open?"true":"false"}
              aria-multiselectable=${this.multiple?"true":"false"}
              aria-labelledby="label"
              part="listbox"
              class="select__listbox"
              tabindex="-1"
              @mouseup=${this.handleOptionClick}
              @slotchange=${this.handleDefaultSlotChange}
            >
              <slot></slot>
            </div>
          </sl-popup>
        </div>

        <div
          part="form-control-help-text"
          id="help-text"
          class="form-control__help-text"
          aria-hidden=${s?"false":"true"}
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `}};ee.styles=[J,Ti,Mp];ee.dependencies={"sl-icon":$e,"sl-popup":de,"sl-tag":$i};u([K(".select")],ee.prototype,"popup",2);u([K(".select__combobox")],ee.prototype,"combobox",2);u([K(".select__display-input")],ee.prototype,"displayInput",2);u([K(".select__value-input")],ee.prototype,"valueInput",2);u([K(".select__listbox")],ee.prototype,"listbox",2);u([le()],ee.prototype,"hasFocus",2);u([le()],ee.prototype,"displayLabel",2);u([le()],ee.prototype,"currentOption",2);u([le()],ee.prototype,"selectedOptions",2);u([le()],ee.prototype,"valueHasChanged",2);u([v()],ee.prototype,"name",2);u([le()],ee.prototype,"value",1);u([v({attribute:"value"})],ee.prototype,"defaultValue",2);u([v({reflect:!0})],ee.prototype,"size",2);u([v()],ee.prototype,"placeholder",2);u([v({type:Boolean,reflect:!0})],ee.prototype,"multiple",2);u([v({attribute:"max-options-visible",type:Number})],ee.prototype,"maxOptionsVisible",2);u([v({type:Boolean,reflect:!0})],ee.prototype,"disabled",2);u([v({type:Boolean})],ee.prototype,"clearable",2);u([v({type:Boolean,reflect:!0})],ee.prototype,"open",2);u([v({type:Boolean})],ee.prototype,"hoist",2);u([v({type:Boolean,reflect:!0})],ee.prototype,"filled",2);u([v({type:Boolean,reflect:!0})],ee.prototype,"pill",2);u([v()],ee.prototype,"label",2);u([v({reflect:!0})],ee.prototype,"placement",2);u([v({attribute:"help-text"})],ee.prototype,"helpText",2);u([v({reflect:!0})],ee.prototype,"form",2);u([v({type:Boolean,reflect:!0})],ee.prototype,"required",2);u([v()],ee.prototype,"getTag",2);u([q("disabled",{waitUntilFirstUpdate:!0})],ee.prototype,"handleDisabledChange",1);u([q(["defaultValue","value"],{waitUntilFirstUpdate:!0})],ee.prototype,"handleValueChange",1);u([q("open",{waitUntilFirstUpdate:!0})],ee.prototype,"handleOpenChange",1);Ie("select.show",{keyframes:[{opacity:0,scale:.9},{opacity:1,scale:1}],options:{duration:100,easing:"ease"}});Ie("select.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.9}],options:{duration:100,easing:"ease"}});ee.define("sl-select");var _f=U`
  :host {
    display: block;
    user-select: none;
    -webkit-user-select: none;
  }

  :host(:focus) {
    outline: none;
  }

  .option {
    position: relative;
    display: flex;
    align-items: center;
    font-family: var(--sl-font-sans);
    font-size: var(--sl-font-size-medium);
    font-weight: var(--sl-font-weight-normal);
    line-height: var(--sl-line-height-normal);
    letter-spacing: var(--sl-letter-spacing-normal);
    color: var(--sl-color-neutral-700);
    padding: var(--sl-spacing-x-small) var(--sl-spacing-medium) var(--sl-spacing-x-small) var(--sl-spacing-x-small);
    transition: var(--sl-transition-fast) fill;
    cursor: pointer;
  }

  .option--hover:not(.option--current):not(.option--disabled) {
    background-color: var(--sl-color-neutral-100);
    color: var(--sl-color-neutral-1000);
  }

  .option--current,
  .option--current.option--disabled {
    background-color: var(--sl-color-primary-600);
    color: var(--sl-color-neutral-0);
    opacity: 1;
  }

  .option--disabled {
    outline: none;
    opacity: 0.5;
    cursor: not-allowed;
  }

  .option__label {
    flex: 1 1 auto;
    display: inline-block;
    line-height: var(--sl-line-height-dense);
  }

  .option .option__check {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    visibility: hidden;
    padding-inline-end: var(--sl-spacing-2x-small);
  }

  .option--selected .option__check {
    visibility: visible;
  }

  .option__prefix,
  .option__suffix {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
  }

  .option__prefix::slotted(*) {
    margin-inline-end: var(--sl-spacing-x-small);
  }

  .option__suffix::slotted(*) {
    margin-inline-start: var(--sl-spacing-x-small);
  }

  @media (forced-colors: active) {
    :host(:hover:not([aria-disabled='true'])) .option {
      outline: dashed 1px SelectedItem;
      outline-offset: -1px;
    }
  }
`;var ft=class extends j{constructor(){super(...arguments),this.localize=new pe(this),this.isInitialized=!1,this.current=!1,this.selected=!1,this.hasHover=!1,this.value="",this.disabled=!1}connectedCallback(){super.connectedCallback(),this.setAttribute("role","option"),this.setAttribute("aria-selected","false")}handleDefaultSlotChange(){this.isInitialized?customElements.whenDefined("sl-select").then(()=>{let e=this.closest("sl-select");e&&e.handleDefaultSlotChange()}):this.isInitialized=!0}handleMouseEnter(){this.hasHover=!0}handleMouseLeave(){this.hasHover=!1}handleDisabledChange(){this.setAttribute("aria-disabled",this.disabled?"true":"false")}handleSelectedChange(){this.setAttribute("aria-selected",this.selected?"true":"false")}handleValueChange(){typeof this.value!="string"&&(this.value=String(this.value)),this.value.includes(" ")&&(console.error("Option values cannot include a space. All spaces have been replaced with underscores.",this),this.value=this.value.replace(/ /g,"_"))}getTextLabel(){let e=this.childNodes,t="";return[...e].forEach(i=>{i.nodeType===Node.ELEMENT_NODE&&(i.hasAttribute("slot")||(t+=i.textContent)),i.nodeType===Node.TEXT_NODE&&(t+=i.textContent)}),t.trim()}render(){return g`
      <div
        part="base"
        class=${Y({option:!0,"option--current":this.current,"option--disabled":this.disabled,"option--selected":this.selected,"option--hover":this.hasHover})}
        @mouseenter=${this.handleMouseEnter}
        @mouseleave=${this.handleMouseLeave}
      >
        <sl-icon part="checked-icon" class="option__check" name="check" library="system" aria-hidden="true"></sl-icon>
        <slot part="prefix" name="prefix" class="option__prefix"></slot>
        <slot part="label" class="option__label" @slotchange=${this.handleDefaultSlotChange}></slot>
        <slot part="suffix" name="suffix" class="option__suffix"></slot>
      </div>
    `}};ft.styles=[J,_f];ft.dependencies={"sl-icon":$e};u([K(".option__label")],ft.prototype,"defaultSlot",2);u([le()],ft.prototype,"current",2);u([le()],ft.prototype,"selected",2);u([le()],ft.prototype,"hasHover",2);u([v({reflect:!0})],ft.prototype,"value",2);u([v({type:Boolean,reflect:!0})],ft.prototype,"disabled",2);u([q("disabled")],ft.prototype,"handleDisabledChange",1);u([q("selected")],ft.prototype,"handleSelectedChange",1);u([q("value")],ft.prototype,"handleValueChange",1);ft.define("sl-option");var gf=U`
  :host {
    display: block;
  }

  .input {
    flex: 1 1 auto;
    display: inline-flex;
    align-items: stretch;
    justify-content: start;
    position: relative;
    width: 100%;
    font-family: var(--sl-input-font-family);
    font-weight: var(--sl-input-font-weight);
    letter-spacing: var(--sl-input-letter-spacing);
    vertical-align: middle;
    overflow: hidden;
    cursor: text;
    transition:
      var(--sl-transition-fast) color,
      var(--sl-transition-fast) border,
      var(--sl-transition-fast) box-shadow,
      var(--sl-transition-fast) background-color;
  }

  /* Standard inputs */
  .input--standard {
    background-color: var(--sl-input-background-color);
    border: solid var(--sl-input-border-width) var(--sl-input-border-color);
  }

  .input--standard:hover:not(.input--disabled) {
    background-color: var(--sl-input-background-color-hover);
    border-color: var(--sl-input-border-color-hover);
  }

  .input--standard.input--focused:not(.input--disabled) {
    background-color: var(--sl-input-background-color-focus);
    border-color: var(--sl-input-border-color-focus);
    box-shadow: 0 0 0 var(--sl-focus-ring-width) var(--sl-input-focus-ring-color);
  }

  .input--standard.input--focused:not(.input--disabled) .input__control {
    color: var(--sl-input-color-focus);
  }

  .input--standard.input--disabled {
    background-color: var(--sl-input-background-color-disabled);
    border-color: var(--sl-input-border-color-disabled);
    opacity: 0.5;
    cursor: not-allowed;
  }

  .input--standard.input--disabled .input__control {
    color: var(--sl-input-color-disabled);
  }

  .input--standard.input--disabled .input__control::placeholder {
    color: var(--sl-input-placeholder-color-disabled);
  }

  /* Filled inputs */
  .input--filled {
    border: none;
    background-color: var(--sl-input-filled-background-color);
    color: var(--sl-input-color);
  }

  .input--filled:hover:not(.input--disabled) {
    background-color: var(--sl-input-filled-background-color-hover);
  }

  .input--filled.input--focused:not(.input--disabled) {
    background-color: var(--sl-input-filled-background-color-focus);
    outline: var(--sl-focus-ring);
    outline-offset: var(--sl-focus-ring-offset);
  }

  .input--filled.input--disabled {
    background-color: var(--sl-input-filled-background-color-disabled);
    opacity: 0.5;
    cursor: not-allowed;
  }

  .input__control {
    flex: 1 1 auto;
    font-family: inherit;
    font-size: inherit;
    font-weight: inherit;
    min-width: 0;
    height: 100%;
    color: var(--sl-input-color);
    border: none;
    background: inherit;
    box-shadow: none;
    padding: 0;
    margin: 0;
    cursor: inherit;
    -webkit-appearance: none;
  }

  .input__control::-webkit-search-decoration,
  .input__control::-webkit-search-cancel-button,
  .input__control::-webkit-search-results-button,
  .input__control::-webkit-search-results-decoration {
    -webkit-appearance: none;
  }

  .input__control:-webkit-autofill,
  .input__control:-webkit-autofill:hover,
  .input__control:-webkit-autofill:focus,
  .input__control:-webkit-autofill:active {
    box-shadow: 0 0 0 var(--sl-input-height-large) var(--sl-input-background-color-hover) inset !important;
    -webkit-text-fill-color: var(--sl-color-primary-500);
    caret-color: var(--sl-input-color);
  }

  .input--filled .input__control:-webkit-autofill,
  .input--filled .input__control:-webkit-autofill:hover,
  .input--filled .input__control:-webkit-autofill:focus,
  .input--filled .input__control:-webkit-autofill:active {
    box-shadow: 0 0 0 var(--sl-input-height-large) var(--sl-input-filled-background-color) inset !important;
  }

  .input__control::placeholder {
    color: var(--sl-input-placeholder-color);
    user-select: none;
    -webkit-user-select: none;
  }

  .input:hover:not(.input--disabled) .input__control {
    color: var(--sl-input-color-hover);
  }

  .input__control:focus {
    outline: none;
  }

  .input__prefix,
  .input__suffix {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    cursor: default;
  }

  .input__prefix ::slotted(sl-icon),
  .input__suffix ::slotted(sl-icon) {
    color: var(--sl-input-icon-color);
  }

  /*
   * Size modifiers
   */

  .input--small {
    border-radius: var(--sl-input-border-radius-small);
    font-size: var(--sl-input-font-size-small);
    height: var(--sl-input-height-small);
  }

  .input--small .input__control {
    height: calc(var(--sl-input-height-small) - var(--sl-input-border-width) * 2);
    padding: 0 var(--sl-input-spacing-small);
  }

  .input--small .input__clear,
  .input--small .input__password-toggle {
    width: calc(1em + var(--sl-input-spacing-small) * 2);
  }

  .input--small .input__prefix ::slotted(*) {
    margin-inline-start: var(--sl-input-spacing-small);
  }

  .input--small .input__suffix ::slotted(*) {
    margin-inline-end: var(--sl-input-spacing-small);
  }

  .input--medium {
    border-radius: var(--sl-input-border-radius-medium);
    font-size: var(--sl-input-font-size-medium);
    height: var(--sl-input-height-medium);
  }

  .input--medium .input__control {
    height: calc(var(--sl-input-height-medium) - var(--sl-input-border-width) * 2);
    padding: 0 var(--sl-input-spacing-medium);
  }

  .input--medium .input__clear,
  .input--medium .input__password-toggle {
    width: calc(1em + var(--sl-input-spacing-medium) * 2);
  }

  .input--medium .input__prefix ::slotted(*) {
    margin-inline-start: var(--sl-input-spacing-medium);
  }

  .input--medium .input__suffix ::slotted(*) {
    margin-inline-end: var(--sl-input-spacing-medium);
  }

  .input--large {
    border-radius: var(--sl-input-border-radius-large);
    font-size: var(--sl-input-font-size-large);
    height: var(--sl-input-height-large);
  }

  .input--large .input__control {
    height: calc(var(--sl-input-height-large) - var(--sl-input-border-width) * 2);
    padding: 0 var(--sl-input-spacing-large);
  }

  .input--large .input__clear,
  .input--large .input__password-toggle {
    width: calc(1em + var(--sl-input-spacing-large) * 2);
  }

  .input--large .input__prefix ::slotted(*) {
    margin-inline-start: var(--sl-input-spacing-large);
  }

  .input--large .input__suffix ::slotted(*) {
    margin-inline-end: var(--sl-input-spacing-large);
  }

  /*
   * Pill modifier
   */

  .input--pill.input--small {
    border-radius: var(--sl-input-height-small);
  }

  .input--pill.input--medium {
    border-radius: var(--sl-input-height-medium);
  }

  .input--pill.input--large {
    border-radius: var(--sl-input-height-large);
  }

  /*
   * Clearable + Password Toggle
   */

  .input__clear,
  .input__password-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: inherit;
    color: var(--sl-input-icon-color);
    border: none;
    background: none;
    padding: 0;
    transition: var(--sl-transition-fast) color;
    cursor: pointer;
  }

  .input__clear:hover,
  .input__password-toggle:hover {
    color: var(--sl-input-icon-color-hover);
  }

  .input__clear:focus,
  .input__password-toggle:focus {
    outline: none;
  }

  /* Don't show the browser's password toggle in Edge */
  ::-ms-reveal {
    display: none;
  }

  /* Hide the built-in number spinner */
  .input--no-spin-buttons input[type='number']::-webkit-outer-spin-button,
  .input--no-spin-buttons input[type='number']::-webkit-inner-spin-button {
    -webkit-appearance: none;
    display: none;
  }

  .input--no-spin-buttons input[type='number'] {
    -moz-appearance: textfield;
  }
`;var Ns=(e="value")=>(t,i)=>{let s=t.constructor,r=s.prototype.attributeChangedCallback;s.prototype.attributeChangedCallback=function(o,n,a){var h;let l=s.getPropertyOptions(e),c=typeof l.attribute=="string"?l.attribute:e;if(o===c){let d=l.converter||Ei,f=(typeof d=="function"?d:(h=d?.fromAttribute)!=null?h:Ei.fromAttribute)(a,l.type);this[e]!==f&&(this[i]=f)}r.call(this,o,n,a)}};var Hs=ps(class extends di{constructor(e){if(super(e),e.type!==At.PROPERTY&&e.type!==At.ATTRIBUTE&&e.type!==At.BOOLEAN_ATTRIBUTE)throw Error("The `live` directive is not allowed on child or event bindings");if(!Ap(e))throw Error("`live` bindings can only contain a single expression")}render(e){return e}update(e,[t]){if(t===je||t===B)return t;let i=e.element,s=e.name;if(e.type===At.PROPERTY){if(t===i[s])return je}else if(e.type===At.BOOLEAN_ATTRIBUTE){if(!!t===i.hasAttribute(s))return je}else if(e.type===At.ATTRIBUTE&&i.getAttribute(s)===t+"")return je;return $p(e),t}});var X=class extends j{constructor(){super(...arguments),this.formControlController=new Kt(this,{assumeInteractionOn:["sl-blur","sl-input"]}),this.hasSlotController=new at(this,"help-text","label"),this.localize=new pe(this),this.hasFocus=!1,this.title="",this.__numberInput=Object.assign(document.createElement("input"),{type:"number"}),this.__dateInput=Object.assign(document.createElement("input"),{type:"date"}),this.type="text",this.name="",this.value="",this.defaultValue="",this.size="medium",this.filled=!1,this.pill=!1,this.label="",this.helpText="",this.clearable=!1,this.disabled=!1,this.placeholder="",this.readonly=!1,this.passwordToggle=!1,this.passwordVisible=!1,this.noSpinButtons=!1,this.form="",this.required=!1,this.spellcheck=!0}get valueAsDate(){var e;return this.__dateInput.type=this.type,this.__dateInput.value=this.value,((e=this.input)==null?void 0:e.valueAsDate)||this.__dateInput.valueAsDate}set valueAsDate(e){this.__dateInput.type=this.type,this.__dateInput.valueAsDate=e,this.value=this.__dateInput.value}get valueAsNumber(){var e;return this.__numberInput.value=this.value,((e=this.input)==null?void 0:e.valueAsNumber)||this.__numberInput.valueAsNumber}set valueAsNumber(e){this.__numberInput.valueAsNumber=e,this.value=this.__numberInput.value}get validity(){return this.input.validity}get validationMessage(){return this.input.validationMessage}firstUpdated(){this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleChange(){this.value=this.input.value,this.emit("sl-change")}handleClearClick(e){e.preventDefault(),this.value!==""&&(this.value="",this.emit("sl-clear"),this.emit("sl-input"),this.emit("sl-change")),this.input.focus()}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleInput(){this.value=this.input.value,this.formControlController.updateValidity(),this.emit("sl-input")}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleKeyDown(e){let t=e.metaKey||e.ctrlKey||e.shiftKey||e.altKey;e.key==="Enter"&&!t&&setTimeout(()=>{!e.defaultPrevented&&!e.isComposing&&this.formControlController.submit()})}handlePasswordToggle(){this.passwordVisible=!this.passwordVisible}handleDisabledChange(){this.formControlController.setValidity(this.disabled)}handleStepChange(){this.input.step=String(this.step),this.formControlController.updateValidity()}async handleValueChange(){await this.updateComplete,this.formControlController.updateValidity()}focus(e){this.input.focus(e)}blur(){this.input.blur()}select(){this.input.select()}setSelectionRange(e,t,i="none"){this.input.setSelectionRange(e,t,i)}setRangeText(e,t,i,s="preserve"){let r=t??this.input.selectionStart,o=i??this.input.selectionEnd;this.input.setRangeText(e,r,o,s),this.value!==this.input.value&&(this.value=this.input.value)}showPicker(){"showPicker"in HTMLInputElement.prototype&&this.input.showPicker()}stepUp(){this.input.stepUp(),this.value!==this.input.value&&(this.value=this.input.value)}stepDown(){this.input.stepDown(),this.value!==this.input.value&&(this.value=this.input.value)}checkValidity(){return this.input.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.input.reportValidity()}setCustomValidity(e){this.input.setCustomValidity(e),this.formControlController.updateValidity()}render(){let e=this.hasSlotController.test("label"),t=this.hasSlotController.test("help-text"),i=this.label?!0:!!e,s=this.helpText?!0:!!t,o=this.clearable&&!this.disabled&&!this.readonly&&(typeof this.value=="number"||this.value.length>0);return g`
      <div
        part="form-control"
        class=${Y({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-label":i,"form-control--has-help-text":s})}
      >
        <label
          part="form-control-label"
          class="form-control__label"
          for="input"
          aria-hidden=${i?"false":"true"}
        >
          <slot name="label">${this.label}</slot>
        </label>

        <div part="form-control-input" class="form-control-input">
          <div
            part="base"
            class=${Y({input:!0,"input--small":this.size==="small","input--medium":this.size==="medium","input--large":this.size==="large","input--pill":this.pill,"input--standard":!this.filled,"input--filled":this.filled,"input--disabled":this.disabled,"input--focused":this.hasFocus,"input--empty":!this.value,"input--no-spin-buttons":this.noSpinButtons})}
          >
            <span part="prefix" class="input__prefix">
              <slot name="prefix"></slot>
            </span>

            <input
              part="input"
              id="input"
              class="input__control"
              type=${this.type==="password"&&this.passwordVisible?"text":this.type}
              title=${this.title}
              name=${H(this.name)}
              ?disabled=${this.disabled}
              ?readonly=${this.readonly}
              ?required=${this.required}
              placeholder=${H(this.placeholder)}
              minlength=${H(this.minlength)}
              maxlength=${H(this.maxlength)}
              min=${H(this.min)}
              max=${H(this.max)}
              step=${H(this.step)}
              .value=${Hs(this.value)}
              autocapitalize=${H(this.autocapitalize)}
              autocomplete=${H(this.autocomplete)}
              autocorrect=${H(this.autocorrect)}
              ?autofocus=${this.autofocus}
              spellcheck=${this.spellcheck}
              pattern=${H(this.pattern)}
              enterkeyhint=${H(this.enterkeyhint)}
              inputmode=${H(this.inputmode)}
              aria-describedby="help-text"
              @change=${this.handleChange}
              @input=${this.handleInput}
              @invalid=${this.handleInvalid}
              @keydown=${this.handleKeyDown}
              @focus=${this.handleFocus}
              @blur=${this.handleBlur}
            />

            ${o?g`
                  <button
                    part="clear-button"
                    class="input__clear"
                    type="button"
                    aria-label=${this.localize.term("clearEntry")}
                    @click=${this.handleClearClick}
                    tabindex="-1"
                  >
                    <slot name="clear-icon">
                      <sl-icon name="x-circle-fill" library="system"></sl-icon>
                    </slot>
                  </button>
                `:""}
            ${this.passwordToggle&&!this.disabled?g`
                  <button
                    part="password-toggle-button"
                    class="input__password-toggle"
                    type="button"
                    aria-label=${this.localize.term(this.passwordVisible?"hidePassword":"showPassword")}
                    @click=${this.handlePasswordToggle}
                    tabindex="-1"
                  >
                    ${this.passwordVisible?g`
                          <slot name="show-password-icon">
                            <sl-icon name="eye-slash" library="system"></sl-icon>
                          </slot>
                        `:g`
                          <slot name="hide-password-icon">
                            <sl-icon name="eye" library="system"></sl-icon>
                          </slot>
                        `}
                  </button>
                `:""}

            <span part="suffix" class="input__suffix">
              <slot name="suffix"></slot>
            </span>
          </div>
        </div>

        <div
          part="form-control-help-text"
          id="help-text"
          class="form-control__help-text"
          aria-hidden=${s?"false":"true"}
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `}};X.styles=[J,Ti,gf];X.dependencies={"sl-icon":$e};u([K(".input__control")],X.prototype,"input",2);u([le()],X.prototype,"hasFocus",2);u([v()],X.prototype,"title",2);u([v({reflect:!0})],X.prototype,"type",2);u([v()],X.prototype,"name",2);u([v()],X.prototype,"value",2);u([Ns()],X.prototype,"defaultValue",2);u([v({reflect:!0})],X.prototype,"size",2);u([v({type:Boolean,reflect:!0})],X.prototype,"filled",2);u([v({type:Boolean,reflect:!0})],X.prototype,"pill",2);u([v()],X.prototype,"label",2);u([v({attribute:"help-text"})],X.prototype,"helpText",2);u([v({type:Boolean})],X.prototype,"clearable",2);u([v({type:Boolean,reflect:!0})],X.prototype,"disabled",2);u([v()],X.prototype,"placeholder",2);u([v({type:Boolean,reflect:!0})],X.prototype,"readonly",2);u([v({attribute:"password-toggle",type:Boolean})],X.prototype,"passwordToggle",2);u([v({attribute:"password-visible",type:Boolean})],X.prototype,"passwordVisible",2);u([v({attribute:"no-spin-buttons",type:Boolean})],X.prototype,"noSpinButtons",2);u([v({reflect:!0})],X.prototype,"form",2);u([v({type:Boolean,reflect:!0})],X.prototype,"required",2);u([v()],X.prototype,"pattern",2);u([v({type:Number})],X.prototype,"minlength",2);u([v({type:Number})],X.prototype,"maxlength",2);u([v()],X.prototype,"min",2);u([v()],X.prototype,"max",2);u([v()],X.prototype,"step",2);u([v()],X.prototype,"autocapitalize",2);u([v()],X.prototype,"autocorrect",2);u([v()],X.prototype,"autocomplete",2);u([v({type:Boolean})],X.prototype,"autofocus",2);u([v()],X.prototype,"enterkeyhint",2);u([v({type:Boolean,converter:{fromAttribute:e=>!(!e||e==="false"),toAttribute:e=>e?"true":"false"}})],X.prototype,"spellcheck",2);u([v()],X.prototype,"inputmode",2);u([q("disabled",{waitUntilFirstUpdate:!0})],X.prototype,"handleDisabledChange",1);u([q("step",{waitUntilFirstUpdate:!0})],X.prototype,"handleStepChange",1);u([q("value",{waitUntilFirstUpdate:!0})],X.prototype,"handleValueChange",1);X.define("sl-input");var vf=U`
  :host {
    --track-width: 2px;
    --track-color: rgb(128 128 128 / 25%);
    --indicator-color: var(--sl-color-primary-600);
    --speed: 2s;

    display: inline-flex;
    width: 1em;
    height: 1em;
    flex: none;
  }

  .spinner {
    flex: 1 1 auto;
    height: 100%;
    width: 100%;
  }

  .spinner__track,
  .spinner__indicator {
    fill: none;
    stroke-width: var(--track-width);
    r: calc(0.5em - var(--track-width) / 2);
    cx: 0.5em;
    cy: 0.5em;
    transform-origin: 50% 50%;
  }

  .spinner__track {
    stroke: var(--track-color);
    transform-origin: 0% 0%;
  }

  .spinner__indicator {
    stroke: var(--indicator-color);
    stroke-linecap: round;
    stroke-dasharray: 150% 75%;
    animation: spin var(--speed) linear infinite;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
      stroke-dasharray: 0.05em, 3em;
    }

    50% {
      transform: rotate(450deg);
      stroke-dasharray: 1.375em, 1.375em;
    }

    100% {
      transform: rotate(1080deg);
      stroke-dasharray: 0.05em, 3em;
    }
  }
`;var wh=class extends j{constructor(){super(...arguments),this.localize=new pe(this)}render(){return g`
      <svg part="base" class="spinner" role="progressbar" aria-label=${this.localize.term("loading")}>
        <circle class="spinner__track"></circle>
        <circle class="spinner__indicator"></circle>
      </svg>
    `}};wh.styles=[J,vf];var bf=U`
  :host {
    display: inline-block;
    position: relative;
    width: auto;
    cursor: pointer;
  }

  .button {
    display: inline-flex;
    align-items: stretch;
    justify-content: center;
    width: 100%;
    border-style: solid;
    border-width: var(--sl-input-border-width);
    font-family: var(--sl-input-font-family);
    font-weight: var(--sl-font-weight-semibold);
    text-decoration: none;
    user-select: none;
    -webkit-user-select: none;
    white-space: nowrap;
    vertical-align: middle;
    padding: 0;
    transition:
      var(--sl-transition-x-fast) background-color,
      var(--sl-transition-x-fast) color,
      var(--sl-transition-x-fast) border,
      var(--sl-transition-x-fast) box-shadow;
    cursor: inherit;
  }

  .button::-moz-focus-inner {
    border: 0;
  }

  .button:focus {
    outline: none;
  }

  .button:focus-visible {
    outline: var(--sl-focus-ring);
    outline-offset: var(--sl-focus-ring-offset);
  }

  .button--disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* When disabled, prevent mouse events from bubbling up from children */
  .button--disabled * {
    pointer-events: none;
  }

  .button__prefix,
  .button__suffix {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    pointer-events: none;
  }

  .button__label {
    display: inline-block;
  }

  .button__label::slotted(sl-icon) {
    vertical-align: -2px;
  }

  /*
   * Standard buttons
   */

  /* Default */
  .button--standard.button--default {
    background-color: var(--sl-color-neutral-0);
    border-color: var(--sl-input-border-color);
    color: var(--sl-color-neutral-700);
  }

  .button--standard.button--default:hover:not(.button--disabled) {
    background-color: var(--sl-color-primary-50);
    border-color: var(--sl-color-primary-300);
    color: var(--sl-color-primary-700);
  }

  .button--standard.button--default:active:not(.button--disabled) {
    background-color: var(--sl-color-primary-100);
    border-color: var(--sl-color-primary-400);
    color: var(--sl-color-primary-700);
  }

  /* Primary */
  .button--standard.button--primary {
    background-color: var(--sl-color-primary-600);
    border-color: var(--sl-color-primary-600);
    color: var(--sl-color-neutral-0);
  }

  .button--standard.button--primary:hover:not(.button--disabled) {
    background-color: var(--sl-color-primary-500);
    border-color: var(--sl-color-primary-500);
    color: var(--sl-color-neutral-0);
  }

  .button--standard.button--primary:active:not(.button--disabled) {
    background-color: var(--sl-color-primary-600);
    border-color: var(--sl-color-primary-600);
    color: var(--sl-color-neutral-0);
  }

  /* Success */
  .button--standard.button--success {
    background-color: var(--sl-color-success-600);
    border-color: var(--sl-color-success-600);
    color: var(--sl-color-neutral-0);
  }

  .button--standard.button--success:hover:not(.button--disabled) {
    background-color: var(--sl-color-success-500);
    border-color: var(--sl-color-success-500);
    color: var(--sl-color-neutral-0);
  }

  .button--standard.button--success:active:not(.button--disabled) {
    background-color: var(--sl-color-success-600);
    border-color: var(--sl-color-success-600);
    color: var(--sl-color-neutral-0);
  }

  /* Neutral */
  .button--standard.button--neutral {
    background-color: var(--sl-color-neutral-600);
    border-color: var(--sl-color-neutral-600);
    color: var(--sl-color-neutral-0);
  }

  .button--standard.button--neutral:hover:not(.button--disabled) {
    background-color: var(--sl-color-neutral-500);
    border-color: var(--sl-color-neutral-500);
    color: var(--sl-color-neutral-0);
  }

  .button--standard.button--neutral:active:not(.button--disabled) {
    background-color: var(--sl-color-neutral-600);
    border-color: var(--sl-color-neutral-600);
    color: var(--sl-color-neutral-0);
  }

  /* Warning */
  .button--standard.button--warning {
    background-color: var(--sl-color-warning-600);
    border-color: var(--sl-color-warning-600);
    color: var(--sl-color-neutral-0);
  }
  .button--standard.button--warning:hover:not(.button--disabled) {
    background-color: var(--sl-color-warning-500);
    border-color: var(--sl-color-warning-500);
    color: var(--sl-color-neutral-0);
  }

  .button--standard.button--warning:active:not(.button--disabled) {
    background-color: var(--sl-color-warning-600);
    border-color: var(--sl-color-warning-600);
    color: var(--sl-color-neutral-0);
  }

  /* Danger */
  .button--standard.button--danger {
    background-color: var(--sl-color-danger-600);
    border-color: var(--sl-color-danger-600);
    color: var(--sl-color-neutral-0);
  }

  .button--standard.button--danger:hover:not(.button--disabled) {
    background-color: var(--sl-color-danger-500);
    border-color: var(--sl-color-danger-500);
    color: var(--sl-color-neutral-0);
  }

  .button--standard.button--danger:active:not(.button--disabled) {
    background-color: var(--sl-color-danger-600);
    border-color: var(--sl-color-danger-600);
    color: var(--sl-color-neutral-0);
  }

  /*
   * Outline buttons
   */

  .button--outline {
    background: none;
    border: solid 1px;
  }

  /* Default */
  .button--outline.button--default {
    border-color: var(--sl-input-border-color);
    color: var(--sl-color-neutral-700);
  }

  .button--outline.button--default:hover:not(.button--disabled),
  .button--outline.button--default.button--checked:not(.button--disabled) {
    border-color: var(--sl-color-primary-600);
    background-color: var(--sl-color-primary-600);
    color: var(--sl-color-neutral-0);
  }

  .button--outline.button--default:active:not(.button--disabled) {
    border-color: var(--sl-color-primary-700);
    background-color: var(--sl-color-primary-700);
    color: var(--sl-color-neutral-0);
  }

  /* Primary */
  .button--outline.button--primary {
    border-color: var(--sl-color-primary-600);
    color: var(--sl-color-primary-600);
  }

  .button--outline.button--primary:hover:not(.button--disabled),
  .button--outline.button--primary.button--checked:not(.button--disabled) {
    background-color: var(--sl-color-primary-600);
    color: var(--sl-color-neutral-0);
  }

  .button--outline.button--primary:active:not(.button--disabled) {
    border-color: var(--sl-color-primary-700);
    background-color: var(--sl-color-primary-700);
    color: var(--sl-color-neutral-0);
  }

  /* Success */
  .button--outline.button--success {
    border-color: var(--sl-color-success-600);
    color: var(--sl-color-success-600);
  }

  .button--outline.button--success:hover:not(.button--disabled),
  .button--outline.button--success.button--checked:not(.button--disabled) {
    background-color: var(--sl-color-success-600);
    color: var(--sl-color-neutral-0);
  }

  .button--outline.button--success:active:not(.button--disabled) {
    border-color: var(--sl-color-success-700);
    background-color: var(--sl-color-success-700);
    color: var(--sl-color-neutral-0);
  }

  /* Neutral */
  .button--outline.button--neutral {
    border-color: var(--sl-color-neutral-600);
    color: var(--sl-color-neutral-600);
  }

  .button--outline.button--neutral:hover:not(.button--disabled),
  .button--outline.button--neutral.button--checked:not(.button--disabled) {
    background-color: var(--sl-color-neutral-600);
    color: var(--sl-color-neutral-0);
  }

  .button--outline.button--neutral:active:not(.button--disabled) {
    border-color: var(--sl-color-neutral-700);
    background-color: var(--sl-color-neutral-700);
    color: var(--sl-color-neutral-0);
  }

  /* Warning */
  .button--outline.button--warning {
    border-color: var(--sl-color-warning-600);
    color: var(--sl-color-warning-600);
  }

  .button--outline.button--warning:hover:not(.button--disabled),
  .button--outline.button--warning.button--checked:not(.button--disabled) {
    background-color: var(--sl-color-warning-600);
    color: var(--sl-color-neutral-0);
  }

  .button--outline.button--warning:active:not(.button--disabled) {
    border-color: var(--sl-color-warning-700);
    background-color: var(--sl-color-warning-700);
    color: var(--sl-color-neutral-0);
  }

  /* Danger */
  .button--outline.button--danger {
    border-color: var(--sl-color-danger-600);
    color: var(--sl-color-danger-600);
  }

  .button--outline.button--danger:hover:not(.button--disabled),
  .button--outline.button--danger.button--checked:not(.button--disabled) {
    background-color: var(--sl-color-danger-600);
    color: var(--sl-color-neutral-0);
  }

  .button--outline.button--danger:active:not(.button--disabled) {
    border-color: var(--sl-color-danger-700);
    background-color: var(--sl-color-danger-700);
    color: var(--sl-color-neutral-0);
  }

  @media (forced-colors: active) {
    .button.button--outline.button--checked:not(.button--disabled) {
      outline: solid 2px transparent;
    }
  }

  /*
   * Text buttons
   */

  .button--text {
    background-color: transparent;
    border-color: transparent;
    color: var(--sl-color-primary-600);
  }

  .button--text:hover:not(.button--disabled) {
    background-color: transparent;
    border-color: transparent;
    color: var(--sl-color-primary-500);
  }

  .button--text:focus-visible:not(.button--disabled) {
    background-color: transparent;
    border-color: transparent;
    color: var(--sl-color-primary-500);
  }

  .button--text:active:not(.button--disabled) {
    background-color: transparent;
    border-color: transparent;
    color: var(--sl-color-primary-700);
  }

  /*
   * Size modifiers
   */

  .button--small {
    height: auto;
    min-height: var(--sl-input-height-small);
    font-size: var(--sl-button-font-size-small);
    line-height: calc(var(--sl-input-height-small) - var(--sl-input-border-width) * 2);
    border-radius: var(--sl-input-border-radius-small);
  }

  .button--medium {
    height: auto;
    min-height: var(--sl-input-height-medium);
    font-size: var(--sl-button-font-size-medium);
    line-height: calc(var(--sl-input-height-medium) - var(--sl-input-border-width) * 2);
    border-radius: var(--sl-input-border-radius-medium);
  }

  .button--large {
    height: auto;
    min-height: var(--sl-input-height-large);
    font-size: var(--sl-button-font-size-large);
    line-height: calc(var(--sl-input-height-large) - var(--sl-input-border-width) * 2);
    border-radius: var(--sl-input-border-radius-large);
  }

  /*
   * Pill modifier
   */

  .button--pill.button--small {
    border-radius: var(--sl-input-height-small);
  }

  .button--pill.button--medium {
    border-radius: var(--sl-input-height-medium);
  }

  .button--pill.button--large {
    border-radius: var(--sl-input-height-large);
  }

  /*
   * Circle modifier
   */

  .button--circle {
    padding-left: 0;
    padding-right: 0;
  }

  .button--circle.button--small {
    width: var(--sl-input-height-small);
    border-radius: 50%;
  }

  .button--circle.button--medium {
    width: var(--sl-input-height-medium);
    border-radius: 50%;
  }

  .button--circle.button--large {
    width: var(--sl-input-height-large);
    border-radius: 50%;
  }

  .button--circle .button__prefix,
  .button--circle .button__suffix,
  .button--circle .button__caret {
    display: none;
  }

  /*
   * Caret modifier
   */

  .button--caret .button__suffix {
    display: none;
  }

  .button--caret .button__caret {
    height: auto;
  }

  /*
   * Loading modifier
   */

  .button--loading {
    position: relative;
    cursor: wait;
  }

  .button--loading .button__prefix,
  .button--loading .button__label,
  .button--loading .button__suffix,
  .button--loading .button__caret {
    visibility: hidden;
  }

  .button--loading sl-spinner {
    --indicator-color: currentColor;
    position: absolute;
    font-size: 1em;
    height: 1em;
    width: 1em;
    top: calc(50% - 0.5em);
    left: calc(50% - 0.5em);
  }

  /*
   * Badges
   */

  .button ::slotted(sl-badge) {
    position: absolute;
    top: 0;
    right: 0;
    translate: 50% -50%;
    pointer-events: none;
  }

  .button--rtl ::slotted(sl-badge) {
    right: auto;
    left: 0;
    translate: -50% -50%;
  }

  /*
   * Button spacing
   */

  .button--has-label.button--small .button__label {
    padding: 0 var(--sl-spacing-small);
  }

  .button--has-label.button--medium .button__label {
    padding: 0 var(--sl-spacing-medium);
  }

  .button--has-label.button--large .button__label {
    padding: 0 var(--sl-spacing-large);
  }

  .button--has-prefix.button--small {
    padding-inline-start: var(--sl-spacing-x-small);
  }

  .button--has-prefix.button--small .button__label {
    padding-inline-start: var(--sl-spacing-x-small);
  }

  .button--has-prefix.button--medium {
    padding-inline-start: var(--sl-spacing-small);
  }

  .button--has-prefix.button--medium .button__label {
    padding-inline-start: var(--sl-spacing-small);
  }

  .button--has-prefix.button--large {
    padding-inline-start: var(--sl-spacing-small);
  }

  .button--has-prefix.button--large .button__label {
    padding-inline-start: var(--sl-spacing-small);
  }

  .button--has-suffix.button--small,
  .button--caret.button--small {
    padding-inline-end: var(--sl-spacing-x-small);
  }

  .button--has-suffix.button--small .button__label,
  .button--caret.button--small .button__label {
    padding-inline-end: var(--sl-spacing-x-small);
  }

  .button--has-suffix.button--medium,
  .button--caret.button--medium {
    padding-inline-end: var(--sl-spacing-small);
  }

  .button--has-suffix.button--medium .button__label,
  .button--caret.button--medium .button__label {
    padding-inline-end: var(--sl-spacing-small);
  }

  .button--has-suffix.button--large,
  .button--caret.button--large {
    padding-inline-end: var(--sl-spacing-small);
  }

  .button--has-suffix.button--large .button__label,
  .button--caret.button--large .button__label {
    padding-inline-end: var(--sl-spacing-small);
  }

  /*
   * Button groups support a variety of button types (e.g. buttons with tooltips, buttons as dropdown triggers, etc.).
   * This means buttons aren't always direct descendants of the button group, thus we can't target them with the
   * ::slotted selector. To work around this, the button group component does some magic to add these special classes to
   * buttons and we style them here instead.
   */

  :host([data-sl-button-group__button--first]:not([data-sl-button-group__button--last])) .button {
    border-start-end-radius: 0;
    border-end-end-radius: 0;
  }

  :host([data-sl-button-group__button--inner]) .button {
    border-radius: 0;
  }

  :host([data-sl-button-group__button--last]:not([data-sl-button-group__button--first])) .button {
    border-start-start-radius: 0;
    border-end-start-radius: 0;
  }

  /* All except the first */
  :host([data-sl-button-group__button]:not([data-sl-button-group__button--first])) {
    margin-inline-start: calc(-1 * var(--sl-input-border-width));
  }

  /* Add a visual separator between solid buttons */
  :host(
      [data-sl-button-group__button]:not(
          [data-sl-button-group__button--first],
          [data-sl-button-group__button--radio],
          [variant='default']
        ):not(:hover)
    )
    .button:after {
    content: '';
    position: absolute;
    top: 0;
    inset-inline-start: 0;
    bottom: 0;
    border-left: solid 1px rgb(128 128 128 / 33%);
    mix-blend-mode: multiply;
  }

  /* Bump hovered, focused, and checked buttons up so their focus ring isn't clipped */
  :host([data-sl-button-group__button--hover]) {
    z-index: 1;
  }

  /* Focus and checked are always on top */
  :host([data-sl-button-group__button--focus]),
  :host([data-sl-button-group__button][checked]) {
    z-index: 2;
  }
`;var he=class extends j{constructor(){super(...arguments),this.formControlController=new Kt(this,{assumeInteractionOn:["click"]}),this.hasSlotController=new at(this,"[default]","prefix","suffix"),this.localize=new pe(this),this.hasFocus=!1,this.invalid=!1,this.title="",this.variant="default",this.size="medium",this.caret=!1,this.disabled=!1,this.loading=!1,this.outline=!1,this.pill=!1,this.circle=!1,this.type="button",this.name="",this.value="",this.href="",this.rel="noreferrer noopener"}get validity(){return this.isButton()?this.button.validity:wn}get validationMessage(){return this.isButton()?this.button.validationMessage:""}firstUpdated(){this.isButton()&&this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleClick(){this.type==="submit"&&this.formControlController.submit(this),this.type==="reset"&&this.formControlController.reset(this)}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}isButton(){return!this.href}isLink(){return!!this.href}handleDisabledChange(){this.isButton()&&this.formControlController.setValidity(this.disabled)}click(){this.button.click()}focus(e){this.button.focus(e)}blur(){this.button.blur()}checkValidity(){return this.isButton()?this.button.checkValidity():!0}getForm(){return this.formControlController.getForm()}reportValidity(){return this.isButton()?this.button.reportValidity():!0}setCustomValidity(e){this.isButton()&&(this.button.setCustomValidity(e),this.formControlController.updateValidity())}render(){let e=this.isLink(),t=e?Ms`a`:Ms`button`;return Bs`
      <${t}
        part="base"
        class=${Y({button:!0,"button--default":this.variant==="default","button--primary":this.variant==="primary","button--success":this.variant==="success","button--neutral":this.variant==="neutral","button--warning":this.variant==="warning","button--danger":this.variant==="danger","button--text":this.variant==="text","button--small":this.size==="small","button--medium":this.size==="medium","button--large":this.size==="large","button--caret":this.caret,"button--circle":this.circle,"button--disabled":this.disabled,"button--focused":this.hasFocus,"button--loading":this.loading,"button--standard":!this.outline,"button--outline":this.outline,"button--pill":this.pill,"button--rtl":this.localize.dir()==="rtl","button--has-label":this.hasSlotController.test("[default]"),"button--has-prefix":this.hasSlotController.test("prefix"),"button--has-suffix":this.hasSlotController.test("suffix")})}
        ?disabled=${H(e?void 0:this.disabled)}
        type=${H(e?void 0:this.type)}
        title=${this.title}
        name=${H(e?void 0:this.name)}
        value=${H(e?void 0:this.value)}
        href=${H(e&&!this.disabled?this.href:void 0)}
        target=${H(e?this.target:void 0)}
        download=${H(e?this.download:void 0)}
        rel=${H(e?this.rel:void 0)}
        role=${H(e?void 0:"button")}
        aria-disabled=${this.disabled?"true":"false"}
        tabindex=${this.disabled?"-1":"0"}
        @blur=${this.handleBlur}
        @focus=${this.handleFocus}
        @invalid=${this.isButton()?this.handleInvalid:null}
        @click=${this.handleClick}
      >
        <slot name="prefix" part="prefix" class="button__prefix"></slot>
        <slot part="label" class="button__label"></slot>
        <slot name="suffix" part="suffix" class="button__suffix"></slot>
        ${this.caret?Bs` <sl-icon part="caret" class="button__caret" library="system" name="caret"></sl-icon> `:""}
        ${this.loading?Bs`<sl-spinner part="spinner"></sl-spinner>`:""}
      </${t}>
    `}};he.styles=[J,bf];he.dependencies={"sl-icon":$e,"sl-spinner":wh};u([K(".button")],he.prototype,"button",2);u([le()],he.prototype,"hasFocus",2);u([le()],he.prototype,"invalid",2);u([v()],he.prototype,"title",2);u([v({reflect:!0})],he.prototype,"variant",2);u([v({reflect:!0})],he.prototype,"size",2);u([v({type:Boolean,reflect:!0})],he.prototype,"caret",2);u([v({type:Boolean,reflect:!0})],he.prototype,"disabled",2);u([v({type:Boolean,reflect:!0})],he.prototype,"loading",2);u([v({type:Boolean,reflect:!0})],he.prototype,"outline",2);u([v({type:Boolean,reflect:!0})],he.prototype,"pill",2);u([v({type:Boolean,reflect:!0})],he.prototype,"circle",2);u([v()],he.prototype,"type",2);u([v()],he.prototype,"name",2);u([v()],he.prototype,"value",2);u([v()],he.prototype,"href",2);u([v()],he.prototype,"target",2);u([v()],he.prototype,"rel",2);u([v()],he.prototype,"download",2);u([v()],he.prototype,"form",2);u([v({attribute:"formaction"})],he.prototype,"formAction",2);u([v({attribute:"formenctype"})],he.prototype,"formEnctype",2);u([v({attribute:"formmethod"})],he.prototype,"formMethod",2);u([v({attribute:"formnovalidate",type:Boolean})],he.prototype,"formNoValidate",2);u([v({attribute:"formtarget"})],he.prototype,"formTarget",2);u([q("disabled",{waitUntilFirstUpdate:!0})],he.prototype,"handleDisabledChange",1);he.define("sl-button");var yf=U`
  :host {
    display: inline-flex;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: max(12px, 0.75em);
    font-weight: var(--sl-font-weight-semibold);
    letter-spacing: var(--sl-letter-spacing-normal);
    line-height: 1;
    border-radius: var(--sl-border-radius-small);
    border: solid 1px var(--sl-color-neutral-0);
    white-space: nowrap;
    padding: 0.35em 0.6em;
    user-select: none;
    -webkit-user-select: none;
    cursor: inherit;
  }

  /* Variant modifiers */
  .badge--primary {
    background-color: var(--sl-color-primary-600);
    color: var(--sl-color-neutral-0);
  }

  .badge--success {
    background-color: var(--sl-color-success-600);
    color: var(--sl-color-neutral-0);
  }

  .badge--neutral {
    background-color: var(--sl-color-neutral-600);
    color: var(--sl-color-neutral-0);
  }

  .badge--warning {
    background-color: var(--sl-color-warning-600);
    color: var(--sl-color-neutral-0);
  }

  .badge--danger {
    background-color: var(--sl-color-danger-600);
    color: var(--sl-color-neutral-0);
  }

  /* Pill modifier */
  .badge--pill {
    border-radius: var(--sl-border-radius-pill);
  }

  /* Pulse modifier */
  .badge--pulse {
    animation: pulse 1.5s infinite;
  }

  .badge--pulse.badge--primary {
    --pulse-color: var(--sl-color-primary-600);
  }

  .badge--pulse.badge--success {
    --pulse-color: var(--sl-color-success-600);
  }

  .badge--pulse.badge--neutral {
    --pulse-color: var(--sl-color-neutral-600);
  }

  .badge--pulse.badge--warning {
    --pulse-color: var(--sl-color-warning-600);
  }

  .badge--pulse.badge--danger {
    --pulse-color: var(--sl-color-danger-600);
  }

  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 var(--pulse-color);
    }
    70% {
      box-shadow: 0 0 0 0.5rem transparent;
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
  }
`;var Fs=class extends j{constructor(){super(...arguments),this.variant="primary",this.pill=!1,this.pulse=!1}render(){return g`
      <span
        part="base"
        class=${Y({badge:!0,"badge--primary":this.variant==="primary","badge--success":this.variant==="success","badge--neutral":this.variant==="neutral","badge--warning":this.variant==="warning","badge--danger":this.variant==="danger","badge--pill":this.pill,"badge--pulse":this.pulse})}
        role="status"
      >
        <slot></slot>
      </span>
    `}};Fs.styles=[J,yf];u([v({reflect:!0})],Fs.prototype,"variant",2);u([v({type:Boolean,reflect:!0})],Fs.prototype,"pill",2);u([v({type:Boolean,reflect:!0})],Fs.prototype,"pulse",2);Fs.define("sl-badge");var wf=U`
  :host {
    --max-width: 20rem;
    --hide-delay: 0ms;
    --show-delay: 150ms;

    display: contents;
  }

  .tooltip {
    --arrow-size: var(--sl-tooltip-arrow-size);
    --arrow-color: var(--sl-tooltip-background-color);
  }

  .tooltip::part(popup) {
    z-index: var(--sl-z-index-tooltip);
  }

  .tooltip[placement^='top']::part(popup) {
    transform-origin: bottom;
  }

  .tooltip[placement^='bottom']::part(popup) {
    transform-origin: top;
  }

  .tooltip[placement^='left']::part(popup) {
    transform-origin: right;
  }

  .tooltip[placement^='right']::part(popup) {
    transform-origin: left;
  }

  .tooltip__body {
    display: block;
    width: max-content;
    max-width: var(--max-width);
    border-radius: var(--sl-tooltip-border-radius);
    background-color: var(--sl-tooltip-background-color);
    font-family: var(--sl-tooltip-font-family);
    font-size: var(--sl-tooltip-font-size);
    font-weight: var(--sl-tooltip-font-weight);
    line-height: var(--sl-tooltip-line-height);
    text-align: start;
    white-space: normal;
    color: var(--sl-tooltip-color);
    padding: var(--sl-tooltip-padding);
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
  }
`;var He=class extends j{constructor(){super(),this.localize=new pe(this),this.content="",this.placement="top",this.disabled=!1,this.distance=8,this.open=!1,this.skidding=0,this.trigger="hover focus",this.hoist=!1,this.handleBlur=()=>{this.hasTrigger("focus")&&this.hide()},this.handleClick=()=>{this.hasTrigger("click")&&(this.open?this.hide():this.show())},this.handleFocus=()=>{this.hasTrigger("focus")&&this.show()},this.handleDocumentKeyDown=e=>{e.key==="Escape"&&(e.stopPropagation(),this.hide())},this.handleMouseOver=()=>{if(this.hasTrigger("hover")){let e=Ql(getComputedStyle(this).getPropertyValue("--show-delay"));clearTimeout(this.hoverTimeout),this.hoverTimeout=window.setTimeout(()=>this.show(),e)}},this.handleMouseOut=()=>{if(this.hasTrigger("hover")){let e=Ql(getComputedStyle(this).getPropertyValue("--hide-delay"));clearTimeout(this.hoverTimeout),this.hoverTimeout=window.setTimeout(()=>this.hide(),e)}},this.addEventListener("blur",this.handleBlur,!0),this.addEventListener("focus",this.handleFocus,!0),this.addEventListener("click",this.handleClick),this.addEventListener("mouseover",this.handleMouseOver),this.addEventListener("mouseout",this.handleMouseOut)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this.closeWatcher)==null||e.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown)}firstUpdated(){this.body.hidden=!this.open,this.open&&(this.popup.active=!0,this.popup.reposition())}hasTrigger(e){return this.trigger.split(" ").includes(e)}async handleOpenChange(){var e,t;if(this.open){if(this.disabled)return;this.emit("sl-show"),"CloseWatcher"in window?((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>{this.hide()}):document.addEventListener("keydown",this.handleDocumentKeyDown),await Ue(this.body),this.body.hidden=!1,this.popup.active=!0;let{keyframes:i,options:s}=ze(this,"tooltip.show",{dir:this.localize.dir()});await Ne(this.popup.popup,i,s),this.popup.reposition(),this.emit("sl-after-show")}else{this.emit("sl-hide"),(t=this.closeWatcher)==null||t.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown),await Ue(this.body);let{keyframes:i,options:s}=ze(this,"tooltip.hide",{dir:this.localize.dir()});await Ne(this.popup.popup,i,s),this.popup.active=!1,this.body.hidden=!0,this.emit("sl-after-hide")}}async handleOptionsChange(){this.hasUpdated&&(await this.updateComplete,this.popup.reposition())}handleDisabledChange(){this.disabled&&this.open&&this.hide()}async show(){if(!this.open)return this.open=!0,tt(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,tt(this,"sl-after-hide")}render(){return g`
      <sl-popup
        part="base"
        exportparts="
          popup:base__popup,
          arrow:base__arrow
        "
        class=${Y({tooltip:!0,"tooltip--open":this.open})}
        placement=${this.placement}
        distance=${this.distance}
        skidding=${this.skidding}
        strategy=${this.hoist?"fixed":"absolute"}
        flip
        shift
        arrow
        hover-bridge
      >
        ${""}
        <slot slot="anchor" aria-describedby="tooltip"></slot>

        ${""}
        <div part="body" id="tooltip" class="tooltip__body" role="tooltip" aria-live=${this.open?"polite":"off"}>
          <slot name="content">${this.content}</slot>
        </div>
      </sl-popup>
    `}};He.styles=[J,wf];He.dependencies={"sl-popup":de};u([K("slot:not([name])")],He.prototype,"defaultSlot",2);u([K(".tooltip__body")],He.prototype,"body",2);u([K("sl-popup")],He.prototype,"popup",2);u([v()],He.prototype,"content",2);u([v()],He.prototype,"placement",2);u([v({type:Boolean,reflect:!0})],He.prototype,"disabled",2);u([v({type:Number})],He.prototype,"distance",2);u([v({type:Boolean,reflect:!0})],He.prototype,"open",2);u([v({type:Number})],He.prototype,"skidding",2);u([v()],He.prototype,"trigger",2);u([v({type:Boolean})],He.prototype,"hoist",2);u([q("open",{waitUntilFirstUpdate:!0})],He.prototype,"handleOpenChange",1);u([q(["content","distance","hoist","placement","skidding"])],He.prototype,"handleOptionsChange",1);u([q("disabled")],He.prototype,"handleDisabledChange",1);Ie("tooltip.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:150,easing:"ease"}});Ie("tooltip.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:150,easing:"ease"}});He.define("sl-tooltip");function*Sn(e=document.activeElement){e!=null&&(yield e,"shadowRoot"in e&&e.shadowRoot&&e.shadowRoot.mode!=="closed"&&(yield*cp(Sn(e.shadowRoot.activeElement))))}function Cf(){return[...Sn()].pop()}var Sf=new WeakMap;function xf(e){let t=Sf.get(e);return t||(t=window.getComputedStyle(e,null),Sf.set(e,t)),t}function by(e){if(typeof e.checkVisibility=="function")return e.checkVisibility({checkOpacity:!1,checkVisibilityCSS:!0});let t=xf(e);return t.visibility!=="hidden"&&t.display!=="none"}function yy(e){let t=xf(e),{overflowY:i,overflowX:s}=t;return i==="scroll"||s==="scroll"?!0:i!=="auto"||s!=="auto"?!1:e.scrollHeight>e.clientHeight&&i==="auto"||e.scrollWidth>e.clientWidth&&s==="auto"}function wy(e){let t=e.tagName.toLowerCase(),i=Number(e.getAttribute("tabindex"));if(e.hasAttribute("tabindex")&&(isNaN(i)||i<=-1)||e.hasAttribute("disabled")||e.closest("[inert]"))return!1;if(t==="input"&&e.getAttribute("type")==="radio"){let o=e.getRootNode(),n=`input[type='radio'][name="${e.getAttribute("name")}"]`,a=o.querySelector(`${n}:checked`);return a?a===e:o.querySelector(n)===e}return by(e)?(t==="audio"||t==="video")&&e.hasAttribute("controls")||e.hasAttribute("tabindex")||e.hasAttribute("contenteditable")&&e.getAttribute("contenteditable")!=="false"||["button","input","select","textarea","a","audio","video","summary","iframe"].includes(t)?!0:yy(e):!1}function Sy(e,t){var i;return((i=e.getRootNode({composed:!0}))==null?void 0:i.host)!==t}function Sh(e){let t=new WeakMap,i=[];function s(r){if(r instanceof Element){if(r.hasAttribute("inert")||r.closest("[inert]")||t.has(r))return;t.set(r,!0),!i.includes(r)&&wy(r)&&i.push(r),r instanceof HTMLSlotElement&&Sy(r,e)&&r.assignedElements({flatten:!0}).forEach(o=>{s(o)}),r.shadowRoot!==null&&r.shadowRoot.mode==="open"&&s(r.shadowRoot)}for(let o of r.children)s(o)}return s(e),i.sort((r,o)=>{let n=Number(r.getAttribute("tabindex"))||0;return(Number(o.getAttribute("tabindex"))||0)-n})}var Jr=[],kf=class{constructor(e){this.tabDirection="forward",this.handleFocusIn=()=>{this.isActive()&&this.checkFocus()},this.handleKeyDown=t=>{var i;if(t.key!=="Tab"||this.isExternalActivated||!this.isActive())return;let s=Cf();if(this.previousFocus=s,this.previousFocus&&this.possiblyHasTabbableChildren(this.previousFocus))return;t.shiftKey?this.tabDirection="backward":this.tabDirection="forward";let r=Sh(this.element),o=r.findIndex(a=>a===s);this.previousFocus=this.currentFocus;let n=this.tabDirection==="forward"?1:-1;for(;;){o+n>=r.length?o=0:o+n<0?o=r.length-1:o+=n,this.previousFocus=this.currentFocus;let a=r[o];if(this.tabDirection==="backward"&&this.previousFocus&&this.possiblyHasTabbableChildren(this.previousFocus)||a&&this.possiblyHasTabbableChildren(a))return;t.preventDefault(),this.currentFocus=a,(i=this.currentFocus)==null||i.focus({preventScroll:!1});let h=[...Sn()];if(h.includes(this.currentFocus)||!h.includes(this.previousFocus))break}setTimeout(()=>this.checkFocus())},this.handleKeyUp=()=>{this.tabDirection="forward"},this.element=e,this.elementsWithTabbableControls=["iframe"]}activate(){Jr.push(this.element),document.addEventListener("focusin",this.handleFocusIn),document.addEventListener("keydown",this.handleKeyDown),document.addEventListener("keyup",this.handleKeyUp)}deactivate(){Jr=Jr.filter(e=>e!==this.element),this.currentFocus=null,document.removeEventListener("focusin",this.handleFocusIn),document.removeEventListener("keydown",this.handleKeyDown),document.removeEventListener("keyup",this.handleKeyUp)}isActive(){return Jr[Jr.length-1]===this.element}activateExternal(){this.isExternalActivated=!0}deactivateExternal(){this.isExternalActivated=!1}checkFocus(){if(this.isActive()&&!this.isExternalActivated){let e=Sh(this.element);if(!this.element.matches(":focus-within")){let t=e[0],i=e[e.length-1],s=this.tabDirection==="forward"?t:i;typeof s?.focus=="function"&&(this.currentFocus=s,s.focus({preventScroll:!1}))}}}possiblyHasTabbableChildren(e){return this.elementsWithTabbableControls.includes(e.tagName.toLowerCase())||e.hasAttribute("controls")}};var Ef=U`
  :host {
    --width: 31rem;
    --header-spacing: var(--sl-spacing-large);
    --body-spacing: var(--sl-spacing-large);
    --footer-spacing: var(--sl-spacing-large);

    display: contents;
  }

  .dialog {
    display: flex;
    align-items: center;
    justify-content: center;
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: var(--sl-z-index-dialog);
  }

  .dialog__panel {
    display: flex;
    flex-direction: column;
    z-index: 2;
    width: var(--width);
    max-width: calc(100% - var(--sl-spacing-2x-large));
    max-height: calc(100% - var(--sl-spacing-2x-large));
    background-color: var(--sl-panel-background-color);
    border-radius: var(--sl-border-radius-medium);
    box-shadow: var(--sl-shadow-x-large);
  }

  .dialog__panel:focus {
    outline: none;
  }

  /* Ensure there's enough vertical padding for phones that don't update vh when chrome appears (e.g. iPhone) */
  @media screen and (max-width: 420px) {
    .dialog__panel {
      max-height: 80vh;
    }
  }

  .dialog--open .dialog__panel {
    display: flex;
    opacity: 1;
  }

  .dialog__header {
    flex: 0 0 auto;
    display: flex;
  }

  .dialog__title {
    flex: 1 1 auto;
    font: inherit;
    font-size: var(--sl-font-size-large);
    line-height: var(--sl-line-height-dense);
    padding: var(--header-spacing);
    margin: 0;
  }

  .dialog__header-actions {
    flex-shrink: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: end;
    gap: var(--sl-spacing-2x-small);
    padding: 0 var(--header-spacing);
  }

  .dialog__header-actions sl-icon-button,
  .dialog__header-actions ::slotted(sl-icon-button) {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    font-size: var(--sl-font-size-medium);
  }

  .dialog__body {
    flex: 1 1 auto;
    display: block;
    padding: var(--body-spacing);
    overflow: auto;
    -webkit-overflow-scrolling: touch;
  }

  .dialog__footer {
    flex: 0 0 auto;
    text-align: right;
    padding: var(--footer-spacing);
  }

  .dialog__footer ::slotted(sl-button:not(:first-of-type)) {
    margin-inline-start: var(--sl-spacing-x-small);
  }

  .dialog:not(.dialog--has-footer) .dialog__footer {
    display: none;
  }

  .dialog__overlay {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    background-color: var(--sl-overlay-background-color);
  }

  @media (forced-colors: active) {
    .dialog__panel {
      border: solid 1px var(--sl-color-neutral-0);
    }
  }
`;var Cn=e=>{var t;let{activeElement:i}=document;i&&e.contains(i)&&((t=document.activeElement)==null||t.blur())};var Rt=class extends j{constructor(){super(...arguments),this.hasSlotController=new at(this,"footer"),this.localize=new pe(this),this.modal=new kf(this),this.open=!1,this.label="",this.noHeader=!1,this.handleDocumentKeyDown=e=>{e.key==="Escape"&&this.modal.isActive()&&this.open&&(e.stopPropagation(),this.requestClose("keyboard"))}}firstUpdated(){this.dialog.hidden=!this.open,this.open&&(this.addOpenListeners(),this.modal.activate(),dh(this))}disconnectedCallback(){super.disconnectedCallback(),this.modal.deactivate(),uh(this),this.removeOpenListeners()}requestClose(e){if(this.emit("sl-request-close",{cancelable:!0,detail:{source:e}}).defaultPrevented){let i=ze(this,"dialog.denyClose",{dir:this.localize.dir()});Ne(this.panel,i.keyframes,i.options);return}this.hide()}addOpenListeners(){var e;"CloseWatcher"in window?((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>this.requestClose("keyboard")):document.addEventListener("keydown",this.handleDocumentKeyDown)}removeOpenListeners(){var e;(e=this.closeWatcher)==null||e.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown)}async handleOpenChange(){if(this.open){this.emit("sl-show"),this.addOpenListeners(),this.originalTrigger=document.activeElement,this.modal.activate(),dh(this);let e=this.querySelector("[autofocus]");e&&e.removeAttribute("autofocus"),await Promise.all([Ue(this.dialog),Ue(this.overlay)]),this.dialog.hidden=!1,requestAnimationFrame(()=>{this.emit("sl-initial-focus",{cancelable:!0}).defaultPrevented||(e?e.focus({preventScroll:!0}):this.panel.focus({preventScroll:!0})),e&&e.setAttribute("autofocus","")});let t=ze(this,"dialog.show",{dir:this.localize.dir()}),i=ze(this,"dialog.overlay.show",{dir:this.localize.dir()});await Promise.all([Ne(this.panel,t.keyframes,t.options),Ne(this.overlay,i.keyframes,i.options)]),this.emit("sl-after-show")}else{Cn(this),this.emit("sl-hide"),this.removeOpenListeners(),this.modal.deactivate(),await Promise.all([Ue(this.dialog),Ue(this.overlay)]);let e=ze(this,"dialog.hide",{dir:this.localize.dir()}),t=ze(this,"dialog.overlay.hide",{dir:this.localize.dir()});await Promise.all([Ne(this.overlay,t.keyframes,t.options).then(()=>{this.overlay.hidden=!0}),Ne(this.panel,e.keyframes,e.options).then(()=>{this.panel.hidden=!0})]),this.dialog.hidden=!0,this.overlay.hidden=!1,this.panel.hidden=!1,uh(this);let i=this.originalTrigger;typeof i?.focus=="function"&&setTimeout(()=>i.focus()),this.emit("sl-after-hide")}}async show(){if(!this.open)return this.open=!0,tt(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,tt(this,"sl-after-hide")}render(){return g`
      <div
        part="base"
        class=${Y({dialog:!0,"dialog--open":this.open,"dialog--has-footer":this.hasSlotController.test("footer")})}
      >
        <div part="overlay" class="dialog__overlay" @click=${()=>this.requestClose("overlay")} tabindex="-1"></div>

        <div
          part="panel"
          class="dialog__panel"
          role="dialog"
          aria-modal="true"
          aria-hidden=${this.open?"false":"true"}
          aria-label=${H(this.noHeader?this.label:void 0)}
          aria-labelledby=${H(this.noHeader?void 0:"title")}
          tabindex="-1"
        >
          ${this.noHeader?"":g`
                <header part="header" class="dialog__header">
                  <h2 part="title" class="dialog__title" id="title">
                    <slot name="label"> ${this.label.length>0?this.label:"\uFEFF"} </slot>
                  </h2>
                  <div part="header-actions" class="dialog__header-actions">
                    <slot name="header-actions"></slot>
                    <sl-icon-button
                      part="close-button"
                      exportparts="base:close-button__base"
                      class="dialog__close"
                      name="x-lg"
                      label=${this.localize.term("close")}
                      library="system"
                      @click="${()=>this.requestClose("close-button")}"
                    ></sl-icon-button>
                  </div>
                </header>
              `}
          ${""}
          <div part="body" class="dialog__body" tabindex="-1"><slot></slot></div>

          <footer part="footer" class="dialog__footer">
            <slot name="footer"></slot>
          </footer>
        </div>
      </div>
    `}};Rt.styles=[J,Ef];Rt.dependencies={"sl-icon-button":Se};u([K(".dialog")],Rt.prototype,"dialog",2);u([K(".dialog__panel")],Rt.prototype,"panel",2);u([K(".dialog__overlay")],Rt.prototype,"overlay",2);u([v({type:Boolean,reflect:!0})],Rt.prototype,"open",2);u([v({reflect:!0})],Rt.prototype,"label",2);u([v({attribute:"no-header",type:Boolean,reflect:!0})],Rt.prototype,"noHeader",2);u([q("open",{waitUntilFirstUpdate:!0})],Rt.prototype,"handleOpenChange",1);Ie("dialog.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:250,easing:"ease"}});Ie("dialog.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:250,easing:"ease"}});Ie("dialog.denyClose",{keyframes:[{scale:1},{scale:1.02},{scale:1}],options:{duration:250}});Ie("dialog.overlay.show",{keyframes:[{opacity:0},{opacity:1}],options:{duration:250}});Ie("dialog.overlay.hide",{keyframes:[{opacity:1},{opacity:0}],options:{duration:250}});Rt.define("sl-dialog");var Af=U`
  :host {
    --indicator-color: var(--sl-color-primary-600);
    --track-color: var(--sl-color-neutral-200);
    --track-width: 2px;

    display: block;
  }

  .tab-group {
    display: flex;
    border-radius: 0;
  }

  .tab-group__tabs {
    display: flex;
    position: relative;
  }

  .tab-group__indicator {
    position: absolute;
    transition:
      var(--sl-transition-fast) translate ease,
      var(--sl-transition-fast) width ease;
  }

  .tab-group--has-scroll-controls .tab-group__nav-container {
    position: relative;
    padding: 0 var(--sl-spacing-x-large);
  }

  .tab-group--has-scroll-controls .tab-group__scroll-button--start--hidden,
  .tab-group--has-scroll-controls .tab-group__scroll-button--end--hidden {
    visibility: hidden;
  }

  .tab-group__body {
    display: block;
    overflow: auto;
  }

  .tab-group__scroll-button {
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    top: 0;
    bottom: 0;
    width: var(--sl-spacing-x-large);
  }

  .tab-group__scroll-button--start {
    left: 0;
  }

  .tab-group__scroll-button--end {
    right: 0;
  }

  .tab-group--rtl .tab-group__scroll-button--start {
    left: auto;
    right: 0;
  }

  .tab-group--rtl .tab-group__scroll-button--end {
    left: 0;
    right: auto;
  }

  /*
   * Top
   */

  .tab-group--top {
    flex-direction: column;
  }

  .tab-group--top .tab-group__nav-container {
    order: 1;
  }

  .tab-group--top .tab-group__nav {
    display: flex;
    overflow-x: auto;

    /* Hide scrollbar in Firefox */
    scrollbar-width: none;
  }

  /* Hide scrollbar in Chrome/Safari */
  .tab-group--top .tab-group__nav::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  .tab-group--top .tab-group__tabs {
    flex: 1 1 auto;
    position: relative;
    flex-direction: row;
    border-bottom: solid var(--track-width) var(--track-color);
  }

  .tab-group--top .tab-group__indicator {
    bottom: calc(-1 * var(--track-width));
    border-bottom: solid var(--track-width) var(--indicator-color);
  }

  .tab-group--top .tab-group__body {
    order: 2;
  }

  .tab-group--top ::slotted(sl-tab-panel) {
    --padding: var(--sl-spacing-medium) 0;
  }

  /*
   * Bottom
   */

  .tab-group--bottom {
    flex-direction: column;
  }

  .tab-group--bottom .tab-group__nav-container {
    order: 2;
  }

  .tab-group--bottom .tab-group__nav {
    display: flex;
    overflow-x: auto;

    /* Hide scrollbar in Firefox */
    scrollbar-width: none;
  }

  /* Hide scrollbar in Chrome/Safari */
  .tab-group--bottom .tab-group__nav::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  .tab-group--bottom .tab-group__tabs {
    flex: 1 1 auto;
    position: relative;
    flex-direction: row;
    border-top: solid var(--track-width) var(--track-color);
  }

  .tab-group--bottom .tab-group__indicator {
    top: calc(-1 * var(--track-width));
    border-top: solid var(--track-width) var(--indicator-color);
  }

  .tab-group--bottom .tab-group__body {
    order: 1;
  }

  .tab-group--bottom ::slotted(sl-tab-panel) {
    --padding: var(--sl-spacing-medium) 0;
  }

  /*
   * Start
   */

  .tab-group--start {
    flex-direction: row;
  }

  .tab-group--start .tab-group__nav-container {
    order: 1;
  }

  .tab-group--start .tab-group__tabs {
    flex: 0 0 auto;
    flex-direction: column;
    border-inline-end: solid var(--track-width) var(--track-color);
  }

  .tab-group--start .tab-group__indicator {
    right: calc(-1 * var(--track-width));
    border-right: solid var(--track-width) var(--indicator-color);
  }

  .tab-group--start.tab-group--rtl .tab-group__indicator {
    right: auto;
    left: calc(-1 * var(--track-width));
  }

  .tab-group--start .tab-group__body {
    flex: 1 1 auto;
    order: 2;
  }

  .tab-group--start ::slotted(sl-tab-panel) {
    --padding: 0 var(--sl-spacing-medium);
  }

  /*
   * End
   */

  .tab-group--end {
    flex-direction: row;
  }

  .tab-group--end .tab-group__nav-container {
    order: 2;
  }

  .tab-group--end .tab-group__tabs {
    flex: 0 0 auto;
    flex-direction: column;
    border-left: solid var(--track-width) var(--track-color);
  }

  .tab-group--end .tab-group__indicator {
    left: calc(-1 * var(--track-width));
    border-inline-start: solid var(--track-width) var(--indicator-color);
  }

  .tab-group--end.tab-group--rtl .tab-group__indicator {
    right: calc(-1 * var(--track-width));
    left: auto;
  }

  .tab-group--end .tab-group__body {
    flex: 1 1 auto;
    order: 1;
  }

  .tab-group--end ::slotted(sl-tab-panel) {
    --padding: 0 var(--sl-spacing-medium);
  }
`;var $f=U`
  :host {
    display: contents;
  }
`;var Zr=class extends j{constructor(){super(...arguments),this.observedElements=[],this.disabled=!1}connectedCallback(){super.connectedCallback(),this.resizeObserver=new ResizeObserver(e=>{this.emit("sl-resize",{detail:{entries:e}})}),this.disabled||this.startObserver()}disconnectedCallback(){super.disconnectedCallback(),this.stopObserver()}handleSlotChange(){this.disabled||this.startObserver()}startObserver(){let e=this.shadowRoot.querySelector("slot");if(e!==null){let t=e.assignedElements({flatten:!0});this.observedElements.forEach(i=>this.resizeObserver.unobserve(i)),this.observedElements=[],t.forEach(i=>{this.resizeObserver.observe(i),this.observedElements.push(i)})}}stopObserver(){this.resizeObserver.disconnect()}handleDisabledChange(){this.disabled?this.stopObserver():this.startObserver()}render(){return g` <slot @slotchange=${this.handleSlotChange}></slot> `}};Zr.styles=[J,$f];u([v({type:Boolean,reflect:!0})],Zr.prototype,"disabled",2);u([q("disabled",{waitUntilFirstUpdate:!0})],Zr.prototype,"handleDisabledChange",1);var Fe=class extends j{constructor(){super(...arguments),this.tabs=[],this.focusableTabs=[],this.panels=[],this.localize=new pe(this),this.hasScrollControls=!1,this.shouldHideScrollStartButton=!1,this.shouldHideScrollEndButton=!1,this.placement="top",this.activation="auto",this.noScrollControls=!1,this.fixedScrollControls=!1,this.scrollOffset=1}connectedCallback(){let e=Promise.all([customElements.whenDefined("sl-tab"),customElements.whenDefined("sl-tab-panel")]);super.connectedCallback(),this.resizeObserver=new ResizeObserver(()=>{this.repositionIndicator(),this.updateScrollControls()}),this.mutationObserver=new MutationObserver(t=>{let i=t.filter(({target:s})=>{if(s===this)return!0;if(s.closest("sl-tab-group")!==this)return!1;let r=s.tagName.toLowerCase();return r==="sl-tab"||r==="sl-tab-panel"});if(i.length!==0){if(i.some(s=>!["aria-labelledby","aria-controls"].includes(s.attributeName))&&setTimeout(()=>this.setAriaLabels()),i.some(s=>s.attributeName==="disabled"))this.syncTabsAndPanels();else if(i.some(s=>s.attributeName==="active")){let r=i.filter(o=>o.attributeName==="active"&&o.target.tagName.toLowerCase()==="sl-tab").map(o=>o.target).find(o=>o.active);r&&this.setActiveTab(r)}}}),this.updateComplete.then(()=>{this.syncTabsAndPanels(),this.mutationObserver.observe(this,{attributes:!0,attributeFilter:["active","disabled","name","panel"],childList:!0,subtree:!0}),this.resizeObserver.observe(this.nav),e.then(()=>{new IntersectionObserver((i,s)=>{var r;i[0].intersectionRatio>0&&(this.setAriaLabels(),this.setActiveTab((r=this.getActiveTab())!=null?r:this.tabs[0],{emitEvents:!1}),s.unobserve(i[0].target))}).observe(this.tabGroup)})})}disconnectedCallback(){var e,t;super.disconnectedCallback(),(e=this.mutationObserver)==null||e.disconnect(),this.nav&&((t=this.resizeObserver)==null||t.unobserve(this.nav))}getAllTabs(){return this.shadowRoot.querySelector('slot[name="nav"]').assignedElements()}getAllPanels(){return[...this.body.assignedElements()].filter(e=>e.tagName.toLowerCase()==="sl-tab-panel")}getActiveTab(){return this.tabs.find(e=>e.active)}handleClick(e){let i=e.target.closest("sl-tab");i?.closest("sl-tab-group")===this&&i!==null&&this.setActiveTab(i,{scrollBehavior:"smooth"})}handleKeyDown(e){let i=e.target.closest("sl-tab");if(i?.closest("sl-tab-group")===this&&(["Enter"," "].includes(e.key)&&i!==null&&(this.setActiveTab(i,{scrollBehavior:"smooth"}),e.preventDefault()),["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key))){let r=this.tabs.find(a=>a.matches(":focus")),o=this.localize.dir()==="rtl",n=null;if(r?.tagName.toLowerCase()==="sl-tab"){if(e.key==="Home")n=this.focusableTabs[0];else if(e.key==="End")n=this.focusableTabs[this.focusableTabs.length-1];else if(["top","bottom"].includes(this.placement)&&e.key===(o?"ArrowRight":"ArrowLeft")||["start","end"].includes(this.placement)&&e.key==="ArrowUp"){let a=this.tabs.findIndex(h=>h===r);n=this.findNextFocusableTab(a,"backward")}else if(["top","bottom"].includes(this.placement)&&e.key===(o?"ArrowLeft":"ArrowRight")||["start","end"].includes(this.placement)&&e.key==="ArrowDown"){let a=this.tabs.findIndex(h=>h===r);n=this.findNextFocusableTab(a,"forward")}if(!n)return;n.tabIndex=0,n.focus({preventScroll:!0}),this.activation==="auto"?this.setActiveTab(n,{scrollBehavior:"smooth"}):this.tabs.forEach(a=>{a.tabIndex=a===n?0:-1}),["top","bottom"].includes(this.placement)&&Fr(n,this.nav,"horizontal"),e.preventDefault()}}}handleScrollToStart(){this.nav.scroll({left:this.localize.dir()==="rtl"?this.nav.scrollLeft+this.nav.clientWidth:this.nav.scrollLeft-this.nav.clientWidth,behavior:"smooth"})}handleScrollToEnd(){this.nav.scroll({left:this.localize.dir()==="rtl"?this.nav.scrollLeft-this.nav.clientWidth:this.nav.scrollLeft+this.nav.clientWidth,behavior:"smooth"})}setActiveTab(e,t){if(t=Xe({emitEvents:!0,scrollBehavior:"auto"},t),e!==this.activeTab&&!e.disabled){let i=this.activeTab;this.activeTab=e,this.tabs.forEach(s=>{s.active=s===this.activeTab,s.tabIndex=s===this.activeTab?0:-1}),this.panels.forEach(s=>{var r;return s.active=s.name===((r=this.activeTab)==null?void 0:r.panel)}),this.syncIndicator(),["top","bottom"].includes(this.placement)&&Fr(this.activeTab,this.nav,"horizontal",t.scrollBehavior),t.emitEvents&&(i&&this.emit("sl-tab-hide",{detail:{name:i.panel}}),this.emit("sl-tab-show",{detail:{name:this.activeTab.panel}}))}}setAriaLabels(){this.tabs.forEach(e=>{let t=this.panels.find(i=>i.name===e.panel);t&&(e.setAttribute("aria-controls",t.getAttribute("id")),t.setAttribute("aria-labelledby",e.getAttribute("id")))})}repositionIndicator(){let e=this.getActiveTab();if(!e)return;let t=e.clientWidth,i=e.clientHeight,s=this.localize.dir()==="rtl",r=this.getAllTabs(),n=r.slice(0,r.indexOf(e)).reduce((a,h)=>({left:a.left+h.clientWidth,top:a.top+h.clientHeight}),{left:0,top:0});switch(this.placement){case"top":case"bottom":this.indicator.style.width=`${t}px`,this.indicator.style.height="auto",this.indicator.style.translate=s?`${-1*n.left}px`:`${n.left}px`;break;case"start":case"end":this.indicator.style.width="auto",this.indicator.style.height=`${i}px`,this.indicator.style.translate=`0 ${n.top}px`;break}}syncTabsAndPanels(){this.tabs=this.getAllTabs(),this.focusableTabs=this.tabs.filter(e=>!e.disabled),this.panels=this.getAllPanels(),this.syncIndicator(),this.updateComplete.then(()=>this.updateScrollControls())}findNextFocusableTab(e,t){let i=null,s=t==="forward"?1:-1,r=e+s;for(;e<this.tabs.length;){if(i=this.tabs[r]||null,i===null){t==="forward"?i=this.focusableTabs[0]:i=this.focusableTabs[this.focusableTabs.length-1];break}if(!i.disabled)break;r+=s}return i}updateScrollButtons(){this.hasScrollControls&&!this.fixedScrollControls&&(this.shouldHideScrollStartButton=this.scrollFromStart()<=this.scrollOffset,this.shouldHideScrollEndButton=this.isScrolledToEnd())}isScrolledToEnd(){return this.scrollFromStart()+this.nav.clientWidth>=this.nav.scrollWidth-this.scrollOffset}scrollFromStart(){return this.localize.dir()==="rtl"?-this.nav.scrollLeft:this.nav.scrollLeft}updateScrollControls(){this.noScrollControls?this.hasScrollControls=!1:this.hasScrollControls=["top","bottom"].includes(this.placement)&&this.nav.scrollWidth>this.nav.clientWidth+1,this.updateScrollButtons()}syncIndicator(){this.getActiveTab()?(this.indicator.style.display="block",this.repositionIndicator()):this.indicator.style.display="none"}show(e){let t=this.tabs.find(i=>i.panel===e);t&&this.setActiveTab(t,{scrollBehavior:"smooth"})}render(){let e=this.localize.dir()==="rtl";return g`
      <div
        part="base"
        class=${Y({"tab-group":!0,"tab-group--top":this.placement==="top","tab-group--bottom":this.placement==="bottom","tab-group--start":this.placement==="start","tab-group--end":this.placement==="end","tab-group--rtl":this.localize.dir()==="rtl","tab-group--has-scroll-controls":this.hasScrollControls})}
        @click=${this.handleClick}
        @keydown=${this.handleKeyDown}
      >
        <div class="tab-group__nav-container" part="nav">
          ${this.hasScrollControls?g`
                <sl-icon-button
                  part="scroll-button scroll-button--start"
                  exportparts="base:scroll-button__base"
                  class=${Y({"tab-group__scroll-button":!0,"tab-group__scroll-button--start":!0,"tab-group__scroll-button--start--hidden":this.shouldHideScrollStartButton})}
                  name=${e?"chevron-right":"chevron-left"}
                  library="system"
                  tabindex="-1"
                  aria-hidden="true"
                  label=${this.localize.term("scrollToStart")}
                  @click=${this.handleScrollToStart}
                ></sl-icon-button>
              `:""}

          <div class="tab-group__nav" @scrollend=${this.updateScrollButtons}>
            <div part="tabs" class="tab-group__tabs" role="tablist">
              <div part="active-tab-indicator" class="tab-group__indicator"></div>
              <sl-resize-observer @sl-resize=${this.syncIndicator}>
                <slot name="nav" @slotchange=${this.syncTabsAndPanels}></slot>
              </sl-resize-observer>
            </div>
          </div>

          ${this.hasScrollControls?g`
                <sl-icon-button
                  part="scroll-button scroll-button--end"
                  exportparts="base:scroll-button__base"
                  class=${Y({"tab-group__scroll-button":!0,"tab-group__scroll-button--end":!0,"tab-group__scroll-button--end--hidden":this.shouldHideScrollEndButton})}
                  name=${e?"chevron-left":"chevron-right"}
                  library="system"
                  tabindex="-1"
                  aria-hidden="true"
                  label=${this.localize.term("scrollToEnd")}
                  @click=${this.handleScrollToEnd}
                ></sl-icon-button>
              `:""}
        </div>

        <slot part="body" class="tab-group__body" @slotchange=${this.syncTabsAndPanels}></slot>
      </div>
    `}};Fe.styles=[J,Af];Fe.dependencies={"sl-icon-button":Se,"sl-resize-observer":Zr};u([K(".tab-group")],Fe.prototype,"tabGroup",2);u([K(".tab-group__body")],Fe.prototype,"body",2);u([K(".tab-group__nav")],Fe.prototype,"nav",2);u([K(".tab-group__indicator")],Fe.prototype,"indicator",2);u([le()],Fe.prototype,"hasScrollControls",2);u([le()],Fe.prototype,"shouldHideScrollStartButton",2);u([le()],Fe.prototype,"shouldHideScrollEndButton",2);u([v()],Fe.prototype,"placement",2);u([v()],Fe.prototype,"activation",2);u([v({attribute:"no-scroll-controls",type:Boolean})],Fe.prototype,"noScrollControls",2);u([v({attribute:"fixed-scroll-controls",type:Boolean})],Fe.prototype,"fixedScrollControls",2);u([kp({passive:!0})],Fe.prototype,"updateScrollButtons",1);u([q("noScrollControls",{waitUntilFirstUpdate:!0})],Fe.prototype,"updateScrollControls",1);u([q("placement",{waitUntilFirstUpdate:!0})],Fe.prototype,"syncIndicator",1);Fe.define("sl-tab-group");var Cy=(e,t)=>{let i=0;return function(...s){window.clearTimeout(i),i=window.setTimeout(()=>{e.call(this,...s)},t)}},Tf=(e,t,i)=>{let s=e[t];e[t]=function(...r){s.call(this,...r),i.call(this,s,...r)}};(()=>{if(typeof window>"u")return;if(!("onscrollend"in window)){let t=new Set,i=new WeakMap,s=o=>{for(let n of o.changedTouches)t.add(n.identifier)},r=o=>{for(let n of o.changedTouches)t.delete(n.identifier)};document.addEventListener("touchstart",s,!0),document.addEventListener("touchend",r,!0),document.addEventListener("touchcancel",r,!0),Tf(EventTarget.prototype,"addEventListener",function(o,n){if(n!=="scrollend")return;let a=Cy(()=>{t.size?a():this.dispatchEvent(new Event("scrollend"))},100);o.call(this,"scroll",a,{passive:!0}),i.set(this,a)}),Tf(EventTarget.prototype,"removeEventListener",function(o,n){if(n!=="scrollend")return;let a=i.get(this);a&&o.call(this,"scroll",a,{passive:!0})})}})();var Lf=U`
  :host {
    display: inline-block;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    font-family: var(--sl-font-sans);
    font-size: var(--sl-font-size-small);
    font-weight: var(--sl-font-weight-semibold);
    border-radius: var(--sl-border-radius-medium);
    color: var(--sl-color-neutral-600);
    padding: var(--sl-spacing-medium) var(--sl-spacing-large);
    white-space: nowrap;
    user-select: none;
    -webkit-user-select: none;
    cursor: pointer;
    transition:
      var(--transition-speed) box-shadow,
      var(--transition-speed) color;
  }

  .tab:hover:not(.tab--disabled) {
    color: var(--sl-color-primary-600);
  }

  :host(:focus) {
    outline: transparent;
  }

  :host(:focus-visible) {
    color: var(--sl-color-primary-600);
    outline: var(--sl-focus-ring);
    outline-offset: calc(-1 * var(--sl-focus-ring-width) - var(--sl-focus-ring-offset));
  }

  .tab.tab--active:not(.tab--disabled) {
    color: var(--sl-color-primary-600);
  }

  .tab.tab--closable {
    padding-inline-end: var(--sl-spacing-small);
  }

  .tab.tab--disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tab__close-button {
    font-size: var(--sl-font-size-small);
    margin-inline-start: var(--sl-spacing-small);
  }

  .tab__close-button::part(base) {
    padding: var(--sl-spacing-3x-small);
  }

  @media (forced-colors: active) {
    .tab.tab--active:not(.tab--disabled) {
      outline: solid 1px transparent;
      outline-offset: -3px;
    }
  }
`;var xy=0,xt=class extends j{constructor(){super(...arguments),this.localize=new pe(this),this.attrId=++xy,this.componentId=`sl-tab-${this.attrId}`,this.panel="",this.active=!1,this.closable=!1,this.disabled=!1,this.tabIndex=0}connectedCallback(){super.connectedCallback(),this.setAttribute("role","tab")}handleCloseClick(e){e.stopPropagation(),this.emit("sl-close")}handleActiveChange(){this.setAttribute("aria-selected",this.active?"true":"false")}handleDisabledChange(){this.setAttribute("aria-disabled",this.disabled?"true":"false"),this.disabled&&!this.active?this.tabIndex=-1:this.tabIndex=0}render(){return this.id=this.id.length>0?this.id:this.componentId,g`
      <div
        part="base"
        class=${Y({tab:!0,"tab--active":this.active,"tab--closable":this.closable,"tab--disabled":this.disabled})}
      >
        <slot></slot>
        ${this.closable?g`
              <sl-icon-button
                part="close-button"
                exportparts="base:close-button__base"
                name="x-lg"
                library="system"
                label=${this.localize.term("close")}
                class="tab__close-button"
                @click=${this.handleCloseClick}
                tabindex="-1"
              ></sl-icon-button>
            `:""}
      </div>
    `}};xt.styles=[J,Lf];xt.dependencies={"sl-icon-button":Se};u([K(".tab")],xt.prototype,"tab",2);u([v({reflect:!0})],xt.prototype,"panel",2);u([v({type:Boolean,reflect:!0})],xt.prototype,"active",2);u([v({type:Boolean,reflect:!0})],xt.prototype,"closable",2);u([v({type:Boolean,reflect:!0})],xt.prototype,"disabled",2);u([v({type:Number,reflect:!0})],xt.prototype,"tabIndex",2);u([q("active")],xt.prototype,"handleActiveChange",1);u([q("disabled")],xt.prototype,"handleDisabledChange",1);xt.define("sl-tab");var Df=U`
  :host {
    --padding: 0;

    display: none;
  }

  :host([active]) {
    display: block;
  }

  .tab-panel {
    display: block;
    padding: var(--padding);
  }
`;var ky=0,Ws=class extends j{constructor(){super(...arguments),this.attrId=++ky,this.componentId=`sl-tab-panel-${this.attrId}`,this.name="",this.active=!1}connectedCallback(){super.connectedCallback(),this.id=this.id.length>0?this.id:this.componentId,this.setAttribute("role","tabpanel")}handleActiveChange(){this.setAttribute("aria-hidden",this.active?"false":"true")}render(){return g`
      <slot
        part="base"
        class=${Y({"tab-panel":!0,"tab-panel--active":this.active})}
      ></slot>
    `}};Ws.styles=[J,Df];u([v({reflect:!0})],Ws.prototype,"name",2);u([v({type:Boolean,reflect:!0})],Ws.prototype,"active",2);u([q("active")],Ws.prototype,"handleActiveChange",1);Ws.define("sl-tab-panel");var Rf=U`
  :host {
    display: inline-block;
  }

  :host([size='small']) {
    --height: var(--sl-toggle-size-small);
    --thumb-size: calc(var(--sl-toggle-size-small) + 4px);
    --width: calc(var(--height) * 2);

    font-size: var(--sl-input-font-size-small);
  }

  :host([size='medium']) {
    --height: var(--sl-toggle-size-medium);
    --thumb-size: calc(var(--sl-toggle-size-medium) + 4px);
    --width: calc(var(--height) * 2);

    font-size: var(--sl-input-font-size-medium);
  }

  :host([size='large']) {
    --height: var(--sl-toggle-size-large);
    --thumb-size: calc(var(--sl-toggle-size-large) + 4px);
    --width: calc(var(--height) * 2);

    font-size: var(--sl-input-font-size-large);
  }

  .switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    font-family: var(--sl-input-font-family);
    font-size: inherit;
    font-weight: var(--sl-input-font-weight);
    color: var(--sl-input-label-color);
    vertical-align: middle;
    cursor: pointer;
  }

  .switch__control {
    flex: 0 0 auto;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--width);
    height: var(--height);
    background-color: var(--sl-color-neutral-400);
    border: solid var(--sl-input-border-width) var(--sl-color-neutral-400);
    border-radius: var(--height);
    transition:
      var(--sl-transition-fast) border-color,
      var(--sl-transition-fast) background-color;
  }

  .switch__control .switch__thumb {
    width: var(--thumb-size);
    height: var(--thumb-size);
    background-color: var(--sl-color-neutral-0);
    border-radius: 50%;
    border: solid var(--sl-input-border-width) var(--sl-color-neutral-400);
    translate: calc((var(--width) - var(--height)) / -2);
    transition:
      var(--sl-transition-fast) translate ease,
      var(--sl-transition-fast) background-color,
      var(--sl-transition-fast) border-color,
      var(--sl-transition-fast) box-shadow;
  }

  .switch__input {
    position: absolute;
    opacity: 0;
    padding: 0;
    margin: 0;
    pointer-events: none;
  }

  /* Hover */
  .switch:not(.switch--checked):not(.switch--disabled) .switch__control:hover {
    background-color: var(--sl-color-neutral-400);
    border-color: var(--sl-color-neutral-400);
  }

  .switch:not(.switch--checked):not(.switch--disabled) .switch__control:hover .switch__thumb {
    background-color: var(--sl-color-neutral-0);
    border-color: var(--sl-color-neutral-400);
  }

  /* Focus */
  .switch:not(.switch--checked):not(.switch--disabled) .switch__input:focus-visible ~ .switch__control {
    background-color: var(--sl-color-neutral-400);
    border-color: var(--sl-color-neutral-400);
  }

  .switch:not(.switch--checked):not(.switch--disabled) .switch__input:focus-visible ~ .switch__control .switch__thumb {
    background-color: var(--sl-color-neutral-0);
    border-color: var(--sl-color-primary-600);
    outline: var(--sl-focus-ring);
    outline-offset: var(--sl-focus-ring-offset);
  }

  /* Checked */
  .switch--checked .switch__control {
    background-color: var(--sl-color-primary-600);
    border-color: var(--sl-color-primary-600);
  }

  .switch--checked .switch__control .switch__thumb {
    background-color: var(--sl-color-neutral-0);
    border-color: var(--sl-color-primary-600);
    translate: calc((var(--width) - var(--height)) / 2);
  }

  /* Checked + hover */
  .switch.switch--checked:not(.switch--disabled) .switch__control:hover {
    background-color: var(--sl-color-primary-600);
    border-color: var(--sl-color-primary-600);
  }

  .switch.switch--checked:not(.switch--disabled) .switch__control:hover .switch__thumb {
    background-color: var(--sl-color-neutral-0);
    border-color: var(--sl-color-primary-600);
  }

  /* Checked + focus */
  .switch.switch--checked:not(.switch--disabled) .switch__input:focus-visible ~ .switch__control {
    background-color: var(--sl-color-primary-600);
    border-color: var(--sl-color-primary-600);
  }

  .switch.switch--checked:not(.switch--disabled) .switch__input:focus-visible ~ .switch__control .switch__thumb {
    background-color: var(--sl-color-neutral-0);
    border-color: var(--sl-color-primary-600);
    outline: var(--sl-focus-ring);
    outline-offset: var(--sl-focus-ring-offset);
  }

  /* Disabled */
  .switch--disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .switch__label {
    display: inline-block;
    line-height: var(--height);
    margin-inline-start: 0.5em;
    user-select: none;
    -webkit-user-select: none;
  }

  :host([required]) .switch__label::after {
    content: var(--sl-input-required-content);
    color: var(--sl-input-required-content-color);
    margin-inline-start: var(--sl-input-required-content-offset);
  }

  @media (forced-colors: active) {
    .switch.switch--checked:not(.switch--disabled) .switch__control:hover .switch__thumb,
    .switch--checked .switch__control .switch__thumb {
      background-color: ButtonText;
    }
  }
`;var qe=class extends j{constructor(){super(...arguments),this.formControlController=new Kt(this,{value:e=>e.checked?e.value||"on":void 0,defaultValue:e=>e.defaultChecked,setValue:(e,t)=>e.checked=t}),this.hasSlotController=new at(this,"help-text"),this.hasFocus=!1,this.title="",this.name="",this.size="medium",this.disabled=!1,this.checked=!1,this.defaultChecked=!1,this.form="",this.required=!1,this.helpText=""}get validity(){return this.input.validity}get validationMessage(){return this.input.validationMessage}firstUpdated(){this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleInput(){this.emit("sl-input")}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleClick(){this.checked=!this.checked,this.emit("sl-change")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleKeyDown(e){e.key==="ArrowLeft"&&(e.preventDefault(),this.checked=!1,this.emit("sl-change"),this.emit("sl-input")),e.key==="ArrowRight"&&(e.preventDefault(),this.checked=!0,this.emit("sl-change"),this.emit("sl-input"))}handleCheckedChange(){this.input.checked=this.checked,this.formControlController.updateValidity()}handleDisabledChange(){this.formControlController.setValidity(!0)}click(){this.input.click()}focus(e){this.input.focus(e)}blur(){this.input.blur()}checkValidity(){return this.input.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.input.reportValidity()}setCustomValidity(e){this.input.setCustomValidity(e),this.formControlController.updateValidity()}render(){let e=this.hasSlotController.test("help-text"),t=this.helpText?!0:!!e;return g`
      <div
        class=${Y({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-help-text":t})}
      >
        <label
          part="base"
          class=${Y({switch:!0,"switch--checked":this.checked,"switch--disabled":this.disabled,"switch--focused":this.hasFocus,"switch--small":this.size==="small","switch--medium":this.size==="medium","switch--large":this.size==="large"})}
        >
          <input
            class="switch__input"
            type="checkbox"
            title=${this.title}
            name=${this.name}
            value=${H(this.value)}
            .checked=${Hs(this.checked)}
            .disabled=${this.disabled}
            .required=${this.required}
            role="switch"
            aria-checked=${this.checked?"true":"false"}
            aria-describedby="help-text"
            @click=${this.handleClick}
            @input=${this.handleInput}
            @invalid=${this.handleInvalid}
            @blur=${this.handleBlur}
            @focus=${this.handleFocus}
            @keydown=${this.handleKeyDown}
          />

          <span part="control" class="switch__control">
            <span part="thumb" class="switch__thumb"></span>
          </span>

          <div part="label" class="switch__label">
            <slot></slot>
          </div>
        </label>

        <div
          aria-hidden=${t?"false":"true"}
          class="form-control__help-text"
          id="help-text"
          part="form-control-help-text"
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `}};qe.styles=[J,Ti,Rf];u([K('input[type="checkbox"]')],qe.prototype,"input",2);u([le()],qe.prototype,"hasFocus",2);u([v()],qe.prototype,"title",2);u([v()],qe.prototype,"name",2);u([v()],qe.prototype,"value",2);u([v({reflect:!0})],qe.prototype,"size",2);u([v({type:Boolean,reflect:!0})],qe.prototype,"disabled",2);u([v({type:Boolean,reflect:!0})],qe.prototype,"checked",2);u([Ns("checked")],qe.prototype,"defaultChecked",2);u([v({reflect:!0})],qe.prototype,"form",2);u([v({type:Boolean,reflect:!0})],qe.prototype,"required",2);u([v({attribute:"help-text"})],qe.prototype,"helpText",2);u([q("checked",{waitUntilFirstUpdate:!0})],qe.prototype,"handleCheckedChange",1);u([q("disabled",{waitUntilFirstUpdate:!0})],qe.prototype,"handleDisabledChange",1);qe.define("sl-switch");var Mf=U`
  :host {
    display: contents;

    /* For better DX, we'll reset the margin here so the base part can inherit it */
    margin: 0;
  }

  .alert {
    position: relative;
    display: flex;
    align-items: stretch;
    background-color: var(--sl-panel-background-color);
    border: solid var(--sl-panel-border-width) var(--sl-panel-border-color);
    border-top-width: calc(var(--sl-panel-border-width) * 3);
    border-radius: var(--sl-border-radius-medium);
    font-family: var(--sl-font-sans);
    font-size: var(--sl-font-size-small);
    font-weight: var(--sl-font-weight-normal);
    line-height: 1.6;
    color: var(--sl-color-neutral-700);
    margin: inherit;
    overflow: hidden;
  }

  .alert:not(.alert--has-icon) .alert__icon,
  .alert:not(.alert--closable) .alert__close-button {
    display: none;
  }

  .alert__icon {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    font-size: var(--sl-font-size-large);
    padding-inline-start: var(--sl-spacing-large);
  }

  .alert--has-countdown {
    border-bottom: none;
  }

  .alert--primary {
    border-top-color: var(--sl-color-primary-600);
  }

  .alert--primary .alert__icon {
    color: var(--sl-color-primary-600);
  }

  .alert--success {
    border-top-color: var(--sl-color-success-600);
  }

  .alert--success .alert__icon {
    color: var(--sl-color-success-600);
  }

  .alert--neutral {
    border-top-color: var(--sl-color-neutral-600);
  }

  .alert--neutral .alert__icon {
    color: var(--sl-color-neutral-600);
  }

  .alert--warning {
    border-top-color: var(--sl-color-warning-600);
  }

  .alert--warning .alert__icon {
    color: var(--sl-color-warning-600);
  }

  .alert--danger {
    border-top-color: var(--sl-color-danger-600);
  }

  .alert--danger .alert__icon {
    color: var(--sl-color-danger-600);
  }

  .alert__message {
    flex: 1 1 auto;
    display: block;
    padding: var(--sl-spacing-large);
    overflow: hidden;
  }

  .alert__close-button {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    font-size: var(--sl-font-size-medium);
    margin-inline-end: var(--sl-spacing-medium);
    align-self: center;
  }

  .alert__countdown {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: calc(var(--sl-panel-border-width) * 3);
    background-color: var(--sl-panel-border-color);
    display: flex;
  }

  .alert__countdown--ltr {
    justify-content: flex-end;
  }

  .alert__countdown .alert__countdown-elapsed {
    height: 100%;
    width: 0;
  }

  .alert--primary .alert__countdown-elapsed {
    background-color: var(--sl-color-primary-600);
  }

  .alert--success .alert__countdown-elapsed {
    background-color: var(--sl-color-success-600);
  }

  .alert--neutral .alert__countdown-elapsed {
    background-color: var(--sl-color-neutral-600);
  }

  .alert--warning .alert__countdown-elapsed {
    background-color: var(--sl-color-warning-600);
  }

  .alert--danger .alert__countdown-elapsed {
    background-color: var(--sl-color-danger-600);
  }

  .alert__timer {
    display: none;
  }
`;var mt=class hs extends j{constructor(){super(...arguments),this.hasSlotController=new at(this,"icon","suffix"),this.localize=new pe(this),this.open=!1,this.closable=!1,this.variant="primary",this.duration=1/0,this.remainingTime=this.duration}static get toastStack(){return this.currentToastStack||(this.currentToastStack=Object.assign(document.createElement("div"),{className:"sl-toast-stack"})),this.currentToastStack}firstUpdated(){this.base.hidden=!this.open}restartAutoHide(){this.handleCountdownChange(),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval),this.open&&this.duration<1/0&&(this.autoHideTimeout=window.setTimeout(()=>this.hide(),this.duration),this.remainingTime=this.duration,this.remainingTimeInterval=window.setInterval(()=>{this.remainingTime-=100},100))}pauseAutoHide(){var t;(t=this.countdownAnimation)==null||t.pause(),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval)}resumeAutoHide(){var t;this.duration<1/0&&(this.autoHideTimeout=window.setTimeout(()=>this.hide(),this.remainingTime),this.remainingTimeInterval=window.setInterval(()=>{this.remainingTime-=100},100),(t=this.countdownAnimation)==null||t.play())}handleCountdownChange(){if(this.open&&this.duration<1/0&&this.countdown){let{countdownElement:t}=this,i="100%",s="0";this.countdownAnimation=t.animate([{width:i},{width:s}],{duration:this.duration,easing:"linear"})}}handleCloseClick(){this.hide()}async handleOpenChange(){if(this.open){this.emit("sl-show"),this.duration<1/0&&this.restartAutoHide(),await Ue(this.base),this.base.hidden=!1;let{keyframes:t,options:i}=ze(this,"alert.show",{dir:this.localize.dir()});await Ne(this.base,t,i),this.emit("sl-after-show")}else{Cn(this),this.emit("sl-hide"),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval),await Ue(this.base);let{keyframes:t,options:i}=ze(this,"alert.hide",{dir:this.localize.dir()});await Ne(this.base,t,i),this.base.hidden=!0,this.emit("sl-after-hide")}}handleDurationChange(){this.restartAutoHide()}async show(){if(!this.open)return this.open=!0,tt(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,tt(this,"sl-after-hide")}async toast(){return new Promise(t=>{this.handleCountdownChange(),hs.toastStack.parentElement===null&&document.body.append(hs.toastStack),hs.toastStack.appendChild(this),requestAnimationFrame(()=>{this.clientWidth,this.show()}),this.addEventListener("sl-after-hide",()=>{hs.toastStack.removeChild(this),t(),hs.toastStack.querySelector("sl-alert")===null&&hs.toastStack.remove()},{once:!0})})}render(){return g`
      <div
        part="base"
        class=${Y({alert:!0,"alert--open":this.open,"alert--closable":this.closable,"alert--has-countdown":!!this.countdown,"alert--has-icon":this.hasSlotController.test("icon"),"alert--primary":this.variant==="primary","alert--success":this.variant==="success","alert--neutral":this.variant==="neutral","alert--warning":this.variant==="warning","alert--danger":this.variant==="danger"})}
        role="alert"
        aria-hidden=${this.open?"false":"true"}
        @mouseenter=${this.pauseAutoHide}
        @mouseleave=${this.resumeAutoHide}
      >
        <div part="icon" class="alert__icon">
          <slot name="icon"></slot>
        </div>

        <div part="message" class="alert__message" aria-live="polite">
          <slot></slot>
        </div>

        ${this.closable?g`
              <sl-icon-button
                part="close-button"
                exportparts="base:close-button__base"
                class="alert__close-button"
                name="x-lg"
                library="system"
                label=${this.localize.term("close")}
                @click=${this.handleCloseClick}
              ></sl-icon-button>
            `:""}

        <div role="timer" class="alert__timer">${this.remainingTime}</div>

        ${this.countdown?g`
              <div
                class=${Y({alert__countdown:!0,"alert__countdown--ltr":this.countdown==="ltr"})}
              >
                <div class="alert__countdown-elapsed"></div>
              </div>
            `:""}
      </div>
    `}};mt.styles=[J,Mf];mt.dependencies={"sl-icon-button":Se};u([K('[part~="base"]')],mt.prototype,"base",2);u([K(".alert__countdown-elapsed")],mt.prototype,"countdownElement",2);u([v({type:Boolean,reflect:!0})],mt.prototype,"open",2);u([v({type:Boolean,reflect:!0})],mt.prototype,"closable",2);u([v({reflect:!0})],mt.prototype,"variant",2);u([v({type:Number})],mt.prototype,"duration",2);u([v({type:String,reflect:!0})],mt.prototype,"countdown",2);u([le()],mt.prototype,"remainingTime",2);u([q("open",{waitUntilFirstUpdate:!0})],mt.prototype,"handleOpenChange",1);u([q("duration")],mt.prototype,"handleDurationChange",1);var Bf=mt;Ie("alert.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:250,easing:"ease"}});Ie("alert.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:250,easing:"ease"}});Bf.define("sl-alert");var Pf=U`
  :host {
    display: block;
  }

  .textarea {
    display: grid;
    align-items: center;
    position: relative;
    width: 100%;
    font-family: var(--sl-input-font-family);
    font-weight: var(--sl-input-font-weight);
    line-height: var(--sl-line-height-normal);
    letter-spacing: var(--sl-input-letter-spacing);
    vertical-align: middle;
    transition:
      var(--sl-transition-fast) color,
      var(--sl-transition-fast) border,
      var(--sl-transition-fast) box-shadow,
      var(--sl-transition-fast) background-color;
    cursor: text;
  }

  /* Standard textareas */
  .textarea--standard {
    background-color: var(--sl-input-background-color);
    border: solid var(--sl-input-border-width) var(--sl-input-border-color);
  }

  .textarea--standard:hover:not(.textarea--disabled) {
    background-color: var(--sl-input-background-color-hover);
    border-color: var(--sl-input-border-color-hover);
  }
  .textarea--standard:hover:not(.textarea--disabled) .textarea__control {
    color: var(--sl-input-color-hover);
  }

  .textarea--standard.textarea--focused:not(.textarea--disabled) {
    background-color: var(--sl-input-background-color-focus);
    border-color: var(--sl-input-border-color-focus);
    color: var(--sl-input-color-focus);
    box-shadow: 0 0 0 var(--sl-focus-ring-width) var(--sl-input-focus-ring-color);
  }

  .textarea--standard.textarea--focused:not(.textarea--disabled) .textarea__control {
    color: var(--sl-input-color-focus);
  }

  .textarea--standard.textarea--disabled {
    background-color: var(--sl-input-background-color-disabled);
    border-color: var(--sl-input-border-color-disabled);
    opacity: 0.5;
    cursor: not-allowed;
  }

  .textarea__control,
  .textarea__size-adjuster {
    grid-area: 1 / 1 / 2 / 2;
  }

  .textarea__size-adjuster {
    visibility: hidden;
    pointer-events: none;
    opacity: 0;
  }

  .textarea--standard.textarea--disabled .textarea__control {
    color: var(--sl-input-color-disabled);
  }

  .textarea--standard.textarea--disabled .textarea__control::placeholder {
    color: var(--sl-input-placeholder-color-disabled);
  }

  /* Filled textareas */
  .textarea--filled {
    border: none;
    background-color: var(--sl-input-filled-background-color);
    color: var(--sl-input-color);
  }

  .textarea--filled:hover:not(.textarea--disabled) {
    background-color: var(--sl-input-filled-background-color-hover);
  }

  .textarea--filled.textarea--focused:not(.textarea--disabled) {
    background-color: var(--sl-input-filled-background-color-focus);
    outline: var(--sl-focus-ring);
    outline-offset: var(--sl-focus-ring-offset);
  }

  .textarea--filled.textarea--disabled {
    background-color: var(--sl-input-filled-background-color-disabled);
    opacity: 0.5;
    cursor: not-allowed;
  }

  .textarea__control {
    font-family: inherit;
    font-size: inherit;
    font-weight: inherit;
    line-height: 1.4;
    color: var(--sl-input-color);
    border: none;
    background: none;
    box-shadow: none;
    cursor: inherit;
    -webkit-appearance: none;
  }

  .textarea__control::-webkit-search-decoration,
  .textarea__control::-webkit-search-cancel-button,
  .textarea__control::-webkit-search-results-button,
  .textarea__control::-webkit-search-results-decoration {
    -webkit-appearance: none;
  }

  .textarea__control::placeholder {
    color: var(--sl-input-placeholder-color);
    user-select: none;
    -webkit-user-select: none;
  }

  .textarea__control:focus {
    outline: none;
  }

  /*
   * Size modifiers
   */

  .textarea--small {
    border-radius: var(--sl-input-border-radius-small);
    font-size: var(--sl-input-font-size-small);
  }

  .textarea--small .textarea__control {
    padding: 0.5em var(--sl-input-spacing-small);
  }

  .textarea--medium {
    border-radius: var(--sl-input-border-radius-medium);
    font-size: var(--sl-input-font-size-medium);
  }

  .textarea--medium .textarea__control {
    padding: 0.5em var(--sl-input-spacing-medium);
  }

  .textarea--large {
    border-radius: var(--sl-input-border-radius-large);
    font-size: var(--sl-input-font-size-large);
  }

  .textarea--large .textarea__control {
    padding: 0.5em var(--sl-input-spacing-large);
  }

  /*
   * Resize types
   */

  .textarea--resize-none .textarea__control {
    resize: none;
  }

  .textarea--resize-vertical .textarea__control {
    resize: vertical;
  }

  .textarea--resize-auto .textarea__control {
    height: auto;
    resize: none;
    overflow-y: hidden;
  }
`;var se=class extends j{constructor(){super(...arguments),this.formControlController=new Kt(this,{assumeInteractionOn:["sl-blur","sl-input"]}),this.hasSlotController=new at(this,"help-text","label"),this.hasFocus=!1,this.title="",this.name="",this.value="",this.size="medium",this.filled=!1,this.label="",this.helpText="",this.placeholder="",this.rows=4,this.resize="vertical",this.disabled=!1,this.readonly=!1,this.form="",this.required=!1,this.spellcheck=!0,this.defaultValue=""}get validity(){return this.input.validity}get validationMessage(){return this.input.validationMessage}connectedCallback(){super.connectedCallback(),this.resizeObserver=new ResizeObserver(()=>this.setTextareaHeight()),this.updateComplete.then(()=>{this.setTextareaHeight(),this.resizeObserver.observe(this.input)})}firstUpdated(){this.formControlController.updateValidity()}disconnectedCallback(){var e;super.disconnectedCallback(),this.input&&((e=this.resizeObserver)==null||e.unobserve(this.input))}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleChange(){this.value=this.input.value,this.setTextareaHeight(),this.emit("sl-change")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleInput(){this.value=this.input.value,this.emit("sl-input")}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}setTextareaHeight(){this.resize==="auto"?(this.sizeAdjuster.style.height=`${this.input.clientHeight}px`,this.input.style.height="auto",this.input.style.height=`${this.input.scrollHeight}px`):this.input.style.height=""}handleDisabledChange(){this.formControlController.setValidity(this.disabled)}handleRowsChange(){this.setTextareaHeight()}async handleValueChange(){await this.updateComplete,this.formControlController.updateValidity(),this.setTextareaHeight()}focus(e){this.input.focus(e)}blur(){this.input.blur()}select(){this.input.select()}scrollPosition(e){if(e){typeof e.top=="number"&&(this.input.scrollTop=e.top),typeof e.left=="number"&&(this.input.scrollLeft=e.left);return}return{top:this.input.scrollTop,left:this.input.scrollTop}}setSelectionRange(e,t,i="none"){this.input.setSelectionRange(e,t,i)}setRangeText(e,t,i,s="preserve"){let r=t??this.input.selectionStart,o=i??this.input.selectionEnd;this.input.setRangeText(e,r,o,s),this.value!==this.input.value&&(this.value=this.input.value,this.setTextareaHeight())}checkValidity(){return this.input.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.input.reportValidity()}setCustomValidity(e){this.input.setCustomValidity(e),this.formControlController.updateValidity()}render(){let e=this.hasSlotController.test("label"),t=this.hasSlotController.test("help-text"),i=this.label?!0:!!e,s=this.helpText?!0:!!t;return g`
      <div
        part="form-control"
        class=${Y({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-label":i,"form-control--has-help-text":s})}
      >
        <label
          part="form-control-label"
          class="form-control__label"
          for="input"
          aria-hidden=${i?"false":"true"}
        >
          <slot name="label">${this.label}</slot>
        </label>

        <div part="form-control-input" class="form-control-input">
          <div
            part="base"
            class=${Y({textarea:!0,"textarea--small":this.size==="small","textarea--medium":this.size==="medium","textarea--large":this.size==="large","textarea--standard":!this.filled,"textarea--filled":this.filled,"textarea--disabled":this.disabled,"textarea--focused":this.hasFocus,"textarea--empty":!this.value,"textarea--resize-none":this.resize==="none","textarea--resize-vertical":this.resize==="vertical","textarea--resize-auto":this.resize==="auto"})}
          >
            <textarea
              part="textarea"
              id="input"
              class="textarea__control"
              title=${this.title}
              name=${H(this.name)}
              .value=${Hs(this.value)}
              ?disabled=${this.disabled}
              ?readonly=${this.readonly}
              ?required=${this.required}
              placeholder=${H(this.placeholder)}
              rows=${H(this.rows)}
              minlength=${H(this.minlength)}
              maxlength=${H(this.maxlength)}
              autocapitalize=${H(this.autocapitalize)}
              autocorrect=${H(this.autocorrect)}
              ?autofocus=${this.autofocus}
              spellcheck=${H(this.spellcheck)}
              enterkeyhint=${H(this.enterkeyhint)}
              inputmode=${H(this.inputmode)}
              aria-describedby="help-text"
              @change=${this.handleChange}
              @input=${this.handleInput}
              @invalid=${this.handleInvalid}
              @focus=${this.handleFocus}
              @blur=${this.handleBlur}
            ></textarea>
            <!-- This "adjuster" exists to prevent layout shifting. https://github.com/shoelace-style/shoelace/issues/2180 -->
            <div part="textarea-adjuster" class="textarea__size-adjuster" ?hidden=${this.resize!=="auto"}></div>
          </div>
        </div>

        <div
          part="form-control-help-text"
          id="help-text"
          class="form-control__help-text"
          aria-hidden=${s?"false":"true"}
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `}};se.styles=[J,Ti,Pf];u([K(".textarea__control")],se.prototype,"input",2);u([K(".textarea__size-adjuster")],se.prototype,"sizeAdjuster",2);u([le()],se.prototype,"hasFocus",2);u([v()],se.prototype,"title",2);u([v()],se.prototype,"name",2);u([v()],se.prototype,"value",2);u([v({reflect:!0})],se.prototype,"size",2);u([v({type:Boolean,reflect:!0})],se.prototype,"filled",2);u([v()],se.prototype,"label",2);u([v({attribute:"help-text"})],se.prototype,"helpText",2);u([v()],se.prototype,"placeholder",2);u([v({type:Number})],se.prototype,"rows",2);u([v()],se.prototype,"resize",2);u([v({type:Boolean,reflect:!0})],se.prototype,"disabled",2);u([v({type:Boolean,reflect:!0})],se.prototype,"readonly",2);u([v({reflect:!0})],se.prototype,"form",2);u([v({type:Boolean,reflect:!0})],se.prototype,"required",2);u([v({type:Number})],se.prototype,"minlength",2);u([v({type:Number})],se.prototype,"maxlength",2);u([v()],se.prototype,"autocapitalize",2);u([v()],se.prototype,"autocorrect",2);u([v()],se.prototype,"autocomplete",2);u([v({type:Boolean})],se.prototype,"autofocus",2);u([v()],se.prototype,"enterkeyhint",2);u([v({type:Boolean,converter:{fromAttribute:e=>!(!e||e==="false"),toAttribute:e=>e?"true":"false"}})],se.prototype,"spellcheck",2);u([v()],se.prototype,"inputmode",2);u([Ns()],se.prototype,"defaultValue",2);u([q("disabled",{waitUntilFirstUpdate:!0})],se.prototype,"handleDisabledChange",1);u([q("rows",{waitUntilFirstUpdate:!0})],se.prototype,"handleRowsChange",1);u([q("value",{waitUntilFirstUpdate:!0})],se.prototype,"handleValueChange",1);se.define("sl-textarea");var oe=Fh(),Q=Uh(),An=Xu({store:oe,ws:Q,getSettings:()=>ds}),F=Nn(location.hash),zf=Q.getState(),Ch=!0,st="*",xh="",ds={},cs=null,kt=null,Vs=null,$n=!1,Tn=!1,eo=null,Qr={},xn=new Set,Nf="all",Hf="all",kn=null,En=null,Ff=new Map,kh=new Map;function Ey(e,t){kh.set(e,t)}function Eh(e){e&&Q.send("list-beads-by-run",{runId:e}).then(t=>{Ff.set(e,t.issues||[]),ae()}).catch(()=>{})}function Ay(e,t){if(!(!e||!t)){Qr[e]||(Qr[e]={});for(let[i,s]of Object.entries(t)){if(s.status==="pending")continue;let r=`${e}:${i}`;Qr[e][i]||xn.has(r)||(xn.add(r),Q.send("get-agent-prompt",{runId:e,stage:i}).then(o=>{Qr[e][i]=o,xn.delete(r),ae()}).catch(()=>{xn.delete(r)}))}}}function Of(e){if(!e||!e.stages)return null;for(let[t,i]of Object.entries(e.stages))if(i.status==="in_progress")return t;return null}function Wf(e,t){let i=Of(e),s=Of(t);s&&i!==s&&(st="*",cs=null,Ts(),oe.clearLog(),Q.send("unsubscribe-log").catch(()=>{}),Q.send("subscribe-log",{stage:null,runId:t.id}).catch(()=>{}))}Q.on("runs-list",e=>{let t={};for(let i of e.runs||[])t[i.id]=i;oe.setState({runs:t}),e.settings&&(ds=e.settings)});Q.on("run-snapshot",e=>{if(e&&e.id){let t=oe.getState().runs[e.id]??null;An.handleRunUpdate(e.id,e,t),oe.setRun(e.id,e),F.runId===e.id&&(Wf(t,e),rn(e)),kt&&(kt=null,ae())}});Q.on("run-update",e=>{if(e&&e.id){let t=oe.getState().runs[e.id]??null;An.handleRunUpdate(e.id,e,t),oe.setRun(e.id,e),F.runId===e.id&&(Wf(t,e),rn(e)),kt&&(kt=null,ae())}});Q.on("log-line",e=>{e&&(oe.appendLog(e),e.iteration&&e.iteration>1&&e._iterStart&&(st!=="*"&&Wu(e.iteration),Ku(e.iteration)),st!=="*"&&Wl(e),Kl(e))});Q.on("log-bulk",e=>{if(e&&Array.isArray(e.lines))for(let t of e.lines){let i={stage:e.stage,line:t};oe.appendLog(i),st!=="*"&&Wl(i),Kl(i)}});Q.on("preferences",e=>{e&&(oe.setState({preferences:e}),Xs(e.theme||"light"))});Q.on("beads-update",e=>{e&&(oe.setState({beads:{issues:e.issues||[],dbExists:e.dbExists??!1,dbPath:e.dbPath||null,loading:!1}}),F.runId&&Eh(F.runId))});Q.on("run-started",()=>{Q.send("list-runs").then(e=>{let t={};for(let i of e.runs||[])t[i.id]=i;oe.setState({runs:t}),e.settings&&(ds=e.settings)}).catch(()=>{})});Q.on("run-stopped",()=>{kt=null,Q.send("list-runs").then(e=>{let t={};for(let i of e.runs||[])t[i.id]=i;oe.setState({runs:t}),e.settings&&(ds=e.settings)}).catch(()=>{})});Q.on("stage-restarted",()=>{Q.send("list-runs").then(e=>{let t={};for(let i of e.runs||[])t[i.id]=i;oe.setState({runs:t}),e.settings&&(ds=e.settings)}).catch(()=>{})});Q.onConnection(e=>{zf=e,e==="open"&&(Q.send("list-runs").then(t=>{let i={};for(let s of t.runs||[])i[s.id]=s;oe.setState({runs:i}),t.settings&&(ds=t.settings)}).catch(()=>{}),Q.send("get-preferences").then(t=>{oe.setState({preferences:t}),Xs(t.theme||"light")}).catch(()=>{}),Q.send("list-beads-issues").then(t=>{oe.setState({beads:{issues:t.issues||[],dbExists:t.dbExists??!1,dbPath:t.dbPath||null,loading:!1}})}).catch(()=>{}),F.runId&&(Q.send("subscribe-run",{runId:F.runId}).catch(()=>{}),Q.send("subscribe-log",{stage:st==="*"?null:st,runId:F.runId}).catch(()=>{}),Eh(F.runId))),ae()});qh(e=>{let t=F.runId;F=e,t&&t!==F.runId&&(kh.clear(),Q.send("unsubscribe-run").catch(()=>{}),Q.send("unsubscribe-log").catch(()=>{}),oe.clearLog(),Ts(),jl()),F.runId&&F.runId!==t&&(st="*",cs=null,Q.send("subscribe-run",{runId:F.runId}).catch(()=>{}),Q.send("subscribe-log",{stage:null,runId:F.runId}).catch(()=>{}),Eh(F.runId)),F.section==="settings"&&ha().then(()=>ae()),!F.runId&&t&&(Nu(),ju()),ae()});function Vf(e){lt(e,null)}function If(e){lt(F.section,e)}function $y(){let t=oe.getState().preferences.theme==="dark"?"light":"dark";Q.send("set-preferences",{theme:t}).catch(()=>{}),oe.setState({preferences:{theme:t}}),Xs(t)}function Ty(e){Q.send("set-preferences",{notifications:e}).catch(()=>{}),oe.setState({preferences:{notifications:e}})}function Ly(e){if(st=e,e!=="*"){let s=oe.getState().runs[F.runId]?.stages?.[e]?.iterations?.length||0;cs=s>0?s:null}else cs=null;Ts(),oe.clearLog(),Q.send("unsubscribe-log").catch(()=>{}),Q.send("subscribe-log",{stage:e==="*"?null:e,runId:F.runId,iteration:cs}).catch(()=>{}),ae()}function Dy(e){cs=e,Ts(),oe.clearLog(),Q.send("unsubscribe-log").catch(()=>{}),Q.send("subscribe-log",{stage:st==="*"?null:st,runId:F.runId,iteration:e}).catch(()=>{}),ae()}function Ry(e){xh=e,Hu(e)}function My(){Ch=!Ch,ae()}function to(e){Vs=e,ae(),requestAnimationFrame(()=>{let t=document.getElementById("action-error-dialog");t&&t.show()})}function By(){Vs=null,ae()}function Py(){$n=!0,ae(),requestAnimationFrame(()=>{let e=document.getElementById("stop-confirm-dialog");e&&e.show()})}function Oy(){$n=!1,ae()}async function Iy(){$n=!1,kt="stopping",Vs=null,ae();try{let t=Object.values(oe.getState().runs).find(r=>r.active)?.id||"current",s=await(await fetch(`/api/runs/${t}`,{method:"DELETE"})).json();s.ok||(kt=null,to(s.error||"Failed to stop pipeline"))}catch(e){kt=null,to(e?.message||"Failed to stop pipeline")}}function zy(){kt="resuming",Vs=null,ae(),Q.send("resume-run").then(()=>{}).catch(e=>{kt=null,to(e?.message||"Failed to resume pipeline")})}function Ny(e){eo=e,Tn=!0,ae(),requestAnimationFrame(()=>{let t=document.getElementById("restart-stage-confirm-dialog");t&&t.show()})}function Hy(){Tn=!1,eo=null,ae()}async function Fy(){Tn=!1;let e=eo;eo=null,ae();try{let i=Object.values(oe.getState().runs).find(o=>!o.active)?.id||"current",r=await(await fetch(`/api/runs/${i}/stages/${e}/restart`,{method:"POST"})).json();r.ok?lt("active",null):to(r.error||"Failed to restart stage")}catch(t){to(t?.message||"Failed to restart stage")}}function Wy(){if(F.runId){let t=Object.values(oe.getState().runs).filter(i=>i.active);F.section==="active"&&t.length<=1?lt("dashboard",null):lt(F.section,null)}else F.section&&F.section!=="dashboard"&&lt("dashboard",null)}function Vy(e){Nf=e,ae()}function Uy(e){Hf=e,ae()}async function qy(e){kn=e,En=null,ae();try{await Q.send("start-beads-issue",{issueId:e}),kn=null,lt("active",null)}catch(t){kn=null,En=t?.message||"Failed to start pipeline",ae()}}function Ky(){En=null,ae()}function jy(){let e=oe.getState(),t="Dashboard",i=!1,s=null,r=null;if(F.runId){let o=e.runs[F.runId],a=(o?.work_request?.title||"Pipeline Details").split(`
`)[0];if(t=a.length>80?a.slice(0,80)+"\u2026":a,i=!0,o){let h=o.runState||(o.active?"running":"terminal"),l=h==="running"?"warning":h==="interrupted"?"neutral":"success",c=h==="running"?"in_progress":h==="interrupted"?"interrupted":"completed",d=h==="running"?"Running":h==="interrupted"?"Interrupted":"Completed";s=g`<sl-badge variant="${l}" pill>
        ${I(Bt(c,12))}
        ${d}
      </sl-badge>`,kt==="stopping"?r=g`
          <button class="action-btn action-btn--danger" disabled>
            ${I(N(Mt,14,"icon-spin"))}
            Stopping\u2026
          </button>`:kt==="resuming"?r=g`
          <button class="action-btn action-btn--primary" disabled>
            ${I(N(Mt,14,"icon-spin"))}
            Resuming\u2026
          </button>`:h==="running"?r=g`
          <button class="action-btn action-btn--danger" @click=${Py}>
            ${I(N(Kn,14))}
            Stop Pipeline
          </button>`:h==="interrupted"&&(r=g`
          <button class="action-btn action-btn--primary" @click=${zy}>
            ${I(N(co,14))}
            Resume Pipeline
          </button>`)}}else if(F.section==="beads"){t="Beads Issues",i=!0;let o=e.beads?.dbPath;o&&(r=g`<span class="beads-db-path">${I(N(ia,12))} Beads DB<br><code>${o}</code></span>`)}else if(F.section==="active")t="Running Pipelines",i=!0;else if(F.section==="history")t="History",i=!0;else if(F.section==="new-run"){t="New Pipeline",i=!0;let o=nc(),a=Object.values(e.runs).some(h=>h.active);r=g`
      <button class="action-btn action-btn--primary" ?disabled=${o.isSubmitting||a}
        @click=${()=>ac({rerender:ae,onStarted:()=>lt("active")})}>
        ${I(N(co,14))}
        ${o.isSubmitting?"Starting\u2026":"Start"}
      </button>`}else F.section==="settings"&&(t="Settings",i=!0);return g`
    <div class="content-header">
      ${i?g`
        <button class="content-header-back" @click=${Wy}>
          ${I(N(qn,18))}
        </button>
      `:""}
      ${s||""}
      <h1 class="content-header-title">${t}</h1>
      ${r?g`<div class="content-header-actions">
        ${r}
      </div>`:""}
    </div>
  `}function Yy(){let e=oe.getState(),t=Object.values(e.runs);if(F.runId){let i=e.runs[F.runId],s={};if(i?.stages){for(let[a,h]of Object.entries(i.stages)){let l=h.iterations||[];l.length>0&&(s[a]=l.length)}Ay(F.runId,i.stages)}let r=Gy(e);r.currentLogStage=st==="*"?null:st,r.currentLogIteration=cs;let o=!!i?.active,n=Yl();return i&&!n&&rn(i),g`
      <div class="run-detail-layout">
        <div class="run-detail-layout__stages">
          ${tc(i,ds,{promptCache:Qr[F.runId]||{},onRestartStage:Ny,beads:Ff.get(F.runId),stageIterationTab:kh,onStageTabChange:Ey})}
        </div>
        <div class="run-detail-layout__logs">
          ${Gu(Yl(),o)}
          ${Vu(r,{onStageFilter:Ly,onIterationFilter:Dy,onSearch:Ry,onToggleAutoScroll:My,autoScroll:Ch,stageIterations:s,runStages:i?.stages})}
        </div>
      </div>
    `}if(F.section==="beads")return Yh(e.beads,{statusFilter:Nf,priorityFilter:Hf,starting:kn,startError:En,onStatusFilter:Vy,onPriorityFilter:Uy,onStartIssue:qy,onDismissError:Ky});if(F.section==="new-run")return lc(e,{rerender:ae});if(F.section==="settings")return oc(e.preferences,{rerender:ae,onThemeToggle:$y,onSaveNotifications:Ty});if(F.section==="history")return la(t,"history",{onSelectRun:If});if(F.section==="active"){let i=t.filter(s=>s.active);return i.length===1?(lt("active",i[0].id),g``):la(t,"active",{onSelectRun:If})}return ic(e,{onSelectRun:i=>lt("active",i),onNavigate:Vf})}function Gy(e){let t=e.logLines;if(st!=="*"&&(t=t.filter(i=>i.stage===st)),xh){let i=xh.toLowerCase();t=t.filter(s=>(s.line||"").toLowerCase().includes(i))}return{...e,logLines:t}}function ae(){let e=oe.getState(),t=document.getElementById("app");t&&(ho(g`
    <div class="app-shell">
      ${Kh(e,F,zf,{onNavigate:Vf})}
      <main class="main-content">
        ${An.renderBanner()}
        ${jy()}
        ${Yy()}
      </main>
    </div>
    ${Vs?g`
      <sl-dialog id="action-error-dialog" label="Pipeline Error" @sl-after-hide=${By}>
        <div class="error-dialog-body">
          ${I(N(Wn,32,"error-dialog-icon"))}
          <p>${Vs}</p>
        </div>
        <sl-button slot="footer" variant="primary" @click=${()=>{document.getElementById("action-error-dialog")?.hide()}}>OK</sl-button>
      </sl-dialog>
    `:""}
    ${$n?g`
      <sl-dialog id="stop-confirm-dialog" label="Stop Pipeline?" @sl-after-hide=${Oy}>
        <p>Are you sure? The current stage will be interrupted and marked as error.</p>
        <sl-button slot="footer" @click=${()=>{document.getElementById("stop-confirm-dialog")?.hide()}}>Cancel</sl-button>
        <sl-button slot="footer" variant="danger" @click=${()=>{document.getElementById("stop-confirm-dialog")?.hide(),Iy()}}>Stop Pipeline</sl-button>
      </sl-dialog>
    `:""}
    ${Tn?g`
      <sl-dialog id="restart-stage-confirm-dialog" label="Restart Stage?" @sl-after-hide=${Hy}>
        <p>Restart the "${eo}" stage? The pipeline will resume from this point.</p>
        <sl-button slot="footer" @click=${()=>{document.getElementById("restart-stage-confirm-dialog")?.hide()}}>Cancel</sl-button>
        <sl-button slot="footer" variant="warning" @click=${()=>{document.getElementById("restart-stage-confirm-dialog")?.hide(),Fy()}}>Restart</sl-button>
      </sl-dialog>
    `:""}
  `,t),F.runId&&(st!=="*"&&Fu(F.runId),Yu(F.runId)))}An.setRerender(ae);oe.subscribe(()=>ae());Xs(oe.getState().preferences.theme);F.section==="settings"&&ha().then(()=>ae());ae();
//# sourceMappingURL=main.bundle.js.map
