var rc=Object.create;var fr=Object.defineProperty;var oc=Object.getOwnPropertyDescriptor;var nc=Object.getOwnPropertyNames;var ac=Object.getPrototypeOf,lc=Object.prototype.hasOwnProperty;var Ko=(e,t)=>()=>(e&&(t=e(e=0)),t);var cc=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),Go=(e,t)=>{for(var s in t)fr(e,s,{get:t[s],enumerable:!0})},hc=(e,t,s,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let u of nc(t))!lc.call(e,u)&&u!==s&&fr(e,u,{get:()=>t[u],enumerable:!(n=oc(t,u))||n.enumerable});return e};var Xo=(e,t,s)=>(s=e!=null?rc(ac(e)):{},hc(t||!e||!e.__esModule?fr(s,"default",{value:e,enumerable:!0}):s,e));var Ur=cc((As,Wr)=>{(function(e,t){if(typeof As=="object"&&typeof Wr=="object")Wr.exports=t();else if(typeof define=="function"&&define.amd)define([],t);else{var s=t();for(var n in s)(typeof As=="object"?As:e)[n]=s[n]}})(self,(()=>(()=>{"use strict";var e={4567:function(u,i,r){var l=this&&this.__decorate||function(h,_,v,y){var C,m=arguments.length,S=m<3?_:y===null?y=Object.getOwnPropertyDescriptor(_,v):y;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")S=Reflect.decorate(h,_,v,y);else for(var L=h.length-1;L>=0;L--)(C=h[L])&&(S=(m<3?C(S):m>3?C(_,v,S):C(_,v))||S);return m>3&&S&&Object.defineProperty(_,v,S),S},p=this&&this.__param||function(h,_){return function(v,y){_(v,y,h)}};Object.defineProperty(i,"__esModule",{value:!0}),i.AccessibilityManager=void 0;let d=r(9042),f=r(6114),g=r(9924),w=r(844),b=r(5596),o=r(4725),a=r(3656),c=i.AccessibilityManager=class extends w.Disposable{constructor(h,_){super(),this._terminal=h,this._renderService=_,this._liveRegionLineCount=0,this._charsToConsume=[],this._charsToAnnounce="",this._accessibilityContainer=document.createElement("div"),this._accessibilityContainer.classList.add("xterm-accessibility"),this._rowContainer=document.createElement("div"),this._rowContainer.setAttribute("role","list"),this._rowContainer.classList.add("xterm-accessibility-tree"),this._rowElements=[];for(let v=0;v<this._terminal.rows;v++)this._rowElements[v]=this._createAccessibilityTreeNode(),this._rowContainer.appendChild(this._rowElements[v]);if(this._topBoundaryFocusListener=v=>this._handleBoundaryFocus(v,0),this._bottomBoundaryFocusListener=v=>this._handleBoundaryFocus(v,1),this._rowElements[0].addEventListener("focus",this._topBoundaryFocusListener),this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._refreshRowsDimensions(),this._accessibilityContainer.appendChild(this._rowContainer),this._liveRegion=document.createElement("div"),this._liveRegion.classList.add("live-region"),this._liveRegion.setAttribute("aria-live","assertive"),this._accessibilityContainer.appendChild(this._liveRegion),this._liveRegionDebouncer=this.register(new g.TimeBasedDebouncer(this._renderRows.bind(this))),!this._terminal.element)throw new Error("Cannot enable accessibility before Terminal.open");this._terminal.element.insertAdjacentElement("afterbegin",this._accessibilityContainer),this.register(this._terminal.onResize((v=>this._handleResize(v.rows)))),this.register(this._terminal.onRender((v=>this._refreshRows(v.start,v.end)))),this.register(this._terminal.onScroll((()=>this._refreshRows()))),this.register(this._terminal.onA11yChar((v=>this._handleChar(v)))),this.register(this._terminal.onLineFeed((()=>this._handleChar(`
`)))),this.register(this._terminal.onA11yTab((v=>this._handleTab(v)))),this.register(this._terminal.onKey((v=>this._handleKey(v.key)))),this.register(this._terminal.onBlur((()=>this._clearLiveRegion()))),this.register(this._renderService.onDimensionsChange((()=>this._refreshRowsDimensions()))),this._screenDprMonitor=new b.ScreenDprMonitor(window),this.register(this._screenDprMonitor),this._screenDprMonitor.setListener((()=>this._refreshRowsDimensions())),this.register((0,a.addDisposableDomListener)(window,"resize",(()=>this._refreshRowsDimensions()))),this._refreshRows(),this.register((0,w.toDisposable)((()=>{this._accessibilityContainer.remove(),this._rowElements.length=0})))}_handleTab(h){for(let _=0;_<h;_++)this._handleChar(" ")}_handleChar(h){this._liveRegionLineCount<21&&(this._charsToConsume.length>0?this._charsToConsume.shift()!==h&&(this._charsToAnnounce+=h):this._charsToAnnounce+=h,h===`
`&&(this._liveRegionLineCount++,this._liveRegionLineCount===21&&(this._liveRegion.textContent+=d.tooMuchOutput)),f.isMac&&this._liveRegion.textContent&&this._liveRegion.textContent.length>0&&!this._liveRegion.parentNode&&setTimeout((()=>{this._accessibilityContainer.appendChild(this._liveRegion)}),0))}_clearLiveRegion(){this._liveRegion.textContent="",this._liveRegionLineCount=0,f.isMac&&this._liveRegion.remove()}_handleKey(h){this._clearLiveRegion(),/\p{Control}/u.test(h)||this._charsToConsume.push(h)}_refreshRows(h,_){this._liveRegionDebouncer.refresh(h,_,this._terminal.rows)}_renderRows(h,_){let v=this._terminal.buffer,y=v.lines.length.toString();for(let C=h;C<=_;C++){let m=v.translateBufferLineToString(v.ydisp+C,!0),S=(v.ydisp+C+1).toString(),L=this._rowElements[C];L&&(m.length===0?L.innerText="\xA0":L.textContent=m,L.setAttribute("aria-posinset",S),L.setAttribute("aria-setsize",y))}this._announceCharacters()}_announceCharacters(){this._charsToAnnounce.length!==0&&(this._liveRegion.textContent+=this._charsToAnnounce,this._charsToAnnounce="")}_handleBoundaryFocus(h,_){let v=h.target,y=this._rowElements[_===0?1:this._rowElements.length-2];if(v.getAttribute("aria-posinset")===(_===0?"1":`${this._terminal.buffer.lines.length}`)||h.relatedTarget!==y)return;let C,m;if(_===0?(C=v,m=this._rowElements.pop(),this._rowContainer.removeChild(m)):(C=this._rowElements.shift(),m=v,this._rowContainer.removeChild(C)),C.removeEventListener("focus",this._topBoundaryFocusListener),m.removeEventListener("focus",this._bottomBoundaryFocusListener),_===0){let S=this._createAccessibilityTreeNode();this._rowElements.unshift(S),this._rowContainer.insertAdjacentElement("afterbegin",S)}else{let S=this._createAccessibilityTreeNode();this._rowElements.push(S),this._rowContainer.appendChild(S)}this._rowElements[0].addEventListener("focus",this._topBoundaryFocusListener),this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._terminal.scrollLines(_===0?-1:1),this._rowElements[_===0?1:this._rowElements.length-2].focus(),h.preventDefault(),h.stopImmediatePropagation()}_handleResize(h){this._rowElements[this._rowElements.length-1].removeEventListener("focus",this._bottomBoundaryFocusListener);for(let _=this._rowContainer.children.length;_<this._terminal.rows;_++)this._rowElements[_]=this._createAccessibilityTreeNode(),this._rowContainer.appendChild(this._rowElements[_]);for(;this._rowElements.length>h;)this._rowContainer.removeChild(this._rowElements.pop());this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._refreshRowsDimensions()}_createAccessibilityTreeNode(){let h=document.createElement("div");return h.setAttribute("role","listitem"),h.tabIndex=-1,this._refreshRowDimensions(h),h}_refreshRowsDimensions(){if(this._renderService.dimensions.css.cell.height){this._accessibilityContainer.style.width=`${this._renderService.dimensions.css.canvas.width}px`,this._rowElements.length!==this._terminal.rows&&this._handleResize(this._terminal.rows);for(let h=0;h<this._terminal.rows;h++)this._refreshRowDimensions(this._rowElements[h])}}_refreshRowDimensions(h){h.style.height=`${this._renderService.dimensions.css.cell.height}px`}};i.AccessibilityManager=c=l([p(1,o.IRenderService)],c)},3614:(u,i)=>{function r(f){return f.replace(/\r?\n/g,"\r")}function l(f,g){return g?"\x1B[200~"+f+"\x1B[201~":f}function p(f,g,w,b){f=l(f=r(f),w.decPrivateModes.bracketedPasteMode&&b.rawOptions.ignoreBracketedPasteMode!==!0),w.triggerDataEvent(f,!0),g.value=""}function d(f,g,w){let b=w.getBoundingClientRect(),o=f.clientX-b.left-10,a=f.clientY-b.top-10;g.style.width="20px",g.style.height="20px",g.style.left=`${o}px`,g.style.top=`${a}px`,g.style.zIndex="1000",g.focus()}Object.defineProperty(i,"__esModule",{value:!0}),i.rightClickHandler=i.moveTextAreaUnderMouseCursor=i.paste=i.handlePasteEvent=i.copyHandler=i.bracketTextForPaste=i.prepareTextForTerminal=void 0,i.prepareTextForTerminal=r,i.bracketTextForPaste=l,i.copyHandler=function(f,g){f.clipboardData&&f.clipboardData.setData("text/plain",g.selectionText),f.preventDefault()},i.handlePasteEvent=function(f,g,w,b){f.stopPropagation(),f.clipboardData&&p(f.clipboardData.getData("text/plain"),g,w,b)},i.paste=p,i.moveTextAreaUnderMouseCursor=d,i.rightClickHandler=function(f,g,w,b,o){d(f,g,w),o&&b.rightClickSelect(f),g.value=b.selectionText,g.select()}},7239:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ColorContrastCache=void 0;let l=r(1505);i.ColorContrastCache=class{constructor(){this._color=new l.TwoKeyMap,this._css=new l.TwoKeyMap}setCss(p,d,f){this._css.set(p,d,f)}getCss(p,d){return this._css.get(p,d)}setColor(p,d,f){this._color.set(p,d,f)}getColor(p,d){return this._color.get(p,d)}clear(){this._color.clear(),this._css.clear()}}},3656:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.addDisposableDomListener=void 0,i.addDisposableDomListener=function(r,l,p,d){r.addEventListener(l,p,d);let f=!1;return{dispose:()=>{f||(f=!0,r.removeEventListener(l,p,d))}}}},6465:function(u,i,r){var l=this&&this.__decorate||function(o,a,c,h){var _,v=arguments.length,y=v<3?a:h===null?h=Object.getOwnPropertyDescriptor(a,c):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(o,a,c,h);else for(var C=o.length-1;C>=0;C--)(_=o[C])&&(y=(v<3?_(y):v>3?_(a,c,y):_(a,c))||y);return v>3&&y&&Object.defineProperty(a,c,y),y},p=this&&this.__param||function(o,a){return function(c,h){a(c,h,o)}};Object.defineProperty(i,"__esModule",{value:!0}),i.Linkifier2=void 0;let d=r(3656),f=r(8460),g=r(844),w=r(2585),b=i.Linkifier2=class extends g.Disposable{get currentLink(){return this._currentLink}constructor(o){super(),this._bufferService=o,this._linkProviders=[],this._linkCacheDisposables=[],this._isMouseOut=!0,this._wasResized=!1,this._activeLine=-1,this._onShowLinkUnderline=this.register(new f.EventEmitter),this.onShowLinkUnderline=this._onShowLinkUnderline.event,this._onHideLinkUnderline=this.register(new f.EventEmitter),this.onHideLinkUnderline=this._onHideLinkUnderline.event,this.register((0,g.getDisposeArrayDisposable)(this._linkCacheDisposables)),this.register((0,g.toDisposable)((()=>{this._lastMouseEvent=void 0}))),this.register(this._bufferService.onResize((()=>{this._clearCurrentLink(),this._wasResized=!0})))}registerLinkProvider(o){return this._linkProviders.push(o),{dispose:()=>{let a=this._linkProviders.indexOf(o);a!==-1&&this._linkProviders.splice(a,1)}}}attachToDom(o,a,c){this._element=o,this._mouseService=a,this._renderService=c,this.register((0,d.addDisposableDomListener)(this._element,"mouseleave",(()=>{this._isMouseOut=!0,this._clearCurrentLink()}))),this.register((0,d.addDisposableDomListener)(this._element,"mousemove",this._handleMouseMove.bind(this))),this.register((0,d.addDisposableDomListener)(this._element,"mousedown",this._handleMouseDown.bind(this))),this.register((0,d.addDisposableDomListener)(this._element,"mouseup",this._handleMouseUp.bind(this)))}_handleMouseMove(o){if(this._lastMouseEvent=o,!this._element||!this._mouseService)return;let a=this._positionFromMouseEvent(o,this._element,this._mouseService);if(!a)return;this._isMouseOut=!1;let c=o.composedPath();for(let h=0;h<c.length;h++){let _=c[h];if(_.classList.contains("xterm"))break;if(_.classList.contains("xterm-hover"))return}this._lastBufferCell&&a.x===this._lastBufferCell.x&&a.y===this._lastBufferCell.y||(this._handleHover(a),this._lastBufferCell=a)}_handleHover(o){if(this._activeLine!==o.y||this._wasResized)return this._clearCurrentLink(),this._askForLink(o,!1),void(this._wasResized=!1);this._currentLink&&this._linkAtPosition(this._currentLink.link,o)||(this._clearCurrentLink(),this._askForLink(o,!0))}_askForLink(o,a){var c,h;this._activeProviderReplies&&a||((c=this._activeProviderReplies)===null||c===void 0||c.forEach((v=>{v?.forEach((y=>{y.link.dispose&&y.link.dispose()}))})),this._activeProviderReplies=new Map,this._activeLine=o.y);let _=!1;for(let[v,y]of this._linkProviders.entries())a?!((h=this._activeProviderReplies)===null||h===void 0)&&h.get(v)&&(_=this._checkLinkProviderResult(v,o,_)):y.provideLinks(o.y,(C=>{var m,S;if(this._isMouseOut)return;let L=C?.map(($=>({link:$})));(m=this._activeProviderReplies)===null||m===void 0||m.set(v,L),_=this._checkLinkProviderResult(v,o,_),((S=this._activeProviderReplies)===null||S===void 0?void 0:S.size)===this._linkProviders.length&&this._removeIntersectingLinks(o.y,this._activeProviderReplies)}))}_removeIntersectingLinks(o,a){let c=new Set;for(let h=0;h<a.size;h++){let _=a.get(h);if(_)for(let v=0;v<_.length;v++){let y=_[v],C=y.link.range.start.y<o?0:y.link.range.start.x,m=y.link.range.end.y>o?this._bufferService.cols:y.link.range.end.x;for(let S=C;S<=m;S++){if(c.has(S)){_.splice(v--,1);break}c.add(S)}}}}_checkLinkProviderResult(o,a,c){var h;if(!this._activeProviderReplies)return c;let _=this._activeProviderReplies.get(o),v=!1;for(let y=0;y<o;y++)this._activeProviderReplies.has(y)&&!this._activeProviderReplies.get(y)||(v=!0);if(!v&&_){let y=_.find((C=>this._linkAtPosition(C.link,a)));y&&(c=!0,this._handleNewLink(y))}if(this._activeProviderReplies.size===this._linkProviders.length&&!c)for(let y=0;y<this._activeProviderReplies.size;y++){let C=(h=this._activeProviderReplies.get(y))===null||h===void 0?void 0:h.find((m=>this._linkAtPosition(m.link,a)));if(C){c=!0,this._handleNewLink(C);break}}return c}_handleMouseDown(){this._mouseDownLink=this._currentLink}_handleMouseUp(o){if(!this._element||!this._mouseService||!this._currentLink)return;let a=this._positionFromMouseEvent(o,this._element,this._mouseService);a&&this._mouseDownLink===this._currentLink&&this._linkAtPosition(this._currentLink.link,a)&&this._currentLink.link.activate(o,this._currentLink.link.text)}_clearCurrentLink(o,a){this._element&&this._currentLink&&this._lastMouseEvent&&(!o||!a||this._currentLink.link.range.start.y>=o&&this._currentLink.link.range.end.y<=a)&&(this._linkLeave(this._element,this._currentLink.link,this._lastMouseEvent),this._currentLink=void 0,(0,g.disposeArray)(this._linkCacheDisposables))}_handleNewLink(o){if(!this._element||!this._lastMouseEvent||!this._mouseService)return;let a=this._positionFromMouseEvent(this._lastMouseEvent,this._element,this._mouseService);a&&this._linkAtPosition(o.link,a)&&(this._currentLink=o,this._currentLink.state={decorations:{underline:o.link.decorations===void 0||o.link.decorations.underline,pointerCursor:o.link.decorations===void 0||o.link.decorations.pointerCursor},isHovered:!0},this._linkHover(this._element,o.link,this._lastMouseEvent),o.link.decorations={},Object.defineProperties(o.link.decorations,{pointerCursor:{get:()=>{var c,h;return(h=(c=this._currentLink)===null||c===void 0?void 0:c.state)===null||h===void 0?void 0:h.decorations.pointerCursor},set:c=>{var h,_;!((h=this._currentLink)===null||h===void 0)&&h.state&&this._currentLink.state.decorations.pointerCursor!==c&&(this._currentLink.state.decorations.pointerCursor=c,this._currentLink.state.isHovered&&((_=this._element)===null||_===void 0||_.classList.toggle("xterm-cursor-pointer",c)))}},underline:{get:()=>{var c,h;return(h=(c=this._currentLink)===null||c===void 0?void 0:c.state)===null||h===void 0?void 0:h.decorations.underline},set:c=>{var h,_,v;!((h=this._currentLink)===null||h===void 0)&&h.state&&((v=(_=this._currentLink)===null||_===void 0?void 0:_.state)===null||v===void 0?void 0:v.decorations.underline)!==c&&(this._currentLink.state.decorations.underline=c,this._currentLink.state.isHovered&&this._fireUnderlineEvent(o.link,c))}}}),this._renderService&&this._linkCacheDisposables.push(this._renderService.onRenderedViewportChange((c=>{if(!this._currentLink)return;let h=c.start===0?0:c.start+1+this._bufferService.buffer.ydisp,_=this._bufferService.buffer.ydisp+1+c.end;if(this._currentLink.link.range.start.y>=h&&this._currentLink.link.range.end.y<=_&&(this._clearCurrentLink(h,_),this._lastMouseEvent&&this._element)){let v=this._positionFromMouseEvent(this._lastMouseEvent,this._element,this._mouseService);v&&this._askForLink(v,!1)}}))))}_linkHover(o,a,c){var h;!((h=this._currentLink)===null||h===void 0)&&h.state&&(this._currentLink.state.isHovered=!0,this._currentLink.state.decorations.underline&&this._fireUnderlineEvent(a,!0),this._currentLink.state.decorations.pointerCursor&&o.classList.add("xterm-cursor-pointer")),a.hover&&a.hover(c,a.text)}_fireUnderlineEvent(o,a){let c=o.range,h=this._bufferService.buffer.ydisp,_=this._createLinkUnderlineEvent(c.start.x-1,c.start.y-h-1,c.end.x,c.end.y-h-1,void 0);(a?this._onShowLinkUnderline:this._onHideLinkUnderline).fire(_)}_linkLeave(o,a,c){var h;!((h=this._currentLink)===null||h===void 0)&&h.state&&(this._currentLink.state.isHovered=!1,this._currentLink.state.decorations.underline&&this._fireUnderlineEvent(a,!1),this._currentLink.state.decorations.pointerCursor&&o.classList.remove("xterm-cursor-pointer")),a.leave&&a.leave(c,a.text)}_linkAtPosition(o,a){let c=o.range.start.y*this._bufferService.cols+o.range.start.x,h=o.range.end.y*this._bufferService.cols+o.range.end.x,_=a.y*this._bufferService.cols+a.x;return c<=_&&_<=h}_positionFromMouseEvent(o,a,c){let h=c.getCoords(o,a,this._bufferService.cols,this._bufferService.rows);if(h)return{x:h[0],y:h[1]+this._bufferService.buffer.ydisp}}_createLinkUnderlineEvent(o,a,c,h,_){return{x1:o,y1:a,x2:c,y2:h,cols:this._bufferService.cols,fg:_}}};i.Linkifier2=b=l([p(0,w.IBufferService)],b)},9042:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.tooMuchOutput=i.promptLabel=void 0,i.promptLabel="Terminal input",i.tooMuchOutput="Too much output to announce, navigate to rows manually to read"},3730:function(u,i,r){var l=this&&this.__decorate||function(b,o,a,c){var h,_=arguments.length,v=_<3?o:c===null?c=Object.getOwnPropertyDescriptor(o,a):c;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")v=Reflect.decorate(b,o,a,c);else for(var y=b.length-1;y>=0;y--)(h=b[y])&&(v=(_<3?h(v):_>3?h(o,a,v):h(o,a))||v);return _>3&&v&&Object.defineProperty(o,a,v),v},p=this&&this.__param||function(b,o){return function(a,c){o(a,c,b)}};Object.defineProperty(i,"__esModule",{value:!0}),i.OscLinkProvider=void 0;let d=r(511),f=r(2585),g=i.OscLinkProvider=class{constructor(b,o,a){this._bufferService=b,this._optionsService=o,this._oscLinkService=a}provideLinks(b,o){var a;let c=this._bufferService.buffer.lines.get(b-1);if(!c)return void o(void 0);let h=[],_=this._optionsService.rawOptions.linkHandler,v=new d.CellData,y=c.getTrimmedLength(),C=-1,m=-1,S=!1;for(let L=0;L<y;L++)if(m!==-1||c.hasContent(L)){if(c.loadCell(L,v),v.hasExtendedAttrs()&&v.extended.urlId){if(m===-1){m=L,C=v.extended.urlId;continue}S=v.extended.urlId!==C}else m!==-1&&(S=!0);if(S||m!==-1&&L===y-1){let $=(a=this._oscLinkService.getLinkData(C))===null||a===void 0?void 0:a.uri;if($){let T={start:{x:m+1,y:b},end:{x:L+(S||L!==y-1?0:1),y:b}},O=!1;if(!_?.allowNonHttpProtocols)try{let z=new URL($);["http:","https:"].includes(z.protocol)||(O=!0)}catch{O=!0}O||h.push({text:$,range:T,activate:(z,B)=>_?_.activate(z,B,T):w(0,B),hover:(z,B)=>{var M;return(M=_?.hover)===null||M===void 0?void 0:M.call(_,z,B,T)},leave:(z,B)=>{var M;return(M=_?.leave)===null||M===void 0?void 0:M.call(_,z,B,T)}})}S=!1,v.hasExtendedAttrs()&&v.extended.urlId?(m=L,C=v.extended.urlId):(m=-1,C=-1)}}o(h)}};function w(b,o){if(confirm(`Do you want to navigate to ${o}?

WARNING: This link could potentially be dangerous`)){let a=window.open();if(a){try{a.opener=null}catch{}a.location.href=o}else console.warn("Opening link blocked as opener could not be cleared")}}i.OscLinkProvider=g=l([p(0,f.IBufferService),p(1,f.IOptionsService),p(2,f.IOscLinkService)],g)},6193:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.RenderDebouncer=void 0,i.RenderDebouncer=class{constructor(r,l){this._parentWindow=r,this._renderCallback=l,this._refreshCallbacks=[]}dispose(){this._animationFrame&&(this._parentWindow.cancelAnimationFrame(this._animationFrame),this._animationFrame=void 0)}addRefreshCallback(r){return this._refreshCallbacks.push(r),this._animationFrame||(this._animationFrame=this._parentWindow.requestAnimationFrame((()=>this._innerRefresh()))),this._animationFrame}refresh(r,l,p){this._rowCount=p,r=r!==void 0?r:0,l=l!==void 0?l:this._rowCount-1,this._rowStart=this._rowStart!==void 0?Math.min(this._rowStart,r):r,this._rowEnd=this._rowEnd!==void 0?Math.max(this._rowEnd,l):l,this._animationFrame||(this._animationFrame=this._parentWindow.requestAnimationFrame((()=>this._innerRefresh())))}_innerRefresh(){if(this._animationFrame=void 0,this._rowStart===void 0||this._rowEnd===void 0||this._rowCount===void 0)return void this._runRefreshCallbacks();let r=Math.max(this._rowStart,0),l=Math.min(this._rowEnd,this._rowCount-1);this._rowStart=void 0,this._rowEnd=void 0,this._renderCallback(r,l),this._runRefreshCallbacks()}_runRefreshCallbacks(){for(let r of this._refreshCallbacks)r(0);this._refreshCallbacks=[]}}},5596:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ScreenDprMonitor=void 0;let l=r(844);class p extends l.Disposable{constructor(f){super(),this._parentWindow=f,this._currentDevicePixelRatio=this._parentWindow.devicePixelRatio,this.register((0,l.toDisposable)((()=>{this.clearListener()})))}setListener(f){this._listener&&this.clearListener(),this._listener=f,this._outerListener=()=>{this._listener&&(this._listener(this._parentWindow.devicePixelRatio,this._currentDevicePixelRatio),this._updateDpr())},this._updateDpr()}_updateDpr(){var f;this._outerListener&&((f=this._resolutionMediaMatchList)===null||f===void 0||f.removeListener(this._outerListener),this._currentDevicePixelRatio=this._parentWindow.devicePixelRatio,this._resolutionMediaMatchList=this._parentWindow.matchMedia(`screen and (resolution: ${this._parentWindow.devicePixelRatio}dppx)`),this._resolutionMediaMatchList.addListener(this._outerListener))}clearListener(){this._resolutionMediaMatchList&&this._listener&&this._outerListener&&(this._resolutionMediaMatchList.removeListener(this._outerListener),this._resolutionMediaMatchList=void 0,this._listener=void 0,this._outerListener=void 0)}}i.ScreenDprMonitor=p},3236:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Terminal=void 0;let l=r(3614),p=r(3656),d=r(6465),f=r(9042),g=r(3730),w=r(1680),b=r(3107),o=r(5744),a=r(2950),c=r(1296),h=r(428),_=r(4269),v=r(5114),y=r(8934),C=r(3230),m=r(9312),S=r(4725),L=r(6731),$=r(8055),T=r(8969),O=r(8460),z=r(844),B=r(6114),M=r(8437),H=r(2584),x=r(7399),E=r(5941),A=r(9074),R=r(2585),N=r(5435),j=r(4567),X=typeof window<"u"?window.document:null;class K extends T.CoreTerminal{get onFocus(){return this._onFocus.event}get onBlur(){return this._onBlur.event}get onA11yChar(){return this._onA11yCharEmitter.event}get onA11yTab(){return this._onA11yTabEmitter.event}get onWillOpen(){return this._onWillOpen.event}constructor(k={}){super(k),this.browser=B,this._keyDownHandled=!1,this._keyDownSeen=!1,this._keyPressHandled=!1,this._unprocessedDeadKey=!1,this._accessibilityManager=this.register(new z.MutableDisposable),this._onCursorMove=this.register(new O.EventEmitter),this.onCursorMove=this._onCursorMove.event,this._onKey=this.register(new O.EventEmitter),this.onKey=this._onKey.event,this._onRender=this.register(new O.EventEmitter),this.onRender=this._onRender.event,this._onSelectionChange=this.register(new O.EventEmitter),this.onSelectionChange=this._onSelectionChange.event,this._onTitleChange=this.register(new O.EventEmitter),this.onTitleChange=this._onTitleChange.event,this._onBell=this.register(new O.EventEmitter),this.onBell=this._onBell.event,this._onFocus=this.register(new O.EventEmitter),this._onBlur=this.register(new O.EventEmitter),this._onA11yCharEmitter=this.register(new O.EventEmitter),this._onA11yTabEmitter=this.register(new O.EventEmitter),this._onWillOpen=this.register(new O.EventEmitter),this._setup(),this.linkifier2=this.register(this._instantiationService.createInstance(d.Linkifier2)),this.linkifier2.registerLinkProvider(this._instantiationService.createInstance(g.OscLinkProvider)),this._decorationService=this._instantiationService.createInstance(A.DecorationService),this._instantiationService.setService(R.IDecorationService,this._decorationService),this.register(this._inputHandler.onRequestBell((()=>this._onBell.fire()))),this.register(this._inputHandler.onRequestRefreshRows(((F,U)=>this.refresh(F,U)))),this.register(this._inputHandler.onRequestSendFocus((()=>this._reportFocus()))),this.register(this._inputHandler.onRequestReset((()=>this.reset()))),this.register(this._inputHandler.onRequestWindowsOptionsReport((F=>this._reportWindowsOptions(F)))),this.register(this._inputHandler.onColor((F=>this._handleColorEvent(F)))),this.register((0,O.forwardEvent)(this._inputHandler.onCursorMove,this._onCursorMove)),this.register((0,O.forwardEvent)(this._inputHandler.onTitleChange,this._onTitleChange)),this.register((0,O.forwardEvent)(this._inputHandler.onA11yChar,this._onA11yCharEmitter)),this.register((0,O.forwardEvent)(this._inputHandler.onA11yTab,this._onA11yTabEmitter)),this.register(this._bufferService.onResize((F=>this._afterResize(F.cols,F.rows)))),this.register((0,z.toDisposable)((()=>{var F,U;this._customKeyEventHandler=void 0,(U=(F=this.element)===null||F===void 0?void 0:F.parentNode)===null||U===void 0||U.removeChild(this.element)})))}_handleColorEvent(k){if(this._themeService)for(let F of k){let U,W="";switch(F.index){case 256:U="foreground",W="10";break;case 257:U="background",W="11";break;case 258:U="cursor",W="12";break;default:U="ansi",W="4;"+F.index}switch(F.type){case 0:let ee=$.color.toColorRGB(U==="ansi"?this._themeService.colors.ansi[F.index]:this._themeService.colors[U]);this.coreService.triggerDataEvent(`${H.C0.ESC}]${W};${(0,E.toRgbString)(ee)}${H.C1_ESCAPED.ST}`);break;case 1:if(U==="ansi")this._themeService.modifyColors((q=>q.ansi[F.index]=$.rgba.toColor(...F.color)));else{let q=U;this._themeService.modifyColors((de=>de[q]=$.rgba.toColor(...F.color)))}break;case 2:this._themeService.restoreColor(F.index)}}}_setup(){super._setup(),this._customKeyEventHandler=void 0}get buffer(){return this.buffers.active}focus(){this.textarea&&this.textarea.focus({preventScroll:!0})}_handleScreenReaderModeOptionChange(k){k?!this._accessibilityManager.value&&this._renderService&&(this._accessibilityManager.value=this._instantiationService.createInstance(j.AccessibilityManager,this)):this._accessibilityManager.clear()}_handleTextAreaFocus(k){this.coreService.decPrivateModes.sendFocus&&this.coreService.triggerDataEvent(H.C0.ESC+"[I"),this.updateCursorStyle(k),this.element.classList.add("focus"),this._showCursor(),this._onFocus.fire()}blur(){var k;return(k=this.textarea)===null||k===void 0?void 0:k.blur()}_handleTextAreaBlur(){this.textarea.value="",this.refresh(this.buffer.y,this.buffer.y),this.coreService.decPrivateModes.sendFocus&&this.coreService.triggerDataEvent(H.C0.ESC+"[O"),this.element.classList.remove("focus"),this._onBlur.fire()}_syncTextArea(){if(!this.textarea||!this.buffer.isCursorInViewport||this._compositionHelper.isComposing||!this._renderService)return;let k=this.buffer.ybase+this.buffer.y,F=this.buffer.lines.get(k);if(!F)return;let U=Math.min(this.buffer.x,this.cols-1),W=this._renderService.dimensions.css.cell.height,ee=F.getWidth(U),q=this._renderService.dimensions.css.cell.width*ee,de=this.buffer.y*this._renderService.dimensions.css.cell.height,Ae=U*this._renderService.dimensions.css.cell.width;this.textarea.style.left=Ae+"px",this.textarea.style.top=de+"px",this.textarea.style.width=q+"px",this.textarea.style.height=W+"px",this.textarea.style.lineHeight=W+"px",this.textarea.style.zIndex="-5"}_initGlobal(){this._bindKeys(),this.register((0,p.addDisposableDomListener)(this.element,"copy",(F=>{this.hasSelection()&&(0,l.copyHandler)(F,this._selectionService)})));let k=F=>(0,l.handlePasteEvent)(F,this.textarea,this.coreService,this.optionsService);this.register((0,p.addDisposableDomListener)(this.textarea,"paste",k)),this.register((0,p.addDisposableDomListener)(this.element,"paste",k)),B.isFirefox?this.register((0,p.addDisposableDomListener)(this.element,"mousedown",(F=>{F.button===2&&(0,l.rightClickHandler)(F,this.textarea,this.screenElement,this._selectionService,this.options.rightClickSelectsWord)}))):this.register((0,p.addDisposableDomListener)(this.element,"contextmenu",(F=>{(0,l.rightClickHandler)(F,this.textarea,this.screenElement,this._selectionService,this.options.rightClickSelectsWord)}))),B.isLinux&&this.register((0,p.addDisposableDomListener)(this.element,"auxclick",(F=>{F.button===1&&(0,l.moveTextAreaUnderMouseCursor)(F,this.textarea,this.screenElement)})))}_bindKeys(){this.register((0,p.addDisposableDomListener)(this.textarea,"keyup",(k=>this._keyUp(k)),!0)),this.register((0,p.addDisposableDomListener)(this.textarea,"keydown",(k=>this._keyDown(k)),!0)),this.register((0,p.addDisposableDomListener)(this.textarea,"keypress",(k=>this._keyPress(k)),!0)),this.register((0,p.addDisposableDomListener)(this.textarea,"compositionstart",(()=>this._compositionHelper.compositionstart()))),this.register((0,p.addDisposableDomListener)(this.textarea,"compositionupdate",(k=>this._compositionHelper.compositionupdate(k)))),this.register((0,p.addDisposableDomListener)(this.textarea,"compositionend",(()=>this._compositionHelper.compositionend()))),this.register((0,p.addDisposableDomListener)(this.textarea,"input",(k=>this._inputEvent(k)),!0)),this.register(this.onRender((()=>this._compositionHelper.updateCompositionElements())))}open(k){var F;if(!k)throw new Error("Terminal requires a parent element.");k.isConnected||this._logService.debug("Terminal.open was called on an element that was not attached to the DOM"),this._document=k.ownerDocument,this.element=this._document.createElement("div"),this.element.dir="ltr",this.element.classList.add("terminal"),this.element.classList.add("xterm"),k.appendChild(this.element);let U=X.createDocumentFragment();this._viewportElement=X.createElement("div"),this._viewportElement.classList.add("xterm-viewport"),U.appendChild(this._viewportElement),this._viewportScrollArea=X.createElement("div"),this._viewportScrollArea.classList.add("xterm-scroll-area"),this._viewportElement.appendChild(this._viewportScrollArea),this.screenElement=X.createElement("div"),this.screenElement.classList.add("xterm-screen"),this._helperContainer=X.createElement("div"),this._helperContainer.classList.add("xterm-helpers"),this.screenElement.appendChild(this._helperContainer),U.appendChild(this.screenElement),this.textarea=X.createElement("textarea"),this.textarea.classList.add("xterm-helper-textarea"),this.textarea.setAttribute("aria-label",f.promptLabel),B.isChromeOS||this.textarea.setAttribute("aria-multiline","false"),this.textarea.setAttribute("autocorrect","off"),this.textarea.setAttribute("autocapitalize","off"),this.textarea.setAttribute("spellcheck","false"),this.textarea.tabIndex=0,this._coreBrowserService=this._instantiationService.createInstance(v.CoreBrowserService,this.textarea,(F=this._document.defaultView)!==null&&F!==void 0?F:window),this._instantiationService.setService(S.ICoreBrowserService,this._coreBrowserService),this.register((0,p.addDisposableDomListener)(this.textarea,"focus",(W=>this._handleTextAreaFocus(W)))),this.register((0,p.addDisposableDomListener)(this.textarea,"blur",(()=>this._handleTextAreaBlur()))),this._helperContainer.appendChild(this.textarea),this._charSizeService=this._instantiationService.createInstance(h.CharSizeService,this._document,this._helperContainer),this._instantiationService.setService(S.ICharSizeService,this._charSizeService),this._themeService=this._instantiationService.createInstance(L.ThemeService),this._instantiationService.setService(S.IThemeService,this._themeService),this._characterJoinerService=this._instantiationService.createInstance(_.CharacterJoinerService),this._instantiationService.setService(S.ICharacterJoinerService,this._characterJoinerService),this._renderService=this.register(this._instantiationService.createInstance(C.RenderService,this.rows,this.screenElement)),this._instantiationService.setService(S.IRenderService,this._renderService),this.register(this._renderService.onRenderedViewportChange((W=>this._onRender.fire(W)))),this.onResize((W=>this._renderService.resize(W.cols,W.rows))),this._compositionView=X.createElement("div"),this._compositionView.classList.add("composition-view"),this._compositionHelper=this._instantiationService.createInstance(a.CompositionHelper,this.textarea,this._compositionView),this._helperContainer.appendChild(this._compositionView),this.element.appendChild(U);try{this._onWillOpen.fire(this.element)}catch{}this._renderService.hasRenderer()||this._renderService.setRenderer(this._createRenderer()),this._mouseService=this._instantiationService.createInstance(y.MouseService),this._instantiationService.setService(S.IMouseService,this._mouseService),this.viewport=this._instantiationService.createInstance(w.Viewport,this._viewportElement,this._viewportScrollArea),this.viewport.onRequestScrollLines((W=>this.scrollLines(W.amount,W.suppressScrollEvent,1))),this.register(this._inputHandler.onRequestSyncScrollBar((()=>this.viewport.syncScrollArea()))),this.register(this.viewport),this.register(this.onCursorMove((()=>{this._renderService.handleCursorMove(),this._syncTextArea()}))),this.register(this.onResize((()=>this._renderService.handleResize(this.cols,this.rows)))),this.register(this.onBlur((()=>this._renderService.handleBlur()))),this.register(this.onFocus((()=>this._renderService.handleFocus()))),this.register(this._renderService.onDimensionsChange((()=>this.viewport.syncScrollArea()))),this._selectionService=this.register(this._instantiationService.createInstance(m.SelectionService,this.element,this.screenElement,this.linkifier2)),this._instantiationService.setService(S.ISelectionService,this._selectionService),this.register(this._selectionService.onRequestScrollLines((W=>this.scrollLines(W.amount,W.suppressScrollEvent)))),this.register(this._selectionService.onSelectionChange((()=>this._onSelectionChange.fire()))),this.register(this._selectionService.onRequestRedraw((W=>this._renderService.handleSelectionChanged(W.start,W.end,W.columnSelectMode)))),this.register(this._selectionService.onLinuxMouseSelection((W=>{this.textarea.value=W,this.textarea.focus(),this.textarea.select()}))),this.register(this._onScroll.event((W=>{this.viewport.syncScrollArea(),this._selectionService.refresh()}))),this.register((0,p.addDisposableDomListener)(this._viewportElement,"scroll",(()=>this._selectionService.refresh()))),this.linkifier2.attachToDom(this.screenElement,this._mouseService,this._renderService),this.register(this._instantiationService.createInstance(b.BufferDecorationRenderer,this.screenElement)),this.register((0,p.addDisposableDomListener)(this.element,"mousedown",(W=>this._selectionService.handleMouseDown(W)))),this.coreMouseService.areMouseEventsActive?(this._selectionService.disable(),this.element.classList.add("enable-mouse-events")):this._selectionService.enable(),this.options.screenReaderMode&&(this._accessibilityManager.value=this._instantiationService.createInstance(j.AccessibilityManager,this)),this.register(this.optionsService.onSpecificOptionChange("screenReaderMode",(W=>this._handleScreenReaderModeOptionChange(W)))),this.options.overviewRulerWidth&&(this._overviewRulerRenderer=this.register(this._instantiationService.createInstance(o.OverviewRulerRenderer,this._viewportElement,this.screenElement))),this.optionsService.onSpecificOptionChange("overviewRulerWidth",(W=>{!this._overviewRulerRenderer&&W&&this._viewportElement&&this.screenElement&&(this._overviewRulerRenderer=this.register(this._instantiationService.createInstance(o.OverviewRulerRenderer,this._viewportElement,this.screenElement)))})),this._charSizeService.measure(),this.refresh(0,this.rows-1),this._initGlobal(),this.bindMouse()}_createRenderer(){return this._instantiationService.createInstance(c.DomRenderer,this.element,this.screenElement,this._viewportElement,this.linkifier2)}bindMouse(){let k=this,F=this.element;function U(q){let de=k._mouseService.getMouseReportCoords(q,k.screenElement);if(!de)return!1;let Ae,Ie;switch(q.overrideType||q.type){case"mousemove":Ie=32,q.buttons===void 0?(Ae=3,q.button!==void 0&&(Ae=q.button<3?q.button:3)):Ae=1&q.buttons?0:4&q.buttons?1:2&q.buttons?2:3;break;case"mouseup":Ie=0,Ae=q.button<3?q.button:3;break;case"mousedown":Ie=1,Ae=q.button<3?q.button:3;break;case"wheel":if(k.viewport.getLinesScrolled(q)===0)return!1;Ie=q.deltaY<0?0:1,Ae=4;break;default:return!1}return!(Ie===void 0||Ae===void 0||Ae>4)&&k.coreMouseService.triggerMouseEvent({col:de.col,row:de.row,x:de.x,y:de.y,button:Ae,action:Ie,ctrl:q.ctrlKey,alt:q.altKey,shift:q.shiftKey})}let W={mouseup:null,wheel:null,mousedrag:null,mousemove:null},ee={mouseup:q=>(U(q),q.buttons||(this._document.removeEventListener("mouseup",W.mouseup),W.mousedrag&&this._document.removeEventListener("mousemove",W.mousedrag)),this.cancel(q)),wheel:q=>(U(q),this.cancel(q,!0)),mousedrag:q=>{q.buttons&&U(q)},mousemove:q=>{q.buttons||U(q)}};this.register(this.coreMouseService.onProtocolChange((q=>{q?(this.optionsService.rawOptions.logLevel==="debug"&&this._logService.debug("Binding to mouse events:",this.coreMouseService.explainEvents(q)),this.element.classList.add("enable-mouse-events"),this._selectionService.disable()):(this._logService.debug("Unbinding from mouse events."),this.element.classList.remove("enable-mouse-events"),this._selectionService.enable()),8&q?W.mousemove||(F.addEventListener("mousemove",ee.mousemove),W.mousemove=ee.mousemove):(F.removeEventListener("mousemove",W.mousemove),W.mousemove=null),16&q?W.wheel||(F.addEventListener("wheel",ee.wheel,{passive:!1}),W.wheel=ee.wheel):(F.removeEventListener("wheel",W.wheel),W.wheel=null),2&q?W.mouseup||(F.addEventListener("mouseup",ee.mouseup),W.mouseup=ee.mouseup):(this._document.removeEventListener("mouseup",W.mouseup),F.removeEventListener("mouseup",W.mouseup),W.mouseup=null),4&q?W.mousedrag||(W.mousedrag=ee.mousedrag):(this._document.removeEventListener("mousemove",W.mousedrag),W.mousedrag=null)}))),this.coreMouseService.activeProtocol=this.coreMouseService.activeProtocol,this.register((0,p.addDisposableDomListener)(F,"mousedown",(q=>{if(q.preventDefault(),this.focus(),this.coreMouseService.areMouseEventsActive&&!this._selectionService.shouldForceSelection(q))return U(q),W.mouseup&&this._document.addEventListener("mouseup",W.mouseup),W.mousedrag&&this._document.addEventListener("mousemove",W.mousedrag),this.cancel(q)}))),this.register((0,p.addDisposableDomListener)(F,"wheel",(q=>{if(!W.wheel){if(!this.buffer.hasScrollback){let de=this.viewport.getLinesScrolled(q);if(de===0)return;let Ae=H.C0.ESC+(this.coreService.decPrivateModes.applicationCursorKeys?"O":"[")+(q.deltaY<0?"A":"B"),Ie="";for(let ri=0;ri<Math.abs(de);ri++)Ie+=Ae;return this.coreService.triggerDataEvent(Ie,!0),this.cancel(q,!0)}return this.viewport.handleWheel(q)?this.cancel(q):void 0}}),{passive:!1})),this.register((0,p.addDisposableDomListener)(F,"touchstart",(q=>{if(!this.coreMouseService.areMouseEventsActive)return this.viewport.handleTouchStart(q),this.cancel(q)}),{passive:!0})),this.register((0,p.addDisposableDomListener)(F,"touchmove",(q=>{if(!this.coreMouseService.areMouseEventsActive)return this.viewport.handleTouchMove(q)?void 0:this.cancel(q)}),{passive:!1}))}refresh(k,F){var U;(U=this._renderService)===null||U===void 0||U.refreshRows(k,F)}updateCursorStyle(k){var F;!((F=this._selectionService)===null||F===void 0)&&F.shouldColumnSelect(k)?this.element.classList.add("column-select"):this.element.classList.remove("column-select")}_showCursor(){this.coreService.isCursorInitialized||(this.coreService.isCursorInitialized=!0,this.refresh(this.buffer.y,this.buffer.y))}scrollLines(k,F,U=0){var W;U===1?(super.scrollLines(k,F,U),this.refresh(0,this.rows-1)):(W=this.viewport)===null||W===void 0||W.scrollLines(k)}paste(k){(0,l.paste)(k,this.textarea,this.coreService,this.optionsService)}attachCustomKeyEventHandler(k){this._customKeyEventHandler=k}registerLinkProvider(k){return this.linkifier2.registerLinkProvider(k)}registerCharacterJoiner(k){if(!this._characterJoinerService)throw new Error("Terminal must be opened first");let F=this._characterJoinerService.register(k);return this.refresh(0,this.rows-1),F}deregisterCharacterJoiner(k){if(!this._characterJoinerService)throw new Error("Terminal must be opened first");this._characterJoinerService.deregister(k)&&this.refresh(0,this.rows-1)}get markers(){return this.buffer.markers}registerMarker(k){return this.buffer.addMarker(this.buffer.ybase+this.buffer.y+k)}registerDecoration(k){return this._decorationService.registerDecoration(k)}hasSelection(){return!!this._selectionService&&this._selectionService.hasSelection}select(k,F,U){this._selectionService.setSelection(k,F,U)}getSelection(){return this._selectionService?this._selectionService.selectionText:""}getSelectionPosition(){if(this._selectionService&&this._selectionService.hasSelection)return{start:{x:this._selectionService.selectionStart[0],y:this._selectionService.selectionStart[1]},end:{x:this._selectionService.selectionEnd[0],y:this._selectionService.selectionEnd[1]}}}clearSelection(){var k;(k=this._selectionService)===null||k===void 0||k.clearSelection()}selectAll(){var k;(k=this._selectionService)===null||k===void 0||k.selectAll()}selectLines(k,F){var U;(U=this._selectionService)===null||U===void 0||U.selectLines(k,F)}_keyDown(k){if(this._keyDownHandled=!1,this._keyDownSeen=!0,this._customKeyEventHandler&&this._customKeyEventHandler(k)===!1)return!1;let F=this.browser.isMac&&this.options.macOptionIsMeta&&k.altKey;if(!F&&!this._compositionHelper.keydown(k))return this.options.scrollOnUserInput&&this.buffer.ybase!==this.buffer.ydisp&&this.scrollToBottom(),!1;F||k.key!=="Dead"&&k.key!=="AltGraph"||(this._unprocessedDeadKey=!0);let U=(0,x.evaluateKeyboardEvent)(k,this.coreService.decPrivateModes.applicationCursorKeys,this.browser.isMac,this.options.macOptionIsMeta);if(this.updateCursorStyle(k),U.type===3||U.type===2){let W=this.rows-1;return this.scrollLines(U.type===2?-W:W),this.cancel(k,!0)}return U.type===1&&this.selectAll(),!!this._isThirdLevelShift(this.browser,k)||(U.cancel&&this.cancel(k,!0),!U.key||!!(k.key&&!k.ctrlKey&&!k.altKey&&!k.metaKey&&k.key.length===1&&k.key.charCodeAt(0)>=65&&k.key.charCodeAt(0)<=90)||(this._unprocessedDeadKey?(this._unprocessedDeadKey=!1,!0):(U.key!==H.C0.ETX&&U.key!==H.C0.CR||(this.textarea.value=""),this._onKey.fire({key:U.key,domEvent:k}),this._showCursor(),this.coreService.triggerDataEvent(U.key,!0),!this.optionsService.rawOptions.screenReaderMode||k.altKey||k.ctrlKey?this.cancel(k,!0):void(this._keyDownHandled=!0))))}_isThirdLevelShift(k,F){let U=k.isMac&&!this.options.macOptionIsMeta&&F.altKey&&!F.ctrlKey&&!F.metaKey||k.isWindows&&F.altKey&&F.ctrlKey&&!F.metaKey||k.isWindows&&F.getModifierState("AltGraph");return F.type==="keypress"?U:U&&(!F.keyCode||F.keyCode>47)}_keyUp(k){this._keyDownSeen=!1,this._customKeyEventHandler&&this._customKeyEventHandler(k)===!1||((function(F){return F.keyCode===16||F.keyCode===17||F.keyCode===18})(k)||this.focus(),this.updateCursorStyle(k),this._keyPressHandled=!1)}_keyPress(k){let F;if(this._keyPressHandled=!1,this._keyDownHandled||this._customKeyEventHandler&&this._customKeyEventHandler(k)===!1)return!1;if(this.cancel(k),k.charCode)F=k.charCode;else if(k.which===null||k.which===void 0)F=k.keyCode;else{if(k.which===0||k.charCode===0)return!1;F=k.which}return!(!F||(k.altKey||k.ctrlKey||k.metaKey)&&!this._isThirdLevelShift(this.browser,k)||(F=String.fromCharCode(F),this._onKey.fire({key:F,domEvent:k}),this._showCursor(),this.coreService.triggerDataEvent(F,!0),this._keyPressHandled=!0,this._unprocessedDeadKey=!1,0))}_inputEvent(k){if(k.data&&k.inputType==="insertText"&&(!k.composed||!this._keyDownSeen)&&!this.optionsService.rawOptions.screenReaderMode){if(this._keyPressHandled)return!1;this._unprocessedDeadKey=!1;let F=k.data;return this.coreService.triggerDataEvent(F,!0),this.cancel(k),!0}return!1}resize(k,F){k!==this.cols||F!==this.rows?super.resize(k,F):this._charSizeService&&!this._charSizeService.hasValidSize&&this._charSizeService.measure()}_afterResize(k,F){var U,W;(U=this._charSizeService)===null||U===void 0||U.measure(),(W=this.viewport)===null||W===void 0||W.syncScrollArea(!0)}clear(){var k;if(this.buffer.ybase!==0||this.buffer.y!==0){this.buffer.clearAllMarkers(),this.buffer.lines.set(0,this.buffer.lines.get(this.buffer.ybase+this.buffer.y)),this.buffer.lines.length=1,this.buffer.ydisp=0,this.buffer.ybase=0,this.buffer.y=0;for(let F=1;F<this.rows;F++)this.buffer.lines.push(this.buffer.getBlankLine(M.DEFAULT_ATTR_DATA));this._onScroll.fire({position:this.buffer.ydisp,source:0}),(k=this.viewport)===null||k===void 0||k.reset(),this.refresh(0,this.rows-1)}}reset(){var k,F;this.options.rows=this.rows,this.options.cols=this.cols;let U=this._customKeyEventHandler;this._setup(),super.reset(),(k=this._selectionService)===null||k===void 0||k.reset(),this._decorationService.reset(),(F=this.viewport)===null||F===void 0||F.reset(),this._customKeyEventHandler=U,this.refresh(0,this.rows-1)}clearTextureAtlas(){var k;(k=this._renderService)===null||k===void 0||k.clearTextureAtlas()}_reportFocus(){var k;!((k=this.element)===null||k===void 0)&&k.classList.contains("focus")?this.coreService.triggerDataEvent(H.C0.ESC+"[I"):this.coreService.triggerDataEvent(H.C0.ESC+"[O")}_reportWindowsOptions(k){if(this._renderService)switch(k){case N.WindowsOptionsReportType.GET_WIN_SIZE_PIXELS:let F=this._renderService.dimensions.css.canvas.width.toFixed(0),U=this._renderService.dimensions.css.canvas.height.toFixed(0);this.coreService.triggerDataEvent(`${H.C0.ESC}[4;${U};${F}t`);break;case N.WindowsOptionsReportType.GET_CELL_SIZE_PIXELS:let W=this._renderService.dimensions.css.cell.width.toFixed(0),ee=this._renderService.dimensions.css.cell.height.toFixed(0);this.coreService.triggerDataEvent(`${H.C0.ESC}[6;${ee};${W}t`)}}cancel(k,F){if(this.options.cancelEvents||F)return k.preventDefault(),k.stopPropagation(),!1}}i.Terminal=K},9924:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.TimeBasedDebouncer=void 0,i.TimeBasedDebouncer=class{constructor(r,l=1e3){this._renderCallback=r,this._debounceThresholdMS=l,this._lastRefreshMs=0,this._additionalRefreshRequested=!1}dispose(){this._refreshTimeoutID&&clearTimeout(this._refreshTimeoutID)}refresh(r,l,p){this._rowCount=p,r=r!==void 0?r:0,l=l!==void 0?l:this._rowCount-1,this._rowStart=this._rowStart!==void 0?Math.min(this._rowStart,r):r,this._rowEnd=this._rowEnd!==void 0?Math.max(this._rowEnd,l):l;let d=Date.now();if(d-this._lastRefreshMs>=this._debounceThresholdMS)this._lastRefreshMs=d,this._innerRefresh();else if(!this._additionalRefreshRequested){let f=d-this._lastRefreshMs,g=this._debounceThresholdMS-f;this._additionalRefreshRequested=!0,this._refreshTimeoutID=window.setTimeout((()=>{this._lastRefreshMs=Date.now(),this._innerRefresh(),this._additionalRefreshRequested=!1,this._refreshTimeoutID=void 0}),g)}}_innerRefresh(){if(this._rowStart===void 0||this._rowEnd===void 0||this._rowCount===void 0)return;let r=Math.max(this._rowStart,0),l=Math.min(this._rowEnd,this._rowCount-1);this._rowStart=void 0,this._rowEnd=void 0,this._renderCallback(r,l)}}},1680:function(u,i,r){var l=this&&this.__decorate||function(a,c,h,_){var v,y=arguments.length,C=y<3?c:_===null?_=Object.getOwnPropertyDescriptor(c,h):_;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")C=Reflect.decorate(a,c,h,_);else for(var m=a.length-1;m>=0;m--)(v=a[m])&&(C=(y<3?v(C):y>3?v(c,h,C):v(c,h))||C);return y>3&&C&&Object.defineProperty(c,h,C),C},p=this&&this.__param||function(a,c){return function(h,_){c(h,_,a)}};Object.defineProperty(i,"__esModule",{value:!0}),i.Viewport=void 0;let d=r(3656),f=r(4725),g=r(8460),w=r(844),b=r(2585),o=i.Viewport=class extends w.Disposable{constructor(a,c,h,_,v,y,C,m){super(),this._viewportElement=a,this._scrollArea=c,this._bufferService=h,this._optionsService=_,this._charSizeService=v,this._renderService=y,this._coreBrowserService=C,this.scrollBarWidth=0,this._currentRowHeight=0,this._currentDeviceCellHeight=0,this._lastRecordedBufferLength=0,this._lastRecordedViewportHeight=0,this._lastRecordedBufferHeight=0,this._lastTouchY=0,this._lastScrollTop=0,this._wheelPartialScroll=0,this._refreshAnimationFrame=null,this._ignoreNextScrollEvent=!1,this._smoothScrollState={startTime:0,origin:-1,target:-1},this._onRequestScrollLines=this.register(new g.EventEmitter),this.onRequestScrollLines=this._onRequestScrollLines.event,this.scrollBarWidth=this._viewportElement.offsetWidth-this._scrollArea.offsetWidth||15,this.register((0,d.addDisposableDomListener)(this._viewportElement,"scroll",this._handleScroll.bind(this))),this._activeBuffer=this._bufferService.buffer,this.register(this._bufferService.buffers.onBufferActivate((S=>this._activeBuffer=S.activeBuffer))),this._renderDimensions=this._renderService.dimensions,this.register(this._renderService.onDimensionsChange((S=>this._renderDimensions=S))),this._handleThemeChange(m.colors),this.register(m.onChangeColors((S=>this._handleThemeChange(S)))),this.register(this._optionsService.onSpecificOptionChange("scrollback",(()=>this.syncScrollArea()))),setTimeout((()=>this.syncScrollArea()))}_handleThemeChange(a){this._viewportElement.style.backgroundColor=a.background.css}reset(){this._currentRowHeight=0,this._currentDeviceCellHeight=0,this._lastRecordedBufferLength=0,this._lastRecordedViewportHeight=0,this._lastRecordedBufferHeight=0,this._lastTouchY=0,this._lastScrollTop=0,this._coreBrowserService.window.requestAnimationFrame((()=>this.syncScrollArea()))}_refresh(a){if(a)return this._innerRefresh(),void(this._refreshAnimationFrame!==null&&this._coreBrowserService.window.cancelAnimationFrame(this._refreshAnimationFrame));this._refreshAnimationFrame===null&&(this._refreshAnimationFrame=this._coreBrowserService.window.requestAnimationFrame((()=>this._innerRefresh())))}_innerRefresh(){if(this._charSizeService.height>0){this._currentRowHeight=this._renderService.dimensions.device.cell.height/this._coreBrowserService.dpr,this._currentDeviceCellHeight=this._renderService.dimensions.device.cell.height,this._lastRecordedViewportHeight=this._viewportElement.offsetHeight;let c=Math.round(this._currentRowHeight*this._lastRecordedBufferLength)+(this._lastRecordedViewportHeight-this._renderService.dimensions.css.canvas.height);this._lastRecordedBufferHeight!==c&&(this._lastRecordedBufferHeight=c,this._scrollArea.style.height=this._lastRecordedBufferHeight+"px")}let a=this._bufferService.buffer.ydisp*this._currentRowHeight;this._viewportElement.scrollTop!==a&&(this._ignoreNextScrollEvent=!0,this._viewportElement.scrollTop=a),this._refreshAnimationFrame=null}syncScrollArea(a=!1){if(this._lastRecordedBufferLength!==this._bufferService.buffer.lines.length)return this._lastRecordedBufferLength=this._bufferService.buffer.lines.length,void this._refresh(a);this._lastRecordedViewportHeight===this._renderService.dimensions.css.canvas.height&&this._lastScrollTop===this._activeBuffer.ydisp*this._currentRowHeight&&this._renderDimensions.device.cell.height===this._currentDeviceCellHeight||this._refresh(a)}_handleScroll(a){if(this._lastScrollTop=this._viewportElement.scrollTop,!this._viewportElement.offsetParent)return;if(this._ignoreNextScrollEvent)return this._ignoreNextScrollEvent=!1,void this._onRequestScrollLines.fire({amount:0,suppressScrollEvent:!0});let c=Math.round(this._lastScrollTop/this._currentRowHeight)-this._bufferService.buffer.ydisp;this._onRequestScrollLines.fire({amount:c,suppressScrollEvent:!0})}_smoothScroll(){if(this._isDisposed||this._smoothScrollState.origin===-1||this._smoothScrollState.target===-1)return;let a=this._smoothScrollPercent();this._viewportElement.scrollTop=this._smoothScrollState.origin+Math.round(a*(this._smoothScrollState.target-this._smoothScrollState.origin)),a<1?this._coreBrowserService.window.requestAnimationFrame((()=>this._smoothScroll())):this._clearSmoothScrollState()}_smoothScrollPercent(){return this._optionsService.rawOptions.smoothScrollDuration&&this._smoothScrollState.startTime?Math.max(Math.min((Date.now()-this._smoothScrollState.startTime)/this._optionsService.rawOptions.smoothScrollDuration,1),0):1}_clearSmoothScrollState(){this._smoothScrollState.startTime=0,this._smoothScrollState.origin=-1,this._smoothScrollState.target=-1}_bubbleScroll(a,c){let h=this._viewportElement.scrollTop+this._lastRecordedViewportHeight;return!(c<0&&this._viewportElement.scrollTop!==0||c>0&&h<this._lastRecordedBufferHeight)||(a.cancelable&&a.preventDefault(),!1)}handleWheel(a){let c=this._getPixelsScrolled(a);return c!==0&&(this._optionsService.rawOptions.smoothScrollDuration?(this._smoothScrollState.startTime=Date.now(),this._smoothScrollPercent()<1?(this._smoothScrollState.origin=this._viewportElement.scrollTop,this._smoothScrollState.target===-1?this._smoothScrollState.target=this._viewportElement.scrollTop+c:this._smoothScrollState.target+=c,this._smoothScrollState.target=Math.max(Math.min(this._smoothScrollState.target,this._viewportElement.scrollHeight),0),this._smoothScroll()):this._clearSmoothScrollState()):this._viewportElement.scrollTop+=c,this._bubbleScroll(a,c))}scrollLines(a){if(a!==0)if(this._optionsService.rawOptions.smoothScrollDuration){let c=a*this._currentRowHeight;this._smoothScrollState.startTime=Date.now(),this._smoothScrollPercent()<1?(this._smoothScrollState.origin=this._viewportElement.scrollTop,this._smoothScrollState.target=this._smoothScrollState.origin+c,this._smoothScrollState.target=Math.max(Math.min(this._smoothScrollState.target,this._viewportElement.scrollHeight),0),this._smoothScroll()):this._clearSmoothScrollState()}else this._onRequestScrollLines.fire({amount:a,suppressScrollEvent:!1})}_getPixelsScrolled(a){if(a.deltaY===0||a.shiftKey)return 0;let c=this._applyScrollModifier(a.deltaY,a);return a.deltaMode===WheelEvent.DOM_DELTA_LINE?c*=this._currentRowHeight:a.deltaMode===WheelEvent.DOM_DELTA_PAGE&&(c*=this._currentRowHeight*this._bufferService.rows),c}getBufferElements(a,c){var h;let _,v="",y=[],C=c??this._bufferService.buffer.lines.length,m=this._bufferService.buffer.lines;for(let S=a;S<C;S++){let L=m.get(S);if(!L)continue;let $=(h=m.get(S+1))===null||h===void 0?void 0:h.isWrapped;if(v+=L.translateToString(!$),!$||S===m.length-1){let T=document.createElement("div");T.textContent=v,y.push(T),v.length>0&&(_=T),v=""}}return{bufferElements:y,cursorElement:_}}getLinesScrolled(a){if(a.deltaY===0||a.shiftKey)return 0;let c=this._applyScrollModifier(a.deltaY,a);return a.deltaMode===WheelEvent.DOM_DELTA_PIXEL?(c/=this._currentRowHeight+0,this._wheelPartialScroll+=c,c=Math.floor(Math.abs(this._wheelPartialScroll))*(this._wheelPartialScroll>0?1:-1),this._wheelPartialScroll%=1):a.deltaMode===WheelEvent.DOM_DELTA_PAGE&&(c*=this._bufferService.rows),c}_applyScrollModifier(a,c){let h=this._optionsService.rawOptions.fastScrollModifier;return h==="alt"&&c.altKey||h==="ctrl"&&c.ctrlKey||h==="shift"&&c.shiftKey?a*this._optionsService.rawOptions.fastScrollSensitivity*this._optionsService.rawOptions.scrollSensitivity:a*this._optionsService.rawOptions.scrollSensitivity}handleTouchStart(a){this._lastTouchY=a.touches[0].pageY}handleTouchMove(a){let c=this._lastTouchY-a.touches[0].pageY;return this._lastTouchY=a.touches[0].pageY,c!==0&&(this._viewportElement.scrollTop+=c,this._bubbleScroll(a,c))}};i.Viewport=o=l([p(2,b.IBufferService),p(3,b.IOptionsService),p(4,f.ICharSizeService),p(5,f.IRenderService),p(6,f.ICoreBrowserService),p(7,f.IThemeService)],o)},3107:function(u,i,r){var l=this&&this.__decorate||function(o,a,c,h){var _,v=arguments.length,y=v<3?a:h===null?h=Object.getOwnPropertyDescriptor(a,c):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(o,a,c,h);else for(var C=o.length-1;C>=0;C--)(_=o[C])&&(y=(v<3?_(y):v>3?_(a,c,y):_(a,c))||y);return v>3&&y&&Object.defineProperty(a,c,y),y},p=this&&this.__param||function(o,a){return function(c,h){a(c,h,o)}};Object.defineProperty(i,"__esModule",{value:!0}),i.BufferDecorationRenderer=void 0;let d=r(3656),f=r(4725),g=r(844),w=r(2585),b=i.BufferDecorationRenderer=class extends g.Disposable{constructor(o,a,c,h){super(),this._screenElement=o,this._bufferService=a,this._decorationService=c,this._renderService=h,this._decorationElements=new Map,this._altBufferIsActive=!1,this._dimensionsChanged=!1,this._container=document.createElement("div"),this._container.classList.add("xterm-decoration-container"),this._screenElement.appendChild(this._container),this.register(this._renderService.onRenderedViewportChange((()=>this._doRefreshDecorations()))),this.register(this._renderService.onDimensionsChange((()=>{this._dimensionsChanged=!0,this._queueRefresh()}))),this.register((0,d.addDisposableDomListener)(window,"resize",(()=>this._queueRefresh()))),this.register(this._bufferService.buffers.onBufferActivate((()=>{this._altBufferIsActive=this._bufferService.buffer===this._bufferService.buffers.alt}))),this.register(this._decorationService.onDecorationRegistered((()=>this._queueRefresh()))),this.register(this._decorationService.onDecorationRemoved((_=>this._removeDecoration(_)))),this.register((0,g.toDisposable)((()=>{this._container.remove(),this._decorationElements.clear()})))}_queueRefresh(){this._animationFrame===void 0&&(this._animationFrame=this._renderService.addRefreshCallback((()=>{this._doRefreshDecorations(),this._animationFrame=void 0})))}_doRefreshDecorations(){for(let o of this._decorationService.decorations)this._renderDecoration(o);this._dimensionsChanged=!1}_renderDecoration(o){this._refreshStyle(o),this._dimensionsChanged&&this._refreshXPosition(o)}_createElement(o){var a,c;let h=document.createElement("div");h.classList.add("xterm-decoration"),h.classList.toggle("xterm-decoration-top-layer",((a=o?.options)===null||a===void 0?void 0:a.layer)==="top"),h.style.width=`${Math.round((o.options.width||1)*this._renderService.dimensions.css.cell.width)}px`,h.style.height=(o.options.height||1)*this._renderService.dimensions.css.cell.height+"px",h.style.top=(o.marker.line-this._bufferService.buffers.active.ydisp)*this._renderService.dimensions.css.cell.height+"px",h.style.lineHeight=`${this._renderService.dimensions.css.cell.height}px`;let _=(c=o.options.x)!==null&&c!==void 0?c:0;return _&&_>this._bufferService.cols&&(h.style.display="none"),this._refreshXPosition(o,h),h}_refreshStyle(o){let a=o.marker.line-this._bufferService.buffers.active.ydisp;if(a<0||a>=this._bufferService.rows)o.element&&(o.element.style.display="none",o.onRenderEmitter.fire(o.element));else{let c=this._decorationElements.get(o);c||(c=this._createElement(o),o.element=c,this._decorationElements.set(o,c),this._container.appendChild(c),o.onDispose((()=>{this._decorationElements.delete(o),c.remove()}))),c.style.top=a*this._renderService.dimensions.css.cell.height+"px",c.style.display=this._altBufferIsActive?"none":"block",o.onRenderEmitter.fire(c)}}_refreshXPosition(o,a=o.element){var c;if(!a)return;let h=(c=o.options.x)!==null&&c!==void 0?c:0;(o.options.anchor||"left")==="right"?a.style.right=h?h*this._renderService.dimensions.css.cell.width+"px":"":a.style.left=h?h*this._renderService.dimensions.css.cell.width+"px":""}_removeDecoration(o){var a;(a=this._decorationElements.get(o))===null||a===void 0||a.remove(),this._decorationElements.delete(o),o.dispose()}};i.BufferDecorationRenderer=b=l([p(1,w.IBufferService),p(2,w.IDecorationService),p(3,f.IRenderService)],b)},5871:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ColorZoneStore=void 0,i.ColorZoneStore=class{constructor(){this._zones=[],this._zonePool=[],this._zonePoolIndex=0,this._linePadding={full:0,left:0,center:0,right:0}}get zones(){return this._zonePool.length=Math.min(this._zonePool.length,this._zones.length),this._zones}clear(){this._zones.length=0,this._zonePoolIndex=0}addDecoration(r){if(r.options.overviewRulerOptions){for(let l of this._zones)if(l.color===r.options.overviewRulerOptions.color&&l.position===r.options.overviewRulerOptions.position){if(this._lineIntersectsZone(l,r.marker.line))return;if(this._lineAdjacentToZone(l,r.marker.line,r.options.overviewRulerOptions.position))return void this._addLineToZone(l,r.marker.line)}if(this._zonePoolIndex<this._zonePool.length)return this._zonePool[this._zonePoolIndex].color=r.options.overviewRulerOptions.color,this._zonePool[this._zonePoolIndex].position=r.options.overviewRulerOptions.position,this._zonePool[this._zonePoolIndex].startBufferLine=r.marker.line,this._zonePool[this._zonePoolIndex].endBufferLine=r.marker.line,void this._zones.push(this._zonePool[this._zonePoolIndex++]);this._zones.push({color:r.options.overviewRulerOptions.color,position:r.options.overviewRulerOptions.position,startBufferLine:r.marker.line,endBufferLine:r.marker.line}),this._zonePool.push(this._zones[this._zones.length-1]),this._zonePoolIndex++}}setPadding(r){this._linePadding=r}_lineIntersectsZone(r,l){return l>=r.startBufferLine&&l<=r.endBufferLine}_lineAdjacentToZone(r,l,p){return l>=r.startBufferLine-this._linePadding[p||"full"]&&l<=r.endBufferLine+this._linePadding[p||"full"]}_addLineToZone(r,l){r.startBufferLine=Math.min(r.startBufferLine,l),r.endBufferLine=Math.max(r.endBufferLine,l)}}},5744:function(u,i,r){var l=this&&this.__decorate||function(_,v,y,C){var m,S=arguments.length,L=S<3?v:C===null?C=Object.getOwnPropertyDescriptor(v,y):C;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")L=Reflect.decorate(_,v,y,C);else for(var $=_.length-1;$>=0;$--)(m=_[$])&&(L=(S<3?m(L):S>3?m(v,y,L):m(v,y))||L);return S>3&&L&&Object.defineProperty(v,y,L),L},p=this&&this.__param||function(_,v){return function(y,C){v(y,C,_)}};Object.defineProperty(i,"__esModule",{value:!0}),i.OverviewRulerRenderer=void 0;let d=r(5871),f=r(3656),g=r(4725),w=r(844),b=r(2585),o={full:0,left:0,center:0,right:0},a={full:0,left:0,center:0,right:0},c={full:0,left:0,center:0,right:0},h=i.OverviewRulerRenderer=class extends w.Disposable{get _width(){return this._optionsService.options.overviewRulerWidth||0}constructor(_,v,y,C,m,S,L){var $;super(),this._viewportElement=_,this._screenElement=v,this._bufferService=y,this._decorationService=C,this._renderService=m,this._optionsService=S,this._coreBrowseService=L,this._colorZoneStore=new d.ColorZoneStore,this._shouldUpdateDimensions=!0,this._shouldUpdateAnchor=!0,this._lastKnownBufferLength=0,this._canvas=document.createElement("canvas"),this._canvas.classList.add("xterm-decoration-overview-ruler"),this._refreshCanvasDimensions(),($=this._viewportElement.parentElement)===null||$===void 0||$.insertBefore(this._canvas,this._viewportElement);let T=this._canvas.getContext("2d");if(!T)throw new Error("Ctx cannot be null");this._ctx=T,this._registerDecorationListeners(),this._registerBufferChangeListeners(),this._registerDimensionChangeListeners(),this.register((0,w.toDisposable)((()=>{var O;(O=this._canvas)===null||O===void 0||O.remove()})))}_registerDecorationListeners(){this.register(this._decorationService.onDecorationRegistered((()=>this._queueRefresh(void 0,!0)))),this.register(this._decorationService.onDecorationRemoved((()=>this._queueRefresh(void 0,!0))))}_registerBufferChangeListeners(){this.register(this._renderService.onRenderedViewportChange((()=>this._queueRefresh()))),this.register(this._bufferService.buffers.onBufferActivate((()=>{this._canvas.style.display=this._bufferService.buffer===this._bufferService.buffers.alt?"none":"block"}))),this.register(this._bufferService.onScroll((()=>{this._lastKnownBufferLength!==this._bufferService.buffers.normal.lines.length&&(this._refreshDrawHeightConstants(),this._refreshColorZonePadding())})))}_registerDimensionChangeListeners(){this.register(this._renderService.onRender((()=>{this._containerHeight&&this._containerHeight===this._screenElement.clientHeight||(this._queueRefresh(!0),this._containerHeight=this._screenElement.clientHeight)}))),this.register(this._optionsService.onSpecificOptionChange("overviewRulerWidth",(()=>this._queueRefresh(!0)))),this.register((0,f.addDisposableDomListener)(this._coreBrowseService.window,"resize",(()=>this._queueRefresh(!0)))),this._queueRefresh(!0)}_refreshDrawConstants(){let _=Math.floor(this._canvas.width/3),v=Math.ceil(this._canvas.width/3);a.full=this._canvas.width,a.left=_,a.center=v,a.right=_,this._refreshDrawHeightConstants(),c.full=0,c.left=0,c.center=a.left,c.right=a.left+a.center}_refreshDrawHeightConstants(){o.full=Math.round(2*this._coreBrowseService.dpr);let _=this._canvas.height/this._bufferService.buffer.lines.length,v=Math.round(Math.max(Math.min(_,12),6)*this._coreBrowseService.dpr);o.left=v,o.center=v,o.right=v}_refreshColorZonePadding(){this._colorZoneStore.setPadding({full:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*o.full),left:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*o.left),center:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*o.center),right:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*o.right)}),this._lastKnownBufferLength=this._bufferService.buffers.normal.lines.length}_refreshCanvasDimensions(){this._canvas.style.width=`${this._width}px`,this._canvas.width=Math.round(this._width*this._coreBrowseService.dpr),this._canvas.style.height=`${this._screenElement.clientHeight}px`,this._canvas.height=Math.round(this._screenElement.clientHeight*this._coreBrowseService.dpr),this._refreshDrawConstants(),this._refreshColorZonePadding()}_refreshDecorations(){this._shouldUpdateDimensions&&this._refreshCanvasDimensions(),this._ctx.clearRect(0,0,this._canvas.width,this._canvas.height),this._colorZoneStore.clear();for(let v of this._decorationService.decorations)this._colorZoneStore.addDecoration(v);this._ctx.lineWidth=1;let _=this._colorZoneStore.zones;for(let v of _)v.position!=="full"&&this._renderColorZone(v);for(let v of _)v.position==="full"&&this._renderColorZone(v);this._shouldUpdateDimensions=!1,this._shouldUpdateAnchor=!1}_renderColorZone(_){this._ctx.fillStyle=_.color,this._ctx.fillRect(c[_.position||"full"],Math.round((this._canvas.height-1)*(_.startBufferLine/this._bufferService.buffers.active.lines.length)-o[_.position||"full"]/2),a[_.position||"full"],Math.round((this._canvas.height-1)*((_.endBufferLine-_.startBufferLine)/this._bufferService.buffers.active.lines.length)+o[_.position||"full"]))}_queueRefresh(_,v){this._shouldUpdateDimensions=_||this._shouldUpdateDimensions,this._shouldUpdateAnchor=v||this._shouldUpdateAnchor,this._animationFrame===void 0&&(this._animationFrame=this._coreBrowseService.window.requestAnimationFrame((()=>{this._refreshDecorations(),this._animationFrame=void 0})))}};i.OverviewRulerRenderer=h=l([p(2,b.IBufferService),p(3,b.IDecorationService),p(4,g.IRenderService),p(5,b.IOptionsService),p(6,g.ICoreBrowserService)],h)},2950:function(u,i,r){var l=this&&this.__decorate||function(b,o,a,c){var h,_=arguments.length,v=_<3?o:c===null?c=Object.getOwnPropertyDescriptor(o,a):c;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")v=Reflect.decorate(b,o,a,c);else for(var y=b.length-1;y>=0;y--)(h=b[y])&&(v=(_<3?h(v):_>3?h(o,a,v):h(o,a))||v);return _>3&&v&&Object.defineProperty(o,a,v),v},p=this&&this.__param||function(b,o){return function(a,c){o(a,c,b)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CompositionHelper=void 0;let d=r(4725),f=r(2585),g=r(2584),w=i.CompositionHelper=class{get isComposing(){return this._isComposing}constructor(b,o,a,c,h,_){this._textarea=b,this._compositionView=o,this._bufferService=a,this._optionsService=c,this._coreService=h,this._renderService=_,this._isComposing=!1,this._isSendingComposition=!1,this._compositionPosition={start:0,end:0},this._dataAlreadySent=""}compositionstart(){this._isComposing=!0,this._compositionPosition.start=this._textarea.value.length,this._compositionView.textContent="",this._dataAlreadySent="",this._compositionView.classList.add("active")}compositionupdate(b){this._compositionView.textContent=b.data,this.updateCompositionElements(),setTimeout((()=>{this._compositionPosition.end=this._textarea.value.length}),0)}compositionend(){this._finalizeComposition(!0)}keydown(b){if(this._isComposing||this._isSendingComposition){if(b.keyCode===229||b.keyCode===16||b.keyCode===17||b.keyCode===18)return!1;this._finalizeComposition(!1)}return b.keyCode!==229||(this._handleAnyTextareaChanges(),!1)}_finalizeComposition(b){if(this._compositionView.classList.remove("active"),this._isComposing=!1,b){let o={start:this._compositionPosition.start,end:this._compositionPosition.end};this._isSendingComposition=!0,setTimeout((()=>{if(this._isSendingComposition){let a;this._isSendingComposition=!1,o.start+=this._dataAlreadySent.length,a=this._isComposing?this._textarea.value.substring(o.start,o.end):this._textarea.value.substring(o.start),a.length>0&&this._coreService.triggerDataEvent(a,!0)}}),0)}else{this._isSendingComposition=!1;let o=this._textarea.value.substring(this._compositionPosition.start,this._compositionPosition.end);this._coreService.triggerDataEvent(o,!0)}}_handleAnyTextareaChanges(){let b=this._textarea.value;setTimeout((()=>{if(!this._isComposing){let o=this._textarea.value,a=o.replace(b,"");this._dataAlreadySent=a,o.length>b.length?this._coreService.triggerDataEvent(a,!0):o.length<b.length?this._coreService.triggerDataEvent(`${g.C0.DEL}`,!0):o.length===b.length&&o!==b&&this._coreService.triggerDataEvent(o,!0)}}),0)}updateCompositionElements(b){if(this._isComposing){if(this._bufferService.buffer.isCursorInViewport){let o=Math.min(this._bufferService.buffer.x,this._bufferService.cols-1),a=this._renderService.dimensions.css.cell.height,c=this._bufferService.buffer.y*this._renderService.dimensions.css.cell.height,h=o*this._renderService.dimensions.css.cell.width;this._compositionView.style.left=h+"px",this._compositionView.style.top=c+"px",this._compositionView.style.height=a+"px",this._compositionView.style.lineHeight=a+"px",this._compositionView.style.fontFamily=this._optionsService.rawOptions.fontFamily,this._compositionView.style.fontSize=this._optionsService.rawOptions.fontSize+"px";let _=this._compositionView.getBoundingClientRect();this._textarea.style.left=h+"px",this._textarea.style.top=c+"px",this._textarea.style.width=Math.max(_.width,1)+"px",this._textarea.style.height=Math.max(_.height,1)+"px",this._textarea.style.lineHeight=_.height+"px"}b||setTimeout((()=>this.updateCompositionElements(!0)),0)}}};i.CompositionHelper=w=l([p(2,f.IBufferService),p(3,f.IOptionsService),p(4,f.ICoreService),p(5,d.IRenderService)],w)},9806:(u,i)=>{function r(l,p,d){let f=d.getBoundingClientRect(),g=l.getComputedStyle(d),w=parseInt(g.getPropertyValue("padding-left")),b=parseInt(g.getPropertyValue("padding-top"));return[p.clientX-f.left-w,p.clientY-f.top-b]}Object.defineProperty(i,"__esModule",{value:!0}),i.getCoords=i.getCoordsRelativeToElement=void 0,i.getCoordsRelativeToElement=r,i.getCoords=function(l,p,d,f,g,w,b,o,a){if(!w)return;let c=r(l,p,d);return c?(c[0]=Math.ceil((c[0]+(a?b/2:0))/b),c[1]=Math.ceil(c[1]/o),c[0]=Math.min(Math.max(c[0],1),f+(a?1:0)),c[1]=Math.min(Math.max(c[1],1),g),c):void 0}},9504:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.moveToCellSequence=void 0;let l=r(2584);function p(o,a,c,h){let _=o-d(o,c),v=a-d(a,c),y=Math.abs(_-v)-(function(C,m,S){let L=0,$=C-d(C,S),T=m-d(m,S);for(let O=0;O<Math.abs($-T);O++){let z=f(C,m)==="A"?-1:1,B=S.buffer.lines.get($+z*O);B?.isWrapped&&L++}return L})(o,a,c);return b(y,w(f(o,a),h))}function d(o,a){let c=0,h=a.buffer.lines.get(o),_=h?.isWrapped;for(;_&&o>=0&&o<a.rows;)c++,h=a.buffer.lines.get(--o),_=h?.isWrapped;return c}function f(o,a){return o>a?"A":"B"}function g(o,a,c,h,_,v){let y=o,C=a,m="";for(;y!==c||C!==h;)y+=_?1:-1,_&&y>v.cols-1?(m+=v.buffer.translateBufferLineToString(C,!1,o,y),y=0,o=0,C++):!_&&y<0&&(m+=v.buffer.translateBufferLineToString(C,!1,0,o+1),y=v.cols-1,o=y,C--);return m+v.buffer.translateBufferLineToString(C,!1,o,y)}function w(o,a){let c=a?"O":"[";return l.C0.ESC+c+o}function b(o,a){o=Math.floor(o);let c="";for(let h=0;h<o;h++)c+=a;return c}i.moveToCellSequence=function(o,a,c,h){let _=c.buffer.x,v=c.buffer.y;if(!c.buffer.hasScrollback)return(function(m,S,L,$,T,O){return p(S,$,T,O).length===0?"":b(g(m,S,m,S-d(S,T),!1,T).length,w("D",O))})(_,v,0,a,c,h)+p(v,a,c,h)+(function(m,S,L,$,T,O){let z;z=p(S,$,T,O).length>0?$-d($,T):S;let B=$,M=(function(H,x,E,A,R,N){let j;return j=p(E,A,R,N).length>0?A-d(A,R):x,H<E&&j<=A||H>=E&&j<A?"C":"D"})(m,S,L,$,T,O);return b(g(m,z,L,B,M==="C",T).length,w(M,O))})(_,v,o,a,c,h);let y;if(v===a)return y=_>o?"D":"C",b(Math.abs(_-o),w(y,h));y=v>a?"D":"C";let C=Math.abs(v-a);return b((function(m,S){return S.cols-m})(v>a?o:_,c)+(C-1)*c.cols+1+((v>a?_:o)-1),w(y,h))}},1296:function(u,i,r){var l=this&&this.__decorate||function(T,O,z,B){var M,H=arguments.length,x=H<3?O:B===null?B=Object.getOwnPropertyDescriptor(O,z):B;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")x=Reflect.decorate(T,O,z,B);else for(var E=T.length-1;E>=0;E--)(M=T[E])&&(x=(H<3?M(x):H>3?M(O,z,x):M(O,z))||x);return H>3&&x&&Object.defineProperty(O,z,x),x},p=this&&this.__param||function(T,O){return function(z,B){O(z,B,T)}};Object.defineProperty(i,"__esModule",{value:!0}),i.DomRenderer=void 0;let d=r(3787),f=r(2550),g=r(2223),w=r(6171),b=r(4725),o=r(8055),a=r(8460),c=r(844),h=r(2585),_="xterm-dom-renderer-owner-",v="xterm-rows",y="xterm-fg-",C="xterm-bg-",m="xterm-focus",S="xterm-selection",L=1,$=i.DomRenderer=class extends c.Disposable{constructor(T,O,z,B,M,H,x,E,A,R){super(),this._element=T,this._screenElement=O,this._viewportElement=z,this._linkifier2=B,this._charSizeService=H,this._optionsService=x,this._bufferService=E,this._coreBrowserService=A,this._themeService=R,this._terminalClass=L++,this._rowElements=[],this.onRequestRedraw=this.register(new a.EventEmitter).event,this._rowContainer=document.createElement("div"),this._rowContainer.classList.add(v),this._rowContainer.style.lineHeight="normal",this._rowContainer.setAttribute("aria-hidden","true"),this._refreshRowElements(this._bufferService.cols,this._bufferService.rows),this._selectionContainer=document.createElement("div"),this._selectionContainer.classList.add(S),this._selectionContainer.setAttribute("aria-hidden","true"),this.dimensions=(0,w.createRenderDimensions)(),this._updateDimensions(),this.register(this._optionsService.onOptionChange((()=>this._handleOptionsChanged()))),this.register(this._themeService.onChangeColors((N=>this._injectCss(N)))),this._injectCss(this._themeService.colors),this._rowFactory=M.createInstance(d.DomRendererRowFactory,document),this._element.classList.add(_+this._terminalClass),this._screenElement.appendChild(this._rowContainer),this._screenElement.appendChild(this._selectionContainer),this.register(this._linkifier2.onShowLinkUnderline((N=>this._handleLinkHover(N)))),this.register(this._linkifier2.onHideLinkUnderline((N=>this._handleLinkLeave(N)))),this.register((0,c.toDisposable)((()=>{this._element.classList.remove(_+this._terminalClass),this._rowContainer.remove(),this._selectionContainer.remove(),this._widthCache.dispose(),this._themeStyleElement.remove(),this._dimensionsStyleElement.remove()}))),this._widthCache=new f.WidthCache(document),this._widthCache.setFont(this._optionsService.rawOptions.fontFamily,this._optionsService.rawOptions.fontSize,this._optionsService.rawOptions.fontWeight,this._optionsService.rawOptions.fontWeightBold),this._setDefaultSpacing()}_updateDimensions(){let T=this._coreBrowserService.dpr;this.dimensions.device.char.width=this._charSizeService.width*T,this.dimensions.device.char.height=Math.ceil(this._charSizeService.height*T),this.dimensions.device.cell.width=this.dimensions.device.char.width+Math.round(this._optionsService.rawOptions.letterSpacing),this.dimensions.device.cell.height=Math.floor(this.dimensions.device.char.height*this._optionsService.rawOptions.lineHeight),this.dimensions.device.char.left=0,this.dimensions.device.char.top=0,this.dimensions.device.canvas.width=this.dimensions.device.cell.width*this._bufferService.cols,this.dimensions.device.canvas.height=this.dimensions.device.cell.height*this._bufferService.rows,this.dimensions.css.canvas.width=Math.round(this.dimensions.device.canvas.width/T),this.dimensions.css.canvas.height=Math.round(this.dimensions.device.canvas.height/T),this.dimensions.css.cell.width=this.dimensions.css.canvas.width/this._bufferService.cols,this.dimensions.css.cell.height=this.dimensions.css.canvas.height/this._bufferService.rows;for(let z of this._rowElements)z.style.width=`${this.dimensions.css.canvas.width}px`,z.style.height=`${this.dimensions.css.cell.height}px`,z.style.lineHeight=`${this.dimensions.css.cell.height}px`,z.style.overflow="hidden";this._dimensionsStyleElement||(this._dimensionsStyleElement=document.createElement("style"),this._screenElement.appendChild(this._dimensionsStyleElement));let O=`${this._terminalSelector} .${v} span { display: inline-block; height: 100%; vertical-align: top;}`;this._dimensionsStyleElement.textContent=O,this._selectionContainer.style.height=this._viewportElement.style.height,this._screenElement.style.width=`${this.dimensions.css.canvas.width}px`,this._screenElement.style.height=`${this.dimensions.css.canvas.height}px`}_injectCss(T){this._themeStyleElement||(this._themeStyleElement=document.createElement("style"),this._screenElement.appendChild(this._themeStyleElement));let O=`${this._terminalSelector} .${v} { color: ${T.foreground.css}; font-family: ${this._optionsService.rawOptions.fontFamily}; font-size: ${this._optionsService.rawOptions.fontSize}px; font-kerning: none; white-space: pre}`;O+=`${this._terminalSelector} .${v} .xterm-dim { color: ${o.color.multiplyOpacity(T.foreground,.5).css};}`,O+=`${this._terminalSelector} span:not(.xterm-bold) { font-weight: ${this._optionsService.rawOptions.fontWeight};}${this._terminalSelector} span.xterm-bold { font-weight: ${this._optionsService.rawOptions.fontWeightBold};}${this._terminalSelector} span.xterm-italic { font-style: italic;}`,O+="@keyframes blink_box_shadow_"+this._terminalClass+" { 50% {  border-bottom-style: hidden; }}",O+="@keyframes blink_block_"+this._terminalClass+` { 0% {  background-color: ${T.cursor.css};  color: ${T.cursorAccent.css}; } 50% {  background-color: inherit;  color: ${T.cursor.css}; }}`,O+=`${this._terminalSelector} .${v}.${m} .xterm-cursor.xterm-cursor-blink:not(.xterm-cursor-block) { animation: blink_box_shadow_`+this._terminalClass+` 1s step-end infinite;}${this._terminalSelector} .${v}.${m} .xterm-cursor.xterm-cursor-blink.xterm-cursor-block { animation: blink_block_`+this._terminalClass+` 1s step-end infinite;}${this._terminalSelector} .${v} .xterm-cursor.xterm-cursor-block { background-color: ${T.cursor.css}; color: ${T.cursorAccent.css};}${this._terminalSelector} .${v} .xterm-cursor.xterm-cursor-outline { outline: 1px solid ${T.cursor.css}; outline-offset: -1px;}${this._terminalSelector} .${v} .xterm-cursor.xterm-cursor-bar { box-shadow: ${this._optionsService.rawOptions.cursorWidth}px 0 0 ${T.cursor.css} inset;}${this._terminalSelector} .${v} .xterm-cursor.xterm-cursor-underline { border-bottom: 1px ${T.cursor.css}; border-bottom-style: solid; height: calc(100% - 1px);}`,O+=`${this._terminalSelector} .${S} { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none;}${this._terminalSelector}.focus .${S} div { position: absolute; background-color: ${T.selectionBackgroundOpaque.css};}${this._terminalSelector} .${S} div { position: absolute; background-color: ${T.selectionInactiveBackgroundOpaque.css};}`;for(let[z,B]of T.ansi.entries())O+=`${this._terminalSelector} .${y}${z} { color: ${B.css}; }${this._terminalSelector} .${y}${z}.xterm-dim { color: ${o.color.multiplyOpacity(B,.5).css}; }${this._terminalSelector} .${C}${z} { background-color: ${B.css}; }`;O+=`${this._terminalSelector} .${y}${g.INVERTED_DEFAULT_COLOR} { color: ${o.color.opaque(T.background).css}; }${this._terminalSelector} .${y}${g.INVERTED_DEFAULT_COLOR}.xterm-dim { color: ${o.color.multiplyOpacity(o.color.opaque(T.background),.5).css}; }${this._terminalSelector} .${C}${g.INVERTED_DEFAULT_COLOR} { background-color: ${T.foreground.css}; }`,this._themeStyleElement.textContent=O}_setDefaultSpacing(){let T=this.dimensions.css.cell.width-this._widthCache.get("W",!1,!1);this._rowContainer.style.letterSpacing=`${T}px`,this._rowFactory.defaultSpacing=T}handleDevicePixelRatioChange(){this._updateDimensions(),this._widthCache.clear(),this._setDefaultSpacing()}_refreshRowElements(T,O){for(let z=this._rowElements.length;z<=O;z++){let B=document.createElement("div");this._rowContainer.appendChild(B),this._rowElements.push(B)}for(;this._rowElements.length>O;)this._rowContainer.removeChild(this._rowElements.pop())}handleResize(T,O){this._refreshRowElements(T,O),this._updateDimensions()}handleCharSizeChanged(){this._updateDimensions(),this._widthCache.clear(),this._setDefaultSpacing()}handleBlur(){this._rowContainer.classList.remove(m)}handleFocus(){this._rowContainer.classList.add(m),this.renderRows(this._bufferService.buffer.y,this._bufferService.buffer.y)}handleSelectionChanged(T,O,z){if(this._selectionContainer.replaceChildren(),this._rowFactory.handleSelectionChanged(T,O,z),this.renderRows(0,this._bufferService.rows-1),!T||!O)return;let B=T[1]-this._bufferService.buffer.ydisp,M=O[1]-this._bufferService.buffer.ydisp,H=Math.max(B,0),x=Math.min(M,this._bufferService.rows-1);if(H>=this._bufferService.rows||x<0)return;let E=document.createDocumentFragment();if(z){let A=T[0]>O[0];E.appendChild(this._createSelectionElement(H,A?O[0]:T[0],A?T[0]:O[0],x-H+1))}else{let A=B===H?T[0]:0,R=H===M?O[0]:this._bufferService.cols;E.appendChild(this._createSelectionElement(H,A,R));let N=x-H-1;if(E.appendChild(this._createSelectionElement(H+1,0,this._bufferService.cols,N)),H!==x){let j=M===x?O[0]:this._bufferService.cols;E.appendChild(this._createSelectionElement(x,0,j))}}this._selectionContainer.appendChild(E)}_createSelectionElement(T,O,z,B=1){let M=document.createElement("div");return M.style.height=B*this.dimensions.css.cell.height+"px",M.style.top=T*this.dimensions.css.cell.height+"px",M.style.left=O*this.dimensions.css.cell.width+"px",M.style.width=this.dimensions.css.cell.width*(z-O)+"px",M}handleCursorMove(){}_handleOptionsChanged(){this._updateDimensions(),this._injectCss(this._themeService.colors),this._widthCache.setFont(this._optionsService.rawOptions.fontFamily,this._optionsService.rawOptions.fontSize,this._optionsService.rawOptions.fontWeight,this._optionsService.rawOptions.fontWeightBold),this._setDefaultSpacing()}clear(){for(let T of this._rowElements)T.replaceChildren()}renderRows(T,O){let z=this._bufferService.buffer,B=z.ybase+z.y,M=Math.min(z.x,this._bufferService.cols-1),H=this._optionsService.rawOptions.cursorBlink,x=this._optionsService.rawOptions.cursorStyle,E=this._optionsService.rawOptions.cursorInactiveStyle;for(let A=T;A<=O;A++){let R=A+z.ydisp,N=this._rowElements[A],j=z.lines.get(R);if(!N||!j)break;N.replaceChildren(...this._rowFactory.createRow(j,R,R===B,x,E,M,H,this.dimensions.css.cell.width,this._widthCache,-1,-1))}}get _terminalSelector(){return`.${_}${this._terminalClass}`}_handleLinkHover(T){this._setCellUnderline(T.x1,T.x2,T.y1,T.y2,T.cols,!0)}_handleLinkLeave(T){this._setCellUnderline(T.x1,T.x2,T.y1,T.y2,T.cols,!1)}_setCellUnderline(T,O,z,B,M,H){z<0&&(T=0),B<0&&(O=0);let x=this._bufferService.rows-1;z=Math.max(Math.min(z,x),0),B=Math.max(Math.min(B,x),0),M=Math.min(M,this._bufferService.cols);let E=this._bufferService.buffer,A=E.ybase+E.y,R=Math.min(E.x,M-1),N=this._optionsService.rawOptions.cursorBlink,j=this._optionsService.rawOptions.cursorStyle,X=this._optionsService.rawOptions.cursorInactiveStyle;for(let K=z;K<=B;++K){let he=K+E.ydisp,k=this._rowElements[K],F=E.lines.get(he);if(!k||!F)break;k.replaceChildren(...this._rowFactory.createRow(F,he,he===A,j,X,R,N,this.dimensions.css.cell.width,this._widthCache,H?K===z?T:0:-1,H?(K===B?O:M)-1:-1))}}};i.DomRenderer=$=l([p(4,h.IInstantiationService),p(5,b.ICharSizeService),p(6,h.IOptionsService),p(7,h.IBufferService),p(8,b.ICoreBrowserService),p(9,b.IThemeService)],$)},3787:function(u,i,r){var l=this&&this.__decorate||function(y,C,m,S){var L,$=arguments.length,T=$<3?C:S===null?S=Object.getOwnPropertyDescriptor(C,m):S;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")T=Reflect.decorate(y,C,m,S);else for(var O=y.length-1;O>=0;O--)(L=y[O])&&(T=($<3?L(T):$>3?L(C,m,T):L(C,m))||T);return $>3&&T&&Object.defineProperty(C,m,T),T},p=this&&this.__param||function(y,C){return function(m,S){C(m,S,y)}};Object.defineProperty(i,"__esModule",{value:!0}),i.DomRendererRowFactory=void 0;let d=r(2223),f=r(643),g=r(511),w=r(2585),b=r(8055),o=r(4725),a=r(4269),c=r(6171),h=r(3734),_=i.DomRendererRowFactory=class{constructor(y,C,m,S,L,$,T){this._document=y,this._characterJoinerService=C,this._optionsService=m,this._coreBrowserService=S,this._coreService=L,this._decorationService=$,this._themeService=T,this._workCell=new g.CellData,this._columnSelectMode=!1,this.defaultSpacing=0}handleSelectionChanged(y,C,m){this._selectionStart=y,this._selectionEnd=C,this._columnSelectMode=m}createRow(y,C,m,S,L,$,T,O,z,B,M){let H=[],x=this._characterJoinerService.getJoinedCharacters(C),E=this._themeService.colors,A,R=y.getNoBgTrimmedLength();m&&R<$+1&&(R=$+1);let N=0,j="",X=0,K=0,he=0,k=!1,F=0,U=!1,W=0,ee=[],q=B!==-1&&M!==-1;for(let de=0;de<R;de++){y.loadCell(de,this._workCell);let Ae=this._workCell.getWidth();if(Ae===0)continue;let Ie=!1,ri=de,ae=this._workCell;if(x.length>0&&de===x[0][0]){Ie=!0;let ve=x.shift();ae=new a.JoinedCellData(this._workCell,y.translateToString(!0,ve[0],ve[1]),ve[1]-ve[0]),ri=ve[1]-1,Ae=ae.getWidth()}let Ti=this._isCellInSelection(de,C),cr=m&&de===$,hr=q&&de>=B&&de<=M,dr=!1;this._decorationService.forEachDecorationAtCell(de,C,void 0,(ve=>{dr=!0}));let fs=ae.getChars()||f.WHITESPACE_CELL_CHAR;if(fs===" "&&(ae.isUnderline()||ae.isOverline())&&(fs="\xA0"),W=Ae*O-z.get(fs,ae.isBold(),ae.isItalic()),A){if(N&&(Ti&&U||!Ti&&!U&&ae.bg===X)&&(Ti&&U&&E.selectionForeground||ae.fg===K)&&ae.extended.ext===he&&hr===k&&W===F&&!cr&&!Ie&&!dr){j+=fs,N++;continue}N&&(A.textContent=j),A=this._document.createElement("span"),N=0,j=""}else A=this._document.createElement("span");if(X=ae.bg,K=ae.fg,he=ae.extended.ext,k=hr,F=W,U=Ti,Ie&&$>=de&&$<=ri&&($=de),!this._coreService.isCursorHidden&&cr){if(ee.push("xterm-cursor"),this._coreBrowserService.isFocused)T&&ee.push("xterm-cursor-blink"),ee.push(S==="bar"?"xterm-cursor-bar":S==="underline"?"xterm-cursor-underline":"xterm-cursor-block");else if(L)switch(L){case"outline":ee.push("xterm-cursor-outline");break;case"block":ee.push("xterm-cursor-block");break;case"bar":ee.push("xterm-cursor-bar");break;case"underline":ee.push("xterm-cursor-underline")}}if(ae.isBold()&&ee.push("xterm-bold"),ae.isItalic()&&ee.push("xterm-italic"),ae.isDim()&&ee.push("xterm-dim"),j=ae.isInvisible()?f.WHITESPACE_CELL_CHAR:ae.getChars()||f.WHITESPACE_CELL_CHAR,ae.isUnderline()&&(ee.push(`xterm-underline-${ae.extended.underlineStyle}`),j===" "&&(j="\xA0"),!ae.isUnderlineColorDefault()))if(ae.isUnderlineColorRGB())A.style.textDecorationColor=`rgb(${h.AttributeData.toColorRGB(ae.getUnderlineColor()).join(",")})`;else{let ve=ae.getUnderlineColor();this._optionsService.rawOptions.drawBoldTextInBrightColors&&ae.isBold()&&ve<8&&(ve+=8),A.style.textDecorationColor=E.ansi[ve].css}ae.isOverline()&&(ee.push("xterm-overline"),j===" "&&(j="\xA0")),ae.isStrikethrough()&&ee.push("xterm-strikethrough"),hr&&(A.style.textDecoration="underline");let We=ae.getFgColor(),Di=ae.getFgColorMode(),et=ae.getBgColor(),Ri=ae.getBgColorMode(),ur=!!ae.isInverse();if(ur){let ve=We;We=et,et=ve;let sc=Di;Di=Ri,Ri=sc}let bt,pr,yt,$i=!1;switch(this._decorationService.forEachDecorationAtCell(de,C,void 0,(ve=>{ve.options.layer!=="top"&&$i||(ve.backgroundColorRGB&&(Ri=50331648,et=ve.backgroundColorRGB.rgba>>8&16777215,bt=ve.backgroundColorRGB),ve.foregroundColorRGB&&(Di=50331648,We=ve.foregroundColorRGB.rgba>>8&16777215,pr=ve.foregroundColorRGB),$i=ve.options.layer==="top")})),!$i&&Ti&&(bt=this._coreBrowserService.isFocused?E.selectionBackgroundOpaque:E.selectionInactiveBackgroundOpaque,et=bt.rgba>>8&16777215,Ri=50331648,$i=!0,E.selectionForeground&&(Di=50331648,We=E.selectionForeground.rgba>>8&16777215,pr=E.selectionForeground)),$i&&ee.push("xterm-decoration-top"),Ri){case 16777216:case 33554432:yt=E.ansi[et],ee.push(`xterm-bg-${et}`);break;case 50331648:yt=b.rgba.toColor(et>>16,et>>8&255,255&et),this._addStyle(A,`background-color:#${v((et>>>0).toString(16),"0",6)}`);break;default:ur?(yt=E.foreground,ee.push(`xterm-bg-${d.INVERTED_DEFAULT_COLOR}`)):yt=E.background}switch(bt||ae.isDim()&&(bt=b.color.multiplyOpacity(yt,.5)),Di){case 16777216:case 33554432:ae.isBold()&&We<8&&this._optionsService.rawOptions.drawBoldTextInBrightColors&&(We+=8),this._applyMinimumContrast(A,yt,E.ansi[We],ae,bt,void 0)||ee.push(`xterm-fg-${We}`);break;case 50331648:let ve=b.rgba.toColor(We>>16&255,We>>8&255,255&We);this._applyMinimumContrast(A,yt,ve,ae,bt,pr)||this._addStyle(A,`color:#${v(We.toString(16),"0",6)}`);break;default:this._applyMinimumContrast(A,yt,E.foreground,ae,bt,void 0)||ur&&ee.push(`xterm-fg-${d.INVERTED_DEFAULT_COLOR}`)}ee.length&&(A.className=ee.join(" "),ee.length=0),cr||Ie||dr?A.textContent=j:N++,W!==this.defaultSpacing&&(A.style.letterSpacing=`${W}px`),H.push(A),de=ri}return A&&N&&(A.textContent=j),H}_applyMinimumContrast(y,C,m,S,L,$){if(this._optionsService.rawOptions.minimumContrastRatio===1||(0,c.excludeFromContrastRatioDemands)(S.getCode()))return!1;let T=this._getContrastCache(S),O;if(L||$||(O=T.getColor(C.rgba,m.rgba)),O===void 0){let z=this._optionsService.rawOptions.minimumContrastRatio/(S.isDim()?2:1);O=b.color.ensureContrastRatio(L||C,$||m,z),T.setColor((L||C).rgba,($||m).rgba,O??null)}return!!O&&(this._addStyle(y,`color:${O.css}`),!0)}_getContrastCache(y){return y.isDim()?this._themeService.colors.halfContrastCache:this._themeService.colors.contrastCache}_addStyle(y,C){y.setAttribute("style",`${y.getAttribute("style")||""}${C};`)}_isCellInSelection(y,C){let m=this._selectionStart,S=this._selectionEnd;return!(!m||!S)&&(this._columnSelectMode?m[0]<=S[0]?y>=m[0]&&C>=m[1]&&y<S[0]&&C<=S[1]:y<m[0]&&C>=m[1]&&y>=S[0]&&C<=S[1]:C>m[1]&&C<S[1]||m[1]===S[1]&&C===m[1]&&y>=m[0]&&y<S[0]||m[1]<S[1]&&C===S[1]&&y<S[0]||m[1]<S[1]&&C===m[1]&&y>=m[0])}};function v(y,C,m){for(;y.length<m;)y=C+y;return y}i.DomRendererRowFactory=_=l([p(1,o.ICharacterJoinerService),p(2,w.IOptionsService),p(3,o.ICoreBrowserService),p(4,w.ICoreService),p(5,w.IDecorationService),p(6,o.IThemeService)],_)},2550:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.WidthCache=void 0,i.WidthCache=class{constructor(r){this._flat=new Float32Array(256),this._font="",this._fontSize=0,this._weight="normal",this._weightBold="bold",this._measureElements=[],this._container=r.createElement("div"),this._container.style.position="absolute",this._container.style.top="-50000px",this._container.style.width="50000px",this._container.style.whiteSpace="pre",this._container.style.fontKerning="none";let l=r.createElement("span"),p=r.createElement("span");p.style.fontWeight="bold";let d=r.createElement("span");d.style.fontStyle="italic";let f=r.createElement("span");f.style.fontWeight="bold",f.style.fontStyle="italic",this._measureElements=[l,p,d,f],this._container.appendChild(l),this._container.appendChild(p),this._container.appendChild(d),this._container.appendChild(f),r.body.appendChild(this._container),this.clear()}dispose(){this._container.remove(),this._measureElements.length=0,this._holey=void 0}clear(){this._flat.fill(-9999),this._holey=new Map}setFont(r,l,p,d){r===this._font&&l===this._fontSize&&p===this._weight&&d===this._weightBold||(this._font=r,this._fontSize=l,this._weight=p,this._weightBold=d,this._container.style.fontFamily=this._font,this._container.style.fontSize=`${this._fontSize}px`,this._measureElements[0].style.fontWeight=`${p}`,this._measureElements[1].style.fontWeight=`${d}`,this._measureElements[2].style.fontWeight=`${p}`,this._measureElements[3].style.fontWeight=`${d}`,this.clear())}get(r,l,p){let d=0;if(!l&&!p&&r.length===1&&(d=r.charCodeAt(0))<256)return this._flat[d]!==-9999?this._flat[d]:this._flat[d]=this._measure(r,0);let f=r;l&&(f+="B"),p&&(f+="I");let g=this._holey.get(f);if(g===void 0){let w=0;l&&(w|=1),p&&(w|=2),g=this._measure(r,w),this._holey.set(f,g)}return g}_measure(r,l){let p=this._measureElements[l];return p.textContent=r.repeat(32),p.offsetWidth/32}}},2223:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.TEXT_BASELINE=i.DIM_OPACITY=i.INVERTED_DEFAULT_COLOR=void 0;let l=r(6114);i.INVERTED_DEFAULT_COLOR=257,i.DIM_OPACITY=.5,i.TEXT_BASELINE=l.isFirefox||l.isLegacyEdge?"bottom":"ideographic"},6171:(u,i)=>{function r(l){return 57508<=l&&l<=57558}Object.defineProperty(i,"__esModule",{value:!0}),i.createRenderDimensions=i.excludeFromContrastRatioDemands=i.isRestrictedPowerlineGlyph=i.isPowerlineGlyph=i.throwIfFalsy=void 0,i.throwIfFalsy=function(l){if(!l)throw new Error("value must not be falsy");return l},i.isPowerlineGlyph=r,i.isRestrictedPowerlineGlyph=function(l){return 57520<=l&&l<=57527},i.excludeFromContrastRatioDemands=function(l){return r(l)||(function(p){return 9472<=p&&p<=9631})(l)},i.createRenderDimensions=function(){return{css:{canvas:{width:0,height:0},cell:{width:0,height:0}},device:{canvas:{width:0,height:0},cell:{width:0,height:0},char:{width:0,height:0,left:0,top:0}}}}},456:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.SelectionModel=void 0,i.SelectionModel=class{constructor(r){this._bufferService=r,this.isSelectAllActive=!1,this.selectionStartLength=0}clearSelection(){this.selectionStart=void 0,this.selectionEnd=void 0,this.isSelectAllActive=!1,this.selectionStartLength=0}get finalSelectionStart(){return this.isSelectAllActive?[0,0]:this.selectionEnd&&this.selectionStart&&this.areSelectionValuesReversed()?this.selectionEnd:this.selectionStart}get finalSelectionEnd(){if(this.isSelectAllActive)return[this._bufferService.cols,this._bufferService.buffer.ybase+this._bufferService.rows-1];if(this.selectionStart){if(!this.selectionEnd||this.areSelectionValuesReversed()){let r=this.selectionStart[0]+this.selectionStartLength;return r>this._bufferService.cols?r%this._bufferService.cols==0?[this._bufferService.cols,this.selectionStart[1]+Math.floor(r/this._bufferService.cols)-1]:[r%this._bufferService.cols,this.selectionStart[1]+Math.floor(r/this._bufferService.cols)]:[r,this.selectionStart[1]]}if(this.selectionStartLength&&this.selectionEnd[1]===this.selectionStart[1]){let r=this.selectionStart[0]+this.selectionStartLength;return r>this._bufferService.cols?[r%this._bufferService.cols,this.selectionStart[1]+Math.floor(r/this._bufferService.cols)]:[Math.max(r,this.selectionEnd[0]),this.selectionEnd[1]]}return this.selectionEnd}}areSelectionValuesReversed(){let r=this.selectionStart,l=this.selectionEnd;return!(!r||!l)&&(r[1]>l[1]||r[1]===l[1]&&r[0]>l[0])}handleTrim(r){return this.selectionStart&&(this.selectionStart[1]-=r),this.selectionEnd&&(this.selectionEnd[1]-=r),this.selectionEnd&&this.selectionEnd[1]<0?(this.clearSelection(),!0):(this.selectionStart&&this.selectionStart[1]<0&&(this.selectionStart[1]=0),!1)}}},428:function(u,i,r){var l=this&&this.__decorate||function(o,a,c,h){var _,v=arguments.length,y=v<3?a:h===null?h=Object.getOwnPropertyDescriptor(a,c):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(o,a,c,h);else for(var C=o.length-1;C>=0;C--)(_=o[C])&&(y=(v<3?_(y):v>3?_(a,c,y):_(a,c))||y);return v>3&&y&&Object.defineProperty(a,c,y),y},p=this&&this.__param||function(o,a){return function(c,h){a(c,h,o)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CharSizeService=void 0;let d=r(2585),f=r(8460),g=r(844),w=i.CharSizeService=class extends g.Disposable{get hasValidSize(){return this.width>0&&this.height>0}constructor(o,a,c){super(),this._optionsService=c,this.width=0,this.height=0,this._onCharSizeChange=this.register(new f.EventEmitter),this.onCharSizeChange=this._onCharSizeChange.event,this._measureStrategy=new b(o,a,this._optionsService),this.register(this._optionsService.onMultipleOptionChange(["fontFamily","fontSize"],(()=>this.measure())))}measure(){let o=this._measureStrategy.measure();o.width===this.width&&o.height===this.height||(this.width=o.width,this.height=o.height,this._onCharSizeChange.fire())}};i.CharSizeService=w=l([p(2,d.IOptionsService)],w);class b{constructor(a,c,h){this._document=a,this._parentElement=c,this._optionsService=h,this._result={width:0,height:0},this._measureElement=this._document.createElement("span"),this._measureElement.classList.add("xterm-char-measure-element"),this._measureElement.textContent="W".repeat(32),this._measureElement.setAttribute("aria-hidden","true"),this._measureElement.style.whiteSpace="pre",this._measureElement.style.fontKerning="none",this._parentElement.appendChild(this._measureElement)}measure(){this._measureElement.style.fontFamily=this._optionsService.rawOptions.fontFamily,this._measureElement.style.fontSize=`${this._optionsService.rawOptions.fontSize}px`;let a={height:Number(this._measureElement.offsetHeight),width:Number(this._measureElement.offsetWidth)};return a.width!==0&&a.height!==0&&(this._result.width=a.width/32,this._result.height=Math.ceil(a.height)),this._result}}},4269:function(u,i,r){var l=this&&this.__decorate||function(a,c,h,_){var v,y=arguments.length,C=y<3?c:_===null?_=Object.getOwnPropertyDescriptor(c,h):_;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")C=Reflect.decorate(a,c,h,_);else for(var m=a.length-1;m>=0;m--)(v=a[m])&&(C=(y<3?v(C):y>3?v(c,h,C):v(c,h))||C);return y>3&&C&&Object.defineProperty(c,h,C),C},p=this&&this.__param||function(a,c){return function(h,_){c(h,_,a)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CharacterJoinerService=i.JoinedCellData=void 0;let d=r(3734),f=r(643),g=r(511),w=r(2585);class b extends d.AttributeData{constructor(c,h,_){super(),this.content=0,this.combinedData="",this.fg=c.fg,this.bg=c.bg,this.combinedData=h,this._width=_}isCombined(){return 2097152}getWidth(){return this._width}getChars(){return this.combinedData}getCode(){return 2097151}setFromCharData(c){throw new Error("not implemented")}getAsCharData(){return[this.fg,this.getChars(),this.getWidth(),this.getCode()]}}i.JoinedCellData=b;let o=i.CharacterJoinerService=class Ln{constructor(c){this._bufferService=c,this._characterJoiners=[],this._nextCharacterJoinerId=0,this._workCell=new g.CellData}register(c){let h={id:this._nextCharacterJoinerId++,handler:c};return this._characterJoiners.push(h),h.id}deregister(c){for(let h=0;h<this._characterJoiners.length;h++)if(this._characterJoiners[h].id===c)return this._characterJoiners.splice(h,1),!0;return!1}getJoinedCharacters(c){if(this._characterJoiners.length===0)return[];let h=this._bufferService.buffer.lines.get(c);if(!h||h.length===0)return[];let _=[],v=h.translateToString(!0),y=0,C=0,m=0,S=h.getFg(0),L=h.getBg(0);for(let $=0;$<h.getTrimmedLength();$++)if(h.loadCell($,this._workCell),this._workCell.getWidth()!==0){if(this._workCell.fg!==S||this._workCell.bg!==L){if($-y>1){let T=this._getJoinedRanges(v,m,C,h,y);for(let O=0;O<T.length;O++)_.push(T[O])}y=$,m=C,S=this._workCell.fg,L=this._workCell.bg}C+=this._workCell.getChars().length||f.WHITESPACE_CELL_CHAR.length}if(this._bufferService.cols-y>1){let $=this._getJoinedRanges(v,m,C,h,y);for(let T=0;T<$.length;T++)_.push($[T])}return _}_getJoinedRanges(c,h,_,v,y){let C=c.substring(h,_),m=[];try{m=this._characterJoiners[0].handler(C)}catch(S){console.error(S)}for(let S=1;S<this._characterJoiners.length;S++)try{let L=this._characterJoiners[S].handler(C);for(let $=0;$<L.length;$++)Ln._mergeRanges(m,L[$])}catch(L){console.error(L)}return this._stringRangesToCellRanges(m,v,y),m}_stringRangesToCellRanges(c,h,_){let v=0,y=!1,C=0,m=c[v];if(m){for(let S=_;S<this._bufferService.cols;S++){let L=h.getWidth(S),$=h.getString(S).length||f.WHITESPACE_CELL_CHAR.length;if(L!==0){if(!y&&m[0]<=C&&(m[0]=S,y=!0),m[1]<=C){if(m[1]=S,m=c[++v],!m)break;m[0]<=C?(m[0]=S,y=!0):y=!1}C+=$}}m&&(m[1]=this._bufferService.cols)}}static _mergeRanges(c,h){let _=!1;for(let v=0;v<c.length;v++){let y=c[v];if(_){if(h[1]<=y[0])return c[v-1][1]=h[1],c;if(h[1]<=y[1])return c[v-1][1]=Math.max(h[1],y[1]),c.splice(v,1),c;c.splice(v,1),v--}else{if(h[1]<=y[0])return c.splice(v,0,h),c;if(h[1]<=y[1])return y[0]=Math.min(h[0],y[0]),c;h[0]<y[1]&&(y[0]=Math.min(h[0],y[0]),_=!0)}}return _?c[c.length-1][1]=h[1]:c.push(h),c}};i.CharacterJoinerService=o=l([p(0,w.IBufferService)],o)},5114:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CoreBrowserService=void 0,i.CoreBrowserService=class{constructor(r,l){this._textarea=r,this.window=l,this._isFocused=!1,this._cachedIsFocused=void 0,this._textarea.addEventListener("focus",(()=>this._isFocused=!0)),this._textarea.addEventListener("blur",(()=>this._isFocused=!1))}get dpr(){return this.window.devicePixelRatio}get isFocused(){return this._cachedIsFocused===void 0&&(this._cachedIsFocused=this._isFocused&&this._textarea.ownerDocument.hasFocus(),queueMicrotask((()=>this._cachedIsFocused=void 0))),this._cachedIsFocused}}},8934:function(u,i,r){var l=this&&this.__decorate||function(w,b,o,a){var c,h=arguments.length,_=h<3?b:a===null?a=Object.getOwnPropertyDescriptor(b,o):a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")_=Reflect.decorate(w,b,o,a);else for(var v=w.length-1;v>=0;v--)(c=w[v])&&(_=(h<3?c(_):h>3?c(b,o,_):c(b,o))||_);return h>3&&_&&Object.defineProperty(b,o,_),_},p=this&&this.__param||function(w,b){return function(o,a){b(o,a,w)}};Object.defineProperty(i,"__esModule",{value:!0}),i.MouseService=void 0;let d=r(4725),f=r(9806),g=i.MouseService=class{constructor(w,b){this._renderService=w,this._charSizeService=b}getCoords(w,b,o,a,c){return(0,f.getCoords)(window,w,b,o,a,this._charSizeService.hasValidSize,this._renderService.dimensions.css.cell.width,this._renderService.dimensions.css.cell.height,c)}getMouseReportCoords(w,b){let o=(0,f.getCoordsRelativeToElement)(window,w,b);if(this._charSizeService.hasValidSize)return o[0]=Math.min(Math.max(o[0],0),this._renderService.dimensions.css.canvas.width-1),o[1]=Math.min(Math.max(o[1],0),this._renderService.dimensions.css.canvas.height-1),{col:Math.floor(o[0]/this._renderService.dimensions.css.cell.width),row:Math.floor(o[1]/this._renderService.dimensions.css.cell.height),x:Math.floor(o[0]),y:Math.floor(o[1])}}};i.MouseService=g=l([p(0,d.IRenderService),p(1,d.ICharSizeService)],g)},3230:function(u,i,r){var l=this&&this.__decorate||function(_,v,y,C){var m,S=arguments.length,L=S<3?v:C===null?C=Object.getOwnPropertyDescriptor(v,y):C;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")L=Reflect.decorate(_,v,y,C);else for(var $=_.length-1;$>=0;$--)(m=_[$])&&(L=(S<3?m(L):S>3?m(v,y,L):m(v,y))||L);return S>3&&L&&Object.defineProperty(v,y,L),L},p=this&&this.__param||function(_,v){return function(y,C){v(y,C,_)}};Object.defineProperty(i,"__esModule",{value:!0}),i.RenderService=void 0;let d=r(3656),f=r(6193),g=r(5596),w=r(4725),b=r(8460),o=r(844),a=r(7226),c=r(2585),h=i.RenderService=class extends o.Disposable{get dimensions(){return this._renderer.value.dimensions}constructor(_,v,y,C,m,S,L,$){if(super(),this._rowCount=_,this._charSizeService=C,this._renderer=this.register(new o.MutableDisposable),this._pausedResizeTask=new a.DebouncedIdleTask,this._isPaused=!1,this._needsFullRefresh=!1,this._isNextRenderRedrawOnly=!0,this._needsSelectionRefresh=!1,this._canvasWidth=0,this._canvasHeight=0,this._selectionState={start:void 0,end:void 0,columnSelectMode:!1},this._onDimensionsChange=this.register(new b.EventEmitter),this.onDimensionsChange=this._onDimensionsChange.event,this._onRenderedViewportChange=this.register(new b.EventEmitter),this.onRenderedViewportChange=this._onRenderedViewportChange.event,this._onRender=this.register(new b.EventEmitter),this.onRender=this._onRender.event,this._onRefreshRequest=this.register(new b.EventEmitter),this.onRefreshRequest=this._onRefreshRequest.event,this._renderDebouncer=new f.RenderDebouncer(L.window,((T,O)=>this._renderRows(T,O))),this.register(this._renderDebouncer),this._screenDprMonitor=new g.ScreenDprMonitor(L.window),this._screenDprMonitor.setListener((()=>this.handleDevicePixelRatioChange())),this.register(this._screenDprMonitor),this.register(S.onResize((()=>this._fullRefresh()))),this.register(S.buffers.onBufferActivate((()=>{var T;return(T=this._renderer.value)===null||T===void 0?void 0:T.clear()}))),this.register(y.onOptionChange((()=>this._handleOptionsChanged()))),this.register(this._charSizeService.onCharSizeChange((()=>this.handleCharSizeChanged()))),this.register(m.onDecorationRegistered((()=>this._fullRefresh()))),this.register(m.onDecorationRemoved((()=>this._fullRefresh()))),this.register(y.onMultipleOptionChange(["customGlyphs","drawBoldTextInBrightColors","letterSpacing","lineHeight","fontFamily","fontSize","fontWeight","fontWeightBold","minimumContrastRatio"],(()=>{this.clear(),this.handleResize(S.cols,S.rows),this._fullRefresh()}))),this.register(y.onMultipleOptionChange(["cursorBlink","cursorStyle"],(()=>this.refreshRows(S.buffer.y,S.buffer.y,!0)))),this.register((0,d.addDisposableDomListener)(L.window,"resize",(()=>this.handleDevicePixelRatioChange()))),this.register($.onChangeColors((()=>this._fullRefresh()))),"IntersectionObserver"in L.window){let T=new L.window.IntersectionObserver((O=>this._handleIntersectionChange(O[O.length-1])),{threshold:0});T.observe(v),this.register({dispose:()=>T.disconnect()})}}_handleIntersectionChange(_){this._isPaused=_.isIntersecting===void 0?_.intersectionRatio===0:!_.isIntersecting,this._isPaused||this._charSizeService.hasValidSize||this._charSizeService.measure(),!this._isPaused&&this._needsFullRefresh&&(this._pausedResizeTask.flush(),this.refreshRows(0,this._rowCount-1),this._needsFullRefresh=!1)}refreshRows(_,v,y=!1){this._isPaused?this._needsFullRefresh=!0:(y||(this._isNextRenderRedrawOnly=!1),this._renderDebouncer.refresh(_,v,this._rowCount))}_renderRows(_,v){this._renderer.value&&(_=Math.min(_,this._rowCount-1),v=Math.min(v,this._rowCount-1),this._renderer.value.renderRows(_,v),this._needsSelectionRefresh&&(this._renderer.value.handleSelectionChanged(this._selectionState.start,this._selectionState.end,this._selectionState.columnSelectMode),this._needsSelectionRefresh=!1),this._isNextRenderRedrawOnly||this._onRenderedViewportChange.fire({start:_,end:v}),this._onRender.fire({start:_,end:v}),this._isNextRenderRedrawOnly=!0)}resize(_,v){this._rowCount=v,this._fireOnCanvasResize()}_handleOptionsChanged(){this._renderer.value&&(this.refreshRows(0,this._rowCount-1),this._fireOnCanvasResize())}_fireOnCanvasResize(){this._renderer.value&&(this._renderer.value.dimensions.css.canvas.width===this._canvasWidth&&this._renderer.value.dimensions.css.canvas.height===this._canvasHeight||this._onDimensionsChange.fire(this._renderer.value.dimensions))}hasRenderer(){return!!this._renderer.value}setRenderer(_){this._renderer.value=_,this._renderer.value.onRequestRedraw((v=>this.refreshRows(v.start,v.end,!0))),this._needsSelectionRefresh=!0,this._fullRefresh()}addRefreshCallback(_){return this._renderDebouncer.addRefreshCallback(_)}_fullRefresh(){this._isPaused?this._needsFullRefresh=!0:this.refreshRows(0,this._rowCount-1)}clearTextureAtlas(){var _,v;this._renderer.value&&((v=(_=this._renderer.value).clearTextureAtlas)===null||v===void 0||v.call(_),this._fullRefresh())}handleDevicePixelRatioChange(){this._charSizeService.measure(),this._renderer.value&&(this._renderer.value.handleDevicePixelRatioChange(),this.refreshRows(0,this._rowCount-1))}handleResize(_,v){this._renderer.value&&(this._isPaused?this._pausedResizeTask.set((()=>this._renderer.value.handleResize(_,v))):this._renderer.value.handleResize(_,v),this._fullRefresh())}handleCharSizeChanged(){var _;(_=this._renderer.value)===null||_===void 0||_.handleCharSizeChanged()}handleBlur(){var _;(_=this._renderer.value)===null||_===void 0||_.handleBlur()}handleFocus(){var _;(_=this._renderer.value)===null||_===void 0||_.handleFocus()}handleSelectionChanged(_,v,y){var C;this._selectionState.start=_,this._selectionState.end=v,this._selectionState.columnSelectMode=y,(C=this._renderer.value)===null||C===void 0||C.handleSelectionChanged(_,v,y)}handleCursorMove(){var _;(_=this._renderer.value)===null||_===void 0||_.handleCursorMove()}clear(){var _;(_=this._renderer.value)===null||_===void 0||_.clear()}};i.RenderService=h=l([p(2,c.IOptionsService),p(3,w.ICharSizeService),p(4,c.IDecorationService),p(5,c.IBufferService),p(6,w.ICoreBrowserService),p(7,w.IThemeService)],h)},9312:function(u,i,r){var l=this&&this.__decorate||function(m,S,L,$){var T,O=arguments.length,z=O<3?S:$===null?$=Object.getOwnPropertyDescriptor(S,L):$;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")z=Reflect.decorate(m,S,L,$);else for(var B=m.length-1;B>=0;B--)(T=m[B])&&(z=(O<3?T(z):O>3?T(S,L,z):T(S,L))||z);return O>3&&z&&Object.defineProperty(S,L,z),z},p=this&&this.__param||function(m,S){return function(L,$){S(L,$,m)}};Object.defineProperty(i,"__esModule",{value:!0}),i.SelectionService=void 0;let d=r(9806),f=r(9504),g=r(456),w=r(4725),b=r(8460),o=r(844),a=r(6114),c=r(4841),h=r(511),_=r(2585),v="\xA0",y=new RegExp(v,"g"),C=i.SelectionService=class extends o.Disposable{constructor(m,S,L,$,T,O,z,B,M){super(),this._element=m,this._screenElement=S,this._linkifier=L,this._bufferService=$,this._coreService=T,this._mouseService=O,this._optionsService=z,this._renderService=B,this._coreBrowserService=M,this._dragScrollAmount=0,this._enabled=!0,this._workCell=new h.CellData,this._mouseDownTimeStamp=0,this._oldHasSelection=!1,this._oldSelectionStart=void 0,this._oldSelectionEnd=void 0,this._onLinuxMouseSelection=this.register(new b.EventEmitter),this.onLinuxMouseSelection=this._onLinuxMouseSelection.event,this._onRedrawRequest=this.register(new b.EventEmitter),this.onRequestRedraw=this._onRedrawRequest.event,this._onSelectionChange=this.register(new b.EventEmitter),this.onSelectionChange=this._onSelectionChange.event,this._onRequestScrollLines=this.register(new b.EventEmitter),this.onRequestScrollLines=this._onRequestScrollLines.event,this._mouseMoveListener=H=>this._handleMouseMove(H),this._mouseUpListener=H=>this._handleMouseUp(H),this._coreService.onUserInput((()=>{this.hasSelection&&this.clearSelection()})),this._trimListener=this._bufferService.buffer.lines.onTrim((H=>this._handleTrim(H))),this.register(this._bufferService.buffers.onBufferActivate((H=>this._handleBufferActivate(H)))),this.enable(),this._model=new g.SelectionModel(this._bufferService),this._activeSelectionMode=0,this.register((0,o.toDisposable)((()=>{this._removeMouseDownListeners()})))}reset(){this.clearSelection()}disable(){this.clearSelection(),this._enabled=!1}enable(){this._enabled=!0}get selectionStart(){return this._model.finalSelectionStart}get selectionEnd(){return this._model.finalSelectionEnd}get hasSelection(){let m=this._model.finalSelectionStart,S=this._model.finalSelectionEnd;return!(!m||!S||m[0]===S[0]&&m[1]===S[1])}get selectionText(){let m=this._model.finalSelectionStart,S=this._model.finalSelectionEnd;if(!m||!S)return"";let L=this._bufferService.buffer,$=[];if(this._activeSelectionMode===3){if(m[0]===S[0])return"";let T=m[0]<S[0]?m[0]:S[0],O=m[0]<S[0]?S[0]:m[0];for(let z=m[1];z<=S[1];z++){let B=L.translateBufferLineToString(z,!0,T,O);$.push(B)}}else{let T=m[1]===S[1]?S[0]:void 0;$.push(L.translateBufferLineToString(m[1],!0,m[0],T));for(let O=m[1]+1;O<=S[1]-1;O++){let z=L.lines.get(O),B=L.translateBufferLineToString(O,!0);z?.isWrapped?$[$.length-1]+=B:$.push(B)}if(m[1]!==S[1]){let O=L.lines.get(S[1]),z=L.translateBufferLineToString(S[1],!0,0,S[0]);O&&O.isWrapped?$[$.length-1]+=z:$.push(z)}}return $.map((T=>T.replace(y," "))).join(a.isWindows?`\r
`:`
`)}clearSelection(){this._model.clearSelection(),this._removeMouseDownListeners(),this.refresh(),this._onSelectionChange.fire()}refresh(m){this._refreshAnimationFrame||(this._refreshAnimationFrame=this._coreBrowserService.window.requestAnimationFrame((()=>this._refresh()))),a.isLinux&&m&&this.selectionText.length&&this._onLinuxMouseSelection.fire(this.selectionText)}_refresh(){this._refreshAnimationFrame=void 0,this._onRedrawRequest.fire({start:this._model.finalSelectionStart,end:this._model.finalSelectionEnd,columnSelectMode:this._activeSelectionMode===3})}_isClickInSelection(m){let S=this._getMouseBufferCoords(m),L=this._model.finalSelectionStart,$=this._model.finalSelectionEnd;return!!(L&&$&&S)&&this._areCoordsInSelection(S,L,$)}isCellInSelection(m,S){let L=this._model.finalSelectionStart,$=this._model.finalSelectionEnd;return!(!L||!$)&&this._areCoordsInSelection([m,S],L,$)}_areCoordsInSelection(m,S,L){return m[1]>S[1]&&m[1]<L[1]||S[1]===L[1]&&m[1]===S[1]&&m[0]>=S[0]&&m[0]<L[0]||S[1]<L[1]&&m[1]===L[1]&&m[0]<L[0]||S[1]<L[1]&&m[1]===S[1]&&m[0]>=S[0]}_selectWordAtCursor(m,S){var L,$;let T=($=(L=this._linkifier.currentLink)===null||L===void 0?void 0:L.link)===null||$===void 0?void 0:$.range;if(T)return this._model.selectionStart=[T.start.x-1,T.start.y-1],this._model.selectionStartLength=(0,c.getRangeLength)(T,this._bufferService.cols),this._model.selectionEnd=void 0,!0;let O=this._getMouseBufferCoords(m);return!!O&&(this._selectWordAt(O,S),this._model.selectionEnd=void 0,!0)}selectAll(){this._model.isSelectAllActive=!0,this.refresh(),this._onSelectionChange.fire()}selectLines(m,S){this._model.clearSelection(),m=Math.max(m,0),S=Math.min(S,this._bufferService.buffer.lines.length-1),this._model.selectionStart=[0,m],this._model.selectionEnd=[this._bufferService.cols,S],this.refresh(),this._onSelectionChange.fire()}_handleTrim(m){this._model.handleTrim(m)&&this.refresh()}_getMouseBufferCoords(m){let S=this._mouseService.getCoords(m,this._screenElement,this._bufferService.cols,this._bufferService.rows,!0);if(S)return S[0]--,S[1]--,S[1]+=this._bufferService.buffer.ydisp,S}_getMouseEventScrollAmount(m){let S=(0,d.getCoordsRelativeToElement)(this._coreBrowserService.window,m,this._screenElement)[1],L=this._renderService.dimensions.css.canvas.height;return S>=0&&S<=L?0:(S>L&&(S-=L),S=Math.min(Math.max(S,-50),50),S/=50,S/Math.abs(S)+Math.round(14*S))}shouldForceSelection(m){return a.isMac?m.altKey&&this._optionsService.rawOptions.macOptionClickForcesSelection:m.shiftKey}handleMouseDown(m){if(this._mouseDownTimeStamp=m.timeStamp,(m.button!==2||!this.hasSelection)&&m.button===0){if(!this._enabled){if(!this.shouldForceSelection(m))return;m.stopPropagation()}m.preventDefault(),this._dragScrollAmount=0,this._enabled&&m.shiftKey?this._handleIncrementalClick(m):m.detail===1?this._handleSingleClick(m):m.detail===2?this._handleDoubleClick(m):m.detail===3&&this._handleTripleClick(m),this._addMouseDownListeners(),this.refresh(!0)}}_addMouseDownListeners(){this._screenElement.ownerDocument&&(this._screenElement.ownerDocument.addEventListener("mousemove",this._mouseMoveListener),this._screenElement.ownerDocument.addEventListener("mouseup",this._mouseUpListener)),this._dragScrollIntervalTimer=this._coreBrowserService.window.setInterval((()=>this._dragScroll()),50)}_removeMouseDownListeners(){this._screenElement.ownerDocument&&(this._screenElement.ownerDocument.removeEventListener("mousemove",this._mouseMoveListener),this._screenElement.ownerDocument.removeEventListener("mouseup",this._mouseUpListener)),this._coreBrowserService.window.clearInterval(this._dragScrollIntervalTimer),this._dragScrollIntervalTimer=void 0}_handleIncrementalClick(m){this._model.selectionStart&&(this._model.selectionEnd=this._getMouseBufferCoords(m))}_handleSingleClick(m){if(this._model.selectionStartLength=0,this._model.isSelectAllActive=!1,this._activeSelectionMode=this.shouldColumnSelect(m)?3:0,this._model.selectionStart=this._getMouseBufferCoords(m),!this._model.selectionStart)return;this._model.selectionEnd=void 0;let S=this._bufferService.buffer.lines.get(this._model.selectionStart[1]);S&&S.length!==this._model.selectionStart[0]&&S.hasWidth(this._model.selectionStart[0])===0&&this._model.selectionStart[0]++}_handleDoubleClick(m){this._selectWordAtCursor(m,!0)&&(this._activeSelectionMode=1)}_handleTripleClick(m){let S=this._getMouseBufferCoords(m);S&&(this._activeSelectionMode=2,this._selectLineAt(S[1]))}shouldColumnSelect(m){return m.altKey&&!(a.isMac&&this._optionsService.rawOptions.macOptionClickForcesSelection)}_handleMouseMove(m){if(m.stopImmediatePropagation(),!this._model.selectionStart)return;let S=this._model.selectionEnd?[this._model.selectionEnd[0],this._model.selectionEnd[1]]:null;if(this._model.selectionEnd=this._getMouseBufferCoords(m),!this._model.selectionEnd)return void this.refresh(!0);this._activeSelectionMode===2?this._model.selectionEnd[1]<this._model.selectionStart[1]?this._model.selectionEnd[0]=0:this._model.selectionEnd[0]=this._bufferService.cols:this._activeSelectionMode===1&&this._selectToWordAt(this._model.selectionEnd),this._dragScrollAmount=this._getMouseEventScrollAmount(m),this._activeSelectionMode!==3&&(this._dragScrollAmount>0?this._model.selectionEnd[0]=this._bufferService.cols:this._dragScrollAmount<0&&(this._model.selectionEnd[0]=0));let L=this._bufferService.buffer;if(this._model.selectionEnd[1]<L.lines.length){let $=L.lines.get(this._model.selectionEnd[1]);$&&$.hasWidth(this._model.selectionEnd[0])===0&&this._model.selectionEnd[0]++}S&&S[0]===this._model.selectionEnd[0]&&S[1]===this._model.selectionEnd[1]||this.refresh(!0)}_dragScroll(){if(this._model.selectionEnd&&this._model.selectionStart&&this._dragScrollAmount){this._onRequestScrollLines.fire({amount:this._dragScrollAmount,suppressScrollEvent:!1});let m=this._bufferService.buffer;this._dragScrollAmount>0?(this._activeSelectionMode!==3&&(this._model.selectionEnd[0]=this._bufferService.cols),this._model.selectionEnd[1]=Math.min(m.ydisp+this._bufferService.rows,m.lines.length-1)):(this._activeSelectionMode!==3&&(this._model.selectionEnd[0]=0),this._model.selectionEnd[1]=m.ydisp),this.refresh()}}_handleMouseUp(m){let S=m.timeStamp-this._mouseDownTimeStamp;if(this._removeMouseDownListeners(),this.selectionText.length<=1&&S<500&&m.altKey&&this._optionsService.rawOptions.altClickMovesCursor){if(this._bufferService.buffer.ybase===this._bufferService.buffer.ydisp){let L=this._mouseService.getCoords(m,this._element,this._bufferService.cols,this._bufferService.rows,!1);if(L&&L[0]!==void 0&&L[1]!==void 0){let $=(0,f.moveToCellSequence)(L[0]-1,L[1]-1,this._bufferService,this._coreService.decPrivateModes.applicationCursorKeys);this._coreService.triggerDataEvent($,!0)}}}else this._fireEventIfSelectionChanged()}_fireEventIfSelectionChanged(){let m=this._model.finalSelectionStart,S=this._model.finalSelectionEnd,L=!(!m||!S||m[0]===S[0]&&m[1]===S[1]);L?m&&S&&(this._oldSelectionStart&&this._oldSelectionEnd&&m[0]===this._oldSelectionStart[0]&&m[1]===this._oldSelectionStart[1]&&S[0]===this._oldSelectionEnd[0]&&S[1]===this._oldSelectionEnd[1]||this._fireOnSelectionChange(m,S,L)):this._oldHasSelection&&this._fireOnSelectionChange(m,S,L)}_fireOnSelectionChange(m,S,L){this._oldSelectionStart=m,this._oldSelectionEnd=S,this._oldHasSelection=L,this._onSelectionChange.fire()}_handleBufferActivate(m){this.clearSelection(),this._trimListener.dispose(),this._trimListener=m.activeBuffer.lines.onTrim((S=>this._handleTrim(S)))}_convertViewportColToCharacterIndex(m,S){let L=S;for(let $=0;S>=$;$++){let T=m.loadCell($,this._workCell).getChars().length;this._workCell.getWidth()===0?L--:T>1&&S!==$&&(L+=T-1)}return L}setSelection(m,S,L){this._model.clearSelection(),this._removeMouseDownListeners(),this._model.selectionStart=[m,S],this._model.selectionStartLength=L,this.refresh(),this._fireEventIfSelectionChanged()}rightClickSelect(m){this._isClickInSelection(m)||(this._selectWordAtCursor(m,!1)&&this.refresh(!0),this._fireEventIfSelectionChanged())}_getWordAt(m,S,L=!0,$=!0){if(m[0]>=this._bufferService.cols)return;let T=this._bufferService.buffer,O=T.lines.get(m[1]);if(!O)return;let z=T.translateBufferLineToString(m[1],!1),B=this._convertViewportColToCharacterIndex(O,m[0]),M=B,H=m[0]-B,x=0,E=0,A=0,R=0;if(z.charAt(B)===" "){for(;B>0&&z.charAt(B-1)===" ";)B--;for(;M<z.length&&z.charAt(M+1)===" ";)M++}else{let X=m[0],K=m[0];O.getWidth(X)===0&&(x++,X--),O.getWidth(K)===2&&(E++,K++);let he=O.getString(K).length;for(he>1&&(R+=he-1,M+=he-1);X>0&&B>0&&!this._isCharWordSeparator(O.loadCell(X-1,this._workCell));){O.loadCell(X-1,this._workCell);let k=this._workCell.getChars().length;this._workCell.getWidth()===0?(x++,X--):k>1&&(A+=k-1,B-=k-1),B--,X--}for(;K<O.length&&M+1<z.length&&!this._isCharWordSeparator(O.loadCell(K+1,this._workCell));){O.loadCell(K+1,this._workCell);let k=this._workCell.getChars().length;this._workCell.getWidth()===2?(E++,K++):k>1&&(R+=k-1,M+=k-1),M++,K++}}M++;let N=B+H-x+A,j=Math.min(this._bufferService.cols,M-B+x+E-A-R);if(S||z.slice(B,M).trim()!==""){if(L&&N===0&&O.getCodePoint(0)!==32){let X=T.lines.get(m[1]-1);if(X&&O.isWrapped&&X.getCodePoint(this._bufferService.cols-1)!==32){let K=this._getWordAt([this._bufferService.cols-1,m[1]-1],!1,!0,!1);if(K){let he=this._bufferService.cols-K.start;N-=he,j+=he}}}if($&&N+j===this._bufferService.cols&&O.getCodePoint(this._bufferService.cols-1)!==32){let X=T.lines.get(m[1]+1);if(X?.isWrapped&&X.getCodePoint(0)!==32){let K=this._getWordAt([0,m[1]+1],!1,!1,!0);K&&(j+=K.length)}}return{start:N,length:j}}}_selectWordAt(m,S){let L=this._getWordAt(m,S);if(L){for(;L.start<0;)L.start+=this._bufferService.cols,m[1]--;this._model.selectionStart=[L.start,m[1]],this._model.selectionStartLength=L.length}}_selectToWordAt(m){let S=this._getWordAt(m,!0);if(S){let L=m[1];for(;S.start<0;)S.start+=this._bufferService.cols,L--;if(!this._model.areSelectionValuesReversed())for(;S.start+S.length>this._bufferService.cols;)S.length-=this._bufferService.cols,L++;this._model.selectionEnd=[this._model.areSelectionValuesReversed()?S.start:S.start+S.length,L]}}_isCharWordSeparator(m){return m.getWidth()!==0&&this._optionsService.rawOptions.wordSeparator.indexOf(m.getChars())>=0}_selectLineAt(m){let S=this._bufferService.buffer.getWrappedRangeForLine(m),L={start:{x:0,y:S.first},end:{x:this._bufferService.cols-1,y:S.last}};this._model.selectionStart=[0,S.first],this._model.selectionEnd=void 0,this._model.selectionStartLength=(0,c.getRangeLength)(L,this._bufferService.cols)}};i.SelectionService=C=l([p(3,_.IBufferService),p(4,_.ICoreService),p(5,w.IMouseService),p(6,_.IOptionsService),p(7,w.IRenderService),p(8,w.ICoreBrowserService)],C)},4725:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.IThemeService=i.ICharacterJoinerService=i.ISelectionService=i.IRenderService=i.IMouseService=i.ICoreBrowserService=i.ICharSizeService=void 0;let l=r(8343);i.ICharSizeService=(0,l.createDecorator)("CharSizeService"),i.ICoreBrowserService=(0,l.createDecorator)("CoreBrowserService"),i.IMouseService=(0,l.createDecorator)("MouseService"),i.IRenderService=(0,l.createDecorator)("RenderService"),i.ISelectionService=(0,l.createDecorator)("SelectionService"),i.ICharacterJoinerService=(0,l.createDecorator)("CharacterJoinerService"),i.IThemeService=(0,l.createDecorator)("ThemeService")},6731:function(u,i,r){var l=this&&this.__decorate||function(C,m,S,L){var $,T=arguments.length,O=T<3?m:L===null?L=Object.getOwnPropertyDescriptor(m,S):L;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")O=Reflect.decorate(C,m,S,L);else for(var z=C.length-1;z>=0;z--)($=C[z])&&(O=(T<3?$(O):T>3?$(m,S,O):$(m,S))||O);return T>3&&O&&Object.defineProperty(m,S,O),O},p=this&&this.__param||function(C,m){return function(S,L){m(S,L,C)}};Object.defineProperty(i,"__esModule",{value:!0}),i.ThemeService=i.DEFAULT_ANSI_COLORS=void 0;let d=r(7239),f=r(8055),g=r(8460),w=r(844),b=r(2585),o=f.css.toColor("#ffffff"),a=f.css.toColor("#000000"),c=f.css.toColor("#ffffff"),h=f.css.toColor("#000000"),_={css:"rgba(255, 255, 255, 0.3)",rgba:4294967117};i.DEFAULT_ANSI_COLORS=Object.freeze((()=>{let C=[f.css.toColor("#2e3436"),f.css.toColor("#cc0000"),f.css.toColor("#4e9a06"),f.css.toColor("#c4a000"),f.css.toColor("#3465a4"),f.css.toColor("#75507b"),f.css.toColor("#06989a"),f.css.toColor("#d3d7cf"),f.css.toColor("#555753"),f.css.toColor("#ef2929"),f.css.toColor("#8ae234"),f.css.toColor("#fce94f"),f.css.toColor("#729fcf"),f.css.toColor("#ad7fa8"),f.css.toColor("#34e2e2"),f.css.toColor("#eeeeec")],m=[0,95,135,175,215,255];for(let S=0;S<216;S++){let L=m[S/36%6|0],$=m[S/6%6|0],T=m[S%6];C.push({css:f.channels.toCss(L,$,T),rgba:f.channels.toRgba(L,$,T)})}for(let S=0;S<24;S++){let L=8+10*S;C.push({css:f.channels.toCss(L,L,L),rgba:f.channels.toRgba(L,L,L)})}return C})());let v=i.ThemeService=class extends w.Disposable{get colors(){return this._colors}constructor(C){super(),this._optionsService=C,this._contrastCache=new d.ColorContrastCache,this._halfContrastCache=new d.ColorContrastCache,this._onChangeColors=this.register(new g.EventEmitter),this.onChangeColors=this._onChangeColors.event,this._colors={foreground:o,background:a,cursor:c,cursorAccent:h,selectionForeground:void 0,selectionBackgroundTransparent:_,selectionBackgroundOpaque:f.color.blend(a,_),selectionInactiveBackgroundTransparent:_,selectionInactiveBackgroundOpaque:f.color.blend(a,_),ansi:i.DEFAULT_ANSI_COLORS.slice(),contrastCache:this._contrastCache,halfContrastCache:this._halfContrastCache},this._updateRestoreColors(),this._setTheme(this._optionsService.rawOptions.theme),this.register(this._optionsService.onSpecificOptionChange("minimumContrastRatio",(()=>this._contrastCache.clear()))),this.register(this._optionsService.onSpecificOptionChange("theme",(()=>this._setTheme(this._optionsService.rawOptions.theme))))}_setTheme(C={}){let m=this._colors;if(m.foreground=y(C.foreground,o),m.background=y(C.background,a),m.cursor=y(C.cursor,c),m.cursorAccent=y(C.cursorAccent,h),m.selectionBackgroundTransparent=y(C.selectionBackground,_),m.selectionBackgroundOpaque=f.color.blend(m.background,m.selectionBackgroundTransparent),m.selectionInactiveBackgroundTransparent=y(C.selectionInactiveBackground,m.selectionBackgroundTransparent),m.selectionInactiveBackgroundOpaque=f.color.blend(m.background,m.selectionInactiveBackgroundTransparent),m.selectionForeground=C.selectionForeground?y(C.selectionForeground,f.NULL_COLOR):void 0,m.selectionForeground===f.NULL_COLOR&&(m.selectionForeground=void 0),f.color.isOpaque(m.selectionBackgroundTransparent)&&(m.selectionBackgroundTransparent=f.color.opacity(m.selectionBackgroundTransparent,.3)),f.color.isOpaque(m.selectionInactiveBackgroundTransparent)&&(m.selectionInactiveBackgroundTransparent=f.color.opacity(m.selectionInactiveBackgroundTransparent,.3)),m.ansi=i.DEFAULT_ANSI_COLORS.slice(),m.ansi[0]=y(C.black,i.DEFAULT_ANSI_COLORS[0]),m.ansi[1]=y(C.red,i.DEFAULT_ANSI_COLORS[1]),m.ansi[2]=y(C.green,i.DEFAULT_ANSI_COLORS[2]),m.ansi[3]=y(C.yellow,i.DEFAULT_ANSI_COLORS[3]),m.ansi[4]=y(C.blue,i.DEFAULT_ANSI_COLORS[4]),m.ansi[5]=y(C.magenta,i.DEFAULT_ANSI_COLORS[5]),m.ansi[6]=y(C.cyan,i.DEFAULT_ANSI_COLORS[6]),m.ansi[7]=y(C.white,i.DEFAULT_ANSI_COLORS[7]),m.ansi[8]=y(C.brightBlack,i.DEFAULT_ANSI_COLORS[8]),m.ansi[9]=y(C.brightRed,i.DEFAULT_ANSI_COLORS[9]),m.ansi[10]=y(C.brightGreen,i.DEFAULT_ANSI_COLORS[10]),m.ansi[11]=y(C.brightYellow,i.DEFAULT_ANSI_COLORS[11]),m.ansi[12]=y(C.brightBlue,i.DEFAULT_ANSI_COLORS[12]),m.ansi[13]=y(C.brightMagenta,i.DEFAULT_ANSI_COLORS[13]),m.ansi[14]=y(C.brightCyan,i.DEFAULT_ANSI_COLORS[14]),m.ansi[15]=y(C.brightWhite,i.DEFAULT_ANSI_COLORS[15]),C.extendedAnsi){let S=Math.min(m.ansi.length-16,C.extendedAnsi.length);for(let L=0;L<S;L++)m.ansi[L+16]=y(C.extendedAnsi[L],i.DEFAULT_ANSI_COLORS[L+16])}this._contrastCache.clear(),this._halfContrastCache.clear(),this._updateRestoreColors(),this._onChangeColors.fire(this.colors)}restoreColor(C){this._restoreColor(C),this._onChangeColors.fire(this.colors)}_restoreColor(C){if(C!==void 0)switch(C){case 256:this._colors.foreground=this._restoreColors.foreground;break;case 257:this._colors.background=this._restoreColors.background;break;case 258:this._colors.cursor=this._restoreColors.cursor;break;default:this._colors.ansi[C]=this._restoreColors.ansi[C]}else for(let m=0;m<this._restoreColors.ansi.length;++m)this._colors.ansi[m]=this._restoreColors.ansi[m]}modifyColors(C){C(this._colors),this._onChangeColors.fire(this.colors)}_updateRestoreColors(){this._restoreColors={foreground:this._colors.foreground,background:this._colors.background,cursor:this._colors.cursor,ansi:this._colors.ansi.slice()}}};function y(C,m){if(C!==void 0)try{return f.css.toColor(C)}catch{}return m}i.ThemeService=v=l([p(0,b.IOptionsService)],v)},6349:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CircularList=void 0;let l=r(8460),p=r(844);class d extends p.Disposable{constructor(g){super(),this._maxLength=g,this.onDeleteEmitter=this.register(new l.EventEmitter),this.onDelete=this.onDeleteEmitter.event,this.onInsertEmitter=this.register(new l.EventEmitter),this.onInsert=this.onInsertEmitter.event,this.onTrimEmitter=this.register(new l.EventEmitter),this.onTrim=this.onTrimEmitter.event,this._array=new Array(this._maxLength),this._startIndex=0,this._length=0}get maxLength(){return this._maxLength}set maxLength(g){if(this._maxLength===g)return;let w=new Array(g);for(let b=0;b<Math.min(g,this.length);b++)w[b]=this._array[this._getCyclicIndex(b)];this._array=w,this._maxLength=g,this._startIndex=0}get length(){return this._length}set length(g){if(g>this._length)for(let w=this._length;w<g;w++)this._array[w]=void 0;this._length=g}get(g){return this._array[this._getCyclicIndex(g)]}set(g,w){this._array[this._getCyclicIndex(g)]=w}push(g){this._array[this._getCyclicIndex(this._length)]=g,this._length===this._maxLength?(this._startIndex=++this._startIndex%this._maxLength,this.onTrimEmitter.fire(1)):this._length++}recycle(){if(this._length!==this._maxLength)throw new Error("Can only recycle when the buffer is full");return this._startIndex=++this._startIndex%this._maxLength,this.onTrimEmitter.fire(1),this._array[this._getCyclicIndex(this._length-1)]}get isFull(){return this._length===this._maxLength}pop(){return this._array[this._getCyclicIndex(this._length---1)]}splice(g,w,...b){if(w){for(let o=g;o<this._length-w;o++)this._array[this._getCyclicIndex(o)]=this._array[this._getCyclicIndex(o+w)];this._length-=w,this.onDeleteEmitter.fire({index:g,amount:w})}for(let o=this._length-1;o>=g;o--)this._array[this._getCyclicIndex(o+b.length)]=this._array[this._getCyclicIndex(o)];for(let o=0;o<b.length;o++)this._array[this._getCyclicIndex(g+o)]=b[o];if(b.length&&this.onInsertEmitter.fire({index:g,amount:b.length}),this._length+b.length>this._maxLength){let o=this._length+b.length-this._maxLength;this._startIndex+=o,this._length=this._maxLength,this.onTrimEmitter.fire(o)}else this._length+=b.length}trimStart(g){g>this._length&&(g=this._length),this._startIndex+=g,this._length-=g,this.onTrimEmitter.fire(g)}shiftElements(g,w,b){if(!(w<=0)){if(g<0||g>=this._length)throw new Error("start argument out of range");if(g+b<0)throw new Error("Cannot shift elements in list beyond index 0");if(b>0){for(let a=w-1;a>=0;a--)this.set(g+a+b,this.get(g+a));let o=g+w+b-this._length;if(o>0)for(this._length+=o;this._length>this._maxLength;)this._length--,this._startIndex++,this.onTrimEmitter.fire(1)}else for(let o=0;o<w;o++)this.set(g+o+b,this.get(g+o))}}_getCyclicIndex(g){return(this._startIndex+g)%this._maxLength}}i.CircularList=d},1439:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.clone=void 0,i.clone=function r(l,p=5){if(typeof l!="object")return l;let d=Array.isArray(l)?[]:{};for(let f in l)d[f]=p<=1?l[f]:l[f]&&r(l[f],p-1);return d}},8055:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.contrastRatio=i.toPaddedHex=i.rgba=i.rgb=i.css=i.color=i.channels=i.NULL_COLOR=void 0;let l=r(6114),p=0,d=0,f=0,g=0;var w,b,o,a,c;function h(v){let y=v.toString(16);return y.length<2?"0"+y:y}function _(v,y){return v<y?(y+.05)/(v+.05):(v+.05)/(y+.05)}i.NULL_COLOR={css:"#00000000",rgba:0},(function(v){v.toCss=function(y,C,m,S){return S!==void 0?`#${h(y)}${h(C)}${h(m)}${h(S)}`:`#${h(y)}${h(C)}${h(m)}`},v.toRgba=function(y,C,m,S=255){return(y<<24|C<<16|m<<8|S)>>>0}})(w||(i.channels=w={})),(function(v){function y(C,m){return g=Math.round(255*m),[p,d,f]=c.toChannels(C.rgba),{css:w.toCss(p,d,f,g),rgba:w.toRgba(p,d,f,g)}}v.blend=function(C,m){if(g=(255&m.rgba)/255,g===1)return{css:m.css,rgba:m.rgba};let S=m.rgba>>24&255,L=m.rgba>>16&255,$=m.rgba>>8&255,T=C.rgba>>24&255,O=C.rgba>>16&255,z=C.rgba>>8&255;return p=T+Math.round((S-T)*g),d=O+Math.round((L-O)*g),f=z+Math.round(($-z)*g),{css:w.toCss(p,d,f),rgba:w.toRgba(p,d,f)}},v.isOpaque=function(C){return(255&C.rgba)==255},v.ensureContrastRatio=function(C,m,S){let L=c.ensureContrastRatio(C.rgba,m.rgba,S);if(L)return c.toColor(L>>24&255,L>>16&255,L>>8&255)},v.opaque=function(C){let m=(255|C.rgba)>>>0;return[p,d,f]=c.toChannels(m),{css:w.toCss(p,d,f),rgba:m}},v.opacity=y,v.multiplyOpacity=function(C,m){return g=255&C.rgba,y(C,g*m/255)},v.toColorRGB=function(C){return[C.rgba>>24&255,C.rgba>>16&255,C.rgba>>8&255]}})(b||(i.color=b={})),(function(v){let y,C;if(!l.isNode){let m=document.createElement("canvas");m.width=1,m.height=1;let S=m.getContext("2d",{willReadFrequently:!0});S&&(y=S,y.globalCompositeOperation="copy",C=y.createLinearGradient(0,0,1,1))}v.toColor=function(m){if(m.match(/#[\da-f]{3,8}/i))switch(m.length){case 4:return p=parseInt(m.slice(1,2).repeat(2),16),d=parseInt(m.slice(2,3).repeat(2),16),f=parseInt(m.slice(3,4).repeat(2),16),c.toColor(p,d,f);case 5:return p=parseInt(m.slice(1,2).repeat(2),16),d=parseInt(m.slice(2,3).repeat(2),16),f=parseInt(m.slice(3,4).repeat(2),16),g=parseInt(m.slice(4,5).repeat(2),16),c.toColor(p,d,f,g);case 7:return{css:m,rgba:(parseInt(m.slice(1),16)<<8|255)>>>0};case 9:return{css:m,rgba:parseInt(m.slice(1),16)>>>0}}let S=m.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*(0|1|\d?\.(\d+))\s*)?\)/);if(S)return p=parseInt(S[1]),d=parseInt(S[2]),f=parseInt(S[3]),g=Math.round(255*(S[5]===void 0?1:parseFloat(S[5]))),c.toColor(p,d,f,g);if(!y||!C)throw new Error("css.toColor: Unsupported css format");if(y.fillStyle=C,y.fillStyle=m,typeof y.fillStyle!="string")throw new Error("css.toColor: Unsupported css format");if(y.fillRect(0,0,1,1),[p,d,f,g]=y.getImageData(0,0,1,1).data,g!==255)throw new Error("css.toColor: Unsupported css format");return{rgba:w.toRgba(p,d,f,g),css:m}}})(o||(i.css=o={})),(function(v){function y(C,m,S){let L=C/255,$=m/255,T=S/255;return .2126*(L<=.03928?L/12.92:Math.pow((L+.055)/1.055,2.4))+.7152*($<=.03928?$/12.92:Math.pow(($+.055)/1.055,2.4))+.0722*(T<=.03928?T/12.92:Math.pow((T+.055)/1.055,2.4))}v.relativeLuminance=function(C){return y(C>>16&255,C>>8&255,255&C)},v.relativeLuminance2=y})(a||(i.rgb=a={})),(function(v){function y(m,S,L){let $=m>>24&255,T=m>>16&255,O=m>>8&255,z=S>>24&255,B=S>>16&255,M=S>>8&255,H=_(a.relativeLuminance2(z,B,M),a.relativeLuminance2($,T,O));for(;H<L&&(z>0||B>0||M>0);)z-=Math.max(0,Math.ceil(.1*z)),B-=Math.max(0,Math.ceil(.1*B)),M-=Math.max(0,Math.ceil(.1*M)),H=_(a.relativeLuminance2(z,B,M),a.relativeLuminance2($,T,O));return(z<<24|B<<16|M<<8|255)>>>0}function C(m,S,L){let $=m>>24&255,T=m>>16&255,O=m>>8&255,z=S>>24&255,B=S>>16&255,M=S>>8&255,H=_(a.relativeLuminance2(z,B,M),a.relativeLuminance2($,T,O));for(;H<L&&(z<255||B<255||M<255);)z=Math.min(255,z+Math.ceil(.1*(255-z))),B=Math.min(255,B+Math.ceil(.1*(255-B))),M=Math.min(255,M+Math.ceil(.1*(255-M))),H=_(a.relativeLuminance2(z,B,M),a.relativeLuminance2($,T,O));return(z<<24|B<<16|M<<8|255)>>>0}v.ensureContrastRatio=function(m,S,L){let $=a.relativeLuminance(m>>8),T=a.relativeLuminance(S>>8);if(_($,T)<L){if(T<$){let B=y(m,S,L),M=_($,a.relativeLuminance(B>>8));if(M<L){let H=C(m,S,L);return M>_($,a.relativeLuminance(H>>8))?B:H}return B}let O=C(m,S,L),z=_($,a.relativeLuminance(O>>8));if(z<L){let B=y(m,S,L);return z>_($,a.relativeLuminance(B>>8))?O:B}return O}},v.reduceLuminance=y,v.increaseLuminance=C,v.toChannels=function(m){return[m>>24&255,m>>16&255,m>>8&255,255&m]},v.toColor=function(m,S,L,$){return{css:w.toCss(m,S,L,$),rgba:w.toRgba(m,S,L,$)}}})(c||(i.rgba=c={})),i.toPaddedHex=h,i.contrastRatio=_},8969:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CoreTerminal=void 0;let l=r(844),p=r(2585),d=r(4348),f=r(7866),g=r(744),w=r(7302),b=r(6975),o=r(8460),a=r(1753),c=r(1480),h=r(7994),_=r(9282),v=r(5435),y=r(5981),C=r(2660),m=!1;class S extends l.Disposable{get onScroll(){return this._onScrollApi||(this._onScrollApi=this.register(new o.EventEmitter),this._onScroll.event(($=>{var T;(T=this._onScrollApi)===null||T===void 0||T.fire($.position)}))),this._onScrollApi.event}get cols(){return this._bufferService.cols}get rows(){return this._bufferService.rows}get buffers(){return this._bufferService.buffers}get options(){return this.optionsService.options}set options($){for(let T in $)this.optionsService.options[T]=$[T]}constructor($){super(),this._windowsWrappingHeuristics=this.register(new l.MutableDisposable),this._onBinary=this.register(new o.EventEmitter),this.onBinary=this._onBinary.event,this._onData=this.register(new o.EventEmitter),this.onData=this._onData.event,this._onLineFeed=this.register(new o.EventEmitter),this.onLineFeed=this._onLineFeed.event,this._onResize=this.register(new o.EventEmitter),this.onResize=this._onResize.event,this._onWriteParsed=this.register(new o.EventEmitter),this.onWriteParsed=this._onWriteParsed.event,this._onScroll=this.register(new o.EventEmitter),this._instantiationService=new d.InstantiationService,this.optionsService=this.register(new w.OptionsService($)),this._instantiationService.setService(p.IOptionsService,this.optionsService),this._bufferService=this.register(this._instantiationService.createInstance(g.BufferService)),this._instantiationService.setService(p.IBufferService,this._bufferService),this._logService=this.register(this._instantiationService.createInstance(f.LogService)),this._instantiationService.setService(p.ILogService,this._logService),this.coreService=this.register(this._instantiationService.createInstance(b.CoreService)),this._instantiationService.setService(p.ICoreService,this.coreService),this.coreMouseService=this.register(this._instantiationService.createInstance(a.CoreMouseService)),this._instantiationService.setService(p.ICoreMouseService,this.coreMouseService),this.unicodeService=this.register(this._instantiationService.createInstance(c.UnicodeService)),this._instantiationService.setService(p.IUnicodeService,this.unicodeService),this._charsetService=this._instantiationService.createInstance(h.CharsetService),this._instantiationService.setService(p.ICharsetService,this._charsetService),this._oscLinkService=this._instantiationService.createInstance(C.OscLinkService),this._instantiationService.setService(p.IOscLinkService,this._oscLinkService),this._inputHandler=this.register(new v.InputHandler(this._bufferService,this._charsetService,this.coreService,this._logService,this.optionsService,this._oscLinkService,this.coreMouseService,this.unicodeService)),this.register((0,o.forwardEvent)(this._inputHandler.onLineFeed,this._onLineFeed)),this.register(this._inputHandler),this.register((0,o.forwardEvent)(this._bufferService.onResize,this._onResize)),this.register((0,o.forwardEvent)(this.coreService.onData,this._onData)),this.register((0,o.forwardEvent)(this.coreService.onBinary,this._onBinary)),this.register(this.coreService.onRequestScrollToBottom((()=>this.scrollToBottom()))),this.register(this.coreService.onUserInput((()=>this._writeBuffer.handleUserInput()))),this.register(this.optionsService.onMultipleOptionChange(["windowsMode","windowsPty"],(()=>this._handleWindowsPtyOptionChange()))),this.register(this._bufferService.onScroll((T=>{this._onScroll.fire({position:this._bufferService.buffer.ydisp,source:0}),this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop,this._bufferService.buffer.scrollBottom)}))),this.register(this._inputHandler.onScroll((T=>{this._onScroll.fire({position:this._bufferService.buffer.ydisp,source:0}),this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop,this._bufferService.buffer.scrollBottom)}))),this._writeBuffer=this.register(new y.WriteBuffer(((T,O)=>this._inputHandler.parse(T,O)))),this.register((0,o.forwardEvent)(this._writeBuffer.onWriteParsed,this._onWriteParsed))}write($,T){this._writeBuffer.write($,T)}writeSync($,T){this._logService.logLevel<=p.LogLevelEnum.WARN&&!m&&(this._logService.warn("writeSync is unreliable and will be removed soon."),m=!0),this._writeBuffer.writeSync($,T)}resize($,T){isNaN($)||isNaN(T)||($=Math.max($,g.MINIMUM_COLS),T=Math.max(T,g.MINIMUM_ROWS),this._bufferService.resize($,T))}scroll($,T=!1){this._bufferService.scroll($,T)}scrollLines($,T,O){this._bufferService.scrollLines($,T,O)}scrollPages($){this.scrollLines($*(this.rows-1))}scrollToTop(){this.scrollLines(-this._bufferService.buffer.ydisp)}scrollToBottom(){this.scrollLines(this._bufferService.buffer.ybase-this._bufferService.buffer.ydisp)}scrollToLine($){let T=$-this._bufferService.buffer.ydisp;T!==0&&this.scrollLines(T)}registerEscHandler($,T){return this._inputHandler.registerEscHandler($,T)}registerDcsHandler($,T){return this._inputHandler.registerDcsHandler($,T)}registerCsiHandler($,T){return this._inputHandler.registerCsiHandler($,T)}registerOscHandler($,T){return this._inputHandler.registerOscHandler($,T)}_setup(){this._handleWindowsPtyOptionChange()}reset(){this._inputHandler.reset(),this._bufferService.reset(),this._charsetService.reset(),this.coreService.reset(),this.coreMouseService.reset()}_handleWindowsPtyOptionChange(){let $=!1,T=this.optionsService.rawOptions.windowsPty;T&&T.buildNumber!==void 0&&T.buildNumber!==void 0?$=T.backend==="conpty"&&T.buildNumber<21376:this.optionsService.rawOptions.windowsMode&&($=!0),$?this._enableWindowsWrappingHeuristics():this._windowsWrappingHeuristics.clear()}_enableWindowsWrappingHeuristics(){if(!this._windowsWrappingHeuristics.value){let $=[];$.push(this.onLineFeed(_.updateWindowsModeWrappedState.bind(null,this._bufferService))),$.push(this.registerCsiHandler({final:"H"},(()=>((0,_.updateWindowsModeWrappedState)(this._bufferService),!1)))),this._windowsWrappingHeuristics.value=(0,l.toDisposable)((()=>{for(let T of $)T.dispose()}))}}}i.CoreTerminal=S},8460:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.forwardEvent=i.EventEmitter=void 0,i.EventEmitter=class{constructor(){this._listeners=[],this._disposed=!1}get event(){return this._event||(this._event=r=>(this._listeners.push(r),{dispose:()=>{if(!this._disposed){for(let l=0;l<this._listeners.length;l++)if(this._listeners[l]===r)return void this._listeners.splice(l,1)}}})),this._event}fire(r,l){let p=[];for(let d=0;d<this._listeners.length;d++)p.push(this._listeners[d]);for(let d=0;d<p.length;d++)p[d].call(void 0,r,l)}dispose(){this.clearListeners(),this._disposed=!0}clearListeners(){this._listeners&&(this._listeners.length=0)}},i.forwardEvent=function(r,l){return r((p=>l.fire(p)))}},5435:function(u,i,r){var l=this&&this.__decorate||function(H,x,E,A){var R,N=arguments.length,j=N<3?x:A===null?A=Object.getOwnPropertyDescriptor(x,E):A;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")j=Reflect.decorate(H,x,E,A);else for(var X=H.length-1;X>=0;X--)(R=H[X])&&(j=(N<3?R(j):N>3?R(x,E,j):R(x,E))||j);return N>3&&j&&Object.defineProperty(x,E,j),j},p=this&&this.__param||function(H,x){return function(E,A){x(E,A,H)}};Object.defineProperty(i,"__esModule",{value:!0}),i.InputHandler=i.WindowsOptionsReportType=void 0;let d=r(2584),f=r(7116),g=r(2015),w=r(844),b=r(482),o=r(8437),a=r(8460),c=r(643),h=r(511),_=r(3734),v=r(2585),y=r(6242),C=r(6351),m=r(5941),S={"(":0,")":1,"*":2,"+":3,"-":1,".":2},L=131072;function $(H,x){if(H>24)return x.setWinLines||!1;switch(H){case 1:return!!x.restoreWin;case 2:return!!x.minimizeWin;case 3:return!!x.setWinPosition;case 4:return!!x.setWinSizePixels;case 5:return!!x.raiseWin;case 6:return!!x.lowerWin;case 7:return!!x.refreshWin;case 8:return!!x.setWinSizeChars;case 9:return!!x.maximizeWin;case 10:return!!x.fullscreenWin;case 11:return!!x.getWinState;case 13:return!!x.getWinPosition;case 14:return!!x.getWinSizePixels;case 15:return!!x.getScreenSizePixels;case 16:return!!x.getCellSizePixels;case 18:return!!x.getWinSizeChars;case 19:return!!x.getScreenSizeChars;case 20:return!!x.getIconTitle;case 21:return!!x.getWinTitle;case 22:return!!x.pushTitle;case 23:return!!x.popTitle;case 24:return!!x.setWinLines}return!1}var T;(function(H){H[H.GET_WIN_SIZE_PIXELS=0]="GET_WIN_SIZE_PIXELS",H[H.GET_CELL_SIZE_PIXELS=1]="GET_CELL_SIZE_PIXELS"})(T||(i.WindowsOptionsReportType=T={}));let O=0;class z extends w.Disposable{getAttrData(){return this._curAttrData}constructor(x,E,A,R,N,j,X,K,he=new g.EscapeSequenceParser){super(),this._bufferService=x,this._charsetService=E,this._coreService=A,this._logService=R,this._optionsService=N,this._oscLinkService=j,this._coreMouseService=X,this._unicodeService=K,this._parser=he,this._parseBuffer=new Uint32Array(4096),this._stringDecoder=new b.StringToUtf32,this._utf8Decoder=new b.Utf8ToUtf32,this._workCell=new h.CellData,this._windowTitle="",this._iconName="",this._windowTitleStack=[],this._iconNameStack=[],this._curAttrData=o.DEFAULT_ATTR_DATA.clone(),this._eraseAttrDataInternal=o.DEFAULT_ATTR_DATA.clone(),this._onRequestBell=this.register(new a.EventEmitter),this.onRequestBell=this._onRequestBell.event,this._onRequestRefreshRows=this.register(new a.EventEmitter),this.onRequestRefreshRows=this._onRequestRefreshRows.event,this._onRequestReset=this.register(new a.EventEmitter),this.onRequestReset=this._onRequestReset.event,this._onRequestSendFocus=this.register(new a.EventEmitter),this.onRequestSendFocus=this._onRequestSendFocus.event,this._onRequestSyncScrollBar=this.register(new a.EventEmitter),this.onRequestSyncScrollBar=this._onRequestSyncScrollBar.event,this._onRequestWindowsOptionsReport=this.register(new a.EventEmitter),this.onRequestWindowsOptionsReport=this._onRequestWindowsOptionsReport.event,this._onA11yChar=this.register(new a.EventEmitter),this.onA11yChar=this._onA11yChar.event,this._onA11yTab=this.register(new a.EventEmitter),this.onA11yTab=this._onA11yTab.event,this._onCursorMove=this.register(new a.EventEmitter),this.onCursorMove=this._onCursorMove.event,this._onLineFeed=this.register(new a.EventEmitter),this.onLineFeed=this._onLineFeed.event,this._onScroll=this.register(new a.EventEmitter),this.onScroll=this._onScroll.event,this._onTitleChange=this.register(new a.EventEmitter),this.onTitleChange=this._onTitleChange.event,this._onColor=this.register(new a.EventEmitter),this.onColor=this._onColor.event,this._parseStack={paused:!1,cursorStartX:0,cursorStartY:0,decodedLength:0,position:0},this._specialColors=[256,257,258],this.register(this._parser),this._dirtyRowTracker=new B(this._bufferService),this._activeBuffer=this._bufferService.buffer,this.register(this._bufferService.buffers.onBufferActivate((k=>this._activeBuffer=k.activeBuffer))),this._parser.setCsiHandlerFallback(((k,F)=>{this._logService.debug("Unknown CSI code: ",{identifier:this._parser.identToString(k),params:F.toArray()})})),this._parser.setEscHandlerFallback((k=>{this._logService.debug("Unknown ESC code: ",{identifier:this._parser.identToString(k)})})),this._parser.setExecuteHandlerFallback((k=>{this._logService.debug("Unknown EXECUTE code: ",{code:k})})),this._parser.setOscHandlerFallback(((k,F,U)=>{this._logService.debug("Unknown OSC code: ",{identifier:k,action:F,data:U})})),this._parser.setDcsHandlerFallback(((k,F,U)=>{F==="HOOK"&&(U=U.toArray()),this._logService.debug("Unknown DCS code: ",{identifier:this._parser.identToString(k),action:F,payload:U})})),this._parser.setPrintHandler(((k,F,U)=>this.print(k,F,U))),this._parser.registerCsiHandler({final:"@"},(k=>this.insertChars(k))),this._parser.registerCsiHandler({intermediates:" ",final:"@"},(k=>this.scrollLeft(k))),this._parser.registerCsiHandler({final:"A"},(k=>this.cursorUp(k))),this._parser.registerCsiHandler({intermediates:" ",final:"A"},(k=>this.scrollRight(k))),this._parser.registerCsiHandler({final:"B"},(k=>this.cursorDown(k))),this._parser.registerCsiHandler({final:"C"},(k=>this.cursorForward(k))),this._parser.registerCsiHandler({final:"D"},(k=>this.cursorBackward(k))),this._parser.registerCsiHandler({final:"E"},(k=>this.cursorNextLine(k))),this._parser.registerCsiHandler({final:"F"},(k=>this.cursorPrecedingLine(k))),this._parser.registerCsiHandler({final:"G"},(k=>this.cursorCharAbsolute(k))),this._parser.registerCsiHandler({final:"H"},(k=>this.cursorPosition(k))),this._parser.registerCsiHandler({final:"I"},(k=>this.cursorForwardTab(k))),this._parser.registerCsiHandler({final:"J"},(k=>this.eraseInDisplay(k,!1))),this._parser.registerCsiHandler({prefix:"?",final:"J"},(k=>this.eraseInDisplay(k,!0))),this._parser.registerCsiHandler({final:"K"},(k=>this.eraseInLine(k,!1))),this._parser.registerCsiHandler({prefix:"?",final:"K"},(k=>this.eraseInLine(k,!0))),this._parser.registerCsiHandler({final:"L"},(k=>this.insertLines(k))),this._parser.registerCsiHandler({final:"M"},(k=>this.deleteLines(k))),this._parser.registerCsiHandler({final:"P"},(k=>this.deleteChars(k))),this._parser.registerCsiHandler({final:"S"},(k=>this.scrollUp(k))),this._parser.registerCsiHandler({final:"T"},(k=>this.scrollDown(k))),this._parser.registerCsiHandler({final:"X"},(k=>this.eraseChars(k))),this._parser.registerCsiHandler({final:"Z"},(k=>this.cursorBackwardTab(k))),this._parser.registerCsiHandler({final:"`"},(k=>this.charPosAbsolute(k))),this._parser.registerCsiHandler({final:"a"},(k=>this.hPositionRelative(k))),this._parser.registerCsiHandler({final:"b"},(k=>this.repeatPrecedingCharacter(k))),this._parser.registerCsiHandler({final:"c"},(k=>this.sendDeviceAttributesPrimary(k))),this._parser.registerCsiHandler({prefix:">",final:"c"},(k=>this.sendDeviceAttributesSecondary(k))),this._parser.registerCsiHandler({final:"d"},(k=>this.linePosAbsolute(k))),this._parser.registerCsiHandler({final:"e"},(k=>this.vPositionRelative(k))),this._parser.registerCsiHandler({final:"f"},(k=>this.hVPosition(k))),this._parser.registerCsiHandler({final:"g"},(k=>this.tabClear(k))),this._parser.registerCsiHandler({final:"h"},(k=>this.setMode(k))),this._parser.registerCsiHandler({prefix:"?",final:"h"},(k=>this.setModePrivate(k))),this._parser.registerCsiHandler({final:"l"},(k=>this.resetMode(k))),this._parser.registerCsiHandler({prefix:"?",final:"l"},(k=>this.resetModePrivate(k))),this._parser.registerCsiHandler({final:"m"},(k=>this.charAttributes(k))),this._parser.registerCsiHandler({final:"n"},(k=>this.deviceStatus(k))),this._parser.registerCsiHandler({prefix:"?",final:"n"},(k=>this.deviceStatusPrivate(k))),this._parser.registerCsiHandler({intermediates:"!",final:"p"},(k=>this.softReset(k))),this._parser.registerCsiHandler({intermediates:" ",final:"q"},(k=>this.setCursorStyle(k))),this._parser.registerCsiHandler({final:"r"},(k=>this.setScrollRegion(k))),this._parser.registerCsiHandler({final:"s"},(k=>this.saveCursor(k))),this._parser.registerCsiHandler({final:"t"},(k=>this.windowOptions(k))),this._parser.registerCsiHandler({final:"u"},(k=>this.restoreCursor(k))),this._parser.registerCsiHandler({intermediates:"'",final:"}"},(k=>this.insertColumns(k))),this._parser.registerCsiHandler({intermediates:"'",final:"~"},(k=>this.deleteColumns(k))),this._parser.registerCsiHandler({intermediates:'"',final:"q"},(k=>this.selectProtected(k))),this._parser.registerCsiHandler({intermediates:"$",final:"p"},(k=>this.requestMode(k,!0))),this._parser.registerCsiHandler({prefix:"?",intermediates:"$",final:"p"},(k=>this.requestMode(k,!1))),this._parser.setExecuteHandler(d.C0.BEL,(()=>this.bell())),this._parser.setExecuteHandler(d.C0.LF,(()=>this.lineFeed())),this._parser.setExecuteHandler(d.C0.VT,(()=>this.lineFeed())),this._parser.setExecuteHandler(d.C0.FF,(()=>this.lineFeed())),this._parser.setExecuteHandler(d.C0.CR,(()=>this.carriageReturn())),this._parser.setExecuteHandler(d.C0.BS,(()=>this.backspace())),this._parser.setExecuteHandler(d.C0.HT,(()=>this.tab())),this._parser.setExecuteHandler(d.C0.SO,(()=>this.shiftOut())),this._parser.setExecuteHandler(d.C0.SI,(()=>this.shiftIn())),this._parser.setExecuteHandler(d.C1.IND,(()=>this.index())),this._parser.setExecuteHandler(d.C1.NEL,(()=>this.nextLine())),this._parser.setExecuteHandler(d.C1.HTS,(()=>this.tabSet())),this._parser.registerOscHandler(0,new y.OscHandler((k=>(this.setTitle(k),this.setIconName(k),!0)))),this._parser.registerOscHandler(1,new y.OscHandler((k=>this.setIconName(k)))),this._parser.registerOscHandler(2,new y.OscHandler((k=>this.setTitle(k)))),this._parser.registerOscHandler(4,new y.OscHandler((k=>this.setOrReportIndexedColor(k)))),this._parser.registerOscHandler(8,new y.OscHandler((k=>this.setHyperlink(k)))),this._parser.registerOscHandler(10,new y.OscHandler((k=>this.setOrReportFgColor(k)))),this._parser.registerOscHandler(11,new y.OscHandler((k=>this.setOrReportBgColor(k)))),this._parser.registerOscHandler(12,new y.OscHandler((k=>this.setOrReportCursorColor(k)))),this._parser.registerOscHandler(104,new y.OscHandler((k=>this.restoreIndexedColor(k)))),this._parser.registerOscHandler(110,new y.OscHandler((k=>this.restoreFgColor(k)))),this._parser.registerOscHandler(111,new y.OscHandler((k=>this.restoreBgColor(k)))),this._parser.registerOscHandler(112,new y.OscHandler((k=>this.restoreCursorColor(k)))),this._parser.registerEscHandler({final:"7"},(()=>this.saveCursor())),this._parser.registerEscHandler({final:"8"},(()=>this.restoreCursor())),this._parser.registerEscHandler({final:"D"},(()=>this.index())),this._parser.registerEscHandler({final:"E"},(()=>this.nextLine())),this._parser.registerEscHandler({final:"H"},(()=>this.tabSet())),this._parser.registerEscHandler({final:"M"},(()=>this.reverseIndex())),this._parser.registerEscHandler({final:"="},(()=>this.keypadApplicationMode())),this._parser.registerEscHandler({final:">"},(()=>this.keypadNumericMode())),this._parser.registerEscHandler({final:"c"},(()=>this.fullReset())),this._parser.registerEscHandler({final:"n"},(()=>this.setgLevel(2))),this._parser.registerEscHandler({final:"o"},(()=>this.setgLevel(3))),this._parser.registerEscHandler({final:"|"},(()=>this.setgLevel(3))),this._parser.registerEscHandler({final:"}"},(()=>this.setgLevel(2))),this._parser.registerEscHandler({final:"~"},(()=>this.setgLevel(1))),this._parser.registerEscHandler({intermediates:"%",final:"@"},(()=>this.selectDefaultCharset())),this._parser.registerEscHandler({intermediates:"%",final:"G"},(()=>this.selectDefaultCharset()));for(let k in f.CHARSETS)this._parser.registerEscHandler({intermediates:"(",final:k},(()=>this.selectCharset("("+k))),this._parser.registerEscHandler({intermediates:")",final:k},(()=>this.selectCharset(")"+k))),this._parser.registerEscHandler({intermediates:"*",final:k},(()=>this.selectCharset("*"+k))),this._parser.registerEscHandler({intermediates:"+",final:k},(()=>this.selectCharset("+"+k))),this._parser.registerEscHandler({intermediates:"-",final:k},(()=>this.selectCharset("-"+k))),this._parser.registerEscHandler({intermediates:".",final:k},(()=>this.selectCharset("."+k))),this._parser.registerEscHandler({intermediates:"/",final:k},(()=>this.selectCharset("/"+k)));this._parser.registerEscHandler({intermediates:"#",final:"8"},(()=>this.screenAlignmentPattern())),this._parser.setErrorHandler((k=>(this._logService.error("Parsing error: ",k),k))),this._parser.registerDcsHandler({intermediates:"$",final:"q"},new C.DcsHandler(((k,F)=>this.requestStatusString(k,F))))}_preserveStack(x,E,A,R){this._parseStack.paused=!0,this._parseStack.cursorStartX=x,this._parseStack.cursorStartY=E,this._parseStack.decodedLength=A,this._parseStack.position=R}_logSlowResolvingAsync(x){this._logService.logLevel<=v.LogLevelEnum.WARN&&Promise.race([x,new Promise(((E,A)=>setTimeout((()=>A("#SLOW_TIMEOUT")),5e3)))]).catch((E=>{if(E!=="#SLOW_TIMEOUT")throw E;console.warn("async parser handler taking longer than 5000 ms")}))}_getCurrentLinkId(){return this._curAttrData.extended.urlId}parse(x,E){let A,R=this._activeBuffer.x,N=this._activeBuffer.y,j=0,X=this._parseStack.paused;if(X){if(A=this._parser.parse(this._parseBuffer,this._parseStack.decodedLength,E))return this._logSlowResolvingAsync(A),A;R=this._parseStack.cursorStartX,N=this._parseStack.cursorStartY,this._parseStack.paused=!1,x.length>L&&(j=this._parseStack.position+L)}if(this._logService.logLevel<=v.LogLevelEnum.DEBUG&&this._logService.debug("parsing data"+(typeof x=="string"?` "${x}"`:` "${Array.prototype.map.call(x,(K=>String.fromCharCode(K))).join("")}"`),typeof x=="string"?x.split("").map((K=>K.charCodeAt(0))):x),this._parseBuffer.length<x.length&&this._parseBuffer.length<L&&(this._parseBuffer=new Uint32Array(Math.min(x.length,L))),X||this._dirtyRowTracker.clearRange(),x.length>L)for(let K=j;K<x.length;K+=L){let he=K+L<x.length?K+L:x.length,k=typeof x=="string"?this._stringDecoder.decode(x.substring(K,he),this._parseBuffer):this._utf8Decoder.decode(x.subarray(K,he),this._parseBuffer);if(A=this._parser.parse(this._parseBuffer,k))return this._preserveStack(R,N,k,K),this._logSlowResolvingAsync(A),A}else if(!X){let K=typeof x=="string"?this._stringDecoder.decode(x,this._parseBuffer):this._utf8Decoder.decode(x,this._parseBuffer);if(A=this._parser.parse(this._parseBuffer,K))return this._preserveStack(R,N,K,0),this._logSlowResolvingAsync(A),A}this._activeBuffer.x===R&&this._activeBuffer.y===N||this._onCursorMove.fire(),this._onRequestRefreshRows.fire(this._dirtyRowTracker.start,this._dirtyRowTracker.end)}print(x,E,A){let R,N,j=this._charsetService.charset,X=this._optionsService.rawOptions.screenReaderMode,K=this._bufferService.cols,he=this._coreService.decPrivateModes.wraparound,k=this._coreService.modes.insertMode,F=this._curAttrData,U=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._activeBuffer.x&&A-E>0&&U.getWidth(this._activeBuffer.x-1)===2&&U.setCellFromCodePoint(this._activeBuffer.x-1,0,1,F.fg,F.bg,F.extended);for(let W=E;W<A;++W){if(R=x[W],N=this._unicodeService.wcwidth(R),R<127&&j){let ee=j[String.fromCharCode(R)];ee&&(R=ee.charCodeAt(0))}if(X&&this._onA11yChar.fire((0,b.stringFromCodePoint)(R)),this._getCurrentLinkId()&&this._oscLinkService.addLineToLink(this._getCurrentLinkId(),this._activeBuffer.ybase+this._activeBuffer.y),N||!this._activeBuffer.x){if(this._activeBuffer.x+N-1>=K){if(he){for(;this._activeBuffer.x<K;)U.setCellFromCodePoint(this._activeBuffer.x++,0,1,F.fg,F.bg,F.extended);this._activeBuffer.x=0,this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData(),!0)):(this._activeBuffer.y>=this._bufferService.rows&&(this._activeBuffer.y=this._bufferService.rows-1),this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!0),U=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y)}else if(this._activeBuffer.x=K-1,N===2)continue}if(k&&(U.insertCells(this._activeBuffer.x,N,this._activeBuffer.getNullCell(F),F),U.getWidth(K-1)===2&&U.setCellFromCodePoint(K-1,c.NULL_CELL_CODE,c.NULL_CELL_WIDTH,F.fg,F.bg,F.extended)),U.setCellFromCodePoint(this._activeBuffer.x++,R,N,F.fg,F.bg,F.extended),N>0)for(;--N;)U.setCellFromCodePoint(this._activeBuffer.x++,0,0,F.fg,F.bg,F.extended)}else U.getWidth(this._activeBuffer.x-1)?U.addCodepointToCell(this._activeBuffer.x-1,R):U.addCodepointToCell(this._activeBuffer.x-2,R)}A-E>0&&(U.loadCell(this._activeBuffer.x-1,this._workCell),this._workCell.getWidth()===2||this._workCell.getCode()>65535?this._parser.precedingCodepoint=0:this._workCell.isCombined()?this._parser.precedingCodepoint=this._workCell.getChars().charCodeAt(0):this._parser.precedingCodepoint=this._workCell.content),this._activeBuffer.x<K&&A-E>0&&U.getWidth(this._activeBuffer.x)===0&&!U.hasContent(this._activeBuffer.x)&&U.setCellFromCodePoint(this._activeBuffer.x,0,1,F.fg,F.bg,F.extended),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}registerCsiHandler(x,E){return x.final!=="t"||x.prefix||x.intermediates?this._parser.registerCsiHandler(x,E):this._parser.registerCsiHandler(x,(A=>!$(A.params[0],this._optionsService.rawOptions.windowOptions)||E(A)))}registerDcsHandler(x,E){return this._parser.registerDcsHandler(x,new C.DcsHandler(E))}registerEscHandler(x,E){return this._parser.registerEscHandler(x,E)}registerOscHandler(x,E){return this._parser.registerOscHandler(x,new y.OscHandler(E))}bell(){return this._onRequestBell.fire(),!0}lineFeed(){return this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._optionsService.rawOptions.convertEol&&(this._activeBuffer.x=0),this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData())):this._activeBuffer.y>=this._bufferService.rows?this._activeBuffer.y=this._bufferService.rows-1:this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!1,this._activeBuffer.x>=this._bufferService.cols&&this._activeBuffer.x--,this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._onLineFeed.fire(),!0}carriageReturn(){return this._activeBuffer.x=0,!0}backspace(){var x;if(!this._coreService.decPrivateModes.reverseWraparound)return this._restrictCursor(),this._activeBuffer.x>0&&this._activeBuffer.x--,!0;if(this._restrictCursor(this._bufferService.cols),this._activeBuffer.x>0)this._activeBuffer.x--;else if(this._activeBuffer.x===0&&this._activeBuffer.y>this._activeBuffer.scrollTop&&this._activeBuffer.y<=this._activeBuffer.scrollBottom&&(!((x=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y))===null||x===void 0)&&x.isWrapped)){this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!1,this._activeBuffer.y--,this._activeBuffer.x=this._bufferService.cols-1;let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);E.hasWidth(this._activeBuffer.x)&&!E.hasContent(this._activeBuffer.x)&&this._activeBuffer.x--}return this._restrictCursor(),!0}tab(){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let x=this._activeBuffer.x;return this._activeBuffer.x=this._activeBuffer.nextStop(),this._optionsService.rawOptions.screenReaderMode&&this._onA11yTab.fire(this._activeBuffer.x-x),!0}shiftOut(){return this._charsetService.setgLevel(1),!0}shiftIn(){return this._charsetService.setgLevel(0),!0}_restrictCursor(x=this._bufferService.cols-1){this._activeBuffer.x=Math.min(x,Math.max(0,this._activeBuffer.x)),this._activeBuffer.y=this._coreService.decPrivateModes.origin?Math.min(this._activeBuffer.scrollBottom,Math.max(this._activeBuffer.scrollTop,this._activeBuffer.y)):Math.min(this._bufferService.rows-1,Math.max(0,this._activeBuffer.y)),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}_setCursor(x,E){this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._coreService.decPrivateModes.origin?(this._activeBuffer.x=x,this._activeBuffer.y=this._activeBuffer.scrollTop+E):(this._activeBuffer.x=x,this._activeBuffer.y=E),this._restrictCursor(),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}_moveCursor(x,E){this._restrictCursor(),this._setCursor(this._activeBuffer.x+x,this._activeBuffer.y+E)}cursorUp(x){let E=this._activeBuffer.y-this._activeBuffer.scrollTop;return E>=0?this._moveCursor(0,-Math.min(E,x.params[0]||1)):this._moveCursor(0,-(x.params[0]||1)),!0}cursorDown(x){let E=this._activeBuffer.scrollBottom-this._activeBuffer.y;return E>=0?this._moveCursor(0,Math.min(E,x.params[0]||1)):this._moveCursor(0,x.params[0]||1),!0}cursorForward(x){return this._moveCursor(x.params[0]||1,0),!0}cursorBackward(x){return this._moveCursor(-(x.params[0]||1),0),!0}cursorNextLine(x){return this.cursorDown(x),this._activeBuffer.x=0,!0}cursorPrecedingLine(x){return this.cursorUp(x),this._activeBuffer.x=0,!0}cursorCharAbsolute(x){return this._setCursor((x.params[0]||1)-1,this._activeBuffer.y),!0}cursorPosition(x){return this._setCursor(x.length>=2?(x.params[1]||1)-1:0,(x.params[0]||1)-1),!0}charPosAbsolute(x){return this._setCursor((x.params[0]||1)-1,this._activeBuffer.y),!0}hPositionRelative(x){return this._moveCursor(x.params[0]||1,0),!0}linePosAbsolute(x){return this._setCursor(this._activeBuffer.x,(x.params[0]||1)-1),!0}vPositionRelative(x){return this._moveCursor(0,x.params[0]||1),!0}hVPosition(x){return this.cursorPosition(x),!0}tabClear(x){let E=x.params[0];return E===0?delete this._activeBuffer.tabs[this._activeBuffer.x]:E===3&&(this._activeBuffer.tabs={}),!0}cursorForwardTab(x){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let E=x.params[0]||1;for(;E--;)this._activeBuffer.x=this._activeBuffer.nextStop();return!0}cursorBackwardTab(x){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let E=x.params[0]||1;for(;E--;)this._activeBuffer.x=this._activeBuffer.prevStop();return!0}selectProtected(x){let E=x.params[0];return E===1&&(this._curAttrData.bg|=536870912),E!==2&&E!==0||(this._curAttrData.bg&=-536870913),!0}_eraseInBufferLine(x,E,A,R=!1,N=!1){let j=this._activeBuffer.lines.get(this._activeBuffer.ybase+x);j.replaceCells(E,A,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData(),N),R&&(j.isWrapped=!1)}_resetBufferLine(x,E=!1){let A=this._activeBuffer.lines.get(this._activeBuffer.ybase+x);A&&(A.fill(this._activeBuffer.getNullCell(this._eraseAttrData()),E),this._bufferService.buffer.clearMarkers(this._activeBuffer.ybase+x),A.isWrapped=!1)}eraseInDisplay(x,E=!1){let A;switch(this._restrictCursor(this._bufferService.cols),x.params[0]){case 0:for(A=this._activeBuffer.y,this._dirtyRowTracker.markDirty(A),this._eraseInBufferLine(A++,this._activeBuffer.x,this._bufferService.cols,this._activeBuffer.x===0,E);A<this._bufferService.rows;A++)this._resetBufferLine(A,E);this._dirtyRowTracker.markDirty(A);break;case 1:for(A=this._activeBuffer.y,this._dirtyRowTracker.markDirty(A),this._eraseInBufferLine(A,0,this._activeBuffer.x+1,!0,E),this._activeBuffer.x+1>=this._bufferService.cols&&(this._activeBuffer.lines.get(A+1).isWrapped=!1);A--;)this._resetBufferLine(A,E);this._dirtyRowTracker.markDirty(0);break;case 2:for(A=this._bufferService.rows,this._dirtyRowTracker.markDirty(A-1);A--;)this._resetBufferLine(A,E);this._dirtyRowTracker.markDirty(0);break;case 3:let R=this._activeBuffer.lines.length-this._bufferService.rows;R>0&&(this._activeBuffer.lines.trimStart(R),this._activeBuffer.ybase=Math.max(this._activeBuffer.ybase-R,0),this._activeBuffer.ydisp=Math.max(this._activeBuffer.ydisp-R,0),this._onScroll.fire(0))}return!0}eraseInLine(x,E=!1){switch(this._restrictCursor(this._bufferService.cols),x.params[0]){case 0:this._eraseInBufferLine(this._activeBuffer.y,this._activeBuffer.x,this._bufferService.cols,this._activeBuffer.x===0,E);break;case 1:this._eraseInBufferLine(this._activeBuffer.y,0,this._activeBuffer.x+1,!1,E);break;case 2:this._eraseInBufferLine(this._activeBuffer.y,0,this._bufferService.cols,!0,E)}return this._dirtyRowTracker.markDirty(this._activeBuffer.y),!0}insertLines(x){this._restrictCursor();let E=x.params[0]||1;if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let A=this._activeBuffer.ybase+this._activeBuffer.y,R=this._bufferService.rows-1-this._activeBuffer.scrollBottom,N=this._bufferService.rows-1+this._activeBuffer.ybase-R+1;for(;E--;)this._activeBuffer.lines.splice(N-1,1),this._activeBuffer.lines.splice(A,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y,this._activeBuffer.scrollBottom),this._activeBuffer.x=0,!0}deleteLines(x){this._restrictCursor();let E=x.params[0]||1;if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let A=this._activeBuffer.ybase+this._activeBuffer.y,R;for(R=this._bufferService.rows-1-this._activeBuffer.scrollBottom,R=this._bufferService.rows-1+this._activeBuffer.ybase-R;E--;)this._activeBuffer.lines.splice(A,1),this._activeBuffer.lines.splice(R,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y,this._activeBuffer.scrollBottom),this._activeBuffer.x=0,!0}insertChars(x){this._restrictCursor();let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return E&&(E.insertCells(this._activeBuffer.x,x.params[0]||1,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}deleteChars(x){this._restrictCursor();let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return E&&(E.deleteCells(this._activeBuffer.x,x.params[0]||1,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}scrollUp(x){let E=x.params[0]||1;for(;E--;)this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollTop,1),this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollBottom,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollDown(x){let E=x.params[0]||1;for(;E--;)this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollBottom,1),this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollTop,0,this._activeBuffer.getBlankLine(o.DEFAULT_ATTR_DATA));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollLeft(x){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=x.params[0]||1;for(let A=this._activeBuffer.scrollTop;A<=this._activeBuffer.scrollBottom;++A){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+A);R.deleteCells(0,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollRight(x){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=x.params[0]||1;for(let A=this._activeBuffer.scrollTop;A<=this._activeBuffer.scrollBottom;++A){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+A);R.insertCells(0,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}insertColumns(x){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=x.params[0]||1;for(let A=this._activeBuffer.scrollTop;A<=this._activeBuffer.scrollBottom;++A){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+A);R.insertCells(this._activeBuffer.x,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}deleteColumns(x){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=x.params[0]||1;for(let A=this._activeBuffer.scrollTop;A<=this._activeBuffer.scrollBottom;++A){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+A);R.deleteCells(this._activeBuffer.x,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}eraseChars(x){this._restrictCursor();let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return E&&(E.replaceCells(this._activeBuffer.x,this._activeBuffer.x+(x.params[0]||1),this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}repeatPrecedingCharacter(x){if(!this._parser.precedingCodepoint)return!0;let E=x.params[0]||1,A=new Uint32Array(E);for(let R=0;R<E;++R)A[R]=this._parser.precedingCodepoint;return this.print(A,0,A.length),!0}sendDeviceAttributesPrimary(x){return x.params[0]>0||(this._is("xterm")||this._is("rxvt-unicode")||this._is("screen")?this._coreService.triggerDataEvent(d.C0.ESC+"[?1;2c"):this._is("linux")&&this._coreService.triggerDataEvent(d.C0.ESC+"[?6c")),!0}sendDeviceAttributesSecondary(x){return x.params[0]>0||(this._is("xterm")?this._coreService.triggerDataEvent(d.C0.ESC+"[>0;276;0c"):this._is("rxvt-unicode")?this._coreService.triggerDataEvent(d.C0.ESC+"[>85;95;0c"):this._is("linux")?this._coreService.triggerDataEvent(x.params[0]+"c"):this._is("screen")&&this._coreService.triggerDataEvent(d.C0.ESC+"[>83;40003;0c")),!0}_is(x){return(this._optionsService.rawOptions.termName+"").indexOf(x)===0}setMode(x){for(let E=0;E<x.length;E++)switch(x.params[E]){case 4:this._coreService.modes.insertMode=!0;break;case 20:this._optionsService.options.convertEol=!0}return!0}setModePrivate(x){for(let E=0;E<x.length;E++)switch(x.params[E]){case 1:this._coreService.decPrivateModes.applicationCursorKeys=!0;break;case 2:this._charsetService.setgCharset(0,f.DEFAULT_CHARSET),this._charsetService.setgCharset(1,f.DEFAULT_CHARSET),this._charsetService.setgCharset(2,f.DEFAULT_CHARSET),this._charsetService.setgCharset(3,f.DEFAULT_CHARSET);break;case 3:this._optionsService.rawOptions.windowOptions.setWinLines&&(this._bufferService.resize(132,this._bufferService.rows),this._onRequestReset.fire());break;case 6:this._coreService.decPrivateModes.origin=!0,this._setCursor(0,0);break;case 7:this._coreService.decPrivateModes.wraparound=!0;break;case 12:this._optionsService.options.cursorBlink=!0;break;case 45:this._coreService.decPrivateModes.reverseWraparound=!0;break;case 66:this._logService.debug("Serial port requested application keypad."),this._coreService.decPrivateModes.applicationKeypad=!0,this._onRequestSyncScrollBar.fire();break;case 9:this._coreMouseService.activeProtocol="X10";break;case 1e3:this._coreMouseService.activeProtocol="VT200";break;case 1002:this._coreMouseService.activeProtocol="DRAG";break;case 1003:this._coreMouseService.activeProtocol="ANY";break;case 1004:this._coreService.decPrivateModes.sendFocus=!0,this._onRequestSendFocus.fire();break;case 1005:this._logService.debug("DECSET 1005 not supported (see #2507)");break;case 1006:this._coreMouseService.activeEncoding="SGR";break;case 1015:this._logService.debug("DECSET 1015 not supported (see #2507)");break;case 1016:this._coreMouseService.activeEncoding="SGR_PIXELS";break;case 25:this._coreService.isCursorHidden=!1;break;case 1048:this.saveCursor();break;case 1049:this.saveCursor();case 47:case 1047:this._bufferService.buffers.activateAltBuffer(this._eraseAttrData()),this._coreService.isCursorInitialized=!0,this._onRequestRefreshRows.fire(0,this._bufferService.rows-1),this._onRequestSyncScrollBar.fire();break;case 2004:this._coreService.decPrivateModes.bracketedPasteMode=!0}return!0}resetMode(x){for(let E=0;E<x.length;E++)switch(x.params[E]){case 4:this._coreService.modes.insertMode=!1;break;case 20:this._optionsService.options.convertEol=!1}return!0}resetModePrivate(x){for(let E=0;E<x.length;E++)switch(x.params[E]){case 1:this._coreService.decPrivateModes.applicationCursorKeys=!1;break;case 3:this._optionsService.rawOptions.windowOptions.setWinLines&&(this._bufferService.resize(80,this._bufferService.rows),this._onRequestReset.fire());break;case 6:this._coreService.decPrivateModes.origin=!1,this._setCursor(0,0);break;case 7:this._coreService.decPrivateModes.wraparound=!1;break;case 12:this._optionsService.options.cursorBlink=!1;break;case 45:this._coreService.decPrivateModes.reverseWraparound=!1;break;case 66:this._logService.debug("Switching back to normal keypad."),this._coreService.decPrivateModes.applicationKeypad=!1,this._onRequestSyncScrollBar.fire();break;case 9:case 1e3:case 1002:case 1003:this._coreMouseService.activeProtocol="NONE";break;case 1004:this._coreService.decPrivateModes.sendFocus=!1;break;case 1005:this._logService.debug("DECRST 1005 not supported (see #2507)");break;case 1006:case 1016:this._coreMouseService.activeEncoding="DEFAULT";break;case 1015:this._logService.debug("DECRST 1015 not supported (see #2507)");break;case 25:this._coreService.isCursorHidden=!0;break;case 1048:this.restoreCursor();break;case 1049:case 47:case 1047:this._bufferService.buffers.activateNormalBuffer(),x.params[E]===1049&&this.restoreCursor(),this._coreService.isCursorInitialized=!0,this._onRequestRefreshRows.fire(0,this._bufferService.rows-1),this._onRequestSyncScrollBar.fire();break;case 2004:this._coreService.decPrivateModes.bracketedPasteMode=!1}return!0}requestMode(x,E){let A=this._coreService.decPrivateModes,{activeProtocol:R,activeEncoding:N}=this._coreMouseService,j=this._coreService,{buffers:X,cols:K}=this._bufferService,{active:he,alt:k}=X,F=this._optionsService.rawOptions,U=de=>de?1:2,W=x.params[0];return ee=W,q=E?W===2?4:W===4?U(j.modes.insertMode):W===12?3:W===20?U(F.convertEol):0:W===1?U(A.applicationCursorKeys):W===3?F.windowOptions.setWinLines?K===80?2:K===132?1:0:0:W===6?U(A.origin):W===7?U(A.wraparound):W===8?3:W===9?U(R==="X10"):W===12?U(F.cursorBlink):W===25?U(!j.isCursorHidden):W===45?U(A.reverseWraparound):W===66?U(A.applicationKeypad):W===67?4:W===1e3?U(R==="VT200"):W===1002?U(R==="DRAG"):W===1003?U(R==="ANY"):W===1004?U(A.sendFocus):W===1005?4:W===1006?U(N==="SGR"):W===1015?4:W===1016?U(N==="SGR_PIXELS"):W===1048?1:W===47||W===1047||W===1049?U(he===k):W===2004?U(A.bracketedPasteMode):0,j.triggerDataEvent(`${d.C0.ESC}[${E?"":"?"}${ee};${q}$y`),!0;var ee,q}_updateAttrColor(x,E,A,R,N){return E===2?(x|=50331648,x&=-16777216,x|=_.AttributeData.fromColorRGB([A,R,N])):E===5&&(x&=-50331904,x|=33554432|255&A),x}_extractColor(x,E,A){let R=[0,0,-1,0,0,0],N=0,j=0;do{if(R[j+N]=x.params[E+j],x.hasSubParams(E+j)){let X=x.getSubParams(E+j),K=0;do R[1]===5&&(N=1),R[j+K+1+N]=X[K];while(++K<X.length&&K+j+1+N<R.length);break}if(R[1]===5&&j+N>=2||R[1]===2&&j+N>=5)break;R[1]&&(N=1)}while(++j+E<x.length&&j+N<R.length);for(let X=2;X<R.length;++X)R[X]===-1&&(R[X]=0);switch(R[0]){case 38:A.fg=this._updateAttrColor(A.fg,R[1],R[3],R[4],R[5]);break;case 48:A.bg=this._updateAttrColor(A.bg,R[1],R[3],R[4],R[5]);break;case 58:A.extended=A.extended.clone(),A.extended.underlineColor=this._updateAttrColor(A.extended.underlineColor,R[1],R[3],R[4],R[5])}return j}_processUnderline(x,E){E.extended=E.extended.clone(),(!~x||x>5)&&(x=1),E.extended.underlineStyle=x,E.fg|=268435456,x===0&&(E.fg&=-268435457),E.updateExtended()}_processSGR0(x){x.fg=o.DEFAULT_ATTR_DATA.fg,x.bg=o.DEFAULT_ATTR_DATA.bg,x.extended=x.extended.clone(),x.extended.underlineStyle=0,x.extended.underlineColor&=-67108864,x.updateExtended()}charAttributes(x){if(x.length===1&&x.params[0]===0)return this._processSGR0(this._curAttrData),!0;let E=x.length,A,R=this._curAttrData;for(let N=0;N<E;N++)A=x.params[N],A>=30&&A<=37?(R.fg&=-50331904,R.fg|=16777216|A-30):A>=40&&A<=47?(R.bg&=-50331904,R.bg|=16777216|A-40):A>=90&&A<=97?(R.fg&=-50331904,R.fg|=16777224|A-90):A>=100&&A<=107?(R.bg&=-50331904,R.bg|=16777224|A-100):A===0?this._processSGR0(R):A===1?R.fg|=134217728:A===3?R.bg|=67108864:A===4?(R.fg|=268435456,this._processUnderline(x.hasSubParams(N)?x.getSubParams(N)[0]:1,R)):A===5?R.fg|=536870912:A===7?R.fg|=67108864:A===8?R.fg|=1073741824:A===9?R.fg|=2147483648:A===2?R.bg|=134217728:A===21?this._processUnderline(2,R):A===22?(R.fg&=-134217729,R.bg&=-134217729):A===23?R.bg&=-67108865:A===24?(R.fg&=-268435457,this._processUnderline(0,R)):A===25?R.fg&=-536870913:A===27?R.fg&=-67108865:A===28?R.fg&=-1073741825:A===29?R.fg&=2147483647:A===39?(R.fg&=-67108864,R.fg|=16777215&o.DEFAULT_ATTR_DATA.fg):A===49?(R.bg&=-67108864,R.bg|=16777215&o.DEFAULT_ATTR_DATA.bg):A===38||A===48||A===58?N+=this._extractColor(x,N,R):A===53?R.bg|=1073741824:A===55?R.bg&=-1073741825:A===59?(R.extended=R.extended.clone(),R.extended.underlineColor=-1,R.updateExtended()):A===100?(R.fg&=-67108864,R.fg|=16777215&o.DEFAULT_ATTR_DATA.fg,R.bg&=-67108864,R.bg|=16777215&o.DEFAULT_ATTR_DATA.bg):this._logService.debug("Unknown SGR attribute: %d.",A);return!0}deviceStatus(x){switch(x.params[0]){case 5:this._coreService.triggerDataEvent(`${d.C0.ESC}[0n`);break;case 6:let E=this._activeBuffer.y+1,A=this._activeBuffer.x+1;this._coreService.triggerDataEvent(`${d.C0.ESC}[${E};${A}R`)}return!0}deviceStatusPrivate(x){if(x.params[0]===6){let E=this._activeBuffer.y+1,A=this._activeBuffer.x+1;this._coreService.triggerDataEvent(`${d.C0.ESC}[?${E};${A}R`)}return!0}softReset(x){return this._coreService.isCursorHidden=!1,this._onRequestSyncScrollBar.fire(),this._activeBuffer.scrollTop=0,this._activeBuffer.scrollBottom=this._bufferService.rows-1,this._curAttrData=o.DEFAULT_ATTR_DATA.clone(),this._coreService.reset(),this._charsetService.reset(),this._activeBuffer.savedX=0,this._activeBuffer.savedY=this._activeBuffer.ybase,this._activeBuffer.savedCurAttrData.fg=this._curAttrData.fg,this._activeBuffer.savedCurAttrData.bg=this._curAttrData.bg,this._activeBuffer.savedCharset=this._charsetService.charset,this._coreService.decPrivateModes.origin=!1,!0}setCursorStyle(x){let E=x.params[0]||1;switch(E){case 1:case 2:this._optionsService.options.cursorStyle="block";break;case 3:case 4:this._optionsService.options.cursorStyle="underline";break;case 5:case 6:this._optionsService.options.cursorStyle="bar"}let A=E%2==1;return this._optionsService.options.cursorBlink=A,!0}setScrollRegion(x){let E=x.params[0]||1,A;return(x.length<2||(A=x.params[1])>this._bufferService.rows||A===0)&&(A=this._bufferService.rows),A>E&&(this._activeBuffer.scrollTop=E-1,this._activeBuffer.scrollBottom=A-1,this._setCursor(0,0)),!0}windowOptions(x){if(!$(x.params[0],this._optionsService.rawOptions.windowOptions))return!0;let E=x.length>1?x.params[1]:0;switch(x.params[0]){case 14:E!==2&&this._onRequestWindowsOptionsReport.fire(T.GET_WIN_SIZE_PIXELS);break;case 16:this._onRequestWindowsOptionsReport.fire(T.GET_CELL_SIZE_PIXELS);break;case 18:this._bufferService&&this._coreService.triggerDataEvent(`${d.C0.ESC}[8;${this._bufferService.rows};${this._bufferService.cols}t`);break;case 22:E!==0&&E!==2||(this._windowTitleStack.push(this._windowTitle),this._windowTitleStack.length>10&&this._windowTitleStack.shift()),E!==0&&E!==1||(this._iconNameStack.push(this._iconName),this._iconNameStack.length>10&&this._iconNameStack.shift());break;case 23:E!==0&&E!==2||this._windowTitleStack.length&&this.setTitle(this._windowTitleStack.pop()),E!==0&&E!==1||this._iconNameStack.length&&this.setIconName(this._iconNameStack.pop())}return!0}saveCursor(x){return this._activeBuffer.savedX=this._activeBuffer.x,this._activeBuffer.savedY=this._activeBuffer.ybase+this._activeBuffer.y,this._activeBuffer.savedCurAttrData.fg=this._curAttrData.fg,this._activeBuffer.savedCurAttrData.bg=this._curAttrData.bg,this._activeBuffer.savedCharset=this._charsetService.charset,!0}restoreCursor(x){return this._activeBuffer.x=this._activeBuffer.savedX||0,this._activeBuffer.y=Math.max(this._activeBuffer.savedY-this._activeBuffer.ybase,0),this._curAttrData.fg=this._activeBuffer.savedCurAttrData.fg,this._curAttrData.bg=this._activeBuffer.savedCurAttrData.bg,this._charsetService.charset=this._savedCharset,this._activeBuffer.savedCharset&&(this._charsetService.charset=this._activeBuffer.savedCharset),this._restrictCursor(),!0}setTitle(x){return this._windowTitle=x,this._onTitleChange.fire(x),!0}setIconName(x){return this._iconName=x,!0}setOrReportIndexedColor(x){let E=[],A=x.split(";");for(;A.length>1;){let R=A.shift(),N=A.shift();if(/^\d+$/.exec(R)){let j=parseInt(R);if(M(j))if(N==="?")E.push({type:0,index:j});else{let X=(0,m.parseColor)(N);X&&E.push({type:1,index:j,color:X})}}}return E.length&&this._onColor.fire(E),!0}setHyperlink(x){let E=x.split(";");return!(E.length<2)&&(E[1]?this._createHyperlink(E[0],E[1]):!E[0]&&this._finishHyperlink())}_createHyperlink(x,E){this._getCurrentLinkId()&&this._finishHyperlink();let A=x.split(":"),R,N=A.findIndex((j=>j.startsWith("id=")));return N!==-1&&(R=A[N].slice(3)||void 0),this._curAttrData.extended=this._curAttrData.extended.clone(),this._curAttrData.extended.urlId=this._oscLinkService.registerLink({id:R,uri:E}),this._curAttrData.updateExtended(),!0}_finishHyperlink(){return this._curAttrData.extended=this._curAttrData.extended.clone(),this._curAttrData.extended.urlId=0,this._curAttrData.updateExtended(),!0}_setOrReportSpecialColor(x,E){let A=x.split(";");for(let R=0;R<A.length&&!(E>=this._specialColors.length);++R,++E)if(A[R]==="?")this._onColor.fire([{type:0,index:this._specialColors[E]}]);else{let N=(0,m.parseColor)(A[R]);N&&this._onColor.fire([{type:1,index:this._specialColors[E],color:N}])}return!0}setOrReportFgColor(x){return this._setOrReportSpecialColor(x,0)}setOrReportBgColor(x){return this._setOrReportSpecialColor(x,1)}setOrReportCursorColor(x){return this._setOrReportSpecialColor(x,2)}restoreIndexedColor(x){if(!x)return this._onColor.fire([{type:2}]),!0;let E=[],A=x.split(";");for(let R=0;R<A.length;++R)if(/^\d+$/.exec(A[R])){let N=parseInt(A[R]);M(N)&&E.push({type:2,index:N})}return E.length&&this._onColor.fire(E),!0}restoreFgColor(x){return this._onColor.fire([{type:2,index:256}]),!0}restoreBgColor(x){return this._onColor.fire([{type:2,index:257}]),!0}restoreCursorColor(x){return this._onColor.fire([{type:2,index:258}]),!0}nextLine(){return this._activeBuffer.x=0,this.index(),!0}keypadApplicationMode(){return this._logService.debug("Serial port requested application keypad."),this._coreService.decPrivateModes.applicationKeypad=!0,this._onRequestSyncScrollBar.fire(),!0}keypadNumericMode(){return this._logService.debug("Switching back to normal keypad."),this._coreService.decPrivateModes.applicationKeypad=!1,this._onRequestSyncScrollBar.fire(),!0}selectDefaultCharset(){return this._charsetService.setgLevel(0),this._charsetService.setgCharset(0,f.DEFAULT_CHARSET),!0}selectCharset(x){return x.length!==2?(this.selectDefaultCharset(),!0):(x[0]==="/"||this._charsetService.setgCharset(S[x[0]],f.CHARSETS[x[1]]||f.DEFAULT_CHARSET),!0)}index(){return this._restrictCursor(),this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData())):this._activeBuffer.y>=this._bufferService.rows&&(this._activeBuffer.y=this._bufferService.rows-1),this._restrictCursor(),!0}tabSet(){return this._activeBuffer.tabs[this._activeBuffer.x]=!0,!0}reverseIndex(){if(this._restrictCursor(),this._activeBuffer.y===this._activeBuffer.scrollTop){let x=this._activeBuffer.scrollBottom-this._activeBuffer.scrollTop;this._activeBuffer.lines.shiftElements(this._activeBuffer.ybase+this._activeBuffer.y,x,1),this._activeBuffer.lines.set(this._activeBuffer.ybase+this._activeBuffer.y,this._activeBuffer.getBlankLine(this._eraseAttrData())),this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom)}else this._activeBuffer.y--,this._restrictCursor();return!0}fullReset(){return this._parser.reset(),this._onRequestReset.fire(),!0}reset(){this._curAttrData=o.DEFAULT_ATTR_DATA.clone(),this._eraseAttrDataInternal=o.DEFAULT_ATTR_DATA.clone()}_eraseAttrData(){return this._eraseAttrDataInternal.bg&=-67108864,this._eraseAttrDataInternal.bg|=67108863&this._curAttrData.bg,this._eraseAttrDataInternal}setgLevel(x){return this._charsetService.setgLevel(x),!0}screenAlignmentPattern(){let x=new h.CellData;x.content=4194373,x.fg=this._curAttrData.fg,x.bg=this._curAttrData.bg,this._setCursor(0,0);for(let E=0;E<this._bufferService.rows;++E){let A=this._activeBuffer.ybase+this._activeBuffer.y+E,R=this._activeBuffer.lines.get(A);R&&(R.fill(x),R.isWrapped=!1)}return this._dirtyRowTracker.markAllDirty(),this._setCursor(0,0),!0}requestStatusString(x,E){let A=this._bufferService.buffer,R=this._optionsService.rawOptions;return(N=>(this._coreService.triggerDataEvent(`${d.C0.ESC}${N}${d.C0.ESC}\\`),!0))(x==='"q'?`P1$r${this._curAttrData.isProtected()?1:0}"q`:x==='"p'?'P1$r61;1"p':x==="r"?`P1$r${A.scrollTop+1};${A.scrollBottom+1}r`:x==="m"?"P1$r0m":x===" q"?`P1$r${{block:2,underline:4,bar:6}[R.cursorStyle]-(R.cursorBlink?1:0)} q`:"P0$r")}markRangeDirty(x,E){this._dirtyRowTracker.markRangeDirty(x,E)}}i.InputHandler=z;let B=class{constructor(H){this._bufferService=H,this.clearRange()}clearRange(){this.start=this._bufferService.buffer.y,this.end=this._bufferService.buffer.y}markDirty(H){H<this.start?this.start=H:H>this.end&&(this.end=H)}markRangeDirty(H,x){H>x&&(O=H,H=x,x=O),H<this.start&&(this.start=H),x>this.end&&(this.end=x)}markAllDirty(){this.markRangeDirty(0,this._bufferService.rows-1)}};function M(H){return 0<=H&&H<256}B=l([p(0,v.IBufferService)],B)},844:(u,i)=>{function r(l){for(let p of l)p.dispose();l.length=0}Object.defineProperty(i,"__esModule",{value:!0}),i.getDisposeArrayDisposable=i.disposeArray=i.toDisposable=i.MutableDisposable=i.Disposable=void 0,i.Disposable=class{constructor(){this._disposables=[],this._isDisposed=!1}dispose(){this._isDisposed=!0;for(let l of this._disposables)l.dispose();this._disposables.length=0}register(l){return this._disposables.push(l),l}unregister(l){let p=this._disposables.indexOf(l);p!==-1&&this._disposables.splice(p,1)}},i.MutableDisposable=class{constructor(){this._isDisposed=!1}get value(){return this._isDisposed?void 0:this._value}set value(l){var p;this._isDisposed||l===this._value||((p=this._value)===null||p===void 0||p.dispose(),this._value=l)}clear(){this.value=void 0}dispose(){var l;this._isDisposed=!0,(l=this._value)===null||l===void 0||l.dispose(),this._value=void 0}},i.toDisposable=function(l){return{dispose:l}},i.disposeArray=r,i.getDisposeArrayDisposable=function(l){return{dispose:()=>r(l)}}},1505:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.FourKeyMap=i.TwoKeyMap=void 0;class r{constructor(){this._data={}}set(p,d,f){this._data[p]||(this._data[p]={}),this._data[p][d]=f}get(p,d){return this._data[p]?this._data[p][d]:void 0}clear(){this._data={}}}i.TwoKeyMap=r,i.FourKeyMap=class{constructor(){this._data=new r}set(l,p,d,f,g){this._data.get(l,p)||this._data.set(l,p,new r),this._data.get(l,p).set(d,f,g)}get(l,p,d,f){var g;return(g=this._data.get(l,p))===null||g===void 0?void 0:g.get(d,f)}clear(){this._data.clear()}}},6114:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.isChromeOS=i.isLinux=i.isWindows=i.isIphone=i.isIpad=i.isMac=i.getSafariVersion=i.isSafari=i.isLegacyEdge=i.isFirefox=i.isNode=void 0,i.isNode=typeof navigator>"u";let r=i.isNode?"node":navigator.userAgent,l=i.isNode?"node":navigator.platform;i.isFirefox=r.includes("Firefox"),i.isLegacyEdge=r.includes("Edge"),i.isSafari=/^((?!chrome|android).)*safari/i.test(r),i.getSafariVersion=function(){if(!i.isSafari)return 0;let p=r.match(/Version\/(\d+)/);return p===null||p.length<2?0:parseInt(p[1])},i.isMac=["Macintosh","MacIntel","MacPPC","Mac68K"].includes(l),i.isIpad=l==="iPad",i.isIphone=l==="iPhone",i.isWindows=["Windows","Win16","Win32","WinCE"].includes(l),i.isLinux=l.indexOf("Linux")>=0,i.isChromeOS=/\bCrOS\b/.test(r)},6106:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.SortedList=void 0;let r=0;i.SortedList=class{constructor(l){this._getKey=l,this._array=[]}clear(){this._array.length=0}insert(l){this._array.length!==0?(r=this._search(this._getKey(l)),this._array.splice(r,0,l)):this._array.push(l)}delete(l){if(this._array.length===0)return!1;let p=this._getKey(l);if(p===void 0||(r=this._search(p),r===-1)||this._getKey(this._array[r])!==p)return!1;do if(this._array[r]===l)return this._array.splice(r,1),!0;while(++r<this._array.length&&this._getKey(this._array[r])===p);return!1}*getKeyIterator(l){if(this._array.length!==0&&(r=this._search(l),!(r<0||r>=this._array.length)&&this._getKey(this._array[r])===l))do yield this._array[r];while(++r<this._array.length&&this._getKey(this._array[r])===l)}forEachByKey(l,p){if(this._array.length!==0&&(r=this._search(l),!(r<0||r>=this._array.length)&&this._getKey(this._array[r])===l))do p(this._array[r]);while(++r<this._array.length&&this._getKey(this._array[r])===l)}values(){return[...this._array].values()}_search(l){let p=0,d=this._array.length-1;for(;d>=p;){let f=p+d>>1,g=this._getKey(this._array[f]);if(g>l)d=f-1;else{if(!(g<l)){for(;f>0&&this._getKey(this._array[f-1])===l;)f--;return f}p=f+1}}return p}}},7226:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DebouncedIdleTask=i.IdleTaskQueue=i.PriorityTaskQueue=void 0;let l=r(6114);class p{constructor(){this._tasks=[],this._i=0}enqueue(g){this._tasks.push(g),this._start()}flush(){for(;this._i<this._tasks.length;)this._tasks[this._i]()||this._i++;this.clear()}clear(){this._idleCallback&&(this._cancelCallback(this._idleCallback),this._idleCallback=void 0),this._i=0,this._tasks.length=0}_start(){this._idleCallback||(this._idleCallback=this._requestCallback(this._process.bind(this)))}_process(g){this._idleCallback=void 0;let w=0,b=0,o=g.timeRemaining(),a=0;for(;this._i<this._tasks.length;){if(w=Date.now(),this._tasks[this._i]()||this._i++,w=Math.max(1,Date.now()-w),b=Math.max(w,b),a=g.timeRemaining(),1.5*b>a)return o-w<-20&&console.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(o-w))}ms`),void this._start();o=a}this.clear()}}class d extends p{_requestCallback(g){return setTimeout((()=>g(this._createDeadline(16))))}_cancelCallback(g){clearTimeout(g)}_createDeadline(g){let w=Date.now()+g;return{timeRemaining:()=>Math.max(0,w-Date.now())}}}i.PriorityTaskQueue=d,i.IdleTaskQueue=!l.isNode&&"requestIdleCallback"in window?class extends p{_requestCallback(f){return requestIdleCallback(f)}_cancelCallback(f){cancelIdleCallback(f)}}:d,i.DebouncedIdleTask=class{constructor(){this._queue=new i.IdleTaskQueue}set(f){this._queue.clear(),this._queue.enqueue(f)}flush(){this._queue.flush()}}},9282:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.updateWindowsModeWrappedState=void 0;let l=r(643);i.updateWindowsModeWrappedState=function(p){let d=p.buffer.lines.get(p.buffer.ybase+p.buffer.y-1),f=d?.get(p.cols-1),g=p.buffer.lines.get(p.buffer.ybase+p.buffer.y);g&&f&&(g.isWrapped=f[l.CHAR_DATA_CODE_INDEX]!==l.NULL_CELL_CODE&&f[l.CHAR_DATA_CODE_INDEX]!==l.WHITESPACE_CELL_CODE)}},3734:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ExtendedAttrs=i.AttributeData=void 0;class r{constructor(){this.fg=0,this.bg=0,this.extended=new l}static toColorRGB(d){return[d>>>16&255,d>>>8&255,255&d]}static fromColorRGB(d){return(255&d[0])<<16|(255&d[1])<<8|255&d[2]}clone(){let d=new r;return d.fg=this.fg,d.bg=this.bg,d.extended=this.extended.clone(),d}isInverse(){return 67108864&this.fg}isBold(){return 134217728&this.fg}isUnderline(){return this.hasExtendedAttrs()&&this.extended.underlineStyle!==0?1:268435456&this.fg}isBlink(){return 536870912&this.fg}isInvisible(){return 1073741824&this.fg}isItalic(){return 67108864&this.bg}isDim(){return 134217728&this.bg}isStrikethrough(){return 2147483648&this.fg}isProtected(){return 536870912&this.bg}isOverline(){return 1073741824&this.bg}getFgColorMode(){return 50331648&this.fg}getBgColorMode(){return 50331648&this.bg}isFgRGB(){return(50331648&this.fg)==50331648}isBgRGB(){return(50331648&this.bg)==50331648}isFgPalette(){return(50331648&this.fg)==16777216||(50331648&this.fg)==33554432}isBgPalette(){return(50331648&this.bg)==16777216||(50331648&this.bg)==33554432}isFgDefault(){return(50331648&this.fg)==0}isBgDefault(){return(50331648&this.bg)==0}isAttributeDefault(){return this.fg===0&&this.bg===0}getFgColor(){switch(50331648&this.fg){case 16777216:case 33554432:return 255&this.fg;case 50331648:return 16777215&this.fg;default:return-1}}getBgColor(){switch(50331648&this.bg){case 16777216:case 33554432:return 255&this.bg;case 50331648:return 16777215&this.bg;default:return-1}}hasExtendedAttrs(){return 268435456&this.bg}updateExtended(){this.extended.isEmpty()?this.bg&=-268435457:this.bg|=268435456}getUnderlineColor(){if(268435456&this.bg&&~this.extended.underlineColor)switch(50331648&this.extended.underlineColor){case 16777216:case 33554432:return 255&this.extended.underlineColor;case 50331648:return 16777215&this.extended.underlineColor;default:return this.getFgColor()}return this.getFgColor()}getUnderlineColorMode(){return 268435456&this.bg&&~this.extended.underlineColor?50331648&this.extended.underlineColor:this.getFgColorMode()}isUnderlineColorRGB(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==50331648:this.isFgRGB()}isUnderlineColorPalette(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==16777216||(50331648&this.extended.underlineColor)==33554432:this.isFgPalette()}isUnderlineColorDefault(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==0:this.isFgDefault()}getUnderlineStyle(){return 268435456&this.fg?268435456&this.bg?this.extended.underlineStyle:1:0}}i.AttributeData=r;class l{get ext(){return this._urlId?-469762049&this._ext|this.underlineStyle<<26:this._ext}set ext(d){this._ext=d}get underlineStyle(){return this._urlId?5:(469762048&this._ext)>>26}set underlineStyle(d){this._ext&=-469762049,this._ext|=d<<26&469762048}get underlineColor(){return 67108863&this._ext}set underlineColor(d){this._ext&=-67108864,this._ext|=67108863&d}get urlId(){return this._urlId}set urlId(d){this._urlId=d}constructor(d=0,f=0){this._ext=0,this._urlId=0,this._ext=d,this._urlId=f}clone(){return new l(this._ext,this._urlId)}isEmpty(){return this.underlineStyle===0&&this._urlId===0}}i.ExtendedAttrs=l},9092:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Buffer=i.MAX_BUFFER_SIZE=void 0;let l=r(6349),p=r(7226),d=r(3734),f=r(8437),g=r(4634),w=r(511),b=r(643),o=r(4863),a=r(7116);i.MAX_BUFFER_SIZE=4294967295,i.Buffer=class{constructor(c,h,_){this._hasScrollback=c,this._optionsService=h,this._bufferService=_,this.ydisp=0,this.ybase=0,this.y=0,this.x=0,this.tabs={},this.savedY=0,this.savedX=0,this.savedCurAttrData=f.DEFAULT_ATTR_DATA.clone(),this.savedCharset=a.DEFAULT_CHARSET,this.markers=[],this._nullCell=w.CellData.fromCharData([0,b.NULL_CELL_CHAR,b.NULL_CELL_WIDTH,b.NULL_CELL_CODE]),this._whitespaceCell=w.CellData.fromCharData([0,b.WHITESPACE_CELL_CHAR,b.WHITESPACE_CELL_WIDTH,b.WHITESPACE_CELL_CODE]),this._isClearing=!1,this._memoryCleanupQueue=new p.IdleTaskQueue,this._memoryCleanupPosition=0,this._cols=this._bufferService.cols,this._rows=this._bufferService.rows,this.lines=new l.CircularList(this._getCorrectBufferLength(this._rows)),this.scrollTop=0,this.scrollBottom=this._rows-1,this.setupTabStops()}getNullCell(c){return c?(this._nullCell.fg=c.fg,this._nullCell.bg=c.bg,this._nullCell.extended=c.extended):(this._nullCell.fg=0,this._nullCell.bg=0,this._nullCell.extended=new d.ExtendedAttrs),this._nullCell}getWhitespaceCell(c){return c?(this._whitespaceCell.fg=c.fg,this._whitespaceCell.bg=c.bg,this._whitespaceCell.extended=c.extended):(this._whitespaceCell.fg=0,this._whitespaceCell.bg=0,this._whitespaceCell.extended=new d.ExtendedAttrs),this._whitespaceCell}getBlankLine(c,h){return new f.BufferLine(this._bufferService.cols,this.getNullCell(c),h)}get hasScrollback(){return this._hasScrollback&&this.lines.maxLength>this._rows}get isCursorInViewport(){let c=this.ybase+this.y-this.ydisp;return c>=0&&c<this._rows}_getCorrectBufferLength(c){if(!this._hasScrollback)return c;let h=c+this._optionsService.rawOptions.scrollback;return h>i.MAX_BUFFER_SIZE?i.MAX_BUFFER_SIZE:h}fillViewportRows(c){if(this.lines.length===0){c===void 0&&(c=f.DEFAULT_ATTR_DATA);let h=this._rows;for(;h--;)this.lines.push(this.getBlankLine(c))}}clear(){this.ydisp=0,this.ybase=0,this.y=0,this.x=0,this.lines=new l.CircularList(this._getCorrectBufferLength(this._rows)),this.scrollTop=0,this.scrollBottom=this._rows-1,this.setupTabStops()}resize(c,h){let _=this.getNullCell(f.DEFAULT_ATTR_DATA),v=0,y=this._getCorrectBufferLength(h);if(y>this.lines.maxLength&&(this.lines.maxLength=y),this.lines.length>0){if(this._cols<c)for(let m=0;m<this.lines.length;m++)v+=+this.lines.get(m).resize(c,_);let C=0;if(this._rows<h)for(let m=this._rows;m<h;m++)this.lines.length<h+this.ybase&&(this._optionsService.rawOptions.windowsMode||this._optionsService.rawOptions.windowsPty.backend!==void 0||this._optionsService.rawOptions.windowsPty.buildNumber!==void 0?this.lines.push(new f.BufferLine(c,_)):this.ybase>0&&this.lines.length<=this.ybase+this.y+C+1?(this.ybase--,C++,this.ydisp>0&&this.ydisp--):this.lines.push(new f.BufferLine(c,_)));else for(let m=this._rows;m>h;m--)this.lines.length>h+this.ybase&&(this.lines.length>this.ybase+this.y+1?this.lines.pop():(this.ybase++,this.ydisp++));if(y<this.lines.maxLength){let m=this.lines.length-y;m>0&&(this.lines.trimStart(m),this.ybase=Math.max(this.ybase-m,0),this.ydisp=Math.max(this.ydisp-m,0),this.savedY=Math.max(this.savedY-m,0)),this.lines.maxLength=y}this.x=Math.min(this.x,c-1),this.y=Math.min(this.y,h-1),C&&(this.y+=C),this.savedX=Math.min(this.savedX,c-1),this.scrollTop=0}if(this.scrollBottom=h-1,this._isReflowEnabled&&(this._reflow(c,h),this._cols>c))for(let C=0;C<this.lines.length;C++)v+=+this.lines.get(C).resize(c,_);this._cols=c,this._rows=h,this._memoryCleanupQueue.clear(),v>.1*this.lines.length&&(this._memoryCleanupPosition=0,this._memoryCleanupQueue.enqueue((()=>this._batchedMemoryCleanup())))}_batchedMemoryCleanup(){let c=!0;this._memoryCleanupPosition>=this.lines.length&&(this._memoryCleanupPosition=0,c=!1);let h=0;for(;this._memoryCleanupPosition<this.lines.length;)if(h+=this.lines.get(this._memoryCleanupPosition++).cleanupMemory(),h>100)return!0;return c}get _isReflowEnabled(){let c=this._optionsService.rawOptions.windowsPty;return c&&c.buildNumber?this._hasScrollback&&c.backend==="conpty"&&c.buildNumber>=21376:this._hasScrollback&&!this._optionsService.rawOptions.windowsMode}_reflow(c,h){this._cols!==c&&(c>this._cols?this._reflowLarger(c,h):this._reflowSmaller(c,h))}_reflowLarger(c,h){let _=(0,g.reflowLargerGetLinesToRemove)(this.lines,this._cols,c,this.ybase+this.y,this.getNullCell(f.DEFAULT_ATTR_DATA));if(_.length>0){let v=(0,g.reflowLargerCreateNewLayout)(this.lines,_);(0,g.reflowLargerApplyNewLayout)(this.lines,v.layout),this._reflowLargerAdjustViewport(c,h,v.countRemoved)}}_reflowLargerAdjustViewport(c,h,_){let v=this.getNullCell(f.DEFAULT_ATTR_DATA),y=_;for(;y-- >0;)this.ybase===0?(this.y>0&&this.y--,this.lines.length<h&&this.lines.push(new f.BufferLine(c,v))):(this.ydisp===this.ybase&&this.ydisp--,this.ybase--);this.savedY=Math.max(this.savedY-_,0)}_reflowSmaller(c,h){let _=this.getNullCell(f.DEFAULT_ATTR_DATA),v=[],y=0;for(let C=this.lines.length-1;C>=0;C--){let m=this.lines.get(C);if(!m||!m.isWrapped&&m.getTrimmedLength()<=c)continue;let S=[m];for(;m.isWrapped&&C>0;)m=this.lines.get(--C),S.unshift(m);let L=this.ybase+this.y;if(L>=C&&L<C+S.length)continue;let $=S[S.length-1].getTrimmedLength(),T=(0,g.reflowSmallerGetNewLineLengths)(S,this._cols,c),O=T.length-S.length,z;z=this.ybase===0&&this.y!==this.lines.length-1?Math.max(0,this.y-this.lines.maxLength+O):Math.max(0,this.lines.length-this.lines.maxLength+O);let B=[];for(let R=0;R<O;R++){let N=this.getBlankLine(f.DEFAULT_ATTR_DATA,!0);B.push(N)}B.length>0&&(v.push({start:C+S.length+y,newLines:B}),y+=B.length),S.push(...B);let M=T.length-1,H=T[M];H===0&&(M--,H=T[M]);let x=S.length-O-1,E=$;for(;x>=0;){let R=Math.min(E,H);if(S[M]===void 0)break;if(S[M].copyCellsFrom(S[x],E-R,H-R,R,!0),H-=R,H===0&&(M--,H=T[M]),E-=R,E===0){x--;let N=Math.max(x,0);E=(0,g.getWrappedLineTrimmedLength)(S,N,this._cols)}}for(let R=0;R<S.length;R++)T[R]<c&&S[R].setCell(T[R],_);let A=O-z;for(;A-- >0;)this.ybase===0?this.y<h-1?(this.y++,this.lines.pop()):(this.ybase++,this.ydisp++):this.ybase<Math.min(this.lines.maxLength,this.lines.length+y)-h&&(this.ybase===this.ydisp&&this.ydisp++,this.ybase++);this.savedY=Math.min(this.savedY+O,this.ybase+h-1)}if(v.length>0){let C=[],m=[];for(let M=0;M<this.lines.length;M++)m.push(this.lines.get(M));let S=this.lines.length,L=S-1,$=0,T=v[$];this.lines.length=Math.min(this.lines.maxLength,this.lines.length+y);let O=0;for(let M=Math.min(this.lines.maxLength-1,S+y-1);M>=0;M--)if(T&&T.start>L+O){for(let H=T.newLines.length-1;H>=0;H--)this.lines.set(M--,T.newLines[H]);M++,C.push({index:L+1,amount:T.newLines.length}),O+=T.newLines.length,T=v[++$]}else this.lines.set(M,m[L--]);let z=0;for(let M=C.length-1;M>=0;M--)C[M].index+=z,this.lines.onInsertEmitter.fire(C[M]),z+=C[M].amount;let B=Math.max(0,S+y-this.lines.maxLength);B>0&&this.lines.onTrimEmitter.fire(B)}}translateBufferLineToString(c,h,_=0,v){let y=this.lines.get(c);return y?y.translateToString(h,_,v):""}getWrappedRangeForLine(c){let h=c,_=c;for(;h>0&&this.lines.get(h).isWrapped;)h--;for(;_+1<this.lines.length&&this.lines.get(_+1).isWrapped;)_++;return{first:h,last:_}}setupTabStops(c){for(c!=null?this.tabs[c]||(c=this.prevStop(c)):(this.tabs={},c=0);c<this._cols;c+=this._optionsService.rawOptions.tabStopWidth)this.tabs[c]=!0}prevStop(c){for(c==null&&(c=this.x);!this.tabs[--c]&&c>0;);return c>=this._cols?this._cols-1:c<0?0:c}nextStop(c){for(c==null&&(c=this.x);!this.tabs[++c]&&c<this._cols;);return c>=this._cols?this._cols-1:c<0?0:c}clearMarkers(c){this._isClearing=!0;for(let h=0;h<this.markers.length;h++)this.markers[h].line===c&&(this.markers[h].dispose(),this.markers.splice(h--,1));this._isClearing=!1}clearAllMarkers(){this._isClearing=!0;for(let c=0;c<this.markers.length;c++)this.markers[c].dispose(),this.markers.splice(c--,1);this._isClearing=!1}addMarker(c){let h=new o.Marker(c);return this.markers.push(h),h.register(this.lines.onTrim((_=>{h.line-=_,h.line<0&&h.dispose()}))),h.register(this.lines.onInsert((_=>{h.line>=_.index&&(h.line+=_.amount)}))),h.register(this.lines.onDelete((_=>{h.line>=_.index&&h.line<_.index+_.amount&&h.dispose(),h.line>_.index&&(h.line-=_.amount)}))),h.register(h.onDispose((()=>this._removeMarker(h)))),h}_removeMarker(c){this._isClearing||this.markers.splice(this.markers.indexOf(c),1)}}},8437:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferLine=i.DEFAULT_ATTR_DATA=void 0;let l=r(3734),p=r(511),d=r(643),f=r(482);i.DEFAULT_ATTR_DATA=Object.freeze(new l.AttributeData);let g=0;class w{constructor(o,a,c=!1){this.isWrapped=c,this._combined={},this._extendedAttrs={},this._data=new Uint32Array(3*o);let h=a||p.CellData.fromCharData([0,d.NULL_CELL_CHAR,d.NULL_CELL_WIDTH,d.NULL_CELL_CODE]);for(let _=0;_<o;++_)this.setCell(_,h);this.length=o}get(o){let a=this._data[3*o+0],c=2097151&a;return[this._data[3*o+1],2097152&a?this._combined[o]:c?(0,f.stringFromCodePoint)(c):"",a>>22,2097152&a?this._combined[o].charCodeAt(this._combined[o].length-1):c]}set(o,a){this._data[3*o+1]=a[d.CHAR_DATA_ATTR_INDEX],a[d.CHAR_DATA_CHAR_INDEX].length>1?(this._combined[o]=a[1],this._data[3*o+0]=2097152|o|a[d.CHAR_DATA_WIDTH_INDEX]<<22):this._data[3*o+0]=a[d.CHAR_DATA_CHAR_INDEX].charCodeAt(0)|a[d.CHAR_DATA_WIDTH_INDEX]<<22}getWidth(o){return this._data[3*o+0]>>22}hasWidth(o){return 12582912&this._data[3*o+0]}getFg(o){return this._data[3*o+1]}getBg(o){return this._data[3*o+2]}hasContent(o){return 4194303&this._data[3*o+0]}getCodePoint(o){let a=this._data[3*o+0];return 2097152&a?this._combined[o].charCodeAt(this._combined[o].length-1):2097151&a}isCombined(o){return 2097152&this._data[3*o+0]}getString(o){let a=this._data[3*o+0];return 2097152&a?this._combined[o]:2097151&a?(0,f.stringFromCodePoint)(2097151&a):""}isProtected(o){return 536870912&this._data[3*o+2]}loadCell(o,a){return g=3*o,a.content=this._data[g+0],a.fg=this._data[g+1],a.bg=this._data[g+2],2097152&a.content&&(a.combinedData=this._combined[o]),268435456&a.bg&&(a.extended=this._extendedAttrs[o]),a}setCell(o,a){2097152&a.content&&(this._combined[o]=a.combinedData),268435456&a.bg&&(this._extendedAttrs[o]=a.extended),this._data[3*o+0]=a.content,this._data[3*o+1]=a.fg,this._data[3*o+2]=a.bg}setCellFromCodePoint(o,a,c,h,_,v){268435456&_&&(this._extendedAttrs[o]=v),this._data[3*o+0]=a|c<<22,this._data[3*o+1]=h,this._data[3*o+2]=_}addCodepointToCell(o,a){let c=this._data[3*o+0];2097152&c?this._combined[o]+=(0,f.stringFromCodePoint)(a):(2097151&c?(this._combined[o]=(0,f.stringFromCodePoint)(2097151&c)+(0,f.stringFromCodePoint)(a),c&=-2097152,c|=2097152):c=a|4194304,this._data[3*o+0]=c)}insertCells(o,a,c,h){if((o%=this.length)&&this.getWidth(o-1)===2&&this.setCellFromCodePoint(o-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs),a<this.length-o){let _=new p.CellData;for(let v=this.length-o-a-1;v>=0;--v)this.setCell(o+a+v,this.loadCell(o+v,_));for(let v=0;v<a;++v)this.setCell(o+v,c)}else for(let _=o;_<this.length;++_)this.setCell(_,c);this.getWidth(this.length-1)===2&&this.setCellFromCodePoint(this.length-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs)}deleteCells(o,a,c,h){if(o%=this.length,a<this.length-o){let _=new p.CellData;for(let v=0;v<this.length-o-a;++v)this.setCell(o+v,this.loadCell(o+a+v,_));for(let v=this.length-a;v<this.length;++v)this.setCell(v,c)}else for(let _=o;_<this.length;++_)this.setCell(_,c);o&&this.getWidth(o-1)===2&&this.setCellFromCodePoint(o-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs),this.getWidth(o)!==0||this.hasContent(o)||this.setCellFromCodePoint(o,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs)}replaceCells(o,a,c,h,_=!1){if(_)for(o&&this.getWidth(o-1)===2&&!this.isProtected(o-1)&&this.setCellFromCodePoint(o-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs),a<this.length&&this.getWidth(a-1)===2&&!this.isProtected(a)&&this.setCellFromCodePoint(a,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs);o<a&&o<this.length;)this.isProtected(o)||this.setCell(o,c),o++;else for(o&&this.getWidth(o-1)===2&&this.setCellFromCodePoint(o-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs),a<this.length&&this.getWidth(a-1)===2&&this.setCellFromCodePoint(a,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs);o<a&&o<this.length;)this.setCell(o++,c)}resize(o,a){if(o===this.length)return 4*this._data.length*2<this._data.buffer.byteLength;let c=3*o;if(o>this.length){if(this._data.buffer.byteLength>=4*c)this._data=new Uint32Array(this._data.buffer,0,c);else{let h=new Uint32Array(c);h.set(this._data),this._data=h}for(let h=this.length;h<o;++h)this.setCell(h,a)}else{this._data=this._data.subarray(0,c);let h=Object.keys(this._combined);for(let v=0;v<h.length;v++){let y=parseInt(h[v],10);y>=o&&delete this._combined[y]}let _=Object.keys(this._extendedAttrs);for(let v=0;v<_.length;v++){let y=parseInt(_[v],10);y>=o&&delete this._extendedAttrs[y]}}return this.length=o,4*c*2<this._data.buffer.byteLength}cleanupMemory(){if(4*this._data.length*2<this._data.buffer.byteLength){let o=new Uint32Array(this._data.length);return o.set(this._data),this._data=o,1}return 0}fill(o,a=!1){if(a)for(let c=0;c<this.length;++c)this.isProtected(c)||this.setCell(c,o);else{this._combined={},this._extendedAttrs={};for(let c=0;c<this.length;++c)this.setCell(c,o)}}copyFrom(o){this.length!==o.length?this._data=new Uint32Array(o._data):this._data.set(o._data),this.length=o.length,this._combined={};for(let a in o._combined)this._combined[a]=o._combined[a];this._extendedAttrs={};for(let a in o._extendedAttrs)this._extendedAttrs[a]=o._extendedAttrs[a];this.isWrapped=o.isWrapped}clone(){let o=new w(0);o._data=new Uint32Array(this._data),o.length=this.length;for(let a in this._combined)o._combined[a]=this._combined[a];for(let a in this._extendedAttrs)o._extendedAttrs[a]=this._extendedAttrs[a];return o.isWrapped=this.isWrapped,o}getTrimmedLength(){for(let o=this.length-1;o>=0;--o)if(4194303&this._data[3*o+0])return o+(this._data[3*o+0]>>22);return 0}getNoBgTrimmedLength(){for(let o=this.length-1;o>=0;--o)if(4194303&this._data[3*o+0]||50331648&this._data[3*o+2])return o+(this._data[3*o+0]>>22);return 0}copyCellsFrom(o,a,c,h,_){let v=o._data;if(_)for(let C=h-1;C>=0;C--){for(let m=0;m<3;m++)this._data[3*(c+C)+m]=v[3*(a+C)+m];268435456&v[3*(a+C)+2]&&(this._extendedAttrs[c+C]=o._extendedAttrs[a+C])}else for(let C=0;C<h;C++){for(let m=0;m<3;m++)this._data[3*(c+C)+m]=v[3*(a+C)+m];268435456&v[3*(a+C)+2]&&(this._extendedAttrs[c+C]=o._extendedAttrs[a+C])}let y=Object.keys(o._combined);for(let C=0;C<y.length;C++){let m=parseInt(y[C],10);m>=a&&(this._combined[m-a+c]=o._combined[m])}}translateToString(o=!1,a=0,c=this.length){o&&(c=Math.min(c,this.getTrimmedLength()));let h="";for(;a<c;){let _=this._data[3*a+0],v=2097151&_;h+=2097152&_?this._combined[a]:v?(0,f.stringFromCodePoint)(v):d.WHITESPACE_CELL_CHAR,a+=_>>22||1}return h}}i.BufferLine=w},4841:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.getRangeLength=void 0,i.getRangeLength=function(r,l){if(r.start.y>r.end.y)throw new Error(`Buffer range end (${r.end.x}, ${r.end.y}) cannot be before start (${r.start.x}, ${r.start.y})`);return l*(r.end.y-r.start.y)+(r.end.x-r.start.x+1)}},4634:(u,i)=>{function r(l,p,d){if(p===l.length-1)return l[p].getTrimmedLength();let f=!l[p].hasContent(d-1)&&l[p].getWidth(d-1)===1,g=l[p+1].getWidth(0)===2;return f&&g?d-1:d}Object.defineProperty(i,"__esModule",{value:!0}),i.getWrappedLineTrimmedLength=i.reflowSmallerGetNewLineLengths=i.reflowLargerApplyNewLayout=i.reflowLargerCreateNewLayout=i.reflowLargerGetLinesToRemove=void 0,i.reflowLargerGetLinesToRemove=function(l,p,d,f,g){let w=[];for(let b=0;b<l.length-1;b++){let o=b,a=l.get(++o);if(!a.isWrapped)continue;let c=[l.get(b)];for(;o<l.length&&a.isWrapped;)c.push(a),a=l.get(++o);if(f>=b&&f<o){b+=c.length-1;continue}let h=0,_=r(c,h,p),v=1,y=0;for(;v<c.length;){let m=r(c,v,p),S=m-y,L=d-_,$=Math.min(S,L);c[h].copyCellsFrom(c[v],y,_,$,!1),_+=$,_===d&&(h++,_=0),y+=$,y===m&&(v++,y=0),_===0&&h!==0&&c[h-1].getWidth(d-1)===2&&(c[h].copyCellsFrom(c[h-1],d-1,_++,1,!1),c[h-1].setCell(d-1,g))}c[h].replaceCells(_,d,g);let C=0;for(let m=c.length-1;m>0&&(m>h||c[m].getTrimmedLength()===0);m--)C++;C>0&&(w.push(b+c.length-C),w.push(C)),b+=c.length-1}return w},i.reflowLargerCreateNewLayout=function(l,p){let d=[],f=0,g=p[f],w=0;for(let b=0;b<l.length;b++)if(g===b){let o=p[++f];l.onDeleteEmitter.fire({index:b-w,amount:o}),b+=o-1,w+=o,g=p[++f]}else d.push(b);return{layout:d,countRemoved:w}},i.reflowLargerApplyNewLayout=function(l,p){let d=[];for(let f=0;f<p.length;f++)d.push(l.get(p[f]));for(let f=0;f<d.length;f++)l.set(f,d[f]);l.length=p.length},i.reflowSmallerGetNewLineLengths=function(l,p,d){let f=[],g=l.map(((a,c)=>r(l,c,p))).reduce(((a,c)=>a+c)),w=0,b=0,o=0;for(;o<g;){if(g-o<d){f.push(g-o);break}w+=d;let a=r(l,b,p);w>a&&(w-=a,b++);let c=l[b].getWidth(w-1)===2;c&&w--;let h=c?d-1:d;f.push(h),o+=h}return f},i.getWrappedLineTrimmedLength=r},5295:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferSet=void 0;let l=r(8460),p=r(844),d=r(9092);class f extends p.Disposable{constructor(w,b){super(),this._optionsService=w,this._bufferService=b,this._onBufferActivate=this.register(new l.EventEmitter),this.onBufferActivate=this._onBufferActivate.event,this.reset(),this.register(this._optionsService.onSpecificOptionChange("scrollback",(()=>this.resize(this._bufferService.cols,this._bufferService.rows)))),this.register(this._optionsService.onSpecificOptionChange("tabStopWidth",(()=>this.setupTabStops())))}reset(){this._normal=new d.Buffer(!0,this._optionsService,this._bufferService),this._normal.fillViewportRows(),this._alt=new d.Buffer(!1,this._optionsService,this._bufferService),this._activeBuffer=this._normal,this._onBufferActivate.fire({activeBuffer:this._normal,inactiveBuffer:this._alt}),this.setupTabStops()}get alt(){return this._alt}get active(){return this._activeBuffer}get normal(){return this._normal}activateNormalBuffer(){this._activeBuffer!==this._normal&&(this._normal.x=this._alt.x,this._normal.y=this._alt.y,this._alt.clearAllMarkers(),this._alt.clear(),this._activeBuffer=this._normal,this._onBufferActivate.fire({activeBuffer:this._normal,inactiveBuffer:this._alt}))}activateAltBuffer(w){this._activeBuffer!==this._alt&&(this._alt.fillViewportRows(w),this._alt.x=this._normal.x,this._alt.y=this._normal.y,this._activeBuffer=this._alt,this._onBufferActivate.fire({activeBuffer:this._alt,inactiveBuffer:this._normal}))}resize(w,b){this._normal.resize(w,b),this._alt.resize(w,b),this.setupTabStops(w)}setupTabStops(w){this._normal.setupTabStops(w),this._alt.setupTabStops(w)}}i.BufferSet=f},511:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CellData=void 0;let l=r(482),p=r(643),d=r(3734);class f extends d.AttributeData{constructor(){super(...arguments),this.content=0,this.fg=0,this.bg=0,this.extended=new d.ExtendedAttrs,this.combinedData=""}static fromCharData(w){let b=new f;return b.setFromCharData(w),b}isCombined(){return 2097152&this.content}getWidth(){return this.content>>22}getChars(){return 2097152&this.content?this.combinedData:2097151&this.content?(0,l.stringFromCodePoint)(2097151&this.content):""}getCode(){return this.isCombined()?this.combinedData.charCodeAt(this.combinedData.length-1):2097151&this.content}setFromCharData(w){this.fg=w[p.CHAR_DATA_ATTR_INDEX],this.bg=0;let b=!1;if(w[p.CHAR_DATA_CHAR_INDEX].length>2)b=!0;else if(w[p.CHAR_DATA_CHAR_INDEX].length===2){let o=w[p.CHAR_DATA_CHAR_INDEX].charCodeAt(0);if(55296<=o&&o<=56319){let a=w[p.CHAR_DATA_CHAR_INDEX].charCodeAt(1);56320<=a&&a<=57343?this.content=1024*(o-55296)+a-56320+65536|w[p.CHAR_DATA_WIDTH_INDEX]<<22:b=!0}else b=!0}else this.content=w[p.CHAR_DATA_CHAR_INDEX].charCodeAt(0)|w[p.CHAR_DATA_WIDTH_INDEX]<<22;b&&(this.combinedData=w[p.CHAR_DATA_CHAR_INDEX],this.content=2097152|w[p.CHAR_DATA_WIDTH_INDEX]<<22)}getAsCharData(){return[this.fg,this.getChars(),this.getWidth(),this.getCode()]}}i.CellData=f},643:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.WHITESPACE_CELL_CODE=i.WHITESPACE_CELL_WIDTH=i.WHITESPACE_CELL_CHAR=i.NULL_CELL_CODE=i.NULL_CELL_WIDTH=i.NULL_CELL_CHAR=i.CHAR_DATA_CODE_INDEX=i.CHAR_DATA_WIDTH_INDEX=i.CHAR_DATA_CHAR_INDEX=i.CHAR_DATA_ATTR_INDEX=i.DEFAULT_EXT=i.DEFAULT_ATTR=i.DEFAULT_COLOR=void 0,i.DEFAULT_COLOR=0,i.DEFAULT_ATTR=256|i.DEFAULT_COLOR<<9,i.DEFAULT_EXT=0,i.CHAR_DATA_ATTR_INDEX=0,i.CHAR_DATA_CHAR_INDEX=1,i.CHAR_DATA_WIDTH_INDEX=2,i.CHAR_DATA_CODE_INDEX=3,i.NULL_CELL_CHAR="",i.NULL_CELL_WIDTH=1,i.NULL_CELL_CODE=0,i.WHITESPACE_CELL_CHAR=" ",i.WHITESPACE_CELL_WIDTH=1,i.WHITESPACE_CELL_CODE=32},4863:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Marker=void 0;let l=r(8460),p=r(844);class d{get id(){return this._id}constructor(g){this.line=g,this.isDisposed=!1,this._disposables=[],this._id=d._nextId++,this._onDispose=this.register(new l.EventEmitter),this.onDispose=this._onDispose.event}dispose(){this.isDisposed||(this.isDisposed=!0,this.line=-1,this._onDispose.fire(),(0,p.disposeArray)(this._disposables),this._disposables.length=0)}register(g){return this._disposables.push(g),g}}i.Marker=d,d._nextId=1},7116:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DEFAULT_CHARSET=i.CHARSETS=void 0,i.CHARSETS={},i.DEFAULT_CHARSET=i.CHARSETS.B,i.CHARSETS[0]={"`":"\u25C6",a:"\u2592",b:"\u2409",c:"\u240C",d:"\u240D",e:"\u240A",f:"\xB0",g:"\xB1",h:"\u2424",i:"\u240B",j:"\u2518",k:"\u2510",l:"\u250C",m:"\u2514",n:"\u253C",o:"\u23BA",p:"\u23BB",q:"\u2500",r:"\u23BC",s:"\u23BD",t:"\u251C",u:"\u2524",v:"\u2534",w:"\u252C",x:"\u2502",y:"\u2264",z:"\u2265","{":"\u03C0","|":"\u2260","}":"\xA3","~":"\xB7"},i.CHARSETS.A={"#":"\xA3"},i.CHARSETS.B=void 0,i.CHARSETS[4]={"#":"\xA3","@":"\xBE","[":"ij","\\":"\xBD","]":"|","{":"\xA8","|":"f","}":"\xBC","~":"\xB4"},i.CHARSETS.C=i.CHARSETS[5]={"[":"\xC4","\\":"\xD6","]":"\xC5","^":"\xDC","`":"\xE9","{":"\xE4","|":"\xF6","}":"\xE5","~":"\xFC"},i.CHARSETS.R={"#":"\xA3","@":"\xE0","[":"\xB0","\\":"\xE7","]":"\xA7","{":"\xE9","|":"\xF9","}":"\xE8","~":"\xA8"},i.CHARSETS.Q={"@":"\xE0","[":"\xE2","\\":"\xE7","]":"\xEA","^":"\xEE","`":"\xF4","{":"\xE9","|":"\xF9","}":"\xE8","~":"\xFB"},i.CHARSETS.K={"@":"\xA7","[":"\xC4","\\":"\xD6","]":"\xDC","{":"\xE4","|":"\xF6","}":"\xFC","~":"\xDF"},i.CHARSETS.Y={"#":"\xA3","@":"\xA7","[":"\xB0","\\":"\xE7","]":"\xE9","`":"\xF9","{":"\xE0","|":"\xF2","}":"\xE8","~":"\xEC"},i.CHARSETS.E=i.CHARSETS[6]={"@":"\xC4","[":"\xC6","\\":"\xD8","]":"\xC5","^":"\xDC","`":"\xE4","{":"\xE6","|":"\xF8","}":"\xE5","~":"\xFC"},i.CHARSETS.Z={"#":"\xA3","@":"\xA7","[":"\xA1","\\":"\xD1","]":"\xBF","{":"\xB0","|":"\xF1","}":"\xE7"},i.CHARSETS.H=i.CHARSETS[7]={"@":"\xC9","[":"\xC4","\\":"\xD6","]":"\xC5","^":"\xDC","`":"\xE9","{":"\xE4","|":"\xF6","}":"\xE5","~":"\xFC"},i.CHARSETS["="]={"#":"\xF9","@":"\xE0","[":"\xE9","\\":"\xE7","]":"\xEA","^":"\xEE",_:"\xE8","`":"\xF4","{":"\xE4","|":"\xF6","}":"\xFC","~":"\xFB"}},2584:(u,i)=>{var r,l,p;Object.defineProperty(i,"__esModule",{value:!0}),i.C1_ESCAPED=i.C1=i.C0=void 0,(function(d){d.NUL="\0",d.SOH="",d.STX="",d.ETX="",d.EOT="",d.ENQ="",d.ACK="",d.BEL="\x07",d.BS="\b",d.HT="	",d.LF=`
`,d.VT="\v",d.FF="\f",d.CR="\r",d.SO="",d.SI="",d.DLE="",d.DC1="",d.DC2="",d.DC3="",d.DC4="",d.NAK="",d.SYN="",d.ETB="",d.CAN="",d.EM="",d.SUB="",d.ESC="\x1B",d.FS="",d.GS="",d.RS="",d.US="",d.SP=" ",d.DEL="\x7F"})(r||(i.C0=r={})),(function(d){d.PAD="\x80",d.HOP="\x81",d.BPH="\x82",d.NBH="\x83",d.IND="\x84",d.NEL="\x85",d.SSA="\x86",d.ESA="\x87",d.HTS="\x88",d.HTJ="\x89",d.VTS="\x8A",d.PLD="\x8B",d.PLU="\x8C",d.RI="\x8D",d.SS2="\x8E",d.SS3="\x8F",d.DCS="\x90",d.PU1="\x91",d.PU2="\x92",d.STS="\x93",d.CCH="\x94",d.MW="\x95",d.SPA="\x96",d.EPA="\x97",d.SOS="\x98",d.SGCI="\x99",d.SCI="\x9A",d.CSI="\x9B",d.ST="\x9C",d.OSC="\x9D",d.PM="\x9E",d.APC="\x9F"})(l||(i.C1=l={})),(function(d){d.ST=`${r.ESC}\\`})(p||(i.C1_ESCAPED=p={}))},7399:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.evaluateKeyboardEvent=void 0;let l=r(2584),p={48:["0",")"],49:["1","!"],50:["2","@"],51:["3","#"],52:["4","$"],53:["5","%"],54:["6","^"],55:["7","&"],56:["8","*"],57:["9","("],186:[";",":"],187:["=","+"],188:[",","<"],189:["-","_"],190:[".",">"],191:["/","?"],192:["`","~"],219:["[","{"],220:["\\","|"],221:["]","}"],222:["'",'"']};i.evaluateKeyboardEvent=function(d,f,g,w){let b={type:0,cancel:!1,key:void 0},o=(d.shiftKey?1:0)|(d.altKey?2:0)|(d.ctrlKey?4:0)|(d.metaKey?8:0);switch(d.keyCode){case 0:d.key==="UIKeyInputUpArrow"?b.key=f?l.C0.ESC+"OA":l.C0.ESC+"[A":d.key==="UIKeyInputLeftArrow"?b.key=f?l.C0.ESC+"OD":l.C0.ESC+"[D":d.key==="UIKeyInputRightArrow"?b.key=f?l.C0.ESC+"OC":l.C0.ESC+"[C":d.key==="UIKeyInputDownArrow"&&(b.key=f?l.C0.ESC+"OB":l.C0.ESC+"[B");break;case 8:if(d.altKey){b.key=l.C0.ESC+l.C0.DEL;break}b.key=l.C0.DEL;break;case 9:if(d.shiftKey){b.key=l.C0.ESC+"[Z";break}b.key=l.C0.HT,b.cancel=!0;break;case 13:b.key=d.altKey?l.C0.ESC+l.C0.CR:l.C0.CR,b.cancel=!0;break;case 27:b.key=l.C0.ESC,d.altKey&&(b.key=l.C0.ESC+l.C0.ESC),b.cancel=!0;break;case 37:if(d.metaKey)break;o?(b.key=l.C0.ESC+"[1;"+(o+1)+"D",b.key===l.C0.ESC+"[1;3D"&&(b.key=l.C0.ESC+(g?"b":"[1;5D"))):b.key=f?l.C0.ESC+"OD":l.C0.ESC+"[D";break;case 39:if(d.metaKey)break;o?(b.key=l.C0.ESC+"[1;"+(o+1)+"C",b.key===l.C0.ESC+"[1;3C"&&(b.key=l.C0.ESC+(g?"f":"[1;5C"))):b.key=f?l.C0.ESC+"OC":l.C0.ESC+"[C";break;case 38:if(d.metaKey)break;o?(b.key=l.C0.ESC+"[1;"+(o+1)+"A",g||b.key!==l.C0.ESC+"[1;3A"||(b.key=l.C0.ESC+"[1;5A")):b.key=f?l.C0.ESC+"OA":l.C0.ESC+"[A";break;case 40:if(d.metaKey)break;o?(b.key=l.C0.ESC+"[1;"+(o+1)+"B",g||b.key!==l.C0.ESC+"[1;3B"||(b.key=l.C0.ESC+"[1;5B")):b.key=f?l.C0.ESC+"OB":l.C0.ESC+"[B";break;case 45:d.shiftKey||d.ctrlKey||(b.key=l.C0.ESC+"[2~");break;case 46:b.key=o?l.C0.ESC+"[3;"+(o+1)+"~":l.C0.ESC+"[3~";break;case 36:b.key=o?l.C0.ESC+"[1;"+(o+1)+"H":f?l.C0.ESC+"OH":l.C0.ESC+"[H";break;case 35:b.key=o?l.C0.ESC+"[1;"+(o+1)+"F":f?l.C0.ESC+"OF":l.C0.ESC+"[F";break;case 33:d.shiftKey?b.type=2:d.ctrlKey?b.key=l.C0.ESC+"[5;"+(o+1)+"~":b.key=l.C0.ESC+"[5~";break;case 34:d.shiftKey?b.type=3:d.ctrlKey?b.key=l.C0.ESC+"[6;"+(o+1)+"~":b.key=l.C0.ESC+"[6~";break;case 112:b.key=o?l.C0.ESC+"[1;"+(o+1)+"P":l.C0.ESC+"OP";break;case 113:b.key=o?l.C0.ESC+"[1;"+(o+1)+"Q":l.C0.ESC+"OQ";break;case 114:b.key=o?l.C0.ESC+"[1;"+(o+1)+"R":l.C0.ESC+"OR";break;case 115:b.key=o?l.C0.ESC+"[1;"+(o+1)+"S":l.C0.ESC+"OS";break;case 116:b.key=o?l.C0.ESC+"[15;"+(o+1)+"~":l.C0.ESC+"[15~";break;case 117:b.key=o?l.C0.ESC+"[17;"+(o+1)+"~":l.C0.ESC+"[17~";break;case 118:b.key=o?l.C0.ESC+"[18;"+(o+1)+"~":l.C0.ESC+"[18~";break;case 119:b.key=o?l.C0.ESC+"[19;"+(o+1)+"~":l.C0.ESC+"[19~";break;case 120:b.key=o?l.C0.ESC+"[20;"+(o+1)+"~":l.C0.ESC+"[20~";break;case 121:b.key=o?l.C0.ESC+"[21;"+(o+1)+"~":l.C0.ESC+"[21~";break;case 122:b.key=o?l.C0.ESC+"[23;"+(o+1)+"~":l.C0.ESC+"[23~";break;case 123:b.key=o?l.C0.ESC+"[24;"+(o+1)+"~":l.C0.ESC+"[24~";break;default:if(!d.ctrlKey||d.shiftKey||d.altKey||d.metaKey)if(g&&!w||!d.altKey||d.metaKey)!g||d.altKey||d.ctrlKey||d.shiftKey||!d.metaKey?d.key&&!d.ctrlKey&&!d.altKey&&!d.metaKey&&d.keyCode>=48&&d.key.length===1?b.key=d.key:d.key&&d.ctrlKey&&(d.key==="_"&&(b.key=l.C0.US),d.key==="@"&&(b.key=l.C0.NUL)):d.keyCode===65&&(b.type=1);else{let a=p[d.keyCode],c=a?.[d.shiftKey?1:0];if(c)b.key=l.C0.ESC+c;else if(d.keyCode>=65&&d.keyCode<=90){let h=d.ctrlKey?d.keyCode-64:d.keyCode+32,_=String.fromCharCode(h);d.shiftKey&&(_=_.toUpperCase()),b.key=l.C0.ESC+_}else if(d.keyCode===32)b.key=l.C0.ESC+(d.ctrlKey?l.C0.NUL:" ");else if(d.key==="Dead"&&d.code.startsWith("Key")){let h=d.code.slice(3,4);d.shiftKey||(h=h.toLowerCase()),b.key=l.C0.ESC+h,b.cancel=!0}}else d.keyCode>=65&&d.keyCode<=90?b.key=String.fromCharCode(d.keyCode-64):d.keyCode===32?b.key=l.C0.NUL:d.keyCode>=51&&d.keyCode<=55?b.key=String.fromCharCode(d.keyCode-51+27):d.keyCode===56?b.key=l.C0.DEL:d.keyCode===219?b.key=l.C0.ESC:d.keyCode===220?b.key=l.C0.FS:d.keyCode===221&&(b.key=l.C0.GS)}return b}},482:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Utf8ToUtf32=i.StringToUtf32=i.utf32ToString=i.stringFromCodePoint=void 0,i.stringFromCodePoint=function(r){return r>65535?(r-=65536,String.fromCharCode(55296+(r>>10))+String.fromCharCode(r%1024+56320)):String.fromCharCode(r)},i.utf32ToString=function(r,l=0,p=r.length){let d="";for(let f=l;f<p;++f){let g=r[f];g>65535?(g-=65536,d+=String.fromCharCode(55296+(g>>10))+String.fromCharCode(g%1024+56320)):d+=String.fromCharCode(g)}return d},i.StringToUtf32=class{constructor(){this._interim=0}clear(){this._interim=0}decode(r,l){let p=r.length;if(!p)return 0;let d=0,f=0;if(this._interim){let g=r.charCodeAt(f++);56320<=g&&g<=57343?l[d++]=1024*(this._interim-55296)+g-56320+65536:(l[d++]=this._interim,l[d++]=g),this._interim=0}for(let g=f;g<p;++g){let w=r.charCodeAt(g);if(55296<=w&&w<=56319){if(++g>=p)return this._interim=w,d;let b=r.charCodeAt(g);56320<=b&&b<=57343?l[d++]=1024*(w-55296)+b-56320+65536:(l[d++]=w,l[d++]=b)}else w!==65279&&(l[d++]=w)}return d}},i.Utf8ToUtf32=class{constructor(){this.interim=new Uint8Array(3)}clear(){this.interim.fill(0)}decode(r,l){let p=r.length;if(!p)return 0;let d,f,g,w,b=0,o=0,a=0;if(this.interim[0]){let _=!1,v=this.interim[0];v&=(224&v)==192?31:(240&v)==224?15:7;let y,C=0;for(;(y=63&this.interim[++C])&&C<4;)v<<=6,v|=y;let m=(224&this.interim[0])==192?2:(240&this.interim[0])==224?3:4,S=m-C;for(;a<S;){if(a>=p)return 0;if(y=r[a++],(192&y)!=128){a--,_=!0;break}this.interim[C++]=y,v<<=6,v|=63&y}_||(m===2?v<128?a--:l[b++]=v:m===3?v<2048||v>=55296&&v<=57343||v===65279||(l[b++]=v):v<65536||v>1114111||(l[b++]=v)),this.interim.fill(0)}let c=p-4,h=a;for(;h<p;){for(;!(!(h<c)||128&(d=r[h])||128&(f=r[h+1])||128&(g=r[h+2])||128&(w=r[h+3]));)l[b++]=d,l[b++]=f,l[b++]=g,l[b++]=w,h+=4;if(d=r[h++],d<128)l[b++]=d;else if((224&d)==192){if(h>=p)return this.interim[0]=d,b;if(f=r[h++],(192&f)!=128){h--;continue}if(o=(31&d)<<6|63&f,o<128){h--;continue}l[b++]=o}else if((240&d)==224){if(h>=p)return this.interim[0]=d,b;if(f=r[h++],(192&f)!=128){h--;continue}if(h>=p)return this.interim[0]=d,this.interim[1]=f,b;if(g=r[h++],(192&g)!=128){h--;continue}if(o=(15&d)<<12|(63&f)<<6|63&g,o<2048||o>=55296&&o<=57343||o===65279)continue;l[b++]=o}else if((248&d)==240){if(h>=p)return this.interim[0]=d,b;if(f=r[h++],(192&f)!=128){h--;continue}if(h>=p)return this.interim[0]=d,this.interim[1]=f,b;if(g=r[h++],(192&g)!=128){h--;continue}if(h>=p)return this.interim[0]=d,this.interim[1]=f,this.interim[2]=g,b;if(w=r[h++],(192&w)!=128){h--;continue}if(o=(7&d)<<18|(63&f)<<12|(63&g)<<6|63&w,o<65536||o>1114111)continue;l[b++]=o}}return b}}},225:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.UnicodeV6=void 0;let r=[[768,879],[1155,1158],[1160,1161],[1425,1469],[1471,1471],[1473,1474],[1476,1477],[1479,1479],[1536,1539],[1552,1557],[1611,1630],[1648,1648],[1750,1764],[1767,1768],[1770,1773],[1807,1807],[1809,1809],[1840,1866],[1958,1968],[2027,2035],[2305,2306],[2364,2364],[2369,2376],[2381,2381],[2385,2388],[2402,2403],[2433,2433],[2492,2492],[2497,2500],[2509,2509],[2530,2531],[2561,2562],[2620,2620],[2625,2626],[2631,2632],[2635,2637],[2672,2673],[2689,2690],[2748,2748],[2753,2757],[2759,2760],[2765,2765],[2786,2787],[2817,2817],[2876,2876],[2879,2879],[2881,2883],[2893,2893],[2902,2902],[2946,2946],[3008,3008],[3021,3021],[3134,3136],[3142,3144],[3146,3149],[3157,3158],[3260,3260],[3263,3263],[3270,3270],[3276,3277],[3298,3299],[3393,3395],[3405,3405],[3530,3530],[3538,3540],[3542,3542],[3633,3633],[3636,3642],[3655,3662],[3761,3761],[3764,3769],[3771,3772],[3784,3789],[3864,3865],[3893,3893],[3895,3895],[3897,3897],[3953,3966],[3968,3972],[3974,3975],[3984,3991],[3993,4028],[4038,4038],[4141,4144],[4146,4146],[4150,4151],[4153,4153],[4184,4185],[4448,4607],[4959,4959],[5906,5908],[5938,5940],[5970,5971],[6002,6003],[6068,6069],[6071,6077],[6086,6086],[6089,6099],[6109,6109],[6155,6157],[6313,6313],[6432,6434],[6439,6440],[6450,6450],[6457,6459],[6679,6680],[6912,6915],[6964,6964],[6966,6970],[6972,6972],[6978,6978],[7019,7027],[7616,7626],[7678,7679],[8203,8207],[8234,8238],[8288,8291],[8298,8303],[8400,8431],[12330,12335],[12441,12442],[43014,43014],[43019,43019],[43045,43046],[64286,64286],[65024,65039],[65056,65059],[65279,65279],[65529,65531]],l=[[68097,68099],[68101,68102],[68108,68111],[68152,68154],[68159,68159],[119143,119145],[119155,119170],[119173,119179],[119210,119213],[119362,119364],[917505,917505],[917536,917631],[917760,917999]],p;i.UnicodeV6=class{constructor(){if(this.version="6",!p){p=new Uint8Array(65536),p.fill(1),p[0]=0,p.fill(0,1,32),p.fill(0,127,160),p.fill(2,4352,4448),p[9001]=2,p[9002]=2,p.fill(2,11904,42192),p[12351]=1,p.fill(2,44032,55204),p.fill(2,63744,64256),p.fill(2,65040,65050),p.fill(2,65072,65136),p.fill(2,65280,65377),p.fill(2,65504,65511);for(let d=0;d<r.length;++d)p.fill(0,r[d][0],r[d][1]+1)}}wcwidth(d){return d<32?0:d<127?1:d<65536?p[d]:(function(f,g){let w,b=0,o=g.length-1;if(f<g[0][0]||f>g[o][1])return!1;for(;o>=b;)if(w=b+o>>1,f>g[w][1])b=w+1;else{if(!(f<g[w][0]))return!0;o=w-1}return!1})(d,l)?0:d>=131072&&d<=196605||d>=196608&&d<=262141?2:1}}},5981:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.WriteBuffer=void 0;let l=r(8460),p=r(844);class d extends p.Disposable{constructor(g){super(),this._action=g,this._writeBuffer=[],this._callbacks=[],this._pendingData=0,this._bufferOffset=0,this._isSyncWriting=!1,this._syncCalls=0,this._didUserInput=!1,this._onWriteParsed=this.register(new l.EventEmitter),this.onWriteParsed=this._onWriteParsed.event}handleUserInput(){this._didUserInput=!0}writeSync(g,w){if(w!==void 0&&this._syncCalls>w)return void(this._syncCalls=0);if(this._pendingData+=g.length,this._writeBuffer.push(g),this._callbacks.push(void 0),this._syncCalls++,this._isSyncWriting)return;let b;for(this._isSyncWriting=!0;b=this._writeBuffer.shift();){this._action(b);let o=this._callbacks.shift();o&&o()}this._pendingData=0,this._bufferOffset=2147483647,this._isSyncWriting=!1,this._syncCalls=0}write(g,w){if(this._pendingData>5e7)throw new Error("write data discarded, use flow control to avoid losing data");if(!this._writeBuffer.length){if(this._bufferOffset=0,this._didUserInput)return this._didUserInput=!1,this._pendingData+=g.length,this._writeBuffer.push(g),this._callbacks.push(w),void this._innerWrite();setTimeout((()=>this._innerWrite()))}this._pendingData+=g.length,this._writeBuffer.push(g),this._callbacks.push(w)}_innerWrite(g=0,w=!0){let b=g||Date.now();for(;this._writeBuffer.length>this._bufferOffset;){let o=this._writeBuffer[this._bufferOffset],a=this._action(o,w);if(a){let h=_=>Date.now()-b>=12?setTimeout((()=>this._innerWrite(0,_))):this._innerWrite(b,_);return void a.catch((_=>(queueMicrotask((()=>{throw _})),Promise.resolve(!1)))).then(h)}let c=this._callbacks[this._bufferOffset];if(c&&c(),this._bufferOffset++,this._pendingData-=o.length,Date.now()-b>=12)break}this._writeBuffer.length>this._bufferOffset?(this._bufferOffset>50&&(this._writeBuffer=this._writeBuffer.slice(this._bufferOffset),this._callbacks=this._callbacks.slice(this._bufferOffset),this._bufferOffset=0),setTimeout((()=>this._innerWrite()))):(this._writeBuffer.length=0,this._callbacks.length=0,this._pendingData=0,this._bufferOffset=0),this._onWriteParsed.fire()}}i.WriteBuffer=d},5941:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.toRgbString=i.parseColor=void 0;let r=/^([\da-f])\/([\da-f])\/([\da-f])$|^([\da-f]{2})\/([\da-f]{2})\/([\da-f]{2})$|^([\da-f]{3})\/([\da-f]{3})\/([\da-f]{3})$|^([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})$/,l=/^[\da-f]+$/;function p(d,f){let g=d.toString(16),w=g.length<2?"0"+g:g;switch(f){case 4:return g[0];case 8:return w;case 12:return(w+w).slice(0,3);default:return w+w}}i.parseColor=function(d){if(!d)return;let f=d.toLowerCase();if(f.indexOf("rgb:")===0){f=f.slice(4);let g=r.exec(f);if(g){let w=g[1]?15:g[4]?255:g[7]?4095:65535;return[Math.round(parseInt(g[1]||g[4]||g[7]||g[10],16)/w*255),Math.round(parseInt(g[2]||g[5]||g[8]||g[11],16)/w*255),Math.round(parseInt(g[3]||g[6]||g[9]||g[12],16)/w*255)]}}else if(f.indexOf("#")===0&&(f=f.slice(1),l.exec(f)&&[3,6,9,12].includes(f.length))){let g=f.length/3,w=[0,0,0];for(let b=0;b<3;++b){let o=parseInt(f.slice(g*b,g*b+g),16);w[b]=g===1?o<<4:g===2?o:g===3?o>>4:o>>8}return w}},i.toRgbString=function(d,f=16){let[g,w,b]=d;return`rgb:${p(g,f)}/${p(w,f)}/${p(b,f)}`}},5770:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.PAYLOAD_LIMIT=void 0,i.PAYLOAD_LIMIT=1e7},6351:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DcsHandler=i.DcsParser=void 0;let l=r(482),p=r(8742),d=r(5770),f=[];i.DcsParser=class{constructor(){this._handlers=Object.create(null),this._active=f,this._ident=0,this._handlerFb=()=>{},this._stack={paused:!1,loopPosition:0,fallThrough:!1}}dispose(){this._handlers=Object.create(null),this._handlerFb=()=>{},this._active=f}registerHandler(w,b){this._handlers[w]===void 0&&(this._handlers[w]=[]);let o=this._handlers[w];return o.push(b),{dispose:()=>{let a=o.indexOf(b);a!==-1&&o.splice(a,1)}}}clearHandler(w){this._handlers[w]&&delete this._handlers[w]}setHandlerFallback(w){this._handlerFb=w}reset(){if(this._active.length)for(let w=this._stack.paused?this._stack.loopPosition-1:this._active.length-1;w>=0;--w)this._active[w].unhook(!1);this._stack.paused=!1,this._active=f,this._ident=0}hook(w,b){if(this.reset(),this._ident=w,this._active=this._handlers[w]||f,this._active.length)for(let o=this._active.length-1;o>=0;o--)this._active[o].hook(b);else this._handlerFb(this._ident,"HOOK",b)}put(w,b,o){if(this._active.length)for(let a=this._active.length-1;a>=0;a--)this._active[a].put(w,b,o);else this._handlerFb(this._ident,"PUT",(0,l.utf32ToString)(w,b,o))}unhook(w,b=!0){if(this._active.length){let o=!1,a=this._active.length-1,c=!1;if(this._stack.paused&&(a=this._stack.loopPosition-1,o=b,c=this._stack.fallThrough,this._stack.paused=!1),!c&&o===!1){for(;a>=0&&(o=this._active[a].unhook(w),o!==!0);a--)if(o instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=a,this._stack.fallThrough=!1,o;a--}for(;a>=0;a--)if(o=this._active[a].unhook(!1),o instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=a,this._stack.fallThrough=!0,o}else this._handlerFb(this._ident,"UNHOOK",w);this._active=f,this._ident=0}};let g=new p.Params;g.addParam(0),i.DcsHandler=class{constructor(w){this._handler=w,this._data="",this._params=g,this._hitLimit=!1}hook(w){this._params=w.length>1||w.params[0]?w.clone():g,this._data="",this._hitLimit=!1}put(w,b,o){this._hitLimit||(this._data+=(0,l.utf32ToString)(w,b,o),this._data.length>d.PAYLOAD_LIMIT&&(this._data="",this._hitLimit=!0))}unhook(w){let b=!1;if(this._hitLimit)b=!1;else if(w&&(b=this._handler(this._data,this._params),b instanceof Promise))return b.then((o=>(this._params=g,this._data="",this._hitLimit=!1,o)));return this._params=g,this._data="",this._hitLimit=!1,b}}},2015:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.EscapeSequenceParser=i.VT500_TRANSITION_TABLE=i.TransitionTable=void 0;let l=r(844),p=r(8742),d=r(6242),f=r(6351);class g{constructor(a){this.table=new Uint8Array(a)}setDefault(a,c){this.table.fill(a<<4|c)}add(a,c,h,_){this.table[c<<8|a]=h<<4|_}addMany(a,c,h,_){for(let v=0;v<a.length;v++)this.table[c<<8|a[v]]=h<<4|_}}i.TransitionTable=g;let w=160;i.VT500_TRANSITION_TABLE=(function(){let o=new g(4095),a=Array.apply(null,Array(256)).map(((C,m)=>m)),c=(C,m)=>a.slice(C,m),h=c(32,127),_=c(0,24);_.push(25),_.push.apply(_,c(28,32));let v=c(0,14),y;for(y in o.setDefault(1,0),o.addMany(h,0,2,0),v)o.addMany([24,26,153,154],y,3,0),o.addMany(c(128,144),y,3,0),o.addMany(c(144,152),y,3,0),o.add(156,y,0,0),o.add(27,y,11,1),o.add(157,y,4,8),o.addMany([152,158,159],y,0,7),o.add(155,y,11,3),o.add(144,y,11,9);return o.addMany(_,0,3,0),o.addMany(_,1,3,1),o.add(127,1,0,1),o.addMany(_,8,0,8),o.addMany(_,3,3,3),o.add(127,3,0,3),o.addMany(_,4,3,4),o.add(127,4,0,4),o.addMany(_,6,3,6),o.addMany(_,5,3,5),o.add(127,5,0,5),o.addMany(_,2,3,2),o.add(127,2,0,2),o.add(93,1,4,8),o.addMany(h,8,5,8),o.add(127,8,5,8),o.addMany([156,27,24,26,7],8,6,0),o.addMany(c(28,32),8,0,8),o.addMany([88,94,95],1,0,7),o.addMany(h,7,0,7),o.addMany(_,7,0,7),o.add(156,7,0,0),o.add(127,7,0,7),o.add(91,1,11,3),o.addMany(c(64,127),3,7,0),o.addMany(c(48,60),3,8,4),o.addMany([60,61,62,63],3,9,4),o.addMany(c(48,60),4,8,4),o.addMany(c(64,127),4,7,0),o.addMany([60,61,62,63],4,0,6),o.addMany(c(32,64),6,0,6),o.add(127,6,0,6),o.addMany(c(64,127),6,0,0),o.addMany(c(32,48),3,9,5),o.addMany(c(32,48),5,9,5),o.addMany(c(48,64),5,0,6),o.addMany(c(64,127),5,7,0),o.addMany(c(32,48),4,9,5),o.addMany(c(32,48),1,9,2),o.addMany(c(32,48),2,9,2),o.addMany(c(48,127),2,10,0),o.addMany(c(48,80),1,10,0),o.addMany(c(81,88),1,10,0),o.addMany([89,90,92],1,10,0),o.addMany(c(96,127),1,10,0),o.add(80,1,11,9),o.addMany(_,9,0,9),o.add(127,9,0,9),o.addMany(c(28,32),9,0,9),o.addMany(c(32,48),9,9,12),o.addMany(c(48,60),9,8,10),o.addMany([60,61,62,63],9,9,10),o.addMany(_,11,0,11),o.addMany(c(32,128),11,0,11),o.addMany(c(28,32),11,0,11),o.addMany(_,10,0,10),o.add(127,10,0,10),o.addMany(c(28,32),10,0,10),o.addMany(c(48,60),10,8,10),o.addMany([60,61,62,63],10,0,11),o.addMany(c(32,48),10,9,12),o.addMany(_,12,0,12),o.add(127,12,0,12),o.addMany(c(28,32),12,0,12),o.addMany(c(32,48),12,9,12),o.addMany(c(48,64),12,0,11),o.addMany(c(64,127),12,12,13),o.addMany(c(64,127),10,12,13),o.addMany(c(64,127),9,12,13),o.addMany(_,13,13,13),o.addMany(h,13,13,13),o.add(127,13,0,13),o.addMany([27,156,24,26],13,14,0),o.add(w,0,2,0),o.add(w,8,5,8),o.add(w,6,0,6),o.add(w,11,0,11),o.add(w,13,13,13),o})();class b extends l.Disposable{constructor(a=i.VT500_TRANSITION_TABLE){super(),this._transitions=a,this._parseStack={state:0,handlers:[],handlerPos:0,transition:0,chunkPos:0},this.initialState=0,this.currentState=this.initialState,this._params=new p.Params,this._params.addParam(0),this._collect=0,this.precedingCodepoint=0,this._printHandlerFb=(c,h,_)=>{},this._executeHandlerFb=c=>{},this._csiHandlerFb=(c,h)=>{},this._escHandlerFb=c=>{},this._errorHandlerFb=c=>c,this._printHandler=this._printHandlerFb,this._executeHandlers=Object.create(null),this._csiHandlers=Object.create(null),this._escHandlers=Object.create(null),this.register((0,l.toDisposable)((()=>{this._csiHandlers=Object.create(null),this._executeHandlers=Object.create(null),this._escHandlers=Object.create(null)}))),this._oscParser=this.register(new d.OscParser),this._dcsParser=this.register(new f.DcsParser),this._errorHandler=this._errorHandlerFb,this.registerEscHandler({final:"\\"},(()=>!0))}_identifier(a,c=[64,126]){let h=0;if(a.prefix){if(a.prefix.length>1)throw new Error("only one byte as prefix supported");if(h=a.prefix.charCodeAt(0),h&&60>h||h>63)throw new Error("prefix must be in range 0x3c .. 0x3f")}if(a.intermediates){if(a.intermediates.length>2)throw new Error("only two bytes as intermediates are supported");for(let v=0;v<a.intermediates.length;++v){let y=a.intermediates.charCodeAt(v);if(32>y||y>47)throw new Error("intermediate must be in range 0x20 .. 0x2f");h<<=8,h|=y}}if(a.final.length!==1)throw new Error("final must be a single byte");let _=a.final.charCodeAt(0);if(c[0]>_||_>c[1])throw new Error(`final must be in range ${c[0]} .. ${c[1]}`);return h<<=8,h|=_,h}identToString(a){let c=[];for(;a;)c.push(String.fromCharCode(255&a)),a>>=8;return c.reverse().join("")}setPrintHandler(a){this._printHandler=a}clearPrintHandler(){this._printHandler=this._printHandlerFb}registerEscHandler(a,c){let h=this._identifier(a,[48,126]);this._escHandlers[h]===void 0&&(this._escHandlers[h]=[]);let _=this._escHandlers[h];return _.push(c),{dispose:()=>{let v=_.indexOf(c);v!==-1&&_.splice(v,1)}}}clearEscHandler(a){this._escHandlers[this._identifier(a,[48,126])]&&delete this._escHandlers[this._identifier(a,[48,126])]}setEscHandlerFallback(a){this._escHandlerFb=a}setExecuteHandler(a,c){this._executeHandlers[a.charCodeAt(0)]=c}clearExecuteHandler(a){this._executeHandlers[a.charCodeAt(0)]&&delete this._executeHandlers[a.charCodeAt(0)]}setExecuteHandlerFallback(a){this._executeHandlerFb=a}registerCsiHandler(a,c){let h=this._identifier(a);this._csiHandlers[h]===void 0&&(this._csiHandlers[h]=[]);let _=this._csiHandlers[h];return _.push(c),{dispose:()=>{let v=_.indexOf(c);v!==-1&&_.splice(v,1)}}}clearCsiHandler(a){this._csiHandlers[this._identifier(a)]&&delete this._csiHandlers[this._identifier(a)]}setCsiHandlerFallback(a){this._csiHandlerFb=a}registerDcsHandler(a,c){return this._dcsParser.registerHandler(this._identifier(a),c)}clearDcsHandler(a){this._dcsParser.clearHandler(this._identifier(a))}setDcsHandlerFallback(a){this._dcsParser.setHandlerFallback(a)}registerOscHandler(a,c){return this._oscParser.registerHandler(a,c)}clearOscHandler(a){this._oscParser.clearHandler(a)}setOscHandlerFallback(a){this._oscParser.setHandlerFallback(a)}setErrorHandler(a){this._errorHandler=a}clearErrorHandler(){this._errorHandler=this._errorHandlerFb}reset(){this.currentState=this.initialState,this._oscParser.reset(),this._dcsParser.reset(),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0,this._parseStack.state!==0&&(this._parseStack.state=2,this._parseStack.handlers=[])}_preserveStack(a,c,h,_,v){this._parseStack.state=a,this._parseStack.handlers=c,this._parseStack.handlerPos=h,this._parseStack.transition=_,this._parseStack.chunkPos=v}parse(a,c,h){let _,v=0,y=0,C=0;if(this._parseStack.state)if(this._parseStack.state===2)this._parseStack.state=0,C=this._parseStack.chunkPos+1;else{if(h===void 0||this._parseStack.state===1)throw this._parseStack.state=1,new Error("improper continuation due to previous async handler, giving up parsing");let m=this._parseStack.handlers,S=this._parseStack.handlerPos-1;switch(this._parseStack.state){case 3:if(h===!1&&S>-1){for(;S>=0&&(_=m[S](this._params),_!==!0);S--)if(_ instanceof Promise)return this._parseStack.handlerPos=S,_}this._parseStack.handlers=[];break;case 4:if(h===!1&&S>-1){for(;S>=0&&(_=m[S](),_!==!0);S--)if(_ instanceof Promise)return this._parseStack.handlerPos=S,_}this._parseStack.handlers=[];break;case 6:if(v=a[this._parseStack.chunkPos],_=this._dcsParser.unhook(v!==24&&v!==26,h),_)return _;v===27&&(this._parseStack.transition|=1),this._params.reset(),this._params.addParam(0),this._collect=0;break;case 5:if(v=a[this._parseStack.chunkPos],_=this._oscParser.end(v!==24&&v!==26,h),_)return _;v===27&&(this._parseStack.transition|=1),this._params.reset(),this._params.addParam(0),this._collect=0}this._parseStack.state=0,C=this._parseStack.chunkPos+1,this.precedingCodepoint=0,this.currentState=15&this._parseStack.transition}for(let m=C;m<c;++m){switch(v=a[m],y=this._transitions.table[this.currentState<<8|(v<160?v:w)],y>>4){case 2:for(let O=m+1;;++O){if(O>=c||(v=a[O])<32||v>126&&v<w){this._printHandler(a,m,O),m=O-1;break}if(++O>=c||(v=a[O])<32||v>126&&v<w){this._printHandler(a,m,O),m=O-1;break}if(++O>=c||(v=a[O])<32||v>126&&v<w){this._printHandler(a,m,O),m=O-1;break}if(++O>=c||(v=a[O])<32||v>126&&v<w){this._printHandler(a,m,O),m=O-1;break}}break;case 3:this._executeHandlers[v]?this._executeHandlers[v]():this._executeHandlerFb(v),this.precedingCodepoint=0;break;case 0:break;case 1:if(this._errorHandler({position:m,code:v,currentState:this.currentState,collect:this._collect,params:this._params,abort:!1}).abort)return;break;case 7:let S=this._csiHandlers[this._collect<<8|v],L=S?S.length-1:-1;for(;L>=0&&(_=S[L](this._params),_!==!0);L--)if(_ instanceof Promise)return this._preserveStack(3,S,L,y,m),_;L<0&&this._csiHandlerFb(this._collect<<8|v,this._params),this.precedingCodepoint=0;break;case 8:do switch(v){case 59:this._params.addParam(0);break;case 58:this._params.addSubParam(-1);break;default:this._params.addDigit(v-48)}while(++m<c&&(v=a[m])>47&&v<60);m--;break;case 9:this._collect<<=8,this._collect|=v;break;case 10:let $=this._escHandlers[this._collect<<8|v],T=$?$.length-1:-1;for(;T>=0&&(_=$[T](),_!==!0);T--)if(_ instanceof Promise)return this._preserveStack(4,$,T,y,m),_;T<0&&this._escHandlerFb(this._collect<<8|v),this.precedingCodepoint=0;break;case 11:this._params.reset(),this._params.addParam(0),this._collect=0;break;case 12:this._dcsParser.hook(this._collect<<8|v,this._params);break;case 13:for(let O=m+1;;++O)if(O>=c||(v=a[O])===24||v===26||v===27||v>127&&v<w){this._dcsParser.put(a,m,O),m=O-1;break}break;case 14:if(_=this._dcsParser.unhook(v!==24&&v!==26),_)return this._preserveStack(6,[],0,y,m),_;v===27&&(y|=1),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0;break;case 4:this._oscParser.start();break;case 5:for(let O=m+1;;O++)if(O>=c||(v=a[O])<32||v>127&&v<w){this._oscParser.put(a,m,O),m=O-1;break}break;case 6:if(_=this._oscParser.end(v!==24&&v!==26),_)return this._preserveStack(5,[],0,y,m),_;v===27&&(y|=1),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0}this.currentState=15&y}}}i.EscapeSequenceParser=b},6242:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.OscHandler=i.OscParser=void 0;let l=r(5770),p=r(482),d=[];i.OscParser=class{constructor(){this._state=0,this._active=d,this._id=-1,this._handlers=Object.create(null),this._handlerFb=()=>{},this._stack={paused:!1,loopPosition:0,fallThrough:!1}}registerHandler(f,g){this._handlers[f]===void 0&&(this._handlers[f]=[]);let w=this._handlers[f];return w.push(g),{dispose:()=>{let b=w.indexOf(g);b!==-1&&w.splice(b,1)}}}clearHandler(f){this._handlers[f]&&delete this._handlers[f]}setHandlerFallback(f){this._handlerFb=f}dispose(){this._handlers=Object.create(null),this._handlerFb=()=>{},this._active=d}reset(){if(this._state===2)for(let f=this._stack.paused?this._stack.loopPosition-1:this._active.length-1;f>=0;--f)this._active[f].end(!1);this._stack.paused=!1,this._active=d,this._id=-1,this._state=0}_start(){if(this._active=this._handlers[this._id]||d,this._active.length)for(let f=this._active.length-1;f>=0;f--)this._active[f].start();else this._handlerFb(this._id,"START")}_put(f,g,w){if(this._active.length)for(let b=this._active.length-1;b>=0;b--)this._active[b].put(f,g,w);else this._handlerFb(this._id,"PUT",(0,p.utf32ToString)(f,g,w))}start(){this.reset(),this._state=1}put(f,g,w){if(this._state!==3){if(this._state===1)for(;g<w;){let b=f[g++];if(b===59){this._state=2,this._start();break}if(b<48||57<b)return void(this._state=3);this._id===-1&&(this._id=0),this._id=10*this._id+b-48}this._state===2&&w-g>0&&this._put(f,g,w)}}end(f,g=!0){if(this._state!==0){if(this._state!==3)if(this._state===1&&this._start(),this._active.length){let w=!1,b=this._active.length-1,o=!1;if(this._stack.paused&&(b=this._stack.loopPosition-1,w=g,o=this._stack.fallThrough,this._stack.paused=!1),!o&&w===!1){for(;b>=0&&(w=this._active[b].end(f),w!==!0);b--)if(w instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=b,this._stack.fallThrough=!1,w;b--}for(;b>=0;b--)if(w=this._active[b].end(!1),w instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=b,this._stack.fallThrough=!0,w}else this._handlerFb(this._id,"END",f);this._active=d,this._id=-1,this._state=0}}},i.OscHandler=class{constructor(f){this._handler=f,this._data="",this._hitLimit=!1}start(){this._data="",this._hitLimit=!1}put(f,g,w){this._hitLimit||(this._data+=(0,p.utf32ToString)(f,g,w),this._data.length>l.PAYLOAD_LIMIT&&(this._data="",this._hitLimit=!0))}end(f){let g=!1;if(this._hitLimit)g=!1;else if(f&&(g=this._handler(this._data),g instanceof Promise))return g.then((w=>(this._data="",this._hitLimit=!1,w)));return this._data="",this._hitLimit=!1,g}}},8742:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Params=void 0;let r=2147483647;class l{static fromArray(d){let f=new l;if(!d.length)return f;for(let g=Array.isArray(d[0])?1:0;g<d.length;++g){let w=d[g];if(Array.isArray(w))for(let b=0;b<w.length;++b)f.addSubParam(w[b]);else f.addParam(w)}return f}constructor(d=32,f=32){if(this.maxLength=d,this.maxSubParamsLength=f,f>256)throw new Error("maxSubParamsLength must not be greater than 256");this.params=new Int32Array(d),this.length=0,this._subParams=new Int32Array(f),this._subParamsLength=0,this._subParamsIdx=new Uint16Array(d),this._rejectDigits=!1,this._rejectSubDigits=!1,this._digitIsSub=!1}clone(){let d=new l(this.maxLength,this.maxSubParamsLength);return d.params.set(this.params),d.length=this.length,d._subParams.set(this._subParams),d._subParamsLength=this._subParamsLength,d._subParamsIdx.set(this._subParamsIdx),d._rejectDigits=this._rejectDigits,d._rejectSubDigits=this._rejectSubDigits,d._digitIsSub=this._digitIsSub,d}toArray(){let d=[];for(let f=0;f<this.length;++f){d.push(this.params[f]);let g=this._subParamsIdx[f]>>8,w=255&this._subParamsIdx[f];w-g>0&&d.push(Array.prototype.slice.call(this._subParams,g,w))}return d}reset(){this.length=0,this._subParamsLength=0,this._rejectDigits=!1,this._rejectSubDigits=!1,this._digitIsSub=!1}addParam(d){if(this._digitIsSub=!1,this.length>=this.maxLength)this._rejectDigits=!0;else{if(d<-1)throw new Error("values lesser than -1 are not allowed");this._subParamsIdx[this.length]=this._subParamsLength<<8|this._subParamsLength,this.params[this.length++]=d>r?r:d}}addSubParam(d){if(this._digitIsSub=!0,this.length)if(this._rejectDigits||this._subParamsLength>=this.maxSubParamsLength)this._rejectSubDigits=!0;else{if(d<-1)throw new Error("values lesser than -1 are not allowed");this._subParams[this._subParamsLength++]=d>r?r:d,this._subParamsIdx[this.length-1]++}}hasSubParams(d){return(255&this._subParamsIdx[d])-(this._subParamsIdx[d]>>8)>0}getSubParams(d){let f=this._subParamsIdx[d]>>8,g=255&this._subParamsIdx[d];return g-f>0?this._subParams.subarray(f,g):null}getSubParamsAll(){let d={};for(let f=0;f<this.length;++f){let g=this._subParamsIdx[f]>>8,w=255&this._subParamsIdx[f];w-g>0&&(d[f]=this._subParams.slice(g,w))}return d}addDigit(d){let f;if(this._rejectDigits||!(f=this._digitIsSub?this._subParamsLength:this.length)||this._digitIsSub&&this._rejectSubDigits)return;let g=this._digitIsSub?this._subParams:this.params,w=g[f-1];g[f-1]=~w?Math.min(10*w+d,r):d}}i.Params=l},5741:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.AddonManager=void 0,i.AddonManager=class{constructor(){this._addons=[]}dispose(){for(let r=this._addons.length-1;r>=0;r--)this._addons[r].instance.dispose()}loadAddon(r,l){let p={instance:l,dispose:l.dispose,isDisposed:!1};this._addons.push(p),l.dispose=()=>this._wrappedAddonDispose(p),l.activate(r)}_wrappedAddonDispose(r){if(r.isDisposed)return;let l=-1;for(let p=0;p<this._addons.length;p++)if(this._addons[p]===r){l=p;break}if(l===-1)throw new Error("Could not dispose an addon that has not been loaded");r.isDisposed=!0,r.dispose.apply(r.instance),this._addons.splice(l,1)}}},8771:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferApiView=void 0;let l=r(3785),p=r(511);i.BufferApiView=class{constructor(d,f){this._buffer=d,this.type=f}init(d){return this._buffer=d,this}get cursorY(){return this._buffer.y}get cursorX(){return this._buffer.x}get viewportY(){return this._buffer.ydisp}get baseY(){return this._buffer.ybase}get length(){return this._buffer.lines.length}getLine(d){let f=this._buffer.lines.get(d);if(f)return new l.BufferLineApiView(f)}getNullCell(){return new p.CellData}}},3785:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferLineApiView=void 0;let l=r(511);i.BufferLineApiView=class{constructor(p){this._line=p}get isWrapped(){return this._line.isWrapped}get length(){return this._line.length}getCell(p,d){if(!(p<0||p>=this._line.length))return d?(this._line.loadCell(p,d),d):this._line.loadCell(p,new l.CellData)}translateToString(p,d,f){return this._line.translateToString(p,d,f)}}},8285:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferNamespaceApi=void 0;let l=r(8771),p=r(8460),d=r(844);class f extends d.Disposable{constructor(w){super(),this._core=w,this._onBufferChange=this.register(new p.EventEmitter),this.onBufferChange=this._onBufferChange.event,this._normal=new l.BufferApiView(this._core.buffers.normal,"normal"),this._alternate=new l.BufferApiView(this._core.buffers.alt,"alternate"),this._core.buffers.onBufferActivate((()=>this._onBufferChange.fire(this.active)))}get active(){if(this._core.buffers.active===this._core.buffers.normal)return this.normal;if(this._core.buffers.active===this._core.buffers.alt)return this.alternate;throw new Error("Active buffer is neither normal nor alternate")}get normal(){return this._normal.init(this._core.buffers.normal)}get alternate(){return this._alternate.init(this._core.buffers.alt)}}i.BufferNamespaceApi=f},7975:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ParserApi=void 0,i.ParserApi=class{constructor(r){this._core=r}registerCsiHandler(r,l){return this._core.registerCsiHandler(r,(p=>l(p.toArray())))}addCsiHandler(r,l){return this.registerCsiHandler(r,l)}registerDcsHandler(r,l){return this._core.registerDcsHandler(r,((p,d)=>l(p,d.toArray())))}addDcsHandler(r,l){return this.registerDcsHandler(r,l)}registerEscHandler(r,l){return this._core.registerEscHandler(r,l)}addEscHandler(r,l){return this.registerEscHandler(r,l)}registerOscHandler(r,l){return this._core.registerOscHandler(r,l)}addOscHandler(r,l){return this.registerOscHandler(r,l)}}},7090:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.UnicodeApi=void 0,i.UnicodeApi=class{constructor(r){this._core=r}register(r){this._core.unicodeService.register(r)}get versions(){return this._core.unicodeService.versions}get activeVersion(){return this._core.unicodeService.activeVersion}set activeVersion(r){this._core.unicodeService.activeVersion=r}}},744:function(u,i,r){var l=this&&this.__decorate||function(o,a,c,h){var _,v=arguments.length,y=v<3?a:h===null?h=Object.getOwnPropertyDescriptor(a,c):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(o,a,c,h);else for(var C=o.length-1;C>=0;C--)(_=o[C])&&(y=(v<3?_(y):v>3?_(a,c,y):_(a,c))||y);return v>3&&y&&Object.defineProperty(a,c,y),y},p=this&&this.__param||function(o,a){return function(c,h){a(c,h,o)}};Object.defineProperty(i,"__esModule",{value:!0}),i.BufferService=i.MINIMUM_ROWS=i.MINIMUM_COLS=void 0;let d=r(8460),f=r(844),g=r(5295),w=r(2585);i.MINIMUM_COLS=2,i.MINIMUM_ROWS=1;let b=i.BufferService=class extends f.Disposable{get buffer(){return this.buffers.active}constructor(o){super(),this.isUserScrolling=!1,this._onResize=this.register(new d.EventEmitter),this.onResize=this._onResize.event,this._onScroll=this.register(new d.EventEmitter),this.onScroll=this._onScroll.event,this.cols=Math.max(o.rawOptions.cols||0,i.MINIMUM_COLS),this.rows=Math.max(o.rawOptions.rows||0,i.MINIMUM_ROWS),this.buffers=this.register(new g.BufferSet(o,this))}resize(o,a){this.cols=o,this.rows=a,this.buffers.resize(o,a),this._onResize.fire({cols:o,rows:a})}reset(){this.buffers.reset(),this.isUserScrolling=!1}scroll(o,a=!1){let c=this.buffer,h;h=this._cachedBlankLine,h&&h.length===this.cols&&h.getFg(0)===o.fg&&h.getBg(0)===o.bg||(h=c.getBlankLine(o,a),this._cachedBlankLine=h),h.isWrapped=a;let _=c.ybase+c.scrollTop,v=c.ybase+c.scrollBottom;if(c.scrollTop===0){let y=c.lines.isFull;v===c.lines.length-1?y?c.lines.recycle().copyFrom(h):c.lines.push(h.clone()):c.lines.splice(v+1,0,h.clone()),y?this.isUserScrolling&&(c.ydisp=Math.max(c.ydisp-1,0)):(c.ybase++,this.isUserScrolling||c.ydisp++)}else{let y=v-_+1;c.lines.shiftElements(_+1,y-1,-1),c.lines.set(v,h.clone())}this.isUserScrolling||(c.ydisp=c.ybase),this._onScroll.fire(c.ydisp)}scrollLines(o,a,c){let h=this.buffer;if(o<0){if(h.ydisp===0)return;this.isUserScrolling=!0}else o+h.ydisp>=h.ybase&&(this.isUserScrolling=!1);let _=h.ydisp;h.ydisp=Math.max(Math.min(h.ydisp+o,h.ybase),0),_!==h.ydisp&&(a||this._onScroll.fire(h.ydisp))}};i.BufferService=b=l([p(0,w.IOptionsService)],b)},7994:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CharsetService=void 0,i.CharsetService=class{constructor(){this.glevel=0,this._charsets=[]}reset(){this.charset=void 0,this._charsets=[],this.glevel=0}setgLevel(r){this.glevel=r,this.charset=this._charsets[r]}setgCharset(r,l){this._charsets[r]=l,this.glevel===r&&(this.charset=l)}}},1753:function(u,i,r){var l=this&&this.__decorate||function(h,_,v,y){var C,m=arguments.length,S=m<3?_:y===null?y=Object.getOwnPropertyDescriptor(_,v):y;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")S=Reflect.decorate(h,_,v,y);else for(var L=h.length-1;L>=0;L--)(C=h[L])&&(S=(m<3?C(S):m>3?C(_,v,S):C(_,v))||S);return m>3&&S&&Object.defineProperty(_,v,S),S},p=this&&this.__param||function(h,_){return function(v,y){_(v,y,h)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CoreMouseService=void 0;let d=r(2585),f=r(8460),g=r(844),w={NONE:{events:0,restrict:()=>!1},X10:{events:1,restrict:h=>h.button!==4&&h.action===1&&(h.ctrl=!1,h.alt=!1,h.shift=!1,!0)},VT200:{events:19,restrict:h=>h.action!==32},DRAG:{events:23,restrict:h=>h.action!==32||h.button!==3},ANY:{events:31,restrict:h=>!0}};function b(h,_){let v=(h.ctrl?16:0)|(h.shift?4:0)|(h.alt?8:0);return h.button===4?(v|=64,v|=h.action):(v|=3&h.button,4&h.button&&(v|=64),8&h.button&&(v|=128),h.action===32?v|=32:h.action!==0||_||(v|=3)),v}let o=String.fromCharCode,a={DEFAULT:h=>{let _=[b(h,!1)+32,h.col+32,h.row+32];return _[0]>255||_[1]>255||_[2]>255?"":`\x1B[M${o(_[0])}${o(_[1])}${o(_[2])}`},SGR:h=>{let _=h.action===0&&h.button!==4?"m":"M";return`\x1B[<${b(h,!0)};${h.col};${h.row}${_}`},SGR_PIXELS:h=>{let _=h.action===0&&h.button!==4?"m":"M";return`\x1B[<${b(h,!0)};${h.x};${h.y}${_}`}},c=i.CoreMouseService=class extends g.Disposable{constructor(h,_){super(),this._bufferService=h,this._coreService=_,this._protocols={},this._encodings={},this._activeProtocol="",this._activeEncoding="",this._lastEvent=null,this._onProtocolChange=this.register(new f.EventEmitter),this.onProtocolChange=this._onProtocolChange.event;for(let v of Object.keys(w))this.addProtocol(v,w[v]);for(let v of Object.keys(a))this.addEncoding(v,a[v]);this.reset()}addProtocol(h,_){this._protocols[h]=_}addEncoding(h,_){this._encodings[h]=_}get activeProtocol(){return this._activeProtocol}get areMouseEventsActive(){return this._protocols[this._activeProtocol].events!==0}set activeProtocol(h){if(!this._protocols[h])throw new Error(`unknown protocol "${h}"`);this._activeProtocol=h,this._onProtocolChange.fire(this._protocols[h].events)}get activeEncoding(){return this._activeEncoding}set activeEncoding(h){if(!this._encodings[h])throw new Error(`unknown encoding "${h}"`);this._activeEncoding=h}reset(){this.activeProtocol="NONE",this.activeEncoding="DEFAULT",this._lastEvent=null}triggerMouseEvent(h){if(h.col<0||h.col>=this._bufferService.cols||h.row<0||h.row>=this._bufferService.rows||h.button===4&&h.action===32||h.button===3&&h.action!==32||h.button!==4&&(h.action===2||h.action===3)||(h.col++,h.row++,h.action===32&&this._lastEvent&&this._equalEvents(this._lastEvent,h,this._activeEncoding==="SGR_PIXELS"))||!this._protocols[this._activeProtocol].restrict(h))return!1;let _=this._encodings[this._activeEncoding](h);return _&&(this._activeEncoding==="DEFAULT"?this._coreService.triggerBinaryEvent(_):this._coreService.triggerDataEvent(_,!0)),this._lastEvent=h,!0}explainEvents(h){return{down:!!(1&h),up:!!(2&h),drag:!!(4&h),move:!!(8&h),wheel:!!(16&h)}}_equalEvents(h,_,v){if(v){if(h.x!==_.x||h.y!==_.y)return!1}else if(h.col!==_.col||h.row!==_.row)return!1;return h.button===_.button&&h.action===_.action&&h.ctrl===_.ctrl&&h.alt===_.alt&&h.shift===_.shift}};i.CoreMouseService=c=l([p(0,d.IBufferService),p(1,d.ICoreService)],c)},6975:function(u,i,r){var l=this&&this.__decorate||function(c,h,_,v){var y,C=arguments.length,m=C<3?h:v===null?v=Object.getOwnPropertyDescriptor(h,_):v;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")m=Reflect.decorate(c,h,_,v);else for(var S=c.length-1;S>=0;S--)(y=c[S])&&(m=(C<3?y(m):C>3?y(h,_,m):y(h,_))||m);return C>3&&m&&Object.defineProperty(h,_,m),m},p=this&&this.__param||function(c,h){return function(_,v){h(_,v,c)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CoreService=void 0;let d=r(1439),f=r(8460),g=r(844),w=r(2585),b=Object.freeze({insertMode:!1}),o=Object.freeze({applicationCursorKeys:!1,applicationKeypad:!1,bracketedPasteMode:!1,origin:!1,reverseWraparound:!1,sendFocus:!1,wraparound:!0}),a=i.CoreService=class extends g.Disposable{constructor(c,h,_){super(),this._bufferService=c,this._logService=h,this._optionsService=_,this.isCursorInitialized=!1,this.isCursorHidden=!1,this._onData=this.register(new f.EventEmitter),this.onData=this._onData.event,this._onUserInput=this.register(new f.EventEmitter),this.onUserInput=this._onUserInput.event,this._onBinary=this.register(new f.EventEmitter),this.onBinary=this._onBinary.event,this._onRequestScrollToBottom=this.register(new f.EventEmitter),this.onRequestScrollToBottom=this._onRequestScrollToBottom.event,this.modes=(0,d.clone)(b),this.decPrivateModes=(0,d.clone)(o)}reset(){this.modes=(0,d.clone)(b),this.decPrivateModes=(0,d.clone)(o)}triggerDataEvent(c,h=!1){if(this._optionsService.rawOptions.disableStdin)return;let _=this._bufferService.buffer;h&&this._optionsService.rawOptions.scrollOnUserInput&&_.ybase!==_.ydisp&&this._onRequestScrollToBottom.fire(),h&&this._onUserInput.fire(),this._logService.debug(`sending data "${c}"`,(()=>c.split("").map((v=>v.charCodeAt(0))))),this._onData.fire(c)}triggerBinaryEvent(c){this._optionsService.rawOptions.disableStdin||(this._logService.debug(`sending binary "${c}"`,(()=>c.split("").map((h=>h.charCodeAt(0))))),this._onBinary.fire(c))}};i.CoreService=a=l([p(0,w.IBufferService),p(1,w.ILogService),p(2,w.IOptionsService)],a)},9074:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DecorationService=void 0;let l=r(8055),p=r(8460),d=r(844),f=r(6106),g=0,w=0;class b extends d.Disposable{get decorations(){return this._decorations.values()}constructor(){super(),this._decorations=new f.SortedList((c=>c?.marker.line)),this._onDecorationRegistered=this.register(new p.EventEmitter),this.onDecorationRegistered=this._onDecorationRegistered.event,this._onDecorationRemoved=this.register(new p.EventEmitter),this.onDecorationRemoved=this._onDecorationRemoved.event,this.register((0,d.toDisposable)((()=>this.reset())))}registerDecoration(c){if(c.marker.isDisposed)return;let h=new o(c);if(h){let _=h.marker.onDispose((()=>h.dispose()));h.onDispose((()=>{h&&(this._decorations.delete(h)&&this._onDecorationRemoved.fire(h),_.dispose())})),this._decorations.insert(h),this._onDecorationRegistered.fire(h)}return h}reset(){for(let c of this._decorations.values())c.dispose();this._decorations.clear()}*getDecorationsAtCell(c,h,_){var v,y,C;let m=0,S=0;for(let L of this._decorations.getKeyIterator(h))m=(v=L.options.x)!==null&&v!==void 0?v:0,S=m+((y=L.options.width)!==null&&y!==void 0?y:1),c>=m&&c<S&&(!_||((C=L.options.layer)!==null&&C!==void 0?C:"bottom")===_)&&(yield L)}forEachDecorationAtCell(c,h,_,v){this._decorations.forEachByKey(h,(y=>{var C,m,S;g=(C=y.options.x)!==null&&C!==void 0?C:0,w=g+((m=y.options.width)!==null&&m!==void 0?m:1),c>=g&&c<w&&(!_||((S=y.options.layer)!==null&&S!==void 0?S:"bottom")===_)&&v(y)}))}}i.DecorationService=b;class o extends d.Disposable{get isDisposed(){return this._isDisposed}get backgroundColorRGB(){return this._cachedBg===null&&(this.options.backgroundColor?this._cachedBg=l.css.toColor(this.options.backgroundColor):this._cachedBg=void 0),this._cachedBg}get foregroundColorRGB(){return this._cachedFg===null&&(this.options.foregroundColor?this._cachedFg=l.css.toColor(this.options.foregroundColor):this._cachedFg=void 0),this._cachedFg}constructor(c){super(),this.options=c,this.onRenderEmitter=this.register(new p.EventEmitter),this.onRender=this.onRenderEmitter.event,this._onDispose=this.register(new p.EventEmitter),this.onDispose=this._onDispose.event,this._cachedBg=null,this._cachedFg=null,this.marker=c.marker,this.options.overviewRulerOptions&&!this.options.overviewRulerOptions.position&&(this.options.overviewRulerOptions.position="full")}dispose(){this._onDispose.fire(),super.dispose()}}},4348:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.InstantiationService=i.ServiceCollection=void 0;let l=r(2585),p=r(8343);class d{constructor(...g){this._entries=new Map;for(let[w,b]of g)this.set(w,b)}set(g,w){let b=this._entries.get(g);return this._entries.set(g,w),b}forEach(g){for(let[w,b]of this._entries.entries())g(w,b)}has(g){return this._entries.has(g)}get(g){return this._entries.get(g)}}i.ServiceCollection=d,i.InstantiationService=class{constructor(){this._services=new d,this._services.set(l.IInstantiationService,this)}setService(f,g){this._services.set(f,g)}getService(f){return this._services.get(f)}createInstance(f,...g){let w=(0,p.getServiceDependencies)(f).sort(((a,c)=>a.index-c.index)),b=[];for(let a of w){let c=this._services.get(a.id);if(!c)throw new Error(`[createInstance] ${f.name} depends on UNKNOWN service ${a.id}.`);b.push(c)}let o=w.length>0?w[0].index:g.length;if(g.length!==o)throw new Error(`[createInstance] First service dependency of ${f.name} at position ${o+1} conflicts with ${g.length} static arguments`);return new f(...g,...b)}}},7866:function(u,i,r){var l=this&&this.__decorate||function(o,a,c,h){var _,v=arguments.length,y=v<3?a:h===null?h=Object.getOwnPropertyDescriptor(a,c):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(o,a,c,h);else for(var C=o.length-1;C>=0;C--)(_=o[C])&&(y=(v<3?_(y):v>3?_(a,c,y):_(a,c))||y);return v>3&&y&&Object.defineProperty(a,c,y),y},p=this&&this.__param||function(o,a){return function(c,h){a(c,h,o)}};Object.defineProperty(i,"__esModule",{value:!0}),i.traceCall=i.setTraceLogger=i.LogService=void 0;let d=r(844),f=r(2585),g={trace:f.LogLevelEnum.TRACE,debug:f.LogLevelEnum.DEBUG,info:f.LogLevelEnum.INFO,warn:f.LogLevelEnum.WARN,error:f.LogLevelEnum.ERROR,off:f.LogLevelEnum.OFF},w,b=i.LogService=class extends d.Disposable{get logLevel(){return this._logLevel}constructor(o){super(),this._optionsService=o,this._logLevel=f.LogLevelEnum.OFF,this._updateLogLevel(),this.register(this._optionsService.onSpecificOptionChange("logLevel",(()=>this._updateLogLevel()))),w=this}_updateLogLevel(){this._logLevel=g[this._optionsService.rawOptions.logLevel]}_evalLazyOptionalParams(o){for(let a=0;a<o.length;a++)typeof o[a]=="function"&&(o[a]=o[a]())}_log(o,a,c){this._evalLazyOptionalParams(c),o.call(console,(this._optionsService.options.logger?"":"xterm.js: ")+a,...c)}trace(o,...a){var c,h;this._logLevel<=f.LogLevelEnum.TRACE&&this._log((h=(c=this._optionsService.options.logger)===null||c===void 0?void 0:c.trace.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.log,o,a)}debug(o,...a){var c,h;this._logLevel<=f.LogLevelEnum.DEBUG&&this._log((h=(c=this._optionsService.options.logger)===null||c===void 0?void 0:c.debug.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.log,o,a)}info(o,...a){var c,h;this._logLevel<=f.LogLevelEnum.INFO&&this._log((h=(c=this._optionsService.options.logger)===null||c===void 0?void 0:c.info.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.info,o,a)}warn(o,...a){var c,h;this._logLevel<=f.LogLevelEnum.WARN&&this._log((h=(c=this._optionsService.options.logger)===null||c===void 0?void 0:c.warn.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.warn,o,a)}error(o,...a){var c,h;this._logLevel<=f.LogLevelEnum.ERROR&&this._log((h=(c=this._optionsService.options.logger)===null||c===void 0?void 0:c.error.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.error,o,a)}};i.LogService=b=l([p(0,f.IOptionsService)],b),i.setTraceLogger=function(o){w=o},i.traceCall=function(o,a,c){if(typeof c.value!="function")throw new Error("not supported");let h=c.value;c.value=function(..._){if(w.logLevel!==f.LogLevelEnum.TRACE)return h.apply(this,_);w.trace(`GlyphRenderer#${h.name}(${_.map((y=>JSON.stringify(y))).join(", ")})`);let v=h.apply(this,_);return w.trace(`GlyphRenderer#${h.name} return`,v),v}}},7302:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.OptionsService=i.DEFAULT_OPTIONS=void 0;let l=r(8460),p=r(844),d=r(6114);i.DEFAULT_OPTIONS={cols:80,rows:24,cursorBlink:!1,cursorStyle:"block",cursorWidth:1,cursorInactiveStyle:"outline",customGlyphs:!0,drawBoldTextInBrightColors:!0,fastScrollModifier:"alt",fastScrollSensitivity:5,fontFamily:"courier-new, courier, monospace",fontSize:15,fontWeight:"normal",fontWeightBold:"bold",ignoreBracketedPasteMode:!1,lineHeight:1,letterSpacing:0,linkHandler:null,logLevel:"info",logger:null,scrollback:1e3,scrollOnUserInput:!0,scrollSensitivity:1,screenReaderMode:!1,smoothScrollDuration:0,macOptionIsMeta:!1,macOptionClickForcesSelection:!1,minimumContrastRatio:1,disableStdin:!1,allowProposedApi:!1,allowTransparency:!1,tabStopWidth:8,theme:{},rightClickSelectsWord:d.isMac,windowOptions:{},windowsMode:!1,windowsPty:{},wordSeparator:" ()[]{}',\"`",altClickMovesCursor:!0,convertEol:!1,termName:"xterm",cancelEvents:!1,overviewRulerWidth:0};let f=["normal","bold","100","200","300","400","500","600","700","800","900"];class g extends p.Disposable{constructor(b){super(),this._onOptionChange=this.register(new l.EventEmitter),this.onOptionChange=this._onOptionChange.event;let o=Object.assign({},i.DEFAULT_OPTIONS);for(let a in b)if(a in o)try{let c=b[a];o[a]=this._sanitizeAndValidateOption(a,c)}catch(c){console.error(c)}this.rawOptions=o,this.options=Object.assign({},o),this._setupOptions()}onSpecificOptionChange(b,o){return this.onOptionChange((a=>{a===b&&o(this.rawOptions[b])}))}onMultipleOptionChange(b,o){return this.onOptionChange((a=>{b.indexOf(a)!==-1&&o()}))}_setupOptions(){let b=a=>{if(!(a in i.DEFAULT_OPTIONS))throw new Error(`No option with key "${a}"`);return this.rawOptions[a]},o=(a,c)=>{if(!(a in i.DEFAULT_OPTIONS))throw new Error(`No option with key "${a}"`);c=this._sanitizeAndValidateOption(a,c),this.rawOptions[a]!==c&&(this.rawOptions[a]=c,this._onOptionChange.fire(a))};for(let a in this.rawOptions){let c={get:b.bind(this,a),set:o.bind(this,a)};Object.defineProperty(this.options,a,c)}}_sanitizeAndValidateOption(b,o){switch(b){case"cursorStyle":if(o||(o=i.DEFAULT_OPTIONS[b]),!(function(a){return a==="block"||a==="underline"||a==="bar"})(o))throw new Error(`"${o}" is not a valid value for ${b}`);break;case"wordSeparator":o||(o=i.DEFAULT_OPTIONS[b]);break;case"fontWeight":case"fontWeightBold":if(typeof o=="number"&&1<=o&&o<=1e3)break;o=f.includes(o)?o:i.DEFAULT_OPTIONS[b];break;case"cursorWidth":o=Math.floor(o);case"lineHeight":case"tabStopWidth":if(o<1)throw new Error(`${b} cannot be less than 1, value: ${o}`);break;case"minimumContrastRatio":o=Math.max(1,Math.min(21,Math.round(10*o)/10));break;case"scrollback":if((o=Math.min(o,4294967295))<0)throw new Error(`${b} cannot be less than 0, value: ${o}`);break;case"fastScrollSensitivity":case"scrollSensitivity":if(o<=0)throw new Error(`${b} cannot be less than or equal to 0, value: ${o}`);break;case"rows":case"cols":if(!o&&o!==0)throw new Error(`${b} must be numeric, value: ${o}`);break;case"windowsPty":o=o??{}}return o}}i.OptionsService=g},2660:function(u,i,r){var l=this&&this.__decorate||function(g,w,b,o){var a,c=arguments.length,h=c<3?w:o===null?o=Object.getOwnPropertyDescriptor(w,b):o;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")h=Reflect.decorate(g,w,b,o);else for(var _=g.length-1;_>=0;_--)(a=g[_])&&(h=(c<3?a(h):c>3?a(w,b,h):a(w,b))||h);return c>3&&h&&Object.defineProperty(w,b,h),h},p=this&&this.__param||function(g,w){return function(b,o){w(b,o,g)}};Object.defineProperty(i,"__esModule",{value:!0}),i.OscLinkService=void 0;let d=r(2585),f=i.OscLinkService=class{constructor(g){this._bufferService=g,this._nextId=1,this._entriesWithId=new Map,this._dataByLinkId=new Map}registerLink(g){let w=this._bufferService.buffer;if(g.id===void 0){let _=w.addMarker(w.ybase+w.y),v={data:g,id:this._nextId++,lines:[_]};return _.onDispose((()=>this._removeMarkerFromLink(v,_))),this._dataByLinkId.set(v.id,v),v.id}let b=g,o=this._getEntryIdKey(b),a=this._entriesWithId.get(o);if(a)return this.addLineToLink(a.id,w.ybase+w.y),a.id;let c=w.addMarker(w.ybase+w.y),h={id:this._nextId++,key:this._getEntryIdKey(b),data:b,lines:[c]};return c.onDispose((()=>this._removeMarkerFromLink(h,c))),this._entriesWithId.set(h.key,h),this._dataByLinkId.set(h.id,h),h.id}addLineToLink(g,w){let b=this._dataByLinkId.get(g);if(b&&b.lines.every((o=>o.line!==w))){let o=this._bufferService.buffer.addMarker(w);b.lines.push(o),o.onDispose((()=>this._removeMarkerFromLink(b,o)))}}getLinkData(g){var w;return(w=this._dataByLinkId.get(g))===null||w===void 0?void 0:w.data}_getEntryIdKey(g){return`${g.id};;${g.uri}`}_removeMarkerFromLink(g,w){let b=g.lines.indexOf(w);b!==-1&&(g.lines.splice(b,1),g.lines.length===0&&(g.data.id!==void 0&&this._entriesWithId.delete(g.key),this._dataByLinkId.delete(g.id)))}};i.OscLinkService=f=l([p(0,d.IBufferService)],f)},8343:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.createDecorator=i.getServiceDependencies=i.serviceRegistry=void 0;let r="di$target",l="di$dependencies";i.serviceRegistry=new Map,i.getServiceDependencies=function(p){return p[l]||[]},i.createDecorator=function(p){if(i.serviceRegistry.has(p))return i.serviceRegistry.get(p);let d=function(f,g,w){if(arguments.length!==3)throw new Error("@IServiceName-decorator can only be used to decorate a parameter");(function(b,o,a){o[r]===o?o[l].push({id:b,index:a}):(o[l]=[{id:b,index:a}],o[r]=o)})(d,f,w)};return d.toString=()=>p,i.serviceRegistry.set(p,d),d}},2585:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.IDecorationService=i.IUnicodeService=i.IOscLinkService=i.IOptionsService=i.ILogService=i.LogLevelEnum=i.IInstantiationService=i.ICharsetService=i.ICoreService=i.ICoreMouseService=i.IBufferService=void 0;let l=r(8343);var p;i.IBufferService=(0,l.createDecorator)("BufferService"),i.ICoreMouseService=(0,l.createDecorator)("CoreMouseService"),i.ICoreService=(0,l.createDecorator)("CoreService"),i.ICharsetService=(0,l.createDecorator)("CharsetService"),i.IInstantiationService=(0,l.createDecorator)("InstantiationService"),(function(d){d[d.TRACE=0]="TRACE",d[d.DEBUG=1]="DEBUG",d[d.INFO=2]="INFO",d[d.WARN=3]="WARN",d[d.ERROR=4]="ERROR",d[d.OFF=5]="OFF"})(p||(i.LogLevelEnum=p={})),i.ILogService=(0,l.createDecorator)("LogService"),i.IOptionsService=(0,l.createDecorator)("OptionsService"),i.IOscLinkService=(0,l.createDecorator)("OscLinkService"),i.IUnicodeService=(0,l.createDecorator)("UnicodeService"),i.IDecorationService=(0,l.createDecorator)("DecorationService")},1480:(u,i,r)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.UnicodeService=void 0;let l=r(8460),p=r(225);i.UnicodeService=class{constructor(){this._providers=Object.create(null),this._active="",this._onChange=new l.EventEmitter,this.onChange=this._onChange.event;let d=new p.UnicodeV6;this.register(d),this._active=d.version,this._activeProvider=d}dispose(){this._onChange.dispose()}get versions(){return Object.keys(this._providers)}get activeVersion(){return this._active}set activeVersion(d){if(!this._providers[d])throw new Error(`unknown Unicode version "${d}"`);this._active=d,this._activeProvider=this._providers[d],this._onChange.fire(d)}register(d){this._providers[d.version]=d}wcwidth(d){return this._activeProvider.wcwidth(d)}getStringCellWidth(d){let f=0,g=d.length;for(let w=0;w<g;++w){let b=d.charCodeAt(w);if(55296<=b&&b<=56319){if(++w>=g)return f+this.wcwidth(b);let o=d.charCodeAt(w);56320<=o&&o<=57343?b=1024*(b-55296)+o-56320+65536:f+=this.wcwidth(o)}f+=this.wcwidth(b)}return f}}}},t={};function s(u){var i=t[u];if(i!==void 0)return i.exports;var r=t[u]={exports:{}};return e[u].call(r.exports,r,r.exports,s),r.exports}var n={};return(()=>{var u=n;Object.defineProperty(u,"__esModule",{value:!0}),u.Terminal=void 0;let i=s(9042),r=s(3236),l=s(844),p=s(5741),d=s(8285),f=s(7975),g=s(7090),w=["cols","rows"];class b extends l.Disposable{constructor(a){super(),this._core=this.register(new r.Terminal(a)),this._addonManager=this.register(new p.AddonManager),this._publicOptions=Object.assign({},this._core.options);let c=_=>this._core.options[_],h=(_,v)=>{this._checkReadonlyOptions(_),this._core.options[_]=v};for(let _ in this._core.options){let v={get:c.bind(this,_),set:h.bind(this,_)};Object.defineProperty(this._publicOptions,_,v)}}_checkReadonlyOptions(a){if(w.includes(a))throw new Error(`Option "${a}" can only be set in the constructor`)}_checkProposedApi(){if(!this._core.optionsService.rawOptions.allowProposedApi)throw new Error("You must set the allowProposedApi option to true to use proposed API")}get onBell(){return this._core.onBell}get onBinary(){return this._core.onBinary}get onCursorMove(){return this._core.onCursorMove}get onData(){return this._core.onData}get onKey(){return this._core.onKey}get onLineFeed(){return this._core.onLineFeed}get onRender(){return this._core.onRender}get onResize(){return this._core.onResize}get onScroll(){return this._core.onScroll}get onSelectionChange(){return this._core.onSelectionChange}get onTitleChange(){return this._core.onTitleChange}get onWriteParsed(){return this._core.onWriteParsed}get element(){return this._core.element}get parser(){return this._parser||(this._parser=new f.ParserApi(this._core)),this._parser}get unicode(){return this._checkProposedApi(),new g.UnicodeApi(this._core)}get textarea(){return this._core.textarea}get rows(){return this._core.rows}get cols(){return this._core.cols}get buffer(){return this._buffer||(this._buffer=this.register(new d.BufferNamespaceApi(this._core))),this._buffer}get markers(){return this._checkProposedApi(),this._core.markers}get modes(){let a=this._core.coreService.decPrivateModes,c="none";switch(this._core.coreMouseService.activeProtocol){case"X10":c="x10";break;case"VT200":c="vt200";break;case"DRAG":c="drag";break;case"ANY":c="any"}return{applicationCursorKeysMode:a.applicationCursorKeys,applicationKeypadMode:a.applicationKeypad,bracketedPasteMode:a.bracketedPasteMode,insertMode:this._core.coreService.modes.insertMode,mouseTrackingMode:c,originMode:a.origin,reverseWraparoundMode:a.reverseWraparound,sendFocusMode:a.sendFocus,wraparoundMode:a.wraparound}}get options(){return this._publicOptions}set options(a){for(let c in a)this._publicOptions[c]=a[c]}blur(){this._core.blur()}focus(){this._core.focus()}resize(a,c){this._verifyIntegers(a,c),this._core.resize(a,c)}open(a){this._core.open(a)}attachCustomKeyEventHandler(a){this._core.attachCustomKeyEventHandler(a)}registerLinkProvider(a){return this._core.registerLinkProvider(a)}registerCharacterJoiner(a){return this._checkProposedApi(),this._core.registerCharacterJoiner(a)}deregisterCharacterJoiner(a){this._checkProposedApi(),this._core.deregisterCharacterJoiner(a)}registerMarker(a=0){return this._verifyIntegers(a),this._core.registerMarker(a)}registerDecoration(a){var c,h,_;return this._checkProposedApi(),this._verifyPositiveIntegers((c=a.x)!==null&&c!==void 0?c:0,(h=a.width)!==null&&h!==void 0?h:0,(_=a.height)!==null&&_!==void 0?_:0),this._core.registerDecoration(a)}hasSelection(){return this._core.hasSelection()}select(a,c,h){this._verifyIntegers(a,c,h),this._core.select(a,c,h)}getSelection(){return this._core.getSelection()}getSelectionPosition(){return this._core.getSelectionPosition()}clearSelection(){this._core.clearSelection()}selectAll(){this._core.selectAll()}selectLines(a,c){this._verifyIntegers(a,c),this._core.selectLines(a,c)}dispose(){super.dispose()}scrollLines(a){this._verifyIntegers(a),this._core.scrollLines(a)}scrollPages(a){this._verifyIntegers(a),this._core.scrollPages(a)}scrollToTop(){this._core.scrollToTop()}scrollToBottom(){this._core.scrollToBottom()}scrollToLine(a){this._verifyIntegers(a),this._core.scrollToLine(a)}clear(){this._core.clear()}write(a,c){this._core.write(a,c)}writeln(a,c){this._core.write(a),this._core.write(`\r
`,c)}paste(a){this._core.paste(a)}refresh(a,c){this._verifyIntegers(a,c),this._core.refresh(a,c)}reset(){this._core.reset()}clearTextureAtlas(){this._core.clearTextureAtlas()}loadAddon(a){this._addonManager.loadAddon(this,a)}static get strings(){return i}_verifyIntegers(...a){for(let c of a)if(c===1/0||isNaN(c)||c%1!=0)throw new Error("This API only accepts integers")}_verifyPositiveIntegers(...a){for(let c of a)if(c&&(c===1/0||isNaN(c)||c%1!=0||c<0))throw new Error("This API only accepts positive integers")}}u.Terminal=b})(),n})()))});var jr={};Go(jr,{FitAddon:()=>Fc});var Ic,Hc,Fc,Vr=Ko(()=>{Ic=2,Hc=1,Fc=class{activate(e){this._terminal=e}dispose(){}fit(){let e=this.proposeDimensions();if(!e||!this._terminal||isNaN(e.cols)||isNaN(e.rows))return;let t=this._terminal._core;(this._terminal.rows!==e.rows||this._terminal.cols!==e.cols)&&(t._renderService.clear(),this._terminal.resize(e.cols,e.rows))}proposeDimensions(){if(!this._terminal||!this._terminal.element||!this._terminal.element.parentElement)return;let e=this._terminal._core._renderService.dimensions;if(e.css.cell.width===0||e.css.cell.height===0)return;let t=this._terminal.options.scrollback===0?0:this._terminal.options.overviewRuler?.width||14,s=window.getComputedStyle(this._terminal.element.parentElement),n=parseInt(s.getPropertyValue("height")),u=Math.max(0,parseInt(s.getPropertyValue("width"))),i=window.getComputedStyle(this._terminal.element),r={top:parseInt(i.getPropertyValue("padding-top")),bottom:parseInt(i.getPropertyValue("padding-bottom")),right:parseInt(i.getPropertyValue("padding-right")),left:parseInt(i.getPropertyValue("padding-left"))},l=r.top+r.bottom,p=r.right+r.left,d=n-l,f=u-p-t;return{cols:Math.max(Ic,Math.floor(f/e.css.cell.width)),rows:Math.max(Hc,Math.floor(d/e.css.cell.height))}}}});var Qn={};Go(Qn,{SearchAddon:()=>Bh});function qr(e){Wc(e)||Nc.onUnexpectedError(e)}function Wc(e){return e instanceof Uc?!0:e instanceof Error&&e.name===Xr&&e.message===Xr}function jc(e,t,s=0,n=e.length){let u=s,i=n;for(;u<i;){let r=Math.floor((u+i)/2);t(e[r])?u=r+1:i=r}return u-1}function qc(e,t){return(s,n)=>t(e(s),e(n))}function Gc(e,t){let s=Object.create(null);for(let n of e){let u=t(n),i=s[u];i||(i=s[u]=[]),i.push(n)}return s}function Yc(e,t){let s=this,n=!1,u;return function(){if(n)return u;if(n=!0,t)try{u=e.apply(s,arguments)}finally{t()}else u=e.apply(s,arguments);return u}}function Qc(e){ui=e}function Ms(e){return ui?.trackDisposable(e),e}function Bs(e){ui?.markAsDisposed(e)}function Ki(e,t){ui?.setParent(e,t)}function eh(e,t){if(ui)for(let s of e)ui.setParent(s,t)}function qi(e){if(zn.is(e)){let t=[];for(let s of e)if(s)try{s.dispose()}catch(n){t.push(n)}if(t.length===1)throw t[0];if(t.length>1)throw new AggregateError(t,"Encountered errors while disposing of store");return Array.isArray(e)?[]:e}else if(e)return e.dispose(),e}function Wn(...e){let t=pi(()=>qi(e));return eh(e,t),t}function pi(e){let t=Ms({dispose:Yc(()=>{Bs(t),e()})});return t}function Zn(e,t=0,s){let n=setTimeout(()=>{e(),s&&u.dispose()},t),u=pi(()=>{clearTimeout(n),s?.deleteAndLeak(u)});return s?.add(u),u}var zc,Nc,Xr,Uc,Tn,Vc,Fn,Kc,Dn,Rn,$n,u_,Xc,zn,Jc,ui,Zc,Un,ro,rt,Os,On,th,ih,sh,Mn,rh,oo,Qr,oh,Bn,qn,nh,to,ah,lh,ch,Ts,hh,dh,Ds,st,uh,Xn,ph,fh,di,io,so,Rs,_h,mh,Yn,gh,vh,bh,yh,Ls,$s,Pn,wh,ut,pt,Fe,Jn,Sh,Kr,Ch,p_,ot,Ct,xh,kh,Eh,Ah,f_,__,m_,g_,Lh,Gr,Th,In,Dh,Rh,$h,Oh,Mh,Bh,ea=Ko(()=>{zc=class{constructor(){this.listeners=[],this.unexpectedErrorHandler=function(e){setTimeout(()=>{throw e.stack?Tn.isErrorNoTelemetry(e)?new Tn(e.message+`

`+e.stack):new Error(e.message+`

`+e.stack):e},0)}}addListener(e){return this.listeners.push(e),()=>{this._removeListener(e)}}emit(e){this.listeners.forEach(t=>{t(e)})}_removeListener(e){this.listeners.splice(this.listeners.indexOf(e),1)}setUnexpectedErrorHandler(e){this.unexpectedErrorHandler=e}getUnexpectedErrorHandler(){return this.unexpectedErrorHandler}onUnexpectedError(e){this.unexpectedErrorHandler(e),this.emit(e)}onUnexpectedExternalError(e){this.unexpectedErrorHandler(e)}},Nc=new zc;Xr="Canceled";Uc=class extends Error{constructor(){super(Xr),this.name=this.message}},Tn=class Yr extends Error{constructor(t){super(t),this.name="CodeExpectedError"}static fromError(t){if(t instanceof Yr)return t;let s=new Yr;return s.message=t.message,s.stack=t.stack,s}static isErrorNoTelemetry(t){return t.name==="CodeExpectedError"}};Vc=class Hn{constructor(t){this._array=t,this._findLastMonotonousLastIdx=0}findLastMonotonous(t){if(Hn.assertInvariants){if(this._prevFindLastPredicate){for(let n of this._array)if(this._prevFindLastPredicate(n)&&!t(n))throw new Error("MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.")}this._prevFindLastPredicate=t}let s=jc(this._array,t,this._findLastMonotonousLastIdx);return this._findLastMonotonousLastIdx=s+1,s===-1?void 0:this._array[s]}};Vc.assertInvariants=!1;(e=>{function t(i){return i<0}e.isLessThan=t;function s(i){return i<=0}e.isLessThanOrEqual=s;function n(i){return i>0}e.isGreaterThan=n;function u(i){return i===0}e.isNeitherLessOrGreaterThan=u,e.greaterThan=1,e.lessThan=-1,e.neitherLessOrGreaterThan=0})(Fn||(Fn={}));Kc=(e,t)=>e-t,Dn=class Jr{constructor(t){this.iterate=t}forEach(t){this.iterate(s=>(t(s),!0))}toArray(){let t=[];return this.iterate(s=>(t.push(s),!0)),t}filter(t){return new Jr(s=>this.iterate(n=>t(n)?s(n):!0))}map(t){return new Jr(s=>this.iterate(n=>s(t(n))))}some(t){let s=!1;return this.iterate(n=>(s=t(n),!s)),s}findFirst(t){let s;return this.iterate(n=>t(n)?(s=n,!1):!0),s}findLast(t){let s;return this.iterate(n=>(t(n)&&(s=n),!0)),s}findLastMaxBy(t){let s,n=!0;return this.iterate(u=>((n||Fn.isGreaterThan(t(u,s)))&&(n=!1,s=u),!0)),s}};Dn.empty=new Dn(e=>{});u_=class{constructor(e,t){this.toKey=t,this._map=new Map,this[Rn]="SetWithKey";for(let s of e)this.add(s)}get size(){return this._map.size}add(e){let t=this.toKey(e);return this._map.set(t,e),this}delete(e){return this._map.delete(this.toKey(e))}has(e){return this._map.has(this.toKey(e))}*entries(){for(let e of this._map.values())yield[e,e]}keys(){return this.values()}*values(){for(let e of this._map.values())yield e}clear(){this._map.clear()}forEach(e,t){this._map.forEach(s=>e.call(t,s,s,this))}[($n=Symbol.iterator,Rn=Symbol.toStringTag,$n)](){return this.values()}},Xc=class{constructor(){this.map=new Map}add(e,t){let s=this.map.get(e);s||(s=new Set,this.map.set(e,s)),s.add(t)}delete(e,t){let s=this.map.get(e);s&&(s.delete(t),s.size===0&&this.map.delete(e))}forEach(e,t){let s=this.map.get(e);s&&s.forEach(t)}get(e){return this.map.get(e)||new Set}};(e=>{function t(y){return y&&typeof y=="object"&&typeof y[Symbol.iterator]=="function"}e.is=t;let s=Object.freeze([]);function n(){return s}e.empty=n;function*u(y){yield y}e.single=u;function i(y){return t(y)?y:u(y)}e.wrap=i;function r(y){return y||s}e.from=r;function*l(y){for(let C=y.length-1;C>=0;C--)yield y[C]}e.reverse=l;function p(y){return!y||y[Symbol.iterator]().next().done===!0}e.isEmpty=p;function d(y){return y[Symbol.iterator]().next().value}e.first=d;function f(y,C){let m=0;for(let S of y)if(C(S,m++))return!0;return!1}e.some=f;function g(y,C){for(let m of y)if(C(m))return m}e.find=g;function*w(y,C){for(let m of y)C(m)&&(yield m)}e.filter=w;function*b(y,C){let m=0;for(let S of y)yield C(S,m++)}e.map=b;function*o(y,C){let m=0;for(let S of y)yield*C(S,m++)}e.flatMap=o;function*a(...y){for(let C of y)yield*C}e.concat=a;function c(y,C,m){let S=m;for(let L of y)S=C(S,L);return S}e.reduce=c;function*h(y,C,m=y.length){for(C<0&&(C+=y.length),m<0?m+=y.length:m>y.length&&(m=y.length);C<m;C++)yield y[C]}e.slice=h;function _(y,C=Number.POSITIVE_INFINITY){let m=[];if(C===0)return[m,y];let S=y[Symbol.iterator]();for(let L=0;L<C;L++){let $=S.next();if($.done)return[m,e.empty()];m.push($.value)}return[m,{[Symbol.iterator](){return S}}]}e.consume=_;async function v(y){let C=[];for await(let m of y)C.push(m);return Promise.resolve(C)}e.asyncToArray=v})(zn||(zn={}));Jc=!1,ui=null,Zc=class Nn{constructor(){this.livingDisposables=new Map}getDisposableData(t){let s=this.livingDisposables.get(t);return s||(s={parent:null,source:null,isSingleton:!1,value:t,idx:Nn.idx++},this.livingDisposables.set(t,s)),s}trackDisposable(t){let s=this.getDisposableData(t);s.source||(s.source=new Error().stack)}setParent(t,s){let n=this.getDisposableData(t);n.parent=s}markAsDisposed(t){this.livingDisposables.delete(t)}markAsSingleton(t){this.getDisposableData(t).isSingleton=!0}getRootParent(t,s){let n=s.get(t);if(n)return n;let u=t.parent?this.getRootParent(this.getDisposableData(t.parent),s):t;return s.set(t,u),u}getTrackedDisposables(){let t=new Map;return[...this.livingDisposables.entries()].filter(([,s])=>s.source!==null&&!this.getRootParent(s,t).isSingleton).flatMap(([s])=>s)}computeLeakingDisposables(t=10,s){let n;if(s)n=s;else{let p=new Map,d=[...this.livingDisposables.values()].filter(g=>g.source!==null&&!this.getRootParent(g,p).isSingleton);if(d.length===0)return;let f=new Set(d.map(g=>g.value));if(n=d.filter(g=>!(g.parent&&f.has(g.parent))),n.length===0)throw new Error("There are cyclic diposable chains!")}if(!n)return;function u(p){function d(g,w){for(;g.length>0&&w.some(b=>typeof b=="string"?b===g[0]:g[0].match(b));)g.shift()}let f=p.source.split(`
`).map(g=>g.trim().replace("at ","")).filter(g=>g!=="");return d(f,["Error",/^trackDisposable \(.*\)$/,/^DisposableTracker.trackDisposable \(.*\)$/]),f.reverse()}let i=new Xc;for(let p of n){let d=u(p);for(let f=0;f<=d.length;f++)i.add(d.slice(0,f).join(`
`),p)}n.sort(qc(p=>p.idx,Kc));let r="",l=0;for(let p of n.slice(0,t)){l++;let d=u(p),f=[];for(let g=0;g<d.length;g++){let w=d[g];w=`(shared with ${i.get(d.slice(0,g+1).join(`
`)).size}/${n.length} leaks) at ${w}`;let b=i.get(d.slice(0,g).join(`
`)),o=Gc([...b].map(a=>u(a)[g]),a=>a);delete o[d[g]];for(let[a,c]of Object.entries(o))f.unshift(`    - stacktraces of ${c.length} other leaks continue with ${a}`);f.unshift(w)}r+=`


==================== Leaking disposable ${l}/${n.length}: ${p.value.constructor.name} ====================
${f.join(`
`)}
============================================================

`}return n.length>t&&(r+=`


... and ${n.length-t} more leaking disposables

`),{leaks:n,details:r}}};Zc.idx=0;if(Jc){let e="__is_disposable_tracked__";Qc(new class{trackDisposable(t){let s=new Error("Potentially leaked disposable").stack;setTimeout(()=>{t[e]||console.log(s)},3e3)}setParent(t,s){if(t&&t!==rt.None)try{t[e]=!0}catch{}}markAsDisposed(t){if(t&&t!==rt.None)try{t[e]=!0}catch{}}markAsSingleton(t){}})}Un=class jn{constructor(){this._toDispose=new Set,this._isDisposed=!1,Ms(this)}dispose(){this._isDisposed||(Bs(this),this._isDisposed=!0,this.clear())}get isDisposed(){return this._isDisposed}clear(){if(this._toDispose.size!==0)try{qi(this._toDispose)}finally{this._toDispose.clear()}}add(t){if(!t)return t;if(t===this)throw new Error("Cannot register a disposable on itself!");return Ki(t,this),this._isDisposed?jn.DISABLE_DISPOSED_WARNING||console.warn(new Error("Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!").stack):this._toDispose.add(t),t}delete(t){if(t){if(t===this)throw new Error("Cannot dispose a disposable on itself!");this._toDispose.delete(t),t.dispose()}}deleteAndLeak(t){t&&this._toDispose.has(t)&&(this._toDispose.delete(t),Ki(t,null))}};Un.DISABLE_DISPOSED_WARNING=!1;ro=Un,rt=class{constructor(){this._store=new ro,Ms(this),Ki(this._store,this)}dispose(){Bs(this),this._store.dispose()}_register(e){if(e===this)throw new Error("Cannot register a disposable on itself!");return this._store.add(e)}};rt.None=Object.freeze({dispose(){}});Os=class{constructor(){this._isDisposed=!1,Ms(this)}get value(){return this._isDisposed?void 0:this._value}set value(e){this._isDisposed||e===this._value||(this._value?.dispose(),e&&Ki(e,this),this._value=e)}clear(){this.value=void 0}dispose(){this._isDisposed=!0,Bs(this),this._value?.dispose(),this._value=void 0}clearAndLeak(){let e=this._value;return this._value=void 0,e&&Ki(e,null),e}},On=class Zr{constructor(t){this.element=t,this.next=Zr.Undefined,this.prev=Zr.Undefined}};On.Undefined=new On(void 0);th=globalThis.performance&&typeof globalThis.performance.now=="function",ih=class Vn{static create(t){return new Vn(t)}constructor(t){this._now=th&&t===!1?Date.now:globalThis.performance.now.bind(globalThis.performance),this._startTime=this._now(),this._stopTime=-1}stop(){this._stopTime=this._now()}reset(){this._startTime=this._now(),this._stopTime=-1}elapsed(){return this._stopTime!==-1?this._stopTime-this._startTime:this._now()-this._startTime}},sh=!1,Mn=!1,rh=!1;(e=>{e.None=()=>rt.None;function t(B){if(rh){let{onDidAddListener:M}=B,H=to.create(),x=0;B.onDidAddListener=()=>{++x===2&&(console.warn("snapshotted emitter LIKELY used public and SHOULD HAVE BEEN created with DisposableStore. snapshotted here"),H.print()),M?.()}}}function s(B,M){return w(B,()=>{},0,void 0,!0,void 0,M)}e.defer=s;function n(B){return(M,H=null,x)=>{let E=!1,A;return A=B(R=>{if(!E)return A?A.dispose():E=!0,M.call(H,R)},null,x),E&&A.dispose(),A}}e.once=n;function u(B,M,H){return f((x,E=null,A)=>B(R=>x.call(E,M(R)),null,A),H)}e.map=u;function i(B,M,H){return f((x,E=null,A)=>B(R=>{M(R),x.call(E,R)},null,A),H)}e.forEach=i;function r(B,M,H){return f((x,E=null,A)=>B(R=>M(R)&&x.call(E,R),null,A),H)}e.filter=r;function l(B){return B}e.signal=l;function p(...B){return(M,H=null,x)=>{let E=Wn(...B.map(A=>A(R=>M.call(H,R))));return g(E,x)}}e.any=p;function d(B,M,H,x){let E=H;return u(B,A=>(E=M(E,A),E),x)}e.reduce=d;function f(B,M){let H,x={onWillAddFirstListener(){H=B(E.fire,E)},onDidRemoveLastListener(){H?.dispose()}};M||t(x);let E=new st(x);return M?.add(E),E.event}function g(B,M){return M instanceof Array?M.push(B):M&&M.add(B),B}function w(B,M,H=100,x=!1,E=!1,A,R){let N,j,X,K=0,he,k={leakWarningThreshold:A,onWillAddFirstListener(){N=B(U=>{K++,j=M(j,U),x&&!X&&(F.fire(j),j=void 0),he=()=>{let W=j;j=void 0,X=void 0,(!x||K>1)&&F.fire(W),K=0},typeof H=="number"?(clearTimeout(X),X=setTimeout(he,H)):X===void 0&&(X=0,queueMicrotask(he))})},onWillRemoveListener(){E&&K>0&&he?.()},onDidRemoveLastListener(){he=void 0,N.dispose()}};R||t(k);let F=new st(k);return R?.add(F),F.event}e.debounce=w;function b(B,M=0,H){return e.debounce(B,(x,E)=>x?(x.push(E),x):[E],M,void 0,!0,void 0,H)}e.accumulate=b;function o(B,M=(x,E)=>x===E,H){let x=!0,E;return r(B,A=>{let R=x||!M(A,E);return x=!1,E=A,R},H)}e.latch=o;function a(B,M,H){return[e.filter(B,M,H),e.filter(B,x=>!M(x),H)]}e.split=a;function c(B,M=!1,H=[],x){let E=H.slice(),A=B(j=>{E?E.push(j):N.fire(j)});x&&x.add(A);let R=()=>{E?.forEach(j=>N.fire(j)),E=null},N=new st({onWillAddFirstListener(){A||(A=B(j=>N.fire(j)),x&&x.add(A))},onDidAddFirstListener(){E&&(M?setTimeout(R):R())},onDidRemoveLastListener(){A&&A.dispose(),A=null}});return x&&x.add(N),N.event}e.buffer=c;function h(B,M){return(H,x,E)=>{let A=M(new v);return B(function(R){let N=A.evaluate(R);N!==_&&H.call(x,N)},void 0,E)}}e.chain=h;let _=Symbol("HaltChainable");class v{constructor(){this.steps=[]}map(M){return this.steps.push(M),this}forEach(M){return this.steps.push(H=>(M(H),H)),this}filter(M){return this.steps.push(H=>M(H)?H:_),this}reduce(M,H){let x=H;return this.steps.push(E=>(x=M(x,E),x)),this}latch(M=(H,x)=>H===x){let H=!0,x;return this.steps.push(E=>{let A=H||!M(E,x);return H=!1,x=E,A?E:_}),this}evaluate(M){for(let H of this.steps)if(M=H(M),M===_)break;return M}}function y(B,M,H=x=>x){let x=(...N)=>R.fire(H(...N)),E=()=>B.on(M,x),A=()=>B.removeListener(M,x),R=new st({onWillAddFirstListener:E,onDidRemoveLastListener:A});return R.event}e.fromNodeEventEmitter=y;function C(B,M,H=x=>x){let x=(...N)=>R.fire(H(...N)),E=()=>B.addEventListener(M,x),A=()=>B.removeEventListener(M,x),R=new st({onWillAddFirstListener:E,onDidRemoveLastListener:A});return R.event}e.fromDOMEventEmitter=C;function m(B){return new Promise(M=>n(B)(M))}e.toPromise=m;function S(B){let M=new st;return B.then(H=>{M.fire(H)},()=>{M.fire(void 0)}).finally(()=>{M.dispose()}),M.event}e.fromPromise=S;function L(B,M){return B(H=>M.fire(H))}e.forward=L;function $(B,M,H){return M(H),B(x=>M(x))}e.runAndSubscribe=$;class T{constructor(M,H){this._observable=M,this._counter=0,this._hasChanged=!1;let x={onWillAddFirstListener:()=>{M.addObserver(this)},onDidRemoveLastListener:()=>{M.removeObserver(this)}};H||t(x),this.emitter=new st(x),H&&H.add(this.emitter)}beginUpdate(M){this._counter++}handlePossibleChange(M){}handleChange(M,H){this._hasChanged=!0}endUpdate(M){this._counter--,this._counter===0&&(this._observable.reportChanges(),this._hasChanged&&(this._hasChanged=!1,this.emitter.fire(this._observable.get())))}}function O(B,M){return new T(B,M).emitter.event}e.fromObservable=O;function z(B){return(M,H,x)=>{let E=0,A=!1,R={beginUpdate(){E++},endUpdate(){E--,E===0&&(B.reportChanges(),A&&(A=!1,M.call(H)))},handlePossibleChange(){},handleChange(){A=!0}};B.addObserver(R),B.reportChanges();let N={dispose(){B.removeObserver(R)}};return x instanceof ro?x.add(N):Array.isArray(x)&&x.push(N),N}}e.fromObservableLight=z})(oo||(oo={}));Qr=class eo{constructor(t){this.listenerCount=0,this.invocationCount=0,this.elapsedOverall=0,this.durations=[],this.name=`${t}_${eo._idPool++}`,eo.all.add(this)}start(t){this._stopWatch=new ih,this.listenerCount=t}stop(){if(this._stopWatch){let t=this._stopWatch.elapsed();this.durations.push(t),this.elapsedOverall+=t,this.invocationCount+=1,this._stopWatch=void 0}}};Qr.all=new Set,Qr._idPool=0;oh=Qr,Bn=-1,qn=class Kn{constructor(t,s,n=(Kn._idPool++).toString(16).padStart(3,"0")){this._errorHandler=t,this.threshold=s,this.name=n,this._warnCountdown=0}dispose(){this._stacks?.clear()}check(t,s){let n=this.threshold;if(n<=0||s<n)return;this._stacks||(this._stacks=new Map);let u=this._stacks.get(t.value)||0;if(this._stacks.set(t.value,u+1),this._warnCountdown-=1,this._warnCountdown<=0){this._warnCountdown=n*.5;let[i,r]=this.getMostFrequentStack(),l=`[${this.name}] potential listener LEAK detected, having ${s} listeners already. MOST frequent listener (${r}):`;console.warn(l),console.warn(i);let p=new ah(l,i);this._errorHandler(p)}return()=>{let i=this._stacks.get(t.value)||0;this._stacks.set(t.value,i-1)}}getMostFrequentStack(){if(!this._stacks)return;let t,s=0;for(let[n,u]of this._stacks)(!t||s<u)&&(t=[n,u],s=u);return t}};qn._idPool=1;nh=qn,to=class Gn{constructor(t){this.value=t}static create(){let t=new Error;return new Gn(t.stack??"")}print(){console.warn(this.value.split(`
`).slice(2).join(`
`))}},ah=class extends Error{constructor(e,t){super(e),this.name="ListenerLeakError",this.stack=t}},lh=class extends Error{constructor(e,t){super(e),this.name="ListenerRefusalError",this.stack=t}},ch=0,Ts=class{constructor(e){this.value=e,this.id=ch++}},hh=2,dh=(e,t)=>{if(e instanceof Ts)t(e);else for(let s=0;s<e.length;s++){let n=e[s];n&&t(n)}};if(sh){let e=[];setInterval(()=>{e.length!==0&&(console.warn("[LEAKING LISTENERS] GC'ed these listeners that were NOT yet disposed:"),console.warn(e.join(`
`)),e.length=0)},3e3),Ds=new FinalizationRegistry(t=>{typeof t=="string"&&e.push(t)})}st=class{constructor(e){this._size=0,this._options=e,this._leakageMon=Bn>0||this._options?.leakWarningThreshold?new nh(e?.onListenerError??qr,this._options?.leakWarningThreshold??Bn):void 0,this._perfMon=this._options?._profName?new oh(this._options._profName):void 0,this._deliveryQueue=this._options?.deliveryQueue}dispose(){if(!this._disposed){if(this._disposed=!0,this._deliveryQueue?.current===this&&this._deliveryQueue.reset(),this._listeners){if(Mn){let e=this._listeners;queueMicrotask(()=>{dh(e,t=>t.stack?.print())})}this._listeners=void 0,this._size=0}this._options?.onDidRemoveLastListener?.(),this._leakageMon?.dispose()}}get event(){return this._event??(this._event=(e,t,s)=>{if(this._leakageMon&&this._size>this._leakageMon.threshold**2){let l=`[${this._leakageMon.name}] REFUSES to accept new listeners because it exceeded its threshold by far (${this._size} vs ${this._leakageMon.threshold})`;console.warn(l);let p=this._leakageMon.getMostFrequentStack()??["UNKNOWN stack",-1],d=new lh(`${l}. HINT: Stack shows most frequent listener (${p[1]}-times)`,p[0]);return(this._options?.onListenerError||qr)(d),rt.None}if(this._disposed)return rt.None;t&&(e=e.bind(t));let n=new Ts(e),u,i;this._leakageMon&&this._size>=Math.ceil(this._leakageMon.threshold*.2)&&(n.stack=to.create(),u=this._leakageMon.check(n.stack,this._size+1)),Mn&&(n.stack=i??to.create()),this._listeners?this._listeners instanceof Ts?(this._deliveryQueue??(this._deliveryQueue=new uh),this._listeners=[this._listeners,n]):this._listeners.push(n):(this._options?.onWillAddFirstListener?.(this),this._listeners=n,this._options?.onDidAddFirstListener?.(this)),this._size++;let r=pi(()=>{Ds?.unregister(r),u?.(),this._removeListener(n)});if(s instanceof ro?s.add(r):Array.isArray(s)&&s.push(r),Ds){let l=new Error().stack.split(`
`).slice(2,3).join(`
`).trim(),p=/(file:|vscode-file:\/\/vscode-app)?(\/[^:]*:\d+:\d+)/.exec(l);Ds.register(r,p?.[2]??l,r)}return r}),this._event}_removeListener(e){if(this._options?.onWillRemoveListener?.(this),!this._listeners)return;if(this._size===1){this._listeners=void 0,this._options?.onDidRemoveLastListener?.(this),this._size=0;return}let t=this._listeners,s=t.indexOf(e);if(s===-1)throw console.log("disposed?",this._disposed),console.log("size?",this._size),console.log("arr?",JSON.stringify(this._listeners)),new Error("Attempted to dispose unknown listener");this._size--,t[s]=void 0;let n=this._deliveryQueue.current===this;if(this._size*hh<=t.length){let u=0;for(let i=0;i<t.length;i++)t[i]?t[u++]=t[i]:n&&(this._deliveryQueue.end--,u<this._deliveryQueue.i&&this._deliveryQueue.i--);t.length=u}}_deliver(e,t){if(!e)return;let s=this._options?.onListenerError||qr;if(!s){e.value(t);return}try{e.value(t)}catch(n){s(n)}}_deliverQueue(e){let t=e.current._listeners;for(;e.i<e.end;)this._deliver(t[e.i++],e.value);e.reset()}fire(e){if(this._deliveryQueue?.current&&(this._deliverQueue(this._deliveryQueue),this._perfMon?.stop()),this._perfMon?.start(this._size),this._listeners)if(this._listeners instanceof Ts)this._deliver(this._listeners,e);else{let t=this._deliveryQueue;t.enqueue(this,e,this._listeners.length),this._deliverQueue(t)}this._perfMon?.stop()}hasListeners(){return this._size>0}},uh=class{constructor(){this.i=-1,this.end=0}enqueue(e,t,s){this.i=0,this.end=s,this.current=e,this.value=t}reset(){this.i=this.end,this.current=void 0,this.value=void 0}},Xn=Object.freeze(function(e,t){let s=setTimeout(e.bind(t),0);return{dispose(){clearTimeout(s)}}});(e=>{function t(s){return s===e.None||s===e.Cancelled||s instanceof fh?!0:!s||typeof s!="object"?!1:typeof s.isCancellationRequested=="boolean"&&typeof s.onCancellationRequested=="function"}e.isCancellationToken=t,e.None=Object.freeze({isCancellationRequested:!1,onCancellationRequested:oo.None}),e.Cancelled=Object.freeze({isCancellationRequested:!0,onCancellationRequested:Xn})})(ph||(ph={}));fh=class{constructor(){this._isCancelled=!1,this._emitter=null}cancel(){this._isCancelled||(this._isCancelled=!0,this._emitter&&(this._emitter.fire(void 0),this.dispose()))}get isCancellationRequested(){return this._isCancelled}get onCancellationRequested(){return this._isCancelled?Xn:(this._emitter||(this._emitter=new st),this._emitter.event)}dispose(){this._emitter&&(this._emitter.dispose(),this._emitter=null)}},di="en",io=!1,so=!1,Rs=!1,_h=!1,mh=!1,Yn=!1,gh=!1,vh=!1,bh=!1,yh=!1,$s=di,Pn=di,pt=globalThis;typeof pt.vscode<"u"&&typeof pt.vscode.process<"u"?Fe=pt.vscode.process:typeof process<"u"&&typeof process?.versions?.node=="string"&&(Fe=process);Jn=typeof Fe?.versions?.electron=="string",Sh=Jn&&Fe?.type==="renderer";if(typeof Fe=="object"){io=Fe.platform==="win32",so=Fe.platform==="darwin",Rs=Fe.platform==="linux",_h=Rs&&!!Fe.env.SNAP&&!!Fe.env.SNAP_REVISION,gh=Jn,bh=!!Fe.env.CI||!!Fe.env.BUILD_ARTIFACTSTAGINGDIRECTORY,Ls=di,$s=di;let e=Fe.env.VSCODE_NLS_CONFIG;if(e)try{let t=JSON.parse(e);Ls=t.userLocale,Pn=t.osLocale,$s=t.resolvedLanguage||di,wh=t.languagePack?.translationsConfigFile}catch{}mh=!0}else typeof navigator=="object"&&!Sh?(ut=navigator.userAgent,io=ut.indexOf("Windows")>=0,so=ut.indexOf("Macintosh")>=0,vh=(ut.indexOf("Macintosh")>=0||ut.indexOf("iPad")>=0||ut.indexOf("iPhone")>=0)&&!!navigator.maxTouchPoints&&navigator.maxTouchPoints>0,Rs=ut.indexOf("Linux")>=0,yh=ut?.indexOf("Mobi")>=0,Yn=!0,$s=globalThis._VSCODE_NLS_LANGUAGE||di,Ls=navigator.language.toLowerCase(),Pn=Ls):console.error("Unable to resolve platform.");Kr=0;so?Kr=1:io?Kr=3:Rs&&(Kr=2);Ch=Yn&&typeof pt.importScripts=="function",p_=Ch?pt.origin:void 0,ot=ut,Ct=$s;(e=>{function t(){return Ct}e.value=t;function s(){return Ct.length===2?Ct==="en":Ct.length>=3?Ct[0]==="e"&&Ct[1]==="n"&&Ct[2]==="-":!1}e.isDefaultVariant=s;function n(){return Ct==="en"}e.isDefault=n})(xh||(xh={}));kh=typeof pt.postMessage=="function"&&!pt.importScripts,Eh=(()=>{if(kh){let e=[];pt.addEventListener("message",s=>{if(s.data&&s.data.vscodeScheduleAsyncWork)for(let n=0,u=e.length;n<u;n++){let i=e[n];if(i.id===s.data.vscodeScheduleAsyncWork){e.splice(n,1),i.callback();return}}});let t=0;return s=>{let n=++t;e.push({id:n,callback:s}),pt.postMessage({vscodeScheduleAsyncWork:n},"*")}}return e=>setTimeout(e)})(),Ah=!!(ot&&ot.indexOf("Chrome")>=0),f_=!!(ot&&ot.indexOf("Firefox")>=0),__=!!(!Ah&&ot&&ot.indexOf("Safari")>=0),m_=!!(ot&&ot.indexOf("Edg/")>=0),g_=!!(ot&&ot.indexOf("Android")>=0);(function(){typeof globalThis.requestIdleCallback!="function"||typeof globalThis.cancelIdleCallback!="function"?Gr=(e,t)=>{Eh(()=>{if(s)return;let n=Date.now()+15;t(Object.freeze({didTimeout:!0,timeRemaining(){return Math.max(0,n-Date.now())}}))});let s=!1;return{dispose(){s||(s=!0)}}}:Gr=(e,t,s)=>{let n=e.requestIdleCallback(t,typeof s=="number"?{timeout:s}:void 0),u=!1;return{dispose(){u||(u=!0,e.cancelIdleCallback(n))}}},Lh=e=>Gr(globalThis,e)})();(e=>{async function t(n){let u,i=await Promise.all(n.map(r=>r.then(l=>l,l=>{u||(u=l)})));if(typeof u<"u")throw u;return i}e.settled=t;function s(n){return new Promise(async(u,i)=>{try{await n(u,i)}catch(r){i(r)}})}e.withAsyncBody=s})(Th||(Th={}));In=class Ue{static fromArray(t){return new Ue(s=>{s.emitMany(t)})}static fromPromise(t){return new Ue(async s=>{s.emitMany(await t)})}static fromPromises(t){return new Ue(async s=>{await Promise.all(t.map(async n=>s.emitOne(await n)))})}static merge(t){return new Ue(async s=>{await Promise.all(t.map(async n=>{for await(let u of n)s.emitOne(u)}))})}constructor(t,s){this._state=0,this._results=[],this._error=null,this._onReturn=s,this._onStateChanged=new st,queueMicrotask(async()=>{let n={emitOne:u=>this.emitOne(u),emitMany:u=>this.emitMany(u),reject:u=>this.reject(u)};try{await Promise.resolve(t(n)),this.resolve()}catch(u){this.reject(u)}finally{n.emitOne=void 0,n.emitMany=void 0,n.reject=void 0}})}[Symbol.asyncIterator](){let t=0;return{next:async()=>{do{if(this._state===2)throw this._error;if(t<this._results.length)return{done:!1,value:this._results[t++]};if(this._state===1)return{done:!0,value:void 0};await oo.toPromise(this._onStateChanged.event)}while(!0)},return:async()=>(this._onReturn?.(),{done:!0,value:void 0})}}static map(t,s){return new Ue(async n=>{for await(let u of t)n.emitOne(s(u))})}map(t){return Ue.map(this,t)}static filter(t,s){return new Ue(async n=>{for await(let u of t)s(u)&&n.emitOne(u)})}filter(t){return Ue.filter(this,t)}static coalesce(t){return Ue.filter(t,s=>!!s)}coalesce(){return Ue.coalesce(this)}static async toPromise(t){let s=[];for await(let n of t)s.push(n);return s}toPromise(){return Ue.toPromise(this)}emitOne(t){this._state===0&&(this._results.push(t),this._onStateChanged.fire())}emitMany(t){this._state===0&&(this._results=this._results.concat(t),this._onStateChanged.fire())}resolve(){this._state===0&&(this._state=1,this._onStateChanged.fire())}reject(t){this._state===0&&(this._state=2,this._error=t,this._onStateChanged.fire())}};In.EMPTY=In.fromArray([]);Dh=class extends rt{constructor(e){super(),this._terminal=e,this._linesCacheTimeout=this._register(new Os),this._linesCacheDisposables=this._register(new Os),this._register(pi(()=>this._destroyLinesCache()))}initLinesCache(){this._linesCache||(this._linesCache=new Array(this._terminal.buffer.active.length),this._linesCacheDisposables.value=Wn(this._terminal.onLineFeed(()=>this._destroyLinesCache()),this._terminal.onCursorMove(()=>this._destroyLinesCache()),this._terminal.onResize(()=>this._destroyLinesCache()))),this._linesCacheTimeout.value=Zn(()=>this._destroyLinesCache(),15e3)}_destroyLinesCache(){this._linesCache=void 0,this._linesCacheDisposables.clear(),this._linesCacheTimeout.clear()}getLineFromCache(e){return this._linesCache?.[e]}setLineInCache(e,t){this._linesCache&&(this._linesCache[e]=t)}translateBufferLineToStringWithWrap(e,t){let s=[],n=[0],u=this._terminal.buffer.active.getLine(e);for(;u;){let i=this._terminal.buffer.active.getLine(e+1),r=i?i.isWrapped:!1,l=u.translateToString(!r&&t);if(r&&i){let p=u.getCell(u.length-1);p&&p.getCode()===0&&p.getWidth()===1&&i.getCell(0)?.getWidth()===2&&(l=l.slice(0,-1))}if(s.push(l),r)n.push(n[n.length-1]+l.length);else break;e++,u=i}return[s.join(""),n]}},Rh=class{get cachedSearchTerm(){return this._cachedSearchTerm}set cachedSearchTerm(e){this._cachedSearchTerm=e}get lastSearchOptions(){return this._lastSearchOptions}set lastSearchOptions(e){this._lastSearchOptions=e}isValidSearchTerm(e){return!!(e&&e.length>0)}didOptionsChange(e){return this._lastSearchOptions?e?this._lastSearchOptions.caseSensitive!==e.caseSensitive||this._lastSearchOptions.regex!==e.regex||this._lastSearchOptions.wholeWord!==e.wholeWord:!1:!0}shouldUpdateHighlighting(e,t){return t?.decorations?this._cachedSearchTerm===void 0||e!==this._cachedSearchTerm||this.didOptionsChange(t):!1}clearCachedTerm(){this._cachedSearchTerm=void 0}reset(){this._cachedSearchTerm=void 0,this._lastSearchOptions=void 0}},$h=class{constructor(e,t){this._terminal=e,this._lineCache=t}find(e,t,s,n){if(!e||e.length===0){this._terminal.clearSelection();return}if(s>this._terminal.cols)throw new Error(`Invalid col: ${s} to search in terminal of ${this._terminal.cols} cols`);this._lineCache.initLinesCache();let u={startRow:t,startCol:s},i=this._findInLine(e,u,n);if(!i)for(let r=t+1;r<this._terminal.buffer.active.baseY+this._terminal.rows&&(u.startRow=r,u.startCol=0,i=this._findInLine(e,u,n),!i);r++);return i}findNextWithSelection(e,t,s){if(!e||e.length===0){this._terminal.clearSelection();return}let n=this._terminal.getSelectionPosition();this._terminal.clearSelection();let u=0,i=0;n&&(s===e?(u=n.end.x,i=n.end.y):(u=n.start.x,i=n.start.y)),this._lineCache.initLinesCache();let r={startRow:i,startCol:u},l=this._findInLine(e,r,t);if(!l)for(let p=i+1;p<this._terminal.buffer.active.baseY+this._terminal.rows&&(r.startRow=p,r.startCol=0,l=this._findInLine(e,r,t),!l);p++);if(!l&&i!==0)for(let p=0;p<i&&(r.startRow=p,r.startCol=0,l=this._findInLine(e,r,t),!l);p++);return!l&&n&&(r.startRow=n.start.y,r.startCol=0,l=this._findInLine(e,r,t)),l}findPreviousWithSelection(e,t,s){if(!e||e.length===0){this._terminal.clearSelection();return}let n=this._terminal.getSelectionPosition();this._terminal.clearSelection();let u=this._terminal.buffer.active.baseY+this._terminal.rows-1,i=this._terminal.cols,r=!0;this._lineCache.initLinesCache();let l={startRow:u,startCol:i},p;if(n&&(l.startRow=u=n.start.y,l.startCol=i=n.start.x,s!==e&&(p=this._findInLine(e,l,t,!1),p||(l.startRow=u=n.end.y,l.startCol=i=n.end.x))),p||(p=this._findInLine(e,l,t,r)),!p){l.startCol=Math.max(l.startCol,this._terminal.cols);for(let d=u-1;d>=0&&(l.startRow=d,p=this._findInLine(e,l,t,r),!p);d--);}if(!p&&u!==this._terminal.buffer.active.baseY+this._terminal.rows-1)for(let d=this._terminal.buffer.active.baseY+this._terminal.rows-1;d>=u&&(l.startRow=d,p=this._findInLine(e,l,t,r),!p);d--);return p}_isWholeWord(e,t,s){return(e===0||" ~!@#$%^&*()+`-=[]{}|\\;:\"',./<>?".includes(t[e-1]))&&(e+s.length===t.length||" ~!@#$%^&*()+`-=[]{}|\\;:\"',./<>?".includes(t[e+s.length]))}_findInLine(e,t,s={},n=!1){let u=t.startRow,i=t.startCol;if(this._terminal.buffer.active.getLine(u)?.isWrapped){if(n){t.startCol+=this._terminal.cols;return}return t.startRow--,t.startCol+=this._terminal.cols,this._findInLine(e,t,s)}let r=this._lineCache.getLineFromCache(u);r||(r=this._lineCache.translateBufferLineToStringWithWrap(u,!0),this._lineCache.setLineInCache(u,r));let[l,p]=r,d=this._bufferColsToStringOffset(u,i),f=e,g=l;s.regex||(f=s.caseSensitive?e:e.toLowerCase(),g=s.caseSensitive?l:l.toLowerCase());let w=-1;if(s.regex){let b=RegExp(f,s.caseSensitive?"g":"gi"),o;if(n)for(;o=b.exec(g.slice(0,d));)w=b.lastIndex-o[0].length,e=o[0],b.lastIndex-=e.length-1;else o=b.exec(g.slice(d)),o&&o[0].length>0&&(w=d+(b.lastIndex-o[0].length),e=o[0])}else n?d-f.length>=0&&(w=g.lastIndexOf(f,d-f.length)):w=g.indexOf(f,d);if(w>=0){if(s.wholeWord&&!this._isWholeWord(w,g,e))return;let b=0;for(;b<p.length-1&&w>=p[b+1];)b++;let o=b;for(;o<p.length-1&&w+e.length>=p[o+1];)o++;let a=w-p[b],c=w+e.length-p[o],h=this._stringLengthToBufferSize(u+b,a),_=this._stringLengthToBufferSize(u+o,c)-h+this._terminal.cols*(o-b);return{term:e,col:h,row:u+b,size:_}}}_stringLengthToBufferSize(e,t){let s=this._terminal.buffer.active.getLine(e);if(!s)return 0;for(let n=0;n<t;n++){let u=s.getCell(n);if(!u)break;let i=u.getChars();i.length>1&&(t-=i.length-1);let r=s.getCell(n+1);r&&r.getWidth()===0&&t++}return t}_bufferColsToStringOffset(e,t){let s=e,n=0,u=this._terminal.buffer.active.getLine(s);for(;t>0&&u;){for(let i=0;i<t&&i<this._terminal.cols;i++){let r=u.getCell(i);if(!r)break;r.getWidth()&&(n+=r.getCode()===0?1:r.getChars().length)}if(s++,u=this._terminal.buffer.active.getLine(s),u&&!u.isWrapped)break;t-=this._terminal.cols}return n}},Oh=class extends rt{constructor(e){super(),this._terminal=e,this._highlightDecorations=[],this._highlightedLines=new Set,this._register(pi(()=>this.clearHighlightDecorations()))}createHighlightDecorations(e,t){this.clearHighlightDecorations();for(let s of e){let n=this._createResultDecorations(s,t,!1);if(n)for(let u of n)this._storeDecoration(u,s)}}createActiveDecoration(e,t){let s=this._createResultDecorations(e,t,!0);if(s)return{decorations:s,match:e,dispose(){qi(s)}}}clearHighlightDecorations(){qi(this._highlightDecorations),this._highlightDecorations=[],this._highlightedLines.clear()}_storeDecoration(e,t){this._highlightedLines.add(e.marker.line),this._highlightDecorations.push({decoration:e,match:t,dispose(){e.dispose()}})}_applyStyles(e,t,s){e.classList.contains("xterm-find-result-decoration")||(e.classList.add("xterm-find-result-decoration"),t&&(e.style.outline=`1px solid ${t}`)),s&&e.classList.add("xterm-find-active-result-decoration")}_createResultDecorations(e,t,s){let n=[],u=e.col,i=e.size,r=-this._terminal.buffer.active.baseY-this._terminal.buffer.active.cursorY+e.row;for(;i>0;){let p=Math.min(this._terminal.cols-u,i);n.push([r,u,p]),u=0,i-=p,r++}let l=[];for(let p of n){let d=this._terminal.registerMarker(p[0]),f=this._terminal.registerDecoration({marker:d,x:p[1],width:p[2],backgroundColor:s?t.activeMatchBackground:t.matchBackground,overviewRulerOptions:this._highlightedLines.has(d.line)?void 0:{color:s?t.activeMatchColorOverviewRuler:t.matchOverviewRuler,position:"center"}});if(f){let g=[];g.push(d),g.push(f.onRender(w=>this._applyStyles(w,s?t.activeMatchBorder:t.matchBorder,!1))),g.push(f.onDispose(()=>qi(g))),l.push(f)}}return l.length===0?void 0:l}},Mh=class extends rt{constructor(){super(...arguments),this._searchResults=[],this._onDidChangeResults=this._register(new st)}get onDidChangeResults(){return this._onDidChangeResults.event}get searchResults(){return this._searchResults}get selectedDecoration(){return this._selectedDecoration}set selectedDecoration(e){this._selectedDecoration=e}updateResults(e,t){this._searchResults=e.slice(0,t)}clearResults(){this._searchResults=[]}clearSelectedDecoration(){this._selectedDecoration&&(this._selectedDecoration.dispose(),this._selectedDecoration=void 0)}findResultIndex(e){for(let t=0;t<this._searchResults.length;t++){let s=this._searchResults[t];if(s.row===e.row&&s.col===e.col&&s.size===e.size)return t}return-1}fireResultsChanged(e){if(!e)return;let t=-1;this._selectedDecoration&&(t=this.findResultIndex(this._selectedDecoration.match)),this._onDidChangeResults.fire({resultIndex:t,resultCount:this._searchResults.length})}reset(){this.clearSelectedDecoration(),this.clearResults()}},Bh=class extends rt{constructor(e){super(),this._highlightTimeout=this._register(new Os),this._lineCache=this._register(new Os),this._state=new Rh,this._resultTracker=this._register(new Mh),this._highlightLimit=e?.highlightLimit??1e3}get onDidChangeResults(){return this._resultTracker.onDidChangeResults}activate(e){this._terminal=e,this._lineCache.value=new Dh(e),this._engine=new $h(e,this._lineCache.value),this._decorationManager=new Oh(e),this._register(this._terminal.onWriteParsed(()=>this._updateMatches())),this._register(this._terminal.onResize(()=>this._updateMatches())),this._register(pi(()=>this.clearDecorations()))}_updateMatches(){this._highlightTimeout.clear(),this._state.cachedSearchTerm&&this._state.lastSearchOptions?.decorations&&(this._highlightTimeout.value=Zn(()=>{let e=this._state.cachedSearchTerm;this._state.clearCachedTerm(),this.findPrevious(e,{...this._state.lastSearchOptions,incremental:!0},{noScroll:!0})},200))}clearDecorations(e){this._resultTracker.clearSelectedDecoration(),this._decorationManager?.clearHighlightDecorations(),this._resultTracker.clearResults(),e||this._state.clearCachedTerm()}clearActiveDecoration(){this._resultTracker.clearSelectedDecoration()}findNext(e,t,s){if(!this._terminal||!this._engine)throw new Error("Cannot use addon until it has been loaded");this._state.lastSearchOptions=t,this._state.shouldUpdateHighlighting(e,t)&&this._highlightAllMatches(e,t);let n=this._findNextAndSelect(e,t,s);return this._fireResults(t),this._state.cachedSearchTerm=e,n}_highlightAllMatches(e,t){if(!this._terminal||!this._engine||!this._decorationManager)throw new Error("Cannot use addon until it has been loaded");if(!this._state.isValidSearchTerm(e)){this.clearDecorations();return}this.clearDecorations(!0);let s=[],n,u=this._engine.find(e,0,0,t);for(;u&&(n?.row!==u.row||n?.col!==u.col)&&!(s.length>=this._highlightLimit);)n=u,s.push(n),u=this._engine.find(e,n.col+n.term.length>=this._terminal.cols?n.row+1:n.row,n.col+n.term.length>=this._terminal.cols?0:n.col+1,t);this._resultTracker.updateResults(s,this._highlightLimit),t.decorations&&this._decorationManager.createHighlightDecorations(s,t.decorations)}_findNextAndSelect(e,t,s){if(!this._terminal||!this._engine)return!1;if(!this._state.isValidSearchTerm(e))return this._terminal.clearSelection(),this.clearDecorations(),!1;let n=this._engine.findNextWithSelection(e,t,this._state.cachedSearchTerm);return this._selectResult(n,t?.decorations,s?.noScroll)}findPrevious(e,t,s){if(!this._terminal||!this._engine)throw new Error("Cannot use addon until it has been loaded");this._state.lastSearchOptions=t,this._state.shouldUpdateHighlighting(e,t)&&this._highlightAllMatches(e,t);let n=this._findPreviousAndSelect(e,t,s);return this._fireResults(t),this._state.cachedSearchTerm=e,n}_fireResults(e){this._resultTracker.fireResultsChanged(!!e?.decorations)}_findPreviousAndSelect(e,t,s){if(!this._terminal||!this._engine)return!1;if(!this._state.isValidSearchTerm(e))return this._terminal.clearSelection(),this.clearDecorations(),!1;let n=this._engine.findPreviousWithSelection(e,t,this._state.cachedSearchTerm);return this._selectResult(n,t?.decorations,s?.noScroll)}_selectResult(e,t,s){if(!this._terminal||!this._decorationManager)return!1;if(this._resultTracker.clearSelectedDecoration(),!e)return this._terminal.clearSelection(),!1;if(this._terminal.select(e.col,e.row,e.size),t){let n=this._decorationManager.createActiveDecoration(e,t);n&&(this._resultTracker.selectedDecoration=n)}if(!s&&(e.row>=this._terminal.buffer.active.viewportY+this._terminal.rows||e.row<this._terminal.buffer.active.viewportY)){let n=e.row-this._terminal.buffer.active.viewportY;n-=Math.floor(this._terminal.rows/2),this._terminal.scrollLines(n)}return!0}}});var Mi=globalThis,Yo=e=>e,_s=Mi.trustedTypes,Jo=_s?_s.createPolicy("lit-html",{createHTML:e=>e}):void 0,mr="$lit$",ht=`lit$${Math.random().toFixed(9).slice(2)}$`,gr="?"+ht,dc=`<${gr}>`,Mt=document,Bi=()=>Mt.createComment(""),Pi=e=>e===null||typeof e!="object"&&typeof e!="function",vr=Array.isArray,rn=e=>vr(e)||typeof e?.[Symbol.iterator]=="function",_r=`[ 	
\f\r]`,Oi=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,Zo=/-->/g,Qo=/>/g,$t=RegExp(`>|${_r}(?:([^\\s"'>=/]+)(${_r}*=${_r}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),en=/'/g,tn=/"/g,on=/^(?:script|style|textarea|title)$/i,br=e=>(t,...s)=>({_$litType$:e,strings:t,values:s}),I=br(1),nn=br(2),an=br(3),De=Symbol.for("lit-noChange"),V=Symbol.for("lit-nothing"),sn=new WeakMap,Ot=Mt.createTreeWalker(Mt,129);function ln(e,t){if(!vr(e)||!e.hasOwnProperty("raw"))throw Error("invalid template strings array");return Jo!==void 0?Jo.createHTML(t):t}var cn=(e,t)=>{let s=e.length-1,n=[],u,i=t===2?"<svg>":t===3?"<math>":"",r=Oi;for(let l=0;l<s;l++){let p=e[l],d,f,g=-1,w=0;for(;w<p.length&&(r.lastIndex=w,f=r.exec(p),f!==null);)w=r.lastIndex,r===Oi?f[1]==="!--"?r=Zo:f[1]!==void 0?r=Qo:f[2]!==void 0?(on.test(f[2])&&(u=RegExp("</"+f[2],"g")),r=$t):f[3]!==void 0&&(r=$t):r===$t?f[0]===">"?(r=u??Oi,g=-1):f[1]===void 0?g=-2:(g=r.lastIndex-f[2].length,d=f[1],r=f[3]===void 0?$t:f[3]==='"'?tn:en):r===tn||r===en?r=$t:r===Zo||r===Qo?r=Oi:(r=$t,u=void 0);let b=r===$t&&e[l+1].startsWith("/>")?" ":"";i+=r===Oi?p+dc:g>=0?(n.push(d),p.slice(0,g)+mr+p.slice(g)+ht+b):p+ht+(g===-2?l:b)}return[ln(e,i+(e[s]||"<?>")+(t===2?"</svg>":t===3?"</math>":"")),n]},Ii=class e{constructor({strings:t,_$litType$:s},n){let u;this.parts=[];let i=0,r=0,l=t.length-1,p=this.parts,[d,f]=cn(t,s);if(this.el=e.createElement(d,n),Ot.currentNode=this.el.content,s===2||s===3){let g=this.el.content.firstChild;g.replaceWith(...g.childNodes)}for(;(u=Ot.nextNode())!==null&&p.length<l;){if(u.nodeType===1){if(u.hasAttributes())for(let g of u.getAttributeNames())if(g.endsWith(mr)){let w=f[r++],b=u.getAttribute(g).split(ht),o=/([.?@])?(.*)/.exec(w);p.push({type:1,index:i,name:o[2],strings:b,ctor:o[1]==="."?gs:o[1]==="?"?vs:o[1]==="@"?bs:Pt}),u.removeAttribute(g)}else g.startsWith(ht)&&(p.push({type:6,index:i}),u.removeAttribute(g));if(on.test(u.tagName)){let g=u.textContent.split(ht),w=g.length-1;if(w>0){u.textContent=_s?_s.emptyScript:"";for(let b=0;b<w;b++)u.append(g[b],Bi()),Ot.nextNode(),p.push({type:2,index:++i});u.append(g[w],Bi())}}}else if(u.nodeType===8)if(u.data===gr)p.push({type:2,index:i});else{let g=-1;for(;(g=u.data.indexOf(ht,g+1))!==-1;)p.push({type:7,index:i}),g+=ht.length-1}i++}}static createElement(t,s){let n=Mt.createElement("template");return n.innerHTML=t,n}};function Bt(e,t,s=e,n){if(t===De)return t;let u=n!==void 0?s._$Co?.[n]:s._$Cl,i=Pi(t)?void 0:t._$litDirective$;return u?.constructor!==i&&(u?._$AO?.(!1),i===void 0?u=void 0:(u=new i(e),u._$AT(e,s,n)),n!==void 0?(s._$Co??(s._$Co=[]))[n]=u:s._$Cl=u),u!==void 0&&(t=Bt(e,u._$AS(e,t.values),u,n)),t}var ms=class{constructor(t,s){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=s}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){let{el:{content:s},parts:n}=this._$AD,u=(t?.creationScope??Mt).importNode(s,!0);Ot.currentNode=u;let i=Ot.nextNode(),r=0,l=0,p=n[0];for(;p!==void 0;){if(r===p.index){let d;p.type===2?d=new oi(i,i.nextSibling,this,t):p.type===1?d=new p.ctor(i,p.name,p.strings,this,t):p.type===6&&(d=new ys(i,this,t)),this._$AV.push(d),p=n[++l]}r!==p?.index&&(i=Ot.nextNode(),r++)}return Ot.currentNode=Mt,u}p(t){let s=0;for(let n of this._$AV)n!==void 0&&(n.strings!==void 0?(n._$AI(t,n,s),s+=n.strings.length-2):n._$AI(t[s])),s++}},oi=class e{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,s,n,u){this.type=2,this._$AH=V,this._$AN=void 0,this._$AA=t,this._$AB=s,this._$AM=n,this.options=u,this._$Cv=u?.isConnected??!0}get parentNode(){let t=this._$AA.parentNode,s=this._$AM;return s!==void 0&&t?.nodeType===11&&(t=s.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,s=this){t=Bt(this,t,s),Pi(t)?t===V||t==null||t===""?(this._$AH!==V&&this._$AR(),this._$AH=V):t!==this._$AH&&t!==De&&this._(t):t._$litType$!==void 0?this.$(t):t.nodeType!==void 0?this.T(t):rn(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==V&&Pi(this._$AH)?this._$AA.nextSibling.data=t:this.T(Mt.createTextNode(t)),this._$AH=t}$(t){let{values:s,_$litType$:n}=t,u=typeof n=="number"?this._$AC(t):(n.el===void 0&&(n.el=Ii.createElement(ln(n.h,n.h[0]),this.options)),n);if(this._$AH?._$AD===u)this._$AH.p(s);else{let i=new ms(u,this),r=i.u(this.options);i.p(s),this.T(r),this._$AH=i}}_$AC(t){let s=sn.get(t.strings);return s===void 0&&sn.set(t.strings,s=new Ii(t)),s}k(t){vr(this._$AH)||(this._$AH=[],this._$AR());let s=this._$AH,n,u=0;for(let i of t)u===s.length?s.push(n=new e(this.O(Bi()),this.O(Bi()),this,this.options)):n=s[u],n._$AI(i),u++;u<s.length&&(this._$AR(n&&n._$AB.nextSibling,u),s.length=u)}_$AR(t=this._$AA.nextSibling,s){for(this._$AP?.(!1,!0,s);t!==this._$AB;){let n=Yo(t).nextSibling;Yo(t).remove(),t=n}}setConnected(t){this._$AM===void 0&&(this._$Cv=t,this._$AP?.(t))}},Pt=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,s,n,u,i){this.type=1,this._$AH=V,this._$AN=void 0,this.element=t,this.name=s,this._$AM=u,this.options=i,n.length>2||n[0]!==""||n[1]!==""?(this._$AH=Array(n.length-1).fill(new String),this.strings=n):this._$AH=V}_$AI(t,s=this,n,u){let i=this.strings,r=!1;if(i===void 0)t=Bt(this,t,s,0),r=!Pi(t)||t!==this._$AH&&t!==De,r&&(this._$AH=t);else{let l=t,p,d;for(t=i[0],p=0;p<i.length-1;p++)d=Bt(this,l[n+p],s,p),d===De&&(d=this._$AH[p]),r||(r=!Pi(d)||d!==this._$AH[p]),d===V?t=V:t!==V&&(t+=(d??"")+i[p+1]),this._$AH[p]=d}r&&!u&&this.j(t)}j(t){t===V?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"")}},gs=class extends Pt{constructor(){super(...arguments),this.type=3}j(t){this.element[this.name]=t===V?void 0:t}},vs=class extends Pt{constructor(){super(...arguments),this.type=4}j(t){this.element.toggleAttribute(this.name,!!t&&t!==V)}},bs=class extends Pt{constructor(t,s,n,u,i){super(t,s,n,u,i),this.type=5}_$AI(t,s=this){if((t=Bt(this,t,s,0)??V)===De)return;let n=this._$AH,u=t===V&&n!==V||t.capture!==n.capture||t.once!==n.once||t.passive!==n.passive,i=t!==V&&(n===V||u);u&&this.element.removeEventListener(this.name,this,n),i&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t)}},ys=class{constructor(t,s,n){this.element=t,this.type=6,this._$AN=void 0,this._$AM=s,this.options=n}get _$AU(){return this._$AM._$AU}_$AI(t){Bt(this,t)}},hn={M:mr,P:ht,A:gr,C:1,L:cn,R:ms,D:rn,V:Bt,I:oi,H:Pt,N:vs,U:bs,B:gs,F:ys},uc=Mi.litHtmlPolyfillSupport;uc?.(Ii,oi),(Mi.litHtmlVersions??(Mi.litHtmlVersions=[])).push("3.3.2");var ws=(e,t,s)=>{let n=s?.renderBefore??t,u=n._$litPart$;if(u===void 0){let i=s?.renderBefore??null;n._$litPart$=u=new oi(t.insertBefore(Bi(),i),i,void 0,s??{})}return u._$AI(e),u};function dn(e={}){let t={activeRunId:e.activeRunId??null,runs:e.runs??{},logLines:e.logLines??[],preferences:{theme:e.preferences?.theme??"light",sidebarCollapsed:e.preferences?.sidebarCollapsed??!1,notifications:e.preferences?.notifications??null}},s=new Set;function n(){for(let u of Array.from(s))try{u(t)}catch{}}return{getState(){return t},setState(u){let i={...t,...u,preferences:{...t.preferences,...u.preferences||{}}};i.activeRunId===t.activeRunId&&i.runs===t.runs&&i.logLines===t.logLines&&i.preferences.theme===t.preferences.theme&&i.preferences.sidebarCollapsed===t.preferences.sidebarCollapsed&&i.preferences.notifications===t.preferences.notifications||(t=i,n())},setRun(u,i){let r={...t.runs,[u]:i};t={...t,runs:r},n()},appendLog(u){let i=[...t.logLines,u];i.length>5e3&&i.splice(0,i.length-5e3),t={...t,logLines:i},n()},clearLog(){t={...t,logLines:[]},n()},subscribe(u){return s.add(u),()=>s.delete(u)}}}var un=["subscribe-run","unsubscribe-run","subscribe-log","unsubscribe-log","list-runs","get-agent-prompt","get-preferences","set-preferences","stop-run","resume-run","run-snapshot","run-update","runs-list","log-line","log-bulk","preferences"];function yr(){let e=Date.now().toString(36),t=Math.random().toString(36).slice(2,8);return`${e}-${t}`}function pn(e,t,s=yr()){return{id:s,type:e,payload:t}}function fn(e={}){let t={initialMs:e.backoff?.initialMs??1e3,maxMs:e.backoff?.maxMs??3e4,factor:e.backoff?.factor??2,jitterRatio:e.backoff?.jitterRatio??.2},s=()=>e.url&&e.url.length>0?e.url:typeof location<"u"?(location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws":"ws://localhost/ws",n=null,u="closed",i=0,r=null,l=!0,p=new Map,d=[],f=new Map,g=new Set;function w(v){for(let y of Array.from(g))try{y(v)}catch{}}function b(){if(!l||r)return;u="reconnecting",w(u);let v=Math.min(t.maxMs,t.initialMs*Math.pow(t.factor,i)),y=t.jitterRatio*v,C=Math.max(0,Math.round(v+(Math.random()*2-1)*y));r=setTimeout(()=>{r=null,_()},C)}function o(v){try{n?.send(JSON.stringify(v))}catch{}}function a(){for(u="open",w(u),i=0;d.length;){let v=d.shift();v&&o(v)}}function c(v){let y;try{y=JSON.parse(String(v.data))}catch{return}if(!y||typeof y.id!="string"||typeof y.type!="string")return;if(p.has(y.id)){let m=p.get(y.id);p.delete(y.id),y.ok?m?.resolve(y.payload):m?.reject(y.error||new Error("ws error"));return}let C=f.get(y.type);if(C&&C.size>0)for(let m of Array.from(C))try{m(y.payload)}catch{}}function h(){u="closed",w(u);for(let[v,y]of p.entries())y.reject(new Error("ws disconnected")),p.delete(v);i+=1,b()}function _(){if(!l)return;let v=s();try{n=new WebSocket(v),u="connecting",w(u),n.addEventListener("open",a),n.addEventListener("message",c),n.addEventListener("error",()=>{}),n.addEventListener("close",h)}catch{b()}}return _(),{send(v,y){if(!un.includes(v))return Promise.reject(new Error(`unknown message type: ${v}`));let C=yr(),m=pn(v,y,C);return new Promise((S,L)=>{p.set(C,{resolve:S,reject:L,type:v}),n&&n.readyState===n.OPEN?o(m):d.push(m)})},on(v,y){f.has(v)||f.set(v,new Set);let C=f.get(v);return C?.add(y),()=>{C?.delete(y)}},onConnection(v){return g.add(v),()=>{g.delete(v)}},close(){l=!1,r&&(clearTimeout(r),r=null);try{n?.close()}catch{}},getState(){return u}}}function wr(e){let t=(e||"").replace(/^#\/?/,""),[s,n]=t.split("?"),u=s||"active",i=new URLSearchParams(n||"");return{section:u,runId:i.get("run")||null}}function pc(e,t){let s=`#/${e}`;return t?`${s}?run=${t}`:s}function _n(e){let t=()=>e(wr(location.hash));return window.addEventListener("hashchange",t),()=>window.removeEventListener("hashchange",t)}function tt(e,t){location.hash=pc(e,t)}function Hi(e){document.documentElement.setAttribute("data-theme",e)}var Xe={ATTRIBUTE:1,CHILD:2,PROPERTY:3,BOOLEAN_ATTRIBUTE:4,EVENT:5,ELEMENT:6},ni=e=>(...t)=>({_$litDirective$:e,values:t}),wt=class{constructor(t){}get _$AU(){return this._$AM._$AU}_$AT(t,s,n){this._$Ct=t,this._$AM=s,this._$Ci=n}_$AS(t,s){return this.update(t,s)}update(t,s){return this.render(...s)}};var Fi=class extends wt{constructor(t){if(super(t),this.it=V,t.type!==Xe.CHILD)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(t){if(t===V||t==null)return this._t=void 0,this.it=t;if(t===De)return t;if(typeof t!="string")throw Error(this.constructor.directiveName+"() called with a non-string value");if(t===this.it)return this._t;this.it=t;let s=[t];return s.raw=s,this._t={_$litType$:this.constructor.resultType,strings:s,values:[]}}};Fi.directiveName="unsafeHTML",Fi.resultType=1;var G=ni(Fi);var ai=[["circle",{cx:"12",cy:"12",r:"10"}]];var It=[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"m9 12 2 2 4-4"}]];var Ht=[["circle",{cx:"12",cy:"12",r:"10"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16"}]];var St=[["path",{d:"M12 2v4"}],["path",{d:"m16.2 7.8 2.9-2.9"}],["path",{d:"M18 12h4"}],["path",{d:"m16.2 16.2 2.9 2.9"}],["path",{d:"M12 18v4"}],["path",{d:"m4.9 19.1 2.9-2.9"}],["path",{d:"M2 12h4"}],["path",{d:"m4.9 4.9 2.9 2.9"}]];var zi=[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{d:"M21 3v5h-5"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{d:"M8 16H3v5"}]];var Sr=[["path",{d:"M12 5v14"}],["path",{d:"m19 12-7 7-7-7"}]];var Ft=[["rect",{x:"14",y:"3",width:"5",height:"18",rx:"1"}],["rect",{x:"5",y:"3",width:"5",height:"18",rx:"1"}]];var Cr=[["path",{d:"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"}]];var li=[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"M12 6v6l4 2"}]];var xr=[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{d:"M12 9v4"}],["path",{d:"M12 17h.01"}]];var zt=[["path",{d:"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]];var kr=[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"}],["path",{d:"M10 12h4"}]];var Er=[["path",{d:"m21 21-4.34-4.34"}],["circle",{cx:"11",cy:"11",r:"8"}]];var Ar=[["path",{d:"m12 19-7-7 7-7"}],["path",{d:"M19 12H5"}]];var Lr=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2"}]];var Tr=[["path",{d:"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"}]];var Ss=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{d:"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{cx:"9",cy:"7",r:"4"}]];var Dr=[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}]];var Ni=[["path",{d:"M15 6a9 9 0 0 0-9 9V3"}],["circle",{cx:"18",cy:"6",r:"3"}],["circle",{cx:"6",cy:"18",r:"3"}]];var Rr=[["path",{d:"m9 18 6-6-6-6"}]];var ci=[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7"}]];var Wi=[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{cx:"12",cy:"12",r:"3"}]];var $r=[["line",{x1:"10",x2:"14",y1:"2",y2:"2"}],["line",{x1:"12",x2:"15",y1:"14",y2:"11"}],["circle",{cx:"12",cy:"14",r:"8"}]];var Cs=[["path",{d:"M12 20v2"}],["path",{d:"M12 2v2"}],["path",{d:"M17 20v2"}],["path",{d:"M17 2v2"}],["path",{d:"M2 12h2"}],["path",{d:"M2 17h2"}],["path",{d:"M2 7h2"}],["path",{d:"M20 12h2"}],["path",{d:"M20 17h2"}],["path",{d:"M20 7h2"}],["path",{d:"M7 20v2"}],["path",{d:"M7 2v2"}],["rect",{x:"4",y:"4",width:"16",height:"16",rx:"2"}],["rect",{x:"8",y:"8",width:"8",height:"8",rx:"1"}]];var Or=[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]];var Mr=[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{d:"M10 9H8"}],["path",{d:"M16 13H8"}],["path",{d:"M16 17H8"}]];var Ui=[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1"}],["path",{d:"M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v4"}],["path",{d:"M21 14H11"}],["path",{d:"m15 10-4 4 4 4"}]];var Br=[["path",{d:"M13.744 17.736a6 6 0 1 1-7.48-7.48"}],["path",{d:"M15 6h1v4"}],["path",{d:"m6.134 14.768.866-.5 2 3.464"}],["circle",{cx:"16",cy:"8",r:"6"}]];var Pr=[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0"}],["path",{d:"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}]];function fc(e){return e.map(([t,s])=>{let n=Object.entries(s).map(([u,i])=>`${u}="${i}"`).join(" ");return`<${t} ${n}/>`}).join("")}function Y(e,t=16,s=""){let n=s?` class="${s}"`:"";return`<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${n}>${fc(e)}</svg>`}function mn(e,t,s,{onNavigate:n}){let{runs:u,preferences:i}=e,r=Object.values(u),l=r.filter(g=>g.active).length,p=r.filter(g=>!g.active).length,d=s==="open"?"connected":s==="reconnecting"?"reconnecting":"disconnected",f=s==="open"?"Connected":s==="reconnecting"?"Reconnecting\u2026":"Disconnected";return I`
    <aside class="sidebar ${i.sidebarCollapsed?"collapsed":""}">
      <div class="sidebar-logo" @click=${()=>n("dashboard")} style="cursor:pointer">
        <span class="logo-text">WORCA</span>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Pipeline</div>
        <div class="sidebar-item ${t.section==="active"?"active":""}"
             @click=${()=>n("active")}>
          <span class="sidebar-item-left">
            ${G(Y(zt,16))}
            <span>Running</span>
          </span>
          ${l>0?I`<sl-badge variant="primary" pill>${l}</sl-badge>`:""}
        </div>
        <div class="sidebar-item ${t.section==="history"?"active":""}"
             @click=${()=>n("history")}>
          <span class="sidebar-item-left">
            ${G(Y(kr,16))}
            <span>History</span>
          </span>
          ${p>0?I`<sl-badge variant="neutral" pill>${p}</sl-badge>`:""}
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
        >${G(Y(Wi,18))}</button>
      </div>
    </aside>
  `}var _c={pending:"status-pending",in_progress:"status-in-progress",completed:"status-completed",error:"status-error",interrupted:"status-interrupted"},mc={pending:ai,in_progress:St,completed:It,error:Ht,interrupted:Ft};function hi(e,t){return e==="in_progress"&&t===!1?"interrupted":e}function xs(e){return _c[e]||"status-unknown"}function it(e,t=14){let s=mc[e];return s?Y(s,t,e==="in_progress"?"icon-spin":""):"?"}var gc={pending:ai,in_progress:St,completed:It,error:Ht,interrupted:Ft};function vc(e,t){return t&&t[e]?.label?t[e].label:e.replace(/_/g," ").toUpperCase()}function gn(e,t={},s=!0){if(!e||typeof e!="object")return I``;let n=Object.entries(e);return n.length===0?I`<div class="empty-state">No stages</div>`:I`
    <div class="stage-timeline">
      ${n.map(([u,i],r)=>{let l=hi(i.status||"pending",s),p=gc[l]||ai,d=vc(u,t),f=l==="in_progress",g=i.iteration,w=l==="in_progress"?"icon-spin":"";return I`
          ${r>0?I`<div class="stage-connector ${n[r-1]?.[1]?.status==="completed"?"completed":""}"></div>`:""}
          <div class="stage-node ${xs(l)} ${f?"pulse":""}">
            <div class="stage-icon">${G(Y(p,22,w))}</div>
            <div class="stage-label">${d}</div>
            ${g>1?I`<span class="loop-indicator">${G(Y(zi,10))}${g}</span>`:""}
          </div>
        `})}
    </div>
  `}function dt(e){let t=Math.floor(e/1e3),s=Math.floor(t/3600),n=Math.floor(t%3600/60),u=t%60;return s>0?`${s}h ${n}m ${u}s`:n>0?`${n}m ${u}s`:`${u}s`}function Nt(e,t){let s=new Date(e).getTime();return(t?new Date(t).getTime():Date.now())-s}function Wt(e){if(!e)return"N/A";let t=new Date(e),s=n=>String(n).padStart(2,"0");return`${t.getFullYear()}.${s(t.getMonth()+1)}.${s(t.getDate())} ${s(t.getHours())}:${s(t.getMinutes())}`}function bc(e){if(!e)return null;let t=null;for(let s of Object.values(e))s.completed_at&&(!t||s.completed_at>t)&&(t=s.completed_at);return t}function yc(e){return e==="completed"?"success":e==="error"?"danger":e==="in_progress"||e==="interrupted"?"warning":"neutral"}function wc(e){let t=e.status||"pending";return t==="completed"&&e.outcome==="success"?I`<span class="iter-status-icon success">${G(it("completed",12))}</span>`:t==="completed"?I`<span class="iter-status-icon">${G(it("completed",12))}</span>`:t==="error"?I`<span class="iter-status-icon failure">${G(it("error",12))}</span>`:t==="in_progress"?I`<span class="iter-status-icon in-progress">${G(it("in_progress",12))}</span>`:V}function vn(e){return e?I`<span class="iteration-trigger">${{initial:"Initial run",test_failure:"Test failure",review_changes:"Review changes",restart_planning:"Restart planning"}[e]||e}</span>`:V}function bn(e){return e?I`<span class="iteration-outcome ${e==="success"?"success":"failure"}">${e.replace(/_/g," ")}</span>`:V}function yn(e){return e.reduce((t,s)=>t+(s.cost_usd||0),0)}function Sc(e,t,s,n,u){let i=t.iterations||[],r=wn(t);return{stage:e,status:t.status,agent:s||void 0,model:n||void 0,cost_usd:yn(i),duration:r>0?dt(r):void 0,duration_ms:r>0?r:void 0,started_at:t.started_at||void 0,completed_at:t.completed_at||void 0,error:t.error||void 0,iterations:i.map(l=>({number:l.number,status:l.status,outcome:l.outcome||void 0,trigger:l.trigger||void 0,agent:l.agent||void 0,model:l.model||void 0,turns:l.turns||void 0,cost_usd:l.cost_usd||void 0,duration_ms:l.duration_ms||void 0,started_at:l.started_at||void 0,completed_at:l.completed_at||void 0})),prompts:u?{agent_instructions:u.agentInstructions||void 0,user_prompt:u.userPrompt||void 0}:void 0}}function wn(e){let t=e.iterations||[],s=e.started_at||null,n=e.completed_at||null;for(let u of t)u.started_at&&(!s||u.started_at<s)&&(s=u.started_at),u.completed_at&&(!n||u.completed_at>n)&&(n=u.completed_at);return s?Nt(s,n||null):0}function Ir(e,t,s=V){let n=e?dt(Nt(e,t||null)):"";return I`
    <div class="timing-strip">
      ${e?I`<span class="timing-strip-item"><span class="meta-label">Started:</span> <span class="meta-value">${Wt(e)}</span></span>`:V}
      ${t?I`<span class="timing-strip-item"><span class="meta-label">Finished:</span> <span class="meta-value">${Wt(t)}</span></span>`:V}
      ${n?I`<span class="timing-strip-item"><span class="meta-label">Duration:</span> <span class="meta-value">${n}</span></span>`:V}
      ${s}
    </div>
  `}function Cc(e,t,s,n){let u=e.agent||s||t,i=e.model||"",r=e.number??0,d=(n?.iterationPrompts||[]).find(w=>w.iteration===r)?.prompt||n?.userPrompt||null,f=d?{agentInstructions:n?.agentInstructions,userPrompt:d}:n,g=e.started_at?dt(Nt(e.started_at,e.completed_at||null)):"";return I`
    <div class="iteration-detail">
      ${Ir(e.started_at,e.completed_at)}
      <div class="stage-info-strip">
        ${u?I`<span class="stage-info-item"><span class="stage-meta-icon">${G(Y(Cs,12))}</span> ${u}${i?I` <span class="text-muted">(${i})</span>`:""}</span>`:V}
        ${e.turns?I`<span class="stage-info-item"><span class="meta-label">Turns:</span> <span class="meta-value">${e.turns}</span></span>`:V}
        ${e.cost_usd!=null?I`<span class="stage-info-item"><span class="meta-label">Iteration Cost:</span> <span class="meta-value">$${Number(e.cost_usd).toFixed(2)}</span></span>`:V}
        ${g?I`<span class="stage-info-item"><span class="meta-label">Iteration Duration:</span> <span class="meta-value">${g}</span></span>`:V}
      </div>
      ${e.trigger?I`<div class="detail-row">${vn(e.trigger)}</div>`:V}
      ${e.outcome?I`<div class="detail-row">${bn(e.outcome)}</div>`:V}
      ${Sn(t,f)}
    </div>
  `}function Hr(e,t){navigator.clipboard.writeText(e).then(()=>{t.textContent="Copied!",setTimeout(()=>{t.textContent="Copy"},1500)})}function Sn(e,t){if(!t)return V;let{agentInstructions:s,userPrompt:n}=t;return!s&&!n?V:I`
    <sl-details class="agent-prompt-section">
      <div slot="summary" class="agent-prompt-header">
        <span class="stage-meta-icon">${G(Y(Mr,12))}</span>
        Agent Instructions
      </div>
      ${n?I`
        <div class="agent-prompt-block">
          <div class="agent-prompt-label-row">
            <span class="agent-prompt-label">User Prompt (-p)</span>
            <button class="copy-btn" @click=${u=>Hr(n,u.currentTarget)}>
              ${G(Y(Ui,11))} Copy
            </button>
          </div>
          <pre class="agent-prompt-content">${n}</pre>
        </div>
      `:V}
      ${s?I`
        <div class="agent-prompt-block">
          <div class="agent-prompt-label-row">
            <span class="agent-prompt-label">System Prompt (agent .md)</span>
            <button class="copy-btn" @click=${u=>Hr(s,u.currentTarget)}>
              ${G(Y(Ui,11))} Copy
            </button>
          </div>
          <pre class="agent-prompt-content">${s}</pre>
        </div>
      `:V}
    </sl-details>
  `}function Cn(e,t={},s={}){if(!e)return I`<div class="empty-state">Select a run to view details</div>`;let n=e.branch||e.work_request?.branch||"",u=e.pr_url||null,i=e.completed_at||(e.active?null:bc(e.stages)),r=e.stages||{},l=t.stageUi||{},p=t.agents||{};return I`
    <div class="run-detail">
      ${gn(r,l,e.active)}

      <div class="run-info-section">
        ${n?I`
          <div class="run-branch">
            <span class="stage-meta-icon">${G(Y(Ni,14))}</span>
            <span>${n}</span>
            ${u?I`<a class="run-pr-link" href="${u}" target="_blank">View PR</a>`:V}
          </div>
        `:V}
        ${Ir(e.started_at,i)}
        ${(()=>{let f=Object.values(r).flatMap(g=>g.iterations||[]).reduce((g,w)=>g+(w.cost_usd||0),0);return f>0?I`
            <div class="pipeline-cost-strip">
              <span class="meta-label">Pipeline Cost:</span> <span class="meta-value">$${f.toFixed(2)}</span>
            </div>
          `:V})()}
      </div>

      <div class="stage-panels">
        ${Object.entries(r).map(([d,f])=>{let g=l[d]?.label||d.replace(/_/g," ").toUpperCase(),w=hi(f.status||"pending",e.active),b=f.agent||p[d]?.agent||d,o=f.model||p[d]?.model||"",a=wn(f),c=a>0?dt(a):"",h=f.iterations||[],_=h.length>1,v=yn(h);return I`
            <sl-details ?open=${w==="in_progress"} class="stage-panel">
              <div slot="summary" class="stage-panel-header">
                <span class="stage-panel-icon ${xs(w)}">${G(it(w))}</span>
                <span class="stage-panel-label">${g}</span>
                <span class="stage-panel-meta">
                  ${_?I`
                    <span class="stage-meta-item stage-meta-iteration">
                      <span class="stage-meta-icon">${G(Y(zi,11))}</span>
                      <span class="meta-value">${h.length} iterations</span>
                    </span>
                  `:V}
                  ${v>0?I`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${G(Y(Br,11))}</span>
                      <span class="meta-value">$${v.toFixed(2)}</span>
                    </span>
                  `:V}
                  ${f.completed_at?I`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${G(Y(li,11))}</span>
                      <span class="meta-value">${Wt(f.completed_at)}</span>
                    </span>
                  `:V}
                  ${c?I`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${G(Y($r,11))}</span>
                      <span class="meta-value">${c}</span>
                    </span>
                  `:V}
                </span>
                <sl-badge variant="${yc(w)}" pill>
                  ${w.replace(/_/g," ")}
                </sl-badge>
              </div>
              ${(()=>{let y=w!=="pending"?s.promptCache?.[d]:null,C=I`
                  <button class="stage-copy-btn" title="Copy stage data as JSON" @click=${m=>{let S=Sc(d,f,b,o,y);Hr(JSON.stringify(S,null,2),m.currentTarget)}}>
                    ${G(Y(Ui,12))} Copy
                  </button>
                `;if(_){let m=a>0?dt(a):"";return I`
                    <div class="stage-content-wrapper">
                      ${C}
                      <div class="stage-totals-strip">
                        <span class="stage-totals-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${v.toFixed(2)}</span></span>
                        <span class="stage-totals-item"><span class="meta-label">Duration:</span> <span class="meta-value">${m}</span></span>
                      </div>
                      <sl-tab-group>
                        ${h.map(S=>I`
                          <sl-tab slot="nav" panel="iter-${d}-${S.number}">
                            Iter ${S.number} ${wc(S)}
                          </sl-tab>
                        `)}
                        ${h.map(S=>I`
                          <sl-tab-panel name="iter-${d}-${S.number}">
                            ${Cc(S,d,b,y)}
                          </sl-tab-panel>
                        `)}
                      </sl-tab-group>
                    </div>
                  `}return I`
                  <div class="stage-content-wrapper">
                    ${C}
                    <div class="stage-detail">
                      ${Ir(f.started_at,f.completed_at)}
                      <div class="stage-info-strip">
                        ${b?I`<span class="stage-info-item"><span class="stage-meta-icon">${G(Y(Cs,12))}</span> ${b}${o?I` <span class="text-muted">(${o})</span>`:""}</span>`:V}
                        ${h.length===1&&h[0].turns?I`<span class="stage-info-item"><span class="meta-label">Turns:</span> <span class="meta-value">${h[0].turns}</span></span>`:V}
                        ${h.length===1&&h[0].cost_usd!=null?I`<span class="stage-info-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${Number(h[0].cost_usd).toFixed(2)}</span></span>`:V}
                      </div>
                      ${h.length===1&&h[0].trigger?I`<div class="detail-row">${vn(h[0].trigger)}</div>`:V}
                      ${h.length===1&&h[0].outcome?I`<div class="detail-row">${bn(h[0].outcome)}</div>`:V}
                      ${f.task_progress?I`<div class="detail-row"><span class="detail-label">Progress:</span> ${f.task_progress}</div>`:V}
                      ${f.error?I`<div class="detail-row detail-error"><span class="detail-label">Error:</span> ${f.error}</div>`:V}
                      ${y?Sn(d,y):V}
                    </div>
                  </div>
                `})()}
            </sl-details>
          `})}
      </div>
    </div>
  `}var xc={completed:"success",in_progress:"warning",error:"danger",interrupted:"warning",pending:"neutral"};function ks(e,{onClick:t}={}){let s=e.work_request?.title||"Untitled",n=e.active,u=n?"in_progress":e.stage==="error"?"error":"completed",i=e.started_at&&e.completed_at?dt(Nt(e.started_at,e.completed_at)):e.started_at&&n?dt(Nt(e.started_at,null)):"N/A",r=e.branch||e.work_request?.branch||"",l=e.stages?Object.entries(e.stages):[];return I`
    <div class="run-card" @click=${t?()=>t(e.id):null}>
      <div class="run-card-top">
        <span class="run-card-status">${G(it(u,16))}</span>
        <span class="run-card-title">${s}</span>
      </div>
      ${r?I`<div class="run-card-meta"><span class="run-card-meta-item"><span class="meta-label">Branch:</span> ${r}</span></div>`:V}
      <div class="run-card-meta">
        <span class="run-card-meta-item"><span class="meta-label">Started:</span> ${Wt(e.started_at)}</span>
        <span class="run-card-meta-item"><span class="meta-label">Finished:</span> ${Wt(e.completed_at)}</span>
        <span class="run-card-meta-item"><span class="meta-label">Duration:</span> ${i}</span>
      </div>
      ${l.length>0?I`
        <div class="run-card-stages">
          ${l.map(([p,d])=>{let f=hi(d.status||"pending",n),g=xc[f]||"neutral",w=p.replace(/_/g," ").toUpperCase();return I`<sl-badge variant="${g}" pill class="run-card-stage-badge">${w}</sl-badge>`})}
        </div>
      `:V}
    </div>
  `}function Fr(e,t,{onSelectRun:s}){let n=e.filter(u=>t==="active"?u.active:!u.active);return n.length===0?I`<div class="empty-state">
      ${t==="active"?"No running pipelines":"No completed runs yet"}
    </div>`:I`
    <div class="run-list">
      ${n.map(u=>ks(u,{onClick:s}))}
    </div>
  `}function xn(e,{onSelectRun:t}={}){let s=Object.values(e.runs),n=s.filter(l=>l.active),u=s.filter(l=>!l.active),i=s.filter(l=>(l.stages?Object.values(l.stages):[]).some(d=>d.status==="error")),r=s.length;return I`
    <div class="dashboard">
      <div class="dashboard-stats">
        <div class="stat-card stat-total">
          <div class="stat-icon-ring">${G(Y(Cr,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${r}</span>
            <span class="stat-label">Total Runs</span>
          </div>
        </div>
        <div class="stat-card stat-active">
          <div class="stat-icon-ring">${G(Y(zt,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${n.length}</span>
            <span class="stat-label">Active</span>
          </div>
        </div>
        <div class="stat-card stat-completed">
          <div class="stat-icon-ring">${G(Y(It,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${u.length}</span>
            <span class="stat-label">Completed</span>
          </div>
        </div>
        <div class="stat-card stat-errors">
          <div class="stat-icon-ring">${G(Y(Ht,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${i.length}</span>
            <span class="stat-label">Errors</span>
          </div>
        </div>
      </div>

      <h3 class="dashboard-section-title">Active Runs</h3>
      ${n.length>0?I`
        <div class="run-list">
          ${n.map(l=>ks(l,{onClick:t}))}
        </div>
      `:I`<div class="empty-state">No running pipelines</div>`}
    </div>
  `}var kc={plan:"planner",coordinate:"coordinator",implement:"implementer",test:"tester",review:"guardian",pr:"guardian"},Es=["plan","coordinate","implement","test","review","pr"],Vi=["planner","coordinator","implementer","tester","guardian"],Ec=["opus","sonnet","haiku"],ji={plan:{agent:"planner",enabled:!0},coordinate:{agent:"coordinator",enabled:!0},implement:{agent:"implementer",enabled:!0},test:{agent:"tester",enabled:!0},review:{agent:"guardian",enabled:!0},pr:{agent:"guardian",enabled:!0}},En=[{key:"block_rm_rf",label:"Block rm -rf",description:"Prevent recursive force-delete commands"},{key:"block_env_write",label:"Block .env writes",description:"Prevent writing to .env files"},{key:"block_force_push",label:"Block force push",description:"Prevent git push --force"},{key:"restrict_git_commit",label:"Restrict git commit",description:"Only guardian agent may commit"}],Ut={guards:{block_rm_rf:!0,block_env_write:!0,block_force_push:!0,restrict_git_commit:!0},test_gate_strikes:2,dispatch:{planner:[],coordinator:["implementer"],implementer:[],tester:[],guardian:[]}},ge=null,Ye=null,jt="";async function zr(){try{let e=await fetch("/api/settings");if(!e.ok)throw new Error(`HTTP ${e.status}`);if(ge=await e.json(),ge.worca||(ge.worca={}),!ge.worca.stages)ge.worca.stages={...ji};else for(let t of Es)ge.worca.stages[t]||(ge.worca.stages[t]={...ji[t]});ge.worca.governance?ge.worca.governance={...Ut,...ge.worca.governance,guards:{...Ut.guards,...ge.worca.governance.guards||{}},dispatch:{...Ut.dispatch,...ge.worca.governance.dispatch||{}}}:ge.worca.governance={...Ut}}catch(e){ge=null,Ye="error",jt="Failed to load settings: "+e.message}}async function Nr(e,t){Ye="saving",jt="",t();try{let s=await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(e)});if(!s.ok)throw new Error(`HTTP ${s.status}`);let n=await s.json();ge={worca:n.worca,permissions:n.permissions},Ye="success",jt="Settings saved successfully"}catch(s){Ye="error",jt="Failed to save: "+s.message}t(),Ye==="success"&&setTimeout(()=>{Ye==="success"&&(Ye=null,jt="",t())},3e3)}function Ac(){let e={};for(let t of Vi){let s=document.getElementById(`agent-${t}-model`),n=document.getElementById(`agent-${t}-turns`);e[t]={model:s?.value||"sonnet",max_turns:parseInt(n?.value,10)||30}}return e}function Lc(){let e={};for(let t of["implement_test","code_review","pr_changes","restart_planning"]){let s=document.getElementById(`loop-${t}`);e[t]=parseInt(s?.value,10)||0}return{loops:e}}function Tc(){let e={};for(let t of Es){let s=document.getElementById(`stage-${t}-enabled`),n=document.getElementById(`stage-${t}-agent`);e[t]={agent:n?.value||ji[t].agent,enabled:s?.checked??!0}}return e}function Dc(){let e={};for(let u of En){let i=document.getElementById(`guard-${u.key}`);e[u.key]=i?.checked??!0}let t=document.getElementById("test-gate-strikes"),s=parseInt(t?.value,10)||2,n={};for(let u of Vi){let r=(document.getElementById(`dispatch-${u}`)?.value||"").trim();n[u]=r?r.split(",").map(l=>l.trim()).filter(Boolean):[]}return{guards:e,test_gate_strikes:s,dispatch:n}}function Rc(e,t){let s=e.agents||{};return I`
    <div class="settings-tab-content">
      <div class="settings-cards">
        ${Vi.map(n=>{let u=s[n]||{};return I`
            <div class="settings-card">
              <div class="settings-card-header">
                <span class="settings-card-icon">${G(Y(Ss,18))}</span>
                <span class="settings-card-title">${n}</span>
              </div>
              <div class="settings-card-body">
                <div class="settings-field">
                  <label class="settings-label">Model</label>
                  <sl-select id="agent-${n}-model" .value="${u.model||"sonnet"}" size="small">
                    ${Ec.map(i=>I`<sl-option value="${i}">${i}</sl-option>`)}
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
        <sl-button variant="primary" size="small" @click=${()=>{let n=Ac();Nr({worca:{...ge.worca,agents:n},permissions:ge.permissions},t)}}>
          ${G(Y(ci,14))}
          Save Agents
        </sl-button>
      </div>
    </div>
  `}function $c(e,t){let s=e.loops||{},n=e.stages||ji;return I`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Stage Configuration</h3>
      <div class="pipeline-flow">
        ${Es.map((u,i)=>{let r=n[u]||ji[u],l=r.enabled!==!1;return I`
            <div class="pipeline-stage-node ${l?"pipeline-stage-node--enabled":"pipeline-stage-node--disabled"}">
              <div class="pipeline-stage-header">
                <span class="pipeline-stage-name ${l?"":"pipeline-stage-name--disabled"}">${u}</span>
                <sl-switch id="stage-${u}-enabled" ?checked=${l} size="small"
                  @sl-change=${p=>{let d=p.target.closest(".pipeline-stage-node");p.target.checked?(d.classList.remove("pipeline-stage-node--disabled"),d.classList.add("pipeline-stage-node--enabled"),d.querySelector(".pipeline-stage-name").classList.remove("pipeline-stage-name--disabled")):(d.classList.remove("pipeline-stage-node--enabled"),d.classList.add("pipeline-stage-node--disabled"),d.querySelector(".pipeline-stage-name").classList.add("pipeline-stage-name--disabled"))}}></sl-switch>
              </div>
              <div class="settings-field pipeline-stage-field">
                <label class="settings-label">Agent</label>
                <sl-select id="stage-${u}-agent" .value="${r.agent||kc[u]}" size="small">
                  ${Vi.map(p=>I`<sl-option value="${p}">${p}</sl-option>`)}
                </sl-select>
              </div>
            </div>
            ${i<Es.length-1?I`
              <span class="pipeline-arrow">${G(Y(Rr,16))}</span>
            `:V}
          `})}
      </div>

      <h3 class="settings-section-title">Loop Limits</h3>
      <div class="settings-grid">
        ${[{key:"implement_test",label:"Implement \u2194 Test"},{key:"code_review",label:"Code Review"},{key:"pr_changes",label:"PR Changes"},{key:"restart_planning",label:"Restart Planning"}].map(u=>I`
          <div class="settings-field">
            <label class="settings-label">${u.label}</label>
            <sl-input id="loop-${u.key}" type="number" value="${s[u.key]||0}" size="small" min="0" max="50"></sl-input>
          </div>
        `)}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${()=>{let{loops:u}=Lc(),i=Tc();Nr({worca:{...ge.worca,loops:u,stages:i},permissions:ge.permissions},t)}}>
          ${G(Y(ci,14))}
          Save Pipeline
        </sl-button>
      </div>
    </div>
  `}function Oc(e,t,s){let n=e.governance||Ut,u=n.guards||Ut.guards,i=n.dispatch||Ut.dispatch,r=t.allow||[];return I`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Guard Rules</h3>
      <div class="settings-switches">
        ${En.map(l=>I`
          <div class="settings-switch-row">
            <sl-switch id="guard-${l.key}" ?checked=${u[l.key]!==!1} size="small">
              ${l.label}
            </sl-switch>
            <span class="settings-switch-desc">${l.description}</span>
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
        ${Vi.map(l=>I`
          <div class="settings-dispatch-row">
            <span class="settings-dispatch-agent">${l}</span>
            <sl-input id="dispatch-${l}" value="${(i[l]||[]).join(", ")}" size="small" placeholder="none"></sl-input>
          </div>
        `)}
      </div>

      <h3 class="settings-section-title">Permissions</h3>
      <div class="settings-permissions">
        ${r.length>0?r.map(l=>I`<div class="settings-perm-item"><code>${l}</code></div>`):I`<span class="settings-muted">No permissions configured</span>`}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${()=>{let l=Dc();Nr({worca:{...ge.worca,governance:l},permissions:ge.permissions},s)}}>
          ${G(Y(ci,14))}
          Save Governance
        </sl-button>
      </div>
    </div>
  `}function Mc(e,t){let s=e?.theme||"light";return I`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Appearance</h3>
      <div class="settings-switches">
        <div class="settings-switch-row">
          <sl-switch ?checked=${s==="dark"} size="small" @sl-change=${t}>Dark Mode</sl-switch>
          <span class="settings-switch-desc">Toggle between light and dark theme</span>
        </div>
      </div>
    </div>
  `}var kn={run_completed:{label:"Run Completed",desc:"When a pipeline run finishes successfully"},run_failed:{label:"Run Failed",desc:"When a pipeline run fails at any stage"},approval_needed:{label:"Approval Required",desc:"When a stage is waiting for plan or PR approval"},test_failures:{label:"Test Failures",desc:"When a test iteration ends with failures"},loop_limit_warning:{label:"Loop Limit Warning",desc:"When a stage approaches its configured loop limit"}};function Bc(e,{rerender:t,onSaveNotifications:s}){let n=e?.notifications||{},u=n.enabled??!0,i=n.sound??!1,r=n.events||{},l=typeof Notification<"u"?Notification.permission:"unsupported",p=l==="granted"?I`<sl-badge variant="success" pill>Granted</sl-badge>`:l==="denied"?I`<sl-badge variant="danger" pill>Blocked</sl-badge>`:l==="default"?I`<sl-badge variant="neutral" pill>Not Yet Asked</sl-badge>`:I`<sl-badge variant="neutral" pill>Not Supported</sl-badge>`,d=l!=="granted";return I`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Browser Notifications</h3>
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
        <span style="font-size: 13px; color: var(--muted);">Permission Status:</span>
        ${p}
        ${l==="default"?I`
          <sl-button size="small" variant="primary" @click=${async()=>{typeof Notification<"u"&&(await Notification.requestPermission(),t())}}>Enable Notifications</sl-button>
        `:""}
      </div>

      ${d?I`
        <div style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">
          ${l==="denied"?"Notifications are blocked. Enable in your browser settings to use these controls.":"Grant notification permission to use these controls."}
        </div>
      `:""}

      <div class="settings-switches">
        <div class="settings-switch-row">
          <sl-switch id="notif-enabled" ?checked=${u} size="small" ?disabled=${d}>Notifications Enabled</sl-switch>
          <span class="settings-switch-desc">Master toggle for all browser notifications</span>
        </div>
        <div class="settings-switch-row">
          <sl-switch id="notif-sound" ?checked=${i} size="small" ?disabled=${d}>Sound for Critical Events</sl-switch>
          <span class="settings-switch-desc">Play a short audio cue for failed runs and approval requests</span>
        </div>
      </div>

      <h3 class="settings-section-title">Notification Events</h3>
      <div class="settings-switches">
        ${Object.entries(kn).map(([f,{label:g,desc:w}])=>I`
          <div class="settings-switch-row">
            <sl-switch id="notif-evt-${f}" ?checked=${r[f]??!0} size="small" ?disabled=${d}>${g}</sl-switch>
            <span class="settings-switch-desc">${w}</span>
          </div>
        `)}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" ?disabled=${d} @click=${()=>{let f=document.getElementById("notif-enabled")?.checked??!0,g=document.getElementById("notif-sound")?.checked??!1,w={};for(let b of Object.keys(kn))w[b]=document.getElementById(`notif-evt-${b}`)?.checked??!0;s({enabled:f,sound:g,events:w})}}>
          ${G(Y(ci,14))}
          Save Notifications
        </sl-button>
      </div>
    </div>
  `}function Pc(e){return!Ye||Ye==="saving"?V:I`
    <div class="settings-toast">
      <sl-alert variant="${Ye==="success"?"success":"danger"}" open closable duration="3000"
        @sl-after-hide=${()=>{Ye=null,jt="",e()}}>
        ${jt}
      </sl-alert>
    </div>
  `}function An(e,{rerender:t,onThemeToggle:s,onSaveNotifications:n}){if(!ge)return I`<div class="empty-state">Loading settings\u2026</div>`;let u=ge.worca||{},i=ge.permissions||{};return I`
    ${Pc(t)}
    <div class="settings-page">
      <sl-tab-group>
        <sl-tab slot="nav" panel="agents">
          ${G(Y(Ss,14))}
          Agents
        </sl-tab>
        <sl-tab slot="nav" panel="pipeline">
          ${G(Y(Ni,14))}
          Pipeline
        </sl-tab>
        <sl-tab slot="nav" panel="governance">
          ${G(Y(Dr,14))}
          Governance
        </sl-tab>
        <sl-tab slot="nav" panel="preferences">
          ${G(Y(Wi,14))}
          Preferences
        </sl-tab>
        <sl-tab slot="nav" panel="notifications">
          ${G(Y(Pr,14))}
          Notifications
        </sl-tab>

        <sl-tab-panel name="agents">${Rc(u,t)}</sl-tab-panel>
        <sl-tab-panel name="pipeline">${$c(u,t)}</sl-tab-panel>
        <sl-tab-panel name="governance">${Oc(u,i,t)}</sl-tab-panel>
        <sl-tab-panel name="preferences">${Mc(e,s)}</sl-tab-panel>
        <sl-tab-panel name="notifications">${Bc(e,{rerender:t,onSaveNotifications:n})}</sl-tab-panel>
      </sl-tab-group>
    </div>
  `}var ta=["\x1B[36m","\x1B[33m","\x1B[35m","\x1B[32m","\x1B[34m","\x1B[91m","\x1B[96m","\x1B[93m"],no="\x1B[0m",ia="\x1B[2m",Ps=new Map,ao=0;function Ph(e){return Ps.has(e)||(Ps.set(e,ta[ao%ta.length]),ao++),Ps.get(e)}var Oe=null,xt=null,fi=null,lo=null,kt=null,Vt=null;async function Ih(e){if(Oe&&e.querySelector(".xterm")){xt.fit();return}if(Vt){await Vt;return}Vt=(async()=>{let[{Terminal:t},{FitAddon:s},{SearchAddon:n}]=await Promise.all([Promise.resolve().then(()=>Xo(Ur(),1)),Promise.resolve().then(()=>(Vr(),jr)),Promise.resolve().then(()=>(ea(),Qn))]);Oe=new t({theme:{background:"#0f172a",foreground:"#e2e8f0",cursor:"#60a5fa",selectionBackground:"rgba(96, 165, 250, 0.3)"},fontFamily:"'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",fontSize:13,lineHeight:1.4,scrollback:5e4,convertEol:!0,cursorBlink:!1,disableStdin:!0}),xt=new s,fi=new n,Oe.loadAddon(xt),Oe.loadAddon(fi),Oe.open(e),xt.fit(),kt=new ResizeObserver(()=>{xt&&xt.fit()}),kt.observe(e)})(),await Vt,Vt=null}function co(e){if(!Oe)return;let t=e.timestamp?`${ia}${e.timestamp}${no} `:"",s=e.stage?`${Ph(e.stage)}[${e.stage.toUpperCase()}]${no} `:"",n=e.line||e;Oe.writeln(`${t}${s}${n}`)}function _i(){kt&&kt.disconnect(),Oe&&Oe.dispose(),Oe=null,xt=null,fi=null,kt=null,Vt=null,Ps.clear(),ao=0}function sa(){kt&&kt.disconnect(),Oe&&Oe.dispose(),Oe=null,xt=null,fi=null,kt=null,Vt=null,lo=null}function ra(e){fi&&e&&fi.findNext(e,{incremental:!0})}async function oa(e){let t=document.getElementById("log-terminal");t&&(e!==lo&&(_i(),lo=e),await Ih(t))}function na(e){Oe&&Oe.writeln(`
${ia}${"\u2500".repeat(40)} Iteration ${e} ${"\u2500".repeat(40)}${no}
`)}function aa(e,{onStageFilter:t,onIterationFilter:s,onSearch:n,onToggleAutoScroll:u,autoScroll:i,stageIterations:r,runStages:l}){let p=l?["orchestrator",...Object.keys(l)]:null,d=[...new Set(["orchestrator",...e.logLines.map(a=>a.stage).filter(Boolean)])],f=p||d,g=e.currentLogStage,w=r?.[g]||0,b=g&&g!=="*"&&w>0,o=g&&g!=="*";return I`
    <div class="log-history-container">
      <sl-details class="log-history-panel">
        <div slot="summary" class="log-history-header">
          <span class="log-history-icon">${G(Y(li,16))}</span>
          <span class="log-history-title">Log History</span>
        </div>
        <div class="log-history-body">
          <div class="log-controls">
            <sl-select
              .value=${g||""}
              placeholder="Select a stage\u2026"
              size="small"
              clearable
              @sl-change=${a=>t(a.target.value||"*")}
            >
              ${f.map(a=>I`<sl-option value="${a}">${a==="orchestrator"?I`<span style="display:inline-flex;align-items:center;gap:4px">${G(Y(Or,12))} ORCHESTRATOR</span>`:a.toUpperCase()}</sl-option>`)}
            </sl-select>
            ${b?I`
              <sl-select
                .value=${String(e.currentLogIteration||w)}
                size="small"
                @sl-change=${a=>s(a.target.value?parseInt(a.target.value):null)}
              >
                ${Array.from({length:w},(a,c)=>I`<sl-option value="${c+1}">Iteration ${c+1}</sl-option>`)}
              </sl-select>
            `:V}
            <sl-input
              class="log-search"
              type="text"
              placeholder="Search logs\u2026"
              size="small"
              clearable
              @sl-input=${a=>n(a.target.value)}
            >
              <span slot="prefix">${G(Y(Er,14))}</span>
            </sl-input>
            <sl-button
              size="small"
              variant="${i?"primary":"default"}"
              @click=${u}
            >
              ${G(Y(i?Sr:Ft,14))}
              ${i?"Auto":"Paused"}
            </sl-button>
          </div>
          ${o?I`
            <div class="log-terminal-wrapper">
              <div id="log-terminal" class="log-terminal"></div>
            </div>
          `:I`
            <div class="log-history-empty">
              <span class="log-history-empty-icon">${G(Y(li,32))}</span>
              <p>Select a stage from the dropdown to review past output.</p>
            </div>
          `}
        </div>
      </sl-details>
    </div>
  `}var la=["\x1B[36m","\x1B[33m","\x1B[35m","\x1B[32m","\x1B[34m","\x1B[91m","\x1B[96m","\x1B[93m"],Is="\x1B[0m",po="\x1B[2m",ho=new Map,ca=0;function Hh(e){return ho.has(e)||(ho.set(e,la[ca%la.length]),ca++),ho.get(e)}var Re=null,qt=null,Gi=null,uo=null,mi=null,Et=null;async function Fh(e){if(Re&&e.querySelector(".xterm")){qt.fit();return}if(mi){await mi;return}mi=(async()=>{let[{Terminal:t},{FitAddon:s}]=await Promise.all([Promise.resolve().then(()=>Xo(Ur(),1)),Promise.resolve().then(()=>(Vr(),jr))]);Re=new t({theme:{background:"#0f172a",foreground:"#e2e8f0",cursor:"#60a5fa",selectionBackground:"rgba(96, 165, 250, 0.3)"},fontFamily:"'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",fontSize:13,lineHeight:1.4,scrollback:1e4,convertEol:!0,cursorBlink:!1,disableStdin:!0}),qt=new s,Re.loadAddon(qt),Re.open(e),qt.fit(),Gi=new ResizeObserver(()=>{qt&&qt.fit()}),Gi.observe(e)})(),await mi,mi=null}function fo(e){if(!Re||!Et||e.stage!==Et)return;let t=e.timestamp?`${po}${e.timestamp}${Is} `:"",s=e.stage?`${Hh(e.stage)}[${e.stage.toUpperCase()}]${Is} `:"",n=e.line||e;Re.writeln(`${t}${s}${n}`)}function ha(e){Re&&Re.writeln(`
${po}${"\u2500".repeat(40)} Iteration ${e} ${"\u2500".repeat(40)}${Is}
`)}function _o(){Re&&Re.clear()}function da(){Gi&&Gi.disconnect(),Re&&Re.dispose(),Re=null,qt=null,Gi=null,mi=null,uo=null,Et=null}function zh(e){if(!e)return null;for(let[n,u]of Object.entries(e))if(u.status==="in_progress")return n;let t=null,s=null;for(let[n,u]of Object.entries(e))u.started_at&&(!s||u.started_at>s)&&(s=u.started_at,t=n);return t}function Hs(e){let t=e?.stages,s=zh(t);if(s!==Et){let n=Et;return Et=s,Re&&n!==null&&(Re.clear(),s&&Re.writeln(`${po}--- Switched to stage: ${s.toUpperCase()} ---${Is}
`)),{changed:!0,activeStage:s}}return{changed:!1,activeStage:Et}}function mo(){return Et}async function ua(e){let t=document.getElementById("live-output-terminal");t&&(e!==uo&&(_o(),uo=e),await Fh(t))}function pa(e,t){if(!t)return V;let s=e?e.replace(/_/g," ").toUpperCase():"WAITING";return I`
    <div class="live-output-container">
      <sl-details open class="live-output-panel">
        <div slot="summary" class="live-output-header">
          <span class="live-output-icon">${G(Y(zt,16))}</span>
          <span class="live-output-title">Live Output</span>
          ${e?I`<sl-badge variant="warning" pill>${s}</sl-badge>`:V}
        </div>
        <div class="live-output-terminal-wrapper">
          <div id="live-output-terminal" class="live-output-terminal"></div>
        </div>
      </sl-details>
    </div>
  `}var gi={run_completed:{severity:"info",title:"Pipeline Complete",requireInteraction:!1},run_failed:{severity:"critical",title:"Pipeline Failed",requireInteraction:!1},approval_needed:{severity:"critical",title:"Approval Required",requireInteraction:!0},test_failures:{severity:"warning",title:"Tests Failed",requireInteraction:!1},loop_limit_warning:{severity:"warning",title:"Loop Limit Warning",requireInteraction:!1}};function Nh(e,t,s){if(!s||!t)return null;let n=s.active===!0,u=t.active===!1;if(!n||!u)return null;let i=t.stages||{};if(Object.values(i).some(p=>p.status==="error"))return null;let l=Xi(t);return{event:"run_completed",title:gi.run_completed.title,body:`"${l}" finished successfully`,tag:`worca-complete-${e}`,requireInteraction:!1,runId:e}}function Wh(e,t,s){if(!s||!t)return null;let n=s.active===!0,u=t.active===!1;if(!n||!u)return null;let i=t.stages||{},r=Object.entries(i).find(([,p])=>p.status==="error");if(!r)return null;let l=Xi(t);return{event:"run_failed",title:gi.run_failed.title,body:`"${l}" failed at ${r[0]} stage`,tag:`worca-failed-${e}`,requireInteraction:!1,runId:e}}function Uh(e,t,s){if(!t)return null;let n=t.stages||{},u=s&&s.stages||{};for(let[i,r]of Object.entries(n))if(r.status==="waiting_approval"&&u[i]?.status!=="waiting_approval"){let p=Xi(t),d=i==="pr"?"PR":i;return{event:"approval_needed",title:gi.approval_needed.title,body:`"${p}" is waiting for ${d} approval`,tag:`worca-approval-${e}-${i}`,requireInteraction:!0,runId:e}}return null}function jh(e,t,s){if(!t)return null;let n=t.stages?.test;if(!n)return null;let u=n.iterations||[],i=s?.stages?.test?.iterations||[];if(u.length>i.length){let r=u[u.length-1];if(r&&r.result==="failed"){let l=Xi(t);return{event:"test_failures",title:gi.test_failures.title,body:`"${l}" test iteration ${u.length} failed`,tag:`worca-test-${e}-iter${u.length}`,requireInteraction:!1,runId:e}}}return null}function Vh(e,t,s,n,u){if(!t||!n)return null;let i=n?.worca?.loops;if(!i)return null;let r=t.stages||{},l={implement_test:["implement","test"],code_review:["review"],pr_changes:["pr"],restart_planning:["plan"]};for(let[p,d]of Object.entries(i)){if(!d||d<2)continue;let f=l[p];if(f)for(let g of f){let w=r[g];if(!w)continue;let b=(w.iterations||[]).length;if(b===d-1){let o=`${e}-${g}`;if(u.has(o))continue;u.add(o);let a=Xi(t);return{event:"loop_limit_warning",title:gi.loop_limit_warning.title,body:`"${a}" ${g} stage approaching loop limit (${b}/${d})`,tag:`worca-loop-${e}-${g}`,requireInteraction:!1,runId:e}}}}return null}function Xi(e){let s=(e?.work_request?.title||e?.id||"Pipeline").split(`
`)[0];return s.length>60?s.slice(0,60)+"\u2026":s}var ft=null;function qh(){try{ft||(ft=new AudioContext);let e=ft.createOscillator(),t=ft.createGain();e.type="sine",e.frequency.value=440,t.gain.value=.3,e.connect(t),t.connect(ft.destination),e.start(),e.stop(ft.currentTime+.2)}catch{}}var Fs={enabled:!0,sound:!1,events:{run_completed:!0,run_failed:!0,approval_needed:!0,test_failures:!0,loop_limit_warning:!0}};function fa({store:e,ws:t,getSettings:s}){let n=typeof Notification<"u"?Notification.permission:"denied",u=new Set,i=!1,r=null;function l(a){r=a}function p(){return typeof Notification<"u"&&(n=Notification.permission),n}async function d(){if(typeof Notification>"u")return"denied";let a=await Notification.requestPermission();return n=a,r&&r(),a}function f(){let a=e.getState().preferences.notifications;return a?{enabled:a.enabled??Fs.enabled,sound:a.sound??Fs.sound,events:{...Fs.events,...a.events||{}}}:{...Fs}}function g({event:a,title:c,body:h,tag:_,requireInteraction:v,runId:y}){if(typeof Notification>"u")return;let C=new Notification(c,{body:h,icon:"/favicon.svg",tag:_,requireInteraction:v});C.onclick=()=>{window.focus(),tt("active",y),C.close()};let m=f(),S=gi[a];m.sound&&S&&S.severity==="critical"&&qh()}function w(a,c,h){if(typeof Notification>"u"||Notification.permission!=="granted")return;let _=f();if(!_.enabled)return;let v=s(),y=[Nh,Wh,Uh,jh];for(let m of y){let S=m(a,c,h);S&&_.events[S.event]&&g(S)}let C=Vh(a,c,h,v,u);C&&_.events[C.event]&&g(C)}function b(){return typeof Notification>"u"?V:(p(),n==="default"?I`
        <div class="notification-banner notification-banner--info">
          <span class="notification-banner-text">
            Enable browser notifications to stay informed about pipeline events
          </span>
          <sl-button size="small" variant="primary" @click=${()=>d()}>
            Enable Notifications
          </sl-button>
        </div>
      `:n==="denied"&&!i?I`
        <div class="notification-banner notification-banner--warning">
          <span class="notification-banner-text">
            Notifications blocked. Enable in browser settings.
          </span>
          <button class="notification-banner-dismiss" @click=${()=>{i=!0,r&&r()}}>&times;</button>
        </div>
      `:V)}function o(){ft&&(ft.close().catch(()=>{}),ft=null)}return{checkPermission:p,requestPermission:d,handleRunUpdate:w,renderBanner:b,getPreferences:f,setRerender:l,dispose:o}}var zs=globalThis,Ns=zs.ShadowRoot&&(zs.ShadyCSS===void 0||zs.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,go=Symbol(),_a=new WeakMap,Yi=class{constructor(t,s,n){if(this._$cssResult$=!0,n!==go)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=s}get styleSheet(){let t=this.o,s=this.t;if(Ns&&t===void 0){let n=s!==void 0&&s.length===1;n&&(t=_a.get(s)),t===void 0&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),n&&_a.set(s,t))}return t}toString(){return this.cssText}},ma=e=>new Yi(typeof e=="string"?e:e+"",void 0,go),J=(e,...t)=>{let s=e.length===1?e[0]:t.reduce((n,u,i)=>n+(r=>{if(r._$cssResult$===!0)return r.cssText;if(typeof r=="number")return r;throw Error("Value passed to 'css' function must be a 'css' function result: "+r+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(u)+e[i+1],e[0]);return new Yi(s,e,go)},ga=(e,t)=>{if(Ns)e.adoptedStyleSheets=t.map(s=>s instanceof CSSStyleSheet?s:s.styleSheet);else for(let s of t){let n=document.createElement("style"),u=zs.litNonce;u!==void 0&&n.setAttribute("nonce",u),n.textContent=s.cssText,e.appendChild(n)}},vo=Ns?e=>e:e=>e instanceof CSSStyleSheet?(t=>{let s="";for(let n of t.cssRules)s+=n.cssText;return ma(s)})(e):e;var{is:Kh,defineProperty:Gh,getOwnPropertyDescriptor:Xh,getOwnPropertyNames:Yh,getOwnPropertySymbols:Jh,getPrototypeOf:Zh}=Object,At=globalThis,va=At.trustedTypes,Qh=va?va.emptyScript:"",ed=At.reactiveElementPolyfillSupport,Ji=(e,t)=>e,Lt={toAttribute(e,t){switch(t){case Boolean:e=e?Qh:null;break;case Object:case Array:e=e==null?e:JSON.stringify(e)}return e},fromAttribute(e,t){let s=e;switch(t){case Boolean:s=e!==null;break;case Number:s=e===null?null:Number(e);break;case Object:case Array:try{s=JSON.parse(e)}catch{s=null}}return s}},Ws=(e,t)=>!Kh(e,t),ba={attribute:!0,type:String,converter:Lt,reflect:!1,useDefault:!1,hasChanged:Ws};Symbol.metadata??(Symbol.metadata=Symbol("metadata")),At.litPropertyMetadata??(At.litPropertyMetadata=new WeakMap);var _t=class extends HTMLElement{static addInitializer(t){this._$Ei(),(this.l??(this.l=[])).push(t)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(t,s=ba){if(s.state&&(s.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(t)&&((s=Object.create(s)).wrapped=!0),this.elementProperties.set(t,s),!s.noAccessor){let n=Symbol(),u=this.getPropertyDescriptor(t,n,s);u!==void 0&&Gh(this.prototype,t,u)}}static getPropertyDescriptor(t,s,n){let{get:u,set:i}=Xh(this.prototype,t)??{get(){return this[s]},set(r){this[s]=r}};return{get:u,set(r){let l=u?.call(this);i?.call(this,r),this.requestUpdate(t,l,n)},configurable:!0,enumerable:!0}}static getPropertyOptions(t){return this.elementProperties.get(t)??ba}static _$Ei(){if(this.hasOwnProperty(Ji("elementProperties")))return;let t=Zh(this);t.finalize(),t.l!==void 0&&(this.l=[...t.l]),this.elementProperties=new Map(t.elementProperties)}static finalize(){if(this.hasOwnProperty(Ji("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(Ji("properties"))){let s=this.properties,n=[...Yh(s),...Jh(s)];for(let u of n)this.createProperty(u,s[u])}let t=this[Symbol.metadata];if(t!==null){let s=litPropertyMetadata.get(t);if(s!==void 0)for(let[n,u]of s)this.elementProperties.set(n,u)}this._$Eh=new Map;for(let[s,n]of this.elementProperties){let u=this._$Eu(s,n);u!==void 0&&this._$Eh.set(u,s)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(t){let s=[];if(Array.isArray(t)){let n=new Set(t.flat(1/0).reverse());for(let u of n)s.unshift(vo(u))}else t!==void 0&&s.push(vo(t));return s}static _$Eu(t,s){let n=s.attribute;return n===!1?void 0:typeof n=="string"?n:typeof t=="string"?t.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(t=>t(this))}addController(t){(this._$EO??(this._$EO=new Set)).add(t),this.renderRoot!==void 0&&this.isConnected&&t.hostConnected?.()}removeController(t){this._$EO?.delete(t)}_$E_(){let t=new Map,s=this.constructor.elementProperties;for(let n of s.keys())this.hasOwnProperty(n)&&(t.set(n,this[n]),delete this[n]);t.size>0&&(this._$Ep=t)}createRenderRoot(){let t=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return ga(t,this.constructor.elementStyles),t}connectedCallback(){this.renderRoot??(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),this._$EO?.forEach(t=>t.hostConnected?.())}enableUpdating(t){}disconnectedCallback(){this._$EO?.forEach(t=>t.hostDisconnected?.())}attributeChangedCallback(t,s,n){this._$AK(t,n)}_$ET(t,s){let n=this.constructor.elementProperties.get(t),u=this.constructor._$Eu(t,n);if(u!==void 0&&n.reflect===!0){let i=(n.converter?.toAttribute!==void 0?n.converter:Lt).toAttribute(s,n.type);this._$Em=t,i==null?this.removeAttribute(u):this.setAttribute(u,i),this._$Em=null}}_$AK(t,s){let n=this.constructor,u=n._$Eh.get(t);if(u!==void 0&&this._$Em!==u){let i=n.getPropertyOptions(u),r=typeof i.converter=="function"?{fromAttribute:i.converter}:i.converter?.fromAttribute!==void 0?i.converter:Lt;this._$Em=u;let l=r.fromAttribute(s,i.type);this[u]=l??this._$Ej?.get(u)??l,this._$Em=null}}requestUpdate(t,s,n,u=!1,i){if(t!==void 0){let r=this.constructor;if(u===!1&&(i=this[t]),n??(n=r.getPropertyOptions(t)),!((n.hasChanged??Ws)(i,s)||n.useDefault&&n.reflect&&i===this._$Ej?.get(t)&&!this.hasAttribute(r._$Eu(t,n))))return;this.C(t,s,n)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(t,s,{useDefault:n,reflect:u,wrapped:i},r){n&&!(this._$Ej??(this._$Ej=new Map)).has(t)&&(this._$Ej.set(t,r??s??this[t]),i!==!0||r!==void 0)||(this._$AL.has(t)||(this.hasUpdated||n||(s=void 0),this._$AL.set(t,s)),u===!0&&this._$Em!==t&&(this._$Eq??(this._$Eq=new Set)).add(t))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(s){Promise.reject(s)}let t=this.scheduleUpdate();return t!=null&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??(this.renderRoot=this.createRenderRoot()),this._$Ep){for(let[u,i]of this._$Ep)this[u]=i;this._$Ep=void 0}let n=this.constructor.elementProperties;if(n.size>0)for(let[u,i]of n){let{wrapped:r}=i,l=this[u];r!==!0||this._$AL.has(u)||l===void 0||this.C(u,void 0,i,l)}}let t=!1,s=this._$AL;try{t=this.shouldUpdate(s),t?(this.willUpdate(s),this._$EO?.forEach(n=>n.hostUpdate?.()),this.update(s)):this._$EM()}catch(n){throw t=!1,this._$EM(),n}t&&this._$AE(s)}willUpdate(t){}_$AE(t){this._$EO?.forEach(s=>s.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(t)),this.updated(t)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(t){return!0}update(t){this._$Eq&&(this._$Eq=this._$Eq.forEach(s=>this._$ET(s,this[s]))),this._$EM()}updated(t){}firstUpdated(t){}};_t.elementStyles=[],_t.shadowRootOptions={mode:"open"},_t[Ji("elementProperties")]=new Map,_t[Ji("finalized")]=new Map,ed?.({ReactiveElement:_t}),(At.reactiveElementVersions??(At.reactiveElementVersions=[])).push("2.1.2");var Zi=globalThis,Tt=class extends _t{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var s;let t=super.createRenderRoot();return(s=this.renderOptions).renderBefore??(s.renderBefore=t.firstChild),t}update(t){let s=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=ws(s,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return De}};Tt._$litElement$=!0,Tt.finalized=!0,Zi.litElementHydrateSupport?.({LitElement:Tt});var td=Zi.litElementPolyfillSupport;td?.({LitElement:Tt});(Zi.litElementVersions??(Zi.litElementVersions=[])).push("4.2.2");var ya=J`
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
`;var Ca=Object.defineProperty,id=Object.defineProperties,sd=Object.getOwnPropertyDescriptor,rd=Object.getOwnPropertyDescriptors,wa=Object.getOwnPropertySymbols,od=Object.prototype.hasOwnProperty,nd=Object.prototype.propertyIsEnumerable,bo=(e,t)=>(t=Symbol[e])?t:Symbol.for("Symbol."+e),yo=e=>{throw TypeError(e)},Sa=(e,t,s)=>t in e?Ca(e,t,{enumerable:!0,configurable:!0,writable:!0,value:s}):e[t]=s,$e=(e,t)=>{for(var s in t||(t={}))od.call(t,s)&&Sa(e,s,t[s]);if(wa)for(var s of wa(t))nd.call(t,s)&&Sa(e,s,t[s]);return e},mt=(e,t)=>id(e,rd(t)),D=(e,t,s,n)=>{for(var u=n>1?void 0:n?sd(t,s):t,i=e.length-1,r;i>=0;i--)(r=e[i])&&(u=(n?r(t,s,u):r(u))||u);return n&&u&&Ca(t,s,u),u},xa=(e,t,s)=>t.has(e)||yo("Cannot "+s),ka=(e,t,s)=>(xa(e,t,"read from private field"),s?s.call(e):t.get(e)),Ea=(e,t,s)=>t.has(e)?yo("Cannot add the same private member more than once"):t instanceof WeakSet?t.add(e):t.set(e,s),Aa=(e,t,s,n)=>(xa(e,t,"write to private field"),n?n.call(e,s):t.set(e,s),s),ad=function(e,t){this[0]=e,this[1]=t},La=e=>{var t=e[bo("asyncIterator")],s=!1,n,u={};return t==null?(t=e[bo("iterator")](),n=i=>u[i]=r=>t[i](r)):(t=t.call(e),n=i=>u[i]=r=>{if(s){if(s=!1,i==="throw")throw r;return r}return s=!0,{done:!1,value:new ad(new Promise(l=>{var p=t[i](r);p instanceof Object||yo("Object expected"),l(p)}),1)}}),u[bo("iterator")]=()=>u,n("next"),"throw"in t?n("throw"):u.throw=i=>{throw i},"return"in t&&n("return"),u};var Da=new Map,ld=new WeakMap;function cd(e){return e??{keyframes:[],options:{duration:0}}}function Ta(e,t){return t.toLowerCase()==="rtl"?{keyframes:e.rtlKeyframes||e.keyframes,options:e.options}:e}function we(e,t){Da.set(e,cd(t))}function Se(e,t,s){let n=ld.get(e);if(n?.[t])return Ta(n[t],s.dir);let u=Da.get(t);return u?Ta(u,s.dir):{keyframes:[],options:{duration:0}}}function Me(e,t){return new Promise(s=>{function n(u){u.target===e&&(e.removeEventListener(t,n),s())}e.addEventListener(t,n)})}function Ce(e,t,s){return new Promise(n=>{if(s?.duration===1/0)throw new Error("Promise-based animations must be finite.");let u=e.animate(t,mt($e({},s),{duration:hd()?0:s.duration}));u.addEventListener("cancel",n,{once:!0}),u.addEventListener("finish",n,{once:!0})})}function wo(e){return e=e.toString().toLowerCase(),e.indexOf("ms")>-1?parseFloat(e):e.indexOf("s")>-1?parseFloat(e)*1e3:parseFloat(e)}function hd(){return window.matchMedia("(prefers-reduced-motion: reduce)").matches}function Le(e){return Promise.all(e.getAnimations().map(t=>new Promise(s=>{t.cancel(),requestAnimationFrame(s)})))}function So(e,t){return e.map(s=>mt($e({},s),{height:s.height==="auto"?`${t}px`:s.height}))}var Co=new Set,vi=new Map,Kt,xo="ltr",ko="en",Ra=typeof MutationObserver<"u"&&typeof document<"u"&&typeof document.documentElement<"u";if(Ra){let e=new MutationObserver($a);xo=document.documentElement.dir||"ltr",ko=document.documentElement.lang||navigator.language,e.observe(document.documentElement,{attributes:!0,attributeFilter:["dir","lang"]})}function Qi(...e){e.map(t=>{let s=t.$code.toLowerCase();vi.has(s)?vi.set(s,Object.assign(Object.assign({},vi.get(s)),t)):vi.set(s,t),Kt||(Kt=t)}),$a()}function $a(){Ra&&(xo=document.documentElement.dir||"ltr",ko=document.documentElement.lang||navigator.language),[...Co.keys()].map(e=>{typeof e.requestUpdate=="function"&&e.requestUpdate()})}var Us=class{constructor(t){this.host=t,this.host.addController(this)}hostConnected(){Co.add(this.host)}hostDisconnected(){Co.delete(this.host)}dir(){return`${this.host.dir||xo}`.toLowerCase()}lang(){return`${this.host.lang||ko}`.toLowerCase()}getTranslationData(t){var s,n;let u=new Intl.Locale(t.replace(/_/g,"-")),i=u?.language.toLowerCase(),r=(n=(s=u?.region)===null||s===void 0?void 0:s.toLowerCase())!==null&&n!==void 0?n:"",l=vi.get(`${i}-${r}`),p=vi.get(i);return{locale:u,language:i,region:r,primary:l,secondary:p}}exists(t,s){var n;let{primary:u,secondary:i}=this.getTranslationData((n=s.lang)!==null&&n!==void 0?n:this.lang());return s=Object.assign({includeFallback:!1},s),!!(u&&u[t]||i&&i[t]||s.includeFallback&&Kt&&Kt[t])}term(t,...s){let{primary:n,secondary:u}=this.getTranslationData(this.lang()),i;if(n&&n[t])i=n[t];else if(u&&u[t])i=u[t];else if(Kt&&Kt[t])i=Kt[t];else return console.error(`No translation found for: ${String(t)}`),String(t);return typeof i=="function"?i(...s):i}date(t,s){return t=new Date(t),new Intl.DateTimeFormat(this.lang(),s).format(t)}number(t,s){return t=Number(t),isNaN(t)?"":new Intl.NumberFormat(this.lang(),s).format(t)}relativeTime(t,s,n){return new Intl.RelativeTimeFormat(this.lang(),n).format(t,s)}};var Oa={$code:"en",$name:"English",$dir:"ltr",carousel:"Carousel",clearEntry:"Clear entry",close:"Close",copied:"Copied",copy:"Copy",currentValue:"Current value",error:"Error",goToSlide:(e,t)=>`Go to slide ${e} of ${t}`,hidePassword:"Hide password",loading:"Loading",nextSlide:"Next slide",numOptionsSelected:e=>e===0?"No options selected":e===1?"1 option selected":`${e} options selected`,previousSlide:"Previous slide",progress:"Progress",remove:"Remove",resize:"Resize",scrollToEnd:"Scroll to end",scrollToStart:"Scroll to start",selectAColorFromTheScreen:"Select a color from the screen",showPassword:"Show password",slideNum:e=>`Slide ${e}`,toggleColorFormat:"Toggle color format"};Qi(Oa);var Ma=Oa;var _e=class extends Us{};Qi(Ma);var Eo="";function Ba(e){Eo=e}function Pa(e=""){if(!Eo){let t=[...document.getElementsByTagName("script")],s=t.find(n=>n.hasAttribute("data-shoelace"));if(s)Ba(s.getAttribute("data-shoelace"));else{let n=t.find(i=>/shoelace(\.min)?\.js($|\?)/.test(i.src)||/shoelace-autoloader(\.min)?\.js($|\?)/.test(i.src)),u="";n&&(u=n.getAttribute("src")),Ba(u.split("/").slice(0,-1).join("/"))}}return Eo.replace(/\/$/,"")+(e?`/${e.replace(/^\//,"")}`:"")}var dd={name:"default",resolver:e=>Pa(`assets/icons/${e}.svg`)},Ia=dd;var Ha={caret:`
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
  `},ud={name:"system",resolver:e=>e in Ha?`data:image/svg+xml,${encodeURIComponent(Ha[e])}`:""},Fa=ud;var pd=[Ia,Fa],Ao=[];function za(e){Ao.push(e)}function Na(e){Ao=Ao.filter(t=>t!==e)}function Lo(e){return pd.find(t=>t.name===e)}var Wa=J`
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
`;function te(e,t){let s=$e({waitUntilFirstUpdate:!1},t);return(n,u)=>{let{update:i}=n,r=Array.isArray(e)?e:[e];n.update=function(l){r.forEach(p=>{let d=p;if(l.has(d)){let f=l.get(d),g=this[d];f!==g&&(!s.waitUntilFirstUpdate||this.hasUpdated)&&this[u](f,g)}}),i.call(this,l)}}}var ne=J`
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
`;var fd={attribute:!0,type:String,converter:Lt,reflect:!1,hasChanged:Ws},_d=(e=fd,t,s)=>{let{kind:n,metadata:u}=s,i=globalThis.litPropertyMetadata.get(u);if(i===void 0&&globalThis.litPropertyMetadata.set(u,i=new Map),n==="setter"&&((e=Object.create(e)).wrapped=!0),i.set(s.name,e),n==="accessor"){let{name:r}=s;return{set(l){let p=t.get.call(this);t.set.call(this,l),this.requestUpdate(r,p,e,!0,l)},init(l){return l!==void 0&&this.C(r,void 0,e,l),l}}}if(n==="setter"){let{name:r}=s;return function(l){let p=this[r];t.call(this,l),this.requestUpdate(r,p,e,!0,l)}}throw Error("Unsupported decorator location: "+n)};function P(e){return(t,s)=>typeof s=="object"?_d(e,t,s):((n,u,i)=>{let r=u.hasOwnProperty(i);return u.constructor.createProperty(i,n),r?Object.getOwnPropertyDescriptor(u,i):void 0})(e,t,s)}function pe(e){return P({...e,state:!0,attribute:!1})}function Ua(e){return(t,s)=>{let n=typeof t=="function"?t:t[s];Object.assign(n,e)}}var Gt=(e,t,s)=>(s.configurable=!0,s.enumerable=!0,Reflect.decorate&&typeof t!="object"&&Object.defineProperty(e,t,s),s);function Z(e,t){return(s,n,u)=>{let i=r=>r.renderRoot?.querySelector(e)??null;if(t){let{get:r,set:l}=typeof n=="object"?s:u??(()=>{let p=Symbol();return{get(){return this[p]},set(d){this[p]=d}}})();return Gt(s,n,{get(){let p=r.call(this);return p===void 0&&(p=i(this),(p!==null||this.hasUpdated)&&l.call(this,p)),p}})}return Gt(s,n,{get(){return i(this)}})}}var js,Q=class extends Tt{constructor(){super(),Ea(this,js,!1),this.initialReflectedProperties=new Map,Object.entries(this.constructor.dependencies).forEach(([e,t])=>{this.constructor.define(e,t)})}emit(e,t){let s=new CustomEvent(e,$e({bubbles:!0,cancelable:!1,composed:!0,detail:{}},t));return this.dispatchEvent(s),s}static define(e,t=this,s={}){let n=customElements.get(e);if(!n){try{customElements.define(e,t,s)}catch{customElements.define(e,class extends t{},s)}return}let u=" (unknown version)",i=u;"version"in t&&t.version&&(u=" v"+t.version),"version"in n&&n.version&&(i=" v"+n.version),!(u&&i&&u===i)&&console.warn(`Attempted to register <${e}>${u}, but <${e}>${i} has already been registered.`)}attributeChangedCallback(e,t,s){ka(this,js)||(this.constructor.elementProperties.forEach((n,u)=>{n.reflect&&this[u]!=null&&this.initialReflectedProperties.set(u,this[u])}),Aa(this,js,!0)),super.attributeChangedCallback(e,t,s)}willUpdate(e){super.willUpdate(e),this.initialReflectedProperties.forEach((t,s)=>{e.has(s)&&this[s]==null&&(this[s]=t)})}};js=new WeakMap;Q.version="2.20.1";Q.dependencies={};D([P()],Q.prototype,"dir",2);D([P()],Q.prototype,"lang",2);var{I:vg}=hn;var ja=(e,t)=>t===void 0?e?._$litType$!==void 0:e?._$litType$===t;var Va=e=>e.strings===void 0;var md={},qa=(e,t=md)=>e._$AH=t;var es=Symbol(),Vs=Symbol(),To,Do=new Map,ye=class extends Q{constructor(){super(...arguments),this.initialRender=!1,this.svg=null,this.label="",this.library="default"}async resolveIcon(e,t){var s;let n;if(t?.spriteSheet)return this.svg=I`<svg part="svg">
        <use part="use" href="${e}"></use>
      </svg>`,this.svg;try{if(n=await fetch(e,{mode:"cors"}),!n.ok)return n.status===410?es:Vs}catch{return Vs}try{let u=document.createElement("div");u.innerHTML=await n.text();let i=u.firstElementChild;if(((s=i?.tagName)==null?void 0:s.toLowerCase())!=="svg")return es;To||(To=new DOMParser);let l=To.parseFromString(i.outerHTML,"text/html").body.querySelector("svg");return l?(l.part.add("svg"),document.adoptNode(l)):es}catch{return es}}connectedCallback(){super.connectedCallback(),za(this)}firstUpdated(){this.initialRender=!0,this.setIcon()}disconnectedCallback(){super.disconnectedCallback(),Na(this)}getIconSource(){let e=Lo(this.library);return this.name&&e?{url:e.resolver(this.name),fromLibrary:!0}:{url:this.src,fromLibrary:!1}}handleLabelChange(){typeof this.label=="string"&&this.label.length>0?(this.setAttribute("role","img"),this.setAttribute("aria-label",this.label),this.removeAttribute("aria-hidden")):(this.removeAttribute("role"),this.removeAttribute("aria-label"),this.setAttribute("aria-hidden","true"))}async setIcon(){var e;let{url:t,fromLibrary:s}=this.getIconSource(),n=s?Lo(this.library):void 0;if(!t){this.svg=null;return}let u=Do.get(t);if(u||(u=this.resolveIcon(t,n),Do.set(t,u)),!this.initialRender)return;let i=await u;if(i===Vs&&Do.delete(t),t===this.getIconSource().url){if(ja(i)){if(this.svg=i,n){await this.updateComplete;let r=this.shadowRoot.querySelector("[part='svg']");typeof n.mutator=="function"&&r&&n.mutator(r)}return}switch(i){case Vs:case es:this.svg=null,this.emit("sl-error");break;default:this.svg=i.cloneNode(!0),(e=n?.mutator)==null||e.call(n,this.svg),this.emit("sl-load")}}}render(){return this.svg}};ye.styles=[ne,Wa];D([pe()],ye.prototype,"svg",2);D([P({reflect:!0})],ye.prototype,"name",2);D([P()],ye.prototype,"src",2);D([P()],ye.prototype,"label",2);D([P({reflect:!0})],ye.prototype,"library",2);D([te("label")],ye.prototype,"handleLabelChange",1);D([te(["name","src","library"])],ye.prototype,"setIcon",1);var oe=ni(class extends wt{constructor(e){if(super(e),e.type!==Xe.ATTRIBUTE||e.name!=="class"||e.strings?.length>2)throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.")}render(e){return" "+Object.keys(e).filter(t=>e[t]).join(" ")+" "}update(e,[t]){if(this.st===void 0){this.st=new Set,e.strings!==void 0&&(this.nt=new Set(e.strings.join(" ").split(/\s/).filter(n=>n!=="")));for(let n in t)t[n]&&!this.nt?.has(n)&&this.st.add(n);return this.render(t)}let s=e.element.classList;for(let n of this.st)n in t||(s.remove(n),this.st.delete(n));for(let n in t){let u=!!t[n];u===this.st.has(n)||this.nt?.has(n)||(u?(s.add(n),this.st.add(n)):(s.remove(n),this.st.delete(n)))}return De}});var je=class extends Q{constructor(){super(...arguments),this.localize=new _e(this),this.open=!1,this.disabled=!1}firstUpdated(){this.body.style.height=this.open?"auto":"0",this.open&&(this.details.open=!0),this.detailsObserver=new MutationObserver(e=>{for(let t of e)t.type==="attributes"&&t.attributeName==="open"&&(this.details.open?this.show():this.hide())}),this.detailsObserver.observe(this.details,{attributes:!0})}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this.detailsObserver)==null||e.disconnect()}handleSummaryClick(e){e.preventDefault(),this.disabled||(this.open?this.hide():this.show(),this.header.focus())}handleSummaryKeyDown(e){(e.key==="Enter"||e.key===" ")&&(e.preventDefault(),this.open?this.hide():this.show()),(e.key==="ArrowUp"||e.key==="ArrowLeft")&&(e.preventDefault(),this.hide()),(e.key==="ArrowDown"||e.key==="ArrowRight")&&(e.preventDefault(),this.show())}async handleOpenChange(){if(this.open){if(this.details.open=!0,this.emit("sl-show",{cancelable:!0}).defaultPrevented){this.open=!1,this.details.open=!1;return}await Le(this.body);let{keyframes:t,options:s}=Se(this,"details.show",{dir:this.localize.dir()});await Ce(this.body,So(t,this.body.scrollHeight),s),this.body.style.height="auto",this.emit("sl-after-show")}else{if(this.emit("sl-hide",{cancelable:!0}).defaultPrevented){this.details.open=!0,this.open=!0;return}await Le(this.body);let{keyframes:t,options:s}=Se(this,"details.hide",{dir:this.localize.dir()});await Ce(this.body,So(t,this.body.scrollHeight),s),this.body.style.height="auto",this.details.open=!1,this.emit("sl-after-hide")}}async show(){if(!(this.open||this.disabled))return this.open=!0,Me(this,"sl-after-show")}async hide(){if(!(!this.open||this.disabled))return this.open=!1,Me(this,"sl-after-hide")}render(){let e=this.localize.dir()==="rtl";return I`
      <details
        part="base"
        class=${oe({details:!0,"details--open":this.open,"details--disabled":this.disabled,"details--rtl":e})}
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
    `}};je.styles=[ne,ya];je.dependencies={"sl-icon":ye};D([Z(".details")],je.prototype,"details",2);D([Z(".details__header")],je.prototype,"header",2);D([Z(".details__body")],je.prototype,"body",2);D([Z(".details__expand-icon-slot")],je.prototype,"expandIconSlot",2);D([P({type:Boolean,reflect:!0})],je.prototype,"open",2);D([P()],je.prototype,"summary",2);D([P({type:Boolean,reflect:!0})],je.prototype,"disabled",2);D([te("open",{waitUntilFirstUpdate:!0})],je.prototype,"handleOpenChange",1);we("details.show",{keyframes:[{height:"0",opacity:"0"},{height:"auto",opacity:"1"}],options:{duration:250,easing:"linear"}});we("details.hide",{keyframes:[{height:"auto",opacity:"1"},{height:"0",opacity:"0"}],options:{duration:250,easing:"linear"}});je.define("sl-details");var Ka=J`
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
`;var Ga=J`
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
`;var Ya=Symbol.for(""),gd=e=>{if(e?.r===Ya)return e?._$litStatic$};var bi=(e,...t)=>({_$litStatic$:t.reduce((s,n,u)=>s+(i=>{if(i._$litStatic$!==void 0)return i._$litStatic$;throw Error(`Value passed to 'literal' function must be a 'literal' result: ${i}. Use 'unsafeStatic' to pass non-literal values, but
            take care to ensure page security.`)})(n)+e[u+1],e[0]),r:Ya}),Xa=new Map,Ro=e=>(t,...s)=>{let n=s.length,u,i,r=[],l=[],p,d=0,f=!1;for(;d<n;){for(p=t[d];d<n&&(i=s[d],(u=gd(i))!==void 0);)p+=u+t[++d],f=!0;d!==n&&l.push(i),r.push(p),d++}if(d===n&&r.push(t[n]),f){let g=r.join("$$lit$$");(t=Xa.get(g))===void 0&&(r.raw=r,Xa.set(g,t=r)),s=l}return e(t,...s)},yi=Ro(I),Av=Ro(nn),Lv=Ro(an);var se=e=>e??V;var be=class extends Q{constructor(){super(...arguments),this.hasFocus=!1,this.label="",this.disabled=!1}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleClick(e){this.disabled&&(e.preventDefault(),e.stopPropagation())}click(){this.button.click()}focus(e){this.button.focus(e)}blur(){this.button.blur()}render(){let e=!!this.href,t=e?bi`a`:bi`button`;return yi`
      <${t}
        part="base"
        class=${oe({"icon-button":!0,"icon-button--disabled":!e&&this.disabled,"icon-button--focused":this.hasFocus})}
        ?disabled=${se(e?void 0:this.disabled)}
        type=${se(e?void 0:"button")}
        href=${se(e?this.href:void 0)}
        target=${se(e?this.target:void 0)}
        download=${se(e?this.download:void 0)}
        rel=${se(e&&this.target?"noreferrer noopener":void 0)}
        role=${se(e?void 0:"button")}
        aria-disabled=${this.disabled?"true":"false"}
        aria-label="${this.label}"
        tabindex=${this.disabled?"-1":"0"}
        @blur=${this.handleBlur}
        @focus=${this.handleFocus}
        @click=${this.handleClick}
      >
        <sl-icon
          class="icon-button__icon"
          name=${se(this.name)}
          library=${se(this.library)}
          src=${se(this.src)}
          aria-hidden="true"
        ></sl-icon>
      </${t}>
    `}};be.styles=[ne,Ga];be.dependencies={"sl-icon":ye};D([Z(".icon-button")],be.prototype,"button",2);D([pe()],be.prototype,"hasFocus",2);D([P()],be.prototype,"name",2);D([P()],be.prototype,"library",2);D([P()],be.prototype,"src",2);D([P()],be.prototype,"href",2);D([P()],be.prototype,"target",2);D([P()],be.prototype,"download",2);D([P()],be.prototype,"label",2);D([P({type:Boolean,reflect:!0})],be.prototype,"disabled",2);var Dt=class extends Q{constructor(){super(...arguments),this.localize=new _e(this),this.variant="neutral",this.size="medium",this.pill=!1,this.removable=!1}handleRemoveClick(){this.emit("sl-remove")}render(){return I`
      <span
        part="base"
        class=${oe({tag:!0,"tag--primary":this.variant==="primary","tag--success":this.variant==="success","tag--neutral":this.variant==="neutral","tag--warning":this.variant==="warning","tag--danger":this.variant==="danger","tag--text":this.variant==="text","tag--small":this.size==="small","tag--medium":this.size==="medium","tag--large":this.size==="large","tag--pill":this.pill,"tag--removable":this.removable})}
      >
        <slot part="content" class="tag__content"></slot>

        ${this.removable?I`
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
    `}};Dt.styles=[ne,Ka];Dt.dependencies={"sl-icon-button":be};D([P({reflect:!0})],Dt.prototype,"variant",2);D([P({reflect:!0})],Dt.prototype,"size",2);D([P({type:Boolean,reflect:!0})],Dt.prototype,"pill",2);D([P({type:Boolean})],Dt.prototype,"removable",2);var Ja=J`
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
`;function vd(e,t){return{top:Math.round(e.getBoundingClientRect().top-t.getBoundingClientRect().top),left:Math.round(e.getBoundingClientRect().left-t.getBoundingClientRect().left)}}var $o=new Set;function bd(){let e=document.documentElement.clientWidth;return Math.abs(window.innerWidth-e)}function yd(){let e=Number(getComputedStyle(document.body).paddingRight.replace(/px/,""));return isNaN(e)||!e?0:e}function Oo(e){if($o.add(e),!document.documentElement.classList.contains("sl-scroll-lock")){let t=bd()+yd(),s=getComputedStyle(document.documentElement).scrollbarGutter;(!s||s==="auto")&&(s="stable"),t<2&&(s=""),document.documentElement.style.setProperty("--sl-scroll-lock-gutter",s),document.documentElement.classList.add("sl-scroll-lock"),document.documentElement.style.setProperty("--sl-scroll-lock-size",`${t}px`)}}function Mo(e){$o.delete(e),$o.size===0&&(document.documentElement.classList.remove("sl-scroll-lock"),document.documentElement.style.removeProperty("--sl-scroll-lock-size"))}function ts(e,t,s="vertical",n="smooth"){let u=vd(e,t),i=u.top+t.scrollTop,r=u.left+t.scrollLeft,l=t.scrollLeft,p=t.scrollLeft+t.offsetWidth,d=t.scrollTop,f=t.scrollTop+t.offsetHeight;(s==="horizontal"||s==="both")&&(r<l?t.scrollTo({left:r,behavior:n}):r+e.clientWidth>p&&t.scrollTo({left:r-t.offsetWidth+e.clientWidth,behavior:n})),(s==="vertical"||s==="both")&&(i<d?t.scrollTo({top:i,behavior:n}):i+e.clientHeight>f&&t.scrollTo({top:i-t.offsetHeight+e.clientHeight,behavior:n}))}var wi=J`
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
`;var Za=J`
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
`;var nt=Math.min,Be=Math.max,ss=Math.round,rs=Math.floor,Je=e=>({x:e,y:e}),wd={left:"right",right:"left",bottom:"top",top:"bottom"};function Ks(e,t,s){return Be(e,nt(t,s))}function Xt(e,t){return typeof e=="function"?e(t):e}function gt(e){return e.split("-")[0]}function Yt(e){return e.split("-")[1]}function Bo(e){return e==="x"?"y":"x"}function Gs(e){return e==="y"?"height":"width"}function at(e){let t=e[0];return t==="t"||t==="b"?"y":"x"}function Xs(e){return Bo(at(e))}function tl(e,t,s){s===void 0&&(s=!1);let n=Yt(e),u=Xs(e),i=Gs(u),r=u==="x"?n===(s?"end":"start")?"right":"left":n==="start"?"bottom":"top";return t.reference[i]>t.floating[i]&&(r=is(r)),[r,is(r)]}function il(e){let t=is(e);return[qs(e),t,qs(t)]}function qs(e){return e.includes("start")?e.replace("start","end"):e.replace("end","start")}var Qa=["left","right"],el=["right","left"],Sd=["top","bottom"],Cd=["bottom","top"];function xd(e,t,s){switch(e){case"top":case"bottom":return s?t?el:Qa:t?Qa:el;case"left":case"right":return t?Sd:Cd;default:return[]}}function sl(e,t,s,n){let u=Yt(e),i=xd(gt(e),s==="start",n);return u&&(i=i.map(r=>r+"-"+u),t&&(i=i.concat(i.map(qs)))),i}function is(e){let t=gt(e);return wd[t]+e.slice(t.length)}function kd(e){return{top:0,right:0,bottom:0,left:0,...e}}function Po(e){return typeof e!="number"?kd(e):{top:e,right:e,bottom:e,left:e}}function Jt(e){let{x:t,y:s,width:n,height:u}=e;return{width:n,height:u,top:s,left:t,right:t+n,bottom:s+u,x:t,y:s}}function rl(e,t,s){let{reference:n,floating:u}=e,i=at(t),r=Xs(t),l=Gs(r),p=gt(t),d=i==="y",f=n.x+n.width/2-u.width/2,g=n.y+n.height/2-u.height/2,w=n[l]/2-u[l]/2,b;switch(p){case"top":b={x:f,y:n.y-u.height};break;case"bottom":b={x:f,y:n.y+n.height};break;case"right":b={x:n.x+n.width,y:g};break;case"left":b={x:n.x-u.width,y:g};break;default:b={x:n.x,y:n.y}}switch(Yt(t)){case"start":b[r]-=w*(s&&d?-1:1);break;case"end":b[r]+=w*(s&&d?-1:1);break}return b}async function ol(e,t){var s;t===void 0&&(t={});let{x:n,y:u,platform:i,rects:r,elements:l,strategy:p}=e,{boundary:d="clippingAncestors",rootBoundary:f="viewport",elementContext:g="floating",altBoundary:w=!1,padding:b=0}=Xt(t,e),o=Po(b),c=l[w?g==="floating"?"reference":"floating":g],h=Jt(await i.getClippingRect({element:(s=await(i.isElement==null?void 0:i.isElement(c)))==null||s?c:c.contextElement||await(i.getDocumentElement==null?void 0:i.getDocumentElement(l.floating)),boundary:d,rootBoundary:f,strategy:p})),_=g==="floating"?{x:n,y:u,width:r.floating.width,height:r.floating.height}:r.reference,v=await(i.getOffsetParent==null?void 0:i.getOffsetParent(l.floating)),y=await(i.isElement==null?void 0:i.isElement(v))?await(i.getScale==null?void 0:i.getScale(v))||{x:1,y:1}:{x:1,y:1},C=Jt(i.convertOffsetParentRelativeRectToViewportRelativeRect?await i.convertOffsetParentRelativeRectToViewportRelativeRect({elements:l,rect:_,offsetParent:v,strategy:p}):_);return{top:(h.top-C.top+o.top)/y.y,bottom:(C.bottom-h.bottom+o.bottom)/y.y,left:(h.left-C.left+o.left)/y.x,right:(C.right-h.right+o.right)/y.x}}var Ed=50,nl=async(e,t,s)=>{let{placement:n="bottom",strategy:u="absolute",middleware:i=[],platform:r}=s,l=r.detectOverflow?r:{...r,detectOverflow:ol},p=await(r.isRTL==null?void 0:r.isRTL(t)),d=await r.getElementRects({reference:e,floating:t,strategy:u}),{x:f,y:g}=rl(d,n,p),w=n,b=0,o={};for(let a=0;a<i.length;a++){let c=i[a];if(!c)continue;let{name:h,fn:_}=c,{x:v,y,data:C,reset:m}=await _({x:f,y:g,initialPlacement:n,placement:w,strategy:u,middlewareData:o,rects:d,platform:l,elements:{reference:e,floating:t}});f=v??f,g=y??g,o[h]={...o[h],...C},m&&b<Ed&&(b++,typeof m=="object"&&(m.placement&&(w=m.placement),m.rects&&(d=m.rects===!0?await r.getElementRects({reference:e,floating:t,strategy:u}):m.rects),{x:f,y:g}=rl(d,w,p)),a=-1)}return{x:f,y:g,placement:w,strategy:u,middlewareData:o}},al=e=>({name:"arrow",options:e,async fn(t){let{x:s,y:n,placement:u,rects:i,platform:r,elements:l,middlewareData:p}=t,{element:d,padding:f=0}=Xt(e,t)||{};if(d==null)return{};let g=Po(f),w={x:s,y:n},b=Xs(u),o=Gs(b),a=await r.getDimensions(d),c=b==="y",h=c?"top":"left",_=c?"bottom":"right",v=c?"clientHeight":"clientWidth",y=i.reference[o]+i.reference[b]-w[b]-i.floating[o],C=w[b]-i.reference[b],m=await(r.getOffsetParent==null?void 0:r.getOffsetParent(d)),S=m?m[v]:0;(!S||!await(r.isElement==null?void 0:r.isElement(m)))&&(S=l.floating[v]||i.floating[o]);let L=y/2-C/2,$=S/2-a[o]/2-1,T=nt(g[h],$),O=nt(g[_],$),z=T,B=S-a[o]-O,M=S/2-a[o]/2+L,H=Ks(z,M,B),x=!p.arrow&&Yt(u)!=null&&M!==H&&i.reference[o]/2-(M<z?T:O)-a[o]/2<0,E=x?M<z?M-z:M-B:0;return{[b]:w[b]+E,data:{[b]:H,centerOffset:M-H-E,...x&&{alignmentOffset:E}},reset:x}}});var ll=function(e){return e===void 0&&(e={}),{name:"flip",options:e,async fn(t){var s,n;let{placement:u,middlewareData:i,rects:r,initialPlacement:l,platform:p,elements:d}=t,{mainAxis:f=!0,crossAxis:g=!0,fallbackPlacements:w,fallbackStrategy:b="bestFit",fallbackAxisSideDirection:o="none",flipAlignment:a=!0,...c}=Xt(e,t);if((s=i.arrow)!=null&&s.alignmentOffset)return{};let h=gt(u),_=at(l),v=gt(l)===l,y=await(p.isRTL==null?void 0:p.isRTL(d.floating)),C=w||(v||!a?[is(l)]:il(l)),m=o!=="none";!w&&m&&C.push(...sl(l,a,o,y));let S=[l,...C],L=await p.detectOverflow(t,c),$=[],T=((n=i.flip)==null?void 0:n.overflows)||[];if(f&&$.push(L[h]),g){let M=tl(u,r,y);$.push(L[M[0]],L[M[1]])}if(T=[...T,{placement:u,overflows:$}],!$.every(M=>M<=0)){var O,z;let M=(((O=i.flip)==null?void 0:O.index)||0)+1,H=S[M];if(H&&(!(g==="alignment"?_!==at(H):!1)||T.every(A=>at(A.placement)===_?A.overflows[0]>0:!0)))return{data:{index:M,overflows:T},reset:{placement:H}};let x=(z=T.filter(E=>E.overflows[0]<=0).sort((E,A)=>E.overflows[1]-A.overflows[1])[0])==null?void 0:z.placement;if(!x)switch(b){case"bestFit":{var B;let E=(B=T.filter(A=>{if(m){let R=at(A.placement);return R===_||R==="y"}return!0}).map(A=>[A.placement,A.overflows.filter(R=>R>0).reduce((R,N)=>R+N,0)]).sort((A,R)=>A[1]-R[1])[0])==null?void 0:B[0];E&&(x=E);break}case"initialPlacement":x=l;break}if(u!==x)return{reset:{placement:x}}}return{}}}};var Ad=new Set(["left","top"]);async function Ld(e,t){let{placement:s,platform:n,elements:u}=e,i=await(n.isRTL==null?void 0:n.isRTL(u.floating)),r=gt(s),l=Yt(s),p=at(s)==="y",d=Ad.has(r)?-1:1,f=i&&p?-1:1,g=Xt(t,e),{mainAxis:w,crossAxis:b,alignmentAxis:o}=typeof g=="number"?{mainAxis:g,crossAxis:0,alignmentAxis:null}:{mainAxis:g.mainAxis||0,crossAxis:g.crossAxis||0,alignmentAxis:g.alignmentAxis};return l&&typeof o=="number"&&(b=l==="end"?o*-1:o),p?{x:b*f,y:w*d}:{x:w*d,y:b*f}}var cl=function(e){return e===void 0&&(e=0),{name:"offset",options:e,async fn(t){var s,n;let{x:u,y:i,placement:r,middlewareData:l}=t,p=await Ld(t,e);return r===((s=l.offset)==null?void 0:s.placement)&&(n=l.arrow)!=null&&n.alignmentOffset?{}:{x:u+p.x,y:i+p.y,data:{...p,placement:r}}}}},hl=function(e){return e===void 0&&(e={}),{name:"shift",options:e,async fn(t){let{x:s,y:n,placement:u,platform:i}=t,{mainAxis:r=!0,crossAxis:l=!1,limiter:p={fn:h=>{let{x:_,y:v}=h;return{x:_,y:v}}},...d}=Xt(e,t),f={x:s,y:n},g=await i.detectOverflow(t,d),w=at(gt(u)),b=Bo(w),o=f[b],a=f[w];if(r){let h=b==="y"?"top":"left",_=b==="y"?"bottom":"right",v=o+g[h],y=o-g[_];o=Ks(v,o,y)}if(l){let h=w==="y"?"top":"left",_=w==="y"?"bottom":"right",v=a+g[h],y=a-g[_];a=Ks(v,a,y)}let c=p.fn({...t,[b]:o,[w]:a});return{...c,data:{x:c.x-s,y:c.y-n,enabled:{[b]:r,[w]:l}}}}}};var dl=function(e){return e===void 0&&(e={}),{name:"size",options:e,async fn(t){var s,n;let{placement:u,rects:i,platform:r,elements:l}=t,{apply:p=()=>{},...d}=Xt(e,t),f=await r.detectOverflow(t,d),g=gt(u),w=Yt(u),b=at(u)==="y",{width:o,height:a}=i.floating,c,h;g==="top"||g==="bottom"?(c=g,h=w===(await(r.isRTL==null?void 0:r.isRTL(l.floating))?"start":"end")?"left":"right"):(h=g,c=w==="end"?"top":"bottom");let _=a-f.top-f.bottom,v=o-f.left-f.right,y=nt(a-f[c],_),C=nt(o-f[h],v),m=!t.middlewareData.shift,S=y,L=C;if((s=t.middlewareData.shift)!=null&&s.enabled.x&&(L=v),(n=t.middlewareData.shift)!=null&&n.enabled.y&&(S=_),m&&!w){let T=Be(f.left,0),O=Be(f.right,0),z=Be(f.top,0),B=Be(f.bottom,0);b?L=o-2*(T!==0||O!==0?T+O:Be(f.left,f.right)):S=a-2*(z!==0||B!==0?z+B:Be(f.top,f.bottom))}await p({...t,availableWidth:L,availableHeight:S});let $=await r.getDimensions(l.floating);return o!==$.width||a!==$.height?{reset:{rects:!0}}:{}}}};function Ys(){return typeof window<"u"}function Qt(e){return pl(e)?(e.nodeName||"").toLowerCase():"#document"}function He(e){var t;return(e==null||(t=e.ownerDocument)==null?void 0:t.defaultView)||window}function Ze(e){var t;return(t=(pl(e)?e.ownerDocument:e.document)||window.document)==null?void 0:t.documentElement}function pl(e){return Ys()?e instanceof Node||e instanceof He(e).Node:!1}function Ve(e){return Ys()?e instanceof Element||e instanceof He(e).Element:!1}function lt(e){return Ys()?e instanceof HTMLElement||e instanceof He(e).HTMLElement:!1}function ul(e){return!Ys()||typeof ShadowRoot>"u"?!1:e instanceof ShadowRoot||e instanceof He(e).ShadowRoot}function Ci(e){let{overflow:t,overflowX:s,overflowY:n,display:u}=qe(e);return/auto|scroll|overlay|hidden|clip/.test(t+n+s)&&u!=="inline"&&u!=="contents"}function fl(e){return/^(table|td|th)$/.test(Qt(e))}function os(e){try{if(e.matches(":popover-open"))return!0}catch{}try{return e.matches(":modal")}catch{return!1}}var Td=/transform|translate|scale|rotate|perspective|filter/,Dd=/paint|layout|strict|content/,Zt=e=>!!e&&e!=="none",Io;function xi(e){let t=Ve(e)?qe(e):e;return Zt(t.transform)||Zt(t.translate)||Zt(t.scale)||Zt(t.rotate)||Zt(t.perspective)||!Js()&&(Zt(t.backdropFilter)||Zt(t.filter))||Td.test(t.willChange||"")||Dd.test(t.contain||"")}function _l(e){let t=vt(e);for(;lt(t)&&!ei(t);){if(xi(t))return t;if(os(t))return null;t=vt(t)}return null}function Js(){return Io==null&&(Io=typeof CSS<"u"&&CSS.supports&&CSS.supports("-webkit-backdrop-filter","none")),Io}function ei(e){return/^(html|body|#document)$/.test(Qt(e))}function qe(e){return He(e).getComputedStyle(e)}function ns(e){return Ve(e)?{scrollLeft:e.scrollLeft,scrollTop:e.scrollTop}:{scrollLeft:e.scrollX,scrollTop:e.scrollY}}function vt(e){if(Qt(e)==="html")return e;let t=e.assignedSlot||e.parentNode||ul(e)&&e.host||Ze(e);return ul(t)?t.host:t}function ml(e){let t=vt(e);return ei(t)?e.ownerDocument?e.ownerDocument.body:e.body:lt(t)&&Ci(t)?t:ml(t)}function Si(e,t,s){var n;t===void 0&&(t=[]),s===void 0&&(s=!0);let u=ml(e),i=u===((n=e.ownerDocument)==null?void 0:n.body),r=He(u);if(i){let l=Zs(r);return t.concat(r,r.visualViewport||[],Ci(u)?u:[],l&&s?Si(l):[])}else return t.concat(u,Si(u,[],s))}function Zs(e){return e.parent&&Object.getPrototypeOf(e.parent)?e.frameElement:null}function yl(e){let t=qe(e),s=parseFloat(t.width)||0,n=parseFloat(t.height)||0,u=lt(e),i=u?e.offsetWidth:s,r=u?e.offsetHeight:n,l=ss(s)!==i||ss(n)!==r;return l&&(s=i,n=r),{width:s,height:n,$:l}}function Fo(e){return Ve(e)?e:e.contextElement}function ki(e){let t=Fo(e);if(!lt(t))return Je(1);let s=t.getBoundingClientRect(),{width:n,height:u,$:i}=yl(t),r=(i?ss(s.width):s.width)/n,l=(i?ss(s.height):s.height)/u;return(!r||!Number.isFinite(r))&&(r=1),(!l||!Number.isFinite(l))&&(l=1),{x:r,y:l}}var Rd=Je(0);function wl(e){let t=He(e);return!Js()||!t.visualViewport?Rd:{x:t.visualViewport.offsetLeft,y:t.visualViewport.offsetTop}}function $d(e,t,s){return t===void 0&&(t=!1),!s||t&&s!==He(e)?!1:t}function ti(e,t,s,n){t===void 0&&(t=!1),s===void 0&&(s=!1);let u=e.getBoundingClientRect(),i=Fo(e),r=Je(1);t&&(n?Ve(n)&&(r=ki(n)):r=ki(e));let l=$d(i,s,n)?wl(i):Je(0),p=(u.left+l.x)/r.x,d=(u.top+l.y)/r.y,f=u.width/r.x,g=u.height/r.y;if(i){let w=He(i),b=n&&Ve(n)?He(n):n,o=w,a=Zs(o);for(;a&&n&&b!==o;){let c=ki(a),h=a.getBoundingClientRect(),_=qe(a),v=h.left+(a.clientLeft+parseFloat(_.paddingLeft))*c.x,y=h.top+(a.clientTop+parseFloat(_.paddingTop))*c.y;p*=c.x,d*=c.y,f*=c.x,g*=c.y,p+=v,d+=y,o=He(a),a=Zs(o)}}return Jt({width:f,height:g,x:p,y:d})}function Qs(e,t){let s=ns(e).scrollLeft;return t?t.left+s:ti(Ze(e)).left+s}function Sl(e,t){let s=e.getBoundingClientRect(),n=s.left+t.scrollLeft-Qs(e,s),u=s.top+t.scrollTop;return{x:n,y:u}}function Od(e){let{elements:t,rect:s,offsetParent:n,strategy:u}=e,i=u==="fixed",r=Ze(n),l=t?os(t.floating):!1;if(n===r||l&&i)return s;let p={scrollLeft:0,scrollTop:0},d=Je(1),f=Je(0),g=lt(n);if((g||!g&&!i)&&((Qt(n)!=="body"||Ci(r))&&(p=ns(n)),g)){let b=ti(n);d=ki(n),f.x=b.x+n.clientLeft,f.y=b.y+n.clientTop}let w=r&&!g&&!i?Sl(r,p):Je(0);return{width:s.width*d.x,height:s.height*d.y,x:s.x*d.x-p.scrollLeft*d.x+f.x+w.x,y:s.y*d.y-p.scrollTop*d.y+f.y+w.y}}function Md(e){return Array.from(e.getClientRects())}function Bd(e){let t=Ze(e),s=ns(e),n=e.ownerDocument.body,u=Be(t.scrollWidth,t.clientWidth,n.scrollWidth,n.clientWidth),i=Be(t.scrollHeight,t.clientHeight,n.scrollHeight,n.clientHeight),r=-s.scrollLeft+Qs(e),l=-s.scrollTop;return qe(n).direction==="rtl"&&(r+=Be(t.clientWidth,n.clientWidth)-u),{width:u,height:i,x:r,y:l}}var gl=25;function Pd(e,t){let s=He(e),n=Ze(e),u=s.visualViewport,i=n.clientWidth,r=n.clientHeight,l=0,p=0;if(u){i=u.width,r=u.height;let f=Js();(!f||f&&t==="fixed")&&(l=u.offsetLeft,p=u.offsetTop)}let d=Qs(n);if(d<=0){let f=n.ownerDocument,g=f.body,w=getComputedStyle(g),b=f.compatMode==="CSS1Compat"&&parseFloat(w.marginLeft)+parseFloat(w.marginRight)||0,o=Math.abs(n.clientWidth-g.clientWidth-b);o<=gl&&(i-=o)}else d<=gl&&(i+=d);return{width:i,height:r,x:l,y:p}}function Id(e,t){let s=ti(e,!0,t==="fixed"),n=s.top+e.clientTop,u=s.left+e.clientLeft,i=lt(e)?ki(e):Je(1),r=e.clientWidth*i.x,l=e.clientHeight*i.y,p=u*i.x,d=n*i.y;return{width:r,height:l,x:p,y:d}}function vl(e,t,s){let n;if(t==="viewport")n=Pd(e,s);else if(t==="document")n=Bd(Ze(e));else if(Ve(t))n=Id(t,s);else{let u=wl(e);n={x:t.x-u.x,y:t.y-u.y,width:t.width,height:t.height}}return Jt(n)}function Cl(e,t){let s=vt(e);return s===t||!Ve(s)||ei(s)?!1:qe(s).position==="fixed"||Cl(s,t)}function Hd(e,t){let s=t.get(e);if(s)return s;let n=Si(e,[],!1).filter(l=>Ve(l)&&Qt(l)!=="body"),u=null,i=qe(e).position==="fixed",r=i?vt(e):e;for(;Ve(r)&&!ei(r);){let l=qe(r),p=xi(r);!p&&l.position==="fixed"&&(u=null),(i?!p&&!u:!p&&l.position==="static"&&!!u&&(u.position==="absolute"||u.position==="fixed")||Ci(r)&&!p&&Cl(e,r))?n=n.filter(f=>f!==r):u=l,r=vt(r)}return t.set(e,n),n}function Fd(e){let{element:t,boundary:s,rootBoundary:n,strategy:u}=e,r=[...s==="clippingAncestors"?os(t)?[]:Hd(t,this._c):[].concat(s),n],l=vl(t,r[0],u),p=l.top,d=l.right,f=l.bottom,g=l.left;for(let w=1;w<r.length;w++){let b=vl(t,r[w],u);p=Be(b.top,p),d=nt(b.right,d),f=nt(b.bottom,f),g=Be(b.left,g)}return{width:d-g,height:f-p,x:g,y:p}}function zd(e){let{width:t,height:s}=yl(e);return{width:t,height:s}}function Nd(e,t,s){let n=lt(t),u=Ze(t),i=s==="fixed",r=ti(e,!0,i,t),l={scrollLeft:0,scrollTop:0},p=Je(0);function d(){p.x=Qs(u)}if(n||!n&&!i)if((Qt(t)!=="body"||Ci(u))&&(l=ns(t)),n){let b=ti(t,!0,i,t);p.x=b.x+t.clientLeft,p.y=b.y+t.clientTop}else u&&d();i&&!n&&u&&d();let f=u&&!n&&!i?Sl(u,l):Je(0),g=r.left+l.scrollLeft-p.x-f.x,w=r.top+l.scrollTop-p.y-f.y;return{x:g,y:w,width:r.width,height:r.height}}function Ho(e){return qe(e).position==="static"}function bl(e,t){if(!lt(e)||qe(e).position==="fixed")return null;if(t)return t(e);let s=e.offsetParent;return Ze(e)===s&&(s=s.ownerDocument.body),s}function xl(e,t){let s=He(e);if(os(e))return s;if(!lt(e)){let u=vt(e);for(;u&&!ei(u);){if(Ve(u)&&!Ho(u))return u;u=vt(u)}return s}let n=bl(e,t);for(;n&&fl(n)&&Ho(n);)n=bl(n,t);return n&&ei(n)&&Ho(n)&&!xi(n)?s:n||_l(e)||s}var Wd=async function(e){let t=this.getOffsetParent||xl,s=this.getDimensions,n=await s(e.floating);return{reference:Nd(e.reference,await t(e.floating),e.strategy),floating:{x:0,y:0,width:n.width,height:n.height}}};function Ud(e){return qe(e).direction==="rtl"}var as={convertOffsetParentRelativeRectToViewportRelativeRect:Od,getDocumentElement:Ze,getClippingRect:Fd,getOffsetParent:xl,getElementRects:Wd,getClientRects:Md,getDimensions:zd,getScale:ki,isElement:Ve,isRTL:Ud};function kl(e,t){return e.x===t.x&&e.y===t.y&&e.width===t.width&&e.height===t.height}function jd(e,t){let s=null,n,u=Ze(e);function i(){var l;clearTimeout(n),(l=s)==null||l.disconnect(),s=null}function r(l,p){l===void 0&&(l=!1),p===void 0&&(p=1),i();let d=e.getBoundingClientRect(),{left:f,top:g,width:w,height:b}=d;if(l||t(),!w||!b)return;let o=rs(g),a=rs(u.clientWidth-(f+w)),c=rs(u.clientHeight-(g+b)),h=rs(f),v={rootMargin:-o+"px "+-a+"px "+-c+"px "+-h+"px",threshold:Be(0,nt(1,p))||1},y=!0;function C(m){let S=m[0].intersectionRatio;if(S!==p){if(!y)return r();S?r(!1,S):n=setTimeout(()=>{r(!1,1e-7)},1e3)}S===1&&!kl(d,e.getBoundingClientRect())&&r(),y=!1}try{s=new IntersectionObserver(C,{...v,root:u.ownerDocument})}catch{s=new IntersectionObserver(C,v)}s.observe(e)}return r(!0),i}function El(e,t,s,n){n===void 0&&(n={});let{ancestorScroll:u=!0,ancestorResize:i=!0,elementResize:r=typeof ResizeObserver=="function",layoutShift:l=typeof IntersectionObserver=="function",animationFrame:p=!1}=n,d=Fo(e),f=u||i?[...d?Si(d):[],...t?Si(t):[]]:[];f.forEach(h=>{u&&h.addEventListener("scroll",s,{passive:!0}),i&&h.addEventListener("resize",s)});let g=d&&l?jd(d,s):null,w=-1,b=null;r&&(b=new ResizeObserver(h=>{let[_]=h;_&&_.target===d&&b&&t&&(b.unobserve(t),cancelAnimationFrame(w),w=requestAnimationFrame(()=>{var v;(v=b)==null||v.observe(t)})),s()}),d&&!p&&b.observe(d),t&&b.observe(t));let o,a=p?ti(e):null;p&&c();function c(){let h=ti(e);a&&!kl(a,h)&&s(),a=h,o=requestAnimationFrame(c)}return s(),()=>{var h;f.forEach(_=>{u&&_.removeEventListener("scroll",s),i&&_.removeEventListener("resize",s)}),g?.(),(h=b)==null||h.disconnect(),b=null,p&&cancelAnimationFrame(o)}}var Al=cl;var Ll=hl,Tl=ll,zo=dl;var Dl=al;var Rl=(e,t,s)=>{let n=new Map,u={platform:as,...s},i={...u.platform,_c:n};return nl(e,t,{...u,platform:i})};function $l(e){return Vd(e)}function No(e){return e.assignedSlot?e.assignedSlot:e.parentNode instanceof ShadowRoot?e.parentNode.host:e.parentNode}function Vd(e){for(let t=e;t;t=No(t))if(t instanceof Element&&getComputedStyle(t).display==="none")return null;for(let t=No(e);t;t=No(t)){if(!(t instanceof Element))continue;let s=getComputedStyle(t);if(s.display!=="contents"&&(s.position!=="static"||xi(s)||t.tagName==="BODY"))return t}return null}function qd(e){return e!==null&&typeof e=="object"&&"getBoundingClientRect"in e&&("contextElement"in e?e.contextElement instanceof Element:!0)}var ue=class extends Q{constructor(){super(...arguments),this.localize=new _e(this),this.active=!1,this.placement="top",this.strategy="absolute",this.distance=0,this.skidding=0,this.arrow=!1,this.arrowPlacement="anchor",this.arrowPadding=10,this.flip=!1,this.flipFallbackPlacements="",this.flipFallbackStrategy="best-fit",this.flipPadding=0,this.shift=!1,this.shiftPadding=0,this.autoSizePadding=0,this.hoverBridge=!1,this.updateHoverBridge=()=>{if(this.hoverBridge&&this.anchorEl){let e=this.anchorEl.getBoundingClientRect(),t=this.popup.getBoundingClientRect(),s=this.placement.includes("top")||this.placement.includes("bottom"),n=0,u=0,i=0,r=0,l=0,p=0,d=0,f=0;s?e.top<t.top?(n=e.left,u=e.bottom,i=e.right,r=e.bottom,l=t.left,p=t.top,d=t.right,f=t.top):(n=t.left,u=t.bottom,i=t.right,r=t.bottom,l=e.left,p=e.top,d=e.right,f=e.top):e.left<t.left?(n=e.right,u=e.top,i=t.left,r=t.top,l=e.right,p=e.bottom,d=t.left,f=t.bottom):(n=t.right,u=t.top,i=e.left,r=e.top,l=t.right,p=t.bottom,d=e.left,f=e.bottom),this.style.setProperty("--hover-bridge-top-left-x",`${n}px`),this.style.setProperty("--hover-bridge-top-left-y",`${u}px`),this.style.setProperty("--hover-bridge-top-right-x",`${i}px`),this.style.setProperty("--hover-bridge-top-right-y",`${r}px`),this.style.setProperty("--hover-bridge-bottom-left-x",`${l}px`),this.style.setProperty("--hover-bridge-bottom-left-y",`${p}px`),this.style.setProperty("--hover-bridge-bottom-right-x",`${d}px`),this.style.setProperty("--hover-bridge-bottom-right-y",`${f}px`)}}}async connectedCallback(){super.connectedCallback(),await this.updateComplete,this.start()}disconnectedCallback(){super.disconnectedCallback(),this.stop()}async updated(e){super.updated(e),e.has("active")&&(this.active?this.start():this.stop()),e.has("anchor")&&this.handleAnchorChange(),this.active&&(await this.updateComplete,this.reposition())}async handleAnchorChange(){if(await this.stop(),this.anchor&&typeof this.anchor=="string"){let e=this.getRootNode();this.anchorEl=e.getElementById(this.anchor)}else this.anchor instanceof Element||qd(this.anchor)?this.anchorEl=this.anchor:this.anchorEl=this.querySelector('[slot="anchor"]');this.anchorEl instanceof HTMLSlotElement&&(this.anchorEl=this.anchorEl.assignedElements({flatten:!0})[0]),this.anchorEl&&this.active&&this.start()}start(){!this.anchorEl||!this.active||(this.cleanup=El(this.anchorEl,this.popup,()=>{this.reposition()}))}async stop(){return new Promise(e=>{this.cleanup?(this.cleanup(),this.cleanup=void 0,this.removeAttribute("data-current-placement"),this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height"),requestAnimationFrame(()=>e())):e()})}reposition(){if(!this.active||!this.anchorEl)return;let e=[Al({mainAxis:this.distance,crossAxis:this.skidding})];this.sync?e.push(zo({apply:({rects:s})=>{let n=this.sync==="width"||this.sync==="both",u=this.sync==="height"||this.sync==="both";this.popup.style.width=n?`${s.reference.width}px`:"",this.popup.style.height=u?`${s.reference.height}px`:""}})):(this.popup.style.width="",this.popup.style.height=""),this.flip&&e.push(Tl({boundary:this.flipBoundary,fallbackPlacements:this.flipFallbackPlacements,fallbackStrategy:this.flipFallbackStrategy==="best-fit"?"bestFit":"initialPlacement",padding:this.flipPadding})),this.shift&&e.push(Ll({boundary:this.shiftBoundary,padding:this.shiftPadding})),this.autoSize?e.push(zo({boundary:this.autoSizeBoundary,padding:this.autoSizePadding,apply:({availableWidth:s,availableHeight:n})=>{this.autoSize==="vertical"||this.autoSize==="both"?this.style.setProperty("--auto-size-available-height",`${n}px`):this.style.removeProperty("--auto-size-available-height"),this.autoSize==="horizontal"||this.autoSize==="both"?this.style.setProperty("--auto-size-available-width",`${s}px`):this.style.removeProperty("--auto-size-available-width")}})):(this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height")),this.arrow&&e.push(Dl({element:this.arrowEl,padding:this.arrowPadding}));let t=this.strategy==="absolute"?s=>as.getOffsetParent(s,$l):as.getOffsetParent;Rl(this.anchorEl,this.popup,{placement:this.placement,middleware:e,strategy:this.strategy,platform:mt($e({},as),{getOffsetParent:t})}).then(({x:s,y:n,middlewareData:u,placement:i})=>{let r=this.localize.dir()==="rtl",l={top:"bottom",right:"left",bottom:"top",left:"right"}[i.split("-")[0]];if(this.setAttribute("data-current-placement",i),Object.assign(this.popup.style,{left:`${s}px`,top:`${n}px`}),this.arrow){let p=u.arrow.x,d=u.arrow.y,f="",g="",w="",b="";if(this.arrowPlacement==="start"){let o=typeof p=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";f=typeof d=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"",g=r?o:"",b=r?"":o}else if(this.arrowPlacement==="end"){let o=typeof p=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";g=r?"":o,b=r?o:"",w=typeof d=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:""}else this.arrowPlacement==="center"?(b=typeof p=="number"?"calc(50% - var(--arrow-size-diagonal))":"",f=typeof d=="number"?"calc(50% - var(--arrow-size-diagonal))":""):(b=typeof p=="number"?`${p}px`:"",f=typeof d=="number"?`${d}px`:"");Object.assign(this.arrowEl.style,{top:f,right:g,bottom:w,left:b,[l]:"calc(var(--arrow-size-diagonal) * -1)"})}}),requestAnimationFrame(()=>this.updateHoverBridge()),this.emit("sl-reposition")}render(){return I`
      <slot name="anchor" @slotchange=${this.handleAnchorChange}></slot>

      <span
        part="hover-bridge"
        class=${oe({"popup-hover-bridge":!0,"popup-hover-bridge--visible":this.hoverBridge&&this.active})}
      ></span>

      <div
        part="popup"
        class=${oe({popup:!0,"popup--active":this.active,"popup--fixed":this.strategy==="fixed","popup--has-arrow":this.arrow})}
      >
        <slot></slot>
        ${this.arrow?I`<div part="arrow" class="popup__arrow" role="presentation"></div>`:""}
      </div>
    `}};ue.styles=[ne,Za];D([Z(".popup")],ue.prototype,"popup",2);D([Z(".popup__arrow")],ue.prototype,"arrowEl",2);D([P()],ue.prototype,"anchor",2);D([P({type:Boolean,reflect:!0})],ue.prototype,"active",2);D([P({reflect:!0})],ue.prototype,"placement",2);D([P({reflect:!0})],ue.prototype,"strategy",2);D([P({type:Number})],ue.prototype,"distance",2);D([P({type:Number})],ue.prototype,"skidding",2);D([P({type:Boolean})],ue.prototype,"arrow",2);D([P({attribute:"arrow-placement"})],ue.prototype,"arrowPlacement",2);D([P({attribute:"arrow-padding",type:Number})],ue.prototype,"arrowPadding",2);D([P({type:Boolean})],ue.prototype,"flip",2);D([P({attribute:"flip-fallback-placements",converter:{fromAttribute:e=>e.split(" ").map(t=>t.trim()).filter(t=>t!==""),toAttribute:e=>e.join(" ")}})],ue.prototype,"flipFallbackPlacements",2);D([P({attribute:"flip-fallback-strategy"})],ue.prototype,"flipFallbackStrategy",2);D([P({type:Object})],ue.prototype,"flipBoundary",2);D([P({attribute:"flip-padding",type:Number})],ue.prototype,"flipPadding",2);D([P({type:Boolean})],ue.prototype,"shift",2);D([P({type:Object})],ue.prototype,"shiftBoundary",2);D([P({attribute:"shift-padding",type:Number})],ue.prototype,"shiftPadding",2);D([P({attribute:"auto-size"})],ue.prototype,"autoSize",2);D([P()],ue.prototype,"sync",2);D([P({type:Object})],ue.prototype,"autoSizeBoundary",2);D([P({attribute:"auto-size-padding",type:Number})],ue.prototype,"autoSizePadding",2);D([P({attribute:"hover-bridge",type:Boolean})],ue.prototype,"hoverBridge",2);var ls=new WeakMap,cs=new WeakMap,hs=new WeakMap,Wo=new WeakSet,er=new WeakMap,Rt=class{constructor(e,t){this.handleFormData=s=>{let n=this.options.disabled(this.host),u=this.options.name(this.host),i=this.options.value(this.host),r=this.host.tagName.toLowerCase()==="sl-button";this.host.isConnected&&!n&&!r&&typeof u=="string"&&u.length>0&&typeof i<"u"&&(Array.isArray(i)?i.forEach(l=>{s.formData.append(u,l.toString())}):s.formData.append(u,i.toString()))},this.handleFormSubmit=s=>{var n;let u=this.options.disabled(this.host),i=this.options.reportValidity;this.form&&!this.form.noValidate&&((n=ls.get(this.form))==null||n.forEach(r=>{this.setUserInteracted(r,!0)})),this.form&&!this.form.noValidate&&!u&&!i(this.host)&&(s.preventDefault(),s.stopImmediatePropagation())},this.handleFormReset=()=>{this.options.setValue(this.host,this.options.defaultValue(this.host)),this.setUserInteracted(this.host,!1),er.set(this.host,[])},this.handleInteraction=s=>{let n=er.get(this.host);n.includes(s.type)||n.push(s.type),n.length===this.options.assumeInteractionOn.length&&this.setUserInteracted(this.host,!0)},this.checkFormValidity=()=>{if(this.form&&!this.form.noValidate){let s=this.form.querySelectorAll("*");for(let n of s)if(typeof n.checkValidity=="function"&&!n.checkValidity())return!1}return!0},this.reportFormValidity=()=>{if(this.form&&!this.form.noValidate){let s=this.form.querySelectorAll("*");for(let n of s)if(typeof n.reportValidity=="function"&&!n.reportValidity())return!1}return!0},(this.host=e).addController(this),this.options=$e({form:s=>{let n=s.form;if(n){let i=s.getRootNode().querySelector(`#${n}`);if(i)return i}return s.closest("form")},name:s=>s.name,value:s=>s.value,defaultValue:s=>s.defaultValue,disabled:s=>{var n;return(n=s.disabled)!=null?n:!1},reportValidity:s=>typeof s.reportValidity=="function"?s.reportValidity():!0,checkValidity:s=>typeof s.checkValidity=="function"?s.checkValidity():!0,setValue:(s,n)=>s.value=n,assumeInteractionOn:["sl-input"]},t)}hostConnected(){let e=this.options.form(this.host);e&&this.attachForm(e),er.set(this.host,[]),this.options.assumeInteractionOn.forEach(t=>{this.host.addEventListener(t,this.handleInteraction)})}hostDisconnected(){this.detachForm(),er.delete(this.host),this.options.assumeInteractionOn.forEach(e=>{this.host.removeEventListener(e,this.handleInteraction)})}hostUpdated(){let e=this.options.form(this.host);e||this.detachForm(),e&&this.form!==e&&(this.detachForm(),this.attachForm(e)),this.host.hasUpdated&&this.setValidity(this.host.validity.valid)}attachForm(e){e?(this.form=e,ls.has(this.form)?ls.get(this.form).add(this.host):ls.set(this.form,new Set([this.host])),this.form.addEventListener("formdata",this.handleFormData),this.form.addEventListener("submit",this.handleFormSubmit),this.form.addEventListener("reset",this.handleFormReset),cs.has(this.form)||(cs.set(this.form,this.form.reportValidity),this.form.reportValidity=()=>this.reportFormValidity()),hs.has(this.form)||(hs.set(this.form,this.form.checkValidity),this.form.checkValidity=()=>this.checkFormValidity())):this.form=void 0}detachForm(){if(!this.form)return;let e=ls.get(this.form);e&&(e.delete(this.host),e.size<=0&&(this.form.removeEventListener("formdata",this.handleFormData),this.form.removeEventListener("submit",this.handleFormSubmit),this.form.removeEventListener("reset",this.handleFormReset),cs.has(this.form)&&(this.form.reportValidity=cs.get(this.form),cs.delete(this.form)),hs.has(this.form)&&(this.form.checkValidity=hs.get(this.form),hs.delete(this.form)),this.form=void 0))}setUserInteracted(e,t){t?Wo.add(e):Wo.delete(e),e.requestUpdate()}doAction(e,t){if(this.form){let s=document.createElement("button");s.type=e,s.style.position="absolute",s.style.width="0",s.style.height="0",s.style.clipPath="inset(50%)",s.style.overflow="hidden",s.style.whiteSpace="nowrap",t&&(s.name=t.name,s.value=t.value,["formaction","formenctype","formmethod","formnovalidate","formtarget"].forEach(n=>{t.hasAttribute(n)&&s.setAttribute(n,t.getAttribute(n))})),this.form.append(s),s.click(),s.remove()}}getForm(){var e;return(e=this.form)!=null?e:null}reset(e){this.doAction("reset",e)}submit(e){this.doAction("submit",e)}setValidity(e){let t=this.host,s=!!Wo.has(t),n=!!t.required;t.toggleAttribute("data-required",n),t.toggleAttribute("data-optional",!n),t.toggleAttribute("data-invalid",!e),t.toggleAttribute("data-valid",e),t.toggleAttribute("data-user-invalid",!e&&s),t.toggleAttribute("data-user-valid",e&&s)}updateValidity(){let e=this.host;this.setValidity(e.validity.valid)}emitInvalidEvent(e){let t=new CustomEvent("sl-invalid",{bubbles:!1,composed:!1,cancelable:!0,detail:{}});e||t.preventDefault(),this.host.dispatchEvent(t)||e?.preventDefault()}},tr=Object.freeze({badInput:!1,customError:!1,patternMismatch:!1,rangeOverflow:!1,rangeUnderflow:!1,stepMismatch:!1,tooLong:!1,tooShort:!1,typeMismatch:!1,valid:!0,valueMissing:!1}),Nb=Object.freeze(mt($e({},tr),{valid:!1,valueMissing:!0})),Wb=Object.freeze(mt($e({},tr),{valid:!1,customError:!0}));var Ke=class{constructor(e,...t){this.slotNames=[],this.handleSlotChange=s=>{let n=s.target;(this.slotNames.includes("[default]")&&!n.name||n.name&&this.slotNames.includes(n.name))&&this.host.requestUpdate()},(this.host=e).addController(this),this.slotNames=t}hasDefaultSlot(){return[...this.host.childNodes].some(e=>{if(e.nodeType===e.TEXT_NODE&&e.textContent.trim()!=="")return!0;if(e.nodeType===e.ELEMENT_NODE){let t=e;if(t.tagName.toLowerCase()==="sl-visually-hidden")return!1;if(!t.hasAttribute("slot"))return!0}return!1})}hasNamedSlot(e){return this.host.querySelector(`:scope > [slot="${e}"]`)!==null}test(e){return e==="[default]"?this.hasDefaultSlot():this.hasNamedSlot(e)}hostConnected(){this.host.shadowRoot.addEventListener("slotchange",this.handleSlotChange)}hostDisconnected(){this.host.shadowRoot.removeEventListener("slotchange",this.handleSlotChange)}};var le=class extends Q{constructor(){super(...arguments),this.formControlController=new Rt(this,{assumeInteractionOn:["sl-blur","sl-input"]}),this.hasSlotController=new Ke(this,"help-text","label"),this.localize=new _e(this),this.typeToSelectString="",this.hasFocus=!1,this.displayLabel="",this.selectedOptions=[],this.valueHasChanged=!1,this.name="",this._value="",this.defaultValue="",this.size="medium",this.placeholder="",this.multiple=!1,this.maxOptionsVisible=3,this.disabled=!1,this.clearable=!1,this.open=!1,this.hoist=!1,this.filled=!1,this.pill=!1,this.label="",this.placement="bottom",this.helpText="",this.form="",this.required=!1,this.getTag=e=>I`
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
    `,this.handleDocumentFocusIn=e=>{let t=e.composedPath();this&&!t.includes(this)&&this.hide()},this.handleDocumentKeyDown=e=>{let t=e.target,s=t.closest(".select__clear")!==null,n=t.closest("sl-icon-button")!==null;if(!(s||n)){if(e.key==="Escape"&&this.open&&!this.closeWatcher&&(e.preventDefault(),e.stopPropagation(),this.hide(),this.displayInput.focus({preventScroll:!0})),e.key==="Enter"||e.key===" "&&this.typeToSelectString===""){if(e.preventDefault(),e.stopImmediatePropagation(),!this.open){this.show();return}this.currentOption&&!this.currentOption.disabled&&(this.valueHasChanged=!0,this.multiple?this.toggleOptionSelection(this.currentOption):this.setSelectedOptions(this.currentOption),this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}),this.multiple||(this.hide(),this.displayInput.focus({preventScroll:!0})));return}if(["ArrowUp","ArrowDown","Home","End"].includes(e.key)){let u=this.getAllOptions(),i=u.indexOf(this.currentOption),r=Math.max(0,i);if(e.preventDefault(),!this.open&&(this.show(),this.currentOption))return;e.key==="ArrowDown"?(r=i+1,r>u.length-1&&(r=0)):e.key==="ArrowUp"?(r=i-1,r<0&&(r=u.length-1)):e.key==="Home"?r=0:e.key==="End"&&(r=u.length-1),this.setCurrentOption(u[r])}if(e.key&&e.key.length===1||e.key==="Backspace"){let u=this.getAllOptions();if(e.metaKey||e.ctrlKey||e.altKey)return;if(!this.open){if(e.key==="Backspace")return;this.show()}e.stopPropagation(),e.preventDefault(),clearTimeout(this.typeToSelectTimeout),this.typeToSelectTimeout=window.setTimeout(()=>this.typeToSelectString="",1e3),e.key==="Backspace"?this.typeToSelectString=this.typeToSelectString.slice(0,-1):this.typeToSelectString+=e.key.toLowerCase();for(let i of u)if(i.getTextLabel().toLowerCase().startsWith(this.typeToSelectString)){this.setCurrentOption(i);break}}}},this.handleDocumentMouseDown=e=>{let t=e.composedPath();this&&!t.includes(this)&&this.hide()}}get value(){return this._value}set value(e){this.multiple?e=Array.isArray(e)?e:e.split(" "):e=Array.isArray(e)?e.join(" "):e,this._value!==e&&(this.valueHasChanged=!0,this._value=e)}get validity(){return this.valueInput.validity}get validationMessage(){return this.valueInput.validationMessage}connectedCallback(){super.connectedCallback(),setTimeout(()=>{this.handleDefaultSlotChange()}),this.open=!1}addOpenListeners(){var e;document.addEventListener("focusin",this.handleDocumentFocusIn),document.addEventListener("keydown",this.handleDocumentKeyDown),document.addEventListener("mousedown",this.handleDocumentMouseDown),this.getRootNode()!==document&&this.getRootNode().addEventListener("focusin",this.handleDocumentFocusIn),"CloseWatcher"in window&&((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>{this.open&&(this.hide(),this.displayInput.focus({preventScroll:!0}))})}removeOpenListeners(){var e;document.removeEventListener("focusin",this.handleDocumentFocusIn),document.removeEventListener("keydown",this.handleDocumentKeyDown),document.removeEventListener("mousedown",this.handleDocumentMouseDown),this.getRootNode()!==document&&this.getRootNode().removeEventListener("focusin",this.handleDocumentFocusIn),(e=this.closeWatcher)==null||e.destroy()}handleFocus(){this.hasFocus=!0,this.displayInput.setSelectionRange(0,0),this.emit("sl-focus")}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleLabelClick(){this.displayInput.focus()}handleComboboxMouseDown(e){let s=e.composedPath().some(n=>n instanceof Element&&n.tagName.toLowerCase()==="sl-icon-button");this.disabled||s||(e.preventDefault(),this.displayInput.focus({preventScroll:!0}),this.open=!this.open)}handleComboboxKeyDown(e){e.key!=="Tab"&&(e.stopPropagation(),this.handleDocumentKeyDown(e))}handleClearClick(e){e.stopPropagation(),this.valueHasChanged=!0,this.value!==""&&(this.setSelectedOptions([]),this.displayInput.focus({preventScroll:!0}),this.updateComplete.then(()=>{this.emit("sl-clear"),this.emit("sl-input"),this.emit("sl-change")}))}handleClearMouseDown(e){e.stopPropagation(),e.preventDefault()}handleOptionClick(e){let s=e.target.closest("sl-option"),n=this.value;s&&!s.disabled&&(this.valueHasChanged=!0,this.multiple?this.toggleOptionSelection(s):this.setSelectedOptions(s),this.updateComplete.then(()=>this.displayInput.focus({preventScroll:!0})),this.value!==n&&this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}),this.multiple||(this.hide(),this.displayInput.focus({preventScroll:!0})))}handleDefaultSlotChange(){customElements.get("sl-option")||customElements.whenDefined("sl-option").then(()=>this.handleDefaultSlotChange());let e=this.getAllOptions(),t=this.valueHasChanged?this.value:this.defaultValue,s=Array.isArray(t)?t:[t],n=[];e.forEach(u=>n.push(u.value)),this.setSelectedOptions(e.filter(u=>s.includes(u.value)))}handleTagRemove(e,t){e.stopPropagation(),this.valueHasChanged=!0,this.disabled||(this.toggleOptionSelection(t,!1),this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}))}getAllOptions(){return[...this.querySelectorAll("sl-option")]}getFirstOption(){return this.querySelector("sl-option")}setCurrentOption(e){this.getAllOptions().forEach(s=>{s.current=!1,s.tabIndex=-1}),e&&(this.currentOption=e,e.current=!0,e.tabIndex=0,e.focus())}setSelectedOptions(e){let t=this.getAllOptions(),s=Array.isArray(e)?e:[e];t.forEach(n=>n.selected=!1),s.length&&s.forEach(n=>n.selected=!0),this.selectionChanged()}toggleOptionSelection(e,t){t===!0||t===!1?e.selected=t:e.selected=!e.selected,this.selectionChanged()}selectionChanged(){var e,t,s;let n=this.getAllOptions();this.selectedOptions=n.filter(i=>i.selected);let u=this.valueHasChanged;if(this.multiple)this.value=this.selectedOptions.map(i=>i.value),this.placeholder&&this.value.length===0?this.displayLabel="":this.displayLabel=this.localize.term("numOptionsSelected",this.selectedOptions.length);else{let i=this.selectedOptions[0];this.value=(e=i?.value)!=null?e:"",this.displayLabel=(s=(t=i?.getTextLabel)==null?void 0:t.call(i))!=null?s:""}this.valueHasChanged=u,this.updateComplete.then(()=>{this.formControlController.updateValidity()})}get tags(){return this.selectedOptions.map((e,t)=>{if(t<this.maxOptionsVisible||this.maxOptionsVisible<=0){let s=this.getTag(e,t);return I`<div @sl-remove=${n=>this.handleTagRemove(n,e)}>
          ${typeof s=="string"?G(s):s}
        </div>`}else if(t===this.maxOptionsVisible)return I`<sl-tag size=${this.size}>+${this.selectedOptions.length-t}</sl-tag>`;return I``})}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleDisabledChange(){this.disabled&&(this.open=!1,this.handleOpenChange())}attributeChangedCallback(e,t,s){if(super.attributeChangedCallback(e,t,s),e==="value"){let n=this.valueHasChanged;this.value=this.defaultValue,this.valueHasChanged=n}}handleValueChange(){if(!this.valueHasChanged){let s=this.valueHasChanged;this.value=this.defaultValue,this.valueHasChanged=s}let e=this.getAllOptions(),t=Array.isArray(this.value)?this.value:[this.value];this.setSelectedOptions(e.filter(s=>t.includes(s.value)))}async handleOpenChange(){if(this.open&&!this.disabled){this.setCurrentOption(this.selectedOptions[0]||this.getFirstOption()),this.emit("sl-show"),this.addOpenListeners(),await Le(this),this.listbox.hidden=!1,this.popup.active=!0,requestAnimationFrame(()=>{this.setCurrentOption(this.currentOption)});let{keyframes:e,options:t}=Se(this,"select.show",{dir:this.localize.dir()});await Ce(this.popup.popup,e,t),this.currentOption&&ts(this.currentOption,this.listbox,"vertical","auto"),this.emit("sl-after-show")}else{this.emit("sl-hide"),this.removeOpenListeners(),await Le(this);let{keyframes:e,options:t}=Se(this,"select.hide",{dir:this.localize.dir()});await Ce(this.popup.popup,e,t),this.listbox.hidden=!0,this.popup.active=!1,this.emit("sl-after-hide")}}async show(){if(this.open||this.disabled){this.open=!1;return}return this.open=!0,Me(this,"sl-after-show")}async hide(){if(!this.open||this.disabled){this.open=!1;return}return this.open=!1,Me(this,"sl-after-hide")}checkValidity(){return this.valueInput.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.valueInput.reportValidity()}setCustomValidity(e){this.valueInput.setCustomValidity(e),this.formControlController.updateValidity()}focus(e){this.displayInput.focus(e)}blur(){this.displayInput.blur()}render(){let e=this.hasSlotController.test("label"),t=this.hasSlotController.test("help-text"),s=this.label?!0:!!e,n=this.helpText?!0:!!t,u=this.clearable&&!this.disabled&&this.value.length>0,i=this.placeholder&&this.value&&this.value.length<=0;return I`
      <div
        part="form-control"
        class=${oe({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-label":s,"form-control--has-help-text":n})}
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
            class=${oe({select:!0,"select--standard":!0,"select--filled":this.filled,"select--pill":this.pill,"select--open":this.open,"select--disabled":this.disabled,"select--multiple":this.multiple,"select--focused":this.hasFocus,"select--placeholder-visible":i,"select--top":this.placement==="top","select--bottom":this.placement==="bottom","select--small":this.size==="small","select--medium":this.size==="medium","select--large":this.size==="large"})}
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

              ${this.multiple?I`<div part="tags" class="select__tags">${this.tags}</div>`:""}

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

              ${u?I`
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
    `}};le.styles=[ne,wi,Ja];le.dependencies={"sl-icon":ye,"sl-popup":ue,"sl-tag":Dt};D([Z(".select")],le.prototype,"popup",2);D([Z(".select__combobox")],le.prototype,"combobox",2);D([Z(".select__display-input")],le.prototype,"displayInput",2);D([Z(".select__value-input")],le.prototype,"valueInput",2);D([Z(".select__listbox")],le.prototype,"listbox",2);D([pe()],le.prototype,"hasFocus",2);D([pe()],le.prototype,"displayLabel",2);D([pe()],le.prototype,"currentOption",2);D([pe()],le.prototype,"selectedOptions",2);D([pe()],le.prototype,"valueHasChanged",2);D([P()],le.prototype,"name",2);D([pe()],le.prototype,"value",1);D([P({attribute:"value"})],le.prototype,"defaultValue",2);D([P({reflect:!0})],le.prototype,"size",2);D([P()],le.prototype,"placeholder",2);D([P({type:Boolean,reflect:!0})],le.prototype,"multiple",2);D([P({attribute:"max-options-visible",type:Number})],le.prototype,"maxOptionsVisible",2);D([P({type:Boolean,reflect:!0})],le.prototype,"disabled",2);D([P({type:Boolean})],le.prototype,"clearable",2);D([P({type:Boolean,reflect:!0})],le.prototype,"open",2);D([P({type:Boolean})],le.prototype,"hoist",2);D([P({type:Boolean,reflect:!0})],le.prototype,"filled",2);D([P({type:Boolean,reflect:!0})],le.prototype,"pill",2);D([P()],le.prototype,"label",2);D([P({reflect:!0})],le.prototype,"placement",2);D([P({attribute:"help-text"})],le.prototype,"helpText",2);D([P({reflect:!0})],le.prototype,"form",2);D([P({type:Boolean,reflect:!0})],le.prototype,"required",2);D([P()],le.prototype,"getTag",2);D([te("disabled",{waitUntilFirstUpdate:!0})],le.prototype,"handleDisabledChange",1);D([te(["defaultValue","value"],{waitUntilFirstUpdate:!0})],le.prototype,"handleValueChange",1);D([te("open",{waitUntilFirstUpdate:!0})],le.prototype,"handleOpenChange",1);we("select.show",{keyframes:[{opacity:0,scale:.9},{opacity:1,scale:1}],options:{duration:100,easing:"ease"}});we("select.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.9}],options:{duration:100,easing:"ease"}});le.define("sl-select");var Ol=J`
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
`;var ze=class extends Q{constructor(){super(...arguments),this.localize=new _e(this),this.isInitialized=!1,this.current=!1,this.selected=!1,this.hasHover=!1,this.value="",this.disabled=!1}connectedCallback(){super.connectedCallback(),this.setAttribute("role","option"),this.setAttribute("aria-selected","false")}handleDefaultSlotChange(){this.isInitialized?customElements.whenDefined("sl-select").then(()=>{let e=this.closest("sl-select");e&&e.handleDefaultSlotChange()}):this.isInitialized=!0}handleMouseEnter(){this.hasHover=!0}handleMouseLeave(){this.hasHover=!1}handleDisabledChange(){this.setAttribute("aria-disabled",this.disabled?"true":"false")}handleSelectedChange(){this.setAttribute("aria-selected",this.selected?"true":"false")}handleValueChange(){typeof this.value!="string"&&(this.value=String(this.value)),this.value.includes(" ")&&(console.error("Option values cannot include a space. All spaces have been replaced with underscores.",this),this.value=this.value.replace(/ /g,"_"))}getTextLabel(){let e=this.childNodes,t="";return[...e].forEach(s=>{s.nodeType===Node.ELEMENT_NODE&&(s.hasAttribute("slot")||(t+=s.textContent)),s.nodeType===Node.TEXT_NODE&&(t+=s.textContent)}),t.trim()}render(){return I`
      <div
        part="base"
        class=${oe({option:!0,"option--current":this.current,"option--disabled":this.disabled,"option--selected":this.selected,"option--hover":this.hasHover})}
        @mouseenter=${this.handleMouseEnter}
        @mouseleave=${this.handleMouseLeave}
      >
        <sl-icon part="checked-icon" class="option__check" name="check" library="system" aria-hidden="true"></sl-icon>
        <slot part="prefix" name="prefix" class="option__prefix"></slot>
        <slot part="label" class="option__label" @slotchange=${this.handleDefaultSlotChange}></slot>
        <slot part="suffix" name="suffix" class="option__suffix"></slot>
      </div>
    `}};ze.styles=[ne,Ol];ze.dependencies={"sl-icon":ye};D([Z(".option__label")],ze.prototype,"defaultSlot",2);D([pe()],ze.prototype,"current",2);D([pe()],ze.prototype,"selected",2);D([pe()],ze.prototype,"hasHover",2);D([P({reflect:!0})],ze.prototype,"value",2);D([P({type:Boolean,reflect:!0})],ze.prototype,"disabled",2);D([te("disabled")],ze.prototype,"handleDisabledChange",1);D([te("selected")],ze.prototype,"handleSelectedChange",1);D([te("value")],ze.prototype,"handleValueChange",1);ze.define("sl-option");var Ml=J`
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
`;var ir=(e="value")=>(t,s)=>{let n=t.constructor,u=n.prototype.attributeChangedCallback;n.prototype.attributeChangedCallback=function(i,r,l){var p;let d=n.getPropertyOptions(e),f=typeof d.attribute=="string"?d.attribute:e;if(i===f){let g=d.converter||Lt,b=(typeof g=="function"?g:(p=g?.fromAttribute)!=null?p:Lt.fromAttribute)(l,d.type);this[e]!==b&&(this[s]=b)}u.call(this,i,r,l)}};var sr=ni(class extends wt{constructor(e){if(super(e),e.type!==Xe.PROPERTY&&e.type!==Xe.ATTRIBUTE&&e.type!==Xe.BOOLEAN_ATTRIBUTE)throw Error("The `live` directive is not allowed on child or event bindings");if(!Va(e))throw Error("`live` bindings can only contain a single expression")}render(e){return e}update(e,[t]){if(t===De||t===V)return t;let s=e.element,n=e.name;if(e.type===Xe.PROPERTY){if(t===s[n])return De}else if(e.type===Xe.BOOLEAN_ATTRIBUTE){if(!!t===s.hasAttribute(n))return De}else if(e.type===Xe.ATTRIBUTE&&s.getAttribute(n)===t+"")return De;return qa(e),t}});var ie=class extends Q{constructor(){super(...arguments),this.formControlController=new Rt(this,{assumeInteractionOn:["sl-blur","sl-input"]}),this.hasSlotController=new Ke(this,"help-text","label"),this.localize=new _e(this),this.hasFocus=!1,this.title="",this.__numberInput=Object.assign(document.createElement("input"),{type:"number"}),this.__dateInput=Object.assign(document.createElement("input"),{type:"date"}),this.type="text",this.name="",this.value="",this.defaultValue="",this.size="medium",this.filled=!1,this.pill=!1,this.label="",this.helpText="",this.clearable=!1,this.disabled=!1,this.placeholder="",this.readonly=!1,this.passwordToggle=!1,this.passwordVisible=!1,this.noSpinButtons=!1,this.form="",this.required=!1,this.spellcheck=!0}get valueAsDate(){var e;return this.__dateInput.type=this.type,this.__dateInput.value=this.value,((e=this.input)==null?void 0:e.valueAsDate)||this.__dateInput.valueAsDate}set valueAsDate(e){this.__dateInput.type=this.type,this.__dateInput.valueAsDate=e,this.value=this.__dateInput.value}get valueAsNumber(){var e;return this.__numberInput.value=this.value,((e=this.input)==null?void 0:e.valueAsNumber)||this.__numberInput.valueAsNumber}set valueAsNumber(e){this.__numberInput.valueAsNumber=e,this.value=this.__numberInput.value}get validity(){return this.input.validity}get validationMessage(){return this.input.validationMessage}firstUpdated(){this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleChange(){this.value=this.input.value,this.emit("sl-change")}handleClearClick(e){e.preventDefault(),this.value!==""&&(this.value="",this.emit("sl-clear"),this.emit("sl-input"),this.emit("sl-change")),this.input.focus()}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleInput(){this.value=this.input.value,this.formControlController.updateValidity(),this.emit("sl-input")}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleKeyDown(e){let t=e.metaKey||e.ctrlKey||e.shiftKey||e.altKey;e.key==="Enter"&&!t&&setTimeout(()=>{!e.defaultPrevented&&!e.isComposing&&this.formControlController.submit()})}handlePasswordToggle(){this.passwordVisible=!this.passwordVisible}handleDisabledChange(){this.formControlController.setValidity(this.disabled)}handleStepChange(){this.input.step=String(this.step),this.formControlController.updateValidity()}async handleValueChange(){await this.updateComplete,this.formControlController.updateValidity()}focus(e){this.input.focus(e)}blur(){this.input.blur()}select(){this.input.select()}setSelectionRange(e,t,s="none"){this.input.setSelectionRange(e,t,s)}setRangeText(e,t,s,n="preserve"){let u=t??this.input.selectionStart,i=s??this.input.selectionEnd;this.input.setRangeText(e,u,i,n),this.value!==this.input.value&&(this.value=this.input.value)}showPicker(){"showPicker"in HTMLInputElement.prototype&&this.input.showPicker()}stepUp(){this.input.stepUp(),this.value!==this.input.value&&(this.value=this.input.value)}stepDown(){this.input.stepDown(),this.value!==this.input.value&&(this.value=this.input.value)}checkValidity(){return this.input.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.input.reportValidity()}setCustomValidity(e){this.input.setCustomValidity(e),this.formControlController.updateValidity()}render(){let e=this.hasSlotController.test("label"),t=this.hasSlotController.test("help-text"),s=this.label?!0:!!e,n=this.helpText?!0:!!t,i=this.clearable&&!this.disabled&&!this.readonly&&(typeof this.value=="number"||this.value.length>0);return I`
      <div
        part="form-control"
        class=${oe({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-label":s,"form-control--has-help-text":n})}
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
            class=${oe({input:!0,"input--small":this.size==="small","input--medium":this.size==="medium","input--large":this.size==="large","input--pill":this.pill,"input--standard":!this.filled,"input--filled":this.filled,"input--disabled":this.disabled,"input--focused":this.hasFocus,"input--empty":!this.value,"input--no-spin-buttons":this.noSpinButtons})}
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
              name=${se(this.name)}
              ?disabled=${this.disabled}
              ?readonly=${this.readonly}
              ?required=${this.required}
              placeholder=${se(this.placeholder)}
              minlength=${se(this.minlength)}
              maxlength=${se(this.maxlength)}
              min=${se(this.min)}
              max=${se(this.max)}
              step=${se(this.step)}
              .value=${sr(this.value)}
              autocapitalize=${se(this.autocapitalize)}
              autocomplete=${se(this.autocomplete)}
              autocorrect=${se(this.autocorrect)}
              ?autofocus=${this.autofocus}
              spellcheck=${this.spellcheck}
              pattern=${se(this.pattern)}
              enterkeyhint=${se(this.enterkeyhint)}
              inputmode=${se(this.inputmode)}
              aria-describedby="help-text"
              @change=${this.handleChange}
              @input=${this.handleInput}
              @invalid=${this.handleInvalid}
              @keydown=${this.handleKeyDown}
              @focus=${this.handleFocus}
              @blur=${this.handleBlur}
            />

            ${i?I`
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
            ${this.passwordToggle&&!this.disabled?I`
                  <button
                    part="password-toggle-button"
                    class="input__password-toggle"
                    type="button"
                    aria-label=${this.localize.term(this.passwordVisible?"hidePassword":"showPassword")}
                    @click=${this.handlePasswordToggle}
                    tabindex="-1"
                  >
                    ${this.passwordVisible?I`
                          <slot name="show-password-icon">
                            <sl-icon name="eye-slash" library="system"></sl-icon>
                          </slot>
                        `:I`
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
    `}};ie.styles=[ne,wi,Ml];ie.dependencies={"sl-icon":ye};D([Z(".input__control")],ie.prototype,"input",2);D([pe()],ie.prototype,"hasFocus",2);D([P()],ie.prototype,"title",2);D([P({reflect:!0})],ie.prototype,"type",2);D([P()],ie.prototype,"name",2);D([P()],ie.prototype,"value",2);D([ir()],ie.prototype,"defaultValue",2);D([P({reflect:!0})],ie.prototype,"size",2);D([P({type:Boolean,reflect:!0})],ie.prototype,"filled",2);D([P({type:Boolean,reflect:!0})],ie.prototype,"pill",2);D([P()],ie.prototype,"label",2);D([P({attribute:"help-text"})],ie.prototype,"helpText",2);D([P({type:Boolean})],ie.prototype,"clearable",2);D([P({type:Boolean,reflect:!0})],ie.prototype,"disabled",2);D([P()],ie.prototype,"placeholder",2);D([P({type:Boolean,reflect:!0})],ie.prototype,"readonly",2);D([P({attribute:"password-toggle",type:Boolean})],ie.prototype,"passwordToggle",2);D([P({attribute:"password-visible",type:Boolean})],ie.prototype,"passwordVisible",2);D([P({attribute:"no-spin-buttons",type:Boolean})],ie.prototype,"noSpinButtons",2);D([P({reflect:!0})],ie.prototype,"form",2);D([P({type:Boolean,reflect:!0})],ie.prototype,"required",2);D([P()],ie.prototype,"pattern",2);D([P({type:Number})],ie.prototype,"minlength",2);D([P({type:Number})],ie.prototype,"maxlength",2);D([P()],ie.prototype,"min",2);D([P()],ie.prototype,"max",2);D([P()],ie.prototype,"step",2);D([P()],ie.prototype,"autocapitalize",2);D([P()],ie.prototype,"autocorrect",2);D([P()],ie.prototype,"autocomplete",2);D([P({type:Boolean})],ie.prototype,"autofocus",2);D([P()],ie.prototype,"enterkeyhint",2);D([P({type:Boolean,converter:{fromAttribute:e=>!(!e||e==="false"),toAttribute:e=>e?"true":"false"}})],ie.prototype,"spellcheck",2);D([P()],ie.prototype,"inputmode",2);D([te("disabled",{waitUntilFirstUpdate:!0})],ie.prototype,"handleDisabledChange",1);D([te("step",{waitUntilFirstUpdate:!0})],ie.prototype,"handleStepChange",1);D([te("value",{waitUntilFirstUpdate:!0})],ie.prototype,"handleValueChange",1);ie.define("sl-input");var Bl=J`
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
`;var Uo=class extends Q{constructor(){super(...arguments),this.localize=new _e(this)}render(){return I`
      <svg part="base" class="spinner" role="progressbar" aria-label=${this.localize.term("loading")}>
        <circle class="spinner__track"></circle>
        <circle class="spinner__indicator"></circle>
      </svg>
    `}};Uo.styles=[ne,Bl];var Pl=J`
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
`;var ce=class extends Q{constructor(){super(...arguments),this.formControlController=new Rt(this,{assumeInteractionOn:["click"]}),this.hasSlotController=new Ke(this,"[default]","prefix","suffix"),this.localize=new _e(this),this.hasFocus=!1,this.invalid=!1,this.title="",this.variant="default",this.size="medium",this.caret=!1,this.disabled=!1,this.loading=!1,this.outline=!1,this.pill=!1,this.circle=!1,this.type="button",this.name="",this.value="",this.href="",this.rel="noreferrer noopener"}get validity(){return this.isButton()?this.button.validity:tr}get validationMessage(){return this.isButton()?this.button.validationMessage:""}firstUpdated(){this.isButton()&&this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleClick(){this.type==="submit"&&this.formControlController.submit(this),this.type==="reset"&&this.formControlController.reset(this)}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}isButton(){return!this.href}isLink(){return!!this.href}handleDisabledChange(){this.isButton()&&this.formControlController.setValidity(this.disabled)}click(){this.button.click()}focus(e){this.button.focus(e)}blur(){this.button.blur()}checkValidity(){return this.isButton()?this.button.checkValidity():!0}getForm(){return this.formControlController.getForm()}reportValidity(){return this.isButton()?this.button.reportValidity():!0}setCustomValidity(e){this.isButton()&&(this.button.setCustomValidity(e),this.formControlController.updateValidity())}render(){let e=this.isLink(),t=e?bi`a`:bi`button`;return yi`
      <${t}
        part="base"
        class=${oe({button:!0,"button--default":this.variant==="default","button--primary":this.variant==="primary","button--success":this.variant==="success","button--neutral":this.variant==="neutral","button--warning":this.variant==="warning","button--danger":this.variant==="danger","button--text":this.variant==="text","button--small":this.size==="small","button--medium":this.size==="medium","button--large":this.size==="large","button--caret":this.caret,"button--circle":this.circle,"button--disabled":this.disabled,"button--focused":this.hasFocus,"button--loading":this.loading,"button--standard":!this.outline,"button--outline":this.outline,"button--pill":this.pill,"button--rtl":this.localize.dir()==="rtl","button--has-label":this.hasSlotController.test("[default]"),"button--has-prefix":this.hasSlotController.test("prefix"),"button--has-suffix":this.hasSlotController.test("suffix")})}
        ?disabled=${se(e?void 0:this.disabled)}
        type=${se(e?void 0:this.type)}
        title=${this.title}
        name=${se(e?void 0:this.name)}
        value=${se(e?void 0:this.value)}
        href=${se(e&&!this.disabled?this.href:void 0)}
        target=${se(e?this.target:void 0)}
        download=${se(e?this.download:void 0)}
        rel=${se(e?this.rel:void 0)}
        role=${se(e?void 0:"button")}
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
        ${this.caret?yi` <sl-icon part="caret" class="button__caret" library="system" name="caret"></sl-icon> `:""}
        ${this.loading?yi`<sl-spinner part="spinner"></sl-spinner>`:""}
      </${t}>
    `}};ce.styles=[ne,Pl];ce.dependencies={"sl-icon":ye,"sl-spinner":Uo};D([Z(".button")],ce.prototype,"button",2);D([pe()],ce.prototype,"hasFocus",2);D([pe()],ce.prototype,"invalid",2);D([P()],ce.prototype,"title",2);D([P({reflect:!0})],ce.prototype,"variant",2);D([P({reflect:!0})],ce.prototype,"size",2);D([P({type:Boolean,reflect:!0})],ce.prototype,"caret",2);D([P({type:Boolean,reflect:!0})],ce.prototype,"disabled",2);D([P({type:Boolean,reflect:!0})],ce.prototype,"loading",2);D([P({type:Boolean,reflect:!0})],ce.prototype,"outline",2);D([P({type:Boolean,reflect:!0})],ce.prototype,"pill",2);D([P({type:Boolean,reflect:!0})],ce.prototype,"circle",2);D([P()],ce.prototype,"type",2);D([P()],ce.prototype,"name",2);D([P()],ce.prototype,"value",2);D([P()],ce.prototype,"href",2);D([P()],ce.prototype,"target",2);D([P()],ce.prototype,"rel",2);D([P()],ce.prototype,"download",2);D([P()],ce.prototype,"form",2);D([P({attribute:"formaction"})],ce.prototype,"formAction",2);D([P({attribute:"formenctype"})],ce.prototype,"formEnctype",2);D([P({attribute:"formmethod"})],ce.prototype,"formMethod",2);D([P({attribute:"formnovalidate",type:Boolean})],ce.prototype,"formNoValidate",2);D([P({attribute:"formtarget"})],ce.prototype,"formTarget",2);D([te("disabled",{waitUntilFirstUpdate:!0})],ce.prototype,"handleDisabledChange",1);ce.define("sl-button");var Il=J`
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
`;var Ei=class extends Q{constructor(){super(...arguments),this.variant="primary",this.pill=!1,this.pulse=!1}render(){return I`
      <span
        part="base"
        class=${oe({badge:!0,"badge--primary":this.variant==="primary","badge--success":this.variant==="success","badge--neutral":this.variant==="neutral","badge--warning":this.variant==="warning","badge--danger":this.variant==="danger","badge--pill":this.pill,"badge--pulse":this.pulse})}
        role="status"
      >
        <slot></slot>
      </span>
    `}};Ei.styles=[ne,Il];D([P({reflect:!0})],Ei.prototype,"variant",2);D([P({type:Boolean,reflect:!0})],Ei.prototype,"pill",2);D([P({type:Boolean,reflect:!0})],Ei.prototype,"pulse",2);Ei.define("sl-badge");var Hl=J`
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
`;var xe=class extends Q{constructor(){super(),this.localize=new _e(this),this.content="",this.placement="top",this.disabled=!1,this.distance=8,this.open=!1,this.skidding=0,this.trigger="hover focus",this.hoist=!1,this.handleBlur=()=>{this.hasTrigger("focus")&&this.hide()},this.handleClick=()=>{this.hasTrigger("click")&&(this.open?this.hide():this.show())},this.handleFocus=()=>{this.hasTrigger("focus")&&this.show()},this.handleDocumentKeyDown=e=>{e.key==="Escape"&&(e.stopPropagation(),this.hide())},this.handleMouseOver=()=>{if(this.hasTrigger("hover")){let e=wo(getComputedStyle(this).getPropertyValue("--show-delay"));clearTimeout(this.hoverTimeout),this.hoverTimeout=window.setTimeout(()=>this.show(),e)}},this.handleMouseOut=()=>{if(this.hasTrigger("hover")){let e=wo(getComputedStyle(this).getPropertyValue("--hide-delay"));clearTimeout(this.hoverTimeout),this.hoverTimeout=window.setTimeout(()=>this.hide(),e)}},this.addEventListener("blur",this.handleBlur,!0),this.addEventListener("focus",this.handleFocus,!0),this.addEventListener("click",this.handleClick),this.addEventListener("mouseover",this.handleMouseOver),this.addEventListener("mouseout",this.handleMouseOut)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this.closeWatcher)==null||e.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown)}firstUpdated(){this.body.hidden=!this.open,this.open&&(this.popup.active=!0,this.popup.reposition())}hasTrigger(e){return this.trigger.split(" ").includes(e)}async handleOpenChange(){var e,t;if(this.open){if(this.disabled)return;this.emit("sl-show"),"CloseWatcher"in window?((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>{this.hide()}):document.addEventListener("keydown",this.handleDocumentKeyDown),await Le(this.body),this.body.hidden=!1,this.popup.active=!0;let{keyframes:s,options:n}=Se(this,"tooltip.show",{dir:this.localize.dir()});await Ce(this.popup.popup,s,n),this.popup.reposition(),this.emit("sl-after-show")}else{this.emit("sl-hide"),(t=this.closeWatcher)==null||t.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown),await Le(this.body);let{keyframes:s,options:n}=Se(this,"tooltip.hide",{dir:this.localize.dir()});await Ce(this.popup.popup,s,n),this.popup.active=!1,this.body.hidden=!0,this.emit("sl-after-hide")}}async handleOptionsChange(){this.hasUpdated&&(await this.updateComplete,this.popup.reposition())}handleDisabledChange(){this.disabled&&this.open&&this.hide()}async show(){if(!this.open)return this.open=!0,Me(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,Me(this,"sl-after-hide")}render(){return I`
      <sl-popup
        part="base"
        exportparts="
          popup:base__popup,
          arrow:base__arrow
        "
        class=${oe({tooltip:!0,"tooltip--open":this.open})}
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
    `}};xe.styles=[ne,Hl];xe.dependencies={"sl-popup":ue};D([Z("slot:not([name])")],xe.prototype,"defaultSlot",2);D([Z(".tooltip__body")],xe.prototype,"body",2);D([Z("sl-popup")],xe.prototype,"popup",2);D([P()],xe.prototype,"content",2);D([P()],xe.prototype,"placement",2);D([P({type:Boolean,reflect:!0})],xe.prototype,"disabled",2);D([P({type:Number})],xe.prototype,"distance",2);D([P({type:Boolean,reflect:!0})],xe.prototype,"open",2);D([P({type:Number})],xe.prototype,"skidding",2);D([P()],xe.prototype,"trigger",2);D([P({type:Boolean})],xe.prototype,"hoist",2);D([te("open",{waitUntilFirstUpdate:!0})],xe.prototype,"handleOpenChange",1);D([te(["content","distance","hoist","placement","skidding"])],xe.prototype,"handleOptionsChange",1);D([te("disabled")],xe.prototype,"handleDisabledChange",1);we("tooltip.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:150,easing:"ease"}});we("tooltip.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:150,easing:"ease"}});xe.define("sl-tooltip");function*rr(e=document.activeElement){e!=null&&(yield e,"shadowRoot"in e&&e.shadowRoot&&e.shadowRoot.mode!=="closed"&&(yield*La(rr(e.shadowRoot.activeElement))))}function zl(){return[...rr()].pop()}var Fl=new WeakMap;function Nl(e){let t=Fl.get(e);return t||(t=window.getComputedStyle(e,null),Fl.set(e,t)),t}function Kd(e){if(typeof e.checkVisibility=="function")return e.checkVisibility({checkOpacity:!1,checkVisibilityCSS:!0});let t=Nl(e);return t.visibility!=="hidden"&&t.display!=="none"}function Gd(e){let t=Nl(e),{overflowY:s,overflowX:n}=t;return s==="scroll"||n==="scroll"?!0:s!=="auto"||n!=="auto"?!1:e.scrollHeight>e.clientHeight&&s==="auto"||e.scrollWidth>e.clientWidth&&n==="auto"}function Xd(e){let t=e.tagName.toLowerCase(),s=Number(e.getAttribute("tabindex"));if(e.hasAttribute("tabindex")&&(isNaN(s)||s<=-1)||e.hasAttribute("disabled")||e.closest("[inert]"))return!1;if(t==="input"&&e.getAttribute("type")==="radio"){let i=e.getRootNode(),r=`input[type='radio'][name="${e.getAttribute("name")}"]`,l=i.querySelector(`${r}:checked`);return l?l===e:i.querySelector(r)===e}return Kd(e)?(t==="audio"||t==="video")&&e.hasAttribute("controls")||e.hasAttribute("tabindex")||e.hasAttribute("contenteditable")&&e.getAttribute("contenteditable")!=="false"||["button","input","select","textarea","a","audio","video","summary","iframe"].includes(t)?!0:Gd(e):!1}function Yd(e,t){var s;return((s=e.getRootNode({composed:!0}))==null?void 0:s.host)!==t}function jo(e){let t=new WeakMap,s=[];function n(u){if(u instanceof Element){if(u.hasAttribute("inert")||u.closest("[inert]")||t.has(u))return;t.set(u,!0),!s.includes(u)&&Xd(u)&&s.push(u),u instanceof HTMLSlotElement&&Yd(u,e)&&u.assignedElements({flatten:!0}).forEach(i=>{n(i)}),u.shadowRoot!==null&&u.shadowRoot.mode==="open"&&n(u.shadowRoot)}for(let i of u.children)n(i)}return n(e),s.sort((u,i)=>{let r=Number(u.getAttribute("tabindex"))||0;return(Number(i.getAttribute("tabindex"))||0)-r})}var ds=[],Wl=class{constructor(e){this.tabDirection="forward",this.handleFocusIn=()=>{this.isActive()&&this.checkFocus()},this.handleKeyDown=t=>{var s;if(t.key!=="Tab"||this.isExternalActivated||!this.isActive())return;let n=zl();if(this.previousFocus=n,this.previousFocus&&this.possiblyHasTabbableChildren(this.previousFocus))return;t.shiftKey?this.tabDirection="backward":this.tabDirection="forward";let u=jo(this.element),i=u.findIndex(l=>l===n);this.previousFocus=this.currentFocus;let r=this.tabDirection==="forward"?1:-1;for(;;){i+r>=u.length?i=0:i+r<0?i=u.length-1:i+=r,this.previousFocus=this.currentFocus;let l=u[i];if(this.tabDirection==="backward"&&this.previousFocus&&this.possiblyHasTabbableChildren(this.previousFocus)||l&&this.possiblyHasTabbableChildren(l))return;t.preventDefault(),this.currentFocus=l,(s=this.currentFocus)==null||s.focus({preventScroll:!1});let p=[...rr()];if(p.includes(this.currentFocus)||!p.includes(this.previousFocus))break}setTimeout(()=>this.checkFocus())},this.handleKeyUp=()=>{this.tabDirection="forward"},this.element=e,this.elementsWithTabbableControls=["iframe"]}activate(){ds.push(this.element),document.addEventListener("focusin",this.handleFocusIn),document.addEventListener("keydown",this.handleKeyDown),document.addEventListener("keyup",this.handleKeyUp)}deactivate(){ds=ds.filter(e=>e!==this.element),this.currentFocus=null,document.removeEventListener("focusin",this.handleFocusIn),document.removeEventListener("keydown",this.handleKeyDown),document.removeEventListener("keyup",this.handleKeyUp)}isActive(){return ds[ds.length-1]===this.element}activateExternal(){this.isExternalActivated=!0}deactivateExternal(){this.isExternalActivated=!1}checkFocus(){if(this.isActive()&&!this.isExternalActivated){let e=jo(this.element);if(!this.element.matches(":focus-within")){let t=e[0],s=e[e.length-1],n=this.tabDirection==="forward"?t:s;typeof n?.focus=="function"&&(this.currentFocus=n,n.focus({preventScroll:!1}))}}}possiblyHasTabbableChildren(e){return this.elementsWithTabbableControls.includes(e.tagName.toLowerCase())||e.hasAttribute("controls")}};var Ul=J`
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
`;var or=e=>{var t;let{activeElement:s}=document;s&&e.contains(s)&&((t=document.activeElement)==null||t.blur())};var Qe=class extends Q{constructor(){super(...arguments),this.hasSlotController=new Ke(this,"footer"),this.localize=new _e(this),this.modal=new Wl(this),this.open=!1,this.label="",this.noHeader=!1,this.handleDocumentKeyDown=e=>{e.key==="Escape"&&this.modal.isActive()&&this.open&&(e.stopPropagation(),this.requestClose("keyboard"))}}firstUpdated(){this.dialog.hidden=!this.open,this.open&&(this.addOpenListeners(),this.modal.activate(),Oo(this))}disconnectedCallback(){super.disconnectedCallback(),this.modal.deactivate(),Mo(this),this.removeOpenListeners()}requestClose(e){if(this.emit("sl-request-close",{cancelable:!0,detail:{source:e}}).defaultPrevented){let s=Se(this,"dialog.denyClose",{dir:this.localize.dir()});Ce(this.panel,s.keyframes,s.options);return}this.hide()}addOpenListeners(){var e;"CloseWatcher"in window?((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>this.requestClose("keyboard")):document.addEventListener("keydown",this.handleDocumentKeyDown)}removeOpenListeners(){var e;(e=this.closeWatcher)==null||e.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown)}async handleOpenChange(){if(this.open){this.emit("sl-show"),this.addOpenListeners(),this.originalTrigger=document.activeElement,this.modal.activate(),Oo(this);let e=this.querySelector("[autofocus]");e&&e.removeAttribute("autofocus"),await Promise.all([Le(this.dialog),Le(this.overlay)]),this.dialog.hidden=!1,requestAnimationFrame(()=>{this.emit("sl-initial-focus",{cancelable:!0}).defaultPrevented||(e?e.focus({preventScroll:!0}):this.panel.focus({preventScroll:!0})),e&&e.setAttribute("autofocus","")});let t=Se(this,"dialog.show",{dir:this.localize.dir()}),s=Se(this,"dialog.overlay.show",{dir:this.localize.dir()});await Promise.all([Ce(this.panel,t.keyframes,t.options),Ce(this.overlay,s.keyframes,s.options)]),this.emit("sl-after-show")}else{or(this),this.emit("sl-hide"),this.removeOpenListeners(),this.modal.deactivate(),await Promise.all([Le(this.dialog),Le(this.overlay)]);let e=Se(this,"dialog.hide",{dir:this.localize.dir()}),t=Se(this,"dialog.overlay.hide",{dir:this.localize.dir()});await Promise.all([Ce(this.overlay,t.keyframes,t.options).then(()=>{this.overlay.hidden=!0}),Ce(this.panel,e.keyframes,e.options).then(()=>{this.panel.hidden=!0})]),this.dialog.hidden=!0,this.overlay.hidden=!1,this.panel.hidden=!1,Mo(this);let s=this.originalTrigger;typeof s?.focus=="function"&&setTimeout(()=>s.focus()),this.emit("sl-after-hide")}}async show(){if(!this.open)return this.open=!0,Me(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,Me(this,"sl-after-hide")}render(){return I`
      <div
        part="base"
        class=${oe({dialog:!0,"dialog--open":this.open,"dialog--has-footer":this.hasSlotController.test("footer")})}
      >
        <div part="overlay" class="dialog__overlay" @click=${()=>this.requestClose("overlay")} tabindex="-1"></div>

        <div
          part="panel"
          class="dialog__panel"
          role="dialog"
          aria-modal="true"
          aria-hidden=${this.open?"false":"true"}
          aria-label=${se(this.noHeader?this.label:void 0)}
          aria-labelledby=${se(this.noHeader?void 0:"title")}
          tabindex="-1"
        >
          ${this.noHeader?"":I`
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
    `}};Qe.styles=[ne,Ul];Qe.dependencies={"sl-icon-button":be};D([Z(".dialog")],Qe.prototype,"dialog",2);D([Z(".dialog__panel")],Qe.prototype,"panel",2);D([Z(".dialog__overlay")],Qe.prototype,"overlay",2);D([P({type:Boolean,reflect:!0})],Qe.prototype,"open",2);D([P({reflect:!0})],Qe.prototype,"label",2);D([P({attribute:"no-header",type:Boolean,reflect:!0})],Qe.prototype,"noHeader",2);D([te("open",{waitUntilFirstUpdate:!0})],Qe.prototype,"handleOpenChange",1);we("dialog.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:250,easing:"ease"}});we("dialog.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:250,easing:"ease"}});we("dialog.denyClose",{keyframes:[{scale:1},{scale:1.02},{scale:1}],options:{duration:250}});we("dialog.overlay.show",{keyframes:[{opacity:0},{opacity:1}],options:{duration:250}});we("dialog.overlay.hide",{keyframes:[{opacity:1},{opacity:0}],options:{duration:250}});Qe.define("sl-dialog");var jl=J`
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
`;var Vl=J`
  :host {
    display: contents;
  }
`;var us=class extends Q{constructor(){super(...arguments),this.observedElements=[],this.disabled=!1}connectedCallback(){super.connectedCallback(),this.resizeObserver=new ResizeObserver(e=>{this.emit("sl-resize",{detail:{entries:e}})}),this.disabled||this.startObserver()}disconnectedCallback(){super.disconnectedCallback(),this.stopObserver()}handleSlotChange(){this.disabled||this.startObserver()}startObserver(){let e=this.shadowRoot.querySelector("slot");if(e!==null){let t=e.assignedElements({flatten:!0});this.observedElements.forEach(s=>this.resizeObserver.unobserve(s)),this.observedElements=[],t.forEach(s=>{this.resizeObserver.observe(s),this.observedElements.push(s)})}}stopObserver(){this.resizeObserver.disconnect()}handleDisabledChange(){this.disabled?this.stopObserver():this.startObserver()}render(){return I` <slot @slotchange=${this.handleSlotChange}></slot> `}};us.styles=[ne,Vl];D([P({type:Boolean,reflect:!0})],us.prototype,"disabled",2);D([te("disabled",{waitUntilFirstUpdate:!0})],us.prototype,"handleDisabledChange",1);var ke=class extends Q{constructor(){super(...arguments),this.tabs=[],this.focusableTabs=[],this.panels=[],this.localize=new _e(this),this.hasScrollControls=!1,this.shouldHideScrollStartButton=!1,this.shouldHideScrollEndButton=!1,this.placement="top",this.activation="auto",this.noScrollControls=!1,this.fixedScrollControls=!1,this.scrollOffset=1}connectedCallback(){let e=Promise.all([customElements.whenDefined("sl-tab"),customElements.whenDefined("sl-tab-panel")]);super.connectedCallback(),this.resizeObserver=new ResizeObserver(()=>{this.repositionIndicator(),this.updateScrollControls()}),this.mutationObserver=new MutationObserver(t=>{let s=t.filter(({target:n})=>{if(n===this)return!0;if(n.closest("sl-tab-group")!==this)return!1;let u=n.tagName.toLowerCase();return u==="sl-tab"||u==="sl-tab-panel"});if(s.length!==0){if(s.some(n=>!["aria-labelledby","aria-controls"].includes(n.attributeName))&&setTimeout(()=>this.setAriaLabels()),s.some(n=>n.attributeName==="disabled"))this.syncTabsAndPanels();else if(s.some(n=>n.attributeName==="active")){let u=s.filter(i=>i.attributeName==="active"&&i.target.tagName.toLowerCase()==="sl-tab").map(i=>i.target).find(i=>i.active);u&&this.setActiveTab(u)}}}),this.updateComplete.then(()=>{this.syncTabsAndPanels(),this.mutationObserver.observe(this,{attributes:!0,attributeFilter:["active","disabled","name","panel"],childList:!0,subtree:!0}),this.resizeObserver.observe(this.nav),e.then(()=>{new IntersectionObserver((s,n)=>{var u;s[0].intersectionRatio>0&&(this.setAriaLabels(),this.setActiveTab((u=this.getActiveTab())!=null?u:this.tabs[0],{emitEvents:!1}),n.unobserve(s[0].target))}).observe(this.tabGroup)})})}disconnectedCallback(){var e,t;super.disconnectedCallback(),(e=this.mutationObserver)==null||e.disconnect(),this.nav&&((t=this.resizeObserver)==null||t.unobserve(this.nav))}getAllTabs(){return this.shadowRoot.querySelector('slot[name="nav"]').assignedElements()}getAllPanels(){return[...this.body.assignedElements()].filter(e=>e.tagName.toLowerCase()==="sl-tab-panel")}getActiveTab(){return this.tabs.find(e=>e.active)}handleClick(e){let s=e.target.closest("sl-tab");s?.closest("sl-tab-group")===this&&s!==null&&this.setActiveTab(s,{scrollBehavior:"smooth"})}handleKeyDown(e){let s=e.target.closest("sl-tab");if(s?.closest("sl-tab-group")===this&&(["Enter"," "].includes(e.key)&&s!==null&&(this.setActiveTab(s,{scrollBehavior:"smooth"}),e.preventDefault()),["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key))){let u=this.tabs.find(l=>l.matches(":focus")),i=this.localize.dir()==="rtl",r=null;if(u?.tagName.toLowerCase()==="sl-tab"){if(e.key==="Home")r=this.focusableTabs[0];else if(e.key==="End")r=this.focusableTabs[this.focusableTabs.length-1];else if(["top","bottom"].includes(this.placement)&&e.key===(i?"ArrowRight":"ArrowLeft")||["start","end"].includes(this.placement)&&e.key==="ArrowUp"){let l=this.tabs.findIndex(p=>p===u);r=this.findNextFocusableTab(l,"backward")}else if(["top","bottom"].includes(this.placement)&&e.key===(i?"ArrowLeft":"ArrowRight")||["start","end"].includes(this.placement)&&e.key==="ArrowDown"){let l=this.tabs.findIndex(p=>p===u);r=this.findNextFocusableTab(l,"forward")}if(!r)return;r.tabIndex=0,r.focus({preventScroll:!0}),this.activation==="auto"?this.setActiveTab(r,{scrollBehavior:"smooth"}):this.tabs.forEach(l=>{l.tabIndex=l===r?0:-1}),["top","bottom"].includes(this.placement)&&ts(r,this.nav,"horizontal"),e.preventDefault()}}}handleScrollToStart(){this.nav.scroll({left:this.localize.dir()==="rtl"?this.nav.scrollLeft+this.nav.clientWidth:this.nav.scrollLeft-this.nav.clientWidth,behavior:"smooth"})}handleScrollToEnd(){this.nav.scroll({left:this.localize.dir()==="rtl"?this.nav.scrollLeft-this.nav.clientWidth:this.nav.scrollLeft+this.nav.clientWidth,behavior:"smooth"})}setActiveTab(e,t){if(t=$e({emitEvents:!0,scrollBehavior:"auto"},t),e!==this.activeTab&&!e.disabled){let s=this.activeTab;this.activeTab=e,this.tabs.forEach(n=>{n.active=n===this.activeTab,n.tabIndex=n===this.activeTab?0:-1}),this.panels.forEach(n=>{var u;return n.active=n.name===((u=this.activeTab)==null?void 0:u.panel)}),this.syncIndicator(),["top","bottom"].includes(this.placement)&&ts(this.activeTab,this.nav,"horizontal",t.scrollBehavior),t.emitEvents&&(s&&this.emit("sl-tab-hide",{detail:{name:s.panel}}),this.emit("sl-tab-show",{detail:{name:this.activeTab.panel}}))}}setAriaLabels(){this.tabs.forEach(e=>{let t=this.panels.find(s=>s.name===e.panel);t&&(e.setAttribute("aria-controls",t.getAttribute("id")),t.setAttribute("aria-labelledby",e.getAttribute("id")))})}repositionIndicator(){let e=this.getActiveTab();if(!e)return;let t=e.clientWidth,s=e.clientHeight,n=this.localize.dir()==="rtl",u=this.getAllTabs(),r=u.slice(0,u.indexOf(e)).reduce((l,p)=>({left:l.left+p.clientWidth,top:l.top+p.clientHeight}),{left:0,top:0});switch(this.placement){case"top":case"bottom":this.indicator.style.width=`${t}px`,this.indicator.style.height="auto",this.indicator.style.translate=n?`${-1*r.left}px`:`${r.left}px`;break;case"start":case"end":this.indicator.style.width="auto",this.indicator.style.height=`${s}px`,this.indicator.style.translate=`0 ${r.top}px`;break}}syncTabsAndPanels(){this.tabs=this.getAllTabs(),this.focusableTabs=this.tabs.filter(e=>!e.disabled),this.panels=this.getAllPanels(),this.syncIndicator(),this.updateComplete.then(()=>this.updateScrollControls())}findNextFocusableTab(e,t){let s=null,n=t==="forward"?1:-1,u=e+n;for(;e<this.tabs.length;){if(s=this.tabs[u]||null,s===null){t==="forward"?s=this.focusableTabs[0]:s=this.focusableTabs[this.focusableTabs.length-1];break}if(!s.disabled)break;u+=n}return s}updateScrollButtons(){this.hasScrollControls&&!this.fixedScrollControls&&(this.shouldHideScrollStartButton=this.scrollFromStart()<=this.scrollOffset,this.shouldHideScrollEndButton=this.isScrolledToEnd())}isScrolledToEnd(){return this.scrollFromStart()+this.nav.clientWidth>=this.nav.scrollWidth-this.scrollOffset}scrollFromStart(){return this.localize.dir()==="rtl"?-this.nav.scrollLeft:this.nav.scrollLeft}updateScrollControls(){this.noScrollControls?this.hasScrollControls=!1:this.hasScrollControls=["top","bottom"].includes(this.placement)&&this.nav.scrollWidth>this.nav.clientWidth+1,this.updateScrollButtons()}syncIndicator(){this.getActiveTab()?(this.indicator.style.display="block",this.repositionIndicator()):this.indicator.style.display="none"}show(e){let t=this.tabs.find(s=>s.panel===e);t&&this.setActiveTab(t,{scrollBehavior:"smooth"})}render(){let e=this.localize.dir()==="rtl";return I`
      <div
        part="base"
        class=${oe({"tab-group":!0,"tab-group--top":this.placement==="top","tab-group--bottom":this.placement==="bottom","tab-group--start":this.placement==="start","tab-group--end":this.placement==="end","tab-group--rtl":this.localize.dir()==="rtl","tab-group--has-scroll-controls":this.hasScrollControls})}
        @click=${this.handleClick}
        @keydown=${this.handleKeyDown}
      >
        <div class="tab-group__nav-container" part="nav">
          ${this.hasScrollControls?I`
                <sl-icon-button
                  part="scroll-button scroll-button--start"
                  exportparts="base:scroll-button__base"
                  class=${oe({"tab-group__scroll-button":!0,"tab-group__scroll-button--start":!0,"tab-group__scroll-button--start--hidden":this.shouldHideScrollStartButton})}
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

          ${this.hasScrollControls?I`
                <sl-icon-button
                  part="scroll-button scroll-button--end"
                  exportparts="base:scroll-button__base"
                  class=${oe({"tab-group__scroll-button":!0,"tab-group__scroll-button--end":!0,"tab-group__scroll-button--end--hidden":this.shouldHideScrollEndButton})}
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
    `}};ke.styles=[ne,jl];ke.dependencies={"sl-icon-button":be,"sl-resize-observer":us};D([Z(".tab-group")],ke.prototype,"tabGroup",2);D([Z(".tab-group__body")],ke.prototype,"body",2);D([Z(".tab-group__nav")],ke.prototype,"nav",2);D([Z(".tab-group__indicator")],ke.prototype,"indicator",2);D([pe()],ke.prototype,"hasScrollControls",2);D([pe()],ke.prototype,"shouldHideScrollStartButton",2);D([pe()],ke.prototype,"shouldHideScrollEndButton",2);D([P()],ke.prototype,"placement",2);D([P()],ke.prototype,"activation",2);D([P({attribute:"no-scroll-controls",type:Boolean})],ke.prototype,"noScrollControls",2);D([P({attribute:"fixed-scroll-controls",type:Boolean})],ke.prototype,"fixedScrollControls",2);D([Ua({passive:!0})],ke.prototype,"updateScrollButtons",1);D([te("noScrollControls",{waitUntilFirstUpdate:!0})],ke.prototype,"updateScrollControls",1);D([te("placement",{waitUntilFirstUpdate:!0})],ke.prototype,"syncIndicator",1);ke.define("sl-tab-group");var Jd=(e,t)=>{let s=0;return function(...n){window.clearTimeout(s),s=window.setTimeout(()=>{e.call(this,...n)},t)}},ql=(e,t,s)=>{let n=e[t];e[t]=function(...u){n.call(this,...u),s.call(this,n,...u)}};(()=>{if(typeof window>"u")return;if(!("onscrollend"in window)){let t=new Set,s=new WeakMap,n=i=>{for(let r of i.changedTouches)t.add(r.identifier)},u=i=>{for(let r of i.changedTouches)t.delete(r.identifier)};document.addEventListener("touchstart",n,!0),document.addEventListener("touchend",u,!0),document.addEventListener("touchcancel",u,!0),ql(EventTarget.prototype,"addEventListener",function(i,r){if(r!=="scrollend")return;let l=Jd(()=>{t.size?l():this.dispatchEvent(new Event("scrollend"))},100);i.call(this,"scroll",l,{passive:!0}),s.set(this,l)}),ql(EventTarget.prototype,"removeEventListener",function(i,r){if(r!=="scrollend")return;let l=s.get(this);l&&i.call(this,"scroll",l,{passive:!0})})}})();var Kl=J`
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
`;var Zd=0,Ge=class extends Q{constructor(){super(...arguments),this.localize=new _e(this),this.attrId=++Zd,this.componentId=`sl-tab-${this.attrId}`,this.panel="",this.active=!1,this.closable=!1,this.disabled=!1,this.tabIndex=0}connectedCallback(){super.connectedCallback(),this.setAttribute("role","tab")}handleCloseClick(e){e.stopPropagation(),this.emit("sl-close")}handleActiveChange(){this.setAttribute("aria-selected",this.active?"true":"false")}handleDisabledChange(){this.setAttribute("aria-disabled",this.disabled?"true":"false"),this.disabled&&!this.active?this.tabIndex=-1:this.tabIndex=0}render(){return this.id=this.id.length>0?this.id:this.componentId,I`
      <div
        part="base"
        class=${oe({tab:!0,"tab--active":this.active,"tab--closable":this.closable,"tab--disabled":this.disabled})}
      >
        <slot></slot>
        ${this.closable?I`
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
    `}};Ge.styles=[ne,Kl];Ge.dependencies={"sl-icon-button":be};D([Z(".tab")],Ge.prototype,"tab",2);D([P({reflect:!0})],Ge.prototype,"panel",2);D([P({type:Boolean,reflect:!0})],Ge.prototype,"active",2);D([P({type:Boolean,reflect:!0})],Ge.prototype,"closable",2);D([P({type:Boolean,reflect:!0})],Ge.prototype,"disabled",2);D([P({type:Number,reflect:!0})],Ge.prototype,"tabIndex",2);D([te("active")],Ge.prototype,"handleActiveChange",1);D([te("disabled")],Ge.prototype,"handleDisabledChange",1);Ge.define("sl-tab");var Gl=J`
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
`;var Qd=0,Ai=class extends Q{constructor(){super(...arguments),this.attrId=++Qd,this.componentId=`sl-tab-panel-${this.attrId}`,this.name="",this.active=!1}connectedCallback(){super.connectedCallback(),this.id=this.id.length>0?this.id:this.componentId,this.setAttribute("role","tabpanel")}handleActiveChange(){this.setAttribute("aria-hidden",this.active?"false":"true")}render(){return I`
      <slot
        part="base"
        class=${oe({"tab-panel":!0,"tab-panel--active":this.active})}
      ></slot>
    `}};Ai.styles=[ne,Gl];D([P({reflect:!0})],Ai.prototype,"name",2);D([P({type:Boolean,reflect:!0})],Ai.prototype,"active",2);D([te("active")],Ai.prototype,"handleActiveChange",1);Ai.define("sl-tab-panel");var Xl=J`
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
`;var Te=class extends Q{constructor(){super(...arguments),this.formControlController=new Rt(this,{value:e=>e.checked?e.value||"on":void 0,defaultValue:e=>e.defaultChecked,setValue:(e,t)=>e.checked=t}),this.hasSlotController=new Ke(this,"help-text"),this.hasFocus=!1,this.title="",this.name="",this.size="medium",this.disabled=!1,this.checked=!1,this.defaultChecked=!1,this.form="",this.required=!1,this.helpText=""}get validity(){return this.input.validity}get validationMessage(){return this.input.validationMessage}firstUpdated(){this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleInput(){this.emit("sl-input")}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleClick(){this.checked=!this.checked,this.emit("sl-change")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleKeyDown(e){e.key==="ArrowLeft"&&(e.preventDefault(),this.checked=!1,this.emit("sl-change"),this.emit("sl-input")),e.key==="ArrowRight"&&(e.preventDefault(),this.checked=!0,this.emit("sl-change"),this.emit("sl-input"))}handleCheckedChange(){this.input.checked=this.checked,this.formControlController.updateValidity()}handleDisabledChange(){this.formControlController.setValidity(!0)}click(){this.input.click()}focus(e){this.input.focus(e)}blur(){this.input.blur()}checkValidity(){return this.input.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.input.reportValidity()}setCustomValidity(e){this.input.setCustomValidity(e),this.formControlController.updateValidity()}render(){let e=this.hasSlotController.test("help-text"),t=this.helpText?!0:!!e;return I`
      <div
        class=${oe({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-help-text":t})}
      >
        <label
          part="base"
          class=${oe({switch:!0,"switch--checked":this.checked,"switch--disabled":this.disabled,"switch--focused":this.hasFocus,"switch--small":this.size==="small","switch--medium":this.size==="medium","switch--large":this.size==="large"})}
        >
          <input
            class="switch__input"
            type="checkbox"
            title=${this.title}
            name=${this.name}
            value=${se(this.value)}
            .checked=${sr(this.checked)}
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
    `}};Te.styles=[ne,wi,Xl];D([Z('input[type="checkbox"]')],Te.prototype,"input",2);D([pe()],Te.prototype,"hasFocus",2);D([P()],Te.prototype,"title",2);D([P()],Te.prototype,"name",2);D([P()],Te.prototype,"value",2);D([P({reflect:!0})],Te.prototype,"size",2);D([P({type:Boolean,reflect:!0})],Te.prototype,"disabled",2);D([P({type:Boolean,reflect:!0})],Te.prototype,"checked",2);D([ir("checked")],Te.prototype,"defaultChecked",2);D([P({reflect:!0})],Te.prototype,"form",2);D([P({type:Boolean,reflect:!0})],Te.prototype,"required",2);D([P({attribute:"help-text"})],Te.prototype,"helpText",2);D([te("checked",{waitUntilFirstUpdate:!0})],Te.prototype,"handleCheckedChange",1);D([te("disabled",{waitUntilFirstUpdate:!0})],Te.prototype,"handleDisabledChange",1);Te.define("sl-switch");var Yl=J`
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
`;var Ne=class ii extends Q{constructor(){super(...arguments),this.hasSlotController=new Ke(this,"icon","suffix"),this.localize=new _e(this),this.open=!1,this.closable=!1,this.variant="primary",this.duration=1/0,this.remainingTime=this.duration}static get toastStack(){return this.currentToastStack||(this.currentToastStack=Object.assign(document.createElement("div"),{className:"sl-toast-stack"})),this.currentToastStack}firstUpdated(){this.base.hidden=!this.open}restartAutoHide(){this.handleCountdownChange(),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval),this.open&&this.duration<1/0&&(this.autoHideTimeout=window.setTimeout(()=>this.hide(),this.duration),this.remainingTime=this.duration,this.remainingTimeInterval=window.setInterval(()=>{this.remainingTime-=100},100))}pauseAutoHide(){var t;(t=this.countdownAnimation)==null||t.pause(),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval)}resumeAutoHide(){var t;this.duration<1/0&&(this.autoHideTimeout=window.setTimeout(()=>this.hide(),this.remainingTime),this.remainingTimeInterval=window.setInterval(()=>{this.remainingTime-=100},100),(t=this.countdownAnimation)==null||t.play())}handleCountdownChange(){if(this.open&&this.duration<1/0&&this.countdown){let{countdownElement:t}=this,s="100%",n="0";this.countdownAnimation=t.animate([{width:s},{width:n}],{duration:this.duration,easing:"linear"})}}handleCloseClick(){this.hide()}async handleOpenChange(){if(this.open){this.emit("sl-show"),this.duration<1/0&&this.restartAutoHide(),await Le(this.base),this.base.hidden=!1;let{keyframes:t,options:s}=Se(this,"alert.show",{dir:this.localize.dir()});await Ce(this.base,t,s),this.emit("sl-after-show")}else{or(this),this.emit("sl-hide"),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval),await Le(this.base);let{keyframes:t,options:s}=Se(this,"alert.hide",{dir:this.localize.dir()});await Ce(this.base,t,s),this.base.hidden=!0,this.emit("sl-after-hide")}}handleDurationChange(){this.restartAutoHide()}async show(){if(!this.open)return this.open=!0,Me(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,Me(this,"sl-after-hide")}async toast(){return new Promise(t=>{this.handleCountdownChange(),ii.toastStack.parentElement===null&&document.body.append(ii.toastStack),ii.toastStack.appendChild(this),requestAnimationFrame(()=>{this.clientWidth,this.show()}),this.addEventListener("sl-after-hide",()=>{ii.toastStack.removeChild(this),t(),ii.toastStack.querySelector("sl-alert")===null&&ii.toastStack.remove()},{once:!0})})}render(){return I`
      <div
        part="base"
        class=${oe({alert:!0,"alert--open":this.open,"alert--closable":this.closable,"alert--has-countdown":!!this.countdown,"alert--has-icon":this.hasSlotController.test("icon"),"alert--primary":this.variant==="primary","alert--success":this.variant==="success","alert--neutral":this.variant==="neutral","alert--warning":this.variant==="warning","alert--danger":this.variant==="danger"})}
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

        ${this.closable?I`
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

        ${this.countdown?I`
              <div
                class=${oe({alert__countdown:!0,"alert__countdown--ltr":this.countdown==="ltr"})}
              >
                <div class="alert__countdown-elapsed"></div>
              </div>
            `:""}
      </div>
    `}};Ne.styles=[ne,Yl];Ne.dependencies={"sl-icon-button":be};D([Z('[part~="base"]')],Ne.prototype,"base",2);D([Z(".alert__countdown-elapsed")],Ne.prototype,"countdownElement",2);D([P({type:Boolean,reflect:!0})],Ne.prototype,"open",2);D([P({type:Boolean,reflect:!0})],Ne.prototype,"closable",2);D([P({reflect:!0})],Ne.prototype,"variant",2);D([P({type:Number})],Ne.prototype,"duration",2);D([P({type:String,reflect:!0})],Ne.prototype,"countdown",2);D([pe()],Ne.prototype,"remainingTime",2);D([te("open",{waitUntilFirstUpdate:!0})],Ne.prototype,"handleOpenChange",1);D([te("duration")],Ne.prototype,"handleDurationChange",1);var Jl=Ne;we("alert.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:250,easing:"ease"}});we("alert.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:250,easing:"ease"}});Jl.define("sl-alert");var me=dn(),fe=fn(),ar=fa({store:me,ws:fe,getSettings:()=>lr}),re=wr(location.hash),ec=fe.getState(),Vo=!0,Pe="*",qo="",lr={},si=null,ct=null,Li=null,ps={},nr=new Set;function eu(e,t){if(!(!e||!t)){ps[e]||(ps[e]={});for(let[s,n]of Object.entries(t)){if(n.status==="pending")continue;let u=`${e}:${s}`;ps[e][s]||nr.has(u)||(nr.add(u),fe.send("get-agent-prompt",{runId:e,stage:s}).then(i=>{ps[e][s]=i,nr.delete(u),Ee()}).catch(()=>{nr.delete(u)}))}}}function Zl(e){if(!e||!e.stages)return null;for(let[t,s]of Object.entries(e.stages))if(s.status==="in_progress")return t;return null}function tc(e,t){let s=Zl(e),n=Zl(t);n&&s!==n&&(Pe="*",si=null,_i(),me.clearLog(),fe.send("unsubscribe-log").catch(()=>{}),fe.send("subscribe-log",{stage:null,runId:t.id}).catch(()=>{}))}fe.on("runs-list",e=>{let t={};for(let s of e.runs||[])t[s.id]=s;me.setState({runs:t}),e.settings&&(lr=e.settings)});fe.on("run-snapshot",e=>{if(e&&e.id){let t=me.getState().runs[e.id]??null;ar.handleRunUpdate(e.id,e,t),me.setRun(e.id,e),re.runId===e.id&&(tc(t,e),Hs(e)),ct&&(ct=null,Ee())}});fe.on("run-update",e=>{if(e&&e.id){let t=me.getState().runs[e.id]??null;ar.handleRunUpdate(e.id,e,t),me.setRun(e.id,e),re.runId===e.id&&(tc(t,e),Hs(e)),ct&&(ct=null,Ee())}});fe.on("log-line",e=>{e&&(me.appendLog(e),e.iteration&&e.iteration>1&&e._iterStart&&(Pe!=="*"&&na(e.iteration),ha(e.iteration)),Pe!=="*"&&co(e),fo(e))});fe.on("log-bulk",e=>{if(e&&Array.isArray(e.lines))for(let t of e.lines){let s={stage:e.stage,line:t};me.appendLog(s),Pe!=="*"&&co(s),fo(s)}});fe.on("preferences",e=>{e&&(me.setState({preferences:e}),Hi(e.theme||"light"))});fe.onConnection(e=>{ec=e,e==="open"&&(fe.send("list-runs").then(t=>{let s={};for(let n of t.runs||[])s[n.id]=n;me.setState({runs:s}),t.settings&&(lr=t.settings)}).catch(()=>{}),fe.send("get-preferences").then(t=>{me.setState({preferences:t}),Hi(t.theme||"light")}).catch(()=>{}),re.runId&&(fe.send("subscribe-run",{runId:re.runId}).catch(()=>{}),fe.send("subscribe-log",{stage:Pe==="*"?null:Pe,runId:re.runId}).catch(()=>{}))),Ee()});_n(e=>{let t=re.runId;re=e,t&&t!==re.runId&&(fe.send("unsubscribe-run").catch(()=>{}),fe.send("unsubscribe-log").catch(()=>{}),me.clearLog(),_i(),_o()),re.runId&&re.runId!==t&&(Pe="*",si=null,fe.send("subscribe-run",{runId:re.runId}).catch(()=>{}),fe.send("subscribe-log",{stage:null,runId:re.runId}).catch(()=>{})),re.section==="settings"&&zr().then(()=>Ee()),!re.runId&&t&&(sa(),da()),Ee()});function tu(e){tt(e,null)}function Ql(e){tt(re.section,e)}function iu(){let t=me.getState().preferences.theme==="dark"?"light":"dark";fe.send("set-preferences",{theme:t}).catch(()=>{}),me.setState({preferences:{theme:t}}),Hi(t)}function su(e){fe.send("set-preferences",{notifications:e}).catch(()=>{}),me.setState({preferences:{notifications:e}})}function ru(e){if(Pe=e,e!=="*"){let n=me.getState().runs[re.runId]?.stages?.[e]?.iterations?.length||0;si=n>0?n:null}else si=null;_i(),me.clearLog(),fe.send("unsubscribe-log").catch(()=>{}),fe.send("subscribe-log",{stage:e==="*"?null:e,runId:re.runId,iteration:si}).catch(()=>{}),Ee()}function ou(e){si=e,_i(),me.clearLog(),fe.send("unsubscribe-log").catch(()=>{}),fe.send("subscribe-log",{stage:Pe==="*"?null:Pe,runId:re.runId,iteration:e}).catch(()=>{}),Ee()}function nu(e){qo=e,ra(e)}function au(){Vo=!Vo,Ee()}function ic(e){Li=e,Ee(),requestAnimationFrame(()=>{let t=document.getElementById("action-error-dialog");t&&t.show()})}function lu(){Li=null,Ee()}function cu(){ct="stopping",Li=null,Ee(),fe.send("stop-run").then(()=>{}).catch(e=>{ct=null,ic(e?.message||"Failed to stop pipeline")})}function hu(){ct="resuming",Li=null,Ee(),fe.send("resume-run").then(()=>{}).catch(e=>{ct=null,ic(e?.message||"Failed to resume pipeline")})}function du(){if(re.runId){let t=Object.values(me.getState().runs).filter(s=>s.active);re.section==="active"&&t.length<=1?tt("dashboard",null):tt(re.section,null)}else re.section&&re.section!=="dashboard"&&tt("dashboard",null)}function uu(){let e=me.getState(),t="Dashboard",s=!1,n=null,u=null;if(re.runId){let i=e.runs[re.runId],l=(i?.work_request?.title||"Pipeline Details").split(`
`)[0];if(t=l.length>80?l.slice(0,80)+"\u2026":l,s=!0,i){let p=i.runState||(i.active?"running":"terminal"),d=p==="running"?"warning":p==="interrupted"?"neutral":"success",f=p==="running"?"in_progress":p==="interrupted"?"interrupted":"completed",g=p==="running"?"Running":p==="interrupted"?"Interrupted":"Completed";n=I`<sl-badge variant="${d}" pill>
        ${G(it(f,12))}
        ${g}
      </sl-badge>`,ct==="stopping"?u=I`
          <button class="action-btn action-btn--danger" disabled>
            ${G(Y(St,14,"icon-spin"))}
            Stopping\u2026
          </button>`:ct==="resuming"?u=I`
          <button class="action-btn action-btn--primary" disabled>
            ${G(Y(St,14,"icon-spin"))}
            Resuming\u2026
          </button>`:p==="running"?u=I`
          <button class="action-btn action-btn--danger" @click=${cu}>
            ${G(Y(Lr,14))}
            Stop Pipeline
          </button>`:p==="interrupted"&&(u=I`
          <button class="action-btn action-btn--primary" @click=${hu}>
            ${G(Y(Tr,14))}
            Resume Pipeline
          </button>`)}}else re.section==="active"?(t="Running Pipelines",s=!0):re.section==="history"?(t="History",s=!0):re.section==="settings"&&(t="Settings",s=!0);return I`
    <div class="content-header">
      ${s?I`
        <button class="content-header-back" @click=${du}>
          ${G(Y(Ar,18))}
        </button>
      `:""}
      ${n||""}
      <h1 class="content-header-title">${t}</h1>
      ${u?I`<div class="content-header-actions">
        ${u}
      </div>`:""}
    </div>
  `}function pu(){let e=me.getState(),t=Object.values(e.runs);if(re.runId){let s=e.runs[re.runId],n={};if(s?.stages){for(let[l,p]of Object.entries(s.stages)){let d=p.iterations||[];d.length>0&&(n[l]=d.length)}eu(re.runId,s.stages)}let u=fu(e);u.currentLogStage=Pe==="*"?null:Pe,u.currentLogIteration=si;let i=!!s?.active,r=mo();return s&&!r&&Hs(s),I`
      <div class="run-detail-layout">
        <div class="run-detail-layout__stages">
          ${Cn(s,lr,{promptCache:ps[re.runId]||{}})}
        </div>
        <div class="run-detail-layout__logs">
          ${pa(mo(),i)}
          ${aa(u,{onStageFilter:ru,onIterationFilter:ou,onSearch:nu,onToggleAutoScroll:au,autoScroll:Vo,stageIterations:n,runStages:s?.stages})}
        </div>
      </div>
    `}if(re.section==="settings")return An(e.preferences,{rerender:Ee,onThemeToggle:iu,onSaveNotifications:su});if(re.section==="history")return Fr(t,"history",{onSelectRun:Ql});if(re.section==="active"){let s=t.filter(n=>n.active);return s.length===1?(tt("active",s[0].id),I``):Fr(t,"active",{onSelectRun:Ql})}return xn(e,{onSelectRun:s=>tt("active",s)})}function fu(e){let t=e.logLines;if(Pe!=="*"&&(t=t.filter(s=>s.stage===Pe)),qo){let s=qo.toLowerCase();t=t.filter(n=>(n.line||"").toLowerCase().includes(s))}return{...e,logLines:t}}function Ee(){let e=me.getState(),t=document.getElementById("app");t&&(ws(I`
    <div class="app-shell">
      ${mn(e,re,ec,{onNavigate:tu})}
      <main class="main-content">
        ${ar.renderBanner()}
        ${uu()}
        ${pu()}
      </main>
    </div>
    ${Li?I`
      <sl-dialog id="action-error-dialog" label="Pipeline Error" @sl-after-hide=${lu}>
        <div class="error-dialog-body">
          ${G(Y(xr,32,"error-dialog-icon"))}
          <p>${Li}</p>
        </div>
        <sl-button slot="footer" variant="primary" @click=${()=>{document.getElementById("action-error-dialog")?.hide()}}>OK</sl-button>
      </sl-dialog>
    `:""}
  `,t),re.runId&&(Pe!=="*"&&oa(re.runId),ua(re.runId)))}ar.setRerender(Ee);me.subscribe(()=>Ee());Hi(me.getState().preferences.theme);re.section==="settings"&&zr().then(()=>Ee());Ee();
//# sourceMappingURL=main.bundle.js.map
