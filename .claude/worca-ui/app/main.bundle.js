var ll=Object.create;var qs=Object.defineProperty;var cl=Object.getOwnPropertyDescriptor;var hl=Object.getOwnPropertyNames;var dl=Object.getPrototypeOf,ul=Object.prototype.hasOwnProperty;var ho=(e,t)=>()=>(e&&(t=e(e=0)),t);var pl=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),uo=(e,t)=>{for(var s in t)qs(e,s,{get:t[s],enumerable:!0})},fl=(e,t,s,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let u of hl(t))!ul.call(e,u)&&u!==s&&qs(e,u,{get:()=>t[u],enumerable:!(n=cl(t,u))||n.enumerable});return e};var _l=(e,t,s)=>(s=e!=null?ll(dl(e)):{},fl(t||!e||!e.__esModule?qs(s,"default",{value:e,enumerable:!0}):s,e));var Fo=pl((hs,_r)=>{(function(e,t){if(typeof hs=="object"&&typeof _r=="object")_r.exports=t();else if(typeof define=="function"&&define.amd)define([],t);else{var s=t();for(var n in s)(typeof hs=="object"?hs:e)[n]=s[n]}})(self,(()=>(()=>{"use strict";var e={4567:function(u,i,r){var c=this&&this.__decorate||function(h,_,g,y){var x,m=arguments.length,S=m<3?_:y===null?y=Object.getOwnPropertyDescriptor(_,g):y;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")S=Reflect.decorate(h,_,g,y);else for(var L=h.length-1;L>=0;L--)(x=h[L])&&(S=(m<3?x(S):m>3?x(_,g,S):x(_,g))||S);return m>3&&S&&Object.defineProperty(_,g,S),S},p=this&&this.__param||function(h,_){return function(g,y){_(g,y,h)}};Object.defineProperty(i,"__esModule",{value:!0}),i.AccessibilityManager=void 0;let d=r(9042),f=r(6114),v=r(9924),w=r(844),b=r(5596),o=r(4725),l=r(3656),a=i.AccessibilityManager=class extends w.Disposable{constructor(h,_){super(),this._terminal=h,this._renderService=_,this._liveRegionLineCount=0,this._charsToConsume=[],this._charsToAnnounce="",this._accessibilityContainer=document.createElement("div"),this._accessibilityContainer.classList.add("xterm-accessibility"),this._rowContainer=document.createElement("div"),this._rowContainer.setAttribute("role","list"),this._rowContainer.classList.add("xterm-accessibility-tree"),this._rowElements=[];for(let g=0;g<this._terminal.rows;g++)this._rowElements[g]=this._createAccessibilityTreeNode(),this._rowContainer.appendChild(this._rowElements[g]);if(this._topBoundaryFocusListener=g=>this._handleBoundaryFocus(g,0),this._bottomBoundaryFocusListener=g=>this._handleBoundaryFocus(g,1),this._rowElements[0].addEventListener("focus",this._topBoundaryFocusListener),this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._refreshRowsDimensions(),this._accessibilityContainer.appendChild(this._rowContainer),this._liveRegion=document.createElement("div"),this._liveRegion.classList.add("live-region"),this._liveRegion.setAttribute("aria-live","assertive"),this._accessibilityContainer.appendChild(this._liveRegion),this._liveRegionDebouncer=this.register(new v.TimeBasedDebouncer(this._renderRows.bind(this))),!this._terminal.element)throw new Error("Cannot enable accessibility before Terminal.open");this._terminal.element.insertAdjacentElement("afterbegin",this._accessibilityContainer),this.register(this._terminal.onResize((g=>this._handleResize(g.rows)))),this.register(this._terminal.onRender((g=>this._refreshRows(g.start,g.end)))),this.register(this._terminal.onScroll((()=>this._refreshRows()))),this.register(this._terminal.onA11yChar((g=>this._handleChar(g)))),this.register(this._terminal.onLineFeed((()=>this._handleChar(`
`)))),this.register(this._terminal.onA11yTab((g=>this._handleTab(g)))),this.register(this._terminal.onKey((g=>this._handleKey(g.key)))),this.register(this._terminal.onBlur((()=>this._clearLiveRegion()))),this.register(this._renderService.onDimensionsChange((()=>this._refreshRowsDimensions()))),this._screenDprMonitor=new b.ScreenDprMonitor(window),this.register(this._screenDprMonitor),this._screenDprMonitor.setListener((()=>this._refreshRowsDimensions())),this.register((0,l.addDisposableDomListener)(window,"resize",(()=>this._refreshRowsDimensions()))),this._refreshRows(),this.register((0,w.toDisposable)((()=>{this._accessibilityContainer.remove(),this._rowElements.length=0})))}_handleTab(h){for(let _=0;_<h;_++)this._handleChar(" ")}_handleChar(h){this._liveRegionLineCount<21&&(this._charsToConsume.length>0?this._charsToConsume.shift()!==h&&(this._charsToAnnounce+=h):this._charsToAnnounce+=h,h===`
`&&(this._liveRegionLineCount++,this._liveRegionLineCount===21&&(this._liveRegion.textContent+=d.tooMuchOutput)),f.isMac&&this._liveRegion.textContent&&this._liveRegion.textContent.length>0&&!this._liveRegion.parentNode&&setTimeout((()=>{this._accessibilityContainer.appendChild(this._liveRegion)}),0))}_clearLiveRegion(){this._liveRegion.textContent="",this._liveRegionLineCount=0,f.isMac&&this._liveRegion.remove()}_handleKey(h){this._clearLiveRegion(),/\p{Control}/u.test(h)||this._charsToConsume.push(h)}_refreshRows(h,_){this._liveRegionDebouncer.refresh(h,_,this._terminal.rows)}_renderRows(h,_){let g=this._terminal.buffer,y=g.lines.length.toString();for(let x=h;x<=_;x++){let m=g.translateBufferLineToString(g.ydisp+x,!0),S=(g.ydisp+x+1).toString(),L=this._rowElements[x];L&&(m.length===0?L.innerText="\xA0":L.textContent=m,L.setAttribute("aria-posinset",S),L.setAttribute("aria-setsize",y))}this._announceCharacters()}_announceCharacters(){this._charsToAnnounce.length!==0&&(this._liveRegion.textContent+=this._charsToAnnounce,this._charsToAnnounce="")}_handleBoundaryFocus(h,_){let g=h.target,y=this._rowElements[_===0?1:this._rowElements.length-2];if(g.getAttribute("aria-posinset")===(_===0?"1":`${this._terminal.buffer.lines.length}`)||h.relatedTarget!==y)return;let x,m;if(_===0?(x=g,m=this._rowElements.pop(),this._rowContainer.removeChild(m)):(x=this._rowElements.shift(),m=g,this._rowContainer.removeChild(x)),x.removeEventListener("focus",this._topBoundaryFocusListener),m.removeEventListener("focus",this._bottomBoundaryFocusListener),_===0){let S=this._createAccessibilityTreeNode();this._rowElements.unshift(S),this._rowContainer.insertAdjacentElement("afterbegin",S)}else{let S=this._createAccessibilityTreeNode();this._rowElements.push(S),this._rowContainer.appendChild(S)}this._rowElements[0].addEventListener("focus",this._topBoundaryFocusListener),this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._terminal.scrollLines(_===0?-1:1),this._rowElements[_===0?1:this._rowElements.length-2].focus(),h.preventDefault(),h.stopImmediatePropagation()}_handleResize(h){this._rowElements[this._rowElements.length-1].removeEventListener("focus",this._bottomBoundaryFocusListener);for(let _=this._rowContainer.children.length;_<this._terminal.rows;_++)this._rowElements[_]=this._createAccessibilityTreeNode(),this._rowContainer.appendChild(this._rowElements[_]);for(;this._rowElements.length>h;)this._rowContainer.removeChild(this._rowElements.pop());this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._refreshRowsDimensions()}_createAccessibilityTreeNode(){let h=document.createElement("div");return h.setAttribute("role","listitem"),h.tabIndex=-1,this._refreshRowDimensions(h),h}_refreshRowsDimensions(){if(this._renderService.dimensions.css.cell.height){this._accessibilityContainer.style.width=`${this._renderService.dimensions.css.canvas.width}px`,this._rowElements.length!==this._terminal.rows&&this._handleResize(this._terminal.rows);for(let h=0;h<this._terminal.rows;h++)this._refreshRowDimensions(this._rowElements[h])}}_refreshRowDimensions(h){h.style.height=`${this._renderService.dimensions.css.cell.height}px`}};i.AccessibilityManager=a=c([p(1,o.IRenderService)],a)},3614:(u,i)=>{function r(f){return f.replace(/\r?\n/g,"\r")}function c(f,v){return v?"\x1B[200~"+f+"\x1B[201~":f}function p(f,v,w,b){f=c(f=r(f),w.decPrivateModes.bracketedPasteMode&&b.rawOptions.ignoreBracketedPasteMode!==!0),w.triggerDataEvent(f,!0),v.value=""}function d(f,v,w){let b=w.getBoundingClientRect(),o=f.clientX-b.left-10,l=f.clientY-b.top-10;v.style.width="20px",v.style.height="20px",v.style.left=`${o}px`,v.style.top=`${l}px`,v.style.zIndex="1000",v.focus()}Object.defineProperty(i,"__esModule",{value:!0}),i.rightClickHandler=i.moveTextAreaUnderMouseCursor=i.paste=i.handlePasteEvent=i.copyHandler=i.bracketTextForPaste=i.prepareTextForTerminal=void 0,i.prepareTextForTerminal=r,i.bracketTextForPaste=c,i.copyHandler=function(f,v){f.clipboardData&&f.clipboardData.setData("text/plain",v.selectionText),f.preventDefault()},i.handlePasteEvent=function(f,v,w,b){f.stopPropagation(),f.clipboardData&&p(f.clipboardData.getData("text/plain"),v,w,b)},i.paste=p,i.moveTextAreaUnderMouseCursor=d,i.rightClickHandler=function(f,v,w,b,o){d(f,v,w),o&&b.rightClickSelect(f),v.value=b.selectionText,v.select()}},7239:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ColorContrastCache=void 0;let c=r(1505);i.ColorContrastCache=class{constructor(){this._color=new c.TwoKeyMap,this._css=new c.TwoKeyMap}setCss(p,d,f){this._css.set(p,d,f)}getCss(p,d){return this._css.get(p,d)}setColor(p,d,f){this._color.set(p,d,f)}getColor(p,d){return this._color.get(p,d)}clear(){this._color.clear(),this._css.clear()}}},3656:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.addDisposableDomListener=void 0,i.addDisposableDomListener=function(r,c,p,d){r.addEventListener(c,p,d);let f=!1;return{dispose:()=>{f||(f=!0,r.removeEventListener(c,p,d))}}}},6465:function(u,i,r){var c=this&&this.__decorate||function(o,l,a,h){var _,g=arguments.length,y=g<3?l:h===null?h=Object.getOwnPropertyDescriptor(l,a):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(o,l,a,h);else for(var x=o.length-1;x>=0;x--)(_=o[x])&&(y=(g<3?_(y):g>3?_(l,a,y):_(l,a))||y);return g>3&&y&&Object.defineProperty(l,a,y),y},p=this&&this.__param||function(o,l){return function(a,h){l(a,h,o)}};Object.defineProperty(i,"__esModule",{value:!0}),i.Linkifier2=void 0;let d=r(3656),f=r(8460),v=r(844),w=r(2585),b=i.Linkifier2=class extends v.Disposable{get currentLink(){return this._currentLink}constructor(o){super(),this._bufferService=o,this._linkProviders=[],this._linkCacheDisposables=[],this._isMouseOut=!0,this._wasResized=!1,this._activeLine=-1,this._onShowLinkUnderline=this.register(new f.EventEmitter),this.onShowLinkUnderline=this._onShowLinkUnderline.event,this._onHideLinkUnderline=this.register(new f.EventEmitter),this.onHideLinkUnderline=this._onHideLinkUnderline.event,this.register((0,v.getDisposeArrayDisposable)(this._linkCacheDisposables)),this.register((0,v.toDisposable)((()=>{this._lastMouseEvent=void 0}))),this.register(this._bufferService.onResize((()=>{this._clearCurrentLink(),this._wasResized=!0})))}registerLinkProvider(o){return this._linkProviders.push(o),{dispose:()=>{let l=this._linkProviders.indexOf(o);l!==-1&&this._linkProviders.splice(l,1)}}}attachToDom(o,l,a){this._element=o,this._mouseService=l,this._renderService=a,this.register((0,d.addDisposableDomListener)(this._element,"mouseleave",(()=>{this._isMouseOut=!0,this._clearCurrentLink()}))),this.register((0,d.addDisposableDomListener)(this._element,"mousemove",this._handleMouseMove.bind(this))),this.register((0,d.addDisposableDomListener)(this._element,"mousedown",this._handleMouseDown.bind(this))),this.register((0,d.addDisposableDomListener)(this._element,"mouseup",this._handleMouseUp.bind(this)))}_handleMouseMove(o){if(this._lastMouseEvent=o,!this._element||!this._mouseService)return;let l=this._positionFromMouseEvent(o,this._element,this._mouseService);if(!l)return;this._isMouseOut=!1;let a=o.composedPath();for(let h=0;h<a.length;h++){let _=a[h];if(_.classList.contains("xterm"))break;if(_.classList.contains("xterm-hover"))return}this._lastBufferCell&&l.x===this._lastBufferCell.x&&l.y===this._lastBufferCell.y||(this._handleHover(l),this._lastBufferCell=l)}_handleHover(o){if(this._activeLine!==o.y||this._wasResized)return this._clearCurrentLink(),this._askForLink(o,!1),void(this._wasResized=!1);this._currentLink&&this._linkAtPosition(this._currentLink.link,o)||(this._clearCurrentLink(),this._askForLink(o,!0))}_askForLink(o,l){var a,h;this._activeProviderReplies&&l||((a=this._activeProviderReplies)===null||a===void 0||a.forEach((g=>{g?.forEach((y=>{y.link.dispose&&y.link.dispose()}))})),this._activeProviderReplies=new Map,this._activeLine=o.y);let _=!1;for(let[g,y]of this._linkProviders.entries())l?!((h=this._activeProviderReplies)===null||h===void 0)&&h.get(g)&&(_=this._checkLinkProviderResult(g,o,_)):y.provideLinks(o.y,(x=>{var m,S;if(this._isMouseOut)return;let L=x?.map((O=>({link:O})));(m=this._activeProviderReplies)===null||m===void 0||m.set(g,L),_=this._checkLinkProviderResult(g,o,_),((S=this._activeProviderReplies)===null||S===void 0?void 0:S.size)===this._linkProviders.length&&this._removeIntersectingLinks(o.y,this._activeProviderReplies)}))}_removeIntersectingLinks(o,l){let a=new Set;for(let h=0;h<l.size;h++){let _=l.get(h);if(_)for(let g=0;g<_.length;g++){let y=_[g],x=y.link.range.start.y<o?0:y.link.range.start.x,m=y.link.range.end.y>o?this._bufferService.cols:y.link.range.end.x;for(let S=x;S<=m;S++){if(a.has(S)){_.splice(g--,1);break}a.add(S)}}}}_checkLinkProviderResult(o,l,a){var h;if(!this._activeProviderReplies)return a;let _=this._activeProviderReplies.get(o),g=!1;for(let y=0;y<o;y++)this._activeProviderReplies.has(y)&&!this._activeProviderReplies.get(y)||(g=!0);if(!g&&_){let y=_.find((x=>this._linkAtPosition(x.link,l)));y&&(a=!0,this._handleNewLink(y))}if(this._activeProviderReplies.size===this._linkProviders.length&&!a)for(let y=0;y<this._activeProviderReplies.size;y++){let x=(h=this._activeProviderReplies.get(y))===null||h===void 0?void 0:h.find((m=>this._linkAtPosition(m.link,l)));if(x){a=!0,this._handleNewLink(x);break}}return a}_handleMouseDown(){this._mouseDownLink=this._currentLink}_handleMouseUp(o){if(!this._element||!this._mouseService||!this._currentLink)return;let l=this._positionFromMouseEvent(o,this._element,this._mouseService);l&&this._mouseDownLink===this._currentLink&&this._linkAtPosition(this._currentLink.link,l)&&this._currentLink.link.activate(o,this._currentLink.link.text)}_clearCurrentLink(o,l){this._element&&this._currentLink&&this._lastMouseEvent&&(!o||!l||this._currentLink.link.range.start.y>=o&&this._currentLink.link.range.end.y<=l)&&(this._linkLeave(this._element,this._currentLink.link,this._lastMouseEvent),this._currentLink=void 0,(0,v.disposeArray)(this._linkCacheDisposables))}_handleNewLink(o){if(!this._element||!this._lastMouseEvent||!this._mouseService)return;let l=this._positionFromMouseEvent(this._lastMouseEvent,this._element,this._mouseService);l&&this._linkAtPosition(o.link,l)&&(this._currentLink=o,this._currentLink.state={decorations:{underline:o.link.decorations===void 0||o.link.decorations.underline,pointerCursor:o.link.decorations===void 0||o.link.decorations.pointerCursor},isHovered:!0},this._linkHover(this._element,o.link,this._lastMouseEvent),o.link.decorations={},Object.defineProperties(o.link.decorations,{pointerCursor:{get:()=>{var a,h;return(h=(a=this._currentLink)===null||a===void 0?void 0:a.state)===null||h===void 0?void 0:h.decorations.pointerCursor},set:a=>{var h,_;!((h=this._currentLink)===null||h===void 0)&&h.state&&this._currentLink.state.decorations.pointerCursor!==a&&(this._currentLink.state.decorations.pointerCursor=a,this._currentLink.state.isHovered&&((_=this._element)===null||_===void 0||_.classList.toggle("xterm-cursor-pointer",a)))}},underline:{get:()=>{var a,h;return(h=(a=this._currentLink)===null||a===void 0?void 0:a.state)===null||h===void 0?void 0:h.decorations.underline},set:a=>{var h,_,g;!((h=this._currentLink)===null||h===void 0)&&h.state&&((g=(_=this._currentLink)===null||_===void 0?void 0:_.state)===null||g===void 0?void 0:g.decorations.underline)!==a&&(this._currentLink.state.decorations.underline=a,this._currentLink.state.isHovered&&this._fireUnderlineEvent(o.link,a))}}}),this._renderService&&this._linkCacheDisposables.push(this._renderService.onRenderedViewportChange((a=>{if(!this._currentLink)return;let h=a.start===0?0:a.start+1+this._bufferService.buffer.ydisp,_=this._bufferService.buffer.ydisp+1+a.end;if(this._currentLink.link.range.start.y>=h&&this._currentLink.link.range.end.y<=_&&(this._clearCurrentLink(h,_),this._lastMouseEvent&&this._element)){let g=this._positionFromMouseEvent(this._lastMouseEvent,this._element,this._mouseService);g&&this._askForLink(g,!1)}}))))}_linkHover(o,l,a){var h;!((h=this._currentLink)===null||h===void 0)&&h.state&&(this._currentLink.state.isHovered=!0,this._currentLink.state.decorations.underline&&this._fireUnderlineEvent(l,!0),this._currentLink.state.decorations.pointerCursor&&o.classList.add("xterm-cursor-pointer")),l.hover&&l.hover(a,l.text)}_fireUnderlineEvent(o,l){let a=o.range,h=this._bufferService.buffer.ydisp,_=this._createLinkUnderlineEvent(a.start.x-1,a.start.y-h-1,a.end.x,a.end.y-h-1,void 0);(l?this._onShowLinkUnderline:this._onHideLinkUnderline).fire(_)}_linkLeave(o,l,a){var h;!((h=this._currentLink)===null||h===void 0)&&h.state&&(this._currentLink.state.isHovered=!1,this._currentLink.state.decorations.underline&&this._fireUnderlineEvent(l,!1),this._currentLink.state.decorations.pointerCursor&&o.classList.remove("xterm-cursor-pointer")),l.leave&&l.leave(a,l.text)}_linkAtPosition(o,l){let a=o.range.start.y*this._bufferService.cols+o.range.start.x,h=o.range.end.y*this._bufferService.cols+o.range.end.x,_=l.y*this._bufferService.cols+l.x;return a<=_&&_<=h}_positionFromMouseEvent(o,l,a){let h=a.getCoords(o,l,this._bufferService.cols,this._bufferService.rows);if(h)return{x:h[0],y:h[1]+this._bufferService.buffer.ydisp}}_createLinkUnderlineEvent(o,l,a,h,_){return{x1:o,y1:l,x2:a,y2:h,cols:this._bufferService.cols,fg:_}}};i.Linkifier2=b=c([p(0,w.IBufferService)],b)},9042:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.tooMuchOutput=i.promptLabel=void 0,i.promptLabel="Terminal input",i.tooMuchOutput="Too much output to announce, navigate to rows manually to read"},3730:function(u,i,r){var c=this&&this.__decorate||function(b,o,l,a){var h,_=arguments.length,g=_<3?o:a===null?a=Object.getOwnPropertyDescriptor(o,l):a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")g=Reflect.decorate(b,o,l,a);else for(var y=b.length-1;y>=0;y--)(h=b[y])&&(g=(_<3?h(g):_>3?h(o,l,g):h(o,l))||g);return _>3&&g&&Object.defineProperty(o,l,g),g},p=this&&this.__param||function(b,o){return function(l,a){o(l,a,b)}};Object.defineProperty(i,"__esModule",{value:!0}),i.OscLinkProvider=void 0;let d=r(511),f=r(2585),v=i.OscLinkProvider=class{constructor(b,o,l){this._bufferService=b,this._optionsService=o,this._oscLinkService=l}provideLinks(b,o){var l;let a=this._bufferService.buffer.lines.get(b-1);if(!a)return void o(void 0);let h=[],_=this._optionsService.rawOptions.linkHandler,g=new d.CellData,y=a.getTrimmedLength(),x=-1,m=-1,S=!1;for(let L=0;L<y;L++)if(m!==-1||a.hasContent(L)){if(a.loadCell(L,g),g.hasExtendedAttrs()&&g.extended.urlId){if(m===-1){m=L,x=g.extended.urlId;continue}S=g.extended.urlId!==x}else m!==-1&&(S=!0);if(S||m!==-1&&L===y-1){let O=(l=this._oscLinkService.getLinkData(x))===null||l===void 0?void 0:l.uri;if(O){let D={start:{x:m+1,y:b},end:{x:L+(S||L!==y-1?0:1),y:b}},B=!1;if(!_?.allowNonHttpProtocols)try{let F=new URL(O);["http:","https:"].includes(F.protocol)||(B=!0)}catch{B=!0}B||h.push({text:O,range:D,activate:(F,P)=>_?_.activate(F,P,D):w(0,P),hover:(F,P)=>{var M;return(M=_?.hover)===null||M===void 0?void 0:M.call(_,F,P,D)},leave:(F,P)=>{var M;return(M=_?.leave)===null||M===void 0?void 0:M.call(_,F,P,D)}})}S=!1,g.hasExtendedAttrs()&&g.extended.urlId?(m=L,x=g.extended.urlId):(m=-1,x=-1)}}o(h)}};function w(b,o){if(confirm(`Do you want to navigate to ${o}?

WARNING: This link could potentially be dangerous`)){let l=window.open();if(l){try{l.opener=null}catch{}l.location.href=o}else console.warn("Opening link blocked as opener could not be cleared")}}i.OscLinkProvider=v=c([p(0,f.IBufferService),p(1,f.IOptionsService),p(2,f.IOscLinkService)],v)},6193:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.RenderDebouncer=void 0,i.RenderDebouncer=class{constructor(r,c){this._parentWindow=r,this._renderCallback=c,this._refreshCallbacks=[]}dispose(){this._animationFrame&&(this._parentWindow.cancelAnimationFrame(this._animationFrame),this._animationFrame=void 0)}addRefreshCallback(r){return this._refreshCallbacks.push(r),this._animationFrame||(this._animationFrame=this._parentWindow.requestAnimationFrame((()=>this._innerRefresh()))),this._animationFrame}refresh(r,c,p){this._rowCount=p,r=r!==void 0?r:0,c=c!==void 0?c:this._rowCount-1,this._rowStart=this._rowStart!==void 0?Math.min(this._rowStart,r):r,this._rowEnd=this._rowEnd!==void 0?Math.max(this._rowEnd,c):c,this._animationFrame||(this._animationFrame=this._parentWindow.requestAnimationFrame((()=>this._innerRefresh())))}_innerRefresh(){if(this._animationFrame=void 0,this._rowStart===void 0||this._rowEnd===void 0||this._rowCount===void 0)return void this._runRefreshCallbacks();let r=Math.max(this._rowStart,0),c=Math.min(this._rowEnd,this._rowCount-1);this._rowStart=void 0,this._rowEnd=void 0,this._renderCallback(r,c),this._runRefreshCallbacks()}_runRefreshCallbacks(){for(let r of this._refreshCallbacks)r(0);this._refreshCallbacks=[]}}},5596:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ScreenDprMonitor=void 0;let c=r(844);class p extends c.Disposable{constructor(f){super(),this._parentWindow=f,this._currentDevicePixelRatio=this._parentWindow.devicePixelRatio,this.register((0,c.toDisposable)((()=>{this.clearListener()})))}setListener(f){this._listener&&this.clearListener(),this._listener=f,this._outerListener=()=>{this._listener&&(this._listener(this._parentWindow.devicePixelRatio,this._currentDevicePixelRatio),this._updateDpr())},this._updateDpr()}_updateDpr(){var f;this._outerListener&&((f=this._resolutionMediaMatchList)===null||f===void 0||f.removeListener(this._outerListener),this._currentDevicePixelRatio=this._parentWindow.devicePixelRatio,this._resolutionMediaMatchList=this._parentWindow.matchMedia(`screen and (resolution: ${this._parentWindow.devicePixelRatio}dppx)`),this._resolutionMediaMatchList.addListener(this._outerListener))}clearListener(){this._resolutionMediaMatchList&&this._listener&&this._outerListener&&(this._resolutionMediaMatchList.removeListener(this._outerListener),this._resolutionMediaMatchList=void 0,this._listener=void 0,this._outerListener=void 0)}}i.ScreenDprMonitor=p},3236:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Terminal=void 0;let c=r(3614),p=r(3656),d=r(6465),f=r(9042),v=r(3730),w=r(1680),b=r(3107),o=r(5744),l=r(2950),a=r(1296),h=r(428),_=r(4269),g=r(5114),y=r(8934),x=r(3230),m=r(9312),S=r(4725),L=r(6731),O=r(8055),D=r(8969),B=r(8460),F=r(844),P=r(6114),M=r(8437),I=r(2584),C=r(7399),E=r(5941),A=r(9074),R=r(2585),N=r(5435),j=r(4567),K=typeof window<"u"?window.document:null;class q extends D.CoreTerminal{get onFocus(){return this._onFocus.event}get onBlur(){return this._onBlur.event}get onA11yChar(){return this._onA11yCharEmitter.event}get onA11yTab(){return this._onA11yTabEmitter.event}get onWillOpen(){return this._onWillOpen.event}constructor(k={}){super(k),this.browser=P,this._keyDownHandled=!1,this._keyDownSeen=!1,this._keyPressHandled=!1,this._unprocessedDeadKey=!1,this._accessibilityManager=this.register(new F.MutableDisposable),this._onCursorMove=this.register(new B.EventEmitter),this.onCursorMove=this._onCursorMove.event,this._onKey=this.register(new B.EventEmitter),this.onKey=this._onKey.event,this._onRender=this.register(new B.EventEmitter),this.onRender=this._onRender.event,this._onSelectionChange=this.register(new B.EventEmitter),this.onSelectionChange=this._onSelectionChange.event,this._onTitleChange=this.register(new B.EventEmitter),this.onTitleChange=this._onTitleChange.event,this._onBell=this.register(new B.EventEmitter),this.onBell=this._onBell.event,this._onFocus=this.register(new B.EventEmitter),this._onBlur=this.register(new B.EventEmitter),this._onA11yCharEmitter=this.register(new B.EventEmitter),this._onA11yTabEmitter=this.register(new B.EventEmitter),this._onWillOpen=this.register(new B.EventEmitter),this._setup(),this.linkifier2=this.register(this._instantiationService.createInstance(d.Linkifier2)),this.linkifier2.registerLinkProvider(this._instantiationService.createInstance(v.OscLinkProvider)),this._decorationService=this._instantiationService.createInstance(A.DecorationService),this._instantiationService.setService(R.IDecorationService,this._decorationService),this.register(this._inputHandler.onRequestBell((()=>this._onBell.fire()))),this.register(this._inputHandler.onRequestRefreshRows(((H,U)=>this.refresh(H,U)))),this.register(this._inputHandler.onRequestSendFocus((()=>this._reportFocus()))),this.register(this._inputHandler.onRequestReset((()=>this.reset()))),this.register(this._inputHandler.onRequestWindowsOptionsReport((H=>this._reportWindowsOptions(H)))),this.register(this._inputHandler.onColor((H=>this._handleColorEvent(H)))),this.register((0,B.forwardEvent)(this._inputHandler.onCursorMove,this._onCursorMove)),this.register((0,B.forwardEvent)(this._inputHandler.onTitleChange,this._onTitleChange)),this.register((0,B.forwardEvent)(this._inputHandler.onA11yChar,this._onA11yCharEmitter)),this.register((0,B.forwardEvent)(this._inputHandler.onA11yTab,this._onA11yTabEmitter)),this.register(this._bufferService.onResize((H=>this._afterResize(H.cols,H.rows)))),this.register((0,F.toDisposable)((()=>{var H,U;this._customKeyEventHandler=void 0,(U=(H=this.element)===null||H===void 0?void 0:H.parentNode)===null||U===void 0||U.removeChild(this.element)})))}_handleColorEvent(k){if(this._themeService)for(let H of k){let U,W="";switch(H.index){case 256:U="foreground",W="10";break;case 257:U="background",W="11";break;case 258:U="cursor",W="12";break;default:U="ansi",W="4;"+H.index}switch(H.type){case 0:let J=O.color.toColorRGB(U==="ansi"?this._themeService.colors.ansi[H.index]:this._themeService.colors[U]);this.coreService.triggerDataEvent(`${I.C0.ESC}]${W};${(0,E.toRgbString)(J)}${I.C1_ESCAPED.ST}`);break;case 1:if(U==="ansi")this._themeService.modifyColors((V=>V.ansi[H.index]=O.rgba.toColor(...H.color)));else{let V=U;this._themeService.modifyColors((de=>de[V]=O.rgba.toColor(...H.color)))}break;case 2:this._themeService.restoreColor(H.index)}}}_setup(){super._setup(),this._customKeyEventHandler=void 0}get buffer(){return this.buffers.active}focus(){this.textarea&&this.textarea.focus({preventScroll:!0})}_handleScreenReaderModeOptionChange(k){k?!this._accessibilityManager.value&&this._renderService&&(this._accessibilityManager.value=this._instantiationService.createInstance(j.AccessibilityManager,this)):this._accessibilityManager.clear()}_handleTextAreaFocus(k){this.coreService.decPrivateModes.sendFocus&&this.coreService.triggerDataEvent(I.C0.ESC+"[I"),this.updateCursorStyle(k),this.element.classList.add("focus"),this._showCursor(),this._onFocus.fire()}blur(){var k;return(k=this.textarea)===null||k===void 0?void 0:k.blur()}_handleTextAreaBlur(){this.textarea.value="",this.refresh(this.buffer.y,this.buffer.y),this.coreService.decPrivateModes.sendFocus&&this.coreService.triggerDataEvent(I.C0.ESC+"[O"),this.element.classList.remove("focus"),this._onBlur.fire()}_syncTextArea(){if(!this.textarea||!this.buffer.isCursorInViewport||this._compositionHelper.isComposing||!this._renderService)return;let k=this.buffer.ybase+this.buffer.y,H=this.buffer.lines.get(k);if(!H)return;let U=Math.min(this.buffer.x,this.cols-1),W=this._renderService.dimensions.css.cell.height,J=H.getWidth(U),V=this._renderService.dimensions.css.cell.width*J,de=this.buffer.y*this._renderService.dimensions.css.cell.height,Ee=U*this._renderService.dimensions.css.cell.width;this.textarea.style.left=Ee+"px",this.textarea.style.top=de+"px",this.textarea.style.width=V+"px",this.textarea.style.height=W+"px",this.textarea.style.lineHeight=W+"px",this.textarea.style.zIndex="-5"}_initGlobal(){this._bindKeys(),this.register((0,p.addDisposableDomListener)(this.element,"copy",(H=>{this.hasSelection()&&(0,c.copyHandler)(H,this._selectionService)})));let k=H=>(0,c.handlePasteEvent)(H,this.textarea,this.coreService,this.optionsService);this.register((0,p.addDisposableDomListener)(this.textarea,"paste",k)),this.register((0,p.addDisposableDomListener)(this.element,"paste",k)),P.isFirefox?this.register((0,p.addDisposableDomListener)(this.element,"mousedown",(H=>{H.button===2&&(0,c.rightClickHandler)(H,this.textarea,this.screenElement,this._selectionService,this.options.rightClickSelectsWord)}))):this.register((0,p.addDisposableDomListener)(this.element,"contextmenu",(H=>{(0,c.rightClickHandler)(H,this.textarea,this.screenElement,this._selectionService,this.options.rightClickSelectsWord)}))),P.isLinux&&this.register((0,p.addDisposableDomListener)(this.element,"auxclick",(H=>{H.button===1&&(0,c.moveTextAreaUnderMouseCursor)(H,this.textarea,this.screenElement)})))}_bindKeys(){this.register((0,p.addDisposableDomListener)(this.textarea,"keyup",(k=>this._keyUp(k)),!0)),this.register((0,p.addDisposableDomListener)(this.textarea,"keydown",(k=>this._keyDown(k)),!0)),this.register((0,p.addDisposableDomListener)(this.textarea,"keypress",(k=>this._keyPress(k)),!0)),this.register((0,p.addDisposableDomListener)(this.textarea,"compositionstart",(()=>this._compositionHelper.compositionstart()))),this.register((0,p.addDisposableDomListener)(this.textarea,"compositionupdate",(k=>this._compositionHelper.compositionupdate(k)))),this.register((0,p.addDisposableDomListener)(this.textarea,"compositionend",(()=>this._compositionHelper.compositionend()))),this.register((0,p.addDisposableDomListener)(this.textarea,"input",(k=>this._inputEvent(k)),!0)),this.register(this.onRender((()=>this._compositionHelper.updateCompositionElements())))}open(k){var H;if(!k)throw new Error("Terminal requires a parent element.");k.isConnected||this._logService.debug("Terminal.open was called on an element that was not attached to the DOM"),this._document=k.ownerDocument,this.element=this._document.createElement("div"),this.element.dir="ltr",this.element.classList.add("terminal"),this.element.classList.add("xterm"),k.appendChild(this.element);let U=K.createDocumentFragment();this._viewportElement=K.createElement("div"),this._viewportElement.classList.add("xterm-viewport"),U.appendChild(this._viewportElement),this._viewportScrollArea=K.createElement("div"),this._viewportScrollArea.classList.add("xterm-scroll-area"),this._viewportElement.appendChild(this._viewportScrollArea),this.screenElement=K.createElement("div"),this.screenElement.classList.add("xterm-screen"),this._helperContainer=K.createElement("div"),this._helperContainer.classList.add("xterm-helpers"),this.screenElement.appendChild(this._helperContainer),U.appendChild(this.screenElement),this.textarea=K.createElement("textarea"),this.textarea.classList.add("xterm-helper-textarea"),this.textarea.setAttribute("aria-label",f.promptLabel),P.isChromeOS||this.textarea.setAttribute("aria-multiline","false"),this.textarea.setAttribute("autocorrect","off"),this.textarea.setAttribute("autocapitalize","off"),this.textarea.setAttribute("spellcheck","false"),this.textarea.tabIndex=0,this._coreBrowserService=this._instantiationService.createInstance(g.CoreBrowserService,this.textarea,(H=this._document.defaultView)!==null&&H!==void 0?H:window),this._instantiationService.setService(S.ICoreBrowserService,this._coreBrowserService),this.register((0,p.addDisposableDomListener)(this.textarea,"focus",(W=>this._handleTextAreaFocus(W)))),this.register((0,p.addDisposableDomListener)(this.textarea,"blur",(()=>this._handleTextAreaBlur()))),this._helperContainer.appendChild(this.textarea),this._charSizeService=this._instantiationService.createInstance(h.CharSizeService,this._document,this._helperContainer),this._instantiationService.setService(S.ICharSizeService,this._charSizeService),this._themeService=this._instantiationService.createInstance(L.ThemeService),this._instantiationService.setService(S.IThemeService,this._themeService),this._characterJoinerService=this._instantiationService.createInstance(_.CharacterJoinerService),this._instantiationService.setService(S.ICharacterJoinerService,this._characterJoinerService),this._renderService=this.register(this._instantiationService.createInstance(x.RenderService,this.rows,this.screenElement)),this._instantiationService.setService(S.IRenderService,this._renderService),this.register(this._renderService.onRenderedViewportChange((W=>this._onRender.fire(W)))),this.onResize((W=>this._renderService.resize(W.cols,W.rows))),this._compositionView=K.createElement("div"),this._compositionView.classList.add("composition-view"),this._compositionHelper=this._instantiationService.createInstance(l.CompositionHelper,this.textarea,this._compositionView),this._helperContainer.appendChild(this._compositionView),this.element.appendChild(U);try{this._onWillOpen.fire(this.element)}catch{}this._renderService.hasRenderer()||this._renderService.setRenderer(this._createRenderer()),this._mouseService=this._instantiationService.createInstance(y.MouseService),this._instantiationService.setService(S.IMouseService,this._mouseService),this.viewport=this._instantiationService.createInstance(w.Viewport,this._viewportElement,this._viewportScrollArea),this.viewport.onRequestScrollLines((W=>this.scrollLines(W.amount,W.suppressScrollEvent,1))),this.register(this._inputHandler.onRequestSyncScrollBar((()=>this.viewport.syncScrollArea()))),this.register(this.viewport),this.register(this.onCursorMove((()=>{this._renderService.handleCursorMove(),this._syncTextArea()}))),this.register(this.onResize((()=>this._renderService.handleResize(this.cols,this.rows)))),this.register(this.onBlur((()=>this._renderService.handleBlur()))),this.register(this.onFocus((()=>this._renderService.handleFocus()))),this.register(this._renderService.onDimensionsChange((()=>this.viewport.syncScrollArea()))),this._selectionService=this.register(this._instantiationService.createInstance(m.SelectionService,this.element,this.screenElement,this.linkifier2)),this._instantiationService.setService(S.ISelectionService,this._selectionService),this.register(this._selectionService.onRequestScrollLines((W=>this.scrollLines(W.amount,W.suppressScrollEvent)))),this.register(this._selectionService.onSelectionChange((()=>this._onSelectionChange.fire()))),this.register(this._selectionService.onRequestRedraw((W=>this._renderService.handleSelectionChanged(W.start,W.end,W.columnSelectMode)))),this.register(this._selectionService.onLinuxMouseSelection((W=>{this.textarea.value=W,this.textarea.focus(),this.textarea.select()}))),this.register(this._onScroll.event((W=>{this.viewport.syncScrollArea(),this._selectionService.refresh()}))),this.register((0,p.addDisposableDomListener)(this._viewportElement,"scroll",(()=>this._selectionService.refresh()))),this.linkifier2.attachToDom(this.screenElement,this._mouseService,this._renderService),this.register(this._instantiationService.createInstance(b.BufferDecorationRenderer,this.screenElement)),this.register((0,p.addDisposableDomListener)(this.element,"mousedown",(W=>this._selectionService.handleMouseDown(W)))),this.coreMouseService.areMouseEventsActive?(this._selectionService.disable(),this.element.classList.add("enable-mouse-events")):this._selectionService.enable(),this.options.screenReaderMode&&(this._accessibilityManager.value=this._instantiationService.createInstance(j.AccessibilityManager,this)),this.register(this.optionsService.onSpecificOptionChange("screenReaderMode",(W=>this._handleScreenReaderModeOptionChange(W)))),this.options.overviewRulerWidth&&(this._overviewRulerRenderer=this.register(this._instantiationService.createInstance(o.OverviewRulerRenderer,this._viewportElement,this.screenElement))),this.optionsService.onSpecificOptionChange("overviewRulerWidth",(W=>{!this._overviewRulerRenderer&&W&&this._viewportElement&&this.screenElement&&(this._overviewRulerRenderer=this.register(this._instantiationService.createInstance(o.OverviewRulerRenderer,this._viewportElement,this.screenElement)))})),this._charSizeService.measure(),this.refresh(0,this.rows-1),this._initGlobal(),this.bindMouse()}_createRenderer(){return this._instantiationService.createInstance(a.DomRenderer,this.element,this.screenElement,this._viewportElement,this.linkifier2)}bindMouse(){let k=this,H=this.element;function U(V){let de=k._mouseService.getMouseReportCoords(V,k.screenElement);if(!de)return!1;let Ee,Me;switch(V.overrideType||V.type){case"mousemove":Me=32,V.buttons===void 0?(Ee=3,V.button!==void 0&&(Ee=V.button<3?V.button:3)):Ee=1&V.buttons?0:4&V.buttons?1:2&V.buttons?2:3;break;case"mouseup":Me=0,Ee=V.button<3?V.button:3;break;case"mousedown":Me=1,Ee=V.button<3?V.button:3;break;case"wheel":if(k.viewport.getLinesScrolled(V)===0)return!1;Me=V.deltaY<0?0:1,Ee=4;break;default:return!1}return!(Me===void 0||Ee===void 0||Ee>4)&&k.coreMouseService.triggerMouseEvent({col:de.col,row:de.row,x:de.x,y:de.y,button:Ee,action:Me,ctrl:V.ctrlKey,alt:V.altKey,shift:V.shiftKey})}let W={mouseup:null,wheel:null,mousedrag:null,mousemove:null},J={mouseup:V=>(U(V),V.buttons||(this._document.removeEventListener("mouseup",W.mouseup),W.mousedrag&&this._document.removeEventListener("mousemove",W.mousedrag)),this.cancel(V)),wheel:V=>(U(V),this.cancel(V,!0)),mousedrag:V=>{V.buttons&&U(V)},mousemove:V=>{V.buttons||U(V)}};this.register(this.coreMouseService.onProtocolChange((V=>{V?(this.optionsService.rawOptions.logLevel==="debug"&&this._logService.debug("Binding to mouse events:",this.coreMouseService.explainEvents(V)),this.element.classList.add("enable-mouse-events"),this._selectionService.disable()):(this._logService.debug("Unbinding from mouse events."),this.element.classList.remove("enable-mouse-events"),this._selectionService.enable()),8&V?W.mousemove||(H.addEventListener("mousemove",J.mousemove),W.mousemove=J.mousemove):(H.removeEventListener("mousemove",W.mousemove),W.mousemove=null),16&V?W.wheel||(H.addEventListener("wheel",J.wheel,{passive:!1}),W.wheel=J.wheel):(H.removeEventListener("wheel",W.wheel),W.wheel=null),2&V?W.mouseup||(H.addEventListener("mouseup",J.mouseup),W.mouseup=J.mouseup):(this._document.removeEventListener("mouseup",W.mouseup),H.removeEventListener("mouseup",W.mouseup),W.mouseup=null),4&V?W.mousedrag||(W.mousedrag=J.mousedrag):(this._document.removeEventListener("mousemove",W.mousedrag),W.mousedrag=null)}))),this.coreMouseService.activeProtocol=this.coreMouseService.activeProtocol,this.register((0,p.addDisposableDomListener)(H,"mousedown",(V=>{if(V.preventDefault(),this.focus(),this.coreMouseService.areMouseEventsActive&&!this._selectionService.shouldForceSelection(V))return U(V),W.mouseup&&this._document.addEventListener("mouseup",W.mouseup),W.mousedrag&&this._document.addEventListener("mousemove",W.mousedrag),this.cancel(V)}))),this.register((0,p.addDisposableDomListener)(H,"wheel",(V=>{if(!W.wheel){if(!this.buffer.hasScrollback){let de=this.viewport.getLinesScrolled(V);if(de===0)return;let Ee=I.C0.ESC+(this.coreService.decPrivateModes.applicationCursorKeys?"O":"[")+(V.deltaY<0?"A":"B"),Me="";for(let Kt=0;Kt<Math.abs(de);Kt++)Me+=Ee;return this.coreService.triggerDataEvent(Me,!0),this.cancel(V,!0)}return this.viewport.handleWheel(V)?this.cancel(V):void 0}}),{passive:!1})),this.register((0,p.addDisposableDomListener)(H,"touchstart",(V=>{if(!this.coreMouseService.areMouseEventsActive)return this.viewport.handleTouchStart(V),this.cancel(V)}),{passive:!0})),this.register((0,p.addDisposableDomListener)(H,"touchmove",(V=>{if(!this.coreMouseService.areMouseEventsActive)return this.viewport.handleTouchMove(V)?void 0:this.cancel(V)}),{passive:!1}))}refresh(k,H){var U;(U=this._renderService)===null||U===void 0||U.refreshRows(k,H)}updateCursorStyle(k){var H;!((H=this._selectionService)===null||H===void 0)&&H.shouldColumnSelect(k)?this.element.classList.add("column-select"):this.element.classList.remove("column-select")}_showCursor(){this.coreService.isCursorInitialized||(this.coreService.isCursorInitialized=!0,this.refresh(this.buffer.y,this.buffer.y))}scrollLines(k,H,U=0){var W;U===1?(super.scrollLines(k,H,U),this.refresh(0,this.rows-1)):(W=this.viewport)===null||W===void 0||W.scrollLines(k)}paste(k){(0,c.paste)(k,this.textarea,this.coreService,this.optionsService)}attachCustomKeyEventHandler(k){this._customKeyEventHandler=k}registerLinkProvider(k){return this.linkifier2.registerLinkProvider(k)}registerCharacterJoiner(k){if(!this._characterJoinerService)throw new Error("Terminal must be opened first");let H=this._characterJoinerService.register(k);return this.refresh(0,this.rows-1),H}deregisterCharacterJoiner(k){if(!this._characterJoinerService)throw new Error("Terminal must be opened first");this._characterJoinerService.deregister(k)&&this.refresh(0,this.rows-1)}get markers(){return this.buffer.markers}registerMarker(k){return this.buffer.addMarker(this.buffer.ybase+this.buffer.y+k)}registerDecoration(k){return this._decorationService.registerDecoration(k)}hasSelection(){return!!this._selectionService&&this._selectionService.hasSelection}select(k,H,U){this._selectionService.setSelection(k,H,U)}getSelection(){return this._selectionService?this._selectionService.selectionText:""}getSelectionPosition(){if(this._selectionService&&this._selectionService.hasSelection)return{start:{x:this._selectionService.selectionStart[0],y:this._selectionService.selectionStart[1]},end:{x:this._selectionService.selectionEnd[0],y:this._selectionService.selectionEnd[1]}}}clearSelection(){var k;(k=this._selectionService)===null||k===void 0||k.clearSelection()}selectAll(){var k;(k=this._selectionService)===null||k===void 0||k.selectAll()}selectLines(k,H){var U;(U=this._selectionService)===null||U===void 0||U.selectLines(k,H)}_keyDown(k){if(this._keyDownHandled=!1,this._keyDownSeen=!0,this._customKeyEventHandler&&this._customKeyEventHandler(k)===!1)return!1;let H=this.browser.isMac&&this.options.macOptionIsMeta&&k.altKey;if(!H&&!this._compositionHelper.keydown(k))return this.options.scrollOnUserInput&&this.buffer.ybase!==this.buffer.ydisp&&this.scrollToBottom(),!1;H||k.key!=="Dead"&&k.key!=="AltGraph"||(this._unprocessedDeadKey=!0);let U=(0,C.evaluateKeyboardEvent)(k,this.coreService.decPrivateModes.applicationCursorKeys,this.browser.isMac,this.options.macOptionIsMeta);if(this.updateCursorStyle(k),U.type===3||U.type===2){let W=this.rows-1;return this.scrollLines(U.type===2?-W:W),this.cancel(k,!0)}return U.type===1&&this.selectAll(),!!this._isThirdLevelShift(this.browser,k)||(U.cancel&&this.cancel(k,!0),!U.key||!!(k.key&&!k.ctrlKey&&!k.altKey&&!k.metaKey&&k.key.length===1&&k.key.charCodeAt(0)>=65&&k.key.charCodeAt(0)<=90)||(this._unprocessedDeadKey?(this._unprocessedDeadKey=!1,!0):(U.key!==I.C0.ETX&&U.key!==I.C0.CR||(this.textarea.value=""),this._onKey.fire({key:U.key,domEvent:k}),this._showCursor(),this.coreService.triggerDataEvent(U.key,!0),!this.optionsService.rawOptions.screenReaderMode||k.altKey||k.ctrlKey?this.cancel(k,!0):void(this._keyDownHandled=!0))))}_isThirdLevelShift(k,H){let U=k.isMac&&!this.options.macOptionIsMeta&&H.altKey&&!H.ctrlKey&&!H.metaKey||k.isWindows&&H.altKey&&H.ctrlKey&&!H.metaKey||k.isWindows&&H.getModifierState("AltGraph");return H.type==="keypress"?U:U&&(!H.keyCode||H.keyCode>47)}_keyUp(k){this._keyDownSeen=!1,this._customKeyEventHandler&&this._customKeyEventHandler(k)===!1||((function(H){return H.keyCode===16||H.keyCode===17||H.keyCode===18})(k)||this.focus(),this.updateCursorStyle(k),this._keyPressHandled=!1)}_keyPress(k){let H;if(this._keyPressHandled=!1,this._keyDownHandled||this._customKeyEventHandler&&this._customKeyEventHandler(k)===!1)return!1;if(this.cancel(k),k.charCode)H=k.charCode;else if(k.which===null||k.which===void 0)H=k.keyCode;else{if(k.which===0||k.charCode===0)return!1;H=k.which}return!(!H||(k.altKey||k.ctrlKey||k.metaKey)&&!this._isThirdLevelShift(this.browser,k)||(H=String.fromCharCode(H),this._onKey.fire({key:H,domEvent:k}),this._showCursor(),this.coreService.triggerDataEvent(H,!0),this._keyPressHandled=!0,this._unprocessedDeadKey=!1,0))}_inputEvent(k){if(k.data&&k.inputType==="insertText"&&(!k.composed||!this._keyDownSeen)&&!this.optionsService.rawOptions.screenReaderMode){if(this._keyPressHandled)return!1;this._unprocessedDeadKey=!1;let H=k.data;return this.coreService.triggerDataEvent(H,!0),this.cancel(k),!0}return!1}resize(k,H){k!==this.cols||H!==this.rows?super.resize(k,H):this._charSizeService&&!this._charSizeService.hasValidSize&&this._charSizeService.measure()}_afterResize(k,H){var U,W;(U=this._charSizeService)===null||U===void 0||U.measure(),(W=this.viewport)===null||W===void 0||W.syncScrollArea(!0)}clear(){var k;if(this.buffer.ybase!==0||this.buffer.y!==0){this.buffer.clearAllMarkers(),this.buffer.lines.set(0,this.buffer.lines.get(this.buffer.ybase+this.buffer.y)),this.buffer.lines.length=1,this.buffer.ydisp=0,this.buffer.ybase=0,this.buffer.y=0;for(let H=1;H<this.rows;H++)this.buffer.lines.push(this.buffer.getBlankLine(M.DEFAULT_ATTR_DATA));this._onScroll.fire({position:this.buffer.ydisp,source:0}),(k=this.viewport)===null||k===void 0||k.reset(),this.refresh(0,this.rows-1)}}reset(){var k,H;this.options.rows=this.rows,this.options.cols=this.cols;let U=this._customKeyEventHandler;this._setup(),super.reset(),(k=this._selectionService)===null||k===void 0||k.reset(),this._decorationService.reset(),(H=this.viewport)===null||H===void 0||H.reset(),this._customKeyEventHandler=U,this.refresh(0,this.rows-1)}clearTextureAtlas(){var k;(k=this._renderService)===null||k===void 0||k.clearTextureAtlas()}_reportFocus(){var k;!((k=this.element)===null||k===void 0)&&k.classList.contains("focus")?this.coreService.triggerDataEvent(I.C0.ESC+"[I"):this.coreService.triggerDataEvent(I.C0.ESC+"[O")}_reportWindowsOptions(k){if(this._renderService)switch(k){case N.WindowsOptionsReportType.GET_WIN_SIZE_PIXELS:let H=this._renderService.dimensions.css.canvas.width.toFixed(0),U=this._renderService.dimensions.css.canvas.height.toFixed(0);this.coreService.triggerDataEvent(`${I.C0.ESC}[4;${U};${H}t`);break;case N.WindowsOptionsReportType.GET_CELL_SIZE_PIXELS:let W=this._renderService.dimensions.css.cell.width.toFixed(0),J=this._renderService.dimensions.css.cell.height.toFixed(0);this.coreService.triggerDataEvent(`${I.C0.ESC}[6;${J};${W}t`)}}cancel(k,H){if(this.options.cancelEvents||H)return k.preventDefault(),k.stopPropagation(),!1}}i.Terminal=q},9924:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.TimeBasedDebouncer=void 0,i.TimeBasedDebouncer=class{constructor(r,c=1e3){this._renderCallback=r,this._debounceThresholdMS=c,this._lastRefreshMs=0,this._additionalRefreshRequested=!1}dispose(){this._refreshTimeoutID&&clearTimeout(this._refreshTimeoutID)}refresh(r,c,p){this._rowCount=p,r=r!==void 0?r:0,c=c!==void 0?c:this._rowCount-1,this._rowStart=this._rowStart!==void 0?Math.min(this._rowStart,r):r,this._rowEnd=this._rowEnd!==void 0?Math.max(this._rowEnd,c):c;let d=Date.now();if(d-this._lastRefreshMs>=this._debounceThresholdMS)this._lastRefreshMs=d,this._innerRefresh();else if(!this._additionalRefreshRequested){let f=d-this._lastRefreshMs,v=this._debounceThresholdMS-f;this._additionalRefreshRequested=!0,this._refreshTimeoutID=window.setTimeout((()=>{this._lastRefreshMs=Date.now(),this._innerRefresh(),this._additionalRefreshRequested=!1,this._refreshTimeoutID=void 0}),v)}}_innerRefresh(){if(this._rowStart===void 0||this._rowEnd===void 0||this._rowCount===void 0)return;let r=Math.max(this._rowStart,0),c=Math.min(this._rowEnd,this._rowCount-1);this._rowStart=void 0,this._rowEnd=void 0,this._renderCallback(r,c)}}},1680:function(u,i,r){var c=this&&this.__decorate||function(l,a,h,_){var g,y=arguments.length,x=y<3?a:_===null?_=Object.getOwnPropertyDescriptor(a,h):_;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")x=Reflect.decorate(l,a,h,_);else for(var m=l.length-1;m>=0;m--)(g=l[m])&&(x=(y<3?g(x):y>3?g(a,h,x):g(a,h))||x);return y>3&&x&&Object.defineProperty(a,h,x),x},p=this&&this.__param||function(l,a){return function(h,_){a(h,_,l)}};Object.defineProperty(i,"__esModule",{value:!0}),i.Viewport=void 0;let d=r(3656),f=r(4725),v=r(8460),w=r(844),b=r(2585),o=i.Viewport=class extends w.Disposable{constructor(l,a,h,_,g,y,x,m){super(),this._viewportElement=l,this._scrollArea=a,this._bufferService=h,this._optionsService=_,this._charSizeService=g,this._renderService=y,this._coreBrowserService=x,this.scrollBarWidth=0,this._currentRowHeight=0,this._currentDeviceCellHeight=0,this._lastRecordedBufferLength=0,this._lastRecordedViewportHeight=0,this._lastRecordedBufferHeight=0,this._lastTouchY=0,this._lastScrollTop=0,this._wheelPartialScroll=0,this._refreshAnimationFrame=null,this._ignoreNextScrollEvent=!1,this._smoothScrollState={startTime:0,origin:-1,target:-1},this._onRequestScrollLines=this.register(new v.EventEmitter),this.onRequestScrollLines=this._onRequestScrollLines.event,this.scrollBarWidth=this._viewportElement.offsetWidth-this._scrollArea.offsetWidth||15,this.register((0,d.addDisposableDomListener)(this._viewportElement,"scroll",this._handleScroll.bind(this))),this._activeBuffer=this._bufferService.buffer,this.register(this._bufferService.buffers.onBufferActivate((S=>this._activeBuffer=S.activeBuffer))),this._renderDimensions=this._renderService.dimensions,this.register(this._renderService.onDimensionsChange((S=>this._renderDimensions=S))),this._handleThemeChange(m.colors),this.register(m.onChangeColors((S=>this._handleThemeChange(S)))),this.register(this._optionsService.onSpecificOptionChange("scrollback",(()=>this.syncScrollArea()))),setTimeout((()=>this.syncScrollArea()))}_handleThemeChange(l){this._viewportElement.style.backgroundColor=l.background.css}reset(){this._currentRowHeight=0,this._currentDeviceCellHeight=0,this._lastRecordedBufferLength=0,this._lastRecordedViewportHeight=0,this._lastRecordedBufferHeight=0,this._lastTouchY=0,this._lastScrollTop=0,this._coreBrowserService.window.requestAnimationFrame((()=>this.syncScrollArea()))}_refresh(l){if(l)return this._innerRefresh(),void(this._refreshAnimationFrame!==null&&this._coreBrowserService.window.cancelAnimationFrame(this._refreshAnimationFrame));this._refreshAnimationFrame===null&&(this._refreshAnimationFrame=this._coreBrowserService.window.requestAnimationFrame((()=>this._innerRefresh())))}_innerRefresh(){if(this._charSizeService.height>0){this._currentRowHeight=this._renderService.dimensions.device.cell.height/this._coreBrowserService.dpr,this._currentDeviceCellHeight=this._renderService.dimensions.device.cell.height,this._lastRecordedViewportHeight=this._viewportElement.offsetHeight;let a=Math.round(this._currentRowHeight*this._lastRecordedBufferLength)+(this._lastRecordedViewportHeight-this._renderService.dimensions.css.canvas.height);this._lastRecordedBufferHeight!==a&&(this._lastRecordedBufferHeight=a,this._scrollArea.style.height=this._lastRecordedBufferHeight+"px")}let l=this._bufferService.buffer.ydisp*this._currentRowHeight;this._viewportElement.scrollTop!==l&&(this._ignoreNextScrollEvent=!0,this._viewportElement.scrollTop=l),this._refreshAnimationFrame=null}syncScrollArea(l=!1){if(this._lastRecordedBufferLength!==this._bufferService.buffer.lines.length)return this._lastRecordedBufferLength=this._bufferService.buffer.lines.length,void this._refresh(l);this._lastRecordedViewportHeight===this._renderService.dimensions.css.canvas.height&&this._lastScrollTop===this._activeBuffer.ydisp*this._currentRowHeight&&this._renderDimensions.device.cell.height===this._currentDeviceCellHeight||this._refresh(l)}_handleScroll(l){if(this._lastScrollTop=this._viewportElement.scrollTop,!this._viewportElement.offsetParent)return;if(this._ignoreNextScrollEvent)return this._ignoreNextScrollEvent=!1,void this._onRequestScrollLines.fire({amount:0,suppressScrollEvent:!0});let a=Math.round(this._lastScrollTop/this._currentRowHeight)-this._bufferService.buffer.ydisp;this._onRequestScrollLines.fire({amount:a,suppressScrollEvent:!0})}_smoothScroll(){if(this._isDisposed||this._smoothScrollState.origin===-1||this._smoothScrollState.target===-1)return;let l=this._smoothScrollPercent();this._viewportElement.scrollTop=this._smoothScrollState.origin+Math.round(l*(this._smoothScrollState.target-this._smoothScrollState.origin)),l<1?this._coreBrowserService.window.requestAnimationFrame((()=>this._smoothScroll())):this._clearSmoothScrollState()}_smoothScrollPercent(){return this._optionsService.rawOptions.smoothScrollDuration&&this._smoothScrollState.startTime?Math.max(Math.min((Date.now()-this._smoothScrollState.startTime)/this._optionsService.rawOptions.smoothScrollDuration,1),0):1}_clearSmoothScrollState(){this._smoothScrollState.startTime=0,this._smoothScrollState.origin=-1,this._smoothScrollState.target=-1}_bubbleScroll(l,a){let h=this._viewportElement.scrollTop+this._lastRecordedViewportHeight;return!(a<0&&this._viewportElement.scrollTop!==0||a>0&&h<this._lastRecordedBufferHeight)||(l.cancelable&&l.preventDefault(),!1)}handleWheel(l){let a=this._getPixelsScrolled(l);return a!==0&&(this._optionsService.rawOptions.smoothScrollDuration?(this._smoothScrollState.startTime=Date.now(),this._smoothScrollPercent()<1?(this._smoothScrollState.origin=this._viewportElement.scrollTop,this._smoothScrollState.target===-1?this._smoothScrollState.target=this._viewportElement.scrollTop+a:this._smoothScrollState.target+=a,this._smoothScrollState.target=Math.max(Math.min(this._smoothScrollState.target,this._viewportElement.scrollHeight),0),this._smoothScroll()):this._clearSmoothScrollState()):this._viewportElement.scrollTop+=a,this._bubbleScroll(l,a))}scrollLines(l){if(l!==0)if(this._optionsService.rawOptions.smoothScrollDuration){let a=l*this._currentRowHeight;this._smoothScrollState.startTime=Date.now(),this._smoothScrollPercent()<1?(this._smoothScrollState.origin=this._viewportElement.scrollTop,this._smoothScrollState.target=this._smoothScrollState.origin+a,this._smoothScrollState.target=Math.max(Math.min(this._smoothScrollState.target,this._viewportElement.scrollHeight),0),this._smoothScroll()):this._clearSmoothScrollState()}else this._onRequestScrollLines.fire({amount:l,suppressScrollEvent:!1})}_getPixelsScrolled(l){if(l.deltaY===0||l.shiftKey)return 0;let a=this._applyScrollModifier(l.deltaY,l);return l.deltaMode===WheelEvent.DOM_DELTA_LINE?a*=this._currentRowHeight:l.deltaMode===WheelEvent.DOM_DELTA_PAGE&&(a*=this._currentRowHeight*this._bufferService.rows),a}getBufferElements(l,a){var h;let _,g="",y=[],x=a??this._bufferService.buffer.lines.length,m=this._bufferService.buffer.lines;for(let S=l;S<x;S++){let L=m.get(S);if(!L)continue;let O=(h=m.get(S+1))===null||h===void 0?void 0:h.isWrapped;if(g+=L.translateToString(!O),!O||S===m.length-1){let D=document.createElement("div");D.textContent=g,y.push(D),g.length>0&&(_=D),g=""}}return{bufferElements:y,cursorElement:_}}getLinesScrolled(l){if(l.deltaY===0||l.shiftKey)return 0;let a=this._applyScrollModifier(l.deltaY,l);return l.deltaMode===WheelEvent.DOM_DELTA_PIXEL?(a/=this._currentRowHeight+0,this._wheelPartialScroll+=a,a=Math.floor(Math.abs(this._wheelPartialScroll))*(this._wheelPartialScroll>0?1:-1),this._wheelPartialScroll%=1):l.deltaMode===WheelEvent.DOM_DELTA_PAGE&&(a*=this._bufferService.rows),a}_applyScrollModifier(l,a){let h=this._optionsService.rawOptions.fastScrollModifier;return h==="alt"&&a.altKey||h==="ctrl"&&a.ctrlKey||h==="shift"&&a.shiftKey?l*this._optionsService.rawOptions.fastScrollSensitivity*this._optionsService.rawOptions.scrollSensitivity:l*this._optionsService.rawOptions.scrollSensitivity}handleTouchStart(l){this._lastTouchY=l.touches[0].pageY}handleTouchMove(l){let a=this._lastTouchY-l.touches[0].pageY;return this._lastTouchY=l.touches[0].pageY,a!==0&&(this._viewportElement.scrollTop+=a,this._bubbleScroll(l,a))}};i.Viewport=o=c([p(2,b.IBufferService),p(3,b.IOptionsService),p(4,f.ICharSizeService),p(5,f.IRenderService),p(6,f.ICoreBrowserService),p(7,f.IThemeService)],o)},3107:function(u,i,r){var c=this&&this.__decorate||function(o,l,a,h){var _,g=arguments.length,y=g<3?l:h===null?h=Object.getOwnPropertyDescriptor(l,a):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(o,l,a,h);else for(var x=o.length-1;x>=0;x--)(_=o[x])&&(y=(g<3?_(y):g>3?_(l,a,y):_(l,a))||y);return g>3&&y&&Object.defineProperty(l,a,y),y},p=this&&this.__param||function(o,l){return function(a,h){l(a,h,o)}};Object.defineProperty(i,"__esModule",{value:!0}),i.BufferDecorationRenderer=void 0;let d=r(3656),f=r(4725),v=r(844),w=r(2585),b=i.BufferDecorationRenderer=class extends v.Disposable{constructor(o,l,a,h){super(),this._screenElement=o,this._bufferService=l,this._decorationService=a,this._renderService=h,this._decorationElements=new Map,this._altBufferIsActive=!1,this._dimensionsChanged=!1,this._container=document.createElement("div"),this._container.classList.add("xterm-decoration-container"),this._screenElement.appendChild(this._container),this.register(this._renderService.onRenderedViewportChange((()=>this._doRefreshDecorations()))),this.register(this._renderService.onDimensionsChange((()=>{this._dimensionsChanged=!0,this._queueRefresh()}))),this.register((0,d.addDisposableDomListener)(window,"resize",(()=>this._queueRefresh()))),this.register(this._bufferService.buffers.onBufferActivate((()=>{this._altBufferIsActive=this._bufferService.buffer===this._bufferService.buffers.alt}))),this.register(this._decorationService.onDecorationRegistered((()=>this._queueRefresh()))),this.register(this._decorationService.onDecorationRemoved((_=>this._removeDecoration(_)))),this.register((0,v.toDisposable)((()=>{this._container.remove(),this._decorationElements.clear()})))}_queueRefresh(){this._animationFrame===void 0&&(this._animationFrame=this._renderService.addRefreshCallback((()=>{this._doRefreshDecorations(),this._animationFrame=void 0})))}_doRefreshDecorations(){for(let o of this._decorationService.decorations)this._renderDecoration(o);this._dimensionsChanged=!1}_renderDecoration(o){this._refreshStyle(o),this._dimensionsChanged&&this._refreshXPosition(o)}_createElement(o){var l,a;let h=document.createElement("div");h.classList.add("xterm-decoration"),h.classList.toggle("xterm-decoration-top-layer",((l=o?.options)===null||l===void 0?void 0:l.layer)==="top"),h.style.width=`${Math.round((o.options.width||1)*this._renderService.dimensions.css.cell.width)}px`,h.style.height=(o.options.height||1)*this._renderService.dimensions.css.cell.height+"px",h.style.top=(o.marker.line-this._bufferService.buffers.active.ydisp)*this._renderService.dimensions.css.cell.height+"px",h.style.lineHeight=`${this._renderService.dimensions.css.cell.height}px`;let _=(a=o.options.x)!==null&&a!==void 0?a:0;return _&&_>this._bufferService.cols&&(h.style.display="none"),this._refreshXPosition(o,h),h}_refreshStyle(o){let l=o.marker.line-this._bufferService.buffers.active.ydisp;if(l<0||l>=this._bufferService.rows)o.element&&(o.element.style.display="none",o.onRenderEmitter.fire(o.element));else{let a=this._decorationElements.get(o);a||(a=this._createElement(o),o.element=a,this._decorationElements.set(o,a),this._container.appendChild(a),o.onDispose((()=>{this._decorationElements.delete(o),a.remove()}))),a.style.top=l*this._renderService.dimensions.css.cell.height+"px",a.style.display=this._altBufferIsActive?"none":"block",o.onRenderEmitter.fire(a)}}_refreshXPosition(o,l=o.element){var a;if(!l)return;let h=(a=o.options.x)!==null&&a!==void 0?a:0;(o.options.anchor||"left")==="right"?l.style.right=h?h*this._renderService.dimensions.css.cell.width+"px":"":l.style.left=h?h*this._renderService.dimensions.css.cell.width+"px":""}_removeDecoration(o){var l;(l=this._decorationElements.get(o))===null||l===void 0||l.remove(),this._decorationElements.delete(o),o.dispose()}};i.BufferDecorationRenderer=b=c([p(1,w.IBufferService),p(2,w.IDecorationService),p(3,f.IRenderService)],b)},5871:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ColorZoneStore=void 0,i.ColorZoneStore=class{constructor(){this._zones=[],this._zonePool=[],this._zonePoolIndex=0,this._linePadding={full:0,left:0,center:0,right:0}}get zones(){return this._zonePool.length=Math.min(this._zonePool.length,this._zones.length),this._zones}clear(){this._zones.length=0,this._zonePoolIndex=0}addDecoration(r){if(r.options.overviewRulerOptions){for(let c of this._zones)if(c.color===r.options.overviewRulerOptions.color&&c.position===r.options.overviewRulerOptions.position){if(this._lineIntersectsZone(c,r.marker.line))return;if(this._lineAdjacentToZone(c,r.marker.line,r.options.overviewRulerOptions.position))return void this._addLineToZone(c,r.marker.line)}if(this._zonePoolIndex<this._zonePool.length)return this._zonePool[this._zonePoolIndex].color=r.options.overviewRulerOptions.color,this._zonePool[this._zonePoolIndex].position=r.options.overviewRulerOptions.position,this._zonePool[this._zonePoolIndex].startBufferLine=r.marker.line,this._zonePool[this._zonePoolIndex].endBufferLine=r.marker.line,void this._zones.push(this._zonePool[this._zonePoolIndex++]);this._zones.push({color:r.options.overviewRulerOptions.color,position:r.options.overviewRulerOptions.position,startBufferLine:r.marker.line,endBufferLine:r.marker.line}),this._zonePool.push(this._zones[this._zones.length-1]),this._zonePoolIndex++}}setPadding(r){this._linePadding=r}_lineIntersectsZone(r,c){return c>=r.startBufferLine&&c<=r.endBufferLine}_lineAdjacentToZone(r,c,p){return c>=r.startBufferLine-this._linePadding[p||"full"]&&c<=r.endBufferLine+this._linePadding[p||"full"]}_addLineToZone(r,c){r.startBufferLine=Math.min(r.startBufferLine,c),r.endBufferLine=Math.max(r.endBufferLine,c)}}},5744:function(u,i,r){var c=this&&this.__decorate||function(_,g,y,x){var m,S=arguments.length,L=S<3?g:x===null?x=Object.getOwnPropertyDescriptor(g,y):x;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")L=Reflect.decorate(_,g,y,x);else for(var O=_.length-1;O>=0;O--)(m=_[O])&&(L=(S<3?m(L):S>3?m(g,y,L):m(g,y))||L);return S>3&&L&&Object.defineProperty(g,y,L),L},p=this&&this.__param||function(_,g){return function(y,x){g(y,x,_)}};Object.defineProperty(i,"__esModule",{value:!0}),i.OverviewRulerRenderer=void 0;let d=r(5871),f=r(3656),v=r(4725),w=r(844),b=r(2585),o={full:0,left:0,center:0,right:0},l={full:0,left:0,center:0,right:0},a={full:0,left:0,center:0,right:0},h=i.OverviewRulerRenderer=class extends w.Disposable{get _width(){return this._optionsService.options.overviewRulerWidth||0}constructor(_,g,y,x,m,S,L){var O;super(),this._viewportElement=_,this._screenElement=g,this._bufferService=y,this._decorationService=x,this._renderService=m,this._optionsService=S,this._coreBrowseService=L,this._colorZoneStore=new d.ColorZoneStore,this._shouldUpdateDimensions=!0,this._shouldUpdateAnchor=!0,this._lastKnownBufferLength=0,this._canvas=document.createElement("canvas"),this._canvas.classList.add("xterm-decoration-overview-ruler"),this._refreshCanvasDimensions(),(O=this._viewportElement.parentElement)===null||O===void 0||O.insertBefore(this._canvas,this._viewportElement);let D=this._canvas.getContext("2d");if(!D)throw new Error("Ctx cannot be null");this._ctx=D,this._registerDecorationListeners(),this._registerBufferChangeListeners(),this._registerDimensionChangeListeners(),this.register((0,w.toDisposable)((()=>{var B;(B=this._canvas)===null||B===void 0||B.remove()})))}_registerDecorationListeners(){this.register(this._decorationService.onDecorationRegistered((()=>this._queueRefresh(void 0,!0)))),this.register(this._decorationService.onDecorationRemoved((()=>this._queueRefresh(void 0,!0))))}_registerBufferChangeListeners(){this.register(this._renderService.onRenderedViewportChange((()=>this._queueRefresh()))),this.register(this._bufferService.buffers.onBufferActivate((()=>{this._canvas.style.display=this._bufferService.buffer===this._bufferService.buffers.alt?"none":"block"}))),this.register(this._bufferService.onScroll((()=>{this._lastKnownBufferLength!==this._bufferService.buffers.normal.lines.length&&(this._refreshDrawHeightConstants(),this._refreshColorZonePadding())})))}_registerDimensionChangeListeners(){this.register(this._renderService.onRender((()=>{this._containerHeight&&this._containerHeight===this._screenElement.clientHeight||(this._queueRefresh(!0),this._containerHeight=this._screenElement.clientHeight)}))),this.register(this._optionsService.onSpecificOptionChange("overviewRulerWidth",(()=>this._queueRefresh(!0)))),this.register((0,f.addDisposableDomListener)(this._coreBrowseService.window,"resize",(()=>this._queueRefresh(!0)))),this._queueRefresh(!0)}_refreshDrawConstants(){let _=Math.floor(this._canvas.width/3),g=Math.ceil(this._canvas.width/3);l.full=this._canvas.width,l.left=_,l.center=g,l.right=_,this._refreshDrawHeightConstants(),a.full=0,a.left=0,a.center=l.left,a.right=l.left+l.center}_refreshDrawHeightConstants(){o.full=Math.round(2*this._coreBrowseService.dpr);let _=this._canvas.height/this._bufferService.buffer.lines.length,g=Math.round(Math.max(Math.min(_,12),6)*this._coreBrowseService.dpr);o.left=g,o.center=g,o.right=g}_refreshColorZonePadding(){this._colorZoneStore.setPadding({full:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*o.full),left:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*o.left),center:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*o.center),right:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*o.right)}),this._lastKnownBufferLength=this._bufferService.buffers.normal.lines.length}_refreshCanvasDimensions(){this._canvas.style.width=`${this._width}px`,this._canvas.width=Math.round(this._width*this._coreBrowseService.dpr),this._canvas.style.height=`${this._screenElement.clientHeight}px`,this._canvas.height=Math.round(this._screenElement.clientHeight*this._coreBrowseService.dpr),this._refreshDrawConstants(),this._refreshColorZonePadding()}_refreshDecorations(){this._shouldUpdateDimensions&&this._refreshCanvasDimensions(),this._ctx.clearRect(0,0,this._canvas.width,this._canvas.height),this._colorZoneStore.clear();for(let g of this._decorationService.decorations)this._colorZoneStore.addDecoration(g);this._ctx.lineWidth=1;let _=this._colorZoneStore.zones;for(let g of _)g.position!=="full"&&this._renderColorZone(g);for(let g of _)g.position==="full"&&this._renderColorZone(g);this._shouldUpdateDimensions=!1,this._shouldUpdateAnchor=!1}_renderColorZone(_){this._ctx.fillStyle=_.color,this._ctx.fillRect(a[_.position||"full"],Math.round((this._canvas.height-1)*(_.startBufferLine/this._bufferService.buffers.active.lines.length)-o[_.position||"full"]/2),l[_.position||"full"],Math.round((this._canvas.height-1)*((_.endBufferLine-_.startBufferLine)/this._bufferService.buffers.active.lines.length)+o[_.position||"full"]))}_queueRefresh(_,g){this._shouldUpdateDimensions=_||this._shouldUpdateDimensions,this._shouldUpdateAnchor=g||this._shouldUpdateAnchor,this._animationFrame===void 0&&(this._animationFrame=this._coreBrowseService.window.requestAnimationFrame((()=>{this._refreshDecorations(),this._animationFrame=void 0})))}};i.OverviewRulerRenderer=h=c([p(2,b.IBufferService),p(3,b.IDecorationService),p(4,v.IRenderService),p(5,b.IOptionsService),p(6,v.ICoreBrowserService)],h)},2950:function(u,i,r){var c=this&&this.__decorate||function(b,o,l,a){var h,_=arguments.length,g=_<3?o:a===null?a=Object.getOwnPropertyDescriptor(o,l):a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")g=Reflect.decorate(b,o,l,a);else for(var y=b.length-1;y>=0;y--)(h=b[y])&&(g=(_<3?h(g):_>3?h(o,l,g):h(o,l))||g);return _>3&&g&&Object.defineProperty(o,l,g),g},p=this&&this.__param||function(b,o){return function(l,a){o(l,a,b)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CompositionHelper=void 0;let d=r(4725),f=r(2585),v=r(2584),w=i.CompositionHelper=class{get isComposing(){return this._isComposing}constructor(b,o,l,a,h,_){this._textarea=b,this._compositionView=o,this._bufferService=l,this._optionsService=a,this._coreService=h,this._renderService=_,this._isComposing=!1,this._isSendingComposition=!1,this._compositionPosition={start:0,end:0},this._dataAlreadySent=""}compositionstart(){this._isComposing=!0,this._compositionPosition.start=this._textarea.value.length,this._compositionView.textContent="",this._dataAlreadySent="",this._compositionView.classList.add("active")}compositionupdate(b){this._compositionView.textContent=b.data,this.updateCompositionElements(),setTimeout((()=>{this._compositionPosition.end=this._textarea.value.length}),0)}compositionend(){this._finalizeComposition(!0)}keydown(b){if(this._isComposing||this._isSendingComposition){if(b.keyCode===229||b.keyCode===16||b.keyCode===17||b.keyCode===18)return!1;this._finalizeComposition(!1)}return b.keyCode!==229||(this._handleAnyTextareaChanges(),!1)}_finalizeComposition(b){if(this._compositionView.classList.remove("active"),this._isComposing=!1,b){let o={start:this._compositionPosition.start,end:this._compositionPosition.end};this._isSendingComposition=!0,setTimeout((()=>{if(this._isSendingComposition){let l;this._isSendingComposition=!1,o.start+=this._dataAlreadySent.length,l=this._isComposing?this._textarea.value.substring(o.start,o.end):this._textarea.value.substring(o.start),l.length>0&&this._coreService.triggerDataEvent(l,!0)}}),0)}else{this._isSendingComposition=!1;let o=this._textarea.value.substring(this._compositionPosition.start,this._compositionPosition.end);this._coreService.triggerDataEvent(o,!0)}}_handleAnyTextareaChanges(){let b=this._textarea.value;setTimeout((()=>{if(!this._isComposing){let o=this._textarea.value,l=o.replace(b,"");this._dataAlreadySent=l,o.length>b.length?this._coreService.triggerDataEvent(l,!0):o.length<b.length?this._coreService.triggerDataEvent(`${v.C0.DEL}`,!0):o.length===b.length&&o!==b&&this._coreService.triggerDataEvent(o,!0)}}),0)}updateCompositionElements(b){if(this._isComposing){if(this._bufferService.buffer.isCursorInViewport){let o=Math.min(this._bufferService.buffer.x,this._bufferService.cols-1),l=this._renderService.dimensions.css.cell.height,a=this._bufferService.buffer.y*this._renderService.dimensions.css.cell.height,h=o*this._renderService.dimensions.css.cell.width;this._compositionView.style.left=h+"px",this._compositionView.style.top=a+"px",this._compositionView.style.height=l+"px",this._compositionView.style.lineHeight=l+"px",this._compositionView.style.fontFamily=this._optionsService.rawOptions.fontFamily,this._compositionView.style.fontSize=this._optionsService.rawOptions.fontSize+"px";let _=this._compositionView.getBoundingClientRect();this._textarea.style.left=h+"px",this._textarea.style.top=a+"px",this._textarea.style.width=Math.max(_.width,1)+"px",this._textarea.style.height=Math.max(_.height,1)+"px",this._textarea.style.lineHeight=_.height+"px"}b||setTimeout((()=>this.updateCompositionElements(!0)),0)}}};i.CompositionHelper=w=c([p(2,f.IBufferService),p(3,f.IOptionsService),p(4,f.ICoreService),p(5,d.IRenderService)],w)},9806:(u,i)=>{function r(c,p,d){let f=d.getBoundingClientRect(),v=c.getComputedStyle(d),w=parseInt(v.getPropertyValue("padding-left")),b=parseInt(v.getPropertyValue("padding-top"));return[p.clientX-f.left-w,p.clientY-f.top-b]}Object.defineProperty(i,"__esModule",{value:!0}),i.getCoords=i.getCoordsRelativeToElement=void 0,i.getCoordsRelativeToElement=r,i.getCoords=function(c,p,d,f,v,w,b,o,l){if(!w)return;let a=r(c,p,d);return a?(a[0]=Math.ceil((a[0]+(l?b/2:0))/b),a[1]=Math.ceil(a[1]/o),a[0]=Math.min(Math.max(a[0],1),f+(l?1:0)),a[1]=Math.min(Math.max(a[1],1),v),a):void 0}},9504:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.moveToCellSequence=void 0;let c=r(2584);function p(o,l,a,h){let _=o-d(o,a),g=l-d(l,a),y=Math.abs(_-g)-(function(x,m,S){let L=0,O=x-d(x,S),D=m-d(m,S);for(let B=0;B<Math.abs(O-D);B++){let F=f(x,m)==="A"?-1:1,P=S.buffer.lines.get(O+F*B);P?.isWrapped&&L++}return L})(o,l,a);return b(y,w(f(o,l),h))}function d(o,l){let a=0,h=l.buffer.lines.get(o),_=h?.isWrapped;for(;_&&o>=0&&o<l.rows;)a++,h=l.buffer.lines.get(--o),_=h?.isWrapped;return a}function f(o,l){return o>l?"A":"B"}function v(o,l,a,h,_,g){let y=o,x=l,m="";for(;y!==a||x!==h;)y+=_?1:-1,_&&y>g.cols-1?(m+=g.buffer.translateBufferLineToString(x,!1,o,y),y=0,o=0,x++):!_&&y<0&&(m+=g.buffer.translateBufferLineToString(x,!1,0,o+1),y=g.cols-1,o=y,x--);return m+g.buffer.translateBufferLineToString(x,!1,o,y)}function w(o,l){let a=l?"O":"[";return c.C0.ESC+a+o}function b(o,l){o=Math.floor(o);let a="";for(let h=0;h<o;h++)a+=l;return a}i.moveToCellSequence=function(o,l,a,h){let _=a.buffer.x,g=a.buffer.y;if(!a.buffer.hasScrollback)return(function(m,S,L,O,D,B){return p(S,O,D,B).length===0?"":b(v(m,S,m,S-d(S,D),!1,D).length,w("D",B))})(_,g,0,l,a,h)+p(g,l,a,h)+(function(m,S,L,O,D,B){let F;F=p(S,O,D,B).length>0?O-d(O,D):S;let P=O,M=(function(I,C,E,A,R,N){let j;return j=p(E,A,R,N).length>0?A-d(A,R):C,I<E&&j<=A||I>=E&&j<A?"C":"D"})(m,S,L,O,D,B);return b(v(m,F,L,P,M==="C",D).length,w(M,B))})(_,g,o,l,a,h);let y;if(g===l)return y=_>o?"D":"C",b(Math.abs(_-o),w(y,h));y=g>l?"D":"C";let x=Math.abs(g-l);return b((function(m,S){return S.cols-m})(g>l?o:_,a)+(x-1)*a.cols+1+((g>l?_:o)-1),w(y,h))}},1296:function(u,i,r){var c=this&&this.__decorate||function(D,B,F,P){var M,I=arguments.length,C=I<3?B:P===null?P=Object.getOwnPropertyDescriptor(B,F):P;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")C=Reflect.decorate(D,B,F,P);else for(var E=D.length-1;E>=0;E--)(M=D[E])&&(C=(I<3?M(C):I>3?M(B,F,C):M(B,F))||C);return I>3&&C&&Object.defineProperty(B,F,C),C},p=this&&this.__param||function(D,B){return function(F,P){B(F,P,D)}};Object.defineProperty(i,"__esModule",{value:!0}),i.DomRenderer=void 0;let d=r(3787),f=r(2550),v=r(2223),w=r(6171),b=r(4725),o=r(8055),l=r(8460),a=r(844),h=r(2585),_="xterm-dom-renderer-owner-",g="xterm-rows",y="xterm-fg-",x="xterm-bg-",m="xterm-focus",S="xterm-selection",L=1,O=i.DomRenderer=class extends a.Disposable{constructor(D,B,F,P,M,I,C,E,A,R){super(),this._element=D,this._screenElement=B,this._viewportElement=F,this._linkifier2=P,this._charSizeService=I,this._optionsService=C,this._bufferService=E,this._coreBrowserService=A,this._themeService=R,this._terminalClass=L++,this._rowElements=[],this.onRequestRedraw=this.register(new l.EventEmitter).event,this._rowContainer=document.createElement("div"),this._rowContainer.classList.add(g),this._rowContainer.style.lineHeight="normal",this._rowContainer.setAttribute("aria-hidden","true"),this._refreshRowElements(this._bufferService.cols,this._bufferService.rows),this._selectionContainer=document.createElement("div"),this._selectionContainer.classList.add(S),this._selectionContainer.setAttribute("aria-hidden","true"),this.dimensions=(0,w.createRenderDimensions)(),this._updateDimensions(),this.register(this._optionsService.onOptionChange((()=>this._handleOptionsChanged()))),this.register(this._themeService.onChangeColors((N=>this._injectCss(N)))),this._injectCss(this._themeService.colors),this._rowFactory=M.createInstance(d.DomRendererRowFactory,document),this._element.classList.add(_+this._terminalClass),this._screenElement.appendChild(this._rowContainer),this._screenElement.appendChild(this._selectionContainer),this.register(this._linkifier2.onShowLinkUnderline((N=>this._handleLinkHover(N)))),this.register(this._linkifier2.onHideLinkUnderline((N=>this._handleLinkLeave(N)))),this.register((0,a.toDisposable)((()=>{this._element.classList.remove(_+this._terminalClass),this._rowContainer.remove(),this._selectionContainer.remove(),this._widthCache.dispose(),this._themeStyleElement.remove(),this._dimensionsStyleElement.remove()}))),this._widthCache=new f.WidthCache(document),this._widthCache.setFont(this._optionsService.rawOptions.fontFamily,this._optionsService.rawOptions.fontSize,this._optionsService.rawOptions.fontWeight,this._optionsService.rawOptions.fontWeightBold),this._setDefaultSpacing()}_updateDimensions(){let D=this._coreBrowserService.dpr;this.dimensions.device.char.width=this._charSizeService.width*D,this.dimensions.device.char.height=Math.ceil(this._charSizeService.height*D),this.dimensions.device.cell.width=this.dimensions.device.char.width+Math.round(this._optionsService.rawOptions.letterSpacing),this.dimensions.device.cell.height=Math.floor(this.dimensions.device.char.height*this._optionsService.rawOptions.lineHeight),this.dimensions.device.char.left=0,this.dimensions.device.char.top=0,this.dimensions.device.canvas.width=this.dimensions.device.cell.width*this._bufferService.cols,this.dimensions.device.canvas.height=this.dimensions.device.cell.height*this._bufferService.rows,this.dimensions.css.canvas.width=Math.round(this.dimensions.device.canvas.width/D),this.dimensions.css.canvas.height=Math.round(this.dimensions.device.canvas.height/D),this.dimensions.css.cell.width=this.dimensions.css.canvas.width/this._bufferService.cols,this.dimensions.css.cell.height=this.dimensions.css.canvas.height/this._bufferService.rows;for(let F of this._rowElements)F.style.width=`${this.dimensions.css.canvas.width}px`,F.style.height=`${this.dimensions.css.cell.height}px`,F.style.lineHeight=`${this.dimensions.css.cell.height}px`,F.style.overflow="hidden";this._dimensionsStyleElement||(this._dimensionsStyleElement=document.createElement("style"),this._screenElement.appendChild(this._dimensionsStyleElement));let B=`${this._terminalSelector} .${g} span { display: inline-block; height: 100%; vertical-align: top;}`;this._dimensionsStyleElement.textContent=B,this._selectionContainer.style.height=this._viewportElement.style.height,this._screenElement.style.width=`${this.dimensions.css.canvas.width}px`,this._screenElement.style.height=`${this.dimensions.css.canvas.height}px`}_injectCss(D){this._themeStyleElement||(this._themeStyleElement=document.createElement("style"),this._screenElement.appendChild(this._themeStyleElement));let B=`${this._terminalSelector} .${g} { color: ${D.foreground.css}; font-family: ${this._optionsService.rawOptions.fontFamily}; font-size: ${this._optionsService.rawOptions.fontSize}px; font-kerning: none; white-space: pre}`;B+=`${this._terminalSelector} .${g} .xterm-dim { color: ${o.color.multiplyOpacity(D.foreground,.5).css};}`,B+=`${this._terminalSelector} span:not(.xterm-bold) { font-weight: ${this._optionsService.rawOptions.fontWeight};}${this._terminalSelector} span.xterm-bold { font-weight: ${this._optionsService.rawOptions.fontWeightBold};}${this._terminalSelector} span.xterm-italic { font-style: italic;}`,B+="@keyframes blink_box_shadow_"+this._terminalClass+" { 50% {  border-bottom-style: hidden; }}",B+="@keyframes blink_block_"+this._terminalClass+` { 0% {  background-color: ${D.cursor.css};  color: ${D.cursorAccent.css}; } 50% {  background-color: inherit;  color: ${D.cursor.css}; }}`,B+=`${this._terminalSelector} .${g}.${m} .xterm-cursor.xterm-cursor-blink:not(.xterm-cursor-block) { animation: blink_box_shadow_`+this._terminalClass+` 1s step-end infinite;}${this._terminalSelector} .${g}.${m} .xterm-cursor.xterm-cursor-blink.xterm-cursor-block { animation: blink_block_`+this._terminalClass+` 1s step-end infinite;}${this._terminalSelector} .${g} .xterm-cursor.xterm-cursor-block { background-color: ${D.cursor.css}; color: ${D.cursorAccent.css};}${this._terminalSelector} .${g} .xterm-cursor.xterm-cursor-outline { outline: 1px solid ${D.cursor.css}; outline-offset: -1px;}${this._terminalSelector} .${g} .xterm-cursor.xterm-cursor-bar { box-shadow: ${this._optionsService.rawOptions.cursorWidth}px 0 0 ${D.cursor.css} inset;}${this._terminalSelector} .${g} .xterm-cursor.xterm-cursor-underline { border-bottom: 1px ${D.cursor.css}; border-bottom-style: solid; height: calc(100% - 1px);}`,B+=`${this._terminalSelector} .${S} { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none;}${this._terminalSelector}.focus .${S} div { position: absolute; background-color: ${D.selectionBackgroundOpaque.css};}${this._terminalSelector} .${S} div { position: absolute; background-color: ${D.selectionInactiveBackgroundOpaque.css};}`;for(let[F,P]of D.ansi.entries())B+=`${this._terminalSelector} .${y}${F} { color: ${P.css}; }${this._terminalSelector} .${y}${F}.xterm-dim { color: ${o.color.multiplyOpacity(P,.5).css}; }${this._terminalSelector} .${x}${F} { background-color: ${P.css}; }`;B+=`${this._terminalSelector} .${y}${v.INVERTED_DEFAULT_COLOR} { color: ${o.color.opaque(D.background).css}; }${this._terminalSelector} .${y}${v.INVERTED_DEFAULT_COLOR}.xterm-dim { color: ${o.color.multiplyOpacity(o.color.opaque(D.background),.5).css}; }${this._terminalSelector} .${x}${v.INVERTED_DEFAULT_COLOR} { background-color: ${D.foreground.css}; }`,this._themeStyleElement.textContent=B}_setDefaultSpacing(){let D=this.dimensions.css.cell.width-this._widthCache.get("W",!1,!1);this._rowContainer.style.letterSpacing=`${D}px`,this._rowFactory.defaultSpacing=D}handleDevicePixelRatioChange(){this._updateDimensions(),this._widthCache.clear(),this._setDefaultSpacing()}_refreshRowElements(D,B){for(let F=this._rowElements.length;F<=B;F++){let P=document.createElement("div");this._rowContainer.appendChild(P),this._rowElements.push(P)}for(;this._rowElements.length>B;)this._rowContainer.removeChild(this._rowElements.pop())}handleResize(D,B){this._refreshRowElements(D,B),this._updateDimensions()}handleCharSizeChanged(){this._updateDimensions(),this._widthCache.clear(),this._setDefaultSpacing()}handleBlur(){this._rowContainer.classList.remove(m)}handleFocus(){this._rowContainer.classList.add(m),this.renderRows(this._bufferService.buffer.y,this._bufferService.buffer.y)}handleSelectionChanged(D,B,F){if(this._selectionContainer.replaceChildren(),this._rowFactory.handleSelectionChanged(D,B,F),this.renderRows(0,this._bufferService.rows-1),!D||!B)return;let P=D[1]-this._bufferService.buffer.ydisp,M=B[1]-this._bufferService.buffer.ydisp,I=Math.max(P,0),C=Math.min(M,this._bufferService.rows-1);if(I>=this._bufferService.rows||C<0)return;let E=document.createDocumentFragment();if(F){let A=D[0]>B[0];E.appendChild(this._createSelectionElement(I,A?B[0]:D[0],A?D[0]:B[0],C-I+1))}else{let A=P===I?D[0]:0,R=I===M?B[0]:this._bufferService.cols;E.appendChild(this._createSelectionElement(I,A,R));let N=C-I-1;if(E.appendChild(this._createSelectionElement(I+1,0,this._bufferService.cols,N)),I!==C){let j=M===C?B[0]:this._bufferService.cols;E.appendChild(this._createSelectionElement(C,0,j))}}this._selectionContainer.appendChild(E)}_createSelectionElement(D,B,F,P=1){let M=document.createElement("div");return M.style.height=P*this.dimensions.css.cell.height+"px",M.style.top=D*this.dimensions.css.cell.height+"px",M.style.left=B*this.dimensions.css.cell.width+"px",M.style.width=this.dimensions.css.cell.width*(F-B)+"px",M}handleCursorMove(){}_handleOptionsChanged(){this._updateDimensions(),this._injectCss(this._themeService.colors),this._widthCache.setFont(this._optionsService.rawOptions.fontFamily,this._optionsService.rawOptions.fontSize,this._optionsService.rawOptions.fontWeight,this._optionsService.rawOptions.fontWeightBold),this._setDefaultSpacing()}clear(){for(let D of this._rowElements)D.replaceChildren()}renderRows(D,B){let F=this._bufferService.buffer,P=F.ybase+F.y,M=Math.min(F.x,this._bufferService.cols-1),I=this._optionsService.rawOptions.cursorBlink,C=this._optionsService.rawOptions.cursorStyle,E=this._optionsService.rawOptions.cursorInactiveStyle;for(let A=D;A<=B;A++){let R=A+F.ydisp,N=this._rowElements[A],j=F.lines.get(R);if(!N||!j)break;N.replaceChildren(...this._rowFactory.createRow(j,R,R===P,C,E,M,I,this.dimensions.css.cell.width,this._widthCache,-1,-1))}}get _terminalSelector(){return`.${_}${this._terminalClass}`}_handleLinkHover(D){this._setCellUnderline(D.x1,D.x2,D.y1,D.y2,D.cols,!0)}_handleLinkLeave(D){this._setCellUnderline(D.x1,D.x2,D.y1,D.y2,D.cols,!1)}_setCellUnderline(D,B,F,P,M,I){F<0&&(D=0),P<0&&(B=0);let C=this._bufferService.rows-1;F=Math.max(Math.min(F,C),0),P=Math.max(Math.min(P,C),0),M=Math.min(M,this._bufferService.cols);let E=this._bufferService.buffer,A=E.ybase+E.y,R=Math.min(E.x,M-1),N=this._optionsService.rawOptions.cursorBlink,j=this._optionsService.rawOptions.cursorStyle,K=this._optionsService.rawOptions.cursorInactiveStyle;for(let q=F;q<=P;++q){let he=q+E.ydisp,k=this._rowElements[q],H=E.lines.get(he);if(!k||!H)break;k.replaceChildren(...this._rowFactory.createRow(H,he,he===A,j,K,R,N,this.dimensions.css.cell.width,this._widthCache,I?q===F?D:0:-1,I?(q===P?B:M)-1:-1))}}};i.DomRenderer=O=c([p(4,h.IInstantiationService),p(5,b.ICharSizeService),p(6,h.IOptionsService),p(7,h.IBufferService),p(8,b.ICoreBrowserService),p(9,b.IThemeService)],O)},3787:function(u,i,r){var c=this&&this.__decorate||function(y,x,m,S){var L,O=arguments.length,D=O<3?x:S===null?S=Object.getOwnPropertyDescriptor(x,m):S;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")D=Reflect.decorate(y,x,m,S);else for(var B=y.length-1;B>=0;B--)(L=y[B])&&(D=(O<3?L(D):O>3?L(x,m,D):L(x,m))||D);return O>3&&D&&Object.defineProperty(x,m,D),D},p=this&&this.__param||function(y,x){return function(m,S){x(m,S,y)}};Object.defineProperty(i,"__esModule",{value:!0}),i.DomRendererRowFactory=void 0;let d=r(2223),f=r(643),v=r(511),w=r(2585),b=r(8055),o=r(4725),l=r(4269),a=r(6171),h=r(3734),_=i.DomRendererRowFactory=class{constructor(y,x,m,S,L,O,D){this._document=y,this._characterJoinerService=x,this._optionsService=m,this._coreBrowserService=S,this._coreService=L,this._decorationService=O,this._themeService=D,this._workCell=new v.CellData,this._columnSelectMode=!1,this.defaultSpacing=0}handleSelectionChanged(y,x,m){this._selectionStart=y,this._selectionEnd=x,this._columnSelectMode=m}createRow(y,x,m,S,L,O,D,B,F,P,M){let I=[],C=this._characterJoinerService.getJoinedCharacters(x),E=this._themeService.colors,A,R=y.getNoBgTrimmedLength();m&&R<O+1&&(R=O+1);let N=0,j="",K=0,q=0,he=0,k=!1,H=0,U=!1,W=0,J=[],V=P!==-1&&M!==-1;for(let de=0;de<R;de++){y.loadCell(de,this._workCell);let Ee=this._workCell.getWidth();if(Ee===0)continue;let Me=!1,Kt=de,oe=this._workCell;if(C.length>0&&de===C[0][0]){Me=!0;let me=C.shift();oe=new l.JoinedCellData(this._workCell,y.translateToString(!0,me[0],me[1]),me[1]-me[0]),Kt=me[1]-1,Ee=oe.getWidth()}let fi=this._isCellInSelection(de,x),Ns=m&&de===O,Ws=V&&de>=P&&de<=M,Us=!1;this._decorationService.forEachDecorationAtCell(de,x,void 0,(me=>{Us=!0}));let Zi=oe.getChars()||f.WHITESPACE_CELL_CHAR;if(Zi===" "&&(oe.isUnderline()||oe.isOverline())&&(Zi="\xA0"),W=Ee*B-F.get(Zi,oe.isBold(),oe.isItalic()),A){if(N&&(fi&&U||!fi&&!U&&oe.bg===K)&&(fi&&U&&E.selectionForeground||oe.fg===q)&&oe.extended.ext===he&&Ws===k&&W===H&&!Ns&&!Me&&!Us){j+=Zi,N++;continue}N&&(A.textContent=j),A=this._document.createElement("span"),N=0,j=""}else A=this._document.createElement("span");if(K=oe.bg,q=oe.fg,he=oe.extended.ext,k=Ws,H=W,U=fi,Me&&O>=de&&O<=Kt&&(O=de),!this._coreService.isCursorHidden&&Ns){if(J.push("xterm-cursor"),this._coreBrowserService.isFocused)D&&J.push("xterm-cursor-blink"),J.push(S==="bar"?"xterm-cursor-bar":S==="underline"?"xterm-cursor-underline":"xterm-cursor-block");else if(L)switch(L){case"outline":J.push("xterm-cursor-outline");break;case"block":J.push("xterm-cursor-block");break;case"bar":J.push("xterm-cursor-bar");break;case"underline":J.push("xterm-cursor-underline")}}if(oe.isBold()&&J.push("xterm-bold"),oe.isItalic()&&J.push("xterm-italic"),oe.isDim()&&J.push("xterm-dim"),j=oe.isInvisible()?f.WHITESPACE_CELL_CHAR:oe.getChars()||f.WHITESPACE_CELL_CHAR,oe.isUnderline()&&(J.push(`xterm-underline-${oe.extended.underlineStyle}`),j===" "&&(j="\xA0"),!oe.isUnderlineColorDefault()))if(oe.isUnderlineColorRGB())A.style.textDecorationColor=`rgb(${h.AttributeData.toColorRGB(oe.getUnderlineColor()).join(",")})`;else{let me=oe.getUnderlineColor();this._optionsService.rawOptions.drawBoldTextInBrightColors&&oe.isBold()&&me<8&&(me+=8),A.style.textDecorationColor=E.ansi[me].css}oe.isOverline()&&(J.push("xterm-overline"),j===" "&&(j="\xA0")),oe.isStrikethrough()&&J.push("xterm-strikethrough"),Ws&&(A.style.textDecoration="underline");let Fe=oe.getFgColor(),_i=oe.getFgColorMode(),Ze=oe.getBgColor(),mi=oe.getBgColorMode(),js=!!oe.isInverse();if(js){let me=Fe;Fe=Ze,Ze=me;let al=_i;_i=mi,mi=al}let pt,Vs,ft,gi=!1;switch(this._decorationService.forEachDecorationAtCell(de,x,void 0,(me=>{me.options.layer!=="top"&&gi||(me.backgroundColorRGB&&(mi=50331648,Ze=me.backgroundColorRGB.rgba>>8&16777215,pt=me.backgroundColorRGB),me.foregroundColorRGB&&(_i=50331648,Fe=me.foregroundColorRGB.rgba>>8&16777215,Vs=me.foregroundColorRGB),gi=me.options.layer==="top")})),!gi&&fi&&(pt=this._coreBrowserService.isFocused?E.selectionBackgroundOpaque:E.selectionInactiveBackgroundOpaque,Ze=pt.rgba>>8&16777215,mi=50331648,gi=!0,E.selectionForeground&&(_i=50331648,Fe=E.selectionForeground.rgba>>8&16777215,Vs=E.selectionForeground)),gi&&J.push("xterm-decoration-top"),mi){case 16777216:case 33554432:ft=E.ansi[Ze],J.push(`xterm-bg-${Ze}`);break;case 50331648:ft=b.rgba.toColor(Ze>>16,Ze>>8&255,255&Ze),this._addStyle(A,`background-color:#${g((Ze>>>0).toString(16),"0",6)}`);break;default:js?(ft=E.foreground,J.push(`xterm-bg-${d.INVERTED_DEFAULT_COLOR}`)):ft=E.background}switch(pt||oe.isDim()&&(pt=b.color.multiplyOpacity(ft,.5)),_i){case 16777216:case 33554432:oe.isBold()&&Fe<8&&this._optionsService.rawOptions.drawBoldTextInBrightColors&&(Fe+=8),this._applyMinimumContrast(A,ft,E.ansi[Fe],oe,pt,void 0)||J.push(`xterm-fg-${Fe}`);break;case 50331648:let me=b.rgba.toColor(Fe>>16&255,Fe>>8&255,255&Fe);this._applyMinimumContrast(A,ft,me,oe,pt,Vs)||this._addStyle(A,`color:#${g(Fe.toString(16),"0",6)}`);break;default:this._applyMinimumContrast(A,ft,E.foreground,oe,pt,void 0)||js&&J.push(`xterm-fg-${d.INVERTED_DEFAULT_COLOR}`)}J.length&&(A.className=J.join(" "),J.length=0),Ns||Me||Us?A.textContent=j:N++,W!==this.defaultSpacing&&(A.style.letterSpacing=`${W}px`),I.push(A),de=Kt}return A&&N&&(A.textContent=j),I}_applyMinimumContrast(y,x,m,S,L,O){if(this._optionsService.rawOptions.minimumContrastRatio===1||(0,a.excludeFromContrastRatioDemands)(S.getCode()))return!1;let D=this._getContrastCache(S),B;if(L||O||(B=D.getColor(x.rgba,m.rgba)),B===void 0){let F=this._optionsService.rawOptions.minimumContrastRatio/(S.isDim()?2:1);B=b.color.ensureContrastRatio(L||x,O||m,F),D.setColor((L||x).rgba,(O||m).rgba,B??null)}return!!B&&(this._addStyle(y,`color:${B.css}`),!0)}_getContrastCache(y){return y.isDim()?this._themeService.colors.halfContrastCache:this._themeService.colors.contrastCache}_addStyle(y,x){y.setAttribute("style",`${y.getAttribute("style")||""}${x};`)}_isCellInSelection(y,x){let m=this._selectionStart,S=this._selectionEnd;return!(!m||!S)&&(this._columnSelectMode?m[0]<=S[0]?y>=m[0]&&x>=m[1]&&y<S[0]&&x<=S[1]:y<m[0]&&x>=m[1]&&y>=S[0]&&x<=S[1]:x>m[1]&&x<S[1]||m[1]===S[1]&&x===m[1]&&y>=m[0]&&y<S[0]||m[1]<S[1]&&x===S[1]&&y<S[0]||m[1]<S[1]&&x===m[1]&&y>=m[0])}};function g(y,x,m){for(;y.length<m;)y=x+y;return y}i.DomRendererRowFactory=_=c([p(1,o.ICharacterJoinerService),p(2,w.IOptionsService),p(3,o.ICoreBrowserService),p(4,w.ICoreService),p(5,w.IDecorationService),p(6,o.IThemeService)],_)},2550:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.WidthCache=void 0,i.WidthCache=class{constructor(r){this._flat=new Float32Array(256),this._font="",this._fontSize=0,this._weight="normal",this._weightBold="bold",this._measureElements=[],this._container=r.createElement("div"),this._container.style.position="absolute",this._container.style.top="-50000px",this._container.style.width="50000px",this._container.style.whiteSpace="pre",this._container.style.fontKerning="none";let c=r.createElement("span"),p=r.createElement("span");p.style.fontWeight="bold";let d=r.createElement("span");d.style.fontStyle="italic";let f=r.createElement("span");f.style.fontWeight="bold",f.style.fontStyle="italic",this._measureElements=[c,p,d,f],this._container.appendChild(c),this._container.appendChild(p),this._container.appendChild(d),this._container.appendChild(f),r.body.appendChild(this._container),this.clear()}dispose(){this._container.remove(),this._measureElements.length=0,this._holey=void 0}clear(){this._flat.fill(-9999),this._holey=new Map}setFont(r,c,p,d){r===this._font&&c===this._fontSize&&p===this._weight&&d===this._weightBold||(this._font=r,this._fontSize=c,this._weight=p,this._weightBold=d,this._container.style.fontFamily=this._font,this._container.style.fontSize=`${this._fontSize}px`,this._measureElements[0].style.fontWeight=`${p}`,this._measureElements[1].style.fontWeight=`${d}`,this._measureElements[2].style.fontWeight=`${p}`,this._measureElements[3].style.fontWeight=`${d}`,this.clear())}get(r,c,p){let d=0;if(!c&&!p&&r.length===1&&(d=r.charCodeAt(0))<256)return this._flat[d]!==-9999?this._flat[d]:this._flat[d]=this._measure(r,0);let f=r;c&&(f+="B"),p&&(f+="I");let v=this._holey.get(f);if(v===void 0){let w=0;c&&(w|=1),p&&(w|=2),v=this._measure(r,w),this._holey.set(f,v)}return v}_measure(r,c){let p=this._measureElements[c];return p.textContent=r.repeat(32),p.offsetWidth/32}}},2223:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.TEXT_BASELINE=i.DIM_OPACITY=i.INVERTED_DEFAULT_COLOR=void 0;let c=r(6114);i.INVERTED_DEFAULT_COLOR=257,i.DIM_OPACITY=.5,i.TEXT_BASELINE=c.isFirefox||c.isLegacyEdge?"bottom":"ideographic"},6171:(u,i)=>{function r(c){return 57508<=c&&c<=57558}Object.defineProperty(i,"__esModule",{value:!0}),i.createRenderDimensions=i.excludeFromContrastRatioDemands=i.isRestrictedPowerlineGlyph=i.isPowerlineGlyph=i.throwIfFalsy=void 0,i.throwIfFalsy=function(c){if(!c)throw new Error("value must not be falsy");return c},i.isPowerlineGlyph=r,i.isRestrictedPowerlineGlyph=function(c){return 57520<=c&&c<=57527},i.excludeFromContrastRatioDemands=function(c){return r(c)||(function(p){return 9472<=p&&p<=9631})(c)},i.createRenderDimensions=function(){return{css:{canvas:{width:0,height:0},cell:{width:0,height:0}},device:{canvas:{width:0,height:0},cell:{width:0,height:0},char:{width:0,height:0,left:0,top:0}}}}},456:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.SelectionModel=void 0,i.SelectionModel=class{constructor(r){this._bufferService=r,this.isSelectAllActive=!1,this.selectionStartLength=0}clearSelection(){this.selectionStart=void 0,this.selectionEnd=void 0,this.isSelectAllActive=!1,this.selectionStartLength=0}get finalSelectionStart(){return this.isSelectAllActive?[0,0]:this.selectionEnd&&this.selectionStart&&this.areSelectionValuesReversed()?this.selectionEnd:this.selectionStart}get finalSelectionEnd(){if(this.isSelectAllActive)return[this._bufferService.cols,this._bufferService.buffer.ybase+this._bufferService.rows-1];if(this.selectionStart){if(!this.selectionEnd||this.areSelectionValuesReversed()){let r=this.selectionStart[0]+this.selectionStartLength;return r>this._bufferService.cols?r%this._bufferService.cols==0?[this._bufferService.cols,this.selectionStart[1]+Math.floor(r/this._bufferService.cols)-1]:[r%this._bufferService.cols,this.selectionStart[1]+Math.floor(r/this._bufferService.cols)]:[r,this.selectionStart[1]]}if(this.selectionStartLength&&this.selectionEnd[1]===this.selectionStart[1]){let r=this.selectionStart[0]+this.selectionStartLength;return r>this._bufferService.cols?[r%this._bufferService.cols,this.selectionStart[1]+Math.floor(r/this._bufferService.cols)]:[Math.max(r,this.selectionEnd[0]),this.selectionEnd[1]]}return this.selectionEnd}}areSelectionValuesReversed(){let r=this.selectionStart,c=this.selectionEnd;return!(!r||!c)&&(r[1]>c[1]||r[1]===c[1]&&r[0]>c[0])}handleTrim(r){return this.selectionStart&&(this.selectionStart[1]-=r),this.selectionEnd&&(this.selectionEnd[1]-=r),this.selectionEnd&&this.selectionEnd[1]<0?(this.clearSelection(),!0):(this.selectionStart&&this.selectionStart[1]<0&&(this.selectionStart[1]=0),!1)}}},428:function(u,i,r){var c=this&&this.__decorate||function(o,l,a,h){var _,g=arguments.length,y=g<3?l:h===null?h=Object.getOwnPropertyDescriptor(l,a):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(o,l,a,h);else for(var x=o.length-1;x>=0;x--)(_=o[x])&&(y=(g<3?_(y):g>3?_(l,a,y):_(l,a))||y);return g>3&&y&&Object.defineProperty(l,a,y),y},p=this&&this.__param||function(o,l){return function(a,h){l(a,h,o)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CharSizeService=void 0;let d=r(2585),f=r(8460),v=r(844),w=i.CharSizeService=class extends v.Disposable{get hasValidSize(){return this.width>0&&this.height>0}constructor(o,l,a){super(),this._optionsService=a,this.width=0,this.height=0,this._onCharSizeChange=this.register(new f.EventEmitter),this.onCharSizeChange=this._onCharSizeChange.event,this._measureStrategy=new b(o,l,this._optionsService),this.register(this._optionsService.onMultipleOptionChange(["fontFamily","fontSize"],(()=>this.measure())))}measure(){let o=this._measureStrategy.measure();o.width===this.width&&o.height===this.height||(this.width=o.width,this.height=o.height,this._onCharSizeChange.fire())}};i.CharSizeService=w=c([p(2,d.IOptionsService)],w);class b{constructor(l,a,h){this._document=l,this._parentElement=a,this._optionsService=h,this._result={width:0,height:0},this._measureElement=this._document.createElement("span"),this._measureElement.classList.add("xterm-char-measure-element"),this._measureElement.textContent="W".repeat(32),this._measureElement.setAttribute("aria-hidden","true"),this._measureElement.style.whiteSpace="pre",this._measureElement.style.fontKerning="none",this._parentElement.appendChild(this._measureElement)}measure(){this._measureElement.style.fontFamily=this._optionsService.rawOptions.fontFamily,this._measureElement.style.fontSize=`${this._optionsService.rawOptions.fontSize}px`;let l={height:Number(this._measureElement.offsetHeight),width:Number(this._measureElement.offsetWidth)};return l.width!==0&&l.height!==0&&(this._result.width=l.width/32,this._result.height=Math.ceil(l.height)),this._result}}},4269:function(u,i,r){var c=this&&this.__decorate||function(l,a,h,_){var g,y=arguments.length,x=y<3?a:_===null?_=Object.getOwnPropertyDescriptor(a,h):_;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")x=Reflect.decorate(l,a,h,_);else for(var m=l.length-1;m>=0;m--)(g=l[m])&&(x=(y<3?g(x):y>3?g(a,h,x):g(a,h))||x);return y>3&&x&&Object.defineProperty(a,h,x),x},p=this&&this.__param||function(l,a){return function(h,_){a(h,_,l)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CharacterJoinerService=i.JoinedCellData=void 0;let d=r(3734),f=r(643),v=r(511),w=r(2585);class b extends d.AttributeData{constructor(a,h,_){super(),this.content=0,this.combinedData="",this.fg=a.fg,this.bg=a.bg,this.combinedData=h,this._width=_}isCombined(){return 2097152}getWidth(){return this._width}getChars(){return this.combinedData}getCode(){return 2097151}setFromCharData(a){throw new Error("not implemented")}getAsCharData(){return[this.fg,this.getChars(),this.getWidth(),this.getCode()]}}i.JoinedCellData=b;let o=i.CharacterJoinerService=class Ho{constructor(a){this._bufferService=a,this._characterJoiners=[],this._nextCharacterJoinerId=0,this._workCell=new v.CellData}register(a){let h={id:this._nextCharacterJoinerId++,handler:a};return this._characterJoiners.push(h),h.id}deregister(a){for(let h=0;h<this._characterJoiners.length;h++)if(this._characterJoiners[h].id===a)return this._characterJoiners.splice(h,1),!0;return!1}getJoinedCharacters(a){if(this._characterJoiners.length===0)return[];let h=this._bufferService.buffer.lines.get(a);if(!h||h.length===0)return[];let _=[],g=h.translateToString(!0),y=0,x=0,m=0,S=h.getFg(0),L=h.getBg(0);for(let O=0;O<h.getTrimmedLength();O++)if(h.loadCell(O,this._workCell),this._workCell.getWidth()!==0){if(this._workCell.fg!==S||this._workCell.bg!==L){if(O-y>1){let D=this._getJoinedRanges(g,m,x,h,y);for(let B=0;B<D.length;B++)_.push(D[B])}y=O,m=x,S=this._workCell.fg,L=this._workCell.bg}x+=this._workCell.getChars().length||f.WHITESPACE_CELL_CHAR.length}if(this._bufferService.cols-y>1){let O=this._getJoinedRanges(g,m,x,h,y);for(let D=0;D<O.length;D++)_.push(O[D])}return _}_getJoinedRanges(a,h,_,g,y){let x=a.substring(h,_),m=[];try{m=this._characterJoiners[0].handler(x)}catch(S){console.error(S)}for(let S=1;S<this._characterJoiners.length;S++)try{let L=this._characterJoiners[S].handler(x);for(let O=0;O<L.length;O++)Ho._mergeRanges(m,L[O])}catch(L){console.error(L)}return this._stringRangesToCellRanges(m,g,y),m}_stringRangesToCellRanges(a,h,_){let g=0,y=!1,x=0,m=a[g];if(m){for(let S=_;S<this._bufferService.cols;S++){let L=h.getWidth(S),O=h.getString(S).length||f.WHITESPACE_CELL_CHAR.length;if(L!==0){if(!y&&m[0]<=x&&(m[0]=S,y=!0),m[1]<=x){if(m[1]=S,m=a[++g],!m)break;m[0]<=x?(m[0]=S,y=!0):y=!1}x+=O}}m&&(m[1]=this._bufferService.cols)}}static _mergeRanges(a,h){let _=!1;for(let g=0;g<a.length;g++){let y=a[g];if(_){if(h[1]<=y[0])return a[g-1][1]=h[1],a;if(h[1]<=y[1])return a[g-1][1]=Math.max(h[1],y[1]),a.splice(g,1),a;a.splice(g,1),g--}else{if(h[1]<=y[0])return a.splice(g,0,h),a;if(h[1]<=y[1])return y[0]=Math.min(h[0],y[0]),a;h[0]<y[1]&&(y[0]=Math.min(h[0],y[0]),_=!0)}}return _?a[a.length-1][1]=h[1]:a.push(h),a}};i.CharacterJoinerService=o=c([p(0,w.IBufferService)],o)},5114:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CoreBrowserService=void 0,i.CoreBrowserService=class{constructor(r,c){this._textarea=r,this.window=c,this._isFocused=!1,this._cachedIsFocused=void 0,this._textarea.addEventListener("focus",(()=>this._isFocused=!0)),this._textarea.addEventListener("blur",(()=>this._isFocused=!1))}get dpr(){return this.window.devicePixelRatio}get isFocused(){return this._cachedIsFocused===void 0&&(this._cachedIsFocused=this._isFocused&&this._textarea.ownerDocument.hasFocus(),queueMicrotask((()=>this._cachedIsFocused=void 0))),this._cachedIsFocused}}},8934:function(u,i,r){var c=this&&this.__decorate||function(w,b,o,l){var a,h=arguments.length,_=h<3?b:l===null?l=Object.getOwnPropertyDescriptor(b,o):l;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")_=Reflect.decorate(w,b,o,l);else for(var g=w.length-1;g>=0;g--)(a=w[g])&&(_=(h<3?a(_):h>3?a(b,o,_):a(b,o))||_);return h>3&&_&&Object.defineProperty(b,o,_),_},p=this&&this.__param||function(w,b){return function(o,l){b(o,l,w)}};Object.defineProperty(i,"__esModule",{value:!0}),i.MouseService=void 0;let d=r(4725),f=r(9806),v=i.MouseService=class{constructor(w,b){this._renderService=w,this._charSizeService=b}getCoords(w,b,o,l,a){return(0,f.getCoords)(window,w,b,o,l,this._charSizeService.hasValidSize,this._renderService.dimensions.css.cell.width,this._renderService.dimensions.css.cell.height,a)}getMouseReportCoords(w,b){let o=(0,f.getCoordsRelativeToElement)(window,w,b);if(this._charSizeService.hasValidSize)return o[0]=Math.min(Math.max(o[0],0),this._renderService.dimensions.css.canvas.width-1),o[1]=Math.min(Math.max(o[1],0),this._renderService.dimensions.css.canvas.height-1),{col:Math.floor(o[0]/this._renderService.dimensions.css.cell.width),row:Math.floor(o[1]/this._renderService.dimensions.css.cell.height),x:Math.floor(o[0]),y:Math.floor(o[1])}}};i.MouseService=v=c([p(0,d.IRenderService),p(1,d.ICharSizeService)],v)},3230:function(u,i,r){var c=this&&this.__decorate||function(_,g,y,x){var m,S=arguments.length,L=S<3?g:x===null?x=Object.getOwnPropertyDescriptor(g,y):x;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")L=Reflect.decorate(_,g,y,x);else for(var O=_.length-1;O>=0;O--)(m=_[O])&&(L=(S<3?m(L):S>3?m(g,y,L):m(g,y))||L);return S>3&&L&&Object.defineProperty(g,y,L),L},p=this&&this.__param||function(_,g){return function(y,x){g(y,x,_)}};Object.defineProperty(i,"__esModule",{value:!0}),i.RenderService=void 0;let d=r(3656),f=r(6193),v=r(5596),w=r(4725),b=r(8460),o=r(844),l=r(7226),a=r(2585),h=i.RenderService=class extends o.Disposable{get dimensions(){return this._renderer.value.dimensions}constructor(_,g,y,x,m,S,L,O){if(super(),this._rowCount=_,this._charSizeService=x,this._renderer=this.register(new o.MutableDisposable),this._pausedResizeTask=new l.DebouncedIdleTask,this._isPaused=!1,this._needsFullRefresh=!1,this._isNextRenderRedrawOnly=!0,this._needsSelectionRefresh=!1,this._canvasWidth=0,this._canvasHeight=0,this._selectionState={start:void 0,end:void 0,columnSelectMode:!1},this._onDimensionsChange=this.register(new b.EventEmitter),this.onDimensionsChange=this._onDimensionsChange.event,this._onRenderedViewportChange=this.register(new b.EventEmitter),this.onRenderedViewportChange=this._onRenderedViewportChange.event,this._onRender=this.register(new b.EventEmitter),this.onRender=this._onRender.event,this._onRefreshRequest=this.register(new b.EventEmitter),this.onRefreshRequest=this._onRefreshRequest.event,this._renderDebouncer=new f.RenderDebouncer(L.window,((D,B)=>this._renderRows(D,B))),this.register(this._renderDebouncer),this._screenDprMonitor=new v.ScreenDprMonitor(L.window),this._screenDprMonitor.setListener((()=>this.handleDevicePixelRatioChange())),this.register(this._screenDprMonitor),this.register(S.onResize((()=>this._fullRefresh()))),this.register(S.buffers.onBufferActivate((()=>{var D;return(D=this._renderer.value)===null||D===void 0?void 0:D.clear()}))),this.register(y.onOptionChange((()=>this._handleOptionsChanged()))),this.register(this._charSizeService.onCharSizeChange((()=>this.handleCharSizeChanged()))),this.register(m.onDecorationRegistered((()=>this._fullRefresh()))),this.register(m.onDecorationRemoved((()=>this._fullRefresh()))),this.register(y.onMultipleOptionChange(["customGlyphs","drawBoldTextInBrightColors","letterSpacing","lineHeight","fontFamily","fontSize","fontWeight","fontWeightBold","minimumContrastRatio"],(()=>{this.clear(),this.handleResize(S.cols,S.rows),this._fullRefresh()}))),this.register(y.onMultipleOptionChange(["cursorBlink","cursorStyle"],(()=>this.refreshRows(S.buffer.y,S.buffer.y,!0)))),this.register((0,d.addDisposableDomListener)(L.window,"resize",(()=>this.handleDevicePixelRatioChange()))),this.register(O.onChangeColors((()=>this._fullRefresh()))),"IntersectionObserver"in L.window){let D=new L.window.IntersectionObserver((B=>this._handleIntersectionChange(B[B.length-1])),{threshold:0});D.observe(g),this.register({dispose:()=>D.disconnect()})}}_handleIntersectionChange(_){this._isPaused=_.isIntersecting===void 0?_.intersectionRatio===0:!_.isIntersecting,this._isPaused||this._charSizeService.hasValidSize||this._charSizeService.measure(),!this._isPaused&&this._needsFullRefresh&&(this._pausedResizeTask.flush(),this.refreshRows(0,this._rowCount-1),this._needsFullRefresh=!1)}refreshRows(_,g,y=!1){this._isPaused?this._needsFullRefresh=!0:(y||(this._isNextRenderRedrawOnly=!1),this._renderDebouncer.refresh(_,g,this._rowCount))}_renderRows(_,g){this._renderer.value&&(_=Math.min(_,this._rowCount-1),g=Math.min(g,this._rowCount-1),this._renderer.value.renderRows(_,g),this._needsSelectionRefresh&&(this._renderer.value.handleSelectionChanged(this._selectionState.start,this._selectionState.end,this._selectionState.columnSelectMode),this._needsSelectionRefresh=!1),this._isNextRenderRedrawOnly||this._onRenderedViewportChange.fire({start:_,end:g}),this._onRender.fire({start:_,end:g}),this._isNextRenderRedrawOnly=!0)}resize(_,g){this._rowCount=g,this._fireOnCanvasResize()}_handleOptionsChanged(){this._renderer.value&&(this.refreshRows(0,this._rowCount-1),this._fireOnCanvasResize())}_fireOnCanvasResize(){this._renderer.value&&(this._renderer.value.dimensions.css.canvas.width===this._canvasWidth&&this._renderer.value.dimensions.css.canvas.height===this._canvasHeight||this._onDimensionsChange.fire(this._renderer.value.dimensions))}hasRenderer(){return!!this._renderer.value}setRenderer(_){this._renderer.value=_,this._renderer.value.onRequestRedraw((g=>this.refreshRows(g.start,g.end,!0))),this._needsSelectionRefresh=!0,this._fullRefresh()}addRefreshCallback(_){return this._renderDebouncer.addRefreshCallback(_)}_fullRefresh(){this._isPaused?this._needsFullRefresh=!0:this.refreshRows(0,this._rowCount-1)}clearTextureAtlas(){var _,g;this._renderer.value&&((g=(_=this._renderer.value).clearTextureAtlas)===null||g===void 0||g.call(_),this._fullRefresh())}handleDevicePixelRatioChange(){this._charSizeService.measure(),this._renderer.value&&(this._renderer.value.handleDevicePixelRatioChange(),this.refreshRows(0,this._rowCount-1))}handleResize(_,g){this._renderer.value&&(this._isPaused?this._pausedResizeTask.set((()=>this._renderer.value.handleResize(_,g))):this._renderer.value.handleResize(_,g),this._fullRefresh())}handleCharSizeChanged(){var _;(_=this._renderer.value)===null||_===void 0||_.handleCharSizeChanged()}handleBlur(){var _;(_=this._renderer.value)===null||_===void 0||_.handleBlur()}handleFocus(){var _;(_=this._renderer.value)===null||_===void 0||_.handleFocus()}handleSelectionChanged(_,g,y){var x;this._selectionState.start=_,this._selectionState.end=g,this._selectionState.columnSelectMode=y,(x=this._renderer.value)===null||x===void 0||x.handleSelectionChanged(_,g,y)}handleCursorMove(){var _;(_=this._renderer.value)===null||_===void 0||_.handleCursorMove()}clear(){var _;(_=this._renderer.value)===null||_===void 0||_.clear()}};i.RenderService=h=c([p(2,a.IOptionsService),p(3,w.ICharSizeService),p(4,a.IDecorationService),p(5,a.IBufferService),p(6,w.ICoreBrowserService),p(7,w.IThemeService)],h)},9312:function(u,i,r){var c=this&&this.__decorate||function(m,S,L,O){var D,B=arguments.length,F=B<3?S:O===null?O=Object.getOwnPropertyDescriptor(S,L):O;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")F=Reflect.decorate(m,S,L,O);else for(var P=m.length-1;P>=0;P--)(D=m[P])&&(F=(B<3?D(F):B>3?D(S,L,F):D(S,L))||F);return B>3&&F&&Object.defineProperty(S,L,F),F},p=this&&this.__param||function(m,S){return function(L,O){S(L,O,m)}};Object.defineProperty(i,"__esModule",{value:!0}),i.SelectionService=void 0;let d=r(9806),f=r(9504),v=r(456),w=r(4725),b=r(8460),o=r(844),l=r(6114),a=r(4841),h=r(511),_=r(2585),g="\xA0",y=new RegExp(g,"g"),x=i.SelectionService=class extends o.Disposable{constructor(m,S,L,O,D,B,F,P,M){super(),this._element=m,this._screenElement=S,this._linkifier=L,this._bufferService=O,this._coreService=D,this._mouseService=B,this._optionsService=F,this._renderService=P,this._coreBrowserService=M,this._dragScrollAmount=0,this._enabled=!0,this._workCell=new h.CellData,this._mouseDownTimeStamp=0,this._oldHasSelection=!1,this._oldSelectionStart=void 0,this._oldSelectionEnd=void 0,this._onLinuxMouseSelection=this.register(new b.EventEmitter),this.onLinuxMouseSelection=this._onLinuxMouseSelection.event,this._onRedrawRequest=this.register(new b.EventEmitter),this.onRequestRedraw=this._onRedrawRequest.event,this._onSelectionChange=this.register(new b.EventEmitter),this.onSelectionChange=this._onSelectionChange.event,this._onRequestScrollLines=this.register(new b.EventEmitter),this.onRequestScrollLines=this._onRequestScrollLines.event,this._mouseMoveListener=I=>this._handleMouseMove(I),this._mouseUpListener=I=>this._handleMouseUp(I),this._coreService.onUserInput((()=>{this.hasSelection&&this.clearSelection()})),this._trimListener=this._bufferService.buffer.lines.onTrim((I=>this._handleTrim(I))),this.register(this._bufferService.buffers.onBufferActivate((I=>this._handleBufferActivate(I)))),this.enable(),this._model=new v.SelectionModel(this._bufferService),this._activeSelectionMode=0,this.register((0,o.toDisposable)((()=>{this._removeMouseDownListeners()})))}reset(){this.clearSelection()}disable(){this.clearSelection(),this._enabled=!1}enable(){this._enabled=!0}get selectionStart(){return this._model.finalSelectionStart}get selectionEnd(){return this._model.finalSelectionEnd}get hasSelection(){let m=this._model.finalSelectionStart,S=this._model.finalSelectionEnd;return!(!m||!S||m[0]===S[0]&&m[1]===S[1])}get selectionText(){let m=this._model.finalSelectionStart,S=this._model.finalSelectionEnd;if(!m||!S)return"";let L=this._bufferService.buffer,O=[];if(this._activeSelectionMode===3){if(m[0]===S[0])return"";let D=m[0]<S[0]?m[0]:S[0],B=m[0]<S[0]?S[0]:m[0];for(let F=m[1];F<=S[1];F++){let P=L.translateBufferLineToString(F,!0,D,B);O.push(P)}}else{let D=m[1]===S[1]?S[0]:void 0;O.push(L.translateBufferLineToString(m[1],!0,m[0],D));for(let B=m[1]+1;B<=S[1]-1;B++){let F=L.lines.get(B),P=L.translateBufferLineToString(B,!0);F?.isWrapped?O[O.length-1]+=P:O.push(P)}if(m[1]!==S[1]){let B=L.lines.get(S[1]),F=L.translateBufferLineToString(S[1],!0,0,S[0]);B&&B.isWrapped?O[O.length-1]+=F:O.push(F)}}return O.map((D=>D.replace(y," "))).join(l.isWindows?`\r
`:`
`)}clearSelection(){this._model.clearSelection(),this._removeMouseDownListeners(),this.refresh(),this._onSelectionChange.fire()}refresh(m){this._refreshAnimationFrame||(this._refreshAnimationFrame=this._coreBrowserService.window.requestAnimationFrame((()=>this._refresh()))),l.isLinux&&m&&this.selectionText.length&&this._onLinuxMouseSelection.fire(this.selectionText)}_refresh(){this._refreshAnimationFrame=void 0,this._onRedrawRequest.fire({start:this._model.finalSelectionStart,end:this._model.finalSelectionEnd,columnSelectMode:this._activeSelectionMode===3})}_isClickInSelection(m){let S=this._getMouseBufferCoords(m),L=this._model.finalSelectionStart,O=this._model.finalSelectionEnd;return!!(L&&O&&S)&&this._areCoordsInSelection(S,L,O)}isCellInSelection(m,S){let L=this._model.finalSelectionStart,O=this._model.finalSelectionEnd;return!(!L||!O)&&this._areCoordsInSelection([m,S],L,O)}_areCoordsInSelection(m,S,L){return m[1]>S[1]&&m[1]<L[1]||S[1]===L[1]&&m[1]===S[1]&&m[0]>=S[0]&&m[0]<L[0]||S[1]<L[1]&&m[1]===L[1]&&m[0]<L[0]||S[1]<L[1]&&m[1]===S[1]&&m[0]>=S[0]}_selectWordAtCursor(m,S){var L,O;let D=(O=(L=this._linkifier.currentLink)===null||L===void 0?void 0:L.link)===null||O===void 0?void 0:O.range;if(D)return this._model.selectionStart=[D.start.x-1,D.start.y-1],this._model.selectionStartLength=(0,a.getRangeLength)(D,this._bufferService.cols),this._model.selectionEnd=void 0,!0;let B=this._getMouseBufferCoords(m);return!!B&&(this._selectWordAt(B,S),this._model.selectionEnd=void 0,!0)}selectAll(){this._model.isSelectAllActive=!0,this.refresh(),this._onSelectionChange.fire()}selectLines(m,S){this._model.clearSelection(),m=Math.max(m,0),S=Math.min(S,this._bufferService.buffer.lines.length-1),this._model.selectionStart=[0,m],this._model.selectionEnd=[this._bufferService.cols,S],this.refresh(),this._onSelectionChange.fire()}_handleTrim(m){this._model.handleTrim(m)&&this.refresh()}_getMouseBufferCoords(m){let S=this._mouseService.getCoords(m,this._screenElement,this._bufferService.cols,this._bufferService.rows,!0);if(S)return S[0]--,S[1]--,S[1]+=this._bufferService.buffer.ydisp,S}_getMouseEventScrollAmount(m){let S=(0,d.getCoordsRelativeToElement)(this._coreBrowserService.window,m,this._screenElement)[1],L=this._renderService.dimensions.css.canvas.height;return S>=0&&S<=L?0:(S>L&&(S-=L),S=Math.min(Math.max(S,-50),50),S/=50,S/Math.abs(S)+Math.round(14*S))}shouldForceSelection(m){return l.isMac?m.altKey&&this._optionsService.rawOptions.macOptionClickForcesSelection:m.shiftKey}handleMouseDown(m){if(this._mouseDownTimeStamp=m.timeStamp,(m.button!==2||!this.hasSelection)&&m.button===0){if(!this._enabled){if(!this.shouldForceSelection(m))return;m.stopPropagation()}m.preventDefault(),this._dragScrollAmount=0,this._enabled&&m.shiftKey?this._handleIncrementalClick(m):m.detail===1?this._handleSingleClick(m):m.detail===2?this._handleDoubleClick(m):m.detail===3&&this._handleTripleClick(m),this._addMouseDownListeners(),this.refresh(!0)}}_addMouseDownListeners(){this._screenElement.ownerDocument&&(this._screenElement.ownerDocument.addEventListener("mousemove",this._mouseMoveListener),this._screenElement.ownerDocument.addEventListener("mouseup",this._mouseUpListener)),this._dragScrollIntervalTimer=this._coreBrowserService.window.setInterval((()=>this._dragScroll()),50)}_removeMouseDownListeners(){this._screenElement.ownerDocument&&(this._screenElement.ownerDocument.removeEventListener("mousemove",this._mouseMoveListener),this._screenElement.ownerDocument.removeEventListener("mouseup",this._mouseUpListener)),this._coreBrowserService.window.clearInterval(this._dragScrollIntervalTimer),this._dragScrollIntervalTimer=void 0}_handleIncrementalClick(m){this._model.selectionStart&&(this._model.selectionEnd=this._getMouseBufferCoords(m))}_handleSingleClick(m){if(this._model.selectionStartLength=0,this._model.isSelectAllActive=!1,this._activeSelectionMode=this.shouldColumnSelect(m)?3:0,this._model.selectionStart=this._getMouseBufferCoords(m),!this._model.selectionStart)return;this._model.selectionEnd=void 0;let S=this._bufferService.buffer.lines.get(this._model.selectionStart[1]);S&&S.length!==this._model.selectionStart[0]&&S.hasWidth(this._model.selectionStart[0])===0&&this._model.selectionStart[0]++}_handleDoubleClick(m){this._selectWordAtCursor(m,!0)&&(this._activeSelectionMode=1)}_handleTripleClick(m){let S=this._getMouseBufferCoords(m);S&&(this._activeSelectionMode=2,this._selectLineAt(S[1]))}shouldColumnSelect(m){return m.altKey&&!(l.isMac&&this._optionsService.rawOptions.macOptionClickForcesSelection)}_handleMouseMove(m){if(m.stopImmediatePropagation(),!this._model.selectionStart)return;let S=this._model.selectionEnd?[this._model.selectionEnd[0],this._model.selectionEnd[1]]:null;if(this._model.selectionEnd=this._getMouseBufferCoords(m),!this._model.selectionEnd)return void this.refresh(!0);this._activeSelectionMode===2?this._model.selectionEnd[1]<this._model.selectionStart[1]?this._model.selectionEnd[0]=0:this._model.selectionEnd[0]=this._bufferService.cols:this._activeSelectionMode===1&&this._selectToWordAt(this._model.selectionEnd),this._dragScrollAmount=this._getMouseEventScrollAmount(m),this._activeSelectionMode!==3&&(this._dragScrollAmount>0?this._model.selectionEnd[0]=this._bufferService.cols:this._dragScrollAmount<0&&(this._model.selectionEnd[0]=0));let L=this._bufferService.buffer;if(this._model.selectionEnd[1]<L.lines.length){let O=L.lines.get(this._model.selectionEnd[1]);O&&O.hasWidth(this._model.selectionEnd[0])===0&&this._model.selectionEnd[0]++}S&&S[0]===this._model.selectionEnd[0]&&S[1]===this._model.selectionEnd[1]||this.refresh(!0)}_dragScroll(){if(this._model.selectionEnd&&this._model.selectionStart&&this._dragScrollAmount){this._onRequestScrollLines.fire({amount:this._dragScrollAmount,suppressScrollEvent:!1});let m=this._bufferService.buffer;this._dragScrollAmount>0?(this._activeSelectionMode!==3&&(this._model.selectionEnd[0]=this._bufferService.cols),this._model.selectionEnd[1]=Math.min(m.ydisp+this._bufferService.rows,m.lines.length-1)):(this._activeSelectionMode!==3&&(this._model.selectionEnd[0]=0),this._model.selectionEnd[1]=m.ydisp),this.refresh()}}_handleMouseUp(m){let S=m.timeStamp-this._mouseDownTimeStamp;if(this._removeMouseDownListeners(),this.selectionText.length<=1&&S<500&&m.altKey&&this._optionsService.rawOptions.altClickMovesCursor){if(this._bufferService.buffer.ybase===this._bufferService.buffer.ydisp){let L=this._mouseService.getCoords(m,this._element,this._bufferService.cols,this._bufferService.rows,!1);if(L&&L[0]!==void 0&&L[1]!==void 0){let O=(0,f.moveToCellSequence)(L[0]-1,L[1]-1,this._bufferService,this._coreService.decPrivateModes.applicationCursorKeys);this._coreService.triggerDataEvent(O,!0)}}}else this._fireEventIfSelectionChanged()}_fireEventIfSelectionChanged(){let m=this._model.finalSelectionStart,S=this._model.finalSelectionEnd,L=!(!m||!S||m[0]===S[0]&&m[1]===S[1]);L?m&&S&&(this._oldSelectionStart&&this._oldSelectionEnd&&m[0]===this._oldSelectionStart[0]&&m[1]===this._oldSelectionStart[1]&&S[0]===this._oldSelectionEnd[0]&&S[1]===this._oldSelectionEnd[1]||this._fireOnSelectionChange(m,S,L)):this._oldHasSelection&&this._fireOnSelectionChange(m,S,L)}_fireOnSelectionChange(m,S,L){this._oldSelectionStart=m,this._oldSelectionEnd=S,this._oldHasSelection=L,this._onSelectionChange.fire()}_handleBufferActivate(m){this.clearSelection(),this._trimListener.dispose(),this._trimListener=m.activeBuffer.lines.onTrim((S=>this._handleTrim(S)))}_convertViewportColToCharacterIndex(m,S){let L=S;for(let O=0;S>=O;O++){let D=m.loadCell(O,this._workCell).getChars().length;this._workCell.getWidth()===0?L--:D>1&&S!==O&&(L+=D-1)}return L}setSelection(m,S,L){this._model.clearSelection(),this._removeMouseDownListeners(),this._model.selectionStart=[m,S],this._model.selectionStartLength=L,this.refresh(),this._fireEventIfSelectionChanged()}rightClickSelect(m){this._isClickInSelection(m)||(this._selectWordAtCursor(m,!1)&&this.refresh(!0),this._fireEventIfSelectionChanged())}_getWordAt(m,S,L=!0,O=!0){if(m[0]>=this._bufferService.cols)return;let D=this._bufferService.buffer,B=D.lines.get(m[1]);if(!B)return;let F=D.translateBufferLineToString(m[1],!1),P=this._convertViewportColToCharacterIndex(B,m[0]),M=P,I=m[0]-P,C=0,E=0,A=0,R=0;if(F.charAt(P)===" "){for(;P>0&&F.charAt(P-1)===" ";)P--;for(;M<F.length&&F.charAt(M+1)===" ";)M++}else{let K=m[0],q=m[0];B.getWidth(K)===0&&(C++,K--),B.getWidth(q)===2&&(E++,q++);let he=B.getString(q).length;for(he>1&&(R+=he-1,M+=he-1);K>0&&P>0&&!this._isCharWordSeparator(B.loadCell(K-1,this._workCell));){B.loadCell(K-1,this._workCell);let k=this._workCell.getChars().length;this._workCell.getWidth()===0?(C++,K--):k>1&&(A+=k-1,P-=k-1),P--,K--}for(;q<B.length&&M+1<F.length&&!this._isCharWordSeparator(B.loadCell(q+1,this._workCell));){B.loadCell(q+1,this._workCell);let k=this._workCell.getChars().length;this._workCell.getWidth()===2?(E++,q++):k>1&&(R+=k-1,M+=k-1),M++,q++}}M++;let N=P+I-C+A,j=Math.min(this._bufferService.cols,M-P+C+E-A-R);if(S||F.slice(P,M).trim()!==""){if(L&&N===0&&B.getCodePoint(0)!==32){let K=D.lines.get(m[1]-1);if(K&&B.isWrapped&&K.getCodePoint(this._bufferService.cols-1)!==32){let q=this._getWordAt([this._bufferService.cols-1,m[1]-1],!1,!0,!1);if(q){let he=this._bufferService.cols-q.start;N-=he,j+=he}}}if(O&&N+j===this._bufferService.cols&&B.getCodePoint(this._bufferService.cols-1)!==32){let K=D.lines.get(m[1]+1);if(K?.isWrapped&&K.getCodePoint(0)!==32){let q=this._getWordAt([0,m[1]+1],!1,!1,!0);q&&(j+=q.length)}}return{start:N,length:j}}}_selectWordAt(m,S){let L=this._getWordAt(m,S);if(L){for(;L.start<0;)L.start+=this._bufferService.cols,m[1]--;this._model.selectionStart=[L.start,m[1]],this._model.selectionStartLength=L.length}}_selectToWordAt(m){let S=this._getWordAt(m,!0);if(S){let L=m[1];for(;S.start<0;)S.start+=this._bufferService.cols,L--;if(!this._model.areSelectionValuesReversed())for(;S.start+S.length>this._bufferService.cols;)S.length-=this._bufferService.cols,L++;this._model.selectionEnd=[this._model.areSelectionValuesReversed()?S.start:S.start+S.length,L]}}_isCharWordSeparator(m){return m.getWidth()!==0&&this._optionsService.rawOptions.wordSeparator.indexOf(m.getChars())>=0}_selectLineAt(m){let S=this._bufferService.buffer.getWrappedRangeForLine(m),L={start:{x:0,y:S.first},end:{x:this._bufferService.cols-1,y:S.last}};this._model.selectionStart=[0,S.first],this._model.selectionEnd=void 0,this._model.selectionStartLength=(0,a.getRangeLength)(L,this._bufferService.cols)}};i.SelectionService=x=c([p(3,_.IBufferService),p(4,_.ICoreService),p(5,w.IMouseService),p(6,_.IOptionsService),p(7,w.IRenderService),p(8,w.ICoreBrowserService)],x)},4725:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.IThemeService=i.ICharacterJoinerService=i.ISelectionService=i.IRenderService=i.IMouseService=i.ICoreBrowserService=i.ICharSizeService=void 0;let c=r(8343);i.ICharSizeService=(0,c.createDecorator)("CharSizeService"),i.ICoreBrowserService=(0,c.createDecorator)("CoreBrowserService"),i.IMouseService=(0,c.createDecorator)("MouseService"),i.IRenderService=(0,c.createDecorator)("RenderService"),i.ISelectionService=(0,c.createDecorator)("SelectionService"),i.ICharacterJoinerService=(0,c.createDecorator)("CharacterJoinerService"),i.IThemeService=(0,c.createDecorator)("ThemeService")},6731:function(u,i,r){var c=this&&this.__decorate||function(x,m,S,L){var O,D=arguments.length,B=D<3?m:L===null?L=Object.getOwnPropertyDescriptor(m,S):L;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")B=Reflect.decorate(x,m,S,L);else for(var F=x.length-1;F>=0;F--)(O=x[F])&&(B=(D<3?O(B):D>3?O(m,S,B):O(m,S))||B);return D>3&&B&&Object.defineProperty(m,S,B),B},p=this&&this.__param||function(x,m){return function(S,L){m(S,L,x)}};Object.defineProperty(i,"__esModule",{value:!0}),i.ThemeService=i.DEFAULT_ANSI_COLORS=void 0;let d=r(7239),f=r(8055),v=r(8460),w=r(844),b=r(2585),o=f.css.toColor("#ffffff"),l=f.css.toColor("#000000"),a=f.css.toColor("#ffffff"),h=f.css.toColor("#000000"),_={css:"rgba(255, 255, 255, 0.3)",rgba:4294967117};i.DEFAULT_ANSI_COLORS=Object.freeze((()=>{let x=[f.css.toColor("#2e3436"),f.css.toColor("#cc0000"),f.css.toColor("#4e9a06"),f.css.toColor("#c4a000"),f.css.toColor("#3465a4"),f.css.toColor("#75507b"),f.css.toColor("#06989a"),f.css.toColor("#d3d7cf"),f.css.toColor("#555753"),f.css.toColor("#ef2929"),f.css.toColor("#8ae234"),f.css.toColor("#fce94f"),f.css.toColor("#729fcf"),f.css.toColor("#ad7fa8"),f.css.toColor("#34e2e2"),f.css.toColor("#eeeeec")],m=[0,95,135,175,215,255];for(let S=0;S<216;S++){let L=m[S/36%6|0],O=m[S/6%6|0],D=m[S%6];x.push({css:f.channels.toCss(L,O,D),rgba:f.channels.toRgba(L,O,D)})}for(let S=0;S<24;S++){let L=8+10*S;x.push({css:f.channels.toCss(L,L,L),rgba:f.channels.toRgba(L,L,L)})}return x})());let g=i.ThemeService=class extends w.Disposable{get colors(){return this._colors}constructor(x){super(),this._optionsService=x,this._contrastCache=new d.ColorContrastCache,this._halfContrastCache=new d.ColorContrastCache,this._onChangeColors=this.register(new v.EventEmitter),this.onChangeColors=this._onChangeColors.event,this._colors={foreground:o,background:l,cursor:a,cursorAccent:h,selectionForeground:void 0,selectionBackgroundTransparent:_,selectionBackgroundOpaque:f.color.blend(l,_),selectionInactiveBackgroundTransparent:_,selectionInactiveBackgroundOpaque:f.color.blend(l,_),ansi:i.DEFAULT_ANSI_COLORS.slice(),contrastCache:this._contrastCache,halfContrastCache:this._halfContrastCache},this._updateRestoreColors(),this._setTheme(this._optionsService.rawOptions.theme),this.register(this._optionsService.onSpecificOptionChange("minimumContrastRatio",(()=>this._contrastCache.clear()))),this.register(this._optionsService.onSpecificOptionChange("theme",(()=>this._setTheme(this._optionsService.rawOptions.theme))))}_setTheme(x={}){let m=this._colors;if(m.foreground=y(x.foreground,o),m.background=y(x.background,l),m.cursor=y(x.cursor,a),m.cursorAccent=y(x.cursorAccent,h),m.selectionBackgroundTransparent=y(x.selectionBackground,_),m.selectionBackgroundOpaque=f.color.blend(m.background,m.selectionBackgroundTransparent),m.selectionInactiveBackgroundTransparent=y(x.selectionInactiveBackground,m.selectionBackgroundTransparent),m.selectionInactiveBackgroundOpaque=f.color.blend(m.background,m.selectionInactiveBackgroundTransparent),m.selectionForeground=x.selectionForeground?y(x.selectionForeground,f.NULL_COLOR):void 0,m.selectionForeground===f.NULL_COLOR&&(m.selectionForeground=void 0),f.color.isOpaque(m.selectionBackgroundTransparent)&&(m.selectionBackgroundTransparent=f.color.opacity(m.selectionBackgroundTransparent,.3)),f.color.isOpaque(m.selectionInactiveBackgroundTransparent)&&(m.selectionInactiveBackgroundTransparent=f.color.opacity(m.selectionInactiveBackgroundTransparent,.3)),m.ansi=i.DEFAULT_ANSI_COLORS.slice(),m.ansi[0]=y(x.black,i.DEFAULT_ANSI_COLORS[0]),m.ansi[1]=y(x.red,i.DEFAULT_ANSI_COLORS[1]),m.ansi[2]=y(x.green,i.DEFAULT_ANSI_COLORS[2]),m.ansi[3]=y(x.yellow,i.DEFAULT_ANSI_COLORS[3]),m.ansi[4]=y(x.blue,i.DEFAULT_ANSI_COLORS[4]),m.ansi[5]=y(x.magenta,i.DEFAULT_ANSI_COLORS[5]),m.ansi[6]=y(x.cyan,i.DEFAULT_ANSI_COLORS[6]),m.ansi[7]=y(x.white,i.DEFAULT_ANSI_COLORS[7]),m.ansi[8]=y(x.brightBlack,i.DEFAULT_ANSI_COLORS[8]),m.ansi[9]=y(x.brightRed,i.DEFAULT_ANSI_COLORS[9]),m.ansi[10]=y(x.brightGreen,i.DEFAULT_ANSI_COLORS[10]),m.ansi[11]=y(x.brightYellow,i.DEFAULT_ANSI_COLORS[11]),m.ansi[12]=y(x.brightBlue,i.DEFAULT_ANSI_COLORS[12]),m.ansi[13]=y(x.brightMagenta,i.DEFAULT_ANSI_COLORS[13]),m.ansi[14]=y(x.brightCyan,i.DEFAULT_ANSI_COLORS[14]),m.ansi[15]=y(x.brightWhite,i.DEFAULT_ANSI_COLORS[15]),x.extendedAnsi){let S=Math.min(m.ansi.length-16,x.extendedAnsi.length);for(let L=0;L<S;L++)m.ansi[L+16]=y(x.extendedAnsi[L],i.DEFAULT_ANSI_COLORS[L+16])}this._contrastCache.clear(),this._halfContrastCache.clear(),this._updateRestoreColors(),this._onChangeColors.fire(this.colors)}restoreColor(x){this._restoreColor(x),this._onChangeColors.fire(this.colors)}_restoreColor(x){if(x!==void 0)switch(x){case 256:this._colors.foreground=this._restoreColors.foreground;break;case 257:this._colors.background=this._restoreColors.background;break;case 258:this._colors.cursor=this._restoreColors.cursor;break;default:this._colors.ansi[x]=this._restoreColors.ansi[x]}else for(let m=0;m<this._restoreColors.ansi.length;++m)this._colors.ansi[m]=this._restoreColors.ansi[m]}modifyColors(x){x(this._colors),this._onChangeColors.fire(this.colors)}_updateRestoreColors(){this._restoreColors={foreground:this._colors.foreground,background:this._colors.background,cursor:this._colors.cursor,ansi:this._colors.ansi.slice()}}};function y(x,m){if(x!==void 0)try{return f.css.toColor(x)}catch{}return m}i.ThemeService=g=c([p(0,b.IOptionsService)],g)},6349:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CircularList=void 0;let c=r(8460),p=r(844);class d extends p.Disposable{constructor(v){super(),this._maxLength=v,this.onDeleteEmitter=this.register(new c.EventEmitter),this.onDelete=this.onDeleteEmitter.event,this.onInsertEmitter=this.register(new c.EventEmitter),this.onInsert=this.onInsertEmitter.event,this.onTrimEmitter=this.register(new c.EventEmitter),this.onTrim=this.onTrimEmitter.event,this._array=new Array(this._maxLength),this._startIndex=0,this._length=0}get maxLength(){return this._maxLength}set maxLength(v){if(this._maxLength===v)return;let w=new Array(v);for(let b=0;b<Math.min(v,this.length);b++)w[b]=this._array[this._getCyclicIndex(b)];this._array=w,this._maxLength=v,this._startIndex=0}get length(){return this._length}set length(v){if(v>this._length)for(let w=this._length;w<v;w++)this._array[w]=void 0;this._length=v}get(v){return this._array[this._getCyclicIndex(v)]}set(v,w){this._array[this._getCyclicIndex(v)]=w}push(v){this._array[this._getCyclicIndex(this._length)]=v,this._length===this._maxLength?(this._startIndex=++this._startIndex%this._maxLength,this.onTrimEmitter.fire(1)):this._length++}recycle(){if(this._length!==this._maxLength)throw new Error("Can only recycle when the buffer is full");return this._startIndex=++this._startIndex%this._maxLength,this.onTrimEmitter.fire(1),this._array[this._getCyclicIndex(this._length-1)]}get isFull(){return this._length===this._maxLength}pop(){return this._array[this._getCyclicIndex(this._length---1)]}splice(v,w,...b){if(w){for(let o=v;o<this._length-w;o++)this._array[this._getCyclicIndex(o)]=this._array[this._getCyclicIndex(o+w)];this._length-=w,this.onDeleteEmitter.fire({index:v,amount:w})}for(let o=this._length-1;o>=v;o--)this._array[this._getCyclicIndex(o+b.length)]=this._array[this._getCyclicIndex(o)];for(let o=0;o<b.length;o++)this._array[this._getCyclicIndex(v+o)]=b[o];if(b.length&&this.onInsertEmitter.fire({index:v,amount:b.length}),this._length+b.length>this._maxLength){let o=this._length+b.length-this._maxLength;this._startIndex+=o,this._length=this._maxLength,this.onTrimEmitter.fire(o)}else this._length+=b.length}trimStart(v){v>this._length&&(v=this._length),this._startIndex+=v,this._length-=v,this.onTrimEmitter.fire(v)}shiftElements(v,w,b){if(!(w<=0)){if(v<0||v>=this._length)throw new Error("start argument out of range");if(v+b<0)throw new Error("Cannot shift elements in list beyond index 0");if(b>0){for(let l=w-1;l>=0;l--)this.set(v+l+b,this.get(v+l));let o=v+w+b-this._length;if(o>0)for(this._length+=o;this._length>this._maxLength;)this._length--,this._startIndex++,this.onTrimEmitter.fire(1)}else for(let o=0;o<w;o++)this.set(v+o+b,this.get(v+o))}}_getCyclicIndex(v){return(this._startIndex+v)%this._maxLength}}i.CircularList=d},1439:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.clone=void 0,i.clone=function r(c,p=5){if(typeof c!="object")return c;let d=Array.isArray(c)?[]:{};for(let f in c)d[f]=p<=1?c[f]:c[f]&&r(c[f],p-1);return d}},8055:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.contrastRatio=i.toPaddedHex=i.rgba=i.rgb=i.css=i.color=i.channels=i.NULL_COLOR=void 0;let c=r(6114),p=0,d=0,f=0,v=0;var w,b,o,l,a;function h(g){let y=g.toString(16);return y.length<2?"0"+y:y}function _(g,y){return g<y?(y+.05)/(g+.05):(g+.05)/(y+.05)}i.NULL_COLOR={css:"#00000000",rgba:0},(function(g){g.toCss=function(y,x,m,S){return S!==void 0?`#${h(y)}${h(x)}${h(m)}${h(S)}`:`#${h(y)}${h(x)}${h(m)}`},g.toRgba=function(y,x,m,S=255){return(y<<24|x<<16|m<<8|S)>>>0}})(w||(i.channels=w={})),(function(g){function y(x,m){return v=Math.round(255*m),[p,d,f]=a.toChannels(x.rgba),{css:w.toCss(p,d,f,v),rgba:w.toRgba(p,d,f,v)}}g.blend=function(x,m){if(v=(255&m.rgba)/255,v===1)return{css:m.css,rgba:m.rgba};let S=m.rgba>>24&255,L=m.rgba>>16&255,O=m.rgba>>8&255,D=x.rgba>>24&255,B=x.rgba>>16&255,F=x.rgba>>8&255;return p=D+Math.round((S-D)*v),d=B+Math.round((L-B)*v),f=F+Math.round((O-F)*v),{css:w.toCss(p,d,f),rgba:w.toRgba(p,d,f)}},g.isOpaque=function(x){return(255&x.rgba)==255},g.ensureContrastRatio=function(x,m,S){let L=a.ensureContrastRatio(x.rgba,m.rgba,S);if(L)return a.toColor(L>>24&255,L>>16&255,L>>8&255)},g.opaque=function(x){let m=(255|x.rgba)>>>0;return[p,d,f]=a.toChannels(m),{css:w.toCss(p,d,f),rgba:m}},g.opacity=y,g.multiplyOpacity=function(x,m){return v=255&x.rgba,y(x,v*m/255)},g.toColorRGB=function(x){return[x.rgba>>24&255,x.rgba>>16&255,x.rgba>>8&255]}})(b||(i.color=b={})),(function(g){let y,x;if(!c.isNode){let m=document.createElement("canvas");m.width=1,m.height=1;let S=m.getContext("2d",{willReadFrequently:!0});S&&(y=S,y.globalCompositeOperation="copy",x=y.createLinearGradient(0,0,1,1))}g.toColor=function(m){if(m.match(/#[\da-f]{3,8}/i))switch(m.length){case 4:return p=parseInt(m.slice(1,2).repeat(2),16),d=parseInt(m.slice(2,3).repeat(2),16),f=parseInt(m.slice(3,4).repeat(2),16),a.toColor(p,d,f);case 5:return p=parseInt(m.slice(1,2).repeat(2),16),d=parseInt(m.slice(2,3).repeat(2),16),f=parseInt(m.slice(3,4).repeat(2),16),v=parseInt(m.slice(4,5).repeat(2),16),a.toColor(p,d,f,v);case 7:return{css:m,rgba:(parseInt(m.slice(1),16)<<8|255)>>>0};case 9:return{css:m,rgba:parseInt(m.slice(1),16)>>>0}}let S=m.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*(0|1|\d?\.(\d+))\s*)?\)/);if(S)return p=parseInt(S[1]),d=parseInt(S[2]),f=parseInt(S[3]),v=Math.round(255*(S[5]===void 0?1:parseFloat(S[5]))),a.toColor(p,d,f,v);if(!y||!x)throw new Error("css.toColor: Unsupported css format");if(y.fillStyle=x,y.fillStyle=m,typeof y.fillStyle!="string")throw new Error("css.toColor: Unsupported css format");if(y.fillRect(0,0,1,1),[p,d,f,v]=y.getImageData(0,0,1,1).data,v!==255)throw new Error("css.toColor: Unsupported css format");return{rgba:w.toRgba(p,d,f,v),css:m}}})(o||(i.css=o={})),(function(g){function y(x,m,S){let L=x/255,O=m/255,D=S/255;return .2126*(L<=.03928?L/12.92:Math.pow((L+.055)/1.055,2.4))+.7152*(O<=.03928?O/12.92:Math.pow((O+.055)/1.055,2.4))+.0722*(D<=.03928?D/12.92:Math.pow((D+.055)/1.055,2.4))}g.relativeLuminance=function(x){return y(x>>16&255,x>>8&255,255&x)},g.relativeLuminance2=y})(l||(i.rgb=l={})),(function(g){function y(m,S,L){let O=m>>24&255,D=m>>16&255,B=m>>8&255,F=S>>24&255,P=S>>16&255,M=S>>8&255,I=_(l.relativeLuminance2(F,P,M),l.relativeLuminance2(O,D,B));for(;I<L&&(F>0||P>0||M>0);)F-=Math.max(0,Math.ceil(.1*F)),P-=Math.max(0,Math.ceil(.1*P)),M-=Math.max(0,Math.ceil(.1*M)),I=_(l.relativeLuminance2(F,P,M),l.relativeLuminance2(O,D,B));return(F<<24|P<<16|M<<8|255)>>>0}function x(m,S,L){let O=m>>24&255,D=m>>16&255,B=m>>8&255,F=S>>24&255,P=S>>16&255,M=S>>8&255,I=_(l.relativeLuminance2(F,P,M),l.relativeLuminance2(O,D,B));for(;I<L&&(F<255||P<255||M<255);)F=Math.min(255,F+Math.ceil(.1*(255-F))),P=Math.min(255,P+Math.ceil(.1*(255-P))),M=Math.min(255,M+Math.ceil(.1*(255-M))),I=_(l.relativeLuminance2(F,P,M),l.relativeLuminance2(O,D,B));return(F<<24|P<<16|M<<8|255)>>>0}g.ensureContrastRatio=function(m,S,L){let O=l.relativeLuminance(m>>8),D=l.relativeLuminance(S>>8);if(_(O,D)<L){if(D<O){let P=y(m,S,L),M=_(O,l.relativeLuminance(P>>8));if(M<L){let I=x(m,S,L);return M>_(O,l.relativeLuminance(I>>8))?P:I}return P}let B=x(m,S,L),F=_(O,l.relativeLuminance(B>>8));if(F<L){let P=y(m,S,L);return F>_(O,l.relativeLuminance(P>>8))?B:P}return B}},g.reduceLuminance=y,g.increaseLuminance=x,g.toChannels=function(m){return[m>>24&255,m>>16&255,m>>8&255,255&m]},g.toColor=function(m,S,L,O){return{css:w.toCss(m,S,L,O),rgba:w.toRgba(m,S,L,O)}}})(a||(i.rgba=a={})),i.toPaddedHex=h,i.contrastRatio=_},8969:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CoreTerminal=void 0;let c=r(844),p=r(2585),d=r(4348),f=r(7866),v=r(744),w=r(7302),b=r(6975),o=r(8460),l=r(1753),a=r(1480),h=r(7994),_=r(9282),g=r(5435),y=r(5981),x=r(2660),m=!1;class S extends c.Disposable{get onScroll(){return this._onScrollApi||(this._onScrollApi=this.register(new o.EventEmitter),this._onScroll.event((O=>{var D;(D=this._onScrollApi)===null||D===void 0||D.fire(O.position)}))),this._onScrollApi.event}get cols(){return this._bufferService.cols}get rows(){return this._bufferService.rows}get buffers(){return this._bufferService.buffers}get options(){return this.optionsService.options}set options(O){for(let D in O)this.optionsService.options[D]=O[D]}constructor(O){super(),this._windowsWrappingHeuristics=this.register(new c.MutableDisposable),this._onBinary=this.register(new o.EventEmitter),this.onBinary=this._onBinary.event,this._onData=this.register(new o.EventEmitter),this.onData=this._onData.event,this._onLineFeed=this.register(new o.EventEmitter),this.onLineFeed=this._onLineFeed.event,this._onResize=this.register(new o.EventEmitter),this.onResize=this._onResize.event,this._onWriteParsed=this.register(new o.EventEmitter),this.onWriteParsed=this._onWriteParsed.event,this._onScroll=this.register(new o.EventEmitter),this._instantiationService=new d.InstantiationService,this.optionsService=this.register(new w.OptionsService(O)),this._instantiationService.setService(p.IOptionsService,this.optionsService),this._bufferService=this.register(this._instantiationService.createInstance(v.BufferService)),this._instantiationService.setService(p.IBufferService,this._bufferService),this._logService=this.register(this._instantiationService.createInstance(f.LogService)),this._instantiationService.setService(p.ILogService,this._logService),this.coreService=this.register(this._instantiationService.createInstance(b.CoreService)),this._instantiationService.setService(p.ICoreService,this.coreService),this.coreMouseService=this.register(this._instantiationService.createInstance(l.CoreMouseService)),this._instantiationService.setService(p.ICoreMouseService,this.coreMouseService),this.unicodeService=this.register(this._instantiationService.createInstance(a.UnicodeService)),this._instantiationService.setService(p.IUnicodeService,this.unicodeService),this._charsetService=this._instantiationService.createInstance(h.CharsetService),this._instantiationService.setService(p.ICharsetService,this._charsetService),this._oscLinkService=this._instantiationService.createInstance(x.OscLinkService),this._instantiationService.setService(p.IOscLinkService,this._oscLinkService),this._inputHandler=this.register(new g.InputHandler(this._bufferService,this._charsetService,this.coreService,this._logService,this.optionsService,this._oscLinkService,this.coreMouseService,this.unicodeService)),this.register((0,o.forwardEvent)(this._inputHandler.onLineFeed,this._onLineFeed)),this.register(this._inputHandler),this.register((0,o.forwardEvent)(this._bufferService.onResize,this._onResize)),this.register((0,o.forwardEvent)(this.coreService.onData,this._onData)),this.register((0,o.forwardEvent)(this.coreService.onBinary,this._onBinary)),this.register(this.coreService.onRequestScrollToBottom((()=>this.scrollToBottom()))),this.register(this.coreService.onUserInput((()=>this._writeBuffer.handleUserInput()))),this.register(this.optionsService.onMultipleOptionChange(["windowsMode","windowsPty"],(()=>this._handleWindowsPtyOptionChange()))),this.register(this._bufferService.onScroll((D=>{this._onScroll.fire({position:this._bufferService.buffer.ydisp,source:0}),this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop,this._bufferService.buffer.scrollBottom)}))),this.register(this._inputHandler.onScroll((D=>{this._onScroll.fire({position:this._bufferService.buffer.ydisp,source:0}),this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop,this._bufferService.buffer.scrollBottom)}))),this._writeBuffer=this.register(new y.WriteBuffer(((D,B)=>this._inputHandler.parse(D,B)))),this.register((0,o.forwardEvent)(this._writeBuffer.onWriteParsed,this._onWriteParsed))}write(O,D){this._writeBuffer.write(O,D)}writeSync(O,D){this._logService.logLevel<=p.LogLevelEnum.WARN&&!m&&(this._logService.warn("writeSync is unreliable and will be removed soon."),m=!0),this._writeBuffer.writeSync(O,D)}resize(O,D){isNaN(O)||isNaN(D)||(O=Math.max(O,v.MINIMUM_COLS),D=Math.max(D,v.MINIMUM_ROWS),this._bufferService.resize(O,D))}scroll(O,D=!1){this._bufferService.scroll(O,D)}scrollLines(O,D,B){this._bufferService.scrollLines(O,D,B)}scrollPages(O){this.scrollLines(O*(this.rows-1))}scrollToTop(){this.scrollLines(-this._bufferService.buffer.ydisp)}scrollToBottom(){this.scrollLines(this._bufferService.buffer.ybase-this._bufferService.buffer.ydisp)}scrollToLine(O){let D=O-this._bufferService.buffer.ydisp;D!==0&&this.scrollLines(D)}registerEscHandler(O,D){return this._inputHandler.registerEscHandler(O,D)}registerDcsHandler(O,D){return this._inputHandler.registerDcsHandler(O,D)}registerCsiHandler(O,D){return this._inputHandler.registerCsiHandler(O,D)}registerOscHandler(O,D){return this._inputHandler.registerOscHandler(O,D)}_setup(){this._handleWindowsPtyOptionChange()}reset(){this._inputHandler.reset(),this._bufferService.reset(),this._charsetService.reset(),this.coreService.reset(),this.coreMouseService.reset()}_handleWindowsPtyOptionChange(){let O=!1,D=this.optionsService.rawOptions.windowsPty;D&&D.buildNumber!==void 0&&D.buildNumber!==void 0?O=D.backend==="conpty"&&D.buildNumber<21376:this.optionsService.rawOptions.windowsMode&&(O=!0),O?this._enableWindowsWrappingHeuristics():this._windowsWrappingHeuristics.clear()}_enableWindowsWrappingHeuristics(){if(!this._windowsWrappingHeuristics.value){let O=[];O.push(this.onLineFeed(_.updateWindowsModeWrappedState.bind(null,this._bufferService))),O.push(this.registerCsiHandler({final:"H"},(()=>((0,_.updateWindowsModeWrappedState)(this._bufferService),!1)))),this._windowsWrappingHeuristics.value=(0,c.toDisposable)((()=>{for(let D of O)D.dispose()}))}}}i.CoreTerminal=S},8460:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.forwardEvent=i.EventEmitter=void 0,i.EventEmitter=class{constructor(){this._listeners=[],this._disposed=!1}get event(){return this._event||(this._event=r=>(this._listeners.push(r),{dispose:()=>{if(!this._disposed){for(let c=0;c<this._listeners.length;c++)if(this._listeners[c]===r)return void this._listeners.splice(c,1)}}})),this._event}fire(r,c){let p=[];for(let d=0;d<this._listeners.length;d++)p.push(this._listeners[d]);for(let d=0;d<p.length;d++)p[d].call(void 0,r,c)}dispose(){this.clearListeners(),this._disposed=!0}clearListeners(){this._listeners&&(this._listeners.length=0)}},i.forwardEvent=function(r,c){return r((p=>c.fire(p)))}},5435:function(u,i,r){var c=this&&this.__decorate||function(I,C,E,A){var R,N=arguments.length,j=N<3?C:A===null?A=Object.getOwnPropertyDescriptor(C,E):A;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")j=Reflect.decorate(I,C,E,A);else for(var K=I.length-1;K>=0;K--)(R=I[K])&&(j=(N<3?R(j):N>3?R(C,E,j):R(C,E))||j);return N>3&&j&&Object.defineProperty(C,E,j),j},p=this&&this.__param||function(I,C){return function(E,A){C(E,A,I)}};Object.defineProperty(i,"__esModule",{value:!0}),i.InputHandler=i.WindowsOptionsReportType=void 0;let d=r(2584),f=r(7116),v=r(2015),w=r(844),b=r(482),o=r(8437),l=r(8460),a=r(643),h=r(511),_=r(3734),g=r(2585),y=r(6242),x=r(6351),m=r(5941),S={"(":0,")":1,"*":2,"+":3,"-":1,".":2},L=131072;function O(I,C){if(I>24)return C.setWinLines||!1;switch(I){case 1:return!!C.restoreWin;case 2:return!!C.minimizeWin;case 3:return!!C.setWinPosition;case 4:return!!C.setWinSizePixels;case 5:return!!C.raiseWin;case 6:return!!C.lowerWin;case 7:return!!C.refreshWin;case 8:return!!C.setWinSizeChars;case 9:return!!C.maximizeWin;case 10:return!!C.fullscreenWin;case 11:return!!C.getWinState;case 13:return!!C.getWinPosition;case 14:return!!C.getWinSizePixels;case 15:return!!C.getScreenSizePixels;case 16:return!!C.getCellSizePixels;case 18:return!!C.getWinSizeChars;case 19:return!!C.getScreenSizeChars;case 20:return!!C.getIconTitle;case 21:return!!C.getWinTitle;case 22:return!!C.pushTitle;case 23:return!!C.popTitle;case 24:return!!C.setWinLines}return!1}var D;(function(I){I[I.GET_WIN_SIZE_PIXELS=0]="GET_WIN_SIZE_PIXELS",I[I.GET_CELL_SIZE_PIXELS=1]="GET_CELL_SIZE_PIXELS"})(D||(i.WindowsOptionsReportType=D={}));let B=0;class F extends w.Disposable{getAttrData(){return this._curAttrData}constructor(C,E,A,R,N,j,K,q,he=new v.EscapeSequenceParser){super(),this._bufferService=C,this._charsetService=E,this._coreService=A,this._logService=R,this._optionsService=N,this._oscLinkService=j,this._coreMouseService=K,this._unicodeService=q,this._parser=he,this._parseBuffer=new Uint32Array(4096),this._stringDecoder=new b.StringToUtf32,this._utf8Decoder=new b.Utf8ToUtf32,this._workCell=new h.CellData,this._windowTitle="",this._iconName="",this._windowTitleStack=[],this._iconNameStack=[],this._curAttrData=o.DEFAULT_ATTR_DATA.clone(),this._eraseAttrDataInternal=o.DEFAULT_ATTR_DATA.clone(),this._onRequestBell=this.register(new l.EventEmitter),this.onRequestBell=this._onRequestBell.event,this._onRequestRefreshRows=this.register(new l.EventEmitter),this.onRequestRefreshRows=this._onRequestRefreshRows.event,this._onRequestReset=this.register(new l.EventEmitter),this.onRequestReset=this._onRequestReset.event,this._onRequestSendFocus=this.register(new l.EventEmitter),this.onRequestSendFocus=this._onRequestSendFocus.event,this._onRequestSyncScrollBar=this.register(new l.EventEmitter),this.onRequestSyncScrollBar=this._onRequestSyncScrollBar.event,this._onRequestWindowsOptionsReport=this.register(new l.EventEmitter),this.onRequestWindowsOptionsReport=this._onRequestWindowsOptionsReport.event,this._onA11yChar=this.register(new l.EventEmitter),this.onA11yChar=this._onA11yChar.event,this._onA11yTab=this.register(new l.EventEmitter),this.onA11yTab=this._onA11yTab.event,this._onCursorMove=this.register(new l.EventEmitter),this.onCursorMove=this._onCursorMove.event,this._onLineFeed=this.register(new l.EventEmitter),this.onLineFeed=this._onLineFeed.event,this._onScroll=this.register(new l.EventEmitter),this.onScroll=this._onScroll.event,this._onTitleChange=this.register(new l.EventEmitter),this.onTitleChange=this._onTitleChange.event,this._onColor=this.register(new l.EventEmitter),this.onColor=this._onColor.event,this._parseStack={paused:!1,cursorStartX:0,cursorStartY:0,decodedLength:0,position:0},this._specialColors=[256,257,258],this.register(this._parser),this._dirtyRowTracker=new P(this._bufferService),this._activeBuffer=this._bufferService.buffer,this.register(this._bufferService.buffers.onBufferActivate((k=>this._activeBuffer=k.activeBuffer))),this._parser.setCsiHandlerFallback(((k,H)=>{this._logService.debug("Unknown CSI code: ",{identifier:this._parser.identToString(k),params:H.toArray()})})),this._parser.setEscHandlerFallback((k=>{this._logService.debug("Unknown ESC code: ",{identifier:this._parser.identToString(k)})})),this._parser.setExecuteHandlerFallback((k=>{this._logService.debug("Unknown EXECUTE code: ",{code:k})})),this._parser.setOscHandlerFallback(((k,H,U)=>{this._logService.debug("Unknown OSC code: ",{identifier:k,action:H,data:U})})),this._parser.setDcsHandlerFallback(((k,H,U)=>{H==="HOOK"&&(U=U.toArray()),this._logService.debug("Unknown DCS code: ",{identifier:this._parser.identToString(k),action:H,payload:U})})),this._parser.setPrintHandler(((k,H,U)=>this.print(k,H,U))),this._parser.registerCsiHandler({final:"@"},(k=>this.insertChars(k))),this._parser.registerCsiHandler({intermediates:" ",final:"@"},(k=>this.scrollLeft(k))),this._parser.registerCsiHandler({final:"A"},(k=>this.cursorUp(k))),this._parser.registerCsiHandler({intermediates:" ",final:"A"},(k=>this.scrollRight(k))),this._parser.registerCsiHandler({final:"B"},(k=>this.cursorDown(k))),this._parser.registerCsiHandler({final:"C"},(k=>this.cursorForward(k))),this._parser.registerCsiHandler({final:"D"},(k=>this.cursorBackward(k))),this._parser.registerCsiHandler({final:"E"},(k=>this.cursorNextLine(k))),this._parser.registerCsiHandler({final:"F"},(k=>this.cursorPrecedingLine(k))),this._parser.registerCsiHandler({final:"G"},(k=>this.cursorCharAbsolute(k))),this._parser.registerCsiHandler({final:"H"},(k=>this.cursorPosition(k))),this._parser.registerCsiHandler({final:"I"},(k=>this.cursorForwardTab(k))),this._parser.registerCsiHandler({final:"J"},(k=>this.eraseInDisplay(k,!1))),this._parser.registerCsiHandler({prefix:"?",final:"J"},(k=>this.eraseInDisplay(k,!0))),this._parser.registerCsiHandler({final:"K"},(k=>this.eraseInLine(k,!1))),this._parser.registerCsiHandler({prefix:"?",final:"K"},(k=>this.eraseInLine(k,!0))),this._parser.registerCsiHandler({final:"L"},(k=>this.insertLines(k))),this._parser.registerCsiHandler({final:"M"},(k=>this.deleteLines(k))),this._parser.registerCsiHandler({final:"P"},(k=>this.deleteChars(k))),this._parser.registerCsiHandler({final:"S"},(k=>this.scrollUp(k))),this._parser.registerCsiHandler({final:"T"},(k=>this.scrollDown(k))),this._parser.registerCsiHandler({final:"X"},(k=>this.eraseChars(k))),this._parser.registerCsiHandler({final:"Z"},(k=>this.cursorBackwardTab(k))),this._parser.registerCsiHandler({final:"`"},(k=>this.charPosAbsolute(k))),this._parser.registerCsiHandler({final:"a"},(k=>this.hPositionRelative(k))),this._parser.registerCsiHandler({final:"b"},(k=>this.repeatPrecedingCharacter(k))),this._parser.registerCsiHandler({final:"c"},(k=>this.sendDeviceAttributesPrimary(k))),this._parser.registerCsiHandler({prefix:">",final:"c"},(k=>this.sendDeviceAttributesSecondary(k))),this._parser.registerCsiHandler({final:"d"},(k=>this.linePosAbsolute(k))),this._parser.registerCsiHandler({final:"e"},(k=>this.vPositionRelative(k))),this._parser.registerCsiHandler({final:"f"},(k=>this.hVPosition(k))),this._parser.registerCsiHandler({final:"g"},(k=>this.tabClear(k))),this._parser.registerCsiHandler({final:"h"},(k=>this.setMode(k))),this._parser.registerCsiHandler({prefix:"?",final:"h"},(k=>this.setModePrivate(k))),this._parser.registerCsiHandler({final:"l"},(k=>this.resetMode(k))),this._parser.registerCsiHandler({prefix:"?",final:"l"},(k=>this.resetModePrivate(k))),this._parser.registerCsiHandler({final:"m"},(k=>this.charAttributes(k))),this._parser.registerCsiHandler({final:"n"},(k=>this.deviceStatus(k))),this._parser.registerCsiHandler({prefix:"?",final:"n"},(k=>this.deviceStatusPrivate(k))),this._parser.registerCsiHandler({intermediates:"!",final:"p"},(k=>this.softReset(k))),this._parser.registerCsiHandler({intermediates:" ",final:"q"},(k=>this.setCursorStyle(k))),this._parser.registerCsiHandler({final:"r"},(k=>this.setScrollRegion(k))),this._parser.registerCsiHandler({final:"s"},(k=>this.saveCursor(k))),this._parser.registerCsiHandler({final:"t"},(k=>this.windowOptions(k))),this._parser.registerCsiHandler({final:"u"},(k=>this.restoreCursor(k))),this._parser.registerCsiHandler({intermediates:"'",final:"}"},(k=>this.insertColumns(k))),this._parser.registerCsiHandler({intermediates:"'",final:"~"},(k=>this.deleteColumns(k))),this._parser.registerCsiHandler({intermediates:'"',final:"q"},(k=>this.selectProtected(k))),this._parser.registerCsiHandler({intermediates:"$",final:"p"},(k=>this.requestMode(k,!0))),this._parser.registerCsiHandler({prefix:"?",intermediates:"$",final:"p"},(k=>this.requestMode(k,!1))),this._parser.setExecuteHandler(d.C0.BEL,(()=>this.bell())),this._parser.setExecuteHandler(d.C0.LF,(()=>this.lineFeed())),this._parser.setExecuteHandler(d.C0.VT,(()=>this.lineFeed())),this._parser.setExecuteHandler(d.C0.FF,(()=>this.lineFeed())),this._parser.setExecuteHandler(d.C0.CR,(()=>this.carriageReturn())),this._parser.setExecuteHandler(d.C0.BS,(()=>this.backspace())),this._parser.setExecuteHandler(d.C0.HT,(()=>this.tab())),this._parser.setExecuteHandler(d.C0.SO,(()=>this.shiftOut())),this._parser.setExecuteHandler(d.C0.SI,(()=>this.shiftIn())),this._parser.setExecuteHandler(d.C1.IND,(()=>this.index())),this._parser.setExecuteHandler(d.C1.NEL,(()=>this.nextLine())),this._parser.setExecuteHandler(d.C1.HTS,(()=>this.tabSet())),this._parser.registerOscHandler(0,new y.OscHandler((k=>(this.setTitle(k),this.setIconName(k),!0)))),this._parser.registerOscHandler(1,new y.OscHandler((k=>this.setIconName(k)))),this._parser.registerOscHandler(2,new y.OscHandler((k=>this.setTitle(k)))),this._parser.registerOscHandler(4,new y.OscHandler((k=>this.setOrReportIndexedColor(k)))),this._parser.registerOscHandler(8,new y.OscHandler((k=>this.setHyperlink(k)))),this._parser.registerOscHandler(10,new y.OscHandler((k=>this.setOrReportFgColor(k)))),this._parser.registerOscHandler(11,new y.OscHandler((k=>this.setOrReportBgColor(k)))),this._parser.registerOscHandler(12,new y.OscHandler((k=>this.setOrReportCursorColor(k)))),this._parser.registerOscHandler(104,new y.OscHandler((k=>this.restoreIndexedColor(k)))),this._parser.registerOscHandler(110,new y.OscHandler((k=>this.restoreFgColor(k)))),this._parser.registerOscHandler(111,new y.OscHandler((k=>this.restoreBgColor(k)))),this._parser.registerOscHandler(112,new y.OscHandler((k=>this.restoreCursorColor(k)))),this._parser.registerEscHandler({final:"7"},(()=>this.saveCursor())),this._parser.registerEscHandler({final:"8"},(()=>this.restoreCursor())),this._parser.registerEscHandler({final:"D"},(()=>this.index())),this._parser.registerEscHandler({final:"E"},(()=>this.nextLine())),this._parser.registerEscHandler({final:"H"},(()=>this.tabSet())),this._parser.registerEscHandler({final:"M"},(()=>this.reverseIndex())),this._parser.registerEscHandler({final:"="},(()=>this.keypadApplicationMode())),this._parser.registerEscHandler({final:">"},(()=>this.keypadNumericMode())),this._parser.registerEscHandler({final:"c"},(()=>this.fullReset())),this._parser.registerEscHandler({final:"n"},(()=>this.setgLevel(2))),this._parser.registerEscHandler({final:"o"},(()=>this.setgLevel(3))),this._parser.registerEscHandler({final:"|"},(()=>this.setgLevel(3))),this._parser.registerEscHandler({final:"}"},(()=>this.setgLevel(2))),this._parser.registerEscHandler({final:"~"},(()=>this.setgLevel(1))),this._parser.registerEscHandler({intermediates:"%",final:"@"},(()=>this.selectDefaultCharset())),this._parser.registerEscHandler({intermediates:"%",final:"G"},(()=>this.selectDefaultCharset()));for(let k in f.CHARSETS)this._parser.registerEscHandler({intermediates:"(",final:k},(()=>this.selectCharset("("+k))),this._parser.registerEscHandler({intermediates:")",final:k},(()=>this.selectCharset(")"+k))),this._parser.registerEscHandler({intermediates:"*",final:k},(()=>this.selectCharset("*"+k))),this._parser.registerEscHandler({intermediates:"+",final:k},(()=>this.selectCharset("+"+k))),this._parser.registerEscHandler({intermediates:"-",final:k},(()=>this.selectCharset("-"+k))),this._parser.registerEscHandler({intermediates:".",final:k},(()=>this.selectCharset("."+k))),this._parser.registerEscHandler({intermediates:"/",final:k},(()=>this.selectCharset("/"+k)));this._parser.registerEscHandler({intermediates:"#",final:"8"},(()=>this.screenAlignmentPattern())),this._parser.setErrorHandler((k=>(this._logService.error("Parsing error: ",k),k))),this._parser.registerDcsHandler({intermediates:"$",final:"q"},new x.DcsHandler(((k,H)=>this.requestStatusString(k,H))))}_preserveStack(C,E,A,R){this._parseStack.paused=!0,this._parseStack.cursorStartX=C,this._parseStack.cursorStartY=E,this._parseStack.decodedLength=A,this._parseStack.position=R}_logSlowResolvingAsync(C){this._logService.logLevel<=g.LogLevelEnum.WARN&&Promise.race([C,new Promise(((E,A)=>setTimeout((()=>A("#SLOW_TIMEOUT")),5e3)))]).catch((E=>{if(E!=="#SLOW_TIMEOUT")throw E;console.warn("async parser handler taking longer than 5000 ms")}))}_getCurrentLinkId(){return this._curAttrData.extended.urlId}parse(C,E){let A,R=this._activeBuffer.x,N=this._activeBuffer.y,j=0,K=this._parseStack.paused;if(K){if(A=this._parser.parse(this._parseBuffer,this._parseStack.decodedLength,E))return this._logSlowResolvingAsync(A),A;R=this._parseStack.cursorStartX,N=this._parseStack.cursorStartY,this._parseStack.paused=!1,C.length>L&&(j=this._parseStack.position+L)}if(this._logService.logLevel<=g.LogLevelEnum.DEBUG&&this._logService.debug("parsing data"+(typeof C=="string"?` "${C}"`:` "${Array.prototype.map.call(C,(q=>String.fromCharCode(q))).join("")}"`),typeof C=="string"?C.split("").map((q=>q.charCodeAt(0))):C),this._parseBuffer.length<C.length&&this._parseBuffer.length<L&&(this._parseBuffer=new Uint32Array(Math.min(C.length,L))),K||this._dirtyRowTracker.clearRange(),C.length>L)for(let q=j;q<C.length;q+=L){let he=q+L<C.length?q+L:C.length,k=typeof C=="string"?this._stringDecoder.decode(C.substring(q,he),this._parseBuffer):this._utf8Decoder.decode(C.subarray(q,he),this._parseBuffer);if(A=this._parser.parse(this._parseBuffer,k))return this._preserveStack(R,N,k,q),this._logSlowResolvingAsync(A),A}else if(!K){let q=typeof C=="string"?this._stringDecoder.decode(C,this._parseBuffer):this._utf8Decoder.decode(C,this._parseBuffer);if(A=this._parser.parse(this._parseBuffer,q))return this._preserveStack(R,N,q,0),this._logSlowResolvingAsync(A),A}this._activeBuffer.x===R&&this._activeBuffer.y===N||this._onCursorMove.fire(),this._onRequestRefreshRows.fire(this._dirtyRowTracker.start,this._dirtyRowTracker.end)}print(C,E,A){let R,N,j=this._charsetService.charset,K=this._optionsService.rawOptions.screenReaderMode,q=this._bufferService.cols,he=this._coreService.decPrivateModes.wraparound,k=this._coreService.modes.insertMode,H=this._curAttrData,U=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._activeBuffer.x&&A-E>0&&U.getWidth(this._activeBuffer.x-1)===2&&U.setCellFromCodePoint(this._activeBuffer.x-1,0,1,H.fg,H.bg,H.extended);for(let W=E;W<A;++W){if(R=C[W],N=this._unicodeService.wcwidth(R),R<127&&j){let J=j[String.fromCharCode(R)];J&&(R=J.charCodeAt(0))}if(K&&this._onA11yChar.fire((0,b.stringFromCodePoint)(R)),this._getCurrentLinkId()&&this._oscLinkService.addLineToLink(this._getCurrentLinkId(),this._activeBuffer.ybase+this._activeBuffer.y),N||!this._activeBuffer.x){if(this._activeBuffer.x+N-1>=q){if(he){for(;this._activeBuffer.x<q;)U.setCellFromCodePoint(this._activeBuffer.x++,0,1,H.fg,H.bg,H.extended);this._activeBuffer.x=0,this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData(),!0)):(this._activeBuffer.y>=this._bufferService.rows&&(this._activeBuffer.y=this._bufferService.rows-1),this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!0),U=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y)}else if(this._activeBuffer.x=q-1,N===2)continue}if(k&&(U.insertCells(this._activeBuffer.x,N,this._activeBuffer.getNullCell(H),H),U.getWidth(q-1)===2&&U.setCellFromCodePoint(q-1,a.NULL_CELL_CODE,a.NULL_CELL_WIDTH,H.fg,H.bg,H.extended)),U.setCellFromCodePoint(this._activeBuffer.x++,R,N,H.fg,H.bg,H.extended),N>0)for(;--N;)U.setCellFromCodePoint(this._activeBuffer.x++,0,0,H.fg,H.bg,H.extended)}else U.getWidth(this._activeBuffer.x-1)?U.addCodepointToCell(this._activeBuffer.x-1,R):U.addCodepointToCell(this._activeBuffer.x-2,R)}A-E>0&&(U.loadCell(this._activeBuffer.x-1,this._workCell),this._workCell.getWidth()===2||this._workCell.getCode()>65535?this._parser.precedingCodepoint=0:this._workCell.isCombined()?this._parser.precedingCodepoint=this._workCell.getChars().charCodeAt(0):this._parser.precedingCodepoint=this._workCell.content),this._activeBuffer.x<q&&A-E>0&&U.getWidth(this._activeBuffer.x)===0&&!U.hasContent(this._activeBuffer.x)&&U.setCellFromCodePoint(this._activeBuffer.x,0,1,H.fg,H.bg,H.extended),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}registerCsiHandler(C,E){return C.final!=="t"||C.prefix||C.intermediates?this._parser.registerCsiHandler(C,E):this._parser.registerCsiHandler(C,(A=>!O(A.params[0],this._optionsService.rawOptions.windowOptions)||E(A)))}registerDcsHandler(C,E){return this._parser.registerDcsHandler(C,new x.DcsHandler(E))}registerEscHandler(C,E){return this._parser.registerEscHandler(C,E)}registerOscHandler(C,E){return this._parser.registerOscHandler(C,new y.OscHandler(E))}bell(){return this._onRequestBell.fire(),!0}lineFeed(){return this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._optionsService.rawOptions.convertEol&&(this._activeBuffer.x=0),this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData())):this._activeBuffer.y>=this._bufferService.rows?this._activeBuffer.y=this._bufferService.rows-1:this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!1,this._activeBuffer.x>=this._bufferService.cols&&this._activeBuffer.x--,this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._onLineFeed.fire(),!0}carriageReturn(){return this._activeBuffer.x=0,!0}backspace(){var C;if(!this._coreService.decPrivateModes.reverseWraparound)return this._restrictCursor(),this._activeBuffer.x>0&&this._activeBuffer.x--,!0;if(this._restrictCursor(this._bufferService.cols),this._activeBuffer.x>0)this._activeBuffer.x--;else if(this._activeBuffer.x===0&&this._activeBuffer.y>this._activeBuffer.scrollTop&&this._activeBuffer.y<=this._activeBuffer.scrollBottom&&(!((C=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y))===null||C===void 0)&&C.isWrapped)){this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!1,this._activeBuffer.y--,this._activeBuffer.x=this._bufferService.cols-1;let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);E.hasWidth(this._activeBuffer.x)&&!E.hasContent(this._activeBuffer.x)&&this._activeBuffer.x--}return this._restrictCursor(),!0}tab(){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let C=this._activeBuffer.x;return this._activeBuffer.x=this._activeBuffer.nextStop(),this._optionsService.rawOptions.screenReaderMode&&this._onA11yTab.fire(this._activeBuffer.x-C),!0}shiftOut(){return this._charsetService.setgLevel(1),!0}shiftIn(){return this._charsetService.setgLevel(0),!0}_restrictCursor(C=this._bufferService.cols-1){this._activeBuffer.x=Math.min(C,Math.max(0,this._activeBuffer.x)),this._activeBuffer.y=this._coreService.decPrivateModes.origin?Math.min(this._activeBuffer.scrollBottom,Math.max(this._activeBuffer.scrollTop,this._activeBuffer.y)):Math.min(this._bufferService.rows-1,Math.max(0,this._activeBuffer.y)),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}_setCursor(C,E){this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._coreService.decPrivateModes.origin?(this._activeBuffer.x=C,this._activeBuffer.y=this._activeBuffer.scrollTop+E):(this._activeBuffer.x=C,this._activeBuffer.y=E),this._restrictCursor(),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}_moveCursor(C,E){this._restrictCursor(),this._setCursor(this._activeBuffer.x+C,this._activeBuffer.y+E)}cursorUp(C){let E=this._activeBuffer.y-this._activeBuffer.scrollTop;return E>=0?this._moveCursor(0,-Math.min(E,C.params[0]||1)):this._moveCursor(0,-(C.params[0]||1)),!0}cursorDown(C){let E=this._activeBuffer.scrollBottom-this._activeBuffer.y;return E>=0?this._moveCursor(0,Math.min(E,C.params[0]||1)):this._moveCursor(0,C.params[0]||1),!0}cursorForward(C){return this._moveCursor(C.params[0]||1,0),!0}cursorBackward(C){return this._moveCursor(-(C.params[0]||1),0),!0}cursorNextLine(C){return this.cursorDown(C),this._activeBuffer.x=0,!0}cursorPrecedingLine(C){return this.cursorUp(C),this._activeBuffer.x=0,!0}cursorCharAbsolute(C){return this._setCursor((C.params[0]||1)-1,this._activeBuffer.y),!0}cursorPosition(C){return this._setCursor(C.length>=2?(C.params[1]||1)-1:0,(C.params[0]||1)-1),!0}charPosAbsolute(C){return this._setCursor((C.params[0]||1)-1,this._activeBuffer.y),!0}hPositionRelative(C){return this._moveCursor(C.params[0]||1,0),!0}linePosAbsolute(C){return this._setCursor(this._activeBuffer.x,(C.params[0]||1)-1),!0}vPositionRelative(C){return this._moveCursor(0,C.params[0]||1),!0}hVPosition(C){return this.cursorPosition(C),!0}tabClear(C){let E=C.params[0];return E===0?delete this._activeBuffer.tabs[this._activeBuffer.x]:E===3&&(this._activeBuffer.tabs={}),!0}cursorForwardTab(C){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let E=C.params[0]||1;for(;E--;)this._activeBuffer.x=this._activeBuffer.nextStop();return!0}cursorBackwardTab(C){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let E=C.params[0]||1;for(;E--;)this._activeBuffer.x=this._activeBuffer.prevStop();return!0}selectProtected(C){let E=C.params[0];return E===1&&(this._curAttrData.bg|=536870912),E!==2&&E!==0||(this._curAttrData.bg&=-536870913),!0}_eraseInBufferLine(C,E,A,R=!1,N=!1){let j=this._activeBuffer.lines.get(this._activeBuffer.ybase+C);j.replaceCells(E,A,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData(),N),R&&(j.isWrapped=!1)}_resetBufferLine(C,E=!1){let A=this._activeBuffer.lines.get(this._activeBuffer.ybase+C);A&&(A.fill(this._activeBuffer.getNullCell(this._eraseAttrData()),E),this._bufferService.buffer.clearMarkers(this._activeBuffer.ybase+C),A.isWrapped=!1)}eraseInDisplay(C,E=!1){let A;switch(this._restrictCursor(this._bufferService.cols),C.params[0]){case 0:for(A=this._activeBuffer.y,this._dirtyRowTracker.markDirty(A),this._eraseInBufferLine(A++,this._activeBuffer.x,this._bufferService.cols,this._activeBuffer.x===0,E);A<this._bufferService.rows;A++)this._resetBufferLine(A,E);this._dirtyRowTracker.markDirty(A);break;case 1:for(A=this._activeBuffer.y,this._dirtyRowTracker.markDirty(A),this._eraseInBufferLine(A,0,this._activeBuffer.x+1,!0,E),this._activeBuffer.x+1>=this._bufferService.cols&&(this._activeBuffer.lines.get(A+1).isWrapped=!1);A--;)this._resetBufferLine(A,E);this._dirtyRowTracker.markDirty(0);break;case 2:for(A=this._bufferService.rows,this._dirtyRowTracker.markDirty(A-1);A--;)this._resetBufferLine(A,E);this._dirtyRowTracker.markDirty(0);break;case 3:let R=this._activeBuffer.lines.length-this._bufferService.rows;R>0&&(this._activeBuffer.lines.trimStart(R),this._activeBuffer.ybase=Math.max(this._activeBuffer.ybase-R,0),this._activeBuffer.ydisp=Math.max(this._activeBuffer.ydisp-R,0),this._onScroll.fire(0))}return!0}eraseInLine(C,E=!1){switch(this._restrictCursor(this._bufferService.cols),C.params[0]){case 0:this._eraseInBufferLine(this._activeBuffer.y,this._activeBuffer.x,this._bufferService.cols,this._activeBuffer.x===0,E);break;case 1:this._eraseInBufferLine(this._activeBuffer.y,0,this._activeBuffer.x+1,!1,E);break;case 2:this._eraseInBufferLine(this._activeBuffer.y,0,this._bufferService.cols,!0,E)}return this._dirtyRowTracker.markDirty(this._activeBuffer.y),!0}insertLines(C){this._restrictCursor();let E=C.params[0]||1;if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let A=this._activeBuffer.ybase+this._activeBuffer.y,R=this._bufferService.rows-1-this._activeBuffer.scrollBottom,N=this._bufferService.rows-1+this._activeBuffer.ybase-R+1;for(;E--;)this._activeBuffer.lines.splice(N-1,1),this._activeBuffer.lines.splice(A,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y,this._activeBuffer.scrollBottom),this._activeBuffer.x=0,!0}deleteLines(C){this._restrictCursor();let E=C.params[0]||1;if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let A=this._activeBuffer.ybase+this._activeBuffer.y,R;for(R=this._bufferService.rows-1-this._activeBuffer.scrollBottom,R=this._bufferService.rows-1+this._activeBuffer.ybase-R;E--;)this._activeBuffer.lines.splice(A,1),this._activeBuffer.lines.splice(R,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y,this._activeBuffer.scrollBottom),this._activeBuffer.x=0,!0}insertChars(C){this._restrictCursor();let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return E&&(E.insertCells(this._activeBuffer.x,C.params[0]||1,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}deleteChars(C){this._restrictCursor();let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return E&&(E.deleteCells(this._activeBuffer.x,C.params[0]||1,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}scrollUp(C){let E=C.params[0]||1;for(;E--;)this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollTop,1),this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollBottom,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollDown(C){let E=C.params[0]||1;for(;E--;)this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollBottom,1),this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollTop,0,this._activeBuffer.getBlankLine(o.DEFAULT_ATTR_DATA));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollLeft(C){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=C.params[0]||1;for(let A=this._activeBuffer.scrollTop;A<=this._activeBuffer.scrollBottom;++A){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+A);R.deleteCells(0,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollRight(C){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=C.params[0]||1;for(let A=this._activeBuffer.scrollTop;A<=this._activeBuffer.scrollBottom;++A){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+A);R.insertCells(0,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}insertColumns(C){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=C.params[0]||1;for(let A=this._activeBuffer.scrollTop;A<=this._activeBuffer.scrollBottom;++A){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+A);R.insertCells(this._activeBuffer.x,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}deleteColumns(C){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=C.params[0]||1;for(let A=this._activeBuffer.scrollTop;A<=this._activeBuffer.scrollBottom;++A){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+A);R.deleteCells(this._activeBuffer.x,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}eraseChars(C){this._restrictCursor();let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return E&&(E.replaceCells(this._activeBuffer.x,this._activeBuffer.x+(C.params[0]||1),this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}repeatPrecedingCharacter(C){if(!this._parser.precedingCodepoint)return!0;let E=C.params[0]||1,A=new Uint32Array(E);for(let R=0;R<E;++R)A[R]=this._parser.precedingCodepoint;return this.print(A,0,A.length),!0}sendDeviceAttributesPrimary(C){return C.params[0]>0||(this._is("xterm")||this._is("rxvt-unicode")||this._is("screen")?this._coreService.triggerDataEvent(d.C0.ESC+"[?1;2c"):this._is("linux")&&this._coreService.triggerDataEvent(d.C0.ESC+"[?6c")),!0}sendDeviceAttributesSecondary(C){return C.params[0]>0||(this._is("xterm")?this._coreService.triggerDataEvent(d.C0.ESC+"[>0;276;0c"):this._is("rxvt-unicode")?this._coreService.triggerDataEvent(d.C0.ESC+"[>85;95;0c"):this._is("linux")?this._coreService.triggerDataEvent(C.params[0]+"c"):this._is("screen")&&this._coreService.triggerDataEvent(d.C0.ESC+"[>83;40003;0c")),!0}_is(C){return(this._optionsService.rawOptions.termName+"").indexOf(C)===0}setMode(C){for(let E=0;E<C.length;E++)switch(C.params[E]){case 4:this._coreService.modes.insertMode=!0;break;case 20:this._optionsService.options.convertEol=!0}return!0}setModePrivate(C){for(let E=0;E<C.length;E++)switch(C.params[E]){case 1:this._coreService.decPrivateModes.applicationCursorKeys=!0;break;case 2:this._charsetService.setgCharset(0,f.DEFAULT_CHARSET),this._charsetService.setgCharset(1,f.DEFAULT_CHARSET),this._charsetService.setgCharset(2,f.DEFAULT_CHARSET),this._charsetService.setgCharset(3,f.DEFAULT_CHARSET);break;case 3:this._optionsService.rawOptions.windowOptions.setWinLines&&(this._bufferService.resize(132,this._bufferService.rows),this._onRequestReset.fire());break;case 6:this._coreService.decPrivateModes.origin=!0,this._setCursor(0,0);break;case 7:this._coreService.decPrivateModes.wraparound=!0;break;case 12:this._optionsService.options.cursorBlink=!0;break;case 45:this._coreService.decPrivateModes.reverseWraparound=!0;break;case 66:this._logService.debug("Serial port requested application keypad."),this._coreService.decPrivateModes.applicationKeypad=!0,this._onRequestSyncScrollBar.fire();break;case 9:this._coreMouseService.activeProtocol="X10";break;case 1e3:this._coreMouseService.activeProtocol="VT200";break;case 1002:this._coreMouseService.activeProtocol="DRAG";break;case 1003:this._coreMouseService.activeProtocol="ANY";break;case 1004:this._coreService.decPrivateModes.sendFocus=!0,this._onRequestSendFocus.fire();break;case 1005:this._logService.debug("DECSET 1005 not supported (see #2507)");break;case 1006:this._coreMouseService.activeEncoding="SGR";break;case 1015:this._logService.debug("DECSET 1015 not supported (see #2507)");break;case 1016:this._coreMouseService.activeEncoding="SGR_PIXELS";break;case 25:this._coreService.isCursorHidden=!1;break;case 1048:this.saveCursor();break;case 1049:this.saveCursor();case 47:case 1047:this._bufferService.buffers.activateAltBuffer(this._eraseAttrData()),this._coreService.isCursorInitialized=!0,this._onRequestRefreshRows.fire(0,this._bufferService.rows-1),this._onRequestSyncScrollBar.fire();break;case 2004:this._coreService.decPrivateModes.bracketedPasteMode=!0}return!0}resetMode(C){for(let E=0;E<C.length;E++)switch(C.params[E]){case 4:this._coreService.modes.insertMode=!1;break;case 20:this._optionsService.options.convertEol=!1}return!0}resetModePrivate(C){for(let E=0;E<C.length;E++)switch(C.params[E]){case 1:this._coreService.decPrivateModes.applicationCursorKeys=!1;break;case 3:this._optionsService.rawOptions.windowOptions.setWinLines&&(this._bufferService.resize(80,this._bufferService.rows),this._onRequestReset.fire());break;case 6:this._coreService.decPrivateModes.origin=!1,this._setCursor(0,0);break;case 7:this._coreService.decPrivateModes.wraparound=!1;break;case 12:this._optionsService.options.cursorBlink=!1;break;case 45:this._coreService.decPrivateModes.reverseWraparound=!1;break;case 66:this._logService.debug("Switching back to normal keypad."),this._coreService.decPrivateModes.applicationKeypad=!1,this._onRequestSyncScrollBar.fire();break;case 9:case 1e3:case 1002:case 1003:this._coreMouseService.activeProtocol="NONE";break;case 1004:this._coreService.decPrivateModes.sendFocus=!1;break;case 1005:this._logService.debug("DECRST 1005 not supported (see #2507)");break;case 1006:case 1016:this._coreMouseService.activeEncoding="DEFAULT";break;case 1015:this._logService.debug("DECRST 1015 not supported (see #2507)");break;case 25:this._coreService.isCursorHidden=!0;break;case 1048:this.restoreCursor();break;case 1049:case 47:case 1047:this._bufferService.buffers.activateNormalBuffer(),C.params[E]===1049&&this.restoreCursor(),this._coreService.isCursorInitialized=!0,this._onRequestRefreshRows.fire(0,this._bufferService.rows-1),this._onRequestSyncScrollBar.fire();break;case 2004:this._coreService.decPrivateModes.bracketedPasteMode=!1}return!0}requestMode(C,E){let A=this._coreService.decPrivateModes,{activeProtocol:R,activeEncoding:N}=this._coreMouseService,j=this._coreService,{buffers:K,cols:q}=this._bufferService,{active:he,alt:k}=K,H=this._optionsService.rawOptions,U=de=>de?1:2,W=C.params[0];return J=W,V=E?W===2?4:W===4?U(j.modes.insertMode):W===12?3:W===20?U(H.convertEol):0:W===1?U(A.applicationCursorKeys):W===3?H.windowOptions.setWinLines?q===80?2:q===132?1:0:0:W===6?U(A.origin):W===7?U(A.wraparound):W===8?3:W===9?U(R==="X10"):W===12?U(H.cursorBlink):W===25?U(!j.isCursorHidden):W===45?U(A.reverseWraparound):W===66?U(A.applicationKeypad):W===67?4:W===1e3?U(R==="VT200"):W===1002?U(R==="DRAG"):W===1003?U(R==="ANY"):W===1004?U(A.sendFocus):W===1005?4:W===1006?U(N==="SGR"):W===1015?4:W===1016?U(N==="SGR_PIXELS"):W===1048?1:W===47||W===1047||W===1049?U(he===k):W===2004?U(A.bracketedPasteMode):0,j.triggerDataEvent(`${d.C0.ESC}[${E?"":"?"}${J};${V}$y`),!0;var J,V}_updateAttrColor(C,E,A,R,N){return E===2?(C|=50331648,C&=-16777216,C|=_.AttributeData.fromColorRGB([A,R,N])):E===5&&(C&=-50331904,C|=33554432|255&A),C}_extractColor(C,E,A){let R=[0,0,-1,0,0,0],N=0,j=0;do{if(R[j+N]=C.params[E+j],C.hasSubParams(E+j)){let K=C.getSubParams(E+j),q=0;do R[1]===5&&(N=1),R[j+q+1+N]=K[q];while(++q<K.length&&q+j+1+N<R.length);break}if(R[1]===5&&j+N>=2||R[1]===2&&j+N>=5)break;R[1]&&(N=1)}while(++j+E<C.length&&j+N<R.length);for(let K=2;K<R.length;++K)R[K]===-1&&(R[K]=0);switch(R[0]){case 38:A.fg=this._updateAttrColor(A.fg,R[1],R[3],R[4],R[5]);break;case 48:A.bg=this._updateAttrColor(A.bg,R[1],R[3],R[4],R[5]);break;case 58:A.extended=A.extended.clone(),A.extended.underlineColor=this._updateAttrColor(A.extended.underlineColor,R[1],R[3],R[4],R[5])}return j}_processUnderline(C,E){E.extended=E.extended.clone(),(!~C||C>5)&&(C=1),E.extended.underlineStyle=C,E.fg|=268435456,C===0&&(E.fg&=-268435457),E.updateExtended()}_processSGR0(C){C.fg=o.DEFAULT_ATTR_DATA.fg,C.bg=o.DEFAULT_ATTR_DATA.bg,C.extended=C.extended.clone(),C.extended.underlineStyle=0,C.extended.underlineColor&=-67108864,C.updateExtended()}charAttributes(C){if(C.length===1&&C.params[0]===0)return this._processSGR0(this._curAttrData),!0;let E=C.length,A,R=this._curAttrData;for(let N=0;N<E;N++)A=C.params[N],A>=30&&A<=37?(R.fg&=-50331904,R.fg|=16777216|A-30):A>=40&&A<=47?(R.bg&=-50331904,R.bg|=16777216|A-40):A>=90&&A<=97?(R.fg&=-50331904,R.fg|=16777224|A-90):A>=100&&A<=107?(R.bg&=-50331904,R.bg|=16777224|A-100):A===0?this._processSGR0(R):A===1?R.fg|=134217728:A===3?R.bg|=67108864:A===4?(R.fg|=268435456,this._processUnderline(C.hasSubParams(N)?C.getSubParams(N)[0]:1,R)):A===5?R.fg|=536870912:A===7?R.fg|=67108864:A===8?R.fg|=1073741824:A===9?R.fg|=2147483648:A===2?R.bg|=134217728:A===21?this._processUnderline(2,R):A===22?(R.fg&=-134217729,R.bg&=-134217729):A===23?R.bg&=-67108865:A===24?(R.fg&=-268435457,this._processUnderline(0,R)):A===25?R.fg&=-536870913:A===27?R.fg&=-67108865:A===28?R.fg&=-1073741825:A===29?R.fg&=2147483647:A===39?(R.fg&=-67108864,R.fg|=16777215&o.DEFAULT_ATTR_DATA.fg):A===49?(R.bg&=-67108864,R.bg|=16777215&o.DEFAULT_ATTR_DATA.bg):A===38||A===48||A===58?N+=this._extractColor(C,N,R):A===53?R.bg|=1073741824:A===55?R.bg&=-1073741825:A===59?(R.extended=R.extended.clone(),R.extended.underlineColor=-1,R.updateExtended()):A===100?(R.fg&=-67108864,R.fg|=16777215&o.DEFAULT_ATTR_DATA.fg,R.bg&=-67108864,R.bg|=16777215&o.DEFAULT_ATTR_DATA.bg):this._logService.debug("Unknown SGR attribute: %d.",A);return!0}deviceStatus(C){switch(C.params[0]){case 5:this._coreService.triggerDataEvent(`${d.C0.ESC}[0n`);break;case 6:let E=this._activeBuffer.y+1,A=this._activeBuffer.x+1;this._coreService.triggerDataEvent(`${d.C0.ESC}[${E};${A}R`)}return!0}deviceStatusPrivate(C){if(C.params[0]===6){let E=this._activeBuffer.y+1,A=this._activeBuffer.x+1;this._coreService.triggerDataEvent(`${d.C0.ESC}[?${E};${A}R`)}return!0}softReset(C){return this._coreService.isCursorHidden=!1,this._onRequestSyncScrollBar.fire(),this._activeBuffer.scrollTop=0,this._activeBuffer.scrollBottom=this._bufferService.rows-1,this._curAttrData=o.DEFAULT_ATTR_DATA.clone(),this._coreService.reset(),this._charsetService.reset(),this._activeBuffer.savedX=0,this._activeBuffer.savedY=this._activeBuffer.ybase,this._activeBuffer.savedCurAttrData.fg=this._curAttrData.fg,this._activeBuffer.savedCurAttrData.bg=this._curAttrData.bg,this._activeBuffer.savedCharset=this._charsetService.charset,this._coreService.decPrivateModes.origin=!1,!0}setCursorStyle(C){let E=C.params[0]||1;switch(E){case 1:case 2:this._optionsService.options.cursorStyle="block";break;case 3:case 4:this._optionsService.options.cursorStyle="underline";break;case 5:case 6:this._optionsService.options.cursorStyle="bar"}let A=E%2==1;return this._optionsService.options.cursorBlink=A,!0}setScrollRegion(C){let E=C.params[0]||1,A;return(C.length<2||(A=C.params[1])>this._bufferService.rows||A===0)&&(A=this._bufferService.rows),A>E&&(this._activeBuffer.scrollTop=E-1,this._activeBuffer.scrollBottom=A-1,this._setCursor(0,0)),!0}windowOptions(C){if(!O(C.params[0],this._optionsService.rawOptions.windowOptions))return!0;let E=C.length>1?C.params[1]:0;switch(C.params[0]){case 14:E!==2&&this._onRequestWindowsOptionsReport.fire(D.GET_WIN_SIZE_PIXELS);break;case 16:this._onRequestWindowsOptionsReport.fire(D.GET_CELL_SIZE_PIXELS);break;case 18:this._bufferService&&this._coreService.triggerDataEvent(`${d.C0.ESC}[8;${this._bufferService.rows};${this._bufferService.cols}t`);break;case 22:E!==0&&E!==2||(this._windowTitleStack.push(this._windowTitle),this._windowTitleStack.length>10&&this._windowTitleStack.shift()),E!==0&&E!==1||(this._iconNameStack.push(this._iconName),this._iconNameStack.length>10&&this._iconNameStack.shift());break;case 23:E!==0&&E!==2||this._windowTitleStack.length&&this.setTitle(this._windowTitleStack.pop()),E!==0&&E!==1||this._iconNameStack.length&&this.setIconName(this._iconNameStack.pop())}return!0}saveCursor(C){return this._activeBuffer.savedX=this._activeBuffer.x,this._activeBuffer.savedY=this._activeBuffer.ybase+this._activeBuffer.y,this._activeBuffer.savedCurAttrData.fg=this._curAttrData.fg,this._activeBuffer.savedCurAttrData.bg=this._curAttrData.bg,this._activeBuffer.savedCharset=this._charsetService.charset,!0}restoreCursor(C){return this._activeBuffer.x=this._activeBuffer.savedX||0,this._activeBuffer.y=Math.max(this._activeBuffer.savedY-this._activeBuffer.ybase,0),this._curAttrData.fg=this._activeBuffer.savedCurAttrData.fg,this._curAttrData.bg=this._activeBuffer.savedCurAttrData.bg,this._charsetService.charset=this._savedCharset,this._activeBuffer.savedCharset&&(this._charsetService.charset=this._activeBuffer.savedCharset),this._restrictCursor(),!0}setTitle(C){return this._windowTitle=C,this._onTitleChange.fire(C),!0}setIconName(C){return this._iconName=C,!0}setOrReportIndexedColor(C){let E=[],A=C.split(";");for(;A.length>1;){let R=A.shift(),N=A.shift();if(/^\d+$/.exec(R)){let j=parseInt(R);if(M(j))if(N==="?")E.push({type:0,index:j});else{let K=(0,m.parseColor)(N);K&&E.push({type:1,index:j,color:K})}}}return E.length&&this._onColor.fire(E),!0}setHyperlink(C){let E=C.split(";");return!(E.length<2)&&(E[1]?this._createHyperlink(E[0],E[1]):!E[0]&&this._finishHyperlink())}_createHyperlink(C,E){this._getCurrentLinkId()&&this._finishHyperlink();let A=C.split(":"),R,N=A.findIndex((j=>j.startsWith("id=")));return N!==-1&&(R=A[N].slice(3)||void 0),this._curAttrData.extended=this._curAttrData.extended.clone(),this._curAttrData.extended.urlId=this._oscLinkService.registerLink({id:R,uri:E}),this._curAttrData.updateExtended(),!0}_finishHyperlink(){return this._curAttrData.extended=this._curAttrData.extended.clone(),this._curAttrData.extended.urlId=0,this._curAttrData.updateExtended(),!0}_setOrReportSpecialColor(C,E){let A=C.split(";");for(let R=0;R<A.length&&!(E>=this._specialColors.length);++R,++E)if(A[R]==="?")this._onColor.fire([{type:0,index:this._specialColors[E]}]);else{let N=(0,m.parseColor)(A[R]);N&&this._onColor.fire([{type:1,index:this._specialColors[E],color:N}])}return!0}setOrReportFgColor(C){return this._setOrReportSpecialColor(C,0)}setOrReportBgColor(C){return this._setOrReportSpecialColor(C,1)}setOrReportCursorColor(C){return this._setOrReportSpecialColor(C,2)}restoreIndexedColor(C){if(!C)return this._onColor.fire([{type:2}]),!0;let E=[],A=C.split(";");for(let R=0;R<A.length;++R)if(/^\d+$/.exec(A[R])){let N=parseInt(A[R]);M(N)&&E.push({type:2,index:N})}return E.length&&this._onColor.fire(E),!0}restoreFgColor(C){return this._onColor.fire([{type:2,index:256}]),!0}restoreBgColor(C){return this._onColor.fire([{type:2,index:257}]),!0}restoreCursorColor(C){return this._onColor.fire([{type:2,index:258}]),!0}nextLine(){return this._activeBuffer.x=0,this.index(),!0}keypadApplicationMode(){return this._logService.debug("Serial port requested application keypad."),this._coreService.decPrivateModes.applicationKeypad=!0,this._onRequestSyncScrollBar.fire(),!0}keypadNumericMode(){return this._logService.debug("Switching back to normal keypad."),this._coreService.decPrivateModes.applicationKeypad=!1,this._onRequestSyncScrollBar.fire(),!0}selectDefaultCharset(){return this._charsetService.setgLevel(0),this._charsetService.setgCharset(0,f.DEFAULT_CHARSET),!0}selectCharset(C){return C.length!==2?(this.selectDefaultCharset(),!0):(C[0]==="/"||this._charsetService.setgCharset(S[C[0]],f.CHARSETS[C[1]]||f.DEFAULT_CHARSET),!0)}index(){return this._restrictCursor(),this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData())):this._activeBuffer.y>=this._bufferService.rows&&(this._activeBuffer.y=this._bufferService.rows-1),this._restrictCursor(),!0}tabSet(){return this._activeBuffer.tabs[this._activeBuffer.x]=!0,!0}reverseIndex(){if(this._restrictCursor(),this._activeBuffer.y===this._activeBuffer.scrollTop){let C=this._activeBuffer.scrollBottom-this._activeBuffer.scrollTop;this._activeBuffer.lines.shiftElements(this._activeBuffer.ybase+this._activeBuffer.y,C,1),this._activeBuffer.lines.set(this._activeBuffer.ybase+this._activeBuffer.y,this._activeBuffer.getBlankLine(this._eraseAttrData())),this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom)}else this._activeBuffer.y--,this._restrictCursor();return!0}fullReset(){return this._parser.reset(),this._onRequestReset.fire(),!0}reset(){this._curAttrData=o.DEFAULT_ATTR_DATA.clone(),this._eraseAttrDataInternal=o.DEFAULT_ATTR_DATA.clone()}_eraseAttrData(){return this._eraseAttrDataInternal.bg&=-67108864,this._eraseAttrDataInternal.bg|=67108863&this._curAttrData.bg,this._eraseAttrDataInternal}setgLevel(C){return this._charsetService.setgLevel(C),!0}screenAlignmentPattern(){let C=new h.CellData;C.content=4194373,C.fg=this._curAttrData.fg,C.bg=this._curAttrData.bg,this._setCursor(0,0);for(let E=0;E<this._bufferService.rows;++E){let A=this._activeBuffer.ybase+this._activeBuffer.y+E,R=this._activeBuffer.lines.get(A);R&&(R.fill(C),R.isWrapped=!1)}return this._dirtyRowTracker.markAllDirty(),this._setCursor(0,0),!0}requestStatusString(C,E){let A=this._bufferService.buffer,R=this._optionsService.rawOptions;return(N=>(this._coreService.triggerDataEvent(`${d.C0.ESC}${N}${d.C0.ESC}\\`),!0))(C==='"q'?`P1$r${this._curAttrData.isProtected()?1:0}"q`:C==='"p'?'P1$r61;1"p':C==="r"?`P1$r${A.scrollTop+1};${A.scrollBottom+1}r`:C==="m"?"P1$r0m":C===" q"?`P1$r${{block:2,underline:4,bar:6}[R.cursorStyle]-(R.cursorBlink?1:0)} q`:"P0$r")}markRangeDirty(C,E){this._dirtyRowTracker.markRangeDirty(C,E)}}i.InputHandler=F;let P=class{constructor(I){this._bufferService=I,this.clearRange()}clearRange(){this.start=this._bufferService.buffer.y,this.end=this._bufferService.buffer.y}markDirty(I){I<this.start?this.start=I:I>this.end&&(this.end=I)}markRangeDirty(I,C){I>C&&(B=I,I=C,C=B),I<this.start&&(this.start=I),C>this.end&&(this.end=C)}markAllDirty(){this.markRangeDirty(0,this._bufferService.rows-1)}};function M(I){return 0<=I&&I<256}P=c([p(0,g.IBufferService)],P)},844:(u,i)=>{function r(c){for(let p of c)p.dispose();c.length=0}Object.defineProperty(i,"__esModule",{value:!0}),i.getDisposeArrayDisposable=i.disposeArray=i.toDisposable=i.MutableDisposable=i.Disposable=void 0,i.Disposable=class{constructor(){this._disposables=[],this._isDisposed=!1}dispose(){this._isDisposed=!0;for(let c of this._disposables)c.dispose();this._disposables.length=0}register(c){return this._disposables.push(c),c}unregister(c){let p=this._disposables.indexOf(c);p!==-1&&this._disposables.splice(p,1)}},i.MutableDisposable=class{constructor(){this._isDisposed=!1}get value(){return this._isDisposed?void 0:this._value}set value(c){var p;this._isDisposed||c===this._value||((p=this._value)===null||p===void 0||p.dispose(),this._value=c)}clear(){this.value=void 0}dispose(){var c;this._isDisposed=!0,(c=this._value)===null||c===void 0||c.dispose(),this._value=void 0}},i.toDisposable=function(c){return{dispose:c}},i.disposeArray=r,i.getDisposeArrayDisposable=function(c){return{dispose:()=>r(c)}}},1505:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.FourKeyMap=i.TwoKeyMap=void 0;class r{constructor(){this._data={}}set(p,d,f){this._data[p]||(this._data[p]={}),this._data[p][d]=f}get(p,d){return this._data[p]?this._data[p][d]:void 0}clear(){this._data={}}}i.TwoKeyMap=r,i.FourKeyMap=class{constructor(){this._data=new r}set(c,p,d,f,v){this._data.get(c,p)||this._data.set(c,p,new r),this._data.get(c,p).set(d,f,v)}get(c,p,d,f){var v;return(v=this._data.get(c,p))===null||v===void 0?void 0:v.get(d,f)}clear(){this._data.clear()}}},6114:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.isChromeOS=i.isLinux=i.isWindows=i.isIphone=i.isIpad=i.isMac=i.getSafariVersion=i.isSafari=i.isLegacyEdge=i.isFirefox=i.isNode=void 0,i.isNode=typeof navigator>"u";let r=i.isNode?"node":navigator.userAgent,c=i.isNode?"node":navigator.platform;i.isFirefox=r.includes("Firefox"),i.isLegacyEdge=r.includes("Edge"),i.isSafari=/^((?!chrome|android).)*safari/i.test(r),i.getSafariVersion=function(){if(!i.isSafari)return 0;let p=r.match(/Version\/(\d+)/);return p===null||p.length<2?0:parseInt(p[1])},i.isMac=["Macintosh","MacIntel","MacPPC","Mac68K"].includes(c),i.isIpad=c==="iPad",i.isIphone=c==="iPhone",i.isWindows=["Windows","Win16","Win32","WinCE"].includes(c),i.isLinux=c.indexOf("Linux")>=0,i.isChromeOS=/\bCrOS\b/.test(r)},6106:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.SortedList=void 0;let r=0;i.SortedList=class{constructor(c){this._getKey=c,this._array=[]}clear(){this._array.length=0}insert(c){this._array.length!==0?(r=this._search(this._getKey(c)),this._array.splice(r,0,c)):this._array.push(c)}delete(c){if(this._array.length===0)return!1;let p=this._getKey(c);if(p===void 0||(r=this._search(p),r===-1)||this._getKey(this._array[r])!==p)return!1;do if(this._array[r]===c)return this._array.splice(r,1),!0;while(++r<this._array.length&&this._getKey(this._array[r])===p);return!1}*getKeyIterator(c){if(this._array.length!==0&&(r=this._search(c),!(r<0||r>=this._array.length)&&this._getKey(this._array[r])===c))do yield this._array[r];while(++r<this._array.length&&this._getKey(this._array[r])===c)}forEachByKey(c,p){if(this._array.length!==0&&(r=this._search(c),!(r<0||r>=this._array.length)&&this._getKey(this._array[r])===c))do p(this._array[r]);while(++r<this._array.length&&this._getKey(this._array[r])===c)}values(){return[...this._array].values()}_search(c){let p=0,d=this._array.length-1;for(;d>=p;){let f=p+d>>1,v=this._getKey(this._array[f]);if(v>c)d=f-1;else{if(!(v<c)){for(;f>0&&this._getKey(this._array[f-1])===c;)f--;return f}p=f+1}}return p}}},7226:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DebouncedIdleTask=i.IdleTaskQueue=i.PriorityTaskQueue=void 0;let c=r(6114);class p{constructor(){this._tasks=[],this._i=0}enqueue(v){this._tasks.push(v),this._start()}flush(){for(;this._i<this._tasks.length;)this._tasks[this._i]()||this._i++;this.clear()}clear(){this._idleCallback&&(this._cancelCallback(this._idleCallback),this._idleCallback=void 0),this._i=0,this._tasks.length=0}_start(){this._idleCallback||(this._idleCallback=this._requestCallback(this._process.bind(this)))}_process(v){this._idleCallback=void 0;let w=0,b=0,o=v.timeRemaining(),l=0;for(;this._i<this._tasks.length;){if(w=Date.now(),this._tasks[this._i]()||this._i++,w=Math.max(1,Date.now()-w),b=Math.max(w,b),l=v.timeRemaining(),1.5*b>l)return o-w<-20&&console.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(o-w))}ms`),void this._start();o=l}this.clear()}}class d extends p{_requestCallback(v){return setTimeout((()=>v(this._createDeadline(16))))}_cancelCallback(v){clearTimeout(v)}_createDeadline(v){let w=Date.now()+v;return{timeRemaining:()=>Math.max(0,w-Date.now())}}}i.PriorityTaskQueue=d,i.IdleTaskQueue=!c.isNode&&"requestIdleCallback"in window?class extends p{_requestCallback(f){return requestIdleCallback(f)}_cancelCallback(f){cancelIdleCallback(f)}}:d,i.DebouncedIdleTask=class{constructor(){this._queue=new i.IdleTaskQueue}set(f){this._queue.clear(),this._queue.enqueue(f)}flush(){this._queue.flush()}}},9282:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.updateWindowsModeWrappedState=void 0;let c=r(643);i.updateWindowsModeWrappedState=function(p){let d=p.buffer.lines.get(p.buffer.ybase+p.buffer.y-1),f=d?.get(p.cols-1),v=p.buffer.lines.get(p.buffer.ybase+p.buffer.y);v&&f&&(v.isWrapped=f[c.CHAR_DATA_CODE_INDEX]!==c.NULL_CELL_CODE&&f[c.CHAR_DATA_CODE_INDEX]!==c.WHITESPACE_CELL_CODE)}},3734:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ExtendedAttrs=i.AttributeData=void 0;class r{constructor(){this.fg=0,this.bg=0,this.extended=new c}static toColorRGB(d){return[d>>>16&255,d>>>8&255,255&d]}static fromColorRGB(d){return(255&d[0])<<16|(255&d[1])<<8|255&d[2]}clone(){let d=new r;return d.fg=this.fg,d.bg=this.bg,d.extended=this.extended.clone(),d}isInverse(){return 67108864&this.fg}isBold(){return 134217728&this.fg}isUnderline(){return this.hasExtendedAttrs()&&this.extended.underlineStyle!==0?1:268435456&this.fg}isBlink(){return 536870912&this.fg}isInvisible(){return 1073741824&this.fg}isItalic(){return 67108864&this.bg}isDim(){return 134217728&this.bg}isStrikethrough(){return 2147483648&this.fg}isProtected(){return 536870912&this.bg}isOverline(){return 1073741824&this.bg}getFgColorMode(){return 50331648&this.fg}getBgColorMode(){return 50331648&this.bg}isFgRGB(){return(50331648&this.fg)==50331648}isBgRGB(){return(50331648&this.bg)==50331648}isFgPalette(){return(50331648&this.fg)==16777216||(50331648&this.fg)==33554432}isBgPalette(){return(50331648&this.bg)==16777216||(50331648&this.bg)==33554432}isFgDefault(){return(50331648&this.fg)==0}isBgDefault(){return(50331648&this.bg)==0}isAttributeDefault(){return this.fg===0&&this.bg===0}getFgColor(){switch(50331648&this.fg){case 16777216:case 33554432:return 255&this.fg;case 50331648:return 16777215&this.fg;default:return-1}}getBgColor(){switch(50331648&this.bg){case 16777216:case 33554432:return 255&this.bg;case 50331648:return 16777215&this.bg;default:return-1}}hasExtendedAttrs(){return 268435456&this.bg}updateExtended(){this.extended.isEmpty()?this.bg&=-268435457:this.bg|=268435456}getUnderlineColor(){if(268435456&this.bg&&~this.extended.underlineColor)switch(50331648&this.extended.underlineColor){case 16777216:case 33554432:return 255&this.extended.underlineColor;case 50331648:return 16777215&this.extended.underlineColor;default:return this.getFgColor()}return this.getFgColor()}getUnderlineColorMode(){return 268435456&this.bg&&~this.extended.underlineColor?50331648&this.extended.underlineColor:this.getFgColorMode()}isUnderlineColorRGB(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==50331648:this.isFgRGB()}isUnderlineColorPalette(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==16777216||(50331648&this.extended.underlineColor)==33554432:this.isFgPalette()}isUnderlineColorDefault(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==0:this.isFgDefault()}getUnderlineStyle(){return 268435456&this.fg?268435456&this.bg?this.extended.underlineStyle:1:0}}i.AttributeData=r;class c{get ext(){return this._urlId?-469762049&this._ext|this.underlineStyle<<26:this._ext}set ext(d){this._ext=d}get underlineStyle(){return this._urlId?5:(469762048&this._ext)>>26}set underlineStyle(d){this._ext&=-469762049,this._ext|=d<<26&469762048}get underlineColor(){return 67108863&this._ext}set underlineColor(d){this._ext&=-67108864,this._ext|=67108863&d}get urlId(){return this._urlId}set urlId(d){this._urlId=d}constructor(d=0,f=0){this._ext=0,this._urlId=0,this._ext=d,this._urlId=f}clone(){return new c(this._ext,this._urlId)}isEmpty(){return this.underlineStyle===0&&this._urlId===0}}i.ExtendedAttrs=c},9092:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Buffer=i.MAX_BUFFER_SIZE=void 0;let c=r(6349),p=r(7226),d=r(3734),f=r(8437),v=r(4634),w=r(511),b=r(643),o=r(4863),l=r(7116);i.MAX_BUFFER_SIZE=4294967295,i.Buffer=class{constructor(a,h,_){this._hasScrollback=a,this._optionsService=h,this._bufferService=_,this.ydisp=0,this.ybase=0,this.y=0,this.x=0,this.tabs={},this.savedY=0,this.savedX=0,this.savedCurAttrData=f.DEFAULT_ATTR_DATA.clone(),this.savedCharset=l.DEFAULT_CHARSET,this.markers=[],this._nullCell=w.CellData.fromCharData([0,b.NULL_CELL_CHAR,b.NULL_CELL_WIDTH,b.NULL_CELL_CODE]),this._whitespaceCell=w.CellData.fromCharData([0,b.WHITESPACE_CELL_CHAR,b.WHITESPACE_CELL_WIDTH,b.WHITESPACE_CELL_CODE]),this._isClearing=!1,this._memoryCleanupQueue=new p.IdleTaskQueue,this._memoryCleanupPosition=0,this._cols=this._bufferService.cols,this._rows=this._bufferService.rows,this.lines=new c.CircularList(this._getCorrectBufferLength(this._rows)),this.scrollTop=0,this.scrollBottom=this._rows-1,this.setupTabStops()}getNullCell(a){return a?(this._nullCell.fg=a.fg,this._nullCell.bg=a.bg,this._nullCell.extended=a.extended):(this._nullCell.fg=0,this._nullCell.bg=0,this._nullCell.extended=new d.ExtendedAttrs),this._nullCell}getWhitespaceCell(a){return a?(this._whitespaceCell.fg=a.fg,this._whitespaceCell.bg=a.bg,this._whitespaceCell.extended=a.extended):(this._whitespaceCell.fg=0,this._whitespaceCell.bg=0,this._whitespaceCell.extended=new d.ExtendedAttrs),this._whitespaceCell}getBlankLine(a,h){return new f.BufferLine(this._bufferService.cols,this.getNullCell(a),h)}get hasScrollback(){return this._hasScrollback&&this.lines.maxLength>this._rows}get isCursorInViewport(){let a=this.ybase+this.y-this.ydisp;return a>=0&&a<this._rows}_getCorrectBufferLength(a){if(!this._hasScrollback)return a;let h=a+this._optionsService.rawOptions.scrollback;return h>i.MAX_BUFFER_SIZE?i.MAX_BUFFER_SIZE:h}fillViewportRows(a){if(this.lines.length===0){a===void 0&&(a=f.DEFAULT_ATTR_DATA);let h=this._rows;for(;h--;)this.lines.push(this.getBlankLine(a))}}clear(){this.ydisp=0,this.ybase=0,this.y=0,this.x=0,this.lines=new c.CircularList(this._getCorrectBufferLength(this._rows)),this.scrollTop=0,this.scrollBottom=this._rows-1,this.setupTabStops()}resize(a,h){let _=this.getNullCell(f.DEFAULT_ATTR_DATA),g=0,y=this._getCorrectBufferLength(h);if(y>this.lines.maxLength&&(this.lines.maxLength=y),this.lines.length>0){if(this._cols<a)for(let m=0;m<this.lines.length;m++)g+=+this.lines.get(m).resize(a,_);let x=0;if(this._rows<h)for(let m=this._rows;m<h;m++)this.lines.length<h+this.ybase&&(this._optionsService.rawOptions.windowsMode||this._optionsService.rawOptions.windowsPty.backend!==void 0||this._optionsService.rawOptions.windowsPty.buildNumber!==void 0?this.lines.push(new f.BufferLine(a,_)):this.ybase>0&&this.lines.length<=this.ybase+this.y+x+1?(this.ybase--,x++,this.ydisp>0&&this.ydisp--):this.lines.push(new f.BufferLine(a,_)));else for(let m=this._rows;m>h;m--)this.lines.length>h+this.ybase&&(this.lines.length>this.ybase+this.y+1?this.lines.pop():(this.ybase++,this.ydisp++));if(y<this.lines.maxLength){let m=this.lines.length-y;m>0&&(this.lines.trimStart(m),this.ybase=Math.max(this.ybase-m,0),this.ydisp=Math.max(this.ydisp-m,0),this.savedY=Math.max(this.savedY-m,0)),this.lines.maxLength=y}this.x=Math.min(this.x,a-1),this.y=Math.min(this.y,h-1),x&&(this.y+=x),this.savedX=Math.min(this.savedX,a-1),this.scrollTop=0}if(this.scrollBottom=h-1,this._isReflowEnabled&&(this._reflow(a,h),this._cols>a))for(let x=0;x<this.lines.length;x++)g+=+this.lines.get(x).resize(a,_);this._cols=a,this._rows=h,this._memoryCleanupQueue.clear(),g>.1*this.lines.length&&(this._memoryCleanupPosition=0,this._memoryCleanupQueue.enqueue((()=>this._batchedMemoryCleanup())))}_batchedMemoryCleanup(){let a=!0;this._memoryCleanupPosition>=this.lines.length&&(this._memoryCleanupPosition=0,a=!1);let h=0;for(;this._memoryCleanupPosition<this.lines.length;)if(h+=this.lines.get(this._memoryCleanupPosition++).cleanupMemory(),h>100)return!0;return a}get _isReflowEnabled(){let a=this._optionsService.rawOptions.windowsPty;return a&&a.buildNumber?this._hasScrollback&&a.backend==="conpty"&&a.buildNumber>=21376:this._hasScrollback&&!this._optionsService.rawOptions.windowsMode}_reflow(a,h){this._cols!==a&&(a>this._cols?this._reflowLarger(a,h):this._reflowSmaller(a,h))}_reflowLarger(a,h){let _=(0,v.reflowLargerGetLinesToRemove)(this.lines,this._cols,a,this.ybase+this.y,this.getNullCell(f.DEFAULT_ATTR_DATA));if(_.length>0){let g=(0,v.reflowLargerCreateNewLayout)(this.lines,_);(0,v.reflowLargerApplyNewLayout)(this.lines,g.layout),this._reflowLargerAdjustViewport(a,h,g.countRemoved)}}_reflowLargerAdjustViewport(a,h,_){let g=this.getNullCell(f.DEFAULT_ATTR_DATA),y=_;for(;y-- >0;)this.ybase===0?(this.y>0&&this.y--,this.lines.length<h&&this.lines.push(new f.BufferLine(a,g))):(this.ydisp===this.ybase&&this.ydisp--,this.ybase--);this.savedY=Math.max(this.savedY-_,0)}_reflowSmaller(a,h){let _=this.getNullCell(f.DEFAULT_ATTR_DATA),g=[],y=0;for(let x=this.lines.length-1;x>=0;x--){let m=this.lines.get(x);if(!m||!m.isWrapped&&m.getTrimmedLength()<=a)continue;let S=[m];for(;m.isWrapped&&x>0;)m=this.lines.get(--x),S.unshift(m);let L=this.ybase+this.y;if(L>=x&&L<x+S.length)continue;let O=S[S.length-1].getTrimmedLength(),D=(0,v.reflowSmallerGetNewLineLengths)(S,this._cols,a),B=D.length-S.length,F;F=this.ybase===0&&this.y!==this.lines.length-1?Math.max(0,this.y-this.lines.maxLength+B):Math.max(0,this.lines.length-this.lines.maxLength+B);let P=[];for(let R=0;R<B;R++){let N=this.getBlankLine(f.DEFAULT_ATTR_DATA,!0);P.push(N)}P.length>0&&(g.push({start:x+S.length+y,newLines:P}),y+=P.length),S.push(...P);let M=D.length-1,I=D[M];I===0&&(M--,I=D[M]);let C=S.length-B-1,E=O;for(;C>=0;){let R=Math.min(E,I);if(S[M]===void 0)break;if(S[M].copyCellsFrom(S[C],E-R,I-R,R,!0),I-=R,I===0&&(M--,I=D[M]),E-=R,E===0){C--;let N=Math.max(C,0);E=(0,v.getWrappedLineTrimmedLength)(S,N,this._cols)}}for(let R=0;R<S.length;R++)D[R]<a&&S[R].setCell(D[R],_);let A=B-F;for(;A-- >0;)this.ybase===0?this.y<h-1?(this.y++,this.lines.pop()):(this.ybase++,this.ydisp++):this.ybase<Math.min(this.lines.maxLength,this.lines.length+y)-h&&(this.ybase===this.ydisp&&this.ydisp++,this.ybase++);this.savedY=Math.min(this.savedY+B,this.ybase+h-1)}if(g.length>0){let x=[],m=[];for(let M=0;M<this.lines.length;M++)m.push(this.lines.get(M));let S=this.lines.length,L=S-1,O=0,D=g[O];this.lines.length=Math.min(this.lines.maxLength,this.lines.length+y);let B=0;for(let M=Math.min(this.lines.maxLength-1,S+y-1);M>=0;M--)if(D&&D.start>L+B){for(let I=D.newLines.length-1;I>=0;I--)this.lines.set(M--,D.newLines[I]);M++,x.push({index:L+1,amount:D.newLines.length}),B+=D.newLines.length,D=g[++O]}else this.lines.set(M,m[L--]);let F=0;for(let M=x.length-1;M>=0;M--)x[M].index+=F,this.lines.onInsertEmitter.fire(x[M]),F+=x[M].amount;let P=Math.max(0,S+y-this.lines.maxLength);P>0&&this.lines.onTrimEmitter.fire(P)}}translateBufferLineToString(a,h,_=0,g){let y=this.lines.get(a);return y?y.translateToString(h,_,g):""}getWrappedRangeForLine(a){let h=a,_=a;for(;h>0&&this.lines.get(h).isWrapped;)h--;for(;_+1<this.lines.length&&this.lines.get(_+1).isWrapped;)_++;return{first:h,last:_}}setupTabStops(a){for(a!=null?this.tabs[a]||(a=this.prevStop(a)):(this.tabs={},a=0);a<this._cols;a+=this._optionsService.rawOptions.tabStopWidth)this.tabs[a]=!0}prevStop(a){for(a==null&&(a=this.x);!this.tabs[--a]&&a>0;);return a>=this._cols?this._cols-1:a<0?0:a}nextStop(a){for(a==null&&(a=this.x);!this.tabs[++a]&&a<this._cols;);return a>=this._cols?this._cols-1:a<0?0:a}clearMarkers(a){this._isClearing=!0;for(let h=0;h<this.markers.length;h++)this.markers[h].line===a&&(this.markers[h].dispose(),this.markers.splice(h--,1));this._isClearing=!1}clearAllMarkers(){this._isClearing=!0;for(let a=0;a<this.markers.length;a++)this.markers[a].dispose(),this.markers.splice(a--,1);this._isClearing=!1}addMarker(a){let h=new o.Marker(a);return this.markers.push(h),h.register(this.lines.onTrim((_=>{h.line-=_,h.line<0&&h.dispose()}))),h.register(this.lines.onInsert((_=>{h.line>=_.index&&(h.line+=_.amount)}))),h.register(this.lines.onDelete((_=>{h.line>=_.index&&h.line<_.index+_.amount&&h.dispose(),h.line>_.index&&(h.line-=_.amount)}))),h.register(h.onDispose((()=>this._removeMarker(h)))),h}_removeMarker(a){this._isClearing||this.markers.splice(this.markers.indexOf(a),1)}}},8437:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferLine=i.DEFAULT_ATTR_DATA=void 0;let c=r(3734),p=r(511),d=r(643),f=r(482);i.DEFAULT_ATTR_DATA=Object.freeze(new c.AttributeData);let v=0;class w{constructor(o,l,a=!1){this.isWrapped=a,this._combined={},this._extendedAttrs={},this._data=new Uint32Array(3*o);let h=l||p.CellData.fromCharData([0,d.NULL_CELL_CHAR,d.NULL_CELL_WIDTH,d.NULL_CELL_CODE]);for(let _=0;_<o;++_)this.setCell(_,h);this.length=o}get(o){let l=this._data[3*o+0],a=2097151&l;return[this._data[3*o+1],2097152&l?this._combined[o]:a?(0,f.stringFromCodePoint)(a):"",l>>22,2097152&l?this._combined[o].charCodeAt(this._combined[o].length-1):a]}set(o,l){this._data[3*o+1]=l[d.CHAR_DATA_ATTR_INDEX],l[d.CHAR_DATA_CHAR_INDEX].length>1?(this._combined[o]=l[1],this._data[3*o+0]=2097152|o|l[d.CHAR_DATA_WIDTH_INDEX]<<22):this._data[3*o+0]=l[d.CHAR_DATA_CHAR_INDEX].charCodeAt(0)|l[d.CHAR_DATA_WIDTH_INDEX]<<22}getWidth(o){return this._data[3*o+0]>>22}hasWidth(o){return 12582912&this._data[3*o+0]}getFg(o){return this._data[3*o+1]}getBg(o){return this._data[3*o+2]}hasContent(o){return 4194303&this._data[3*o+0]}getCodePoint(o){let l=this._data[3*o+0];return 2097152&l?this._combined[o].charCodeAt(this._combined[o].length-1):2097151&l}isCombined(o){return 2097152&this._data[3*o+0]}getString(o){let l=this._data[3*o+0];return 2097152&l?this._combined[o]:2097151&l?(0,f.stringFromCodePoint)(2097151&l):""}isProtected(o){return 536870912&this._data[3*o+2]}loadCell(o,l){return v=3*o,l.content=this._data[v+0],l.fg=this._data[v+1],l.bg=this._data[v+2],2097152&l.content&&(l.combinedData=this._combined[o]),268435456&l.bg&&(l.extended=this._extendedAttrs[o]),l}setCell(o,l){2097152&l.content&&(this._combined[o]=l.combinedData),268435456&l.bg&&(this._extendedAttrs[o]=l.extended),this._data[3*o+0]=l.content,this._data[3*o+1]=l.fg,this._data[3*o+2]=l.bg}setCellFromCodePoint(o,l,a,h,_,g){268435456&_&&(this._extendedAttrs[o]=g),this._data[3*o+0]=l|a<<22,this._data[3*o+1]=h,this._data[3*o+2]=_}addCodepointToCell(o,l){let a=this._data[3*o+0];2097152&a?this._combined[o]+=(0,f.stringFromCodePoint)(l):(2097151&a?(this._combined[o]=(0,f.stringFromCodePoint)(2097151&a)+(0,f.stringFromCodePoint)(l),a&=-2097152,a|=2097152):a=l|4194304,this._data[3*o+0]=a)}insertCells(o,l,a,h){if((o%=this.length)&&this.getWidth(o-1)===2&&this.setCellFromCodePoint(o-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs),l<this.length-o){let _=new p.CellData;for(let g=this.length-o-l-1;g>=0;--g)this.setCell(o+l+g,this.loadCell(o+g,_));for(let g=0;g<l;++g)this.setCell(o+g,a)}else for(let _=o;_<this.length;++_)this.setCell(_,a);this.getWidth(this.length-1)===2&&this.setCellFromCodePoint(this.length-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs)}deleteCells(o,l,a,h){if(o%=this.length,l<this.length-o){let _=new p.CellData;for(let g=0;g<this.length-o-l;++g)this.setCell(o+g,this.loadCell(o+l+g,_));for(let g=this.length-l;g<this.length;++g)this.setCell(g,a)}else for(let _=o;_<this.length;++_)this.setCell(_,a);o&&this.getWidth(o-1)===2&&this.setCellFromCodePoint(o-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs),this.getWidth(o)!==0||this.hasContent(o)||this.setCellFromCodePoint(o,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs)}replaceCells(o,l,a,h,_=!1){if(_)for(o&&this.getWidth(o-1)===2&&!this.isProtected(o-1)&&this.setCellFromCodePoint(o-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs),l<this.length&&this.getWidth(l-1)===2&&!this.isProtected(l)&&this.setCellFromCodePoint(l,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs);o<l&&o<this.length;)this.isProtected(o)||this.setCell(o,a),o++;else for(o&&this.getWidth(o-1)===2&&this.setCellFromCodePoint(o-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs),l<this.length&&this.getWidth(l-1)===2&&this.setCellFromCodePoint(l,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs);o<l&&o<this.length;)this.setCell(o++,a)}resize(o,l){if(o===this.length)return 4*this._data.length*2<this._data.buffer.byteLength;let a=3*o;if(o>this.length){if(this._data.buffer.byteLength>=4*a)this._data=new Uint32Array(this._data.buffer,0,a);else{let h=new Uint32Array(a);h.set(this._data),this._data=h}for(let h=this.length;h<o;++h)this.setCell(h,l)}else{this._data=this._data.subarray(0,a);let h=Object.keys(this._combined);for(let g=0;g<h.length;g++){let y=parseInt(h[g],10);y>=o&&delete this._combined[y]}let _=Object.keys(this._extendedAttrs);for(let g=0;g<_.length;g++){let y=parseInt(_[g],10);y>=o&&delete this._extendedAttrs[y]}}return this.length=o,4*a*2<this._data.buffer.byteLength}cleanupMemory(){if(4*this._data.length*2<this._data.buffer.byteLength){let o=new Uint32Array(this._data.length);return o.set(this._data),this._data=o,1}return 0}fill(o,l=!1){if(l)for(let a=0;a<this.length;++a)this.isProtected(a)||this.setCell(a,o);else{this._combined={},this._extendedAttrs={};for(let a=0;a<this.length;++a)this.setCell(a,o)}}copyFrom(o){this.length!==o.length?this._data=new Uint32Array(o._data):this._data.set(o._data),this.length=o.length,this._combined={};for(let l in o._combined)this._combined[l]=o._combined[l];this._extendedAttrs={};for(let l in o._extendedAttrs)this._extendedAttrs[l]=o._extendedAttrs[l];this.isWrapped=o.isWrapped}clone(){let o=new w(0);o._data=new Uint32Array(this._data),o.length=this.length;for(let l in this._combined)o._combined[l]=this._combined[l];for(let l in this._extendedAttrs)o._extendedAttrs[l]=this._extendedAttrs[l];return o.isWrapped=this.isWrapped,o}getTrimmedLength(){for(let o=this.length-1;o>=0;--o)if(4194303&this._data[3*o+0])return o+(this._data[3*o+0]>>22);return 0}getNoBgTrimmedLength(){for(let o=this.length-1;o>=0;--o)if(4194303&this._data[3*o+0]||50331648&this._data[3*o+2])return o+(this._data[3*o+0]>>22);return 0}copyCellsFrom(o,l,a,h,_){let g=o._data;if(_)for(let x=h-1;x>=0;x--){for(let m=0;m<3;m++)this._data[3*(a+x)+m]=g[3*(l+x)+m];268435456&g[3*(l+x)+2]&&(this._extendedAttrs[a+x]=o._extendedAttrs[l+x])}else for(let x=0;x<h;x++){for(let m=0;m<3;m++)this._data[3*(a+x)+m]=g[3*(l+x)+m];268435456&g[3*(l+x)+2]&&(this._extendedAttrs[a+x]=o._extendedAttrs[l+x])}let y=Object.keys(o._combined);for(let x=0;x<y.length;x++){let m=parseInt(y[x],10);m>=l&&(this._combined[m-l+a]=o._combined[m])}}translateToString(o=!1,l=0,a=this.length){o&&(a=Math.min(a,this.getTrimmedLength()));let h="";for(;l<a;){let _=this._data[3*l+0],g=2097151&_;h+=2097152&_?this._combined[l]:g?(0,f.stringFromCodePoint)(g):d.WHITESPACE_CELL_CHAR,l+=_>>22||1}return h}}i.BufferLine=w},4841:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.getRangeLength=void 0,i.getRangeLength=function(r,c){if(r.start.y>r.end.y)throw new Error(`Buffer range end (${r.end.x}, ${r.end.y}) cannot be before start (${r.start.x}, ${r.start.y})`);return c*(r.end.y-r.start.y)+(r.end.x-r.start.x+1)}},4634:(u,i)=>{function r(c,p,d){if(p===c.length-1)return c[p].getTrimmedLength();let f=!c[p].hasContent(d-1)&&c[p].getWidth(d-1)===1,v=c[p+1].getWidth(0)===2;return f&&v?d-1:d}Object.defineProperty(i,"__esModule",{value:!0}),i.getWrappedLineTrimmedLength=i.reflowSmallerGetNewLineLengths=i.reflowLargerApplyNewLayout=i.reflowLargerCreateNewLayout=i.reflowLargerGetLinesToRemove=void 0,i.reflowLargerGetLinesToRemove=function(c,p,d,f,v){let w=[];for(let b=0;b<c.length-1;b++){let o=b,l=c.get(++o);if(!l.isWrapped)continue;let a=[c.get(b)];for(;o<c.length&&l.isWrapped;)a.push(l),l=c.get(++o);if(f>=b&&f<o){b+=a.length-1;continue}let h=0,_=r(a,h,p),g=1,y=0;for(;g<a.length;){let m=r(a,g,p),S=m-y,L=d-_,O=Math.min(S,L);a[h].copyCellsFrom(a[g],y,_,O,!1),_+=O,_===d&&(h++,_=0),y+=O,y===m&&(g++,y=0),_===0&&h!==0&&a[h-1].getWidth(d-1)===2&&(a[h].copyCellsFrom(a[h-1],d-1,_++,1,!1),a[h-1].setCell(d-1,v))}a[h].replaceCells(_,d,v);let x=0;for(let m=a.length-1;m>0&&(m>h||a[m].getTrimmedLength()===0);m--)x++;x>0&&(w.push(b+a.length-x),w.push(x)),b+=a.length-1}return w},i.reflowLargerCreateNewLayout=function(c,p){let d=[],f=0,v=p[f],w=0;for(let b=0;b<c.length;b++)if(v===b){let o=p[++f];c.onDeleteEmitter.fire({index:b-w,amount:o}),b+=o-1,w+=o,v=p[++f]}else d.push(b);return{layout:d,countRemoved:w}},i.reflowLargerApplyNewLayout=function(c,p){let d=[];for(let f=0;f<p.length;f++)d.push(c.get(p[f]));for(let f=0;f<d.length;f++)c.set(f,d[f]);c.length=p.length},i.reflowSmallerGetNewLineLengths=function(c,p,d){let f=[],v=c.map(((l,a)=>r(c,a,p))).reduce(((l,a)=>l+a)),w=0,b=0,o=0;for(;o<v;){if(v-o<d){f.push(v-o);break}w+=d;let l=r(c,b,p);w>l&&(w-=l,b++);let a=c[b].getWidth(w-1)===2;a&&w--;let h=a?d-1:d;f.push(h),o+=h}return f},i.getWrappedLineTrimmedLength=r},5295:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferSet=void 0;let c=r(8460),p=r(844),d=r(9092);class f extends p.Disposable{constructor(w,b){super(),this._optionsService=w,this._bufferService=b,this._onBufferActivate=this.register(new c.EventEmitter),this.onBufferActivate=this._onBufferActivate.event,this.reset(),this.register(this._optionsService.onSpecificOptionChange("scrollback",(()=>this.resize(this._bufferService.cols,this._bufferService.rows)))),this.register(this._optionsService.onSpecificOptionChange("tabStopWidth",(()=>this.setupTabStops())))}reset(){this._normal=new d.Buffer(!0,this._optionsService,this._bufferService),this._normal.fillViewportRows(),this._alt=new d.Buffer(!1,this._optionsService,this._bufferService),this._activeBuffer=this._normal,this._onBufferActivate.fire({activeBuffer:this._normal,inactiveBuffer:this._alt}),this.setupTabStops()}get alt(){return this._alt}get active(){return this._activeBuffer}get normal(){return this._normal}activateNormalBuffer(){this._activeBuffer!==this._normal&&(this._normal.x=this._alt.x,this._normal.y=this._alt.y,this._alt.clearAllMarkers(),this._alt.clear(),this._activeBuffer=this._normal,this._onBufferActivate.fire({activeBuffer:this._normal,inactiveBuffer:this._alt}))}activateAltBuffer(w){this._activeBuffer!==this._alt&&(this._alt.fillViewportRows(w),this._alt.x=this._normal.x,this._alt.y=this._normal.y,this._activeBuffer=this._alt,this._onBufferActivate.fire({activeBuffer:this._alt,inactiveBuffer:this._normal}))}resize(w,b){this._normal.resize(w,b),this._alt.resize(w,b),this.setupTabStops(w)}setupTabStops(w){this._normal.setupTabStops(w),this._alt.setupTabStops(w)}}i.BufferSet=f},511:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CellData=void 0;let c=r(482),p=r(643),d=r(3734);class f extends d.AttributeData{constructor(){super(...arguments),this.content=0,this.fg=0,this.bg=0,this.extended=new d.ExtendedAttrs,this.combinedData=""}static fromCharData(w){let b=new f;return b.setFromCharData(w),b}isCombined(){return 2097152&this.content}getWidth(){return this.content>>22}getChars(){return 2097152&this.content?this.combinedData:2097151&this.content?(0,c.stringFromCodePoint)(2097151&this.content):""}getCode(){return this.isCombined()?this.combinedData.charCodeAt(this.combinedData.length-1):2097151&this.content}setFromCharData(w){this.fg=w[p.CHAR_DATA_ATTR_INDEX],this.bg=0;let b=!1;if(w[p.CHAR_DATA_CHAR_INDEX].length>2)b=!0;else if(w[p.CHAR_DATA_CHAR_INDEX].length===2){let o=w[p.CHAR_DATA_CHAR_INDEX].charCodeAt(0);if(55296<=o&&o<=56319){let l=w[p.CHAR_DATA_CHAR_INDEX].charCodeAt(1);56320<=l&&l<=57343?this.content=1024*(o-55296)+l-56320+65536|w[p.CHAR_DATA_WIDTH_INDEX]<<22:b=!0}else b=!0}else this.content=w[p.CHAR_DATA_CHAR_INDEX].charCodeAt(0)|w[p.CHAR_DATA_WIDTH_INDEX]<<22;b&&(this.combinedData=w[p.CHAR_DATA_CHAR_INDEX],this.content=2097152|w[p.CHAR_DATA_WIDTH_INDEX]<<22)}getAsCharData(){return[this.fg,this.getChars(),this.getWidth(),this.getCode()]}}i.CellData=f},643:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.WHITESPACE_CELL_CODE=i.WHITESPACE_CELL_WIDTH=i.WHITESPACE_CELL_CHAR=i.NULL_CELL_CODE=i.NULL_CELL_WIDTH=i.NULL_CELL_CHAR=i.CHAR_DATA_CODE_INDEX=i.CHAR_DATA_WIDTH_INDEX=i.CHAR_DATA_CHAR_INDEX=i.CHAR_DATA_ATTR_INDEX=i.DEFAULT_EXT=i.DEFAULT_ATTR=i.DEFAULT_COLOR=void 0,i.DEFAULT_COLOR=0,i.DEFAULT_ATTR=256|i.DEFAULT_COLOR<<9,i.DEFAULT_EXT=0,i.CHAR_DATA_ATTR_INDEX=0,i.CHAR_DATA_CHAR_INDEX=1,i.CHAR_DATA_WIDTH_INDEX=2,i.CHAR_DATA_CODE_INDEX=3,i.NULL_CELL_CHAR="",i.NULL_CELL_WIDTH=1,i.NULL_CELL_CODE=0,i.WHITESPACE_CELL_CHAR=" ",i.WHITESPACE_CELL_WIDTH=1,i.WHITESPACE_CELL_CODE=32},4863:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Marker=void 0;let c=r(8460),p=r(844);class d{get id(){return this._id}constructor(v){this.line=v,this.isDisposed=!1,this._disposables=[],this._id=d._nextId++,this._onDispose=this.register(new c.EventEmitter),this.onDispose=this._onDispose.event}dispose(){this.isDisposed||(this.isDisposed=!0,this.line=-1,this._onDispose.fire(),(0,p.disposeArray)(this._disposables),this._disposables.length=0)}register(v){return this._disposables.push(v),v}}i.Marker=d,d._nextId=1},7116:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DEFAULT_CHARSET=i.CHARSETS=void 0,i.CHARSETS={},i.DEFAULT_CHARSET=i.CHARSETS.B,i.CHARSETS[0]={"`":"\u25C6",a:"\u2592",b:"\u2409",c:"\u240C",d:"\u240D",e:"\u240A",f:"\xB0",g:"\xB1",h:"\u2424",i:"\u240B",j:"\u2518",k:"\u2510",l:"\u250C",m:"\u2514",n:"\u253C",o:"\u23BA",p:"\u23BB",q:"\u2500",r:"\u23BC",s:"\u23BD",t:"\u251C",u:"\u2524",v:"\u2534",w:"\u252C",x:"\u2502",y:"\u2264",z:"\u2265","{":"\u03C0","|":"\u2260","}":"\xA3","~":"\xB7"},i.CHARSETS.A={"#":"\xA3"},i.CHARSETS.B=void 0,i.CHARSETS[4]={"#":"\xA3","@":"\xBE","[":"ij","\\":"\xBD","]":"|","{":"\xA8","|":"f","}":"\xBC","~":"\xB4"},i.CHARSETS.C=i.CHARSETS[5]={"[":"\xC4","\\":"\xD6","]":"\xC5","^":"\xDC","`":"\xE9","{":"\xE4","|":"\xF6","}":"\xE5","~":"\xFC"},i.CHARSETS.R={"#":"\xA3","@":"\xE0","[":"\xB0","\\":"\xE7","]":"\xA7","{":"\xE9","|":"\xF9","}":"\xE8","~":"\xA8"},i.CHARSETS.Q={"@":"\xE0","[":"\xE2","\\":"\xE7","]":"\xEA","^":"\xEE","`":"\xF4","{":"\xE9","|":"\xF9","}":"\xE8","~":"\xFB"},i.CHARSETS.K={"@":"\xA7","[":"\xC4","\\":"\xD6","]":"\xDC","{":"\xE4","|":"\xF6","}":"\xFC","~":"\xDF"},i.CHARSETS.Y={"#":"\xA3","@":"\xA7","[":"\xB0","\\":"\xE7","]":"\xE9","`":"\xF9","{":"\xE0","|":"\xF2","}":"\xE8","~":"\xEC"},i.CHARSETS.E=i.CHARSETS[6]={"@":"\xC4","[":"\xC6","\\":"\xD8","]":"\xC5","^":"\xDC","`":"\xE4","{":"\xE6","|":"\xF8","}":"\xE5","~":"\xFC"},i.CHARSETS.Z={"#":"\xA3","@":"\xA7","[":"\xA1","\\":"\xD1","]":"\xBF","{":"\xB0","|":"\xF1","}":"\xE7"},i.CHARSETS.H=i.CHARSETS[7]={"@":"\xC9","[":"\xC4","\\":"\xD6","]":"\xC5","^":"\xDC","`":"\xE9","{":"\xE4","|":"\xF6","}":"\xE5","~":"\xFC"},i.CHARSETS["="]={"#":"\xF9","@":"\xE0","[":"\xE9","\\":"\xE7","]":"\xEA","^":"\xEE",_:"\xE8","`":"\xF4","{":"\xE4","|":"\xF6","}":"\xFC","~":"\xFB"}},2584:(u,i)=>{var r,c,p;Object.defineProperty(i,"__esModule",{value:!0}),i.C1_ESCAPED=i.C1=i.C0=void 0,(function(d){d.NUL="\0",d.SOH="",d.STX="",d.ETX="",d.EOT="",d.ENQ="",d.ACK="",d.BEL="\x07",d.BS="\b",d.HT="	",d.LF=`
`,d.VT="\v",d.FF="\f",d.CR="\r",d.SO="",d.SI="",d.DLE="",d.DC1="",d.DC2="",d.DC3="",d.DC4="",d.NAK="",d.SYN="",d.ETB="",d.CAN="",d.EM="",d.SUB="",d.ESC="\x1B",d.FS="",d.GS="",d.RS="",d.US="",d.SP=" ",d.DEL="\x7F"})(r||(i.C0=r={})),(function(d){d.PAD="\x80",d.HOP="\x81",d.BPH="\x82",d.NBH="\x83",d.IND="\x84",d.NEL="\x85",d.SSA="\x86",d.ESA="\x87",d.HTS="\x88",d.HTJ="\x89",d.VTS="\x8A",d.PLD="\x8B",d.PLU="\x8C",d.RI="\x8D",d.SS2="\x8E",d.SS3="\x8F",d.DCS="\x90",d.PU1="\x91",d.PU2="\x92",d.STS="\x93",d.CCH="\x94",d.MW="\x95",d.SPA="\x96",d.EPA="\x97",d.SOS="\x98",d.SGCI="\x99",d.SCI="\x9A",d.CSI="\x9B",d.ST="\x9C",d.OSC="\x9D",d.PM="\x9E",d.APC="\x9F"})(c||(i.C1=c={})),(function(d){d.ST=`${r.ESC}\\`})(p||(i.C1_ESCAPED=p={}))},7399:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.evaluateKeyboardEvent=void 0;let c=r(2584),p={48:["0",")"],49:["1","!"],50:["2","@"],51:["3","#"],52:["4","$"],53:["5","%"],54:["6","^"],55:["7","&"],56:["8","*"],57:["9","("],186:[";",":"],187:["=","+"],188:[",","<"],189:["-","_"],190:[".",">"],191:["/","?"],192:["`","~"],219:["[","{"],220:["\\","|"],221:["]","}"],222:["'",'"']};i.evaluateKeyboardEvent=function(d,f,v,w){let b={type:0,cancel:!1,key:void 0},o=(d.shiftKey?1:0)|(d.altKey?2:0)|(d.ctrlKey?4:0)|(d.metaKey?8:0);switch(d.keyCode){case 0:d.key==="UIKeyInputUpArrow"?b.key=f?c.C0.ESC+"OA":c.C0.ESC+"[A":d.key==="UIKeyInputLeftArrow"?b.key=f?c.C0.ESC+"OD":c.C0.ESC+"[D":d.key==="UIKeyInputRightArrow"?b.key=f?c.C0.ESC+"OC":c.C0.ESC+"[C":d.key==="UIKeyInputDownArrow"&&(b.key=f?c.C0.ESC+"OB":c.C0.ESC+"[B");break;case 8:if(d.altKey){b.key=c.C0.ESC+c.C0.DEL;break}b.key=c.C0.DEL;break;case 9:if(d.shiftKey){b.key=c.C0.ESC+"[Z";break}b.key=c.C0.HT,b.cancel=!0;break;case 13:b.key=d.altKey?c.C0.ESC+c.C0.CR:c.C0.CR,b.cancel=!0;break;case 27:b.key=c.C0.ESC,d.altKey&&(b.key=c.C0.ESC+c.C0.ESC),b.cancel=!0;break;case 37:if(d.metaKey)break;o?(b.key=c.C0.ESC+"[1;"+(o+1)+"D",b.key===c.C0.ESC+"[1;3D"&&(b.key=c.C0.ESC+(v?"b":"[1;5D"))):b.key=f?c.C0.ESC+"OD":c.C0.ESC+"[D";break;case 39:if(d.metaKey)break;o?(b.key=c.C0.ESC+"[1;"+(o+1)+"C",b.key===c.C0.ESC+"[1;3C"&&(b.key=c.C0.ESC+(v?"f":"[1;5C"))):b.key=f?c.C0.ESC+"OC":c.C0.ESC+"[C";break;case 38:if(d.metaKey)break;o?(b.key=c.C0.ESC+"[1;"+(o+1)+"A",v||b.key!==c.C0.ESC+"[1;3A"||(b.key=c.C0.ESC+"[1;5A")):b.key=f?c.C0.ESC+"OA":c.C0.ESC+"[A";break;case 40:if(d.metaKey)break;o?(b.key=c.C0.ESC+"[1;"+(o+1)+"B",v||b.key!==c.C0.ESC+"[1;3B"||(b.key=c.C0.ESC+"[1;5B")):b.key=f?c.C0.ESC+"OB":c.C0.ESC+"[B";break;case 45:d.shiftKey||d.ctrlKey||(b.key=c.C0.ESC+"[2~");break;case 46:b.key=o?c.C0.ESC+"[3;"+(o+1)+"~":c.C0.ESC+"[3~";break;case 36:b.key=o?c.C0.ESC+"[1;"+(o+1)+"H":f?c.C0.ESC+"OH":c.C0.ESC+"[H";break;case 35:b.key=o?c.C0.ESC+"[1;"+(o+1)+"F":f?c.C0.ESC+"OF":c.C0.ESC+"[F";break;case 33:d.shiftKey?b.type=2:d.ctrlKey?b.key=c.C0.ESC+"[5;"+(o+1)+"~":b.key=c.C0.ESC+"[5~";break;case 34:d.shiftKey?b.type=3:d.ctrlKey?b.key=c.C0.ESC+"[6;"+(o+1)+"~":b.key=c.C0.ESC+"[6~";break;case 112:b.key=o?c.C0.ESC+"[1;"+(o+1)+"P":c.C0.ESC+"OP";break;case 113:b.key=o?c.C0.ESC+"[1;"+(o+1)+"Q":c.C0.ESC+"OQ";break;case 114:b.key=o?c.C0.ESC+"[1;"+(o+1)+"R":c.C0.ESC+"OR";break;case 115:b.key=o?c.C0.ESC+"[1;"+(o+1)+"S":c.C0.ESC+"OS";break;case 116:b.key=o?c.C0.ESC+"[15;"+(o+1)+"~":c.C0.ESC+"[15~";break;case 117:b.key=o?c.C0.ESC+"[17;"+(o+1)+"~":c.C0.ESC+"[17~";break;case 118:b.key=o?c.C0.ESC+"[18;"+(o+1)+"~":c.C0.ESC+"[18~";break;case 119:b.key=o?c.C0.ESC+"[19;"+(o+1)+"~":c.C0.ESC+"[19~";break;case 120:b.key=o?c.C0.ESC+"[20;"+(o+1)+"~":c.C0.ESC+"[20~";break;case 121:b.key=o?c.C0.ESC+"[21;"+(o+1)+"~":c.C0.ESC+"[21~";break;case 122:b.key=o?c.C0.ESC+"[23;"+(o+1)+"~":c.C0.ESC+"[23~";break;case 123:b.key=o?c.C0.ESC+"[24;"+(o+1)+"~":c.C0.ESC+"[24~";break;default:if(!d.ctrlKey||d.shiftKey||d.altKey||d.metaKey)if(v&&!w||!d.altKey||d.metaKey)!v||d.altKey||d.ctrlKey||d.shiftKey||!d.metaKey?d.key&&!d.ctrlKey&&!d.altKey&&!d.metaKey&&d.keyCode>=48&&d.key.length===1?b.key=d.key:d.key&&d.ctrlKey&&(d.key==="_"&&(b.key=c.C0.US),d.key==="@"&&(b.key=c.C0.NUL)):d.keyCode===65&&(b.type=1);else{let l=p[d.keyCode],a=l?.[d.shiftKey?1:0];if(a)b.key=c.C0.ESC+a;else if(d.keyCode>=65&&d.keyCode<=90){let h=d.ctrlKey?d.keyCode-64:d.keyCode+32,_=String.fromCharCode(h);d.shiftKey&&(_=_.toUpperCase()),b.key=c.C0.ESC+_}else if(d.keyCode===32)b.key=c.C0.ESC+(d.ctrlKey?c.C0.NUL:" ");else if(d.key==="Dead"&&d.code.startsWith("Key")){let h=d.code.slice(3,4);d.shiftKey||(h=h.toLowerCase()),b.key=c.C0.ESC+h,b.cancel=!0}}else d.keyCode>=65&&d.keyCode<=90?b.key=String.fromCharCode(d.keyCode-64):d.keyCode===32?b.key=c.C0.NUL:d.keyCode>=51&&d.keyCode<=55?b.key=String.fromCharCode(d.keyCode-51+27):d.keyCode===56?b.key=c.C0.DEL:d.keyCode===219?b.key=c.C0.ESC:d.keyCode===220?b.key=c.C0.FS:d.keyCode===221&&(b.key=c.C0.GS)}return b}},482:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Utf8ToUtf32=i.StringToUtf32=i.utf32ToString=i.stringFromCodePoint=void 0,i.stringFromCodePoint=function(r){return r>65535?(r-=65536,String.fromCharCode(55296+(r>>10))+String.fromCharCode(r%1024+56320)):String.fromCharCode(r)},i.utf32ToString=function(r,c=0,p=r.length){let d="";for(let f=c;f<p;++f){let v=r[f];v>65535?(v-=65536,d+=String.fromCharCode(55296+(v>>10))+String.fromCharCode(v%1024+56320)):d+=String.fromCharCode(v)}return d},i.StringToUtf32=class{constructor(){this._interim=0}clear(){this._interim=0}decode(r,c){let p=r.length;if(!p)return 0;let d=0,f=0;if(this._interim){let v=r.charCodeAt(f++);56320<=v&&v<=57343?c[d++]=1024*(this._interim-55296)+v-56320+65536:(c[d++]=this._interim,c[d++]=v),this._interim=0}for(let v=f;v<p;++v){let w=r.charCodeAt(v);if(55296<=w&&w<=56319){if(++v>=p)return this._interim=w,d;let b=r.charCodeAt(v);56320<=b&&b<=57343?c[d++]=1024*(w-55296)+b-56320+65536:(c[d++]=w,c[d++]=b)}else w!==65279&&(c[d++]=w)}return d}},i.Utf8ToUtf32=class{constructor(){this.interim=new Uint8Array(3)}clear(){this.interim.fill(0)}decode(r,c){let p=r.length;if(!p)return 0;let d,f,v,w,b=0,o=0,l=0;if(this.interim[0]){let _=!1,g=this.interim[0];g&=(224&g)==192?31:(240&g)==224?15:7;let y,x=0;for(;(y=63&this.interim[++x])&&x<4;)g<<=6,g|=y;let m=(224&this.interim[0])==192?2:(240&this.interim[0])==224?3:4,S=m-x;for(;l<S;){if(l>=p)return 0;if(y=r[l++],(192&y)!=128){l--,_=!0;break}this.interim[x++]=y,g<<=6,g|=63&y}_||(m===2?g<128?l--:c[b++]=g:m===3?g<2048||g>=55296&&g<=57343||g===65279||(c[b++]=g):g<65536||g>1114111||(c[b++]=g)),this.interim.fill(0)}let a=p-4,h=l;for(;h<p;){for(;!(!(h<a)||128&(d=r[h])||128&(f=r[h+1])||128&(v=r[h+2])||128&(w=r[h+3]));)c[b++]=d,c[b++]=f,c[b++]=v,c[b++]=w,h+=4;if(d=r[h++],d<128)c[b++]=d;else if((224&d)==192){if(h>=p)return this.interim[0]=d,b;if(f=r[h++],(192&f)!=128){h--;continue}if(o=(31&d)<<6|63&f,o<128){h--;continue}c[b++]=o}else if((240&d)==224){if(h>=p)return this.interim[0]=d,b;if(f=r[h++],(192&f)!=128){h--;continue}if(h>=p)return this.interim[0]=d,this.interim[1]=f,b;if(v=r[h++],(192&v)!=128){h--;continue}if(o=(15&d)<<12|(63&f)<<6|63&v,o<2048||o>=55296&&o<=57343||o===65279)continue;c[b++]=o}else if((248&d)==240){if(h>=p)return this.interim[0]=d,b;if(f=r[h++],(192&f)!=128){h--;continue}if(h>=p)return this.interim[0]=d,this.interim[1]=f,b;if(v=r[h++],(192&v)!=128){h--;continue}if(h>=p)return this.interim[0]=d,this.interim[1]=f,this.interim[2]=v,b;if(w=r[h++],(192&w)!=128){h--;continue}if(o=(7&d)<<18|(63&f)<<12|(63&v)<<6|63&w,o<65536||o>1114111)continue;c[b++]=o}}return b}}},225:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.UnicodeV6=void 0;let r=[[768,879],[1155,1158],[1160,1161],[1425,1469],[1471,1471],[1473,1474],[1476,1477],[1479,1479],[1536,1539],[1552,1557],[1611,1630],[1648,1648],[1750,1764],[1767,1768],[1770,1773],[1807,1807],[1809,1809],[1840,1866],[1958,1968],[2027,2035],[2305,2306],[2364,2364],[2369,2376],[2381,2381],[2385,2388],[2402,2403],[2433,2433],[2492,2492],[2497,2500],[2509,2509],[2530,2531],[2561,2562],[2620,2620],[2625,2626],[2631,2632],[2635,2637],[2672,2673],[2689,2690],[2748,2748],[2753,2757],[2759,2760],[2765,2765],[2786,2787],[2817,2817],[2876,2876],[2879,2879],[2881,2883],[2893,2893],[2902,2902],[2946,2946],[3008,3008],[3021,3021],[3134,3136],[3142,3144],[3146,3149],[3157,3158],[3260,3260],[3263,3263],[3270,3270],[3276,3277],[3298,3299],[3393,3395],[3405,3405],[3530,3530],[3538,3540],[3542,3542],[3633,3633],[3636,3642],[3655,3662],[3761,3761],[3764,3769],[3771,3772],[3784,3789],[3864,3865],[3893,3893],[3895,3895],[3897,3897],[3953,3966],[3968,3972],[3974,3975],[3984,3991],[3993,4028],[4038,4038],[4141,4144],[4146,4146],[4150,4151],[4153,4153],[4184,4185],[4448,4607],[4959,4959],[5906,5908],[5938,5940],[5970,5971],[6002,6003],[6068,6069],[6071,6077],[6086,6086],[6089,6099],[6109,6109],[6155,6157],[6313,6313],[6432,6434],[6439,6440],[6450,6450],[6457,6459],[6679,6680],[6912,6915],[6964,6964],[6966,6970],[6972,6972],[6978,6978],[7019,7027],[7616,7626],[7678,7679],[8203,8207],[8234,8238],[8288,8291],[8298,8303],[8400,8431],[12330,12335],[12441,12442],[43014,43014],[43019,43019],[43045,43046],[64286,64286],[65024,65039],[65056,65059],[65279,65279],[65529,65531]],c=[[68097,68099],[68101,68102],[68108,68111],[68152,68154],[68159,68159],[119143,119145],[119155,119170],[119173,119179],[119210,119213],[119362,119364],[917505,917505],[917536,917631],[917760,917999]],p;i.UnicodeV6=class{constructor(){if(this.version="6",!p){p=new Uint8Array(65536),p.fill(1),p[0]=0,p.fill(0,1,32),p.fill(0,127,160),p.fill(2,4352,4448),p[9001]=2,p[9002]=2,p.fill(2,11904,42192),p[12351]=1,p.fill(2,44032,55204),p.fill(2,63744,64256),p.fill(2,65040,65050),p.fill(2,65072,65136),p.fill(2,65280,65377),p.fill(2,65504,65511);for(let d=0;d<r.length;++d)p.fill(0,r[d][0],r[d][1]+1)}}wcwidth(d){return d<32?0:d<127?1:d<65536?p[d]:(function(f,v){let w,b=0,o=v.length-1;if(f<v[0][0]||f>v[o][1])return!1;for(;o>=b;)if(w=b+o>>1,f>v[w][1])b=w+1;else{if(!(f<v[w][0]))return!0;o=w-1}return!1})(d,c)?0:d>=131072&&d<=196605||d>=196608&&d<=262141?2:1}}},5981:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.WriteBuffer=void 0;let c=r(8460),p=r(844);class d extends p.Disposable{constructor(v){super(),this._action=v,this._writeBuffer=[],this._callbacks=[],this._pendingData=0,this._bufferOffset=0,this._isSyncWriting=!1,this._syncCalls=0,this._didUserInput=!1,this._onWriteParsed=this.register(new c.EventEmitter),this.onWriteParsed=this._onWriteParsed.event}handleUserInput(){this._didUserInput=!0}writeSync(v,w){if(w!==void 0&&this._syncCalls>w)return void(this._syncCalls=0);if(this._pendingData+=v.length,this._writeBuffer.push(v),this._callbacks.push(void 0),this._syncCalls++,this._isSyncWriting)return;let b;for(this._isSyncWriting=!0;b=this._writeBuffer.shift();){this._action(b);let o=this._callbacks.shift();o&&o()}this._pendingData=0,this._bufferOffset=2147483647,this._isSyncWriting=!1,this._syncCalls=0}write(v,w){if(this._pendingData>5e7)throw new Error("write data discarded, use flow control to avoid losing data");if(!this._writeBuffer.length){if(this._bufferOffset=0,this._didUserInput)return this._didUserInput=!1,this._pendingData+=v.length,this._writeBuffer.push(v),this._callbacks.push(w),void this._innerWrite();setTimeout((()=>this._innerWrite()))}this._pendingData+=v.length,this._writeBuffer.push(v),this._callbacks.push(w)}_innerWrite(v=0,w=!0){let b=v||Date.now();for(;this._writeBuffer.length>this._bufferOffset;){let o=this._writeBuffer[this._bufferOffset],l=this._action(o,w);if(l){let h=_=>Date.now()-b>=12?setTimeout((()=>this._innerWrite(0,_))):this._innerWrite(b,_);return void l.catch((_=>(queueMicrotask((()=>{throw _})),Promise.resolve(!1)))).then(h)}let a=this._callbacks[this._bufferOffset];if(a&&a(),this._bufferOffset++,this._pendingData-=o.length,Date.now()-b>=12)break}this._writeBuffer.length>this._bufferOffset?(this._bufferOffset>50&&(this._writeBuffer=this._writeBuffer.slice(this._bufferOffset),this._callbacks=this._callbacks.slice(this._bufferOffset),this._bufferOffset=0),setTimeout((()=>this._innerWrite()))):(this._writeBuffer.length=0,this._callbacks.length=0,this._pendingData=0,this._bufferOffset=0),this._onWriteParsed.fire()}}i.WriteBuffer=d},5941:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.toRgbString=i.parseColor=void 0;let r=/^([\da-f])\/([\da-f])\/([\da-f])$|^([\da-f]{2})\/([\da-f]{2})\/([\da-f]{2})$|^([\da-f]{3})\/([\da-f]{3})\/([\da-f]{3})$|^([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})$/,c=/^[\da-f]+$/;function p(d,f){let v=d.toString(16),w=v.length<2?"0"+v:v;switch(f){case 4:return v[0];case 8:return w;case 12:return(w+w).slice(0,3);default:return w+w}}i.parseColor=function(d){if(!d)return;let f=d.toLowerCase();if(f.indexOf("rgb:")===0){f=f.slice(4);let v=r.exec(f);if(v){let w=v[1]?15:v[4]?255:v[7]?4095:65535;return[Math.round(parseInt(v[1]||v[4]||v[7]||v[10],16)/w*255),Math.round(parseInt(v[2]||v[5]||v[8]||v[11],16)/w*255),Math.round(parseInt(v[3]||v[6]||v[9]||v[12],16)/w*255)]}}else if(f.indexOf("#")===0&&(f=f.slice(1),c.exec(f)&&[3,6,9,12].includes(f.length))){let v=f.length/3,w=[0,0,0];for(let b=0;b<3;++b){let o=parseInt(f.slice(v*b,v*b+v),16);w[b]=v===1?o<<4:v===2?o:v===3?o>>4:o>>8}return w}},i.toRgbString=function(d,f=16){let[v,w,b]=d;return`rgb:${p(v,f)}/${p(w,f)}/${p(b,f)}`}},5770:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.PAYLOAD_LIMIT=void 0,i.PAYLOAD_LIMIT=1e7},6351:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DcsHandler=i.DcsParser=void 0;let c=r(482),p=r(8742),d=r(5770),f=[];i.DcsParser=class{constructor(){this._handlers=Object.create(null),this._active=f,this._ident=0,this._handlerFb=()=>{},this._stack={paused:!1,loopPosition:0,fallThrough:!1}}dispose(){this._handlers=Object.create(null),this._handlerFb=()=>{},this._active=f}registerHandler(w,b){this._handlers[w]===void 0&&(this._handlers[w]=[]);let o=this._handlers[w];return o.push(b),{dispose:()=>{let l=o.indexOf(b);l!==-1&&o.splice(l,1)}}}clearHandler(w){this._handlers[w]&&delete this._handlers[w]}setHandlerFallback(w){this._handlerFb=w}reset(){if(this._active.length)for(let w=this._stack.paused?this._stack.loopPosition-1:this._active.length-1;w>=0;--w)this._active[w].unhook(!1);this._stack.paused=!1,this._active=f,this._ident=0}hook(w,b){if(this.reset(),this._ident=w,this._active=this._handlers[w]||f,this._active.length)for(let o=this._active.length-1;o>=0;o--)this._active[o].hook(b);else this._handlerFb(this._ident,"HOOK",b)}put(w,b,o){if(this._active.length)for(let l=this._active.length-1;l>=0;l--)this._active[l].put(w,b,o);else this._handlerFb(this._ident,"PUT",(0,c.utf32ToString)(w,b,o))}unhook(w,b=!0){if(this._active.length){let o=!1,l=this._active.length-1,a=!1;if(this._stack.paused&&(l=this._stack.loopPosition-1,o=b,a=this._stack.fallThrough,this._stack.paused=!1),!a&&o===!1){for(;l>=0&&(o=this._active[l].unhook(w),o!==!0);l--)if(o instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=l,this._stack.fallThrough=!1,o;l--}for(;l>=0;l--)if(o=this._active[l].unhook(!1),o instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=l,this._stack.fallThrough=!0,o}else this._handlerFb(this._ident,"UNHOOK",w);this._active=f,this._ident=0}};let v=new p.Params;v.addParam(0),i.DcsHandler=class{constructor(w){this._handler=w,this._data="",this._params=v,this._hitLimit=!1}hook(w){this._params=w.length>1||w.params[0]?w.clone():v,this._data="",this._hitLimit=!1}put(w,b,o){this._hitLimit||(this._data+=(0,c.utf32ToString)(w,b,o),this._data.length>d.PAYLOAD_LIMIT&&(this._data="",this._hitLimit=!0))}unhook(w){let b=!1;if(this._hitLimit)b=!1;else if(w&&(b=this._handler(this._data,this._params),b instanceof Promise))return b.then((o=>(this._params=v,this._data="",this._hitLimit=!1,o)));return this._params=v,this._data="",this._hitLimit=!1,b}}},2015:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.EscapeSequenceParser=i.VT500_TRANSITION_TABLE=i.TransitionTable=void 0;let c=r(844),p=r(8742),d=r(6242),f=r(6351);class v{constructor(l){this.table=new Uint8Array(l)}setDefault(l,a){this.table.fill(l<<4|a)}add(l,a,h,_){this.table[a<<8|l]=h<<4|_}addMany(l,a,h,_){for(let g=0;g<l.length;g++)this.table[a<<8|l[g]]=h<<4|_}}i.TransitionTable=v;let w=160;i.VT500_TRANSITION_TABLE=(function(){let o=new v(4095),l=Array.apply(null,Array(256)).map(((x,m)=>m)),a=(x,m)=>l.slice(x,m),h=a(32,127),_=a(0,24);_.push(25),_.push.apply(_,a(28,32));let g=a(0,14),y;for(y in o.setDefault(1,0),o.addMany(h,0,2,0),g)o.addMany([24,26,153,154],y,3,0),o.addMany(a(128,144),y,3,0),o.addMany(a(144,152),y,3,0),o.add(156,y,0,0),o.add(27,y,11,1),o.add(157,y,4,8),o.addMany([152,158,159],y,0,7),o.add(155,y,11,3),o.add(144,y,11,9);return o.addMany(_,0,3,0),o.addMany(_,1,3,1),o.add(127,1,0,1),o.addMany(_,8,0,8),o.addMany(_,3,3,3),o.add(127,3,0,3),o.addMany(_,4,3,4),o.add(127,4,0,4),o.addMany(_,6,3,6),o.addMany(_,5,3,5),o.add(127,5,0,5),o.addMany(_,2,3,2),o.add(127,2,0,2),o.add(93,1,4,8),o.addMany(h,8,5,8),o.add(127,8,5,8),o.addMany([156,27,24,26,7],8,6,0),o.addMany(a(28,32),8,0,8),o.addMany([88,94,95],1,0,7),o.addMany(h,7,0,7),o.addMany(_,7,0,7),o.add(156,7,0,0),o.add(127,7,0,7),o.add(91,1,11,3),o.addMany(a(64,127),3,7,0),o.addMany(a(48,60),3,8,4),o.addMany([60,61,62,63],3,9,4),o.addMany(a(48,60),4,8,4),o.addMany(a(64,127),4,7,0),o.addMany([60,61,62,63],4,0,6),o.addMany(a(32,64),6,0,6),o.add(127,6,0,6),o.addMany(a(64,127),6,0,0),o.addMany(a(32,48),3,9,5),o.addMany(a(32,48),5,9,5),o.addMany(a(48,64),5,0,6),o.addMany(a(64,127),5,7,0),o.addMany(a(32,48),4,9,5),o.addMany(a(32,48),1,9,2),o.addMany(a(32,48),2,9,2),o.addMany(a(48,127),2,10,0),o.addMany(a(48,80),1,10,0),o.addMany(a(81,88),1,10,0),o.addMany([89,90,92],1,10,0),o.addMany(a(96,127),1,10,0),o.add(80,1,11,9),o.addMany(_,9,0,9),o.add(127,9,0,9),o.addMany(a(28,32),9,0,9),o.addMany(a(32,48),9,9,12),o.addMany(a(48,60),9,8,10),o.addMany([60,61,62,63],9,9,10),o.addMany(_,11,0,11),o.addMany(a(32,128),11,0,11),o.addMany(a(28,32),11,0,11),o.addMany(_,10,0,10),o.add(127,10,0,10),o.addMany(a(28,32),10,0,10),o.addMany(a(48,60),10,8,10),o.addMany([60,61,62,63],10,0,11),o.addMany(a(32,48),10,9,12),o.addMany(_,12,0,12),o.add(127,12,0,12),o.addMany(a(28,32),12,0,12),o.addMany(a(32,48),12,9,12),o.addMany(a(48,64),12,0,11),o.addMany(a(64,127),12,12,13),o.addMany(a(64,127),10,12,13),o.addMany(a(64,127),9,12,13),o.addMany(_,13,13,13),o.addMany(h,13,13,13),o.add(127,13,0,13),o.addMany([27,156,24,26],13,14,0),o.add(w,0,2,0),o.add(w,8,5,8),o.add(w,6,0,6),o.add(w,11,0,11),o.add(w,13,13,13),o})();class b extends c.Disposable{constructor(l=i.VT500_TRANSITION_TABLE){super(),this._transitions=l,this._parseStack={state:0,handlers:[],handlerPos:0,transition:0,chunkPos:0},this.initialState=0,this.currentState=this.initialState,this._params=new p.Params,this._params.addParam(0),this._collect=0,this.precedingCodepoint=0,this._printHandlerFb=(a,h,_)=>{},this._executeHandlerFb=a=>{},this._csiHandlerFb=(a,h)=>{},this._escHandlerFb=a=>{},this._errorHandlerFb=a=>a,this._printHandler=this._printHandlerFb,this._executeHandlers=Object.create(null),this._csiHandlers=Object.create(null),this._escHandlers=Object.create(null),this.register((0,c.toDisposable)((()=>{this._csiHandlers=Object.create(null),this._executeHandlers=Object.create(null),this._escHandlers=Object.create(null)}))),this._oscParser=this.register(new d.OscParser),this._dcsParser=this.register(new f.DcsParser),this._errorHandler=this._errorHandlerFb,this.registerEscHandler({final:"\\"},(()=>!0))}_identifier(l,a=[64,126]){let h=0;if(l.prefix){if(l.prefix.length>1)throw new Error("only one byte as prefix supported");if(h=l.prefix.charCodeAt(0),h&&60>h||h>63)throw new Error("prefix must be in range 0x3c .. 0x3f")}if(l.intermediates){if(l.intermediates.length>2)throw new Error("only two bytes as intermediates are supported");for(let g=0;g<l.intermediates.length;++g){let y=l.intermediates.charCodeAt(g);if(32>y||y>47)throw new Error("intermediate must be in range 0x20 .. 0x2f");h<<=8,h|=y}}if(l.final.length!==1)throw new Error("final must be a single byte");let _=l.final.charCodeAt(0);if(a[0]>_||_>a[1])throw new Error(`final must be in range ${a[0]} .. ${a[1]}`);return h<<=8,h|=_,h}identToString(l){let a=[];for(;l;)a.push(String.fromCharCode(255&l)),l>>=8;return a.reverse().join("")}setPrintHandler(l){this._printHandler=l}clearPrintHandler(){this._printHandler=this._printHandlerFb}registerEscHandler(l,a){let h=this._identifier(l,[48,126]);this._escHandlers[h]===void 0&&(this._escHandlers[h]=[]);let _=this._escHandlers[h];return _.push(a),{dispose:()=>{let g=_.indexOf(a);g!==-1&&_.splice(g,1)}}}clearEscHandler(l){this._escHandlers[this._identifier(l,[48,126])]&&delete this._escHandlers[this._identifier(l,[48,126])]}setEscHandlerFallback(l){this._escHandlerFb=l}setExecuteHandler(l,a){this._executeHandlers[l.charCodeAt(0)]=a}clearExecuteHandler(l){this._executeHandlers[l.charCodeAt(0)]&&delete this._executeHandlers[l.charCodeAt(0)]}setExecuteHandlerFallback(l){this._executeHandlerFb=l}registerCsiHandler(l,a){let h=this._identifier(l);this._csiHandlers[h]===void 0&&(this._csiHandlers[h]=[]);let _=this._csiHandlers[h];return _.push(a),{dispose:()=>{let g=_.indexOf(a);g!==-1&&_.splice(g,1)}}}clearCsiHandler(l){this._csiHandlers[this._identifier(l)]&&delete this._csiHandlers[this._identifier(l)]}setCsiHandlerFallback(l){this._csiHandlerFb=l}registerDcsHandler(l,a){return this._dcsParser.registerHandler(this._identifier(l),a)}clearDcsHandler(l){this._dcsParser.clearHandler(this._identifier(l))}setDcsHandlerFallback(l){this._dcsParser.setHandlerFallback(l)}registerOscHandler(l,a){return this._oscParser.registerHandler(l,a)}clearOscHandler(l){this._oscParser.clearHandler(l)}setOscHandlerFallback(l){this._oscParser.setHandlerFallback(l)}setErrorHandler(l){this._errorHandler=l}clearErrorHandler(){this._errorHandler=this._errorHandlerFb}reset(){this.currentState=this.initialState,this._oscParser.reset(),this._dcsParser.reset(),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0,this._parseStack.state!==0&&(this._parseStack.state=2,this._parseStack.handlers=[])}_preserveStack(l,a,h,_,g){this._parseStack.state=l,this._parseStack.handlers=a,this._parseStack.handlerPos=h,this._parseStack.transition=_,this._parseStack.chunkPos=g}parse(l,a,h){let _,g=0,y=0,x=0;if(this._parseStack.state)if(this._parseStack.state===2)this._parseStack.state=0,x=this._parseStack.chunkPos+1;else{if(h===void 0||this._parseStack.state===1)throw this._parseStack.state=1,new Error("improper continuation due to previous async handler, giving up parsing");let m=this._parseStack.handlers,S=this._parseStack.handlerPos-1;switch(this._parseStack.state){case 3:if(h===!1&&S>-1){for(;S>=0&&(_=m[S](this._params),_!==!0);S--)if(_ instanceof Promise)return this._parseStack.handlerPos=S,_}this._parseStack.handlers=[];break;case 4:if(h===!1&&S>-1){for(;S>=0&&(_=m[S](),_!==!0);S--)if(_ instanceof Promise)return this._parseStack.handlerPos=S,_}this._parseStack.handlers=[];break;case 6:if(g=l[this._parseStack.chunkPos],_=this._dcsParser.unhook(g!==24&&g!==26,h),_)return _;g===27&&(this._parseStack.transition|=1),this._params.reset(),this._params.addParam(0),this._collect=0;break;case 5:if(g=l[this._parseStack.chunkPos],_=this._oscParser.end(g!==24&&g!==26,h),_)return _;g===27&&(this._parseStack.transition|=1),this._params.reset(),this._params.addParam(0),this._collect=0}this._parseStack.state=0,x=this._parseStack.chunkPos+1,this.precedingCodepoint=0,this.currentState=15&this._parseStack.transition}for(let m=x;m<a;++m){switch(g=l[m],y=this._transitions.table[this.currentState<<8|(g<160?g:w)],y>>4){case 2:for(let B=m+1;;++B){if(B>=a||(g=l[B])<32||g>126&&g<w){this._printHandler(l,m,B),m=B-1;break}if(++B>=a||(g=l[B])<32||g>126&&g<w){this._printHandler(l,m,B),m=B-1;break}if(++B>=a||(g=l[B])<32||g>126&&g<w){this._printHandler(l,m,B),m=B-1;break}if(++B>=a||(g=l[B])<32||g>126&&g<w){this._printHandler(l,m,B),m=B-1;break}}break;case 3:this._executeHandlers[g]?this._executeHandlers[g]():this._executeHandlerFb(g),this.precedingCodepoint=0;break;case 0:break;case 1:if(this._errorHandler({position:m,code:g,currentState:this.currentState,collect:this._collect,params:this._params,abort:!1}).abort)return;break;case 7:let S=this._csiHandlers[this._collect<<8|g],L=S?S.length-1:-1;for(;L>=0&&(_=S[L](this._params),_!==!0);L--)if(_ instanceof Promise)return this._preserveStack(3,S,L,y,m),_;L<0&&this._csiHandlerFb(this._collect<<8|g,this._params),this.precedingCodepoint=0;break;case 8:do switch(g){case 59:this._params.addParam(0);break;case 58:this._params.addSubParam(-1);break;default:this._params.addDigit(g-48)}while(++m<a&&(g=l[m])>47&&g<60);m--;break;case 9:this._collect<<=8,this._collect|=g;break;case 10:let O=this._escHandlers[this._collect<<8|g],D=O?O.length-1:-1;for(;D>=0&&(_=O[D](),_!==!0);D--)if(_ instanceof Promise)return this._preserveStack(4,O,D,y,m),_;D<0&&this._escHandlerFb(this._collect<<8|g),this.precedingCodepoint=0;break;case 11:this._params.reset(),this._params.addParam(0),this._collect=0;break;case 12:this._dcsParser.hook(this._collect<<8|g,this._params);break;case 13:for(let B=m+1;;++B)if(B>=a||(g=l[B])===24||g===26||g===27||g>127&&g<w){this._dcsParser.put(l,m,B),m=B-1;break}break;case 14:if(_=this._dcsParser.unhook(g!==24&&g!==26),_)return this._preserveStack(6,[],0,y,m),_;g===27&&(y|=1),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0;break;case 4:this._oscParser.start();break;case 5:for(let B=m+1;;B++)if(B>=a||(g=l[B])<32||g>127&&g<w){this._oscParser.put(l,m,B),m=B-1;break}break;case 6:if(_=this._oscParser.end(g!==24&&g!==26),_)return this._preserveStack(5,[],0,y,m),_;g===27&&(y|=1),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0}this.currentState=15&y}}}i.EscapeSequenceParser=b},6242:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.OscHandler=i.OscParser=void 0;let c=r(5770),p=r(482),d=[];i.OscParser=class{constructor(){this._state=0,this._active=d,this._id=-1,this._handlers=Object.create(null),this._handlerFb=()=>{},this._stack={paused:!1,loopPosition:0,fallThrough:!1}}registerHandler(f,v){this._handlers[f]===void 0&&(this._handlers[f]=[]);let w=this._handlers[f];return w.push(v),{dispose:()=>{let b=w.indexOf(v);b!==-1&&w.splice(b,1)}}}clearHandler(f){this._handlers[f]&&delete this._handlers[f]}setHandlerFallback(f){this._handlerFb=f}dispose(){this._handlers=Object.create(null),this._handlerFb=()=>{},this._active=d}reset(){if(this._state===2)for(let f=this._stack.paused?this._stack.loopPosition-1:this._active.length-1;f>=0;--f)this._active[f].end(!1);this._stack.paused=!1,this._active=d,this._id=-1,this._state=0}_start(){if(this._active=this._handlers[this._id]||d,this._active.length)for(let f=this._active.length-1;f>=0;f--)this._active[f].start();else this._handlerFb(this._id,"START")}_put(f,v,w){if(this._active.length)for(let b=this._active.length-1;b>=0;b--)this._active[b].put(f,v,w);else this._handlerFb(this._id,"PUT",(0,p.utf32ToString)(f,v,w))}start(){this.reset(),this._state=1}put(f,v,w){if(this._state!==3){if(this._state===1)for(;v<w;){let b=f[v++];if(b===59){this._state=2,this._start();break}if(b<48||57<b)return void(this._state=3);this._id===-1&&(this._id=0),this._id=10*this._id+b-48}this._state===2&&w-v>0&&this._put(f,v,w)}}end(f,v=!0){if(this._state!==0){if(this._state!==3)if(this._state===1&&this._start(),this._active.length){let w=!1,b=this._active.length-1,o=!1;if(this._stack.paused&&(b=this._stack.loopPosition-1,w=v,o=this._stack.fallThrough,this._stack.paused=!1),!o&&w===!1){for(;b>=0&&(w=this._active[b].end(f),w!==!0);b--)if(w instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=b,this._stack.fallThrough=!1,w;b--}for(;b>=0;b--)if(w=this._active[b].end(!1),w instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=b,this._stack.fallThrough=!0,w}else this._handlerFb(this._id,"END",f);this._active=d,this._id=-1,this._state=0}}},i.OscHandler=class{constructor(f){this._handler=f,this._data="",this._hitLimit=!1}start(){this._data="",this._hitLimit=!1}put(f,v,w){this._hitLimit||(this._data+=(0,p.utf32ToString)(f,v,w),this._data.length>c.PAYLOAD_LIMIT&&(this._data="",this._hitLimit=!0))}end(f){let v=!1;if(this._hitLimit)v=!1;else if(f&&(v=this._handler(this._data),v instanceof Promise))return v.then((w=>(this._data="",this._hitLimit=!1,w)));return this._data="",this._hitLimit=!1,v}}},8742:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Params=void 0;let r=2147483647;class c{static fromArray(d){let f=new c;if(!d.length)return f;for(let v=Array.isArray(d[0])?1:0;v<d.length;++v){let w=d[v];if(Array.isArray(w))for(let b=0;b<w.length;++b)f.addSubParam(w[b]);else f.addParam(w)}return f}constructor(d=32,f=32){if(this.maxLength=d,this.maxSubParamsLength=f,f>256)throw new Error("maxSubParamsLength must not be greater than 256");this.params=new Int32Array(d),this.length=0,this._subParams=new Int32Array(f),this._subParamsLength=0,this._subParamsIdx=new Uint16Array(d),this._rejectDigits=!1,this._rejectSubDigits=!1,this._digitIsSub=!1}clone(){let d=new c(this.maxLength,this.maxSubParamsLength);return d.params.set(this.params),d.length=this.length,d._subParams.set(this._subParams),d._subParamsLength=this._subParamsLength,d._subParamsIdx.set(this._subParamsIdx),d._rejectDigits=this._rejectDigits,d._rejectSubDigits=this._rejectSubDigits,d._digitIsSub=this._digitIsSub,d}toArray(){let d=[];for(let f=0;f<this.length;++f){d.push(this.params[f]);let v=this._subParamsIdx[f]>>8,w=255&this._subParamsIdx[f];w-v>0&&d.push(Array.prototype.slice.call(this._subParams,v,w))}return d}reset(){this.length=0,this._subParamsLength=0,this._rejectDigits=!1,this._rejectSubDigits=!1,this._digitIsSub=!1}addParam(d){if(this._digitIsSub=!1,this.length>=this.maxLength)this._rejectDigits=!0;else{if(d<-1)throw new Error("values lesser than -1 are not allowed");this._subParamsIdx[this.length]=this._subParamsLength<<8|this._subParamsLength,this.params[this.length++]=d>r?r:d}}addSubParam(d){if(this._digitIsSub=!0,this.length)if(this._rejectDigits||this._subParamsLength>=this.maxSubParamsLength)this._rejectSubDigits=!0;else{if(d<-1)throw new Error("values lesser than -1 are not allowed");this._subParams[this._subParamsLength++]=d>r?r:d,this._subParamsIdx[this.length-1]++}}hasSubParams(d){return(255&this._subParamsIdx[d])-(this._subParamsIdx[d]>>8)>0}getSubParams(d){let f=this._subParamsIdx[d]>>8,v=255&this._subParamsIdx[d];return v-f>0?this._subParams.subarray(f,v):null}getSubParamsAll(){let d={};for(let f=0;f<this.length;++f){let v=this._subParamsIdx[f]>>8,w=255&this._subParamsIdx[f];w-v>0&&(d[f]=this._subParams.slice(v,w))}return d}addDigit(d){let f;if(this._rejectDigits||!(f=this._digitIsSub?this._subParamsLength:this.length)||this._digitIsSub&&this._rejectSubDigits)return;let v=this._digitIsSub?this._subParams:this.params,w=v[f-1];v[f-1]=~w?Math.min(10*w+d,r):d}}i.Params=c},5741:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.AddonManager=void 0,i.AddonManager=class{constructor(){this._addons=[]}dispose(){for(let r=this._addons.length-1;r>=0;r--)this._addons[r].instance.dispose()}loadAddon(r,c){let p={instance:c,dispose:c.dispose,isDisposed:!1};this._addons.push(p),c.dispose=()=>this._wrappedAddonDispose(p),c.activate(r)}_wrappedAddonDispose(r){if(r.isDisposed)return;let c=-1;for(let p=0;p<this._addons.length;p++)if(this._addons[p]===r){c=p;break}if(c===-1)throw new Error("Could not dispose an addon that has not been loaded");r.isDisposed=!0,r.dispose.apply(r.instance),this._addons.splice(c,1)}}},8771:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferApiView=void 0;let c=r(3785),p=r(511);i.BufferApiView=class{constructor(d,f){this._buffer=d,this.type=f}init(d){return this._buffer=d,this}get cursorY(){return this._buffer.y}get cursorX(){return this._buffer.x}get viewportY(){return this._buffer.ydisp}get baseY(){return this._buffer.ybase}get length(){return this._buffer.lines.length}getLine(d){let f=this._buffer.lines.get(d);if(f)return new c.BufferLineApiView(f)}getNullCell(){return new p.CellData}}},3785:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferLineApiView=void 0;let c=r(511);i.BufferLineApiView=class{constructor(p){this._line=p}get isWrapped(){return this._line.isWrapped}get length(){return this._line.length}getCell(p,d){if(!(p<0||p>=this._line.length))return d?(this._line.loadCell(p,d),d):this._line.loadCell(p,new c.CellData)}translateToString(p,d,f){return this._line.translateToString(p,d,f)}}},8285:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferNamespaceApi=void 0;let c=r(8771),p=r(8460),d=r(844);class f extends d.Disposable{constructor(w){super(),this._core=w,this._onBufferChange=this.register(new p.EventEmitter),this.onBufferChange=this._onBufferChange.event,this._normal=new c.BufferApiView(this._core.buffers.normal,"normal"),this._alternate=new c.BufferApiView(this._core.buffers.alt,"alternate"),this._core.buffers.onBufferActivate((()=>this._onBufferChange.fire(this.active)))}get active(){if(this._core.buffers.active===this._core.buffers.normal)return this.normal;if(this._core.buffers.active===this._core.buffers.alt)return this.alternate;throw new Error("Active buffer is neither normal nor alternate")}get normal(){return this._normal.init(this._core.buffers.normal)}get alternate(){return this._alternate.init(this._core.buffers.alt)}}i.BufferNamespaceApi=f},7975:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ParserApi=void 0,i.ParserApi=class{constructor(r){this._core=r}registerCsiHandler(r,c){return this._core.registerCsiHandler(r,(p=>c(p.toArray())))}addCsiHandler(r,c){return this.registerCsiHandler(r,c)}registerDcsHandler(r,c){return this._core.registerDcsHandler(r,((p,d)=>c(p,d.toArray())))}addDcsHandler(r,c){return this.registerDcsHandler(r,c)}registerEscHandler(r,c){return this._core.registerEscHandler(r,c)}addEscHandler(r,c){return this.registerEscHandler(r,c)}registerOscHandler(r,c){return this._core.registerOscHandler(r,c)}addOscHandler(r,c){return this.registerOscHandler(r,c)}}},7090:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.UnicodeApi=void 0,i.UnicodeApi=class{constructor(r){this._core=r}register(r){this._core.unicodeService.register(r)}get versions(){return this._core.unicodeService.versions}get activeVersion(){return this._core.unicodeService.activeVersion}set activeVersion(r){this._core.unicodeService.activeVersion=r}}},744:function(u,i,r){var c=this&&this.__decorate||function(o,l,a,h){var _,g=arguments.length,y=g<3?l:h===null?h=Object.getOwnPropertyDescriptor(l,a):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(o,l,a,h);else for(var x=o.length-1;x>=0;x--)(_=o[x])&&(y=(g<3?_(y):g>3?_(l,a,y):_(l,a))||y);return g>3&&y&&Object.defineProperty(l,a,y),y},p=this&&this.__param||function(o,l){return function(a,h){l(a,h,o)}};Object.defineProperty(i,"__esModule",{value:!0}),i.BufferService=i.MINIMUM_ROWS=i.MINIMUM_COLS=void 0;let d=r(8460),f=r(844),v=r(5295),w=r(2585);i.MINIMUM_COLS=2,i.MINIMUM_ROWS=1;let b=i.BufferService=class extends f.Disposable{get buffer(){return this.buffers.active}constructor(o){super(),this.isUserScrolling=!1,this._onResize=this.register(new d.EventEmitter),this.onResize=this._onResize.event,this._onScroll=this.register(new d.EventEmitter),this.onScroll=this._onScroll.event,this.cols=Math.max(o.rawOptions.cols||0,i.MINIMUM_COLS),this.rows=Math.max(o.rawOptions.rows||0,i.MINIMUM_ROWS),this.buffers=this.register(new v.BufferSet(o,this))}resize(o,l){this.cols=o,this.rows=l,this.buffers.resize(o,l),this._onResize.fire({cols:o,rows:l})}reset(){this.buffers.reset(),this.isUserScrolling=!1}scroll(o,l=!1){let a=this.buffer,h;h=this._cachedBlankLine,h&&h.length===this.cols&&h.getFg(0)===o.fg&&h.getBg(0)===o.bg||(h=a.getBlankLine(o,l),this._cachedBlankLine=h),h.isWrapped=l;let _=a.ybase+a.scrollTop,g=a.ybase+a.scrollBottom;if(a.scrollTop===0){let y=a.lines.isFull;g===a.lines.length-1?y?a.lines.recycle().copyFrom(h):a.lines.push(h.clone()):a.lines.splice(g+1,0,h.clone()),y?this.isUserScrolling&&(a.ydisp=Math.max(a.ydisp-1,0)):(a.ybase++,this.isUserScrolling||a.ydisp++)}else{let y=g-_+1;a.lines.shiftElements(_+1,y-1,-1),a.lines.set(g,h.clone())}this.isUserScrolling||(a.ydisp=a.ybase),this._onScroll.fire(a.ydisp)}scrollLines(o,l,a){let h=this.buffer;if(o<0){if(h.ydisp===0)return;this.isUserScrolling=!0}else o+h.ydisp>=h.ybase&&(this.isUserScrolling=!1);let _=h.ydisp;h.ydisp=Math.max(Math.min(h.ydisp+o,h.ybase),0),_!==h.ydisp&&(l||this._onScroll.fire(h.ydisp))}};i.BufferService=b=c([p(0,w.IOptionsService)],b)},7994:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CharsetService=void 0,i.CharsetService=class{constructor(){this.glevel=0,this._charsets=[]}reset(){this.charset=void 0,this._charsets=[],this.glevel=0}setgLevel(r){this.glevel=r,this.charset=this._charsets[r]}setgCharset(r,c){this._charsets[r]=c,this.glevel===r&&(this.charset=c)}}},1753:function(u,i,r){var c=this&&this.__decorate||function(h,_,g,y){var x,m=arguments.length,S=m<3?_:y===null?y=Object.getOwnPropertyDescriptor(_,g):y;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")S=Reflect.decorate(h,_,g,y);else for(var L=h.length-1;L>=0;L--)(x=h[L])&&(S=(m<3?x(S):m>3?x(_,g,S):x(_,g))||S);return m>3&&S&&Object.defineProperty(_,g,S),S},p=this&&this.__param||function(h,_){return function(g,y){_(g,y,h)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CoreMouseService=void 0;let d=r(2585),f=r(8460),v=r(844),w={NONE:{events:0,restrict:()=>!1},X10:{events:1,restrict:h=>h.button!==4&&h.action===1&&(h.ctrl=!1,h.alt=!1,h.shift=!1,!0)},VT200:{events:19,restrict:h=>h.action!==32},DRAG:{events:23,restrict:h=>h.action!==32||h.button!==3},ANY:{events:31,restrict:h=>!0}};function b(h,_){let g=(h.ctrl?16:0)|(h.shift?4:0)|(h.alt?8:0);return h.button===4?(g|=64,g|=h.action):(g|=3&h.button,4&h.button&&(g|=64),8&h.button&&(g|=128),h.action===32?g|=32:h.action!==0||_||(g|=3)),g}let o=String.fromCharCode,l={DEFAULT:h=>{let _=[b(h,!1)+32,h.col+32,h.row+32];return _[0]>255||_[1]>255||_[2]>255?"":`\x1B[M${o(_[0])}${o(_[1])}${o(_[2])}`},SGR:h=>{let _=h.action===0&&h.button!==4?"m":"M";return`\x1B[<${b(h,!0)};${h.col};${h.row}${_}`},SGR_PIXELS:h=>{let _=h.action===0&&h.button!==4?"m":"M";return`\x1B[<${b(h,!0)};${h.x};${h.y}${_}`}},a=i.CoreMouseService=class extends v.Disposable{constructor(h,_){super(),this._bufferService=h,this._coreService=_,this._protocols={},this._encodings={},this._activeProtocol="",this._activeEncoding="",this._lastEvent=null,this._onProtocolChange=this.register(new f.EventEmitter),this.onProtocolChange=this._onProtocolChange.event;for(let g of Object.keys(w))this.addProtocol(g,w[g]);for(let g of Object.keys(l))this.addEncoding(g,l[g]);this.reset()}addProtocol(h,_){this._protocols[h]=_}addEncoding(h,_){this._encodings[h]=_}get activeProtocol(){return this._activeProtocol}get areMouseEventsActive(){return this._protocols[this._activeProtocol].events!==0}set activeProtocol(h){if(!this._protocols[h])throw new Error(`unknown protocol "${h}"`);this._activeProtocol=h,this._onProtocolChange.fire(this._protocols[h].events)}get activeEncoding(){return this._activeEncoding}set activeEncoding(h){if(!this._encodings[h])throw new Error(`unknown encoding "${h}"`);this._activeEncoding=h}reset(){this.activeProtocol="NONE",this.activeEncoding="DEFAULT",this._lastEvent=null}triggerMouseEvent(h){if(h.col<0||h.col>=this._bufferService.cols||h.row<0||h.row>=this._bufferService.rows||h.button===4&&h.action===32||h.button===3&&h.action!==32||h.button!==4&&(h.action===2||h.action===3)||(h.col++,h.row++,h.action===32&&this._lastEvent&&this._equalEvents(this._lastEvent,h,this._activeEncoding==="SGR_PIXELS"))||!this._protocols[this._activeProtocol].restrict(h))return!1;let _=this._encodings[this._activeEncoding](h);return _&&(this._activeEncoding==="DEFAULT"?this._coreService.triggerBinaryEvent(_):this._coreService.triggerDataEvent(_,!0)),this._lastEvent=h,!0}explainEvents(h){return{down:!!(1&h),up:!!(2&h),drag:!!(4&h),move:!!(8&h),wheel:!!(16&h)}}_equalEvents(h,_,g){if(g){if(h.x!==_.x||h.y!==_.y)return!1}else if(h.col!==_.col||h.row!==_.row)return!1;return h.button===_.button&&h.action===_.action&&h.ctrl===_.ctrl&&h.alt===_.alt&&h.shift===_.shift}};i.CoreMouseService=a=c([p(0,d.IBufferService),p(1,d.ICoreService)],a)},6975:function(u,i,r){var c=this&&this.__decorate||function(a,h,_,g){var y,x=arguments.length,m=x<3?h:g===null?g=Object.getOwnPropertyDescriptor(h,_):g;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")m=Reflect.decorate(a,h,_,g);else for(var S=a.length-1;S>=0;S--)(y=a[S])&&(m=(x<3?y(m):x>3?y(h,_,m):y(h,_))||m);return x>3&&m&&Object.defineProperty(h,_,m),m},p=this&&this.__param||function(a,h){return function(_,g){h(_,g,a)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CoreService=void 0;let d=r(1439),f=r(8460),v=r(844),w=r(2585),b=Object.freeze({insertMode:!1}),o=Object.freeze({applicationCursorKeys:!1,applicationKeypad:!1,bracketedPasteMode:!1,origin:!1,reverseWraparound:!1,sendFocus:!1,wraparound:!0}),l=i.CoreService=class extends v.Disposable{constructor(a,h,_){super(),this._bufferService=a,this._logService=h,this._optionsService=_,this.isCursorInitialized=!1,this.isCursorHidden=!1,this._onData=this.register(new f.EventEmitter),this.onData=this._onData.event,this._onUserInput=this.register(new f.EventEmitter),this.onUserInput=this._onUserInput.event,this._onBinary=this.register(new f.EventEmitter),this.onBinary=this._onBinary.event,this._onRequestScrollToBottom=this.register(new f.EventEmitter),this.onRequestScrollToBottom=this._onRequestScrollToBottom.event,this.modes=(0,d.clone)(b),this.decPrivateModes=(0,d.clone)(o)}reset(){this.modes=(0,d.clone)(b),this.decPrivateModes=(0,d.clone)(o)}triggerDataEvent(a,h=!1){if(this._optionsService.rawOptions.disableStdin)return;let _=this._bufferService.buffer;h&&this._optionsService.rawOptions.scrollOnUserInput&&_.ybase!==_.ydisp&&this._onRequestScrollToBottom.fire(),h&&this._onUserInput.fire(),this._logService.debug(`sending data "${a}"`,(()=>a.split("").map((g=>g.charCodeAt(0))))),this._onData.fire(a)}triggerBinaryEvent(a){this._optionsService.rawOptions.disableStdin||(this._logService.debug(`sending binary "${a}"`,(()=>a.split("").map((h=>h.charCodeAt(0))))),this._onBinary.fire(a))}};i.CoreService=l=c([p(0,w.IBufferService),p(1,w.ILogService),p(2,w.IOptionsService)],l)},9074:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DecorationService=void 0;let c=r(8055),p=r(8460),d=r(844),f=r(6106),v=0,w=0;class b extends d.Disposable{get decorations(){return this._decorations.values()}constructor(){super(),this._decorations=new f.SortedList((a=>a?.marker.line)),this._onDecorationRegistered=this.register(new p.EventEmitter),this.onDecorationRegistered=this._onDecorationRegistered.event,this._onDecorationRemoved=this.register(new p.EventEmitter),this.onDecorationRemoved=this._onDecorationRemoved.event,this.register((0,d.toDisposable)((()=>this.reset())))}registerDecoration(a){if(a.marker.isDisposed)return;let h=new o(a);if(h){let _=h.marker.onDispose((()=>h.dispose()));h.onDispose((()=>{h&&(this._decorations.delete(h)&&this._onDecorationRemoved.fire(h),_.dispose())})),this._decorations.insert(h),this._onDecorationRegistered.fire(h)}return h}reset(){for(let a of this._decorations.values())a.dispose();this._decorations.clear()}*getDecorationsAtCell(a,h,_){var g,y,x;let m=0,S=0;for(let L of this._decorations.getKeyIterator(h))m=(g=L.options.x)!==null&&g!==void 0?g:0,S=m+((y=L.options.width)!==null&&y!==void 0?y:1),a>=m&&a<S&&(!_||((x=L.options.layer)!==null&&x!==void 0?x:"bottom")===_)&&(yield L)}forEachDecorationAtCell(a,h,_,g){this._decorations.forEachByKey(h,(y=>{var x,m,S;v=(x=y.options.x)!==null&&x!==void 0?x:0,w=v+((m=y.options.width)!==null&&m!==void 0?m:1),a>=v&&a<w&&(!_||((S=y.options.layer)!==null&&S!==void 0?S:"bottom")===_)&&g(y)}))}}i.DecorationService=b;class o extends d.Disposable{get isDisposed(){return this._isDisposed}get backgroundColorRGB(){return this._cachedBg===null&&(this.options.backgroundColor?this._cachedBg=c.css.toColor(this.options.backgroundColor):this._cachedBg=void 0),this._cachedBg}get foregroundColorRGB(){return this._cachedFg===null&&(this.options.foregroundColor?this._cachedFg=c.css.toColor(this.options.foregroundColor):this._cachedFg=void 0),this._cachedFg}constructor(a){super(),this.options=a,this.onRenderEmitter=this.register(new p.EventEmitter),this.onRender=this.onRenderEmitter.event,this._onDispose=this.register(new p.EventEmitter),this.onDispose=this._onDispose.event,this._cachedBg=null,this._cachedFg=null,this.marker=a.marker,this.options.overviewRulerOptions&&!this.options.overviewRulerOptions.position&&(this.options.overviewRulerOptions.position="full")}dispose(){this._onDispose.fire(),super.dispose()}}},4348:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.InstantiationService=i.ServiceCollection=void 0;let c=r(2585),p=r(8343);class d{constructor(...v){this._entries=new Map;for(let[w,b]of v)this.set(w,b)}set(v,w){let b=this._entries.get(v);return this._entries.set(v,w),b}forEach(v){for(let[w,b]of this._entries.entries())v(w,b)}has(v){return this._entries.has(v)}get(v){return this._entries.get(v)}}i.ServiceCollection=d,i.InstantiationService=class{constructor(){this._services=new d,this._services.set(c.IInstantiationService,this)}setService(f,v){this._services.set(f,v)}getService(f){return this._services.get(f)}createInstance(f,...v){let w=(0,p.getServiceDependencies)(f).sort(((l,a)=>l.index-a.index)),b=[];for(let l of w){let a=this._services.get(l.id);if(!a)throw new Error(`[createInstance] ${f.name} depends on UNKNOWN service ${l.id}.`);b.push(a)}let o=w.length>0?w[0].index:v.length;if(v.length!==o)throw new Error(`[createInstance] First service dependency of ${f.name} at position ${o+1} conflicts with ${v.length} static arguments`);return new f(...v,...b)}}},7866:function(u,i,r){var c=this&&this.__decorate||function(o,l,a,h){var _,g=arguments.length,y=g<3?l:h===null?h=Object.getOwnPropertyDescriptor(l,a):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(o,l,a,h);else for(var x=o.length-1;x>=0;x--)(_=o[x])&&(y=(g<3?_(y):g>3?_(l,a,y):_(l,a))||y);return g>3&&y&&Object.defineProperty(l,a,y),y},p=this&&this.__param||function(o,l){return function(a,h){l(a,h,o)}};Object.defineProperty(i,"__esModule",{value:!0}),i.traceCall=i.setTraceLogger=i.LogService=void 0;let d=r(844),f=r(2585),v={trace:f.LogLevelEnum.TRACE,debug:f.LogLevelEnum.DEBUG,info:f.LogLevelEnum.INFO,warn:f.LogLevelEnum.WARN,error:f.LogLevelEnum.ERROR,off:f.LogLevelEnum.OFF},w,b=i.LogService=class extends d.Disposable{get logLevel(){return this._logLevel}constructor(o){super(),this._optionsService=o,this._logLevel=f.LogLevelEnum.OFF,this._updateLogLevel(),this.register(this._optionsService.onSpecificOptionChange("logLevel",(()=>this._updateLogLevel()))),w=this}_updateLogLevel(){this._logLevel=v[this._optionsService.rawOptions.logLevel]}_evalLazyOptionalParams(o){for(let l=0;l<o.length;l++)typeof o[l]=="function"&&(o[l]=o[l]())}_log(o,l,a){this._evalLazyOptionalParams(a),o.call(console,(this._optionsService.options.logger?"":"xterm.js: ")+l,...a)}trace(o,...l){var a,h;this._logLevel<=f.LogLevelEnum.TRACE&&this._log((h=(a=this._optionsService.options.logger)===null||a===void 0?void 0:a.trace.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.log,o,l)}debug(o,...l){var a,h;this._logLevel<=f.LogLevelEnum.DEBUG&&this._log((h=(a=this._optionsService.options.logger)===null||a===void 0?void 0:a.debug.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.log,o,l)}info(o,...l){var a,h;this._logLevel<=f.LogLevelEnum.INFO&&this._log((h=(a=this._optionsService.options.logger)===null||a===void 0?void 0:a.info.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.info,o,l)}warn(o,...l){var a,h;this._logLevel<=f.LogLevelEnum.WARN&&this._log((h=(a=this._optionsService.options.logger)===null||a===void 0?void 0:a.warn.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.warn,o,l)}error(o,...l){var a,h;this._logLevel<=f.LogLevelEnum.ERROR&&this._log((h=(a=this._optionsService.options.logger)===null||a===void 0?void 0:a.error.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.error,o,l)}};i.LogService=b=c([p(0,f.IOptionsService)],b),i.setTraceLogger=function(o){w=o},i.traceCall=function(o,l,a){if(typeof a.value!="function")throw new Error("not supported");let h=a.value;a.value=function(..._){if(w.logLevel!==f.LogLevelEnum.TRACE)return h.apply(this,_);w.trace(`GlyphRenderer#${h.name}(${_.map((y=>JSON.stringify(y))).join(", ")})`);let g=h.apply(this,_);return w.trace(`GlyphRenderer#${h.name} return`,g),g}}},7302:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.OptionsService=i.DEFAULT_OPTIONS=void 0;let c=r(8460),p=r(844),d=r(6114);i.DEFAULT_OPTIONS={cols:80,rows:24,cursorBlink:!1,cursorStyle:"block",cursorWidth:1,cursorInactiveStyle:"outline",customGlyphs:!0,drawBoldTextInBrightColors:!0,fastScrollModifier:"alt",fastScrollSensitivity:5,fontFamily:"courier-new, courier, monospace",fontSize:15,fontWeight:"normal",fontWeightBold:"bold",ignoreBracketedPasteMode:!1,lineHeight:1,letterSpacing:0,linkHandler:null,logLevel:"info",logger:null,scrollback:1e3,scrollOnUserInput:!0,scrollSensitivity:1,screenReaderMode:!1,smoothScrollDuration:0,macOptionIsMeta:!1,macOptionClickForcesSelection:!1,minimumContrastRatio:1,disableStdin:!1,allowProposedApi:!1,allowTransparency:!1,tabStopWidth:8,theme:{},rightClickSelectsWord:d.isMac,windowOptions:{},windowsMode:!1,windowsPty:{},wordSeparator:" ()[]{}',\"`",altClickMovesCursor:!0,convertEol:!1,termName:"xterm",cancelEvents:!1,overviewRulerWidth:0};let f=["normal","bold","100","200","300","400","500","600","700","800","900"];class v extends p.Disposable{constructor(b){super(),this._onOptionChange=this.register(new c.EventEmitter),this.onOptionChange=this._onOptionChange.event;let o=Object.assign({},i.DEFAULT_OPTIONS);for(let l in b)if(l in o)try{let a=b[l];o[l]=this._sanitizeAndValidateOption(l,a)}catch(a){console.error(a)}this.rawOptions=o,this.options=Object.assign({},o),this._setupOptions()}onSpecificOptionChange(b,o){return this.onOptionChange((l=>{l===b&&o(this.rawOptions[b])}))}onMultipleOptionChange(b,o){return this.onOptionChange((l=>{b.indexOf(l)!==-1&&o()}))}_setupOptions(){let b=l=>{if(!(l in i.DEFAULT_OPTIONS))throw new Error(`No option with key "${l}"`);return this.rawOptions[l]},o=(l,a)=>{if(!(l in i.DEFAULT_OPTIONS))throw new Error(`No option with key "${l}"`);a=this._sanitizeAndValidateOption(l,a),this.rawOptions[l]!==a&&(this.rawOptions[l]=a,this._onOptionChange.fire(l))};for(let l in this.rawOptions){let a={get:b.bind(this,l),set:o.bind(this,l)};Object.defineProperty(this.options,l,a)}}_sanitizeAndValidateOption(b,o){switch(b){case"cursorStyle":if(o||(o=i.DEFAULT_OPTIONS[b]),!(function(l){return l==="block"||l==="underline"||l==="bar"})(o))throw new Error(`"${o}" is not a valid value for ${b}`);break;case"wordSeparator":o||(o=i.DEFAULT_OPTIONS[b]);break;case"fontWeight":case"fontWeightBold":if(typeof o=="number"&&1<=o&&o<=1e3)break;o=f.includes(o)?o:i.DEFAULT_OPTIONS[b];break;case"cursorWidth":o=Math.floor(o);case"lineHeight":case"tabStopWidth":if(o<1)throw new Error(`${b} cannot be less than 1, value: ${o}`);break;case"minimumContrastRatio":o=Math.max(1,Math.min(21,Math.round(10*o)/10));break;case"scrollback":if((o=Math.min(o,4294967295))<0)throw new Error(`${b} cannot be less than 0, value: ${o}`);break;case"fastScrollSensitivity":case"scrollSensitivity":if(o<=0)throw new Error(`${b} cannot be less than or equal to 0, value: ${o}`);break;case"rows":case"cols":if(!o&&o!==0)throw new Error(`${b} must be numeric, value: ${o}`);break;case"windowsPty":o=o??{}}return o}}i.OptionsService=v},2660:function(u,i,r){var c=this&&this.__decorate||function(v,w,b,o){var l,a=arguments.length,h=a<3?w:o===null?o=Object.getOwnPropertyDescriptor(w,b):o;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")h=Reflect.decorate(v,w,b,o);else for(var _=v.length-1;_>=0;_--)(l=v[_])&&(h=(a<3?l(h):a>3?l(w,b,h):l(w,b))||h);return a>3&&h&&Object.defineProperty(w,b,h),h},p=this&&this.__param||function(v,w){return function(b,o){w(b,o,v)}};Object.defineProperty(i,"__esModule",{value:!0}),i.OscLinkService=void 0;let d=r(2585),f=i.OscLinkService=class{constructor(v){this._bufferService=v,this._nextId=1,this._entriesWithId=new Map,this._dataByLinkId=new Map}registerLink(v){let w=this._bufferService.buffer;if(v.id===void 0){let _=w.addMarker(w.ybase+w.y),g={data:v,id:this._nextId++,lines:[_]};return _.onDispose((()=>this._removeMarkerFromLink(g,_))),this._dataByLinkId.set(g.id,g),g.id}let b=v,o=this._getEntryIdKey(b),l=this._entriesWithId.get(o);if(l)return this.addLineToLink(l.id,w.ybase+w.y),l.id;let a=w.addMarker(w.ybase+w.y),h={id:this._nextId++,key:this._getEntryIdKey(b),data:b,lines:[a]};return a.onDispose((()=>this._removeMarkerFromLink(h,a))),this._entriesWithId.set(h.key,h),this._dataByLinkId.set(h.id,h),h.id}addLineToLink(v,w){let b=this._dataByLinkId.get(v);if(b&&b.lines.every((o=>o.line!==w))){let o=this._bufferService.buffer.addMarker(w);b.lines.push(o),o.onDispose((()=>this._removeMarkerFromLink(b,o)))}}getLinkData(v){var w;return(w=this._dataByLinkId.get(v))===null||w===void 0?void 0:w.data}_getEntryIdKey(v){return`${v.id};;${v.uri}`}_removeMarkerFromLink(v,w){let b=v.lines.indexOf(w);b!==-1&&(v.lines.splice(b,1),v.lines.length===0&&(v.data.id!==void 0&&this._entriesWithId.delete(v.key),this._dataByLinkId.delete(v.id)))}};i.OscLinkService=f=c([p(0,d.IBufferService)],f)},8343:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.createDecorator=i.getServiceDependencies=i.serviceRegistry=void 0;let r="di$target",c="di$dependencies";i.serviceRegistry=new Map,i.getServiceDependencies=function(p){return p[c]||[]},i.createDecorator=function(p){if(i.serviceRegistry.has(p))return i.serviceRegistry.get(p);let d=function(f,v,w){if(arguments.length!==3)throw new Error("@IServiceName-decorator can only be used to decorate a parameter");(function(b,o,l){o[r]===o?o[c].push({id:b,index:l}):(o[c]=[{id:b,index:l}],o[r]=o)})(d,f,w)};return d.toString=()=>p,i.serviceRegistry.set(p,d),d}},2585:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.IDecorationService=i.IUnicodeService=i.IOscLinkService=i.IOptionsService=i.ILogService=i.LogLevelEnum=i.IInstantiationService=i.ICharsetService=i.ICoreService=i.ICoreMouseService=i.IBufferService=void 0;let c=r(8343);var p;i.IBufferService=(0,c.createDecorator)("BufferService"),i.ICoreMouseService=(0,c.createDecorator)("CoreMouseService"),i.ICoreService=(0,c.createDecorator)("CoreService"),i.ICharsetService=(0,c.createDecorator)("CharsetService"),i.IInstantiationService=(0,c.createDecorator)("InstantiationService"),(function(d){d[d.TRACE=0]="TRACE",d[d.DEBUG=1]="DEBUG",d[d.INFO=2]="INFO",d[d.WARN=3]="WARN",d[d.ERROR=4]="ERROR",d[d.OFF=5]="OFF"})(p||(i.LogLevelEnum=p={})),i.ILogService=(0,c.createDecorator)("LogService"),i.IOptionsService=(0,c.createDecorator)("OptionsService"),i.IOscLinkService=(0,c.createDecorator)("OscLinkService"),i.IUnicodeService=(0,c.createDecorator)("UnicodeService"),i.IDecorationService=(0,c.createDecorator)("DecorationService")},1480:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.UnicodeService=void 0;let c=r(8460),p=r(225);i.UnicodeService=class{constructor(){this._providers=Object.create(null),this._active="",this._onChange=new c.EventEmitter,this.onChange=this._onChange.event;let d=new p.UnicodeV6;this.register(d),this._active=d.version,this._activeProvider=d}dispose(){this._onChange.dispose()}get versions(){return Object.keys(this._providers)}get activeVersion(){return this._active}set activeVersion(d){if(!this._providers[d])throw new Error(`unknown Unicode version "${d}"`);this._active=d,this._activeProvider=this._providers[d],this._onChange.fire(d)}register(d){this._providers[d.version]=d}wcwidth(d){return this._activeProvider.wcwidth(d)}getStringCellWidth(d){let f=0,v=d.length;for(let w=0;w<v;++w){let b=d.charCodeAt(w);if(55296<=b&&b<=56319){if(++w>=v)return f+this.wcwidth(b);let o=d.charCodeAt(w);56320<=o&&o<=57343?b=1024*(b-55296)+o-56320+65536:f+=this.wcwidth(o)}f+=this.wcwidth(b)}return f}}}},t={};function s(u){var i=t[u];if(i!==void 0)return i.exports;var r=t[u]={exports:{}};return e[u].call(r.exports,r,r.exports,s),r.exports}var n={};return(()=>{var u=n;Object.defineProperty(u,"__esModule",{value:!0}),u.Terminal=void 0;let i=s(9042),r=s(3236),c=s(844),p=s(5741),d=s(8285),f=s(7975),v=s(7090),w=["cols","rows"];class b extends c.Disposable{constructor(l){super(),this._core=this.register(new r.Terminal(l)),this._addonManager=this.register(new p.AddonManager),this._publicOptions=Object.assign({},this._core.options);let a=_=>this._core.options[_],h=(_,g)=>{this._checkReadonlyOptions(_),this._core.options[_]=g};for(let _ in this._core.options){let g={get:a.bind(this,_),set:h.bind(this,_)};Object.defineProperty(this._publicOptions,_,g)}}_checkReadonlyOptions(l){if(w.includes(l))throw new Error(`Option "${l}" can only be set in the constructor`)}_checkProposedApi(){if(!this._core.optionsService.rawOptions.allowProposedApi)throw new Error("You must set the allowProposedApi option to true to use proposed API")}get onBell(){return this._core.onBell}get onBinary(){return this._core.onBinary}get onCursorMove(){return this._core.onCursorMove}get onData(){return this._core.onData}get onKey(){return this._core.onKey}get onLineFeed(){return this._core.onLineFeed}get onRender(){return this._core.onRender}get onResize(){return this._core.onResize}get onScroll(){return this._core.onScroll}get onSelectionChange(){return this._core.onSelectionChange}get onTitleChange(){return this._core.onTitleChange}get onWriteParsed(){return this._core.onWriteParsed}get element(){return this._core.element}get parser(){return this._parser||(this._parser=new f.ParserApi(this._core)),this._parser}get unicode(){return this._checkProposedApi(),new v.UnicodeApi(this._core)}get textarea(){return this._core.textarea}get rows(){return this._core.rows}get cols(){return this._core.cols}get buffer(){return this._buffer||(this._buffer=this.register(new d.BufferNamespaceApi(this._core))),this._buffer}get markers(){return this._checkProposedApi(),this._core.markers}get modes(){let l=this._core.coreService.decPrivateModes,a="none";switch(this._core.coreMouseService.activeProtocol){case"X10":a="x10";break;case"VT200":a="vt200";break;case"DRAG":a="drag";break;case"ANY":a="any"}return{applicationCursorKeysMode:l.applicationCursorKeys,applicationKeypadMode:l.applicationKeypad,bracketedPasteMode:l.bracketedPasteMode,insertMode:this._core.coreService.modes.insertMode,mouseTrackingMode:a,originMode:l.origin,reverseWraparoundMode:l.reverseWraparound,sendFocusMode:l.sendFocus,wraparoundMode:l.wraparound}}get options(){return this._publicOptions}set options(l){for(let a in l)this._publicOptions[a]=l[a]}blur(){this._core.blur()}focus(){this._core.focus()}resize(l,a){this._verifyIntegers(l,a),this._core.resize(l,a)}open(l){this._core.open(l)}attachCustomKeyEventHandler(l){this._core.attachCustomKeyEventHandler(l)}registerLinkProvider(l){return this._core.registerLinkProvider(l)}registerCharacterJoiner(l){return this._checkProposedApi(),this._core.registerCharacterJoiner(l)}deregisterCharacterJoiner(l){this._checkProposedApi(),this._core.deregisterCharacterJoiner(l)}registerMarker(l=0){return this._verifyIntegers(l),this._core.registerMarker(l)}registerDecoration(l){var a,h,_;return this._checkProposedApi(),this._verifyPositiveIntegers((a=l.x)!==null&&a!==void 0?a:0,(h=l.width)!==null&&h!==void 0?h:0,(_=l.height)!==null&&_!==void 0?_:0),this._core.registerDecoration(l)}hasSelection(){return this._core.hasSelection()}select(l,a,h){this._verifyIntegers(l,a,h),this._core.select(l,a,h)}getSelection(){return this._core.getSelection()}getSelectionPosition(){return this._core.getSelectionPosition()}clearSelection(){this._core.clearSelection()}selectAll(){this._core.selectAll()}selectLines(l,a){this._verifyIntegers(l,a),this._core.selectLines(l,a)}dispose(){super.dispose()}scrollLines(l){this._verifyIntegers(l),this._core.scrollLines(l)}scrollPages(l){this._verifyIntegers(l),this._core.scrollPages(l)}scrollToTop(){this._core.scrollToTop()}scrollToBottom(){this._core.scrollToBottom()}scrollToLine(l){this._verifyIntegers(l),this._core.scrollToLine(l)}clear(){this._core.clear()}write(l,a){this._core.write(l,a)}writeln(l,a){this._core.write(l),this._core.write(`\r
`,a)}paste(l){this._core.paste(l)}refresh(l,a){this._verifyIntegers(l,a),this._core.refresh(l,a)}reset(){this._core.reset()}clearTextureAtlas(){this._core.clearTextureAtlas()}loadAddon(l){this._addonManager.loadAddon(this,l)}static get strings(){return i}_verifyIntegers(...l){for(let a of l)if(a===1/0||isNaN(a)||a%1!=0)throw new Error("This API only accepts integers")}_verifyPositiveIntegers(...l){for(let a of l)if(a&&(a===1/0||isNaN(a)||a%1!=0||a<0))throw new Error("This API only accepts positive integers")}}u.Terminal=b})(),n})()))});var zo={};uo(zo,{FitAddon:()=>Fl});var Il,Hl,Fl,No=ho(()=>{Il=2,Hl=1,Fl=class{activate(e){this._terminal=e}dispose(){}fit(){let e=this.proposeDimensions();if(!e||!this._terminal||isNaN(e.cols)||isNaN(e.rows))return;let t=this._terminal._core;(this._terminal.rows!==e.rows||this._terminal.cols!==e.cols)&&(t._renderService.clear(),this._terminal.resize(e.cols,e.rows))}proposeDimensions(){if(!this._terminal||!this._terminal.element||!this._terminal.element.parentElement)return;let e=this._terminal._core._renderService.dimensions;if(e.css.cell.width===0||e.css.cell.height===0)return;let t=this._terminal.options.scrollback===0?0:this._terminal.options.overviewRuler?.width||14,s=window.getComputedStyle(this._terminal.element.parentElement),n=parseInt(s.getPropertyValue("height")),u=Math.max(0,parseInt(s.getPropertyValue("width"))),i=window.getComputedStyle(this._terminal.element),r={top:parseInt(i.getPropertyValue("padding-top")),bottom:parseInt(i.getPropertyValue("padding-bottom")),right:parseInt(i.getPropertyValue("padding-right")),left:parseInt(i.getPropertyValue("padding-left"))},c=r.top+r.bottom,p=r.right+r.left,d=n-c,f=u-p-t;return{cols:Math.max(Il,Math.floor(f/e.css.cell.width)),rows:Math.max(Hl,Math.floor(d/e.css.cell.height))}}}});var pn={};uo(pn,{SearchAddon:()=>Pc});function mr(e){Wl(e)||Nl.onUnexpectedError(e)}function Wl(e){return e instanceof Ul?!0:e instanceof Error&&e.name===br&&e.message===br}function jl(e,t,s=0,n=e.length){let u=s,i=n;for(;u<i;){let r=Math.floor((u+i)/2);t(e[r])?u=r+1:i=r}return u-1}function ql(e,t){return(s,n)=>t(e(s),e(n))}function Gl(e,t){let s=Object.create(null);for(let n of e){let u=t(n),i=s[u];i||(i=s[u]=[]),i.push(n)}return s}function Yl(e,t){let s=this,n=!1,u;return function(){if(n)return u;if(n=!0,t)try{u=e.apply(s,arguments)}finally{t()}else u=e.apply(s,arguments);return u}}function Ql(e){ti=e}function gs(e){return ti?.trackDisposable(e),e}function vs(e){ti?.markAsDisposed(e)}function Ri(e,t){ti?.setParent(e,t)}function ec(e,t){if(ti)for(let s of e)ti.setParent(s,t)}function Ti(e){if(Qo.is(e)){let t=[];for(let s of e)if(s)try{s.dispose()}catch(n){t.push(n)}if(t.length===1)throw t[0];if(t.length>1)throw new AggregateError(t,"Encountered errors while disposing of store");return Array.isArray(e)?[]:e}else if(e)return e.dispose(),e}function tn(...e){let t=ii(()=>Ti(e));return ec(e,t),t}function ii(e){let t=gs({dispose:Yl(()=>{vs(t),e()})});return t}function un(e,t=0,s){let n=setTimeout(()=>{e(),s&&u.dispose()},t),u=ii(()=>{clearTimeout(n),s?.deleteAndLeak(u)});return s?.add(u),u}var zl,Nl,br,Ul,Wo,Vl,Zo,Kl,Uo,jo,Vo,Ip,Xl,Qo,Jl,ti,Zl,sn,Lr,et,ms,qo,tc,ic,sc,Ko,rc,Dr,Cr,oc,Go,nn,nc,kr,ac,lc,cc,us,hc,dc,ps,Qe,uc,cn,pc,fc,ei,Er,Ar,fs,_c,mc,hn,gc,vc,bc,yc,ds,_s,Xo,wc,at,lt,$e,dn,Sc,gr,Cc,Hp,tt,bt,xc,kc,Ec,Ac,Fp,zp,Np,Wp,Lc,vr,Dc,Yo,Tc,Rc,Oc,Bc,Mc,Pc,fn=ho(()=>{zl=class{constructor(){this.listeners=[],this.unexpectedErrorHandler=function(e){setTimeout(()=>{throw e.stack?Wo.isErrorNoTelemetry(e)?new Wo(e.message+`

`+e.stack):new Error(e.message+`

`+e.stack):e},0)}}addListener(e){return this.listeners.push(e),()=>{this._removeListener(e)}}emit(e){this.listeners.forEach(t=>{t(e)})}_removeListener(e){this.listeners.splice(this.listeners.indexOf(e),1)}setUnexpectedErrorHandler(e){this.unexpectedErrorHandler=e}getUnexpectedErrorHandler(){return this.unexpectedErrorHandler}onUnexpectedError(e){this.unexpectedErrorHandler(e),this.emit(e)}onUnexpectedExternalError(e){this.unexpectedErrorHandler(e)}},Nl=new zl;br="Canceled";Ul=class extends Error{constructor(){super(br),this.name=this.message}},Wo=class yr extends Error{constructor(t){super(t),this.name="CodeExpectedError"}static fromError(t){if(t instanceof yr)return t;let s=new yr;return s.message=t.message,s.stack=t.stack,s}static isErrorNoTelemetry(t){return t.name==="CodeExpectedError"}};Vl=class Jo{constructor(t){this._array=t,this._findLastMonotonousLastIdx=0}findLastMonotonous(t){if(Jo.assertInvariants){if(this._prevFindLastPredicate){for(let n of this._array)if(this._prevFindLastPredicate(n)&&!t(n))throw new Error("MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.")}this._prevFindLastPredicate=t}let s=jl(this._array,t,this._findLastMonotonousLastIdx);return this._findLastMonotonousLastIdx=s+1,s===-1?void 0:this._array[s]}};Vl.assertInvariants=!1;(e=>{function t(i){return i<0}e.isLessThan=t;function s(i){return i<=0}e.isLessThanOrEqual=s;function n(i){return i>0}e.isGreaterThan=n;function u(i){return i===0}e.isNeitherLessOrGreaterThan=u,e.greaterThan=1,e.lessThan=-1,e.neitherLessOrGreaterThan=0})(Zo||(Zo={}));Kl=(e,t)=>e-t,Uo=class wr{constructor(t){this.iterate=t}forEach(t){this.iterate(s=>(t(s),!0))}toArray(){let t=[];return this.iterate(s=>(t.push(s),!0)),t}filter(t){return new wr(s=>this.iterate(n=>t(n)?s(n):!0))}map(t){return new wr(s=>this.iterate(n=>s(t(n))))}some(t){let s=!1;return this.iterate(n=>(s=t(n),!s)),s}findFirst(t){let s;return this.iterate(n=>t(n)?(s=n,!1):!0),s}findLast(t){let s;return this.iterate(n=>(t(n)&&(s=n),!0)),s}findLastMaxBy(t){let s,n=!0;return this.iterate(u=>((n||Zo.isGreaterThan(t(u,s)))&&(n=!1,s=u),!0)),s}};Uo.empty=new Uo(e=>{});Ip=class{constructor(e,t){this.toKey=t,this._map=new Map,this[jo]="SetWithKey";for(let s of e)this.add(s)}get size(){return this._map.size}add(e){let t=this.toKey(e);return this._map.set(t,e),this}delete(e){return this._map.delete(this.toKey(e))}has(e){return this._map.has(this.toKey(e))}*entries(){for(let e of this._map.values())yield[e,e]}keys(){return this.values()}*values(){for(let e of this._map.values())yield e}clear(){this._map.clear()}forEach(e,t){this._map.forEach(s=>e.call(t,s,s,this))}[(Vo=Symbol.iterator,jo=Symbol.toStringTag,Vo)](){return this.values()}},Xl=class{constructor(){this.map=new Map}add(e,t){let s=this.map.get(e);s||(s=new Set,this.map.set(e,s)),s.add(t)}delete(e,t){let s=this.map.get(e);s&&(s.delete(t),s.size===0&&this.map.delete(e))}forEach(e,t){let s=this.map.get(e);s&&s.forEach(t)}get(e){return this.map.get(e)||new Set}};(e=>{function t(y){return y&&typeof y=="object"&&typeof y[Symbol.iterator]=="function"}e.is=t;let s=Object.freeze([]);function n(){return s}e.empty=n;function*u(y){yield y}e.single=u;function i(y){return t(y)?y:u(y)}e.wrap=i;function r(y){return y||s}e.from=r;function*c(y){for(let x=y.length-1;x>=0;x--)yield y[x]}e.reverse=c;function p(y){return!y||y[Symbol.iterator]().next().done===!0}e.isEmpty=p;function d(y){return y[Symbol.iterator]().next().value}e.first=d;function f(y,x){let m=0;for(let S of y)if(x(S,m++))return!0;return!1}e.some=f;function v(y,x){for(let m of y)if(x(m))return m}e.find=v;function*w(y,x){for(let m of y)x(m)&&(yield m)}e.filter=w;function*b(y,x){let m=0;for(let S of y)yield x(S,m++)}e.map=b;function*o(y,x){let m=0;for(let S of y)yield*x(S,m++)}e.flatMap=o;function*l(...y){for(let x of y)yield*x}e.concat=l;function a(y,x,m){let S=m;for(let L of y)S=x(S,L);return S}e.reduce=a;function*h(y,x,m=y.length){for(x<0&&(x+=y.length),m<0?m+=y.length:m>y.length&&(m=y.length);x<m;x++)yield y[x]}e.slice=h;function _(y,x=Number.POSITIVE_INFINITY){let m=[];if(x===0)return[m,y];let S=y[Symbol.iterator]();for(let L=0;L<x;L++){let O=S.next();if(O.done)return[m,e.empty()];m.push(O.value)}return[m,{[Symbol.iterator](){return S}}]}e.consume=_;async function g(y){let x=[];for await(let m of y)x.push(m);return Promise.resolve(x)}e.asyncToArray=g})(Qo||(Qo={}));Jl=!1,ti=null,Zl=class en{constructor(){this.livingDisposables=new Map}getDisposableData(t){let s=this.livingDisposables.get(t);return s||(s={parent:null,source:null,isSingleton:!1,value:t,idx:en.idx++},this.livingDisposables.set(t,s)),s}trackDisposable(t){let s=this.getDisposableData(t);s.source||(s.source=new Error().stack)}setParent(t,s){let n=this.getDisposableData(t);n.parent=s}markAsDisposed(t){this.livingDisposables.delete(t)}markAsSingleton(t){this.getDisposableData(t).isSingleton=!0}getRootParent(t,s){let n=s.get(t);if(n)return n;let u=t.parent?this.getRootParent(this.getDisposableData(t.parent),s):t;return s.set(t,u),u}getTrackedDisposables(){let t=new Map;return[...this.livingDisposables.entries()].filter(([,s])=>s.source!==null&&!this.getRootParent(s,t).isSingleton).flatMap(([s])=>s)}computeLeakingDisposables(t=10,s){let n;if(s)n=s;else{let p=new Map,d=[...this.livingDisposables.values()].filter(v=>v.source!==null&&!this.getRootParent(v,p).isSingleton);if(d.length===0)return;let f=new Set(d.map(v=>v.value));if(n=d.filter(v=>!(v.parent&&f.has(v.parent))),n.length===0)throw new Error("There are cyclic diposable chains!")}if(!n)return;function u(p){function d(v,w){for(;v.length>0&&w.some(b=>typeof b=="string"?b===v[0]:v[0].match(b));)v.shift()}let f=p.source.split(`
`).map(v=>v.trim().replace("at ","")).filter(v=>v!=="");return d(f,["Error",/^trackDisposable \(.*\)$/,/^DisposableTracker.trackDisposable \(.*\)$/]),f.reverse()}let i=new Xl;for(let p of n){let d=u(p);for(let f=0;f<=d.length;f++)i.add(d.slice(0,f).join(`
`),p)}n.sort(ql(p=>p.idx,Kl));let r="",c=0;for(let p of n.slice(0,t)){c++;let d=u(p),f=[];for(let v=0;v<d.length;v++){let w=d[v];w=`(shared with ${i.get(d.slice(0,v+1).join(`
`)).size}/${n.length} leaks) at ${w}`;let b=i.get(d.slice(0,v).join(`
`)),o=Gl([...b].map(l=>u(l)[v]),l=>l);delete o[d[v]];for(let[l,a]of Object.entries(o))f.unshift(`    - stacktraces of ${a.length} other leaks continue with ${l}`);f.unshift(w)}r+=`


==================== Leaking disposable ${c}/${n.length}: ${p.value.constructor.name} ====================
${f.join(`
`)}
============================================================

`}return n.length>t&&(r+=`


... and ${n.length-t} more leaking disposables

`),{leaks:n,details:r}}};Zl.idx=0;if(Jl){let e="__is_disposable_tracked__";Ql(new class{trackDisposable(t){let s=new Error("Potentially leaked disposable").stack;setTimeout(()=>{t[e]||console.log(s)},3e3)}setParent(t,s){if(t&&t!==et.None)try{t[e]=!0}catch{}}markAsDisposed(t){if(t&&t!==et.None)try{t[e]=!0}catch{}}markAsSingleton(t){}})}sn=class rn{constructor(){this._toDispose=new Set,this._isDisposed=!1,gs(this)}dispose(){this._isDisposed||(vs(this),this._isDisposed=!0,this.clear())}get isDisposed(){return this._isDisposed}clear(){if(this._toDispose.size!==0)try{Ti(this._toDispose)}finally{this._toDispose.clear()}}add(t){if(!t)return t;if(t===this)throw new Error("Cannot register a disposable on itself!");return Ri(t,this),this._isDisposed?rn.DISABLE_DISPOSED_WARNING||console.warn(new Error("Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!").stack):this._toDispose.add(t),t}delete(t){if(t){if(t===this)throw new Error("Cannot dispose a disposable on itself!");this._toDispose.delete(t),t.dispose()}}deleteAndLeak(t){t&&this._toDispose.has(t)&&(this._toDispose.delete(t),Ri(t,null))}};sn.DISABLE_DISPOSED_WARNING=!1;Lr=sn,et=class{constructor(){this._store=new Lr,gs(this),Ri(this._store,this)}dispose(){vs(this),this._store.dispose()}_register(e){if(e===this)throw new Error("Cannot register a disposable on itself!");return this._store.add(e)}};et.None=Object.freeze({dispose(){}});ms=class{constructor(){this._isDisposed=!1,gs(this)}get value(){return this._isDisposed?void 0:this._value}set value(e){this._isDisposed||e===this._value||(this._value?.dispose(),e&&Ri(e,this),this._value=e)}clear(){this.value=void 0}dispose(){this._isDisposed=!0,vs(this),this._value?.dispose(),this._value=void 0}clearAndLeak(){let e=this._value;return this._value=void 0,e&&Ri(e,null),e}},qo=class Sr{constructor(t){this.element=t,this.next=Sr.Undefined,this.prev=Sr.Undefined}};qo.Undefined=new qo(void 0);tc=globalThis.performance&&typeof globalThis.performance.now=="function",ic=class on{static create(t){return new on(t)}constructor(t){this._now=tc&&t===!1?Date.now:globalThis.performance.now.bind(globalThis.performance),this._startTime=this._now(),this._stopTime=-1}stop(){this._stopTime=this._now()}reset(){this._startTime=this._now(),this._stopTime=-1}elapsed(){return this._stopTime!==-1?this._stopTime-this._startTime:this._now()-this._startTime}},sc=!1,Ko=!1,rc=!1;(e=>{e.None=()=>et.None;function t(P){if(rc){let{onDidAddListener:M}=P,I=kr.create(),C=0;P.onDidAddListener=()=>{++C===2&&(console.warn("snapshotted emitter LIKELY used public and SHOULD HAVE BEEN created with DisposableStore. snapshotted here"),I.print()),M?.()}}}function s(P,M){return w(P,()=>{},0,void 0,!0,void 0,M)}e.defer=s;function n(P){return(M,I=null,C)=>{let E=!1,A;return A=P(R=>{if(!E)return A?A.dispose():E=!0,M.call(I,R)},null,C),E&&A.dispose(),A}}e.once=n;function u(P,M,I){return f((C,E=null,A)=>P(R=>C.call(E,M(R)),null,A),I)}e.map=u;function i(P,M,I){return f((C,E=null,A)=>P(R=>{M(R),C.call(E,R)},null,A),I)}e.forEach=i;function r(P,M,I){return f((C,E=null,A)=>P(R=>M(R)&&C.call(E,R),null,A),I)}e.filter=r;function c(P){return P}e.signal=c;function p(...P){return(M,I=null,C)=>{let E=tn(...P.map(A=>A(R=>M.call(I,R))));return v(E,C)}}e.any=p;function d(P,M,I,C){let E=I;return u(P,A=>(E=M(E,A),E),C)}e.reduce=d;function f(P,M){let I,C={onWillAddFirstListener(){I=P(E.fire,E)},onDidRemoveLastListener(){I?.dispose()}};M||t(C);let E=new Qe(C);return M?.add(E),E.event}function v(P,M){return M instanceof Array?M.push(P):M&&M.add(P),P}function w(P,M,I=100,C=!1,E=!1,A,R){let N,j,K,q=0,he,k={leakWarningThreshold:A,onWillAddFirstListener(){N=P(U=>{q++,j=M(j,U),C&&!K&&(H.fire(j),j=void 0),he=()=>{let W=j;j=void 0,K=void 0,(!C||q>1)&&H.fire(W),q=0},typeof I=="number"?(clearTimeout(K),K=setTimeout(he,I)):K===void 0&&(K=0,queueMicrotask(he))})},onWillRemoveListener(){E&&q>0&&he?.()},onDidRemoveLastListener(){he=void 0,N.dispose()}};R||t(k);let H=new Qe(k);return R?.add(H),H.event}e.debounce=w;function b(P,M=0,I){return e.debounce(P,(C,E)=>C?(C.push(E),C):[E],M,void 0,!0,void 0,I)}e.accumulate=b;function o(P,M=(C,E)=>C===E,I){let C=!0,E;return r(P,A=>{let R=C||!M(A,E);return C=!1,E=A,R},I)}e.latch=o;function l(P,M,I){return[e.filter(P,M,I),e.filter(P,C=>!M(C),I)]}e.split=l;function a(P,M=!1,I=[],C){let E=I.slice(),A=P(j=>{E?E.push(j):N.fire(j)});C&&C.add(A);let R=()=>{E?.forEach(j=>N.fire(j)),E=null},N=new Qe({onWillAddFirstListener(){A||(A=P(j=>N.fire(j)),C&&C.add(A))},onDidAddFirstListener(){E&&(M?setTimeout(R):R())},onDidRemoveLastListener(){A&&A.dispose(),A=null}});return C&&C.add(N),N.event}e.buffer=a;function h(P,M){return(I,C,E)=>{let A=M(new g);return P(function(R){let N=A.evaluate(R);N!==_&&I.call(C,N)},void 0,E)}}e.chain=h;let _=Symbol("HaltChainable");class g{constructor(){this.steps=[]}map(M){return this.steps.push(M),this}forEach(M){return this.steps.push(I=>(M(I),I)),this}filter(M){return this.steps.push(I=>M(I)?I:_),this}reduce(M,I){let C=I;return this.steps.push(E=>(C=M(C,E),C)),this}latch(M=(I,C)=>I===C){let I=!0,C;return this.steps.push(E=>{let A=I||!M(E,C);return I=!1,C=E,A?E:_}),this}evaluate(M){for(let I of this.steps)if(M=I(M),M===_)break;return M}}function y(P,M,I=C=>C){let C=(...N)=>R.fire(I(...N)),E=()=>P.on(M,C),A=()=>P.removeListener(M,C),R=new Qe({onWillAddFirstListener:E,onDidRemoveLastListener:A});return R.event}e.fromNodeEventEmitter=y;function x(P,M,I=C=>C){let C=(...N)=>R.fire(I(...N)),E=()=>P.addEventListener(M,C),A=()=>P.removeEventListener(M,C),R=new Qe({onWillAddFirstListener:E,onDidRemoveLastListener:A});return R.event}e.fromDOMEventEmitter=x;function m(P){return new Promise(M=>n(P)(M))}e.toPromise=m;function S(P){let M=new Qe;return P.then(I=>{M.fire(I)},()=>{M.fire(void 0)}).finally(()=>{M.dispose()}),M.event}e.fromPromise=S;function L(P,M){return P(I=>M.fire(I))}e.forward=L;function O(P,M,I){return M(I),P(C=>M(C))}e.runAndSubscribe=O;class D{constructor(M,I){this._observable=M,this._counter=0,this._hasChanged=!1;let C={onWillAddFirstListener:()=>{M.addObserver(this)},onDidRemoveLastListener:()=>{M.removeObserver(this)}};I||t(C),this.emitter=new Qe(C),I&&I.add(this.emitter)}beginUpdate(M){this._counter++}handlePossibleChange(M){}handleChange(M,I){this._hasChanged=!0}endUpdate(M){this._counter--,this._counter===0&&(this._observable.reportChanges(),this._hasChanged&&(this._hasChanged=!1,this.emitter.fire(this._observable.get())))}}function B(P,M){return new D(P,M).emitter.event}e.fromObservable=B;function F(P){return(M,I,C)=>{let E=0,A=!1,R={beginUpdate(){E++},endUpdate(){E--,E===0&&(P.reportChanges(),A&&(A=!1,M.call(I)))},handlePossibleChange(){},handleChange(){A=!0}};P.addObserver(R),P.reportChanges();let N={dispose(){P.removeObserver(R)}};return C instanceof Lr?C.add(N):Array.isArray(C)&&C.push(N),N}}e.fromObservableLight=F})(Dr||(Dr={}));Cr=class xr{constructor(t){this.listenerCount=0,this.invocationCount=0,this.elapsedOverall=0,this.durations=[],this.name=`${t}_${xr._idPool++}`,xr.all.add(this)}start(t){this._stopWatch=new ic,this.listenerCount=t}stop(){if(this._stopWatch){let t=this._stopWatch.elapsed();this.durations.push(t),this.elapsedOverall+=t,this.invocationCount+=1,this._stopWatch=void 0}}};Cr.all=new Set,Cr._idPool=0;oc=Cr,Go=-1,nn=class an{constructor(t,s,n=(an._idPool++).toString(16).padStart(3,"0")){this._errorHandler=t,this.threshold=s,this.name=n,this._warnCountdown=0}dispose(){this._stacks?.clear()}check(t,s){let n=this.threshold;if(n<=0||s<n)return;this._stacks||(this._stacks=new Map);let u=this._stacks.get(t.value)||0;if(this._stacks.set(t.value,u+1),this._warnCountdown-=1,this._warnCountdown<=0){this._warnCountdown=n*.5;let[i,r]=this.getMostFrequentStack(),c=`[${this.name}] potential listener LEAK detected, having ${s} listeners already. MOST frequent listener (${r}):`;console.warn(c),console.warn(i);let p=new ac(c,i);this._errorHandler(p)}return()=>{let i=this._stacks.get(t.value)||0;this._stacks.set(t.value,i-1)}}getMostFrequentStack(){if(!this._stacks)return;let t,s=0;for(let[n,u]of this._stacks)(!t||s<u)&&(t=[n,u],s=u);return t}};nn._idPool=1;nc=nn,kr=class ln{constructor(t){this.value=t}static create(){let t=new Error;return new ln(t.stack??"")}print(){console.warn(this.value.split(`
`).slice(2).join(`
`))}},ac=class extends Error{constructor(e,t){super(e),this.name="ListenerLeakError",this.stack=t}},lc=class extends Error{constructor(e,t){super(e),this.name="ListenerRefusalError",this.stack=t}},cc=0,us=class{constructor(e){this.value=e,this.id=cc++}},hc=2,dc=(e,t)=>{if(e instanceof us)t(e);else for(let s=0;s<e.length;s++){let n=e[s];n&&t(n)}};if(sc){let e=[];setInterval(()=>{e.length!==0&&(console.warn("[LEAKING LISTENERS] GC'ed these listeners that were NOT yet disposed:"),console.warn(e.join(`
`)),e.length=0)},3e3),ps=new FinalizationRegistry(t=>{typeof t=="string"&&e.push(t)})}Qe=class{constructor(e){this._size=0,this._options=e,this._leakageMon=Go>0||this._options?.leakWarningThreshold?new nc(e?.onListenerError??mr,this._options?.leakWarningThreshold??Go):void 0,this._perfMon=this._options?._profName?new oc(this._options._profName):void 0,this._deliveryQueue=this._options?.deliveryQueue}dispose(){if(!this._disposed){if(this._disposed=!0,this._deliveryQueue?.current===this&&this._deliveryQueue.reset(),this._listeners){if(Ko){let e=this._listeners;queueMicrotask(()=>{dc(e,t=>t.stack?.print())})}this._listeners=void 0,this._size=0}this._options?.onDidRemoveLastListener?.(),this._leakageMon?.dispose()}}get event(){return this._event??(this._event=(e,t,s)=>{if(this._leakageMon&&this._size>this._leakageMon.threshold**2){let c=`[${this._leakageMon.name}] REFUSES to accept new listeners because it exceeded its threshold by far (${this._size} vs ${this._leakageMon.threshold})`;console.warn(c);let p=this._leakageMon.getMostFrequentStack()??["UNKNOWN stack",-1],d=new lc(`${c}. HINT: Stack shows most frequent listener (${p[1]}-times)`,p[0]);return(this._options?.onListenerError||mr)(d),et.None}if(this._disposed)return et.None;t&&(e=e.bind(t));let n=new us(e),u,i;this._leakageMon&&this._size>=Math.ceil(this._leakageMon.threshold*.2)&&(n.stack=kr.create(),u=this._leakageMon.check(n.stack,this._size+1)),Ko&&(n.stack=i??kr.create()),this._listeners?this._listeners instanceof us?(this._deliveryQueue??(this._deliveryQueue=new uc),this._listeners=[this._listeners,n]):this._listeners.push(n):(this._options?.onWillAddFirstListener?.(this),this._listeners=n,this._options?.onDidAddFirstListener?.(this)),this._size++;let r=ii(()=>{ps?.unregister(r),u?.(),this._removeListener(n)});if(s instanceof Lr?s.add(r):Array.isArray(s)&&s.push(r),ps){let c=new Error().stack.split(`
`).slice(2,3).join(`
`).trim(),p=/(file:|vscode-file:\/\/vscode-app)?(\/[^:]*:\d+:\d+)/.exec(c);ps.register(r,p?.[2]??c,r)}return r}),this._event}_removeListener(e){if(this._options?.onWillRemoveListener?.(this),!this._listeners)return;if(this._size===1){this._listeners=void 0,this._options?.onDidRemoveLastListener?.(this),this._size=0;return}let t=this._listeners,s=t.indexOf(e);if(s===-1)throw console.log("disposed?",this._disposed),console.log("size?",this._size),console.log("arr?",JSON.stringify(this._listeners)),new Error("Attempted to dispose unknown listener");this._size--,t[s]=void 0;let n=this._deliveryQueue.current===this;if(this._size*hc<=t.length){let u=0;for(let i=0;i<t.length;i++)t[i]?t[u++]=t[i]:n&&(this._deliveryQueue.end--,u<this._deliveryQueue.i&&this._deliveryQueue.i--);t.length=u}}_deliver(e,t){if(!e)return;let s=this._options?.onListenerError||mr;if(!s){e.value(t);return}try{e.value(t)}catch(n){s(n)}}_deliverQueue(e){let t=e.current._listeners;for(;e.i<e.end;)this._deliver(t[e.i++],e.value);e.reset()}fire(e){if(this._deliveryQueue?.current&&(this._deliverQueue(this._deliveryQueue),this._perfMon?.stop()),this._perfMon?.start(this._size),this._listeners)if(this._listeners instanceof us)this._deliver(this._listeners,e);else{let t=this._deliveryQueue;t.enqueue(this,e,this._listeners.length),this._deliverQueue(t)}this._perfMon?.stop()}hasListeners(){return this._size>0}},uc=class{constructor(){this.i=-1,this.end=0}enqueue(e,t,s){this.i=0,this.end=s,this.current=e,this.value=t}reset(){this.i=this.end,this.current=void 0,this.value=void 0}},cn=Object.freeze(function(e,t){let s=setTimeout(e.bind(t),0);return{dispose(){clearTimeout(s)}}});(e=>{function t(s){return s===e.None||s===e.Cancelled||s instanceof fc?!0:!s||typeof s!="object"?!1:typeof s.isCancellationRequested=="boolean"&&typeof s.onCancellationRequested=="function"}e.isCancellationToken=t,e.None=Object.freeze({isCancellationRequested:!1,onCancellationRequested:Dr.None}),e.Cancelled=Object.freeze({isCancellationRequested:!0,onCancellationRequested:cn})})(pc||(pc={}));fc=class{constructor(){this._isCancelled=!1,this._emitter=null}cancel(){this._isCancelled||(this._isCancelled=!0,this._emitter&&(this._emitter.fire(void 0),this.dispose()))}get isCancellationRequested(){return this._isCancelled}get onCancellationRequested(){return this._isCancelled?cn:(this._emitter||(this._emitter=new Qe),this._emitter.event)}dispose(){this._emitter&&(this._emitter.dispose(),this._emitter=null)}},ei="en",Er=!1,Ar=!1,fs=!1,_c=!1,mc=!1,hn=!1,gc=!1,vc=!1,bc=!1,yc=!1,_s=ei,Xo=ei,lt=globalThis;typeof lt.vscode<"u"&&typeof lt.vscode.process<"u"?$e=lt.vscode.process:typeof process<"u"&&typeof process?.versions?.node=="string"&&($e=process);dn=typeof $e?.versions?.electron=="string",Sc=dn&&$e?.type==="renderer";if(typeof $e=="object"){Er=$e.platform==="win32",Ar=$e.platform==="darwin",fs=$e.platform==="linux",_c=fs&&!!$e.env.SNAP&&!!$e.env.SNAP_REVISION,gc=dn,bc=!!$e.env.CI||!!$e.env.BUILD_ARTIFACTSTAGINGDIRECTORY,ds=ei,_s=ei;let e=$e.env.VSCODE_NLS_CONFIG;if(e)try{let t=JSON.parse(e);ds=t.userLocale,Xo=t.osLocale,_s=t.resolvedLanguage||ei,wc=t.languagePack?.translationsConfigFile}catch{}mc=!0}else typeof navigator=="object"&&!Sc?(at=navigator.userAgent,Er=at.indexOf("Windows")>=0,Ar=at.indexOf("Macintosh")>=0,vc=(at.indexOf("Macintosh")>=0||at.indexOf("iPad")>=0||at.indexOf("iPhone")>=0)&&!!navigator.maxTouchPoints&&navigator.maxTouchPoints>0,fs=at.indexOf("Linux")>=0,yc=at?.indexOf("Mobi")>=0,hn=!0,_s=globalThis._VSCODE_NLS_LANGUAGE||ei,ds=navigator.language.toLowerCase(),Xo=ds):console.error("Unable to resolve platform.");gr=0;Ar?gr=1:Er?gr=3:fs&&(gr=2);Cc=hn&&typeof lt.importScripts=="function",Hp=Cc?lt.origin:void 0,tt=at,bt=_s;(e=>{function t(){return bt}e.value=t;function s(){return bt.length===2?bt==="en":bt.length>=3?bt[0]==="e"&&bt[1]==="n"&&bt[2]==="-":!1}e.isDefaultVariant=s;function n(){return bt==="en"}e.isDefault=n})(xc||(xc={}));kc=typeof lt.postMessage=="function"&&!lt.importScripts,Ec=(()=>{if(kc){let e=[];lt.addEventListener("message",s=>{if(s.data&&s.data.vscodeScheduleAsyncWork)for(let n=0,u=e.length;n<u;n++){let i=e[n];if(i.id===s.data.vscodeScheduleAsyncWork){e.splice(n,1),i.callback();return}}});let t=0;return s=>{let n=++t;e.push({id:n,callback:s}),lt.postMessage({vscodeScheduleAsyncWork:n},"*")}}return e=>setTimeout(e)})(),Ac=!!(tt&&tt.indexOf("Chrome")>=0),Fp=!!(tt&&tt.indexOf("Firefox")>=0),zp=!!(!Ac&&tt&&tt.indexOf("Safari")>=0),Np=!!(tt&&tt.indexOf("Edg/")>=0),Wp=!!(tt&&tt.indexOf("Android")>=0);(function(){typeof globalThis.requestIdleCallback!="function"||typeof globalThis.cancelIdleCallback!="function"?vr=(e,t)=>{Ec(()=>{if(s)return;let n=Date.now()+15;t(Object.freeze({didTimeout:!0,timeRemaining(){return Math.max(0,n-Date.now())}}))});let s=!1;return{dispose(){s||(s=!0)}}}:vr=(e,t,s)=>{let n=e.requestIdleCallback(t,typeof s=="number"?{timeout:s}:void 0),u=!1;return{dispose(){u||(u=!0,e.cancelIdleCallback(n))}}},Lc=e=>vr(globalThis,e)})();(e=>{async function t(n){let u,i=await Promise.all(n.map(r=>r.then(c=>c,c=>{u||(u=c)})));if(typeof u<"u")throw u;return i}e.settled=t;function s(n){return new Promise(async(u,i)=>{try{await n(u,i)}catch(r){i(r)}})}e.withAsyncBody=s})(Dc||(Dc={}));Yo=class ze{static fromArray(t){return new ze(s=>{s.emitMany(t)})}static fromPromise(t){return new ze(async s=>{s.emitMany(await t)})}static fromPromises(t){return new ze(async s=>{await Promise.all(t.map(async n=>s.emitOne(await n)))})}static merge(t){return new ze(async s=>{await Promise.all(t.map(async n=>{for await(let u of n)s.emitOne(u)}))})}constructor(t,s){this._state=0,this._results=[],this._error=null,this._onReturn=s,this._onStateChanged=new Qe,queueMicrotask(async()=>{let n={emitOne:u=>this.emitOne(u),emitMany:u=>this.emitMany(u),reject:u=>this.reject(u)};try{await Promise.resolve(t(n)),this.resolve()}catch(u){this.reject(u)}finally{n.emitOne=void 0,n.emitMany=void 0,n.reject=void 0}})}[Symbol.asyncIterator](){let t=0;return{next:async()=>{do{if(this._state===2)throw this._error;if(t<this._results.length)return{done:!1,value:this._results[t++]};if(this._state===1)return{done:!0,value:void 0};await Dr.toPromise(this._onStateChanged.event)}while(!0)},return:async()=>(this._onReturn?.(),{done:!0,value:void 0})}}static map(t,s){return new ze(async n=>{for await(let u of t)n.emitOne(s(u))})}map(t){return ze.map(this,t)}static filter(t,s){return new ze(async n=>{for await(let u of t)s(u)&&n.emitOne(u)})}filter(t){return ze.filter(this,t)}static coalesce(t){return ze.filter(t,s=>!!s)}coalesce(){return ze.coalesce(this)}static async toPromise(t){let s=[];for await(let n of t)s.push(n);return s}toPromise(){return ze.toPromise(this)}emitOne(t){this._state===0&&(this._results.push(t),this._onStateChanged.fire())}emitMany(t){this._state===0&&(this._results=this._results.concat(t),this._onStateChanged.fire())}resolve(){this._state===0&&(this._state=1,this._onStateChanged.fire())}reject(t){this._state===0&&(this._state=2,this._error=t,this._onStateChanged.fire())}};Yo.EMPTY=Yo.fromArray([]);Tc=class extends et{constructor(e){super(),this._terminal=e,this._linesCacheTimeout=this._register(new ms),this._linesCacheDisposables=this._register(new ms),this._register(ii(()=>this._destroyLinesCache()))}initLinesCache(){this._linesCache||(this._linesCache=new Array(this._terminal.buffer.active.length),this._linesCacheDisposables.value=tn(this._terminal.onLineFeed(()=>this._destroyLinesCache()),this._terminal.onCursorMove(()=>this._destroyLinesCache()),this._terminal.onResize(()=>this._destroyLinesCache()))),this._linesCacheTimeout.value=un(()=>this._destroyLinesCache(),15e3)}_destroyLinesCache(){this._linesCache=void 0,this._linesCacheDisposables.clear(),this._linesCacheTimeout.clear()}getLineFromCache(e){return this._linesCache?.[e]}setLineInCache(e,t){this._linesCache&&(this._linesCache[e]=t)}translateBufferLineToStringWithWrap(e,t){let s=[],n=[0],u=this._terminal.buffer.active.getLine(e);for(;u;){let i=this._terminal.buffer.active.getLine(e+1),r=i?i.isWrapped:!1,c=u.translateToString(!r&&t);if(r&&i){let p=u.getCell(u.length-1);p&&p.getCode()===0&&p.getWidth()===1&&i.getCell(0)?.getWidth()===2&&(c=c.slice(0,-1))}if(s.push(c),r)n.push(n[n.length-1]+c.length);else break;e++,u=i}return[s.join(""),n]}},Rc=class{get cachedSearchTerm(){return this._cachedSearchTerm}set cachedSearchTerm(e){this._cachedSearchTerm=e}get lastSearchOptions(){return this._lastSearchOptions}set lastSearchOptions(e){this._lastSearchOptions=e}isValidSearchTerm(e){return!!(e&&e.length>0)}didOptionsChange(e){return this._lastSearchOptions?e?this._lastSearchOptions.caseSensitive!==e.caseSensitive||this._lastSearchOptions.regex!==e.regex||this._lastSearchOptions.wholeWord!==e.wholeWord:!1:!0}shouldUpdateHighlighting(e,t){return t?.decorations?this._cachedSearchTerm===void 0||e!==this._cachedSearchTerm||this.didOptionsChange(t):!1}clearCachedTerm(){this._cachedSearchTerm=void 0}reset(){this._cachedSearchTerm=void 0,this._lastSearchOptions=void 0}},Oc=class{constructor(e,t){this._terminal=e,this._lineCache=t}find(e,t,s,n){if(!e||e.length===0){this._terminal.clearSelection();return}if(s>this._terminal.cols)throw new Error(`Invalid col: ${s} to search in terminal of ${this._terminal.cols} cols`);this._lineCache.initLinesCache();let u={startRow:t,startCol:s},i=this._findInLine(e,u,n);if(!i)for(let r=t+1;r<this._terminal.buffer.active.baseY+this._terminal.rows&&(u.startRow=r,u.startCol=0,i=this._findInLine(e,u,n),!i);r++);return i}findNextWithSelection(e,t,s){if(!e||e.length===0){this._terminal.clearSelection();return}let n=this._terminal.getSelectionPosition();this._terminal.clearSelection();let u=0,i=0;n&&(s===e?(u=n.end.x,i=n.end.y):(u=n.start.x,i=n.start.y)),this._lineCache.initLinesCache();let r={startRow:i,startCol:u},c=this._findInLine(e,r,t);if(!c)for(let p=i+1;p<this._terminal.buffer.active.baseY+this._terminal.rows&&(r.startRow=p,r.startCol=0,c=this._findInLine(e,r,t),!c);p++);if(!c&&i!==0)for(let p=0;p<i&&(r.startRow=p,r.startCol=0,c=this._findInLine(e,r,t),!c);p++);return!c&&n&&(r.startRow=n.start.y,r.startCol=0,c=this._findInLine(e,r,t)),c}findPreviousWithSelection(e,t,s){if(!e||e.length===0){this._terminal.clearSelection();return}let n=this._terminal.getSelectionPosition();this._terminal.clearSelection();let u=this._terminal.buffer.active.baseY+this._terminal.rows-1,i=this._terminal.cols,r=!0;this._lineCache.initLinesCache();let c={startRow:u,startCol:i},p;if(n&&(c.startRow=u=n.start.y,c.startCol=i=n.start.x,s!==e&&(p=this._findInLine(e,c,t,!1),p||(c.startRow=u=n.end.y,c.startCol=i=n.end.x))),p||(p=this._findInLine(e,c,t,r)),!p){c.startCol=Math.max(c.startCol,this._terminal.cols);for(let d=u-1;d>=0&&(c.startRow=d,p=this._findInLine(e,c,t,r),!p);d--);}if(!p&&u!==this._terminal.buffer.active.baseY+this._terminal.rows-1)for(let d=this._terminal.buffer.active.baseY+this._terminal.rows-1;d>=u&&(c.startRow=d,p=this._findInLine(e,c,t,r),!p);d--);return p}_isWholeWord(e,t,s){return(e===0||" ~!@#$%^&*()+`-=[]{}|\\;:\"',./<>?".includes(t[e-1]))&&(e+s.length===t.length||" ~!@#$%^&*()+`-=[]{}|\\;:\"',./<>?".includes(t[e+s.length]))}_findInLine(e,t,s={},n=!1){let u=t.startRow,i=t.startCol;if(this._terminal.buffer.active.getLine(u)?.isWrapped){if(n){t.startCol+=this._terminal.cols;return}return t.startRow--,t.startCol+=this._terminal.cols,this._findInLine(e,t,s)}let r=this._lineCache.getLineFromCache(u);r||(r=this._lineCache.translateBufferLineToStringWithWrap(u,!0),this._lineCache.setLineInCache(u,r));let[c,p]=r,d=this._bufferColsToStringOffset(u,i),f=e,v=c;s.regex||(f=s.caseSensitive?e:e.toLowerCase(),v=s.caseSensitive?c:c.toLowerCase());let w=-1;if(s.regex){let b=RegExp(f,s.caseSensitive?"g":"gi"),o;if(n)for(;o=b.exec(v.slice(0,d));)w=b.lastIndex-o[0].length,e=o[0],b.lastIndex-=e.length-1;else o=b.exec(v.slice(d)),o&&o[0].length>0&&(w=d+(b.lastIndex-o[0].length),e=o[0])}else n?d-f.length>=0&&(w=v.lastIndexOf(f,d-f.length)):w=v.indexOf(f,d);if(w>=0){if(s.wholeWord&&!this._isWholeWord(w,v,e))return;let b=0;for(;b<p.length-1&&w>=p[b+1];)b++;let o=b;for(;o<p.length-1&&w+e.length>=p[o+1];)o++;let l=w-p[b],a=w+e.length-p[o],h=this._stringLengthToBufferSize(u+b,l),_=this._stringLengthToBufferSize(u+o,a)-h+this._terminal.cols*(o-b);return{term:e,col:h,row:u+b,size:_}}}_stringLengthToBufferSize(e,t){let s=this._terminal.buffer.active.getLine(e);if(!s)return 0;for(let n=0;n<t;n++){let u=s.getCell(n);if(!u)break;let i=u.getChars();i.length>1&&(t-=i.length-1);let r=s.getCell(n+1);r&&r.getWidth()===0&&t++}return t}_bufferColsToStringOffset(e,t){let s=e,n=0,u=this._terminal.buffer.active.getLine(s);for(;t>0&&u;){for(let i=0;i<t&&i<this._terminal.cols;i++){let r=u.getCell(i);if(!r)break;r.getWidth()&&(n+=r.getCode()===0?1:r.getChars().length)}if(s++,u=this._terminal.buffer.active.getLine(s),u&&!u.isWrapped)break;t-=this._terminal.cols}return n}},Bc=class extends et{constructor(e){super(),this._terminal=e,this._highlightDecorations=[],this._highlightedLines=new Set,this._register(ii(()=>this.clearHighlightDecorations()))}createHighlightDecorations(e,t){this.clearHighlightDecorations();for(let s of e){let n=this._createResultDecorations(s,t,!1);if(n)for(let u of n)this._storeDecoration(u,s)}}createActiveDecoration(e,t){let s=this._createResultDecorations(e,t,!0);if(s)return{decorations:s,match:e,dispose(){Ti(s)}}}clearHighlightDecorations(){Ti(this._highlightDecorations),this._highlightDecorations=[],this._highlightedLines.clear()}_storeDecoration(e,t){this._highlightedLines.add(e.marker.line),this._highlightDecorations.push({decoration:e,match:t,dispose(){e.dispose()}})}_applyStyles(e,t,s){e.classList.contains("xterm-find-result-decoration")||(e.classList.add("xterm-find-result-decoration"),t&&(e.style.outline=`1px solid ${t}`)),s&&e.classList.add("xterm-find-active-result-decoration")}_createResultDecorations(e,t,s){let n=[],u=e.col,i=e.size,r=-this._terminal.buffer.active.baseY-this._terminal.buffer.active.cursorY+e.row;for(;i>0;){let p=Math.min(this._terminal.cols-u,i);n.push([r,u,p]),u=0,i-=p,r++}let c=[];for(let p of n){let d=this._terminal.registerMarker(p[0]),f=this._terminal.registerDecoration({marker:d,x:p[1],width:p[2],backgroundColor:s?t.activeMatchBackground:t.matchBackground,overviewRulerOptions:this._highlightedLines.has(d.line)?void 0:{color:s?t.activeMatchColorOverviewRuler:t.matchOverviewRuler,position:"center"}});if(f){let v=[];v.push(d),v.push(f.onRender(w=>this._applyStyles(w,s?t.activeMatchBorder:t.matchBorder,!1))),v.push(f.onDispose(()=>Ti(v))),c.push(f)}}return c.length===0?void 0:c}},Mc=class extends et{constructor(){super(...arguments),this._searchResults=[],this._onDidChangeResults=this._register(new Qe)}get onDidChangeResults(){return this._onDidChangeResults.event}get searchResults(){return this._searchResults}get selectedDecoration(){return this._selectedDecoration}set selectedDecoration(e){this._selectedDecoration=e}updateResults(e,t){this._searchResults=e.slice(0,t)}clearResults(){this._searchResults=[]}clearSelectedDecoration(){this._selectedDecoration&&(this._selectedDecoration.dispose(),this._selectedDecoration=void 0)}findResultIndex(e){for(let t=0;t<this._searchResults.length;t++){let s=this._searchResults[t];if(s.row===e.row&&s.col===e.col&&s.size===e.size)return t}return-1}fireResultsChanged(e){if(!e)return;let t=-1;this._selectedDecoration&&(t=this.findResultIndex(this._selectedDecoration.match)),this._onDidChangeResults.fire({resultIndex:t,resultCount:this._searchResults.length})}reset(){this.clearSelectedDecoration(),this.clearResults()}},Pc=class extends et{constructor(e){super(),this._highlightTimeout=this._register(new ms),this._lineCache=this._register(new ms),this._state=new Rc,this._resultTracker=this._register(new Mc),this._highlightLimit=e?.highlightLimit??1e3}get onDidChangeResults(){return this._resultTracker.onDidChangeResults}activate(e){this._terminal=e,this._lineCache.value=new Tc(e),this._engine=new Oc(e,this._lineCache.value),this._decorationManager=new Bc(e),this._register(this._terminal.onWriteParsed(()=>this._updateMatches())),this._register(this._terminal.onResize(()=>this._updateMatches())),this._register(ii(()=>this.clearDecorations()))}_updateMatches(){this._highlightTimeout.clear(),this._state.cachedSearchTerm&&this._state.lastSearchOptions?.decorations&&(this._highlightTimeout.value=un(()=>{let e=this._state.cachedSearchTerm;this._state.clearCachedTerm(),this.findPrevious(e,{...this._state.lastSearchOptions,incremental:!0},{noScroll:!0})},200))}clearDecorations(e){this._resultTracker.clearSelectedDecoration(),this._decorationManager?.clearHighlightDecorations(),this._resultTracker.clearResults(),e||this._state.clearCachedTerm()}clearActiveDecoration(){this._resultTracker.clearSelectedDecoration()}findNext(e,t,s){if(!this._terminal||!this._engine)throw new Error("Cannot use addon until it has been loaded");this._state.lastSearchOptions=t,this._state.shouldUpdateHighlighting(e,t)&&this._highlightAllMatches(e,t);let n=this._findNextAndSelect(e,t,s);return this._fireResults(t),this._state.cachedSearchTerm=e,n}_highlightAllMatches(e,t){if(!this._terminal||!this._engine||!this._decorationManager)throw new Error("Cannot use addon until it has been loaded");if(!this._state.isValidSearchTerm(e)){this.clearDecorations();return}this.clearDecorations(!0);let s=[],n,u=this._engine.find(e,0,0,t);for(;u&&(n?.row!==u.row||n?.col!==u.col)&&!(s.length>=this._highlightLimit);)n=u,s.push(n),u=this._engine.find(e,n.col+n.term.length>=this._terminal.cols?n.row+1:n.row,n.col+n.term.length>=this._terminal.cols?0:n.col+1,t);this._resultTracker.updateResults(s,this._highlightLimit),t.decorations&&this._decorationManager.createHighlightDecorations(s,t.decorations)}_findNextAndSelect(e,t,s){if(!this._terminal||!this._engine)return!1;if(!this._state.isValidSearchTerm(e))return this._terminal.clearSelection(),this.clearDecorations(),!1;let n=this._engine.findNextWithSelection(e,t,this._state.cachedSearchTerm);return this._selectResult(n,t?.decorations,s?.noScroll)}findPrevious(e,t,s){if(!this._terminal||!this._engine)throw new Error("Cannot use addon until it has been loaded");this._state.lastSearchOptions=t,this._state.shouldUpdateHighlighting(e,t)&&this._highlightAllMatches(e,t);let n=this._findPreviousAndSelect(e,t,s);return this._fireResults(t),this._state.cachedSearchTerm=e,n}_fireResults(e){this._resultTracker.fireResultsChanged(!!e?.decorations)}_findPreviousAndSelect(e,t,s){if(!this._terminal||!this._engine)return!1;if(!this._state.isValidSearchTerm(e))return this._terminal.clearSelection(),this.clearDecorations(),!1;let n=this._engine.findPreviousWithSelection(e,t,this._state.cachedSearchTerm);return this._selectResult(n,t?.decorations,s?.noScroll)}_selectResult(e,t,s){if(!this._terminal||!this._decorationManager)return!1;if(this._resultTracker.clearSelectedDecoration(),!e)return this._terminal.clearSelection(),!1;if(this._terminal.select(e.col,e.row,e.size),t){let n=this._decorationManager.createActiveDecoration(e,t);n&&(this._resultTracker.selectedDecoration=n)}if(!s&&(e.row>=this._terminal.buffer.active.viewportY+this._terminal.rows||e.row<this._terminal.buffer.active.viewportY)){let n=e.row-this._terminal.buffer.active.viewportY;n-=Math.floor(this._terminal.rows/2),this._terminal.scrollLines(n)}return!0}}});var bi=globalThis,po=e=>e,Qi=bi.trustedTypes,fo=Qi?Qi.createPolicy("lit-html",{createHTML:e=>e}):void 0,Gs="$lit$",nt=`lit$${Math.random().toFixed(9).slice(2)}$`,Xs="?"+nt,ml=`<${Xs}>`,At=document,yi=()=>At.createComment(""),wi=e=>e===null||typeof e!="object"&&typeof e!="function",Ys=Array.isArray,yo=e=>Ys(e)||typeof e?.[Symbol.iterator]=="function",Ks=`[ 	
\f\r]`,vi=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,_o=/-->/g,mo=/>/g,kt=RegExp(`>|${Ks}(?:([^\\s"'>=/]+)(${Ks}*=${Ks}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),go=/'/g,vo=/"/g,wo=/^(?:script|style|textarea|title)$/i,Js=e=>(t,...s)=>({_$litType$:e,strings:t,values:s}),z=Js(1),So=Js(2),Co=Js(3),De=Symbol.for("lit-noChange"),ee=Symbol.for("lit-nothing"),bo=new WeakMap,Et=At.createTreeWalker(At,129);function xo(e,t){if(!Ys(e)||!e.hasOwnProperty("raw"))throw Error("invalid template strings array");return fo!==void 0?fo.createHTML(t):t}var ko=(e,t)=>{let s=e.length-1,n=[],u,i=t===2?"<svg>":t===3?"<math>":"",r=vi;for(let c=0;c<s;c++){let p=e[c],d,f,v=-1,w=0;for(;w<p.length&&(r.lastIndex=w,f=r.exec(p),f!==null);)w=r.lastIndex,r===vi?f[1]==="!--"?r=_o:f[1]!==void 0?r=mo:f[2]!==void 0?(wo.test(f[2])&&(u=RegExp("</"+f[2],"g")),r=kt):f[3]!==void 0&&(r=kt):r===kt?f[0]===">"?(r=u??vi,v=-1):f[1]===void 0?v=-2:(v=r.lastIndex-f[2].length,d=f[1],r=f[3]===void 0?kt:f[3]==='"'?vo:go):r===vo||r===go?r=kt:r===_o||r===mo?r=vi:(r=kt,u=void 0);let b=r===kt&&e[c+1].startsWith("/>")?" ":"";i+=r===vi?p+ml:v>=0?(n.push(d),p.slice(0,v)+Gs+p.slice(v)+nt+b):p+nt+(v===-2?c:b)}return[xo(e,i+(e[s]||"<?>")+(t===2?"</svg>":t===3?"</math>":"")),n]},Si=class e{constructor({strings:t,_$litType$:s},n){let u;this.parts=[];let i=0,r=0,c=t.length-1,p=this.parts,[d,f]=ko(t,s);if(this.el=e.createElement(d,n),Et.currentNode=this.el.content,s===2||s===3){let v=this.el.content.firstChild;v.replaceWith(...v.childNodes)}for(;(u=Et.nextNode())!==null&&p.length<c;){if(u.nodeType===1){if(u.hasAttributes())for(let v of u.getAttributeNames())if(v.endsWith(Gs)){let w=f[r++],b=u.getAttribute(v).split(nt),o=/([.?@])?(.*)/.exec(w);p.push({type:1,index:i,name:o[2],strings:b,ctor:o[1]==="."?ts:o[1]==="?"?is:o[1]==="@"?ss:Dt}),u.removeAttribute(v)}else v.startsWith(nt)&&(p.push({type:6,index:i}),u.removeAttribute(v));if(wo.test(u.tagName)){let v=u.textContent.split(nt),w=v.length-1;if(w>0){u.textContent=Qi?Qi.emptyScript:"";for(let b=0;b<w;b++)u.append(v[b],yi()),Et.nextNode(),p.push({type:2,index:++i});u.append(v[w],yi())}}}else if(u.nodeType===8)if(u.data===Xs)p.push({type:2,index:i});else{let v=-1;for(;(v=u.data.indexOf(nt,v+1))!==-1;)p.push({type:7,index:i}),v+=nt.length-1}i++}}static createElement(t,s){let n=At.createElement("template");return n.innerHTML=t,n}};function Lt(e,t,s=e,n){if(t===De)return t;let u=n!==void 0?s._$Co?.[n]:s._$Cl,i=wi(t)?void 0:t._$litDirective$;return u?.constructor!==i&&(u?._$AO?.(!1),i===void 0?u=void 0:(u=new i(e),u._$AT(e,s,n)),n!==void 0?(s._$Co??(s._$Co=[]))[n]=u:s._$Cl=u),u!==void 0&&(t=Lt(e,u._$AS(e,t.values),u,n)),t}var es=class{constructor(t,s){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=s}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){let{el:{content:s},parts:n}=this._$AD,u=(t?.creationScope??At).importNode(s,!0);Et.currentNode=u;let i=Et.nextNode(),r=0,c=0,p=n[0];for(;p!==void 0;){if(r===p.index){let d;p.type===2?d=new Gt(i,i.nextSibling,this,t):p.type===1?d=new p.ctor(i,p.name,p.strings,this,t):p.type===6&&(d=new rs(i,this,t)),this._$AV.push(d),p=n[++c]}r!==p?.index&&(i=Et.nextNode(),r++)}return Et.currentNode=At,u}p(t){let s=0;for(let n of this._$AV)n!==void 0&&(n.strings!==void 0?(n._$AI(t,n,s),s+=n.strings.length-2):n._$AI(t[s])),s++}},Gt=class e{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,s,n,u){this.type=2,this._$AH=ee,this._$AN=void 0,this._$AA=t,this._$AB=s,this._$AM=n,this.options=u,this._$Cv=u?.isConnected??!0}get parentNode(){let t=this._$AA.parentNode,s=this._$AM;return s!==void 0&&t?.nodeType===11&&(t=s.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,s=this){t=Lt(this,t,s),wi(t)?t===ee||t==null||t===""?(this._$AH!==ee&&this._$AR(),this._$AH=ee):t!==this._$AH&&t!==De&&this._(t):t._$litType$!==void 0?this.$(t):t.nodeType!==void 0?this.T(t):yo(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==ee&&wi(this._$AH)?this._$AA.nextSibling.data=t:this.T(At.createTextNode(t)),this._$AH=t}$(t){let{values:s,_$litType$:n}=t,u=typeof n=="number"?this._$AC(t):(n.el===void 0&&(n.el=Si.createElement(xo(n.h,n.h[0]),this.options)),n);if(this._$AH?._$AD===u)this._$AH.p(s);else{let i=new es(u,this),r=i.u(this.options);i.p(s),this.T(r),this._$AH=i}}_$AC(t){let s=bo.get(t.strings);return s===void 0&&bo.set(t.strings,s=new Si(t)),s}k(t){Ys(this._$AH)||(this._$AH=[],this._$AR());let s=this._$AH,n,u=0;for(let i of t)u===s.length?s.push(n=new e(this.O(yi()),this.O(yi()),this,this.options)):n=s[u],n._$AI(i),u++;u<s.length&&(this._$AR(n&&n._$AB.nextSibling,u),s.length=u)}_$AR(t=this._$AA.nextSibling,s){for(this._$AP?.(!1,!0,s);t!==this._$AB;){let n=po(t).nextSibling;po(t).remove(),t=n}}setConnected(t){this._$AM===void 0&&(this._$Cv=t,this._$AP?.(t))}},Dt=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,s,n,u,i){this.type=1,this._$AH=ee,this._$AN=void 0,this.element=t,this.name=s,this._$AM=u,this.options=i,n.length>2||n[0]!==""||n[1]!==""?(this._$AH=Array(n.length-1).fill(new String),this.strings=n):this._$AH=ee}_$AI(t,s=this,n,u){let i=this.strings,r=!1;if(i===void 0)t=Lt(this,t,s,0),r=!wi(t)||t!==this._$AH&&t!==De,r&&(this._$AH=t);else{let c=t,p,d;for(t=i[0],p=0;p<i.length-1;p++)d=Lt(this,c[n+p],s,p),d===De&&(d=this._$AH[p]),r||(r=!wi(d)||d!==this._$AH[p]),d===ee?t=ee:t!==ee&&(t+=(d??"")+i[p+1]),this._$AH[p]=d}r&&!u&&this.j(t)}j(t){t===ee?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"")}},ts=class extends Dt{constructor(){super(...arguments),this.type=3}j(t){this.element[this.name]=t===ee?void 0:t}},is=class extends Dt{constructor(){super(...arguments),this.type=4}j(t){this.element.toggleAttribute(this.name,!!t&&t!==ee)}},ss=class extends Dt{constructor(t,s,n,u,i){super(t,s,n,u,i),this.type=5}_$AI(t,s=this){if((t=Lt(this,t,s,0)??ee)===De)return;let n=this._$AH,u=t===ee&&n!==ee||t.capture!==n.capture||t.once!==n.once||t.passive!==n.passive,i=t!==ee&&(n===ee||u);u&&this.element.removeEventListener(this.name,this,n),i&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t)}},rs=class{constructor(t,s,n){this.element=t,this.type=6,this._$AN=void 0,this._$AM=s,this.options=n}get _$AU(){return this._$AM._$AU}_$AI(t){Lt(this,t)}},Eo={M:Gs,P:nt,A:Xs,C:1,L:ko,R:es,D:yo,V:Lt,I:Gt,H:Dt,N:is,U:ss,B:ts,F:rs},gl=bi.litHtmlPolyfillSupport;gl?.(Si,Gt),(bi.litHtmlVersions??(bi.litHtmlVersions=[])).push("3.3.2");var os=(e,t,s)=>{let n=s?.renderBefore??t,u=n._$litPart$;if(u===void 0){let i=s?.renderBefore??null;n._$litPart$=u=new Gt(t.insertBefore(yi(),i),i,void 0,s??{})}return u._$AI(e),u};function Ao(e={}){let t={activeRunId:e.activeRunId??null,runs:e.runs??{},logLines:e.logLines??[],preferences:{theme:e.preferences?.theme??"light",sidebarCollapsed:e.preferences?.sidebarCollapsed??!1}},s=new Set;function n(){for(let u of Array.from(s))try{u(t)}catch{}}return{getState(){return t},setState(u){let i={...t,...u,preferences:{...t.preferences,...u.preferences||{}}};i.activeRunId===t.activeRunId&&i.runs===t.runs&&i.logLines===t.logLines&&i.preferences.theme===t.preferences.theme&&i.preferences.sidebarCollapsed===t.preferences.sidebarCollapsed||(t=i,n())},setRun(u,i){let r={...t.runs,[u]:i};t={...t,runs:r},n()},appendLog(u){let i=[...t.logLines,u];i.length>5e3&&i.splice(0,i.length-5e3),t={...t,logLines:i},n()},clearLog(){t={...t,logLines:[]},n()},subscribe(u){return s.add(u),()=>s.delete(u)}}}var Lo=["subscribe-run","unsubscribe-run","subscribe-log","unsubscribe-log","list-runs","get-preferences","set-preferences","run-snapshot","run-update","runs-list","log-line","log-bulk","preferences"];function Zs(){let e=Date.now().toString(36),t=Math.random().toString(36).slice(2,8);return`${e}-${t}`}function Do(e,t,s=Zs()){return{id:s,type:e,payload:t}}function To(e={}){let t={initialMs:e.backoff?.initialMs??1e3,maxMs:e.backoff?.maxMs??3e4,factor:e.backoff?.factor??2,jitterRatio:e.backoff?.jitterRatio??.2},s=()=>e.url&&e.url.length>0?e.url:typeof location<"u"?(location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws":"ws://localhost/ws",n=null,u="closed",i=0,r=null,c=!0,p=new Map,d=[],f=new Map,v=new Set;function w(g){for(let y of Array.from(v))try{y(g)}catch{}}function b(){if(!c||r)return;u="reconnecting",w(u);let g=Math.min(t.maxMs,t.initialMs*Math.pow(t.factor,i)),y=t.jitterRatio*g,x=Math.max(0,Math.round(g+(Math.random()*2-1)*y));r=setTimeout(()=>{r=null,_()},x)}function o(g){try{n?.send(JSON.stringify(g))}catch{}}function l(){for(u="open",w(u),i=0;d.length;){let g=d.shift();g&&o(g)}}function a(g){let y;try{y=JSON.parse(String(g.data))}catch{return}if(!y||typeof y.id!="string"||typeof y.type!="string")return;if(p.has(y.id)){let m=p.get(y.id);p.delete(y.id),y.ok?m?.resolve(y.payload):m?.reject(y.error||new Error("ws error"));return}let x=f.get(y.type);if(x&&x.size>0)for(let m of Array.from(x))try{m(y.payload)}catch{}}function h(){u="closed",w(u);for(let[g,y]of p.entries())y.reject(new Error("ws disconnected")),p.delete(g);i+=1,b()}function _(){if(!c)return;let g=s();try{n=new WebSocket(g),u="connecting",w(u),n.addEventListener("open",l),n.addEventListener("message",a),n.addEventListener("error",()=>{}),n.addEventListener("close",h)}catch{b()}}return _(),{send(g,y){if(!Lo.includes(g))return Promise.reject(new Error(`unknown message type: ${g}`));let x=Zs(),m=Do(g,y,x);return new Promise((S,L)=>{p.set(x,{resolve:S,reject:L,type:g}),n&&n.readyState===n.OPEN?o(m):d.push(m)})},on(g,y){f.has(g)||f.set(g,new Set);let x=f.get(g);return x?.add(y),()=>{x?.delete(y)}},onConnection(g){return v.add(g),()=>{v.delete(g)}},close(){c=!1,r&&(clearTimeout(r),r=null);try{n?.close()}catch{}},getState(){return u}}}function Qs(e){let t=(e||"").replace(/^#\/?/,""),[s,n]=t.split("?"),u=s||"active",i=new URLSearchParams(n||"");return{section:u,runId:i.get("run")||null}}function vl(e,t){let s=`#/${e}`;return t?`${s}?run=${t}`:s}function Ro(e){let t=()=>e(Qs(location.hash));return window.addEventListener("hashchange",t),()=>window.removeEventListener("hashchange",t)}function _t(e,t){location.hash=vl(e,t)}function Ci(e){document.documentElement.setAttribute("data-theme",e)}var Ke={ATTRIBUTE:1,CHILD:2,PROPERTY:3,BOOLEAN_ATTRIBUTE:4,EVENT:5,ELEMENT:6},Xt=e=>(...t)=>({_$litDirective$:e,values:t}),mt=class{constructor(t){}get _$AU(){return this._$AM._$AU}_$AT(t,s,n){this._$Ct=t,this._$AM=s,this._$Ci=n}_$AS(t,s){return this.update(t,s)}update(t,s){return this.render(...s)}};var xi=class extends mt{constructor(t){if(super(t),this.it=ee,t.type!==Ke.CHILD)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(t){if(t===ee||t==null)return this._t=void 0,this.it=t;if(t===De)return t;if(typeof t!="string")throw Error(this.constructor.directiveName+"() called with a non-string value");if(t===this.it)return this._t;this.it=t;let s=[t];return s.raw=s,this._t={_$litType$:this.constructor.resultType,strings:s,values:[]}}};xi.directiveName="unsafeHTML",xi.resultType=1;var te=Xt(xi);var Yt=[["circle",{cx:"12",cy:"12",r:"10"}]];var Tt=[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"m9 12 2 2 4-4"}]];var Rt=[["circle",{cx:"12",cy:"12",r:"10"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16"}]];var gt=[["path",{d:"M12 2v4"}],["path",{d:"m16.2 7.8 2.9-2.9"}],["path",{d:"M18 12h4"}],["path",{d:"m16.2 16.2 2.9 2.9"}],["path",{d:"M12 18v4"}],["path",{d:"m4.9 19.1 2.9-2.9"}],["path",{d:"M2 12h4"}],["path",{d:"m4.9 4.9 2.9 2.9"}]];var er=[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{d:"M21 3v5h-5"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{d:"M8 16H3v5"}]];var tr=[["path",{d:"M12 5v14"}],["path",{d:"m19 12-7 7-7-7"}]];var Ot=[["rect",{x:"14",y:"3",width:"5",height:"18",rx:"1"}],["rect",{x:"5",y:"3",width:"5",height:"18",rx:"1"}]];var ir=[["path",{d:"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"}]];var sr=[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{d:"M12 9v4"}],["path",{d:"M12 17h.01"}]];var ki=[["path",{d:"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]];var rr=[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"}],["path",{d:"M10 12h4"}]];var or=[["path",{d:"m21 21-4.34-4.34"}],["circle",{cx:"11",cy:"11",r:"8"}]];var nr=[["path",{d:"m12 19-7-7 7-7"}],["path",{d:"M19 12H5"}]];var ar=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2"}]];var lr=[["path",{d:"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"}]];var ns=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{d:"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{cx:"9",cy:"7",r:"4"}]];var cr=[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}]];var hr=[["path",{d:"M15 6a9 9 0 0 0-9 9V3"}],["circle",{cx:"18",cy:"6",r:"3"}],["circle",{cx:"6",cy:"18",r:"3"}]];var dr=[["path",{d:"m9 18 6-6-6-6"}]];var Ei=[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7"}]];var Ai=[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{cx:"12",cy:"12",r:"3"}]];function bl(e){return e.map(([t,s])=>{let n=Object.entries(s).map(([u,i])=>`${u}="${i}"`).join(" ");return`<${t} ${n}/>`}).join("")}function ae(e,t=16,s=""){let n=s?` class="${s}"`:"";return`<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${n}>${bl(e)}</svg>`}function Oo(e,t,s,{onNavigate:n}){let{runs:u,preferences:i}=e,r=Object.values(u),c=r.filter(v=>v.active).length,p=r.filter(v=>!v.active).length,d=s==="open"?"connected":s==="reconnecting"?"reconnecting":"disconnected",f=s==="open"?"Connected":s==="reconnecting"?"Reconnecting\u2026":"Disconnected";return z`
    <aside class="sidebar ${i.sidebarCollapsed?"collapsed":""}">
      <div class="sidebar-logo" @click=${()=>n("dashboard")} style="cursor:pointer">
        <span class="logo-text">WORCA</span>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Pipeline</div>
        <div class="sidebar-item ${t.section==="active"?"active":""}"
             @click=${()=>n("active")}>
          <span class="sidebar-item-left">
            ${te(ae(ki,16))}
            <span>Running</span>
          </span>
          ${c>0?z`<sl-badge variant="primary" pill>${c}</sl-badge>`:""}
        </div>
        <div class="sidebar-item ${t.section==="history"?"active":""}"
             @click=${()=>n("history")}>
          <span class="sidebar-item-left">
            ${te(ae(rr,16))}
            <span>History</span>
          </span>
          ${p>0?z`<sl-badge variant="neutral" pill>${p}</sl-badge>`:""}
        </div>
      </div>

      <div class="sidebar-footer">
        <div class="connection-indicator ${d}">
          <span class="conn-dot"></span>
          <span class="conn-label">${f}</span>
        </div>
        <button
          class="theme-toggle-btn ${t.section==="settings"?"active":""}"
          aria-label="Settings"
          @click=${()=>n("settings")}
        >${te(ae(Ai,18))}</button>
      </div>
    </aside>
  `}var yl={pending:"status-pending",in_progress:"status-in-progress",completed:"status-completed",error:"status-error",interrupted:"status-interrupted"},wl={pending:Yt,in_progress:gt,completed:Tt,error:Rt,interrupted:Ot};function Jt(e,t){return e==="in_progress"&&t===!1?"interrupted":e}function as(e){return yl[e]||"status-unknown"}function Bt(e,t=14){let s=wl[e];return s?ae(s,t,e==="in_progress"?"icon-spin":""):"?"}var Sl={pending:Yt,in_progress:gt,completed:Tt,error:Rt,interrupted:Ot};function Cl(e,t){return t&&t[e]?.label?t[e].label:e.replace(/_/g," ").toUpperCase()}function Bo(e,t={},s=!0){if(!e||typeof e!="object")return z``;let n=Object.entries(e);return n.length===0?z`<div class="empty-state">No stages</div>`:z`
    <div class="stage-timeline">
      ${n.map(([u,i],r)=>{let c=Jt(i.status||"pending",s),p=Sl[c]||Yt,d=Cl(u,t),f=c==="in_progress",v=i.iteration,w=c==="in_progress"?"icon-spin":"";return z`
          ${r>0?z`<div class="stage-connector ${n[r-1]?.[1]?.status==="completed"?"completed":""}"></div>`:""}
          <div class="stage-node ${as(c)} ${f?"pulse":""}">
            <div class="stage-icon">${te(ae(p,22,w))}</div>
            <div class="stage-label">${d}</div>
            ${v>1?z`<span class="loop-indicator">${te(ae(er,10))}${v}</span>`:""}
          </div>
        `})}
    </div>
  `}function Zt(e){let t=Math.floor(e/1e3),s=Math.floor(t/3600),n=Math.floor(t%3600/60),u=t%60;return s>0?`${s}h ${n}m ${u}s`:n>0?`${n}m ${u}s`:`${u}s`}function Qt(e,t){let s=new Date(e).getTime();return(t?new Date(t).getTime():Date.now())-s}function vt(e){if(!e)return"N/A";let t=new Date(e),s=n=>String(n).padStart(2,"0");return`${t.getFullYear()}.${s(t.getMonth()+1)}.${s(t.getDate())} ${s(t.getHours())}:${s(t.getMinutes())}`}function xl(e){if(!e)return null;let t=null;for(let s of Object.values(e))s.completed_at&&(!t||s.completed_at>t)&&(t=s.completed_at);return t}function Mo(e,t={}){if(!e)return z`<div class="empty-state">Select a run to view details</div>`;let s=e.branch||e.work_request?.branch||"",n=e.pr_url||null,u=e.completed_at||(e.active?null:xl(e.stages)),i=e.started_at?Zt(Qt(e.started_at,u)):"N/A",r=e.stages||{},c=t.stageUi||{},p=t.agents||{};return z`
    <div class="run-detail">
      <div class="run-header">
        <div class="run-header-left">
          <sl-badge variant="${e.active?"warning":"success"}" pill>
            ${te(Bt(e.active?"in_progress":"completed",12))}
            ${e.active?"Running":"Completed"}
          </sl-badge>
          ${n?z`<a class="run-meta run-pr-link" href="${n}" target="_blank">View PR</a>`:ee}
        </div>
      </div>
      <div class="run-meta-grid">
        <span class="run-meta-item"><span class="meta-label">Branch:</span> ${s||"N/A"}</span>
        <span class="run-meta-item"><span class="meta-label">Started:</span> ${vt(e.started_at)}</span>
        <span class="run-meta-item"><span class="meta-label">Finished:</span> ${vt(e.completed_at)}</span>
        <span class="run-meta-item"><span class="meta-label">Duration:</span> ${i}</span>
      </div>

      ${Bo(r,c,e.active)}

      <div class="stage-panels">
        ${Object.entries(r).map(([d,f])=>{let v=c[d]?.label||d.replace(/_/g," ").toUpperCase(),w=Jt(f.status||"pending",e.active),b=Object.keys(p).find(a=>a===d)||null,o=b?p[b]:null,l=f.started_at?Zt(Qt(f.started_at,f.completed_at||null)):"";return z`
            <sl-details ?open=${w==="in_progress"} class="stage-panel">
              <div slot="summary" class="stage-panel-header">
                <span class="stage-panel-icon ${as(w)}">${te(Bt(w))}</span>
                <span class="stage-panel-label">${v}</span>
                <sl-badge variant="${w==="completed"?"success":w==="error"?"danger":w==="in_progress"||w==="interrupted"?"warning":"neutral"}" pill>
                  ${w.replace(/_/g," ")}
                </sl-badge>
              </div>
              <div class="stage-detail">
                ${f.started_at?z`<div class="detail-row"><span class="detail-label">Started:</span> ${vt(f.started_at)}</div>`:ee}
                ${f.completed_at?z`<div class="detail-row"><span class="detail-label">Completed:</span> ${vt(f.completed_at)}</div>`:ee}
                ${l?z`<div class="detail-row"><span class="detail-label">Duration:</span> ${l}</div>`:ee}
                ${o?z`<div class="detail-row"><span class="detail-label">Agent:</span> ${b} (${o.model})</div>`:ee}
                ${f.iteration>1?z`<div class="detail-row"><span class="detail-label">Iteration:</span> ${f.iteration}</div>`:ee}
                ${f.task_progress?z`<div class="detail-row"><span class="detail-label">Progress:</span> ${f.task_progress}</div>`:ee}
                ${f.error?z`<div class="detail-row detail-error"><span class="detail-label">Error:</span> ${f.error}</div>`:ee}
              </div>
            </sl-details>
          `})}
      </div>
    </div>
  `}var kl={completed:"success",in_progress:"warning",error:"danger",interrupted:"warning",pending:"neutral"};function ls(e,{onClick:t}={}){let s=e.work_request?.title||"Untitled",n=e.active,u=n?"in_progress":e.stage==="error"?"error":"completed",i=e.started_at&&e.completed_at?Zt(Qt(e.started_at,e.completed_at)):e.started_at&&n?Zt(Qt(e.started_at,null)):"N/A",r=e.branch||e.work_request?.branch||"",c=e.stages?Object.entries(e.stages):[];return z`
    <div class="run-card" @click=${t?()=>t(e.id):null}>
      <div class="run-card-top">
        <span class="run-card-status">${te(Bt(u,16))}</span>
        <span class="run-card-title">${s}</span>
      </div>
      ${r?z`<div class="run-card-meta"><span class="run-card-meta-item"><span class="meta-label">Branch:</span> ${r}</span></div>`:ee}
      <div class="run-card-meta">
        <span class="run-card-meta-item"><span class="meta-label">Started:</span> ${vt(e.started_at)}</span>
        <span class="run-card-meta-item"><span class="meta-label">Finished:</span> ${vt(e.completed_at)}</span>
        <span class="run-card-meta-item"><span class="meta-label">Duration:</span> ${i}</span>
      </div>
      ${c.length>0?z`
        <div class="run-card-stages">
          ${c.map(([p,d])=>{let f=Jt(d.status||"pending",n),v=kl[f]||"neutral",w=p.replace(/_/g," ").toUpperCase();return z`<sl-badge variant="${v}" pill class="run-card-stage-badge">${w}</sl-badge>`})}
        </div>
      `:ee}
    </div>
  `}function ur(e,t,{onSelectRun:s}){let n=e.filter(u=>t==="active"?u.active:!u.active);return n.length===0?z`<div class="empty-state">
      ${t==="active"?"No running pipelines":"No completed runs yet"}
    </div>`:z`
    <div class="run-list">
      ${n.map(u=>ls(u,{onClick:s}))}
    </div>
  `}function Po(e){let t=Object.values(e.runs),s=t.filter(r=>r.active),n=t.filter(r=>!r.active),u=t.filter(r=>(r.stages?Object.values(r.stages):[]).some(p=>p.status==="error")),i=t.length;return z`
    <div class="dashboard">
      <div class="dashboard-stats">
        <div class="stat-card stat-total">
          <div class="stat-icon-ring">${te(ae(ir,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${i}</span>
            <span class="stat-label">Total Runs</span>
          </div>
        </div>
        <div class="stat-card stat-active">
          <div class="stat-icon-ring">${te(ae(ki,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${s.length}</span>
            <span class="stat-label">Active</span>
          </div>
        </div>
        <div class="stat-card stat-completed">
          <div class="stat-icon-ring">${te(ae(Tt,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${n.length}</span>
            <span class="stat-label">Completed</span>
          </div>
        </div>
        <div class="stat-card stat-errors">
          <div class="stat-icon-ring">${te(ae(Rt,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${u.length}</span>
            <span class="stat-label">Errors</span>
          </div>
        </div>
      </div>

      <h3 class="dashboard-section-title">Active Runs</h3>
      ${s.length>0?z`
        <div class="run-list">
          ${s.map(r=>ls(r))}
        </div>
      `:z`<div class="empty-state">No running pipelines</div>`}
    </div>
  `}var El={plan:"planner",coordinate:"coordinator",implement:"implementer",test:"tester",review:"guardian",pr:"guardian"},cs=["plan","coordinate","implement","test","review","pr"],Di=["planner","coordinator","implementer","tester","guardian"],Al=["opus","sonnet","haiku"],Li={plan:{agent:"planner",enabled:!0},coordinate:{agent:"coordinator",enabled:!0},implement:{agent:"implementer",enabled:!0},test:{agent:"tester",enabled:!0},review:{agent:"guardian",enabled:!0},pr:{agent:"guardian",enabled:!0}},$o=[{key:"block_rm_rf",label:"Block rm -rf",description:"Prevent recursive force-delete commands"},{key:"block_env_write",label:"Block .env writes",description:"Prevent writing to .env files"},{key:"block_force_push",label:"Block force push",description:"Prevent git push --force"},{key:"restrict_git_commit",label:"Restrict git commit",description:"Only guardian agent may commit"}],Mt={guards:{block_rm_rf:!0,block_env_write:!0,block_force_push:!0,restrict_git_commit:!0},test_gate_strikes:2,dispatch:{planner:[],coordinator:["implementer"],implementer:[],tester:[],guardian:[]}},_e=null,Ge=null,Pt="";async function pr(){try{let e=await fetch("/api/settings");if(!e.ok)throw new Error(`HTTP ${e.status}`);if(_e=await e.json(),_e.worca||(_e.worca={}),!_e.worca.stages)_e.worca.stages={...Li};else for(let t of cs)_e.worca.stages[t]||(_e.worca.stages[t]={...Li[t]});_e.worca.governance?_e.worca.governance={...Mt,..._e.worca.governance,guards:{...Mt.guards,..._e.worca.governance.guards||{}},dispatch:{...Mt.dispatch,..._e.worca.governance.dispatch||{}}}:_e.worca.governance={...Mt}}catch(e){_e=null,Ge="error",Pt="Failed to load settings: "+e.message}}async function fr(e,t){Ge="saving",Pt="",t();try{let s=await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(e)});if(!s.ok)throw new Error(`HTTP ${s.status}`);let n=await s.json();_e={worca:n.worca,permissions:n.permissions},Ge="success",Pt="Settings saved successfully"}catch(s){Ge="error",Pt="Failed to save: "+s.message}t(),Ge==="success"&&setTimeout(()=>{Ge==="success"&&(Ge=null,Pt="",t())},3e3)}function Ll(){let e={};for(let t of Di){let s=document.getElementById(`agent-${t}-model`),n=document.getElementById(`agent-${t}-turns`);e[t]={model:s?.value||"sonnet",max_turns:parseInt(n?.value,10)||30}}return e}function Dl(){let e={};for(let t of["implement_test","code_review","pr_changes","restart_planning"]){let s=document.getElementById(`loop-${t}`);e[t]=parseInt(s?.value,10)||0}return{loops:e}}function Tl(){let e={};for(let t of cs){let s=document.getElementById(`stage-${t}-enabled`),n=document.getElementById(`stage-${t}-agent`);e[t]={agent:n?.value||Li[t].agent,enabled:s?.checked??!0}}return e}function Rl(){let e={};for(let u of $o){let i=document.getElementById(`guard-${u.key}`);e[u.key]=i?.checked??!0}let t=document.getElementById("test-gate-strikes"),s=parseInt(t?.value,10)||2,n={};for(let u of Di){let r=(document.getElementById(`dispatch-${u}`)?.value||"").trim();n[u]=r?r.split(",").map(c=>c.trim()).filter(Boolean):[]}return{guards:e,test_gate_strikes:s,dispatch:n}}function Ol(e,t){let s=e.agents||{};return z`
    <div class="settings-tab-content">
      <div class="settings-cards">
        ${Di.map(n=>{let u=s[n]||{};return z`
            <div class="settings-card">
              <div class="settings-card-header">
                <span class="settings-card-icon">${te(ae(ns,18))}</span>
                <span class="settings-card-title">${n}</span>
              </div>
              <div class="settings-card-body">
                <div class="settings-field">
                  <label class="settings-label">Model</label>
                  <sl-select id="agent-${n}-model" .value="${u.model||"sonnet"}" size="small">
                    ${Al.map(i=>z`<sl-option value="${i}">${i}</sl-option>`)}
                  </sl-select>
                </div>
                <div class="settings-field">
                  <label class="settings-label">Max Turns</label>
                  <sl-input id="agent-${n}-turns" type="number" value="${u.max_turns||30}" size="small" min="1" max="200"></sl-input>
                </div>
              </div>
            </div>
          `})}
      </div>
      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${()=>{let n=Ll();fr({worca:{..._e.worca,agents:n},permissions:_e.permissions},t)}}>
          ${te(ae(Ei,14))}
          Save Agents
        </sl-button>
      </div>
    </div>
  `}function Bl(e,t){let s=e.loops||{},n=e.stages||Li;return z`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Stage Configuration</h3>
      <div class="pipeline-flow">
        ${cs.map((u,i)=>{let r=n[u]||Li[u],c=r.enabled!==!1;return z`
            <div class="pipeline-stage-node ${c?"pipeline-stage-node--enabled":"pipeline-stage-node--disabled"}">
              <div class="pipeline-stage-header">
                <span class="pipeline-stage-name ${c?"":"pipeline-stage-name--disabled"}">${u}</span>
                <sl-switch id="stage-${u}-enabled" ?checked=${c} size="small"
                  @sl-change=${p=>{let d=p.target.closest(".pipeline-stage-node");p.target.checked?(d.classList.remove("pipeline-stage-node--disabled"),d.classList.add("pipeline-stage-node--enabled"),d.querySelector(".pipeline-stage-name").classList.remove("pipeline-stage-name--disabled")):(d.classList.remove("pipeline-stage-node--enabled"),d.classList.add("pipeline-stage-node--disabled"),d.querySelector(".pipeline-stage-name").classList.add("pipeline-stage-name--disabled"))}}></sl-switch>
              </div>
              <div class="settings-field pipeline-stage-field">
                <label class="settings-label">Agent</label>
                <sl-select id="stage-${u}-agent" .value="${r.agent||El[u]}" size="small">
                  ${Di.map(p=>z`<sl-option value="${p}">${p}</sl-option>`)}
                </sl-select>
              </div>
            </div>
            ${i<cs.length-1?z`
              <span class="pipeline-arrow">${te(ae(dr,16))}</span>
            `:ee}
          `})}
      </div>

      <h3 class="settings-section-title">Loop Limits</h3>
      <div class="settings-grid">
        ${[{key:"implement_test",label:"Implement \u2194 Test"},{key:"code_review",label:"Code Review"},{key:"pr_changes",label:"PR Changes"},{key:"restart_planning",label:"Restart Planning"}].map(u=>z`
          <div class="settings-field">
            <label class="settings-label">${u.label}</label>
            <sl-input id="loop-${u.key}" type="number" value="${s[u.key]||0}" size="small" min="0" max="50"></sl-input>
          </div>
        `)}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${()=>{let{loops:u}=Dl(),i=Tl();fr({worca:{..._e.worca,loops:u,stages:i},permissions:_e.permissions},t)}}>
          ${te(ae(Ei,14))}
          Save Pipeline
        </sl-button>
      </div>
    </div>
  `}function Ml(e,t,s){let n=e.governance||Mt,u=n.guards||Mt.guards,i=n.dispatch||Mt.dispatch,r=t.allow||[];return z`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Guard Rules</h3>
      <div class="settings-switches">
        ${$o.map(c=>z`
          <div class="settings-switch-row">
            <sl-switch id="guard-${c.key}" ?checked=${u[c.key]!==!1} size="small">
              ${c.label}
            </sl-switch>
            <span class="settings-switch-desc">${c.description}</span>
          </div>
        `)}
      </div>

      <h3 class="settings-section-title">Test Gate</h3>
      <div class="settings-grid">
        <div class="settings-field">
          <label class="settings-label">Strike Threshold</label>
          <sl-input id="test-gate-strikes" type="number" value="${n.test_gate_strikes||2}" size="small" min="1" max="10"></sl-input>
          <span class="settings-field-hint">Consecutive test failures before blocking</span>
        </div>
      </div>

      <h3 class="settings-section-title">Dispatch Rules</h3>
      <div class="settings-dispatch-table">
        ${Di.map(c=>z`
          <div class="settings-dispatch-row">
            <span class="settings-dispatch-agent">${c}</span>
            <sl-input id="dispatch-${c}" value="${(i[c]||[]).join(", ")}" size="small" placeholder="none"></sl-input>
          </div>
        `)}
      </div>

      <h3 class="settings-section-title">Permissions</h3>
      <div class="settings-permissions">
        ${r.length>0?r.map(c=>z`<div class="settings-perm-item"><code>${c}</code></div>`):z`<span class="settings-muted">No permissions configured</span>`}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${()=>{let c=Rl();fr({worca:{..._e.worca,governance:c},permissions:_e.permissions},s)}}>
          ${te(ae(Ei,14))}
          Save Governance
        </sl-button>
      </div>
    </div>
  `}function Pl(e,t){let s=e?.theme||"light";return z`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Appearance</h3>
      <div class="settings-switches">
        <div class="settings-switch-row">
          <sl-switch ?checked=${s==="dark"} size="small" @sl-change=${t}>Dark Mode</sl-switch>
          <span class="settings-switch-desc">Toggle between light and dark theme</span>
        </div>
      </div>
    </div>
  `}function $l(e){return!Ge||Ge==="saving"?ee:z`
    <div class="settings-toast">
      <sl-alert variant="${Ge==="success"?"success":"danger"}" open closable duration="3000"
        @sl-after-hide=${()=>{Ge=null,Pt="",e()}}>
        ${Pt}
      </sl-alert>
    </div>
  `}function Io(e,{rerender:t,onThemeToggle:s}){if(!_e)return z`<div class="empty-state">Loading settings\u2026</div>`;let n=_e.worca||{},u=_e.permissions||{};return z`
    ${$l(t)}
    <div class="settings-page">
      <sl-tab-group>
        <sl-tab slot="nav" panel="agents">
          ${te(ae(ns,14))}
          Agents
        </sl-tab>
        <sl-tab slot="nav" panel="pipeline">
          ${te(ae(hr,14))}
          Pipeline
        </sl-tab>
        <sl-tab slot="nav" panel="governance">
          ${te(ae(cr,14))}
          Governance
        </sl-tab>
        <sl-tab slot="nav" panel="preferences">
          ${te(ae(Ai,14))}
          Preferences
        </sl-tab>

        <sl-tab-panel name="agents">${Ol(n,t)}</sl-tab-panel>
        <sl-tab-panel name="pipeline">${Bl(n,t)}</sl-tab-panel>
        <sl-tab-panel name="governance">${Ml(n,u,t)}</sl-tab-panel>
        <sl-tab-panel name="preferences">${Pl(e,s)}</sl-tab-panel>
      </sl-tab-group>
    </div>
  `}var _n=["\x1B[36m","\x1B[33m","\x1B[35m","\x1B[32m","\x1B[34m","\x1B[91m","\x1B[96m","\x1B[93m"],mn="\x1B[0m",$c="\x1B[2m",bs=new Map,Tr=0;function Ic(e){return bs.has(e)||(bs.set(e,_n[Tr%_n.length]),Tr++),bs.get(e)}var Ne=null,$t=null,Bi=null,Rr=null,Oi=null;async function Hc(e){if(Ne&&e.querySelector(".xterm")){$t.fit();return}let[{Terminal:t},{FitAddon:s},{SearchAddon:n}]=await Promise.all([Promise.resolve().then(()=>_l(Fo(),1)),Promise.resolve().then(()=>(No(),zo)),Promise.resolve().then(()=>(fn(),pn))]);Ne=new t({theme:{background:"#0f172a",foreground:"#e2e8f0",cursor:"#60a5fa",selectionBackground:"rgba(96, 165, 250, 0.3)"},fontFamily:"'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",fontSize:13,lineHeight:1.4,scrollback:5e4,convertEol:!0,cursorBlink:!1,disableStdin:!0}),$t=new s,Bi=new n,Ne.loadAddon($t),Ne.loadAddon(Bi),Ne.open(e),$t.fit(),Oi=new ResizeObserver(()=>{$t&&$t.fit()}),Oi.observe(e)}function Or(e){if(!Ne)return;let t=e.timestamp?`${$c}${e.timestamp}${mn} `:"",s=e.stage?`${Ic(e.stage)}[${e.stage.toUpperCase()}]${mn} `:"",n=e.line||e;Ne.writeln(`${t}${s}${n}`)}function ys(){Ne&&Ne.clear(),bs.clear(),Tr=0}function gn(){Oi&&Oi.disconnect(),Ne&&Ne.dispose(),Ne=null,$t=null,Bi=null,Oi=null,Rr=null}function vn(e){Bi&&e&&Bi.findNext(e,{incremental:!0})}async function bn(e){let t=document.getElementById("log-terminal");t&&(e!==Rr&&(ys(),Rr=e),await Hc(t))}function yn(e,{onStageFilter:t,onSearch:s,onToggleAutoScroll:n,autoScroll:u}){let{logLines:i}=e,r=[...new Set(i.map(c=>c.stage).filter(Boolean))];return z`
    <div class="log-viewer-container">
      <div class="log-controls">
        <sl-select
          placeholder="All Stages"
          size="small"
          clearable
          @sl-change=${c=>t(c.target.value||"*")}
        >
          ${r.map(c=>z`<sl-option value="${c}">${c}</sl-option>`)}
        </sl-select>
        <sl-input
          class="log-search"
          type="text"
          placeholder="Search logs\u2026"
          size="small"
          clearable
          @sl-input=${c=>s(c.target.value)}
        >
          <span slot="prefix">${te(ae(or,14))}</span>
        </sl-input>
        <sl-button
          size="small"
          variant="${u?"primary":"default"}"
          @click=${n}
        >
          ${te(ae(u?tr:Ot,14))}
          ${u?"Auto":"Paused"}
        </sl-button>
      </div>
      <div class="log-terminal-wrapper">
        <div id="log-terminal" class="log-terminal"></div>
      </div>
    </div>
  `}var ws=globalThis,Ss=ws.ShadowRoot&&(ws.ShadyCSS===void 0||ws.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,Br=Symbol(),wn=new WeakMap,Mi=class{constructor(t,s,n){if(this._$cssResult$=!0,n!==Br)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=s}get styleSheet(){let t=this.o,s=this.t;if(Ss&&t===void 0){let n=s!==void 0&&s.length===1;n&&(t=wn.get(s)),t===void 0&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),n&&wn.set(s,t))}return t}toString(){return this.cssText}},Sn=e=>new Mi(typeof e=="string"?e:e+"",void 0,Br),G=(e,...t)=>{let s=e.length===1?e[0]:t.reduce((n,u,i)=>n+(r=>{if(r._$cssResult$===!0)return r.cssText;if(typeof r=="number")return r;throw Error("Value passed to 'css' function must be a 'css' function result: "+r+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(u)+e[i+1],e[0]);return new Mi(s,e,Br)},Cn=(e,t)=>{if(Ss)e.adoptedStyleSheets=t.map(s=>s instanceof CSSStyleSheet?s:s.styleSheet);else for(let s of t){let n=document.createElement("style"),u=ws.litNonce;u!==void 0&&n.setAttribute("nonce",u),n.textContent=s.cssText,e.appendChild(n)}},Mr=Ss?e=>e:e=>e instanceof CSSStyleSheet?(t=>{let s="";for(let n of t.cssRules)s+=n.cssText;return Sn(s)})(e):e;var{is:Fc,defineProperty:zc,getOwnPropertyDescriptor:Nc,getOwnPropertyNames:Wc,getOwnPropertySymbols:Uc,getPrototypeOf:jc}=Object,yt=globalThis,xn=yt.trustedTypes,Vc=xn?xn.emptyScript:"",qc=yt.reactiveElementPolyfillSupport,Pi=(e,t)=>e,wt={toAttribute(e,t){switch(t){case Boolean:e=e?Vc:null;break;case Object:case Array:e=e==null?e:JSON.stringify(e)}return e},fromAttribute(e,t){let s=e;switch(t){case Boolean:s=e!==null;break;case Number:s=e===null?null:Number(e);break;case Object:case Array:try{s=JSON.parse(e)}catch{s=null}}return s}},Cs=(e,t)=>!Fc(e,t),kn={attribute:!0,type:String,converter:wt,reflect:!1,useDefault:!1,hasChanged:Cs};Symbol.metadata??(Symbol.metadata=Symbol("metadata")),yt.litPropertyMetadata??(yt.litPropertyMetadata=new WeakMap);var ct=class extends HTMLElement{static addInitializer(t){this._$Ei(),(this.l??(this.l=[])).push(t)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(t,s=kn){if(s.state&&(s.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(t)&&((s=Object.create(s)).wrapped=!0),this.elementProperties.set(t,s),!s.noAccessor){let n=Symbol(),u=this.getPropertyDescriptor(t,n,s);u!==void 0&&zc(this.prototype,t,u)}}static getPropertyDescriptor(t,s,n){let{get:u,set:i}=Nc(this.prototype,t)??{get(){return this[s]},set(r){this[s]=r}};return{get:u,set(r){let c=u?.call(this);i?.call(this,r),this.requestUpdate(t,c,n)},configurable:!0,enumerable:!0}}static getPropertyOptions(t){return this.elementProperties.get(t)??kn}static _$Ei(){if(this.hasOwnProperty(Pi("elementProperties")))return;let t=jc(this);t.finalize(),t.l!==void 0&&(this.l=[...t.l]),this.elementProperties=new Map(t.elementProperties)}static finalize(){if(this.hasOwnProperty(Pi("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(Pi("properties"))){let s=this.properties,n=[...Wc(s),...Uc(s)];for(let u of n)this.createProperty(u,s[u])}let t=this[Symbol.metadata];if(t!==null){let s=litPropertyMetadata.get(t);if(s!==void 0)for(let[n,u]of s)this.elementProperties.set(n,u)}this._$Eh=new Map;for(let[s,n]of this.elementProperties){let u=this._$Eu(s,n);u!==void 0&&this._$Eh.set(u,s)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(t){let s=[];if(Array.isArray(t)){let n=new Set(t.flat(1/0).reverse());for(let u of n)s.unshift(Mr(u))}else t!==void 0&&s.push(Mr(t));return s}static _$Eu(t,s){let n=s.attribute;return n===!1?void 0:typeof n=="string"?n:typeof t=="string"?t.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(t=>t(this))}addController(t){(this._$EO??(this._$EO=new Set)).add(t),this.renderRoot!==void 0&&this.isConnected&&t.hostConnected?.()}removeController(t){this._$EO?.delete(t)}_$E_(){let t=new Map,s=this.constructor.elementProperties;for(let n of s.keys())this.hasOwnProperty(n)&&(t.set(n,this[n]),delete this[n]);t.size>0&&(this._$Ep=t)}createRenderRoot(){let t=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Cn(t,this.constructor.elementStyles),t}connectedCallback(){this.renderRoot??(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),this._$EO?.forEach(t=>t.hostConnected?.())}enableUpdating(t){}disconnectedCallback(){this._$EO?.forEach(t=>t.hostDisconnected?.())}attributeChangedCallback(t,s,n){this._$AK(t,n)}_$ET(t,s){let n=this.constructor.elementProperties.get(t),u=this.constructor._$Eu(t,n);if(u!==void 0&&n.reflect===!0){let i=(n.converter?.toAttribute!==void 0?n.converter:wt).toAttribute(s,n.type);this._$Em=t,i==null?this.removeAttribute(u):this.setAttribute(u,i),this._$Em=null}}_$AK(t,s){let n=this.constructor,u=n._$Eh.get(t);if(u!==void 0&&this._$Em!==u){let i=n.getPropertyOptions(u),r=typeof i.converter=="function"?{fromAttribute:i.converter}:i.converter?.fromAttribute!==void 0?i.converter:wt;this._$Em=u;let c=r.fromAttribute(s,i.type);this[u]=c??this._$Ej?.get(u)??c,this._$Em=null}}requestUpdate(t,s,n,u=!1,i){if(t!==void 0){let r=this.constructor;if(u===!1&&(i=this[t]),n??(n=r.getPropertyOptions(t)),!((n.hasChanged??Cs)(i,s)||n.useDefault&&n.reflect&&i===this._$Ej?.get(t)&&!this.hasAttribute(r._$Eu(t,n))))return;this.C(t,s,n)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(t,s,{useDefault:n,reflect:u,wrapped:i},r){n&&!(this._$Ej??(this._$Ej=new Map)).has(t)&&(this._$Ej.set(t,r??s??this[t]),i!==!0||r!==void 0)||(this._$AL.has(t)||(this.hasUpdated||n||(s=void 0),this._$AL.set(t,s)),u===!0&&this._$Em!==t&&(this._$Eq??(this._$Eq=new Set)).add(t))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(s){Promise.reject(s)}let t=this.scheduleUpdate();return t!=null&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??(this.renderRoot=this.createRenderRoot()),this._$Ep){for(let[u,i]of this._$Ep)this[u]=i;this._$Ep=void 0}let n=this.constructor.elementProperties;if(n.size>0)for(let[u,i]of n){let{wrapped:r}=i,c=this[u];r!==!0||this._$AL.has(u)||c===void 0||this.C(u,void 0,i,c)}}let t=!1,s=this._$AL;try{t=this.shouldUpdate(s),t?(this.willUpdate(s),this._$EO?.forEach(n=>n.hostUpdate?.()),this.update(s)):this._$EM()}catch(n){throw t=!1,this._$EM(),n}t&&this._$AE(s)}willUpdate(t){}_$AE(t){this._$EO?.forEach(s=>s.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(t)),this.updated(t)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(t){return!0}update(t){this._$Eq&&(this._$Eq=this._$Eq.forEach(s=>this._$ET(s,this[s]))),this._$EM()}updated(t){}firstUpdated(t){}};ct.elementStyles=[],ct.shadowRootOptions={mode:"open"},ct[Pi("elementProperties")]=new Map,ct[Pi("finalized")]=new Map,qc?.({ReactiveElement:ct}),(yt.reactiveElementVersions??(yt.reactiveElementVersions=[])).push("2.1.2");var $i=globalThis,St=class extends ct{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var s;let t=super.createRenderRoot();return(s=this.renderOptions).renderBefore??(s.renderBefore=t.firstChild),t}update(t){let s=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=os(s,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return De}};St._$litElement$=!0,St.finalized=!0,$i.litElementHydrateSupport?.({LitElement:St});var Kc=$i.litElementPolyfillSupport;Kc?.({LitElement:St});($i.litElementVersions??($i.litElementVersions=[])).push("4.2.2");var En=G`
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
`;var Dn=Object.defineProperty,Gc=Object.defineProperties,Xc=Object.getOwnPropertyDescriptor,Yc=Object.getOwnPropertyDescriptors,An=Object.getOwnPropertySymbols,Jc=Object.prototype.hasOwnProperty,Zc=Object.prototype.propertyIsEnumerable,Pr=(e,t)=>(t=Symbol[e])?t:Symbol.for("Symbol."+e),$r=e=>{throw TypeError(e)},Ln=(e,t,s)=>t in e?Dn(e,t,{enumerable:!0,configurable:!0,writable:!0,value:s}):e[t]=s,Te=(e,t)=>{for(var s in t||(t={}))Jc.call(t,s)&&Ln(e,s,t[s]);if(An)for(var s of An(t))Zc.call(t,s)&&Ln(e,s,t[s]);return e},ht=(e,t)=>Gc(e,Yc(t)),T=(e,t,s,n)=>{for(var u=n>1?void 0:n?Xc(t,s):t,i=e.length-1,r;i>=0;i--)(r=e[i])&&(u=(n?r(t,s,u):r(u))||u);return n&&u&&Dn(t,s,u),u},Tn=(e,t,s)=>t.has(e)||$r("Cannot "+s),Rn=(e,t,s)=>(Tn(e,t,"read from private field"),s?s.call(e):t.get(e)),On=(e,t,s)=>t.has(e)?$r("Cannot add the same private member more than once"):t instanceof WeakSet?t.add(e):t.set(e,s),Bn=(e,t,s,n)=>(Tn(e,t,"write to private field"),n?n.call(e,s):t.set(e,s),s),Qc=function(e,t){this[0]=e,this[1]=t},Mn=e=>{var t=e[Pr("asyncIterator")],s=!1,n,u={};return t==null?(t=e[Pr("iterator")](),n=i=>u[i]=r=>t[i](r)):(t=t.call(e),n=i=>u[i]=r=>{if(s){if(s=!1,i==="throw")throw r;return r}return s=!0,{done:!1,value:new Qc(new Promise(c=>{var p=t[i](r);p instanceof Object||$r("Object expected"),c(p)}),1)}}),u[Pr("iterator")]=()=>u,n("next"),"throw"in t?n("throw"):u.throw=i=>{throw i},"return"in t&&n("return"),u};var $n=new Map,eh=new WeakMap;function th(e){return e??{keyframes:[],options:{duration:0}}}function Pn(e,t){return t.toLowerCase()==="rtl"?{keyframes:e.rtlKeyframes||e.keyframes,options:e.options}:e}function ye(e,t){$n.set(e,th(t))}function we(e,t,s){let n=eh.get(e);if(n?.[t])return Pn(n[t],s.dir);let u=$n.get(t);return u?Pn(u,s.dir):{keyframes:[],options:{duration:0}}}function Re(e,t){return new Promise(s=>{function n(u){u.target===e&&(e.removeEventListener(t,n),s())}e.addEventListener(t,n)})}function Se(e,t,s){return new Promise(n=>{if(s?.duration===1/0)throw new Error("Promise-based animations must be finite.");let u=e.animate(t,ht(Te({},s),{duration:ih()?0:s.duration}));u.addEventListener("cancel",n,{once:!0}),u.addEventListener("finish",n,{once:!0})})}function Ir(e){return e=e.toString().toLowerCase(),e.indexOf("ms")>-1?parseFloat(e):e.indexOf("s")>-1?parseFloat(e)*1e3:parseFloat(e)}function ih(){return window.matchMedia("(prefers-reduced-motion: reduce)").matches}function Ae(e){return Promise.all(e.getAnimations().map(t=>new Promise(s=>{t.cancel(),requestAnimationFrame(s)})))}function Hr(e,t){return e.map(s=>ht(Te({},s),{height:s.height==="auto"?`${t}px`:s.height}))}var Fr=new Set,si=new Map,It,zr="ltr",Nr="en",In=typeof MutationObserver<"u"&&typeof document<"u"&&typeof document.documentElement<"u";if(In){let e=new MutationObserver(Hn);zr=document.documentElement.dir||"ltr",Nr=document.documentElement.lang||navigator.language,e.observe(document.documentElement,{attributes:!0,attributeFilter:["dir","lang"]})}function Ii(...e){e.map(t=>{let s=t.$code.toLowerCase();si.has(s)?si.set(s,Object.assign(Object.assign({},si.get(s)),t)):si.set(s,t),It||(It=t)}),Hn()}function Hn(){In&&(zr=document.documentElement.dir||"ltr",Nr=document.documentElement.lang||navigator.language),[...Fr.keys()].map(e=>{typeof e.requestUpdate=="function"&&e.requestUpdate()})}var xs=class{constructor(t){this.host=t,this.host.addController(this)}hostConnected(){Fr.add(this.host)}hostDisconnected(){Fr.delete(this.host)}dir(){return`${this.host.dir||zr}`.toLowerCase()}lang(){return`${this.host.lang||Nr}`.toLowerCase()}getTranslationData(t){var s,n;let u=new Intl.Locale(t.replace(/_/g,"-")),i=u?.language.toLowerCase(),r=(n=(s=u?.region)===null||s===void 0?void 0:s.toLowerCase())!==null&&n!==void 0?n:"",c=si.get(`${i}-${r}`),p=si.get(i);return{locale:u,language:i,region:r,primary:c,secondary:p}}exists(t,s){var n;let{primary:u,secondary:i}=this.getTranslationData((n=s.lang)!==null&&n!==void 0?n:this.lang());return s=Object.assign({includeFallback:!1},s),!!(u&&u[t]||i&&i[t]||s.includeFallback&&It&&It[t])}term(t,...s){let{primary:n,secondary:u}=this.getTranslationData(this.lang()),i;if(n&&n[t])i=n[t];else if(u&&u[t])i=u[t];else if(It&&It[t])i=It[t];else return console.error(`No translation found for: ${String(t)}`),String(t);return typeof i=="function"?i(...s):i}date(t,s){return t=new Date(t),new Intl.DateTimeFormat(this.lang(),s).format(t)}number(t,s){return t=Number(t),isNaN(t)?"":new Intl.NumberFormat(this.lang(),s).format(t)}relativeTime(t,s,n){return new Intl.RelativeTimeFormat(this.lang(),n).format(t,s)}};var Fn={$code:"en",$name:"English",$dir:"ltr",carousel:"Carousel",clearEntry:"Clear entry",close:"Close",copied:"Copied",copy:"Copy",currentValue:"Current value",error:"Error",goToSlide:(e,t)=>`Go to slide ${e} of ${t}`,hidePassword:"Hide password",loading:"Loading",nextSlide:"Next slide",numOptionsSelected:e=>e===0?"No options selected":e===1?"1 option selected":`${e} options selected`,previousSlide:"Previous slide",progress:"Progress",remove:"Remove",resize:"Resize",scrollToEnd:"Scroll to end",scrollToStart:"Scroll to start",selectAColorFromTheScreen:"Select a color from the screen",showPassword:"Show password",slideNum:e=>`Slide ${e}`,toggleColorFormat:"Toggle color format"};Ii(Fn);var zn=Fn;var fe=class extends xs{};Ii(zn);var Wr="";function Nn(e){Wr=e}function Wn(e=""){if(!Wr){let t=[...document.getElementsByTagName("script")],s=t.find(n=>n.hasAttribute("data-shoelace"));if(s)Nn(s.getAttribute("data-shoelace"));else{let n=t.find(i=>/shoelace(\.min)?\.js($|\?)/.test(i.src)||/shoelace-autoloader(\.min)?\.js($|\?)/.test(i.src)),u="";n&&(u=n.getAttribute("src")),Nn(u.split("/").slice(0,-1).join("/"))}}return Wr.replace(/\/$/,"")+(e?`/${e.replace(/^\//,"")}`:"")}var sh={name:"default",resolver:e=>Wn(`assets/icons/${e}.svg`)},Un=sh;var jn={caret:`
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
  `},rh={name:"system",resolver:e=>e in jn?`data:image/svg+xml,${encodeURIComponent(jn[e])}`:""},Vn=rh;var oh=[Un,Vn],Ur=[];function qn(e){Ur.push(e)}function Kn(e){Ur=Ur.filter(t=>t!==e)}function jr(e){return oh.find(t=>t.name===e)}var Gn=G`
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
`;function Z(e,t){let s=Te({waitUntilFirstUpdate:!1},t);return(n,u)=>{let{update:i}=n,r=Array.isArray(e)?e:[e];n.update=function(c){r.forEach(p=>{let d=p;if(c.has(d)){let f=c.get(d),v=this[d];f!==v&&(!s.waitUntilFirstUpdate||this.hasUpdated)&&this[u](f,v)}}),i.call(this,c)}}}var re=G`
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
`;var nh={attribute:!0,type:String,converter:wt,reflect:!1,hasChanged:Cs},ah=(e=nh,t,s)=>{let{kind:n,metadata:u}=s,i=globalThis.litPropertyMetadata.get(u);if(i===void 0&&globalThis.litPropertyMetadata.set(u,i=new Map),n==="setter"&&((e=Object.create(e)).wrapped=!0),i.set(s.name,e),n==="accessor"){let{name:r}=s;return{set(c){let p=t.get.call(this);t.set.call(this,c),this.requestUpdate(r,p,e,!0,c)},init(c){return c!==void 0&&this.C(r,void 0,e,c),c}}}if(n==="setter"){let{name:r}=s;return function(c){let p=this[r];t.call(this,c),this.requestUpdate(r,p,e,!0,c)}}throw Error("Unsupported decorator location: "+n)};function $(e){return(t,s)=>typeof s=="object"?ah(e,t,s):((n,u,i)=>{let r=u.hasOwnProperty(i);return u.constructor.createProperty(i,n),r?Object.getOwnPropertyDescriptor(u,i):void 0})(e,t,s)}function pe(e){return $({...e,state:!0,attribute:!1})}function Xn(e){return(t,s)=>{let n=typeof t=="function"?t:t[s];Object.assign(n,e)}}var Ht=(e,t,s)=>(s.configurable=!0,s.enumerable=!0,Reflect.decorate&&typeof t!="object"&&Object.defineProperty(e,t,s),s);function X(e,t){return(s,n,u)=>{let i=r=>r.renderRoot?.querySelector(e)??null;if(t){let{get:r,set:c}=typeof n=="object"?s:u??(()=>{let p=Symbol();return{get(){return this[p]},set(d){this[p]=d}}})();return Ht(s,n,{get(){let p=r.call(this);return p===void 0&&(p=i(this),(p!==null||this.hasUpdated)&&c.call(this,p)),p}})}return Ht(s,n,{get(){return i(this)}})}}var ks,Y=class extends St{constructor(){super(),On(this,ks,!1),this.initialReflectedProperties=new Map,Object.entries(this.constructor.dependencies).forEach(([e,t])=>{this.constructor.define(e,t)})}emit(e,t){let s=new CustomEvent(e,Te({bubbles:!0,cancelable:!1,composed:!0,detail:{}},t));return this.dispatchEvent(s),s}static define(e,t=this,s={}){let n=customElements.get(e);if(!n){try{customElements.define(e,t,s)}catch{customElements.define(e,class extends t{},s)}return}let u=" (unknown version)",i=u;"version"in t&&t.version&&(u=" v"+t.version),"version"in n&&n.version&&(i=" v"+n.version),!(u&&i&&u===i)&&console.warn(`Attempted to register <${e}>${u}, but <${e}>${i} has already been registered.`)}attributeChangedCallback(e,t,s){Rn(this,ks)||(this.constructor.elementProperties.forEach((n,u)=>{n.reflect&&this[u]!=null&&this.initialReflectedProperties.set(u,this[u])}),Bn(this,ks,!0)),super.attributeChangedCallback(e,t,s)}willUpdate(e){super.willUpdate(e),this.initialReflectedProperties.forEach((t,s)=>{e.has(s)&&this[s]==null&&(this[s]=t)})}};ks=new WeakMap;Y.version="2.20.1";Y.dependencies={};T([$()],Y.prototype,"dir",2);T([$()],Y.prototype,"lang",2);var{I:H_}=Eo;var Yn=(e,t)=>t===void 0?e?._$litType$!==void 0:e?._$litType$===t;var Jn=e=>e.strings===void 0;var lh={},Zn=(e,t=lh)=>e._$AH=t;var Hi=Symbol(),Es=Symbol(),Vr,qr=new Map,be=class extends Y{constructor(){super(...arguments),this.initialRender=!1,this.svg=null,this.label="",this.library="default"}async resolveIcon(e,t){var s;let n;if(t?.spriteSheet)return this.svg=z`<svg part="svg">
        <use part="use" href="${e}"></use>
      </svg>`,this.svg;try{if(n=await fetch(e,{mode:"cors"}),!n.ok)return n.status===410?Hi:Es}catch{return Es}try{let u=document.createElement("div");u.innerHTML=await n.text();let i=u.firstElementChild;if(((s=i?.tagName)==null?void 0:s.toLowerCase())!=="svg")return Hi;Vr||(Vr=new DOMParser);let c=Vr.parseFromString(i.outerHTML,"text/html").body.querySelector("svg");return c?(c.part.add("svg"),document.adoptNode(c)):Hi}catch{return Hi}}connectedCallback(){super.connectedCallback(),qn(this)}firstUpdated(){this.initialRender=!0,this.setIcon()}disconnectedCallback(){super.disconnectedCallback(),Kn(this)}getIconSource(){let e=jr(this.library);return this.name&&e?{url:e.resolver(this.name),fromLibrary:!0}:{url:this.src,fromLibrary:!1}}handleLabelChange(){typeof this.label=="string"&&this.label.length>0?(this.setAttribute("role","img"),this.setAttribute("aria-label",this.label),this.removeAttribute("aria-hidden")):(this.removeAttribute("role"),this.removeAttribute("aria-label"),this.setAttribute("aria-hidden","true"))}async setIcon(){var e;let{url:t,fromLibrary:s}=this.getIconSource(),n=s?jr(this.library):void 0;if(!t){this.svg=null;return}let u=qr.get(t);if(u||(u=this.resolveIcon(t,n),qr.set(t,u)),!this.initialRender)return;let i=await u;if(i===Es&&qr.delete(t),t===this.getIconSource().url){if(Yn(i)){if(this.svg=i,n){await this.updateComplete;let r=this.shadowRoot.querySelector("[part='svg']");typeof n.mutator=="function"&&r&&n.mutator(r)}return}switch(i){case Es:case Hi:this.svg=null,this.emit("sl-error");break;default:this.svg=i.cloneNode(!0),(e=n?.mutator)==null||e.call(n,this.svg),this.emit("sl-load")}}}render(){return this.svg}};be.styles=[re,Gn];T([pe()],be.prototype,"svg",2);T([$({reflect:!0})],be.prototype,"name",2);T([$()],be.prototype,"src",2);T([$()],be.prototype,"label",2);T([$({reflect:!0})],be.prototype,"library",2);T([Z("label")],be.prototype,"handleLabelChange",1);T([Z(["name","src","library"])],be.prototype,"setIcon",1);var se=Xt(class extends mt{constructor(e){if(super(e),e.type!==Ke.ATTRIBUTE||e.name!=="class"||e.strings?.length>2)throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.")}render(e){return" "+Object.keys(e).filter(t=>e[t]).join(" ")+" "}update(e,[t]){if(this.st===void 0){this.st=new Set,e.strings!==void 0&&(this.nt=new Set(e.strings.join(" ").split(/\s/).filter(n=>n!=="")));for(let n in t)t[n]&&!this.nt?.has(n)&&this.st.add(n);return this.render(t)}let s=e.element.classList;for(let n of this.st)n in t||(s.remove(n),this.st.delete(n));for(let n in t){let u=!!t[n];u===this.st.has(n)||this.nt?.has(n)||(u?(s.add(n),this.st.add(n)):(s.remove(n),this.st.delete(n)))}return De}});var We=class extends Y{constructor(){super(...arguments),this.localize=new fe(this),this.open=!1,this.disabled=!1}firstUpdated(){this.body.style.height=this.open?"auto":"0",this.open&&(this.details.open=!0),this.detailsObserver=new MutationObserver(e=>{for(let t of e)t.type==="attributes"&&t.attributeName==="open"&&(this.details.open?this.show():this.hide())}),this.detailsObserver.observe(this.details,{attributes:!0})}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this.detailsObserver)==null||e.disconnect()}handleSummaryClick(e){e.preventDefault(),this.disabled||(this.open?this.hide():this.show(),this.header.focus())}handleSummaryKeyDown(e){(e.key==="Enter"||e.key===" ")&&(e.preventDefault(),this.open?this.hide():this.show()),(e.key==="ArrowUp"||e.key==="ArrowLeft")&&(e.preventDefault(),this.hide()),(e.key==="ArrowDown"||e.key==="ArrowRight")&&(e.preventDefault(),this.show())}async handleOpenChange(){if(this.open){if(this.details.open=!0,this.emit("sl-show",{cancelable:!0}).defaultPrevented){this.open=!1,this.details.open=!1;return}await Ae(this.body);let{keyframes:t,options:s}=we(this,"details.show",{dir:this.localize.dir()});await Se(this.body,Hr(t,this.body.scrollHeight),s),this.body.style.height="auto",this.emit("sl-after-show")}else{if(this.emit("sl-hide",{cancelable:!0}).defaultPrevented){this.details.open=!0,this.open=!0;return}await Ae(this.body);let{keyframes:t,options:s}=we(this,"details.hide",{dir:this.localize.dir()});await Se(this.body,Hr(t,this.body.scrollHeight),s),this.body.style.height="auto",this.details.open=!1,this.emit("sl-after-hide")}}async show(){if(!(this.open||this.disabled))return this.open=!0,Re(this,"sl-after-show")}async hide(){if(!(!this.open||this.disabled))return this.open=!1,Re(this,"sl-after-hide")}render(){let e=this.localize.dir()==="rtl";return z`
      <details
        part="base"
        class=${se({details:!0,"details--open":this.open,"details--disabled":this.disabled,"details--rtl":e})}
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
    `}};We.styles=[re,En];We.dependencies={"sl-icon":be};T([X(".details")],We.prototype,"details",2);T([X(".details__header")],We.prototype,"header",2);T([X(".details__body")],We.prototype,"body",2);T([X(".details__expand-icon-slot")],We.prototype,"expandIconSlot",2);T([$({type:Boolean,reflect:!0})],We.prototype,"open",2);T([$()],We.prototype,"summary",2);T([$({type:Boolean,reflect:!0})],We.prototype,"disabled",2);T([Z("open",{waitUntilFirstUpdate:!0})],We.prototype,"handleOpenChange",1);ye("details.show",{keyframes:[{height:"0",opacity:"0"},{height:"auto",opacity:"1"}],options:{duration:250,easing:"linear"}});ye("details.hide",{keyframes:[{height:"auto",opacity:"1"},{height:"0",opacity:"0"}],options:{duration:250,easing:"linear"}});We.define("sl-details");var Qn=G`
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
`;var ea=G`
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
`;var ia=Symbol.for(""),ch=e=>{if(e?.r===ia)return e?._$litStatic$};var ri=(e,...t)=>({_$litStatic$:t.reduce((s,n,u)=>s+(i=>{if(i._$litStatic$!==void 0)return i._$litStatic$;throw Error(`Value passed to 'literal' function must be a 'literal' result: ${i}. Use 'unsafeStatic' to pass non-literal values, but
            take care to ensure page security.`)})(n)+e[u+1],e[0]),r:ia}),ta=new Map,Kr=e=>(t,...s)=>{let n=s.length,u,i,r=[],c=[],p,d=0,f=!1;for(;d<n;){for(p=t[d];d<n&&(i=s[d],(u=ch(i))!==void 0);)p+=u+t[++d],f=!0;d!==n&&c.push(i),r.push(p),d++}if(d===n&&r.push(t[n]),f){let v=r.join("$$lit$$");(t=ta.get(v))===void 0&&(r.raw=r,ta.set(v,t=r)),s=c}return e(t,...s)},oi=Kr(z),Km=Kr(So),Gm=Kr(Co);var ie=e=>e??ee;var ge=class extends Y{constructor(){super(...arguments),this.hasFocus=!1,this.label="",this.disabled=!1}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleClick(e){this.disabled&&(e.preventDefault(),e.stopPropagation())}click(){this.button.click()}focus(e){this.button.focus(e)}blur(){this.button.blur()}render(){let e=!!this.href,t=e?ri`a`:ri`button`;return oi`
      <${t}
        part="base"
        class=${se({"icon-button":!0,"icon-button--disabled":!e&&this.disabled,"icon-button--focused":this.hasFocus})}
        ?disabled=${ie(e?void 0:this.disabled)}
        type=${ie(e?void 0:"button")}
        href=${ie(e?this.href:void 0)}
        target=${ie(e?this.target:void 0)}
        download=${ie(e?this.download:void 0)}
        rel=${ie(e&&this.target?"noreferrer noopener":void 0)}
        role=${ie(e?void 0:"button")}
        aria-disabled=${this.disabled?"true":"false"}
        aria-label="${this.label}"
        tabindex=${this.disabled?"-1":"0"}
        @blur=${this.handleBlur}
        @focus=${this.handleFocus}
        @click=${this.handleClick}
      >
        <sl-icon
          class="icon-button__icon"
          name=${ie(this.name)}
          library=${ie(this.library)}
          src=${ie(this.src)}
          aria-hidden="true"
        ></sl-icon>
      </${t}>
    `}};ge.styles=[re,ea];ge.dependencies={"sl-icon":be};T([X(".icon-button")],ge.prototype,"button",2);T([pe()],ge.prototype,"hasFocus",2);T([$()],ge.prototype,"name",2);T([$()],ge.prototype,"library",2);T([$()],ge.prototype,"src",2);T([$()],ge.prototype,"href",2);T([$()],ge.prototype,"target",2);T([$()],ge.prototype,"download",2);T([$()],ge.prototype,"label",2);T([$({type:Boolean,reflect:!0})],ge.prototype,"disabled",2);var Ct=class extends Y{constructor(){super(...arguments),this.localize=new fe(this),this.variant="neutral",this.size="medium",this.pill=!1,this.removable=!1}handleRemoveClick(){this.emit("sl-remove")}render(){return z`
      <span
        part="base"
        class=${se({tag:!0,"tag--primary":this.variant==="primary","tag--success":this.variant==="success","tag--neutral":this.variant==="neutral","tag--warning":this.variant==="warning","tag--danger":this.variant==="danger","tag--text":this.variant==="text","tag--small":this.size==="small","tag--medium":this.size==="medium","tag--large":this.size==="large","tag--pill":this.pill,"tag--removable":this.removable})}
      >
        <slot part="content" class="tag__content"></slot>

        ${this.removable?z`
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
    `}};Ct.styles=[re,Qn];Ct.dependencies={"sl-icon-button":ge};T([$({reflect:!0})],Ct.prototype,"variant",2);T([$({reflect:!0})],Ct.prototype,"size",2);T([$({type:Boolean,reflect:!0})],Ct.prototype,"pill",2);T([$({type:Boolean})],Ct.prototype,"removable",2);var sa=G`
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
`;function hh(e,t){return{top:Math.round(e.getBoundingClientRect().top-t.getBoundingClientRect().top),left:Math.round(e.getBoundingClientRect().left-t.getBoundingClientRect().left)}}var Gr=new Set;function dh(){let e=document.documentElement.clientWidth;return Math.abs(window.innerWidth-e)}function uh(){let e=Number(getComputedStyle(document.body).paddingRight.replace(/px/,""));return isNaN(e)||!e?0:e}function Xr(e){if(Gr.add(e),!document.documentElement.classList.contains("sl-scroll-lock")){let t=dh()+uh(),s=getComputedStyle(document.documentElement).scrollbarGutter;(!s||s==="auto")&&(s="stable"),t<2&&(s=""),document.documentElement.style.setProperty("--sl-scroll-lock-gutter",s),document.documentElement.classList.add("sl-scroll-lock"),document.documentElement.style.setProperty("--sl-scroll-lock-size",`${t}px`)}}function Yr(e){Gr.delete(e),Gr.size===0&&(document.documentElement.classList.remove("sl-scroll-lock"),document.documentElement.style.removeProperty("--sl-scroll-lock-size"))}function Fi(e,t,s="vertical",n="smooth"){let u=hh(e,t),i=u.top+t.scrollTop,r=u.left+t.scrollLeft,c=t.scrollLeft,p=t.scrollLeft+t.offsetWidth,d=t.scrollTop,f=t.scrollTop+t.offsetHeight;(s==="horizontal"||s==="both")&&(r<c?t.scrollTo({left:r,behavior:n}):r+e.clientWidth>p&&t.scrollTo({left:r-t.offsetWidth+e.clientWidth,behavior:n})),(s==="vertical"||s==="both")&&(i<d?t.scrollTo({top:i,behavior:n}):i+e.clientHeight>f&&t.scrollTo({top:i-t.offsetHeight+e.clientHeight,behavior:n}))}var ni=G`
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
`;var ra=G`
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
`;var it=Math.min,Oe=Math.max,Ni=Math.round,Wi=Math.floor,Xe=e=>({x:e,y:e}),ph={left:"right",right:"left",bottom:"top",top:"bottom"};function Ls(e,t,s){return Oe(e,it(t,s))}function Ft(e,t){return typeof e=="function"?e(t):e}function dt(e){return e.split("-")[0]}function zt(e){return e.split("-")[1]}function Jr(e){return e==="x"?"y":"x"}function Ds(e){return e==="y"?"height":"width"}function st(e){let t=e[0];return t==="t"||t==="b"?"y":"x"}function Ts(e){return Jr(st(e))}function aa(e,t,s){s===void 0&&(s=!1);let n=zt(e),u=Ts(e),i=Ds(u),r=u==="x"?n===(s?"end":"start")?"right":"left":n==="start"?"bottom":"top";return t.reference[i]>t.floating[i]&&(r=zi(r)),[r,zi(r)]}function la(e){let t=zi(e);return[As(e),t,As(t)]}function As(e){return e.includes("start")?e.replace("start","end"):e.replace("end","start")}var oa=["left","right"],na=["right","left"],fh=["top","bottom"],_h=["bottom","top"];function mh(e,t,s){switch(e){case"top":case"bottom":return s?t?na:oa:t?oa:na;case"left":case"right":return t?fh:_h;default:return[]}}function ca(e,t,s,n){let u=zt(e),i=mh(dt(e),s==="start",n);return u&&(i=i.map(r=>r+"-"+u),t&&(i=i.concat(i.map(As)))),i}function zi(e){let t=dt(e);return ph[t]+e.slice(t.length)}function gh(e){return{top:0,right:0,bottom:0,left:0,...e}}function Zr(e){return typeof e!="number"?gh(e):{top:e,right:e,bottom:e,left:e}}function Nt(e){let{x:t,y:s,width:n,height:u}=e;return{width:n,height:u,top:s,left:t,right:t+n,bottom:s+u,x:t,y:s}}function ha(e,t,s){let{reference:n,floating:u}=e,i=st(t),r=Ts(t),c=Ds(r),p=dt(t),d=i==="y",f=n.x+n.width/2-u.width/2,v=n.y+n.height/2-u.height/2,w=n[c]/2-u[c]/2,b;switch(p){case"top":b={x:f,y:n.y-u.height};break;case"bottom":b={x:f,y:n.y+n.height};break;case"right":b={x:n.x+n.width,y:v};break;case"left":b={x:n.x-u.width,y:v};break;default:b={x:n.x,y:n.y}}switch(zt(t)){case"start":b[r]-=w*(s&&d?-1:1);break;case"end":b[r]+=w*(s&&d?-1:1);break}return b}async function da(e,t){var s;t===void 0&&(t={});let{x:n,y:u,platform:i,rects:r,elements:c,strategy:p}=e,{boundary:d="clippingAncestors",rootBoundary:f="viewport",elementContext:v="floating",altBoundary:w=!1,padding:b=0}=Ft(t,e),o=Zr(b),a=c[w?v==="floating"?"reference":"floating":v],h=Nt(await i.getClippingRect({element:(s=await(i.isElement==null?void 0:i.isElement(a)))==null||s?a:a.contextElement||await(i.getDocumentElement==null?void 0:i.getDocumentElement(c.floating)),boundary:d,rootBoundary:f,strategy:p})),_=v==="floating"?{x:n,y:u,width:r.floating.width,height:r.floating.height}:r.reference,g=await(i.getOffsetParent==null?void 0:i.getOffsetParent(c.floating)),y=await(i.isElement==null?void 0:i.isElement(g))?await(i.getScale==null?void 0:i.getScale(g))||{x:1,y:1}:{x:1,y:1},x=Nt(i.convertOffsetParentRelativeRectToViewportRelativeRect?await i.convertOffsetParentRelativeRectToViewportRelativeRect({elements:c,rect:_,offsetParent:g,strategy:p}):_);return{top:(h.top-x.top+o.top)/y.y,bottom:(x.bottom-h.bottom+o.bottom)/y.y,left:(h.left-x.left+o.left)/y.x,right:(x.right-h.right+o.right)/y.x}}var vh=50,ua=async(e,t,s)=>{let{placement:n="bottom",strategy:u="absolute",middleware:i=[],platform:r}=s,c=r.detectOverflow?r:{...r,detectOverflow:da},p=await(r.isRTL==null?void 0:r.isRTL(t)),d=await r.getElementRects({reference:e,floating:t,strategy:u}),{x:f,y:v}=ha(d,n,p),w=n,b=0,o={};for(let l=0;l<i.length;l++){let a=i[l];if(!a)continue;let{name:h,fn:_}=a,{x:g,y,data:x,reset:m}=await _({x:f,y:v,initialPlacement:n,placement:w,strategy:u,middlewareData:o,rects:d,platform:c,elements:{reference:e,floating:t}});f=g??f,v=y??v,o[h]={...o[h],...x},m&&b<vh&&(b++,typeof m=="object"&&(m.placement&&(w=m.placement),m.rects&&(d=m.rects===!0?await r.getElementRects({reference:e,floating:t,strategy:u}):m.rects),{x:f,y:v}=ha(d,w,p)),l=-1)}return{x:f,y:v,placement:w,strategy:u,middlewareData:o}},pa=e=>({name:"arrow",options:e,async fn(t){let{x:s,y:n,placement:u,rects:i,platform:r,elements:c,middlewareData:p}=t,{element:d,padding:f=0}=Ft(e,t)||{};if(d==null)return{};let v=Zr(f),w={x:s,y:n},b=Ts(u),o=Ds(b),l=await r.getDimensions(d),a=b==="y",h=a?"top":"left",_=a?"bottom":"right",g=a?"clientHeight":"clientWidth",y=i.reference[o]+i.reference[b]-w[b]-i.floating[o],x=w[b]-i.reference[b],m=await(r.getOffsetParent==null?void 0:r.getOffsetParent(d)),S=m?m[g]:0;(!S||!await(r.isElement==null?void 0:r.isElement(m)))&&(S=c.floating[g]||i.floating[o]);let L=y/2-x/2,O=S/2-l[o]/2-1,D=it(v[h],O),B=it(v[_],O),F=D,P=S-l[o]-B,M=S/2-l[o]/2+L,I=Ls(F,M,P),C=!p.arrow&&zt(u)!=null&&M!==I&&i.reference[o]/2-(M<F?D:B)-l[o]/2<0,E=C?M<F?M-F:M-P:0;return{[b]:w[b]+E,data:{[b]:I,centerOffset:M-I-E,...C&&{alignmentOffset:E}},reset:C}}});var fa=function(e){return e===void 0&&(e={}),{name:"flip",options:e,async fn(t){var s,n;let{placement:u,middlewareData:i,rects:r,initialPlacement:c,platform:p,elements:d}=t,{mainAxis:f=!0,crossAxis:v=!0,fallbackPlacements:w,fallbackStrategy:b="bestFit",fallbackAxisSideDirection:o="none",flipAlignment:l=!0,...a}=Ft(e,t);if((s=i.arrow)!=null&&s.alignmentOffset)return{};let h=dt(u),_=st(c),g=dt(c)===c,y=await(p.isRTL==null?void 0:p.isRTL(d.floating)),x=w||(g||!l?[zi(c)]:la(c)),m=o!=="none";!w&&m&&x.push(...ca(c,l,o,y));let S=[c,...x],L=await p.detectOverflow(t,a),O=[],D=((n=i.flip)==null?void 0:n.overflows)||[];if(f&&O.push(L[h]),v){let M=aa(u,r,y);O.push(L[M[0]],L[M[1]])}if(D=[...D,{placement:u,overflows:O}],!O.every(M=>M<=0)){var B,F;let M=(((B=i.flip)==null?void 0:B.index)||0)+1,I=S[M];if(I&&(!(v==="alignment"?_!==st(I):!1)||D.every(A=>st(A.placement)===_?A.overflows[0]>0:!0)))return{data:{index:M,overflows:D},reset:{placement:I}};let C=(F=D.filter(E=>E.overflows[0]<=0).sort((E,A)=>E.overflows[1]-A.overflows[1])[0])==null?void 0:F.placement;if(!C)switch(b){case"bestFit":{var P;let E=(P=D.filter(A=>{if(m){let R=st(A.placement);return R===_||R==="y"}return!0}).map(A=>[A.placement,A.overflows.filter(R=>R>0).reduce((R,N)=>R+N,0)]).sort((A,R)=>A[1]-R[1])[0])==null?void 0:P[0];E&&(C=E);break}case"initialPlacement":C=c;break}if(u!==C)return{reset:{placement:C}}}return{}}}};var bh=new Set(["left","top"]);async function yh(e,t){let{placement:s,platform:n,elements:u}=e,i=await(n.isRTL==null?void 0:n.isRTL(u.floating)),r=dt(s),c=zt(s),p=st(s)==="y",d=bh.has(r)?-1:1,f=i&&p?-1:1,v=Ft(t,e),{mainAxis:w,crossAxis:b,alignmentAxis:o}=typeof v=="number"?{mainAxis:v,crossAxis:0,alignmentAxis:null}:{mainAxis:v.mainAxis||0,crossAxis:v.crossAxis||0,alignmentAxis:v.alignmentAxis};return c&&typeof o=="number"&&(b=c==="end"?o*-1:o),p?{x:b*f,y:w*d}:{x:w*d,y:b*f}}var _a=function(e){return e===void 0&&(e=0),{name:"offset",options:e,async fn(t){var s,n;let{x:u,y:i,placement:r,middlewareData:c}=t,p=await yh(t,e);return r===((s=c.offset)==null?void 0:s.placement)&&(n=c.arrow)!=null&&n.alignmentOffset?{}:{x:u+p.x,y:i+p.y,data:{...p,placement:r}}}}},ma=function(e){return e===void 0&&(e={}),{name:"shift",options:e,async fn(t){let{x:s,y:n,placement:u,platform:i}=t,{mainAxis:r=!0,crossAxis:c=!1,limiter:p={fn:h=>{let{x:_,y:g}=h;return{x:_,y:g}}},...d}=Ft(e,t),f={x:s,y:n},v=await i.detectOverflow(t,d),w=st(dt(u)),b=Jr(w),o=f[b],l=f[w];if(r){let h=b==="y"?"top":"left",_=b==="y"?"bottom":"right",g=o+v[h],y=o-v[_];o=Ls(g,o,y)}if(c){let h=w==="y"?"top":"left",_=w==="y"?"bottom":"right",g=l+v[h],y=l-v[_];l=Ls(g,l,y)}let a=p.fn({...t,[b]:o,[w]:l});return{...a,data:{x:a.x-s,y:a.y-n,enabled:{[b]:r,[w]:c}}}}}};var ga=function(e){return e===void 0&&(e={}),{name:"size",options:e,async fn(t){var s,n;let{placement:u,rects:i,platform:r,elements:c}=t,{apply:p=()=>{},...d}=Ft(e,t),f=await r.detectOverflow(t,d),v=dt(u),w=zt(u),b=st(u)==="y",{width:o,height:l}=i.floating,a,h;v==="top"||v==="bottom"?(a=v,h=w===(await(r.isRTL==null?void 0:r.isRTL(c.floating))?"start":"end")?"left":"right"):(h=v,a=w==="end"?"top":"bottom");let _=l-f.top-f.bottom,g=o-f.left-f.right,y=it(l-f[a],_),x=it(o-f[h],g),m=!t.middlewareData.shift,S=y,L=x;if((s=t.middlewareData.shift)!=null&&s.enabled.x&&(L=g),(n=t.middlewareData.shift)!=null&&n.enabled.y&&(S=_),m&&!w){let D=Oe(f.left,0),B=Oe(f.right,0),F=Oe(f.top,0),P=Oe(f.bottom,0);b?L=o-2*(D!==0||B!==0?D+B:Oe(f.left,f.right)):S=l-2*(F!==0||P!==0?F+P:Oe(f.top,f.bottom))}await p({...t,availableWidth:L,availableHeight:S});let O=await r.getDimensions(c.floating);return o!==O.width||l!==O.height?{reset:{rects:!0}}:{}}}};function Rs(){return typeof window<"u"}function Ut(e){return ba(e)?(e.nodeName||"").toLowerCase():"#document"}function Pe(e){var t;return(e==null||(t=e.ownerDocument)==null?void 0:t.defaultView)||window}function Ye(e){var t;return(t=(ba(e)?e.ownerDocument:e.document)||window.document)==null?void 0:t.documentElement}function ba(e){return Rs()?e instanceof Node||e instanceof Pe(e).Node:!1}function Ue(e){return Rs()?e instanceof Element||e instanceof Pe(e).Element:!1}function rt(e){return Rs()?e instanceof HTMLElement||e instanceof Pe(e).HTMLElement:!1}function va(e){return!Rs()||typeof ShadowRoot>"u"?!1:e instanceof ShadowRoot||e instanceof Pe(e).ShadowRoot}function li(e){let{overflow:t,overflowX:s,overflowY:n,display:u}=je(e);return/auto|scroll|overlay|hidden|clip/.test(t+n+s)&&u!=="inline"&&u!=="contents"}function ya(e){return/^(table|td|th)$/.test(Ut(e))}function Ui(e){try{if(e.matches(":popover-open"))return!0}catch{}try{return e.matches(":modal")}catch{return!1}}var wh=/transform|translate|scale|rotate|perspective|filter/,Sh=/paint|layout|strict|content/,Wt=e=>!!e&&e!=="none",Qr;function ci(e){let t=Ue(e)?je(e):e;return Wt(t.transform)||Wt(t.translate)||Wt(t.scale)||Wt(t.rotate)||Wt(t.perspective)||!Os()&&(Wt(t.backdropFilter)||Wt(t.filter))||wh.test(t.willChange||"")||Sh.test(t.contain||"")}function wa(e){let t=ut(e);for(;rt(t)&&!jt(t);){if(ci(t))return t;if(Ui(t))return null;t=ut(t)}return null}function Os(){return Qr==null&&(Qr=typeof CSS<"u"&&CSS.supports&&CSS.supports("-webkit-backdrop-filter","none")),Qr}function jt(e){return/^(html|body|#document)$/.test(Ut(e))}function je(e){return Pe(e).getComputedStyle(e)}function ji(e){return Ue(e)?{scrollLeft:e.scrollLeft,scrollTop:e.scrollTop}:{scrollLeft:e.scrollX,scrollTop:e.scrollY}}function ut(e){if(Ut(e)==="html")return e;let t=e.assignedSlot||e.parentNode||va(e)&&e.host||Ye(e);return va(t)?t.host:t}function Sa(e){let t=ut(e);return jt(t)?e.ownerDocument?e.ownerDocument.body:e.body:rt(t)&&li(t)?t:Sa(t)}function ai(e,t,s){var n;t===void 0&&(t=[]),s===void 0&&(s=!0);let u=Sa(e),i=u===((n=e.ownerDocument)==null?void 0:n.body),r=Pe(u);if(i){let c=Bs(r);return t.concat(r,r.visualViewport||[],li(u)?u:[],c&&s?ai(c):[])}else return t.concat(u,ai(u,[],s))}function Bs(e){return e.parent&&Object.getPrototypeOf(e.parent)?e.frameElement:null}function Ea(e){let t=je(e),s=parseFloat(t.width)||0,n=parseFloat(t.height)||0,u=rt(e),i=u?e.offsetWidth:s,r=u?e.offsetHeight:n,c=Ni(s)!==i||Ni(n)!==r;return c&&(s=i,n=r),{width:s,height:n,$:c}}function to(e){return Ue(e)?e:e.contextElement}function hi(e){let t=to(e);if(!rt(t))return Xe(1);let s=t.getBoundingClientRect(),{width:n,height:u,$:i}=Ea(t),r=(i?Ni(s.width):s.width)/n,c=(i?Ni(s.height):s.height)/u;return(!r||!Number.isFinite(r))&&(r=1),(!c||!Number.isFinite(c))&&(c=1),{x:r,y:c}}var Ch=Xe(0);function Aa(e){let t=Pe(e);return!Os()||!t.visualViewport?Ch:{x:t.visualViewport.offsetLeft,y:t.visualViewport.offsetTop}}function xh(e,t,s){return t===void 0&&(t=!1),!s||t&&s!==Pe(e)?!1:t}function Vt(e,t,s,n){t===void 0&&(t=!1),s===void 0&&(s=!1);let u=e.getBoundingClientRect(),i=to(e),r=Xe(1);t&&(n?Ue(n)&&(r=hi(n)):r=hi(e));let c=xh(i,s,n)?Aa(i):Xe(0),p=(u.left+c.x)/r.x,d=(u.top+c.y)/r.y,f=u.width/r.x,v=u.height/r.y;if(i){let w=Pe(i),b=n&&Ue(n)?Pe(n):n,o=w,l=Bs(o);for(;l&&n&&b!==o;){let a=hi(l),h=l.getBoundingClientRect(),_=je(l),g=h.left+(l.clientLeft+parseFloat(_.paddingLeft))*a.x,y=h.top+(l.clientTop+parseFloat(_.paddingTop))*a.y;p*=a.x,d*=a.y,f*=a.x,v*=a.y,p+=g,d+=y,o=Pe(l),l=Bs(o)}}return Nt({width:f,height:v,x:p,y:d})}function Ms(e,t){let s=ji(e).scrollLeft;return t?t.left+s:Vt(Ye(e)).left+s}function La(e,t){let s=e.getBoundingClientRect(),n=s.left+t.scrollLeft-Ms(e,s),u=s.top+t.scrollTop;return{x:n,y:u}}function kh(e){let{elements:t,rect:s,offsetParent:n,strategy:u}=e,i=u==="fixed",r=Ye(n),c=t?Ui(t.floating):!1;if(n===r||c&&i)return s;let p={scrollLeft:0,scrollTop:0},d=Xe(1),f=Xe(0),v=rt(n);if((v||!v&&!i)&&((Ut(n)!=="body"||li(r))&&(p=ji(n)),v)){let b=Vt(n);d=hi(n),f.x=b.x+n.clientLeft,f.y=b.y+n.clientTop}let w=r&&!v&&!i?La(r,p):Xe(0);return{width:s.width*d.x,height:s.height*d.y,x:s.x*d.x-p.scrollLeft*d.x+f.x+w.x,y:s.y*d.y-p.scrollTop*d.y+f.y+w.y}}function Eh(e){return Array.from(e.getClientRects())}function Ah(e){let t=Ye(e),s=ji(e),n=e.ownerDocument.body,u=Oe(t.scrollWidth,t.clientWidth,n.scrollWidth,n.clientWidth),i=Oe(t.scrollHeight,t.clientHeight,n.scrollHeight,n.clientHeight),r=-s.scrollLeft+Ms(e),c=-s.scrollTop;return je(n).direction==="rtl"&&(r+=Oe(t.clientWidth,n.clientWidth)-u),{width:u,height:i,x:r,y:c}}var Ca=25;function Lh(e,t){let s=Pe(e),n=Ye(e),u=s.visualViewport,i=n.clientWidth,r=n.clientHeight,c=0,p=0;if(u){i=u.width,r=u.height;let f=Os();(!f||f&&t==="fixed")&&(c=u.offsetLeft,p=u.offsetTop)}let d=Ms(n);if(d<=0){let f=n.ownerDocument,v=f.body,w=getComputedStyle(v),b=f.compatMode==="CSS1Compat"&&parseFloat(w.marginLeft)+parseFloat(w.marginRight)||0,o=Math.abs(n.clientWidth-v.clientWidth-b);o<=Ca&&(i-=o)}else d<=Ca&&(i+=d);return{width:i,height:r,x:c,y:p}}function Dh(e,t){let s=Vt(e,!0,t==="fixed"),n=s.top+e.clientTop,u=s.left+e.clientLeft,i=rt(e)?hi(e):Xe(1),r=e.clientWidth*i.x,c=e.clientHeight*i.y,p=u*i.x,d=n*i.y;return{width:r,height:c,x:p,y:d}}function xa(e,t,s){let n;if(t==="viewport")n=Lh(e,s);else if(t==="document")n=Ah(Ye(e));else if(Ue(t))n=Dh(t,s);else{let u=Aa(e);n={x:t.x-u.x,y:t.y-u.y,width:t.width,height:t.height}}return Nt(n)}function Da(e,t){let s=ut(e);return s===t||!Ue(s)||jt(s)?!1:je(s).position==="fixed"||Da(s,t)}function Th(e,t){let s=t.get(e);if(s)return s;let n=ai(e,[],!1).filter(c=>Ue(c)&&Ut(c)!=="body"),u=null,i=je(e).position==="fixed",r=i?ut(e):e;for(;Ue(r)&&!jt(r);){let c=je(r),p=ci(r);!p&&c.position==="fixed"&&(u=null),(i?!p&&!u:!p&&c.position==="static"&&!!u&&(u.position==="absolute"||u.position==="fixed")||li(r)&&!p&&Da(e,r))?n=n.filter(f=>f!==r):u=c,r=ut(r)}return t.set(e,n),n}function Rh(e){let{element:t,boundary:s,rootBoundary:n,strategy:u}=e,r=[...s==="clippingAncestors"?Ui(t)?[]:Th(t,this._c):[].concat(s),n],c=xa(t,r[0],u),p=c.top,d=c.right,f=c.bottom,v=c.left;for(let w=1;w<r.length;w++){let b=xa(t,r[w],u);p=Oe(b.top,p),d=it(b.right,d),f=it(b.bottom,f),v=Oe(b.left,v)}return{width:d-v,height:f-p,x:v,y:p}}function Oh(e){let{width:t,height:s}=Ea(e);return{width:t,height:s}}function Bh(e,t,s){let n=rt(t),u=Ye(t),i=s==="fixed",r=Vt(e,!0,i,t),c={scrollLeft:0,scrollTop:0},p=Xe(0);function d(){p.x=Ms(u)}if(n||!n&&!i)if((Ut(t)!=="body"||li(u))&&(c=ji(t)),n){let b=Vt(t,!0,i,t);p.x=b.x+t.clientLeft,p.y=b.y+t.clientTop}else u&&d();i&&!n&&u&&d();let f=u&&!n&&!i?La(u,c):Xe(0),v=r.left+c.scrollLeft-p.x-f.x,w=r.top+c.scrollTop-p.y-f.y;return{x:v,y:w,width:r.width,height:r.height}}function eo(e){return je(e).position==="static"}function ka(e,t){if(!rt(e)||je(e).position==="fixed")return null;if(t)return t(e);let s=e.offsetParent;return Ye(e)===s&&(s=s.ownerDocument.body),s}function Ta(e,t){let s=Pe(e);if(Ui(e))return s;if(!rt(e)){let u=ut(e);for(;u&&!jt(u);){if(Ue(u)&&!eo(u))return u;u=ut(u)}return s}let n=ka(e,t);for(;n&&ya(n)&&eo(n);)n=ka(n,t);return n&&jt(n)&&eo(n)&&!ci(n)?s:n||wa(e)||s}var Mh=async function(e){let t=this.getOffsetParent||Ta,s=this.getDimensions,n=await s(e.floating);return{reference:Bh(e.reference,await t(e.floating),e.strategy),floating:{x:0,y:0,width:n.width,height:n.height}}};function Ph(e){return je(e).direction==="rtl"}var Vi={convertOffsetParentRelativeRectToViewportRelativeRect:kh,getDocumentElement:Ye,getClippingRect:Rh,getOffsetParent:Ta,getElementRects:Mh,getClientRects:Eh,getDimensions:Oh,getScale:hi,isElement:Ue,isRTL:Ph};function Ra(e,t){return e.x===t.x&&e.y===t.y&&e.width===t.width&&e.height===t.height}function $h(e,t){let s=null,n,u=Ye(e);function i(){var c;clearTimeout(n),(c=s)==null||c.disconnect(),s=null}function r(c,p){c===void 0&&(c=!1),p===void 0&&(p=1),i();let d=e.getBoundingClientRect(),{left:f,top:v,width:w,height:b}=d;if(c||t(),!w||!b)return;let o=Wi(v),l=Wi(u.clientWidth-(f+w)),a=Wi(u.clientHeight-(v+b)),h=Wi(f),g={rootMargin:-o+"px "+-l+"px "+-a+"px "+-h+"px",threshold:Oe(0,it(1,p))||1},y=!0;function x(m){let S=m[0].intersectionRatio;if(S!==p){if(!y)return r();S?r(!1,S):n=setTimeout(()=>{r(!1,1e-7)},1e3)}S===1&&!Ra(d,e.getBoundingClientRect())&&r(),y=!1}try{s=new IntersectionObserver(x,{...g,root:u.ownerDocument})}catch{s=new IntersectionObserver(x,g)}s.observe(e)}return r(!0),i}function Oa(e,t,s,n){n===void 0&&(n={});let{ancestorScroll:u=!0,ancestorResize:i=!0,elementResize:r=typeof ResizeObserver=="function",layoutShift:c=typeof IntersectionObserver=="function",animationFrame:p=!1}=n,d=to(e),f=u||i?[...d?ai(d):[],...t?ai(t):[]]:[];f.forEach(h=>{u&&h.addEventListener("scroll",s,{passive:!0}),i&&h.addEventListener("resize",s)});let v=d&&c?$h(d,s):null,w=-1,b=null;r&&(b=new ResizeObserver(h=>{let[_]=h;_&&_.target===d&&b&&t&&(b.unobserve(t),cancelAnimationFrame(w),w=requestAnimationFrame(()=>{var g;(g=b)==null||g.observe(t)})),s()}),d&&!p&&b.observe(d),t&&b.observe(t));let o,l=p?Vt(e):null;p&&a();function a(){let h=Vt(e);l&&!Ra(l,h)&&s(),l=h,o=requestAnimationFrame(a)}return s(),()=>{var h;f.forEach(_=>{u&&_.removeEventListener("scroll",s),i&&_.removeEventListener("resize",s)}),v?.(),(h=b)==null||h.disconnect(),b=null,p&&cancelAnimationFrame(o)}}var Ba=_a;var Ma=ma,Pa=fa,io=ga;var $a=pa;var Ia=(e,t,s)=>{let n=new Map,u={platform:Vi,...s},i={...u.platform,_c:n};return ua(e,t,{...u,platform:i})};function Ha(e){return Ih(e)}function so(e){return e.assignedSlot?e.assignedSlot:e.parentNode instanceof ShadowRoot?e.parentNode.host:e.parentNode}function Ih(e){for(let t=e;t;t=so(t))if(t instanceof Element&&getComputedStyle(t).display==="none")return null;for(let t=so(e);t;t=so(t)){if(!(t instanceof Element))continue;let s=getComputedStyle(t);if(s.display!=="contents"&&(s.position!=="static"||ci(s)||t.tagName==="BODY"))return t}return null}function Hh(e){return e!==null&&typeof e=="object"&&"getBoundingClientRect"in e&&("contextElement"in e?e.contextElement instanceof Element:!0)}var ue=class extends Y{constructor(){super(...arguments),this.localize=new fe(this),this.active=!1,this.placement="top",this.strategy="absolute",this.distance=0,this.skidding=0,this.arrow=!1,this.arrowPlacement="anchor",this.arrowPadding=10,this.flip=!1,this.flipFallbackPlacements="",this.flipFallbackStrategy="best-fit",this.flipPadding=0,this.shift=!1,this.shiftPadding=0,this.autoSizePadding=0,this.hoverBridge=!1,this.updateHoverBridge=()=>{if(this.hoverBridge&&this.anchorEl){let e=this.anchorEl.getBoundingClientRect(),t=this.popup.getBoundingClientRect(),s=this.placement.includes("top")||this.placement.includes("bottom"),n=0,u=0,i=0,r=0,c=0,p=0,d=0,f=0;s?e.top<t.top?(n=e.left,u=e.bottom,i=e.right,r=e.bottom,c=t.left,p=t.top,d=t.right,f=t.top):(n=t.left,u=t.bottom,i=t.right,r=t.bottom,c=e.left,p=e.top,d=e.right,f=e.top):e.left<t.left?(n=e.right,u=e.top,i=t.left,r=t.top,c=e.right,p=e.bottom,d=t.left,f=t.bottom):(n=t.right,u=t.top,i=e.left,r=e.top,c=t.right,p=t.bottom,d=e.left,f=e.bottom),this.style.setProperty("--hover-bridge-top-left-x",`${n}px`),this.style.setProperty("--hover-bridge-top-left-y",`${u}px`),this.style.setProperty("--hover-bridge-top-right-x",`${i}px`),this.style.setProperty("--hover-bridge-top-right-y",`${r}px`),this.style.setProperty("--hover-bridge-bottom-left-x",`${c}px`),this.style.setProperty("--hover-bridge-bottom-left-y",`${p}px`),this.style.setProperty("--hover-bridge-bottom-right-x",`${d}px`),this.style.setProperty("--hover-bridge-bottom-right-y",`${f}px`)}}}async connectedCallback(){super.connectedCallback(),await this.updateComplete,this.start()}disconnectedCallback(){super.disconnectedCallback(),this.stop()}async updated(e){super.updated(e),e.has("active")&&(this.active?this.start():this.stop()),e.has("anchor")&&this.handleAnchorChange(),this.active&&(await this.updateComplete,this.reposition())}async handleAnchorChange(){if(await this.stop(),this.anchor&&typeof this.anchor=="string"){let e=this.getRootNode();this.anchorEl=e.getElementById(this.anchor)}else this.anchor instanceof Element||Hh(this.anchor)?this.anchorEl=this.anchor:this.anchorEl=this.querySelector('[slot="anchor"]');this.anchorEl instanceof HTMLSlotElement&&(this.anchorEl=this.anchorEl.assignedElements({flatten:!0})[0]),this.anchorEl&&this.active&&this.start()}start(){!this.anchorEl||!this.active||(this.cleanup=Oa(this.anchorEl,this.popup,()=>{this.reposition()}))}async stop(){return new Promise(e=>{this.cleanup?(this.cleanup(),this.cleanup=void 0,this.removeAttribute("data-current-placement"),this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height"),requestAnimationFrame(()=>e())):e()})}reposition(){if(!this.active||!this.anchorEl)return;let e=[Ba({mainAxis:this.distance,crossAxis:this.skidding})];this.sync?e.push(io({apply:({rects:s})=>{let n=this.sync==="width"||this.sync==="both",u=this.sync==="height"||this.sync==="both";this.popup.style.width=n?`${s.reference.width}px`:"",this.popup.style.height=u?`${s.reference.height}px`:""}})):(this.popup.style.width="",this.popup.style.height=""),this.flip&&e.push(Pa({boundary:this.flipBoundary,fallbackPlacements:this.flipFallbackPlacements,fallbackStrategy:this.flipFallbackStrategy==="best-fit"?"bestFit":"initialPlacement",padding:this.flipPadding})),this.shift&&e.push(Ma({boundary:this.shiftBoundary,padding:this.shiftPadding})),this.autoSize?e.push(io({boundary:this.autoSizeBoundary,padding:this.autoSizePadding,apply:({availableWidth:s,availableHeight:n})=>{this.autoSize==="vertical"||this.autoSize==="both"?this.style.setProperty("--auto-size-available-height",`${n}px`):this.style.removeProperty("--auto-size-available-height"),this.autoSize==="horizontal"||this.autoSize==="both"?this.style.setProperty("--auto-size-available-width",`${s}px`):this.style.removeProperty("--auto-size-available-width")}})):(this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height")),this.arrow&&e.push($a({element:this.arrowEl,padding:this.arrowPadding}));let t=this.strategy==="absolute"?s=>Vi.getOffsetParent(s,Ha):Vi.getOffsetParent;Ia(this.anchorEl,this.popup,{placement:this.placement,middleware:e,strategy:this.strategy,platform:ht(Te({},Vi),{getOffsetParent:t})}).then(({x:s,y:n,middlewareData:u,placement:i})=>{let r=this.localize.dir()==="rtl",c={top:"bottom",right:"left",bottom:"top",left:"right"}[i.split("-")[0]];if(this.setAttribute("data-current-placement",i),Object.assign(this.popup.style,{left:`${s}px`,top:`${n}px`}),this.arrow){let p=u.arrow.x,d=u.arrow.y,f="",v="",w="",b="";if(this.arrowPlacement==="start"){let o=typeof p=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";f=typeof d=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"",v=r?o:"",b=r?"":o}else if(this.arrowPlacement==="end"){let o=typeof p=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";v=r?"":o,b=r?o:"",w=typeof d=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:""}else this.arrowPlacement==="center"?(b=typeof p=="number"?"calc(50% - var(--arrow-size-diagonal))":"",f=typeof d=="number"?"calc(50% - var(--arrow-size-diagonal))":""):(b=typeof p=="number"?`${p}px`:"",f=typeof d=="number"?`${d}px`:"");Object.assign(this.arrowEl.style,{top:f,right:v,bottom:w,left:b,[c]:"calc(var(--arrow-size-diagonal) * -1)"})}}),requestAnimationFrame(()=>this.updateHoverBridge()),this.emit("sl-reposition")}render(){return z`
      <slot name="anchor" @slotchange=${this.handleAnchorChange}></slot>

      <span
        part="hover-bridge"
        class=${se({"popup-hover-bridge":!0,"popup-hover-bridge--visible":this.hoverBridge&&this.active})}
      ></span>

      <div
        part="popup"
        class=${se({popup:!0,"popup--active":this.active,"popup--fixed":this.strategy==="fixed","popup--has-arrow":this.arrow})}
      >
        <slot></slot>
        ${this.arrow?z`<div part="arrow" class="popup__arrow" role="presentation"></div>`:""}
      </div>
    `}};ue.styles=[re,ra];T([X(".popup")],ue.prototype,"popup",2);T([X(".popup__arrow")],ue.prototype,"arrowEl",2);T([$()],ue.prototype,"anchor",2);T([$({type:Boolean,reflect:!0})],ue.prototype,"active",2);T([$({reflect:!0})],ue.prototype,"placement",2);T([$({reflect:!0})],ue.prototype,"strategy",2);T([$({type:Number})],ue.prototype,"distance",2);T([$({type:Number})],ue.prototype,"skidding",2);T([$({type:Boolean})],ue.prototype,"arrow",2);T([$({attribute:"arrow-placement"})],ue.prototype,"arrowPlacement",2);T([$({attribute:"arrow-padding",type:Number})],ue.prototype,"arrowPadding",2);T([$({type:Boolean})],ue.prototype,"flip",2);T([$({attribute:"flip-fallback-placements",converter:{fromAttribute:e=>e.split(" ").map(t=>t.trim()).filter(t=>t!==""),toAttribute:e=>e.join(" ")}})],ue.prototype,"flipFallbackPlacements",2);T([$({attribute:"flip-fallback-strategy"})],ue.prototype,"flipFallbackStrategy",2);T([$({type:Object})],ue.prototype,"flipBoundary",2);T([$({attribute:"flip-padding",type:Number})],ue.prototype,"flipPadding",2);T([$({type:Boolean})],ue.prototype,"shift",2);T([$({type:Object})],ue.prototype,"shiftBoundary",2);T([$({attribute:"shift-padding",type:Number})],ue.prototype,"shiftPadding",2);T([$({attribute:"auto-size"})],ue.prototype,"autoSize",2);T([$()],ue.prototype,"sync",2);T([$({type:Object})],ue.prototype,"autoSizeBoundary",2);T([$({attribute:"auto-size-padding",type:Number})],ue.prototype,"autoSizePadding",2);T([$({attribute:"hover-bridge",type:Boolean})],ue.prototype,"hoverBridge",2);var qi=new WeakMap,Ki=new WeakMap,Gi=new WeakMap,ro=new WeakSet,Ps=new WeakMap,xt=class{constructor(e,t){this.handleFormData=s=>{let n=this.options.disabled(this.host),u=this.options.name(this.host),i=this.options.value(this.host),r=this.host.tagName.toLowerCase()==="sl-button";this.host.isConnected&&!n&&!r&&typeof u=="string"&&u.length>0&&typeof i<"u"&&(Array.isArray(i)?i.forEach(c=>{s.formData.append(u,c.toString())}):s.formData.append(u,i.toString()))},this.handleFormSubmit=s=>{var n;let u=this.options.disabled(this.host),i=this.options.reportValidity;this.form&&!this.form.noValidate&&((n=qi.get(this.form))==null||n.forEach(r=>{this.setUserInteracted(r,!0)})),this.form&&!this.form.noValidate&&!u&&!i(this.host)&&(s.preventDefault(),s.stopImmediatePropagation())},this.handleFormReset=()=>{this.options.setValue(this.host,this.options.defaultValue(this.host)),this.setUserInteracted(this.host,!1),Ps.set(this.host,[])},this.handleInteraction=s=>{let n=Ps.get(this.host);n.includes(s.type)||n.push(s.type),n.length===this.options.assumeInteractionOn.length&&this.setUserInteracted(this.host,!0)},this.checkFormValidity=()=>{if(this.form&&!this.form.noValidate){let s=this.form.querySelectorAll("*");for(let n of s)if(typeof n.checkValidity=="function"&&!n.checkValidity())return!1}return!0},this.reportFormValidity=()=>{if(this.form&&!this.form.noValidate){let s=this.form.querySelectorAll("*");for(let n of s)if(typeof n.reportValidity=="function"&&!n.reportValidity())return!1}return!0},(this.host=e).addController(this),this.options=Te({form:s=>{let n=s.form;if(n){let i=s.getRootNode().querySelector(`#${n}`);if(i)return i}return s.closest("form")},name:s=>s.name,value:s=>s.value,defaultValue:s=>s.defaultValue,disabled:s=>{var n;return(n=s.disabled)!=null?n:!1},reportValidity:s=>typeof s.reportValidity=="function"?s.reportValidity():!0,checkValidity:s=>typeof s.checkValidity=="function"?s.checkValidity():!0,setValue:(s,n)=>s.value=n,assumeInteractionOn:["sl-input"]},t)}hostConnected(){let e=this.options.form(this.host);e&&this.attachForm(e),Ps.set(this.host,[]),this.options.assumeInteractionOn.forEach(t=>{this.host.addEventListener(t,this.handleInteraction)})}hostDisconnected(){this.detachForm(),Ps.delete(this.host),this.options.assumeInteractionOn.forEach(e=>{this.host.removeEventListener(e,this.handleInteraction)})}hostUpdated(){let e=this.options.form(this.host);e||this.detachForm(),e&&this.form!==e&&(this.detachForm(),this.attachForm(e)),this.host.hasUpdated&&this.setValidity(this.host.validity.valid)}attachForm(e){e?(this.form=e,qi.has(this.form)?qi.get(this.form).add(this.host):qi.set(this.form,new Set([this.host])),this.form.addEventListener("formdata",this.handleFormData),this.form.addEventListener("submit",this.handleFormSubmit),this.form.addEventListener("reset",this.handleFormReset),Ki.has(this.form)||(Ki.set(this.form,this.form.reportValidity),this.form.reportValidity=()=>this.reportFormValidity()),Gi.has(this.form)||(Gi.set(this.form,this.form.checkValidity),this.form.checkValidity=()=>this.checkFormValidity())):this.form=void 0}detachForm(){if(!this.form)return;let e=qi.get(this.form);e&&(e.delete(this.host),e.size<=0&&(this.form.removeEventListener("formdata",this.handleFormData),this.form.removeEventListener("submit",this.handleFormSubmit),this.form.removeEventListener("reset",this.handleFormReset),Ki.has(this.form)&&(this.form.reportValidity=Ki.get(this.form),Ki.delete(this.form)),Gi.has(this.form)&&(this.form.checkValidity=Gi.get(this.form),Gi.delete(this.form)),this.form=void 0))}setUserInteracted(e,t){t?ro.add(e):ro.delete(e),e.requestUpdate()}doAction(e,t){if(this.form){let s=document.createElement("button");s.type=e,s.style.position="absolute",s.style.width="0",s.style.height="0",s.style.clipPath="inset(50%)",s.style.overflow="hidden",s.style.whiteSpace="nowrap",t&&(s.name=t.name,s.value=t.value,["formaction","formenctype","formmethod","formnovalidate","formtarget"].forEach(n=>{t.hasAttribute(n)&&s.setAttribute(n,t.getAttribute(n))})),this.form.append(s),s.click(),s.remove()}}getForm(){var e;return(e=this.form)!=null?e:null}reset(e){this.doAction("reset",e)}submit(e){this.doAction("submit",e)}setValidity(e){let t=this.host,s=!!ro.has(t),n=!!t.required;t.toggleAttribute("data-required",n),t.toggleAttribute("data-optional",!n),t.toggleAttribute("data-invalid",!e),t.toggleAttribute("data-valid",e),t.toggleAttribute("data-user-invalid",!e&&s),t.toggleAttribute("data-user-valid",e&&s)}updateValidity(){let e=this.host;this.setValidity(e.validity.valid)}emitInvalidEvent(e){let t=new CustomEvent("sl-invalid",{bubbles:!1,composed:!1,cancelable:!0,detail:{}});e||t.preventDefault(),this.host.dispatchEvent(t)||e?.preventDefault()}},$s=Object.freeze({badInput:!1,customError:!1,patternMismatch:!1,rangeOverflow:!1,rangeUnderflow:!1,stepMismatch:!1,tooLong:!1,tooShort:!1,typeMismatch:!1,valid:!0,valueMissing:!1}),av=Object.freeze(ht(Te({},$s),{valid:!1,valueMissing:!0})),lv=Object.freeze(ht(Te({},$s),{valid:!1,customError:!0}));var Ve=class{constructor(e,...t){this.slotNames=[],this.handleSlotChange=s=>{let n=s.target;(this.slotNames.includes("[default]")&&!n.name||n.name&&this.slotNames.includes(n.name))&&this.host.requestUpdate()},(this.host=e).addController(this),this.slotNames=t}hasDefaultSlot(){return[...this.host.childNodes].some(e=>{if(e.nodeType===e.TEXT_NODE&&e.textContent.trim()!=="")return!0;if(e.nodeType===e.ELEMENT_NODE){let t=e;if(t.tagName.toLowerCase()==="sl-visually-hidden")return!1;if(!t.hasAttribute("slot"))return!0}return!1})}hasNamedSlot(e){return this.host.querySelector(`:scope > [slot="${e}"]`)!==null}test(e){return e==="[default]"?this.hasDefaultSlot():this.hasNamedSlot(e)}hostConnected(){this.host.shadowRoot.addEventListener("slotchange",this.handleSlotChange)}hostDisconnected(){this.host.shadowRoot.removeEventListener("slotchange",this.handleSlotChange)}};var ne=class extends Y{constructor(){super(...arguments),this.formControlController=new xt(this,{assumeInteractionOn:["sl-blur","sl-input"]}),this.hasSlotController=new Ve(this,"help-text","label"),this.localize=new fe(this),this.typeToSelectString="",this.hasFocus=!1,this.displayLabel="",this.selectedOptions=[],this.valueHasChanged=!1,this.name="",this._value="",this.defaultValue="",this.size="medium",this.placeholder="",this.multiple=!1,this.maxOptionsVisible=3,this.disabled=!1,this.clearable=!1,this.open=!1,this.hoist=!1,this.filled=!1,this.pill=!1,this.label="",this.placement="bottom",this.helpText="",this.form="",this.required=!1,this.getTag=e=>z`
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
    `,this.handleDocumentFocusIn=e=>{let t=e.composedPath();this&&!t.includes(this)&&this.hide()},this.handleDocumentKeyDown=e=>{let t=e.target,s=t.closest(".select__clear")!==null,n=t.closest("sl-icon-button")!==null;if(!(s||n)){if(e.key==="Escape"&&this.open&&!this.closeWatcher&&(e.preventDefault(),e.stopPropagation(),this.hide(),this.displayInput.focus({preventScroll:!0})),e.key==="Enter"||e.key===" "&&this.typeToSelectString===""){if(e.preventDefault(),e.stopImmediatePropagation(),!this.open){this.show();return}this.currentOption&&!this.currentOption.disabled&&(this.valueHasChanged=!0,this.multiple?this.toggleOptionSelection(this.currentOption):this.setSelectedOptions(this.currentOption),this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}),this.multiple||(this.hide(),this.displayInput.focus({preventScroll:!0})));return}if(["ArrowUp","ArrowDown","Home","End"].includes(e.key)){let u=this.getAllOptions(),i=u.indexOf(this.currentOption),r=Math.max(0,i);if(e.preventDefault(),!this.open&&(this.show(),this.currentOption))return;e.key==="ArrowDown"?(r=i+1,r>u.length-1&&(r=0)):e.key==="ArrowUp"?(r=i-1,r<0&&(r=u.length-1)):e.key==="Home"?r=0:e.key==="End"&&(r=u.length-1),this.setCurrentOption(u[r])}if(e.key&&e.key.length===1||e.key==="Backspace"){let u=this.getAllOptions();if(e.metaKey||e.ctrlKey||e.altKey)return;if(!this.open){if(e.key==="Backspace")return;this.show()}e.stopPropagation(),e.preventDefault(),clearTimeout(this.typeToSelectTimeout),this.typeToSelectTimeout=window.setTimeout(()=>this.typeToSelectString="",1e3),e.key==="Backspace"?this.typeToSelectString=this.typeToSelectString.slice(0,-1):this.typeToSelectString+=e.key.toLowerCase();for(let i of u)if(i.getTextLabel().toLowerCase().startsWith(this.typeToSelectString)){this.setCurrentOption(i);break}}}},this.handleDocumentMouseDown=e=>{let t=e.composedPath();this&&!t.includes(this)&&this.hide()}}get value(){return this._value}set value(e){this.multiple?e=Array.isArray(e)?e:e.split(" "):e=Array.isArray(e)?e.join(" "):e,this._value!==e&&(this.valueHasChanged=!0,this._value=e)}get validity(){return this.valueInput.validity}get validationMessage(){return this.valueInput.validationMessage}connectedCallback(){super.connectedCallback(),setTimeout(()=>{this.handleDefaultSlotChange()}),this.open=!1}addOpenListeners(){var e;document.addEventListener("focusin",this.handleDocumentFocusIn),document.addEventListener("keydown",this.handleDocumentKeyDown),document.addEventListener("mousedown",this.handleDocumentMouseDown),this.getRootNode()!==document&&this.getRootNode().addEventListener("focusin",this.handleDocumentFocusIn),"CloseWatcher"in window&&((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>{this.open&&(this.hide(),this.displayInput.focus({preventScroll:!0}))})}removeOpenListeners(){var e;document.removeEventListener("focusin",this.handleDocumentFocusIn),document.removeEventListener("keydown",this.handleDocumentKeyDown),document.removeEventListener("mousedown",this.handleDocumentMouseDown),this.getRootNode()!==document&&this.getRootNode().removeEventListener("focusin",this.handleDocumentFocusIn),(e=this.closeWatcher)==null||e.destroy()}handleFocus(){this.hasFocus=!0,this.displayInput.setSelectionRange(0,0),this.emit("sl-focus")}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleLabelClick(){this.displayInput.focus()}handleComboboxMouseDown(e){let s=e.composedPath().some(n=>n instanceof Element&&n.tagName.toLowerCase()==="sl-icon-button");this.disabled||s||(e.preventDefault(),this.displayInput.focus({preventScroll:!0}),this.open=!this.open)}handleComboboxKeyDown(e){e.key!=="Tab"&&(e.stopPropagation(),this.handleDocumentKeyDown(e))}handleClearClick(e){e.stopPropagation(),this.valueHasChanged=!0,this.value!==""&&(this.setSelectedOptions([]),this.displayInput.focus({preventScroll:!0}),this.updateComplete.then(()=>{this.emit("sl-clear"),this.emit("sl-input"),this.emit("sl-change")}))}handleClearMouseDown(e){e.stopPropagation(),e.preventDefault()}handleOptionClick(e){let s=e.target.closest("sl-option"),n=this.value;s&&!s.disabled&&(this.valueHasChanged=!0,this.multiple?this.toggleOptionSelection(s):this.setSelectedOptions(s),this.updateComplete.then(()=>this.displayInput.focus({preventScroll:!0})),this.value!==n&&this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}),this.multiple||(this.hide(),this.displayInput.focus({preventScroll:!0})))}handleDefaultSlotChange(){customElements.get("sl-option")||customElements.whenDefined("sl-option").then(()=>this.handleDefaultSlotChange());let e=this.getAllOptions(),t=this.valueHasChanged?this.value:this.defaultValue,s=Array.isArray(t)?t:[t],n=[];e.forEach(u=>n.push(u.value)),this.setSelectedOptions(e.filter(u=>s.includes(u.value)))}handleTagRemove(e,t){e.stopPropagation(),this.valueHasChanged=!0,this.disabled||(this.toggleOptionSelection(t,!1),this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}))}getAllOptions(){return[...this.querySelectorAll("sl-option")]}getFirstOption(){return this.querySelector("sl-option")}setCurrentOption(e){this.getAllOptions().forEach(s=>{s.current=!1,s.tabIndex=-1}),e&&(this.currentOption=e,e.current=!0,e.tabIndex=0,e.focus())}setSelectedOptions(e){let t=this.getAllOptions(),s=Array.isArray(e)?e:[e];t.forEach(n=>n.selected=!1),s.length&&s.forEach(n=>n.selected=!0),this.selectionChanged()}toggleOptionSelection(e,t){t===!0||t===!1?e.selected=t:e.selected=!e.selected,this.selectionChanged()}selectionChanged(){var e,t,s;let n=this.getAllOptions();this.selectedOptions=n.filter(i=>i.selected);let u=this.valueHasChanged;if(this.multiple)this.value=this.selectedOptions.map(i=>i.value),this.placeholder&&this.value.length===0?this.displayLabel="":this.displayLabel=this.localize.term("numOptionsSelected",this.selectedOptions.length);else{let i=this.selectedOptions[0];this.value=(e=i?.value)!=null?e:"",this.displayLabel=(s=(t=i?.getTextLabel)==null?void 0:t.call(i))!=null?s:""}this.valueHasChanged=u,this.updateComplete.then(()=>{this.formControlController.updateValidity()})}get tags(){return this.selectedOptions.map((e,t)=>{if(t<this.maxOptionsVisible||this.maxOptionsVisible<=0){let s=this.getTag(e,t);return z`<div @sl-remove=${n=>this.handleTagRemove(n,e)}>
          ${typeof s=="string"?te(s):s}
        </div>`}else if(t===this.maxOptionsVisible)return z`<sl-tag size=${this.size}>+${this.selectedOptions.length-t}</sl-tag>`;return z``})}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleDisabledChange(){this.disabled&&(this.open=!1,this.handleOpenChange())}attributeChangedCallback(e,t,s){if(super.attributeChangedCallback(e,t,s),e==="value"){let n=this.valueHasChanged;this.value=this.defaultValue,this.valueHasChanged=n}}handleValueChange(){if(!this.valueHasChanged){let s=this.valueHasChanged;this.value=this.defaultValue,this.valueHasChanged=s}let e=this.getAllOptions(),t=Array.isArray(this.value)?this.value:[this.value];this.setSelectedOptions(e.filter(s=>t.includes(s.value)))}async handleOpenChange(){if(this.open&&!this.disabled){this.setCurrentOption(this.selectedOptions[0]||this.getFirstOption()),this.emit("sl-show"),this.addOpenListeners(),await Ae(this),this.listbox.hidden=!1,this.popup.active=!0,requestAnimationFrame(()=>{this.setCurrentOption(this.currentOption)});let{keyframes:e,options:t}=we(this,"select.show",{dir:this.localize.dir()});await Se(this.popup.popup,e,t),this.currentOption&&Fi(this.currentOption,this.listbox,"vertical","auto"),this.emit("sl-after-show")}else{this.emit("sl-hide"),this.removeOpenListeners(),await Ae(this);let{keyframes:e,options:t}=we(this,"select.hide",{dir:this.localize.dir()});await Se(this.popup.popup,e,t),this.listbox.hidden=!0,this.popup.active=!1,this.emit("sl-after-hide")}}async show(){if(this.open||this.disabled){this.open=!1;return}return this.open=!0,Re(this,"sl-after-show")}async hide(){if(!this.open||this.disabled){this.open=!1;return}return this.open=!1,Re(this,"sl-after-hide")}checkValidity(){return this.valueInput.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.valueInput.reportValidity()}setCustomValidity(e){this.valueInput.setCustomValidity(e),this.formControlController.updateValidity()}focus(e){this.displayInput.focus(e)}blur(){this.displayInput.blur()}render(){let e=this.hasSlotController.test("label"),t=this.hasSlotController.test("help-text"),s=this.label?!0:!!e,n=this.helpText?!0:!!t,u=this.clearable&&!this.disabled&&this.value.length>0,i=this.placeholder&&this.value&&this.value.length<=0;return z`
      <div
        part="form-control"
        class=${se({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-label":s,"form-control--has-help-text":n})}
      >
        <label
          id="label"
          part="form-control-label"
          class="form-control__label"
          aria-hidden=${s?"false":"true"}
          @click=${this.handleLabelClick}
        >
          <slot name="label">${this.label}</slot>
        </label>

        <div part="form-control-input" class="form-control-input">
          <sl-popup
            class=${se({select:!0,"select--standard":!0,"select--filled":this.filled,"select--pill":this.pill,"select--open":this.open,"select--disabled":this.disabled,"select--multiple":this.multiple,"select--focused":this.hasFocus,"select--placeholder-visible":i,"select--top":this.placement==="top","select--bottom":this.placement==="bottom","select--small":this.size==="small","select--medium":this.size==="medium","select--large":this.size==="large"})}
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

              ${this.multiple?z`<div part="tags" class="select__tags">${this.tags}</div>`:""}

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

              ${u?z`
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
          aria-hidden=${n?"false":"true"}
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `}};ne.styles=[re,ni,sa];ne.dependencies={"sl-icon":be,"sl-popup":ue,"sl-tag":Ct};T([X(".select")],ne.prototype,"popup",2);T([X(".select__combobox")],ne.prototype,"combobox",2);T([X(".select__display-input")],ne.prototype,"displayInput",2);T([X(".select__value-input")],ne.prototype,"valueInput",2);T([X(".select__listbox")],ne.prototype,"listbox",2);T([pe()],ne.prototype,"hasFocus",2);T([pe()],ne.prototype,"displayLabel",2);T([pe()],ne.prototype,"currentOption",2);T([pe()],ne.prototype,"selectedOptions",2);T([pe()],ne.prototype,"valueHasChanged",2);T([$()],ne.prototype,"name",2);T([pe()],ne.prototype,"value",1);T([$({attribute:"value"})],ne.prototype,"defaultValue",2);T([$({reflect:!0})],ne.prototype,"size",2);T([$()],ne.prototype,"placeholder",2);T([$({type:Boolean,reflect:!0})],ne.prototype,"multiple",2);T([$({attribute:"max-options-visible",type:Number})],ne.prototype,"maxOptionsVisible",2);T([$({type:Boolean,reflect:!0})],ne.prototype,"disabled",2);T([$({type:Boolean})],ne.prototype,"clearable",2);T([$({type:Boolean,reflect:!0})],ne.prototype,"open",2);T([$({type:Boolean})],ne.prototype,"hoist",2);T([$({type:Boolean,reflect:!0})],ne.prototype,"filled",2);T([$({type:Boolean,reflect:!0})],ne.prototype,"pill",2);T([$()],ne.prototype,"label",2);T([$({reflect:!0})],ne.prototype,"placement",2);T([$({attribute:"help-text"})],ne.prototype,"helpText",2);T([$({reflect:!0})],ne.prototype,"form",2);T([$({type:Boolean,reflect:!0})],ne.prototype,"required",2);T([$()],ne.prototype,"getTag",2);T([Z("disabled",{waitUntilFirstUpdate:!0})],ne.prototype,"handleDisabledChange",1);T([Z(["defaultValue","value"],{waitUntilFirstUpdate:!0})],ne.prototype,"handleValueChange",1);T([Z("open",{waitUntilFirstUpdate:!0})],ne.prototype,"handleOpenChange",1);ye("select.show",{keyframes:[{opacity:0,scale:.9},{opacity:1,scale:1}],options:{duration:100,easing:"ease"}});ye("select.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.9}],options:{duration:100,easing:"ease"}});ne.define("sl-select");var Fa=G`
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
`;var Ie=class extends Y{constructor(){super(...arguments),this.localize=new fe(this),this.isInitialized=!1,this.current=!1,this.selected=!1,this.hasHover=!1,this.value="",this.disabled=!1}connectedCallback(){super.connectedCallback(),this.setAttribute("role","option"),this.setAttribute("aria-selected","false")}handleDefaultSlotChange(){this.isInitialized?customElements.whenDefined("sl-select").then(()=>{let e=this.closest("sl-select");e&&e.handleDefaultSlotChange()}):this.isInitialized=!0}handleMouseEnter(){this.hasHover=!0}handleMouseLeave(){this.hasHover=!1}handleDisabledChange(){this.setAttribute("aria-disabled",this.disabled?"true":"false")}handleSelectedChange(){this.setAttribute("aria-selected",this.selected?"true":"false")}handleValueChange(){typeof this.value!="string"&&(this.value=String(this.value)),this.value.includes(" ")&&(console.error("Option values cannot include a space. All spaces have been replaced with underscores.",this),this.value=this.value.replace(/ /g,"_"))}getTextLabel(){let e=this.childNodes,t="";return[...e].forEach(s=>{s.nodeType===Node.ELEMENT_NODE&&(s.hasAttribute("slot")||(t+=s.textContent)),s.nodeType===Node.TEXT_NODE&&(t+=s.textContent)}),t.trim()}render(){return z`
      <div
        part="base"
        class=${se({option:!0,"option--current":this.current,"option--disabled":this.disabled,"option--selected":this.selected,"option--hover":this.hasHover})}
        @mouseenter=${this.handleMouseEnter}
        @mouseleave=${this.handleMouseLeave}
      >
        <sl-icon part="checked-icon" class="option__check" name="check" library="system" aria-hidden="true"></sl-icon>
        <slot part="prefix" name="prefix" class="option__prefix"></slot>
        <slot part="label" class="option__label" @slotchange=${this.handleDefaultSlotChange}></slot>
        <slot part="suffix" name="suffix" class="option__suffix"></slot>
      </div>
    `}};Ie.styles=[re,Fa];Ie.dependencies={"sl-icon":be};T([X(".option__label")],Ie.prototype,"defaultSlot",2);T([pe()],Ie.prototype,"current",2);T([pe()],Ie.prototype,"selected",2);T([pe()],Ie.prototype,"hasHover",2);T([$({reflect:!0})],Ie.prototype,"value",2);T([$({type:Boolean,reflect:!0})],Ie.prototype,"disabled",2);T([Z("disabled")],Ie.prototype,"handleDisabledChange",1);T([Z("selected")],Ie.prototype,"handleSelectedChange",1);T([Z("value")],Ie.prototype,"handleValueChange",1);Ie.define("sl-option");var za=G`
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
`;var Is=(e="value")=>(t,s)=>{let n=t.constructor,u=n.prototype.attributeChangedCallback;n.prototype.attributeChangedCallback=function(i,r,c){var p;let d=n.getPropertyOptions(e),f=typeof d.attribute=="string"?d.attribute:e;if(i===f){let v=d.converter||wt,b=(typeof v=="function"?v:(p=v?.fromAttribute)!=null?p:wt.fromAttribute)(c,d.type);this[e]!==b&&(this[s]=b)}u.call(this,i,r,c)}};var Hs=Xt(class extends mt{constructor(e){if(super(e),e.type!==Ke.PROPERTY&&e.type!==Ke.ATTRIBUTE&&e.type!==Ke.BOOLEAN_ATTRIBUTE)throw Error("The `live` directive is not allowed on child or event bindings");if(!Jn(e))throw Error("`live` bindings can only contain a single expression")}render(e){return e}update(e,[t]){if(t===De||t===ee)return t;let s=e.element,n=e.name;if(e.type===Ke.PROPERTY){if(t===s[n])return De}else if(e.type===Ke.BOOLEAN_ATTRIBUTE){if(!!t===s.hasAttribute(n))return De}else if(e.type===Ke.ATTRIBUTE&&s.getAttribute(n)===t+"")return De;return Zn(e),t}});var Q=class extends Y{constructor(){super(...arguments),this.formControlController=new xt(this,{assumeInteractionOn:["sl-blur","sl-input"]}),this.hasSlotController=new Ve(this,"help-text","label"),this.localize=new fe(this),this.hasFocus=!1,this.title="",this.__numberInput=Object.assign(document.createElement("input"),{type:"number"}),this.__dateInput=Object.assign(document.createElement("input"),{type:"date"}),this.type="text",this.name="",this.value="",this.defaultValue="",this.size="medium",this.filled=!1,this.pill=!1,this.label="",this.helpText="",this.clearable=!1,this.disabled=!1,this.placeholder="",this.readonly=!1,this.passwordToggle=!1,this.passwordVisible=!1,this.noSpinButtons=!1,this.form="",this.required=!1,this.spellcheck=!0}get valueAsDate(){var e;return this.__dateInput.type=this.type,this.__dateInput.value=this.value,((e=this.input)==null?void 0:e.valueAsDate)||this.__dateInput.valueAsDate}set valueAsDate(e){this.__dateInput.type=this.type,this.__dateInput.valueAsDate=e,this.value=this.__dateInput.value}get valueAsNumber(){var e;return this.__numberInput.value=this.value,((e=this.input)==null?void 0:e.valueAsNumber)||this.__numberInput.valueAsNumber}set valueAsNumber(e){this.__numberInput.valueAsNumber=e,this.value=this.__numberInput.value}get validity(){return this.input.validity}get validationMessage(){return this.input.validationMessage}firstUpdated(){this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleChange(){this.value=this.input.value,this.emit("sl-change")}handleClearClick(e){e.preventDefault(),this.value!==""&&(this.value="",this.emit("sl-clear"),this.emit("sl-input"),this.emit("sl-change")),this.input.focus()}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleInput(){this.value=this.input.value,this.formControlController.updateValidity(),this.emit("sl-input")}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleKeyDown(e){let t=e.metaKey||e.ctrlKey||e.shiftKey||e.altKey;e.key==="Enter"&&!t&&setTimeout(()=>{!e.defaultPrevented&&!e.isComposing&&this.formControlController.submit()})}handlePasswordToggle(){this.passwordVisible=!this.passwordVisible}handleDisabledChange(){this.formControlController.setValidity(this.disabled)}handleStepChange(){this.input.step=String(this.step),this.formControlController.updateValidity()}async handleValueChange(){await this.updateComplete,this.formControlController.updateValidity()}focus(e){this.input.focus(e)}blur(){this.input.blur()}select(){this.input.select()}setSelectionRange(e,t,s="none"){this.input.setSelectionRange(e,t,s)}setRangeText(e,t,s,n="preserve"){let u=t??this.input.selectionStart,i=s??this.input.selectionEnd;this.input.setRangeText(e,u,i,n),this.value!==this.input.value&&(this.value=this.input.value)}showPicker(){"showPicker"in HTMLInputElement.prototype&&this.input.showPicker()}stepUp(){this.input.stepUp(),this.value!==this.input.value&&(this.value=this.input.value)}stepDown(){this.input.stepDown(),this.value!==this.input.value&&(this.value=this.input.value)}checkValidity(){return this.input.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.input.reportValidity()}setCustomValidity(e){this.input.setCustomValidity(e),this.formControlController.updateValidity()}render(){let e=this.hasSlotController.test("label"),t=this.hasSlotController.test("help-text"),s=this.label?!0:!!e,n=this.helpText?!0:!!t,i=this.clearable&&!this.disabled&&!this.readonly&&(typeof this.value=="number"||this.value.length>0);return z`
      <div
        part="form-control"
        class=${se({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-label":s,"form-control--has-help-text":n})}
      >
        <label
          part="form-control-label"
          class="form-control__label"
          for="input"
          aria-hidden=${s?"false":"true"}
        >
          <slot name="label">${this.label}</slot>
        </label>

        <div part="form-control-input" class="form-control-input">
          <div
            part="base"
            class=${se({input:!0,"input--small":this.size==="small","input--medium":this.size==="medium","input--large":this.size==="large","input--pill":this.pill,"input--standard":!this.filled,"input--filled":this.filled,"input--disabled":this.disabled,"input--focused":this.hasFocus,"input--empty":!this.value,"input--no-spin-buttons":this.noSpinButtons})}
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
              name=${ie(this.name)}
              ?disabled=${this.disabled}
              ?readonly=${this.readonly}
              ?required=${this.required}
              placeholder=${ie(this.placeholder)}
              minlength=${ie(this.minlength)}
              maxlength=${ie(this.maxlength)}
              min=${ie(this.min)}
              max=${ie(this.max)}
              step=${ie(this.step)}
              .value=${Hs(this.value)}
              autocapitalize=${ie(this.autocapitalize)}
              autocomplete=${ie(this.autocomplete)}
              autocorrect=${ie(this.autocorrect)}
              ?autofocus=${this.autofocus}
              spellcheck=${this.spellcheck}
              pattern=${ie(this.pattern)}
              enterkeyhint=${ie(this.enterkeyhint)}
              inputmode=${ie(this.inputmode)}
              aria-describedby="help-text"
              @change=${this.handleChange}
              @input=${this.handleInput}
              @invalid=${this.handleInvalid}
              @keydown=${this.handleKeyDown}
              @focus=${this.handleFocus}
              @blur=${this.handleBlur}
            />

            ${i?z`
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
            ${this.passwordToggle&&!this.disabled?z`
                  <button
                    part="password-toggle-button"
                    class="input__password-toggle"
                    type="button"
                    aria-label=${this.localize.term(this.passwordVisible?"hidePassword":"showPassword")}
                    @click=${this.handlePasswordToggle}
                    tabindex="-1"
                  >
                    ${this.passwordVisible?z`
                          <slot name="show-password-icon">
                            <sl-icon name="eye-slash" library="system"></sl-icon>
                          </slot>
                        `:z`
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
          aria-hidden=${n?"false":"true"}
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `}};Q.styles=[re,ni,za];Q.dependencies={"sl-icon":be};T([X(".input__control")],Q.prototype,"input",2);T([pe()],Q.prototype,"hasFocus",2);T([$()],Q.prototype,"title",2);T([$({reflect:!0})],Q.prototype,"type",2);T([$()],Q.prototype,"name",2);T([$()],Q.prototype,"value",2);T([Is()],Q.prototype,"defaultValue",2);T([$({reflect:!0})],Q.prototype,"size",2);T([$({type:Boolean,reflect:!0})],Q.prototype,"filled",2);T([$({type:Boolean,reflect:!0})],Q.prototype,"pill",2);T([$()],Q.prototype,"label",2);T([$({attribute:"help-text"})],Q.prototype,"helpText",2);T([$({type:Boolean})],Q.prototype,"clearable",2);T([$({type:Boolean,reflect:!0})],Q.prototype,"disabled",2);T([$()],Q.prototype,"placeholder",2);T([$({type:Boolean,reflect:!0})],Q.prototype,"readonly",2);T([$({attribute:"password-toggle",type:Boolean})],Q.prototype,"passwordToggle",2);T([$({attribute:"password-visible",type:Boolean})],Q.prototype,"passwordVisible",2);T([$({attribute:"no-spin-buttons",type:Boolean})],Q.prototype,"noSpinButtons",2);T([$({reflect:!0})],Q.prototype,"form",2);T([$({type:Boolean,reflect:!0})],Q.prototype,"required",2);T([$()],Q.prototype,"pattern",2);T([$({type:Number})],Q.prototype,"minlength",2);T([$({type:Number})],Q.prototype,"maxlength",2);T([$()],Q.prototype,"min",2);T([$()],Q.prototype,"max",2);T([$()],Q.prototype,"step",2);T([$()],Q.prototype,"autocapitalize",2);T([$()],Q.prototype,"autocorrect",2);T([$()],Q.prototype,"autocomplete",2);T([$({type:Boolean})],Q.prototype,"autofocus",2);T([$()],Q.prototype,"enterkeyhint",2);T([$({type:Boolean,converter:{fromAttribute:e=>!(!e||e==="false"),toAttribute:e=>e?"true":"false"}})],Q.prototype,"spellcheck",2);T([$()],Q.prototype,"inputmode",2);T([Z("disabled",{waitUntilFirstUpdate:!0})],Q.prototype,"handleDisabledChange",1);T([Z("step",{waitUntilFirstUpdate:!0})],Q.prototype,"handleStepChange",1);T([Z("value",{waitUntilFirstUpdate:!0})],Q.prototype,"handleValueChange",1);Q.define("sl-input");var Na=G`
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
`;var oo=class extends Y{constructor(){super(...arguments),this.localize=new fe(this)}render(){return z`
      <svg part="base" class="spinner" role="progressbar" aria-label=${this.localize.term("loading")}>
        <circle class="spinner__track"></circle>
        <circle class="spinner__indicator"></circle>
      </svg>
    `}};oo.styles=[re,Na];var Wa=G`
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
`;var ce=class extends Y{constructor(){super(...arguments),this.formControlController=new xt(this,{assumeInteractionOn:["click"]}),this.hasSlotController=new Ve(this,"[default]","prefix","suffix"),this.localize=new fe(this),this.hasFocus=!1,this.invalid=!1,this.title="",this.variant="default",this.size="medium",this.caret=!1,this.disabled=!1,this.loading=!1,this.outline=!1,this.pill=!1,this.circle=!1,this.type="button",this.name="",this.value="",this.href="",this.rel="noreferrer noopener"}get validity(){return this.isButton()?this.button.validity:$s}get validationMessage(){return this.isButton()?this.button.validationMessage:""}firstUpdated(){this.isButton()&&this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleClick(){this.type==="submit"&&this.formControlController.submit(this),this.type==="reset"&&this.formControlController.reset(this)}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}isButton(){return!this.href}isLink(){return!!this.href}handleDisabledChange(){this.isButton()&&this.formControlController.setValidity(this.disabled)}click(){this.button.click()}focus(e){this.button.focus(e)}blur(){this.button.blur()}checkValidity(){return this.isButton()?this.button.checkValidity():!0}getForm(){return this.formControlController.getForm()}reportValidity(){return this.isButton()?this.button.reportValidity():!0}setCustomValidity(e){this.isButton()&&(this.button.setCustomValidity(e),this.formControlController.updateValidity())}render(){let e=this.isLink(),t=e?ri`a`:ri`button`;return oi`
      <${t}
        part="base"
        class=${se({button:!0,"button--default":this.variant==="default","button--primary":this.variant==="primary","button--success":this.variant==="success","button--neutral":this.variant==="neutral","button--warning":this.variant==="warning","button--danger":this.variant==="danger","button--text":this.variant==="text","button--small":this.size==="small","button--medium":this.size==="medium","button--large":this.size==="large","button--caret":this.caret,"button--circle":this.circle,"button--disabled":this.disabled,"button--focused":this.hasFocus,"button--loading":this.loading,"button--standard":!this.outline,"button--outline":this.outline,"button--pill":this.pill,"button--rtl":this.localize.dir()==="rtl","button--has-label":this.hasSlotController.test("[default]"),"button--has-prefix":this.hasSlotController.test("prefix"),"button--has-suffix":this.hasSlotController.test("suffix")})}
        ?disabled=${ie(e?void 0:this.disabled)}
        type=${ie(e?void 0:this.type)}
        title=${this.title}
        name=${ie(e?void 0:this.name)}
        value=${ie(e?void 0:this.value)}
        href=${ie(e&&!this.disabled?this.href:void 0)}
        target=${ie(e?this.target:void 0)}
        download=${ie(e?this.download:void 0)}
        rel=${ie(e?this.rel:void 0)}
        role=${ie(e?void 0:"button")}
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
        ${this.caret?oi` <sl-icon part="caret" class="button__caret" library="system" name="caret"></sl-icon> `:""}
        ${this.loading?oi`<sl-spinner part="spinner"></sl-spinner>`:""}
      </${t}>
    `}};ce.styles=[re,Wa];ce.dependencies={"sl-icon":be,"sl-spinner":oo};T([X(".button")],ce.prototype,"button",2);T([pe()],ce.prototype,"hasFocus",2);T([pe()],ce.prototype,"invalid",2);T([$()],ce.prototype,"title",2);T([$({reflect:!0})],ce.prototype,"variant",2);T([$({reflect:!0})],ce.prototype,"size",2);T([$({type:Boolean,reflect:!0})],ce.prototype,"caret",2);T([$({type:Boolean,reflect:!0})],ce.prototype,"disabled",2);T([$({type:Boolean,reflect:!0})],ce.prototype,"loading",2);T([$({type:Boolean,reflect:!0})],ce.prototype,"outline",2);T([$({type:Boolean,reflect:!0})],ce.prototype,"pill",2);T([$({type:Boolean,reflect:!0})],ce.prototype,"circle",2);T([$()],ce.prototype,"type",2);T([$()],ce.prototype,"name",2);T([$()],ce.prototype,"value",2);T([$()],ce.prototype,"href",2);T([$()],ce.prototype,"target",2);T([$()],ce.prototype,"rel",2);T([$()],ce.prototype,"download",2);T([$()],ce.prototype,"form",2);T([$({attribute:"formaction"})],ce.prototype,"formAction",2);T([$({attribute:"formenctype"})],ce.prototype,"formEnctype",2);T([$({attribute:"formmethod"})],ce.prototype,"formMethod",2);T([$({attribute:"formnovalidate",type:Boolean})],ce.prototype,"formNoValidate",2);T([$({attribute:"formtarget"})],ce.prototype,"formTarget",2);T([Z("disabled",{waitUntilFirstUpdate:!0})],ce.prototype,"handleDisabledChange",1);ce.define("sl-button");var Ua=G`
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
`;var di=class extends Y{constructor(){super(...arguments),this.variant="primary",this.pill=!1,this.pulse=!1}render(){return z`
      <span
        part="base"
        class=${se({badge:!0,"badge--primary":this.variant==="primary","badge--success":this.variant==="success","badge--neutral":this.variant==="neutral","badge--warning":this.variant==="warning","badge--danger":this.variant==="danger","badge--pill":this.pill,"badge--pulse":this.pulse})}
        role="status"
      >
        <slot></slot>
      </span>
    `}};di.styles=[re,Ua];T([$({reflect:!0})],di.prototype,"variant",2);T([$({type:Boolean,reflect:!0})],di.prototype,"pill",2);T([$({type:Boolean,reflect:!0})],di.prototype,"pulse",2);di.define("sl-badge");var ja=G`
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
`;var Ce=class extends Y{constructor(){super(),this.localize=new fe(this),this.content="",this.placement="top",this.disabled=!1,this.distance=8,this.open=!1,this.skidding=0,this.trigger="hover focus",this.hoist=!1,this.handleBlur=()=>{this.hasTrigger("focus")&&this.hide()},this.handleClick=()=>{this.hasTrigger("click")&&(this.open?this.hide():this.show())},this.handleFocus=()=>{this.hasTrigger("focus")&&this.show()},this.handleDocumentKeyDown=e=>{e.key==="Escape"&&(e.stopPropagation(),this.hide())},this.handleMouseOver=()=>{if(this.hasTrigger("hover")){let e=Ir(getComputedStyle(this).getPropertyValue("--show-delay"));clearTimeout(this.hoverTimeout),this.hoverTimeout=window.setTimeout(()=>this.show(),e)}},this.handleMouseOut=()=>{if(this.hasTrigger("hover")){let e=Ir(getComputedStyle(this).getPropertyValue("--hide-delay"));clearTimeout(this.hoverTimeout),this.hoverTimeout=window.setTimeout(()=>this.hide(),e)}},this.addEventListener("blur",this.handleBlur,!0),this.addEventListener("focus",this.handleFocus,!0),this.addEventListener("click",this.handleClick),this.addEventListener("mouseover",this.handleMouseOver),this.addEventListener("mouseout",this.handleMouseOut)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this.closeWatcher)==null||e.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown)}firstUpdated(){this.body.hidden=!this.open,this.open&&(this.popup.active=!0,this.popup.reposition())}hasTrigger(e){return this.trigger.split(" ").includes(e)}async handleOpenChange(){var e,t;if(this.open){if(this.disabled)return;this.emit("sl-show"),"CloseWatcher"in window?((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>{this.hide()}):document.addEventListener("keydown",this.handleDocumentKeyDown),await Ae(this.body),this.body.hidden=!1,this.popup.active=!0;let{keyframes:s,options:n}=we(this,"tooltip.show",{dir:this.localize.dir()});await Se(this.popup.popup,s,n),this.popup.reposition(),this.emit("sl-after-show")}else{this.emit("sl-hide"),(t=this.closeWatcher)==null||t.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown),await Ae(this.body);let{keyframes:s,options:n}=we(this,"tooltip.hide",{dir:this.localize.dir()});await Se(this.popup.popup,s,n),this.popup.active=!1,this.body.hidden=!0,this.emit("sl-after-hide")}}async handleOptionsChange(){this.hasUpdated&&(await this.updateComplete,this.popup.reposition())}handleDisabledChange(){this.disabled&&this.open&&this.hide()}async show(){if(!this.open)return this.open=!0,Re(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,Re(this,"sl-after-hide")}render(){return z`
      <sl-popup
        part="base"
        exportparts="
          popup:base__popup,
          arrow:base__arrow
        "
        class=${se({tooltip:!0,"tooltip--open":this.open})}
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
    `}};Ce.styles=[re,ja];Ce.dependencies={"sl-popup":ue};T([X("slot:not([name])")],Ce.prototype,"defaultSlot",2);T([X(".tooltip__body")],Ce.prototype,"body",2);T([X("sl-popup")],Ce.prototype,"popup",2);T([$()],Ce.prototype,"content",2);T([$()],Ce.prototype,"placement",2);T([$({type:Boolean,reflect:!0})],Ce.prototype,"disabled",2);T([$({type:Number})],Ce.prototype,"distance",2);T([$({type:Boolean,reflect:!0})],Ce.prototype,"open",2);T([$({type:Number})],Ce.prototype,"skidding",2);T([$()],Ce.prototype,"trigger",2);T([$({type:Boolean})],Ce.prototype,"hoist",2);T([Z("open",{waitUntilFirstUpdate:!0})],Ce.prototype,"handleOpenChange",1);T([Z(["content","distance","hoist","placement","skidding"])],Ce.prototype,"handleOptionsChange",1);T([Z("disabled")],Ce.prototype,"handleDisabledChange",1);ye("tooltip.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:150,easing:"ease"}});ye("tooltip.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:150,easing:"ease"}});Ce.define("sl-tooltip");function*Fs(e=document.activeElement){e!=null&&(yield e,"shadowRoot"in e&&e.shadowRoot&&e.shadowRoot.mode!=="closed"&&(yield*Mn(Fs(e.shadowRoot.activeElement))))}function qa(){return[...Fs()].pop()}var Va=new WeakMap;function Ka(e){let t=Va.get(e);return t||(t=window.getComputedStyle(e,null),Va.set(e,t)),t}function Fh(e){if(typeof e.checkVisibility=="function")return e.checkVisibility({checkOpacity:!1,checkVisibilityCSS:!0});let t=Ka(e);return t.visibility!=="hidden"&&t.display!=="none"}function zh(e){let t=Ka(e),{overflowY:s,overflowX:n}=t;return s==="scroll"||n==="scroll"?!0:s!=="auto"||n!=="auto"?!1:e.scrollHeight>e.clientHeight&&s==="auto"||e.scrollWidth>e.clientWidth&&n==="auto"}function Nh(e){let t=e.tagName.toLowerCase(),s=Number(e.getAttribute("tabindex"));if(e.hasAttribute("tabindex")&&(isNaN(s)||s<=-1)||e.hasAttribute("disabled")||e.closest("[inert]"))return!1;if(t==="input"&&e.getAttribute("type")==="radio"){let i=e.getRootNode(),r=`input[type='radio'][name="${e.getAttribute("name")}"]`,c=i.querySelector(`${r}:checked`);return c?c===e:i.querySelector(r)===e}return Fh(e)?(t==="audio"||t==="video")&&e.hasAttribute("controls")||e.hasAttribute("tabindex")||e.hasAttribute("contenteditable")&&e.getAttribute("contenteditable")!=="false"||["button","input","select","textarea","a","audio","video","summary","iframe"].includes(t)?!0:zh(e):!1}function Wh(e,t){var s;return((s=e.getRootNode({composed:!0}))==null?void 0:s.host)!==t}function no(e){let t=new WeakMap,s=[];function n(u){if(u instanceof Element){if(u.hasAttribute("inert")||u.closest("[inert]")||t.has(u))return;t.set(u,!0),!s.includes(u)&&Nh(u)&&s.push(u),u instanceof HTMLSlotElement&&Wh(u,e)&&u.assignedElements({flatten:!0}).forEach(i=>{n(i)}),u.shadowRoot!==null&&u.shadowRoot.mode==="open"&&n(u.shadowRoot)}for(let i of u.children)n(i)}return n(e),s.sort((u,i)=>{let r=Number(u.getAttribute("tabindex"))||0;return(Number(i.getAttribute("tabindex"))||0)-r})}var Xi=[],Ga=class{constructor(e){this.tabDirection="forward",this.handleFocusIn=()=>{this.isActive()&&this.checkFocus()},this.handleKeyDown=t=>{var s;if(t.key!=="Tab"||this.isExternalActivated||!this.isActive())return;let n=qa();if(this.previousFocus=n,this.previousFocus&&this.possiblyHasTabbableChildren(this.previousFocus))return;t.shiftKey?this.tabDirection="backward":this.tabDirection="forward";let u=no(this.element),i=u.findIndex(c=>c===n);this.previousFocus=this.currentFocus;let r=this.tabDirection==="forward"?1:-1;for(;;){i+r>=u.length?i=0:i+r<0?i=u.length-1:i+=r,this.previousFocus=this.currentFocus;let c=u[i];if(this.tabDirection==="backward"&&this.previousFocus&&this.possiblyHasTabbableChildren(this.previousFocus)||c&&this.possiblyHasTabbableChildren(c))return;t.preventDefault(),this.currentFocus=c,(s=this.currentFocus)==null||s.focus({preventScroll:!1});let p=[...Fs()];if(p.includes(this.currentFocus)||!p.includes(this.previousFocus))break}setTimeout(()=>this.checkFocus())},this.handleKeyUp=()=>{this.tabDirection="forward"},this.element=e,this.elementsWithTabbableControls=["iframe"]}activate(){Xi.push(this.element),document.addEventListener("focusin",this.handleFocusIn),document.addEventListener("keydown",this.handleKeyDown),document.addEventListener("keyup",this.handleKeyUp)}deactivate(){Xi=Xi.filter(e=>e!==this.element),this.currentFocus=null,document.removeEventListener("focusin",this.handleFocusIn),document.removeEventListener("keydown",this.handleKeyDown),document.removeEventListener("keyup",this.handleKeyUp)}isActive(){return Xi[Xi.length-1]===this.element}activateExternal(){this.isExternalActivated=!0}deactivateExternal(){this.isExternalActivated=!1}checkFocus(){if(this.isActive()&&!this.isExternalActivated){let e=no(this.element);if(!this.element.matches(":focus-within")){let t=e[0],s=e[e.length-1],n=this.tabDirection==="forward"?t:s;typeof n?.focus=="function"&&(this.currentFocus=n,n.focus({preventScroll:!1}))}}}possiblyHasTabbableChildren(e){return this.elementsWithTabbableControls.includes(e.tagName.toLowerCase())||e.hasAttribute("controls")}};var Xa=G`
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
`;var zs=e=>{var t;let{activeElement:s}=document;s&&e.contains(s)&&((t=document.activeElement)==null||t.blur())};var Je=class extends Y{constructor(){super(...arguments),this.hasSlotController=new Ve(this,"footer"),this.localize=new fe(this),this.modal=new Ga(this),this.open=!1,this.label="",this.noHeader=!1,this.handleDocumentKeyDown=e=>{e.key==="Escape"&&this.modal.isActive()&&this.open&&(e.stopPropagation(),this.requestClose("keyboard"))}}firstUpdated(){this.dialog.hidden=!this.open,this.open&&(this.addOpenListeners(),this.modal.activate(),Xr(this))}disconnectedCallback(){super.disconnectedCallback(),this.modal.deactivate(),Yr(this),this.removeOpenListeners()}requestClose(e){if(this.emit("sl-request-close",{cancelable:!0,detail:{source:e}}).defaultPrevented){let s=we(this,"dialog.denyClose",{dir:this.localize.dir()});Se(this.panel,s.keyframes,s.options);return}this.hide()}addOpenListeners(){var e;"CloseWatcher"in window?((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>this.requestClose("keyboard")):document.addEventListener("keydown",this.handleDocumentKeyDown)}removeOpenListeners(){var e;(e=this.closeWatcher)==null||e.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown)}async handleOpenChange(){if(this.open){this.emit("sl-show"),this.addOpenListeners(),this.originalTrigger=document.activeElement,this.modal.activate(),Xr(this);let e=this.querySelector("[autofocus]");e&&e.removeAttribute("autofocus"),await Promise.all([Ae(this.dialog),Ae(this.overlay)]),this.dialog.hidden=!1,requestAnimationFrame(()=>{this.emit("sl-initial-focus",{cancelable:!0}).defaultPrevented||(e?e.focus({preventScroll:!0}):this.panel.focus({preventScroll:!0})),e&&e.setAttribute("autofocus","")});let t=we(this,"dialog.show",{dir:this.localize.dir()}),s=we(this,"dialog.overlay.show",{dir:this.localize.dir()});await Promise.all([Se(this.panel,t.keyframes,t.options),Se(this.overlay,s.keyframes,s.options)]),this.emit("sl-after-show")}else{zs(this),this.emit("sl-hide"),this.removeOpenListeners(),this.modal.deactivate(),await Promise.all([Ae(this.dialog),Ae(this.overlay)]);let e=we(this,"dialog.hide",{dir:this.localize.dir()}),t=we(this,"dialog.overlay.hide",{dir:this.localize.dir()});await Promise.all([Se(this.overlay,t.keyframes,t.options).then(()=>{this.overlay.hidden=!0}),Se(this.panel,e.keyframes,e.options).then(()=>{this.panel.hidden=!0})]),this.dialog.hidden=!0,this.overlay.hidden=!1,this.panel.hidden=!1,Yr(this);let s=this.originalTrigger;typeof s?.focus=="function"&&setTimeout(()=>s.focus()),this.emit("sl-after-hide")}}async show(){if(!this.open)return this.open=!0,Re(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,Re(this,"sl-after-hide")}render(){return z`
      <div
        part="base"
        class=${se({dialog:!0,"dialog--open":this.open,"dialog--has-footer":this.hasSlotController.test("footer")})}
      >
        <div part="overlay" class="dialog__overlay" @click=${()=>this.requestClose("overlay")} tabindex="-1"></div>

        <div
          part="panel"
          class="dialog__panel"
          role="dialog"
          aria-modal="true"
          aria-hidden=${this.open?"false":"true"}
          aria-label=${ie(this.noHeader?this.label:void 0)}
          aria-labelledby=${ie(this.noHeader?void 0:"title")}
          tabindex="-1"
        >
          ${this.noHeader?"":z`
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
    `}};Je.styles=[re,Xa];Je.dependencies={"sl-icon-button":ge};T([X(".dialog")],Je.prototype,"dialog",2);T([X(".dialog__panel")],Je.prototype,"panel",2);T([X(".dialog__overlay")],Je.prototype,"overlay",2);T([$({type:Boolean,reflect:!0})],Je.prototype,"open",2);T([$({reflect:!0})],Je.prototype,"label",2);T([$({attribute:"no-header",type:Boolean,reflect:!0})],Je.prototype,"noHeader",2);T([Z("open",{waitUntilFirstUpdate:!0})],Je.prototype,"handleOpenChange",1);ye("dialog.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:250,easing:"ease"}});ye("dialog.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:250,easing:"ease"}});ye("dialog.denyClose",{keyframes:[{scale:1},{scale:1.02},{scale:1}],options:{duration:250}});ye("dialog.overlay.show",{keyframes:[{opacity:0},{opacity:1}],options:{duration:250}});ye("dialog.overlay.hide",{keyframes:[{opacity:1},{opacity:0}],options:{duration:250}});Je.define("sl-dialog");var Ya=G`
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
`;var Ja=G`
  :host {
    display: contents;
  }
`;var Yi=class extends Y{constructor(){super(...arguments),this.observedElements=[],this.disabled=!1}connectedCallback(){super.connectedCallback(),this.resizeObserver=new ResizeObserver(e=>{this.emit("sl-resize",{detail:{entries:e}})}),this.disabled||this.startObserver()}disconnectedCallback(){super.disconnectedCallback(),this.stopObserver()}handleSlotChange(){this.disabled||this.startObserver()}startObserver(){let e=this.shadowRoot.querySelector("slot");if(e!==null){let t=e.assignedElements({flatten:!0});this.observedElements.forEach(s=>this.resizeObserver.unobserve(s)),this.observedElements=[],t.forEach(s=>{this.resizeObserver.observe(s),this.observedElements.push(s)})}}stopObserver(){this.resizeObserver.disconnect()}handleDisabledChange(){this.disabled?this.stopObserver():this.startObserver()}render(){return z` <slot @slotchange=${this.handleSlotChange}></slot> `}};Yi.styles=[re,Ja];T([$({type:Boolean,reflect:!0})],Yi.prototype,"disabled",2);T([Z("disabled",{waitUntilFirstUpdate:!0})],Yi.prototype,"handleDisabledChange",1);var xe=class extends Y{constructor(){super(...arguments),this.tabs=[],this.focusableTabs=[],this.panels=[],this.localize=new fe(this),this.hasScrollControls=!1,this.shouldHideScrollStartButton=!1,this.shouldHideScrollEndButton=!1,this.placement="top",this.activation="auto",this.noScrollControls=!1,this.fixedScrollControls=!1,this.scrollOffset=1}connectedCallback(){let e=Promise.all([customElements.whenDefined("sl-tab"),customElements.whenDefined("sl-tab-panel")]);super.connectedCallback(),this.resizeObserver=new ResizeObserver(()=>{this.repositionIndicator(),this.updateScrollControls()}),this.mutationObserver=new MutationObserver(t=>{let s=t.filter(({target:n})=>{if(n===this)return!0;if(n.closest("sl-tab-group")!==this)return!1;let u=n.tagName.toLowerCase();return u==="sl-tab"||u==="sl-tab-panel"});if(s.length!==0){if(s.some(n=>!["aria-labelledby","aria-controls"].includes(n.attributeName))&&setTimeout(()=>this.setAriaLabels()),s.some(n=>n.attributeName==="disabled"))this.syncTabsAndPanels();else if(s.some(n=>n.attributeName==="active")){let u=s.filter(i=>i.attributeName==="active"&&i.target.tagName.toLowerCase()==="sl-tab").map(i=>i.target).find(i=>i.active);u&&this.setActiveTab(u)}}}),this.updateComplete.then(()=>{this.syncTabsAndPanels(),this.mutationObserver.observe(this,{attributes:!0,attributeFilter:["active","disabled","name","panel"],childList:!0,subtree:!0}),this.resizeObserver.observe(this.nav),e.then(()=>{new IntersectionObserver((s,n)=>{var u;s[0].intersectionRatio>0&&(this.setAriaLabels(),this.setActiveTab((u=this.getActiveTab())!=null?u:this.tabs[0],{emitEvents:!1}),n.unobserve(s[0].target))}).observe(this.tabGroup)})})}disconnectedCallback(){var e,t;super.disconnectedCallback(),(e=this.mutationObserver)==null||e.disconnect(),this.nav&&((t=this.resizeObserver)==null||t.unobserve(this.nav))}getAllTabs(){return this.shadowRoot.querySelector('slot[name="nav"]').assignedElements()}getAllPanels(){return[...this.body.assignedElements()].filter(e=>e.tagName.toLowerCase()==="sl-tab-panel")}getActiveTab(){return this.tabs.find(e=>e.active)}handleClick(e){let s=e.target.closest("sl-tab");s?.closest("sl-tab-group")===this&&s!==null&&this.setActiveTab(s,{scrollBehavior:"smooth"})}handleKeyDown(e){let s=e.target.closest("sl-tab");if(s?.closest("sl-tab-group")===this&&(["Enter"," "].includes(e.key)&&s!==null&&(this.setActiveTab(s,{scrollBehavior:"smooth"}),e.preventDefault()),["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key))){let u=this.tabs.find(c=>c.matches(":focus")),i=this.localize.dir()==="rtl",r=null;if(u?.tagName.toLowerCase()==="sl-tab"){if(e.key==="Home")r=this.focusableTabs[0];else if(e.key==="End")r=this.focusableTabs[this.focusableTabs.length-1];else if(["top","bottom"].includes(this.placement)&&e.key===(i?"ArrowRight":"ArrowLeft")||["start","end"].includes(this.placement)&&e.key==="ArrowUp"){let c=this.tabs.findIndex(p=>p===u);r=this.findNextFocusableTab(c,"backward")}else if(["top","bottom"].includes(this.placement)&&e.key===(i?"ArrowLeft":"ArrowRight")||["start","end"].includes(this.placement)&&e.key==="ArrowDown"){let c=this.tabs.findIndex(p=>p===u);r=this.findNextFocusableTab(c,"forward")}if(!r)return;r.tabIndex=0,r.focus({preventScroll:!0}),this.activation==="auto"?this.setActiveTab(r,{scrollBehavior:"smooth"}):this.tabs.forEach(c=>{c.tabIndex=c===r?0:-1}),["top","bottom"].includes(this.placement)&&Fi(r,this.nav,"horizontal"),e.preventDefault()}}}handleScrollToStart(){this.nav.scroll({left:this.localize.dir()==="rtl"?this.nav.scrollLeft+this.nav.clientWidth:this.nav.scrollLeft-this.nav.clientWidth,behavior:"smooth"})}handleScrollToEnd(){this.nav.scroll({left:this.localize.dir()==="rtl"?this.nav.scrollLeft-this.nav.clientWidth:this.nav.scrollLeft+this.nav.clientWidth,behavior:"smooth"})}setActiveTab(e,t){if(t=Te({emitEvents:!0,scrollBehavior:"auto"},t),e!==this.activeTab&&!e.disabled){let s=this.activeTab;this.activeTab=e,this.tabs.forEach(n=>{n.active=n===this.activeTab,n.tabIndex=n===this.activeTab?0:-1}),this.panels.forEach(n=>{var u;return n.active=n.name===((u=this.activeTab)==null?void 0:u.panel)}),this.syncIndicator(),["top","bottom"].includes(this.placement)&&Fi(this.activeTab,this.nav,"horizontal",t.scrollBehavior),t.emitEvents&&(s&&this.emit("sl-tab-hide",{detail:{name:s.panel}}),this.emit("sl-tab-show",{detail:{name:this.activeTab.panel}}))}}setAriaLabels(){this.tabs.forEach(e=>{let t=this.panels.find(s=>s.name===e.panel);t&&(e.setAttribute("aria-controls",t.getAttribute("id")),t.setAttribute("aria-labelledby",e.getAttribute("id")))})}repositionIndicator(){let e=this.getActiveTab();if(!e)return;let t=e.clientWidth,s=e.clientHeight,n=this.localize.dir()==="rtl",u=this.getAllTabs(),r=u.slice(0,u.indexOf(e)).reduce((c,p)=>({left:c.left+p.clientWidth,top:c.top+p.clientHeight}),{left:0,top:0});switch(this.placement){case"top":case"bottom":this.indicator.style.width=`${t}px`,this.indicator.style.height="auto",this.indicator.style.translate=n?`${-1*r.left}px`:`${r.left}px`;break;case"start":case"end":this.indicator.style.width="auto",this.indicator.style.height=`${s}px`,this.indicator.style.translate=`0 ${r.top}px`;break}}syncTabsAndPanels(){this.tabs=this.getAllTabs(),this.focusableTabs=this.tabs.filter(e=>!e.disabled),this.panels=this.getAllPanels(),this.syncIndicator(),this.updateComplete.then(()=>this.updateScrollControls())}findNextFocusableTab(e,t){let s=null,n=t==="forward"?1:-1,u=e+n;for(;e<this.tabs.length;){if(s=this.tabs[u]||null,s===null){t==="forward"?s=this.focusableTabs[0]:s=this.focusableTabs[this.focusableTabs.length-1];break}if(!s.disabled)break;u+=n}return s}updateScrollButtons(){this.hasScrollControls&&!this.fixedScrollControls&&(this.shouldHideScrollStartButton=this.scrollFromStart()<=this.scrollOffset,this.shouldHideScrollEndButton=this.isScrolledToEnd())}isScrolledToEnd(){return this.scrollFromStart()+this.nav.clientWidth>=this.nav.scrollWidth-this.scrollOffset}scrollFromStart(){return this.localize.dir()==="rtl"?-this.nav.scrollLeft:this.nav.scrollLeft}updateScrollControls(){this.noScrollControls?this.hasScrollControls=!1:this.hasScrollControls=["top","bottom"].includes(this.placement)&&this.nav.scrollWidth>this.nav.clientWidth+1,this.updateScrollButtons()}syncIndicator(){this.getActiveTab()?(this.indicator.style.display="block",this.repositionIndicator()):this.indicator.style.display="none"}show(e){let t=this.tabs.find(s=>s.panel===e);t&&this.setActiveTab(t,{scrollBehavior:"smooth"})}render(){let e=this.localize.dir()==="rtl";return z`
      <div
        part="base"
        class=${se({"tab-group":!0,"tab-group--top":this.placement==="top","tab-group--bottom":this.placement==="bottom","tab-group--start":this.placement==="start","tab-group--end":this.placement==="end","tab-group--rtl":this.localize.dir()==="rtl","tab-group--has-scroll-controls":this.hasScrollControls})}
        @click=${this.handleClick}
        @keydown=${this.handleKeyDown}
      >
        <div class="tab-group__nav-container" part="nav">
          ${this.hasScrollControls?z`
                <sl-icon-button
                  part="scroll-button scroll-button--start"
                  exportparts="base:scroll-button__base"
                  class=${se({"tab-group__scroll-button":!0,"tab-group__scroll-button--start":!0,"tab-group__scroll-button--start--hidden":this.shouldHideScrollStartButton})}
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

          ${this.hasScrollControls?z`
                <sl-icon-button
                  part="scroll-button scroll-button--end"
                  exportparts="base:scroll-button__base"
                  class=${se({"tab-group__scroll-button":!0,"tab-group__scroll-button--end":!0,"tab-group__scroll-button--end--hidden":this.shouldHideScrollEndButton})}
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
    `}};xe.styles=[re,Ya];xe.dependencies={"sl-icon-button":ge,"sl-resize-observer":Yi};T([X(".tab-group")],xe.prototype,"tabGroup",2);T([X(".tab-group__body")],xe.prototype,"body",2);T([X(".tab-group__nav")],xe.prototype,"nav",2);T([X(".tab-group__indicator")],xe.prototype,"indicator",2);T([pe()],xe.prototype,"hasScrollControls",2);T([pe()],xe.prototype,"shouldHideScrollStartButton",2);T([pe()],xe.prototype,"shouldHideScrollEndButton",2);T([$()],xe.prototype,"placement",2);T([$()],xe.prototype,"activation",2);T([$({attribute:"no-scroll-controls",type:Boolean})],xe.prototype,"noScrollControls",2);T([$({attribute:"fixed-scroll-controls",type:Boolean})],xe.prototype,"fixedScrollControls",2);T([Xn({passive:!0})],xe.prototype,"updateScrollButtons",1);T([Z("noScrollControls",{waitUntilFirstUpdate:!0})],xe.prototype,"updateScrollControls",1);T([Z("placement",{waitUntilFirstUpdate:!0})],xe.prototype,"syncIndicator",1);xe.define("sl-tab-group");var Uh=(e,t)=>{let s=0;return function(...n){window.clearTimeout(s),s=window.setTimeout(()=>{e.call(this,...n)},t)}},Za=(e,t,s)=>{let n=e[t];e[t]=function(...u){n.call(this,...u),s.call(this,n,...u)}};(()=>{if(typeof window>"u")return;if(!("onscrollend"in window)){let t=new Set,s=new WeakMap,n=i=>{for(let r of i.changedTouches)t.add(r.identifier)},u=i=>{for(let r of i.changedTouches)t.delete(r.identifier)};document.addEventListener("touchstart",n,!0),document.addEventListener("touchend",u,!0),document.addEventListener("touchcancel",u,!0),Za(EventTarget.prototype,"addEventListener",function(i,r){if(r!=="scrollend")return;let c=Uh(()=>{t.size?c():this.dispatchEvent(new Event("scrollend"))},100);i.call(this,"scroll",c,{passive:!0}),s.set(this,c)}),Za(EventTarget.prototype,"removeEventListener",function(i,r){if(r!=="scrollend")return;let c=s.get(this);c&&i.call(this,"scroll",c,{passive:!0})})}})();var Qa=G`
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
`;var jh=0,qe=class extends Y{constructor(){super(...arguments),this.localize=new fe(this),this.attrId=++jh,this.componentId=`sl-tab-${this.attrId}`,this.panel="",this.active=!1,this.closable=!1,this.disabled=!1,this.tabIndex=0}connectedCallback(){super.connectedCallback(),this.setAttribute("role","tab")}handleCloseClick(e){e.stopPropagation(),this.emit("sl-close")}handleActiveChange(){this.setAttribute("aria-selected",this.active?"true":"false")}handleDisabledChange(){this.setAttribute("aria-disabled",this.disabled?"true":"false"),this.disabled&&!this.active?this.tabIndex=-1:this.tabIndex=0}render(){return this.id=this.id.length>0?this.id:this.componentId,z`
      <div
        part="base"
        class=${se({tab:!0,"tab--active":this.active,"tab--closable":this.closable,"tab--disabled":this.disabled})}
      >
        <slot></slot>
        ${this.closable?z`
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
    `}};qe.styles=[re,Qa];qe.dependencies={"sl-icon-button":ge};T([X(".tab")],qe.prototype,"tab",2);T([$({reflect:!0})],qe.prototype,"panel",2);T([$({type:Boolean,reflect:!0})],qe.prototype,"active",2);T([$({type:Boolean,reflect:!0})],qe.prototype,"closable",2);T([$({type:Boolean,reflect:!0})],qe.prototype,"disabled",2);T([$({type:Number,reflect:!0})],qe.prototype,"tabIndex",2);T([Z("active")],qe.prototype,"handleActiveChange",1);T([Z("disabled")],qe.prototype,"handleDisabledChange",1);qe.define("sl-tab");var el=G`
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
`;var Vh=0,ui=class extends Y{constructor(){super(...arguments),this.attrId=++Vh,this.componentId=`sl-tab-panel-${this.attrId}`,this.name="",this.active=!1}connectedCallback(){super.connectedCallback(),this.id=this.id.length>0?this.id:this.componentId,this.setAttribute("role","tabpanel")}handleActiveChange(){this.setAttribute("aria-hidden",this.active?"false":"true")}render(){return z`
      <slot
        part="base"
        class=${se({"tab-panel":!0,"tab-panel--active":this.active})}
      ></slot>
    `}};ui.styles=[re,el];T([$({reflect:!0})],ui.prototype,"name",2);T([$({type:Boolean,reflect:!0})],ui.prototype,"active",2);T([Z("active")],ui.prototype,"handleActiveChange",1);ui.define("sl-tab-panel");var tl=G`
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
`;var Le=class extends Y{constructor(){super(...arguments),this.formControlController=new xt(this,{value:e=>e.checked?e.value||"on":void 0,defaultValue:e=>e.defaultChecked,setValue:(e,t)=>e.checked=t}),this.hasSlotController=new Ve(this,"help-text"),this.hasFocus=!1,this.title="",this.name="",this.size="medium",this.disabled=!1,this.checked=!1,this.defaultChecked=!1,this.form="",this.required=!1,this.helpText=""}get validity(){return this.input.validity}get validationMessage(){return this.input.validationMessage}firstUpdated(){this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleInput(){this.emit("sl-input")}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleClick(){this.checked=!this.checked,this.emit("sl-change")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleKeyDown(e){e.key==="ArrowLeft"&&(e.preventDefault(),this.checked=!1,this.emit("sl-change"),this.emit("sl-input")),e.key==="ArrowRight"&&(e.preventDefault(),this.checked=!0,this.emit("sl-change"),this.emit("sl-input"))}handleCheckedChange(){this.input.checked=this.checked,this.formControlController.updateValidity()}handleDisabledChange(){this.formControlController.setValidity(!0)}click(){this.input.click()}focus(e){this.input.focus(e)}blur(){this.input.blur()}checkValidity(){return this.input.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.input.reportValidity()}setCustomValidity(e){this.input.setCustomValidity(e),this.formControlController.updateValidity()}render(){let e=this.hasSlotController.test("help-text"),t=this.helpText?!0:!!e;return z`
      <div
        class=${se({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-help-text":t})}
      >
        <label
          part="base"
          class=${se({switch:!0,"switch--checked":this.checked,"switch--disabled":this.disabled,"switch--focused":this.hasFocus,"switch--small":this.size==="small","switch--medium":this.size==="medium","switch--large":this.size==="large"})}
        >
          <input
            class="switch__input"
            type="checkbox"
            title=${this.title}
            name=${this.name}
            value=${ie(this.value)}
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
    `}};Le.styles=[re,ni,tl];T([X('input[type="checkbox"]')],Le.prototype,"input",2);T([pe()],Le.prototype,"hasFocus",2);T([$()],Le.prototype,"title",2);T([$()],Le.prototype,"name",2);T([$()],Le.prototype,"value",2);T([$({reflect:!0})],Le.prototype,"size",2);T([$({type:Boolean,reflect:!0})],Le.prototype,"disabled",2);T([$({type:Boolean,reflect:!0})],Le.prototype,"checked",2);T([Is("checked")],Le.prototype,"defaultChecked",2);T([$({reflect:!0})],Le.prototype,"form",2);T([$({type:Boolean,reflect:!0})],Le.prototype,"required",2);T([$({attribute:"help-text"})],Le.prototype,"helpText",2);T([Z("checked",{waitUntilFirstUpdate:!0})],Le.prototype,"handleCheckedChange",1);T([Z("disabled",{waitUntilFirstUpdate:!0})],Le.prototype,"handleDisabledChange",1);Le.define("sl-switch");var il=G`
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
`;var He=class qt extends Y{constructor(){super(...arguments),this.hasSlotController=new Ve(this,"icon","suffix"),this.localize=new fe(this),this.open=!1,this.closable=!1,this.variant="primary",this.duration=1/0,this.remainingTime=this.duration}static get toastStack(){return this.currentToastStack||(this.currentToastStack=Object.assign(document.createElement("div"),{className:"sl-toast-stack"})),this.currentToastStack}firstUpdated(){this.base.hidden=!this.open}restartAutoHide(){this.handleCountdownChange(),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval),this.open&&this.duration<1/0&&(this.autoHideTimeout=window.setTimeout(()=>this.hide(),this.duration),this.remainingTime=this.duration,this.remainingTimeInterval=window.setInterval(()=>{this.remainingTime-=100},100))}pauseAutoHide(){var t;(t=this.countdownAnimation)==null||t.pause(),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval)}resumeAutoHide(){var t;this.duration<1/0&&(this.autoHideTimeout=window.setTimeout(()=>this.hide(),this.remainingTime),this.remainingTimeInterval=window.setInterval(()=>{this.remainingTime-=100},100),(t=this.countdownAnimation)==null||t.play())}handleCountdownChange(){if(this.open&&this.duration<1/0&&this.countdown){let{countdownElement:t}=this,s="100%",n="0";this.countdownAnimation=t.animate([{width:s},{width:n}],{duration:this.duration,easing:"linear"})}}handleCloseClick(){this.hide()}async handleOpenChange(){if(this.open){this.emit("sl-show"),this.duration<1/0&&this.restartAutoHide(),await Ae(this.base),this.base.hidden=!1;let{keyframes:t,options:s}=we(this,"alert.show",{dir:this.localize.dir()});await Se(this.base,t,s),this.emit("sl-after-show")}else{zs(this),this.emit("sl-hide"),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval),await Ae(this.base);let{keyframes:t,options:s}=we(this,"alert.hide",{dir:this.localize.dir()});await Se(this.base,t,s),this.base.hidden=!0,this.emit("sl-after-hide")}}handleDurationChange(){this.restartAutoHide()}async show(){if(!this.open)return this.open=!0,Re(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,Re(this,"sl-after-hide")}async toast(){return new Promise(t=>{this.handleCountdownChange(),qt.toastStack.parentElement===null&&document.body.append(qt.toastStack),qt.toastStack.appendChild(this),requestAnimationFrame(()=>{this.clientWidth,this.show()}),this.addEventListener("sl-after-hide",()=>{qt.toastStack.removeChild(this),t(),qt.toastStack.querySelector("sl-alert")===null&&qt.toastStack.remove()},{once:!0})})}render(){return z`
      <div
        part="base"
        class=${se({alert:!0,"alert--open":this.open,"alert--closable":this.closable,"alert--has-countdown":!!this.countdown,"alert--has-icon":this.hasSlotController.test("icon"),"alert--primary":this.variant==="primary","alert--success":this.variant==="success","alert--neutral":this.variant==="neutral","alert--warning":this.variant==="warning","alert--danger":this.variant==="danger"})}
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

        ${this.closable?z`
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

        ${this.countdown?z`
              <div
                class=${se({alert__countdown:!0,"alert__countdown--ltr":this.countdown==="ltr"})}
              >
                <div class="alert__countdown-elapsed"></div>
              </div>
            `:""}
      </div>
    `}};He.styles=[re,il];He.dependencies={"sl-icon-button":ge};T([X('[part~="base"]')],He.prototype,"base",2);T([X(".alert__countdown-elapsed")],He.prototype,"countdownElement",2);T([$({type:Boolean,reflect:!0})],He.prototype,"open",2);T([$({type:Boolean,reflect:!0})],He.prototype,"closable",2);T([$({reflect:!0})],He.prototype,"variant",2);T([$({type:Number})],He.prototype,"duration",2);T([$({type:String,reflect:!0})],He.prototype,"countdown",2);T([pe()],He.prototype,"remainingTime",2);T([Z("open",{waitUntilFirstUpdate:!0})],He.prototype,"handleOpenChange",1);T([Z("duration")],He.prototype,"handleDurationChange",1);var sl=He;ye("alert.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:250,easing:"ease"}});ye("alert.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:250,easing:"ease"}});sl.define("sl-alert");var ke=Ao(),ve=To(),le=Qs(location.hash),ol=ve.getState(),ao=!0,Ji="*",lo="",co={},ot=null,pi=null;ve.on("runs-list",e=>{let t={};for(let s of e.runs||[])t[s.id]=s;ke.setState({runs:t}),e.settings&&(co=e.settings)});ve.on("run-snapshot",e=>{e&&e.id&&(ke.setRun(e.id,e),ot&&(ot=null,Be()))});ve.on("run-update",e=>{e&&e.id&&(ke.setRun(e.id,e),ot&&(ot=null,Be()))});ve.on("log-line",e=>{e&&(ke.appendLog(e),Or(e))});ve.on("log-bulk",e=>{if(e&&Array.isArray(e.lines))for(let t of e.lines){let s={stage:e.stage,line:t};ke.appendLog(s),Or(s)}});ve.on("preferences",e=>{e&&(ke.setState({preferences:e}),Ci(e.theme||"light"))});ve.onConnection(e=>{ol=e,e==="open"&&(ve.send("list-runs").then(t=>{let s={};for(let n of t.runs||[])s[n.id]=n;ke.setState({runs:s}),t.settings&&(co=t.settings)}).catch(()=>{}),ve.send("get-preferences").then(t=>{ke.setState({preferences:t}),Ci(t.theme||"light")}).catch(()=>{}),le.runId&&(ve.send("subscribe-run",{runId:le.runId}).catch(()=>{}),ve.send("subscribe-log",{stage:Ji==="*"?null:Ji,runId:le.runId}).catch(()=>{}))),Be()});Ro(e=>{let t=le.runId;le=e,t&&t!==le.runId&&(ve.send("unsubscribe-run").catch(()=>{}),ve.send("unsubscribe-log").catch(()=>{}),ke.clearLog(),ys()),le.runId&&le.runId!==t&&(ve.send("subscribe-run",{runId:le.runId}).catch(()=>{}),ve.send("subscribe-log",{stage:null,runId:le.runId}).catch(()=>{})),le.section==="settings"&&pr().then(()=>Be()),!le.runId&&t&&gn(),Be()});function qh(e){_t(e,null)}function rl(e){_t(le.section,e)}function Kh(){let t=ke.getState().preferences.theme==="dark"?"light":"dark";ve.send("set-preferences",{theme:t}).catch(()=>{}),ke.setState({preferences:{theme:t}}),Ci(t)}function Gh(e){Ji=e,ys(),ke.clearLog(),ve.send("unsubscribe-log").catch(()=>{}),ve.send("subscribe-log",{stage:e==="*"?null:e,runId:le.runId}).catch(()=>{}),Be()}function Xh(e){lo=e,vn(e)}function Yh(){ao=!ao,Be()}function nl(e){pi=e,Be(),requestAnimationFrame(()=>{let t=document.getElementById("action-error-dialog");t&&t.show()})}function Jh(){pi=null,Be()}function Zh(){ot="stopping",pi=null,Be(),ve.send("stop-run").then(()=>{}).catch(e=>{ot=null,nl(e?.message||"Failed to stop pipeline")})}function Qh(){ot="resuming",pi=null,Be(),ve.send("resume-run").then(()=>{}).catch(e=>{ot=null,nl(e?.message||"Failed to resume pipeline")})}function ed(){if(le.runId){let t=Object.values(ke.getState().runs).filter(s=>s.active);le.section==="active"&&t.length<=1?_t("dashboard",null):_t(le.section,null)}else le.section&&le.section!=="dashboard"&&_t("dashboard",null)}function td(){let e=ke.getState(),t="Dashboard",s=!1,n=null,u=null;if(le.runId){let i=e.runs[le.runId],c=(i?.work_request?.title||"Pipeline Details").split(`
`)[0];if(t=c.length>80?c.slice(0,80)+"\u2026":c,s=!0,i){let p=i.runState||(i.active?"running":"terminal"),d=p==="running"?"warning":p==="interrupted"?"neutral":"success",f=p==="running"?"in_progress":p==="interrupted"?"interrupted":"completed",v=p==="running"?"Running":p==="interrupted"?"Interrupted":"Completed";n=z`<sl-badge variant="${d}" pill>
        ${te(Bt(f,12))}
        ${v}
      </sl-badge>`,ot==="stopping"?u=z`
          <button class="action-btn action-btn--danger" disabled>
            ${te(ae(gt,14,"icon-spin"))}
            Stopping\u2026
          </button>`:ot==="resuming"?u=z`
          <button class="action-btn action-btn--primary" disabled>
            ${te(ae(gt,14,"icon-spin"))}
            Resuming\u2026
          </button>`:p==="running"?u=z`
          <button class="action-btn action-btn--danger" @click=${Zh}>
            ${te(ae(ar,14))}
            Stop Pipeline
          </button>`:p==="interrupted"&&(u=z`
          <button class="action-btn action-btn--primary" @click=${Qh}>
            ${te(ae(lr,14))}
            Resume Pipeline
          </button>`)}}else le.section==="active"?(t="Running Pipelines",s=!0):le.section==="history"?(t="History",s=!0):le.section==="settings"&&(t="Settings",s=!0);return z`
    <div class="content-header">
      ${s?z`
        <button class="content-header-back" @click=${ed}>
          ${te(ae(nr,18))}
        </button>
      `:""}
      ${n||""}
      <h1 class="content-header-title">${t}</h1>
      ${u?z`<div class="content-header-actions">
        ${u}
      </div>`:""}
    </div>
  `}function id(){let e=ke.getState(),t=Object.values(e.runs);if(le.runId){let s=e.runs[le.runId];return z`
      ${Mo(s,co)}
      ${yn(sd(e),{onStageFilter:Gh,onSearch:Xh,onToggleAutoScroll:Yh,autoScroll:ao,runStages:s?.stages?Object.keys(s.stages):[]})}
    `}if(le.section==="settings")return Io(e.preferences,{rerender:Be,onThemeToggle:Kh});if(le.section==="history")return ur(t,"history",{onSelectRun:rl});if(le.section==="active"){let s=t.filter(n=>n.active);return s.length===1?(_t("active",s[0].id),z``):ur(t,"active",{onSelectRun:rl})}return Po(e,{onSelectRun:s=>_t("active",s)})}function sd(e){let t=e.logLines;if(Ji!=="*"&&(t=t.filter(s=>s.stage===Ji)),lo){let s=lo.toLowerCase();t=t.filter(n=>(n.line||"").toLowerCase().includes(s))}return{...e,logLines:t}}function Be(){let e=ke.getState(),t=document.getElementById("app");t&&(os(z`
    <div class="app-shell">
      ${Oo(e,le,ol,{onNavigate:qh})}
      <main class="main-content">
        ${td()}
        ${id()}
      </main>
    </div>
    ${pi?z`
      <sl-dialog id="action-error-dialog" label="Pipeline Error" @sl-after-hide=${Jh}>
        <div class="error-dialog-body">
          ${te(ae(sr,32,"error-dialog-icon"))}
          <p>${pi}</p>
        </div>
        <sl-button slot="footer" variant="primary" @click=${()=>{document.getElementById("action-error-dialog")?.hide()}}>OK</sl-button>
      </sl-dialog>
    `:""}
  `,t),le.runId&&bn(le.runId))}ke.subscribe(()=>Be());Ci(ke.getState().preferences.theme);le.section==="settings"&&pr().then(()=>Be());Be();
//# sourceMappingURL=main.bundle.js.map
