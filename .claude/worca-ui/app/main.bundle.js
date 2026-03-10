var Sc=Object.create;var Tr=Object.defineProperty;var Cc=Object.getOwnPropertyDescriptor;var xc=Object.getOwnPropertyNames;var kc=Object.getPrototypeOf,Ec=Object.prototype.hasOwnProperty;var ln=(e,t)=>()=>(e&&(t=e(e=0)),t);var Ac=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),cn=(e,t)=>{for(var i in t)Tr(e,i,{get:t[i],enumerable:!0})},Lc=(e,t,i,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let u of xc(t))!Ec.call(e,u)&&u!==i&&Tr(e,u,{get:()=>t[u],enumerable:!(n=Cc(t,u))||n.enumerable});return e};var hn=(e,t,i)=>(i=e!=null?Sc(kc(e)):{},Lc(t||!e||!e.__esModule?Tr(i,"default",{value:e,enumerable:!0}):i,e));var so=Ac((Us,io)=>{(function(e,t){if(typeof Us=="object"&&typeof io=="object")io.exports=t();else if(typeof define=="function"&&define.amd)define([],t);else{var i=t();for(var n in i)(typeof Us=="object"?Us:e)[n]=i[n]}})(self,(()=>(()=>{"use strict";var e={4567:function(u,s,r){var l=this&&this.__decorate||function(h,m,v,w){var C,_=arguments.length,S=_<3?m:w===null?w=Object.getOwnPropertyDescriptor(m,v):w;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")S=Reflect.decorate(h,m,v,w);else for(var T=h.length-1;T>=0;T--)(C=h[T])&&(S=(_<3?C(S):_>3?C(m,v,S):C(m,v))||S);return _>3&&S&&Object.defineProperty(m,v,S),S},p=this&&this.__param||function(h,m){return function(v,w){m(v,w,h)}};Object.defineProperty(s,"__esModule",{value:!0}),s.AccessibilityManager=void 0;let d=r(9042),f=r(6114),g=r(9924),y=r(844),b=r(5596),o=r(4725),a=r(3656),c=s.AccessibilityManager=class extends y.Disposable{constructor(h,m){super(),this._terminal=h,this._renderService=m,this._liveRegionLineCount=0,this._charsToConsume=[],this._charsToAnnounce="",this._accessibilityContainer=document.createElement("div"),this._accessibilityContainer.classList.add("xterm-accessibility"),this._rowContainer=document.createElement("div"),this._rowContainer.setAttribute("role","list"),this._rowContainer.classList.add("xterm-accessibility-tree"),this._rowElements=[];for(let v=0;v<this._terminal.rows;v++)this._rowElements[v]=this._createAccessibilityTreeNode(),this._rowContainer.appendChild(this._rowElements[v]);if(this._topBoundaryFocusListener=v=>this._handleBoundaryFocus(v,0),this._bottomBoundaryFocusListener=v=>this._handleBoundaryFocus(v,1),this._rowElements[0].addEventListener("focus",this._topBoundaryFocusListener),this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._refreshRowsDimensions(),this._accessibilityContainer.appendChild(this._rowContainer),this._liveRegion=document.createElement("div"),this._liveRegion.classList.add("live-region"),this._liveRegion.setAttribute("aria-live","assertive"),this._accessibilityContainer.appendChild(this._liveRegion),this._liveRegionDebouncer=this.register(new g.TimeBasedDebouncer(this._renderRows.bind(this))),!this._terminal.element)throw new Error("Cannot enable accessibility before Terminal.open");this._terminal.element.insertAdjacentElement("afterbegin",this._accessibilityContainer),this.register(this._terminal.onResize((v=>this._handleResize(v.rows)))),this.register(this._terminal.onRender((v=>this._refreshRows(v.start,v.end)))),this.register(this._terminal.onScroll((()=>this._refreshRows()))),this.register(this._terminal.onA11yChar((v=>this._handleChar(v)))),this.register(this._terminal.onLineFeed((()=>this._handleChar(`
`)))),this.register(this._terminal.onA11yTab((v=>this._handleTab(v)))),this.register(this._terminal.onKey((v=>this._handleKey(v.key)))),this.register(this._terminal.onBlur((()=>this._clearLiveRegion()))),this.register(this._renderService.onDimensionsChange((()=>this._refreshRowsDimensions()))),this._screenDprMonitor=new b.ScreenDprMonitor(window),this.register(this._screenDprMonitor),this._screenDprMonitor.setListener((()=>this._refreshRowsDimensions())),this.register((0,a.addDisposableDomListener)(window,"resize",(()=>this._refreshRowsDimensions()))),this._refreshRows(),this.register((0,y.toDisposable)((()=>{this._accessibilityContainer.remove(),this._rowElements.length=0})))}_handleTab(h){for(let m=0;m<h;m++)this._handleChar(" ")}_handleChar(h){this._liveRegionLineCount<21&&(this._charsToConsume.length>0?this._charsToConsume.shift()!==h&&(this._charsToAnnounce+=h):this._charsToAnnounce+=h,h===`
`&&(this._liveRegionLineCount++,this._liveRegionLineCount===21&&(this._liveRegion.textContent+=d.tooMuchOutput)),f.isMac&&this._liveRegion.textContent&&this._liveRegion.textContent.length>0&&!this._liveRegion.parentNode&&setTimeout((()=>{this._accessibilityContainer.appendChild(this._liveRegion)}),0))}_clearLiveRegion(){this._liveRegion.textContent="",this._liveRegionLineCount=0,f.isMac&&this._liveRegion.remove()}_handleKey(h){this._clearLiveRegion(),/\p{Control}/u.test(h)||this._charsToConsume.push(h)}_refreshRows(h,m){this._liveRegionDebouncer.refresh(h,m,this._terminal.rows)}_renderRows(h,m){let v=this._terminal.buffer,w=v.lines.length.toString();for(let C=h;C<=m;C++){let _=v.translateBufferLineToString(v.ydisp+C,!0),S=(v.ydisp+C+1).toString(),T=this._rowElements[C];T&&(_.length===0?T.innerText="\xA0":T.textContent=_,T.setAttribute("aria-posinset",S),T.setAttribute("aria-setsize",w))}this._announceCharacters()}_announceCharacters(){this._charsToAnnounce.length!==0&&(this._liveRegion.textContent+=this._charsToAnnounce,this._charsToAnnounce="")}_handleBoundaryFocus(h,m){let v=h.target,w=this._rowElements[m===0?1:this._rowElements.length-2];if(v.getAttribute("aria-posinset")===(m===0?"1":`${this._terminal.buffer.lines.length}`)||h.relatedTarget!==w)return;let C,_;if(m===0?(C=v,_=this._rowElements.pop(),this._rowContainer.removeChild(_)):(C=this._rowElements.shift(),_=v,this._rowContainer.removeChild(C)),C.removeEventListener("focus",this._topBoundaryFocusListener),_.removeEventListener("focus",this._bottomBoundaryFocusListener),m===0){let S=this._createAccessibilityTreeNode();this._rowElements.unshift(S),this._rowContainer.insertAdjacentElement("afterbegin",S)}else{let S=this._createAccessibilityTreeNode();this._rowElements.push(S),this._rowContainer.appendChild(S)}this._rowElements[0].addEventListener("focus",this._topBoundaryFocusListener),this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._terminal.scrollLines(m===0?-1:1),this._rowElements[m===0?1:this._rowElements.length-2].focus(),h.preventDefault(),h.stopImmediatePropagation()}_handleResize(h){this._rowElements[this._rowElements.length-1].removeEventListener("focus",this._bottomBoundaryFocusListener);for(let m=this._rowContainer.children.length;m<this._terminal.rows;m++)this._rowElements[m]=this._createAccessibilityTreeNode(),this._rowContainer.appendChild(this._rowElements[m]);for(;this._rowElements.length>h;)this._rowContainer.removeChild(this._rowElements.pop());this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._refreshRowsDimensions()}_createAccessibilityTreeNode(){let h=document.createElement("div");return h.setAttribute("role","listitem"),h.tabIndex=-1,this._refreshRowDimensions(h),h}_refreshRowsDimensions(){if(this._renderService.dimensions.css.cell.height){this._accessibilityContainer.style.width=`${this._renderService.dimensions.css.canvas.width}px`,this._rowElements.length!==this._terminal.rows&&this._handleResize(this._terminal.rows);for(let h=0;h<this._terminal.rows;h++)this._refreshRowDimensions(this._rowElements[h])}}_refreshRowDimensions(h){h.style.height=`${this._renderService.dimensions.css.cell.height}px`}};s.AccessibilityManager=c=l([p(1,o.IRenderService)],c)},3614:(u,s)=>{function r(f){return f.replace(/\r?\n/g,"\r")}function l(f,g){return g?"\x1B[200~"+f+"\x1B[201~":f}function p(f,g,y,b){f=l(f=r(f),y.decPrivateModes.bracketedPasteMode&&b.rawOptions.ignoreBracketedPasteMode!==!0),y.triggerDataEvent(f,!0),g.value=""}function d(f,g,y){let b=y.getBoundingClientRect(),o=f.clientX-b.left-10,a=f.clientY-b.top-10;g.style.width="20px",g.style.height="20px",g.style.left=`${o}px`,g.style.top=`${a}px`,g.style.zIndex="1000",g.focus()}Object.defineProperty(s,"__esModule",{value:!0}),s.rightClickHandler=s.moveTextAreaUnderMouseCursor=s.paste=s.handlePasteEvent=s.copyHandler=s.bracketTextForPaste=s.prepareTextForTerminal=void 0,s.prepareTextForTerminal=r,s.bracketTextForPaste=l,s.copyHandler=function(f,g){f.clipboardData&&f.clipboardData.setData("text/plain",g.selectionText),f.preventDefault()},s.handlePasteEvent=function(f,g,y,b){f.stopPropagation(),f.clipboardData&&p(f.clipboardData.getData("text/plain"),g,y,b)},s.paste=p,s.moveTextAreaUnderMouseCursor=d,s.rightClickHandler=function(f,g,y,b,o){d(f,g,y),o&&b.rightClickSelect(f),g.value=b.selectionText,g.select()}},7239:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.ColorContrastCache=void 0;let l=r(1505);s.ColorContrastCache=class{constructor(){this._color=new l.TwoKeyMap,this._css=new l.TwoKeyMap}setCss(p,d,f){this._css.set(p,d,f)}getCss(p,d){return this._css.get(p,d)}setColor(p,d,f){this._color.set(p,d,f)}getColor(p,d){return this._color.get(p,d)}clear(){this._color.clear(),this._css.clear()}}},3656:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.addDisposableDomListener=void 0,s.addDisposableDomListener=function(r,l,p,d){r.addEventListener(l,p,d);let f=!1;return{dispose:()=>{f||(f=!0,r.removeEventListener(l,p,d))}}}},6465:function(u,s,r){var l=this&&this.__decorate||function(o,a,c,h){var m,v=arguments.length,w=v<3?a:h===null?h=Object.getOwnPropertyDescriptor(a,c):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")w=Reflect.decorate(o,a,c,h);else for(var C=o.length-1;C>=0;C--)(m=o[C])&&(w=(v<3?m(w):v>3?m(a,c,w):m(a,c))||w);return v>3&&w&&Object.defineProperty(a,c,w),w},p=this&&this.__param||function(o,a){return function(c,h){a(c,h,o)}};Object.defineProperty(s,"__esModule",{value:!0}),s.Linkifier2=void 0;let d=r(3656),f=r(8460),g=r(844),y=r(2585),b=s.Linkifier2=class extends g.Disposable{get currentLink(){return this._currentLink}constructor(o){super(),this._bufferService=o,this._linkProviders=[],this._linkCacheDisposables=[],this._isMouseOut=!0,this._wasResized=!1,this._activeLine=-1,this._onShowLinkUnderline=this.register(new f.EventEmitter),this.onShowLinkUnderline=this._onShowLinkUnderline.event,this._onHideLinkUnderline=this.register(new f.EventEmitter),this.onHideLinkUnderline=this._onHideLinkUnderline.event,this.register((0,g.getDisposeArrayDisposable)(this._linkCacheDisposables)),this.register((0,g.toDisposable)((()=>{this._lastMouseEvent=void 0}))),this.register(this._bufferService.onResize((()=>{this._clearCurrentLink(),this._wasResized=!0})))}registerLinkProvider(o){return this._linkProviders.push(o),{dispose:()=>{let a=this._linkProviders.indexOf(o);a!==-1&&this._linkProviders.splice(a,1)}}}attachToDom(o,a,c){this._element=o,this._mouseService=a,this._renderService=c,this.register((0,d.addDisposableDomListener)(this._element,"mouseleave",(()=>{this._isMouseOut=!0,this._clearCurrentLink()}))),this.register((0,d.addDisposableDomListener)(this._element,"mousemove",this._handleMouseMove.bind(this))),this.register((0,d.addDisposableDomListener)(this._element,"mousedown",this._handleMouseDown.bind(this))),this.register((0,d.addDisposableDomListener)(this._element,"mouseup",this._handleMouseUp.bind(this)))}_handleMouseMove(o){if(this._lastMouseEvent=o,!this._element||!this._mouseService)return;let a=this._positionFromMouseEvent(o,this._element,this._mouseService);if(!a)return;this._isMouseOut=!1;let c=o.composedPath();for(let h=0;h<c.length;h++){let m=c[h];if(m.classList.contains("xterm"))break;if(m.classList.contains("xterm-hover"))return}this._lastBufferCell&&a.x===this._lastBufferCell.x&&a.y===this._lastBufferCell.y||(this._handleHover(a),this._lastBufferCell=a)}_handleHover(o){if(this._activeLine!==o.y||this._wasResized)return this._clearCurrentLink(),this._askForLink(o,!1),void(this._wasResized=!1);this._currentLink&&this._linkAtPosition(this._currentLink.link,o)||(this._clearCurrentLink(),this._askForLink(o,!0))}_askForLink(o,a){var c,h;this._activeProviderReplies&&a||((c=this._activeProviderReplies)===null||c===void 0||c.forEach((v=>{v?.forEach((w=>{w.link.dispose&&w.link.dispose()}))})),this._activeProviderReplies=new Map,this._activeLine=o.y);let m=!1;for(let[v,w]of this._linkProviders.entries())a?!((h=this._activeProviderReplies)===null||h===void 0)&&h.get(v)&&(m=this._checkLinkProviderResult(v,o,m)):w.provideLinks(o.y,(C=>{var _,S;if(this._isMouseOut)return;let T=C?.map(($=>({link:$})));(_=this._activeProviderReplies)===null||_===void 0||_.set(v,T),m=this._checkLinkProviderResult(v,o,m),((S=this._activeProviderReplies)===null||S===void 0?void 0:S.size)===this._linkProviders.length&&this._removeIntersectingLinks(o.y,this._activeProviderReplies)}))}_removeIntersectingLinks(o,a){let c=new Set;for(let h=0;h<a.size;h++){let m=a.get(h);if(m)for(let v=0;v<m.length;v++){let w=m[v],C=w.link.range.start.y<o?0:w.link.range.start.x,_=w.link.range.end.y>o?this._bufferService.cols:w.link.range.end.x;for(let S=C;S<=_;S++){if(c.has(S)){m.splice(v--,1);break}c.add(S)}}}}_checkLinkProviderResult(o,a,c){var h;if(!this._activeProviderReplies)return c;let m=this._activeProviderReplies.get(o),v=!1;for(let w=0;w<o;w++)this._activeProviderReplies.has(w)&&!this._activeProviderReplies.get(w)||(v=!0);if(!v&&m){let w=m.find((C=>this._linkAtPosition(C.link,a)));w&&(c=!0,this._handleNewLink(w))}if(this._activeProviderReplies.size===this._linkProviders.length&&!c)for(let w=0;w<this._activeProviderReplies.size;w++){let C=(h=this._activeProviderReplies.get(w))===null||h===void 0?void 0:h.find((_=>this._linkAtPosition(_.link,a)));if(C){c=!0,this._handleNewLink(C);break}}return c}_handleMouseDown(){this._mouseDownLink=this._currentLink}_handleMouseUp(o){if(!this._element||!this._mouseService||!this._currentLink)return;let a=this._positionFromMouseEvent(o,this._element,this._mouseService);a&&this._mouseDownLink===this._currentLink&&this._linkAtPosition(this._currentLink.link,a)&&this._currentLink.link.activate(o,this._currentLink.link.text)}_clearCurrentLink(o,a){this._element&&this._currentLink&&this._lastMouseEvent&&(!o||!a||this._currentLink.link.range.start.y>=o&&this._currentLink.link.range.end.y<=a)&&(this._linkLeave(this._element,this._currentLink.link,this._lastMouseEvent),this._currentLink=void 0,(0,g.disposeArray)(this._linkCacheDisposables))}_handleNewLink(o){if(!this._element||!this._lastMouseEvent||!this._mouseService)return;let a=this._positionFromMouseEvent(this._lastMouseEvent,this._element,this._mouseService);a&&this._linkAtPosition(o.link,a)&&(this._currentLink=o,this._currentLink.state={decorations:{underline:o.link.decorations===void 0||o.link.decorations.underline,pointerCursor:o.link.decorations===void 0||o.link.decorations.pointerCursor},isHovered:!0},this._linkHover(this._element,o.link,this._lastMouseEvent),o.link.decorations={},Object.defineProperties(o.link.decorations,{pointerCursor:{get:()=>{var c,h;return(h=(c=this._currentLink)===null||c===void 0?void 0:c.state)===null||h===void 0?void 0:h.decorations.pointerCursor},set:c=>{var h,m;!((h=this._currentLink)===null||h===void 0)&&h.state&&this._currentLink.state.decorations.pointerCursor!==c&&(this._currentLink.state.decorations.pointerCursor=c,this._currentLink.state.isHovered&&((m=this._element)===null||m===void 0||m.classList.toggle("xterm-cursor-pointer",c)))}},underline:{get:()=>{var c,h;return(h=(c=this._currentLink)===null||c===void 0?void 0:c.state)===null||h===void 0?void 0:h.decorations.underline},set:c=>{var h,m,v;!((h=this._currentLink)===null||h===void 0)&&h.state&&((v=(m=this._currentLink)===null||m===void 0?void 0:m.state)===null||v===void 0?void 0:v.decorations.underline)!==c&&(this._currentLink.state.decorations.underline=c,this._currentLink.state.isHovered&&this._fireUnderlineEvent(o.link,c))}}}),this._renderService&&this._linkCacheDisposables.push(this._renderService.onRenderedViewportChange((c=>{if(!this._currentLink)return;let h=c.start===0?0:c.start+1+this._bufferService.buffer.ydisp,m=this._bufferService.buffer.ydisp+1+c.end;if(this._currentLink.link.range.start.y>=h&&this._currentLink.link.range.end.y<=m&&(this._clearCurrentLink(h,m),this._lastMouseEvent&&this._element)){let v=this._positionFromMouseEvent(this._lastMouseEvent,this._element,this._mouseService);v&&this._askForLink(v,!1)}}))))}_linkHover(o,a,c){var h;!((h=this._currentLink)===null||h===void 0)&&h.state&&(this._currentLink.state.isHovered=!0,this._currentLink.state.decorations.underline&&this._fireUnderlineEvent(a,!0),this._currentLink.state.decorations.pointerCursor&&o.classList.add("xterm-cursor-pointer")),a.hover&&a.hover(c,a.text)}_fireUnderlineEvent(o,a){let c=o.range,h=this._bufferService.buffer.ydisp,m=this._createLinkUnderlineEvent(c.start.x-1,c.start.y-h-1,c.end.x,c.end.y-h-1,void 0);(a?this._onShowLinkUnderline:this._onHideLinkUnderline).fire(m)}_linkLeave(o,a,c){var h;!((h=this._currentLink)===null||h===void 0)&&h.state&&(this._currentLink.state.isHovered=!1,this._currentLink.state.decorations.underline&&this._fireUnderlineEvent(a,!1),this._currentLink.state.decorations.pointerCursor&&o.classList.remove("xterm-cursor-pointer")),a.leave&&a.leave(c,a.text)}_linkAtPosition(o,a){let c=o.range.start.y*this._bufferService.cols+o.range.start.x,h=o.range.end.y*this._bufferService.cols+o.range.end.x,m=a.y*this._bufferService.cols+a.x;return c<=m&&m<=h}_positionFromMouseEvent(o,a,c){let h=c.getCoords(o,a,this._bufferService.cols,this._bufferService.rows);if(h)return{x:h[0],y:h[1]+this._bufferService.buffer.ydisp}}_createLinkUnderlineEvent(o,a,c,h,m){return{x1:o,y1:a,x2:c,y2:h,cols:this._bufferService.cols,fg:m}}};s.Linkifier2=b=l([p(0,y.IBufferService)],b)},9042:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.tooMuchOutput=s.promptLabel=void 0,s.promptLabel="Terminal input",s.tooMuchOutput="Too much output to announce, navigate to rows manually to read"},3730:function(u,s,r){var l=this&&this.__decorate||function(b,o,a,c){var h,m=arguments.length,v=m<3?o:c===null?c=Object.getOwnPropertyDescriptor(o,a):c;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")v=Reflect.decorate(b,o,a,c);else for(var w=b.length-1;w>=0;w--)(h=b[w])&&(v=(m<3?h(v):m>3?h(o,a,v):h(o,a))||v);return m>3&&v&&Object.defineProperty(o,a,v),v},p=this&&this.__param||function(b,o){return function(a,c){o(a,c,b)}};Object.defineProperty(s,"__esModule",{value:!0}),s.OscLinkProvider=void 0;let d=r(511),f=r(2585),g=s.OscLinkProvider=class{constructor(b,o,a){this._bufferService=b,this._optionsService=o,this._oscLinkService=a}provideLinks(b,o){var a;let c=this._bufferService.buffer.lines.get(b-1);if(!c)return void o(void 0);let h=[],m=this._optionsService.rawOptions.linkHandler,v=new d.CellData,w=c.getTrimmedLength(),C=-1,_=-1,S=!1;for(let T=0;T<w;T++)if(_!==-1||c.hasContent(T)){if(c.loadCell(T,v),v.hasExtendedAttrs()&&v.extended.urlId){if(_===-1){_=T,C=v.extended.urlId;continue}S=v.extended.urlId!==C}else _!==-1&&(S=!0);if(S||_!==-1&&T===w-1){let $=(a=this._oscLinkService.getLinkData(C))===null||a===void 0?void 0:a.uri;if($){let D={start:{x:_+1,y:b},end:{x:T+(S||T!==w-1?0:1),y:b}},O=!1;if(!m?.allowNonHttpProtocols)try{let z=new URL($);["http:","https:"].includes(z.protocol)||(O=!0)}catch{O=!0}O||h.push({text:$,range:D,activate:(z,I)=>m?m.activate(z,I,D):y(0,I),hover:(z,I)=>{var B;return(B=m?.hover)===null||B===void 0?void 0:B.call(m,z,I,D)},leave:(z,I)=>{var B;return(B=m?.leave)===null||B===void 0?void 0:B.call(m,z,I,D)}})}S=!1,v.hasExtendedAttrs()&&v.extended.urlId?(_=T,C=v.extended.urlId):(_=-1,C=-1)}}o(h)}};function y(b,o){if(confirm(`Do you want to navigate to ${o}?

WARNING: This link could potentially be dangerous`)){let a=window.open();if(a){try{a.opener=null}catch{}a.location.href=o}else console.warn("Opening link blocked as opener could not be cleared")}}s.OscLinkProvider=g=l([p(0,f.IBufferService),p(1,f.IOptionsService),p(2,f.IOscLinkService)],g)},6193:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.RenderDebouncer=void 0,s.RenderDebouncer=class{constructor(r,l){this._parentWindow=r,this._renderCallback=l,this._refreshCallbacks=[]}dispose(){this._animationFrame&&(this._parentWindow.cancelAnimationFrame(this._animationFrame),this._animationFrame=void 0)}addRefreshCallback(r){return this._refreshCallbacks.push(r),this._animationFrame||(this._animationFrame=this._parentWindow.requestAnimationFrame((()=>this._innerRefresh()))),this._animationFrame}refresh(r,l,p){this._rowCount=p,r=r!==void 0?r:0,l=l!==void 0?l:this._rowCount-1,this._rowStart=this._rowStart!==void 0?Math.min(this._rowStart,r):r,this._rowEnd=this._rowEnd!==void 0?Math.max(this._rowEnd,l):l,this._animationFrame||(this._animationFrame=this._parentWindow.requestAnimationFrame((()=>this._innerRefresh())))}_innerRefresh(){if(this._animationFrame=void 0,this._rowStart===void 0||this._rowEnd===void 0||this._rowCount===void 0)return void this._runRefreshCallbacks();let r=Math.max(this._rowStart,0),l=Math.min(this._rowEnd,this._rowCount-1);this._rowStart=void 0,this._rowEnd=void 0,this._renderCallback(r,l),this._runRefreshCallbacks()}_runRefreshCallbacks(){for(let r of this._refreshCallbacks)r(0);this._refreshCallbacks=[]}}},5596:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.ScreenDprMonitor=void 0;let l=r(844);class p extends l.Disposable{constructor(f){super(),this._parentWindow=f,this._currentDevicePixelRatio=this._parentWindow.devicePixelRatio,this.register((0,l.toDisposable)((()=>{this.clearListener()})))}setListener(f){this._listener&&this.clearListener(),this._listener=f,this._outerListener=()=>{this._listener&&(this._listener(this._parentWindow.devicePixelRatio,this._currentDevicePixelRatio),this._updateDpr())},this._updateDpr()}_updateDpr(){var f;this._outerListener&&((f=this._resolutionMediaMatchList)===null||f===void 0||f.removeListener(this._outerListener),this._currentDevicePixelRatio=this._parentWindow.devicePixelRatio,this._resolutionMediaMatchList=this._parentWindow.matchMedia(`screen and (resolution: ${this._parentWindow.devicePixelRatio}dppx)`),this._resolutionMediaMatchList.addListener(this._outerListener))}clearListener(){this._resolutionMediaMatchList&&this._listener&&this._outerListener&&(this._resolutionMediaMatchList.removeListener(this._outerListener),this._resolutionMediaMatchList=void 0,this._listener=void 0,this._outerListener=void 0)}}s.ScreenDprMonitor=p},3236:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.Terminal=void 0;let l=r(3614),p=r(3656),d=r(6465),f=r(9042),g=r(3730),y=r(1680),b=r(3107),o=r(5744),a=r(2950),c=r(1296),h=r(428),m=r(4269),v=r(5114),w=r(8934),C=r(3230),_=r(9312),S=r(4725),T=r(6731),$=r(8055),D=r(8969),O=r(8460),z=r(844),I=r(6114),B=r(8437),H=r(2584),x=r(7399),E=r(5941),L=r(9074),R=r(2585),N=r(5435),j=r(4567),X=typeof window<"u"?window.document:null;class G extends D.CoreTerminal{get onFocus(){return this._onFocus.event}get onBlur(){return this._onBlur.event}get onA11yChar(){return this._onA11yCharEmitter.event}get onA11yTab(){return this._onA11yTabEmitter.event}get onWillOpen(){return this._onWillOpen.event}constructor(k={}){super(k),this.browser=I,this._keyDownHandled=!1,this._keyDownSeen=!1,this._keyPressHandled=!1,this._unprocessedDeadKey=!1,this._accessibilityManager=this.register(new z.MutableDisposable),this._onCursorMove=this.register(new O.EventEmitter),this.onCursorMove=this._onCursorMove.event,this._onKey=this.register(new O.EventEmitter),this.onKey=this._onKey.event,this._onRender=this.register(new O.EventEmitter),this.onRender=this._onRender.event,this._onSelectionChange=this.register(new O.EventEmitter),this.onSelectionChange=this._onSelectionChange.event,this._onTitleChange=this.register(new O.EventEmitter),this.onTitleChange=this._onTitleChange.event,this._onBell=this.register(new O.EventEmitter),this.onBell=this._onBell.event,this._onFocus=this.register(new O.EventEmitter),this._onBlur=this.register(new O.EventEmitter),this._onA11yCharEmitter=this.register(new O.EventEmitter),this._onA11yTabEmitter=this.register(new O.EventEmitter),this._onWillOpen=this.register(new O.EventEmitter),this._setup(),this.linkifier2=this.register(this._instantiationService.createInstance(d.Linkifier2)),this.linkifier2.registerLinkProvider(this._instantiationService.createInstance(g.OscLinkProvider)),this._decorationService=this._instantiationService.createInstance(L.DecorationService),this._instantiationService.setService(R.IDecorationService,this._decorationService),this.register(this._inputHandler.onRequestBell((()=>this._onBell.fire()))),this.register(this._inputHandler.onRequestRefreshRows(((F,U)=>this.refresh(F,U)))),this.register(this._inputHandler.onRequestSendFocus((()=>this._reportFocus()))),this.register(this._inputHandler.onRequestReset((()=>this.reset()))),this.register(this._inputHandler.onRequestWindowsOptionsReport((F=>this._reportWindowsOptions(F)))),this.register(this._inputHandler.onColor((F=>this._handleColorEvent(F)))),this.register((0,O.forwardEvent)(this._inputHandler.onCursorMove,this._onCursorMove)),this.register((0,O.forwardEvent)(this._inputHandler.onTitleChange,this._onTitleChange)),this.register((0,O.forwardEvent)(this._inputHandler.onA11yChar,this._onA11yCharEmitter)),this.register((0,O.forwardEvent)(this._inputHandler.onA11yTab,this._onA11yTabEmitter)),this.register(this._bufferService.onResize((F=>this._afterResize(F.cols,F.rows)))),this.register((0,z.toDisposable)((()=>{var F,U;this._customKeyEventHandler=void 0,(U=(F=this.element)===null||F===void 0?void 0:F.parentNode)===null||U===void 0||U.removeChild(this.element)})))}_handleColorEvent(k){if(this._themeService)for(let F of k){let U,W="";switch(F.index){case 256:U="foreground",W="10";break;case 257:U="background",W="11";break;case 258:U="cursor",W="12";break;default:U="ansi",W="4;"+F.index}switch(F.type){case 0:let re=$.color.toColorRGB(U==="ansi"?this._themeService.colors.ansi[F.index]:this._themeService.colors[U]);this.coreService.triggerDataEvent(`${H.C0.ESC}]${W};${(0,E.toRgbString)(re)}${H.C1_ESCAPED.ST}`);break;case 1:if(U==="ansi")this._themeService.modifyColors((q=>q.ansi[F.index]=$.rgba.toColor(...F.color)));else{let q=U;this._themeService.modifyColors((me=>me[q]=$.rgba.toColor(...F.color)))}break;case 2:this._themeService.restoreColor(F.index)}}}_setup(){super._setup(),this._customKeyEventHandler=void 0}get buffer(){return this.buffers.active}focus(){this.textarea&&this.textarea.focus({preventScroll:!0})}_handleScreenReaderModeOptionChange(k){k?!this._accessibilityManager.value&&this._renderService&&(this._accessibilityManager.value=this._instantiationService.createInstance(j.AccessibilityManager,this)):this._accessibilityManager.clear()}_handleTextAreaFocus(k){this.coreService.decPrivateModes.sendFocus&&this.coreService.triggerDataEvent(H.C0.ESC+"[I"),this.updateCursorStyle(k),this.element.classList.add("focus"),this._showCursor(),this._onFocus.fire()}blur(){var k;return(k=this.textarea)===null||k===void 0?void 0:k.blur()}_handleTextAreaBlur(){this.textarea.value="",this.refresh(this.buffer.y,this.buffer.y),this.coreService.decPrivateModes.sendFocus&&this.coreService.triggerDataEvent(H.C0.ESC+"[O"),this.element.classList.remove("focus"),this._onBlur.fire()}_syncTextArea(){if(!this.textarea||!this.buffer.isCursorInViewport||this._compositionHelper.isComposing||!this._renderService)return;let k=this.buffer.ybase+this.buffer.y,F=this.buffer.lines.get(k);if(!F)return;let U=Math.min(this.buffer.x,this.cols-1),W=this._renderService.dimensions.css.cell.height,re=F.getWidth(U),q=this._renderService.dimensions.css.cell.width*re,me=this.buffer.y*this._renderService.dimensions.css.cell.height,Le=U*this._renderService.dimensions.css.cell.width;this.textarea.style.left=Le+"px",this.textarea.style.top=me+"px",this.textarea.style.width=q+"px",this.textarea.style.height=W+"px",this.textarea.style.lineHeight=W+"px",this.textarea.style.zIndex="-5"}_initGlobal(){this._bindKeys(),this.register((0,p.addDisposableDomListener)(this.element,"copy",(F=>{this.hasSelection()&&(0,l.copyHandler)(F,this._selectionService)})));let k=F=>(0,l.handlePasteEvent)(F,this.textarea,this.coreService,this.optionsService);this.register((0,p.addDisposableDomListener)(this.textarea,"paste",k)),this.register((0,p.addDisposableDomListener)(this.element,"paste",k)),I.isFirefox?this.register((0,p.addDisposableDomListener)(this.element,"mousedown",(F=>{F.button===2&&(0,l.rightClickHandler)(F,this.textarea,this.screenElement,this._selectionService,this.options.rightClickSelectsWord)}))):this.register((0,p.addDisposableDomListener)(this.element,"contextmenu",(F=>{(0,l.rightClickHandler)(F,this.textarea,this.screenElement,this._selectionService,this.options.rightClickSelectsWord)}))),I.isLinux&&this.register((0,p.addDisposableDomListener)(this.element,"auxclick",(F=>{F.button===1&&(0,l.moveTextAreaUnderMouseCursor)(F,this.textarea,this.screenElement)})))}_bindKeys(){this.register((0,p.addDisposableDomListener)(this.textarea,"keyup",(k=>this._keyUp(k)),!0)),this.register((0,p.addDisposableDomListener)(this.textarea,"keydown",(k=>this._keyDown(k)),!0)),this.register((0,p.addDisposableDomListener)(this.textarea,"keypress",(k=>this._keyPress(k)),!0)),this.register((0,p.addDisposableDomListener)(this.textarea,"compositionstart",(()=>this._compositionHelper.compositionstart()))),this.register((0,p.addDisposableDomListener)(this.textarea,"compositionupdate",(k=>this._compositionHelper.compositionupdate(k)))),this.register((0,p.addDisposableDomListener)(this.textarea,"compositionend",(()=>this._compositionHelper.compositionend()))),this.register((0,p.addDisposableDomListener)(this.textarea,"input",(k=>this._inputEvent(k)),!0)),this.register(this.onRender((()=>this._compositionHelper.updateCompositionElements())))}open(k){var F;if(!k)throw new Error("Terminal requires a parent element.");k.isConnected||this._logService.debug("Terminal.open was called on an element that was not attached to the DOM"),this._document=k.ownerDocument,this.element=this._document.createElement("div"),this.element.dir="ltr",this.element.classList.add("terminal"),this.element.classList.add("xterm"),k.appendChild(this.element);let U=X.createDocumentFragment();this._viewportElement=X.createElement("div"),this._viewportElement.classList.add("xterm-viewport"),U.appendChild(this._viewportElement),this._viewportScrollArea=X.createElement("div"),this._viewportScrollArea.classList.add("xterm-scroll-area"),this._viewportElement.appendChild(this._viewportScrollArea),this.screenElement=X.createElement("div"),this.screenElement.classList.add("xterm-screen"),this._helperContainer=X.createElement("div"),this._helperContainer.classList.add("xterm-helpers"),this.screenElement.appendChild(this._helperContainer),U.appendChild(this.screenElement),this.textarea=X.createElement("textarea"),this.textarea.classList.add("xterm-helper-textarea"),this.textarea.setAttribute("aria-label",f.promptLabel),I.isChromeOS||this.textarea.setAttribute("aria-multiline","false"),this.textarea.setAttribute("autocorrect","off"),this.textarea.setAttribute("autocapitalize","off"),this.textarea.setAttribute("spellcheck","false"),this.textarea.tabIndex=0,this._coreBrowserService=this._instantiationService.createInstance(v.CoreBrowserService,this.textarea,(F=this._document.defaultView)!==null&&F!==void 0?F:window),this._instantiationService.setService(S.ICoreBrowserService,this._coreBrowserService),this.register((0,p.addDisposableDomListener)(this.textarea,"focus",(W=>this._handleTextAreaFocus(W)))),this.register((0,p.addDisposableDomListener)(this.textarea,"blur",(()=>this._handleTextAreaBlur()))),this._helperContainer.appendChild(this.textarea),this._charSizeService=this._instantiationService.createInstance(h.CharSizeService,this._document,this._helperContainer),this._instantiationService.setService(S.ICharSizeService,this._charSizeService),this._themeService=this._instantiationService.createInstance(T.ThemeService),this._instantiationService.setService(S.IThemeService,this._themeService),this._characterJoinerService=this._instantiationService.createInstance(m.CharacterJoinerService),this._instantiationService.setService(S.ICharacterJoinerService,this._characterJoinerService),this._renderService=this.register(this._instantiationService.createInstance(C.RenderService,this.rows,this.screenElement)),this._instantiationService.setService(S.IRenderService,this._renderService),this.register(this._renderService.onRenderedViewportChange((W=>this._onRender.fire(W)))),this.onResize((W=>this._renderService.resize(W.cols,W.rows))),this._compositionView=X.createElement("div"),this._compositionView.classList.add("composition-view"),this._compositionHelper=this._instantiationService.createInstance(a.CompositionHelper,this.textarea,this._compositionView),this._helperContainer.appendChild(this._compositionView),this.element.appendChild(U);try{this._onWillOpen.fire(this.element)}catch{}this._renderService.hasRenderer()||this._renderService.setRenderer(this._createRenderer()),this._mouseService=this._instantiationService.createInstance(w.MouseService),this._instantiationService.setService(S.IMouseService,this._mouseService),this.viewport=this._instantiationService.createInstance(y.Viewport,this._viewportElement,this._viewportScrollArea),this.viewport.onRequestScrollLines((W=>this.scrollLines(W.amount,W.suppressScrollEvent,1))),this.register(this._inputHandler.onRequestSyncScrollBar((()=>this.viewport.syncScrollArea()))),this.register(this.viewport),this.register(this.onCursorMove((()=>{this._renderService.handleCursorMove(),this._syncTextArea()}))),this.register(this.onResize((()=>this._renderService.handleResize(this.cols,this.rows)))),this.register(this.onBlur((()=>this._renderService.handleBlur()))),this.register(this.onFocus((()=>this._renderService.handleFocus()))),this.register(this._renderService.onDimensionsChange((()=>this.viewport.syncScrollArea()))),this._selectionService=this.register(this._instantiationService.createInstance(_.SelectionService,this.element,this.screenElement,this.linkifier2)),this._instantiationService.setService(S.ISelectionService,this._selectionService),this.register(this._selectionService.onRequestScrollLines((W=>this.scrollLines(W.amount,W.suppressScrollEvent)))),this.register(this._selectionService.onSelectionChange((()=>this._onSelectionChange.fire()))),this.register(this._selectionService.onRequestRedraw((W=>this._renderService.handleSelectionChanged(W.start,W.end,W.columnSelectMode)))),this.register(this._selectionService.onLinuxMouseSelection((W=>{this.textarea.value=W,this.textarea.focus(),this.textarea.select()}))),this.register(this._onScroll.event((W=>{this.viewport.syncScrollArea(),this._selectionService.refresh()}))),this.register((0,p.addDisposableDomListener)(this._viewportElement,"scroll",(()=>this._selectionService.refresh()))),this.linkifier2.attachToDom(this.screenElement,this._mouseService,this._renderService),this.register(this._instantiationService.createInstance(b.BufferDecorationRenderer,this.screenElement)),this.register((0,p.addDisposableDomListener)(this.element,"mousedown",(W=>this._selectionService.handleMouseDown(W)))),this.coreMouseService.areMouseEventsActive?(this._selectionService.disable(),this.element.classList.add("enable-mouse-events")):this._selectionService.enable(),this.options.screenReaderMode&&(this._accessibilityManager.value=this._instantiationService.createInstance(j.AccessibilityManager,this)),this.register(this.optionsService.onSpecificOptionChange("screenReaderMode",(W=>this._handleScreenReaderModeOptionChange(W)))),this.options.overviewRulerWidth&&(this._overviewRulerRenderer=this.register(this._instantiationService.createInstance(o.OverviewRulerRenderer,this._viewportElement,this.screenElement))),this.optionsService.onSpecificOptionChange("overviewRulerWidth",(W=>{!this._overviewRulerRenderer&&W&&this._viewportElement&&this.screenElement&&(this._overviewRulerRenderer=this.register(this._instantiationService.createInstance(o.OverviewRulerRenderer,this._viewportElement,this.screenElement)))})),this._charSizeService.measure(),this.refresh(0,this.rows-1),this._initGlobal(),this.bindMouse()}_createRenderer(){return this._instantiationService.createInstance(c.DomRenderer,this.element,this.screenElement,this._viewportElement,this.linkifier2)}bindMouse(){let k=this,F=this.element;function U(q){let me=k._mouseService.getMouseReportCoords(q,k.screenElement);if(!me)return!1;let Le,He;switch(q.overrideType||q.type){case"mousemove":He=32,q.buttons===void 0?(Le=3,q.button!==void 0&&(Le=q.button<3?q.button:3)):Le=1&q.buttons?0:4&q.buttons?1:2&q.buttons?2:3;break;case"mouseup":He=0,Le=q.button<3?q.button:3;break;case"mousedown":He=1,Le=q.button<3?q.button:3;break;case"wheel":if(k.viewport.getLinesScrolled(q)===0)return!1;He=q.deltaY<0?0:1,Le=4;break;default:return!1}return!(He===void 0||Le===void 0||Le>4)&&k.coreMouseService.triggerMouseEvent({col:me.col,row:me.row,x:me.x,y:me.y,button:Le,action:He,ctrl:q.ctrlKey,alt:q.altKey,shift:q.shiftKey})}let W={mouseup:null,wheel:null,mousedrag:null,mousemove:null},re={mouseup:q=>(U(q),q.buttons||(this._document.removeEventListener("mouseup",W.mouseup),W.mousedrag&&this._document.removeEventListener("mousemove",W.mousedrag)),this.cancel(q)),wheel:q=>(U(q),this.cancel(q,!0)),mousedrag:q=>{q.buttons&&U(q)},mousemove:q=>{q.buttons||U(q)}};this.register(this.coreMouseService.onProtocolChange((q=>{q?(this.optionsService.rawOptions.logLevel==="debug"&&this._logService.debug("Binding to mouse events:",this.coreMouseService.explainEvents(q)),this.element.classList.add("enable-mouse-events"),this._selectionService.disable()):(this._logService.debug("Unbinding from mouse events."),this.element.classList.remove("enable-mouse-events"),this._selectionService.enable()),8&q?W.mousemove||(F.addEventListener("mousemove",re.mousemove),W.mousemove=re.mousemove):(F.removeEventListener("mousemove",W.mousemove),W.mousemove=null),16&q?W.wheel||(F.addEventListener("wheel",re.wheel,{passive:!1}),W.wheel=re.wheel):(F.removeEventListener("wheel",W.wheel),W.wheel=null),2&q?W.mouseup||(F.addEventListener("mouseup",re.mouseup),W.mouseup=re.mouseup):(this._document.removeEventListener("mouseup",W.mouseup),F.removeEventListener("mouseup",W.mouseup),W.mouseup=null),4&q?W.mousedrag||(W.mousedrag=re.mousedrag):(this._document.removeEventListener("mousemove",W.mousedrag),W.mousedrag=null)}))),this.coreMouseService.activeProtocol=this.coreMouseService.activeProtocol,this.register((0,p.addDisposableDomListener)(F,"mousedown",(q=>{if(q.preventDefault(),this.focus(),this.coreMouseService.areMouseEventsActive&&!this._selectionService.shouldForceSelection(q))return U(q),W.mouseup&&this._document.addEventListener("mouseup",W.mouseup),W.mousedrag&&this._document.addEventListener("mousemove",W.mousedrag),this.cancel(q)}))),this.register((0,p.addDisposableDomListener)(F,"wheel",(q=>{if(!W.wheel){if(!this.buffer.hasScrollback){let me=this.viewport.getLinesScrolled(q);if(me===0)return;let Le=H.C0.ESC+(this.coreService.decPrivateModes.applicationCursorKeys?"O":"[")+(q.deltaY<0?"A":"B"),He="";for(let ci=0;ci<Math.abs(me);ci++)He+=Le;return this.coreService.triggerDataEvent(He,!0),this.cancel(q,!0)}return this.viewport.handleWheel(q)?this.cancel(q):void 0}}),{passive:!1})),this.register((0,p.addDisposableDomListener)(F,"touchstart",(q=>{if(!this.coreMouseService.areMouseEventsActive)return this.viewport.handleTouchStart(q),this.cancel(q)}),{passive:!0})),this.register((0,p.addDisposableDomListener)(F,"touchmove",(q=>{if(!this.coreMouseService.areMouseEventsActive)return this.viewport.handleTouchMove(q)?void 0:this.cancel(q)}),{passive:!1}))}refresh(k,F){var U;(U=this._renderService)===null||U===void 0||U.refreshRows(k,F)}updateCursorStyle(k){var F;!((F=this._selectionService)===null||F===void 0)&&F.shouldColumnSelect(k)?this.element.classList.add("column-select"):this.element.classList.remove("column-select")}_showCursor(){this.coreService.isCursorInitialized||(this.coreService.isCursorInitialized=!0,this.refresh(this.buffer.y,this.buffer.y))}scrollLines(k,F,U=0){var W;U===1?(super.scrollLines(k,F,U),this.refresh(0,this.rows-1)):(W=this.viewport)===null||W===void 0||W.scrollLines(k)}paste(k){(0,l.paste)(k,this.textarea,this.coreService,this.optionsService)}attachCustomKeyEventHandler(k){this._customKeyEventHandler=k}registerLinkProvider(k){return this.linkifier2.registerLinkProvider(k)}registerCharacterJoiner(k){if(!this._characterJoinerService)throw new Error("Terminal must be opened first");let F=this._characterJoinerService.register(k);return this.refresh(0,this.rows-1),F}deregisterCharacterJoiner(k){if(!this._characterJoinerService)throw new Error("Terminal must be opened first");this._characterJoinerService.deregister(k)&&this.refresh(0,this.rows-1)}get markers(){return this.buffer.markers}registerMarker(k){return this.buffer.addMarker(this.buffer.ybase+this.buffer.y+k)}registerDecoration(k){return this._decorationService.registerDecoration(k)}hasSelection(){return!!this._selectionService&&this._selectionService.hasSelection}select(k,F,U){this._selectionService.setSelection(k,F,U)}getSelection(){return this._selectionService?this._selectionService.selectionText:""}getSelectionPosition(){if(this._selectionService&&this._selectionService.hasSelection)return{start:{x:this._selectionService.selectionStart[0],y:this._selectionService.selectionStart[1]},end:{x:this._selectionService.selectionEnd[0],y:this._selectionService.selectionEnd[1]}}}clearSelection(){var k;(k=this._selectionService)===null||k===void 0||k.clearSelection()}selectAll(){var k;(k=this._selectionService)===null||k===void 0||k.selectAll()}selectLines(k,F){var U;(U=this._selectionService)===null||U===void 0||U.selectLines(k,F)}_keyDown(k){if(this._keyDownHandled=!1,this._keyDownSeen=!0,this._customKeyEventHandler&&this._customKeyEventHandler(k)===!1)return!1;let F=this.browser.isMac&&this.options.macOptionIsMeta&&k.altKey;if(!F&&!this._compositionHelper.keydown(k))return this.options.scrollOnUserInput&&this.buffer.ybase!==this.buffer.ydisp&&this.scrollToBottom(),!1;F||k.key!=="Dead"&&k.key!=="AltGraph"||(this._unprocessedDeadKey=!0);let U=(0,x.evaluateKeyboardEvent)(k,this.coreService.decPrivateModes.applicationCursorKeys,this.browser.isMac,this.options.macOptionIsMeta);if(this.updateCursorStyle(k),U.type===3||U.type===2){let W=this.rows-1;return this.scrollLines(U.type===2?-W:W),this.cancel(k,!0)}return U.type===1&&this.selectAll(),!!this._isThirdLevelShift(this.browser,k)||(U.cancel&&this.cancel(k,!0),!U.key||!!(k.key&&!k.ctrlKey&&!k.altKey&&!k.metaKey&&k.key.length===1&&k.key.charCodeAt(0)>=65&&k.key.charCodeAt(0)<=90)||(this._unprocessedDeadKey?(this._unprocessedDeadKey=!1,!0):(U.key!==H.C0.ETX&&U.key!==H.C0.CR||(this.textarea.value=""),this._onKey.fire({key:U.key,domEvent:k}),this._showCursor(),this.coreService.triggerDataEvent(U.key,!0),!this.optionsService.rawOptions.screenReaderMode||k.altKey||k.ctrlKey?this.cancel(k,!0):void(this._keyDownHandled=!0))))}_isThirdLevelShift(k,F){let U=k.isMac&&!this.options.macOptionIsMeta&&F.altKey&&!F.ctrlKey&&!F.metaKey||k.isWindows&&F.altKey&&F.ctrlKey&&!F.metaKey||k.isWindows&&F.getModifierState("AltGraph");return F.type==="keypress"?U:U&&(!F.keyCode||F.keyCode>47)}_keyUp(k){this._keyDownSeen=!1,this._customKeyEventHandler&&this._customKeyEventHandler(k)===!1||((function(F){return F.keyCode===16||F.keyCode===17||F.keyCode===18})(k)||this.focus(),this.updateCursorStyle(k),this._keyPressHandled=!1)}_keyPress(k){let F;if(this._keyPressHandled=!1,this._keyDownHandled||this._customKeyEventHandler&&this._customKeyEventHandler(k)===!1)return!1;if(this.cancel(k),k.charCode)F=k.charCode;else if(k.which===null||k.which===void 0)F=k.keyCode;else{if(k.which===0||k.charCode===0)return!1;F=k.which}return!(!F||(k.altKey||k.ctrlKey||k.metaKey)&&!this._isThirdLevelShift(this.browser,k)||(F=String.fromCharCode(F),this._onKey.fire({key:F,domEvent:k}),this._showCursor(),this.coreService.triggerDataEvent(F,!0),this._keyPressHandled=!0,this._unprocessedDeadKey=!1,0))}_inputEvent(k){if(k.data&&k.inputType==="insertText"&&(!k.composed||!this._keyDownSeen)&&!this.optionsService.rawOptions.screenReaderMode){if(this._keyPressHandled)return!1;this._unprocessedDeadKey=!1;let F=k.data;return this.coreService.triggerDataEvent(F,!0),this.cancel(k),!0}return!1}resize(k,F){k!==this.cols||F!==this.rows?super.resize(k,F):this._charSizeService&&!this._charSizeService.hasValidSize&&this._charSizeService.measure()}_afterResize(k,F){var U,W;(U=this._charSizeService)===null||U===void 0||U.measure(),(W=this.viewport)===null||W===void 0||W.syncScrollArea(!0)}clear(){var k;if(this.buffer.ybase!==0||this.buffer.y!==0){this.buffer.clearAllMarkers(),this.buffer.lines.set(0,this.buffer.lines.get(this.buffer.ybase+this.buffer.y)),this.buffer.lines.length=1,this.buffer.ydisp=0,this.buffer.ybase=0,this.buffer.y=0;for(let F=1;F<this.rows;F++)this.buffer.lines.push(this.buffer.getBlankLine(B.DEFAULT_ATTR_DATA));this._onScroll.fire({position:this.buffer.ydisp,source:0}),(k=this.viewport)===null||k===void 0||k.reset(),this.refresh(0,this.rows-1)}}reset(){var k,F;this.options.rows=this.rows,this.options.cols=this.cols;let U=this._customKeyEventHandler;this._setup(),super.reset(),(k=this._selectionService)===null||k===void 0||k.reset(),this._decorationService.reset(),(F=this.viewport)===null||F===void 0||F.reset(),this._customKeyEventHandler=U,this.refresh(0,this.rows-1)}clearTextureAtlas(){var k;(k=this._renderService)===null||k===void 0||k.clearTextureAtlas()}_reportFocus(){var k;!((k=this.element)===null||k===void 0)&&k.classList.contains("focus")?this.coreService.triggerDataEvent(H.C0.ESC+"[I"):this.coreService.triggerDataEvent(H.C0.ESC+"[O")}_reportWindowsOptions(k){if(this._renderService)switch(k){case N.WindowsOptionsReportType.GET_WIN_SIZE_PIXELS:let F=this._renderService.dimensions.css.canvas.width.toFixed(0),U=this._renderService.dimensions.css.canvas.height.toFixed(0);this.coreService.triggerDataEvent(`${H.C0.ESC}[4;${U};${F}t`);break;case N.WindowsOptionsReportType.GET_CELL_SIZE_PIXELS:let W=this._renderService.dimensions.css.cell.width.toFixed(0),re=this._renderService.dimensions.css.cell.height.toFixed(0);this.coreService.triggerDataEvent(`${H.C0.ESC}[6;${re};${W}t`)}}cancel(k,F){if(this.options.cancelEvents||F)return k.preventDefault(),k.stopPropagation(),!1}}s.Terminal=G},9924:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.TimeBasedDebouncer=void 0,s.TimeBasedDebouncer=class{constructor(r,l=1e3){this._renderCallback=r,this._debounceThresholdMS=l,this._lastRefreshMs=0,this._additionalRefreshRequested=!1}dispose(){this._refreshTimeoutID&&clearTimeout(this._refreshTimeoutID)}refresh(r,l,p){this._rowCount=p,r=r!==void 0?r:0,l=l!==void 0?l:this._rowCount-1,this._rowStart=this._rowStart!==void 0?Math.min(this._rowStart,r):r,this._rowEnd=this._rowEnd!==void 0?Math.max(this._rowEnd,l):l;let d=Date.now();if(d-this._lastRefreshMs>=this._debounceThresholdMS)this._lastRefreshMs=d,this._innerRefresh();else if(!this._additionalRefreshRequested){let f=d-this._lastRefreshMs,g=this._debounceThresholdMS-f;this._additionalRefreshRequested=!0,this._refreshTimeoutID=window.setTimeout((()=>{this._lastRefreshMs=Date.now(),this._innerRefresh(),this._additionalRefreshRequested=!1,this._refreshTimeoutID=void 0}),g)}}_innerRefresh(){if(this._rowStart===void 0||this._rowEnd===void 0||this._rowCount===void 0)return;let r=Math.max(this._rowStart,0),l=Math.min(this._rowEnd,this._rowCount-1);this._rowStart=void 0,this._rowEnd=void 0,this._renderCallback(r,l)}}},1680:function(u,s,r){var l=this&&this.__decorate||function(a,c,h,m){var v,w=arguments.length,C=w<3?c:m===null?m=Object.getOwnPropertyDescriptor(c,h):m;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")C=Reflect.decorate(a,c,h,m);else for(var _=a.length-1;_>=0;_--)(v=a[_])&&(C=(w<3?v(C):w>3?v(c,h,C):v(c,h))||C);return w>3&&C&&Object.defineProperty(c,h,C),C},p=this&&this.__param||function(a,c){return function(h,m){c(h,m,a)}};Object.defineProperty(s,"__esModule",{value:!0}),s.Viewport=void 0;let d=r(3656),f=r(4725),g=r(8460),y=r(844),b=r(2585),o=s.Viewport=class extends y.Disposable{constructor(a,c,h,m,v,w,C,_){super(),this._viewportElement=a,this._scrollArea=c,this._bufferService=h,this._optionsService=m,this._charSizeService=v,this._renderService=w,this._coreBrowserService=C,this.scrollBarWidth=0,this._currentRowHeight=0,this._currentDeviceCellHeight=0,this._lastRecordedBufferLength=0,this._lastRecordedViewportHeight=0,this._lastRecordedBufferHeight=0,this._lastTouchY=0,this._lastScrollTop=0,this._wheelPartialScroll=0,this._refreshAnimationFrame=null,this._ignoreNextScrollEvent=!1,this._smoothScrollState={startTime:0,origin:-1,target:-1},this._onRequestScrollLines=this.register(new g.EventEmitter),this.onRequestScrollLines=this._onRequestScrollLines.event,this.scrollBarWidth=this._viewportElement.offsetWidth-this._scrollArea.offsetWidth||15,this.register((0,d.addDisposableDomListener)(this._viewportElement,"scroll",this._handleScroll.bind(this))),this._activeBuffer=this._bufferService.buffer,this.register(this._bufferService.buffers.onBufferActivate((S=>this._activeBuffer=S.activeBuffer))),this._renderDimensions=this._renderService.dimensions,this.register(this._renderService.onDimensionsChange((S=>this._renderDimensions=S))),this._handleThemeChange(_.colors),this.register(_.onChangeColors((S=>this._handleThemeChange(S)))),this.register(this._optionsService.onSpecificOptionChange("scrollback",(()=>this.syncScrollArea()))),setTimeout((()=>this.syncScrollArea()))}_handleThemeChange(a){this._viewportElement.style.backgroundColor=a.background.css}reset(){this._currentRowHeight=0,this._currentDeviceCellHeight=0,this._lastRecordedBufferLength=0,this._lastRecordedViewportHeight=0,this._lastRecordedBufferHeight=0,this._lastTouchY=0,this._lastScrollTop=0,this._coreBrowserService.window.requestAnimationFrame((()=>this.syncScrollArea()))}_refresh(a){if(a)return this._innerRefresh(),void(this._refreshAnimationFrame!==null&&this._coreBrowserService.window.cancelAnimationFrame(this._refreshAnimationFrame));this._refreshAnimationFrame===null&&(this._refreshAnimationFrame=this._coreBrowserService.window.requestAnimationFrame((()=>this._innerRefresh())))}_innerRefresh(){if(this._charSizeService.height>0){this._currentRowHeight=this._renderService.dimensions.device.cell.height/this._coreBrowserService.dpr,this._currentDeviceCellHeight=this._renderService.dimensions.device.cell.height,this._lastRecordedViewportHeight=this._viewportElement.offsetHeight;let c=Math.round(this._currentRowHeight*this._lastRecordedBufferLength)+(this._lastRecordedViewportHeight-this._renderService.dimensions.css.canvas.height);this._lastRecordedBufferHeight!==c&&(this._lastRecordedBufferHeight=c,this._scrollArea.style.height=this._lastRecordedBufferHeight+"px")}let a=this._bufferService.buffer.ydisp*this._currentRowHeight;this._viewportElement.scrollTop!==a&&(this._ignoreNextScrollEvent=!0,this._viewportElement.scrollTop=a),this._refreshAnimationFrame=null}syncScrollArea(a=!1){if(this._lastRecordedBufferLength!==this._bufferService.buffer.lines.length)return this._lastRecordedBufferLength=this._bufferService.buffer.lines.length,void this._refresh(a);this._lastRecordedViewportHeight===this._renderService.dimensions.css.canvas.height&&this._lastScrollTop===this._activeBuffer.ydisp*this._currentRowHeight&&this._renderDimensions.device.cell.height===this._currentDeviceCellHeight||this._refresh(a)}_handleScroll(a){if(this._lastScrollTop=this._viewportElement.scrollTop,!this._viewportElement.offsetParent)return;if(this._ignoreNextScrollEvent)return this._ignoreNextScrollEvent=!1,void this._onRequestScrollLines.fire({amount:0,suppressScrollEvent:!0});let c=Math.round(this._lastScrollTop/this._currentRowHeight)-this._bufferService.buffer.ydisp;this._onRequestScrollLines.fire({amount:c,suppressScrollEvent:!0})}_smoothScroll(){if(this._isDisposed||this._smoothScrollState.origin===-1||this._smoothScrollState.target===-1)return;let a=this._smoothScrollPercent();this._viewportElement.scrollTop=this._smoothScrollState.origin+Math.round(a*(this._smoothScrollState.target-this._smoothScrollState.origin)),a<1?this._coreBrowserService.window.requestAnimationFrame((()=>this._smoothScroll())):this._clearSmoothScrollState()}_smoothScrollPercent(){return this._optionsService.rawOptions.smoothScrollDuration&&this._smoothScrollState.startTime?Math.max(Math.min((Date.now()-this._smoothScrollState.startTime)/this._optionsService.rawOptions.smoothScrollDuration,1),0):1}_clearSmoothScrollState(){this._smoothScrollState.startTime=0,this._smoothScrollState.origin=-1,this._smoothScrollState.target=-1}_bubbleScroll(a,c){let h=this._viewportElement.scrollTop+this._lastRecordedViewportHeight;return!(c<0&&this._viewportElement.scrollTop!==0||c>0&&h<this._lastRecordedBufferHeight)||(a.cancelable&&a.preventDefault(),!1)}handleWheel(a){let c=this._getPixelsScrolled(a);return c!==0&&(this._optionsService.rawOptions.smoothScrollDuration?(this._smoothScrollState.startTime=Date.now(),this._smoothScrollPercent()<1?(this._smoothScrollState.origin=this._viewportElement.scrollTop,this._smoothScrollState.target===-1?this._smoothScrollState.target=this._viewportElement.scrollTop+c:this._smoothScrollState.target+=c,this._smoothScrollState.target=Math.max(Math.min(this._smoothScrollState.target,this._viewportElement.scrollHeight),0),this._smoothScroll()):this._clearSmoothScrollState()):this._viewportElement.scrollTop+=c,this._bubbleScroll(a,c))}scrollLines(a){if(a!==0)if(this._optionsService.rawOptions.smoothScrollDuration){let c=a*this._currentRowHeight;this._smoothScrollState.startTime=Date.now(),this._smoothScrollPercent()<1?(this._smoothScrollState.origin=this._viewportElement.scrollTop,this._smoothScrollState.target=this._smoothScrollState.origin+c,this._smoothScrollState.target=Math.max(Math.min(this._smoothScrollState.target,this._viewportElement.scrollHeight),0),this._smoothScroll()):this._clearSmoothScrollState()}else this._onRequestScrollLines.fire({amount:a,suppressScrollEvent:!1})}_getPixelsScrolled(a){if(a.deltaY===0||a.shiftKey)return 0;let c=this._applyScrollModifier(a.deltaY,a);return a.deltaMode===WheelEvent.DOM_DELTA_LINE?c*=this._currentRowHeight:a.deltaMode===WheelEvent.DOM_DELTA_PAGE&&(c*=this._currentRowHeight*this._bufferService.rows),c}getBufferElements(a,c){var h;let m,v="",w=[],C=c??this._bufferService.buffer.lines.length,_=this._bufferService.buffer.lines;for(let S=a;S<C;S++){let T=_.get(S);if(!T)continue;let $=(h=_.get(S+1))===null||h===void 0?void 0:h.isWrapped;if(v+=T.translateToString(!$),!$||S===_.length-1){let D=document.createElement("div");D.textContent=v,w.push(D),v.length>0&&(m=D),v=""}}return{bufferElements:w,cursorElement:m}}getLinesScrolled(a){if(a.deltaY===0||a.shiftKey)return 0;let c=this._applyScrollModifier(a.deltaY,a);return a.deltaMode===WheelEvent.DOM_DELTA_PIXEL?(c/=this._currentRowHeight+0,this._wheelPartialScroll+=c,c=Math.floor(Math.abs(this._wheelPartialScroll))*(this._wheelPartialScroll>0?1:-1),this._wheelPartialScroll%=1):a.deltaMode===WheelEvent.DOM_DELTA_PAGE&&(c*=this._bufferService.rows),c}_applyScrollModifier(a,c){let h=this._optionsService.rawOptions.fastScrollModifier;return h==="alt"&&c.altKey||h==="ctrl"&&c.ctrlKey||h==="shift"&&c.shiftKey?a*this._optionsService.rawOptions.fastScrollSensitivity*this._optionsService.rawOptions.scrollSensitivity:a*this._optionsService.rawOptions.scrollSensitivity}handleTouchStart(a){this._lastTouchY=a.touches[0].pageY}handleTouchMove(a){let c=this._lastTouchY-a.touches[0].pageY;return this._lastTouchY=a.touches[0].pageY,c!==0&&(this._viewportElement.scrollTop+=c,this._bubbleScroll(a,c))}};s.Viewport=o=l([p(2,b.IBufferService),p(3,b.IOptionsService),p(4,f.ICharSizeService),p(5,f.IRenderService),p(6,f.ICoreBrowserService),p(7,f.IThemeService)],o)},3107:function(u,s,r){var l=this&&this.__decorate||function(o,a,c,h){var m,v=arguments.length,w=v<3?a:h===null?h=Object.getOwnPropertyDescriptor(a,c):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")w=Reflect.decorate(o,a,c,h);else for(var C=o.length-1;C>=0;C--)(m=o[C])&&(w=(v<3?m(w):v>3?m(a,c,w):m(a,c))||w);return v>3&&w&&Object.defineProperty(a,c,w),w},p=this&&this.__param||function(o,a){return function(c,h){a(c,h,o)}};Object.defineProperty(s,"__esModule",{value:!0}),s.BufferDecorationRenderer=void 0;let d=r(3656),f=r(4725),g=r(844),y=r(2585),b=s.BufferDecorationRenderer=class extends g.Disposable{constructor(o,a,c,h){super(),this._screenElement=o,this._bufferService=a,this._decorationService=c,this._renderService=h,this._decorationElements=new Map,this._altBufferIsActive=!1,this._dimensionsChanged=!1,this._container=document.createElement("div"),this._container.classList.add("xterm-decoration-container"),this._screenElement.appendChild(this._container),this.register(this._renderService.onRenderedViewportChange((()=>this._doRefreshDecorations()))),this.register(this._renderService.onDimensionsChange((()=>{this._dimensionsChanged=!0,this._queueRefresh()}))),this.register((0,d.addDisposableDomListener)(window,"resize",(()=>this._queueRefresh()))),this.register(this._bufferService.buffers.onBufferActivate((()=>{this._altBufferIsActive=this._bufferService.buffer===this._bufferService.buffers.alt}))),this.register(this._decorationService.onDecorationRegistered((()=>this._queueRefresh()))),this.register(this._decorationService.onDecorationRemoved((m=>this._removeDecoration(m)))),this.register((0,g.toDisposable)((()=>{this._container.remove(),this._decorationElements.clear()})))}_queueRefresh(){this._animationFrame===void 0&&(this._animationFrame=this._renderService.addRefreshCallback((()=>{this._doRefreshDecorations(),this._animationFrame=void 0})))}_doRefreshDecorations(){for(let o of this._decorationService.decorations)this._renderDecoration(o);this._dimensionsChanged=!1}_renderDecoration(o){this._refreshStyle(o),this._dimensionsChanged&&this._refreshXPosition(o)}_createElement(o){var a,c;let h=document.createElement("div");h.classList.add("xterm-decoration"),h.classList.toggle("xterm-decoration-top-layer",((a=o?.options)===null||a===void 0?void 0:a.layer)==="top"),h.style.width=`${Math.round((o.options.width||1)*this._renderService.dimensions.css.cell.width)}px`,h.style.height=(o.options.height||1)*this._renderService.dimensions.css.cell.height+"px",h.style.top=(o.marker.line-this._bufferService.buffers.active.ydisp)*this._renderService.dimensions.css.cell.height+"px",h.style.lineHeight=`${this._renderService.dimensions.css.cell.height}px`;let m=(c=o.options.x)!==null&&c!==void 0?c:0;return m&&m>this._bufferService.cols&&(h.style.display="none"),this._refreshXPosition(o,h),h}_refreshStyle(o){let a=o.marker.line-this._bufferService.buffers.active.ydisp;if(a<0||a>=this._bufferService.rows)o.element&&(o.element.style.display="none",o.onRenderEmitter.fire(o.element));else{let c=this._decorationElements.get(o);c||(c=this._createElement(o),o.element=c,this._decorationElements.set(o,c),this._container.appendChild(c),o.onDispose((()=>{this._decorationElements.delete(o),c.remove()}))),c.style.top=a*this._renderService.dimensions.css.cell.height+"px",c.style.display=this._altBufferIsActive?"none":"block",o.onRenderEmitter.fire(c)}}_refreshXPosition(o,a=o.element){var c;if(!a)return;let h=(c=o.options.x)!==null&&c!==void 0?c:0;(o.options.anchor||"left")==="right"?a.style.right=h?h*this._renderService.dimensions.css.cell.width+"px":"":a.style.left=h?h*this._renderService.dimensions.css.cell.width+"px":""}_removeDecoration(o){var a;(a=this._decorationElements.get(o))===null||a===void 0||a.remove(),this._decorationElements.delete(o),o.dispose()}};s.BufferDecorationRenderer=b=l([p(1,y.IBufferService),p(2,y.IDecorationService),p(3,f.IRenderService)],b)},5871:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.ColorZoneStore=void 0,s.ColorZoneStore=class{constructor(){this._zones=[],this._zonePool=[],this._zonePoolIndex=0,this._linePadding={full:0,left:0,center:0,right:0}}get zones(){return this._zonePool.length=Math.min(this._zonePool.length,this._zones.length),this._zones}clear(){this._zones.length=0,this._zonePoolIndex=0}addDecoration(r){if(r.options.overviewRulerOptions){for(let l of this._zones)if(l.color===r.options.overviewRulerOptions.color&&l.position===r.options.overviewRulerOptions.position){if(this._lineIntersectsZone(l,r.marker.line))return;if(this._lineAdjacentToZone(l,r.marker.line,r.options.overviewRulerOptions.position))return void this._addLineToZone(l,r.marker.line)}if(this._zonePoolIndex<this._zonePool.length)return this._zonePool[this._zonePoolIndex].color=r.options.overviewRulerOptions.color,this._zonePool[this._zonePoolIndex].position=r.options.overviewRulerOptions.position,this._zonePool[this._zonePoolIndex].startBufferLine=r.marker.line,this._zonePool[this._zonePoolIndex].endBufferLine=r.marker.line,void this._zones.push(this._zonePool[this._zonePoolIndex++]);this._zones.push({color:r.options.overviewRulerOptions.color,position:r.options.overviewRulerOptions.position,startBufferLine:r.marker.line,endBufferLine:r.marker.line}),this._zonePool.push(this._zones[this._zones.length-1]),this._zonePoolIndex++}}setPadding(r){this._linePadding=r}_lineIntersectsZone(r,l){return l>=r.startBufferLine&&l<=r.endBufferLine}_lineAdjacentToZone(r,l,p){return l>=r.startBufferLine-this._linePadding[p||"full"]&&l<=r.endBufferLine+this._linePadding[p||"full"]}_addLineToZone(r,l){r.startBufferLine=Math.min(r.startBufferLine,l),r.endBufferLine=Math.max(r.endBufferLine,l)}}},5744:function(u,s,r){var l=this&&this.__decorate||function(m,v,w,C){var _,S=arguments.length,T=S<3?v:C===null?C=Object.getOwnPropertyDescriptor(v,w):C;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")T=Reflect.decorate(m,v,w,C);else for(var $=m.length-1;$>=0;$--)(_=m[$])&&(T=(S<3?_(T):S>3?_(v,w,T):_(v,w))||T);return S>3&&T&&Object.defineProperty(v,w,T),T},p=this&&this.__param||function(m,v){return function(w,C){v(w,C,m)}};Object.defineProperty(s,"__esModule",{value:!0}),s.OverviewRulerRenderer=void 0;let d=r(5871),f=r(3656),g=r(4725),y=r(844),b=r(2585),o={full:0,left:0,center:0,right:0},a={full:0,left:0,center:0,right:0},c={full:0,left:0,center:0,right:0},h=s.OverviewRulerRenderer=class extends y.Disposable{get _width(){return this._optionsService.options.overviewRulerWidth||0}constructor(m,v,w,C,_,S,T){var $;super(),this._viewportElement=m,this._screenElement=v,this._bufferService=w,this._decorationService=C,this._renderService=_,this._optionsService=S,this._coreBrowseService=T,this._colorZoneStore=new d.ColorZoneStore,this._shouldUpdateDimensions=!0,this._shouldUpdateAnchor=!0,this._lastKnownBufferLength=0,this._canvas=document.createElement("canvas"),this._canvas.classList.add("xterm-decoration-overview-ruler"),this._refreshCanvasDimensions(),($=this._viewportElement.parentElement)===null||$===void 0||$.insertBefore(this._canvas,this._viewportElement);let D=this._canvas.getContext("2d");if(!D)throw new Error("Ctx cannot be null");this._ctx=D,this._registerDecorationListeners(),this._registerBufferChangeListeners(),this._registerDimensionChangeListeners(),this.register((0,y.toDisposable)((()=>{var O;(O=this._canvas)===null||O===void 0||O.remove()})))}_registerDecorationListeners(){this.register(this._decorationService.onDecorationRegistered((()=>this._queueRefresh(void 0,!0)))),this.register(this._decorationService.onDecorationRemoved((()=>this._queueRefresh(void 0,!0))))}_registerBufferChangeListeners(){this.register(this._renderService.onRenderedViewportChange((()=>this._queueRefresh()))),this.register(this._bufferService.buffers.onBufferActivate((()=>{this._canvas.style.display=this._bufferService.buffer===this._bufferService.buffers.alt?"none":"block"}))),this.register(this._bufferService.onScroll((()=>{this._lastKnownBufferLength!==this._bufferService.buffers.normal.lines.length&&(this._refreshDrawHeightConstants(),this._refreshColorZonePadding())})))}_registerDimensionChangeListeners(){this.register(this._renderService.onRender((()=>{this._containerHeight&&this._containerHeight===this._screenElement.clientHeight||(this._queueRefresh(!0),this._containerHeight=this._screenElement.clientHeight)}))),this.register(this._optionsService.onSpecificOptionChange("overviewRulerWidth",(()=>this._queueRefresh(!0)))),this.register((0,f.addDisposableDomListener)(this._coreBrowseService.window,"resize",(()=>this._queueRefresh(!0)))),this._queueRefresh(!0)}_refreshDrawConstants(){let m=Math.floor(this._canvas.width/3),v=Math.ceil(this._canvas.width/3);a.full=this._canvas.width,a.left=m,a.center=v,a.right=m,this._refreshDrawHeightConstants(),c.full=0,c.left=0,c.center=a.left,c.right=a.left+a.center}_refreshDrawHeightConstants(){o.full=Math.round(2*this._coreBrowseService.dpr);let m=this._canvas.height/this._bufferService.buffer.lines.length,v=Math.round(Math.max(Math.min(m,12),6)*this._coreBrowseService.dpr);o.left=v,o.center=v,o.right=v}_refreshColorZonePadding(){this._colorZoneStore.setPadding({full:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*o.full),left:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*o.left),center:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*o.center),right:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*o.right)}),this._lastKnownBufferLength=this._bufferService.buffers.normal.lines.length}_refreshCanvasDimensions(){this._canvas.style.width=`${this._width}px`,this._canvas.width=Math.round(this._width*this._coreBrowseService.dpr),this._canvas.style.height=`${this._screenElement.clientHeight}px`,this._canvas.height=Math.round(this._screenElement.clientHeight*this._coreBrowseService.dpr),this._refreshDrawConstants(),this._refreshColorZonePadding()}_refreshDecorations(){this._shouldUpdateDimensions&&this._refreshCanvasDimensions(),this._ctx.clearRect(0,0,this._canvas.width,this._canvas.height),this._colorZoneStore.clear();for(let v of this._decorationService.decorations)this._colorZoneStore.addDecoration(v);this._ctx.lineWidth=1;let m=this._colorZoneStore.zones;for(let v of m)v.position!=="full"&&this._renderColorZone(v);for(let v of m)v.position==="full"&&this._renderColorZone(v);this._shouldUpdateDimensions=!1,this._shouldUpdateAnchor=!1}_renderColorZone(m){this._ctx.fillStyle=m.color,this._ctx.fillRect(c[m.position||"full"],Math.round((this._canvas.height-1)*(m.startBufferLine/this._bufferService.buffers.active.lines.length)-o[m.position||"full"]/2),a[m.position||"full"],Math.round((this._canvas.height-1)*((m.endBufferLine-m.startBufferLine)/this._bufferService.buffers.active.lines.length)+o[m.position||"full"]))}_queueRefresh(m,v){this._shouldUpdateDimensions=m||this._shouldUpdateDimensions,this._shouldUpdateAnchor=v||this._shouldUpdateAnchor,this._animationFrame===void 0&&(this._animationFrame=this._coreBrowseService.window.requestAnimationFrame((()=>{this._refreshDecorations(),this._animationFrame=void 0})))}};s.OverviewRulerRenderer=h=l([p(2,b.IBufferService),p(3,b.IDecorationService),p(4,g.IRenderService),p(5,b.IOptionsService),p(6,g.ICoreBrowserService)],h)},2950:function(u,s,r){var l=this&&this.__decorate||function(b,o,a,c){var h,m=arguments.length,v=m<3?o:c===null?c=Object.getOwnPropertyDescriptor(o,a):c;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")v=Reflect.decorate(b,o,a,c);else for(var w=b.length-1;w>=0;w--)(h=b[w])&&(v=(m<3?h(v):m>3?h(o,a,v):h(o,a))||v);return m>3&&v&&Object.defineProperty(o,a,v),v},p=this&&this.__param||function(b,o){return function(a,c){o(a,c,b)}};Object.defineProperty(s,"__esModule",{value:!0}),s.CompositionHelper=void 0;let d=r(4725),f=r(2585),g=r(2584),y=s.CompositionHelper=class{get isComposing(){return this._isComposing}constructor(b,o,a,c,h,m){this._textarea=b,this._compositionView=o,this._bufferService=a,this._optionsService=c,this._coreService=h,this._renderService=m,this._isComposing=!1,this._isSendingComposition=!1,this._compositionPosition={start:0,end:0},this._dataAlreadySent=""}compositionstart(){this._isComposing=!0,this._compositionPosition.start=this._textarea.value.length,this._compositionView.textContent="",this._dataAlreadySent="",this._compositionView.classList.add("active")}compositionupdate(b){this._compositionView.textContent=b.data,this.updateCompositionElements(),setTimeout((()=>{this._compositionPosition.end=this._textarea.value.length}),0)}compositionend(){this._finalizeComposition(!0)}keydown(b){if(this._isComposing||this._isSendingComposition){if(b.keyCode===229||b.keyCode===16||b.keyCode===17||b.keyCode===18)return!1;this._finalizeComposition(!1)}return b.keyCode!==229||(this._handleAnyTextareaChanges(),!1)}_finalizeComposition(b){if(this._compositionView.classList.remove("active"),this._isComposing=!1,b){let o={start:this._compositionPosition.start,end:this._compositionPosition.end};this._isSendingComposition=!0,setTimeout((()=>{if(this._isSendingComposition){let a;this._isSendingComposition=!1,o.start+=this._dataAlreadySent.length,a=this._isComposing?this._textarea.value.substring(o.start,o.end):this._textarea.value.substring(o.start),a.length>0&&this._coreService.triggerDataEvent(a,!0)}}),0)}else{this._isSendingComposition=!1;let o=this._textarea.value.substring(this._compositionPosition.start,this._compositionPosition.end);this._coreService.triggerDataEvent(o,!0)}}_handleAnyTextareaChanges(){let b=this._textarea.value;setTimeout((()=>{if(!this._isComposing){let o=this._textarea.value,a=o.replace(b,"");this._dataAlreadySent=a,o.length>b.length?this._coreService.triggerDataEvent(a,!0):o.length<b.length?this._coreService.triggerDataEvent(`${g.C0.DEL}`,!0):o.length===b.length&&o!==b&&this._coreService.triggerDataEvent(o,!0)}}),0)}updateCompositionElements(b){if(this._isComposing){if(this._bufferService.buffer.isCursorInViewport){let o=Math.min(this._bufferService.buffer.x,this._bufferService.cols-1),a=this._renderService.dimensions.css.cell.height,c=this._bufferService.buffer.y*this._renderService.dimensions.css.cell.height,h=o*this._renderService.dimensions.css.cell.width;this._compositionView.style.left=h+"px",this._compositionView.style.top=c+"px",this._compositionView.style.height=a+"px",this._compositionView.style.lineHeight=a+"px",this._compositionView.style.fontFamily=this._optionsService.rawOptions.fontFamily,this._compositionView.style.fontSize=this._optionsService.rawOptions.fontSize+"px";let m=this._compositionView.getBoundingClientRect();this._textarea.style.left=h+"px",this._textarea.style.top=c+"px",this._textarea.style.width=Math.max(m.width,1)+"px",this._textarea.style.height=Math.max(m.height,1)+"px",this._textarea.style.lineHeight=m.height+"px"}b||setTimeout((()=>this.updateCompositionElements(!0)),0)}}};s.CompositionHelper=y=l([p(2,f.IBufferService),p(3,f.IOptionsService),p(4,f.ICoreService),p(5,d.IRenderService)],y)},9806:(u,s)=>{function r(l,p,d){let f=d.getBoundingClientRect(),g=l.getComputedStyle(d),y=parseInt(g.getPropertyValue("padding-left")),b=parseInt(g.getPropertyValue("padding-top"));return[p.clientX-f.left-y,p.clientY-f.top-b]}Object.defineProperty(s,"__esModule",{value:!0}),s.getCoords=s.getCoordsRelativeToElement=void 0,s.getCoordsRelativeToElement=r,s.getCoords=function(l,p,d,f,g,y,b,o,a){if(!y)return;let c=r(l,p,d);return c?(c[0]=Math.ceil((c[0]+(a?b/2:0))/b),c[1]=Math.ceil(c[1]/o),c[0]=Math.min(Math.max(c[0],1),f+(a?1:0)),c[1]=Math.min(Math.max(c[1],1),g),c):void 0}},9504:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.moveToCellSequence=void 0;let l=r(2584);function p(o,a,c,h){let m=o-d(o,c),v=a-d(a,c),w=Math.abs(m-v)-(function(C,_,S){let T=0,$=C-d(C,S),D=_-d(_,S);for(let O=0;O<Math.abs($-D);O++){let z=f(C,_)==="A"?-1:1,I=S.buffer.lines.get($+z*O);I?.isWrapped&&T++}return T})(o,a,c);return b(w,y(f(o,a),h))}function d(o,a){let c=0,h=a.buffer.lines.get(o),m=h?.isWrapped;for(;m&&o>=0&&o<a.rows;)c++,h=a.buffer.lines.get(--o),m=h?.isWrapped;return c}function f(o,a){return o>a?"A":"B"}function g(o,a,c,h,m,v){let w=o,C=a,_="";for(;w!==c||C!==h;)w+=m?1:-1,m&&w>v.cols-1?(_+=v.buffer.translateBufferLineToString(C,!1,o,w),w=0,o=0,C++):!m&&w<0&&(_+=v.buffer.translateBufferLineToString(C,!1,0,o+1),w=v.cols-1,o=w,C--);return _+v.buffer.translateBufferLineToString(C,!1,o,w)}function y(o,a){let c=a?"O":"[";return l.C0.ESC+c+o}function b(o,a){o=Math.floor(o);let c="";for(let h=0;h<o;h++)c+=a;return c}s.moveToCellSequence=function(o,a,c,h){let m=c.buffer.x,v=c.buffer.y;if(!c.buffer.hasScrollback)return(function(_,S,T,$,D,O){return p(S,$,D,O).length===0?"":b(g(_,S,_,S-d(S,D),!1,D).length,y("D",O))})(m,v,0,a,c,h)+p(v,a,c,h)+(function(_,S,T,$,D,O){let z;z=p(S,$,D,O).length>0?$-d($,D):S;let I=$,B=(function(H,x,E,L,R,N){let j;return j=p(E,L,R,N).length>0?L-d(L,R):x,H<E&&j<=L||H>=E&&j<L?"C":"D"})(_,S,T,$,D,O);return b(g(_,z,T,I,B==="C",D).length,y(B,O))})(m,v,o,a,c,h);let w;if(v===a)return w=m>o?"D":"C",b(Math.abs(m-o),y(w,h));w=v>a?"D":"C";let C=Math.abs(v-a);return b((function(_,S){return S.cols-_})(v>a?o:m,c)+(C-1)*c.cols+1+((v>a?m:o)-1),y(w,h))}},1296:function(u,s,r){var l=this&&this.__decorate||function(D,O,z,I){var B,H=arguments.length,x=H<3?O:I===null?I=Object.getOwnPropertyDescriptor(O,z):I;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")x=Reflect.decorate(D,O,z,I);else for(var E=D.length-1;E>=0;E--)(B=D[E])&&(x=(H<3?B(x):H>3?B(O,z,x):B(O,z))||x);return H>3&&x&&Object.defineProperty(O,z,x),x},p=this&&this.__param||function(D,O){return function(z,I){O(z,I,D)}};Object.defineProperty(s,"__esModule",{value:!0}),s.DomRenderer=void 0;let d=r(3787),f=r(2550),g=r(2223),y=r(6171),b=r(4725),o=r(8055),a=r(8460),c=r(844),h=r(2585),m="xterm-dom-renderer-owner-",v="xterm-rows",w="xterm-fg-",C="xterm-bg-",_="xterm-focus",S="xterm-selection",T=1,$=s.DomRenderer=class extends c.Disposable{constructor(D,O,z,I,B,H,x,E,L,R){super(),this._element=D,this._screenElement=O,this._viewportElement=z,this._linkifier2=I,this._charSizeService=H,this._optionsService=x,this._bufferService=E,this._coreBrowserService=L,this._themeService=R,this._terminalClass=T++,this._rowElements=[],this.onRequestRedraw=this.register(new a.EventEmitter).event,this._rowContainer=document.createElement("div"),this._rowContainer.classList.add(v),this._rowContainer.style.lineHeight="normal",this._rowContainer.setAttribute("aria-hidden","true"),this._refreshRowElements(this._bufferService.cols,this._bufferService.rows),this._selectionContainer=document.createElement("div"),this._selectionContainer.classList.add(S),this._selectionContainer.setAttribute("aria-hidden","true"),this.dimensions=(0,y.createRenderDimensions)(),this._updateDimensions(),this.register(this._optionsService.onOptionChange((()=>this._handleOptionsChanged()))),this.register(this._themeService.onChangeColors((N=>this._injectCss(N)))),this._injectCss(this._themeService.colors),this._rowFactory=B.createInstance(d.DomRendererRowFactory,document),this._element.classList.add(m+this._terminalClass),this._screenElement.appendChild(this._rowContainer),this._screenElement.appendChild(this._selectionContainer),this.register(this._linkifier2.onShowLinkUnderline((N=>this._handleLinkHover(N)))),this.register(this._linkifier2.onHideLinkUnderline((N=>this._handleLinkLeave(N)))),this.register((0,c.toDisposable)((()=>{this._element.classList.remove(m+this._terminalClass),this._rowContainer.remove(),this._selectionContainer.remove(),this._widthCache.dispose(),this._themeStyleElement.remove(),this._dimensionsStyleElement.remove()}))),this._widthCache=new f.WidthCache(document),this._widthCache.setFont(this._optionsService.rawOptions.fontFamily,this._optionsService.rawOptions.fontSize,this._optionsService.rawOptions.fontWeight,this._optionsService.rawOptions.fontWeightBold),this._setDefaultSpacing()}_updateDimensions(){let D=this._coreBrowserService.dpr;this.dimensions.device.char.width=this._charSizeService.width*D,this.dimensions.device.char.height=Math.ceil(this._charSizeService.height*D),this.dimensions.device.cell.width=this.dimensions.device.char.width+Math.round(this._optionsService.rawOptions.letterSpacing),this.dimensions.device.cell.height=Math.floor(this.dimensions.device.char.height*this._optionsService.rawOptions.lineHeight),this.dimensions.device.char.left=0,this.dimensions.device.char.top=0,this.dimensions.device.canvas.width=this.dimensions.device.cell.width*this._bufferService.cols,this.dimensions.device.canvas.height=this.dimensions.device.cell.height*this._bufferService.rows,this.dimensions.css.canvas.width=Math.round(this.dimensions.device.canvas.width/D),this.dimensions.css.canvas.height=Math.round(this.dimensions.device.canvas.height/D),this.dimensions.css.cell.width=this.dimensions.css.canvas.width/this._bufferService.cols,this.dimensions.css.cell.height=this.dimensions.css.canvas.height/this._bufferService.rows;for(let z of this._rowElements)z.style.width=`${this.dimensions.css.canvas.width}px`,z.style.height=`${this.dimensions.css.cell.height}px`,z.style.lineHeight=`${this.dimensions.css.cell.height}px`,z.style.overflow="hidden";this._dimensionsStyleElement||(this._dimensionsStyleElement=document.createElement("style"),this._screenElement.appendChild(this._dimensionsStyleElement));let O=`${this._terminalSelector} .${v} span { display: inline-block; height: 100%; vertical-align: top;}`;this._dimensionsStyleElement.textContent=O,this._selectionContainer.style.height=this._viewportElement.style.height,this._screenElement.style.width=`${this.dimensions.css.canvas.width}px`,this._screenElement.style.height=`${this.dimensions.css.canvas.height}px`}_injectCss(D){this._themeStyleElement||(this._themeStyleElement=document.createElement("style"),this._screenElement.appendChild(this._themeStyleElement));let O=`${this._terminalSelector} .${v} { color: ${D.foreground.css}; font-family: ${this._optionsService.rawOptions.fontFamily}; font-size: ${this._optionsService.rawOptions.fontSize}px; font-kerning: none; white-space: pre}`;O+=`${this._terminalSelector} .${v} .xterm-dim { color: ${o.color.multiplyOpacity(D.foreground,.5).css};}`,O+=`${this._terminalSelector} span:not(.xterm-bold) { font-weight: ${this._optionsService.rawOptions.fontWeight};}${this._terminalSelector} span.xterm-bold { font-weight: ${this._optionsService.rawOptions.fontWeightBold};}${this._terminalSelector} span.xterm-italic { font-style: italic;}`,O+="@keyframes blink_box_shadow_"+this._terminalClass+" { 50% {  border-bottom-style: hidden; }}",O+="@keyframes blink_block_"+this._terminalClass+` { 0% {  background-color: ${D.cursor.css};  color: ${D.cursorAccent.css}; } 50% {  background-color: inherit;  color: ${D.cursor.css}; }}`,O+=`${this._terminalSelector} .${v}.${_} .xterm-cursor.xterm-cursor-blink:not(.xterm-cursor-block) { animation: blink_box_shadow_`+this._terminalClass+` 1s step-end infinite;}${this._terminalSelector} .${v}.${_} .xterm-cursor.xterm-cursor-blink.xterm-cursor-block { animation: blink_block_`+this._terminalClass+` 1s step-end infinite;}${this._terminalSelector} .${v} .xterm-cursor.xterm-cursor-block { background-color: ${D.cursor.css}; color: ${D.cursorAccent.css};}${this._terminalSelector} .${v} .xterm-cursor.xterm-cursor-outline { outline: 1px solid ${D.cursor.css}; outline-offset: -1px;}${this._terminalSelector} .${v} .xterm-cursor.xterm-cursor-bar { box-shadow: ${this._optionsService.rawOptions.cursorWidth}px 0 0 ${D.cursor.css} inset;}${this._terminalSelector} .${v} .xterm-cursor.xterm-cursor-underline { border-bottom: 1px ${D.cursor.css}; border-bottom-style: solid; height: calc(100% - 1px);}`,O+=`${this._terminalSelector} .${S} { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none;}${this._terminalSelector}.focus .${S} div { position: absolute; background-color: ${D.selectionBackgroundOpaque.css};}${this._terminalSelector} .${S} div { position: absolute; background-color: ${D.selectionInactiveBackgroundOpaque.css};}`;for(let[z,I]of D.ansi.entries())O+=`${this._terminalSelector} .${w}${z} { color: ${I.css}; }${this._terminalSelector} .${w}${z}.xterm-dim { color: ${o.color.multiplyOpacity(I,.5).css}; }${this._terminalSelector} .${C}${z} { background-color: ${I.css}; }`;O+=`${this._terminalSelector} .${w}${g.INVERTED_DEFAULT_COLOR} { color: ${o.color.opaque(D.background).css}; }${this._terminalSelector} .${w}${g.INVERTED_DEFAULT_COLOR}.xterm-dim { color: ${o.color.multiplyOpacity(o.color.opaque(D.background),.5).css}; }${this._terminalSelector} .${C}${g.INVERTED_DEFAULT_COLOR} { background-color: ${D.foreground.css}; }`,this._themeStyleElement.textContent=O}_setDefaultSpacing(){let D=this.dimensions.css.cell.width-this._widthCache.get("W",!1,!1);this._rowContainer.style.letterSpacing=`${D}px`,this._rowFactory.defaultSpacing=D}handleDevicePixelRatioChange(){this._updateDimensions(),this._widthCache.clear(),this._setDefaultSpacing()}_refreshRowElements(D,O){for(let z=this._rowElements.length;z<=O;z++){let I=document.createElement("div");this._rowContainer.appendChild(I),this._rowElements.push(I)}for(;this._rowElements.length>O;)this._rowContainer.removeChild(this._rowElements.pop())}handleResize(D,O){this._refreshRowElements(D,O),this._updateDimensions()}handleCharSizeChanged(){this._updateDimensions(),this._widthCache.clear(),this._setDefaultSpacing()}handleBlur(){this._rowContainer.classList.remove(_)}handleFocus(){this._rowContainer.classList.add(_),this.renderRows(this._bufferService.buffer.y,this._bufferService.buffer.y)}handleSelectionChanged(D,O,z){if(this._selectionContainer.replaceChildren(),this._rowFactory.handleSelectionChanged(D,O,z),this.renderRows(0,this._bufferService.rows-1),!D||!O)return;let I=D[1]-this._bufferService.buffer.ydisp,B=O[1]-this._bufferService.buffer.ydisp,H=Math.max(I,0),x=Math.min(B,this._bufferService.rows-1);if(H>=this._bufferService.rows||x<0)return;let E=document.createDocumentFragment();if(z){let L=D[0]>O[0];E.appendChild(this._createSelectionElement(H,L?O[0]:D[0],L?D[0]:O[0],x-H+1))}else{let L=I===H?D[0]:0,R=H===B?O[0]:this._bufferService.cols;E.appendChild(this._createSelectionElement(H,L,R));let N=x-H-1;if(E.appendChild(this._createSelectionElement(H+1,0,this._bufferService.cols,N)),H!==x){let j=B===x?O[0]:this._bufferService.cols;E.appendChild(this._createSelectionElement(x,0,j))}}this._selectionContainer.appendChild(E)}_createSelectionElement(D,O,z,I=1){let B=document.createElement("div");return B.style.height=I*this.dimensions.css.cell.height+"px",B.style.top=D*this.dimensions.css.cell.height+"px",B.style.left=O*this.dimensions.css.cell.width+"px",B.style.width=this.dimensions.css.cell.width*(z-O)+"px",B}handleCursorMove(){}_handleOptionsChanged(){this._updateDimensions(),this._injectCss(this._themeService.colors),this._widthCache.setFont(this._optionsService.rawOptions.fontFamily,this._optionsService.rawOptions.fontSize,this._optionsService.rawOptions.fontWeight,this._optionsService.rawOptions.fontWeightBold),this._setDefaultSpacing()}clear(){for(let D of this._rowElements)D.replaceChildren()}renderRows(D,O){let z=this._bufferService.buffer,I=z.ybase+z.y,B=Math.min(z.x,this._bufferService.cols-1),H=this._optionsService.rawOptions.cursorBlink,x=this._optionsService.rawOptions.cursorStyle,E=this._optionsService.rawOptions.cursorInactiveStyle;for(let L=D;L<=O;L++){let R=L+z.ydisp,N=this._rowElements[L],j=z.lines.get(R);if(!N||!j)break;N.replaceChildren(...this._rowFactory.createRow(j,R,R===I,x,E,B,H,this.dimensions.css.cell.width,this._widthCache,-1,-1))}}get _terminalSelector(){return`.${m}${this._terminalClass}`}_handleLinkHover(D){this._setCellUnderline(D.x1,D.x2,D.y1,D.y2,D.cols,!0)}_handleLinkLeave(D){this._setCellUnderline(D.x1,D.x2,D.y1,D.y2,D.cols,!1)}_setCellUnderline(D,O,z,I,B,H){z<0&&(D=0),I<0&&(O=0);let x=this._bufferService.rows-1;z=Math.max(Math.min(z,x),0),I=Math.max(Math.min(I,x),0),B=Math.min(B,this._bufferService.cols);let E=this._bufferService.buffer,L=E.ybase+E.y,R=Math.min(E.x,B-1),N=this._optionsService.rawOptions.cursorBlink,j=this._optionsService.rawOptions.cursorStyle,X=this._optionsService.rawOptions.cursorInactiveStyle;for(let G=z;G<=I;++G){let fe=G+E.ydisp,k=this._rowElements[G],F=E.lines.get(fe);if(!k||!F)break;k.replaceChildren(...this._rowFactory.createRow(F,fe,fe===L,j,X,R,N,this.dimensions.css.cell.width,this._widthCache,H?G===z?D:0:-1,H?(G===I?O:B)-1:-1))}}};s.DomRenderer=$=l([p(4,h.IInstantiationService),p(5,b.ICharSizeService),p(6,h.IOptionsService),p(7,h.IBufferService),p(8,b.ICoreBrowserService),p(9,b.IThemeService)],$)},3787:function(u,s,r){var l=this&&this.__decorate||function(w,C,_,S){var T,$=arguments.length,D=$<3?C:S===null?S=Object.getOwnPropertyDescriptor(C,_):S;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")D=Reflect.decorate(w,C,_,S);else for(var O=w.length-1;O>=0;O--)(T=w[O])&&(D=($<3?T(D):$>3?T(C,_,D):T(C,_))||D);return $>3&&D&&Object.defineProperty(C,_,D),D},p=this&&this.__param||function(w,C){return function(_,S){C(_,S,w)}};Object.defineProperty(s,"__esModule",{value:!0}),s.DomRendererRowFactory=void 0;let d=r(2223),f=r(643),g=r(511),y=r(2585),b=r(8055),o=r(4725),a=r(4269),c=r(6171),h=r(3734),m=s.DomRendererRowFactory=class{constructor(w,C,_,S,T,$,D){this._document=w,this._characterJoinerService=C,this._optionsService=_,this._coreBrowserService=S,this._coreService=T,this._decorationService=$,this._themeService=D,this._workCell=new g.CellData,this._columnSelectMode=!1,this.defaultSpacing=0}handleSelectionChanged(w,C,_){this._selectionStart=w,this._selectionEnd=C,this._columnSelectMode=_}createRow(w,C,_,S,T,$,D,O,z,I,B){let H=[],x=this._characterJoinerService.getJoinedCharacters(C),E=this._themeService.colors,L,R=w.getNoBgTrimmedLength();_&&R<$+1&&(R=$+1);let N=0,j="",X=0,G=0,fe=0,k=!1,F=0,U=!1,W=0,re=[],q=I!==-1&&B!==-1;for(let me=0;me<R;me++){w.loadCell(me,this._workCell);let Le=this._workCell.getWidth();if(Le===0)continue;let He=!1,ci=me,ae=this._workCell;if(x.length>0&&me===x[0][0]){He=!0;let ye=x.shift();ae=new a.JoinedCellData(this._workCell,w.translateToString(!0,ye[0],ye[1]),ye[1]-ye[0]),ci=ye[1]-1,Le=ae.getWidth()}let Ii=this._isCellInSelection(me,C),xr=_&&me===$,kr=q&&me>=I&&me<=B,Er=!1;this._decorationService.forEachDecorationAtCell(me,C,void 0,(ye=>{Er=!0}));let Ts=ae.getChars()||f.WHITESPACE_CELL_CHAR;if(Ts===" "&&(ae.isUnderline()||ae.isOverline())&&(Ts="\xA0"),W=Le*O-z.get(Ts,ae.isBold(),ae.isItalic()),L){if(N&&(Ii&&U||!Ii&&!U&&ae.bg===X)&&(Ii&&U&&E.selectionForeground||ae.fg===G)&&ae.extended.ext===fe&&kr===k&&W===F&&!xr&&!He&&!Er){j+=Ts,N++;continue}N&&(L.textContent=j),L=this._document.createElement("span"),N=0,j=""}else L=this._document.createElement("span");if(X=ae.bg,G=ae.fg,fe=ae.extended.ext,k=kr,F=W,U=Ii,He&&$>=me&&$<=ci&&($=me),!this._coreService.isCursorHidden&&xr){if(re.push("xterm-cursor"),this._coreBrowserService.isFocused)D&&re.push("xterm-cursor-blink"),re.push(S==="bar"?"xterm-cursor-bar":S==="underline"?"xterm-cursor-underline":"xterm-cursor-block");else if(T)switch(T){case"outline":re.push("xterm-cursor-outline");break;case"block":re.push("xterm-cursor-block");break;case"bar":re.push("xterm-cursor-bar");break;case"underline":re.push("xterm-cursor-underline")}}if(ae.isBold()&&re.push("xterm-bold"),ae.isItalic()&&re.push("xterm-italic"),ae.isDim()&&re.push("xterm-dim"),j=ae.isInvisible()?f.WHITESPACE_CELL_CHAR:ae.getChars()||f.WHITESPACE_CELL_CHAR,ae.isUnderline()&&(re.push(`xterm-underline-${ae.extended.underlineStyle}`),j===" "&&(j="\xA0"),!ae.isUnderlineColorDefault()))if(ae.isUnderlineColorRGB())L.style.textDecorationColor=`rgb(${h.AttributeData.toColorRGB(ae.getUnderlineColor()).join(",")})`;else{let ye=ae.getUnderlineColor();this._optionsService.rawOptions.drawBoldTextInBrightColors&&ae.isBold()&&ye<8&&(ye+=8),L.style.textDecorationColor=E.ansi[ye].css}ae.isOverline()&&(re.push("xterm-overline"),j===" "&&(j="\xA0")),ae.isStrikethrough()&&re.push("xterm-strikethrough"),kr&&(L.style.textDecoration="underline");let je=ae.getFgColor(),Hi=ae.getFgColorMode(),st=ae.getBgColor(),Fi=ae.getBgColorMode(),Ar=!!ae.isInverse();if(Ar){let ye=je;je=st,st=ye;let wc=Hi;Hi=Fi,Fi=wc}let wt,Lr,St,zi=!1;switch(this._decorationService.forEachDecorationAtCell(me,C,void 0,(ye=>{ye.options.layer!=="top"&&zi||(ye.backgroundColorRGB&&(Fi=50331648,st=ye.backgroundColorRGB.rgba>>8&16777215,wt=ye.backgroundColorRGB),ye.foregroundColorRGB&&(Hi=50331648,je=ye.foregroundColorRGB.rgba>>8&16777215,Lr=ye.foregroundColorRGB),zi=ye.options.layer==="top")})),!zi&&Ii&&(wt=this._coreBrowserService.isFocused?E.selectionBackgroundOpaque:E.selectionInactiveBackgroundOpaque,st=wt.rgba>>8&16777215,Fi=50331648,zi=!0,E.selectionForeground&&(Hi=50331648,je=E.selectionForeground.rgba>>8&16777215,Lr=E.selectionForeground)),zi&&re.push("xterm-decoration-top"),Fi){case 16777216:case 33554432:St=E.ansi[st],re.push(`xterm-bg-${st}`);break;case 50331648:St=b.rgba.toColor(st>>16,st>>8&255,255&st),this._addStyle(L,`background-color:#${v((st>>>0).toString(16),"0",6)}`);break;default:Ar?(St=E.foreground,re.push(`xterm-bg-${d.INVERTED_DEFAULT_COLOR}`)):St=E.background}switch(wt||ae.isDim()&&(wt=b.color.multiplyOpacity(St,.5)),Hi){case 16777216:case 33554432:ae.isBold()&&je<8&&this._optionsService.rawOptions.drawBoldTextInBrightColors&&(je+=8),this._applyMinimumContrast(L,St,E.ansi[je],ae,wt,void 0)||re.push(`xterm-fg-${je}`);break;case 50331648:let ye=b.rgba.toColor(je>>16&255,je>>8&255,255&je);this._applyMinimumContrast(L,St,ye,ae,wt,Lr)||this._addStyle(L,`color:#${v(je.toString(16),"0",6)}`);break;default:this._applyMinimumContrast(L,St,E.foreground,ae,wt,void 0)||Ar&&re.push(`xterm-fg-${d.INVERTED_DEFAULT_COLOR}`)}re.length&&(L.className=re.join(" "),re.length=0),xr||He||Er?L.textContent=j:N++,W!==this.defaultSpacing&&(L.style.letterSpacing=`${W}px`),H.push(L),me=ci}return L&&N&&(L.textContent=j),H}_applyMinimumContrast(w,C,_,S,T,$){if(this._optionsService.rawOptions.minimumContrastRatio===1||(0,c.excludeFromContrastRatioDemands)(S.getCode()))return!1;let D=this._getContrastCache(S),O;if(T||$||(O=D.getColor(C.rgba,_.rgba)),O===void 0){let z=this._optionsService.rawOptions.minimumContrastRatio/(S.isDim()?2:1);O=b.color.ensureContrastRatio(T||C,$||_,z),D.setColor((T||C).rgba,($||_).rgba,O??null)}return!!O&&(this._addStyle(w,`color:${O.css}`),!0)}_getContrastCache(w){return w.isDim()?this._themeService.colors.halfContrastCache:this._themeService.colors.contrastCache}_addStyle(w,C){w.setAttribute("style",`${w.getAttribute("style")||""}${C};`)}_isCellInSelection(w,C){let _=this._selectionStart,S=this._selectionEnd;return!(!_||!S)&&(this._columnSelectMode?_[0]<=S[0]?w>=_[0]&&C>=_[1]&&w<S[0]&&C<=S[1]:w<_[0]&&C>=_[1]&&w>=S[0]&&C<=S[1]:C>_[1]&&C<S[1]||_[1]===S[1]&&C===_[1]&&w>=_[0]&&w<S[0]||_[1]<S[1]&&C===S[1]&&w<S[0]||_[1]<S[1]&&C===_[1]&&w>=_[0])}};function v(w,C,_){for(;w.length<_;)w=C+w;return w}s.DomRendererRowFactory=m=l([p(1,o.ICharacterJoinerService),p(2,y.IOptionsService),p(3,o.ICoreBrowserService),p(4,y.ICoreService),p(5,y.IDecorationService),p(6,o.IThemeService)],m)},2550:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.WidthCache=void 0,s.WidthCache=class{constructor(r){this._flat=new Float32Array(256),this._font="",this._fontSize=0,this._weight="normal",this._weightBold="bold",this._measureElements=[],this._container=r.createElement("div"),this._container.style.position="absolute",this._container.style.top="-50000px",this._container.style.width="50000px",this._container.style.whiteSpace="pre",this._container.style.fontKerning="none";let l=r.createElement("span"),p=r.createElement("span");p.style.fontWeight="bold";let d=r.createElement("span");d.style.fontStyle="italic";let f=r.createElement("span");f.style.fontWeight="bold",f.style.fontStyle="italic",this._measureElements=[l,p,d,f],this._container.appendChild(l),this._container.appendChild(p),this._container.appendChild(d),this._container.appendChild(f),r.body.appendChild(this._container),this.clear()}dispose(){this._container.remove(),this._measureElements.length=0,this._holey=void 0}clear(){this._flat.fill(-9999),this._holey=new Map}setFont(r,l,p,d){r===this._font&&l===this._fontSize&&p===this._weight&&d===this._weightBold||(this._font=r,this._fontSize=l,this._weight=p,this._weightBold=d,this._container.style.fontFamily=this._font,this._container.style.fontSize=`${this._fontSize}px`,this._measureElements[0].style.fontWeight=`${p}`,this._measureElements[1].style.fontWeight=`${d}`,this._measureElements[2].style.fontWeight=`${p}`,this._measureElements[3].style.fontWeight=`${d}`,this.clear())}get(r,l,p){let d=0;if(!l&&!p&&r.length===1&&(d=r.charCodeAt(0))<256)return this._flat[d]!==-9999?this._flat[d]:this._flat[d]=this._measure(r,0);let f=r;l&&(f+="B"),p&&(f+="I");let g=this._holey.get(f);if(g===void 0){let y=0;l&&(y|=1),p&&(y|=2),g=this._measure(r,y),this._holey.set(f,g)}return g}_measure(r,l){let p=this._measureElements[l];return p.textContent=r.repeat(32),p.offsetWidth/32}}},2223:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.TEXT_BASELINE=s.DIM_OPACITY=s.INVERTED_DEFAULT_COLOR=void 0;let l=r(6114);s.INVERTED_DEFAULT_COLOR=257,s.DIM_OPACITY=.5,s.TEXT_BASELINE=l.isFirefox||l.isLegacyEdge?"bottom":"ideographic"},6171:(u,s)=>{function r(l){return 57508<=l&&l<=57558}Object.defineProperty(s,"__esModule",{value:!0}),s.createRenderDimensions=s.excludeFromContrastRatioDemands=s.isRestrictedPowerlineGlyph=s.isPowerlineGlyph=s.throwIfFalsy=void 0,s.throwIfFalsy=function(l){if(!l)throw new Error("value must not be falsy");return l},s.isPowerlineGlyph=r,s.isRestrictedPowerlineGlyph=function(l){return 57520<=l&&l<=57527},s.excludeFromContrastRatioDemands=function(l){return r(l)||(function(p){return 9472<=p&&p<=9631})(l)},s.createRenderDimensions=function(){return{css:{canvas:{width:0,height:0},cell:{width:0,height:0}},device:{canvas:{width:0,height:0},cell:{width:0,height:0},char:{width:0,height:0,left:0,top:0}}}}},456:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.SelectionModel=void 0,s.SelectionModel=class{constructor(r){this._bufferService=r,this.isSelectAllActive=!1,this.selectionStartLength=0}clearSelection(){this.selectionStart=void 0,this.selectionEnd=void 0,this.isSelectAllActive=!1,this.selectionStartLength=0}get finalSelectionStart(){return this.isSelectAllActive?[0,0]:this.selectionEnd&&this.selectionStart&&this.areSelectionValuesReversed()?this.selectionEnd:this.selectionStart}get finalSelectionEnd(){if(this.isSelectAllActive)return[this._bufferService.cols,this._bufferService.buffer.ybase+this._bufferService.rows-1];if(this.selectionStart){if(!this.selectionEnd||this.areSelectionValuesReversed()){let r=this.selectionStart[0]+this.selectionStartLength;return r>this._bufferService.cols?r%this._bufferService.cols==0?[this._bufferService.cols,this.selectionStart[1]+Math.floor(r/this._bufferService.cols)-1]:[r%this._bufferService.cols,this.selectionStart[1]+Math.floor(r/this._bufferService.cols)]:[r,this.selectionStart[1]]}if(this.selectionStartLength&&this.selectionEnd[1]===this.selectionStart[1]){let r=this.selectionStart[0]+this.selectionStartLength;return r>this._bufferService.cols?[r%this._bufferService.cols,this.selectionStart[1]+Math.floor(r/this._bufferService.cols)]:[Math.max(r,this.selectionEnd[0]),this.selectionEnd[1]]}return this.selectionEnd}}areSelectionValuesReversed(){let r=this.selectionStart,l=this.selectionEnd;return!(!r||!l)&&(r[1]>l[1]||r[1]===l[1]&&r[0]>l[0])}handleTrim(r){return this.selectionStart&&(this.selectionStart[1]-=r),this.selectionEnd&&(this.selectionEnd[1]-=r),this.selectionEnd&&this.selectionEnd[1]<0?(this.clearSelection(),!0):(this.selectionStart&&this.selectionStart[1]<0&&(this.selectionStart[1]=0),!1)}}},428:function(u,s,r){var l=this&&this.__decorate||function(o,a,c,h){var m,v=arguments.length,w=v<3?a:h===null?h=Object.getOwnPropertyDescriptor(a,c):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")w=Reflect.decorate(o,a,c,h);else for(var C=o.length-1;C>=0;C--)(m=o[C])&&(w=(v<3?m(w):v>3?m(a,c,w):m(a,c))||w);return v>3&&w&&Object.defineProperty(a,c,w),w},p=this&&this.__param||function(o,a){return function(c,h){a(c,h,o)}};Object.defineProperty(s,"__esModule",{value:!0}),s.CharSizeService=void 0;let d=r(2585),f=r(8460),g=r(844),y=s.CharSizeService=class extends g.Disposable{get hasValidSize(){return this.width>0&&this.height>0}constructor(o,a,c){super(),this._optionsService=c,this.width=0,this.height=0,this._onCharSizeChange=this.register(new f.EventEmitter),this.onCharSizeChange=this._onCharSizeChange.event,this._measureStrategy=new b(o,a,this._optionsService),this.register(this._optionsService.onMultipleOptionChange(["fontFamily","fontSize"],(()=>this.measure())))}measure(){let o=this._measureStrategy.measure();o.width===this.width&&o.height===this.height||(this.width=o.width,this.height=o.height,this._onCharSizeChange.fire())}};s.CharSizeService=y=l([p(2,d.IOptionsService)],y);class b{constructor(a,c,h){this._document=a,this._parentElement=c,this._optionsService=h,this._result={width:0,height:0},this._measureElement=this._document.createElement("span"),this._measureElement.classList.add("xterm-char-measure-element"),this._measureElement.textContent="W".repeat(32),this._measureElement.setAttribute("aria-hidden","true"),this._measureElement.style.whiteSpace="pre",this._measureElement.style.fontKerning="none",this._parentElement.appendChild(this._measureElement)}measure(){this._measureElement.style.fontFamily=this._optionsService.rawOptions.fontFamily,this._measureElement.style.fontSize=`${this._optionsService.rawOptions.fontSize}px`;let a={height:Number(this._measureElement.offsetHeight),width:Number(this._measureElement.offsetWidth)};return a.width!==0&&a.height!==0&&(this._result.width=a.width/32,this._result.height=Math.ceil(a.height)),this._result}}},4269:function(u,s,r){var l=this&&this.__decorate||function(a,c,h,m){var v,w=arguments.length,C=w<3?c:m===null?m=Object.getOwnPropertyDescriptor(c,h):m;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")C=Reflect.decorate(a,c,h,m);else for(var _=a.length-1;_>=0;_--)(v=a[_])&&(C=(w<3?v(C):w>3?v(c,h,C):v(c,h))||C);return w>3&&C&&Object.defineProperty(c,h,C),C},p=this&&this.__param||function(a,c){return function(h,m){c(h,m,a)}};Object.defineProperty(s,"__esModule",{value:!0}),s.CharacterJoinerService=s.JoinedCellData=void 0;let d=r(3734),f=r(643),g=r(511),y=r(2585);class b extends d.AttributeData{constructor(c,h,m){super(),this.content=0,this.combinedData="",this.fg=c.fg,this.bg=c.bg,this.combinedData=h,this._width=m}isCombined(){return 2097152}getWidth(){return this._width}getChars(){return this.combinedData}getCode(){return 2097151}setFromCharData(c){throw new Error("not implemented")}getAsCharData(){return[this.fg,this.getChars(),this.getWidth(),this.getCode()]}}s.JoinedCellData=b;let o=s.CharacterJoinerService=class Vn{constructor(c){this._bufferService=c,this._characterJoiners=[],this._nextCharacterJoinerId=0,this._workCell=new g.CellData}register(c){let h={id:this._nextCharacterJoinerId++,handler:c};return this._characterJoiners.push(h),h.id}deregister(c){for(let h=0;h<this._characterJoiners.length;h++)if(this._characterJoiners[h].id===c)return this._characterJoiners.splice(h,1),!0;return!1}getJoinedCharacters(c){if(this._characterJoiners.length===0)return[];let h=this._bufferService.buffer.lines.get(c);if(!h||h.length===0)return[];let m=[],v=h.translateToString(!0),w=0,C=0,_=0,S=h.getFg(0),T=h.getBg(0);for(let $=0;$<h.getTrimmedLength();$++)if(h.loadCell($,this._workCell),this._workCell.getWidth()!==0){if(this._workCell.fg!==S||this._workCell.bg!==T){if($-w>1){let D=this._getJoinedRanges(v,_,C,h,w);for(let O=0;O<D.length;O++)m.push(D[O])}w=$,_=C,S=this._workCell.fg,T=this._workCell.bg}C+=this._workCell.getChars().length||f.WHITESPACE_CELL_CHAR.length}if(this._bufferService.cols-w>1){let $=this._getJoinedRanges(v,_,C,h,w);for(let D=0;D<$.length;D++)m.push($[D])}return m}_getJoinedRanges(c,h,m,v,w){let C=c.substring(h,m),_=[];try{_=this._characterJoiners[0].handler(C)}catch(S){console.error(S)}for(let S=1;S<this._characterJoiners.length;S++)try{let T=this._characterJoiners[S].handler(C);for(let $=0;$<T.length;$++)Vn._mergeRanges(_,T[$])}catch(T){console.error(T)}return this._stringRangesToCellRanges(_,v,w),_}_stringRangesToCellRanges(c,h,m){let v=0,w=!1,C=0,_=c[v];if(_){for(let S=m;S<this._bufferService.cols;S++){let T=h.getWidth(S),$=h.getString(S).length||f.WHITESPACE_CELL_CHAR.length;if(T!==0){if(!w&&_[0]<=C&&(_[0]=S,w=!0),_[1]<=C){if(_[1]=S,_=c[++v],!_)break;_[0]<=C?(_[0]=S,w=!0):w=!1}C+=$}}_&&(_[1]=this._bufferService.cols)}}static _mergeRanges(c,h){let m=!1;for(let v=0;v<c.length;v++){let w=c[v];if(m){if(h[1]<=w[0])return c[v-1][1]=h[1],c;if(h[1]<=w[1])return c[v-1][1]=Math.max(h[1],w[1]),c.splice(v,1),c;c.splice(v,1),v--}else{if(h[1]<=w[0])return c.splice(v,0,h),c;if(h[1]<=w[1])return w[0]=Math.min(h[0],w[0]),c;h[0]<w[1]&&(w[0]=Math.min(h[0],w[0]),m=!0)}}return m?c[c.length-1][1]=h[1]:c.push(h),c}};s.CharacterJoinerService=o=l([p(0,y.IBufferService)],o)},5114:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.CoreBrowserService=void 0,s.CoreBrowserService=class{constructor(r,l){this._textarea=r,this.window=l,this._isFocused=!1,this._cachedIsFocused=void 0,this._textarea.addEventListener("focus",(()=>this._isFocused=!0)),this._textarea.addEventListener("blur",(()=>this._isFocused=!1))}get dpr(){return this.window.devicePixelRatio}get isFocused(){return this._cachedIsFocused===void 0&&(this._cachedIsFocused=this._isFocused&&this._textarea.ownerDocument.hasFocus(),queueMicrotask((()=>this._cachedIsFocused=void 0))),this._cachedIsFocused}}},8934:function(u,s,r){var l=this&&this.__decorate||function(y,b,o,a){var c,h=arguments.length,m=h<3?b:a===null?a=Object.getOwnPropertyDescriptor(b,o):a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")m=Reflect.decorate(y,b,o,a);else for(var v=y.length-1;v>=0;v--)(c=y[v])&&(m=(h<3?c(m):h>3?c(b,o,m):c(b,o))||m);return h>3&&m&&Object.defineProperty(b,o,m),m},p=this&&this.__param||function(y,b){return function(o,a){b(o,a,y)}};Object.defineProperty(s,"__esModule",{value:!0}),s.MouseService=void 0;let d=r(4725),f=r(9806),g=s.MouseService=class{constructor(y,b){this._renderService=y,this._charSizeService=b}getCoords(y,b,o,a,c){return(0,f.getCoords)(window,y,b,o,a,this._charSizeService.hasValidSize,this._renderService.dimensions.css.cell.width,this._renderService.dimensions.css.cell.height,c)}getMouseReportCoords(y,b){let o=(0,f.getCoordsRelativeToElement)(window,y,b);if(this._charSizeService.hasValidSize)return o[0]=Math.min(Math.max(o[0],0),this._renderService.dimensions.css.canvas.width-1),o[1]=Math.min(Math.max(o[1],0),this._renderService.dimensions.css.canvas.height-1),{col:Math.floor(o[0]/this._renderService.dimensions.css.cell.width),row:Math.floor(o[1]/this._renderService.dimensions.css.cell.height),x:Math.floor(o[0]),y:Math.floor(o[1])}}};s.MouseService=g=l([p(0,d.IRenderService),p(1,d.ICharSizeService)],g)},3230:function(u,s,r){var l=this&&this.__decorate||function(m,v,w,C){var _,S=arguments.length,T=S<3?v:C===null?C=Object.getOwnPropertyDescriptor(v,w):C;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")T=Reflect.decorate(m,v,w,C);else for(var $=m.length-1;$>=0;$--)(_=m[$])&&(T=(S<3?_(T):S>3?_(v,w,T):_(v,w))||T);return S>3&&T&&Object.defineProperty(v,w,T),T},p=this&&this.__param||function(m,v){return function(w,C){v(w,C,m)}};Object.defineProperty(s,"__esModule",{value:!0}),s.RenderService=void 0;let d=r(3656),f=r(6193),g=r(5596),y=r(4725),b=r(8460),o=r(844),a=r(7226),c=r(2585),h=s.RenderService=class extends o.Disposable{get dimensions(){return this._renderer.value.dimensions}constructor(m,v,w,C,_,S,T,$){if(super(),this._rowCount=m,this._charSizeService=C,this._renderer=this.register(new o.MutableDisposable),this._pausedResizeTask=new a.DebouncedIdleTask,this._isPaused=!1,this._needsFullRefresh=!1,this._isNextRenderRedrawOnly=!0,this._needsSelectionRefresh=!1,this._canvasWidth=0,this._canvasHeight=0,this._selectionState={start:void 0,end:void 0,columnSelectMode:!1},this._onDimensionsChange=this.register(new b.EventEmitter),this.onDimensionsChange=this._onDimensionsChange.event,this._onRenderedViewportChange=this.register(new b.EventEmitter),this.onRenderedViewportChange=this._onRenderedViewportChange.event,this._onRender=this.register(new b.EventEmitter),this.onRender=this._onRender.event,this._onRefreshRequest=this.register(new b.EventEmitter),this.onRefreshRequest=this._onRefreshRequest.event,this._renderDebouncer=new f.RenderDebouncer(T.window,((D,O)=>this._renderRows(D,O))),this.register(this._renderDebouncer),this._screenDprMonitor=new g.ScreenDprMonitor(T.window),this._screenDprMonitor.setListener((()=>this.handleDevicePixelRatioChange())),this.register(this._screenDprMonitor),this.register(S.onResize((()=>this._fullRefresh()))),this.register(S.buffers.onBufferActivate((()=>{var D;return(D=this._renderer.value)===null||D===void 0?void 0:D.clear()}))),this.register(w.onOptionChange((()=>this._handleOptionsChanged()))),this.register(this._charSizeService.onCharSizeChange((()=>this.handleCharSizeChanged()))),this.register(_.onDecorationRegistered((()=>this._fullRefresh()))),this.register(_.onDecorationRemoved((()=>this._fullRefresh()))),this.register(w.onMultipleOptionChange(["customGlyphs","drawBoldTextInBrightColors","letterSpacing","lineHeight","fontFamily","fontSize","fontWeight","fontWeightBold","minimumContrastRatio"],(()=>{this.clear(),this.handleResize(S.cols,S.rows),this._fullRefresh()}))),this.register(w.onMultipleOptionChange(["cursorBlink","cursorStyle"],(()=>this.refreshRows(S.buffer.y,S.buffer.y,!0)))),this.register((0,d.addDisposableDomListener)(T.window,"resize",(()=>this.handleDevicePixelRatioChange()))),this.register($.onChangeColors((()=>this._fullRefresh()))),"IntersectionObserver"in T.window){let D=new T.window.IntersectionObserver((O=>this._handleIntersectionChange(O[O.length-1])),{threshold:0});D.observe(v),this.register({dispose:()=>D.disconnect()})}}_handleIntersectionChange(m){this._isPaused=m.isIntersecting===void 0?m.intersectionRatio===0:!m.isIntersecting,this._isPaused||this._charSizeService.hasValidSize||this._charSizeService.measure(),!this._isPaused&&this._needsFullRefresh&&(this._pausedResizeTask.flush(),this.refreshRows(0,this._rowCount-1),this._needsFullRefresh=!1)}refreshRows(m,v,w=!1){this._isPaused?this._needsFullRefresh=!0:(w||(this._isNextRenderRedrawOnly=!1),this._renderDebouncer.refresh(m,v,this._rowCount))}_renderRows(m,v){this._renderer.value&&(m=Math.min(m,this._rowCount-1),v=Math.min(v,this._rowCount-1),this._renderer.value.renderRows(m,v),this._needsSelectionRefresh&&(this._renderer.value.handleSelectionChanged(this._selectionState.start,this._selectionState.end,this._selectionState.columnSelectMode),this._needsSelectionRefresh=!1),this._isNextRenderRedrawOnly||this._onRenderedViewportChange.fire({start:m,end:v}),this._onRender.fire({start:m,end:v}),this._isNextRenderRedrawOnly=!0)}resize(m,v){this._rowCount=v,this._fireOnCanvasResize()}_handleOptionsChanged(){this._renderer.value&&(this.refreshRows(0,this._rowCount-1),this._fireOnCanvasResize())}_fireOnCanvasResize(){this._renderer.value&&(this._renderer.value.dimensions.css.canvas.width===this._canvasWidth&&this._renderer.value.dimensions.css.canvas.height===this._canvasHeight||this._onDimensionsChange.fire(this._renderer.value.dimensions))}hasRenderer(){return!!this._renderer.value}setRenderer(m){this._renderer.value=m,this._renderer.value.onRequestRedraw((v=>this.refreshRows(v.start,v.end,!0))),this._needsSelectionRefresh=!0,this._fullRefresh()}addRefreshCallback(m){return this._renderDebouncer.addRefreshCallback(m)}_fullRefresh(){this._isPaused?this._needsFullRefresh=!0:this.refreshRows(0,this._rowCount-1)}clearTextureAtlas(){var m,v;this._renderer.value&&((v=(m=this._renderer.value).clearTextureAtlas)===null||v===void 0||v.call(m),this._fullRefresh())}handleDevicePixelRatioChange(){this._charSizeService.measure(),this._renderer.value&&(this._renderer.value.handleDevicePixelRatioChange(),this.refreshRows(0,this._rowCount-1))}handleResize(m,v){this._renderer.value&&(this._isPaused?this._pausedResizeTask.set((()=>this._renderer.value.handleResize(m,v))):this._renderer.value.handleResize(m,v),this._fullRefresh())}handleCharSizeChanged(){var m;(m=this._renderer.value)===null||m===void 0||m.handleCharSizeChanged()}handleBlur(){var m;(m=this._renderer.value)===null||m===void 0||m.handleBlur()}handleFocus(){var m;(m=this._renderer.value)===null||m===void 0||m.handleFocus()}handleSelectionChanged(m,v,w){var C;this._selectionState.start=m,this._selectionState.end=v,this._selectionState.columnSelectMode=w,(C=this._renderer.value)===null||C===void 0||C.handleSelectionChanged(m,v,w)}handleCursorMove(){var m;(m=this._renderer.value)===null||m===void 0||m.handleCursorMove()}clear(){var m;(m=this._renderer.value)===null||m===void 0||m.clear()}};s.RenderService=h=l([p(2,c.IOptionsService),p(3,y.ICharSizeService),p(4,c.IDecorationService),p(5,c.IBufferService),p(6,y.ICoreBrowserService),p(7,y.IThemeService)],h)},9312:function(u,s,r){var l=this&&this.__decorate||function(_,S,T,$){var D,O=arguments.length,z=O<3?S:$===null?$=Object.getOwnPropertyDescriptor(S,T):$;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")z=Reflect.decorate(_,S,T,$);else for(var I=_.length-1;I>=0;I--)(D=_[I])&&(z=(O<3?D(z):O>3?D(S,T,z):D(S,T))||z);return O>3&&z&&Object.defineProperty(S,T,z),z},p=this&&this.__param||function(_,S){return function(T,$){S(T,$,_)}};Object.defineProperty(s,"__esModule",{value:!0}),s.SelectionService=void 0;let d=r(9806),f=r(9504),g=r(456),y=r(4725),b=r(8460),o=r(844),a=r(6114),c=r(4841),h=r(511),m=r(2585),v="\xA0",w=new RegExp(v,"g"),C=s.SelectionService=class extends o.Disposable{constructor(_,S,T,$,D,O,z,I,B){super(),this._element=_,this._screenElement=S,this._linkifier=T,this._bufferService=$,this._coreService=D,this._mouseService=O,this._optionsService=z,this._renderService=I,this._coreBrowserService=B,this._dragScrollAmount=0,this._enabled=!0,this._workCell=new h.CellData,this._mouseDownTimeStamp=0,this._oldHasSelection=!1,this._oldSelectionStart=void 0,this._oldSelectionEnd=void 0,this._onLinuxMouseSelection=this.register(new b.EventEmitter),this.onLinuxMouseSelection=this._onLinuxMouseSelection.event,this._onRedrawRequest=this.register(new b.EventEmitter),this.onRequestRedraw=this._onRedrawRequest.event,this._onSelectionChange=this.register(new b.EventEmitter),this.onSelectionChange=this._onSelectionChange.event,this._onRequestScrollLines=this.register(new b.EventEmitter),this.onRequestScrollLines=this._onRequestScrollLines.event,this._mouseMoveListener=H=>this._handleMouseMove(H),this._mouseUpListener=H=>this._handleMouseUp(H),this._coreService.onUserInput((()=>{this.hasSelection&&this.clearSelection()})),this._trimListener=this._bufferService.buffer.lines.onTrim((H=>this._handleTrim(H))),this.register(this._bufferService.buffers.onBufferActivate((H=>this._handleBufferActivate(H)))),this.enable(),this._model=new g.SelectionModel(this._bufferService),this._activeSelectionMode=0,this.register((0,o.toDisposable)((()=>{this._removeMouseDownListeners()})))}reset(){this.clearSelection()}disable(){this.clearSelection(),this._enabled=!1}enable(){this._enabled=!0}get selectionStart(){return this._model.finalSelectionStart}get selectionEnd(){return this._model.finalSelectionEnd}get hasSelection(){let _=this._model.finalSelectionStart,S=this._model.finalSelectionEnd;return!(!_||!S||_[0]===S[0]&&_[1]===S[1])}get selectionText(){let _=this._model.finalSelectionStart,S=this._model.finalSelectionEnd;if(!_||!S)return"";let T=this._bufferService.buffer,$=[];if(this._activeSelectionMode===3){if(_[0]===S[0])return"";let D=_[0]<S[0]?_[0]:S[0],O=_[0]<S[0]?S[0]:_[0];for(let z=_[1];z<=S[1];z++){let I=T.translateBufferLineToString(z,!0,D,O);$.push(I)}}else{let D=_[1]===S[1]?S[0]:void 0;$.push(T.translateBufferLineToString(_[1],!0,_[0],D));for(let O=_[1]+1;O<=S[1]-1;O++){let z=T.lines.get(O),I=T.translateBufferLineToString(O,!0);z?.isWrapped?$[$.length-1]+=I:$.push(I)}if(_[1]!==S[1]){let O=T.lines.get(S[1]),z=T.translateBufferLineToString(S[1],!0,0,S[0]);O&&O.isWrapped?$[$.length-1]+=z:$.push(z)}}return $.map((D=>D.replace(w," "))).join(a.isWindows?`\r
`:`
`)}clearSelection(){this._model.clearSelection(),this._removeMouseDownListeners(),this.refresh(),this._onSelectionChange.fire()}refresh(_){this._refreshAnimationFrame||(this._refreshAnimationFrame=this._coreBrowserService.window.requestAnimationFrame((()=>this._refresh()))),a.isLinux&&_&&this.selectionText.length&&this._onLinuxMouseSelection.fire(this.selectionText)}_refresh(){this._refreshAnimationFrame=void 0,this._onRedrawRequest.fire({start:this._model.finalSelectionStart,end:this._model.finalSelectionEnd,columnSelectMode:this._activeSelectionMode===3})}_isClickInSelection(_){let S=this._getMouseBufferCoords(_),T=this._model.finalSelectionStart,$=this._model.finalSelectionEnd;return!!(T&&$&&S)&&this._areCoordsInSelection(S,T,$)}isCellInSelection(_,S){let T=this._model.finalSelectionStart,$=this._model.finalSelectionEnd;return!(!T||!$)&&this._areCoordsInSelection([_,S],T,$)}_areCoordsInSelection(_,S,T){return _[1]>S[1]&&_[1]<T[1]||S[1]===T[1]&&_[1]===S[1]&&_[0]>=S[0]&&_[0]<T[0]||S[1]<T[1]&&_[1]===T[1]&&_[0]<T[0]||S[1]<T[1]&&_[1]===S[1]&&_[0]>=S[0]}_selectWordAtCursor(_,S){var T,$;let D=($=(T=this._linkifier.currentLink)===null||T===void 0?void 0:T.link)===null||$===void 0?void 0:$.range;if(D)return this._model.selectionStart=[D.start.x-1,D.start.y-1],this._model.selectionStartLength=(0,c.getRangeLength)(D,this._bufferService.cols),this._model.selectionEnd=void 0,!0;let O=this._getMouseBufferCoords(_);return!!O&&(this._selectWordAt(O,S),this._model.selectionEnd=void 0,!0)}selectAll(){this._model.isSelectAllActive=!0,this.refresh(),this._onSelectionChange.fire()}selectLines(_,S){this._model.clearSelection(),_=Math.max(_,0),S=Math.min(S,this._bufferService.buffer.lines.length-1),this._model.selectionStart=[0,_],this._model.selectionEnd=[this._bufferService.cols,S],this.refresh(),this._onSelectionChange.fire()}_handleTrim(_){this._model.handleTrim(_)&&this.refresh()}_getMouseBufferCoords(_){let S=this._mouseService.getCoords(_,this._screenElement,this._bufferService.cols,this._bufferService.rows,!0);if(S)return S[0]--,S[1]--,S[1]+=this._bufferService.buffer.ydisp,S}_getMouseEventScrollAmount(_){let S=(0,d.getCoordsRelativeToElement)(this._coreBrowserService.window,_,this._screenElement)[1],T=this._renderService.dimensions.css.canvas.height;return S>=0&&S<=T?0:(S>T&&(S-=T),S=Math.min(Math.max(S,-50),50),S/=50,S/Math.abs(S)+Math.round(14*S))}shouldForceSelection(_){return a.isMac?_.altKey&&this._optionsService.rawOptions.macOptionClickForcesSelection:_.shiftKey}handleMouseDown(_){if(this._mouseDownTimeStamp=_.timeStamp,(_.button!==2||!this.hasSelection)&&_.button===0){if(!this._enabled){if(!this.shouldForceSelection(_))return;_.stopPropagation()}_.preventDefault(),this._dragScrollAmount=0,this._enabled&&_.shiftKey?this._handleIncrementalClick(_):_.detail===1?this._handleSingleClick(_):_.detail===2?this._handleDoubleClick(_):_.detail===3&&this._handleTripleClick(_),this._addMouseDownListeners(),this.refresh(!0)}}_addMouseDownListeners(){this._screenElement.ownerDocument&&(this._screenElement.ownerDocument.addEventListener("mousemove",this._mouseMoveListener),this._screenElement.ownerDocument.addEventListener("mouseup",this._mouseUpListener)),this._dragScrollIntervalTimer=this._coreBrowserService.window.setInterval((()=>this._dragScroll()),50)}_removeMouseDownListeners(){this._screenElement.ownerDocument&&(this._screenElement.ownerDocument.removeEventListener("mousemove",this._mouseMoveListener),this._screenElement.ownerDocument.removeEventListener("mouseup",this._mouseUpListener)),this._coreBrowserService.window.clearInterval(this._dragScrollIntervalTimer),this._dragScrollIntervalTimer=void 0}_handleIncrementalClick(_){this._model.selectionStart&&(this._model.selectionEnd=this._getMouseBufferCoords(_))}_handleSingleClick(_){if(this._model.selectionStartLength=0,this._model.isSelectAllActive=!1,this._activeSelectionMode=this.shouldColumnSelect(_)?3:0,this._model.selectionStart=this._getMouseBufferCoords(_),!this._model.selectionStart)return;this._model.selectionEnd=void 0;let S=this._bufferService.buffer.lines.get(this._model.selectionStart[1]);S&&S.length!==this._model.selectionStart[0]&&S.hasWidth(this._model.selectionStart[0])===0&&this._model.selectionStart[0]++}_handleDoubleClick(_){this._selectWordAtCursor(_,!0)&&(this._activeSelectionMode=1)}_handleTripleClick(_){let S=this._getMouseBufferCoords(_);S&&(this._activeSelectionMode=2,this._selectLineAt(S[1]))}shouldColumnSelect(_){return _.altKey&&!(a.isMac&&this._optionsService.rawOptions.macOptionClickForcesSelection)}_handleMouseMove(_){if(_.stopImmediatePropagation(),!this._model.selectionStart)return;let S=this._model.selectionEnd?[this._model.selectionEnd[0],this._model.selectionEnd[1]]:null;if(this._model.selectionEnd=this._getMouseBufferCoords(_),!this._model.selectionEnd)return void this.refresh(!0);this._activeSelectionMode===2?this._model.selectionEnd[1]<this._model.selectionStart[1]?this._model.selectionEnd[0]=0:this._model.selectionEnd[0]=this._bufferService.cols:this._activeSelectionMode===1&&this._selectToWordAt(this._model.selectionEnd),this._dragScrollAmount=this._getMouseEventScrollAmount(_),this._activeSelectionMode!==3&&(this._dragScrollAmount>0?this._model.selectionEnd[0]=this._bufferService.cols:this._dragScrollAmount<0&&(this._model.selectionEnd[0]=0));let T=this._bufferService.buffer;if(this._model.selectionEnd[1]<T.lines.length){let $=T.lines.get(this._model.selectionEnd[1]);$&&$.hasWidth(this._model.selectionEnd[0])===0&&this._model.selectionEnd[0]++}S&&S[0]===this._model.selectionEnd[0]&&S[1]===this._model.selectionEnd[1]||this.refresh(!0)}_dragScroll(){if(this._model.selectionEnd&&this._model.selectionStart&&this._dragScrollAmount){this._onRequestScrollLines.fire({amount:this._dragScrollAmount,suppressScrollEvent:!1});let _=this._bufferService.buffer;this._dragScrollAmount>0?(this._activeSelectionMode!==3&&(this._model.selectionEnd[0]=this._bufferService.cols),this._model.selectionEnd[1]=Math.min(_.ydisp+this._bufferService.rows,_.lines.length-1)):(this._activeSelectionMode!==3&&(this._model.selectionEnd[0]=0),this._model.selectionEnd[1]=_.ydisp),this.refresh()}}_handleMouseUp(_){let S=_.timeStamp-this._mouseDownTimeStamp;if(this._removeMouseDownListeners(),this.selectionText.length<=1&&S<500&&_.altKey&&this._optionsService.rawOptions.altClickMovesCursor){if(this._bufferService.buffer.ybase===this._bufferService.buffer.ydisp){let T=this._mouseService.getCoords(_,this._element,this._bufferService.cols,this._bufferService.rows,!1);if(T&&T[0]!==void 0&&T[1]!==void 0){let $=(0,f.moveToCellSequence)(T[0]-1,T[1]-1,this._bufferService,this._coreService.decPrivateModes.applicationCursorKeys);this._coreService.triggerDataEvent($,!0)}}}else this._fireEventIfSelectionChanged()}_fireEventIfSelectionChanged(){let _=this._model.finalSelectionStart,S=this._model.finalSelectionEnd,T=!(!_||!S||_[0]===S[0]&&_[1]===S[1]);T?_&&S&&(this._oldSelectionStart&&this._oldSelectionEnd&&_[0]===this._oldSelectionStart[0]&&_[1]===this._oldSelectionStart[1]&&S[0]===this._oldSelectionEnd[0]&&S[1]===this._oldSelectionEnd[1]||this._fireOnSelectionChange(_,S,T)):this._oldHasSelection&&this._fireOnSelectionChange(_,S,T)}_fireOnSelectionChange(_,S,T){this._oldSelectionStart=_,this._oldSelectionEnd=S,this._oldHasSelection=T,this._onSelectionChange.fire()}_handleBufferActivate(_){this.clearSelection(),this._trimListener.dispose(),this._trimListener=_.activeBuffer.lines.onTrim((S=>this._handleTrim(S)))}_convertViewportColToCharacterIndex(_,S){let T=S;for(let $=0;S>=$;$++){let D=_.loadCell($,this._workCell).getChars().length;this._workCell.getWidth()===0?T--:D>1&&S!==$&&(T+=D-1)}return T}setSelection(_,S,T){this._model.clearSelection(),this._removeMouseDownListeners(),this._model.selectionStart=[_,S],this._model.selectionStartLength=T,this.refresh(),this._fireEventIfSelectionChanged()}rightClickSelect(_){this._isClickInSelection(_)||(this._selectWordAtCursor(_,!1)&&this.refresh(!0),this._fireEventIfSelectionChanged())}_getWordAt(_,S,T=!0,$=!0){if(_[0]>=this._bufferService.cols)return;let D=this._bufferService.buffer,O=D.lines.get(_[1]);if(!O)return;let z=D.translateBufferLineToString(_[1],!1),I=this._convertViewportColToCharacterIndex(O,_[0]),B=I,H=_[0]-I,x=0,E=0,L=0,R=0;if(z.charAt(I)===" "){for(;I>0&&z.charAt(I-1)===" ";)I--;for(;B<z.length&&z.charAt(B+1)===" ";)B++}else{let X=_[0],G=_[0];O.getWidth(X)===0&&(x++,X--),O.getWidth(G)===2&&(E++,G++);let fe=O.getString(G).length;for(fe>1&&(R+=fe-1,B+=fe-1);X>0&&I>0&&!this._isCharWordSeparator(O.loadCell(X-1,this._workCell));){O.loadCell(X-1,this._workCell);let k=this._workCell.getChars().length;this._workCell.getWidth()===0?(x++,X--):k>1&&(L+=k-1,I-=k-1),I--,X--}for(;G<O.length&&B+1<z.length&&!this._isCharWordSeparator(O.loadCell(G+1,this._workCell));){O.loadCell(G+1,this._workCell);let k=this._workCell.getChars().length;this._workCell.getWidth()===2?(E++,G++):k>1&&(R+=k-1,B+=k-1),B++,G++}}B++;let N=I+H-x+L,j=Math.min(this._bufferService.cols,B-I+x+E-L-R);if(S||z.slice(I,B).trim()!==""){if(T&&N===0&&O.getCodePoint(0)!==32){let X=D.lines.get(_[1]-1);if(X&&O.isWrapped&&X.getCodePoint(this._bufferService.cols-1)!==32){let G=this._getWordAt([this._bufferService.cols-1,_[1]-1],!1,!0,!1);if(G){let fe=this._bufferService.cols-G.start;N-=fe,j+=fe}}}if($&&N+j===this._bufferService.cols&&O.getCodePoint(this._bufferService.cols-1)!==32){let X=D.lines.get(_[1]+1);if(X?.isWrapped&&X.getCodePoint(0)!==32){let G=this._getWordAt([0,_[1]+1],!1,!1,!0);G&&(j+=G.length)}}return{start:N,length:j}}}_selectWordAt(_,S){let T=this._getWordAt(_,S);if(T){for(;T.start<0;)T.start+=this._bufferService.cols,_[1]--;this._model.selectionStart=[T.start,_[1]],this._model.selectionStartLength=T.length}}_selectToWordAt(_){let S=this._getWordAt(_,!0);if(S){let T=_[1];for(;S.start<0;)S.start+=this._bufferService.cols,T--;if(!this._model.areSelectionValuesReversed())for(;S.start+S.length>this._bufferService.cols;)S.length-=this._bufferService.cols,T++;this._model.selectionEnd=[this._model.areSelectionValuesReversed()?S.start:S.start+S.length,T]}}_isCharWordSeparator(_){return _.getWidth()!==0&&this._optionsService.rawOptions.wordSeparator.indexOf(_.getChars())>=0}_selectLineAt(_){let S=this._bufferService.buffer.getWrappedRangeForLine(_),T={start:{x:0,y:S.first},end:{x:this._bufferService.cols-1,y:S.last}};this._model.selectionStart=[0,S.first],this._model.selectionEnd=void 0,this._model.selectionStartLength=(0,c.getRangeLength)(T,this._bufferService.cols)}};s.SelectionService=C=l([p(3,m.IBufferService),p(4,m.ICoreService),p(5,y.IMouseService),p(6,m.IOptionsService),p(7,y.IRenderService),p(8,y.ICoreBrowserService)],C)},4725:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.IThemeService=s.ICharacterJoinerService=s.ISelectionService=s.IRenderService=s.IMouseService=s.ICoreBrowserService=s.ICharSizeService=void 0;let l=r(8343);s.ICharSizeService=(0,l.createDecorator)("CharSizeService"),s.ICoreBrowserService=(0,l.createDecorator)("CoreBrowserService"),s.IMouseService=(0,l.createDecorator)("MouseService"),s.IRenderService=(0,l.createDecorator)("RenderService"),s.ISelectionService=(0,l.createDecorator)("SelectionService"),s.ICharacterJoinerService=(0,l.createDecorator)("CharacterJoinerService"),s.IThemeService=(0,l.createDecorator)("ThemeService")},6731:function(u,s,r){var l=this&&this.__decorate||function(C,_,S,T){var $,D=arguments.length,O=D<3?_:T===null?T=Object.getOwnPropertyDescriptor(_,S):T;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")O=Reflect.decorate(C,_,S,T);else for(var z=C.length-1;z>=0;z--)($=C[z])&&(O=(D<3?$(O):D>3?$(_,S,O):$(_,S))||O);return D>3&&O&&Object.defineProperty(_,S,O),O},p=this&&this.__param||function(C,_){return function(S,T){_(S,T,C)}};Object.defineProperty(s,"__esModule",{value:!0}),s.ThemeService=s.DEFAULT_ANSI_COLORS=void 0;let d=r(7239),f=r(8055),g=r(8460),y=r(844),b=r(2585),o=f.css.toColor("#ffffff"),a=f.css.toColor("#000000"),c=f.css.toColor("#ffffff"),h=f.css.toColor("#000000"),m={css:"rgba(255, 255, 255, 0.3)",rgba:4294967117};s.DEFAULT_ANSI_COLORS=Object.freeze((()=>{let C=[f.css.toColor("#2e3436"),f.css.toColor("#cc0000"),f.css.toColor("#4e9a06"),f.css.toColor("#c4a000"),f.css.toColor("#3465a4"),f.css.toColor("#75507b"),f.css.toColor("#06989a"),f.css.toColor("#d3d7cf"),f.css.toColor("#555753"),f.css.toColor("#ef2929"),f.css.toColor("#8ae234"),f.css.toColor("#fce94f"),f.css.toColor("#729fcf"),f.css.toColor("#ad7fa8"),f.css.toColor("#34e2e2"),f.css.toColor("#eeeeec")],_=[0,95,135,175,215,255];for(let S=0;S<216;S++){let T=_[S/36%6|0],$=_[S/6%6|0],D=_[S%6];C.push({css:f.channels.toCss(T,$,D),rgba:f.channels.toRgba(T,$,D)})}for(let S=0;S<24;S++){let T=8+10*S;C.push({css:f.channels.toCss(T,T,T),rgba:f.channels.toRgba(T,T,T)})}return C})());let v=s.ThemeService=class extends y.Disposable{get colors(){return this._colors}constructor(C){super(),this._optionsService=C,this._contrastCache=new d.ColorContrastCache,this._halfContrastCache=new d.ColorContrastCache,this._onChangeColors=this.register(new g.EventEmitter),this.onChangeColors=this._onChangeColors.event,this._colors={foreground:o,background:a,cursor:c,cursorAccent:h,selectionForeground:void 0,selectionBackgroundTransparent:m,selectionBackgroundOpaque:f.color.blend(a,m),selectionInactiveBackgroundTransparent:m,selectionInactiveBackgroundOpaque:f.color.blend(a,m),ansi:s.DEFAULT_ANSI_COLORS.slice(),contrastCache:this._contrastCache,halfContrastCache:this._halfContrastCache},this._updateRestoreColors(),this._setTheme(this._optionsService.rawOptions.theme),this.register(this._optionsService.onSpecificOptionChange("minimumContrastRatio",(()=>this._contrastCache.clear()))),this.register(this._optionsService.onSpecificOptionChange("theme",(()=>this._setTheme(this._optionsService.rawOptions.theme))))}_setTheme(C={}){let _=this._colors;if(_.foreground=w(C.foreground,o),_.background=w(C.background,a),_.cursor=w(C.cursor,c),_.cursorAccent=w(C.cursorAccent,h),_.selectionBackgroundTransparent=w(C.selectionBackground,m),_.selectionBackgroundOpaque=f.color.blend(_.background,_.selectionBackgroundTransparent),_.selectionInactiveBackgroundTransparent=w(C.selectionInactiveBackground,_.selectionBackgroundTransparent),_.selectionInactiveBackgroundOpaque=f.color.blend(_.background,_.selectionInactiveBackgroundTransparent),_.selectionForeground=C.selectionForeground?w(C.selectionForeground,f.NULL_COLOR):void 0,_.selectionForeground===f.NULL_COLOR&&(_.selectionForeground=void 0),f.color.isOpaque(_.selectionBackgroundTransparent)&&(_.selectionBackgroundTransparent=f.color.opacity(_.selectionBackgroundTransparent,.3)),f.color.isOpaque(_.selectionInactiveBackgroundTransparent)&&(_.selectionInactiveBackgroundTransparent=f.color.opacity(_.selectionInactiveBackgroundTransparent,.3)),_.ansi=s.DEFAULT_ANSI_COLORS.slice(),_.ansi[0]=w(C.black,s.DEFAULT_ANSI_COLORS[0]),_.ansi[1]=w(C.red,s.DEFAULT_ANSI_COLORS[1]),_.ansi[2]=w(C.green,s.DEFAULT_ANSI_COLORS[2]),_.ansi[3]=w(C.yellow,s.DEFAULT_ANSI_COLORS[3]),_.ansi[4]=w(C.blue,s.DEFAULT_ANSI_COLORS[4]),_.ansi[5]=w(C.magenta,s.DEFAULT_ANSI_COLORS[5]),_.ansi[6]=w(C.cyan,s.DEFAULT_ANSI_COLORS[6]),_.ansi[7]=w(C.white,s.DEFAULT_ANSI_COLORS[7]),_.ansi[8]=w(C.brightBlack,s.DEFAULT_ANSI_COLORS[8]),_.ansi[9]=w(C.brightRed,s.DEFAULT_ANSI_COLORS[9]),_.ansi[10]=w(C.brightGreen,s.DEFAULT_ANSI_COLORS[10]),_.ansi[11]=w(C.brightYellow,s.DEFAULT_ANSI_COLORS[11]),_.ansi[12]=w(C.brightBlue,s.DEFAULT_ANSI_COLORS[12]),_.ansi[13]=w(C.brightMagenta,s.DEFAULT_ANSI_COLORS[13]),_.ansi[14]=w(C.brightCyan,s.DEFAULT_ANSI_COLORS[14]),_.ansi[15]=w(C.brightWhite,s.DEFAULT_ANSI_COLORS[15]),C.extendedAnsi){let S=Math.min(_.ansi.length-16,C.extendedAnsi.length);for(let T=0;T<S;T++)_.ansi[T+16]=w(C.extendedAnsi[T],s.DEFAULT_ANSI_COLORS[T+16])}this._contrastCache.clear(),this._halfContrastCache.clear(),this._updateRestoreColors(),this._onChangeColors.fire(this.colors)}restoreColor(C){this._restoreColor(C),this._onChangeColors.fire(this.colors)}_restoreColor(C){if(C!==void 0)switch(C){case 256:this._colors.foreground=this._restoreColors.foreground;break;case 257:this._colors.background=this._restoreColors.background;break;case 258:this._colors.cursor=this._restoreColors.cursor;break;default:this._colors.ansi[C]=this._restoreColors.ansi[C]}else for(let _=0;_<this._restoreColors.ansi.length;++_)this._colors.ansi[_]=this._restoreColors.ansi[_]}modifyColors(C){C(this._colors),this._onChangeColors.fire(this.colors)}_updateRestoreColors(){this._restoreColors={foreground:this._colors.foreground,background:this._colors.background,cursor:this._colors.cursor,ansi:this._colors.ansi.slice()}}};function w(C,_){if(C!==void 0)try{return f.css.toColor(C)}catch{}return _}s.ThemeService=v=l([p(0,b.IOptionsService)],v)},6349:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.CircularList=void 0;let l=r(8460),p=r(844);class d extends p.Disposable{constructor(g){super(),this._maxLength=g,this.onDeleteEmitter=this.register(new l.EventEmitter),this.onDelete=this.onDeleteEmitter.event,this.onInsertEmitter=this.register(new l.EventEmitter),this.onInsert=this.onInsertEmitter.event,this.onTrimEmitter=this.register(new l.EventEmitter),this.onTrim=this.onTrimEmitter.event,this._array=new Array(this._maxLength),this._startIndex=0,this._length=0}get maxLength(){return this._maxLength}set maxLength(g){if(this._maxLength===g)return;let y=new Array(g);for(let b=0;b<Math.min(g,this.length);b++)y[b]=this._array[this._getCyclicIndex(b)];this._array=y,this._maxLength=g,this._startIndex=0}get length(){return this._length}set length(g){if(g>this._length)for(let y=this._length;y<g;y++)this._array[y]=void 0;this._length=g}get(g){return this._array[this._getCyclicIndex(g)]}set(g,y){this._array[this._getCyclicIndex(g)]=y}push(g){this._array[this._getCyclicIndex(this._length)]=g,this._length===this._maxLength?(this._startIndex=++this._startIndex%this._maxLength,this.onTrimEmitter.fire(1)):this._length++}recycle(){if(this._length!==this._maxLength)throw new Error("Can only recycle when the buffer is full");return this._startIndex=++this._startIndex%this._maxLength,this.onTrimEmitter.fire(1),this._array[this._getCyclicIndex(this._length-1)]}get isFull(){return this._length===this._maxLength}pop(){return this._array[this._getCyclicIndex(this._length---1)]}splice(g,y,...b){if(y){for(let o=g;o<this._length-y;o++)this._array[this._getCyclicIndex(o)]=this._array[this._getCyclicIndex(o+y)];this._length-=y,this.onDeleteEmitter.fire({index:g,amount:y})}for(let o=this._length-1;o>=g;o--)this._array[this._getCyclicIndex(o+b.length)]=this._array[this._getCyclicIndex(o)];for(let o=0;o<b.length;o++)this._array[this._getCyclicIndex(g+o)]=b[o];if(b.length&&this.onInsertEmitter.fire({index:g,amount:b.length}),this._length+b.length>this._maxLength){let o=this._length+b.length-this._maxLength;this._startIndex+=o,this._length=this._maxLength,this.onTrimEmitter.fire(o)}else this._length+=b.length}trimStart(g){g>this._length&&(g=this._length),this._startIndex+=g,this._length-=g,this.onTrimEmitter.fire(g)}shiftElements(g,y,b){if(!(y<=0)){if(g<0||g>=this._length)throw new Error("start argument out of range");if(g+b<0)throw new Error("Cannot shift elements in list beyond index 0");if(b>0){for(let a=y-1;a>=0;a--)this.set(g+a+b,this.get(g+a));let o=g+y+b-this._length;if(o>0)for(this._length+=o;this._length>this._maxLength;)this._length--,this._startIndex++,this.onTrimEmitter.fire(1)}else for(let o=0;o<y;o++)this.set(g+o+b,this.get(g+o))}}_getCyclicIndex(g){return(this._startIndex+g)%this._maxLength}}s.CircularList=d},1439:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.clone=void 0,s.clone=function r(l,p=5){if(typeof l!="object")return l;let d=Array.isArray(l)?[]:{};for(let f in l)d[f]=p<=1?l[f]:l[f]&&r(l[f],p-1);return d}},8055:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.contrastRatio=s.toPaddedHex=s.rgba=s.rgb=s.css=s.color=s.channels=s.NULL_COLOR=void 0;let l=r(6114),p=0,d=0,f=0,g=0;var y,b,o,a,c;function h(v){let w=v.toString(16);return w.length<2?"0"+w:w}function m(v,w){return v<w?(w+.05)/(v+.05):(v+.05)/(w+.05)}s.NULL_COLOR={css:"#00000000",rgba:0},(function(v){v.toCss=function(w,C,_,S){return S!==void 0?`#${h(w)}${h(C)}${h(_)}${h(S)}`:`#${h(w)}${h(C)}${h(_)}`},v.toRgba=function(w,C,_,S=255){return(w<<24|C<<16|_<<8|S)>>>0}})(y||(s.channels=y={})),(function(v){function w(C,_){return g=Math.round(255*_),[p,d,f]=c.toChannels(C.rgba),{css:y.toCss(p,d,f,g),rgba:y.toRgba(p,d,f,g)}}v.blend=function(C,_){if(g=(255&_.rgba)/255,g===1)return{css:_.css,rgba:_.rgba};let S=_.rgba>>24&255,T=_.rgba>>16&255,$=_.rgba>>8&255,D=C.rgba>>24&255,O=C.rgba>>16&255,z=C.rgba>>8&255;return p=D+Math.round((S-D)*g),d=O+Math.round((T-O)*g),f=z+Math.round(($-z)*g),{css:y.toCss(p,d,f),rgba:y.toRgba(p,d,f)}},v.isOpaque=function(C){return(255&C.rgba)==255},v.ensureContrastRatio=function(C,_,S){let T=c.ensureContrastRatio(C.rgba,_.rgba,S);if(T)return c.toColor(T>>24&255,T>>16&255,T>>8&255)},v.opaque=function(C){let _=(255|C.rgba)>>>0;return[p,d,f]=c.toChannels(_),{css:y.toCss(p,d,f),rgba:_}},v.opacity=w,v.multiplyOpacity=function(C,_){return g=255&C.rgba,w(C,g*_/255)},v.toColorRGB=function(C){return[C.rgba>>24&255,C.rgba>>16&255,C.rgba>>8&255]}})(b||(s.color=b={})),(function(v){let w,C;if(!l.isNode){let _=document.createElement("canvas");_.width=1,_.height=1;let S=_.getContext("2d",{willReadFrequently:!0});S&&(w=S,w.globalCompositeOperation="copy",C=w.createLinearGradient(0,0,1,1))}v.toColor=function(_){if(_.match(/#[\da-f]{3,8}/i))switch(_.length){case 4:return p=parseInt(_.slice(1,2).repeat(2),16),d=parseInt(_.slice(2,3).repeat(2),16),f=parseInt(_.slice(3,4).repeat(2),16),c.toColor(p,d,f);case 5:return p=parseInt(_.slice(1,2).repeat(2),16),d=parseInt(_.slice(2,3).repeat(2),16),f=parseInt(_.slice(3,4).repeat(2),16),g=parseInt(_.slice(4,5).repeat(2),16),c.toColor(p,d,f,g);case 7:return{css:_,rgba:(parseInt(_.slice(1),16)<<8|255)>>>0};case 9:return{css:_,rgba:parseInt(_.slice(1),16)>>>0}}let S=_.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*(0|1|\d?\.(\d+))\s*)?\)/);if(S)return p=parseInt(S[1]),d=parseInt(S[2]),f=parseInt(S[3]),g=Math.round(255*(S[5]===void 0?1:parseFloat(S[5]))),c.toColor(p,d,f,g);if(!w||!C)throw new Error("css.toColor: Unsupported css format");if(w.fillStyle=C,w.fillStyle=_,typeof w.fillStyle!="string")throw new Error("css.toColor: Unsupported css format");if(w.fillRect(0,0,1,1),[p,d,f,g]=w.getImageData(0,0,1,1).data,g!==255)throw new Error("css.toColor: Unsupported css format");return{rgba:y.toRgba(p,d,f,g),css:_}}})(o||(s.css=o={})),(function(v){function w(C,_,S){let T=C/255,$=_/255,D=S/255;return .2126*(T<=.03928?T/12.92:Math.pow((T+.055)/1.055,2.4))+.7152*($<=.03928?$/12.92:Math.pow(($+.055)/1.055,2.4))+.0722*(D<=.03928?D/12.92:Math.pow((D+.055)/1.055,2.4))}v.relativeLuminance=function(C){return w(C>>16&255,C>>8&255,255&C)},v.relativeLuminance2=w})(a||(s.rgb=a={})),(function(v){function w(_,S,T){let $=_>>24&255,D=_>>16&255,O=_>>8&255,z=S>>24&255,I=S>>16&255,B=S>>8&255,H=m(a.relativeLuminance2(z,I,B),a.relativeLuminance2($,D,O));for(;H<T&&(z>0||I>0||B>0);)z-=Math.max(0,Math.ceil(.1*z)),I-=Math.max(0,Math.ceil(.1*I)),B-=Math.max(0,Math.ceil(.1*B)),H=m(a.relativeLuminance2(z,I,B),a.relativeLuminance2($,D,O));return(z<<24|I<<16|B<<8|255)>>>0}function C(_,S,T){let $=_>>24&255,D=_>>16&255,O=_>>8&255,z=S>>24&255,I=S>>16&255,B=S>>8&255,H=m(a.relativeLuminance2(z,I,B),a.relativeLuminance2($,D,O));for(;H<T&&(z<255||I<255||B<255);)z=Math.min(255,z+Math.ceil(.1*(255-z))),I=Math.min(255,I+Math.ceil(.1*(255-I))),B=Math.min(255,B+Math.ceil(.1*(255-B))),H=m(a.relativeLuminance2(z,I,B),a.relativeLuminance2($,D,O));return(z<<24|I<<16|B<<8|255)>>>0}v.ensureContrastRatio=function(_,S,T){let $=a.relativeLuminance(_>>8),D=a.relativeLuminance(S>>8);if(m($,D)<T){if(D<$){let I=w(_,S,T),B=m($,a.relativeLuminance(I>>8));if(B<T){let H=C(_,S,T);return B>m($,a.relativeLuminance(H>>8))?I:H}return I}let O=C(_,S,T),z=m($,a.relativeLuminance(O>>8));if(z<T){let I=w(_,S,T);return z>m($,a.relativeLuminance(I>>8))?O:I}return O}},v.reduceLuminance=w,v.increaseLuminance=C,v.toChannels=function(_){return[_>>24&255,_>>16&255,_>>8&255,255&_]},v.toColor=function(_,S,T,$){return{css:y.toCss(_,S,T,$),rgba:y.toRgba(_,S,T,$)}}})(c||(s.rgba=c={})),s.toPaddedHex=h,s.contrastRatio=m},8969:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.CoreTerminal=void 0;let l=r(844),p=r(2585),d=r(4348),f=r(7866),g=r(744),y=r(7302),b=r(6975),o=r(8460),a=r(1753),c=r(1480),h=r(7994),m=r(9282),v=r(5435),w=r(5981),C=r(2660),_=!1;class S extends l.Disposable{get onScroll(){return this._onScrollApi||(this._onScrollApi=this.register(new o.EventEmitter),this._onScroll.event(($=>{var D;(D=this._onScrollApi)===null||D===void 0||D.fire($.position)}))),this._onScrollApi.event}get cols(){return this._bufferService.cols}get rows(){return this._bufferService.rows}get buffers(){return this._bufferService.buffers}get options(){return this.optionsService.options}set options($){for(let D in $)this.optionsService.options[D]=$[D]}constructor($){super(),this._windowsWrappingHeuristics=this.register(new l.MutableDisposable),this._onBinary=this.register(new o.EventEmitter),this.onBinary=this._onBinary.event,this._onData=this.register(new o.EventEmitter),this.onData=this._onData.event,this._onLineFeed=this.register(new o.EventEmitter),this.onLineFeed=this._onLineFeed.event,this._onResize=this.register(new o.EventEmitter),this.onResize=this._onResize.event,this._onWriteParsed=this.register(new o.EventEmitter),this.onWriteParsed=this._onWriteParsed.event,this._onScroll=this.register(new o.EventEmitter),this._instantiationService=new d.InstantiationService,this.optionsService=this.register(new y.OptionsService($)),this._instantiationService.setService(p.IOptionsService,this.optionsService),this._bufferService=this.register(this._instantiationService.createInstance(g.BufferService)),this._instantiationService.setService(p.IBufferService,this._bufferService),this._logService=this.register(this._instantiationService.createInstance(f.LogService)),this._instantiationService.setService(p.ILogService,this._logService),this.coreService=this.register(this._instantiationService.createInstance(b.CoreService)),this._instantiationService.setService(p.ICoreService,this.coreService),this.coreMouseService=this.register(this._instantiationService.createInstance(a.CoreMouseService)),this._instantiationService.setService(p.ICoreMouseService,this.coreMouseService),this.unicodeService=this.register(this._instantiationService.createInstance(c.UnicodeService)),this._instantiationService.setService(p.IUnicodeService,this.unicodeService),this._charsetService=this._instantiationService.createInstance(h.CharsetService),this._instantiationService.setService(p.ICharsetService,this._charsetService),this._oscLinkService=this._instantiationService.createInstance(C.OscLinkService),this._instantiationService.setService(p.IOscLinkService,this._oscLinkService),this._inputHandler=this.register(new v.InputHandler(this._bufferService,this._charsetService,this.coreService,this._logService,this.optionsService,this._oscLinkService,this.coreMouseService,this.unicodeService)),this.register((0,o.forwardEvent)(this._inputHandler.onLineFeed,this._onLineFeed)),this.register(this._inputHandler),this.register((0,o.forwardEvent)(this._bufferService.onResize,this._onResize)),this.register((0,o.forwardEvent)(this.coreService.onData,this._onData)),this.register((0,o.forwardEvent)(this.coreService.onBinary,this._onBinary)),this.register(this.coreService.onRequestScrollToBottom((()=>this.scrollToBottom()))),this.register(this.coreService.onUserInput((()=>this._writeBuffer.handleUserInput()))),this.register(this.optionsService.onMultipleOptionChange(["windowsMode","windowsPty"],(()=>this._handleWindowsPtyOptionChange()))),this.register(this._bufferService.onScroll((D=>{this._onScroll.fire({position:this._bufferService.buffer.ydisp,source:0}),this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop,this._bufferService.buffer.scrollBottom)}))),this.register(this._inputHandler.onScroll((D=>{this._onScroll.fire({position:this._bufferService.buffer.ydisp,source:0}),this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop,this._bufferService.buffer.scrollBottom)}))),this._writeBuffer=this.register(new w.WriteBuffer(((D,O)=>this._inputHandler.parse(D,O)))),this.register((0,o.forwardEvent)(this._writeBuffer.onWriteParsed,this._onWriteParsed))}write($,D){this._writeBuffer.write($,D)}writeSync($,D){this._logService.logLevel<=p.LogLevelEnum.WARN&&!_&&(this._logService.warn("writeSync is unreliable and will be removed soon."),_=!0),this._writeBuffer.writeSync($,D)}resize($,D){isNaN($)||isNaN(D)||($=Math.max($,g.MINIMUM_COLS),D=Math.max(D,g.MINIMUM_ROWS),this._bufferService.resize($,D))}scroll($,D=!1){this._bufferService.scroll($,D)}scrollLines($,D,O){this._bufferService.scrollLines($,D,O)}scrollPages($){this.scrollLines($*(this.rows-1))}scrollToTop(){this.scrollLines(-this._bufferService.buffer.ydisp)}scrollToBottom(){this.scrollLines(this._bufferService.buffer.ybase-this._bufferService.buffer.ydisp)}scrollToLine($){let D=$-this._bufferService.buffer.ydisp;D!==0&&this.scrollLines(D)}registerEscHandler($,D){return this._inputHandler.registerEscHandler($,D)}registerDcsHandler($,D){return this._inputHandler.registerDcsHandler($,D)}registerCsiHandler($,D){return this._inputHandler.registerCsiHandler($,D)}registerOscHandler($,D){return this._inputHandler.registerOscHandler($,D)}_setup(){this._handleWindowsPtyOptionChange()}reset(){this._inputHandler.reset(),this._bufferService.reset(),this._charsetService.reset(),this.coreService.reset(),this.coreMouseService.reset()}_handleWindowsPtyOptionChange(){let $=!1,D=this.optionsService.rawOptions.windowsPty;D&&D.buildNumber!==void 0&&D.buildNumber!==void 0?$=D.backend==="conpty"&&D.buildNumber<21376:this.optionsService.rawOptions.windowsMode&&($=!0),$?this._enableWindowsWrappingHeuristics():this._windowsWrappingHeuristics.clear()}_enableWindowsWrappingHeuristics(){if(!this._windowsWrappingHeuristics.value){let $=[];$.push(this.onLineFeed(m.updateWindowsModeWrappedState.bind(null,this._bufferService))),$.push(this.registerCsiHandler({final:"H"},(()=>((0,m.updateWindowsModeWrappedState)(this._bufferService),!1)))),this._windowsWrappingHeuristics.value=(0,l.toDisposable)((()=>{for(let D of $)D.dispose()}))}}}s.CoreTerminal=S},8460:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.forwardEvent=s.EventEmitter=void 0,s.EventEmitter=class{constructor(){this._listeners=[],this._disposed=!1}get event(){return this._event||(this._event=r=>(this._listeners.push(r),{dispose:()=>{if(!this._disposed){for(let l=0;l<this._listeners.length;l++)if(this._listeners[l]===r)return void this._listeners.splice(l,1)}}})),this._event}fire(r,l){let p=[];for(let d=0;d<this._listeners.length;d++)p.push(this._listeners[d]);for(let d=0;d<p.length;d++)p[d].call(void 0,r,l)}dispose(){this.clearListeners(),this._disposed=!0}clearListeners(){this._listeners&&(this._listeners.length=0)}},s.forwardEvent=function(r,l){return r((p=>l.fire(p)))}},5435:function(u,s,r){var l=this&&this.__decorate||function(H,x,E,L){var R,N=arguments.length,j=N<3?x:L===null?L=Object.getOwnPropertyDescriptor(x,E):L;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")j=Reflect.decorate(H,x,E,L);else for(var X=H.length-1;X>=0;X--)(R=H[X])&&(j=(N<3?R(j):N>3?R(x,E,j):R(x,E))||j);return N>3&&j&&Object.defineProperty(x,E,j),j},p=this&&this.__param||function(H,x){return function(E,L){x(E,L,H)}};Object.defineProperty(s,"__esModule",{value:!0}),s.InputHandler=s.WindowsOptionsReportType=void 0;let d=r(2584),f=r(7116),g=r(2015),y=r(844),b=r(482),o=r(8437),a=r(8460),c=r(643),h=r(511),m=r(3734),v=r(2585),w=r(6242),C=r(6351),_=r(5941),S={"(":0,")":1,"*":2,"+":3,"-":1,".":2},T=131072;function $(H,x){if(H>24)return x.setWinLines||!1;switch(H){case 1:return!!x.restoreWin;case 2:return!!x.minimizeWin;case 3:return!!x.setWinPosition;case 4:return!!x.setWinSizePixels;case 5:return!!x.raiseWin;case 6:return!!x.lowerWin;case 7:return!!x.refreshWin;case 8:return!!x.setWinSizeChars;case 9:return!!x.maximizeWin;case 10:return!!x.fullscreenWin;case 11:return!!x.getWinState;case 13:return!!x.getWinPosition;case 14:return!!x.getWinSizePixels;case 15:return!!x.getScreenSizePixels;case 16:return!!x.getCellSizePixels;case 18:return!!x.getWinSizeChars;case 19:return!!x.getScreenSizeChars;case 20:return!!x.getIconTitle;case 21:return!!x.getWinTitle;case 22:return!!x.pushTitle;case 23:return!!x.popTitle;case 24:return!!x.setWinLines}return!1}var D;(function(H){H[H.GET_WIN_SIZE_PIXELS=0]="GET_WIN_SIZE_PIXELS",H[H.GET_CELL_SIZE_PIXELS=1]="GET_CELL_SIZE_PIXELS"})(D||(s.WindowsOptionsReportType=D={}));let O=0;class z extends y.Disposable{getAttrData(){return this._curAttrData}constructor(x,E,L,R,N,j,X,G,fe=new g.EscapeSequenceParser){super(),this._bufferService=x,this._charsetService=E,this._coreService=L,this._logService=R,this._optionsService=N,this._oscLinkService=j,this._coreMouseService=X,this._unicodeService=G,this._parser=fe,this._parseBuffer=new Uint32Array(4096),this._stringDecoder=new b.StringToUtf32,this._utf8Decoder=new b.Utf8ToUtf32,this._workCell=new h.CellData,this._windowTitle="",this._iconName="",this._windowTitleStack=[],this._iconNameStack=[],this._curAttrData=o.DEFAULT_ATTR_DATA.clone(),this._eraseAttrDataInternal=o.DEFAULT_ATTR_DATA.clone(),this._onRequestBell=this.register(new a.EventEmitter),this.onRequestBell=this._onRequestBell.event,this._onRequestRefreshRows=this.register(new a.EventEmitter),this.onRequestRefreshRows=this._onRequestRefreshRows.event,this._onRequestReset=this.register(new a.EventEmitter),this.onRequestReset=this._onRequestReset.event,this._onRequestSendFocus=this.register(new a.EventEmitter),this.onRequestSendFocus=this._onRequestSendFocus.event,this._onRequestSyncScrollBar=this.register(new a.EventEmitter),this.onRequestSyncScrollBar=this._onRequestSyncScrollBar.event,this._onRequestWindowsOptionsReport=this.register(new a.EventEmitter),this.onRequestWindowsOptionsReport=this._onRequestWindowsOptionsReport.event,this._onA11yChar=this.register(new a.EventEmitter),this.onA11yChar=this._onA11yChar.event,this._onA11yTab=this.register(new a.EventEmitter),this.onA11yTab=this._onA11yTab.event,this._onCursorMove=this.register(new a.EventEmitter),this.onCursorMove=this._onCursorMove.event,this._onLineFeed=this.register(new a.EventEmitter),this.onLineFeed=this._onLineFeed.event,this._onScroll=this.register(new a.EventEmitter),this.onScroll=this._onScroll.event,this._onTitleChange=this.register(new a.EventEmitter),this.onTitleChange=this._onTitleChange.event,this._onColor=this.register(new a.EventEmitter),this.onColor=this._onColor.event,this._parseStack={paused:!1,cursorStartX:0,cursorStartY:0,decodedLength:0,position:0},this._specialColors=[256,257,258],this.register(this._parser),this._dirtyRowTracker=new I(this._bufferService),this._activeBuffer=this._bufferService.buffer,this.register(this._bufferService.buffers.onBufferActivate((k=>this._activeBuffer=k.activeBuffer))),this._parser.setCsiHandlerFallback(((k,F)=>{this._logService.debug("Unknown CSI code: ",{identifier:this._parser.identToString(k),params:F.toArray()})})),this._parser.setEscHandlerFallback((k=>{this._logService.debug("Unknown ESC code: ",{identifier:this._parser.identToString(k)})})),this._parser.setExecuteHandlerFallback((k=>{this._logService.debug("Unknown EXECUTE code: ",{code:k})})),this._parser.setOscHandlerFallback(((k,F,U)=>{this._logService.debug("Unknown OSC code: ",{identifier:k,action:F,data:U})})),this._parser.setDcsHandlerFallback(((k,F,U)=>{F==="HOOK"&&(U=U.toArray()),this._logService.debug("Unknown DCS code: ",{identifier:this._parser.identToString(k),action:F,payload:U})})),this._parser.setPrintHandler(((k,F,U)=>this.print(k,F,U))),this._parser.registerCsiHandler({final:"@"},(k=>this.insertChars(k))),this._parser.registerCsiHandler({intermediates:" ",final:"@"},(k=>this.scrollLeft(k))),this._parser.registerCsiHandler({final:"A"},(k=>this.cursorUp(k))),this._parser.registerCsiHandler({intermediates:" ",final:"A"},(k=>this.scrollRight(k))),this._parser.registerCsiHandler({final:"B"},(k=>this.cursorDown(k))),this._parser.registerCsiHandler({final:"C"},(k=>this.cursorForward(k))),this._parser.registerCsiHandler({final:"D"},(k=>this.cursorBackward(k))),this._parser.registerCsiHandler({final:"E"},(k=>this.cursorNextLine(k))),this._parser.registerCsiHandler({final:"F"},(k=>this.cursorPrecedingLine(k))),this._parser.registerCsiHandler({final:"G"},(k=>this.cursorCharAbsolute(k))),this._parser.registerCsiHandler({final:"H"},(k=>this.cursorPosition(k))),this._parser.registerCsiHandler({final:"I"},(k=>this.cursorForwardTab(k))),this._parser.registerCsiHandler({final:"J"},(k=>this.eraseInDisplay(k,!1))),this._parser.registerCsiHandler({prefix:"?",final:"J"},(k=>this.eraseInDisplay(k,!0))),this._parser.registerCsiHandler({final:"K"},(k=>this.eraseInLine(k,!1))),this._parser.registerCsiHandler({prefix:"?",final:"K"},(k=>this.eraseInLine(k,!0))),this._parser.registerCsiHandler({final:"L"},(k=>this.insertLines(k))),this._parser.registerCsiHandler({final:"M"},(k=>this.deleteLines(k))),this._parser.registerCsiHandler({final:"P"},(k=>this.deleteChars(k))),this._parser.registerCsiHandler({final:"S"},(k=>this.scrollUp(k))),this._parser.registerCsiHandler({final:"T"},(k=>this.scrollDown(k))),this._parser.registerCsiHandler({final:"X"},(k=>this.eraseChars(k))),this._parser.registerCsiHandler({final:"Z"},(k=>this.cursorBackwardTab(k))),this._parser.registerCsiHandler({final:"`"},(k=>this.charPosAbsolute(k))),this._parser.registerCsiHandler({final:"a"},(k=>this.hPositionRelative(k))),this._parser.registerCsiHandler({final:"b"},(k=>this.repeatPrecedingCharacter(k))),this._parser.registerCsiHandler({final:"c"},(k=>this.sendDeviceAttributesPrimary(k))),this._parser.registerCsiHandler({prefix:">",final:"c"},(k=>this.sendDeviceAttributesSecondary(k))),this._parser.registerCsiHandler({final:"d"},(k=>this.linePosAbsolute(k))),this._parser.registerCsiHandler({final:"e"},(k=>this.vPositionRelative(k))),this._parser.registerCsiHandler({final:"f"},(k=>this.hVPosition(k))),this._parser.registerCsiHandler({final:"g"},(k=>this.tabClear(k))),this._parser.registerCsiHandler({final:"h"},(k=>this.setMode(k))),this._parser.registerCsiHandler({prefix:"?",final:"h"},(k=>this.setModePrivate(k))),this._parser.registerCsiHandler({final:"l"},(k=>this.resetMode(k))),this._parser.registerCsiHandler({prefix:"?",final:"l"},(k=>this.resetModePrivate(k))),this._parser.registerCsiHandler({final:"m"},(k=>this.charAttributes(k))),this._parser.registerCsiHandler({final:"n"},(k=>this.deviceStatus(k))),this._parser.registerCsiHandler({prefix:"?",final:"n"},(k=>this.deviceStatusPrivate(k))),this._parser.registerCsiHandler({intermediates:"!",final:"p"},(k=>this.softReset(k))),this._parser.registerCsiHandler({intermediates:" ",final:"q"},(k=>this.setCursorStyle(k))),this._parser.registerCsiHandler({final:"r"},(k=>this.setScrollRegion(k))),this._parser.registerCsiHandler({final:"s"},(k=>this.saveCursor(k))),this._parser.registerCsiHandler({final:"t"},(k=>this.windowOptions(k))),this._parser.registerCsiHandler({final:"u"},(k=>this.restoreCursor(k))),this._parser.registerCsiHandler({intermediates:"'",final:"}"},(k=>this.insertColumns(k))),this._parser.registerCsiHandler({intermediates:"'",final:"~"},(k=>this.deleteColumns(k))),this._parser.registerCsiHandler({intermediates:'"',final:"q"},(k=>this.selectProtected(k))),this._parser.registerCsiHandler({intermediates:"$",final:"p"},(k=>this.requestMode(k,!0))),this._parser.registerCsiHandler({prefix:"?",intermediates:"$",final:"p"},(k=>this.requestMode(k,!1))),this._parser.setExecuteHandler(d.C0.BEL,(()=>this.bell())),this._parser.setExecuteHandler(d.C0.LF,(()=>this.lineFeed())),this._parser.setExecuteHandler(d.C0.VT,(()=>this.lineFeed())),this._parser.setExecuteHandler(d.C0.FF,(()=>this.lineFeed())),this._parser.setExecuteHandler(d.C0.CR,(()=>this.carriageReturn())),this._parser.setExecuteHandler(d.C0.BS,(()=>this.backspace())),this._parser.setExecuteHandler(d.C0.HT,(()=>this.tab())),this._parser.setExecuteHandler(d.C0.SO,(()=>this.shiftOut())),this._parser.setExecuteHandler(d.C0.SI,(()=>this.shiftIn())),this._parser.setExecuteHandler(d.C1.IND,(()=>this.index())),this._parser.setExecuteHandler(d.C1.NEL,(()=>this.nextLine())),this._parser.setExecuteHandler(d.C1.HTS,(()=>this.tabSet())),this._parser.registerOscHandler(0,new w.OscHandler((k=>(this.setTitle(k),this.setIconName(k),!0)))),this._parser.registerOscHandler(1,new w.OscHandler((k=>this.setIconName(k)))),this._parser.registerOscHandler(2,new w.OscHandler((k=>this.setTitle(k)))),this._parser.registerOscHandler(4,new w.OscHandler((k=>this.setOrReportIndexedColor(k)))),this._parser.registerOscHandler(8,new w.OscHandler((k=>this.setHyperlink(k)))),this._parser.registerOscHandler(10,new w.OscHandler((k=>this.setOrReportFgColor(k)))),this._parser.registerOscHandler(11,new w.OscHandler((k=>this.setOrReportBgColor(k)))),this._parser.registerOscHandler(12,new w.OscHandler((k=>this.setOrReportCursorColor(k)))),this._parser.registerOscHandler(104,new w.OscHandler((k=>this.restoreIndexedColor(k)))),this._parser.registerOscHandler(110,new w.OscHandler((k=>this.restoreFgColor(k)))),this._parser.registerOscHandler(111,new w.OscHandler((k=>this.restoreBgColor(k)))),this._parser.registerOscHandler(112,new w.OscHandler((k=>this.restoreCursorColor(k)))),this._parser.registerEscHandler({final:"7"},(()=>this.saveCursor())),this._parser.registerEscHandler({final:"8"},(()=>this.restoreCursor())),this._parser.registerEscHandler({final:"D"},(()=>this.index())),this._parser.registerEscHandler({final:"E"},(()=>this.nextLine())),this._parser.registerEscHandler({final:"H"},(()=>this.tabSet())),this._parser.registerEscHandler({final:"M"},(()=>this.reverseIndex())),this._parser.registerEscHandler({final:"="},(()=>this.keypadApplicationMode())),this._parser.registerEscHandler({final:">"},(()=>this.keypadNumericMode())),this._parser.registerEscHandler({final:"c"},(()=>this.fullReset())),this._parser.registerEscHandler({final:"n"},(()=>this.setgLevel(2))),this._parser.registerEscHandler({final:"o"},(()=>this.setgLevel(3))),this._parser.registerEscHandler({final:"|"},(()=>this.setgLevel(3))),this._parser.registerEscHandler({final:"}"},(()=>this.setgLevel(2))),this._parser.registerEscHandler({final:"~"},(()=>this.setgLevel(1))),this._parser.registerEscHandler({intermediates:"%",final:"@"},(()=>this.selectDefaultCharset())),this._parser.registerEscHandler({intermediates:"%",final:"G"},(()=>this.selectDefaultCharset()));for(let k in f.CHARSETS)this._parser.registerEscHandler({intermediates:"(",final:k},(()=>this.selectCharset("("+k))),this._parser.registerEscHandler({intermediates:")",final:k},(()=>this.selectCharset(")"+k))),this._parser.registerEscHandler({intermediates:"*",final:k},(()=>this.selectCharset("*"+k))),this._parser.registerEscHandler({intermediates:"+",final:k},(()=>this.selectCharset("+"+k))),this._parser.registerEscHandler({intermediates:"-",final:k},(()=>this.selectCharset("-"+k))),this._parser.registerEscHandler({intermediates:".",final:k},(()=>this.selectCharset("."+k))),this._parser.registerEscHandler({intermediates:"/",final:k},(()=>this.selectCharset("/"+k)));this._parser.registerEscHandler({intermediates:"#",final:"8"},(()=>this.screenAlignmentPattern())),this._parser.setErrorHandler((k=>(this._logService.error("Parsing error: ",k),k))),this._parser.registerDcsHandler({intermediates:"$",final:"q"},new C.DcsHandler(((k,F)=>this.requestStatusString(k,F))))}_preserveStack(x,E,L,R){this._parseStack.paused=!0,this._parseStack.cursorStartX=x,this._parseStack.cursorStartY=E,this._parseStack.decodedLength=L,this._parseStack.position=R}_logSlowResolvingAsync(x){this._logService.logLevel<=v.LogLevelEnum.WARN&&Promise.race([x,new Promise(((E,L)=>setTimeout((()=>L("#SLOW_TIMEOUT")),5e3)))]).catch((E=>{if(E!=="#SLOW_TIMEOUT")throw E;console.warn("async parser handler taking longer than 5000 ms")}))}_getCurrentLinkId(){return this._curAttrData.extended.urlId}parse(x,E){let L,R=this._activeBuffer.x,N=this._activeBuffer.y,j=0,X=this._parseStack.paused;if(X){if(L=this._parser.parse(this._parseBuffer,this._parseStack.decodedLength,E))return this._logSlowResolvingAsync(L),L;R=this._parseStack.cursorStartX,N=this._parseStack.cursorStartY,this._parseStack.paused=!1,x.length>T&&(j=this._parseStack.position+T)}if(this._logService.logLevel<=v.LogLevelEnum.DEBUG&&this._logService.debug("parsing data"+(typeof x=="string"?` "${x}"`:` "${Array.prototype.map.call(x,(G=>String.fromCharCode(G))).join("")}"`),typeof x=="string"?x.split("").map((G=>G.charCodeAt(0))):x),this._parseBuffer.length<x.length&&this._parseBuffer.length<T&&(this._parseBuffer=new Uint32Array(Math.min(x.length,T))),X||this._dirtyRowTracker.clearRange(),x.length>T)for(let G=j;G<x.length;G+=T){let fe=G+T<x.length?G+T:x.length,k=typeof x=="string"?this._stringDecoder.decode(x.substring(G,fe),this._parseBuffer):this._utf8Decoder.decode(x.subarray(G,fe),this._parseBuffer);if(L=this._parser.parse(this._parseBuffer,k))return this._preserveStack(R,N,k,G),this._logSlowResolvingAsync(L),L}else if(!X){let G=typeof x=="string"?this._stringDecoder.decode(x,this._parseBuffer):this._utf8Decoder.decode(x,this._parseBuffer);if(L=this._parser.parse(this._parseBuffer,G))return this._preserveStack(R,N,G,0),this._logSlowResolvingAsync(L),L}this._activeBuffer.x===R&&this._activeBuffer.y===N||this._onCursorMove.fire(),this._onRequestRefreshRows.fire(this._dirtyRowTracker.start,this._dirtyRowTracker.end)}print(x,E,L){let R,N,j=this._charsetService.charset,X=this._optionsService.rawOptions.screenReaderMode,G=this._bufferService.cols,fe=this._coreService.decPrivateModes.wraparound,k=this._coreService.modes.insertMode,F=this._curAttrData,U=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._activeBuffer.x&&L-E>0&&U.getWidth(this._activeBuffer.x-1)===2&&U.setCellFromCodePoint(this._activeBuffer.x-1,0,1,F.fg,F.bg,F.extended);for(let W=E;W<L;++W){if(R=x[W],N=this._unicodeService.wcwidth(R),R<127&&j){let re=j[String.fromCharCode(R)];re&&(R=re.charCodeAt(0))}if(X&&this._onA11yChar.fire((0,b.stringFromCodePoint)(R)),this._getCurrentLinkId()&&this._oscLinkService.addLineToLink(this._getCurrentLinkId(),this._activeBuffer.ybase+this._activeBuffer.y),N||!this._activeBuffer.x){if(this._activeBuffer.x+N-1>=G){if(fe){for(;this._activeBuffer.x<G;)U.setCellFromCodePoint(this._activeBuffer.x++,0,1,F.fg,F.bg,F.extended);this._activeBuffer.x=0,this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData(),!0)):(this._activeBuffer.y>=this._bufferService.rows&&(this._activeBuffer.y=this._bufferService.rows-1),this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!0),U=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y)}else if(this._activeBuffer.x=G-1,N===2)continue}if(k&&(U.insertCells(this._activeBuffer.x,N,this._activeBuffer.getNullCell(F),F),U.getWidth(G-1)===2&&U.setCellFromCodePoint(G-1,c.NULL_CELL_CODE,c.NULL_CELL_WIDTH,F.fg,F.bg,F.extended)),U.setCellFromCodePoint(this._activeBuffer.x++,R,N,F.fg,F.bg,F.extended),N>0)for(;--N;)U.setCellFromCodePoint(this._activeBuffer.x++,0,0,F.fg,F.bg,F.extended)}else U.getWidth(this._activeBuffer.x-1)?U.addCodepointToCell(this._activeBuffer.x-1,R):U.addCodepointToCell(this._activeBuffer.x-2,R)}L-E>0&&(U.loadCell(this._activeBuffer.x-1,this._workCell),this._workCell.getWidth()===2||this._workCell.getCode()>65535?this._parser.precedingCodepoint=0:this._workCell.isCombined()?this._parser.precedingCodepoint=this._workCell.getChars().charCodeAt(0):this._parser.precedingCodepoint=this._workCell.content),this._activeBuffer.x<G&&L-E>0&&U.getWidth(this._activeBuffer.x)===0&&!U.hasContent(this._activeBuffer.x)&&U.setCellFromCodePoint(this._activeBuffer.x,0,1,F.fg,F.bg,F.extended),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}registerCsiHandler(x,E){return x.final!=="t"||x.prefix||x.intermediates?this._parser.registerCsiHandler(x,E):this._parser.registerCsiHandler(x,(L=>!$(L.params[0],this._optionsService.rawOptions.windowOptions)||E(L)))}registerDcsHandler(x,E){return this._parser.registerDcsHandler(x,new C.DcsHandler(E))}registerEscHandler(x,E){return this._parser.registerEscHandler(x,E)}registerOscHandler(x,E){return this._parser.registerOscHandler(x,new w.OscHandler(E))}bell(){return this._onRequestBell.fire(),!0}lineFeed(){return this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._optionsService.rawOptions.convertEol&&(this._activeBuffer.x=0),this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData())):this._activeBuffer.y>=this._bufferService.rows?this._activeBuffer.y=this._bufferService.rows-1:this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!1,this._activeBuffer.x>=this._bufferService.cols&&this._activeBuffer.x--,this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._onLineFeed.fire(),!0}carriageReturn(){return this._activeBuffer.x=0,!0}backspace(){var x;if(!this._coreService.decPrivateModes.reverseWraparound)return this._restrictCursor(),this._activeBuffer.x>0&&this._activeBuffer.x--,!0;if(this._restrictCursor(this._bufferService.cols),this._activeBuffer.x>0)this._activeBuffer.x--;else if(this._activeBuffer.x===0&&this._activeBuffer.y>this._activeBuffer.scrollTop&&this._activeBuffer.y<=this._activeBuffer.scrollBottom&&(!((x=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y))===null||x===void 0)&&x.isWrapped)){this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!1,this._activeBuffer.y--,this._activeBuffer.x=this._bufferService.cols-1;let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);E.hasWidth(this._activeBuffer.x)&&!E.hasContent(this._activeBuffer.x)&&this._activeBuffer.x--}return this._restrictCursor(),!0}tab(){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let x=this._activeBuffer.x;return this._activeBuffer.x=this._activeBuffer.nextStop(),this._optionsService.rawOptions.screenReaderMode&&this._onA11yTab.fire(this._activeBuffer.x-x),!0}shiftOut(){return this._charsetService.setgLevel(1),!0}shiftIn(){return this._charsetService.setgLevel(0),!0}_restrictCursor(x=this._bufferService.cols-1){this._activeBuffer.x=Math.min(x,Math.max(0,this._activeBuffer.x)),this._activeBuffer.y=this._coreService.decPrivateModes.origin?Math.min(this._activeBuffer.scrollBottom,Math.max(this._activeBuffer.scrollTop,this._activeBuffer.y)):Math.min(this._bufferService.rows-1,Math.max(0,this._activeBuffer.y)),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}_setCursor(x,E){this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._coreService.decPrivateModes.origin?(this._activeBuffer.x=x,this._activeBuffer.y=this._activeBuffer.scrollTop+E):(this._activeBuffer.x=x,this._activeBuffer.y=E),this._restrictCursor(),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}_moveCursor(x,E){this._restrictCursor(),this._setCursor(this._activeBuffer.x+x,this._activeBuffer.y+E)}cursorUp(x){let E=this._activeBuffer.y-this._activeBuffer.scrollTop;return E>=0?this._moveCursor(0,-Math.min(E,x.params[0]||1)):this._moveCursor(0,-(x.params[0]||1)),!0}cursorDown(x){let E=this._activeBuffer.scrollBottom-this._activeBuffer.y;return E>=0?this._moveCursor(0,Math.min(E,x.params[0]||1)):this._moveCursor(0,x.params[0]||1),!0}cursorForward(x){return this._moveCursor(x.params[0]||1,0),!0}cursorBackward(x){return this._moveCursor(-(x.params[0]||1),0),!0}cursorNextLine(x){return this.cursorDown(x),this._activeBuffer.x=0,!0}cursorPrecedingLine(x){return this.cursorUp(x),this._activeBuffer.x=0,!0}cursorCharAbsolute(x){return this._setCursor((x.params[0]||1)-1,this._activeBuffer.y),!0}cursorPosition(x){return this._setCursor(x.length>=2?(x.params[1]||1)-1:0,(x.params[0]||1)-1),!0}charPosAbsolute(x){return this._setCursor((x.params[0]||1)-1,this._activeBuffer.y),!0}hPositionRelative(x){return this._moveCursor(x.params[0]||1,0),!0}linePosAbsolute(x){return this._setCursor(this._activeBuffer.x,(x.params[0]||1)-1),!0}vPositionRelative(x){return this._moveCursor(0,x.params[0]||1),!0}hVPosition(x){return this.cursorPosition(x),!0}tabClear(x){let E=x.params[0];return E===0?delete this._activeBuffer.tabs[this._activeBuffer.x]:E===3&&(this._activeBuffer.tabs={}),!0}cursorForwardTab(x){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let E=x.params[0]||1;for(;E--;)this._activeBuffer.x=this._activeBuffer.nextStop();return!0}cursorBackwardTab(x){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let E=x.params[0]||1;for(;E--;)this._activeBuffer.x=this._activeBuffer.prevStop();return!0}selectProtected(x){let E=x.params[0];return E===1&&(this._curAttrData.bg|=536870912),E!==2&&E!==0||(this._curAttrData.bg&=-536870913),!0}_eraseInBufferLine(x,E,L,R=!1,N=!1){let j=this._activeBuffer.lines.get(this._activeBuffer.ybase+x);j.replaceCells(E,L,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData(),N),R&&(j.isWrapped=!1)}_resetBufferLine(x,E=!1){let L=this._activeBuffer.lines.get(this._activeBuffer.ybase+x);L&&(L.fill(this._activeBuffer.getNullCell(this._eraseAttrData()),E),this._bufferService.buffer.clearMarkers(this._activeBuffer.ybase+x),L.isWrapped=!1)}eraseInDisplay(x,E=!1){let L;switch(this._restrictCursor(this._bufferService.cols),x.params[0]){case 0:for(L=this._activeBuffer.y,this._dirtyRowTracker.markDirty(L),this._eraseInBufferLine(L++,this._activeBuffer.x,this._bufferService.cols,this._activeBuffer.x===0,E);L<this._bufferService.rows;L++)this._resetBufferLine(L,E);this._dirtyRowTracker.markDirty(L);break;case 1:for(L=this._activeBuffer.y,this._dirtyRowTracker.markDirty(L),this._eraseInBufferLine(L,0,this._activeBuffer.x+1,!0,E),this._activeBuffer.x+1>=this._bufferService.cols&&(this._activeBuffer.lines.get(L+1).isWrapped=!1);L--;)this._resetBufferLine(L,E);this._dirtyRowTracker.markDirty(0);break;case 2:for(L=this._bufferService.rows,this._dirtyRowTracker.markDirty(L-1);L--;)this._resetBufferLine(L,E);this._dirtyRowTracker.markDirty(0);break;case 3:let R=this._activeBuffer.lines.length-this._bufferService.rows;R>0&&(this._activeBuffer.lines.trimStart(R),this._activeBuffer.ybase=Math.max(this._activeBuffer.ybase-R,0),this._activeBuffer.ydisp=Math.max(this._activeBuffer.ydisp-R,0),this._onScroll.fire(0))}return!0}eraseInLine(x,E=!1){switch(this._restrictCursor(this._bufferService.cols),x.params[0]){case 0:this._eraseInBufferLine(this._activeBuffer.y,this._activeBuffer.x,this._bufferService.cols,this._activeBuffer.x===0,E);break;case 1:this._eraseInBufferLine(this._activeBuffer.y,0,this._activeBuffer.x+1,!1,E);break;case 2:this._eraseInBufferLine(this._activeBuffer.y,0,this._bufferService.cols,!0,E)}return this._dirtyRowTracker.markDirty(this._activeBuffer.y),!0}insertLines(x){this._restrictCursor();let E=x.params[0]||1;if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let L=this._activeBuffer.ybase+this._activeBuffer.y,R=this._bufferService.rows-1-this._activeBuffer.scrollBottom,N=this._bufferService.rows-1+this._activeBuffer.ybase-R+1;for(;E--;)this._activeBuffer.lines.splice(N-1,1),this._activeBuffer.lines.splice(L,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y,this._activeBuffer.scrollBottom),this._activeBuffer.x=0,!0}deleteLines(x){this._restrictCursor();let E=x.params[0]||1;if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let L=this._activeBuffer.ybase+this._activeBuffer.y,R;for(R=this._bufferService.rows-1-this._activeBuffer.scrollBottom,R=this._bufferService.rows-1+this._activeBuffer.ybase-R;E--;)this._activeBuffer.lines.splice(L,1),this._activeBuffer.lines.splice(R,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y,this._activeBuffer.scrollBottom),this._activeBuffer.x=0,!0}insertChars(x){this._restrictCursor();let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return E&&(E.insertCells(this._activeBuffer.x,x.params[0]||1,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}deleteChars(x){this._restrictCursor();let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return E&&(E.deleteCells(this._activeBuffer.x,x.params[0]||1,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}scrollUp(x){let E=x.params[0]||1;for(;E--;)this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollTop,1),this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollBottom,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollDown(x){let E=x.params[0]||1;for(;E--;)this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollBottom,1),this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollTop,0,this._activeBuffer.getBlankLine(o.DEFAULT_ATTR_DATA));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollLeft(x){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=x.params[0]||1;for(let L=this._activeBuffer.scrollTop;L<=this._activeBuffer.scrollBottom;++L){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+L);R.deleteCells(0,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollRight(x){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=x.params[0]||1;for(let L=this._activeBuffer.scrollTop;L<=this._activeBuffer.scrollBottom;++L){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+L);R.insertCells(0,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}insertColumns(x){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=x.params[0]||1;for(let L=this._activeBuffer.scrollTop;L<=this._activeBuffer.scrollBottom;++L){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+L);R.insertCells(this._activeBuffer.x,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}deleteColumns(x){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=x.params[0]||1;for(let L=this._activeBuffer.scrollTop;L<=this._activeBuffer.scrollBottom;++L){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+L);R.deleteCells(this._activeBuffer.x,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}eraseChars(x){this._restrictCursor();let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return E&&(E.replaceCells(this._activeBuffer.x,this._activeBuffer.x+(x.params[0]||1),this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}repeatPrecedingCharacter(x){if(!this._parser.precedingCodepoint)return!0;let E=x.params[0]||1,L=new Uint32Array(E);for(let R=0;R<E;++R)L[R]=this._parser.precedingCodepoint;return this.print(L,0,L.length),!0}sendDeviceAttributesPrimary(x){return x.params[0]>0||(this._is("xterm")||this._is("rxvt-unicode")||this._is("screen")?this._coreService.triggerDataEvent(d.C0.ESC+"[?1;2c"):this._is("linux")&&this._coreService.triggerDataEvent(d.C0.ESC+"[?6c")),!0}sendDeviceAttributesSecondary(x){return x.params[0]>0||(this._is("xterm")?this._coreService.triggerDataEvent(d.C0.ESC+"[>0;276;0c"):this._is("rxvt-unicode")?this._coreService.triggerDataEvent(d.C0.ESC+"[>85;95;0c"):this._is("linux")?this._coreService.triggerDataEvent(x.params[0]+"c"):this._is("screen")&&this._coreService.triggerDataEvent(d.C0.ESC+"[>83;40003;0c")),!0}_is(x){return(this._optionsService.rawOptions.termName+"").indexOf(x)===0}setMode(x){for(let E=0;E<x.length;E++)switch(x.params[E]){case 4:this._coreService.modes.insertMode=!0;break;case 20:this._optionsService.options.convertEol=!0}return!0}setModePrivate(x){for(let E=0;E<x.length;E++)switch(x.params[E]){case 1:this._coreService.decPrivateModes.applicationCursorKeys=!0;break;case 2:this._charsetService.setgCharset(0,f.DEFAULT_CHARSET),this._charsetService.setgCharset(1,f.DEFAULT_CHARSET),this._charsetService.setgCharset(2,f.DEFAULT_CHARSET),this._charsetService.setgCharset(3,f.DEFAULT_CHARSET);break;case 3:this._optionsService.rawOptions.windowOptions.setWinLines&&(this._bufferService.resize(132,this._bufferService.rows),this._onRequestReset.fire());break;case 6:this._coreService.decPrivateModes.origin=!0,this._setCursor(0,0);break;case 7:this._coreService.decPrivateModes.wraparound=!0;break;case 12:this._optionsService.options.cursorBlink=!0;break;case 45:this._coreService.decPrivateModes.reverseWraparound=!0;break;case 66:this._logService.debug("Serial port requested application keypad."),this._coreService.decPrivateModes.applicationKeypad=!0,this._onRequestSyncScrollBar.fire();break;case 9:this._coreMouseService.activeProtocol="X10";break;case 1e3:this._coreMouseService.activeProtocol="VT200";break;case 1002:this._coreMouseService.activeProtocol="DRAG";break;case 1003:this._coreMouseService.activeProtocol="ANY";break;case 1004:this._coreService.decPrivateModes.sendFocus=!0,this._onRequestSendFocus.fire();break;case 1005:this._logService.debug("DECSET 1005 not supported (see #2507)");break;case 1006:this._coreMouseService.activeEncoding="SGR";break;case 1015:this._logService.debug("DECSET 1015 not supported (see #2507)");break;case 1016:this._coreMouseService.activeEncoding="SGR_PIXELS";break;case 25:this._coreService.isCursorHidden=!1;break;case 1048:this.saveCursor();break;case 1049:this.saveCursor();case 47:case 1047:this._bufferService.buffers.activateAltBuffer(this._eraseAttrData()),this._coreService.isCursorInitialized=!0,this._onRequestRefreshRows.fire(0,this._bufferService.rows-1),this._onRequestSyncScrollBar.fire();break;case 2004:this._coreService.decPrivateModes.bracketedPasteMode=!0}return!0}resetMode(x){for(let E=0;E<x.length;E++)switch(x.params[E]){case 4:this._coreService.modes.insertMode=!1;break;case 20:this._optionsService.options.convertEol=!1}return!0}resetModePrivate(x){for(let E=0;E<x.length;E++)switch(x.params[E]){case 1:this._coreService.decPrivateModes.applicationCursorKeys=!1;break;case 3:this._optionsService.rawOptions.windowOptions.setWinLines&&(this._bufferService.resize(80,this._bufferService.rows),this._onRequestReset.fire());break;case 6:this._coreService.decPrivateModes.origin=!1,this._setCursor(0,0);break;case 7:this._coreService.decPrivateModes.wraparound=!1;break;case 12:this._optionsService.options.cursorBlink=!1;break;case 45:this._coreService.decPrivateModes.reverseWraparound=!1;break;case 66:this._logService.debug("Switching back to normal keypad."),this._coreService.decPrivateModes.applicationKeypad=!1,this._onRequestSyncScrollBar.fire();break;case 9:case 1e3:case 1002:case 1003:this._coreMouseService.activeProtocol="NONE";break;case 1004:this._coreService.decPrivateModes.sendFocus=!1;break;case 1005:this._logService.debug("DECRST 1005 not supported (see #2507)");break;case 1006:case 1016:this._coreMouseService.activeEncoding="DEFAULT";break;case 1015:this._logService.debug("DECRST 1015 not supported (see #2507)");break;case 25:this._coreService.isCursorHidden=!0;break;case 1048:this.restoreCursor();break;case 1049:case 47:case 1047:this._bufferService.buffers.activateNormalBuffer(),x.params[E]===1049&&this.restoreCursor(),this._coreService.isCursorInitialized=!0,this._onRequestRefreshRows.fire(0,this._bufferService.rows-1),this._onRequestSyncScrollBar.fire();break;case 2004:this._coreService.decPrivateModes.bracketedPasteMode=!1}return!0}requestMode(x,E){let L=this._coreService.decPrivateModes,{activeProtocol:R,activeEncoding:N}=this._coreMouseService,j=this._coreService,{buffers:X,cols:G}=this._bufferService,{active:fe,alt:k}=X,F=this._optionsService.rawOptions,U=me=>me?1:2,W=x.params[0];return re=W,q=E?W===2?4:W===4?U(j.modes.insertMode):W===12?3:W===20?U(F.convertEol):0:W===1?U(L.applicationCursorKeys):W===3?F.windowOptions.setWinLines?G===80?2:G===132?1:0:0:W===6?U(L.origin):W===7?U(L.wraparound):W===8?3:W===9?U(R==="X10"):W===12?U(F.cursorBlink):W===25?U(!j.isCursorHidden):W===45?U(L.reverseWraparound):W===66?U(L.applicationKeypad):W===67?4:W===1e3?U(R==="VT200"):W===1002?U(R==="DRAG"):W===1003?U(R==="ANY"):W===1004?U(L.sendFocus):W===1005?4:W===1006?U(N==="SGR"):W===1015?4:W===1016?U(N==="SGR_PIXELS"):W===1048?1:W===47||W===1047||W===1049?U(fe===k):W===2004?U(L.bracketedPasteMode):0,j.triggerDataEvent(`${d.C0.ESC}[${E?"":"?"}${re};${q}$y`),!0;var re,q}_updateAttrColor(x,E,L,R,N){return E===2?(x|=50331648,x&=-16777216,x|=m.AttributeData.fromColorRGB([L,R,N])):E===5&&(x&=-50331904,x|=33554432|255&L),x}_extractColor(x,E,L){let R=[0,0,-1,0,0,0],N=0,j=0;do{if(R[j+N]=x.params[E+j],x.hasSubParams(E+j)){let X=x.getSubParams(E+j),G=0;do R[1]===5&&(N=1),R[j+G+1+N]=X[G];while(++G<X.length&&G+j+1+N<R.length);break}if(R[1]===5&&j+N>=2||R[1]===2&&j+N>=5)break;R[1]&&(N=1)}while(++j+E<x.length&&j+N<R.length);for(let X=2;X<R.length;++X)R[X]===-1&&(R[X]=0);switch(R[0]){case 38:L.fg=this._updateAttrColor(L.fg,R[1],R[3],R[4],R[5]);break;case 48:L.bg=this._updateAttrColor(L.bg,R[1],R[3],R[4],R[5]);break;case 58:L.extended=L.extended.clone(),L.extended.underlineColor=this._updateAttrColor(L.extended.underlineColor,R[1],R[3],R[4],R[5])}return j}_processUnderline(x,E){E.extended=E.extended.clone(),(!~x||x>5)&&(x=1),E.extended.underlineStyle=x,E.fg|=268435456,x===0&&(E.fg&=-268435457),E.updateExtended()}_processSGR0(x){x.fg=o.DEFAULT_ATTR_DATA.fg,x.bg=o.DEFAULT_ATTR_DATA.bg,x.extended=x.extended.clone(),x.extended.underlineStyle=0,x.extended.underlineColor&=-67108864,x.updateExtended()}charAttributes(x){if(x.length===1&&x.params[0]===0)return this._processSGR0(this._curAttrData),!0;let E=x.length,L,R=this._curAttrData;for(let N=0;N<E;N++)L=x.params[N],L>=30&&L<=37?(R.fg&=-50331904,R.fg|=16777216|L-30):L>=40&&L<=47?(R.bg&=-50331904,R.bg|=16777216|L-40):L>=90&&L<=97?(R.fg&=-50331904,R.fg|=16777224|L-90):L>=100&&L<=107?(R.bg&=-50331904,R.bg|=16777224|L-100):L===0?this._processSGR0(R):L===1?R.fg|=134217728:L===3?R.bg|=67108864:L===4?(R.fg|=268435456,this._processUnderline(x.hasSubParams(N)?x.getSubParams(N)[0]:1,R)):L===5?R.fg|=536870912:L===7?R.fg|=67108864:L===8?R.fg|=1073741824:L===9?R.fg|=2147483648:L===2?R.bg|=134217728:L===21?this._processUnderline(2,R):L===22?(R.fg&=-134217729,R.bg&=-134217729):L===23?R.bg&=-67108865:L===24?(R.fg&=-268435457,this._processUnderline(0,R)):L===25?R.fg&=-536870913:L===27?R.fg&=-67108865:L===28?R.fg&=-1073741825:L===29?R.fg&=2147483647:L===39?(R.fg&=-67108864,R.fg|=16777215&o.DEFAULT_ATTR_DATA.fg):L===49?(R.bg&=-67108864,R.bg|=16777215&o.DEFAULT_ATTR_DATA.bg):L===38||L===48||L===58?N+=this._extractColor(x,N,R):L===53?R.bg|=1073741824:L===55?R.bg&=-1073741825:L===59?(R.extended=R.extended.clone(),R.extended.underlineColor=-1,R.updateExtended()):L===100?(R.fg&=-67108864,R.fg|=16777215&o.DEFAULT_ATTR_DATA.fg,R.bg&=-67108864,R.bg|=16777215&o.DEFAULT_ATTR_DATA.bg):this._logService.debug("Unknown SGR attribute: %d.",L);return!0}deviceStatus(x){switch(x.params[0]){case 5:this._coreService.triggerDataEvent(`${d.C0.ESC}[0n`);break;case 6:let E=this._activeBuffer.y+1,L=this._activeBuffer.x+1;this._coreService.triggerDataEvent(`${d.C0.ESC}[${E};${L}R`)}return!0}deviceStatusPrivate(x){if(x.params[0]===6){let E=this._activeBuffer.y+1,L=this._activeBuffer.x+1;this._coreService.triggerDataEvent(`${d.C0.ESC}[?${E};${L}R`)}return!0}softReset(x){return this._coreService.isCursorHidden=!1,this._onRequestSyncScrollBar.fire(),this._activeBuffer.scrollTop=0,this._activeBuffer.scrollBottom=this._bufferService.rows-1,this._curAttrData=o.DEFAULT_ATTR_DATA.clone(),this._coreService.reset(),this._charsetService.reset(),this._activeBuffer.savedX=0,this._activeBuffer.savedY=this._activeBuffer.ybase,this._activeBuffer.savedCurAttrData.fg=this._curAttrData.fg,this._activeBuffer.savedCurAttrData.bg=this._curAttrData.bg,this._activeBuffer.savedCharset=this._charsetService.charset,this._coreService.decPrivateModes.origin=!1,!0}setCursorStyle(x){let E=x.params[0]||1;switch(E){case 1:case 2:this._optionsService.options.cursorStyle="block";break;case 3:case 4:this._optionsService.options.cursorStyle="underline";break;case 5:case 6:this._optionsService.options.cursorStyle="bar"}let L=E%2==1;return this._optionsService.options.cursorBlink=L,!0}setScrollRegion(x){let E=x.params[0]||1,L;return(x.length<2||(L=x.params[1])>this._bufferService.rows||L===0)&&(L=this._bufferService.rows),L>E&&(this._activeBuffer.scrollTop=E-1,this._activeBuffer.scrollBottom=L-1,this._setCursor(0,0)),!0}windowOptions(x){if(!$(x.params[0],this._optionsService.rawOptions.windowOptions))return!0;let E=x.length>1?x.params[1]:0;switch(x.params[0]){case 14:E!==2&&this._onRequestWindowsOptionsReport.fire(D.GET_WIN_SIZE_PIXELS);break;case 16:this._onRequestWindowsOptionsReport.fire(D.GET_CELL_SIZE_PIXELS);break;case 18:this._bufferService&&this._coreService.triggerDataEvent(`${d.C0.ESC}[8;${this._bufferService.rows};${this._bufferService.cols}t`);break;case 22:E!==0&&E!==2||(this._windowTitleStack.push(this._windowTitle),this._windowTitleStack.length>10&&this._windowTitleStack.shift()),E!==0&&E!==1||(this._iconNameStack.push(this._iconName),this._iconNameStack.length>10&&this._iconNameStack.shift());break;case 23:E!==0&&E!==2||this._windowTitleStack.length&&this.setTitle(this._windowTitleStack.pop()),E!==0&&E!==1||this._iconNameStack.length&&this.setIconName(this._iconNameStack.pop())}return!0}saveCursor(x){return this._activeBuffer.savedX=this._activeBuffer.x,this._activeBuffer.savedY=this._activeBuffer.ybase+this._activeBuffer.y,this._activeBuffer.savedCurAttrData.fg=this._curAttrData.fg,this._activeBuffer.savedCurAttrData.bg=this._curAttrData.bg,this._activeBuffer.savedCharset=this._charsetService.charset,!0}restoreCursor(x){return this._activeBuffer.x=this._activeBuffer.savedX||0,this._activeBuffer.y=Math.max(this._activeBuffer.savedY-this._activeBuffer.ybase,0),this._curAttrData.fg=this._activeBuffer.savedCurAttrData.fg,this._curAttrData.bg=this._activeBuffer.savedCurAttrData.bg,this._charsetService.charset=this._savedCharset,this._activeBuffer.savedCharset&&(this._charsetService.charset=this._activeBuffer.savedCharset),this._restrictCursor(),!0}setTitle(x){return this._windowTitle=x,this._onTitleChange.fire(x),!0}setIconName(x){return this._iconName=x,!0}setOrReportIndexedColor(x){let E=[],L=x.split(";");for(;L.length>1;){let R=L.shift(),N=L.shift();if(/^\d+$/.exec(R)){let j=parseInt(R);if(B(j))if(N==="?")E.push({type:0,index:j});else{let X=(0,_.parseColor)(N);X&&E.push({type:1,index:j,color:X})}}}return E.length&&this._onColor.fire(E),!0}setHyperlink(x){let E=x.split(";");return!(E.length<2)&&(E[1]?this._createHyperlink(E[0],E[1]):!E[0]&&this._finishHyperlink())}_createHyperlink(x,E){this._getCurrentLinkId()&&this._finishHyperlink();let L=x.split(":"),R,N=L.findIndex((j=>j.startsWith("id=")));return N!==-1&&(R=L[N].slice(3)||void 0),this._curAttrData.extended=this._curAttrData.extended.clone(),this._curAttrData.extended.urlId=this._oscLinkService.registerLink({id:R,uri:E}),this._curAttrData.updateExtended(),!0}_finishHyperlink(){return this._curAttrData.extended=this._curAttrData.extended.clone(),this._curAttrData.extended.urlId=0,this._curAttrData.updateExtended(),!0}_setOrReportSpecialColor(x,E){let L=x.split(";");for(let R=0;R<L.length&&!(E>=this._specialColors.length);++R,++E)if(L[R]==="?")this._onColor.fire([{type:0,index:this._specialColors[E]}]);else{let N=(0,_.parseColor)(L[R]);N&&this._onColor.fire([{type:1,index:this._specialColors[E],color:N}])}return!0}setOrReportFgColor(x){return this._setOrReportSpecialColor(x,0)}setOrReportBgColor(x){return this._setOrReportSpecialColor(x,1)}setOrReportCursorColor(x){return this._setOrReportSpecialColor(x,2)}restoreIndexedColor(x){if(!x)return this._onColor.fire([{type:2}]),!0;let E=[],L=x.split(";");for(let R=0;R<L.length;++R)if(/^\d+$/.exec(L[R])){let N=parseInt(L[R]);B(N)&&E.push({type:2,index:N})}return E.length&&this._onColor.fire(E),!0}restoreFgColor(x){return this._onColor.fire([{type:2,index:256}]),!0}restoreBgColor(x){return this._onColor.fire([{type:2,index:257}]),!0}restoreCursorColor(x){return this._onColor.fire([{type:2,index:258}]),!0}nextLine(){return this._activeBuffer.x=0,this.index(),!0}keypadApplicationMode(){return this._logService.debug("Serial port requested application keypad."),this._coreService.decPrivateModes.applicationKeypad=!0,this._onRequestSyncScrollBar.fire(),!0}keypadNumericMode(){return this._logService.debug("Switching back to normal keypad."),this._coreService.decPrivateModes.applicationKeypad=!1,this._onRequestSyncScrollBar.fire(),!0}selectDefaultCharset(){return this._charsetService.setgLevel(0),this._charsetService.setgCharset(0,f.DEFAULT_CHARSET),!0}selectCharset(x){return x.length!==2?(this.selectDefaultCharset(),!0):(x[0]==="/"||this._charsetService.setgCharset(S[x[0]],f.CHARSETS[x[1]]||f.DEFAULT_CHARSET),!0)}index(){return this._restrictCursor(),this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData())):this._activeBuffer.y>=this._bufferService.rows&&(this._activeBuffer.y=this._bufferService.rows-1),this._restrictCursor(),!0}tabSet(){return this._activeBuffer.tabs[this._activeBuffer.x]=!0,!0}reverseIndex(){if(this._restrictCursor(),this._activeBuffer.y===this._activeBuffer.scrollTop){let x=this._activeBuffer.scrollBottom-this._activeBuffer.scrollTop;this._activeBuffer.lines.shiftElements(this._activeBuffer.ybase+this._activeBuffer.y,x,1),this._activeBuffer.lines.set(this._activeBuffer.ybase+this._activeBuffer.y,this._activeBuffer.getBlankLine(this._eraseAttrData())),this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom)}else this._activeBuffer.y--,this._restrictCursor();return!0}fullReset(){return this._parser.reset(),this._onRequestReset.fire(),!0}reset(){this._curAttrData=o.DEFAULT_ATTR_DATA.clone(),this._eraseAttrDataInternal=o.DEFAULT_ATTR_DATA.clone()}_eraseAttrData(){return this._eraseAttrDataInternal.bg&=-67108864,this._eraseAttrDataInternal.bg|=67108863&this._curAttrData.bg,this._eraseAttrDataInternal}setgLevel(x){return this._charsetService.setgLevel(x),!0}screenAlignmentPattern(){let x=new h.CellData;x.content=4194373,x.fg=this._curAttrData.fg,x.bg=this._curAttrData.bg,this._setCursor(0,0);for(let E=0;E<this._bufferService.rows;++E){let L=this._activeBuffer.ybase+this._activeBuffer.y+E,R=this._activeBuffer.lines.get(L);R&&(R.fill(x),R.isWrapped=!1)}return this._dirtyRowTracker.markAllDirty(),this._setCursor(0,0),!0}requestStatusString(x,E){let L=this._bufferService.buffer,R=this._optionsService.rawOptions;return(N=>(this._coreService.triggerDataEvent(`${d.C0.ESC}${N}${d.C0.ESC}\\`),!0))(x==='"q'?`P1$r${this._curAttrData.isProtected()?1:0}"q`:x==='"p'?'P1$r61;1"p':x==="r"?`P1$r${L.scrollTop+1};${L.scrollBottom+1}r`:x==="m"?"P1$r0m":x===" q"?`P1$r${{block:2,underline:4,bar:6}[R.cursorStyle]-(R.cursorBlink?1:0)} q`:"P0$r")}markRangeDirty(x,E){this._dirtyRowTracker.markRangeDirty(x,E)}}s.InputHandler=z;let I=class{constructor(H){this._bufferService=H,this.clearRange()}clearRange(){this.start=this._bufferService.buffer.y,this.end=this._bufferService.buffer.y}markDirty(H){H<this.start?this.start=H:H>this.end&&(this.end=H)}markRangeDirty(H,x){H>x&&(O=H,H=x,x=O),H<this.start&&(this.start=H),x>this.end&&(this.end=x)}markAllDirty(){this.markRangeDirty(0,this._bufferService.rows-1)}};function B(H){return 0<=H&&H<256}I=l([p(0,v.IBufferService)],I)},844:(u,s)=>{function r(l){for(let p of l)p.dispose();l.length=0}Object.defineProperty(s,"__esModule",{value:!0}),s.getDisposeArrayDisposable=s.disposeArray=s.toDisposable=s.MutableDisposable=s.Disposable=void 0,s.Disposable=class{constructor(){this._disposables=[],this._isDisposed=!1}dispose(){this._isDisposed=!0;for(let l of this._disposables)l.dispose();this._disposables.length=0}register(l){return this._disposables.push(l),l}unregister(l){let p=this._disposables.indexOf(l);p!==-1&&this._disposables.splice(p,1)}},s.MutableDisposable=class{constructor(){this._isDisposed=!1}get value(){return this._isDisposed?void 0:this._value}set value(l){var p;this._isDisposed||l===this._value||((p=this._value)===null||p===void 0||p.dispose(),this._value=l)}clear(){this.value=void 0}dispose(){var l;this._isDisposed=!0,(l=this._value)===null||l===void 0||l.dispose(),this._value=void 0}},s.toDisposable=function(l){return{dispose:l}},s.disposeArray=r,s.getDisposeArrayDisposable=function(l){return{dispose:()=>r(l)}}},1505:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.FourKeyMap=s.TwoKeyMap=void 0;class r{constructor(){this._data={}}set(p,d,f){this._data[p]||(this._data[p]={}),this._data[p][d]=f}get(p,d){return this._data[p]?this._data[p][d]:void 0}clear(){this._data={}}}s.TwoKeyMap=r,s.FourKeyMap=class{constructor(){this._data=new r}set(l,p,d,f,g){this._data.get(l,p)||this._data.set(l,p,new r),this._data.get(l,p).set(d,f,g)}get(l,p,d,f){var g;return(g=this._data.get(l,p))===null||g===void 0?void 0:g.get(d,f)}clear(){this._data.clear()}}},6114:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.isChromeOS=s.isLinux=s.isWindows=s.isIphone=s.isIpad=s.isMac=s.getSafariVersion=s.isSafari=s.isLegacyEdge=s.isFirefox=s.isNode=void 0,s.isNode=typeof navigator>"u";let r=s.isNode?"node":navigator.userAgent,l=s.isNode?"node":navigator.platform;s.isFirefox=r.includes("Firefox"),s.isLegacyEdge=r.includes("Edge"),s.isSafari=/^((?!chrome|android).)*safari/i.test(r),s.getSafariVersion=function(){if(!s.isSafari)return 0;let p=r.match(/Version\/(\d+)/);return p===null||p.length<2?0:parseInt(p[1])},s.isMac=["Macintosh","MacIntel","MacPPC","Mac68K"].includes(l),s.isIpad=l==="iPad",s.isIphone=l==="iPhone",s.isWindows=["Windows","Win16","Win32","WinCE"].includes(l),s.isLinux=l.indexOf("Linux")>=0,s.isChromeOS=/\bCrOS\b/.test(r)},6106:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.SortedList=void 0;let r=0;s.SortedList=class{constructor(l){this._getKey=l,this._array=[]}clear(){this._array.length=0}insert(l){this._array.length!==0?(r=this._search(this._getKey(l)),this._array.splice(r,0,l)):this._array.push(l)}delete(l){if(this._array.length===0)return!1;let p=this._getKey(l);if(p===void 0||(r=this._search(p),r===-1)||this._getKey(this._array[r])!==p)return!1;do if(this._array[r]===l)return this._array.splice(r,1),!0;while(++r<this._array.length&&this._getKey(this._array[r])===p);return!1}*getKeyIterator(l){if(this._array.length!==0&&(r=this._search(l),!(r<0||r>=this._array.length)&&this._getKey(this._array[r])===l))do yield this._array[r];while(++r<this._array.length&&this._getKey(this._array[r])===l)}forEachByKey(l,p){if(this._array.length!==0&&(r=this._search(l),!(r<0||r>=this._array.length)&&this._getKey(this._array[r])===l))do p(this._array[r]);while(++r<this._array.length&&this._getKey(this._array[r])===l)}values(){return[...this._array].values()}_search(l){let p=0,d=this._array.length-1;for(;d>=p;){let f=p+d>>1,g=this._getKey(this._array[f]);if(g>l)d=f-1;else{if(!(g<l)){for(;f>0&&this._getKey(this._array[f-1])===l;)f--;return f}p=f+1}}return p}}},7226:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.DebouncedIdleTask=s.IdleTaskQueue=s.PriorityTaskQueue=void 0;let l=r(6114);class p{constructor(){this._tasks=[],this._i=0}enqueue(g){this._tasks.push(g),this._start()}flush(){for(;this._i<this._tasks.length;)this._tasks[this._i]()||this._i++;this.clear()}clear(){this._idleCallback&&(this._cancelCallback(this._idleCallback),this._idleCallback=void 0),this._i=0,this._tasks.length=0}_start(){this._idleCallback||(this._idleCallback=this._requestCallback(this._process.bind(this)))}_process(g){this._idleCallback=void 0;let y=0,b=0,o=g.timeRemaining(),a=0;for(;this._i<this._tasks.length;){if(y=Date.now(),this._tasks[this._i]()||this._i++,y=Math.max(1,Date.now()-y),b=Math.max(y,b),a=g.timeRemaining(),1.5*b>a)return o-y<-20&&console.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(o-y))}ms`),void this._start();o=a}this.clear()}}class d extends p{_requestCallback(g){return setTimeout((()=>g(this._createDeadline(16))))}_cancelCallback(g){clearTimeout(g)}_createDeadline(g){let y=Date.now()+g;return{timeRemaining:()=>Math.max(0,y-Date.now())}}}s.PriorityTaskQueue=d,s.IdleTaskQueue=!l.isNode&&"requestIdleCallback"in window?class extends p{_requestCallback(f){return requestIdleCallback(f)}_cancelCallback(f){cancelIdleCallback(f)}}:d,s.DebouncedIdleTask=class{constructor(){this._queue=new s.IdleTaskQueue}set(f){this._queue.clear(),this._queue.enqueue(f)}flush(){this._queue.flush()}}},9282:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.updateWindowsModeWrappedState=void 0;let l=r(643);s.updateWindowsModeWrappedState=function(p){let d=p.buffer.lines.get(p.buffer.ybase+p.buffer.y-1),f=d?.get(p.cols-1),g=p.buffer.lines.get(p.buffer.ybase+p.buffer.y);g&&f&&(g.isWrapped=f[l.CHAR_DATA_CODE_INDEX]!==l.NULL_CELL_CODE&&f[l.CHAR_DATA_CODE_INDEX]!==l.WHITESPACE_CELL_CODE)}},3734:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.ExtendedAttrs=s.AttributeData=void 0;class r{constructor(){this.fg=0,this.bg=0,this.extended=new l}static toColorRGB(d){return[d>>>16&255,d>>>8&255,255&d]}static fromColorRGB(d){return(255&d[0])<<16|(255&d[1])<<8|255&d[2]}clone(){let d=new r;return d.fg=this.fg,d.bg=this.bg,d.extended=this.extended.clone(),d}isInverse(){return 67108864&this.fg}isBold(){return 134217728&this.fg}isUnderline(){return this.hasExtendedAttrs()&&this.extended.underlineStyle!==0?1:268435456&this.fg}isBlink(){return 536870912&this.fg}isInvisible(){return 1073741824&this.fg}isItalic(){return 67108864&this.bg}isDim(){return 134217728&this.bg}isStrikethrough(){return 2147483648&this.fg}isProtected(){return 536870912&this.bg}isOverline(){return 1073741824&this.bg}getFgColorMode(){return 50331648&this.fg}getBgColorMode(){return 50331648&this.bg}isFgRGB(){return(50331648&this.fg)==50331648}isBgRGB(){return(50331648&this.bg)==50331648}isFgPalette(){return(50331648&this.fg)==16777216||(50331648&this.fg)==33554432}isBgPalette(){return(50331648&this.bg)==16777216||(50331648&this.bg)==33554432}isFgDefault(){return(50331648&this.fg)==0}isBgDefault(){return(50331648&this.bg)==0}isAttributeDefault(){return this.fg===0&&this.bg===0}getFgColor(){switch(50331648&this.fg){case 16777216:case 33554432:return 255&this.fg;case 50331648:return 16777215&this.fg;default:return-1}}getBgColor(){switch(50331648&this.bg){case 16777216:case 33554432:return 255&this.bg;case 50331648:return 16777215&this.bg;default:return-1}}hasExtendedAttrs(){return 268435456&this.bg}updateExtended(){this.extended.isEmpty()?this.bg&=-268435457:this.bg|=268435456}getUnderlineColor(){if(268435456&this.bg&&~this.extended.underlineColor)switch(50331648&this.extended.underlineColor){case 16777216:case 33554432:return 255&this.extended.underlineColor;case 50331648:return 16777215&this.extended.underlineColor;default:return this.getFgColor()}return this.getFgColor()}getUnderlineColorMode(){return 268435456&this.bg&&~this.extended.underlineColor?50331648&this.extended.underlineColor:this.getFgColorMode()}isUnderlineColorRGB(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==50331648:this.isFgRGB()}isUnderlineColorPalette(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==16777216||(50331648&this.extended.underlineColor)==33554432:this.isFgPalette()}isUnderlineColorDefault(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==0:this.isFgDefault()}getUnderlineStyle(){return 268435456&this.fg?268435456&this.bg?this.extended.underlineStyle:1:0}}s.AttributeData=r;class l{get ext(){return this._urlId?-469762049&this._ext|this.underlineStyle<<26:this._ext}set ext(d){this._ext=d}get underlineStyle(){return this._urlId?5:(469762048&this._ext)>>26}set underlineStyle(d){this._ext&=-469762049,this._ext|=d<<26&469762048}get underlineColor(){return 67108863&this._ext}set underlineColor(d){this._ext&=-67108864,this._ext|=67108863&d}get urlId(){return this._urlId}set urlId(d){this._urlId=d}constructor(d=0,f=0){this._ext=0,this._urlId=0,this._ext=d,this._urlId=f}clone(){return new l(this._ext,this._urlId)}isEmpty(){return this.underlineStyle===0&&this._urlId===0}}s.ExtendedAttrs=l},9092:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.Buffer=s.MAX_BUFFER_SIZE=void 0;let l=r(6349),p=r(7226),d=r(3734),f=r(8437),g=r(4634),y=r(511),b=r(643),o=r(4863),a=r(7116);s.MAX_BUFFER_SIZE=4294967295,s.Buffer=class{constructor(c,h,m){this._hasScrollback=c,this._optionsService=h,this._bufferService=m,this.ydisp=0,this.ybase=0,this.y=0,this.x=0,this.tabs={},this.savedY=0,this.savedX=0,this.savedCurAttrData=f.DEFAULT_ATTR_DATA.clone(),this.savedCharset=a.DEFAULT_CHARSET,this.markers=[],this._nullCell=y.CellData.fromCharData([0,b.NULL_CELL_CHAR,b.NULL_CELL_WIDTH,b.NULL_CELL_CODE]),this._whitespaceCell=y.CellData.fromCharData([0,b.WHITESPACE_CELL_CHAR,b.WHITESPACE_CELL_WIDTH,b.WHITESPACE_CELL_CODE]),this._isClearing=!1,this._memoryCleanupQueue=new p.IdleTaskQueue,this._memoryCleanupPosition=0,this._cols=this._bufferService.cols,this._rows=this._bufferService.rows,this.lines=new l.CircularList(this._getCorrectBufferLength(this._rows)),this.scrollTop=0,this.scrollBottom=this._rows-1,this.setupTabStops()}getNullCell(c){return c?(this._nullCell.fg=c.fg,this._nullCell.bg=c.bg,this._nullCell.extended=c.extended):(this._nullCell.fg=0,this._nullCell.bg=0,this._nullCell.extended=new d.ExtendedAttrs),this._nullCell}getWhitespaceCell(c){return c?(this._whitespaceCell.fg=c.fg,this._whitespaceCell.bg=c.bg,this._whitespaceCell.extended=c.extended):(this._whitespaceCell.fg=0,this._whitespaceCell.bg=0,this._whitespaceCell.extended=new d.ExtendedAttrs),this._whitespaceCell}getBlankLine(c,h){return new f.BufferLine(this._bufferService.cols,this.getNullCell(c),h)}get hasScrollback(){return this._hasScrollback&&this.lines.maxLength>this._rows}get isCursorInViewport(){let c=this.ybase+this.y-this.ydisp;return c>=0&&c<this._rows}_getCorrectBufferLength(c){if(!this._hasScrollback)return c;let h=c+this._optionsService.rawOptions.scrollback;return h>s.MAX_BUFFER_SIZE?s.MAX_BUFFER_SIZE:h}fillViewportRows(c){if(this.lines.length===0){c===void 0&&(c=f.DEFAULT_ATTR_DATA);let h=this._rows;for(;h--;)this.lines.push(this.getBlankLine(c))}}clear(){this.ydisp=0,this.ybase=0,this.y=0,this.x=0,this.lines=new l.CircularList(this._getCorrectBufferLength(this._rows)),this.scrollTop=0,this.scrollBottom=this._rows-1,this.setupTabStops()}resize(c,h){let m=this.getNullCell(f.DEFAULT_ATTR_DATA),v=0,w=this._getCorrectBufferLength(h);if(w>this.lines.maxLength&&(this.lines.maxLength=w),this.lines.length>0){if(this._cols<c)for(let _=0;_<this.lines.length;_++)v+=+this.lines.get(_).resize(c,m);let C=0;if(this._rows<h)for(let _=this._rows;_<h;_++)this.lines.length<h+this.ybase&&(this._optionsService.rawOptions.windowsMode||this._optionsService.rawOptions.windowsPty.backend!==void 0||this._optionsService.rawOptions.windowsPty.buildNumber!==void 0?this.lines.push(new f.BufferLine(c,m)):this.ybase>0&&this.lines.length<=this.ybase+this.y+C+1?(this.ybase--,C++,this.ydisp>0&&this.ydisp--):this.lines.push(new f.BufferLine(c,m)));else for(let _=this._rows;_>h;_--)this.lines.length>h+this.ybase&&(this.lines.length>this.ybase+this.y+1?this.lines.pop():(this.ybase++,this.ydisp++));if(w<this.lines.maxLength){let _=this.lines.length-w;_>0&&(this.lines.trimStart(_),this.ybase=Math.max(this.ybase-_,0),this.ydisp=Math.max(this.ydisp-_,0),this.savedY=Math.max(this.savedY-_,0)),this.lines.maxLength=w}this.x=Math.min(this.x,c-1),this.y=Math.min(this.y,h-1),C&&(this.y+=C),this.savedX=Math.min(this.savedX,c-1),this.scrollTop=0}if(this.scrollBottom=h-1,this._isReflowEnabled&&(this._reflow(c,h),this._cols>c))for(let C=0;C<this.lines.length;C++)v+=+this.lines.get(C).resize(c,m);this._cols=c,this._rows=h,this._memoryCleanupQueue.clear(),v>.1*this.lines.length&&(this._memoryCleanupPosition=0,this._memoryCleanupQueue.enqueue((()=>this._batchedMemoryCleanup())))}_batchedMemoryCleanup(){let c=!0;this._memoryCleanupPosition>=this.lines.length&&(this._memoryCleanupPosition=0,c=!1);let h=0;for(;this._memoryCleanupPosition<this.lines.length;)if(h+=this.lines.get(this._memoryCleanupPosition++).cleanupMemory(),h>100)return!0;return c}get _isReflowEnabled(){let c=this._optionsService.rawOptions.windowsPty;return c&&c.buildNumber?this._hasScrollback&&c.backend==="conpty"&&c.buildNumber>=21376:this._hasScrollback&&!this._optionsService.rawOptions.windowsMode}_reflow(c,h){this._cols!==c&&(c>this._cols?this._reflowLarger(c,h):this._reflowSmaller(c,h))}_reflowLarger(c,h){let m=(0,g.reflowLargerGetLinesToRemove)(this.lines,this._cols,c,this.ybase+this.y,this.getNullCell(f.DEFAULT_ATTR_DATA));if(m.length>0){let v=(0,g.reflowLargerCreateNewLayout)(this.lines,m);(0,g.reflowLargerApplyNewLayout)(this.lines,v.layout),this._reflowLargerAdjustViewport(c,h,v.countRemoved)}}_reflowLargerAdjustViewport(c,h,m){let v=this.getNullCell(f.DEFAULT_ATTR_DATA),w=m;for(;w-- >0;)this.ybase===0?(this.y>0&&this.y--,this.lines.length<h&&this.lines.push(new f.BufferLine(c,v))):(this.ydisp===this.ybase&&this.ydisp--,this.ybase--);this.savedY=Math.max(this.savedY-m,0)}_reflowSmaller(c,h){let m=this.getNullCell(f.DEFAULT_ATTR_DATA),v=[],w=0;for(let C=this.lines.length-1;C>=0;C--){let _=this.lines.get(C);if(!_||!_.isWrapped&&_.getTrimmedLength()<=c)continue;let S=[_];for(;_.isWrapped&&C>0;)_=this.lines.get(--C),S.unshift(_);let T=this.ybase+this.y;if(T>=C&&T<C+S.length)continue;let $=S[S.length-1].getTrimmedLength(),D=(0,g.reflowSmallerGetNewLineLengths)(S,this._cols,c),O=D.length-S.length,z;z=this.ybase===0&&this.y!==this.lines.length-1?Math.max(0,this.y-this.lines.maxLength+O):Math.max(0,this.lines.length-this.lines.maxLength+O);let I=[];for(let R=0;R<O;R++){let N=this.getBlankLine(f.DEFAULT_ATTR_DATA,!0);I.push(N)}I.length>0&&(v.push({start:C+S.length+w,newLines:I}),w+=I.length),S.push(...I);let B=D.length-1,H=D[B];H===0&&(B--,H=D[B]);let x=S.length-O-1,E=$;for(;x>=0;){let R=Math.min(E,H);if(S[B]===void 0)break;if(S[B].copyCellsFrom(S[x],E-R,H-R,R,!0),H-=R,H===0&&(B--,H=D[B]),E-=R,E===0){x--;let N=Math.max(x,0);E=(0,g.getWrappedLineTrimmedLength)(S,N,this._cols)}}for(let R=0;R<S.length;R++)D[R]<c&&S[R].setCell(D[R],m);let L=O-z;for(;L-- >0;)this.ybase===0?this.y<h-1?(this.y++,this.lines.pop()):(this.ybase++,this.ydisp++):this.ybase<Math.min(this.lines.maxLength,this.lines.length+w)-h&&(this.ybase===this.ydisp&&this.ydisp++,this.ybase++);this.savedY=Math.min(this.savedY+O,this.ybase+h-1)}if(v.length>0){let C=[],_=[];for(let B=0;B<this.lines.length;B++)_.push(this.lines.get(B));let S=this.lines.length,T=S-1,$=0,D=v[$];this.lines.length=Math.min(this.lines.maxLength,this.lines.length+w);let O=0;for(let B=Math.min(this.lines.maxLength-1,S+w-1);B>=0;B--)if(D&&D.start>T+O){for(let H=D.newLines.length-1;H>=0;H--)this.lines.set(B--,D.newLines[H]);B++,C.push({index:T+1,amount:D.newLines.length}),O+=D.newLines.length,D=v[++$]}else this.lines.set(B,_[T--]);let z=0;for(let B=C.length-1;B>=0;B--)C[B].index+=z,this.lines.onInsertEmitter.fire(C[B]),z+=C[B].amount;let I=Math.max(0,S+w-this.lines.maxLength);I>0&&this.lines.onTrimEmitter.fire(I)}}translateBufferLineToString(c,h,m=0,v){let w=this.lines.get(c);return w?w.translateToString(h,m,v):""}getWrappedRangeForLine(c){let h=c,m=c;for(;h>0&&this.lines.get(h).isWrapped;)h--;for(;m+1<this.lines.length&&this.lines.get(m+1).isWrapped;)m++;return{first:h,last:m}}setupTabStops(c){for(c!=null?this.tabs[c]||(c=this.prevStop(c)):(this.tabs={},c=0);c<this._cols;c+=this._optionsService.rawOptions.tabStopWidth)this.tabs[c]=!0}prevStop(c){for(c==null&&(c=this.x);!this.tabs[--c]&&c>0;);return c>=this._cols?this._cols-1:c<0?0:c}nextStop(c){for(c==null&&(c=this.x);!this.tabs[++c]&&c<this._cols;);return c>=this._cols?this._cols-1:c<0?0:c}clearMarkers(c){this._isClearing=!0;for(let h=0;h<this.markers.length;h++)this.markers[h].line===c&&(this.markers[h].dispose(),this.markers.splice(h--,1));this._isClearing=!1}clearAllMarkers(){this._isClearing=!0;for(let c=0;c<this.markers.length;c++)this.markers[c].dispose(),this.markers.splice(c--,1);this._isClearing=!1}addMarker(c){let h=new o.Marker(c);return this.markers.push(h),h.register(this.lines.onTrim((m=>{h.line-=m,h.line<0&&h.dispose()}))),h.register(this.lines.onInsert((m=>{h.line>=m.index&&(h.line+=m.amount)}))),h.register(this.lines.onDelete((m=>{h.line>=m.index&&h.line<m.index+m.amount&&h.dispose(),h.line>m.index&&(h.line-=m.amount)}))),h.register(h.onDispose((()=>this._removeMarker(h)))),h}_removeMarker(c){this._isClearing||this.markers.splice(this.markers.indexOf(c),1)}}},8437:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.BufferLine=s.DEFAULT_ATTR_DATA=void 0;let l=r(3734),p=r(511),d=r(643),f=r(482);s.DEFAULT_ATTR_DATA=Object.freeze(new l.AttributeData);let g=0;class y{constructor(o,a,c=!1){this.isWrapped=c,this._combined={},this._extendedAttrs={},this._data=new Uint32Array(3*o);let h=a||p.CellData.fromCharData([0,d.NULL_CELL_CHAR,d.NULL_CELL_WIDTH,d.NULL_CELL_CODE]);for(let m=0;m<o;++m)this.setCell(m,h);this.length=o}get(o){let a=this._data[3*o+0],c=2097151&a;return[this._data[3*o+1],2097152&a?this._combined[o]:c?(0,f.stringFromCodePoint)(c):"",a>>22,2097152&a?this._combined[o].charCodeAt(this._combined[o].length-1):c]}set(o,a){this._data[3*o+1]=a[d.CHAR_DATA_ATTR_INDEX],a[d.CHAR_DATA_CHAR_INDEX].length>1?(this._combined[o]=a[1],this._data[3*o+0]=2097152|o|a[d.CHAR_DATA_WIDTH_INDEX]<<22):this._data[3*o+0]=a[d.CHAR_DATA_CHAR_INDEX].charCodeAt(0)|a[d.CHAR_DATA_WIDTH_INDEX]<<22}getWidth(o){return this._data[3*o+0]>>22}hasWidth(o){return 12582912&this._data[3*o+0]}getFg(o){return this._data[3*o+1]}getBg(o){return this._data[3*o+2]}hasContent(o){return 4194303&this._data[3*o+0]}getCodePoint(o){let a=this._data[3*o+0];return 2097152&a?this._combined[o].charCodeAt(this._combined[o].length-1):2097151&a}isCombined(o){return 2097152&this._data[3*o+0]}getString(o){let a=this._data[3*o+0];return 2097152&a?this._combined[o]:2097151&a?(0,f.stringFromCodePoint)(2097151&a):""}isProtected(o){return 536870912&this._data[3*o+2]}loadCell(o,a){return g=3*o,a.content=this._data[g+0],a.fg=this._data[g+1],a.bg=this._data[g+2],2097152&a.content&&(a.combinedData=this._combined[o]),268435456&a.bg&&(a.extended=this._extendedAttrs[o]),a}setCell(o,a){2097152&a.content&&(this._combined[o]=a.combinedData),268435456&a.bg&&(this._extendedAttrs[o]=a.extended),this._data[3*o+0]=a.content,this._data[3*o+1]=a.fg,this._data[3*o+2]=a.bg}setCellFromCodePoint(o,a,c,h,m,v){268435456&m&&(this._extendedAttrs[o]=v),this._data[3*o+0]=a|c<<22,this._data[3*o+1]=h,this._data[3*o+2]=m}addCodepointToCell(o,a){let c=this._data[3*o+0];2097152&c?this._combined[o]+=(0,f.stringFromCodePoint)(a):(2097151&c?(this._combined[o]=(0,f.stringFromCodePoint)(2097151&c)+(0,f.stringFromCodePoint)(a),c&=-2097152,c|=2097152):c=a|4194304,this._data[3*o+0]=c)}insertCells(o,a,c,h){if((o%=this.length)&&this.getWidth(o-1)===2&&this.setCellFromCodePoint(o-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs),a<this.length-o){let m=new p.CellData;for(let v=this.length-o-a-1;v>=0;--v)this.setCell(o+a+v,this.loadCell(o+v,m));for(let v=0;v<a;++v)this.setCell(o+v,c)}else for(let m=o;m<this.length;++m)this.setCell(m,c);this.getWidth(this.length-1)===2&&this.setCellFromCodePoint(this.length-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs)}deleteCells(o,a,c,h){if(o%=this.length,a<this.length-o){let m=new p.CellData;for(let v=0;v<this.length-o-a;++v)this.setCell(o+v,this.loadCell(o+a+v,m));for(let v=this.length-a;v<this.length;++v)this.setCell(v,c)}else for(let m=o;m<this.length;++m)this.setCell(m,c);o&&this.getWidth(o-1)===2&&this.setCellFromCodePoint(o-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs),this.getWidth(o)!==0||this.hasContent(o)||this.setCellFromCodePoint(o,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs)}replaceCells(o,a,c,h,m=!1){if(m)for(o&&this.getWidth(o-1)===2&&!this.isProtected(o-1)&&this.setCellFromCodePoint(o-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs),a<this.length&&this.getWidth(a-1)===2&&!this.isProtected(a)&&this.setCellFromCodePoint(a,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs);o<a&&o<this.length;)this.isProtected(o)||this.setCell(o,c),o++;else for(o&&this.getWidth(o-1)===2&&this.setCellFromCodePoint(o-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs),a<this.length&&this.getWidth(a-1)===2&&this.setCellFromCodePoint(a,0,1,h?.fg||0,h?.bg||0,h?.extended||new l.ExtendedAttrs);o<a&&o<this.length;)this.setCell(o++,c)}resize(o,a){if(o===this.length)return 4*this._data.length*2<this._data.buffer.byteLength;let c=3*o;if(o>this.length){if(this._data.buffer.byteLength>=4*c)this._data=new Uint32Array(this._data.buffer,0,c);else{let h=new Uint32Array(c);h.set(this._data),this._data=h}for(let h=this.length;h<o;++h)this.setCell(h,a)}else{this._data=this._data.subarray(0,c);let h=Object.keys(this._combined);for(let v=0;v<h.length;v++){let w=parseInt(h[v],10);w>=o&&delete this._combined[w]}let m=Object.keys(this._extendedAttrs);for(let v=0;v<m.length;v++){let w=parseInt(m[v],10);w>=o&&delete this._extendedAttrs[w]}}return this.length=o,4*c*2<this._data.buffer.byteLength}cleanupMemory(){if(4*this._data.length*2<this._data.buffer.byteLength){let o=new Uint32Array(this._data.length);return o.set(this._data),this._data=o,1}return 0}fill(o,a=!1){if(a)for(let c=0;c<this.length;++c)this.isProtected(c)||this.setCell(c,o);else{this._combined={},this._extendedAttrs={};for(let c=0;c<this.length;++c)this.setCell(c,o)}}copyFrom(o){this.length!==o.length?this._data=new Uint32Array(o._data):this._data.set(o._data),this.length=o.length,this._combined={};for(let a in o._combined)this._combined[a]=o._combined[a];this._extendedAttrs={};for(let a in o._extendedAttrs)this._extendedAttrs[a]=o._extendedAttrs[a];this.isWrapped=o.isWrapped}clone(){let o=new y(0);o._data=new Uint32Array(this._data),o.length=this.length;for(let a in this._combined)o._combined[a]=this._combined[a];for(let a in this._extendedAttrs)o._extendedAttrs[a]=this._extendedAttrs[a];return o.isWrapped=this.isWrapped,o}getTrimmedLength(){for(let o=this.length-1;o>=0;--o)if(4194303&this._data[3*o+0])return o+(this._data[3*o+0]>>22);return 0}getNoBgTrimmedLength(){for(let o=this.length-1;o>=0;--o)if(4194303&this._data[3*o+0]||50331648&this._data[3*o+2])return o+(this._data[3*o+0]>>22);return 0}copyCellsFrom(o,a,c,h,m){let v=o._data;if(m)for(let C=h-1;C>=0;C--){for(let _=0;_<3;_++)this._data[3*(c+C)+_]=v[3*(a+C)+_];268435456&v[3*(a+C)+2]&&(this._extendedAttrs[c+C]=o._extendedAttrs[a+C])}else for(let C=0;C<h;C++){for(let _=0;_<3;_++)this._data[3*(c+C)+_]=v[3*(a+C)+_];268435456&v[3*(a+C)+2]&&(this._extendedAttrs[c+C]=o._extendedAttrs[a+C])}let w=Object.keys(o._combined);for(let C=0;C<w.length;C++){let _=parseInt(w[C],10);_>=a&&(this._combined[_-a+c]=o._combined[_])}}translateToString(o=!1,a=0,c=this.length){o&&(c=Math.min(c,this.getTrimmedLength()));let h="";for(;a<c;){let m=this._data[3*a+0],v=2097151&m;h+=2097152&m?this._combined[a]:v?(0,f.stringFromCodePoint)(v):d.WHITESPACE_CELL_CHAR,a+=m>>22||1}return h}}s.BufferLine=y},4841:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.getRangeLength=void 0,s.getRangeLength=function(r,l){if(r.start.y>r.end.y)throw new Error(`Buffer range end (${r.end.x}, ${r.end.y}) cannot be before start (${r.start.x}, ${r.start.y})`);return l*(r.end.y-r.start.y)+(r.end.x-r.start.x+1)}},4634:(u,s)=>{function r(l,p,d){if(p===l.length-1)return l[p].getTrimmedLength();let f=!l[p].hasContent(d-1)&&l[p].getWidth(d-1)===1,g=l[p+1].getWidth(0)===2;return f&&g?d-1:d}Object.defineProperty(s,"__esModule",{value:!0}),s.getWrappedLineTrimmedLength=s.reflowSmallerGetNewLineLengths=s.reflowLargerApplyNewLayout=s.reflowLargerCreateNewLayout=s.reflowLargerGetLinesToRemove=void 0,s.reflowLargerGetLinesToRemove=function(l,p,d,f,g){let y=[];for(let b=0;b<l.length-1;b++){let o=b,a=l.get(++o);if(!a.isWrapped)continue;let c=[l.get(b)];for(;o<l.length&&a.isWrapped;)c.push(a),a=l.get(++o);if(f>=b&&f<o){b+=c.length-1;continue}let h=0,m=r(c,h,p),v=1,w=0;for(;v<c.length;){let _=r(c,v,p),S=_-w,T=d-m,$=Math.min(S,T);c[h].copyCellsFrom(c[v],w,m,$,!1),m+=$,m===d&&(h++,m=0),w+=$,w===_&&(v++,w=0),m===0&&h!==0&&c[h-1].getWidth(d-1)===2&&(c[h].copyCellsFrom(c[h-1],d-1,m++,1,!1),c[h-1].setCell(d-1,g))}c[h].replaceCells(m,d,g);let C=0;for(let _=c.length-1;_>0&&(_>h||c[_].getTrimmedLength()===0);_--)C++;C>0&&(y.push(b+c.length-C),y.push(C)),b+=c.length-1}return y},s.reflowLargerCreateNewLayout=function(l,p){let d=[],f=0,g=p[f],y=0;for(let b=0;b<l.length;b++)if(g===b){let o=p[++f];l.onDeleteEmitter.fire({index:b-y,amount:o}),b+=o-1,y+=o,g=p[++f]}else d.push(b);return{layout:d,countRemoved:y}},s.reflowLargerApplyNewLayout=function(l,p){let d=[];for(let f=0;f<p.length;f++)d.push(l.get(p[f]));for(let f=0;f<d.length;f++)l.set(f,d[f]);l.length=p.length},s.reflowSmallerGetNewLineLengths=function(l,p,d){let f=[],g=l.map(((a,c)=>r(l,c,p))).reduce(((a,c)=>a+c)),y=0,b=0,o=0;for(;o<g;){if(g-o<d){f.push(g-o);break}y+=d;let a=r(l,b,p);y>a&&(y-=a,b++);let c=l[b].getWidth(y-1)===2;c&&y--;let h=c?d-1:d;f.push(h),o+=h}return f},s.getWrappedLineTrimmedLength=r},5295:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.BufferSet=void 0;let l=r(8460),p=r(844),d=r(9092);class f extends p.Disposable{constructor(y,b){super(),this._optionsService=y,this._bufferService=b,this._onBufferActivate=this.register(new l.EventEmitter),this.onBufferActivate=this._onBufferActivate.event,this.reset(),this.register(this._optionsService.onSpecificOptionChange("scrollback",(()=>this.resize(this._bufferService.cols,this._bufferService.rows)))),this.register(this._optionsService.onSpecificOptionChange("tabStopWidth",(()=>this.setupTabStops())))}reset(){this._normal=new d.Buffer(!0,this._optionsService,this._bufferService),this._normal.fillViewportRows(),this._alt=new d.Buffer(!1,this._optionsService,this._bufferService),this._activeBuffer=this._normal,this._onBufferActivate.fire({activeBuffer:this._normal,inactiveBuffer:this._alt}),this.setupTabStops()}get alt(){return this._alt}get active(){return this._activeBuffer}get normal(){return this._normal}activateNormalBuffer(){this._activeBuffer!==this._normal&&(this._normal.x=this._alt.x,this._normal.y=this._alt.y,this._alt.clearAllMarkers(),this._alt.clear(),this._activeBuffer=this._normal,this._onBufferActivate.fire({activeBuffer:this._normal,inactiveBuffer:this._alt}))}activateAltBuffer(y){this._activeBuffer!==this._alt&&(this._alt.fillViewportRows(y),this._alt.x=this._normal.x,this._alt.y=this._normal.y,this._activeBuffer=this._alt,this._onBufferActivate.fire({activeBuffer:this._alt,inactiveBuffer:this._normal}))}resize(y,b){this._normal.resize(y,b),this._alt.resize(y,b),this.setupTabStops(y)}setupTabStops(y){this._normal.setupTabStops(y),this._alt.setupTabStops(y)}}s.BufferSet=f},511:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.CellData=void 0;let l=r(482),p=r(643),d=r(3734);class f extends d.AttributeData{constructor(){super(...arguments),this.content=0,this.fg=0,this.bg=0,this.extended=new d.ExtendedAttrs,this.combinedData=""}static fromCharData(y){let b=new f;return b.setFromCharData(y),b}isCombined(){return 2097152&this.content}getWidth(){return this.content>>22}getChars(){return 2097152&this.content?this.combinedData:2097151&this.content?(0,l.stringFromCodePoint)(2097151&this.content):""}getCode(){return this.isCombined()?this.combinedData.charCodeAt(this.combinedData.length-1):2097151&this.content}setFromCharData(y){this.fg=y[p.CHAR_DATA_ATTR_INDEX],this.bg=0;let b=!1;if(y[p.CHAR_DATA_CHAR_INDEX].length>2)b=!0;else if(y[p.CHAR_DATA_CHAR_INDEX].length===2){let o=y[p.CHAR_DATA_CHAR_INDEX].charCodeAt(0);if(55296<=o&&o<=56319){let a=y[p.CHAR_DATA_CHAR_INDEX].charCodeAt(1);56320<=a&&a<=57343?this.content=1024*(o-55296)+a-56320+65536|y[p.CHAR_DATA_WIDTH_INDEX]<<22:b=!0}else b=!0}else this.content=y[p.CHAR_DATA_CHAR_INDEX].charCodeAt(0)|y[p.CHAR_DATA_WIDTH_INDEX]<<22;b&&(this.combinedData=y[p.CHAR_DATA_CHAR_INDEX],this.content=2097152|y[p.CHAR_DATA_WIDTH_INDEX]<<22)}getAsCharData(){return[this.fg,this.getChars(),this.getWidth(),this.getCode()]}}s.CellData=f},643:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.WHITESPACE_CELL_CODE=s.WHITESPACE_CELL_WIDTH=s.WHITESPACE_CELL_CHAR=s.NULL_CELL_CODE=s.NULL_CELL_WIDTH=s.NULL_CELL_CHAR=s.CHAR_DATA_CODE_INDEX=s.CHAR_DATA_WIDTH_INDEX=s.CHAR_DATA_CHAR_INDEX=s.CHAR_DATA_ATTR_INDEX=s.DEFAULT_EXT=s.DEFAULT_ATTR=s.DEFAULT_COLOR=void 0,s.DEFAULT_COLOR=0,s.DEFAULT_ATTR=256|s.DEFAULT_COLOR<<9,s.DEFAULT_EXT=0,s.CHAR_DATA_ATTR_INDEX=0,s.CHAR_DATA_CHAR_INDEX=1,s.CHAR_DATA_WIDTH_INDEX=2,s.CHAR_DATA_CODE_INDEX=3,s.NULL_CELL_CHAR="",s.NULL_CELL_WIDTH=1,s.NULL_CELL_CODE=0,s.WHITESPACE_CELL_CHAR=" ",s.WHITESPACE_CELL_WIDTH=1,s.WHITESPACE_CELL_CODE=32},4863:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.Marker=void 0;let l=r(8460),p=r(844);class d{get id(){return this._id}constructor(g){this.line=g,this.isDisposed=!1,this._disposables=[],this._id=d._nextId++,this._onDispose=this.register(new l.EventEmitter),this.onDispose=this._onDispose.event}dispose(){this.isDisposed||(this.isDisposed=!0,this.line=-1,this._onDispose.fire(),(0,p.disposeArray)(this._disposables),this._disposables.length=0)}register(g){return this._disposables.push(g),g}}s.Marker=d,d._nextId=1},7116:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.DEFAULT_CHARSET=s.CHARSETS=void 0,s.CHARSETS={},s.DEFAULT_CHARSET=s.CHARSETS.B,s.CHARSETS[0]={"`":"\u25C6",a:"\u2592",b:"\u2409",c:"\u240C",d:"\u240D",e:"\u240A",f:"\xB0",g:"\xB1",h:"\u2424",i:"\u240B",j:"\u2518",k:"\u2510",l:"\u250C",m:"\u2514",n:"\u253C",o:"\u23BA",p:"\u23BB",q:"\u2500",r:"\u23BC",s:"\u23BD",t:"\u251C",u:"\u2524",v:"\u2534",w:"\u252C",x:"\u2502",y:"\u2264",z:"\u2265","{":"\u03C0","|":"\u2260","}":"\xA3","~":"\xB7"},s.CHARSETS.A={"#":"\xA3"},s.CHARSETS.B=void 0,s.CHARSETS[4]={"#":"\xA3","@":"\xBE","[":"ij","\\":"\xBD","]":"|","{":"\xA8","|":"f","}":"\xBC","~":"\xB4"},s.CHARSETS.C=s.CHARSETS[5]={"[":"\xC4","\\":"\xD6","]":"\xC5","^":"\xDC","`":"\xE9","{":"\xE4","|":"\xF6","}":"\xE5","~":"\xFC"},s.CHARSETS.R={"#":"\xA3","@":"\xE0","[":"\xB0","\\":"\xE7","]":"\xA7","{":"\xE9","|":"\xF9","}":"\xE8","~":"\xA8"},s.CHARSETS.Q={"@":"\xE0","[":"\xE2","\\":"\xE7","]":"\xEA","^":"\xEE","`":"\xF4","{":"\xE9","|":"\xF9","}":"\xE8","~":"\xFB"},s.CHARSETS.K={"@":"\xA7","[":"\xC4","\\":"\xD6","]":"\xDC","{":"\xE4","|":"\xF6","}":"\xFC","~":"\xDF"},s.CHARSETS.Y={"#":"\xA3","@":"\xA7","[":"\xB0","\\":"\xE7","]":"\xE9","`":"\xF9","{":"\xE0","|":"\xF2","}":"\xE8","~":"\xEC"},s.CHARSETS.E=s.CHARSETS[6]={"@":"\xC4","[":"\xC6","\\":"\xD8","]":"\xC5","^":"\xDC","`":"\xE4","{":"\xE6","|":"\xF8","}":"\xE5","~":"\xFC"},s.CHARSETS.Z={"#":"\xA3","@":"\xA7","[":"\xA1","\\":"\xD1","]":"\xBF","{":"\xB0","|":"\xF1","}":"\xE7"},s.CHARSETS.H=s.CHARSETS[7]={"@":"\xC9","[":"\xC4","\\":"\xD6","]":"\xC5","^":"\xDC","`":"\xE9","{":"\xE4","|":"\xF6","}":"\xE5","~":"\xFC"},s.CHARSETS["="]={"#":"\xF9","@":"\xE0","[":"\xE9","\\":"\xE7","]":"\xEA","^":"\xEE",_:"\xE8","`":"\xF4","{":"\xE4","|":"\xF6","}":"\xFC","~":"\xFB"}},2584:(u,s)=>{var r,l,p;Object.defineProperty(s,"__esModule",{value:!0}),s.C1_ESCAPED=s.C1=s.C0=void 0,(function(d){d.NUL="\0",d.SOH="",d.STX="",d.ETX="",d.EOT="",d.ENQ="",d.ACK="",d.BEL="\x07",d.BS="\b",d.HT="	",d.LF=`
`,d.VT="\v",d.FF="\f",d.CR="\r",d.SO="",d.SI="",d.DLE="",d.DC1="",d.DC2="",d.DC3="",d.DC4="",d.NAK="",d.SYN="",d.ETB="",d.CAN="",d.EM="",d.SUB="",d.ESC="\x1B",d.FS="",d.GS="",d.RS="",d.US="",d.SP=" ",d.DEL="\x7F"})(r||(s.C0=r={})),(function(d){d.PAD="\x80",d.HOP="\x81",d.BPH="\x82",d.NBH="\x83",d.IND="\x84",d.NEL="\x85",d.SSA="\x86",d.ESA="\x87",d.HTS="\x88",d.HTJ="\x89",d.VTS="\x8A",d.PLD="\x8B",d.PLU="\x8C",d.RI="\x8D",d.SS2="\x8E",d.SS3="\x8F",d.DCS="\x90",d.PU1="\x91",d.PU2="\x92",d.STS="\x93",d.CCH="\x94",d.MW="\x95",d.SPA="\x96",d.EPA="\x97",d.SOS="\x98",d.SGCI="\x99",d.SCI="\x9A",d.CSI="\x9B",d.ST="\x9C",d.OSC="\x9D",d.PM="\x9E",d.APC="\x9F"})(l||(s.C1=l={})),(function(d){d.ST=`${r.ESC}\\`})(p||(s.C1_ESCAPED=p={}))},7399:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.evaluateKeyboardEvent=void 0;let l=r(2584),p={48:["0",")"],49:["1","!"],50:["2","@"],51:["3","#"],52:["4","$"],53:["5","%"],54:["6","^"],55:["7","&"],56:["8","*"],57:["9","("],186:[";",":"],187:["=","+"],188:[",","<"],189:["-","_"],190:[".",">"],191:["/","?"],192:["`","~"],219:["[","{"],220:["\\","|"],221:["]","}"],222:["'",'"']};s.evaluateKeyboardEvent=function(d,f,g,y){let b={type:0,cancel:!1,key:void 0},o=(d.shiftKey?1:0)|(d.altKey?2:0)|(d.ctrlKey?4:0)|(d.metaKey?8:0);switch(d.keyCode){case 0:d.key==="UIKeyInputUpArrow"?b.key=f?l.C0.ESC+"OA":l.C0.ESC+"[A":d.key==="UIKeyInputLeftArrow"?b.key=f?l.C0.ESC+"OD":l.C0.ESC+"[D":d.key==="UIKeyInputRightArrow"?b.key=f?l.C0.ESC+"OC":l.C0.ESC+"[C":d.key==="UIKeyInputDownArrow"&&(b.key=f?l.C0.ESC+"OB":l.C0.ESC+"[B");break;case 8:if(d.altKey){b.key=l.C0.ESC+l.C0.DEL;break}b.key=l.C0.DEL;break;case 9:if(d.shiftKey){b.key=l.C0.ESC+"[Z";break}b.key=l.C0.HT,b.cancel=!0;break;case 13:b.key=d.altKey?l.C0.ESC+l.C0.CR:l.C0.CR,b.cancel=!0;break;case 27:b.key=l.C0.ESC,d.altKey&&(b.key=l.C0.ESC+l.C0.ESC),b.cancel=!0;break;case 37:if(d.metaKey)break;o?(b.key=l.C0.ESC+"[1;"+(o+1)+"D",b.key===l.C0.ESC+"[1;3D"&&(b.key=l.C0.ESC+(g?"b":"[1;5D"))):b.key=f?l.C0.ESC+"OD":l.C0.ESC+"[D";break;case 39:if(d.metaKey)break;o?(b.key=l.C0.ESC+"[1;"+(o+1)+"C",b.key===l.C0.ESC+"[1;3C"&&(b.key=l.C0.ESC+(g?"f":"[1;5C"))):b.key=f?l.C0.ESC+"OC":l.C0.ESC+"[C";break;case 38:if(d.metaKey)break;o?(b.key=l.C0.ESC+"[1;"+(o+1)+"A",g||b.key!==l.C0.ESC+"[1;3A"||(b.key=l.C0.ESC+"[1;5A")):b.key=f?l.C0.ESC+"OA":l.C0.ESC+"[A";break;case 40:if(d.metaKey)break;o?(b.key=l.C0.ESC+"[1;"+(o+1)+"B",g||b.key!==l.C0.ESC+"[1;3B"||(b.key=l.C0.ESC+"[1;5B")):b.key=f?l.C0.ESC+"OB":l.C0.ESC+"[B";break;case 45:d.shiftKey||d.ctrlKey||(b.key=l.C0.ESC+"[2~");break;case 46:b.key=o?l.C0.ESC+"[3;"+(o+1)+"~":l.C0.ESC+"[3~";break;case 36:b.key=o?l.C0.ESC+"[1;"+(o+1)+"H":f?l.C0.ESC+"OH":l.C0.ESC+"[H";break;case 35:b.key=o?l.C0.ESC+"[1;"+(o+1)+"F":f?l.C0.ESC+"OF":l.C0.ESC+"[F";break;case 33:d.shiftKey?b.type=2:d.ctrlKey?b.key=l.C0.ESC+"[5;"+(o+1)+"~":b.key=l.C0.ESC+"[5~";break;case 34:d.shiftKey?b.type=3:d.ctrlKey?b.key=l.C0.ESC+"[6;"+(o+1)+"~":b.key=l.C0.ESC+"[6~";break;case 112:b.key=o?l.C0.ESC+"[1;"+(o+1)+"P":l.C0.ESC+"OP";break;case 113:b.key=o?l.C0.ESC+"[1;"+(o+1)+"Q":l.C0.ESC+"OQ";break;case 114:b.key=o?l.C0.ESC+"[1;"+(o+1)+"R":l.C0.ESC+"OR";break;case 115:b.key=o?l.C0.ESC+"[1;"+(o+1)+"S":l.C0.ESC+"OS";break;case 116:b.key=o?l.C0.ESC+"[15;"+(o+1)+"~":l.C0.ESC+"[15~";break;case 117:b.key=o?l.C0.ESC+"[17;"+(o+1)+"~":l.C0.ESC+"[17~";break;case 118:b.key=o?l.C0.ESC+"[18;"+(o+1)+"~":l.C0.ESC+"[18~";break;case 119:b.key=o?l.C0.ESC+"[19;"+(o+1)+"~":l.C0.ESC+"[19~";break;case 120:b.key=o?l.C0.ESC+"[20;"+(o+1)+"~":l.C0.ESC+"[20~";break;case 121:b.key=o?l.C0.ESC+"[21;"+(o+1)+"~":l.C0.ESC+"[21~";break;case 122:b.key=o?l.C0.ESC+"[23;"+(o+1)+"~":l.C0.ESC+"[23~";break;case 123:b.key=o?l.C0.ESC+"[24;"+(o+1)+"~":l.C0.ESC+"[24~";break;default:if(!d.ctrlKey||d.shiftKey||d.altKey||d.metaKey)if(g&&!y||!d.altKey||d.metaKey)!g||d.altKey||d.ctrlKey||d.shiftKey||!d.metaKey?d.key&&!d.ctrlKey&&!d.altKey&&!d.metaKey&&d.keyCode>=48&&d.key.length===1?b.key=d.key:d.key&&d.ctrlKey&&(d.key==="_"&&(b.key=l.C0.US),d.key==="@"&&(b.key=l.C0.NUL)):d.keyCode===65&&(b.type=1);else{let a=p[d.keyCode],c=a?.[d.shiftKey?1:0];if(c)b.key=l.C0.ESC+c;else if(d.keyCode>=65&&d.keyCode<=90){let h=d.ctrlKey?d.keyCode-64:d.keyCode+32,m=String.fromCharCode(h);d.shiftKey&&(m=m.toUpperCase()),b.key=l.C0.ESC+m}else if(d.keyCode===32)b.key=l.C0.ESC+(d.ctrlKey?l.C0.NUL:" ");else if(d.key==="Dead"&&d.code.startsWith("Key")){let h=d.code.slice(3,4);d.shiftKey||(h=h.toLowerCase()),b.key=l.C0.ESC+h,b.cancel=!0}}else d.keyCode>=65&&d.keyCode<=90?b.key=String.fromCharCode(d.keyCode-64):d.keyCode===32?b.key=l.C0.NUL:d.keyCode>=51&&d.keyCode<=55?b.key=String.fromCharCode(d.keyCode-51+27):d.keyCode===56?b.key=l.C0.DEL:d.keyCode===219?b.key=l.C0.ESC:d.keyCode===220?b.key=l.C0.FS:d.keyCode===221&&(b.key=l.C0.GS)}return b}},482:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.Utf8ToUtf32=s.StringToUtf32=s.utf32ToString=s.stringFromCodePoint=void 0,s.stringFromCodePoint=function(r){return r>65535?(r-=65536,String.fromCharCode(55296+(r>>10))+String.fromCharCode(r%1024+56320)):String.fromCharCode(r)},s.utf32ToString=function(r,l=0,p=r.length){let d="";for(let f=l;f<p;++f){let g=r[f];g>65535?(g-=65536,d+=String.fromCharCode(55296+(g>>10))+String.fromCharCode(g%1024+56320)):d+=String.fromCharCode(g)}return d},s.StringToUtf32=class{constructor(){this._interim=0}clear(){this._interim=0}decode(r,l){let p=r.length;if(!p)return 0;let d=0,f=0;if(this._interim){let g=r.charCodeAt(f++);56320<=g&&g<=57343?l[d++]=1024*(this._interim-55296)+g-56320+65536:(l[d++]=this._interim,l[d++]=g),this._interim=0}for(let g=f;g<p;++g){let y=r.charCodeAt(g);if(55296<=y&&y<=56319){if(++g>=p)return this._interim=y,d;let b=r.charCodeAt(g);56320<=b&&b<=57343?l[d++]=1024*(y-55296)+b-56320+65536:(l[d++]=y,l[d++]=b)}else y!==65279&&(l[d++]=y)}return d}},s.Utf8ToUtf32=class{constructor(){this.interim=new Uint8Array(3)}clear(){this.interim.fill(0)}decode(r,l){let p=r.length;if(!p)return 0;let d,f,g,y,b=0,o=0,a=0;if(this.interim[0]){let m=!1,v=this.interim[0];v&=(224&v)==192?31:(240&v)==224?15:7;let w,C=0;for(;(w=63&this.interim[++C])&&C<4;)v<<=6,v|=w;let _=(224&this.interim[0])==192?2:(240&this.interim[0])==224?3:4,S=_-C;for(;a<S;){if(a>=p)return 0;if(w=r[a++],(192&w)!=128){a--,m=!0;break}this.interim[C++]=w,v<<=6,v|=63&w}m||(_===2?v<128?a--:l[b++]=v:_===3?v<2048||v>=55296&&v<=57343||v===65279||(l[b++]=v):v<65536||v>1114111||(l[b++]=v)),this.interim.fill(0)}let c=p-4,h=a;for(;h<p;){for(;!(!(h<c)||128&(d=r[h])||128&(f=r[h+1])||128&(g=r[h+2])||128&(y=r[h+3]));)l[b++]=d,l[b++]=f,l[b++]=g,l[b++]=y,h+=4;if(d=r[h++],d<128)l[b++]=d;else if((224&d)==192){if(h>=p)return this.interim[0]=d,b;if(f=r[h++],(192&f)!=128){h--;continue}if(o=(31&d)<<6|63&f,o<128){h--;continue}l[b++]=o}else if((240&d)==224){if(h>=p)return this.interim[0]=d,b;if(f=r[h++],(192&f)!=128){h--;continue}if(h>=p)return this.interim[0]=d,this.interim[1]=f,b;if(g=r[h++],(192&g)!=128){h--;continue}if(o=(15&d)<<12|(63&f)<<6|63&g,o<2048||o>=55296&&o<=57343||o===65279)continue;l[b++]=o}else if((248&d)==240){if(h>=p)return this.interim[0]=d,b;if(f=r[h++],(192&f)!=128){h--;continue}if(h>=p)return this.interim[0]=d,this.interim[1]=f,b;if(g=r[h++],(192&g)!=128){h--;continue}if(h>=p)return this.interim[0]=d,this.interim[1]=f,this.interim[2]=g,b;if(y=r[h++],(192&y)!=128){h--;continue}if(o=(7&d)<<18|(63&f)<<12|(63&g)<<6|63&y,o<65536||o>1114111)continue;l[b++]=o}}return b}}},225:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.UnicodeV6=void 0;let r=[[768,879],[1155,1158],[1160,1161],[1425,1469],[1471,1471],[1473,1474],[1476,1477],[1479,1479],[1536,1539],[1552,1557],[1611,1630],[1648,1648],[1750,1764],[1767,1768],[1770,1773],[1807,1807],[1809,1809],[1840,1866],[1958,1968],[2027,2035],[2305,2306],[2364,2364],[2369,2376],[2381,2381],[2385,2388],[2402,2403],[2433,2433],[2492,2492],[2497,2500],[2509,2509],[2530,2531],[2561,2562],[2620,2620],[2625,2626],[2631,2632],[2635,2637],[2672,2673],[2689,2690],[2748,2748],[2753,2757],[2759,2760],[2765,2765],[2786,2787],[2817,2817],[2876,2876],[2879,2879],[2881,2883],[2893,2893],[2902,2902],[2946,2946],[3008,3008],[3021,3021],[3134,3136],[3142,3144],[3146,3149],[3157,3158],[3260,3260],[3263,3263],[3270,3270],[3276,3277],[3298,3299],[3393,3395],[3405,3405],[3530,3530],[3538,3540],[3542,3542],[3633,3633],[3636,3642],[3655,3662],[3761,3761],[3764,3769],[3771,3772],[3784,3789],[3864,3865],[3893,3893],[3895,3895],[3897,3897],[3953,3966],[3968,3972],[3974,3975],[3984,3991],[3993,4028],[4038,4038],[4141,4144],[4146,4146],[4150,4151],[4153,4153],[4184,4185],[4448,4607],[4959,4959],[5906,5908],[5938,5940],[5970,5971],[6002,6003],[6068,6069],[6071,6077],[6086,6086],[6089,6099],[6109,6109],[6155,6157],[6313,6313],[6432,6434],[6439,6440],[6450,6450],[6457,6459],[6679,6680],[6912,6915],[6964,6964],[6966,6970],[6972,6972],[6978,6978],[7019,7027],[7616,7626],[7678,7679],[8203,8207],[8234,8238],[8288,8291],[8298,8303],[8400,8431],[12330,12335],[12441,12442],[43014,43014],[43019,43019],[43045,43046],[64286,64286],[65024,65039],[65056,65059],[65279,65279],[65529,65531]],l=[[68097,68099],[68101,68102],[68108,68111],[68152,68154],[68159,68159],[119143,119145],[119155,119170],[119173,119179],[119210,119213],[119362,119364],[917505,917505],[917536,917631],[917760,917999]],p;s.UnicodeV6=class{constructor(){if(this.version="6",!p){p=new Uint8Array(65536),p.fill(1),p[0]=0,p.fill(0,1,32),p.fill(0,127,160),p.fill(2,4352,4448),p[9001]=2,p[9002]=2,p.fill(2,11904,42192),p[12351]=1,p.fill(2,44032,55204),p.fill(2,63744,64256),p.fill(2,65040,65050),p.fill(2,65072,65136),p.fill(2,65280,65377),p.fill(2,65504,65511);for(let d=0;d<r.length;++d)p.fill(0,r[d][0],r[d][1]+1)}}wcwidth(d){return d<32?0:d<127?1:d<65536?p[d]:(function(f,g){let y,b=0,o=g.length-1;if(f<g[0][0]||f>g[o][1])return!1;for(;o>=b;)if(y=b+o>>1,f>g[y][1])b=y+1;else{if(!(f<g[y][0]))return!0;o=y-1}return!1})(d,l)?0:d>=131072&&d<=196605||d>=196608&&d<=262141?2:1}}},5981:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.WriteBuffer=void 0;let l=r(8460),p=r(844);class d extends p.Disposable{constructor(g){super(),this._action=g,this._writeBuffer=[],this._callbacks=[],this._pendingData=0,this._bufferOffset=0,this._isSyncWriting=!1,this._syncCalls=0,this._didUserInput=!1,this._onWriteParsed=this.register(new l.EventEmitter),this.onWriteParsed=this._onWriteParsed.event}handleUserInput(){this._didUserInput=!0}writeSync(g,y){if(y!==void 0&&this._syncCalls>y)return void(this._syncCalls=0);if(this._pendingData+=g.length,this._writeBuffer.push(g),this._callbacks.push(void 0),this._syncCalls++,this._isSyncWriting)return;let b;for(this._isSyncWriting=!0;b=this._writeBuffer.shift();){this._action(b);let o=this._callbacks.shift();o&&o()}this._pendingData=0,this._bufferOffset=2147483647,this._isSyncWriting=!1,this._syncCalls=0}write(g,y){if(this._pendingData>5e7)throw new Error("write data discarded, use flow control to avoid losing data");if(!this._writeBuffer.length){if(this._bufferOffset=0,this._didUserInput)return this._didUserInput=!1,this._pendingData+=g.length,this._writeBuffer.push(g),this._callbacks.push(y),void this._innerWrite();setTimeout((()=>this._innerWrite()))}this._pendingData+=g.length,this._writeBuffer.push(g),this._callbacks.push(y)}_innerWrite(g=0,y=!0){let b=g||Date.now();for(;this._writeBuffer.length>this._bufferOffset;){let o=this._writeBuffer[this._bufferOffset],a=this._action(o,y);if(a){let h=m=>Date.now()-b>=12?setTimeout((()=>this._innerWrite(0,m))):this._innerWrite(b,m);return void a.catch((m=>(queueMicrotask((()=>{throw m})),Promise.resolve(!1)))).then(h)}let c=this._callbacks[this._bufferOffset];if(c&&c(),this._bufferOffset++,this._pendingData-=o.length,Date.now()-b>=12)break}this._writeBuffer.length>this._bufferOffset?(this._bufferOffset>50&&(this._writeBuffer=this._writeBuffer.slice(this._bufferOffset),this._callbacks=this._callbacks.slice(this._bufferOffset),this._bufferOffset=0),setTimeout((()=>this._innerWrite()))):(this._writeBuffer.length=0,this._callbacks.length=0,this._pendingData=0,this._bufferOffset=0),this._onWriteParsed.fire()}}s.WriteBuffer=d},5941:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.toRgbString=s.parseColor=void 0;let r=/^([\da-f])\/([\da-f])\/([\da-f])$|^([\da-f]{2})\/([\da-f]{2})\/([\da-f]{2})$|^([\da-f]{3})\/([\da-f]{3})\/([\da-f]{3})$|^([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})$/,l=/^[\da-f]+$/;function p(d,f){let g=d.toString(16),y=g.length<2?"0"+g:g;switch(f){case 4:return g[0];case 8:return y;case 12:return(y+y).slice(0,3);default:return y+y}}s.parseColor=function(d){if(!d)return;let f=d.toLowerCase();if(f.indexOf("rgb:")===0){f=f.slice(4);let g=r.exec(f);if(g){let y=g[1]?15:g[4]?255:g[7]?4095:65535;return[Math.round(parseInt(g[1]||g[4]||g[7]||g[10],16)/y*255),Math.round(parseInt(g[2]||g[5]||g[8]||g[11],16)/y*255),Math.round(parseInt(g[3]||g[6]||g[9]||g[12],16)/y*255)]}}else if(f.indexOf("#")===0&&(f=f.slice(1),l.exec(f)&&[3,6,9,12].includes(f.length))){let g=f.length/3,y=[0,0,0];for(let b=0;b<3;++b){let o=parseInt(f.slice(g*b,g*b+g),16);y[b]=g===1?o<<4:g===2?o:g===3?o>>4:o>>8}return y}},s.toRgbString=function(d,f=16){let[g,y,b]=d;return`rgb:${p(g,f)}/${p(y,f)}/${p(b,f)}`}},5770:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.PAYLOAD_LIMIT=void 0,s.PAYLOAD_LIMIT=1e7},6351:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.DcsHandler=s.DcsParser=void 0;let l=r(482),p=r(8742),d=r(5770),f=[];s.DcsParser=class{constructor(){this._handlers=Object.create(null),this._active=f,this._ident=0,this._handlerFb=()=>{},this._stack={paused:!1,loopPosition:0,fallThrough:!1}}dispose(){this._handlers=Object.create(null),this._handlerFb=()=>{},this._active=f}registerHandler(y,b){this._handlers[y]===void 0&&(this._handlers[y]=[]);let o=this._handlers[y];return o.push(b),{dispose:()=>{let a=o.indexOf(b);a!==-1&&o.splice(a,1)}}}clearHandler(y){this._handlers[y]&&delete this._handlers[y]}setHandlerFallback(y){this._handlerFb=y}reset(){if(this._active.length)for(let y=this._stack.paused?this._stack.loopPosition-1:this._active.length-1;y>=0;--y)this._active[y].unhook(!1);this._stack.paused=!1,this._active=f,this._ident=0}hook(y,b){if(this.reset(),this._ident=y,this._active=this._handlers[y]||f,this._active.length)for(let o=this._active.length-1;o>=0;o--)this._active[o].hook(b);else this._handlerFb(this._ident,"HOOK",b)}put(y,b,o){if(this._active.length)for(let a=this._active.length-1;a>=0;a--)this._active[a].put(y,b,o);else this._handlerFb(this._ident,"PUT",(0,l.utf32ToString)(y,b,o))}unhook(y,b=!0){if(this._active.length){let o=!1,a=this._active.length-1,c=!1;if(this._stack.paused&&(a=this._stack.loopPosition-1,o=b,c=this._stack.fallThrough,this._stack.paused=!1),!c&&o===!1){for(;a>=0&&(o=this._active[a].unhook(y),o!==!0);a--)if(o instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=a,this._stack.fallThrough=!1,o;a--}for(;a>=0;a--)if(o=this._active[a].unhook(!1),o instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=a,this._stack.fallThrough=!0,o}else this._handlerFb(this._ident,"UNHOOK",y);this._active=f,this._ident=0}};let g=new p.Params;g.addParam(0),s.DcsHandler=class{constructor(y){this._handler=y,this._data="",this._params=g,this._hitLimit=!1}hook(y){this._params=y.length>1||y.params[0]?y.clone():g,this._data="",this._hitLimit=!1}put(y,b,o){this._hitLimit||(this._data+=(0,l.utf32ToString)(y,b,o),this._data.length>d.PAYLOAD_LIMIT&&(this._data="",this._hitLimit=!0))}unhook(y){let b=!1;if(this._hitLimit)b=!1;else if(y&&(b=this._handler(this._data,this._params),b instanceof Promise))return b.then((o=>(this._params=g,this._data="",this._hitLimit=!1,o)));return this._params=g,this._data="",this._hitLimit=!1,b}}},2015:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.EscapeSequenceParser=s.VT500_TRANSITION_TABLE=s.TransitionTable=void 0;let l=r(844),p=r(8742),d=r(6242),f=r(6351);class g{constructor(a){this.table=new Uint8Array(a)}setDefault(a,c){this.table.fill(a<<4|c)}add(a,c,h,m){this.table[c<<8|a]=h<<4|m}addMany(a,c,h,m){for(let v=0;v<a.length;v++)this.table[c<<8|a[v]]=h<<4|m}}s.TransitionTable=g;let y=160;s.VT500_TRANSITION_TABLE=(function(){let o=new g(4095),a=Array.apply(null,Array(256)).map(((C,_)=>_)),c=(C,_)=>a.slice(C,_),h=c(32,127),m=c(0,24);m.push(25),m.push.apply(m,c(28,32));let v=c(0,14),w;for(w in o.setDefault(1,0),o.addMany(h,0,2,0),v)o.addMany([24,26,153,154],w,3,0),o.addMany(c(128,144),w,3,0),o.addMany(c(144,152),w,3,0),o.add(156,w,0,0),o.add(27,w,11,1),o.add(157,w,4,8),o.addMany([152,158,159],w,0,7),o.add(155,w,11,3),o.add(144,w,11,9);return o.addMany(m,0,3,0),o.addMany(m,1,3,1),o.add(127,1,0,1),o.addMany(m,8,0,8),o.addMany(m,3,3,3),o.add(127,3,0,3),o.addMany(m,4,3,4),o.add(127,4,0,4),o.addMany(m,6,3,6),o.addMany(m,5,3,5),o.add(127,5,0,5),o.addMany(m,2,3,2),o.add(127,2,0,2),o.add(93,1,4,8),o.addMany(h,8,5,8),o.add(127,8,5,8),o.addMany([156,27,24,26,7],8,6,0),o.addMany(c(28,32),8,0,8),o.addMany([88,94,95],1,0,7),o.addMany(h,7,0,7),o.addMany(m,7,0,7),o.add(156,7,0,0),o.add(127,7,0,7),o.add(91,1,11,3),o.addMany(c(64,127),3,7,0),o.addMany(c(48,60),3,8,4),o.addMany([60,61,62,63],3,9,4),o.addMany(c(48,60),4,8,4),o.addMany(c(64,127),4,7,0),o.addMany([60,61,62,63],4,0,6),o.addMany(c(32,64),6,0,6),o.add(127,6,0,6),o.addMany(c(64,127),6,0,0),o.addMany(c(32,48),3,9,5),o.addMany(c(32,48),5,9,5),o.addMany(c(48,64),5,0,6),o.addMany(c(64,127),5,7,0),o.addMany(c(32,48),4,9,5),o.addMany(c(32,48),1,9,2),o.addMany(c(32,48),2,9,2),o.addMany(c(48,127),2,10,0),o.addMany(c(48,80),1,10,0),o.addMany(c(81,88),1,10,0),o.addMany([89,90,92],1,10,0),o.addMany(c(96,127),1,10,0),o.add(80,1,11,9),o.addMany(m,9,0,9),o.add(127,9,0,9),o.addMany(c(28,32),9,0,9),o.addMany(c(32,48),9,9,12),o.addMany(c(48,60),9,8,10),o.addMany([60,61,62,63],9,9,10),o.addMany(m,11,0,11),o.addMany(c(32,128),11,0,11),o.addMany(c(28,32),11,0,11),o.addMany(m,10,0,10),o.add(127,10,0,10),o.addMany(c(28,32),10,0,10),o.addMany(c(48,60),10,8,10),o.addMany([60,61,62,63],10,0,11),o.addMany(c(32,48),10,9,12),o.addMany(m,12,0,12),o.add(127,12,0,12),o.addMany(c(28,32),12,0,12),o.addMany(c(32,48),12,9,12),o.addMany(c(48,64),12,0,11),o.addMany(c(64,127),12,12,13),o.addMany(c(64,127),10,12,13),o.addMany(c(64,127),9,12,13),o.addMany(m,13,13,13),o.addMany(h,13,13,13),o.add(127,13,0,13),o.addMany([27,156,24,26],13,14,0),o.add(y,0,2,0),o.add(y,8,5,8),o.add(y,6,0,6),o.add(y,11,0,11),o.add(y,13,13,13),o})();class b extends l.Disposable{constructor(a=s.VT500_TRANSITION_TABLE){super(),this._transitions=a,this._parseStack={state:0,handlers:[],handlerPos:0,transition:0,chunkPos:0},this.initialState=0,this.currentState=this.initialState,this._params=new p.Params,this._params.addParam(0),this._collect=0,this.precedingCodepoint=0,this._printHandlerFb=(c,h,m)=>{},this._executeHandlerFb=c=>{},this._csiHandlerFb=(c,h)=>{},this._escHandlerFb=c=>{},this._errorHandlerFb=c=>c,this._printHandler=this._printHandlerFb,this._executeHandlers=Object.create(null),this._csiHandlers=Object.create(null),this._escHandlers=Object.create(null),this.register((0,l.toDisposable)((()=>{this._csiHandlers=Object.create(null),this._executeHandlers=Object.create(null),this._escHandlers=Object.create(null)}))),this._oscParser=this.register(new d.OscParser),this._dcsParser=this.register(new f.DcsParser),this._errorHandler=this._errorHandlerFb,this.registerEscHandler({final:"\\"},(()=>!0))}_identifier(a,c=[64,126]){let h=0;if(a.prefix){if(a.prefix.length>1)throw new Error("only one byte as prefix supported");if(h=a.prefix.charCodeAt(0),h&&60>h||h>63)throw new Error("prefix must be in range 0x3c .. 0x3f")}if(a.intermediates){if(a.intermediates.length>2)throw new Error("only two bytes as intermediates are supported");for(let v=0;v<a.intermediates.length;++v){let w=a.intermediates.charCodeAt(v);if(32>w||w>47)throw new Error("intermediate must be in range 0x20 .. 0x2f");h<<=8,h|=w}}if(a.final.length!==1)throw new Error("final must be a single byte");let m=a.final.charCodeAt(0);if(c[0]>m||m>c[1])throw new Error(`final must be in range ${c[0]} .. ${c[1]}`);return h<<=8,h|=m,h}identToString(a){let c=[];for(;a;)c.push(String.fromCharCode(255&a)),a>>=8;return c.reverse().join("")}setPrintHandler(a){this._printHandler=a}clearPrintHandler(){this._printHandler=this._printHandlerFb}registerEscHandler(a,c){let h=this._identifier(a,[48,126]);this._escHandlers[h]===void 0&&(this._escHandlers[h]=[]);let m=this._escHandlers[h];return m.push(c),{dispose:()=>{let v=m.indexOf(c);v!==-1&&m.splice(v,1)}}}clearEscHandler(a){this._escHandlers[this._identifier(a,[48,126])]&&delete this._escHandlers[this._identifier(a,[48,126])]}setEscHandlerFallback(a){this._escHandlerFb=a}setExecuteHandler(a,c){this._executeHandlers[a.charCodeAt(0)]=c}clearExecuteHandler(a){this._executeHandlers[a.charCodeAt(0)]&&delete this._executeHandlers[a.charCodeAt(0)]}setExecuteHandlerFallback(a){this._executeHandlerFb=a}registerCsiHandler(a,c){let h=this._identifier(a);this._csiHandlers[h]===void 0&&(this._csiHandlers[h]=[]);let m=this._csiHandlers[h];return m.push(c),{dispose:()=>{let v=m.indexOf(c);v!==-1&&m.splice(v,1)}}}clearCsiHandler(a){this._csiHandlers[this._identifier(a)]&&delete this._csiHandlers[this._identifier(a)]}setCsiHandlerFallback(a){this._csiHandlerFb=a}registerDcsHandler(a,c){return this._dcsParser.registerHandler(this._identifier(a),c)}clearDcsHandler(a){this._dcsParser.clearHandler(this._identifier(a))}setDcsHandlerFallback(a){this._dcsParser.setHandlerFallback(a)}registerOscHandler(a,c){return this._oscParser.registerHandler(a,c)}clearOscHandler(a){this._oscParser.clearHandler(a)}setOscHandlerFallback(a){this._oscParser.setHandlerFallback(a)}setErrorHandler(a){this._errorHandler=a}clearErrorHandler(){this._errorHandler=this._errorHandlerFb}reset(){this.currentState=this.initialState,this._oscParser.reset(),this._dcsParser.reset(),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0,this._parseStack.state!==0&&(this._parseStack.state=2,this._parseStack.handlers=[])}_preserveStack(a,c,h,m,v){this._parseStack.state=a,this._parseStack.handlers=c,this._parseStack.handlerPos=h,this._parseStack.transition=m,this._parseStack.chunkPos=v}parse(a,c,h){let m,v=0,w=0,C=0;if(this._parseStack.state)if(this._parseStack.state===2)this._parseStack.state=0,C=this._parseStack.chunkPos+1;else{if(h===void 0||this._parseStack.state===1)throw this._parseStack.state=1,new Error("improper continuation due to previous async handler, giving up parsing");let _=this._parseStack.handlers,S=this._parseStack.handlerPos-1;switch(this._parseStack.state){case 3:if(h===!1&&S>-1){for(;S>=0&&(m=_[S](this._params),m!==!0);S--)if(m instanceof Promise)return this._parseStack.handlerPos=S,m}this._parseStack.handlers=[];break;case 4:if(h===!1&&S>-1){for(;S>=0&&(m=_[S](),m!==!0);S--)if(m instanceof Promise)return this._parseStack.handlerPos=S,m}this._parseStack.handlers=[];break;case 6:if(v=a[this._parseStack.chunkPos],m=this._dcsParser.unhook(v!==24&&v!==26,h),m)return m;v===27&&(this._parseStack.transition|=1),this._params.reset(),this._params.addParam(0),this._collect=0;break;case 5:if(v=a[this._parseStack.chunkPos],m=this._oscParser.end(v!==24&&v!==26,h),m)return m;v===27&&(this._parseStack.transition|=1),this._params.reset(),this._params.addParam(0),this._collect=0}this._parseStack.state=0,C=this._parseStack.chunkPos+1,this.precedingCodepoint=0,this.currentState=15&this._parseStack.transition}for(let _=C;_<c;++_){switch(v=a[_],w=this._transitions.table[this.currentState<<8|(v<160?v:y)],w>>4){case 2:for(let O=_+1;;++O){if(O>=c||(v=a[O])<32||v>126&&v<y){this._printHandler(a,_,O),_=O-1;break}if(++O>=c||(v=a[O])<32||v>126&&v<y){this._printHandler(a,_,O),_=O-1;break}if(++O>=c||(v=a[O])<32||v>126&&v<y){this._printHandler(a,_,O),_=O-1;break}if(++O>=c||(v=a[O])<32||v>126&&v<y){this._printHandler(a,_,O),_=O-1;break}}break;case 3:this._executeHandlers[v]?this._executeHandlers[v]():this._executeHandlerFb(v),this.precedingCodepoint=0;break;case 0:break;case 1:if(this._errorHandler({position:_,code:v,currentState:this.currentState,collect:this._collect,params:this._params,abort:!1}).abort)return;break;case 7:let S=this._csiHandlers[this._collect<<8|v],T=S?S.length-1:-1;for(;T>=0&&(m=S[T](this._params),m!==!0);T--)if(m instanceof Promise)return this._preserveStack(3,S,T,w,_),m;T<0&&this._csiHandlerFb(this._collect<<8|v,this._params),this.precedingCodepoint=0;break;case 8:do switch(v){case 59:this._params.addParam(0);break;case 58:this._params.addSubParam(-1);break;default:this._params.addDigit(v-48)}while(++_<c&&(v=a[_])>47&&v<60);_--;break;case 9:this._collect<<=8,this._collect|=v;break;case 10:let $=this._escHandlers[this._collect<<8|v],D=$?$.length-1:-1;for(;D>=0&&(m=$[D](),m!==!0);D--)if(m instanceof Promise)return this._preserveStack(4,$,D,w,_),m;D<0&&this._escHandlerFb(this._collect<<8|v),this.precedingCodepoint=0;break;case 11:this._params.reset(),this._params.addParam(0),this._collect=0;break;case 12:this._dcsParser.hook(this._collect<<8|v,this._params);break;case 13:for(let O=_+1;;++O)if(O>=c||(v=a[O])===24||v===26||v===27||v>127&&v<y){this._dcsParser.put(a,_,O),_=O-1;break}break;case 14:if(m=this._dcsParser.unhook(v!==24&&v!==26),m)return this._preserveStack(6,[],0,w,_),m;v===27&&(w|=1),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0;break;case 4:this._oscParser.start();break;case 5:for(let O=_+1;;O++)if(O>=c||(v=a[O])<32||v>127&&v<y){this._oscParser.put(a,_,O),_=O-1;break}break;case 6:if(m=this._oscParser.end(v!==24&&v!==26),m)return this._preserveStack(5,[],0,w,_),m;v===27&&(w|=1),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0}this.currentState=15&w}}}s.EscapeSequenceParser=b},6242:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.OscHandler=s.OscParser=void 0;let l=r(5770),p=r(482),d=[];s.OscParser=class{constructor(){this._state=0,this._active=d,this._id=-1,this._handlers=Object.create(null),this._handlerFb=()=>{},this._stack={paused:!1,loopPosition:0,fallThrough:!1}}registerHandler(f,g){this._handlers[f]===void 0&&(this._handlers[f]=[]);let y=this._handlers[f];return y.push(g),{dispose:()=>{let b=y.indexOf(g);b!==-1&&y.splice(b,1)}}}clearHandler(f){this._handlers[f]&&delete this._handlers[f]}setHandlerFallback(f){this._handlerFb=f}dispose(){this._handlers=Object.create(null),this._handlerFb=()=>{},this._active=d}reset(){if(this._state===2)for(let f=this._stack.paused?this._stack.loopPosition-1:this._active.length-1;f>=0;--f)this._active[f].end(!1);this._stack.paused=!1,this._active=d,this._id=-1,this._state=0}_start(){if(this._active=this._handlers[this._id]||d,this._active.length)for(let f=this._active.length-1;f>=0;f--)this._active[f].start();else this._handlerFb(this._id,"START")}_put(f,g,y){if(this._active.length)for(let b=this._active.length-1;b>=0;b--)this._active[b].put(f,g,y);else this._handlerFb(this._id,"PUT",(0,p.utf32ToString)(f,g,y))}start(){this.reset(),this._state=1}put(f,g,y){if(this._state!==3){if(this._state===1)for(;g<y;){let b=f[g++];if(b===59){this._state=2,this._start();break}if(b<48||57<b)return void(this._state=3);this._id===-1&&(this._id=0),this._id=10*this._id+b-48}this._state===2&&y-g>0&&this._put(f,g,y)}}end(f,g=!0){if(this._state!==0){if(this._state!==3)if(this._state===1&&this._start(),this._active.length){let y=!1,b=this._active.length-1,o=!1;if(this._stack.paused&&(b=this._stack.loopPosition-1,y=g,o=this._stack.fallThrough,this._stack.paused=!1),!o&&y===!1){for(;b>=0&&(y=this._active[b].end(f),y!==!0);b--)if(y instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=b,this._stack.fallThrough=!1,y;b--}for(;b>=0;b--)if(y=this._active[b].end(!1),y instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=b,this._stack.fallThrough=!0,y}else this._handlerFb(this._id,"END",f);this._active=d,this._id=-1,this._state=0}}},s.OscHandler=class{constructor(f){this._handler=f,this._data="",this._hitLimit=!1}start(){this._data="",this._hitLimit=!1}put(f,g,y){this._hitLimit||(this._data+=(0,p.utf32ToString)(f,g,y),this._data.length>l.PAYLOAD_LIMIT&&(this._data="",this._hitLimit=!0))}end(f){let g=!1;if(this._hitLimit)g=!1;else if(f&&(g=this._handler(this._data),g instanceof Promise))return g.then((y=>(this._data="",this._hitLimit=!1,y)));return this._data="",this._hitLimit=!1,g}}},8742:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.Params=void 0;let r=2147483647;class l{static fromArray(d){let f=new l;if(!d.length)return f;for(let g=Array.isArray(d[0])?1:0;g<d.length;++g){let y=d[g];if(Array.isArray(y))for(let b=0;b<y.length;++b)f.addSubParam(y[b]);else f.addParam(y)}return f}constructor(d=32,f=32){if(this.maxLength=d,this.maxSubParamsLength=f,f>256)throw new Error("maxSubParamsLength must not be greater than 256");this.params=new Int32Array(d),this.length=0,this._subParams=new Int32Array(f),this._subParamsLength=0,this._subParamsIdx=new Uint16Array(d),this._rejectDigits=!1,this._rejectSubDigits=!1,this._digitIsSub=!1}clone(){let d=new l(this.maxLength,this.maxSubParamsLength);return d.params.set(this.params),d.length=this.length,d._subParams.set(this._subParams),d._subParamsLength=this._subParamsLength,d._subParamsIdx.set(this._subParamsIdx),d._rejectDigits=this._rejectDigits,d._rejectSubDigits=this._rejectSubDigits,d._digitIsSub=this._digitIsSub,d}toArray(){let d=[];for(let f=0;f<this.length;++f){d.push(this.params[f]);let g=this._subParamsIdx[f]>>8,y=255&this._subParamsIdx[f];y-g>0&&d.push(Array.prototype.slice.call(this._subParams,g,y))}return d}reset(){this.length=0,this._subParamsLength=0,this._rejectDigits=!1,this._rejectSubDigits=!1,this._digitIsSub=!1}addParam(d){if(this._digitIsSub=!1,this.length>=this.maxLength)this._rejectDigits=!0;else{if(d<-1)throw new Error("values lesser than -1 are not allowed");this._subParamsIdx[this.length]=this._subParamsLength<<8|this._subParamsLength,this.params[this.length++]=d>r?r:d}}addSubParam(d){if(this._digitIsSub=!0,this.length)if(this._rejectDigits||this._subParamsLength>=this.maxSubParamsLength)this._rejectSubDigits=!0;else{if(d<-1)throw new Error("values lesser than -1 are not allowed");this._subParams[this._subParamsLength++]=d>r?r:d,this._subParamsIdx[this.length-1]++}}hasSubParams(d){return(255&this._subParamsIdx[d])-(this._subParamsIdx[d]>>8)>0}getSubParams(d){let f=this._subParamsIdx[d]>>8,g=255&this._subParamsIdx[d];return g-f>0?this._subParams.subarray(f,g):null}getSubParamsAll(){let d={};for(let f=0;f<this.length;++f){let g=this._subParamsIdx[f]>>8,y=255&this._subParamsIdx[f];y-g>0&&(d[f]=this._subParams.slice(g,y))}return d}addDigit(d){let f;if(this._rejectDigits||!(f=this._digitIsSub?this._subParamsLength:this.length)||this._digitIsSub&&this._rejectSubDigits)return;let g=this._digitIsSub?this._subParams:this.params,y=g[f-1];g[f-1]=~y?Math.min(10*y+d,r):d}}s.Params=l},5741:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.AddonManager=void 0,s.AddonManager=class{constructor(){this._addons=[]}dispose(){for(let r=this._addons.length-1;r>=0;r--)this._addons[r].instance.dispose()}loadAddon(r,l){let p={instance:l,dispose:l.dispose,isDisposed:!1};this._addons.push(p),l.dispose=()=>this._wrappedAddonDispose(p),l.activate(r)}_wrappedAddonDispose(r){if(r.isDisposed)return;let l=-1;for(let p=0;p<this._addons.length;p++)if(this._addons[p]===r){l=p;break}if(l===-1)throw new Error("Could not dispose an addon that has not been loaded");r.isDisposed=!0,r.dispose.apply(r.instance),this._addons.splice(l,1)}}},8771:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.BufferApiView=void 0;let l=r(3785),p=r(511);s.BufferApiView=class{constructor(d,f){this._buffer=d,this.type=f}init(d){return this._buffer=d,this}get cursorY(){return this._buffer.y}get cursorX(){return this._buffer.x}get viewportY(){return this._buffer.ydisp}get baseY(){return this._buffer.ybase}get length(){return this._buffer.lines.length}getLine(d){let f=this._buffer.lines.get(d);if(f)return new l.BufferLineApiView(f)}getNullCell(){return new p.CellData}}},3785:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.BufferLineApiView=void 0;let l=r(511);s.BufferLineApiView=class{constructor(p){this._line=p}get isWrapped(){return this._line.isWrapped}get length(){return this._line.length}getCell(p,d){if(!(p<0||p>=this._line.length))return d?(this._line.loadCell(p,d),d):this._line.loadCell(p,new l.CellData)}translateToString(p,d,f){return this._line.translateToString(p,d,f)}}},8285:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.BufferNamespaceApi=void 0;let l=r(8771),p=r(8460),d=r(844);class f extends d.Disposable{constructor(y){super(),this._core=y,this._onBufferChange=this.register(new p.EventEmitter),this.onBufferChange=this._onBufferChange.event,this._normal=new l.BufferApiView(this._core.buffers.normal,"normal"),this._alternate=new l.BufferApiView(this._core.buffers.alt,"alternate"),this._core.buffers.onBufferActivate((()=>this._onBufferChange.fire(this.active)))}get active(){if(this._core.buffers.active===this._core.buffers.normal)return this.normal;if(this._core.buffers.active===this._core.buffers.alt)return this.alternate;throw new Error("Active buffer is neither normal nor alternate")}get normal(){return this._normal.init(this._core.buffers.normal)}get alternate(){return this._alternate.init(this._core.buffers.alt)}}s.BufferNamespaceApi=f},7975:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.ParserApi=void 0,s.ParserApi=class{constructor(r){this._core=r}registerCsiHandler(r,l){return this._core.registerCsiHandler(r,(p=>l(p.toArray())))}addCsiHandler(r,l){return this.registerCsiHandler(r,l)}registerDcsHandler(r,l){return this._core.registerDcsHandler(r,((p,d)=>l(p,d.toArray())))}addDcsHandler(r,l){return this.registerDcsHandler(r,l)}registerEscHandler(r,l){return this._core.registerEscHandler(r,l)}addEscHandler(r,l){return this.registerEscHandler(r,l)}registerOscHandler(r,l){return this._core.registerOscHandler(r,l)}addOscHandler(r,l){return this.registerOscHandler(r,l)}}},7090:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.UnicodeApi=void 0,s.UnicodeApi=class{constructor(r){this._core=r}register(r){this._core.unicodeService.register(r)}get versions(){return this._core.unicodeService.versions}get activeVersion(){return this._core.unicodeService.activeVersion}set activeVersion(r){this._core.unicodeService.activeVersion=r}}},744:function(u,s,r){var l=this&&this.__decorate||function(o,a,c,h){var m,v=arguments.length,w=v<3?a:h===null?h=Object.getOwnPropertyDescriptor(a,c):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")w=Reflect.decorate(o,a,c,h);else for(var C=o.length-1;C>=0;C--)(m=o[C])&&(w=(v<3?m(w):v>3?m(a,c,w):m(a,c))||w);return v>3&&w&&Object.defineProperty(a,c,w),w},p=this&&this.__param||function(o,a){return function(c,h){a(c,h,o)}};Object.defineProperty(s,"__esModule",{value:!0}),s.BufferService=s.MINIMUM_ROWS=s.MINIMUM_COLS=void 0;let d=r(8460),f=r(844),g=r(5295),y=r(2585);s.MINIMUM_COLS=2,s.MINIMUM_ROWS=1;let b=s.BufferService=class extends f.Disposable{get buffer(){return this.buffers.active}constructor(o){super(),this.isUserScrolling=!1,this._onResize=this.register(new d.EventEmitter),this.onResize=this._onResize.event,this._onScroll=this.register(new d.EventEmitter),this.onScroll=this._onScroll.event,this.cols=Math.max(o.rawOptions.cols||0,s.MINIMUM_COLS),this.rows=Math.max(o.rawOptions.rows||0,s.MINIMUM_ROWS),this.buffers=this.register(new g.BufferSet(o,this))}resize(o,a){this.cols=o,this.rows=a,this.buffers.resize(o,a),this._onResize.fire({cols:o,rows:a})}reset(){this.buffers.reset(),this.isUserScrolling=!1}scroll(o,a=!1){let c=this.buffer,h;h=this._cachedBlankLine,h&&h.length===this.cols&&h.getFg(0)===o.fg&&h.getBg(0)===o.bg||(h=c.getBlankLine(o,a),this._cachedBlankLine=h),h.isWrapped=a;let m=c.ybase+c.scrollTop,v=c.ybase+c.scrollBottom;if(c.scrollTop===0){let w=c.lines.isFull;v===c.lines.length-1?w?c.lines.recycle().copyFrom(h):c.lines.push(h.clone()):c.lines.splice(v+1,0,h.clone()),w?this.isUserScrolling&&(c.ydisp=Math.max(c.ydisp-1,0)):(c.ybase++,this.isUserScrolling||c.ydisp++)}else{let w=v-m+1;c.lines.shiftElements(m+1,w-1,-1),c.lines.set(v,h.clone())}this.isUserScrolling||(c.ydisp=c.ybase),this._onScroll.fire(c.ydisp)}scrollLines(o,a,c){let h=this.buffer;if(o<0){if(h.ydisp===0)return;this.isUserScrolling=!0}else o+h.ydisp>=h.ybase&&(this.isUserScrolling=!1);let m=h.ydisp;h.ydisp=Math.max(Math.min(h.ydisp+o,h.ybase),0),m!==h.ydisp&&(a||this._onScroll.fire(h.ydisp))}};s.BufferService=b=l([p(0,y.IOptionsService)],b)},7994:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.CharsetService=void 0,s.CharsetService=class{constructor(){this.glevel=0,this._charsets=[]}reset(){this.charset=void 0,this._charsets=[],this.glevel=0}setgLevel(r){this.glevel=r,this.charset=this._charsets[r]}setgCharset(r,l){this._charsets[r]=l,this.glevel===r&&(this.charset=l)}}},1753:function(u,s,r){var l=this&&this.__decorate||function(h,m,v,w){var C,_=arguments.length,S=_<3?m:w===null?w=Object.getOwnPropertyDescriptor(m,v):w;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")S=Reflect.decorate(h,m,v,w);else for(var T=h.length-1;T>=0;T--)(C=h[T])&&(S=(_<3?C(S):_>3?C(m,v,S):C(m,v))||S);return _>3&&S&&Object.defineProperty(m,v,S),S},p=this&&this.__param||function(h,m){return function(v,w){m(v,w,h)}};Object.defineProperty(s,"__esModule",{value:!0}),s.CoreMouseService=void 0;let d=r(2585),f=r(8460),g=r(844),y={NONE:{events:0,restrict:()=>!1},X10:{events:1,restrict:h=>h.button!==4&&h.action===1&&(h.ctrl=!1,h.alt=!1,h.shift=!1,!0)},VT200:{events:19,restrict:h=>h.action!==32},DRAG:{events:23,restrict:h=>h.action!==32||h.button!==3},ANY:{events:31,restrict:h=>!0}};function b(h,m){let v=(h.ctrl?16:0)|(h.shift?4:0)|(h.alt?8:0);return h.button===4?(v|=64,v|=h.action):(v|=3&h.button,4&h.button&&(v|=64),8&h.button&&(v|=128),h.action===32?v|=32:h.action!==0||m||(v|=3)),v}let o=String.fromCharCode,a={DEFAULT:h=>{let m=[b(h,!1)+32,h.col+32,h.row+32];return m[0]>255||m[1]>255||m[2]>255?"":`\x1B[M${o(m[0])}${o(m[1])}${o(m[2])}`},SGR:h=>{let m=h.action===0&&h.button!==4?"m":"M";return`\x1B[<${b(h,!0)};${h.col};${h.row}${m}`},SGR_PIXELS:h=>{let m=h.action===0&&h.button!==4?"m":"M";return`\x1B[<${b(h,!0)};${h.x};${h.y}${m}`}},c=s.CoreMouseService=class extends g.Disposable{constructor(h,m){super(),this._bufferService=h,this._coreService=m,this._protocols={},this._encodings={},this._activeProtocol="",this._activeEncoding="",this._lastEvent=null,this._onProtocolChange=this.register(new f.EventEmitter),this.onProtocolChange=this._onProtocolChange.event;for(let v of Object.keys(y))this.addProtocol(v,y[v]);for(let v of Object.keys(a))this.addEncoding(v,a[v]);this.reset()}addProtocol(h,m){this._protocols[h]=m}addEncoding(h,m){this._encodings[h]=m}get activeProtocol(){return this._activeProtocol}get areMouseEventsActive(){return this._protocols[this._activeProtocol].events!==0}set activeProtocol(h){if(!this._protocols[h])throw new Error(`unknown protocol "${h}"`);this._activeProtocol=h,this._onProtocolChange.fire(this._protocols[h].events)}get activeEncoding(){return this._activeEncoding}set activeEncoding(h){if(!this._encodings[h])throw new Error(`unknown encoding "${h}"`);this._activeEncoding=h}reset(){this.activeProtocol="NONE",this.activeEncoding="DEFAULT",this._lastEvent=null}triggerMouseEvent(h){if(h.col<0||h.col>=this._bufferService.cols||h.row<0||h.row>=this._bufferService.rows||h.button===4&&h.action===32||h.button===3&&h.action!==32||h.button!==4&&(h.action===2||h.action===3)||(h.col++,h.row++,h.action===32&&this._lastEvent&&this._equalEvents(this._lastEvent,h,this._activeEncoding==="SGR_PIXELS"))||!this._protocols[this._activeProtocol].restrict(h))return!1;let m=this._encodings[this._activeEncoding](h);return m&&(this._activeEncoding==="DEFAULT"?this._coreService.triggerBinaryEvent(m):this._coreService.triggerDataEvent(m,!0)),this._lastEvent=h,!0}explainEvents(h){return{down:!!(1&h),up:!!(2&h),drag:!!(4&h),move:!!(8&h),wheel:!!(16&h)}}_equalEvents(h,m,v){if(v){if(h.x!==m.x||h.y!==m.y)return!1}else if(h.col!==m.col||h.row!==m.row)return!1;return h.button===m.button&&h.action===m.action&&h.ctrl===m.ctrl&&h.alt===m.alt&&h.shift===m.shift}};s.CoreMouseService=c=l([p(0,d.IBufferService),p(1,d.ICoreService)],c)},6975:function(u,s,r){var l=this&&this.__decorate||function(c,h,m,v){var w,C=arguments.length,_=C<3?h:v===null?v=Object.getOwnPropertyDescriptor(h,m):v;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")_=Reflect.decorate(c,h,m,v);else for(var S=c.length-1;S>=0;S--)(w=c[S])&&(_=(C<3?w(_):C>3?w(h,m,_):w(h,m))||_);return C>3&&_&&Object.defineProperty(h,m,_),_},p=this&&this.__param||function(c,h){return function(m,v){h(m,v,c)}};Object.defineProperty(s,"__esModule",{value:!0}),s.CoreService=void 0;let d=r(1439),f=r(8460),g=r(844),y=r(2585),b=Object.freeze({insertMode:!1}),o=Object.freeze({applicationCursorKeys:!1,applicationKeypad:!1,bracketedPasteMode:!1,origin:!1,reverseWraparound:!1,sendFocus:!1,wraparound:!0}),a=s.CoreService=class extends g.Disposable{constructor(c,h,m){super(),this._bufferService=c,this._logService=h,this._optionsService=m,this.isCursorInitialized=!1,this.isCursorHidden=!1,this._onData=this.register(new f.EventEmitter),this.onData=this._onData.event,this._onUserInput=this.register(new f.EventEmitter),this.onUserInput=this._onUserInput.event,this._onBinary=this.register(new f.EventEmitter),this.onBinary=this._onBinary.event,this._onRequestScrollToBottom=this.register(new f.EventEmitter),this.onRequestScrollToBottom=this._onRequestScrollToBottom.event,this.modes=(0,d.clone)(b),this.decPrivateModes=(0,d.clone)(o)}reset(){this.modes=(0,d.clone)(b),this.decPrivateModes=(0,d.clone)(o)}triggerDataEvent(c,h=!1){if(this._optionsService.rawOptions.disableStdin)return;let m=this._bufferService.buffer;h&&this._optionsService.rawOptions.scrollOnUserInput&&m.ybase!==m.ydisp&&this._onRequestScrollToBottom.fire(),h&&this._onUserInput.fire(),this._logService.debug(`sending data "${c}"`,(()=>c.split("").map((v=>v.charCodeAt(0))))),this._onData.fire(c)}triggerBinaryEvent(c){this._optionsService.rawOptions.disableStdin||(this._logService.debug(`sending binary "${c}"`,(()=>c.split("").map((h=>h.charCodeAt(0))))),this._onBinary.fire(c))}};s.CoreService=a=l([p(0,y.IBufferService),p(1,y.ILogService),p(2,y.IOptionsService)],a)},9074:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.DecorationService=void 0;let l=r(8055),p=r(8460),d=r(844),f=r(6106),g=0,y=0;class b extends d.Disposable{get decorations(){return this._decorations.values()}constructor(){super(),this._decorations=new f.SortedList((c=>c?.marker.line)),this._onDecorationRegistered=this.register(new p.EventEmitter),this.onDecorationRegistered=this._onDecorationRegistered.event,this._onDecorationRemoved=this.register(new p.EventEmitter),this.onDecorationRemoved=this._onDecorationRemoved.event,this.register((0,d.toDisposable)((()=>this.reset())))}registerDecoration(c){if(c.marker.isDisposed)return;let h=new o(c);if(h){let m=h.marker.onDispose((()=>h.dispose()));h.onDispose((()=>{h&&(this._decorations.delete(h)&&this._onDecorationRemoved.fire(h),m.dispose())})),this._decorations.insert(h),this._onDecorationRegistered.fire(h)}return h}reset(){for(let c of this._decorations.values())c.dispose();this._decorations.clear()}*getDecorationsAtCell(c,h,m){var v,w,C;let _=0,S=0;for(let T of this._decorations.getKeyIterator(h))_=(v=T.options.x)!==null&&v!==void 0?v:0,S=_+((w=T.options.width)!==null&&w!==void 0?w:1),c>=_&&c<S&&(!m||((C=T.options.layer)!==null&&C!==void 0?C:"bottom")===m)&&(yield T)}forEachDecorationAtCell(c,h,m,v){this._decorations.forEachByKey(h,(w=>{var C,_,S;g=(C=w.options.x)!==null&&C!==void 0?C:0,y=g+((_=w.options.width)!==null&&_!==void 0?_:1),c>=g&&c<y&&(!m||((S=w.options.layer)!==null&&S!==void 0?S:"bottom")===m)&&v(w)}))}}s.DecorationService=b;class o extends d.Disposable{get isDisposed(){return this._isDisposed}get backgroundColorRGB(){return this._cachedBg===null&&(this.options.backgroundColor?this._cachedBg=l.css.toColor(this.options.backgroundColor):this._cachedBg=void 0),this._cachedBg}get foregroundColorRGB(){return this._cachedFg===null&&(this.options.foregroundColor?this._cachedFg=l.css.toColor(this.options.foregroundColor):this._cachedFg=void 0),this._cachedFg}constructor(c){super(),this.options=c,this.onRenderEmitter=this.register(new p.EventEmitter),this.onRender=this.onRenderEmitter.event,this._onDispose=this.register(new p.EventEmitter),this.onDispose=this._onDispose.event,this._cachedBg=null,this._cachedFg=null,this.marker=c.marker,this.options.overviewRulerOptions&&!this.options.overviewRulerOptions.position&&(this.options.overviewRulerOptions.position="full")}dispose(){this._onDispose.fire(),super.dispose()}}},4348:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.InstantiationService=s.ServiceCollection=void 0;let l=r(2585),p=r(8343);class d{constructor(...g){this._entries=new Map;for(let[y,b]of g)this.set(y,b)}set(g,y){let b=this._entries.get(g);return this._entries.set(g,y),b}forEach(g){for(let[y,b]of this._entries.entries())g(y,b)}has(g){return this._entries.has(g)}get(g){return this._entries.get(g)}}s.ServiceCollection=d,s.InstantiationService=class{constructor(){this._services=new d,this._services.set(l.IInstantiationService,this)}setService(f,g){this._services.set(f,g)}getService(f){return this._services.get(f)}createInstance(f,...g){let y=(0,p.getServiceDependencies)(f).sort(((a,c)=>a.index-c.index)),b=[];for(let a of y){let c=this._services.get(a.id);if(!c)throw new Error(`[createInstance] ${f.name} depends on UNKNOWN service ${a.id}.`);b.push(c)}let o=y.length>0?y[0].index:g.length;if(g.length!==o)throw new Error(`[createInstance] First service dependency of ${f.name} at position ${o+1} conflicts with ${g.length} static arguments`);return new f(...g,...b)}}},7866:function(u,s,r){var l=this&&this.__decorate||function(o,a,c,h){var m,v=arguments.length,w=v<3?a:h===null?h=Object.getOwnPropertyDescriptor(a,c):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")w=Reflect.decorate(o,a,c,h);else for(var C=o.length-1;C>=0;C--)(m=o[C])&&(w=(v<3?m(w):v>3?m(a,c,w):m(a,c))||w);return v>3&&w&&Object.defineProperty(a,c,w),w},p=this&&this.__param||function(o,a){return function(c,h){a(c,h,o)}};Object.defineProperty(s,"__esModule",{value:!0}),s.traceCall=s.setTraceLogger=s.LogService=void 0;let d=r(844),f=r(2585),g={trace:f.LogLevelEnum.TRACE,debug:f.LogLevelEnum.DEBUG,info:f.LogLevelEnum.INFO,warn:f.LogLevelEnum.WARN,error:f.LogLevelEnum.ERROR,off:f.LogLevelEnum.OFF},y,b=s.LogService=class extends d.Disposable{get logLevel(){return this._logLevel}constructor(o){super(),this._optionsService=o,this._logLevel=f.LogLevelEnum.OFF,this._updateLogLevel(),this.register(this._optionsService.onSpecificOptionChange("logLevel",(()=>this._updateLogLevel()))),y=this}_updateLogLevel(){this._logLevel=g[this._optionsService.rawOptions.logLevel]}_evalLazyOptionalParams(o){for(let a=0;a<o.length;a++)typeof o[a]=="function"&&(o[a]=o[a]())}_log(o,a,c){this._evalLazyOptionalParams(c),o.call(console,(this._optionsService.options.logger?"":"xterm.js: ")+a,...c)}trace(o,...a){var c,h;this._logLevel<=f.LogLevelEnum.TRACE&&this._log((h=(c=this._optionsService.options.logger)===null||c===void 0?void 0:c.trace.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.log,o,a)}debug(o,...a){var c,h;this._logLevel<=f.LogLevelEnum.DEBUG&&this._log((h=(c=this._optionsService.options.logger)===null||c===void 0?void 0:c.debug.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.log,o,a)}info(o,...a){var c,h;this._logLevel<=f.LogLevelEnum.INFO&&this._log((h=(c=this._optionsService.options.logger)===null||c===void 0?void 0:c.info.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.info,o,a)}warn(o,...a){var c,h;this._logLevel<=f.LogLevelEnum.WARN&&this._log((h=(c=this._optionsService.options.logger)===null||c===void 0?void 0:c.warn.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.warn,o,a)}error(o,...a){var c,h;this._logLevel<=f.LogLevelEnum.ERROR&&this._log((h=(c=this._optionsService.options.logger)===null||c===void 0?void 0:c.error.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.error,o,a)}};s.LogService=b=l([p(0,f.IOptionsService)],b),s.setTraceLogger=function(o){y=o},s.traceCall=function(o,a,c){if(typeof c.value!="function")throw new Error("not supported");let h=c.value;c.value=function(...m){if(y.logLevel!==f.LogLevelEnum.TRACE)return h.apply(this,m);y.trace(`GlyphRenderer#${h.name}(${m.map((w=>JSON.stringify(w))).join(", ")})`);let v=h.apply(this,m);return y.trace(`GlyphRenderer#${h.name} return`,v),v}}},7302:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.OptionsService=s.DEFAULT_OPTIONS=void 0;let l=r(8460),p=r(844),d=r(6114);s.DEFAULT_OPTIONS={cols:80,rows:24,cursorBlink:!1,cursorStyle:"block",cursorWidth:1,cursorInactiveStyle:"outline",customGlyphs:!0,drawBoldTextInBrightColors:!0,fastScrollModifier:"alt",fastScrollSensitivity:5,fontFamily:"courier-new, courier, monospace",fontSize:15,fontWeight:"normal",fontWeightBold:"bold",ignoreBracketedPasteMode:!1,lineHeight:1,letterSpacing:0,linkHandler:null,logLevel:"info",logger:null,scrollback:1e3,scrollOnUserInput:!0,scrollSensitivity:1,screenReaderMode:!1,smoothScrollDuration:0,macOptionIsMeta:!1,macOptionClickForcesSelection:!1,minimumContrastRatio:1,disableStdin:!1,allowProposedApi:!1,allowTransparency:!1,tabStopWidth:8,theme:{},rightClickSelectsWord:d.isMac,windowOptions:{},windowsMode:!1,windowsPty:{},wordSeparator:" ()[]{}',\"`",altClickMovesCursor:!0,convertEol:!1,termName:"xterm",cancelEvents:!1,overviewRulerWidth:0};let f=["normal","bold","100","200","300","400","500","600","700","800","900"];class g extends p.Disposable{constructor(b){super(),this._onOptionChange=this.register(new l.EventEmitter),this.onOptionChange=this._onOptionChange.event;let o=Object.assign({},s.DEFAULT_OPTIONS);for(let a in b)if(a in o)try{let c=b[a];o[a]=this._sanitizeAndValidateOption(a,c)}catch(c){console.error(c)}this.rawOptions=o,this.options=Object.assign({},o),this._setupOptions()}onSpecificOptionChange(b,o){return this.onOptionChange((a=>{a===b&&o(this.rawOptions[b])}))}onMultipleOptionChange(b,o){return this.onOptionChange((a=>{b.indexOf(a)!==-1&&o()}))}_setupOptions(){let b=a=>{if(!(a in s.DEFAULT_OPTIONS))throw new Error(`No option with key "${a}"`);return this.rawOptions[a]},o=(a,c)=>{if(!(a in s.DEFAULT_OPTIONS))throw new Error(`No option with key "${a}"`);c=this._sanitizeAndValidateOption(a,c),this.rawOptions[a]!==c&&(this.rawOptions[a]=c,this._onOptionChange.fire(a))};for(let a in this.rawOptions){let c={get:b.bind(this,a),set:o.bind(this,a)};Object.defineProperty(this.options,a,c)}}_sanitizeAndValidateOption(b,o){switch(b){case"cursorStyle":if(o||(o=s.DEFAULT_OPTIONS[b]),!(function(a){return a==="block"||a==="underline"||a==="bar"})(o))throw new Error(`"${o}" is not a valid value for ${b}`);break;case"wordSeparator":o||(o=s.DEFAULT_OPTIONS[b]);break;case"fontWeight":case"fontWeightBold":if(typeof o=="number"&&1<=o&&o<=1e3)break;o=f.includes(o)?o:s.DEFAULT_OPTIONS[b];break;case"cursorWidth":o=Math.floor(o);case"lineHeight":case"tabStopWidth":if(o<1)throw new Error(`${b} cannot be less than 1, value: ${o}`);break;case"minimumContrastRatio":o=Math.max(1,Math.min(21,Math.round(10*o)/10));break;case"scrollback":if((o=Math.min(o,4294967295))<0)throw new Error(`${b} cannot be less than 0, value: ${o}`);break;case"fastScrollSensitivity":case"scrollSensitivity":if(o<=0)throw new Error(`${b} cannot be less than or equal to 0, value: ${o}`);break;case"rows":case"cols":if(!o&&o!==0)throw new Error(`${b} must be numeric, value: ${o}`);break;case"windowsPty":o=o??{}}return o}}s.OptionsService=g},2660:function(u,s,r){var l=this&&this.__decorate||function(g,y,b,o){var a,c=arguments.length,h=c<3?y:o===null?o=Object.getOwnPropertyDescriptor(y,b):o;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")h=Reflect.decorate(g,y,b,o);else for(var m=g.length-1;m>=0;m--)(a=g[m])&&(h=(c<3?a(h):c>3?a(y,b,h):a(y,b))||h);return c>3&&h&&Object.defineProperty(y,b,h),h},p=this&&this.__param||function(g,y){return function(b,o){y(b,o,g)}};Object.defineProperty(s,"__esModule",{value:!0}),s.OscLinkService=void 0;let d=r(2585),f=s.OscLinkService=class{constructor(g){this._bufferService=g,this._nextId=1,this._entriesWithId=new Map,this._dataByLinkId=new Map}registerLink(g){let y=this._bufferService.buffer;if(g.id===void 0){let m=y.addMarker(y.ybase+y.y),v={data:g,id:this._nextId++,lines:[m]};return m.onDispose((()=>this._removeMarkerFromLink(v,m))),this._dataByLinkId.set(v.id,v),v.id}let b=g,o=this._getEntryIdKey(b),a=this._entriesWithId.get(o);if(a)return this.addLineToLink(a.id,y.ybase+y.y),a.id;let c=y.addMarker(y.ybase+y.y),h={id:this._nextId++,key:this._getEntryIdKey(b),data:b,lines:[c]};return c.onDispose((()=>this._removeMarkerFromLink(h,c))),this._entriesWithId.set(h.key,h),this._dataByLinkId.set(h.id,h),h.id}addLineToLink(g,y){let b=this._dataByLinkId.get(g);if(b&&b.lines.every((o=>o.line!==y))){let o=this._bufferService.buffer.addMarker(y);b.lines.push(o),o.onDispose((()=>this._removeMarkerFromLink(b,o)))}}getLinkData(g){var y;return(y=this._dataByLinkId.get(g))===null||y===void 0?void 0:y.data}_getEntryIdKey(g){return`${g.id};;${g.uri}`}_removeMarkerFromLink(g,y){let b=g.lines.indexOf(y);b!==-1&&(g.lines.splice(b,1),g.lines.length===0&&(g.data.id!==void 0&&this._entriesWithId.delete(g.key),this._dataByLinkId.delete(g.id)))}};s.OscLinkService=f=l([p(0,d.IBufferService)],f)},8343:(u,s)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.createDecorator=s.getServiceDependencies=s.serviceRegistry=void 0;let r="di$target",l="di$dependencies";s.serviceRegistry=new Map,s.getServiceDependencies=function(p){return p[l]||[]},s.createDecorator=function(p){if(s.serviceRegistry.has(p))return s.serviceRegistry.get(p);let d=function(f,g,y){if(arguments.length!==3)throw new Error("@IServiceName-decorator can only be used to decorate a parameter");(function(b,o,a){o[r]===o?o[l].push({id:b,index:a}):(o[l]=[{id:b,index:a}],o[r]=o)})(d,f,y)};return d.toString=()=>p,s.serviceRegistry.set(p,d),d}},2585:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.IDecorationService=s.IUnicodeService=s.IOscLinkService=s.IOptionsService=s.ILogService=s.LogLevelEnum=s.IInstantiationService=s.ICharsetService=s.ICoreService=s.ICoreMouseService=s.IBufferService=void 0;let l=r(8343);var p;s.IBufferService=(0,l.createDecorator)("BufferService"),s.ICoreMouseService=(0,l.createDecorator)("CoreMouseService"),s.ICoreService=(0,l.createDecorator)("CoreService"),s.ICharsetService=(0,l.createDecorator)("CharsetService"),s.IInstantiationService=(0,l.createDecorator)("InstantiationService"),(function(d){d[d.TRACE=0]="TRACE",d[d.DEBUG=1]="DEBUG",d[d.INFO=2]="INFO",d[d.WARN=3]="WARN",d[d.ERROR=4]="ERROR",d[d.OFF=5]="OFF"})(p||(s.LogLevelEnum=p={})),s.ILogService=(0,l.createDecorator)("LogService"),s.IOptionsService=(0,l.createDecorator)("OptionsService"),s.IOscLinkService=(0,l.createDecorator)("OscLinkService"),s.IUnicodeService=(0,l.createDecorator)("UnicodeService"),s.IDecorationService=(0,l.createDecorator)("DecorationService")},1480:(u,s,r)=>{Object.defineProperty(s,"__esModule",{value:!0}),s.UnicodeService=void 0;let l=r(8460),p=r(225);s.UnicodeService=class{constructor(){this._providers=Object.create(null),this._active="",this._onChange=new l.EventEmitter,this.onChange=this._onChange.event;let d=new p.UnicodeV6;this.register(d),this._active=d.version,this._activeProvider=d}dispose(){this._onChange.dispose()}get versions(){return Object.keys(this._providers)}get activeVersion(){return this._active}set activeVersion(d){if(!this._providers[d])throw new Error(`unknown Unicode version "${d}"`);this._active=d,this._activeProvider=this._providers[d],this._onChange.fire(d)}register(d){this._providers[d.version]=d}wcwidth(d){return this._activeProvider.wcwidth(d)}getStringCellWidth(d){let f=0,g=d.length;for(let y=0;y<g;++y){let b=d.charCodeAt(y);if(55296<=b&&b<=56319){if(++y>=g)return f+this.wcwidth(b);let o=d.charCodeAt(y);56320<=o&&o<=57343?b=1024*(b-55296)+o-56320+65536:f+=this.wcwidth(o)}f+=this.wcwidth(b)}return f}}}},t={};function i(u){var s=t[u];if(s!==void 0)return s.exports;var r=t[u]={exports:{}};return e[u].call(r.exports,r,r.exports,i),r.exports}var n={};return(()=>{var u=n;Object.defineProperty(u,"__esModule",{value:!0}),u.Terminal=void 0;let s=i(9042),r=i(3236),l=i(844),p=i(5741),d=i(8285),f=i(7975),g=i(7090),y=["cols","rows"];class b extends l.Disposable{constructor(a){super(),this._core=this.register(new r.Terminal(a)),this._addonManager=this.register(new p.AddonManager),this._publicOptions=Object.assign({},this._core.options);let c=m=>this._core.options[m],h=(m,v)=>{this._checkReadonlyOptions(m),this._core.options[m]=v};for(let m in this._core.options){let v={get:c.bind(this,m),set:h.bind(this,m)};Object.defineProperty(this._publicOptions,m,v)}}_checkReadonlyOptions(a){if(y.includes(a))throw new Error(`Option "${a}" can only be set in the constructor`)}_checkProposedApi(){if(!this._core.optionsService.rawOptions.allowProposedApi)throw new Error("You must set the allowProposedApi option to true to use proposed API")}get onBell(){return this._core.onBell}get onBinary(){return this._core.onBinary}get onCursorMove(){return this._core.onCursorMove}get onData(){return this._core.onData}get onKey(){return this._core.onKey}get onLineFeed(){return this._core.onLineFeed}get onRender(){return this._core.onRender}get onResize(){return this._core.onResize}get onScroll(){return this._core.onScroll}get onSelectionChange(){return this._core.onSelectionChange}get onTitleChange(){return this._core.onTitleChange}get onWriteParsed(){return this._core.onWriteParsed}get element(){return this._core.element}get parser(){return this._parser||(this._parser=new f.ParserApi(this._core)),this._parser}get unicode(){return this._checkProposedApi(),new g.UnicodeApi(this._core)}get textarea(){return this._core.textarea}get rows(){return this._core.rows}get cols(){return this._core.cols}get buffer(){return this._buffer||(this._buffer=this.register(new d.BufferNamespaceApi(this._core))),this._buffer}get markers(){return this._checkProposedApi(),this._core.markers}get modes(){let a=this._core.coreService.decPrivateModes,c="none";switch(this._core.coreMouseService.activeProtocol){case"X10":c="x10";break;case"VT200":c="vt200";break;case"DRAG":c="drag";break;case"ANY":c="any"}return{applicationCursorKeysMode:a.applicationCursorKeys,applicationKeypadMode:a.applicationKeypad,bracketedPasteMode:a.bracketedPasteMode,insertMode:this._core.coreService.modes.insertMode,mouseTrackingMode:c,originMode:a.origin,reverseWraparoundMode:a.reverseWraparound,sendFocusMode:a.sendFocus,wraparoundMode:a.wraparound}}get options(){return this._publicOptions}set options(a){for(let c in a)this._publicOptions[c]=a[c]}blur(){this._core.blur()}focus(){this._core.focus()}resize(a,c){this._verifyIntegers(a,c),this._core.resize(a,c)}open(a){this._core.open(a)}attachCustomKeyEventHandler(a){this._core.attachCustomKeyEventHandler(a)}registerLinkProvider(a){return this._core.registerLinkProvider(a)}registerCharacterJoiner(a){return this._checkProposedApi(),this._core.registerCharacterJoiner(a)}deregisterCharacterJoiner(a){this._checkProposedApi(),this._core.deregisterCharacterJoiner(a)}registerMarker(a=0){return this._verifyIntegers(a),this._core.registerMarker(a)}registerDecoration(a){var c,h,m;return this._checkProposedApi(),this._verifyPositiveIntegers((c=a.x)!==null&&c!==void 0?c:0,(h=a.width)!==null&&h!==void 0?h:0,(m=a.height)!==null&&m!==void 0?m:0),this._core.registerDecoration(a)}hasSelection(){return this._core.hasSelection()}select(a,c,h){this._verifyIntegers(a,c,h),this._core.select(a,c,h)}getSelection(){return this._core.getSelection()}getSelectionPosition(){return this._core.getSelectionPosition()}clearSelection(){this._core.clearSelection()}selectAll(){this._core.selectAll()}selectLines(a,c){this._verifyIntegers(a,c),this._core.selectLines(a,c)}dispose(){super.dispose()}scrollLines(a){this._verifyIntegers(a),this._core.scrollLines(a)}scrollPages(a){this._verifyIntegers(a),this._core.scrollPages(a)}scrollToTop(){this._core.scrollToTop()}scrollToBottom(){this._core.scrollToBottom()}scrollToLine(a){this._verifyIntegers(a),this._core.scrollToLine(a)}clear(){this._core.clear()}write(a,c){this._core.write(a,c)}writeln(a,c){this._core.write(a),this._core.write(`\r
`,c)}paste(a){this._core.paste(a)}refresh(a,c){this._verifyIntegers(a,c),this._core.refresh(a,c)}reset(){this._core.reset()}clearTextureAtlas(){this._core.clearTextureAtlas()}loadAddon(a){this._addonManager.loadAddon(this,a)}static get strings(){return s}_verifyIntegers(...a){for(let c of a)if(c===1/0||isNaN(c)||c%1!=0)throw new Error("This API only accepts integers")}_verifyPositiveIntegers(...a){for(let c of a)if(c&&(c===1/0||isNaN(c)||c%1!=0||c<0))throw new Error("This API only accepts positive integers")}}u.Terminal=b})(),n})()))});var ro={};cn(ro,{FitAddon:()=>ah});var oh,nh,ah,oo=ln(()=>{oh=2,nh=1,ah=class{activate(e){this._terminal=e}dispose(){}fit(){let e=this.proposeDimensions();if(!e||!this._terminal||isNaN(e.cols)||isNaN(e.rows))return;let t=this._terminal._core;(this._terminal.rows!==e.rows||this._terminal.cols!==e.cols)&&(t._renderService.clear(),this._terminal.resize(e.cols,e.rows))}proposeDimensions(){if(!this._terminal||!this._terminal.element||!this._terminal.element.parentElement)return;let e=this._terminal._core._renderService.dimensions;if(e.css.cell.width===0||e.css.cell.height===0)return;let t=this._terminal.options.scrollback===0?0:this._terminal.options.overviewRuler?.width||14,i=window.getComputedStyle(this._terminal.element.parentElement),n=parseInt(i.getPropertyValue("height")),u=Math.max(0,parseInt(i.getPropertyValue("width"))),s=window.getComputedStyle(this._terminal.element),r={top:parseInt(s.getPropertyValue("padding-top")),bottom:parseInt(s.getPropertyValue("padding-bottom")),right:parseInt(s.getPropertyValue("padding-right")),left:parseInt(s.getPropertyValue("padding-left"))},l=r.top+r.bottom,p=r.right+r.left,d=n-l,f=u-p-t;return{cols:Math.max(oh,Math.floor(f/e.css.cell.width)),rows:Math.max(nh,Math.floor(d/e.css.cell.height))}}}});var _a={};cn(_a,{SearchAddon:()=>sd});function no(e){hh(e)||ch.onUnexpectedError(e)}function hh(e){return e instanceof dh?!0:e instanceof Error&&e.name===co&&e.message===co}function uh(e,t,i=0,n=e.length){let u=i,s=n;for(;u<s;){let r=Math.floor((u+s)/2);t(e[r])?u=r+1:s=r}return u-1}function fh(e,t){return(i,n)=>t(e(i),e(n))}function _h(e,t){let i=Object.create(null);for(let n of e){let u=t(n),s=i[u];s||(s=i[u]=[]),s.push(n)}return i}function vh(e,t){let i=this,n=!1,u;return function(){if(n)return u;if(n=!0,t)try{u=e.apply(i,arguments)}finally{t()}else u=e.apply(i,arguments);return u}}function wh(e){bi=e}function Ys(e){return bi?.trackDisposable(e),e}function Js(e){bi?.markAsDisposed(e)}function ns(e,t){bi?.setParent(e,t)}function Sh(e,t){if(bi)for(let i of e)bi.setParent(i,t)}function os(e){if(sa.is(e)){let t=[];for(let i of e)if(i)try{i.dispose()}catch(n){t.push(n)}if(t.length===1)throw t[0];if(t.length>1)throw new AggregateError(t,"Encountered errors while disposing of store");return Array.isArray(e)?[]:e}else if(e)return e.dispose(),e}function oa(...e){let t=yi(()=>os(e));return Sh(e,t),t}function yi(e){let t=Ys({dispose:vh(()=>{Js(t),e()})});return t}function ma(e,t=0,i){let n=setTimeout(()=>{e(),i&&u.dispose()},t),u=yi(()=>{clearTimeout(n),i?.deleteAndLeak(u)});return i?.add(u),u}var lh,ch,co,dh,qn,ph,ia,mh,Kn,Gn,Xn,qm,gh,sa,bh,bi,yh,na,bo,nt,Xs,Yn,Ch,xh,kh,Jn,Eh,yo,fo,Ah,Zn,ca,Lh,_o,Th,Dh,Rh,Vs,$h,Oh,qs,ot,Mh,ua,Bh,Ph,vi,go,vo,Ks,Ih,Hh,pa,Fh,zh,Nh,Wh,js,Gs,Qn,Uh,ft,mt,Ne,fa,jh,ao,Vh,Km,at,Et,qh,Kh,Gh,Xh,Gm,Xm,Ym,Jm,Yh,lo,Jh,ea,Zh,Qh,ed,td,id,sd,ga=ln(()=>{lh=class{constructor(){this.listeners=[],this.unexpectedErrorHandler=function(e){setTimeout(()=>{throw e.stack?qn.isErrorNoTelemetry(e)?new qn(e.message+`

`+e.stack):new Error(e.message+`

`+e.stack):e},0)}}addListener(e){return this.listeners.push(e),()=>{this._removeListener(e)}}emit(e){this.listeners.forEach(t=>{t(e)})}_removeListener(e){this.listeners.splice(this.listeners.indexOf(e),1)}setUnexpectedErrorHandler(e){this.unexpectedErrorHandler=e}getUnexpectedErrorHandler(){return this.unexpectedErrorHandler}onUnexpectedError(e){this.unexpectedErrorHandler(e),this.emit(e)}onUnexpectedExternalError(e){this.unexpectedErrorHandler(e)}},ch=new lh;co="Canceled";dh=class extends Error{constructor(){super(co),this.name=this.message}},qn=class ho extends Error{constructor(t){super(t),this.name="CodeExpectedError"}static fromError(t){if(t instanceof ho)return t;let i=new ho;return i.message=t.message,i.stack=t.stack,i}static isErrorNoTelemetry(t){return t.name==="CodeExpectedError"}};ph=class ta{constructor(t){this._array=t,this._findLastMonotonousLastIdx=0}findLastMonotonous(t){if(ta.assertInvariants){if(this._prevFindLastPredicate){for(let n of this._array)if(this._prevFindLastPredicate(n)&&!t(n))throw new Error("MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.")}this._prevFindLastPredicate=t}let i=uh(this._array,t,this._findLastMonotonousLastIdx);return this._findLastMonotonousLastIdx=i+1,i===-1?void 0:this._array[i]}};ph.assertInvariants=!1;(e=>{function t(s){return s<0}e.isLessThan=t;function i(s){return s<=0}e.isLessThanOrEqual=i;function n(s){return s>0}e.isGreaterThan=n;function u(s){return s===0}e.isNeitherLessOrGreaterThan=u,e.greaterThan=1,e.lessThan=-1,e.neitherLessOrGreaterThan=0})(ia||(ia={}));mh=(e,t)=>e-t,Kn=class uo{constructor(t){this.iterate=t}forEach(t){this.iterate(i=>(t(i),!0))}toArray(){let t=[];return this.iterate(i=>(t.push(i),!0)),t}filter(t){return new uo(i=>this.iterate(n=>t(n)?i(n):!0))}map(t){return new uo(i=>this.iterate(n=>i(t(n))))}some(t){let i=!1;return this.iterate(n=>(i=t(n),!i)),i}findFirst(t){let i;return this.iterate(n=>t(n)?(i=n,!1):!0),i}findLast(t){let i;return this.iterate(n=>(t(n)&&(i=n),!0)),i}findLastMaxBy(t){let i,n=!0;return this.iterate(u=>((n||ia.isGreaterThan(t(u,i)))&&(n=!1,i=u),!0)),i}};Kn.empty=new Kn(e=>{});qm=class{constructor(e,t){this.toKey=t,this._map=new Map,this[Gn]="SetWithKey";for(let i of e)this.add(i)}get size(){return this._map.size}add(e){let t=this.toKey(e);return this._map.set(t,e),this}delete(e){return this._map.delete(this.toKey(e))}has(e){return this._map.has(this.toKey(e))}*entries(){for(let e of this._map.values())yield[e,e]}keys(){return this.values()}*values(){for(let e of this._map.values())yield e}clear(){this._map.clear()}forEach(e,t){this._map.forEach(i=>e.call(t,i,i,this))}[(Xn=Symbol.iterator,Gn=Symbol.toStringTag,Xn)](){return this.values()}},gh=class{constructor(){this.map=new Map}add(e,t){let i=this.map.get(e);i||(i=new Set,this.map.set(e,i)),i.add(t)}delete(e,t){let i=this.map.get(e);i&&(i.delete(t),i.size===0&&this.map.delete(e))}forEach(e,t){let i=this.map.get(e);i&&i.forEach(t)}get(e){return this.map.get(e)||new Set}};(e=>{function t(w){return w&&typeof w=="object"&&typeof w[Symbol.iterator]=="function"}e.is=t;let i=Object.freeze([]);function n(){return i}e.empty=n;function*u(w){yield w}e.single=u;function s(w){return t(w)?w:u(w)}e.wrap=s;function r(w){return w||i}e.from=r;function*l(w){for(let C=w.length-1;C>=0;C--)yield w[C]}e.reverse=l;function p(w){return!w||w[Symbol.iterator]().next().done===!0}e.isEmpty=p;function d(w){return w[Symbol.iterator]().next().value}e.first=d;function f(w,C){let _=0;for(let S of w)if(C(S,_++))return!0;return!1}e.some=f;function g(w,C){for(let _ of w)if(C(_))return _}e.find=g;function*y(w,C){for(let _ of w)C(_)&&(yield _)}e.filter=y;function*b(w,C){let _=0;for(let S of w)yield C(S,_++)}e.map=b;function*o(w,C){let _=0;for(let S of w)yield*C(S,_++)}e.flatMap=o;function*a(...w){for(let C of w)yield*C}e.concat=a;function c(w,C,_){let S=_;for(let T of w)S=C(S,T);return S}e.reduce=c;function*h(w,C,_=w.length){for(C<0&&(C+=w.length),_<0?_+=w.length:_>w.length&&(_=w.length);C<_;C++)yield w[C]}e.slice=h;function m(w,C=Number.POSITIVE_INFINITY){let _=[];if(C===0)return[_,w];let S=w[Symbol.iterator]();for(let T=0;T<C;T++){let $=S.next();if($.done)return[_,e.empty()];_.push($.value)}return[_,{[Symbol.iterator](){return S}}]}e.consume=m;async function v(w){let C=[];for await(let _ of w)C.push(_);return Promise.resolve(C)}e.asyncToArray=v})(sa||(sa={}));bh=!1,bi=null,yh=class ra{constructor(){this.livingDisposables=new Map}getDisposableData(t){let i=this.livingDisposables.get(t);return i||(i={parent:null,source:null,isSingleton:!1,value:t,idx:ra.idx++},this.livingDisposables.set(t,i)),i}trackDisposable(t){let i=this.getDisposableData(t);i.source||(i.source=new Error().stack)}setParent(t,i){let n=this.getDisposableData(t);n.parent=i}markAsDisposed(t){this.livingDisposables.delete(t)}markAsSingleton(t){this.getDisposableData(t).isSingleton=!0}getRootParent(t,i){let n=i.get(t);if(n)return n;let u=t.parent?this.getRootParent(this.getDisposableData(t.parent),i):t;return i.set(t,u),u}getTrackedDisposables(){let t=new Map;return[...this.livingDisposables.entries()].filter(([,i])=>i.source!==null&&!this.getRootParent(i,t).isSingleton).flatMap(([i])=>i)}computeLeakingDisposables(t=10,i){let n;if(i)n=i;else{let p=new Map,d=[...this.livingDisposables.values()].filter(g=>g.source!==null&&!this.getRootParent(g,p).isSingleton);if(d.length===0)return;let f=new Set(d.map(g=>g.value));if(n=d.filter(g=>!(g.parent&&f.has(g.parent))),n.length===0)throw new Error("There are cyclic diposable chains!")}if(!n)return;function u(p){function d(g,y){for(;g.length>0&&y.some(b=>typeof b=="string"?b===g[0]:g[0].match(b));)g.shift()}let f=p.source.split(`
`).map(g=>g.trim().replace("at ","")).filter(g=>g!=="");return d(f,["Error",/^trackDisposable \(.*\)$/,/^DisposableTracker.trackDisposable \(.*\)$/]),f.reverse()}let s=new gh;for(let p of n){let d=u(p);for(let f=0;f<=d.length;f++)s.add(d.slice(0,f).join(`
`),p)}n.sort(fh(p=>p.idx,mh));let r="",l=0;for(let p of n.slice(0,t)){l++;let d=u(p),f=[];for(let g=0;g<d.length;g++){let y=d[g];y=`(shared with ${s.get(d.slice(0,g+1).join(`
`)).size}/${n.length} leaks) at ${y}`;let b=s.get(d.slice(0,g).join(`
`)),o=_h([...b].map(a=>u(a)[g]),a=>a);delete o[d[g]];for(let[a,c]of Object.entries(o))f.unshift(`    - stacktraces of ${c.length} other leaks continue with ${a}`);f.unshift(y)}r+=`


==================== Leaking disposable ${l}/${n.length}: ${p.value.constructor.name} ====================
${f.join(`
`)}
============================================================

`}return n.length>t&&(r+=`


... and ${n.length-t} more leaking disposables

`),{leaks:n,details:r}}};yh.idx=0;if(bh){let e="__is_disposable_tracked__";wh(new class{trackDisposable(t){let i=new Error("Potentially leaked disposable").stack;setTimeout(()=>{t[e]||console.log(i)},3e3)}setParent(t,i){if(t&&t!==nt.None)try{t[e]=!0}catch{}}markAsDisposed(t){if(t&&t!==nt.None)try{t[e]=!0}catch{}}markAsSingleton(t){}})}na=class aa{constructor(){this._toDispose=new Set,this._isDisposed=!1,Ys(this)}dispose(){this._isDisposed||(Js(this),this._isDisposed=!0,this.clear())}get isDisposed(){return this._isDisposed}clear(){if(this._toDispose.size!==0)try{os(this._toDispose)}finally{this._toDispose.clear()}}add(t){if(!t)return t;if(t===this)throw new Error("Cannot register a disposable on itself!");return ns(t,this),this._isDisposed?aa.DISABLE_DISPOSED_WARNING||console.warn(new Error("Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!").stack):this._toDispose.add(t),t}delete(t){if(t){if(t===this)throw new Error("Cannot dispose a disposable on itself!");this._toDispose.delete(t),t.dispose()}}deleteAndLeak(t){t&&this._toDispose.has(t)&&(this._toDispose.delete(t),ns(t,null))}};na.DISABLE_DISPOSED_WARNING=!1;bo=na,nt=class{constructor(){this._store=new bo,Ys(this),ns(this._store,this)}dispose(){Js(this),this._store.dispose()}_register(e){if(e===this)throw new Error("Cannot register a disposable on itself!");return this._store.add(e)}};nt.None=Object.freeze({dispose(){}});Xs=class{constructor(){this._isDisposed=!1,Ys(this)}get value(){return this._isDisposed?void 0:this._value}set value(e){this._isDisposed||e===this._value||(this._value?.dispose(),e&&ns(e,this),this._value=e)}clear(){this.value=void 0}dispose(){this._isDisposed=!0,Js(this),this._value?.dispose(),this._value=void 0}clearAndLeak(){let e=this._value;return this._value=void 0,e&&ns(e,null),e}},Yn=class po{constructor(t){this.element=t,this.next=po.Undefined,this.prev=po.Undefined}};Yn.Undefined=new Yn(void 0);Ch=globalThis.performance&&typeof globalThis.performance.now=="function",xh=class la{static create(t){return new la(t)}constructor(t){this._now=Ch&&t===!1?Date.now:globalThis.performance.now.bind(globalThis.performance),this._startTime=this._now(),this._stopTime=-1}stop(){this._stopTime=this._now()}reset(){this._startTime=this._now(),this._stopTime=-1}elapsed(){return this._stopTime!==-1?this._stopTime-this._startTime:this._now()-this._startTime}},kh=!1,Jn=!1,Eh=!1;(e=>{e.None=()=>nt.None;function t(I){if(Eh){let{onDidAddListener:B}=I,H=_o.create(),x=0;I.onDidAddListener=()=>{++x===2&&(console.warn("snapshotted emitter LIKELY used public and SHOULD HAVE BEEN created with DisposableStore. snapshotted here"),H.print()),B?.()}}}function i(I,B){return y(I,()=>{},0,void 0,!0,void 0,B)}e.defer=i;function n(I){return(B,H=null,x)=>{let E=!1,L;return L=I(R=>{if(!E)return L?L.dispose():E=!0,B.call(H,R)},null,x),E&&L.dispose(),L}}e.once=n;function u(I,B,H){return f((x,E=null,L)=>I(R=>x.call(E,B(R)),null,L),H)}e.map=u;function s(I,B,H){return f((x,E=null,L)=>I(R=>{B(R),x.call(E,R)},null,L),H)}e.forEach=s;function r(I,B,H){return f((x,E=null,L)=>I(R=>B(R)&&x.call(E,R),null,L),H)}e.filter=r;function l(I){return I}e.signal=l;function p(...I){return(B,H=null,x)=>{let E=oa(...I.map(L=>L(R=>B.call(H,R))));return g(E,x)}}e.any=p;function d(I,B,H,x){let E=H;return u(I,L=>(E=B(E,L),E),x)}e.reduce=d;function f(I,B){let H,x={onWillAddFirstListener(){H=I(E.fire,E)},onDidRemoveLastListener(){H?.dispose()}};B||t(x);let E=new ot(x);return B?.add(E),E.event}function g(I,B){return B instanceof Array?B.push(I):B&&B.add(I),I}function y(I,B,H=100,x=!1,E=!1,L,R){let N,j,X,G=0,fe,k={leakWarningThreshold:L,onWillAddFirstListener(){N=I(U=>{G++,j=B(j,U),x&&!X&&(F.fire(j),j=void 0),fe=()=>{let W=j;j=void 0,X=void 0,(!x||G>1)&&F.fire(W),G=0},typeof H=="number"?(clearTimeout(X),X=setTimeout(fe,H)):X===void 0&&(X=0,queueMicrotask(fe))})},onWillRemoveListener(){E&&G>0&&fe?.()},onDidRemoveLastListener(){fe=void 0,N.dispose()}};R||t(k);let F=new ot(k);return R?.add(F),F.event}e.debounce=y;function b(I,B=0,H){return e.debounce(I,(x,E)=>x?(x.push(E),x):[E],B,void 0,!0,void 0,H)}e.accumulate=b;function o(I,B=(x,E)=>x===E,H){let x=!0,E;return r(I,L=>{let R=x||!B(L,E);return x=!1,E=L,R},H)}e.latch=o;function a(I,B,H){return[e.filter(I,B,H),e.filter(I,x=>!B(x),H)]}e.split=a;function c(I,B=!1,H=[],x){let E=H.slice(),L=I(j=>{E?E.push(j):N.fire(j)});x&&x.add(L);let R=()=>{E?.forEach(j=>N.fire(j)),E=null},N=new ot({onWillAddFirstListener(){L||(L=I(j=>N.fire(j)),x&&x.add(L))},onDidAddFirstListener(){E&&(B?setTimeout(R):R())},onDidRemoveLastListener(){L&&L.dispose(),L=null}});return x&&x.add(N),N.event}e.buffer=c;function h(I,B){return(H,x,E)=>{let L=B(new v);return I(function(R){let N=L.evaluate(R);N!==m&&H.call(x,N)},void 0,E)}}e.chain=h;let m=Symbol("HaltChainable");class v{constructor(){this.steps=[]}map(B){return this.steps.push(B),this}forEach(B){return this.steps.push(H=>(B(H),H)),this}filter(B){return this.steps.push(H=>B(H)?H:m),this}reduce(B,H){let x=H;return this.steps.push(E=>(x=B(x,E),x)),this}latch(B=(H,x)=>H===x){let H=!0,x;return this.steps.push(E=>{let L=H||!B(E,x);return H=!1,x=E,L?E:m}),this}evaluate(B){for(let H of this.steps)if(B=H(B),B===m)break;return B}}function w(I,B,H=x=>x){let x=(...N)=>R.fire(H(...N)),E=()=>I.on(B,x),L=()=>I.removeListener(B,x),R=new ot({onWillAddFirstListener:E,onDidRemoveLastListener:L});return R.event}e.fromNodeEventEmitter=w;function C(I,B,H=x=>x){let x=(...N)=>R.fire(H(...N)),E=()=>I.addEventListener(B,x),L=()=>I.removeEventListener(B,x),R=new ot({onWillAddFirstListener:E,onDidRemoveLastListener:L});return R.event}e.fromDOMEventEmitter=C;function _(I){return new Promise(B=>n(I)(B))}e.toPromise=_;function S(I){let B=new ot;return I.then(H=>{B.fire(H)},()=>{B.fire(void 0)}).finally(()=>{B.dispose()}),B.event}e.fromPromise=S;function T(I,B){return I(H=>B.fire(H))}e.forward=T;function $(I,B,H){return B(H),I(x=>B(x))}e.runAndSubscribe=$;class D{constructor(B,H){this._observable=B,this._counter=0,this._hasChanged=!1;let x={onWillAddFirstListener:()=>{B.addObserver(this)},onDidRemoveLastListener:()=>{B.removeObserver(this)}};H||t(x),this.emitter=new ot(x),H&&H.add(this.emitter)}beginUpdate(B){this._counter++}handlePossibleChange(B){}handleChange(B,H){this._hasChanged=!0}endUpdate(B){this._counter--,this._counter===0&&(this._observable.reportChanges(),this._hasChanged&&(this._hasChanged=!1,this.emitter.fire(this._observable.get())))}}function O(I,B){return new D(I,B).emitter.event}e.fromObservable=O;function z(I){return(B,H,x)=>{let E=0,L=!1,R={beginUpdate(){E++},endUpdate(){E--,E===0&&(I.reportChanges(),L&&(L=!1,B.call(H)))},handlePossibleChange(){},handleChange(){L=!0}};I.addObserver(R),I.reportChanges();let N={dispose(){I.removeObserver(R)}};return x instanceof bo?x.add(N):Array.isArray(x)&&x.push(N),N}}e.fromObservableLight=z})(yo||(yo={}));fo=class mo{constructor(t){this.listenerCount=0,this.invocationCount=0,this.elapsedOverall=0,this.durations=[],this.name=`${t}_${mo._idPool++}`,mo.all.add(this)}start(t){this._stopWatch=new xh,this.listenerCount=t}stop(){if(this._stopWatch){let t=this._stopWatch.elapsed();this.durations.push(t),this.elapsedOverall+=t,this.invocationCount+=1,this._stopWatch=void 0}}};fo.all=new Set,fo._idPool=0;Ah=fo,Zn=-1,ca=class ha{constructor(t,i,n=(ha._idPool++).toString(16).padStart(3,"0")){this._errorHandler=t,this.threshold=i,this.name=n,this._warnCountdown=0}dispose(){this._stacks?.clear()}check(t,i){let n=this.threshold;if(n<=0||i<n)return;this._stacks||(this._stacks=new Map);let u=this._stacks.get(t.value)||0;if(this._stacks.set(t.value,u+1),this._warnCountdown-=1,this._warnCountdown<=0){this._warnCountdown=n*.5;let[s,r]=this.getMostFrequentStack(),l=`[${this.name}] potential listener LEAK detected, having ${i} listeners already. MOST frequent listener (${r}):`;console.warn(l),console.warn(s);let p=new Th(l,s);this._errorHandler(p)}return()=>{let s=this._stacks.get(t.value)||0;this._stacks.set(t.value,s-1)}}getMostFrequentStack(){if(!this._stacks)return;let t,i=0;for(let[n,u]of this._stacks)(!t||i<u)&&(t=[n,u],i=u);return t}};ca._idPool=1;Lh=ca,_o=class da{constructor(t){this.value=t}static create(){let t=new Error;return new da(t.stack??"")}print(){console.warn(this.value.split(`
`).slice(2).join(`
`))}},Th=class extends Error{constructor(e,t){super(e),this.name="ListenerLeakError",this.stack=t}},Dh=class extends Error{constructor(e,t){super(e),this.name="ListenerRefusalError",this.stack=t}},Rh=0,Vs=class{constructor(e){this.value=e,this.id=Rh++}},$h=2,Oh=(e,t)=>{if(e instanceof Vs)t(e);else for(let i=0;i<e.length;i++){let n=e[i];n&&t(n)}};if(kh){let e=[];setInterval(()=>{e.length!==0&&(console.warn("[LEAKING LISTENERS] GC'ed these listeners that were NOT yet disposed:"),console.warn(e.join(`
`)),e.length=0)},3e3),qs=new FinalizationRegistry(t=>{typeof t=="string"&&e.push(t)})}ot=class{constructor(e){this._size=0,this._options=e,this._leakageMon=Zn>0||this._options?.leakWarningThreshold?new Lh(e?.onListenerError??no,this._options?.leakWarningThreshold??Zn):void 0,this._perfMon=this._options?._profName?new Ah(this._options._profName):void 0,this._deliveryQueue=this._options?.deliveryQueue}dispose(){if(!this._disposed){if(this._disposed=!0,this._deliveryQueue?.current===this&&this._deliveryQueue.reset(),this._listeners){if(Jn){let e=this._listeners;queueMicrotask(()=>{Oh(e,t=>t.stack?.print())})}this._listeners=void 0,this._size=0}this._options?.onDidRemoveLastListener?.(),this._leakageMon?.dispose()}}get event(){return this._event??(this._event=(e,t,i)=>{if(this._leakageMon&&this._size>this._leakageMon.threshold**2){let l=`[${this._leakageMon.name}] REFUSES to accept new listeners because it exceeded its threshold by far (${this._size} vs ${this._leakageMon.threshold})`;console.warn(l);let p=this._leakageMon.getMostFrequentStack()??["UNKNOWN stack",-1],d=new Dh(`${l}. HINT: Stack shows most frequent listener (${p[1]}-times)`,p[0]);return(this._options?.onListenerError||no)(d),nt.None}if(this._disposed)return nt.None;t&&(e=e.bind(t));let n=new Vs(e),u,s;this._leakageMon&&this._size>=Math.ceil(this._leakageMon.threshold*.2)&&(n.stack=_o.create(),u=this._leakageMon.check(n.stack,this._size+1)),Jn&&(n.stack=s??_o.create()),this._listeners?this._listeners instanceof Vs?(this._deliveryQueue??(this._deliveryQueue=new Mh),this._listeners=[this._listeners,n]):this._listeners.push(n):(this._options?.onWillAddFirstListener?.(this),this._listeners=n,this._options?.onDidAddFirstListener?.(this)),this._size++;let r=yi(()=>{qs?.unregister(r),u?.(),this._removeListener(n)});if(i instanceof bo?i.add(r):Array.isArray(i)&&i.push(r),qs){let l=new Error().stack.split(`
`).slice(2,3).join(`
`).trim(),p=/(file:|vscode-file:\/\/vscode-app)?(\/[^:]*:\d+:\d+)/.exec(l);qs.register(r,p?.[2]??l,r)}return r}),this._event}_removeListener(e){if(this._options?.onWillRemoveListener?.(this),!this._listeners)return;if(this._size===1){this._listeners=void 0,this._options?.onDidRemoveLastListener?.(this),this._size=0;return}let t=this._listeners,i=t.indexOf(e);if(i===-1)throw console.log("disposed?",this._disposed),console.log("size?",this._size),console.log("arr?",JSON.stringify(this._listeners)),new Error("Attempted to dispose unknown listener");this._size--,t[i]=void 0;let n=this._deliveryQueue.current===this;if(this._size*$h<=t.length){let u=0;for(let s=0;s<t.length;s++)t[s]?t[u++]=t[s]:n&&(this._deliveryQueue.end--,u<this._deliveryQueue.i&&this._deliveryQueue.i--);t.length=u}}_deliver(e,t){if(!e)return;let i=this._options?.onListenerError||no;if(!i){e.value(t);return}try{e.value(t)}catch(n){i(n)}}_deliverQueue(e){let t=e.current._listeners;for(;e.i<e.end;)this._deliver(t[e.i++],e.value);e.reset()}fire(e){if(this._deliveryQueue?.current&&(this._deliverQueue(this._deliveryQueue),this._perfMon?.stop()),this._perfMon?.start(this._size),this._listeners)if(this._listeners instanceof Vs)this._deliver(this._listeners,e);else{let t=this._deliveryQueue;t.enqueue(this,e,this._listeners.length),this._deliverQueue(t)}this._perfMon?.stop()}hasListeners(){return this._size>0}},Mh=class{constructor(){this.i=-1,this.end=0}enqueue(e,t,i){this.i=0,this.end=i,this.current=e,this.value=t}reset(){this.i=this.end,this.current=void 0,this.value=void 0}},ua=Object.freeze(function(e,t){let i=setTimeout(e.bind(t),0);return{dispose(){clearTimeout(i)}}});(e=>{function t(i){return i===e.None||i===e.Cancelled||i instanceof Ph?!0:!i||typeof i!="object"?!1:typeof i.isCancellationRequested=="boolean"&&typeof i.onCancellationRequested=="function"}e.isCancellationToken=t,e.None=Object.freeze({isCancellationRequested:!1,onCancellationRequested:yo.None}),e.Cancelled=Object.freeze({isCancellationRequested:!0,onCancellationRequested:ua})})(Bh||(Bh={}));Ph=class{constructor(){this._isCancelled=!1,this._emitter=null}cancel(){this._isCancelled||(this._isCancelled=!0,this._emitter&&(this._emitter.fire(void 0),this.dispose()))}get isCancellationRequested(){return this._isCancelled}get onCancellationRequested(){return this._isCancelled?ua:(this._emitter||(this._emitter=new ot),this._emitter.event)}dispose(){this._emitter&&(this._emitter.dispose(),this._emitter=null)}},vi="en",go=!1,vo=!1,Ks=!1,Ih=!1,Hh=!1,pa=!1,Fh=!1,zh=!1,Nh=!1,Wh=!1,Gs=vi,Qn=vi,mt=globalThis;typeof mt.vscode<"u"&&typeof mt.vscode.process<"u"?Ne=mt.vscode.process:typeof process<"u"&&typeof process?.versions?.node=="string"&&(Ne=process);fa=typeof Ne?.versions?.electron=="string",jh=fa&&Ne?.type==="renderer";if(typeof Ne=="object"){go=Ne.platform==="win32",vo=Ne.platform==="darwin",Ks=Ne.platform==="linux",Ih=Ks&&!!Ne.env.SNAP&&!!Ne.env.SNAP_REVISION,Fh=fa,Nh=!!Ne.env.CI||!!Ne.env.BUILD_ARTIFACTSTAGINGDIRECTORY,js=vi,Gs=vi;let e=Ne.env.VSCODE_NLS_CONFIG;if(e)try{let t=JSON.parse(e);js=t.userLocale,Qn=t.osLocale,Gs=t.resolvedLanguage||vi,Uh=t.languagePack?.translationsConfigFile}catch{}Hh=!0}else typeof navigator=="object"&&!jh?(ft=navigator.userAgent,go=ft.indexOf("Windows")>=0,vo=ft.indexOf("Macintosh")>=0,zh=(ft.indexOf("Macintosh")>=0||ft.indexOf("iPad")>=0||ft.indexOf("iPhone")>=0)&&!!navigator.maxTouchPoints&&navigator.maxTouchPoints>0,Ks=ft.indexOf("Linux")>=0,Wh=ft?.indexOf("Mobi")>=0,pa=!0,Gs=globalThis._VSCODE_NLS_LANGUAGE||vi,js=navigator.language.toLowerCase(),Qn=js):console.error("Unable to resolve platform.");ao=0;vo?ao=1:go?ao=3:Ks&&(ao=2);Vh=pa&&typeof mt.importScripts=="function",Km=Vh?mt.origin:void 0,at=ft,Et=Gs;(e=>{function t(){return Et}e.value=t;function i(){return Et.length===2?Et==="en":Et.length>=3?Et[0]==="e"&&Et[1]==="n"&&Et[2]==="-":!1}e.isDefaultVariant=i;function n(){return Et==="en"}e.isDefault=n})(qh||(qh={}));Kh=typeof mt.postMessage=="function"&&!mt.importScripts,Gh=(()=>{if(Kh){let e=[];mt.addEventListener("message",i=>{if(i.data&&i.data.vscodeScheduleAsyncWork)for(let n=0,u=e.length;n<u;n++){let s=e[n];if(s.id===i.data.vscodeScheduleAsyncWork){e.splice(n,1),s.callback();return}}});let t=0;return i=>{let n=++t;e.push({id:n,callback:i}),mt.postMessage({vscodeScheduleAsyncWork:n},"*")}}return e=>setTimeout(e)})(),Xh=!!(at&&at.indexOf("Chrome")>=0),Gm=!!(at&&at.indexOf("Firefox")>=0),Xm=!!(!Xh&&at&&at.indexOf("Safari")>=0),Ym=!!(at&&at.indexOf("Edg/")>=0),Jm=!!(at&&at.indexOf("Android")>=0);(function(){typeof globalThis.requestIdleCallback!="function"||typeof globalThis.cancelIdleCallback!="function"?lo=(e,t)=>{Gh(()=>{if(i)return;let n=Date.now()+15;t(Object.freeze({didTimeout:!0,timeRemaining(){return Math.max(0,n-Date.now())}}))});let i=!1;return{dispose(){i||(i=!0)}}}:lo=(e,t,i)=>{let n=e.requestIdleCallback(t,typeof i=="number"?{timeout:i}:void 0),u=!1;return{dispose(){u||(u=!0,e.cancelIdleCallback(n))}}},Yh=e=>lo(globalThis,e)})();(e=>{async function t(n){let u,s=await Promise.all(n.map(r=>r.then(l=>l,l=>{u||(u=l)})));if(typeof u<"u")throw u;return s}e.settled=t;function i(n){return new Promise(async(u,s)=>{try{await n(u,s)}catch(r){s(r)}})}e.withAsyncBody=i})(Jh||(Jh={}));ea=class qe{static fromArray(t){return new qe(i=>{i.emitMany(t)})}static fromPromise(t){return new qe(async i=>{i.emitMany(await t)})}static fromPromises(t){return new qe(async i=>{await Promise.all(t.map(async n=>i.emitOne(await n)))})}static merge(t){return new qe(async i=>{await Promise.all(t.map(async n=>{for await(let u of n)i.emitOne(u)}))})}constructor(t,i){this._state=0,this._results=[],this._error=null,this._onReturn=i,this._onStateChanged=new ot,queueMicrotask(async()=>{let n={emitOne:u=>this.emitOne(u),emitMany:u=>this.emitMany(u),reject:u=>this.reject(u)};try{await Promise.resolve(t(n)),this.resolve()}catch(u){this.reject(u)}finally{n.emitOne=void 0,n.emitMany=void 0,n.reject=void 0}})}[Symbol.asyncIterator](){let t=0;return{next:async()=>{do{if(this._state===2)throw this._error;if(t<this._results.length)return{done:!1,value:this._results[t++]};if(this._state===1)return{done:!0,value:void 0};await yo.toPromise(this._onStateChanged.event)}while(!0)},return:async()=>(this._onReturn?.(),{done:!0,value:void 0})}}static map(t,i){return new qe(async n=>{for await(let u of t)n.emitOne(i(u))})}map(t){return qe.map(this,t)}static filter(t,i){return new qe(async n=>{for await(let u of t)i(u)&&n.emitOne(u)})}filter(t){return qe.filter(this,t)}static coalesce(t){return qe.filter(t,i=>!!i)}coalesce(){return qe.coalesce(this)}static async toPromise(t){let i=[];for await(let n of t)i.push(n);return i}toPromise(){return qe.toPromise(this)}emitOne(t){this._state===0&&(this._results.push(t),this._onStateChanged.fire())}emitMany(t){this._state===0&&(this._results=this._results.concat(t),this._onStateChanged.fire())}resolve(){this._state===0&&(this._state=1,this._onStateChanged.fire())}reject(t){this._state===0&&(this._state=2,this._error=t,this._onStateChanged.fire())}};ea.EMPTY=ea.fromArray([]);Zh=class extends nt{constructor(e){super(),this._terminal=e,this._linesCacheTimeout=this._register(new Xs),this._linesCacheDisposables=this._register(new Xs),this._register(yi(()=>this._destroyLinesCache()))}initLinesCache(){this._linesCache||(this._linesCache=new Array(this._terminal.buffer.active.length),this._linesCacheDisposables.value=oa(this._terminal.onLineFeed(()=>this._destroyLinesCache()),this._terminal.onCursorMove(()=>this._destroyLinesCache()),this._terminal.onResize(()=>this._destroyLinesCache()))),this._linesCacheTimeout.value=ma(()=>this._destroyLinesCache(),15e3)}_destroyLinesCache(){this._linesCache=void 0,this._linesCacheDisposables.clear(),this._linesCacheTimeout.clear()}getLineFromCache(e){return this._linesCache?.[e]}setLineInCache(e,t){this._linesCache&&(this._linesCache[e]=t)}translateBufferLineToStringWithWrap(e,t){let i=[],n=[0],u=this._terminal.buffer.active.getLine(e);for(;u;){let s=this._terminal.buffer.active.getLine(e+1),r=s?s.isWrapped:!1,l=u.translateToString(!r&&t);if(r&&s){let p=u.getCell(u.length-1);p&&p.getCode()===0&&p.getWidth()===1&&s.getCell(0)?.getWidth()===2&&(l=l.slice(0,-1))}if(i.push(l),r)n.push(n[n.length-1]+l.length);else break;e++,u=s}return[i.join(""),n]}},Qh=class{get cachedSearchTerm(){return this._cachedSearchTerm}set cachedSearchTerm(e){this._cachedSearchTerm=e}get lastSearchOptions(){return this._lastSearchOptions}set lastSearchOptions(e){this._lastSearchOptions=e}isValidSearchTerm(e){return!!(e&&e.length>0)}didOptionsChange(e){return this._lastSearchOptions?e?this._lastSearchOptions.caseSensitive!==e.caseSensitive||this._lastSearchOptions.regex!==e.regex||this._lastSearchOptions.wholeWord!==e.wholeWord:!1:!0}shouldUpdateHighlighting(e,t){return t?.decorations?this._cachedSearchTerm===void 0||e!==this._cachedSearchTerm||this.didOptionsChange(t):!1}clearCachedTerm(){this._cachedSearchTerm=void 0}reset(){this._cachedSearchTerm=void 0,this._lastSearchOptions=void 0}},ed=class{constructor(e,t){this._terminal=e,this._lineCache=t}find(e,t,i,n){if(!e||e.length===0){this._terminal.clearSelection();return}if(i>this._terminal.cols)throw new Error(`Invalid col: ${i} to search in terminal of ${this._terminal.cols} cols`);this._lineCache.initLinesCache();let u={startRow:t,startCol:i},s=this._findInLine(e,u,n);if(!s)for(let r=t+1;r<this._terminal.buffer.active.baseY+this._terminal.rows&&(u.startRow=r,u.startCol=0,s=this._findInLine(e,u,n),!s);r++);return s}findNextWithSelection(e,t,i){if(!e||e.length===0){this._terminal.clearSelection();return}let n=this._terminal.getSelectionPosition();this._terminal.clearSelection();let u=0,s=0;n&&(i===e?(u=n.end.x,s=n.end.y):(u=n.start.x,s=n.start.y)),this._lineCache.initLinesCache();let r={startRow:s,startCol:u},l=this._findInLine(e,r,t);if(!l)for(let p=s+1;p<this._terminal.buffer.active.baseY+this._terminal.rows&&(r.startRow=p,r.startCol=0,l=this._findInLine(e,r,t),!l);p++);if(!l&&s!==0)for(let p=0;p<s&&(r.startRow=p,r.startCol=0,l=this._findInLine(e,r,t),!l);p++);return!l&&n&&(r.startRow=n.start.y,r.startCol=0,l=this._findInLine(e,r,t)),l}findPreviousWithSelection(e,t,i){if(!e||e.length===0){this._terminal.clearSelection();return}let n=this._terminal.getSelectionPosition();this._terminal.clearSelection();let u=this._terminal.buffer.active.baseY+this._terminal.rows-1,s=this._terminal.cols,r=!0;this._lineCache.initLinesCache();let l={startRow:u,startCol:s},p;if(n&&(l.startRow=u=n.start.y,l.startCol=s=n.start.x,i!==e&&(p=this._findInLine(e,l,t,!1),p||(l.startRow=u=n.end.y,l.startCol=s=n.end.x))),p||(p=this._findInLine(e,l,t,r)),!p){l.startCol=Math.max(l.startCol,this._terminal.cols);for(let d=u-1;d>=0&&(l.startRow=d,p=this._findInLine(e,l,t,r),!p);d--);}if(!p&&u!==this._terminal.buffer.active.baseY+this._terminal.rows-1)for(let d=this._terminal.buffer.active.baseY+this._terminal.rows-1;d>=u&&(l.startRow=d,p=this._findInLine(e,l,t,r),!p);d--);return p}_isWholeWord(e,t,i){return(e===0||" ~!@#$%^&*()+`-=[]{}|\\;:\"',./<>?".includes(t[e-1]))&&(e+i.length===t.length||" ~!@#$%^&*()+`-=[]{}|\\;:\"',./<>?".includes(t[e+i.length]))}_findInLine(e,t,i={},n=!1){let u=t.startRow,s=t.startCol;if(this._terminal.buffer.active.getLine(u)?.isWrapped){if(n){t.startCol+=this._terminal.cols;return}return t.startRow--,t.startCol+=this._terminal.cols,this._findInLine(e,t,i)}let r=this._lineCache.getLineFromCache(u);r||(r=this._lineCache.translateBufferLineToStringWithWrap(u,!0),this._lineCache.setLineInCache(u,r));let[l,p]=r,d=this._bufferColsToStringOffset(u,s),f=e,g=l;i.regex||(f=i.caseSensitive?e:e.toLowerCase(),g=i.caseSensitive?l:l.toLowerCase());let y=-1;if(i.regex){let b=RegExp(f,i.caseSensitive?"g":"gi"),o;if(n)for(;o=b.exec(g.slice(0,d));)y=b.lastIndex-o[0].length,e=o[0],b.lastIndex-=e.length-1;else o=b.exec(g.slice(d)),o&&o[0].length>0&&(y=d+(b.lastIndex-o[0].length),e=o[0])}else n?d-f.length>=0&&(y=g.lastIndexOf(f,d-f.length)):y=g.indexOf(f,d);if(y>=0){if(i.wholeWord&&!this._isWholeWord(y,g,e))return;let b=0;for(;b<p.length-1&&y>=p[b+1];)b++;let o=b;for(;o<p.length-1&&y+e.length>=p[o+1];)o++;let a=y-p[b],c=y+e.length-p[o],h=this._stringLengthToBufferSize(u+b,a),m=this._stringLengthToBufferSize(u+o,c)-h+this._terminal.cols*(o-b);return{term:e,col:h,row:u+b,size:m}}}_stringLengthToBufferSize(e,t){let i=this._terminal.buffer.active.getLine(e);if(!i)return 0;for(let n=0;n<t;n++){let u=i.getCell(n);if(!u)break;let s=u.getChars();s.length>1&&(t-=s.length-1);let r=i.getCell(n+1);r&&r.getWidth()===0&&t++}return t}_bufferColsToStringOffset(e,t){let i=e,n=0,u=this._terminal.buffer.active.getLine(i);for(;t>0&&u;){for(let s=0;s<t&&s<this._terminal.cols;s++){let r=u.getCell(s);if(!r)break;r.getWidth()&&(n+=r.getCode()===0?1:r.getChars().length)}if(i++,u=this._terminal.buffer.active.getLine(i),u&&!u.isWrapped)break;t-=this._terminal.cols}return n}},td=class extends nt{constructor(e){super(),this._terminal=e,this._highlightDecorations=[],this._highlightedLines=new Set,this._register(yi(()=>this.clearHighlightDecorations()))}createHighlightDecorations(e,t){this.clearHighlightDecorations();for(let i of e){let n=this._createResultDecorations(i,t,!1);if(n)for(let u of n)this._storeDecoration(u,i)}}createActiveDecoration(e,t){let i=this._createResultDecorations(e,t,!0);if(i)return{decorations:i,match:e,dispose(){os(i)}}}clearHighlightDecorations(){os(this._highlightDecorations),this._highlightDecorations=[],this._highlightedLines.clear()}_storeDecoration(e,t){this._highlightedLines.add(e.marker.line),this._highlightDecorations.push({decoration:e,match:t,dispose(){e.dispose()}})}_applyStyles(e,t,i){e.classList.contains("xterm-find-result-decoration")||(e.classList.add("xterm-find-result-decoration"),t&&(e.style.outline=`1px solid ${t}`)),i&&e.classList.add("xterm-find-active-result-decoration")}_createResultDecorations(e,t,i){let n=[],u=e.col,s=e.size,r=-this._terminal.buffer.active.baseY-this._terminal.buffer.active.cursorY+e.row;for(;s>0;){let p=Math.min(this._terminal.cols-u,s);n.push([r,u,p]),u=0,s-=p,r++}let l=[];for(let p of n){let d=this._terminal.registerMarker(p[0]),f=this._terminal.registerDecoration({marker:d,x:p[1],width:p[2],backgroundColor:i?t.activeMatchBackground:t.matchBackground,overviewRulerOptions:this._highlightedLines.has(d.line)?void 0:{color:i?t.activeMatchColorOverviewRuler:t.matchOverviewRuler,position:"center"}});if(f){let g=[];g.push(d),g.push(f.onRender(y=>this._applyStyles(y,i?t.activeMatchBorder:t.matchBorder,!1))),g.push(f.onDispose(()=>os(g))),l.push(f)}}return l.length===0?void 0:l}},id=class extends nt{constructor(){super(...arguments),this._searchResults=[],this._onDidChangeResults=this._register(new ot)}get onDidChangeResults(){return this._onDidChangeResults.event}get searchResults(){return this._searchResults}get selectedDecoration(){return this._selectedDecoration}set selectedDecoration(e){this._selectedDecoration=e}updateResults(e,t){this._searchResults=e.slice(0,t)}clearResults(){this._searchResults=[]}clearSelectedDecoration(){this._selectedDecoration&&(this._selectedDecoration.dispose(),this._selectedDecoration=void 0)}findResultIndex(e){for(let t=0;t<this._searchResults.length;t++){let i=this._searchResults[t];if(i.row===e.row&&i.col===e.col&&i.size===e.size)return t}return-1}fireResultsChanged(e){if(!e)return;let t=-1;this._selectedDecoration&&(t=this.findResultIndex(this._selectedDecoration.match)),this._onDidChangeResults.fire({resultIndex:t,resultCount:this._searchResults.length})}reset(){this.clearSelectedDecoration(),this.clearResults()}},sd=class extends nt{constructor(e){super(),this._highlightTimeout=this._register(new Xs),this._lineCache=this._register(new Xs),this._state=new Qh,this._resultTracker=this._register(new id),this._highlightLimit=e?.highlightLimit??1e3}get onDidChangeResults(){return this._resultTracker.onDidChangeResults}activate(e){this._terminal=e,this._lineCache.value=new Zh(e),this._engine=new ed(e,this._lineCache.value),this._decorationManager=new td(e),this._register(this._terminal.onWriteParsed(()=>this._updateMatches())),this._register(this._terminal.onResize(()=>this._updateMatches())),this._register(yi(()=>this.clearDecorations()))}_updateMatches(){this._highlightTimeout.clear(),this._state.cachedSearchTerm&&this._state.lastSearchOptions?.decorations&&(this._highlightTimeout.value=ma(()=>{let e=this._state.cachedSearchTerm;this._state.clearCachedTerm(),this.findPrevious(e,{...this._state.lastSearchOptions,incremental:!0},{noScroll:!0})},200))}clearDecorations(e){this._resultTracker.clearSelectedDecoration(),this._decorationManager?.clearHighlightDecorations(),this._resultTracker.clearResults(),e||this._state.clearCachedTerm()}clearActiveDecoration(){this._resultTracker.clearSelectedDecoration()}findNext(e,t,i){if(!this._terminal||!this._engine)throw new Error("Cannot use addon until it has been loaded");this._state.lastSearchOptions=t,this._state.shouldUpdateHighlighting(e,t)&&this._highlightAllMatches(e,t);let n=this._findNextAndSelect(e,t,i);return this._fireResults(t),this._state.cachedSearchTerm=e,n}_highlightAllMatches(e,t){if(!this._terminal||!this._engine||!this._decorationManager)throw new Error("Cannot use addon until it has been loaded");if(!this._state.isValidSearchTerm(e)){this.clearDecorations();return}this.clearDecorations(!0);let i=[],n,u=this._engine.find(e,0,0,t);for(;u&&(n?.row!==u.row||n?.col!==u.col)&&!(i.length>=this._highlightLimit);)n=u,i.push(n),u=this._engine.find(e,n.col+n.term.length>=this._terminal.cols?n.row+1:n.row,n.col+n.term.length>=this._terminal.cols?0:n.col+1,t);this._resultTracker.updateResults(i,this._highlightLimit),t.decorations&&this._decorationManager.createHighlightDecorations(i,t.decorations)}_findNextAndSelect(e,t,i){if(!this._terminal||!this._engine)return!1;if(!this._state.isValidSearchTerm(e))return this._terminal.clearSelection(),this.clearDecorations(),!1;let n=this._engine.findNextWithSelection(e,t,this._state.cachedSearchTerm);return this._selectResult(n,t?.decorations,i?.noScroll)}findPrevious(e,t,i){if(!this._terminal||!this._engine)throw new Error("Cannot use addon until it has been loaded");this._state.lastSearchOptions=t,this._state.shouldUpdateHighlighting(e,t)&&this._highlightAllMatches(e,t);let n=this._findPreviousAndSelect(e,t,i);return this._fireResults(t),this._state.cachedSearchTerm=e,n}_fireResults(e){this._resultTracker.fireResultsChanged(!!e?.decorations)}_findPreviousAndSelect(e,t,i){if(!this._terminal||!this._engine)return!1;if(!this._state.isValidSearchTerm(e))return this._terminal.clearSelection(),this.clearDecorations(),!1;let n=this._engine.findPreviousWithSelection(e,t,this._state.cachedSearchTerm);return this._selectResult(n,t?.decorations,i?.noScroll)}_selectResult(e,t,i){if(!this._terminal||!this._decorationManager)return!1;if(this._resultTracker.clearSelectedDecoration(),!e)return this._terminal.clearSelection(),!1;if(this._terminal.select(e.col,e.row,e.size),t){let n=this._decorationManager.createActiveDecoration(e,t);n&&(this._resultTracker.selectedDecoration=n)}if(!i&&(e.row>=this._terminal.buffer.active.viewportY+this._terminal.rows||e.row<this._terminal.buffer.active.viewportY)){let n=e.row-this._terminal.buffer.active.viewportY;n-=Math.floor(this._terminal.rows/2),this._terminal.scrollLines(n)}return!0}}});var Wi=globalThis,dn=e=>e,Ds=Wi.trustedTypes,un=Ds?Ds.createPolicy("lit-html",{createHTML:e=>e}):void 0,Rr="$lit$",ut=`lit$${Math.random().toFixed(9).slice(2)}$`,$r="?"+ut,Tc=`<${$r}>`,It=document,Ui=()=>It.createComment(""),ji=e=>e===null||typeof e!="object"&&typeof e!="function",Or=Array.isArray,vn=e=>Or(e)||typeof e?.[Symbol.iterator]=="function",Dr=`[ 	
\f\r]`,Ni=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,pn=/-->/g,fn=/>/g,Bt=RegExp(`>|${Dr}(?:([^\\s"'>=/]+)(${Dr}*=${Dr}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),mn=/'/g,_n=/"/g,bn=/^(?:script|style|textarea|title)$/i,Mr=e=>(t,...i)=>({_$litType$:e,strings:t,values:i}),P=Mr(1),yn=Mr(2),wn=Mr(3),Re=Symbol.for("lit-noChange"),V=Symbol.for("lit-nothing"),gn=new WeakMap,Pt=It.createTreeWalker(It,129);function Sn(e,t){if(!Or(e)||!e.hasOwnProperty("raw"))throw Error("invalid template strings array");return un!==void 0?un.createHTML(t):t}var Cn=(e,t)=>{let i=e.length-1,n=[],u,s=t===2?"<svg>":t===3?"<math>":"",r=Ni;for(let l=0;l<i;l++){let p=e[l],d,f,g=-1,y=0;for(;y<p.length&&(r.lastIndex=y,f=r.exec(p),f!==null);)y=r.lastIndex,r===Ni?f[1]==="!--"?r=pn:f[1]!==void 0?r=fn:f[2]!==void 0?(bn.test(f[2])&&(u=RegExp("</"+f[2],"g")),r=Bt):f[3]!==void 0&&(r=Bt):r===Bt?f[0]===">"?(r=u??Ni,g=-1):f[1]===void 0?g=-2:(g=r.lastIndex-f[2].length,d=f[1],r=f[3]===void 0?Bt:f[3]==='"'?_n:mn):r===_n||r===mn?r=Bt:r===pn||r===fn?r=Ni:(r=Bt,u=void 0);let b=r===Bt&&e[l+1].startsWith("/>")?" ":"";s+=r===Ni?p+Tc:g>=0?(n.push(d),p.slice(0,g)+Rr+p.slice(g)+ut+b):p+ut+(g===-2?l:b)}return[Sn(e,s+(e[i]||"<?>")+(t===2?"</svg>":t===3?"</math>":"")),n]},Vi=class e{constructor({strings:t,_$litType$:i},n){let u;this.parts=[];let s=0,r=0,l=t.length-1,p=this.parts,[d,f]=Cn(t,i);if(this.el=e.createElement(d,n),Pt.currentNode=this.el.content,i===2||i===3){let g=this.el.content.firstChild;g.replaceWith(...g.childNodes)}for(;(u=Pt.nextNode())!==null&&p.length<l;){if(u.nodeType===1){if(u.hasAttributes())for(let g of u.getAttributeNames())if(g.endsWith(Rr)){let y=f[r++],b=u.getAttribute(g).split(ut),o=/([.?@])?(.*)/.exec(y);p.push({type:1,index:s,name:o[2],strings:b,ctor:o[1]==="."?$s:o[1]==="?"?Os:o[1]==="@"?Ms:Ft}),u.removeAttribute(g)}else g.startsWith(ut)&&(p.push({type:6,index:s}),u.removeAttribute(g));if(bn.test(u.tagName)){let g=u.textContent.split(ut),y=g.length-1;if(y>0){u.textContent=Ds?Ds.emptyScript:"";for(let b=0;b<y;b++)u.append(g[b],Ui()),Pt.nextNode(),p.push({type:2,index:++s});u.append(g[y],Ui())}}}else if(u.nodeType===8)if(u.data===$r)p.push({type:2,index:s});else{let g=-1;for(;(g=u.data.indexOf(ut,g+1))!==-1;)p.push({type:7,index:s}),g+=ut.length-1}s++}}static createElement(t,i){let n=It.createElement("template");return n.innerHTML=t,n}};function Ht(e,t,i=e,n){if(t===Re)return t;let u=n!==void 0?i._$Co?.[n]:i._$Cl,s=ji(t)?void 0:t._$litDirective$;return u?.constructor!==s&&(u?._$AO?.(!1),s===void 0?u=void 0:(u=new s(e),u._$AT(e,i,n)),n!==void 0?(i._$Co??(i._$Co=[]))[n]=u:i._$Cl=u),u!==void 0&&(t=Ht(e,u._$AS(e,t.values),u,n)),t}var Rs=class{constructor(t,i){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=i}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){let{el:{content:i},parts:n}=this._$AD,u=(t?.creationScope??It).importNode(i,!0);Pt.currentNode=u;let s=Pt.nextNode(),r=0,l=0,p=n[0];for(;p!==void 0;){if(r===p.index){let d;p.type===2?d=new hi(s,s.nextSibling,this,t):p.type===1?d=new p.ctor(s,p.name,p.strings,this,t):p.type===6&&(d=new Bs(s,this,t)),this._$AV.push(d),p=n[++l]}r!==p?.index&&(s=Pt.nextNode(),r++)}return Pt.currentNode=It,u}p(t){let i=0;for(let n of this._$AV)n!==void 0&&(n.strings!==void 0?(n._$AI(t,n,i),i+=n.strings.length-2):n._$AI(t[i])),i++}},hi=class e{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,i,n,u){this.type=2,this._$AH=V,this._$AN=void 0,this._$AA=t,this._$AB=i,this._$AM=n,this.options=u,this._$Cv=u?.isConnected??!0}get parentNode(){let t=this._$AA.parentNode,i=this._$AM;return i!==void 0&&t?.nodeType===11&&(t=i.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,i=this){t=Ht(this,t,i),ji(t)?t===V||t==null||t===""?(this._$AH!==V&&this._$AR(),this._$AH=V):t!==this._$AH&&t!==Re&&this._(t):t._$litType$!==void 0?this.$(t):t.nodeType!==void 0?this.T(t):vn(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==V&&ji(this._$AH)?this._$AA.nextSibling.data=t:this.T(It.createTextNode(t)),this._$AH=t}$(t){let{values:i,_$litType$:n}=t,u=typeof n=="number"?this._$AC(t):(n.el===void 0&&(n.el=Vi.createElement(Sn(n.h,n.h[0]),this.options)),n);if(this._$AH?._$AD===u)this._$AH.p(i);else{let s=new Rs(u,this),r=s.u(this.options);s.p(i),this.T(r),this._$AH=s}}_$AC(t){let i=gn.get(t.strings);return i===void 0&&gn.set(t.strings,i=new Vi(t)),i}k(t){Or(this._$AH)||(this._$AH=[],this._$AR());let i=this._$AH,n,u=0;for(let s of t)u===i.length?i.push(n=new e(this.O(Ui()),this.O(Ui()),this,this.options)):n=i[u],n._$AI(s),u++;u<i.length&&(this._$AR(n&&n._$AB.nextSibling,u),i.length=u)}_$AR(t=this._$AA.nextSibling,i){for(this._$AP?.(!1,!0,i);t!==this._$AB;){let n=dn(t).nextSibling;dn(t).remove(),t=n}}setConnected(t){this._$AM===void 0&&(this._$Cv=t,this._$AP?.(t))}},Ft=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,i,n,u,s){this.type=1,this._$AH=V,this._$AN=void 0,this.element=t,this.name=i,this._$AM=u,this.options=s,n.length>2||n[0]!==""||n[1]!==""?(this._$AH=Array(n.length-1).fill(new String),this.strings=n):this._$AH=V}_$AI(t,i=this,n,u){let s=this.strings,r=!1;if(s===void 0)t=Ht(this,t,i,0),r=!ji(t)||t!==this._$AH&&t!==Re,r&&(this._$AH=t);else{let l=t,p,d;for(t=s[0],p=0;p<s.length-1;p++)d=Ht(this,l[n+p],i,p),d===Re&&(d=this._$AH[p]),r||(r=!ji(d)||d!==this._$AH[p]),d===V?t=V:t!==V&&(t+=(d??"")+s[p+1]),this._$AH[p]=d}r&&!u&&this.j(t)}j(t){t===V?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"")}},$s=class extends Ft{constructor(){super(...arguments),this.type=3}j(t){this.element[this.name]=t===V?void 0:t}},Os=class extends Ft{constructor(){super(...arguments),this.type=4}j(t){this.element.toggleAttribute(this.name,!!t&&t!==V)}},Ms=class extends Ft{constructor(t,i,n,u,s){super(t,i,n,u,s),this.type=5}_$AI(t,i=this){if((t=Ht(this,t,i,0)??V)===Re)return;let n=this._$AH,u=t===V&&n!==V||t.capture!==n.capture||t.once!==n.once||t.passive!==n.passive,s=t!==V&&(n===V||u);u&&this.element.removeEventListener(this.name,this,n),s&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t)}},Bs=class{constructor(t,i,n){this.element=t,this.type=6,this._$AN=void 0,this._$AM=i,this.options=n}get _$AU(){return this._$AM._$AU}_$AI(t){Ht(this,t)}},xn={M:Rr,P:ut,A:$r,C:1,L:Cn,R:Rs,D:vn,V:Ht,I:hi,H:Ft,N:Os,U:Ms,B:$s,F:Bs},Dc=Wi.litHtmlPolyfillSupport;Dc?.(Vi,hi),(Wi.litHtmlVersions??(Wi.litHtmlVersions=[])).push("3.3.2");var Ps=(e,t,i)=>{let n=i?.renderBefore??t,u=n._$litPart$;if(u===void 0){let s=i?.renderBefore??null;n._$litPart$=u=new hi(t.insertBefore(Ui(),s),s,void 0,i??{})}return u._$AI(e),u};function kn(e={}){let t={activeRunId:e.activeRunId??null,runs:e.runs??{},logLines:e.logLines??[],preferences:{theme:e.preferences?.theme??"light",sidebarCollapsed:e.preferences?.sidebarCollapsed??!1,notifications:e.preferences?.notifications??null}},i=new Set;function n(){for(let u of Array.from(i))try{u(t)}catch{}}return{getState(){return t},setState(u){let s={...t,...u,preferences:{...t.preferences,...u.preferences||{}}};s.activeRunId===t.activeRunId&&s.runs===t.runs&&s.logLines===t.logLines&&s.preferences.theme===t.preferences.theme&&s.preferences.sidebarCollapsed===t.preferences.sidebarCollapsed&&s.preferences.notifications===t.preferences.notifications||(t=s,n())},setRun(u,s){let r={...t.runs,[u]:s};t={...t,runs:r},n()},appendLog(u){let s=[...t.logLines,u];s.length>5e3&&s.splice(0,s.length-5e3),t={...t,logLines:s},n()},clearLog(){t={...t,logLines:[]},n()},subscribe(u){return i.add(u),()=>i.delete(u)}}}var En=["subscribe-run","unsubscribe-run","subscribe-log","unsubscribe-log","list-runs","get-agent-prompt","get-preferences","set-preferences","stop-run","resume-run","run-snapshot","run-update","runs-list","log-line","log-bulk","preferences","run-started","run-stopped","stage-restarted"];function Br(){let e=Date.now().toString(36),t=Math.random().toString(36).slice(2,8);return`${e}-${t}`}function An(e,t,i=Br()){return{id:i,type:e,payload:t}}function Ln(e={}){let t={initialMs:e.backoff?.initialMs??1e3,maxMs:e.backoff?.maxMs??3e4,factor:e.backoff?.factor??2,jitterRatio:e.backoff?.jitterRatio??.2},i=()=>e.url&&e.url.length>0?e.url:typeof location<"u"?(location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws":"ws://localhost/ws",n=null,u="closed",s=0,r=null,l=!0,p=new Map,d=[],f=new Map,g=new Set;function y(v){for(let w of Array.from(g))try{w(v)}catch{}}function b(){if(!l||r)return;u="reconnecting",y(u);let v=Math.min(t.maxMs,t.initialMs*Math.pow(t.factor,s)),w=t.jitterRatio*v,C=Math.max(0,Math.round(v+(Math.random()*2-1)*w));r=setTimeout(()=>{r=null,m()},C)}function o(v){try{n?.send(JSON.stringify(v))}catch{}}function a(){for(u="open",y(u),s=0;d.length;){let v=d.shift();v&&o(v)}}function c(v){let w;try{w=JSON.parse(String(v.data))}catch{return}if(!w||typeof w.id!="string"||typeof w.type!="string")return;if(p.has(w.id)){let _=p.get(w.id);p.delete(w.id),w.ok?_?.resolve(w.payload):_?.reject(w.error||new Error("ws error"));return}let C=f.get(w.type);if(C&&C.size>0)for(let _ of Array.from(C))try{_(w.payload)}catch{}}function h(){u="closed",y(u);for(let[v,w]of p.entries())w.reject(new Error("ws disconnected")),p.delete(v);s+=1,b()}function m(){if(!l)return;let v=i();try{n=new WebSocket(v),u="connecting",y(u),n.addEventListener("open",a),n.addEventListener("message",c),n.addEventListener("error",()=>{}),n.addEventListener("close",h)}catch{b()}}return m(),{send(v,w){if(!En.includes(v))return Promise.reject(new Error(`unknown message type: ${v}`));let C=Br(),_=An(v,w,C);return new Promise((S,T)=>{p.set(C,{resolve:S,reject:T,type:v}),n&&n.readyState===n.OPEN?o(_):d.push(_)})},on(v,w){f.has(v)||f.set(v,new Set);let C=f.get(v);return C?.add(w),()=>{C?.delete(w)}},onConnection(v){return g.add(v),()=>{g.delete(v)}},close(){l=!1,r&&(clearTimeout(r),r=null);try{n?.close()}catch{}},getState(){return u}}}function Pr(e){let t=(e||"").replace(/^#\/?/,""),[i,n]=t.split("?"),u=i||"active",s=new URLSearchParams(n||"");return{section:u,runId:s.get("run")||null}}function Rc(e,t){let i=`#/${e}`;return t?`${i}?run=${t}`:i}function Tn(e){let t=()=>e(Pr(location.hash));return window.addEventListener("hashchange",t),()=>window.removeEventListener("hashchange",t)}function Ve(e,t){location.hash=Rc(e,t)}function qi(e){document.documentElement.setAttribute("data-theme",e)}var Ze={ATTRIBUTE:1,CHILD:2,PROPERTY:3,BOOLEAN_ATTRIBUTE:4,EVENT:5,ELEMENT:6},di=e=>(...t)=>({_$litDirective$:e,values:t}),Ct=class{constructor(t){}get _$AU(){return this._$AM._$AU}_$AT(t,i,n){this._$Ct=t,this._$AM=i,this._$Ci=n}_$AS(t,i){return this.update(t,i)}update(t,i){return this.render(...i)}};var Ki=class extends Ct{constructor(t){if(super(t),this.it=V,t.type!==Ze.CHILD)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(t){if(t===V||t==null)return this._t=void 0,this.it=t;if(t===Re)return t;if(typeof t!="string")throw Error(this.constructor.directiveName+"() called with a non-string value");if(t===this.it)return this._t;this.it=t;let i=[t];return i.raw=i,this._t={_$litType$:this.constructor.resultType,strings:i,values:[]}}};Ki.directiveName="unsafeHTML",Ki.resultType=1;var K=di(Ki);var ui=[["circle",{cx:"12",cy:"12",r:"10"}]];var zt=[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"m9 12 2 2 4-4"}]];var Nt=[["circle",{cx:"12",cy:"12",r:"10"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16"}]];var xt=[["path",{d:"M12 2v4"}],["path",{d:"m16.2 7.8 2.9-2.9"}],["path",{d:"M18 12h4"}],["path",{d:"m16.2 16.2 2.9 2.9"}],["path",{d:"M12 18v4"}],["path",{d:"m4.9 19.1 2.9-2.9"}],["path",{d:"M2 12h4"}],["path",{d:"m4.9 4.9 2.9 2.9"}]];var Gi=[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{d:"M21 3v5h-5"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{d:"M8 16H3v5"}]];var Ir=[["path",{d:"M12 5v14"}],["path",{d:"m19 12-7 7-7-7"}]];var Wt=[["rect",{x:"14",y:"3",width:"5",height:"18",rx:"1"}],["rect",{x:"5",y:"3",width:"5",height:"18",rx:"1"}]];var Hr=[["path",{d:"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"}]];var pi=[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"M12 6v6l4 2"}]];var Fr=[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{d:"M12 9v4"}],["path",{d:"M12 17h.01"}]];var Ut=[["path",{d:"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]];var zr=[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"}],["path",{d:"M10 12h4"}]];var Nr=[["path",{d:"m21 21-4.34-4.34"}],["circle",{cx:"11",cy:"11",r:"8"}]];var Wr=[["path",{d:"m12 19-7-7 7-7"}],["path",{d:"M19 12H5"}]];var Ur=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2"}]];var Is=[["path",{d:"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"}]];var Hs=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{d:"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{cx:"9",cy:"7",r:"4"}]];var jr=[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}]];var Xi=[["path",{d:"M15 6a9 9 0 0 0-9 9V3"}],["circle",{cx:"18",cy:"6",r:"3"}],["circle",{cx:"6",cy:"18",r:"3"}]];var Vr=[["path",{d:"m9 18 6-6-6-6"}]];var fi=[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7"}]];var Yi=[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{cx:"12",cy:"12",r:"3"}]];var qr=[["line",{x1:"10",x2:"14",y1:"2",y2:"2"}],["line",{x1:"12",x2:"15",y1:"14",y2:"11"}],["circle",{cx:"12",cy:"14",r:"8"}]];var Fs=[["path",{d:"M12 20v2"}],["path",{d:"M12 2v2"}],["path",{d:"M17 20v2"}],["path",{d:"M17 2v2"}],["path",{d:"M2 12h2"}],["path",{d:"M2 17h2"}],["path",{d:"M2 7h2"}],["path",{d:"M20 12h2"}],["path",{d:"M20 17h2"}],["path",{d:"M20 7h2"}],["path",{d:"M7 20v2"}],["path",{d:"M7 2v2"}],["rect",{x:"4",y:"4",width:"16",height:"16",rx:"2"}],["rect",{x:"8",y:"8",width:"8",height:"8",rx:"1"}]];var Kr=[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]];var Ji=[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{d:"M10 9H8"}],["path",{d:"M16 13H8"}],["path",{d:"M16 17H8"}]];var Zi=[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1"}],["path",{d:"M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v4"}],["path",{d:"M21 14H11"}],["path",{d:"m15 10-4 4 4 4"}]];var Gr=[["path",{d:"M13.744 17.736a6 6 0 1 1-7.48-7.48"}],["path",{d:"M15 6h1v4"}],["path",{d:"m6.134 14.768.866-.5 2 3.464"}],["circle",{cx:"16",cy:"8",r:"6"}]];var Xr=[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0"}],["path",{d:"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}]];var Qi=[["path",{d:"M5 12h14"}],["path",{d:"M12 5v14"}]];var Yr=[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{d:"M3 3v5h5"}]];function $c(e){return e.map(([t,i])=>{let n=Object.entries(i).map(([u,s])=>`${u}="${s}"`).join(" ");return`<${t} ${n}/>`}).join("")}function Y(e,t=16,i=""){let n=i?` class="${i}"`:"";return`<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${n}>${$c(e)}</svg>`}function Dn(e,t,i,{onNavigate:n}){let{runs:u,preferences:s}=e,r=Object.values(u),l=r.filter(g=>g.active).length,p=r.filter(g=>!g.active).length,d=i==="open"?"connected":i==="reconnecting"?"reconnecting":"disconnected",f=i==="open"?"Connected":i==="reconnecting"?"Reconnecting\u2026":"Disconnected";return P`
    <aside class="sidebar ${s.sidebarCollapsed?"collapsed":""}">
      <div class="sidebar-logo" @click=${()=>n("dashboard")} style="cursor:pointer">
        <span class="logo-text">WORCA</span>
      </div>

      <div class="sidebar-new-run">
        <button class="sidebar-new-run-btn" @click=${()=>n("new-run")}>
          ${K(Y(Qi,16))}
          <span>New Pipeline</span>
        </button>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Pipeline</div>
        <div class="sidebar-item ${t.section==="active"?"active":""}"
             @click=${()=>n("active")}>
          <span class="sidebar-item-left">
            ${K(Y(Ut,16))}
            <span>Running</span>
          </span>
          ${l>0?P`<sl-badge variant="primary" pill>${l}</sl-badge>`:""}
        </div>
        <div class="sidebar-item ${t.section==="history"?"active":""}"
             @click=${()=>n("history")}>
          <span class="sidebar-item-left">
            ${K(Y(zr,16))}
            <span>History</span>
          </span>
          ${p>0?P`<sl-badge variant="neutral" pill>${p}</sl-badge>`:""}
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
        >${K(Y(Yi,18))}</button>
      </div>
    </aside>
  `}var Oc={pending:"status-pending",in_progress:"status-in-progress",completed:"status-completed",error:"status-error",interrupted:"status-interrupted"},Mc={pending:ui,in_progress:xt,completed:zt,error:Nt,interrupted:Wt};function mi(e,t){return e==="in_progress"&&t===!1?"interrupted":e}function zs(e){return Oc[e]||"status-unknown"}function rt(e,t=14){let i=Mc[e];return i?Y(i,t,e==="in_progress"?"icon-spin":""):"?"}var Bc={pending:ui,in_progress:xt,completed:zt,error:Nt,interrupted:Wt};function Pc(e,t){return t&&t[e]?.label?t[e].label:e.replace(/_/g," ").toUpperCase()}function Rn(e,t={},i=!0){if(!e||typeof e!="object")return P``;let n=Object.entries(e);return n.length===0?P`<div class="empty-state">No stages</div>`:P`
    <div class="stage-timeline">
      ${n.map(([u,s],r)=>{let l=mi(s.status||"pending",i),p=Bc[l]||ui,d=Pc(u,t),f=l==="in_progress",g=s.iteration,y=l==="in_progress"?"icon-spin":"";return P`
          ${r>0?P`<div class="stage-connector ${n[r-1]?.[1]?.status==="completed"?"completed":""}"></div>`:""}
          <div class="stage-node ${zs(l)} ${f?"pulse":""}">
            <div class="stage-icon">${K(Y(p,22,y))}</div>
            <div class="stage-label">${d}</div>
            ${g>1?P`<span class="loop-indicator">${K(Y(Gi,10))}${g}</span>`:""}
          </div>
        `})}
    </div>
  `}function pt(e){let t=Math.floor(e/1e3),i=Math.floor(t/3600),n=Math.floor(t%3600/60),u=t%60;return i>0?`${i}h ${n}m ${u}s`:n>0?`${n}m ${u}s`:`${u}s`}function jt(e,t){let i=new Date(e).getTime();return(t?new Date(t).getTime():Date.now())-i}function Vt(e){if(!e)return"N/A";let t=new Date(e),i=n=>String(n).padStart(2,"0");return`${t.getFullYear()}.${i(t.getMonth()+1)}.${i(t.getDate())} ${i(t.getHours())}:${i(t.getMinutes())}`}function Ic(e){if(!e)return null;let t=null;for(let i of Object.values(e))i.completed_at&&(!t||i.completed_at>t)&&(t=i.completed_at);return t}function Hc(e){return e==="completed"?"success":e==="error"?"danger":e==="in_progress"||e==="interrupted"?"warning":"neutral"}function Fc(e){let t=e.status||"pending";return t==="completed"&&e.outcome==="success"?P`<span class="iter-status-icon success">${K(rt("completed",12))}</span>`:t==="completed"?P`<span class="iter-status-icon">${K(rt("completed",12))}</span>`:t==="error"?P`<span class="iter-status-icon failure">${K(rt("error",12))}</span>`:t==="in_progress"?P`<span class="iter-status-icon in-progress">${K(rt("in_progress",12))}</span>`:V}function $n(e){return e?P`<span class="iteration-trigger">${{initial:"Initial run",test_failure:"Test failure",review_changes:"Review changes",restart_planning:"Restart planning"}[e]||e}</span>`:V}function On(e){return e?P`<span class="iteration-outcome ${e==="success"?"success":"failure"}">${e.replace(/_/g," ")}</span>`:V}function Mn(e){return e.reduce((t,i)=>t+(i.cost_usd||0),0)}function zc(e,t,i,n,u){let s=t.iterations||[],r=Bn(t);return{stage:e,status:t.status,agent:i||void 0,model:n||void 0,cost_usd:Mn(s),duration:r>0?pt(r):void 0,duration_ms:r>0?r:void 0,started_at:t.started_at||void 0,completed_at:t.completed_at||void 0,error:t.error||void 0,iterations:s.map(l=>({number:l.number,status:l.status,outcome:l.outcome||void 0,trigger:l.trigger||void 0,agent:l.agent||void 0,model:l.model||void 0,turns:l.turns||void 0,cost_usd:l.cost_usd||void 0,duration_ms:l.duration_ms||void 0,started_at:l.started_at||void 0,completed_at:l.completed_at||void 0})),prompts:u?{agent_instructions:u.agentInstructions||void 0,user_prompt:u.userPrompt||void 0}:void 0}}function Bn(e){let t=e.iterations||[],i=e.started_at||null,n=e.completed_at||null;for(let u of t)u.started_at&&(!i||u.started_at<i)&&(i=u.started_at),u.completed_at&&(!n||u.completed_at>n)&&(n=u.completed_at);return i?jt(i,n||null):0}function Jr(e,t,i=V){let n=e?pt(jt(e,t||null)):"";return P`
    <div class="timing-strip">
      ${e?P`<span class="timing-strip-item"><span class="meta-label">Started:</span> <span class="meta-value">${Vt(e)}</span></span>`:V}
      ${t?P`<span class="timing-strip-item"><span class="meta-label">Finished:</span> <span class="meta-value">${Vt(t)}</span></span>`:V}
      ${n?P`<span class="timing-strip-item"><span class="meta-label">Duration:</span> <span class="meta-value">${n}</span></span>`:V}
      ${i}
    </div>
  `}function Nc(e,t,i,n){let u=e.agent||i||t,s=e.model||"",r=e.number??0,d=(n?.iterationPrompts||[]).find(y=>y.iteration===r)?.prompt||n?.userPrompt||null,f=d?{agentInstructions:n?.agentInstructions,userPrompt:d}:n,g=e.started_at?pt(jt(e.started_at,e.completed_at||null)):"";return P`
    <div class="iteration-detail">
      ${Jr(e.started_at,e.completed_at)}
      <div class="stage-info-strip">
        ${u?P`<span class="stage-info-item"><span class="stage-meta-icon">${K(Y(Fs,12))}</span> ${u}${s?P` <span class="text-muted">(${s})</span>`:""}</span>`:V}
        ${e.turns?P`<span class="stage-info-item"><span class="meta-label">Turns:</span> <span class="meta-value">${e.turns}</span></span>`:V}
        ${e.cost_usd!=null?P`<span class="stage-info-item"><span class="meta-label">Iteration Cost:</span> <span class="meta-value">$${Number(e.cost_usd).toFixed(2)}</span></span>`:V}
        ${g?P`<span class="stage-info-item"><span class="meta-label">Iteration Duration:</span> <span class="meta-value">${g}</span></span>`:V}
      </div>
      ${e.trigger?P`<div class="detail-row">${$n(e.trigger)}</div>`:V}
      ${e.outcome?P`<div class="detail-row">${On(e.outcome)}</div>`:V}
      ${Pn(t,f)}
    </div>
  `}function Zr(e,t){navigator.clipboard.writeText(e).then(()=>{t.textContent="Copied!",setTimeout(()=>{t.textContent="Copy"},1500)})}function Pn(e,t){if(!t)return V;let{agentInstructions:i,userPrompt:n}=t;return!i&&!n?V:P`
    <sl-details class="agent-prompt-section">
      <div slot="summary" class="agent-prompt-header">
        <span class="stage-meta-icon">${K(Y(Ji,12))}</span>
        Agent Instructions
      </div>
      ${n?P`
        <div class="agent-prompt-block">
          <div class="agent-prompt-label-row">
            <span class="agent-prompt-label">User Prompt (-p)</span>
            <button class="copy-btn" @click=${u=>Zr(n,u.currentTarget)}>
              ${K(Y(Zi,11))} Copy
            </button>
          </div>
          <pre class="agent-prompt-content">${n}</pre>
        </div>
      `:V}
      ${i?P`
        <div class="agent-prompt-block">
          <div class="agent-prompt-label-row">
            <span class="agent-prompt-label">System Prompt (agent .md)</span>
            <button class="copy-btn" @click=${u=>Zr(i,u.currentTarget)}>
              ${K(Y(Zi,11))} Copy
            </button>
          </div>
          <pre class="agent-prompt-content">${i}</pre>
        </div>
      `:V}
    </sl-details>
  `}function In(e,t={},i={}){if(!e)return P`<div class="empty-state">Select a run to view details</div>`;let n=e.branch||e.work_request?.branch||"",u=e.pr_url||null,s=e.completed_at||(e.active?null:Ic(e.stages)),r=e.stages||{},l=t.stageUi||{},p=t.agents||{};return P`
    <div class="run-detail">
      ${Rn(r,l,e.active)}

      <div class="run-info-section">
        ${n?P`
          <div class="run-branch">
            <span class="stage-meta-icon">${K(Y(Xi,14))}</span>
            <span>${n}</span>
            ${u?P`<a class="run-pr-link" href="${u}" target="_blank">View PR</a>`:V}
          </div>
        `:V}
        ${Jr(e.started_at,s)}
        ${(()=>{let f=Object.values(r).flatMap(g=>g.iterations||[]).reduce((g,y)=>g+(y.cost_usd||0),0);return f>0?P`
            <div class="pipeline-cost-strip">
              <span class="meta-label">Pipeline Cost:</span> <span class="meta-value">$${f.toFixed(2)}</span>
            </div>
          `:V})()}
      </div>

      <div class="stage-panels">
        ${Object.entries(r).map(([d,f])=>{let g=l[d]?.label||d.replace(/_/g," ").toUpperCase(),y=mi(f.status||"pending",e.active),b=f.agent||p[d]?.agent||d,o=f.model||p[d]?.model||"",a=Bn(f),c=a>0?pt(a):"",h=f.iterations||[],m=h.length>1,v=Mn(h);return P`
            <sl-details ?open=${y==="in_progress"} class="stage-panel">
              <div slot="summary" class="stage-panel-header">
                <span class="stage-panel-icon ${zs(y)}">${K(rt(y))}</span>
                <span class="stage-panel-label">${g}</span>
                <span class="stage-panel-meta">
                  ${m?P`
                    <span class="stage-meta-item stage-meta-iteration">
                      <span class="stage-meta-icon">${K(Y(Gi,11))}</span>
                      <span class="meta-value">${h.length} iterations</span>
                    </span>
                  `:V}
                  ${v>0?P`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${K(Y(Gr,11))}</span>
                      <span class="meta-value">$${v.toFixed(2)}</span>
                    </span>
                  `:V}
                  ${f.completed_at?P`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${K(Y(pi,11))}</span>
                      <span class="meta-value">${Vt(f.completed_at)}</span>
                    </span>
                  `:V}
                  ${c?P`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${K(Y(qr,11))}</span>
                      <span class="meta-value">${c}</span>
                    </span>
                  `:V}
                </span>
                <sl-badge variant="${Hc(y)}" pill>
                  ${y.replace(/_/g," ")}
                </sl-badge>
              </div>
              ${(()=>{let w=y!=="pending"?i.promptCache?.[d]:null,C=P`
                  <button class="stage-copy-btn" title="Copy stage data as JSON" @click=${_=>{let S=zc(d,f,b,o,w);Zr(JSON.stringify(S,null,2),_.currentTarget)}}>
                    ${K(Y(Zi,12))} Copy
                  </button>
                `;if(m){let _=a>0?pt(a):"";return P`
                    <div class="stage-content-wrapper">
                      ${C}
                      <div class="stage-totals-strip">
                        <span class="stage-totals-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${v.toFixed(2)}</span></span>
                        <span class="stage-totals-item"><span class="meta-label">Duration:</span> <span class="meta-value">${_}</span></span>
                      </div>
                      <sl-tab-group>
                        ${h.map(S=>P`
                          <sl-tab slot="nav" panel="iter-${d}-${S.number}">
                            Iter ${S.number} ${Fc(S)}
                          </sl-tab>
                        `)}
                        ${h.map(S=>P`
                          <sl-tab-panel name="iter-${d}-${S.number}">
                            ${Nc(S,d,b,w)}
                          </sl-tab-panel>
                        `)}
                      </sl-tab-group>
                    </div>
                  `}return P`
                  <div class="stage-content-wrapper">
                    ${C}
                    <div class="stage-detail">
                      ${Jr(f.started_at,f.completed_at)}
                      <div class="stage-info-strip">
                        ${b?P`<span class="stage-info-item"><span class="stage-meta-icon">${K(Y(Fs,12))}</span> ${b}${o?P` <span class="text-muted">(${o})</span>`:""}</span>`:V}
                        ${h.length===1&&h[0].turns?P`<span class="stage-info-item"><span class="meta-label">Turns:</span> <span class="meta-value">${h[0].turns}</span></span>`:V}
                        ${h.length===1&&h[0].cost_usd!=null?P`<span class="stage-info-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${Number(h[0].cost_usd).toFixed(2)}</span></span>`:V}
                      </div>
                      ${h.length===1&&h[0].trigger?P`<div class="detail-row">${$n(h[0].trigger)}</div>`:V}
                      ${h.length===1&&h[0].outcome?P`<div class="detail-row">${On(h[0].outcome)}</div>`:V}
                      ${f.task_progress?P`<div class="detail-row"><span class="detail-label">Progress:</span> ${f.task_progress}</div>`:V}
                      ${f.error?P`<div class="detail-row detail-error"><span class="detail-label">Error:</span> ${f.error}</div>`:V}
                      ${w?Pn(d,w):V}
                    </div>
                  </div>
                `})()}
              ${y==="error"&&!e.active&&i.onRestartStage?P`
                <div class="stage-restart-btn">
                  <sl-button variant="warning" size="small" @click=${()=>i.onRestartStage(d)}>
                    ${K(Y(Yr,14))}
                    Restart Stage
                  </sl-button>
                </div>
              `:V}
            </sl-details>
          `})}
      </div>
    </div>
  `}var Wc={completed:"success",in_progress:"warning",error:"danger",interrupted:"warning",pending:"neutral"};function Ns(e,{onClick:t}={}){let i=e.work_request?.title||"Untitled",n=e.active,u=n?"in_progress":e.stage==="error"?"error":"completed",s=e.started_at&&e.completed_at?pt(jt(e.started_at,e.completed_at)):e.started_at&&n?pt(jt(e.started_at,null)):"N/A",r=e.branch||e.work_request?.branch||"",l=e.stages?Object.entries(e.stages):[];return P`
    <div class="run-card" @click=${t?()=>t(e.id):null}>
      <div class="run-card-top">
        <span class="run-card-status">${K(rt(u,16))}</span>
        <span class="run-card-title">${i}</span>
      </div>
      ${r?P`<div class="run-card-meta"><span class="run-card-meta-item"><span class="meta-label">Branch:</span> ${r}</span></div>`:V}
      <div class="run-card-meta">
        <span class="run-card-meta-item"><span class="meta-label">Started:</span> ${Vt(e.started_at)}</span>
        <span class="run-card-meta-item"><span class="meta-label">Finished:</span> ${Vt(e.completed_at)}</span>
        <span class="run-card-meta-item"><span class="meta-label">Duration:</span> ${s}</span>
      </div>
      ${l.length>0?P`
        <div class="run-card-stages">
          ${l.map(([p,d])=>{let f=mi(d.status||"pending",n),g=Wc[f]||"neutral",y=p.replace(/_/g," ").toUpperCase();return P`<sl-badge variant="${g}" pill class="run-card-stage-badge">${y}</sl-badge>`})}
        </div>
      `:V}
    </div>
  `}function Qr(e,t,{onSelectRun:i}){let n=e.filter(u=>t==="active"?u.active:!u.active);return n.length===0?P`<div class="empty-state">
      ${t==="active"?"No running pipelines":"No completed runs yet"}
    </div>`:P`
    <div class="run-list">
      ${n.map(u=>Ns(u,{onClick:i}))}
    </div>
  `}function Hn(e,{onSelectRun:t,onNavigate:i}={}){let n=Object.values(e.runs),u=n.filter(p=>p.active),s=n.filter(p=>!p.active),r=n.filter(p=>(p.stages?Object.values(p.stages):[]).some(f=>f.status==="error")),l=n.length;return P`
    <div class="dashboard">
      <div class="dashboard-stats">
        <div class="stat-card stat-total">
          <div class="stat-icon-ring">${K(Y(Hr,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${l}</span>
            <span class="stat-label">Total Runs</span>
          </div>
        </div>
        <div class="stat-card stat-active">
          <div class="stat-icon-ring">${K(Y(Ut,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${u.length}</span>
            <span class="stat-label">Active</span>
          </div>
        </div>
        <div class="stat-card stat-completed">
          <div class="stat-icon-ring">${K(Y(zt,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${s.length}</span>
            <span class="stat-label">Completed</span>
          </div>
        </div>
        <div class="stat-card stat-errors">
          <div class="stat-icon-ring">${K(Y(Nt,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${r.length}</span>
            <span class="stat-label">Errors</span>
          </div>
        </div>
      </div>

      <div class="dashboard-actions">
        <sl-button variant="primary" @click=${()=>i&&i("new-run")}>
          ${K(Y(Qi,16))}
          New Pipeline
        </sl-button>
      </div>

      <h3 class="dashboard-section-title">Active Runs</h3>
      ${u.length>0?P`
        <div class="run-list">
          ${u.map(p=>Ns(p,{onClick:t}))}
        </div>
      `:P`<div class="empty-state">No running pipelines</div>`}
    </div>
  `}var Uc={plan:"planner",coordinate:"coordinator",implement:"implementer",test:"tester",review:"guardian",pr:"guardian"},Ws=["plan","coordinate","implement","test","review","pr"],ts=["planner","coordinator","implementer","tester","guardian"],jc=["opus","sonnet","haiku"],es={plan:{agent:"planner",enabled:!0},coordinate:{agent:"coordinator",enabled:!0},implement:{agent:"implementer",enabled:!0},test:{agent:"tester",enabled:!0},review:{agent:"guardian",enabled:!0},pr:{agent:"guardian",enabled:!0}},zn=[{key:"block_rm_rf",label:"Block rm -rf",description:"Prevent recursive force-delete commands"},{key:"block_env_write",label:"Block .env writes",description:"Prevent writing to .env files"},{key:"block_force_push",label:"Block force push",description:"Prevent git push --force"},{key:"restrict_git_commit",label:"Restrict git commit",description:"Only guardian agent may commit"}],qt={guards:{block_rm_rf:!0,block_env_write:!0,block_force_push:!0,restrict_git_commit:!0},test_gate_strikes:2,dispatch:{planner:[],coordinator:["implementer"],implementer:[],tester:[],guardian:[]}},be=null,Qe=null,Kt="";async function eo(){try{let e=await fetch("/api/settings");if(!e.ok)throw new Error(`HTTP ${e.status}`);if(be=await e.json(),be.worca||(be.worca={}),!be.worca.stages)be.worca.stages={...es};else for(let t of Ws)be.worca.stages[t]||(be.worca.stages[t]={...es[t]});be.worca.governance?be.worca.governance={...qt,...be.worca.governance,guards:{...qt.guards,...be.worca.governance.guards||{}},dispatch:{...qt.dispatch,...be.worca.governance.dispatch||{}}}:be.worca.governance={...qt}}catch(e){be=null,Qe="error",Kt="Failed to load settings: "+e.message}}async function to(e,t){Qe="saving",Kt="",t();try{let i=await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(e)});if(!i.ok)throw new Error(`HTTP ${i.status}`);let n=await i.json();be={worca:n.worca,permissions:n.permissions},Qe="success",Kt="Settings saved successfully"}catch(i){Qe="error",Kt="Failed to save: "+i.message}t(),Qe==="success"&&setTimeout(()=>{Qe==="success"&&(Qe=null,Kt="",t())},3e3)}function Vc(){let e={};for(let t of ts){let i=document.getElementById(`agent-${t}-model`),n=document.getElementById(`agent-${t}-turns`);e[t]={model:i?.value||"sonnet",max_turns:parseInt(n?.value,10)||30}}return e}function qc(){let e={};for(let t of["implement_test","code_review","pr_changes","restart_planning"]){let i=document.getElementById(`loop-${t}`);e[t]=parseInt(i?.value,10)||0}return{loops:e}}function Kc(){let e={};for(let t of Ws){let i=document.getElementById(`stage-${t}-enabled`),n=document.getElementById(`stage-${t}-agent`);e[t]={agent:n?.value||es[t].agent,enabled:i?.checked??!0}}return e}function Gc(){let e={};for(let u of zn){let s=document.getElementById(`guard-${u.key}`);e[u.key]=s?.checked??!0}let t=document.getElementById("test-gate-strikes"),i=parseInt(t?.value,10)||2,n={};for(let u of ts){let r=(document.getElementById(`dispatch-${u}`)?.value||"").trim();n[u]=r?r.split(",").map(l=>l.trim()).filter(Boolean):[]}return{guards:e,test_gate_strikes:i,dispatch:n}}function Xc(e,t){let i=e.agents||{};return P`
    <div class="settings-tab-content">
      <div class="settings-cards">
        ${ts.map(n=>{let u=i[n]||{};return P`
            <div class="settings-card">
              <div class="settings-card-header">
                <span class="settings-card-icon">${K(Y(Hs,18))}</span>
                <span class="settings-card-title">${n}</span>
              </div>
              <div class="settings-card-body">
                <div class="settings-field">
                  <label class="settings-label">Model</label>
                  <sl-select id="agent-${n}-model" .value="${u.model||"sonnet"}" size="small">
                    ${jc.map(s=>P`<sl-option value="${s}">${s}</sl-option>`)}
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
        <sl-button variant="primary" size="small" @click=${()=>{let n=Vc();to({worca:{...be.worca,agents:n},permissions:be.permissions},t)}}>
          ${K(Y(fi,14))}
          Save Agents
        </sl-button>
      </div>
    </div>
  `}function Yc(e,t){let i=e.loops||{},n=e.stages||es;return P`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Stage Configuration</h3>
      <div class="pipeline-flow">
        ${Ws.map((u,s)=>{let r=n[u]||es[u],l=r.enabled!==!1;return P`
            <div class="pipeline-stage-node ${l?"pipeline-stage-node--enabled":"pipeline-stage-node--disabled"}">
              <div class="pipeline-stage-header">
                <span class="pipeline-stage-name ${l?"":"pipeline-stage-name--disabled"}">${u}</span>
                <sl-switch id="stage-${u}-enabled" ?checked=${l} size="small"
                  @sl-change=${p=>{let d=p.target.closest(".pipeline-stage-node");p.target.checked?(d.classList.remove("pipeline-stage-node--disabled"),d.classList.add("pipeline-stage-node--enabled"),d.querySelector(".pipeline-stage-name").classList.remove("pipeline-stage-name--disabled")):(d.classList.remove("pipeline-stage-node--enabled"),d.classList.add("pipeline-stage-node--disabled"),d.querySelector(".pipeline-stage-name").classList.add("pipeline-stage-name--disabled"))}}></sl-switch>
              </div>
              <div class="settings-field pipeline-stage-field">
                <label class="settings-label">Agent</label>
                <sl-select id="stage-${u}-agent" .value="${r.agent||Uc[u]}" size="small">
                  ${ts.map(p=>P`<sl-option value="${p}">${p}</sl-option>`)}
                </sl-select>
              </div>
            </div>
            ${s<Ws.length-1?P`
              <span class="pipeline-arrow">${K(Y(Vr,16))}</span>
            `:V}
          `})}
      </div>

      <h3 class="settings-section-title">Loop Limits</h3>
      <div class="settings-grid">
        ${[{key:"implement_test",label:"Implement \u2194 Test"},{key:"code_review",label:"Code Review"},{key:"pr_changes",label:"PR Changes"},{key:"restart_planning",label:"Restart Planning"}].map(u=>P`
          <div class="settings-field">
            <label class="settings-label">${u.label}</label>
            <sl-input id="loop-${u.key}" type="number" value="${i[u.key]||0}" size="small" min="0" max="50"></sl-input>
          </div>
        `)}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${()=>{let{loops:u}=qc(),s=Kc();to({worca:{...be.worca,loops:u,stages:s},permissions:be.permissions},t)}}>
          ${K(Y(fi,14))}
          Save Pipeline
        </sl-button>
      </div>
    </div>
  `}function Jc(e,t,i){let n=e.governance||qt,u=n.guards||qt.guards,s=n.dispatch||qt.dispatch,r=t.allow||[];return P`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Guard Rules</h3>
      <div class="settings-switches">
        ${zn.map(l=>P`
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
        ${ts.map(l=>P`
          <div class="settings-dispatch-row">
            <span class="settings-dispatch-agent">${l}</span>
            <sl-input id="dispatch-${l}" value="${(s[l]||[]).join(", ")}" size="small" placeholder="none"></sl-input>
          </div>
        `)}
      </div>

      <h3 class="settings-section-title">Permissions</h3>
      <div class="settings-permissions">
        ${r.length>0?r.map(l=>P`<div class="settings-perm-item"><code>${l}</code></div>`):P`<span class="settings-muted">No permissions configured</span>`}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${()=>{let l=Gc();to({worca:{...be.worca,governance:l},permissions:be.permissions},i)}}>
          ${K(Y(fi,14))}
          Save Governance
        </sl-button>
      </div>
    </div>
  `}function Zc(e,t){let i=e?.theme||"light";return P`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Appearance</h3>
      <div class="settings-switches">
        <div class="settings-switch-row">
          <sl-switch ?checked=${i==="dark"} size="small" @sl-change=${t}>Dark Mode</sl-switch>
          <span class="settings-switch-desc">Toggle between light and dark theme</span>
        </div>
      </div>
    </div>
  `}var Fn={run_completed:{label:"Run Completed",desc:"When a pipeline run finishes successfully"},run_failed:{label:"Run Failed",desc:"When a pipeline run fails at any stage"},approval_needed:{label:"Approval Required",desc:"When a stage is waiting for plan or PR approval"},test_failures:{label:"Test Failures",desc:"When a test iteration ends with failures"},loop_limit_warning:{label:"Loop Limit Warning",desc:"When a stage approaches its configured loop limit"}};function Qc(e,{rerender:t,onSaveNotifications:i}){let n=e?.notifications||{},u=n.enabled??!0,s=n.sound??!1,r=n.events||{},l=typeof Notification<"u"?Notification.permission:"unsupported",p=l==="granted"?P`<sl-badge variant="success" pill>Granted</sl-badge>`:l==="denied"?P`<sl-badge variant="danger" pill>Blocked</sl-badge>`:l==="default"?P`<sl-badge variant="neutral" pill>Not Yet Asked</sl-badge>`:P`<sl-badge variant="neutral" pill>Not Supported</sl-badge>`,d=l!=="granted";return P`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Browser Notifications</h3>
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
        <span style="font-size: 13px; color: var(--muted);">Permission Status:</span>
        ${p}
        ${l==="default"?P`
          <sl-button size="small" variant="primary" @click=${async()=>{typeof Notification<"u"&&(await Notification.requestPermission(),t())}}>Enable Notifications</sl-button>
        `:""}
      </div>

      ${d?P`
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
          <sl-switch id="notif-sound" ?checked=${s} size="small" ?disabled=${d}>Sound for Critical Events</sl-switch>
          <span class="settings-switch-desc">Play a short audio cue for failed runs and approval requests</span>
        </div>
      </div>

      <h3 class="settings-section-title">Notification Events</h3>
      <div class="settings-switches">
        ${Object.entries(Fn).map(([f,{label:g,desc:y}])=>P`
          <div class="settings-switch-row">
            <sl-switch id="notif-evt-${f}" ?checked=${r[f]??!0} size="small" ?disabled=${d}>${g}</sl-switch>
            <span class="settings-switch-desc">${y}</span>
          </div>
        `)}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" ?disabled=${d} @click=${()=>{let f=document.getElementById("notif-enabled")?.checked??!0,g=document.getElementById("notif-sound")?.checked??!1,y={};for(let b of Object.keys(Fn))y[b]=document.getElementById(`notif-evt-${b}`)?.checked??!0;i({enabled:f,sound:g,events:y})}}>
          ${K(Y(fi,14))}
          Save Notifications
        </sl-button>
      </div>
    </div>
  `}function eh(e){return!Qe||Qe==="saving"?V:P`
    <div class="settings-toast">
      <sl-alert variant="${Qe==="success"?"success":"danger"}" open closable duration="3000"
        @sl-after-hide=${()=>{Qe=null,Kt="",e()}}>
        ${Kt}
      </sl-alert>
    </div>
  `}function Nn(e,{rerender:t,onThemeToggle:i,onSaveNotifications:n}){if(!be)return P`<div class="empty-state">Loading settings\u2026</div>`;let u=be.worca||{},s=be.permissions||{};return P`
    ${eh(t)}
    <div class="settings-page">
      <sl-tab-group>
        <sl-tab slot="nav" panel="agents">
          ${K(Y(Hs,14))}
          Agents
        </sl-tab>
        <sl-tab slot="nav" panel="pipeline">
          ${K(Y(Xi,14))}
          Pipeline
        </sl-tab>
        <sl-tab slot="nav" panel="governance">
          ${K(Y(jr,14))}
          Governance
        </sl-tab>
        <sl-tab slot="nav" panel="preferences">
          ${K(Y(Yi,14))}
          Preferences
        </sl-tab>
        <sl-tab slot="nav" panel="notifications">
          ${K(Y(Xr,14))}
          Notifications
        </sl-tab>

        <sl-tab-panel name="agents">${Xc(u,t)}</sl-tab-panel>
        <sl-tab-panel name="pipeline">${Yc(u,t)}</sl-tab-panel>
        <sl-tab-panel name="governance">${Jc(u,s,t)}</sl-tab-panel>
        <sl-tab-panel name="preferences">${Zc(e,i)}</sl-tab-panel>
        <sl-tab-panel name="notifications">${Qc(e,{rerender:t,onSaveNotifications:n})}</sl-tab-panel>
      </sl-tab-group>
    </div>
  `}var _i="prompt",kt=null,ss="",Gt=null,gi="",is=!1,rs="";function th(e){return e==="source"?"GitHub Issue URL":e==="spec"?"Spec File Path":"Prompt"}function ih(){return Gt?Promise.resolve(Gt):fetch("/api/plan-files").then(e=>e.json()).then(e=>(e.ok&&(Gt=e.files),Gt||[])).catch(()=>[])}function sh(){if(!Gt)return[];if(!gi)return Gt;let e=gi.toLowerCase();return Gt.filter(t=>t.name.toLowerCase().includes(e)||t.path.toLowerCase().includes(e))}function rh(e){let t={};for(let i of e)t[i.dir]||(t[i.dir]=[]),t[i.dir].push(i);return t}function Wn(){return{submitStatus:kt,isSubmitting:kt==="submitting"}}async function Un({rerender:e,onStarted:t}){let i=document.getElementById("new-run-input-value"),n=document.getElementById("new-run-msize"),u=document.getElementById("new-run-mloops"),s=i?.value?.trim()||"";if(!s){kt="error",ss="Please enter a value.",e();return}let r=n&&parseInt(n.value,10)||1,l=u&&parseInt(u.value,10)||1;kt="submitting",ss="",e();try{let p={inputType:_i,inputValue:s,msize:Math.max(1,Math.min(10,r)),mloops:Math.max(1,Math.min(10,l))};rs&&(p.planFile=rs);let f=await(await fetch("/api/runs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)})).json();f.ok?(kt=null,t()):(kt="error",ss=f.error||"Failed to start pipeline",e())}catch(p){kt="error",ss=p.message||"Network error",e()}}function jn(e,{rerender:t}){function i(f){_i=f.target.value,t()}function n(){ih().then(()=>{is=!0,t()})}function u(f){gi=f.target.value,rs="",is=!0,t()}function s(){setTimeout(()=>{is=!1,t()},200)}function r(f){rs=f.path,gi=f.path,is=!1,t()}function l(){rs="",gi="",t()}let p=sh(),d=rh(p);return P`
    <div class="new-run-page">
      ${kt==="error"?P`<div class="new-run-error">${ss}</div>`:V}

      <div class="new-run-form">
        <div class="new-run-section">
          <div class="settings-field">
            <label class="settings-label">Input Type</label>
            <sl-select id="new-run-input-type" value=${_i} @sl-change=${i}>
              <sl-option value="prompt">Prompt</sl-option>
              <sl-option value="source">GitHub Issue</sl-option>
              <sl-option value="spec">Spec File</sl-option>
            </sl-select>
          </div>

          <div class="settings-field">
            <label class="settings-label">${th(_i)}</label>
            ${_i==="prompt"?P`<sl-textarea id="new-run-input-value" rows="8" placeholder="Describe what the pipeline should do..."></sl-textarea>`:P`<sl-input id="new-run-input-value" placeholder=${_i==="source"?"https://github.com/...":"path/to/spec.md"}></sl-input>`}
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
                  .value=${gi}
                  @sl-input=${u}
                  @sl-focus=${n}
                  @sl-blur=${s}
                  clearable
                  @sl-clear=${l}
                >
                  <span slot="prefix">${K(Y(Ji,14))}</span>
                </sl-input>
                ${is&&p.length>0?P`
                  <div class="plan-dropdown">
                    ${Object.entries(d).map(([f,g])=>P`
                      <div class="plan-group-header">${f}/</div>
                      ${g.map(y=>P`
                        <div class="plan-item" @mousedown=${()=>r(y)}>
                          ${y.name}
                        </div>
                      `)}
                    `)}
                  </div>
                `:V}
              </div>
              <span class="settings-field-hint">Skips the planning stage. Relative to project root.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `}var va=["\x1B[36m","\x1B[33m","\x1B[35m","\x1B[32m","\x1B[34m","\x1B[91m","\x1B[96m","\x1B[93m"],wo="\x1B[0m",ba="\x1B[2m",Zs=new Map,So=0;function rd(e){return Zs.has(e)||(Zs.set(e,va[So%va.length]),So++),Zs.get(e)}var Me=null,At=null,wi=null,Co=null,Lt=null,Xt=null;async function od(e){if(Me&&e.querySelector(".xterm")){At.fit();return}if(Xt){await Xt;return}Xt=(async()=>{let[{Terminal:t},{FitAddon:i},{SearchAddon:n}]=await Promise.all([Promise.resolve().then(()=>hn(so(),1)),Promise.resolve().then(()=>(oo(),ro)),Promise.resolve().then(()=>(ga(),_a))]);Me=new t({theme:{background:"#0f172a",foreground:"#e2e8f0",cursor:"#60a5fa",selectionBackground:"rgba(96, 165, 250, 0.3)"},fontFamily:"'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",fontSize:13,lineHeight:1.4,scrollback:5e4,convertEol:!0,cursorBlink:!1,disableStdin:!0}),At=new i,wi=new n,Me.loadAddon(At),Me.loadAddon(wi),Me.open(e),At.fit(),Lt=new ResizeObserver(()=>{At&&At.fit()}),Lt.observe(e)})(),await Xt,Xt=null}function xo(e){if(!Me)return;let t=e.timestamp?`${ba}${e.timestamp}${wo} `:"",i=e.stage?`${rd(e.stage)}[${e.stage.toUpperCase()}]${wo} `:"",n=e.line||e;Me.writeln(`${t}${i}${n}`)}function Si(){Lt&&Lt.disconnect(),Me&&Me.dispose(),Me=null,At=null,wi=null,Lt=null,Xt=null,Zs.clear(),So=0}function ya(){Lt&&Lt.disconnect(),Me&&Me.dispose(),Me=null,At=null,wi=null,Lt=null,Xt=null,Co=null}function wa(e){wi&&e&&wi.findNext(e,{incremental:!0})}async function Sa(e){let t=document.getElementById("log-terminal");t&&(e!==Co&&(Si(),Co=e),await od(t))}function Ca(e){Me&&Me.writeln(`
${ba}${"\u2500".repeat(40)} Iteration ${e} ${"\u2500".repeat(40)}${wo}
`)}function xa(e,{onStageFilter:t,onIterationFilter:i,onSearch:n,onToggleAutoScroll:u,autoScroll:s,stageIterations:r,runStages:l}){let p=l?["orchestrator",...Object.keys(l)]:null,d=[...new Set(["orchestrator",...e.logLines.map(a=>a.stage).filter(Boolean)])],f=p||d,g=e.currentLogStage,y=r?.[g]||0,b=g&&g!=="*"&&y>0,o=g&&g!=="*";return P`
    <div class="log-history-container">
      <sl-details class="log-history-panel">
        <div slot="summary" class="log-history-header">
          <span class="log-history-icon">${K(Y(pi,16))}</span>
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
              ${f.map(a=>P`<sl-option value="${a}">${a==="orchestrator"?P`<span style="display:inline-flex;align-items:center;gap:4px">${K(Y(Kr,12))} ORCHESTRATOR</span>`:a.toUpperCase()}</sl-option>`)}
            </sl-select>
            ${b?P`
              <sl-select
                .value=${String(e.currentLogIteration||y)}
                size="small"
                @sl-change=${a=>i(a.target.value?parseInt(a.target.value):null)}
              >
                ${Array.from({length:y},(a,c)=>P`<sl-option value="${c+1}">Iteration ${c+1}</sl-option>`)}
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
              <span slot="prefix">${K(Y(Nr,14))}</span>
            </sl-input>
            <sl-button
              size="small"
              variant="${s?"primary":"default"}"
              @click=${u}
            >
              ${K(Y(s?Ir:Wt,14))}
              ${s?"Auto":"Paused"}
            </sl-button>
          </div>
          ${o?P`
            <div class="log-terminal-wrapper">
              <div id="log-terminal" class="log-terminal"></div>
            </div>
          `:P`
            <div class="log-history-empty">
              <span class="log-history-empty-icon">${K(Y(pi,32))}</span>
              <p>Select a stage from the dropdown to review past output.</p>
            </div>
          `}
        </div>
      </sl-details>
    </div>
  `}var ka=["\x1B[36m","\x1B[33m","\x1B[35m","\x1B[32m","\x1B[34m","\x1B[91m","\x1B[96m","\x1B[93m"],Qs="\x1B[0m",Ao="\x1B[2m",ko=new Map,Ea=0;function nd(e){return ko.has(e)||(ko.set(e,ka[Ea%ka.length]),Ea++),ko.get(e)}var $e=null,Yt=null,as=null,Eo=null,Ci=null,Tt=null;async function ad(e){if($e&&e.querySelector(".xterm")){Yt.fit();return}if(Ci){await Ci;return}Ci=(async()=>{let[{Terminal:t},{FitAddon:i}]=await Promise.all([Promise.resolve().then(()=>hn(so(),1)),Promise.resolve().then(()=>(oo(),ro))]);$e=new t({theme:{background:"#0f172a",foreground:"#e2e8f0",cursor:"#60a5fa",selectionBackground:"rgba(96, 165, 250, 0.3)"},fontFamily:"'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",fontSize:13,lineHeight:1.4,scrollback:1e4,convertEol:!0,cursorBlink:!1,disableStdin:!0}),Yt=new i,$e.loadAddon(Yt),$e.open(e),Yt.fit(),as=new ResizeObserver(()=>{Yt&&Yt.fit()}),as.observe(e)})(),await Ci,Ci=null}function Lo(e){if(!$e||!Tt||e.stage!==Tt)return;let t=e.timestamp?`${Ao}${e.timestamp}${Qs} `:"",i=e.stage?`${nd(e.stage)}[${e.stage.toUpperCase()}]${Qs} `:"",n=e.line||e;$e.writeln(`${t}${i}${n}`)}function Aa(e){$e&&$e.writeln(`
${Ao}${"\u2500".repeat(40)} Iteration ${e} ${"\u2500".repeat(40)}${Qs}
`)}function To(){$e&&$e.clear()}function La(){as&&as.disconnect(),$e&&$e.dispose(),$e=null,Yt=null,as=null,Ci=null,Eo=null,Tt=null}function ld(e){if(!e)return null;for(let[n,u]of Object.entries(e))if(u.status==="in_progress")return n;let t=null,i=null;for(let[n,u]of Object.entries(e))u.started_at&&(!i||u.started_at>i)&&(i=u.started_at,t=n);return t}function er(e){let t=e?.stages,i=ld(t);if(i!==Tt){let n=Tt;return Tt=i,$e&&n!==null&&($e.clear(),i&&$e.writeln(`${Ao}--- Switched to stage: ${i.toUpperCase()} ---${Qs}
`)),{changed:!0,activeStage:i}}return{changed:!1,activeStage:Tt}}function Do(){return Tt}async function Ta(e){let t=document.getElementById("live-output-terminal");t&&(e!==Eo&&(To(),Eo=e),await ad(t))}function Da(e,t){if(!t)return V;let i=e?e.replace(/_/g," ").toUpperCase():"WAITING";return P`
    <div class="live-output-container">
      <sl-details open class="live-output-panel">
        <div slot="summary" class="live-output-header">
          <span class="live-output-icon">${K(Y(Ut,16))}</span>
          <span class="live-output-title">Live Output</span>
          ${e?P`<sl-badge variant="warning" pill>${i}</sl-badge>`:V}
        </div>
        <div class="live-output-terminal-wrapper">
          <div id="live-output-terminal" class="live-output-terminal"></div>
        </div>
      </sl-details>
    </div>
  `}var xi={run_completed:{severity:"info",title:"Pipeline Complete",requireInteraction:!1},run_failed:{severity:"critical",title:"Pipeline Failed",requireInteraction:!1},approval_needed:{severity:"critical",title:"Approval Required",requireInteraction:!0},test_failures:{severity:"warning",title:"Tests Failed",requireInteraction:!1},loop_limit_warning:{severity:"warning",title:"Loop Limit Warning",requireInteraction:!1}};function cd(e,t,i){if(!i||!t)return null;let n=i.active===!0,u=t.active===!1;if(!n||!u)return null;let s=t.stages||{};if(Object.values(s).some(p=>p.status==="error"))return null;let l=ls(t);return{event:"run_completed",title:xi.run_completed.title,body:`"${l}" finished successfully`,tag:`worca-complete-${e}`,requireInteraction:!1,runId:e}}function hd(e,t,i){if(!i||!t)return null;let n=i.active===!0,u=t.active===!1;if(!n||!u)return null;let s=t.stages||{},r=Object.entries(s).find(([,p])=>p.status==="error");if(!r)return null;let l=ls(t);return{event:"run_failed",title:xi.run_failed.title,body:`"${l}" failed at ${r[0]} stage`,tag:`worca-failed-${e}`,requireInteraction:!1,runId:e}}function dd(e,t,i){if(!t)return null;let n=t.stages||{},u=i&&i.stages||{};for(let[s,r]of Object.entries(n))if(r.status==="waiting_approval"&&u[s]?.status!=="waiting_approval"){let p=ls(t),d=s==="pr"?"PR":s;return{event:"approval_needed",title:xi.approval_needed.title,body:`"${p}" is waiting for ${d} approval`,tag:`worca-approval-${e}-${s}`,requireInteraction:!0,runId:e}}return null}function ud(e,t,i){if(!t)return null;let n=t.stages?.test;if(!n)return null;let u=n.iterations||[],s=i?.stages?.test?.iterations||[];if(u.length>s.length){let r=u[u.length-1];if(r&&r.result==="failed"){let l=ls(t);return{event:"test_failures",title:xi.test_failures.title,body:`"${l}" test iteration ${u.length} failed`,tag:`worca-test-${e}-iter${u.length}`,requireInteraction:!1,runId:e}}}return null}function pd(e,t,i,n,u){if(!t||!n)return null;let s=n?.worca?.loops;if(!s)return null;let r=t.stages||{},l={implement_test:["implement","test"],code_review:["review"],pr_changes:["pr"],restart_planning:["plan"]};for(let[p,d]of Object.entries(s)){if(!d||d<2)continue;let f=l[p];if(f)for(let g of f){let y=r[g];if(!y)continue;let b=(y.iterations||[]).length;if(b===d-1){let o=`${e}-${g}`;if(u.has(o))continue;u.add(o);let a=ls(t);return{event:"loop_limit_warning",title:xi.loop_limit_warning.title,body:`"${a}" ${g} stage approaching loop limit (${b}/${d})`,tag:`worca-loop-${e}-${g}`,requireInteraction:!1,runId:e}}}}return null}function ls(e){let i=(e?.work_request?.title||e?.id||"Pipeline").split(`
`)[0];return i.length>60?i.slice(0,60)+"\u2026":i}var _t=null;function fd(){try{_t||(_t=new AudioContext);let e=_t.createOscillator(),t=_t.createGain();e.type="sine",e.frequency.value=440,t.gain.value=.3,e.connect(t),t.connect(_t.destination),e.start(),e.stop(_t.currentTime+.2)}catch{}}var tr={enabled:!0,sound:!1,events:{run_completed:!0,run_failed:!0,approval_needed:!0,test_failures:!0,loop_limit_warning:!0}};function Ra({store:e,ws:t,getSettings:i}){let n=typeof Notification<"u"?Notification.permission:"denied",u=new Set,s=!1,r=null;function l(a){r=a}function p(){return typeof Notification<"u"&&(n=Notification.permission),n}async function d(){if(typeof Notification>"u")return"denied";let a=await Notification.requestPermission();return n=a,r&&r(),a}function f(){let a=e.getState().preferences.notifications;return a?{enabled:a.enabled??tr.enabled,sound:a.sound??tr.sound,events:{...tr.events,...a.events||{}}}:{...tr}}function g({event:a,title:c,body:h,tag:m,requireInteraction:v,runId:w}){if(typeof Notification>"u")return;let C=new Notification(c,{body:h,icon:"/favicon.svg",tag:m,requireInteraction:v});C.onclick=()=>{window.focus(),Ve("active",w),C.close()};let _=f(),S=xi[a];_.sound&&S&&S.severity==="critical"&&fd()}function y(a,c,h){if(typeof Notification>"u"||Notification.permission!=="granted")return;let m=f();if(!m.enabled)return;let v=i(),w=[cd,hd,dd,ud];for(let _ of w){let S=_(a,c,h);S&&m.events[S.event]&&g(S)}let C=pd(a,c,h,v,u);C&&m.events[C.event]&&g(C)}function b(){return typeof Notification>"u"?V:(p(),n==="default"?P`
        <div class="notification-banner notification-banner--info">
          <span class="notification-banner-text">
            Enable browser notifications to stay informed about pipeline events
          </span>
          <sl-button size="small" variant="primary" @click=${()=>d()}>
            Enable Notifications
          </sl-button>
        </div>
      `:n==="denied"&&!s?P`
        <div class="notification-banner notification-banner--warning">
          <span class="notification-banner-text">
            Notifications blocked. Enable in browser settings.
          </span>
          <button class="notification-banner-dismiss" @click=${()=>{s=!0,r&&r()}}>&times;</button>
        </div>
      `:V)}function o(){_t&&(_t.close().catch(()=>{}),_t=null)}return{checkPermission:p,requestPermission:d,handleRunUpdate:y,renderBanner:b,getPreferences:f,setRerender:l,dispose:o}}var ir=globalThis,sr=ir.ShadowRoot&&(ir.ShadyCSS===void 0||ir.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,Ro=Symbol(),$a=new WeakMap,cs=class{constructor(t,i,n){if(this._$cssResult$=!0,n!==Ro)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=i}get styleSheet(){let t=this.o,i=this.t;if(sr&&t===void 0){let n=i!==void 0&&i.length===1;n&&(t=$a.get(i)),t===void 0&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),n&&$a.set(i,t))}return t}toString(){return this.cssText}},Oa=e=>new cs(typeof e=="string"?e:e+"",void 0,Ro),Z=(e,...t)=>{let i=e.length===1?e[0]:t.reduce((n,u,s)=>n+(r=>{if(r._$cssResult$===!0)return r.cssText;if(typeof r=="number")return r;throw Error("Value passed to 'css' function must be a 'css' function result: "+r+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(u)+e[s+1],e[0]);return new cs(i,e,Ro)},Ma=(e,t)=>{if(sr)e.adoptedStyleSheets=t.map(i=>i instanceof CSSStyleSheet?i:i.styleSheet);else for(let i of t){let n=document.createElement("style"),u=ir.litNonce;u!==void 0&&n.setAttribute("nonce",u),n.textContent=i.cssText,e.appendChild(n)}},$o=sr?e=>e:e=>e instanceof CSSStyleSheet?(t=>{let i="";for(let n of t.cssRules)i+=n.cssText;return Oa(i)})(e):e;var{is:md,defineProperty:_d,getOwnPropertyDescriptor:gd,getOwnPropertyNames:vd,getOwnPropertySymbols:bd,getPrototypeOf:yd}=Object,Dt=globalThis,Ba=Dt.trustedTypes,wd=Ba?Ba.emptyScript:"",Sd=Dt.reactiveElementPolyfillSupport,hs=(e,t)=>e,Rt={toAttribute(e,t){switch(t){case Boolean:e=e?wd:null;break;case Object:case Array:e=e==null?e:JSON.stringify(e)}return e},fromAttribute(e,t){let i=e;switch(t){case Boolean:i=e!==null;break;case Number:i=e===null?null:Number(e);break;case Object:case Array:try{i=JSON.parse(e)}catch{i=null}}return i}},rr=(e,t)=>!md(e,t),Pa={attribute:!0,type:String,converter:Rt,reflect:!1,useDefault:!1,hasChanged:rr};Symbol.metadata??(Symbol.metadata=Symbol("metadata")),Dt.litPropertyMetadata??(Dt.litPropertyMetadata=new WeakMap);var gt=class extends HTMLElement{static addInitializer(t){this._$Ei(),(this.l??(this.l=[])).push(t)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(t,i=Pa){if(i.state&&(i.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(t)&&((i=Object.create(i)).wrapped=!0),this.elementProperties.set(t,i),!i.noAccessor){let n=Symbol(),u=this.getPropertyDescriptor(t,n,i);u!==void 0&&_d(this.prototype,t,u)}}static getPropertyDescriptor(t,i,n){let{get:u,set:s}=gd(this.prototype,t)??{get(){return this[i]},set(r){this[i]=r}};return{get:u,set(r){let l=u?.call(this);s?.call(this,r),this.requestUpdate(t,l,n)},configurable:!0,enumerable:!0}}static getPropertyOptions(t){return this.elementProperties.get(t)??Pa}static _$Ei(){if(this.hasOwnProperty(hs("elementProperties")))return;let t=yd(this);t.finalize(),t.l!==void 0&&(this.l=[...t.l]),this.elementProperties=new Map(t.elementProperties)}static finalize(){if(this.hasOwnProperty(hs("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(hs("properties"))){let i=this.properties,n=[...vd(i),...bd(i)];for(let u of n)this.createProperty(u,i[u])}let t=this[Symbol.metadata];if(t!==null){let i=litPropertyMetadata.get(t);if(i!==void 0)for(let[n,u]of i)this.elementProperties.set(n,u)}this._$Eh=new Map;for(let[i,n]of this.elementProperties){let u=this._$Eu(i,n);u!==void 0&&this._$Eh.set(u,i)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(t){let i=[];if(Array.isArray(t)){let n=new Set(t.flat(1/0).reverse());for(let u of n)i.unshift($o(u))}else t!==void 0&&i.push($o(t));return i}static _$Eu(t,i){let n=i.attribute;return n===!1?void 0:typeof n=="string"?n:typeof t=="string"?t.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(t=>t(this))}addController(t){(this._$EO??(this._$EO=new Set)).add(t),this.renderRoot!==void 0&&this.isConnected&&t.hostConnected?.()}removeController(t){this._$EO?.delete(t)}_$E_(){let t=new Map,i=this.constructor.elementProperties;for(let n of i.keys())this.hasOwnProperty(n)&&(t.set(n,this[n]),delete this[n]);t.size>0&&(this._$Ep=t)}createRenderRoot(){let t=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Ma(t,this.constructor.elementStyles),t}connectedCallback(){this.renderRoot??(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),this._$EO?.forEach(t=>t.hostConnected?.())}enableUpdating(t){}disconnectedCallback(){this._$EO?.forEach(t=>t.hostDisconnected?.())}attributeChangedCallback(t,i,n){this._$AK(t,n)}_$ET(t,i){let n=this.constructor.elementProperties.get(t),u=this.constructor._$Eu(t,n);if(u!==void 0&&n.reflect===!0){let s=(n.converter?.toAttribute!==void 0?n.converter:Rt).toAttribute(i,n.type);this._$Em=t,s==null?this.removeAttribute(u):this.setAttribute(u,s),this._$Em=null}}_$AK(t,i){let n=this.constructor,u=n._$Eh.get(t);if(u!==void 0&&this._$Em!==u){let s=n.getPropertyOptions(u),r=typeof s.converter=="function"?{fromAttribute:s.converter}:s.converter?.fromAttribute!==void 0?s.converter:Rt;this._$Em=u;let l=r.fromAttribute(i,s.type);this[u]=l??this._$Ej?.get(u)??l,this._$Em=null}}requestUpdate(t,i,n,u=!1,s){if(t!==void 0){let r=this.constructor;if(u===!1&&(s=this[t]),n??(n=r.getPropertyOptions(t)),!((n.hasChanged??rr)(s,i)||n.useDefault&&n.reflect&&s===this._$Ej?.get(t)&&!this.hasAttribute(r._$Eu(t,n))))return;this.C(t,i,n)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(t,i,{useDefault:n,reflect:u,wrapped:s},r){n&&!(this._$Ej??(this._$Ej=new Map)).has(t)&&(this._$Ej.set(t,r??i??this[t]),s!==!0||r!==void 0)||(this._$AL.has(t)||(this.hasUpdated||n||(i=void 0),this._$AL.set(t,i)),u===!0&&this._$Em!==t&&(this._$Eq??(this._$Eq=new Set)).add(t))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(i){Promise.reject(i)}let t=this.scheduleUpdate();return t!=null&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??(this.renderRoot=this.createRenderRoot()),this._$Ep){for(let[u,s]of this._$Ep)this[u]=s;this._$Ep=void 0}let n=this.constructor.elementProperties;if(n.size>0)for(let[u,s]of n){let{wrapped:r}=s,l=this[u];r!==!0||this._$AL.has(u)||l===void 0||this.C(u,void 0,s,l)}}let t=!1,i=this._$AL;try{t=this.shouldUpdate(i),t?(this.willUpdate(i),this._$EO?.forEach(n=>n.hostUpdate?.()),this.update(i)):this._$EM()}catch(n){throw t=!1,this._$EM(),n}t&&this._$AE(i)}willUpdate(t){}_$AE(t){this._$EO?.forEach(i=>i.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(t)),this.updated(t)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(t){return!0}update(t){this._$Eq&&(this._$Eq=this._$Eq.forEach(i=>this._$ET(i,this[i]))),this._$EM()}updated(t){}firstUpdated(t){}};gt.elementStyles=[],gt.shadowRootOptions={mode:"open"},gt[hs("elementProperties")]=new Map,gt[hs("finalized")]=new Map,Sd?.({ReactiveElement:gt}),(Dt.reactiveElementVersions??(Dt.reactiveElementVersions=[])).push("2.1.2");var ds=globalThis,$t=class extends gt{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var i;let t=super.createRenderRoot();return(i=this.renderOptions).renderBefore??(i.renderBefore=t.firstChild),t}update(t){let i=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=Ps(i,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return Re}};$t._$litElement$=!0,$t.finalized=!0,ds.litElementHydrateSupport?.({LitElement:$t});var Cd=ds.litElementPolyfillSupport;Cd?.({LitElement:$t});(ds.litElementVersions??(ds.litElementVersions=[])).push("4.2.2");var Ia=Z`
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
`;var za=Object.defineProperty,xd=Object.defineProperties,kd=Object.getOwnPropertyDescriptor,Ed=Object.getOwnPropertyDescriptors,Ha=Object.getOwnPropertySymbols,Ad=Object.prototype.hasOwnProperty,Ld=Object.prototype.propertyIsEnumerable,Oo=(e,t)=>(t=Symbol[e])?t:Symbol.for("Symbol."+e),Mo=e=>{throw TypeError(e)},Fa=(e,t,i)=>t in e?za(e,t,{enumerable:!0,configurable:!0,writable:!0,value:i}):e[t]=i,Oe=(e,t)=>{for(var i in t||(t={}))Ad.call(t,i)&&Fa(e,i,t[i]);if(Ha)for(var i of Ha(t))Ld.call(t,i)&&Fa(e,i,t[i]);return e},vt=(e,t)=>xd(e,Ed(t)),A=(e,t,i,n)=>{for(var u=n>1?void 0:n?kd(t,i):t,s=e.length-1,r;s>=0;s--)(r=e[s])&&(u=(n?r(t,i,u):r(u))||u);return n&&u&&za(t,i,u),u},Na=(e,t,i)=>t.has(e)||Mo("Cannot "+i),Wa=(e,t,i)=>(Na(e,t,"read from private field"),i?i.call(e):t.get(e)),Ua=(e,t,i)=>t.has(e)?Mo("Cannot add the same private member more than once"):t instanceof WeakSet?t.add(e):t.set(e,i),ja=(e,t,i,n)=>(Na(e,t,"write to private field"),n?n.call(e,i):t.set(e,i),i),Td=function(e,t){this[0]=e,this[1]=t},Va=e=>{var t=e[Oo("asyncIterator")],i=!1,n,u={};return t==null?(t=e[Oo("iterator")](),n=s=>u[s]=r=>t[s](r)):(t=t.call(e),n=s=>u[s]=r=>{if(i){if(i=!1,s==="throw")throw r;return r}return i=!0,{done:!1,value:new Td(new Promise(l=>{var p=t[s](r);p instanceof Object||Mo("Object expected"),l(p)}),1)}}),u[Oo("iterator")]=()=>u,n("next"),"throw"in t?n("throw"):u.throw=s=>{throw s},"return"in t&&n("return"),u};var Ka=new Map,Dd=new WeakMap;function Rd(e){return e??{keyframes:[],options:{duration:0}}}function qa(e,t){return t.toLowerCase()==="rtl"?{keyframes:e.rtlKeyframes||e.keyframes,options:e.options}:e}function Ce(e,t){Ka.set(e,Rd(t))}function xe(e,t,i){let n=Dd.get(e);if(n?.[t])return qa(n[t],i.dir);let u=Ka.get(t);return u?qa(u,i.dir):{keyframes:[],options:{duration:0}}}function Be(e,t){return new Promise(i=>{function n(u){u.target===e&&(e.removeEventListener(t,n),i())}e.addEventListener(t,n)})}function ke(e,t,i){return new Promise(n=>{if(i?.duration===1/0)throw new Error("Promise-based animations must be finite.");let u=e.animate(t,vt(Oe({},i),{duration:$d()?0:i.duration}));u.addEventListener("cancel",n,{once:!0}),u.addEventListener("finish",n,{once:!0})})}function Bo(e){return e=e.toString().toLowerCase(),e.indexOf("ms")>-1?parseFloat(e):e.indexOf("s")>-1?parseFloat(e)*1e3:parseFloat(e)}function $d(){return window.matchMedia("(prefers-reduced-motion: reduce)").matches}function Te(e){return Promise.all(e.getAnimations().map(t=>new Promise(i=>{t.cancel(),requestAnimationFrame(i)})))}function Po(e,t){return e.map(i=>vt(Oe({},i),{height:i.height==="auto"?`${t}px`:i.height}))}var Io=new Set,ki=new Map,Jt,Ho="ltr",Fo="en",Ga=typeof MutationObserver<"u"&&typeof document<"u"&&typeof document.documentElement<"u";if(Ga){let e=new MutationObserver(Xa);Ho=document.documentElement.dir||"ltr",Fo=document.documentElement.lang||navigator.language,e.observe(document.documentElement,{attributes:!0,attributeFilter:["dir","lang"]})}function us(...e){e.map(t=>{let i=t.$code.toLowerCase();ki.has(i)?ki.set(i,Object.assign(Object.assign({},ki.get(i)),t)):ki.set(i,t),Jt||(Jt=t)}),Xa()}function Xa(){Ga&&(Ho=document.documentElement.dir||"ltr",Fo=document.documentElement.lang||navigator.language),[...Io.keys()].map(e=>{typeof e.requestUpdate=="function"&&e.requestUpdate()})}var or=class{constructor(t){this.host=t,this.host.addController(this)}hostConnected(){Io.add(this.host)}hostDisconnected(){Io.delete(this.host)}dir(){return`${this.host.dir||Ho}`.toLowerCase()}lang(){return`${this.host.lang||Fo}`.toLowerCase()}getTranslationData(t){var i,n;let u=new Intl.Locale(t.replace(/_/g,"-")),s=u?.language.toLowerCase(),r=(n=(i=u?.region)===null||i===void 0?void 0:i.toLowerCase())!==null&&n!==void 0?n:"",l=ki.get(`${s}-${r}`),p=ki.get(s);return{locale:u,language:s,region:r,primary:l,secondary:p}}exists(t,i){var n;let{primary:u,secondary:s}=this.getTranslationData((n=i.lang)!==null&&n!==void 0?n:this.lang());return i=Object.assign({includeFallback:!1},i),!!(u&&u[t]||s&&s[t]||i.includeFallback&&Jt&&Jt[t])}term(t,...i){let{primary:n,secondary:u}=this.getTranslationData(this.lang()),s;if(n&&n[t])s=n[t];else if(u&&u[t])s=u[t];else if(Jt&&Jt[t])s=Jt[t];else return console.error(`No translation found for: ${String(t)}`),String(t);return typeof s=="function"?s(...i):s}date(t,i){return t=new Date(t),new Intl.DateTimeFormat(this.lang(),i).format(t)}number(t,i){return t=Number(t),isNaN(t)?"":new Intl.NumberFormat(this.lang(),i).format(t)}relativeTime(t,i,n){return new Intl.RelativeTimeFormat(this.lang(),n).format(t,i)}};var Ya={$code:"en",$name:"English",$dir:"ltr",carousel:"Carousel",clearEntry:"Clear entry",close:"Close",copied:"Copied",copy:"Copy",currentValue:"Current value",error:"Error",goToSlide:(e,t)=>`Go to slide ${e} of ${t}`,hidePassword:"Hide password",loading:"Loading",nextSlide:"Next slide",numOptionsSelected:e=>e===0?"No options selected":e===1?"1 option selected":`${e} options selected`,previousSlide:"Previous slide",progress:"Progress",remove:"Remove",resize:"Resize",scrollToEnd:"Scroll to end",scrollToStart:"Scroll to start",selectAColorFromTheScreen:"Select a color from the screen",showPassword:"Show password",slideNum:e=>`Slide ${e}`,toggleColorFormat:"Toggle color format"};us(Ya);var Ja=Ya;var ge=class extends or{};us(Ja);var zo="";function Za(e){zo=e}function Qa(e=""){if(!zo){let t=[...document.getElementsByTagName("script")],i=t.find(n=>n.hasAttribute("data-shoelace"));if(i)Za(i.getAttribute("data-shoelace"));else{let n=t.find(s=>/shoelace(\.min)?\.js($|\?)/.test(s.src)||/shoelace-autoloader(\.min)?\.js($|\?)/.test(s.src)),u="";n&&(u=n.getAttribute("src")),Za(u.split("/").slice(0,-1).join("/"))}}return zo.replace(/\/$/,"")+(e?`/${e.replace(/^\//,"")}`:"")}var Od={name:"default",resolver:e=>Qa(`assets/icons/${e}.svg`)},el=Od;var tl={caret:`
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
  `},Md={name:"system",resolver:e=>e in tl?`data:image/svg+xml,${encodeURIComponent(tl[e])}`:""},il=Md;var Bd=[el,il],No=[];function sl(e){No.push(e)}function rl(e){No=No.filter(t=>t!==e)}function Wo(e){return Bd.find(t=>t.name===e)}var ol=Z`
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
`;function Q(e,t){let i=Oe({waitUntilFirstUpdate:!1},t);return(n,u)=>{let{update:s}=n,r=Array.isArray(e)?e:[e];n.update=function(l){r.forEach(p=>{let d=p;if(l.has(d)){let f=l.get(d),g=this[d];f!==g&&(!i.waitUntilFirstUpdate||this.hasUpdated)&&this[u](f,g)}}),s.call(this,l)}}}var ne=Z`
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
`;var Pd={attribute:!0,type:String,converter:Rt,reflect:!1,hasChanged:rr},Id=(e=Pd,t,i)=>{let{kind:n,metadata:u}=i,s=globalThis.litPropertyMetadata.get(u);if(s===void 0&&globalThis.litPropertyMetadata.set(u,s=new Map),n==="setter"&&((e=Object.create(e)).wrapped=!0),s.set(i.name,e),n==="accessor"){let{name:r}=i;return{set(l){let p=t.get.call(this);t.set.call(this,l),this.requestUpdate(r,p,e,!0,l)},init(l){return l!==void 0&&this.C(r,void 0,e,l),l}}}if(n==="setter"){let{name:r}=i;return function(l){let p=this[r];t.call(this,l),this.requestUpdate(r,p,e,!0,l)}}throw Error("Unsupported decorator location: "+n)};function M(e){return(t,i)=>typeof i=="object"?Id(e,t,i):((n,u,s)=>{let r=u.hasOwnProperty(s);return u.constructor.createProperty(s,n),r?Object.getOwnPropertyDescriptor(u,s):void 0})(e,t,i)}function de(e){return M({...e,state:!0,attribute:!1})}function nl(e){return(t,i)=>{let n=typeof t=="function"?t:t[i];Object.assign(n,e)}}var Zt=(e,t,i)=>(i.configurable=!0,i.enumerable=!0,Reflect.decorate&&typeof t!="object"&&Object.defineProperty(e,t,i),i);function ee(e,t){return(i,n,u)=>{let s=r=>r.renderRoot?.querySelector(e)??null;if(t){let{get:r,set:l}=typeof n=="object"?i:u??(()=>{let p=Symbol();return{get(){return this[p]},set(d){this[p]=d}}})();return Zt(i,n,{get(){let p=r.call(this);return p===void 0&&(p=s(this),(p!==null||this.hasUpdated)&&l.call(this,p)),p}})}return Zt(i,n,{get(){return s(this)}})}}var nr,te=class extends $t{constructor(){super(),Ua(this,nr,!1),this.initialReflectedProperties=new Map,Object.entries(this.constructor.dependencies).forEach(([e,t])=>{this.constructor.define(e,t)})}emit(e,t){let i=new CustomEvent(e,Oe({bubbles:!0,cancelable:!1,composed:!0,detail:{}},t));return this.dispatchEvent(i),i}static define(e,t=this,i={}){let n=customElements.get(e);if(!n){try{customElements.define(e,t,i)}catch{customElements.define(e,class extends t{},i)}return}let u=" (unknown version)",s=u;"version"in t&&t.version&&(u=" v"+t.version),"version"in n&&n.version&&(s=" v"+n.version),!(u&&s&&u===s)&&console.warn(`Attempted to register <${e}>${u}, but <${e}>${s} has already been registered.`)}attributeChangedCallback(e,t,i){Wa(this,nr)||(this.constructor.elementProperties.forEach((n,u)=>{n.reflect&&this[u]!=null&&this.initialReflectedProperties.set(u,this[u])}),ja(this,nr,!0)),super.attributeChangedCallback(e,t,i)}willUpdate(e){super.willUpdate(e),this.initialReflectedProperties.forEach((t,i)=>{e.has(i)&&this[i]==null&&(this[i]=t)})}};nr=new WeakMap;te.version="2.20.1";te.dependencies={};A([M()],te.prototype,"dir",2);A([M()],te.prototype,"lang",2);var{I:Zg}=xn;var al=(e,t)=>t===void 0?e?._$litType$!==void 0:e?._$litType$===t;var ll=e=>e.strings===void 0;var Hd={},cl=(e,t=Hd)=>e._$AH=t;var ps=Symbol(),ar=Symbol(),Uo,jo=new Map,Se=class extends te{constructor(){super(...arguments),this.initialRender=!1,this.svg=null,this.label="",this.library="default"}async resolveIcon(e,t){var i;let n;if(t?.spriteSheet)return this.svg=P`<svg part="svg">
        <use part="use" href="${e}"></use>
      </svg>`,this.svg;try{if(n=await fetch(e,{mode:"cors"}),!n.ok)return n.status===410?ps:ar}catch{return ar}try{let u=document.createElement("div");u.innerHTML=await n.text();let s=u.firstElementChild;if(((i=s?.tagName)==null?void 0:i.toLowerCase())!=="svg")return ps;Uo||(Uo=new DOMParser);let l=Uo.parseFromString(s.outerHTML,"text/html").body.querySelector("svg");return l?(l.part.add("svg"),document.adoptNode(l)):ps}catch{return ps}}connectedCallback(){super.connectedCallback(),sl(this)}firstUpdated(){this.initialRender=!0,this.setIcon()}disconnectedCallback(){super.disconnectedCallback(),rl(this)}getIconSource(){let e=Wo(this.library);return this.name&&e?{url:e.resolver(this.name),fromLibrary:!0}:{url:this.src,fromLibrary:!1}}handleLabelChange(){typeof this.label=="string"&&this.label.length>0?(this.setAttribute("role","img"),this.setAttribute("aria-label",this.label),this.removeAttribute("aria-hidden")):(this.removeAttribute("role"),this.removeAttribute("aria-label"),this.setAttribute("aria-hidden","true"))}async setIcon(){var e;let{url:t,fromLibrary:i}=this.getIconSource(),n=i?Wo(this.library):void 0;if(!t){this.svg=null;return}let u=jo.get(t);if(u||(u=this.resolveIcon(t,n),jo.set(t,u)),!this.initialRender)return;let s=await u;if(s===ar&&jo.delete(t),t===this.getIconSource().url){if(al(s)){if(this.svg=s,n){await this.updateComplete;let r=this.shadowRoot.querySelector("[part='svg']");typeof n.mutator=="function"&&r&&n.mutator(r)}return}switch(s){case ar:case ps:this.svg=null,this.emit("sl-error");break;default:this.svg=s.cloneNode(!0),(e=n?.mutator)==null||e.call(n,this.svg),this.emit("sl-load")}}}render(){return this.svg}};Se.styles=[ne,ol];A([de()],Se.prototype,"svg",2);A([M({reflect:!0})],Se.prototype,"name",2);A([M()],Se.prototype,"src",2);A([M()],Se.prototype,"label",2);A([M({reflect:!0})],Se.prototype,"library",2);A([Q("label")],Se.prototype,"handleLabelChange",1);A([Q(["name","src","library"])],Se.prototype,"setIcon",1);var ie=di(class extends Ct{constructor(e){if(super(e),e.type!==Ze.ATTRIBUTE||e.name!=="class"||e.strings?.length>2)throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.")}render(e){return" "+Object.keys(e).filter(t=>e[t]).join(" ")+" "}update(e,[t]){if(this.st===void 0){this.st=new Set,e.strings!==void 0&&(this.nt=new Set(e.strings.join(" ").split(/\s/).filter(n=>n!=="")));for(let n in t)t[n]&&!this.nt?.has(n)&&this.st.add(n);return this.render(t)}let i=e.element.classList;for(let n of this.st)n in t||(i.remove(n),this.st.delete(n));for(let n in t){let u=!!t[n];u===this.st.has(n)||this.nt?.has(n)||(u?(i.add(n),this.st.add(n)):(i.remove(n),this.st.delete(n)))}return Re}});var Ke=class extends te{constructor(){super(...arguments),this.localize=new ge(this),this.open=!1,this.disabled=!1}firstUpdated(){this.body.style.height=this.open?"auto":"0",this.open&&(this.details.open=!0),this.detailsObserver=new MutationObserver(e=>{for(let t of e)t.type==="attributes"&&t.attributeName==="open"&&(this.details.open?this.show():this.hide())}),this.detailsObserver.observe(this.details,{attributes:!0})}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this.detailsObserver)==null||e.disconnect()}handleSummaryClick(e){e.preventDefault(),this.disabled||(this.open?this.hide():this.show(),this.header.focus())}handleSummaryKeyDown(e){(e.key==="Enter"||e.key===" ")&&(e.preventDefault(),this.open?this.hide():this.show()),(e.key==="ArrowUp"||e.key==="ArrowLeft")&&(e.preventDefault(),this.hide()),(e.key==="ArrowDown"||e.key==="ArrowRight")&&(e.preventDefault(),this.show())}async handleOpenChange(){if(this.open){if(this.details.open=!0,this.emit("sl-show",{cancelable:!0}).defaultPrevented){this.open=!1,this.details.open=!1;return}await Te(this.body);let{keyframes:t,options:i}=xe(this,"details.show",{dir:this.localize.dir()});await ke(this.body,Po(t,this.body.scrollHeight),i),this.body.style.height="auto",this.emit("sl-after-show")}else{if(this.emit("sl-hide",{cancelable:!0}).defaultPrevented){this.details.open=!0,this.open=!0;return}await Te(this.body);let{keyframes:t,options:i}=xe(this,"details.hide",{dir:this.localize.dir()});await ke(this.body,Po(t,this.body.scrollHeight),i),this.body.style.height="auto",this.details.open=!1,this.emit("sl-after-hide")}}async show(){if(!(this.open||this.disabled))return this.open=!0,Be(this,"sl-after-show")}async hide(){if(!(!this.open||this.disabled))return this.open=!1,Be(this,"sl-after-hide")}render(){let e=this.localize.dir()==="rtl";return P`
      <details
        part="base"
        class=${ie({details:!0,"details--open":this.open,"details--disabled":this.disabled,"details--rtl":e})}
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
    `}};Ke.styles=[ne,Ia];Ke.dependencies={"sl-icon":Se};A([ee(".details")],Ke.prototype,"details",2);A([ee(".details__header")],Ke.prototype,"header",2);A([ee(".details__body")],Ke.prototype,"body",2);A([ee(".details__expand-icon-slot")],Ke.prototype,"expandIconSlot",2);A([M({type:Boolean,reflect:!0})],Ke.prototype,"open",2);A([M()],Ke.prototype,"summary",2);A([M({type:Boolean,reflect:!0})],Ke.prototype,"disabled",2);A([Q("open",{waitUntilFirstUpdate:!0})],Ke.prototype,"handleOpenChange",1);Ce("details.show",{keyframes:[{height:"0",opacity:"0"},{height:"auto",opacity:"1"}],options:{duration:250,easing:"linear"}});Ce("details.hide",{keyframes:[{height:"auto",opacity:"1"},{height:"0",opacity:"0"}],options:{duration:250,easing:"linear"}});Ke.define("sl-details");var hl=Z`
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
`;var dl=Z`
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
`;var pl=Symbol.for(""),Fd=e=>{if(e?.r===pl)return e?._$litStatic$};var Ei=(e,...t)=>({_$litStatic$:t.reduce((i,n,u)=>i+(s=>{if(s._$litStatic$!==void 0)return s._$litStatic$;throw Error(`Value passed to 'literal' function must be a 'literal' result: ${s}. Use 'unsafeStatic' to pass non-literal values, but
            take care to ensure page security.`)})(n)+e[u+1],e[0]),r:pl}),ul=new Map,Vo=e=>(t,...i)=>{let n=i.length,u,s,r=[],l=[],p,d=0,f=!1;for(;d<n;){for(p=t[d];d<n&&(s=i[d],(u=Fd(s))!==void 0);)p+=u+t[++d],f=!0;d!==n&&l.push(s),r.push(p),d++}if(d===n&&r.push(t[n]),f){let g=r.join("$$lit$$");(t=ul.get(g))===void 0&&(r.raw=r,ul.set(g,t=r)),i=l}return e(t,...i)},Ai=Vo(P),ab=Vo(yn),lb=Vo(wn);var J=e=>e??V;var we=class extends te{constructor(){super(...arguments),this.hasFocus=!1,this.label="",this.disabled=!1}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleClick(e){this.disabled&&(e.preventDefault(),e.stopPropagation())}click(){this.button.click()}focus(e){this.button.focus(e)}blur(){this.button.blur()}render(){let e=!!this.href,t=e?Ei`a`:Ei`button`;return Ai`
      <${t}
        part="base"
        class=${ie({"icon-button":!0,"icon-button--disabled":!e&&this.disabled,"icon-button--focused":this.hasFocus})}
        ?disabled=${J(e?void 0:this.disabled)}
        type=${J(e?void 0:"button")}
        href=${J(e?this.href:void 0)}
        target=${J(e?this.target:void 0)}
        download=${J(e?this.download:void 0)}
        rel=${J(e&&this.target?"noreferrer noopener":void 0)}
        role=${J(e?void 0:"button")}
        aria-disabled=${this.disabled?"true":"false"}
        aria-label="${this.label}"
        tabindex=${this.disabled?"-1":"0"}
        @blur=${this.handleBlur}
        @focus=${this.handleFocus}
        @click=${this.handleClick}
      >
        <sl-icon
          class="icon-button__icon"
          name=${J(this.name)}
          library=${J(this.library)}
          src=${J(this.src)}
          aria-hidden="true"
        ></sl-icon>
      </${t}>
    `}};we.styles=[ne,dl];we.dependencies={"sl-icon":Se};A([ee(".icon-button")],we.prototype,"button",2);A([de()],we.prototype,"hasFocus",2);A([M()],we.prototype,"name",2);A([M()],we.prototype,"library",2);A([M()],we.prototype,"src",2);A([M()],we.prototype,"href",2);A([M()],we.prototype,"target",2);A([M()],we.prototype,"download",2);A([M()],we.prototype,"label",2);A([M({type:Boolean,reflect:!0})],we.prototype,"disabled",2);var Ot=class extends te{constructor(){super(...arguments),this.localize=new ge(this),this.variant="neutral",this.size="medium",this.pill=!1,this.removable=!1}handleRemoveClick(){this.emit("sl-remove")}render(){return P`
      <span
        part="base"
        class=${ie({tag:!0,"tag--primary":this.variant==="primary","tag--success":this.variant==="success","tag--neutral":this.variant==="neutral","tag--warning":this.variant==="warning","tag--danger":this.variant==="danger","tag--text":this.variant==="text","tag--small":this.size==="small","tag--medium":this.size==="medium","tag--large":this.size==="large","tag--pill":this.pill,"tag--removable":this.removable})}
      >
        <slot part="content" class="tag__content"></slot>

        ${this.removable?P`
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
    `}};Ot.styles=[ne,hl];Ot.dependencies={"sl-icon-button":we};A([M({reflect:!0})],Ot.prototype,"variant",2);A([M({reflect:!0})],Ot.prototype,"size",2);A([M({type:Boolean,reflect:!0})],Ot.prototype,"pill",2);A([M({type:Boolean})],Ot.prototype,"removable",2);var fl=Z`
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
`;function zd(e,t){return{top:Math.round(e.getBoundingClientRect().top-t.getBoundingClientRect().top),left:Math.round(e.getBoundingClientRect().left-t.getBoundingClientRect().left)}}var qo=new Set;function Nd(){let e=document.documentElement.clientWidth;return Math.abs(window.innerWidth-e)}function Wd(){let e=Number(getComputedStyle(document.body).paddingRight.replace(/px/,""));return isNaN(e)||!e?0:e}function Ko(e){if(qo.add(e),!document.documentElement.classList.contains("sl-scroll-lock")){let t=Nd()+Wd(),i=getComputedStyle(document.documentElement).scrollbarGutter;(!i||i==="auto")&&(i="stable"),t<2&&(i=""),document.documentElement.style.setProperty("--sl-scroll-lock-gutter",i),document.documentElement.classList.add("sl-scroll-lock"),document.documentElement.style.setProperty("--sl-scroll-lock-size",`${t}px`)}}function Go(e){qo.delete(e),qo.size===0&&(document.documentElement.classList.remove("sl-scroll-lock"),document.documentElement.style.removeProperty("--sl-scroll-lock-size"))}function fs(e,t,i="vertical",n="smooth"){let u=zd(e,t),s=u.top+t.scrollTop,r=u.left+t.scrollLeft,l=t.scrollLeft,p=t.scrollLeft+t.offsetWidth,d=t.scrollTop,f=t.scrollTop+t.offsetHeight;(i==="horizontal"||i==="both")&&(r<l?t.scrollTo({left:r,behavior:n}):r+e.clientWidth>p&&t.scrollTo({left:r-t.offsetWidth+e.clientWidth,behavior:n})),(i==="vertical"||i==="both")&&(s<d?t.scrollTo({top:s,behavior:n}):s+e.clientHeight>f&&t.scrollTo({top:s-t.offsetHeight+e.clientHeight,behavior:n}))}var Mt=Z`
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
`;var ml=Z`
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
`;var lt=Math.min,Pe=Math.max,_s=Math.round,gs=Math.floor,et=e=>({x:e,y:e}),Ud={left:"right",right:"left",bottom:"top",top:"bottom"};function cr(e,t,i){return Pe(e,lt(t,i))}function Qt(e,t){return typeof e=="function"?e(t):e}function bt(e){return e.split("-")[0]}function ei(e){return e.split("-")[1]}function Xo(e){return e==="x"?"y":"x"}function hr(e){return e==="y"?"height":"width"}function ct(e){let t=e[0];return t==="t"||t==="b"?"y":"x"}function dr(e){return Xo(ct(e))}function vl(e,t,i){i===void 0&&(i=!1);let n=ei(e),u=dr(e),s=hr(u),r=u==="x"?n===(i?"end":"start")?"right":"left":n==="start"?"bottom":"top";return t.reference[s]>t.floating[s]&&(r=ms(r)),[r,ms(r)]}function bl(e){let t=ms(e);return[lr(e),t,lr(t)]}function lr(e){return e.includes("start")?e.replace("start","end"):e.replace("end","start")}var _l=["left","right"],gl=["right","left"],jd=["top","bottom"],Vd=["bottom","top"];function qd(e,t,i){switch(e){case"top":case"bottom":return i?t?gl:_l:t?_l:gl;case"left":case"right":return t?jd:Vd;default:return[]}}function yl(e,t,i,n){let u=ei(e),s=qd(bt(e),i==="start",n);return u&&(s=s.map(r=>r+"-"+u),t&&(s=s.concat(s.map(lr)))),s}function ms(e){let t=bt(e);return Ud[t]+e.slice(t.length)}function Kd(e){return{top:0,right:0,bottom:0,left:0,...e}}function Yo(e){return typeof e!="number"?Kd(e):{top:e,right:e,bottom:e,left:e}}function ti(e){let{x:t,y:i,width:n,height:u}=e;return{width:n,height:u,top:i,left:t,right:t+n,bottom:i+u,x:t,y:i}}function wl(e,t,i){let{reference:n,floating:u}=e,s=ct(t),r=dr(t),l=hr(r),p=bt(t),d=s==="y",f=n.x+n.width/2-u.width/2,g=n.y+n.height/2-u.height/2,y=n[l]/2-u[l]/2,b;switch(p){case"top":b={x:f,y:n.y-u.height};break;case"bottom":b={x:f,y:n.y+n.height};break;case"right":b={x:n.x+n.width,y:g};break;case"left":b={x:n.x-u.width,y:g};break;default:b={x:n.x,y:n.y}}switch(ei(t)){case"start":b[r]-=y*(i&&d?-1:1);break;case"end":b[r]+=y*(i&&d?-1:1);break}return b}async function Sl(e,t){var i;t===void 0&&(t={});let{x:n,y:u,platform:s,rects:r,elements:l,strategy:p}=e,{boundary:d="clippingAncestors",rootBoundary:f="viewport",elementContext:g="floating",altBoundary:y=!1,padding:b=0}=Qt(t,e),o=Yo(b),c=l[y?g==="floating"?"reference":"floating":g],h=ti(await s.getClippingRect({element:(i=await(s.isElement==null?void 0:s.isElement(c)))==null||i?c:c.contextElement||await(s.getDocumentElement==null?void 0:s.getDocumentElement(l.floating)),boundary:d,rootBoundary:f,strategy:p})),m=g==="floating"?{x:n,y:u,width:r.floating.width,height:r.floating.height}:r.reference,v=await(s.getOffsetParent==null?void 0:s.getOffsetParent(l.floating)),w=await(s.isElement==null?void 0:s.isElement(v))?await(s.getScale==null?void 0:s.getScale(v))||{x:1,y:1}:{x:1,y:1},C=ti(s.convertOffsetParentRelativeRectToViewportRelativeRect?await s.convertOffsetParentRelativeRectToViewportRelativeRect({elements:l,rect:m,offsetParent:v,strategy:p}):m);return{top:(h.top-C.top+o.top)/w.y,bottom:(C.bottom-h.bottom+o.bottom)/w.y,left:(h.left-C.left+o.left)/w.x,right:(C.right-h.right+o.right)/w.x}}var Gd=50,Cl=async(e,t,i)=>{let{placement:n="bottom",strategy:u="absolute",middleware:s=[],platform:r}=i,l=r.detectOverflow?r:{...r,detectOverflow:Sl},p=await(r.isRTL==null?void 0:r.isRTL(t)),d=await r.getElementRects({reference:e,floating:t,strategy:u}),{x:f,y:g}=wl(d,n,p),y=n,b=0,o={};for(let a=0;a<s.length;a++){let c=s[a];if(!c)continue;let{name:h,fn:m}=c,{x:v,y:w,data:C,reset:_}=await m({x:f,y:g,initialPlacement:n,placement:y,strategy:u,middlewareData:o,rects:d,platform:l,elements:{reference:e,floating:t}});f=v??f,g=w??g,o[h]={...o[h],...C},_&&b<Gd&&(b++,typeof _=="object"&&(_.placement&&(y=_.placement),_.rects&&(d=_.rects===!0?await r.getElementRects({reference:e,floating:t,strategy:u}):_.rects),{x:f,y:g}=wl(d,y,p)),a=-1)}return{x:f,y:g,placement:y,strategy:u,middlewareData:o}},xl=e=>({name:"arrow",options:e,async fn(t){let{x:i,y:n,placement:u,rects:s,platform:r,elements:l,middlewareData:p}=t,{element:d,padding:f=0}=Qt(e,t)||{};if(d==null)return{};let g=Yo(f),y={x:i,y:n},b=dr(u),o=hr(b),a=await r.getDimensions(d),c=b==="y",h=c?"top":"left",m=c?"bottom":"right",v=c?"clientHeight":"clientWidth",w=s.reference[o]+s.reference[b]-y[b]-s.floating[o],C=y[b]-s.reference[b],_=await(r.getOffsetParent==null?void 0:r.getOffsetParent(d)),S=_?_[v]:0;(!S||!await(r.isElement==null?void 0:r.isElement(_)))&&(S=l.floating[v]||s.floating[o]);let T=w/2-C/2,$=S/2-a[o]/2-1,D=lt(g[h],$),O=lt(g[m],$),z=D,I=S-a[o]-O,B=S/2-a[o]/2+T,H=cr(z,B,I),x=!p.arrow&&ei(u)!=null&&B!==H&&s.reference[o]/2-(B<z?D:O)-a[o]/2<0,E=x?B<z?B-z:B-I:0;return{[b]:y[b]+E,data:{[b]:H,centerOffset:B-H-E,...x&&{alignmentOffset:E}},reset:x}}});var kl=function(e){return e===void 0&&(e={}),{name:"flip",options:e,async fn(t){var i,n;let{placement:u,middlewareData:s,rects:r,initialPlacement:l,platform:p,elements:d}=t,{mainAxis:f=!0,crossAxis:g=!0,fallbackPlacements:y,fallbackStrategy:b="bestFit",fallbackAxisSideDirection:o="none",flipAlignment:a=!0,...c}=Qt(e,t);if((i=s.arrow)!=null&&i.alignmentOffset)return{};let h=bt(u),m=ct(l),v=bt(l)===l,w=await(p.isRTL==null?void 0:p.isRTL(d.floating)),C=y||(v||!a?[ms(l)]:bl(l)),_=o!=="none";!y&&_&&C.push(...yl(l,a,o,w));let S=[l,...C],T=await p.detectOverflow(t,c),$=[],D=((n=s.flip)==null?void 0:n.overflows)||[];if(f&&$.push(T[h]),g){let B=vl(u,r,w);$.push(T[B[0]],T[B[1]])}if(D=[...D,{placement:u,overflows:$}],!$.every(B=>B<=0)){var O,z;let B=(((O=s.flip)==null?void 0:O.index)||0)+1,H=S[B];if(H&&(!(g==="alignment"?m!==ct(H):!1)||D.every(L=>ct(L.placement)===m?L.overflows[0]>0:!0)))return{data:{index:B,overflows:D},reset:{placement:H}};let x=(z=D.filter(E=>E.overflows[0]<=0).sort((E,L)=>E.overflows[1]-L.overflows[1])[0])==null?void 0:z.placement;if(!x)switch(b){case"bestFit":{var I;let E=(I=D.filter(L=>{if(_){let R=ct(L.placement);return R===m||R==="y"}return!0}).map(L=>[L.placement,L.overflows.filter(R=>R>0).reduce((R,N)=>R+N,0)]).sort((L,R)=>L[1]-R[1])[0])==null?void 0:I[0];E&&(x=E);break}case"initialPlacement":x=l;break}if(u!==x)return{reset:{placement:x}}}return{}}}};var Xd=new Set(["left","top"]);async function Yd(e,t){let{placement:i,platform:n,elements:u}=e,s=await(n.isRTL==null?void 0:n.isRTL(u.floating)),r=bt(i),l=ei(i),p=ct(i)==="y",d=Xd.has(r)?-1:1,f=s&&p?-1:1,g=Qt(t,e),{mainAxis:y,crossAxis:b,alignmentAxis:o}=typeof g=="number"?{mainAxis:g,crossAxis:0,alignmentAxis:null}:{mainAxis:g.mainAxis||0,crossAxis:g.crossAxis||0,alignmentAxis:g.alignmentAxis};return l&&typeof o=="number"&&(b=l==="end"?o*-1:o),p?{x:b*f,y:y*d}:{x:y*d,y:b*f}}var El=function(e){return e===void 0&&(e=0),{name:"offset",options:e,async fn(t){var i,n;let{x:u,y:s,placement:r,middlewareData:l}=t,p=await Yd(t,e);return r===((i=l.offset)==null?void 0:i.placement)&&(n=l.arrow)!=null&&n.alignmentOffset?{}:{x:u+p.x,y:s+p.y,data:{...p,placement:r}}}}},Al=function(e){return e===void 0&&(e={}),{name:"shift",options:e,async fn(t){let{x:i,y:n,placement:u,platform:s}=t,{mainAxis:r=!0,crossAxis:l=!1,limiter:p={fn:h=>{let{x:m,y:v}=h;return{x:m,y:v}}},...d}=Qt(e,t),f={x:i,y:n},g=await s.detectOverflow(t,d),y=ct(bt(u)),b=Xo(y),o=f[b],a=f[y];if(r){let h=b==="y"?"top":"left",m=b==="y"?"bottom":"right",v=o+g[h],w=o-g[m];o=cr(v,o,w)}if(l){let h=y==="y"?"top":"left",m=y==="y"?"bottom":"right",v=a+g[h],w=a-g[m];a=cr(v,a,w)}let c=p.fn({...t,[b]:o,[y]:a});return{...c,data:{x:c.x-i,y:c.y-n,enabled:{[b]:r,[y]:l}}}}}};var Ll=function(e){return e===void 0&&(e={}),{name:"size",options:e,async fn(t){var i,n;let{placement:u,rects:s,platform:r,elements:l}=t,{apply:p=()=>{},...d}=Qt(e,t),f=await r.detectOverflow(t,d),g=bt(u),y=ei(u),b=ct(u)==="y",{width:o,height:a}=s.floating,c,h;g==="top"||g==="bottom"?(c=g,h=y===(await(r.isRTL==null?void 0:r.isRTL(l.floating))?"start":"end")?"left":"right"):(h=g,c=y==="end"?"top":"bottom");let m=a-f.top-f.bottom,v=o-f.left-f.right,w=lt(a-f[c],m),C=lt(o-f[h],v),_=!t.middlewareData.shift,S=w,T=C;if((i=t.middlewareData.shift)!=null&&i.enabled.x&&(T=v),(n=t.middlewareData.shift)!=null&&n.enabled.y&&(S=m),_&&!y){let D=Pe(f.left,0),O=Pe(f.right,0),z=Pe(f.top,0),I=Pe(f.bottom,0);b?T=o-2*(D!==0||O!==0?D+O:Pe(f.left,f.right)):S=a-2*(z!==0||I!==0?z+I:Pe(f.top,f.bottom))}await p({...t,availableWidth:T,availableHeight:S});let $=await r.getDimensions(l.floating);return o!==$.width||a!==$.height?{reset:{rects:!0}}:{}}}};function ur(){return typeof window<"u"}function si(e){return Dl(e)?(e.nodeName||"").toLowerCase():"#document"}function Fe(e){var t;return(e==null||(t=e.ownerDocument)==null?void 0:t.defaultView)||window}function tt(e){var t;return(t=(Dl(e)?e.ownerDocument:e.document)||window.document)==null?void 0:t.documentElement}function Dl(e){return ur()?e instanceof Node||e instanceof Fe(e).Node:!1}function Ge(e){return ur()?e instanceof Element||e instanceof Fe(e).Element:!1}function ht(e){return ur()?e instanceof HTMLElement||e instanceof Fe(e).HTMLElement:!1}function Tl(e){return!ur()||typeof ShadowRoot>"u"?!1:e instanceof ShadowRoot||e instanceof Fe(e).ShadowRoot}function Ti(e){let{overflow:t,overflowX:i,overflowY:n,display:u}=Xe(e);return/auto|scroll|overlay|hidden|clip/.test(t+n+i)&&u!=="inline"&&u!=="contents"}function Rl(e){return/^(table|td|th)$/.test(si(e))}function vs(e){try{if(e.matches(":popover-open"))return!0}catch{}try{return e.matches(":modal")}catch{return!1}}var Jd=/transform|translate|scale|rotate|perspective|filter/,Zd=/paint|layout|strict|content/,ii=e=>!!e&&e!=="none",Jo;function Di(e){let t=Ge(e)?Xe(e):e;return ii(t.transform)||ii(t.translate)||ii(t.scale)||ii(t.rotate)||ii(t.perspective)||!pr()&&(ii(t.backdropFilter)||ii(t.filter))||Jd.test(t.willChange||"")||Zd.test(t.contain||"")}function $l(e){let t=yt(e);for(;ht(t)&&!ri(t);){if(Di(t))return t;if(vs(t))return null;t=yt(t)}return null}function pr(){return Jo==null&&(Jo=typeof CSS<"u"&&CSS.supports&&CSS.supports("-webkit-backdrop-filter","none")),Jo}function ri(e){return/^(html|body|#document)$/.test(si(e))}function Xe(e){return Fe(e).getComputedStyle(e)}function bs(e){return Ge(e)?{scrollLeft:e.scrollLeft,scrollTop:e.scrollTop}:{scrollLeft:e.scrollX,scrollTop:e.scrollY}}function yt(e){if(si(e)==="html")return e;let t=e.assignedSlot||e.parentNode||Tl(e)&&e.host||tt(e);return Tl(t)?t.host:t}function Ol(e){let t=yt(e);return ri(t)?e.ownerDocument?e.ownerDocument.body:e.body:ht(t)&&Ti(t)?t:Ol(t)}function Li(e,t,i){var n;t===void 0&&(t=[]),i===void 0&&(i=!0);let u=Ol(e),s=u===((n=e.ownerDocument)==null?void 0:n.body),r=Fe(u);if(s){let l=fr(r);return t.concat(r,r.visualViewport||[],Ti(u)?u:[],l&&i?Li(l):[])}else return t.concat(u,Li(u,[],i))}function fr(e){return e.parent&&Object.getPrototypeOf(e.parent)?e.frameElement:null}function Il(e){let t=Xe(e),i=parseFloat(t.width)||0,n=parseFloat(t.height)||0,u=ht(e),s=u?e.offsetWidth:i,r=u?e.offsetHeight:n,l=_s(i)!==s||_s(n)!==r;return l&&(i=s,n=r),{width:i,height:n,$:l}}function Qo(e){return Ge(e)?e:e.contextElement}function Ri(e){let t=Qo(e);if(!ht(t))return et(1);let i=t.getBoundingClientRect(),{width:n,height:u,$:s}=Il(t),r=(s?_s(i.width):i.width)/n,l=(s?_s(i.height):i.height)/u;return(!r||!Number.isFinite(r))&&(r=1),(!l||!Number.isFinite(l))&&(l=1),{x:r,y:l}}var Qd=et(0);function Hl(e){let t=Fe(e);return!pr()||!t.visualViewport?Qd:{x:t.visualViewport.offsetLeft,y:t.visualViewport.offsetTop}}function eu(e,t,i){return t===void 0&&(t=!1),!i||t&&i!==Fe(e)?!1:t}function oi(e,t,i,n){t===void 0&&(t=!1),i===void 0&&(i=!1);let u=e.getBoundingClientRect(),s=Qo(e),r=et(1);t&&(n?Ge(n)&&(r=Ri(n)):r=Ri(e));let l=eu(s,i,n)?Hl(s):et(0),p=(u.left+l.x)/r.x,d=(u.top+l.y)/r.y,f=u.width/r.x,g=u.height/r.y;if(s){let y=Fe(s),b=n&&Ge(n)?Fe(n):n,o=y,a=fr(o);for(;a&&n&&b!==o;){let c=Ri(a),h=a.getBoundingClientRect(),m=Xe(a),v=h.left+(a.clientLeft+parseFloat(m.paddingLeft))*c.x,w=h.top+(a.clientTop+parseFloat(m.paddingTop))*c.y;p*=c.x,d*=c.y,f*=c.x,g*=c.y,p+=v,d+=w,o=Fe(a),a=fr(o)}}return ti({width:f,height:g,x:p,y:d})}function mr(e,t){let i=bs(e).scrollLeft;return t?t.left+i:oi(tt(e)).left+i}function Fl(e,t){let i=e.getBoundingClientRect(),n=i.left+t.scrollLeft-mr(e,i),u=i.top+t.scrollTop;return{x:n,y:u}}function tu(e){let{elements:t,rect:i,offsetParent:n,strategy:u}=e,s=u==="fixed",r=tt(n),l=t?vs(t.floating):!1;if(n===r||l&&s)return i;let p={scrollLeft:0,scrollTop:0},d=et(1),f=et(0),g=ht(n);if((g||!g&&!s)&&((si(n)!=="body"||Ti(r))&&(p=bs(n)),g)){let b=oi(n);d=Ri(n),f.x=b.x+n.clientLeft,f.y=b.y+n.clientTop}let y=r&&!g&&!s?Fl(r,p):et(0);return{width:i.width*d.x,height:i.height*d.y,x:i.x*d.x-p.scrollLeft*d.x+f.x+y.x,y:i.y*d.y-p.scrollTop*d.y+f.y+y.y}}function iu(e){return Array.from(e.getClientRects())}function su(e){let t=tt(e),i=bs(e),n=e.ownerDocument.body,u=Pe(t.scrollWidth,t.clientWidth,n.scrollWidth,n.clientWidth),s=Pe(t.scrollHeight,t.clientHeight,n.scrollHeight,n.clientHeight),r=-i.scrollLeft+mr(e),l=-i.scrollTop;return Xe(n).direction==="rtl"&&(r+=Pe(t.clientWidth,n.clientWidth)-u),{width:u,height:s,x:r,y:l}}var Ml=25;function ru(e,t){let i=Fe(e),n=tt(e),u=i.visualViewport,s=n.clientWidth,r=n.clientHeight,l=0,p=0;if(u){s=u.width,r=u.height;let f=pr();(!f||f&&t==="fixed")&&(l=u.offsetLeft,p=u.offsetTop)}let d=mr(n);if(d<=0){let f=n.ownerDocument,g=f.body,y=getComputedStyle(g),b=f.compatMode==="CSS1Compat"&&parseFloat(y.marginLeft)+parseFloat(y.marginRight)||0,o=Math.abs(n.clientWidth-g.clientWidth-b);o<=Ml&&(s-=o)}else d<=Ml&&(s+=d);return{width:s,height:r,x:l,y:p}}function ou(e,t){let i=oi(e,!0,t==="fixed"),n=i.top+e.clientTop,u=i.left+e.clientLeft,s=ht(e)?Ri(e):et(1),r=e.clientWidth*s.x,l=e.clientHeight*s.y,p=u*s.x,d=n*s.y;return{width:r,height:l,x:p,y:d}}function Bl(e,t,i){let n;if(t==="viewport")n=ru(e,i);else if(t==="document")n=su(tt(e));else if(Ge(t))n=ou(t,i);else{let u=Hl(e);n={x:t.x-u.x,y:t.y-u.y,width:t.width,height:t.height}}return ti(n)}function zl(e,t){let i=yt(e);return i===t||!Ge(i)||ri(i)?!1:Xe(i).position==="fixed"||zl(i,t)}function nu(e,t){let i=t.get(e);if(i)return i;let n=Li(e,[],!1).filter(l=>Ge(l)&&si(l)!=="body"),u=null,s=Xe(e).position==="fixed",r=s?yt(e):e;for(;Ge(r)&&!ri(r);){let l=Xe(r),p=Di(r);!p&&l.position==="fixed"&&(u=null),(s?!p&&!u:!p&&l.position==="static"&&!!u&&(u.position==="absolute"||u.position==="fixed")||Ti(r)&&!p&&zl(e,r))?n=n.filter(f=>f!==r):u=l,r=yt(r)}return t.set(e,n),n}function au(e){let{element:t,boundary:i,rootBoundary:n,strategy:u}=e,r=[...i==="clippingAncestors"?vs(t)?[]:nu(t,this._c):[].concat(i),n],l=Bl(t,r[0],u),p=l.top,d=l.right,f=l.bottom,g=l.left;for(let y=1;y<r.length;y++){let b=Bl(t,r[y],u);p=Pe(b.top,p),d=lt(b.right,d),f=lt(b.bottom,f),g=Pe(b.left,g)}return{width:d-g,height:f-p,x:g,y:p}}function lu(e){let{width:t,height:i}=Il(e);return{width:t,height:i}}function cu(e,t,i){let n=ht(t),u=tt(t),s=i==="fixed",r=oi(e,!0,s,t),l={scrollLeft:0,scrollTop:0},p=et(0);function d(){p.x=mr(u)}if(n||!n&&!s)if((si(t)!=="body"||Ti(u))&&(l=bs(t)),n){let b=oi(t,!0,s,t);p.x=b.x+t.clientLeft,p.y=b.y+t.clientTop}else u&&d();s&&!n&&u&&d();let f=u&&!n&&!s?Fl(u,l):et(0),g=r.left+l.scrollLeft-p.x-f.x,y=r.top+l.scrollTop-p.y-f.y;return{x:g,y,width:r.width,height:r.height}}function Zo(e){return Xe(e).position==="static"}function Pl(e,t){if(!ht(e)||Xe(e).position==="fixed")return null;if(t)return t(e);let i=e.offsetParent;return tt(e)===i&&(i=i.ownerDocument.body),i}function Nl(e,t){let i=Fe(e);if(vs(e))return i;if(!ht(e)){let u=yt(e);for(;u&&!ri(u);){if(Ge(u)&&!Zo(u))return u;u=yt(u)}return i}let n=Pl(e,t);for(;n&&Rl(n)&&Zo(n);)n=Pl(n,t);return n&&ri(n)&&Zo(n)&&!Di(n)?i:n||$l(e)||i}var hu=async function(e){let t=this.getOffsetParent||Nl,i=this.getDimensions,n=await i(e.floating);return{reference:cu(e.reference,await t(e.floating),e.strategy),floating:{x:0,y:0,width:n.width,height:n.height}}};function du(e){return Xe(e).direction==="rtl"}var ys={convertOffsetParentRelativeRectToViewportRelativeRect:tu,getDocumentElement:tt,getClippingRect:au,getOffsetParent:Nl,getElementRects:hu,getClientRects:iu,getDimensions:lu,getScale:Ri,isElement:Ge,isRTL:du};function Wl(e,t){return e.x===t.x&&e.y===t.y&&e.width===t.width&&e.height===t.height}function uu(e,t){let i=null,n,u=tt(e);function s(){var l;clearTimeout(n),(l=i)==null||l.disconnect(),i=null}function r(l,p){l===void 0&&(l=!1),p===void 0&&(p=1),s();let d=e.getBoundingClientRect(),{left:f,top:g,width:y,height:b}=d;if(l||t(),!y||!b)return;let o=gs(g),a=gs(u.clientWidth-(f+y)),c=gs(u.clientHeight-(g+b)),h=gs(f),v={rootMargin:-o+"px "+-a+"px "+-c+"px "+-h+"px",threshold:Pe(0,lt(1,p))||1},w=!0;function C(_){let S=_[0].intersectionRatio;if(S!==p){if(!w)return r();S?r(!1,S):n=setTimeout(()=>{r(!1,1e-7)},1e3)}S===1&&!Wl(d,e.getBoundingClientRect())&&r(),w=!1}try{i=new IntersectionObserver(C,{...v,root:u.ownerDocument})}catch{i=new IntersectionObserver(C,v)}i.observe(e)}return r(!0),s}function Ul(e,t,i,n){n===void 0&&(n={});let{ancestorScroll:u=!0,ancestorResize:s=!0,elementResize:r=typeof ResizeObserver=="function",layoutShift:l=typeof IntersectionObserver=="function",animationFrame:p=!1}=n,d=Qo(e),f=u||s?[...d?Li(d):[],...t?Li(t):[]]:[];f.forEach(h=>{u&&h.addEventListener("scroll",i,{passive:!0}),s&&h.addEventListener("resize",i)});let g=d&&l?uu(d,i):null,y=-1,b=null;r&&(b=new ResizeObserver(h=>{let[m]=h;m&&m.target===d&&b&&t&&(b.unobserve(t),cancelAnimationFrame(y),y=requestAnimationFrame(()=>{var v;(v=b)==null||v.observe(t)})),i()}),d&&!p&&b.observe(d),t&&b.observe(t));let o,a=p?oi(e):null;p&&c();function c(){let h=oi(e);a&&!Wl(a,h)&&i(),a=h,o=requestAnimationFrame(c)}return i(),()=>{var h;f.forEach(m=>{u&&m.removeEventListener("scroll",i),s&&m.removeEventListener("resize",i)}),g?.(),(h=b)==null||h.disconnect(),b=null,p&&cancelAnimationFrame(o)}}var jl=El;var Vl=Al,ql=kl,en=Ll;var Kl=xl;var Gl=(e,t,i)=>{let n=new Map,u={platform:ys,...i},s={...u.platform,_c:n};return Cl(e,t,{...u,platform:s})};function Xl(e){return pu(e)}function tn(e){return e.assignedSlot?e.assignedSlot:e.parentNode instanceof ShadowRoot?e.parentNode.host:e.parentNode}function pu(e){for(let t=e;t;t=tn(t))if(t instanceof Element&&getComputedStyle(t).display==="none")return null;for(let t=tn(e);t;t=tn(t)){if(!(t instanceof Element))continue;let i=getComputedStyle(t);if(i.display!=="contents"&&(i.position!=="static"||Di(i)||t.tagName==="BODY"))return t}return null}function fu(e){return e!==null&&typeof e=="object"&&"getBoundingClientRect"in e&&("contextElement"in e?e.contextElement instanceof Element:!0)}var _e=class extends te{constructor(){super(...arguments),this.localize=new ge(this),this.active=!1,this.placement="top",this.strategy="absolute",this.distance=0,this.skidding=0,this.arrow=!1,this.arrowPlacement="anchor",this.arrowPadding=10,this.flip=!1,this.flipFallbackPlacements="",this.flipFallbackStrategy="best-fit",this.flipPadding=0,this.shift=!1,this.shiftPadding=0,this.autoSizePadding=0,this.hoverBridge=!1,this.updateHoverBridge=()=>{if(this.hoverBridge&&this.anchorEl){let e=this.anchorEl.getBoundingClientRect(),t=this.popup.getBoundingClientRect(),i=this.placement.includes("top")||this.placement.includes("bottom"),n=0,u=0,s=0,r=0,l=0,p=0,d=0,f=0;i?e.top<t.top?(n=e.left,u=e.bottom,s=e.right,r=e.bottom,l=t.left,p=t.top,d=t.right,f=t.top):(n=t.left,u=t.bottom,s=t.right,r=t.bottom,l=e.left,p=e.top,d=e.right,f=e.top):e.left<t.left?(n=e.right,u=e.top,s=t.left,r=t.top,l=e.right,p=e.bottom,d=t.left,f=t.bottom):(n=t.right,u=t.top,s=e.left,r=e.top,l=t.right,p=t.bottom,d=e.left,f=e.bottom),this.style.setProperty("--hover-bridge-top-left-x",`${n}px`),this.style.setProperty("--hover-bridge-top-left-y",`${u}px`),this.style.setProperty("--hover-bridge-top-right-x",`${s}px`),this.style.setProperty("--hover-bridge-top-right-y",`${r}px`),this.style.setProperty("--hover-bridge-bottom-left-x",`${l}px`),this.style.setProperty("--hover-bridge-bottom-left-y",`${p}px`),this.style.setProperty("--hover-bridge-bottom-right-x",`${d}px`),this.style.setProperty("--hover-bridge-bottom-right-y",`${f}px`)}}}async connectedCallback(){super.connectedCallback(),await this.updateComplete,this.start()}disconnectedCallback(){super.disconnectedCallback(),this.stop()}async updated(e){super.updated(e),e.has("active")&&(this.active?this.start():this.stop()),e.has("anchor")&&this.handleAnchorChange(),this.active&&(await this.updateComplete,this.reposition())}async handleAnchorChange(){if(await this.stop(),this.anchor&&typeof this.anchor=="string"){let e=this.getRootNode();this.anchorEl=e.getElementById(this.anchor)}else this.anchor instanceof Element||fu(this.anchor)?this.anchorEl=this.anchor:this.anchorEl=this.querySelector('[slot="anchor"]');this.anchorEl instanceof HTMLSlotElement&&(this.anchorEl=this.anchorEl.assignedElements({flatten:!0})[0]),this.anchorEl&&this.active&&this.start()}start(){!this.anchorEl||!this.active||(this.cleanup=Ul(this.anchorEl,this.popup,()=>{this.reposition()}))}async stop(){return new Promise(e=>{this.cleanup?(this.cleanup(),this.cleanup=void 0,this.removeAttribute("data-current-placement"),this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height"),requestAnimationFrame(()=>e())):e()})}reposition(){if(!this.active||!this.anchorEl)return;let e=[jl({mainAxis:this.distance,crossAxis:this.skidding})];this.sync?e.push(en({apply:({rects:i})=>{let n=this.sync==="width"||this.sync==="both",u=this.sync==="height"||this.sync==="both";this.popup.style.width=n?`${i.reference.width}px`:"",this.popup.style.height=u?`${i.reference.height}px`:""}})):(this.popup.style.width="",this.popup.style.height=""),this.flip&&e.push(ql({boundary:this.flipBoundary,fallbackPlacements:this.flipFallbackPlacements,fallbackStrategy:this.flipFallbackStrategy==="best-fit"?"bestFit":"initialPlacement",padding:this.flipPadding})),this.shift&&e.push(Vl({boundary:this.shiftBoundary,padding:this.shiftPadding})),this.autoSize?e.push(en({boundary:this.autoSizeBoundary,padding:this.autoSizePadding,apply:({availableWidth:i,availableHeight:n})=>{this.autoSize==="vertical"||this.autoSize==="both"?this.style.setProperty("--auto-size-available-height",`${n}px`):this.style.removeProperty("--auto-size-available-height"),this.autoSize==="horizontal"||this.autoSize==="both"?this.style.setProperty("--auto-size-available-width",`${i}px`):this.style.removeProperty("--auto-size-available-width")}})):(this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height")),this.arrow&&e.push(Kl({element:this.arrowEl,padding:this.arrowPadding}));let t=this.strategy==="absolute"?i=>ys.getOffsetParent(i,Xl):ys.getOffsetParent;Gl(this.anchorEl,this.popup,{placement:this.placement,middleware:e,strategy:this.strategy,platform:vt(Oe({},ys),{getOffsetParent:t})}).then(({x:i,y:n,middlewareData:u,placement:s})=>{let r=this.localize.dir()==="rtl",l={top:"bottom",right:"left",bottom:"top",left:"right"}[s.split("-")[0]];if(this.setAttribute("data-current-placement",s),Object.assign(this.popup.style,{left:`${i}px`,top:`${n}px`}),this.arrow){let p=u.arrow.x,d=u.arrow.y,f="",g="",y="",b="";if(this.arrowPlacement==="start"){let o=typeof p=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";f=typeof d=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"",g=r?o:"",b=r?"":o}else if(this.arrowPlacement==="end"){let o=typeof p=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";g=r?"":o,b=r?o:"",y=typeof d=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:""}else this.arrowPlacement==="center"?(b=typeof p=="number"?"calc(50% - var(--arrow-size-diagonal))":"",f=typeof d=="number"?"calc(50% - var(--arrow-size-diagonal))":""):(b=typeof p=="number"?`${p}px`:"",f=typeof d=="number"?`${d}px`:"");Object.assign(this.arrowEl.style,{top:f,right:g,bottom:y,left:b,[l]:"calc(var(--arrow-size-diagonal) * -1)"})}}),requestAnimationFrame(()=>this.updateHoverBridge()),this.emit("sl-reposition")}render(){return P`
      <slot name="anchor" @slotchange=${this.handleAnchorChange}></slot>

      <span
        part="hover-bridge"
        class=${ie({"popup-hover-bridge":!0,"popup-hover-bridge--visible":this.hoverBridge&&this.active})}
      ></span>

      <div
        part="popup"
        class=${ie({popup:!0,"popup--active":this.active,"popup--fixed":this.strategy==="fixed","popup--has-arrow":this.arrow})}
      >
        <slot></slot>
        ${this.arrow?P`<div part="arrow" class="popup__arrow" role="presentation"></div>`:""}
      </div>
    `}};_e.styles=[ne,ml];A([ee(".popup")],_e.prototype,"popup",2);A([ee(".popup__arrow")],_e.prototype,"arrowEl",2);A([M()],_e.prototype,"anchor",2);A([M({type:Boolean,reflect:!0})],_e.prototype,"active",2);A([M({reflect:!0})],_e.prototype,"placement",2);A([M({reflect:!0})],_e.prototype,"strategy",2);A([M({type:Number})],_e.prototype,"distance",2);A([M({type:Number})],_e.prototype,"skidding",2);A([M({type:Boolean})],_e.prototype,"arrow",2);A([M({attribute:"arrow-placement"})],_e.prototype,"arrowPlacement",2);A([M({attribute:"arrow-padding",type:Number})],_e.prototype,"arrowPadding",2);A([M({type:Boolean})],_e.prototype,"flip",2);A([M({attribute:"flip-fallback-placements",converter:{fromAttribute:e=>e.split(" ").map(t=>t.trim()).filter(t=>t!==""),toAttribute:e=>e.join(" ")}})],_e.prototype,"flipFallbackPlacements",2);A([M({attribute:"flip-fallback-strategy"})],_e.prototype,"flipFallbackStrategy",2);A([M({type:Object})],_e.prototype,"flipBoundary",2);A([M({attribute:"flip-padding",type:Number})],_e.prototype,"flipPadding",2);A([M({type:Boolean})],_e.prototype,"shift",2);A([M({type:Object})],_e.prototype,"shiftBoundary",2);A([M({attribute:"shift-padding",type:Number})],_e.prototype,"shiftPadding",2);A([M({attribute:"auto-size"})],_e.prototype,"autoSize",2);A([M()],_e.prototype,"sync",2);A([M({type:Object})],_e.prototype,"autoSizeBoundary",2);A([M({attribute:"auto-size-padding",type:Number})],_e.prototype,"autoSizePadding",2);A([M({attribute:"hover-bridge",type:Boolean})],_e.prototype,"hoverBridge",2);var ws=new WeakMap,Ss=new WeakMap,Cs=new WeakMap,sn=new WeakSet,_r=new WeakMap,dt=class{constructor(e,t){this.handleFormData=i=>{let n=this.options.disabled(this.host),u=this.options.name(this.host),s=this.options.value(this.host),r=this.host.tagName.toLowerCase()==="sl-button";this.host.isConnected&&!n&&!r&&typeof u=="string"&&u.length>0&&typeof s<"u"&&(Array.isArray(s)?s.forEach(l=>{i.formData.append(u,l.toString())}):i.formData.append(u,s.toString()))},this.handleFormSubmit=i=>{var n;let u=this.options.disabled(this.host),s=this.options.reportValidity;this.form&&!this.form.noValidate&&((n=ws.get(this.form))==null||n.forEach(r=>{this.setUserInteracted(r,!0)})),this.form&&!this.form.noValidate&&!u&&!s(this.host)&&(i.preventDefault(),i.stopImmediatePropagation())},this.handleFormReset=()=>{this.options.setValue(this.host,this.options.defaultValue(this.host)),this.setUserInteracted(this.host,!1),_r.set(this.host,[])},this.handleInteraction=i=>{let n=_r.get(this.host);n.includes(i.type)||n.push(i.type),n.length===this.options.assumeInteractionOn.length&&this.setUserInteracted(this.host,!0)},this.checkFormValidity=()=>{if(this.form&&!this.form.noValidate){let i=this.form.querySelectorAll("*");for(let n of i)if(typeof n.checkValidity=="function"&&!n.checkValidity())return!1}return!0},this.reportFormValidity=()=>{if(this.form&&!this.form.noValidate){let i=this.form.querySelectorAll("*");for(let n of i)if(typeof n.reportValidity=="function"&&!n.reportValidity())return!1}return!0},(this.host=e).addController(this),this.options=Oe({form:i=>{let n=i.form;if(n){let s=i.getRootNode().querySelector(`#${n}`);if(s)return s}return i.closest("form")},name:i=>i.name,value:i=>i.value,defaultValue:i=>i.defaultValue,disabled:i=>{var n;return(n=i.disabled)!=null?n:!1},reportValidity:i=>typeof i.reportValidity=="function"?i.reportValidity():!0,checkValidity:i=>typeof i.checkValidity=="function"?i.checkValidity():!0,setValue:(i,n)=>i.value=n,assumeInteractionOn:["sl-input"]},t)}hostConnected(){let e=this.options.form(this.host);e&&this.attachForm(e),_r.set(this.host,[]),this.options.assumeInteractionOn.forEach(t=>{this.host.addEventListener(t,this.handleInteraction)})}hostDisconnected(){this.detachForm(),_r.delete(this.host),this.options.assumeInteractionOn.forEach(e=>{this.host.removeEventListener(e,this.handleInteraction)})}hostUpdated(){let e=this.options.form(this.host);e||this.detachForm(),e&&this.form!==e&&(this.detachForm(),this.attachForm(e)),this.host.hasUpdated&&this.setValidity(this.host.validity.valid)}attachForm(e){e?(this.form=e,ws.has(this.form)?ws.get(this.form).add(this.host):ws.set(this.form,new Set([this.host])),this.form.addEventListener("formdata",this.handleFormData),this.form.addEventListener("submit",this.handleFormSubmit),this.form.addEventListener("reset",this.handleFormReset),Ss.has(this.form)||(Ss.set(this.form,this.form.reportValidity),this.form.reportValidity=()=>this.reportFormValidity()),Cs.has(this.form)||(Cs.set(this.form,this.form.checkValidity),this.form.checkValidity=()=>this.checkFormValidity())):this.form=void 0}detachForm(){if(!this.form)return;let e=ws.get(this.form);e&&(e.delete(this.host),e.size<=0&&(this.form.removeEventListener("formdata",this.handleFormData),this.form.removeEventListener("submit",this.handleFormSubmit),this.form.removeEventListener("reset",this.handleFormReset),Ss.has(this.form)&&(this.form.reportValidity=Ss.get(this.form),Ss.delete(this.form)),Cs.has(this.form)&&(this.form.checkValidity=Cs.get(this.form),Cs.delete(this.form)),this.form=void 0))}setUserInteracted(e,t){t?sn.add(e):sn.delete(e),e.requestUpdate()}doAction(e,t){if(this.form){let i=document.createElement("button");i.type=e,i.style.position="absolute",i.style.width="0",i.style.height="0",i.style.clipPath="inset(50%)",i.style.overflow="hidden",i.style.whiteSpace="nowrap",t&&(i.name=t.name,i.value=t.value,["formaction","formenctype","formmethod","formnovalidate","formtarget"].forEach(n=>{t.hasAttribute(n)&&i.setAttribute(n,t.getAttribute(n))})),this.form.append(i),i.click(),i.remove()}}getForm(){var e;return(e=this.form)!=null?e:null}reset(e){this.doAction("reset",e)}submit(e){this.doAction("submit",e)}setValidity(e){let t=this.host,i=!!sn.has(t),n=!!t.required;t.toggleAttribute("data-required",n),t.toggleAttribute("data-optional",!n),t.toggleAttribute("data-invalid",!e),t.toggleAttribute("data-valid",e),t.toggleAttribute("data-user-invalid",!e&&i),t.toggleAttribute("data-user-valid",e&&i)}updateValidity(){let e=this.host;this.setValidity(e.validity.valid)}emitInvalidEvent(e){let t=new CustomEvent("sl-invalid",{bubbles:!1,composed:!1,cancelable:!0,detail:{}});e||t.preventDefault(),this.host.dispatchEvent(t)||e?.preventDefault()}},gr=Object.freeze({badInput:!1,customError:!1,patternMismatch:!1,rangeOverflow:!1,rangeUnderflow:!1,stepMismatch:!1,tooLong:!1,tooShort:!1,typeMismatch:!1,valid:!0,valueMissing:!1}),w0=Object.freeze(vt(Oe({},gr),{valid:!1,valueMissing:!0})),S0=Object.freeze(vt(Oe({},gr),{valid:!1,customError:!0}));var ze=class{constructor(e,...t){this.slotNames=[],this.handleSlotChange=i=>{let n=i.target;(this.slotNames.includes("[default]")&&!n.name||n.name&&this.slotNames.includes(n.name))&&this.host.requestUpdate()},(this.host=e).addController(this),this.slotNames=t}hasDefaultSlot(){return[...this.host.childNodes].some(e=>{if(e.nodeType===e.TEXT_NODE&&e.textContent.trim()!=="")return!0;if(e.nodeType===e.ELEMENT_NODE){let t=e;if(t.tagName.toLowerCase()==="sl-visually-hidden")return!1;if(!t.hasAttribute("slot"))return!0}return!1})}hasNamedSlot(e){return this.host.querySelector(`:scope > [slot="${e}"]`)!==null}test(e){return e==="[default]"?this.hasDefaultSlot():this.hasNamedSlot(e)}hostConnected(){this.host.shadowRoot.addEventListener("slotchange",this.handleSlotChange)}hostDisconnected(){this.host.shadowRoot.removeEventListener("slotchange",this.handleSlotChange)}};var le=class extends te{constructor(){super(...arguments),this.formControlController=new dt(this,{assumeInteractionOn:["sl-blur","sl-input"]}),this.hasSlotController=new ze(this,"help-text","label"),this.localize=new ge(this),this.typeToSelectString="",this.hasFocus=!1,this.displayLabel="",this.selectedOptions=[],this.valueHasChanged=!1,this.name="",this._value="",this.defaultValue="",this.size="medium",this.placeholder="",this.multiple=!1,this.maxOptionsVisible=3,this.disabled=!1,this.clearable=!1,this.open=!1,this.hoist=!1,this.filled=!1,this.pill=!1,this.label="",this.placement="bottom",this.helpText="",this.form="",this.required=!1,this.getTag=e=>P`
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
    `,this.handleDocumentFocusIn=e=>{let t=e.composedPath();this&&!t.includes(this)&&this.hide()},this.handleDocumentKeyDown=e=>{let t=e.target,i=t.closest(".select__clear")!==null,n=t.closest("sl-icon-button")!==null;if(!(i||n)){if(e.key==="Escape"&&this.open&&!this.closeWatcher&&(e.preventDefault(),e.stopPropagation(),this.hide(),this.displayInput.focus({preventScroll:!0})),e.key==="Enter"||e.key===" "&&this.typeToSelectString===""){if(e.preventDefault(),e.stopImmediatePropagation(),!this.open){this.show();return}this.currentOption&&!this.currentOption.disabled&&(this.valueHasChanged=!0,this.multiple?this.toggleOptionSelection(this.currentOption):this.setSelectedOptions(this.currentOption),this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}),this.multiple||(this.hide(),this.displayInput.focus({preventScroll:!0})));return}if(["ArrowUp","ArrowDown","Home","End"].includes(e.key)){let u=this.getAllOptions(),s=u.indexOf(this.currentOption),r=Math.max(0,s);if(e.preventDefault(),!this.open&&(this.show(),this.currentOption))return;e.key==="ArrowDown"?(r=s+1,r>u.length-1&&(r=0)):e.key==="ArrowUp"?(r=s-1,r<0&&(r=u.length-1)):e.key==="Home"?r=0:e.key==="End"&&(r=u.length-1),this.setCurrentOption(u[r])}if(e.key&&e.key.length===1||e.key==="Backspace"){let u=this.getAllOptions();if(e.metaKey||e.ctrlKey||e.altKey)return;if(!this.open){if(e.key==="Backspace")return;this.show()}e.stopPropagation(),e.preventDefault(),clearTimeout(this.typeToSelectTimeout),this.typeToSelectTimeout=window.setTimeout(()=>this.typeToSelectString="",1e3),e.key==="Backspace"?this.typeToSelectString=this.typeToSelectString.slice(0,-1):this.typeToSelectString+=e.key.toLowerCase();for(let s of u)if(s.getTextLabel().toLowerCase().startsWith(this.typeToSelectString)){this.setCurrentOption(s);break}}}},this.handleDocumentMouseDown=e=>{let t=e.composedPath();this&&!t.includes(this)&&this.hide()}}get value(){return this._value}set value(e){this.multiple?e=Array.isArray(e)?e:e.split(" "):e=Array.isArray(e)?e.join(" "):e,this._value!==e&&(this.valueHasChanged=!0,this._value=e)}get validity(){return this.valueInput.validity}get validationMessage(){return this.valueInput.validationMessage}connectedCallback(){super.connectedCallback(),setTimeout(()=>{this.handleDefaultSlotChange()}),this.open=!1}addOpenListeners(){var e;document.addEventListener("focusin",this.handleDocumentFocusIn),document.addEventListener("keydown",this.handleDocumentKeyDown),document.addEventListener("mousedown",this.handleDocumentMouseDown),this.getRootNode()!==document&&this.getRootNode().addEventListener("focusin",this.handleDocumentFocusIn),"CloseWatcher"in window&&((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>{this.open&&(this.hide(),this.displayInput.focus({preventScroll:!0}))})}removeOpenListeners(){var e;document.removeEventListener("focusin",this.handleDocumentFocusIn),document.removeEventListener("keydown",this.handleDocumentKeyDown),document.removeEventListener("mousedown",this.handleDocumentMouseDown),this.getRootNode()!==document&&this.getRootNode().removeEventListener("focusin",this.handleDocumentFocusIn),(e=this.closeWatcher)==null||e.destroy()}handleFocus(){this.hasFocus=!0,this.displayInput.setSelectionRange(0,0),this.emit("sl-focus")}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleLabelClick(){this.displayInput.focus()}handleComboboxMouseDown(e){let i=e.composedPath().some(n=>n instanceof Element&&n.tagName.toLowerCase()==="sl-icon-button");this.disabled||i||(e.preventDefault(),this.displayInput.focus({preventScroll:!0}),this.open=!this.open)}handleComboboxKeyDown(e){e.key!=="Tab"&&(e.stopPropagation(),this.handleDocumentKeyDown(e))}handleClearClick(e){e.stopPropagation(),this.valueHasChanged=!0,this.value!==""&&(this.setSelectedOptions([]),this.displayInput.focus({preventScroll:!0}),this.updateComplete.then(()=>{this.emit("sl-clear"),this.emit("sl-input"),this.emit("sl-change")}))}handleClearMouseDown(e){e.stopPropagation(),e.preventDefault()}handleOptionClick(e){let i=e.target.closest("sl-option"),n=this.value;i&&!i.disabled&&(this.valueHasChanged=!0,this.multiple?this.toggleOptionSelection(i):this.setSelectedOptions(i),this.updateComplete.then(()=>this.displayInput.focus({preventScroll:!0})),this.value!==n&&this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}),this.multiple||(this.hide(),this.displayInput.focus({preventScroll:!0})))}handleDefaultSlotChange(){customElements.get("sl-option")||customElements.whenDefined("sl-option").then(()=>this.handleDefaultSlotChange());let e=this.getAllOptions(),t=this.valueHasChanged?this.value:this.defaultValue,i=Array.isArray(t)?t:[t],n=[];e.forEach(u=>n.push(u.value)),this.setSelectedOptions(e.filter(u=>i.includes(u.value)))}handleTagRemove(e,t){e.stopPropagation(),this.valueHasChanged=!0,this.disabled||(this.toggleOptionSelection(t,!1),this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}))}getAllOptions(){return[...this.querySelectorAll("sl-option")]}getFirstOption(){return this.querySelector("sl-option")}setCurrentOption(e){this.getAllOptions().forEach(i=>{i.current=!1,i.tabIndex=-1}),e&&(this.currentOption=e,e.current=!0,e.tabIndex=0,e.focus())}setSelectedOptions(e){let t=this.getAllOptions(),i=Array.isArray(e)?e:[e];t.forEach(n=>n.selected=!1),i.length&&i.forEach(n=>n.selected=!0),this.selectionChanged()}toggleOptionSelection(e,t){t===!0||t===!1?e.selected=t:e.selected=!e.selected,this.selectionChanged()}selectionChanged(){var e,t,i;let n=this.getAllOptions();this.selectedOptions=n.filter(s=>s.selected);let u=this.valueHasChanged;if(this.multiple)this.value=this.selectedOptions.map(s=>s.value),this.placeholder&&this.value.length===0?this.displayLabel="":this.displayLabel=this.localize.term("numOptionsSelected",this.selectedOptions.length);else{let s=this.selectedOptions[0];this.value=(e=s?.value)!=null?e:"",this.displayLabel=(i=(t=s?.getTextLabel)==null?void 0:t.call(s))!=null?i:""}this.valueHasChanged=u,this.updateComplete.then(()=>{this.formControlController.updateValidity()})}get tags(){return this.selectedOptions.map((e,t)=>{if(t<this.maxOptionsVisible||this.maxOptionsVisible<=0){let i=this.getTag(e,t);return P`<div @sl-remove=${n=>this.handleTagRemove(n,e)}>
          ${typeof i=="string"?K(i):i}
        </div>`}else if(t===this.maxOptionsVisible)return P`<sl-tag size=${this.size}>+${this.selectedOptions.length-t}</sl-tag>`;return P``})}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleDisabledChange(){this.disabled&&(this.open=!1,this.handleOpenChange())}attributeChangedCallback(e,t,i){if(super.attributeChangedCallback(e,t,i),e==="value"){let n=this.valueHasChanged;this.value=this.defaultValue,this.valueHasChanged=n}}handleValueChange(){if(!this.valueHasChanged){let i=this.valueHasChanged;this.value=this.defaultValue,this.valueHasChanged=i}let e=this.getAllOptions(),t=Array.isArray(this.value)?this.value:[this.value];this.setSelectedOptions(e.filter(i=>t.includes(i.value)))}async handleOpenChange(){if(this.open&&!this.disabled){this.setCurrentOption(this.selectedOptions[0]||this.getFirstOption()),this.emit("sl-show"),this.addOpenListeners(),await Te(this),this.listbox.hidden=!1,this.popup.active=!0,requestAnimationFrame(()=>{this.setCurrentOption(this.currentOption)});let{keyframes:e,options:t}=xe(this,"select.show",{dir:this.localize.dir()});await ke(this.popup.popup,e,t),this.currentOption&&fs(this.currentOption,this.listbox,"vertical","auto"),this.emit("sl-after-show")}else{this.emit("sl-hide"),this.removeOpenListeners(),await Te(this);let{keyframes:e,options:t}=xe(this,"select.hide",{dir:this.localize.dir()});await ke(this.popup.popup,e,t),this.listbox.hidden=!0,this.popup.active=!1,this.emit("sl-after-hide")}}async show(){if(this.open||this.disabled){this.open=!1;return}return this.open=!0,Be(this,"sl-after-show")}async hide(){if(!this.open||this.disabled){this.open=!1;return}return this.open=!1,Be(this,"sl-after-hide")}checkValidity(){return this.valueInput.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.valueInput.reportValidity()}setCustomValidity(e){this.valueInput.setCustomValidity(e),this.formControlController.updateValidity()}focus(e){this.displayInput.focus(e)}blur(){this.displayInput.blur()}render(){let e=this.hasSlotController.test("label"),t=this.hasSlotController.test("help-text"),i=this.label?!0:!!e,n=this.helpText?!0:!!t,u=this.clearable&&!this.disabled&&this.value.length>0,s=this.placeholder&&this.value&&this.value.length<=0;return P`
      <div
        part="form-control"
        class=${ie({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-label":i,"form-control--has-help-text":n})}
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
            class=${ie({select:!0,"select--standard":!0,"select--filled":this.filled,"select--pill":this.pill,"select--open":this.open,"select--disabled":this.disabled,"select--multiple":this.multiple,"select--focused":this.hasFocus,"select--placeholder-visible":s,"select--top":this.placement==="top","select--bottom":this.placement==="bottom","select--small":this.size==="small","select--medium":this.size==="medium","select--large":this.size==="large"})}
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

              ${this.multiple?P`<div part="tags" class="select__tags">${this.tags}</div>`:""}

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

              ${u?P`
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
    `}};le.styles=[ne,Mt,fl];le.dependencies={"sl-icon":Se,"sl-popup":_e,"sl-tag":Ot};A([ee(".select")],le.prototype,"popup",2);A([ee(".select__combobox")],le.prototype,"combobox",2);A([ee(".select__display-input")],le.prototype,"displayInput",2);A([ee(".select__value-input")],le.prototype,"valueInput",2);A([ee(".select__listbox")],le.prototype,"listbox",2);A([de()],le.prototype,"hasFocus",2);A([de()],le.prototype,"displayLabel",2);A([de()],le.prototype,"currentOption",2);A([de()],le.prototype,"selectedOptions",2);A([de()],le.prototype,"valueHasChanged",2);A([M()],le.prototype,"name",2);A([de()],le.prototype,"value",1);A([M({attribute:"value"})],le.prototype,"defaultValue",2);A([M({reflect:!0})],le.prototype,"size",2);A([M()],le.prototype,"placeholder",2);A([M({type:Boolean,reflect:!0})],le.prototype,"multiple",2);A([M({attribute:"max-options-visible",type:Number})],le.prototype,"maxOptionsVisible",2);A([M({type:Boolean,reflect:!0})],le.prototype,"disabled",2);A([M({type:Boolean})],le.prototype,"clearable",2);A([M({type:Boolean,reflect:!0})],le.prototype,"open",2);A([M({type:Boolean})],le.prototype,"hoist",2);A([M({type:Boolean,reflect:!0})],le.prototype,"filled",2);A([M({type:Boolean,reflect:!0})],le.prototype,"pill",2);A([M()],le.prototype,"label",2);A([M({reflect:!0})],le.prototype,"placement",2);A([M({attribute:"help-text"})],le.prototype,"helpText",2);A([M({reflect:!0})],le.prototype,"form",2);A([M({type:Boolean,reflect:!0})],le.prototype,"required",2);A([M()],le.prototype,"getTag",2);A([Q("disabled",{waitUntilFirstUpdate:!0})],le.prototype,"handleDisabledChange",1);A([Q(["defaultValue","value"],{waitUntilFirstUpdate:!0})],le.prototype,"handleValueChange",1);A([Q("open",{waitUntilFirstUpdate:!0})],le.prototype,"handleOpenChange",1);Ce("select.show",{keyframes:[{opacity:0,scale:.9},{opacity:1,scale:1}],options:{duration:100,easing:"ease"}});Ce("select.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.9}],options:{duration:100,easing:"ease"}});le.define("sl-select");var Yl=Z`
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
`;var We=class extends te{constructor(){super(...arguments),this.localize=new ge(this),this.isInitialized=!1,this.current=!1,this.selected=!1,this.hasHover=!1,this.value="",this.disabled=!1}connectedCallback(){super.connectedCallback(),this.setAttribute("role","option"),this.setAttribute("aria-selected","false")}handleDefaultSlotChange(){this.isInitialized?customElements.whenDefined("sl-select").then(()=>{let e=this.closest("sl-select");e&&e.handleDefaultSlotChange()}):this.isInitialized=!0}handleMouseEnter(){this.hasHover=!0}handleMouseLeave(){this.hasHover=!1}handleDisabledChange(){this.setAttribute("aria-disabled",this.disabled?"true":"false")}handleSelectedChange(){this.setAttribute("aria-selected",this.selected?"true":"false")}handleValueChange(){typeof this.value!="string"&&(this.value=String(this.value)),this.value.includes(" ")&&(console.error("Option values cannot include a space. All spaces have been replaced with underscores.",this),this.value=this.value.replace(/ /g,"_"))}getTextLabel(){let e=this.childNodes,t="";return[...e].forEach(i=>{i.nodeType===Node.ELEMENT_NODE&&(i.hasAttribute("slot")||(t+=i.textContent)),i.nodeType===Node.TEXT_NODE&&(t+=i.textContent)}),t.trim()}render(){return P`
      <div
        part="base"
        class=${ie({option:!0,"option--current":this.current,"option--disabled":this.disabled,"option--selected":this.selected,"option--hover":this.hasHover})}
        @mouseenter=${this.handleMouseEnter}
        @mouseleave=${this.handleMouseLeave}
      >
        <sl-icon part="checked-icon" class="option__check" name="check" library="system" aria-hidden="true"></sl-icon>
        <slot part="prefix" name="prefix" class="option__prefix"></slot>
        <slot part="label" class="option__label" @slotchange=${this.handleDefaultSlotChange}></slot>
        <slot part="suffix" name="suffix" class="option__suffix"></slot>
      </div>
    `}};We.styles=[ne,Yl];We.dependencies={"sl-icon":Se};A([ee(".option__label")],We.prototype,"defaultSlot",2);A([de()],We.prototype,"current",2);A([de()],We.prototype,"selected",2);A([de()],We.prototype,"hasHover",2);A([M({reflect:!0})],We.prototype,"value",2);A([M({type:Boolean,reflect:!0})],We.prototype,"disabled",2);A([Q("disabled")],We.prototype,"handleDisabledChange",1);A([Q("selected")],We.prototype,"handleSelectedChange",1);A([Q("value")],We.prototype,"handleValueChange",1);We.define("sl-option");var Jl=Z`
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
`;var $i=(e="value")=>(t,i)=>{let n=t.constructor,u=n.prototype.attributeChangedCallback;n.prototype.attributeChangedCallback=function(s,r,l){var p;let d=n.getPropertyOptions(e),f=typeof d.attribute=="string"?d.attribute:e;if(s===f){let g=d.converter||Rt,b=(typeof g=="function"?g:(p=g?.fromAttribute)!=null?p:Rt.fromAttribute)(l,d.type);this[e]!==b&&(this[i]=b)}u.call(this,s,r,l)}};var Oi=di(class extends Ct{constructor(e){if(super(e),e.type!==Ze.PROPERTY&&e.type!==Ze.ATTRIBUTE&&e.type!==Ze.BOOLEAN_ATTRIBUTE)throw Error("The `live` directive is not allowed on child or event bindings");if(!ll(e))throw Error("`live` bindings can only contain a single expression")}render(e){return e}update(e,[t]){if(t===Re||t===V)return t;let i=e.element,n=e.name;if(e.type===Ze.PROPERTY){if(t===i[n])return Re}else if(e.type===Ze.BOOLEAN_ATTRIBUTE){if(!!t===i.hasAttribute(n))return Re}else if(e.type===Ze.ATTRIBUTE&&i.getAttribute(n)===t+"")return Re;return cl(e),t}});var oe=class extends te{constructor(){super(...arguments),this.formControlController=new dt(this,{assumeInteractionOn:["sl-blur","sl-input"]}),this.hasSlotController=new ze(this,"help-text","label"),this.localize=new ge(this),this.hasFocus=!1,this.title="",this.__numberInput=Object.assign(document.createElement("input"),{type:"number"}),this.__dateInput=Object.assign(document.createElement("input"),{type:"date"}),this.type="text",this.name="",this.value="",this.defaultValue="",this.size="medium",this.filled=!1,this.pill=!1,this.label="",this.helpText="",this.clearable=!1,this.disabled=!1,this.placeholder="",this.readonly=!1,this.passwordToggle=!1,this.passwordVisible=!1,this.noSpinButtons=!1,this.form="",this.required=!1,this.spellcheck=!0}get valueAsDate(){var e;return this.__dateInput.type=this.type,this.__dateInput.value=this.value,((e=this.input)==null?void 0:e.valueAsDate)||this.__dateInput.valueAsDate}set valueAsDate(e){this.__dateInput.type=this.type,this.__dateInput.valueAsDate=e,this.value=this.__dateInput.value}get valueAsNumber(){var e;return this.__numberInput.value=this.value,((e=this.input)==null?void 0:e.valueAsNumber)||this.__numberInput.valueAsNumber}set valueAsNumber(e){this.__numberInput.valueAsNumber=e,this.value=this.__numberInput.value}get validity(){return this.input.validity}get validationMessage(){return this.input.validationMessage}firstUpdated(){this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleChange(){this.value=this.input.value,this.emit("sl-change")}handleClearClick(e){e.preventDefault(),this.value!==""&&(this.value="",this.emit("sl-clear"),this.emit("sl-input"),this.emit("sl-change")),this.input.focus()}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleInput(){this.value=this.input.value,this.formControlController.updateValidity(),this.emit("sl-input")}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleKeyDown(e){let t=e.metaKey||e.ctrlKey||e.shiftKey||e.altKey;e.key==="Enter"&&!t&&setTimeout(()=>{!e.defaultPrevented&&!e.isComposing&&this.formControlController.submit()})}handlePasswordToggle(){this.passwordVisible=!this.passwordVisible}handleDisabledChange(){this.formControlController.setValidity(this.disabled)}handleStepChange(){this.input.step=String(this.step),this.formControlController.updateValidity()}async handleValueChange(){await this.updateComplete,this.formControlController.updateValidity()}focus(e){this.input.focus(e)}blur(){this.input.blur()}select(){this.input.select()}setSelectionRange(e,t,i="none"){this.input.setSelectionRange(e,t,i)}setRangeText(e,t,i,n="preserve"){let u=t??this.input.selectionStart,s=i??this.input.selectionEnd;this.input.setRangeText(e,u,s,n),this.value!==this.input.value&&(this.value=this.input.value)}showPicker(){"showPicker"in HTMLInputElement.prototype&&this.input.showPicker()}stepUp(){this.input.stepUp(),this.value!==this.input.value&&(this.value=this.input.value)}stepDown(){this.input.stepDown(),this.value!==this.input.value&&(this.value=this.input.value)}checkValidity(){return this.input.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.input.reportValidity()}setCustomValidity(e){this.input.setCustomValidity(e),this.formControlController.updateValidity()}render(){let e=this.hasSlotController.test("label"),t=this.hasSlotController.test("help-text"),i=this.label?!0:!!e,n=this.helpText?!0:!!t,s=this.clearable&&!this.disabled&&!this.readonly&&(typeof this.value=="number"||this.value.length>0);return P`
      <div
        part="form-control"
        class=${ie({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-label":i,"form-control--has-help-text":n})}
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
            class=${ie({input:!0,"input--small":this.size==="small","input--medium":this.size==="medium","input--large":this.size==="large","input--pill":this.pill,"input--standard":!this.filled,"input--filled":this.filled,"input--disabled":this.disabled,"input--focused":this.hasFocus,"input--empty":!this.value,"input--no-spin-buttons":this.noSpinButtons})}
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
              name=${J(this.name)}
              ?disabled=${this.disabled}
              ?readonly=${this.readonly}
              ?required=${this.required}
              placeholder=${J(this.placeholder)}
              minlength=${J(this.minlength)}
              maxlength=${J(this.maxlength)}
              min=${J(this.min)}
              max=${J(this.max)}
              step=${J(this.step)}
              .value=${Oi(this.value)}
              autocapitalize=${J(this.autocapitalize)}
              autocomplete=${J(this.autocomplete)}
              autocorrect=${J(this.autocorrect)}
              ?autofocus=${this.autofocus}
              spellcheck=${this.spellcheck}
              pattern=${J(this.pattern)}
              enterkeyhint=${J(this.enterkeyhint)}
              inputmode=${J(this.inputmode)}
              aria-describedby="help-text"
              @change=${this.handleChange}
              @input=${this.handleInput}
              @invalid=${this.handleInvalid}
              @keydown=${this.handleKeyDown}
              @focus=${this.handleFocus}
              @blur=${this.handleBlur}
            />

            ${s?P`
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
            ${this.passwordToggle&&!this.disabled?P`
                  <button
                    part="password-toggle-button"
                    class="input__password-toggle"
                    type="button"
                    aria-label=${this.localize.term(this.passwordVisible?"hidePassword":"showPassword")}
                    @click=${this.handlePasswordToggle}
                    tabindex="-1"
                  >
                    ${this.passwordVisible?P`
                          <slot name="show-password-icon">
                            <sl-icon name="eye-slash" library="system"></sl-icon>
                          </slot>
                        `:P`
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
    `}};oe.styles=[ne,Mt,Jl];oe.dependencies={"sl-icon":Se};A([ee(".input__control")],oe.prototype,"input",2);A([de()],oe.prototype,"hasFocus",2);A([M()],oe.prototype,"title",2);A([M({reflect:!0})],oe.prototype,"type",2);A([M()],oe.prototype,"name",2);A([M()],oe.prototype,"value",2);A([$i()],oe.prototype,"defaultValue",2);A([M({reflect:!0})],oe.prototype,"size",2);A([M({type:Boolean,reflect:!0})],oe.prototype,"filled",2);A([M({type:Boolean,reflect:!0})],oe.prototype,"pill",2);A([M()],oe.prototype,"label",2);A([M({attribute:"help-text"})],oe.prototype,"helpText",2);A([M({type:Boolean})],oe.prototype,"clearable",2);A([M({type:Boolean,reflect:!0})],oe.prototype,"disabled",2);A([M()],oe.prototype,"placeholder",2);A([M({type:Boolean,reflect:!0})],oe.prototype,"readonly",2);A([M({attribute:"password-toggle",type:Boolean})],oe.prototype,"passwordToggle",2);A([M({attribute:"password-visible",type:Boolean})],oe.prototype,"passwordVisible",2);A([M({attribute:"no-spin-buttons",type:Boolean})],oe.prototype,"noSpinButtons",2);A([M({reflect:!0})],oe.prototype,"form",2);A([M({type:Boolean,reflect:!0})],oe.prototype,"required",2);A([M()],oe.prototype,"pattern",2);A([M({type:Number})],oe.prototype,"minlength",2);A([M({type:Number})],oe.prototype,"maxlength",2);A([M()],oe.prototype,"min",2);A([M()],oe.prototype,"max",2);A([M()],oe.prototype,"step",2);A([M()],oe.prototype,"autocapitalize",2);A([M()],oe.prototype,"autocorrect",2);A([M()],oe.prototype,"autocomplete",2);A([M({type:Boolean})],oe.prototype,"autofocus",2);A([M()],oe.prototype,"enterkeyhint",2);A([M({type:Boolean,converter:{fromAttribute:e=>!(!e||e==="false"),toAttribute:e=>e?"true":"false"}})],oe.prototype,"spellcheck",2);A([M()],oe.prototype,"inputmode",2);A([Q("disabled",{waitUntilFirstUpdate:!0})],oe.prototype,"handleDisabledChange",1);A([Q("step",{waitUntilFirstUpdate:!0})],oe.prototype,"handleStepChange",1);A([Q("value",{waitUntilFirstUpdate:!0})],oe.prototype,"handleValueChange",1);oe.define("sl-input");var Zl=Z`
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
`;var rn=class extends te{constructor(){super(...arguments),this.localize=new ge(this)}render(){return P`
      <svg part="base" class="spinner" role="progressbar" aria-label=${this.localize.term("loading")}>
        <circle class="spinner__track"></circle>
        <circle class="spinner__indicator"></circle>
      </svg>
    `}};rn.styles=[ne,Zl];var Ql=Z`
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
`;var ue=class extends te{constructor(){super(...arguments),this.formControlController=new dt(this,{assumeInteractionOn:["click"]}),this.hasSlotController=new ze(this,"[default]","prefix","suffix"),this.localize=new ge(this),this.hasFocus=!1,this.invalid=!1,this.title="",this.variant="default",this.size="medium",this.caret=!1,this.disabled=!1,this.loading=!1,this.outline=!1,this.pill=!1,this.circle=!1,this.type="button",this.name="",this.value="",this.href="",this.rel="noreferrer noopener"}get validity(){return this.isButton()?this.button.validity:gr}get validationMessage(){return this.isButton()?this.button.validationMessage:""}firstUpdated(){this.isButton()&&this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleClick(){this.type==="submit"&&this.formControlController.submit(this),this.type==="reset"&&this.formControlController.reset(this)}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}isButton(){return!this.href}isLink(){return!!this.href}handleDisabledChange(){this.isButton()&&this.formControlController.setValidity(this.disabled)}click(){this.button.click()}focus(e){this.button.focus(e)}blur(){this.button.blur()}checkValidity(){return this.isButton()?this.button.checkValidity():!0}getForm(){return this.formControlController.getForm()}reportValidity(){return this.isButton()?this.button.reportValidity():!0}setCustomValidity(e){this.isButton()&&(this.button.setCustomValidity(e),this.formControlController.updateValidity())}render(){let e=this.isLink(),t=e?Ei`a`:Ei`button`;return Ai`
      <${t}
        part="base"
        class=${ie({button:!0,"button--default":this.variant==="default","button--primary":this.variant==="primary","button--success":this.variant==="success","button--neutral":this.variant==="neutral","button--warning":this.variant==="warning","button--danger":this.variant==="danger","button--text":this.variant==="text","button--small":this.size==="small","button--medium":this.size==="medium","button--large":this.size==="large","button--caret":this.caret,"button--circle":this.circle,"button--disabled":this.disabled,"button--focused":this.hasFocus,"button--loading":this.loading,"button--standard":!this.outline,"button--outline":this.outline,"button--pill":this.pill,"button--rtl":this.localize.dir()==="rtl","button--has-label":this.hasSlotController.test("[default]"),"button--has-prefix":this.hasSlotController.test("prefix"),"button--has-suffix":this.hasSlotController.test("suffix")})}
        ?disabled=${J(e?void 0:this.disabled)}
        type=${J(e?void 0:this.type)}
        title=${this.title}
        name=${J(e?void 0:this.name)}
        value=${J(e?void 0:this.value)}
        href=${J(e&&!this.disabled?this.href:void 0)}
        target=${J(e?this.target:void 0)}
        download=${J(e?this.download:void 0)}
        rel=${J(e?this.rel:void 0)}
        role=${J(e?void 0:"button")}
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
        ${this.caret?Ai` <sl-icon part="caret" class="button__caret" library="system" name="caret"></sl-icon> `:""}
        ${this.loading?Ai`<sl-spinner part="spinner"></sl-spinner>`:""}
      </${t}>
    `}};ue.styles=[ne,Ql];ue.dependencies={"sl-icon":Se,"sl-spinner":rn};A([ee(".button")],ue.prototype,"button",2);A([de()],ue.prototype,"hasFocus",2);A([de()],ue.prototype,"invalid",2);A([M()],ue.prototype,"title",2);A([M({reflect:!0})],ue.prototype,"variant",2);A([M({reflect:!0})],ue.prototype,"size",2);A([M({type:Boolean,reflect:!0})],ue.prototype,"caret",2);A([M({type:Boolean,reflect:!0})],ue.prototype,"disabled",2);A([M({type:Boolean,reflect:!0})],ue.prototype,"loading",2);A([M({type:Boolean,reflect:!0})],ue.prototype,"outline",2);A([M({type:Boolean,reflect:!0})],ue.prototype,"pill",2);A([M({type:Boolean,reflect:!0})],ue.prototype,"circle",2);A([M()],ue.prototype,"type",2);A([M()],ue.prototype,"name",2);A([M()],ue.prototype,"value",2);A([M()],ue.prototype,"href",2);A([M()],ue.prototype,"target",2);A([M()],ue.prototype,"rel",2);A([M()],ue.prototype,"download",2);A([M()],ue.prototype,"form",2);A([M({attribute:"formaction"})],ue.prototype,"formAction",2);A([M({attribute:"formenctype"})],ue.prototype,"formEnctype",2);A([M({attribute:"formmethod"})],ue.prototype,"formMethod",2);A([M({attribute:"formnovalidate",type:Boolean})],ue.prototype,"formNoValidate",2);A([M({attribute:"formtarget"})],ue.prototype,"formTarget",2);A([Q("disabled",{waitUntilFirstUpdate:!0})],ue.prototype,"handleDisabledChange",1);ue.define("sl-button");var ec=Z`
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
`;var Mi=class extends te{constructor(){super(...arguments),this.variant="primary",this.pill=!1,this.pulse=!1}render(){return P`
      <span
        part="base"
        class=${ie({badge:!0,"badge--primary":this.variant==="primary","badge--success":this.variant==="success","badge--neutral":this.variant==="neutral","badge--warning":this.variant==="warning","badge--danger":this.variant==="danger","badge--pill":this.pill,"badge--pulse":this.pulse})}
        role="status"
      >
        <slot></slot>
      </span>
    `}};Mi.styles=[ne,ec];A([M({reflect:!0})],Mi.prototype,"variant",2);A([M({type:Boolean,reflect:!0})],Mi.prototype,"pill",2);A([M({type:Boolean,reflect:!0})],Mi.prototype,"pulse",2);Mi.define("sl-badge");var tc=Z`
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
`;var Ee=class extends te{constructor(){super(),this.localize=new ge(this),this.content="",this.placement="top",this.disabled=!1,this.distance=8,this.open=!1,this.skidding=0,this.trigger="hover focus",this.hoist=!1,this.handleBlur=()=>{this.hasTrigger("focus")&&this.hide()},this.handleClick=()=>{this.hasTrigger("click")&&(this.open?this.hide():this.show())},this.handleFocus=()=>{this.hasTrigger("focus")&&this.show()},this.handleDocumentKeyDown=e=>{e.key==="Escape"&&(e.stopPropagation(),this.hide())},this.handleMouseOver=()=>{if(this.hasTrigger("hover")){let e=Bo(getComputedStyle(this).getPropertyValue("--show-delay"));clearTimeout(this.hoverTimeout),this.hoverTimeout=window.setTimeout(()=>this.show(),e)}},this.handleMouseOut=()=>{if(this.hasTrigger("hover")){let e=Bo(getComputedStyle(this).getPropertyValue("--hide-delay"));clearTimeout(this.hoverTimeout),this.hoverTimeout=window.setTimeout(()=>this.hide(),e)}},this.addEventListener("blur",this.handleBlur,!0),this.addEventListener("focus",this.handleFocus,!0),this.addEventListener("click",this.handleClick),this.addEventListener("mouseover",this.handleMouseOver),this.addEventListener("mouseout",this.handleMouseOut)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this.closeWatcher)==null||e.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown)}firstUpdated(){this.body.hidden=!this.open,this.open&&(this.popup.active=!0,this.popup.reposition())}hasTrigger(e){return this.trigger.split(" ").includes(e)}async handleOpenChange(){var e,t;if(this.open){if(this.disabled)return;this.emit("sl-show"),"CloseWatcher"in window?((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>{this.hide()}):document.addEventListener("keydown",this.handleDocumentKeyDown),await Te(this.body),this.body.hidden=!1,this.popup.active=!0;let{keyframes:i,options:n}=xe(this,"tooltip.show",{dir:this.localize.dir()});await ke(this.popup.popup,i,n),this.popup.reposition(),this.emit("sl-after-show")}else{this.emit("sl-hide"),(t=this.closeWatcher)==null||t.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown),await Te(this.body);let{keyframes:i,options:n}=xe(this,"tooltip.hide",{dir:this.localize.dir()});await ke(this.popup.popup,i,n),this.popup.active=!1,this.body.hidden=!0,this.emit("sl-after-hide")}}async handleOptionsChange(){this.hasUpdated&&(await this.updateComplete,this.popup.reposition())}handleDisabledChange(){this.disabled&&this.open&&this.hide()}async show(){if(!this.open)return this.open=!0,Be(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,Be(this,"sl-after-hide")}render(){return P`
      <sl-popup
        part="base"
        exportparts="
          popup:base__popup,
          arrow:base__arrow
        "
        class=${ie({tooltip:!0,"tooltip--open":this.open})}
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
    `}};Ee.styles=[ne,tc];Ee.dependencies={"sl-popup":_e};A([ee("slot:not([name])")],Ee.prototype,"defaultSlot",2);A([ee(".tooltip__body")],Ee.prototype,"body",2);A([ee("sl-popup")],Ee.prototype,"popup",2);A([M()],Ee.prototype,"content",2);A([M()],Ee.prototype,"placement",2);A([M({type:Boolean,reflect:!0})],Ee.prototype,"disabled",2);A([M({type:Number})],Ee.prototype,"distance",2);A([M({type:Boolean,reflect:!0})],Ee.prototype,"open",2);A([M({type:Number})],Ee.prototype,"skidding",2);A([M()],Ee.prototype,"trigger",2);A([M({type:Boolean})],Ee.prototype,"hoist",2);A([Q("open",{waitUntilFirstUpdate:!0})],Ee.prototype,"handleOpenChange",1);A([Q(["content","distance","hoist","placement","skidding"])],Ee.prototype,"handleOptionsChange",1);A([Q("disabled")],Ee.prototype,"handleDisabledChange",1);Ce("tooltip.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:150,easing:"ease"}});Ce("tooltip.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:150,easing:"ease"}});Ee.define("sl-tooltip");function*vr(e=document.activeElement){e!=null&&(yield e,"shadowRoot"in e&&e.shadowRoot&&e.shadowRoot.mode!=="closed"&&(yield*Va(vr(e.shadowRoot.activeElement))))}function sc(){return[...vr()].pop()}var ic=new WeakMap;function rc(e){let t=ic.get(e);return t||(t=window.getComputedStyle(e,null),ic.set(e,t)),t}function mu(e){if(typeof e.checkVisibility=="function")return e.checkVisibility({checkOpacity:!1,checkVisibilityCSS:!0});let t=rc(e);return t.visibility!=="hidden"&&t.display!=="none"}function _u(e){let t=rc(e),{overflowY:i,overflowX:n}=t;return i==="scroll"||n==="scroll"?!0:i!=="auto"||n!=="auto"?!1:e.scrollHeight>e.clientHeight&&i==="auto"||e.scrollWidth>e.clientWidth&&n==="auto"}function gu(e){let t=e.tagName.toLowerCase(),i=Number(e.getAttribute("tabindex"));if(e.hasAttribute("tabindex")&&(isNaN(i)||i<=-1)||e.hasAttribute("disabled")||e.closest("[inert]"))return!1;if(t==="input"&&e.getAttribute("type")==="radio"){let s=e.getRootNode(),r=`input[type='radio'][name="${e.getAttribute("name")}"]`,l=s.querySelector(`${r}:checked`);return l?l===e:s.querySelector(r)===e}return mu(e)?(t==="audio"||t==="video")&&e.hasAttribute("controls")||e.hasAttribute("tabindex")||e.hasAttribute("contenteditable")&&e.getAttribute("contenteditable")!=="false"||["button","input","select","textarea","a","audio","video","summary","iframe"].includes(t)?!0:_u(e):!1}function vu(e,t){var i;return((i=e.getRootNode({composed:!0}))==null?void 0:i.host)!==t}function on(e){let t=new WeakMap,i=[];function n(u){if(u instanceof Element){if(u.hasAttribute("inert")||u.closest("[inert]")||t.has(u))return;t.set(u,!0),!i.includes(u)&&gu(u)&&i.push(u),u instanceof HTMLSlotElement&&vu(u,e)&&u.assignedElements({flatten:!0}).forEach(s=>{n(s)}),u.shadowRoot!==null&&u.shadowRoot.mode==="open"&&n(u.shadowRoot)}for(let s of u.children)n(s)}return n(e),i.sort((u,s)=>{let r=Number(u.getAttribute("tabindex"))||0;return(Number(s.getAttribute("tabindex"))||0)-r})}var xs=[],oc=class{constructor(e){this.tabDirection="forward",this.handleFocusIn=()=>{this.isActive()&&this.checkFocus()},this.handleKeyDown=t=>{var i;if(t.key!=="Tab"||this.isExternalActivated||!this.isActive())return;let n=sc();if(this.previousFocus=n,this.previousFocus&&this.possiblyHasTabbableChildren(this.previousFocus))return;t.shiftKey?this.tabDirection="backward":this.tabDirection="forward";let u=on(this.element),s=u.findIndex(l=>l===n);this.previousFocus=this.currentFocus;let r=this.tabDirection==="forward"?1:-1;for(;;){s+r>=u.length?s=0:s+r<0?s=u.length-1:s+=r,this.previousFocus=this.currentFocus;let l=u[s];if(this.tabDirection==="backward"&&this.previousFocus&&this.possiblyHasTabbableChildren(this.previousFocus)||l&&this.possiblyHasTabbableChildren(l))return;t.preventDefault(),this.currentFocus=l,(i=this.currentFocus)==null||i.focus({preventScroll:!1});let p=[...vr()];if(p.includes(this.currentFocus)||!p.includes(this.previousFocus))break}setTimeout(()=>this.checkFocus())},this.handleKeyUp=()=>{this.tabDirection="forward"},this.element=e,this.elementsWithTabbableControls=["iframe"]}activate(){xs.push(this.element),document.addEventListener("focusin",this.handleFocusIn),document.addEventListener("keydown",this.handleKeyDown),document.addEventListener("keyup",this.handleKeyUp)}deactivate(){xs=xs.filter(e=>e!==this.element),this.currentFocus=null,document.removeEventListener("focusin",this.handleFocusIn),document.removeEventListener("keydown",this.handleKeyDown),document.removeEventListener("keyup",this.handleKeyUp)}isActive(){return xs[xs.length-1]===this.element}activateExternal(){this.isExternalActivated=!0}deactivateExternal(){this.isExternalActivated=!1}checkFocus(){if(this.isActive()&&!this.isExternalActivated){let e=on(this.element);if(!this.element.matches(":focus-within")){let t=e[0],i=e[e.length-1],n=this.tabDirection==="forward"?t:i;typeof n?.focus=="function"&&(this.currentFocus=n,n.focus({preventScroll:!1}))}}}possiblyHasTabbableChildren(e){return this.elementsWithTabbableControls.includes(e.tagName.toLowerCase())||e.hasAttribute("controls")}};var nc=Z`
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
`;var br=e=>{var t;let{activeElement:i}=document;i&&e.contains(i)&&((t=document.activeElement)==null||t.blur())};var it=class extends te{constructor(){super(...arguments),this.hasSlotController=new ze(this,"footer"),this.localize=new ge(this),this.modal=new oc(this),this.open=!1,this.label="",this.noHeader=!1,this.handleDocumentKeyDown=e=>{e.key==="Escape"&&this.modal.isActive()&&this.open&&(e.stopPropagation(),this.requestClose("keyboard"))}}firstUpdated(){this.dialog.hidden=!this.open,this.open&&(this.addOpenListeners(),this.modal.activate(),Ko(this))}disconnectedCallback(){super.disconnectedCallback(),this.modal.deactivate(),Go(this),this.removeOpenListeners()}requestClose(e){if(this.emit("sl-request-close",{cancelable:!0,detail:{source:e}}).defaultPrevented){let i=xe(this,"dialog.denyClose",{dir:this.localize.dir()});ke(this.panel,i.keyframes,i.options);return}this.hide()}addOpenListeners(){var e;"CloseWatcher"in window?((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>this.requestClose("keyboard")):document.addEventListener("keydown",this.handleDocumentKeyDown)}removeOpenListeners(){var e;(e=this.closeWatcher)==null||e.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown)}async handleOpenChange(){if(this.open){this.emit("sl-show"),this.addOpenListeners(),this.originalTrigger=document.activeElement,this.modal.activate(),Ko(this);let e=this.querySelector("[autofocus]");e&&e.removeAttribute("autofocus"),await Promise.all([Te(this.dialog),Te(this.overlay)]),this.dialog.hidden=!1,requestAnimationFrame(()=>{this.emit("sl-initial-focus",{cancelable:!0}).defaultPrevented||(e?e.focus({preventScroll:!0}):this.panel.focus({preventScroll:!0})),e&&e.setAttribute("autofocus","")});let t=xe(this,"dialog.show",{dir:this.localize.dir()}),i=xe(this,"dialog.overlay.show",{dir:this.localize.dir()});await Promise.all([ke(this.panel,t.keyframes,t.options),ke(this.overlay,i.keyframes,i.options)]),this.emit("sl-after-show")}else{br(this),this.emit("sl-hide"),this.removeOpenListeners(),this.modal.deactivate(),await Promise.all([Te(this.dialog),Te(this.overlay)]);let e=xe(this,"dialog.hide",{dir:this.localize.dir()}),t=xe(this,"dialog.overlay.hide",{dir:this.localize.dir()});await Promise.all([ke(this.overlay,t.keyframes,t.options).then(()=>{this.overlay.hidden=!0}),ke(this.panel,e.keyframes,e.options).then(()=>{this.panel.hidden=!0})]),this.dialog.hidden=!0,this.overlay.hidden=!1,this.panel.hidden=!1,Go(this);let i=this.originalTrigger;typeof i?.focus=="function"&&setTimeout(()=>i.focus()),this.emit("sl-after-hide")}}async show(){if(!this.open)return this.open=!0,Be(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,Be(this,"sl-after-hide")}render(){return P`
      <div
        part="base"
        class=${ie({dialog:!0,"dialog--open":this.open,"dialog--has-footer":this.hasSlotController.test("footer")})}
      >
        <div part="overlay" class="dialog__overlay" @click=${()=>this.requestClose("overlay")} tabindex="-1"></div>

        <div
          part="panel"
          class="dialog__panel"
          role="dialog"
          aria-modal="true"
          aria-hidden=${this.open?"false":"true"}
          aria-label=${J(this.noHeader?this.label:void 0)}
          aria-labelledby=${J(this.noHeader?void 0:"title")}
          tabindex="-1"
        >
          ${this.noHeader?"":P`
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
    `}};it.styles=[ne,nc];it.dependencies={"sl-icon-button":we};A([ee(".dialog")],it.prototype,"dialog",2);A([ee(".dialog__panel")],it.prototype,"panel",2);A([ee(".dialog__overlay")],it.prototype,"overlay",2);A([M({type:Boolean,reflect:!0})],it.prototype,"open",2);A([M({reflect:!0})],it.prototype,"label",2);A([M({attribute:"no-header",type:Boolean,reflect:!0})],it.prototype,"noHeader",2);A([Q("open",{waitUntilFirstUpdate:!0})],it.prototype,"handleOpenChange",1);Ce("dialog.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:250,easing:"ease"}});Ce("dialog.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:250,easing:"ease"}});Ce("dialog.denyClose",{keyframes:[{scale:1},{scale:1.02},{scale:1}],options:{duration:250}});Ce("dialog.overlay.show",{keyframes:[{opacity:0},{opacity:1}],options:{duration:250}});Ce("dialog.overlay.hide",{keyframes:[{opacity:1},{opacity:0}],options:{duration:250}});it.define("sl-dialog");var ac=Z`
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
`;var lc=Z`
  :host {
    display: contents;
  }
`;var ks=class extends te{constructor(){super(...arguments),this.observedElements=[],this.disabled=!1}connectedCallback(){super.connectedCallback(),this.resizeObserver=new ResizeObserver(e=>{this.emit("sl-resize",{detail:{entries:e}})}),this.disabled||this.startObserver()}disconnectedCallback(){super.disconnectedCallback(),this.stopObserver()}handleSlotChange(){this.disabled||this.startObserver()}startObserver(){let e=this.shadowRoot.querySelector("slot");if(e!==null){let t=e.assignedElements({flatten:!0});this.observedElements.forEach(i=>this.resizeObserver.unobserve(i)),this.observedElements=[],t.forEach(i=>{this.resizeObserver.observe(i),this.observedElements.push(i)})}}stopObserver(){this.resizeObserver.disconnect()}handleDisabledChange(){this.disabled?this.stopObserver():this.startObserver()}render(){return P` <slot @slotchange=${this.handleSlotChange}></slot> `}};ks.styles=[ne,lc];A([M({type:Boolean,reflect:!0})],ks.prototype,"disabled",2);A([Q("disabled",{waitUntilFirstUpdate:!0})],ks.prototype,"handleDisabledChange",1);var Ae=class extends te{constructor(){super(...arguments),this.tabs=[],this.focusableTabs=[],this.panels=[],this.localize=new ge(this),this.hasScrollControls=!1,this.shouldHideScrollStartButton=!1,this.shouldHideScrollEndButton=!1,this.placement="top",this.activation="auto",this.noScrollControls=!1,this.fixedScrollControls=!1,this.scrollOffset=1}connectedCallback(){let e=Promise.all([customElements.whenDefined("sl-tab"),customElements.whenDefined("sl-tab-panel")]);super.connectedCallback(),this.resizeObserver=new ResizeObserver(()=>{this.repositionIndicator(),this.updateScrollControls()}),this.mutationObserver=new MutationObserver(t=>{let i=t.filter(({target:n})=>{if(n===this)return!0;if(n.closest("sl-tab-group")!==this)return!1;let u=n.tagName.toLowerCase();return u==="sl-tab"||u==="sl-tab-panel"});if(i.length!==0){if(i.some(n=>!["aria-labelledby","aria-controls"].includes(n.attributeName))&&setTimeout(()=>this.setAriaLabels()),i.some(n=>n.attributeName==="disabled"))this.syncTabsAndPanels();else if(i.some(n=>n.attributeName==="active")){let u=i.filter(s=>s.attributeName==="active"&&s.target.tagName.toLowerCase()==="sl-tab").map(s=>s.target).find(s=>s.active);u&&this.setActiveTab(u)}}}),this.updateComplete.then(()=>{this.syncTabsAndPanels(),this.mutationObserver.observe(this,{attributes:!0,attributeFilter:["active","disabled","name","panel"],childList:!0,subtree:!0}),this.resizeObserver.observe(this.nav),e.then(()=>{new IntersectionObserver((i,n)=>{var u;i[0].intersectionRatio>0&&(this.setAriaLabels(),this.setActiveTab((u=this.getActiveTab())!=null?u:this.tabs[0],{emitEvents:!1}),n.unobserve(i[0].target))}).observe(this.tabGroup)})})}disconnectedCallback(){var e,t;super.disconnectedCallback(),(e=this.mutationObserver)==null||e.disconnect(),this.nav&&((t=this.resizeObserver)==null||t.unobserve(this.nav))}getAllTabs(){return this.shadowRoot.querySelector('slot[name="nav"]').assignedElements()}getAllPanels(){return[...this.body.assignedElements()].filter(e=>e.tagName.toLowerCase()==="sl-tab-panel")}getActiveTab(){return this.tabs.find(e=>e.active)}handleClick(e){let i=e.target.closest("sl-tab");i?.closest("sl-tab-group")===this&&i!==null&&this.setActiveTab(i,{scrollBehavior:"smooth"})}handleKeyDown(e){let i=e.target.closest("sl-tab");if(i?.closest("sl-tab-group")===this&&(["Enter"," "].includes(e.key)&&i!==null&&(this.setActiveTab(i,{scrollBehavior:"smooth"}),e.preventDefault()),["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key))){let u=this.tabs.find(l=>l.matches(":focus")),s=this.localize.dir()==="rtl",r=null;if(u?.tagName.toLowerCase()==="sl-tab"){if(e.key==="Home")r=this.focusableTabs[0];else if(e.key==="End")r=this.focusableTabs[this.focusableTabs.length-1];else if(["top","bottom"].includes(this.placement)&&e.key===(s?"ArrowRight":"ArrowLeft")||["start","end"].includes(this.placement)&&e.key==="ArrowUp"){let l=this.tabs.findIndex(p=>p===u);r=this.findNextFocusableTab(l,"backward")}else if(["top","bottom"].includes(this.placement)&&e.key===(s?"ArrowLeft":"ArrowRight")||["start","end"].includes(this.placement)&&e.key==="ArrowDown"){let l=this.tabs.findIndex(p=>p===u);r=this.findNextFocusableTab(l,"forward")}if(!r)return;r.tabIndex=0,r.focus({preventScroll:!0}),this.activation==="auto"?this.setActiveTab(r,{scrollBehavior:"smooth"}):this.tabs.forEach(l=>{l.tabIndex=l===r?0:-1}),["top","bottom"].includes(this.placement)&&fs(r,this.nav,"horizontal"),e.preventDefault()}}}handleScrollToStart(){this.nav.scroll({left:this.localize.dir()==="rtl"?this.nav.scrollLeft+this.nav.clientWidth:this.nav.scrollLeft-this.nav.clientWidth,behavior:"smooth"})}handleScrollToEnd(){this.nav.scroll({left:this.localize.dir()==="rtl"?this.nav.scrollLeft-this.nav.clientWidth:this.nav.scrollLeft+this.nav.clientWidth,behavior:"smooth"})}setActiveTab(e,t){if(t=Oe({emitEvents:!0,scrollBehavior:"auto"},t),e!==this.activeTab&&!e.disabled){let i=this.activeTab;this.activeTab=e,this.tabs.forEach(n=>{n.active=n===this.activeTab,n.tabIndex=n===this.activeTab?0:-1}),this.panels.forEach(n=>{var u;return n.active=n.name===((u=this.activeTab)==null?void 0:u.panel)}),this.syncIndicator(),["top","bottom"].includes(this.placement)&&fs(this.activeTab,this.nav,"horizontal",t.scrollBehavior),t.emitEvents&&(i&&this.emit("sl-tab-hide",{detail:{name:i.panel}}),this.emit("sl-tab-show",{detail:{name:this.activeTab.panel}}))}}setAriaLabels(){this.tabs.forEach(e=>{let t=this.panels.find(i=>i.name===e.panel);t&&(e.setAttribute("aria-controls",t.getAttribute("id")),t.setAttribute("aria-labelledby",e.getAttribute("id")))})}repositionIndicator(){let e=this.getActiveTab();if(!e)return;let t=e.clientWidth,i=e.clientHeight,n=this.localize.dir()==="rtl",u=this.getAllTabs(),r=u.slice(0,u.indexOf(e)).reduce((l,p)=>({left:l.left+p.clientWidth,top:l.top+p.clientHeight}),{left:0,top:0});switch(this.placement){case"top":case"bottom":this.indicator.style.width=`${t}px`,this.indicator.style.height="auto",this.indicator.style.translate=n?`${-1*r.left}px`:`${r.left}px`;break;case"start":case"end":this.indicator.style.width="auto",this.indicator.style.height=`${i}px`,this.indicator.style.translate=`0 ${r.top}px`;break}}syncTabsAndPanels(){this.tabs=this.getAllTabs(),this.focusableTabs=this.tabs.filter(e=>!e.disabled),this.panels=this.getAllPanels(),this.syncIndicator(),this.updateComplete.then(()=>this.updateScrollControls())}findNextFocusableTab(e,t){let i=null,n=t==="forward"?1:-1,u=e+n;for(;e<this.tabs.length;){if(i=this.tabs[u]||null,i===null){t==="forward"?i=this.focusableTabs[0]:i=this.focusableTabs[this.focusableTabs.length-1];break}if(!i.disabled)break;u+=n}return i}updateScrollButtons(){this.hasScrollControls&&!this.fixedScrollControls&&(this.shouldHideScrollStartButton=this.scrollFromStart()<=this.scrollOffset,this.shouldHideScrollEndButton=this.isScrolledToEnd())}isScrolledToEnd(){return this.scrollFromStart()+this.nav.clientWidth>=this.nav.scrollWidth-this.scrollOffset}scrollFromStart(){return this.localize.dir()==="rtl"?-this.nav.scrollLeft:this.nav.scrollLeft}updateScrollControls(){this.noScrollControls?this.hasScrollControls=!1:this.hasScrollControls=["top","bottom"].includes(this.placement)&&this.nav.scrollWidth>this.nav.clientWidth+1,this.updateScrollButtons()}syncIndicator(){this.getActiveTab()?(this.indicator.style.display="block",this.repositionIndicator()):this.indicator.style.display="none"}show(e){let t=this.tabs.find(i=>i.panel===e);t&&this.setActiveTab(t,{scrollBehavior:"smooth"})}render(){let e=this.localize.dir()==="rtl";return P`
      <div
        part="base"
        class=${ie({"tab-group":!0,"tab-group--top":this.placement==="top","tab-group--bottom":this.placement==="bottom","tab-group--start":this.placement==="start","tab-group--end":this.placement==="end","tab-group--rtl":this.localize.dir()==="rtl","tab-group--has-scroll-controls":this.hasScrollControls})}
        @click=${this.handleClick}
        @keydown=${this.handleKeyDown}
      >
        <div class="tab-group__nav-container" part="nav">
          ${this.hasScrollControls?P`
                <sl-icon-button
                  part="scroll-button scroll-button--start"
                  exportparts="base:scroll-button__base"
                  class=${ie({"tab-group__scroll-button":!0,"tab-group__scroll-button--start":!0,"tab-group__scroll-button--start--hidden":this.shouldHideScrollStartButton})}
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

          ${this.hasScrollControls?P`
                <sl-icon-button
                  part="scroll-button scroll-button--end"
                  exportparts="base:scroll-button__base"
                  class=${ie({"tab-group__scroll-button":!0,"tab-group__scroll-button--end":!0,"tab-group__scroll-button--end--hidden":this.shouldHideScrollEndButton})}
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
    `}};Ae.styles=[ne,ac];Ae.dependencies={"sl-icon-button":we,"sl-resize-observer":ks};A([ee(".tab-group")],Ae.prototype,"tabGroup",2);A([ee(".tab-group__body")],Ae.prototype,"body",2);A([ee(".tab-group__nav")],Ae.prototype,"nav",2);A([ee(".tab-group__indicator")],Ae.prototype,"indicator",2);A([de()],Ae.prototype,"hasScrollControls",2);A([de()],Ae.prototype,"shouldHideScrollStartButton",2);A([de()],Ae.prototype,"shouldHideScrollEndButton",2);A([M()],Ae.prototype,"placement",2);A([M()],Ae.prototype,"activation",2);A([M({attribute:"no-scroll-controls",type:Boolean})],Ae.prototype,"noScrollControls",2);A([M({attribute:"fixed-scroll-controls",type:Boolean})],Ae.prototype,"fixedScrollControls",2);A([nl({passive:!0})],Ae.prototype,"updateScrollButtons",1);A([Q("noScrollControls",{waitUntilFirstUpdate:!0})],Ae.prototype,"updateScrollControls",1);A([Q("placement",{waitUntilFirstUpdate:!0})],Ae.prototype,"syncIndicator",1);Ae.define("sl-tab-group");var bu=(e,t)=>{let i=0;return function(...n){window.clearTimeout(i),i=window.setTimeout(()=>{e.call(this,...n)},t)}},cc=(e,t,i)=>{let n=e[t];e[t]=function(...u){n.call(this,...u),i.call(this,n,...u)}};(()=>{if(typeof window>"u")return;if(!("onscrollend"in window)){let t=new Set,i=new WeakMap,n=s=>{for(let r of s.changedTouches)t.add(r.identifier)},u=s=>{for(let r of s.changedTouches)t.delete(r.identifier)};document.addEventListener("touchstart",n,!0),document.addEventListener("touchend",u,!0),document.addEventListener("touchcancel",u,!0),cc(EventTarget.prototype,"addEventListener",function(s,r){if(r!=="scrollend")return;let l=bu(()=>{t.size?l():this.dispatchEvent(new Event("scrollend"))},100);s.call(this,"scroll",l,{passive:!0}),i.set(this,l)}),cc(EventTarget.prototype,"removeEventListener",function(s,r){if(r!=="scrollend")return;let l=i.get(this);l&&s.call(this,"scroll",l,{passive:!0})})}})();var hc=Z`
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
`;var yu=0,Ye=class extends te{constructor(){super(...arguments),this.localize=new ge(this),this.attrId=++yu,this.componentId=`sl-tab-${this.attrId}`,this.panel="",this.active=!1,this.closable=!1,this.disabled=!1,this.tabIndex=0}connectedCallback(){super.connectedCallback(),this.setAttribute("role","tab")}handleCloseClick(e){e.stopPropagation(),this.emit("sl-close")}handleActiveChange(){this.setAttribute("aria-selected",this.active?"true":"false")}handleDisabledChange(){this.setAttribute("aria-disabled",this.disabled?"true":"false"),this.disabled&&!this.active?this.tabIndex=-1:this.tabIndex=0}render(){return this.id=this.id.length>0?this.id:this.componentId,P`
      <div
        part="base"
        class=${ie({tab:!0,"tab--active":this.active,"tab--closable":this.closable,"tab--disabled":this.disabled})}
      >
        <slot></slot>
        ${this.closable?P`
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
    `}};Ye.styles=[ne,hc];Ye.dependencies={"sl-icon-button":we};A([ee(".tab")],Ye.prototype,"tab",2);A([M({reflect:!0})],Ye.prototype,"panel",2);A([M({type:Boolean,reflect:!0})],Ye.prototype,"active",2);A([M({type:Boolean,reflect:!0})],Ye.prototype,"closable",2);A([M({type:Boolean,reflect:!0})],Ye.prototype,"disabled",2);A([M({type:Number,reflect:!0})],Ye.prototype,"tabIndex",2);A([Q("active")],Ye.prototype,"handleActiveChange",1);A([Q("disabled")],Ye.prototype,"handleDisabledChange",1);Ye.define("sl-tab");var dc=Z`
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
`;var wu=0,Bi=class extends te{constructor(){super(...arguments),this.attrId=++wu,this.componentId=`sl-tab-panel-${this.attrId}`,this.name="",this.active=!1}connectedCallback(){super.connectedCallback(),this.id=this.id.length>0?this.id:this.componentId,this.setAttribute("role","tabpanel")}handleActiveChange(){this.setAttribute("aria-hidden",this.active?"false":"true")}render(){return P`
      <slot
        part="base"
        class=${ie({"tab-panel":!0,"tab-panel--active":this.active})}
      ></slot>
    `}};Bi.styles=[ne,dc];A([M({reflect:!0})],Bi.prototype,"name",2);A([M({type:Boolean,reflect:!0})],Bi.prototype,"active",2);A([Q("active")],Bi.prototype,"handleActiveChange",1);Bi.define("sl-tab-panel");var uc=Z`
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
`;var De=class extends te{constructor(){super(...arguments),this.formControlController=new dt(this,{value:e=>e.checked?e.value||"on":void 0,defaultValue:e=>e.defaultChecked,setValue:(e,t)=>e.checked=t}),this.hasSlotController=new ze(this,"help-text"),this.hasFocus=!1,this.title="",this.name="",this.size="medium",this.disabled=!1,this.checked=!1,this.defaultChecked=!1,this.form="",this.required=!1,this.helpText=""}get validity(){return this.input.validity}get validationMessage(){return this.input.validationMessage}firstUpdated(){this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleInput(){this.emit("sl-input")}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleClick(){this.checked=!this.checked,this.emit("sl-change")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleKeyDown(e){e.key==="ArrowLeft"&&(e.preventDefault(),this.checked=!1,this.emit("sl-change"),this.emit("sl-input")),e.key==="ArrowRight"&&(e.preventDefault(),this.checked=!0,this.emit("sl-change"),this.emit("sl-input"))}handleCheckedChange(){this.input.checked=this.checked,this.formControlController.updateValidity()}handleDisabledChange(){this.formControlController.setValidity(!0)}click(){this.input.click()}focus(e){this.input.focus(e)}blur(){this.input.blur()}checkValidity(){return this.input.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.input.reportValidity()}setCustomValidity(e){this.input.setCustomValidity(e),this.formControlController.updateValidity()}render(){let e=this.hasSlotController.test("help-text"),t=this.helpText?!0:!!e;return P`
      <div
        class=${ie({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-help-text":t})}
      >
        <label
          part="base"
          class=${ie({switch:!0,"switch--checked":this.checked,"switch--disabled":this.disabled,"switch--focused":this.hasFocus,"switch--small":this.size==="small","switch--medium":this.size==="medium","switch--large":this.size==="large"})}
        >
          <input
            class="switch__input"
            type="checkbox"
            title=${this.title}
            name=${this.name}
            value=${J(this.value)}
            .checked=${Oi(this.checked)}
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
    `}};De.styles=[ne,Mt,uc];A([ee('input[type="checkbox"]')],De.prototype,"input",2);A([de()],De.prototype,"hasFocus",2);A([M()],De.prototype,"title",2);A([M()],De.prototype,"name",2);A([M()],De.prototype,"value",2);A([M({reflect:!0})],De.prototype,"size",2);A([M({type:Boolean,reflect:!0})],De.prototype,"disabled",2);A([M({type:Boolean,reflect:!0})],De.prototype,"checked",2);A([$i("checked")],De.prototype,"defaultChecked",2);A([M({reflect:!0})],De.prototype,"form",2);A([M({type:Boolean,reflect:!0})],De.prototype,"required",2);A([M({attribute:"help-text"})],De.prototype,"helpText",2);A([Q("checked",{waitUntilFirstUpdate:!0})],De.prototype,"handleCheckedChange",1);A([Q("disabled",{waitUntilFirstUpdate:!0})],De.prototype,"handleDisabledChange",1);De.define("sl-switch");var pc=Z`
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
`;var Ue=class ni extends te{constructor(){super(...arguments),this.hasSlotController=new ze(this,"icon","suffix"),this.localize=new ge(this),this.open=!1,this.closable=!1,this.variant="primary",this.duration=1/0,this.remainingTime=this.duration}static get toastStack(){return this.currentToastStack||(this.currentToastStack=Object.assign(document.createElement("div"),{className:"sl-toast-stack"})),this.currentToastStack}firstUpdated(){this.base.hidden=!this.open}restartAutoHide(){this.handleCountdownChange(),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval),this.open&&this.duration<1/0&&(this.autoHideTimeout=window.setTimeout(()=>this.hide(),this.duration),this.remainingTime=this.duration,this.remainingTimeInterval=window.setInterval(()=>{this.remainingTime-=100},100))}pauseAutoHide(){var t;(t=this.countdownAnimation)==null||t.pause(),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval)}resumeAutoHide(){var t;this.duration<1/0&&(this.autoHideTimeout=window.setTimeout(()=>this.hide(),this.remainingTime),this.remainingTimeInterval=window.setInterval(()=>{this.remainingTime-=100},100),(t=this.countdownAnimation)==null||t.play())}handleCountdownChange(){if(this.open&&this.duration<1/0&&this.countdown){let{countdownElement:t}=this,i="100%",n="0";this.countdownAnimation=t.animate([{width:i},{width:n}],{duration:this.duration,easing:"linear"})}}handleCloseClick(){this.hide()}async handleOpenChange(){if(this.open){this.emit("sl-show"),this.duration<1/0&&this.restartAutoHide(),await Te(this.base),this.base.hidden=!1;let{keyframes:t,options:i}=xe(this,"alert.show",{dir:this.localize.dir()});await ke(this.base,t,i),this.emit("sl-after-show")}else{br(this),this.emit("sl-hide"),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval),await Te(this.base);let{keyframes:t,options:i}=xe(this,"alert.hide",{dir:this.localize.dir()});await ke(this.base,t,i),this.base.hidden=!0,this.emit("sl-after-hide")}}handleDurationChange(){this.restartAutoHide()}async show(){if(!this.open)return this.open=!0,Be(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,Be(this,"sl-after-hide")}async toast(){return new Promise(t=>{this.handleCountdownChange(),ni.toastStack.parentElement===null&&document.body.append(ni.toastStack),ni.toastStack.appendChild(this),requestAnimationFrame(()=>{this.clientWidth,this.show()}),this.addEventListener("sl-after-hide",()=>{ni.toastStack.removeChild(this),t(),ni.toastStack.querySelector("sl-alert")===null&&ni.toastStack.remove()},{once:!0})})}render(){return P`
      <div
        part="base"
        class=${ie({alert:!0,"alert--open":this.open,"alert--closable":this.closable,"alert--has-countdown":!!this.countdown,"alert--has-icon":this.hasSlotController.test("icon"),"alert--primary":this.variant==="primary","alert--success":this.variant==="success","alert--neutral":this.variant==="neutral","alert--warning":this.variant==="warning","alert--danger":this.variant==="danger"})}
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

        ${this.closable?P`
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

        ${this.countdown?P`
              <div
                class=${ie({alert__countdown:!0,"alert__countdown--ltr":this.countdown==="ltr"})}
              >
                <div class="alert__countdown-elapsed"></div>
              </div>
            `:""}
      </div>
    `}};Ue.styles=[ne,pc];Ue.dependencies={"sl-icon-button":we};A([ee('[part~="base"]')],Ue.prototype,"base",2);A([ee(".alert__countdown-elapsed")],Ue.prototype,"countdownElement",2);A([M({type:Boolean,reflect:!0})],Ue.prototype,"open",2);A([M({type:Boolean,reflect:!0})],Ue.prototype,"closable",2);A([M({reflect:!0})],Ue.prototype,"variant",2);A([M({type:Number})],Ue.prototype,"duration",2);A([M({type:String,reflect:!0})],Ue.prototype,"countdown",2);A([de()],Ue.prototype,"remainingTime",2);A([Q("open",{waitUntilFirstUpdate:!0})],Ue.prototype,"handleOpenChange",1);A([Q("duration")],Ue.prototype,"handleDurationChange",1);var fc=Ue;Ce("alert.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:250,easing:"ease"}});Ce("alert.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:250,easing:"ease"}});fc.define("sl-alert");var mc=Z`
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
`;var ce=class extends te{constructor(){super(...arguments),this.formControlController=new dt(this,{assumeInteractionOn:["sl-blur","sl-input"]}),this.hasSlotController=new ze(this,"help-text","label"),this.hasFocus=!1,this.title="",this.name="",this.value="",this.size="medium",this.filled=!1,this.label="",this.helpText="",this.placeholder="",this.rows=4,this.resize="vertical",this.disabled=!1,this.readonly=!1,this.form="",this.required=!1,this.spellcheck=!0,this.defaultValue=""}get validity(){return this.input.validity}get validationMessage(){return this.input.validationMessage}connectedCallback(){super.connectedCallback(),this.resizeObserver=new ResizeObserver(()=>this.setTextareaHeight()),this.updateComplete.then(()=>{this.setTextareaHeight(),this.resizeObserver.observe(this.input)})}firstUpdated(){this.formControlController.updateValidity()}disconnectedCallback(){var e;super.disconnectedCallback(),this.input&&((e=this.resizeObserver)==null||e.unobserve(this.input))}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleChange(){this.value=this.input.value,this.setTextareaHeight(),this.emit("sl-change")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleInput(){this.value=this.input.value,this.emit("sl-input")}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}setTextareaHeight(){this.resize==="auto"?(this.sizeAdjuster.style.height=`${this.input.clientHeight}px`,this.input.style.height="auto",this.input.style.height=`${this.input.scrollHeight}px`):this.input.style.height=""}handleDisabledChange(){this.formControlController.setValidity(this.disabled)}handleRowsChange(){this.setTextareaHeight()}async handleValueChange(){await this.updateComplete,this.formControlController.updateValidity(),this.setTextareaHeight()}focus(e){this.input.focus(e)}blur(){this.input.blur()}select(){this.input.select()}scrollPosition(e){if(e){typeof e.top=="number"&&(this.input.scrollTop=e.top),typeof e.left=="number"&&(this.input.scrollLeft=e.left);return}return{top:this.input.scrollTop,left:this.input.scrollTop}}setSelectionRange(e,t,i="none"){this.input.setSelectionRange(e,t,i)}setRangeText(e,t,i,n="preserve"){let u=t??this.input.selectionStart,s=i??this.input.selectionEnd;this.input.setRangeText(e,u,s,n),this.value!==this.input.value&&(this.value=this.input.value,this.setTextareaHeight())}checkValidity(){return this.input.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.input.reportValidity()}setCustomValidity(e){this.input.setCustomValidity(e),this.formControlController.updateValidity()}render(){let e=this.hasSlotController.test("label"),t=this.hasSlotController.test("help-text"),i=this.label?!0:!!e,n=this.helpText?!0:!!t;return P`
      <div
        part="form-control"
        class=${ie({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-label":i,"form-control--has-help-text":n})}
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
            class=${ie({textarea:!0,"textarea--small":this.size==="small","textarea--medium":this.size==="medium","textarea--large":this.size==="large","textarea--standard":!this.filled,"textarea--filled":this.filled,"textarea--disabled":this.disabled,"textarea--focused":this.hasFocus,"textarea--empty":!this.value,"textarea--resize-none":this.resize==="none","textarea--resize-vertical":this.resize==="vertical","textarea--resize-auto":this.resize==="auto"})}
          >
            <textarea
              part="textarea"
              id="input"
              class="textarea__control"
              title=${this.title}
              name=${J(this.name)}
              .value=${Oi(this.value)}
              ?disabled=${this.disabled}
              ?readonly=${this.readonly}
              ?required=${this.required}
              placeholder=${J(this.placeholder)}
              rows=${J(this.rows)}
              minlength=${J(this.minlength)}
              maxlength=${J(this.maxlength)}
              autocapitalize=${J(this.autocapitalize)}
              autocorrect=${J(this.autocorrect)}
              ?autofocus=${this.autofocus}
              spellcheck=${J(this.spellcheck)}
              enterkeyhint=${J(this.enterkeyhint)}
              inputmode=${J(this.inputmode)}
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
          aria-hidden=${n?"false":"true"}
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `}};ce.styles=[ne,Mt,mc];A([ee(".textarea__control")],ce.prototype,"input",2);A([ee(".textarea__size-adjuster")],ce.prototype,"sizeAdjuster",2);A([de()],ce.prototype,"hasFocus",2);A([M()],ce.prototype,"title",2);A([M()],ce.prototype,"name",2);A([M()],ce.prototype,"value",2);A([M({reflect:!0})],ce.prototype,"size",2);A([M({type:Boolean,reflect:!0})],ce.prototype,"filled",2);A([M()],ce.prototype,"label",2);A([M({attribute:"help-text"})],ce.prototype,"helpText",2);A([M()],ce.prototype,"placeholder",2);A([M({type:Number})],ce.prototype,"rows",2);A([M()],ce.prototype,"resize",2);A([M({type:Boolean,reflect:!0})],ce.prototype,"disabled",2);A([M({type:Boolean,reflect:!0})],ce.prototype,"readonly",2);A([M({reflect:!0})],ce.prototype,"form",2);A([M({type:Boolean,reflect:!0})],ce.prototype,"required",2);A([M({type:Number})],ce.prototype,"minlength",2);A([M({type:Number})],ce.prototype,"maxlength",2);A([M()],ce.prototype,"autocapitalize",2);A([M()],ce.prototype,"autocorrect",2);A([M()],ce.prototype,"autocomplete",2);A([M({type:Boolean})],ce.prototype,"autofocus",2);A([M()],ce.prototype,"enterkeyhint",2);A([M({type:Boolean,converter:{fromAttribute:e=>!(!e||e==="false"),toAttribute:e=>e?"true":"false"}})],ce.prototype,"spellcheck",2);A([M()],ce.prototype,"inputmode",2);A([$i()],ce.prototype,"defaultValue",2);A([Q("disabled",{waitUntilFirstUpdate:!0})],ce.prototype,"handleDisabledChange",1);A([Q("rows",{waitUntilFirstUpdate:!0})],ce.prototype,"handleRowsChange",1);A([Q("value",{waitUntilFirstUpdate:!0})],ce.prototype,"handleValueChange",1);ce.define("sl-textarea");var pe=kn(),he=Ln(),wr=Ra({store:pe,ws:he,getSettings:()=>li}),se=Pr(location.hash),vc=he.getState(),nn=!0,Ie="*",an="",li={},ai=null,Je=null,Pi=null,Sr=!1,Cr=!1,As=null,Es={},yr=new Set;function Su(e,t){if(!(!e||!t)){Es[e]||(Es[e]={});for(let[i,n]of Object.entries(t)){if(n.status==="pending")continue;let u=`${e}:${i}`;Es[e][i]||yr.has(u)||(yr.add(u),he.send("get-agent-prompt",{runId:e,stage:i}).then(s=>{Es[e][i]=s,yr.delete(u),ve()}).catch(()=>{yr.delete(u)}))}}}function _c(e){if(!e||!e.stages)return null;for(let[t,i]of Object.entries(e.stages))if(i.status==="in_progress")return t;return null}function bc(e,t){let i=_c(e),n=_c(t);n&&i!==n&&(Ie="*",ai=null,Si(),pe.clearLog(),he.send("unsubscribe-log").catch(()=>{}),he.send("subscribe-log",{stage:null,runId:t.id}).catch(()=>{}))}he.on("runs-list",e=>{let t={};for(let i of e.runs||[])t[i.id]=i;pe.setState({runs:t}),e.settings&&(li=e.settings)});he.on("run-snapshot",e=>{if(e&&e.id){let t=pe.getState().runs[e.id]??null;wr.handleRunUpdate(e.id,e,t),pe.setRun(e.id,e),se.runId===e.id&&(bc(t,e),er(e)),Je&&(Je=null,ve())}});he.on("run-update",e=>{if(e&&e.id){let t=pe.getState().runs[e.id]??null;wr.handleRunUpdate(e.id,e,t),pe.setRun(e.id,e),se.runId===e.id&&(bc(t,e),er(e)),Je&&(Je=null,ve())}});he.on("log-line",e=>{e&&(pe.appendLog(e),e.iteration&&e.iteration>1&&e._iterStart&&(Ie!=="*"&&Ca(e.iteration),Aa(e.iteration)),Ie!=="*"&&xo(e),Lo(e))});he.on("log-bulk",e=>{if(e&&Array.isArray(e.lines))for(let t of e.lines){let i={stage:e.stage,line:t};pe.appendLog(i),Ie!=="*"&&xo(i),Lo(i)}});he.on("preferences",e=>{e&&(pe.setState({preferences:e}),qi(e.theme||"light"))});he.on("run-started",()=>{he.send("list-runs").then(e=>{let t={};for(let i of e.runs||[])t[i.id]=i;pe.setState({runs:t}),e.settings&&(li=e.settings)}).catch(()=>{})});he.on("run-stopped",()=>{Je=null,he.send("list-runs").then(e=>{let t={};for(let i of e.runs||[])t[i.id]=i;pe.setState({runs:t}),e.settings&&(li=e.settings)}).catch(()=>{})});he.on("stage-restarted",()=>{he.send("list-runs").then(e=>{let t={};for(let i of e.runs||[])t[i.id]=i;pe.setState({runs:t}),e.settings&&(li=e.settings)}).catch(()=>{})});he.onConnection(e=>{vc=e,e==="open"&&(he.send("list-runs").then(t=>{let i={};for(let n of t.runs||[])i[n.id]=n;pe.setState({runs:i}),t.settings&&(li=t.settings)}).catch(()=>{}),he.send("get-preferences").then(t=>{pe.setState({preferences:t}),qi(t.theme||"light")}).catch(()=>{}),se.runId&&(he.send("subscribe-run",{runId:se.runId}).catch(()=>{}),he.send("subscribe-log",{stage:Ie==="*"?null:Ie,runId:se.runId}).catch(()=>{}))),ve()});Tn(e=>{let t=se.runId;se=e,t&&t!==se.runId&&(he.send("unsubscribe-run").catch(()=>{}),he.send("unsubscribe-log").catch(()=>{}),pe.clearLog(),Si(),To()),se.runId&&se.runId!==t&&(Ie="*",ai=null,he.send("subscribe-run",{runId:se.runId}).catch(()=>{}),he.send("subscribe-log",{stage:null,runId:se.runId}).catch(()=>{})),se.section==="settings"&&eo().then(()=>ve()),!se.runId&&t&&(ya(),La()),ve()});function yc(e){Ve(e,null)}function gc(e){Ve(se.section,e)}function Cu(){let t=pe.getState().preferences.theme==="dark"?"light":"dark";he.send("set-preferences",{theme:t}).catch(()=>{}),pe.setState({preferences:{theme:t}}),qi(t)}function xu(e){he.send("set-preferences",{notifications:e}).catch(()=>{}),pe.setState({preferences:{notifications:e}})}function ku(e){if(Ie=e,e!=="*"){let n=pe.getState().runs[se.runId]?.stages?.[e]?.iterations?.length||0;ai=n>0?n:null}else ai=null;Si(),pe.clearLog(),he.send("unsubscribe-log").catch(()=>{}),he.send("subscribe-log",{stage:e==="*"?null:e,runId:se.runId,iteration:ai}).catch(()=>{}),ve()}function Eu(e){ai=e,Si(),pe.clearLog(),he.send("unsubscribe-log").catch(()=>{}),he.send("subscribe-log",{stage:Ie==="*"?null:Ie,runId:se.runId,iteration:e}).catch(()=>{}),ve()}function Au(e){an=e,wa(e)}function Lu(){nn=!nn,ve()}function Ls(e){Pi=e,ve(),requestAnimationFrame(()=>{let t=document.getElementById("action-error-dialog");t&&t.show()})}function Tu(){Pi=null,ve()}function Du(){Sr=!0,ve(),requestAnimationFrame(()=>{let e=document.getElementById("stop-confirm-dialog");e&&e.show()})}function Ru(){Sr=!1,ve()}async function $u(){Sr=!1,Je="stopping",Pi=null,ve();try{let t=Object.values(pe.getState().runs).find(u=>u.active)?.id||"current",n=await(await fetch(`/api/runs/${t}`,{method:"DELETE"})).json();n.ok||(Je=null,Ls(n.error||"Failed to stop pipeline"))}catch(e){Je=null,Ls(e?.message||"Failed to stop pipeline")}}function Ou(){Je="resuming",Pi=null,ve(),he.send("resume-run").then(()=>{}).catch(e=>{Je=null,Ls(e?.message||"Failed to resume pipeline")})}function Mu(e){As=e,Cr=!0,ve(),requestAnimationFrame(()=>{let t=document.getElementById("restart-stage-confirm-dialog");t&&t.show()})}function Bu(){Cr=!1,As=null,ve()}async function Pu(){Cr=!1;let e=As;As=null,ve();try{let i=Object.values(pe.getState().runs).find(s=>!s.active)?.id||"current",u=await(await fetch(`/api/runs/${i}/stages/${e}/restart`,{method:"POST"})).json();u.ok?Ve("active",null):Ls(u.error||"Failed to restart stage")}catch(t){Ls(t?.message||"Failed to restart stage")}}function Iu(){if(se.runId){let t=Object.values(pe.getState().runs).filter(i=>i.active);se.section==="active"&&t.length<=1?Ve("dashboard",null):Ve(se.section,null)}else se.section&&se.section!=="dashboard"&&Ve("dashboard",null)}function Hu(){let e=pe.getState(),t="Dashboard",i=!1,n=null,u=null;if(se.runId){let s=e.runs[se.runId],l=(s?.work_request?.title||"Pipeline Details").split(`
`)[0];if(t=l.length>80?l.slice(0,80)+"\u2026":l,i=!0,s){let p=s.runState||(s.active?"running":"terminal"),d=p==="running"?"warning":p==="interrupted"?"neutral":"success",f=p==="running"?"in_progress":p==="interrupted"?"interrupted":"completed",g=p==="running"?"Running":p==="interrupted"?"Interrupted":"Completed";n=P`<sl-badge variant="${d}" pill>
        ${K(rt(f,12))}
        ${g}
      </sl-badge>`,Je==="stopping"?u=P`
          <button class="action-btn action-btn--danger" disabled>
            ${K(Y(xt,14,"icon-spin"))}
            Stopping\u2026
          </button>`:Je==="resuming"?u=P`
          <button class="action-btn action-btn--primary" disabled>
            ${K(Y(xt,14,"icon-spin"))}
            Resuming\u2026
          </button>`:p==="running"?u=P`
          <button class="action-btn action-btn--danger" @click=${Du}>
            ${K(Y(Ur,14))}
            Stop Pipeline
          </button>`:p==="interrupted"&&(u=P`
          <button class="action-btn action-btn--primary" @click=${Ou}>
            ${K(Y(Is,14))}
            Resume Pipeline
          </button>`)}}else if(se.section==="active")t="Running Pipelines",i=!0;else if(se.section==="history")t="History",i=!0;else if(se.section==="new-run"){t="New Pipeline",i=!0;let s=Wn(),l=Object.values(e.runs).some(p=>p.active);u=P`
      <button class="action-btn action-btn--primary" ?disabled=${s.isSubmitting||l}
        @click=${()=>Un({rerender:ve,onStarted:()=>Ve("active")})}>
        ${K(Y(Is,14))}
        ${s.isSubmitting?"Starting\u2026":"Start"}
      </button>`}else se.section==="settings"&&(t="Settings",i=!0);return P`
    <div class="content-header">
      ${i?P`
        <button class="content-header-back" @click=${Iu}>
          ${K(Y(Wr,18))}
        </button>
      `:""}
      ${n||""}
      <h1 class="content-header-title">${t}</h1>
      ${u?P`<div class="content-header-actions">
        ${u}
      </div>`:""}
    </div>
  `}function Fu(){let e=pe.getState(),t=Object.values(e.runs);if(se.runId){let i=e.runs[se.runId],n={};if(i?.stages){for(let[l,p]of Object.entries(i.stages)){let d=p.iterations||[];d.length>0&&(n[l]=d.length)}Su(se.runId,i.stages)}let u=zu(e);u.currentLogStage=Ie==="*"?null:Ie,u.currentLogIteration=ai;let s=!!i?.active,r=Do();return i&&!r&&er(i),P`
      <div class="run-detail-layout">
        <div class="run-detail-layout__stages">
          ${In(i,li,{promptCache:Es[se.runId]||{},onRestartStage:Mu})}
        </div>
        <div class="run-detail-layout__logs">
          ${Da(Do(),s)}
          ${xa(u,{onStageFilter:ku,onIterationFilter:Eu,onSearch:Au,onToggleAutoScroll:Lu,autoScroll:nn,stageIterations:n,runStages:i?.stages})}
        </div>
      </div>
    `}if(se.section==="new-run")return jn(e,{rerender:ve});if(se.section==="settings")return Nn(e.preferences,{rerender:ve,onThemeToggle:Cu,onSaveNotifications:xu});if(se.section==="history")return Qr(t,"history",{onSelectRun:gc});if(se.section==="active"){let i=t.filter(n=>n.active);return i.length===1?(Ve("active",i[0].id),P``):Qr(t,"active",{onSelectRun:gc})}return Hn(e,{onSelectRun:i=>Ve("active",i),onNavigate:yc})}function zu(e){let t=e.logLines;if(Ie!=="*"&&(t=t.filter(i=>i.stage===Ie)),an){let i=an.toLowerCase();t=t.filter(n=>(n.line||"").toLowerCase().includes(i))}return{...e,logLines:t}}function ve(){let e=pe.getState(),t=document.getElementById("app");t&&(Ps(P`
    <div class="app-shell">
      ${Dn(e,se,vc,{onNavigate:yc})}
      <main class="main-content">
        ${wr.renderBanner()}
        ${Hu()}
        ${Fu()}
      </main>
    </div>
    ${Pi?P`
      <sl-dialog id="action-error-dialog" label="Pipeline Error" @sl-after-hide=${Tu}>
        <div class="error-dialog-body">
          ${K(Y(Fr,32,"error-dialog-icon"))}
          <p>${Pi}</p>
        </div>
        <sl-button slot="footer" variant="primary" @click=${()=>{document.getElementById("action-error-dialog")?.hide()}}>OK</sl-button>
      </sl-dialog>
    `:""}
    ${Sr?P`
      <sl-dialog id="stop-confirm-dialog" label="Stop Pipeline?" @sl-after-hide=${Ru}>
        <p>Are you sure? The current stage will be interrupted and marked as error.</p>
        <sl-button slot="footer" @click=${()=>{document.getElementById("stop-confirm-dialog")?.hide()}}>Cancel</sl-button>
        <sl-button slot="footer" variant="danger" @click=${()=>{document.getElementById("stop-confirm-dialog")?.hide(),$u()}}>Stop Pipeline</sl-button>
      </sl-dialog>
    `:""}
    ${Cr?P`
      <sl-dialog id="restart-stage-confirm-dialog" label="Restart Stage?" @sl-after-hide=${Bu}>
        <p>Restart the "${As}" stage? The pipeline will resume from this point.</p>
        <sl-button slot="footer" @click=${()=>{document.getElementById("restart-stage-confirm-dialog")?.hide()}}>Cancel</sl-button>
        <sl-button slot="footer" variant="warning" @click=${()=>{document.getElementById("restart-stage-confirm-dialog")?.hide(),Pu()}}>Restart</sl-button>
      </sl-dialog>
    `:""}
  `,t),se.runId&&(Ie!=="*"&&Sa(se.runId),Ta(se.runId)))}wr.setRerender(ve);pe.subscribe(()=>ve());qi(pe.getState().preferences.theme);se.section==="settings"&&eo().then(()=>ve());ve();
//# sourceMappingURL=main.bundle.js.map
