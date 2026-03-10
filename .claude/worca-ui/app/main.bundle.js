var kl=Object.create;var Zs=Object.defineProperty;var El=Object.getOwnPropertyDescriptor;var Al=Object.getOwnPropertyNames;var Ll=Object.getPrototypeOf,Dl=Object.prototype.hasOwnProperty;var So=(e,t)=>()=>(e&&(t=e(e=0)),t);var Tl=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),Co=(e,t)=>{for(var s in t)Zs(e,s,{get:t[s],enumerable:!0})},Rl=(e,t,s,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let u of Al(t))!Dl.call(e,u)&&u!==s&&Zs(e,u,{get:()=>t[u],enumerable:!(n=El(t,u))||n.enumerable});return e};var Ol=(e,t,s)=>(s=e!=null?kl(Ll(e)):{},Rl(t||!e||!e.__esModule?Zs(s,"default",{value:e,enumerable:!0}):s,e));var en=Tl((ms,kr)=>{(function(e,t){if(typeof ms=="object"&&typeof kr=="object")kr.exports=t();else if(typeof define=="function"&&define.amd)define([],t);else{var s=t();for(var n in s)(typeof ms=="object"?ms:e)[n]=s[n]}})(self,(()=>(()=>{"use strict";var e={4567:function(u,i,o){var c=this&&this.__decorate||function(h,m,v,y){var x,_=arguments.length,S=_<3?m:y===null?y=Object.getOwnPropertyDescriptor(m,v):y;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")S=Reflect.decorate(h,m,v,y);else for(var L=h.length-1;L>=0;L--)(x=h[L])&&(S=(_<3?x(S):_>3?x(m,v,S):x(m,v))||S);return _>3&&S&&Object.defineProperty(m,v,S),S},p=this&&this.__param||function(h,m){return function(v,y){m(v,y,h)}};Object.defineProperty(i,"__esModule",{value:!0}),i.AccessibilityManager=void 0;let d=o(9042),f=o(6114),g=o(9924),w=o(844),b=o(5596),r=o(4725),l=o(3656),a=i.AccessibilityManager=class extends w.Disposable{constructor(h,m){super(),this._terminal=h,this._renderService=m,this._liveRegionLineCount=0,this._charsToConsume=[],this._charsToAnnounce="",this._accessibilityContainer=document.createElement("div"),this._accessibilityContainer.classList.add("xterm-accessibility"),this._rowContainer=document.createElement("div"),this._rowContainer.setAttribute("role","list"),this._rowContainer.classList.add("xterm-accessibility-tree"),this._rowElements=[];for(let v=0;v<this._terminal.rows;v++)this._rowElements[v]=this._createAccessibilityTreeNode(),this._rowContainer.appendChild(this._rowElements[v]);if(this._topBoundaryFocusListener=v=>this._handleBoundaryFocus(v,0),this._bottomBoundaryFocusListener=v=>this._handleBoundaryFocus(v,1),this._rowElements[0].addEventListener("focus",this._topBoundaryFocusListener),this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._refreshRowsDimensions(),this._accessibilityContainer.appendChild(this._rowContainer),this._liveRegion=document.createElement("div"),this._liveRegion.classList.add("live-region"),this._liveRegion.setAttribute("aria-live","assertive"),this._accessibilityContainer.appendChild(this._liveRegion),this._liveRegionDebouncer=this.register(new g.TimeBasedDebouncer(this._renderRows.bind(this))),!this._terminal.element)throw new Error("Cannot enable accessibility before Terminal.open");this._terminal.element.insertAdjacentElement("afterbegin",this._accessibilityContainer),this.register(this._terminal.onResize((v=>this._handleResize(v.rows)))),this.register(this._terminal.onRender((v=>this._refreshRows(v.start,v.end)))),this.register(this._terminal.onScroll((()=>this._refreshRows()))),this.register(this._terminal.onA11yChar((v=>this._handleChar(v)))),this.register(this._terminal.onLineFeed((()=>this._handleChar(`
`)))),this.register(this._terminal.onA11yTab((v=>this._handleTab(v)))),this.register(this._terminal.onKey((v=>this._handleKey(v.key)))),this.register(this._terminal.onBlur((()=>this._clearLiveRegion()))),this.register(this._renderService.onDimensionsChange((()=>this._refreshRowsDimensions()))),this._screenDprMonitor=new b.ScreenDprMonitor(window),this.register(this._screenDprMonitor),this._screenDprMonitor.setListener((()=>this._refreshRowsDimensions())),this.register((0,l.addDisposableDomListener)(window,"resize",(()=>this._refreshRowsDimensions()))),this._refreshRows(),this.register((0,w.toDisposable)((()=>{this._accessibilityContainer.remove(),this._rowElements.length=0})))}_handleTab(h){for(let m=0;m<h;m++)this._handleChar(" ")}_handleChar(h){this._liveRegionLineCount<21&&(this._charsToConsume.length>0?this._charsToConsume.shift()!==h&&(this._charsToAnnounce+=h):this._charsToAnnounce+=h,h===`
`&&(this._liveRegionLineCount++,this._liveRegionLineCount===21&&(this._liveRegion.textContent+=d.tooMuchOutput)),f.isMac&&this._liveRegion.textContent&&this._liveRegion.textContent.length>0&&!this._liveRegion.parentNode&&setTimeout((()=>{this._accessibilityContainer.appendChild(this._liveRegion)}),0))}_clearLiveRegion(){this._liveRegion.textContent="",this._liveRegionLineCount=0,f.isMac&&this._liveRegion.remove()}_handleKey(h){this._clearLiveRegion(),/\p{Control}/u.test(h)||this._charsToConsume.push(h)}_refreshRows(h,m){this._liveRegionDebouncer.refresh(h,m,this._terminal.rows)}_renderRows(h,m){let v=this._terminal.buffer,y=v.lines.length.toString();for(let x=h;x<=m;x++){let _=v.translateBufferLineToString(v.ydisp+x,!0),S=(v.ydisp+x+1).toString(),L=this._rowElements[x];L&&(_.length===0?L.innerText="\xA0":L.textContent=_,L.setAttribute("aria-posinset",S),L.setAttribute("aria-setsize",y))}this._announceCharacters()}_announceCharacters(){this._charsToAnnounce.length!==0&&(this._liveRegion.textContent+=this._charsToAnnounce,this._charsToAnnounce="")}_handleBoundaryFocus(h,m){let v=h.target,y=this._rowElements[m===0?1:this._rowElements.length-2];if(v.getAttribute("aria-posinset")===(m===0?"1":`${this._terminal.buffer.lines.length}`)||h.relatedTarget!==y)return;let x,_;if(m===0?(x=v,_=this._rowElements.pop(),this._rowContainer.removeChild(_)):(x=this._rowElements.shift(),_=v,this._rowContainer.removeChild(x)),x.removeEventListener("focus",this._topBoundaryFocusListener),_.removeEventListener("focus",this._bottomBoundaryFocusListener),m===0){let S=this._createAccessibilityTreeNode();this._rowElements.unshift(S),this._rowContainer.insertAdjacentElement("afterbegin",S)}else{let S=this._createAccessibilityTreeNode();this._rowElements.push(S),this._rowContainer.appendChild(S)}this._rowElements[0].addEventListener("focus",this._topBoundaryFocusListener),this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._terminal.scrollLines(m===0?-1:1),this._rowElements[m===0?1:this._rowElements.length-2].focus(),h.preventDefault(),h.stopImmediatePropagation()}_handleResize(h){this._rowElements[this._rowElements.length-1].removeEventListener("focus",this._bottomBoundaryFocusListener);for(let m=this._rowContainer.children.length;m<this._terminal.rows;m++)this._rowElements[m]=this._createAccessibilityTreeNode(),this._rowContainer.appendChild(this._rowElements[m]);for(;this._rowElements.length>h;)this._rowContainer.removeChild(this._rowElements.pop());this._rowElements[this._rowElements.length-1].addEventListener("focus",this._bottomBoundaryFocusListener),this._refreshRowsDimensions()}_createAccessibilityTreeNode(){let h=document.createElement("div");return h.setAttribute("role","listitem"),h.tabIndex=-1,this._refreshRowDimensions(h),h}_refreshRowsDimensions(){if(this._renderService.dimensions.css.cell.height){this._accessibilityContainer.style.width=`${this._renderService.dimensions.css.canvas.width}px`,this._rowElements.length!==this._terminal.rows&&this._handleResize(this._terminal.rows);for(let h=0;h<this._terminal.rows;h++)this._refreshRowDimensions(this._rowElements[h])}}_refreshRowDimensions(h){h.style.height=`${this._renderService.dimensions.css.cell.height}px`}};i.AccessibilityManager=a=c([p(1,r.IRenderService)],a)},3614:(u,i)=>{function o(f){return f.replace(/\r?\n/g,"\r")}function c(f,g){return g?"\x1B[200~"+f+"\x1B[201~":f}function p(f,g,w,b){f=c(f=o(f),w.decPrivateModes.bracketedPasteMode&&b.rawOptions.ignoreBracketedPasteMode!==!0),w.triggerDataEvent(f,!0),g.value=""}function d(f,g,w){let b=w.getBoundingClientRect(),r=f.clientX-b.left-10,l=f.clientY-b.top-10;g.style.width="20px",g.style.height="20px",g.style.left=`${r}px`,g.style.top=`${l}px`,g.style.zIndex="1000",g.focus()}Object.defineProperty(i,"__esModule",{value:!0}),i.rightClickHandler=i.moveTextAreaUnderMouseCursor=i.paste=i.handlePasteEvent=i.copyHandler=i.bracketTextForPaste=i.prepareTextForTerminal=void 0,i.prepareTextForTerminal=o,i.bracketTextForPaste=c,i.copyHandler=function(f,g){f.clipboardData&&f.clipboardData.setData("text/plain",g.selectionText),f.preventDefault()},i.handlePasteEvent=function(f,g,w,b){f.stopPropagation(),f.clipboardData&&p(f.clipboardData.getData("text/plain"),g,w,b)},i.paste=p,i.moveTextAreaUnderMouseCursor=d,i.rightClickHandler=function(f,g,w,b,r){d(f,g,w),r&&b.rightClickSelect(f),g.value=b.selectionText,g.select()}},7239:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ColorContrastCache=void 0;let c=o(1505);i.ColorContrastCache=class{constructor(){this._color=new c.TwoKeyMap,this._css=new c.TwoKeyMap}setCss(p,d,f){this._css.set(p,d,f)}getCss(p,d){return this._css.get(p,d)}setColor(p,d,f){this._color.set(p,d,f)}getColor(p,d){return this._color.get(p,d)}clear(){this._color.clear(),this._css.clear()}}},3656:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.addDisposableDomListener=void 0,i.addDisposableDomListener=function(o,c,p,d){o.addEventListener(c,p,d);let f=!1;return{dispose:()=>{f||(f=!0,o.removeEventListener(c,p,d))}}}},6465:function(u,i,o){var c=this&&this.__decorate||function(r,l,a,h){var m,v=arguments.length,y=v<3?l:h===null?h=Object.getOwnPropertyDescriptor(l,a):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(r,l,a,h);else for(var x=r.length-1;x>=0;x--)(m=r[x])&&(y=(v<3?m(y):v>3?m(l,a,y):m(l,a))||y);return v>3&&y&&Object.defineProperty(l,a,y),y},p=this&&this.__param||function(r,l){return function(a,h){l(a,h,r)}};Object.defineProperty(i,"__esModule",{value:!0}),i.Linkifier2=void 0;let d=o(3656),f=o(8460),g=o(844),w=o(2585),b=i.Linkifier2=class extends g.Disposable{get currentLink(){return this._currentLink}constructor(r){super(),this._bufferService=r,this._linkProviders=[],this._linkCacheDisposables=[],this._isMouseOut=!0,this._wasResized=!1,this._activeLine=-1,this._onShowLinkUnderline=this.register(new f.EventEmitter),this.onShowLinkUnderline=this._onShowLinkUnderline.event,this._onHideLinkUnderline=this.register(new f.EventEmitter),this.onHideLinkUnderline=this._onHideLinkUnderline.event,this.register((0,g.getDisposeArrayDisposable)(this._linkCacheDisposables)),this.register((0,g.toDisposable)((()=>{this._lastMouseEvent=void 0}))),this.register(this._bufferService.onResize((()=>{this._clearCurrentLink(),this._wasResized=!0})))}registerLinkProvider(r){return this._linkProviders.push(r),{dispose:()=>{let l=this._linkProviders.indexOf(r);l!==-1&&this._linkProviders.splice(l,1)}}}attachToDom(r,l,a){this._element=r,this._mouseService=l,this._renderService=a,this.register((0,d.addDisposableDomListener)(this._element,"mouseleave",(()=>{this._isMouseOut=!0,this._clearCurrentLink()}))),this.register((0,d.addDisposableDomListener)(this._element,"mousemove",this._handleMouseMove.bind(this))),this.register((0,d.addDisposableDomListener)(this._element,"mousedown",this._handleMouseDown.bind(this))),this.register((0,d.addDisposableDomListener)(this._element,"mouseup",this._handleMouseUp.bind(this)))}_handleMouseMove(r){if(this._lastMouseEvent=r,!this._element||!this._mouseService)return;let l=this._positionFromMouseEvent(r,this._element,this._mouseService);if(!l)return;this._isMouseOut=!1;let a=r.composedPath();for(let h=0;h<a.length;h++){let m=a[h];if(m.classList.contains("xterm"))break;if(m.classList.contains("xterm-hover"))return}this._lastBufferCell&&l.x===this._lastBufferCell.x&&l.y===this._lastBufferCell.y||(this._handleHover(l),this._lastBufferCell=l)}_handleHover(r){if(this._activeLine!==r.y||this._wasResized)return this._clearCurrentLink(),this._askForLink(r,!1),void(this._wasResized=!1);this._currentLink&&this._linkAtPosition(this._currentLink.link,r)||(this._clearCurrentLink(),this._askForLink(r,!0))}_askForLink(r,l){var a,h;this._activeProviderReplies&&l||((a=this._activeProviderReplies)===null||a===void 0||a.forEach((v=>{v?.forEach((y=>{y.link.dispose&&y.link.dispose()}))})),this._activeProviderReplies=new Map,this._activeLine=r.y);let m=!1;for(let[v,y]of this._linkProviders.entries())l?!((h=this._activeProviderReplies)===null||h===void 0)&&h.get(v)&&(m=this._checkLinkProviderResult(v,r,m)):y.provideLinks(r.y,(x=>{var _,S;if(this._isMouseOut)return;let L=x?.map((O=>({link:O})));(_=this._activeProviderReplies)===null||_===void 0||_.set(v,L),m=this._checkLinkProviderResult(v,r,m),((S=this._activeProviderReplies)===null||S===void 0?void 0:S.size)===this._linkProviders.length&&this._removeIntersectingLinks(r.y,this._activeProviderReplies)}))}_removeIntersectingLinks(r,l){let a=new Set;for(let h=0;h<l.size;h++){let m=l.get(h);if(m)for(let v=0;v<m.length;v++){let y=m[v],x=y.link.range.start.y<r?0:y.link.range.start.x,_=y.link.range.end.y>r?this._bufferService.cols:y.link.range.end.x;for(let S=x;S<=_;S++){if(a.has(S)){m.splice(v--,1);break}a.add(S)}}}}_checkLinkProviderResult(r,l,a){var h;if(!this._activeProviderReplies)return a;let m=this._activeProviderReplies.get(r),v=!1;for(let y=0;y<r;y++)this._activeProviderReplies.has(y)&&!this._activeProviderReplies.get(y)||(v=!0);if(!v&&m){let y=m.find((x=>this._linkAtPosition(x.link,l)));y&&(a=!0,this._handleNewLink(y))}if(this._activeProviderReplies.size===this._linkProviders.length&&!a)for(let y=0;y<this._activeProviderReplies.size;y++){let x=(h=this._activeProviderReplies.get(y))===null||h===void 0?void 0:h.find((_=>this._linkAtPosition(_.link,l)));if(x){a=!0,this._handleNewLink(x);break}}return a}_handleMouseDown(){this._mouseDownLink=this._currentLink}_handleMouseUp(r){if(!this._element||!this._mouseService||!this._currentLink)return;let l=this._positionFromMouseEvent(r,this._element,this._mouseService);l&&this._mouseDownLink===this._currentLink&&this._linkAtPosition(this._currentLink.link,l)&&this._currentLink.link.activate(r,this._currentLink.link.text)}_clearCurrentLink(r,l){this._element&&this._currentLink&&this._lastMouseEvent&&(!r||!l||this._currentLink.link.range.start.y>=r&&this._currentLink.link.range.end.y<=l)&&(this._linkLeave(this._element,this._currentLink.link,this._lastMouseEvent),this._currentLink=void 0,(0,g.disposeArray)(this._linkCacheDisposables))}_handleNewLink(r){if(!this._element||!this._lastMouseEvent||!this._mouseService)return;let l=this._positionFromMouseEvent(this._lastMouseEvent,this._element,this._mouseService);l&&this._linkAtPosition(r.link,l)&&(this._currentLink=r,this._currentLink.state={decorations:{underline:r.link.decorations===void 0||r.link.decorations.underline,pointerCursor:r.link.decorations===void 0||r.link.decorations.pointerCursor},isHovered:!0},this._linkHover(this._element,r.link,this._lastMouseEvent),r.link.decorations={},Object.defineProperties(r.link.decorations,{pointerCursor:{get:()=>{var a,h;return(h=(a=this._currentLink)===null||a===void 0?void 0:a.state)===null||h===void 0?void 0:h.decorations.pointerCursor},set:a=>{var h,m;!((h=this._currentLink)===null||h===void 0)&&h.state&&this._currentLink.state.decorations.pointerCursor!==a&&(this._currentLink.state.decorations.pointerCursor=a,this._currentLink.state.isHovered&&((m=this._element)===null||m===void 0||m.classList.toggle("xterm-cursor-pointer",a)))}},underline:{get:()=>{var a,h;return(h=(a=this._currentLink)===null||a===void 0?void 0:a.state)===null||h===void 0?void 0:h.decorations.underline},set:a=>{var h,m,v;!((h=this._currentLink)===null||h===void 0)&&h.state&&((v=(m=this._currentLink)===null||m===void 0?void 0:m.state)===null||v===void 0?void 0:v.decorations.underline)!==a&&(this._currentLink.state.decorations.underline=a,this._currentLink.state.isHovered&&this._fireUnderlineEvent(r.link,a))}}}),this._renderService&&this._linkCacheDisposables.push(this._renderService.onRenderedViewportChange((a=>{if(!this._currentLink)return;let h=a.start===0?0:a.start+1+this._bufferService.buffer.ydisp,m=this._bufferService.buffer.ydisp+1+a.end;if(this._currentLink.link.range.start.y>=h&&this._currentLink.link.range.end.y<=m&&(this._clearCurrentLink(h,m),this._lastMouseEvent&&this._element)){let v=this._positionFromMouseEvent(this._lastMouseEvent,this._element,this._mouseService);v&&this._askForLink(v,!1)}}))))}_linkHover(r,l,a){var h;!((h=this._currentLink)===null||h===void 0)&&h.state&&(this._currentLink.state.isHovered=!0,this._currentLink.state.decorations.underline&&this._fireUnderlineEvent(l,!0),this._currentLink.state.decorations.pointerCursor&&r.classList.add("xterm-cursor-pointer")),l.hover&&l.hover(a,l.text)}_fireUnderlineEvent(r,l){let a=r.range,h=this._bufferService.buffer.ydisp,m=this._createLinkUnderlineEvent(a.start.x-1,a.start.y-h-1,a.end.x,a.end.y-h-1,void 0);(l?this._onShowLinkUnderline:this._onHideLinkUnderline).fire(m)}_linkLeave(r,l,a){var h;!((h=this._currentLink)===null||h===void 0)&&h.state&&(this._currentLink.state.isHovered=!1,this._currentLink.state.decorations.underline&&this._fireUnderlineEvent(l,!1),this._currentLink.state.decorations.pointerCursor&&r.classList.remove("xterm-cursor-pointer")),l.leave&&l.leave(a,l.text)}_linkAtPosition(r,l){let a=r.range.start.y*this._bufferService.cols+r.range.start.x,h=r.range.end.y*this._bufferService.cols+r.range.end.x,m=l.y*this._bufferService.cols+l.x;return a<=m&&m<=h}_positionFromMouseEvent(r,l,a){let h=a.getCoords(r,l,this._bufferService.cols,this._bufferService.rows);if(h)return{x:h[0],y:h[1]+this._bufferService.buffer.ydisp}}_createLinkUnderlineEvent(r,l,a,h,m){return{x1:r,y1:l,x2:a,y2:h,cols:this._bufferService.cols,fg:m}}};i.Linkifier2=b=c([p(0,w.IBufferService)],b)},9042:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.tooMuchOutput=i.promptLabel=void 0,i.promptLabel="Terminal input",i.tooMuchOutput="Too much output to announce, navigate to rows manually to read"},3730:function(u,i,o){var c=this&&this.__decorate||function(b,r,l,a){var h,m=arguments.length,v=m<3?r:a===null?a=Object.getOwnPropertyDescriptor(r,l):a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")v=Reflect.decorate(b,r,l,a);else for(var y=b.length-1;y>=0;y--)(h=b[y])&&(v=(m<3?h(v):m>3?h(r,l,v):h(r,l))||v);return m>3&&v&&Object.defineProperty(r,l,v),v},p=this&&this.__param||function(b,r){return function(l,a){r(l,a,b)}};Object.defineProperty(i,"__esModule",{value:!0}),i.OscLinkProvider=void 0;let d=o(511),f=o(2585),g=i.OscLinkProvider=class{constructor(b,r,l){this._bufferService=b,this._optionsService=r,this._oscLinkService=l}provideLinks(b,r){var l;let a=this._bufferService.buffer.lines.get(b-1);if(!a)return void r(void 0);let h=[],m=this._optionsService.rawOptions.linkHandler,v=new d.CellData,y=a.getTrimmedLength(),x=-1,_=-1,S=!1;for(let L=0;L<y;L++)if(_!==-1||a.hasContent(L)){if(a.loadCell(L,v),v.hasExtendedAttrs()&&v.extended.urlId){if(_===-1){_=L,x=v.extended.urlId;continue}S=v.extended.urlId!==x}else _!==-1&&(S=!0);if(S||_!==-1&&L===y-1){let O=(l=this._oscLinkService.getLinkData(x))===null||l===void 0?void 0:l.uri;if(O){let D={start:{x:_+1,y:b},end:{x:L+(S||L!==y-1?0:1),y:b}},M=!1;if(!m?.allowNonHttpProtocols)try{let z=new URL(O);["http:","https:"].includes(z.protocol)||(M=!0)}catch{M=!0}M||h.push({text:O,range:D,activate:(z,B)=>m?m.activate(z,B,D):w(0,B),hover:(z,B)=>{var $;return($=m?.hover)===null||$===void 0?void 0:$.call(m,z,B,D)},leave:(z,B)=>{var $;return($=m?.leave)===null||$===void 0?void 0:$.call(m,z,B,D)}})}S=!1,v.hasExtendedAttrs()&&v.extended.urlId?(_=L,x=v.extended.urlId):(_=-1,x=-1)}}r(h)}};function w(b,r){if(confirm(`Do you want to navigate to ${r}?

WARNING: This link could potentially be dangerous`)){let l=window.open();if(l){try{l.opener=null}catch{}l.location.href=r}else console.warn("Opening link blocked as opener could not be cleared")}}i.OscLinkProvider=g=c([p(0,f.IBufferService),p(1,f.IOptionsService),p(2,f.IOscLinkService)],g)},6193:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.RenderDebouncer=void 0,i.RenderDebouncer=class{constructor(o,c){this._parentWindow=o,this._renderCallback=c,this._refreshCallbacks=[]}dispose(){this._animationFrame&&(this._parentWindow.cancelAnimationFrame(this._animationFrame),this._animationFrame=void 0)}addRefreshCallback(o){return this._refreshCallbacks.push(o),this._animationFrame||(this._animationFrame=this._parentWindow.requestAnimationFrame((()=>this._innerRefresh()))),this._animationFrame}refresh(o,c,p){this._rowCount=p,o=o!==void 0?o:0,c=c!==void 0?c:this._rowCount-1,this._rowStart=this._rowStart!==void 0?Math.min(this._rowStart,o):o,this._rowEnd=this._rowEnd!==void 0?Math.max(this._rowEnd,c):c,this._animationFrame||(this._animationFrame=this._parentWindow.requestAnimationFrame((()=>this._innerRefresh())))}_innerRefresh(){if(this._animationFrame=void 0,this._rowStart===void 0||this._rowEnd===void 0||this._rowCount===void 0)return void this._runRefreshCallbacks();let o=Math.max(this._rowStart,0),c=Math.min(this._rowEnd,this._rowCount-1);this._rowStart=void 0,this._rowEnd=void 0,this._renderCallback(o,c),this._runRefreshCallbacks()}_runRefreshCallbacks(){for(let o of this._refreshCallbacks)o(0);this._refreshCallbacks=[]}}},5596:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ScreenDprMonitor=void 0;let c=o(844);class p extends c.Disposable{constructor(f){super(),this._parentWindow=f,this._currentDevicePixelRatio=this._parentWindow.devicePixelRatio,this.register((0,c.toDisposable)((()=>{this.clearListener()})))}setListener(f){this._listener&&this.clearListener(),this._listener=f,this._outerListener=()=>{this._listener&&(this._listener(this._parentWindow.devicePixelRatio,this._currentDevicePixelRatio),this._updateDpr())},this._updateDpr()}_updateDpr(){var f;this._outerListener&&((f=this._resolutionMediaMatchList)===null||f===void 0||f.removeListener(this._outerListener),this._currentDevicePixelRatio=this._parentWindow.devicePixelRatio,this._resolutionMediaMatchList=this._parentWindow.matchMedia(`screen and (resolution: ${this._parentWindow.devicePixelRatio}dppx)`),this._resolutionMediaMatchList.addListener(this._outerListener))}clearListener(){this._resolutionMediaMatchList&&this._listener&&this._outerListener&&(this._resolutionMediaMatchList.removeListener(this._outerListener),this._resolutionMediaMatchList=void 0,this._listener=void 0,this._outerListener=void 0)}}i.ScreenDprMonitor=p},3236:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Terminal=void 0;let c=o(3614),p=o(3656),d=o(6465),f=o(9042),g=o(3730),w=o(1680),b=o(3107),r=o(5744),l=o(2950),a=o(1296),h=o(428),m=o(4269),v=o(5114),y=o(8934),x=o(3230),_=o(9312),S=o(4725),L=o(6731),O=o(8055),D=o(8969),M=o(8460),z=o(844),B=o(6114),$=o(8437),I=o(2584),C=o(7399),E=o(5941),A=o(9074),R=o(2585),N=o(5435),j=o(4567),G=typeof window<"u"?window.document:null;class K extends D.CoreTerminal{get onFocus(){return this._onFocus.event}get onBlur(){return this._onBlur.event}get onA11yChar(){return this._onA11yCharEmitter.event}get onA11yTab(){return this._onA11yTabEmitter.event}get onWillOpen(){return this._onWillOpen.event}constructor(k={}){super(k),this.browser=B,this._keyDownHandled=!1,this._keyDownSeen=!1,this._keyPressHandled=!1,this._unprocessedDeadKey=!1,this._accessibilityManager=this.register(new z.MutableDisposable),this._onCursorMove=this.register(new M.EventEmitter),this.onCursorMove=this._onCursorMove.event,this._onKey=this.register(new M.EventEmitter),this.onKey=this._onKey.event,this._onRender=this.register(new M.EventEmitter),this.onRender=this._onRender.event,this._onSelectionChange=this.register(new M.EventEmitter),this.onSelectionChange=this._onSelectionChange.event,this._onTitleChange=this.register(new M.EventEmitter),this.onTitleChange=this._onTitleChange.event,this._onBell=this.register(new M.EventEmitter),this.onBell=this._onBell.event,this._onFocus=this.register(new M.EventEmitter),this._onBlur=this.register(new M.EventEmitter),this._onA11yCharEmitter=this.register(new M.EventEmitter),this._onA11yTabEmitter=this.register(new M.EventEmitter),this._onWillOpen=this.register(new M.EventEmitter),this._setup(),this.linkifier2=this.register(this._instantiationService.createInstance(d.Linkifier2)),this.linkifier2.registerLinkProvider(this._instantiationService.createInstance(g.OscLinkProvider)),this._decorationService=this._instantiationService.createInstance(A.DecorationService),this._instantiationService.setService(R.IDecorationService,this._decorationService),this.register(this._inputHandler.onRequestBell((()=>this._onBell.fire()))),this.register(this._inputHandler.onRequestRefreshRows(((F,U)=>this.refresh(F,U)))),this.register(this._inputHandler.onRequestSendFocus((()=>this._reportFocus()))),this.register(this._inputHandler.onRequestReset((()=>this.reset()))),this.register(this._inputHandler.onRequestWindowsOptionsReport((F=>this._reportWindowsOptions(F)))),this.register(this._inputHandler.onColor((F=>this._handleColorEvent(F)))),this.register((0,M.forwardEvent)(this._inputHandler.onCursorMove,this._onCursorMove)),this.register((0,M.forwardEvent)(this._inputHandler.onTitleChange,this._onTitleChange)),this.register((0,M.forwardEvent)(this._inputHandler.onA11yChar,this._onA11yCharEmitter)),this.register((0,M.forwardEvent)(this._inputHandler.onA11yTab,this._onA11yTabEmitter)),this.register(this._bufferService.onResize((F=>this._afterResize(F.cols,F.rows)))),this.register((0,z.toDisposable)((()=>{var F,U;this._customKeyEventHandler=void 0,(U=(F=this.element)===null||F===void 0?void 0:F.parentNode)===null||U===void 0||U.removeChild(this.element)})))}_handleColorEvent(k){if(this._themeService)for(let F of k){let U,W="";switch(F.index){case 256:U="foreground",W="10";break;case 257:U="background",W="11";break;case 258:U="cursor",W="12";break;default:U="ansi",W="4;"+F.index}switch(F.type){case 0:let ee=O.color.toColorRGB(U==="ansi"?this._themeService.colors.ansi[F.index]:this._themeService.colors[U]);this.coreService.triggerDataEvent(`${I.C0.ESC}]${W};${(0,E.toRgbString)(ee)}${I.C1_ESCAPED.ST}`);break;case 1:if(U==="ansi")this._themeService.modifyColors((V=>V.ansi[F.index]=O.rgba.toColor(...F.color)));else{let V=U;this._themeService.modifyColors((de=>de[V]=O.rgba.toColor(...F.color)))}break;case 2:this._themeService.restoreColor(F.index)}}}_setup(){super._setup(),this._customKeyEventHandler=void 0}get buffer(){return this.buffers.active}focus(){this.textarea&&this.textarea.focus({preventScroll:!0})}_handleScreenReaderModeOptionChange(k){k?!this._accessibilityManager.value&&this._renderService&&(this._accessibilityManager.value=this._instantiationService.createInstance(j.AccessibilityManager,this)):this._accessibilityManager.clear()}_handleTextAreaFocus(k){this.coreService.decPrivateModes.sendFocus&&this.coreService.triggerDataEvent(I.C0.ESC+"[I"),this.updateCursorStyle(k),this.element.classList.add("focus"),this._showCursor(),this._onFocus.fire()}blur(){var k;return(k=this.textarea)===null||k===void 0?void 0:k.blur()}_handleTextAreaBlur(){this.textarea.value="",this.refresh(this.buffer.y,this.buffer.y),this.coreService.decPrivateModes.sendFocus&&this.coreService.triggerDataEvent(I.C0.ESC+"[O"),this.element.classList.remove("focus"),this._onBlur.fire()}_syncTextArea(){if(!this.textarea||!this.buffer.isCursorInViewport||this._compositionHelper.isComposing||!this._renderService)return;let k=this.buffer.ybase+this.buffer.y,F=this.buffer.lines.get(k);if(!F)return;let U=Math.min(this.buffer.x,this.cols-1),W=this._renderService.dimensions.css.cell.height,ee=F.getWidth(U),V=this._renderService.dimensions.css.cell.width*ee,de=this.buffer.y*this._renderService.dimensions.css.cell.height,Ee=U*this._renderService.dimensions.css.cell.width;this.textarea.style.left=Ee+"px",this.textarea.style.top=de+"px",this.textarea.style.width=V+"px",this.textarea.style.height=W+"px",this.textarea.style.lineHeight=W+"px",this.textarea.style.zIndex="-5"}_initGlobal(){this._bindKeys(),this.register((0,p.addDisposableDomListener)(this.element,"copy",(F=>{this.hasSelection()&&(0,c.copyHandler)(F,this._selectionService)})));let k=F=>(0,c.handlePasteEvent)(F,this.textarea,this.coreService,this.optionsService);this.register((0,p.addDisposableDomListener)(this.textarea,"paste",k)),this.register((0,p.addDisposableDomListener)(this.element,"paste",k)),B.isFirefox?this.register((0,p.addDisposableDomListener)(this.element,"mousedown",(F=>{F.button===2&&(0,c.rightClickHandler)(F,this.textarea,this.screenElement,this._selectionService,this.options.rightClickSelectsWord)}))):this.register((0,p.addDisposableDomListener)(this.element,"contextmenu",(F=>{(0,c.rightClickHandler)(F,this.textarea,this.screenElement,this._selectionService,this.options.rightClickSelectsWord)}))),B.isLinux&&this.register((0,p.addDisposableDomListener)(this.element,"auxclick",(F=>{F.button===1&&(0,c.moveTextAreaUnderMouseCursor)(F,this.textarea,this.screenElement)})))}_bindKeys(){this.register((0,p.addDisposableDomListener)(this.textarea,"keyup",(k=>this._keyUp(k)),!0)),this.register((0,p.addDisposableDomListener)(this.textarea,"keydown",(k=>this._keyDown(k)),!0)),this.register((0,p.addDisposableDomListener)(this.textarea,"keypress",(k=>this._keyPress(k)),!0)),this.register((0,p.addDisposableDomListener)(this.textarea,"compositionstart",(()=>this._compositionHelper.compositionstart()))),this.register((0,p.addDisposableDomListener)(this.textarea,"compositionupdate",(k=>this._compositionHelper.compositionupdate(k)))),this.register((0,p.addDisposableDomListener)(this.textarea,"compositionend",(()=>this._compositionHelper.compositionend()))),this.register((0,p.addDisposableDomListener)(this.textarea,"input",(k=>this._inputEvent(k)),!0)),this.register(this.onRender((()=>this._compositionHelper.updateCompositionElements())))}open(k){var F;if(!k)throw new Error("Terminal requires a parent element.");k.isConnected||this._logService.debug("Terminal.open was called on an element that was not attached to the DOM"),this._document=k.ownerDocument,this.element=this._document.createElement("div"),this.element.dir="ltr",this.element.classList.add("terminal"),this.element.classList.add("xterm"),k.appendChild(this.element);let U=G.createDocumentFragment();this._viewportElement=G.createElement("div"),this._viewportElement.classList.add("xterm-viewport"),U.appendChild(this._viewportElement),this._viewportScrollArea=G.createElement("div"),this._viewportScrollArea.classList.add("xterm-scroll-area"),this._viewportElement.appendChild(this._viewportScrollArea),this.screenElement=G.createElement("div"),this.screenElement.classList.add("xterm-screen"),this._helperContainer=G.createElement("div"),this._helperContainer.classList.add("xterm-helpers"),this.screenElement.appendChild(this._helperContainer),U.appendChild(this.screenElement),this.textarea=G.createElement("textarea"),this.textarea.classList.add("xterm-helper-textarea"),this.textarea.setAttribute("aria-label",f.promptLabel),B.isChromeOS||this.textarea.setAttribute("aria-multiline","false"),this.textarea.setAttribute("autocorrect","off"),this.textarea.setAttribute("autocapitalize","off"),this.textarea.setAttribute("spellcheck","false"),this.textarea.tabIndex=0,this._coreBrowserService=this._instantiationService.createInstance(v.CoreBrowserService,this.textarea,(F=this._document.defaultView)!==null&&F!==void 0?F:window),this._instantiationService.setService(S.ICoreBrowserService,this._coreBrowserService),this.register((0,p.addDisposableDomListener)(this.textarea,"focus",(W=>this._handleTextAreaFocus(W)))),this.register((0,p.addDisposableDomListener)(this.textarea,"blur",(()=>this._handleTextAreaBlur()))),this._helperContainer.appendChild(this.textarea),this._charSizeService=this._instantiationService.createInstance(h.CharSizeService,this._document,this._helperContainer),this._instantiationService.setService(S.ICharSizeService,this._charSizeService),this._themeService=this._instantiationService.createInstance(L.ThemeService),this._instantiationService.setService(S.IThemeService,this._themeService),this._characterJoinerService=this._instantiationService.createInstance(m.CharacterJoinerService),this._instantiationService.setService(S.ICharacterJoinerService,this._characterJoinerService),this._renderService=this.register(this._instantiationService.createInstance(x.RenderService,this.rows,this.screenElement)),this._instantiationService.setService(S.IRenderService,this._renderService),this.register(this._renderService.onRenderedViewportChange((W=>this._onRender.fire(W)))),this.onResize((W=>this._renderService.resize(W.cols,W.rows))),this._compositionView=G.createElement("div"),this._compositionView.classList.add("composition-view"),this._compositionHelper=this._instantiationService.createInstance(l.CompositionHelper,this.textarea,this._compositionView),this._helperContainer.appendChild(this._compositionView),this.element.appendChild(U);try{this._onWillOpen.fire(this.element)}catch{}this._renderService.hasRenderer()||this._renderService.setRenderer(this._createRenderer()),this._mouseService=this._instantiationService.createInstance(y.MouseService),this._instantiationService.setService(S.IMouseService,this._mouseService),this.viewport=this._instantiationService.createInstance(w.Viewport,this._viewportElement,this._viewportScrollArea),this.viewport.onRequestScrollLines((W=>this.scrollLines(W.amount,W.suppressScrollEvent,1))),this.register(this._inputHandler.onRequestSyncScrollBar((()=>this.viewport.syncScrollArea()))),this.register(this.viewport),this.register(this.onCursorMove((()=>{this._renderService.handleCursorMove(),this._syncTextArea()}))),this.register(this.onResize((()=>this._renderService.handleResize(this.cols,this.rows)))),this.register(this.onBlur((()=>this._renderService.handleBlur()))),this.register(this.onFocus((()=>this._renderService.handleFocus()))),this.register(this._renderService.onDimensionsChange((()=>this.viewport.syncScrollArea()))),this._selectionService=this.register(this._instantiationService.createInstance(_.SelectionService,this.element,this.screenElement,this.linkifier2)),this._instantiationService.setService(S.ISelectionService,this._selectionService),this.register(this._selectionService.onRequestScrollLines((W=>this.scrollLines(W.amount,W.suppressScrollEvent)))),this.register(this._selectionService.onSelectionChange((()=>this._onSelectionChange.fire()))),this.register(this._selectionService.onRequestRedraw((W=>this._renderService.handleSelectionChanged(W.start,W.end,W.columnSelectMode)))),this.register(this._selectionService.onLinuxMouseSelection((W=>{this.textarea.value=W,this.textarea.focus(),this.textarea.select()}))),this.register(this._onScroll.event((W=>{this.viewport.syncScrollArea(),this._selectionService.refresh()}))),this.register((0,p.addDisposableDomListener)(this._viewportElement,"scroll",(()=>this._selectionService.refresh()))),this.linkifier2.attachToDom(this.screenElement,this._mouseService,this._renderService),this.register(this._instantiationService.createInstance(b.BufferDecorationRenderer,this.screenElement)),this.register((0,p.addDisposableDomListener)(this.element,"mousedown",(W=>this._selectionService.handleMouseDown(W)))),this.coreMouseService.areMouseEventsActive?(this._selectionService.disable(),this.element.classList.add("enable-mouse-events")):this._selectionService.enable(),this.options.screenReaderMode&&(this._accessibilityManager.value=this._instantiationService.createInstance(j.AccessibilityManager,this)),this.register(this.optionsService.onSpecificOptionChange("screenReaderMode",(W=>this._handleScreenReaderModeOptionChange(W)))),this.options.overviewRulerWidth&&(this._overviewRulerRenderer=this.register(this._instantiationService.createInstance(r.OverviewRulerRenderer,this._viewportElement,this.screenElement))),this.optionsService.onSpecificOptionChange("overviewRulerWidth",(W=>{!this._overviewRulerRenderer&&W&&this._viewportElement&&this.screenElement&&(this._overviewRulerRenderer=this.register(this._instantiationService.createInstance(r.OverviewRulerRenderer,this._viewportElement,this.screenElement)))})),this._charSizeService.measure(),this.refresh(0,this.rows-1),this._initGlobal(),this.bindMouse()}_createRenderer(){return this._instantiationService.createInstance(a.DomRenderer,this.element,this.screenElement,this._viewportElement,this.linkifier2)}bindMouse(){let k=this,F=this.element;function U(V){let de=k._mouseService.getMouseReportCoords(V,k.screenElement);if(!de)return!1;let Ee,$e;switch(V.overrideType||V.type){case"mousemove":$e=32,V.buttons===void 0?(Ee=3,V.button!==void 0&&(Ee=V.button<3?V.button:3)):Ee=1&V.buttons?0:4&V.buttons?1:2&V.buttons?2:3;break;case"mouseup":$e=0,Ee=V.button<3?V.button:3;break;case"mousedown":$e=1,Ee=V.button<3?V.button:3;break;case"wheel":if(k.viewport.getLinesScrolled(V)===0)return!1;$e=V.deltaY<0?0:1,Ee=4;break;default:return!1}return!($e===void 0||Ee===void 0||Ee>4)&&k.coreMouseService.triggerMouseEvent({col:de.col,row:de.row,x:de.x,y:de.y,button:Ee,action:$e,ctrl:V.ctrlKey,alt:V.altKey,shift:V.shiftKey})}let W={mouseup:null,wheel:null,mousedrag:null,mousemove:null},ee={mouseup:V=>(U(V),V.buttons||(this._document.removeEventListener("mouseup",W.mouseup),W.mousedrag&&this._document.removeEventListener("mousemove",W.mousedrag)),this.cancel(V)),wheel:V=>(U(V),this.cancel(V,!0)),mousedrag:V=>{V.buttons&&U(V)},mousemove:V=>{V.buttons||U(V)}};this.register(this.coreMouseService.onProtocolChange((V=>{V?(this.optionsService.rawOptions.logLevel==="debug"&&this._logService.debug("Binding to mouse events:",this.coreMouseService.explainEvents(V)),this.element.classList.add("enable-mouse-events"),this._selectionService.disable()):(this._logService.debug("Unbinding from mouse events."),this.element.classList.remove("enable-mouse-events"),this._selectionService.enable()),8&V?W.mousemove||(F.addEventListener("mousemove",ee.mousemove),W.mousemove=ee.mousemove):(F.removeEventListener("mousemove",W.mousemove),W.mousemove=null),16&V?W.wheel||(F.addEventListener("wheel",ee.wheel,{passive:!1}),W.wheel=ee.wheel):(F.removeEventListener("wheel",W.wheel),W.wheel=null),2&V?W.mouseup||(F.addEventListener("mouseup",ee.mouseup),W.mouseup=ee.mouseup):(this._document.removeEventListener("mouseup",W.mouseup),F.removeEventListener("mouseup",W.mouseup),W.mouseup=null),4&V?W.mousedrag||(W.mousedrag=ee.mousedrag):(this._document.removeEventListener("mousemove",W.mousedrag),W.mousedrag=null)}))),this.coreMouseService.activeProtocol=this.coreMouseService.activeProtocol,this.register((0,p.addDisposableDomListener)(F,"mousedown",(V=>{if(V.preventDefault(),this.focus(),this.coreMouseService.areMouseEventsActive&&!this._selectionService.shouldForceSelection(V))return U(V),W.mouseup&&this._document.addEventListener("mouseup",W.mouseup),W.mousedrag&&this._document.addEventListener("mousemove",W.mousedrag),this.cancel(V)}))),this.register((0,p.addDisposableDomListener)(F,"wheel",(V=>{if(!W.wheel){if(!this.buffer.hasScrollback){let de=this.viewport.getLinesScrolled(V);if(de===0)return;let Ee=I.C0.ESC+(this.coreService.decPrivateModes.applicationCursorKeys?"O":"[")+(V.deltaY<0?"A":"B"),$e="";for(let Yt=0;Yt<Math.abs(de);Yt++)$e+=Ee;return this.coreService.triggerDataEvent($e,!0),this.cancel(V,!0)}return this.viewport.handleWheel(V)?this.cancel(V):void 0}}),{passive:!1})),this.register((0,p.addDisposableDomListener)(F,"touchstart",(V=>{if(!this.coreMouseService.areMouseEventsActive)return this.viewport.handleTouchStart(V),this.cancel(V)}),{passive:!0})),this.register((0,p.addDisposableDomListener)(F,"touchmove",(V=>{if(!this.coreMouseService.areMouseEventsActive)return this.viewport.handleTouchMove(V)?void 0:this.cancel(V)}),{passive:!1}))}refresh(k,F){var U;(U=this._renderService)===null||U===void 0||U.refreshRows(k,F)}updateCursorStyle(k){var F;!((F=this._selectionService)===null||F===void 0)&&F.shouldColumnSelect(k)?this.element.classList.add("column-select"):this.element.classList.remove("column-select")}_showCursor(){this.coreService.isCursorInitialized||(this.coreService.isCursorInitialized=!0,this.refresh(this.buffer.y,this.buffer.y))}scrollLines(k,F,U=0){var W;U===1?(super.scrollLines(k,F,U),this.refresh(0,this.rows-1)):(W=this.viewport)===null||W===void 0||W.scrollLines(k)}paste(k){(0,c.paste)(k,this.textarea,this.coreService,this.optionsService)}attachCustomKeyEventHandler(k){this._customKeyEventHandler=k}registerLinkProvider(k){return this.linkifier2.registerLinkProvider(k)}registerCharacterJoiner(k){if(!this._characterJoinerService)throw new Error("Terminal must be opened first");let F=this._characterJoinerService.register(k);return this.refresh(0,this.rows-1),F}deregisterCharacterJoiner(k){if(!this._characterJoinerService)throw new Error("Terminal must be opened first");this._characterJoinerService.deregister(k)&&this.refresh(0,this.rows-1)}get markers(){return this.buffer.markers}registerMarker(k){return this.buffer.addMarker(this.buffer.ybase+this.buffer.y+k)}registerDecoration(k){return this._decorationService.registerDecoration(k)}hasSelection(){return!!this._selectionService&&this._selectionService.hasSelection}select(k,F,U){this._selectionService.setSelection(k,F,U)}getSelection(){return this._selectionService?this._selectionService.selectionText:""}getSelectionPosition(){if(this._selectionService&&this._selectionService.hasSelection)return{start:{x:this._selectionService.selectionStart[0],y:this._selectionService.selectionStart[1]},end:{x:this._selectionService.selectionEnd[0],y:this._selectionService.selectionEnd[1]}}}clearSelection(){var k;(k=this._selectionService)===null||k===void 0||k.clearSelection()}selectAll(){var k;(k=this._selectionService)===null||k===void 0||k.selectAll()}selectLines(k,F){var U;(U=this._selectionService)===null||U===void 0||U.selectLines(k,F)}_keyDown(k){if(this._keyDownHandled=!1,this._keyDownSeen=!0,this._customKeyEventHandler&&this._customKeyEventHandler(k)===!1)return!1;let F=this.browser.isMac&&this.options.macOptionIsMeta&&k.altKey;if(!F&&!this._compositionHelper.keydown(k))return this.options.scrollOnUserInput&&this.buffer.ybase!==this.buffer.ydisp&&this.scrollToBottom(),!1;F||k.key!=="Dead"&&k.key!=="AltGraph"||(this._unprocessedDeadKey=!0);let U=(0,C.evaluateKeyboardEvent)(k,this.coreService.decPrivateModes.applicationCursorKeys,this.browser.isMac,this.options.macOptionIsMeta);if(this.updateCursorStyle(k),U.type===3||U.type===2){let W=this.rows-1;return this.scrollLines(U.type===2?-W:W),this.cancel(k,!0)}return U.type===1&&this.selectAll(),!!this._isThirdLevelShift(this.browser,k)||(U.cancel&&this.cancel(k,!0),!U.key||!!(k.key&&!k.ctrlKey&&!k.altKey&&!k.metaKey&&k.key.length===1&&k.key.charCodeAt(0)>=65&&k.key.charCodeAt(0)<=90)||(this._unprocessedDeadKey?(this._unprocessedDeadKey=!1,!0):(U.key!==I.C0.ETX&&U.key!==I.C0.CR||(this.textarea.value=""),this._onKey.fire({key:U.key,domEvent:k}),this._showCursor(),this.coreService.triggerDataEvent(U.key,!0),!this.optionsService.rawOptions.screenReaderMode||k.altKey||k.ctrlKey?this.cancel(k,!0):void(this._keyDownHandled=!0))))}_isThirdLevelShift(k,F){let U=k.isMac&&!this.options.macOptionIsMeta&&F.altKey&&!F.ctrlKey&&!F.metaKey||k.isWindows&&F.altKey&&F.ctrlKey&&!F.metaKey||k.isWindows&&F.getModifierState("AltGraph");return F.type==="keypress"?U:U&&(!F.keyCode||F.keyCode>47)}_keyUp(k){this._keyDownSeen=!1,this._customKeyEventHandler&&this._customKeyEventHandler(k)===!1||((function(F){return F.keyCode===16||F.keyCode===17||F.keyCode===18})(k)||this.focus(),this.updateCursorStyle(k),this._keyPressHandled=!1)}_keyPress(k){let F;if(this._keyPressHandled=!1,this._keyDownHandled||this._customKeyEventHandler&&this._customKeyEventHandler(k)===!1)return!1;if(this.cancel(k),k.charCode)F=k.charCode;else if(k.which===null||k.which===void 0)F=k.keyCode;else{if(k.which===0||k.charCode===0)return!1;F=k.which}return!(!F||(k.altKey||k.ctrlKey||k.metaKey)&&!this._isThirdLevelShift(this.browser,k)||(F=String.fromCharCode(F),this._onKey.fire({key:F,domEvent:k}),this._showCursor(),this.coreService.triggerDataEvent(F,!0),this._keyPressHandled=!0,this._unprocessedDeadKey=!1,0))}_inputEvent(k){if(k.data&&k.inputType==="insertText"&&(!k.composed||!this._keyDownSeen)&&!this.optionsService.rawOptions.screenReaderMode){if(this._keyPressHandled)return!1;this._unprocessedDeadKey=!1;let F=k.data;return this.coreService.triggerDataEvent(F,!0),this.cancel(k),!0}return!1}resize(k,F){k!==this.cols||F!==this.rows?super.resize(k,F):this._charSizeService&&!this._charSizeService.hasValidSize&&this._charSizeService.measure()}_afterResize(k,F){var U,W;(U=this._charSizeService)===null||U===void 0||U.measure(),(W=this.viewport)===null||W===void 0||W.syncScrollArea(!0)}clear(){var k;if(this.buffer.ybase!==0||this.buffer.y!==0){this.buffer.clearAllMarkers(),this.buffer.lines.set(0,this.buffer.lines.get(this.buffer.ybase+this.buffer.y)),this.buffer.lines.length=1,this.buffer.ydisp=0,this.buffer.ybase=0,this.buffer.y=0;for(let F=1;F<this.rows;F++)this.buffer.lines.push(this.buffer.getBlankLine($.DEFAULT_ATTR_DATA));this._onScroll.fire({position:this.buffer.ydisp,source:0}),(k=this.viewport)===null||k===void 0||k.reset(),this.refresh(0,this.rows-1)}}reset(){var k,F;this.options.rows=this.rows,this.options.cols=this.cols;let U=this._customKeyEventHandler;this._setup(),super.reset(),(k=this._selectionService)===null||k===void 0||k.reset(),this._decorationService.reset(),(F=this.viewport)===null||F===void 0||F.reset(),this._customKeyEventHandler=U,this.refresh(0,this.rows-1)}clearTextureAtlas(){var k;(k=this._renderService)===null||k===void 0||k.clearTextureAtlas()}_reportFocus(){var k;!((k=this.element)===null||k===void 0)&&k.classList.contains("focus")?this.coreService.triggerDataEvent(I.C0.ESC+"[I"):this.coreService.triggerDataEvent(I.C0.ESC+"[O")}_reportWindowsOptions(k){if(this._renderService)switch(k){case N.WindowsOptionsReportType.GET_WIN_SIZE_PIXELS:let F=this._renderService.dimensions.css.canvas.width.toFixed(0),U=this._renderService.dimensions.css.canvas.height.toFixed(0);this.coreService.triggerDataEvent(`${I.C0.ESC}[4;${U};${F}t`);break;case N.WindowsOptionsReportType.GET_CELL_SIZE_PIXELS:let W=this._renderService.dimensions.css.cell.width.toFixed(0),ee=this._renderService.dimensions.css.cell.height.toFixed(0);this.coreService.triggerDataEvent(`${I.C0.ESC}[6;${ee};${W}t`)}}cancel(k,F){if(this.options.cancelEvents||F)return k.preventDefault(),k.stopPropagation(),!1}}i.Terminal=K},9924:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.TimeBasedDebouncer=void 0,i.TimeBasedDebouncer=class{constructor(o,c=1e3){this._renderCallback=o,this._debounceThresholdMS=c,this._lastRefreshMs=0,this._additionalRefreshRequested=!1}dispose(){this._refreshTimeoutID&&clearTimeout(this._refreshTimeoutID)}refresh(o,c,p){this._rowCount=p,o=o!==void 0?o:0,c=c!==void 0?c:this._rowCount-1,this._rowStart=this._rowStart!==void 0?Math.min(this._rowStart,o):o,this._rowEnd=this._rowEnd!==void 0?Math.max(this._rowEnd,c):c;let d=Date.now();if(d-this._lastRefreshMs>=this._debounceThresholdMS)this._lastRefreshMs=d,this._innerRefresh();else if(!this._additionalRefreshRequested){let f=d-this._lastRefreshMs,g=this._debounceThresholdMS-f;this._additionalRefreshRequested=!0,this._refreshTimeoutID=window.setTimeout((()=>{this._lastRefreshMs=Date.now(),this._innerRefresh(),this._additionalRefreshRequested=!1,this._refreshTimeoutID=void 0}),g)}}_innerRefresh(){if(this._rowStart===void 0||this._rowEnd===void 0||this._rowCount===void 0)return;let o=Math.max(this._rowStart,0),c=Math.min(this._rowEnd,this._rowCount-1);this._rowStart=void 0,this._rowEnd=void 0,this._renderCallback(o,c)}}},1680:function(u,i,o){var c=this&&this.__decorate||function(l,a,h,m){var v,y=arguments.length,x=y<3?a:m===null?m=Object.getOwnPropertyDescriptor(a,h):m;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")x=Reflect.decorate(l,a,h,m);else for(var _=l.length-1;_>=0;_--)(v=l[_])&&(x=(y<3?v(x):y>3?v(a,h,x):v(a,h))||x);return y>3&&x&&Object.defineProperty(a,h,x),x},p=this&&this.__param||function(l,a){return function(h,m){a(h,m,l)}};Object.defineProperty(i,"__esModule",{value:!0}),i.Viewport=void 0;let d=o(3656),f=o(4725),g=o(8460),w=o(844),b=o(2585),r=i.Viewport=class extends w.Disposable{constructor(l,a,h,m,v,y,x,_){super(),this._viewportElement=l,this._scrollArea=a,this._bufferService=h,this._optionsService=m,this._charSizeService=v,this._renderService=y,this._coreBrowserService=x,this.scrollBarWidth=0,this._currentRowHeight=0,this._currentDeviceCellHeight=0,this._lastRecordedBufferLength=0,this._lastRecordedViewportHeight=0,this._lastRecordedBufferHeight=0,this._lastTouchY=0,this._lastScrollTop=0,this._wheelPartialScroll=0,this._refreshAnimationFrame=null,this._ignoreNextScrollEvent=!1,this._smoothScrollState={startTime:0,origin:-1,target:-1},this._onRequestScrollLines=this.register(new g.EventEmitter),this.onRequestScrollLines=this._onRequestScrollLines.event,this.scrollBarWidth=this._viewportElement.offsetWidth-this._scrollArea.offsetWidth||15,this.register((0,d.addDisposableDomListener)(this._viewportElement,"scroll",this._handleScroll.bind(this))),this._activeBuffer=this._bufferService.buffer,this.register(this._bufferService.buffers.onBufferActivate((S=>this._activeBuffer=S.activeBuffer))),this._renderDimensions=this._renderService.dimensions,this.register(this._renderService.onDimensionsChange((S=>this._renderDimensions=S))),this._handleThemeChange(_.colors),this.register(_.onChangeColors((S=>this._handleThemeChange(S)))),this.register(this._optionsService.onSpecificOptionChange("scrollback",(()=>this.syncScrollArea()))),setTimeout((()=>this.syncScrollArea()))}_handleThemeChange(l){this._viewportElement.style.backgroundColor=l.background.css}reset(){this._currentRowHeight=0,this._currentDeviceCellHeight=0,this._lastRecordedBufferLength=0,this._lastRecordedViewportHeight=0,this._lastRecordedBufferHeight=0,this._lastTouchY=0,this._lastScrollTop=0,this._coreBrowserService.window.requestAnimationFrame((()=>this.syncScrollArea()))}_refresh(l){if(l)return this._innerRefresh(),void(this._refreshAnimationFrame!==null&&this._coreBrowserService.window.cancelAnimationFrame(this._refreshAnimationFrame));this._refreshAnimationFrame===null&&(this._refreshAnimationFrame=this._coreBrowserService.window.requestAnimationFrame((()=>this._innerRefresh())))}_innerRefresh(){if(this._charSizeService.height>0){this._currentRowHeight=this._renderService.dimensions.device.cell.height/this._coreBrowserService.dpr,this._currentDeviceCellHeight=this._renderService.dimensions.device.cell.height,this._lastRecordedViewportHeight=this._viewportElement.offsetHeight;let a=Math.round(this._currentRowHeight*this._lastRecordedBufferLength)+(this._lastRecordedViewportHeight-this._renderService.dimensions.css.canvas.height);this._lastRecordedBufferHeight!==a&&(this._lastRecordedBufferHeight=a,this._scrollArea.style.height=this._lastRecordedBufferHeight+"px")}let l=this._bufferService.buffer.ydisp*this._currentRowHeight;this._viewportElement.scrollTop!==l&&(this._ignoreNextScrollEvent=!0,this._viewportElement.scrollTop=l),this._refreshAnimationFrame=null}syncScrollArea(l=!1){if(this._lastRecordedBufferLength!==this._bufferService.buffer.lines.length)return this._lastRecordedBufferLength=this._bufferService.buffer.lines.length,void this._refresh(l);this._lastRecordedViewportHeight===this._renderService.dimensions.css.canvas.height&&this._lastScrollTop===this._activeBuffer.ydisp*this._currentRowHeight&&this._renderDimensions.device.cell.height===this._currentDeviceCellHeight||this._refresh(l)}_handleScroll(l){if(this._lastScrollTop=this._viewportElement.scrollTop,!this._viewportElement.offsetParent)return;if(this._ignoreNextScrollEvent)return this._ignoreNextScrollEvent=!1,void this._onRequestScrollLines.fire({amount:0,suppressScrollEvent:!0});let a=Math.round(this._lastScrollTop/this._currentRowHeight)-this._bufferService.buffer.ydisp;this._onRequestScrollLines.fire({amount:a,suppressScrollEvent:!0})}_smoothScroll(){if(this._isDisposed||this._smoothScrollState.origin===-1||this._smoothScrollState.target===-1)return;let l=this._smoothScrollPercent();this._viewportElement.scrollTop=this._smoothScrollState.origin+Math.round(l*(this._smoothScrollState.target-this._smoothScrollState.origin)),l<1?this._coreBrowserService.window.requestAnimationFrame((()=>this._smoothScroll())):this._clearSmoothScrollState()}_smoothScrollPercent(){return this._optionsService.rawOptions.smoothScrollDuration&&this._smoothScrollState.startTime?Math.max(Math.min((Date.now()-this._smoothScrollState.startTime)/this._optionsService.rawOptions.smoothScrollDuration,1),0):1}_clearSmoothScrollState(){this._smoothScrollState.startTime=0,this._smoothScrollState.origin=-1,this._smoothScrollState.target=-1}_bubbleScroll(l,a){let h=this._viewportElement.scrollTop+this._lastRecordedViewportHeight;return!(a<0&&this._viewportElement.scrollTop!==0||a>0&&h<this._lastRecordedBufferHeight)||(l.cancelable&&l.preventDefault(),!1)}handleWheel(l){let a=this._getPixelsScrolled(l);return a!==0&&(this._optionsService.rawOptions.smoothScrollDuration?(this._smoothScrollState.startTime=Date.now(),this._smoothScrollPercent()<1?(this._smoothScrollState.origin=this._viewportElement.scrollTop,this._smoothScrollState.target===-1?this._smoothScrollState.target=this._viewportElement.scrollTop+a:this._smoothScrollState.target+=a,this._smoothScrollState.target=Math.max(Math.min(this._smoothScrollState.target,this._viewportElement.scrollHeight),0),this._smoothScroll()):this._clearSmoothScrollState()):this._viewportElement.scrollTop+=a,this._bubbleScroll(l,a))}scrollLines(l){if(l!==0)if(this._optionsService.rawOptions.smoothScrollDuration){let a=l*this._currentRowHeight;this._smoothScrollState.startTime=Date.now(),this._smoothScrollPercent()<1?(this._smoothScrollState.origin=this._viewportElement.scrollTop,this._smoothScrollState.target=this._smoothScrollState.origin+a,this._smoothScrollState.target=Math.max(Math.min(this._smoothScrollState.target,this._viewportElement.scrollHeight),0),this._smoothScroll()):this._clearSmoothScrollState()}else this._onRequestScrollLines.fire({amount:l,suppressScrollEvent:!1})}_getPixelsScrolled(l){if(l.deltaY===0||l.shiftKey)return 0;let a=this._applyScrollModifier(l.deltaY,l);return l.deltaMode===WheelEvent.DOM_DELTA_LINE?a*=this._currentRowHeight:l.deltaMode===WheelEvent.DOM_DELTA_PAGE&&(a*=this._currentRowHeight*this._bufferService.rows),a}getBufferElements(l,a){var h;let m,v="",y=[],x=a??this._bufferService.buffer.lines.length,_=this._bufferService.buffer.lines;for(let S=l;S<x;S++){let L=_.get(S);if(!L)continue;let O=(h=_.get(S+1))===null||h===void 0?void 0:h.isWrapped;if(v+=L.translateToString(!O),!O||S===_.length-1){let D=document.createElement("div");D.textContent=v,y.push(D),v.length>0&&(m=D),v=""}}return{bufferElements:y,cursorElement:m}}getLinesScrolled(l){if(l.deltaY===0||l.shiftKey)return 0;let a=this._applyScrollModifier(l.deltaY,l);return l.deltaMode===WheelEvent.DOM_DELTA_PIXEL?(a/=this._currentRowHeight+0,this._wheelPartialScroll+=a,a=Math.floor(Math.abs(this._wheelPartialScroll))*(this._wheelPartialScroll>0?1:-1),this._wheelPartialScroll%=1):l.deltaMode===WheelEvent.DOM_DELTA_PAGE&&(a*=this._bufferService.rows),a}_applyScrollModifier(l,a){let h=this._optionsService.rawOptions.fastScrollModifier;return h==="alt"&&a.altKey||h==="ctrl"&&a.ctrlKey||h==="shift"&&a.shiftKey?l*this._optionsService.rawOptions.fastScrollSensitivity*this._optionsService.rawOptions.scrollSensitivity:l*this._optionsService.rawOptions.scrollSensitivity}handleTouchStart(l){this._lastTouchY=l.touches[0].pageY}handleTouchMove(l){let a=this._lastTouchY-l.touches[0].pageY;return this._lastTouchY=l.touches[0].pageY,a!==0&&(this._viewportElement.scrollTop+=a,this._bubbleScroll(l,a))}};i.Viewport=r=c([p(2,b.IBufferService),p(3,b.IOptionsService),p(4,f.ICharSizeService),p(5,f.IRenderService),p(6,f.ICoreBrowserService),p(7,f.IThemeService)],r)},3107:function(u,i,o){var c=this&&this.__decorate||function(r,l,a,h){var m,v=arguments.length,y=v<3?l:h===null?h=Object.getOwnPropertyDescriptor(l,a):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(r,l,a,h);else for(var x=r.length-1;x>=0;x--)(m=r[x])&&(y=(v<3?m(y):v>3?m(l,a,y):m(l,a))||y);return v>3&&y&&Object.defineProperty(l,a,y),y},p=this&&this.__param||function(r,l){return function(a,h){l(a,h,r)}};Object.defineProperty(i,"__esModule",{value:!0}),i.BufferDecorationRenderer=void 0;let d=o(3656),f=o(4725),g=o(844),w=o(2585),b=i.BufferDecorationRenderer=class extends g.Disposable{constructor(r,l,a,h){super(),this._screenElement=r,this._bufferService=l,this._decorationService=a,this._renderService=h,this._decorationElements=new Map,this._altBufferIsActive=!1,this._dimensionsChanged=!1,this._container=document.createElement("div"),this._container.classList.add("xterm-decoration-container"),this._screenElement.appendChild(this._container),this.register(this._renderService.onRenderedViewportChange((()=>this._doRefreshDecorations()))),this.register(this._renderService.onDimensionsChange((()=>{this._dimensionsChanged=!0,this._queueRefresh()}))),this.register((0,d.addDisposableDomListener)(window,"resize",(()=>this._queueRefresh()))),this.register(this._bufferService.buffers.onBufferActivate((()=>{this._altBufferIsActive=this._bufferService.buffer===this._bufferService.buffers.alt}))),this.register(this._decorationService.onDecorationRegistered((()=>this._queueRefresh()))),this.register(this._decorationService.onDecorationRemoved((m=>this._removeDecoration(m)))),this.register((0,g.toDisposable)((()=>{this._container.remove(),this._decorationElements.clear()})))}_queueRefresh(){this._animationFrame===void 0&&(this._animationFrame=this._renderService.addRefreshCallback((()=>{this._doRefreshDecorations(),this._animationFrame=void 0})))}_doRefreshDecorations(){for(let r of this._decorationService.decorations)this._renderDecoration(r);this._dimensionsChanged=!1}_renderDecoration(r){this._refreshStyle(r),this._dimensionsChanged&&this._refreshXPosition(r)}_createElement(r){var l,a;let h=document.createElement("div");h.classList.add("xterm-decoration"),h.classList.toggle("xterm-decoration-top-layer",((l=r?.options)===null||l===void 0?void 0:l.layer)==="top"),h.style.width=`${Math.round((r.options.width||1)*this._renderService.dimensions.css.cell.width)}px`,h.style.height=(r.options.height||1)*this._renderService.dimensions.css.cell.height+"px",h.style.top=(r.marker.line-this._bufferService.buffers.active.ydisp)*this._renderService.dimensions.css.cell.height+"px",h.style.lineHeight=`${this._renderService.dimensions.css.cell.height}px`;let m=(a=r.options.x)!==null&&a!==void 0?a:0;return m&&m>this._bufferService.cols&&(h.style.display="none"),this._refreshXPosition(r,h),h}_refreshStyle(r){let l=r.marker.line-this._bufferService.buffers.active.ydisp;if(l<0||l>=this._bufferService.rows)r.element&&(r.element.style.display="none",r.onRenderEmitter.fire(r.element));else{let a=this._decorationElements.get(r);a||(a=this._createElement(r),r.element=a,this._decorationElements.set(r,a),this._container.appendChild(a),r.onDispose((()=>{this._decorationElements.delete(r),a.remove()}))),a.style.top=l*this._renderService.dimensions.css.cell.height+"px",a.style.display=this._altBufferIsActive?"none":"block",r.onRenderEmitter.fire(a)}}_refreshXPosition(r,l=r.element){var a;if(!l)return;let h=(a=r.options.x)!==null&&a!==void 0?a:0;(r.options.anchor||"left")==="right"?l.style.right=h?h*this._renderService.dimensions.css.cell.width+"px":"":l.style.left=h?h*this._renderService.dimensions.css.cell.width+"px":""}_removeDecoration(r){var l;(l=this._decorationElements.get(r))===null||l===void 0||l.remove(),this._decorationElements.delete(r),r.dispose()}};i.BufferDecorationRenderer=b=c([p(1,w.IBufferService),p(2,w.IDecorationService),p(3,f.IRenderService)],b)},5871:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ColorZoneStore=void 0,i.ColorZoneStore=class{constructor(){this._zones=[],this._zonePool=[],this._zonePoolIndex=0,this._linePadding={full:0,left:0,center:0,right:0}}get zones(){return this._zonePool.length=Math.min(this._zonePool.length,this._zones.length),this._zones}clear(){this._zones.length=0,this._zonePoolIndex=0}addDecoration(o){if(o.options.overviewRulerOptions){for(let c of this._zones)if(c.color===o.options.overviewRulerOptions.color&&c.position===o.options.overviewRulerOptions.position){if(this._lineIntersectsZone(c,o.marker.line))return;if(this._lineAdjacentToZone(c,o.marker.line,o.options.overviewRulerOptions.position))return void this._addLineToZone(c,o.marker.line)}if(this._zonePoolIndex<this._zonePool.length)return this._zonePool[this._zonePoolIndex].color=o.options.overviewRulerOptions.color,this._zonePool[this._zonePoolIndex].position=o.options.overviewRulerOptions.position,this._zonePool[this._zonePoolIndex].startBufferLine=o.marker.line,this._zonePool[this._zonePoolIndex].endBufferLine=o.marker.line,void this._zones.push(this._zonePool[this._zonePoolIndex++]);this._zones.push({color:o.options.overviewRulerOptions.color,position:o.options.overviewRulerOptions.position,startBufferLine:o.marker.line,endBufferLine:o.marker.line}),this._zonePool.push(this._zones[this._zones.length-1]),this._zonePoolIndex++}}setPadding(o){this._linePadding=o}_lineIntersectsZone(o,c){return c>=o.startBufferLine&&c<=o.endBufferLine}_lineAdjacentToZone(o,c,p){return c>=o.startBufferLine-this._linePadding[p||"full"]&&c<=o.endBufferLine+this._linePadding[p||"full"]}_addLineToZone(o,c){o.startBufferLine=Math.min(o.startBufferLine,c),o.endBufferLine=Math.max(o.endBufferLine,c)}}},5744:function(u,i,o){var c=this&&this.__decorate||function(m,v,y,x){var _,S=arguments.length,L=S<3?v:x===null?x=Object.getOwnPropertyDescriptor(v,y):x;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")L=Reflect.decorate(m,v,y,x);else for(var O=m.length-1;O>=0;O--)(_=m[O])&&(L=(S<3?_(L):S>3?_(v,y,L):_(v,y))||L);return S>3&&L&&Object.defineProperty(v,y,L),L},p=this&&this.__param||function(m,v){return function(y,x){v(y,x,m)}};Object.defineProperty(i,"__esModule",{value:!0}),i.OverviewRulerRenderer=void 0;let d=o(5871),f=o(3656),g=o(4725),w=o(844),b=o(2585),r={full:0,left:0,center:0,right:0},l={full:0,left:0,center:0,right:0},a={full:0,left:0,center:0,right:0},h=i.OverviewRulerRenderer=class extends w.Disposable{get _width(){return this._optionsService.options.overviewRulerWidth||0}constructor(m,v,y,x,_,S,L){var O;super(),this._viewportElement=m,this._screenElement=v,this._bufferService=y,this._decorationService=x,this._renderService=_,this._optionsService=S,this._coreBrowseService=L,this._colorZoneStore=new d.ColorZoneStore,this._shouldUpdateDimensions=!0,this._shouldUpdateAnchor=!0,this._lastKnownBufferLength=0,this._canvas=document.createElement("canvas"),this._canvas.classList.add("xterm-decoration-overview-ruler"),this._refreshCanvasDimensions(),(O=this._viewportElement.parentElement)===null||O===void 0||O.insertBefore(this._canvas,this._viewportElement);let D=this._canvas.getContext("2d");if(!D)throw new Error("Ctx cannot be null");this._ctx=D,this._registerDecorationListeners(),this._registerBufferChangeListeners(),this._registerDimensionChangeListeners(),this.register((0,w.toDisposable)((()=>{var M;(M=this._canvas)===null||M===void 0||M.remove()})))}_registerDecorationListeners(){this.register(this._decorationService.onDecorationRegistered((()=>this._queueRefresh(void 0,!0)))),this.register(this._decorationService.onDecorationRemoved((()=>this._queueRefresh(void 0,!0))))}_registerBufferChangeListeners(){this.register(this._renderService.onRenderedViewportChange((()=>this._queueRefresh()))),this.register(this._bufferService.buffers.onBufferActivate((()=>{this._canvas.style.display=this._bufferService.buffer===this._bufferService.buffers.alt?"none":"block"}))),this.register(this._bufferService.onScroll((()=>{this._lastKnownBufferLength!==this._bufferService.buffers.normal.lines.length&&(this._refreshDrawHeightConstants(),this._refreshColorZonePadding())})))}_registerDimensionChangeListeners(){this.register(this._renderService.onRender((()=>{this._containerHeight&&this._containerHeight===this._screenElement.clientHeight||(this._queueRefresh(!0),this._containerHeight=this._screenElement.clientHeight)}))),this.register(this._optionsService.onSpecificOptionChange("overviewRulerWidth",(()=>this._queueRefresh(!0)))),this.register((0,f.addDisposableDomListener)(this._coreBrowseService.window,"resize",(()=>this._queueRefresh(!0)))),this._queueRefresh(!0)}_refreshDrawConstants(){let m=Math.floor(this._canvas.width/3),v=Math.ceil(this._canvas.width/3);l.full=this._canvas.width,l.left=m,l.center=v,l.right=m,this._refreshDrawHeightConstants(),a.full=0,a.left=0,a.center=l.left,a.right=l.left+l.center}_refreshDrawHeightConstants(){r.full=Math.round(2*this._coreBrowseService.dpr);let m=this._canvas.height/this._bufferService.buffer.lines.length,v=Math.round(Math.max(Math.min(m,12),6)*this._coreBrowseService.dpr);r.left=v,r.center=v,r.right=v}_refreshColorZonePadding(){this._colorZoneStore.setPadding({full:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*r.full),left:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*r.left),center:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*r.center),right:Math.floor(this._bufferService.buffers.active.lines.length/(this._canvas.height-1)*r.right)}),this._lastKnownBufferLength=this._bufferService.buffers.normal.lines.length}_refreshCanvasDimensions(){this._canvas.style.width=`${this._width}px`,this._canvas.width=Math.round(this._width*this._coreBrowseService.dpr),this._canvas.style.height=`${this._screenElement.clientHeight}px`,this._canvas.height=Math.round(this._screenElement.clientHeight*this._coreBrowseService.dpr),this._refreshDrawConstants(),this._refreshColorZonePadding()}_refreshDecorations(){this._shouldUpdateDimensions&&this._refreshCanvasDimensions(),this._ctx.clearRect(0,0,this._canvas.width,this._canvas.height),this._colorZoneStore.clear();for(let v of this._decorationService.decorations)this._colorZoneStore.addDecoration(v);this._ctx.lineWidth=1;let m=this._colorZoneStore.zones;for(let v of m)v.position!=="full"&&this._renderColorZone(v);for(let v of m)v.position==="full"&&this._renderColorZone(v);this._shouldUpdateDimensions=!1,this._shouldUpdateAnchor=!1}_renderColorZone(m){this._ctx.fillStyle=m.color,this._ctx.fillRect(a[m.position||"full"],Math.round((this._canvas.height-1)*(m.startBufferLine/this._bufferService.buffers.active.lines.length)-r[m.position||"full"]/2),l[m.position||"full"],Math.round((this._canvas.height-1)*((m.endBufferLine-m.startBufferLine)/this._bufferService.buffers.active.lines.length)+r[m.position||"full"]))}_queueRefresh(m,v){this._shouldUpdateDimensions=m||this._shouldUpdateDimensions,this._shouldUpdateAnchor=v||this._shouldUpdateAnchor,this._animationFrame===void 0&&(this._animationFrame=this._coreBrowseService.window.requestAnimationFrame((()=>{this._refreshDecorations(),this._animationFrame=void 0})))}};i.OverviewRulerRenderer=h=c([p(2,b.IBufferService),p(3,b.IDecorationService),p(4,g.IRenderService),p(5,b.IOptionsService),p(6,g.ICoreBrowserService)],h)},2950:function(u,i,o){var c=this&&this.__decorate||function(b,r,l,a){var h,m=arguments.length,v=m<3?r:a===null?a=Object.getOwnPropertyDescriptor(r,l):a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")v=Reflect.decorate(b,r,l,a);else for(var y=b.length-1;y>=0;y--)(h=b[y])&&(v=(m<3?h(v):m>3?h(r,l,v):h(r,l))||v);return m>3&&v&&Object.defineProperty(r,l,v),v},p=this&&this.__param||function(b,r){return function(l,a){r(l,a,b)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CompositionHelper=void 0;let d=o(4725),f=o(2585),g=o(2584),w=i.CompositionHelper=class{get isComposing(){return this._isComposing}constructor(b,r,l,a,h,m){this._textarea=b,this._compositionView=r,this._bufferService=l,this._optionsService=a,this._coreService=h,this._renderService=m,this._isComposing=!1,this._isSendingComposition=!1,this._compositionPosition={start:0,end:0},this._dataAlreadySent=""}compositionstart(){this._isComposing=!0,this._compositionPosition.start=this._textarea.value.length,this._compositionView.textContent="",this._dataAlreadySent="",this._compositionView.classList.add("active")}compositionupdate(b){this._compositionView.textContent=b.data,this.updateCompositionElements(),setTimeout((()=>{this._compositionPosition.end=this._textarea.value.length}),0)}compositionend(){this._finalizeComposition(!0)}keydown(b){if(this._isComposing||this._isSendingComposition){if(b.keyCode===229||b.keyCode===16||b.keyCode===17||b.keyCode===18)return!1;this._finalizeComposition(!1)}return b.keyCode!==229||(this._handleAnyTextareaChanges(),!1)}_finalizeComposition(b){if(this._compositionView.classList.remove("active"),this._isComposing=!1,b){let r={start:this._compositionPosition.start,end:this._compositionPosition.end};this._isSendingComposition=!0,setTimeout((()=>{if(this._isSendingComposition){let l;this._isSendingComposition=!1,r.start+=this._dataAlreadySent.length,l=this._isComposing?this._textarea.value.substring(r.start,r.end):this._textarea.value.substring(r.start),l.length>0&&this._coreService.triggerDataEvent(l,!0)}}),0)}else{this._isSendingComposition=!1;let r=this._textarea.value.substring(this._compositionPosition.start,this._compositionPosition.end);this._coreService.triggerDataEvent(r,!0)}}_handleAnyTextareaChanges(){let b=this._textarea.value;setTimeout((()=>{if(!this._isComposing){let r=this._textarea.value,l=r.replace(b,"");this._dataAlreadySent=l,r.length>b.length?this._coreService.triggerDataEvent(l,!0):r.length<b.length?this._coreService.triggerDataEvent(`${g.C0.DEL}`,!0):r.length===b.length&&r!==b&&this._coreService.triggerDataEvent(r,!0)}}),0)}updateCompositionElements(b){if(this._isComposing){if(this._bufferService.buffer.isCursorInViewport){let r=Math.min(this._bufferService.buffer.x,this._bufferService.cols-1),l=this._renderService.dimensions.css.cell.height,a=this._bufferService.buffer.y*this._renderService.dimensions.css.cell.height,h=r*this._renderService.dimensions.css.cell.width;this._compositionView.style.left=h+"px",this._compositionView.style.top=a+"px",this._compositionView.style.height=l+"px",this._compositionView.style.lineHeight=l+"px",this._compositionView.style.fontFamily=this._optionsService.rawOptions.fontFamily,this._compositionView.style.fontSize=this._optionsService.rawOptions.fontSize+"px";let m=this._compositionView.getBoundingClientRect();this._textarea.style.left=h+"px",this._textarea.style.top=a+"px",this._textarea.style.width=Math.max(m.width,1)+"px",this._textarea.style.height=Math.max(m.height,1)+"px",this._textarea.style.lineHeight=m.height+"px"}b||setTimeout((()=>this.updateCompositionElements(!0)),0)}}};i.CompositionHelper=w=c([p(2,f.IBufferService),p(3,f.IOptionsService),p(4,f.ICoreService),p(5,d.IRenderService)],w)},9806:(u,i)=>{function o(c,p,d){let f=d.getBoundingClientRect(),g=c.getComputedStyle(d),w=parseInt(g.getPropertyValue("padding-left")),b=parseInt(g.getPropertyValue("padding-top"));return[p.clientX-f.left-w,p.clientY-f.top-b]}Object.defineProperty(i,"__esModule",{value:!0}),i.getCoords=i.getCoordsRelativeToElement=void 0,i.getCoordsRelativeToElement=o,i.getCoords=function(c,p,d,f,g,w,b,r,l){if(!w)return;let a=o(c,p,d);return a?(a[0]=Math.ceil((a[0]+(l?b/2:0))/b),a[1]=Math.ceil(a[1]/r),a[0]=Math.min(Math.max(a[0],1),f+(l?1:0)),a[1]=Math.min(Math.max(a[1],1),g),a):void 0}},9504:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.moveToCellSequence=void 0;let c=o(2584);function p(r,l,a,h){let m=r-d(r,a),v=l-d(l,a),y=Math.abs(m-v)-(function(x,_,S){let L=0,O=x-d(x,S),D=_-d(_,S);for(let M=0;M<Math.abs(O-D);M++){let z=f(x,_)==="A"?-1:1,B=S.buffer.lines.get(O+z*M);B?.isWrapped&&L++}return L})(r,l,a);return b(y,w(f(r,l),h))}function d(r,l){let a=0,h=l.buffer.lines.get(r),m=h?.isWrapped;for(;m&&r>=0&&r<l.rows;)a++,h=l.buffer.lines.get(--r),m=h?.isWrapped;return a}function f(r,l){return r>l?"A":"B"}function g(r,l,a,h,m,v){let y=r,x=l,_="";for(;y!==a||x!==h;)y+=m?1:-1,m&&y>v.cols-1?(_+=v.buffer.translateBufferLineToString(x,!1,r,y),y=0,r=0,x++):!m&&y<0&&(_+=v.buffer.translateBufferLineToString(x,!1,0,r+1),y=v.cols-1,r=y,x--);return _+v.buffer.translateBufferLineToString(x,!1,r,y)}function w(r,l){let a=l?"O":"[";return c.C0.ESC+a+r}function b(r,l){r=Math.floor(r);let a="";for(let h=0;h<r;h++)a+=l;return a}i.moveToCellSequence=function(r,l,a,h){let m=a.buffer.x,v=a.buffer.y;if(!a.buffer.hasScrollback)return(function(_,S,L,O,D,M){return p(S,O,D,M).length===0?"":b(g(_,S,_,S-d(S,D),!1,D).length,w("D",M))})(m,v,0,l,a,h)+p(v,l,a,h)+(function(_,S,L,O,D,M){let z;z=p(S,O,D,M).length>0?O-d(O,D):S;let B=O,$=(function(I,C,E,A,R,N){let j;return j=p(E,A,R,N).length>0?A-d(A,R):C,I<E&&j<=A||I>=E&&j<A?"C":"D"})(_,S,L,O,D,M);return b(g(_,z,L,B,$==="C",D).length,w($,M))})(m,v,r,l,a,h);let y;if(v===l)return y=m>r?"D":"C",b(Math.abs(m-r),w(y,h));y=v>l?"D":"C";let x=Math.abs(v-l);return b((function(_,S){return S.cols-_})(v>l?r:m,a)+(x-1)*a.cols+1+((v>l?m:r)-1),w(y,h))}},1296:function(u,i,o){var c=this&&this.__decorate||function(D,M,z,B){var $,I=arguments.length,C=I<3?M:B===null?B=Object.getOwnPropertyDescriptor(M,z):B;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")C=Reflect.decorate(D,M,z,B);else for(var E=D.length-1;E>=0;E--)($=D[E])&&(C=(I<3?$(C):I>3?$(M,z,C):$(M,z))||C);return I>3&&C&&Object.defineProperty(M,z,C),C},p=this&&this.__param||function(D,M){return function(z,B){M(z,B,D)}};Object.defineProperty(i,"__esModule",{value:!0}),i.DomRenderer=void 0;let d=o(3787),f=o(2550),g=o(2223),w=o(6171),b=o(4725),r=o(8055),l=o(8460),a=o(844),h=o(2585),m="xterm-dom-renderer-owner-",v="xterm-rows",y="xterm-fg-",x="xterm-bg-",_="xterm-focus",S="xterm-selection",L=1,O=i.DomRenderer=class extends a.Disposable{constructor(D,M,z,B,$,I,C,E,A,R){super(),this._element=D,this._screenElement=M,this._viewportElement=z,this._linkifier2=B,this._charSizeService=I,this._optionsService=C,this._bufferService=E,this._coreBrowserService=A,this._themeService=R,this._terminalClass=L++,this._rowElements=[],this.onRequestRedraw=this.register(new l.EventEmitter).event,this._rowContainer=document.createElement("div"),this._rowContainer.classList.add(v),this._rowContainer.style.lineHeight="normal",this._rowContainer.setAttribute("aria-hidden","true"),this._refreshRowElements(this._bufferService.cols,this._bufferService.rows),this._selectionContainer=document.createElement("div"),this._selectionContainer.classList.add(S),this._selectionContainer.setAttribute("aria-hidden","true"),this.dimensions=(0,w.createRenderDimensions)(),this._updateDimensions(),this.register(this._optionsService.onOptionChange((()=>this._handleOptionsChanged()))),this.register(this._themeService.onChangeColors((N=>this._injectCss(N)))),this._injectCss(this._themeService.colors),this._rowFactory=$.createInstance(d.DomRendererRowFactory,document),this._element.classList.add(m+this._terminalClass),this._screenElement.appendChild(this._rowContainer),this._screenElement.appendChild(this._selectionContainer),this.register(this._linkifier2.onShowLinkUnderline((N=>this._handleLinkHover(N)))),this.register(this._linkifier2.onHideLinkUnderline((N=>this._handleLinkLeave(N)))),this.register((0,a.toDisposable)((()=>{this._element.classList.remove(m+this._terminalClass),this._rowContainer.remove(),this._selectionContainer.remove(),this._widthCache.dispose(),this._themeStyleElement.remove(),this._dimensionsStyleElement.remove()}))),this._widthCache=new f.WidthCache(document),this._widthCache.setFont(this._optionsService.rawOptions.fontFamily,this._optionsService.rawOptions.fontSize,this._optionsService.rawOptions.fontWeight,this._optionsService.rawOptions.fontWeightBold),this._setDefaultSpacing()}_updateDimensions(){let D=this._coreBrowserService.dpr;this.dimensions.device.char.width=this._charSizeService.width*D,this.dimensions.device.char.height=Math.ceil(this._charSizeService.height*D),this.dimensions.device.cell.width=this.dimensions.device.char.width+Math.round(this._optionsService.rawOptions.letterSpacing),this.dimensions.device.cell.height=Math.floor(this.dimensions.device.char.height*this._optionsService.rawOptions.lineHeight),this.dimensions.device.char.left=0,this.dimensions.device.char.top=0,this.dimensions.device.canvas.width=this.dimensions.device.cell.width*this._bufferService.cols,this.dimensions.device.canvas.height=this.dimensions.device.cell.height*this._bufferService.rows,this.dimensions.css.canvas.width=Math.round(this.dimensions.device.canvas.width/D),this.dimensions.css.canvas.height=Math.round(this.dimensions.device.canvas.height/D),this.dimensions.css.cell.width=this.dimensions.css.canvas.width/this._bufferService.cols,this.dimensions.css.cell.height=this.dimensions.css.canvas.height/this._bufferService.rows;for(let z of this._rowElements)z.style.width=`${this.dimensions.css.canvas.width}px`,z.style.height=`${this.dimensions.css.cell.height}px`,z.style.lineHeight=`${this.dimensions.css.cell.height}px`,z.style.overflow="hidden";this._dimensionsStyleElement||(this._dimensionsStyleElement=document.createElement("style"),this._screenElement.appendChild(this._dimensionsStyleElement));let M=`${this._terminalSelector} .${v} span { display: inline-block; height: 100%; vertical-align: top;}`;this._dimensionsStyleElement.textContent=M,this._selectionContainer.style.height=this._viewportElement.style.height,this._screenElement.style.width=`${this.dimensions.css.canvas.width}px`,this._screenElement.style.height=`${this.dimensions.css.canvas.height}px`}_injectCss(D){this._themeStyleElement||(this._themeStyleElement=document.createElement("style"),this._screenElement.appendChild(this._themeStyleElement));let M=`${this._terminalSelector} .${v} { color: ${D.foreground.css}; font-family: ${this._optionsService.rawOptions.fontFamily}; font-size: ${this._optionsService.rawOptions.fontSize}px; font-kerning: none; white-space: pre}`;M+=`${this._terminalSelector} .${v} .xterm-dim { color: ${r.color.multiplyOpacity(D.foreground,.5).css};}`,M+=`${this._terminalSelector} span:not(.xterm-bold) { font-weight: ${this._optionsService.rawOptions.fontWeight};}${this._terminalSelector} span.xterm-bold { font-weight: ${this._optionsService.rawOptions.fontWeightBold};}${this._terminalSelector} span.xterm-italic { font-style: italic;}`,M+="@keyframes blink_box_shadow_"+this._terminalClass+" { 50% {  border-bottom-style: hidden; }}",M+="@keyframes blink_block_"+this._terminalClass+` { 0% {  background-color: ${D.cursor.css};  color: ${D.cursorAccent.css}; } 50% {  background-color: inherit;  color: ${D.cursor.css}; }}`,M+=`${this._terminalSelector} .${v}.${_} .xterm-cursor.xterm-cursor-blink:not(.xterm-cursor-block) { animation: blink_box_shadow_`+this._terminalClass+` 1s step-end infinite;}${this._terminalSelector} .${v}.${_} .xterm-cursor.xterm-cursor-blink.xterm-cursor-block { animation: blink_block_`+this._terminalClass+` 1s step-end infinite;}${this._terminalSelector} .${v} .xterm-cursor.xterm-cursor-block { background-color: ${D.cursor.css}; color: ${D.cursorAccent.css};}${this._terminalSelector} .${v} .xterm-cursor.xterm-cursor-outline { outline: 1px solid ${D.cursor.css}; outline-offset: -1px;}${this._terminalSelector} .${v} .xterm-cursor.xterm-cursor-bar { box-shadow: ${this._optionsService.rawOptions.cursorWidth}px 0 0 ${D.cursor.css} inset;}${this._terminalSelector} .${v} .xterm-cursor.xterm-cursor-underline { border-bottom: 1px ${D.cursor.css}; border-bottom-style: solid; height: calc(100% - 1px);}`,M+=`${this._terminalSelector} .${S} { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none;}${this._terminalSelector}.focus .${S} div { position: absolute; background-color: ${D.selectionBackgroundOpaque.css};}${this._terminalSelector} .${S} div { position: absolute; background-color: ${D.selectionInactiveBackgroundOpaque.css};}`;for(let[z,B]of D.ansi.entries())M+=`${this._terminalSelector} .${y}${z} { color: ${B.css}; }${this._terminalSelector} .${y}${z}.xterm-dim { color: ${r.color.multiplyOpacity(B,.5).css}; }${this._terminalSelector} .${x}${z} { background-color: ${B.css}; }`;M+=`${this._terminalSelector} .${y}${g.INVERTED_DEFAULT_COLOR} { color: ${r.color.opaque(D.background).css}; }${this._terminalSelector} .${y}${g.INVERTED_DEFAULT_COLOR}.xterm-dim { color: ${r.color.multiplyOpacity(r.color.opaque(D.background),.5).css}; }${this._terminalSelector} .${x}${g.INVERTED_DEFAULT_COLOR} { background-color: ${D.foreground.css}; }`,this._themeStyleElement.textContent=M}_setDefaultSpacing(){let D=this.dimensions.css.cell.width-this._widthCache.get("W",!1,!1);this._rowContainer.style.letterSpacing=`${D}px`,this._rowFactory.defaultSpacing=D}handleDevicePixelRatioChange(){this._updateDimensions(),this._widthCache.clear(),this._setDefaultSpacing()}_refreshRowElements(D,M){for(let z=this._rowElements.length;z<=M;z++){let B=document.createElement("div");this._rowContainer.appendChild(B),this._rowElements.push(B)}for(;this._rowElements.length>M;)this._rowContainer.removeChild(this._rowElements.pop())}handleResize(D,M){this._refreshRowElements(D,M),this._updateDimensions()}handleCharSizeChanged(){this._updateDimensions(),this._widthCache.clear(),this._setDefaultSpacing()}handleBlur(){this._rowContainer.classList.remove(_)}handleFocus(){this._rowContainer.classList.add(_),this.renderRows(this._bufferService.buffer.y,this._bufferService.buffer.y)}handleSelectionChanged(D,M,z){if(this._selectionContainer.replaceChildren(),this._rowFactory.handleSelectionChanged(D,M,z),this.renderRows(0,this._bufferService.rows-1),!D||!M)return;let B=D[1]-this._bufferService.buffer.ydisp,$=M[1]-this._bufferService.buffer.ydisp,I=Math.max(B,0),C=Math.min($,this._bufferService.rows-1);if(I>=this._bufferService.rows||C<0)return;let E=document.createDocumentFragment();if(z){let A=D[0]>M[0];E.appendChild(this._createSelectionElement(I,A?M[0]:D[0],A?D[0]:M[0],C-I+1))}else{let A=B===I?D[0]:0,R=I===$?M[0]:this._bufferService.cols;E.appendChild(this._createSelectionElement(I,A,R));let N=C-I-1;if(E.appendChild(this._createSelectionElement(I+1,0,this._bufferService.cols,N)),I!==C){let j=$===C?M[0]:this._bufferService.cols;E.appendChild(this._createSelectionElement(C,0,j))}}this._selectionContainer.appendChild(E)}_createSelectionElement(D,M,z,B=1){let $=document.createElement("div");return $.style.height=B*this.dimensions.css.cell.height+"px",$.style.top=D*this.dimensions.css.cell.height+"px",$.style.left=M*this.dimensions.css.cell.width+"px",$.style.width=this.dimensions.css.cell.width*(z-M)+"px",$}handleCursorMove(){}_handleOptionsChanged(){this._updateDimensions(),this._injectCss(this._themeService.colors),this._widthCache.setFont(this._optionsService.rawOptions.fontFamily,this._optionsService.rawOptions.fontSize,this._optionsService.rawOptions.fontWeight,this._optionsService.rawOptions.fontWeightBold),this._setDefaultSpacing()}clear(){for(let D of this._rowElements)D.replaceChildren()}renderRows(D,M){let z=this._bufferService.buffer,B=z.ybase+z.y,$=Math.min(z.x,this._bufferService.cols-1),I=this._optionsService.rawOptions.cursorBlink,C=this._optionsService.rawOptions.cursorStyle,E=this._optionsService.rawOptions.cursorInactiveStyle;for(let A=D;A<=M;A++){let R=A+z.ydisp,N=this._rowElements[A],j=z.lines.get(R);if(!N||!j)break;N.replaceChildren(...this._rowFactory.createRow(j,R,R===B,C,E,$,I,this.dimensions.css.cell.width,this._widthCache,-1,-1))}}get _terminalSelector(){return`.${m}${this._terminalClass}`}_handleLinkHover(D){this._setCellUnderline(D.x1,D.x2,D.y1,D.y2,D.cols,!0)}_handleLinkLeave(D){this._setCellUnderline(D.x1,D.x2,D.y1,D.y2,D.cols,!1)}_setCellUnderline(D,M,z,B,$,I){z<0&&(D=0),B<0&&(M=0);let C=this._bufferService.rows-1;z=Math.max(Math.min(z,C),0),B=Math.max(Math.min(B,C),0),$=Math.min($,this._bufferService.cols);let E=this._bufferService.buffer,A=E.ybase+E.y,R=Math.min(E.x,$-1),N=this._optionsService.rawOptions.cursorBlink,j=this._optionsService.rawOptions.cursorStyle,G=this._optionsService.rawOptions.cursorInactiveStyle;for(let K=z;K<=B;++K){let he=K+E.ydisp,k=this._rowElements[K],F=E.lines.get(he);if(!k||!F)break;k.replaceChildren(...this._rowFactory.createRow(F,he,he===A,j,G,R,N,this.dimensions.css.cell.width,this._widthCache,I?K===z?D:0:-1,I?(K===B?M:$)-1:-1))}}};i.DomRenderer=O=c([p(4,h.IInstantiationService),p(5,b.ICharSizeService),p(6,h.IOptionsService),p(7,h.IBufferService),p(8,b.ICoreBrowserService),p(9,b.IThemeService)],O)},3787:function(u,i,o){var c=this&&this.__decorate||function(y,x,_,S){var L,O=arguments.length,D=O<3?x:S===null?S=Object.getOwnPropertyDescriptor(x,_):S;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")D=Reflect.decorate(y,x,_,S);else for(var M=y.length-1;M>=0;M--)(L=y[M])&&(D=(O<3?L(D):O>3?L(x,_,D):L(x,_))||D);return O>3&&D&&Object.defineProperty(x,_,D),D},p=this&&this.__param||function(y,x){return function(_,S){x(_,S,y)}};Object.defineProperty(i,"__esModule",{value:!0}),i.DomRendererRowFactory=void 0;let d=o(2223),f=o(643),g=o(511),w=o(2585),b=o(8055),r=o(4725),l=o(4269),a=o(6171),h=o(3734),m=i.DomRendererRowFactory=class{constructor(y,x,_,S,L,O,D){this._document=y,this._characterJoinerService=x,this._optionsService=_,this._coreBrowserService=S,this._coreService=L,this._decorationService=O,this._themeService=D,this._workCell=new g.CellData,this._columnSelectMode=!1,this.defaultSpacing=0}handleSelectionChanged(y,x,_){this._selectionStart=y,this._selectionEnd=x,this._columnSelectMode=_}createRow(y,x,_,S,L,O,D,M,z,B,$){let I=[],C=this._characterJoinerService.getJoinedCharacters(x),E=this._themeService.colors,A,R=y.getNoBgTrimmedLength();_&&R<O+1&&(R=O+1);let N=0,j="",G=0,K=0,he=0,k=!1,F=0,U=!1,W=0,ee=[],V=B!==-1&&$!==-1;for(let de=0;de<R;de++){y.loadCell(de,this._workCell);let Ee=this._workCell.getWidth();if(Ee===0)continue;let $e=!1,Yt=de,ne=this._workCell;if(C.length>0&&de===C[0][0]){$e=!0;let ge=C.shift();ne=new l.JoinedCellData(this._workCell,y.translateToString(!0,ge[0],ge[1]),ge[1]-ge[0]),Yt=ge[1]-1,Ee=ne.getWidth()}let _i=this._isCellInSelection(de,x),Ks=_&&de===O,Gs=V&&de>=B&&de<=$,Xs=!1;this._decorationService.forEachDecorationAtCell(de,x,void 0,(ge=>{Xs=!0}));let is=ne.getChars()||f.WHITESPACE_CELL_CHAR;if(is===" "&&(ne.isUnderline()||ne.isOverline())&&(is="\xA0"),W=Ee*M-z.get(is,ne.isBold(),ne.isItalic()),A){if(N&&(_i&&U||!_i&&!U&&ne.bg===G)&&(_i&&U&&E.selectionForeground||ne.fg===K)&&ne.extended.ext===he&&Gs===k&&W===F&&!Ks&&!$e&&!Xs){j+=is,N++;continue}N&&(A.textContent=j),A=this._document.createElement("span"),N=0,j=""}else A=this._document.createElement("span");if(G=ne.bg,K=ne.fg,he=ne.extended.ext,k=Gs,F=W,U=_i,$e&&O>=de&&O<=Yt&&(O=de),!this._coreService.isCursorHidden&&Ks){if(ee.push("xterm-cursor"),this._coreBrowserService.isFocused)D&&ee.push("xterm-cursor-blink"),ee.push(S==="bar"?"xterm-cursor-bar":S==="underline"?"xterm-cursor-underline":"xterm-cursor-block");else if(L)switch(L){case"outline":ee.push("xterm-cursor-outline");break;case"block":ee.push("xterm-cursor-block");break;case"bar":ee.push("xterm-cursor-bar");break;case"underline":ee.push("xterm-cursor-underline")}}if(ne.isBold()&&ee.push("xterm-bold"),ne.isItalic()&&ee.push("xterm-italic"),ne.isDim()&&ee.push("xterm-dim"),j=ne.isInvisible()?f.WHITESPACE_CELL_CHAR:ne.getChars()||f.WHITESPACE_CELL_CHAR,ne.isUnderline()&&(ee.push(`xterm-underline-${ne.extended.underlineStyle}`),j===" "&&(j="\xA0"),!ne.isUnderlineColorDefault()))if(ne.isUnderlineColorRGB())A.style.textDecorationColor=`rgb(${h.AttributeData.toColorRGB(ne.getUnderlineColor()).join(",")})`;else{let ge=ne.getUnderlineColor();this._optionsService.rawOptions.drawBoldTextInBrightColors&&ne.isBold()&&ge<8&&(ge+=8),A.style.textDecorationColor=E.ansi[ge].css}ne.isOverline()&&(ee.push("xterm-overline"),j===" "&&(j="\xA0")),ne.isStrikethrough()&&ee.push("xterm-strikethrough"),Gs&&(A.style.textDecoration="underline");let ze=ne.getFgColor(),mi=ne.getFgColorMode(),Ze=ne.getBgColor(),gi=ne.getBgColorMode(),Ys=!!ne.isInverse();if(Ys){let ge=ze;ze=Ze,Ze=ge;let xl=mi;mi=gi,gi=xl}let _t,Js,mt,vi=!1;switch(this._decorationService.forEachDecorationAtCell(de,x,void 0,(ge=>{ge.options.layer!=="top"&&vi||(ge.backgroundColorRGB&&(gi=50331648,Ze=ge.backgroundColorRGB.rgba>>8&16777215,_t=ge.backgroundColorRGB),ge.foregroundColorRGB&&(mi=50331648,ze=ge.foregroundColorRGB.rgba>>8&16777215,Js=ge.foregroundColorRGB),vi=ge.options.layer==="top")})),!vi&&_i&&(_t=this._coreBrowserService.isFocused?E.selectionBackgroundOpaque:E.selectionInactiveBackgroundOpaque,Ze=_t.rgba>>8&16777215,gi=50331648,vi=!0,E.selectionForeground&&(mi=50331648,ze=E.selectionForeground.rgba>>8&16777215,Js=E.selectionForeground)),vi&&ee.push("xterm-decoration-top"),gi){case 16777216:case 33554432:mt=E.ansi[Ze],ee.push(`xterm-bg-${Ze}`);break;case 50331648:mt=b.rgba.toColor(Ze>>16,Ze>>8&255,255&Ze),this._addStyle(A,`background-color:#${v((Ze>>>0).toString(16),"0",6)}`);break;default:Ys?(mt=E.foreground,ee.push(`xterm-bg-${d.INVERTED_DEFAULT_COLOR}`)):mt=E.background}switch(_t||ne.isDim()&&(_t=b.color.multiplyOpacity(mt,.5)),mi){case 16777216:case 33554432:ne.isBold()&&ze<8&&this._optionsService.rawOptions.drawBoldTextInBrightColors&&(ze+=8),this._applyMinimumContrast(A,mt,E.ansi[ze],ne,_t,void 0)||ee.push(`xterm-fg-${ze}`);break;case 50331648:let ge=b.rgba.toColor(ze>>16&255,ze>>8&255,255&ze);this._applyMinimumContrast(A,mt,ge,ne,_t,Js)||this._addStyle(A,`color:#${v(ze.toString(16),"0",6)}`);break;default:this._applyMinimumContrast(A,mt,E.foreground,ne,_t,void 0)||Ys&&ee.push(`xterm-fg-${d.INVERTED_DEFAULT_COLOR}`)}ee.length&&(A.className=ee.join(" "),ee.length=0),Ks||$e||Xs?A.textContent=j:N++,W!==this.defaultSpacing&&(A.style.letterSpacing=`${W}px`),I.push(A),de=Yt}return A&&N&&(A.textContent=j),I}_applyMinimumContrast(y,x,_,S,L,O){if(this._optionsService.rawOptions.minimumContrastRatio===1||(0,a.excludeFromContrastRatioDemands)(S.getCode()))return!1;let D=this._getContrastCache(S),M;if(L||O||(M=D.getColor(x.rgba,_.rgba)),M===void 0){let z=this._optionsService.rawOptions.minimumContrastRatio/(S.isDim()?2:1);M=b.color.ensureContrastRatio(L||x,O||_,z),D.setColor((L||x).rgba,(O||_).rgba,M??null)}return!!M&&(this._addStyle(y,`color:${M.css}`),!0)}_getContrastCache(y){return y.isDim()?this._themeService.colors.halfContrastCache:this._themeService.colors.contrastCache}_addStyle(y,x){y.setAttribute("style",`${y.getAttribute("style")||""}${x};`)}_isCellInSelection(y,x){let _=this._selectionStart,S=this._selectionEnd;return!(!_||!S)&&(this._columnSelectMode?_[0]<=S[0]?y>=_[0]&&x>=_[1]&&y<S[0]&&x<=S[1]:y<_[0]&&x>=_[1]&&y>=S[0]&&x<=S[1]:x>_[1]&&x<S[1]||_[1]===S[1]&&x===_[1]&&y>=_[0]&&y<S[0]||_[1]<S[1]&&x===S[1]&&y<S[0]||_[1]<S[1]&&x===_[1]&&y>=_[0])}};function v(y,x,_){for(;y.length<_;)y=x+y;return y}i.DomRendererRowFactory=m=c([p(1,r.ICharacterJoinerService),p(2,w.IOptionsService),p(3,r.ICoreBrowserService),p(4,w.ICoreService),p(5,w.IDecorationService),p(6,r.IThemeService)],m)},2550:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.WidthCache=void 0,i.WidthCache=class{constructor(o){this._flat=new Float32Array(256),this._font="",this._fontSize=0,this._weight="normal",this._weightBold="bold",this._measureElements=[],this._container=o.createElement("div"),this._container.style.position="absolute",this._container.style.top="-50000px",this._container.style.width="50000px",this._container.style.whiteSpace="pre",this._container.style.fontKerning="none";let c=o.createElement("span"),p=o.createElement("span");p.style.fontWeight="bold";let d=o.createElement("span");d.style.fontStyle="italic";let f=o.createElement("span");f.style.fontWeight="bold",f.style.fontStyle="italic",this._measureElements=[c,p,d,f],this._container.appendChild(c),this._container.appendChild(p),this._container.appendChild(d),this._container.appendChild(f),o.body.appendChild(this._container),this.clear()}dispose(){this._container.remove(),this._measureElements.length=0,this._holey=void 0}clear(){this._flat.fill(-9999),this._holey=new Map}setFont(o,c,p,d){o===this._font&&c===this._fontSize&&p===this._weight&&d===this._weightBold||(this._font=o,this._fontSize=c,this._weight=p,this._weightBold=d,this._container.style.fontFamily=this._font,this._container.style.fontSize=`${this._fontSize}px`,this._measureElements[0].style.fontWeight=`${p}`,this._measureElements[1].style.fontWeight=`${d}`,this._measureElements[2].style.fontWeight=`${p}`,this._measureElements[3].style.fontWeight=`${d}`,this.clear())}get(o,c,p){let d=0;if(!c&&!p&&o.length===1&&(d=o.charCodeAt(0))<256)return this._flat[d]!==-9999?this._flat[d]:this._flat[d]=this._measure(o,0);let f=o;c&&(f+="B"),p&&(f+="I");let g=this._holey.get(f);if(g===void 0){let w=0;c&&(w|=1),p&&(w|=2),g=this._measure(o,w),this._holey.set(f,g)}return g}_measure(o,c){let p=this._measureElements[c];return p.textContent=o.repeat(32),p.offsetWidth/32}}},2223:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.TEXT_BASELINE=i.DIM_OPACITY=i.INVERTED_DEFAULT_COLOR=void 0;let c=o(6114);i.INVERTED_DEFAULT_COLOR=257,i.DIM_OPACITY=.5,i.TEXT_BASELINE=c.isFirefox||c.isLegacyEdge?"bottom":"ideographic"},6171:(u,i)=>{function o(c){return 57508<=c&&c<=57558}Object.defineProperty(i,"__esModule",{value:!0}),i.createRenderDimensions=i.excludeFromContrastRatioDemands=i.isRestrictedPowerlineGlyph=i.isPowerlineGlyph=i.throwIfFalsy=void 0,i.throwIfFalsy=function(c){if(!c)throw new Error("value must not be falsy");return c},i.isPowerlineGlyph=o,i.isRestrictedPowerlineGlyph=function(c){return 57520<=c&&c<=57527},i.excludeFromContrastRatioDemands=function(c){return o(c)||(function(p){return 9472<=p&&p<=9631})(c)},i.createRenderDimensions=function(){return{css:{canvas:{width:0,height:0},cell:{width:0,height:0}},device:{canvas:{width:0,height:0},cell:{width:0,height:0},char:{width:0,height:0,left:0,top:0}}}}},456:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.SelectionModel=void 0,i.SelectionModel=class{constructor(o){this._bufferService=o,this.isSelectAllActive=!1,this.selectionStartLength=0}clearSelection(){this.selectionStart=void 0,this.selectionEnd=void 0,this.isSelectAllActive=!1,this.selectionStartLength=0}get finalSelectionStart(){return this.isSelectAllActive?[0,0]:this.selectionEnd&&this.selectionStart&&this.areSelectionValuesReversed()?this.selectionEnd:this.selectionStart}get finalSelectionEnd(){if(this.isSelectAllActive)return[this._bufferService.cols,this._bufferService.buffer.ybase+this._bufferService.rows-1];if(this.selectionStart){if(!this.selectionEnd||this.areSelectionValuesReversed()){let o=this.selectionStart[0]+this.selectionStartLength;return o>this._bufferService.cols?o%this._bufferService.cols==0?[this._bufferService.cols,this.selectionStart[1]+Math.floor(o/this._bufferService.cols)-1]:[o%this._bufferService.cols,this.selectionStart[1]+Math.floor(o/this._bufferService.cols)]:[o,this.selectionStart[1]]}if(this.selectionStartLength&&this.selectionEnd[1]===this.selectionStart[1]){let o=this.selectionStart[0]+this.selectionStartLength;return o>this._bufferService.cols?[o%this._bufferService.cols,this.selectionStart[1]+Math.floor(o/this._bufferService.cols)]:[Math.max(o,this.selectionEnd[0]),this.selectionEnd[1]]}return this.selectionEnd}}areSelectionValuesReversed(){let o=this.selectionStart,c=this.selectionEnd;return!(!o||!c)&&(o[1]>c[1]||o[1]===c[1]&&o[0]>c[0])}handleTrim(o){return this.selectionStart&&(this.selectionStart[1]-=o),this.selectionEnd&&(this.selectionEnd[1]-=o),this.selectionEnd&&this.selectionEnd[1]<0?(this.clearSelection(),!0):(this.selectionStart&&this.selectionStart[1]<0&&(this.selectionStart[1]=0),!1)}}},428:function(u,i,o){var c=this&&this.__decorate||function(r,l,a,h){var m,v=arguments.length,y=v<3?l:h===null?h=Object.getOwnPropertyDescriptor(l,a):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(r,l,a,h);else for(var x=r.length-1;x>=0;x--)(m=r[x])&&(y=(v<3?m(y):v>3?m(l,a,y):m(l,a))||y);return v>3&&y&&Object.defineProperty(l,a,y),y},p=this&&this.__param||function(r,l){return function(a,h){l(a,h,r)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CharSizeService=void 0;let d=o(2585),f=o(8460),g=o(844),w=i.CharSizeService=class extends g.Disposable{get hasValidSize(){return this.width>0&&this.height>0}constructor(r,l,a){super(),this._optionsService=a,this.width=0,this.height=0,this._onCharSizeChange=this.register(new f.EventEmitter),this.onCharSizeChange=this._onCharSizeChange.event,this._measureStrategy=new b(r,l,this._optionsService),this.register(this._optionsService.onMultipleOptionChange(["fontFamily","fontSize"],(()=>this.measure())))}measure(){let r=this._measureStrategy.measure();r.width===this.width&&r.height===this.height||(this.width=r.width,this.height=r.height,this._onCharSizeChange.fire())}};i.CharSizeService=w=c([p(2,d.IOptionsService)],w);class b{constructor(l,a,h){this._document=l,this._parentElement=a,this._optionsService=h,this._result={width:0,height:0},this._measureElement=this._document.createElement("span"),this._measureElement.classList.add("xterm-char-measure-element"),this._measureElement.textContent="W".repeat(32),this._measureElement.setAttribute("aria-hidden","true"),this._measureElement.style.whiteSpace="pre",this._measureElement.style.fontKerning="none",this._parentElement.appendChild(this._measureElement)}measure(){this._measureElement.style.fontFamily=this._optionsService.rawOptions.fontFamily,this._measureElement.style.fontSize=`${this._optionsService.rawOptions.fontSize}px`;let l={height:Number(this._measureElement.offsetHeight),width:Number(this._measureElement.offsetWidth)};return l.width!==0&&l.height!==0&&(this._result.width=l.width/32,this._result.height=Math.ceil(l.height)),this._result}}},4269:function(u,i,o){var c=this&&this.__decorate||function(l,a,h,m){var v,y=arguments.length,x=y<3?a:m===null?m=Object.getOwnPropertyDescriptor(a,h):m;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")x=Reflect.decorate(l,a,h,m);else for(var _=l.length-1;_>=0;_--)(v=l[_])&&(x=(y<3?v(x):y>3?v(a,h,x):v(a,h))||x);return y>3&&x&&Object.defineProperty(a,h,x),x},p=this&&this.__param||function(l,a){return function(h,m){a(h,m,l)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CharacterJoinerService=i.JoinedCellData=void 0;let d=o(3734),f=o(643),g=o(511),w=o(2585);class b extends d.AttributeData{constructor(a,h,m){super(),this.content=0,this.combinedData="",this.fg=a.fg,this.bg=a.bg,this.combinedData=h,this._width=m}isCombined(){return 2097152}getWidth(){return this._width}getChars(){return this.combinedData}getCode(){return 2097151}setFromCharData(a){throw new Error("not implemented")}getAsCharData(){return[this.fg,this.getChars(),this.getWidth(),this.getCode()]}}i.JoinedCellData=b;let r=i.CharacterJoinerService=class Qo{constructor(a){this._bufferService=a,this._characterJoiners=[],this._nextCharacterJoinerId=0,this._workCell=new g.CellData}register(a){let h={id:this._nextCharacterJoinerId++,handler:a};return this._characterJoiners.push(h),h.id}deregister(a){for(let h=0;h<this._characterJoiners.length;h++)if(this._characterJoiners[h].id===a)return this._characterJoiners.splice(h,1),!0;return!1}getJoinedCharacters(a){if(this._characterJoiners.length===0)return[];let h=this._bufferService.buffer.lines.get(a);if(!h||h.length===0)return[];let m=[],v=h.translateToString(!0),y=0,x=0,_=0,S=h.getFg(0),L=h.getBg(0);for(let O=0;O<h.getTrimmedLength();O++)if(h.loadCell(O,this._workCell),this._workCell.getWidth()!==0){if(this._workCell.fg!==S||this._workCell.bg!==L){if(O-y>1){let D=this._getJoinedRanges(v,_,x,h,y);for(let M=0;M<D.length;M++)m.push(D[M])}y=O,_=x,S=this._workCell.fg,L=this._workCell.bg}x+=this._workCell.getChars().length||f.WHITESPACE_CELL_CHAR.length}if(this._bufferService.cols-y>1){let O=this._getJoinedRanges(v,_,x,h,y);for(let D=0;D<O.length;D++)m.push(O[D])}return m}_getJoinedRanges(a,h,m,v,y){let x=a.substring(h,m),_=[];try{_=this._characterJoiners[0].handler(x)}catch(S){console.error(S)}for(let S=1;S<this._characterJoiners.length;S++)try{let L=this._characterJoiners[S].handler(x);for(let O=0;O<L.length;O++)Qo._mergeRanges(_,L[O])}catch(L){console.error(L)}return this._stringRangesToCellRanges(_,v,y),_}_stringRangesToCellRanges(a,h,m){let v=0,y=!1,x=0,_=a[v];if(_){for(let S=m;S<this._bufferService.cols;S++){let L=h.getWidth(S),O=h.getString(S).length||f.WHITESPACE_CELL_CHAR.length;if(L!==0){if(!y&&_[0]<=x&&(_[0]=S,y=!0),_[1]<=x){if(_[1]=S,_=a[++v],!_)break;_[0]<=x?(_[0]=S,y=!0):y=!1}x+=O}}_&&(_[1]=this._bufferService.cols)}}static _mergeRanges(a,h){let m=!1;for(let v=0;v<a.length;v++){let y=a[v];if(m){if(h[1]<=y[0])return a[v-1][1]=h[1],a;if(h[1]<=y[1])return a[v-1][1]=Math.max(h[1],y[1]),a.splice(v,1),a;a.splice(v,1),v--}else{if(h[1]<=y[0])return a.splice(v,0,h),a;if(h[1]<=y[1])return y[0]=Math.min(h[0],y[0]),a;h[0]<y[1]&&(y[0]=Math.min(h[0],y[0]),m=!0)}}return m?a[a.length-1][1]=h[1]:a.push(h),a}};i.CharacterJoinerService=r=c([p(0,w.IBufferService)],r)},5114:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CoreBrowserService=void 0,i.CoreBrowserService=class{constructor(o,c){this._textarea=o,this.window=c,this._isFocused=!1,this._cachedIsFocused=void 0,this._textarea.addEventListener("focus",(()=>this._isFocused=!0)),this._textarea.addEventListener("blur",(()=>this._isFocused=!1))}get dpr(){return this.window.devicePixelRatio}get isFocused(){return this._cachedIsFocused===void 0&&(this._cachedIsFocused=this._isFocused&&this._textarea.ownerDocument.hasFocus(),queueMicrotask((()=>this._cachedIsFocused=void 0))),this._cachedIsFocused}}},8934:function(u,i,o){var c=this&&this.__decorate||function(w,b,r,l){var a,h=arguments.length,m=h<3?b:l===null?l=Object.getOwnPropertyDescriptor(b,r):l;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")m=Reflect.decorate(w,b,r,l);else for(var v=w.length-1;v>=0;v--)(a=w[v])&&(m=(h<3?a(m):h>3?a(b,r,m):a(b,r))||m);return h>3&&m&&Object.defineProperty(b,r,m),m},p=this&&this.__param||function(w,b){return function(r,l){b(r,l,w)}};Object.defineProperty(i,"__esModule",{value:!0}),i.MouseService=void 0;let d=o(4725),f=o(9806),g=i.MouseService=class{constructor(w,b){this._renderService=w,this._charSizeService=b}getCoords(w,b,r,l,a){return(0,f.getCoords)(window,w,b,r,l,this._charSizeService.hasValidSize,this._renderService.dimensions.css.cell.width,this._renderService.dimensions.css.cell.height,a)}getMouseReportCoords(w,b){let r=(0,f.getCoordsRelativeToElement)(window,w,b);if(this._charSizeService.hasValidSize)return r[0]=Math.min(Math.max(r[0],0),this._renderService.dimensions.css.canvas.width-1),r[1]=Math.min(Math.max(r[1],0),this._renderService.dimensions.css.canvas.height-1),{col:Math.floor(r[0]/this._renderService.dimensions.css.cell.width),row:Math.floor(r[1]/this._renderService.dimensions.css.cell.height),x:Math.floor(r[0]),y:Math.floor(r[1])}}};i.MouseService=g=c([p(0,d.IRenderService),p(1,d.ICharSizeService)],g)},3230:function(u,i,o){var c=this&&this.__decorate||function(m,v,y,x){var _,S=arguments.length,L=S<3?v:x===null?x=Object.getOwnPropertyDescriptor(v,y):x;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")L=Reflect.decorate(m,v,y,x);else for(var O=m.length-1;O>=0;O--)(_=m[O])&&(L=(S<3?_(L):S>3?_(v,y,L):_(v,y))||L);return S>3&&L&&Object.defineProperty(v,y,L),L},p=this&&this.__param||function(m,v){return function(y,x){v(y,x,m)}};Object.defineProperty(i,"__esModule",{value:!0}),i.RenderService=void 0;let d=o(3656),f=o(6193),g=o(5596),w=o(4725),b=o(8460),r=o(844),l=o(7226),a=o(2585),h=i.RenderService=class extends r.Disposable{get dimensions(){return this._renderer.value.dimensions}constructor(m,v,y,x,_,S,L,O){if(super(),this._rowCount=m,this._charSizeService=x,this._renderer=this.register(new r.MutableDisposable),this._pausedResizeTask=new l.DebouncedIdleTask,this._isPaused=!1,this._needsFullRefresh=!1,this._isNextRenderRedrawOnly=!0,this._needsSelectionRefresh=!1,this._canvasWidth=0,this._canvasHeight=0,this._selectionState={start:void 0,end:void 0,columnSelectMode:!1},this._onDimensionsChange=this.register(new b.EventEmitter),this.onDimensionsChange=this._onDimensionsChange.event,this._onRenderedViewportChange=this.register(new b.EventEmitter),this.onRenderedViewportChange=this._onRenderedViewportChange.event,this._onRender=this.register(new b.EventEmitter),this.onRender=this._onRender.event,this._onRefreshRequest=this.register(new b.EventEmitter),this.onRefreshRequest=this._onRefreshRequest.event,this._renderDebouncer=new f.RenderDebouncer(L.window,((D,M)=>this._renderRows(D,M))),this.register(this._renderDebouncer),this._screenDprMonitor=new g.ScreenDprMonitor(L.window),this._screenDprMonitor.setListener((()=>this.handleDevicePixelRatioChange())),this.register(this._screenDprMonitor),this.register(S.onResize((()=>this._fullRefresh()))),this.register(S.buffers.onBufferActivate((()=>{var D;return(D=this._renderer.value)===null||D===void 0?void 0:D.clear()}))),this.register(y.onOptionChange((()=>this._handleOptionsChanged()))),this.register(this._charSizeService.onCharSizeChange((()=>this.handleCharSizeChanged()))),this.register(_.onDecorationRegistered((()=>this._fullRefresh()))),this.register(_.onDecorationRemoved((()=>this._fullRefresh()))),this.register(y.onMultipleOptionChange(["customGlyphs","drawBoldTextInBrightColors","letterSpacing","lineHeight","fontFamily","fontSize","fontWeight","fontWeightBold","minimumContrastRatio"],(()=>{this.clear(),this.handleResize(S.cols,S.rows),this._fullRefresh()}))),this.register(y.onMultipleOptionChange(["cursorBlink","cursorStyle"],(()=>this.refreshRows(S.buffer.y,S.buffer.y,!0)))),this.register((0,d.addDisposableDomListener)(L.window,"resize",(()=>this.handleDevicePixelRatioChange()))),this.register(O.onChangeColors((()=>this._fullRefresh()))),"IntersectionObserver"in L.window){let D=new L.window.IntersectionObserver((M=>this._handleIntersectionChange(M[M.length-1])),{threshold:0});D.observe(v),this.register({dispose:()=>D.disconnect()})}}_handleIntersectionChange(m){this._isPaused=m.isIntersecting===void 0?m.intersectionRatio===0:!m.isIntersecting,this._isPaused||this._charSizeService.hasValidSize||this._charSizeService.measure(),!this._isPaused&&this._needsFullRefresh&&(this._pausedResizeTask.flush(),this.refreshRows(0,this._rowCount-1),this._needsFullRefresh=!1)}refreshRows(m,v,y=!1){this._isPaused?this._needsFullRefresh=!0:(y||(this._isNextRenderRedrawOnly=!1),this._renderDebouncer.refresh(m,v,this._rowCount))}_renderRows(m,v){this._renderer.value&&(m=Math.min(m,this._rowCount-1),v=Math.min(v,this._rowCount-1),this._renderer.value.renderRows(m,v),this._needsSelectionRefresh&&(this._renderer.value.handleSelectionChanged(this._selectionState.start,this._selectionState.end,this._selectionState.columnSelectMode),this._needsSelectionRefresh=!1),this._isNextRenderRedrawOnly||this._onRenderedViewportChange.fire({start:m,end:v}),this._onRender.fire({start:m,end:v}),this._isNextRenderRedrawOnly=!0)}resize(m,v){this._rowCount=v,this._fireOnCanvasResize()}_handleOptionsChanged(){this._renderer.value&&(this.refreshRows(0,this._rowCount-1),this._fireOnCanvasResize())}_fireOnCanvasResize(){this._renderer.value&&(this._renderer.value.dimensions.css.canvas.width===this._canvasWidth&&this._renderer.value.dimensions.css.canvas.height===this._canvasHeight||this._onDimensionsChange.fire(this._renderer.value.dimensions))}hasRenderer(){return!!this._renderer.value}setRenderer(m){this._renderer.value=m,this._renderer.value.onRequestRedraw((v=>this.refreshRows(v.start,v.end,!0))),this._needsSelectionRefresh=!0,this._fullRefresh()}addRefreshCallback(m){return this._renderDebouncer.addRefreshCallback(m)}_fullRefresh(){this._isPaused?this._needsFullRefresh=!0:this.refreshRows(0,this._rowCount-1)}clearTextureAtlas(){var m,v;this._renderer.value&&((v=(m=this._renderer.value).clearTextureAtlas)===null||v===void 0||v.call(m),this._fullRefresh())}handleDevicePixelRatioChange(){this._charSizeService.measure(),this._renderer.value&&(this._renderer.value.handleDevicePixelRatioChange(),this.refreshRows(0,this._rowCount-1))}handleResize(m,v){this._renderer.value&&(this._isPaused?this._pausedResizeTask.set((()=>this._renderer.value.handleResize(m,v))):this._renderer.value.handleResize(m,v),this._fullRefresh())}handleCharSizeChanged(){var m;(m=this._renderer.value)===null||m===void 0||m.handleCharSizeChanged()}handleBlur(){var m;(m=this._renderer.value)===null||m===void 0||m.handleBlur()}handleFocus(){var m;(m=this._renderer.value)===null||m===void 0||m.handleFocus()}handleSelectionChanged(m,v,y){var x;this._selectionState.start=m,this._selectionState.end=v,this._selectionState.columnSelectMode=y,(x=this._renderer.value)===null||x===void 0||x.handleSelectionChanged(m,v,y)}handleCursorMove(){var m;(m=this._renderer.value)===null||m===void 0||m.handleCursorMove()}clear(){var m;(m=this._renderer.value)===null||m===void 0||m.clear()}};i.RenderService=h=c([p(2,a.IOptionsService),p(3,w.ICharSizeService),p(4,a.IDecorationService),p(5,a.IBufferService),p(6,w.ICoreBrowserService),p(7,w.IThemeService)],h)},9312:function(u,i,o){var c=this&&this.__decorate||function(_,S,L,O){var D,M=arguments.length,z=M<3?S:O===null?O=Object.getOwnPropertyDescriptor(S,L):O;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")z=Reflect.decorate(_,S,L,O);else for(var B=_.length-1;B>=0;B--)(D=_[B])&&(z=(M<3?D(z):M>3?D(S,L,z):D(S,L))||z);return M>3&&z&&Object.defineProperty(S,L,z),z},p=this&&this.__param||function(_,S){return function(L,O){S(L,O,_)}};Object.defineProperty(i,"__esModule",{value:!0}),i.SelectionService=void 0;let d=o(9806),f=o(9504),g=o(456),w=o(4725),b=o(8460),r=o(844),l=o(6114),a=o(4841),h=o(511),m=o(2585),v="\xA0",y=new RegExp(v,"g"),x=i.SelectionService=class extends r.Disposable{constructor(_,S,L,O,D,M,z,B,$){super(),this._element=_,this._screenElement=S,this._linkifier=L,this._bufferService=O,this._coreService=D,this._mouseService=M,this._optionsService=z,this._renderService=B,this._coreBrowserService=$,this._dragScrollAmount=0,this._enabled=!0,this._workCell=new h.CellData,this._mouseDownTimeStamp=0,this._oldHasSelection=!1,this._oldSelectionStart=void 0,this._oldSelectionEnd=void 0,this._onLinuxMouseSelection=this.register(new b.EventEmitter),this.onLinuxMouseSelection=this._onLinuxMouseSelection.event,this._onRedrawRequest=this.register(new b.EventEmitter),this.onRequestRedraw=this._onRedrawRequest.event,this._onSelectionChange=this.register(new b.EventEmitter),this.onSelectionChange=this._onSelectionChange.event,this._onRequestScrollLines=this.register(new b.EventEmitter),this.onRequestScrollLines=this._onRequestScrollLines.event,this._mouseMoveListener=I=>this._handleMouseMove(I),this._mouseUpListener=I=>this._handleMouseUp(I),this._coreService.onUserInput((()=>{this.hasSelection&&this.clearSelection()})),this._trimListener=this._bufferService.buffer.lines.onTrim((I=>this._handleTrim(I))),this.register(this._bufferService.buffers.onBufferActivate((I=>this._handleBufferActivate(I)))),this.enable(),this._model=new g.SelectionModel(this._bufferService),this._activeSelectionMode=0,this.register((0,r.toDisposable)((()=>{this._removeMouseDownListeners()})))}reset(){this.clearSelection()}disable(){this.clearSelection(),this._enabled=!1}enable(){this._enabled=!0}get selectionStart(){return this._model.finalSelectionStart}get selectionEnd(){return this._model.finalSelectionEnd}get hasSelection(){let _=this._model.finalSelectionStart,S=this._model.finalSelectionEnd;return!(!_||!S||_[0]===S[0]&&_[1]===S[1])}get selectionText(){let _=this._model.finalSelectionStart,S=this._model.finalSelectionEnd;if(!_||!S)return"";let L=this._bufferService.buffer,O=[];if(this._activeSelectionMode===3){if(_[0]===S[0])return"";let D=_[0]<S[0]?_[0]:S[0],M=_[0]<S[0]?S[0]:_[0];for(let z=_[1];z<=S[1];z++){let B=L.translateBufferLineToString(z,!0,D,M);O.push(B)}}else{let D=_[1]===S[1]?S[0]:void 0;O.push(L.translateBufferLineToString(_[1],!0,_[0],D));for(let M=_[1]+1;M<=S[1]-1;M++){let z=L.lines.get(M),B=L.translateBufferLineToString(M,!0);z?.isWrapped?O[O.length-1]+=B:O.push(B)}if(_[1]!==S[1]){let M=L.lines.get(S[1]),z=L.translateBufferLineToString(S[1],!0,0,S[0]);M&&M.isWrapped?O[O.length-1]+=z:O.push(z)}}return O.map((D=>D.replace(y," "))).join(l.isWindows?`\r
`:`
`)}clearSelection(){this._model.clearSelection(),this._removeMouseDownListeners(),this.refresh(),this._onSelectionChange.fire()}refresh(_){this._refreshAnimationFrame||(this._refreshAnimationFrame=this._coreBrowserService.window.requestAnimationFrame((()=>this._refresh()))),l.isLinux&&_&&this.selectionText.length&&this._onLinuxMouseSelection.fire(this.selectionText)}_refresh(){this._refreshAnimationFrame=void 0,this._onRedrawRequest.fire({start:this._model.finalSelectionStart,end:this._model.finalSelectionEnd,columnSelectMode:this._activeSelectionMode===3})}_isClickInSelection(_){let S=this._getMouseBufferCoords(_),L=this._model.finalSelectionStart,O=this._model.finalSelectionEnd;return!!(L&&O&&S)&&this._areCoordsInSelection(S,L,O)}isCellInSelection(_,S){let L=this._model.finalSelectionStart,O=this._model.finalSelectionEnd;return!(!L||!O)&&this._areCoordsInSelection([_,S],L,O)}_areCoordsInSelection(_,S,L){return _[1]>S[1]&&_[1]<L[1]||S[1]===L[1]&&_[1]===S[1]&&_[0]>=S[0]&&_[0]<L[0]||S[1]<L[1]&&_[1]===L[1]&&_[0]<L[0]||S[1]<L[1]&&_[1]===S[1]&&_[0]>=S[0]}_selectWordAtCursor(_,S){var L,O;let D=(O=(L=this._linkifier.currentLink)===null||L===void 0?void 0:L.link)===null||O===void 0?void 0:O.range;if(D)return this._model.selectionStart=[D.start.x-1,D.start.y-1],this._model.selectionStartLength=(0,a.getRangeLength)(D,this._bufferService.cols),this._model.selectionEnd=void 0,!0;let M=this._getMouseBufferCoords(_);return!!M&&(this._selectWordAt(M,S),this._model.selectionEnd=void 0,!0)}selectAll(){this._model.isSelectAllActive=!0,this.refresh(),this._onSelectionChange.fire()}selectLines(_,S){this._model.clearSelection(),_=Math.max(_,0),S=Math.min(S,this._bufferService.buffer.lines.length-1),this._model.selectionStart=[0,_],this._model.selectionEnd=[this._bufferService.cols,S],this.refresh(),this._onSelectionChange.fire()}_handleTrim(_){this._model.handleTrim(_)&&this.refresh()}_getMouseBufferCoords(_){let S=this._mouseService.getCoords(_,this._screenElement,this._bufferService.cols,this._bufferService.rows,!0);if(S)return S[0]--,S[1]--,S[1]+=this._bufferService.buffer.ydisp,S}_getMouseEventScrollAmount(_){let S=(0,d.getCoordsRelativeToElement)(this._coreBrowserService.window,_,this._screenElement)[1],L=this._renderService.dimensions.css.canvas.height;return S>=0&&S<=L?0:(S>L&&(S-=L),S=Math.min(Math.max(S,-50),50),S/=50,S/Math.abs(S)+Math.round(14*S))}shouldForceSelection(_){return l.isMac?_.altKey&&this._optionsService.rawOptions.macOptionClickForcesSelection:_.shiftKey}handleMouseDown(_){if(this._mouseDownTimeStamp=_.timeStamp,(_.button!==2||!this.hasSelection)&&_.button===0){if(!this._enabled){if(!this.shouldForceSelection(_))return;_.stopPropagation()}_.preventDefault(),this._dragScrollAmount=0,this._enabled&&_.shiftKey?this._handleIncrementalClick(_):_.detail===1?this._handleSingleClick(_):_.detail===2?this._handleDoubleClick(_):_.detail===3&&this._handleTripleClick(_),this._addMouseDownListeners(),this.refresh(!0)}}_addMouseDownListeners(){this._screenElement.ownerDocument&&(this._screenElement.ownerDocument.addEventListener("mousemove",this._mouseMoveListener),this._screenElement.ownerDocument.addEventListener("mouseup",this._mouseUpListener)),this._dragScrollIntervalTimer=this._coreBrowserService.window.setInterval((()=>this._dragScroll()),50)}_removeMouseDownListeners(){this._screenElement.ownerDocument&&(this._screenElement.ownerDocument.removeEventListener("mousemove",this._mouseMoveListener),this._screenElement.ownerDocument.removeEventListener("mouseup",this._mouseUpListener)),this._coreBrowserService.window.clearInterval(this._dragScrollIntervalTimer),this._dragScrollIntervalTimer=void 0}_handleIncrementalClick(_){this._model.selectionStart&&(this._model.selectionEnd=this._getMouseBufferCoords(_))}_handleSingleClick(_){if(this._model.selectionStartLength=0,this._model.isSelectAllActive=!1,this._activeSelectionMode=this.shouldColumnSelect(_)?3:0,this._model.selectionStart=this._getMouseBufferCoords(_),!this._model.selectionStart)return;this._model.selectionEnd=void 0;let S=this._bufferService.buffer.lines.get(this._model.selectionStart[1]);S&&S.length!==this._model.selectionStart[0]&&S.hasWidth(this._model.selectionStart[0])===0&&this._model.selectionStart[0]++}_handleDoubleClick(_){this._selectWordAtCursor(_,!0)&&(this._activeSelectionMode=1)}_handleTripleClick(_){let S=this._getMouseBufferCoords(_);S&&(this._activeSelectionMode=2,this._selectLineAt(S[1]))}shouldColumnSelect(_){return _.altKey&&!(l.isMac&&this._optionsService.rawOptions.macOptionClickForcesSelection)}_handleMouseMove(_){if(_.stopImmediatePropagation(),!this._model.selectionStart)return;let S=this._model.selectionEnd?[this._model.selectionEnd[0],this._model.selectionEnd[1]]:null;if(this._model.selectionEnd=this._getMouseBufferCoords(_),!this._model.selectionEnd)return void this.refresh(!0);this._activeSelectionMode===2?this._model.selectionEnd[1]<this._model.selectionStart[1]?this._model.selectionEnd[0]=0:this._model.selectionEnd[0]=this._bufferService.cols:this._activeSelectionMode===1&&this._selectToWordAt(this._model.selectionEnd),this._dragScrollAmount=this._getMouseEventScrollAmount(_),this._activeSelectionMode!==3&&(this._dragScrollAmount>0?this._model.selectionEnd[0]=this._bufferService.cols:this._dragScrollAmount<0&&(this._model.selectionEnd[0]=0));let L=this._bufferService.buffer;if(this._model.selectionEnd[1]<L.lines.length){let O=L.lines.get(this._model.selectionEnd[1]);O&&O.hasWidth(this._model.selectionEnd[0])===0&&this._model.selectionEnd[0]++}S&&S[0]===this._model.selectionEnd[0]&&S[1]===this._model.selectionEnd[1]||this.refresh(!0)}_dragScroll(){if(this._model.selectionEnd&&this._model.selectionStart&&this._dragScrollAmount){this._onRequestScrollLines.fire({amount:this._dragScrollAmount,suppressScrollEvent:!1});let _=this._bufferService.buffer;this._dragScrollAmount>0?(this._activeSelectionMode!==3&&(this._model.selectionEnd[0]=this._bufferService.cols),this._model.selectionEnd[1]=Math.min(_.ydisp+this._bufferService.rows,_.lines.length-1)):(this._activeSelectionMode!==3&&(this._model.selectionEnd[0]=0),this._model.selectionEnd[1]=_.ydisp),this.refresh()}}_handleMouseUp(_){let S=_.timeStamp-this._mouseDownTimeStamp;if(this._removeMouseDownListeners(),this.selectionText.length<=1&&S<500&&_.altKey&&this._optionsService.rawOptions.altClickMovesCursor){if(this._bufferService.buffer.ybase===this._bufferService.buffer.ydisp){let L=this._mouseService.getCoords(_,this._element,this._bufferService.cols,this._bufferService.rows,!1);if(L&&L[0]!==void 0&&L[1]!==void 0){let O=(0,f.moveToCellSequence)(L[0]-1,L[1]-1,this._bufferService,this._coreService.decPrivateModes.applicationCursorKeys);this._coreService.triggerDataEvent(O,!0)}}}else this._fireEventIfSelectionChanged()}_fireEventIfSelectionChanged(){let _=this._model.finalSelectionStart,S=this._model.finalSelectionEnd,L=!(!_||!S||_[0]===S[0]&&_[1]===S[1]);L?_&&S&&(this._oldSelectionStart&&this._oldSelectionEnd&&_[0]===this._oldSelectionStart[0]&&_[1]===this._oldSelectionStart[1]&&S[0]===this._oldSelectionEnd[0]&&S[1]===this._oldSelectionEnd[1]||this._fireOnSelectionChange(_,S,L)):this._oldHasSelection&&this._fireOnSelectionChange(_,S,L)}_fireOnSelectionChange(_,S,L){this._oldSelectionStart=_,this._oldSelectionEnd=S,this._oldHasSelection=L,this._onSelectionChange.fire()}_handleBufferActivate(_){this.clearSelection(),this._trimListener.dispose(),this._trimListener=_.activeBuffer.lines.onTrim((S=>this._handleTrim(S)))}_convertViewportColToCharacterIndex(_,S){let L=S;for(let O=0;S>=O;O++){let D=_.loadCell(O,this._workCell).getChars().length;this._workCell.getWidth()===0?L--:D>1&&S!==O&&(L+=D-1)}return L}setSelection(_,S,L){this._model.clearSelection(),this._removeMouseDownListeners(),this._model.selectionStart=[_,S],this._model.selectionStartLength=L,this.refresh(),this._fireEventIfSelectionChanged()}rightClickSelect(_){this._isClickInSelection(_)||(this._selectWordAtCursor(_,!1)&&this.refresh(!0),this._fireEventIfSelectionChanged())}_getWordAt(_,S,L=!0,O=!0){if(_[0]>=this._bufferService.cols)return;let D=this._bufferService.buffer,M=D.lines.get(_[1]);if(!M)return;let z=D.translateBufferLineToString(_[1],!1),B=this._convertViewportColToCharacterIndex(M,_[0]),$=B,I=_[0]-B,C=0,E=0,A=0,R=0;if(z.charAt(B)===" "){for(;B>0&&z.charAt(B-1)===" ";)B--;for(;$<z.length&&z.charAt($+1)===" ";)$++}else{let G=_[0],K=_[0];M.getWidth(G)===0&&(C++,G--),M.getWidth(K)===2&&(E++,K++);let he=M.getString(K).length;for(he>1&&(R+=he-1,$+=he-1);G>0&&B>0&&!this._isCharWordSeparator(M.loadCell(G-1,this._workCell));){M.loadCell(G-1,this._workCell);let k=this._workCell.getChars().length;this._workCell.getWidth()===0?(C++,G--):k>1&&(A+=k-1,B-=k-1),B--,G--}for(;K<M.length&&$+1<z.length&&!this._isCharWordSeparator(M.loadCell(K+1,this._workCell));){M.loadCell(K+1,this._workCell);let k=this._workCell.getChars().length;this._workCell.getWidth()===2?(E++,K++):k>1&&(R+=k-1,$+=k-1),$++,K++}}$++;let N=B+I-C+A,j=Math.min(this._bufferService.cols,$-B+C+E-A-R);if(S||z.slice(B,$).trim()!==""){if(L&&N===0&&M.getCodePoint(0)!==32){let G=D.lines.get(_[1]-1);if(G&&M.isWrapped&&G.getCodePoint(this._bufferService.cols-1)!==32){let K=this._getWordAt([this._bufferService.cols-1,_[1]-1],!1,!0,!1);if(K){let he=this._bufferService.cols-K.start;N-=he,j+=he}}}if(O&&N+j===this._bufferService.cols&&M.getCodePoint(this._bufferService.cols-1)!==32){let G=D.lines.get(_[1]+1);if(G?.isWrapped&&G.getCodePoint(0)!==32){let K=this._getWordAt([0,_[1]+1],!1,!1,!0);K&&(j+=K.length)}}return{start:N,length:j}}}_selectWordAt(_,S){let L=this._getWordAt(_,S);if(L){for(;L.start<0;)L.start+=this._bufferService.cols,_[1]--;this._model.selectionStart=[L.start,_[1]],this._model.selectionStartLength=L.length}}_selectToWordAt(_){let S=this._getWordAt(_,!0);if(S){let L=_[1];for(;S.start<0;)S.start+=this._bufferService.cols,L--;if(!this._model.areSelectionValuesReversed())for(;S.start+S.length>this._bufferService.cols;)S.length-=this._bufferService.cols,L++;this._model.selectionEnd=[this._model.areSelectionValuesReversed()?S.start:S.start+S.length,L]}}_isCharWordSeparator(_){return _.getWidth()!==0&&this._optionsService.rawOptions.wordSeparator.indexOf(_.getChars())>=0}_selectLineAt(_){let S=this._bufferService.buffer.getWrappedRangeForLine(_),L={start:{x:0,y:S.first},end:{x:this._bufferService.cols-1,y:S.last}};this._model.selectionStart=[0,S.first],this._model.selectionEnd=void 0,this._model.selectionStartLength=(0,a.getRangeLength)(L,this._bufferService.cols)}};i.SelectionService=x=c([p(3,m.IBufferService),p(4,m.ICoreService),p(5,w.IMouseService),p(6,m.IOptionsService),p(7,w.IRenderService),p(8,w.ICoreBrowserService)],x)},4725:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.IThemeService=i.ICharacterJoinerService=i.ISelectionService=i.IRenderService=i.IMouseService=i.ICoreBrowserService=i.ICharSizeService=void 0;let c=o(8343);i.ICharSizeService=(0,c.createDecorator)("CharSizeService"),i.ICoreBrowserService=(0,c.createDecorator)("CoreBrowserService"),i.IMouseService=(0,c.createDecorator)("MouseService"),i.IRenderService=(0,c.createDecorator)("RenderService"),i.ISelectionService=(0,c.createDecorator)("SelectionService"),i.ICharacterJoinerService=(0,c.createDecorator)("CharacterJoinerService"),i.IThemeService=(0,c.createDecorator)("ThemeService")},6731:function(u,i,o){var c=this&&this.__decorate||function(x,_,S,L){var O,D=arguments.length,M=D<3?_:L===null?L=Object.getOwnPropertyDescriptor(_,S):L;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")M=Reflect.decorate(x,_,S,L);else for(var z=x.length-1;z>=0;z--)(O=x[z])&&(M=(D<3?O(M):D>3?O(_,S,M):O(_,S))||M);return D>3&&M&&Object.defineProperty(_,S,M),M},p=this&&this.__param||function(x,_){return function(S,L){_(S,L,x)}};Object.defineProperty(i,"__esModule",{value:!0}),i.ThemeService=i.DEFAULT_ANSI_COLORS=void 0;let d=o(7239),f=o(8055),g=o(8460),w=o(844),b=o(2585),r=f.css.toColor("#ffffff"),l=f.css.toColor("#000000"),a=f.css.toColor("#ffffff"),h=f.css.toColor("#000000"),m={css:"rgba(255, 255, 255, 0.3)",rgba:4294967117};i.DEFAULT_ANSI_COLORS=Object.freeze((()=>{let x=[f.css.toColor("#2e3436"),f.css.toColor("#cc0000"),f.css.toColor("#4e9a06"),f.css.toColor("#c4a000"),f.css.toColor("#3465a4"),f.css.toColor("#75507b"),f.css.toColor("#06989a"),f.css.toColor("#d3d7cf"),f.css.toColor("#555753"),f.css.toColor("#ef2929"),f.css.toColor("#8ae234"),f.css.toColor("#fce94f"),f.css.toColor("#729fcf"),f.css.toColor("#ad7fa8"),f.css.toColor("#34e2e2"),f.css.toColor("#eeeeec")],_=[0,95,135,175,215,255];for(let S=0;S<216;S++){let L=_[S/36%6|0],O=_[S/6%6|0],D=_[S%6];x.push({css:f.channels.toCss(L,O,D),rgba:f.channels.toRgba(L,O,D)})}for(let S=0;S<24;S++){let L=8+10*S;x.push({css:f.channels.toCss(L,L,L),rgba:f.channels.toRgba(L,L,L)})}return x})());let v=i.ThemeService=class extends w.Disposable{get colors(){return this._colors}constructor(x){super(),this._optionsService=x,this._contrastCache=new d.ColorContrastCache,this._halfContrastCache=new d.ColorContrastCache,this._onChangeColors=this.register(new g.EventEmitter),this.onChangeColors=this._onChangeColors.event,this._colors={foreground:r,background:l,cursor:a,cursorAccent:h,selectionForeground:void 0,selectionBackgroundTransparent:m,selectionBackgroundOpaque:f.color.blend(l,m),selectionInactiveBackgroundTransparent:m,selectionInactiveBackgroundOpaque:f.color.blend(l,m),ansi:i.DEFAULT_ANSI_COLORS.slice(),contrastCache:this._contrastCache,halfContrastCache:this._halfContrastCache},this._updateRestoreColors(),this._setTheme(this._optionsService.rawOptions.theme),this.register(this._optionsService.onSpecificOptionChange("minimumContrastRatio",(()=>this._contrastCache.clear()))),this.register(this._optionsService.onSpecificOptionChange("theme",(()=>this._setTheme(this._optionsService.rawOptions.theme))))}_setTheme(x={}){let _=this._colors;if(_.foreground=y(x.foreground,r),_.background=y(x.background,l),_.cursor=y(x.cursor,a),_.cursorAccent=y(x.cursorAccent,h),_.selectionBackgroundTransparent=y(x.selectionBackground,m),_.selectionBackgroundOpaque=f.color.blend(_.background,_.selectionBackgroundTransparent),_.selectionInactiveBackgroundTransparent=y(x.selectionInactiveBackground,_.selectionBackgroundTransparent),_.selectionInactiveBackgroundOpaque=f.color.blend(_.background,_.selectionInactiveBackgroundTransparent),_.selectionForeground=x.selectionForeground?y(x.selectionForeground,f.NULL_COLOR):void 0,_.selectionForeground===f.NULL_COLOR&&(_.selectionForeground=void 0),f.color.isOpaque(_.selectionBackgroundTransparent)&&(_.selectionBackgroundTransparent=f.color.opacity(_.selectionBackgroundTransparent,.3)),f.color.isOpaque(_.selectionInactiveBackgroundTransparent)&&(_.selectionInactiveBackgroundTransparent=f.color.opacity(_.selectionInactiveBackgroundTransparent,.3)),_.ansi=i.DEFAULT_ANSI_COLORS.slice(),_.ansi[0]=y(x.black,i.DEFAULT_ANSI_COLORS[0]),_.ansi[1]=y(x.red,i.DEFAULT_ANSI_COLORS[1]),_.ansi[2]=y(x.green,i.DEFAULT_ANSI_COLORS[2]),_.ansi[3]=y(x.yellow,i.DEFAULT_ANSI_COLORS[3]),_.ansi[4]=y(x.blue,i.DEFAULT_ANSI_COLORS[4]),_.ansi[5]=y(x.magenta,i.DEFAULT_ANSI_COLORS[5]),_.ansi[6]=y(x.cyan,i.DEFAULT_ANSI_COLORS[6]),_.ansi[7]=y(x.white,i.DEFAULT_ANSI_COLORS[7]),_.ansi[8]=y(x.brightBlack,i.DEFAULT_ANSI_COLORS[8]),_.ansi[9]=y(x.brightRed,i.DEFAULT_ANSI_COLORS[9]),_.ansi[10]=y(x.brightGreen,i.DEFAULT_ANSI_COLORS[10]),_.ansi[11]=y(x.brightYellow,i.DEFAULT_ANSI_COLORS[11]),_.ansi[12]=y(x.brightBlue,i.DEFAULT_ANSI_COLORS[12]),_.ansi[13]=y(x.brightMagenta,i.DEFAULT_ANSI_COLORS[13]),_.ansi[14]=y(x.brightCyan,i.DEFAULT_ANSI_COLORS[14]),_.ansi[15]=y(x.brightWhite,i.DEFAULT_ANSI_COLORS[15]),x.extendedAnsi){let S=Math.min(_.ansi.length-16,x.extendedAnsi.length);for(let L=0;L<S;L++)_.ansi[L+16]=y(x.extendedAnsi[L],i.DEFAULT_ANSI_COLORS[L+16])}this._contrastCache.clear(),this._halfContrastCache.clear(),this._updateRestoreColors(),this._onChangeColors.fire(this.colors)}restoreColor(x){this._restoreColor(x),this._onChangeColors.fire(this.colors)}_restoreColor(x){if(x!==void 0)switch(x){case 256:this._colors.foreground=this._restoreColors.foreground;break;case 257:this._colors.background=this._restoreColors.background;break;case 258:this._colors.cursor=this._restoreColors.cursor;break;default:this._colors.ansi[x]=this._restoreColors.ansi[x]}else for(let _=0;_<this._restoreColors.ansi.length;++_)this._colors.ansi[_]=this._restoreColors.ansi[_]}modifyColors(x){x(this._colors),this._onChangeColors.fire(this.colors)}_updateRestoreColors(){this._restoreColors={foreground:this._colors.foreground,background:this._colors.background,cursor:this._colors.cursor,ansi:this._colors.ansi.slice()}}};function y(x,_){if(x!==void 0)try{return f.css.toColor(x)}catch{}return _}i.ThemeService=v=c([p(0,b.IOptionsService)],v)},6349:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CircularList=void 0;let c=o(8460),p=o(844);class d extends p.Disposable{constructor(g){super(),this._maxLength=g,this.onDeleteEmitter=this.register(new c.EventEmitter),this.onDelete=this.onDeleteEmitter.event,this.onInsertEmitter=this.register(new c.EventEmitter),this.onInsert=this.onInsertEmitter.event,this.onTrimEmitter=this.register(new c.EventEmitter),this.onTrim=this.onTrimEmitter.event,this._array=new Array(this._maxLength),this._startIndex=0,this._length=0}get maxLength(){return this._maxLength}set maxLength(g){if(this._maxLength===g)return;let w=new Array(g);for(let b=0;b<Math.min(g,this.length);b++)w[b]=this._array[this._getCyclicIndex(b)];this._array=w,this._maxLength=g,this._startIndex=0}get length(){return this._length}set length(g){if(g>this._length)for(let w=this._length;w<g;w++)this._array[w]=void 0;this._length=g}get(g){return this._array[this._getCyclicIndex(g)]}set(g,w){this._array[this._getCyclicIndex(g)]=w}push(g){this._array[this._getCyclicIndex(this._length)]=g,this._length===this._maxLength?(this._startIndex=++this._startIndex%this._maxLength,this.onTrimEmitter.fire(1)):this._length++}recycle(){if(this._length!==this._maxLength)throw new Error("Can only recycle when the buffer is full");return this._startIndex=++this._startIndex%this._maxLength,this.onTrimEmitter.fire(1),this._array[this._getCyclicIndex(this._length-1)]}get isFull(){return this._length===this._maxLength}pop(){return this._array[this._getCyclicIndex(this._length---1)]}splice(g,w,...b){if(w){for(let r=g;r<this._length-w;r++)this._array[this._getCyclicIndex(r)]=this._array[this._getCyclicIndex(r+w)];this._length-=w,this.onDeleteEmitter.fire({index:g,amount:w})}for(let r=this._length-1;r>=g;r--)this._array[this._getCyclicIndex(r+b.length)]=this._array[this._getCyclicIndex(r)];for(let r=0;r<b.length;r++)this._array[this._getCyclicIndex(g+r)]=b[r];if(b.length&&this.onInsertEmitter.fire({index:g,amount:b.length}),this._length+b.length>this._maxLength){let r=this._length+b.length-this._maxLength;this._startIndex+=r,this._length=this._maxLength,this.onTrimEmitter.fire(r)}else this._length+=b.length}trimStart(g){g>this._length&&(g=this._length),this._startIndex+=g,this._length-=g,this.onTrimEmitter.fire(g)}shiftElements(g,w,b){if(!(w<=0)){if(g<0||g>=this._length)throw new Error("start argument out of range");if(g+b<0)throw new Error("Cannot shift elements in list beyond index 0");if(b>0){for(let l=w-1;l>=0;l--)this.set(g+l+b,this.get(g+l));let r=g+w+b-this._length;if(r>0)for(this._length+=r;this._length>this._maxLength;)this._length--,this._startIndex++,this.onTrimEmitter.fire(1)}else for(let r=0;r<w;r++)this.set(g+r+b,this.get(g+r))}}_getCyclicIndex(g){return(this._startIndex+g)%this._maxLength}}i.CircularList=d},1439:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.clone=void 0,i.clone=function o(c,p=5){if(typeof c!="object")return c;let d=Array.isArray(c)?[]:{};for(let f in c)d[f]=p<=1?c[f]:c[f]&&o(c[f],p-1);return d}},8055:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.contrastRatio=i.toPaddedHex=i.rgba=i.rgb=i.css=i.color=i.channels=i.NULL_COLOR=void 0;let c=o(6114),p=0,d=0,f=0,g=0;var w,b,r,l,a;function h(v){let y=v.toString(16);return y.length<2?"0"+y:y}function m(v,y){return v<y?(y+.05)/(v+.05):(v+.05)/(y+.05)}i.NULL_COLOR={css:"#00000000",rgba:0},(function(v){v.toCss=function(y,x,_,S){return S!==void 0?`#${h(y)}${h(x)}${h(_)}${h(S)}`:`#${h(y)}${h(x)}${h(_)}`},v.toRgba=function(y,x,_,S=255){return(y<<24|x<<16|_<<8|S)>>>0}})(w||(i.channels=w={})),(function(v){function y(x,_){return g=Math.round(255*_),[p,d,f]=a.toChannels(x.rgba),{css:w.toCss(p,d,f,g),rgba:w.toRgba(p,d,f,g)}}v.blend=function(x,_){if(g=(255&_.rgba)/255,g===1)return{css:_.css,rgba:_.rgba};let S=_.rgba>>24&255,L=_.rgba>>16&255,O=_.rgba>>8&255,D=x.rgba>>24&255,M=x.rgba>>16&255,z=x.rgba>>8&255;return p=D+Math.round((S-D)*g),d=M+Math.round((L-M)*g),f=z+Math.round((O-z)*g),{css:w.toCss(p,d,f),rgba:w.toRgba(p,d,f)}},v.isOpaque=function(x){return(255&x.rgba)==255},v.ensureContrastRatio=function(x,_,S){let L=a.ensureContrastRatio(x.rgba,_.rgba,S);if(L)return a.toColor(L>>24&255,L>>16&255,L>>8&255)},v.opaque=function(x){let _=(255|x.rgba)>>>0;return[p,d,f]=a.toChannels(_),{css:w.toCss(p,d,f),rgba:_}},v.opacity=y,v.multiplyOpacity=function(x,_){return g=255&x.rgba,y(x,g*_/255)},v.toColorRGB=function(x){return[x.rgba>>24&255,x.rgba>>16&255,x.rgba>>8&255]}})(b||(i.color=b={})),(function(v){let y,x;if(!c.isNode){let _=document.createElement("canvas");_.width=1,_.height=1;let S=_.getContext("2d",{willReadFrequently:!0});S&&(y=S,y.globalCompositeOperation="copy",x=y.createLinearGradient(0,0,1,1))}v.toColor=function(_){if(_.match(/#[\da-f]{3,8}/i))switch(_.length){case 4:return p=parseInt(_.slice(1,2).repeat(2),16),d=parseInt(_.slice(2,3).repeat(2),16),f=parseInt(_.slice(3,4).repeat(2),16),a.toColor(p,d,f);case 5:return p=parseInt(_.slice(1,2).repeat(2),16),d=parseInt(_.slice(2,3).repeat(2),16),f=parseInt(_.slice(3,4).repeat(2),16),g=parseInt(_.slice(4,5).repeat(2),16),a.toColor(p,d,f,g);case 7:return{css:_,rgba:(parseInt(_.slice(1),16)<<8|255)>>>0};case 9:return{css:_,rgba:parseInt(_.slice(1),16)>>>0}}let S=_.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*(0|1|\d?\.(\d+))\s*)?\)/);if(S)return p=parseInt(S[1]),d=parseInt(S[2]),f=parseInt(S[3]),g=Math.round(255*(S[5]===void 0?1:parseFloat(S[5]))),a.toColor(p,d,f,g);if(!y||!x)throw new Error("css.toColor: Unsupported css format");if(y.fillStyle=x,y.fillStyle=_,typeof y.fillStyle!="string")throw new Error("css.toColor: Unsupported css format");if(y.fillRect(0,0,1,1),[p,d,f,g]=y.getImageData(0,0,1,1).data,g!==255)throw new Error("css.toColor: Unsupported css format");return{rgba:w.toRgba(p,d,f,g),css:_}}})(r||(i.css=r={})),(function(v){function y(x,_,S){let L=x/255,O=_/255,D=S/255;return .2126*(L<=.03928?L/12.92:Math.pow((L+.055)/1.055,2.4))+.7152*(O<=.03928?O/12.92:Math.pow((O+.055)/1.055,2.4))+.0722*(D<=.03928?D/12.92:Math.pow((D+.055)/1.055,2.4))}v.relativeLuminance=function(x){return y(x>>16&255,x>>8&255,255&x)},v.relativeLuminance2=y})(l||(i.rgb=l={})),(function(v){function y(_,S,L){let O=_>>24&255,D=_>>16&255,M=_>>8&255,z=S>>24&255,B=S>>16&255,$=S>>8&255,I=m(l.relativeLuminance2(z,B,$),l.relativeLuminance2(O,D,M));for(;I<L&&(z>0||B>0||$>0);)z-=Math.max(0,Math.ceil(.1*z)),B-=Math.max(0,Math.ceil(.1*B)),$-=Math.max(0,Math.ceil(.1*$)),I=m(l.relativeLuminance2(z,B,$),l.relativeLuminance2(O,D,M));return(z<<24|B<<16|$<<8|255)>>>0}function x(_,S,L){let O=_>>24&255,D=_>>16&255,M=_>>8&255,z=S>>24&255,B=S>>16&255,$=S>>8&255,I=m(l.relativeLuminance2(z,B,$),l.relativeLuminance2(O,D,M));for(;I<L&&(z<255||B<255||$<255);)z=Math.min(255,z+Math.ceil(.1*(255-z))),B=Math.min(255,B+Math.ceil(.1*(255-B))),$=Math.min(255,$+Math.ceil(.1*(255-$))),I=m(l.relativeLuminance2(z,B,$),l.relativeLuminance2(O,D,M));return(z<<24|B<<16|$<<8|255)>>>0}v.ensureContrastRatio=function(_,S,L){let O=l.relativeLuminance(_>>8),D=l.relativeLuminance(S>>8);if(m(O,D)<L){if(D<O){let B=y(_,S,L),$=m(O,l.relativeLuminance(B>>8));if($<L){let I=x(_,S,L);return $>m(O,l.relativeLuminance(I>>8))?B:I}return B}let M=x(_,S,L),z=m(O,l.relativeLuminance(M>>8));if(z<L){let B=y(_,S,L);return z>m(O,l.relativeLuminance(B>>8))?M:B}return M}},v.reduceLuminance=y,v.increaseLuminance=x,v.toChannels=function(_){return[_>>24&255,_>>16&255,_>>8&255,255&_]},v.toColor=function(_,S,L,O){return{css:w.toCss(_,S,L,O),rgba:w.toRgba(_,S,L,O)}}})(a||(i.rgba=a={})),i.toPaddedHex=h,i.contrastRatio=m},8969:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CoreTerminal=void 0;let c=o(844),p=o(2585),d=o(4348),f=o(7866),g=o(744),w=o(7302),b=o(6975),r=o(8460),l=o(1753),a=o(1480),h=o(7994),m=o(9282),v=o(5435),y=o(5981),x=o(2660),_=!1;class S extends c.Disposable{get onScroll(){return this._onScrollApi||(this._onScrollApi=this.register(new r.EventEmitter),this._onScroll.event((O=>{var D;(D=this._onScrollApi)===null||D===void 0||D.fire(O.position)}))),this._onScrollApi.event}get cols(){return this._bufferService.cols}get rows(){return this._bufferService.rows}get buffers(){return this._bufferService.buffers}get options(){return this.optionsService.options}set options(O){for(let D in O)this.optionsService.options[D]=O[D]}constructor(O){super(),this._windowsWrappingHeuristics=this.register(new c.MutableDisposable),this._onBinary=this.register(new r.EventEmitter),this.onBinary=this._onBinary.event,this._onData=this.register(new r.EventEmitter),this.onData=this._onData.event,this._onLineFeed=this.register(new r.EventEmitter),this.onLineFeed=this._onLineFeed.event,this._onResize=this.register(new r.EventEmitter),this.onResize=this._onResize.event,this._onWriteParsed=this.register(new r.EventEmitter),this.onWriteParsed=this._onWriteParsed.event,this._onScroll=this.register(new r.EventEmitter),this._instantiationService=new d.InstantiationService,this.optionsService=this.register(new w.OptionsService(O)),this._instantiationService.setService(p.IOptionsService,this.optionsService),this._bufferService=this.register(this._instantiationService.createInstance(g.BufferService)),this._instantiationService.setService(p.IBufferService,this._bufferService),this._logService=this.register(this._instantiationService.createInstance(f.LogService)),this._instantiationService.setService(p.ILogService,this._logService),this.coreService=this.register(this._instantiationService.createInstance(b.CoreService)),this._instantiationService.setService(p.ICoreService,this.coreService),this.coreMouseService=this.register(this._instantiationService.createInstance(l.CoreMouseService)),this._instantiationService.setService(p.ICoreMouseService,this.coreMouseService),this.unicodeService=this.register(this._instantiationService.createInstance(a.UnicodeService)),this._instantiationService.setService(p.IUnicodeService,this.unicodeService),this._charsetService=this._instantiationService.createInstance(h.CharsetService),this._instantiationService.setService(p.ICharsetService,this._charsetService),this._oscLinkService=this._instantiationService.createInstance(x.OscLinkService),this._instantiationService.setService(p.IOscLinkService,this._oscLinkService),this._inputHandler=this.register(new v.InputHandler(this._bufferService,this._charsetService,this.coreService,this._logService,this.optionsService,this._oscLinkService,this.coreMouseService,this.unicodeService)),this.register((0,r.forwardEvent)(this._inputHandler.onLineFeed,this._onLineFeed)),this.register(this._inputHandler),this.register((0,r.forwardEvent)(this._bufferService.onResize,this._onResize)),this.register((0,r.forwardEvent)(this.coreService.onData,this._onData)),this.register((0,r.forwardEvent)(this.coreService.onBinary,this._onBinary)),this.register(this.coreService.onRequestScrollToBottom((()=>this.scrollToBottom()))),this.register(this.coreService.onUserInput((()=>this._writeBuffer.handleUserInput()))),this.register(this.optionsService.onMultipleOptionChange(["windowsMode","windowsPty"],(()=>this._handleWindowsPtyOptionChange()))),this.register(this._bufferService.onScroll((D=>{this._onScroll.fire({position:this._bufferService.buffer.ydisp,source:0}),this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop,this._bufferService.buffer.scrollBottom)}))),this.register(this._inputHandler.onScroll((D=>{this._onScroll.fire({position:this._bufferService.buffer.ydisp,source:0}),this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop,this._bufferService.buffer.scrollBottom)}))),this._writeBuffer=this.register(new y.WriteBuffer(((D,M)=>this._inputHandler.parse(D,M)))),this.register((0,r.forwardEvent)(this._writeBuffer.onWriteParsed,this._onWriteParsed))}write(O,D){this._writeBuffer.write(O,D)}writeSync(O,D){this._logService.logLevel<=p.LogLevelEnum.WARN&&!_&&(this._logService.warn("writeSync is unreliable and will be removed soon."),_=!0),this._writeBuffer.writeSync(O,D)}resize(O,D){isNaN(O)||isNaN(D)||(O=Math.max(O,g.MINIMUM_COLS),D=Math.max(D,g.MINIMUM_ROWS),this._bufferService.resize(O,D))}scroll(O,D=!1){this._bufferService.scroll(O,D)}scrollLines(O,D,M){this._bufferService.scrollLines(O,D,M)}scrollPages(O){this.scrollLines(O*(this.rows-1))}scrollToTop(){this.scrollLines(-this._bufferService.buffer.ydisp)}scrollToBottom(){this.scrollLines(this._bufferService.buffer.ybase-this._bufferService.buffer.ydisp)}scrollToLine(O){let D=O-this._bufferService.buffer.ydisp;D!==0&&this.scrollLines(D)}registerEscHandler(O,D){return this._inputHandler.registerEscHandler(O,D)}registerDcsHandler(O,D){return this._inputHandler.registerDcsHandler(O,D)}registerCsiHandler(O,D){return this._inputHandler.registerCsiHandler(O,D)}registerOscHandler(O,D){return this._inputHandler.registerOscHandler(O,D)}_setup(){this._handleWindowsPtyOptionChange()}reset(){this._inputHandler.reset(),this._bufferService.reset(),this._charsetService.reset(),this.coreService.reset(),this.coreMouseService.reset()}_handleWindowsPtyOptionChange(){let O=!1,D=this.optionsService.rawOptions.windowsPty;D&&D.buildNumber!==void 0&&D.buildNumber!==void 0?O=D.backend==="conpty"&&D.buildNumber<21376:this.optionsService.rawOptions.windowsMode&&(O=!0),O?this._enableWindowsWrappingHeuristics():this._windowsWrappingHeuristics.clear()}_enableWindowsWrappingHeuristics(){if(!this._windowsWrappingHeuristics.value){let O=[];O.push(this.onLineFeed(m.updateWindowsModeWrappedState.bind(null,this._bufferService))),O.push(this.registerCsiHandler({final:"H"},(()=>((0,m.updateWindowsModeWrappedState)(this._bufferService),!1)))),this._windowsWrappingHeuristics.value=(0,c.toDisposable)((()=>{for(let D of O)D.dispose()}))}}}i.CoreTerminal=S},8460:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.forwardEvent=i.EventEmitter=void 0,i.EventEmitter=class{constructor(){this._listeners=[],this._disposed=!1}get event(){return this._event||(this._event=o=>(this._listeners.push(o),{dispose:()=>{if(!this._disposed){for(let c=0;c<this._listeners.length;c++)if(this._listeners[c]===o)return void this._listeners.splice(c,1)}}})),this._event}fire(o,c){let p=[];for(let d=0;d<this._listeners.length;d++)p.push(this._listeners[d]);for(let d=0;d<p.length;d++)p[d].call(void 0,o,c)}dispose(){this.clearListeners(),this._disposed=!0}clearListeners(){this._listeners&&(this._listeners.length=0)}},i.forwardEvent=function(o,c){return o((p=>c.fire(p)))}},5435:function(u,i,o){var c=this&&this.__decorate||function(I,C,E,A){var R,N=arguments.length,j=N<3?C:A===null?A=Object.getOwnPropertyDescriptor(C,E):A;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")j=Reflect.decorate(I,C,E,A);else for(var G=I.length-1;G>=0;G--)(R=I[G])&&(j=(N<3?R(j):N>3?R(C,E,j):R(C,E))||j);return N>3&&j&&Object.defineProperty(C,E,j),j},p=this&&this.__param||function(I,C){return function(E,A){C(E,A,I)}};Object.defineProperty(i,"__esModule",{value:!0}),i.InputHandler=i.WindowsOptionsReportType=void 0;let d=o(2584),f=o(7116),g=o(2015),w=o(844),b=o(482),r=o(8437),l=o(8460),a=o(643),h=o(511),m=o(3734),v=o(2585),y=o(6242),x=o(6351),_=o(5941),S={"(":0,")":1,"*":2,"+":3,"-":1,".":2},L=131072;function O(I,C){if(I>24)return C.setWinLines||!1;switch(I){case 1:return!!C.restoreWin;case 2:return!!C.minimizeWin;case 3:return!!C.setWinPosition;case 4:return!!C.setWinSizePixels;case 5:return!!C.raiseWin;case 6:return!!C.lowerWin;case 7:return!!C.refreshWin;case 8:return!!C.setWinSizeChars;case 9:return!!C.maximizeWin;case 10:return!!C.fullscreenWin;case 11:return!!C.getWinState;case 13:return!!C.getWinPosition;case 14:return!!C.getWinSizePixels;case 15:return!!C.getScreenSizePixels;case 16:return!!C.getCellSizePixels;case 18:return!!C.getWinSizeChars;case 19:return!!C.getScreenSizeChars;case 20:return!!C.getIconTitle;case 21:return!!C.getWinTitle;case 22:return!!C.pushTitle;case 23:return!!C.popTitle;case 24:return!!C.setWinLines}return!1}var D;(function(I){I[I.GET_WIN_SIZE_PIXELS=0]="GET_WIN_SIZE_PIXELS",I[I.GET_CELL_SIZE_PIXELS=1]="GET_CELL_SIZE_PIXELS"})(D||(i.WindowsOptionsReportType=D={}));let M=0;class z extends w.Disposable{getAttrData(){return this._curAttrData}constructor(C,E,A,R,N,j,G,K,he=new g.EscapeSequenceParser){super(),this._bufferService=C,this._charsetService=E,this._coreService=A,this._logService=R,this._optionsService=N,this._oscLinkService=j,this._coreMouseService=G,this._unicodeService=K,this._parser=he,this._parseBuffer=new Uint32Array(4096),this._stringDecoder=new b.StringToUtf32,this._utf8Decoder=new b.Utf8ToUtf32,this._workCell=new h.CellData,this._windowTitle="",this._iconName="",this._windowTitleStack=[],this._iconNameStack=[],this._curAttrData=r.DEFAULT_ATTR_DATA.clone(),this._eraseAttrDataInternal=r.DEFAULT_ATTR_DATA.clone(),this._onRequestBell=this.register(new l.EventEmitter),this.onRequestBell=this._onRequestBell.event,this._onRequestRefreshRows=this.register(new l.EventEmitter),this.onRequestRefreshRows=this._onRequestRefreshRows.event,this._onRequestReset=this.register(new l.EventEmitter),this.onRequestReset=this._onRequestReset.event,this._onRequestSendFocus=this.register(new l.EventEmitter),this.onRequestSendFocus=this._onRequestSendFocus.event,this._onRequestSyncScrollBar=this.register(new l.EventEmitter),this.onRequestSyncScrollBar=this._onRequestSyncScrollBar.event,this._onRequestWindowsOptionsReport=this.register(new l.EventEmitter),this.onRequestWindowsOptionsReport=this._onRequestWindowsOptionsReport.event,this._onA11yChar=this.register(new l.EventEmitter),this.onA11yChar=this._onA11yChar.event,this._onA11yTab=this.register(new l.EventEmitter),this.onA11yTab=this._onA11yTab.event,this._onCursorMove=this.register(new l.EventEmitter),this.onCursorMove=this._onCursorMove.event,this._onLineFeed=this.register(new l.EventEmitter),this.onLineFeed=this._onLineFeed.event,this._onScroll=this.register(new l.EventEmitter),this.onScroll=this._onScroll.event,this._onTitleChange=this.register(new l.EventEmitter),this.onTitleChange=this._onTitleChange.event,this._onColor=this.register(new l.EventEmitter),this.onColor=this._onColor.event,this._parseStack={paused:!1,cursorStartX:0,cursorStartY:0,decodedLength:0,position:0},this._specialColors=[256,257,258],this.register(this._parser),this._dirtyRowTracker=new B(this._bufferService),this._activeBuffer=this._bufferService.buffer,this.register(this._bufferService.buffers.onBufferActivate((k=>this._activeBuffer=k.activeBuffer))),this._parser.setCsiHandlerFallback(((k,F)=>{this._logService.debug("Unknown CSI code: ",{identifier:this._parser.identToString(k),params:F.toArray()})})),this._parser.setEscHandlerFallback((k=>{this._logService.debug("Unknown ESC code: ",{identifier:this._parser.identToString(k)})})),this._parser.setExecuteHandlerFallback((k=>{this._logService.debug("Unknown EXECUTE code: ",{code:k})})),this._parser.setOscHandlerFallback(((k,F,U)=>{this._logService.debug("Unknown OSC code: ",{identifier:k,action:F,data:U})})),this._parser.setDcsHandlerFallback(((k,F,U)=>{F==="HOOK"&&(U=U.toArray()),this._logService.debug("Unknown DCS code: ",{identifier:this._parser.identToString(k),action:F,payload:U})})),this._parser.setPrintHandler(((k,F,U)=>this.print(k,F,U))),this._parser.registerCsiHandler({final:"@"},(k=>this.insertChars(k))),this._parser.registerCsiHandler({intermediates:" ",final:"@"},(k=>this.scrollLeft(k))),this._parser.registerCsiHandler({final:"A"},(k=>this.cursorUp(k))),this._parser.registerCsiHandler({intermediates:" ",final:"A"},(k=>this.scrollRight(k))),this._parser.registerCsiHandler({final:"B"},(k=>this.cursorDown(k))),this._parser.registerCsiHandler({final:"C"},(k=>this.cursorForward(k))),this._parser.registerCsiHandler({final:"D"},(k=>this.cursorBackward(k))),this._parser.registerCsiHandler({final:"E"},(k=>this.cursorNextLine(k))),this._parser.registerCsiHandler({final:"F"},(k=>this.cursorPrecedingLine(k))),this._parser.registerCsiHandler({final:"G"},(k=>this.cursorCharAbsolute(k))),this._parser.registerCsiHandler({final:"H"},(k=>this.cursorPosition(k))),this._parser.registerCsiHandler({final:"I"},(k=>this.cursorForwardTab(k))),this._parser.registerCsiHandler({final:"J"},(k=>this.eraseInDisplay(k,!1))),this._parser.registerCsiHandler({prefix:"?",final:"J"},(k=>this.eraseInDisplay(k,!0))),this._parser.registerCsiHandler({final:"K"},(k=>this.eraseInLine(k,!1))),this._parser.registerCsiHandler({prefix:"?",final:"K"},(k=>this.eraseInLine(k,!0))),this._parser.registerCsiHandler({final:"L"},(k=>this.insertLines(k))),this._parser.registerCsiHandler({final:"M"},(k=>this.deleteLines(k))),this._parser.registerCsiHandler({final:"P"},(k=>this.deleteChars(k))),this._parser.registerCsiHandler({final:"S"},(k=>this.scrollUp(k))),this._parser.registerCsiHandler({final:"T"},(k=>this.scrollDown(k))),this._parser.registerCsiHandler({final:"X"},(k=>this.eraseChars(k))),this._parser.registerCsiHandler({final:"Z"},(k=>this.cursorBackwardTab(k))),this._parser.registerCsiHandler({final:"`"},(k=>this.charPosAbsolute(k))),this._parser.registerCsiHandler({final:"a"},(k=>this.hPositionRelative(k))),this._parser.registerCsiHandler({final:"b"},(k=>this.repeatPrecedingCharacter(k))),this._parser.registerCsiHandler({final:"c"},(k=>this.sendDeviceAttributesPrimary(k))),this._parser.registerCsiHandler({prefix:">",final:"c"},(k=>this.sendDeviceAttributesSecondary(k))),this._parser.registerCsiHandler({final:"d"},(k=>this.linePosAbsolute(k))),this._parser.registerCsiHandler({final:"e"},(k=>this.vPositionRelative(k))),this._parser.registerCsiHandler({final:"f"},(k=>this.hVPosition(k))),this._parser.registerCsiHandler({final:"g"},(k=>this.tabClear(k))),this._parser.registerCsiHandler({final:"h"},(k=>this.setMode(k))),this._parser.registerCsiHandler({prefix:"?",final:"h"},(k=>this.setModePrivate(k))),this._parser.registerCsiHandler({final:"l"},(k=>this.resetMode(k))),this._parser.registerCsiHandler({prefix:"?",final:"l"},(k=>this.resetModePrivate(k))),this._parser.registerCsiHandler({final:"m"},(k=>this.charAttributes(k))),this._parser.registerCsiHandler({final:"n"},(k=>this.deviceStatus(k))),this._parser.registerCsiHandler({prefix:"?",final:"n"},(k=>this.deviceStatusPrivate(k))),this._parser.registerCsiHandler({intermediates:"!",final:"p"},(k=>this.softReset(k))),this._parser.registerCsiHandler({intermediates:" ",final:"q"},(k=>this.setCursorStyle(k))),this._parser.registerCsiHandler({final:"r"},(k=>this.setScrollRegion(k))),this._parser.registerCsiHandler({final:"s"},(k=>this.saveCursor(k))),this._parser.registerCsiHandler({final:"t"},(k=>this.windowOptions(k))),this._parser.registerCsiHandler({final:"u"},(k=>this.restoreCursor(k))),this._parser.registerCsiHandler({intermediates:"'",final:"}"},(k=>this.insertColumns(k))),this._parser.registerCsiHandler({intermediates:"'",final:"~"},(k=>this.deleteColumns(k))),this._parser.registerCsiHandler({intermediates:'"',final:"q"},(k=>this.selectProtected(k))),this._parser.registerCsiHandler({intermediates:"$",final:"p"},(k=>this.requestMode(k,!0))),this._parser.registerCsiHandler({prefix:"?",intermediates:"$",final:"p"},(k=>this.requestMode(k,!1))),this._parser.setExecuteHandler(d.C0.BEL,(()=>this.bell())),this._parser.setExecuteHandler(d.C0.LF,(()=>this.lineFeed())),this._parser.setExecuteHandler(d.C0.VT,(()=>this.lineFeed())),this._parser.setExecuteHandler(d.C0.FF,(()=>this.lineFeed())),this._parser.setExecuteHandler(d.C0.CR,(()=>this.carriageReturn())),this._parser.setExecuteHandler(d.C0.BS,(()=>this.backspace())),this._parser.setExecuteHandler(d.C0.HT,(()=>this.tab())),this._parser.setExecuteHandler(d.C0.SO,(()=>this.shiftOut())),this._parser.setExecuteHandler(d.C0.SI,(()=>this.shiftIn())),this._parser.setExecuteHandler(d.C1.IND,(()=>this.index())),this._parser.setExecuteHandler(d.C1.NEL,(()=>this.nextLine())),this._parser.setExecuteHandler(d.C1.HTS,(()=>this.tabSet())),this._parser.registerOscHandler(0,new y.OscHandler((k=>(this.setTitle(k),this.setIconName(k),!0)))),this._parser.registerOscHandler(1,new y.OscHandler((k=>this.setIconName(k)))),this._parser.registerOscHandler(2,new y.OscHandler((k=>this.setTitle(k)))),this._parser.registerOscHandler(4,new y.OscHandler((k=>this.setOrReportIndexedColor(k)))),this._parser.registerOscHandler(8,new y.OscHandler((k=>this.setHyperlink(k)))),this._parser.registerOscHandler(10,new y.OscHandler((k=>this.setOrReportFgColor(k)))),this._parser.registerOscHandler(11,new y.OscHandler((k=>this.setOrReportBgColor(k)))),this._parser.registerOscHandler(12,new y.OscHandler((k=>this.setOrReportCursorColor(k)))),this._parser.registerOscHandler(104,new y.OscHandler((k=>this.restoreIndexedColor(k)))),this._parser.registerOscHandler(110,new y.OscHandler((k=>this.restoreFgColor(k)))),this._parser.registerOscHandler(111,new y.OscHandler((k=>this.restoreBgColor(k)))),this._parser.registerOscHandler(112,new y.OscHandler((k=>this.restoreCursorColor(k)))),this._parser.registerEscHandler({final:"7"},(()=>this.saveCursor())),this._parser.registerEscHandler({final:"8"},(()=>this.restoreCursor())),this._parser.registerEscHandler({final:"D"},(()=>this.index())),this._parser.registerEscHandler({final:"E"},(()=>this.nextLine())),this._parser.registerEscHandler({final:"H"},(()=>this.tabSet())),this._parser.registerEscHandler({final:"M"},(()=>this.reverseIndex())),this._parser.registerEscHandler({final:"="},(()=>this.keypadApplicationMode())),this._parser.registerEscHandler({final:">"},(()=>this.keypadNumericMode())),this._parser.registerEscHandler({final:"c"},(()=>this.fullReset())),this._parser.registerEscHandler({final:"n"},(()=>this.setgLevel(2))),this._parser.registerEscHandler({final:"o"},(()=>this.setgLevel(3))),this._parser.registerEscHandler({final:"|"},(()=>this.setgLevel(3))),this._parser.registerEscHandler({final:"}"},(()=>this.setgLevel(2))),this._parser.registerEscHandler({final:"~"},(()=>this.setgLevel(1))),this._parser.registerEscHandler({intermediates:"%",final:"@"},(()=>this.selectDefaultCharset())),this._parser.registerEscHandler({intermediates:"%",final:"G"},(()=>this.selectDefaultCharset()));for(let k in f.CHARSETS)this._parser.registerEscHandler({intermediates:"(",final:k},(()=>this.selectCharset("("+k))),this._parser.registerEscHandler({intermediates:")",final:k},(()=>this.selectCharset(")"+k))),this._parser.registerEscHandler({intermediates:"*",final:k},(()=>this.selectCharset("*"+k))),this._parser.registerEscHandler({intermediates:"+",final:k},(()=>this.selectCharset("+"+k))),this._parser.registerEscHandler({intermediates:"-",final:k},(()=>this.selectCharset("-"+k))),this._parser.registerEscHandler({intermediates:".",final:k},(()=>this.selectCharset("."+k))),this._parser.registerEscHandler({intermediates:"/",final:k},(()=>this.selectCharset("/"+k)));this._parser.registerEscHandler({intermediates:"#",final:"8"},(()=>this.screenAlignmentPattern())),this._parser.setErrorHandler((k=>(this._logService.error("Parsing error: ",k),k))),this._parser.registerDcsHandler({intermediates:"$",final:"q"},new x.DcsHandler(((k,F)=>this.requestStatusString(k,F))))}_preserveStack(C,E,A,R){this._parseStack.paused=!0,this._parseStack.cursorStartX=C,this._parseStack.cursorStartY=E,this._parseStack.decodedLength=A,this._parseStack.position=R}_logSlowResolvingAsync(C){this._logService.logLevel<=v.LogLevelEnum.WARN&&Promise.race([C,new Promise(((E,A)=>setTimeout((()=>A("#SLOW_TIMEOUT")),5e3)))]).catch((E=>{if(E!=="#SLOW_TIMEOUT")throw E;console.warn("async parser handler taking longer than 5000 ms")}))}_getCurrentLinkId(){return this._curAttrData.extended.urlId}parse(C,E){let A,R=this._activeBuffer.x,N=this._activeBuffer.y,j=0,G=this._parseStack.paused;if(G){if(A=this._parser.parse(this._parseBuffer,this._parseStack.decodedLength,E))return this._logSlowResolvingAsync(A),A;R=this._parseStack.cursorStartX,N=this._parseStack.cursorStartY,this._parseStack.paused=!1,C.length>L&&(j=this._parseStack.position+L)}if(this._logService.logLevel<=v.LogLevelEnum.DEBUG&&this._logService.debug("parsing data"+(typeof C=="string"?` "${C}"`:` "${Array.prototype.map.call(C,(K=>String.fromCharCode(K))).join("")}"`),typeof C=="string"?C.split("").map((K=>K.charCodeAt(0))):C),this._parseBuffer.length<C.length&&this._parseBuffer.length<L&&(this._parseBuffer=new Uint32Array(Math.min(C.length,L))),G||this._dirtyRowTracker.clearRange(),C.length>L)for(let K=j;K<C.length;K+=L){let he=K+L<C.length?K+L:C.length,k=typeof C=="string"?this._stringDecoder.decode(C.substring(K,he),this._parseBuffer):this._utf8Decoder.decode(C.subarray(K,he),this._parseBuffer);if(A=this._parser.parse(this._parseBuffer,k))return this._preserveStack(R,N,k,K),this._logSlowResolvingAsync(A),A}else if(!G){let K=typeof C=="string"?this._stringDecoder.decode(C,this._parseBuffer):this._utf8Decoder.decode(C,this._parseBuffer);if(A=this._parser.parse(this._parseBuffer,K))return this._preserveStack(R,N,K,0),this._logSlowResolvingAsync(A),A}this._activeBuffer.x===R&&this._activeBuffer.y===N||this._onCursorMove.fire(),this._onRequestRefreshRows.fire(this._dirtyRowTracker.start,this._dirtyRowTracker.end)}print(C,E,A){let R,N,j=this._charsetService.charset,G=this._optionsService.rawOptions.screenReaderMode,K=this._bufferService.cols,he=this._coreService.decPrivateModes.wraparound,k=this._coreService.modes.insertMode,F=this._curAttrData,U=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._activeBuffer.x&&A-E>0&&U.getWidth(this._activeBuffer.x-1)===2&&U.setCellFromCodePoint(this._activeBuffer.x-1,0,1,F.fg,F.bg,F.extended);for(let W=E;W<A;++W){if(R=C[W],N=this._unicodeService.wcwidth(R),R<127&&j){let ee=j[String.fromCharCode(R)];ee&&(R=ee.charCodeAt(0))}if(G&&this._onA11yChar.fire((0,b.stringFromCodePoint)(R)),this._getCurrentLinkId()&&this._oscLinkService.addLineToLink(this._getCurrentLinkId(),this._activeBuffer.ybase+this._activeBuffer.y),N||!this._activeBuffer.x){if(this._activeBuffer.x+N-1>=K){if(he){for(;this._activeBuffer.x<K;)U.setCellFromCodePoint(this._activeBuffer.x++,0,1,F.fg,F.bg,F.extended);this._activeBuffer.x=0,this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData(),!0)):(this._activeBuffer.y>=this._bufferService.rows&&(this._activeBuffer.y=this._bufferService.rows-1),this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!0),U=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y)}else if(this._activeBuffer.x=K-1,N===2)continue}if(k&&(U.insertCells(this._activeBuffer.x,N,this._activeBuffer.getNullCell(F),F),U.getWidth(K-1)===2&&U.setCellFromCodePoint(K-1,a.NULL_CELL_CODE,a.NULL_CELL_WIDTH,F.fg,F.bg,F.extended)),U.setCellFromCodePoint(this._activeBuffer.x++,R,N,F.fg,F.bg,F.extended),N>0)for(;--N;)U.setCellFromCodePoint(this._activeBuffer.x++,0,0,F.fg,F.bg,F.extended)}else U.getWidth(this._activeBuffer.x-1)?U.addCodepointToCell(this._activeBuffer.x-1,R):U.addCodepointToCell(this._activeBuffer.x-2,R)}A-E>0&&(U.loadCell(this._activeBuffer.x-1,this._workCell),this._workCell.getWidth()===2||this._workCell.getCode()>65535?this._parser.precedingCodepoint=0:this._workCell.isCombined()?this._parser.precedingCodepoint=this._workCell.getChars().charCodeAt(0):this._parser.precedingCodepoint=this._workCell.content),this._activeBuffer.x<K&&A-E>0&&U.getWidth(this._activeBuffer.x)===0&&!U.hasContent(this._activeBuffer.x)&&U.setCellFromCodePoint(this._activeBuffer.x,0,1,F.fg,F.bg,F.extended),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}registerCsiHandler(C,E){return C.final!=="t"||C.prefix||C.intermediates?this._parser.registerCsiHandler(C,E):this._parser.registerCsiHandler(C,(A=>!O(A.params[0],this._optionsService.rawOptions.windowOptions)||E(A)))}registerDcsHandler(C,E){return this._parser.registerDcsHandler(C,new x.DcsHandler(E))}registerEscHandler(C,E){return this._parser.registerEscHandler(C,E)}registerOscHandler(C,E){return this._parser.registerOscHandler(C,new y.OscHandler(E))}bell(){return this._onRequestBell.fire(),!0}lineFeed(){return this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._optionsService.rawOptions.convertEol&&(this._activeBuffer.x=0),this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData())):this._activeBuffer.y>=this._bufferService.rows?this._activeBuffer.y=this._bufferService.rows-1:this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!1,this._activeBuffer.x>=this._bufferService.cols&&this._activeBuffer.x--,this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._onLineFeed.fire(),!0}carriageReturn(){return this._activeBuffer.x=0,!0}backspace(){var C;if(!this._coreService.decPrivateModes.reverseWraparound)return this._restrictCursor(),this._activeBuffer.x>0&&this._activeBuffer.x--,!0;if(this._restrictCursor(this._bufferService.cols),this._activeBuffer.x>0)this._activeBuffer.x--;else if(this._activeBuffer.x===0&&this._activeBuffer.y>this._activeBuffer.scrollTop&&this._activeBuffer.y<=this._activeBuffer.scrollBottom&&(!((C=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y))===null||C===void 0)&&C.isWrapped)){this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y).isWrapped=!1,this._activeBuffer.y--,this._activeBuffer.x=this._bufferService.cols-1;let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);E.hasWidth(this._activeBuffer.x)&&!E.hasContent(this._activeBuffer.x)&&this._activeBuffer.x--}return this._restrictCursor(),!0}tab(){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let C=this._activeBuffer.x;return this._activeBuffer.x=this._activeBuffer.nextStop(),this._optionsService.rawOptions.screenReaderMode&&this._onA11yTab.fire(this._activeBuffer.x-C),!0}shiftOut(){return this._charsetService.setgLevel(1),!0}shiftIn(){return this._charsetService.setgLevel(0),!0}_restrictCursor(C=this._bufferService.cols-1){this._activeBuffer.x=Math.min(C,Math.max(0,this._activeBuffer.x)),this._activeBuffer.y=this._coreService.decPrivateModes.origin?Math.min(this._activeBuffer.scrollBottom,Math.max(this._activeBuffer.scrollTop,this._activeBuffer.y)):Math.min(this._bufferService.rows-1,Math.max(0,this._activeBuffer.y)),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}_setCursor(C,E){this._dirtyRowTracker.markDirty(this._activeBuffer.y),this._coreService.decPrivateModes.origin?(this._activeBuffer.x=C,this._activeBuffer.y=this._activeBuffer.scrollTop+E):(this._activeBuffer.x=C,this._activeBuffer.y=E),this._restrictCursor(),this._dirtyRowTracker.markDirty(this._activeBuffer.y)}_moveCursor(C,E){this._restrictCursor(),this._setCursor(this._activeBuffer.x+C,this._activeBuffer.y+E)}cursorUp(C){let E=this._activeBuffer.y-this._activeBuffer.scrollTop;return E>=0?this._moveCursor(0,-Math.min(E,C.params[0]||1)):this._moveCursor(0,-(C.params[0]||1)),!0}cursorDown(C){let E=this._activeBuffer.scrollBottom-this._activeBuffer.y;return E>=0?this._moveCursor(0,Math.min(E,C.params[0]||1)):this._moveCursor(0,C.params[0]||1),!0}cursorForward(C){return this._moveCursor(C.params[0]||1,0),!0}cursorBackward(C){return this._moveCursor(-(C.params[0]||1),0),!0}cursorNextLine(C){return this.cursorDown(C),this._activeBuffer.x=0,!0}cursorPrecedingLine(C){return this.cursorUp(C),this._activeBuffer.x=0,!0}cursorCharAbsolute(C){return this._setCursor((C.params[0]||1)-1,this._activeBuffer.y),!0}cursorPosition(C){return this._setCursor(C.length>=2?(C.params[1]||1)-1:0,(C.params[0]||1)-1),!0}charPosAbsolute(C){return this._setCursor((C.params[0]||1)-1,this._activeBuffer.y),!0}hPositionRelative(C){return this._moveCursor(C.params[0]||1,0),!0}linePosAbsolute(C){return this._setCursor(this._activeBuffer.x,(C.params[0]||1)-1),!0}vPositionRelative(C){return this._moveCursor(0,C.params[0]||1),!0}hVPosition(C){return this.cursorPosition(C),!0}tabClear(C){let E=C.params[0];return E===0?delete this._activeBuffer.tabs[this._activeBuffer.x]:E===3&&(this._activeBuffer.tabs={}),!0}cursorForwardTab(C){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let E=C.params[0]||1;for(;E--;)this._activeBuffer.x=this._activeBuffer.nextStop();return!0}cursorBackwardTab(C){if(this._activeBuffer.x>=this._bufferService.cols)return!0;let E=C.params[0]||1;for(;E--;)this._activeBuffer.x=this._activeBuffer.prevStop();return!0}selectProtected(C){let E=C.params[0];return E===1&&(this._curAttrData.bg|=536870912),E!==2&&E!==0||(this._curAttrData.bg&=-536870913),!0}_eraseInBufferLine(C,E,A,R=!1,N=!1){let j=this._activeBuffer.lines.get(this._activeBuffer.ybase+C);j.replaceCells(E,A,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData(),N),R&&(j.isWrapped=!1)}_resetBufferLine(C,E=!1){let A=this._activeBuffer.lines.get(this._activeBuffer.ybase+C);A&&(A.fill(this._activeBuffer.getNullCell(this._eraseAttrData()),E),this._bufferService.buffer.clearMarkers(this._activeBuffer.ybase+C),A.isWrapped=!1)}eraseInDisplay(C,E=!1){let A;switch(this._restrictCursor(this._bufferService.cols),C.params[0]){case 0:for(A=this._activeBuffer.y,this._dirtyRowTracker.markDirty(A),this._eraseInBufferLine(A++,this._activeBuffer.x,this._bufferService.cols,this._activeBuffer.x===0,E);A<this._bufferService.rows;A++)this._resetBufferLine(A,E);this._dirtyRowTracker.markDirty(A);break;case 1:for(A=this._activeBuffer.y,this._dirtyRowTracker.markDirty(A),this._eraseInBufferLine(A,0,this._activeBuffer.x+1,!0,E),this._activeBuffer.x+1>=this._bufferService.cols&&(this._activeBuffer.lines.get(A+1).isWrapped=!1);A--;)this._resetBufferLine(A,E);this._dirtyRowTracker.markDirty(0);break;case 2:for(A=this._bufferService.rows,this._dirtyRowTracker.markDirty(A-1);A--;)this._resetBufferLine(A,E);this._dirtyRowTracker.markDirty(0);break;case 3:let R=this._activeBuffer.lines.length-this._bufferService.rows;R>0&&(this._activeBuffer.lines.trimStart(R),this._activeBuffer.ybase=Math.max(this._activeBuffer.ybase-R,0),this._activeBuffer.ydisp=Math.max(this._activeBuffer.ydisp-R,0),this._onScroll.fire(0))}return!0}eraseInLine(C,E=!1){switch(this._restrictCursor(this._bufferService.cols),C.params[0]){case 0:this._eraseInBufferLine(this._activeBuffer.y,this._activeBuffer.x,this._bufferService.cols,this._activeBuffer.x===0,E);break;case 1:this._eraseInBufferLine(this._activeBuffer.y,0,this._activeBuffer.x+1,!1,E);break;case 2:this._eraseInBufferLine(this._activeBuffer.y,0,this._bufferService.cols,!0,E)}return this._dirtyRowTracker.markDirty(this._activeBuffer.y),!0}insertLines(C){this._restrictCursor();let E=C.params[0]||1;if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let A=this._activeBuffer.ybase+this._activeBuffer.y,R=this._bufferService.rows-1-this._activeBuffer.scrollBottom,N=this._bufferService.rows-1+this._activeBuffer.ybase-R+1;for(;E--;)this._activeBuffer.lines.splice(N-1,1),this._activeBuffer.lines.splice(A,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y,this._activeBuffer.scrollBottom),this._activeBuffer.x=0,!0}deleteLines(C){this._restrictCursor();let E=C.params[0]||1;if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let A=this._activeBuffer.ybase+this._activeBuffer.y,R;for(R=this._bufferService.rows-1-this._activeBuffer.scrollBottom,R=this._bufferService.rows-1+this._activeBuffer.ybase-R;E--;)this._activeBuffer.lines.splice(A,1),this._activeBuffer.lines.splice(R,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y,this._activeBuffer.scrollBottom),this._activeBuffer.x=0,!0}insertChars(C){this._restrictCursor();let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return E&&(E.insertCells(this._activeBuffer.x,C.params[0]||1,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}deleteChars(C){this._restrictCursor();let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return E&&(E.deleteCells(this._activeBuffer.x,C.params[0]||1,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}scrollUp(C){let E=C.params[0]||1;for(;E--;)this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollTop,1),this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollBottom,0,this._activeBuffer.getBlankLine(this._eraseAttrData()));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollDown(C){let E=C.params[0]||1;for(;E--;)this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollBottom,1),this._activeBuffer.lines.splice(this._activeBuffer.ybase+this._activeBuffer.scrollTop,0,this._activeBuffer.getBlankLine(r.DEFAULT_ATTR_DATA));return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollLeft(C){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=C.params[0]||1;for(let A=this._activeBuffer.scrollTop;A<=this._activeBuffer.scrollBottom;++A){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+A);R.deleteCells(0,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}scrollRight(C){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=C.params[0]||1;for(let A=this._activeBuffer.scrollTop;A<=this._activeBuffer.scrollBottom;++A){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+A);R.insertCells(0,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}insertColumns(C){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=C.params[0]||1;for(let A=this._activeBuffer.scrollTop;A<=this._activeBuffer.scrollBottom;++A){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+A);R.insertCells(this._activeBuffer.x,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}deleteColumns(C){if(this._activeBuffer.y>this._activeBuffer.scrollBottom||this._activeBuffer.y<this._activeBuffer.scrollTop)return!0;let E=C.params[0]||1;for(let A=this._activeBuffer.scrollTop;A<=this._activeBuffer.scrollBottom;++A){let R=this._activeBuffer.lines.get(this._activeBuffer.ybase+A);R.deleteCells(this._activeBuffer.x,E,this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),R.isWrapped=!1}return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom),!0}eraseChars(C){this._restrictCursor();let E=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);return E&&(E.replaceCells(this._activeBuffer.x,this._activeBuffer.x+(C.params[0]||1),this._activeBuffer.getNullCell(this._eraseAttrData()),this._eraseAttrData()),this._dirtyRowTracker.markDirty(this._activeBuffer.y)),!0}repeatPrecedingCharacter(C){if(!this._parser.precedingCodepoint)return!0;let E=C.params[0]||1,A=new Uint32Array(E);for(let R=0;R<E;++R)A[R]=this._parser.precedingCodepoint;return this.print(A,0,A.length),!0}sendDeviceAttributesPrimary(C){return C.params[0]>0||(this._is("xterm")||this._is("rxvt-unicode")||this._is("screen")?this._coreService.triggerDataEvent(d.C0.ESC+"[?1;2c"):this._is("linux")&&this._coreService.triggerDataEvent(d.C0.ESC+"[?6c")),!0}sendDeviceAttributesSecondary(C){return C.params[0]>0||(this._is("xterm")?this._coreService.triggerDataEvent(d.C0.ESC+"[>0;276;0c"):this._is("rxvt-unicode")?this._coreService.triggerDataEvent(d.C0.ESC+"[>85;95;0c"):this._is("linux")?this._coreService.triggerDataEvent(C.params[0]+"c"):this._is("screen")&&this._coreService.triggerDataEvent(d.C0.ESC+"[>83;40003;0c")),!0}_is(C){return(this._optionsService.rawOptions.termName+"").indexOf(C)===0}setMode(C){for(let E=0;E<C.length;E++)switch(C.params[E]){case 4:this._coreService.modes.insertMode=!0;break;case 20:this._optionsService.options.convertEol=!0}return!0}setModePrivate(C){for(let E=0;E<C.length;E++)switch(C.params[E]){case 1:this._coreService.decPrivateModes.applicationCursorKeys=!0;break;case 2:this._charsetService.setgCharset(0,f.DEFAULT_CHARSET),this._charsetService.setgCharset(1,f.DEFAULT_CHARSET),this._charsetService.setgCharset(2,f.DEFAULT_CHARSET),this._charsetService.setgCharset(3,f.DEFAULT_CHARSET);break;case 3:this._optionsService.rawOptions.windowOptions.setWinLines&&(this._bufferService.resize(132,this._bufferService.rows),this._onRequestReset.fire());break;case 6:this._coreService.decPrivateModes.origin=!0,this._setCursor(0,0);break;case 7:this._coreService.decPrivateModes.wraparound=!0;break;case 12:this._optionsService.options.cursorBlink=!0;break;case 45:this._coreService.decPrivateModes.reverseWraparound=!0;break;case 66:this._logService.debug("Serial port requested application keypad."),this._coreService.decPrivateModes.applicationKeypad=!0,this._onRequestSyncScrollBar.fire();break;case 9:this._coreMouseService.activeProtocol="X10";break;case 1e3:this._coreMouseService.activeProtocol="VT200";break;case 1002:this._coreMouseService.activeProtocol="DRAG";break;case 1003:this._coreMouseService.activeProtocol="ANY";break;case 1004:this._coreService.decPrivateModes.sendFocus=!0,this._onRequestSendFocus.fire();break;case 1005:this._logService.debug("DECSET 1005 not supported (see #2507)");break;case 1006:this._coreMouseService.activeEncoding="SGR";break;case 1015:this._logService.debug("DECSET 1015 not supported (see #2507)");break;case 1016:this._coreMouseService.activeEncoding="SGR_PIXELS";break;case 25:this._coreService.isCursorHidden=!1;break;case 1048:this.saveCursor();break;case 1049:this.saveCursor();case 47:case 1047:this._bufferService.buffers.activateAltBuffer(this._eraseAttrData()),this._coreService.isCursorInitialized=!0,this._onRequestRefreshRows.fire(0,this._bufferService.rows-1),this._onRequestSyncScrollBar.fire();break;case 2004:this._coreService.decPrivateModes.bracketedPasteMode=!0}return!0}resetMode(C){for(let E=0;E<C.length;E++)switch(C.params[E]){case 4:this._coreService.modes.insertMode=!1;break;case 20:this._optionsService.options.convertEol=!1}return!0}resetModePrivate(C){for(let E=0;E<C.length;E++)switch(C.params[E]){case 1:this._coreService.decPrivateModes.applicationCursorKeys=!1;break;case 3:this._optionsService.rawOptions.windowOptions.setWinLines&&(this._bufferService.resize(80,this._bufferService.rows),this._onRequestReset.fire());break;case 6:this._coreService.decPrivateModes.origin=!1,this._setCursor(0,0);break;case 7:this._coreService.decPrivateModes.wraparound=!1;break;case 12:this._optionsService.options.cursorBlink=!1;break;case 45:this._coreService.decPrivateModes.reverseWraparound=!1;break;case 66:this._logService.debug("Switching back to normal keypad."),this._coreService.decPrivateModes.applicationKeypad=!1,this._onRequestSyncScrollBar.fire();break;case 9:case 1e3:case 1002:case 1003:this._coreMouseService.activeProtocol="NONE";break;case 1004:this._coreService.decPrivateModes.sendFocus=!1;break;case 1005:this._logService.debug("DECRST 1005 not supported (see #2507)");break;case 1006:case 1016:this._coreMouseService.activeEncoding="DEFAULT";break;case 1015:this._logService.debug("DECRST 1015 not supported (see #2507)");break;case 25:this._coreService.isCursorHidden=!0;break;case 1048:this.restoreCursor();break;case 1049:case 47:case 1047:this._bufferService.buffers.activateNormalBuffer(),C.params[E]===1049&&this.restoreCursor(),this._coreService.isCursorInitialized=!0,this._onRequestRefreshRows.fire(0,this._bufferService.rows-1),this._onRequestSyncScrollBar.fire();break;case 2004:this._coreService.decPrivateModes.bracketedPasteMode=!1}return!0}requestMode(C,E){let A=this._coreService.decPrivateModes,{activeProtocol:R,activeEncoding:N}=this._coreMouseService,j=this._coreService,{buffers:G,cols:K}=this._bufferService,{active:he,alt:k}=G,F=this._optionsService.rawOptions,U=de=>de?1:2,W=C.params[0];return ee=W,V=E?W===2?4:W===4?U(j.modes.insertMode):W===12?3:W===20?U(F.convertEol):0:W===1?U(A.applicationCursorKeys):W===3?F.windowOptions.setWinLines?K===80?2:K===132?1:0:0:W===6?U(A.origin):W===7?U(A.wraparound):W===8?3:W===9?U(R==="X10"):W===12?U(F.cursorBlink):W===25?U(!j.isCursorHidden):W===45?U(A.reverseWraparound):W===66?U(A.applicationKeypad):W===67?4:W===1e3?U(R==="VT200"):W===1002?U(R==="DRAG"):W===1003?U(R==="ANY"):W===1004?U(A.sendFocus):W===1005?4:W===1006?U(N==="SGR"):W===1015?4:W===1016?U(N==="SGR_PIXELS"):W===1048?1:W===47||W===1047||W===1049?U(he===k):W===2004?U(A.bracketedPasteMode):0,j.triggerDataEvent(`${d.C0.ESC}[${E?"":"?"}${ee};${V}$y`),!0;var ee,V}_updateAttrColor(C,E,A,R,N){return E===2?(C|=50331648,C&=-16777216,C|=m.AttributeData.fromColorRGB([A,R,N])):E===5&&(C&=-50331904,C|=33554432|255&A),C}_extractColor(C,E,A){let R=[0,0,-1,0,0,0],N=0,j=0;do{if(R[j+N]=C.params[E+j],C.hasSubParams(E+j)){let G=C.getSubParams(E+j),K=0;do R[1]===5&&(N=1),R[j+K+1+N]=G[K];while(++K<G.length&&K+j+1+N<R.length);break}if(R[1]===5&&j+N>=2||R[1]===2&&j+N>=5)break;R[1]&&(N=1)}while(++j+E<C.length&&j+N<R.length);for(let G=2;G<R.length;++G)R[G]===-1&&(R[G]=0);switch(R[0]){case 38:A.fg=this._updateAttrColor(A.fg,R[1],R[3],R[4],R[5]);break;case 48:A.bg=this._updateAttrColor(A.bg,R[1],R[3],R[4],R[5]);break;case 58:A.extended=A.extended.clone(),A.extended.underlineColor=this._updateAttrColor(A.extended.underlineColor,R[1],R[3],R[4],R[5])}return j}_processUnderline(C,E){E.extended=E.extended.clone(),(!~C||C>5)&&(C=1),E.extended.underlineStyle=C,E.fg|=268435456,C===0&&(E.fg&=-268435457),E.updateExtended()}_processSGR0(C){C.fg=r.DEFAULT_ATTR_DATA.fg,C.bg=r.DEFAULT_ATTR_DATA.bg,C.extended=C.extended.clone(),C.extended.underlineStyle=0,C.extended.underlineColor&=-67108864,C.updateExtended()}charAttributes(C){if(C.length===1&&C.params[0]===0)return this._processSGR0(this._curAttrData),!0;let E=C.length,A,R=this._curAttrData;for(let N=0;N<E;N++)A=C.params[N],A>=30&&A<=37?(R.fg&=-50331904,R.fg|=16777216|A-30):A>=40&&A<=47?(R.bg&=-50331904,R.bg|=16777216|A-40):A>=90&&A<=97?(R.fg&=-50331904,R.fg|=16777224|A-90):A>=100&&A<=107?(R.bg&=-50331904,R.bg|=16777224|A-100):A===0?this._processSGR0(R):A===1?R.fg|=134217728:A===3?R.bg|=67108864:A===4?(R.fg|=268435456,this._processUnderline(C.hasSubParams(N)?C.getSubParams(N)[0]:1,R)):A===5?R.fg|=536870912:A===7?R.fg|=67108864:A===8?R.fg|=1073741824:A===9?R.fg|=2147483648:A===2?R.bg|=134217728:A===21?this._processUnderline(2,R):A===22?(R.fg&=-134217729,R.bg&=-134217729):A===23?R.bg&=-67108865:A===24?(R.fg&=-268435457,this._processUnderline(0,R)):A===25?R.fg&=-536870913:A===27?R.fg&=-67108865:A===28?R.fg&=-1073741825:A===29?R.fg&=2147483647:A===39?(R.fg&=-67108864,R.fg|=16777215&r.DEFAULT_ATTR_DATA.fg):A===49?(R.bg&=-67108864,R.bg|=16777215&r.DEFAULT_ATTR_DATA.bg):A===38||A===48||A===58?N+=this._extractColor(C,N,R):A===53?R.bg|=1073741824:A===55?R.bg&=-1073741825:A===59?(R.extended=R.extended.clone(),R.extended.underlineColor=-1,R.updateExtended()):A===100?(R.fg&=-67108864,R.fg|=16777215&r.DEFAULT_ATTR_DATA.fg,R.bg&=-67108864,R.bg|=16777215&r.DEFAULT_ATTR_DATA.bg):this._logService.debug("Unknown SGR attribute: %d.",A);return!0}deviceStatus(C){switch(C.params[0]){case 5:this._coreService.triggerDataEvent(`${d.C0.ESC}[0n`);break;case 6:let E=this._activeBuffer.y+1,A=this._activeBuffer.x+1;this._coreService.triggerDataEvent(`${d.C0.ESC}[${E};${A}R`)}return!0}deviceStatusPrivate(C){if(C.params[0]===6){let E=this._activeBuffer.y+1,A=this._activeBuffer.x+1;this._coreService.triggerDataEvent(`${d.C0.ESC}[?${E};${A}R`)}return!0}softReset(C){return this._coreService.isCursorHidden=!1,this._onRequestSyncScrollBar.fire(),this._activeBuffer.scrollTop=0,this._activeBuffer.scrollBottom=this._bufferService.rows-1,this._curAttrData=r.DEFAULT_ATTR_DATA.clone(),this._coreService.reset(),this._charsetService.reset(),this._activeBuffer.savedX=0,this._activeBuffer.savedY=this._activeBuffer.ybase,this._activeBuffer.savedCurAttrData.fg=this._curAttrData.fg,this._activeBuffer.savedCurAttrData.bg=this._curAttrData.bg,this._activeBuffer.savedCharset=this._charsetService.charset,this._coreService.decPrivateModes.origin=!1,!0}setCursorStyle(C){let E=C.params[0]||1;switch(E){case 1:case 2:this._optionsService.options.cursorStyle="block";break;case 3:case 4:this._optionsService.options.cursorStyle="underline";break;case 5:case 6:this._optionsService.options.cursorStyle="bar"}let A=E%2==1;return this._optionsService.options.cursorBlink=A,!0}setScrollRegion(C){let E=C.params[0]||1,A;return(C.length<2||(A=C.params[1])>this._bufferService.rows||A===0)&&(A=this._bufferService.rows),A>E&&(this._activeBuffer.scrollTop=E-1,this._activeBuffer.scrollBottom=A-1,this._setCursor(0,0)),!0}windowOptions(C){if(!O(C.params[0],this._optionsService.rawOptions.windowOptions))return!0;let E=C.length>1?C.params[1]:0;switch(C.params[0]){case 14:E!==2&&this._onRequestWindowsOptionsReport.fire(D.GET_WIN_SIZE_PIXELS);break;case 16:this._onRequestWindowsOptionsReport.fire(D.GET_CELL_SIZE_PIXELS);break;case 18:this._bufferService&&this._coreService.triggerDataEvent(`${d.C0.ESC}[8;${this._bufferService.rows};${this._bufferService.cols}t`);break;case 22:E!==0&&E!==2||(this._windowTitleStack.push(this._windowTitle),this._windowTitleStack.length>10&&this._windowTitleStack.shift()),E!==0&&E!==1||(this._iconNameStack.push(this._iconName),this._iconNameStack.length>10&&this._iconNameStack.shift());break;case 23:E!==0&&E!==2||this._windowTitleStack.length&&this.setTitle(this._windowTitleStack.pop()),E!==0&&E!==1||this._iconNameStack.length&&this.setIconName(this._iconNameStack.pop())}return!0}saveCursor(C){return this._activeBuffer.savedX=this._activeBuffer.x,this._activeBuffer.savedY=this._activeBuffer.ybase+this._activeBuffer.y,this._activeBuffer.savedCurAttrData.fg=this._curAttrData.fg,this._activeBuffer.savedCurAttrData.bg=this._curAttrData.bg,this._activeBuffer.savedCharset=this._charsetService.charset,!0}restoreCursor(C){return this._activeBuffer.x=this._activeBuffer.savedX||0,this._activeBuffer.y=Math.max(this._activeBuffer.savedY-this._activeBuffer.ybase,0),this._curAttrData.fg=this._activeBuffer.savedCurAttrData.fg,this._curAttrData.bg=this._activeBuffer.savedCurAttrData.bg,this._charsetService.charset=this._savedCharset,this._activeBuffer.savedCharset&&(this._charsetService.charset=this._activeBuffer.savedCharset),this._restrictCursor(),!0}setTitle(C){return this._windowTitle=C,this._onTitleChange.fire(C),!0}setIconName(C){return this._iconName=C,!0}setOrReportIndexedColor(C){let E=[],A=C.split(";");for(;A.length>1;){let R=A.shift(),N=A.shift();if(/^\d+$/.exec(R)){let j=parseInt(R);if($(j))if(N==="?")E.push({type:0,index:j});else{let G=(0,_.parseColor)(N);G&&E.push({type:1,index:j,color:G})}}}return E.length&&this._onColor.fire(E),!0}setHyperlink(C){let E=C.split(";");return!(E.length<2)&&(E[1]?this._createHyperlink(E[0],E[1]):!E[0]&&this._finishHyperlink())}_createHyperlink(C,E){this._getCurrentLinkId()&&this._finishHyperlink();let A=C.split(":"),R,N=A.findIndex((j=>j.startsWith("id=")));return N!==-1&&(R=A[N].slice(3)||void 0),this._curAttrData.extended=this._curAttrData.extended.clone(),this._curAttrData.extended.urlId=this._oscLinkService.registerLink({id:R,uri:E}),this._curAttrData.updateExtended(),!0}_finishHyperlink(){return this._curAttrData.extended=this._curAttrData.extended.clone(),this._curAttrData.extended.urlId=0,this._curAttrData.updateExtended(),!0}_setOrReportSpecialColor(C,E){let A=C.split(";");for(let R=0;R<A.length&&!(E>=this._specialColors.length);++R,++E)if(A[R]==="?")this._onColor.fire([{type:0,index:this._specialColors[E]}]);else{let N=(0,_.parseColor)(A[R]);N&&this._onColor.fire([{type:1,index:this._specialColors[E],color:N}])}return!0}setOrReportFgColor(C){return this._setOrReportSpecialColor(C,0)}setOrReportBgColor(C){return this._setOrReportSpecialColor(C,1)}setOrReportCursorColor(C){return this._setOrReportSpecialColor(C,2)}restoreIndexedColor(C){if(!C)return this._onColor.fire([{type:2}]),!0;let E=[],A=C.split(";");for(let R=0;R<A.length;++R)if(/^\d+$/.exec(A[R])){let N=parseInt(A[R]);$(N)&&E.push({type:2,index:N})}return E.length&&this._onColor.fire(E),!0}restoreFgColor(C){return this._onColor.fire([{type:2,index:256}]),!0}restoreBgColor(C){return this._onColor.fire([{type:2,index:257}]),!0}restoreCursorColor(C){return this._onColor.fire([{type:2,index:258}]),!0}nextLine(){return this._activeBuffer.x=0,this.index(),!0}keypadApplicationMode(){return this._logService.debug("Serial port requested application keypad."),this._coreService.decPrivateModes.applicationKeypad=!0,this._onRequestSyncScrollBar.fire(),!0}keypadNumericMode(){return this._logService.debug("Switching back to normal keypad."),this._coreService.decPrivateModes.applicationKeypad=!1,this._onRequestSyncScrollBar.fire(),!0}selectDefaultCharset(){return this._charsetService.setgLevel(0),this._charsetService.setgCharset(0,f.DEFAULT_CHARSET),!0}selectCharset(C){return C.length!==2?(this.selectDefaultCharset(),!0):(C[0]==="/"||this._charsetService.setgCharset(S[C[0]],f.CHARSETS[C[1]]||f.DEFAULT_CHARSET),!0)}index(){return this._restrictCursor(),this._activeBuffer.y++,this._activeBuffer.y===this._activeBuffer.scrollBottom+1?(this._activeBuffer.y--,this._bufferService.scroll(this._eraseAttrData())):this._activeBuffer.y>=this._bufferService.rows&&(this._activeBuffer.y=this._bufferService.rows-1),this._restrictCursor(),!0}tabSet(){return this._activeBuffer.tabs[this._activeBuffer.x]=!0,!0}reverseIndex(){if(this._restrictCursor(),this._activeBuffer.y===this._activeBuffer.scrollTop){let C=this._activeBuffer.scrollBottom-this._activeBuffer.scrollTop;this._activeBuffer.lines.shiftElements(this._activeBuffer.ybase+this._activeBuffer.y,C,1),this._activeBuffer.lines.set(this._activeBuffer.ybase+this._activeBuffer.y,this._activeBuffer.getBlankLine(this._eraseAttrData())),this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop,this._activeBuffer.scrollBottom)}else this._activeBuffer.y--,this._restrictCursor();return!0}fullReset(){return this._parser.reset(),this._onRequestReset.fire(),!0}reset(){this._curAttrData=r.DEFAULT_ATTR_DATA.clone(),this._eraseAttrDataInternal=r.DEFAULT_ATTR_DATA.clone()}_eraseAttrData(){return this._eraseAttrDataInternal.bg&=-67108864,this._eraseAttrDataInternal.bg|=67108863&this._curAttrData.bg,this._eraseAttrDataInternal}setgLevel(C){return this._charsetService.setgLevel(C),!0}screenAlignmentPattern(){let C=new h.CellData;C.content=4194373,C.fg=this._curAttrData.fg,C.bg=this._curAttrData.bg,this._setCursor(0,0);for(let E=0;E<this._bufferService.rows;++E){let A=this._activeBuffer.ybase+this._activeBuffer.y+E,R=this._activeBuffer.lines.get(A);R&&(R.fill(C),R.isWrapped=!1)}return this._dirtyRowTracker.markAllDirty(),this._setCursor(0,0),!0}requestStatusString(C,E){let A=this._bufferService.buffer,R=this._optionsService.rawOptions;return(N=>(this._coreService.triggerDataEvent(`${d.C0.ESC}${N}${d.C0.ESC}\\`),!0))(C==='"q'?`P1$r${this._curAttrData.isProtected()?1:0}"q`:C==='"p'?'P1$r61;1"p':C==="r"?`P1$r${A.scrollTop+1};${A.scrollBottom+1}r`:C==="m"?"P1$r0m":C===" q"?`P1$r${{block:2,underline:4,bar:6}[R.cursorStyle]-(R.cursorBlink?1:0)} q`:"P0$r")}markRangeDirty(C,E){this._dirtyRowTracker.markRangeDirty(C,E)}}i.InputHandler=z;let B=class{constructor(I){this._bufferService=I,this.clearRange()}clearRange(){this.start=this._bufferService.buffer.y,this.end=this._bufferService.buffer.y}markDirty(I){I<this.start?this.start=I:I>this.end&&(this.end=I)}markRangeDirty(I,C){I>C&&(M=I,I=C,C=M),I<this.start&&(this.start=I),C>this.end&&(this.end=C)}markAllDirty(){this.markRangeDirty(0,this._bufferService.rows-1)}};function $(I){return 0<=I&&I<256}B=c([p(0,v.IBufferService)],B)},844:(u,i)=>{function o(c){for(let p of c)p.dispose();c.length=0}Object.defineProperty(i,"__esModule",{value:!0}),i.getDisposeArrayDisposable=i.disposeArray=i.toDisposable=i.MutableDisposable=i.Disposable=void 0,i.Disposable=class{constructor(){this._disposables=[],this._isDisposed=!1}dispose(){this._isDisposed=!0;for(let c of this._disposables)c.dispose();this._disposables.length=0}register(c){return this._disposables.push(c),c}unregister(c){let p=this._disposables.indexOf(c);p!==-1&&this._disposables.splice(p,1)}},i.MutableDisposable=class{constructor(){this._isDisposed=!1}get value(){return this._isDisposed?void 0:this._value}set value(c){var p;this._isDisposed||c===this._value||((p=this._value)===null||p===void 0||p.dispose(),this._value=c)}clear(){this.value=void 0}dispose(){var c;this._isDisposed=!0,(c=this._value)===null||c===void 0||c.dispose(),this._value=void 0}},i.toDisposable=function(c){return{dispose:c}},i.disposeArray=o,i.getDisposeArrayDisposable=function(c){return{dispose:()=>o(c)}}},1505:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.FourKeyMap=i.TwoKeyMap=void 0;class o{constructor(){this._data={}}set(p,d,f){this._data[p]||(this._data[p]={}),this._data[p][d]=f}get(p,d){return this._data[p]?this._data[p][d]:void 0}clear(){this._data={}}}i.TwoKeyMap=o,i.FourKeyMap=class{constructor(){this._data=new o}set(c,p,d,f,g){this._data.get(c,p)||this._data.set(c,p,new o),this._data.get(c,p).set(d,f,g)}get(c,p,d,f){var g;return(g=this._data.get(c,p))===null||g===void 0?void 0:g.get(d,f)}clear(){this._data.clear()}}},6114:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.isChromeOS=i.isLinux=i.isWindows=i.isIphone=i.isIpad=i.isMac=i.getSafariVersion=i.isSafari=i.isLegacyEdge=i.isFirefox=i.isNode=void 0,i.isNode=typeof navigator>"u";let o=i.isNode?"node":navigator.userAgent,c=i.isNode?"node":navigator.platform;i.isFirefox=o.includes("Firefox"),i.isLegacyEdge=o.includes("Edge"),i.isSafari=/^((?!chrome|android).)*safari/i.test(o),i.getSafariVersion=function(){if(!i.isSafari)return 0;let p=o.match(/Version\/(\d+)/);return p===null||p.length<2?0:parseInt(p[1])},i.isMac=["Macintosh","MacIntel","MacPPC","Mac68K"].includes(c),i.isIpad=c==="iPad",i.isIphone=c==="iPhone",i.isWindows=["Windows","Win16","Win32","WinCE"].includes(c),i.isLinux=c.indexOf("Linux")>=0,i.isChromeOS=/\bCrOS\b/.test(o)},6106:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.SortedList=void 0;let o=0;i.SortedList=class{constructor(c){this._getKey=c,this._array=[]}clear(){this._array.length=0}insert(c){this._array.length!==0?(o=this._search(this._getKey(c)),this._array.splice(o,0,c)):this._array.push(c)}delete(c){if(this._array.length===0)return!1;let p=this._getKey(c);if(p===void 0||(o=this._search(p),o===-1)||this._getKey(this._array[o])!==p)return!1;do if(this._array[o]===c)return this._array.splice(o,1),!0;while(++o<this._array.length&&this._getKey(this._array[o])===p);return!1}*getKeyIterator(c){if(this._array.length!==0&&(o=this._search(c),!(o<0||o>=this._array.length)&&this._getKey(this._array[o])===c))do yield this._array[o];while(++o<this._array.length&&this._getKey(this._array[o])===c)}forEachByKey(c,p){if(this._array.length!==0&&(o=this._search(c),!(o<0||o>=this._array.length)&&this._getKey(this._array[o])===c))do p(this._array[o]);while(++o<this._array.length&&this._getKey(this._array[o])===c)}values(){return[...this._array].values()}_search(c){let p=0,d=this._array.length-1;for(;d>=p;){let f=p+d>>1,g=this._getKey(this._array[f]);if(g>c)d=f-1;else{if(!(g<c)){for(;f>0&&this._getKey(this._array[f-1])===c;)f--;return f}p=f+1}}return p}}},7226:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DebouncedIdleTask=i.IdleTaskQueue=i.PriorityTaskQueue=void 0;let c=o(6114);class p{constructor(){this._tasks=[],this._i=0}enqueue(g){this._tasks.push(g),this._start()}flush(){for(;this._i<this._tasks.length;)this._tasks[this._i]()||this._i++;this.clear()}clear(){this._idleCallback&&(this._cancelCallback(this._idleCallback),this._idleCallback=void 0),this._i=0,this._tasks.length=0}_start(){this._idleCallback||(this._idleCallback=this._requestCallback(this._process.bind(this)))}_process(g){this._idleCallback=void 0;let w=0,b=0,r=g.timeRemaining(),l=0;for(;this._i<this._tasks.length;){if(w=Date.now(),this._tasks[this._i]()||this._i++,w=Math.max(1,Date.now()-w),b=Math.max(w,b),l=g.timeRemaining(),1.5*b>l)return r-w<-20&&console.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(r-w))}ms`),void this._start();r=l}this.clear()}}class d extends p{_requestCallback(g){return setTimeout((()=>g(this._createDeadline(16))))}_cancelCallback(g){clearTimeout(g)}_createDeadline(g){let w=Date.now()+g;return{timeRemaining:()=>Math.max(0,w-Date.now())}}}i.PriorityTaskQueue=d,i.IdleTaskQueue=!c.isNode&&"requestIdleCallback"in window?class extends p{_requestCallback(f){return requestIdleCallback(f)}_cancelCallback(f){cancelIdleCallback(f)}}:d,i.DebouncedIdleTask=class{constructor(){this._queue=new i.IdleTaskQueue}set(f){this._queue.clear(),this._queue.enqueue(f)}flush(){this._queue.flush()}}},9282:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.updateWindowsModeWrappedState=void 0;let c=o(643);i.updateWindowsModeWrappedState=function(p){let d=p.buffer.lines.get(p.buffer.ybase+p.buffer.y-1),f=d?.get(p.cols-1),g=p.buffer.lines.get(p.buffer.ybase+p.buffer.y);g&&f&&(g.isWrapped=f[c.CHAR_DATA_CODE_INDEX]!==c.NULL_CELL_CODE&&f[c.CHAR_DATA_CODE_INDEX]!==c.WHITESPACE_CELL_CODE)}},3734:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ExtendedAttrs=i.AttributeData=void 0;class o{constructor(){this.fg=0,this.bg=0,this.extended=new c}static toColorRGB(d){return[d>>>16&255,d>>>8&255,255&d]}static fromColorRGB(d){return(255&d[0])<<16|(255&d[1])<<8|255&d[2]}clone(){let d=new o;return d.fg=this.fg,d.bg=this.bg,d.extended=this.extended.clone(),d}isInverse(){return 67108864&this.fg}isBold(){return 134217728&this.fg}isUnderline(){return this.hasExtendedAttrs()&&this.extended.underlineStyle!==0?1:268435456&this.fg}isBlink(){return 536870912&this.fg}isInvisible(){return 1073741824&this.fg}isItalic(){return 67108864&this.bg}isDim(){return 134217728&this.bg}isStrikethrough(){return 2147483648&this.fg}isProtected(){return 536870912&this.bg}isOverline(){return 1073741824&this.bg}getFgColorMode(){return 50331648&this.fg}getBgColorMode(){return 50331648&this.bg}isFgRGB(){return(50331648&this.fg)==50331648}isBgRGB(){return(50331648&this.bg)==50331648}isFgPalette(){return(50331648&this.fg)==16777216||(50331648&this.fg)==33554432}isBgPalette(){return(50331648&this.bg)==16777216||(50331648&this.bg)==33554432}isFgDefault(){return(50331648&this.fg)==0}isBgDefault(){return(50331648&this.bg)==0}isAttributeDefault(){return this.fg===0&&this.bg===0}getFgColor(){switch(50331648&this.fg){case 16777216:case 33554432:return 255&this.fg;case 50331648:return 16777215&this.fg;default:return-1}}getBgColor(){switch(50331648&this.bg){case 16777216:case 33554432:return 255&this.bg;case 50331648:return 16777215&this.bg;default:return-1}}hasExtendedAttrs(){return 268435456&this.bg}updateExtended(){this.extended.isEmpty()?this.bg&=-268435457:this.bg|=268435456}getUnderlineColor(){if(268435456&this.bg&&~this.extended.underlineColor)switch(50331648&this.extended.underlineColor){case 16777216:case 33554432:return 255&this.extended.underlineColor;case 50331648:return 16777215&this.extended.underlineColor;default:return this.getFgColor()}return this.getFgColor()}getUnderlineColorMode(){return 268435456&this.bg&&~this.extended.underlineColor?50331648&this.extended.underlineColor:this.getFgColorMode()}isUnderlineColorRGB(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==50331648:this.isFgRGB()}isUnderlineColorPalette(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==16777216||(50331648&this.extended.underlineColor)==33554432:this.isFgPalette()}isUnderlineColorDefault(){return 268435456&this.bg&&~this.extended.underlineColor?(50331648&this.extended.underlineColor)==0:this.isFgDefault()}getUnderlineStyle(){return 268435456&this.fg?268435456&this.bg?this.extended.underlineStyle:1:0}}i.AttributeData=o;class c{get ext(){return this._urlId?-469762049&this._ext|this.underlineStyle<<26:this._ext}set ext(d){this._ext=d}get underlineStyle(){return this._urlId?5:(469762048&this._ext)>>26}set underlineStyle(d){this._ext&=-469762049,this._ext|=d<<26&469762048}get underlineColor(){return 67108863&this._ext}set underlineColor(d){this._ext&=-67108864,this._ext|=67108863&d}get urlId(){return this._urlId}set urlId(d){this._urlId=d}constructor(d=0,f=0){this._ext=0,this._urlId=0,this._ext=d,this._urlId=f}clone(){return new c(this._ext,this._urlId)}isEmpty(){return this.underlineStyle===0&&this._urlId===0}}i.ExtendedAttrs=c},9092:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Buffer=i.MAX_BUFFER_SIZE=void 0;let c=o(6349),p=o(7226),d=o(3734),f=o(8437),g=o(4634),w=o(511),b=o(643),r=o(4863),l=o(7116);i.MAX_BUFFER_SIZE=4294967295,i.Buffer=class{constructor(a,h,m){this._hasScrollback=a,this._optionsService=h,this._bufferService=m,this.ydisp=0,this.ybase=0,this.y=0,this.x=0,this.tabs={},this.savedY=0,this.savedX=0,this.savedCurAttrData=f.DEFAULT_ATTR_DATA.clone(),this.savedCharset=l.DEFAULT_CHARSET,this.markers=[],this._nullCell=w.CellData.fromCharData([0,b.NULL_CELL_CHAR,b.NULL_CELL_WIDTH,b.NULL_CELL_CODE]),this._whitespaceCell=w.CellData.fromCharData([0,b.WHITESPACE_CELL_CHAR,b.WHITESPACE_CELL_WIDTH,b.WHITESPACE_CELL_CODE]),this._isClearing=!1,this._memoryCleanupQueue=new p.IdleTaskQueue,this._memoryCleanupPosition=0,this._cols=this._bufferService.cols,this._rows=this._bufferService.rows,this.lines=new c.CircularList(this._getCorrectBufferLength(this._rows)),this.scrollTop=0,this.scrollBottom=this._rows-1,this.setupTabStops()}getNullCell(a){return a?(this._nullCell.fg=a.fg,this._nullCell.bg=a.bg,this._nullCell.extended=a.extended):(this._nullCell.fg=0,this._nullCell.bg=0,this._nullCell.extended=new d.ExtendedAttrs),this._nullCell}getWhitespaceCell(a){return a?(this._whitespaceCell.fg=a.fg,this._whitespaceCell.bg=a.bg,this._whitespaceCell.extended=a.extended):(this._whitespaceCell.fg=0,this._whitespaceCell.bg=0,this._whitespaceCell.extended=new d.ExtendedAttrs),this._whitespaceCell}getBlankLine(a,h){return new f.BufferLine(this._bufferService.cols,this.getNullCell(a),h)}get hasScrollback(){return this._hasScrollback&&this.lines.maxLength>this._rows}get isCursorInViewport(){let a=this.ybase+this.y-this.ydisp;return a>=0&&a<this._rows}_getCorrectBufferLength(a){if(!this._hasScrollback)return a;let h=a+this._optionsService.rawOptions.scrollback;return h>i.MAX_BUFFER_SIZE?i.MAX_BUFFER_SIZE:h}fillViewportRows(a){if(this.lines.length===0){a===void 0&&(a=f.DEFAULT_ATTR_DATA);let h=this._rows;for(;h--;)this.lines.push(this.getBlankLine(a))}}clear(){this.ydisp=0,this.ybase=0,this.y=0,this.x=0,this.lines=new c.CircularList(this._getCorrectBufferLength(this._rows)),this.scrollTop=0,this.scrollBottom=this._rows-1,this.setupTabStops()}resize(a,h){let m=this.getNullCell(f.DEFAULT_ATTR_DATA),v=0,y=this._getCorrectBufferLength(h);if(y>this.lines.maxLength&&(this.lines.maxLength=y),this.lines.length>0){if(this._cols<a)for(let _=0;_<this.lines.length;_++)v+=+this.lines.get(_).resize(a,m);let x=0;if(this._rows<h)for(let _=this._rows;_<h;_++)this.lines.length<h+this.ybase&&(this._optionsService.rawOptions.windowsMode||this._optionsService.rawOptions.windowsPty.backend!==void 0||this._optionsService.rawOptions.windowsPty.buildNumber!==void 0?this.lines.push(new f.BufferLine(a,m)):this.ybase>0&&this.lines.length<=this.ybase+this.y+x+1?(this.ybase--,x++,this.ydisp>0&&this.ydisp--):this.lines.push(new f.BufferLine(a,m)));else for(let _=this._rows;_>h;_--)this.lines.length>h+this.ybase&&(this.lines.length>this.ybase+this.y+1?this.lines.pop():(this.ybase++,this.ydisp++));if(y<this.lines.maxLength){let _=this.lines.length-y;_>0&&(this.lines.trimStart(_),this.ybase=Math.max(this.ybase-_,0),this.ydisp=Math.max(this.ydisp-_,0),this.savedY=Math.max(this.savedY-_,0)),this.lines.maxLength=y}this.x=Math.min(this.x,a-1),this.y=Math.min(this.y,h-1),x&&(this.y+=x),this.savedX=Math.min(this.savedX,a-1),this.scrollTop=0}if(this.scrollBottom=h-1,this._isReflowEnabled&&(this._reflow(a,h),this._cols>a))for(let x=0;x<this.lines.length;x++)v+=+this.lines.get(x).resize(a,m);this._cols=a,this._rows=h,this._memoryCleanupQueue.clear(),v>.1*this.lines.length&&(this._memoryCleanupPosition=0,this._memoryCleanupQueue.enqueue((()=>this._batchedMemoryCleanup())))}_batchedMemoryCleanup(){let a=!0;this._memoryCleanupPosition>=this.lines.length&&(this._memoryCleanupPosition=0,a=!1);let h=0;for(;this._memoryCleanupPosition<this.lines.length;)if(h+=this.lines.get(this._memoryCleanupPosition++).cleanupMemory(),h>100)return!0;return a}get _isReflowEnabled(){let a=this._optionsService.rawOptions.windowsPty;return a&&a.buildNumber?this._hasScrollback&&a.backend==="conpty"&&a.buildNumber>=21376:this._hasScrollback&&!this._optionsService.rawOptions.windowsMode}_reflow(a,h){this._cols!==a&&(a>this._cols?this._reflowLarger(a,h):this._reflowSmaller(a,h))}_reflowLarger(a,h){let m=(0,g.reflowLargerGetLinesToRemove)(this.lines,this._cols,a,this.ybase+this.y,this.getNullCell(f.DEFAULT_ATTR_DATA));if(m.length>0){let v=(0,g.reflowLargerCreateNewLayout)(this.lines,m);(0,g.reflowLargerApplyNewLayout)(this.lines,v.layout),this._reflowLargerAdjustViewport(a,h,v.countRemoved)}}_reflowLargerAdjustViewport(a,h,m){let v=this.getNullCell(f.DEFAULT_ATTR_DATA),y=m;for(;y-- >0;)this.ybase===0?(this.y>0&&this.y--,this.lines.length<h&&this.lines.push(new f.BufferLine(a,v))):(this.ydisp===this.ybase&&this.ydisp--,this.ybase--);this.savedY=Math.max(this.savedY-m,0)}_reflowSmaller(a,h){let m=this.getNullCell(f.DEFAULT_ATTR_DATA),v=[],y=0;for(let x=this.lines.length-1;x>=0;x--){let _=this.lines.get(x);if(!_||!_.isWrapped&&_.getTrimmedLength()<=a)continue;let S=[_];for(;_.isWrapped&&x>0;)_=this.lines.get(--x),S.unshift(_);let L=this.ybase+this.y;if(L>=x&&L<x+S.length)continue;let O=S[S.length-1].getTrimmedLength(),D=(0,g.reflowSmallerGetNewLineLengths)(S,this._cols,a),M=D.length-S.length,z;z=this.ybase===0&&this.y!==this.lines.length-1?Math.max(0,this.y-this.lines.maxLength+M):Math.max(0,this.lines.length-this.lines.maxLength+M);let B=[];for(let R=0;R<M;R++){let N=this.getBlankLine(f.DEFAULT_ATTR_DATA,!0);B.push(N)}B.length>0&&(v.push({start:x+S.length+y,newLines:B}),y+=B.length),S.push(...B);let $=D.length-1,I=D[$];I===0&&($--,I=D[$]);let C=S.length-M-1,E=O;for(;C>=0;){let R=Math.min(E,I);if(S[$]===void 0)break;if(S[$].copyCellsFrom(S[C],E-R,I-R,R,!0),I-=R,I===0&&($--,I=D[$]),E-=R,E===0){C--;let N=Math.max(C,0);E=(0,g.getWrappedLineTrimmedLength)(S,N,this._cols)}}for(let R=0;R<S.length;R++)D[R]<a&&S[R].setCell(D[R],m);let A=M-z;for(;A-- >0;)this.ybase===0?this.y<h-1?(this.y++,this.lines.pop()):(this.ybase++,this.ydisp++):this.ybase<Math.min(this.lines.maxLength,this.lines.length+y)-h&&(this.ybase===this.ydisp&&this.ydisp++,this.ybase++);this.savedY=Math.min(this.savedY+M,this.ybase+h-1)}if(v.length>0){let x=[],_=[];for(let $=0;$<this.lines.length;$++)_.push(this.lines.get($));let S=this.lines.length,L=S-1,O=0,D=v[O];this.lines.length=Math.min(this.lines.maxLength,this.lines.length+y);let M=0;for(let $=Math.min(this.lines.maxLength-1,S+y-1);$>=0;$--)if(D&&D.start>L+M){for(let I=D.newLines.length-1;I>=0;I--)this.lines.set($--,D.newLines[I]);$++,x.push({index:L+1,amount:D.newLines.length}),M+=D.newLines.length,D=v[++O]}else this.lines.set($,_[L--]);let z=0;for(let $=x.length-1;$>=0;$--)x[$].index+=z,this.lines.onInsertEmitter.fire(x[$]),z+=x[$].amount;let B=Math.max(0,S+y-this.lines.maxLength);B>0&&this.lines.onTrimEmitter.fire(B)}}translateBufferLineToString(a,h,m=0,v){let y=this.lines.get(a);return y?y.translateToString(h,m,v):""}getWrappedRangeForLine(a){let h=a,m=a;for(;h>0&&this.lines.get(h).isWrapped;)h--;for(;m+1<this.lines.length&&this.lines.get(m+1).isWrapped;)m++;return{first:h,last:m}}setupTabStops(a){for(a!=null?this.tabs[a]||(a=this.prevStop(a)):(this.tabs={},a=0);a<this._cols;a+=this._optionsService.rawOptions.tabStopWidth)this.tabs[a]=!0}prevStop(a){for(a==null&&(a=this.x);!this.tabs[--a]&&a>0;);return a>=this._cols?this._cols-1:a<0?0:a}nextStop(a){for(a==null&&(a=this.x);!this.tabs[++a]&&a<this._cols;);return a>=this._cols?this._cols-1:a<0?0:a}clearMarkers(a){this._isClearing=!0;for(let h=0;h<this.markers.length;h++)this.markers[h].line===a&&(this.markers[h].dispose(),this.markers.splice(h--,1));this._isClearing=!1}clearAllMarkers(){this._isClearing=!0;for(let a=0;a<this.markers.length;a++)this.markers[a].dispose(),this.markers.splice(a--,1);this._isClearing=!1}addMarker(a){let h=new r.Marker(a);return this.markers.push(h),h.register(this.lines.onTrim((m=>{h.line-=m,h.line<0&&h.dispose()}))),h.register(this.lines.onInsert((m=>{h.line>=m.index&&(h.line+=m.amount)}))),h.register(this.lines.onDelete((m=>{h.line>=m.index&&h.line<m.index+m.amount&&h.dispose(),h.line>m.index&&(h.line-=m.amount)}))),h.register(h.onDispose((()=>this._removeMarker(h)))),h}_removeMarker(a){this._isClearing||this.markers.splice(this.markers.indexOf(a),1)}}},8437:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferLine=i.DEFAULT_ATTR_DATA=void 0;let c=o(3734),p=o(511),d=o(643),f=o(482);i.DEFAULT_ATTR_DATA=Object.freeze(new c.AttributeData);let g=0;class w{constructor(r,l,a=!1){this.isWrapped=a,this._combined={},this._extendedAttrs={},this._data=new Uint32Array(3*r);let h=l||p.CellData.fromCharData([0,d.NULL_CELL_CHAR,d.NULL_CELL_WIDTH,d.NULL_CELL_CODE]);for(let m=0;m<r;++m)this.setCell(m,h);this.length=r}get(r){let l=this._data[3*r+0],a=2097151&l;return[this._data[3*r+1],2097152&l?this._combined[r]:a?(0,f.stringFromCodePoint)(a):"",l>>22,2097152&l?this._combined[r].charCodeAt(this._combined[r].length-1):a]}set(r,l){this._data[3*r+1]=l[d.CHAR_DATA_ATTR_INDEX],l[d.CHAR_DATA_CHAR_INDEX].length>1?(this._combined[r]=l[1],this._data[3*r+0]=2097152|r|l[d.CHAR_DATA_WIDTH_INDEX]<<22):this._data[3*r+0]=l[d.CHAR_DATA_CHAR_INDEX].charCodeAt(0)|l[d.CHAR_DATA_WIDTH_INDEX]<<22}getWidth(r){return this._data[3*r+0]>>22}hasWidth(r){return 12582912&this._data[3*r+0]}getFg(r){return this._data[3*r+1]}getBg(r){return this._data[3*r+2]}hasContent(r){return 4194303&this._data[3*r+0]}getCodePoint(r){let l=this._data[3*r+0];return 2097152&l?this._combined[r].charCodeAt(this._combined[r].length-1):2097151&l}isCombined(r){return 2097152&this._data[3*r+0]}getString(r){let l=this._data[3*r+0];return 2097152&l?this._combined[r]:2097151&l?(0,f.stringFromCodePoint)(2097151&l):""}isProtected(r){return 536870912&this._data[3*r+2]}loadCell(r,l){return g=3*r,l.content=this._data[g+0],l.fg=this._data[g+1],l.bg=this._data[g+2],2097152&l.content&&(l.combinedData=this._combined[r]),268435456&l.bg&&(l.extended=this._extendedAttrs[r]),l}setCell(r,l){2097152&l.content&&(this._combined[r]=l.combinedData),268435456&l.bg&&(this._extendedAttrs[r]=l.extended),this._data[3*r+0]=l.content,this._data[3*r+1]=l.fg,this._data[3*r+2]=l.bg}setCellFromCodePoint(r,l,a,h,m,v){268435456&m&&(this._extendedAttrs[r]=v),this._data[3*r+0]=l|a<<22,this._data[3*r+1]=h,this._data[3*r+2]=m}addCodepointToCell(r,l){let a=this._data[3*r+0];2097152&a?this._combined[r]+=(0,f.stringFromCodePoint)(l):(2097151&a?(this._combined[r]=(0,f.stringFromCodePoint)(2097151&a)+(0,f.stringFromCodePoint)(l),a&=-2097152,a|=2097152):a=l|4194304,this._data[3*r+0]=a)}insertCells(r,l,a,h){if((r%=this.length)&&this.getWidth(r-1)===2&&this.setCellFromCodePoint(r-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs),l<this.length-r){let m=new p.CellData;for(let v=this.length-r-l-1;v>=0;--v)this.setCell(r+l+v,this.loadCell(r+v,m));for(let v=0;v<l;++v)this.setCell(r+v,a)}else for(let m=r;m<this.length;++m)this.setCell(m,a);this.getWidth(this.length-1)===2&&this.setCellFromCodePoint(this.length-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs)}deleteCells(r,l,a,h){if(r%=this.length,l<this.length-r){let m=new p.CellData;for(let v=0;v<this.length-r-l;++v)this.setCell(r+v,this.loadCell(r+l+v,m));for(let v=this.length-l;v<this.length;++v)this.setCell(v,a)}else for(let m=r;m<this.length;++m)this.setCell(m,a);r&&this.getWidth(r-1)===2&&this.setCellFromCodePoint(r-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs),this.getWidth(r)!==0||this.hasContent(r)||this.setCellFromCodePoint(r,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs)}replaceCells(r,l,a,h,m=!1){if(m)for(r&&this.getWidth(r-1)===2&&!this.isProtected(r-1)&&this.setCellFromCodePoint(r-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs),l<this.length&&this.getWidth(l-1)===2&&!this.isProtected(l)&&this.setCellFromCodePoint(l,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs);r<l&&r<this.length;)this.isProtected(r)||this.setCell(r,a),r++;else for(r&&this.getWidth(r-1)===2&&this.setCellFromCodePoint(r-1,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs),l<this.length&&this.getWidth(l-1)===2&&this.setCellFromCodePoint(l,0,1,h?.fg||0,h?.bg||0,h?.extended||new c.ExtendedAttrs);r<l&&r<this.length;)this.setCell(r++,a)}resize(r,l){if(r===this.length)return 4*this._data.length*2<this._data.buffer.byteLength;let a=3*r;if(r>this.length){if(this._data.buffer.byteLength>=4*a)this._data=new Uint32Array(this._data.buffer,0,a);else{let h=new Uint32Array(a);h.set(this._data),this._data=h}for(let h=this.length;h<r;++h)this.setCell(h,l)}else{this._data=this._data.subarray(0,a);let h=Object.keys(this._combined);for(let v=0;v<h.length;v++){let y=parseInt(h[v],10);y>=r&&delete this._combined[y]}let m=Object.keys(this._extendedAttrs);for(let v=0;v<m.length;v++){let y=parseInt(m[v],10);y>=r&&delete this._extendedAttrs[y]}}return this.length=r,4*a*2<this._data.buffer.byteLength}cleanupMemory(){if(4*this._data.length*2<this._data.buffer.byteLength){let r=new Uint32Array(this._data.length);return r.set(this._data),this._data=r,1}return 0}fill(r,l=!1){if(l)for(let a=0;a<this.length;++a)this.isProtected(a)||this.setCell(a,r);else{this._combined={},this._extendedAttrs={};for(let a=0;a<this.length;++a)this.setCell(a,r)}}copyFrom(r){this.length!==r.length?this._data=new Uint32Array(r._data):this._data.set(r._data),this.length=r.length,this._combined={};for(let l in r._combined)this._combined[l]=r._combined[l];this._extendedAttrs={};for(let l in r._extendedAttrs)this._extendedAttrs[l]=r._extendedAttrs[l];this.isWrapped=r.isWrapped}clone(){let r=new w(0);r._data=new Uint32Array(this._data),r.length=this.length;for(let l in this._combined)r._combined[l]=this._combined[l];for(let l in this._extendedAttrs)r._extendedAttrs[l]=this._extendedAttrs[l];return r.isWrapped=this.isWrapped,r}getTrimmedLength(){for(let r=this.length-1;r>=0;--r)if(4194303&this._data[3*r+0])return r+(this._data[3*r+0]>>22);return 0}getNoBgTrimmedLength(){for(let r=this.length-1;r>=0;--r)if(4194303&this._data[3*r+0]||50331648&this._data[3*r+2])return r+(this._data[3*r+0]>>22);return 0}copyCellsFrom(r,l,a,h,m){let v=r._data;if(m)for(let x=h-1;x>=0;x--){for(let _=0;_<3;_++)this._data[3*(a+x)+_]=v[3*(l+x)+_];268435456&v[3*(l+x)+2]&&(this._extendedAttrs[a+x]=r._extendedAttrs[l+x])}else for(let x=0;x<h;x++){for(let _=0;_<3;_++)this._data[3*(a+x)+_]=v[3*(l+x)+_];268435456&v[3*(l+x)+2]&&(this._extendedAttrs[a+x]=r._extendedAttrs[l+x])}let y=Object.keys(r._combined);for(let x=0;x<y.length;x++){let _=parseInt(y[x],10);_>=l&&(this._combined[_-l+a]=r._combined[_])}}translateToString(r=!1,l=0,a=this.length){r&&(a=Math.min(a,this.getTrimmedLength()));let h="";for(;l<a;){let m=this._data[3*l+0],v=2097151&m;h+=2097152&m?this._combined[l]:v?(0,f.stringFromCodePoint)(v):d.WHITESPACE_CELL_CHAR,l+=m>>22||1}return h}}i.BufferLine=w},4841:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.getRangeLength=void 0,i.getRangeLength=function(o,c){if(o.start.y>o.end.y)throw new Error(`Buffer range end (${o.end.x}, ${o.end.y}) cannot be before start (${o.start.x}, ${o.start.y})`);return c*(o.end.y-o.start.y)+(o.end.x-o.start.x+1)}},4634:(u,i)=>{function o(c,p,d){if(p===c.length-1)return c[p].getTrimmedLength();let f=!c[p].hasContent(d-1)&&c[p].getWidth(d-1)===1,g=c[p+1].getWidth(0)===2;return f&&g?d-1:d}Object.defineProperty(i,"__esModule",{value:!0}),i.getWrappedLineTrimmedLength=i.reflowSmallerGetNewLineLengths=i.reflowLargerApplyNewLayout=i.reflowLargerCreateNewLayout=i.reflowLargerGetLinesToRemove=void 0,i.reflowLargerGetLinesToRemove=function(c,p,d,f,g){let w=[];for(let b=0;b<c.length-1;b++){let r=b,l=c.get(++r);if(!l.isWrapped)continue;let a=[c.get(b)];for(;r<c.length&&l.isWrapped;)a.push(l),l=c.get(++r);if(f>=b&&f<r){b+=a.length-1;continue}let h=0,m=o(a,h,p),v=1,y=0;for(;v<a.length;){let _=o(a,v,p),S=_-y,L=d-m,O=Math.min(S,L);a[h].copyCellsFrom(a[v],y,m,O,!1),m+=O,m===d&&(h++,m=0),y+=O,y===_&&(v++,y=0),m===0&&h!==0&&a[h-1].getWidth(d-1)===2&&(a[h].copyCellsFrom(a[h-1],d-1,m++,1,!1),a[h-1].setCell(d-1,g))}a[h].replaceCells(m,d,g);let x=0;for(let _=a.length-1;_>0&&(_>h||a[_].getTrimmedLength()===0);_--)x++;x>0&&(w.push(b+a.length-x),w.push(x)),b+=a.length-1}return w},i.reflowLargerCreateNewLayout=function(c,p){let d=[],f=0,g=p[f],w=0;for(let b=0;b<c.length;b++)if(g===b){let r=p[++f];c.onDeleteEmitter.fire({index:b-w,amount:r}),b+=r-1,w+=r,g=p[++f]}else d.push(b);return{layout:d,countRemoved:w}},i.reflowLargerApplyNewLayout=function(c,p){let d=[];for(let f=0;f<p.length;f++)d.push(c.get(p[f]));for(let f=0;f<d.length;f++)c.set(f,d[f]);c.length=p.length},i.reflowSmallerGetNewLineLengths=function(c,p,d){let f=[],g=c.map(((l,a)=>o(c,a,p))).reduce(((l,a)=>l+a)),w=0,b=0,r=0;for(;r<g;){if(g-r<d){f.push(g-r);break}w+=d;let l=o(c,b,p);w>l&&(w-=l,b++);let a=c[b].getWidth(w-1)===2;a&&w--;let h=a?d-1:d;f.push(h),r+=h}return f},i.getWrappedLineTrimmedLength=o},5295:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferSet=void 0;let c=o(8460),p=o(844),d=o(9092);class f extends p.Disposable{constructor(w,b){super(),this._optionsService=w,this._bufferService=b,this._onBufferActivate=this.register(new c.EventEmitter),this.onBufferActivate=this._onBufferActivate.event,this.reset(),this.register(this._optionsService.onSpecificOptionChange("scrollback",(()=>this.resize(this._bufferService.cols,this._bufferService.rows)))),this.register(this._optionsService.onSpecificOptionChange("tabStopWidth",(()=>this.setupTabStops())))}reset(){this._normal=new d.Buffer(!0,this._optionsService,this._bufferService),this._normal.fillViewportRows(),this._alt=new d.Buffer(!1,this._optionsService,this._bufferService),this._activeBuffer=this._normal,this._onBufferActivate.fire({activeBuffer:this._normal,inactiveBuffer:this._alt}),this.setupTabStops()}get alt(){return this._alt}get active(){return this._activeBuffer}get normal(){return this._normal}activateNormalBuffer(){this._activeBuffer!==this._normal&&(this._normal.x=this._alt.x,this._normal.y=this._alt.y,this._alt.clearAllMarkers(),this._alt.clear(),this._activeBuffer=this._normal,this._onBufferActivate.fire({activeBuffer:this._normal,inactiveBuffer:this._alt}))}activateAltBuffer(w){this._activeBuffer!==this._alt&&(this._alt.fillViewportRows(w),this._alt.x=this._normal.x,this._alt.y=this._normal.y,this._activeBuffer=this._alt,this._onBufferActivate.fire({activeBuffer:this._alt,inactiveBuffer:this._normal}))}resize(w,b){this._normal.resize(w,b),this._alt.resize(w,b),this.setupTabStops(w)}setupTabStops(w){this._normal.setupTabStops(w),this._alt.setupTabStops(w)}}i.BufferSet=f},511:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CellData=void 0;let c=o(482),p=o(643),d=o(3734);class f extends d.AttributeData{constructor(){super(...arguments),this.content=0,this.fg=0,this.bg=0,this.extended=new d.ExtendedAttrs,this.combinedData=""}static fromCharData(w){let b=new f;return b.setFromCharData(w),b}isCombined(){return 2097152&this.content}getWidth(){return this.content>>22}getChars(){return 2097152&this.content?this.combinedData:2097151&this.content?(0,c.stringFromCodePoint)(2097151&this.content):""}getCode(){return this.isCombined()?this.combinedData.charCodeAt(this.combinedData.length-1):2097151&this.content}setFromCharData(w){this.fg=w[p.CHAR_DATA_ATTR_INDEX],this.bg=0;let b=!1;if(w[p.CHAR_DATA_CHAR_INDEX].length>2)b=!0;else if(w[p.CHAR_DATA_CHAR_INDEX].length===2){let r=w[p.CHAR_DATA_CHAR_INDEX].charCodeAt(0);if(55296<=r&&r<=56319){let l=w[p.CHAR_DATA_CHAR_INDEX].charCodeAt(1);56320<=l&&l<=57343?this.content=1024*(r-55296)+l-56320+65536|w[p.CHAR_DATA_WIDTH_INDEX]<<22:b=!0}else b=!0}else this.content=w[p.CHAR_DATA_CHAR_INDEX].charCodeAt(0)|w[p.CHAR_DATA_WIDTH_INDEX]<<22;b&&(this.combinedData=w[p.CHAR_DATA_CHAR_INDEX],this.content=2097152|w[p.CHAR_DATA_WIDTH_INDEX]<<22)}getAsCharData(){return[this.fg,this.getChars(),this.getWidth(),this.getCode()]}}i.CellData=f},643:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.WHITESPACE_CELL_CODE=i.WHITESPACE_CELL_WIDTH=i.WHITESPACE_CELL_CHAR=i.NULL_CELL_CODE=i.NULL_CELL_WIDTH=i.NULL_CELL_CHAR=i.CHAR_DATA_CODE_INDEX=i.CHAR_DATA_WIDTH_INDEX=i.CHAR_DATA_CHAR_INDEX=i.CHAR_DATA_ATTR_INDEX=i.DEFAULT_EXT=i.DEFAULT_ATTR=i.DEFAULT_COLOR=void 0,i.DEFAULT_COLOR=0,i.DEFAULT_ATTR=256|i.DEFAULT_COLOR<<9,i.DEFAULT_EXT=0,i.CHAR_DATA_ATTR_INDEX=0,i.CHAR_DATA_CHAR_INDEX=1,i.CHAR_DATA_WIDTH_INDEX=2,i.CHAR_DATA_CODE_INDEX=3,i.NULL_CELL_CHAR="",i.NULL_CELL_WIDTH=1,i.NULL_CELL_CODE=0,i.WHITESPACE_CELL_CHAR=" ",i.WHITESPACE_CELL_WIDTH=1,i.WHITESPACE_CELL_CODE=32},4863:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Marker=void 0;let c=o(8460),p=o(844);class d{get id(){return this._id}constructor(g){this.line=g,this.isDisposed=!1,this._disposables=[],this._id=d._nextId++,this._onDispose=this.register(new c.EventEmitter),this.onDispose=this._onDispose.event}dispose(){this.isDisposed||(this.isDisposed=!0,this.line=-1,this._onDispose.fire(),(0,p.disposeArray)(this._disposables),this._disposables.length=0)}register(g){return this._disposables.push(g),g}}i.Marker=d,d._nextId=1},7116:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DEFAULT_CHARSET=i.CHARSETS=void 0,i.CHARSETS={},i.DEFAULT_CHARSET=i.CHARSETS.B,i.CHARSETS[0]={"`":"\u25C6",a:"\u2592",b:"\u2409",c:"\u240C",d:"\u240D",e:"\u240A",f:"\xB0",g:"\xB1",h:"\u2424",i:"\u240B",j:"\u2518",k:"\u2510",l:"\u250C",m:"\u2514",n:"\u253C",o:"\u23BA",p:"\u23BB",q:"\u2500",r:"\u23BC",s:"\u23BD",t:"\u251C",u:"\u2524",v:"\u2534",w:"\u252C",x:"\u2502",y:"\u2264",z:"\u2265","{":"\u03C0","|":"\u2260","}":"\xA3","~":"\xB7"},i.CHARSETS.A={"#":"\xA3"},i.CHARSETS.B=void 0,i.CHARSETS[4]={"#":"\xA3","@":"\xBE","[":"ij","\\":"\xBD","]":"|","{":"\xA8","|":"f","}":"\xBC","~":"\xB4"},i.CHARSETS.C=i.CHARSETS[5]={"[":"\xC4","\\":"\xD6","]":"\xC5","^":"\xDC","`":"\xE9","{":"\xE4","|":"\xF6","}":"\xE5","~":"\xFC"},i.CHARSETS.R={"#":"\xA3","@":"\xE0","[":"\xB0","\\":"\xE7","]":"\xA7","{":"\xE9","|":"\xF9","}":"\xE8","~":"\xA8"},i.CHARSETS.Q={"@":"\xE0","[":"\xE2","\\":"\xE7","]":"\xEA","^":"\xEE","`":"\xF4","{":"\xE9","|":"\xF9","}":"\xE8","~":"\xFB"},i.CHARSETS.K={"@":"\xA7","[":"\xC4","\\":"\xD6","]":"\xDC","{":"\xE4","|":"\xF6","}":"\xFC","~":"\xDF"},i.CHARSETS.Y={"#":"\xA3","@":"\xA7","[":"\xB0","\\":"\xE7","]":"\xE9","`":"\xF9","{":"\xE0","|":"\xF2","}":"\xE8","~":"\xEC"},i.CHARSETS.E=i.CHARSETS[6]={"@":"\xC4","[":"\xC6","\\":"\xD8","]":"\xC5","^":"\xDC","`":"\xE4","{":"\xE6","|":"\xF8","}":"\xE5","~":"\xFC"},i.CHARSETS.Z={"#":"\xA3","@":"\xA7","[":"\xA1","\\":"\xD1","]":"\xBF","{":"\xB0","|":"\xF1","}":"\xE7"},i.CHARSETS.H=i.CHARSETS[7]={"@":"\xC9","[":"\xC4","\\":"\xD6","]":"\xC5","^":"\xDC","`":"\xE9","{":"\xE4","|":"\xF6","}":"\xE5","~":"\xFC"},i.CHARSETS["="]={"#":"\xF9","@":"\xE0","[":"\xE9","\\":"\xE7","]":"\xEA","^":"\xEE",_:"\xE8","`":"\xF4","{":"\xE4","|":"\xF6","}":"\xFC","~":"\xFB"}},2584:(u,i)=>{var o,c,p;Object.defineProperty(i,"__esModule",{value:!0}),i.C1_ESCAPED=i.C1=i.C0=void 0,(function(d){d.NUL="\0",d.SOH="",d.STX="",d.ETX="",d.EOT="",d.ENQ="",d.ACK="",d.BEL="\x07",d.BS="\b",d.HT="	",d.LF=`
`,d.VT="\v",d.FF="\f",d.CR="\r",d.SO="",d.SI="",d.DLE="",d.DC1="",d.DC2="",d.DC3="",d.DC4="",d.NAK="",d.SYN="",d.ETB="",d.CAN="",d.EM="",d.SUB="",d.ESC="\x1B",d.FS="",d.GS="",d.RS="",d.US="",d.SP=" ",d.DEL="\x7F"})(o||(i.C0=o={})),(function(d){d.PAD="\x80",d.HOP="\x81",d.BPH="\x82",d.NBH="\x83",d.IND="\x84",d.NEL="\x85",d.SSA="\x86",d.ESA="\x87",d.HTS="\x88",d.HTJ="\x89",d.VTS="\x8A",d.PLD="\x8B",d.PLU="\x8C",d.RI="\x8D",d.SS2="\x8E",d.SS3="\x8F",d.DCS="\x90",d.PU1="\x91",d.PU2="\x92",d.STS="\x93",d.CCH="\x94",d.MW="\x95",d.SPA="\x96",d.EPA="\x97",d.SOS="\x98",d.SGCI="\x99",d.SCI="\x9A",d.CSI="\x9B",d.ST="\x9C",d.OSC="\x9D",d.PM="\x9E",d.APC="\x9F"})(c||(i.C1=c={})),(function(d){d.ST=`${o.ESC}\\`})(p||(i.C1_ESCAPED=p={}))},7399:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.evaluateKeyboardEvent=void 0;let c=o(2584),p={48:["0",")"],49:["1","!"],50:["2","@"],51:["3","#"],52:["4","$"],53:["5","%"],54:["6","^"],55:["7","&"],56:["8","*"],57:["9","("],186:[";",":"],187:["=","+"],188:[",","<"],189:["-","_"],190:[".",">"],191:["/","?"],192:["`","~"],219:["[","{"],220:["\\","|"],221:["]","}"],222:["'",'"']};i.evaluateKeyboardEvent=function(d,f,g,w){let b={type:0,cancel:!1,key:void 0},r=(d.shiftKey?1:0)|(d.altKey?2:0)|(d.ctrlKey?4:0)|(d.metaKey?8:0);switch(d.keyCode){case 0:d.key==="UIKeyInputUpArrow"?b.key=f?c.C0.ESC+"OA":c.C0.ESC+"[A":d.key==="UIKeyInputLeftArrow"?b.key=f?c.C0.ESC+"OD":c.C0.ESC+"[D":d.key==="UIKeyInputRightArrow"?b.key=f?c.C0.ESC+"OC":c.C0.ESC+"[C":d.key==="UIKeyInputDownArrow"&&(b.key=f?c.C0.ESC+"OB":c.C0.ESC+"[B");break;case 8:if(d.altKey){b.key=c.C0.ESC+c.C0.DEL;break}b.key=c.C0.DEL;break;case 9:if(d.shiftKey){b.key=c.C0.ESC+"[Z";break}b.key=c.C0.HT,b.cancel=!0;break;case 13:b.key=d.altKey?c.C0.ESC+c.C0.CR:c.C0.CR,b.cancel=!0;break;case 27:b.key=c.C0.ESC,d.altKey&&(b.key=c.C0.ESC+c.C0.ESC),b.cancel=!0;break;case 37:if(d.metaKey)break;r?(b.key=c.C0.ESC+"[1;"+(r+1)+"D",b.key===c.C0.ESC+"[1;3D"&&(b.key=c.C0.ESC+(g?"b":"[1;5D"))):b.key=f?c.C0.ESC+"OD":c.C0.ESC+"[D";break;case 39:if(d.metaKey)break;r?(b.key=c.C0.ESC+"[1;"+(r+1)+"C",b.key===c.C0.ESC+"[1;3C"&&(b.key=c.C0.ESC+(g?"f":"[1;5C"))):b.key=f?c.C0.ESC+"OC":c.C0.ESC+"[C";break;case 38:if(d.metaKey)break;r?(b.key=c.C0.ESC+"[1;"+(r+1)+"A",g||b.key!==c.C0.ESC+"[1;3A"||(b.key=c.C0.ESC+"[1;5A")):b.key=f?c.C0.ESC+"OA":c.C0.ESC+"[A";break;case 40:if(d.metaKey)break;r?(b.key=c.C0.ESC+"[1;"+(r+1)+"B",g||b.key!==c.C0.ESC+"[1;3B"||(b.key=c.C0.ESC+"[1;5B")):b.key=f?c.C0.ESC+"OB":c.C0.ESC+"[B";break;case 45:d.shiftKey||d.ctrlKey||(b.key=c.C0.ESC+"[2~");break;case 46:b.key=r?c.C0.ESC+"[3;"+(r+1)+"~":c.C0.ESC+"[3~";break;case 36:b.key=r?c.C0.ESC+"[1;"+(r+1)+"H":f?c.C0.ESC+"OH":c.C0.ESC+"[H";break;case 35:b.key=r?c.C0.ESC+"[1;"+(r+1)+"F":f?c.C0.ESC+"OF":c.C0.ESC+"[F";break;case 33:d.shiftKey?b.type=2:d.ctrlKey?b.key=c.C0.ESC+"[5;"+(r+1)+"~":b.key=c.C0.ESC+"[5~";break;case 34:d.shiftKey?b.type=3:d.ctrlKey?b.key=c.C0.ESC+"[6;"+(r+1)+"~":b.key=c.C0.ESC+"[6~";break;case 112:b.key=r?c.C0.ESC+"[1;"+(r+1)+"P":c.C0.ESC+"OP";break;case 113:b.key=r?c.C0.ESC+"[1;"+(r+1)+"Q":c.C0.ESC+"OQ";break;case 114:b.key=r?c.C0.ESC+"[1;"+(r+1)+"R":c.C0.ESC+"OR";break;case 115:b.key=r?c.C0.ESC+"[1;"+(r+1)+"S":c.C0.ESC+"OS";break;case 116:b.key=r?c.C0.ESC+"[15;"+(r+1)+"~":c.C0.ESC+"[15~";break;case 117:b.key=r?c.C0.ESC+"[17;"+(r+1)+"~":c.C0.ESC+"[17~";break;case 118:b.key=r?c.C0.ESC+"[18;"+(r+1)+"~":c.C0.ESC+"[18~";break;case 119:b.key=r?c.C0.ESC+"[19;"+(r+1)+"~":c.C0.ESC+"[19~";break;case 120:b.key=r?c.C0.ESC+"[20;"+(r+1)+"~":c.C0.ESC+"[20~";break;case 121:b.key=r?c.C0.ESC+"[21;"+(r+1)+"~":c.C0.ESC+"[21~";break;case 122:b.key=r?c.C0.ESC+"[23;"+(r+1)+"~":c.C0.ESC+"[23~";break;case 123:b.key=r?c.C0.ESC+"[24;"+(r+1)+"~":c.C0.ESC+"[24~";break;default:if(!d.ctrlKey||d.shiftKey||d.altKey||d.metaKey)if(g&&!w||!d.altKey||d.metaKey)!g||d.altKey||d.ctrlKey||d.shiftKey||!d.metaKey?d.key&&!d.ctrlKey&&!d.altKey&&!d.metaKey&&d.keyCode>=48&&d.key.length===1?b.key=d.key:d.key&&d.ctrlKey&&(d.key==="_"&&(b.key=c.C0.US),d.key==="@"&&(b.key=c.C0.NUL)):d.keyCode===65&&(b.type=1);else{let l=p[d.keyCode],a=l?.[d.shiftKey?1:0];if(a)b.key=c.C0.ESC+a;else if(d.keyCode>=65&&d.keyCode<=90){let h=d.ctrlKey?d.keyCode-64:d.keyCode+32,m=String.fromCharCode(h);d.shiftKey&&(m=m.toUpperCase()),b.key=c.C0.ESC+m}else if(d.keyCode===32)b.key=c.C0.ESC+(d.ctrlKey?c.C0.NUL:" ");else if(d.key==="Dead"&&d.code.startsWith("Key")){let h=d.code.slice(3,4);d.shiftKey||(h=h.toLowerCase()),b.key=c.C0.ESC+h,b.cancel=!0}}else d.keyCode>=65&&d.keyCode<=90?b.key=String.fromCharCode(d.keyCode-64):d.keyCode===32?b.key=c.C0.NUL:d.keyCode>=51&&d.keyCode<=55?b.key=String.fromCharCode(d.keyCode-51+27):d.keyCode===56?b.key=c.C0.DEL:d.keyCode===219?b.key=c.C0.ESC:d.keyCode===220?b.key=c.C0.FS:d.keyCode===221&&(b.key=c.C0.GS)}return b}},482:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Utf8ToUtf32=i.StringToUtf32=i.utf32ToString=i.stringFromCodePoint=void 0,i.stringFromCodePoint=function(o){return o>65535?(o-=65536,String.fromCharCode(55296+(o>>10))+String.fromCharCode(o%1024+56320)):String.fromCharCode(o)},i.utf32ToString=function(o,c=0,p=o.length){let d="";for(let f=c;f<p;++f){let g=o[f];g>65535?(g-=65536,d+=String.fromCharCode(55296+(g>>10))+String.fromCharCode(g%1024+56320)):d+=String.fromCharCode(g)}return d},i.StringToUtf32=class{constructor(){this._interim=0}clear(){this._interim=0}decode(o,c){let p=o.length;if(!p)return 0;let d=0,f=0;if(this._interim){let g=o.charCodeAt(f++);56320<=g&&g<=57343?c[d++]=1024*(this._interim-55296)+g-56320+65536:(c[d++]=this._interim,c[d++]=g),this._interim=0}for(let g=f;g<p;++g){let w=o.charCodeAt(g);if(55296<=w&&w<=56319){if(++g>=p)return this._interim=w,d;let b=o.charCodeAt(g);56320<=b&&b<=57343?c[d++]=1024*(w-55296)+b-56320+65536:(c[d++]=w,c[d++]=b)}else w!==65279&&(c[d++]=w)}return d}},i.Utf8ToUtf32=class{constructor(){this.interim=new Uint8Array(3)}clear(){this.interim.fill(0)}decode(o,c){let p=o.length;if(!p)return 0;let d,f,g,w,b=0,r=0,l=0;if(this.interim[0]){let m=!1,v=this.interim[0];v&=(224&v)==192?31:(240&v)==224?15:7;let y,x=0;for(;(y=63&this.interim[++x])&&x<4;)v<<=6,v|=y;let _=(224&this.interim[0])==192?2:(240&this.interim[0])==224?3:4,S=_-x;for(;l<S;){if(l>=p)return 0;if(y=o[l++],(192&y)!=128){l--,m=!0;break}this.interim[x++]=y,v<<=6,v|=63&y}m||(_===2?v<128?l--:c[b++]=v:_===3?v<2048||v>=55296&&v<=57343||v===65279||(c[b++]=v):v<65536||v>1114111||(c[b++]=v)),this.interim.fill(0)}let a=p-4,h=l;for(;h<p;){for(;!(!(h<a)||128&(d=o[h])||128&(f=o[h+1])||128&(g=o[h+2])||128&(w=o[h+3]));)c[b++]=d,c[b++]=f,c[b++]=g,c[b++]=w,h+=4;if(d=o[h++],d<128)c[b++]=d;else if((224&d)==192){if(h>=p)return this.interim[0]=d,b;if(f=o[h++],(192&f)!=128){h--;continue}if(r=(31&d)<<6|63&f,r<128){h--;continue}c[b++]=r}else if((240&d)==224){if(h>=p)return this.interim[0]=d,b;if(f=o[h++],(192&f)!=128){h--;continue}if(h>=p)return this.interim[0]=d,this.interim[1]=f,b;if(g=o[h++],(192&g)!=128){h--;continue}if(r=(15&d)<<12|(63&f)<<6|63&g,r<2048||r>=55296&&r<=57343||r===65279)continue;c[b++]=r}else if((248&d)==240){if(h>=p)return this.interim[0]=d,b;if(f=o[h++],(192&f)!=128){h--;continue}if(h>=p)return this.interim[0]=d,this.interim[1]=f,b;if(g=o[h++],(192&g)!=128){h--;continue}if(h>=p)return this.interim[0]=d,this.interim[1]=f,this.interim[2]=g,b;if(w=o[h++],(192&w)!=128){h--;continue}if(r=(7&d)<<18|(63&f)<<12|(63&g)<<6|63&w,r<65536||r>1114111)continue;c[b++]=r}}return b}}},225:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.UnicodeV6=void 0;let o=[[768,879],[1155,1158],[1160,1161],[1425,1469],[1471,1471],[1473,1474],[1476,1477],[1479,1479],[1536,1539],[1552,1557],[1611,1630],[1648,1648],[1750,1764],[1767,1768],[1770,1773],[1807,1807],[1809,1809],[1840,1866],[1958,1968],[2027,2035],[2305,2306],[2364,2364],[2369,2376],[2381,2381],[2385,2388],[2402,2403],[2433,2433],[2492,2492],[2497,2500],[2509,2509],[2530,2531],[2561,2562],[2620,2620],[2625,2626],[2631,2632],[2635,2637],[2672,2673],[2689,2690],[2748,2748],[2753,2757],[2759,2760],[2765,2765],[2786,2787],[2817,2817],[2876,2876],[2879,2879],[2881,2883],[2893,2893],[2902,2902],[2946,2946],[3008,3008],[3021,3021],[3134,3136],[3142,3144],[3146,3149],[3157,3158],[3260,3260],[3263,3263],[3270,3270],[3276,3277],[3298,3299],[3393,3395],[3405,3405],[3530,3530],[3538,3540],[3542,3542],[3633,3633],[3636,3642],[3655,3662],[3761,3761],[3764,3769],[3771,3772],[3784,3789],[3864,3865],[3893,3893],[3895,3895],[3897,3897],[3953,3966],[3968,3972],[3974,3975],[3984,3991],[3993,4028],[4038,4038],[4141,4144],[4146,4146],[4150,4151],[4153,4153],[4184,4185],[4448,4607],[4959,4959],[5906,5908],[5938,5940],[5970,5971],[6002,6003],[6068,6069],[6071,6077],[6086,6086],[6089,6099],[6109,6109],[6155,6157],[6313,6313],[6432,6434],[6439,6440],[6450,6450],[6457,6459],[6679,6680],[6912,6915],[6964,6964],[6966,6970],[6972,6972],[6978,6978],[7019,7027],[7616,7626],[7678,7679],[8203,8207],[8234,8238],[8288,8291],[8298,8303],[8400,8431],[12330,12335],[12441,12442],[43014,43014],[43019,43019],[43045,43046],[64286,64286],[65024,65039],[65056,65059],[65279,65279],[65529,65531]],c=[[68097,68099],[68101,68102],[68108,68111],[68152,68154],[68159,68159],[119143,119145],[119155,119170],[119173,119179],[119210,119213],[119362,119364],[917505,917505],[917536,917631],[917760,917999]],p;i.UnicodeV6=class{constructor(){if(this.version="6",!p){p=new Uint8Array(65536),p.fill(1),p[0]=0,p.fill(0,1,32),p.fill(0,127,160),p.fill(2,4352,4448),p[9001]=2,p[9002]=2,p.fill(2,11904,42192),p[12351]=1,p.fill(2,44032,55204),p.fill(2,63744,64256),p.fill(2,65040,65050),p.fill(2,65072,65136),p.fill(2,65280,65377),p.fill(2,65504,65511);for(let d=0;d<o.length;++d)p.fill(0,o[d][0],o[d][1]+1)}}wcwidth(d){return d<32?0:d<127?1:d<65536?p[d]:(function(f,g){let w,b=0,r=g.length-1;if(f<g[0][0]||f>g[r][1])return!1;for(;r>=b;)if(w=b+r>>1,f>g[w][1])b=w+1;else{if(!(f<g[w][0]))return!0;r=w-1}return!1})(d,c)?0:d>=131072&&d<=196605||d>=196608&&d<=262141?2:1}}},5981:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.WriteBuffer=void 0;let c=o(8460),p=o(844);class d extends p.Disposable{constructor(g){super(),this._action=g,this._writeBuffer=[],this._callbacks=[],this._pendingData=0,this._bufferOffset=0,this._isSyncWriting=!1,this._syncCalls=0,this._didUserInput=!1,this._onWriteParsed=this.register(new c.EventEmitter),this.onWriteParsed=this._onWriteParsed.event}handleUserInput(){this._didUserInput=!0}writeSync(g,w){if(w!==void 0&&this._syncCalls>w)return void(this._syncCalls=0);if(this._pendingData+=g.length,this._writeBuffer.push(g),this._callbacks.push(void 0),this._syncCalls++,this._isSyncWriting)return;let b;for(this._isSyncWriting=!0;b=this._writeBuffer.shift();){this._action(b);let r=this._callbacks.shift();r&&r()}this._pendingData=0,this._bufferOffset=2147483647,this._isSyncWriting=!1,this._syncCalls=0}write(g,w){if(this._pendingData>5e7)throw new Error("write data discarded, use flow control to avoid losing data");if(!this._writeBuffer.length){if(this._bufferOffset=0,this._didUserInput)return this._didUserInput=!1,this._pendingData+=g.length,this._writeBuffer.push(g),this._callbacks.push(w),void this._innerWrite();setTimeout((()=>this._innerWrite()))}this._pendingData+=g.length,this._writeBuffer.push(g),this._callbacks.push(w)}_innerWrite(g=0,w=!0){let b=g||Date.now();for(;this._writeBuffer.length>this._bufferOffset;){let r=this._writeBuffer[this._bufferOffset],l=this._action(r,w);if(l){let h=m=>Date.now()-b>=12?setTimeout((()=>this._innerWrite(0,m))):this._innerWrite(b,m);return void l.catch((m=>(queueMicrotask((()=>{throw m})),Promise.resolve(!1)))).then(h)}let a=this._callbacks[this._bufferOffset];if(a&&a(),this._bufferOffset++,this._pendingData-=r.length,Date.now()-b>=12)break}this._writeBuffer.length>this._bufferOffset?(this._bufferOffset>50&&(this._writeBuffer=this._writeBuffer.slice(this._bufferOffset),this._callbacks=this._callbacks.slice(this._bufferOffset),this._bufferOffset=0),setTimeout((()=>this._innerWrite()))):(this._writeBuffer.length=0,this._callbacks.length=0,this._pendingData=0,this._bufferOffset=0),this._onWriteParsed.fire()}}i.WriteBuffer=d},5941:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.toRgbString=i.parseColor=void 0;let o=/^([\da-f])\/([\da-f])\/([\da-f])$|^([\da-f]{2})\/([\da-f]{2})\/([\da-f]{2})$|^([\da-f]{3})\/([\da-f]{3})\/([\da-f]{3})$|^([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})$/,c=/^[\da-f]+$/;function p(d,f){let g=d.toString(16),w=g.length<2?"0"+g:g;switch(f){case 4:return g[0];case 8:return w;case 12:return(w+w).slice(0,3);default:return w+w}}i.parseColor=function(d){if(!d)return;let f=d.toLowerCase();if(f.indexOf("rgb:")===0){f=f.slice(4);let g=o.exec(f);if(g){let w=g[1]?15:g[4]?255:g[7]?4095:65535;return[Math.round(parseInt(g[1]||g[4]||g[7]||g[10],16)/w*255),Math.round(parseInt(g[2]||g[5]||g[8]||g[11],16)/w*255),Math.round(parseInt(g[3]||g[6]||g[9]||g[12],16)/w*255)]}}else if(f.indexOf("#")===0&&(f=f.slice(1),c.exec(f)&&[3,6,9,12].includes(f.length))){let g=f.length/3,w=[0,0,0];for(let b=0;b<3;++b){let r=parseInt(f.slice(g*b,g*b+g),16);w[b]=g===1?r<<4:g===2?r:g===3?r>>4:r>>8}return w}},i.toRgbString=function(d,f=16){let[g,w,b]=d;return`rgb:${p(g,f)}/${p(w,f)}/${p(b,f)}`}},5770:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.PAYLOAD_LIMIT=void 0,i.PAYLOAD_LIMIT=1e7},6351:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DcsHandler=i.DcsParser=void 0;let c=o(482),p=o(8742),d=o(5770),f=[];i.DcsParser=class{constructor(){this._handlers=Object.create(null),this._active=f,this._ident=0,this._handlerFb=()=>{},this._stack={paused:!1,loopPosition:0,fallThrough:!1}}dispose(){this._handlers=Object.create(null),this._handlerFb=()=>{},this._active=f}registerHandler(w,b){this._handlers[w]===void 0&&(this._handlers[w]=[]);let r=this._handlers[w];return r.push(b),{dispose:()=>{let l=r.indexOf(b);l!==-1&&r.splice(l,1)}}}clearHandler(w){this._handlers[w]&&delete this._handlers[w]}setHandlerFallback(w){this._handlerFb=w}reset(){if(this._active.length)for(let w=this._stack.paused?this._stack.loopPosition-1:this._active.length-1;w>=0;--w)this._active[w].unhook(!1);this._stack.paused=!1,this._active=f,this._ident=0}hook(w,b){if(this.reset(),this._ident=w,this._active=this._handlers[w]||f,this._active.length)for(let r=this._active.length-1;r>=0;r--)this._active[r].hook(b);else this._handlerFb(this._ident,"HOOK",b)}put(w,b,r){if(this._active.length)for(let l=this._active.length-1;l>=0;l--)this._active[l].put(w,b,r);else this._handlerFb(this._ident,"PUT",(0,c.utf32ToString)(w,b,r))}unhook(w,b=!0){if(this._active.length){let r=!1,l=this._active.length-1,a=!1;if(this._stack.paused&&(l=this._stack.loopPosition-1,r=b,a=this._stack.fallThrough,this._stack.paused=!1),!a&&r===!1){for(;l>=0&&(r=this._active[l].unhook(w),r!==!0);l--)if(r instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=l,this._stack.fallThrough=!1,r;l--}for(;l>=0;l--)if(r=this._active[l].unhook(!1),r instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=l,this._stack.fallThrough=!0,r}else this._handlerFb(this._ident,"UNHOOK",w);this._active=f,this._ident=0}};let g=new p.Params;g.addParam(0),i.DcsHandler=class{constructor(w){this._handler=w,this._data="",this._params=g,this._hitLimit=!1}hook(w){this._params=w.length>1||w.params[0]?w.clone():g,this._data="",this._hitLimit=!1}put(w,b,r){this._hitLimit||(this._data+=(0,c.utf32ToString)(w,b,r),this._data.length>d.PAYLOAD_LIMIT&&(this._data="",this._hitLimit=!0))}unhook(w){let b=!1;if(this._hitLimit)b=!1;else if(w&&(b=this._handler(this._data,this._params),b instanceof Promise))return b.then((r=>(this._params=g,this._data="",this._hitLimit=!1,r)));return this._params=g,this._data="",this._hitLimit=!1,b}}},2015:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.EscapeSequenceParser=i.VT500_TRANSITION_TABLE=i.TransitionTable=void 0;let c=o(844),p=o(8742),d=o(6242),f=o(6351);class g{constructor(l){this.table=new Uint8Array(l)}setDefault(l,a){this.table.fill(l<<4|a)}add(l,a,h,m){this.table[a<<8|l]=h<<4|m}addMany(l,a,h,m){for(let v=0;v<l.length;v++)this.table[a<<8|l[v]]=h<<4|m}}i.TransitionTable=g;let w=160;i.VT500_TRANSITION_TABLE=(function(){let r=new g(4095),l=Array.apply(null,Array(256)).map(((x,_)=>_)),a=(x,_)=>l.slice(x,_),h=a(32,127),m=a(0,24);m.push(25),m.push.apply(m,a(28,32));let v=a(0,14),y;for(y in r.setDefault(1,0),r.addMany(h,0,2,0),v)r.addMany([24,26,153,154],y,3,0),r.addMany(a(128,144),y,3,0),r.addMany(a(144,152),y,3,0),r.add(156,y,0,0),r.add(27,y,11,1),r.add(157,y,4,8),r.addMany([152,158,159],y,0,7),r.add(155,y,11,3),r.add(144,y,11,9);return r.addMany(m,0,3,0),r.addMany(m,1,3,1),r.add(127,1,0,1),r.addMany(m,8,0,8),r.addMany(m,3,3,3),r.add(127,3,0,3),r.addMany(m,4,3,4),r.add(127,4,0,4),r.addMany(m,6,3,6),r.addMany(m,5,3,5),r.add(127,5,0,5),r.addMany(m,2,3,2),r.add(127,2,0,2),r.add(93,1,4,8),r.addMany(h,8,5,8),r.add(127,8,5,8),r.addMany([156,27,24,26,7],8,6,0),r.addMany(a(28,32),8,0,8),r.addMany([88,94,95],1,0,7),r.addMany(h,7,0,7),r.addMany(m,7,0,7),r.add(156,7,0,0),r.add(127,7,0,7),r.add(91,1,11,3),r.addMany(a(64,127),3,7,0),r.addMany(a(48,60),3,8,4),r.addMany([60,61,62,63],3,9,4),r.addMany(a(48,60),4,8,4),r.addMany(a(64,127),4,7,0),r.addMany([60,61,62,63],4,0,6),r.addMany(a(32,64),6,0,6),r.add(127,6,0,6),r.addMany(a(64,127),6,0,0),r.addMany(a(32,48),3,9,5),r.addMany(a(32,48),5,9,5),r.addMany(a(48,64),5,0,6),r.addMany(a(64,127),5,7,0),r.addMany(a(32,48),4,9,5),r.addMany(a(32,48),1,9,2),r.addMany(a(32,48),2,9,2),r.addMany(a(48,127),2,10,0),r.addMany(a(48,80),1,10,0),r.addMany(a(81,88),1,10,0),r.addMany([89,90,92],1,10,0),r.addMany(a(96,127),1,10,0),r.add(80,1,11,9),r.addMany(m,9,0,9),r.add(127,9,0,9),r.addMany(a(28,32),9,0,9),r.addMany(a(32,48),9,9,12),r.addMany(a(48,60),9,8,10),r.addMany([60,61,62,63],9,9,10),r.addMany(m,11,0,11),r.addMany(a(32,128),11,0,11),r.addMany(a(28,32),11,0,11),r.addMany(m,10,0,10),r.add(127,10,0,10),r.addMany(a(28,32),10,0,10),r.addMany(a(48,60),10,8,10),r.addMany([60,61,62,63],10,0,11),r.addMany(a(32,48),10,9,12),r.addMany(m,12,0,12),r.add(127,12,0,12),r.addMany(a(28,32),12,0,12),r.addMany(a(32,48),12,9,12),r.addMany(a(48,64),12,0,11),r.addMany(a(64,127),12,12,13),r.addMany(a(64,127),10,12,13),r.addMany(a(64,127),9,12,13),r.addMany(m,13,13,13),r.addMany(h,13,13,13),r.add(127,13,0,13),r.addMany([27,156,24,26],13,14,0),r.add(w,0,2,0),r.add(w,8,5,8),r.add(w,6,0,6),r.add(w,11,0,11),r.add(w,13,13,13),r})();class b extends c.Disposable{constructor(l=i.VT500_TRANSITION_TABLE){super(),this._transitions=l,this._parseStack={state:0,handlers:[],handlerPos:0,transition:0,chunkPos:0},this.initialState=0,this.currentState=this.initialState,this._params=new p.Params,this._params.addParam(0),this._collect=0,this.precedingCodepoint=0,this._printHandlerFb=(a,h,m)=>{},this._executeHandlerFb=a=>{},this._csiHandlerFb=(a,h)=>{},this._escHandlerFb=a=>{},this._errorHandlerFb=a=>a,this._printHandler=this._printHandlerFb,this._executeHandlers=Object.create(null),this._csiHandlers=Object.create(null),this._escHandlers=Object.create(null),this.register((0,c.toDisposable)((()=>{this._csiHandlers=Object.create(null),this._executeHandlers=Object.create(null),this._escHandlers=Object.create(null)}))),this._oscParser=this.register(new d.OscParser),this._dcsParser=this.register(new f.DcsParser),this._errorHandler=this._errorHandlerFb,this.registerEscHandler({final:"\\"},(()=>!0))}_identifier(l,a=[64,126]){let h=0;if(l.prefix){if(l.prefix.length>1)throw new Error("only one byte as prefix supported");if(h=l.prefix.charCodeAt(0),h&&60>h||h>63)throw new Error("prefix must be in range 0x3c .. 0x3f")}if(l.intermediates){if(l.intermediates.length>2)throw new Error("only two bytes as intermediates are supported");for(let v=0;v<l.intermediates.length;++v){let y=l.intermediates.charCodeAt(v);if(32>y||y>47)throw new Error("intermediate must be in range 0x20 .. 0x2f");h<<=8,h|=y}}if(l.final.length!==1)throw new Error("final must be a single byte");let m=l.final.charCodeAt(0);if(a[0]>m||m>a[1])throw new Error(`final must be in range ${a[0]} .. ${a[1]}`);return h<<=8,h|=m,h}identToString(l){let a=[];for(;l;)a.push(String.fromCharCode(255&l)),l>>=8;return a.reverse().join("")}setPrintHandler(l){this._printHandler=l}clearPrintHandler(){this._printHandler=this._printHandlerFb}registerEscHandler(l,a){let h=this._identifier(l,[48,126]);this._escHandlers[h]===void 0&&(this._escHandlers[h]=[]);let m=this._escHandlers[h];return m.push(a),{dispose:()=>{let v=m.indexOf(a);v!==-1&&m.splice(v,1)}}}clearEscHandler(l){this._escHandlers[this._identifier(l,[48,126])]&&delete this._escHandlers[this._identifier(l,[48,126])]}setEscHandlerFallback(l){this._escHandlerFb=l}setExecuteHandler(l,a){this._executeHandlers[l.charCodeAt(0)]=a}clearExecuteHandler(l){this._executeHandlers[l.charCodeAt(0)]&&delete this._executeHandlers[l.charCodeAt(0)]}setExecuteHandlerFallback(l){this._executeHandlerFb=l}registerCsiHandler(l,a){let h=this._identifier(l);this._csiHandlers[h]===void 0&&(this._csiHandlers[h]=[]);let m=this._csiHandlers[h];return m.push(a),{dispose:()=>{let v=m.indexOf(a);v!==-1&&m.splice(v,1)}}}clearCsiHandler(l){this._csiHandlers[this._identifier(l)]&&delete this._csiHandlers[this._identifier(l)]}setCsiHandlerFallback(l){this._csiHandlerFb=l}registerDcsHandler(l,a){return this._dcsParser.registerHandler(this._identifier(l),a)}clearDcsHandler(l){this._dcsParser.clearHandler(this._identifier(l))}setDcsHandlerFallback(l){this._dcsParser.setHandlerFallback(l)}registerOscHandler(l,a){return this._oscParser.registerHandler(l,a)}clearOscHandler(l){this._oscParser.clearHandler(l)}setOscHandlerFallback(l){this._oscParser.setHandlerFallback(l)}setErrorHandler(l){this._errorHandler=l}clearErrorHandler(){this._errorHandler=this._errorHandlerFb}reset(){this.currentState=this.initialState,this._oscParser.reset(),this._dcsParser.reset(),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0,this._parseStack.state!==0&&(this._parseStack.state=2,this._parseStack.handlers=[])}_preserveStack(l,a,h,m,v){this._parseStack.state=l,this._parseStack.handlers=a,this._parseStack.handlerPos=h,this._parseStack.transition=m,this._parseStack.chunkPos=v}parse(l,a,h){let m,v=0,y=0,x=0;if(this._parseStack.state)if(this._parseStack.state===2)this._parseStack.state=0,x=this._parseStack.chunkPos+1;else{if(h===void 0||this._parseStack.state===1)throw this._parseStack.state=1,new Error("improper continuation due to previous async handler, giving up parsing");let _=this._parseStack.handlers,S=this._parseStack.handlerPos-1;switch(this._parseStack.state){case 3:if(h===!1&&S>-1){for(;S>=0&&(m=_[S](this._params),m!==!0);S--)if(m instanceof Promise)return this._parseStack.handlerPos=S,m}this._parseStack.handlers=[];break;case 4:if(h===!1&&S>-1){for(;S>=0&&(m=_[S](),m!==!0);S--)if(m instanceof Promise)return this._parseStack.handlerPos=S,m}this._parseStack.handlers=[];break;case 6:if(v=l[this._parseStack.chunkPos],m=this._dcsParser.unhook(v!==24&&v!==26,h),m)return m;v===27&&(this._parseStack.transition|=1),this._params.reset(),this._params.addParam(0),this._collect=0;break;case 5:if(v=l[this._parseStack.chunkPos],m=this._oscParser.end(v!==24&&v!==26,h),m)return m;v===27&&(this._parseStack.transition|=1),this._params.reset(),this._params.addParam(0),this._collect=0}this._parseStack.state=0,x=this._parseStack.chunkPos+1,this.precedingCodepoint=0,this.currentState=15&this._parseStack.transition}for(let _=x;_<a;++_){switch(v=l[_],y=this._transitions.table[this.currentState<<8|(v<160?v:w)],y>>4){case 2:for(let M=_+1;;++M){if(M>=a||(v=l[M])<32||v>126&&v<w){this._printHandler(l,_,M),_=M-1;break}if(++M>=a||(v=l[M])<32||v>126&&v<w){this._printHandler(l,_,M),_=M-1;break}if(++M>=a||(v=l[M])<32||v>126&&v<w){this._printHandler(l,_,M),_=M-1;break}if(++M>=a||(v=l[M])<32||v>126&&v<w){this._printHandler(l,_,M),_=M-1;break}}break;case 3:this._executeHandlers[v]?this._executeHandlers[v]():this._executeHandlerFb(v),this.precedingCodepoint=0;break;case 0:break;case 1:if(this._errorHandler({position:_,code:v,currentState:this.currentState,collect:this._collect,params:this._params,abort:!1}).abort)return;break;case 7:let S=this._csiHandlers[this._collect<<8|v],L=S?S.length-1:-1;for(;L>=0&&(m=S[L](this._params),m!==!0);L--)if(m instanceof Promise)return this._preserveStack(3,S,L,y,_),m;L<0&&this._csiHandlerFb(this._collect<<8|v,this._params),this.precedingCodepoint=0;break;case 8:do switch(v){case 59:this._params.addParam(0);break;case 58:this._params.addSubParam(-1);break;default:this._params.addDigit(v-48)}while(++_<a&&(v=l[_])>47&&v<60);_--;break;case 9:this._collect<<=8,this._collect|=v;break;case 10:let O=this._escHandlers[this._collect<<8|v],D=O?O.length-1:-1;for(;D>=0&&(m=O[D](),m!==!0);D--)if(m instanceof Promise)return this._preserveStack(4,O,D,y,_),m;D<0&&this._escHandlerFb(this._collect<<8|v),this.precedingCodepoint=0;break;case 11:this._params.reset(),this._params.addParam(0),this._collect=0;break;case 12:this._dcsParser.hook(this._collect<<8|v,this._params);break;case 13:for(let M=_+1;;++M)if(M>=a||(v=l[M])===24||v===26||v===27||v>127&&v<w){this._dcsParser.put(l,_,M),_=M-1;break}break;case 14:if(m=this._dcsParser.unhook(v!==24&&v!==26),m)return this._preserveStack(6,[],0,y,_),m;v===27&&(y|=1),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0;break;case 4:this._oscParser.start();break;case 5:for(let M=_+1;;M++)if(M>=a||(v=l[M])<32||v>127&&v<w){this._oscParser.put(l,_,M),_=M-1;break}break;case 6:if(m=this._oscParser.end(v!==24&&v!==26),m)return this._preserveStack(5,[],0,y,_),m;v===27&&(y|=1),this._params.reset(),this._params.addParam(0),this._collect=0,this.precedingCodepoint=0}this.currentState=15&y}}}i.EscapeSequenceParser=b},6242:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.OscHandler=i.OscParser=void 0;let c=o(5770),p=o(482),d=[];i.OscParser=class{constructor(){this._state=0,this._active=d,this._id=-1,this._handlers=Object.create(null),this._handlerFb=()=>{},this._stack={paused:!1,loopPosition:0,fallThrough:!1}}registerHandler(f,g){this._handlers[f]===void 0&&(this._handlers[f]=[]);let w=this._handlers[f];return w.push(g),{dispose:()=>{let b=w.indexOf(g);b!==-1&&w.splice(b,1)}}}clearHandler(f){this._handlers[f]&&delete this._handlers[f]}setHandlerFallback(f){this._handlerFb=f}dispose(){this._handlers=Object.create(null),this._handlerFb=()=>{},this._active=d}reset(){if(this._state===2)for(let f=this._stack.paused?this._stack.loopPosition-1:this._active.length-1;f>=0;--f)this._active[f].end(!1);this._stack.paused=!1,this._active=d,this._id=-1,this._state=0}_start(){if(this._active=this._handlers[this._id]||d,this._active.length)for(let f=this._active.length-1;f>=0;f--)this._active[f].start();else this._handlerFb(this._id,"START")}_put(f,g,w){if(this._active.length)for(let b=this._active.length-1;b>=0;b--)this._active[b].put(f,g,w);else this._handlerFb(this._id,"PUT",(0,p.utf32ToString)(f,g,w))}start(){this.reset(),this._state=1}put(f,g,w){if(this._state!==3){if(this._state===1)for(;g<w;){let b=f[g++];if(b===59){this._state=2,this._start();break}if(b<48||57<b)return void(this._state=3);this._id===-1&&(this._id=0),this._id=10*this._id+b-48}this._state===2&&w-g>0&&this._put(f,g,w)}}end(f,g=!0){if(this._state!==0){if(this._state!==3)if(this._state===1&&this._start(),this._active.length){let w=!1,b=this._active.length-1,r=!1;if(this._stack.paused&&(b=this._stack.loopPosition-1,w=g,r=this._stack.fallThrough,this._stack.paused=!1),!r&&w===!1){for(;b>=0&&(w=this._active[b].end(f),w!==!0);b--)if(w instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=b,this._stack.fallThrough=!1,w;b--}for(;b>=0;b--)if(w=this._active[b].end(!1),w instanceof Promise)return this._stack.paused=!0,this._stack.loopPosition=b,this._stack.fallThrough=!0,w}else this._handlerFb(this._id,"END",f);this._active=d,this._id=-1,this._state=0}}},i.OscHandler=class{constructor(f){this._handler=f,this._data="",this._hitLimit=!1}start(){this._data="",this._hitLimit=!1}put(f,g,w){this._hitLimit||(this._data+=(0,p.utf32ToString)(f,g,w),this._data.length>c.PAYLOAD_LIMIT&&(this._data="",this._hitLimit=!0))}end(f){let g=!1;if(this._hitLimit)g=!1;else if(f&&(g=this._handler(this._data),g instanceof Promise))return g.then((w=>(this._data="",this._hitLimit=!1,w)));return this._data="",this._hitLimit=!1,g}}},8742:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.Params=void 0;let o=2147483647;class c{static fromArray(d){let f=new c;if(!d.length)return f;for(let g=Array.isArray(d[0])?1:0;g<d.length;++g){let w=d[g];if(Array.isArray(w))for(let b=0;b<w.length;++b)f.addSubParam(w[b]);else f.addParam(w)}return f}constructor(d=32,f=32){if(this.maxLength=d,this.maxSubParamsLength=f,f>256)throw new Error("maxSubParamsLength must not be greater than 256");this.params=new Int32Array(d),this.length=0,this._subParams=new Int32Array(f),this._subParamsLength=0,this._subParamsIdx=new Uint16Array(d),this._rejectDigits=!1,this._rejectSubDigits=!1,this._digitIsSub=!1}clone(){let d=new c(this.maxLength,this.maxSubParamsLength);return d.params.set(this.params),d.length=this.length,d._subParams.set(this._subParams),d._subParamsLength=this._subParamsLength,d._subParamsIdx.set(this._subParamsIdx),d._rejectDigits=this._rejectDigits,d._rejectSubDigits=this._rejectSubDigits,d._digitIsSub=this._digitIsSub,d}toArray(){let d=[];for(let f=0;f<this.length;++f){d.push(this.params[f]);let g=this._subParamsIdx[f]>>8,w=255&this._subParamsIdx[f];w-g>0&&d.push(Array.prototype.slice.call(this._subParams,g,w))}return d}reset(){this.length=0,this._subParamsLength=0,this._rejectDigits=!1,this._rejectSubDigits=!1,this._digitIsSub=!1}addParam(d){if(this._digitIsSub=!1,this.length>=this.maxLength)this._rejectDigits=!0;else{if(d<-1)throw new Error("values lesser than -1 are not allowed");this._subParamsIdx[this.length]=this._subParamsLength<<8|this._subParamsLength,this.params[this.length++]=d>o?o:d}}addSubParam(d){if(this._digitIsSub=!0,this.length)if(this._rejectDigits||this._subParamsLength>=this.maxSubParamsLength)this._rejectSubDigits=!0;else{if(d<-1)throw new Error("values lesser than -1 are not allowed");this._subParams[this._subParamsLength++]=d>o?o:d,this._subParamsIdx[this.length-1]++}}hasSubParams(d){return(255&this._subParamsIdx[d])-(this._subParamsIdx[d]>>8)>0}getSubParams(d){let f=this._subParamsIdx[d]>>8,g=255&this._subParamsIdx[d];return g-f>0?this._subParams.subarray(f,g):null}getSubParamsAll(){let d={};for(let f=0;f<this.length;++f){let g=this._subParamsIdx[f]>>8,w=255&this._subParamsIdx[f];w-g>0&&(d[f]=this._subParams.slice(g,w))}return d}addDigit(d){let f;if(this._rejectDigits||!(f=this._digitIsSub?this._subParamsLength:this.length)||this._digitIsSub&&this._rejectSubDigits)return;let g=this._digitIsSub?this._subParams:this.params,w=g[f-1];g[f-1]=~w?Math.min(10*w+d,o):d}}i.Params=c},5741:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.AddonManager=void 0,i.AddonManager=class{constructor(){this._addons=[]}dispose(){for(let o=this._addons.length-1;o>=0;o--)this._addons[o].instance.dispose()}loadAddon(o,c){let p={instance:c,dispose:c.dispose,isDisposed:!1};this._addons.push(p),c.dispose=()=>this._wrappedAddonDispose(p),c.activate(o)}_wrappedAddonDispose(o){if(o.isDisposed)return;let c=-1;for(let p=0;p<this._addons.length;p++)if(this._addons[p]===o){c=p;break}if(c===-1)throw new Error("Could not dispose an addon that has not been loaded");o.isDisposed=!0,o.dispose.apply(o.instance),this._addons.splice(c,1)}}},8771:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferApiView=void 0;let c=o(3785),p=o(511);i.BufferApiView=class{constructor(d,f){this._buffer=d,this.type=f}init(d){return this._buffer=d,this}get cursorY(){return this._buffer.y}get cursorX(){return this._buffer.x}get viewportY(){return this._buffer.ydisp}get baseY(){return this._buffer.ybase}get length(){return this._buffer.lines.length}getLine(d){let f=this._buffer.lines.get(d);if(f)return new c.BufferLineApiView(f)}getNullCell(){return new p.CellData}}},3785:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferLineApiView=void 0;let c=o(511);i.BufferLineApiView=class{constructor(p){this._line=p}get isWrapped(){return this._line.isWrapped}get length(){return this._line.length}getCell(p,d){if(!(p<0||p>=this._line.length))return d?(this._line.loadCell(p,d),d):this._line.loadCell(p,new c.CellData)}translateToString(p,d,f){return this._line.translateToString(p,d,f)}}},8285:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.BufferNamespaceApi=void 0;let c=o(8771),p=o(8460),d=o(844);class f extends d.Disposable{constructor(w){super(),this._core=w,this._onBufferChange=this.register(new p.EventEmitter),this.onBufferChange=this._onBufferChange.event,this._normal=new c.BufferApiView(this._core.buffers.normal,"normal"),this._alternate=new c.BufferApiView(this._core.buffers.alt,"alternate"),this._core.buffers.onBufferActivate((()=>this._onBufferChange.fire(this.active)))}get active(){if(this._core.buffers.active===this._core.buffers.normal)return this.normal;if(this._core.buffers.active===this._core.buffers.alt)return this.alternate;throw new Error("Active buffer is neither normal nor alternate")}get normal(){return this._normal.init(this._core.buffers.normal)}get alternate(){return this._alternate.init(this._core.buffers.alt)}}i.BufferNamespaceApi=f},7975:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.ParserApi=void 0,i.ParserApi=class{constructor(o){this._core=o}registerCsiHandler(o,c){return this._core.registerCsiHandler(o,(p=>c(p.toArray())))}addCsiHandler(o,c){return this.registerCsiHandler(o,c)}registerDcsHandler(o,c){return this._core.registerDcsHandler(o,((p,d)=>c(p,d.toArray())))}addDcsHandler(o,c){return this.registerDcsHandler(o,c)}registerEscHandler(o,c){return this._core.registerEscHandler(o,c)}addEscHandler(o,c){return this.registerEscHandler(o,c)}registerOscHandler(o,c){return this._core.registerOscHandler(o,c)}addOscHandler(o,c){return this.registerOscHandler(o,c)}}},7090:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.UnicodeApi=void 0,i.UnicodeApi=class{constructor(o){this._core=o}register(o){this._core.unicodeService.register(o)}get versions(){return this._core.unicodeService.versions}get activeVersion(){return this._core.unicodeService.activeVersion}set activeVersion(o){this._core.unicodeService.activeVersion=o}}},744:function(u,i,o){var c=this&&this.__decorate||function(r,l,a,h){var m,v=arguments.length,y=v<3?l:h===null?h=Object.getOwnPropertyDescriptor(l,a):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(r,l,a,h);else for(var x=r.length-1;x>=0;x--)(m=r[x])&&(y=(v<3?m(y):v>3?m(l,a,y):m(l,a))||y);return v>3&&y&&Object.defineProperty(l,a,y),y},p=this&&this.__param||function(r,l){return function(a,h){l(a,h,r)}};Object.defineProperty(i,"__esModule",{value:!0}),i.BufferService=i.MINIMUM_ROWS=i.MINIMUM_COLS=void 0;let d=o(8460),f=o(844),g=o(5295),w=o(2585);i.MINIMUM_COLS=2,i.MINIMUM_ROWS=1;let b=i.BufferService=class extends f.Disposable{get buffer(){return this.buffers.active}constructor(r){super(),this.isUserScrolling=!1,this._onResize=this.register(new d.EventEmitter),this.onResize=this._onResize.event,this._onScroll=this.register(new d.EventEmitter),this.onScroll=this._onScroll.event,this.cols=Math.max(r.rawOptions.cols||0,i.MINIMUM_COLS),this.rows=Math.max(r.rawOptions.rows||0,i.MINIMUM_ROWS),this.buffers=this.register(new g.BufferSet(r,this))}resize(r,l){this.cols=r,this.rows=l,this.buffers.resize(r,l),this._onResize.fire({cols:r,rows:l})}reset(){this.buffers.reset(),this.isUserScrolling=!1}scroll(r,l=!1){let a=this.buffer,h;h=this._cachedBlankLine,h&&h.length===this.cols&&h.getFg(0)===r.fg&&h.getBg(0)===r.bg||(h=a.getBlankLine(r,l),this._cachedBlankLine=h),h.isWrapped=l;let m=a.ybase+a.scrollTop,v=a.ybase+a.scrollBottom;if(a.scrollTop===0){let y=a.lines.isFull;v===a.lines.length-1?y?a.lines.recycle().copyFrom(h):a.lines.push(h.clone()):a.lines.splice(v+1,0,h.clone()),y?this.isUserScrolling&&(a.ydisp=Math.max(a.ydisp-1,0)):(a.ybase++,this.isUserScrolling||a.ydisp++)}else{let y=v-m+1;a.lines.shiftElements(m+1,y-1,-1),a.lines.set(v,h.clone())}this.isUserScrolling||(a.ydisp=a.ybase),this._onScroll.fire(a.ydisp)}scrollLines(r,l,a){let h=this.buffer;if(r<0){if(h.ydisp===0)return;this.isUserScrolling=!0}else r+h.ydisp>=h.ybase&&(this.isUserScrolling=!1);let m=h.ydisp;h.ydisp=Math.max(Math.min(h.ydisp+r,h.ybase),0),m!==h.ydisp&&(l||this._onScroll.fire(h.ydisp))}};i.BufferService=b=c([p(0,w.IOptionsService)],b)},7994:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.CharsetService=void 0,i.CharsetService=class{constructor(){this.glevel=0,this._charsets=[]}reset(){this.charset=void 0,this._charsets=[],this.glevel=0}setgLevel(o){this.glevel=o,this.charset=this._charsets[o]}setgCharset(o,c){this._charsets[o]=c,this.glevel===o&&(this.charset=c)}}},1753:function(u,i,o){var c=this&&this.__decorate||function(h,m,v,y){var x,_=arguments.length,S=_<3?m:y===null?y=Object.getOwnPropertyDescriptor(m,v):y;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")S=Reflect.decorate(h,m,v,y);else for(var L=h.length-1;L>=0;L--)(x=h[L])&&(S=(_<3?x(S):_>3?x(m,v,S):x(m,v))||S);return _>3&&S&&Object.defineProperty(m,v,S),S},p=this&&this.__param||function(h,m){return function(v,y){m(v,y,h)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CoreMouseService=void 0;let d=o(2585),f=o(8460),g=o(844),w={NONE:{events:0,restrict:()=>!1},X10:{events:1,restrict:h=>h.button!==4&&h.action===1&&(h.ctrl=!1,h.alt=!1,h.shift=!1,!0)},VT200:{events:19,restrict:h=>h.action!==32},DRAG:{events:23,restrict:h=>h.action!==32||h.button!==3},ANY:{events:31,restrict:h=>!0}};function b(h,m){let v=(h.ctrl?16:0)|(h.shift?4:0)|(h.alt?8:0);return h.button===4?(v|=64,v|=h.action):(v|=3&h.button,4&h.button&&(v|=64),8&h.button&&(v|=128),h.action===32?v|=32:h.action!==0||m||(v|=3)),v}let r=String.fromCharCode,l={DEFAULT:h=>{let m=[b(h,!1)+32,h.col+32,h.row+32];return m[0]>255||m[1]>255||m[2]>255?"":`\x1B[M${r(m[0])}${r(m[1])}${r(m[2])}`},SGR:h=>{let m=h.action===0&&h.button!==4?"m":"M";return`\x1B[<${b(h,!0)};${h.col};${h.row}${m}`},SGR_PIXELS:h=>{let m=h.action===0&&h.button!==4?"m":"M";return`\x1B[<${b(h,!0)};${h.x};${h.y}${m}`}},a=i.CoreMouseService=class extends g.Disposable{constructor(h,m){super(),this._bufferService=h,this._coreService=m,this._protocols={},this._encodings={},this._activeProtocol="",this._activeEncoding="",this._lastEvent=null,this._onProtocolChange=this.register(new f.EventEmitter),this.onProtocolChange=this._onProtocolChange.event;for(let v of Object.keys(w))this.addProtocol(v,w[v]);for(let v of Object.keys(l))this.addEncoding(v,l[v]);this.reset()}addProtocol(h,m){this._protocols[h]=m}addEncoding(h,m){this._encodings[h]=m}get activeProtocol(){return this._activeProtocol}get areMouseEventsActive(){return this._protocols[this._activeProtocol].events!==0}set activeProtocol(h){if(!this._protocols[h])throw new Error(`unknown protocol "${h}"`);this._activeProtocol=h,this._onProtocolChange.fire(this._protocols[h].events)}get activeEncoding(){return this._activeEncoding}set activeEncoding(h){if(!this._encodings[h])throw new Error(`unknown encoding "${h}"`);this._activeEncoding=h}reset(){this.activeProtocol="NONE",this.activeEncoding="DEFAULT",this._lastEvent=null}triggerMouseEvent(h){if(h.col<0||h.col>=this._bufferService.cols||h.row<0||h.row>=this._bufferService.rows||h.button===4&&h.action===32||h.button===3&&h.action!==32||h.button!==4&&(h.action===2||h.action===3)||(h.col++,h.row++,h.action===32&&this._lastEvent&&this._equalEvents(this._lastEvent,h,this._activeEncoding==="SGR_PIXELS"))||!this._protocols[this._activeProtocol].restrict(h))return!1;let m=this._encodings[this._activeEncoding](h);return m&&(this._activeEncoding==="DEFAULT"?this._coreService.triggerBinaryEvent(m):this._coreService.triggerDataEvent(m,!0)),this._lastEvent=h,!0}explainEvents(h){return{down:!!(1&h),up:!!(2&h),drag:!!(4&h),move:!!(8&h),wheel:!!(16&h)}}_equalEvents(h,m,v){if(v){if(h.x!==m.x||h.y!==m.y)return!1}else if(h.col!==m.col||h.row!==m.row)return!1;return h.button===m.button&&h.action===m.action&&h.ctrl===m.ctrl&&h.alt===m.alt&&h.shift===m.shift}};i.CoreMouseService=a=c([p(0,d.IBufferService),p(1,d.ICoreService)],a)},6975:function(u,i,o){var c=this&&this.__decorate||function(a,h,m,v){var y,x=arguments.length,_=x<3?h:v===null?v=Object.getOwnPropertyDescriptor(h,m):v;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")_=Reflect.decorate(a,h,m,v);else for(var S=a.length-1;S>=0;S--)(y=a[S])&&(_=(x<3?y(_):x>3?y(h,m,_):y(h,m))||_);return x>3&&_&&Object.defineProperty(h,m,_),_},p=this&&this.__param||function(a,h){return function(m,v){h(m,v,a)}};Object.defineProperty(i,"__esModule",{value:!0}),i.CoreService=void 0;let d=o(1439),f=o(8460),g=o(844),w=o(2585),b=Object.freeze({insertMode:!1}),r=Object.freeze({applicationCursorKeys:!1,applicationKeypad:!1,bracketedPasteMode:!1,origin:!1,reverseWraparound:!1,sendFocus:!1,wraparound:!0}),l=i.CoreService=class extends g.Disposable{constructor(a,h,m){super(),this._bufferService=a,this._logService=h,this._optionsService=m,this.isCursorInitialized=!1,this.isCursorHidden=!1,this._onData=this.register(new f.EventEmitter),this.onData=this._onData.event,this._onUserInput=this.register(new f.EventEmitter),this.onUserInput=this._onUserInput.event,this._onBinary=this.register(new f.EventEmitter),this.onBinary=this._onBinary.event,this._onRequestScrollToBottom=this.register(new f.EventEmitter),this.onRequestScrollToBottom=this._onRequestScrollToBottom.event,this.modes=(0,d.clone)(b),this.decPrivateModes=(0,d.clone)(r)}reset(){this.modes=(0,d.clone)(b),this.decPrivateModes=(0,d.clone)(r)}triggerDataEvent(a,h=!1){if(this._optionsService.rawOptions.disableStdin)return;let m=this._bufferService.buffer;h&&this._optionsService.rawOptions.scrollOnUserInput&&m.ybase!==m.ydisp&&this._onRequestScrollToBottom.fire(),h&&this._onUserInput.fire(),this._logService.debug(`sending data "${a}"`,(()=>a.split("").map((v=>v.charCodeAt(0))))),this._onData.fire(a)}triggerBinaryEvent(a){this._optionsService.rawOptions.disableStdin||(this._logService.debug(`sending binary "${a}"`,(()=>a.split("").map((h=>h.charCodeAt(0))))),this._onBinary.fire(a))}};i.CoreService=l=c([p(0,w.IBufferService),p(1,w.ILogService),p(2,w.IOptionsService)],l)},9074:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.DecorationService=void 0;let c=o(8055),p=o(8460),d=o(844),f=o(6106),g=0,w=0;class b extends d.Disposable{get decorations(){return this._decorations.values()}constructor(){super(),this._decorations=new f.SortedList((a=>a?.marker.line)),this._onDecorationRegistered=this.register(new p.EventEmitter),this.onDecorationRegistered=this._onDecorationRegistered.event,this._onDecorationRemoved=this.register(new p.EventEmitter),this.onDecorationRemoved=this._onDecorationRemoved.event,this.register((0,d.toDisposable)((()=>this.reset())))}registerDecoration(a){if(a.marker.isDisposed)return;let h=new r(a);if(h){let m=h.marker.onDispose((()=>h.dispose()));h.onDispose((()=>{h&&(this._decorations.delete(h)&&this._onDecorationRemoved.fire(h),m.dispose())})),this._decorations.insert(h),this._onDecorationRegistered.fire(h)}return h}reset(){for(let a of this._decorations.values())a.dispose();this._decorations.clear()}*getDecorationsAtCell(a,h,m){var v,y,x;let _=0,S=0;for(let L of this._decorations.getKeyIterator(h))_=(v=L.options.x)!==null&&v!==void 0?v:0,S=_+((y=L.options.width)!==null&&y!==void 0?y:1),a>=_&&a<S&&(!m||((x=L.options.layer)!==null&&x!==void 0?x:"bottom")===m)&&(yield L)}forEachDecorationAtCell(a,h,m,v){this._decorations.forEachByKey(h,(y=>{var x,_,S;g=(x=y.options.x)!==null&&x!==void 0?x:0,w=g+((_=y.options.width)!==null&&_!==void 0?_:1),a>=g&&a<w&&(!m||((S=y.options.layer)!==null&&S!==void 0?S:"bottom")===m)&&v(y)}))}}i.DecorationService=b;class r extends d.Disposable{get isDisposed(){return this._isDisposed}get backgroundColorRGB(){return this._cachedBg===null&&(this.options.backgroundColor?this._cachedBg=c.css.toColor(this.options.backgroundColor):this._cachedBg=void 0),this._cachedBg}get foregroundColorRGB(){return this._cachedFg===null&&(this.options.foregroundColor?this._cachedFg=c.css.toColor(this.options.foregroundColor):this._cachedFg=void 0),this._cachedFg}constructor(a){super(),this.options=a,this.onRenderEmitter=this.register(new p.EventEmitter),this.onRender=this.onRenderEmitter.event,this._onDispose=this.register(new p.EventEmitter),this.onDispose=this._onDispose.event,this._cachedBg=null,this._cachedFg=null,this.marker=a.marker,this.options.overviewRulerOptions&&!this.options.overviewRulerOptions.position&&(this.options.overviewRulerOptions.position="full")}dispose(){this._onDispose.fire(),super.dispose()}}},4348:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.InstantiationService=i.ServiceCollection=void 0;let c=o(2585),p=o(8343);class d{constructor(...g){this._entries=new Map;for(let[w,b]of g)this.set(w,b)}set(g,w){let b=this._entries.get(g);return this._entries.set(g,w),b}forEach(g){for(let[w,b]of this._entries.entries())g(w,b)}has(g){return this._entries.has(g)}get(g){return this._entries.get(g)}}i.ServiceCollection=d,i.InstantiationService=class{constructor(){this._services=new d,this._services.set(c.IInstantiationService,this)}setService(f,g){this._services.set(f,g)}getService(f){return this._services.get(f)}createInstance(f,...g){let w=(0,p.getServiceDependencies)(f).sort(((l,a)=>l.index-a.index)),b=[];for(let l of w){let a=this._services.get(l.id);if(!a)throw new Error(`[createInstance] ${f.name} depends on UNKNOWN service ${l.id}.`);b.push(a)}let r=w.length>0?w[0].index:g.length;if(g.length!==r)throw new Error(`[createInstance] First service dependency of ${f.name} at position ${r+1} conflicts with ${g.length} static arguments`);return new f(...g,...b)}}},7866:function(u,i,o){var c=this&&this.__decorate||function(r,l,a,h){var m,v=arguments.length,y=v<3?l:h===null?h=Object.getOwnPropertyDescriptor(l,a):h;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")y=Reflect.decorate(r,l,a,h);else for(var x=r.length-1;x>=0;x--)(m=r[x])&&(y=(v<3?m(y):v>3?m(l,a,y):m(l,a))||y);return v>3&&y&&Object.defineProperty(l,a,y),y},p=this&&this.__param||function(r,l){return function(a,h){l(a,h,r)}};Object.defineProperty(i,"__esModule",{value:!0}),i.traceCall=i.setTraceLogger=i.LogService=void 0;let d=o(844),f=o(2585),g={trace:f.LogLevelEnum.TRACE,debug:f.LogLevelEnum.DEBUG,info:f.LogLevelEnum.INFO,warn:f.LogLevelEnum.WARN,error:f.LogLevelEnum.ERROR,off:f.LogLevelEnum.OFF},w,b=i.LogService=class extends d.Disposable{get logLevel(){return this._logLevel}constructor(r){super(),this._optionsService=r,this._logLevel=f.LogLevelEnum.OFF,this._updateLogLevel(),this.register(this._optionsService.onSpecificOptionChange("logLevel",(()=>this._updateLogLevel()))),w=this}_updateLogLevel(){this._logLevel=g[this._optionsService.rawOptions.logLevel]}_evalLazyOptionalParams(r){for(let l=0;l<r.length;l++)typeof r[l]=="function"&&(r[l]=r[l]())}_log(r,l,a){this._evalLazyOptionalParams(a),r.call(console,(this._optionsService.options.logger?"":"xterm.js: ")+l,...a)}trace(r,...l){var a,h;this._logLevel<=f.LogLevelEnum.TRACE&&this._log((h=(a=this._optionsService.options.logger)===null||a===void 0?void 0:a.trace.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.log,r,l)}debug(r,...l){var a,h;this._logLevel<=f.LogLevelEnum.DEBUG&&this._log((h=(a=this._optionsService.options.logger)===null||a===void 0?void 0:a.debug.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.log,r,l)}info(r,...l){var a,h;this._logLevel<=f.LogLevelEnum.INFO&&this._log((h=(a=this._optionsService.options.logger)===null||a===void 0?void 0:a.info.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.info,r,l)}warn(r,...l){var a,h;this._logLevel<=f.LogLevelEnum.WARN&&this._log((h=(a=this._optionsService.options.logger)===null||a===void 0?void 0:a.warn.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.warn,r,l)}error(r,...l){var a,h;this._logLevel<=f.LogLevelEnum.ERROR&&this._log((h=(a=this._optionsService.options.logger)===null||a===void 0?void 0:a.error.bind(this._optionsService.options.logger))!==null&&h!==void 0?h:console.error,r,l)}};i.LogService=b=c([p(0,f.IOptionsService)],b),i.setTraceLogger=function(r){w=r},i.traceCall=function(r,l,a){if(typeof a.value!="function")throw new Error("not supported");let h=a.value;a.value=function(...m){if(w.logLevel!==f.LogLevelEnum.TRACE)return h.apply(this,m);w.trace(`GlyphRenderer#${h.name}(${m.map((y=>JSON.stringify(y))).join(", ")})`);let v=h.apply(this,m);return w.trace(`GlyphRenderer#${h.name} return`,v),v}}},7302:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.OptionsService=i.DEFAULT_OPTIONS=void 0;let c=o(8460),p=o(844),d=o(6114);i.DEFAULT_OPTIONS={cols:80,rows:24,cursorBlink:!1,cursorStyle:"block",cursorWidth:1,cursorInactiveStyle:"outline",customGlyphs:!0,drawBoldTextInBrightColors:!0,fastScrollModifier:"alt",fastScrollSensitivity:5,fontFamily:"courier-new, courier, monospace",fontSize:15,fontWeight:"normal",fontWeightBold:"bold",ignoreBracketedPasteMode:!1,lineHeight:1,letterSpacing:0,linkHandler:null,logLevel:"info",logger:null,scrollback:1e3,scrollOnUserInput:!0,scrollSensitivity:1,screenReaderMode:!1,smoothScrollDuration:0,macOptionIsMeta:!1,macOptionClickForcesSelection:!1,minimumContrastRatio:1,disableStdin:!1,allowProposedApi:!1,allowTransparency:!1,tabStopWidth:8,theme:{},rightClickSelectsWord:d.isMac,windowOptions:{},windowsMode:!1,windowsPty:{},wordSeparator:" ()[]{}',\"`",altClickMovesCursor:!0,convertEol:!1,termName:"xterm",cancelEvents:!1,overviewRulerWidth:0};let f=["normal","bold","100","200","300","400","500","600","700","800","900"];class g extends p.Disposable{constructor(b){super(),this._onOptionChange=this.register(new c.EventEmitter),this.onOptionChange=this._onOptionChange.event;let r=Object.assign({},i.DEFAULT_OPTIONS);for(let l in b)if(l in r)try{let a=b[l];r[l]=this._sanitizeAndValidateOption(l,a)}catch(a){console.error(a)}this.rawOptions=r,this.options=Object.assign({},r),this._setupOptions()}onSpecificOptionChange(b,r){return this.onOptionChange((l=>{l===b&&r(this.rawOptions[b])}))}onMultipleOptionChange(b,r){return this.onOptionChange((l=>{b.indexOf(l)!==-1&&r()}))}_setupOptions(){let b=l=>{if(!(l in i.DEFAULT_OPTIONS))throw new Error(`No option with key "${l}"`);return this.rawOptions[l]},r=(l,a)=>{if(!(l in i.DEFAULT_OPTIONS))throw new Error(`No option with key "${l}"`);a=this._sanitizeAndValidateOption(l,a),this.rawOptions[l]!==a&&(this.rawOptions[l]=a,this._onOptionChange.fire(l))};for(let l in this.rawOptions){let a={get:b.bind(this,l),set:r.bind(this,l)};Object.defineProperty(this.options,l,a)}}_sanitizeAndValidateOption(b,r){switch(b){case"cursorStyle":if(r||(r=i.DEFAULT_OPTIONS[b]),!(function(l){return l==="block"||l==="underline"||l==="bar"})(r))throw new Error(`"${r}" is not a valid value for ${b}`);break;case"wordSeparator":r||(r=i.DEFAULT_OPTIONS[b]);break;case"fontWeight":case"fontWeightBold":if(typeof r=="number"&&1<=r&&r<=1e3)break;r=f.includes(r)?r:i.DEFAULT_OPTIONS[b];break;case"cursorWidth":r=Math.floor(r);case"lineHeight":case"tabStopWidth":if(r<1)throw new Error(`${b} cannot be less than 1, value: ${r}`);break;case"minimumContrastRatio":r=Math.max(1,Math.min(21,Math.round(10*r)/10));break;case"scrollback":if((r=Math.min(r,4294967295))<0)throw new Error(`${b} cannot be less than 0, value: ${r}`);break;case"fastScrollSensitivity":case"scrollSensitivity":if(r<=0)throw new Error(`${b} cannot be less than or equal to 0, value: ${r}`);break;case"rows":case"cols":if(!r&&r!==0)throw new Error(`${b} must be numeric, value: ${r}`);break;case"windowsPty":r=r??{}}return r}}i.OptionsService=g},2660:function(u,i,o){var c=this&&this.__decorate||function(g,w,b,r){var l,a=arguments.length,h=a<3?w:r===null?r=Object.getOwnPropertyDescriptor(w,b):r;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")h=Reflect.decorate(g,w,b,r);else for(var m=g.length-1;m>=0;m--)(l=g[m])&&(h=(a<3?l(h):a>3?l(w,b,h):l(w,b))||h);return a>3&&h&&Object.defineProperty(w,b,h),h},p=this&&this.__param||function(g,w){return function(b,r){w(b,r,g)}};Object.defineProperty(i,"__esModule",{value:!0}),i.OscLinkService=void 0;let d=o(2585),f=i.OscLinkService=class{constructor(g){this._bufferService=g,this._nextId=1,this._entriesWithId=new Map,this._dataByLinkId=new Map}registerLink(g){let w=this._bufferService.buffer;if(g.id===void 0){let m=w.addMarker(w.ybase+w.y),v={data:g,id:this._nextId++,lines:[m]};return m.onDispose((()=>this._removeMarkerFromLink(v,m))),this._dataByLinkId.set(v.id,v),v.id}let b=g,r=this._getEntryIdKey(b),l=this._entriesWithId.get(r);if(l)return this.addLineToLink(l.id,w.ybase+w.y),l.id;let a=w.addMarker(w.ybase+w.y),h={id:this._nextId++,key:this._getEntryIdKey(b),data:b,lines:[a]};return a.onDispose((()=>this._removeMarkerFromLink(h,a))),this._entriesWithId.set(h.key,h),this._dataByLinkId.set(h.id,h),h.id}addLineToLink(g,w){let b=this._dataByLinkId.get(g);if(b&&b.lines.every((r=>r.line!==w))){let r=this._bufferService.buffer.addMarker(w);b.lines.push(r),r.onDispose((()=>this._removeMarkerFromLink(b,r)))}}getLinkData(g){var w;return(w=this._dataByLinkId.get(g))===null||w===void 0?void 0:w.data}_getEntryIdKey(g){return`${g.id};;${g.uri}`}_removeMarkerFromLink(g,w){let b=g.lines.indexOf(w);b!==-1&&(g.lines.splice(b,1),g.lines.length===0&&(g.data.id!==void 0&&this._entriesWithId.delete(g.key),this._dataByLinkId.delete(g.id)))}};i.OscLinkService=f=c([p(0,d.IBufferService)],f)},8343:(u,i)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.createDecorator=i.getServiceDependencies=i.serviceRegistry=void 0;let o="di$target",c="di$dependencies";i.serviceRegistry=new Map,i.getServiceDependencies=function(p){return p[c]||[]},i.createDecorator=function(p){if(i.serviceRegistry.has(p))return i.serviceRegistry.get(p);let d=function(f,g,w){if(arguments.length!==3)throw new Error("@IServiceName-decorator can only be used to decorate a parameter");(function(b,r,l){r[o]===r?r[c].push({id:b,index:l}):(r[c]=[{id:b,index:l}],r[o]=r)})(d,f,w)};return d.toString=()=>p,i.serviceRegistry.set(p,d),d}},2585:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.IDecorationService=i.IUnicodeService=i.IOscLinkService=i.IOptionsService=i.ILogService=i.LogLevelEnum=i.IInstantiationService=i.ICharsetService=i.ICoreService=i.ICoreMouseService=i.IBufferService=void 0;let c=o(8343);var p;i.IBufferService=(0,c.createDecorator)("BufferService"),i.ICoreMouseService=(0,c.createDecorator)("CoreMouseService"),i.ICoreService=(0,c.createDecorator)("CoreService"),i.ICharsetService=(0,c.createDecorator)("CharsetService"),i.IInstantiationService=(0,c.createDecorator)("InstantiationService"),(function(d){d[d.TRACE=0]="TRACE",d[d.DEBUG=1]="DEBUG",d[d.INFO=2]="INFO",d[d.WARN=3]="WARN",d[d.ERROR=4]="ERROR",d[d.OFF=5]="OFF"})(p||(i.LogLevelEnum=p={})),i.ILogService=(0,c.createDecorator)("LogService"),i.IOptionsService=(0,c.createDecorator)("OptionsService"),i.IOscLinkService=(0,c.createDecorator)("OscLinkService"),i.IUnicodeService=(0,c.createDecorator)("UnicodeService"),i.IDecorationService=(0,c.createDecorator)("DecorationService")},1480:(u,i,o)=>{Object.defineProperty(i,"__esModule",{value:!0}),i.UnicodeService=void 0;let c=o(8460),p=o(225);i.UnicodeService=class{constructor(){this._providers=Object.create(null),this._active="",this._onChange=new c.EventEmitter,this.onChange=this._onChange.event;let d=new p.UnicodeV6;this.register(d),this._active=d.version,this._activeProvider=d}dispose(){this._onChange.dispose()}get versions(){return Object.keys(this._providers)}get activeVersion(){return this._active}set activeVersion(d){if(!this._providers[d])throw new Error(`unknown Unicode version "${d}"`);this._active=d,this._activeProvider=this._providers[d],this._onChange.fire(d)}register(d){this._providers[d.version]=d}wcwidth(d){return this._activeProvider.wcwidth(d)}getStringCellWidth(d){let f=0,g=d.length;for(let w=0;w<g;++w){let b=d.charCodeAt(w);if(55296<=b&&b<=56319){if(++w>=g)return f+this.wcwidth(b);let r=d.charCodeAt(w);56320<=r&&r<=57343?b=1024*(b-55296)+r-56320+65536:f+=this.wcwidth(r)}f+=this.wcwidth(b)}return f}}}},t={};function s(u){var i=t[u];if(i!==void 0)return i.exports;var o=t[u]={exports:{}};return e[u].call(o.exports,o,o.exports,s),o.exports}var n={};return(()=>{var u=n;Object.defineProperty(u,"__esModule",{value:!0}),u.Terminal=void 0;let i=s(9042),o=s(3236),c=s(844),p=s(5741),d=s(8285),f=s(7975),g=s(7090),w=["cols","rows"];class b extends c.Disposable{constructor(l){super(),this._core=this.register(new o.Terminal(l)),this._addonManager=this.register(new p.AddonManager),this._publicOptions=Object.assign({},this._core.options);let a=m=>this._core.options[m],h=(m,v)=>{this._checkReadonlyOptions(m),this._core.options[m]=v};for(let m in this._core.options){let v={get:a.bind(this,m),set:h.bind(this,m)};Object.defineProperty(this._publicOptions,m,v)}}_checkReadonlyOptions(l){if(w.includes(l))throw new Error(`Option "${l}" can only be set in the constructor`)}_checkProposedApi(){if(!this._core.optionsService.rawOptions.allowProposedApi)throw new Error("You must set the allowProposedApi option to true to use proposed API")}get onBell(){return this._core.onBell}get onBinary(){return this._core.onBinary}get onCursorMove(){return this._core.onCursorMove}get onData(){return this._core.onData}get onKey(){return this._core.onKey}get onLineFeed(){return this._core.onLineFeed}get onRender(){return this._core.onRender}get onResize(){return this._core.onResize}get onScroll(){return this._core.onScroll}get onSelectionChange(){return this._core.onSelectionChange}get onTitleChange(){return this._core.onTitleChange}get onWriteParsed(){return this._core.onWriteParsed}get element(){return this._core.element}get parser(){return this._parser||(this._parser=new f.ParserApi(this._core)),this._parser}get unicode(){return this._checkProposedApi(),new g.UnicodeApi(this._core)}get textarea(){return this._core.textarea}get rows(){return this._core.rows}get cols(){return this._core.cols}get buffer(){return this._buffer||(this._buffer=this.register(new d.BufferNamespaceApi(this._core))),this._buffer}get markers(){return this._checkProposedApi(),this._core.markers}get modes(){let l=this._core.coreService.decPrivateModes,a="none";switch(this._core.coreMouseService.activeProtocol){case"X10":a="x10";break;case"VT200":a="vt200";break;case"DRAG":a="drag";break;case"ANY":a="any"}return{applicationCursorKeysMode:l.applicationCursorKeys,applicationKeypadMode:l.applicationKeypad,bracketedPasteMode:l.bracketedPasteMode,insertMode:this._core.coreService.modes.insertMode,mouseTrackingMode:a,originMode:l.origin,reverseWraparoundMode:l.reverseWraparound,sendFocusMode:l.sendFocus,wraparoundMode:l.wraparound}}get options(){return this._publicOptions}set options(l){for(let a in l)this._publicOptions[a]=l[a]}blur(){this._core.blur()}focus(){this._core.focus()}resize(l,a){this._verifyIntegers(l,a),this._core.resize(l,a)}open(l){this._core.open(l)}attachCustomKeyEventHandler(l){this._core.attachCustomKeyEventHandler(l)}registerLinkProvider(l){return this._core.registerLinkProvider(l)}registerCharacterJoiner(l){return this._checkProposedApi(),this._core.registerCharacterJoiner(l)}deregisterCharacterJoiner(l){this._checkProposedApi(),this._core.deregisterCharacterJoiner(l)}registerMarker(l=0){return this._verifyIntegers(l),this._core.registerMarker(l)}registerDecoration(l){var a,h,m;return this._checkProposedApi(),this._verifyPositiveIntegers((a=l.x)!==null&&a!==void 0?a:0,(h=l.width)!==null&&h!==void 0?h:0,(m=l.height)!==null&&m!==void 0?m:0),this._core.registerDecoration(l)}hasSelection(){return this._core.hasSelection()}select(l,a,h){this._verifyIntegers(l,a,h),this._core.select(l,a,h)}getSelection(){return this._core.getSelection()}getSelectionPosition(){return this._core.getSelectionPosition()}clearSelection(){this._core.clearSelection()}selectAll(){this._core.selectAll()}selectLines(l,a){this._verifyIntegers(l,a),this._core.selectLines(l,a)}dispose(){super.dispose()}scrollLines(l){this._verifyIntegers(l),this._core.scrollLines(l)}scrollPages(l){this._verifyIntegers(l),this._core.scrollPages(l)}scrollToTop(){this._core.scrollToTop()}scrollToBottom(){this._core.scrollToBottom()}scrollToLine(l){this._verifyIntegers(l),this._core.scrollToLine(l)}clear(){this._core.clear()}write(l,a){this._core.write(l,a)}writeln(l,a){this._core.write(l),this._core.write(`\r
`,a)}paste(l){this._core.paste(l)}refresh(l,a){this._verifyIntegers(l,a),this._core.refresh(l,a)}reset(){this._core.reset()}clearTextureAtlas(){this._core.clearTextureAtlas()}loadAddon(l){this._addonManager.loadAddon(this,l)}static get strings(){return i}_verifyIntegers(...l){for(let a of l)if(a===1/0||isNaN(a)||a%1!=0)throw new Error("This API only accepts integers")}_verifyPositiveIntegers(...l){for(let a of l)if(a&&(a===1/0||isNaN(a)||a%1!=0||a<0))throw new Error("This API only accepts positive integers")}}u.Terminal=b})(),n})()))});var tn={};Co(tn,{FitAddon:()=>nc});var rc,oc,nc,sn=So(()=>{rc=2,oc=1,nc=class{activate(e){this._terminal=e}dispose(){}fit(){let e=this.proposeDimensions();if(!e||!this._terminal||isNaN(e.cols)||isNaN(e.rows))return;let t=this._terminal._core;(this._terminal.rows!==e.rows||this._terminal.cols!==e.cols)&&(t._renderService.clear(),this._terminal.resize(e.cols,e.rows))}proposeDimensions(){if(!this._terminal||!this._terminal.element||!this._terminal.element.parentElement)return;let e=this._terminal._core._renderService.dimensions;if(e.css.cell.width===0||e.css.cell.height===0)return;let t=this._terminal.options.scrollback===0?0:this._terminal.options.overviewRuler?.width||14,s=window.getComputedStyle(this._terminal.element.parentElement),n=parseInt(s.getPropertyValue("height")),u=Math.max(0,parseInt(s.getPropertyValue("width"))),i=window.getComputedStyle(this._terminal.element),o={top:parseInt(i.getPropertyValue("padding-top")),bottom:parseInt(i.getPropertyValue("padding-bottom")),right:parseInt(i.getPropertyValue("padding-right")),left:parseInt(i.getPropertyValue("padding-left"))},c=o.top+o.bottom,p=o.right+o.left,d=n-c,f=u-p-t;return{cols:Math.max(rc,Math.floor(f/e.css.cell.width)),rows:Math.max(oc,Math.floor(d/e.css.cell.height))}}}});var Ln={};Co(Ln,{SearchAddon:()=>ih});function Er(e){cc(e)||lc.onUnexpectedError(e)}function cc(e){return e instanceof hc?!0:e instanceof Error&&e.name===Dr&&e.message===Dr}function dc(e,t,s=0,n=e.length){let u=s,i=n;for(;u<i;){let o=Math.floor((u+i)/2);t(e[o])?u=o+1:i=o}return u-1}function pc(e,t){return(s,n)=>t(e(s),e(n))}function _c(e,t){let s=Object.create(null);for(let n of e){let u=t(n),i=s[u];i||(i=s[u]=[]),i.push(n)}return s}function gc(e,t){let s=this,n=!1,u;return function(){if(n)return u;if(n=!0,t)try{u=e.apply(s,arguments)}finally{t()}else u=e.apply(s,arguments);return u}}function yc(e){ii=e}function Cs(e){return ii?.trackDisposable(e),e}function xs(e){ii?.markAsDisposed(e)}function $i(e,t){ii?.setParent(e,t)}function wc(e,t){if(ii)for(let s of e)ii.setParent(s,t)}function Mi(e){if(_n.is(e)){let t=[];for(let s of e)if(s)try{s.dispose()}catch(n){t.push(n)}if(t.length===1)throw t[0];if(t.length>1)throw new AggregateError(t,"Encountered errors while disposing of store");return Array.isArray(e)?[]:e}else if(e)return e.dispose(),e}function gn(...e){let t=si(()=>Mi(e));return wc(e,t),t}function si(e){let t=Cs({dispose:gc(()=>{xs(t),e()})});return t}function An(e,t=0,s){let n=setTimeout(()=>{e(),s&&u.dispose()},t),u=si(()=>{clearTimeout(n),s?.deleteAndLeak(u)});return s?.add(u),u}var ac,lc,Dr,hc,rn,uc,fn,fc,on,nn,an,wf,mc,_n,vc,ii,bc,vn,Hr,tt,Ss,ln,Sc,Cc,xc,cn,kc,Fr,Mr,Ec,hn,wn,Ac,Br,Lc,Dc,Tc,vs,Rc,Oc,bs,et,Mc,xn,$c,Bc,ti,Pr,Ir,ys,Pc,Ic,kn,Hc,Fc,zc,Nc,gs,ws,dn,Wc,lt,ct,Ie,En,Uc,Ar,jc,Sf,it,St,Vc,qc,Kc,Gc,Cf,xf,kf,Ef,Xc,Lr,Yc,un,Jc,Zc,Qc,eh,th,ih,Dn=So(()=>{ac=class{constructor(){this.listeners=[],this.unexpectedErrorHandler=function(e){setTimeout(()=>{throw e.stack?rn.isErrorNoTelemetry(e)?new rn(e.message+`

`+e.stack):new Error(e.message+`

`+e.stack):e},0)}}addListener(e){return this.listeners.push(e),()=>{this._removeListener(e)}}emit(e){this.listeners.forEach(t=>{t(e)})}_removeListener(e){this.listeners.splice(this.listeners.indexOf(e),1)}setUnexpectedErrorHandler(e){this.unexpectedErrorHandler=e}getUnexpectedErrorHandler(){return this.unexpectedErrorHandler}onUnexpectedError(e){this.unexpectedErrorHandler(e),this.emit(e)}onUnexpectedExternalError(e){this.unexpectedErrorHandler(e)}},lc=new ac;Dr="Canceled";hc=class extends Error{constructor(){super(Dr),this.name=this.message}},rn=class Tr extends Error{constructor(t){super(t),this.name="CodeExpectedError"}static fromError(t){if(t instanceof Tr)return t;let s=new Tr;return s.message=t.message,s.stack=t.stack,s}static isErrorNoTelemetry(t){return t.name==="CodeExpectedError"}};uc=class pn{constructor(t){this._array=t,this._findLastMonotonousLastIdx=0}findLastMonotonous(t){if(pn.assertInvariants){if(this._prevFindLastPredicate){for(let n of this._array)if(this._prevFindLastPredicate(n)&&!t(n))throw new Error("MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.")}this._prevFindLastPredicate=t}let s=dc(this._array,t,this._findLastMonotonousLastIdx);return this._findLastMonotonousLastIdx=s+1,s===-1?void 0:this._array[s]}};uc.assertInvariants=!1;(e=>{function t(i){return i<0}e.isLessThan=t;function s(i){return i<=0}e.isLessThanOrEqual=s;function n(i){return i>0}e.isGreaterThan=n;function u(i){return i===0}e.isNeitherLessOrGreaterThan=u,e.greaterThan=1,e.lessThan=-1,e.neitherLessOrGreaterThan=0})(fn||(fn={}));fc=(e,t)=>e-t,on=class Rr{constructor(t){this.iterate=t}forEach(t){this.iterate(s=>(t(s),!0))}toArray(){let t=[];return this.iterate(s=>(t.push(s),!0)),t}filter(t){return new Rr(s=>this.iterate(n=>t(n)?s(n):!0))}map(t){return new Rr(s=>this.iterate(n=>s(t(n))))}some(t){let s=!1;return this.iterate(n=>(s=t(n),!s)),s}findFirst(t){let s;return this.iterate(n=>t(n)?(s=n,!1):!0),s}findLast(t){let s;return this.iterate(n=>(t(n)&&(s=n),!0)),s}findLastMaxBy(t){let s,n=!0;return this.iterate(u=>((n||fn.isGreaterThan(t(u,s)))&&(n=!1,s=u),!0)),s}};on.empty=new on(e=>{});wf=class{constructor(e,t){this.toKey=t,this._map=new Map,this[nn]="SetWithKey";for(let s of e)this.add(s)}get size(){return this._map.size}add(e){let t=this.toKey(e);return this._map.set(t,e),this}delete(e){return this._map.delete(this.toKey(e))}has(e){return this._map.has(this.toKey(e))}*entries(){for(let e of this._map.values())yield[e,e]}keys(){return this.values()}*values(){for(let e of this._map.values())yield e}clear(){this._map.clear()}forEach(e,t){this._map.forEach(s=>e.call(t,s,s,this))}[(an=Symbol.iterator,nn=Symbol.toStringTag,an)](){return this.values()}},mc=class{constructor(){this.map=new Map}add(e,t){let s=this.map.get(e);s||(s=new Set,this.map.set(e,s)),s.add(t)}delete(e,t){let s=this.map.get(e);s&&(s.delete(t),s.size===0&&this.map.delete(e))}forEach(e,t){let s=this.map.get(e);s&&s.forEach(t)}get(e){return this.map.get(e)||new Set}};(e=>{function t(y){return y&&typeof y=="object"&&typeof y[Symbol.iterator]=="function"}e.is=t;let s=Object.freeze([]);function n(){return s}e.empty=n;function*u(y){yield y}e.single=u;function i(y){return t(y)?y:u(y)}e.wrap=i;function o(y){return y||s}e.from=o;function*c(y){for(let x=y.length-1;x>=0;x--)yield y[x]}e.reverse=c;function p(y){return!y||y[Symbol.iterator]().next().done===!0}e.isEmpty=p;function d(y){return y[Symbol.iterator]().next().value}e.first=d;function f(y,x){let _=0;for(let S of y)if(x(S,_++))return!0;return!1}e.some=f;function g(y,x){for(let _ of y)if(x(_))return _}e.find=g;function*w(y,x){for(let _ of y)x(_)&&(yield _)}e.filter=w;function*b(y,x){let _=0;for(let S of y)yield x(S,_++)}e.map=b;function*r(y,x){let _=0;for(let S of y)yield*x(S,_++)}e.flatMap=r;function*l(...y){for(let x of y)yield*x}e.concat=l;function a(y,x,_){let S=_;for(let L of y)S=x(S,L);return S}e.reduce=a;function*h(y,x,_=y.length){for(x<0&&(x+=y.length),_<0?_+=y.length:_>y.length&&(_=y.length);x<_;x++)yield y[x]}e.slice=h;function m(y,x=Number.POSITIVE_INFINITY){let _=[];if(x===0)return[_,y];let S=y[Symbol.iterator]();for(let L=0;L<x;L++){let O=S.next();if(O.done)return[_,e.empty()];_.push(O.value)}return[_,{[Symbol.iterator](){return S}}]}e.consume=m;async function v(y){let x=[];for await(let _ of y)x.push(_);return Promise.resolve(x)}e.asyncToArray=v})(_n||(_n={}));vc=!1,ii=null,bc=class mn{constructor(){this.livingDisposables=new Map}getDisposableData(t){let s=this.livingDisposables.get(t);return s||(s={parent:null,source:null,isSingleton:!1,value:t,idx:mn.idx++},this.livingDisposables.set(t,s)),s}trackDisposable(t){let s=this.getDisposableData(t);s.source||(s.source=new Error().stack)}setParent(t,s){let n=this.getDisposableData(t);n.parent=s}markAsDisposed(t){this.livingDisposables.delete(t)}markAsSingleton(t){this.getDisposableData(t).isSingleton=!0}getRootParent(t,s){let n=s.get(t);if(n)return n;let u=t.parent?this.getRootParent(this.getDisposableData(t.parent),s):t;return s.set(t,u),u}getTrackedDisposables(){let t=new Map;return[...this.livingDisposables.entries()].filter(([,s])=>s.source!==null&&!this.getRootParent(s,t).isSingleton).flatMap(([s])=>s)}computeLeakingDisposables(t=10,s){let n;if(s)n=s;else{let p=new Map,d=[...this.livingDisposables.values()].filter(g=>g.source!==null&&!this.getRootParent(g,p).isSingleton);if(d.length===0)return;let f=new Set(d.map(g=>g.value));if(n=d.filter(g=>!(g.parent&&f.has(g.parent))),n.length===0)throw new Error("There are cyclic diposable chains!")}if(!n)return;function u(p){function d(g,w){for(;g.length>0&&w.some(b=>typeof b=="string"?b===g[0]:g[0].match(b));)g.shift()}let f=p.source.split(`
`).map(g=>g.trim().replace("at ","")).filter(g=>g!=="");return d(f,["Error",/^trackDisposable \(.*\)$/,/^DisposableTracker.trackDisposable \(.*\)$/]),f.reverse()}let i=new mc;for(let p of n){let d=u(p);for(let f=0;f<=d.length;f++)i.add(d.slice(0,f).join(`
`),p)}n.sort(pc(p=>p.idx,fc));let o="",c=0;for(let p of n.slice(0,t)){c++;let d=u(p),f=[];for(let g=0;g<d.length;g++){let w=d[g];w=`(shared with ${i.get(d.slice(0,g+1).join(`
`)).size}/${n.length} leaks) at ${w}`;let b=i.get(d.slice(0,g).join(`
`)),r=_c([...b].map(l=>u(l)[g]),l=>l);delete r[d[g]];for(let[l,a]of Object.entries(r))f.unshift(`    - stacktraces of ${a.length} other leaks continue with ${l}`);f.unshift(w)}o+=`


==================== Leaking disposable ${c}/${n.length}: ${p.value.constructor.name} ====================
${f.join(`
`)}
============================================================

`}return n.length>t&&(o+=`


... and ${n.length-t} more leaking disposables

`),{leaks:n,details:o}}};bc.idx=0;if(vc){let e="__is_disposable_tracked__";yc(new class{trackDisposable(t){let s=new Error("Potentially leaked disposable").stack;setTimeout(()=>{t[e]||console.log(s)},3e3)}setParent(t,s){if(t&&t!==tt.None)try{t[e]=!0}catch{}}markAsDisposed(t){if(t&&t!==tt.None)try{t[e]=!0}catch{}}markAsSingleton(t){}})}vn=class bn{constructor(){this._toDispose=new Set,this._isDisposed=!1,Cs(this)}dispose(){this._isDisposed||(xs(this),this._isDisposed=!0,this.clear())}get isDisposed(){return this._isDisposed}clear(){if(this._toDispose.size!==0)try{Mi(this._toDispose)}finally{this._toDispose.clear()}}add(t){if(!t)return t;if(t===this)throw new Error("Cannot register a disposable on itself!");return $i(t,this),this._isDisposed?bn.DISABLE_DISPOSED_WARNING||console.warn(new Error("Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!").stack):this._toDispose.add(t),t}delete(t){if(t){if(t===this)throw new Error("Cannot dispose a disposable on itself!");this._toDispose.delete(t),t.dispose()}}deleteAndLeak(t){t&&this._toDispose.has(t)&&(this._toDispose.delete(t),$i(t,null))}};vn.DISABLE_DISPOSED_WARNING=!1;Hr=vn,tt=class{constructor(){this._store=new Hr,Cs(this),$i(this._store,this)}dispose(){xs(this),this._store.dispose()}_register(e){if(e===this)throw new Error("Cannot register a disposable on itself!");return this._store.add(e)}};tt.None=Object.freeze({dispose(){}});Ss=class{constructor(){this._isDisposed=!1,Cs(this)}get value(){return this._isDisposed?void 0:this._value}set value(e){this._isDisposed||e===this._value||(this._value?.dispose(),e&&$i(e,this),this._value=e)}clear(){this.value=void 0}dispose(){this._isDisposed=!0,xs(this),this._value?.dispose(),this._value=void 0}clearAndLeak(){let e=this._value;return this._value=void 0,e&&$i(e,null),e}},ln=class Or{constructor(t){this.element=t,this.next=Or.Undefined,this.prev=Or.Undefined}};ln.Undefined=new ln(void 0);Sc=globalThis.performance&&typeof globalThis.performance.now=="function",Cc=class yn{static create(t){return new yn(t)}constructor(t){this._now=Sc&&t===!1?Date.now:globalThis.performance.now.bind(globalThis.performance),this._startTime=this._now(),this._stopTime=-1}stop(){this._stopTime=this._now()}reset(){this._startTime=this._now(),this._stopTime=-1}elapsed(){return this._stopTime!==-1?this._stopTime-this._startTime:this._now()-this._startTime}},xc=!1,cn=!1,kc=!1;(e=>{e.None=()=>tt.None;function t(B){if(kc){let{onDidAddListener:$}=B,I=Br.create(),C=0;B.onDidAddListener=()=>{++C===2&&(console.warn("snapshotted emitter LIKELY used public and SHOULD HAVE BEEN created with DisposableStore. snapshotted here"),I.print()),$?.()}}}function s(B,$){return w(B,()=>{},0,void 0,!0,void 0,$)}e.defer=s;function n(B){return($,I=null,C)=>{let E=!1,A;return A=B(R=>{if(!E)return A?A.dispose():E=!0,$.call(I,R)},null,C),E&&A.dispose(),A}}e.once=n;function u(B,$,I){return f((C,E=null,A)=>B(R=>C.call(E,$(R)),null,A),I)}e.map=u;function i(B,$,I){return f((C,E=null,A)=>B(R=>{$(R),C.call(E,R)},null,A),I)}e.forEach=i;function o(B,$,I){return f((C,E=null,A)=>B(R=>$(R)&&C.call(E,R),null,A),I)}e.filter=o;function c(B){return B}e.signal=c;function p(...B){return($,I=null,C)=>{let E=gn(...B.map(A=>A(R=>$.call(I,R))));return g(E,C)}}e.any=p;function d(B,$,I,C){let E=I;return u(B,A=>(E=$(E,A),E),C)}e.reduce=d;function f(B,$){let I,C={onWillAddFirstListener(){I=B(E.fire,E)},onDidRemoveLastListener(){I?.dispose()}};$||t(C);let E=new et(C);return $?.add(E),E.event}function g(B,$){return $ instanceof Array?$.push(B):$&&$.add(B),B}function w(B,$,I=100,C=!1,E=!1,A,R){let N,j,G,K=0,he,k={leakWarningThreshold:A,onWillAddFirstListener(){N=B(U=>{K++,j=$(j,U),C&&!G&&(F.fire(j),j=void 0),he=()=>{let W=j;j=void 0,G=void 0,(!C||K>1)&&F.fire(W),K=0},typeof I=="number"?(clearTimeout(G),G=setTimeout(he,I)):G===void 0&&(G=0,queueMicrotask(he))})},onWillRemoveListener(){E&&K>0&&he?.()},onDidRemoveLastListener(){he=void 0,N.dispose()}};R||t(k);let F=new et(k);return R?.add(F),F.event}e.debounce=w;function b(B,$=0,I){return e.debounce(B,(C,E)=>C?(C.push(E),C):[E],$,void 0,!0,void 0,I)}e.accumulate=b;function r(B,$=(C,E)=>C===E,I){let C=!0,E;return o(B,A=>{let R=C||!$(A,E);return C=!1,E=A,R},I)}e.latch=r;function l(B,$,I){return[e.filter(B,$,I),e.filter(B,C=>!$(C),I)]}e.split=l;function a(B,$=!1,I=[],C){let E=I.slice(),A=B(j=>{E?E.push(j):N.fire(j)});C&&C.add(A);let R=()=>{E?.forEach(j=>N.fire(j)),E=null},N=new et({onWillAddFirstListener(){A||(A=B(j=>N.fire(j)),C&&C.add(A))},onDidAddFirstListener(){E&&($?setTimeout(R):R())},onDidRemoveLastListener(){A&&A.dispose(),A=null}});return C&&C.add(N),N.event}e.buffer=a;function h(B,$){return(I,C,E)=>{let A=$(new v);return B(function(R){let N=A.evaluate(R);N!==m&&I.call(C,N)},void 0,E)}}e.chain=h;let m=Symbol("HaltChainable");class v{constructor(){this.steps=[]}map($){return this.steps.push($),this}forEach($){return this.steps.push(I=>($(I),I)),this}filter($){return this.steps.push(I=>$(I)?I:m),this}reduce($,I){let C=I;return this.steps.push(E=>(C=$(C,E),C)),this}latch($=(I,C)=>I===C){let I=!0,C;return this.steps.push(E=>{let A=I||!$(E,C);return I=!1,C=E,A?E:m}),this}evaluate($){for(let I of this.steps)if($=I($),$===m)break;return $}}function y(B,$,I=C=>C){let C=(...N)=>R.fire(I(...N)),E=()=>B.on($,C),A=()=>B.removeListener($,C),R=new et({onWillAddFirstListener:E,onDidRemoveLastListener:A});return R.event}e.fromNodeEventEmitter=y;function x(B,$,I=C=>C){let C=(...N)=>R.fire(I(...N)),E=()=>B.addEventListener($,C),A=()=>B.removeEventListener($,C),R=new et({onWillAddFirstListener:E,onDidRemoveLastListener:A});return R.event}e.fromDOMEventEmitter=x;function _(B){return new Promise($=>n(B)($))}e.toPromise=_;function S(B){let $=new et;return B.then(I=>{$.fire(I)},()=>{$.fire(void 0)}).finally(()=>{$.dispose()}),$.event}e.fromPromise=S;function L(B,$){return B(I=>$.fire(I))}e.forward=L;function O(B,$,I){return $(I),B(C=>$(C))}e.runAndSubscribe=O;class D{constructor($,I){this._observable=$,this._counter=0,this._hasChanged=!1;let C={onWillAddFirstListener:()=>{$.addObserver(this)},onDidRemoveLastListener:()=>{$.removeObserver(this)}};I||t(C),this.emitter=new et(C),I&&I.add(this.emitter)}beginUpdate($){this._counter++}handlePossibleChange($){}handleChange($,I){this._hasChanged=!0}endUpdate($){this._counter--,this._counter===0&&(this._observable.reportChanges(),this._hasChanged&&(this._hasChanged=!1,this.emitter.fire(this._observable.get())))}}function M(B,$){return new D(B,$).emitter.event}e.fromObservable=M;function z(B){return($,I,C)=>{let E=0,A=!1,R={beginUpdate(){E++},endUpdate(){E--,E===0&&(B.reportChanges(),A&&(A=!1,$.call(I)))},handlePossibleChange(){},handleChange(){A=!0}};B.addObserver(R),B.reportChanges();let N={dispose(){B.removeObserver(R)}};return C instanceof Hr?C.add(N):Array.isArray(C)&&C.push(N),N}}e.fromObservableLight=z})(Fr||(Fr={}));Mr=class $r{constructor(t){this.listenerCount=0,this.invocationCount=0,this.elapsedOverall=0,this.durations=[],this.name=`${t}_${$r._idPool++}`,$r.all.add(this)}start(t){this._stopWatch=new Cc,this.listenerCount=t}stop(){if(this._stopWatch){let t=this._stopWatch.elapsed();this.durations.push(t),this.elapsedOverall+=t,this.invocationCount+=1,this._stopWatch=void 0}}};Mr.all=new Set,Mr._idPool=0;Ec=Mr,hn=-1,wn=class Sn{constructor(t,s,n=(Sn._idPool++).toString(16).padStart(3,"0")){this._errorHandler=t,this.threshold=s,this.name=n,this._warnCountdown=0}dispose(){this._stacks?.clear()}check(t,s){let n=this.threshold;if(n<=0||s<n)return;this._stacks||(this._stacks=new Map);let u=this._stacks.get(t.value)||0;if(this._stacks.set(t.value,u+1),this._warnCountdown-=1,this._warnCountdown<=0){this._warnCountdown=n*.5;let[i,o]=this.getMostFrequentStack(),c=`[${this.name}] potential listener LEAK detected, having ${s} listeners already. MOST frequent listener (${o}):`;console.warn(c),console.warn(i);let p=new Lc(c,i);this._errorHandler(p)}return()=>{let i=this._stacks.get(t.value)||0;this._stacks.set(t.value,i-1)}}getMostFrequentStack(){if(!this._stacks)return;let t,s=0;for(let[n,u]of this._stacks)(!t||s<u)&&(t=[n,u],s=u);return t}};wn._idPool=1;Ac=wn,Br=class Cn{constructor(t){this.value=t}static create(){let t=new Error;return new Cn(t.stack??"")}print(){console.warn(this.value.split(`
`).slice(2).join(`
`))}},Lc=class extends Error{constructor(e,t){super(e),this.name="ListenerLeakError",this.stack=t}},Dc=class extends Error{constructor(e,t){super(e),this.name="ListenerRefusalError",this.stack=t}},Tc=0,vs=class{constructor(e){this.value=e,this.id=Tc++}},Rc=2,Oc=(e,t)=>{if(e instanceof vs)t(e);else for(let s=0;s<e.length;s++){let n=e[s];n&&t(n)}};if(xc){let e=[];setInterval(()=>{e.length!==0&&(console.warn("[LEAKING LISTENERS] GC'ed these listeners that were NOT yet disposed:"),console.warn(e.join(`
`)),e.length=0)},3e3),bs=new FinalizationRegistry(t=>{typeof t=="string"&&e.push(t)})}et=class{constructor(e){this._size=0,this._options=e,this._leakageMon=hn>0||this._options?.leakWarningThreshold?new Ac(e?.onListenerError??Er,this._options?.leakWarningThreshold??hn):void 0,this._perfMon=this._options?._profName?new Ec(this._options._profName):void 0,this._deliveryQueue=this._options?.deliveryQueue}dispose(){if(!this._disposed){if(this._disposed=!0,this._deliveryQueue?.current===this&&this._deliveryQueue.reset(),this._listeners){if(cn){let e=this._listeners;queueMicrotask(()=>{Oc(e,t=>t.stack?.print())})}this._listeners=void 0,this._size=0}this._options?.onDidRemoveLastListener?.(),this._leakageMon?.dispose()}}get event(){return this._event??(this._event=(e,t,s)=>{if(this._leakageMon&&this._size>this._leakageMon.threshold**2){let c=`[${this._leakageMon.name}] REFUSES to accept new listeners because it exceeded its threshold by far (${this._size} vs ${this._leakageMon.threshold})`;console.warn(c);let p=this._leakageMon.getMostFrequentStack()??["UNKNOWN stack",-1],d=new Dc(`${c}. HINT: Stack shows most frequent listener (${p[1]}-times)`,p[0]);return(this._options?.onListenerError||Er)(d),tt.None}if(this._disposed)return tt.None;t&&(e=e.bind(t));let n=new vs(e),u,i;this._leakageMon&&this._size>=Math.ceil(this._leakageMon.threshold*.2)&&(n.stack=Br.create(),u=this._leakageMon.check(n.stack,this._size+1)),cn&&(n.stack=i??Br.create()),this._listeners?this._listeners instanceof vs?(this._deliveryQueue??(this._deliveryQueue=new Mc),this._listeners=[this._listeners,n]):this._listeners.push(n):(this._options?.onWillAddFirstListener?.(this),this._listeners=n,this._options?.onDidAddFirstListener?.(this)),this._size++;let o=si(()=>{bs?.unregister(o),u?.(),this._removeListener(n)});if(s instanceof Hr?s.add(o):Array.isArray(s)&&s.push(o),bs){let c=new Error().stack.split(`
`).slice(2,3).join(`
`).trim(),p=/(file:|vscode-file:\/\/vscode-app)?(\/[^:]*:\d+:\d+)/.exec(c);bs.register(o,p?.[2]??c,o)}return o}),this._event}_removeListener(e){if(this._options?.onWillRemoveListener?.(this),!this._listeners)return;if(this._size===1){this._listeners=void 0,this._options?.onDidRemoveLastListener?.(this),this._size=0;return}let t=this._listeners,s=t.indexOf(e);if(s===-1)throw console.log("disposed?",this._disposed),console.log("size?",this._size),console.log("arr?",JSON.stringify(this._listeners)),new Error("Attempted to dispose unknown listener");this._size--,t[s]=void 0;let n=this._deliveryQueue.current===this;if(this._size*Rc<=t.length){let u=0;for(let i=0;i<t.length;i++)t[i]?t[u++]=t[i]:n&&(this._deliveryQueue.end--,u<this._deliveryQueue.i&&this._deliveryQueue.i--);t.length=u}}_deliver(e,t){if(!e)return;let s=this._options?.onListenerError||Er;if(!s){e.value(t);return}try{e.value(t)}catch(n){s(n)}}_deliverQueue(e){let t=e.current._listeners;for(;e.i<e.end;)this._deliver(t[e.i++],e.value);e.reset()}fire(e){if(this._deliveryQueue?.current&&(this._deliverQueue(this._deliveryQueue),this._perfMon?.stop()),this._perfMon?.start(this._size),this._listeners)if(this._listeners instanceof vs)this._deliver(this._listeners,e);else{let t=this._deliveryQueue;t.enqueue(this,e,this._listeners.length),this._deliverQueue(t)}this._perfMon?.stop()}hasListeners(){return this._size>0}},Mc=class{constructor(){this.i=-1,this.end=0}enqueue(e,t,s){this.i=0,this.end=s,this.current=e,this.value=t}reset(){this.i=this.end,this.current=void 0,this.value=void 0}},xn=Object.freeze(function(e,t){let s=setTimeout(e.bind(t),0);return{dispose(){clearTimeout(s)}}});(e=>{function t(s){return s===e.None||s===e.Cancelled||s instanceof Bc?!0:!s||typeof s!="object"?!1:typeof s.isCancellationRequested=="boolean"&&typeof s.onCancellationRequested=="function"}e.isCancellationToken=t,e.None=Object.freeze({isCancellationRequested:!1,onCancellationRequested:Fr.None}),e.Cancelled=Object.freeze({isCancellationRequested:!0,onCancellationRequested:xn})})($c||($c={}));Bc=class{constructor(){this._isCancelled=!1,this._emitter=null}cancel(){this._isCancelled||(this._isCancelled=!0,this._emitter&&(this._emitter.fire(void 0),this.dispose()))}get isCancellationRequested(){return this._isCancelled}get onCancellationRequested(){return this._isCancelled?xn:(this._emitter||(this._emitter=new et),this._emitter.event)}dispose(){this._emitter&&(this._emitter.dispose(),this._emitter=null)}},ti="en",Pr=!1,Ir=!1,ys=!1,Pc=!1,Ic=!1,kn=!1,Hc=!1,Fc=!1,zc=!1,Nc=!1,ws=ti,dn=ti,ct=globalThis;typeof ct.vscode<"u"&&typeof ct.vscode.process<"u"?Ie=ct.vscode.process:typeof process<"u"&&typeof process?.versions?.node=="string"&&(Ie=process);En=typeof Ie?.versions?.electron=="string",Uc=En&&Ie?.type==="renderer";if(typeof Ie=="object"){Pr=Ie.platform==="win32",Ir=Ie.platform==="darwin",ys=Ie.platform==="linux",Pc=ys&&!!Ie.env.SNAP&&!!Ie.env.SNAP_REVISION,Hc=En,zc=!!Ie.env.CI||!!Ie.env.BUILD_ARTIFACTSTAGINGDIRECTORY,gs=ti,ws=ti;let e=Ie.env.VSCODE_NLS_CONFIG;if(e)try{let t=JSON.parse(e);gs=t.userLocale,dn=t.osLocale,ws=t.resolvedLanguage||ti,Wc=t.languagePack?.translationsConfigFile}catch{}Ic=!0}else typeof navigator=="object"&&!Uc?(lt=navigator.userAgent,Pr=lt.indexOf("Windows")>=0,Ir=lt.indexOf("Macintosh")>=0,Fc=(lt.indexOf("Macintosh")>=0||lt.indexOf("iPad")>=0||lt.indexOf("iPhone")>=0)&&!!navigator.maxTouchPoints&&navigator.maxTouchPoints>0,ys=lt.indexOf("Linux")>=0,Nc=lt?.indexOf("Mobi")>=0,kn=!0,ws=globalThis._VSCODE_NLS_LANGUAGE||ti,gs=navigator.language.toLowerCase(),dn=gs):console.error("Unable to resolve platform.");Ar=0;Ir?Ar=1:Pr?Ar=3:ys&&(Ar=2);jc=kn&&typeof ct.importScripts=="function",Sf=jc?ct.origin:void 0,it=lt,St=ws;(e=>{function t(){return St}e.value=t;function s(){return St.length===2?St==="en":St.length>=3?St[0]==="e"&&St[1]==="n"&&St[2]==="-":!1}e.isDefaultVariant=s;function n(){return St==="en"}e.isDefault=n})(Vc||(Vc={}));qc=typeof ct.postMessage=="function"&&!ct.importScripts,Kc=(()=>{if(qc){let e=[];ct.addEventListener("message",s=>{if(s.data&&s.data.vscodeScheduleAsyncWork)for(let n=0,u=e.length;n<u;n++){let i=e[n];if(i.id===s.data.vscodeScheduleAsyncWork){e.splice(n,1),i.callback();return}}});let t=0;return s=>{let n=++t;e.push({id:n,callback:s}),ct.postMessage({vscodeScheduleAsyncWork:n},"*")}}return e=>setTimeout(e)})(),Gc=!!(it&&it.indexOf("Chrome")>=0),Cf=!!(it&&it.indexOf("Firefox")>=0),xf=!!(!Gc&&it&&it.indexOf("Safari")>=0),kf=!!(it&&it.indexOf("Edg/")>=0),Ef=!!(it&&it.indexOf("Android")>=0);(function(){typeof globalThis.requestIdleCallback!="function"||typeof globalThis.cancelIdleCallback!="function"?Lr=(e,t)=>{Kc(()=>{if(s)return;let n=Date.now()+15;t(Object.freeze({didTimeout:!0,timeRemaining(){return Math.max(0,n-Date.now())}}))});let s=!1;return{dispose(){s||(s=!0)}}}:Lr=(e,t,s)=>{let n=e.requestIdleCallback(t,typeof s=="number"?{timeout:s}:void 0),u=!1;return{dispose(){u||(u=!0,e.cancelIdleCallback(n))}}},Xc=e=>Lr(globalThis,e)})();(e=>{async function t(n){let u,i=await Promise.all(n.map(o=>o.then(c=>c,c=>{u||(u=c)})));if(typeof u<"u")throw u;return i}e.settled=t;function s(n){return new Promise(async(u,i)=>{try{await n(u,i)}catch(o){i(o)}})}e.withAsyncBody=s})(Yc||(Yc={}));un=class Ne{static fromArray(t){return new Ne(s=>{s.emitMany(t)})}static fromPromise(t){return new Ne(async s=>{s.emitMany(await t)})}static fromPromises(t){return new Ne(async s=>{await Promise.all(t.map(async n=>s.emitOne(await n)))})}static merge(t){return new Ne(async s=>{await Promise.all(t.map(async n=>{for await(let u of n)s.emitOne(u)}))})}constructor(t,s){this._state=0,this._results=[],this._error=null,this._onReturn=s,this._onStateChanged=new et,queueMicrotask(async()=>{let n={emitOne:u=>this.emitOne(u),emitMany:u=>this.emitMany(u),reject:u=>this.reject(u)};try{await Promise.resolve(t(n)),this.resolve()}catch(u){this.reject(u)}finally{n.emitOne=void 0,n.emitMany=void 0,n.reject=void 0}})}[Symbol.asyncIterator](){let t=0;return{next:async()=>{do{if(this._state===2)throw this._error;if(t<this._results.length)return{done:!1,value:this._results[t++]};if(this._state===1)return{done:!0,value:void 0};await Fr.toPromise(this._onStateChanged.event)}while(!0)},return:async()=>(this._onReturn?.(),{done:!0,value:void 0})}}static map(t,s){return new Ne(async n=>{for await(let u of t)n.emitOne(s(u))})}map(t){return Ne.map(this,t)}static filter(t,s){return new Ne(async n=>{for await(let u of t)s(u)&&n.emitOne(u)})}filter(t){return Ne.filter(this,t)}static coalesce(t){return Ne.filter(t,s=>!!s)}coalesce(){return Ne.coalesce(this)}static async toPromise(t){let s=[];for await(let n of t)s.push(n);return s}toPromise(){return Ne.toPromise(this)}emitOne(t){this._state===0&&(this._results.push(t),this._onStateChanged.fire())}emitMany(t){this._state===0&&(this._results=this._results.concat(t),this._onStateChanged.fire())}resolve(){this._state===0&&(this._state=1,this._onStateChanged.fire())}reject(t){this._state===0&&(this._state=2,this._error=t,this._onStateChanged.fire())}};un.EMPTY=un.fromArray([]);Jc=class extends tt{constructor(e){super(),this._terminal=e,this._linesCacheTimeout=this._register(new Ss),this._linesCacheDisposables=this._register(new Ss),this._register(si(()=>this._destroyLinesCache()))}initLinesCache(){this._linesCache||(this._linesCache=new Array(this._terminal.buffer.active.length),this._linesCacheDisposables.value=gn(this._terminal.onLineFeed(()=>this._destroyLinesCache()),this._terminal.onCursorMove(()=>this._destroyLinesCache()),this._terminal.onResize(()=>this._destroyLinesCache()))),this._linesCacheTimeout.value=An(()=>this._destroyLinesCache(),15e3)}_destroyLinesCache(){this._linesCache=void 0,this._linesCacheDisposables.clear(),this._linesCacheTimeout.clear()}getLineFromCache(e){return this._linesCache?.[e]}setLineInCache(e,t){this._linesCache&&(this._linesCache[e]=t)}translateBufferLineToStringWithWrap(e,t){let s=[],n=[0],u=this._terminal.buffer.active.getLine(e);for(;u;){let i=this._terminal.buffer.active.getLine(e+1),o=i?i.isWrapped:!1,c=u.translateToString(!o&&t);if(o&&i){let p=u.getCell(u.length-1);p&&p.getCode()===0&&p.getWidth()===1&&i.getCell(0)?.getWidth()===2&&(c=c.slice(0,-1))}if(s.push(c),o)n.push(n[n.length-1]+c.length);else break;e++,u=i}return[s.join(""),n]}},Zc=class{get cachedSearchTerm(){return this._cachedSearchTerm}set cachedSearchTerm(e){this._cachedSearchTerm=e}get lastSearchOptions(){return this._lastSearchOptions}set lastSearchOptions(e){this._lastSearchOptions=e}isValidSearchTerm(e){return!!(e&&e.length>0)}didOptionsChange(e){return this._lastSearchOptions?e?this._lastSearchOptions.caseSensitive!==e.caseSensitive||this._lastSearchOptions.regex!==e.regex||this._lastSearchOptions.wholeWord!==e.wholeWord:!1:!0}shouldUpdateHighlighting(e,t){return t?.decorations?this._cachedSearchTerm===void 0||e!==this._cachedSearchTerm||this.didOptionsChange(t):!1}clearCachedTerm(){this._cachedSearchTerm=void 0}reset(){this._cachedSearchTerm=void 0,this._lastSearchOptions=void 0}},Qc=class{constructor(e,t){this._terminal=e,this._lineCache=t}find(e,t,s,n){if(!e||e.length===0){this._terminal.clearSelection();return}if(s>this._terminal.cols)throw new Error(`Invalid col: ${s} to search in terminal of ${this._terminal.cols} cols`);this._lineCache.initLinesCache();let u={startRow:t,startCol:s},i=this._findInLine(e,u,n);if(!i)for(let o=t+1;o<this._terminal.buffer.active.baseY+this._terminal.rows&&(u.startRow=o,u.startCol=0,i=this._findInLine(e,u,n),!i);o++);return i}findNextWithSelection(e,t,s){if(!e||e.length===0){this._terminal.clearSelection();return}let n=this._terminal.getSelectionPosition();this._terminal.clearSelection();let u=0,i=0;n&&(s===e?(u=n.end.x,i=n.end.y):(u=n.start.x,i=n.start.y)),this._lineCache.initLinesCache();let o={startRow:i,startCol:u},c=this._findInLine(e,o,t);if(!c)for(let p=i+1;p<this._terminal.buffer.active.baseY+this._terminal.rows&&(o.startRow=p,o.startCol=0,c=this._findInLine(e,o,t),!c);p++);if(!c&&i!==0)for(let p=0;p<i&&(o.startRow=p,o.startCol=0,c=this._findInLine(e,o,t),!c);p++);return!c&&n&&(o.startRow=n.start.y,o.startCol=0,c=this._findInLine(e,o,t)),c}findPreviousWithSelection(e,t,s){if(!e||e.length===0){this._terminal.clearSelection();return}let n=this._terminal.getSelectionPosition();this._terminal.clearSelection();let u=this._terminal.buffer.active.baseY+this._terminal.rows-1,i=this._terminal.cols,o=!0;this._lineCache.initLinesCache();let c={startRow:u,startCol:i},p;if(n&&(c.startRow=u=n.start.y,c.startCol=i=n.start.x,s!==e&&(p=this._findInLine(e,c,t,!1),p||(c.startRow=u=n.end.y,c.startCol=i=n.end.x))),p||(p=this._findInLine(e,c,t,o)),!p){c.startCol=Math.max(c.startCol,this._terminal.cols);for(let d=u-1;d>=0&&(c.startRow=d,p=this._findInLine(e,c,t,o),!p);d--);}if(!p&&u!==this._terminal.buffer.active.baseY+this._terminal.rows-1)for(let d=this._terminal.buffer.active.baseY+this._terminal.rows-1;d>=u&&(c.startRow=d,p=this._findInLine(e,c,t,o),!p);d--);return p}_isWholeWord(e,t,s){return(e===0||" ~!@#$%^&*()+`-=[]{}|\\;:\"',./<>?".includes(t[e-1]))&&(e+s.length===t.length||" ~!@#$%^&*()+`-=[]{}|\\;:\"',./<>?".includes(t[e+s.length]))}_findInLine(e,t,s={},n=!1){let u=t.startRow,i=t.startCol;if(this._terminal.buffer.active.getLine(u)?.isWrapped){if(n){t.startCol+=this._terminal.cols;return}return t.startRow--,t.startCol+=this._terminal.cols,this._findInLine(e,t,s)}let o=this._lineCache.getLineFromCache(u);o||(o=this._lineCache.translateBufferLineToStringWithWrap(u,!0),this._lineCache.setLineInCache(u,o));let[c,p]=o,d=this._bufferColsToStringOffset(u,i),f=e,g=c;s.regex||(f=s.caseSensitive?e:e.toLowerCase(),g=s.caseSensitive?c:c.toLowerCase());let w=-1;if(s.regex){let b=RegExp(f,s.caseSensitive?"g":"gi"),r;if(n)for(;r=b.exec(g.slice(0,d));)w=b.lastIndex-r[0].length,e=r[0],b.lastIndex-=e.length-1;else r=b.exec(g.slice(d)),r&&r[0].length>0&&(w=d+(b.lastIndex-r[0].length),e=r[0])}else n?d-f.length>=0&&(w=g.lastIndexOf(f,d-f.length)):w=g.indexOf(f,d);if(w>=0){if(s.wholeWord&&!this._isWholeWord(w,g,e))return;let b=0;for(;b<p.length-1&&w>=p[b+1];)b++;let r=b;for(;r<p.length-1&&w+e.length>=p[r+1];)r++;let l=w-p[b],a=w+e.length-p[r],h=this._stringLengthToBufferSize(u+b,l),m=this._stringLengthToBufferSize(u+r,a)-h+this._terminal.cols*(r-b);return{term:e,col:h,row:u+b,size:m}}}_stringLengthToBufferSize(e,t){let s=this._terminal.buffer.active.getLine(e);if(!s)return 0;for(let n=0;n<t;n++){let u=s.getCell(n);if(!u)break;let i=u.getChars();i.length>1&&(t-=i.length-1);let o=s.getCell(n+1);o&&o.getWidth()===0&&t++}return t}_bufferColsToStringOffset(e,t){let s=e,n=0,u=this._terminal.buffer.active.getLine(s);for(;t>0&&u;){for(let i=0;i<t&&i<this._terminal.cols;i++){let o=u.getCell(i);if(!o)break;o.getWidth()&&(n+=o.getCode()===0?1:o.getChars().length)}if(s++,u=this._terminal.buffer.active.getLine(s),u&&!u.isWrapped)break;t-=this._terminal.cols}return n}},eh=class extends tt{constructor(e){super(),this._terminal=e,this._highlightDecorations=[],this._highlightedLines=new Set,this._register(si(()=>this.clearHighlightDecorations()))}createHighlightDecorations(e,t){this.clearHighlightDecorations();for(let s of e){let n=this._createResultDecorations(s,t,!1);if(n)for(let u of n)this._storeDecoration(u,s)}}createActiveDecoration(e,t){let s=this._createResultDecorations(e,t,!0);if(s)return{decorations:s,match:e,dispose(){Mi(s)}}}clearHighlightDecorations(){Mi(this._highlightDecorations),this._highlightDecorations=[],this._highlightedLines.clear()}_storeDecoration(e,t){this._highlightedLines.add(e.marker.line),this._highlightDecorations.push({decoration:e,match:t,dispose(){e.dispose()}})}_applyStyles(e,t,s){e.classList.contains("xterm-find-result-decoration")||(e.classList.add("xterm-find-result-decoration"),t&&(e.style.outline=`1px solid ${t}`)),s&&e.classList.add("xterm-find-active-result-decoration")}_createResultDecorations(e,t,s){let n=[],u=e.col,i=e.size,o=-this._terminal.buffer.active.baseY-this._terminal.buffer.active.cursorY+e.row;for(;i>0;){let p=Math.min(this._terminal.cols-u,i);n.push([o,u,p]),u=0,i-=p,o++}let c=[];for(let p of n){let d=this._terminal.registerMarker(p[0]),f=this._terminal.registerDecoration({marker:d,x:p[1],width:p[2],backgroundColor:s?t.activeMatchBackground:t.matchBackground,overviewRulerOptions:this._highlightedLines.has(d.line)?void 0:{color:s?t.activeMatchColorOverviewRuler:t.matchOverviewRuler,position:"center"}});if(f){let g=[];g.push(d),g.push(f.onRender(w=>this._applyStyles(w,s?t.activeMatchBorder:t.matchBorder,!1))),g.push(f.onDispose(()=>Mi(g))),c.push(f)}}return c.length===0?void 0:c}},th=class extends tt{constructor(){super(...arguments),this._searchResults=[],this._onDidChangeResults=this._register(new et)}get onDidChangeResults(){return this._onDidChangeResults.event}get searchResults(){return this._searchResults}get selectedDecoration(){return this._selectedDecoration}set selectedDecoration(e){this._selectedDecoration=e}updateResults(e,t){this._searchResults=e.slice(0,t)}clearResults(){this._searchResults=[]}clearSelectedDecoration(){this._selectedDecoration&&(this._selectedDecoration.dispose(),this._selectedDecoration=void 0)}findResultIndex(e){for(let t=0;t<this._searchResults.length;t++){let s=this._searchResults[t];if(s.row===e.row&&s.col===e.col&&s.size===e.size)return t}return-1}fireResultsChanged(e){if(!e)return;let t=-1;this._selectedDecoration&&(t=this.findResultIndex(this._selectedDecoration.match)),this._onDidChangeResults.fire({resultIndex:t,resultCount:this._searchResults.length})}reset(){this.clearSelectedDecoration(),this.clearResults()}},ih=class extends tt{constructor(e){super(),this._highlightTimeout=this._register(new Ss),this._lineCache=this._register(new Ss),this._state=new Zc,this._resultTracker=this._register(new th),this._highlightLimit=e?.highlightLimit??1e3}get onDidChangeResults(){return this._resultTracker.onDidChangeResults}activate(e){this._terminal=e,this._lineCache.value=new Jc(e),this._engine=new Qc(e,this._lineCache.value),this._decorationManager=new eh(e),this._register(this._terminal.onWriteParsed(()=>this._updateMatches())),this._register(this._terminal.onResize(()=>this._updateMatches())),this._register(si(()=>this.clearDecorations()))}_updateMatches(){this._highlightTimeout.clear(),this._state.cachedSearchTerm&&this._state.lastSearchOptions?.decorations&&(this._highlightTimeout.value=An(()=>{let e=this._state.cachedSearchTerm;this._state.clearCachedTerm(),this.findPrevious(e,{...this._state.lastSearchOptions,incremental:!0},{noScroll:!0})},200))}clearDecorations(e){this._resultTracker.clearSelectedDecoration(),this._decorationManager?.clearHighlightDecorations(),this._resultTracker.clearResults(),e||this._state.clearCachedTerm()}clearActiveDecoration(){this._resultTracker.clearSelectedDecoration()}findNext(e,t,s){if(!this._terminal||!this._engine)throw new Error("Cannot use addon until it has been loaded");this._state.lastSearchOptions=t,this._state.shouldUpdateHighlighting(e,t)&&this._highlightAllMatches(e,t);let n=this._findNextAndSelect(e,t,s);return this._fireResults(t),this._state.cachedSearchTerm=e,n}_highlightAllMatches(e,t){if(!this._terminal||!this._engine||!this._decorationManager)throw new Error("Cannot use addon until it has been loaded");if(!this._state.isValidSearchTerm(e)){this.clearDecorations();return}this.clearDecorations(!0);let s=[],n,u=this._engine.find(e,0,0,t);for(;u&&(n?.row!==u.row||n?.col!==u.col)&&!(s.length>=this._highlightLimit);)n=u,s.push(n),u=this._engine.find(e,n.col+n.term.length>=this._terminal.cols?n.row+1:n.row,n.col+n.term.length>=this._terminal.cols?0:n.col+1,t);this._resultTracker.updateResults(s,this._highlightLimit),t.decorations&&this._decorationManager.createHighlightDecorations(s,t.decorations)}_findNextAndSelect(e,t,s){if(!this._terminal||!this._engine)return!1;if(!this._state.isValidSearchTerm(e))return this._terminal.clearSelection(),this.clearDecorations(),!1;let n=this._engine.findNextWithSelection(e,t,this._state.cachedSearchTerm);return this._selectResult(n,t?.decorations,s?.noScroll)}findPrevious(e,t,s){if(!this._terminal||!this._engine)throw new Error("Cannot use addon until it has been loaded");this._state.lastSearchOptions=t,this._state.shouldUpdateHighlighting(e,t)&&this._highlightAllMatches(e,t);let n=this._findPreviousAndSelect(e,t,s);return this._fireResults(t),this._state.cachedSearchTerm=e,n}_fireResults(e){this._resultTracker.fireResultsChanged(!!e?.decorations)}_findPreviousAndSelect(e,t,s){if(!this._terminal||!this._engine)return!1;if(!this._state.isValidSearchTerm(e))return this._terminal.clearSelection(),this.clearDecorations(),!1;let n=this._engine.findPreviousWithSelection(e,t,this._state.cachedSearchTerm);return this._selectResult(n,t?.decorations,s?.noScroll)}_selectResult(e,t,s){if(!this._terminal||!this._decorationManager)return!1;if(this._resultTracker.clearSelectedDecoration(),!e)return this._terminal.clearSelection(),!1;if(this._terminal.select(e.col,e.row,e.size),t){let n=this._decorationManager.createActiveDecoration(e,t);n&&(this._resultTracker.selectedDecoration=n)}if(!s&&(e.row>=this._terminal.buffer.active.viewportY+this._terminal.rows||e.row<this._terminal.buffer.active.viewportY)){let n=e.row-this._terminal.buffer.active.viewportY;n-=Math.floor(this._terminal.rows/2),this._terminal.scrollLines(n)}return!0}}});var yi=globalThis,xo=e=>e,ss=yi.trustedTypes,ko=ss?ss.createPolicy("lit-html",{createHTML:e=>e}):void 0,er="$lit$",at=`lit$${Math.random().toFixed(9).slice(2)}$`,tr="?"+at,Ml=`<${tr}>`,Tt=document,wi=()=>Tt.createComment(""),Si=e=>e===null||typeof e!="object"&&typeof e!="function",ir=Array.isArray,Ro=e=>ir(e)||typeof e?.[Symbol.iterator]=="function",Qs=`[ 	
\f\r]`,bi=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,Eo=/-->/g,Ao=/>/g,Lt=RegExp(`>|${Qs}(?:([^\\s"'>=/]+)(${Qs}*=${Qs}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),Lo=/'/g,Do=/"/g,Oo=/^(?:script|style|textarea|title)$/i,sr=e=>(t,...s)=>({_$litType$:e,strings:t,values:s}),H=sr(1),Mo=sr(2),$o=sr(3),Te=Symbol.for("lit-noChange"),q=Symbol.for("lit-nothing"),To=new WeakMap,Dt=Tt.createTreeWalker(Tt,129);function Bo(e,t){if(!ir(e)||!e.hasOwnProperty("raw"))throw Error("invalid template strings array");return ko!==void 0?ko.createHTML(t):t}var Po=(e,t)=>{let s=e.length-1,n=[],u,i=t===2?"<svg>":t===3?"<math>":"",o=bi;for(let c=0;c<s;c++){let p=e[c],d,f,g=-1,w=0;for(;w<p.length&&(o.lastIndex=w,f=o.exec(p),f!==null);)w=o.lastIndex,o===bi?f[1]==="!--"?o=Eo:f[1]!==void 0?o=Ao:f[2]!==void 0?(Oo.test(f[2])&&(u=RegExp("</"+f[2],"g")),o=Lt):f[3]!==void 0&&(o=Lt):o===Lt?f[0]===">"?(o=u??bi,g=-1):f[1]===void 0?g=-2:(g=o.lastIndex-f[2].length,d=f[1],o=f[3]===void 0?Lt:f[3]==='"'?Do:Lo):o===Do||o===Lo?o=Lt:o===Eo||o===Ao?o=bi:(o=Lt,u=void 0);let b=o===Lt&&e[c+1].startsWith("/>")?" ":"";i+=o===bi?p+Ml:g>=0?(n.push(d),p.slice(0,g)+er+p.slice(g)+at+b):p+at+(g===-2?c:b)}return[Bo(e,i+(e[s]||"<?>")+(t===2?"</svg>":t===3?"</math>":"")),n]},Ci=class e{constructor({strings:t,_$litType$:s},n){let u;this.parts=[];let i=0,o=0,c=t.length-1,p=this.parts,[d,f]=Po(t,s);if(this.el=e.createElement(d,n),Dt.currentNode=this.el.content,s===2||s===3){let g=this.el.content.firstChild;g.replaceWith(...g.childNodes)}for(;(u=Dt.nextNode())!==null&&p.length<c;){if(u.nodeType===1){if(u.hasAttributes())for(let g of u.getAttributeNames())if(g.endsWith(er)){let w=f[o++],b=u.getAttribute(g).split(at),r=/([.?@])?(.*)/.exec(w);p.push({type:1,index:i,name:r[2],strings:b,ctor:r[1]==="."?os:r[1]==="?"?ns:r[1]==="@"?as:Ot}),u.removeAttribute(g)}else g.startsWith(at)&&(p.push({type:6,index:i}),u.removeAttribute(g));if(Oo.test(u.tagName)){let g=u.textContent.split(at),w=g.length-1;if(w>0){u.textContent=ss?ss.emptyScript:"";for(let b=0;b<w;b++)u.append(g[b],wi()),Dt.nextNode(),p.push({type:2,index:++i});u.append(g[w],wi())}}}else if(u.nodeType===8)if(u.data===tr)p.push({type:2,index:i});else{let g=-1;for(;(g=u.data.indexOf(at,g+1))!==-1;)p.push({type:7,index:i}),g+=at.length-1}i++}}static createElement(t,s){let n=Tt.createElement("template");return n.innerHTML=t,n}};function Rt(e,t,s=e,n){if(t===Te)return t;let u=n!==void 0?s._$Co?.[n]:s._$Cl,i=Si(t)?void 0:t._$litDirective$;return u?.constructor!==i&&(u?._$AO?.(!1),i===void 0?u=void 0:(u=new i(e),u._$AT(e,s,n)),n!==void 0?(s._$Co??(s._$Co=[]))[n]=u:s._$Cl=u),u!==void 0&&(t=Rt(e,u._$AS(e,t.values),u,n)),t}var rs=class{constructor(t,s){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=s}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){let{el:{content:s},parts:n}=this._$AD,u=(t?.creationScope??Tt).importNode(s,!0);Dt.currentNode=u;let i=Dt.nextNode(),o=0,c=0,p=n[0];for(;p!==void 0;){if(o===p.index){let d;p.type===2?d=new Jt(i,i.nextSibling,this,t):p.type===1?d=new p.ctor(i,p.name,p.strings,this,t):p.type===6&&(d=new ls(i,this,t)),this._$AV.push(d),p=n[++c]}o!==p?.index&&(i=Dt.nextNode(),o++)}return Dt.currentNode=Tt,u}p(t){let s=0;for(let n of this._$AV)n!==void 0&&(n.strings!==void 0?(n._$AI(t,n,s),s+=n.strings.length-2):n._$AI(t[s])),s++}},Jt=class e{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,s,n,u){this.type=2,this._$AH=q,this._$AN=void 0,this._$AA=t,this._$AB=s,this._$AM=n,this.options=u,this._$Cv=u?.isConnected??!0}get parentNode(){let t=this._$AA.parentNode,s=this._$AM;return s!==void 0&&t?.nodeType===11&&(t=s.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,s=this){t=Rt(this,t,s),Si(t)?t===q||t==null||t===""?(this._$AH!==q&&this._$AR(),this._$AH=q):t!==this._$AH&&t!==Te&&this._(t):t._$litType$!==void 0?this.$(t):t.nodeType!==void 0?this.T(t):Ro(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==q&&Si(this._$AH)?this._$AA.nextSibling.data=t:this.T(Tt.createTextNode(t)),this._$AH=t}$(t){let{values:s,_$litType$:n}=t,u=typeof n=="number"?this._$AC(t):(n.el===void 0&&(n.el=Ci.createElement(Bo(n.h,n.h[0]),this.options)),n);if(this._$AH?._$AD===u)this._$AH.p(s);else{let i=new rs(u,this),o=i.u(this.options);i.p(s),this.T(o),this._$AH=i}}_$AC(t){let s=To.get(t.strings);return s===void 0&&To.set(t.strings,s=new Ci(t)),s}k(t){ir(this._$AH)||(this._$AH=[],this._$AR());let s=this._$AH,n,u=0;for(let i of t)u===s.length?s.push(n=new e(this.O(wi()),this.O(wi()),this,this.options)):n=s[u],n._$AI(i),u++;u<s.length&&(this._$AR(n&&n._$AB.nextSibling,u),s.length=u)}_$AR(t=this._$AA.nextSibling,s){for(this._$AP?.(!1,!0,s);t!==this._$AB;){let n=xo(t).nextSibling;xo(t).remove(),t=n}}setConnected(t){this._$AM===void 0&&(this._$Cv=t,this._$AP?.(t))}},Ot=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,s,n,u,i){this.type=1,this._$AH=q,this._$AN=void 0,this.element=t,this.name=s,this._$AM=u,this.options=i,n.length>2||n[0]!==""||n[1]!==""?(this._$AH=Array(n.length-1).fill(new String),this.strings=n):this._$AH=q}_$AI(t,s=this,n,u){let i=this.strings,o=!1;if(i===void 0)t=Rt(this,t,s,0),o=!Si(t)||t!==this._$AH&&t!==Te,o&&(this._$AH=t);else{let c=t,p,d;for(t=i[0],p=0;p<i.length-1;p++)d=Rt(this,c[n+p],s,p),d===Te&&(d=this._$AH[p]),o||(o=!Si(d)||d!==this._$AH[p]),d===q?t=q:t!==q&&(t+=(d??"")+i[p+1]),this._$AH[p]=d}o&&!u&&this.j(t)}j(t){t===q?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"")}},os=class extends Ot{constructor(){super(...arguments),this.type=3}j(t){this.element[this.name]=t===q?void 0:t}},ns=class extends Ot{constructor(){super(...arguments),this.type=4}j(t){this.element.toggleAttribute(this.name,!!t&&t!==q)}},as=class extends Ot{constructor(t,s,n,u,i){super(t,s,n,u,i),this.type=5}_$AI(t,s=this){if((t=Rt(this,t,s,0)??q)===Te)return;let n=this._$AH,u=t===q&&n!==q||t.capture!==n.capture||t.once!==n.once||t.passive!==n.passive,i=t!==q&&(n===q||u);u&&this.element.removeEventListener(this.name,this,n),i&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t)}},ls=class{constructor(t,s,n){this.element=t,this.type=6,this._$AN=void 0,this._$AM=s,this.options=n}get _$AU(){return this._$AM._$AU}_$AI(t){Rt(this,t)}},Io={M:er,P:at,A:tr,C:1,L:Po,R:rs,D:Ro,V:Rt,I:Jt,H:Ot,N:ns,U:as,B:os,F:ls},$l=yi.litHtmlPolyfillSupport;$l?.(Ci,Jt),(yi.litHtmlVersions??(yi.litHtmlVersions=[])).push("3.3.2");var cs=(e,t,s)=>{let n=s?.renderBefore??t,u=n._$litPart$;if(u===void 0){let i=s?.renderBefore??null;n._$litPart$=u=new Jt(t.insertBefore(wi(),i),i,void 0,s??{})}return u._$AI(e),u};function Ho(e={}){let t={activeRunId:e.activeRunId??null,runs:e.runs??{},logLines:e.logLines??[],preferences:{theme:e.preferences?.theme??"light",sidebarCollapsed:e.preferences?.sidebarCollapsed??!1}},s=new Set;function n(){for(let u of Array.from(s))try{u(t)}catch{}}return{getState(){return t},setState(u){let i={...t,...u,preferences:{...t.preferences,...u.preferences||{}}};i.activeRunId===t.activeRunId&&i.runs===t.runs&&i.logLines===t.logLines&&i.preferences.theme===t.preferences.theme&&i.preferences.sidebarCollapsed===t.preferences.sidebarCollapsed||(t=i,n())},setRun(u,i){let o={...t.runs,[u]:i};t={...t,runs:o},n()},appendLog(u){let i=[...t.logLines,u];i.length>5e3&&i.splice(0,i.length-5e3),t={...t,logLines:i},n()},clearLog(){t={...t,logLines:[]},n()},subscribe(u){return s.add(u),()=>s.delete(u)}}}var Fo=["subscribe-run","unsubscribe-run","subscribe-log","unsubscribe-log","list-runs","get-agent-prompt","get-preferences","set-preferences","stop-run","run-snapshot","run-update","runs-list","log-line","log-bulk","preferences"];function rr(){let e=Date.now().toString(36),t=Math.random().toString(36).slice(2,8);return`${e}-${t}`}function zo(e,t,s=rr()){return{id:s,type:e,payload:t}}function No(e={}){let t={initialMs:e.backoff?.initialMs??1e3,maxMs:e.backoff?.maxMs??3e4,factor:e.backoff?.factor??2,jitterRatio:e.backoff?.jitterRatio??.2},s=()=>e.url&&e.url.length>0?e.url:typeof location<"u"?(location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws":"ws://localhost/ws",n=null,u="closed",i=0,o=null,c=!0,p=new Map,d=[],f=new Map,g=new Set;function w(v){for(let y of Array.from(g))try{y(v)}catch{}}function b(){if(!c||o)return;u="reconnecting",w(u);let v=Math.min(t.maxMs,t.initialMs*Math.pow(t.factor,i)),y=t.jitterRatio*v,x=Math.max(0,Math.round(v+(Math.random()*2-1)*y));o=setTimeout(()=>{o=null,m()},x)}function r(v){try{n?.send(JSON.stringify(v))}catch{}}function l(){for(u="open",w(u),i=0;d.length;){let v=d.shift();v&&r(v)}}function a(v){let y;try{y=JSON.parse(String(v.data))}catch{return}if(!y||typeof y.id!="string"||typeof y.type!="string")return;if(p.has(y.id)){let _=p.get(y.id);p.delete(y.id),y.ok?_?.resolve(y.payload):_?.reject(y.error||new Error("ws error"));return}let x=f.get(y.type);if(x&&x.size>0)for(let _ of Array.from(x))try{_(y.payload)}catch{}}function h(){u="closed",w(u);for(let[v,y]of p.entries())y.reject(new Error("ws disconnected")),p.delete(v);i+=1,b()}function m(){if(!c)return;let v=s();try{n=new WebSocket(v),u="connecting",w(u),n.addEventListener("open",l),n.addEventListener("message",a),n.addEventListener("error",()=>{}),n.addEventListener("close",h)}catch{b()}}return m(),{send(v,y){if(!Fo.includes(v))return Promise.reject(new Error(`unknown message type: ${v}`));let x=rr(),_=zo(v,y,x);return new Promise((S,L)=>{p.set(x,{resolve:S,reject:L,type:v}),n&&n.readyState===n.OPEN?r(_):d.push(_)})},on(v,y){f.has(v)||f.set(v,new Set);let x=f.get(v);return x?.add(y),()=>{x?.delete(y)}},onConnection(v){return g.add(v),()=>{g.delete(v)}},close(){c=!1,o&&(clearTimeout(o),o=null);try{n?.close()}catch{}},getState(){return u}}}function or(e){let t=(e||"").replace(/^#\/?/,""),[s,n]=t.split("?"),u=s||"active",i=new URLSearchParams(n||"");return{section:u,runId:i.get("run")||null}}function Bl(e,t){let s=`#/${e}`;return t?`${s}?run=${t}`:s}function Wo(e){let t=()=>e(or(location.hash));return window.addEventListener("hashchange",t),()=>window.removeEventListener("hashchange",t)}function gt(e,t){location.hash=Bl(e,t)}function xi(e){document.documentElement.setAttribute("data-theme",e)}var Ke={ATTRIBUTE:1,CHILD:2,PROPERTY:3,BOOLEAN_ATTRIBUTE:4,EVENT:5,ELEMENT:6},Zt=e=>(...t)=>({_$litDirective$:e,values:t}),vt=class{constructor(t){}get _$AU(){return this._$AM._$AU}_$AT(t,s,n){this._$Ct=t,this._$AM=s,this._$Ci=n}_$AS(t,s){return this.update(t,s)}update(t,s){return this.render(...s)}};var ki=class extends vt{constructor(t){if(super(t),this.it=q,t.type!==Ke.CHILD)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(t){if(t===q||t==null)return this._t=void 0,this.it=t;if(t===Te)return t;if(typeof t!="string")throw Error(this.constructor.directiveName+"() called with a non-string value");if(t===this.it)return this._t;this.it=t;let s=[t];return s.raw=s,this._t={_$litType$:this.constructor.resultType,strings:s,values:[]}}};ki.directiveName="unsafeHTML",ki.resultType=1;var X=Zt(ki);var Qt=[["circle",{cx:"12",cy:"12",r:"10"}]];var Mt=[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"m9 12 2 2 4-4"}]];var $t=[["circle",{cx:"12",cy:"12",r:"10"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16"}]];var bt=[["path",{d:"M12 2v4"}],["path",{d:"m16.2 7.8 2.9-2.9"}],["path",{d:"M18 12h4"}],["path",{d:"m16.2 16.2 2.9 2.9"}],["path",{d:"M12 18v4"}],["path",{d:"m4.9 19.1 2.9-2.9"}],["path",{d:"M2 12h4"}],["path",{d:"m4.9 4.9 2.9 2.9"}]];var Ei=[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{d:"M21 3v5h-5"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{d:"M8 16H3v5"}]];var nr=[["path",{d:"M12 5v14"}],["path",{d:"m19 12-7 7-7-7"}]];var Bt=[["rect",{x:"14",y:"3",width:"5",height:"18",rx:"1"}],["rect",{x:"5",y:"3",width:"5",height:"18",rx:"1"}]];var ar=[["path",{d:"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"}]];var lr=[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"M12 6v6l4 2"}]];var cr=[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{d:"M12 9v4"}],["path",{d:"M12 17h.01"}]];var Ai=[["path",{d:"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]];var hr=[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"}],["path",{d:"M10 12h4"}]];var dr=[["path",{d:"m21 21-4.34-4.34"}],["circle",{cx:"11",cy:"11",r:"8"}]];var ur=[["path",{d:"m12 19-7-7 7-7"}],["path",{d:"M19 12H5"}]];var pr=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2"}]];var fr=[["path",{d:"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"}]];var hs=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{d:"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{cx:"9",cy:"7",r:"4"}]];var _r=[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}]];var Li=[["path",{d:"M15 6a9 9 0 0 0-9 9V3"}],["circle",{cx:"18",cy:"6",r:"3"}],["circle",{cx:"6",cy:"18",r:"3"}]];var mr=[["path",{d:"m9 18 6-6-6-6"}]];var Di=[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7"}]];var Ti=[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{cx:"12",cy:"12",r:"3"}]];var gr=[["line",{x1:"10",x2:"14",y1:"2",y2:"2"}],["line",{x1:"12",x2:"15",y1:"14",y2:"11"}],["circle",{cx:"12",cy:"14",r:"8"}]];var ds=[["path",{d:"M12 20v2"}],["path",{d:"M12 2v2"}],["path",{d:"M17 20v2"}],["path",{d:"M17 2v2"}],["path",{d:"M2 12h2"}],["path",{d:"M2 17h2"}],["path",{d:"M2 7h2"}],["path",{d:"M20 12h2"}],["path",{d:"M20 17h2"}],["path",{d:"M20 7h2"}],["path",{d:"M7 20v2"}],["path",{d:"M7 2v2"}],["rect",{x:"4",y:"4",width:"16",height:"16",rx:"2"}],["rect",{x:"8",y:"8",width:"8",height:"8",rx:"1"}]];var vr=[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]];var br=[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{d:"M10 9H8"}],["path",{d:"M16 13H8"}],["path",{d:"M16 17H8"}]];var us=[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1"}],["path",{d:"M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v4"}],["path",{d:"M21 14H11"}],["path",{d:"m15 10-4 4 4 4"}]];var yr=[["path",{d:"M13.744 17.736a6 6 0 1 1-7.48-7.48"}],["path",{d:"M15 6h1v4"}],["path",{d:"m6.134 14.768.866-.5 2 3.464"}],["circle",{cx:"16",cy:"8",r:"6"}]];function Pl(e){return e.map(([t,s])=>{let n=Object.entries(s).map(([u,i])=>`${u}="${i}"`).join(" ");return`<${t} ${n}/>`}).join("")}function Y(e,t=16,s=""){let n=s?` class="${s}"`:"";return`<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${n}>${Pl(e)}</svg>`}function Uo(e,t,s,{onNavigate:n}){let{runs:u,preferences:i}=e,o=Object.values(u),c=o.filter(g=>g.active).length,p=o.filter(g=>!g.active).length,d=s==="open"?"connected":s==="reconnecting"?"reconnecting":"disconnected",f=s==="open"?"Connected":s==="reconnecting"?"Reconnecting\u2026":"Disconnected";return H`
    <aside class="sidebar ${i.sidebarCollapsed?"collapsed":""}">
      <div class="sidebar-logo" @click=${()=>n("dashboard")} style="cursor:pointer">
        <span class="logo-text">WORCA</span>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Pipeline</div>
        <div class="sidebar-item ${t.section==="active"?"active":""}"
             @click=${()=>n("active")}>
          <span class="sidebar-item-left">
            ${X(Y(Ai,16))}
            <span>Running</span>
          </span>
          ${c>0?H`<sl-badge variant="primary" pill>${c}</sl-badge>`:""}
        </div>
        <div class="sidebar-item ${t.section==="history"?"active":""}"
             @click=${()=>n("history")}>
          <span class="sidebar-item-left">
            ${X(Y(hr,16))}
            <span>History</span>
          </span>
          ${p>0?H`<sl-badge variant="neutral" pill>${p}</sl-badge>`:""}
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
        >${X(Y(Ti,18))}</button>
      </div>
    </aside>
  `}var Il={pending:"status-pending",in_progress:"status-in-progress",completed:"status-completed",error:"status-error",interrupted:"status-interrupted"},Hl={pending:Qt,in_progress:bt,completed:Mt,error:$t,interrupted:Bt};function ei(e,t){return e==="in_progress"&&t===!1?"interrupted":e}function ps(e){return Il[e]||"status-unknown"}function Qe(e,t=14){let s=Hl[e];return s?Y(s,t,e==="in_progress"?"icon-spin":""):"?"}var Fl={pending:Qt,in_progress:bt,completed:Mt,error:$t,interrupted:Bt};function zl(e,t){return t&&t[e]?.label?t[e].label:e.replace(/_/g," ").toUpperCase()}function jo(e,t={},s=!0){if(!e||typeof e!="object")return H``;let n=Object.entries(e);return n.length===0?H`<div class="empty-state">No stages</div>`:H`
    <div class="stage-timeline">
      ${n.map(([u,i],o)=>{let c=ei(i.status||"pending",s),p=Fl[c]||Qt,d=zl(u,t),f=c==="in_progress",g=i.iteration,w=c==="in_progress"?"icon-spin":"";return H`
          ${o>0?H`<div class="stage-connector ${n[o-1]?.[1]?.status==="completed"?"completed":""}"></div>`:""}
          <div class="stage-node ${ps(c)} ${f?"pulse":""}">
            <div class="stage-icon">${X(Y(p,22,w))}</div>
            <div class="stage-label">${d}</div>
            ${g>1?H`<span class="loop-indicator">${X(Y(Ei,10))}${g}</span>`:""}
          </div>
        `})}
    </div>
  `}function yt(e){let t=Math.floor(e/1e3),s=Math.floor(t/3600),n=Math.floor(t%3600/60),u=t%60;return s>0?`${s}h ${n}m ${u}s`:n>0?`${n}m ${u}s`:`${u}s`}function wt(e,t){let s=new Date(e).getTime();return(t?new Date(t).getTime():Date.now())-s}function Pt(e){if(!e)return"N/A";let t=new Date(e),s=n=>String(n).padStart(2,"0");return`${t.getFullYear()}.${s(t.getMonth()+1)}.${s(t.getDate())} ${s(t.getHours())}:${s(t.getMinutes())}`}function Nl(e){if(!e)return null;let t=null;for(let s of Object.values(e))s.completed_at&&(!t||s.completed_at>t)&&(t=s.completed_at);return t}function Wl(e){return e==="completed"?"success":e==="error"?"danger":e==="in_progress"||e==="interrupted"?"warning":"neutral"}function Ul(e){let t=e.status||"pending";return t==="completed"&&e.outcome==="success"?H`<span class="iter-status-icon success">${X(Qe("completed",12))}</span>`:t==="completed"?H`<span class="iter-status-icon">${X(Qe("completed",12))}</span>`:t==="error"?H`<span class="iter-status-icon failure">${X(Qe("error",12))}</span>`:t==="in_progress"?H`<span class="iter-status-icon in-progress">${X(Qe("in_progress",12))}</span>`:q}function qo(e){return e?H`<span class="iteration-trigger">${{initial:"Initial run",test_failure:"Test failure",review_changes:"Review changes",restart_planning:"Restart planning"}[e]||e}</span>`:q}function Ko(e){return e?H`<span class="iteration-outcome ${e==="success"?"success":"failure"}">${e.replace(/_/g," ")}</span>`:q}function jl(e){return e.reduce((t,s)=>t+(s.cost_usd||0),0)}function wr(e,t,s=q){let n=e?yt(wt(e,t||null)):"";return H`
    <div class="timing-strip">
      ${e?H`<span class="timing-strip-item"><span class="meta-label">Started:</span> <span class="meta-value">${Pt(e)}</span></span>`:q}
      ${t?H`<span class="timing-strip-item"><span class="meta-label">Finished:</span> <span class="meta-value">${Pt(t)}</span></span>`:q}
      ${n?H`<span class="timing-strip-item"><span class="meta-label">Duration:</span> <span class="meta-value">${n}</span></span>`:q}
      ${s}
    </div>
  `}function Vl(e,t,s,n){let u=e.agent||s||t,i=e.model||"",o=e.number??0,d=(n?.iterationPrompts||[]).find(w=>w.iteration===o)?.prompt||n?.userPrompt||null,f=d?{agentInstructions:n?.agentInstructions,userPrompt:d}:n,g=e.started_at?yt(wt(e.started_at,e.completed_at||null)):"";return H`
    <div class="iteration-detail">
      ${wr(e.started_at,e.completed_at)}
      <div class="stage-info-strip">
        ${u?H`<span class="stage-info-item"><span class="stage-meta-icon">${X(Y(ds,12))}</span> ${u}${i?H` <span class="text-muted">(${i})</span>`:""}</span>`:q}
        ${e.turns?H`<span class="stage-info-item"><span class="meta-label">Turns:</span> <span class="meta-value">${e.turns}</span></span>`:q}
        ${e.cost_usd!=null?H`<span class="stage-info-item"><span class="meta-label">Iteration Cost:</span> <span class="meta-value">$${Number(e.cost_usd).toFixed(2)}</span></span>`:q}
        ${g?H`<span class="stage-info-item"><span class="meta-label">Iteration Duration:</span> <span class="meta-value">${g}</span></span>`:q}
      </div>
      ${e.trigger?H`<div class="detail-row">${qo(e.trigger)}</div>`:q}
      ${e.outcome?H`<div class="detail-row">${Ko(e.outcome)}</div>`:q}
      ${Go(t,f)}
    </div>
  `}function Vo(e,t){navigator.clipboard.writeText(e).then(()=>{t.textContent="Copied!",setTimeout(()=>{t.textContent="Copy"},1500)})}function Go(e,t){if(!t)return q;let{agentInstructions:s,userPrompt:n}=t;return!s&&!n?q:H`
    <sl-details class="agent-prompt-section">
      <div slot="summary" class="agent-prompt-header">
        <span class="stage-meta-icon">${X(Y(br,12))}</span>
        Agent Instructions
      </div>
      ${n?H`
        <div class="agent-prompt-block">
          <div class="agent-prompt-label-row">
            <span class="agent-prompt-label">User Prompt (-p)</span>
            <button class="copy-btn" @click=${u=>Vo(n,u.currentTarget)}>
              ${X(Y(us,11))} Copy
            </button>
          </div>
          <pre class="agent-prompt-content">${n}</pre>
        </div>
      `:q}
      ${s?H`
        <div class="agent-prompt-block">
          <div class="agent-prompt-label-row">
            <span class="agent-prompt-label">System Prompt (agent .md)</span>
            <button class="copy-btn" @click=${u=>Vo(s,u.currentTarget)}>
              ${X(Y(us,11))} Copy
            </button>
          </div>
          <pre class="agent-prompt-content">${s}</pre>
        </div>
      `:q}
    </sl-details>
  `}function Xo(e,t={},s={}){if(!e)return H`<div class="empty-state">Select a run to view details</div>`;let n=e.branch||e.work_request?.branch||"",u=e.pr_url||null,i=e.completed_at||(e.active?null:Nl(e.stages)),o=e.stages||{},c=t.stageUi||{},p=t.agents||{};return H`
    <div class="run-detail">
      ${jo(o,c,e.active)}

      <div class="run-info-section">
        ${n?H`
          <div class="run-branch">
            <span class="stage-meta-icon">${X(Y(Li,14))}</span>
            <span>${n}</span>
            ${u?H`<a class="run-pr-link" href="${u}" target="_blank">View PR</a>`:q}
          </div>
        `:q}
        ${wr(e.started_at,i)}
        ${(()=>{let f=Object.values(o).flatMap(g=>g.iterations||[]).reduce((g,w)=>g+(w.cost_usd||0),0);return f>0?H`
            <div class="pipeline-cost-strip">
              <span class="meta-label">Pipeline Cost:</span> <span class="meta-value">$${f.toFixed(2)}</span>
            </div>
          `:q})()}
      </div>

      <div class="stage-panels">
        ${Object.entries(o).map(([d,f])=>{let g=c[d]?.label||d.replace(/_/g," ").toUpperCase(),w=ei(f.status||"pending",e.active),b=f.agent||p[d]?.agent||d,r=f.model||p[d]?.model||"",l=f.started_at?yt(wt(f.started_at,f.completed_at||null)):"",a=f.iterations||[],h=a.length>1,m=jl(a);return H`
            <sl-details ?open=${w==="in_progress"} class="stage-panel">
              <div slot="summary" class="stage-panel-header">
                <span class="stage-panel-icon ${ps(w)}">${X(Qe(w))}</span>
                <span class="stage-panel-label">${g}</span>
                <span class="stage-panel-meta">
                  ${h?H`
                    <span class="stage-meta-item stage-meta-iteration">
                      <span class="stage-meta-icon">${X(Y(Ei,11))}</span>
                      <span class="meta-value">${a.length} iterations</span>
                    </span>
                  `:q}
                  ${m>0?H`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${X(Y(yr,11))}</span>
                      <span class="meta-value">$${m.toFixed(2)}</span>
                    </span>
                  `:q}
                  ${f.completed_at?H`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${X(Y(lr,11))}</span>
                      <span class="meta-value">${Pt(f.completed_at)}</span>
                    </span>
                  `:q}
                  ${l?H`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${X(Y(gr,11))}</span>
                      <span class="meta-value">${l}</span>
                    </span>
                  `:q}
                </span>
                <sl-badge variant="${Wl(w)}" pill>
                  ${w.replace(/_/g," ")}
                </sl-badge>
              </div>
              ${(()=>{let v=w!=="pending"?s.promptCache?.[d]:null;if(h){let y=a.reduce((_,S)=>S.duration_ms?_+S.duration_ms/1e3:S.started_at?_+wt(S.started_at,S.completed_at||null):_,0),x=yt(y);return H`
                    <div class="stage-totals-strip">
                      <span class="stage-totals-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${m.toFixed(2)}</span></span>
                      <span class="stage-totals-item"><span class="meta-label">Duration:</span> <span class="meta-value">${x}</span></span>
                    </div>
                    <sl-tab-group>
                      ${a.map(_=>H`
                        <sl-tab slot="nav" panel="iter-${d}-${_.number}">
                          Iter ${_.number} ${Ul(_)}
                        </sl-tab>
                      `)}
                      ${a.map(_=>H`
                        <sl-tab-panel name="iter-${d}-${_.number}">
                          ${Vl(_,d,b,v)}
                        </sl-tab-panel>
                      `)}
                    </sl-tab-group>
                  `}return H`
                  <div class="stage-detail">
                    ${wr(f.started_at,f.completed_at)}
                    <div class="stage-info-strip">
                      ${b?H`<span class="stage-info-item"><span class="stage-meta-icon">${X(Y(ds,12))}</span> ${b}${r?H` <span class="text-muted">(${r})</span>`:""}</span>`:q}
                      ${a.length===1&&a[0].turns?H`<span class="stage-info-item"><span class="meta-label">Turns:</span> <span class="meta-value">${a[0].turns}</span></span>`:q}
                      ${a.length===1&&a[0].cost_usd!=null?H`<span class="stage-info-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${Number(a[0].cost_usd).toFixed(2)}</span></span>`:q}
                    </div>
                    ${a.length===1&&a[0].trigger?H`<div class="detail-row">${qo(a[0].trigger)}</div>`:q}
                    ${a.length===1&&a[0].outcome?H`<div class="detail-row">${Ko(a[0].outcome)}</div>`:q}
                    ${f.task_progress?H`<div class="detail-row"><span class="detail-label">Progress:</span> ${f.task_progress}</div>`:q}
                    ${f.error?H`<div class="detail-row detail-error"><span class="detail-label">Error:</span> ${f.error}</div>`:q}
                    ${v?Go(d,v):q}
                  </div>
                `})()}
            </sl-details>
          `})}
      </div>
    </div>
  `}var ql={completed:"success",in_progress:"warning",error:"danger",interrupted:"warning",pending:"neutral"};function fs(e,{onClick:t}={}){let s=e.work_request?.title||"Untitled",n=e.active,u=n?"in_progress":e.stage==="error"?"error":"completed",i=e.started_at&&e.completed_at?yt(wt(e.started_at,e.completed_at)):e.started_at&&n?yt(wt(e.started_at,null)):"N/A",o=e.branch||e.work_request?.branch||"",c=e.stages?Object.entries(e.stages):[];return H`
    <div class="run-card" @click=${t?()=>t(e.id):null}>
      <div class="run-card-top">
        <span class="run-card-status">${X(Qe(u,16))}</span>
        <span class="run-card-title">${s}</span>
      </div>
      ${o?H`<div class="run-card-meta"><span class="run-card-meta-item"><span class="meta-label">Branch:</span> ${o}</span></div>`:q}
      <div class="run-card-meta">
        <span class="run-card-meta-item"><span class="meta-label">Started:</span> ${Pt(e.started_at)}</span>
        <span class="run-card-meta-item"><span class="meta-label">Finished:</span> ${Pt(e.completed_at)}</span>
        <span class="run-card-meta-item"><span class="meta-label">Duration:</span> ${i}</span>
      </div>
      ${c.length>0?H`
        <div class="run-card-stages">
          ${c.map(([p,d])=>{let f=ei(d.status||"pending",n),g=ql[f]||"neutral",w=p.replace(/_/g," ").toUpperCase();return H`<sl-badge variant="${g}" pill class="run-card-stage-badge">${w}</sl-badge>`})}
        </div>
      `:q}
    </div>
  `}function Sr(e,t,{onSelectRun:s}){let n=e.filter(u=>t==="active"?u.active:!u.active);return n.length===0?H`<div class="empty-state">
      ${t==="active"?"No running pipelines":"No completed runs yet"}
    </div>`:H`
    <div class="run-list">
      ${n.map(u=>fs(u,{onClick:s}))}
    </div>
  `}function Yo(e,{onSelectRun:t}={}){let s=Object.values(e.runs),n=s.filter(c=>c.active),u=s.filter(c=>!c.active),i=s.filter(c=>(c.stages?Object.values(c.stages):[]).some(d=>d.status==="error")),o=s.length;return H`
    <div class="dashboard">
      <div class="dashboard-stats">
        <div class="stat-card stat-total">
          <div class="stat-icon-ring">${X(Y(ar,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${o}</span>
            <span class="stat-label">Total Runs</span>
          </div>
        </div>
        <div class="stat-card stat-active">
          <div class="stat-icon-ring">${X(Y(Ai,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${n.length}</span>
            <span class="stat-label">Active</span>
          </div>
        </div>
        <div class="stat-card stat-completed">
          <div class="stat-icon-ring">${X(Y(Mt,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${u.length}</span>
            <span class="stat-label">Completed</span>
          </div>
        </div>
        <div class="stat-card stat-errors">
          <div class="stat-icon-ring">${X(Y($t,20))}</div>
          <div class="stat-body">
            <span class="stat-number">${i.length}</span>
            <span class="stat-label">Errors</span>
          </div>
        </div>
      </div>

      <h3 class="dashboard-section-title">Active Runs</h3>
      ${n.length>0?H`
        <div class="run-list">
          ${n.map(c=>fs(c,{onClick:t}))}
        </div>
      `:H`<div class="empty-state">No running pipelines</div>`}
    </div>
  `}var Kl={plan:"planner",coordinate:"coordinator",implement:"implementer",test:"tester",review:"guardian",pr:"guardian"},_s=["plan","coordinate","implement","test","review","pr"],Oi=["planner","coordinator","implementer","tester","guardian"],Gl=["opus","sonnet","haiku"],Ri={plan:{agent:"planner",enabled:!0},coordinate:{agent:"coordinator",enabled:!0},implement:{agent:"implementer",enabled:!0},test:{agent:"tester",enabled:!0},review:{agent:"guardian",enabled:!0},pr:{agent:"guardian",enabled:!0}},Jo=[{key:"block_rm_rf",label:"Block rm -rf",description:"Prevent recursive force-delete commands"},{key:"block_env_write",label:"Block .env writes",description:"Prevent writing to .env files"},{key:"block_force_push",label:"Block force push",description:"Prevent git push --force"},{key:"restrict_git_commit",label:"Restrict git commit",description:"Only guardian agent may commit"}],It={guards:{block_rm_rf:!0,block_env_write:!0,block_force_push:!0,restrict_git_commit:!0},test_gate_strikes:2,dispatch:{planner:[],coordinator:["implementer"],implementer:[],tester:[],guardian:[]}},_e=null,Ge=null,Ht="";async function Cr(){try{let e=await fetch("/api/settings");if(!e.ok)throw new Error(`HTTP ${e.status}`);if(_e=await e.json(),_e.worca||(_e.worca={}),!_e.worca.stages)_e.worca.stages={...Ri};else for(let t of _s)_e.worca.stages[t]||(_e.worca.stages[t]={...Ri[t]});_e.worca.governance?_e.worca.governance={...It,..._e.worca.governance,guards:{...It.guards,..._e.worca.governance.guards||{}},dispatch:{...It.dispatch,..._e.worca.governance.dispatch||{}}}:_e.worca.governance={...It}}catch(e){_e=null,Ge="error",Ht="Failed to load settings: "+e.message}}async function xr(e,t){Ge="saving",Ht="",t();try{let s=await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(e)});if(!s.ok)throw new Error(`HTTP ${s.status}`);let n=await s.json();_e={worca:n.worca,permissions:n.permissions},Ge="success",Ht="Settings saved successfully"}catch(s){Ge="error",Ht="Failed to save: "+s.message}t(),Ge==="success"&&setTimeout(()=>{Ge==="success"&&(Ge=null,Ht="",t())},3e3)}function Xl(){let e={};for(let t of Oi){let s=document.getElementById(`agent-${t}-model`),n=document.getElementById(`agent-${t}-turns`);e[t]={model:s?.value||"sonnet",max_turns:parseInt(n?.value,10)||30}}return e}function Yl(){let e={};for(let t of["implement_test","code_review","pr_changes","restart_planning"]){let s=document.getElementById(`loop-${t}`);e[t]=parseInt(s?.value,10)||0}return{loops:e}}function Jl(){let e={};for(let t of _s){let s=document.getElementById(`stage-${t}-enabled`),n=document.getElementById(`stage-${t}-agent`);e[t]={agent:n?.value||Ri[t].agent,enabled:s?.checked??!0}}return e}function Zl(){let e={};for(let u of Jo){let i=document.getElementById(`guard-${u.key}`);e[u.key]=i?.checked??!0}let t=document.getElementById("test-gate-strikes"),s=parseInt(t?.value,10)||2,n={};for(let u of Oi){let o=(document.getElementById(`dispatch-${u}`)?.value||"").trim();n[u]=o?o.split(",").map(c=>c.trim()).filter(Boolean):[]}return{guards:e,test_gate_strikes:s,dispatch:n}}function Ql(e,t){let s=e.agents||{};return H`
    <div class="settings-tab-content">
      <div class="settings-cards">
        ${Oi.map(n=>{let u=s[n]||{};return H`
            <div class="settings-card">
              <div class="settings-card-header">
                <span class="settings-card-icon">${X(Y(hs,18))}</span>
                <span class="settings-card-title">${n}</span>
              </div>
              <div class="settings-card-body">
                <div class="settings-field">
                  <label class="settings-label">Model</label>
                  <sl-select id="agent-${n}-model" .value="${u.model||"sonnet"}" size="small">
                    ${Gl.map(i=>H`<sl-option value="${i}">${i}</sl-option>`)}
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
        <sl-button variant="primary" size="small" @click=${()=>{let n=Xl();xr({worca:{..._e.worca,agents:n},permissions:_e.permissions},t)}}>
          ${X(Y(Di,14))}
          Save Agents
        </sl-button>
      </div>
    </div>
  `}function ec(e,t){let s=e.loops||{},n=e.stages||Ri;return H`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Stage Configuration</h3>
      <div class="pipeline-flow">
        ${_s.map((u,i)=>{let o=n[u]||Ri[u],c=o.enabled!==!1;return H`
            <div class="pipeline-stage-node ${c?"pipeline-stage-node--enabled":"pipeline-stage-node--disabled"}">
              <div class="pipeline-stage-header">
                <span class="pipeline-stage-name ${c?"":"pipeline-stage-name--disabled"}">${u}</span>
                <sl-switch id="stage-${u}-enabled" ?checked=${c} size="small"
                  @sl-change=${p=>{let d=p.target.closest(".pipeline-stage-node");p.target.checked?(d.classList.remove("pipeline-stage-node--disabled"),d.classList.add("pipeline-stage-node--enabled"),d.querySelector(".pipeline-stage-name").classList.remove("pipeline-stage-name--disabled")):(d.classList.remove("pipeline-stage-node--enabled"),d.classList.add("pipeline-stage-node--disabled"),d.querySelector(".pipeline-stage-name").classList.add("pipeline-stage-name--disabled"))}}></sl-switch>
              </div>
              <div class="settings-field pipeline-stage-field">
                <label class="settings-label">Agent</label>
                <sl-select id="stage-${u}-agent" .value="${o.agent||Kl[u]}" size="small">
                  ${Oi.map(p=>H`<sl-option value="${p}">${p}</sl-option>`)}
                </sl-select>
              </div>
            </div>
            ${i<_s.length-1?H`
              <span class="pipeline-arrow">${X(Y(mr,16))}</span>
            `:q}
          `})}
      </div>

      <h3 class="settings-section-title">Loop Limits</h3>
      <div class="settings-grid">
        ${[{key:"implement_test",label:"Implement \u2194 Test"},{key:"code_review",label:"Code Review"},{key:"pr_changes",label:"PR Changes"},{key:"restart_planning",label:"Restart Planning"}].map(u=>H`
          <div class="settings-field">
            <label class="settings-label">${u.label}</label>
            <sl-input id="loop-${u.key}" type="number" value="${s[u.key]||0}" size="small" min="0" max="50"></sl-input>
          </div>
        `)}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${()=>{let{loops:u}=Yl(),i=Jl();xr({worca:{..._e.worca,loops:u,stages:i},permissions:_e.permissions},t)}}>
          ${X(Y(Di,14))}
          Save Pipeline
        </sl-button>
      </div>
    </div>
  `}function tc(e,t,s){let n=e.governance||It,u=n.guards||It.guards,i=n.dispatch||It.dispatch,o=t.allow||[];return H`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Guard Rules</h3>
      <div class="settings-switches">
        ${Jo.map(c=>H`
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
        ${Oi.map(c=>H`
          <div class="settings-dispatch-row">
            <span class="settings-dispatch-agent">${c}</span>
            <sl-input id="dispatch-${c}" value="${(i[c]||[]).join(", ")}" size="small" placeholder="none"></sl-input>
          </div>
        `)}
      </div>

      <h3 class="settings-section-title">Permissions</h3>
      <div class="settings-permissions">
        ${o.length>0?o.map(c=>H`<div class="settings-perm-item"><code>${c}</code></div>`):H`<span class="settings-muted">No permissions configured</span>`}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${()=>{let c=Zl();xr({worca:{..._e.worca,governance:c},permissions:_e.permissions},s)}}>
          ${X(Y(Di,14))}
          Save Governance
        </sl-button>
      </div>
    </div>
  `}function ic(e,t){let s=e?.theme||"light";return H`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Appearance</h3>
      <div class="settings-switches">
        <div class="settings-switch-row">
          <sl-switch ?checked=${s==="dark"} size="small" @sl-change=${t}>Dark Mode</sl-switch>
          <span class="settings-switch-desc">Toggle between light and dark theme</span>
        </div>
      </div>
    </div>
  `}function sc(e){return!Ge||Ge==="saving"?q:H`
    <div class="settings-toast">
      <sl-alert variant="${Ge==="success"?"success":"danger"}" open closable duration="3000"
        @sl-after-hide=${()=>{Ge=null,Ht="",e()}}>
        ${Ht}
      </sl-alert>
    </div>
  `}function Zo(e,{rerender:t,onThemeToggle:s}){if(!_e)return H`<div class="empty-state">Loading settings\u2026</div>`;let n=_e.worca||{},u=_e.permissions||{};return H`
    ${sc(t)}
    <div class="settings-page">
      <sl-tab-group>
        <sl-tab slot="nav" panel="agents">
          ${X(Y(hs,14))}
          Agents
        </sl-tab>
        <sl-tab slot="nav" panel="pipeline">
          ${X(Y(Li,14))}
          Pipeline
        </sl-tab>
        <sl-tab slot="nav" panel="governance">
          ${X(Y(_r,14))}
          Governance
        </sl-tab>
        <sl-tab slot="nav" panel="preferences">
          ${X(Y(Ti,14))}
          Preferences
        </sl-tab>

        <sl-tab-panel name="agents">${Ql(n,t)}</sl-tab-panel>
        <sl-tab-panel name="pipeline">${ec(n,t)}</sl-tab-panel>
        <sl-tab-panel name="governance">${tc(n,u,t)}</sl-tab-panel>
        <sl-tab-panel name="preferences">${ic(e,s)}</sl-tab-panel>
      </sl-tab-group>
    </div>
  `}var Tn=["\x1B[36m","\x1B[33m","\x1B[35m","\x1B[32m","\x1B[34m","\x1B[91m","\x1B[96m","\x1B[93m"],zr="\x1B[0m",Rn="\x1B[2m",ks=new Map,Nr=0;function sh(e){return ks.has(e)||(ks.set(e,Tn[Nr%Tn.length]),Nr++),ks.get(e)}var Be=null,Ft=null,Pi=null,Wr=null,Bi=null;async function rh(e){if(Be&&e.querySelector(".xterm")){Ft.fit();return}let[{Terminal:t},{FitAddon:s},{SearchAddon:n}]=await Promise.all([Promise.resolve().then(()=>Ol(en(),1)),Promise.resolve().then(()=>(sn(),tn)),Promise.resolve().then(()=>(Dn(),Ln))]);Be=new t({theme:{background:"#0f172a",foreground:"#e2e8f0",cursor:"#60a5fa",selectionBackground:"rgba(96, 165, 250, 0.3)"},fontFamily:"'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",fontSize:13,lineHeight:1.4,scrollback:5e4,convertEol:!0,cursorBlink:!1,disableStdin:!0}),Ft=new s,Pi=new n,Be.loadAddon(Ft),Be.loadAddon(Pi),Be.open(e),Ft.fit(),Bi=new ResizeObserver(()=>{Ft&&Ft.fit()}),Bi.observe(e)}function Ur(e){if(!Be)return;let t=e.timestamp?`${Rn}${e.timestamp}${zr} `:"",s=e.stage?`${sh(e.stage)}[${e.stage.toUpperCase()}]${zr} `:"",n=e.line||e;Be.writeln(`${t}${s}${n}`)}function Ii(){Be&&Be.clear(),ks.clear(),Nr=0}function On(){Bi&&Bi.disconnect(),Be&&Be.dispose(),Be=null,Ft=null,Pi=null,Bi=null,Wr=null}function Mn(e){Pi&&e&&Pi.findNext(e,{incremental:!0})}async function $n(e){let t=document.getElementById("log-terminal");t&&(e!==Wr&&(Ii(),Wr=e),await rh(t))}function Bn(e){Be&&Be.writeln(`
${Rn}${"\u2500".repeat(40)} Iteration ${e} ${"\u2500".repeat(40)}${zr}
`)}function Pn(e,{onStageFilter:t,onIterationFilter:s,onSearch:n,onToggleAutoScroll:u,autoScroll:i,stageIterations:o,runStages:c}){let p=c?["orchestrator",...Object.keys(c)]:null,d=[...new Set(["orchestrator",...e.logLines.map(r=>r.stage).filter(Boolean)])],f=p||d,g=e.currentLogStage,w=o?.[g]||0,b=g&&g!=="*"&&w>1;return H`
    <div class="log-viewer-container">
      <div class="log-controls">
        <sl-select
          placeholder="All Stages"
          size="small"
          clearable
          @sl-change=${r=>t(r.target.value||"*")}
        >
          ${f.map(r=>H`<sl-option value="${r}">${r==="orchestrator"?H`<span style="display:inline-flex;align-items:center;gap:4px">${X(Y(vr,12))} ORCHESTRATOR</span>`:r.toUpperCase()}</sl-option>`)}
        </sl-select>
        ${b?H`
          <sl-select
            placeholder="All Iterations"
            size="small"
            clearable
            @sl-change=${r=>s(r.target.value?parseInt(r.target.value):null)}
          >
            ${Array.from({length:w},(r,l)=>H`<sl-option value="${l+1}">Iteration ${l+1}</sl-option>`)}
          </sl-select>
        `:q}
        <sl-input
          class="log-search"
          type="text"
          placeholder="Search logs\u2026"
          size="small"
          clearable
          @sl-input=${r=>n(r.target.value)}
        >
          <span slot="prefix">${X(Y(dr,14))}</span>
        </sl-input>
        <sl-button
          size="small"
          variant="${i?"primary":"default"}"
          @click=${u}
        >
          ${X(Y(i?nr:Bt,14))}
          ${i?"Auto":"Paused"}
        </sl-button>
      </div>
      <div class="log-terminal-wrapper">
        <div id="log-terminal" class="log-terminal"></div>
      </div>
    </div>
  `}var Es=globalThis,As=Es.ShadowRoot&&(Es.ShadyCSS===void 0||Es.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,jr=Symbol(),In=new WeakMap,Hi=class{constructor(t,s,n){if(this._$cssResult$=!0,n!==jr)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=s}get styleSheet(){let t=this.o,s=this.t;if(As&&t===void 0){let n=s!==void 0&&s.length===1;n&&(t=In.get(s)),t===void 0&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),n&&In.set(s,t))}return t}toString(){return this.cssText}},Hn=e=>new Hi(typeof e=="string"?e:e+"",void 0,jr),J=(e,...t)=>{let s=e.length===1?e[0]:t.reduce((n,u,i)=>n+(o=>{if(o._$cssResult$===!0)return o.cssText;if(typeof o=="number")return o;throw Error("Value passed to 'css' function must be a 'css' function result: "+o+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(u)+e[i+1],e[0]);return new Hi(s,e,jr)},Fn=(e,t)=>{if(As)e.adoptedStyleSheets=t.map(s=>s instanceof CSSStyleSheet?s:s.styleSheet);else for(let s of t){let n=document.createElement("style"),u=Es.litNonce;u!==void 0&&n.setAttribute("nonce",u),n.textContent=s.cssText,e.appendChild(n)}},Vr=As?e=>e:e=>e instanceof CSSStyleSheet?(t=>{let s="";for(let n of t.cssRules)s+=n.cssText;return Hn(s)})(e):e;var{is:oh,defineProperty:nh,getOwnPropertyDescriptor:ah,getOwnPropertyNames:lh,getOwnPropertySymbols:ch,getPrototypeOf:hh}=Object,Ct=globalThis,zn=Ct.trustedTypes,dh=zn?zn.emptyScript:"",uh=Ct.reactiveElementPolyfillSupport,Fi=(e,t)=>e,xt={toAttribute(e,t){switch(t){case Boolean:e=e?dh:null;break;case Object:case Array:e=e==null?e:JSON.stringify(e)}return e},fromAttribute(e,t){let s=e;switch(t){case Boolean:s=e!==null;break;case Number:s=e===null?null:Number(e);break;case Object:case Array:try{s=JSON.parse(e)}catch{s=null}}return s}},Ls=(e,t)=>!oh(e,t),Nn={attribute:!0,type:String,converter:xt,reflect:!1,useDefault:!1,hasChanged:Ls};Symbol.metadata??(Symbol.metadata=Symbol("metadata")),Ct.litPropertyMetadata??(Ct.litPropertyMetadata=new WeakMap);var ht=class extends HTMLElement{static addInitializer(t){this._$Ei(),(this.l??(this.l=[])).push(t)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(t,s=Nn){if(s.state&&(s.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(t)&&((s=Object.create(s)).wrapped=!0),this.elementProperties.set(t,s),!s.noAccessor){let n=Symbol(),u=this.getPropertyDescriptor(t,n,s);u!==void 0&&nh(this.prototype,t,u)}}static getPropertyDescriptor(t,s,n){let{get:u,set:i}=ah(this.prototype,t)??{get(){return this[s]},set(o){this[s]=o}};return{get:u,set(o){let c=u?.call(this);i?.call(this,o),this.requestUpdate(t,c,n)},configurable:!0,enumerable:!0}}static getPropertyOptions(t){return this.elementProperties.get(t)??Nn}static _$Ei(){if(this.hasOwnProperty(Fi("elementProperties")))return;let t=hh(this);t.finalize(),t.l!==void 0&&(this.l=[...t.l]),this.elementProperties=new Map(t.elementProperties)}static finalize(){if(this.hasOwnProperty(Fi("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(Fi("properties"))){let s=this.properties,n=[...lh(s),...ch(s)];for(let u of n)this.createProperty(u,s[u])}let t=this[Symbol.metadata];if(t!==null){let s=litPropertyMetadata.get(t);if(s!==void 0)for(let[n,u]of s)this.elementProperties.set(n,u)}this._$Eh=new Map;for(let[s,n]of this.elementProperties){let u=this._$Eu(s,n);u!==void 0&&this._$Eh.set(u,s)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(t){let s=[];if(Array.isArray(t)){let n=new Set(t.flat(1/0).reverse());for(let u of n)s.unshift(Vr(u))}else t!==void 0&&s.push(Vr(t));return s}static _$Eu(t,s){let n=s.attribute;return n===!1?void 0:typeof n=="string"?n:typeof t=="string"?t.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(t=>t(this))}addController(t){(this._$EO??(this._$EO=new Set)).add(t),this.renderRoot!==void 0&&this.isConnected&&t.hostConnected?.()}removeController(t){this._$EO?.delete(t)}_$E_(){let t=new Map,s=this.constructor.elementProperties;for(let n of s.keys())this.hasOwnProperty(n)&&(t.set(n,this[n]),delete this[n]);t.size>0&&(this._$Ep=t)}createRenderRoot(){let t=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Fn(t,this.constructor.elementStyles),t}connectedCallback(){this.renderRoot??(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),this._$EO?.forEach(t=>t.hostConnected?.())}enableUpdating(t){}disconnectedCallback(){this._$EO?.forEach(t=>t.hostDisconnected?.())}attributeChangedCallback(t,s,n){this._$AK(t,n)}_$ET(t,s){let n=this.constructor.elementProperties.get(t),u=this.constructor._$Eu(t,n);if(u!==void 0&&n.reflect===!0){let i=(n.converter?.toAttribute!==void 0?n.converter:xt).toAttribute(s,n.type);this._$Em=t,i==null?this.removeAttribute(u):this.setAttribute(u,i),this._$Em=null}}_$AK(t,s){let n=this.constructor,u=n._$Eh.get(t);if(u!==void 0&&this._$Em!==u){let i=n.getPropertyOptions(u),o=typeof i.converter=="function"?{fromAttribute:i.converter}:i.converter?.fromAttribute!==void 0?i.converter:xt;this._$Em=u;let c=o.fromAttribute(s,i.type);this[u]=c??this._$Ej?.get(u)??c,this._$Em=null}}requestUpdate(t,s,n,u=!1,i){if(t!==void 0){let o=this.constructor;if(u===!1&&(i=this[t]),n??(n=o.getPropertyOptions(t)),!((n.hasChanged??Ls)(i,s)||n.useDefault&&n.reflect&&i===this._$Ej?.get(t)&&!this.hasAttribute(o._$Eu(t,n))))return;this.C(t,s,n)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(t,s,{useDefault:n,reflect:u,wrapped:i},o){n&&!(this._$Ej??(this._$Ej=new Map)).has(t)&&(this._$Ej.set(t,o??s??this[t]),i!==!0||o!==void 0)||(this._$AL.has(t)||(this.hasUpdated||n||(s=void 0),this._$AL.set(t,s)),u===!0&&this._$Em!==t&&(this._$Eq??(this._$Eq=new Set)).add(t))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(s){Promise.reject(s)}let t=this.scheduleUpdate();return t!=null&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??(this.renderRoot=this.createRenderRoot()),this._$Ep){for(let[u,i]of this._$Ep)this[u]=i;this._$Ep=void 0}let n=this.constructor.elementProperties;if(n.size>0)for(let[u,i]of n){let{wrapped:o}=i,c=this[u];o!==!0||this._$AL.has(u)||c===void 0||this.C(u,void 0,i,c)}}let t=!1,s=this._$AL;try{t=this.shouldUpdate(s),t?(this.willUpdate(s),this._$EO?.forEach(n=>n.hostUpdate?.()),this.update(s)):this._$EM()}catch(n){throw t=!1,this._$EM(),n}t&&this._$AE(s)}willUpdate(t){}_$AE(t){this._$EO?.forEach(s=>s.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(t)),this.updated(t)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(t){return!0}update(t){this._$Eq&&(this._$Eq=this._$Eq.forEach(s=>this._$ET(s,this[s]))),this._$EM()}updated(t){}firstUpdated(t){}};ht.elementStyles=[],ht.shadowRootOptions={mode:"open"},ht[Fi("elementProperties")]=new Map,ht[Fi("finalized")]=new Map,uh?.({ReactiveElement:ht}),(Ct.reactiveElementVersions??(Ct.reactiveElementVersions=[])).push("2.1.2");var zi=globalThis,kt=class extends ht{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var s;let t=super.createRenderRoot();return(s=this.renderOptions).renderBefore??(s.renderBefore=t.firstChild),t}update(t){let s=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=cs(s,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return Te}};kt._$litElement$=!0,kt.finalized=!0,zi.litElementHydrateSupport?.({LitElement:kt});var ph=zi.litElementPolyfillSupport;ph?.({LitElement:kt});(zi.litElementVersions??(zi.litElementVersions=[])).push("4.2.2");var Wn=J`
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
`;var Vn=Object.defineProperty,fh=Object.defineProperties,_h=Object.getOwnPropertyDescriptor,mh=Object.getOwnPropertyDescriptors,Un=Object.getOwnPropertySymbols,gh=Object.prototype.hasOwnProperty,vh=Object.prototype.propertyIsEnumerable,qr=(e,t)=>(t=Symbol[e])?t:Symbol.for("Symbol."+e),Kr=e=>{throw TypeError(e)},jn=(e,t,s)=>t in e?Vn(e,t,{enumerable:!0,configurable:!0,writable:!0,value:s}):e[t]=s,Re=(e,t)=>{for(var s in t||(t={}))gh.call(t,s)&&jn(e,s,t[s]);if(Un)for(var s of Un(t))vh.call(t,s)&&jn(e,s,t[s]);return e},dt=(e,t)=>fh(e,mh(t)),T=(e,t,s,n)=>{for(var u=n>1?void 0:n?_h(t,s):t,i=e.length-1,o;i>=0;i--)(o=e[i])&&(u=(n?o(t,s,u):o(u))||u);return n&&u&&Vn(t,s,u),u},qn=(e,t,s)=>t.has(e)||Kr("Cannot "+s),Kn=(e,t,s)=>(qn(e,t,"read from private field"),s?s.call(e):t.get(e)),Gn=(e,t,s)=>t.has(e)?Kr("Cannot add the same private member more than once"):t instanceof WeakSet?t.add(e):t.set(e,s),Xn=(e,t,s,n)=>(qn(e,t,"write to private field"),n?n.call(e,s):t.set(e,s),s),bh=function(e,t){this[0]=e,this[1]=t},Yn=e=>{var t=e[qr("asyncIterator")],s=!1,n,u={};return t==null?(t=e[qr("iterator")](),n=i=>u[i]=o=>t[i](o)):(t=t.call(e),n=i=>u[i]=o=>{if(s){if(s=!1,i==="throw")throw o;return o}return s=!0,{done:!1,value:new bh(new Promise(c=>{var p=t[i](o);p instanceof Object||Kr("Object expected"),c(p)}),1)}}),u[qr("iterator")]=()=>u,n("next"),"throw"in t?n("throw"):u.throw=i=>{throw i},"return"in t&&n("return"),u};var Zn=new Map,yh=new WeakMap;function wh(e){return e??{keyframes:[],options:{duration:0}}}function Jn(e,t){return t.toLowerCase()==="rtl"?{keyframes:e.rtlKeyframes||e.keyframes,options:e.options}:e}function we(e,t){Zn.set(e,wh(t))}function Se(e,t,s){let n=yh.get(e);if(n?.[t])return Jn(n[t],s.dir);let u=Zn.get(t);return u?Jn(u,s.dir):{keyframes:[],options:{duration:0}}}function Oe(e,t){return new Promise(s=>{function n(u){u.target===e&&(e.removeEventListener(t,n),s())}e.addEventListener(t,n)})}function Ce(e,t,s){return new Promise(n=>{if(s?.duration===1/0)throw new Error("Promise-based animations must be finite.");let u=e.animate(t,dt(Re({},s),{duration:Sh()?0:s.duration}));u.addEventListener("cancel",n,{once:!0}),u.addEventListener("finish",n,{once:!0})})}function Gr(e){return e=e.toString().toLowerCase(),e.indexOf("ms")>-1?parseFloat(e):e.indexOf("s")>-1?parseFloat(e)*1e3:parseFloat(e)}function Sh(){return window.matchMedia("(prefers-reduced-motion: reduce)").matches}function Ae(e){return Promise.all(e.getAnimations().map(t=>new Promise(s=>{t.cancel(),requestAnimationFrame(s)})))}function Xr(e,t){return e.map(s=>dt(Re({},s),{height:s.height==="auto"?`${t}px`:s.height}))}var Yr=new Set,ri=new Map,zt,Jr="ltr",Zr="en",Qn=typeof MutationObserver<"u"&&typeof document<"u"&&typeof document.documentElement<"u";if(Qn){let e=new MutationObserver(ea);Jr=document.documentElement.dir||"ltr",Zr=document.documentElement.lang||navigator.language,e.observe(document.documentElement,{attributes:!0,attributeFilter:["dir","lang"]})}function Ni(...e){e.map(t=>{let s=t.$code.toLowerCase();ri.has(s)?ri.set(s,Object.assign(Object.assign({},ri.get(s)),t)):ri.set(s,t),zt||(zt=t)}),ea()}function ea(){Qn&&(Jr=document.documentElement.dir||"ltr",Zr=document.documentElement.lang||navigator.language),[...Yr.keys()].map(e=>{typeof e.requestUpdate=="function"&&e.requestUpdate()})}var Ds=class{constructor(t){this.host=t,this.host.addController(this)}hostConnected(){Yr.add(this.host)}hostDisconnected(){Yr.delete(this.host)}dir(){return`${this.host.dir||Jr}`.toLowerCase()}lang(){return`${this.host.lang||Zr}`.toLowerCase()}getTranslationData(t){var s,n;let u=new Intl.Locale(t.replace(/_/g,"-")),i=u?.language.toLowerCase(),o=(n=(s=u?.region)===null||s===void 0?void 0:s.toLowerCase())!==null&&n!==void 0?n:"",c=ri.get(`${i}-${o}`),p=ri.get(i);return{locale:u,language:i,region:o,primary:c,secondary:p}}exists(t,s){var n;let{primary:u,secondary:i}=this.getTranslationData((n=s.lang)!==null&&n!==void 0?n:this.lang());return s=Object.assign({includeFallback:!1},s),!!(u&&u[t]||i&&i[t]||s.includeFallback&&zt&&zt[t])}term(t,...s){let{primary:n,secondary:u}=this.getTranslationData(this.lang()),i;if(n&&n[t])i=n[t];else if(u&&u[t])i=u[t];else if(zt&&zt[t])i=zt[t];else return console.error(`No translation found for: ${String(t)}`),String(t);return typeof i=="function"?i(...s):i}date(t,s){return t=new Date(t),new Intl.DateTimeFormat(this.lang(),s).format(t)}number(t,s){return t=Number(t),isNaN(t)?"":new Intl.NumberFormat(this.lang(),s).format(t)}relativeTime(t,s,n){return new Intl.RelativeTimeFormat(this.lang(),n).format(t,s)}};var ta={$code:"en",$name:"English",$dir:"ltr",carousel:"Carousel",clearEntry:"Clear entry",close:"Close",copied:"Copied",copy:"Copy",currentValue:"Current value",error:"Error",goToSlide:(e,t)=>`Go to slide ${e} of ${t}`,hidePassword:"Hide password",loading:"Loading",nextSlide:"Next slide",numOptionsSelected:e=>e===0?"No options selected":e===1?"1 option selected":`${e} options selected`,previousSlide:"Previous slide",progress:"Progress",remove:"Remove",resize:"Resize",scrollToEnd:"Scroll to end",scrollToStart:"Scroll to start",selectAColorFromTheScreen:"Select a color from the screen",showPassword:"Show password",slideNum:e=>`Slide ${e}`,toggleColorFormat:"Toggle color format"};Ni(ta);var ia=ta;var fe=class extends Ds{};Ni(ia);var Qr="";function sa(e){Qr=e}function ra(e=""){if(!Qr){let t=[...document.getElementsByTagName("script")],s=t.find(n=>n.hasAttribute("data-shoelace"));if(s)sa(s.getAttribute("data-shoelace"));else{let n=t.find(i=>/shoelace(\.min)?\.js($|\?)/.test(i.src)||/shoelace-autoloader(\.min)?\.js($|\?)/.test(i.src)),u="";n&&(u=n.getAttribute("src")),sa(u.split("/").slice(0,-1).join("/"))}}return Qr.replace(/\/$/,"")+(e?`/${e.replace(/^\//,"")}`:"")}var Ch={name:"default",resolver:e=>ra(`assets/icons/${e}.svg`)},oa=Ch;var na={caret:`
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
  `},xh={name:"system",resolver:e=>e in na?`data:image/svg+xml,${encodeURIComponent(na[e])}`:""},aa=xh;var kh=[oa,aa],eo=[];function la(e){eo.push(e)}function ca(e){eo=eo.filter(t=>t!==e)}function to(e){return kh.find(t=>t.name===e)}var ha=J`
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
`;function te(e,t){let s=Re({waitUntilFirstUpdate:!1},t);return(n,u)=>{let{update:i}=n,o=Array.isArray(e)?e:[e];n.update=function(c){o.forEach(p=>{let d=p;if(c.has(d)){let f=c.get(d),g=this[d];f!==g&&(!s.waitUntilFirstUpdate||this.hasUpdated)&&this[u](f,g)}}),i.call(this,c)}}}var oe=J`
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
`;var Eh={attribute:!0,type:String,converter:xt,reflect:!1,hasChanged:Ls},Ah=(e=Eh,t,s)=>{let{kind:n,metadata:u}=s,i=globalThis.litPropertyMetadata.get(u);if(i===void 0&&globalThis.litPropertyMetadata.set(u,i=new Map),n==="setter"&&((e=Object.create(e)).wrapped=!0),i.set(s.name,e),n==="accessor"){let{name:o}=s;return{set(c){let p=t.get.call(this);t.set.call(this,c),this.requestUpdate(o,p,e,!0,c)},init(c){return c!==void 0&&this.C(o,void 0,e,c),c}}}if(n==="setter"){let{name:o}=s;return function(c){let p=this[o];t.call(this,c),this.requestUpdate(o,p,e,!0,c)}}throw Error("Unsupported decorator location: "+n)};function P(e){return(t,s)=>typeof s=="object"?Ah(e,t,s):((n,u,i)=>{let o=u.hasOwnProperty(i);return u.constructor.createProperty(i,n),o?Object.getOwnPropertyDescriptor(u,i):void 0})(e,t,s)}function pe(e){return P({...e,state:!0,attribute:!1})}function da(e){return(t,s)=>{let n=typeof t=="function"?t:t[s];Object.assign(n,e)}}var Nt=(e,t,s)=>(s.configurable=!0,s.enumerable=!0,Reflect.decorate&&typeof t!="object"&&Object.defineProperty(e,t,s),s);function Z(e,t){return(s,n,u)=>{let i=o=>o.renderRoot?.querySelector(e)??null;if(t){let{get:o,set:c}=typeof n=="object"?s:u??(()=>{let p=Symbol();return{get(){return this[p]},set(d){this[p]=d}}})();return Nt(s,n,{get(){let p=o.call(this);return p===void 0&&(p=i(this),(p!==null||this.hasUpdated)&&c.call(this,p)),p}})}return Nt(s,n,{get(){return i(this)}})}}var Ts,Q=class extends kt{constructor(){super(),Gn(this,Ts,!1),this.initialReflectedProperties=new Map,Object.entries(this.constructor.dependencies).forEach(([e,t])=>{this.constructor.define(e,t)})}emit(e,t){let s=new CustomEvent(e,Re({bubbles:!0,cancelable:!1,composed:!0,detail:{}},t));return this.dispatchEvent(s),s}static define(e,t=this,s={}){let n=customElements.get(e);if(!n){try{customElements.define(e,t,s)}catch{customElements.define(e,class extends t{},s)}return}let u=" (unknown version)",i=u;"version"in t&&t.version&&(u=" v"+t.version),"version"in n&&n.version&&(i=" v"+n.version),!(u&&i&&u===i)&&console.warn(`Attempted to register <${e}>${u}, but <${e}>${i} has already been registered.`)}attributeChangedCallback(e,t,s){Kn(this,Ts)||(this.constructor.elementProperties.forEach((n,u)=>{n.reflect&&this[u]!=null&&this.initialReflectedProperties.set(u,this[u])}),Xn(this,Ts,!0)),super.attributeChangedCallback(e,t,s)}willUpdate(e){super.willUpdate(e),this.initialReflectedProperties.forEach((t,s)=>{e.has(s)&&this[s]==null&&(this[s]=t)})}};Ts=new WeakMap;Q.version="2.20.1";Q.dependencies={};T([P()],Q.prototype,"dir",2);T([P()],Q.prototype,"lang",2);var{I:ym}=Io;var ua=(e,t)=>t===void 0?e?._$litType$!==void 0:e?._$litType$===t;var pa=e=>e.strings===void 0;var Lh={},fa=(e,t=Lh)=>e._$AH=t;var Wi=Symbol(),Rs=Symbol(),io,so=new Map,be=class extends Q{constructor(){super(...arguments),this.initialRender=!1,this.svg=null,this.label="",this.library="default"}async resolveIcon(e,t){var s;let n;if(t?.spriteSheet)return this.svg=H`<svg part="svg">
        <use part="use" href="${e}"></use>
      </svg>`,this.svg;try{if(n=await fetch(e,{mode:"cors"}),!n.ok)return n.status===410?Wi:Rs}catch{return Rs}try{let u=document.createElement("div");u.innerHTML=await n.text();let i=u.firstElementChild;if(((s=i?.tagName)==null?void 0:s.toLowerCase())!=="svg")return Wi;io||(io=new DOMParser);let c=io.parseFromString(i.outerHTML,"text/html").body.querySelector("svg");return c?(c.part.add("svg"),document.adoptNode(c)):Wi}catch{return Wi}}connectedCallback(){super.connectedCallback(),la(this)}firstUpdated(){this.initialRender=!0,this.setIcon()}disconnectedCallback(){super.disconnectedCallback(),ca(this)}getIconSource(){let e=to(this.library);return this.name&&e?{url:e.resolver(this.name),fromLibrary:!0}:{url:this.src,fromLibrary:!1}}handleLabelChange(){typeof this.label=="string"&&this.label.length>0?(this.setAttribute("role","img"),this.setAttribute("aria-label",this.label),this.removeAttribute("aria-hidden")):(this.removeAttribute("role"),this.removeAttribute("aria-label"),this.setAttribute("aria-hidden","true"))}async setIcon(){var e;let{url:t,fromLibrary:s}=this.getIconSource(),n=s?to(this.library):void 0;if(!t){this.svg=null;return}let u=so.get(t);if(u||(u=this.resolveIcon(t,n),so.set(t,u)),!this.initialRender)return;let i=await u;if(i===Rs&&so.delete(t),t===this.getIconSource().url){if(ua(i)){if(this.svg=i,n){await this.updateComplete;let o=this.shadowRoot.querySelector("[part='svg']");typeof n.mutator=="function"&&o&&n.mutator(o)}return}switch(i){case Rs:case Wi:this.svg=null,this.emit("sl-error");break;default:this.svg=i.cloneNode(!0),(e=n?.mutator)==null||e.call(n,this.svg),this.emit("sl-load")}}}render(){return this.svg}};be.styles=[oe,ha];T([pe()],be.prototype,"svg",2);T([P({reflect:!0})],be.prototype,"name",2);T([P()],be.prototype,"src",2);T([P()],be.prototype,"label",2);T([P({reflect:!0})],be.prototype,"library",2);T([te("label")],be.prototype,"handleLabelChange",1);T([te(["name","src","library"])],be.prototype,"setIcon",1);var re=Zt(class extends vt{constructor(e){if(super(e),e.type!==Ke.ATTRIBUTE||e.name!=="class"||e.strings?.length>2)throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.")}render(e){return" "+Object.keys(e).filter(t=>e[t]).join(" ")+" "}update(e,[t]){if(this.st===void 0){this.st=new Set,e.strings!==void 0&&(this.nt=new Set(e.strings.join(" ").split(/\s/).filter(n=>n!=="")));for(let n in t)t[n]&&!this.nt?.has(n)&&this.st.add(n);return this.render(t)}let s=e.element.classList;for(let n of this.st)n in t||(s.remove(n),this.st.delete(n));for(let n in t){let u=!!t[n];u===this.st.has(n)||this.nt?.has(n)||(u?(s.add(n),this.st.add(n)):(s.remove(n),this.st.delete(n)))}return Te}});var We=class extends Q{constructor(){super(...arguments),this.localize=new fe(this),this.open=!1,this.disabled=!1}firstUpdated(){this.body.style.height=this.open?"auto":"0",this.open&&(this.details.open=!0),this.detailsObserver=new MutationObserver(e=>{for(let t of e)t.type==="attributes"&&t.attributeName==="open"&&(this.details.open?this.show():this.hide())}),this.detailsObserver.observe(this.details,{attributes:!0})}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this.detailsObserver)==null||e.disconnect()}handleSummaryClick(e){e.preventDefault(),this.disabled||(this.open?this.hide():this.show(),this.header.focus())}handleSummaryKeyDown(e){(e.key==="Enter"||e.key===" ")&&(e.preventDefault(),this.open?this.hide():this.show()),(e.key==="ArrowUp"||e.key==="ArrowLeft")&&(e.preventDefault(),this.hide()),(e.key==="ArrowDown"||e.key==="ArrowRight")&&(e.preventDefault(),this.show())}async handleOpenChange(){if(this.open){if(this.details.open=!0,this.emit("sl-show",{cancelable:!0}).defaultPrevented){this.open=!1,this.details.open=!1;return}await Ae(this.body);let{keyframes:t,options:s}=Se(this,"details.show",{dir:this.localize.dir()});await Ce(this.body,Xr(t,this.body.scrollHeight),s),this.body.style.height="auto",this.emit("sl-after-show")}else{if(this.emit("sl-hide",{cancelable:!0}).defaultPrevented){this.details.open=!0,this.open=!0;return}await Ae(this.body);let{keyframes:t,options:s}=Se(this,"details.hide",{dir:this.localize.dir()});await Ce(this.body,Xr(t,this.body.scrollHeight),s),this.body.style.height="auto",this.details.open=!1,this.emit("sl-after-hide")}}async show(){if(!(this.open||this.disabled))return this.open=!0,Oe(this,"sl-after-show")}async hide(){if(!(!this.open||this.disabled))return this.open=!1,Oe(this,"sl-after-hide")}render(){let e=this.localize.dir()==="rtl";return H`
      <details
        part="base"
        class=${re({details:!0,"details--open":this.open,"details--disabled":this.disabled,"details--rtl":e})}
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
    `}};We.styles=[oe,Wn];We.dependencies={"sl-icon":be};T([Z(".details")],We.prototype,"details",2);T([Z(".details__header")],We.prototype,"header",2);T([Z(".details__body")],We.prototype,"body",2);T([Z(".details__expand-icon-slot")],We.prototype,"expandIconSlot",2);T([P({type:Boolean,reflect:!0})],We.prototype,"open",2);T([P()],We.prototype,"summary",2);T([P({type:Boolean,reflect:!0})],We.prototype,"disabled",2);T([te("open",{waitUntilFirstUpdate:!0})],We.prototype,"handleOpenChange",1);we("details.show",{keyframes:[{height:"0",opacity:"0"},{height:"auto",opacity:"1"}],options:{duration:250,easing:"linear"}});we("details.hide",{keyframes:[{height:"auto",opacity:"1"},{height:"0",opacity:"0"}],options:{duration:250,easing:"linear"}});We.define("sl-details");var _a=J`
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
`;var ma=J`
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
`;var va=Symbol.for(""),Dh=e=>{if(e?.r===va)return e?._$litStatic$};var oi=(e,...t)=>({_$litStatic$:t.reduce((s,n,u)=>s+(i=>{if(i._$litStatic$!==void 0)return i._$litStatic$;throw Error(`Value passed to 'literal' function must be a 'literal' result: ${i}. Use 'unsafeStatic' to pass non-literal values, but
            take care to ensure page security.`)})(n)+e[u+1],e[0]),r:va}),ga=new Map,ro=e=>(t,...s)=>{let n=s.length,u,i,o=[],c=[],p,d=0,f=!1;for(;d<n;){for(p=t[d];d<n&&(i=s[d],(u=Dh(i))!==void 0);)p+=u+t[++d],f=!0;d!==n&&c.push(i),o.push(p),d++}if(d===n&&o.push(t[n]),f){let g=o.join("$$lit$$");(t=ga.get(g))===void 0&&(o.raw=o,ga.set(g,t=o)),s=c}return e(t,...s)},ni=ro(H),Dg=ro(Mo),Tg=ro($o);var se=e=>e??q;var ve=class extends Q{constructor(){super(...arguments),this.hasFocus=!1,this.label="",this.disabled=!1}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleClick(e){this.disabled&&(e.preventDefault(),e.stopPropagation())}click(){this.button.click()}focus(e){this.button.focus(e)}blur(){this.button.blur()}render(){let e=!!this.href,t=e?oi`a`:oi`button`;return ni`
      <${t}
        part="base"
        class=${re({"icon-button":!0,"icon-button--disabled":!e&&this.disabled,"icon-button--focused":this.hasFocus})}
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
    `}};ve.styles=[oe,ma];ve.dependencies={"sl-icon":be};T([Z(".icon-button")],ve.prototype,"button",2);T([pe()],ve.prototype,"hasFocus",2);T([P()],ve.prototype,"name",2);T([P()],ve.prototype,"library",2);T([P()],ve.prototype,"src",2);T([P()],ve.prototype,"href",2);T([P()],ve.prototype,"target",2);T([P()],ve.prototype,"download",2);T([P()],ve.prototype,"label",2);T([P({type:Boolean,reflect:!0})],ve.prototype,"disabled",2);var Et=class extends Q{constructor(){super(...arguments),this.localize=new fe(this),this.variant="neutral",this.size="medium",this.pill=!1,this.removable=!1}handleRemoveClick(){this.emit("sl-remove")}render(){return H`
      <span
        part="base"
        class=${re({tag:!0,"tag--primary":this.variant==="primary","tag--success":this.variant==="success","tag--neutral":this.variant==="neutral","tag--warning":this.variant==="warning","tag--danger":this.variant==="danger","tag--text":this.variant==="text","tag--small":this.size==="small","tag--medium":this.size==="medium","tag--large":this.size==="large","tag--pill":this.pill,"tag--removable":this.removable})}
      >
        <slot part="content" class="tag__content"></slot>

        ${this.removable?H`
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
    `}};Et.styles=[oe,_a];Et.dependencies={"sl-icon-button":ve};T([P({reflect:!0})],Et.prototype,"variant",2);T([P({reflect:!0})],Et.prototype,"size",2);T([P({type:Boolean,reflect:!0})],Et.prototype,"pill",2);T([P({type:Boolean})],Et.prototype,"removable",2);var ba=J`
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
`;function Th(e,t){return{top:Math.round(e.getBoundingClientRect().top-t.getBoundingClientRect().top),left:Math.round(e.getBoundingClientRect().left-t.getBoundingClientRect().left)}}var oo=new Set;function Rh(){let e=document.documentElement.clientWidth;return Math.abs(window.innerWidth-e)}function Oh(){let e=Number(getComputedStyle(document.body).paddingRight.replace(/px/,""));return isNaN(e)||!e?0:e}function no(e){if(oo.add(e),!document.documentElement.classList.contains("sl-scroll-lock")){let t=Rh()+Oh(),s=getComputedStyle(document.documentElement).scrollbarGutter;(!s||s==="auto")&&(s="stable"),t<2&&(s=""),document.documentElement.style.setProperty("--sl-scroll-lock-gutter",s),document.documentElement.classList.add("sl-scroll-lock"),document.documentElement.style.setProperty("--sl-scroll-lock-size",`${t}px`)}}function ao(e){oo.delete(e),oo.size===0&&(document.documentElement.classList.remove("sl-scroll-lock"),document.documentElement.style.removeProperty("--sl-scroll-lock-size"))}function Ui(e,t,s="vertical",n="smooth"){let u=Th(e,t),i=u.top+t.scrollTop,o=u.left+t.scrollLeft,c=t.scrollLeft,p=t.scrollLeft+t.offsetWidth,d=t.scrollTop,f=t.scrollTop+t.offsetHeight;(s==="horizontal"||s==="both")&&(o<c?t.scrollTo({left:o,behavior:n}):o+e.clientWidth>p&&t.scrollTo({left:o-t.offsetWidth+e.clientWidth,behavior:n})),(s==="vertical"||s==="both")&&(i<d?t.scrollTo({top:i,behavior:n}):i+e.clientHeight>f&&t.scrollTo({top:i-t.offsetHeight+e.clientHeight,behavior:n}))}var ai=J`
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
`;var ya=J`
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
`;var st=Math.min,Me=Math.max,Vi=Math.round,qi=Math.floor,Xe=e=>({x:e,y:e}),Mh={left:"right",right:"left",bottom:"top",top:"bottom"};function Ms(e,t,s){return Me(e,st(t,s))}function Wt(e,t){return typeof e=="function"?e(t):e}function ut(e){return e.split("-")[0]}function Ut(e){return e.split("-")[1]}function lo(e){return e==="x"?"y":"x"}function $s(e){return e==="y"?"height":"width"}function rt(e){let t=e[0];return t==="t"||t==="b"?"y":"x"}function Bs(e){return lo(rt(e))}function Ca(e,t,s){s===void 0&&(s=!1);let n=Ut(e),u=Bs(e),i=$s(u),o=u==="x"?n===(s?"end":"start")?"right":"left":n==="start"?"bottom":"top";return t.reference[i]>t.floating[i]&&(o=ji(o)),[o,ji(o)]}function xa(e){let t=ji(e);return[Os(e),t,Os(t)]}function Os(e){return e.includes("start")?e.replace("start","end"):e.replace("end","start")}var wa=["left","right"],Sa=["right","left"],$h=["top","bottom"],Bh=["bottom","top"];function Ph(e,t,s){switch(e){case"top":case"bottom":return s?t?Sa:wa:t?wa:Sa;case"left":case"right":return t?$h:Bh;default:return[]}}function ka(e,t,s,n){let u=Ut(e),i=Ph(ut(e),s==="start",n);return u&&(i=i.map(o=>o+"-"+u),t&&(i=i.concat(i.map(Os)))),i}function ji(e){let t=ut(e);return Mh[t]+e.slice(t.length)}function Ih(e){return{top:0,right:0,bottom:0,left:0,...e}}function co(e){return typeof e!="number"?Ih(e):{top:e,right:e,bottom:e,left:e}}function jt(e){let{x:t,y:s,width:n,height:u}=e;return{width:n,height:u,top:s,left:t,right:t+n,bottom:s+u,x:t,y:s}}function Ea(e,t,s){let{reference:n,floating:u}=e,i=rt(t),o=Bs(t),c=$s(o),p=ut(t),d=i==="y",f=n.x+n.width/2-u.width/2,g=n.y+n.height/2-u.height/2,w=n[c]/2-u[c]/2,b;switch(p){case"top":b={x:f,y:n.y-u.height};break;case"bottom":b={x:f,y:n.y+n.height};break;case"right":b={x:n.x+n.width,y:g};break;case"left":b={x:n.x-u.width,y:g};break;default:b={x:n.x,y:n.y}}switch(Ut(t)){case"start":b[o]-=w*(s&&d?-1:1);break;case"end":b[o]+=w*(s&&d?-1:1);break}return b}async function Aa(e,t){var s;t===void 0&&(t={});let{x:n,y:u,platform:i,rects:o,elements:c,strategy:p}=e,{boundary:d="clippingAncestors",rootBoundary:f="viewport",elementContext:g="floating",altBoundary:w=!1,padding:b=0}=Wt(t,e),r=co(b),a=c[w?g==="floating"?"reference":"floating":g],h=jt(await i.getClippingRect({element:(s=await(i.isElement==null?void 0:i.isElement(a)))==null||s?a:a.contextElement||await(i.getDocumentElement==null?void 0:i.getDocumentElement(c.floating)),boundary:d,rootBoundary:f,strategy:p})),m=g==="floating"?{x:n,y:u,width:o.floating.width,height:o.floating.height}:o.reference,v=await(i.getOffsetParent==null?void 0:i.getOffsetParent(c.floating)),y=await(i.isElement==null?void 0:i.isElement(v))?await(i.getScale==null?void 0:i.getScale(v))||{x:1,y:1}:{x:1,y:1},x=jt(i.convertOffsetParentRelativeRectToViewportRelativeRect?await i.convertOffsetParentRelativeRectToViewportRelativeRect({elements:c,rect:m,offsetParent:v,strategy:p}):m);return{top:(h.top-x.top+r.top)/y.y,bottom:(x.bottom-h.bottom+r.bottom)/y.y,left:(h.left-x.left+r.left)/y.x,right:(x.right-h.right+r.right)/y.x}}var Hh=50,La=async(e,t,s)=>{let{placement:n="bottom",strategy:u="absolute",middleware:i=[],platform:o}=s,c=o.detectOverflow?o:{...o,detectOverflow:Aa},p=await(o.isRTL==null?void 0:o.isRTL(t)),d=await o.getElementRects({reference:e,floating:t,strategy:u}),{x:f,y:g}=Ea(d,n,p),w=n,b=0,r={};for(let l=0;l<i.length;l++){let a=i[l];if(!a)continue;let{name:h,fn:m}=a,{x:v,y,data:x,reset:_}=await m({x:f,y:g,initialPlacement:n,placement:w,strategy:u,middlewareData:r,rects:d,platform:c,elements:{reference:e,floating:t}});f=v??f,g=y??g,r[h]={...r[h],...x},_&&b<Hh&&(b++,typeof _=="object"&&(_.placement&&(w=_.placement),_.rects&&(d=_.rects===!0?await o.getElementRects({reference:e,floating:t,strategy:u}):_.rects),{x:f,y:g}=Ea(d,w,p)),l=-1)}return{x:f,y:g,placement:w,strategy:u,middlewareData:r}},Da=e=>({name:"arrow",options:e,async fn(t){let{x:s,y:n,placement:u,rects:i,platform:o,elements:c,middlewareData:p}=t,{element:d,padding:f=0}=Wt(e,t)||{};if(d==null)return{};let g=co(f),w={x:s,y:n},b=Bs(u),r=$s(b),l=await o.getDimensions(d),a=b==="y",h=a?"top":"left",m=a?"bottom":"right",v=a?"clientHeight":"clientWidth",y=i.reference[r]+i.reference[b]-w[b]-i.floating[r],x=w[b]-i.reference[b],_=await(o.getOffsetParent==null?void 0:o.getOffsetParent(d)),S=_?_[v]:0;(!S||!await(o.isElement==null?void 0:o.isElement(_)))&&(S=c.floating[v]||i.floating[r]);let L=y/2-x/2,O=S/2-l[r]/2-1,D=st(g[h],O),M=st(g[m],O),z=D,B=S-l[r]-M,$=S/2-l[r]/2+L,I=Ms(z,$,B),C=!p.arrow&&Ut(u)!=null&&$!==I&&i.reference[r]/2-($<z?D:M)-l[r]/2<0,E=C?$<z?$-z:$-B:0;return{[b]:w[b]+E,data:{[b]:I,centerOffset:$-I-E,...C&&{alignmentOffset:E}},reset:C}}});var Ta=function(e){return e===void 0&&(e={}),{name:"flip",options:e,async fn(t){var s,n;let{placement:u,middlewareData:i,rects:o,initialPlacement:c,platform:p,elements:d}=t,{mainAxis:f=!0,crossAxis:g=!0,fallbackPlacements:w,fallbackStrategy:b="bestFit",fallbackAxisSideDirection:r="none",flipAlignment:l=!0,...a}=Wt(e,t);if((s=i.arrow)!=null&&s.alignmentOffset)return{};let h=ut(u),m=rt(c),v=ut(c)===c,y=await(p.isRTL==null?void 0:p.isRTL(d.floating)),x=w||(v||!l?[ji(c)]:xa(c)),_=r!=="none";!w&&_&&x.push(...ka(c,l,r,y));let S=[c,...x],L=await p.detectOverflow(t,a),O=[],D=((n=i.flip)==null?void 0:n.overflows)||[];if(f&&O.push(L[h]),g){let $=Ca(u,o,y);O.push(L[$[0]],L[$[1]])}if(D=[...D,{placement:u,overflows:O}],!O.every($=>$<=0)){var M,z;let $=(((M=i.flip)==null?void 0:M.index)||0)+1,I=S[$];if(I&&(!(g==="alignment"?m!==rt(I):!1)||D.every(A=>rt(A.placement)===m?A.overflows[0]>0:!0)))return{data:{index:$,overflows:D},reset:{placement:I}};let C=(z=D.filter(E=>E.overflows[0]<=0).sort((E,A)=>E.overflows[1]-A.overflows[1])[0])==null?void 0:z.placement;if(!C)switch(b){case"bestFit":{var B;let E=(B=D.filter(A=>{if(_){let R=rt(A.placement);return R===m||R==="y"}return!0}).map(A=>[A.placement,A.overflows.filter(R=>R>0).reduce((R,N)=>R+N,0)]).sort((A,R)=>A[1]-R[1])[0])==null?void 0:B[0];E&&(C=E);break}case"initialPlacement":C=c;break}if(u!==C)return{reset:{placement:C}}}return{}}}};var Fh=new Set(["left","top"]);async function zh(e,t){let{placement:s,platform:n,elements:u}=e,i=await(n.isRTL==null?void 0:n.isRTL(u.floating)),o=ut(s),c=Ut(s),p=rt(s)==="y",d=Fh.has(o)?-1:1,f=i&&p?-1:1,g=Wt(t,e),{mainAxis:w,crossAxis:b,alignmentAxis:r}=typeof g=="number"?{mainAxis:g,crossAxis:0,alignmentAxis:null}:{mainAxis:g.mainAxis||0,crossAxis:g.crossAxis||0,alignmentAxis:g.alignmentAxis};return c&&typeof r=="number"&&(b=c==="end"?r*-1:r),p?{x:b*f,y:w*d}:{x:w*d,y:b*f}}var Ra=function(e){return e===void 0&&(e=0),{name:"offset",options:e,async fn(t){var s,n;let{x:u,y:i,placement:o,middlewareData:c}=t,p=await zh(t,e);return o===((s=c.offset)==null?void 0:s.placement)&&(n=c.arrow)!=null&&n.alignmentOffset?{}:{x:u+p.x,y:i+p.y,data:{...p,placement:o}}}}},Oa=function(e){return e===void 0&&(e={}),{name:"shift",options:e,async fn(t){let{x:s,y:n,placement:u,platform:i}=t,{mainAxis:o=!0,crossAxis:c=!1,limiter:p={fn:h=>{let{x:m,y:v}=h;return{x:m,y:v}}},...d}=Wt(e,t),f={x:s,y:n},g=await i.detectOverflow(t,d),w=rt(ut(u)),b=lo(w),r=f[b],l=f[w];if(o){let h=b==="y"?"top":"left",m=b==="y"?"bottom":"right",v=r+g[h],y=r-g[m];r=Ms(v,r,y)}if(c){let h=w==="y"?"top":"left",m=w==="y"?"bottom":"right",v=l+g[h],y=l-g[m];l=Ms(v,l,y)}let a=p.fn({...t,[b]:r,[w]:l});return{...a,data:{x:a.x-s,y:a.y-n,enabled:{[b]:o,[w]:c}}}}}};var Ma=function(e){return e===void 0&&(e={}),{name:"size",options:e,async fn(t){var s,n;let{placement:u,rects:i,platform:o,elements:c}=t,{apply:p=()=>{},...d}=Wt(e,t),f=await o.detectOverflow(t,d),g=ut(u),w=Ut(u),b=rt(u)==="y",{width:r,height:l}=i.floating,a,h;g==="top"||g==="bottom"?(a=g,h=w===(await(o.isRTL==null?void 0:o.isRTL(c.floating))?"start":"end")?"left":"right"):(h=g,a=w==="end"?"top":"bottom");let m=l-f.top-f.bottom,v=r-f.left-f.right,y=st(l-f[a],m),x=st(r-f[h],v),_=!t.middlewareData.shift,S=y,L=x;if((s=t.middlewareData.shift)!=null&&s.enabled.x&&(L=v),(n=t.middlewareData.shift)!=null&&n.enabled.y&&(S=m),_&&!w){let D=Me(f.left,0),M=Me(f.right,0),z=Me(f.top,0),B=Me(f.bottom,0);b?L=r-2*(D!==0||M!==0?D+M:Me(f.left,f.right)):S=l-2*(z!==0||B!==0?z+B:Me(f.top,f.bottom))}await p({...t,availableWidth:L,availableHeight:S});let O=await o.getDimensions(c.floating);return r!==O.width||l!==O.height?{reset:{rects:!0}}:{}}}};function Ps(){return typeof window<"u"}function qt(e){return Ba(e)?(e.nodeName||"").toLowerCase():"#document"}function Pe(e){var t;return(e==null||(t=e.ownerDocument)==null?void 0:t.defaultView)||window}function Ye(e){var t;return(t=(Ba(e)?e.ownerDocument:e.document)||window.document)==null?void 0:t.documentElement}function Ba(e){return Ps()?e instanceof Node||e instanceof Pe(e).Node:!1}function Ue(e){return Ps()?e instanceof Element||e instanceof Pe(e).Element:!1}function ot(e){return Ps()?e instanceof HTMLElement||e instanceof Pe(e).HTMLElement:!1}function $a(e){return!Ps()||typeof ShadowRoot>"u"?!1:e instanceof ShadowRoot||e instanceof Pe(e).ShadowRoot}function ci(e){let{overflow:t,overflowX:s,overflowY:n,display:u}=je(e);return/auto|scroll|overlay|hidden|clip/.test(t+n+s)&&u!=="inline"&&u!=="contents"}function Pa(e){return/^(table|td|th)$/.test(qt(e))}function Ki(e){try{if(e.matches(":popover-open"))return!0}catch{}try{return e.matches(":modal")}catch{return!1}}var Nh=/transform|translate|scale|rotate|perspective|filter/,Wh=/paint|layout|strict|content/,Vt=e=>!!e&&e!=="none",ho;function hi(e){let t=Ue(e)?je(e):e;return Vt(t.transform)||Vt(t.translate)||Vt(t.scale)||Vt(t.rotate)||Vt(t.perspective)||!Is()&&(Vt(t.backdropFilter)||Vt(t.filter))||Nh.test(t.willChange||"")||Wh.test(t.contain||"")}function Ia(e){let t=pt(e);for(;ot(t)&&!Kt(t);){if(hi(t))return t;if(Ki(t))return null;t=pt(t)}return null}function Is(){return ho==null&&(ho=typeof CSS<"u"&&CSS.supports&&CSS.supports("-webkit-backdrop-filter","none")),ho}function Kt(e){return/^(html|body|#document)$/.test(qt(e))}function je(e){return Pe(e).getComputedStyle(e)}function Gi(e){return Ue(e)?{scrollLeft:e.scrollLeft,scrollTop:e.scrollTop}:{scrollLeft:e.scrollX,scrollTop:e.scrollY}}function pt(e){if(qt(e)==="html")return e;let t=e.assignedSlot||e.parentNode||$a(e)&&e.host||Ye(e);return $a(t)?t.host:t}function Ha(e){let t=pt(e);return Kt(t)?e.ownerDocument?e.ownerDocument.body:e.body:ot(t)&&ci(t)?t:Ha(t)}function li(e,t,s){var n;t===void 0&&(t=[]),s===void 0&&(s=!0);let u=Ha(e),i=u===((n=e.ownerDocument)==null?void 0:n.body),o=Pe(u);if(i){let c=Hs(o);return t.concat(o,o.visualViewport||[],ci(u)?u:[],c&&s?li(c):[])}else return t.concat(u,li(u,[],s))}function Hs(e){return e.parent&&Object.getPrototypeOf(e.parent)?e.frameElement:null}function Wa(e){let t=je(e),s=parseFloat(t.width)||0,n=parseFloat(t.height)||0,u=ot(e),i=u?e.offsetWidth:s,o=u?e.offsetHeight:n,c=Vi(s)!==i||Vi(n)!==o;return c&&(s=i,n=o),{width:s,height:n,$:c}}function po(e){return Ue(e)?e:e.contextElement}function di(e){let t=po(e);if(!ot(t))return Xe(1);let s=t.getBoundingClientRect(),{width:n,height:u,$:i}=Wa(t),o=(i?Vi(s.width):s.width)/n,c=(i?Vi(s.height):s.height)/u;return(!o||!Number.isFinite(o))&&(o=1),(!c||!Number.isFinite(c))&&(c=1),{x:o,y:c}}var Uh=Xe(0);function Ua(e){let t=Pe(e);return!Is()||!t.visualViewport?Uh:{x:t.visualViewport.offsetLeft,y:t.visualViewport.offsetTop}}function jh(e,t,s){return t===void 0&&(t=!1),!s||t&&s!==Pe(e)?!1:t}function Gt(e,t,s,n){t===void 0&&(t=!1),s===void 0&&(s=!1);let u=e.getBoundingClientRect(),i=po(e),o=Xe(1);t&&(n?Ue(n)&&(o=di(n)):o=di(e));let c=jh(i,s,n)?Ua(i):Xe(0),p=(u.left+c.x)/o.x,d=(u.top+c.y)/o.y,f=u.width/o.x,g=u.height/o.y;if(i){let w=Pe(i),b=n&&Ue(n)?Pe(n):n,r=w,l=Hs(r);for(;l&&n&&b!==r;){let a=di(l),h=l.getBoundingClientRect(),m=je(l),v=h.left+(l.clientLeft+parseFloat(m.paddingLeft))*a.x,y=h.top+(l.clientTop+parseFloat(m.paddingTop))*a.y;p*=a.x,d*=a.y,f*=a.x,g*=a.y,p+=v,d+=y,r=Pe(l),l=Hs(r)}}return jt({width:f,height:g,x:p,y:d})}function Fs(e,t){let s=Gi(e).scrollLeft;return t?t.left+s:Gt(Ye(e)).left+s}function ja(e,t){let s=e.getBoundingClientRect(),n=s.left+t.scrollLeft-Fs(e,s),u=s.top+t.scrollTop;return{x:n,y:u}}function Vh(e){let{elements:t,rect:s,offsetParent:n,strategy:u}=e,i=u==="fixed",o=Ye(n),c=t?Ki(t.floating):!1;if(n===o||c&&i)return s;let p={scrollLeft:0,scrollTop:0},d=Xe(1),f=Xe(0),g=ot(n);if((g||!g&&!i)&&((qt(n)!=="body"||ci(o))&&(p=Gi(n)),g)){let b=Gt(n);d=di(n),f.x=b.x+n.clientLeft,f.y=b.y+n.clientTop}let w=o&&!g&&!i?ja(o,p):Xe(0);return{width:s.width*d.x,height:s.height*d.y,x:s.x*d.x-p.scrollLeft*d.x+f.x+w.x,y:s.y*d.y-p.scrollTop*d.y+f.y+w.y}}function qh(e){return Array.from(e.getClientRects())}function Kh(e){let t=Ye(e),s=Gi(e),n=e.ownerDocument.body,u=Me(t.scrollWidth,t.clientWidth,n.scrollWidth,n.clientWidth),i=Me(t.scrollHeight,t.clientHeight,n.scrollHeight,n.clientHeight),o=-s.scrollLeft+Fs(e),c=-s.scrollTop;return je(n).direction==="rtl"&&(o+=Me(t.clientWidth,n.clientWidth)-u),{width:u,height:i,x:o,y:c}}var Fa=25;function Gh(e,t){let s=Pe(e),n=Ye(e),u=s.visualViewport,i=n.clientWidth,o=n.clientHeight,c=0,p=0;if(u){i=u.width,o=u.height;let f=Is();(!f||f&&t==="fixed")&&(c=u.offsetLeft,p=u.offsetTop)}let d=Fs(n);if(d<=0){let f=n.ownerDocument,g=f.body,w=getComputedStyle(g),b=f.compatMode==="CSS1Compat"&&parseFloat(w.marginLeft)+parseFloat(w.marginRight)||0,r=Math.abs(n.clientWidth-g.clientWidth-b);r<=Fa&&(i-=r)}else d<=Fa&&(i+=d);return{width:i,height:o,x:c,y:p}}function Xh(e,t){let s=Gt(e,!0,t==="fixed"),n=s.top+e.clientTop,u=s.left+e.clientLeft,i=ot(e)?di(e):Xe(1),o=e.clientWidth*i.x,c=e.clientHeight*i.y,p=u*i.x,d=n*i.y;return{width:o,height:c,x:p,y:d}}function za(e,t,s){let n;if(t==="viewport")n=Gh(e,s);else if(t==="document")n=Kh(Ye(e));else if(Ue(t))n=Xh(t,s);else{let u=Ua(e);n={x:t.x-u.x,y:t.y-u.y,width:t.width,height:t.height}}return jt(n)}function Va(e,t){let s=pt(e);return s===t||!Ue(s)||Kt(s)?!1:je(s).position==="fixed"||Va(s,t)}function Yh(e,t){let s=t.get(e);if(s)return s;let n=li(e,[],!1).filter(c=>Ue(c)&&qt(c)!=="body"),u=null,i=je(e).position==="fixed",o=i?pt(e):e;for(;Ue(o)&&!Kt(o);){let c=je(o),p=hi(o);!p&&c.position==="fixed"&&(u=null),(i?!p&&!u:!p&&c.position==="static"&&!!u&&(u.position==="absolute"||u.position==="fixed")||ci(o)&&!p&&Va(e,o))?n=n.filter(f=>f!==o):u=c,o=pt(o)}return t.set(e,n),n}function Jh(e){let{element:t,boundary:s,rootBoundary:n,strategy:u}=e,o=[...s==="clippingAncestors"?Ki(t)?[]:Yh(t,this._c):[].concat(s),n],c=za(t,o[0],u),p=c.top,d=c.right,f=c.bottom,g=c.left;for(let w=1;w<o.length;w++){let b=za(t,o[w],u);p=Me(b.top,p),d=st(b.right,d),f=st(b.bottom,f),g=Me(b.left,g)}return{width:d-g,height:f-p,x:g,y:p}}function Zh(e){let{width:t,height:s}=Wa(e);return{width:t,height:s}}function Qh(e,t,s){let n=ot(t),u=Ye(t),i=s==="fixed",o=Gt(e,!0,i,t),c={scrollLeft:0,scrollTop:0},p=Xe(0);function d(){p.x=Fs(u)}if(n||!n&&!i)if((qt(t)!=="body"||ci(u))&&(c=Gi(t)),n){let b=Gt(t,!0,i,t);p.x=b.x+t.clientLeft,p.y=b.y+t.clientTop}else u&&d();i&&!n&&u&&d();let f=u&&!n&&!i?ja(u,c):Xe(0),g=o.left+c.scrollLeft-p.x-f.x,w=o.top+c.scrollTop-p.y-f.y;return{x:g,y:w,width:o.width,height:o.height}}function uo(e){return je(e).position==="static"}function Na(e,t){if(!ot(e)||je(e).position==="fixed")return null;if(t)return t(e);let s=e.offsetParent;return Ye(e)===s&&(s=s.ownerDocument.body),s}function qa(e,t){let s=Pe(e);if(Ki(e))return s;if(!ot(e)){let u=pt(e);for(;u&&!Kt(u);){if(Ue(u)&&!uo(u))return u;u=pt(u)}return s}let n=Na(e,t);for(;n&&Pa(n)&&uo(n);)n=Na(n,t);return n&&Kt(n)&&uo(n)&&!hi(n)?s:n||Ia(e)||s}var ed=async function(e){let t=this.getOffsetParent||qa,s=this.getDimensions,n=await s(e.floating);return{reference:Qh(e.reference,await t(e.floating),e.strategy),floating:{x:0,y:0,width:n.width,height:n.height}}};function td(e){return je(e).direction==="rtl"}var Xi={convertOffsetParentRelativeRectToViewportRelativeRect:Vh,getDocumentElement:Ye,getClippingRect:Jh,getOffsetParent:qa,getElementRects:ed,getClientRects:qh,getDimensions:Zh,getScale:di,isElement:Ue,isRTL:td};function Ka(e,t){return e.x===t.x&&e.y===t.y&&e.width===t.width&&e.height===t.height}function id(e,t){let s=null,n,u=Ye(e);function i(){var c;clearTimeout(n),(c=s)==null||c.disconnect(),s=null}function o(c,p){c===void 0&&(c=!1),p===void 0&&(p=1),i();let d=e.getBoundingClientRect(),{left:f,top:g,width:w,height:b}=d;if(c||t(),!w||!b)return;let r=qi(g),l=qi(u.clientWidth-(f+w)),a=qi(u.clientHeight-(g+b)),h=qi(f),v={rootMargin:-r+"px "+-l+"px "+-a+"px "+-h+"px",threshold:Me(0,st(1,p))||1},y=!0;function x(_){let S=_[0].intersectionRatio;if(S!==p){if(!y)return o();S?o(!1,S):n=setTimeout(()=>{o(!1,1e-7)},1e3)}S===1&&!Ka(d,e.getBoundingClientRect())&&o(),y=!1}try{s=new IntersectionObserver(x,{...v,root:u.ownerDocument})}catch{s=new IntersectionObserver(x,v)}s.observe(e)}return o(!0),i}function Ga(e,t,s,n){n===void 0&&(n={});let{ancestorScroll:u=!0,ancestorResize:i=!0,elementResize:o=typeof ResizeObserver=="function",layoutShift:c=typeof IntersectionObserver=="function",animationFrame:p=!1}=n,d=po(e),f=u||i?[...d?li(d):[],...t?li(t):[]]:[];f.forEach(h=>{u&&h.addEventListener("scroll",s,{passive:!0}),i&&h.addEventListener("resize",s)});let g=d&&c?id(d,s):null,w=-1,b=null;o&&(b=new ResizeObserver(h=>{let[m]=h;m&&m.target===d&&b&&t&&(b.unobserve(t),cancelAnimationFrame(w),w=requestAnimationFrame(()=>{var v;(v=b)==null||v.observe(t)})),s()}),d&&!p&&b.observe(d),t&&b.observe(t));let r,l=p?Gt(e):null;p&&a();function a(){let h=Gt(e);l&&!Ka(l,h)&&s(),l=h,r=requestAnimationFrame(a)}return s(),()=>{var h;f.forEach(m=>{u&&m.removeEventListener("scroll",s),i&&m.removeEventListener("resize",s)}),g?.(),(h=b)==null||h.disconnect(),b=null,p&&cancelAnimationFrame(r)}}var Xa=Ra;var Ya=Oa,Ja=Ta,fo=Ma;var Za=Da;var Qa=(e,t,s)=>{let n=new Map,u={platform:Xi,...s},i={...u.platform,_c:n};return La(e,t,{...u,platform:i})};function el(e){return sd(e)}function _o(e){return e.assignedSlot?e.assignedSlot:e.parentNode instanceof ShadowRoot?e.parentNode.host:e.parentNode}function sd(e){for(let t=e;t;t=_o(t))if(t instanceof Element&&getComputedStyle(t).display==="none")return null;for(let t=_o(e);t;t=_o(t)){if(!(t instanceof Element))continue;let s=getComputedStyle(t);if(s.display!=="contents"&&(s.position!=="static"||hi(s)||t.tagName==="BODY"))return t}return null}function rd(e){return e!==null&&typeof e=="object"&&"getBoundingClientRect"in e&&("contextElement"in e?e.contextElement instanceof Element:!0)}var ue=class extends Q{constructor(){super(...arguments),this.localize=new fe(this),this.active=!1,this.placement="top",this.strategy="absolute",this.distance=0,this.skidding=0,this.arrow=!1,this.arrowPlacement="anchor",this.arrowPadding=10,this.flip=!1,this.flipFallbackPlacements="",this.flipFallbackStrategy="best-fit",this.flipPadding=0,this.shift=!1,this.shiftPadding=0,this.autoSizePadding=0,this.hoverBridge=!1,this.updateHoverBridge=()=>{if(this.hoverBridge&&this.anchorEl){let e=this.anchorEl.getBoundingClientRect(),t=this.popup.getBoundingClientRect(),s=this.placement.includes("top")||this.placement.includes("bottom"),n=0,u=0,i=0,o=0,c=0,p=0,d=0,f=0;s?e.top<t.top?(n=e.left,u=e.bottom,i=e.right,o=e.bottom,c=t.left,p=t.top,d=t.right,f=t.top):(n=t.left,u=t.bottom,i=t.right,o=t.bottom,c=e.left,p=e.top,d=e.right,f=e.top):e.left<t.left?(n=e.right,u=e.top,i=t.left,o=t.top,c=e.right,p=e.bottom,d=t.left,f=t.bottom):(n=t.right,u=t.top,i=e.left,o=e.top,c=t.right,p=t.bottom,d=e.left,f=e.bottom),this.style.setProperty("--hover-bridge-top-left-x",`${n}px`),this.style.setProperty("--hover-bridge-top-left-y",`${u}px`),this.style.setProperty("--hover-bridge-top-right-x",`${i}px`),this.style.setProperty("--hover-bridge-top-right-y",`${o}px`),this.style.setProperty("--hover-bridge-bottom-left-x",`${c}px`),this.style.setProperty("--hover-bridge-bottom-left-y",`${p}px`),this.style.setProperty("--hover-bridge-bottom-right-x",`${d}px`),this.style.setProperty("--hover-bridge-bottom-right-y",`${f}px`)}}}async connectedCallback(){super.connectedCallback(),await this.updateComplete,this.start()}disconnectedCallback(){super.disconnectedCallback(),this.stop()}async updated(e){super.updated(e),e.has("active")&&(this.active?this.start():this.stop()),e.has("anchor")&&this.handleAnchorChange(),this.active&&(await this.updateComplete,this.reposition())}async handleAnchorChange(){if(await this.stop(),this.anchor&&typeof this.anchor=="string"){let e=this.getRootNode();this.anchorEl=e.getElementById(this.anchor)}else this.anchor instanceof Element||rd(this.anchor)?this.anchorEl=this.anchor:this.anchorEl=this.querySelector('[slot="anchor"]');this.anchorEl instanceof HTMLSlotElement&&(this.anchorEl=this.anchorEl.assignedElements({flatten:!0})[0]),this.anchorEl&&this.active&&this.start()}start(){!this.anchorEl||!this.active||(this.cleanup=Ga(this.anchorEl,this.popup,()=>{this.reposition()}))}async stop(){return new Promise(e=>{this.cleanup?(this.cleanup(),this.cleanup=void 0,this.removeAttribute("data-current-placement"),this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height"),requestAnimationFrame(()=>e())):e()})}reposition(){if(!this.active||!this.anchorEl)return;let e=[Xa({mainAxis:this.distance,crossAxis:this.skidding})];this.sync?e.push(fo({apply:({rects:s})=>{let n=this.sync==="width"||this.sync==="both",u=this.sync==="height"||this.sync==="both";this.popup.style.width=n?`${s.reference.width}px`:"",this.popup.style.height=u?`${s.reference.height}px`:""}})):(this.popup.style.width="",this.popup.style.height=""),this.flip&&e.push(Ja({boundary:this.flipBoundary,fallbackPlacements:this.flipFallbackPlacements,fallbackStrategy:this.flipFallbackStrategy==="best-fit"?"bestFit":"initialPlacement",padding:this.flipPadding})),this.shift&&e.push(Ya({boundary:this.shiftBoundary,padding:this.shiftPadding})),this.autoSize?e.push(fo({boundary:this.autoSizeBoundary,padding:this.autoSizePadding,apply:({availableWidth:s,availableHeight:n})=>{this.autoSize==="vertical"||this.autoSize==="both"?this.style.setProperty("--auto-size-available-height",`${n}px`):this.style.removeProperty("--auto-size-available-height"),this.autoSize==="horizontal"||this.autoSize==="both"?this.style.setProperty("--auto-size-available-width",`${s}px`):this.style.removeProperty("--auto-size-available-width")}})):(this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height")),this.arrow&&e.push(Za({element:this.arrowEl,padding:this.arrowPadding}));let t=this.strategy==="absolute"?s=>Xi.getOffsetParent(s,el):Xi.getOffsetParent;Qa(this.anchorEl,this.popup,{placement:this.placement,middleware:e,strategy:this.strategy,platform:dt(Re({},Xi),{getOffsetParent:t})}).then(({x:s,y:n,middlewareData:u,placement:i})=>{let o=this.localize.dir()==="rtl",c={top:"bottom",right:"left",bottom:"top",left:"right"}[i.split("-")[0]];if(this.setAttribute("data-current-placement",i),Object.assign(this.popup.style,{left:`${s}px`,top:`${n}px`}),this.arrow){let p=u.arrow.x,d=u.arrow.y,f="",g="",w="",b="";if(this.arrowPlacement==="start"){let r=typeof p=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";f=typeof d=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"",g=o?r:"",b=o?"":r}else if(this.arrowPlacement==="end"){let r=typeof p=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";g=o?"":r,b=o?r:"",w=typeof d=="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:""}else this.arrowPlacement==="center"?(b=typeof p=="number"?"calc(50% - var(--arrow-size-diagonal))":"",f=typeof d=="number"?"calc(50% - var(--arrow-size-diagonal))":""):(b=typeof p=="number"?`${p}px`:"",f=typeof d=="number"?`${d}px`:"");Object.assign(this.arrowEl.style,{top:f,right:g,bottom:w,left:b,[c]:"calc(var(--arrow-size-diagonal) * -1)"})}}),requestAnimationFrame(()=>this.updateHoverBridge()),this.emit("sl-reposition")}render(){return H`
      <slot name="anchor" @slotchange=${this.handleAnchorChange}></slot>

      <span
        part="hover-bridge"
        class=${re({"popup-hover-bridge":!0,"popup-hover-bridge--visible":this.hoverBridge&&this.active})}
      ></span>

      <div
        part="popup"
        class=${re({popup:!0,"popup--active":this.active,"popup--fixed":this.strategy==="fixed","popup--has-arrow":this.arrow})}
      >
        <slot></slot>
        ${this.arrow?H`<div part="arrow" class="popup__arrow" role="presentation"></div>`:""}
      </div>
    `}};ue.styles=[oe,ya];T([Z(".popup")],ue.prototype,"popup",2);T([Z(".popup__arrow")],ue.prototype,"arrowEl",2);T([P()],ue.prototype,"anchor",2);T([P({type:Boolean,reflect:!0})],ue.prototype,"active",2);T([P({reflect:!0})],ue.prototype,"placement",2);T([P({reflect:!0})],ue.prototype,"strategy",2);T([P({type:Number})],ue.prototype,"distance",2);T([P({type:Number})],ue.prototype,"skidding",2);T([P({type:Boolean})],ue.prototype,"arrow",2);T([P({attribute:"arrow-placement"})],ue.prototype,"arrowPlacement",2);T([P({attribute:"arrow-padding",type:Number})],ue.prototype,"arrowPadding",2);T([P({type:Boolean})],ue.prototype,"flip",2);T([P({attribute:"flip-fallback-placements",converter:{fromAttribute:e=>e.split(" ").map(t=>t.trim()).filter(t=>t!==""),toAttribute:e=>e.join(" ")}})],ue.prototype,"flipFallbackPlacements",2);T([P({attribute:"flip-fallback-strategy"})],ue.prototype,"flipFallbackStrategy",2);T([P({type:Object})],ue.prototype,"flipBoundary",2);T([P({attribute:"flip-padding",type:Number})],ue.prototype,"flipPadding",2);T([P({type:Boolean})],ue.prototype,"shift",2);T([P({type:Object})],ue.prototype,"shiftBoundary",2);T([P({attribute:"shift-padding",type:Number})],ue.prototype,"shiftPadding",2);T([P({attribute:"auto-size"})],ue.prototype,"autoSize",2);T([P()],ue.prototype,"sync",2);T([P({type:Object})],ue.prototype,"autoSizeBoundary",2);T([P({attribute:"auto-size-padding",type:Number})],ue.prototype,"autoSizePadding",2);T([P({attribute:"hover-bridge",type:Boolean})],ue.prototype,"hoverBridge",2);var Yi=new WeakMap,Ji=new WeakMap,Zi=new WeakMap,mo=new WeakSet,zs=new WeakMap,At=class{constructor(e,t){this.handleFormData=s=>{let n=this.options.disabled(this.host),u=this.options.name(this.host),i=this.options.value(this.host),o=this.host.tagName.toLowerCase()==="sl-button";this.host.isConnected&&!n&&!o&&typeof u=="string"&&u.length>0&&typeof i<"u"&&(Array.isArray(i)?i.forEach(c=>{s.formData.append(u,c.toString())}):s.formData.append(u,i.toString()))},this.handleFormSubmit=s=>{var n;let u=this.options.disabled(this.host),i=this.options.reportValidity;this.form&&!this.form.noValidate&&((n=Yi.get(this.form))==null||n.forEach(o=>{this.setUserInteracted(o,!0)})),this.form&&!this.form.noValidate&&!u&&!i(this.host)&&(s.preventDefault(),s.stopImmediatePropagation())},this.handleFormReset=()=>{this.options.setValue(this.host,this.options.defaultValue(this.host)),this.setUserInteracted(this.host,!1),zs.set(this.host,[])},this.handleInteraction=s=>{let n=zs.get(this.host);n.includes(s.type)||n.push(s.type),n.length===this.options.assumeInteractionOn.length&&this.setUserInteracted(this.host,!0)},this.checkFormValidity=()=>{if(this.form&&!this.form.noValidate){let s=this.form.querySelectorAll("*");for(let n of s)if(typeof n.checkValidity=="function"&&!n.checkValidity())return!1}return!0},this.reportFormValidity=()=>{if(this.form&&!this.form.noValidate){let s=this.form.querySelectorAll("*");for(let n of s)if(typeof n.reportValidity=="function"&&!n.reportValidity())return!1}return!0},(this.host=e).addController(this),this.options=Re({form:s=>{let n=s.form;if(n){let i=s.getRootNode().querySelector(`#${n}`);if(i)return i}return s.closest("form")},name:s=>s.name,value:s=>s.value,defaultValue:s=>s.defaultValue,disabled:s=>{var n;return(n=s.disabled)!=null?n:!1},reportValidity:s=>typeof s.reportValidity=="function"?s.reportValidity():!0,checkValidity:s=>typeof s.checkValidity=="function"?s.checkValidity():!0,setValue:(s,n)=>s.value=n,assumeInteractionOn:["sl-input"]},t)}hostConnected(){let e=this.options.form(this.host);e&&this.attachForm(e),zs.set(this.host,[]),this.options.assumeInteractionOn.forEach(t=>{this.host.addEventListener(t,this.handleInteraction)})}hostDisconnected(){this.detachForm(),zs.delete(this.host),this.options.assumeInteractionOn.forEach(e=>{this.host.removeEventListener(e,this.handleInteraction)})}hostUpdated(){let e=this.options.form(this.host);e||this.detachForm(),e&&this.form!==e&&(this.detachForm(),this.attachForm(e)),this.host.hasUpdated&&this.setValidity(this.host.validity.valid)}attachForm(e){e?(this.form=e,Yi.has(this.form)?Yi.get(this.form).add(this.host):Yi.set(this.form,new Set([this.host])),this.form.addEventListener("formdata",this.handleFormData),this.form.addEventListener("submit",this.handleFormSubmit),this.form.addEventListener("reset",this.handleFormReset),Ji.has(this.form)||(Ji.set(this.form,this.form.reportValidity),this.form.reportValidity=()=>this.reportFormValidity()),Zi.has(this.form)||(Zi.set(this.form,this.form.checkValidity),this.form.checkValidity=()=>this.checkFormValidity())):this.form=void 0}detachForm(){if(!this.form)return;let e=Yi.get(this.form);e&&(e.delete(this.host),e.size<=0&&(this.form.removeEventListener("formdata",this.handleFormData),this.form.removeEventListener("submit",this.handleFormSubmit),this.form.removeEventListener("reset",this.handleFormReset),Ji.has(this.form)&&(this.form.reportValidity=Ji.get(this.form),Ji.delete(this.form)),Zi.has(this.form)&&(this.form.checkValidity=Zi.get(this.form),Zi.delete(this.form)),this.form=void 0))}setUserInteracted(e,t){t?mo.add(e):mo.delete(e),e.requestUpdate()}doAction(e,t){if(this.form){let s=document.createElement("button");s.type=e,s.style.position="absolute",s.style.width="0",s.style.height="0",s.style.clipPath="inset(50%)",s.style.overflow="hidden",s.style.whiteSpace="nowrap",t&&(s.name=t.name,s.value=t.value,["formaction","formenctype","formmethod","formnovalidate","formtarget"].forEach(n=>{t.hasAttribute(n)&&s.setAttribute(n,t.getAttribute(n))})),this.form.append(s),s.click(),s.remove()}}getForm(){var e;return(e=this.form)!=null?e:null}reset(e){this.doAction("reset",e)}submit(e){this.doAction("submit",e)}setValidity(e){let t=this.host,s=!!mo.has(t),n=!!t.required;t.toggleAttribute("data-required",n),t.toggleAttribute("data-optional",!n),t.toggleAttribute("data-invalid",!e),t.toggleAttribute("data-valid",e),t.toggleAttribute("data-user-invalid",!e&&s),t.toggleAttribute("data-user-valid",e&&s)}updateValidity(){let e=this.host;this.setValidity(e.validity.valid)}emitInvalidEvent(e){let t=new CustomEvent("sl-invalid",{bubbles:!1,composed:!1,cancelable:!0,detail:{}});e||t.preventDefault(),this.host.dispatchEvent(t)||e?.preventDefault()}},Ns=Object.freeze({badInput:!1,customError:!1,patternMismatch:!1,rangeOverflow:!1,rangeUnderflow:!1,stepMismatch:!1,tooLong:!1,tooShort:!1,typeMismatch:!1,valid:!0,valueMissing:!1}),Uv=Object.freeze(dt(Re({},Ns),{valid:!1,valueMissing:!0})),jv=Object.freeze(dt(Re({},Ns),{valid:!1,customError:!0}));var Ve=class{constructor(e,...t){this.slotNames=[],this.handleSlotChange=s=>{let n=s.target;(this.slotNames.includes("[default]")&&!n.name||n.name&&this.slotNames.includes(n.name))&&this.host.requestUpdate()},(this.host=e).addController(this),this.slotNames=t}hasDefaultSlot(){return[...this.host.childNodes].some(e=>{if(e.nodeType===e.TEXT_NODE&&e.textContent.trim()!=="")return!0;if(e.nodeType===e.ELEMENT_NODE){let t=e;if(t.tagName.toLowerCase()==="sl-visually-hidden")return!1;if(!t.hasAttribute("slot"))return!0}return!1})}hasNamedSlot(e){return this.host.querySelector(`:scope > [slot="${e}"]`)!==null}test(e){return e==="[default]"?this.hasDefaultSlot():this.hasNamedSlot(e)}hostConnected(){this.host.shadowRoot.addEventListener("slotchange",this.handleSlotChange)}hostDisconnected(){this.host.shadowRoot.removeEventListener("slotchange",this.handleSlotChange)}};var ae=class extends Q{constructor(){super(...arguments),this.formControlController=new At(this,{assumeInteractionOn:["sl-blur","sl-input"]}),this.hasSlotController=new Ve(this,"help-text","label"),this.localize=new fe(this),this.typeToSelectString="",this.hasFocus=!1,this.displayLabel="",this.selectedOptions=[],this.valueHasChanged=!1,this.name="",this._value="",this.defaultValue="",this.size="medium",this.placeholder="",this.multiple=!1,this.maxOptionsVisible=3,this.disabled=!1,this.clearable=!1,this.open=!1,this.hoist=!1,this.filled=!1,this.pill=!1,this.label="",this.placement="bottom",this.helpText="",this.form="",this.required=!1,this.getTag=e=>H`
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
    `,this.handleDocumentFocusIn=e=>{let t=e.composedPath();this&&!t.includes(this)&&this.hide()},this.handleDocumentKeyDown=e=>{let t=e.target,s=t.closest(".select__clear")!==null,n=t.closest("sl-icon-button")!==null;if(!(s||n)){if(e.key==="Escape"&&this.open&&!this.closeWatcher&&(e.preventDefault(),e.stopPropagation(),this.hide(),this.displayInput.focus({preventScroll:!0})),e.key==="Enter"||e.key===" "&&this.typeToSelectString===""){if(e.preventDefault(),e.stopImmediatePropagation(),!this.open){this.show();return}this.currentOption&&!this.currentOption.disabled&&(this.valueHasChanged=!0,this.multiple?this.toggleOptionSelection(this.currentOption):this.setSelectedOptions(this.currentOption),this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}),this.multiple||(this.hide(),this.displayInput.focus({preventScroll:!0})));return}if(["ArrowUp","ArrowDown","Home","End"].includes(e.key)){let u=this.getAllOptions(),i=u.indexOf(this.currentOption),o=Math.max(0,i);if(e.preventDefault(),!this.open&&(this.show(),this.currentOption))return;e.key==="ArrowDown"?(o=i+1,o>u.length-1&&(o=0)):e.key==="ArrowUp"?(o=i-1,o<0&&(o=u.length-1)):e.key==="Home"?o=0:e.key==="End"&&(o=u.length-1),this.setCurrentOption(u[o])}if(e.key&&e.key.length===1||e.key==="Backspace"){let u=this.getAllOptions();if(e.metaKey||e.ctrlKey||e.altKey)return;if(!this.open){if(e.key==="Backspace")return;this.show()}e.stopPropagation(),e.preventDefault(),clearTimeout(this.typeToSelectTimeout),this.typeToSelectTimeout=window.setTimeout(()=>this.typeToSelectString="",1e3),e.key==="Backspace"?this.typeToSelectString=this.typeToSelectString.slice(0,-1):this.typeToSelectString+=e.key.toLowerCase();for(let i of u)if(i.getTextLabel().toLowerCase().startsWith(this.typeToSelectString)){this.setCurrentOption(i);break}}}},this.handleDocumentMouseDown=e=>{let t=e.composedPath();this&&!t.includes(this)&&this.hide()}}get value(){return this._value}set value(e){this.multiple?e=Array.isArray(e)?e:e.split(" "):e=Array.isArray(e)?e.join(" "):e,this._value!==e&&(this.valueHasChanged=!0,this._value=e)}get validity(){return this.valueInput.validity}get validationMessage(){return this.valueInput.validationMessage}connectedCallback(){super.connectedCallback(),setTimeout(()=>{this.handleDefaultSlotChange()}),this.open=!1}addOpenListeners(){var e;document.addEventListener("focusin",this.handleDocumentFocusIn),document.addEventListener("keydown",this.handleDocumentKeyDown),document.addEventListener("mousedown",this.handleDocumentMouseDown),this.getRootNode()!==document&&this.getRootNode().addEventListener("focusin",this.handleDocumentFocusIn),"CloseWatcher"in window&&((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>{this.open&&(this.hide(),this.displayInput.focus({preventScroll:!0}))})}removeOpenListeners(){var e;document.removeEventListener("focusin",this.handleDocumentFocusIn),document.removeEventListener("keydown",this.handleDocumentKeyDown),document.removeEventListener("mousedown",this.handleDocumentMouseDown),this.getRootNode()!==document&&this.getRootNode().removeEventListener("focusin",this.handleDocumentFocusIn),(e=this.closeWatcher)==null||e.destroy()}handleFocus(){this.hasFocus=!0,this.displayInput.setSelectionRange(0,0),this.emit("sl-focus")}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleLabelClick(){this.displayInput.focus()}handleComboboxMouseDown(e){let s=e.composedPath().some(n=>n instanceof Element&&n.tagName.toLowerCase()==="sl-icon-button");this.disabled||s||(e.preventDefault(),this.displayInput.focus({preventScroll:!0}),this.open=!this.open)}handleComboboxKeyDown(e){e.key!=="Tab"&&(e.stopPropagation(),this.handleDocumentKeyDown(e))}handleClearClick(e){e.stopPropagation(),this.valueHasChanged=!0,this.value!==""&&(this.setSelectedOptions([]),this.displayInput.focus({preventScroll:!0}),this.updateComplete.then(()=>{this.emit("sl-clear"),this.emit("sl-input"),this.emit("sl-change")}))}handleClearMouseDown(e){e.stopPropagation(),e.preventDefault()}handleOptionClick(e){let s=e.target.closest("sl-option"),n=this.value;s&&!s.disabled&&(this.valueHasChanged=!0,this.multiple?this.toggleOptionSelection(s):this.setSelectedOptions(s),this.updateComplete.then(()=>this.displayInput.focus({preventScroll:!0})),this.value!==n&&this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}),this.multiple||(this.hide(),this.displayInput.focus({preventScroll:!0})))}handleDefaultSlotChange(){customElements.get("sl-option")||customElements.whenDefined("sl-option").then(()=>this.handleDefaultSlotChange());let e=this.getAllOptions(),t=this.valueHasChanged?this.value:this.defaultValue,s=Array.isArray(t)?t:[t],n=[];e.forEach(u=>n.push(u.value)),this.setSelectedOptions(e.filter(u=>s.includes(u.value)))}handleTagRemove(e,t){e.stopPropagation(),this.valueHasChanged=!0,this.disabled||(this.toggleOptionSelection(t,!1),this.updateComplete.then(()=>{this.emit("sl-input"),this.emit("sl-change")}))}getAllOptions(){return[...this.querySelectorAll("sl-option")]}getFirstOption(){return this.querySelector("sl-option")}setCurrentOption(e){this.getAllOptions().forEach(s=>{s.current=!1,s.tabIndex=-1}),e&&(this.currentOption=e,e.current=!0,e.tabIndex=0,e.focus())}setSelectedOptions(e){let t=this.getAllOptions(),s=Array.isArray(e)?e:[e];t.forEach(n=>n.selected=!1),s.length&&s.forEach(n=>n.selected=!0),this.selectionChanged()}toggleOptionSelection(e,t){t===!0||t===!1?e.selected=t:e.selected=!e.selected,this.selectionChanged()}selectionChanged(){var e,t,s;let n=this.getAllOptions();this.selectedOptions=n.filter(i=>i.selected);let u=this.valueHasChanged;if(this.multiple)this.value=this.selectedOptions.map(i=>i.value),this.placeholder&&this.value.length===0?this.displayLabel="":this.displayLabel=this.localize.term("numOptionsSelected",this.selectedOptions.length);else{let i=this.selectedOptions[0];this.value=(e=i?.value)!=null?e:"",this.displayLabel=(s=(t=i?.getTextLabel)==null?void 0:t.call(i))!=null?s:""}this.valueHasChanged=u,this.updateComplete.then(()=>{this.formControlController.updateValidity()})}get tags(){return this.selectedOptions.map((e,t)=>{if(t<this.maxOptionsVisible||this.maxOptionsVisible<=0){let s=this.getTag(e,t);return H`<div @sl-remove=${n=>this.handleTagRemove(n,e)}>
          ${typeof s=="string"?X(s):s}
        </div>`}else if(t===this.maxOptionsVisible)return H`<sl-tag size=${this.size}>+${this.selectedOptions.length-t}</sl-tag>`;return H``})}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleDisabledChange(){this.disabled&&(this.open=!1,this.handleOpenChange())}attributeChangedCallback(e,t,s){if(super.attributeChangedCallback(e,t,s),e==="value"){let n=this.valueHasChanged;this.value=this.defaultValue,this.valueHasChanged=n}}handleValueChange(){if(!this.valueHasChanged){let s=this.valueHasChanged;this.value=this.defaultValue,this.valueHasChanged=s}let e=this.getAllOptions(),t=Array.isArray(this.value)?this.value:[this.value];this.setSelectedOptions(e.filter(s=>t.includes(s.value)))}async handleOpenChange(){if(this.open&&!this.disabled){this.setCurrentOption(this.selectedOptions[0]||this.getFirstOption()),this.emit("sl-show"),this.addOpenListeners(),await Ae(this),this.listbox.hidden=!1,this.popup.active=!0,requestAnimationFrame(()=>{this.setCurrentOption(this.currentOption)});let{keyframes:e,options:t}=Se(this,"select.show",{dir:this.localize.dir()});await Ce(this.popup.popup,e,t),this.currentOption&&Ui(this.currentOption,this.listbox,"vertical","auto"),this.emit("sl-after-show")}else{this.emit("sl-hide"),this.removeOpenListeners(),await Ae(this);let{keyframes:e,options:t}=Se(this,"select.hide",{dir:this.localize.dir()});await Ce(this.popup.popup,e,t),this.listbox.hidden=!0,this.popup.active=!1,this.emit("sl-after-hide")}}async show(){if(this.open||this.disabled){this.open=!1;return}return this.open=!0,Oe(this,"sl-after-show")}async hide(){if(!this.open||this.disabled){this.open=!1;return}return this.open=!1,Oe(this,"sl-after-hide")}checkValidity(){return this.valueInput.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.valueInput.reportValidity()}setCustomValidity(e){this.valueInput.setCustomValidity(e),this.formControlController.updateValidity()}focus(e){this.displayInput.focus(e)}blur(){this.displayInput.blur()}render(){let e=this.hasSlotController.test("label"),t=this.hasSlotController.test("help-text"),s=this.label?!0:!!e,n=this.helpText?!0:!!t,u=this.clearable&&!this.disabled&&this.value.length>0,i=this.placeholder&&this.value&&this.value.length<=0;return H`
      <div
        part="form-control"
        class=${re({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-label":s,"form-control--has-help-text":n})}
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
            class=${re({select:!0,"select--standard":!0,"select--filled":this.filled,"select--pill":this.pill,"select--open":this.open,"select--disabled":this.disabled,"select--multiple":this.multiple,"select--focused":this.hasFocus,"select--placeholder-visible":i,"select--top":this.placement==="top","select--bottom":this.placement==="bottom","select--small":this.size==="small","select--medium":this.size==="medium","select--large":this.size==="large"})}
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

              ${this.multiple?H`<div part="tags" class="select__tags">${this.tags}</div>`:""}

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

              ${u?H`
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
    `}};ae.styles=[oe,ai,ba];ae.dependencies={"sl-icon":be,"sl-popup":ue,"sl-tag":Et};T([Z(".select")],ae.prototype,"popup",2);T([Z(".select__combobox")],ae.prototype,"combobox",2);T([Z(".select__display-input")],ae.prototype,"displayInput",2);T([Z(".select__value-input")],ae.prototype,"valueInput",2);T([Z(".select__listbox")],ae.prototype,"listbox",2);T([pe()],ae.prototype,"hasFocus",2);T([pe()],ae.prototype,"displayLabel",2);T([pe()],ae.prototype,"currentOption",2);T([pe()],ae.prototype,"selectedOptions",2);T([pe()],ae.prototype,"valueHasChanged",2);T([P()],ae.prototype,"name",2);T([pe()],ae.prototype,"value",1);T([P({attribute:"value"})],ae.prototype,"defaultValue",2);T([P({reflect:!0})],ae.prototype,"size",2);T([P()],ae.prototype,"placeholder",2);T([P({type:Boolean,reflect:!0})],ae.prototype,"multiple",2);T([P({attribute:"max-options-visible",type:Number})],ae.prototype,"maxOptionsVisible",2);T([P({type:Boolean,reflect:!0})],ae.prototype,"disabled",2);T([P({type:Boolean})],ae.prototype,"clearable",2);T([P({type:Boolean,reflect:!0})],ae.prototype,"open",2);T([P({type:Boolean})],ae.prototype,"hoist",2);T([P({type:Boolean,reflect:!0})],ae.prototype,"filled",2);T([P({type:Boolean,reflect:!0})],ae.prototype,"pill",2);T([P()],ae.prototype,"label",2);T([P({reflect:!0})],ae.prototype,"placement",2);T([P({attribute:"help-text"})],ae.prototype,"helpText",2);T([P({reflect:!0})],ae.prototype,"form",2);T([P({type:Boolean,reflect:!0})],ae.prototype,"required",2);T([P()],ae.prototype,"getTag",2);T([te("disabled",{waitUntilFirstUpdate:!0})],ae.prototype,"handleDisabledChange",1);T([te(["defaultValue","value"],{waitUntilFirstUpdate:!0})],ae.prototype,"handleValueChange",1);T([te("open",{waitUntilFirstUpdate:!0})],ae.prototype,"handleOpenChange",1);we("select.show",{keyframes:[{opacity:0,scale:.9},{opacity:1,scale:1}],options:{duration:100,easing:"ease"}});we("select.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.9}],options:{duration:100,easing:"ease"}});ae.define("sl-select");var tl=J`
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
`;var He=class extends Q{constructor(){super(...arguments),this.localize=new fe(this),this.isInitialized=!1,this.current=!1,this.selected=!1,this.hasHover=!1,this.value="",this.disabled=!1}connectedCallback(){super.connectedCallback(),this.setAttribute("role","option"),this.setAttribute("aria-selected","false")}handleDefaultSlotChange(){this.isInitialized?customElements.whenDefined("sl-select").then(()=>{let e=this.closest("sl-select");e&&e.handleDefaultSlotChange()}):this.isInitialized=!0}handleMouseEnter(){this.hasHover=!0}handleMouseLeave(){this.hasHover=!1}handleDisabledChange(){this.setAttribute("aria-disabled",this.disabled?"true":"false")}handleSelectedChange(){this.setAttribute("aria-selected",this.selected?"true":"false")}handleValueChange(){typeof this.value!="string"&&(this.value=String(this.value)),this.value.includes(" ")&&(console.error("Option values cannot include a space. All spaces have been replaced with underscores.",this),this.value=this.value.replace(/ /g,"_"))}getTextLabel(){let e=this.childNodes,t="";return[...e].forEach(s=>{s.nodeType===Node.ELEMENT_NODE&&(s.hasAttribute("slot")||(t+=s.textContent)),s.nodeType===Node.TEXT_NODE&&(t+=s.textContent)}),t.trim()}render(){return H`
      <div
        part="base"
        class=${re({option:!0,"option--current":this.current,"option--disabled":this.disabled,"option--selected":this.selected,"option--hover":this.hasHover})}
        @mouseenter=${this.handleMouseEnter}
        @mouseleave=${this.handleMouseLeave}
      >
        <sl-icon part="checked-icon" class="option__check" name="check" library="system" aria-hidden="true"></sl-icon>
        <slot part="prefix" name="prefix" class="option__prefix"></slot>
        <slot part="label" class="option__label" @slotchange=${this.handleDefaultSlotChange}></slot>
        <slot part="suffix" name="suffix" class="option__suffix"></slot>
      </div>
    `}};He.styles=[oe,tl];He.dependencies={"sl-icon":be};T([Z(".option__label")],He.prototype,"defaultSlot",2);T([pe()],He.prototype,"current",2);T([pe()],He.prototype,"selected",2);T([pe()],He.prototype,"hasHover",2);T([P({reflect:!0})],He.prototype,"value",2);T([P({type:Boolean,reflect:!0})],He.prototype,"disabled",2);T([te("disabled")],He.prototype,"handleDisabledChange",1);T([te("selected")],He.prototype,"handleSelectedChange",1);T([te("value")],He.prototype,"handleValueChange",1);He.define("sl-option");var il=J`
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
`;var Ws=(e="value")=>(t,s)=>{let n=t.constructor,u=n.prototype.attributeChangedCallback;n.prototype.attributeChangedCallback=function(i,o,c){var p;let d=n.getPropertyOptions(e),f=typeof d.attribute=="string"?d.attribute:e;if(i===f){let g=d.converter||xt,b=(typeof g=="function"?g:(p=g?.fromAttribute)!=null?p:xt.fromAttribute)(c,d.type);this[e]!==b&&(this[s]=b)}u.call(this,i,o,c)}};var Us=Zt(class extends vt{constructor(e){if(super(e),e.type!==Ke.PROPERTY&&e.type!==Ke.ATTRIBUTE&&e.type!==Ke.BOOLEAN_ATTRIBUTE)throw Error("The `live` directive is not allowed on child or event bindings");if(!pa(e))throw Error("`live` bindings can only contain a single expression")}render(e){return e}update(e,[t]){if(t===Te||t===q)return t;let s=e.element,n=e.name;if(e.type===Ke.PROPERTY){if(t===s[n])return Te}else if(e.type===Ke.BOOLEAN_ATTRIBUTE){if(!!t===s.hasAttribute(n))return Te}else if(e.type===Ke.ATTRIBUTE&&s.getAttribute(n)===t+"")return Te;return fa(e),t}});var ie=class extends Q{constructor(){super(...arguments),this.formControlController=new At(this,{assumeInteractionOn:["sl-blur","sl-input"]}),this.hasSlotController=new Ve(this,"help-text","label"),this.localize=new fe(this),this.hasFocus=!1,this.title="",this.__numberInput=Object.assign(document.createElement("input"),{type:"number"}),this.__dateInput=Object.assign(document.createElement("input"),{type:"date"}),this.type="text",this.name="",this.value="",this.defaultValue="",this.size="medium",this.filled=!1,this.pill=!1,this.label="",this.helpText="",this.clearable=!1,this.disabled=!1,this.placeholder="",this.readonly=!1,this.passwordToggle=!1,this.passwordVisible=!1,this.noSpinButtons=!1,this.form="",this.required=!1,this.spellcheck=!0}get valueAsDate(){var e;return this.__dateInput.type=this.type,this.__dateInput.value=this.value,((e=this.input)==null?void 0:e.valueAsDate)||this.__dateInput.valueAsDate}set valueAsDate(e){this.__dateInput.type=this.type,this.__dateInput.valueAsDate=e,this.value=this.__dateInput.value}get valueAsNumber(){var e;return this.__numberInput.value=this.value,((e=this.input)==null?void 0:e.valueAsNumber)||this.__numberInput.valueAsNumber}set valueAsNumber(e){this.__numberInput.valueAsNumber=e,this.value=this.__numberInput.value}get validity(){return this.input.validity}get validationMessage(){return this.input.validationMessage}firstUpdated(){this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleChange(){this.value=this.input.value,this.emit("sl-change")}handleClearClick(e){e.preventDefault(),this.value!==""&&(this.value="",this.emit("sl-clear"),this.emit("sl-input"),this.emit("sl-change")),this.input.focus()}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleInput(){this.value=this.input.value,this.formControlController.updateValidity(),this.emit("sl-input")}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleKeyDown(e){let t=e.metaKey||e.ctrlKey||e.shiftKey||e.altKey;e.key==="Enter"&&!t&&setTimeout(()=>{!e.defaultPrevented&&!e.isComposing&&this.formControlController.submit()})}handlePasswordToggle(){this.passwordVisible=!this.passwordVisible}handleDisabledChange(){this.formControlController.setValidity(this.disabled)}handleStepChange(){this.input.step=String(this.step),this.formControlController.updateValidity()}async handleValueChange(){await this.updateComplete,this.formControlController.updateValidity()}focus(e){this.input.focus(e)}blur(){this.input.blur()}select(){this.input.select()}setSelectionRange(e,t,s="none"){this.input.setSelectionRange(e,t,s)}setRangeText(e,t,s,n="preserve"){let u=t??this.input.selectionStart,i=s??this.input.selectionEnd;this.input.setRangeText(e,u,i,n),this.value!==this.input.value&&(this.value=this.input.value)}showPicker(){"showPicker"in HTMLInputElement.prototype&&this.input.showPicker()}stepUp(){this.input.stepUp(),this.value!==this.input.value&&(this.value=this.input.value)}stepDown(){this.input.stepDown(),this.value!==this.input.value&&(this.value=this.input.value)}checkValidity(){return this.input.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.input.reportValidity()}setCustomValidity(e){this.input.setCustomValidity(e),this.formControlController.updateValidity()}render(){let e=this.hasSlotController.test("label"),t=this.hasSlotController.test("help-text"),s=this.label?!0:!!e,n=this.helpText?!0:!!t,i=this.clearable&&!this.disabled&&!this.readonly&&(typeof this.value=="number"||this.value.length>0);return H`
      <div
        part="form-control"
        class=${re({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-label":s,"form-control--has-help-text":n})}
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
            class=${re({input:!0,"input--small":this.size==="small","input--medium":this.size==="medium","input--large":this.size==="large","input--pill":this.pill,"input--standard":!this.filled,"input--filled":this.filled,"input--disabled":this.disabled,"input--focused":this.hasFocus,"input--empty":!this.value,"input--no-spin-buttons":this.noSpinButtons})}
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
              .value=${Us(this.value)}
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

            ${i?H`
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
            ${this.passwordToggle&&!this.disabled?H`
                  <button
                    part="password-toggle-button"
                    class="input__password-toggle"
                    type="button"
                    aria-label=${this.localize.term(this.passwordVisible?"hidePassword":"showPassword")}
                    @click=${this.handlePasswordToggle}
                    tabindex="-1"
                  >
                    ${this.passwordVisible?H`
                          <slot name="show-password-icon">
                            <sl-icon name="eye-slash" library="system"></sl-icon>
                          </slot>
                        `:H`
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
    `}};ie.styles=[oe,ai,il];ie.dependencies={"sl-icon":be};T([Z(".input__control")],ie.prototype,"input",2);T([pe()],ie.prototype,"hasFocus",2);T([P()],ie.prototype,"title",2);T([P({reflect:!0})],ie.prototype,"type",2);T([P()],ie.prototype,"name",2);T([P()],ie.prototype,"value",2);T([Ws()],ie.prototype,"defaultValue",2);T([P({reflect:!0})],ie.prototype,"size",2);T([P({type:Boolean,reflect:!0})],ie.prototype,"filled",2);T([P({type:Boolean,reflect:!0})],ie.prototype,"pill",2);T([P()],ie.prototype,"label",2);T([P({attribute:"help-text"})],ie.prototype,"helpText",2);T([P({type:Boolean})],ie.prototype,"clearable",2);T([P({type:Boolean,reflect:!0})],ie.prototype,"disabled",2);T([P()],ie.prototype,"placeholder",2);T([P({type:Boolean,reflect:!0})],ie.prototype,"readonly",2);T([P({attribute:"password-toggle",type:Boolean})],ie.prototype,"passwordToggle",2);T([P({attribute:"password-visible",type:Boolean})],ie.prototype,"passwordVisible",2);T([P({attribute:"no-spin-buttons",type:Boolean})],ie.prototype,"noSpinButtons",2);T([P({reflect:!0})],ie.prototype,"form",2);T([P({type:Boolean,reflect:!0})],ie.prototype,"required",2);T([P()],ie.prototype,"pattern",2);T([P({type:Number})],ie.prototype,"minlength",2);T([P({type:Number})],ie.prototype,"maxlength",2);T([P()],ie.prototype,"min",2);T([P()],ie.prototype,"max",2);T([P()],ie.prototype,"step",2);T([P()],ie.prototype,"autocapitalize",2);T([P()],ie.prototype,"autocorrect",2);T([P()],ie.prototype,"autocomplete",2);T([P({type:Boolean})],ie.prototype,"autofocus",2);T([P()],ie.prototype,"enterkeyhint",2);T([P({type:Boolean,converter:{fromAttribute:e=>!(!e||e==="false"),toAttribute:e=>e?"true":"false"}})],ie.prototype,"spellcheck",2);T([P()],ie.prototype,"inputmode",2);T([te("disabled",{waitUntilFirstUpdate:!0})],ie.prototype,"handleDisabledChange",1);T([te("step",{waitUntilFirstUpdate:!0})],ie.prototype,"handleStepChange",1);T([te("value",{waitUntilFirstUpdate:!0})],ie.prototype,"handleValueChange",1);ie.define("sl-input");var sl=J`
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
`;var go=class extends Q{constructor(){super(...arguments),this.localize=new fe(this)}render(){return H`
      <svg part="base" class="spinner" role="progressbar" aria-label=${this.localize.term("loading")}>
        <circle class="spinner__track"></circle>
        <circle class="spinner__indicator"></circle>
      </svg>
    `}};go.styles=[oe,sl];var rl=J`
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
`;var ce=class extends Q{constructor(){super(...arguments),this.formControlController=new At(this,{assumeInteractionOn:["click"]}),this.hasSlotController=new Ve(this,"[default]","prefix","suffix"),this.localize=new fe(this),this.hasFocus=!1,this.invalid=!1,this.title="",this.variant="default",this.size="medium",this.caret=!1,this.disabled=!1,this.loading=!1,this.outline=!1,this.pill=!1,this.circle=!1,this.type="button",this.name="",this.value="",this.href="",this.rel="noreferrer noopener"}get validity(){return this.isButton()?this.button.validity:Ns}get validationMessage(){return this.isButton()?this.button.validationMessage:""}firstUpdated(){this.isButton()&&this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleClick(){this.type==="submit"&&this.formControlController.submit(this),this.type==="reset"&&this.formControlController.reset(this)}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}isButton(){return!this.href}isLink(){return!!this.href}handleDisabledChange(){this.isButton()&&this.formControlController.setValidity(this.disabled)}click(){this.button.click()}focus(e){this.button.focus(e)}blur(){this.button.blur()}checkValidity(){return this.isButton()?this.button.checkValidity():!0}getForm(){return this.formControlController.getForm()}reportValidity(){return this.isButton()?this.button.reportValidity():!0}setCustomValidity(e){this.isButton()&&(this.button.setCustomValidity(e),this.formControlController.updateValidity())}render(){let e=this.isLink(),t=e?oi`a`:oi`button`;return ni`
      <${t}
        part="base"
        class=${re({button:!0,"button--default":this.variant==="default","button--primary":this.variant==="primary","button--success":this.variant==="success","button--neutral":this.variant==="neutral","button--warning":this.variant==="warning","button--danger":this.variant==="danger","button--text":this.variant==="text","button--small":this.size==="small","button--medium":this.size==="medium","button--large":this.size==="large","button--caret":this.caret,"button--circle":this.circle,"button--disabled":this.disabled,"button--focused":this.hasFocus,"button--loading":this.loading,"button--standard":!this.outline,"button--outline":this.outline,"button--pill":this.pill,"button--rtl":this.localize.dir()==="rtl","button--has-label":this.hasSlotController.test("[default]"),"button--has-prefix":this.hasSlotController.test("prefix"),"button--has-suffix":this.hasSlotController.test("suffix")})}
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
        ${this.caret?ni` <sl-icon part="caret" class="button__caret" library="system" name="caret"></sl-icon> `:""}
        ${this.loading?ni`<sl-spinner part="spinner"></sl-spinner>`:""}
      </${t}>
    `}};ce.styles=[oe,rl];ce.dependencies={"sl-icon":be,"sl-spinner":go};T([Z(".button")],ce.prototype,"button",2);T([pe()],ce.prototype,"hasFocus",2);T([pe()],ce.prototype,"invalid",2);T([P()],ce.prototype,"title",2);T([P({reflect:!0})],ce.prototype,"variant",2);T([P({reflect:!0})],ce.prototype,"size",2);T([P({type:Boolean,reflect:!0})],ce.prototype,"caret",2);T([P({type:Boolean,reflect:!0})],ce.prototype,"disabled",2);T([P({type:Boolean,reflect:!0})],ce.prototype,"loading",2);T([P({type:Boolean,reflect:!0})],ce.prototype,"outline",2);T([P({type:Boolean,reflect:!0})],ce.prototype,"pill",2);T([P({type:Boolean,reflect:!0})],ce.prototype,"circle",2);T([P()],ce.prototype,"type",2);T([P()],ce.prototype,"name",2);T([P()],ce.prototype,"value",2);T([P()],ce.prototype,"href",2);T([P()],ce.prototype,"target",2);T([P()],ce.prototype,"rel",2);T([P()],ce.prototype,"download",2);T([P()],ce.prototype,"form",2);T([P({attribute:"formaction"})],ce.prototype,"formAction",2);T([P({attribute:"formenctype"})],ce.prototype,"formEnctype",2);T([P({attribute:"formmethod"})],ce.prototype,"formMethod",2);T([P({attribute:"formnovalidate",type:Boolean})],ce.prototype,"formNoValidate",2);T([P({attribute:"formtarget"})],ce.prototype,"formTarget",2);T([te("disabled",{waitUntilFirstUpdate:!0})],ce.prototype,"handleDisabledChange",1);ce.define("sl-button");var ol=J`
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
`;var ui=class extends Q{constructor(){super(...arguments),this.variant="primary",this.pill=!1,this.pulse=!1}render(){return H`
      <span
        part="base"
        class=${re({badge:!0,"badge--primary":this.variant==="primary","badge--success":this.variant==="success","badge--neutral":this.variant==="neutral","badge--warning":this.variant==="warning","badge--danger":this.variant==="danger","badge--pill":this.pill,"badge--pulse":this.pulse})}
        role="status"
      >
        <slot></slot>
      </span>
    `}};ui.styles=[oe,ol];T([P({reflect:!0})],ui.prototype,"variant",2);T([P({type:Boolean,reflect:!0})],ui.prototype,"pill",2);T([P({type:Boolean,reflect:!0})],ui.prototype,"pulse",2);ui.define("sl-badge");var nl=J`
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
`;var xe=class extends Q{constructor(){super(),this.localize=new fe(this),this.content="",this.placement="top",this.disabled=!1,this.distance=8,this.open=!1,this.skidding=0,this.trigger="hover focus",this.hoist=!1,this.handleBlur=()=>{this.hasTrigger("focus")&&this.hide()},this.handleClick=()=>{this.hasTrigger("click")&&(this.open?this.hide():this.show())},this.handleFocus=()=>{this.hasTrigger("focus")&&this.show()},this.handleDocumentKeyDown=e=>{e.key==="Escape"&&(e.stopPropagation(),this.hide())},this.handleMouseOver=()=>{if(this.hasTrigger("hover")){let e=Gr(getComputedStyle(this).getPropertyValue("--show-delay"));clearTimeout(this.hoverTimeout),this.hoverTimeout=window.setTimeout(()=>this.show(),e)}},this.handleMouseOut=()=>{if(this.hasTrigger("hover")){let e=Gr(getComputedStyle(this).getPropertyValue("--hide-delay"));clearTimeout(this.hoverTimeout),this.hoverTimeout=window.setTimeout(()=>this.hide(),e)}},this.addEventListener("blur",this.handleBlur,!0),this.addEventListener("focus",this.handleFocus,!0),this.addEventListener("click",this.handleClick),this.addEventListener("mouseover",this.handleMouseOver),this.addEventListener("mouseout",this.handleMouseOut)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this.closeWatcher)==null||e.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown)}firstUpdated(){this.body.hidden=!this.open,this.open&&(this.popup.active=!0,this.popup.reposition())}hasTrigger(e){return this.trigger.split(" ").includes(e)}async handleOpenChange(){var e,t;if(this.open){if(this.disabled)return;this.emit("sl-show"),"CloseWatcher"in window?((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>{this.hide()}):document.addEventListener("keydown",this.handleDocumentKeyDown),await Ae(this.body),this.body.hidden=!1,this.popup.active=!0;let{keyframes:s,options:n}=Se(this,"tooltip.show",{dir:this.localize.dir()});await Ce(this.popup.popup,s,n),this.popup.reposition(),this.emit("sl-after-show")}else{this.emit("sl-hide"),(t=this.closeWatcher)==null||t.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown),await Ae(this.body);let{keyframes:s,options:n}=Se(this,"tooltip.hide",{dir:this.localize.dir()});await Ce(this.popup.popup,s,n),this.popup.active=!1,this.body.hidden=!0,this.emit("sl-after-hide")}}async handleOptionsChange(){this.hasUpdated&&(await this.updateComplete,this.popup.reposition())}handleDisabledChange(){this.disabled&&this.open&&this.hide()}async show(){if(!this.open)return this.open=!0,Oe(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,Oe(this,"sl-after-hide")}render(){return H`
      <sl-popup
        part="base"
        exportparts="
          popup:base__popup,
          arrow:base__arrow
        "
        class=${re({tooltip:!0,"tooltip--open":this.open})}
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
    `}};xe.styles=[oe,nl];xe.dependencies={"sl-popup":ue};T([Z("slot:not([name])")],xe.prototype,"defaultSlot",2);T([Z(".tooltip__body")],xe.prototype,"body",2);T([Z("sl-popup")],xe.prototype,"popup",2);T([P()],xe.prototype,"content",2);T([P()],xe.prototype,"placement",2);T([P({type:Boolean,reflect:!0})],xe.prototype,"disabled",2);T([P({type:Number})],xe.prototype,"distance",2);T([P({type:Boolean,reflect:!0})],xe.prototype,"open",2);T([P({type:Number})],xe.prototype,"skidding",2);T([P()],xe.prototype,"trigger",2);T([P({type:Boolean})],xe.prototype,"hoist",2);T([te("open",{waitUntilFirstUpdate:!0})],xe.prototype,"handleOpenChange",1);T([te(["content","distance","hoist","placement","skidding"])],xe.prototype,"handleOptionsChange",1);T([te("disabled")],xe.prototype,"handleDisabledChange",1);we("tooltip.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:150,easing:"ease"}});we("tooltip.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:150,easing:"ease"}});xe.define("sl-tooltip");function*js(e=document.activeElement){e!=null&&(yield e,"shadowRoot"in e&&e.shadowRoot&&e.shadowRoot.mode!=="closed"&&(yield*Yn(js(e.shadowRoot.activeElement))))}function ll(){return[...js()].pop()}var al=new WeakMap;function cl(e){let t=al.get(e);return t||(t=window.getComputedStyle(e,null),al.set(e,t)),t}function od(e){if(typeof e.checkVisibility=="function")return e.checkVisibility({checkOpacity:!1,checkVisibilityCSS:!0});let t=cl(e);return t.visibility!=="hidden"&&t.display!=="none"}function nd(e){let t=cl(e),{overflowY:s,overflowX:n}=t;return s==="scroll"||n==="scroll"?!0:s!=="auto"||n!=="auto"?!1:e.scrollHeight>e.clientHeight&&s==="auto"||e.scrollWidth>e.clientWidth&&n==="auto"}function ad(e){let t=e.tagName.toLowerCase(),s=Number(e.getAttribute("tabindex"));if(e.hasAttribute("tabindex")&&(isNaN(s)||s<=-1)||e.hasAttribute("disabled")||e.closest("[inert]"))return!1;if(t==="input"&&e.getAttribute("type")==="radio"){let i=e.getRootNode(),o=`input[type='radio'][name="${e.getAttribute("name")}"]`,c=i.querySelector(`${o}:checked`);return c?c===e:i.querySelector(o)===e}return od(e)?(t==="audio"||t==="video")&&e.hasAttribute("controls")||e.hasAttribute("tabindex")||e.hasAttribute("contenteditable")&&e.getAttribute("contenteditable")!=="false"||["button","input","select","textarea","a","audio","video","summary","iframe"].includes(t)?!0:nd(e):!1}function ld(e,t){var s;return((s=e.getRootNode({composed:!0}))==null?void 0:s.host)!==t}function vo(e){let t=new WeakMap,s=[];function n(u){if(u instanceof Element){if(u.hasAttribute("inert")||u.closest("[inert]")||t.has(u))return;t.set(u,!0),!s.includes(u)&&ad(u)&&s.push(u),u instanceof HTMLSlotElement&&ld(u,e)&&u.assignedElements({flatten:!0}).forEach(i=>{n(i)}),u.shadowRoot!==null&&u.shadowRoot.mode==="open"&&n(u.shadowRoot)}for(let i of u.children)n(i)}return n(e),s.sort((u,i)=>{let o=Number(u.getAttribute("tabindex"))||0;return(Number(i.getAttribute("tabindex"))||0)-o})}var Qi=[],hl=class{constructor(e){this.tabDirection="forward",this.handleFocusIn=()=>{this.isActive()&&this.checkFocus()},this.handleKeyDown=t=>{var s;if(t.key!=="Tab"||this.isExternalActivated||!this.isActive())return;let n=ll();if(this.previousFocus=n,this.previousFocus&&this.possiblyHasTabbableChildren(this.previousFocus))return;t.shiftKey?this.tabDirection="backward":this.tabDirection="forward";let u=vo(this.element),i=u.findIndex(c=>c===n);this.previousFocus=this.currentFocus;let o=this.tabDirection==="forward"?1:-1;for(;;){i+o>=u.length?i=0:i+o<0?i=u.length-1:i+=o,this.previousFocus=this.currentFocus;let c=u[i];if(this.tabDirection==="backward"&&this.previousFocus&&this.possiblyHasTabbableChildren(this.previousFocus)||c&&this.possiblyHasTabbableChildren(c))return;t.preventDefault(),this.currentFocus=c,(s=this.currentFocus)==null||s.focus({preventScroll:!1});let p=[...js()];if(p.includes(this.currentFocus)||!p.includes(this.previousFocus))break}setTimeout(()=>this.checkFocus())},this.handleKeyUp=()=>{this.tabDirection="forward"},this.element=e,this.elementsWithTabbableControls=["iframe"]}activate(){Qi.push(this.element),document.addEventListener("focusin",this.handleFocusIn),document.addEventListener("keydown",this.handleKeyDown),document.addEventListener("keyup",this.handleKeyUp)}deactivate(){Qi=Qi.filter(e=>e!==this.element),this.currentFocus=null,document.removeEventListener("focusin",this.handleFocusIn),document.removeEventListener("keydown",this.handleKeyDown),document.removeEventListener("keyup",this.handleKeyUp)}isActive(){return Qi[Qi.length-1]===this.element}activateExternal(){this.isExternalActivated=!0}deactivateExternal(){this.isExternalActivated=!1}checkFocus(){if(this.isActive()&&!this.isExternalActivated){let e=vo(this.element);if(!this.element.matches(":focus-within")){let t=e[0],s=e[e.length-1],n=this.tabDirection==="forward"?t:s;typeof n?.focus=="function"&&(this.currentFocus=n,n.focus({preventScroll:!1}))}}}possiblyHasTabbableChildren(e){return this.elementsWithTabbableControls.includes(e.tagName.toLowerCase())||e.hasAttribute("controls")}};var dl=J`
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
`;var Vs=e=>{var t;let{activeElement:s}=document;s&&e.contains(s)&&((t=document.activeElement)==null||t.blur())};var Je=class extends Q{constructor(){super(...arguments),this.hasSlotController=new Ve(this,"footer"),this.localize=new fe(this),this.modal=new hl(this),this.open=!1,this.label="",this.noHeader=!1,this.handleDocumentKeyDown=e=>{e.key==="Escape"&&this.modal.isActive()&&this.open&&(e.stopPropagation(),this.requestClose("keyboard"))}}firstUpdated(){this.dialog.hidden=!this.open,this.open&&(this.addOpenListeners(),this.modal.activate(),no(this))}disconnectedCallback(){super.disconnectedCallback(),this.modal.deactivate(),ao(this),this.removeOpenListeners()}requestClose(e){if(this.emit("sl-request-close",{cancelable:!0,detail:{source:e}}).defaultPrevented){let s=Se(this,"dialog.denyClose",{dir:this.localize.dir()});Ce(this.panel,s.keyframes,s.options);return}this.hide()}addOpenListeners(){var e;"CloseWatcher"in window?((e=this.closeWatcher)==null||e.destroy(),this.closeWatcher=new CloseWatcher,this.closeWatcher.onclose=()=>this.requestClose("keyboard")):document.addEventListener("keydown",this.handleDocumentKeyDown)}removeOpenListeners(){var e;(e=this.closeWatcher)==null||e.destroy(),document.removeEventListener("keydown",this.handleDocumentKeyDown)}async handleOpenChange(){if(this.open){this.emit("sl-show"),this.addOpenListeners(),this.originalTrigger=document.activeElement,this.modal.activate(),no(this);let e=this.querySelector("[autofocus]");e&&e.removeAttribute("autofocus"),await Promise.all([Ae(this.dialog),Ae(this.overlay)]),this.dialog.hidden=!1,requestAnimationFrame(()=>{this.emit("sl-initial-focus",{cancelable:!0}).defaultPrevented||(e?e.focus({preventScroll:!0}):this.panel.focus({preventScroll:!0})),e&&e.setAttribute("autofocus","")});let t=Se(this,"dialog.show",{dir:this.localize.dir()}),s=Se(this,"dialog.overlay.show",{dir:this.localize.dir()});await Promise.all([Ce(this.panel,t.keyframes,t.options),Ce(this.overlay,s.keyframes,s.options)]),this.emit("sl-after-show")}else{Vs(this),this.emit("sl-hide"),this.removeOpenListeners(),this.modal.deactivate(),await Promise.all([Ae(this.dialog),Ae(this.overlay)]);let e=Se(this,"dialog.hide",{dir:this.localize.dir()}),t=Se(this,"dialog.overlay.hide",{dir:this.localize.dir()});await Promise.all([Ce(this.overlay,t.keyframes,t.options).then(()=>{this.overlay.hidden=!0}),Ce(this.panel,e.keyframes,e.options).then(()=>{this.panel.hidden=!0})]),this.dialog.hidden=!0,this.overlay.hidden=!1,this.panel.hidden=!1,ao(this);let s=this.originalTrigger;typeof s?.focus=="function"&&setTimeout(()=>s.focus()),this.emit("sl-after-hide")}}async show(){if(!this.open)return this.open=!0,Oe(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,Oe(this,"sl-after-hide")}render(){return H`
      <div
        part="base"
        class=${re({dialog:!0,"dialog--open":this.open,"dialog--has-footer":this.hasSlotController.test("footer")})}
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
          ${this.noHeader?"":H`
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
    `}};Je.styles=[oe,dl];Je.dependencies={"sl-icon-button":ve};T([Z(".dialog")],Je.prototype,"dialog",2);T([Z(".dialog__panel")],Je.prototype,"panel",2);T([Z(".dialog__overlay")],Je.prototype,"overlay",2);T([P({type:Boolean,reflect:!0})],Je.prototype,"open",2);T([P({reflect:!0})],Je.prototype,"label",2);T([P({attribute:"no-header",type:Boolean,reflect:!0})],Je.prototype,"noHeader",2);T([te("open",{waitUntilFirstUpdate:!0})],Je.prototype,"handleOpenChange",1);we("dialog.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:250,easing:"ease"}});we("dialog.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:250,easing:"ease"}});we("dialog.denyClose",{keyframes:[{scale:1},{scale:1.02},{scale:1}],options:{duration:250}});we("dialog.overlay.show",{keyframes:[{opacity:0},{opacity:1}],options:{duration:250}});we("dialog.overlay.hide",{keyframes:[{opacity:1},{opacity:0}],options:{duration:250}});Je.define("sl-dialog");var ul=J`
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
`;var pl=J`
  :host {
    display: contents;
  }
`;var es=class extends Q{constructor(){super(...arguments),this.observedElements=[],this.disabled=!1}connectedCallback(){super.connectedCallback(),this.resizeObserver=new ResizeObserver(e=>{this.emit("sl-resize",{detail:{entries:e}})}),this.disabled||this.startObserver()}disconnectedCallback(){super.disconnectedCallback(),this.stopObserver()}handleSlotChange(){this.disabled||this.startObserver()}startObserver(){let e=this.shadowRoot.querySelector("slot");if(e!==null){let t=e.assignedElements({flatten:!0});this.observedElements.forEach(s=>this.resizeObserver.unobserve(s)),this.observedElements=[],t.forEach(s=>{this.resizeObserver.observe(s),this.observedElements.push(s)})}}stopObserver(){this.resizeObserver.disconnect()}handleDisabledChange(){this.disabled?this.stopObserver():this.startObserver()}render(){return H` <slot @slotchange=${this.handleSlotChange}></slot> `}};es.styles=[oe,pl];T([P({type:Boolean,reflect:!0})],es.prototype,"disabled",2);T([te("disabled",{waitUntilFirstUpdate:!0})],es.prototype,"handleDisabledChange",1);var ke=class extends Q{constructor(){super(...arguments),this.tabs=[],this.focusableTabs=[],this.panels=[],this.localize=new fe(this),this.hasScrollControls=!1,this.shouldHideScrollStartButton=!1,this.shouldHideScrollEndButton=!1,this.placement="top",this.activation="auto",this.noScrollControls=!1,this.fixedScrollControls=!1,this.scrollOffset=1}connectedCallback(){let e=Promise.all([customElements.whenDefined("sl-tab"),customElements.whenDefined("sl-tab-panel")]);super.connectedCallback(),this.resizeObserver=new ResizeObserver(()=>{this.repositionIndicator(),this.updateScrollControls()}),this.mutationObserver=new MutationObserver(t=>{let s=t.filter(({target:n})=>{if(n===this)return!0;if(n.closest("sl-tab-group")!==this)return!1;let u=n.tagName.toLowerCase();return u==="sl-tab"||u==="sl-tab-panel"});if(s.length!==0){if(s.some(n=>!["aria-labelledby","aria-controls"].includes(n.attributeName))&&setTimeout(()=>this.setAriaLabels()),s.some(n=>n.attributeName==="disabled"))this.syncTabsAndPanels();else if(s.some(n=>n.attributeName==="active")){let u=s.filter(i=>i.attributeName==="active"&&i.target.tagName.toLowerCase()==="sl-tab").map(i=>i.target).find(i=>i.active);u&&this.setActiveTab(u)}}}),this.updateComplete.then(()=>{this.syncTabsAndPanels(),this.mutationObserver.observe(this,{attributes:!0,attributeFilter:["active","disabled","name","panel"],childList:!0,subtree:!0}),this.resizeObserver.observe(this.nav),e.then(()=>{new IntersectionObserver((s,n)=>{var u;s[0].intersectionRatio>0&&(this.setAriaLabels(),this.setActiveTab((u=this.getActiveTab())!=null?u:this.tabs[0],{emitEvents:!1}),n.unobserve(s[0].target))}).observe(this.tabGroup)})})}disconnectedCallback(){var e,t;super.disconnectedCallback(),(e=this.mutationObserver)==null||e.disconnect(),this.nav&&((t=this.resizeObserver)==null||t.unobserve(this.nav))}getAllTabs(){return this.shadowRoot.querySelector('slot[name="nav"]').assignedElements()}getAllPanels(){return[...this.body.assignedElements()].filter(e=>e.tagName.toLowerCase()==="sl-tab-panel")}getActiveTab(){return this.tabs.find(e=>e.active)}handleClick(e){let s=e.target.closest("sl-tab");s?.closest("sl-tab-group")===this&&s!==null&&this.setActiveTab(s,{scrollBehavior:"smooth"})}handleKeyDown(e){let s=e.target.closest("sl-tab");if(s?.closest("sl-tab-group")===this&&(["Enter"," "].includes(e.key)&&s!==null&&(this.setActiveTab(s,{scrollBehavior:"smooth"}),e.preventDefault()),["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key))){let u=this.tabs.find(c=>c.matches(":focus")),i=this.localize.dir()==="rtl",o=null;if(u?.tagName.toLowerCase()==="sl-tab"){if(e.key==="Home")o=this.focusableTabs[0];else if(e.key==="End")o=this.focusableTabs[this.focusableTabs.length-1];else if(["top","bottom"].includes(this.placement)&&e.key===(i?"ArrowRight":"ArrowLeft")||["start","end"].includes(this.placement)&&e.key==="ArrowUp"){let c=this.tabs.findIndex(p=>p===u);o=this.findNextFocusableTab(c,"backward")}else if(["top","bottom"].includes(this.placement)&&e.key===(i?"ArrowLeft":"ArrowRight")||["start","end"].includes(this.placement)&&e.key==="ArrowDown"){let c=this.tabs.findIndex(p=>p===u);o=this.findNextFocusableTab(c,"forward")}if(!o)return;o.tabIndex=0,o.focus({preventScroll:!0}),this.activation==="auto"?this.setActiveTab(o,{scrollBehavior:"smooth"}):this.tabs.forEach(c=>{c.tabIndex=c===o?0:-1}),["top","bottom"].includes(this.placement)&&Ui(o,this.nav,"horizontal"),e.preventDefault()}}}handleScrollToStart(){this.nav.scroll({left:this.localize.dir()==="rtl"?this.nav.scrollLeft+this.nav.clientWidth:this.nav.scrollLeft-this.nav.clientWidth,behavior:"smooth"})}handleScrollToEnd(){this.nav.scroll({left:this.localize.dir()==="rtl"?this.nav.scrollLeft-this.nav.clientWidth:this.nav.scrollLeft+this.nav.clientWidth,behavior:"smooth"})}setActiveTab(e,t){if(t=Re({emitEvents:!0,scrollBehavior:"auto"},t),e!==this.activeTab&&!e.disabled){let s=this.activeTab;this.activeTab=e,this.tabs.forEach(n=>{n.active=n===this.activeTab,n.tabIndex=n===this.activeTab?0:-1}),this.panels.forEach(n=>{var u;return n.active=n.name===((u=this.activeTab)==null?void 0:u.panel)}),this.syncIndicator(),["top","bottom"].includes(this.placement)&&Ui(this.activeTab,this.nav,"horizontal",t.scrollBehavior),t.emitEvents&&(s&&this.emit("sl-tab-hide",{detail:{name:s.panel}}),this.emit("sl-tab-show",{detail:{name:this.activeTab.panel}}))}}setAriaLabels(){this.tabs.forEach(e=>{let t=this.panels.find(s=>s.name===e.panel);t&&(e.setAttribute("aria-controls",t.getAttribute("id")),t.setAttribute("aria-labelledby",e.getAttribute("id")))})}repositionIndicator(){let e=this.getActiveTab();if(!e)return;let t=e.clientWidth,s=e.clientHeight,n=this.localize.dir()==="rtl",u=this.getAllTabs(),o=u.slice(0,u.indexOf(e)).reduce((c,p)=>({left:c.left+p.clientWidth,top:c.top+p.clientHeight}),{left:0,top:0});switch(this.placement){case"top":case"bottom":this.indicator.style.width=`${t}px`,this.indicator.style.height="auto",this.indicator.style.translate=n?`${-1*o.left}px`:`${o.left}px`;break;case"start":case"end":this.indicator.style.width="auto",this.indicator.style.height=`${s}px`,this.indicator.style.translate=`0 ${o.top}px`;break}}syncTabsAndPanels(){this.tabs=this.getAllTabs(),this.focusableTabs=this.tabs.filter(e=>!e.disabled),this.panels=this.getAllPanels(),this.syncIndicator(),this.updateComplete.then(()=>this.updateScrollControls())}findNextFocusableTab(e,t){let s=null,n=t==="forward"?1:-1,u=e+n;for(;e<this.tabs.length;){if(s=this.tabs[u]||null,s===null){t==="forward"?s=this.focusableTabs[0]:s=this.focusableTabs[this.focusableTabs.length-1];break}if(!s.disabled)break;u+=n}return s}updateScrollButtons(){this.hasScrollControls&&!this.fixedScrollControls&&(this.shouldHideScrollStartButton=this.scrollFromStart()<=this.scrollOffset,this.shouldHideScrollEndButton=this.isScrolledToEnd())}isScrolledToEnd(){return this.scrollFromStart()+this.nav.clientWidth>=this.nav.scrollWidth-this.scrollOffset}scrollFromStart(){return this.localize.dir()==="rtl"?-this.nav.scrollLeft:this.nav.scrollLeft}updateScrollControls(){this.noScrollControls?this.hasScrollControls=!1:this.hasScrollControls=["top","bottom"].includes(this.placement)&&this.nav.scrollWidth>this.nav.clientWidth+1,this.updateScrollButtons()}syncIndicator(){this.getActiveTab()?(this.indicator.style.display="block",this.repositionIndicator()):this.indicator.style.display="none"}show(e){let t=this.tabs.find(s=>s.panel===e);t&&this.setActiveTab(t,{scrollBehavior:"smooth"})}render(){let e=this.localize.dir()==="rtl";return H`
      <div
        part="base"
        class=${re({"tab-group":!0,"tab-group--top":this.placement==="top","tab-group--bottom":this.placement==="bottom","tab-group--start":this.placement==="start","tab-group--end":this.placement==="end","tab-group--rtl":this.localize.dir()==="rtl","tab-group--has-scroll-controls":this.hasScrollControls})}
        @click=${this.handleClick}
        @keydown=${this.handleKeyDown}
      >
        <div class="tab-group__nav-container" part="nav">
          ${this.hasScrollControls?H`
                <sl-icon-button
                  part="scroll-button scroll-button--start"
                  exportparts="base:scroll-button__base"
                  class=${re({"tab-group__scroll-button":!0,"tab-group__scroll-button--start":!0,"tab-group__scroll-button--start--hidden":this.shouldHideScrollStartButton})}
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

          ${this.hasScrollControls?H`
                <sl-icon-button
                  part="scroll-button scroll-button--end"
                  exportparts="base:scroll-button__base"
                  class=${re({"tab-group__scroll-button":!0,"tab-group__scroll-button--end":!0,"tab-group__scroll-button--end--hidden":this.shouldHideScrollEndButton})}
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
    `}};ke.styles=[oe,ul];ke.dependencies={"sl-icon-button":ve,"sl-resize-observer":es};T([Z(".tab-group")],ke.prototype,"tabGroup",2);T([Z(".tab-group__body")],ke.prototype,"body",2);T([Z(".tab-group__nav")],ke.prototype,"nav",2);T([Z(".tab-group__indicator")],ke.prototype,"indicator",2);T([pe()],ke.prototype,"hasScrollControls",2);T([pe()],ke.prototype,"shouldHideScrollStartButton",2);T([pe()],ke.prototype,"shouldHideScrollEndButton",2);T([P()],ke.prototype,"placement",2);T([P()],ke.prototype,"activation",2);T([P({attribute:"no-scroll-controls",type:Boolean})],ke.prototype,"noScrollControls",2);T([P({attribute:"fixed-scroll-controls",type:Boolean})],ke.prototype,"fixedScrollControls",2);T([da({passive:!0})],ke.prototype,"updateScrollButtons",1);T([te("noScrollControls",{waitUntilFirstUpdate:!0})],ke.prototype,"updateScrollControls",1);T([te("placement",{waitUntilFirstUpdate:!0})],ke.prototype,"syncIndicator",1);ke.define("sl-tab-group");var cd=(e,t)=>{let s=0;return function(...n){window.clearTimeout(s),s=window.setTimeout(()=>{e.call(this,...n)},t)}},fl=(e,t,s)=>{let n=e[t];e[t]=function(...u){n.call(this,...u),s.call(this,n,...u)}};(()=>{if(typeof window>"u")return;if(!("onscrollend"in window)){let t=new Set,s=new WeakMap,n=i=>{for(let o of i.changedTouches)t.add(o.identifier)},u=i=>{for(let o of i.changedTouches)t.delete(o.identifier)};document.addEventListener("touchstart",n,!0),document.addEventListener("touchend",u,!0),document.addEventListener("touchcancel",u,!0),fl(EventTarget.prototype,"addEventListener",function(i,o){if(o!=="scrollend")return;let c=cd(()=>{t.size?c():this.dispatchEvent(new Event("scrollend"))},100);i.call(this,"scroll",c,{passive:!0}),s.set(this,c)}),fl(EventTarget.prototype,"removeEventListener",function(i,o){if(o!=="scrollend")return;let c=s.get(this);c&&i.call(this,"scroll",c,{passive:!0})})}})();var _l=J`
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
`;var hd=0,qe=class extends Q{constructor(){super(...arguments),this.localize=new fe(this),this.attrId=++hd,this.componentId=`sl-tab-${this.attrId}`,this.panel="",this.active=!1,this.closable=!1,this.disabled=!1,this.tabIndex=0}connectedCallback(){super.connectedCallback(),this.setAttribute("role","tab")}handleCloseClick(e){e.stopPropagation(),this.emit("sl-close")}handleActiveChange(){this.setAttribute("aria-selected",this.active?"true":"false")}handleDisabledChange(){this.setAttribute("aria-disabled",this.disabled?"true":"false"),this.disabled&&!this.active?this.tabIndex=-1:this.tabIndex=0}render(){return this.id=this.id.length>0?this.id:this.componentId,H`
      <div
        part="base"
        class=${re({tab:!0,"tab--active":this.active,"tab--closable":this.closable,"tab--disabled":this.disabled})}
      >
        <slot></slot>
        ${this.closable?H`
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
    `}};qe.styles=[oe,_l];qe.dependencies={"sl-icon-button":ve};T([Z(".tab")],qe.prototype,"tab",2);T([P({reflect:!0})],qe.prototype,"panel",2);T([P({type:Boolean,reflect:!0})],qe.prototype,"active",2);T([P({type:Boolean,reflect:!0})],qe.prototype,"closable",2);T([P({type:Boolean,reflect:!0})],qe.prototype,"disabled",2);T([P({type:Number,reflect:!0})],qe.prototype,"tabIndex",2);T([te("active")],qe.prototype,"handleActiveChange",1);T([te("disabled")],qe.prototype,"handleDisabledChange",1);qe.define("sl-tab");var ml=J`
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
`;var dd=0,pi=class extends Q{constructor(){super(...arguments),this.attrId=++dd,this.componentId=`sl-tab-panel-${this.attrId}`,this.name="",this.active=!1}connectedCallback(){super.connectedCallback(),this.id=this.id.length>0?this.id:this.componentId,this.setAttribute("role","tabpanel")}handleActiveChange(){this.setAttribute("aria-hidden",this.active?"false":"true")}render(){return H`
      <slot
        part="base"
        class=${re({"tab-panel":!0,"tab-panel--active":this.active})}
      ></slot>
    `}};pi.styles=[oe,ml];T([P({reflect:!0})],pi.prototype,"name",2);T([P({type:Boolean,reflect:!0})],pi.prototype,"active",2);T([te("active")],pi.prototype,"handleActiveChange",1);pi.define("sl-tab-panel");var gl=J`
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
`;var Le=class extends Q{constructor(){super(...arguments),this.formControlController=new At(this,{value:e=>e.checked?e.value||"on":void 0,defaultValue:e=>e.defaultChecked,setValue:(e,t)=>e.checked=t}),this.hasSlotController=new Ve(this,"help-text"),this.hasFocus=!1,this.title="",this.name="",this.size="medium",this.disabled=!1,this.checked=!1,this.defaultChecked=!1,this.form="",this.required=!1,this.helpText=""}get validity(){return this.input.validity}get validationMessage(){return this.input.validationMessage}firstUpdated(){this.formControlController.updateValidity()}handleBlur(){this.hasFocus=!1,this.emit("sl-blur")}handleInput(){this.emit("sl-input")}handleInvalid(e){this.formControlController.setValidity(!1),this.formControlController.emitInvalidEvent(e)}handleClick(){this.checked=!this.checked,this.emit("sl-change")}handleFocus(){this.hasFocus=!0,this.emit("sl-focus")}handleKeyDown(e){e.key==="ArrowLeft"&&(e.preventDefault(),this.checked=!1,this.emit("sl-change"),this.emit("sl-input")),e.key==="ArrowRight"&&(e.preventDefault(),this.checked=!0,this.emit("sl-change"),this.emit("sl-input"))}handleCheckedChange(){this.input.checked=this.checked,this.formControlController.updateValidity()}handleDisabledChange(){this.formControlController.setValidity(!0)}click(){this.input.click()}focus(e){this.input.focus(e)}blur(){this.input.blur()}checkValidity(){return this.input.checkValidity()}getForm(){return this.formControlController.getForm()}reportValidity(){return this.input.reportValidity()}setCustomValidity(e){this.input.setCustomValidity(e),this.formControlController.updateValidity()}render(){let e=this.hasSlotController.test("help-text"),t=this.helpText?!0:!!e;return H`
      <div
        class=${re({"form-control":!0,"form-control--small":this.size==="small","form-control--medium":this.size==="medium","form-control--large":this.size==="large","form-control--has-help-text":t})}
      >
        <label
          part="base"
          class=${re({switch:!0,"switch--checked":this.checked,"switch--disabled":this.disabled,"switch--focused":this.hasFocus,"switch--small":this.size==="small","switch--medium":this.size==="medium","switch--large":this.size==="large"})}
        >
          <input
            class="switch__input"
            type="checkbox"
            title=${this.title}
            name=${this.name}
            value=${se(this.value)}
            .checked=${Us(this.checked)}
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
    `}};Le.styles=[oe,ai,gl];T([Z('input[type="checkbox"]')],Le.prototype,"input",2);T([pe()],Le.prototype,"hasFocus",2);T([P()],Le.prototype,"title",2);T([P()],Le.prototype,"name",2);T([P()],Le.prototype,"value",2);T([P({reflect:!0})],Le.prototype,"size",2);T([P({type:Boolean,reflect:!0})],Le.prototype,"disabled",2);T([P({type:Boolean,reflect:!0})],Le.prototype,"checked",2);T([Ws("checked")],Le.prototype,"defaultChecked",2);T([P({reflect:!0})],Le.prototype,"form",2);T([P({type:Boolean,reflect:!0})],Le.prototype,"required",2);T([P({attribute:"help-text"})],Le.prototype,"helpText",2);T([te("checked",{waitUntilFirstUpdate:!0})],Le.prototype,"handleCheckedChange",1);T([te("disabled",{waitUntilFirstUpdate:!0})],Le.prototype,"handleDisabledChange",1);Le.define("sl-switch");var vl=J`
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
`;var Fe=class Xt extends Q{constructor(){super(...arguments),this.hasSlotController=new Ve(this,"icon","suffix"),this.localize=new fe(this),this.open=!1,this.closable=!1,this.variant="primary",this.duration=1/0,this.remainingTime=this.duration}static get toastStack(){return this.currentToastStack||(this.currentToastStack=Object.assign(document.createElement("div"),{className:"sl-toast-stack"})),this.currentToastStack}firstUpdated(){this.base.hidden=!this.open}restartAutoHide(){this.handleCountdownChange(),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval),this.open&&this.duration<1/0&&(this.autoHideTimeout=window.setTimeout(()=>this.hide(),this.duration),this.remainingTime=this.duration,this.remainingTimeInterval=window.setInterval(()=>{this.remainingTime-=100},100))}pauseAutoHide(){var t;(t=this.countdownAnimation)==null||t.pause(),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval)}resumeAutoHide(){var t;this.duration<1/0&&(this.autoHideTimeout=window.setTimeout(()=>this.hide(),this.remainingTime),this.remainingTimeInterval=window.setInterval(()=>{this.remainingTime-=100},100),(t=this.countdownAnimation)==null||t.play())}handleCountdownChange(){if(this.open&&this.duration<1/0&&this.countdown){let{countdownElement:t}=this,s="100%",n="0";this.countdownAnimation=t.animate([{width:s},{width:n}],{duration:this.duration,easing:"linear"})}}handleCloseClick(){this.hide()}async handleOpenChange(){if(this.open){this.emit("sl-show"),this.duration<1/0&&this.restartAutoHide(),await Ae(this.base),this.base.hidden=!1;let{keyframes:t,options:s}=Se(this,"alert.show",{dir:this.localize.dir()});await Ce(this.base,t,s),this.emit("sl-after-show")}else{Vs(this),this.emit("sl-hide"),clearTimeout(this.autoHideTimeout),clearInterval(this.remainingTimeInterval),await Ae(this.base);let{keyframes:t,options:s}=Se(this,"alert.hide",{dir:this.localize.dir()});await Ce(this.base,t,s),this.base.hidden=!0,this.emit("sl-after-hide")}}handleDurationChange(){this.restartAutoHide()}async show(){if(!this.open)return this.open=!0,Oe(this,"sl-after-show")}async hide(){if(this.open)return this.open=!1,Oe(this,"sl-after-hide")}async toast(){return new Promise(t=>{this.handleCountdownChange(),Xt.toastStack.parentElement===null&&document.body.append(Xt.toastStack),Xt.toastStack.appendChild(this),requestAnimationFrame(()=>{this.clientWidth,this.show()}),this.addEventListener("sl-after-hide",()=>{Xt.toastStack.removeChild(this),t(),Xt.toastStack.querySelector("sl-alert")===null&&Xt.toastStack.remove()},{once:!0})})}render(){return H`
      <div
        part="base"
        class=${re({alert:!0,"alert--open":this.open,"alert--closable":this.closable,"alert--has-countdown":!!this.countdown,"alert--has-icon":this.hasSlotController.test("icon"),"alert--primary":this.variant==="primary","alert--success":this.variant==="success","alert--neutral":this.variant==="neutral","alert--warning":this.variant==="warning","alert--danger":this.variant==="danger"})}
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

        ${this.closable?H`
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

        ${this.countdown?H`
              <div
                class=${re({alert__countdown:!0,"alert__countdown--ltr":this.countdown==="ltr"})}
              >
                <div class="alert__countdown-elapsed"></div>
              </div>
            `:""}
      </div>
    `}};Fe.styles=[oe,vl];Fe.dependencies={"sl-icon-button":ve};T([Z('[part~="base"]')],Fe.prototype,"base",2);T([Z(".alert__countdown-elapsed")],Fe.prototype,"countdownElement",2);T([P({type:Boolean,reflect:!0})],Fe.prototype,"open",2);T([P({type:Boolean,reflect:!0})],Fe.prototype,"closable",2);T([P({reflect:!0})],Fe.prototype,"variant",2);T([P({type:Number})],Fe.prototype,"duration",2);T([P({type:String,reflect:!0})],Fe.prototype,"countdown",2);T([pe()],Fe.prototype,"remainingTime",2);T([te("open",{waitUntilFirstUpdate:!0})],Fe.prototype,"handleOpenChange",1);T([te("duration")],Fe.prototype,"handleDurationChange",1);var bl=Fe;we("alert.show",{keyframes:[{opacity:0,scale:.8},{opacity:1,scale:1}],options:{duration:250,easing:"ease"}});we("alert.hide",{keyframes:[{opacity:1,scale:1},{opacity:0,scale:.8}],options:{duration:250,easing:"ease"}});bl.define("sl-alert");var ye=Ho(),me=No(),le=or(location.hash),wl=me.getState(),bo=!0,ft="*",yo="",wo={},Sl=null,nt=null,fi=null,ts={},qs=new Set;function ud(e,t){if(!(!e||!t)){ts[e]||(ts[e]={});for(let[s,n]of Object.entries(t)){if(n.status==="pending")continue;let u=`${e}:${s}`;ts[e][s]||qs.has(u)||(qs.add(u),me.send("get-agent-prompt",{runId:e,stage:s}).then(i=>{ts[e][s]=i,qs.delete(u),De()}).catch(()=>{qs.delete(u)}))}}}me.on("runs-list",e=>{let t={};for(let s of e.runs||[])t[s.id]=s;ye.setState({runs:t}),e.settings&&(wo=e.settings)});me.on("run-snapshot",e=>{e&&e.id&&(ye.setRun(e.id,e),nt&&(nt=null,De()))});me.on("run-update",e=>{e&&e.id&&(ye.setRun(e.id,e),nt&&(nt=null,De()))});me.on("log-line",e=>{e&&(ye.appendLog(e),e.iteration&&e.iteration>1&&e._iterStart&&Bn(e.iteration),Ur(e))});me.on("log-bulk",e=>{if(e&&Array.isArray(e.lines))for(let t of e.lines){let s={stage:e.stage,line:t};ye.appendLog(s),Ur(s)}});me.on("preferences",e=>{e&&(ye.setState({preferences:e}),xi(e.theme||"light"))});me.onConnection(e=>{wl=e,e==="open"&&(me.send("list-runs").then(t=>{let s={};for(let n of t.runs||[])s[n.id]=n;ye.setState({runs:s}),t.settings&&(wo=t.settings)}).catch(()=>{}),me.send("get-preferences").then(t=>{ye.setState({preferences:t}),xi(t.theme||"light")}).catch(()=>{}),le.runId&&(me.send("subscribe-run",{runId:le.runId}).catch(()=>{}),me.send("subscribe-log",{stage:ft==="*"?null:ft,runId:le.runId}).catch(()=>{}))),De()});Wo(e=>{let t=le.runId;le=e,t&&t!==le.runId&&(me.send("unsubscribe-run").catch(()=>{}),me.send("unsubscribe-log").catch(()=>{}),ye.clearLog(),Ii()),le.runId&&le.runId!==t&&(me.send("subscribe-run",{runId:le.runId}).catch(()=>{}),me.send("subscribe-log",{stage:null,runId:le.runId}).catch(()=>{})),le.section==="settings"&&Cr().then(()=>De()),!le.runId&&t&&On(),De()});function pd(e){gt(e,null)}function yl(e){gt(le.section,e)}function fd(){let t=ye.getState().preferences.theme==="dark"?"light":"dark";me.send("set-preferences",{theme:t}).catch(()=>{}),ye.setState({preferences:{theme:t}}),xi(t)}function _d(e){ft=e,Sl=null,Ii(),ye.clearLog(),me.send("unsubscribe-log").catch(()=>{}),me.send("subscribe-log",{stage:e==="*"?null:e,runId:le.runId}).catch(()=>{}),De()}function md(e){Sl=e,Ii(),ye.clearLog(),me.send("unsubscribe-log").catch(()=>{}),me.send("subscribe-log",{stage:ft==="*"?null:ft,runId:le.runId,iteration:e}).catch(()=>{}),De()}function gd(e){yo=e,Mn(e)}function vd(){bo=!bo,De()}function Cl(e){fi=e,De(),requestAnimationFrame(()=>{let t=document.getElementById("action-error-dialog");t&&t.show()})}function bd(){fi=null,De()}function yd(){nt="stopping",fi=null,De(),me.send("stop-run").then(()=>{}).catch(e=>{nt=null,Cl(e?.message||"Failed to stop pipeline")})}function wd(){nt="resuming",fi=null,De(),me.send("resume-run").then(()=>{}).catch(e=>{nt=null,Cl(e?.message||"Failed to resume pipeline")})}function Sd(){if(le.runId){let t=Object.values(ye.getState().runs).filter(s=>s.active);le.section==="active"&&t.length<=1?gt("dashboard",null):gt(le.section,null)}else le.section&&le.section!=="dashboard"&&gt("dashboard",null)}function Cd(){let e=ye.getState(),t="Dashboard",s=!1,n=null,u=null;if(le.runId){let i=e.runs[le.runId],c=(i?.work_request?.title||"Pipeline Details").split(`
`)[0];if(t=c.length>80?c.slice(0,80)+"\u2026":c,s=!0,i){let p=i.runState||(i.active?"running":"terminal"),d=p==="running"?"warning":p==="interrupted"?"neutral":"success",f=p==="running"?"in_progress":p==="interrupted"?"interrupted":"completed",g=p==="running"?"Running":p==="interrupted"?"Interrupted":"Completed";n=H`<sl-badge variant="${d}" pill>
        ${X(Qe(f,12))}
        ${g}
      </sl-badge>`,nt==="stopping"?u=H`
          <button class="action-btn action-btn--danger" disabled>
            ${X(Y(bt,14,"icon-spin"))}
            Stopping\u2026
          </button>`:nt==="resuming"?u=H`
          <button class="action-btn action-btn--primary" disabled>
            ${X(Y(bt,14,"icon-spin"))}
            Resuming\u2026
          </button>`:p==="running"?u=H`
          <button class="action-btn action-btn--danger" @click=${yd}>
            ${X(Y(pr,14))}
            Stop Pipeline
          </button>`:p==="interrupted"&&(u=H`
          <button class="action-btn action-btn--primary" @click=${wd}>
            ${X(Y(fr,14))}
            Resume Pipeline
          </button>`)}}else le.section==="active"?(t="Running Pipelines",s=!0):le.section==="history"?(t="History",s=!0):le.section==="settings"&&(t="Settings",s=!0);return H`
    <div class="content-header">
      ${s?H`
        <button class="content-header-back" @click=${Sd}>
          ${X(Y(ur,18))}
        </button>
      `:""}
      ${n||""}
      <h1 class="content-header-title">${t}</h1>
      ${u?H`<div class="content-header-actions">
        ${u}
      </div>`:""}
    </div>
  `}function xd(){let e=ye.getState(),t=Object.values(e.runs);if(le.runId){let s=e.runs[le.runId],n={};if(s?.stages){for(let[i,o]of Object.entries(s.stages)){let c=o.iterations||[];c.length>0&&(n[i]=c.length)}ud(le.runId,s.stages)}let u=kd(e);return u.currentLogStage=ft==="*"?null:ft,H`
      ${Xo(s,wo,{promptCache:ts[le.runId]||{}})}
      ${Pn(u,{onStageFilter:_d,onIterationFilter:md,onSearch:gd,onToggleAutoScroll:vd,autoScroll:bo,stageIterations:n,runStages:s?.stages})}
    `}if(le.section==="settings")return Zo(e.preferences,{rerender:De,onThemeToggle:fd});if(le.section==="history")return Sr(t,"history",{onSelectRun:yl});if(le.section==="active"){let s=t.filter(n=>n.active);return s.length===1?(gt("active",s[0].id),H``):Sr(t,"active",{onSelectRun:yl})}return Yo(e,{onSelectRun:s=>gt("active",s)})}function kd(e){let t=e.logLines;if(ft!=="*"&&(t=t.filter(s=>s.stage===ft)),yo){let s=yo.toLowerCase();t=t.filter(n=>(n.line||"").toLowerCase().includes(s))}return{...e,logLines:t}}function De(){let e=ye.getState(),t=document.getElementById("app");t&&(cs(H`
    <div class="app-shell">
      ${Uo(e,le,wl,{onNavigate:pd})}
      <main class="main-content">
        ${Cd()}
        ${xd()}
      </main>
    </div>
    ${fi?H`
      <sl-dialog id="action-error-dialog" label="Pipeline Error" @sl-after-hide=${bd}>
        <div class="error-dialog-body">
          ${X(Y(cr,32,"error-dialog-icon"))}
          <p>${fi}</p>
        </div>
        <sl-button slot="footer" variant="primary" @click=${()=>{document.getElementById("action-error-dialog")?.hide()}}>OK</sl-button>
      </sl-dialog>
    `:""}
  `,t),le.runId&&$n(le.runId))}ye.subscribe(()=>De());xi(ye.getState().preferences.theme);le.section==="settings"&&Cr().then(()=>De());De();
//# sourceMappingURL=main.bundle.js.map
