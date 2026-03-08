var na=Object.create;var ms=Object.defineProperty;var aa=Object.getOwnPropertyDescriptor;var la=Object.getOwnPropertyNames;var ca=Object.getPrototypeOf,ha=Object.prototype.hasOwnProperty;var wr=(e,t)=>()=>(e&&(t=e(e=0)),t);var da=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),Cr=(e,t)=>{for(var r in t)ms(e,r,{get:t[r],enumerable:!0})},ua=(e,t,r,d)=>{if(t&&typeof t=="object"||typeof t=="function")for(let u of la(t))!ha.call(e,u)&&u!==r&&ms(e,u,{get:()=>t[u],enumerable:!(d=aa(t,u))||d.enumerable});return e};var fa=(e,t,r)=>(r=e!=null?na(ca(e)):{},ua(t||!e||!e.__esModule?ms(r,"default",{value:e,enumerable:!0}):r,e));var Gr=da(($i,Ms)=>{(function(e,t){if(typeof $i=="object"&&typeof Ms=="object")Ms.exports=t();else if(typeof define=="function"&&define.amd)define([],t);else{var r=t();for(var d in r)(typeof $i=="object"?$i:e)[d]=r[d]}})(self,(()=>(()=>{"use strict";var e={4567:function(u,i,o){var h=this&&this.__decorate||function(l,_,b,y){var x,m=arguments.length,w=m<3?_:y===null?y=Object.getOwnPropertyDescriptor(_,b):y;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")w=Reflect.decorate(l,_,b,y);else for(var A=l.length-1;A>=0;A--)(x=l[A])&&(w=(m<3?x(w):m>3?x(_,b,w):x(_,b))||w);return m>3&&w&&Object.defineProperty(_,b,w),w},f=this&&this.__param||function(l,_){return function(b,y){_(b,y,l)}};Object.defineProperty(i,"__esModule",{value:!0}),i.AccessibilityManager=void 0;let c=o(9042),p=o(6114),v=o(9924),S=o(844),g=o(5596),s=o(4725),a=o(3656),n=i.AccessibilityManager=class extends S.Disposable{constructor(l,_){super(),this._terminal=l,this._renderService=_,this._liveRegionLineCount=0,this._charsToConsume=[],this._charsToAnnounce="",this._accessibilityContainer=document.createElement("div"),this._accessibilityContainer.classList.add("xterm-accessibility"),this._rowContainer=document.createElement("div"),this._rowContainer.setAttribute("role","list"),this._rowContainer.classList.add("xterm-accessibility-tree"),this._rowElements=[];for(let b=0;b<this._terminal.rows;b++)this._rowElements[b]=this._createAccessibilityTreeNode(),this._rowContainer.appendChild(this._rowElements[b]);if(this._topBoundaryFocusListener=b=>this._handleBoundaryFocus(b,0),this._bottomBoundaryFocusListener=b=>this._handleBoundaryFocus(b,1),this._rowElements[0].addEventListener("focus",this._topBoundaryFocusListener),this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._refreshRowsDimensions(),this._accessibilityContainer.appendChild(this._rowContainer),this._liveRegion=document.createElement("div"),this._liveRegion.classList.add("live-region"),this._liveRegion.setAttribute("aria-live","assertive"),this._accessibilityContainer.appendChild(this._liveRegion),this._liveRegionDebouncer=this.register(new v.TimeBasedDebouncer(this._renderRows.bind(this))),!this._terminal.element)throw new Error("Cannot enable accessibility before Terminal.open");this._terminal.element.insertAdjacentElement("afterbegin",this._accessibilityContainer),this.register(this._terminal.onResize((b=>this._handleResize(b.rows)))),this.register(this._terminal.onRender((b=>this._refreshRows(b.start,b.end)))),this.register(this._terminal.onScroll((()=>this._refreshRows()))),this.register(this._terminal.onA11yChar((b=>this._handleChar(b)))),this.register(this._terminal.onLineFeed((()=>this._handleChar(`
`)))),this.register(this._terminal.onA11yTab((b=>this._handleTab(b)))),this.register(this._terminal.onKey((b=>this._handleKey(b.key)))),this.register(this._terminal.onBlur((()=>this._clearLiveRegion()))),this.register(this._renderService.onDimensionsChange((()=>this._refreshRowsDimensions()))),this._screenDprMonitor=new g.ScreenDprMonitor(window),this.register(this._screenDprMonitor),this._screenDprMonitor.setListener((()=>this._refreshRowsDimensions())),this.register((0,a.addDisposableDomListener)(window,"resize",(()=>this._refreshRowsDimensions()))),this._refreshRows(),this.register((0,S.toDisposable)((()=>{this._accessibilityContainer.remove(),this._rowElements.length=0})))}_handleTab(l){for(let _=0;_<l;_++)this._handleChar(" ")}_handleChar(l){this._liveRegionLineCount<21&&(this._charsToConsume.length>0?this._charsToConsume.shift()!==l&&(this._charsToAnnounce+=l):this._charsToAnnounce+=l,l===`
`&&(this._liveRegionLineCount++,this._liveRegionLineCount===21&&(this._liveRegion.textContent+=c.tooMuchOutput)),p.isMac&&this._liveRegion.textContent&&this._liveRegion.textContent.length>0&&!this._liveRegion.parentNode&&setTimeout((()=>{this._accessibilityContainer.appendChild(this._liveRegion)}),0))}_clearLiveRegion(){this._liveRegion.textContent="",this._liveRegionLineCount=0,p.isMac&&this._liveRegion.remove()}_handleKey(l){this._clearLiveRegion(),/\p{Control}/u.test(l)||this._charsToConsume.push(l)}_refreshRows(l,_){this._liveRegionDebouncer.refresh(l,_,this._terminal.rows)}_renderRows(l,_){let b=this._terminal.buffer,y=b.lines.length.toString();for(let x=l;x<=_;x++){let m=b.translateBufferLineToString(b.ydisp+x,!0),w=(b.ydisp+x+1).toString(),A=this._rowElements[x];A&&(m.length===0?A.innerText="\xA0":A.textContent=m,A.setAttribute("aria-posinset",w),A.setAttribute("aria-setsize",y))}this._announceCharacters()}_announceCharacters(){this._charsToAnnounce.length!==0&&(this._liveRegion.textContent+=this._charsToAnnounce,this._charsToAnnounce="")}_handleBoundaryFocus(l,_){let b=l.target,y=this._rowElements[_===0?1:this._rowElements.length-2];if(b.getAttribute("aria-posinset")===(_===0?"1":`${this._terminal.buffer.lines.length}`)||l.relatedTarget!==y)return;let x,m;if(_===0?(x=b,m=this._rowElements.pop(),this._rowContainer.removeChild(m)):(x=this._rowElements.shift(),m=b,this._rowContainer.removeChild(x)),x.removeEventListener("focus",this._topBoundaryFocusListener),m.removeEventListener("focus",this._bottomBoundaryFocusListener),_===0){let w=this._createAccessibilityTreeNode();this._rowElements.unshift(w),this._rowContainer.insertAdjacentElement("afterbegin",w)}else{let w=this._createAccessibilityTreeNode();this._rowElements.push(w),this._rowContainer.appendChild(w)}this._rowElements[0].addEventListener("focus",this._topBoundaryFocusListener),this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._terminal.scrollLines(_===0?-1:1),this._rowElements[_===0?1:this._rowElements.length-2].focus(),l.preventDefault(),l.stopImmediatePropagation()}_handleResize(l){this._rowElements[this._rowElements.length-1].removeEventListener("focus",this._bottomBoundaryFocusListener);for(let _=this._rowContainer.children.length;_<this._terminal.rows;_++)this._rowElements[_]=this._createAccessibilityTreeNode(),this._rowContainer.appendChild(this._rowElements[_]);for(;this._rowElements.length>l;)this._rowContainer.removeChild(this._rowElements.pop());this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._refreshRowsDimensions()}_createAccessibilityTreeNode(){let l=document.createElement("div");return l.setAttribute("role","listitem"),l.tabIndex=-1,this._refreshRowDimensions(l),l}_refreshRowsDimensions(){if(this._renderService.dimensions.css.cell.height){this._accessibilityContainer.style.width=`${this._renderService.dimensions.css.canvas.width}px`,this._rowElements.length!==this._terminal.rows&&this._handleResize(this._terminal.rows);for(let l=0;l<this._terminal.rows;l++)this._refreshRowDimensions(this._rowElements[l])}}_refreshRowDimensions(l){l.style.height=`${this._renderService.dimensions.css.cell.height}px`}};i.AccessibilityManager=n=h([f(1,s.IRenderService)],n)},3614:(u,i)=>{function o(p){return p.replace(/\r?\n/g,"\r")}function h(p,v){return v?"\x1B[200~"+p+"\x1B[201~":p}function f(p,v,S,g){p=h(p=o(p),S.decPrivateModes.bracketedPasteMode&&g.rawOptions.ignoreBracketedPasteMode!==!0),S.triggerDataEvent(p,!0),v.value=""}function c(p,v,S){let g=S.getBoundingClientRect(),s=p.clientX-g.left-10,a=p.clientY-g.top-10;v.style.width="20px",v.style.height="20px",v.style.left=`${s}px`,v.style.top=`${a}px`,v.style.zIndex="1000",v.focus()}Object.defineProperty(i,"__esModule",{value:!0}),i.rightClickHandler=i.moveTextAreaUnderMouseCursor=i.paste=i.handlePasteEvent=i.copyHandler=i.bracketTextForPaste=i.prepareTextForTerminal=void 0,i.prepareTextForTerminal=o,i.bracketTextForPaste=h,i.copyHandler=function(p,v){p.clipboardData&&p.clipboardData.setData("text/plain",v.selectionText),p.preventDefault()},i.handlePasteEvent=function(p,v,S,g){p.stopPropagation(),p.clipboardData&&f(p.clipboardData.getData("text/plain"),v,S,g)},i.paste=f,i.moveTextAreaUnderMouseCursor=c,i.rightClickHandler=function(p,v,S,g,s){c(p,v,S),s&&g.rightClickSelect(p),v.value=g.selectionText,v.select()}},7239:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ColorContrastCache=void 0;let h=o(1505);i.ColorContrastCache=class{constructor(){this._color=new h.TwoKeyMap,this._css=new h.TwoKeyMap}setCss(f,c,p){this._css.set(f,c,p)}getCss(f,c){return this._css.get(f,c)}setColor(f,c,p){this._color.set(f,c,p)}getColor(f,c){return this._color.get(f,c)}clear(){this._color.clear(),this._css.clear()}}},3656:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.addDisposableDomListener=void 0,i.addDisposableDomListener=function(o,h,f,c){o.addEventListener(h,f,c);let p=!1;return{dispose:()=>{p||(p=!0,o.removeEventListener(h,f,c))}}}},6465:function(u,i,o){var h=this&&this.__decorate||function(s,a,n,l){var _,b=arguments.length,y=b<3?a:l===null?l=Object.getOwnPropertyDescriptor(a,n):l;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(s,a,n,l);else for(var x=s.length-1;x>=0;x--)(_=s[x])&&(y=(b<3?_(y):b>3?_(a,n,y):_(a,n))||y);return b>3&&y&&Object.defineProperty(a,n,y),y},f=this&&this.__param||function(s,a){return function(n,l){a(n,l,s)}};Object.defineProperty(i,"__esModule",{value:!0}),i.Linkifier2=void 0;let c=o(3656),p=o(8460),v=o(844),S=o(2585),g=i.Linkifier2=class extends v.Disposable{get currentLink(){return this._currentLink}constructor(s){super(),this._bufferService=s,this._linkProviders=[],this._linkCacheDisposables=[],this._isMouseOut=!0,this._wasResized=!1,this._activeLine=-1,this._onShowLinkUnderline=this.register(new p.EventEmitter),this.onShowLinkUnderline=this._onShowLinkUnderline.event,this._onHideLinkUnderline=this.register(new p.EventEmitter),this.onHideLinkUnderline=this._onHideLinkUnderline.event,this.register((0,v.getDisposeArrayDisposable)(this._linkCacheDisposables)),this.register((0,v.toDisposable)((()=>{this._lastMouseEvent=void 0}))),this.register(this._bufferService.onResize((()=>{this._clearCurrentLink(),this._wasResized=!0})))}registerLinkProvider(s){return this._linkProviders.push(s),{dispose:()=>{let a=this._linkProviders.indexOf(s);a!==-1&&this._linkProviders.splice(a,1)}}}attachToDom(s,a,n){this._element=s,this._mouseService=a,this._renderService=n,this.register((0,c.addDisposableDomListener)(this._element,"mouseleave",(()=>{this._isMouseOut=!0,this._clearCurrentLink()}))),this.register((0,c.addDisposableDomListener)(this._element,"mousemove",this._handleMouseMove.bind(this))),this.register((0,c.addDisposableDomListener)(this._element,"mousedown",this._handleMouseDown.bind(this))),this.register((0,c.addDisposableDomListener)(this._element,"mouseup",this._handleMouseUp.bind(this)))}_handleMouseMove(s){if(this._lastMouseEvent=s,!this._element||!this._mouseService)return;let a=this._positionFromMouseEvent(s,this._element,this._mouseService);if(!a)return;this._isMouseOut=!1;let n=s.composedPath();for(let l=0;l<n.length;l++){let _=n[l];if(_.classList.contains("xterm"))break;if(_.classList.contains("xterm-hover"))return}this._lastBufferCell&&a.x===this._lastBufferCell.x&&a.y===this._lastBufferCell.y||(this._handleHover(a),this._lastBufferCell=a)}_handleHover(s){if(this._activeLine!==s.y||this._wasResized)return this._clearCurrentLink(),this._askForLink(s,!1),void(this._wasResized=!1);this._currentLink&&this._linkAtPosition(this._currentLink.link,s)||(this._clearCurrentLink(),this._askForLink(s,!0))}_askForLink(s,a){var n,l;this._activeProviderReplies&&a||((n=this._activeProviderReplies)===null||n===void 0||n.forEach((b=>{b?.forEach((y=>{y.link.dispose&&y.link.dispose()}))})),this._activeProviderReplies=new Map,this._activeLine=s.y);let _=!1;for(let[b,y]of this._linkProviders.entries())a?!((l=this._activeProviderReplies)===null||l===void 0)&&l.get(b)&&(_=this._checkLinkProviderResult(b,s,_)):y.provideLinks(s.y,(x=>{var m,w;if(this._isMouseOut)return;let A=x?.map((T=>({link:T})));(m=this._activeProviderReplies)===null||m===void 0||m.set(b,A),_=this._checkLinkProviderResult(b,s,_),((w=this._activeProviderReplies)===null||w===void 0?void 0:w.size)===this._linkProviders.length&&this._removeIntersectingLinks(s.y,this._activeProviderReplies)}))}_removeIntersectingLinks(s,a){let n=new Set;for(let l=0;l<a.size;l++){let _=a.get(l);if(_)for(let b=0;b<_.length;b++){let y=_[b],x=y.link.range.start.y<s?0:y.link.range.start.x,m=y.link.range.end.y>s?this._bufferService.cols:y.link.range.end.x;for(let w=x;w<=m;w++){if(n.has(w)){_.splice(b--,1);break}n.add(w)}}}}_checkLinkProviderResult(s,a,n){var l;if(!this._activeProviderReplies)return n;let _=this._activeProviderReplies.get(s),b=!1;for(let y=0;y<s;y++)this._activeProviderReplies.has(y)&&!this._activeProviderReplies.get(y)||(b=!0);if(!b&&_){let y=_.find((x=>this._linkAtPosition(x.link,a)));y&&(n=!0,this._handleNewLink(y))}if(this._activeProviderReplies.size===this._linkProviders.length&&!n)for(let y=0;y<this._activeProviderReplies.size;y++){let x=(l=this._activeProviderReplies.get(y))===null||l===void 0?void 0:l.find((m=>this._linkAtPosition(m.link,a)));if(x){n=!0,this._handleNewLink(x);break}}return n}_handleMouseDown(){this._mouseDownLink=this._currentLink}_handleMouseUp(s){if(!this._element||!this._mouseService||!this._currentLink)return;let a=this._positionFromMouseEvent(s,this._element,this._mouseService);a&&this._mouseDownLink===this._currentLink&&this._linkAtPosition(this._currentLink.link,a)&&this._currentLink.link.activate(s,this._currentLink.link.text)}_clearCurrentLink(s,a){this._element&&this._currentLink&&this._lastMouseEvent&&(!s||!a||this._currentLink.link.range.start.y>=s&&this._currentLink.link.range.end.y<=a)&&(this._linkLeave(this._element,this._currentLink.link,this._lastMouseEvent),this._currentLink=void 0,(0,v.disposeArray)(this._linkCacheDisposables))}_handleNewLink(s){if(!this._element||!this._lastMouseEvent||!this._mouseService)return;let a=this._positionFromMouseEvent(this._lastMouseEvent,this._element,this._mouseService);a&&this._linkAtPosition(s.link,a)&&(this._currentLink=s,this._currentLink.state={decorations:{underline:s.link.decorations===void 0||s.link.decorations.underline,pointerCursor:s.link.decorations===void 0||s.link.decorations.pointerCursor},isHovered:!0},this._linkHover(this._element,s.link,this._lastMouseEvent),s.link.decorations={},Object.defineProperties(s.link.decorations,{pointerCursor:{get:()=>{var n,l;return(l=(n=this._currentLink)===null||n===void 0?void 0:n.state)===null||l===void 0?void 0:l.decorations.pointerCursor},set:n=>{var l,_;!((l=this._currentLink)===null||l===void 0)&&l.state&&this._currentLink.state.decorations.pointerCursor!==n&&(this._currentLink.state.decorations.pointerCursor=n,this._currentLink.state.isHovered&&((_=this._element)===null||_===void 0||_.classList.toggle("xterm-cursor-pointer",n)))}},underline:{get:()=>{var n,l;return(l=(n=this._currentLink)===null||n===void 0?void 0:n.state)===null||l===void 0?void 0:l.decorations.underline},set:n=>{var l,_,b;!((l=this._currentLink)===null||l===void 0)&&l.state&&((b=(_=this._currentLink)===null||_===void 0?void 0:_.state)===null||b===void 0?void 0:b.decorations.underline)!==n&&(this._currentLink.state.decorations.underline=n,this._currentLink.state.isHovered&&this._fireUnderlineEvent(s.link,n))}}}),this._renderService&&this._linkCacheDisposables.push(this._renderService.onRenderedViewportChange((n=>{if(!this._currentLink)return;let l=n.start===0?0:n.start+1+this._bufferService.buffer.ydisp,_=this._bufferService.buffer.ydisp+1+n.end;if(this._currentLink.link.range.start.y>=l&&this._currentLink.link.range.end.y<=_&&(this._clearCurrentLink(l,_),this._lastMouseEvent&&this._element)){let b=this._positionFromMouseEvent(this._lastMouseEvent,this._element,this._mouseService);b&&this._askForLink(b,!1)}}))))}_linkHover(s,a,n){var l;!((l=this._currentLink)===null||l===void 0)&&l.state&&(this._currentLink.state.isHovered=!0,this._currentLink.state.decorations.underline&&this._fireUnderlineEvent(a,!0),this._currentLink.state.decorations.pointerCursor&&s.classList.add("xterm-cursor-pointer")),a.hover&&a.hover(n,a.text)}_fireUnderlineEvent(s,a){let n=s.range,l=this._bufferService.buffer.ydisp,_=this._createLinkUnderlineEvent(n.start.x-1,n.start.y-l-1,n.end.x,n.end.y-l-1,void 0);(a?this._onShowLinkUnderline:this._onHideLinkUnderline).fire(_)}_linkLeave(s,a,n){var l;!((l=this._currentLink)===null||l===void 0)&&l.state&&(this._currentLink.state.isHovered=!1,this._currentLink.state.decorations.underline&&this._fireUnderlineEvent(a,!1),this._currentLink.state.decorations.pointerCursor&&s.classList.remove("xterm-cursor-pointer")),a.leave&&a.leave(n,a.text)}_linkAtPosition(s,a){let n=s.range.start.y*this._bufferService.cols+s.range.start.x,l=s.range.end.y*this._bufferService.cols+s.range.end.x,_=a.y*this._bufferService.cols+a.x;return n<=_&&_<=l}_positionFromMouseEvent(s,a,n){let l=n.getCoords(s,a,this._bufferService.cols,this._bufferService.rows);if(l)return{x:l[0],y:l[1]+this._bufferService.buffer.ydisp}}_createLinkUnderlineEvent(s,a,n,l,_){return{x1:s,y1:a,x2:n,y2:l,cols:this._bufferService.cols,fg:_}}};i.Linkifier2=g=h([f(0,S.IBufferService)],g)},9042:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.tooMuchOutput=i.promptLabel=void 0,i.promptLabel="Terminal input",i.tooMuchOutput="Too much output to announce, navigate to rows manually to read"},3730:function(u,i,o){var h=this&&this.__decorate||function(g,s,a,n){var l,_=arguments.length,b=_<3?s:n===null?n=Object.getOwnPropertyDescriptor(s,a):n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")b=Reflect.decorate(g,s,a,n);else for(var y=g.length-1;y>=0;y--)(l=g[y])&&(b=(_<3?l(b):_>3?l(s,a,b):l(s,a))||b);return _>3&&b&&Object.defineProperty(s,a,b),b},f=this&&this.__param||function(g,s){return function(a,n){s(a,n,g)}};Object.defineProperty(i,"__esModule",{value:!0}),i.OscLinkProvider=void 0;let c=o(511),p=o(2585),v=i.OscLinkProvider=class{constructor(g,s,a){this._bufferService=g,this._optionsService=s,this._oscLinkService=a}provideLinks(g,s){var a;let n=this._bufferService.buffer.lines.get(g-1);if(!n)return void s(void 0);let l=[],_=this._optionsService.rawOptions.linkHandler,b=new c.CellData,y=n.getTrimmedLength(),x=-1,m=-1,w=!1;for(let A=0;A<y;A++)if(m!==-1||n.hasContent(A)){if(n.loadCell(A,b),b.hasExtendedAttrs()&&b.extended.urlId){if(m===-1){m=A,x=b.extended.urlId;continue}w=b.extended.urlId!==x}else m!==-1&&(w=!0);if(w||m!==-1&&A===y-1){let T=(a=this._oscLinkService.getLinkData(x))===null||a===void 0?void 0:a.uri;if(T){let D={start:{x:m+1,y:g},end:{x:A+(w||A!==y-1?0:1),y:g}},O=!1;if(!_?.allowNonHttpProtocols)try{let F=new URL(T);["http:","https:"].includes(F.protocol)||(O=!0)}catch{O=!0}O||l.push({text:T,range:D,activate:(F,P)=>_?_.activate(F,P,D):S(0,P),hover:(F,P)=>{var M;return(M=_?.hover)===null||M===void 0?void 0:M.call(_,F,P,D)},leave:(F,P)=>{var M;return(M=_?.leave)===null||M===void 0?void 0:M.call(_,F,P,D)}})}w=!1,b.hasExtendedAttrs()&&b.extended.urlId?(m=A,x=b.extended.urlId):(m=-1,x=-1)}}s(l)}};function S(g,s){if(confirm(`Do you want to navigate to ${s}?

WARNING: This link could potentially be dangerous`)){let a=window.open();if(a){try{a.opener=null}catch{}a.location.href=s}else console.warn("Opening link blocked as opener could not be cleared")}}i.OscLinkProvider=v=h([f(0,p.IBufferService),f(1,p.IOptionsService),f(2,p.IOscLinkService)],v)},6193:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.RenderDebouncer=void 0,i.RenderDebouncer=class{constructor(o,h){this._parentWindow=o,this._renderCallback=h,this._refreshCallbacks=[]}dispose(){this._animationFrame&&(this._parentWindow.cancelAnimationFrame(this._animationFrame),this._animationFrame=void 0)}addRefreshCallback(o){return this._refreshCallbacks.push(o),this._animationFrame||(this._animationFrame=this._parentWindow.requestAnimationFrame((()=>this._innerRefresh()))),this._animationFrame}refresh(o,h,f){this._rowCount=f,o=o!==void 0?o:0,h=h!==void 0?h:this._rowCount-1,this._rowStart=this._rowStart!==void 0?Math.min(this._rowStart,o):o,this._rowEnd=this._rowEnd!==void 0?Math.max(this._rowEnd,h):h,this._animationFrame||(this._animationFrame=this._parentWindow.requestAnimationFrame((()=>this._innerRefresh())))}_innerRefresh(){if(this._animationFrame=void 0,this._rowStart===void 0||this._rowEnd===void 0||this._rowCount===void 0)return void this._runRefreshCallbacks();let o=Math.max(this._rowStart,0),h=Math.min(this._rowEnd,this._rowCount-1);this._rowStart=void 0,this._rowEnd=void 0,this._renderCallback(o,h),this._runRefreshCallbacks()}_runRefreshCallbacks(){for(let o of this._refreshCallbacks)o(0);this._refreshCallbacks=[]}}},5596:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ScreenDprMonitor=void 0;let h=o(844);class f extends h.Disposable{constructor(p){super(),this._parentWindow=p,this._currentDevicePixelRatio=this._parentWindow.devicePixelRatio,this.register((0,h.toDisposable)((()=>{this.clearListener()})))}setListener(p){this._listener&&this.clearListener(),this._listener=p,this._outerListener=()=>{this._listener&&(this._listener(this._parentWindow.devicePixelRatio,this._currentDevicePixelRatio),this._updateDpr())},this._updateDpr()}_updateDpr(){var p;this._outerListener&&((p=this._resolutionMediaMatchList)===null||p===void 0||p.removeListener(this._outerListener),this._currentDevicePixelRatio=this._parentWindow.devicePixelRatio,this._resolutionMediaMatchList=this._parentWindow.matchMedia(`screen and (resolution: ${this._parentWindow.devicePixelRatio}dppx)`),this._resolutionMediaMatchList.addListener(this._outerListener))}clearListener(){this._resolutionMediaMatchList&&this._listener&&this._outerListener&&(this._resolutionMediaMatchList.removeListener(this._outerListener),this._resolutionMediaMatchList=void 0,this._listener=void 0,this._outerListener=void 0)}}i.ScreenDprMonitor=f},3236:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Terminal=void 0;let h=o(3614),f=o(3656),c=o(6465),p=o(9042),v=o(3730),S=o(1680),g=o(3107),s=o(5744),a=o(2950),n=o(1296),l=o(428),_=o(4269),b=o(5114),y=o(8934),x=o(3230),m=o(9312),w=o(4725),A=o(6731),T=o(8055),D=o(8969),O=o(8460),F=o(844),P=o(6114),M=o(8437),I=o(2584),C=o(7399),k=o(5941),L=o(9074),R=o(2585),z=o(5435),U=o(4567),K=typeof window<"u"?window.document:null;class q extends D.CoreTerminal{get onFocus(){return this._onFocus.event}get onBlur(){return this._onBlur.event}get onA11yChar(){return this._onA11yCharEmitter.event}get onA11yTab(){return this._onA11yTabEmitter.event}get onWillOpen(){return this._onWillOpen.event}constructor(E={}){super(E),this.browser=P,this._keyDownHandled=!1,this._keyDownSeen=!1,this._keyPressHandled=!1,this._unprocessedDeadKey=!1,this._accessibilityManager=this.register(new F.MutableDisposable),this._onCursorMove=this.register(new O.EventEmitter),this.onCursorMove=this._onCursorMove.event,this._onKey=this.register(new O.EventEmitter),this.onKey=this._onKey.event,this._onRender=this.register(new O.EventEmitter),this.onRender=this._onRender.event,this._onSelectionChange=this.register(new O.EventEmitter),this.onSelectionChange=this._onSelectionChange.event,this._onTitleChange=this.register(new O.EventEmitter),this.onTitleChange=this._onTitleChange.event,this._onBell=this.register(new O.EventEmitter),this.onBell=this._onBell.event,this._onFocus=this.register(new O.EventEmitter),this._onBlur=this.register(new O.EventEmitter),this._onA11yCharEmitter=this.register(new O.EventEmitter),this._onA11yTabEmitter=this.register(new O.EventEmitter),this._onWillOpen=this.register(new O.EventEmitter),this._setup(),this.linkifier2=this.register(this._instantiationService.createInstance(c.Linkifier2)),this.linkifier2.registerLinkProvider(this._instantiationService.createInstance(v.OscLinkProvider)),this._decorationService=this._instantiationService.createInstance(L.DecorationService),this._instantiationService.setService(R.IDecorationService,this._decorationService),this.register(this._inputHandler.onRequestBell((()=>this._onBell.fire()))),this.register(this._inputHandler.onRequestRefreshRows((($,W)=>this.refresh($,W)))),this.register(this._inputHandler.onRequestSendFocus((()=>this._reportFocus()))),this.register(this._inputHandler.onRequestReset((()=>this.reset()))),this.register(this._inputHandler.onRequestWindowsOptionsReport(($=>this._reportWindowsOptions($)))),this.register(this._inputHandler.onColor(($=>this._handleColorEvent($)))),this.register((0,O.forwardEvent)(this._inputHandler.onCursorMove,this._onCursorMove)),this.register((0,O.forwardEvent)(this._inputHandler.onTitleChange,this._onTitleChange)),this.register((0,O.forwardEvent)(this._inputHandler.onA11yChar,this._onA11yCharEmitter)),this.register((0,O.forwardEvent)(this._inputHandler.onA11yTab,this._onA11yTabEmitter)),this.register(this._bufferService.onResize(($=>this._afterResize($.cols,$.rows)))),this.register((0,F.toDisposable)((()=>{var $,W;this._customKeyEventHandler=void 0,(W=($=this.element)===null||$===void 0?void 0:$.parentNode)===null||W===void 0||W.removeChild(this.element)})))}_handleColorEvent(E){if(this._themeService)for(let $ of E){let W,N="";switch($.index){case 256:W="foreground",N="10";break;case 257:W="background",N="11";break;case 258:W="cursor",N="12";break;default:W="ansi",N="4;"+$.index}switch($.type){case 0:let G=T.color.toColorRGB(W==="ansi"?this._themeService.colors.ansi[$.index]:this._themeService.colors[W]);this.coreService.triggerDataEvent(`${I.C0.ESC}]${N};${(0,k.toRgbString)(G)}${I.C1_ESCAPED.ST}`);break;case 1:if(W==="ansi")this._themeService.modifyColors((V=>V.ansi[$.index]=T.rgba.toColor(...$.color)));else{let V=W;this._themeService.modifyColors((ie=>ie[V]=T.rgba.toColor(...$.color)))}break;case 2:this._themeService.restoreColor($.index)}}}_setup(){super._setup(),this._customKeyEventHandler=void 0}get buffer(){return this.buffers.active}focus(){this.textarea&&this.textarea.focus({preventScroll:!0})}_handleScreenReaderModeOptionChange(E){E?!this._accessibilityManager.value&&this._renderService&&(this._accessibilityManager.value=this._instantiationService.createInstance(U.AccessibilityManager,this)):this._accessibilityManager.clear()}_handleTextAreaFocus(E){this.coreService.decPrivateModes.sendFocus&&this.coreService.triggerDataEvent(I.C0.ESC+"[I"),this.updateCursorStyle(E),this.element.classList.add("focus"),this._showCursor(),this._onFocus.fire()}blur(){var E;return(E=this.textarea)===null||E===void 0?void 0:E.blur()}_handleTextAreaBlur(){this.textarea.value="",this.refresh(this.buffer.y,this.buffer.y),this.coreService.decPrivateModes.sendFocus&&this.coreService.triggerDataEvent(I.C0.ESC+"[O"),this.element.classList.remove("focus"),this._onBlur.fire()}_syncTextArea(){if(!this.textarea||!this.buffer.isCursorInViewport||this._compositionHelper.isComposing||!this._renderService)return;let E=this.buffer.ybase+this.buffer.y,$=this.buffer.lines.get(E);if(!$)return;let W=Math.min(this.buffer.x,this.cols-1),N=this._renderService.dimensions.css.cell.height,G=$.getWidth(W),V=this._renderService.dimensions.css.cell.width*G,ie=this.buffer.y*this._renderService.dimensions.css.cell.height,ve=W*this._renderService.dimensions.css.cell.width;this.textarea.style.left=ve+"px",this.textarea.style.top=ie+"px",this.textarea.style.width=V+"px",this.textarea.style.height=N+"px",this.textarea.style.lineHeight=N+"px",this.textarea.style.zIndex="-5"}_initGlobal(){this._bindKeys(),this.register((0,f.addDisposableDomListener)(this.element,"copy",($=>{this.hasSelection()&&(0,h.copyHandler)($,this._selectionService)})));let E=$=>(0,h.handlePasteEvent)($,this.textarea,this.coreService,this.optionsService);this.register((0,f.addDisposableDomListener)(this.textarea,"paste",E)),this.register((0,f.addDisposableDomListener)(this.element,"paste",E)),P.isFirefox?this.register((0,f.addDisposableDomListener)(this.element,"mousedown",($=>{$.button===2&&(0,h.rightClickHandler)($,this.textarea,this.screenElement,this._selectionService,this.options.rightClickSelectsWord)}))):this.register((0,f.addDisposableDomListener)(this.element,"contextmenu",($=>{(0,h.rightClickHandler)($,this.textarea,this.screenElement,this._selectionService,this.options.rightClickSelectsWord)}))),P.isLinux&&this.register((0,f.addDisposableDomListener)(this.element,"auxclick",($=>{$.button===1&&(0,h.moveTextAreaUnderMouseCursor)($,this.textarea,this.screenElement)})))}_bindKeys(){this.register((0,f.addDisposableDomListener)(this.textarea,"keyup",(E=>this._keyUp(E)),!0)),this.register((0,f.addDisposableDomListener)(this.textarea,"keydown",(E=>this._keyDown(E)),!0)),this.register((0,f.addDisposableDomListener)(this.textarea,"keypress",(E=>this._keyPress(E)),!0)),this.register((0,f.addDisposableDomListener)(this.textarea,"compositionstart",(()=>this._compositionHelper.compositionstart()))),this.register((0,f.addDisposableDomListener)(this.textarea,"compositionupdate",(E=>this._compositionHelper.compositionupdate(E)))),this.register((0,f.addDisposableDomListener)(this.textarea,"compositionend",(()=>this._compositionHelper.compositionend()))),this.register((0,f.addDisposableDomListener)(this.textarea,"input",(E=>this._inputEvent(E)),!0)),this.register(this.onRender((()=>this._compositionHelper.updateCompositionElements())))}open(E){var $;if(!E)throw new Error("Terminal requires a parent element.");E.isConnected||this._logService.debug("Terminal.open was called on an element that was not attached to the DOM"),this._document=E.ownerDocument,this.element=this._document.createElement("div"),this.element.dir="ltr",this.element.classList.add("terminal"),this.element.classList.add("xterm"),E.appendChild(this.element);let W=K.createDocumentFragment();this._viewportElement=K.createElement("div"),this._viewportElement.classList.add("xterm-viewport"),W.appendChild(this._viewportElement),this._viewportScrollArea=K.createElement("div"),this._viewportScrollArea.classList.add("xterm-scroll-area"),this._viewportElement.appendChild(this._viewportScrollArea),this.screenElement=K.createElement("div"),this.screenElement.classList.add("xterm-screen"),this._helperContainer=K.createElement("div"),this._helperContainer.classList.add("xterm-helpers"),this.screenElement.appendChild(this._helperContainer),W.appendChild(this.screenElement),this.textarea=K.createElement("textarea"),this.textarea.classList.add("xterm-helper-textarea"),this.textarea.setAttribute("aria-label",p.promptLabel),P.isChromeOS||this.textarea.setAttribute("aria-multiline","false"),this.textarea.setAttribute("autocorrect","off"),this.textarea.setAttribute("autocapitalize","off"),this.textarea.setAttribute("spellcheck","false"),this.textarea.tabIndex=0,this._coreBrowserService=this._instantiationService.createInstance(b.CoreBrowserService,this.textarea,($=this._document.defaultView)!==null&&$!==void 0?$:window),this._instantiationService.setService(w.ICoreBrowserService,this._coreBrowserService),this.register((0,f.addDisposableDomListener)(this.textarea,"focus",(N=>this._handleTextAreaFocus(N)))),this.register((0,f.addDisposableDomListener)(this.textarea,"blur",(()=>this._handleTextAreaBlur()))),this._helperContainer.appendChild(this.textarea),this._charSizeService=this._instantiationService.createInstance(l.CharSizeService,this._document,this._helperContainer),this._instantiationService.setService(w.ICharSizeService,this._charSizeService),this._themeService=this._instantiationService.createInstance(A.ThemeService),this._instantiationService.setService(w.IThemeService,this._themeService),this._characterJoinerService=this._instantiationService.createInstance(_.CharacterJoinerService),this._instantiationService.setService(w.ICharacterJoinerService,this._characterJoinerService),this._renderService=this.register(this._instantiationService.createInstance(x.RenderService,this.rows,this.screenElement)),this._instantiationService.setService(w.IRenderService,this._renderService),this.register(this._renderService.onRenderedViewportChange((N=>this._onRender.fire(N)))),this.onResize((N=>this._renderService.resize(N.cols,N.rows))),this._compositionView=K.createElement("div"),this._compositionView.classList.add("composition-view"),this._compositionHelper=this._instantiationService.createInstance(a.CompositionHelper,this.textarea,this._compositionView),this._helperContainer.appendChild(this._compositionView),this.element.appendChild(W);try{this._onWillOpen.fire(this.element)}catch{}this._renderService.hasRenderer()||this._renderService.setRenderer(this._createRenderer()),this._mouseService=this._instantiationService.createInstance(y.MouseService),this._instantiationService.setService(w.IMouseService,this._mouseService),this.viewport=this._instantiationService.createInstance(S.Viewport,this._viewportElement,this._viewportScrollArea),this.viewport.onRequestScrollLines((N=>this.scrollLines(N.amount,N.suppressScrollEvent,1))),this.register(this._inputHandler.onRequestSyncScrollBar((()=>this.viewport.syncScrollArea()))),this.register(this.viewport),this.register(this.onCursorMove((()=>{this._renderService.handleCursorMove(),this._syncTextArea()}))),this.register(this.onResize((()=>this._renderService.handleResize(this.cols,this.rows)))),this.register(this.onBlur((()=>this._renderService.handleBlur()))),this.register(this.onFocus((()=>this._renderService.handleFocus()))),this.register(this._renderService.onDimensionsChange((()=>this.viewport.syncScrollArea()))),this._selectionService=this.register(this._instantiationService.createInstance(m.SelectionService,this.element,this.screenElement,this.linkifier2)),this._instantiationService.setService(w.ISelectionService,this._selectionService),this.register(this._selectionService.onRequestScrollLines((N=>this.scrollLines(N.amount,N.suppressScrollEvent)))),this.register(this._selectionService.onSelectionChange((()=>this._onSelectionChange.fire()))),this.register(this._selectionService.onRequestRedraw((N=>this._renderService.handleSelectionChanged(N.start,N.end,N.columnSelectMode)))),this.register(this._selectionService.onLinuxMouseSelection((N=>{this.textarea.value=N,this.textarea.focus(),this.textarea.select()}))),this.register(this._onScroll.event((N=>{this.viewport.syncScrollArea(),this._selectionService.refresh()}))),this.register((0,f.addDisposableDomListener)(this._viewportElement,"scroll",(()=>this._selectionService.refresh()))),this.linkifier2.attachToDom(this.screenElement,this._mouseService,this._renderService),this.register(this._instantiationService.createInstance(g.BufferDecorationRenderer,this.screenElement)),this.register((0,f.addDisposableDomListener)(this.element,"mousedown",(N=>this._selectionService.handleMouseDown(N)))),this.coreMouseService.areMouseEventsActive?(this._selectionService.disable(),this.element.classList.add("enable-mouse-events")):this._selectionService.enable(),this.options.screenReaderMode&&(this._accessibilityManager.value=this._instantiationService.createInstance(U.AccessibilityManager,this)),this.register(this.optionsService.onSpecificOptionChange("screenReaderMode",(N=>this._handleScreenReaderModeOptionChange(N)))),this.options.overviewRulerWidth&&(this._overviewRulerRenderer=this.register(this._instantiationService.createInstance(s.OverviewRulerRenderer,this._viewportElement,this.screenElement))),this.optionsService.onSpecificOptionChange("overviewRulerWidth",(N=>{!this._overviewRulerRenderer&&N&&this._viewportElement&&this.screenElement&&(this._overviewRulerRenderer=this.register(this._instantiationService.createInstance(s.OverviewRulerRenderer,this._viewportElement,this.screenElement)))})),this._charSizeService.measure(),this.refresh(0,this.rows-1),this._initGlobal(),this.bindMouse()}_createRenderer(){return this._instantiationService.createInstance(n.DomRenderer,this.element,this.screenElement,this._viewportElement,this.linkifier2)}bindMouse(){let E=this,$=this.element;function W(V){let ie=E._mouseService.getMouseReportCoords(V,E.screenElement);if(!ie)return!1;let ve,Ce;switch(V.overrideType||V.type){case"mousemove":Ce=32,V.buttons===void 0?(ve=3,V.button!==void 0&&(ve=V.button<3?V.button:3)):ve=1&V.buttons?0:4&V.buttons?1:2&V.buttons?2:3;break;case"mouseup":Ce=0,ve=V.button<3?V.button:3;break;case"mousedown":Ce=1,ve=V.button<3?V.button:3;break;case"wheel":if(E.viewport.getLinesScrolled(V)===0)return!1;Ce=V.deltaY<0?0:1,ve=4;break;default:return!1}return!(Ce===void 0||ve===void 0||ve>4)&&E.coreMouseService.triggerMouseEvent({col:ie.col,row:ie.row,x:ie.x,y:ie.y,button:ve,action:Ce,ctrl:V.ctrlKey,alt:V.altKey,shift:V.shiftKey})}let N={mouseup:null,wheel:null,mousedrag:null,mousemove:null},G={mouseup:V=>(W(V),V.buttons||(this._document.removeEventListener("mouseup",N.mouseup),N.mousedrag&&this._document.removeEventListener("mousemove",N.mousedrag)),this.cancel(V)),wheel:V=>(W(V),this.cancel(V,!0)),mousedrag:V=>{V.buttons&&W(V)},mousemove:V=>{V.buttons||W(V)}};this.register(this.coreMouseService.onProtocolChange((V=>{V?(this.optionsService.rawOptions.logLevel==="debug"&&this._logService.debug("Binding to mouse events:",this.coreMouseService.explainEvents(V)),this.element.classList.add("enable-mouse-events"),this._selectionService.disable()):(this._logService.debug("Unbinding from mouse events."),this.element.classList.remove("enable-mouse-events"),this._selectionService.enable()),8&V?N.mousemove||($.addEventListener("mousemove",G.mousemove),N.mousemove=G.mousemove):($.removeEventListener("mousemove",N.mousemove),N.mousemove=null),16&V?N.wheel||($.addEventListener("wheel",G.wheel,{passive:!1}),N.wheel=G.wheel):($.removeEventListener("wheel",N.wheel),N.wheel=null),2&V?N.mouseup||($.addEventListener("mouseup",G.mouseup),N.mouseup=G.mouseup):(this._document.removeEventListener("mouseup",N.mouseup),$.removeEventListener("mouseup",N.mouseup),N.mouseup=null),4&V?N.mousedrag||(N.mousedrag=G.mousedrag):(this._document.removeEventListener("mousemove",N.mousedrag),N.mousedrag=null)}))),this.coreMouseService.activeProtocol=this.coreMouseService.activeProtocol,this.register((0,f.addDisposableDomListener)($,"mousedown",(V=>{if(V.preventDefault(),this.focus(),this.coreMouseService.areMouseEventsActive&&!this._selectionService.shouldForceSelection(V))return W(V),N.mouseup&&this._document.addEventListener("mouseup",N.mouseup),N.mousedrag&&this._document.addEventListener("mousemove",N.mousedrag),this.cancel(V)}))),this.register((0,f.addDisposableDomListener)($,"wheel",(V=>{if(!N.wheel){if(!this.buffer.hasScrollback){let ie=this.viewport.getLinesScrolled(V);if(ie===0)return;let ve=I.C0.ESC+(this.coreService.decPrivateModes.applicationCursorKeys?"O":"[")+(V.deltaY<0?"A":"B"),Ce="";for(let At=0;At<Math.abs(ie);At++)Ce+=ve;return this.coreService.triggerDataEvent(Ce,!0),this.cancel(V,!0)}return this.viewport.handleWheel(V)?this.cancel(V):void 0}}),{passive:!1})),this.register((0,f.addDisposableDomListener)($,"touchstart",(V=>{if(!this.coreMouseService.areMouseEventsActive)return this.viewport.handleTouchStart(V),this.cancel(V)}),{passive:!0})),this.register((0,f.addDisposableDomListener)($,"touchmove",(V=>{if(!this.coreMouseService.areMouseEventsActive)return this.viewport.handleTouchMove(V)?void 0:this.cancel(V)}),{passive:!1}))}refresh(E,$){var W;(W=this._renderService)===null||W===void 0||W.refreshRows(E,$)}updateCursorStyle(E){var $;!(($=this._selectionService)===null||$===void 0)&&$.shouldColumnSelect(E)?this.element.classList.add("column-select"):this.element.classList.remove("column-select")}_showCursor(){this.coreService.isCursorInitialized||(this.coreService.isCursorInitialized=!0,this.refresh(this.buffer.y,this.buffer.y))}scrollLines(E,$,W=0){var N;W===1?(super.scrollLines(E,$,W),this.refresh(0,this.rows-1)):(N=this.viewport)===null||N===void 0||N.scrollLines(E)}paste(E){(0,h.paste)(E,this.textarea,this.coreService,this.optionsService)}attachCustomKeyEventHandler(E){this._customKeyEventHandler=E}registerLinkProvider(E){return this.linkifier2.registerLinkProvider(E)}registerCharacterJoiner(E){if(!this._characterJoinerService)throw new Error("Terminal must be opened first");let $=this._characterJoinerService.register(E);return this.refresh(0,this.rows-1),$}deregisterCharacterJoiner(E){if(!this._characterJoinerService)throw new Error("Terminal must be opened first");this._characterJoinerService.deregister(E)&&this.refresh(0,this.rows-1)}get markers(){return this.buffer.markers}registerMarker(E){return this.buffer.addMarker(this.buffer.ybase+this.buffer.y+E)}registerDecoration(E){return this._decorationService.registerDecoration(E)}hasSelection(){return!!this._selectionService&&this._selectionService.hasSelection}select(E,$,W){this._selectionService.setSelection(E,$,W)}getSelection(){return this._selectionService?this._selectionService.selectionText:""}getSelectionPosition(){if(this._selectionService&&this._selectionService.hasSelection)return{start:{x:this._selectionService.selectionStart[0],y:this._selectionService.selectionStart[1]},end:{x:this._selectionService.selectionEnd[0],y:this._selectionService.selectionEnd[1]}}}clearSelection(){var E;(E=this._selectionService)===null||E===void 0||E.clearSelection()}selectAll(){var E;(E=this._selectionService)===null||E===void 0||E.selectAll()}selectLines(E,$){var W;(W=this._selectionService)===null||W===void 0||W.selectLines(E,$)}_keyDown(E){if(this._keyDownHandled=!1,this._keyDownSeen=!0,this._customKeyEventHandler&&this._customKeyEventHandler(E)===!1)return!1;let $=this.browser.isMac&&this.options.macOptionIsMeta&&E.altKey;if(!$&&!this._compositionHelper.keydown(E))return this.options.scrollOnUserInput&&this.buffer.ybase!==this.buffer.ydisp&&this.scrollToBottom(),!1;$||E.key!=="Dead"&&E.key!=="AltGraph"||(this._unprocessedDeadKey=!0);let W=(0,C.evaluateKeyboardEvent)(E,this.coreService.decPrivateModes.applicationCursorKeys,this.browser.isMac,this.options.macOptionIsMeta);if(this.updateCursorStyle(E),W.type===3||W.type===2){let N=this.rows-1;return this.scrollLines(W.type===2?-N:N),this.cancel(E,!0)}return W.type===1&&this.selectAll(),!!this._isThirdLevelShift(this.browser,E)||(W.cancel&&this.cancel(E,!0),!W.key||!!(E.key&&!E.ctrlKey&&!E.altKey&&!E.metaKey&&E.key.length===1&&E.key.charCodeAt(0)>=65&&E.key.charCodeAt(0)<=90)||(this._unprocessedDeadKey?(this._unprocessedDeadKey=!1,!0):(W.key!==I.C0.ETX&&W.key!==I.C0.CR||(this.textarea.value=""),this._onKey.fire({key:W.key,domEvent:E}),this._showCursor(),this.coreService.triggerDataEvent(W.key,!0),!this.optionsService.rawOptions.screenReaderMode||E.altKey||E.ctrlKey?this.cancel(E,!0):void(this._keyDownHandled=!0))))}_isThirdLevelShift(E,$){let W=E.isMac&&!this.options.macOptionIsMeta&&$.altKey&&!$.ctrlKey&&!$.metaKey||E.isWindows&&$.altKey&&$.ctrlKey&&!$.metaKey||E.isWindows&&$.getModifierState("AltGraph");return $.type==="keypress"?W:W&&(!$.keyCode||$.keyCode>47)}_keyUp(E){this._keyDownSeen=!1,this._customKeyEventHandler&&this._customKeyEventHandler(E)===!1||((function($){return $.keyCode===16||$.keyCode===17||$.keyCode===18})(E)||this.focus(),this.updateCursorStyle(E),this._keyPressHandled=!1)}_keyPress(E){let $;if(this._keyPressHandled=!1,this._keyDownHandled||this._customKeyEventHandler&&this._customKeyEventHandler(E)===!1)return!1;if(this.cancel(E),E.charCode)$=E.charCode;else if(E.which===null||E.which===void 0)$=E.keyCode;else{if(E.which===0||E.charCode===0)return!1;$=E.which}return!(!$||(E.altKey||E.ctrlKey||E.metaKey)&&!this._isThirdLevelShift(this.browser,E)||($=String.fromCharCode($),this._onKey.fire({key:$,domEvent:E}),this._showCursor(),this.coreService.triggerDataEvent($,!0),this._keyPressHandled=!0,this._unprocessedDeadKey=!1,0))}_inputEvent(E){if(E.data&&E.inputType==="insertText"&&(!E.composed||!this._keyDownSeen)&&!this.optionsService.rawOptions.screenReaderMode){if(this._keyPressHandled)return!1;this._unprocessedDeadKey=!1;let $=E.data;return this.coreService.triggerDataEvent($,!0),this.cancel(E),!0}return!1}resize(E,$){E!==this.cols||$!==this.rows?super.resize(E,$):this._charSizeService&&!this._charSizeService.hasValidSize&&this._charSizeService.measure()}_afterResize(E,$){var W,N;(W=this._charSizeService)===null||W===void 0||W.measure(),(N=this.viewport)===null||N===void 0||N.syncScrollArea(!0)}clear(){var E;if(this.buffer.ybase!==0||this.buffer.y!==0){this.buffer.clearAllMarkers(),this.buffer.lines.set(0,this.buffer.lines.get(this.buffer.ybase+this.buffer.y)),this.buffer.lines.length=1,this.buffer.ydisp=0,this.buffer.ybase=0,this.buffer.y=0;for(let $=1;$<this.rows;$++)this.buffer.lines.push(this.buffer.getBlankLine(M.DEFAULT_ATTR_DATA));this._onScroll.fire({position:this.buffer.ydisp,source:0}),(E=this.viewport)===null||E===void 0||E.reset(),this.refresh(0,this.rows-1)}}reset(){var E,$;this.options.rows=this.rows,this.options.cols=this.cols;let W=this._customKeyEventHandler;this._setup(),super.reset(),(E=this._selectionService)===null||E===void 0||E.reset(),this._decorationService.reset(),($=this.viewport)===null||$===void 0||$.reset(),this._customKeyEventHandler=W,this.refresh(0,this.rows-1)}clearTextureAtlas(){var E;(E=this._renderService)===null||E===void 0||E.clearTextureAtlas()}_reportFocus(){var E;!((E=this.element)===null||E===void 0)&&E.classList.contains("focus")?this.coreService.triggerDataEvent(I.C0.ESC+"[I"):this.coreService.triggerDataEvent(I.C0.ESC+"[O")}_reportWindowsOptions(E){if(this._renderService)switch(E){case z.WindowsOptionsReportType.GET_WIN_SIZE_PIXELS:let $=this._renderService.dimensions.css.canvas.width.toFixed(0),W=this._renderService.dimensions.css.canvas.height.toFixed(0);this.coreService.triggerDataEvent(`${I.C0.ESC}[4;${W};${$}t`);break;case z.WindowsOptionsReportType.GET_CELL_SIZE_PIXELS:let N=this._renderService.dimensions.css.cell.width.toFixed(0),G=this._renderService.dimensions.css.cell.height.toFixed(0);this.coreService.triggerDataEvent(`${I.C0.ESC}[6;${G};${N}t`)}}cancel(E,$){if(this.options.cancelEvents||$)return E.preventDefault(),E.stopPropagation(),!1}}i.Terminal=q},9924:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.TimeBasedDebouncer=void 0,i.TimeBasedDebouncer=class{constructor(o,h=1e3){this._renderCallback=o,this._debounceThresholdMS=h,this._lastRefreshMs=0,this._additionalRefreshRequested=!1}dispose(){this._refreshTimeoutID&&clearTimeout(this._refreshTimeoutID)}refresh(o,h,f){this._rowCount=f,o=o!==void 0?o:0,h=h!==void 0?h:this._rowCount-1,this._rowStart=this._rowStart!==void 0?Math.min(this._rowStart,o):o,this._rowEnd=this._rowEnd!==void 0?Math.max(this._rowEnd,h):h;let c=Date.now();if(c-this._lastRefreshMs>=this._debounceThresholdMS)this._lastRefreshMs=c,this._innerRefresh();else if(!this._additionalRefreshRequested){let p=c-this._lastRefreshMs,v=this._debounceThresholdMS-p;this._additionalRefreshRequested=!0,this._refreshTimeoutID=window.setTimeout((()=>{this._lastRefreshMs=Date.now(),this._innerRefresh(),this._additionalRefreshRequested=!1,this._refreshTimeoutID=void 0}),v)}}_innerRefresh(){if(this._rowStart===void 0||this._rowEnd===void 0||this._rowCount===void 0)return;let o=Math.max(this._rowStart,0),h=Math.min(this._rowEnd,this._rowCount-1);this._rowStart=void 0,this._rowEnd=void 0,this._renderCallback(o,h)}}},1680:function(u,i,o){var h=this&&this.__decorate||function(a,n,l,_){var b,y=arguments.length,x=y<3?n:_===null?_=Object.getOwnPropertyDescriptor(n,l):_;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")x=Reflect.decorate(a,n,l,_);else for(var m=a.length-1;m>=0;m--)(b=a[m])&&(x=(y<3?b(x):y>3?b(n,l,x):b(n,l))||x);return y>3&&x&&Object.defineProperty(n,l,x),x},f=this&&this.__param||function(a,n){return function(l,_){n(l,_,a)}};Object.defineProperty(i,"__esModule",{value:!0}),i.Viewport=void 0;let c=o(3656),p=o(4725),v=o(8460),S=o(844),g=o(2585),s=i.Viewport=class extends S.Disposable{constructor(a,n,l,_,b,y,x,m){super(),this._viewportElement=a,this._scrollArea=n,this._bufferService=l,this._optionsService=_,this._charSizeService=b,this._renderService=y,this._coreBrowserService=x,this.scrollBarWidth=0,this._currentRowHeight=0,this._currentDeviceCellHeight=0,this._lastRecordedBufferLength=0,this._lastRecordedViewportHeight=0,this._lastRecordedBufferHeight=0,this._lastTouchY=0,this._lastScrollTop=0,this._wheelPartialScroll=0,this._refreshAnimationFrame=null,this._ignoreNextScrollEvent=!1,this._smoothScrollState={startTime:0,origin:-1,target:-1},this._onRequestScrollLines=this.register(new v.EventEmitter),this.onRequestScrollLines=this._onRequestScrollLines.event,this.scrollBarWidth=this._viewportElement.offsetWidth-this._scrollArea.offsetWidth||15,this.register((0,c.addDisposableDomListener)(this._viewportElement,"scroll",this._handleScroll.bind(this))),this._activeBuffer=this._bufferService.buffer,this.register(this._bufferService.buffers.onBufferActivate((w=>this._activeBuffer=w.activeBuffer))),this._renderDimensions=this._renderService.dimensions,this.register(this._renderService.onDimensionsChange((w=>this._renderDimensions=w))),this._handleThemeChange(m.colors),this.register(m.onChangeColors((w=>this._handleThemeChange(w)))),this.register(this._optionsService.onSpecificOptionChange("scrollback",(()=>this.syncScrollArea()))),setTimeout((()=>this.syncScrollArea()))}_handleThemeChange(a){this._viewportElement.style.backgroundColor=a.background.css}reset(){this._currentRowHeight=0,this._currentDeviceCellHeight=0,this._lastRecordedBufferLength=0,this._lastRecordedViewportHeight=0,this._lastRecordedBufferHeight=0,this._lastTouchY=0,this._lastScrollTop=0,this._coreBrowserService.window.requestAnimationFrame((()=>this.syncScrollArea()))}_refresh(a){if(a)return this._innerRefresh(),void(this._refreshAnimationFrame!==null&&this._coreBrowserService.window.cancelAnimationFrame(this._refreshAnimationFrame));this._refreshAnimationFrame===null&&(this._refreshAnimationFrame=this._coreBrowserService.window.requestAnimationFrame((()=>this._innerRefresh())))}_innerRefresh(){if(this._charSizeService.height>0){this._currentRowHeight=this._renderService.dimensions.device.cell.height/this._coreBrowserService.dpr,this._currentDeviceCellHeight=this._renderService.dimensions.device.cell.height,this._lastRecordedViewportHeight=this._viewportElement.offsetHeight;let n=Math.round(this._currentRowHeight*this._lastRecordedBufferLength)+(this._lastRecordedViewportHeight-this._renderService.dimensions.css.canvas.height);this._lastRecordedBufferHeight!==n&&(this._lastRecordedBufferHeight=n,this._scrollArea.style.height=this._lastRecordedBufferHeight+"px")}let a=this._bufferService.buffer.ydisp*this._currentRowHeight;this._viewportElement.scrollTop!==a&&(this._ignoreNextScrollEvent=!0,this._viewportElement.scrollTop=a),this._refreshAnimationFrame=null}syncScrollArea(a=!1){if(this._lastRecordedBufferLength!==this._bufferService.buffer.lines.length)return this._lastRecordedBufferLength=this._bufferService.buffer.lines.length,void this._refresh(a);this._lastRecordedViewportHeight===this._renderService.dimensions.css.canvas.height&&this._lastScrollTop===this._activeBuffer.ydisp*this._currentRowHeight&&this._renderDimensions.device.cell.height===this._currentDeviceCellHeight||this._refresh(a)}_handleScroll(a){if(this._lastScrollTop=this._viewportElement.scrollTop,!this._viewportElement.offsetParent)return;if(this._ignoreNextScrollEvent)return this._ignoreNextScrollEvent=!1,void this._onRequestScrollLines.fire({amount:0,suppressScrollEvent:!0});let n=Math.round(this._lastScrollTop/this._currentRowHeight)-this._bufferService.buffer.ydisp;this._onRequestScrollLines.fire({amount:n,suppressScrollEvent:!0})}_smoothScroll(){if(this._isDisposed||this._smoothScrollState.origin===-1||this._smoothScrollState.target===-1)return;let a=this._smoothScrollPercent();this._viewportElement.scrollTop=this._smoothScrollState.origin+Math.round(a*(this._smoothScrollState.target-this._smoothScrollState.origin)),a<1?this._coreBrowserService.window.requestAnimationFrame((()=>this._smoothScroll())):this._clearSmoothScrollState()}_smoothScrollPercent(){return this._optionsService.rawOptions.smoothScrollDuration&&this._smoothScrollState.startTime?Math.max(Math.min((Date.now()-this._smoothScrollState.startTime)/this._optionsService.rawOptions.smoothScrollDuration,1),0):1}_clearSmoothScrollState(){this._smoothScrollState.startTime=0,this._smoothScrollState.origin=-1,this._smoothScrollState.target=-1}_bubbleScroll(a,n){let l=this._viewportElement.scrollTop+this._lastRecordedViewportHeight;return!(n<0&&this._viewportElement.scrollTop!==0||n>0&&l<this._lastRecordedBufferHeight)||(a.cancelable&&a.preventDefault(),!1)}handleWheel(a){let n=this._getPixelsScrolled(a);return n!==0&&(this._optionsService.rawOptions.smoothScrollDuration?(this._smoothScrollState.startTime=Date.now(),this._smoothScrollPercent()<1?(this._smoothScrollState.origin=this._viewportElement.scrollTop,this._smoothScrollState.target===-1?this._smoothScrollState.target=this._viewportElement.scrollTop+n:this._smoothScrollState.target+=n,this._smoothScrollState.target=Math.max(Math.min(this._smoothScrollState.target,this._viewportElement.scrollHeight),0),this._smoothScroll()):this._clearSmoothScrollState()):this._viewportElement.scrollTop+=n,this._bubbleScroll(a,n))}scrollLines(a){if(a!==0)if(this._optionsService.rawOptions.smoothScrollDuration){let n=a*this._currentRowHeight;this._smoothScrollState.startTime=Date.now(),this._smoothScrollPercent()<1?(this._smoothScrollState.origin=this._viewportElement.scrollTop,this._smoothScrollState.target=this._smoothScrollState.origin+n,this._smoothScrollState.target=Math.max(Math.min(this._smoothScrollState.target,this._viewportElement.scrollHeight),0),this._smoothScroll()):this._clearSmoothScrollState()}else this._onRequestScrollLines.fire({amount:a,suppressScrollEvent:!1})}_getPixelsScrolled(a){if(a.deltaY===0||a.shiftKey)return 0;let n=this._applyScrollModifier(a.deltaY,a);return a.deltaMode===WheelEvent.DOM_DELTA_LINE?n*=this._currentRowHeight:a.deltaMode===WheelEvent.DOM_DELTA_PAGE&&(n*=this._currentRowHeight*this._bufferService.rows),n}getBufferElements(a,n){var l;let _,b="",y=[],x=n??this._bufferService.buffer.lines.length,m=this._bufferService.buffer.lines;for(let w=a;w<x;w++){let A=m.get(w);if(!A)continue;let T=(l=m.get(w+1))===null||l===void 0?void 0:l.isWrapped;if(b+=A.translateToString(!T),!T||w===m.length-1){let D=document.createElement("div");D.textContent=b,y.push(D),b.length>0&&(_=D),b=""}}return{bufferElements:y,cursorElement:_}}getLinesScrolled(a){if(a.deltaY===0||a.shiftKey)return 0;let n=this._applyScrollModifier(a.deltaY,a);return a.deltaMode===WheelEvent.DOM_DELTA_PIXEL?(n/=this._currentRowHeight+0,this._wheelPartialScroll+=n,n=Math.floor(Math.abs(this._wheelPartialScroll))*(this._wheelPartialScroll>0?1:-1),this._wheelPartialScroll%=1):a.deltaMode===WheelEvent.DOM_DELTA_PAGE&&(n*=this._bufferService.rows),n}_applyScrollModifier(a,n){let l=this._optionsService.rawOptions.fastScrollModifier;return l==="alt"&&n.altKey||l==="ctrl"&&n.ctrlKey||l==="shift"&&n.shiftKey?a*this._optionsService.rawOptions.fastScrollSensitivity*this._optionsService.rawOptions.scrollSensitivity:a*this._optionsService.rawOptions.scrollSensitivity}handleTouchStart(a){this._lastTouchY=a.touches[0].pageY}handleTouchMove(a){let n=this._lastTouchY-a.touches[0].pageY;return this._lastTouchY=a.touches[0].pageY,n!==0&&(this._viewportElement.scrollTop+=n,this._bubbleScroll(a,n))}};i.Viewport=s=h([f(2,g.IBufferService),f(3,g.IOptionsService),f(4,p.ICharSizeService),f(5,p.IRenderService),f(6,p.ICoreBrowserService),f(7,p.IThemeService)],s)},3107:function(u,i,o){var h=this&&this.__decorate||function(s,a,n,l){var _,b=arguments.length,y=b<3?a:l===null?l=Object.getOwnPropertyDescriptor(a,n):l;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(s,a,n,l);else for(var x=s.length-1;x>=0;x--)(_=s[x])&&(y=(b<3?_(y):b>3?_(a,n,y):_(a,n))||y);return b>3&&y&&Object.defineProperty(a,n,y),y},f=this&&this.__param||function(s,a){return function(n,l){a(n,l,s)}};Object.defineProperty(i,"__esModule",{value:!0}),i.BufferDecorationRenderer=void 0;let c=o(3656),p=o(4725),v=o(844),S=o(2585),g=i.BufferDecorationRenderer=class extends v.Disposable{constructor(s,a,n,l){super(),this._screenElement=s,this._bufferService=a,this._decorationService=n,this._renderService=l,this._decorationElements=new Map,this._altBufferIsActive=!1,this._dimensionsChanged=!1,this._container=document.createElement("div"),this._container.classList.add("xterm-decoration-container"),this._screenElement.appendChild(this._container),this.register(this._renderService.onRenderedViewportChange((()=>this._doRefreshDecorations()))),this.register(this._renderService.onDimensionsChange((()=>{this._dimensionsChanged=!0,this._queueRefresh()}))),this.register((0,c.addDisposableDomListener)(window,"resize",(()=>this._queueRefresh()))),this.register(this._bufferService.buffers.onBufferActivate((()=>{this._altBufferIsActive=this._bufferService.buffer===this._bufferService.buffers.alt}))),this.register(this._decorationService.onDecorationRegistered((()=>this._queueRefresh()))),this.register(this._decorationService.onDecorationRemoved((_=>this._removeDecoration(_)))),this.register((0,v.toDisposable)((()=>{this._container.remove(),this._decorationElements.clear()})))}_queueRefresh(){this._animationFrame===void 0&&(this._animationFrame=this._renderService.addRefreshCallback((()=>{this._doRefreshDecorations(),this._animationFrame=void 0})))}_doRefreshDecorations(){for(let s of this._decorationService.decorations)this._renderDecoration(s);this._dimensionsChanged=!1}_renderDecoration(s){this._refreshStyle(s),this._dimensionsChanged&&this._refreshXPosition(s)}_createElement(s){var a,n;let l=document.createElement("div");l.classList.add("xterm-decoration"),l.classList.toggle("xterm-decoration-top-layer",((a=s?.options)===null||a===void 0?void 0:a.layer)==="top"),l.style.width=`${Math.round((s.options.width||1)*this._renderService.dimensions.css.cell.width)}px`,l.style.height=(s.options.height||1)*this._renderService.dimensions.css.cell.height+"px",l.style.top=(s.marker.line-this._bufferService.buffers.active.ydisp)*this._renderService.dimensions.css.cell.height+"px",l.style.lineHeight=`${this._renderService.dimensions.css.cell.height}px`;let _=(n=s.options.x)!==null&&n!==void 0?n:0;return _&&_>this._bufferService.cols&&(l.style.display="none"),this._refreshXPosition(s,l),l}_refreshStyle(s){let a=s.marker.line-this._bufferService.buffers.active.ydisp;if(a<0||a>=this._bufferService.rows)s.element&&(s.element.style.display="none",s.onRenderEmitter.fire(s.element));else{let n=this._decorationElements.get(s);n||(n=this._createElement(s),s.element=n,this._decorationElements.set(s,n),this._container.appendChild(n),s.onDispose((()=>{this._decorationElements.delete(s),n.remove()}))),n.style.top=a*this._renderService.dimensions.css.cell.height+"px",n.style.display=this._altBufferIsActive?"none":"block",s.onRenderEmitter.fire(n)}}_refreshXPosition(s,a=s.element){var n;if(!a)return;let l=(n=s.options.x)!==null&&n!==void 0?n:0;(s.options.anchor||"left")==="right"?a.style.right=l?l*this._renderService.dimensions.css.cell.width+"px":"":a.style.left=l?l*this._renderService.dimensions.css.cell.width+"px":""}_removeDecoration(s){var a;(a=this._decorationElements.get(s))===null||a===void 0||a.remove(),this._decorationElements.delete(s),s.dispose()}};i.BufferDecorationRenderer=g=h([f(1,S.IBufferService),f(2,S.IDecorationService),f(3,p.IRenderService)],g)},5871:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ColorZoneStore=void 0,i.ColorZoneStore=class{constructor(){this._zones=[],this._zonePool=[],this._zonePoolIndex=0,this._linePadding={full:0,left:0,center:0,right:0}}get zones(){return this._zonePool.length=Math.min(this._zonePool.length,this._zones.length),this._zones}clear(){this._zones.length=0,this._zonePoolIndex=0}addDecoration(o){if(o.options.overviewRulerOptions){for(let h of this._zones)if(h.color===o.options.overviewRulerOptions.color&&h.position===o.options.overviewRulerOptions.position){if(this._lineIntersectsZone(h,o.marker.line))return;if(this._lineAdjacentToZone(h,o.marker.line,o.options.overviewRulerOptions.position))return void this._addLineToZone(h,o.marker.line)}if(this._zonePoolIndex<this._zonePool.length)return this._zonePool[this._zonePoolIndex].color=o.options.overviewRulerOptions.color,this._zonePool[this._zonePoolIndex].position=o.options.overviewRulerOptions.position,this._zonePool[this._zonePoolIndex].startBufferLine=o.marker.line,this._zonePool[this._zonePoolIndex].endBufferLine=o.marker.line,void this._zones.push(this._zonePool[this._zonePoolIndex++]);this._zones.push({color:o.options.overviewRulerOptions.color,position:o.options.overviewRulerOptions.position,startBufferLine:o.marker.line,endBufferLine:o.marker.line}),this._zonePool.push(this._zones[this._zones.length-1]),this._zonePoolIndex++}}setPadding(o){this._linePadding=o}_lineIntersectsZone(o,h){return h>=o.startBufferLine&&h<=o.endBufferLine}_lineAdjacentToZone(o,h,f){return h>=o.startBufferLine-this._linePadding[f||"full"]&&h<=o.endBufferLine+this._linePadding[f||"full"]}_addLineToZone(o,h){o.startBufferLine=Math.min(o.startBufferLine,h),o.endBufferLine=Math.max(o.endBufferLine,h)}}},5744:function(u,i,o){var h=this&&this.__decorate||function(_,b,y,x){var m,w=arguments.length,A=w<3?b:x===null?x=Object.getOwnPropertyDescriptor(b,y):x;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")A=Reflect.decorate(_,b,y,x);else for(var T=_.length-1;T>=0;T--)(m=_[T])&&(A=(w<3?m(A):w>3?m(b,y,A):m(b,y))||A);return w>3&&A&&Object.defineProperty(b,y,A),A},f=this&&this.__param||function(_,b){return function(y,x){b(y,x,_)}};Object.defineProperty(i,"__esModule",{value:!0}),i.OverviewRulerRenderer=void 0;let c=o(5871),p=o(3656),v=o(4725),S=o(844),g=o(2585),s={full:0,left:0,center:0,right:0},a={full:0,left:0,center:0,right:0},n={full:0,left:0,center:0,right:0},l=i.OverviewRulerRenderer=class extends S.Disposable{get _width(){return this._optionsService.options.overviewRulerWidth||0}constructor(_,b,y,x,m,w,A){var T;super(),this._viewportElement=_,this._screenElement=b,this._bufferService=y,this._decorationService=x,this._renderService=m,this._optionsService=w,this._coreBrowseService=A,this._colorZoneStore=new c.ColorZoneStore,this._shouldUpdateDimensions=!0,this._shouldUpdateAnchor=!0,this._lastKnownBufferLength=0,this._canvas=document.createElement("canvas"),this._canvas.classList.add("xterm-decoration-overview-ruler"),this._refreshCanvasDimensions(),(T=this._viewportElement.parentElement)===null||T===void 0||T.insertBefore(this._canvas,this._viewportElement);let D=this._canvas.getContext("2d");if(!D)throw new Error("Ctx cannot be null");this._ctx=D,this._registerDecorationListeners(),this._registerBufferChangeListeners(),this._registerDimensionChangeListeners(),this.register((0,S.toDisposable)((()=>{var O;(O=this._canvas)===null||O===void 0||O.remove()})))}_registerDecorationListeners(){this.register(this._decorationService.onDecorationRegistered((()=>this._queueRefresh(void 0,!0)))),this.register(this._decorationService.onDecorationRemoved((()=>this._queueRefresh(void 0,!0))))}_registerBufferChangeListeners(){this.register(this._renderService.onRenderedViewportChange((()=>this._queueRefresh()))),this.register(this._bufferService.buffers.onBufferActivate((()=>{this._canvas.style.display=this._bufferService.buffer===this._bufferService.buffers.alt?"none":"block"}))),this.register(this._bufferService.onScroll((()=>{this._lastKnownBufferLength!==this._bufferService.buffers.normal.lines.length&&(this._refreshDrawHeightConstants(),this._refreshColorZonePadding())})))}_registerDimensionChangeListeners(){this.register(this._renderService.onRender((()=>{this._containerHeight&&this._containerHeight===this._screenElement.clientHeight||(this._queueRefresh(!0),this._containerHeight=this._screenElement.clientHeight)}))),this.register(this._optionsService.onSpecificOptionChange("overviewRulerWidth",(()=>this._queueRefresh(!0)))),this.register((0,p.addDisposableDomListener)(this._coreBrowseService.window,"resize",(()=>this._queueRefresh(!0)))),this._queueRefresh(!0)}_refreshDrawConstants(){let _=Math.floor(this._canvas.width/3),b=Math.ceil(this._canvas.width/3);a.full=this._canvas.width,a.left=_,a.center=b,a.right=_,this._refreshDrawHeightConstants(),n.full=0,n.left=0,n.center=a.left,n.right=a.left+a.center}_refreshDrawHeightConstants(){s.full=Math.round(2*this._coreBrowseService.dpr);let _=this._canvas.height/this._bufferService.buffer.lines.length,b=Math.round(Math.max(Math.min(_,12),6)*this._coreBrowseService.dpr);s.left=b,s.center=b,s.right=b}_refreshColorZonePadding(){this._colorZoneStore.setPadding({full:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*s.full),left:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*s.left),center:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*s.center),right:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*s.right)}),this._lastKnownBufferLength=this._bufferService.buffers.normal.lines.length}_refreshCanvasDimensions(){this._canvas.style.width=`${this._width}px`,this._canvas.width=Math.round(this._width*this._coreBrowseService.dpr),this._canvas.style.height=`${this._screenElement.clientHeight}px`,this._canvas.height=Math.round(this._screenElement.clientHeight*this._coreBrowseService.dpr),this._refreshDrawConstants(),this._refreshColorZonePadding()}_refreshDecorations(){this._shouldUpdateDimensions&&this._refreshCanvasDimensions(),this._ctx.clearRect(0,0,this._canvas.width,this._canvas.height),this._colorZoneStore.clear();for(let b of this._decorationService.decorations)this._colorZoneStore.addDecoration(b);this._ctx.lineWidth=1;let _=this._colorZoneStore.zones;for(let b of _)b.position!=="full"&&this._renderColorZone(b);for(let b of _)b.position==="full"&&this._renderColorZone(b);this._shouldUpdateDimensions=!1,this._shouldUpdateAnchor=!1}_renderColorZone(_){this._ctx.fillStyle=_.color,this._ctx.fillRect(n[_.position||"full"],Math.round((this._canvas.height-1)*(_.startBufferLine/this._bufferService.buffers.active.lines.length)-s[_.position||"full"]/2),a[_.position||"full"],Math.round((this._canvas.height-1)*((_.endBufferLine-_.startBufferLine)/this._bufferService.buffers.active.lines.length)+s[_.position||"full"]))}_queueRefresh(_,b){this._shouldUpdateDimensions=_||this._shouldUpdateDimensions,this._shouldUpdateAnchor=b||this._shouldUpdateAnchor,this._animationFrame===void 0&&(this._animationFrame=this._coreBrowseService.window.requestAnimationFrame((()=>{this._refreshDecorations(),this._animationFrame=void 0})))}};i.OverviewRulerRenderer=l=h([f(2,g.IBufferService),f(3,g.IDecorationService),f(4,v.IRenderService),f(5,g.IOptionsService),f(6,v.ICoreBrowserService)],l)},2950:function(u,i,o){var h=this&&this.__decorate||function(g,s,a,n){var l,_=arguments.length,b=_<3?s:n===null?n=Object.getOwnPropertyDescriptor(s,a):n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")b=Reflect.decorate(g,s,a,n);else for(var y=g.length-1;y>=0;y--)(l=g[y])&&(b=(_<3?l(b):_>3?l(s,a,b):l(s,a))||b);return _>3&&b&&Object.defineProperty(s,a,b),b},f=this&&this.__param||function(g,s){return function(a,n){s(a,n,g)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CompositionHelper=void 0;let c=o(4725),p=o(2585),v=o(2584),S=i.CompositionHelper=class{get isComposing(){return this._isComposing}constructor(g,s,a,n,l,_){this._textarea=g,this._compositionView=s,this._bufferService=a,this._optionsService=n,this._coreService=l,this._renderService=_,this._isComposing=!1,this._isSendingComposition=!1,this._compositionPosition={start:0,end:0},this._dataAlreadySent=""}compositionstart(){this._isComposing=!0,this._compositionPosition.start=this._textarea.value.length,this._compositionView.textContent="",this._dataAlreadySent="",this._compositionView.classList.add("active")}compositionupdate(g){this._compositionView.textContent=g.data,this.updateCompositionElements(),setTimeout((()=>{this._compositionPosition.end=this._textarea.value.length}),0)}compositionend(){this._finalizeComposition(!0)}keydown(g){if(this._isComposing||this._isSendingComposition){if(g.keyCode===229||g.keyCode===16||g.keyCode===17||g.keyCode===18)return!1;this._finalizeComposition(!1)}return g.keyCode!==229||(this._handleAnyTextareaChanges(),!1)}_finalizeComposition(g){if(this._compositionView.classList.remove("active"),this._isComposing=!1,g){let s={start:this._compositionPosition.start,end:this._compositionPosition.end};this._isSendingComposition=!0,setTimeout((()=>{if(this._isSendingComposition){let a;this._isSendingComposition=!1,s.start+=this._dataAlreadySent.length,a=this._isComposing?this._textarea.value.substring(s.start,s.end):this._textarea.value.substring(s.start),a.length>0&&this._coreService.triggerDataEvent(a,!0)}}),0)}else{this._isSendingComposition=!1;let s=this._textarea.value.substring(this._compositionPosition.start,this._compositionPosition.end);this._coreService.triggerDataEvent(s,!0)}}_handleAnyTextareaChanges(){let g=this._textarea.value;setTimeout((()=>{if(!this._isComposing){let s=this._textarea.value,a=s.replace(g,"");this._dataAlreadySent=a,s.length>g.length?this._coreService.triggerDataEvent(a,!0):s.length<g.length?this._coreService.triggerDataEvent(`${v.C0.DEL}`,!0):s.length===g.length&&s!==g&&this._coreService.triggerDataEvent(s,!0)}}),0)}updateCompositionElements(g){if(this._isComposing){if(this._bufferService.buffer.isCursorInViewport){let s=Math.min(this._bufferService.buffer.x,this._bufferService.cols-1),a=this._renderService.dimensions.css.cell.height,n=this._bufferService.buffer.y*this._renderService.dimensions.css.cell.height,l=s*this._renderService.dimensions.css.cell.width;this._compositionView.style.left=l+"px",this._compositionView.style.top=n+"px",this._compositionView.style.height=a+"px",this._compositionView.style.lineHeight=a+"px",this._compositionView.style.fontFamily=this._optionsService.rawOptions.fontFamily,this._compositionView.style.fontSize=this._optionsService.rawOptions.fontSize+"px";let _=this._compositionView.getBoundingClientRect();this._textarea.style.left=l+"px",this._textarea.style.top=n+"px",this._textarea.style.width=Math.max(_.width,1)+"px",this._textarea.style.height=Math.max(_.height,1)+"px",this._textarea.style.lineHeight=_.height+"px"}g||setTimeout((()=>this.updateCompositionElements(!0)),0)}}};i.CompositionHelper=S=h([f(2,p.IBufferService),f(3,p.IOptionsService),f(4,p.ICoreService),f(5,c.IRenderService)],S)},9806:(u,i)=>{function o(h,f,c){let p=c.getBoundingClientRect(),v=h.getComputedStyle(c),S=parseInt(v.getPropertyValue("padding-left")),g=parseInt(v.getPropertyValue("padding-top"));return[f.clientX-p.left-S,f.clientY-p.top-g]}Object.defineProperty(i,"__esModule",{value:!0}),i.getCoords=i.getCoordsRelativeToElement=void 0,i.getCoordsRelativeToElement=o,i.getCoords=function(h,f,c,p,v,S,g,s,a){if(!S)return;let n=o(h,f,c);return n?(n[0]=Math.ceil((n[0]+(a?g/2:0))/g),n[1]=Math.ceil(n[1]/s),n[0]=Math.min(Math.max(n[0],1),p+(a?1:0)),n[1]=Math.min(Math.max(n[1],1),v),n):void 0}},9504:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.moveToCellSequence=void 0;let h=o(2584);function f(s,a,n,l){let _=s-c(s,n),b=a-c(a,n),y=Math.abs(_-b)-(function(x,m,w){let A=0,T=x-c(x,w),D=m-c(m,w);for(let O=0;O<Math.abs(T-D);O++){let F=p(x,m)==="A"?-1:1,P=w.buffer.lines.get(T+F*O);P?.isWrapped&&A++}return A})(s,a,n);return g(y,S(p(s,a),l))}function c(s,a){let n=0,l=a.buffer.lines.get(s),_=l?.isWrapped;for(;_&&s>=0&&s<a.rows;)n++,l=a.buffer.lines.get(--s),_=l?.isWrapped;return n}function p(s,a){return s>a?"A":"B"}function v(s,a,n,l,_,b){let y=s,x=a,m="";for(;y!==n||x!==l;)y+=_?1:-1,_&&y>b.cols-1?(m+=b.buffer.translateBufferLineToString(x,!1,s,y),y=0,s=0,x++):!_&&y<0&&(m+=b.buffer.translateBufferLineToString(x,!1,0,s+1),y=b.cols-1,s=y,x--);return m+b.buffer.translateBufferLineToString(x,!1,s,y)}function S(s,a){let n=a?"O":"[";return h.C0.ESC+n+s}function g(s,a){s=Math.floor(s);let n="";for(let l=0;l<s;l++)n+=a;return n}i.moveToCellSequence=function(s,a,n,l){let _=n.buffer.x,b=n.buffer.y;if(!n.buffer.hasScrollback)return(function(m,w,A,T,D,O){return f(w,T,D,O).length===0?"":g(v(m,w,m,w-c(w,D),!1,D).length,S("D",O))})(_,b,0,a,n,l)+f(b,a,n,l)+(function(m,w,A,T,D,O){let F;F=f(w,T,D,O).length>0?T-c(T,D):w;let P=T,M=(function(I,C,k,L,R,z){let U;return U=f(k,L,R,z).length>0?L-c(L,R):C,I<k&&U<=L||I>=k&&U<L?"C":"D"})(m,w,A,T,D,O);return g(v(m,F,A,P,M==="C",D).length,S(M,O))})(_,b,s,a,n,l);let y;if(b===a)return y=_>s?"D":"C",g(Math.abs(_-s),S(y,l));y=b>a?"D":"C";let x=Math.abs(b-a);return g((function(m,w){return w.cols-m})(b>a?s:_,n)+(x-1)*n.cols+1+((b>a?_:s)-1),S(y,l))}},1296:function(u,i,o){var h=this&&this.__decorate||function(D,O,F,P){var M,I=arguments.length,C=I<3?O:P===null?P=Object.getOwnPropertyDescriptor(O,F):P;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")C=Reflect.decorate(D,O,F,P);else for(var k=D.length-1;k>=0;k--)(M=D[k])&&(C=(I<3?M(C):I>3?M(O,F,C):M(O,F))||C);return I>3&&C&&Object.defineProperty(O,F,C),C},f=this&&this.__param||function(D,O){return function(F,P){O(F,P,D)}};Object.defineProperty(i,"__esModule",{value:!0}),i.DomRenderer=void 0;let c=o(3787),p=o(2550),v=o(2223),S=o(6171),g=o(4725),s=o(8055),a=o(8460),n=o(844),l=o(2585),_="xterm-dom-renderer-owner-",b="xterm-rows",y="xterm-fg-",x="xterm-bg-",m="xterm-focus",w="xterm-selection",A=1,T=i.DomRenderer=class extends n.Disposable{constructor(D,O,F,P,M,I,C,k,L,R){super(),this._element=D,this._screenElement=O,this._viewportElement=F,this._linkifier2=P,this._charSizeService=I,this._optionsService=C,this._bufferService=k,this._coreBrowserService=L,this._themeService=R,this._terminalClass=A++,this._rowElements=[],this.onRequestRedraw=this.register(new a.EventEmitter).event,this._rowContainer=document.createElement("div"),this._rowContainer.classList.add(b),this._rowContainer.style.lineHeight="normal",this._rowContainer.setAttribute("aria-hidden","true"),this._refreshRowElements(this._bufferService.cols,this._bufferService.rows),this._selectionContainer=document.createElement("div"),this._selectionContainer.classList.add(w),this._selectionContainer.setAttribute("aria-hidden","true"),this.dimensions=(0,S.createRenderDimensions)(),this._updateDimensions(),this.register(this._optionsService.onOptionChange((()=>this._handleOptionsChanged()))),this.register(this._themeService.onChangeColors((z=>this._injectCss(z)))),this._injectCss(this._themeService.colors),this._rowFactory=M.createInstance(c.DomRendererRowFactory,document),this._element.classList.add(_+this._terminalClass),this._screenElement.appendChild(this._rowContainer),this._screenElement.appendChild(this._selectionContainer),this.register(this._linkifier2.onShowLinkUnderline((z=>this._handleLinkHover(z)))),this.register(this._linkifier2.onHideLinkUnderline((z=>this._handleLinkLeave(z)))),this.register((0,n.toDisposable)((()=>{this._element.classList.remove(_+this._terminalClass),this._rowContainer.remove(),this._selectionContainer.remove(),this._widthCache.dispose(),this._themeStyleElement.remove(),this._dimensionsStyleElement.remove()}))),this._widthCache=new p.WidthCache(document),this._widthCache.setFont(this._optionsService.rawOptions.fontFamily,this._optionsService.rawOptions.fontSize,this._optionsService.rawOptions.fontWeight,this._optionsService.rawOptions.fontWeightBold),this._setDefaultSpacing()}_updateDimensions(){let D=this._coreBrowserService.dpr;this.dimensions.device.char.width=this._charSizeService.width*D,this.dimensions.device.char.height=Math.ceil(this._charSizeService.height*D),this.dimensions.device.cell.width=this.dimensions.device.char.width+Math.round(this._optionsService.rawOptions.letterSpacing),this.dimensions.device.cell.height=Math.floor(this.dimensions.device.char.height*this._optionsService.rawOptions.lineHeight),this.dimensions.device.char.left=0,this.dimensions.device.char.top=0,this.dimensions.device.canvas.width=this.dimensions.device.cell.width*this._bufferService.cols,this.dimensions.device.canvas.height=this.dimensions.device.cell.height*this._bufferService.rows,this.dimensions.css.canvas.width=Math.round(this.dimensions.device.canvas.width/D),this.dimensions.css.canvas.height=Math.round(this.dimensions.device.canvas.height/D),this.dimensions.css.cell.width=this.dimensions.css.canvas.width/this._bufferService.cols,this.dimensions.css.cell.height=this.dimensions.css.canvas.height/this._bufferService.rows;for(let F of this._rowElements)F.style.width=`${this.dimensions.css.canvas.width}px`,F.style.height=`${this.dimensions.css.cell.height}px`,F.style.lineHeight=`${this.dimensions.css.cell.height}px`,F.style.overflow="hidden";this._dimensionsStyleElement||(this._dimensionsStyleElement=document.createElement("style"),this._screenElement.appendChild(this._dimensionsStyleElement));let O=`${this._terminalSelector} .${b} span { display: inline-block; height: 100%; vertical-align: top;}`;this._dimensionsStyleElement.textContent=O,this._selectionContainer.style.height=this._viewportElement.style.height,this._screenElement.style.width=`${this.dimensions.css.canvas.width}px`,this._screenElement.style.height=`${this.dimensions.css.canvas.height}px`}_injectCss(D){this._themeStyleElement||(this._themeStyleElement=document.createElement("style"),this._screenElement.appendChild(this._themeStyleElement));let O=`${this._terminalSelector} .${b} { color: ${D.foreground.css}; font-family: ${this._optionsService.rawOptions.fontFamily}; font-size: ${this._optionsService.rawOptions.fontSize}px; font-kerning: none; white-space: pre}`;O+=`${this._terminalSelector} .${b} .xterm-dim { color: ${s.color.multiplyOpacity(D.foreground,.5).css};}`,O+=`${this._terminalSelector} span:not(.xterm-bold) { font-weight: ${this._optionsService.rawOptions.fontWeight};}${this._terminalSelector} span.xterm-bold { font-weight: ${this._optionsService.rawOptions.fontWeightBold};}${this._terminalSelector} span.xterm-italic { font-style: italic;}`,O+="@keyframes blink_box_shadow_"+this._terminalClass+" { 50% {  border-bottom-style: hidden; }}",O+="@keyframes blink_block_"+this._terminalClass+` { 0% {  background-color: ${D.cursor.css};  color: ${D.cursorAccent.css}; } 50% {  background-color: inherit;  color: ${D.cursor.css}; }}`,O+=`${this._terminalSelector} .${b}.${m} .xterm-cursor.xterm-cursor-blink:not(.xterm-cursor-block) { animation: blink_box_shadow_`+this._terminalClass+` 1s step-end infinite;}${this._terminalSelector} .${b}.${m} .xterm-cursor.xterm-cursor-blink.xterm-cursor-block { animation: blink_block_`+this._terminalClass+` 1s step-end infinite;}${this._terminalSelector} .${b} .xterm-cursor.xterm-cursor-block { background-color: ${D.cursor.css}; color: ${D.cursorAccent.css};}${this._terminalSelector} .${b} .xterm-cursor.xterm-cursor-outline { outline: 1px solid ${D.cursor.css}; outline-offset: -1px;}${this._terminalSelector} .${b} .xterm-cursor.xterm-cursor-bar { box-shadow: ${this._optionsService.rawOptions.cursorWidth}px 0 0 ${D.cursor.css} inset;}${this._terminalSelector} .${b} .xterm-cursor.xterm-cursor-underline { border-bottom: 1px ${D.cursor.css}; border-bottom-style: solid; height: calc(100% - 1px);}`,O+=`${this._terminalSelector} .${w} { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none;}${this._terminalSelector}.focus .${w} div { position: absolute; background-color: ${D.selectionBackgroundOpaque.css};}${this._terminalSelector} .${w} div { position: absolute; background-color: ${D.selectionInactiveBackgroundOpaque.css};}`;for(let[F,P]of D.ansi.entries())O+=`${this._terminalSelector} .${y}${F} { color: ${P.css}; }${this._terminalSelector} .${y}${F}.xterm-dim { color: ${s.color.multiplyOpacity(P,.5).css}; }${this._terminalSelector} .${x}${F} { background-color: ${P.css}; }`;O+=`${this._terminalSelector} .${y}${v.INVERTED_DEFAULT_COLOR} { color: ${s.color.opaque(D.background).css}; }${this._terminalSelector} .${y}${v.INVERTED_DEFAULT_COLOR}.xterm-dim { color: ${s.color.multiplyOpacity(s.color.opaque(D.background),.5).css}; }${this._terminalSelector} .${x}${v.INVERTED_DEFAULT_COLOR} { background-color: ${D.foreground.css}; }`,this._themeStyleElement.textContent=O}_setDefaultSpacing(){let D=this.dimensions.css.cell.width-this._widthCache.get("W",!1,!1);this._rowContainer.style.letterSpacing=`${D}px`,this._rowFactory.defaultSpacing=D}handleDevicePixelRatioChange(){this._updateDimensions(),this._widthCache.clear(),this._setDefaultSpacing()}_refreshRowElements(D,O){for(let F=this._rowElements.length;F<=O;F++){let P=document.createElement("div");this._rowContainer.appendChild(P),this._rowElements.push(P)}for(;this._rowElements.length>O;)this._rowContainer.removeChild(this._rowElements.pop())}handleResize(D,O){this._refreshRowElements(D,O),this._updateDimensions()}handleCharSizeChanged(){this._updateDimensions(),this._widthCache.clear(),this._setDefaultSpacing()}handleBlur(){this._rowContainer.classList.remove(m)}handleFocus(){this._rowContainer.classList.add(m),this.renderRows(this._bufferService.buffer.y,this._bufferService.buffer.y)}handleSelectionChanged(D,O,F){if(this._selectionContainer.replaceChildren(),this._rowFactory.handleSelectionChanged(D,O,F),this.renderRows(0,this._bufferService.rows-1),!D||!O)return;let P=D[1]-this._bufferService.buffer.ydisp,M=O[1]-this._bufferService.buffer.ydisp,I=Math.max(P,0),C=Math.min(M,this._bufferService.rows-1);if(I>=this._bufferService.rows||C<0)return;let k=document.createDocumentFragment();if(F){let L=D[0]>O[0];k.appendChild(this._createSelectionElement(I,L?O[0]:D[0],L?D[0]:O[0],C-I+1))}else{let L=P===I?D[0]:0,R=I===M?O[0]:this._bufferService.cols;k.appendChild(this._createSelectionElement(I,L,R));let z=C-I-1;if(k.appendChild(this._createSelectionElement(I+1,0,this._bufferService.cols,z)),I!==C){let U=M===C?O[0]:this._bufferService.cols;k.appendChild(this._createSelectionElement(C,0,U))}}this._selectionContainer.appendChild(k)}_createSelectionElement(D,O,F,P=1){let M=document.createElement("div");return M.style.height=P*this.dimensions.css.cell.height+"px",M.style.top=D*this.dimensions.css.cell.height+"px",M.style.left=O*this.dimensions.css.cell.width+"px",M.style.width=this.dimensions.css.cell.width*(F-O)+"px",M}handleCursorMove(){}_handleOptionsChanged(){this._updateDimensions(),this._injectCss(this._themeService.colors),this._widthCache.setFont(this._optionsService.rawOptions.fontFamily,this._optionsService.rawOptions.fontSize,this._optionsService.rawOptions.fontWeight,this._optionsService.rawOptions.fontWeightBold),this._setDefaultSpacing()}clear(){for(let D of this._rowElements)D.replaceChildren()}renderRows(D,O){let F=this._bufferService.buffer,P=F.ybase+F.y,M=Math.min(F.x,this._bufferService.cols-1),I=this._optionsService.rawOptions.cursorBlink,C=this._optionsService.rawOptions.cursorStyle,k=this._optionsService.rawOptions.cursorInactiveStyle;for(let L=D;L<=O;L++){let R=L+F.ydisp,z=this._rowElements[L],U=F.lines.get(R);if(!z||!U)break;z.replaceChildren(...this._rowFactory.createRow(U,R,R===P,C,k,M,I,this.dimensions.css.cell.width,this._widthCache,-1,-1))}}get _terminalSelector(){return`.${_}${this._terminalClass}`}_handleLinkHover(D){this._setCellUnderline(D.x1,D.x2,D.y1,D.y2,D.cols,!0)}_handleLinkLeave(D){this._setCellUnderline(D.x1,D.x2,D.y1,D.y2,D.cols,!1)}_setCellUnderline(D,O,F,P,M,I){F<0&&(D=0),P<0&&(O=0);let C=this._bufferService.rows-1;F=Math.max(Math.min(F,C),0),P=Math.max(Math.min(P,C),0),M=Math.min(M,this._bufferService.cols);let k=this._bufferService.buffer,L=k.ybase+k.y,R=Math.min(k.x,M-1),z=this._optionsService.rawOptions.cursorBlink,U=this._optionsService.rawOptions.cursorStyle,K=this._optionsService.rawOptions.cursorInactiveStyle;for(let q=F;q<=P;++q){let te=q+k.ydisp,E=this._rowElements[q],$=k.lines.get(te);if(!E||!$)break;E.replaceChildren(...this._rowFactory.createRow($,te,te===L,U,K,R,z,this.dimensions.css.cell.width,this._widthCache,I?q===F?D:0:-1,I?(q===P?O:M)-1:-1))}}};i.DomRenderer=T=h([f(4,l.IInstantiationService),f(5,g.ICharSizeService),f(6,l.IOptionsService),f(7,l.IBufferService),f(8,g.ICoreBrowserService),f(9,g.IThemeService)],T)},3787:function(u,i,o){var h=this&&this.__decorate||function(y,x,m,w){var A,T=arguments.length,D=T<3?x:w===null?w=Object.getOwnPropertyDescriptor(x,m):w;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")D=Reflect.decorate(y,x,m,w);else for(var O=y.length-1;O>=0;O--)(A=y[O])&&(D=(T<3?A(D):T>3?A(x,m,D):A(x,m))||D);return T>3&&D&&Object.defineProperty(x,m,D),D},f=this&&this.__param||function(y,x){return function(m,w){x(m,w,y)}};Object.defineProperty(i,"__esModule",{value:!0}),i.DomRendererRowFactory=void 0;let c=o(2223),p=o(643),v=o(511),S=o(2585),g=o(8055),s=o(4725),a=o(4269),n=o(6171),l=o(3734),_=i.DomRendererRowFactory=class{constructor(y,x,m,w,A,T,D){this._document=y,this._characterJoinerService=x,this._optionsService=m,this._coreBrowserService=w,this._coreService=A,this._decorationService=T,this._themeService=D,this._workCell=new v.CellData,this._columnSelectMode=!1,this.defaultSpacing=0}handleSelectionChanged(y,x,m){this._selectionStart=y,this._selectionEnd=x,this._columnSelectMode=m}createRow(y,x,m,w,A,T,D,O,F,P,M){let I=[],C=this._characterJoinerService.getJoinedCharacters(x),k=this._themeService.colors,L,R=y.getNoBgTrimmedLength();m&&R<T+1&&(R=T+1);let z=0,U="",K=0,q=0,te=0,E=!1,$=0,W=!1,N=0,G=[],V=P!==-1&&M!==-1;for(let ie=0;ie<R;ie++){y.loadCell(ie,this._workCell);let ve=this._workCell.getWidth();if(ve===0)continue;let Ce=!1,At=ie,Y=this._workCell;if(C.length>0&&ie===C[0][0]){Ce=!0;let le=C.shift();Y=new a.JoinedCellData(this._workCell,y.translateToString(!0,le[0],le[1]),le[1]-le[0]),At=le[1]-1,ve=Y.getWidth()}let Kt=this._isCellInSelection(ie,x),ds=m&&ie===T,us=V&&ie>=P&&ie<=M,fs=!1;this._decorationService.forEachDecorationAtCell(ie,x,void 0,(le=>{fs=!0}));let Ai=Y.getChars()||p.WHITESPACE_CELL_CHAR;if(Ai===" "&&(Y.isUnderline()||Y.isOverline())&&(Ai="\xA0"),N=ve*O-F.get(Ai,Y.isBold(),Y.isItalic()),L){if(z&&(Kt&&W||!Kt&&!W&&Y.bg===K)&&(Kt&&W&&k.selectionForeground||Y.fg===q)&&Y.extended.ext===te&&us===E&&N===$&&!ds&&!Ce&&!fs){U+=Ai,z++;continue}z&&(L.textContent=U),L=this._document.createElement("span"),z=0,U=""}else L=this._document.createElement("span");if(K=Y.bg,q=Y.fg,te=Y.extended.ext,E=us,$=N,W=Kt,Ce&&T>=ie&&T<=At&&(T=ie),!this._coreService.isCursorHidden&&ds){if(G.push("xterm-cursor"),this._coreBrowserService.isFocused)D&&G.push("xterm-cursor-blink"),G.push(w==="bar"?"xterm-cursor-bar":w==="underline"?"xterm-cursor-underline":"xterm-cursor-block");else if(A)switch(A){case"outline":G.push("xterm-cursor-outline");break;case"block":G.push("xterm-cursor-block");break;case"bar":G.push("xterm-cursor-bar");break;case"underline":G.push("xterm-cursor-underline")}}if(Y.isBold()&&G.push("xterm-bold"),Y.isItalic()&&G.push("xterm-italic"),Y.isDim()&&G.push("xterm-dim"),U=Y.isInvisible()?p.WHITESPACE_CELL_CHAR:Y.getChars()||p.WHITESPACE_CELL_CHAR,Y.isUnderline()&&(G.push(`xterm-underline-${Y.extended.underlineStyle}`),U===" "&&(U="\xA0"),!Y.isUnderlineColorDefault()))if(Y.isUnderlineColorRGB())L.style.textDecorationColor=`rgb(${l.AttributeData.toColorRGB(Y.getUnderlineColor()).join(",")})`;else{let le=Y.getUnderlineColor();this._optionsService.rawOptions.drawBoldTextInBrightColors&&Y.isBold()&&le<8&&(le+=8),L.style.textDecorationColor=k.ansi[le].css}Y.isOverline()&&(G.push("xterm-overline"),U===" "&&(U="\xA0")),Y.isStrikethrough()&&G.push("xterm-strikethrough"),us&&(L.style.textDecoration="underline");let De=Y.getFgColor(),Gt=Y.getFgColorMode(),He=Y.getBgColor(),Xt=Y.getBgColorMode(),ps=!!Y.isInverse();if(ps){let le=De;De=He,He=le;let oa=Gt;Gt=Xt,Xt=oa}let st,_s,rt,Yt=!1;switch(this._decorationService.forEachDecorationAtCell(ie,x,void 0,(le=>{le.options.layer!=="top"&&Yt||(le.backgroundColorRGB&&(Xt=50331648,He=le.backgroundColorRGB.rgba>>8&16777215,st=le.backgroundColorRGB),le.foregroundColorRGB&&(Gt=50331648,De=le.foregroundColorRGB.rgba>>8&16777215,_s=le.foregroundColorRGB),Yt=le.options.layer==="top")})),!Yt&&Kt&&(st=this._coreBrowserService.isFocused?k.selectionBackgroundOpaque:k.selectionInactiveBackgroundOpaque,He=st.rgba>>8&16777215,Xt=50331648,Yt=!0,k.selectionForeground&&(Gt=50331648,De=k.selectionForeground.rgba>>8&16777215,_s=k.selectionForeground)),Yt&&G.push("xterm-decoration-top"),Xt){case 16777216:case 33554432:rt=k.ansi[He],G.push(`xterm-bg-${He}`);break;case 50331648:rt=g.rgba.toColor(He>>16,He>>8&255,255&He),this._addStyle(L,`background-color:#${b((He>>>0).toString(16),"0",6)}`);break;default:ps?(rt=k.foreground,G.push(`xterm-bg-${c.INVERTED_DEFAULT_COLOR}`)):rt=k.background}switch(st||Y.isDim()&&(st=g.color.multiplyOpacity(rt,.5)),Gt){case 16777216:case 33554432:Y.isBold()&&De<8&&this._optionsService.rawOptions.drawBoldTextInBrightColors&&(De+=8),this._applyMinimumContrast(L,rt,k.ansi[De],Y,st,void 0)||G.push(`xterm-fg-${De}`);break;case 50331648:let le=g.rgba.toColor(De>>16&255,De>>8&255,255&De);this._applyMinimumContrast(L,rt,le,Y,st,_s)||this._addStyle(L,`color:#${b(De.toString(16),"0",6)}`);break;default:this._applyMinimumContrast(L,rt,k.foreground,Y,st,void 0)||ps&&G.push(`xterm-fg-${c.INVERTED_DEFAULT_COLOR}`)}G.length&&(L.className=G.join(" "),G.length=0),ds||Ce||fs?L.textContent=U:z++,N!==this.defaultSpacing&&(L.style.letterSpacing=`${N}px`),I.push(L),ie=At}return L&&z&&(L.textContent=U),I}_applyMinimumContrast(y,x,m,w,A,T){if(this._optionsService.rawOptions.minimumContrastRatio===1||(0,n.excludeFromContrastRatioDemands)(w.getCode()))return!1;let D=this._getContrastCache(w),O;if(A||T||(O=D.getColor(x.rgba,m.rgba)),O===void 0){let F=this._optionsService.rawOptions.minimumContrastRatio/(w.isDim()?2:1);O=g.color.ensureContrastRatio(A||x,T||m,F),D.setColor((A||x).rgba,(T||m).rgba,O??null)}return!!O&&(this._addStyle(y,`color:${O.css}`),!0)}_getContrastCache(y){return y.isDim()?this._themeService.colors.halfContrastCache:this._themeService.colors.contrastCache}_addStyle(y,x){y.setAttribute("style",`${y.getAttribute("style")||""}${x};`)}_isCellInSelection(y,x){let m=this._selectionStart,w=this._selectionEnd;return!(!m||!w)&&(this._columnSelectMode?m[0]<=w[0]?y>=m[0]&&x>=m[1]&&y<w[0]&&x<=w[1]:y<m[0]&&x>=m[1]&&y>=w[0]&&x<=w[1]:x>m[1]&&x<w[1]||m[1]===w[1]&&x===m[1]&&y>=m[0]&&y<w[0]||m[1]<w[1]&&x===w[1]&&y<w[0]||m[1]<w[1]&&x===m[1]&&y>=m[0])}};function b(y,x,m){for(;y.length<m;)y=x+y;return y}i.DomRendererRowFactory=_=h([f(1,s.ICharacterJoinerService),f(2,S.IOptionsService),f(3,s.ICoreBrowserService),f(4,S.ICoreService),f(5,S.IDecorationService),f(6,s.IThemeService)],_)},2550:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.WidthCache=void 0,i.WidthCache=class{constructor(o){this._flat=new Float32Array(256),this._font="",this._fontSize=0,this._weight="normal",this._weightBold="bold",this._measureElements=[],this._container=o.createElement("div"),this._container.style.position="absolute",this._container.style.top="-50000px",this._container.style.width="50000px",this._container.style.whiteSpace="pre",this._container.style.fontKerning="none";let h=o.createElement("span"),f=o.createElement("span");f.style.fontWeight="bold";let c=o.createElement("span");c.style.fontStyle="italic";let p=o.createElement("span");p.style.fontWeight="bold",p.style.fontStyle="italic",this._measureElements=[h,f,c,p],this._container.appendChild(h),this._container.appendChild(f),this._container.appendChild(c),this._container.appendChild(p),o.body.appendChild(this._container),this.clear()}dispose(){this._container.remove(),this._measureElements.length=0,this._holey=void 0}clear(){this._flat.fill(-9999),this._holey=new Map}setFont(o,h,f,c){o===this._font&&h===this._fontSize&&f===this._weight&&c===this._weightBold||(this._font=o,this._fontSize=h,this._weight=f,this._weightBold=c,this._container.style.fontFamily=this._font,this._container.style.fontSize=`${this._fontSize}px`,this._measureElements[0].style.fontWeight=`${f}`,this._measureElements[1].style.fontWeight=`${c}`,this._measureElements[2].style.fontWeight=`${f}`,this._measureElements[3].style.fontWeight=`${c}`,this.clear())}get(o,h,f){let c=0;if(!h&&!f&&o.length===1&&(c=o.charCodeAt(0))<256)return this._flat[c]!==-9999?this._flat[c]:this._flat[c]=this._measure(o,0);let p=o;h&&(p+="B"),f&&(p+="I");let v=this._holey.get(p);if(v===void 0){let S=0;h&&(S|=1),f&&(S|=2),v=this._measure(o,S),this._holey.set(p,v)}return v}_measure(o,h){let f=this._measureElements[h];return f.textContent=o.repeat(32),f.offsetWidth/32}}},2223:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.TEXT_BASELINE=i.DIM_OPACITY=i.INVERTED_DEFAULT_COLOR=void 0;let h=o(6114);i.INVERTED_DEFAULT_COLOR=257,i.DIM_OPACITY=.5,i.TEXT_BASELINE=h.isFirefox||h.isLegacyEdge?"bottom":"ideographic"},6171:(u,i)=>{function o(h){return 57508<=h&&h<=57558}Object.defineProperty(i,"__esModule",{value:!0}),i.createRenderDimensions=i.excludeFromContrastRatioDemands=i.isRestrictedPowerlineGlyph=i.isPowerlineGlyph=i.throwIfFalsy=void 0,i.throwIfFalsy=function(h){if(!h)throw new Error("value must not be falsy");return h},i.isPowerlineGlyph=o,i.isRestrictedPowerlineGlyph=function(h){return 57520<=h&&h<=57527},i.excludeFromContrastRatioDemands=function(h){return o(h)||(function(f){return 9472<=f&&f<=9631})(h)},i.createRenderDimensions=function(){return{css:{canvas:{width:0,height:0},cell:{width:0,height:0}},device:{canvas:{width:0,height:0},cell:{width:0,height:0},char:{width:0,height:0,left:0,top:0}}}}},456:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.SelectionModel=void 0,i.SelectionModel=class{constructor(o){this._bufferService=o,this.isSelectAllActive=!1,this.selectionStartLength=0}clearSelection(){this.selectionStart=void 0,this.selectionEnd=void 0,this.isSelectAllActive=!1,this.selectionStartLength=0}get finalSelectionStart(){return this.isSelectAllActive?[0,0]:this.selectionEnd&&this.selectionStart&&this.areSelectionValuesReversed()?this.selectionEnd:this.selectionStart}get finalSelectionEnd(){if(this.isSelectAllActive)return[this._bufferService.cols,this._bufferService.buffer.ybase+this._bufferService.rows-1];if(this.selectionStart){if(!this.selectionEnd||this.areSelectionValuesReversed()){let o=this.selectionStart[0]+this.selectionStartLength;return o>this._bufferService.cols?o%this._bufferService.cols==0?[this._bufferService.cols,this.selectionStart[1]+Math.floor(o/this._bufferService.cols)-1]:[o%this._bufferService.cols,this.selectionStart[1]+Math.floor(o/this._bufferService.cols)]:[o,this.selectionStart[1]]}if(this.selectionStartLength&&this.selectionEnd[1]===this.selectionStart[1]){let o=this.selectionStart[0]+this.selectionStartLength;return o>this._bufferService.cols?[o%this._bufferService.cols,this.selectionStart[1]+Math.floor(o/this._bufferService.cols)]:[Math.max(o,this.selectionEnd[0]),this.selectionEnd[1]]}return this.selectionEnd}}areSelectionValuesReversed(){let o=this.selectionStart,h=this.selectionEnd;return!(!o||!h)&&(o[1]>h[1]||o[1]===h[1]&&o[0]>h[0])}handleTrim(o){return this.selectionStart&&(this.selectionStart[1]-=o),this.selectionEnd&&(this.selectionEnd[1]-=o),this.selectionEnd&&this.selectionEnd[1]<0?(this.clearSelection(),!0):(this.selectionStart&&this.selectionStart[1]<0&&(this.selectionStart[1]=0),!1)}}},428:function(u,i,o){var h=this&&this.__decorate||function(s,a,n,l){var _,b=arguments.length,y=b<3?a:l===null?l=Object.getOwnPropertyDescriptor(a,n):l;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(s,a,n,l);else for(var x=s.length-1;x>=0;x--)(_=s[x])&&(y=(b<3?_(y):b>3?_(a,n,y):_(a,n))||y);return b>3&&y&&Object.defineProperty(a,n,y),y},f=this&&this.__param||function(s,a){return function(n,l){a(n,l,s)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CharSizeService=void 0;let c=o(2585),p=o(8460),v=o(844),S=i.CharSizeService=class extends v.Disposable{get hasValidSize(){return this.width>0&&this.height>0}constructor(s,a,n){super(),this._optionsService=n,this.width=0,this.height=0,this._onCharSizeChange=this.register(new p.EventEmitter),this.onCharSizeChange=this._onCharSizeChange.event,this._measureStrategy=new g(s,a,this._optionsService),this.register(this._optionsService.onMultipleOptionChange(["fontFamily","fontSize"],(()=>this.measure())))}measure(){let s=this._measureStrategy.measure();s.width===this.width&&s.height===this.height||(this.width=s.width,this.height=s.height,this._onCharSizeChange.fire())}};i.CharSizeService=S=h([f(2,c.IOptionsService)],S);class g{constructor(a,n,l){this._document=a,this._parentElement=n,this._optionsService=l,this._result={width:0,height:0},this._measureElement=this._document.createElement("span"),this._measureElement.classList.add("xterm-char-measure-element"),this._measureElement.textContent="W".repeat(32),this._measureElement.setAttribute("aria-hidden","true"),this._measureElement.style.whiteSpace="pre",this._measureElement.style.fontKerning="none",this._parentElement.appendChild(this._measureElement)}measure(){this._measureElement.style.fontFamily=this._optionsService.rawOptions.fontFamily,this._measureElement.style.fontSize=`${this._optionsService.rawOptions.fontSize}px`;let a={height:Number(this._measureElement.offsetHeight),width:Number(this._measureElement.offsetWidth)};return a.width!==0&&a.height!==0&&(this._result.width=a.width/32,this._result.height=Math.ceil(a.height)),this._result}}},4269:function(u,i,o){var h=this&&this.__decorate||function(a,n,l,_){var b,y=arguments.length,x=y<3?n:_===null?_=Object.getOwnPropertyDescriptor(n,l):_;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")x=Reflect.decorate(a,n,l,_);else for(var m=a.length-1;m>=0;m--)(b=a[m])&&(x=(y<3?b(x):y>3?b(n,l,x):b(n,l))||x);return y>3&&x&&Object.defineProperty(n,l,x),x},f=this&&this.__param||function(a,n){return function(l,_){n(l,_,a)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CharacterJoinerService=i.JoinedCellData=void 0;let c=o(3734),p=o(643),v=o(511),S=o(2585);class g extends c.AttributeData{constructor(n,l,_){super(),this.content=0,this.combinedData="",this.fg=n.fg,this.bg=n.bg,this.combinedData=l,this._width=_}isCombined(){return 2097152}getWidth(){return this._width}getChars(){return this.combinedData}getCode(){return 2097151}setFromCharData(n){throw new Error("not implemented")}getAsCharData(){return[this.fg,this.getChars(),this.getWidth(),this.getCode()]}}i.JoinedCellData=g;let s=i.CharacterJoinerService=class Kr{constructor(n){this._bufferService=n,this._characterJoiners=[],this._nextCharacterJoinerId=0,this._workCell=new v.CellData}register(n){let l={id:this._nextCharacterJoinerId++,handler:n};return this._characterJoiners.push(l),l.id}deregister(n){for(let l=0;l<this._characterJoiners.length;l++)if(this._characterJoiners[l].id===n)return this._characterJoiners.splice(l,1),!0;return!1}getJoinedCharacters(n){if(this._characterJoiners.length===0)return[];let l=this._bufferService.buffer.lines.get(n);if(!l||l.length===0)return[];let _=[],b=l.translateToString(!0),y=0,x=0,m=0,w=l.getFg(0),A=l.getBg(0);for(let T=0;T<l.getTrimmedLength();T++)if(l.loadCell(T,this._workCell),this._workCell.getWidth()!==0){if(this._workCell.fg!==w||this._workCell.bg!==A){if(T-y>1){let D=this._getJoinedRanges(b,m,x,l,y);for(let O=0;O<D.length;O++)_.push(D[O])}y=T,m=x,w=this._workCell.fg,A=this._workCell.bg}x+=this._workCell.getChars().length||p.WHITESPACE_CELL_CHAR.length}if(this._bufferService.cols-y>1){let T=this._getJoinedRanges(b,m,x,l,y);for(let D=0;D<T.length;D++)_.push(T[D])}return _}_getJoinedRanges(n,l,_,b,y){let x=n.substring(l,_),m=[];try{m=this._characterJoiners[0].handler(x)}catch(w){console.error(w)}for(let w=1;w<this._characterJoiners.length;w++)try{let A=this._characterJoiners[w].handler(x);for(let T=0;T<A.length;T++)Kr._mergeRanges(m,A[T])}catch(A){console.error(A)}return this._stringRangesToCellRanges(m,b,y),m}_stringRangesToCellRanges(n,l,_){let b=0,y=!1,x=0,m=n[b];if(m){for(let w=_;w<this._bufferService.cols;w++){let A=l.getWidth(w),T=l.getString(w).length||p.WHITESPACE_CELL_CHAR.length;if(A!==0){if(!y&&m[0]<=x&&(m[0]=w,y=!0),m[1]<=x){if(m[1]=w,m=n[++b],!m)break;m[0]<=x?(m[0]=w,y=!0):y=!1}x+=T}}m&&(m[1]=this._bufferService.cols)}}static _mergeRanges(n,l){let _=!1;for(let b=0;b<n.length;b++){let y=n[b];if(_){if(l[1]<=y[0])return n[b-1][1]=l[1],n;if(l[1]<=y[1])return n[b-1][1]=Math.max(l[1],y[1]),n.splice(b,1),n;n.splice(b,1),b--}else{if(l[1]<=y[0])return n.splice(b,0,l),n;if(l[1]<=y[1])return y[0]=Math.min(l[0],y[0]),n;l[0]<y[1]&&(y[0]=Math.min(l[0],y[0]),_=!0)}}return _?n[n.length-1][1]=l[1]:n.push(l),n}};i.CharacterJoinerService=s=h([f(0,S.IBufferService)],s)},5114:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CoreBrowserService=void 0,i.CoreBrowserService=class{constructor(o,h){this._textarea=o,this.window=h,this._isFocused=!1,this._cachedIsFocused=void 0,this._textarea.addEventListener("focus",(()=>this._isFocused=!0)),this._textarea.addEventListener("blur",(()=>this._isFocused=!1))}get dpr(){return this.window.devicePixelRatio}get isFocused(){return this._cachedIsFocused===void 0&&(this._cachedIsFocused=this._isFocused&&this._textarea.ownerDocument.hasFocus(),queueMicrotask((()=>this._cachedIsFocused=void 0))),this._cachedIsFocused}}},8934:function(u,i,o){var h=this&&this.__decorate||function(S,g,s,a){var n,l=arguments.length,_=l<3?g:a===null?a=Object.getOwnPropertyDescriptor(g,s):a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")_=Reflect.decorate(S,g,s,a);else for(var b=S.length-1;b>=0;b--)(n=S[b])&&(_=(l<3?n(_):l>3?n(g,s,_):n(g,s))||_);return l>3&&_&&Object.defineProperty(g,s,_),_},f=this&&this.__param||function(S,g){return function(s,a){g(s,a,S)}};Object.defineProperty(i,"__esModule",{value:!0}),i.MouseService=void 0;let c=o(4725),p=o(9806),v=i.MouseService=class{constructor(S,g){this._renderService=S,this._charSizeService=g}getCoords(S,g,s,a,n){return(0,p.getCoords)(window,S,g,s,a,this._charSizeService.hasValidSize,this._renderService.dimensions.css.cell.width,this._renderService.dimensions.css.cell.height,n)}getMouseReportCoords(S,g){let s=(0,p.getCoordsRelativeToElement)(window,S,g);if(this._charSizeService.hasValidSize)return s[0]=Math.min(Math.max(s[0],0),this._renderService.dimensions.css.canvas.width-1),s[1]=Math.min(Math.max(s[1],0),this._renderService.dimensions.css.canvas.height-1),{col:Math.floor(s[0]/this._renderService.dimensions.css.cell.width),row:Math.floor(s[1]/this._renderService.dimensions.css.cell.height),x:Math.floor(s[0]),y:Math.floor(s[1])}}};i.MouseService=v=h([f(0,c.IRenderService),f(1,c.ICharSizeService)],v)},3230:function(u,i,o){var h=this&&this.__decorate||function(_,b,y,x){var m,w=arguments.length,A=w<3?b:x===null?x=Object.getOwnPropertyDescriptor(b,y):x;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")A=Reflect.decorate(_,b,y,x);else for(var T=_.length-1;T>=0;T--)(m=_[T])&&(A=(w<3?m(A):w>3?m(b,y,A):m(b,y))||A);return w>3&&A&&Object.defineProperty(b,y,A),A},f=this&&this.__param||function(_,b){return function(y,x){b(y,x,_)}};Object.defineProperty(i,"__esModule",{value:!0}),i.RenderService=void 0;let c=o(3656),p=o(6193),v=o(5596),S=o(4725),g=o(8460),s=o(844),a=o(7226),n=o(2585),l=i.RenderService=class extends s.Disposable{get dimensions(){return this._renderer.value.dimensions}constructor(_,b,y,x,m,w,A,T){if(super(),this._rowCount=_,this._charSizeService=x,this._renderer=this.register(new s.MutableDisposable),this._pausedResizeTask=new a.DebouncedIdleTask,this._isPaused=!1,this._needsFullRefresh=!1,this._isNextRenderRedrawOnly=!0,this._needsSelectionRefresh=!1,this._canvasWidth=0,this._canvasHeight=0,this._selectionState={start:void 0,end:void 0,columnSelectMode:!1},this._onDimensionsChange=this.register(new g.EventEmitter),this.onDimensionsChange=this._onDimensionsChange.event,this._onRenderedViewportChange=this.register(new g.EventEmitter),this.onRenderedViewportChange=this._onRenderedViewportChange.event,this._onRender=this.register(new g.EventEmitter),this.onRender=this._onRender.event,this._onRefreshRequest=this.register(new g.EventEmitter),this.onRefreshRequest=this._onRefreshRequest.event,this._renderDebouncer=new p.RenderDebouncer(A.window,((D,O)=>this._renderRows(D,O))),this.register(this._renderDebouncer),this._screenDprMonitor=new v.ScreenDprMonitor(A.window),this._screenDprMonitor.setListener((()=>this.handleDevicePixelRatioChange())),this.register(this._screenDprMonitor),this.register(w.onResize((()=>this._fullRefresh()))),this.register(w.buffers.onBufferActivate((()=>{var D;return(D=this._renderer.value)===null||D===void 0?void 0:D.clear()}))),this.register(y.onOptionChange((()=>this._handleOptionsChanged()))),this.register(this._charSizeService.onCharSizeChange((()=>this.handleCharSizeChanged()))),this.register(m.onDecorationRegistered((()=>this._fullRefresh()))),this.register(m.onDecorationRemoved((()=>this._fullRefresh()))),this.register(y.onMultipleOptionChange(["customGlyphs","drawBoldTextInBrightColors","letterSpacing","lineHeight","fontFamily","fontSize","fontWeight","fontWeightBold","minimumContrastRatio"],(()=>{this.clear(),this.handleResize(w.cols,w.rows),this._fullRefresh()}))),this.register(y.onMultipleOptionChange(["cursorBlink","cursorStyle"],(()=>this.refreshRows(w.buffer.y,w.buffer.y,!0)))),this.register((0,c.addDisposableDomListener)(A.window,"resize",(()=>this.handleDevicePixelRatioChange()))),this.register(T.onChangeColors((()=>this._fullRefresh()))),"IntersectionObserver"in A.window){let D=new A.window.IntersectionObserver((O=>this._handleIntersectionChange(O[O.length-1])),{threshold:0});D.observe(b),this.register({dispose:()=>D.disconnect()})}}_handleIntersectionChange(_){this._isPaused=_.isIntersecting===void 0?_.intersectionRatio===0:!_.isIntersecting,this._isPaused||this._charSizeService.hasValidSize||this._charSizeService.measure(),!this._isPaused&&this._needsFullRefresh&&(this._pausedResizeTask.flush(),this.refreshRows(0,this._rowCount-1),this._needsFullRefresh=!1)}refreshRows(_,b,y=!1){this._isPaused?this._needsFullRefresh=!0:(y||(this._isNextRenderRedrawOnly=!1),this._renderDebouncer.refresh(_,b,this._rowCount))}_renderRows(_,b){this._renderer.value&&(_=Math.min(_,this._rowCount-1),b=Math.min(b,this._rowCount-1),this._renderer.value.renderRows(_,b),this._needsSelectionRefresh&&(this._renderer.value.handleSelectionChanged(this._selectionState.start,this._selectionState.end,this._selectionState.columnSelectMode),this._needsSelectionRefresh=!1),this._isNextRenderRedrawOnly||this._onRenderedViewportChange.fire({start:_,end:b}),this._onRender.fire({start:_,end:b}),this._isNextRenderRedrawOnly=!0)}resize(_,b){this._rowCount=b,this._fireOnCanvasResize()}_handleOptionsChanged(){this._renderer.value&&(this.refreshRows(0,this._rowCount-1),this._fireOnCanvasResize())}_fireOnCanvasResize(){this._renderer.value&&(this._renderer.value.dimensions.css.canvas.width===this._canvasWidth&&this._renderer.value.dimensions.css.canvas.height===this._canvasHeight||this._onDimensionsChange.fire(this._renderer.value.dimensions))}hasRenderer(){return!!this._renderer.value}setRenderer(_){this._renderer.value=_,this._renderer.value.onRequestRedraw((b=>this.refreshRows(b.start,b.end,!0))),this._needsSelectionRefresh=!0,this._fullRefresh()}addRefreshCallback(_){return this._renderDebouncer.addRefreshCallback(_)}_fullRefresh(){this._isPaused?this._needsFullRefresh=!0:this.refreshRows(0,this._rowCount-1)}clearTextureAtlas(){var _,b;this._renderer.value&&((b=(_=this._renderer.value).clearTextureAtlas)===null||b===void 0||b.call(_),this._fullRefresh())}handleDevicePixelRatioChange(){this._charSizeService.measure(),this._renderer.value&&(this._renderer.value.handleDevicePixelRatioChange(),this.refreshRows(0,this._rowCount-1))}handleResize(_,b){this._renderer.value&&(this._isPaused?this._pausedResizeTask.set((()=>this._renderer.value.handleResize(_,b))):this._renderer.value.handleResize(_,b),this._fullRefresh())}handleCharSizeChanged(){var _;(_=this._renderer.value)===null||_===void 0||_.handleCharSizeChanged()}handleBlur(){var _;(_=this._renderer.value)===null||_===void 0||_.handleBlur()}handleFocus(){var _;(_=this._renderer.value)===null||_===void 0||_.handleFocus()}handleSelectionChanged(_,b,y){var x;this._selectionState.start=_,this._selectionState.end=b,this._selectionState.columnSelectMode=y,(x=this._renderer.value)===null||x===void 0||x.handleSelectionChanged(_,b,y)}handleCursorMove(){var _;(_=this._renderer.value)===null||_===void 0||_.handleCursorMove()}clear(){var _;(_=this._renderer.value)===null||_===void 0||_.clear()}};i.RenderService=l=h([f(2,n.IOptionsService),f(3,S.ICharSizeService),f(4,n.IDecorationService),f(5,n.IBufferService),f(6,S.ICoreBrowserService),f(7,S.IThemeService)],l)},9312:function(u,i,o){var h=this&&this.__decorate||function(m,w,A,T){var D,O=arguments.length,F=O<3?w:T===null?T=Object.getOwnPropertyDescriptor(w,A):T;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")F=Reflect.decorate(m,w,A,T);else for(var P=m.length-1;P>=0;P--)(D=m[P])&&(F=(O<3?D(F):O>3?D(w,A,F):D(w,A))||F);return O>3&&F&&Object.defineProperty(w,A,F),F},f=this&&this.__param||function(m,w){return function(A,T){w(A,T,m)}};Object.defineProperty(i,"__esModule",{value:!0}),i.SelectionService=void 0;let c=o(9806),p=o(9504),v=o(456),S=o(4725),g=o(8460),s=o(844),a=o(6114),n=o(4841),l=o(511),_=o(2585),b="\xA0",y=new RegExp(b,"g"),x=i.SelectionService=class extends s.Disposable{constructor(m,w,A,T,D,O,F,P,M){super(),this._element=m,this._screenElement=w,this._linkifier=A,this._bufferService=T,this._coreService=D,this._mouseService=O,this._optionsService=F,this._renderService=P,this._coreBrowserService=M,this._dragScrollAmount=0,this._enabled=!0,this._workCell=new l.CellData,this._mouseDownTimeStamp=0,this._oldHasSelection=!1,this._oldSelectionStart=void 0,this._oldSelectionEnd=void 0,this._onLinuxMouseSelection=this.register(new g.EventEmitter),this.onLinuxMouseSelection=this._onLinuxMouseSelection.event,this._onRedrawRequest=this.register(new g.EventEmitter),this.onRequestRedraw=this._onRedrawRequest.event,this._onSelectionChange=this.register(new g.EventEmitter),this.onSelectionChange=this._onSelectionChange.event,this._onRequestScrollLines=this.register(new g.EventEmitter),this.onRequestScrollLines=this._onRequestScrollLines.event,this._mouseMoveListener=I=>this._handleMouseMove(I),this._mouseUpListener=I=>this._handleMouseUp(I),this._coreService.onUserInput((()=>{this.hasSelection&&this.clearSelection()})),this._trimListener=this._bufferService.buffer.lines.onTrim((I=>this._handleTrim(I))),this.register(this._bufferService.buffers.onBufferActivate((I=>this._handleBufferActivate(I)))),this.enable(),this._model=new v.SelectionModel(this._bufferService),this._activeSelectionMode=0,this.register((0,s.toDisposable)((()=>{this._removeMouseDownListeners()})))}reset(){this.clearSelection()}disable(){this.clearSelection(),this._enabled=!1}enable(){this._enabled=!0}get selectionStart(){return this._model.finalSelectionStart}get selectionEnd(){return this._model.finalSelectionEnd}get hasSelection(){let m=this._model.finalSelectionStart,w=this._model.finalSelectionEnd;return!(!m||!w||m[0]===w[0]&&m[1]===w[1])}get selectionText(){let m=this._model.finalSelectionStart,w=this._model.finalSelectionEnd;if(!m||!w)return"";let A=this._bufferService.buffer,T=[];if(this._activeSelectionMode===3){if(m[0]===w[0])return"";let D=m[0]<w[0]?m[0]:w[0],O=m[0]<w[0]?w[0]:m[0];for(let F=m[1];F<=w[1];F++){let P=A.translateBufferLineToString(F,!0,D,O);T.push(P)}}else{let D=m[1]===w[1]?w[0]:void 0;T.push(A.translateBufferLineToString(m[1],!0,m[0],D));for(let O=m[1]+1;O<=w[1]-1;O++){let F=A.lines.get(O),P=A.translateBufferLineToString(O,!0);F?.isWrapped?T[T.length-1]+=P:T.push(P)}if(m[1]!==w[1]){let O=A.lines.get(w[1]),F=A.translateBufferLineToString(w[1],!0,0,w[0]);O&&O.isWrapped?T[T.length-1]+=F:T.push(F)}}return T.map((D=>D.replace(y," "))).join(a.isWindows?`\r
`:`
`)}clearSelection(){this._model.clearSelection(),this._removeMouseDownListeners(),this.refresh(),this._onSelectionChange.fire()}refresh(m){this._refreshAnimationFrame||(this._refreshAnimationFrame=this._coreBrowserService.window.requestAnimationFrame((()=>this._refresh()))),a.isLinux&&m&&this.selectionText.length&&this._onLinuxMouseSelection.fire(this.selectionText)}_refresh(){this._refreshAnimationFrame=void 0,this._onRedrawRequest.fire({start:this._model.finalSelectionStart,end:this._model.finalSelectionEnd,columnSelectMode:this._activeSelectionMode===3})}_isClickInSelection(m){let w=this._getMouseBufferCoords(m),A=this._model.finalSelectionStart,T=this._model.finalSelectionEnd;return!!(A&&T&&w)&&this._areCoordsInSelection(w,A,T)}isCellInSelection(m,w){let A=this._model.finalSelectionStart,T=this._model.finalSelectionEnd;return!(!A||!T)&&this._areCoordsInSelection([m,w],A,T)}_areCoordsInSelection(m,w,A){return m[1]>w[1]&&m[1]<A[1]||w[1]===A[1]&&m[1]===w[1]&&m[0]>=w[0]&&m[0]<A[0]||w[1]<A[1]&&m[1]===A[1]&&m[0]<A[0]||w[1]<A[1]&&m[1]===w[1]&&m[0]>=w[0]}_selectWordAtCursor(m,w){var A,T;let D=(T=(A=this._linkifier.currentLink)===null||A===void 0?void 0:A.link)===null||T===void 0?void 0:T.range;if(D)return this._model.selectionStart=[D.start.x-1,D.start.y-1],this._model.selectionStartLength=(0,n.getRangeLength)(D,this._bufferService.cols),this._model.selectionEnd=void 0,!0;let O=this._getMouseBufferCoords(m);return!!O&&(this._selectWordAt(O,w),this._model.selectionEnd=void 0,!0)}selectAll(){this._model.isSelectAllActive=!0,this.refresh(),this._onSelectionChange.fire()}selectLines(m,w){this._model.clearSelection(),m=Math.max(m,0),w=Math.min(w,this._bufferService.buffer.lines.length-1),this._model.selectionStart=[0,m],this._model.selectionEnd=[this._bufferService.cols,w],this.refresh(),this._onSelectionChange.fire()}_handleTrim(m){this._model.handleTrim(m)&&this.refresh()}_getMouseBufferCoords(m){let w=this._mouseService.getCoords(m,this._screenElement,this._bufferService.cols,this._bufferService.rows,!0);if(w)return w[0]--,w[1]--,w[1]+=this._bufferService.buffer.ydisp,w}_getMouseEventScrollAmount(m){let w=(0,c.getCoordsRelativeToElement)(this._coreBrowserService.window,m,this._screenElement)[1],A=this._renderService.dimensions.css.canvas.height;return w>=0&&w<=A?0:(w>A&&(w-=A),w=Math.min(Math.max(w,-50),50),w/=50,w/Math.abs(w)+Math.round(14*w))}shouldForceSelection(m){return a.isMac?m.altKey&&this._optionsService.rawOptions.macOptionClickForcesSelection:m.shiftKey}handleMouseDown(m){if(this._mouseDownTimeStamp=m.timeStamp,(m.button!==2||!this.hasSelection)&&m.button===0){if(!this._enabled){if(!this.shouldForceSelection(m))return;m.stopPropagation()}m.preventDefault(),this._dragScrollAmount=0,this._enabled&&m.shiftKey?this._handleIncrementalClick(m):m.detail===1?this._handleSingleClick(m):m.detail===2?this._handleDoubleClick(m):m.detail===3&&this._handleTripleClick(m),this._addMouseDownListeners(),this.refresh(!0)}}_addMouseDownListeners(){this._screenElement.ownerDocument&&(this._screenElement.ownerDocument.addEventListener("mousemove",this._mouseMoveListener),this._screenElement.ownerDocument.addEventListener("mouseup",this._mouseUpListener)),this._dragScrollIntervalTimer=this._coreBrowserService.window.setInterval((()=>this._dragScroll()),50)}_removeMouseDownListeners(){this._screenElement.ownerDocument&&(this._screenElement.ownerDocument.removeEventListener("mousemove",this._mouseMoveListener),this._screenElement.ownerDocument.removeEventListener("mouseup",this._mouseUpListener)),this._coreBrowserService.window.clearInterval(this._dragScrollIntervalTimer),this._dragScrollIntervalTimer=void 0}_handleIncrementalClick(m){this._model.selectionStart&&(this._model.selectionEnd=this._getMouseBufferCoords(m))}_handleSingleClick(m){if(this._model.selectionStartLength=0,this._model.isSelectAllActive=!1,this._activeSelectionMode=this.shouldColumnSelect(m)?3:0,this._model.selectionStart=this._getMouseBufferCoords(m),!this._model.selectionStart)return;this._model.selectionEnd=void 0;let w=this._bufferService.buffer.lines.get(this._model.selectionStart[1]);w&&w.length!==this._model.selectionStart[0]&&w.hasWidth(this._model.selectionStart[0])===0&&this._model.selectionStart[0]++}_handleDoubleClick(m){this._selectWordAtCursor(m,!0)&&(this._activeSelectionMode=1)}_handleTripleClick(m){let w=this._getMouseBufferCoords(m);w&&(this._activeSelectionMode=2,this._selectLineAt(w[1]))}shouldColumnSelect(m){return m.altKey&&!(a.isMac&&this._optionsService.rawOptions.macOptionClickForcesSelection)}_handleMouseMove(m){if(m.stopImmediatePropagation(),!this._model.selectionStart)return;let w=this._model.selectionEnd?[this._model.selectionEnd[0],this._model.selectionEnd[1]]:null;if(this._model.selectionEnd=this._getMouseBufferCoords(m),!this._model.selectionEnd)return void this.refresh(!0);this._activeSelectionMode===2?this._model.selectionEnd[1]<this._model.selectionStart[1]?this._model.selectionEnd[0]=0:this._model.selectionEnd[0]=this._bufferService.cols:this._activeSelectionMode===1&&this._selectToWordAt(this._model.selectionEnd),this._dragScrollAmount=this._getMouseEventScrollAmount(m),this._activeSelectionMode!==3&&(this._dragScrollAmount>0?this._model.selectionEnd[0]=this._bufferService.cols:this._dragScrollAmount<0&&(this._model.selectionEnd[0]=0));let A=this._bufferService.buffer;if(this._model.selectionEnd[1]<A.lines.length){let T=A.lines.get(this._model.selectionEnd[1]);T&&T.hasWidth(this._model.selectionEnd[0])===0&&this._model.selectionEnd[0]++}w&&w[0]===this._model.selectionEnd[0]&&w[1]===this._model.selectionEnd[1]||this.refresh(!0)}_dragScroll(){if(this._model.selectionEnd&&this._model.selectionStart&&this._dragScrollAmount){this._onRequestScrollLines.fire({amount:this._dragScrollAmount,suppressScrollEvent:!1});let m=this._bufferService.buffer;this._dragScrollAmount>0?(this._activeSelectionMode!==3&&(this._model.selectionEnd[0]=this._bufferService.cols),this._model.selectionEnd[1]=Math.min(m.ydisp+this._bufferService.rows,m.lines.length-1)):(this._activeSelectionMode!==3&&(this._model.selectionEnd[0]=0),this._model.selectionEnd[1]=m.ydisp),this.refresh()}}_handleMouseUp(m){let w=m.timeStamp-this._mouseDownTimeStamp;if(this._removeMouseDownListeners(),this.selectionText.length<=1&&w<500&&m.altKey&&this._optionsService.rawOptions.altClickMovesCursor){if(this._bufferService.buffer.ybase===this._bufferService.buffer.ydisp){let A=this._mouseService.getCoords(m,this._element,this._bufferService.cols,this._bufferService.rows,!1);if(A&&A[0]!==void 0&&A[1]!==void 0){let T=(0,p.moveToCellSequence)(A[0]-1,A[1]-1,this._bufferService,this._coreService.decPrivateModes.applicationCursorKeys);this._coreService.triggerDataEvent(T,!0)}}}else this._fireEventIfSelectionChanged()}_fireEventIfSelectionChanged(){let m=this._model.finalSelectionStart,w=this._model.finalSelectionEnd,A=!(!m||!w||m[0]===w[0]&&m[1]===w[1]);A?m&&w&&(this._oldSelectionStart&&this._oldSelectionEnd&&m[0]===this._oldSelectionStart[0]&&m[1]===this._oldSelectionStart[1]&&w[0]===this._oldSelectionEnd[0]&&w[1]===this._oldSelectionEnd[1]||this._fireOnSelectionChange(m,w,A)):this._oldHasSelection&&this._fireOnSelectionChange(m,w,A)}_fireOnSelectionChange(m,w,A){this._oldSelectionStart=m,this._oldSelectionEnd=w,this._oldHasSelection=A,this._onSelectionChange.fire()}_handleBufferActivate(m){this.clearSelection(),this._trimListener.dispose(),this._trimListener=m.activeBuffer.lines.onTrim((w=>this._handleTrim(w)))}_convertViewportColToCharacterIndex(m,w){let A=w;for(let T=0;w>=T;T++){let D=m.loadCell(T,this._workCell).getChars().length;this._workCell.getWidth()===0?A--:D>1&&w!==T&&(A+=D-1)}return A}setSelection(m,w,A){this._model.clearSelection(),this._removeMouseDownListeners(),this._model.selectionStart=[m,w],this._model.selectionStartLength=A,this.refresh(),this._fireEventIfSelectionChanged()}rightClickSelect(m){this._isClickInSelection(m)||(this._selectWordAtCursor(m,!1)&&this.refresh(!0),this._fireEventIfSelectionChanged())}_getWordAt(m,w,A=!0,T=!0){if(m[0]>=this._bufferService.cols)return;let D=this._bufferService.buffer,O=D.lines.get(m[1]);if(!O)return;let F=D.translateBufferLineToString(m[1],!1),P=this._convertViewportColToCharacterIndex(O,m[0]),M=P,I=m[0]-P,C=0,k=0,L=0,R=0;if(F.charAt(P)===" "){for(;P>0&&F.charAt(P-1)===" ";)P--;for(;M<F.length&&F.charAt(M+1)===" ";)M++}else{let K=m[0],q=m[0];O.getWidth(K)===0&&(C++,K--),O.getWidth(q)===2&&(k++,q++);let te=O.getString(q).length;for(te>1&&(R+=te-1,M+=te-1);K>0&&P>0&&!this._isCharWordSeparator(O.loadCell(K-1,this._workCell));){O.loadCell(K-1,this._workCell);let E=this._workCell.getChars().length;this._workCell.getWidth()===0?(C++,K--):E>1&&(L+=E-1,P-=E-1),P--,K--}for(;q<O.length&&M+1<F.length&&!this._isCharWordSeparator(O.loadCell(q+1,this._workCell));){O.loadCell(q+1,this._workCell);let E=this._workCell.getChars().length;this._workCell.getWidth()===2?(k++,q++):E>1&&(R+=E-1,M+=E-1),M++,q++}}M++;let z=P+I-C+L,U=Math.min(this._bufferService.cols,M-P+C+k-L-R);if(w||F.slice(P,M).trim()!==""){if(A&&z===0&&O.getCodePoint(0)!==32){let K=D.lines.get(m[1]-1);if(K&&O.isWrapped&&K.getCodePoint(this._bufferService.cols-1)!==32){let q=this._getWordAt([this._bufferService.cols-1,m[1]-1],!1,!0,!1);if(q){let te=this._bufferService.cols-q.start;z-=te,U+=te}}}if(T&&z+U===this._bufferService.cols&&O.getCodePoint(this._bufferService.cols-1)!==32){let K=D.lines.get(m[1]+1);if(K?.isWrapped&&K.getCodePoint(0)!==32){let q=this._getWordAt([0,m[1]+1],!1,!1,!0);q&&(U+=q.length)}}return{start:z,length:U}}}_selectWordAt(m,w){let A=this._getWordAt(m,w);if(A){for(;A.start<0;)A.start+=this._bufferService.cols,m[1]--;this._model.selectionStart=[A.start,m[1]],this._model.selectionStartLength=A.length}}_selectToWordAt(m){let w=this._getWordAt(m,!0);if(w){let A=m[1];for(;w.start<0;)w.start+=this._bufferService.cols,A--;if(!this._model.areSelectionValuesReversed())for(;w.start+w.length>this._bufferService.cols;)w.length-=this._bufferService.cols,A++;this._model.selectionEnd=[this._model.areSelectionValuesReversed()?w.start:w.start+w.length,A]}}_isCharWordSeparator(m){return m.getWidth()!==0&&this._optionsService.rawOptions.wordSeparator.indexOf(m.getChars())>=0}_selectLineAt(m){let w=this._bufferService.buffer.getWrappedRangeForLine(m),A={start:{x:0,y:w.first},end:{x:this._bufferService.cols-1,y:w.last}};this._model.selectionStart=[0,w.first],this._model.selectionEnd=void 0,this._model.selectionStartLength=(0,n.getRangeLength)(A,this._bufferService.cols)}};i.SelectionService=x=h([f(3,_.IBufferService),f(4,_.ICoreService),f(5,S.IMouseService),f(6,_.IOptionsService),f(7,S.IRenderService),f(8,S.ICoreBrowserService)],x)},4725:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.IThemeService=i.ICharacterJoinerService=i.ISelectionService=i.IRenderService=i.IMouseService=i.ICoreBrowserService=i.ICharSizeService=void 0;let h=o(8343);i.ICharSizeService=(0,h.createDecorator)("CharSizeService"),i.ICoreBrowserService=(0,h.createDecorator)("CoreBrowserService"),i.IMouseService=(0,h.createDecorator)("MouseService"),i.IRenderService=(0,h.createDecorator)("RenderService"),i.ISelectionService=(0,h.createDecorator)("SelectionService"),i.ICharacterJoinerService=(0,h.createDecorator)("CharacterJoinerService"),i.IThemeService=(0,h.createDecorator)("ThemeService")},6731:function(u,i,o){var h=this&&this.__decorate||function(x,m,w,A){var T,D=arguments.length,O=D<3?m:A===null?A=Object.getOwnPropertyDescriptor(m,w):A;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")O=Reflect.decorate(x,m,w,A);else for(var F=x.length-1;F>=0;F--)(T=x[F])&&(O=(D<3?T(O):D>3?T(m,w,O):T(m,w))||O);return D>3&&O&&Object.defineProperty(m,w,O),O},f=this&&this.__param||function(x,m){return function(w,A){m(w,A,x)}};Object.defineProperty(i,"__esModule",{value:!0}),i.ThemeService=i.DEFAULT_ANSI_COLORS=void 0;let c=o(7239),p=o(8055),v=o(8460),S=o(844),g=o(2585),s=p.css.toColor("#ffffff"),a=p.css.toColor("#000000"),n=p.css.toColor("#ffffff"),l=p.css.toColor("#000000"),_={css:"rgba(255, 255, 255, 0.3)",rgba:4294967117};i.DEFAULT_ANSI_COLORS=Object.freeze((()=>{let x=[p.css.toColor("#2e3436"),p.css.toColor("#cc0000"),p.css.toColor("#4e9a06"),p.css.toColor("#c4a000"),p.css.toColor("#3465a4"),p.css.toColor("#75507b"),p.css.toColor("#06989a"),p.css.toColor("#d3d7cf"),p.css.toColor("#555753"),p.css.toColor("#ef2929"),p.css.toColor("#8ae234"),p.css.toColor("#fce94f"),p.css.toColor("#729fcf"),p.css.toColor("#ad7fa8"),p.css.toColor("#34e2e2"),p.css.toColor("#eeeeec")],m=[0,95,135,175,215,255];for(let w=0;w<216;w++){let A=m[w/36%6|0],T=m[w/6%6|0],D=m[w%6];x.push({css:p.channels.toCss(A,T,D),rgba:p.channels.toRgba(A,T,D)})}for(let w=0;w<24;w++){let A=8+10*w;x.push({css:p.channels.toCss(A,A,A),rgba:p.channels.toRgba(A,A,A)})}return x})());let b=i.ThemeService=class extends S.Disposable{get colors(){return this._colors}constructor(x){super(),this._optionsService=x,this._contrastCache=new c.ColorContrastCache,this._halfContrastCache=new c.ColorContrastCache,this._onChangeColors=this.register(new v.EventEmitter),this.onChangeColors=this._onChangeColors.event,this._colors={foreground:s,background:a,cursor:n,cursorAccent:l,selectionForeground:void 0,selectionBackgroundTransparent:_,selectionBackgroundOpaque:p.color.blend(a,_),selectionInactiveBackgroundTransparent:_,selectionInactiveBackgroundOpaque:p.color.blend(a,_),ansi:i.DEFAULT_ANSI_COLORS.slice(),contrastCache:this._contrastCache,halfContrastCache:this._halfContrastCache},this._updateRestoreColors(),this._setTheme(this._optionsService.rawOptions.theme),this.register(this._optionsService.onSpecificOptionChange("minimumContrastRatio",(()=>this._contrastCache.clear()))),this.register(this._optionsService.onSpecificOptionChange("theme",(()=>this._setTheme(this._optionsService.rawOptions.theme))))}_setTheme(x={}){let m=this._colors;if(m.foreground=y(x.foreground,s),m.background=y(x.background,a),m.cursor=y(x.cursor,n),m.cursorAccent=y(x.cursorAccent,l),m.selectionBackgroundTransparent=y(x.selectionBackground,_),m.selectionBackgroundOpaque=p.color.blend(m.background,m.selectionBackgroundTransparent),m.selectionInactiveBackgroundTransparent=y(x.selectionInactiveBackground,m.selectionBackgroundTransparent),m.selectionInactiveBackgroundOpaque=p.color.blend(m.background,m.selectionInactiveBackgroundTransparent),m.selectionForeground=x.selectionForeground?y(x.selectionForeground,p.NULL_COLOR):void 0,m.selectionForeground===p.NULL_COLOR&&(m.selectionForeground=void 0),p.color.isOpaque(m.selectionBackgroundTransparent)&&(m.selectionBackgroundTransparent=p.color.opacity(m.selectionBackgroundTransparent,.3)),p.color.isOpaque(m.selectionInactiveBackgroundTransparent)&&(m.selectionInactiveBackgroundTransparent=p.color.opacity(m.selectionInactiveBackgroundTransparent,.3)),m.ansi=i.DEFAULT_ANSI_COLORS.slice(),m.ansi[0]=y(x.black,i.DEFAULT_ANSI_COLORS[0]),m.ansi[1]=y(x.red,i.DEFAULT_ANSI_COLORS[1]),m.ansi[2]=y(x.green,i.DEFAULT_ANSI_COLORS[2]),m.ansi[3]=y(x.yellow,i.DEFAULT_ANSI_COLORS[3]),m.ansi[4]=y(x.blue,i.DEFAULT_ANSI_COLORS[4]),m.ansi[5]=y(x.magenta,i.DEFAULT_ANSI_COLORS[5]),m.ansi[6]=y(x.cyan,i.DEFAULT_ANSI_COLORS[6]),m.ansi[7]=y(x.white,i.DEFAULT_ANSI_COLORS[7]),m.ansi[8]=y(x.brightBlack,i.DEFAULT_ANSI_COLORS[8]),m.ansi[9]=y(x.brightRed,i.DEFAULT_ANSI_COLORS[9]),m.ansi[10]=y(x.brightGreen,i.DEFAULT_ANSI_COLORS[10]),m.ansi[11]=y(x.brightYellow,i.DEFAULT_ANSI_COLORS[11]),m.ansi[12]=y(x.brightBlue,i.DEFAULT_ANSI_COLORS[12]),m.ansi[13]=y(x.brightMagenta,i.DEFAULT_ANSI_COLORS[13]),m.ansi[14]=y(x.brightCyan,i.DEFAULT_ANSI_COLORS[14]),m.ansi[15]=y(x.brightWhite,i.DEFAULT_ANSI_COLORS[15]),x.extendedAnsi){let w=Math.min(m.ansi.length-16,x.extendedAnsi.length);for(let A=0;A<w;A++)m.ansi[A+16]=y(x.extendedAnsi[A],i.DEFAULT_ANSI_COLORS[A+16])}this._contrastCache.clear(),this._halfContrastCache.clear(),this._updateRestoreColors(),this._onChangeColors.fire(this.colors)}restoreColor(x){this._restoreColor(x),this._onChangeColors.fire(this.colors)}_restoreColor(x){if(x!==void 0)switch(x){case 256:this._colors.foreground=this._restoreColors.foreground;break;case 257:this._colors.background=this._restoreColors.background;break;case 258:this._colors.cursor=this._restoreColors.cursor;break;default:this._colors.ansi[x]=this._restoreColors.ansi[x]}else for(let m=0;m<this._restoreColors.ansi.length;++m)this._colors.ansi[m]=this._restoreColors.ansi[m]}modifyColors(x){x(this._colors),this._onChangeColors.fire(this.colors)}_updateRestoreColors(){this._restoreColors={foreground:this._colors.foreground,background:this._colors.background,cursor:this._colors.cursor,ansi:this._colors.ansi.slice()}}};function y(x,m){if(x!==void 0)try{return p.css.toColor(x)}catch{}return m}i.ThemeService=b=h([f(0,g.IOptionsService)],b)},6349:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CircularList=void 0;let h=o(8460),f=o(844);class c extends f.Disposable{constructor(v){super(),this._maxLength=v,this.onDeleteEmitter=this.register(new h.EventEmitter),this.onDelete=this.onDeleteEmitter.event,this.onInsertEmitter=this.register(new h.EventEmitter),this.onInsert=this.onInsertEmitter.event,this.onTrimEmitter=this.register(new h.EventEmitter),this.onTrim=this.onTrimEmitter.event,this._array=new Array(this._maxLength),this._startIndex=0,this._length=0}get maxLength(){return this._maxLength}set maxLength(v){if(this._maxLength===v)return;let S=new Array(v);for(let g=0;g<Math.min(v,this.length);g++)S[g]=this._array[this._getCyclicIndex(g)];this._array=S,this._maxLength=v,this._startIndex=0}get length(){return this._length}set length(v){if(v>this._length)for(let S=this._length;S<v;S++)this._array[S]=void 0;this._length=v}get(v){return this._array[this._getCyclicIndex(v)]}set(v,S){this._array[this._getCyclicIndex(v)]=S}push(v){this._array[this._getCyclicIndex(this._length)]=v,this._length===this._maxLength?(this._startIndex=++this._startIndex%this._maxLength,this.onTrimEmitter.fire(1)):this._length++}recycle(){if(this._length!==this._maxLength)throw new Error("Can only recycle when the buffer is full");return this._startIndex=++this._startIndex%this._maxLength,this.onTrimEmitter.fire(1),this._array[this._getCyclicIndex(this._length-1)]}get isFull(){return this._length===this._maxLength}pop(){return this._array[this._getCyclicIndex(this._length---1)]}splice(v,S,...g){if(S){for(let s=v;s<this._length-S;s++)this._array[this._getCyclicIndex(s)]=this._array[this._getCyclicIndex(s+S)];this._length-=S,this.onDeleteEmitter.fire({index:v,amount:S})}for(let s=this._length-1;s>=v;s--)this._array[this._getCyclicIndex(s+g.length)]=this._array[this._getCyclicIndex(s)];for(let s=0;s<g.length;s++)this._array[this._getCyclicIndex(v+s)]=g[s];if(g.length&&this.onInsertEmitter.fire({index:v,amount:g.length}),this._length+g.length>this._maxLength){let s=this._length+g.length-this._maxLength;this._startIndex+=s,this._length=this._maxLength,this.onTrimEmitter.fire(s)}else this._length+=g.length}trimStart(v){v>this._length&&(v=this._length),this._startIndex+=v,this._length-=v,this.onTrimEmitter.fire(v)}shiftElements(v,S,g){if(!(S<=0)){if(v<0||v>=this._length)throw new Error("start argument out of range");if(v+g<0)throw new Error("Cannot shift elements in list beyond index 0");if(g>0){for(let a=S-1;a>=0;a--)this.set(v+a+g,this.get(v+a));let s=v+S+g-this._length;if(s>0)for(this._length+=s;this._length>this._maxLength;)this._length--,this._startIndex++,this.onTrimEmitter.fire(1)}else for(let s=0;s<S;s++)this.set(v+s+g,this.get(v+s))}}_getCyclicIndex(v){return(this._startIndex+v)%this._maxLength}}i.CircularList=c},1439:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.clone=void 0,i.clone=function o(h,f=5){if(typeof h!="object")return h;let c=Array.isArray(h)?[]:{};for(let p in h)c[p]=f<=1?h[p]:h[p]&&o(h[p],f-1);return c}},8055:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.contrastRatio=i.toPaddedHex=i.rgba=i.rgb=i.css=i.color=i.channels=i.NULL_COLOR=void 0;let h=o(6114),f=0,c=0,p=0,v=0;var S,g,s,a,n;function l(b){let y=b.toString(16);return y.length<2?"0"+y:y}function _(b,y){return b<y?(y+.05)/(b+.05):(b+.05)/(y+.05)}i.NULL_COLOR={css:"#00000000",rgba:0},(function(b){b.toCss=function(y,x,m,w){return w!==void 0?`#${l(y)}${l(x)}${l(m)}${l(w)}`:`#${l(y)}${l(x)}${l(m)}`},b.toRgba=function(y,x,m,w=255){return(y<<24|x<<16|m<<8|w)>>>0}})(S||(i.channels=S={})),(function(b){function y(x,m){return v=Math.round(255*m),[f,c,p]=n.toChannels(x.rgba),{css:S.toCss(f,c,p,v),rgba:S.toRgba(f,c,p,v)}}b.blend=function(x,m){if(v=(255&m.rgba)/255,v===1)return{css:m.css,rgba:m.rgba};let w=m.rgba>>24&255,A=m.rgba>>16&255,T=m.rgba>>8&255,D=x.rgba>>24&255,O=x.rgba>>16&255,F=x.rgba>>8&255;return f=D+Math.round((w-D)*v),c=O+Math.round((A-O)*v),p=F+Math.round((T-F)*v),{css:S.toCss(f,c,p),rgba:S.toRgba(f,c,p)}},b.isOpaque=function(x){return(255&x.rgba)==255},b.ensureContrastRatio=function(x,m,w){let A=n.ensureContrastRatio(x.rgba,m.rgba,w);if(A)return n.toColor(A>>24&255,A>>16&255,A>>8&255)},b.opaque=function(x){let m=(255|x.rgba)>>>0;return[f,c,p]=n.toChannels(m),{css:S.toCss(f,c,p),rgba:m}},b.opacity=y,b.multiplyOpacity=function(x,m){return v=255&x.rgba,y(x,v*m/255)},b.toColorRGB=function(x){return[x.rgba>>24&255,x.rgba>>16&255,x.rgba>>8&255]}})(g||(i.color=g={})),(function(b){let y,x;if(!h.isNode){let m=document.createElement("canvas");m.width=1,m.height=1;let w=m.getContext("2d",{willReadFrequently:!0});w&&(y=w,y.globalCompositeOperation="copy",x=y.createLinearGradient(0,0,1,1))}b.toColor=function(m){if(m.match(/#[\da-f]{3,8}/i))switch(m.length){case 4:return f=parseInt(m.slice(1,2).repeat(2),16),c=parseInt(m.slice(2,3).repeat(2),16),p=parseInt(m.slice(3,4).repeat(2),16),n.toColor(f,c,p);case 5:return f=parseInt(m.slice(1,2).repeat(2),16),c=parseInt(m.slice(2,3).repeat(2),16),p=parseInt(m.slice(3,4).repeat(2),16),v=parseInt(m.slice(4,5).repeat(2),16),n.toColor(f,c,p,v);case 7:return{css:m,rgba:(parseInt(m.slice(1),16)<<8|255)>>>0};case 9:return{css:m,rgba:parseInt(m.slice(1),16)>>>0}}let w=m.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*(0|1|\d?\.(\d+))\s*)?\)/);if(w)return f=parseInt(w[1]),c=parseInt(w[2]),p=parseInt(w[3]),v=Math.round(255*(w[5]===void 0?1:parseFloat(w[5]))),n.toColor(f,c,p,v);if(!y||!x)throw new Error("css.toColor: Unsupported css format");if(y.fillStyle=x,y.fillStyle=m,typeof y.fillStyle!="string")throw new Error("css.toColor: Unsupported css format");if(y.fillRect(0,0,1,1),[f,c,p,v]=y.getImageData(0,0,1,1).data,v!==255)throw new Error("css.toColor: Unsupported css format");return{rgba:S.toRgba(f,c,p,v),css:m}}})(s||(i.css=s={})),(function(b){function y(x,m,w){let A=x/255,T=m/255,D=w/255;return .2126*(A<=.03928?A/12.92:Math.pow((A+.055)/1.055,2.4))+.7152*(T<=.03928?T/12.92:Math.pow((T+.055)/1.055,2.4))+.0722*(D<=.03928?D/12.92:Math.pow((D+.055)/1.055,2.4))}b.relativeLuminance=function(x){return y(x>>16&255,x>>8&255,255&x)},b.relativeLuminance2=y})(a||(i.rgb=a={})),(function(b){function y(m,w,A){let T=m>>24&255,D=m>>16&255,O=m>>8&255,F=w>>24&255,P=w>>16&255,M=w>>8&255,I=_(a.relativeLuminance2(F,P,M),a.relativeLuminance2(T,D,O));for(;I<A&&(F>0||P>0||M>0);)F-=Math.max(0,Math.ceil(.1*F)),P-=Math.max(0,Math.ceil(.1*P)),M-=Math.max(0,Math.ceil(.1*M)),I=_(a.relativeLuminance2(F,P,M),a.relativeLuminance2(T,D,O));return(F<<24|P<<16|M<<8|255)>>>0}function x(m,w,A){let T=m>>24&255,D=m>>16&255,O=m>>8&255,F=w>>24&255,P=w>>16&255,M=w>>8&255,I=_(a.relativeLuminance2(F,P,M),a.relativeLuminance2(T,D,O));for(;I<A&&(F<255||P<255||M<255);)F=Math.min(255,F+Math.ceil(.1*(255-F))),P=Math.min(255,P+Math.ceil(.1*(255-P))),M=Math.min(255,M+Math.ceil(.1*(255-M))),I=_(a.relativeLuminance2(F,P,M),a.relativeLuminance2(T,D,O));return(F<<24|P<<16|M<<8|255)>>>0}b.ensureContrastRatio=function(m,w,A){let T=a.relativeLuminance(m>>8),D=a.relativeLuminance(w>>8);if(_(T,D)<A){if(D<T){let P=y(m,w,A),M=_(T,a.relativeLuminance(P>>8));if(M<A){let I=x(m,w,A);return M>_(T,a.relativeLuminance(I>>8))?P:I}return P}let O=x(m,w,A),F=_(T,a.relativeLuminance(O>>8));if(F<A){let P=y(m,w,A);return F>_(T,a.relativeLuminance(P>>8))?O:P}return O}},b.reduceLuminance=y,b.increaseLuminance=x,b.toChannels=function(m){return[m>>24&255,m>>16&255,m>>8&255,255&m]},b.toColor=function(m,w,A,T){return{css:S.toCss(m,w,A,T),rgba:S.toRgba(m,w,A,T)}}})(n||(i.rgba=n={})),i.toPaddedHex=l,i.contrastRatio=_},8969:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CoreTerminal=void 0;let h=o(844),f=o(2585),c=o(4348),p=o(7866),v=o(744),S=o(7302),g=o(6975),s=o(8460),a=o(1753),n=o(1480),l=o(7994),_=o(9282),b=o(5435),y=o(5981),x=o(2660),m=!1;class w extends h.Disposable{get onScroll(){return this._onScrollApi||(this._onScrollApi=this.register(new s.EventEmitter),this._onScroll.event((T=>{var D;(D=this._onScrollApi)===null||D===void 0||D.fire(T.position)}))),this._onScrollApi.event}get cols(){return this._bufferService.cols}get rows(){return this._bufferService.rows}get buffers(){return this._bufferService.buffers}get options(){return this.optionsService.options}set options(T){for(let D in T)this.optionsService.options[D]=T[D]}constructor(T){super(),this._windowsWrappingHeuristics=this.register(new h.MutableDisposable),this._onBinary=this.register(new s.EventEmitter),this.onBinary=this._onBinary.event,this._onData=this.register(new s.EventEmitter),this.onData=this._onData.event,this._onLineFeed=this.register(new s.EventEmitter),this.onLineFeed=this._onLineFeed.event,this._onResize=this.register(new s.EventEmitter),this.onResize=this._onResize.event,this._onWriteParsed=this.register(new s.EventEmitter),this.onWriteParsed=this._onWriteParsed.event,this._onScroll=this.register(new s.EventEmitter),this._instantiationService=new c.InstantiationService,this.optionsService=this.register(new S.OptionsService(T)),this._instantiationService.setService(f.IOptionsService,this.optionsService),this._bufferService=this.register(this._instantiationService.createInstance(v.BufferService)),this._instantiationService.setService(f.IBufferService,this._bufferService),this._logService=this.register(this._instantiationService.createInstance(p.LogService)),this._instantiationService.setService(f.ILogService,this._logService),this.coreService=this.register(this._instantiationService.createInstance(g.CoreService)),this._instantiationService.setService(f.ICoreService,this.coreService),this.coreMouseService=this.register(this._instantiationService.createInstance(a.CoreMouseService)),this._instantiationService.setService(f.ICoreMouseService,this.coreMouseService),this.unicodeService=this.register(this._instantiationService.createInstance(n.UnicodeService)),this._instantiationService.setService(f.IUnicodeService,this.unicodeService),this._charsetService=this._instantiationService.createInstance(l.CharsetService),this._instantiationService.setService(f.ICharsetService,this._charsetService),this._oscLinkService=this._instantiationService.createInstance(x.OscLinkService),this._instantiationService.setService(f.IOscLinkService,this._oscLinkService),this._inputHandler=this.register(new b.InputHandler(this._bufferService,this._charsetService,this.coreService,this._logService,this.optionsService,this._oscLinkService,this.coreMouseService,this.unicodeService)),this.register((0,s.forwardEvent)(this._inputHandler.onLineFeed,this._onLineFeed)),this.register(this._inputHandler),this.register((0,s.forwardEvent)(this._bufferService.onResize,this._onResize)),this.register((0,s.forwardEvent)(this.coreService.onData,this._onData)),this.register((0,s.forwardEvent)(this.coreService.onBinary,this._onBinary)),this.register(this.coreService.onRequestScrollToBottom((()=>this.scrollToBottom()))),this.register(this.coreService.onUserInput((()=>this._writeBuffer.handleUserInput()))),this.register(this.optionsService.onMultipleOptionChange(["windowsMode","windowsPty"],(()=>this._handleWindowsPtyOptionChange()))),this.register(this._bufferService.onScroll((D=>{this._onScroll.fire({position:this._bufferService.buffer.ydisp,source:0}),this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop,this._bufferService.buffer.scrollBottom)}))),this.register(this._inputHandler.onScroll((D=>{this._onScroll.fire({position:this._bufferService.buffer.ydisp,source:0}),this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop,this._bufferService.buffer.scrollBottom)}))),this._writeBuffer=this.register(new y.WriteBuffer(((D,O)=>this._inputHandler.parse(D,O)))),this.register((0,s.forwardEvent)(this._writeBuffer.onWriteParsed,this._onWriteParsed))}write(T,D){this._writeBuffer.write(T,D)}writeSync(T,D){this._logService.logLevel<=f.LogLevelEnum.WARN&&!m&&(this._logService.warn("writeSync is unreliable and will be removed soon."),m=!0),this._writeBuffer.writeSync(T,D)}resize(T,D){isNaN(T)||isNaN(D)||(T=Math.max(T,v.MINIMUM_COLS),D=Math.max(D,v.MINIMUM_ROWS),this._bufferService.resize(T,D))}scroll(T,D=!1){this._bufferService.scroll(T,D)}scrollLines(T,D,O){this._bufferService.scrollLines(T,D,O)}scrollPages(T){this.scrollLines(T*(this.rows-1))}scrollToTop(){this.scrollLines(-this._bufferService.buffer.ydisp)}scrollToBottom(){this.scrollLines(this._bufferService.buffer.ybase-this._bufferService.buffer.ydisp)}scrollToLine(T){let D=T-this._bufferService.buffer.ydisp;D!==0&&this.scrollLines(D)}registerEscHandler(T,D){return this._inputHandler.registerEscHandler(T,D)}registerDcsHandler(T,D){return this._inputHandler.registerDcsHandler(T,D)}registerCsiHandler(T,D){return this._inputHandler.registerCsiHandler(T,D)}registerOscHandler(T,D){return this._inputHandler.registerOscHandler(T,D)}_setup(){this._handleWindowsPtyOptionChange()}reset(){this._inputHandler.reset(),this._bufferService.reset(),this._charsetService.reset(),this.coreService.reset(),this.coreMouseService.reset()}_handleWindowsPtyOptionChange(){let T=!1,D=this.optionsService.rawOptions.windowsPty;D&&D.buildNumber!==void 0&&D.buildNumber!==void 0?T=D.backend==="conpty"&&D.buildNumber<21376:this.optionsService.rawOptions.windowsMode&&(T=!0),T?this._enableWindowsWrappingHeuristics():this._windowsWrappingHeuristics.clear()}_enableWindowsWrappingHeuristics(){if(!this._windowsWrappingHeuristics.value){let T=[];T.push(this.onLineFeed(_.updateWindowsModeWrappedState.bind(null,this._bufferService))),T.push(this.registerCsiHandler({final:"H"},(()=>((0,_.updateWindowsModeWrappedState)(this._bufferService),!1)))),this._windowsWrappingHeuristics.value=(0,h.toDisposable)((()=>{for(let D of T)D.dispose()}))}}}i.CoreTerminal=w},8460:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.forwardEvent=i.EventEmitter=void 0,i.EventEmitter=class{constructor(){this._listeners=[],this._disposed=!1}get event(){return this._event||(this._event=o=>(this._listeners.push(o),{dispose:()=>{if(!this._disposed){for(let h=0;h<this._listeners.length;h++)if(this._listeners[h]===o)return void this._listeners.splice(h,1)}}})),this._event}fire(o,h){let f=[];for(let c=0;c<this._listeners.length;c++)f.push(this._listeners[c]);for(let c=0;c<f.length;c++)f[c].call(void 0,o,h)}dispose(){this.clearListeners(),this._disposed=!0}clearListeners(){this._listeners&&(this._listeners.length=0)}},i.forwardEvent=function(o,h){return o((f=>h.fire(f)))}},5435:function(u,i,o){var h=this&&this.__decorate||function(I,C,k,L){var R,z=arguments.length,U=z<3?C:L===null?L=Object.getOwnPropertyDescriptor(C,k):L;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")U=Reflect.decorate(I,C,k,L);else for(var K=I.length-1;K>=0;K--)(R=I[K])&&(U=(z<3?R(U):z>3?R(C,k,U):R(C,k))||U);return z>3&&U&&Object.defineProperty(C,k,U),U},f=this&&this.__param||function(I,C){return function(k,L){C(k,L,I)}};Object.defineProperty(i,"__esModule",{value:!0}),i.InputHandler=i.WindowsOptionsReportType=void 0;let c=o(2584),p=o(7116),v=o(2015),S=o(844),g=o(482),s=o(8437),a=o(8460),n=o(643),l=o(511),_=o(3734),b=o(2585),y=o(6242),x=o(6351),m=o(5941),w={"(":0,")":1,"*":2,"+":3,"-":1,".":2},A=131072;function T(I,C){if(I>24)return C.setWinLines||!1;switch(I){case 1:return!!C.restoreWin;case 2:return!!C.minimizeWin;case 3:return!!C.setWinPosition;case 4:return!!C.setWinSizePixels;case 5:return!!C.raiseWin;case 6:return!!C.lowerWin;case 7:return!!C.refreshWin;case 8:return!!C.setWinSizeChars;case 9:return!!C.maximizeWin;case 10:return!!C.fullscreenWin;case 11:return!!C.getWinState;case 13:return!!C.getWinPosition;case 14:return!!C.getWinSizePixels;case 15:return!!C.getScreenSizePixels;case 16:return!!C.getCellSizePixels;case 18:return!!C.getWinSizeChars;case 19:return!!C.getScreenSizeChars;case 20:return!!C.getIconTitle;case 21:return!!C.getWinTitle;case 22:return!!C.pushTitle;case 23:return!!C.popTitle;case 24:return!!C.setWinLines}return!1}var D;(function(I){I[I.GET_WIN_SIZE_PIXELS=0]="GET_WIN_SIZE_PIXELS",I[I.GET_CELL_SIZE_PIXELS=1]="GET_CELL_SIZE_PIXELS"})(D||(i.WindowsOptionsReportType=D={}));let O=0;class F extends S.Disposable{getAttrData(){return this._curAttrData}constructor(C,k,L,R,z,U,K,q,te=new v.EscapeSequenceParser){super(),this._bufferService=C,this._charsetService=k,this._coreService=L,this._logService=R,this._optionsService=z,this._oscLinkService=U,this._coreMouseService=K,this._unicodeService=q,this._parser=te,this._parseBuffer=new Uint32Array(4096),this._stringDecoder=new g.StringToUtf32,this._utf8Decoder=new g.Utf8ToUtf32,this._workCell=new l.CellData,this._windowTitle="",this._iconName="",this._windowTitleStack=[],this._iconNameStack=[],this._curAttrData=s.DEFAULT_ATTR_DATA.clone(),this._eraseAttrDataInternal=s.DEFAULT_ATTR_DATA.clone(),this._onRequestBell=this.register(new a.EventEmitter),this.onRequestBell=this._onRequestBell.event,this._onRequestRefreshRows=this.register(new a.EventEmitter),this.onRequestRefreshRows=this._onRequestRefreshRows.event,this._onRequestReset=this.register(new a.EventEmitter),this.onRequestReset=this._onRequestReset.event,this._onRequestSendFocus=this.register(new a.EventEmitter),this.onRequestSendFocus=this._onRequestSendFocus.event,this._onRequestSyncScrollBar=this.register(new a.EventEmitter),this.onRequestSyncScrollBar=this._onRequestSyncScrollBar.event,this._onRequestWindowsOptionsReport=this.register(new a.EventEmitter),this.onRequestWindowsOptionsReport=this._onRequestWindowsOptionsReport.event,this._onA11yChar=this.register(new a.EventEmitter),this.onA11yChar=this._onA11yChar.event,this._onA11yTab=this.register(new a.EventEmitter),this.onA11yTab=this._onA11yTab.event,this._onCursorMove=this.register(new a.EventEmitter),this.onCursorMove=this._onCursorMove.event,this._onLineFeed=this.register(new a.EventEmitter),this.onLineFeed=this._onLineFeed.event,this._onScroll=this.register(new a.EventEmitter),this.onScroll=this._onScroll.event,this._onTitleChange=this.register(new a.EventEmitter),this.onTitleChange=this._onTitleChange.event,this._onColor=this.register(new a.EventEmitter),this.onColor=this._onColor.event,this._parseStack={paused:!1,cursorStartX:0,cursorStartY:0,decodedLength:0,position:0},this._specialColors=[256,257,258],this.register(this._parser),this._dirtyRowTracker=new P(this._bufferService),this._activeBuffer=this._bufferService.buffer,this.register(this._bufferService.buffers.onBufferActivate((E=>this._activeBuffer=E.activeBuffer))),this._parser.setCsiHandlerFallback(((E,$)=>{this._logService.debug("Unknown CSI code: ",{identifier:this._parser.identToString(E),params:$.toArray()})})),this._parser.setEscHandlerFallback((E=>{this._logService.debug("Unknown ESC code: ",{identifier:this._parser.identToString(E)})})),this._parser.setExecuteHandlerFallback((E=>{this._logService.debug("Unknown EXECUTE code: ",{code:E})})),this._parser.setOscHandlerFallback(((E,$,W)=>{this._logService.debug("Unknown OSC code: ",{identifier:E,action:$,data:W})})),this._parser.setDcsHandlerFallback(((E,$,W)=>{$==="HOOK"&&(W=W.toArray()),this._logService.debug("Unknown DCS code: ",{identifier:this._parser.identToString(E),action:$,payload:W})})),this._parser.setPrintHandler(((E,$,W)=>this.print(E,$,W))),this._parser.registerCsiHandler({final:"@"},(E=>this.insertChars(E))),this._parser.registerCsiHandler({intermediates:" ",final:"@"},(E=>this.scrollLeft(E))),this._parser.registerCsiHandler({final:"A"},(E=>this.cursorUp(E))),this._parser.registerCsiHandler({intermediates:" ",final:"A"},(E=>this.scrollRight(E))),this._parser.registerCsiHandler({final:"B"},(E=>this.cursorDown(E))),this._parser.registerCsiHandler({final:"C"},(E=>this.cursorForward(E))),this._parser.registerCsiHandler({final:"D"},(E=>this.cursorBackward(E))),this._parser.registerCsiHandler({final:"E"},(E=>this.cursorNextLine(E))),this._parser.registerCsiHandler({final:"F"},(E=>this.cursorPrecedingLine(E))),this._parser.registerCsiHandler({final:"G"},(E=>this.cursorCharAbsolute(E))),this._parser.registerCsiHandler({final:"H"},(E=>this.cursorPosition(E))),this._parser.registerCsiHandler({final:"I"},(E=>this.cursorForwardTab(E))),this._parser.registerCsiHandler({final:"J"},(E=>this.eraseInDisplay(E,!1))),this._parser.registerCsiHandler({prefix:"?",final:"J"},(E=>this.eraseInDisplay(E,!0))),this._parser.registerCsiHandler({final:"K"},(E=>this.eraseInLine(E,!1))),this._parser.registerCsiHandler({prefix:"?",final:"K"},(E=>this.eraseInLine(E,!0))),this._parser.registerCsiHandler({final:"L"},(E=>this.insertLines(E))),this._parser.registerCsiHandler({final:"M"},(E=>this.deleteLines(E))),this._parser.registerCsiHandler({final:"P"},(E=>this.deleteChars(E))),this._parser.registerCsiHandler({final:"S"},(E=>this.scrollUp(E))),this._parser.registerCsiHandler({final:"T"},(E=>this.scrollDown(E))),this._parser.registerCsiHandler({final:"X"},(E=>this.eraseChars(E))),this._parser.registerCsiHandler({final:"Z"},(E=>this.cursorBackwardTab(E))),this._parser.registerCsiHandler({final:"`"},(E=>this.charPosAbsolute(E))),this._parser.registerCsiHandler({final:"a"},(E=>this.hPositionRelative(E))),this._parser.registerCsiHandler({final:"b"},(E=>this.repeatPrecedingCharacter(E))),this._parser.registerCsiHandler({final:"c"},(E=>this.sendDeviceAttributesPrimary(E))),this._parser.registerCsiHandler({prefix:">",final:"c"},(E=>this.sendDeviceAttributesSecondary(E))),this._parser.registerCsiHandler({final:"d"},(E=>this.linePosAbsolute(E))),this._parser.registerCsiHandler({final:"e"},(E=>this.vPositionRelative(E))),this._parser.registerCsiHandler({final:"f"},(E=>this.hVPosition(E))),this._parser.registerCsiHandler({final:"g"},(E=>this.tabClear(E))),this._parser.registerCsiHandler({final:"h"},(E=>this.setMode(E))),this._parser.registerCsiHandler({prefix:"?",final:"h"},(E=>this.setModePrivate(E))),this._parser.registerCsiHandler({final:"l"},(E=>this.resetMode(E))),this._parser.registerCsiHandler({prefix:"?",final:"l"},(E=>this.resetModePrivate(E))),this._parser.registerCsiHandler({final:"m"},(E=>this.charAttributes(E))),this._parser.registerCsiHandler({final:"n"},(E=>this.deviceStatus(E))),this._parser.registerCsiHandler({prefix:"?",final:"n"},(E=>this.deviceStatusPrivate(E))),this._parser.registerCsiHandler({intermediates:"!",final:"p"},(E=>this.softReset(E))),this._parser.registerCsiHandler({intermediates:" ",final:"q"},(E=>this.setCursorStyle(E))),this._parser.registerCsiHandler({final:"r"},(E=>this.setScrollRegion(E))),this._parser.registerCsiHandler({final:"s"},(E=>this.saveCursor(E))),this._parser.registerCsiHandler({final:"t"},(E=>this.windowOptions(E))),this._parser.registerCsiHandler({final:"u"},(E=>this.restoreCursor(E))),this._parser.registerCsiHandler({intermediates:"'",final:"}"},(E=>this.insertColumns(E))),this._parser.registerCsiHandler({intermediates:"'",final:"~"},(E=>this.deleteColumns(E))),this._parser.registerCsiHandler({intermediates:'"',final:"q"},(E=>this.selectProtected(E))),this._parser.registerCsiHandler({intermediates:"$",final:"p"},(E=>this.requestMode(E,!0))),this._parser.registerCsiHandler({prefix:"?",intermediates:"$",final:"p"},(E=>this.requestMode(E,!1))),this._parser.setExecuteHandler(c.C0.BEL,(()=>this.bell())),this._parser.setExecuteHandler(c.C0.LF,(()=>this.lineFeed())),this._parser.setExecuteHandler(c.C0.VT,(()=>this.lineFeed())),this._parser.setExecuteHandler(c.C0.FF,(()=>this.lineFeed())),this._parser.setExecuteHandler(c.C0.CR,(()=>this.carriageReturn())),this._parser.setExecuteHandler(c.C0.BS,(()=>this.backspace())),this._parser.setExecuteHandler(c.C0.HT,(()=>this.tab())),this._parser.setExecuteHandler(c.C0.SO,(()=>this.shiftOut())),this._parser.setExecuteHandler(c.C0.SI,(()=>this.shiftIn())),this._parser.setExecuteHandler(c.C1.IND,(()=>this.index())),this._parser.setExecuteHandler(c.C1.NEL,(()=>this.nextLine())),this._parser.setExecuteHandler(c.C1.HTS,(()=>this.tabSet())),this._parser.registerOscHandler(0,new y.OscHandler((E=>(this.setTitle(E),this.setIconName(E),!0)))),this._parser.registerOscHandler(1,new y.OscHandler((E=>this.setIconName(E)))),this._parser.registerOscHandler(2,new y.OscHandler((E=>this.setTitle(E)))),this._parser.registerOscHandler(4,new y.OscHandler((E=>this.setOrReportIndexedColor(E)))),this._parser.registerOscHandler(8,new y.OscHandler((E=>this.setHyperlink(E)))),this._parser.registerOscHandler(10,new y.OscHandler((E=>this.setOrReportFgColor(E)))),this._parser.registerOscHandler(11,new y.OscHandler((E=>this.setOrReportBgColor(E)))),this._parser.registerOscHandler(12,new y.OscHandler((E=>this.setOrReportCursorColor(E)))),this._parser.registerOscHandler(104,new y.OscHandler((E=>this.restoreIndexedColor(E)))),this._parser.registerOscHandler(110,new y.OscHandler((E=>this.restoreFgColor(E)))),this._parser.registerOscHandler(111,new y.OscHandler((E=>this.restoreBgColor(E)))),this._parser.registerOscHandler(112,new y.OscHandler((E=>this.restoreCursorColor(E)))),this._parser.registerEscHandler({final:"7"},(()=>this.saveCursor())),this._parser.registerEscHandler({final:"8"},(()=>this.restoreCursor())),this._parser.registerEscHandler({final:"D"},(()=>this.index())),this._parser.registerEscHandler({final:"E"},(()=>this.nextLine())),this._parser.registerEscHandler({final:"H"},(()=>this.tabSet())),this._parser.registerEscHandler({final:"M"},(()=>this.reverseIndex())),this._parser.registerEscHandler({final:"="},(()=>this.keypadApplicationMode())),this._parser.registerEscHandler({final:">"},(()=>this.keypadNumericMode())),this._parser.registerEscHandler({final:"c"},(()=>this.fullReset())),this._parser.registerEscHandler({final:"n"},(()=>this.setgLevel(2))),this._parser.registerEscHandler({final:"o"},(()=>this.setgLevel(3))),this._parser.registerEscHandler({final:"|"},(()=>this.setgLevel(3))),this._parser.registerEscHandler({final:"}"},(()=>this.setgLevel(2))),this._parser.registerEscHandler({final:"~"},(()=>this.setgLevel(1))),this._parser.registerEscHandler({intermediates:"%",final:"@"},(()=>this.selectDefaultCharset())),this._parser.registerEscHandler({intermediates:"%",final:"G"},(()=>this.selectDefaultCharset()));for(let E in p.CHARSETS)this._parser.registerEscHandler({intermediates:"(",final:E},(()=>this.selectCharset("("+E))),this._parser.registerEscHandler({intermediates:")",final:E},(()=>this.selectCharset(")"+E))),this._parser.registerEscHandler({intermediates:"*",final:E},(()=>this.selectCharset("*"+E))),this._parser.registerEscHandler({intermediates:"+",final:E},(()=>this.selectCharset("+"+E))),this._parser.registerEscHandler({intermediates:"-",final:E},(()=>this.selectCharset("-"+E))),this._parser.registerEscHandler({intermediates:".",final:E},(()=>this.selectCharset("."+E))),this._parser.registerEscHandler({intermediates:"/",final:E},(()=>this.selectCharset("/"+E)));this._parser.registerEscHandler({intermediates:"#",final:"8"},(()=>this.screenAlignmentPattern())),this._parser.setErrorHandler((E=>(this._logService.error("Parsing error: ",E),E))),this._parser.registerDcsHandler({intermediates:"$",final:"q"},new x.DcsHandler(((E,$)=>this.requestStatusString(E,$))))}_preserveStack(C,k,L,R){this._parseStack.paused=!0,this._parseStack.cursorStartX=C,this._parseStack.cursorStartY=k,this._parseStack.decodedLength=L,this._parseStack.position=R}_logSlowResolvingAsync(C){this._logService.logLevel<=b.LogLevelEnum.WARN&&Promise.race([C,new Promise(((k,L)=>setTimeout((()=>L("#SLOW_TIMEOUT")),5e3)))]).catch((k=>{if(k!=="#SLOW_TIMEOUT")throw k;console.warn("async parser handler taking longer than 5000 ms")}))}_getCurrentLinkId(){return this._curAttrData.extended.urlId}parse(C,k){let L,R=this._activeBuffer.x,z=this._activeBuffer.y,U=0,K=this._parseStack.paused;if(K){if(L=this._parser.parse(this._parseBuffer,this._parseStack.decodedLength,k))return this._logSlowResolvingAsync(L),L;R=this._parseStack.cursorStartX,z=this._parseStack.cursorStartY,this._parseStack.paused=!1,C.length>A&&(U=this._parseStack.position+A)}if(this._logService.logLevel<=b.LogLevelEnum.DEBUG&&this._logService.debug("parsing data"+(typeof C=="string"?` "${C}"`:` "${Array.prototype.map.call(C,(q=>String.fromCharCode(q))).join("")}"`),typeof C=="string"?C.split("").map((q=>q.charCodeAt(0))):C),this._parseBuffer.length<C.length&&this._parseBuffer.length<A&&(this._parseBuffer=new Uint32Array(Math.min(C.length,A))),K||this._dirtyRowTracker.clearRange(),C.length>A)for(let q=U;q<C.length;q+=A){let te=q+A<C.length?q+A:C.length,E=typeof C=="string"?this._stringDecoder.decode(C.substring(q,te),this._parseBuffer):this._utf8Decoder.decode(C.subarray(q,te),this._parseBuffer);if(L=this._parser.parse(this._parseBuffer,E))return this._preserveStack(R,z,E,q),this._logSlowResolvingAsync(L),L}else if(!K){let q=typeof C=="string"?this._stringDecoder.decode(C,this._parseBuffer):this._utf8Decoder.decode(C,this._parseBuffer);if(L=this._parser.parse(this._parseBuffer,q))return this._preserveStack(R,z,q,0),this._logSlowResolvingAsync(L),L}this._activeBuffer.x===R&&this._activeBuffer.y===z||this._onCursorMove.fire(),this._onRequestRefreshRows.fire(this._dirtyRowTracker.start,this._dirtyRowTracker.end)}print(C,k,L){let R,z,U=this._charsetService.charset,K=this._optionsService.rawOptions.screenReaderMode,q=this._bufferService.cols,te=this._coreService.decPrivateModes.wraparound,E=this._coreService.modes.insertMode,$=this._curAttrData,W=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._activeBuffer.x&&L-k>0&&W.getWidth(this._activeBuffer.x-1)===2&&W.setCellFromCodePoint(this._activeBuffer.x-1,0,1,$.fg,$.bg,$.extended);for(let N=k;N<L;++N){if(R=C[N],z=this._unicodeService.wcwidth(R),R<127&&U){let G=U[String.fromCharCode(R)];G&&(R=G.charCodeAt(0))}if(K&&this._onA11yChar.fire((0,g.stringFromCodePoint)(R)),this._getCurrentLinkId()&&this._oscLinkService.addLineToLink(this._getCurrentLinkId(),this._activeBuffer.ybase+this._activeBuffer.y),z||!this._activeBuffer.x){if(this._activeBuffer.x+z-1>=q){if(te){for(;this._activeBuffer.x<q;)W.setCellFromCodePoint(this._activeBuffer.x++,0,1,$.fg,$.bg,$.extended);this._activeBuffer.x=0,this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData(),!0)):(this._activeBuffer.y>=this._bufferService.rows&&(this._activeBuffer.y=this._bufferService.rows-1),this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!0),W=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y)}else if(this._activeBuffer.x=q-1,z===2)continue}if(E&&(W.insertCells(this._activeBuffer.x,z,this._activeBuffer.getNullCell($),$),W.getWidth(q-1)===2&&W.setCellFromCodePoint(q-1,n.NULL_CELL_CODE,n.NULL_CELL_WIDTH,$.fg,$.bg,$.extended)),W.setCellFromCodePoint(this._activeBuffer.x++,R,z,$.fg,$.bg,$.extended),z>0)for(;--z;)W.setCellFromCodePoint(this._activeBuffer.x++,0,0,$.fg,$.bg,$.extended)}else W.getWidth(this._activeBuffer.x-1)?W.addCodepointToCell(this._activeBuffer.x-1,R):W.addCodepointToCell(this._activeBuffer.x-2,R)}L-k>0&&(W.loadCell(this._activeBuffer.x-1,this._workCell),this._workCell.getWidth()===2||this._workCell.getCode()>65535?this._parser.precedingCodepoint=0:this._workCell.isCombined()?this._parser.precedingCodepoint=this._workCell.getChars().charCodeAt(0):this._parser.precedingCodepoint=this._workCell.content),this._activeBuffer.x<q&&L-k>0&&W.getWidth(this._activeBuffer.x)===0&&!W.hasContent(this._activeBuffer.x)&&W.setCellFromCodePoint(this._activeBuffer.x,0,1,$.fg,$.bg,$.extended),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}registerCsiHandler(C,k){return C.final!=="t"||C.prefix||C.intermediates?this._parser.registerCsiHandler(C,k):this._parser.registerCsiHandler(C,(L=>!T(L.params[0],this._optionsService.rawOptions.windowOptions)||k(L)))}registerDcsHandler(C,k){return this._parser.registerDcsHandler(C,new x.DcsHandler(k))}registerEscHandler(C,k){return this._parser.registerEscHandler(C,k)}registerOscHandler(C,k){return this._parser.registerOscHandler(C,new y.OscHandler(k))}bell(){return this._onRequestBell.fire(),!0}lineFeed(){return this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._optionsService.rawOptions.convertEol&&(this._activeBuffer.x=0),this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData())):this._activeBuffer.y>=this._bufferService.rows?this._activeBuffer.y=this._bufferService.rows-1:this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!1,this._activeBuffer.x>=this._bufferService.cols&&this._activeBuffer.x--,this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._onLineFeed.fire(),!0}carriageReturn(){return this._activeBuffer.x=0,!0}backspace(){var C;if(!this._coreService.decPrivateModes.reverseWraparound)return this._restrictCursor(),this._activeBuffer.x>0&&this._activeBuffer.x--,!0;if(this._restrictCursor(this._bufferService.cols),this._activeBuffer.x>0)this._activeBuffer.x--;else if(this._activeBuffer.x===0&&this._activeBuffer.y>this._activeBuffer.scrollTop&&this._activeBuffer.y<=this._activeBuffer.scrollBottom&&(!((C=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y))===null||C===void 0)&&C.isWrapped)){this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!1,this._activeBuffer.y--,this._activeBuffer.x=this._bufferService.cols-1;let k=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);k.hasWidth(this._activeBuffer.x)&&!k.hasContent(this._activeBuffer.x)&&this._activeBuffer.x--}return this._restrictCursor(),!0}tab(){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let C=this._activeBuffer.x;return this._activeBuffer.x=this._activeBuffer.nextStop(),this._optionsService.rawOptions.screenReaderMode&&this._onA11yTab.fire(this._activeBuffer.x-C),!0}shiftOut(){return this._charsetService.setgLevel(1),!0}shiftIn(){return this._charsetService.setgLevel(0),!0}_restrictCursor(C=this._bufferService.cols-1){this._activeBuffer.x=Math.min(C,Math.max(0,this._activeBuffer.x)),this._activeBuffer.y=this._coreService.decPrivateModes.origin?Math.min(this._activeBuffer.scrollBottom,Math.max(this._activeBuffer.scrollTop,this._activeBuffer.y)):Math.min(this._bufferService.rows-1,Math.max(0,this._activeBuffer.y)),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}_setCursor(C,k){this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._coreService.decPrivateModes.origin?(this._activeBuffer.x=C,this._activeBuffer.y=this._activeBuffer.scrollTop+k):(this._activeBuffer.x=C,this._activeBuffer.y=k),this._restrictCursor(),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}_moveCursor(C,k){this._restrictCursor(),this._setCursor(this._activeBuffer.x+C,this._activeBuffer.y+k)}cursorUp(C){let k=this._activeBuffer.y-this._activeBuffer.scrollTop;return k>=0?this._moveCursor(0,-Math.min(k,C.params[0]||1)):this._moveCursor(0,-(C.params[0]||1)),!0}cursorDown(C){let k=this._activeBuffer.scrollBottom-this._activeBuffer.y;return k>=0?this._moveCursor(0,Math.min(k,C.params[0]||1)):this._moveCursor(0,C.params[0]||1),!0}cursorForward(C){return this._moveCursor(C.params[0]||1,0),!0}cursorBackward(C){return this._moveCursor(-(C.params[0]||1),0),!0}cursorNextLine(C){return this.cursorDown(C),this._activeBuffer.x=0,!0}cursorPrecedingLine(C){return this.cursorUp(C),this._activeBuffer.x=0,!0}cursorCharAbsolute(C){return this._setCursor((C.params[0]||1)-1,this._activeBuffer.y),!0}cursorPosition(C){return this._setCursor(C.length>=2?(C.params[1]||1)-1:0,(C.params[0]||1)-1),!0}charPosAbsolute(C){return this._setCursor((C.params[0]||1)-1,this._activeBuffer.y),!0}hPositionRelative(C){return this._moveCursor(C.params[0]||1,0),!0}linePosAbsolute(C){return this._setCursor(this._activeBuffer.x,(C.params[0]||1)-1),!0}vPositionRelative(C){return this._moveCursor(0,C.params[0]||1),!0}hVPosition(C){return this.cursorPosition(C),!0}tabClear(C){let k=C.params[0];return k===0?delete this._activeBuffer.tabs[this._activeBuffer.x]:k===3&&(this._activeBuffer.tabs={}),!0}cursorForwardTab(C){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let k=C.params[0]||1;for(;k--;)this._activeBuffer.x=this._activeBuffer.nextStop();return!0}cursorBackwardTab(C){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let k=C.params[0]||1;for(;k--;)this._activeBuffer.x=this._activeBuffer.prevStop();return!0}selectProtected(C){let k=C.params[0];return k===1&&(this._curAttrData.bg|=536870912),k!==2&&k!==0||(this._curAttrData.bg&=-536870913),!0}_eraseInBufferLine(C,k,L,R=!1,z=!1){let U=this._activeBuffer.lines.get(this._activeBuffer.ybase+C);U.replaceCells(k,L,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData(),z),R&&(U.isWrapped=!1)}_resetBufferLine(C,k=!1){let L=this._activeBuffer.lines.get(this._activeBuffer.ybase+C);L&&(L.fill(this._activeBuffer.getNullCell(this._eraseAttrData()),k),this._bufferService.buffer.clearMarkers(this._activeBuffer.ybase+C),L.isWrapped=!1)}eraseInDisplay(C,k=!1){let L;switch(this._restrictCursor(this._bufferService.cols),C.params[0]){case 0:for(L=this._activeBuffer.y,this._dirtyRowTracker.markDirty(L),this._eraseInBufferLine(L++,this._activeBuffer.x,this._bufferService.cols,this._activeBuffer.x===0,k);L<this._bufferService.rows;L++)this._resetBufferLine(L,k);this._dirtyRowTracker.markDirty(L);break;case 1:for(L=this._activeBuffer.y,this._dirtyRowTracker.markDirty(L),this._eraseInBufferLine(L,0,this._activeBuffer.x+1,!0,k),this._activeBuffer.x+1>=this._bufferService.cols&&(this._activeBuffer.lines.get(L+1).isWrapped=!1);L--;)this._resetBufferLine(L,k);this._dirtyRowTracker.markDirty(0);break;case 2:for(L=this._bufferService.rows,this._dirtyRowTracker.markDirty(L-1);L--;)this._resetBufferLine(L,k);this._dirtyRowTracker.markDirty(0);break;case 3:let R=this._activeBuffer.lines.length-this._bufferService.rows;R>0&&(this._activeBuffer.lines.trimStart(R),this._activeBuffer.ybase=Math.max(this._activeBuffer.ybase-R,0),this._activeBuffer.ydisp=Math.max(this._activeBuffer.ydisp-R,0),this._onScroll.fire(0))}return!0}eraseInLine(C,k=!1){switch(this._restrictCursor(this._bufferService.cols),C.params[0]){case 0:this._eraseInBufferLine(this._activeBuffer.y,this._activeBuffer.x,this._bufferService.cols,this._activeBuffer.x===0,k);break;case 1:this._eraseInBufferLine(this._activeBuffer.y,0,this._activeBuffer.x+1,!1,k);break;case 2:this._eraseInBufferLine(this._activeBuffer.y,0,this._bufferService.cols,!0,k)}return this._dirtyRowTracker.markDirty(this._activeBuffer.y),!0}insertLines(C){this._restrictCursor();let k=C.params[0]||1;if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let L=this._activeBuffer.ybase+this._activeBuffer.y,R=this._bufferService.rows-1-this._activeBuffer.scrollBottom,z=this._bufferService.rows-1+this._activeBuffer.ybase-R+1;for(;k--;)this._activeBuffer.lines.splice(z-1,1),this._activeBuffer.lines.splice(L,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y,this._activeBuffer.scrollBottom),this._activeBuffer.x=0,!0}deleteLines(C){this._restrictCursor();let k=C.params[0]||1;if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let L=this._activeBuffer.ybase+this._activeBuffer.y,R;for(R=this._bufferService.rows-1-this._activeBuffer.scrollBottom,R=this._bufferService.rows-1+this._activeBuffer.ybase-R;k--;)this._activeBuffer.lines.splice(L,1),this._activeBuffer.lines.splice(R,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y,this._activeBuffer.scrollBottom),this._activeBuffer.x=0,!0}insertChars(C){this._restrictCursor();let k=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return k&&(k.insertCells(this._activeBuffer.x,C.params[0]||1,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}deleteChars(C){this._restrictCursor();let k=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return k&&(k.deleteCells(this._activeBuffer.x,C.params[0]||1,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}scrollUp(C){let k=C.params[0]||1;for(;k--;)this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollTop,1),this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollBottom,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollDown(C){let k=C.params[0]||1;for(;k--;)this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollBottom,1),this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollTop,0,this._activeBuffer.getBlankLine(s.DEFAULT_ATTR_DATA));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollLeft(C){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let k=C.params[0]||1;for(let L=this._activeBuffer.scrollTop;L<=this._activeBuffer.scrollBottom;++L){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+L);R.deleteCells(0,k,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollRight(C){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let k=C.params[0]||1;for(let L=this._activeBuffer.scrollTop;L<=this._activeBuffer.scrollBottom;++L){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+L);R.insertCells(0,k,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}insertColumns(C){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let k=C.params[0]||1;for(let L=this._activeBuffer.scrollTop;L<=this._activeBuffer.scrollBottom;++L){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+L);R.insertCells(this._activeBuffer.x,k,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}deleteColumns(C){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let k=C.params[0]||1;for(let L=this._activeBuffer.scrollTop;L<=this._activeBuffer.scrollBottom;++L){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+L);R.deleteCells(this._activeBuffer.x,k,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}eraseChars(C){this._restrictCursor();let k=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return k&&(k.replaceCells(this._activeBuffer.x,this._activeBuffer.x+(C.params[0]||1),this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}repeatPrecedingCharacter(C){if(!this._parser.precedingCodepoint)return!0;let k=C.params[0]||1,L=new Uint32Array(k);for(let R=0;R<k;++R)L[R]=this._parser.precedingCodepoint;return this.print(L,0,L.length),!0}sendDeviceAttributesPrimary(C){return C.params[0]>0||(this._is("xterm")||this._is("rxvt-unicode")||this._is("screen")?this._coreService.triggerDataEvent(c.C0.ESC+"[?1;2c"):this._is("linux")&&this._coreService.triggerDataEvent(c.C0.ESC+"[?6c")),!0}sendDeviceAttributesSecondary(C){return C.params[0]>0||(this._is("xterm")?this._coreService.triggerDataEvent(c.C0.ESC+"[>0;276;0c"):this._is("rxvt-unicode")?this._coreService.triggerDataEvent(c.C0.ESC+"[>85;95;0c"):this._is("linux")?this._coreService.triggerDataEvent(C.params[0]+"c"):this._is("screen")&&this._coreService.triggerDataEvent(c.C0.ESC+"[>83;40003;0c")),!0}_is(C){return(this._optionsService.rawOptions.termName+"").indexOf(C)===0}setMode(C){for(let k=0;k<C.length;k++)switch(C.params[k]){case 4:this._coreService.modes.insertMode=!0;break;case 20:this._optionsService.options.convertEol=!0}return!0}setModePrivate(C){for(let k=0;k<C.length;k++)switch(C.params[k]){case 1:this._coreService.decPrivateModes.applicationCursorKeys=!0;break;case 2:this._charsetService.setgCharset(0,p.DEFAULT_CHARSET),this._charsetService.setgCharset(1,p.DEFAULT_CHARSET),this._charsetService.setgCharset(2,p.DEFAULT_CHARSET),this._charsetService.setgCharset(3,p.DEFAULT_CHARSET);break;case 3:this._optionsService.rawOptions.windowOptions.setWinLines&&(this._bufferService.resize(132,this._bufferService.rows),this._onRequestReset.fire());break;case 6:this._coreService.decPrivateModes.origin=!0,this._setCursor(0,0);break;case 7:this._coreService.decPrivateModes.wraparound=!0;break;case 12:this._optionsService.options.cursorBlink=!0;break;case 45:this._coreService.decPrivateModes.reverseWraparound=!0;break;case 66:this._logService.debug("Serial port requested application keypad."),this._coreService.decPrivateModes.applicationKeypad=!0,this._onRequestSyncScrollBar.fire();break;case 9:this._coreMouseService.activeProtocol="X10";break;case 1e3:this._coreMouseService.activeProtocol="VT200";break;case 1002:this._coreMouseService.activeProtocol="DRAG";break;case 1003:this._coreMouseService.activeProtocol="ANY";break;case 1004:this._coreService.decPrivateModes.sendFocus=!0,this._onRequestSendFocus.fire();break;case 1005:this._logService.debug("DECSET 1005 not supported (see #2507)");break;case 1006:this._coreMouseService.activeEncoding="SGR";break;case 1015:this._logService.debug("DECSET 1015 not supported (see #2507)");break;case 1016:this._coreMouseService.activeEncoding="SGR_PIXELS";break;case 25:this._coreService.isCursorHidden=!1;break;case 1048:this.saveCursor();break;case 1049:this.saveCursor();case 47:case 1047:this._bufferService.buffers.activateAltBuffer(this._eraseAttrData()),this._coreService.isCursorInitialized=!0,this._onRequestRefreshRows.fire(0,this._bufferService.rows-1),this._onRequestSyncScrollBar.fire();break;case 2004:this._coreService.decPrivateModes.bracketedPasteMode=!0}return!0}resetMode(C){for(let k=0;k<C.length;k++)switch(C.params[k]){case 4:this._coreService.modes.insertMode=!1;break;case 20:this._optionsService.options.convertEol=!1}return!0}resetModePrivate(C){for(let k=0;k<C.length;k++)switch(C.params[k]){case 1:this._coreService.decPrivateModes.applicationCursorKeys=!1;break;case 3:this._optionsService.rawOptions.windowOptions.setWinLines&&(this._bufferService.resize(80,this._bufferService.rows),this._onRequestReset.fire());break;case 6:this._coreService.decPrivateModes.origin=!1,this._setCursor(0,0);break;case 7:this._coreService.decPrivateModes.wraparound=!1;break;case 12:this._optionsService.options.cursorBlink=!1;break;case 45:this._coreService.decPrivateModes.reverseWraparound=!1;break;case 66:this._logService.debug("Switching back to normal keypad."),this._coreService.decPrivateModes.applicationKeypad=!1,this._onRequestSyncScrollBar.fire();break;case 9:case 1e3:case 1002:case 1003:this._coreMouseService.activeProtocol="NONE";break;case 1004:this._coreService.decPrivateModes.sendFocus=!1;break;case 1005:this._logService.debug("DECRST 1005 not supported (see #2507)");break;case 1006:case 1016:this._coreMouseService.activeEncoding="DEFAULT";break;case 1015:this._logService.debug("DECRST 1015 not supported (see #2507)");break;case 25:this._coreService.isCursorHidden=!0;break;case 1048:this.restoreCursor();break;case 1049:case 47:case 1047:this._bufferService.buffers.activateNormalBuffer(),C.params[k]===1049&&this.restoreCursor(),this._coreService.isCursorInitialized=!0,this._onRequestRefreshRows.fire(0,this._bufferService.rows-1),this._onRequestSyncScrollBar.fire();break;case 2004:this._coreService.decPrivateModes.bracketedPasteMode=!1}return!0}requestMode(C,k){let L=this._coreService.decPrivateModes,{activeProtocol:R,activeEncoding:z}=this._coreMouseService,U=this._coreService,{buffers:K,cols:q}=this._bufferService,{active:te,alt:E}=K,$=this._optionsService.rawOptions,W=ie=>ie?1:2,N=C.params[0];return G=N,V=k?N===2?4:N===4?W(U.modes.insertMode):N===12?3:N===20?W($.convertEol):0:N===1?W(L.applicationCursorKeys):N===3?$.windowOptions.setWinLines?q===80?2:q===132?1:0:0:N===6?W(L.origin):N===7?W(L.wraparound):N===8?3:N===9?W(R==="X10"):N===12?W($.cursorBlink):N===25?W(!U.isCursorHidden):N===45?W(L.reverseWraparound):N===66?W(L.applicationKeypad):N===67?4:N===1e3?W(R==="VT200"):N===1002?W(R==="DRAG"):N===1003?W(R==="ANY"):N===1004?W(L.sendFocus):N===1005?4:N===1006?W(z==="SGR"):N===1015?4:N===1016?W(z==="SGR_PIXELS"):N===1048?1:N===47||N===1047||N===1049?W(te===E):N===2004?W(L.bracketedPasteMode):0,U.triggerDataEvent(`${c.C0.ESC}[${k?"":"?"}${G};${V}$y`),!0;var G,V}_updateAttrColor(C,k,L,R,z){return k===2?(C|=50331648,C&=-16777216,C|=_.AttributeData.fromColorRGB([L,R,z])):k===5&&(C&=-50331904,C|=33554432|255&L),C}_extractColor(C,k,L){let R=[0,0,-1,0,0,0],z=0,U=0;do{if(R[U+z]=C.params[k+U],C.hasSubParams(k+U)){let K=C.getSubParams(k+U),q=0;do R[1]===5&&(z=1),R[U+q+1+z]=K[q];while(++q<K.length&&q+U+1+z<R.length);break}if(R[1]===5&&U+z>=2||R[1]===2&&U+z>=5)break;R[1]&&(z=1)}while(++U+k<C.length&&U+z<R.length);for(let K=2;K<R.length;++K)R[K]===-1&&(R[K]=0);switch(R[0]){case 38:L.fg=this._updateAttrColor(L.fg,R[1],R[3],R[4],R[5]);break;case 48:L.bg=this._updateAttrColor(L.bg,R[1],R[3],R[4],R[5]);break;case 58:L.extended=L.extended.clone(),L.extended.underlineColor=this._updateAttrColor(L.extended.underlineColor,R[1],R[3],R[4],R[5])}return U}_processUnderline(C,k){k.extended=k.extended.clone(),(!~C||C>5)&&(C=1),k.extended.underlineStyle=C,k.fg|=268435456,C===0&&(k.fg&=-268435457),k.updateExtended()}_processSGR0(C){C.fg=s.DEFAULT_ATTR_DATA.fg,C.bg=s.DEFAULT_ATTR_DATA.bg,C.extended=C.extended.clone(),C.extended.underlineStyle=0,C.extended.underlineColor&=-67108864,C.updateExtended()}charAttributes(C){if(C.length===1&&C.params[0]===0)return this._processSGR0(this._curAttrData),!0;let k=C.length,L,R=this._curAttrData;for(let z=0;z<k;z++)L=C.params[z],L>=30&&L<=37?(R.fg&=-50331904,R.fg|=16777216|L-30):L>=40&&L<=47?(R.bg&=-50331904,R.bg|=16777216|L-40):L>=90&&L<=97?(R.fg&=-50331904,R.fg|=16777224|L-90):L>=100&&L<=107?(R.bg&=-50331904,R.bg|=16777224|L-100):L===0?this._processSGR0(R):L===1?R.fg|=134217728:L===3?R.bg|=67108864:L===4?(R.fg|=268435456,this._processUnderline(C.hasSubParams(z)?C.getSubParams(z)[0]:1,R)):L===5?R.fg|=536870912:L===7?R.fg|=67108864:L===8?R.fg|=1073741824:L===9?R.fg|=2147483648:L===2?R.bg|=134217728:L===21?this._processUnderline(2,R):L===22?(R.fg&=-134217729,R.bg&=-134217729):L===23?R.bg&=-67108865:L===24?(R.fg&=-268435457,this._processUnderline(0,R)):L===25?R.fg&=-536870913:L===27?R.fg&=-67108865:L===28?R.fg&=-1073741825:L===29?R.fg&=2147483647:L===39?(R.fg&=-67108864,R.fg|=16777215&s.DEFAULT_ATTR_DATA.fg):L===49?(R.bg&=-67108864,R.bg|=16777215&s.DEFAULT_ATTR_DATA.bg):L===38||L===48||L===58?z+=this._extractColor(C,z,R):L===53?R.bg|=1073741824:L===55?R.bg&=-1073741825:L===59?(R.extended=R.extended.clone(),R.extended.underlineColor=-1,R.updateExtended()):L===100?(R.fg&=-67108864,R.fg|=16777215&s.DEFAULT_ATTR_DATA.fg,R.bg&=-67108864,R.bg|=16777215&s.DEFAULT_ATTR_DATA.bg):this._logService.debug("Unknown SGR attribute: %d.",L);return!0}deviceStatus(C){switch(C.params[0]){case 5:this._coreService.triggerDataEvent(`${c.C0.ESC}[0n`);break;case 6:let k=this._activeBuffer.y+1,L=this._activeBuffer.x+1;this._coreService.triggerDataEvent(`${c.C0.ESC}[${k};${L}R`)}return!0}deviceStatusPrivate(C){if(C.params[0]===6){let k=this._activeBuffer.y+1,L=this._activeBuffer.x+1;this._coreService.triggerDataEvent(`${c.C0.ESC}[?${k};${L}R`)}return!0}softReset(C){return this._coreService.isCursorHidden=!1,this._onRequestSyncScrollBar.fire(),this._activeBuffer.scrollTop=0,this._activeBuffer.scrollBottom=this._bufferService.rows-1,this._curAttrData=s.DEFAULT_ATTR_DATA.clone(),this._coreService.reset(),this._charsetService.reset(),this._activeBuffer.savedX=0,this._activeBuffer.savedY=this._activeBuffer.ybase,this._activeBuffer.savedCurAttrData.fg=this._curAttrData.fg,this._activeBuffer.savedCurAttrData.bg=this._curAttrData.bg,this._activeBuffer.savedCharset=this._charsetService.charset,this._coreService.decPrivateModes.origin=!1,!0}setCursorStyle(C){let k=C.params[0]||1;switch(k){case 1:case 2:this._optionsService.options.cursorStyle="block";break;case 3:case 4:this._optionsService.options.cursorStyle="underline";break;case 5:case 6:this._optionsService.options.cursorStyle="bar"}let L=k%2==1;return this._optionsService.options.cursorBlink=L,!0}setScrollRegion(C){let k=C.params[0]||1,L;return(C.length<2||(L=C.params[1])>this._bufferService.rows||L===0)&&(L=this._bufferService.rows),L>k&&(this._activeBuffer.scrollTop=k-1,this._activeBuffer.scrollBottom=L-1,this._setCursor(0,0)),!0}windowOptions(C){if(!T(C.params[0],this._optionsService.rawOptions.windowOptions))return!0;let k=C.length>1?C.params[1]:0;switch(C.params[0]){case 14:k!==2&&this._onRequestWindowsOptionsReport.fire(D.GET_WIN_SIZE_PIXELS);break;case 16:this._onRequestWindowsOptionsReport.fire(D.GET_CELL_SIZE_PIXELS);break;case 18:this._bufferService&&this._coreService.triggerDataEvent(`${c.C0.ESC}[8;${this._bufferService.rows};${this._bufferService.cols}t`);break;case 22:k!==0&&k!==2||(this._windowTitleStack.push(this._windowTitle),this._windowTitleStack.length>10&&this._windowTitleStack.shift()),k!==0&&k!==1||(this._iconNameStack.push(this._iconName),this._iconNameStack.length>10&&this._iconNameStack.shift());break;case 23:k!==0&&k!==2||this._windowTitleStack.length&&this.setTitle(this._windowTitleStack.pop()),k!==0&&k!==1||this._iconNameStack.length&&this.setIconName(this._iconNameStack.pop())}return!0}saveCursor(C){return this._activeBuffer.savedX=this._activeBuffer.x,this._activeBuffer.savedY=this._activeBuffer.ybase+this._activeBuffer.y,this._activeBuffer.savedCurAttrData.fg=this._curAttrData.fg,this._activeBuffer.savedCurAttrData.bg=this._curAttrData.bg,this._activeBuffer.savedCharset=this._charsetService.charset,!0}restoreCursor(C){return this._activeBuffer.x=this._activeBuffer.savedX||0,this._activeBuffer.y=Math.max(this._activeBuffer.savedY-this._activeBuffer.ybase,0),this._curAttrData.fg=this._activeBuffer.savedCurAttrData.fg,this._curAttrData.bg=this._activeBuffer.savedCurAttrData.bg,this._charsetService.charset=this._savedCharset,this._activeBuffer.savedCharset&&(this._charsetService.charset=this._activeBuffer.savedCharset),this._restrictCursor(),!0}setTitle(C){return this._windowTitle=C,this._onTitleChange.fire(C),!0}setIconName(C){return this._iconName=C,!0}setOrReportIndexedColor(C){let k=[],L=C.split(";");for(;L.length>1;){let R=L.shift(),z=L.shift();if(/^\d+$/.exec(R)){let U=parseInt(R);if(M(U))if(z==="?")k.push({type:0,index:U});else{let K=(0,m.parseColor)(z);K&&k.push({type:1,index:U,color:K})}}}return k.length&&this._onColor.fire(k),!0}setHyperlink(C){let k=C.split(";");return!(k.length<2)&&(k[1]?this._createHyperlink(k[0],k[1]):!k[0]&&this._finishHyperlink())}_createHyperlink(C,k){this._getCurrentLinkId()&&this._finishHyperlink();let L=C.split(":"),R,z=L.findIndex((U=>U.startsWith("id=")));return z!==-1&&(R=L[z].slice(3)||void 0),this._curAttrData.extended=this._curAttrData.extended.clone(),this._curAttrData.extended.urlId=this._oscLinkService.registerLink({id:R,uri:k}),this._curAttrData.updateExtended(),!0}_finishHyperlink(){return this._curAttrData.extended=this._curAttrData.extended.clone(),this._curAttrData.extended.urlId=0,this._curAttrData.updateExtended(),!0}_setOrReportSpecialColor(C,k){let L=C.split(";");for(let R=0;R<L.length&&!(k>=this._specialColors.length);++R,++k)if(L[R]==="?")this._onColor.fire([{type:0,index:this._specialColors[k]}]);else{let z=(0,m.parseColor)(L[R]);z&&this._onColor.fire([{type:1,index:this._specialColors[k],color:z}])}return!0}setOrReportFgColor(C){return this._setOrReportSpecialColor(C,0)}setOrReportBgColor(C){return this._setOrReportSpecialColor(C,1)}setOrReportCursorColor(C){return this._setOrReportSpecialColor(C,2)}restoreIndexedColor(C){if(!C)return this._onColor.fire([{type:2}]),!0;let k=[],L=C.split(";");for(let R=0;R<L.length;++R)if(/^\d+$/.exec(L[R])){let z=parseInt(L[R]);M(z)&&k.push({type:2,index:z})}return k.length&&this._onColor.fire(k),!0}restoreFgColor(C){return this._onColor.fire([{type:2,index:256}]),!0}restoreBgColor(C){return this._onColor.fire([{type:2,index:257}]),!0}restoreCursorColor(C){return this._onColor.fire([{type:2,index:258}]),!0}nextLine(){return this._activeBuffer.x=0,this.index(),!0}keypadApplicationMode(){return this._logService.debug("Serial port requested application keypad."),this._coreService.decPrivateModes.applicationKeypad=!0,this._onRequestSyncScrollBar.fire(),!0}keypadNumericMode(){return this._logService.debug("Switching back to normal keypad."),this._coreService.decPrivateModes.applicationKeypad=!1,this._onRequestSyncScrollBar.fire(),!0}selectDefaultCharset(){return this._charsetService.setgLevel(0),this._charsetService.setgCharset(0,p.DEFAULT_CHARSET),!0}selectCharset(C){return C.length!==2?(this.selectDefaultCharset(),!0):(C[0]==="/"||this._charsetService.setgCharset(w[C[0]],p.CHARSETS[C[1]]||p.DEFAULT_CHARSET),!0)}index(){return this._restrictCursor(),this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData())):this._activeBuffer.y>=this._bufferService.rows&&(this._activeBuffer.y=this._bufferService.rows-1),this._restrictCursor(),!0}tabSet(){return this._activeBuffer.tabs[this._activeBuffer.x]=!0,!0}reverseIndex(){if(this._restrictCursor(),this._activeBuffer.y===this._activeBuffer.scrollTop){let C=this._activeBuffer.scrollBottom-this._activeBuffer.scrollTop;this._activeBuffer.lines.shiftElements(this._activeBuffer.ybase+this._activeBuffer.y,C,1),this._activeBuffer.lines.set(this._activeBuffer.ybase+this._activeBuffer.y,this._activeBuffer.getBlankLine(this._eraseAttrData())),this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom)}else this._activeBuffer.y--,this._restrictCursor();return!0}fullReset(){return this._parser.reset(),this._onRequestReset.fire(),!0}reset(){this._curAttrData=s.DEFAULT_ATTR_DATA.clone(),this._eraseAttrDataInternal=s.DEFAULT_ATTR_DATA.clone()}_eraseAttrData(){return this._eraseAttrDataInternal.bg&=-67108864,this._eraseAttrDataInternal.bg|=67108863&this._curAttrData.bg,this._eraseAttrDataInternal}setgLevel(C){return this._charsetService.setgLevel(C),!0}screenAlignmentPattern(){let C=new l.CellData;C.content=4194373,C.fg=this._curAttrData.fg,C.bg=this._curAttrData.bg,this._setCursor(0,0);for(let k=0;k<this._bufferService.rows;++k){let L=this._activeBuffer.ybase+this._activeBuffer.y+k,R=this._activeBuffer.lines.get(L);R&&(R.fill(C),R.isWrapped=!1)}return this._dirtyRowTracker.markAllDirty(),this._setCursor(0,0),!0}requestStatusString(C,k){let L=this._bufferService.buffer,R=this._optionsService.rawOptions;return(z=>(this._coreService.triggerDataEvent(`${c.C0.ESC}${z}${c.C0.ESC}\\`),!0))(C==='"q'?`P1$r${this._curAttrData.isProtected()?1:0}"q`:C==='"p'?'P1$r61;1"p':C==="r"?`P1$r${L.scrollTop+1};${L.scrollBottom+1}r`:C==="m"?"P1$r0m":C===" q"?`P1$r${{block:2,underline:4,bar:6}[R.cursorStyle]-(R.cursorBlink?1:0)} q`:"P0$r")}markRangeDirty(C,k){this._dirtyRowTracker.markRangeDirty(C,k)}}i.InputHandler=F;let P=class{constructor(I){this._bufferService=I,this.clearRange()}clearRange(){this.start=this._bufferService.buffer.y,this.end=this._bufferService.buffer.y}markDirty(I){I<this.start?this.start=I:I>this.end&&(this.end=I)}markRangeDirty(I,C){I>C&&(O=I,I=C,C=O),I<this.start&&(this.start=I),C>this.end&&(this.end=C)}markAllDirty(){this.markRangeDirty(0,this._bufferService.rows-1)}};function M(I){return 0<=I&&I<256}P=h([f(0,b.IBufferService)],P)},844:(u,i)=>{function o(h){for(let f of h)f.dispose();h.length=0}Object.defineProperty(i,"__esModule",{value:!0}),i.getDisposeArrayDisposable=i.disposeArray=i.toDisposable=i.MutableDisposable=i.Disposable=void 0,i.Disposable=class{constructor(){this._disposables=[],this._isDisposed=!1}dispose(){this._isDisposed=!0;for(let h of this._disposables)h.dispose();this._disposables.length=0}register(h){return this._disposables.push(h),h}unregister(h){let f=this._disposables.indexOf(h);f!==-1&&this._disposables.splice(f,1)}},i.MutableDisposable=class{constructor(){this._isDisposed=!1}get value(){return this._isDisposed?void 0:this._value}set value(h){var f;this._isDisposed||h===this._value||((f=this._value)===null||f===void 0||f.dispose(),this._value=h)}clear(){this.value=void 0}dispose(){var h;this._isDisposed=!0,(h=this._value)===null||h===void 0||h.dispose(),this._value=void 0}},i.toDisposable=function(h){return{dispose:h}},i.disposeArray=o,i.getDisposeArrayDisposable=function(h){return{dispose:()=>o(h)}}},1505:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.FourKeyMap=i.TwoKeyMap=void 0;class o{constructor(){this._data={}}set(f,c,p){this._data[f]||(this._data[f]={}),this._data[f][c]=p}get(f,c){return this._data[f]?this._data[f][c]:void 0}clear(){this._data={}}}i.TwoKeyMap=o,i.FourKeyMap=class{constructor(){this._data=new o}set(h,f,c,p,v){this._data.get(h,f)||this._data.set(h,f,new o),this._data.get(h,f).set(c,p,v)}get(h,f,c,p){var v;return(v=this._data.get(h,f))===null||v===void 0?void 0:v.get(c,p)}clear(){this._data.clear()}}},6114:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.isChromeOS=i.isLinux=i.isWindows=i.isIphone=i.isIpad=i.isMac=i.getSafariVersion=i.isSafari=i.isLegacyEdge=i.isFirefox=i.isNode=void 0,i.isNode=typeof navigator>"u";let o=i.isNode?"node":navigator.userAgent,h=i.isNode?"node":navigator.platform;i.isFirefox=o.includes("Firefox"),i.isLegacyEdge=o.includes("Edge"),i.isSafari=/^((?!chrome|android).)*safari/i.test(o),i.getSafariVersion=function(){if(!i.isSafari)return 0;let f=o.match(/Version\/(\d+)/);return f===null||f.length<2?0:parseInt(f[1])},i.isMac=["Macintosh","MacIntel","MacPPC","Mac68K"].includes(h),i.isIpad=h==="iPad",i.isIphone=h==="iPhone",i.isWindows=["Windows","Win16","Win32","WinCE"].includes(h),i.isLinux=h.indexOf("Linux")>=0,i.isChromeOS=/\bCrOS\b/.test(o)},6106:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.SortedList=void 0;let o=0;i.SortedList=class{constructor(h){this._getKey=h,this._array=[]}clear(){this._array.length=0}insert(h){this._array.length!==0?(o=this._search(this._getKey(h)),this._array.splice(o,0,h)):this._array.push(h)}delete(h){if(this._array.length===0)return!1;let f=this._getKey(h);if(f===void 0||(o=this._search(f),o===-1)||this._getKey(this._array[o])!==f)return!1;do if(this._array[o]===h)return this._array.splice(o,1),!0;while(++o<this._array.length&&this._getKey(this._array[o])===f);return!1}*getKeyIterator(h){if(this._array.length!==0&&(o=this._search(h),!(o<0||o>=this._array.length)&&this._getKey(this._array[o])===h))do yield this._array[o];while(++o<this._array.length&&this._getKey(this._array[o])===h)}forEachByKey(h,f){if(this._array.length!==0&&(o=this._search(h),!(o<0||o>=this._array.length)&&this._getKey(this._array[o])===h))do f(this._array[o]);while(++o<this._array.length&&this._getKey(this._array[o])===h)}values(){return[...this._array].values()}_search(h){let f=0,c=this._array.length-1;for(;c>=f;){let p=f+c>>1,v=this._getKey(this._array[p]);if(v>h)c=p-1;else{if(!(v<h)){for(;p>0&&this._getKey(this._array[p-1])===h;)p--;return p}f=p+1}}return f}}},7226:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DebouncedIdleTask=i.IdleTaskQueue=i.PriorityTaskQueue=void 0;let h=o(6114);class f{constructor(){this._tasks=[],this._i=0}enqueue(v){this._tasks.push(v),this._start()}flush(){for(;this._i<this._tasks.length;)this._tasks[this._i]()||this._i++;this.clear()}clear(){this._idleCallback&&(this._cancelCallback(this._idleCallback),this._idleCallback=void 0),this._i=0,this._tasks.length=0}_start(){this._idleCallback||(this._idleCallback=this._requestCallback(this._process.bind(this)))}_process(v){this._idleCallback=void 0;let S=0,g=0,s=v.timeRemaining(),a=0;for(;this._i<this._tasks.length;){if(S=Date.now(),this._tasks[this._i]()||this._i++,S=Math.max(1,Date.now()-S),g=Math.max(S,g),a=v.timeRemaining(),1.5*g>a)return s-S<-20&&console.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(s-S))}ms`),void this._start();s=a}this.clear()}}class c extends f{_requestCallback(v){return setTimeout((()=>v(this._createDeadline(16))))}_cancelCallback(v){clearTimeout(v)}_createDeadline(v){let S=Date.now()+v;return{timeRemaining:()=>Math.max(0,S-Date.now())}}}i.PriorityTaskQueue=c,i.IdleTaskQueue=!h.isNode&&"requestIdleCallback"in window?class extends f{_requestCallback(p){return requestIdleCallback(p)}_cancelCallback(p){cancelIdleCallback(p)}}:c,i.DebouncedIdleTask=class{constructor(){this._queue=new i.IdleTaskQueue}set(p){this._queue.clear(),this._queue.enqueue(p)}flush(){this._queue.flush()}}},9282:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.updateWindowsModeWrappedState=void 0;let h=o(643);i.updateWindowsModeWrappedState=function(f){let c=f.buffer.lines.get(f.buffer.ybase+f.buffer.y-1),p=c?.get(f.cols-1),v=f.buffer.lines.get(f.buffer.ybase+f.buffer.y);v&&p&&(v.isWrapped=p[h.CHAR_DATA_CODE_INDEX]!==h.NULL_CELL_CODE&&p[h.CHAR_DATA_CODE_INDEX]!==h.WHITESPACE_CELL_CODE)}},3734:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ExtendedAttrs=i.AttributeData=void 0;class o{constructor(){this.fg=0,this.bg=0,this.extended=new h}static toColorRGB(c){return[c>>>16&255,c>>>8&255,255&c]}static fromColorRGB(c){return(255&c[0])<<16|(255&c[1])<<8|255&c[2]}clone(){let c=new o;return c.fg=this.fg,c.bg=this.bg,c.extended=this.extended.clone(),c}isInverse(){return 67108864&this.fg}isBold(){return 134217728&this.fg}isUnderline(){return this.hasExtendedAttrs()&&this.extended.underlineStyle!==0?1:268435456&this.fg}isBlink(){return 536870912&this.fg}isInvisible(){return 1073741824&this.fg}isItalic(){return 67108864&this.bg}isDim(){return 134217728&this.bg}isStrikethrough(){return 2147483648&this.fg}isProtected(){return 536870912&this.bg}isOverline(){return 1073741824&this.bg}getFgColorMode(){return 50331648&this.fg}getBgColorMode(){return 50331648&this.bg}isFgRGB(){return(50331648&this.fg)==50331648}isBgRGB(){return(50331648&this.bg)==50331648}isFgPalette(){return(50331648&this.fg)==16777216||(50331648&this.fg)==33554432}isBgPalette(){return(50331648&this.bg)==16777216||(50331648&this.bg)==33554432}isFgDefault(){return(50331648&this.fg)==0}isBgDefault(){return(50331648&this.bg)==0}isAttributeDefault(){return this.fg===0&&this.bg===0}getFgColor(){switch(50331648&this.fg){case 16777216:case 33554432:return 255&this.fg;case 50331648:return 16777215&this.fg;default:return-1}}getBgColor(){switch(50331648&this.bg){case 16777216:case 33554432:return 255&this.bg;case 50331648:return 16777215&this.bg;default:return-1}}hasExtendedAttrs(){return 268435456&this.bg}updateExtended(){this.extended.isEmpty()?this.bg&=-268435457:this.bg|=268435456}getUnderlineColor(){if(268435456&this.bg&&~this.extended.underlineColor)switch(50331648&this.extended.underlineColor){case 16777216:case 33554432:return 255&this.extended.underlineColor;case 50331648:return 16777215&this.extended.underlineColor;default:return this.getFgColor()}return this.getFgColor()}getUnderlineColorMode(){return 268435456&this.bg&&~this.extended.underlineColor?50331648&this.extended.underlineColor:this.getFgColorMode()}isUnderlineColorRGB(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==50331648:this.isFgRGB()}isUnderlineColorPalette(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==16777216||(50331648&this.extended.underlineColor)==33554432:this.isFgPalette()}isUnderlineColorDefault(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==0:this.isFgDefault()}getUnderlineStyle(){return 268435456&this.fg?268435456&this.bg?this.extended.underlineStyle:1:0}}i.AttributeData=o;class h{get ext(){return this._urlId?-469762049&this._ext|this.underlineStyle<<26:this._ext}set ext(c){this._ext=c}get underlineStyle(){return this._urlId?5:(469762048&this._ext)>>26}set underlineStyle(c){this._ext&=-469762049,this._ext|=c<<26&469762048}get underlineColor(){return 67108863&this._ext}set underlineColor(c){this._ext&=-67108864,this._ext|=67108863&c}get urlId(){return this._urlId}set urlId(c){this._urlId=c}constructor(c=0,p=0){this._ext=0,this._urlId=0,this._ext=c,this._urlId=p}clone(){return new h(this._ext,this._urlId)}isEmpty(){return this.underlineStyle===0&&this._urlId===0}}i.ExtendedAttrs=h},9092:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Buffer=i.MAX_BUFFER_SIZE=void 0;let h=o(6349),f=o(7226),c=o(3734),p=o(8437),v=o(4634),S=o(511),g=o(643),s=o(4863),a=o(7116);i.MAX_BUFFER_SIZE=4294967295,i.Buffer=class{constructor(n,l,_){this._hasScrollback=n,this._optionsService=l,this._bufferService=_,this.ydisp=0,this.ybase=0,this.y=0,this.x=0,this.tabs={},this.savedY=0,this.savedX=0,this.savedCurAttrData=p.DEFAULT_ATTR_DATA.clone(),this.savedCharset=a.DEFAULT_CHARSET,this.markers=[],this._nullCell=S.CellData.fromCharData([0,g.NULL_CELL_CHAR,g.NULL_CELL_WIDTH,g.NULL_CELL_CODE]),this._whitespaceCell=S.CellData.fromCharData([0,g.WHITESPACE_CELL_CHAR,g.WHITESPACE_CELL_WIDTH,g.WHITESPACE_CELL_CODE]),this._isClearing=!1,this._memoryCleanupQueue=new f.IdleTaskQueue,this._memoryCleanupPosition=0,this._cols=this._bufferService.cols,this._rows=this._bufferService.rows,this.lines=new h.CircularList(this._getCorrectBufferLength(this._rows)),this.scrollTop=0,this.scrollBottom=this._rows-1,this.setupTabStops()}getNullCell(n){return n?(this._nullCell.fg=n.fg,this._nullCell.bg=n.bg,this._nullCell.extended=n.extended):(this._nullCell.fg=0,this._nullCell.bg=0,this._nullCell.extended=new c.ExtendedAttrs),this._nullCell}getWhitespaceCell(n){return n?(this._whitespaceCell.fg=n.fg,this._whitespaceCell.bg=n.bg,this._whitespaceCell.extended=n.extended):(this._whitespaceCell.fg=0,this._whitespaceCell.bg=0,this._whitespaceCell.extended=new c.ExtendedAttrs),this._whitespaceCell}getBlankLine(n,l){return new p.BufferLine(this._bufferService.cols,this.getNullCell(n),l)}get hasScrollback(){return this._hasScrollback&&this.lines.maxLength>this._rows}get isCursorInViewport(){let n=this.ybase+this.y-this.ydisp;return n>=0&&n<this._rows}_getCorrectBufferLength(n){if(!this._hasScrollback)return n;let l=n+this._optionsService.rawOptions.scrollback;return l>i.MAX_BUFFER_SIZE?i.MAX_BUFFER_SIZE:l}fillViewportRows(n){if(this.lines.length===0){n===void 0&&(n=p.DEFAULT_ATTR_DATA);let l=this._rows;for(;l--;)this.lines.push(this.getBlankLine(n))}}clear(){this.ydisp=0,this.ybase=0,this.y=0,this.x=0,this.lines=new h.CircularList(this._getCorrectBufferLength(this._rows)),this.scrollTop=0,this.scrollBottom=this._rows-1,this.setupTabStops()}resize(n,l){let _=this.getNullCell(p.DEFAULT_ATTR_DATA),b=0,y=this._getCorrectBufferLength(l);if(y>this.lines.maxLength&&(this.lines.maxLength=y),this.lines.length>0){if(this._cols<n)for(let m=0;m<this.lines.length;m++)b+=+this.lines.get(m).resize(n,_);let x=0;if(this._rows<l)for(let m=this._rows;m<l;m++)this.lines.length<l+this.ybase&&(this._optionsService.rawOptions.windowsMode||this._optionsService.rawOptions.windowsPty.backend!==void 0||this._optionsService.rawOptions.windowsPty.buildNumber!==void 0?this.lines.push(new p.BufferLine(n,_)):this.ybase>0&&this.lines.length<=this.ybase+this.y+x+1?(this.ybase--,x++,this.ydisp>0&&this.ydisp--):this.lines.push(new p.BufferLine(n,_)));else for(let m=this._rows;m>l;m--)this.lines.length>l+this.ybase&&(this.lines.length>this.ybase+this.y+1?this.lines.pop():(this.ybase++,this.ydisp++));if(y<this.lines.maxLength){let m=this.lines.length-y;m>0&&(this.lines.trimStart(m),this.ybase=Math.max(this.ybase-m,0),this.ydisp=Math.max(this.ydisp-m,0),this.savedY=Math.max(this.savedY-m,0)),this.lines.maxLength=y}this.x=Math.min(this.x,n-1),this.y=Math.min(this.y,l-1),x&&(this.y+=x),this.savedX=Math.min(this.savedX,n-1),this.scrollTop=0}if(this.scrollBottom=l-1,this._isReflowEnabled&&(this._reflow(n,l),this._cols>n))for(let x=0;x<this.lines.length;x++)b+=+this.lines.get(x).resize(n,_);this._cols=n,this._rows=l,this._memoryCleanupQueue.clear(),b>.1*this.lines.length&&(this._memoryCleanupPosition=0,this._memoryCleanupQueue.enqueue((()=>this._batchedMemoryCleanup())))}_batchedMemoryCleanup(){let n=!0;this._memoryCleanupPosition>=this.lines.length&&(this._memoryCleanupPosition=0,n=!1);let l=0;for(;this._memoryCleanupPosition<this.lines.length;)if(l+=this.lines.get(this._memoryCleanupPosition++).cleanupMemory(),l>100)return!0;return n}get _isReflowEnabled(){let n=this._optionsService.rawOptions.windowsPty;return n&&n.buildNumber?this._hasScrollback&&n.backend==="conpty"&&n.buildNumber>=21376:this._hasScrollback&&!this._optionsService.rawOptions.windowsMode}_reflow(n,l){this._cols!==n&&(n>this._cols?this._reflowLarger(n,l):this._reflowSmaller(n,l))}_reflowLarger(n,l){let _=(0,v.reflowLargerGetLinesToRemove)(this.lines,this._cols,n,this.ybase+this.y,this.getNullCell(p.DEFAULT_ATTR_DATA));if(_.length>0){let b=(0,v.reflowLargerCreateNewLayout)(this.lines,_);(0,v.reflowLargerApplyNewLayout)(this.lines,b.layout),this._reflowLargerAdjustViewport(n,l,b.countRemoved)}}_reflowLargerAdjustViewport(n,l,_){let b=this.getNullCell(p.DEFAULT_ATTR_DATA),y=_;for(;y-- >0;)this.ybase===0?(this.y>0&&this.y--,this.lines.length<l&&this.lines.push(new p.BufferLine(n,b))):(this.ydisp===this.ybase&&this.ydisp--,this.ybase--);this.savedY=Math.max(this.savedY-_,0)}_reflowSmaller(n,l){let _=this.getNullCell(p.DEFAULT_ATTR_DATA),b=[],y=0;for(let x=this.lines.length-1;x>=0;x--){let m=this.lines.get(x);if(!m||!m.isWrapped&&m.getTrimmedLength()<=n)continue;let w=[m];for(;m.isWrapped&&x>0;)m=this.lines.get(--x),w.unshift(m);let A=this.ybase+this.y;if(A>=x&&A<x+w.length)continue;let T=w[w.length-1].getTrimmedLength(),D=(0,v.reflowSmallerGetNewLineLengths)(w,this._cols,n),O=D.length-w.length,F;F=this.ybase===0&&this.y!==this.lines.length-1?Math.max(0,this.y-this.lines.maxLength+O):Math.max(0,this.lines.length-this.lines.maxLength+O);let P=[];for(let R=0;R<O;R++){let z=this.getBlankLine(p.DEFAULT_ATTR_DATA,!0);P.push(z)}P.length>0&&(b.push({start:x+w.length+y,newLines:P}),y+=P.length),w.push(...P);let M=D.length-1,I=D[M];I===0&&(M--,I=D[M]);let C=w.length-O-1,k=T;for(;C>=0;){let R=Math.min(k,I);if(w[M]===void 0)break;if(w[M].copyCellsFrom(w[C],k-R,I-R,R,!0),I-=R,I===0&&(M--,I=D[M]),k-=R,k===0){C--;let z=Math.max(C,0);k=(0,v.getWrappedLineTrimmedLength)(w,z,this._cols)}}for(let R=0;R<w.length;R++)D[R]<n&&w[R].setCell(D[R],_);let L=O-F;for(;L-- >0;)this.ybase===0?this.y<l-1?(this.y++,this.lines.pop()):(this.ybase++,this.ydisp++):this.ybase<Math.min(this.lines.maxLength,this.lines.length+y)-l&&(this.ybase===this.ydisp&&this.ydisp++,this.ybase++);this.savedY=Math.min(this.savedY+O,this.ybase+l-1)}if(b.length>0){let x=[],m=[];for(let M=0;M<this.lines.length;M++)m.push(this.lines.get(M));let w=this.lines.length,A=w-1,T=0,D=b[T];this.lines.length=Math.min(this.lines.maxLength,this.lines.length+y);let O=0;for(let M=Math.min(this.lines.maxLength-1,w+y-1);M>=0;M--)if(D&&D.start>A+O){for(let I=D.newLines.length-1;I>=0;I--)this.lines.set(M--,D.newLines[I]);M++,x.push({index:A+1,amount:D.newLines.length}),O+=D.newLines.length,D=b[++T]}else this.lines.set(M,m[A--]);let F=0;for(let M=x.length-1;M>=0;M--)x[M].index+=F,this.lines.onInsertEmitter.fire(x[M]),F+=x[M].amount;let P=Math.max(0,w+y-this.lines.maxLength);P>0&&this.lines.onTrimEmitter.fire(P)}}translateBufferLineToString(n,l,_=0,b){let y=this.lines.get(n);return y?y.translateToString(l,_,b):""}getWrappedRangeForLine(n){let l=n,_=n;for(;l>0&&this.lines.get(l).isWrapped;)l--;for(;_+1<this.lines.length&&this.lines.get(_+1).isWrapped;)_++;return{first:l,last:_}}setupTabStops(n){for(n!=null?this.tabs[n]||(n=this.prevStop(n)):(this.tabs={},n=0);n<this._cols;n+=this._optionsService.rawOptions.tabStopWidth)this.tabs[n]=!0}prevStop(n){for(n==null&&(n=this.x);!this.tabs[--n]&&n>0;);return n>=this._cols?this._cols-1:n<0?0:n}nextStop(n){for(n==null&&(n=this.x);!this.tabs[++n]&&n<this._cols;);return n>=this._cols?this._cols-1:n<0?0:n}clearMarkers(n){this._isClearing=!0;for(let l=0;l<this.markers.length;l++)this.markers[l].line===n&&(this.markers[l].dispose(),this.markers.splice(l--,1));this._isClearing=!1}clearAllMarkers(){this._isClearing=!0;for(let n=0;n<this.markers.length;n++)this.markers[n].dispose(),this.markers.splice(n--,1);this._isClearing=!1}addMarker(n){let l=new s.Marker(n);return this.markers.push(l),l.register(this.lines.onTrim((_=>{l.line-=_,l.line<0&&l.dispose()}))),l.register(this.lines.onInsert((_=>{l.line>=_.index&&(l.line+=_.amount)}))),l.register(this.lines.onDelete((_=>{l.line>=_.index&&l.line<_.index+_.amount&&l.dispose(),l.line>_.index&&(l.line-=_.amount)}))),l.register(l.onDispose((()=>this._removeMarker(l)))),l}_removeMarker(n){this._isClearing||this.markers.splice(this.markers.indexOf(n),1)}}},8437:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferLine=i.DEFAULT_ATTR_DATA=void 0;let h=o(3734),f=o(511),c=o(643),p=o(482);i.DEFAULT_ATTR_DATA=Object.freeze(new h.AttributeData);let v=0;class S{constructor(s,a,n=!1){this.isWrapped=n,this._combined={},this._extendedAttrs={},this._data=new Uint32Array(3*s);let l=a||f.CellData.fromCharData([0,c.NULL_CELL_CHAR,c.NULL_CELL_WIDTH,c.NULL_CELL_CODE]);for(let _=0;_<s;++_)this.setCell(_,l);this.length=s}get(s){let a=this._data[3*s+0],n=2097151&a;return[this._data[3*s+1],2097152&a?this._combined[s]:n?(0,p.stringFromCodePoint)(n):"",a>>22,2097152&a?this._combined[s].charCodeAt(this._combined[s].length-1):n]}set(s,a){this._data[3*s+1]=a[c.CHAR_DATA_ATTR_INDEX],a[c.CHAR_DATA_CHAR_INDEX].length>1?(this._combined[s]=a[1],this._data[3*s+0]=2097152|s|a[c.CHAR_DATA_WIDTH_INDEX]<<22):this._data[3*s+0]=a[c.CHAR_DATA_CHAR_INDEX].charCodeAt(0)|a[c.CHAR_DATA_WIDTH_INDEX]<<22}getWidth(s){return this._data[3*s+0]>>22}hasWidth(s){return 12582912&this._data[3*s+0]}getFg(s){return this._data[3*s+1]}getBg(s){return this._data[3*s+2]}hasContent(s){return 4194303&this._data[3*s+0]}getCodePoint(s){let a=this._data[3*s+0];return 2097152&a?this._combined[s].charCodeAt(this._combined[s].length-1):2097151&a}isCombined(s){return 2097152&this._data[3*s+0]}getString(s){let a=this._data[3*s+0];return 2097152&a?this._combined[s]:2097151&a?(0,p.stringFromCodePoint)(2097151&a):""}isProtected(s){return 536870912&this._data[3*s+2]}loadCell(s,a){return v=3*s,a.content=this._data[v+0],a.fg=this._data[v+1],a.bg=this._data[v+2],2097152&a.content&&(a.combinedData=this._combined[s]),268435456&a.bg&&(a.extended=this._extendedAttrs[s]),a}setCell(s,a){2097152&a.content&&(this._combined[s]=a.combinedData),268435456&a.bg&&(this._extendedAttrs[s]=a.extended),this._data[3*s+0]=a.content,this._data[3*s+1]=a.fg,this._data[3*s+2]=a.bg}setCellFromCodePoint(s,a,n,l,_,b){268435456&_&&(this._extendedAttrs[s]=b),this._data[3*s+0]=a|n<<22,this._data[3*s+1]=l,this._data[3*s+2]=_}addCodepointToCell(s,a){let n=this._data[3*s+0];2097152&n?this._combined[s]+=(0,p.stringFromCodePoint)(a):(2097151&n?(this._combined[s]=(0,p.stringFromCodePoint)(2097151&n)+(0,p.stringFromCodePoint)(a),n&=-2097152,n|=2097152):n=a|4194304,this._data[3*s+0]=n)}insertCells(s,a,n,l){if((s%=this.length)&&this.getWidth(s-1)===2&&this.setCellFromCodePoint(s-1,0,1,l?.fg||0,l?.bg||0,l?.extended||new h.ExtendedAttrs),a<this.length-s){let _=new f.CellData;for(let b=this.length-s-a-1;b>=0;--b)this.setCell(s+a+b,this.loadCell(s+b,_));for(let b=0;b<a;++b)this.setCell(s+b,n)}else for(let _=s;_<this.length;++_)this.setCell(_,n);this.getWidth(this.length-1)===2&&this.setCellFromCodePoint(this.length-1,0,1,l?.fg||0,l?.bg||0,l?.extended||new h.ExtendedAttrs)}deleteCells(s,a,n,l){if(s%=this.length,a<this.length-s){let _=new f.CellData;for(let b=0;b<this.length-s-a;++b)this.setCell(s+b,this.loadCell(s+a+b,_));for(let b=this.length-a;b<this.length;++b)this.setCell(b,n)}else for(let _=s;_<this.length;++_)this.setCell(_,n);s&&this.getWidth(s-1)===2&&this.setCellFromCodePoint(s-1,0,1,l?.fg||0,l?.bg||0,l?.extended||new h.ExtendedAttrs),this.getWidth(s)!==0||this.hasContent(s)||this.setCellFromCodePoint(s,0,1,l?.fg||0,l?.bg||0,l?.extended||new h.ExtendedAttrs)}replaceCells(s,a,n,l,_=!1){if(_)for(s&&this.getWidth(s-1)===2&&!this.isProtected(s-1)&&this.setCellFromCodePoint(s-1,0,1,l?.fg||0,l?.bg||0,l?.extended||new h.ExtendedAttrs),a<this.length&&this.getWidth(a-1)===2&&!this.isProtected(a)&&this.setCellFromCodePoint(a,0,1,l?.fg||0,l?.bg||0,l?.extended||new h.ExtendedAttrs);s<a&&s<this.length;)this.isProtected(s)||this.setCell(s,n),s++;else for(s&&this.getWidth(s-1)===2&&this.setCellFromCodePoint(s-1,0,1,l?.fg||0,l?.bg||0,l?.extended||new h.ExtendedAttrs),a<this.length&&this.getWidth(a-1)===2&&this.setCellFromCodePoint(a,0,1,l?.fg||0,l?.bg||0,l?.extended||new h.ExtendedAttrs);s<a&&s<this.length;)this.setCell(s++,n)}resize(s,a){if(s===this.length)return 4*this._data.length*2<this._data.buffer.byteLength;let n=3*s;if(s>this.length){if(this._data.buffer.byteLength>=4*n)this._data=new Uint32Array(this._data.buffer,0,n);else{let l=new Uint32Array(n);l.set(this._data),this._data=l}for(let l=this.length;l<s;++l)this.setCell(l,a)}else{this._data=this._data.subarray(0,n);let l=Object.keys(this._combined);for(let b=0;b<l.length;b++){let y=parseInt(l[b],10);y>=s&&delete this._combined[y]}let _=Object.keys(this._extendedAttrs);for(let b=0;b<_.length;b++){let y=parseInt(_[b],10);y>=s&&delete this._extendedAttrs[y]}}return this.length=s,4*n*2<this._data.buffer.byteLength}cleanupMemory(){if(4*this._data.length*2<this._data.buffer.byteLength){let s=new Uint32Array(this._data.length);return s.set(this._data),this._data=s,1}return 0}fill(s,a=!1){if(a)for(let n=0;n<this.length;++n)this.isProtected(n)||this.setCell(n,s);else{this._combined={},this._extendedAttrs={};for(let n=0;n<this.length;++n)this.setCell(n,s)}}copyFrom(s){this.length!==s.length?this._data=new Uint32Array(s._data):this._data.set(s._data),this.length=s.length,this._combined={};for(let a in s._combined)this._combined[a]=s._combined[a];this._extendedAttrs={};for(let a in s._extendedAttrs)this._extendedAttrs[a]=s._extendedAttrs[a];this.isWrapped=s.isWrapped}clone(){let s=new S(0);s._data=new Uint32Array(this._data),s.length=this.length;for(let a in this._combined)s._combined[a]=this._combined[a];for(let a in this._extendedAttrs)s._extendedAttrs[a]=this._extendedAttrs[a];return s.isWrapped=this.isWrapped,s}getTrimmedLength(){for(let s=this.length-1;s>=0;--s)if(4194303&this._data[3*s+0])return s+(this._data[3*s+0]>>22);return 0}getNoBgTrimmedLength(){for(let s=this.length-1;s>=0;--s)if(4194303&this._data[3*s+0]||50331648&this._data[3*s+2])return s+(this._data[3*s+0]>>22);return 0}copyCellsFrom(s,a,n,l,_){let b=s._data;if(_)for(let x=l-1;x>=0;x--){for(let m=0;m<3;m++)this._data[3*(n+x)+m]=b[3*(a+x)+m];268435456&b[3*(a+x)+2]&&(this._extendedAttrs[n+x]=s._extendedAttrs[a+x])}else for(let x=0;x<l;x++){for(let m=0;m<3;m++)this._data[3*(n+x)+m]=b[3*(a+x)+m];268435456&b[3*(a+x)+2]&&(this._extendedAttrs[n+x]=s._extendedAttrs[a+x])}let y=Object.keys(s._combined);for(let x=0;x<y.length;x++){let m=parseInt(y[x],10);m>=a&&(this._combined[m-a+n]=s._combined[m])}}translateToString(s=!1,a=0,n=this.length){s&&(n=Math.min(n,this.getTrimmedLength()));let l="";for(;a<n;){let _=this._data[3*a+0],b=2097151&_;l+=2097152&_?this._combined[a]:b?(0,p.stringFromCodePoint)(b):c.WHITESPACE_CELL_CHAR,a+=_>>22||1}return l}}i.BufferLine=S},4841:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.getRangeLength=void 0,i.getRangeLength=function(o,h){if(o.start.y>o.end.y)throw new Error(`Buffer range end (${o.end.x}, ${o.end.y}) cannot be before start (${o.start.x}, ${o.start.y})`);return h*(o.end.y-o.start.y)+(o.end.x-o.start.x+1)}},4634:(u,i)=>{function o(h,f,c){if(f===h.length-1)return h[f].getTrimmedLength();let p=!h[f].hasContent(c-1)&&h[f].getWidth(c-1)===1,v=h[f+1].getWidth(0)===2;return p&&v?c-1:c}Object.defineProperty(i,"__esModule",{value:!0}),i.getWrappedLineTrimmedLength=i.reflowSmallerGetNewLineLengths=i.reflowLargerApplyNewLayout=i.reflowLargerCreateNewLayout=i.reflowLargerGetLinesToRemove=void 0,i.reflowLargerGetLinesToRemove=function(h,f,c,p,v){let S=[];for(let g=0;g<h.length-1;g++){let s=g,a=h.get(++s);if(!a.isWrapped)continue;let n=[h.get(g)];for(;s<h.length&&a.isWrapped;)n.push(a),a=h.get(++s);if(p>=g&&p<s){g+=n.length-1;continue}let l=0,_=o(n,l,f),b=1,y=0;for(;b<n.length;){let m=o(n,b,f),w=m-y,A=c-_,T=Math.min(w,A);n[l].copyCellsFrom(n[b],y,_,T,!1),_+=T,_===c&&(l++,_=0),y+=T,y===m&&(b++,y=0),_===0&&l!==0&&n[l-1].getWidth(c-1)===2&&(n[l].copyCellsFrom(n[l-1],c-1,_++,1,!1),n[l-1].setCell(c-1,v))}n[l].replaceCells(_,c,v);let x=0;for(let m=n.length-1;m>0&&(m>l||n[m].getTrimmedLength()===0);m--)x++;x>0&&(S.push(g+n.length-x),S.push(x)),g+=n.length-1}return S},i.reflowLargerCreateNewLayout=function(h,f){let c=[],p=0,v=f[p],S=0;for(let g=0;g<h.length;g++)if(v===g){let s=f[++p];h.onDeleteEmitter.fire({index:g-S,amount:s}),g+=s-1,S+=s,v=f[++p]}else c.push(g);return{layout:c,countRemoved:S}},i.reflowLargerApplyNewLayout=function(h,f){let c=[];for(let p=0;p<f.length;p++)c.push(h.get(f[p]));for(let p=0;p<c.length;p++)h.set(p,c[p]);h.length=f.length},i.reflowSmallerGetNewLineLengths=function(h,f,c){let p=[],v=h.map(((a,n)=>o(h,n,f))).reduce(((a,n)=>a+n)),S=0,g=0,s=0;for(;s<v;){if(v-s<c){p.push(v-s);break}S+=c;let a=o(h,g,f);S>a&&(S-=a,g++);let n=h[g].getWidth(S-1)===2;n&&S--;let l=n?c-1:c;p.push(l),s+=l}return p},i.getWrappedLineTrimmedLength=o},5295:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferSet=void 0;let h=o(8460),f=o(844),c=o(9092);class p extends f.Disposable{constructor(S,g){super(),this._optionsService=S,this._bufferService=g,this._onBufferActivate=this.register(new h.EventEmitter),this.onBufferActivate=this._onBufferActivate.event,this.reset(),this.register(this._optionsService.onSpecificOptionChange("scrollback",(()=>this.resize(this._bufferService.cols,this._bufferService.rows)))),this.register(this._optionsService.onSpecificOptionChange("tabStopWidth",(()=>this.setupTabStops())))}reset(){this._normal=new c.Buffer(!0,this._optionsService,this._bufferService),this._normal.fillViewportRows(),this._alt=new c.Buffer(!1,this._optionsService,this._bufferService),this._activeBuffer=this._normal,this._onBufferActivate.fire({activeBuffer:this._normal,inactiveBuffer:this._alt}),this.setupTabStops()}get alt(){return this._alt}get active(){return this._activeBuffer}get normal(){return this._normal}activateNormalBuffer(){this._activeBuffer!==this._normal&&(this._normal.x=this._alt.x,this._normal.y=this._alt.y,this._alt.clearAllMarkers(),this._alt.clear(),this._activeBuffer=this._normal,this._onBufferActivate.fire({activeBuffer:this._normal,inactiveBuffer:this._alt}))}activateAltBuffer(S){this._activeBuffer!==this._alt&&(this._alt.fillViewportRows(S),this._alt.x=this._normal.x,this._alt.y=this._normal.y,this._activeBuffer=this._alt,this._onBufferActivate.fire({activeBuffer:this._alt,inactiveBuffer:this._normal}))}resize(S,g){this._normal.resize(S,g),this._alt.resize(S,g),this.setupTabStops(S)}setupTabStops(S){this._normal.setupTabStops(S),this._alt.setupTabStops(S)}}i.BufferSet=p},511:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CellData=void 0;let h=o(482),f=o(643),c=o(3734);class p extends c.AttributeData{constructor(){super(...arguments),this.content=0,this.fg=0,this.bg=0,this.extended=new c.ExtendedAttrs,this.combinedData=""}static fromCharData(S){let g=new p;return g.setFromCharData(S),g}isCombined(){return 2097152&this.content}getWidth(){return this.content>>22}getChars(){return 2097152&this.content?this.combinedData:2097151&this.content?(0,h.stringFromCodePoint)(2097151&this.content):""}getCode(){return this.isCombined()?this.combinedData.charCodeAt(this.combinedData.length-1):2097151&this.content}setFromCharData(S){this.fg=S[f.CHAR_DATA_ATTR_INDEX],this.bg=0;let g=!1;if(S[f.CHAR_DATA_CHAR_INDEX].length>2)g=!0;else if(S[f.CHAR_DATA_CHAR_INDEX].length===2){let s=S[f.CHAR_DATA_CHAR_INDEX].charCodeAt(0);if(55296<=s&&s<=56319){let a=S[f.CHAR_DATA_CHAR_INDEX].charCodeAt(1);56320<=a&&a<=57343?this.content=1024*(s-55296)+a-56320+65536|S[f.CHAR_DATA_WIDTH_INDEX]<<22:g=!0}else g=!0}else this.content=S[f.CHAR_DATA_CHAR_INDEX].charCodeAt(0)|S[f.CHAR_DATA_WIDTH_INDEX]<<22;g&&(this.combinedData=S[f.CHAR_DATA_CHAR_INDEX],this.content=2097152|S[f.CHAR_DATA_WIDTH_INDEX]<<22)}getAsCharData(){return[this.fg,this.getChars(),this.getWidth(),this.getCode()]}}i.CellData=p},643:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.WHITESPACE_CELL_CODE=i.WHITESPACE_CELL_WIDTH=i.WHITESPACE_CELL_CHAR=i.NULL_CELL_CODE=i.NULL_CELL_WIDTH=i.NULL_CELL_CHAR=i.CHAR_DATA_CODE_INDEX=i.CHAR_DATA_WIDTH_INDEX=i.CHAR_DATA_CHAR_INDEX=i.CHAR_DATA_ATTR_INDEX=i.DEFAULT_EXT=i.DEFAULT_ATTR=i.DEFAULT_COLOR=void 0,i.DEFAULT_COLOR=0,i.DEFAULT_ATTR=256|i.DEFAULT_COLOR<<9,i.DEFAULT_EXT=0,i.CHAR_DATA_ATTR_INDEX=0,i.CHAR_DATA_CHAR_INDEX=1,i.CHAR_DATA_WIDTH_INDEX=2,i.CHAR_DATA_CODE_INDEX=3,i.NULL_CELL_CHAR="",i.NULL_CELL_WIDTH=1,i.NULL_CELL_CODE=0,i.WHITESPACE_CELL_CHAR=" ",i.WHITESPACE_CELL_WIDTH=1,i.WHITESPACE_CELL_CODE=32},4863:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Marker=void 0;let h=o(8460),f=o(844);class c{get id(){return this._id}constructor(v){this.line=v,this.isDisposed=!1,this._disposables=[],this._id=c._nextId++,this._onDispose=this.register(new h.EventEmitter),this.onDispose=this._onDispose.event}dispose(){this.isDisposed||(this.isDisposed=!0,this.line=-1,this._onDispose.fire(),(0,f.disposeArray)(this._disposables),this._disposables.length=0)}register(v){return this._disposables.push(v),v}}i.Marker=c,c._nextId=1},7116:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DEFAULT_CHARSET=i.CHARSETS=void 0,i.CHARSETS={},i.DEFAULT_CHARSET=i.CHARSETS.B,i.CHARSETS[0]={"`":"\u25C6",a:"\u2592",b:"\u2409",c:"\u240C",d:"\u240D",e:"\u240A",f:"\xB0",g:"\xB1",h:"\u2424",i:"\u240B",j:"\u2518",k:"\u2510",l:"\u250C",m:"\u2514",n:"\u253C",o:"\u23BA",p:"\u23BB",q:"\u2500",r:"\u23BC",s:"\u23BD",t:"\u251C",u:"\u2524",v:"\u2534",w:"\u252C",x:"\u2502",y:"\u2264",z:"\u2265","{":"\u03C0","|":"\u2260","}":"\xA3","~":"\xB7"},i.CHARSETS.A={"#":"\xA3"},i.CHARSETS.B=void 0,i.CHARSETS[4]={"#":"\xA3","@":"\xBE","[":"ij","\\":"\xBD","]":"|","{":"\xA8","|":"f","}":"\xBC","~":"\xB4"},i.CHARSETS.C=i.CHARSETS[5]={"[":"\xC4","\\":"\xD6","]":"\xC5","^":"\xDC","`":"\xE9","{":"\xE4","|":"\xF6","}":"\xE5","~":"\xFC"},i.CHARSETS.R={"#":"\xA3","@":"\xE0","[":"\xB0","\\":"\xE7","]":"\xA7","{":"\xE9","|":"\xF9","}":"\xE8","~":"\xA8"},i.CHARSETS.Q={"@":"\xE0","[":"\xE2","\\":"\xE7","]":"\xEA","^":"\xEE","`":"\xF4","{":"\xE9","|":"\xF9","}":"\xE8","~":"\xFB"},i.CHARSETS.K={"@":"\xA7","[":"\xC4","\\":"\xD6","]":"\xDC","{":"\xE4","|":"\xF6","}":"\xFC","~":"\xDF"},i.CHARSETS.Y={"#":"\xA3","@":"\xA7","[":"\xB0","\\":"\xE7","]":"\xE9","`":"\xF9","{":"\xE0","|":"\xF2","}":"\xE8","~":"\xEC"},i.CHARSETS.E=i.CHARSETS[6]={"@":"\xC4","[":"\xC6","\\":"\xD8","]":"\xC5","^":"\xDC","`":"\xE4","{":"\xE6","|":"\xF8","}":"\xE5","~":"\xFC"},i.CHARSETS.Z={"#":"\xA3","@":"\xA7","[":"\xA1","\\":"\xD1","]":"\xBF","{":"\xB0","|":"\xF1","}":"\xE7"},i.CHARSETS.H=i.CHARSETS[7]={"@":"\xC9","[":"\xC4","\\":"\xD6","]":"\xC5","^":"\xDC","`":"\xE9","{":"\xE4","|":"\xF6","}":"\xE5","~":"\xFC"},i.CHARSETS["="]={"#":"\xF9","@":"\xE0","[":"\xE9","\\":"\xE7","]":"\xEA","^":"\xEE",_:"\xE8","`":"\xF4","{":"\xE4","|":"\xF6","}":"\xFC","~":"\xFB"}},2584:(u,i)=>{var o,h,f;Object.defineProperty(i,"__esModule",{value:!0}),i.C1_ESCAPED=i.C1=i.C0=void 0,(function(c){c.NUL="\0",c.SOH="",c.STX="",c.ETX="",c.EOT="",c.ENQ="",c.ACK="",c.BEL="\x07",c.BS="\b",c.HT="	",c.LF=`
`,c.VT="\v",c.FF="\f",c.CR="\r",c.SO="",c.SI="",c.DLE="",c.DC1="",c.DC2="",c.DC3="",c.DC4="",c.NAK="",c.SYN="",c.ETB="",c.CAN="",c.EM="",c.SUB="",c.ESC="\x1B",c.FS="",c.GS="",c.RS="",c.US="",c.SP=" ",c.DEL="\x7F"})(o||(i.C0=o={})),(function(c){c.PAD="\x80",c.HOP="\x81",c.BPH="\x82",c.NBH="\x83",c.IND="\x84",c.NEL="\x85",c.SSA="\x86",c.ESA="\x87",c.HTS="\x88",c.HTJ="\x89",c.VTS="\x8A",c.PLD="\x8B",c.PLU="\x8C",c.RI="\x8D",c.SS2="\x8E",c.SS3="\x8F",c.DCS="\x90",c.PU1="\x91",c.PU2="\x92",c.STS="\x93",c.CCH="\x94",c.MW="\x95",c.SPA="\x96",c.EPA="\x97",c.SOS="\x98",c.SGCI="\x99",c.SCI="\x9A",c.CSI="\x9B",c.ST="\x9C",c.OSC="\x9D",c.PM="\x9E",c.APC="\x9F"})(h||(i.C1=h={})),(function(c){c.ST=`${o.ESC}\\`})(f||(i.C1_ESCAPED=f={}))},7399:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.evaluateKeyboardEvent=void 0;let h=o(2584),f={48:["0",")"],49:["1","!"],50:["2","@"],51:["3","#"],52:["4","$"],53:["5","%"],54:["6","^"],55:["7","&"],56:["8","*"],57:["9","("],186:[";",":"],187:["=","+"],188:[",","<"],189:["-","_"],190:[".",">"],191:["/","?"],192:["`","~"],219:["[","{"],220:["\\","|"],221:["]","}"],222:["'",'"']};i.evaluateKeyboardEvent=function(c,p,v,S){let g={type:0,cancel:!1,key:void 0},s=(c.shiftKey?1:0)|(c.altKey?2:0)|(c.ctrlKey?4:0)|(c.metaKey?8:0);switch(c.keyCode){case 0:c.key==="UIKeyInputUpArrow"?g.key=p?h.C0.ESC+"OA":h.C0.ESC+"[A":c.key==="UIKeyInputLeftArrow"?g.key=p?h.C0.ESC+"OD":h.C0.ESC+"[D":c.key==="UIKeyInputRightArrow"?g.key=p?h.C0.ESC+"OC":h.C0.ESC+"[C":c.key==="UIKeyInputDownArrow"&&(g.key=p?h.C0.ESC+"OB":h.C0.ESC+"[B");break;case 8:if(c.altKey){g.key=h.C0.ESC+h.C0.DEL;break}g.key=h.C0.DEL;break;case 9:if(c.shiftKey){g.key=h.C0.ESC+"[Z";break}g.key=h.C0.HT,g.cancel=!0;break;case 13:g.key=c.altKey?h.C0.ESC+h.C0.CR:h.C0.CR,g.cancel=!0;break;case 27:g.key=h.C0.ESC,c.altKey&&(g.key=h.C0.ESC+h.C0.ESC),g.cancel=!0;break;case 37:if(c.metaKey)break;s?(g.key=h.C0.ESC+"[1;"+(s+1)+"D",g.key===h.C0.ESC+"[1;3D"&&(g.key=h.C0.ESC+(v?"b":"[1;5D"))):g.key=p?h.C0.ESC+"OD":h.C0.ESC+"[D";break;case 39:if(c.metaKey)break;s?(g.key=h.C0.ESC+"[1;"+(s+1)+"C",g.key===h.C0.ESC+"[1;3C"&&(g.key=h.C0.ESC+(v?"f":"[1;5C"))):g.key=p?h.C0.ESC+"OC":h.C0.ESC+"[C";break;case 38:if(c.metaKey)break;s?(g.key=h.C0.ESC+"[1;"+(s+1)+"A",v||g.key!==h.C0.ESC+"[1;3A"||(g.key=h.C0.ESC+"[1;5A")):g.key=p?h.C0.ESC+"OA":h.C0.ESC+"[A";break;case 40:if(c.metaKey)break;s?(g.key=h.C0.ESC+"[1;"+(s+1)+"B",v||g.key!==h.C0.ESC+"[1;3B"||(g.key=h.C0.ESC+"[1;5B")):g.key=p?h.C0.ESC+"OB":h.C0.ESC+"[B";break;case 45:c.shiftKey||c.ctrlKey||(g.key=h.C0.ESC+"[2~");break;case 46:g.key=s?h.C0.ESC+"[3;"+(s+1)+"~":h.C0.ESC+"[3~";break;case 36:g.key=s?h.C0.ESC+"[1;"+(s+1)+"H":p?h.C0.ESC+"OH":h.C0.ESC+"[H";break;case 35:g.key=s?h.C0.ESC+"[1;"+(s+1)+"F":p?h.C0.ESC+"OF":h.C0.ESC+"[F";break;case 33:c.shiftKey?g.type=2:c.ctrlKey?g.key=h.C0.ESC+"[5;"+(s+1)+"~":g.key=h.C0.ESC+"[5~";break;case 34:c.shiftKey?g.type=3:c.ctrlKey?g.key=h.C0.ESC+"[6;"+(s+1)+"~":g.key=h.C0.ESC+"[6~";break;case 112:g.key=s?h.C0.ESC+"[1;"+(s+1)+"P":h.C0.ESC+"OP";break;case 113:g.key=s?h.C0.ESC+"[1;"+(s+1)+"Q":h.C0.ESC+"OQ";break;case 114:g.key=s?h.C0.ESC+"[1;"+(s+1)+"R":h.C0.ESC+"OR";break;case 115:g.key=s?h.C0.ESC+"[1;"+(s+1)+"S":h.C0.ESC+"OS";break;case 116:g.key=s?h.C0.ESC+"[15;"+(s+1)+"~":h.C0.ESC+"[15~";break;case 117:g.key=s?h.C0.ESC+"[17;"+(s+1)+"~":h.C0.ESC+"[17~";break;case 118:g.key=s?h.C0.ESC+"[18;"+(s+1)+"~":h.C0.ESC+"[18~";break;case 119:g.key=s?h.C0.ESC+"[19;"+(s+1)+"~":h.C0.ESC+"[19~";break;case 120:g.key=s?h.C0.ESC+"[20;"+(s+1)+"~":h.C0.ESC+"[20~";break;case 121:g.key=s?h.C0.ESC+"[21;"+(s+1)+"~":h.C0.ESC+"[21~";break;case 122:g.key=s?h.C0.ESC+"[23;"+(s+1)+"~":h.C0.ESC+"[23~";break;case 123:g.key=s?h.C0.ESC+"[24;"+(s+1)+"~":h.C0.ESC+"[24~";break;default:if(!c.ctrlKey||c.shiftKey||c.altKey||c.metaKey)if(v&&!S||!c.altKey||c.metaKey)!v||c.altKey||c.ctrlKey||c.shiftKey||!c.metaKey?c.key&&!c.ctrlKey&&!c.altKey&&!c.metaKey&&c.keyCode>=48&&c.key.length===1?g.key=c.key:c.key&&c.ctrlKey&&(c.key==="_"&&(g.key=h.C0.US),c.key==="@"&&(g.key=h.C0.NUL)):c.keyCode===65&&(g.type=1);else{let a=f[c.keyCode],n=a?.[c.shiftKey?1:0];if(n)g.key=h.C0.ESC+n;else if(c.keyCode>=65&&c.keyCode<=90){let l=c.ctrlKey?c.keyCode-64:c.keyCode+32,_=String.fromCharCode(l);c.shiftKey&&(_=_.toUpperCase()),g.key=h.C0.ESC+_}else if(c.keyCode===32)g.key=h.C0.ESC+(c.ctrlKey?h.C0.NUL:" ");else if(c.key==="Dead"&&c.code.startsWith("Key")){let l=c.code.slice(3,4);c.shiftKey||(l=l.toLowerCase()),g.key=h.C0.ESC+l,g.cancel=!0}}else c.keyCode>=65&&c.keyCode<=90?g.key=String.fromCharCode(c.keyCode-64):c.keyCode===32?g.key=h.C0.NUL:c.keyCode>=51&&c.keyCode<=55?g.key=String.fromCharCode(c.keyCode-51+27):c.keyCode===56?g.key=h.C0.DEL:c.keyCode===219?g.key=h.C0.ESC:c.keyCode===220?g.key=h.C0.FS:c.keyCode===221&&(g.key=h.C0.GS)}return g}},482:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Utf8ToUtf32=i.StringToUtf32=i.utf32ToString=i.stringFromCodePoint=void 0,i.stringFromCodePoint=function(o){return o>65535?(o-=65536,String.fromCharCode(55296+(o>>10))+String.fromCharCode(o%1024+56320)):String.fromCharCode(o)},i.utf32ToString=function(o,h=0,f=o.length){let c="";for(let p=h;p<f;++p){let v=o[p];v>65535?(v-=65536,c+=String.fromCharCode(55296+(v>>10))+String.fromCharCode(v%1024+56320)):c+=String.fromCharCode(v)}return c},i.StringToUtf32=class{constructor(){this._interim=0}clear(){this._interim=0}decode(o,h){let f=o.length;if(!f)return 0;let c=0,p=0;if(this._interim){let v=o.charCodeAt(p++);56320<=v&&v<=57343?h[c++]=1024*(this._interim-55296)+v-56320+65536:(h[c++]=this._interim,h[c++]=v),this._interim=0}for(let v=p;v<f;++v){let S=o.charCodeAt(v);if(55296<=S&&S<=56319){if(++v>=f)return this._interim=S,c;let g=o.charCodeAt(v);56320<=g&&g<=57343?h[c++]=1024*(S-55296)+g-56320+65536:(h[c++]=S,h[c++]=g)}else S!==65279&&(h[c++]=S)}return c}},i.Utf8ToUtf32=class{constructor(){this.interim=new Uint8Array(3)}clear(){this.interim.fill(0)}decode(o,h){let f=o.length;if(!f)return 0;let c,p,v,S,g=0,s=0,a=0;if(this.interim[0]){let _=!1,b=this.interim[0];b&=(224&b)==192?31:(240&b)==224?15:7;let y,x=0;for(;(y=63&this.interim[++x])&&x<4;)b<<=6,b|=y;let m=(224&this.interim[0])==192?2:(240&this.interim[0])==224?3:4,w=m-x;for(;a<w;){if(a>=f)return 0;if(y=o[a++],(192&y)!=128){a--,_=!0;break}this.interim[x++]=y,b<<=6,b|=63&y}_||(m===2?b<128?a--:h[g++]=b:m===3?b<2048||b>=55296&&b<=57343||b===65279||(h[g++]=b):b<65536||b>1114111||(h[g++]=b)),this.interim.fill(0)}let n=f-4,l=a;for(;l<f;){for(;!(!(l<n)||128&(c=o[l])||128&(p=o[l+1])||128&(v=o[l+2])||128&(S=o[l+3]));)h[g++]=c,h[g++]=p,h[g++]=v,h[g++]=S,l+=4;if(c=o[l++],c<128)h[g++]=c;else if((224&c)==192){if(l>=f)return this.interim[0]=c,g;if(p=o[l++],(192&p)!=128){l--;continue}if(s=(31&c)<<6|63&p,s<128){l--;continue}h[g++]=s}else if((240&c)==224){if(l>=f)return this.interim[0]=c,g;if(p=o[l++],(192&p)!=128){l--;continue}if(l>=f)return this.interim[0]=c,this.interim[1]=p,g;if(v=o[l++],(192&v)!=128){l--;continue}if(s=(15&c)<<12|(63&p)<<6|63&v,s<2048||s>=55296&&s<=57343||s===65279)continue;h[g++]=s}else if((248&c)==240){if(l>=f)return this.interim[0]=c,g;if(p=o[l++],(192&p)!=128){l--;continue}if(l>=f)return this.interim[0]=c,this.interim[1]=p,g;if(v=o[l++],(192&v)!=128){l--;continue}if(l>=f)return this.interim[0]=c,this.interim[1]=p,this.interim[2]=v,g;if(S=o[l++],(192&S)!=128){l--;continue}if(s=(7&c)<<18|(63&p)<<12|(63&v)<<6|63&S,s<65536||s>1114111)continue;h[g++]=s}}return g}}},225:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.UnicodeV6=void 0;let o=[[768,879],[1155,1158],[1160,1161],[1425,1469],[1471,1471],[1473,1474],[1476,1477],[1479,1479],[1536,1539],[1552,1557],[1611,1630],[1648,1648],[1750,1764],[1767,1768],[1770,1773],[1807,1807],[1809,1809],[1840,1866],[1958,1968],[2027,2035],[2305,2306],[2364,2364],[2369,2376],[2381,2381],[2385,2388],[2402,2403],[2433,2433],[2492,2492],[2497,2500],[2509,2509],[2530,2531],[2561,2562],[2620,2620],[2625,2626],[2631,2632],[2635,2637],[2672,2673],[2689,2690],[2748,2748],[2753,2757],[2759,2760],[2765,2765],[2786,2787],[2817,2817],[2876,2876],[2879,2879],[2881,2883],[2893,2893],[2902,2902],[2946,2946],[3008,3008],[3021,3021],[3134,3136],[3142,3144],[3146,3149],[3157,3158],[3260,3260],[3263,3263],[3270,3270],[3276,3277],[3298,3299],[3393,3395],[3405,3405],[3530,3530],[3538,3540],[3542,3542],[3633,3633],[3636,3642],[3655,3662],[3761,3761],[3764,3769],[3771,3772],[3784,3789],[3864,3865],[3893,3893],[3895,3895],[3897,3897],[3953,3966],[3968,3972],[3974,3975],[3984,3991],[3993,4028],[4038,4038],[4141,4144],[4146,4146],[4150,4151],[4153,4153],[4184,4185],[4448,4607],[4959,4959],[5906,5908],[5938,5940],[5970,5971],[6002,6003],[6068,6069],[6071,6077],[6086,6086],[6089,6099],[6109,6109],[6155,6157],[6313,6313],[6432,6434],[6439,6440],[6450,6450],[6457,6459],[6679,6680],[6912,6915],[6964,6964],[6966,6970],[6972,6972],[6978,6978],[7019,7027],[7616,7626],[7678,7679],[8203,8207],[8234,8238],[8288,8291],[8298,8303],[8400,8431],[12330,12335],[12441,12442],[43014,43014],[43019,43019],[43045,43046],[64286,64286],[65024,65039],[65056,65059],[65279,65279],[65529,65531]],h=[[68097,68099],[68101,68102],[68108,68111],[68152,68154],[68159,68159],[119143,119145],[119155,119170],[119173,119179],[119210,119213],[119362,119364],[917505,917505],[917536,917631],[917760,917999]],f;i.UnicodeV6=class{constructor(){if(this.version="6",!f){f=new Uint8Array(65536),f.fill(1),f[0]=0,f.fill(0,1,32),f.fill(0,127,160),f.fill(2,4352,4448),f[9001]=2,f[9002]=2,f.fill(2,11904,42192),f[12351]=1,f.fill(2,44032,55204),f.fill(2,63744,64256),f.fill(2,65040,65050),f.fill(2,65072,65136),f.fill(2,65280,65377),f.fill(2,65504,65511);for(let c=0;c<o.length;++c)f.fill(0,o[c][0],o[c][1]+1)}}wcwidth(c){return c<32?0:c<127?1:c<65536?f[c]:(function(p,v){let S,g=0,s=v.length-1;if(p<v[0][0]||p>v[s][1])return!1;for(;s>=g;)if(S=g+s>>1,p>v[S][1])g=S+1;else{if(!(p<v[S][0]))return!0;s=S-1}return!1})(c,h)?0:c>=131072&&c<=196605||c>=196608&&c<=262141?2:1}}},5981:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.WriteBuffer=void 0;let h=o(8460),f=o(844);class c extends f.Disposable{constructor(v){super(),this._action=v,this._writeBuffer=[],this._callbacks=[],this._pendingData=0,this._bufferOffset=0,this._isSyncWriting=!1,this._syncCalls=0,this._didUserInput=!1,this._onWriteParsed=this.register(new h.EventEmitter),this.onWriteParsed=this._onWriteParsed.event}handleUserInput(){this._didUserInput=!0}writeSync(v,S){if(S!==void 0&&this._syncCalls>S)return void(this._syncCalls=0);if(this._pendingData+=v.length,this._writeBuffer.push(v),this._callbacks.push(void 0),this._syncCalls++,this._isSyncWriting)return;let g;for(this._isSyncWriting=!0;g=this._writeBuffer.shift();){this._action(g);let s=this._callbacks.shift();s&&s()}this._pendingData=0,this._bufferOffset=2147483647,this._isSyncWriting=!1,this._syncCalls=0}write(v,S){if(this._pendingData>5e7)throw new Error("write data discarded, use flow control to avoid losing data");if(!this._writeBuffer.length){if(this._bufferOffset=0,this._didUserInput)return this._didUserInput=!1,this._pendingData+=v.length,this._writeBuffer.push(v),this._callbacks.push(S),void this._innerWrite();setTimeout((()=>this._innerWrite()))}this._pendingData+=v.length,this._writeBuffer.push(v),this._callbacks.push(S)}_innerWrite(v=0,S=!0){let g=v||Date.now();for(;this._writeBuffer.length>this._bufferOffset;){let s=this._writeBuffer[this._bufferOffset],a=this._action(s,S);if(a){let l=_=>Date.now()-g>=12?setTimeout((()=>this._innerWrite(0,_))):this._innerWrite(g,_);return void a.catch((_=>(queueMicrotask((()=>{throw _})),Promise.resolve(!1)))).then(l)}let n=this._callbacks[this._bufferOffset];if(n&&n(),this._bufferOffset++,this._pendingData-=s.length,Date.now()-g>=12)break}this._writeBuffer.length>this._bufferOffset?(this._bufferOffset>50&&(this._writeBuffer=this._writeBuffer.slice(this._bufferOffset),this._callbacks=this._callbacks.slice(this._bufferOffset),this._bufferOffset=0),setTimeout((()=>this._innerWrite()))):(this._writeBuffer.length=0,this._callbacks.length=0,this._pendingData=0,this._bufferOffset=0),this._onWriteParsed.fire()}}i.WriteBuffer=c},5941:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.toRgbString=i.parseColor=void 0;let o=/^([\da-f])\/([\da-f])\/([\da-f])$|^([\da-f]{2})\/([\da-f]{2})\/([\da-f]{2})$|^([\da-f]{3})\/([\da-f]{3})\/([\da-f]{3})$|^([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})$/,h=/^[\da-f]+$/;function f(c,p){let v=c.toString(16),S=v.length<2?"0"+v:v;switch(p){case 4:return v[0];case 8:return S;case 12:return(S+S).slice(0,3);default:return S+S}}i.parseColor=function(c){if(!c)return;let p=c.toLowerCase();if(p.indexOf("rgb:")===0){p=p.slice(4);let v=o.exec(p);if(v){let S=v[1]?15:v[4]?255:v[7]?4095:65535;return[Math.round(parseInt(v[1]||v[4]||v[7]||v[10],16)/S*255),Math.round(parseInt(v[2]||v[5]||v[8]||v[11],16)/S*255),Math.round(parseInt(v[3]||v[6]||v[9]||v[12],16)/S*255)]}}else if(p.indexOf("#")===0&&(p=p.slice(1),h.exec(p)&&[3,6,9,12].includes(p.length))){let v=p.length/3,S=[0,0,0];for(let g=0;g<3;++g){let s=parseInt(p.slice(v*g,v*g+v),16);S[g]=v===1?s<<4:v===2?s:v===3?s>>4:s>>8}return S}},i.toRgbString=function(c,p=16){let[v,S,g]=c;return`rgb:${f(v,p)}/${f(S,p)}/${f(g,p)}`}},5770:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.PAYLOAD_LIMIT=void 0,i.PAYLOAD_LIMIT=1e7},6351:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DcsHandler=i.DcsParser=void 0;let h=o(482),f=o(8742),c=o(5770),p=[];i.DcsParser=class{constructor(){this._handlers=Object.create(null),this._active=p,this._ident=0,this._handlerFb=()=>{},this._stack={paused:!1,loopPosition:0,fallThrough:!1}}dispose(){this._handlers=Object.create(null),this._handlerFb=()=>{},this._active=p}registerHandler(S,g){this._handlers[S]===void 0&&(this._handlers[S]=[]);let s=this._handlers[S];return s.push(g),{dispose:()=>{let a=s.indexOf(g);a!==-1&&s.splice(a,1)}}}clearHandler(S){this._handlers[S]&&delete this._handlers[S]}setHandlerFallback(S){this._handlerFb=S}reset(){if(this._active.length)for(let S=this._stack.paused?this._stack.loopPosition-1:this._active.length-1;S>=0;--S)this._active[S].unhook(!1);this._stack.paused=!1,this._active=p,this._ident=0}hook(S,g){if(this.reset(),this._ident=S,this._active=this._handlers[S]||p,this._active.length)for(let s=this._active.length-1;s>=0;s--)this._active[s].hook(g);else this._handlerFb(this._ident,"HOOK",g)}put(S,g,s){if(this._active.length)for(let a=this._active.length-1;a>=0;a--)this._active[a].put(S,g,s);else this._handlerFb(this._ident,"PUT",(0,h.utf32ToString)(S,g,s))}unhook(S,g=!0){if(this._active.length){let s=!1,a=this._active.length-1,n=!1;if(this._stack.paused&&(a=this._stack.loopPosition-1,s=g,n=this._stack.fallThrough,this._stack.paused=!1),!n&&s===!1){for(;a>=0&&(s=this._active[a].unhook(S),s!==!0);a--)if(s instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=a,this._stack.fallThrough=!1,s;a--}for(;a>=0;a--)if(s=this._active[a].unhook(!1),s instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=a,this._stack.fallThrough=!0,s}else this._handlerFb(this._ident,"UNHOOK",S);this._active=p,this._ident=0}};let v=new f.Params;v.addParam(0),i.DcsHandler=class{constructor(S){this._handler=S,this._data="",this._params=v,this._hitLimit=!1}hook(S){this._params=S.length>1||S.params[0]?S.clone():v,this._data="",this._hitLimit=!1}put(S,g,s){this._hitLimit||(this._data+=(0,h.utf32ToString)(S,g,s),this._data.length>c.PAYLOAD_LIMIT&&(this._data="",this._hitLimit=!0))}unhook(S){let g=!1;if(this._hitLimit)g=!1;else if(S&&(g=this._handler(this._data,this._params),g instanceof Promise))return g.then((s=>(this._params=v,this._data="",this._hitLimit=!1,s)));return this._params=v,this._data="",this._hitLimit=!1,g}}},2015:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.EscapeSequenceParser=i.VT500_TRANSITION_TABLE=i.TransitionTable=void 0;let h=o(844),f=o(8742),c=o(6242),p=o(6351);class v{constructor(a){this.table=new Uint8Array(a)}setDefault(a,n){this.table.fill(a<<4|n)}add(a,n,l,_){this.table[n<<8|a]=l<<4|_}addMany(a,n,l,_){for(let b=0;b<a.length;b++)this.table[n<<8|a[b]]=l<<4|_}}i.TransitionTable=v;let S=160;i.VT500_TRANSITION_TABLE=(function(){let s=new v(4095),a=Array.apply(null,Array(256)).map(((x,m)=>m)),n=(x,m)=>a.slice(x,m),l=n(32,127),_=n(0,24);_.push(25),_.push.apply(_,n(28,32));let b=n(0,14),y;for(y in s.setDefault(1,0),s.addMany(l,0,2,0),b)s.addMany([24,26,153,154],y,3,0),s.addMany(n(128,144),y,3,0),s.addMany(n(144,152),y,3,0),s.add(156,y,0,0),s.add(27,y,11,1),s.add(157,y,4,8),s.addMany([152,158,159],y,0,7),s.add(155,y,11,3),s.add(144,y,11,9);return s.addMany(_,0,3,0),s.addMany(_,1,3,1),s.add(127,1,0,1),s.addMany(_,8,0,8),s.addMany(_,3,3,3),s.add(127,3,0,3),s.addMany(_,4,3,4),s.add(127,4,0,4),s.addMany(_,6,3,6),s.addMany(_,5,3,5),s.add(127,5,0,5),s.addMany(_,2,3,2),s.add(127,2,0,2),s.add(93,1,4,8),s.addMany(l,8,5,8),s.add(127,8,5,8),s.addMany([156,27,24,26,7],8,6,0),s.addMany(n(28,32),8,0,8),s.addMany([88,94,95],1,0,7),s.addMany(l,7,0,7),s.addMany(_,7,0,7),s.add(156,7,0,0),s.add(127,7,0,7),s.add(91,1,11,3),s.addMany(n(64,127),3,7,0),s.addMany(n(48,60),3,8,4),s.addMany([60,61,62,63],3,9,4),s.addMany(n(48,60),4,8,4),s.addMany(n(64,127),4,7,0),s.addMany([60,61,62,63],4,0,6),s.addMany(n(32,64),6,0,6),s.add(127,6,0,6),s.addMany(n(64,127),6,0,0),s.addMany(n(32,48),3,9,5),s.addMany(n(32,48),5,9,5),s.addMany(n(48,64),5,0,6),s.addMany(n(64,127),5,7,0),s.addMany(n(32,48),4,9,5),s.addMany(n(32,48),1,9,2),s.addMany(n(32,48),2,9,2),s.addMany(n(48,127),2,10,0),s.addMany(n(48,80),1,10,0),s.addMany(n(81,88),1,10,0),s.addMany([89,90,92],1,10,0),s.addMany(n(96,127),1,10,0),s.add(80,1,11,9),s.addMany(_,9,0,9),s.add(127,9,0,9),s.addMany(n(28,32),9,0,9),s.addMany(n(32,48),9,9,12),s.addMany(n(48,60),9,8,10),s.addMany([60,61,62,63],9,9,10),s.addMany(_,11,0,11),s.addMany(n(32,128),11,0,11),s.addMany(n(28,32),11,0,11),s.addMany(_,10,0,10),s.add(127,10,0,10),s.addMany(n(28,32),10,0,10),s.addMany(n(48,60),10,8,10),s.addMany([60,61,62,63],10,0,11),s.addMany(n(32,48),10,9,12),s.addMany(_,12,0,12),s.add(127,12,0,12),s.addMany(n(28,32),12,0,12),s.addMany(n(32,48),12,9,12),s.addMany(n(48,64),12,0,11),s.addMany(n(64,127),12,12,13),s.addMany(n(64,127),10,12,13),s.addMany(n(64,127),9,12,13),s.addMany(_,13,13,13),s.addMany(l,13,13,13),s.add(127,13,0,13),s.addMany([27,156,24,26],13,14,0),s.add(S,0,2,0),s.add(S,8,5,8),s.add(S,6,0,6),s.add(S,11,0,11),s.add(S,13,13,13),s})();class g extends h.Disposable{constructor(a=i.VT500_TRANSITION_TABLE){super(),this._transitions=a,this._parseStack={state:0,handlers:[],handlerPos:0,transition:0,chunkPos:0},this.initialState=0,this.currentState=this.initialState,this._params=new f.Params,this._params.addParam(0),this._collect=0,this.precedingCodepoint=0,this._printHandlerFb=(n,l,_)=>{},this._executeHandlerFb=n=>{},this._csiHandlerFb=(n,l)=>{},this._escHandlerFb=n=>{},this._errorHandlerFb=n=>n,this._printHandler=this._printHandlerFb,this._executeHandlers=Object.create(null),this._csiHandlers=Object.create(null),this._escHandlers=Object.create(null),this.register((0,h.toDisposable)((()=>{this._csiHandlers=Object.create(null),this._executeHandlers=Object.create(null),this._escHandlers=Object.create(null)}))),this._oscParser=this.register(new c.OscParser),this._dcsParser=this.register(new p.DcsParser),this._errorHandler=this._errorHandlerFb,this.registerEscHandler({final:"\\"},(()=>!0))}_identifier(a,n=[64,126]){let l=0;if(a.prefix){if(a.prefix.length>1)throw new Error("only one byte as prefix supported");if(l=a.prefix.charCodeAt(0),l&&60>l||l>63)throw new Error("prefix must be in range 0x3c .. 0x3f")}if(a.intermediates){if(a.intermediates.length>2)throw new Error("only two bytes as intermediates are supported");for(let b=0;b<a.intermediates.length;++b){let y=a.intermediates.charCodeAt(b);if(32>y||y>47)throw new Error("intermediate must be in range 0x20 .. 0x2f");l<<=8,l|=y}}if(a.final.length!==1)throw new Error("final must be a single byte");let _=a.final.charCodeAt(0);if(n[0]>_||_>n[1])throw new Error(`final must be in range ${n[0]} .. ${n[1]}`);return l<<=8,l|=_,l}identToString(a){let n=[];for(;a;)n.push(String.fromCharCode(255&a)),a>>=8;return n.reverse().join("")}setPrintHandler(a){this._printHandler=a}clearPrintHandler(){this._printHandler=this._printHandlerFb}registerEscHandler(a,n){let l=this._identifier(a,[48,126]);this._escHandlers[l]===void 0&&(this._escHandlers[l]=[]);let _=this._escHandlers[l];return _.push(n),{dispose:()=>{let b=_.indexOf(n);b!==-1&&_.splice(b,1)}}}clearEscHandler(a){this._escHandlers[this._identifier(a,[48,126])]&&delete this._escHandlers[this._identifier(a,[48,126])]}setEscHandlerFallback(a){this._escHandlerFb=a}setExecuteHandler(a,n){this._executeHandlers[a.charCodeAt(0)]=n}clearExecuteHandler(a){this._executeHandlers[a.charCodeAt(0)]&&delete this._executeHandlers[a.charCodeAt(0)]}setExecuteHandlerFallback(a){this._executeHandlerFb=a}registerCsiHandler(a,n){let l=this._identifier(a);this._csiHandlers[l]===void 0&&(this._csiHandlers[l]=[]);let _=this._csiHandlers[l];return _.push(n),{dispose:()=>{let b=_.indexOf(n);b!==-1&&_.splice(b,1)}}}clearCsiHandler(a){this._csiHandlers[this._identifier(a)]&&delete this._csiHandlers[this._identifier(a)]}setCsiHandlerFallback(a){this._csiHandlerFb=a}registerDcsHandler(a,n){return this._dcsParser.registerHandler(this._identifier(a),n)}clearDcsHandler(a){this._dcsParser.clearHandler(this._identifier(a))}setDcsHandlerFallback(a){this._dcsParser.setHandlerFallback(a)}registerOscHandler(a,n){return this._oscParser.registerHandler(a,n)}clearOscHandler(a){this._oscParser.clearHandler(a)}setOscHandlerFallback(a){this._oscParser.setHandlerFallback(a)}setErrorHandler(a){this._errorHandler=a}clearErrorHandler(){this._errorHandler=this._errorHandlerFb}reset(){this.currentState=this.initialState,this._oscParser.reset(),this._dcsParser.reset(),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0,this._parseStack.state!==0&&(this._parseStack.state=2,this._parseStack.handlers=[])}_preserveStack(a,n,l,_,b){this._parseStack.state=a,this._parseStack.handlers=n,this._parseStack.handlerPos=l,this._parseStack.transition=_,this._parseStack.chunkPos=b}parse(a,n,l){let _,b=0,y=0,x=0;if(this._parseStack.state)if(this._parseStack.state===2)this._parseStack.state=0,x=this._parseStack.chunkPos+1;else{if(l===void 0||this._parseStack.state===1)throw this._parseStack.state=1,new Error("improper continuation due to previous async handler, giving up parsing");let m=this._parseStack.handlers,w=this._parseStack.handlerPos-1;switch(this._parseStack.state){case 3:if(l===!1&&w>-1){for(;w>=0&&(_=m[w](this._params),_!==!0);w--)if(_ instanceof Promise)return this._parseStack.handlerPos=w,_}this._parseStack.handlers=[];break;case 4:if(l===!1&&w>-1){for(;w>=0&&(_=m[w](),_!==!0);w--)if(_ instanceof Promise)return this._parseStack.handlerPos=w,_}this._parseStack.handlers=[];break;case 6:if(b=a[this._parseStack.chunkPos],_=this._dcsParser.unhook(b!==24&&b!==26,l),_)return _;b===27&&(this._parseStack.transition|=1),this._params.reset(),this._params.addParam(0),this._collect=0;break;case 5:if(b=a[this._parseStack.chunkPos],_=this._oscParser.end(b!==24&&b!==26,l),_)return _;b===27&&(this._parseStack.transition|=1),this._params.reset(),this._params.addParam(0),this._collect=0}this._parseStack.state=0,x=this._parseStack.chunkPos+1,this.precedingCodepoint=0,this.currentState=15&this._parseStack.transition}for(let m=x;m<n;++m){switch(b=a[m],y=this._transitions.table[this.currentState<<8|(b<160?b:S)],y>>4){case 2:for(let O=m+1;;++O){if(O>=n||(b=a[O])<32||b>126&&b<S){this._printHandler(a,m,O),m=O-1;break}if(++O>=n||(b=a[O])<32||b>126&&b<S){this._printHandler(a,m,O),m=O-1;break}if(++O>=n||(b=a[O])<32||b>126&&b<S){this._printHandler(a,m,O),m=O-1;break}if(++O>=n||(b=a[O])<32||b>126&&b<S){this._printHandler(a,m,O),m=O-1;break}}break;case 3:this._executeHandlers[b]?this._executeHandlers[b]():this._executeHandlerFb(b),this.precedingCodepoint=0;break;case 0:break;case 1:if(this._errorHandler({position:m,code:b,currentState:this.currentState,collect:this._collect,params:this._params,abort:!1}).abort)return;break;case 7:let w=this._csiHandlers[this._collect<<8|b],A=w?w.length-1:-1;for(;A>=0&&(_=w[A](this._params),_!==!0);A--)if(_ instanceof Promise)return this._preserveStack(3,w,A,y,m),_;A<0&&this._csiHandlerFb(this._collect<<8|b,this._params),this.precedingCodepoint=0;break;case 8:do switch(b){case 59:this._params.addParam(0);break;case 58:this._params.addSubParam(-1);break;default:this._params.addDigit(b-48)}while(++m<n&&(b=a[m])>47&&b<60);m--;break;case 9:this._collect<<=8,this._collect|=b;break;case 10:let T=this._escHandlers[this._collect<<8|b],D=T?T.length-1:-1;for(;D>=0&&(_=T[D](),_!==!0);D--)if(_ instanceof Promise)return this._preserveStack(4,T,D,y,m),_;D<0&&this._escHandlerFb(this._collect<<8|b),this.precedingCodepoint=0;break;case 11:this._params.reset(),this._params.addParam(0),this._collect=0;break;case 12:this._dcsParser.hook(this._collect<<8|b,this._params);break;case 13:for(let O=m+1;;++O)if(O>=n||(b=a[O])===24||b===26||b===27||b>127&&b<S){this._dcsParser.put(a,m,O),m=O-1;break}break;case 14:if(_=this._dcsParser.unhook(b!==24&&b!==26),_)return this._preserveStack(6,[],0,y,m),_;b===27&&(y|=1),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0;break;case 4:this._oscParser.start();break;case 5:for(let O=m+1;;O++)if(O>=n||(b=a[O])<32||b>127&&b<S){this._oscParser.put(a,m,O),m=O-1;break}break;case 6:if(_=this._oscParser.end(b!==24&&b!==26),_)return this._preserveStack(5,[],0,y,m),_;b===27&&(y|=1),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0}this.currentState=15&y}}}i.EscapeSequenceParser=g},6242:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.OscHandler=i.OscParser=void 0;let h=o(5770),f=o(482),c=[];i.OscParser=class{constructor(){this._state=0,this._active=c,this._id=-1,this._handlers=Object.create(null),this._handlerFb=()=>{},this._stack={paused:!1,loopPosition:0,fallThrough:!1}}registerHandler(p,v){this._handlers[p]===void 0&&(this._handlers[p]=[]);let S=this._handlers[p];return S.push(v),{dispose:()=>{let g=S.indexOf(v);g!==-1&&S.splice(g,1)}}}clearHandler(p){this._handlers[p]&&delete this._handlers[p]}setHandlerFallback(p){this._handlerFb=p}dispose(){this._handlers=Object.create(null),this._handlerFb=()=>{},this._active=c}reset(){if(this._state===2)for(let p=this._stack.paused?this._stack.loopPosition-1:this._active.length-1;p>=0;--p)this._active[p].end(!1);this._stack.paused=!1,this._active=c,this._id=-1,this._state=0}_start(){if(this._active=this._handlers[this._id]||c,this._active.length)for(let p=this._active.length-1;p>=0;p--)this._active[p].start();else this._handlerFb(this._id,"START")}_put(p,v,S){if(this._active.length)for(let g=this._active.length-1;g>=0;g--)this._active[g].put(p,v,S);else this._handlerFb(this._id,"PUT",(0,f.utf32ToString)(p,v,S))}start(){this.reset(),this._state=1}put(p,v,S){if(this._state!==3){if(this._state===1)for(;v<S;){let g=p[v++];if(g===59){this._state=2,this._start();break}if(g<48||57<g)return void(this._state=3);this._id===-1&&(this._id=0),this._id=10*this._id+g-48}this._state===2&&S-v>0&&this._put(p,v,S)}}end(p,v=!0){if(this._state!==0){if(this._state!==3)if(this._state===1&&this._start(),this._active.length){let S=!1,g=this._active.length-1,s=!1;if(this._stack.paused&&(g=this._stack.loopPosition-1,S=v,s=this._stack.fallThrough,this._stack.paused=!1),!s&&S===!1){for(;g>=0&&(S=this._active[g].end(p),S!==!0);g--)if(S instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=g,this._stack.fallThrough=!1,S;g--}for(;g>=0;g--)if(S=this._active[g].end(!1),S instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=g,this._stack.fallThrough=!0,S}else this._handlerFb(this._id,"END",p);this._active=c,this._id=-1,this._state=0}}},i.OscHandler=class{constructor(p){this._handler=p,this._data="",this._hitLimit=!1}start(){this._data="",this._hitLimit=!1}put(p,v,S){this._hitLimit||(this._data+=(0,f.utf32ToString)(p,v,S),this._data.length>h.PAYLOAD_LIMIT&&(this._data="",this._hitLimit=!0))}end(p){let v=!1;if(this._hitLimit)v=!1;else if(p&&(v=this._handler(this._data),v instanceof Promise))return v.then((S=>(this._data="",this._hitLimit=!1,S)));return this._data="",this._hitLimit=!1,v}}},8742:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Params=void 0;let o=2147483647;class h{static fromArray(c){let p=new h;if(!c.length)return p;for(let v=Array.isArray(c[0])?1:0;v<c.length;++v){let S=c[v];if(Array.isArray(S))for(let g=0;g<S.length;++g)p.addSubParam(S[g]);else p.addParam(S)}return p}constructor(c=32,p=32){if(this.maxLength=c,this.maxSubParamsLength=p,p>256)throw new Error("maxSubParamsLength must not be greater than 256");this.params=new Int32Array(c),this.length=0,this._subParams=new Int32Array(p),this._subParamsLength=0,this._subParamsIdx=new Uint16Array(c),this._rejectDigits=!1,this._rejectSubDigits=!1,this._digitIsSub=!1}clone(){let c=new h(this.maxLength,this.maxSubParamsLength);return c.params.set(this.params),c.length=this.length,c._subParams.set(this._subParams),c._subParamsLength=this._subParamsLength,c._subParamsIdx.set(this._subParamsIdx),c._rejectDigits=this._rejectDigits,c._rejectSubDigits=this._rejectSubDigits,c._digitIsSub=this._digitIsSub,c}toArray(){let c=[];for(let p=0;p<this.length;++p){c.push(this.params[p]);let v=this._subParamsIdx[p]>>8,S=255&this._subParamsIdx[p];S-v>0&&c.push(Array.prototype.slice.call(this._subParams,v,S))}return c}reset(){this.length=0,this._subParamsLength=0,this._rejectDigits=!1,this._rejectSubDigits=!1,this._digitIsSub=!1}addParam(c){if(this._digitIsSub=!1,this.length>=this.maxLength)this._rejectDigits=!0;else{if(c<-1)throw new Error("values lesser than -1 are not allowed");this._subParamsIdx[this.length]=this._subParamsLength<<8|this._subParamsLength,this.params[this.length++]=c>o?o:c}}addSubParam(c){if(this._digitIsSub=!0,this.length)if(this._rejectDigits||this._subParamsLength>=this.maxSubParamsLength)this._rejectSubDigits=!0;else{if(c<-1)throw new Error("values lesser than -1 are not allowed");this._subParams[this._subParamsLength++]=c>o?o:c,this._subParamsIdx[this.length-1]++}}hasSubParams(c){return(255&this._subParamsIdx[c])-(this._subParamsIdx[c]>>8)>0}getSubParams(c){let p=this._subParamsIdx[c]>>8,v=255&this._subParamsIdx[c];return v-p>0?this._subParams.subarray(p,v):null}getSubParamsAll(){let c={};for(let p=0;p<this.length;++p){let v=this._subParamsIdx[p]>>8,S=255&this._subParamsIdx[p];S-v>0&&(c[p]=this._subParams.slice(v,S))}return c}addDigit(c){let p;if(this._rejectDigits||!(p=this._digitIsSub?this._subParamsLength:this.length)||this._digitIsSub&&this._rejectSubDigits)return;let v=this._digitIsSub?this._subParams:this.params,S=v[p-1];v[p-1]=~S?Math.min(10*S+c,o):c}}i.Params=h},5741:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.AddonManager=void 0,i.AddonManager=class{constructor(){this._addons=[]}dispose(){for(let o=this._addons.length-1;o>=0;o--)this._addons[o].instance.dispose()}loadAddon(o,h){let f={instance:h,dispose:h.dispose,isDisposed:!1};this._addons.push(f),h.dispose=()=>this._wrappedAddonDispose(f),h.activate(o)}_wrappedAddonDispose(o){if(o.isDisposed)return;let h=-1;for(let f=0;f<this._addons.length;f++)if(this._addons[f]===o){h=f;break}if(h===-1)throw new Error("Could not dispose an addon that has not been loaded");o.isDisposed=!0,o.dispose.apply(o.instance),this._addons.splice(h,1)}}},8771:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferApiView=void 0;let h=o(3785),f=o(511);i.BufferApiView=class{constructor(c,p){this._buffer=c,this.type=p}init(c){return this._buffer=c,this}get cursorY(){return this._buffer.y}get cursorX(){return this._buffer.x}get viewportY(){return this._buffer.ydisp}get baseY(){return this._buffer.ybase}get length(){return this._buffer.lines.length}getLine(c){let p=this._buffer.lines.get(c);if(p)return new h.BufferLineApiView(p)}getNullCell(){return new f.CellData}}},3785:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferLineApiView=void 0;let h=o(511);i.BufferLineApiView=class{constructor(f){this._line=f}get isWrapped(){return this._line.isWrapped}get length(){return this._line.length}getCell(f,c){if(!(f<0||f>=this._line.length))return c?(this._line.loadCell(f,c),c):this._line.loadCell(f,new h.CellData)}translateToString(f,c,p){return this._line.translateToString(f,c,p)}}},8285:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferNamespaceApi=void 0;let h=o(8771),f=o(8460),c=o(844);class p extends c.Disposable{constructor(S){super(),this._core=S,this._onBufferChange=this.register(new f.EventEmitter),this.onBufferChange=this._onBufferChange.event,this._normal=new h.BufferApiView(this._core.buffers.normal,"normal"),this._alternate=new h.BufferApiView(this._core.buffers.alt,"alternate"),this._core.buffers.onBufferActivate((()=>this._onBufferChange.fire(this.active)))}get active(){if(this._core.buffers.active===this._core.buffers.normal)return this.normal;if(this._core.buffers.active===this._core.buffers.alt)return this.alternate;throw new Error("Active buffer is neither normal nor alternate")}get normal(){return this._normal.init(this._core.buffers.normal)}get alternate(){return this._alternate.init(this._core.buffers.alt)}}i.BufferNamespaceApi=p},7975:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ParserApi=void 0,i.ParserApi=class{constructor(o){this._core=o}registerCsiHandler(o,h){return this._core.registerCsiHandler(o,(f=>h(f.toArray())))}addCsiHandler(o,h){return this.registerCsiHandler(o,h)}registerDcsHandler(o,h){return this._core.registerDcsHandler(o,((f,c)=>h(f,c.toArray())))}addDcsHandler(o,h){return this.registerDcsHandler(o,h)}registerEscHandler(o,h){return this._core.registerEscHandler(o,h)}addEscHandler(o,h){return this.registerEscHandler(o,h)}registerOscHandler(o,h){return this._core.registerOscHandler(o,h)}addOscHandler(o,h){return this.registerOscHandler(o,h)}}},7090:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.UnicodeApi=void 0,i.UnicodeApi=class{constructor(o){this._core=o}register(o){this._core.unicodeService.register(o)}get versions(){return this._core.unicodeService.versions}get activeVersion(){return this._core.unicodeService.activeVersion}set activeVersion(o){this._core.unicodeService.activeVersion=o}}},744:function(u,i,o){var h=this&&this.__decorate||function(s,a,n,l){var _,b=arguments.length,y=b<3?a:l===null?l=Object.getOwnPropertyDescriptor(a,n):l;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(s,a,n,l);else for(var x=s.length-1;x>=0;x--)(_=s[x])&&(y=(b<3?_(y):b>3?_(a,n,y):_(a,n))||y);return b>3&&y&&Object.defineProperty(a,n,y),y},f=this&&this.__param||function(s,a){return function(n,l){a(n,l,s)}};Object.defineProperty(i,"__esModule",{value:!0}),i.BufferService=i.MINIMUM_ROWS=i.MINIMUM_COLS=void 0;let c=o(8460),p=o(844),v=o(5295),S=o(2585);i.MINIMUM_COLS=2,i.MINIMUM_ROWS=1;let g=i.BufferService=class extends p.Disposable{get buffer(){return this.buffers.active}constructor(s){super(),this.isUserScrolling=!1,this._onResize=this.register(new c.EventEmitter),this.onResize=this._onResize.event,this._onScroll=this.register(new c.EventEmitter),this.onScroll=this._onScroll.event,this.cols=Math.max(s.rawOptions.cols||0,i.MINIMUM_COLS),this.rows=Math.max(s.rawOptions.rows||0,i.MINIMUM_ROWS),this.buffers=this.register(new v.BufferSet(s,this))}resize(s,a){this.cols=s,this.rows=a,this.buffers.resize(s,a),this._onResize.fire({cols:s,rows:a})}reset(){this.buffers.reset(),this.isUserScrolling=!1}scroll(s,a=!1){let n=this.buffer,l;l=this._cachedBlankLine,l&&l.length===this.cols&&l.getFg(0)===s.fg&&l.getBg(0)===s.bg||(l=n.getBlankLine(s,a),this._cachedBlankLine=l),l.isWrapped=a;let _=n.ybase+n.scrollTop,b=n.ybase+n.scrollBottom;if(n.scrollTop===0){let y=n.lines.isFull;b===n.lines.length-1?y?n.lines.recycle().copyFrom(l):n.lines.push(l.clone()):n.lines.splice(b+1,0,l.clone()),y?this.isUserScrolling&&(n.ydisp=Math.max(n.ydisp-1,0)):(n.ybase++,this.isUserScrolling||n.ydisp++)}else{let y=b-_+1;n.lines.shiftElements(_+1,y-1,-1),n.lines.set(b,l.clone())}this.isUserScrolling||(n.ydisp=n.ybase),this._onScroll.fire(n.ydisp)}scrollLines(s,a,n){let l=this.buffer;if(s<0){if(l.ydisp===0)return;this.isUserScrolling=!0}else s+l.ydisp>=l.ybase&&(this.isUserScrolling=!1);let _=l.ydisp;l.ydisp=Math.max(Math.min(l.ydisp+s,l.ybase),0),_!==l.ydisp&&(a||this._onScroll.fire(l.ydisp))}};i.BufferService=g=h([f(0,S.IOptionsService)],g)},7994:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CharsetService=void 0,i.CharsetService=class{constructor(){this.glevel=0,this._charsets=[]}reset(){this.charset=void 0,this._charsets=[],this.glevel=0}setgLevel(o){this.glevel=o,this.charset=this._charsets[o]}setgCharset(o,h){this._charsets[o]=h,this.glevel===o&&(this.charset=h)}}},1753:function(u,i,o){var h=this&&this.__decorate||function(l,_,b,y){var x,m=arguments.length,w=m<3?_:y===null?y=Object.getOwnPropertyDescriptor(_,b):y;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")w=Reflect.decorate(l,_,b,y);else for(var A=l.length-1;A>=0;A--)(x=l[A])&&(w=(m<3?x(w):m>3?x(_,b,w):x(_,b))||w);return m>3&&w&&Object.defineProperty(_,b,w),w},f=this&&this.__param||function(l,_){return function(b,y){_(b,y,l)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CoreMouseService=void 0;let c=o(2585),p=o(8460),v=o(844),S={NONE:{events:0,restrict:()=>!1},X10:{events:1,restrict:l=>l.button!==4&&l.action===1&&(l.ctrl=!1,l.alt=!1,l.shift=!1,!0)},VT200:{events:19,restrict:l=>l.action!==32},DRAG:{events:23,restrict:l=>l.action!==32||l.button!==3},ANY:{events:31,restrict:l=>!0}};function g(l,_){let b=(l.ctrl?16:0)|(l.shift?4:0)|(l.alt?8:0);return l.button===4?(b|=64,b|=l.action):(b|=3&l.button,4&l.button&&(b|=64),8&l.button&&(b|=128),l.action===32?b|=32:l.action!==0||_||(b|=3)),b}let s=String.fromCharCode,a={DEFAULT:l=>{let _=[g(l,!1)+32,l.col+32,l.row+32];return _[0]>255||_[1]>255||_[2]>255?"":`\x1B[M${s(_[0])}${s(_[1])}${s(_[2])}`},SGR:l=>{let _=l.action===0&&l.button!==4?"m":"M";return`\x1B[<${g(l,!0)};${l.col};${l.row}${_}`},SGR_PIXELS:l=>{let _=l.action===0&&l.button!==4?"m":"M";return`\x1B[<${g(l,!0)};${l.x};${l.y}${_}`}},n=i.CoreMouseService=class extends v.Disposable{constructor(l,_){super(),this._bufferService=l,this._coreService=_,this._protocols={},this._encodings={},this._activeProtocol="",this._activeEncoding="",this._lastEvent=null,this._onProtocolChange=this.register(new p.EventEmitter),this.onProtocolChange=this._onProtocolChange.event;for(let b of Object.keys(S))this.addProtocol(b,S[b]);for(let b of Object.keys(a))this.addEncoding(b,a[b]);this.reset()}addProtocol(l,_){this._protocols[l]=_}addEncoding(l,_){this._encodings[l]=_}get activeProtocol(){return this._activeProtocol}get areMouseEventsActive(){return this._protocols[this._activeProtocol].events!==0}set activeProtocol(l){if(!this._protocols[l])throw new Error(`unknown protocol "${l}"`);this._activeProtocol=l,this._onProtocolChange.fire(this._protocols[l].events)}get activeEncoding(){return this._activeEncoding}set activeEncoding(l){if(!this._encodings[l])throw new Error(`unknown encoding "${l}"`);this._activeEncoding=l}reset(){this.activeProtocol="NONE",this.activeEncoding="DEFAULT",this._lastEvent=null}triggerMouseEvent(l){if(l.col<0||l.col>=this._bufferService.cols||l.row<0||l.row>=this._bufferService.rows||l.button===4&&l.action===32||l.button===3&&l.action!==32||l.button!==4&&(l.action===2||l.action===3)||(l.col++,l.row++,l.action===32&&this._lastEvent&&this._equalEvents(this._lastEvent,l,this._activeEncoding==="SGR_PIXELS"))||!this._protocols[this._activeProtocol].restrict(l))return!1;let _=this._encodings[this._activeEncoding](l);return _&&(this._activeEncoding==="DEFAULT"?this._coreService.triggerBinaryEvent(_):this._coreService.triggerDataEvent(_,!0)),this._lastEvent=l,!0}explainEvents(l){return{down:!!(1&l),up:!!(2&l),drag:!!(4&l),move:!!(8&l),wheel:!!(16&l)}}_equalEvents(l,_,b){if(b){if(l.x!==_.x||l.y!==_.y)return!1}else if(l.col!==_.col||l.row!==_.row)return!1;return l.button===_.button&&l.action===_.action&&l.ctrl===_.ctrl&&l.alt===_.alt&&l.shift===_.shift}};i.CoreMouseService=n=h([f(0,c.IBufferService),f(1,c.ICoreService)],n)},6975:function(u,i,o){var h=this&&this.__decorate||function(n,l,_,b){var y,x=arguments.length,m=x<3?l:b===null?b=Object.getOwnPropertyDescriptor(l,_):b;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")m=Reflect.decorate(n,l,_,b);else for(var w=n.length-1;w>=0;w--)(y=n[w])&&(m=(x<3?y(m):x>3?y(l,_,m):y(l,_))||m);return x>3&&m&&Object.defineProperty(l,_,m),m},f=this&&this.__param||function(n,l){return function(_,b){l(_,b,n)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CoreService=void 0;let c=o(1439),p=o(8460),v=o(844),S=o(2585),g=Object.freeze({insertMode:!1}),s=Object.freeze({applicationCursorKeys:!1,applicationKeypad:!1,bracketedPasteMode:!1,origin:!1,reverseWraparound:!1,sendFocus:!1,wraparound:!0}),a=i.CoreService=class extends v.Disposable{constructor(n,l,_){super(),this._bufferService=n,this._logService=l,this._optionsService=_,this.isCursorInitialized=!1,this.isCursorHidden=!1,this._onData=this.register(new p.EventEmitter),this.onData=this._onData.event,this._onUserInput=this.register(new p.EventEmitter),this.onUserInput=this._onUserInput.event,this._onBinary=this.register(new p.EventEmitter),this.onBinary=this._onBinary.event,this._onRequestScrollToBottom=this.register(new p.EventEmitter),this.onRequestScrollToBottom=this._onRequestScrollToBottom.event,this.modes=(0,c.clone)(g),this.decPrivateModes=(0,c.clone)(s)}reset(){this.modes=(0,c.clone)(g),this.decPrivateModes=(0,c.clone)(s)}triggerDataEvent(n,l=!1){if(this._optionsService.rawOptions.disableStdin)return;let _=this._bufferService.buffer;l&&this._optionsService.rawOptions.scrollOnUserInput&&_.ybase!==_.ydisp&&this._onRequestScrollToBottom.fire(),l&&this._onUserInput.fire(),this._logService.debug(`sending data "${n}"`,(()=>n.split("").map((b=>b.charCodeAt(0))))),this._onData.fire(n)}triggerBinaryEvent(n){this._optionsService.rawOptions.disableStdin||(this._logService.debug(`sending binary "${n}"`,(()=>n.split("").map((l=>l.charCodeAt(0))))),this._onBinary.fire(n))}};i.CoreService=a=h([f(0,S.IBufferService),f(1,S.ILogService),f(2,S.IOptionsService)],a)},9074:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DecorationService=void 0;let h=o(8055),f=o(8460),c=o(844),p=o(6106),v=0,S=0;class g extends c.Disposable{get decorations(){return this._decorations.values()}constructor(){super(),this._decorations=new p.SortedList((n=>n?.marker.line)),this._onDecorationRegistered=this.register(new f.EventEmitter),this.onDecorationRegistered=this._onDecorationRegistered.event,this._onDecorationRemoved=this.register(new f.EventEmitter),this.onDecorationRemoved=this._onDecorationRemoved.event,this.register((0,c.toDisposable)((()=>this.reset())))}registerDecoration(n){if(n.marker.isDisposed)return;let l=new s(n);if(l){let _=l.marker.onDispose((()=>l.dispose()));l.onDispose((()=>{l&&(this._decorations.delete(l)&&this._onDecorationRemoved.fire(l),_.dispose())})),this._decorations.insert(l),this._onDecorationRegistered.fire(l)}return l}reset(){for(let n of this._decorations.values())n.dispose();this._decorations.clear()}*getDecorationsAtCell(n,l,_){var b,y,x;let m=0,w=0;for(let A of this._decorations.getKeyIterator(l))m=(b=A.options.x)!==null&&b!==void 0?b:0,w=m+((y=A.options.width)!==null&&y!==void 0?y:1),n>=m&&n<w&&(!_||((x=A.options.layer)!==null&&x!==void 0?x:"bottom")===_)&&(yield A)}forEachDecorationAtCell(n,l,_,b){this._decorations.forEachByKey(l,(y=>{var x,m,w;v=(x=y.options.x)!==null&&x!==void 0?x:0,S=v+((m=y.options.width)!==null&&m!==void 0?m:1),n>=v&&n<S&&(!_||((w=y.options.layer)!==null&&w!==void 0?w:"bottom")===_)&&b(y)}))}}i.DecorationService=g;class s extends c.Disposable{get isDisposed(){return this._isDisposed}get backgroundColorRGB(){return this._cachedBg===null&&(this.options.backgroundColor?this._cachedBg=h.css.toColor(this.options.backgroundColor):this._cachedBg=void 0),this._cachedBg}get foregroundColorRGB(){return this._cachedFg===null&&(this.options.foregroundColor?this._cachedFg=h.css.toColor(this.options.foregroundColor):this._cachedFg=void 0),this._cachedFg}constructor(n){super(),this.options=n,this.onRenderEmitter=this.register(new f.EventEmitter),this.onRender=this.onRenderEmitter.event,this._onDispose=this.register(new f.EventEmitter),this.onDispose=this._onDispose.event,this._cachedBg=null,this._cachedFg=null,this.marker=n.marker,this.options.overviewRulerOptions&&!this.options.overviewRulerOptions.position&&(this.options.overviewRulerOptions.position="full")}dispose(){this._onDispose.fire(),super.dispose()}}},4348:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.InstantiationService=i.ServiceCollection=void 0;let h=o(2585),f=o(8343);class c{constructor(...v){this._entries=new Map;for(let[S,g]of v)this.set(S,g)}set(v,S){let g=this._entries.get(v);return this._entries.set(v,S),g}forEach(v){for(let[S,g]of this._entries.entries())v(S,g)}has(v){return this._entries.has(v)}get(v){return this._entries.get(v)}}i.ServiceCollection=c,i.InstantiationService=class{constructor(){this._services=new c,this._services.set(h.IInstantiationService,this)}setService(p,v){this._services.set(p,v)}getService(p){return this._services.get(p)}createInstance(p,...v){let S=(0,f.getServiceDependencies)(p).sort(((a,n)=>a.index-n.index)),g=[];for(let a of S){let n=this._services.get(a.id);if(!n)throw new Error(`[createInstance] ${p.name} depends on UNKNOWN service ${a.id}.`);g.push(n)}let s=S.length>0?S[0].index:v.length;if(v.length!==s)throw new Error(`[createInstance] First service dependency of ${p.name} at position ${s+1} conflicts with ${v.length} static arguments`);return new p(...v,...g)}}},7866:function(u,i,o){var h=this&&this.__decorate||function(s,a,n,l){var _,b=arguments.length,y=b<3?a:l===null?l=Object.getOwnPropertyDescriptor(a,n):l;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(s,a,n,l);else for(var x=s.length-1;x>=0;x--)(_=s[x])&&(y=(b<3?_(y):b>3?_(a,n,y):_(a,n))||y);return b>3&&y&&Object.defineProperty(a,n,y),y},f=this&&this.__param||function(s,a){return function(n,l){a(n,l,s)}};Object.defineProperty(i,"__esModule",{value:!0}),i.traceCall=i.setTraceLogger=i.LogService=void 0;let c=o(844),p=o(2585),v={trace:p.LogLevelEnum.TRACE,debug:p.LogLevelEnum.DEBUG,info:p.LogLevelEnum.INFO,warn:p.LogLevelEnum.WARN,error:p.LogLevelEnum.ERROR,off:p.LogLevelEnum.OFF},S,g=i.LogService=class extends c.Disposable{get logLevel(){return this._logLevel}constructor(s){super(),this._optionsService=s,this._logLevel=p.LogLevelEnum.OFF,this._updateLogLevel(),this.register(this._optionsService.onSpecificOptionChange("logLevel",(()=>this._updateLogLevel()))),S=this}_updateLogLevel(){this._logLevel=v[this._optionsService.rawOptions.logLevel]}_evalLazyOptionalParams(s){for(let a=0;a<s.length;a++)typeof s[a]=="function"&&(s[a]=s[a]())}_log(s,a,n){this._evalLazyOptionalParams(n),s.call(console,(this._optionsService.options.logger?"":"xterm.js: ")+a,...n)}trace(s,...a){var n,l;this._logLevel<=p.LogLevelEnum.TRACE&&this._log((l=(n=this._optionsService.options.logger)===null||n===void 0?void 0:n.trace.bind(this._optionsService.options.logger))!==null&&l!==void 0?l:console.log,s,a)}debug(s,...a){var n,l;this._logLevel<=p.LogLevelEnum.DEBUG&&this._log((l=(n=this._optionsService.options.logger)===null||n===void 0?void 0:n.debug.bind(this._optionsService.options.logger))!==null&&l!==void 0?l:console.log,s,a)}info(s,...a){var n,l;this._logLevel<=p.LogLevelEnum.INFO&&this._log((l=(n=this._optionsService.options.logger)===null||n===void 0?void 0:n.info.bind(this._optionsService.options.logger))!==null&&l!==void 0?l:console.info,s,a)}warn(s,...a){var n,l;this._logLevel<=p.LogLevelEnum.WARN&&this._log((l=(n=this._optionsService.options.logger)===null||n===void 0?void 0:n.warn.bind(this._optionsService.options.logger))!==null&&l!==void 0?l:console.warn,s,a)}error(s,...a){var n,l;this._logLevel<=p.LogLevelEnum.ERROR&&this._log((l=(n=this._optionsService.options.logger)===null||n===void 0?void 0:n.error.bind(this._optionsService.options.logger))!==null&&l!==void 0?l:console.error,s,a)}};i.LogService=g=h([f(0,p.IOptionsService)],g),i.setTraceLogger=function(s){S=s},i.traceCall=function(s,a,n){if(typeof n.value!="function")throw new Error("not supported");let l=n.value;n.value=function(..._){if(S.logLevel!==p.LogLevelEnum.TRACE)return l.apply(this,_);S.trace(`GlyphRenderer#${l.name}(${_.map((y=>JSON.stringify(y))).join(", ")})`);let b=l.apply(this,_);return S.trace(`GlyphRenderer#${l.name} return`,b),b}}},7302:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.OptionsService=i.DEFAULT_OPTIONS=void 0;let h=o(8460),f=o(844),c=o(6114);i.DEFAULT_OPTIONS={cols:80,rows:24,cursorBlink:!1,cursorStyle:"block",cursorWidth:1,cursorInactiveStyle:"outline",customGlyphs:!0,drawBoldTextInBrightColors:!0,fastScrollModifier:"alt",fastScrollSensitivity:5,fontFamily:"courier-new, courier, monospace",fontSize:15,fontWeight:"normal",fontWeightBold:"bold",ignoreBracketedPasteMode:!1,lineHeight:1,letterSpacing:0,linkHandler:null,logLevel:"info",logger:null,scrollback:1e3,scrollOnUserInput:!0,scrollSensitivity:1,screenReaderMode:!1,smoothScrollDuration:0,macOptionIsMeta:!1,macOptionClickForcesSelection:!1,minimumContrastRatio:1,disableStdin:!1,allowProposedApi:!1,allowTransparency:!1,tabStopWidth:8,theme:{},rightClickSelectsWord:c.isMac,windowOptions:{},windowsMode:!1,windowsPty:{},wordSeparator:" ()[]{}',\"`",altClickMovesCursor:!0,convertEol:!1,termName:"xterm",cancelEvents:!1,overviewRulerWidth:0};let p=["normal","bold","100","200","300","400","500","600","700","800","900"];class v extends f.Disposable{constructor(g){super(),this._onOptionChange=this.register(new h.EventEmitter),this.onOptionChange=this._onOptionChange.event;let s=Object.assign({},i.DEFAULT_OPTIONS);for(let a in g)if(a in s)try{let n=g[a];s[a]=this._sanitizeAndValidateOption(a,n)}catch(n){console.error(n)}this.rawOptions=s,this.options=Object.assign({},s),this._setupOptions()}onSpecificOptionChange(g,s){return this.onOptionChange((a=>{a===g&&s(this.rawOptions[g])}))}onMultipleOptionChange(g,s){return this.onOptionChange((a=>{g.indexOf(a)!==-1&&s()}))}_setupOptions(){let g=a=>{if(!(a in i.DEFAULT_OPTIONS))throw new Error(`No option with key "${a}"`);return this.rawOptions[a]},s=(a,n)=>{if(!(a in i.DEFAULT_OPTIONS))throw new Error(`No option with key "${a}"`);n=this._sanitizeAndValidateOption(a,n),this.rawOptions[a]!==n&&(this.rawOptions[a]=n,this._onOptionChange.fire(a))};for(let a in this.rawOptions){let n={get:g.bind(this,a),set:s.bind(this,a)};Object.defineProperty(this.options,a,n)}}_sanitizeAndValidateOption(g,s){switch(g){case"cursorStyle":if(s||(s=i.DEFAULT_OPTIONS[g]),!(function(a){return a==="block"||a==="underline"||a==="bar"})(s))throw new Error(`"${s}" is not a valid value for ${g}`);break;case"wordSeparator":s||(s=i.DEFAULT_OPTIONS[g]);break;case"fontWeight":case"fontWeightBold":if(typeof s=="number"&&1<=s&&s<=1e3)break;s=p.includes(s)?s:i.DEFAULT_OPTIONS[g];break;case"cursorWidth":s=Math.floor(s);case"lineHeight":case"tabStopWidth":if(s<1)throw new Error(`${g} cannot be less than 1, value: ${s}`);break;case"minimumContrastRatio":s=Math.max(1,Math.min(21,Math.round(10*s)/10));break;case"scrollback":if((s=Math.min(s,4294967295))<0)throw new Error(`${g} cannot be less than 0, value: ${s}`);break;case"fastScrollSensitivity":case"scrollSensitivity":if(s<=0)throw new Error(`${g} cannot be less than or equal to 0, value: ${s}`);break;case"rows":case"cols":if(!s&&s!==0)throw new Error(`${g} must be numeric, value: ${s}`);break;case"windowsPty":s=s??{}}return s}}i.OptionsService=v},2660:function(u,i,o){var h=this&&this.__decorate||function(v,S,g,s){var a,n=arguments.length,l=n<3?S:s===null?s=Object.getOwnPropertyDescriptor(S,g):s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")l=Reflect.decorate(v,S,g,s);else for(var _=v.length-1;_>=0;_--)(a=v[_])&&(l=(n<3?a(l):n>3?a(S,g,l):a(S,g))||l);return n>3&&l&&Object.defineProperty(S,g,l),l},f=this&&this.__param||function(v,S){return function(g,s){S(g,s,v)}};Object.defineProperty(i,"__esModule",{value:!0}),i.OscLinkService=void 0;let c=o(2585),p=i.OscLinkService=class{constructor(v){this._bufferService=v,this._nextId=1,this._entriesWithId=new Map,this._dataByLinkId=new Map}registerLink(v){let S=this._bufferService.buffer;if(v.id===void 0){let _=S.addMarker(S.ybase+S.y),b={data:v,id:this._nextId++,lines:[_]};return _.onDispose((()=>this._removeMarkerFromLink(b,_))),this._dataByLinkId.set(b.id,b),b.id}let g=v,s=this._getEntryIdKey(g),a=this._entriesWithId.get(s);if(a)return this.addLineToLink(a.id,S.ybase+S.y),a.id;let n=S.addMarker(S.ybase+S.y),l={id:this._nextId++,key:this._getEntryIdKey(g),data:g,lines:[n]};return n.onDispose((()=>this._removeMarkerFromLink(l,n))),this._entriesWithId.set(l.key,l),this._dataByLinkId.set(l.id,l),l.id}addLineToLink(v,S){let g=this._dataByLinkId.get(v);if(g&&g.lines.every((s=>s.line!==S))){let s=this._bufferService.buffer.addMarker(S);g.lines.push(s),s.onDispose((()=>this._removeMarkerFromLink(g,s)))}}getLinkData(v){var S;return(S=this._dataByLinkId.get(v))===null||S===void 0?void 0:S.data}_getEntryIdKey(v){return`${v.id};;${v.uri}`}_removeMarkerFromLink(v,S){let g=v.lines.indexOf(S);g!==-1&&(v.lines.splice(g,1),v.lines.length===0&&(v.data.id!==void 0&&this._entriesWithId.delete(v.key),this._dataByLinkId.delete(v.id)))}};i.OscLinkService=p=h([f(0,c.IBufferService)],p)},8343:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.createDecorator=i.getServiceDependencies=i.serviceRegistry=void 0;let o="di$target",h="di$dependencies";i.serviceRegistry=new Map,i.getServiceDependencies=function(f){return f[h]||[]},i.createDecorator=function(f){if(i.serviceRegistry.has(f))return i.serviceRegistry.get(f);let c=function(p,v,S){if(arguments.length!==3)throw new Error("@IServiceName-decorator can only be used to decorate a parameter");(function(g,s,a){s[o]===s?s[h].push({id:g,index:a}):(s[h]=[{id:g,index:a}],s[o]=s)})(c,p,S)};return c.toString=()=>f,i.serviceRegistry.set(f,c),c}},2585:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.IDecorationService=i.IUnicodeService=i.IOscLinkService=i.IOptionsService=i.ILogService=i.LogLevelEnum=i.IInstantiationService=i.ICharsetService=i.ICoreService=i.ICoreMouseService=i.IBufferService=void 0;let h=o(8343);var f;i.IBufferService=(0,h.createDecorator)("BufferService"),i.ICoreMouseService=(0,h.createDecorator)("CoreMouseService"),i.ICoreService=(0,h.createDecorator)("CoreService"),i.ICharsetService=(0,h.createDecorator)("CharsetService"),i.IInstantiationService=(0,h.createDecorator)("InstantiationService"),(function(c){c[c.TRACE=0]="TRACE",c[c.DEBUG=1]="DEBUG",c[c.INFO=2]="INFO",c[c.WARN=3]="WARN",c[c.ERROR=4]="ERROR",c[c.OFF=5]="OFF"})(f||(i.LogLevelEnum=f={})),i.ILogService=(0,h.createDecorator)("LogService"),i.IOptionsService=(0,h.createDecorator)("OptionsService"),i.IOscLinkService=(0,h.createDecorator)("OscLinkService"),i.IUnicodeService=(0,h.createDecorator)("UnicodeService"),i.IDecorationService=(0,h.createDecorator)("DecorationService")},1480:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.UnicodeService=void 0;let h=o(8460),f=o(225);i.UnicodeService=class{constructor(){this._providers=Object.create(null),this._active="",this._onChange=new h.EventEmitter,this.onChange=this._onChange.event;let c=new f.UnicodeV6;this.register(c),this._active=c.version,this._activeProvider=c}dispose(){this._onChange.dispose()}get versions(){return Object.keys(this._providers)}get activeVersion(){return this._active}set activeVersion(c){if(!this._providers[c])throw new Error(`unknown Unicode version "${c}"`);this._active=c,this._activeProvider=this._providers[c],this._onChange.fire(c)}register(c){this._providers[c.version]=c}wcwidth(c){return this._activeProvider.wcwidth(c)}getStringCellWidth(c){let p=0,v=c.length;for(let S=0;S<v;++S){let g=c.charCodeAt(S);if(55296<=g&&g<=56319){if(++S>=v)return p+this.wcwidth(g);let s=c.charCodeAt(S);56320<=s&&s<=57343?g=1024*(g-55296)+s-56320+65536:p+=this.wcwidth(s)}p+=this.wcwidth(g)}return p}}}},t={};function r(u){var i=t[u];if(i!==void 0)return i.exports;var o=t[u]={exports:{}};return e[u].call(o.exports,o,o.exports,r),o.exports}var d={};return(()=>{var u=d;Object.defineProperty(u,"__esModule",{value:!0}),u.Terminal=void 0;let i=r(9042),o=r(3236),h=r(844),f=r(5741),c=r(8285),p=r(7975),v=r(7090),S=["cols","rows"];class g extends h.Disposable{constructor(a){super(),this._core=this.register(new o.Terminal(a)),this._addonManager=this.register(new f.AddonManager),this._publicOptions=Object.assign({},this._core.options);let n=_=>this._core.options[_],l=(_,b)=>{this._checkReadonlyOptions(_),this._core.options[_]=b};for(let _ in this._core.options){let b={get:n.bind(this,_),set:l.bind(this,_)};Object.defineProperty(this._publicOptions,_,b)}}_checkReadonlyOptions(a){if(S.includes(a))throw new Error(`Option "${a}" can only be set in the constructor`)}_checkProposedApi(){if(!this._core.optionsService.rawOptions.allowProposedApi)throw new Error("You must set the allowProposedApi option to true to use proposed API")}get onBell(){return this._core.onBell}get onBinary(){return this._core.onBinary}get onCursorMove(){return this._core.onCursorMove}get onData(){return this._core.onData}get onKey(){return this._core.onKey}get onLineFeed(){return this._core.onLineFeed}get onRender(){return this._core.onRender}get onResize(){return this._core.onResize}get onScroll(){return this._core.onScroll}get onSelectionChange(){return this._core.onSelectionChange}get onTitleChange(){return this._core.onTitleChange}get onWriteParsed(){return this._core.onWriteParsed}get element(){return this._core.element}get parser(){return this._parser||(this._parser=new p.ParserApi(this._core)),this._parser}get unicode(){return this._checkProposedApi(),new v.UnicodeApi(this._core)}get textarea(){return this._core.textarea}get rows(){return this._core.rows}get cols(){return this._core.cols}get buffer(){return this._buffer||(this._buffer=this.register(new c.BufferNamespaceApi(this._core))),this._buffer}get markers(){return this._checkProposedApi(),this._core.markers}get modes(){let a=this._core.coreService.decPrivateModes,n="none";switch(this._core.coreMouseService.activeProtocol){case"X10":n="x10";break;case"VT200":n="vt200";break;case"DRAG":n="drag";break;case"ANY":n="any"}return{applicationCursorKeysMode:a.applicationCursorKeys,applicationKeypadMode:a.applicationKeypad,bracketedPasteMode:a.bracketedPasteMode,insertMode:this._core.coreService.modes.insertMode,mouseTrackingMode:n,originMode:a.origin,reverseWraparoundMode:a.reverseWraparound,sendFocusMode:a.sendFocus,wraparoundMode:a.wraparound}}get options(){return this._publicOptions}set options(a){for(let n in a)this._publicOptions[n]=a[n]}blur(){this._core.blur()}focus(){this._core.focus()}resize(a,n){this._verifyIntegers(a,n),this._core.resize(a,n)}open(a){this._core.open(a)}attachCustomKeyEventHandler(a){this._core.attachCustomKeyEventHandler(a)}registerLinkProvider(a){return this._core.registerLinkProvider(a)}registerCharacterJoiner(a){return this._checkProposedApi(),this._core.registerCharacterJoiner(a)}deregisterCharacterJoiner(a){this._checkProposedApi(),this._core.deregisterCharacterJoiner(a)}registerMarker(a=0){return this._verifyIntegers(a),this._core.registerMarker(a)}registerDecoration(a){var n,l,_;return this._checkProposedApi(),this._verifyPositiveIntegers((n=a.x)!==null&&n!==void 0?n:0,(l=a.width)!==null&&l!==void 0?l:0,(_=a.height)!==null&&_!==void 0?_:0),this._core.registerDecoration(a)}hasSelection(){return this._core.hasSelection()}select(a,n,l){this._verifyIntegers(a,n,l),this._core.select(a,n,l)}getSelection(){return this._core.getSelection()}getSelectionPosition(){return this._core.getSelectionPosition()}clearSelection(){this._core.clearSelection()}selectAll(){this._core.selectAll()}selectLines(a,n){this._verifyIntegers(a,n),this._core.selectLines(a,n)}dispose(){super.dispose()}scrollLines(a){this._verifyIntegers(a),this._core.scrollLines(a)}scrollPages(a){this._verifyIntegers(a),this._core.scrollPages(a)}scrollToTop(){this._core.scrollToTop()}scrollToBottom(){this._core.scrollToBottom()}scrollToLine(a){this._verifyIntegers(a),this._core.scrollToLine(a)}clear(){this._core.clear()}write(a,n){this._core.write(a,n)}writeln(a,n){this._core.write(a),this._core.write(`\r
`,n)}paste(a){this._core.paste(a)}refresh(a,n){this._verifyIntegers(a,n),this._core.refresh(a,n)}reset(){this._core.reset()}clearTextureAtlas(){this._core.clearTextureAtlas()}loadAddon(a){this._addonManager.loadAddon(this,a)}static get strings(){return i}_verifyIntegers(...a){for(let n of a)if(n===1/0||isNaN(n)||n%1!=0)throw new Error("This API only accepts integers")}_verifyPositiveIntegers(...a){for(let n of a)if(n&&(n===1/0||isNaN(n)||n%1!=0||n<0))throw new Error("This API only accepts positive integers")}}u.Terminal=g})(),d})()))});var Xr={};Cr(Xr,{FitAddon:()=>xa});var wa,Ca,xa,Yr=wr(()=>{wa=2,Ca=1,xa=class{activate(e){this._terminal=e}dispose(){}fit(){let e=this.proposeDimensions();if(!e||!this._terminal||isNaN(e.cols)||isNaN(e.rows))return;let t=this._terminal._core;(this._terminal.rows!==e.rows||this._terminal.cols!==e.cols)&&(t._renderService.clear(),this._terminal.resize(e.cols,e.rows))}proposeDimensions(){if(!this._terminal||!this._terminal.element||!this._terminal.element.parentElement)return;let e=this._terminal._core._renderService.dimensions;if(e.css.cell.width===0||e.css.cell.height===0)return;let t=this._terminal.options.scrollback===0?0:this._terminal.options.overviewRuler?.width||14,r=window.getComputedStyle(this._terminal.element.parentElement),d=parseInt(r.getPropertyValue("height")),u=Math.max(0,parseInt(r.getPropertyValue("width"))),i=window.getComputedStyle(this._terminal.element),o={top:parseInt(i.getPropertyValue("padding-top")),bottom:parseInt(i.getPropertyValue("padding-bottom")),right:parseInt(i.getPropertyValue("padding-right")),left:parseInt(i.getPropertyValue("padding-left"))},h=o.top+o.bottom,f=o.right+o.left,c=d-h,p=u-f-t;return{cols:Math.max(wa,Math.floor(p/e.css.cell.width)),rows:Math.max(Ca,Math.floor(c/e.css.cell.height))}}}});var wo={};Cr(wo,{SearchAddon:()=>yl});function Bs(e){La(e)||ka.onUnexpectedError(e)}function La(e){return e instanceof Aa?!0:e instanceof Error&&e.name===$s&&e.message===$s}function Da(e,t,r=0,d=e.length){let u=r,i=d;for(;u<i;){let o=Math.floor((u+i)/2);t(e[o])?u=o+1:i=o}return u-1}function Ta(e,t){return(r,d)=>t(e(r),e(d))}function Ma(e,t){let r=Object.create(null);for(let d of e){let u=t(d),i=r[u];i||(i=r[u]=[]),i.push(d)}return r}function Pa(e,t){let r=this,d=!1,u;return function(){if(d)return u;if(d=!0,t)try{u=e.apply(r,arguments)}finally{t()}else u=e.apply(r,arguments);return u}}function Ha(e){Bt=e}function ji(e){return Bt?.trackDisposable(e),e}function Vi(e){Bt?.markAsDisposed(e)}function hi(e,t){Bt?.setParent(e,t)}function Fa(e,t){if(Bt)for(let r of e)Bt.setParent(r,t)}function ci(e){if(lo.is(e)){let t=[];for(let r of e)if(r)try{r.dispose()}catch(d){t.push(d)}if(t.length===1)throw t[0];if(t.length>1)throw new AggregateError(t,"Encountered errors while disposing of store");return Array.isArray(e)?[]:e}else if(e)return e.dispose(),e}function ho(...e){let t=Pt(()=>ci(e));return Fa(e,t),t}function Pt(e){let t=ji({dispose:Pa(()=>{Vi(t),e()})});return t}function So(e,t=0,r){let d=setTimeout(()=>{e(),r&&u.dispose()},t),u=Pt(()=>{clearTimeout(d),r?.deleteAndLeak(u)});return r?.add(u),u}var Ea,ka,$s,Aa,Jr,Ra,ao,Oa,Zr,Qr,eo,$d,Ba,lo,Ia,Bt,$a,uo,qs,ze,Ui,to,za,Na,Wa,io,Ua,Ks,Ns,ja,so,_o,Va,Us,qa,Ka,Ga,Fi,Xa,Ya,zi,Fe,Ja,vo,Za,Qa,Mt,js,Vs,Ni,el,tl,bo,il,sl,rl,ol,Hi,Wi,ro,nl,qe,Ke,Le,yo,al,Ps,ll,Hd,Ne,nt,cl,hl,dl,ul,Fd,zd,Nd,Wd,fl,Is,pl,oo,_l,ml,gl,vl,bl,yl,Co=wr(()=>{Ea=class{constructor(){this.listeners=[],this.unexpectedErrorHandler=function(e){setTimeout(()=>{throw e.stack?Jr.isErrorNoTelemetry(e)?new Jr(e.message+`

`+e.stack):new Error(e.message+`

`+e.stack):e},0)}}addListener(e){return this.listeners.push(e),()=>{this._removeListener(e)}}emit(e){this.listeners.forEach(t=>{t(e)})}_removeListener(e){this.listeners.splice(this.listeners.indexOf(e),1)}setUnexpectedErrorHandler(e){this.unexpectedErrorHandler=e}getUnexpectedErrorHandler(){return this.unexpectedErrorHandler}onUnexpectedError(e){this.unexpectedErrorHandler(e),this.emit(e)}onUnexpectedExternalError(e){this.unexpectedErrorHandler(e)}},ka=new Ea;$s="Canceled";Aa=class extends Error{constructor(){super($s),this.name=this.message}},Jr=class Hs extends Error{constructor(t){super(t),this.name="CodeExpectedError"}static fromError(t){if(t instanceof Hs)return t;let r=new Hs;return r.message=t.message,r.stack=t.stack,r}static isErrorNoTelemetry(t){return t.name==="CodeExpectedError"}};Ra=class no{constructor(t){this._array=t,this._findLastMonotonousLastIdx=0}findLastMonotonous(t){if(no.assertInvariants){if(this._prevFindLastPredicate){for(let d of this._array)if(this._prevFindLastPredicate(d)&&!t(d))throw new Error("MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.")}this._prevFindLastPredicate=t}let r=Da(this._array,t,this._findLastMonotonousLastIdx);return this._findLastMonotonousLastIdx=r+1,r===-1?void 0:this._array[r]}};Ra.assertInvariants=!1;(e=>{function t(i){return i<0}e.isLessThan=t;function r(i){return i<=0}e.isLessThanOrEqual=r;function d(i){return i>0}e.isGreaterThan=d;function u(i){return i===0}e.isNeitherLessOrGreaterThan=u,e.greaterThan=1,e.lessThan=-1,e.neitherLessOrGreaterThan=0})(ao||(ao={}));Oa=(e,t)=>e-t,Zr=class Fs{constructor(t){this.iterate=t}forEach(t){this.iterate(r=>(t(r),!0))}toArray(){let t=[];return this.iterate(r=>(t.push(r),!0)),t}filter(t){return new Fs(r=>this.iterate(d=>t(d)?r(d):!0))}map(t){return new Fs(r=>this.iterate(d=>r(t(d))))}some(t){let r=!1;return this.iterate(d=>(r=t(d),!r)),r}findFirst(t){let r;return this.iterate(d=>t(d)?(r=d,!1):!0),r}findLast(t){let r;return this.iterate(d=>(t(d)&&(r=d),!0)),r}findLastMaxBy(t){let r,d=!0;return this.iterate(u=>((d||ao.isGreaterThan(t(u,r)))&&(d=!1,r=u),!0)),r}};Zr.empty=new Zr(e=>{});$d=class{constructor(e,t){this.toKey=t,this._map=new Map,this[Qr]="SetWithKey";for(let r of e)this.add(r)}get size(){return this._map.size}add(e){let t=this.toKey(e);return this._map.set(t,e),this}delete(e){return this._map.delete(this.toKey(e))}has(e){return this._map.has(this.toKey(e))}*entries(){for(let e of this._map.values())yield[e,e]}keys(){return this.values()}*values(){for(let e of this._map.values())yield e}clear(){this._map.clear()}forEach(e,t){this._map.forEach(r=>e.call(t,r,r,this))}[(eo=Symbol.iterator,Qr=Symbol.toStringTag,eo)](){return this.values()}},Ba=class{constructor(){this.map=new Map}add(e,t){let r=this.map.get(e);r||(r=new Set,this.map.set(e,r)),r.add(t)}delete(e,t){let r=this.map.get(e);r&&(r.delete(t),r.size===0&&this.map.delete(e))}forEach(e,t){let r=this.map.get(e);r&&r.forEach(t)}get(e){return this.map.get(e)||new Set}};(e=>{function t(y){return y&&typeof y=="object"&&typeof y[Symbol.iterator]=="function"}e.is=t;let r=Object.freeze([]);function d(){return r}e.empty=d;function*u(y){yield y}e.single=u;function i(y){return t(y)?y:u(y)}e.wrap=i;function o(y){return y||r}e.from=o;function*h(y){for(let x=y.length-1;x>=0;x--)yield y[x]}e.reverse=h;function f(y){return!y||y[Symbol.iterator]().next().done===!0}e.isEmpty=f;function c(y){return y[Symbol.iterator]().next().value}e.first=c;function p(y,x){let m=0;for(let w of y)if(x(w,m++))return!0;return!1}e.some=p;function v(y,x){for(let m of y)if(x(m))return m}e.find=v;function*S(y,x){for(let m of y)x(m)&&(yield m)}e.filter=S;function*g(y,x){let m=0;for(let w of y)yield x(w,m++)}e.map=g;function*s(y,x){let m=0;for(let w of y)yield*x(w,m++)}e.flatMap=s;function*a(...y){for(let x of y)yield*x}e.concat=a;function n(y,x,m){let w=m;for(let A of y)w=x(w,A);return w}e.reduce=n;function*l(y,x,m=y.length){for(x<0&&(x+=y.length),m<0?m+=y.length:m>y.length&&(m=y.length);x<m;x++)yield y[x]}e.slice=l;function _(y,x=Number.POSITIVE_INFINITY){let m=[];if(x===0)return[m,y];let w=y[Symbol.iterator]();for(let A=0;A<x;A++){let T=w.next();if(T.done)return[m,e.empty()];m.push(T.value)}return[m,{[Symbol.iterator](){return w}}]}e.consume=_;async function b(y){let x=[];for await(let m of y)x.push(m);return Promise.resolve(x)}e.asyncToArray=b})(lo||(lo={}));Ia=!1,Bt=null,$a=class co{constructor(){this.livingDisposables=new Map}getDisposableData(t){let r=this.livingDisposables.get(t);return r||(r={parent:null,source:null,isSingleton:!1,value:t,idx:co.idx++},this.livingDisposables.set(t,r)),r}trackDisposable(t){let r=this.getDisposableData(t);r.source||(r.source=new Error().stack)}setParent(t,r){let d=this.getDisposableData(t);d.parent=r}markAsDisposed(t){this.livingDisposables.delete(t)}markAsSingleton(t){this.getDisposableData(t).isSingleton=!0}getRootParent(t,r){let d=r.get(t);if(d)return d;let u=t.parent?this.getRootParent(this.getDisposableData(t.parent),r):t;return r.set(t,u),u}getTrackedDisposables(){let t=new Map;return[...this.livingDisposables.entries()].filter(([,r])=>r.source!==null&&!this.getRootParent(r,t).isSingleton).flatMap(([r])=>r)}computeLeakingDisposables(t=10,r){let d;if(r)d=r;else{let f=new Map,c=[...this.livingDisposables.values()].filter(v=>v.source!==null&&!this.getRootParent(v,f).isSingleton);if(c.length===0)return;let p=new Set(c.map(v=>v.value));if(d=c.filter(v=>!(v.parent&&p.has(v.parent))),d.length===0)throw new Error("There are cyclic diposable chains!")}if(!d)return;function u(f){function c(v,S){for(;v.length>0&&S.some(g=>typeof g=="string"?g===v[0]:v[0].match(g));)v.shift()}let p=f.source.split(`
`).map(v=>v.trim().replace("at ","")).filter(v=>v!=="");return c(p,["Error",/^trackDisposable \(.*\)$/,/^DisposableTracker.trackDisposable \(.*\)$/]),p.reverse()}let i=new Ba;for(let f of d){let c=u(f);for(let p=0;p<=c.length;p++)i.add(c.slice(0,p).join(`
`),f)}d.sort(Ta(f=>f.idx,Oa));let o="",h=0;for(let f of d.slice(0,t)){h++;let c=u(f),p=[];for(let v=0;v<c.length;v++){let S=c[v];S=`(shared with ${i.get(c.slice(0,v+1).join(`
`)).size}/${d.length} leaks) at ${S}`;let g=i.get(c.slice(0,v).join(`
`)),s=Ma([...g].map(a=>u(a)[v]),a=>a);delete s[c[v]];for(let[a,n]of Object.entries(s))p.unshift(`    - stacktraces of ${n.length} other leaks continue with ${a}`);p.unshift(S)}o+=`


==================== Leaking disposable ${h}/${d.length}: ${f.value.constructor.name} ====================
${p.join(`
`)}
============================================================

`}return d.length>t&&(o+=`


... and ${d.length-t} more leaking disposables

`),{leaks:d,details:o}}};$a.idx=0;if(Ia){let e="__is_disposable_tracked__";Ha(new class{trackDisposable(t){let r=new Error("Potentially leaked disposable").stack;setTimeout(()=>{t[e]||console.log(r)},3e3)}setParent(t,r){if(t&&t!==ze.None)try{t[e]=!0}catch{}}markAsDisposed(t){if(t&&t!==ze.None)try{t[e]=!0}catch{}}markAsSingleton(t){}})}uo=class fo{constructor(){this._toDispose=new Set,this._isDisposed=!1,ji(this)}dispose(){this._isDisposed||(Vi(this),this._isDisposed=!0,this.clear())}get isDisposed(){return this._isDisposed}clear(){if(this._toDispose.size!==0)try{ci(this._toDispose)}finally{this._toDispose.clear()}}add(t){if(!t)return t;if(t===this)throw new Error("Cannot register a disposable on itself!");return hi(t,this),this._isDisposed?fo.DISABLE_DISPOSED_WARNING||console.warn(new Error("Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!").stack):this._toDispose.add(t),t}delete(t){if(t){if(t===this)throw new Error("Cannot dispose a disposable on itself!");this._toDispose.delete(t),t.dispose()}}deleteAndLeak(t){t&&this._toDispose.has(t)&&(this._toDispose.delete(t),hi(t,null))}};uo.DISABLE_DISPOSED_WARNING=!1;qs=uo,ze=class{constructor(){this._store=new qs,ji(this),hi(this._store,this)}dispose(){Vi(this),this._store.dispose()}_register(e){if(e===this)throw new Error("Cannot register a disposable on itself!");return this._store.add(e)}};ze.None=Object.freeze({dispose(){}});Ui=class{constructor(){this._isDisposed=!1,ji(this)}get value(){return this._isDisposed?void 0:this._value}set value(e){this._isDisposed||e===this._value||(this._value?.dispose(),e&&hi(e,this),this._value=e)}clear(){this.value=void 0}dispose(){this._isDisposed=!0,Vi(this),this._value?.dispose(),this._value=void 0}clearAndLeak(){let e=this._value;return this._value=void 0,e&&hi(e,null),e}},to=class zs{constructor(t){this.element=t,this.next=zs.Undefined,this.prev=zs.Undefined}};to.Undefined=new to(void 0);za=globalThis.performance&&typeof globalThis.performance.now=="function",Na=class po{static create(t){return new po(t)}constructor(t){this._now=za&&t===!1?Date.now:globalThis.performance.now.bind(globalThis.performance),this._startTime=this._now(),this._stopTime=-1}stop(){this._stopTime=this._now()}reset(){this._startTime=this._now(),this._stopTime=-1}elapsed(){return this._stopTime!==-1?this._stopTime-this._startTime:this._now()-this._startTime}},Wa=!1,io=!1,Ua=!1;(e=>{e.None=()=>ze.None;function t(P){if(Ua){let{onDidAddListener:M}=P,I=Us.create(),C=0;P.onDidAddListener=()=>{++C===2&&(console.warn("snapshotted emitter LIKELY used public and SHOULD HAVE BEEN created with DisposableStore. snapshotted here"),I.print()),M?.()}}}function r(P,M){return S(P,()=>{},0,void 0,!0,void 0,M)}e.defer=r;function d(P){return(M,I=null,C)=>{let k=!1,L;return L=P(R=>{if(!k)return L?L.dispose():k=!0,M.call(I,R)},null,C),k&&L.dispose(),L}}e.once=d;function u(P,M,I){return p((C,k=null,L)=>P(R=>C.call(k,M(R)),null,L),I)}e.map=u;function i(P,M,I){return p((C,k=null,L)=>P(R=>{M(R),C.call(k,R)},null,L),I)}e.forEach=i;function o(P,M,I){return p((C,k=null,L)=>P(R=>M(R)&&C.call(k,R),null,L),I)}e.filter=o;function h(P){return P}e.signal=h;function f(...P){return(M,I=null,C)=>{let k=ho(...P.map(L=>L(R=>M.call(I,R))));return v(k,C)}}e.any=f;function c(P,M,I,C){let k=I;return u(P,L=>(k=M(k,L),k),C)}e.reduce=c;function p(P,M){let I,C={onWillAddFirstListener(){I=P(k.fire,k)},onDidRemoveLastListener(){I?.dispose()}};M||t(C);let k=new Fe(C);return M?.add(k),k.event}function v(P,M){return M instanceof Array?M.push(P):M&&M.add(P),P}function S(P,M,I=100,C=!1,k=!1,L,R){let z,U,K,q=0,te,E={leakWarningThreshold:L,onWillAddFirstListener(){z=P(W=>{q++,U=M(U,W),C&&!K&&($.fire(U),U=void 0),te=()=>{let N=U;U=void 0,K=void 0,(!C||q>1)&&$.fire(N),q=0},typeof I=="number"?(clearTimeout(K),K=setTimeout(te,I)):K===void 0&&(K=0,queueMicrotask(te))})},onWillRemoveListener(){k&&q>0&&te?.()},onDidRemoveLastListener(){te=void 0,z.dispose()}};R||t(E);let $=new Fe(E);return R?.add($),$.event}e.debounce=S;function g(P,M=0,I){return e.debounce(P,(C,k)=>C?(C.push(k),C):[k],M,void 0,!0,void 0,I)}e.accumulate=g;function s(P,M=(C,k)=>C===k,I){let C=!0,k;return o(P,L=>{let R=C||!M(L,k);return C=!1,k=L,R},I)}e.latch=s;function a(P,M,I){return[e.filter(P,M,I),e.filter(P,C=>!M(C),I)]}e.split=a;function n(P,M=!1,I=[],C){let k=I.slice(),L=P(U=>{k?k.push(U):z.fire(U)});C&&C.add(L);let R=()=>{k?.forEach(U=>z.fire(U)),k=null},z=new Fe({onWillAddFirstListener(){L||(L=P(U=>z.fire(U)),C&&C.add(L))},onDidAddFirstListener(){k&&(M?setTimeout(R):R())},onDidRemoveLastListener(){L&&L.dispose(),L=null}});return C&&C.add(z),z.event}e.buffer=n;function l(P,M){return(I,C,k)=>{let L=M(new b);return P(function(R){let z=L.evaluate(R);z!==_&&I.call(C,z)},void 0,k)}}e.chain=l;let _=Symbol("HaltChainable");class b{constructor(){this.steps=[]}map(M){return this.steps.push(M),this}forEach(M){return this.steps.push(I=>(M(I),I)),this}filter(M){return this.steps.push(I=>M(I)?I:_),this}reduce(M,I){let C=I;return this.steps.push(k=>(C=M(C,k),C)),this}latch(M=(I,C)=>I===C){let I=!0,C;return this.steps.push(k=>{let L=I||!M(k,C);return I=!1,C=k,L?k:_}),this}evaluate(M){for(let I of this.steps)if(M=I(M),M===_)break;return M}}function y(P,M,I=C=>C){let C=(...z)=>R.fire(I(...z)),k=()=>P.on(M,C),L=()=>P.removeListener(M,C),R=new Fe({onWillAddFirstListener:k,onDidRemoveLastListener:L});return R.event}e.fromNodeEventEmitter=y;function x(P,M,I=C=>C){let C=(...z)=>R.fire(I(...z)),k=()=>P.addEventListener(M,C),L=()=>P.removeEventListener(M,C),R=new Fe({onWillAddFirstListener:k,onDidRemoveLastListener:L});return R.event}e.fromDOMEventEmitter=x;function m(P){return new Promise(M=>d(P)(M))}e.toPromise=m;function w(P){let M=new Fe;return P.then(I=>{M.fire(I)},()=>{M.fire(void 0)}).finally(()=>{M.dispose()}),M.event}e.fromPromise=w;function A(P,M){return P(I=>M.fire(I))}e.forward=A;function T(P,M,I){return M(I),P(C=>M(C))}e.runAndSubscribe=T;class D{constructor(M,I){this._observable=M,this._counter=0,this._hasChanged=!1;let C={onWillAddFirstListener:()=>{M.addObserver(this)},onDidRemoveLastListener:()=>{M.removeObserver(this)}};I||t(C),this.emitter=new Fe(C),I&&I.add(this.emitter)}beginUpdate(M){this._counter++}handlePossibleChange(M){}handleChange(M,I){this._hasChanged=!0}endUpdate(M){this._counter--,this._counter===0&&(this._observable.reportChanges(),this._hasChanged&&(this._hasChanged=!1,this.emitter.fire(this._observable.get())))}}function O(P,M){return new D(P,M).emitter.event}e.fromObservable=O;function F(P){return(M,I,C)=>{let k=0,L=!1,R={beginUpdate(){k++},endUpdate(){k--,k===0&&(P.reportChanges(),L&&(L=!1,M.call(I)))},handlePossibleChange(){},handleChange(){L=!0}};P.addObserver(R),P.reportChanges();let z={dispose(){P.removeObserver(R)}};return C instanceof qs?C.add(z):Array.isArray(C)&&C.push(z),z}}e.fromObservableLight=F})(Ks||(Ks={}));Ns=class Ws{constructor(t){this.listenerCount=0,this.invocationCount=0,this.elapsedOverall=0,this.durations=[],this.name=`${t}_${Ws._idPool++}`,Ws.all.add(this)}start(t){this._stopWatch=new Na,this.listenerCount=t}stop(){if(this._stopWatch){let t=this._stopWatch.elapsed();this.durations.push(t),this.elapsedOverall+=t,this.invocationCount+=1,this._stopWatch=void 0}}};Ns.all=new Set,Ns._idPool=0;ja=Ns,so=-1,_o=class mo{constructor(t,r,d=(mo._idPool++).toString(16).padStart(3,"0")){this._errorHandler=t,this.threshold=r,this.name=d,this._warnCountdown=0}dispose(){this._stacks?.clear()}check(t,r){let d=this.threshold;if(d<=0||r<d)return;this._stacks||(this._stacks=new Map);let u=this._stacks.get(t.value)||0;if(this._stacks.set(t.value,u+1),this._warnCountdown-=1,this._warnCountdown<=0){this._warnCountdown=d*.5;let[i,o]=this.getMostFrequentStack(),h=`[${this.name}] potential listener LEAK detected, having ${r} listeners already. MOST frequent listener (${o}):`;console.warn(h),console.warn(i);let f=new qa(h,i);this._errorHandler(f)}return()=>{let i=this._stacks.get(t.value)||0;this._stacks.set(t.value,i-1)}}getMostFrequentStack(){if(!this._stacks)return;let t,r=0;for(let[d,u]of this._stacks)(!t||r<u)&&(t=[d,u],r=u);return t}};_o._idPool=1;Va=_o,Us=class go{constructor(t){this.value=t}static create(){let t=new Error;return new go(t.stack??"")}print(){console.warn(this.value.split(`
`).slice(2).join(`
`))}},qa=class extends Error{constructor(e,t){super(e),this.name="ListenerLeakError",this.stack=t}},Ka=class extends Error{constructor(e,t){super(e),this.name="ListenerRefusalError",this.stack=t}},Ga=0,Fi=class{constructor(e){this.value=e,this.id=Ga++}},Xa=2,Ya=(e,t)=>{if(e instanceof Fi)t(e);else for(let r=0;r<e.length;r++){let d=e[r];d&&t(d)}};if(Wa){let e=[];setInterval(()=>{e.length!==0&&(console.warn("[LEAKING LISTENERS] GC'ed these listeners that were NOT yet disposed:"),console.warn(e.join(`
`)),e.length=0)},3e3),zi=new FinalizationRegistry(t=>{typeof t=="string"&&e.push(t)})}Fe=class{constructor(e){this._size=0,this._options=e,this._leakageMon=so>0||this._options?.leakWarningThreshold?new Va(e?.onListenerError??Bs,this._options?.leakWarningThreshold??so):void 0,this._perfMon=this._options?._profName?new ja(this._options._profName):void 0,this._deliveryQueue=this._options?.deliveryQueue}dispose(){if(!this._disposed){if(this._disposed=!0,this._deliveryQueue?.current===this&&this._deliveryQueue.reset(),this._listeners){if(io){let e=this._listeners;queueMicrotask(()=>{Ya(e,t=>t.stack?.print())})}this._listeners=void 0,this._size=0}this._options?.onDidRemoveLastListener?.(),this._leakageMon?.dispose()}}get event(){return this._event??(this._event=(e,t,r)=>{if(this._leakageMon&&this._size>this._leakageMon.threshold**2){let h=`[${this._leakageMon.name}] REFUSES to accept new listeners because it exceeded its threshold by far (${this._size} vs ${this._leakageMon.threshold})`;console.warn(h);let f=this._leakageMon.getMostFrequentStack()??["UNKNOWN stack",-1],c=new Ka(`${h}. HINT: Stack shows most frequent listener (${f[1]}-times)`,f[0]);return(this._options?.onListenerError||Bs)(c),ze.None}if(this._disposed)return ze.None;t&&(e=e.bind(t));let d=new Fi(e),u,i;this._leakageMon&&this._size>=Math.ceil(this._leakageMon.threshold*.2)&&(d.stack=Us.create(),u=this._leakageMon.check(d.stack,this._size+1)),io&&(d.stack=i??Us.create()),this._listeners?this._listeners instanceof Fi?(this._deliveryQueue??(this._deliveryQueue=new Ja),this._listeners=[this._listeners,d]):this._listeners.push(d):(this._options?.onWillAddFirstListener?.(this),this._listeners=d,this._options?.onDidAddFirstListener?.(this)),this._size++;let o=Pt(()=>{zi?.unregister(o),u?.(),this._removeListener(d)});if(r instanceof qs?r.add(o):Array.isArray(r)&&r.push(o),zi){let h=new Error().stack.split(`
`).slice(2,3).join(`
`).trim(),f=/(file:|vscode-file:\/\/vscode-app)?(\/[^:]*:\d+:\d+)/.exec(h);zi.register(o,f?.[2]??h,o)}return o}),this._event}_removeListener(e){if(this._options?.onWillRemoveListener?.(this),!this._listeners)return;if(this._size===1){this._listeners=void 0,this._options?.onDidRemoveLastListener?.(this),this._size=0;return}let t=this._listeners,r=t.indexOf(e);if(r===-1)throw console.log("disposed?",this._disposed),console.log("size?",this._size),console.log("arr?",JSON.stringify(this._listeners)),new Error("Attempted to dispose unknown listener");this._size--,t[r]=void 0;let d=this._deliveryQueue.current===this;if(this._size*Xa<=t.length){let u=0;for(let i=0;i<t.length;i++)t[i]?t[u++]=t[i]:d&&(this._deliveryQueue.end--,u<this._deliveryQueue.i&&this._deliveryQueue.i--);t.length=u}}_deliver(e,t){if(!e)return;let r=this._options?.onListenerError||Bs;if(!r){e.value(t);return}try{e.value(t)}catch(d){r(d)}}_deliverQueue(e){let t=e.current._listeners;for(;e.i<e.end;)this._deliver(t[e.i++],e.value);e.reset()}fire(e){if(this._deliveryQueue?.current&&(this._deliverQueue(this._deliveryQueue),this._perfMon?.stop()),this._perfMon?.start(this._size),this._listeners)if(this._listeners instanceof Fi)this._deliver(this._listeners,e);else{let t=this._deliveryQueue;t.enqueue(this,e,this._listeners.length),this._deliverQueue(t)}this._perfMon?.stop()}hasListeners(){return this._size>0}},Ja=class{constructor(){this.i=-1,this.end=0}enqueue(e,t,r){this.i=0,this.end=r,this.current=e,this.value=t}reset(){this.i=this.end,this.current=void 0,this.value=void 0}},vo=Object.freeze(function(e,t){let r=setTimeout(e.bind(t),0);return{dispose(){clearTimeout(r)}}});(e=>{function t(r){return r===e.None||r===e.Cancelled||r instanceof Qa?!0:!r||typeof r!="object"?!1:typeof r.isCancellationRequested=="boolean"&&typeof r.onCancellationRequested=="function"}e.isCancellationToken=t,e.None=Object.freeze({isCancellationRequested:!1,onCancellationRequested:Ks.None}),e.Cancelled=Object.freeze({isCancellationRequested:!0,onCancellationRequested:vo})})(Za||(Za={}));Qa=class{constructor(){this._isCancelled=!1,this._emitter=null}cancel(){this._isCancelled||(this._isCancelled=!0,this._emitter&&(this._emitter.fire(void 0),this.dispose()))}get isCancellationRequested(){return this._isCancelled}get onCancellationRequested(){return this._isCancelled?vo:(this._emitter||(this._emitter=new Fe),this._emitter.event)}dispose(){this._emitter&&(this._emitter.dispose(),this._emitter=null)}},Mt="en",js=!1,Vs=!1,Ni=!1,el=!1,tl=!1,bo=!1,il=!1,sl=!1,rl=!1,ol=!1,Wi=Mt,ro=Mt,Ke=globalThis;typeof Ke.vscode<"u"&&typeof Ke.vscode.process<"u"?Le=Ke.vscode.process:typeof process<"u"&&typeof process?.versions?.node=="string"&&(Le=process);yo=typeof Le?.versions?.electron=="string",al=yo&&Le?.type==="renderer";if(typeof Le=="object"){js=Le.platform==="win32",Vs=Le.platform==="darwin",Ni=Le.platform==="linux",el=Ni&&!!Le.env.SNAP&&!!Le.env.SNAP_REVISION,il=yo,rl=!!Le.env.CI||!!Le.env.BUILD_ARTIFACTSTAGINGDIRECTORY,Hi=Mt,Wi=Mt;let e=Le.env.VSCODE_NLS_CONFIG;if(e)try{let t=JSON.parse(e);Hi=t.userLocale,ro=t.osLocale,Wi=t.resolvedLanguage||Mt,nl=t.languagePack?.translationsConfigFile}catch{}tl=!0}else typeof navigator=="object"&&!al?(qe=navigator.userAgent,js=qe.indexOf("Windows")>=0,Vs=qe.indexOf("Macintosh")>=0,sl=(qe.indexOf("Macintosh")>=0||qe.indexOf("iPad")>=0||qe.indexOf("iPhone")>=0)&&!!navigator.maxTouchPoints&&navigator.maxTouchPoints>0,Ni=qe.indexOf("Linux")>=0,ol=qe?.indexOf("Mobi")>=0,bo=!0,Wi=globalThis._VSCODE_NLS_LANGUAGE||Mt,Hi=navigator.language.toLowerCase(),ro=Hi):console.error("Unable to resolve platform.");Ps=0;Vs?Ps=1:js?Ps=3:Ni&&(Ps=2);ll=bo&&typeof Ke.importScripts=="function",Hd=ll?Ke.origin:void 0,Ne=qe,nt=Wi;(e=>{function t(){return nt}e.value=t;function r(){return nt.length===2?nt==="en":nt.length>=3?nt[0]==="e"&&nt[1]==="n"&&nt[2]==="-":!1}e.isDefaultVariant=r;function d(){return nt==="en"}e.isDefault=d})(cl||(cl={}));hl=typeof Ke.postMessage=="function"&&!Ke.importScripts,dl=(()=>{if(hl){let e=[];Ke.addEventListener("message",r=>{if(r.data&&r.data.vscodeScheduleAsyncWork)for(let d=0,u=e.length;d<u;d++){let i=e[d];if(i.id===r.data.vscodeScheduleAsyncWork){e.splice(d,1),i.callback();return}}});let t=0;return r=>{let d=++t;e.push({id:d,callback:r}),Ke.postMessage({vscodeScheduleAsyncWork:d},"*")}}return e=>setTimeout(e)})(),ul=!!(Ne&&Ne.indexOf("Chrome")>=0),Fd=!!(Ne&&Ne.indexOf("Firefox")>=0),zd=!!(!ul&&Ne&&Ne.indexOf("Safari")>=0),Nd=!!(Ne&&Ne.indexOf("Edg/")>=0),Wd=!!(Ne&&Ne.indexOf("Android")>=0);(function(){typeof globalThis.requestIdleCallback!="function"||typeof globalThis.cancelIdleCallback!="function"?Is=(e,t)=>{dl(()=>{if(r)return;let d=Date.now()+15;t(Object.freeze({didTimeout:!0,timeRemaining(){return Math.max(0,d-Date.now())}}))});let r=!1;return{dispose(){r||(r=!0)}}}:Is=(e,t,r)=>{let d=e.requestIdleCallback(t,typeof r=="number"?{timeout:r}:void 0),u=!1;return{dispose(){u||(u=!0,e.cancelIdleCallback(d))}}},fl=e=>Is(globalThis,e)})();(e=>{async function t(d){let u,i=await Promise.all(d.map(o=>o.then(h=>h,h=>{u||(u=h)})));if(typeof u<"u")throw u;return i}e.settled=t;function r(d){return new Promise(async(u,i)=>{try{await d(u,i)}catch(o){i(o)}})}e.withAsyncBody=r})(pl||(pl={}));oo=class Re{static fromArray(t){return new Re(r=>{r.emitMany(t)})}static fromPromise(t){return new Re(async r=>{r.emitMany(await t)})}static fromPromises(t){return new Re(async r=>{await Promise.all(t.map(async d=>r.emitOne(await d)))})}static merge(t){return new Re(async r=>{await Promise.all(t.map(async d=>{for await(let u of d)r.emitOne(u)}))})}constructor(t,r){this._state=0,this._results=[],this._error=null,this._onReturn=r,this._onStateChanged=new Fe,queueMicrotask(async()=>{let d={emitOne:u=>this.emitOne(u),emitMany:u=>this.emitMany(u),reject:u=>this.reject(u)};try{await Promise.resolve(t(d)),this.resolve()}catch(u){this.reject(u)}finally{d.emitOne=void 0,d.emitMany=void 0,d.reject=void 0}})}[Symbol.asyncIterator](){let t=0;return{next:async()=>{do{if(this._state===2)throw this._error;if(t<this._results.length)return{done:!1,value:this._results[t++]};if(this._state===1)return{done:!0,value:void 0};await Ks.toPromise(this._onStateChanged.event)}while(!0)},return:async()=>(this._onReturn?.(),{done:!0,value:void 0})}}static map(t,r){return new Re(async d=>{for await(let u of t)d.emitOne(r(u))})}map(t){return Re.map(this,t)}static filter(t,r){return new Re(async d=>{for await(let u of t)r(u)&&d.emitOne(u)})}filter(t){return Re.filter(this,t)}static coalesce(t){return Re.filter(t,r=>!!r)}coalesce(){return Re.coalesce(this)}static async toPromise(t){let r=[];for await(let d of t)r.push(d);return r}toPromise(){return Re.toPromise(this)}emitOne(t){this._state===0&&(this._results.push(t),this._onStateChanged.fire())}emitMany(t){this._state===0&&(this._results=this._results.concat(t),this._onStateChanged.fire())}resolve(){this._state===0&&(this._state=1,this._onStateChanged.fire())}reject(t){this._state===0&&(this._state=2,this._error=t,this._onStateChanged.fire())}};oo.EMPTY=oo.fromArray([]);_l=class extends ze{constructor(e){super(),this._terminal=e,this._linesCacheTimeout=this._register(new Ui),this._linesCacheDisposables=this._register(new Ui),this._register(Pt(()=>this._destroyLinesCache()))}initLinesCache(){this._linesCache||(this._linesCache=new Array(this._terminal.buffer.active.length),this._linesCacheDisposables.value=ho(this._terminal.onLineFeed(()=>this._destroyLinesCache()),this._terminal.onCursorMove(()=>this._destroyLinesCache()),this._terminal.onResize(()=>this._destroyLinesCache()))),this._linesCacheTimeout.value=So(()=>this._destroyLinesCache(),15e3)}_destroyLinesCache(){this._linesCache=void 0,this._linesCacheDisposables.clear(),this._linesCacheTimeout.clear()}getLineFromCache(e){return this._linesCache?.[e]}setLineInCache(e,t){this._linesCache&&(this._linesCache[e]=t)}translateBufferLineToStringWithWrap(e,t){let r=[],d=[0],u=this._terminal.buffer.active.getLine(e);for(;u;){let i=this._terminal.buffer.active.getLine(e+1),o=i?i.isWrapped:!1,h=u.translateToString(!o&&t);if(o&&i){let f=u.getCell(u.length-1);f&&f.getCode()===0&&f.getWidth()===1&&i.getCell(0)?.getWidth()===2&&(h=h.slice(0,-1))}if(r.push(h),o)d.push(d[d.length-1]+h.length);else break;e++,u=i}return[r.join(""),d]}},ml=class{get cachedSearchTerm(){return this._cachedSearchTerm}set cachedSearchTerm(e){this._cachedSearchTerm=e}get lastSearchOptions(){return this._lastSearchOptions}set lastSearchOptions(e){this._lastSearchOptions=e}isValidSearchTerm(e){return!!(e&&e.length>0)}didOptionsChange(e){return this._lastSearchOptions?e?this._lastSearchOptions.caseSensitive!==e.caseSensitive||this._lastSearchOptions.regex!==e.regex||this._lastSearchOptions.wholeWord!==e.wholeWord:!1:!0}shouldUpdateHighlighting(e,t){return t?.decorations?this._cachedSearchTerm===void 0||e!==this._cachedSearchTerm||this.didOptionsChange(t):!1}clearCachedTerm(){this._cachedSearchTerm=void 0}reset(){this._cachedSearchTerm=void 0,this._lastSearchOptions=void 0}},gl=class{constructor(e,t){this._terminal=e,this._lineCache=t}find(e,t,r,d){if(!e||e.length===0){this._terminal.clearSelection();return}if(r>this._terminal.cols)throw new Error(`Invalid col: ${r} to search in terminal of ${this._terminal.cols} cols`);this._lineCache.initLinesCache();let u={startRow:t,startCol:r},i=this._findInLine(e,u,d);if(!i)for(let o=t+1;o<this._terminal.buffer.active.baseY+this._terminal.rows&&(u.startRow=o,u.startCol=0,i=this._findInLine(e,u,d),!i);o++);return i}findNextWithSelection(e,t,r){if(!e||e.length===0){this._terminal.clearSelection();return}let d=this._terminal.getSelectionPosition();this._terminal.clearSelection();let u=0,i=0;d&&(r===e?(u=d.end.x,i=d.end.y):(u=d.start.x,i=d.start.y)),this._lineCache.initLinesCache();let o={startRow:i,startCol:u},h=this._findInLine(e,o,t);if(!h)for(let f=i+1;f<this._terminal.buffer.active.baseY+this._terminal.rows&&(o.startRow=f,o.startCol=0,h=this._findInLine(e,o,t),!h);f++);if(!h&&i!==0)for(let f=0;f<i&&(o.startRow=f,o.startCol=0,h=this._findInLine(e,o,t),!h);f++);return!h&&d&&(o.startRow=d.start.y,o.startCol=0,h=this._findInLine(e,o,t)),h}findPreviousWithSelection(e,t,r){if(!e||e.length===0){this._terminal.clearSelection();return}let d=this._terminal.getSelectionPosition();this._terminal.clearSelection();let u=this._terminal.buffer.active.baseY+this._terminal.rows-1,i=this._terminal.cols,o=!0;this._lineCache.initLinesCache();let h={startRow:u,startCol:i},f;if(d&&(h.startRow=u=d.start.y,h.startCol=i=d.start.x,r!==e&&(f=this._findInLine(e,h,t,!1),f||(h.startRow=u=d.end.y,h.startCol=i=d.end.x))),f||(f=this._findInLine(e,h,t,o)),!f){h.startCol=Math.max(h.startCol,this._terminal.cols);for(let c=u-1;c>=0&&(h.startRow=c,f=this._findInLine(e,h,t,o),!f);c--);}if(!f&&u!==this._terminal.buffer.active.baseY+this._terminal.rows-1)for(let c=this._terminal.buffer.active.baseY+this._terminal.rows-1;c>=u&&(h.startRow=c,f=this._findInLine(e,h,t,o),!f);c--);return f}_isWholeWord(e,t,r){return(e===0||" ~!@#$%^&*()+`-=[]{}|\\;:\"',./<>?".includes(t[e-1]))&&(e+r.length===t.length||" ~!@#$%^&*()+`-=[]{}|\\;:\"',./<>?".includes(t[e+r.length]))}_findInLine(e,t,r={},d=!1){let u=t.startRow,i=t.startCol;if(this._terminal.buffer.active.getLine(u)?.isWrapped){if(d){t.startCol+=this._terminal.cols;return}return t.startRow--,t.startCol+=this._terminal.cols,this._findInLine(e,t,r)}let o=this._lineCache.getLineFromCache(u);o||(o=this._lineCache.translateBufferLineToStringWithWrap(u,!0),this._lineCache.setLineInCache(u,o));let[h,f]=o,c=this._bufferColsToStringOffset(u,i),p=e,v=h;r.regex||(p=r.caseSensitive?e:e.toLowerCase(),v=r.caseSensitive?h:h.toLowerCase());let S=-1;if(r.regex){let g=RegExp(p,r.caseSensitive?"g":"gi"),s;if(d)for(;s=g.exec(v.slice(0,c));)S=g.lastIndex-s[0].length,e=s[0],g.lastIndex-=e.length-1;else s=g.exec(v.slice(c)),s&&s[0].length>0&&(S=c+(g.lastIndex-s[0].length),e=s[0])}else d?c-p.length>=0&&(S=v.lastIndexOf(p,c-p.length)):S=v.indexOf(p,c);if(S>=0){if(r.wholeWord&&!this._isWholeWord(S,v,e))return;let g=0;for(;g<f.length-1&&S>=f[g+1];)g++;let s=g;for(;s<f.length-1&&S+e.length>=f[s+1];)s++;let a=S-f[g],n=S+e.length-f[s],l=this._stringLengthToBufferSize(u+g,a),_=this._stringLengthToBufferSize(u+s,n)-l+this._terminal.cols*(s-g);return{term:e,col:l,row:u+g,size:_}}}_stringLengthToBufferSize(e,t){let r=this._terminal.buffer.active.getLine(e);if(!r)return 0;for(let d=0;d<t;d++){let u=r.getCell(d);if(!u)break;let i=u.getChars();i.length>1&&(t-=i.length-1);let o=r.getCell(d+1);o&&o.getWidth()===0&&t++}return t}_bufferColsToStringOffset(e,t){let r=e,d=0,u=this._terminal.buffer.active.getLine(r);for(;t>0&&u;){for(let i=0;i<t&&i<this._terminal.cols;i++){let o=u.getCell(i);if(!o)break;o.getWidth()&&(d+=o.getCode()===0?1:o.getChars().length)}if(r++,u=this._terminal.buffer.active.getLine(r),u&&!u.isWrapped)break;t-=this._terminal.cols}return d}},vl=class extends ze{constructor(e){super(),this._terminal=e,this._highlightDecorations=[],this._highlightedLines=new Set,this._register(Pt(()=>this.clearHighlightDecorations()))}createHighlightDecorations(e,t){this.clearHighlightDecorations();for(let r of e){let d=this._createResultDecorations(r,t,!1);if(d)for(let u of d)this._storeDecoration(u,r)}}createActiveDecoration(e,t){let r=this._createResultDecorations(e,t,!0);if(r)return{decorations:r,match:e,dispose(){ci(r)}}}clearHighlightDecorations(){ci(this._highlightDecorations),this._highlightDecorations=[],this._highlightedLines.clear()}_storeDecoration(e,t){this._highlightedLines.add(e.marker.line),this._highlightDecorations.push({decoration:e,match:t,dispose(){e.dispose()}})}_applyStyles(e,t,r){e.classList.contains("xterm-find-result-decoration")||(e.classList.add("xterm-find-result-decoration"),t&&(e.style.outline=`1px solid ${t}`)),r&&e.classList.add("xterm-find-active-result-decoration")}_createResultDecorations(e,t,r){let d=[],u=e.col,i=e.size,o=-this._terminal.buffer.active.baseY-this._terminal.buffer.active.cursorY+e.row;for(;i>0;){let f=Math.min(this._terminal.cols-u,i);d.push([o,u,f]),u=0,i-=f,o++}let h=[];for(let f of d){let c=this._terminal.registerMarker(f[0]),p=this._terminal.registerDecoration({marker:c,x:f[1],width:f[2],backgroundColor:r?t.activeMatchBackground:t.matchBackground,overviewRulerOptions:this._highlightedLines.has(c.line)?void 0:{color:r?t.activeMatchColorOverviewRuler:t.matchOverviewRuler,position:"center"}});if(p){let v=[];v.push(c),v.push(p.onRender(S=>this._applyStyles(S,r?t.activeMatchBorder:t.matchBorder,!1))),v.push(p.onDispose(()=>ci(v))),h.push(p)}}return h.length===0?void 0:h}},bl=class extends ze{constructor(){super(...arguments),this._searchResults=[],this._onDidChangeResults=this._register(new Fe)}get onDidChangeResults(){return this._onDidChangeResults.event}get searchResults(){return this._searchResults}get selectedDecoration(){return this._selectedDecoration}set selectedDecoration(e){this._selectedDecoration=e}updateResults(e,t){this._searchResults=e.slice(0,t)}clearResults(){this._searchResults=[]}clearSelectedDecoration(){this._selectedDecoration&&(this._selectedDecoration.dispose(),this._selectedDecoration=void 0)}findResultIndex(e){for(let t=0;t<this._searchResults.length;t++){let r=this._searchResults[t];if(r.row===e.row&&r.col===e.col&&r.size===e.size)return t}return-1}fireResultsChanged(e){if(!e)return;let t=-1;this._selectedDecoration&&(t=this.findResultIndex(this._selectedDecoration.match)),this._onDidChangeResults.fire({resultIndex:t,resultCount:this._searchResults.length})}reset(){this.clearSelectedDecoration(),this.clearResults()}},yl=class extends ze{constructor(e){super(),this._highlightTimeout=this._register(new Ui),this._lineCache=this._register(new Ui),this._state=new ml,this._resultTracker=this._register(new bl),this._highlightLimit=e?.highlightLimit??1e3}get onDidChangeResults(){return this._resultTracker.onDidChangeResults}activate(e){this._terminal=e,this._lineCache.value=new _l(e),this._engine=new gl(e,this._lineCache.value),this._decorationManager=new vl(e),this._register(this._terminal.onWriteParsed(()=>this._updateMatches())),this._register(this._terminal.onResize(()=>this._updateMatches())),this._register(Pt(()=>this.clearDecorations()))}_updateMatches(){this._highlightTimeout.clear(),this._state.cachedSearchTerm&&this._state.lastSearchOptions?.decorations&&(this._highlightTimeout.value=So(()=>{let e=this._state.cachedSearchTerm;this._state.clearCachedTerm(),this.findPrevious(e,{...this._state.lastSearchOptions,incremental:!0},{noScroll:!0})},200))}clearDecorations(e){this._resultTracker.clearSelectedDecoration(),this._decorationManager?.clearHighlightDecorations(),this._resultTracker.clearResults(),e||this._state.clearCachedTerm()}clearActiveDecoration(){this._resultTracker.clearSelectedDecoration()}findNext(e,t,r){if(!this._terminal||!this._engine)throw new Error("Cannot use addon until it has been loaded");this._state.lastSearchOptions=t,this._state.shouldUpdateHighlighting(e,t)&&this._highlightAllMatches(e,t);let d=this._findNextAndSelect(e,t,r);return this._fireResults(t),this._state.cachedSearchTerm=e,d}_highlightAllMatches(e,t){if(!this._terminal||!this._engine||!this._decorationManager)throw new Error("Cannot use addon until it has been loaded");if(!this._state.isValidSearchTerm(e)){this.clearDecorations();return}this.clearDecorations(!0);let r=[],d,u=this._engine.find(e,0,0,t);for(;u&&(d?.row!==u.row||d?.col!==u.col)&&!(r.length>=this._highlightLimit);)d=u,r.push(d),u=this._engine.find(e,d.col+d.term.length>=this._terminal.cols?d.row+1:d.row,d.col+d.term.length>=this._terminal.cols?0:d.col+1,t);this._resultTracker.updateResults(r,this._highlightLimit),t.decorations&&this._decorationManager.createHighlightDecorations(r,t.decorations)}_findNextAndSelect(e,t,r){if(!this._terminal||!this._engine)return!1;if(!this._state.isValidSearchTerm(e))return this._terminal.clearSelection(),this.clearDecorations(),!1;let d=this._engine.findNextWithSelection(e,t,this._state.cachedSearchTerm);return this._selectResult(d,t?.decorations,r?.noScroll)}findPrevious(e,t,r){if(!this._terminal||!this._engine)throw new Error("Cannot use addon until it has been loaded");this._state.lastSearchOptions=t,this._state.shouldUpdateHighlighting(e,t)&&this._highlightAllMatches(e,t);let d=this._findPreviousAndSelect(e,t,r);return this._fireResults(t),this._state.cachedSearchTerm=e,d}_fireResults(e){this._resultTracker.fireResultsChanged(!!e?.decorations)}_findPreviousAndSelect(e,t,r){if(!this._terminal||!this._engine)return!1;if(!this._state.isValidSearchTerm(e))return this._terminal.clearSelection(),this.clearDecorations(),!1;let d=this._engine.findPreviousWithSelection(e,t,this._state.cachedSearchTerm);return this._selectResult(d,t?.decorations,r?.noScroll)}_selectResult(e,t,r){if(!this._terminal||!this._decorationManager)return!1;if(this._resultTracker.clearSelectedDecoration(),!e)return this._terminal.clearSelection(),!1;if(this._terminal.select(e.col,e.row,e.size),t){let d=this._decorationManager.createActiveDecoration(e,t);d&&(this._resultTracker.selectedDecoration=d)}if(!r&&(e.row>=this._terminal.buffer.active.viewportY+this._terminal.rows||e.row<this._terminal.buffer.active.viewportY)){let d=e.row-this._terminal.buffer.active.viewportY;d-=Math.floor(this._terminal.rows/2),this._terminal.scrollLines(d)}return!0}}});var Zt=globalThis,xr=e=>e,Di=Zt.trustedTypes,Er=Di?Di.createPolicy("lit-html",{createHTML:e=>e}):void 0,vs="$lit$",Ve=`lit$${Math.random().toFixed(9).slice(2)}$`,bs="?"+Ve,pa=`<${bs}>`,ft=document,Qt=()=>ft.createComment(""),ei=e=>e===null||typeof e!="object"&&typeof e!="function",ys=Array.isArray,Tr=e=>ys(e)||typeof e?.[Symbol.iterator]=="function",gs=`[ 	
\f\r]`,Jt=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,kr=/-->/g,Lr=/>/g,dt=RegExp(`>|${gs}(?:([^\\s"'>=/]+)(${gs}*=${gs}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),Ar=/'/g,Dr=/"/g,Or=/^(?:script|style|textarea|title)$/i,Ss=e=>(t,...r)=>({_$litType$:e,strings:t,values:r}),j=Ss(1),Mr=Ss(2),Br=Ss(3),ye=Symbol.for("lit-noChange"),J=Symbol.for("lit-nothing"),Rr=new WeakMap,ut=ft.createTreeWalker(ft,129);function Pr(e,t){if(!ys(e)||!e.hasOwnProperty("raw"))throw Error("invalid template strings array");return Er!==void 0?Er.createHTML(t):t}var Ir=(e,t)=>{let r=e.length-1,d=[],u,i=t===2?"<svg>":t===3?"<math>":"",o=Jt;for(let h=0;h<r;h++){let f=e[h],c,p,v=-1,S=0;for(;S<f.length&&(o.lastIndex=S,p=o.exec(f),p!==null);)S=o.lastIndex,o===Jt?p[1]==="!--"?o=kr:p[1]!==void 0?o=Lr:p[2]!==void 0?(Or.test(p[2])&&(u=RegExp("</"+p[2],"g")),o=dt):p[3]!==void 0&&(o=dt):o===dt?p[0]===">"?(o=u??Jt,v=-1):p[1]===void 0?v=-2:(v=o.lastIndex-p[2].length,c=p[1],o=p[3]===void 0?dt:p[3]==='"'?Dr:Ar):o===Dr||o===Ar?o=dt:o===kr||o===Lr?o=Jt:(o=dt,u=void 0);let g=o===dt&&e[h+1].startsWith("/>")?" ":"";i+=o===Jt?f+pa:v>=0?(d.push(c),f.slice(0,v)+vs+f.slice(v)+Ve+g):f+Ve+(v===-2?h:g)}return[Pr(e,i+(e[r]||"<?>")+(t===2?"</svg>":t===3?"</math>":"")),d]},ti=class e{constructor({strings:t,_$litType$:r},d){let u;this.parts=[];let i=0,o=0,h=t.length-1,f=this.parts,[c,p]=Ir(t,r);if(this.el=e.createElement(c,d),ut.currentNode=this.el.content,r===2||r===3){let v=this.el.content.firstChild;v.replaceWith(...v.childNodes)}for(;(u=ut.nextNode())!==null&&f.length<h;){if(u.nodeType===1){if(u.hasAttributes())for(let v of u.getAttributeNames())if(v.endsWith(vs)){let S=p[o++],g=u.getAttribute(v).split(Ve),s=/([.?@])?(.*)/.exec(S);f.push({type:1,index:i,name:s[2],strings:g,ctor:s[1]==="."?Ti:s[1]==="?"?Oi:s[1]==="@"?Mi:_t}),u.removeAttribute(v)}else v.startsWith(Ve)&&(f.push({type:6,index:i}),u.removeAttribute(v));if(Or.test(u.tagName)){let v=u.textContent.split(Ve),S=v.length-1;if(S>0){u.textContent=Di?Di.emptyScript:"";for(let g=0;g<S;g++)u.append(v[g],Qt()),ut.nextNode(),f.push({type:2,index:++i});u.append(v[S],Qt())}}}else if(u.nodeType===8)if(u.data===bs)f.push({type:2,index:i});else{let v=-1;for(;(v=u.data.indexOf(Ve,v+1))!==-1;)f.push({type:7,index:i}),v+=Ve.length-1}i++}}static createElement(t,r){let d=ft.createElement("template");return d.innerHTML=t,d}};function pt(e,t,r=e,d){if(t===ye)return t;let u=d!==void 0?r._$Co?.[d]:r._$Cl,i=ei(t)?void 0:t._$litDirective$;return u?.constructor!==i&&(u?._$AO?.(!1),i===void 0?u=void 0:(u=new i(e),u._$AT(e,r,d)),d!==void 0?(r._$Co??(r._$Co=[]))[d]=u:r._$Cl=u),u!==void 0&&(t=pt(e,u._$AS(e,t.values),u,d)),t}var Ri=class{constructor(t,r){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=r}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){let{el:{content:r},parts:d}=this._$AD,u=(t?.creationScope??ft).importNode(r,!0);ut.currentNode=u;let i=ut.nextNode(),o=0,h=0,f=d[0];for(;f!==void 0;){if(o===f.index){let c;f.type===2?c=new Dt(i,i.nextSibling,this,t):f.type===1?c=new f.ctor(i,f.name,f.strings,this,t):f.type===6&&(c=new Bi(i,this,t)),this._$AV.push(c),f=d[++h]}o!==f?.index&&(i=ut.nextNode(),o++)}return ut.currentNode=ft,u}p(t){let r=0;for(let d of this._$AV)d!==void 0&&(d.strings!==void 0?(d._$AI(t,d,r),r+=d.strings.length-2):d._$AI(t[r])),r++}},Dt=class e{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,r,d,u){this.type=2,this._$AH=J,this._$AN=void 0,this._$AA=t,this._$AB=r,this._$AM=d,this.options=u,this._$Cv=u?.isConnected??!0}get parentNode(){let t=this._$AA.parentNode,r=this._$AM;return r!==void 0&&t?.nodeType===11&&(t=r.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,r=this){t=pt(this,t,r),ei(t)?t===J||t==null||t===""?(this._$AH!==J&&this._$AR(),this._$AH=J):t!==this._$AH&&t!==ye&&this._(t):t._$litType$!==void 0?this.$(t):t.nodeType!==void 0?this.T(t):Tr(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==J&&ei(this._$AH)?this._$AA.nextSibling.data=t:this.T(ft.createTextNode(t)),this._$AH=t}$(t){let{values:r,_$litType$:d}=t,u=typeof d=="number"?this._$AC(t):(d.el===void 0&&(d.el=ti.createElement(Pr(d.h,d.h[0]),this.options)),d);if(this._$AH?._$AD===u)this._$AH.p(r);else{let i=new Ri(u,this),o=i.u(this.options);i.p(r),this.T(o),this._$AH=i}}_$AC(t){let r=Rr.get(t.strings);return r===void 0&&Rr.set(t.strings,r=new ti(t)),r}k(t){ys(this._$AH)||(this._$AH=[],this._$AR());let r=this._$AH,d,u=0;for(let i of t)u===r.length?r.push(d=new e(this.O(Qt()),this.O(Qt()),this,this.options)):d=r[u],d._$AI(i),u++;u<r.length&&(this._$AR(d&&d._$AB.nextSibling,u),r.length=u)}_$AR(t=this._$AA.nextSibling,r){for(this._$AP?.(!1,!0,r);t!==this._$AB;){let d=xr(t).nextSibling;xr(t).remove(),t=d}}setConnected(t){this._$AM===void 0&&(this._$Cv=t,this._$AP?.(t))}},_t=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,r,d,u,i){this.type=1,this._$AH=J,this._$AN=void 0,this.element=t,this.name=r,this._$AM=u,this.options=i,d.length>2||d[0]!==""||d[1]!==""?(this._$AH=Array(d.length-1).fill(new String),this.strings=d):this._$AH=J}_$AI(t,r=this,d,u){let i=this.strings,o=!1;if(i===void 0)t=pt(this,t,r,0),o=!ei(t)||t!==this._$AH&&t!==ye,o&&(this._$AH=t);else{let h=t,f,c;for(t=i[0],f=0;f<i.length-1;f++)c=pt(this,h[d+f],r,f),c===ye&&(c=this._$AH[f]),o||(o=!ei(c)||c!==this._$AH[f]),c===J?t=J:t!==J&&(t+=(c??"")+i[f+1]),this._$AH[f]=c}o&&!u&&this.j(t)}j(t){t===J?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"")}},Ti=class extends _t{constructor(){super(...arguments),this.type=3}j(t){this.element[this.name]=t===J?void 0:t}},Oi=class extends _t{constructor(){super(...arguments),this.type=4}j(t){this.element.toggleAttribute(this.name,!!t&&t!==J)}},Mi=class extends _t{constructor(t,r,d,u,i){super(t,r,d,u,i),this.type=5}_$AI(t,r=this){if((t=pt(this,t,r,0)??J)===ye)return;let d=this._$AH,u=t===J&&d!==J||t.capture!==d.capture||t.once!==d.once||t.passive!==d.passive,i=t!==J&&(d===J||u);u&&this.element.removeEventListener(this.name,this,d),i&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t)}},Bi=class{constructor(t,r,d){this.element=t,this.type=6,this._$AN=void 0,this._$AM=r,this.options=d}get _$AU(){return this._$AM._$AU}_$AI(t){pt(this,t)}},$r={M:vs,P:Ve,A:bs,C:1,L:Ir,R:Ri,D:Tr,V:pt,I:Dt,H:_t,N:Oi,U:Mi,B:Ti,F:Bi},_a=Zt.litHtmlPolyfillSupport;_a?.(ti,Dt),(Zt.litHtmlVersions??(Zt.litHtmlVersions=[])).push("3.3.2");var Pi=(e,t,r)=>{let d=r?.renderBefore??t,u=d._$litPart$;if(u===void 0){let i=r?.renderBefore??null;d._$litPart$=u=new Dt(t.insertBefore(Qt(),i),i,void 0,r??{})}return u._$AI(e),u};function Hr(e={}){let t={activeRunId:e.activeRunId??null,runs:e.runs??{},logLines:e.logLines??[],preferences:{theme:e.preferences?.theme??"light",sidebarCollapsed:e.preferences?.sidebarCollapsed??!1}},r=new Set;function d(){for(let u of Array.from(r))try{u(t)}catch{}}return{getState(){return t},setState(u){let i={...t,...u,preferences:{...t.preferences,...u.preferences||{}}};i.activeRunId===t.activeRunId&&i.runs===t.runs&&i.logLines===t.logLines&&i.preferences.theme===t.preferences.theme&&i.preferences.sidebarCollapsed===t.preferences.sidebarCollapsed||(t=i,d())},setRun(u,i){let o={...t.runs,[u]:i};t={...t,runs:o},d()},appendLog(u){let i=[...t.logLines,u];i.length>5e3&&i.splice(0,i.length-5e3),t={...t,logLines:i},d()},clearLog(){t={...t,logLines:[]},d()},subscribe(u){return r.add(u),()=>r.delete(u)}}}var Fr=["subscribe-run","unsubscribe-run","subscribe-log","unsubscribe-log","list-runs","get-preferences","set-preferences","run-snapshot","run-update","runs-list","log-line","log-bulk","preferences"];function ws(){let e=Date.now().toString(36),t=Math.random().toString(36).slice(2,8);return`${e}-${t}`}function zr(e,t,r=ws()){return{id:r,type:e,payload:t}}function Nr(e={}){let t={initialMs:e.backoff?.initialMs??1e3,maxMs:e.backoff?.maxMs??3e4,factor:e.backoff?.factor??2,jitterRatio:e.backoff?.jitterRatio??.2},r=()=>e.url&&e.url.length>0?e.url:typeof location<"u"?(location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws":"ws://localhost/ws",d=null,u="closed",i=0,o=null,h=!0,f=new Map,c=[],p=new Map,v=new Set;function S(b){for(let y of Array.from(v))try{y(b)}catch{}}function g(){if(!h||o)return;u="reconnecting",S(u);let b=Math.min(t.maxMs,t.initialMs*Math.pow(t.factor,i)),y=t.jitterRatio*b,x=Math.max(0,Math.round(b+(Math.random()*2-1)*y));o=setTimeout(()=>{o=null,_()},x)}function s(b){try{d?.send(JSON.stringify(b))}catch{}}function a(){for(u="open",S(u),i=0;c.length;){let b=c.shift();b&&s(b)}}function n(b){let y;try{y=JSON.parse(String(b.data))}catch{return}if(!y||typeof y.id!="string"||typeof y.type!="string")return;if(f.has(y.id)){let m=f.get(y.id);f.delete(y.id),y.ok?m?.resolve(y.payload):m?.reject(y.error||new Error("ws error"));return}let x=p.get(y.type);if(x&&x.size>0)for(let m of Array.from(x))try{m(y.payload)}catch{}}function l(){u="closed",S(u);for(let[b,y]of f.entries())y.reject(new Error("ws disconnected")),f.delete(b);i+=1,g()}function _(){if(!h)return;let b=r();try{d=new WebSocket(b),u="connecting",S(u),d.addEventListener("open",a),d.addEventListener("message",n),d.addEventListener("error",()=>{}),d.addEventListener("close",l)}catch{g()}}return _(),{send(b,y){if(!Fr.includes(b))return Promise.reject(new Error(`unknown message type: ${b}`));let x=ws(),m=zr(b,y,x);return new Promise((w,A)=>{f.set(x,{resolve:w,reject:A,type:b}),d&&d.readyState===d.OPEN?s(m):c.push(m)})},on(b,y){p.has(b)||p.set(b,new Set);let x=p.get(b);return x?.add(y),()=>{x?.delete(y)}},onConnection(b){return v.add(b),()=>{v.delete(b)}},close(){h=!1,o&&(clearTimeout(o),o=null);try{d?.close()}catch{}},getState(){return u}}}function Cs(e){let t=(e||"").replace(/^#\/?/,""),[r,d]=t.split("?"),u=r||"active",i=new URLSearchParams(d||"");return{section:u,runId:i.get("run")||null}}function ma(e,t){let r=`#/${e}`;return t?`${r}?run=${t}`:r}function Wr(e){let t=()=>e(Cs(location.hash));return window.addEventListener("hashchange",t),()=>window.removeEventListener("hashchange",t)}function Ii(e,t){location.hash=ma(e,t)}function ii(e){document.documentElement.setAttribute("data-theme",e)}var Pe={ATTRIBUTE:1,CHILD:2,PROPERTY:3,BOOLEAN_ATTRIBUTE:4,EVENT:5,ELEMENT:6},Rt=e=>(...t)=>({_$litDirective$:e,values:t}),ot=class{constructor(t){}get _$AU(){return this._$AM._$AU}_$AT(t,r,d){this._$Ct=t,this._$AM=r,this._$Ci=d}_$AS(t,r){return this.update(t,r)}update(t,r){return this.render(...r)}};var si=class extends ot{constructor(t){if(super(t),this.it=J,t.type!==Pe.CHILD)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(t){if(t===J||t==null)return this._t=void 0,this.it=t;if(t===ye)return t;if(typeof t!="string")throw Error(this.constructor.directiveName+"() called with a non-string value");if(t===this.it)return this._t;this.it=t;let r=[t];return r.raw=r,this._t={_$litType$:this.constructor.resultType,strings:r,values:[]}}};si.directiveName="unsafeHTML",si.resultType=1;var de=Rt(si);var Tt=[["circle",{cx:"12",cy:"12",r:"10"}]];var mt=[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"m9 12 2 2 4-4"}]];var gt=[["circle",{cx:"12",cy:"12",r:"10"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16"}]];var ri=[["path",{d:"M12 2v4"}],["path",{d:"m16.2 7.8 2.9-2.9"}],["path",{d:"M18 12h4"}],["path",{d:"m16.2 16.2 2.9 2.9"}],["path",{d:"M12 18v4"}],["path",{d:"m4.9 19.1 2.9-2.9"}],["path",{d:"M2 12h4"}],["path",{d:"m4.9 4.9 2.9 2.9"}]];var xs=[["circle",{cx:"12",cy:"12",r:"4"}],["path",{d:"M12 2v2"}],["path",{d:"M12 20v2"}],["path",{d:"m4.93 4.93 1.41 1.41"}],["path",{d:"m17.66 17.66 1.41 1.41"}],["path",{d:"M2 12h2"}],["path",{d:"M20 12h2"}],["path",{d:"m6.34 17.66-1.41 1.41"}],["path",{d:"m19.07 4.93-1.41 1.41"}]];var Es=[["path",{d:"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"}]];var ks=[["path",{d:"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"}]];var Ls=[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{d:"M21 3v5h-5"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{d:"M8 16H3v5"}]];var As=[["path",{d:"M12 5v14"}],["path",{d:"m19 12-7 7-7-7"}]];var Ds=[["rect",{x:"14",y:"3",width:"5",height:"18",rx:"1"}],["rect",{x:"5",y:"3",width:"5",height:"18",rx:"1"}]];var oi=[["path",{d:"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]];var Rs=[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"}],["path",{d:"M10 12h4"}]];var Ts=[["path",{d:"m21 21-4.34-4.34"}],["circle",{cx:"11",cy:"11",r:"8"}]];function ga(e){return e.map(([t,r])=>{let d=Object.entries(r).map(([u,i])=>`${u}="${i}"`).join(" ");return`<${t} ${d}/>`}).join("")}function _e(e,t=16,r=""){let d=r?` class="${r}"`:"";return`<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${d}>${ga(e)}</svg>`}function Ur(e,t,r,{onNavigate:d,onThemeToggle:u}){let{runs:i,preferences:o}=e,h=Object.values(i),f=h.filter(g=>g.active).length,c=h.filter(g=>!g.active).length,p=r==="open"?"connected":r==="reconnecting"?"reconnecting":"disconnected",v=r==="open"?"Connected":r==="reconnecting"?"Reconnecting\u2026":"Disconnected",S=o.theme==="dark"?_e(xs,18):_e(Es,18);return j`
    <aside class="sidebar ${o.sidebarCollapsed?"collapsed":""}">
      <div class="sidebar-logo">
        <span class="logo-text">WORCA</span>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Pipeline</div>
        <div class="sidebar-item ${t.section==="active"?"active":""}"
             @click=${()=>d("active")}>
          <span class="sidebar-item-left">
            ${de(_e(oi,16))}
            <span>Active</span>
          </span>
          ${f>0?j`<sl-badge variant="primary" pill>${f}</sl-badge>`:""}
        </div>
        <div class="sidebar-item ${t.section==="history"?"active":""}"
             @click=${()=>d("history")}>
          <span class="sidebar-item-left">
            ${de(_e(Rs,16))}
            <span>History</span>
          </span>
          ${c>0?j`<sl-badge variant="neutral" pill>${c}</sl-badge>`:""}
        </div>
      </div>

      <div class="sidebar-footer">
        <div class="connection-indicator ${p}">
          <span class="conn-dot"></span>
          <span class="conn-label">${v}</span>
        </div>
        <button
          class="theme-toggle-btn"
          aria-label="Toggle theme"
          @click=${u}
        >${de(S)}</button>
      </div>
    </aside>
  `}var va={pending:"status-pending",in_progress:"status-in-progress",completed:"status-completed",error:"status-error"},ba={pending:Tt,in_progress:ri,completed:mt,error:gt};function Ot(e){return va[e]||"status-unknown"}function ni(e,t=14){let r=ba[e];return r?_e(r,t,e==="in_progress"?"icon-spin":""):"?"}var ya={pending:Tt,in_progress:ri,completed:mt,error:gt};function Sa(e,t){return t&&t[e]?.label?t[e].label:e.replace(/_/g," ").replace(/\b\w/g,r=>r.toUpperCase())}function jr(e,t={},r={}){if(!e||typeof e!="object")return j``;let d=Object.entries(e);return d.length===0?j`<div class="empty-state">No stages</div>`:j`
    <div class="stage-timeline">
      ${d.map(([u,i],o)=>{let h=i.status||"pending",f=ya[h]||Tt,c=Sa(u,t),p=h==="in_progress",v=r[`${u}_approval`],S=i.iteration,g=h==="in_progress"?"icon-spin":"";return j`
          ${o>0?j`<div class="stage-connector ${d[o-1]?.[1]?.status==="completed"?"completed":""}"></div>`:""}
          <div class="stage-node ${Ot(h)} ${p?"pulse":""}">
            <div class="stage-icon">${de(_e(f,22,g))}</div>
            <div class="stage-label">${c}</div>
            ${S>1?j`<span class="loop-indicator">${de(_e(Ls,10))}${S}</span>`:""}
            ${v?j`<span class="milestone-marker">${de(_e(ks,12))}</span>`:""}
          </div>
        `})}
    </div>
  `}function ai(e){let t=Math.floor(e/1e3),r=Math.floor(t/3600),d=Math.floor(t%3600/60),u=t%60;return r>0?`${r}h ${d}m ${u}s`:d>0?`${d}m ${u}s`:`${u}s`}function li(e,t){let r=new Date(e).getTime();return(t?new Date(t).getTime():Date.now())-r}function Vr(e,t={}){if(!e)return j`<div class="empty-state">Select a run to view details</div>`;let r=e.work_request?.title||"Untitled Run",d=e.work_request?.branch||"",u=e.pr_url||null,i=e.started_at?ai(li(e.started_at,e.completed_at||null)):"",o=e.stages||{},h=t.stageUi||{},f=t.milestones||{},c=t.agents||{};return j`
    <div class="run-detail">
      <div class="run-header">
        <div class="run-header-left">
          <h2 class="run-title">${r}</h2>
          <sl-badge variant="${e.active?"warning":"success"}" pill>
            ${de(ni(e.active?"in_progress":"completed",12))}
            ${e.active?"Running":"Completed"}
          </sl-badge>
        </div>
        <div class="run-header-right">
          ${d?j`<span class="run-meta"><span class="meta-label">Branch:</span> ${d}</span>`:J}
          ${i?j`<span class="run-meta"><span class="meta-label">Duration:</span> ${i}</span>`:J}
          ${u?j`<a class="run-meta run-pr-link" href="${u}" target="_blank">View PR</a>`:J}
        </div>
      </div>

      ${jr(o,h,f)}

      <div class="stage-panels">
        ${Object.entries(o).map(([p,v])=>{let S=h[p]?.label||p.replace(/_/g," ").replace(/\b\w/g,l=>l.toUpperCase()),g=v.status||"pending",s=Object.keys(c).find(l=>l===p)||null,a=s?c[s]:null,n=v.started_at?ai(li(v.started_at,v.completed_at||null)):"";return j`
            <sl-details ?open=${g==="in_progress"} class="stage-panel">
              <div slot="summary" class="stage-panel-header">
                <span class="stage-panel-icon ${Ot(g)}">${de(ni(g))}</span>
                <span class="stage-panel-label">${S}</span>
                <sl-badge variant="${g==="completed"?"success":g==="error"?"danger":g==="in_progress"?"warning":"neutral"}" pill>
                  ${g.replace(/_/g," ")}
                </sl-badge>
              </div>
              <div class="stage-detail">
                ${v.started_at?j`<div class="detail-row"><span class="detail-label">Started:</span> ${new Date(v.started_at).toLocaleTimeString()}</div>`:J}
                ${v.completed_at?j`<div class="detail-row"><span class="detail-label">Completed:</span> ${new Date(v.completed_at).toLocaleTimeString()}</div>`:J}
                ${n?j`<div class="detail-row"><span class="detail-label">Duration:</span> ${n}</div>`:J}
                ${a?j`<div class="detail-row"><span class="detail-label">Agent:</span> ${s} (${a.model})</div>`:J}
                ${v.iteration>1?j`<div class="detail-row"><span class="detail-label">Iteration:</span> ${v.iteration}</div>`:J}
                ${v.task_progress?j`<div class="detail-row"><span class="detail-label">Progress:</span> ${v.task_progress}</div>`:J}
                ${v.error?j`<div class="detail-row detail-error"><span class="detail-label">Error:</span> ${v.error}</div>`:J}
              </div>
            </sl-details>
          `})}
      </div>
    </div>
  `}function Os(e,t,{onSelectRun:r}){let d=e.filter(u=>t==="active"?u.active:!u.active);return d.length===0?j`<div class="empty-state">
      ${t==="active"?"No active pipeline runs":"No completed runs yet"}
    </div>`:j`
    <div class="run-list">
      ${d.map(u=>{let i=u.work_request?.title||"Untitled",o=u.active?"in_progress":u.stage==="error"?"error":"completed",h=u.started_at?ai(li(u.started_at,u.completed_at||null)):"";return j`
          <div class="run-list-item" @click=${()=>r(u.id)}>
            <span class="run-list-status ${Ot(o)}">${de(ni(o))}</span>
            <div class="run-list-info">
              <span class="run-list-title">${i}</span>
              <span class="run-list-meta">${u.stage||"pending"} \u00B7 ${h}</span>
            </div>
          </div>
        `})}
    </div>
  `}function qr(e){let t=Object.values(e.runs),r=t.filter(i=>i.active),d=t.filter(i=>!i.active),u=t.filter(i=>(i.stages?Object.values(i.stages):[]).some(h=>h.status==="error"));return j`
    <div class="dashboard">
      <h2 class="dashboard-title">Pipeline Overview</h2>
      <div class="dashboard-stats">
        <div class="stat-card stat-active">
          <div class="stat-icon">${de(_e(oi,28))}</div>
          <span class="stat-number">${r.length}</span>
          <span class="stat-label">Active</span>
        </div>
        <div class="stat-card stat-completed">
          <div class="stat-icon">${de(_e(mt,28))}</div>
          <span class="stat-number">${d.length}</span>
          <span class="stat-label">Completed</span>
        </div>
        <div class="stat-card stat-errors">
          <div class="stat-icon">${de(_e(gt,28))}</div>
          <span class="stat-number">${u.length}</span>
          <span class="stat-label">Errors</span>
        </div>
      </div>

      ${r.length>0?j`
        <h3 class="dashboard-section-title">Active Runs</h3>
        ${r.map(i=>j`
          <div class="run-list-item">
            <div class="run-list-info">
              <span class="run-list-title">${i.work_request?.title||"Untitled"}</span>
              <span class="run-list-meta">Stage: ${i.stage||"pending"}</span>
            </div>
          </div>
        `)}
      `:j`<div class="empty-state">No active pipeline runs</div>`}
    </div>
  `}var xo=["\x1B[36m","\x1B[33m","\x1B[35m","\x1B[32m","\x1B[34m","\x1B[91m","\x1B[96m","\x1B[93m"],Eo="\x1B[0m",Sl="\x1B[2m",qi=new Map,Gs=0;function wl(e){return qi.has(e)||(qi.set(e,xo[Gs%xo.length]),Gs++),qi.get(e)}var Te=null,vt=null,ui=null,Xs=null,di=null;async function Cl(e){if(Te&&e.querySelector(".xterm")){vt.fit();return}let[{Terminal:t},{FitAddon:r},{SearchAddon:d}]=await Promise.all([Promise.resolve().then(()=>fa(Gr(),1)),Promise.resolve().then(()=>(Yr(),Xr)),Promise.resolve().then(()=>(Co(),wo))]);Te=new t({theme:{background:"#0f172a",foreground:"#e2e8f0",cursor:"#60a5fa",selectionBackground:"rgba(96, 165, 250, 0.3)"},fontFamily:"'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",fontSize:13,lineHeight:1.4,scrollback:5e4,convertEol:!0,cursorBlink:!1,disableStdin:!0}),vt=new r,ui=new d,Te.loadAddon(vt),Te.loadAddon(ui),Te.open(e),vt.fit(),di=new ResizeObserver(()=>{vt&&vt.fit()}),di.observe(e)}function Ys(e){if(!Te)return;let t=e.timestamp?`${Sl}${e.timestamp}${Eo} `:"",r=e.stage?`${wl(e.stage)}[${e.stage.toUpperCase()}]${Eo} `:"",d=e.line||e;Te.writeln(`${t}${r}${d}`)}function Ki(){Te&&Te.clear(),qi.clear(),Gs=0}function ko(){di&&di.disconnect(),Te&&Te.dispose(),Te=null,vt=null,ui=null,di=null,Xs=null}function Lo(e){ui&&e&&ui.findNext(e,{incremental:!0})}async function Ao(e){let t=document.getElementById("log-terminal");t&&(e!==Xs&&(Ki(),Xs=e),await Cl(t))}function Do(e,{onStageFilter:t,onSearch:r,onToggleAutoScroll:d,autoScroll:u}){let{logLines:i}=e,o=[...new Set(i.map(h=>h.stage).filter(Boolean))];return j`
    <div class="log-viewer-container">
      <div class="log-controls">
        <sl-select
          placeholder="All Stages"
          size="small"
          clearable
          @sl-change=${h=>t(h.target.value||"*")}
        >
          ${o.map(h=>j`<sl-option value="${h}">${h}</sl-option>`)}
        </sl-select>
        <sl-input
          class="log-search"
          type="text"
          placeholder="Search logs\u2026"
          size="small"
          clearable
          @sl-input=${h=>r(h.target.value)}
        >
          <span slot="prefix">${de(_e(Ts,14))}</span>
        </sl-input>
        <sl-button
          size="small"
          variant="${u?"primary":"default"}"
          @click=${d}
        >
          ${de(_e(u?As:Ds,14))}
          ${u?"Auto":"Paused"}
        </sl-button>
      </div>
      <div class="log-terminal-wrapper">
        <div id="log-terminal" class="log-terminal"></div>
      </div>
    </div>
  `}var Gi=globalThis,Xi=Gi.ShadowRoot&&(Gi.ShadyCSS===void 0||Gi.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,Js=Symbol(),Ro=new WeakMap,fi=class{constructor(t,r,d){if(this._$cssResult$=!0,d!==Js)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=r}get styleSheet(){let t=this.o,r=this.t;if(Xi&&t===void 0){let d=r!==void 0&&r.length===1;d&&(t=Ro.get(r)),t===void 0&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),d&&Ro.set(r,t))}return t}toString(){return this.cssText}},To=e=>new fi(typeof e=="string"?e:e+"",void 0,Js),se=(e,...t)=>{let r=e.length===1?e[0]:t.reduce((d,u,i)=>d+(o=>{if(o._$cssResult$===!0)return o.cssText;if(typeof o=="number")return o;throw Error("Value passed to 'css' function must be a 'css' function result: "+o+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(u)+e[i+1],e[0]);return new fi(r,e,Js)},Oo=(e,t)=>{if(Xi)e.adoptedStyleSheets=t.map(r=>r instanceof CSSStyleSheet?r:r.styleSheet);else for(let r of t){let d=document.createElement("style"),u=Gi.litNonce;u!==void 0&&d.setAttribute("nonce",u),d.textContent=r.cssText,e.appendChild(d)}},Zs=Xi?e=>e:e=>e instanceof CSSStyleSheet?(t=>{let r="";for(let d of t.cssRules)r+=d.cssText;return To(r)})(e):e;var{is:xl,defineProperty:El,getOwnPropertyDescriptor:kl,getOwnPropertyNames:Ll,getOwnPropertySymbols:Al,getPrototypeOf:Dl}=Object,at=globalThis,Mo=at.trustedTypes,Rl=Mo?Mo.emptyScript:"",Tl=at.reactiveElementPolyfillSupport,pi=(e,t)=>e,lt={toAttribute(e,t){switch(t){case Boolean:e=e?Rl:null;break;case Object:case Array:e=e==null?e:JSON.stringify(e)}return e},fromAttribute(e,t){let r=e;switch(t){case Boolean:r=e!==null;break;case Number:r=e===null?null:Number(e);break;case Object:case Array:try{r=JSON.parse(e)}catch{r=null}}return r}},Yi=(e,t)=>!xl(e,t),Bo={attribute:!0,type:String,converter:lt,reflect:!1,useDefault:!1,hasChanged:Yi};Symbol.metadata??(Symbol.metadata=Symbol("metadata")),at.litPropertyMetadata??(at.litPropertyMetadata=new WeakMap);var Ge=class extends HTMLElement{static addInitializer(t){this._$Ei(),(this.l??(this.l=[])).push(t)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(t,r=Bo){if(r.state&&(r.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(t)&&((r=Object.create(r)).wrapped=!0),this.elementProperties.set(t,r),!r.noAccessor){let d=Symbol(),u=this.getPropertyDescriptor(t,d,r);u!==void 0&&El(this.prototype,t,u)}}static getPropertyDescriptor(t,r,d){let{get:u,set:i}=kl(this.prototype,t)??{get(){return this[r]},set(o){this[r]=o}};return{get:u,set(o){let h=u?.call(this);i?.call(this,o),this.requestUpdate(t,h,d)},configurable:!0,enumerable:!0}}static getPropertyOptions(t){return this.elementProperties.get(t)??Bo}static _$Ei(){if(this.hasOwnProperty(pi("elementProperties")))return;let t=Dl(this);t.finalize(),t.l!==void 0&&(this.l=[...t.l]),this.elementProperties=new Map(t.elementProperties)}static finalize(){if(this.hasOwnProperty(pi("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(pi("properties"))){let r=this.properties,d=[...Ll(r),...Al(r)];for(let u of d)this.createProperty(u,r[u])}let t=this[Symbol.metadata];if(t!==null){let r=litPropertyMetadata.get(t);if(r!==void 0)for(let[d,u]of r)this.elementProperties.set(d,u)}this._$Eh=new Map;for(let[r,d]of this.elementProperties){let u=this._$Eu(r,d);u!==void 0&&this._$Eh.set(u,r)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(t){let r=[];if(Array.isArray(t)){let d=new Set(t.flat(1/0).reverse());for(let u of d)r.unshift(Zs(u))}else t!==void 0&&r.push(Zs(t));return r}static _$Eu(t,r){let d=r.attribute;return d===!1?void 0:typeof d=="string"?d:typeof t=="string"?t.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(t=>t(this))}addController(t){(this._$EO??(this._$EO=new Set)).add(t),this.renderRoot!==void 0&&this.isConnected&&t.hostConnected?.()}removeController(t){this._$EO?.delete(t)}_$E_(){let t=new Map,r=this.constructor.elementProperties;for(let d of r.keys())this.hasOwnProperty(d)&&(t.set(d,this[d]),delete this[d]);t.size>0&&(this._$Ep=t)}createRenderRoot(){let t=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Oo(t,this.constructor.elementStyles),t}connectedCallback(){this.renderRoot??(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),this._$EO?.forEach(t=>t.hostConnected?.())}enableUpdating(t){}disconnectedCallback(){this._$EO?.forEach(t=>t.hostDisconnected?.())}attributeChangedCallback(t,r,d){this._$AK(t,d)}_$ET(t,r){let d=this.constructor.elementProperties.get(t),u=this.constructor._$Eu(t,d);if(u!==void 0&&d.reflect===!0){let i=(d.converter?.toAttribute!==void 0?d.converter:lt).toAttribute(r,d.type);this._$Em=t,i==null?this.removeAttribute(u):this.setAttribute(u,i),this._$Em=null}}_$AK(t,r){let d=this.constructor,u=d._$Eh.get(t);if(u!==void 0&&this._$Em!==u){let i=d.getPropertyOptions(u),o=typeof i.converter=="function"?{fromAttribute:i.converter}:i.converter?.fromAttribute!==void 0?i.converter:lt;this._$Em=u;let h=o.fromAttribute(r,i.type);this[u]=h??this._$Ej?.get(u)??h,this._$Em=null}}requestUpdate(t,r,d,u=!1,i){if(t!==void 0){let o=this.constructor;if(u===!1&&(i=this[t]),d??(d=o.getPropertyOptions(t)),!((d.hasChanged??Yi)(i,r)||d.useDefault&&d.reflect&&i===this._$Ej?.get(t)&&!this.hasAttribute(o._$Eu(t,d))))return;this.C(t,r,d)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(t,r,{useDefault:d,reflect:u,wrapped:i},o){d&&!(this._$Ej??(this._$Ej=new Map)).has(t)&&(this._$Ej.set(t,o??r??this[t]),i!==!0||o!==void 0)||(this._$AL.has(t)||(this.hasUpdated||d||(r=void 0),this._$AL.set(t,r)),u===!0&&this._$Em!==t&&(this._$Eq??(this._$Eq=new Set)).add(t))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(r){Promise.reject(r)}let t=this.scheduleUpdate();return t!=null&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??(this.renderRoot=this.createRenderRoot()),this._$Ep){for(let[u,i]of this._$Ep)this[u]=i;this._$Ep=void 0}let d=this.constructor.elementProperties;if(d.size>0)for(let[u,i]of d){let{wrapped:o}=i,h=this[u];o!==!0||this._$AL.has(u)||h===void 0||this.C(u,void 0,i,h)}}let t=!1,r=this._$AL;try{t=this.shouldUpdate(r),t?(this.willUpdate(r),this._$EO?.forEach(d=>d.hostUpdate?.()),this.update(r)):this._$EM()}catch(d){throw t=!1,this._$EM(),d}t&&this._$AE(r)}willUpdate(t){}_$AE(t){this._$EO?.forEach(r=>r.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(t)),this.updated(t)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(t){return!0}update(t){this._$Eq&&(this._$Eq=this._$Eq.forEach(r=>this._$ET(r,this[r]))),this._$EM()}updated(t){}firstUpdated(t){}};Ge.elementStyles=[],Ge.shadowRootOptions={mode:"open"},Ge[pi("elementProperties")]=new Map,Ge[pi("finalized")]=new Map,Tl?.({ReactiveElement:Ge}),(at.reactiveElementVersions??(at.reactiveElementVersions=[])).push("2.1.2");var _i=globalThis,ct=class extends Ge{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var r;let t=super.createRenderRoot();return(r=this.renderOptions).renderBefore??(r.renderBefore=t.firstChild),t}update(t){let r=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=Pi(r,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return ye}};ct._$litElement$=!0,ct.finalized=!0,_i.litElementHydrateSupport?.({LitElement:ct});var Ol=_i.litElementPolyfillSupport;Ol?.({LitElement:ct});(_i.litElementVersions??(_i.litElementVersions=[])).push("4.2.2");var Po=se`
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
`;var Ho=Object.defineProperty,Ml=Object.defineProperties,Bl=Object.getOwnPropertyDescriptor,Pl=Object.getOwnPropertyDescriptors,Io=Object.getOwnPropertySymbols,Il=Object.prototype.hasOwnProperty,$l=Object.prototype.propertyIsEnumerable;var Fo=e=>{throw TypeError(e)},$o=(e,t,r)=>t in e?Ho(e,t,{enumerable:!0,configurable:!0,writable:!0,value:r}):e[t]=r,xe=(e,t)=>{for(var r in t||(t={}))Il.call(t,r)&&$o(e,r,t[r]);if(Io)for(var r of Io(t))$l.call(t,r)&&$o(e,r,t[r]);return e},Xe=(e,t)=>Ml(e,Pl(t)),B=(e,t,r,d)=>{for(var u=d>1?void 0:d?Bl(t,r):t,i=e.length-1,o;i>=0;i--)(o=e[i])&&(u=(d?o(t,r,u):o(u))||u);return d&&u&&Ho(t,r,u),u},zo=(e,t,r)=>t.has(e)||Fo("Cannot "+r),No=(e,t,r)=>(zo(e,t,"read from private field"),r?r.call(e):t.get(e)),Wo=(e,t,r)=>t.has(e)?Fo("Cannot add the same private member more than once"):t instanceof WeakSet?t.add(e):t.set(e,r),Uo=(e,t,r,d)=>(zo(e,t,"write to private field"),d?d.call(e,r):t.set(e,r),r);var Vo=new Map,Hl=new WeakMap;function Fl(e){return e??{keyframes:[],options:{duration:0}}}function jo(e,t){return t.toLowerCase()==="rtl"?{keyframes:e.rtlKeyframes||e.keyframes,options:e.options}:e}function Ye(e,t){Vo.set(e,Fl(t))}function Je(e,t,r){let d=Hl.get(e);if(d?.[t])return jo(d[t],r.dir);let u=Vo.get(t);return u?jo(u,r.dir):{keyframes:[],options:{duration:0}}}function Ze(e,t){return new Promise(r=>{function d(u){u.target===e&&(e.removeEventListener(t,d),r())}e.addEventListener(t,d)})}function Qe(e,t,r){return new Promise(d=>{if(r?.duration===1/0)throw new Error("Promise-based animations must be finite.");let u=e.animate(t,Xe(xe({},r),{duration:zl()?0:r.duration}));u.addEventListener("cancel",d,{once:!0}),u.addEventListener("finish",d,{once:!0})})}function Qs(e){return e=e.toString().toLowerCase(),e.indexOf("ms")>-1?parseFloat(e):e.indexOf("s")>-1?parseFloat(e)*1e3:parseFloat(e)}function zl(){return window.matchMedia("(prefers-reduced-motion: reduce)").matches}function et(e){return Promise.all(e.getAnimations().map(t=>new Promise(r=>{t.cancel(),requestAnimationFrame(r)})))}function er(e,t){return e.map(r=>Xe(xe({},r),{height:r.height==="auto"?`${t}px`:r.height}))}var tr=new Set,It=new Map,bt,ir="ltr",sr="en",qo=typeof MutationObserver<"u"&&typeof document<"u"&&typeof document.documentElement<"u";if(qo){let e=new MutationObserver(Ko);ir=document.documentElement.dir||"ltr",sr=document.documentElement.lang||navigator.language,e.observe(document.documentElement,{attributes:!0,attributeFilter:["dir","lang"]})}function mi(...e){e.map(t=>{let r=t.$code.toLowerCase();It.has(r)?It.set(r,Object.assign(Object.assign({},It.get(r)),t)):It.set(r,t),bt||(bt=t)}),Ko()}function Ko(){qo&&(ir=document.documentElement.dir||"ltr",sr=document.documentElement.lang||navigator.language),[...tr.keys()].map(e=>{typeof e.requestUpdate=="function"&&e.requestUpdate()})}var Ji=class{constructor(t){this.host=t,this.host.addController(this)}hostConnected(){tr.add(this.host)}hostDisconnected(){tr.delete(this.host)}dir(){return`${this.host.dir||ir}`.toLowerCase()}lang(){return`${this.host.lang||sr}`.toLowerCase()}getTranslationData(t){var r,d;let u=new Intl.Locale(t.replace(/_/g,"-")),i=u?.language.toLowerCase(),o=(d=(r=u?.region)===null||r===void 0?void 0:r.toLowerCase())!==null&&d!==void 0?d:"",h=It.get(`${i}-${o}`),f=It.get(i);return{locale:u,language:i,region:o,primary:h,secondary:f}}exists(t,r){var d;let{primary:u,secondary:i}=this.getTranslationData((d=r.lang)!==null&&d!==void 0?d:this.lang());return r=Object.assign({includeFallback:!1},r),!!(u&&u[t]||i&&i[t]||r.includeFallback&&bt&&bt[t])}term(t,...r){let{primary:d,secondary:u}=this.getTranslationData(this.lang()),i;if(d&&d[t])i=d[t];else if(u&&u[t])i=u[t];else if(bt&&bt[t])i=bt[t];else return console.error(`No translation found for: ${String(t)}`),String(t);return typeof i=="function"?i(...r):i}date(t,r){return t=new Date(t),new Intl.DateTimeFormat(this.lang(),r).format(t)}number(t,r){return t=Number(t),isNaN(t)?"":new Intl.NumberFormat(this.lang(),r).format(t)}relativeTime(t,r,d){return new Intl.RelativeTimeFormat(this.lang(),d).format(t,r)}};var Go={$code:"en",$name:"English",$dir:"ltr",carousel:"Carousel",clearEntry:"Clear entry",close:"Close",copied:"Copied",copy:"Copy",currentValue:"Current value",error:"Error",goToSlide:(e,t)=>`Go to slide ${e} of ${t}`,hidePassword:"Hide password",loading:"Loading",nextSlide:"Next slide",numOptionsSelected:e=>e===0?"No options selected":e===1?"1 option selected":`${e} options selected`,previousSlide:"Previous slide",progress:"Progress",remove:"Remove",resize:"Resize",scrollToEnd:"Scroll to end",scrollToStart:"Scroll to start",selectAColorFromTheScreen:"Select a color from the screen",showPassword:"Show password",slideNum:e=>`Slide ${e}`,toggleColorFormat:"Toggle color format"};mi(Go);var Xo=Go;var me=class extends Ji{};mi(Xo);var rr="";function Yo(e){rr=e}function Jo(e=""){if(!rr){let t=[...document.getElementsByTagName("script")],r=t.find(d=>d.hasAttribute("data-shoelace"));if(r)Yo(r.getAttribute("data-shoelace"));else{let d=t.find(i=>/shoelace(\.min)?\.js($|\?)/.test(i.src)||/shoelace-autoloader(\.min)?\.js($|\?)/.test(i.src)),u="";d&&(u=d.getAttribute("src")),Yo(u.split("/").slice(0,-1).join("/"))}}return rr.replace(/\/$/,"")+(e?`/${e.replace(/^\//,"")}`:"")}var Nl={name:"default",resolver:e=>Jo(`assets/icons/${e}.svg`)},Zo=Nl;var Qo={caret:`
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
  `},Wl={name:"system",resolver:e=>e in Qo?`data:image/svg+xml,${encodeURIComponent(Qo[e])}`:""},en=Wl;var Ul=[Zo,en],or=[];function tn(e){or.push(e)}function sn(e){or=or.filter(t=>t!==e)}function nr(e){return Ul.find(t=>t.name===e)}var rn=se`
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
`;function ce(e,t){let r=xe({waitUntilFirstUpdate:!1},t);return(d,u)=>{let{update:i}=d,o=Array.isArray(e)?e:[e];d.update=function(h){o.forEach(f=>{let c=f;if(h.has(c)){let p=h.get(c),v=this[c];p!==v&&(!r.waitUntilFirstUpdate||this.hasUpdated)&&this[u](p,v)}}),i.call(this,h)}}}var ae=se`
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
`;var jl={attribute:!0,type:String,converter:lt,reflect:!1,hasChanged:Yi},Vl=(e=jl,t,r)=>{let{kind:d,metadata:u}=r,i=globalThis.litPropertyMetadata.get(u);if(i===void 0&&globalThis.litPropertyMetadata.set(u,i=new Map),d==="setter"&&((e=Object.create(e)).wrapped=!0),i.set(r.name,e),d==="accessor"){let{name:o}=r;return{set(h){let f=t.get.call(this);t.set.call(this,h),this.requestUpdate(o,f,e,!0,h)},init(h){return h!==void 0&&this.C(o,void 0,e,h),h}}}if(d==="setter"){let{name:o}=r;return function(h){let f=this[o];t.call(this,h),this.requestUpdate(o,f,e,!0,h)}}throw Error("Unsupported decorator location: "+d)};function H(e){return(t,r)=>typeof r=="object"?Vl(e,t,r):((d,u,i)=>{let o=u.hasOwnProperty(i);return u.constructor.createProperty(i,d),o?Object.getOwnPropertyDescriptor(u,i):void 0})(e,t,r)}function ue(e){return H({...e,state:!0,attribute:!1})}var yt=(e,t,r)=>(r.configurable=!0,r.enumerable=!0,Reflect.decorate&&typeof t!="object"&&Object.defineProperty(e,t,r),r);function ne(e,t){return(r,d,u)=>{let i=o=>o.renderRoot?.querySelector(e)??null;if(t){let{get:o,set:h}=typeof d=="object"?r:u??(()=>{let f=Symbol();return{get(){return this[f]},set(c){this[f]=c}}})();return yt(r,d,{get(){let f=o.call(this);return f===void 0&&(f=i(this),(f!==null||this.hasUpdated)&&h.call(this,f)),f}})}return yt(r,d,{get(){return i(this)}})}}var Zi,oe=class extends ct{constructor(){super(),Wo(this,Zi,!1),this.initialReflectedProperties=new Map,Object.entries(this.constructor.dependencies).forEach(([e,t])=>{this.constructor.define(e,t)})}emit(e,t){let r=new CustomEvent(e,xe({bubbles:!0,cancelable:!1,composed:!0,detail:{}},t));return this.dispatchEvent(r),r}static define(e,t=this,r={}){let d=customElements.get(e);if(!d){try{customElements.define(e,t,r)}catch{customElements.define(e,class extends t{},r)}return}let u=" (unknown version)",i=u;"version"in t&&t.version&&(u=" v"+t.version),"version"in d&&d.version&&(i=" v"+d.version),!(u&&i&&u===i)&&console.warn(`Attempted to register <${e}>${u}, but <${e}>${i} has already been registered.`)}attributeChangedCallback(e,t,r){No(this,Zi)||(this.constructor.elementProperties.forEach((d,u)=>{d.reflect&&this[u]!=null&&this.initialReflectedProperties.set(u,this[u])}),Uo(this,Zi,!0)),super.attributeChangedCallback(e,t,r)}willUpdate(e){super.willUpdate(e),this.initialReflectedProperties.forEach((t,r)=>{e.has(r)&&this[r]==null&&(this[r]=t)})}};Zi=new WeakMap;oe.version="2.20.1";oe.dependencies={};B([H()],oe.prototype,"dir",2);B([H()],oe.prototype,"lang",2);var{I:Hf}=$r;var on=(e,t)=>t===void 0?e?._$litType$!==void 0:e?._$litType$===t;var nn=e=>e.strings===void 0;var ql={},an=(e,t=ql)=>e._$AH=t;var gi=Symbol(),Qi=Symbol(),ar,lr=new Map,fe=class extends oe{constructor(){super(...arguments),this.initialRender=!1,this.svg=null,this.label="",this.library="default"}async resolveIcon(e,t){var r;let d;if(t?.spriteSheet)return this.svg=j`<svg part="svg">
        <use part="use" href="${e}"></use>
      </svg>`,this.svg;try{if(d=await fetch(e,{mode:"cors"}),!d.ok)return d.status===410?gi:Qi}catch{return Qi}try{let u=document.createElement("div");u.innerHTML=await d.text();let i=u.firstElementChild;if(((r=i?.tagName)==null?void 0:r.toLowerCase())!=="svg")return gi;ar||(ar=new DOMParser);let h=ar.parseFromString(i.outerHTML,"text/html").body.querySelector("svg");return h?(h.part.add("svg"),document.adoptNode(h)):gi}catch{return gi}}connectedCallback(){super.connectedCallback(),tn(this)}firstUpdated(){this.initialRender=!0,this.setIcon()}disconnectedCallback(){super.disconnectedCallback(),sn(this)}getIconSource(){let e=nr(this.library);return this.name&&e?{url:e.resolver(this.name),fromLibrary:!0}:{url:this.src,fromLibrary:!1}}handleLabelChange(){typeof this.label=="string"&&this.label.length>0?(this.setAttribute("role","img"),this.setAttribute("aria-label",this.label),this.removeAttribute("aria-hidden")):(this.removeAttribute("role"),this.removeAttribute("aria-label"),this.setAttribute("aria-hidden","true"))}async setIcon(){var e;let{url:t,fromLibrary:r}=this.getIconSource(),d=r?nr(this.library):void 0;if(!t){this.svg=null;return}let u=lr.get(t);if(u||(u=this.resolveIcon(t,d),lr.set(t,u)),!this.initialRender)return;let i=await u;if(i===Qi&&lr.delete(t),t===this.getIconSource().url){if(on(i)){if(this.svg=i,d){await this.updateComplete;let o=this.shadowRoot.querySelector("[part='svg']");typeof d.mutator=="function"&&o&&d.mutator(o)}return}switch(i){case Qi:case gi:this.svg=null,this.emit("sl-error");break;default:this.svg=i.cloneNode(!0),(e=d?.mutator)==null||e.call(d,this.svg),this.emit("sl-load")}}}render(){return this.svg}};fe.styles=[ae,rn];B([ue()],fe.prototype,"svg",2);B([H({reflect:!0})],fe.prototype,"name",2);B([H()],fe.prototype,"src",2);B([H()],fe.prototype,"label",2);B([H({reflect:!0})],fe.prototype,"library",2);B([ce("label")],fe.prototype,"handleLabelChange",1);B([ce(["name","src","library"])],fe.prototype,"setIcon",1);var he=Rt(class extends ot{constructor(e){if(super(e),e.type!==Pe.ATTRIBUTE||e.name!=="class"||e.strings?.length>2)throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.")}render(e){return" "+Object.keys(e).filter(t=>e[t]).join(" ")+" "}update(e,[t]){if(this.st===void 0){this.st=new Set,e.strings!==void 0&&(this.nt=new Set(e.strings.join(" ").split(/\s/).filter(d=>d!=="")));for(let d in t)t[d]&&!this.nt?.has(d)&&this.st.add(d);return this.render(t)}let r=e.element.classList;for(let d of this.st)d in t||(r.remove(d),this.st.delete(d));for(let d in t){let u=!!t[d];u===this.st.has(d)||this.nt?.has(d)||(u?(r.add(d),this.st.add(d)):(r.remove(d),this.st.delete(d)))}return ye}});var Oe=class extends oe{constructor(){super(...arguments),this.localize=new me(this),this.open=!1,this.disabled=!1}firstUpdated(){this.body.style.height=this.open?"auto":"0",this.open&&(this.details.open=!0),this.detailsObserver=new MutationObserver(e=>{for(let t of e)t.type==="attributes"&&t.attributeName==="open"&&(this.details.open?this.show():this.hide())}),this.detailsObserver.observe(this.details,{attributes:!0})}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this.detailsObserver)==null||e.disconnect()}handleSummaryClick(e){e.preventDefault(),this.disabled||(this.open?this.hide():this.show(),this.header.focus())}handleSummaryKeyDown(e){(e.key==="Enter"||e.key===" ")&&(e.preventDefault(),this.open?this.hide():this.show()),(e.key==="ArrowUp"||e.key==="ArrowLeft")&&(e.preventDefault(),this.hide()),(e.key==="ArrowDown"||e.key==="ArrowRight")&&(e.preventDefault(),this.show())}async handleOpenChange(){if(this.open){if(this.details.open=!0,this.emit("sl-show",{cancelable:!0}).defaultPrevented){this.open=!1,this.details.open=!1;return}await et(this.body);let{keyframes:t,options:r}=Je(this,"details.show",{dir:this.localize.dir()});await Qe(this.body,er(t,this.body.scrollHeight),r),this.body.style.height="auto",this.emit("sl-after-show")}else{if(this.emit("sl-hide",{cancelable:!0}).defaultPrevented){this.details.open=!0,this.open=!0;return}await et(this.body);let{keyframes:t,options:r}=Je(this,"details.hide",{dir:this.localize.dir()});await Qe(this.body,er(t,this.body.scrollHeight),r),this.body.style.height="auto",this.details.open=!1,this.emit("sl-after-hide")}}async show(){if(!(this.open||this.disabled))return this.open=!0,Ze(this,"sl-after-show")}async hide(){if(!(!this.open||this.disabled))return this.open=!1,Ze(this,"sl-after-hide")}render(){let e=this.localize.dir()==="rtl";return j`
      <details
        part="base"
        class=${he({details:!0,"details--open":this.open,"details--disabled":this.disabled,"details--rtl":e})}
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
    `}};Oe.styles=[ae,Po];Oe.dependencies={"sl-icon":fe};B([ne(".details")],Oe.prototype,"details",2);B([ne(".details__header")],Oe.prototype,"header",2);B([ne(".details__body")],Oe.prototype,"body",2);B([ne(".details__expand-icon-slot")],Oe.prototype,"expandIconSlot",2);B([H({type:Boolean,reflect:!0})],Oe.prototype,"open",2);B([H()],Oe.prototype,"summary",2);B([H({type:Boolean,reflect:!0})],Oe.prototype,"disabled",2);B([ce("open",{waitUntilFirstUpdate:!0})],Oe.prototype,"handleOpenChange",1);Ye("details.show",{keyframes:[{height:"0",opacity:"0"},{height:"auto",opacity:"1"}],options:{duration:250,easing:"linear"}});Ye("details.hide",{keyframes:[{height:"auto",opacity:"1"},{height:"0",opacity:"0"}],options:{duration:250,easing:"linear"}});Oe.define("sl-details");var ln=se`
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
`;var cn=se`
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
`;var dn=Symbol.for(""),Kl=e=>{if(e?.r===dn)return e?._$litStatic$};var $t=(e,...t)=>({_$litStatic$:t.reduce((r,d,u)=>r+(i=>{if(i._$litStatic$!==void 0)return i._$litStatic$;throw Error(`Value passed to 'literal' function must be a 'literal' result: ${i}. Use 'unsafeStatic' to pass non-literal values, but
            take care to ensure page security.`)})(d)+e[u+1],e[0]),r:dn}),hn=new Map,cr=e=>(t,...r)=>{let d=r.length,u,i,o=[],h=[],f,c=0,p=!1;for(;c<d;){for(f=t[c];c<d&&(i=r[c],(u=Kl(i))!==void 0);)f+=u+t[++c],p=!0;c!==d&&h.push(i),o.push(f),c++}if(c===d&&o.push(t[d]),p){let v=o.join("$$lit$$");(t=hn.get(v))===void 0&&(o.raw=o,hn.set(v,t=o)),r=h}return e(t,...r)},Ht=cr(j),Kp=cr(Mr),Gp=cr(Br);var Q=e=>e??J;var Ee=class extends oe{constructor(){super(...arguments),this.hasFocus=!1,this.label="",this.disabled=!1}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleClick(e){this.disabled&&(e.preventDefault(),e.stopPropagation())}click(){this.button.click()}focus(e){this.button.focus(e)}blur(){this.button.blur()}render(){let e=!!this.href,t=e?$t`a`:$t`button`;return Ht`
      <${t}
        part="base"
        class=${he({"icon-button":!0,"icon-button--disabled":!e&&this.disabled,"icon-button--focused":this.hasFocus})}
        ?disabled=${Q(e?void 0:this.disabled)}
        type=${Q(e?void 0:"button")}
        href=${Q(e?this.href:void 0)}
        target=${Q(e?this.target:void 0)}
        download=${Q(e?this.download:void 0)}
        rel=${Q(e&&this.target?"noreferrer noopener":void 0)}
        role=${Q(e?void 0:"button")}
        aria-disabled=${this.disabled?"true":"false"}
        aria-label="${this.label}"
        tabindex=${this.disabled?"-1":"0"}
        @blur=${this.handleBlur}
        @focus=${this.handleFocus}
        @click=${this.handleClick}
      >
        <sl-icon
          class="icon-button__icon"
          name=${Q(this.name)}
          library=${Q(this.library)}
          src=${Q(this.src)}
          aria-hidden="true"
        ></sl-icon>
      </${t}>
    `}};Ee.styles=[ae,cn];Ee.dependencies={"sl-icon":fe};B([ne(".icon-button")],Ee.prototype,"button",2);B([ue()],Ee.prototype,"hasFocus",2);B([H()],Ee.prototype,"name",2);B([H()],Ee.prototype,"library",2);B([H()],Ee.prototype,"src",2);B([H()],Ee.prototype,"href",2);B([H()],Ee.prototype,"target",2);B([H()],Ee.prototype,"download",2);B([H()],Ee.prototype,"label",2);B([H({type:Boolean,reflect:!0})],Ee.prototype,"disabled",2);var ht=class extends oe{constructor(){super(...arguments),this.localize=new me(this),this.variant="neutral",this.size="medium",this.pill=!1,this.removable=!1}handleRemoveClick(){this.emit("sl-remove")}render(){return j`
      <span
        part="base"
        class=${he({tag:!0,"tag--primary":this.variant==="primary","tag--success":this.variant==="success","tag--neutral":this.variant==="neutral","tag--warning":this.variant==="warning","tag--danger":this.variant==="danger","tag--text":this.variant==="text","tag--small":this.size==="small","tag--medium":this.size==="medium","tag--large":this.size==="large","tag--pill":this.pill,"tag--removable":this.removable})}
      >
        <slot part="content" class="tag__content"></slot>

        ${this.removable?j`
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
    `}};ht.styles=[ae,ln];ht.dependencies={"sl-icon-button":Ee};B([H({reflect:!0})],ht.prototype,"variant",2);B([H({reflect:!0})],ht.prototype,"size",2);B([H({type:Boolean,reflect:!0})],ht.prototype,"pill",2);B([H({type:Boolean})],ht.prototype,"removable",2);var un=se`
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
`;function Gl(e,t){return{top:Math.round(e.getBoundingClientRect().top-t.getBoundingClientRect().top),left:Math.round(e.getBoundingClientRect().left-t.getBoundingClientRect().left)}}function fn(e,t,r="vertical",d="smooth"){let u=Gl(e,t),i=u.top+t.scrollTop,o=u.left+t.scrollLeft,h=t.scrollLeft,f=t.scrollLeft+t.offsetWidth,c=t.scrollTop,p=t.scrollTop+t.offsetHeight;(r==="horizontal"||r==="both")&&(o<h?t.scrollTo({left:o,behavior:d}):o+e.clientWidth>f&&t.scrollTo({left:o-t.offsetWidth+e.clientWidth,behavior:d})),(r==="vertical"||r==="both")&&(i<c?t.scrollTo({top:i,behavior:d}):i+e.clientHeight>p&&t.scrollTo({top:i-t.offsetHeight+e.clientHeight,behavior:d}))}var es=se`
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
`;var pn=se`
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
`;var We=Math.min,we=Math.max,bi=Math.round,yi=Math.floor,Ie=e=>({x:e,y:e}),Xl={left:"right",right:"left",bottom:"top",top:"bottom"};function is(e,t,r){return we(e,We(t,r))}function St(e,t){return typeof e=="function"?e(t):e}function tt(e){return e.split("-")[0]}function wt(e){return e.split("-")[1]}function hr(e){return e==="x"?"y":"x"}function ss(e){return e==="y"?"height":"width"}function Ue(e){let t=e[0];return t==="t"||t==="b"?"y":"x"}function rs(e){return hr(Ue(e))}function gn(e,t,r){r===void 0&&(r=!1);let d=wt(e),u=rs(e),i=ss(u),o=u==="x"?d===(r?"end":"start")?"right":"left":d==="start"?"bottom":"top";return t.reference[i]>t.floating[i]&&(o=vi(o)),[o,vi(o)]}function vn(e){let t=vi(e);return[ts(e),t,ts(t)]}function ts(e){return e.includes("start")?e.replace("start","end"):e.replace("end","start")}var _n=["left","right"],mn=["right","left"],Yl=["top","bottom"],Jl=["bottom","top"];function Zl(e,t,r){switch(e){case"top":case"bottom":return r?t?mn:_n:t?_n:mn;case"left":case"right":return t?Yl:Jl;default:return[]}}function bn(e,t,r,d){let u=wt(e),i=Zl(tt(e),r==="start",d);return u&&(i=i.map(o=>o+"-"+u),t&&(i=i.concat(i.map(ts)))),i}function vi(e){let t=tt(e);return Xl[t]+e.slice(t.length)}function Ql(e){return{top:0,right:0,bottom:0,left:0,...e}}function dr(e){return typeof e!="number"?Ql(e):{top:e,right:e,bottom:e,left:e}}function Ct(e){let{x:t,y:r,width:d,height:u}=e;return{width:d,height:u,top:r,left:t,right:t+d,bottom:r+u,x:t,y:r}}function yn(e,t,r){let{reference:d,floating:u}=e,i=Ue(t),o=rs(t),h=ss(o),f=tt(t),c=i==="y",p=d.x+d.width/2-u.width/2,v=d.y+d.height/2-u.height/2,S=d[h]/2-u[h]/2,g;switch(f){case"top":g={x:p,y:d.y-u.height};break;case"bottom":g={x:p,y:d.y+d.height};break;case"right":g={x:d.x+d.width,y:v};break;case"left":g={x:d.x-u.width,y:v};break;default:g={x:d.x,y:d.y}}switch(wt(t)){case"start":g[o]-=S*(r&&c?-1:1);break;case"end":g[o]+=S*(r&&c?-1:1);break}return g}async function Sn(e,t){var r;t===void 0&&(t={});let{x:d,y:u,platform:i,rects:o,elements:h,strategy:f}=e,{boundary:c="clippingAncestors",rootBoundary:p="viewport",elementContext:v="floating",altBoundary:S=!1,padding:g=0}=St(t,e),s=dr(g),n=h[S?v==="floating"?"reference":"floating":v],l=Ct(await i.getClippingRect({element:(r=await(i.isElement==null?void 0:i.isElement(n)))==null||r?n:n.contextElement||await(i.getDocumentElement==null?void 0:i.getDocumentElement(h.floating)),boundary:c,rootBoundary:p,strategy:f})),_=v==="floating"?{x:d,y:u,width:o.floating.width,height:o.floating.height}:o.reference,b=await(i.getOffsetParent==null?void 0:i.getOffsetParent(h.floating)),y=await(i.isElement==null?void 0:i.isElement(b))?await(i.getScale==null?void 0:i.getScale(b))||{x:1,y:1}:{x:1,y:1},x=Ct(i.convertOffsetParentRelativeRectToViewportRelativeRect?await i.convertOffsetParentRelativeRectToViewportRelativeRect({elements:h,rect:_,offsetParent:b,strategy:f}):_);return{top:(l.top-x.top+s.top)/y.y,bottom:(x.bottom-l.bottom+s.bottom)/y.y,left:(l.left-x.left+s.left)/y.x,right:(x.right-l.right+s.right)/y.x}}var ec=50,wn=async(e,t,r)=>{let{placement:d="bottom",strategy:u="absolute",middleware:i=[],platform:o}=r,h=o.detectOverflow?o:{...o,detectOverflow:Sn},f=await(o.isRTL==null?void 0:o.isRTL(t)),c=await o.getElementRects({reference:e,floating:t,strategy:u}),{x:p,y:v}=yn(c,d,f),S=d,g=0,s={};for(let a=0;a<i.length;a++){let n=i[a];if(!n)continue;let{name:l,fn:_}=n,{x:b,y,data:x,reset:m}=await _({x:p,y:v,initialPlacement:d,placement:S,strategy:u,middlewareData:s,rects:c,platform:h,elements:{reference:e,floating:t}});p=b??p,v=y??v,s[l]={...s[l],...x},m&&g<ec&&(g++,typeof m=="object"&&(m.placement&&(S=m.placement),m.rects&&(c=m.rects===!0?await o.getElementRects({reference:e,floating:t,strategy:u}):m.rects),{x:p,y:v}=yn(c,S,f)),a=-1)}return{x:p,y:v,placement:S,strategy:u,middlewareData:s}},Cn=e=>({name:"arrow",options:e,async fn(t){let{x:r,y:d,placement:u,rects:i,platform:o,elements:h,middlewareData:f}=t,{element:c,padding:p=0}=St(e,t)||{};if(c==null)return{};let v=dr(p),S={x:r,y:d},g=rs(u),s=ss(g),a=await o.getDimensions(c),n=g==="y",l=n?"top":"left",_=n?"bottom":"right",b=n?"clientHeight":"clientWidth",y=i.reference[s]+i.reference[g]-S[g]-i.floating[s],x=S[g]-i.reference[g],m=await(o.getOffsetParent==null?void 0:o.getOffsetParent(c)),w=m?m[b]:0;(!w||!await(o.isElement==null?void 0:o.isElement(m)))&&(w=h.floating[b]||i.floating[s]);let A=y/2-x/2,T=w/2-a[s]/2-1,D=We(v[l],T),O=We(v[_],T),F=D,P=w-a[s]-O,M=w/2-a[s]/2+A,I=is(F,M,P),C=!f.arrow&&wt(u)!=null&&M!==I&&i.reference[s]/2-(M<F?D:O)-a[s]/2<0,k=C?M<F?M-F:M-P:0;return{[g]:S[g]+k,data:{[g]:I,centerOffset:M-I-k,...C&&{alignmentOffset:k}},reset:C}}});var xn=function(e){return e===void 0&&(e={}),{name:"flip",options:e,async fn(t){var r,d;let{placement:u,middlewareData:i,rects:o,initialPlacement:h,platform:f,elements:c}=t,{mainAxis:p=!0,crossAxis:v=!0,fallbackPlacements:S,fallbackStrategy:g="bestFit",fallbackAxisSideDirection:s="none",flipAlignment:a=!0,...n}=St(e,t);if((r=i.arrow)!=null&&r.alignmentOffset)return{};let l=tt(u),_=Ue(h),b=tt(h)===h,y=await(f.isRTL==null?void 0:f.isRTL(c.floating)),x=S||(b||!a?[vi(h)]:vn(h)),m=s!=="none";!S&&m&&x.push(...bn(h,a,s,y));let w=[h,...x],A=await f.detectOverflow(t,n),T=[],D=((d=i.flip)==null?void 0:d.overflows)||[];if(p&&T.push(A[l]),v){let M=gn(u,o,y);T.push(A[M[0]],A[M[1]])}if(D=[...D,{placement:u,overflows:T}],!T.every(M=>M<=0)){var O,F;let M=(((O=i.flip)==null?void 0:O.index)||0)+1,I=w[M];if(I&&(!(v==="alignment"?_!==Ue(I):!1)||D.every(L=>Ue(L.placement)===_?L.overflows[0]>0:!0)))return{data:{index:M,overflows:D},reset:{placement:I}};let C=(F=D.filter(k=>k.overflows[0]<=0).sort((k,L)=>k.overflows[1]-L.overflows[1])[0])==null?void 0:F.placement;if(!C)switch(g){case"bestFit":{var P;let k=(P=D.filter(L=>{if(m){let R=Ue(L.placement);return R===_||R==="y"}return!0}).map(L=>[L.placement,L.overflows.filter(R=>R>0).reduce((R,z)=>R+z,0)]).sort((L,R)=>L[1]-R[1])[0])==null?void 0:P[0];k&&(C=k);break}case"initialPlacement":C=h;break}if(u!==C)return{reset:{placement:C}}}return{}}}};var tc=new Set(["left","top"]);async function ic(e,t){let{placement:r,platform:d,elements:u}=e,i=await(d.isRTL==null?void 0:d.isRTL(u.floating)),o=tt(r),h=wt(r),f=Ue(r)==="y",c=tc.has(o)?-1:1,p=i&&f?-1:1,v=St(t,e),{mainAxis:S,crossAxis:g,alignmentAxis:s}=typeof v=="number"?{mainAxis:v,crossAxis:0,alignmentAxis:null}:{mainAxis:v.mainAxis||0,crossAxis:v.crossAxis||0,alignmentAxis:v.alignmentAxis};return h&&typeof s=="number"&&(g=h==="end"?s*-1:s),f?{x:g*p,y:S*c}:{x:S*c,y:g*p}}var En=function(e){return e===void 0&&(e=0),{name:"offset",options:e,async fn(t){var r,d;let{x:u,y:i,placement:o,middlewareData:h}=t,f=await ic(t,e);return o===((r=h.offset)==null?void 0:r.placement)&&(d=h.arrow)!=null&&d.alignmentOffset?{}:{x:u+f.x,y:i+f.y,data:{...f,placement:o}}}}},kn=function(e){return e===void 0&&(e={}),{name:"shift",options:e,async fn(t){let{x:r,y:d,placement:u,platform:i}=t,{mainAxis:o=!0,crossAxis:h=!1,limiter:f={fn:l=>{let{x:_,y:b}=l;return{x:_,y:b}}},...c}=St(e,t),p={x:r,y:d},v=await i.detectOverflow(t,c),S=Ue(tt(u)),g=hr(S),s=p[g],a=p[S];if(o){let l=g==="y"?"top":"left",_=g==="y"?"bottom":"right",b=s+v[l],y=s-v[_];s=is(b,s,y)}if(h){let l=S==="y"?"top":"left",_=S==="y"?"bottom":"right",b=a+v[l],y=a-v[_];a=is(b,a,y)}let n=f.fn({...t,[g]:s,[S]:a});return{...n,data:{x:n.x-r,y:n.y-d,enabled:{[g]:o,[S]:h}}}}}};var Ln=function(e){return e===void 0&&(e={}),{name:"size",options:e,async fn(t){var r,d;let{placement:u,rects:i,platform:o,elements:h}=t,{apply:f=()=>{},...c}=St(e,t),p=await o.detectOverflow(t,c),v=tt(u),S=wt(u),g=Ue(u)==="y",{width:s,height:a}=i.floating,n,l;v==="top"||v==="bottom"?(n=v,l=S===(await(o.isRTL==null?void 0:o.isRTL(h.floating))?"start":"end")?"left":"right"):(l=v,n=S==="end"?"top":"bottom");let _=a-p.top-p.bottom,b=s-p.left-p.right,y=We(a-p[n],_),x=We(s-p[l],b),m=!t.middlewareData.shift,w=y,A=x;if((r=t.middlewareData.shift)!=null&&r.enabled.x&&(A=b),(d=t.middlewareData.shift)!=null&&d.enabled.y&&(w=_),m&&!S){let D=we(p.left,0),O=we(p.right,0),F=we(p.top,0),P=we(p.bottom,0);g?A=s-2*(D!==0||O!==0?D+O:we(p.left,p.right)):w=a-2*(F!==0||P!==0?F+P:we(p.top,p.bottom))}await f({...t,availableWidth:A,availableHeight:w});let T=await o.getDimensions(h.floating);return s!==T.width||a!==T.height?{reset:{rects:!0}}:{}}}};function os(){return typeof window<"u"}function Et(e){return Dn(e)?(e.nodeName||"").toLowerCase():"#document"}function ke(e){var t;return(e==null||(t=e.ownerDocument)==null?void 0:t.defaultView)||window}function $e(e){var t;return(t=(Dn(e)?e.ownerDocument:e.document)||window.document)==null?void 0:t.documentElement}function Dn(e){return os()?e instanceof Node||e instanceof ke(e).Node:!1}function Me(e){return os()?e instanceof Element||e instanceof ke(e).Element:!1}function je(e){return os()?e instanceof HTMLElement||e instanceof ke(e).HTMLElement:!1}function An(e){return!os()||typeof ShadowRoot>"u"?!1:e instanceof ShadowRoot||e instanceof ke(e).ShadowRoot}function zt(e){let{overflow:t,overflowX:r,overflowY:d,display:u}=Be(e);return/auto|scroll|overlay|hidden|clip/.test(t+d+r)&&u!=="inline"&&u!=="contents"}function Rn(e){return/^(table|td|th)$/.test(Et(e))}function Si(e){try{if(e.matches(":popover-open"))return!0}catch{}try{return e.matches(":modal")}catch{return!1}}var sc=/transform|translate|scale|rotate|perspective|filter/,rc=/paint|layout|strict|content/,xt=e=>!!e&&e!=="none",ur;function Nt(e){let t=Me(e)?Be(e):e;return xt(t.transform)||xt(t.translate)||xt(t.scale)||xt(t.rotate)||xt(t.perspective)||!ns()&&(xt(t.backdropFilter)||xt(t.filter))||sc.test(t.willChange||"")||rc.test(t.contain||"")}function Tn(e){let t=it(e);for(;je(t)&&!kt(t);){if(Nt(t))return t;if(Si(t))return null;t=it(t)}return null}function ns(){return ur==null&&(ur=typeof CSS<"u"&&CSS.supports&&CSS.supports("-webkit-backdrop-filter","none")),ur}function kt(e){return/^(html|body|#document)$/.test(Et(e))}function Be(e){return ke(e).getComputedStyle(e)}function wi(e){return Me(e)?{scrollLeft:e.scrollLeft,scrollTop:e.scrollTop}:{scrollLeft:e.scrollX,scrollTop:e.scrollY}}function it(e){if(Et(e)==="html")return e;let t=e.assignedSlot||e.parentNode||An(e)&&e.host||$e(e);return An(t)?t.host:t}function On(e){let t=it(e);return kt(t)?e.ownerDocument?e.ownerDocument.body:e.body:je(t)&&zt(t)?t:On(t)}function Ft(e,t,r){var d;t===void 0&&(t=[]),r===void 0&&(r=!0);let u=On(e),i=u===((d=e.ownerDocument)==null?void 0:d.body),o=ke(u);if(i){let h=as(o);return t.concat(o,o.visualViewport||[],zt(u)?u:[],h&&r?Ft(h):[])}else return t.concat(u,Ft(u,[],r))}function as(e){return e.parent&&Object.getPrototypeOf(e.parent)?e.frameElement:null}function In(e){let t=Be(e),r=parseFloat(t.width)||0,d=parseFloat(t.height)||0,u=je(e),i=u?e.offsetWidth:r,o=u?e.offsetHeight:d,h=bi(r)!==i||bi(d)!==o;return h&&(r=i,d=o),{width:r,height:d,$:h}}function pr(e){return Me(e)?e:e.contextElement}function Wt(e){let t=pr(e);if(!je(t))return Ie(1);let r=t.getBoundingClientRect(),{width:d,height:u,$:i}=In(t),o=(i?bi(r.width):r.width)/d,h=(i?bi(r.height):r.height)/u;return(!o||!Number.isFinite(o))&&(o=1),(!h||!Number.isFinite(h))&&(h=1),{x:o,y:h}}var oc=Ie(0);function $n(e){let t=ke(e);return!ns()||!t.visualViewport?oc:{x:t.visualViewport.offsetLeft,y:t.visualViewport.offsetTop}}function nc(e,t,r){return t===void 0&&(t=!1),!r||t&&r!==ke(e)?!1:t}function Lt(e,t,r,d){t===void 0&&(t=!1),r===void 0&&(r=!1);let u=e.getBoundingClientRect(),i=pr(e),o=Ie(1);t&&(d?Me(d)&&(o=Wt(d)):o=Wt(e));let h=nc(i,r,d)?$n(i):Ie(0),f=(u.left+h.x)/o.x,c=(u.top+h.y)/o.y,p=u.width/o.x,v=u.height/o.y;if(i){let S=ke(i),g=d&&Me(d)?ke(d):d,s=S,a=as(s);for(;a&&d&&g!==s;){let n=Wt(a),l=a.getBoundingClientRect(),_=Be(a),b=l.left+(a.clientLeft+parseFloat(_.paddingLeft))*n.x,y=l.top+(a.clientTop+parseFloat(_.paddingTop))*n.y;f*=n.x,c*=n.y,p*=n.x,v*=n.y,f+=b,c+=y,s=ke(a),a=as(s)}}return Ct({width:p,height:v,x:f,y:c})}function ls(e,t){let r=wi(e).scrollLeft;return t?t.left+r:Lt($e(e)).left+r}function Hn(e,t){let r=e.getBoundingClientRect(),d=r.left+t.scrollLeft-ls(e,r),u=r.top+t.scrollTop;return{x:d,y:u}}function ac(e){let{elements:t,rect:r,offsetParent:d,strategy:u}=e,i=u==="fixed",o=$e(d),h=t?Si(t.floating):!1;if(d===o||h&&i)return r;let f={scrollLeft:0,scrollTop:0},c=Ie(1),p=Ie(0),v=je(d);if((v||!v&&!i)&&((Et(d)!=="body"||zt(o))&&(f=wi(d)),v)){let g=Lt(d);c=Wt(d),p.x=g.x+d.clientLeft,p.y=g.y+d.clientTop}let S=o&&!v&&!i?Hn(o,f):Ie(0);return{width:r.width*c.x,height:r.height*c.y,x:r.x*c.x-f.scrollLeft*c.x+p.x+S.x,y:r.y*c.y-f.scrollTop*c.y+p.y+S.y}}function lc(e){return Array.from(e.getClientRects())}function cc(e){let t=$e(e),r=wi(e),d=e.ownerDocument.body,u=we(t.scrollWidth,t.clientWidth,d.scrollWidth,d.clientWidth),i=we(t.scrollHeight,t.clientHeight,d.scrollHeight,d.clientHeight),o=-r.scrollLeft+ls(e),h=-r.scrollTop;return Be(d).direction==="rtl"&&(o+=we(t.clientWidth,d.clientWidth)-u),{width:u,height:i,x:o,y:h}}var Mn=25;function hc(e,t){let r=ke(e),d=$e(e),u=r.visualViewport,i=d.clientWidth,o=d.clientHeight,h=0,f=0;if(u){i=u.width,o=u.height;let p=ns();(!p||p&&t==="fixed")&&(h=u.offsetLeft,f=u.offsetTop)}let c=ls(d);if(c<=0){let p=d.ownerDocument,v=p.body,S=getComputedStyle(v),g=p.compatMode==="CSS1Compat"&&parseFloat(S.marginLeft)+parseFloat(S.marginRight)||0,s=Math.abs(d.clientWidth-v.clientWidth-g);s<=Mn&&(i-=s)}else c<=Mn&&(i+=c);return{width:i,height:o,x:h,y:f}}function dc(e,t){let r=Lt(e,!0,t==="fixed"),d=r.top+e.clientTop,u=r.left+e.clientLeft,i=je(e)?Wt(e):Ie(1),o=e.clientWidth*i.x,h=e.clientHeight*i.y,f=u*i.x,c=d*i.y;return{width:o,height:h,x:f,y:c}}function Bn(e,t,r){let d;if(t==="viewport")d=hc(e,r);else if(t==="document")d=cc($e(e));else if(Me(t))d=dc(t,r);else{let u=$n(e);d={x:t.x-u.x,y:t.y-u.y,width:t.width,height:t.height}}return Ct(d)}function Fn(e,t){let r=it(e);return r===t||!Me(r)||kt(r)?!1:Be(r).position==="fixed"||Fn(r,t)}function uc(e,t){let r=t.get(e);if(r)return r;let d=Ft(e,[],!1).filter(h=>Me(h)&&Et(h)!=="body"),u=null,i=Be(e).position==="fixed",o=i?it(e):e;for(;Me(o)&&!kt(o);){let h=Be(o),f=Nt(o);!f&&h.position==="fixed"&&(u=null),(i?!f&&!u:!f&&h.position==="static"&&!!u&&(u.position==="absolute"||u.position==="fixed")||zt(o)&&!f&&Fn(e,o))?d=d.filter(p=>p!==o):u=h,o=it(o)}return t.set(e,d),d}function fc(e){let{element:t,boundary:r,rootBoundary:d,strategy:u}=e,o=[...r==="clippingAncestors"?Si(t)?[]:uc(t,this._c):[].concat(r),d],h=Bn(t,o[0],u),f=h.top,c=h.right,p=h.bottom,v=h.left;for(let S=1;S<o.length;S++){let g=Bn(t,o[S],u);f=we(g.top,f),c=We(g.right,c),p=We(g.bottom,p),v=we(g.left,v)}return{width:c-v,height:p-f,x:v,y:f}}function pc(e){let{width:t,height:r}=In(e);return{width:t,height:r}}function _c(e,t,r){let d=je(t),u=$e(t),i=r==="fixed",o=Lt(e,!0,i,t),h={scrollLeft:0,scrollTop:0},f=Ie(0);function c(){f.x=ls(u)}if(d||!d&&!i)if((Et(t)!=="body"||zt(u))&&(h=wi(t)),d){let g=Lt(t,!0,i,t);f.x=g.x+t.clientLeft,f.y=g.y+t.clientTop}else u&&c();i&&!d&&u&&c();let p=u&&!d&&!i?Hn(u,h):Ie(0),v=o.left+h.scrollLeft-f.x-p.x,S=o.top+h.scrollTop-f.y-p.y;return{x:v,y:S,width:o.width,height:o.height}}function fr(e){return Be(e).position==="static"}function Pn(e,t){if(!je(e)||Be(e).position==="fixed")return null;if(t)return t(e);let r=e.offsetParent;return $e(e)===r&&(r=r.ownerDocument.body),r}function zn(e,t){let r=ke(e);if(Si(e))return r;if(!je(e)){let u=it(e);for(;u&&!kt(u);){if(Me(u)&&!fr(u))return u;u=it(u)}return r}let d=Pn(e,t);for(;d&&Rn(d)&&fr(d);)d=Pn(d,t);return d&&kt(d)&&fr(d)&&!Nt(d)?r:d||Tn(e)||r}var mc=async function(e){let t=this.getOffsetParent||zn,r=this.getDimensions,d=await r(e.floating);return{reference:_c(e.reference,await t(e.floating),e.strategy),floating:{x:0,y:0,width:d.width,height:d.height}}};function gc(e){return Be(e).direction==="rtl"}var Ci={convertOffsetParentRelativeRectToViewportRelativeRect:ac,getDocumentElement:$e,getClippingRect:fc,getOffsetParent:zn,getElementRects:mc,getClientRects:lc,getDimensions:pc,getScale:Wt,isElement:Me,isRTL:gc};function Nn(e,t){return e.x===t.x&&e.y===t.y&&e.width===t.width&&e.height===t.height}function vc(e,t){let r=null,d,u=$e(e);function i(){var h;clearTimeout(d),(h=r)==null||h.disconnect(),r=null}function o(h,f){h===void 0&&(h=!1),f===void 0&&(f=1),i();let c=e.getBoundingClientRect(),{left:p,top:v,width:S,height:g}=c;if(h||t(),!S||!g)return;let s=yi(v),a=yi(u.clientWidth-(p+S)),n=yi(u.clientHeight-(v+g)),l=yi(p),b={rootMargin:-s+"px "+-a+"px "+-n+"px "+-l+"px",threshold:we(0,We(1,f))||1},y=!0;function x(m){let w=m[0].intersectionRatio;if(w!==f){if(!y)return o();w?o(!1,w):d=setTimeout(()=>{o(!1,1e-7)},1e3)}w===1&&!Nn(c,e.getBoundingClientRect())&&o(),y=!1}try{r=new IntersectionObserver(x,{...b,root:u.ownerDocument})}catch{r=new IntersectionObserver(x,b)}r.observe(e)}return o(!0),i}function Wn(e,t,r,d){d===void 0&&(d={});let{ancestorScroll:u=!0,ancestorResize:i=!0,elementResize:o=typeof ResizeObserver=="function",layoutShift:h=typeof IntersectionObserver=="function",animationFrame:f=!1}=d,c=pr(e),p=u||i?[...c?Ft(c):[],...t?Ft(t):[]]:[];p.forEach(l=>{u&&l.addEventListener("scroll",r,{passive:!0}),i&&l.addEventListener("resize",r)});let v=c&&h?vc(c,r):null,S=-1,g=null;o&&(g=new ResizeObserver(l=>{let[_]=l;_&&_.target===c&&g&&t&&(g.unobserve(t),cancelAnimationFrame(S),S=requestAnimationFrame(()=>{var b;(b=g)==null||b.observe(t)})),r()}),c&&!f&&g.observe(c),t&&g.observe(t));let s,a=f?Lt(e):null;f&&n();function n(){let l=Lt(e);a&&!Nn(a,l)&&r(),a=l,s=requestAnimationFrame(n)}return r(),()=>{var l;p.forEach(_=>{u&&_.removeEventListener("scroll",r),i&&_.removeEventListener("resize",r)}),v?.(),(l=g)==null||l.disconnect(),g=null,f&&cancelAnimationFrame(s)}}var Un=En;var jn=kn,Vn=xn,_r=Ln;var qn=Cn;var Kn=(e,t,r)=>{let d=new Map,u={platform:Ci,...r},i={...u.platform,_c:d};return wn(e,t,{...u,platform:i})};function Gn(e){return bc(e)}function mr(e){return e.assignedSlot?e.assignedSlot:e.parentNode instanceof ShadowRoot?e.parentNode.host:e.parentNode}function bc(e){for(let t=e;t;t=mr(t))if(t instanceof Element&&getComputedStyle(t).display==="none")return null;for(let t=mr(e);t;t=mr(t)){if(!(t instanceof Element))continue;let r=getComputedStyle(t);if(r.display!=="contents"&&(r.position!=="static"||Nt(r)||t.tagName==="BODY"))return t}return null}function yc(e){return e!==null&&typeof e=="object"&&"getBoundingClientRect"in e&&("contextElement"in e?e.contextElement instanceof Element:!0)}var re=class extends oe{constructor(){super(...arguments),this.localize=new me(this),this.active=!1,this.placement="top",this.strategy="absolute",this.distance=0,this.skidding=0,this.arrow=!1,this.arrowPlacement="anchor",this.arrowPadding=10,this.flip=!1,this.flipFallbackPlacements="",this.flipFallbackStrategy="best-fit",this.flipPadding=0,this.shift=!1,this.shiftPadding=0,this.autoSizePadding=0,this.hoverBridge=!1,this.updateHoverBridge=()=>{if(this.hoverBridge&&this.anchorEl){let e=this.anchorEl.getBoundingClientRect(),t=this.popup.getBoundingClientRect(),r=this.placement.includes("top")||this.placement.includes("bottom"),d=0,u=0,i=0,o=0,h=0,f=0,c=0,p=0;r?e.top<t.top?(d=e.left,u=e.bottom,i=e.right,o=e.bottom,h=t.left,f=t.top,c=t.right,p=t.top):(d=t.left,u=t.bottom,i=t.right,o=t.bottom,h=e.left,f=e.top,c=e.right,p=e.top):e.left<t.left?(d=e.right,u=e.top,i=t.left,o=t.top,h=e.right,f=e.bottom,c=t.left,p=t.bottom):(d=t.right,u=t.top,i=e.left,o=e.top,h=t.right,f=t.bottom,c=e.left,p=e.bottom),this.style.setProperty("--hover-bridge-top-left-x",`${d}px`),this.style.setProperty("--hover-bridge-top-left-y",`${u}px`),this.style.setProperty("--hover-bridge-top-right-x",`${i}px`),this.style.setProperty("--hover-bridge-top-right-y",`${o}px`),this.style.setProperty("--hover-bridge-bottom-left-x",`${h}px`),this.style.setProperty("--hover-bridge-bottom-left-y",`${f}px`),this.style.setProperty("--hover-bridge-bottom-right-x",`${c}px`),this.style.setProperty("--hover-bridge-bottom-right-y",`${p}px`)}}}async connectedCallback(){super.connectedCallback(),await this.updateComplete,this.start()}disconnectedCallback(){super.disconnectedCallback(),this.stop()}async updated(e){super.updated(e),e.has("active")&&(this.active?this.start():this.stop()),e.has("anchor")&&this.handleAnchorChange(),this.active&&(await this.updateComplete,this.reposition())}async handleAnchorChange(){if(await this.stop(),this.anchor&&typeof this.anchor=="string"){let e=this.getRootNode();this.anchorEl=e.getElementById(this.anchor)}else this.anchor instanceof Element||yc(this.anchor)?this.anchorEl=this.anchor:this.anchorEl=this.querySelector('[slot="anchor"]');this.anchorEl instanceof HTMLSlotElement&&(this.anchorEl=this.anchorEl.assignedElements({flatten:!0})[0]),this.anchorEl&&this.active&&this.start()}start(){!this.anchorEl||!this.active||(this.cleanup=Wn(this.anchorEl,this.popup,()=>{this.reposition()}))}async stop(){return new Promise(e=>{this.cleanup?(this.cleanup(),this.cleanup=void 0,this.removeAttribute("data-current-placement"),this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height"),requestAnimationFrame(()=>e())):e()})}reposition(){if(!this.active||!this.anchorEl)return;let e=[Un({mainAxis:this.distance,crossAxis:this.skidding})];this.sync?e.push(_r({apply:({rects:r})=>{let d=this.sync==="width"||this.sync==="both",u=this.sync==="height"||this.sync==="both";this.popup.style.width=d?`${r.reference.width}px`:"",this.popup.style.height=u?`${r.reference.height}px`:""}})):(this.popup.style.width="",this.popup.style.height=""),this.flip&&e.push(Vn({boundary:this.flipBoundary,fallbackPlacements:this.flipFallbackPlacements,fallbackStrategy:this.flipFallbackStrategy==="best-fit"?"bestFit":"initialPlacement",padding:this.flipPadding})),this.shift&&e.push(jn({boundary:this.shiftBoundary,padding:this.shiftPadding})),this.autoSize?e.push(_r({boundary:this.autoSizeBoundary,padding:this.autoSizePadding,apply:({availableWidth:r,availableHeight:d})=>{this.autoSize==="vertical"||this.autoSize==="both"?this.style.setProperty("--auto-size-available-height",`${d}px`):this.style.removeProperty("--auto-size-available-height"),this.autoSize==="horizontal"||this.autoSize==="both"?this.style.setProperty("--auto-size-available-width",`${r}px`):this.style.removeProperty("--auto-size-available-width")}})):(this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height")),this.arrow&&e.push(qn({element:this.arrowEl,padding:this.arrowPadding}));let t=this.strategy==="absolute"?r=>Ci.getOffsetParent(r,Gn):Ci.getOffsetParent;Kn(this.anchorEl,this.popup,{placement:this.placement,middleware:e,strategy:this.strategy,platform:Xe(xe({},Ci),{getOffsetParent:t})}).then(({x:r,y:d,middlewareData:u,placement:i})=>{let o=this.localize.dir()==="rtl",h={top:"bottom",right:"left",bottom:"top",left:"right"}[i.split("-")[0]];if(this.setAttribute("data-current-placement",i),Object.assign(this.popup.style,{left:`${r}px`,top:`${d}px`}),this.arrow){let f=u.arrow.x,c=u.arrow.y,p="",v="",S="",g="";if(this.arrowPlacement==="start"){let s=typeof f=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";p=typeof c=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"",v=o?s:"",g=o?"":s}else if(this.arrowPlacement==="end"){let s=typeof f=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";v=o?"":s,g=o?s:"",S=typeof c=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:""}else this.arrowPlacement==="center"?(g=typeof f=="number"?"calc(50% - var(--arrow-size-diagonal))":"",p=typeof c=="number"?"calc(50% - var(--arrow-size-diagonal))":""):(g=typeof f=="number"?`${f}px`:"",p=typeof c=="number"?`${c}px`:"");Object.assign(this.arrowEl.style,{top:p,right:v,bottom:S,left:g,[h]:"calc(var(--arrow-size-diagonal) * -1)"})}}),requestAnimationFrame(()=>this.updateHoverBridge()),this.emit("sl-reposition")}render(){return j`
      <slot name="anchor" @slotchange=${this.handleAnchorChange}></slot>

      <span
        part="hover-bridge"
        class=${he({"popup-hover-bridge":!0,"popup-hover-bridge--visible":this.hoverBridge&&this.active})}
      ></span>

      <div
        part="popup"
        class=${he({popup:!0,"popup--active":this.active,"popup--fixed":this.strategy==="fixed","popup--has-arrow":this.arrow})}
      >
        <slot></slot>
        ${this.arrow?j`<div part="arrow" class="popup__arrow" role="presentation"></div>`:""}
      </div>
    `}};re.styles=[ae,pn];B([ne(".popup")],re.prototype,"popup",2);B([ne(".popup__arrow")],re.prototype,"arrowEl",2);B([H()],re.prototype,"anchor",2);B([H({type:Boolean,reflect:!0})],re.prototype,"active",2);B([H({reflect:!0})],re.prototype,"placement",2);B([H({reflect:!0})],re.prototype,"strategy",2);B([H({type:Number})],re.prototype,"distance",2);B([H({type:Number})],re.prototype,"skidding",2);B([H({type:Boolean})],re.prototype,"arrow",2);B([H({attribute:"arrow-placement"})],re.prototype,"arrowPlacement",2);B([H({attribute:"arrow-padding",type:Number})],re.prototype,"arrowPadding",2);B([H({type:Boolean})],re.prototype,"flip",2);B([H({attribute:"flip-fallback-placements",converter:{fromAttribute:e=>e.split(" ").map(t=>t.trim()).filter(t=>t!==""),toAttribute:e=>e.join(" ")}})],re.prototype,"flipFallbackPlacements",2);B([H({attribute:"flip-fallback-strategy"})],re.prototype,"flipFallbackStrategy",2);B([H({type:Object})],re.prototype,"flipBoundary",2);B([H({attribute:"flip-padding",type:Number})],re.prototype,"flipPadding",2);B([H({type:Boolean})],re.prototype,"shift",2);B([H({type:Object})],re.prototype,"shiftBoundary",2);B([H({attribute:"shift-padding",type:Number})],re.prototype,"shiftPadding",2);B([H({attribute:"auto-size"})],re.prototype,"autoSize",2);B([H()],re.prototype,"sync",2);B([H({type:Object})],re.prototype,"autoSizeBoundary",2);B([H({attribute:"auto-size-padding",type:Number})],re.prototype,"autoSizePadding",2);B([H({attribute:"hover-bridge",type:Boolean})],re.prototype,"hoverBridge",2);var xi=new WeakMap,Ei=new WeakMap,ki=new WeakMap,gr=new WeakSet,cs=new WeakMap,Ut=class{constructor(e,t){this.handleFormData=r=>{let d=this.options.disabled(this.host),u=this.options.name(this.host),i=this.options.value(this.host),o=this.host.tagName.toLowerCase()==="sl-button";this.host.isConnected&&!d&&!o&&typeof u=="string"&&u.length>0&&typeof i<"u"&&(Array.isArray(i)?i.forEach(h=>{r.formData.append(u,h.toString())}):r.formData.append(u,i.toString()))},this.handleFormSubmit=r=>{var d;let u=this.options.disabled(this.host),i=this.options.reportValidity;this.form&&!this.form.noValidate&&((d=xi.get(this.form))==null||d.forEach(o=>{this.setUserInteracted(o,!0)})),this.form&&!this.form.noValidate&&!u&&!i(this.host)&&(r.preventDefault(),r.stopImmediatePropagation())},this.handleFormReset=()=>{this.options.setValue(this.host,this.options.defaultValue(this.host)),this.setUserInteracted(this.host,!1),cs.set(this.host,[])},this.handleInteraction=r=>{let d=cs.get(this.host);d.includes(r.type)||d.push(r.type),d.length===this.options.assumeInteractionOn.length&&this.setUserInteracted(this.host,!0)},this.checkFormValidity=()=>{if(this.form&&!this.form.noValidate){let r=this.form.querySelectorAll("*");for(let d of r)if(typeof d.checkValidity=="function"&&!d.checkValidity())return!1}return!0},this.reportFormValidity=()=>{if(this.form&&!this.form.noValidate){let r=this.form.querySelectorAll("*");for(let d of r)if(typeof d.reportValidity=="function"&&!d.reportValidity())return!1}return!0},(this.host=e).addController(this),this.options=xe({form:r=>{let d=r.form;if(d){let i=r.getRootNode().querySelector(`#${d}`);if(i)return i}return r.closest("form")},name:r=>r.name,value:r=>r.value,defaultValue:r=>r.defaultValue,disabled:r=>{var d;return(d=r.disabled)!=null?d:!1},reportValidity:r=>typeof r.reportValidity=="function"?r.reportValidity():!0,checkValidity:r=>typeof r.checkValidity=="function"?r.checkValidity():!0,setValue:(r,d)=>r.value=d,assumeInteractionOn:["sl-input"]},t)}hostConnected(){let e=this.options.form(this.host);e&&this.attachForm(e),cs.set(this.host,[]),this.options.assumeInteractionOn.forEach(t=>{this.host.addEventListener(t,this.handleInteraction)})}hostDisconnected(){this.detachForm(),cs.delete(this.host),this.options.assumeInteractionOn.forEach(e=>{this.host.removeEventListener(e,this.handleInteraction)})}hostUpdated(){let e=this.options.form(this.host);e||this.detachForm(),e&&this.form!==e&&(this.detachForm(),this.attachForm(e)),this.host.hasUpdated&&this.setValidity(this.host.validity.valid)}attachForm(e){e?(this.form=e,xi.has(this.form)?xi.get(this.form).add(this.host):xi.set(this.form,new Set([this.host])),this.form.addEventListener("formdata",this.handleFormData),this.form.addEventListener("submit",this.handleFormSubmit),this.form.addEventListener("reset",this.handleFormReset),Ei.has(this.form)||(Ei.set(this.form,this.form.reportValidity),this.form.reportValidity=()=>this.reportFormValidity()),ki.has(this.form)||(ki.set(this.form,this.form.checkValidity),this.form.checkValidity=()=>this.checkFormValidity())):this.form=void 0}detachForm(){if(!this.form)return;let e=xi.get(this.form);e&&(e.delete(this.host),e.size<=0&&(this.form.removeEventListener("formdata",this.handleFormData),this.form.removeEventListener("submit",this.handleFormSubmit),this.form.removeEventListener("reset",this.handleFormReset),Ei.has(this.form)&&(this.form.reportValidity=Ei.get(this.form),Ei.delete(this.form)),ki.has(this.form)&&(this.form.checkValidity=ki.get(this.form),ki.delete(this.form)),this.form=void 0))}setUserInteracted(e,t){t?gr.add(e):gr.delete(e),e.requestUpdate()}doAction(e,t){if(this.form){let r=document.createElement("button");r.type=e,r.style.position="absolute",r.style.width="0",r.style.height="0",r.style.clipPath="inset(50%)",r.style.overflow="hidden",r.style.whiteSpace="nowrap",t&&(r.name=t.name,r.value=t.value,["formaction","formenctype","formmethod","formnovalidate","formtarget"].forEach(d=>{t.hasAttribute(d)&&r.setAttribute(d,t.getAttribute(d))})),this.form.append(r),r.click(),r.remove()}}getForm(){var e;return(e=this.form)!=null?e:null}reset(e){this.doAction("reset",e)}submit(e){this.doAction("submit",e)}setValidity(e){let t=this.host,r=!!gr.has(t),d=!!t.required;t.toggleAttribute("data-required",d),t.toggleAttribute("data-optional",!d),t.toggleAttribute("data-invalid",!e),t.toggleAttribute("data-valid",e),t.toggleAttribute("data-user-invalid",!e&&r),t.toggleAttribute("data-user-valid",e&&r)}updateValidity(){let e=this.host;this.setValidity(e.validity.valid)}emitInvalidEvent(e){let t=new CustomEvent("sl-invalid",{bubbles:!1,composed:!1,cancelable:!0,detail:{}});e||t.preventDefault(),this.host.dispatchEvent(t)||e?.preventDefault()}},hs=Object.freeze({badInput:!1,customError:!1,patternMismatch:!1,rangeOverflow:!1,rangeUnderflow:!1,stepMismatch:!1,tooLong:!1,tooShort:!1,typeMismatch:!1,valid:!0,valueMissing:!1}),am=Object.freeze(Xe(xe({},hs),{valid:!1,valueMissing:!0})),lm=Object.freeze(Xe(xe({},hs),{valid:!1,customError:!0}));var jt=class{constructor(e,...t){this.slotNames=[],this.handleSlotChange=r=>{let d=r.target;(this.slotNames.includes("[default]")&&!d.name||d.name&&this.slotNames.includes(d.name))&&this.host.requestUpdate()},(this.host=e).addController(this),this.slotNames=t}hasDefaultSlot(){return[...this.host.childNodes].some(e=>{if(e.nodeType===e.TEXT_NODE&&e.textContent.trim()!=="")return!0;if(e.nodeType===e.ELEMENT_NODE){let t=e;if(t.tagName.toLowerCase()==="sl-visually-hidden")return!1;if(!t.hasAttribute("slot"))return!0}return!1})}hasNamedSlot(e){return this.host.querySelector(`:scope > [slot="${e}"]`)!==null}test(e){return e==="[default]"?this.hasDefaultSlot():this.hasNamedSlot(e)}hostConnected(){this.host.shadowRoot.addEventListener("slotchange",this.handleSlotChange)}hostDisconnected(){this.host.shadowRoot.removeEventListener("slotchange",this.handleSlotChange)}};var Z=class extends oe{constructor(){super(...arguments),this.formControlController=new Ut(this,{assumeInteractionOn:["sl-blur","sl-input"]}),this.hasSlotController=new jt(this,"help-text","label"),this.localize=new me(this),this.typeToSelectString="",this.hasFocus=!1,this.displayLabel="",this.selectedOptions=[],this.valueHasChanged=!1,this.name="",this._value="",this.defaultValue="",this.size="medium",this.placeholder="",this.multiple=!1,this.maxOptionsVisible=3,this.disabled=!1,this.clearable=!1,this.open=!1,this.hoist=!1,this.filled=!1,this.pill=!1,this.label="",this.placement="bottom",this.helpText="",this.form="",this.required=!1,this.getTag=e=>j`
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
    `,this.handleDocumentFocusIn=e=>{let t=e.composedPath();this&&!t.includes(this)&&this.hide()},this.handleDocumentKeyDown=e=>{let t=e.target,r=t.closest(".select__clear")!==null,d=t.closest("sl-icon-button")!==null;if(!(r||d)){if(e.key==="Escape"&&this.open&&!this.closeWatcher&&(e.preventDefault(),e.stopPropagation(),this.hide(),this.displayInput.focus({preventScroll:!0})),e.key==="Enter"||e.key===" "&&this.typeToSelectString===""){if(e.preventDefault(),e.stopImmediatePropagation(),!this.open){this.show();return}this.currentOption&&!this.currentOption.disabled&&(this.valueHasChanged=!0,this.multiple?this.toggleOptionSelection(this.currentOption):this.setSelectedOptions(this.currentOption),this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}),this.multiple||(this.hide(),this.displayInput.focus({preventScroll:!0})));return}if(["ArrowUp","ArrowDown","Home","End"].includes(e.key)){let u=this.getAllOptions(),i=u.indexOf(this.currentOption),o=Math.max(0,i);if(e.preventDefault(),!this.open&&(this.show(),this.currentOption))return;e.key==="ArrowDown"?(o=i+1,o>u.length-1&&(o=0)):e.key==="ArrowUp"?(o=i-1,o<0&&(o=u.length-1)):e.key==="Home"?o=0:e.key==="End"&&(o=u.length-1),this.setCurrentOption(u[o])}if(e.key&&e.key.length===1||e.key==="Backspace"){let u=this.getAllOptions();if(e.metaKey||e.ctrlKey||e.altKey)return;if(!this.open){if(e.key==="Backspace")return;this.show()}e.stopPropagation(),e.preventDefault(),clearTimeout(this.typeToSelectTimeout),this.typeToSelectTimeout=window.setTimeout(()=>this.typeToSelectString="",1e3),e.key==="Backspace"?this.typeToSelectString=this.typeToSelectString.slice(0,-1):this.typeToSelectString+=e.key.toLowerCase();for(let i of u)if(i.getTextLabel().toLowerCase().startsWith(this.typeToSelectString)){this.setCurrentOption(i);break}}}},this.handleDocumentMouseDown=e=>{let t=e.composedPath();this&&!t.includes(this)&&this.hide()}}get value(){return this._value}set value(e){this.multiple?e=Array.isArray(e)?e:e.split(" "):e=Array.isArray(e)?e.join(" "):e,this._value!==e&&(this.valueHasChanged=!0,this._value=e)}get validity(){return this.valueInput.validity}get validationMessage(){return this.valueInput.validationMessage}connectedCallback(){super.connectedCallback(),setTimeout(()=>{this.handleDefaultSlotChange()}),this.open=!1}addOpenListeners(){var e;document.addEventListener("focusin",this.handleDocumentFocusIn),document.addEventListener("keydown",this.handleDocumentKeyDown),document.addEventListener("mousedown",this.handleDocumentMouseDown),this.getRootNode()!==document&&this.getRootNode().addEventListener("focusin",this.handleDocumentFocusIn),"CloseWatcher"in window&&((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>{this.open&&(this.hide(),this.displayInput.focus({preventScroll:!0}))})}removeOpenListeners(){var e;document.removeEventListener("focusin",this.handleDocumentFocusIn),document.removeEventListener("keydown",this.handleDocumentKeyDown),document.removeEventListener("mousedown",this.handleDocumentMouseDown),this.getRootNode()!==document&&this.getRootNode().removeEventListener("focusin",this.handleDocumentFocusIn),(e=this.closeWatcher)==null||e.destroy()}handleFocus(){this.hasFocus=!0,this.displayInput.setSelectionRange(0,0),this.emit("sl-focus")}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleLabelClick(){this.displayInput.focus()}handleComboboxMouseDown(e){let r=e.composedPath().some(d=>d instanceof Element&&d.tagName.toLowerCase()==="sl-icon-button");this.disabled||r||(e.preventDefault(),this.displayInput.focus({preventScroll:!0}),this.open=!this.open)}handleComboboxKeyDown(e){e.key!=="Tab"&&(e.stopPropagation(),this.handleDocumentKeyDown(e))}handleClearClick(e){e.stopPropagation(),this.valueHasChanged=!0,this.value!==""&&(this.setSelectedOptions([]),this.displayInput.focus({preventScroll:!0}),this.updateComplete.then(()=>{this.emit("sl-clear"),this.emit("sl-input"),this.emit("sl-change")}))}handleClearMouseDown(e){e.stopPropagation(),e.preventDefault()}handleOptionClick(e){let r=e.target.closest("sl-option"),d=this.value;r&&!r.disabled&&(this.valueHasChanged=!0,this.multiple?this.toggleOptionSelection(r):this.setSelectedOptions(r),this.updateComplete.then(()=>this.displayInput.focus({preventScroll:!0})),this.value!==d&&this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}),this.multiple||(this.hide(),this.displayInput.focus({preventScroll:!0})))}handleDefaultSlotChange(){customElements.get("sl-option")||customElements.whenDefined("sl-option").then(()=>this.handleDefaultSlotChange());let e=this.getAllOptions(),t=this.valueHasChanged?this.value:this.defaultValue,r=Array.isArray(t)?t:[t],d=[];e.forEach(u=>d.push(u.value)),this.setSelectedOptions(e.filter(u=>r.includes(u.value)))}handleTagRemove(e,t){e.stopPropagation(),this.valueHasChanged=!0,this.disabled||(this.toggleOptionSelection(t,!1),this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}))}getAllOptions(){return[...this.querySelectorAll("sl-option")]}getFirstOption(){return this.querySelector("sl-option")}setCurrentOption(e){this.getAllOptions().forEach(r=>{r.current=!1,r.tabIndex=-1}),e&&(this.currentOption=e,e.current=!0,e.tabIndex=0,e.focus())}setSelectedOptions(e){let t=this.getAllOptions(),r=Array.isArray(e)?e:[e];t.forEach(d=>d.selected=!1),r.length&&r.forEach(d=>d.selected=!0),this.selectionChanged()}toggleOptionSelection(e,t){t===!0||t===!1?e.selected=t:e.selected=!e.selected,this.selectionChanged()}selectionChanged(){var e,t,r;let d=this.getAllOptions();this.selectedOptions=d.filter(i=>i.selected);let u=this.valueHasChanged;if(this.multiple)this.value=this.selectedOptions.map(i=>i.value),this.placeholder&&this.value.length===0?this.displayLabel="":this.displayLabel=this.localize.term("numOptionsSelected",this.selectedOptions.length);else{let i=this.selectedOptions[0];this.value=(e=i?.value)!=null?e:"",this.displayLabel=(r=(t=i?.getTextLabel)==null?void 0:t.call(i))!=null?r:""}this.valueHasChanged=u,this.updateComplete.then(()=>{this.formControlController.updateValidity()})}get tags(){return this.selectedOptions.map((e,t)=>{if(t<this.maxOptionsVisible||this.maxOptionsVisible<=0){let r=this.getTag(e,t);return j`<div @sl-remove=${d=>this.handleTagRemove(d,e)}>
          ${typeof r=="string"?de(r):r}
        </div>`}else if(t===this.maxOptionsVisible)return j`<sl-tag size=${this.size}>+${this.selectedOptions.length-t}</sl-tag>`;return j``})}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleDisabledChange(){this.disabled&&(this.open=!1,this.handleOpenChange())}attributeChangedCallback(e,t,r){if(super.attributeChangedCallback(e,t,r),e==="value"){let d=this.valueHasChanged;this.value=this.defaultValue,this.valueHasChanged=d}}handleValueChange(){if(!this.valueHasChanged){let r=this.valueHasChanged;this.value=this.defaultValue,this.valueHasChanged=r}let e=this.getAllOptions(),t=Array.isArray(this.value)?this.value:[this.value];this.setSelectedOptions(e.filter(r=>t.includes(r.value)))}async handleOpenChange(){if(this.open&&!this.disabled){this.setCurrentOption(this.selectedOptions[0]||this.getFirstOption()),this.emit("sl-show"),this.addOpenListeners(),await et(this),this.listbox.hidden=!1,this.popup.active=!0,requestAnimationFrame(()=>{this.setCurrentOption(this.currentOption)});let{keyframes:e,options:t}=Je(this,"select.show",{dir:this.localize.dir()});await Qe(this.popup.popup,e,t),this.currentOption&&fn(this.currentOption,this.listbox,"vertical","auto"),this.emit("sl-after-show")}else{this.emit("sl-hide"),this.removeOpenListeners(),await et(this);let{keyframes:e,options:t}=Je(this,"select.hide",{dir:this.localize.dir()});await Qe(this.popup.popup,e,t),this.listbox.hidden=!0,this.popup.active=!1,this.emit("sl-after-hide")}}async show(){if(this.open||this.disabled){this.open=!1;return}return this.open=!0,Ze(this,"sl-after-show")}async hide(){if(!this.open||this.disabled){this.open=!1;return}return this.open=!1,Ze(this,"sl-after-hide")}checkValidity(){return this.valueInput.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.valueInput.reportValidity()}setCustomValidity(e){this.valueInput.setCustomValidity(e),this.formControlController.updateValidity()}focus(e){this.displayInput.focus(e)}blur(){this.displayInput.blur()}render(){let e=this.hasSlotController.test("label"),t=this.hasSlotController.test("help-text"),r=this.label?!0:!!e,d=this.helpText?!0:!!t,u=this.clearable&&!this.disabled&&this.value.length>0,i=this.placeholder&&this.value&&this.value.length<=0;return j`
      <div
        part="form-control"
        class=${he({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-label":r,"form-control--has-help-text":d})}
      >
        <label
          id="label"
          part="form-control-label"
          class="form-control__label"
          aria-hidden=${r?"false":"true"}
          @click=${this.handleLabelClick}
        >
          <slot name="label">${this.label}</slot>
        </label>

        <div part="form-control-input" class="form-control-input">
          <sl-popup
            class=${he({select:!0,"select--standard":!0,"select--filled":this.filled,"select--pill":this.pill,"select--open":this.open,"select--disabled":this.disabled,"select--multiple":this.multiple,"select--focused":this.hasFocus,"select--placeholder-visible":i,"select--top":this.placement==="top","select--bottom":this.placement==="bottom","select--small":this.size==="small","select--medium":this.size==="medium","select--large":this.size==="large"})}
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

              ${this.multiple?j`<div part="tags" class="select__tags">${this.tags}</div>`:""}

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

              ${u?j`
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
          aria-hidden=${d?"false":"true"}
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `}};Z.styles=[ae,es,un];Z.dependencies={"sl-icon":fe,"sl-popup":re,"sl-tag":ht};B([ne(".select")],Z.prototype,"popup",2);B([ne(".select__combobox")],Z.prototype,"combobox",2);B([ne(".select__display-input")],Z.prototype,"displayInput",2);B([ne(".select__value-input")],Z.prototype,"valueInput",2);B([ne(".select__listbox")],Z.prototype,"listbox",2);B([ue()],Z.prototype,"hasFocus",2);B([ue()],Z.prototype,"displayLabel",2);B([ue()],Z.prototype,"currentOption",2);B([ue()],Z.prototype,"selectedOptions",2);B([ue()],Z.prototype,"valueHasChanged",2);B([H()],Z.prototype,"name",2);B([ue()],Z.prototype,"value",1);B([H({attribute:"value"})],Z.prototype,"defaultValue",2);B([H({reflect:!0})],Z.prototype,"size",2);B([H()],Z.prototype,"placeholder",2);B([H({type:Boolean,reflect:!0})],Z.prototype,"multiple",2);B([H({attribute:"max-options-visible",type:Number})],Z.prototype,"maxOptionsVisible",2);B([H({type:Boolean,reflect:!0})],Z.prototype,"disabled",2);B([H({type:Boolean})],Z.prototype,"clearable",2);B([H({type:Boolean,reflect:!0})],Z.prototype,"open",2);B([H({type:Boolean})],Z.prototype,"hoist",2);B([H({type:Boolean,reflect:!0})],Z.prototype,"filled",2);B([H({type:Boolean,reflect:!0})],Z.prototype,"pill",2);B([H()],Z.prototype,"label",2);B([H({reflect:!0})],Z.prototype,"placement",2);B([H({attribute:"help-text"})],Z.prototype,"helpText",2);B([H({reflect:!0})],Z.prototype,"form",2);B([H({type:Boolean,reflect:!0})],Z.prototype,"required",2);B([H()],Z.prototype,"getTag",2);B([ce("disabled",{waitUntilFirstUpdate:!0})],Z.prototype,"handleDisabledChange",1);B([ce(["defaultValue","value"],{waitUntilFirstUpdate:!0})],Z.prototype,"handleValueChange",1);B([ce("open",{waitUntilFirstUpdate:!0})],Z.prototype,"handleOpenChange",1);Ye("select.show",{keyframes:[{opacity:0,scale:.9},{opacity:1,scale:1}],options:{duration:100,easing:"ease"}});Ye("select.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.9}],options:{duration:100,easing:"ease"}});Z.define("sl-select");var Xn=se`
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
`;var Ae=class extends oe{constructor(){super(...arguments),this.localize=new me(this),this.isInitialized=!1,this.current=!1,this.selected=!1,this.hasHover=!1,this.value="",this.disabled=!1}connectedCallback(){super.connectedCallback(),this.setAttribute("role","option"),this.setAttribute("aria-selected","false")}handleDefaultSlotChange(){this.isInitialized?customElements.whenDefined("sl-select").then(()=>{let e=this.closest("sl-select");e&&e.handleDefaultSlotChange()}):this.isInitialized=!0}handleMouseEnter(){this.hasHover=!0}handleMouseLeave(){this.hasHover=!1}handleDisabledChange(){this.setAttribute("aria-disabled",this.disabled?"true":"false")}handleSelectedChange(){this.setAttribute("aria-selected",this.selected?"true":"false")}handleValueChange(){typeof this.value!="string"&&(this.value=String(this.value)),this.value.includes(" ")&&(console.error("Option values cannot include a space. All spaces have been replaced with underscores.",this),this.value=this.value.replace(/ /g,"_"))}getTextLabel(){let e=this.childNodes,t="";return[...e].forEach(r=>{r.nodeType===Node.ELEMENT_NODE&&(r.hasAttribute("slot")||(t+=r.textContent)),r.nodeType===Node.TEXT_NODE&&(t+=r.textContent)}),t.trim()}render(){return j`
      <div
        part="base"
        class=${he({option:!0,"option--current":this.current,"option--disabled":this.disabled,"option--selected":this.selected,"option--hover":this.hasHover})}
        @mouseenter=${this.handleMouseEnter}
        @mouseleave=${this.handleMouseLeave}
      >
        <sl-icon part="checked-icon" class="option__check" name="check" library="system" aria-hidden="true"></sl-icon>
        <slot part="prefix" name="prefix" class="option__prefix"></slot>
        <slot part="label" class="option__label" @slotchange=${this.handleDefaultSlotChange}></slot>
        <slot part="suffix" name="suffix" class="option__suffix"></slot>
      </div>
    `}};Ae.styles=[ae,Xn];Ae.dependencies={"sl-icon":fe};B([ne(".option__label")],Ae.prototype,"defaultSlot",2);B([ue()],Ae.prototype,"current",2);B([ue()],Ae.prototype,"selected",2);B([ue()],Ae.prototype,"hasHover",2);B([H({reflect:!0})],Ae.prototype,"value",2);B([H({type:Boolean,reflect:!0})],Ae.prototype,"disabled",2);B([ce("disabled")],Ae.prototype,"handleDisabledChange",1);B([ce("selected")],Ae.prototype,"handleSelectedChange",1);B([ce("value")],Ae.prototype,"handleValueChange",1);Ae.define("sl-option");var Yn=se`
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
`;var Jn=(e="value")=>(t,r)=>{let d=t.constructor,u=d.prototype.attributeChangedCallback;d.prototype.attributeChangedCallback=function(i,o,h){var f;let c=d.getPropertyOptions(e),p=typeof c.attribute=="string"?c.attribute:e;if(i===p){let v=c.converter||lt,g=(typeof v=="function"?v:(f=v?.fromAttribute)!=null?f:lt.fromAttribute)(h,c.type);this[e]!==g&&(this[r]=g)}u.call(this,i,o,h)}};var Zn=Rt(class extends ot{constructor(e){if(super(e),e.type!==Pe.PROPERTY&&e.type!==Pe.ATTRIBUTE&&e.type!==Pe.BOOLEAN_ATTRIBUTE)throw Error("The `live` directive is not allowed on child or event bindings");if(!nn(e))throw Error("`live` bindings can only contain a single expression")}render(e){return e}update(e,[t]){if(t===ye||t===J)return t;let r=e.element,d=e.name;if(e.type===Pe.PROPERTY){if(t===r[d])return ye}else if(e.type===Pe.BOOLEAN_ATTRIBUTE){if(!!t===r.hasAttribute(d))return ye}else if(e.type===Pe.ATTRIBUTE&&r.getAttribute(d)===t+"")return ye;return an(e),t}});var X=class extends oe{constructor(){super(...arguments),this.formControlController=new Ut(this,{assumeInteractionOn:["sl-blur","sl-input"]}),this.hasSlotController=new jt(this,"help-text","label"),this.localize=new me(this),this.hasFocus=!1,this.title="",this.__numberInput=Object.assign(document.createElement("input"),{type:"number"}),this.__dateInput=Object.assign(document.createElement("input"),{type:"date"}),this.type="text",this.name="",this.value="",this.defaultValue="",this.size="medium",this.filled=!1,this.pill=!1,this.label="",this.helpText="",this.clearable=!1,this.disabled=!1,this.placeholder="",this.readonly=!1,this.passwordToggle=!1,this.passwordVisible=!1,this.noSpinButtons=!1,this.form="",this.required=!1,this.spellcheck=!0}get valueAsDate(){var e;return this.__dateInput.type=this.type,this.__dateInput.value=this.value,((e=this.input)==null?void 0:e.valueAsDate)||this.__dateInput.valueAsDate}set valueAsDate(e){this.__dateInput.type=this.type,this.__dateInput.valueAsDate=e,this.value=this.__dateInput.value}get valueAsNumber(){var e;return this.__numberInput.value=this.value,((e=this.input)==null?void 0:e.valueAsNumber)||this.__numberInput.valueAsNumber}set valueAsNumber(e){this.__numberInput.valueAsNumber=e,this.value=this.__numberInput.value}get validity(){return this.input.validity}get validationMessage(){return this.input.validationMessage}firstUpdated(){this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleChange(){this.value=this.input.value,this.emit("sl-change")}handleClearClick(e){e.preventDefault(),this.value!==""&&(this.value="",this.emit("sl-clear"),this.emit("sl-input"),this.emit("sl-change")),this.input.focus()}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleInput(){this.value=this.input.value,this.formControlController.updateValidity(),this.emit("sl-input")}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleKeyDown(e){let t=e.metaKey||e.ctrlKey||e.shiftKey||e.altKey;e.key==="Enter"&&!t&&setTimeout(()=>{!e.defaultPrevented&&!e.isComposing&&this.formControlController.submit()})}handlePasswordToggle(){this.passwordVisible=!this.passwordVisible}handleDisabledChange(){this.formControlController.setValidity(this.disabled)}handleStepChange(){this.input.step=String(this.step),this.formControlController.updateValidity()}async handleValueChange(){await this.updateComplete,this.formControlController.updateValidity()}focus(e){this.input.focus(e)}blur(){this.input.blur()}select(){this.input.select()}setSelectionRange(e,t,r="none"){this.input.setSelectionRange(e,t,r)}setRangeText(e,t,r,d="preserve"){let u=t??this.input.selectionStart,i=r??this.input.selectionEnd;this.input.setRangeText(e,u,i,d),this.value!==this.input.value&&(this.value=this.input.value)}showPicker(){"showPicker"in HTMLInputElement.prototype&&this.input.showPicker()}stepUp(){this.input.stepUp(),this.value!==this.input.value&&(this.value=this.input.value)}stepDown(){this.input.stepDown(),this.value!==this.input.value&&(this.value=this.input.value)}checkValidity(){return this.input.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.input.reportValidity()}setCustomValidity(e){this.input.setCustomValidity(e),this.formControlController.updateValidity()}render(){let e=this.hasSlotController.test("label"),t=this.hasSlotController.test("help-text"),r=this.label?!0:!!e,d=this.helpText?!0:!!t,i=this.clearable&&!this.disabled&&!this.readonly&&(typeof this.value=="number"||this.value.length>0);return j`
      <div
        part="form-control"
        class=${he({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-label":r,"form-control--has-help-text":d})}
      >
        <label
          part="form-control-label"
          class="form-control__label"
          for="input"
          aria-hidden=${r?"false":"true"}
        >
          <slot name="label">${this.label}</slot>
        </label>

        <div part="form-control-input" class="form-control-input">
          <div
            part="base"
            class=${he({input:!0,"input--small":this.size==="small","input--medium":this.size==="medium","input--large":this.size==="large","input--pill":this.pill,"input--standard":!this.filled,"input--filled":this.filled,"input--disabled":this.disabled,"input--focused":this.hasFocus,"input--empty":!this.value,"input--no-spin-buttons":this.noSpinButtons})}
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
              name=${Q(this.name)}
              ?disabled=${this.disabled}
              ?readonly=${this.readonly}
              ?required=${this.required}
              placeholder=${Q(this.placeholder)}
              minlength=${Q(this.minlength)}
              maxlength=${Q(this.maxlength)}
              min=${Q(this.min)}
              max=${Q(this.max)}
              step=${Q(this.step)}
              .value=${Zn(this.value)}
              autocapitalize=${Q(this.autocapitalize)}
              autocomplete=${Q(this.autocomplete)}
              autocorrect=${Q(this.autocorrect)}
              ?autofocus=${this.autofocus}
              spellcheck=${this.spellcheck}
              pattern=${Q(this.pattern)}
              enterkeyhint=${Q(this.enterkeyhint)}
              inputmode=${Q(this.inputmode)}
              aria-describedby="help-text"
              @change=${this.handleChange}
              @input=${this.handleInput}
              @invalid=${this.handleInvalid}
              @keydown=${this.handleKeyDown}
              @focus=${this.handleFocus}
              @blur=${this.handleBlur}
            />

            ${i?j`
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
            ${this.passwordToggle&&!this.disabled?j`
                  <button
                    part="password-toggle-button"
                    class="input__password-toggle"
                    type="button"
                    aria-label=${this.localize.term(this.passwordVisible?"hidePassword":"showPassword")}
                    @click=${this.handlePasswordToggle}
                    tabindex="-1"
                  >
                    ${this.passwordVisible?j`
                          <slot name="show-password-icon">
                            <sl-icon name="eye-slash" library="system"></sl-icon>
                          </slot>
                        `:j`
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
          aria-hidden=${d?"false":"true"}
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `}};X.styles=[ae,es,Yn];X.dependencies={"sl-icon":fe};B([ne(".input__control")],X.prototype,"input",2);B([ue()],X.prototype,"hasFocus",2);B([H()],X.prototype,"title",2);B([H({reflect:!0})],X.prototype,"type",2);B([H()],X.prototype,"name",2);B([H()],X.prototype,"value",2);B([Jn()],X.prototype,"defaultValue",2);B([H({reflect:!0})],X.prototype,"size",2);B([H({type:Boolean,reflect:!0})],X.prototype,"filled",2);B([H({type:Boolean,reflect:!0})],X.prototype,"pill",2);B([H()],X.prototype,"label",2);B([H({attribute:"help-text"})],X.prototype,"helpText",2);B([H({type:Boolean})],X.prototype,"clearable",2);B([H({type:Boolean,reflect:!0})],X.prototype,"disabled",2);B([H()],X.prototype,"placeholder",2);B([H({type:Boolean,reflect:!0})],X.prototype,"readonly",2);B([H({attribute:"password-toggle",type:Boolean})],X.prototype,"passwordToggle",2);B([H({attribute:"password-visible",type:Boolean})],X.prototype,"passwordVisible",2);B([H({attribute:"no-spin-buttons",type:Boolean})],X.prototype,"noSpinButtons",2);B([H({reflect:!0})],X.prototype,"form",2);B([H({type:Boolean,reflect:!0})],X.prototype,"required",2);B([H()],X.prototype,"pattern",2);B([H({type:Number})],X.prototype,"minlength",2);B([H({type:Number})],X.prototype,"maxlength",2);B([H()],X.prototype,"min",2);B([H()],X.prototype,"max",2);B([H()],X.prototype,"step",2);B([H()],X.prototype,"autocapitalize",2);B([H()],X.prototype,"autocorrect",2);B([H()],X.prototype,"autocomplete",2);B([H({type:Boolean})],X.prototype,"autofocus",2);B([H()],X.prototype,"enterkeyhint",2);B([H({type:Boolean,converter:{fromAttribute:e=>!(!e||e==="false"),toAttribute:e=>e?"true":"false"}})],X.prototype,"spellcheck",2);B([H()],X.prototype,"inputmode",2);B([ce("disabled",{waitUntilFirstUpdate:!0})],X.prototype,"handleDisabledChange",1);B([ce("step",{waitUntilFirstUpdate:!0})],X.prototype,"handleStepChange",1);B([ce("value",{waitUntilFirstUpdate:!0})],X.prototype,"handleValueChange",1);X.define("sl-input");var Qn=se`
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
`;var vr=class extends oe{constructor(){super(...arguments),this.localize=new me(this)}render(){return j`
      <svg part="base" class="spinner" role="progressbar" aria-label=${this.localize.term("loading")}>
        <circle class="spinner__track"></circle>
        <circle class="spinner__indicator"></circle>
      </svg>
    `}};vr.styles=[ae,Qn];var ea=se`
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
`;var ee=class extends oe{constructor(){super(...arguments),this.formControlController=new Ut(this,{assumeInteractionOn:["click"]}),this.hasSlotController=new jt(this,"[default]","prefix","suffix"),this.localize=new me(this),this.hasFocus=!1,this.invalid=!1,this.title="",this.variant="default",this.size="medium",this.caret=!1,this.disabled=!1,this.loading=!1,this.outline=!1,this.pill=!1,this.circle=!1,this.type="button",this.name="",this.value="",this.href="",this.rel="noreferrer noopener"}get validity(){return this.isButton()?this.button.validity:hs}get validationMessage(){return this.isButton()?this.button.validationMessage:""}firstUpdated(){this.isButton()&&this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleClick(){this.type==="submit"&&this.formControlController.submit(this),this.type==="reset"&&this.formControlController.reset(this)}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}isButton(){return!this.href}isLink(){return!!this.href}handleDisabledChange(){this.isButton()&&this.formControlController.setValidity(this.disabled)}click(){this.button.click()}focus(e){this.button.focus(e)}blur(){this.button.blur()}checkValidity(){return this.isButton()?this.button.checkValidity():!0}getForm(){return this.formControlController.getForm()}reportValidity(){return this.isButton()?this.button.reportValidity():!0}setCustomValidity(e){this.isButton()&&(this.button.setCustomValidity(e),this.formControlController.updateValidity())}render(){let e=this.isLink(),t=e?$t`a`:$t`button`;return Ht`
      <${t}
        part="base"
        class=${he({button:!0,"button--default":this.variant==="default","button--primary":this.variant==="primary","button--success":this.variant==="success","button--neutral":this.variant==="neutral","button--warning":this.variant==="warning","button--danger":this.variant==="danger","button--text":this.variant==="text","button--small":this.size==="small","button--medium":this.size==="medium","button--large":this.size==="large","button--caret":this.caret,"button--circle":this.circle,"button--disabled":this.disabled,"button--focused":this.hasFocus,"button--loading":this.loading,"button--standard":!this.outline,"button--outline":this.outline,"button--pill":this.pill,"button--rtl":this.localize.dir()==="rtl","button--has-label":this.hasSlotController.test("[default]"),"button--has-prefix":this.hasSlotController.test("prefix"),"button--has-suffix":this.hasSlotController.test("suffix")})}
        ?disabled=${Q(e?void 0:this.disabled)}
        type=${Q(e?void 0:this.type)}
        title=${this.title}
        name=${Q(e?void 0:this.name)}
        value=${Q(e?void 0:this.value)}
        href=${Q(e&&!this.disabled?this.href:void 0)}
        target=${Q(e?this.target:void 0)}
        download=${Q(e?this.download:void 0)}
        rel=${Q(e?this.rel:void 0)}
        role=${Q(e?void 0:"button")}
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
        ${this.caret?Ht` <sl-icon part="caret" class="button__caret" library="system" name="caret"></sl-icon> `:""}
        ${this.loading?Ht`<sl-spinner part="spinner"></sl-spinner>`:""}
      </${t}>
    `}};ee.styles=[ae,ea];ee.dependencies={"sl-icon":fe,"sl-spinner":vr};B([ne(".button")],ee.prototype,"button",2);B([ue()],ee.prototype,"hasFocus",2);B([ue()],ee.prototype,"invalid",2);B([H()],ee.prototype,"title",2);B([H({reflect:!0})],ee.prototype,"variant",2);B([H({reflect:!0})],ee.prototype,"size",2);B([H({type:Boolean,reflect:!0})],ee.prototype,"caret",2);B([H({type:Boolean,reflect:!0})],ee.prototype,"disabled",2);B([H({type:Boolean,reflect:!0})],ee.prototype,"loading",2);B([H({type:Boolean,reflect:!0})],ee.prototype,"outline",2);B([H({type:Boolean,reflect:!0})],ee.prototype,"pill",2);B([H({type:Boolean,reflect:!0})],ee.prototype,"circle",2);B([H()],ee.prototype,"type",2);B([H()],ee.prototype,"name",2);B([H()],ee.prototype,"value",2);B([H()],ee.prototype,"href",2);B([H()],ee.prototype,"target",2);B([H()],ee.prototype,"rel",2);B([H()],ee.prototype,"download",2);B([H()],ee.prototype,"form",2);B([H({attribute:"formaction"})],ee.prototype,"formAction",2);B([H({attribute:"formenctype"})],ee.prototype,"formEnctype",2);B([H({attribute:"formmethod"})],ee.prototype,"formMethod",2);B([H({attribute:"formnovalidate",type:Boolean})],ee.prototype,"formNoValidate",2);B([H({attribute:"formtarget"})],ee.prototype,"formTarget",2);B([ce("disabled",{waitUntilFirstUpdate:!0})],ee.prototype,"handleDisabledChange",1);ee.define("sl-button");var ta=se`
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
`;var Vt=class extends oe{constructor(){super(...arguments),this.variant="primary",this.pill=!1,this.pulse=!1}render(){return j`
      <span
        part="base"
        class=${he({badge:!0,"badge--primary":this.variant==="primary","badge--success":this.variant==="success","badge--neutral":this.variant==="neutral","badge--warning":this.variant==="warning","badge--danger":this.variant==="danger","badge--pill":this.pill,"badge--pulse":this.pulse})}
        role="status"
      >
        <slot></slot>
      </span>
    `}};Vt.styles=[ae,ta];B([H({reflect:!0})],Vt.prototype,"variant",2);B([H({type:Boolean,reflect:!0})],Vt.prototype,"pill",2);B([H({type:Boolean,reflect:!0})],Vt.prototype,"pulse",2);Vt.define("sl-badge");var ia=se`
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
`;var ge=class extends oe{constructor(){super(),this.localize=new me(this),this.content="",this.placement="top",this.disabled=!1,this.distance=8,this.open=!1,this.skidding=0,this.trigger="hover focus",this.hoist=!1,this.handleBlur=()=>{this.hasTrigger("focus")&&this.hide()},this.handleClick=()=>{this.hasTrigger("click")&&(this.open?this.hide():this.show())},this.handleFocus=()=>{this.hasTrigger("focus")&&this.show()},this.handleDocumentKeyDown=e=>{e.key==="Escape"&&(e.stopPropagation(),this.hide())},this.handleMouseOver=()=>{if(this.hasTrigger("hover")){let e=Qs(getComputedStyle(this).getPropertyValue("--show-delay"));clearTimeout(this.hoverTimeout),this.hoverTimeout=window.setTimeout(()=>this.show(),e)}},this.handleMouseOut=()=>{if(this.hasTrigger("hover")){let e=Qs(getComputedStyle(this).getPropertyValue("--hide-delay"));clearTimeout(this.hoverTimeout),this.hoverTimeout=window.setTimeout(()=>this.hide(),e)}},this.addEventListener("blur",this.handleBlur,!0),this.addEventListener("focus",this.handleFocus,!0),this.addEventListener("click",this.handleClick),this.addEventListener("mouseover",this.handleMouseOver),this.addEventListener("mouseout",this.handleMouseOut)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this.closeWatcher)==null||e.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown)}firstUpdated(){this.body.hidden=!this.open,this.open&&(this.popup.active=!0,this.popup.reposition())}hasTrigger(e){return this.trigger.split(" ").includes(e)}async handleOpenChange(){var e,t;if(this.open){if(this.disabled)return;this.emit("sl-show"),"CloseWatcher"in window?((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>{this.hide()}):document.addEventListener("keydown",this.handleDocumentKeyDown),await et(this.body),this.body.hidden=!1,this.popup.active=!0;let{keyframes:r,options:d}=Je(this,"tooltip.show",{dir:this.localize.dir()});await Qe(this.popup.popup,r,d),this.popup.reposition(),this.emit("sl-after-show")}else{this.emit("sl-hide"),(t=this.closeWatcher)==null||t.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown),await et(this.body);let{keyframes:r,options:d}=Je(this,"tooltip.hide",{dir:this.localize.dir()});await Qe(this.popup.popup,r,d),this.popup.active=!1,this.body.hidden=!0,this.emit("sl-after-hide")}}async handleOptionsChange(){this.hasUpdated&&(await this.updateComplete,this.popup.reposition())}handleDisabledChange(){this.disabled&&this.open&&this.hide()}async show(){if(!this.open)return this.open=!0,Ze(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,Ze(this,"sl-after-hide")}render(){return j`
      <sl-popup
        part="base"
        exportparts="
          popup:base__popup,
          arrow:base__arrow
        "
        class=${he({tooltip:!0,"tooltip--open":this.open})}
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
    `}};ge.styles=[ae,ia];ge.dependencies={"sl-popup":re};B([ne("slot:not([name])")],ge.prototype,"defaultSlot",2);B([ne(".tooltip__body")],ge.prototype,"body",2);B([ne("sl-popup")],ge.prototype,"popup",2);B([H()],ge.prototype,"content",2);B([H()],ge.prototype,"placement",2);B([H({type:Boolean,reflect:!0})],ge.prototype,"disabled",2);B([H({type:Number})],ge.prototype,"distance",2);B([H({type:Boolean,reflect:!0})],ge.prototype,"open",2);B([H({type:Number})],ge.prototype,"skidding",2);B([H()],ge.prototype,"trigger",2);B([H({type:Boolean})],ge.prototype,"hoist",2);B([ce("open",{waitUntilFirstUpdate:!0})],ge.prototype,"handleOpenChange",1);B([ce(["content","distance","hoist","placement","skidding"])],ge.prototype,"handleOptionsChange",1);B([ce("disabled")],ge.prototype,"handleDisabledChange",1);Ye("tooltip.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:150,easing:"ease"}});Ye("tooltip.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:150,easing:"ease"}});ge.define("sl-tooltip");var Se=Hr(),pe=Nr(),be=Cs(location.hash),ra=pe.getState(),br=!0,Li="*",yr="",Sr={};pe.on("runs-list",e=>{let t={};for(let r of e.runs||[])t[r.id]=r;Se.setState({runs:t}),e.settings&&(Sr=e.settings)});pe.on("run-snapshot",e=>{e&&e.id&&Se.setRun(e.id,e)});pe.on("run-update",e=>{e&&e.id&&Se.setRun(e.id,e)});pe.on("log-line",e=>{e&&(Se.appendLog(e),Ys(e))});pe.on("log-bulk",e=>{if(e&&Array.isArray(e.lines))for(let t of e.lines){let r={stage:e.stage,line:t};Se.appendLog(r),Ys(r)}});pe.on("preferences",e=>{e&&(Se.setState({preferences:e}),ii(e.theme||"light"))});pe.onConnection(e=>{ra=e,e==="open"&&(pe.send("list-runs").then(t=>{let r={};for(let d of t.runs||[])r[d.id]=d;Se.setState({runs:r}),t.settings&&(Sr=t.settings)}).catch(()=>{}),pe.send("get-preferences").then(t=>{Se.setState({preferences:t}),ii(t.theme||"light")}).catch(()=>{}),be.runId&&(pe.send("subscribe-run",{runId:be.runId}).catch(()=>{}),pe.send("subscribe-log",{stage:Li==="*"?null:Li}).catch(()=>{}))),qt()});Wr(e=>{let t=be.runId;be=e,t&&t!==be.runId&&(pe.send("unsubscribe-run").catch(()=>{}),pe.send("unsubscribe-log").catch(()=>{}),Se.clearLog(),Ki()),be.runId&&be.runId!==t&&(pe.send("subscribe-run",{runId:be.runId}).catch(()=>{}),pe.send("subscribe-log",{stage:null}).catch(()=>{})),!be.runId&&t&&ko(),qt()});function Sc(e){Ii(e,null)}function sa(e){Ii(be.section,e)}function wc(){let t=Se.getState().preferences.theme==="dark"?"light":"dark";pe.send("set-preferences",{theme:t}).catch(()=>{}),Se.setState({preferences:{theme:t}}),ii(t)}function Cc(e){Li=e,Ki(),Se.clearLog(),pe.send("unsubscribe-log").catch(()=>{}),pe.send("subscribe-log",{stage:e==="*"?null:e}).catch(()=>{}),qt()}function xc(e){yr=e,Lo(e)}function Ec(){br=!br,qt()}function kc(){let e=Se.getState(),t=Object.values(e.runs);if(be.runId){let r=e.runs[be.runId];return j`
      ${Vr(r,Sr)}
      ${Do(Lc(e),{onStageFilter:Cc,onSearch:xc,onToggleAutoScroll:Ec,autoScroll:br})}
    `}if(be.section==="history")return Os(t,"history",{onSelectRun:sa});if(be.section==="active"){let r=t.filter(d=>d.active);return r.length===1?(Ii("active",r[0].id),j``):Os(t,"active",{onSelectRun:sa})}return qr(e)}function Lc(e){let t=e.logLines;if(Li!=="*"&&(t=t.filter(r=>r.stage===Li)),yr){let r=yr.toLowerCase();t=t.filter(d=>(d.line||"").toLowerCase().includes(r))}return{...e,logLines:t}}function qt(){let e=Se.getState(),t=document.getElementById("app");t&&(Pi(j`
    <div class="app-shell">
      ${Ur(e,be,ra,{onNavigate:Sc,onThemeToggle:wc})}
      <main class="main-content">
        ${kc()}
      </main>
    </div>
  `,t),be.runId&&Ao(be.runId))}Se.subscribe(()=>qt());ii(Se.getState().preferences.theme);qt();
//# sourceMappingURL=main.bundle.js.map
